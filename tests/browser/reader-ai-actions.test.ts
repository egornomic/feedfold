import { mkdtemp, rm } from "node:fs/promises";
import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import react from "@vitejs/plugin-react";
import { type Browser, type BrowserContext, chromium, type Page } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { AppDatabase } from "../../src/server/database.js";
import { createAiProviders } from "../../src/server/features/ai/providers.js";
import { AiService } from "../../src/server/features/ai/service.js";
import { AuthService } from "../../src/server/features/auth/service.js";
import { createApplicationServices } from "../../src/server/runtime/application-runtime.js";
import { seedReaderBacklog } from "../helpers/reader-backlog.js";

let directory: string;
let database: AppDatabase;
let provider: Server;
let app: Awaited<ReturnType<typeof createApp>>;
let vite: ViteDevServer;
let browser: Browser;
let context: BrowserContext;
let origin: string;
let backlog: ReturnType<typeof seedReaderBacklog>;
const providerDelays = new Map<string, number>();

function providerTask(system: string): string {
  return system.split("Task:\n")[1]?.split("\n")[0] ?? "";
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "feedfold-ai-actions-"));
  database = new AppDatabase(join(directory, "feedfold.db"));
  provider = createHttpServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", async () => {
      const { instructions } = JSON.parse(body) as { instructions: string };
      const task = providerTask(instructions);
      const name = task.startsWith("Fact-check")
        ? "Fact-check"
        : task.startsWith("Summarize")
          ? "Summary"
          : task;
      await new Promise((resolve) => setTimeout(resolve, providerDelays.get(name) ?? 300));
      const text = `${name} result`;
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          status: "completed",
          output: [
            { type: "message", role: "assistant", content: [{ type: "output_text", text }] },
          ],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const providerUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;
  app = await createApp({
    ...createApplicationServices({
      credentialCipher: null,
      database,
      aiService: new AiService(database, {
        credentialCipher: null,
        providers: createAiProviders({ openai: providerUrl }),
      }),
    }),
    authService: new AuthService(database.auth, 20, { registrationMode: "open" }),
  });
  const apiOrigin = await app.listen({ host: "127.0.0.1", port: 0 });
  vite = await createServer({
    configFile: false,
    plugins: [react()],
    cacheDir: join(directory, "vite"),
    server: { host: "127.0.0.1", port: 0, proxy: { "/api": { target: apiOrigin } } },
  });
  await vite.listen();
  origin = vite.resolvedUrls?.local[0] ?? "";
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 900 } });
  const registered = await context.request.post("/api/auth/register", {
    data: { username: "ai-reader", password: "reader-password" },
  });
  expect(registered.status()).toBe(201);
  backlog = seedReaderBacklog(database, "AI actions", 20);
  database.settings.updateSettings(1, {
    singleKeyShortcuts: true,
    customPrompts: [
      { id: "11111111-1111-4111-8111-111111111111", name: "Fact-check", prompt: "Fact-check it." },
      { id: "22222222-2222-4222-8222-222222222222", name: "Key ideas", prompt: "Key ideas." },
    ],
  });
  const feature = await context.request.patch("/api/ai/features/article_summary", {
    data: { provider: "openai", model: "test-model" },
  });
  expect(feature.status()).toBe(200);
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  await page.goto(`${origin}settings/ai`);
  await page.locator("#ai-api-key").fill("test-key");
  await page.getByRole("button", { name: "Save key", exact: true }).click();
  await page.getByText("API key saved", { exact: false }).waitFor();
  await page.close();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await vite?.close();
  await app?.close();
  await new Promise((resolve) => provider?.close(resolve));
  database?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
}, 30_000);

async function openArticle(index: number): Promise<Page> {
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  await page.goto(`${origin}feeds/${backlog.feed.id}/all`);
  await page.getByRole("button", { name: "Magazine view", exact: true }).click();
  const title = `AI actions ${String(index).padStart(4, "0")}`;
  await page.getByRole("button", { name: `Open ${title}`, exact: true }).click();
  await page.locator(".article-swipe-layer.is-active h2", { hasText: title }).waitFor();
  return page;
}

async function runAction(page: Page, name: string) {
  await page.getByRole("button", { name: "Choose an AI action", exact: true }).first().click();
  await page.getByRole("menuitem", { name }).click();
}

function panel(page: Page) {
  return page.locator(".article-swipe-layer.is-active .article-ai-summary");
}

async function shownResult(page: Page) {
  return {
    heading: await panel(page).locator("h3").textContent(),
    text: await panel(page).locator(".article-summary-text").textContent(),
  };
}

async function reloadArticle(page: Page, id: number) {
  const reloaded = page.waitForResponse((response) =>
    response.url().endsWith(`/api/articles/${id}`),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await reloaded;
  await page.evaluate(() => new Promise(requestAnimationFrame));
}

it("keeps a fact-check result after the article reloads", async () => {
  const page = await openArticle(1);
  try {
    await runAction(page, "Summarize");
    await panel(page).getByText("Summary result").waitFor();
    await runAction(page, "Fact-check");
    await panel(page).getByText("Fact-check result").waitFor();
    await reloadArticle(page, 2);
    expect(await shownResult(page)).toEqual({
      heading: "Fact-check",
      text: "Fact-check result",
    });
  } finally {
    await page.close();
  }
}, 30_000);

it("keeps the summary chosen again after another action replaced the saved result", async () => {
  const page = await openArticle(2);
  try {
    await runAction(page, "Summarize");
    await panel(page).getByText("Summary result").waitFor();
    await runAction(page, "Key ideas");
    await panel(page).getByText("Key ideas. result").waitFor();
    await runAction(page, "Summarize");
    await panel(page).getByText("Summary result").waitFor();
    await reloadArticle(page, 3);
    expect(await shownResult(page)).toEqual({ heading: "Summary", text: "Summary result" });
  } finally {
    await page.close();
  }
}, 30_000);

it("switches to another action while the first one is still running", async () => {
  providerDelays.set("Summary", 1500);
  const page = await openArticle(3);
  try {
    await runAction(page, "Summarize");
    await panel(page).getByText("Generating summary").waitFor();
    await runAction(page, "Fact-check");
    await panel(page).getByText("Running Fact-check").waitFor();
    await panel(page).getByText("Fact-check result").waitFor();
    // The slower summary finishes after the fact-check and must not take its place.
    await page.waitForResponse((response) => response.url().endsWith("/api/articles/4/summary"));
    await page.evaluate(() => new Promise(requestAnimationFrame));
    expect(await shownResult(page)).toEqual({
      heading: "Fact-check",
      text: "Fact-check result",
    });
    await runAction(page, "Summarize");
    await panel(page).getByText("Summary result").waitFor();
    expect(await panel(page).locator("h3").textContent()).toBe("Summary");
  } finally {
    providerDelays.clear();
    await page.close();
  }
}, 30_000);
