import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import react from "@vitejs/plugin-react";
import {
  _electron,
  type Browser,
  type BrowserContext,
  chromium,
  type ElectronApplication,
  type Page,
} from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppDatabase } from "../../src/server/database.js";
import { AuthService } from "../../src/server/features/auth/service.js";
import { createTestApp } from "../helpers/app.js";
import { seedReaderBacklog } from "../helpers/reader-backlog.js";

const desktopAppPath = process.env.FEEDFOLD_DESKTOP_TEST_APP;
let desktop: ElectronApplication | undefined;
let directory: string;
let database: AppDatabase;
let server: Awaited<ReturnType<typeof createTestApp>>;
let vite: ViteDevServer;
let browser: Browser;
let context: BrowserContext;
let origin: string;
let backlog: ReturnType<typeof seedReaderBacklog>;
let other: ReturnType<typeof seedReaderBacklog>;
let releaseImage = () => {};
let holdImage = false;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "feedfold-virtual-"));
  database = new AppDatabase(join(directory, "feedfold.db"));
  server = await createTestApp(
    database,
    new AuthService(database.auth, 20, { registrationMode: "open" }),
  );
  server.app.get("/delayed-image.svg", async (_request, reply) => {
    if (holdImage)
      await new Promise<void>((resolve) => {
        releaseImage = resolve;
      });
    return reply
      .type("image/svg+xml")
      .send(
        '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="teal"/></svg>',
      );
  });
  server.app.get("/tone.wav", async (_request, reply) => {
    const samples = 8000 * 30;
    const wav = Buffer.alloc(44 + samples * 2);
    wav.write("RIFF");
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24);
    wav.writeUInt32LE(16000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(samples * 2, 40);
    return reply.type("audio/wav").send(wav);
  });
  server.app.get("/player", async (_request, reply) =>
    reply
      .header("X-Frame-Options", "SAMEORIGIN")
      .header("Content-Security-Policy", "frame-ancestors *")
      .type("text/html")
      .send('<video src="/tone.wav" autoplay muted loop controls></video>'),
  );
  server.app.addHook("onSend", async (request, reply, payload) => {
    if (request.url.startsWith("/player")) {
      reply.removeHeader("X-Frame-Options");
      reply.header("Content-Security-Policy", "frame-ancestors *");
    }
    return payload;
  });
  const apiOrigin = await server.app.listen({ host: "127.0.0.1", port: 0 });
  vite = await createServer({
    configFile: false,
    plugins: [react(), VitePWA()],
    cacheDir: join(directory, "vite"),
    server: {
      host: "127.0.0.1",
      port: 0,
      proxy: {
        "/api": { target: apiOrigin },
        "/player": { target: apiOrigin },
        "/tone.wav": { target: apiOrigin },
      },
    },
  });
  await vite.listen();
  origin = vite.resolvedUrls?.local[0] ?? "";
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 900 } });
  const response = await context.request.post("/api/auth/register", {
    data: { username: "virtual-reader", password: "reader-password" },
  });
  expect(response.status()).toBe(201);
  backlog = seedReaderBacklog(database, "Virtualization backlog", 1200, apiOrigin);
  database.connection.prepare("UPDATE articles SET media_json = ? WHERE id = 2").run(
    JSON.stringify({
      type: "video",
      provider: "youtube",
      embedUrl: `${origin}player`,
      durationSeconds: null,
      viewCount: null,
    }),
  );
  other = seedReaderBacklog(database, "Other queue", 150);
  database.settings.updateSettings(1, { markReadOnScroll: true, singleKeyShortcuts: true });
  if (desktopAppPath) {
    desktop = await _electron.launch({
      args: [desktopAppPath],
      env: {
        ...process.env,
        FEEDFOLD_DESKTOP_USER_DATA: directory,
        FEEDFOLD_DESKTOP_DEV_URL: origin,
      },
    });
    context = desktop.context();
    await (await desktop.firstWindow()).locator(".reader-toolbar").waitFor();
  }
}, 30_000);

afterAll(async () => {
  releaseImage();
  await desktop?.close();
  await browser?.close();
  await vite?.close();
  await server?.close();
  database?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
}, 30_000);

async function open(mode: "magazine" | "expanded") {
  if (desktop && desktop.windows().length === 0)
    await desktop.evaluate(({ app }) => {
      app.emit("activate");
    });
  const page = desktop ? await desktop.firstWindow() : await context.newPage();
  // Exercise asynchronous mode changes even on a fast development machine.
  await page.route(/\/api\/articles(?:\?|\/)/, async (route) => {
    if (route.request().method() === "GET")
      await new Promise((resolve) => setTimeout(resolve, 250));
    await route.continue();
  });
  page.setDefaultTimeout(5000);
  if (desktop) await page.locator(".reader-toolbar").waitFor();
  await page.goto(`${origin}feeds/${backlog.feed.id}/all`, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("button", {
      name: mode === "magazine" ? "Magazine view" : "Expanded view",
      exact: true,
    })
    .click();
  await page
    .locator(`.reading-workspace.mode-${mode}[aria-busy="false"] .virtual-article-row`)
    .first()
    .waitFor();
  return page;
}
const surface = (page: Page) => page.locator("[data-virtuoso-scroller=true]");
async function bottom(page: Page) {
  await surface(page).evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
}
async function anchor(page: Page) {
  return surface(page).evaluate((element) => {
    const top = element.getBoundingClientRect().top;
    const row = [...element.querySelectorAll<HTMLElement>(".virtual-article-row")].find(
      (item) => item.getBoundingClientRect().bottom > top,
    );
    return { id: row?.dataset.articleId, top: (row?.getBoundingClientRect().top ?? top) - top };
  });
}
async function settle(page: Page) {
  await page.waitForTimeout(150);
}

describe(`${desktopAppPath ? "desktop" : "browser"} virtual reading with a populated database`, () => {
  it("keeps a read article open after refreshing its unread reader context", async () => {
    const sample = seedReaderBacklog(database, "Refreshed unread article", 3);
    const page = await open("magazine");
    const selected = database.articles.listArticlePage(1, {
      feedId: sample.feed.id,
      state: "unread",
    }).articles[1];
    if (!selected) throw new Error("The refresh fixture has no article");
    try {
      await page.goto(`${origin}feeds/${sample.feed.id}/unread`);
      await page.getByRole("button", { name: `Open ${selected.title}`, exact: true }).click();
      await expect.poll(() => database.articles.getArticle(1, selected.id)?.isRead).toBe(true);
      const anchoredPage = page.waitForResponse((response) =>
        response.url().includes(`anchorId=${selected.id}`),
      );
      await page.reload();
      expect((await anchoredPage).status()).toBe(200);
      await page.locator('.reading-workspace[aria-busy="false"]').waitFor();
      await settle(page);
      await expect
        .poll(() => page.locator(".article-swipe-layer.is-active h2").allTextContents())
        .toEqual([`${selected.title} (opens in a new tab)`]);
      await page.getByRole("button", { name: "Back to articles", exact: true }).click();
      await expect.poll(() => page.locator(".article-open-button").count()).toBe(2);
      expect(await page.locator(".article-open-button").allTextContents()).not.toContain(
        `Open ${selected.title}`,
      );
    } finally {
      await page.close();
    }
  });

  it("keeps excluded cached read articles out when loading the next unread page", async () => {
    const sample = seedReaderBacklog(database, "Cached unread pagination", 105);
    const page = await open("magazine");
    const selected = database.articles.listArticlePage(1, {
      feedId: sample.feed.id,
      state: "unread",
    }).articles[0];
    if (!selected) throw new Error("The pagination fixture has no article");
    try {
      await page.goto(`${origin}feeds/${sample.feed.id}/unread`);
      await page.getByRole("button", { name: `Open ${selected.title}`, exact: true }).waitFor();
      await page.getByRole("button", { name: "All articles", exact: true }).click();
      await page
        .getByRole("button", { name: `Mark ${selected.title} as read`, exact: true })
        .click();
      await expect.poll(() => database.articles.getArticle(1, selected.id)?.isRead).toBe(true);
      await page.getByRole("button", { name: /104 Unread/ }).click();
      await page
        .getByRole("button", { name: `Open ${sample.feed.title} 0001`, exact: true })
        .waitFor();
      expect(await page.locator(".article-open-button").allTextContents()).not.toContain(
        `Open ${selected.title}`,
      );
      const nextPage = page.waitForResponse((response) => response.url().includes("cursor="));
      await bottom(page);
      const response = await nextPage;
      expect(response.status()).toBe(200);
      const result = await response.json();
      expect(result.articles.map((article: { id: number }) => article.id)).not.toContain(
        selected.id,
      );
      await settle(page);
      await bottom(page);
      await page
        .getByRole("button", { name: `Open ${sample.feed.title} 0104`, exact: true })
        .waitFor();
      expect(await page.locator(".article-open-button").allTextContents()).not.toContain(
        `Open ${selected.title}`,
      );
    } finally {
      await page.close();
    }
  });

  it.each(["folder", "feed"] as const)(
    "excludes a newly read article when revisiting a cached unread %s",
    async (scope) => {
      const sample = seedReaderBacklog(database, `Unread ${scope}`, 3);
      const folder = database.folders.createFolder(1, { name: `Unread ${scope} folder` });
      database.feeds.updateFeed(1, sample.feed.id, { folderId: folder.id });
      const page = await open("magazine");
      const scopePath =
        scope === "folder" ? `folders/${folder.id}/unread` : `feeds/${sample.feed.id}/unread`;
      const selected = database.articles.listArticlePage(1, {
        feedId: sample.feed.id,
        state: "unread",
      }).articles[1];
      if (!selected) throw new Error("The unread fixture has no article");
      const rows = () => page.locator(".article-open-button").allTextContents();
      try {
        await page.goto(`${origin}${scopePath}`);
        await expect.poll(rows).toHaveLength(3);
        await page.locator(".quick-links .nav-item").first().click();
        await page.getByRole("button", { name: `Open ${selected.title}`, exact: true }).click();
        await expect.poll(() => database.articles.getArticle(1, selected.id)?.isRead).toBe(true);
        await page.locator(".article-swipe-layer.is-active .article-content").waitFor();
        // The live API excludes the read article; a cached list must agree immediately.
        const response = await page.request.get(
          `/api/articles?state=unread&${scope}Id=${scope === "folder" ? folder.id : sample.feed.id}`,
        );
        expect(response.status()).toBe(200);
        const result = await response.json();
        expect(result.articles.map((article: { id: number }) => article.id)).not.toContain(
          selected.id,
        );
        await page
          .locator(
            scope === "folder"
              ? `button[data-management-folder-id="${folder.id}"]`
              : `.feed-nav-item[data-management-feed-id="${sample.feed.id}"]`,
          )
          .click();
        await page.waitForURL(`${origin}${scopePath}`);
        await page
          .locator('.reading-workspace[aria-busy="false"] .article-open-button')
          .first()
          .waitFor();
        expect(await rows()).not.toContain(`Open ${selected.title}`);
        expect(await rows()).toHaveLength(2);
      } finally {
        await page.close();
      }
    },
  );

  it.each(["rename", "pause"] as const)(
    "keeps read articles in the unread queue after a feed %s",
    async (action) => {
      const sample = seedReaderBacklog(database, `Metadata ${action}`, 3);
      database.feeds.updateFeed(1, sample.feed.id, { paused: false });
      const page = await open("expanded");
      const titles = () => page.locator(".expanded-article .article-header h2").allTextContents();
      try {
        await page.goto(`${origin}feeds/${sample.feed.id}/unread`);
        await expect.poll(() => page.locator(".expanded-article").count()).toBe(3);
        const original = await titles();
        await page.getByRole("button", { name: "Mark as read (U)", exact: true }).first().click();
        await expect.poll(() => database.feeds.getFeed(1, sample.feed.id)?.unreadCount).toBe(2);
        await expect.poll(titles).toEqual(original);
        await page
          .getByRole("button", { name: `Manage ${sample.feed.title}`, exact: true })
          .click();
        if (action === "rename") {
          await page.getByRole("menuitem", { name: "Rename feed", exact: true }).click();
          await page.getByRole("textbox", { name: "Feed name" }).fill("Renamed metadata feed");
          await page.getByRole("button", { name: "Save name", exact: true }).click();
          await page
            .getByRole("dialog", { name: "Rename feed", exact: true })
            .waitFor({ state: "hidden" });
          expect(database.feeds.getFeed(1, sample.feed.id)?.title).toBe("Renamed metadata feed");
        } else {
          await page.getByRole("menuitem", { name: "Feed settings", exact: true }).click();
          await page.getByRole("button", { name: "Pause feed", exact: true }).click();
          await page.getByRole("button", { name: "Resume feed", exact: true }).waitFor();
          expect(database.feeds.getFeed(1, sample.feed.id)?.paused).toBe(true);
          await page.getByRole("button", { name: "Close", exact: true }).click();
          await page.getByRole("dialog").waitFor({ state: "hidden" });
        }
        await expect.poll(titles).toEqual(original);
      } finally {
        await page.close();
      }
    },
  );

  it("removes older articles from the unread queue after a bulk read without reloading", async () => {
    const sample = seedReaderBacklog(database, "Bulk read queue", 3);
    database.feeds.completeSourceRefresh(sample.sourceId, {
      ...sample.refresh,
      parsed: {
        title: sample.feed.title,
        siteUrl: null,
        articles: sample.articles.map((article, index) => ({
          ...article,
          publishedAt: new Date(Date.now() - (index + 2) * 86_400_000).toISOString(),
        })),
      },
    });
    const page = await open("magazine");
    try {
      await page.goto(`${origin}feeds/${sample.feed.id}/unread`);
      await page
        .getByRole("button", { name: `Open ${sample.articles[0]?.title}`, exact: true })
        .waitFor();
      await page.getByRole("button", { name: "Mark older articles as read", exact: true }).click();
      await page.getByRole("menuitem", { name: "Older than a day", exact: true }).click();
      await expect.poll(() => database.feeds.getFeed(1, sample.feed.id)?.unreadCount).toBe(0);
      await page.getByText("No unread articles", { exact: true }).waitFor();
      expect(await page.locator(".virtual-article-row").count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it.each(["normal save", "overlapping update"])(
    "applies a saved folder order without reloading: %s",
    async (scenario) => {
      const sample = seedReaderBacklog(database, `Sorted queue ${scenario}`, 3);
      const folder = database.folders.createFolder(1, {
        name: `Sort review ${scenario}`,
        sortDirection: "oldest",
      });
      database.feeds.updateFeed(1, sample.feed.id, { folderId: folder.id });
      const page = await open("magazine");
      const firstTitle = () => page.locator(".virtual-article-row").first().textContent();
      let releaseArticles = () => {};
      try {
        await page.goto(`${origin}folders/${folder.id}/all`);
        await expect.poll(firstTitle).toContain(sample.articles.at(-1)?.title);
        if (scenario === "overlapping update") {
          const articlesReady = new Promise<void>((resolve) => {
            releaseArticles = resolve;
          });
          let interrupted = false;
          await page.route(/\/api\/articles\?/, async (route) => {
            if (!interrupted) {
              interrupted = true;
              // A real server notification replaces the reload started by Save folder.
              const response = await context.request.patch(`/api/feeds/${sample.feed.id}`, {
                data: { title: "Concurrent rename" },
              });
              expect(response.ok()).toBe(true);
            }
            await articlesReady;
            await route.continue();
          });
        }
        await page.getByRole("button", { name: `Manage ${folder.name}`, exact: true }).click();
        await page.getByRole("menuitem", { name: "Folder settings", exact: true }).click();
        await page.getByRole("combobox", { name: "Article order", exact: true }).click();
        await page.getByRole("option", { name: "Newest first", exact: true }).click();
        await page.getByRole("button", { name: "Save folder", exact: true }).click();
        await expect
          .poll(() => database.folders.getFolder(1, folder.id)?.sortDirection)
          .toBe("newest");
        await page
          .getByRole("dialog", { name: "Folder settings", exact: true })
          .waitFor({ state: "hidden" });
        if (scenario === "overlapping update")
          expect(await firstTitle()).toContain(sample.articles.at(-1)?.title);
        releaseArticles();
        await expect.poll(firstTitle).toContain(sample.articles[0]?.title);
      } finally {
        releaseArticles();
        await page.close();
      }
    },
  );

  for (const mode of ["magazine", "expanded"] as const) {
    it(`${mode}: loads pages with bounded DOM, retries failure, and searches unmounted article bodies`, async () => {
      const page = await open(mode);
      try {
        expect(await page.locator(".virtual-article-row").count()).toBeLessThan(25);
        const scrolling = await surface(page).evaluate(async (element) => {
          const frames: Array<{ elapsed: number; rows: number; visible: boolean }> = [];
          let detachedFrames = 0;
          let previous = performance.now();
          for (let index = 0; index < 60; index++) {
            await new Promise(requestAnimationFrame);
            const now = performance.now();
            if (!element.isConnected) detachedFrames++;
            const viewport = element.getBoundingClientRect();
            const rows = [...element.querySelectorAll(".virtual-article-row")];
            frames.push({
              elapsed: now - previous,
              rows: rows.length,
              visible: rows.some((row) => {
                const bounds = row.getBoundingClientRect();
                return bounds.bottom > viewport.top && bounds.top < viewport.bottom;
              }),
            });
            element.scrollTop += 80;
            previous = now;
          }
          element.scrollTop = 0;
          return {
            detachedFrames,
            blankFrames: frames.filter((frame) => !frame.visible).length,
            maxRows: Math.max(...frames.map((frame) => frame.rows)),
            p95Milliseconds: frames.map((frame) => frame.elapsed).sort((a, b) => a - b)[56],
          };
        });
        expect(scrolling).toMatchObject({ blankFrames: 0, detachedFrames: 0 });
        expect(scrolling.maxRows).toBeLessThan(25);
        if (process.env.FEEDFOLD_READER_METRICS) console.info(mode, scrolling);
        let fail = true;
        let failures = 0;
        if (desktop)
          await desktop.evaluate(({ ipcMain }) => {
            const handlers = (
              ipcMain as unknown as {
                _invokeHandlers: Map<
                  string,
                  (
                    event: unknown,
                    request: { operation: string; payload?: { cursor?: string } },
                  ) => unknown
                >;
              }
            )._invokeHandlers;
            const original = handlers.get("feedfold:invoke");
            if (!original) throw new Error("Missing application IPC handler");
            const state = { fail: true, failures: 0 };
            Object.assign(globalThis, { paginationFailure: state });
            handlers.set("feedfold:invoke", (event, request) => {
              if (state.fail && request.operation === "articles" && request.payload?.cursor) {
                state.failures++;
                return original(event, {
                  ...request,
                  payload: { ...request.payload, cursor: "invalid-test-cursor" },
                });
              }
              return original(event, request);
            });
          });
        await page.route("**/api/articles?**", async (route) => {
          if (fail && new URL(route.request().url()).searchParams.has("cursor")) {
            failures++;
            await route.fulfill({
              status: 400,
              contentType: "application/json",
              body: JSON.stringify({ error: "Page temporarily unavailable" }),
            });
          } else await route.continue();
        });
        await bottom(page);
        await page.getByRole("button", { name: "Try loading more articles again" }).waitFor();
        await settle(page);
        if (desktop)
          failures = await desktop.evaluate(
            () =>
              (globalThis as unknown as { paginationFailure: { failures: number } })
                .paginationFailure.failures,
          );
        expect(failures).toBe(1);
        fail = false;
        if (desktop)
          await desktop.evaluate(() => {
            (
              globalThis as unknown as { paginationFailure: { fail: boolean } }
            ).paginationFailure.fail = false;
          });
        const height = await surface(page).evaluate((element) => element.scrollHeight);
        await page.getByRole("button", { name: "Try loading more articles again" }).click();
        await expect
          .poll(() => surface(page).evaluate((element) => element.scrollHeight))
          .toBeGreaterThan(height);
        for (let index = 0; index < 5; index++) {
          await bottom(page);
          await settle(page);
        }
        expect(await page.locator(".virtual-article-row").count()).toBeLessThan(25);
        await page.keyboard.press("ControlOrMeta+f");
        await page.getByRole("searchbox", { name: "Search articles" }).fill("bodyneedle1199");
        await page.getByRole("searchbox", { name: "Search articles" }).press("Enter");
        await page
          .locator(mode === "expanded" ? ".article-header h2" : ".article-list-title")
          .filter({ hasText: "Virtualization backlog 1199" })
          .waitFor();
        expect(await page.locator(".virtual-article-row").count()).toBe(1);
      } finally {
        await page.close();
      }
    }, 20_000);

    it(`${mode}: starts at the top without a selection after visiting another feed`, async () => {
      const page = await open(mode);
      try {
        await surface(page).evaluate((element) => {
          element.scrollTop = 3500;
        });
        await settle(page);
        expect(await surface(page).evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
        await page
          .getByRole("button", { name: new RegExp(`Feed health: Paused ${other.feed.title}`) })
          .click();
        await page.getByRole("heading", { name: other.feed.title, exact: true }).waitFor();
        expect(await page.locator(".virtual-article-row .is-active").count()).toBe(0);
        expect(await surface(page).evaluate((element) => element.scrollTop)).toBe(0);
        await page.goBack();
        await page.getByRole("heading", { name: backlog.feed.title, exact: true }).waitFor();
        await settle(page);
        expect(await page.locator(".virtual-article-row .is-active").count()).toBe(0);
        expect(await surface(page).evaluate((element) => element.scrollTop)).toBe(0);
      } finally {
        await page.close();
      }
    });

    it(`${mode}: unmounting unseen rows does not read them; intentional scrolling reads passed rows`, async () => {
      database.connection
        .prepare("UPDATE feed_articles SET is_read = 0 WHERE feed_id = ?")
        .run(backlog.feed.id);
      const page = await open(mode);
      try {
        const first = Number(
          await page.locator(".virtual-article-row").first().getAttribute("data-article-id"),
        );
        await surface(page).evaluate((element) => {
          element.scrollTop = 4000;
        });
        await settle(page);
        expect(database.articles.getArticle(1, first)?.isRead).toBe(false);
        await surface(page).evaluate((element) => {
          element.scrollTop = 0;
        });
        await settle(page);
        const box = await surface(page).boundingBox();
        if (!box) throw new Error("No scrolling surface");
        await page.mouse.move(box.x + box.width / 2, box.y + 200);
        const height = await page
          .locator(".virtual-article-row")
          .first()
          .evaluate((element) => element.getBoundingClientRect().height);
        await page.mouse.wheel(0, height + 200);
        await settle(page);
        await expect.poll(() => database.articles.getArticle(1, first)?.isRead).toBe(true);
      } finally {
        await page.close();
      }
    });
  }

  it("clears a shared article selection when navigating between its feed and folder", async () => {
    const sample = seedReaderBacklog(database, "Selection reset", 30);
    const folder = database.folders.createFolder(1, { name: "Selection reset folder" });
    database.feeds.updateFeed(1, sample.feed.id, { folderId: folder.id });
    const page = await open("magazine");
    try {
      await page.goto(`${origin}folders/${folder.id}/all`);
      await page.locator(".article-open-button").first().waitFor();
      await surface(page).evaluate((element) => {
        element.scrollTop = 1500;
      });
      await settle(page);
      const selected = await anchor(page);
      await page.locator(`[data-article-id="${selected.id}"] .article-open-button`).click();
      await page.locator(".article-swipe-layer.is-active .article-content").waitFor();
      for (const scope of ["feed", "folder"] as const) {
        await page
          .locator(
            scope === "feed"
              ? `.feed-nav-item[data-management-feed-id="${sample.feed.id}"]`
              : `button[data-management-folder-id="${folder.id}"]`,
          )
          .click();
        await page
          .getByRole("heading", {
            name: scope === "feed" ? sample.feed.title : folder.name,
            exact: true,
          })
          .waitFor();
        await settle(page);
        expect(await page.locator(".article-list-item.is-active").count()).toBe(0);
        expect(await surface(page).evaluate((element) => element.scrollTop)).toBe(0);
        expect(await page.locator(".virtual-article-row").first().textContent()).toContain(
          sample.articles[0]?.title,
        );
      }
    } finally {
      await page.close();
    }
  });

  it.each(["back button", "browser back"] as const)(
    "returns from an article to an unselected magazine at the top using %s",
    async (navigation) => {
      const page = await open("magazine");
      try {
        await surface(page).evaluate((element) => {
          element.scrollTop = 3500;
        });
        await settle(page);
        const selected = await anchor(page);
        await page.locator(`[data-article-id="${selected.id}"] .article-open-button`).click();
        await page.locator(".article-swipe-layer.is-active .article-content").waitFor();
        if (navigation === "browser back") await page.goBack();
        else await page.getByRole("button", { name: "Back to articles", exact: true }).click();
        await page.getByRole("heading", { name: backlog.feed.title, exact: true }).waitFor();
        await settle(page);
        expect(await page.locator(".article-list-item.is-active").count()).toBe(0);
        expect(await surface(page).evaluate((element) => element.scrollTop)).toBe(0);
        const first = database.articles.listArticlePage(1, {
          feedId: backlog.feed.id,
          state: "all",
        }).articles[0];
        await page.keyboard.press("j");
        await expect
          .poll(() => page.locator(".article-swipe-layer.is-active h2").first().textContent())
          .toContain(first?.title);
      } finally {
        await page.close();
      }
    },
  );

  for (const mode of ["magazine", "expanded"] as const) {
    it(`${mode}: preserves the viewport during delivery and shows new articles at the top after feed switches`, async () => {
      const page = await open(mode);
      try {
        await surface(page).evaluate((element) => {
          element.scrollTop = 3500;
        });
        await settle(page);
        const before = await anchor(page);
        database.articles.updateArticleState(1, Number(before.id), { isStarred: true });
        database.feeds.updateFeed(1, backlog.feed.id, { paused: false });
        const firstArticle = backlog.articles[0];
        if (!firstArticle) throw new Error("The populated backlog must have an article");
        database.feeds.completeSourceRefresh(backlog.sourceId, {
          ...backlog.refresh,
          parsed: {
            title: backlog.feed.title,
            siteUrl: null,
            articles: [
              {
                ...firstArticle,
                externalId: `new-${mode}`,
                title: `New delivery ${mode}`,
                url: `https://example.test/new-${mode}`,
                publishedAt: new Date().toISOString(),
              },
            ],
          },
        });
        database.feeds.updateFeed(1, backlog.feed.id, { paused: true });
        await page.evaluate(() => window.dispatchEvent(new Event("online")));
        await expect
          .poll(() =>
            page.locator(`[data-article-id="${before.id}"] [aria-pressed="true"]`).count(),
          )
          .toBeGreaterThan(0);
        const after = await anchor(page);
        expect(after.id).toBe(before.id);
        expect(Math.abs(after.top - before.top)).toBeLessThan(2);
        for (let i = 0; i < 3; i++) {
          await page
            .getByRole("button", { name: new RegExp(`Feed health: Paused ${other.feed.title}`) })
            .click();
          await page
            .getByRole("button", { name: new RegExp(`Feed health: Paused ${backlog.feed.title}`) })
            .click();
        }
        await expect
          .poll(() => page.locator(".reading-workspace").getAttribute("aria-busy"))
          .toBe("false");
        await expect
          .poll(() => page.locator(".reader-toolbar h1").textContent())
          .toBe(backlog.feed.title);
        expect(await page.locator(".virtual-article-row").count()).toBeLessThan(25);
        await expect
          .poll(() => page.locator(".virtual-article-row").allTextContents())
          .toEqual(expect.arrayContaining([expect.stringContaining(backlog.feed.title)]));
        await settle(page);
        expect(await surface(page).evaluate((element) => element.scrollTop)).toBe(0);
        expect(await page.locator(".virtual-article-row .is-active").count()).toBe(0);
        expect(await page.locator(".virtual-article-row").first().textContent()).toContain(
          `New delivery ${mode}`,
        );
      } finally {
        await page.close();
        database.connection
          .prepare("DELETE FROM articles WHERE source_id = ? AND external_id = ?")
          .run(backlog.sourceId, `new-${mode}`);
      }
    });
  }

  for (const update of ["full text", "AI summary"] as const) {
    it(`keeps the next article heading steady after loading ${update} above it`, async () => {
      const id = 4;
      database.connection
        .prepare(
          "UPDATE articles SET content_html = ?, extraction_status = 'complete' WHERE id = ?",
        )
        .run("<p>Expanded article text.</p>".repeat(30), id);
      const revision = (
        database.connection
          .prepare("SELECT content_revision AS revision FROM articles WHERE id = ?")
          .get(id) as { revision: number }
      ).revision;
      database.ai.saveArticleAiSummary(1, id, revision, {
        promptVersion: 1,
        promptId: null,
        sourceKind: "feed",
        provider: "openai",
        model: "saved-summary",
        text: `## Cached summary\n\n${"A saved summary paragraph.\n\n".repeat(20)}`,
        usage: { inputTokens: 20, outputTokens: 20 },
      });
      const page = await open("expanded");
      try {
        for (let activeId = 1; activeId <= id; activeId++) {
          await page.keyboard.press("j");
          await expect
            .poll(() =>
              page
                .locator(".expanded-article.is-active")
                .locator("..")
                .getAttribute("data-article-id"),
            )
            .toBe(String(activeId));
        }
        const next = page.locator(`[data-article-id="${id + 1}"] h2`);
        await next.evaluate(async (element) => {
          element.scrollIntoView({ block: "start" });
          await new Promise(requestAnimationFrame);
          await new Promise(requestAnimationFrame);
        });
        const before = await next.evaluate((element) => element.getBoundingClientRect().top);
        await page.keyboard.press(update === "full text" ? "w" : "m");
        const changedArticle = page.locator(`[data-article-id="${id}"]`);
        await expect
          .poll(
            () =>
              changedArticle
                .getByText(
                  update === "full text" ? "Expanded article text." : "A saved summary paragraph.",
                  { exact: true },
                )
                .count(),
            { timeout: 5000 },
          )
          .toBe(update === "full text" ? 30 : 20);
        const after = await next.evaluate(async (element) => {
          // Allow measurement and its scheduled scroll correction to run after the content commits.
          await new Promise(requestAnimationFrame);
          await new Promise(requestAnimationFrame);
          return element.getBoundingClientRect().top;
        });
        expect(Math.abs(after - before)).toBeLessThan(2);
      } finally {
        await page.close();
      }
    });
  }

  it("navigates beyond mounted rows and across page boundaries with the keyboard", async () => {
    const page = await open("expanded");
    try {
      for (let i = 0; i <= 26; i++) {
        await page.keyboard.press("j");
        await expect
          .poll(() => page.locator(".expanded-article.is-active h2").textContent())
          .toContain(String(i).padStart(4, "0"));
      }
      const active = page.locator(".expanded-article.is-active");
      expect(
        await active.evaluate((element) => element.getBoundingClientRect().top),
      ).toBeGreaterThanOrEqual(0);
      expect(await page.locator(".virtual-article-row").count()).toBeLessThan(25);
      const id = Number(await active.locator("..").getAttribute("data-article-id"));
      await page.keyboard.press("s");
      await expect.poll(() => database.articles.getArticle(1, id)?.isStarred).toBe(true);
      await page.keyboard.press("u");
      await expect.poll(() => database.articles.getArticle(1, id)?.isRead).toBe(false);
      await page.keyboard.press("k");
      await page.keyboard.press("j");
      await expect
        .poll(() =>
          page
            .locator(".expanded-article.is-active .star-state-action")
            .getAttribute("aria-pressed"),
        )
        .toBe("true");
    } finally {
      await page.close();
    }
  }, 20_000);

  it("returns to the unselected magazine top after keyboard navigation past a loaded page", async () => {
    const page = await open("magazine");
    try {
      await bottom(page);
      await settle(page);
      const row = page
        .locator(".virtual-article-row")
        .filter({ hasText: "Virtualization backlog 0099" });
      await row.locator(".article-open-button").click();
      for (const title of ["0100", "0101", "0102"]) {
        await page.keyboard.press("j");
        await expect
          .poll(() => page.locator(".article-swipe-layer.is-active h2").textContent(), {
            timeout: 5000,
          })
          .toContain(title);
      }
      await page.locator('.reading-workspace[aria-busy="false"]').waitFor();
      await page.getByRole("button", { name: "Back to articles", exact: true }).click();
      await page.locator(".article-list").waitFor();
      await settle(page);
      expect(await page.locator(".article-list-item.is-active").count()).toBe(0);
      expect(await surface(page).evaluate((element) => element.scrollTop)).toBe(0);
      expect(await page.locator(".virtual-article-row").first().textContent()).toContain("0000");
      expect(await page.locator(".virtual-article-row").count()).toBeLessThan(25);
    } finally {
      await page.close();
    }
  }, 30_000);

  it("keeps native and embedded players alive while scrolling away and back", async () => {
    const page = await open("expanded");
    try {
      const video = page.locator(".article-content video").first();
      const handle = await video.elementHandle();
      await video.evaluate(async (element: HTMLVideoElement) => {
        element.muted = true;
        await element.play();
      });
      await expect
        .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
        .toBeGreaterThan(0);
      const start = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
      await page.locator(".article-media-player iframe").click();
      const frameElement = await page.locator(".article-media-player iframe").elementHandle();
      const frame = await frameElement?.contentFrame();
      if (!frame) throw new Error("Missing embedded player");
      await frame.locator("video").evaluate(async (element: HTMLVideoElement) => {
        element.muted = true;
        await element.play();
      });
      await expect
        .poll(() =>
          frame.locator("video").evaluate((element: HTMLVideoElement) => element.currentTime),
        )
        .toBeGreaterThan(0);
      await surface(page).evaluate((element) => {
        element.scrollTop = 14000;
      });
      await settle(page);
      expect(
        await handle?.evaluate((element: HTMLVideoElement) => ({
          connected: element.isConnected,
          paused: element.paused,
          playing: element.currentTime > 0,
        })),
      ).toEqual({ connected: true, paused: false, playing: true });
      expect(await frameElement?.evaluate((element) => element.isConnected)).toBe(true);
      const timeAway = await frame
        .locator("video")
        .evaluate((element: HTMLVideoElement) => element.currentTime);
      await surface(page).evaluate((element) => {
        element.scrollTop = 0;
      });
      await settle(page);
      expect(
        await video.evaluate((element: HTMLVideoElement) => element.currentTime),
      ).toBeGreaterThan(start);
      expect(
        await frame.locator("video").evaluate((element: HTMLVideoElement) => element.currentTime),
      ).toBeGreaterThan(timeAway);
      expect(await page.locator(".virtual-article-row").count()).toBeLessThan(25);
    } finally {
      await page.close();
    }
  });

  it("holds the visible paragraph steady when a delayed image above it loads", async () => {
    holdImage = true;
    const page = await open("expanded");
    try {
      const paragraph = page.locator(".article-content p").first();
      await paragraph.evaluate((element) => element.scrollIntoView({ block: "start" }));
      await settle(page);
      const before = await paragraph.evaluate((element) => element.getBoundingClientRect().top);
      releaseImage();
      holdImage = false;
      await expect
        .poll(() =>
          page
            .locator(".article-content img")
            .first()
            .evaluate((image: HTMLImageElement) => image.naturalHeight),
        )
        .toBe(600);
      await settle(page);
      const after = await paragraph.evaluate((element) => element.getBoundingClientRect().top);
      expect(Math.abs(after - before)).toBeLessThan(2);
    } finally {
      releaseImage();
      holdImage = false;
      await page.close();
    }
  });

  it("keeps a text selection attached while its article leaves and reenters the rendered range", async () => {
    const page = await open("expanded");
    try {
      const text = await page
        .locator(".article-content p")
        .first()
        .evaluate((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          window.getSelection()?.removeAllRanges();
          window.getSelection()?.addRange(range);
          return window.getSelection()?.toString();
        });
      await settle(page);
      await surface(page).evaluate((element) => {
        element.scrollTop = 9000;
      });
      await settle(page);
      expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(text);
      expect(await page.locator(".virtual-article-row").count()).toBeLessThan(25);
      await surface(page).evaluate((element) => {
        element.scrollTop = 0;
      });
      await settle(page);
      expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(text);
    } finally {
      await page.close();
    }
  });
});

async function openTouchReader(
  index = 3,
  reducedMotion: "reduce" | "no-preference" = "no-preference",
  cpuSlowdown = 1,
) {
  const touchContext = await browser.newContext({
    baseURL: origin,
    storageState: await context.storageState(),
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    reducedMotion,
  });
  const page = await touchContext.newPage();
  page.setDefaultTimeout(5000);
  await page.goto(`${origin}feeds/${backlog.feed.id}/all`);
  await page.getByRole("button", { name: "Reader options", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Magazine", exact: true }).click();
  await page.locator(".article-open-button").nth(index).click();
  await page.locator(".article-swipe-layer.is-active .article-content").waitFor();
  const session = await touchContext.newCDPSession(page);
  await session.send("Emulation.setCPUThrottlingRate", { rate: cpuSlowdown });
  const touch = async (
    type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel",
    x = 0,
    y = 450,
  ) => {
    await session.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" || type === "touchCancel" ? [] : [{ x, y, id: 1 }],
    });
  };
  const swipe = async (from: number, to: number, cancelled = false) => {
    await touch("touchStart", from);
    for (let step = 1; step <= 6; step++) {
      await touch("touchMove", from + ((to - from) * step) / 6);
      await page.waitForTimeout(16);
    }
    await touch(cancelled ? "touchCancel" : "touchEnd");
  };
  const title = () =>
    page.locator(".article-swipe-layer.is-active .article-header h2").textContent();
  const settled = async () => {
    await expect.poll(() => page.locator(".article-swipe-layer").count()).toBe(1);
    await expect
      .poll(() =>
        page
          .locator(".article-swipe-layer.is-active")
          .evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m41),
      )
      .toBe(0);
  };
  return { page, touchContext, touch, swipe, title, settled };
}

describe("reader motion with touch input and the live API", () => {
  it.each([1, 6])(
    "restores cancelled and boundary swipes, then navigates and reverses without losing a visible page (%ix CPU slowdown)",
    async (cpuSlowdown) => {
      const { page, touchContext, touch, swipe, title, settled } = await openTouchReader(
        0,
        "no-preference",
        cpuSlowdown,
      );
      try {
        const original = await title();
        await swipe(320, 130, true);
        await settled();
        expect(await title()).toBe(original);
        await swipe(100, 280);
        await settled();
        expect(await title()).toBe(original);
        await swipe(320, 130);
        await expect.poll(title).toContain("0001");
        await touch("touchStart", 110);
        // A finger resting on an entering page must not discard its visible neighbour.
        const pages = await page.locator(".article-swipe-layer").evaluateAll((elements) =>
          elements.map((element) => {
            const rect = element.getBoundingClientRect();
            return { left: rect.left, right: rect.right };
          }),
        );
        const [outgoing, incoming] = pages.sort((a, b) => a.left - b.left);
        if (!outgoing || !incoming) throw new Error("A visible article disappeared during entry");
        expect(Math.abs(outgoing.right - incoming.left)).toBeLessThan(1);
        for (const x of [140, 170, 200, 230, 260]) {
          await touch("touchMove", x);
          await page.waitForTimeout(16);
        }
        await touch("touchEnd");
        await expect.poll(title).toBe(original);
        await settled();
      } finally {
        await touchContext.close();
      }
    },
  );

  it("accepts repeated navigation and a keyboard interruption, with actions applying to the visible article", async () => {
    const { page, touchContext, swipe, title, settled } = await openTouchReader();
    try {
      await swipe(320, 140);
      await expect.poll(title).toContain("0004");
      await swipe(320, 140);
      await expect.poll(title).toContain("0005");
      await page.keyboard.press("j");
      await expect.poll(title).toContain("0006");
      await settled();
      await page.keyboard.press("s");
      await expect.poll(() => database.articles.getArticle(1, 7)?.isStarred).toBe(true);
      await page.keyboard.press("k");
      await expect.poll(title).toContain("0005");
    } finally {
      await touchContext.close();
    }
  });

  it("keeps reduced-motion swipes stationary and preserves vertical scrolling and selected text", async () => {
    const { page, touchContext, touch, swipe, title, settled } = await openTouchReader(8, "reduce");
    try {
      const original = await title();
      await touch("touchStart", 200, 680);
      for (const y of [630, 580, 530, 480, 430, 380]) {
        await touch("touchMove", 200, y);
        await page.waitForTimeout(16);
      }
      await touch("touchEnd");
      await expect
        .poll(() =>
          page.locator(".article-swipe-layer.is-active").evaluate((element) => element.scrollTop),
        )
        .toBeGreaterThan(0);
      expect(await title()).toBe(original);
      await touch("touchStart", 320);
      await touch("touchMove", 230);
      await page.waitForTimeout(32);
      expect(
        await page
          .locator(".article-swipe-layer.is-active")
          .evaluate((element) => getComputedStyle(element).transform),
      ).toBe("none");
      await touch("touchCancel");
      await settled();
      const selected = await page
        .locator(".article-swipe-layer.is-active .article-content p")
        .first()
        .evaluate((element) => {
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(element);
          selection?.removeAllRanges();
          selection?.addRange(range);
          return selection?.toString();
        });
      expect(selected?.length).toBeGreaterThan(0);
      await swipe(320, 120);
      expect(await title()).toBe(original);
      await page.evaluate(() => window.getSelection()?.removeAllRanges());
      await swipe(320, 120);
      await expect.poll(title).toContain("0009");
      await settled();
    } finally {
      await touchContext.close();
    }
  });

  it("closes dialogs during entry and restores usable keyboard controls on each reopening", async () => {
    const page = await open("magazine");
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        await page
          .getByRole("button", { name: "Open keyboard shortcut reference (?)", exact: true })
          .click();
        await page.getByRole("button", { name: "Close shortcuts", exact: true }).waitFor();
        await page
          .getByRole("button", { name: "Close shortcuts", exact: true })
          .click({ force: true });
        await page.locator(".shortcut-dialog").waitFor({ state: "detached" });
      }
      await page.keyboard.press("?");
      await page.getByRole("heading", { name: "Keyboard shortcuts", exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await page.locator(".shortcut-dialog").waitFor({ state: "detached" });
      await page.keyboard.press("j");
      await expect
        .poll(() => page.locator(".article-swipe-layer.is-active h2").textContent())
        .toContain("0000");
      expect(await page.locator(".dialog-backdrop").count()).toBe(0);
    } finally {
      await page.close();
    }
  });
});

it("swipes across an article image without opening it and still opens the image on a tap", async () => {
  const { page, touchContext, touch, title, settled } = await openTouchReader(0);
  try {
    const image = page.locator("[data-image-lightbox-trigger]").first();
    await image.scrollIntoViewIfNeeded();
    const bounds = await image.boundingBox();
    if (!bounds) throw new Error("Expected a visible article image");
    const y = Math.min(700, bounds.y + bounds.height / 2);
    await touch("touchStart", 300, y);
    for (const x of [270, 240, 210, 180, 150]) {
      await touch("touchMove", x, y);
      await page.waitForTimeout(16);
    }
    await touch("touchEnd");
    await expect.poll(title).toContain("0001");
    await settled();
    expect(await page.locator(".image-lightbox").count()).toBe(0);
    await page.keyboard.press("k");
    await expect.poll(title).toContain("0000");
    await image.tap();
    await page.locator(".image-lightbox").waitFor();
    await page.keyboard.press("Escape");
    await page.locator(".image-lightbox").waitFor({ state: "detached" });
  } finally {
    await touchContext.close();
  }
});

it("interrupts a summary entrance with keyboard toggles without stale text or shifted reading content", async () => {
  const id = 4;
  const { revision } = database.connection
    .prepare("SELECT content_revision AS revision FROM articles WHERE id = ?")
    .get(id) as { revision: number };
  database.ai.saveArticleAiSummary(1, id, revision, {
    promptVersion: 1,
    promptId: null,
    sourceKind: "feed",
    provider: "openai",
    model: "saved-summary",
    text: "A cached summary for repeated opening.",
    usage: { inputTokens: 20, outputTokens: 20 },
  });
  const { page, touchContext } = await openTouchReader(3);
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.getByRole("button", { name: "Choose an AI action", exact: true }).click();
      await page.getByRole("menuitem", { name: "Summarize", exact: true }).click();
      await page.getByText("A cached summary for repeated opening.", { exact: true }).waitFor();
      await page.keyboard.press("m");
      await page.locator(".article-ai-summary").waitFor({ state: "detached" });
      await page.keyboard.press("m");
      await page.getByText("A cached summary for repeated opening.", { exact: true }).waitFor();
      await page.keyboard.press("m");
      await page.locator(".article-ai-summary").waitFor({ state: "detached" });
    }
    expect(
      await page.locator(".article-reading-flow").evaluate(async (element) => {
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        return getComputedStyle(element).transform;
      }),
    ).toBe("none");
    expect(await page.locator(".summary-action").getAttribute("aria-pressed")).toBe("false");
  } finally {
    await touchContext.close();
  }
});
