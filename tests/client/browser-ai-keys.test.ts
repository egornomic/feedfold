import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { type BrowserContext, chromium } from "playwright";
import { describe, expect, it } from "vitest";
import type * as vault from "../../src/client/ai-vault.js";
import type { api } from "../../src/client/api.js";
import { createAiProviders } from "../../src/server/ai/providers.js";
import { createApp } from "../../src/server/app.js";
import { AppDatabase } from "../../src/server/database.js";
import { ExtractionQueue } from "../../src/server/extraction.js";
import { AiService } from "../../src/server/features/ai/service.js";
import { AuthService } from "../../src/server/features/auth/service.js";
import { productionLogger } from "../../src/server/logging.js";
import { FeedRefreshService } from "../../src/server/refresh.js";

declare global {
  interface Window {
    feedfoldTest: { api: typeof api; vault: typeof vault };
  }
}

describe("browser-held AI keys", () => {
  it("automatically uses keys after restart, isolates devices, and forgets them on logout", async () => {
    const directory = await mkdtemp(join(tmpdir(), "feedfold-browser-keys-"));
    const providerKeys: string[] = [];
    const provider = createServer(async (request, response) => {
      for await (const _chunk of request) {
        /* Consume the real provider request. */
      }
      providerKeys.push(request.headers.authorization ?? "");
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                { type: "output_text", text: "An encrypted-key request reached the provider." },
              ],
            },
          ],
        }),
      );
    });
    await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
    const providerUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;
    const database = new AppDatabase(join(directory, "app.db"));
    const authService = new AuthService(database.auth, 20, { maxAccounts: 100 });
    const extractionQueue = new ExtractionQueue(database.extractions, 1, 1_000);
    const refreshService = new FeedRefreshService(database.feeds, 1, 1_000);
    let logs = "";
    const app = await createApp({
      database,
      authService,
      extractionQueue,
      refreshService,
      aiService: new AiService(database, {
        credentialCipher: null,
        providers: createAiProviders({ openai: providerUrl }),
      }),
      logger: productionLogger({
        write: (line) => {
          logs += line;
        },
      }),
    });
    const bundle = await build({
      stdin: {
        contents: `import {api} from ${JSON.stringify(resolve("src/client/api.ts"))}; import * as vault from ${JSON.stringify(resolve("src/client/ai-vault.ts"))}; window.feedfoldTest = {api, vault};`,
        resolveDir: process.cwd(),
      },
      bundle: true,
      write: false,
      format: "iife",
      define: { "import.meta.env": "{}" },
      logLevel: "silent",
    });
    app.get("/probe", (_, reply) =>
      reply.type("text/html").send('<script src="/probe.js"></script>'),
    );
    app.get("/probe.js", (_, reply) =>
      reply.type("text/javascript").send(bundle.outputFiles[0]?.text),
    );
    await app.listen({ host: "127.0.0.1", port: 0 });
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    const contexts: BrowserContext[] = [];
    const openBrowser = async (profile: string) => {
      const context = await chromium.launchPersistentContext(join(directory, profile), {
        headless: true,
      });
      contexts.push(context);
      const page = await context.newPage();
      await page.goto(`${base}/probe`);
      await page.waitForFunction(() => Boolean(window.feedfoldTest));
      return { context, page };
    };
    try {
      let first = await openBrowser("first");
      const savedBodies: string[] = [];
      first.page.on("request", (request) => {
        if (request.method() === "PUT" && request.url().endsWith("/key"))
          savedBodies.push(request.postData() ?? "");
      });
      const identity = await first.page.evaluate(async () => {
        const { api, vault } = window.feedfoldTest;
        const user = await api.register("reader", "reader-password");
        await api.saveAiProviderKey("openai", "FIRST_DEVICE_SECRET");
        await api.updateAiFeature("article_summary", { provider: "openai" });
        const device = await vault.aiDevice(user.id);
        let exportDenied = false;
        try {
          await crypto.subtle.exportKey("raw", device.key);
        } catch {
          exportDenied = true;
        }
        return { account: user.id, device: device.id, exportDenied };
      });
      expect(identity.exportDenied).toBe(true);
      expect(savedBodies).toHaveLength(1);
      expect(savedBodies[0]).not.toContain("FIRST_DEVICE_SECRET");
      expect(JSON.parse(savedBodies[0] ?? "").encryptedApiKey).toMatch(/^browser-v1\./);
      const userId = Number(
        database.connection
          .prepare("SELECT id FROM users WHERE public_id = ?")
          .pluck()
          .get(identity.account),
      );
      const stored = database.ai.getEncryptedAiCredential(userId, "openai", identity.device);
      expect(stored).toBe(JSON.parse(savedBodies[0] ?? "").encryptedApiKey);
      const feed = database.feeds.createFeed(userId, {
        title: "Test",
        feedUrl: "https://example.test/feed",
      });
      database.feeds.completeRefresh(feed.id, {
        httpStatus: 200,
        etag: null,
        lastModified: null,
        parsed: {
          title: "Test",
          siteUrl: "https://example.test",
          articles: [
            {
              externalId: "one",
              title: "Article",
              url: null,
              author: null,
              publishedAt: null,
              summary: "A useful article.",
              imageUrl: null,
              feedContentHtml: "<p>A useful article.</p>",
            },
          ],
        },
      });
      const articleId = database.articles.listArticles(userId, { state: "all" })[0]?.id as number;
      const summarize = () =>
        first.page.evaluate(
          (id) => window.feedfoldTest.api.summarizeArticle(id, null, true, "openai"),
          articleId,
        );
      expect((await summarize()).text).toContain("reached the provider");
      expect(providerKeys).toEqual(["Bearer FIRST_DEVICE_SECRET"]);
      const withoutKey = await first.page.evaluate(async (id) => {
        const response = await fetch(`/api/articles/${id}/summary`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ promptId: null, regenerate: true }),
        });
        return { status: response.status, body: await response.json() };
      }, articleId);
      expect(withoutKey).toMatchObject({ status: 422, body: { code: "AI_KEY_MISSING" } });
      expect(providerKeys).toHaveLength(1);
      const oldSave = await first.page.evaluate(async (device) => {
        const response = await fetch("/api/ai/providers/openai/key", {
          method: "PUT",
          headers: { "Content-Type": "application/json", "X-Feedfold-Device": device },
          body: JSON.stringify({ apiKey: "OLD_PLAINTEXT_REQUEST" }),
        });
        return response.status;
      }, identity.device);
      expect(oldSave).toBe(400);

      await first.context.close();
      first = await openBrowser("first");
      await first.page.evaluate(() => window.feedfoldTest.api.session());
      expect((await summarize()).text).toContain("reached the provider");
      expect(providerKeys.at(-1)).toBe("Bearer FIRST_DEVICE_SECRET");

      const second = await openBrowser("second");
      const secondState = await second.page.evaluate(async () => {
        const { api } = window.feedfoldTest;
        await api.login("reader", "reader-password");
        const before = await api.aiSettings();
        await api.saveAiProviderKey("openai", "SECOND_DEVICE_SECRET");
        return before.providers.find((provider) => provider.id === "openai")?.configured;
      });
      expect(secondState).toBe(false);
      await summarize();
      expect(providerKeys.at(-1)).toBe("Bearer FIRST_DEVICE_SECRET");
      await second.page.evaluate(
        (id) => window.feedfoldTest.api.summarizeArticle(id, null, true, "openai"),
        articleId,
      );
      expect(providerKeys.at(-1)).toBe("Bearer SECOND_DEVICE_SECRET");

      await first.page.evaluate(() => window.feedfoldTest.api.deleteAiProviderKey("openai"));
      expect(database.ai.getEncryptedAiCredential(userId, "openai", identity.device)).toBeNull();
      await expect(summarize()).rejects.toThrow("Add an API key");
      await first.page.evaluate(() =>
        window.feedfoldTest.api.saveAiProviderKey("openai", "REPLACED_DEVICE_SECRET"),
      );
      await summarize();
      expect(providerKeys.at(-1)).toBe("Bearer REPLACED_DEVICE_SECRET");

      await first.page.evaluate(() => window.feedfoldTest.api.logout());
      expect(database.ai.getEncryptedAiCredential(userId, "openai", identity.device)).toBeNull();
      const afterLogout = await first.page.evaluate(async () => {
        const { api, vault } = window.feedfoldTest;
        const user = await api.login("reader", "reader-password");
        return { device: (await vault.aiDevice(user.id)).id, settings: await api.aiSettings() };
      });
      expect(afterLogout.device).not.toBe(identity.device);
      expect(afterLogout.settings.providers.every((provider) => !provider.configured)).toBe(true);
      expect(
        (await second.page.evaluate(() => window.feedfoldTest.api.aiSettings())).providers.find(
          (provider) => provider.id === "openai",
        )?.configured,
      ).toBe(true);

      await first.page.evaluate(() =>
        window.feedfoldTest.api.saveAiProviderKey("openai", "ACCOUNT_BOUND_SECRET"),
      );
      const otherTab = await first.context.newPage();
      await otherTab.goto(`${base}/probe`);
      await otherTab.waitForFunction(() => Boolean(window.feedfoldTest));
      await otherTab.evaluate(() =>
        window.feedfoldTest.api.register("partner", "partner-password"),
      );
      await expect(summarize()).rejects.toThrow("account changed");
      expect(
        (await otherTab.evaluate(() => window.feedfoldTest.api.aiSettings())).providers.every(
          (provider) => !provider.configured,
        ),
      ).toBe(true);
      await second.page.evaluate(() => window.feedfoldTest.api.deleteAccount());
      expect(database.connection.prepare("SELECT COUNT(*) FROM ai_credentials").pluck().get()).toBe(
        0,
      );
      for (const key of [
        "FIRST_DEVICE_SECRET",
        "SECOND_DEVICE_SECRET",
        "REPLACED_DEVICE_SECRET",
        "ACCOUNT_BOUND_SECRET",
        "OLD_PLAINTEXT_REQUEST",
      ])
        expect(logs).not.toContain(key);
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
      await app.close();
      await Promise.all([refreshService.stop(), extractionQueue.stop()]);
      database.close();
      await new Promise<void>((resolve, reject) =>
        provider.close((error) => (error ? reject(error) : resolve())),
      );
      await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);
});
