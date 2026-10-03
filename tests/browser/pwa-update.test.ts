import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import react from "@vitejs/plugin-react";
import { type Browser, type BrowserContext, chromium, type Page } from "playwright";
import { build, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppDatabase } from "../../src/server/database.js";
import { AuthService } from "../../src/server/features/auth/service.js";
import { createTestApp } from "../helpers/app.js";
import { seedReaderBacklog } from "../helpers/reader-backlog.js";

// Re-create the old client contract and its shared React root, without changing the live API.
const legacyEntry = `
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { useRegisterSW } from "virtual:pwa-register/react";
import { App } from "./app/app";
function Updates() {
  const { needRefresh: [ready], updateServiceWorker } = useRegisterSW();
  return ready ? <button onClick={() => void updateServiceWorker()}>Update</button> : null;
}
createRoot(document.getElementById("root")).render(
  <StrictMode><App /><Updates /></StrictMode>
);
`;

function previousContract(legacy = false, oldCount = true): Plugin {
  return {
    name: "previous-client-contract",
    enforce: "pre",
    transform(code, id) {
      if (legacy && id.endsWith("/src/client/main.tsx")) return legacyEntry;
      if (oldCount && id.endsWith("/features/navigation/sidebar.tsx"))
        return code
          .replace("bootstrap.counts.saved", "bootstrap.counts.starred")
          .replace("formatNumber(count)", "count.toLocaleString()");
      return null;
    },
  };
}

let directory: string;
let deployed: string;
let database: AppDatabase;
let server: Awaited<ReturnType<typeof createTestApp>>;
let browser: Browser;
let origin: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "feedfold-release-"));
  deployed = join(directory, "deployed");
  await mkdir(deployed);
  // The legacy build has the former prompt worker. The other builds use the production config.
  for (const release of ["legacy", "prompt"]) {
    await build({
      configFile: false,
      logLevel: "silent",
      define: { "import.meta.env.DEV": false, "import.meta.env.PROD": true },
      plugins: [
        previousContract(true, release === "legacy"),
        react(),
        VitePWA({
          registerType: "prompt",
          workbox: { clientsClaim: true, globPatterns: ["**/*.{js,css,html,png}"] },
        }),
      ],
      build: { outDir: join(directory, release) },
    });
  }
  for (const release of ["crashed", "current"]) {
    await build({
      logLevel: "silent",
      define: { "import.meta.env.DEV": false, "import.meta.env.PROD": true },
      plugins: release === "crashed" ? [previousContract()] : [],
      build: { outDir: join(directory, release) },
    });
  }
  // Register the assets from all releases before Fastify enumerates its static routes.
  for (const release of ["current", "crashed", "prompt", "legacy"])
    await cp(join(directory, release), deployed, { recursive: true });
  database = new AppDatabase(join(directory, "feedfold.db"));
  server = await createTestApp(
    database,
    new AuthService(database.auth, 20, { registrationMode: "open" }),
    deployed,
  );
  origin = await server.app.listen({ host: "127.0.0.1", port: 0 });
  browser = await chromium.launch({ headless: true });
  const account = await browser.newContext({ baseURL: origin });
  const response = await account.request.post("/api/auth/register", {
    data: { username: "release-reader", password: "release-reader-password" },
  });
  expect(response.status()).toBe(201);
  seedReaderBacklog(database, "Release backlog", 3);
  database.articles.updateArticleState(1, 1, { isSaved: true });
  await account.close();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
  database?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
}, 30_000);

async function deploy(release: "legacy" | "prompt" | "crashed" | "current") {
  await cp(join(directory, release), deployed, { recursive: true });
}

async function returningBrowser() {
  const context = await browser.newContext({ baseURL: origin });
  context.setDefaultTimeout(5000);
  const response = await context.request.post("/api/auth/login", {
    data: { username: "release-reader", password: "release-reader-password" },
  });
  expect(response.status()).toBe(200);
  const bootstrap = await context.request.get("/api/bootstrap");
  const { counts } = await bootstrap.json();
  expect(counts).toMatchObject({ unread: 3, saved: 1 });
  expect(counts).not.toHaveProperty("starred");
  return context;
}

async function controlled(page: Page) {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

async function expectReader(page: Page, route = "/articles/unread") {
  await page.locator(".reader-toolbar").waitFor();
  expect(new URL(page.url()).pathname).toBe(route);
  expect(await page.getByRole("button", { name: "Saved 1 g s" }).count()).toBe(1);
  expect(await page.locator(".sidebar-account").textContent()).toContain("release-reader");
}

async function detectRelease(page: Page) {
  // Trigger the same check browsers make when a controlled page is opened again.
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration())?.update();
  });
}

async function noFurtherReloads(context: BrowserContext, pages: Page[]) {
  const navigations: string[] = [];
  for (const page of pages)
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) navigations.push(page.url());
    });
  await Promise.all(pages.map(detectRelease));
  await context.request.get("/api/bootstrap");
  // Worker events are asynchronous; allow another activation/reload to become observable.
  await pages[0]?.waitForTimeout(500);
  expect(navigations).toEqual([]);
}

describe("release recovery against the current API", () => {
  it("replaces an old cached app after its crash has removed the update button", async () => {
    await deploy("legacy");
    const context = await returningBrowser();
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto("/articles/unread", { waitUntil: "domcontentloaded" });
      await controlled(page);
      await expect
        .poll(() => errors)
        .toContain("Cannot read properties of undefined (reading 'toLocaleString')");
      expect(await page.locator("#root").textContent()).toBe("");
      expect(await page.getByRole("button", { name: "Update" }).count()).toBe(0);
      const cachedScript = await page.locator('script[type="module"]').getAttribute("src");
      // The former release path installs a usable version but leaves it waiting for a lost button.
      await deploy("prompt");
      await detectRelease(page);
      await page.waitForFunction(
        async () => !!(await navigator.serviceWorker.getRegistration())?.waiting,
      );
      await page.reload();
      await expect.poll(() => errors.length).toBe(2);
      expect(await page.locator("#root").textContent()).toBe("");

      // Keep the crashed app in one tab and another reader route in a second tab.
      const other = await context.newPage();
      await other.goto("/articles/saved", { waitUntil: "domcontentloaded" });
      await controlled(other);
      await deploy("current");
      await detectRelease(page);
      await expectReader(page);
      await expectReader(other, "/articles/saved");
      expect(await page.locator('script[type="module"]').getAttribute("src")).not.toBe(
        cachedScript,
      );
      await noFurtherReloads(context, [page, other]);
    } finally {
      await context.close();
    }
  }, 20_000);

  it("keeps a recovery screen available after a render crash and loads the next release", async () => {
    await deploy("crashed");
    const context = await returningBrowser();
    const page = await context.newPage();
    try {
      await page.goto("/articles/unread", { waitUntil: "domcontentloaded" });
      await controlled(page);
      await page.getByRole("heading", { name: "feedfold is unavailable" }).waitFor();
      await page.getByRole("button", { name: "Try again" }).click();
      await page.getByRole("heading", { name: "feedfold is unavailable" }).waitFor();
      await deploy("current");
      await detectRelease(page);
      await expectReader(page);
      await noFurtherReloads(context, [page]);
    } finally {
      await context.close();
    }
  }, 20_000);

  it("opens the current homepage and reader in fresh browsers without a reload loop", async () => {
    await deploy("current");
    const anonymous = await browser.newContext({ baseURL: origin });
    anonymous.setDefaultTimeout(5000);
    const signedIn = await returningBrowser();
    try {
      const homepage = await anonymous.newPage();
      await homepage.goto("/", { waitUntil: "domcontentloaded" });
      await controlled(homepage);
      await homepage.getByRole("list", { name: "What feedfold does" }).waitFor();
      const page = await signedIn.newPage();
      await page.goto("/articles/unread", { waitUntil: "domcontentloaded" });
      await controlled(page);
      await expectReader(page);
      await page.reload();
      await expectReader(page);
      await noFurtherReloads(signedIn, [page]);
      await noFurtherReloads(anonymous, [homepage]);
    } finally {
      await anonymous.close();
      await signedIn.close();
    }
  }, 20_000);
});
