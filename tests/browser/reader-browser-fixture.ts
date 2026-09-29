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
import { afterAll, beforeAll, expect } from "vitest";
import { AppDatabase } from "../../src/server/database.js";
import { AuthService } from "../../src/server/features/auth/service.js";
import { createTestApp } from "../helpers/app.js";
import { seedReaderBacklog } from "../helpers/reader-backlog.js";

export const desktopAppPath = process.env.FEEDFOLD_DESKTOP_TEST_APP;
export let desktop: ElectronApplication | undefined;
let directory: string;
export let database: AppDatabase;
let server: Awaited<ReturnType<typeof createTestApp>>;
let vite: ViteDevServer;
export let browser: Browser;
export let context: BrowserContext;
export let origin: string;
export let backlog: ReturnType<typeof seedReaderBacklog>;
export let other: ReturnType<typeof seedReaderBacklog>;
export const delayedImage = { held: false, release: () => {} };

// Vitest isolates each importing file, giving every group its own API, database, and browser.
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "feedfold-virtual-"));
  database = new AppDatabase(join(directory, "feedfold.db"));
  server = await createTestApp(
    database,
    new AuthService(database.auth, 20, { registrationMode: "open" }),
  );
  server.app.get("/delayed-image.svg", async (_request, reply) => {
    if (delayedImage.held)
      await new Promise<void>((resolve) => {
        delayedImage.release = resolve;
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
  delayedImage.release();
  await desktop?.close();
  await browser?.close();
  await vite?.close();
  await server?.close();
  database?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
}, 30_000);

export async function open(mode: "magazine" | "expanded") {
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
export const surface = (page: Page) => page.locator("[data-virtuoso-scroller=true]");
export async function bottom(page: Page) {
  await surface(page).evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
}
export async function anchor(page: Page) {
  return surface(page).evaluate((element) => {
    const top = element.getBoundingClientRect().top;
    const row = [...element.querySelectorAll<HTMLElement>(".virtual-article-row")].find(
      (item) => item.getBoundingClientRect().bottom > top,
    );
    return { id: row?.dataset.articleId, top: (row?.getBoundingClientRect().top ?? top) - top };
  });
}
export async function settle(page: Page) {
  await page.waitForTimeout(150);
}
