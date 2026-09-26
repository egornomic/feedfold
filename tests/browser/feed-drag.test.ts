import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import react from "@vitejs/plugin-react";
import { type Browser, type BrowserContext, chromium, type Locator, type Page } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppDatabase } from "../../src/server/database.js";
import { AuthService } from "../../src/server/features/auth/service.js";
import type { BootstrapData, Feed, Folder } from "../../src/shared/types.js";
import { createTestApp } from "../helpers/app.js";

type Input = "mouse" | "touch" | "keyboard";
type Surface = "sidebar" | "folders";
let browser: Browser;
let vite: ViteDevServer;
let server: Awaited<ReturnType<typeof createTestApp>>;
let database: AppDatabase;
let directory: string;
let origin: string;
let account = 0;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "feedfold-drag-"));
  database = new AppDatabase(join(directory, "test.db"));
  server = await createTestApp(
    database,
    new AuthService(database.auth, 20, {
      maxAccounts: 100,
      registrationMode: "open",
      rateLimits: { registrationPerIp: { attempts: 100, windowMs: 60_000 } },
    }),
  );
  const apiOrigin = await server.app.listen({ host: "127.0.0.1", port: 0 });
  vite = await createServer({
    configFile: false,
    plugins: [react(), VitePWA()],
    cacheDir: join(directory, "vite-cache"),
    server: { host: "127.0.0.1", port: 0, proxy: { "/api": { target: apiOrigin } } },
  });
  await vite.listen();
  origin = vite.resolvedUrls?.local[0] ?? "";
  browser = await chromium.launch({ headless: true });
}, 30_000);

afterAll(async () => {
  await browser?.close();
  await vite?.close();
  await server?.close();
  database?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function setup(surface: Surface, touch: boolean) {
  const context = await browser.newContext({
    baseURL: origin,
    viewport: touch ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    hasTouch: touch,
    isMobile: touch,
  });
  const registration = await context.request.post("/api/auth/register", {
    data: { username: `drag-reader-${++account}`, password: "reader-password" },
  });
  expect(registration.status()).toBe(201);
  const folder = async (name: string, parentId: number | null = null): Promise<Folder> => {
    const response = await context.request.post("/api/folders", { data: { name, parentId } });
    expect(response.status()).toBe(200);
    return response.json();
  };
  const first = await folder("First");
  const second = await folder("Second");
  const nested = await folder("Nested", second.id);
  const response = await context.request.post("/api/feeds", {
    data: {
      sourceKind: "published",
      title: "Daily news",
      feedUrl: `https://example.test/${account}/feed.xml`,
      paused: true,
    },
  });
  expect(response.ok()).toBe(true);
  const feed: Feed = await response.json();
  const page = await context.newPage();
  page.setDefaultTimeout(5_000);
  page.on("pageerror", (error) => console.error(error.message));
  await page.goto(surface === "sidebar" ? "/articles/unread" : "/feeds");
  if (surface === "folders") {
    await page.getByRole("tab", { name: /^Folders/ }).click();
    await page.getByRole("button", { name: "Expand Top level", exact: true }).click();
  } else if (touch) {
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  }
  const scope = page.locator(surface === "sidebar" ? ".sidebar" : ".folder-management-list");
  const source = () =>
    scope.locator(surface === "sidebar" ? ".feed-nav-item" : ".folder-feed-drag-region");
  const target = (destination: Folder | null) =>
    destination
      ? surface === "sidebar"
        ? scope.locator(`[data-management-folder-id="${destination.id}"]`)
        : scope.getByRole("group", {
            name: `${destination === nested ? "Second / " : ""}${destination.name} folder`,
            exact: true,
          })
      : scope.locator(
          surface === "sidebar" ? ".sidebar-top-level-drop" : ".folder-management-row.is-top-level",
        );
  return { context, page, scope, source, target, feed, first, second, nested };
}

async function location(context: BrowserContext, feed: Feed) {
  const response = await context.request.get("/api/bootstrap");
  const data: BootstrapData = await response.json();
  return data.feeds.find((item) => item.id === feed.id)?.folderId;
}

async function point(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Drag surface is not visible");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function drag(page: Page, source: Locator, target: Locator, input: Input, cancel = false) {
  await source.scrollIntoViewIfNeeded();
  const from = await point(source);
  const to = await point(target);
  if (input === "keyboard") {
    await source.focus();
    await page.keyboard.press("Space");
    // The sensor moves 20 CSS pixels per arrow press.
    for (const [distance, positive, negative] of [
      [to.x - from.x, "ArrowRight", "ArrowLeft"],
      [to.y - from.y, "ArrowDown", "ArrowUp"],
    ] as const) {
      for (let step = 0; step < Math.round(Math.abs(distance) / 20); step++) {
        await page.keyboard.press(distance > 0 ? positive : negative);
        await page.waitForTimeout(20);
      }
    }
    await page.keyboard.press(cancel ? "Escape" : "Space");
  } else if (input === "touch") {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ ...from, id: 1 }],
    });
    await page.waitForTimeout(300);
    for (let step = 1; step <= 10; step++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: from.x + ((to.x - from.x) * step) / 10,
            y: from.y + ((to.y - from.y) * step) / 10,
            id: 1,
          },
        ],
      });
    }
    await page.waitForTimeout(100);
    await cdp.send("Input.dispatchTouchEvent", {
      type: cancel ? "touchCancel" : "touchEnd",
      touchPoints: [],
    });
    await cdp.detach();
  } else {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    if (cancel) await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
    await page.mouse.up();
  }
  await page.locator("[data-dnd-dragging]").waitFor({ state: "detached" });
}

for (const surface of ["sidebar", "folders"] as const) {
  describe(`${surface} feed moves`, () => {
    it("keeps the feed in place after a rejected move and allows a subsequent move", async () => {
      const { context, page, source, target, feed, first, second } = await setup(surface, false);
      try {
        await page.route(
          `**/api/feeds/${feed.id}`,
          async (route) => {
            // The folder disappears after the drop, before the move reaches the real API.
            const deleted = await context.request.delete(`/api/folders/${first.id}`);
            expect(deleted.ok()).toBe(true);
            await route.continue();
          },
          { times: 1 },
        );
        const rejection = page.waitForResponse(
          (response) =>
            response.request().method() === "PATCH" &&
            response.url().endsWith(`/api/feeds/${feed.id}`),
        );
        await drag(page, source(), target(first), "mouse");
        expect((await rejection).status()).toBe(400);
        expect(await location(context, feed)).toBeNull();
        await expect.poll(() => page.getByText(/Could not move Daily news/).isVisible()).toBe(true);
        await expect
          .poll(() => page.getByRole("status").allTextContents())
          .toContain("Move requested for Daily news to First.");
        await drag(page, source(), target(second), "mouse");
        await expect.poll(() => location(context, feed)).toBe(second.id);
      } finally {
        await context.close();
      }
    });

    it("preserves click, tap, and Enter actions", async () => {
      for (const input of ["mouse", "touch", "keyboard"] as const) {
        const { context, page, source, feed } = await setup(surface, input === "touch");
        try {
          if (input === "keyboard") await source().press("Enter");
          else if (input === "touch") await source().tap();
          else await source().click();
          if (surface === "sidebar")
            await expect.poll(() => page.url()).toContain(`/feeds/${feed.id}/`);
          else await expect.poll(() => page.getByRole("dialog").isVisible()).toBe(true);
          expect(await location(context, feed)).toBeNull();
        } finally {
          await context.close();
        }
      }
    });
    for (const input of ["mouse", "touch", "keyboard"] as const) {
      it(`persists moves into collapsed folders, between folders, into nested folders and to the top level with ${input}`, async () => {
        const fixture = await setup(surface, input === "touch");
        const { context, page, scope, source, target, feed, first, second, nested } = fixture;
        try {
          for (const destination of [first, second, nested, null]) {
            await drag(page, source(), target(destination), input);
            await expect.poll(() => location(context, feed)).toBe(destination?.id ?? null);
            // A successful move reveals the feed in its destination, without opening its menu.
            const destinationList =
              surface === "sidebar"
                ? destination
                  ? target(destination).locator("xpath=../..").locator(":scope > ul")
                  : scope.locator(".sidebar-scroll > .folder-tree")
                : target(destination).locator("..").locator(":scope > ul");
            const movedRow = destinationList.locator(
              surface === "sidebar"
                ? ":scope > li > .feed-tree-row > .feed-nav-item"
                : ":scope > .folder-feed-row > .folder-feed-drag-region",
            );
            await expect.poll(() => movedRow.isVisible()).toBe(true);
            await expect.poll(() => source().isVisible()).toBe(true);
            if (input === "keyboard")
              await expect
                .poll(() => source().evaluate((element) => element === document.activeElement))
                .toBe(true);
            expect(await page.getByRole("dialog").count()).toBe(0);
            expect(await scope.locator(".is-feed-drop-target").count()).toBe(0);
          }
          await page.reload();
          expect(await location(context, feed)).toBeNull();
        } finally {
          await context.close();
        }
      }, 30_000);

      it(`leaves the feed in place on cancellation, an outside drop, and a same-folder drop with ${input}`, async () => {
        const { context, page, source, target, feed, first } = await setup(
          surface,
          input === "touch",
        );
        const writes: string[] = [];
        page.on("request", (request) => {
          if (request.method() === "PATCH" && request.url().includes("/api/feeds/"))
            writes.push(request.url());
        });
        try {
          await drag(page, source(), target(first), input, true);
          await drag(page, source(), target(null), input);
          await drag(
            page,
            source(),
            page.locator(surface === "sidebar" ? ".brand" : ".folder-section-heading"),
            input,
          );
          await page.waitForTimeout(100);
          expect(await location(context, feed)).toBeNull();
          expect(writes).toEqual([]);
          expect(await page.getByRole("dialog").count()).toBe(0);
        } finally {
          await context.close();
        }
      }, 30_000);
    }
  });
}
