import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { ApplicationApi } from "../../src/server/application-api.js";
import { AppDatabase } from "../../src/server/database.js";
import { PUBLIC_DEPLOYMENT_POLICY } from "../../src/server/deployment-policy.js";
import { AuthService } from "../../src/server/features/auth/service.js";
import { ExtractionQueue } from "../../src/server/features/extraction/queue.js";
import { WebFeedService } from "../../src/server/features/feeds/web/service.js";
import { FeedRefreshService } from "../../src/server/features/refresh/service.js";
import { DefaultFeedSourceLoader } from "../../src/server/feed-source-loader.js";
import { createApplicationServices } from "../../src/server/runtime/application-runtime.js";
import type { FeedInput } from "../../src/shared/api/inputs.js";
import type { Feed } from "../../src/shared/types.js";

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("feed subscription workflow", () => {
  it("accepts the tenth web feed over HTTP and rejects the eleventh before fetching", async () => {
    let pageLoads = 0;
    const publisher = createServer((_request, response) => {
      pageLoads += 1;
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(
        '<html><body><article><h2><a href="/story">Story</a></h2></article></body></html>',
      );
    });
    await new Promise<void>((resolve) => publisher.listen(0, "127.0.0.1", resolve));
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          publisher.closeAllConnections();
          publisher.close(() => resolve());
        }),
    );
    const origin = `http://127.0.0.1:${(publisher.address() as AddressInfo).port}`;
    const database = new AppDatabase(":memory:", 20, PUBLIC_DEPLOYMENT_POLICY);
    cleanups.push(() => database.close());
    const auth = new AuthService(database.auth, 20, { registrationMode: "open" });
    const extractionQueue = new ExtractionQueue(database.extractions, 1, 2_000);
    cleanups.push(() => extractionQueue.stop());
    const webFeedService = new WebFeedService({ allowPrivateNetworks: true, settleQuietMs: 100 });
    cleanups.push(() => webFeedService.close());
    const refreshService = new FeedRefreshService(
      database.feeds,
      new DefaultFeedSourceLoader(
        (task) => database.feeds.runOutbound(task),
        2_000,
        webFeedService,
        fetch,
      ),
    );
    cleanups.push(() => refreshService.stop());
    const app = await createApp({
      ...createApplicationServices({
        credentialCipher: null,
        database,
        extractionQueue,
        refreshService,
        webFeedService,
      }),
      authService: auth,
    });
    cleanups.push(() => app.close());
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const registration = await fetch(`${address}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "limited-reader", password: "reader-password" }),
    });
    expect(registration.status).toBe(201);
    const cookie = registration.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    const config = (index: number) => ({
      pageUrl: `${origin}/updates/${index}`,
      selectors: {
        item: "article",
        title: "h2",
        link: "a",
        date: null,
        author: null,
        summary: null,
        image: null,
      },
    });
    for (let index = 0; index < 9; index += 1) {
      database.feeds.createWebFeed(1, {
        title: "Updates",
        pageUrl: config(index).pageUrl,
        folderId: null,
        config: config(index),
        parsed: {
          title: "Updates",
          siteUrl: origin,
          articles: [
            {
              externalId: "one",
              title: "One",
              url: `${origin}/story`,
              author: null,
              publishedAt: null,
              summary: "",
              imageUrl: null,
              feedContentHtml: null,
            },
          ],
        },
      });
    }
    const subscribe = (index: number) =>
      fetch(`${address}/api/feeds`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          sourceKind: "web",
          feedUrl: config(index).pageUrl,
          webConfig: config(index),
        }),
      });
    const tenth = await subscribe(9);
    expect(tenth.status).toBe(200);
    expect(((await tenth.json()) as Feed).sourceKind).toBe("web");
    expect(pageLoads).toBeGreaterThan(0);
    const loadsAfterTenth = pageLoads;
    const eleventh = await subscribe(10);
    expect(eleventh.status).toBe(400);
    expect(await eleventh.json()).toEqual({
      error: "This account can subscribe to up to 10 web feeds.",
    });
    expect(pageLoads).toBe(loadsAfterTenth);
    expect(database.feeds.listFeeds(1).filter((feed) => feed.sourceKind === "web")).toHaveLength(
      10,
    );
  });

  it.each([
    "web",
    "desktop",
  ] as const)("delivers new and cached feeds, leaves paused feeds idle, and publishes web selections through %s", async (transport) => {
    const requestedPaths: string[] = [];
    const publisher = createServer((request, response) => {
      requestedPaths.push(request.url ?? "");
      if (request.url === "/updates") {
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end(`<html><head><title>Publisher updates</title></head><body>
            <article><h2><a href="/story">Web story</a></h2></article>
            </body></html>`);
        return;
      }
      if (request.url === "/unavailable") {
        response.writeHead(503).end("Unavailable");
        return;
      }
      response.writeHead(200, { "Content-Type": "application/rss+xml" });
      response.end(`<rss version="2.0"><channel><title>Publisher news</title>
          <item><guid>story</guid><title>Published story</title></item>
          </channel></rss>`);
    });
    await new Promise<void>((resolve) => publisher.listen(0, "127.0.0.1", resolve));
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          publisher.closeAllConnections();
          publisher.close(() => resolve());
        }),
    );
    const origin = `http://127.0.0.1:${(publisher.address() as AddressInfo).port}`;
    const database = new AppDatabase(":memory:");
    cleanups.push(() => database.close());
    const extractionQueue = new ExtractionQueue(database.extractions, 1, 2_000);
    cleanups.push(() => extractionQueue.stop());
    const webFeedService = new WebFeedService({
      allowPrivateNetworks: true,
      timeoutMs: 4_000,
      settleQuietMs: 100,
      settleTimeoutMs: 1_000,
    });
    cleanups.push(() => webFeedService.close());
    const refreshService = new FeedRefreshService(
      database.feeds,
      new DefaultFeedSourceLoader(
        (task) => database.feeds.runOutbound(task),
        2_000,
        webFeedService,
        fetch,
      ),
      1,
    );
    cleanups.push(() => refreshService.stop());
    const services = createApplicationServices({
      credentialCipher: null,
      database,
      extractionQueue,
      refreshService,
      webFeedService,
    });
    const application = new ApplicationApi(services);
    const app = await createApp({ ...services, authService: new AuthService(database.auth) });
    cleanups.push(() => app.close());
    const registration = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "subscriber", password: "reader-password" },
    });
    expect(registration.statusCode).toBe(201);
    const setCookie = registration.headers["set-cookie"];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(";", 1)[0];
    const createFeed = async (input: FeedInput): Promise<Feed> => {
      if (transport === "desktop") {
        return (await application.invoke({ operation: "createFeed", payload: input })) as Feed;
      }
      const response = await app.inject({
        method: "POST",
        url: "/api/feeds",
        headers: { cookie },
        payload: input,
      });
      if (response.statusCode !== 200) throw new Error(response.json<{ error: string }>().error);
      return response.json<Feed>();
    };

    const fresh = await createFeed({ sourceKind: "published", feedUrl: `${origin}/feed` });
    await refreshService.waitForIdle();
    expect(requestedPaths).toEqual(["/feed"]);
    expect(database.articles.listArticles(1, { feedId: fresh.id, state: "all" })).toMatchObject([
      { title: "Published story" },
    ]);

    const paused = await createFeed({
      sourceKind: "published",
      feedUrl: `${origin}/paused`,
      paused: true,
    });
    await refreshService.waitForIdle();
    expect(paused).toMatchObject({ paused: true, refreshing: false });
    expect(requestedPaths).toEqual(["/feed"]);
    expect(database.articles.listArticles(1, { feedId: paused.id, state: "all" })).toEqual([]);

    await expect(createFeed({ sourceKind: "published", feedUrl: fresh.feedUrl })).rejects.toThrow();
    expect(
      database.feeds.listFeeds(1).filter(({ feedUrl }) => feedUrl === fresh.feedUrl),
    ).toHaveLength(1);

    const otherReader = await new AuthService(database.auth, 20, { maxAccounts: 100 }).register(
      "other-reader",
      "reader-password",
    );
    if (!otherReader) throw new Error("Could not register the other reader");
    database.feeds.createFeed(otherReader.user.id, { feedUrl: fresh.feedUrl });
    database.feeds.deleteFeed(1, fresh.id);
    const cached = await createFeed({ sourceKind: "published", feedUrl: `${origin}/feed` });
    await refreshService.waitForIdle();
    expect(requestedPaths).toEqual(["/feed"]);
    expect(cached.totalCount).toBe(1);

    const pageUrl = `${origin}/updates`;
    const webInput: FeedInput = {
      sourceKind: "web",
      feedUrl: pageUrl,
      webConfig: {
        pageUrl,
        selectors: {
          item: "article",
          title: "h2",
          link: "a",
          date: null,
          author: null,
          summary: null,
          image: null,
        },
      },
    };
    const deliveredTitles: string[][] = [];
    cleanups.push(
      refreshService.subscribe(1, () => {
        deliveredTitles.push(
          database.articles.listArticles(1, { state: "all" }).map(({ title }) => title),
        );
      }),
    );
    const webFeed = await createFeed(webInput);
    expect(webFeed).toMatchObject({ title: "Publisher updates", totalCount: 1, folderId: null });
    expect(deliveredTitles).toHaveLength(1);
    expect(deliveredTitles[0]).toContain("Web story");
    expect(database.feeds.getWebFeedConfig(1, webFeed.id)).toEqual(webInput.webConfig);

    const unavailableUrl = `${origin}/unavailable`;
    await expect(
      createFeed({
        ...webInput,
        feedUrl: unavailableUrl,
        webConfig: { ...webInput.webConfig, pageUrl: unavailableUrl },
      }),
    ).rejects.toThrow();
    expect(database.feeds.listFeeds(1).some(({ feedUrl }) => feedUrl === unavailableUrl)).toBe(
      false,
    );
    expect(deliveredTitles).toHaveLength(1);
    if (transport === "web") {
      const appWithoutBrowser = await createApp({
        ...services,
        webFeedService: undefined,
        authService: new AuthService(database.auth),
      });
      cleanups.push(() => appWithoutBrowser.close());
      const response = await appWithoutBrowser.inject({
        method: "POST",
        url: "/api/feeds",
        headers: { cookie },
        payload: {
          ...webInput,
          feedUrl: unavailableUrl,
          webConfig: { ...webInput.webConfig, pageUrl: unavailableUrl },
        },
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        error: "Web feed loading is unavailable. Check the server's Chromium setup.",
      });
      expect(database.feeds.listFeeds(1).some(({ feedUrl }) => feedUrl === unavailableUrl)).toBe(
        false,
      );
    }
  });
});
