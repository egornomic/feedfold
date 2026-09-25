import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, assert, describe, expect, it } from "vitest";
import { type ApiRuntime, createApiClient } from "../../src/client/api/api-client.js";
import { ApiError } from "../../src/client/api/api-contract.js";
import { createApp } from "../../src/server/app.js";
import { ApplicationApi, type ApplicationApiServices } from "../../src/server/application-api.js";
import { applicationError } from "../../src/server/application-error.js";
import { AuthService } from "../../src/server/features/auth/service.js";
import {
  type ApplicationRuntimeOptions,
  createApplicationRuntime,
} from "../../src/server/runtime/application-runtime.js";
import { runtimeConfiguration } from "../../src/server/runtime/configuration.js";
import { DESKTOP_POLICY } from "../../src/server/service-policy.js";
import type { ApiInput, ApiOperation, ApiOutput } from "../../src/shared/api/operations.js";
import type { ArticlePage, BootstrapData, Folder, Rule } from "../../src/shared/types.js";
import { completeFeedRefresh } from "../helpers/feeds.js";

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function applicationServices(
  options: Partial<ApplicationRuntimeOptions> = {},
): ApplicationApiServices {
  const runtime = createApplicationRuntime({
    servicePolicy: DESKTOP_POLICY,
    databasePath: ":memory:",
    configuration: runtimeConfiguration({
      FEED_FETCH_TIMEOUT_MS: "1000",
      ARTICLE_FETCH_TIMEOUT_MS: "1000",
      WEB_FEED_LOAD_TIMEOUT_MS: "4000",
    }),
    credentialCipher: null,
    ...options,
  });
  cleanups.push(() => runtime.close());
  return runtime.services;
}

async function transportClient(transport: "web" | "desktop", services: ApplicationApiServices) {
  const database = services.database;
  const application = new ApplicationApi(services);
  const app = await createApp({ ...services, authService: new AuthService(database.auth) });
  cleanups.push(() => app.close());
  const registration = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { username: "contract-reader", password: "reader-password" },
  });
  expect(registration.statusCode).toBe(201);
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  const setCookie = registration.headers["set-cookie"];
  const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(";", 1)[0];
  const request: ApiRuntime["request"] = async <K extends ApiOperation>(
    operation: K,
    payload: ApiInput<K>,
    path: string,
    init?: RequestInit,
  ) => {
    if (transport === "desktop") {
      try {
        return (await application.invoke({ operation, payload })) as ApiOutput<K>;
      } catch (error) {
        const known = applicationError(error);
        if (known) throw new ApiError(known.message, known.status, known.code);
        throw error;
      }
    }
    const response = await fetch(origin + path, {
      ...init,
      headers: {
        cookie: cookie ?? "",
        ...(init?.body ? { "content-type": "application/json" } : {}),
      },
    });
    if (!response.ok) {
      const error = (await response.json()) as { error: string; code?: string };
      throw new ApiError(error.error, response.status, error.code);
    }
    return response.status === 204
      ? (undefined as ApiOutput<K>)
      : (response.json() as Promise<ApiOutput<K>>);
  };
  return createApiClient({
    request,
    subscribeReaderDataInvalidations: () => () => {},
    exportOpml: async () => {},
  });
}

describe("local application API", () => {
  it("preserves omitted folder fields, rejects undefined edits, and clears an explicit parent", async () => {
    const services = applicationServices();
    const application = new ApplicationApi(services);
    const parent = (await application.invoke({
      operation: "createFolder",
      payload: { name: "Reading" },
    })) as Folder;
    const child = (await application.invoke({
      operation: "createFolder",
      payload: { name: "News", parentId: parent.id },
    })) as Folder;

    await expect(
      application.invoke({
        operation: "updateFolder",
        payload: { id: child.id, input: { name: "Daily" } },
      }),
    ).resolves.toMatchObject({ name: "Daily", parentId: parent.id });
    await expect(
      application.invoke({
        operation: "updateFolder",
        payload: { id: child.id, input: { name: "Invalid", parentId: undefined } },
      }),
    ).rejects.toThrow();
    expect(services.database.folders.getFolder(1, child.id)).toMatchObject({
      name: "Daily",
      parentId: parent.id,
    });
    await expect(
      application.invoke({
        operation: "updateFolder",
        payload: { id: child.id, input: { parentId: null } },
      }),
    ).resolves.toMatchObject({ name: "Daily", parentId: null });
  });

  it("publishes committed management changes and leaves failed edits silent", async () => {
    const services = applicationServices();
    const { database } = services;
    const application = new ApplicationApi(services);
    const observedNames: string[][] = [];
    services.refreshService.subscribe(1, () => {
      observedNames.push(database.folders.listFolders(1).map(({ name }) => name));
    });
    const folder = (await application.invoke({
      operation: "createFolder",
      payload: { name: "Reading" },
    })) as Folder;
    expect(observedNames).toEqual([["Reading"]]);
    await expect(
      application.invoke({
        operation: "updateFolder",
        payload: { id: folder.id, input: { parentId: folder.id } },
      }),
    ).rejects.toThrow();
    await application.invoke({ operation: "bootstrap" });
    expect(observedNames).toEqual([["Reading"]]);
    await application.invoke({
      operation: "updateFolder",
      payload: { id: folder.id, input: { name: "News" } },
    });
    await application.invoke({ operation: "deleteFolder", payload: { id: folder.id } });
    expect(observedNames).toEqual([["Reading"], ["News"], []]);
  });

  it("starts with no subscriptions and stays empty after reopening", async () => {
    const directory = await mkdtemp(join(tmpdir(), "feedfold-default-feed-"));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, "feedfold.db");
    const application = new ApplicationApi(applicationServices({ databasePath: path }));
    expect(await application.invoke({ operation: "authConfig" })).toMatchObject({
      registrationAvailable: false,
      passkeysAvailable: false,
    });
    expect(await application.invoke({ operation: "login" })).toMatchObject({
      user: { id: "local", hasPassword: false },
    });
    const bootstrap = (await application.invoke({ operation: "bootstrap" })) as BootstrapData;
    expect(bootstrap.feeds).toEqual([]);
    const restarted = new ApplicationApi(applicationServices({ databasePath: path }));
    expect(((await restarted.invoke({ operation: "bootstrap" })) as BootstrapData).feeds).toEqual(
      [],
    );
  });

  it("runs the reading workflow for one local user without an account session", async () => {
    const directory = await mkdtemp(join(tmpdir(), "feedfold-application-api-test-"));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const services = applicationServices({ databasePath: join(directory, "feedfold.db") });
    const { database } = services;
    const application = new ApplicationApi(services);

    database.connection
      .prepare("UPDATE users SET last_active_at = '2000-01-01T00:00:00.000Z' WHERE id = 1")
      .run();
    await expect(application.invoke({ operation: "session" })).resolves.toEqual({
      user: { id: "local", username: "On this Mac", hasPassword: false },
    });
    expect(
      database.connection.prepare("SELECT last_active_at FROM users WHERE id = 1").pluck().get(),
    ).not.toBe("2000-01-01T00:00:00.000Z");

    const folder = (await application.invoke({
      operation: "createFolder",
      payload: { name: "Local reading", parentId: null, sortDirection: "newest" },
    })) as Folder;
    const feed = database.feeds.createFeed(1, {
      title: "Desktop feed",
      feedUrl: "https://example.test/feed.xml",
      folderId: folder.id,
    });
    completeFeedRefresh(database.feeds, feed.id, {
      httpStatus: 200,
      etag: null,
      lastModified: null,
      parsed: {
        title: feed.title,
        siteUrl: "https://example.test/",
        articles: [
          {
            externalId: "local-story",
            title: "Local story",
            url: "https://example.test/story",
            author: "Writer",
            publishedAt: "2026-08-03T10:00:00.000Z",
            summary: "Saved on this Mac.",
            feedContentHtml: null,
            imageUrl: null,
            media: null,
          },
        ],
      },
    });

    const rule = (await application.invoke({
      operation: "createRule",
      payload: {
        name: "Read local stories",
        feedId: feed.id,
        folderId: null,
        conditions: [{ field: "title", pattern: "Local" }],
        conditionOperator: "and",
        action: "mark_read",
        enabled: true,
      },
    })) as Rule;
    expect(rule.matchedCount).toBe(1);

    const page = (await application.invoke({
      operation: "articles",
      payload: { state: "read", feedId: feed.id },
    })) as ArticlePage;
    expect(page.articles).toHaveLength(1);
    expect(page.articles[0]).toMatchObject({ title: "Local story", isRead: true });

    const bootstrap = (await application.invoke({ operation: "bootstrap" })) as BootstrapData;
    expect(bootstrap.folders).toContainEqual(folder);
    expect(bootstrap.feeds).toHaveLength(1);
    expect(bootstrap.counts.all).toBe(1);

    const opml = await application.invoke({ operation: "exportOpml" });
    expect(opml).toEqual(expect.stringContaining("https://example.test/feed.xml"));
  });

  it.each(["web", "desktop"] as const)(
    "accepts the shared reading and management inputs through %s",
    async (transport) => {
      const services = applicationServices();
      const { database } = services;
      const client = await transportClient(transport, services);

      const parent = await client.createFolder({ name: "Reading" });
      expect(parent).toMatchObject({ parentId: null, sortDirection: "newest" });
      const folder = await client.createFolder({
        name: "Updates",
        parentId: parent.id,
        position: 7,
        sortDirection: "oldest",
      });
      expect(folder).toMatchObject({ parentId: parent.id, position: 7, sortDirection: "oldest" });
      expect(await client.updateFolder(folder.id, { position: 42 })).toMatchObject({
        position: 42,
      });
      await expect(client.updateFolder(folder.id, { position: -1 })).rejects.toThrow();
      expect((await client.bootstrap()).folders.find(({ id }) => id === folder.id)?.position).toBe(
        42,
      );

      const feed = await client.createFeed({
        sourceKind: "published",
        title: "Contract feed",
        feedUrl: "https://example.test/contracts.xml",
        folderId: folder.id,
      });
      expect(feed).toMatchObject({ paused: false, folderId: folder.id });
      completeFeedRefresh(database.feeds, feed.id, {
        httpStatus: 200,
        etag: null,
        lastModified: null,
        parsed: {
          title: feed.title,
          siteUrl: null,
          articles: [
            {
              externalId: "contract-story",
              title: "Contract story",
              url: null,
              author: null,
              publishedAt: null,
              summary: "Available in both apps.",
              feedContentHtml: null,
              imageUrl: null,
            },
          ],
        },
      });
      const article = (
        await client.articles({ state: "all", feedId: feed.id, limit: 1, includeContent: true })
      ).articles[0];
      assert.isDefined(article);
      expect(article).toMatchObject({ title: "Contract story", isRead: false, isStarred: false });
      expect(await client.updateArticleState(article.id, { isStarred: true })).toMatchObject({
        isStarred: true,
      });
      await expect(client.updateArticleState(article.id, {})).rejects.toThrow();
      expect((await client.article(article.id)).isStarred).toBe(true);

      const rule = await client.createRule({
        name: "Read updates",
        feedId: feed.id,
        conditions: [{ field: "title", pattern: "Contract" }],
        conditionOperator: "and",
        action: "mark_read",
      });
      expect(rule).toMatchObject({ enabled: true, folderId: null, matchedCount: 1 });
      expect((await client.article(article.id)).isRead).toBe(true);
      await expect(client.updateRule(rule.id, { folderId: folder.id })).rejects.toThrow(
        "Choose either one feed or one folder for this rule.",
      );
      expect(await client.updateSettings({ pollIntervalMinutes: 10 })).toMatchObject({
        pollIntervalMinutes: 10,
      });
    },
  );
  it.each(["web", "desktop"] as const)(
    "subscribes to a website, repairs its selection, and rejects invalid operations through %s",
    async (transport) => {
      let updated = false;
      const source = createServer((_request, response) => {
        response.setHeader("Content-Type", "text/html");
        const titles = ["Alpha", "Beta", updated ? "Delta" : "Gamma"];
        response.end(
          `<!doctype html><title>Release updates</title><main><section aria-label="Releases">
          ${titles.map((title) => `<article><h2><a href="/${title}">${title}</a></h2><p>A release announcement.</p></article>`).join("")}
        </section></main>`,
        );
      });
      await new Promise<void>((resolve) => source.listen(0, "127.0.0.1", resolve));
      cleanups.push(
        () =>
          new Promise<void>((resolve) => {
            source.closeAllConnections();
            source.close(() => resolve());
          }),
      );
      const sourceUrl = `http://127.0.0.1:${(source.address() as AddressInfo).port}/`;
      const services = applicationServices({
        servicePolicy: {
          ...DESKTOP_POLICY,
          quotas: { ...DESKTOP_POLICY.quotas, opmlFeedsPerImport: 1 },
        },
        webFeed: { allowPrivateNetworks: true, settleQuietMs: 100, settleTimeoutMs: 2_000 },
      });
      const client = await transportClient(transport, services);
      const analysis = await client.analyzeWebPage(sourceUrl);
      const candidate = analysis.candidates.find((candidate) => candidate.articles.length === 3);
      assert.isDefined(candidate);
      const feed = await client.createFeed({
        sourceKind: "web",
        feedUrl: analysis.pageUrl,
        webConfig: candidate.config,
      });
      const titles = async () =>
        (await client.articles({ state: "all", feedId: feed.id })).articles.map(
          (article) => article.title,
        );
      expect(await titles()).toEqual(expect.arrayContaining(["Alpha", "Beta", "Gamma"]));
      expect((await client.analyzeWebFeed(feed.id)).savedSelectionMatched).toBe(true);
      updated = true;
      await client.updateWebFeedSelection(feed.id, candidate.config);
      expect(await titles()).toEqual(expect.arrayContaining(["Alpha", "Beta", "Gamma", "Delta"]));
      await expect(client.analyzeWebFeed(999_999)).rejects.toMatchObject({ status: 404 });
      await expect(client.updateWebFeedSelection(999_999, candidate.config)).rejects.toMatchObject({
        status: 404,
      });
      const published = services.database.feeds.createFeed(1, {
        title: "Published feed",
        feedUrl: "https://example.test/feed.xml",
      });
      await expect(client.analyzeWebFeed(published.id)).rejects.toMatchObject({ status: 400 });
      await expect(
        client.updateWebFeedSelection(published.id, candidate.config),
      ).rejects.toMatchObject({ status: 400 });
      await expect(client.loadFullContent(999_999)).rejects.toMatchObject({ status: 404 });
      await expect(client.telegramArticleMedia(999_999)).rejects.toMatchObject({ status: 404 });
      await expect(client.xArticleMedia(999_999, "123")).rejects.toMatchObject({ status: 404 });
      await client.updateFeed(feed.id, { paused: true });
      await expect(client.refresh([feed.id])).rejects.toMatchObject({ status: 400 });
      await client.updateFeed(feed.id, { paused: false });
      await client.refresh([feed.id]);
      await services.refreshService.waitForIdle();
      expect((await client.feed(feed.id)).healthStatus).toBe("healthy");
      const opml = (outlines: string) =>
        new File(
          [`<?xml version="1.0"?><opml version="2.0"><body>${outlines}</body></opml>`],
          "feeds.opml",
        );
      const outline = `<outline text="Published feed" xmlUrl="${published.feedUrl}"/>`;
      expect(await client.importOpml(opml(outline))).toMatchObject({
        imported: 0,
        duplicates: 1,
        failed: [],
      });
      await expect(client.importOpml(opml(outline + outline))).rejects.toMatchObject({
        status: 429,
        code: "quota_exceeded",
      });
    },
    20_000,
  );
});
