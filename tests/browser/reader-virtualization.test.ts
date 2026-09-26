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

    it(`${mode}: restores the reading position after visiting another feed`, async () => {
      const page = await open(mode);
      try {
        await surface(page).evaluate((element) => {
          element.scrollTop = 3500;
        });
        await settle(page);
        const before = await anchor(page);
        await page
          .getByRole("button", { name: new RegExp(`Feed health: Paused ${other.feed.title}`) })
          .click();
        await page.getByRole("heading", { name: other.feed.title, exact: true }).waitFor();
        await page.goBack();
        await page.getByRole("heading", { name: backlog.feed.title, exact: true }).waitFor();
        await settle(page);
        const after = await anchor(page);
        expect(after.id).toBe(before.id);
        expect(Math.abs(after.top - before.top)).toBeLessThan(2);
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

  for (const mode of ["magazine", "expanded"] as const) {
    it(`${mode}: preserves the viewport through background delivery and rapid feed switches`, async () => {
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
      } finally {
        await page.close();
        database.connection
          .prepare("DELETE FROM articles WHERE source_id = ? AND external_id = ?")
          .run(backlog.sourceId, `new-${mode}`);
      }
    });
  }

  it("keeps the next article steady when the preceding article expands or shows an AI summary", async () => {
    const id = 4;
    database.connection
      .prepare("UPDATE articles SET content_html = ?, extraction_status = 'complete' WHERE id = ?")
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
      await page.keyboard.press("j");
      await page.keyboard.press("j");
      await page.keyboard.press("j");
      await expect
        .poll(() =>
          page.locator(".expanded-article.is-active").locator("..").getAttribute("data-article-id"),
        )
        .toBe(String(id));
      const next = page.locator(`[data-article-id="${id + 1}"]`);
      await next.evaluate((element) => element.scrollIntoView({ block: "start" }));
      await settle(page);
      const before = await next.evaluate((element) => element.getBoundingClientRect().top);
      await page.keyboard.press("m");
      await settle(page);
      expect(
        Math.abs((await next.evaluate((element) => element.getBoundingClientRect().top)) - before),
      ).toBeLessThan(2);
      await page.keyboard.press("w");
      await settle(page);
      expect(
        Math.abs((await next.evaluate((element) => element.getBoundingClientRect().top)) - before),
      ).toBeLessThan(2);
    } finally {
      await page.close();
    }
  });

  it("navigates beyond mounted rows and across page boundaries with the keyboard", async () => {
    const page = await open("expanded");
    try {
      for (let i = 1; i <= 26; i++) {
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

  it("returns to the active magazine article after keyboard navigation past a loaded page", async () => {
    const page = await open("magazine");
    try {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
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
      await page.getByRole("button", { name: "Back to articles", exact: true }).click();
      await page.locator(".article-list-item.is-active").waitFor();
      const active = page.locator(".article-list-item.is-active");
      expect(await active.textContent()).toContain("0102");
      const visible = await active.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const root = element.closest(".article-list")?.getBoundingClientRect();
        return Boolean(root && rect.bottom > root.top && rect.top < root.bottom);
      });
      expect(visible).toBe(true);
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
