import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { AppDatabase } from "../../src/server/database.js";
import { AuthService } from "../../src/server/features/auth/service.js";
import { ExtractionQueue } from "../../src/server/features/extraction/queue.js";
import { WebFeedService } from "../../src/server/features/feeds/web/service.js";
import { FeedRefreshService } from "../../src/server/features/refresh/service.js";
import { DefaultFeedSourceLoader } from "../../src/server/feed-source-loader.js";
import { createApplicationServices } from "../../src/server/runtime/application-runtime.js";
import {
  DEFAULT_SERVER_POLICY,
  DESKTOP_POLICY,
  registrationAccountCap,
  registrationMode,
  serverPolicy,
} from "../../src/server/service-policy.js";
import { completeFeedRefresh } from "../helpers/feeds.js";

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("service policy", () => {
  it("defaults to bounded server settings and closed registration", () => {
    expect(serverPolicy({})).toEqual(DEFAULT_SERVER_POLICY);
    expect(registrationMode()).toBe("closed");
    expect(registrationAccountCap(undefined)).toBe(0);
    expect(registrationAccountCap("invalid")).toBe(0);
    expect(registrationAccountCap("0")).toBe(0);
    expect(registrationAccountCap("20")).toBe(20);
  });

  it.each(["closed", "invite", "open"])(
    "keeps the account cap independent of %s registration",
    async (mode) => {
      const database = new AppDatabase(":memory:", 20, serverPolicy({}));
      try {
        const auth = new AuthService(database.auth, 20, {
          registrationMode: registrationMode(mode),
          maxAccounts: registrationAccountCap("1"),
        });
        expect(auth.registrationAvailable()).toBe(mode !== "closed");
      } finally {
        database.close();
      }
    },
  );

  it("configures every server limit independently", () => {
    const policy = serverPolicy({
      FEEDFOLD_MANUAL_REFRESH: "true",
      FEEDFOLD_ACCOUNT_ACTIVITY_WINDOW_DAYS: "30",
      FEEDFOLD_MAX_FEEDS_PER_ACCOUNT: "12",
      FEEDFOLD_MAX_WEB_FEEDS_PER_ACCOUNT: "2",
      FEEDFOLD_MAX_PENDING_REFRESHES: "50",
    });
    expect(policy).toEqual({
      ...DEFAULT_SERVER_POLICY,
      manualRefresh: true,
      accountActivityWindowDays: 30,
      maxFeedsPerAccount: 12,
      maxWebFeedsPerAccount: 2,
      maxPendingRefreshes: 50,
    });
    expect(serverPolicy({ FEEDFOLD_MAX_FEEDS_PER_ACCOUNT: "unlimited" })).toEqual({
      ...DEFAULT_SERVER_POLICY,
      maxFeedsPerAccount: null,
    });
  });

  it.each(["0", "-1", "1.5", "", "no", "Infinity"])("rejects invalid limit %j", (value) => {
    expect(() => serverPolicy({ FEEDFOLD_MAX_FEEDS_PER_ACCOUNT: value })).toThrow(
      "positive integer or unlimited",
    );
    expect(() => serverPolicy({ FEEDFOLD_QUOTA_CHROMIUM_CONCURRENT: value })).toThrow(
      "positive integer or unlimited",
    );
  });

  it.each(
    Object.keys(DEFAULT_SERVER_POLICY.quotas) as Array<keyof typeof DEFAULT_SERVER_POLICY.quotas>,
  )("configures or removes the %s quota independently", (key) => {
    const name = `FEEDFOLD_QUOTA_${key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`;
    for (const [value, expected] of [
      ["17", 17],
      ["unlimited", null],
    ] as const) {
      expect(serverPolicy({ [name]: value })).toEqual({
        ...DEFAULT_SERVER_POLICY,
        quotas: { ...DEFAULT_SERVER_POLICY.quotas, [key]: expected },
      });
    }
  });

  it.each(["7", "30", "unlimited"])(
    "schedules old subscriptions using a %s day activity window",
    (days) => {
      const database = new AppDatabase(
        ":memory:",
        20,
        serverPolicy({ FEEDFOLD_ACCOUNT_ACTIVITY_WINDOW_DAYS: days }),
      );
      try {
        const feed = database.feeds.createFeed(1, { feedUrl: "https://example.test/activity.xml" });
        database.connection
          .prepare("UPDATE users SET last_active_at = '2026-08-20T00:00:00.000Z' WHERE id = 1")
          .run();
        database.connection
          .prepare("UPDATE feed_sources SET next_poll_at = '2026-08-01T00:00:00.000Z'")
          .run();
        expect(database.feeds.getDueFeedIds("2026-09-01T00:00:00.000Z")).toEqual(
          days === "7" ? [] : [feed.id],
        );
      } finally {
        database.close();
      }
    },
  );

  it.each(["2", "unlimited"])("enforces a configured feed limit of %s", (limit) => {
    const database = new AppDatabase(
      ":memory:",
      20,
      serverPolicy({ FEEDFOLD_MAX_FEEDS_PER_ACCOUNT: limit }),
    );
    try {
      for (let i = 0; i < 2; i++)
        database.feeds.createFeed(1, { feedUrl: `https://example.test/${i}.xml` });
      const subscribe = () =>
        database.feeds.createFeed(1, { feedUrl: "https://example.test/third.xml" });
      if (limit === "2") expect(subscribe).toThrow("up to 2 feeds");
      else expect(subscribe().id).toBeGreaterThan(0);
    } finally {
      database.close();
    }
  });

  it("removes a daily quota without disabling other server limits", () => {
    const database = new AppDatabase(
      ":memory:",
      20,
      serverPolicy({ FEEDFOLD_QUOTA_FEED_DISCOVERIES_PER_DAY: "unlimited" }),
    );
    try {
      for (let i = 0; i < 101; i++) database.quotas.consume("feed_discovery", 1);
      expect(database.bootstrap.getBootstrap(1).capabilities.manualRefresh).toBe(false);
    } finally {
      database.close();
    }
  });

  it("rejects ambiguous manual refresh settings", () => {
    expect(() => serverPolicy({ FEEDFOLD_MANUAL_REFRESH: "yes" })).toThrow("true or false");
  });

  it("keeps inactive desktop subscriptions scheduled", () => {
    const database = new AppDatabase(":memory:", 20, DESKTOP_POLICY);
    try {
      const feed = database.feeds.createFeed(1, {
        feedUrl: "https://publisher.example.test/private.xml",
      });
      database.connection
        .prepare("UPDATE users SET last_active_at = '2000-01-01T00:00:00.000Z' WHERE id = 1")
        .run();
      database.connection
        .prepare(
          `UPDATE feed_sources SET next_poll_at = '2000-01-01T00:00:00.000Z'
           WHERE id = (SELECT source_id FROM feeds WHERE id = ?)`,
        )
        .run(feed.id);

      expect(database.feeds.getDueFeedIds("2026-09-01T00:00:00.000Z")).toEqual([feed.id]);
      expect(database.bootstrap.getBootstrap(1).capabilities.manualRefresh).toBe(true);
    } finally {
      database.close();
    }
  });

  it("disables the default server manual refresh API and capability", async () => {
    const database = new AppDatabase(":memory:", 20, DEFAULT_SERVER_POLICY);
    const auth = new AuthService(database.auth, 20, { maxAccounts: 100, registrationMode: "open" });
    const extraction = new ExtractionQueue(database.extractions, 1, 1_000);
    let requests = 0;
    const refresh = new FeedRefreshService(
      database.feeds,
      new DefaultFeedSourceLoader(
        (task) => database.feeds.runOutbound(task),
        1_000,
        undefined,
        async () => {
          requests += 1;
          return new Response(null, { status: 304 });
        },
      ),
      1,
    );
    const app = await createApp({
      ...createApplicationServices({
        credentialCipher: null,
        database,
        extractionQueue: extraction,
        refreshService: refresh,
      }),
      authService: auth,
    });
    cleanups.push(async () => {
      await app.close();
      await Promise.all([refresh.stop(), extraction.stop()]);
      database.close();
    });

    const registration = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "public-reader", password: "reader-password" },
    });
    const setCookie = registration.headers["set-cookie"];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(";", 1)[0];
    if (!cookie) throw new Error("Registration did not return a session cookie");

    const bootstrap = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: { cookie },
    });
    expect(bootstrap.json().capabilities).toEqual({ manualRefresh: false });
    const registeredUser = database.auth.findEnabledUser("public-reader");
    if (!registeredUser) throw new Error("Registration did not create an account");
    const feed = database.feeds.createFeed(registeredUser.id, {
      feedUrl: "https://publisher.example.test/paused.xml",
      paused: true,
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/refresh",
      headers: { cookie },
      payload: {},
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "Manual refresh is unavailable." });
    const perFeedResponse = await app.inject({
      method: "POST",
      url: `/api/feeds/${feed.id}/refresh`,
      headers: { cookie },
      payload: {},
    });
    expect(perFeedResponse.statusCode).toBe(403);
    expect(perFeedResponse.json()).toEqual({ error: "Manual refresh is unavailable." });
    expect(requests).toBe(0);
  });

  it("returns clear API errors when discovery and web analysis daily quotas are exhausted", async () => {
    const database = new AppDatabase(
      ":memory:",
      20,
      serverPolicy({
        FEEDFOLD_QUOTA_FEED_DISCOVERIES_PER_DAY: "1",
        FEEDFOLD_QUOTA_WEB_ANALYSES_PER_DAY: "1",
      }),
    );
    const auth = new AuthService(database.auth, 20, { registrationMode: "open" });
    const extraction = new ExtractionQueue(database.extractions, 1, 1_000);
    const refresh = new FeedRefreshService(
      database.feeds,
      new DefaultFeedSourceLoader((task) => database.feeds.runOutbound(task), 1_000),
      1,
    );
    const webFeeds = new WebFeedService({ quotas: database.quotas });
    const app = await createApp({
      ...createApplicationServices({
        credentialCipher: null,
        database,
        extractionQueue: extraction,
        refreshService: refresh,
        webFeedService: webFeeds,
      }),
      authService: auth,
    });
    cleanups.push(async () => {
      await app.close();
      await Promise.all([refresh.stop(), extraction.stop(), webFeeds.close()]);
      database.close();
    });
    const registration = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "quota-reader", password: "reader-password" },
    });
    const cookie = String(registration.headers["set-cookie"]).split(";", 1)[0];

    const requestTwice = async (url: string) => {
      const first = await app.inject({
        method: "POST",
        url,
        headers: { cookie },
        payload: { url: "http://127.0.0.1/private" },
      });
      expect(first.statusCode).toBe(422);
      return app.inject({
        method: "POST",
        url,
        headers: { cookie },
        payload: { url: "http://127.0.0.1/private" },
      });
    };
    const discovery = await requestTwice("/api/feeds/discover");
    expect(discovery.statusCode).toBe(429);
    expect(discovery.json()).toEqual({
      error: "This account has reached today's feed discovery limit. Try again tomorrow.",
      code: "quota_exceeded",
    });
    const analysis = await requestTwice("/api/web-feeds/analyze");
    expect(analysis.statusCode).toBe(429);
    expect(analysis.json()).toEqual({
      error: "This account has reached today's web-page analysis limit. Try again tomorrow.",
      code: "quota_exceeded",
    });
  });

  it("never queues a paused feed from a configured user-facing refresh API", async () => {
    const database = new AppDatabase(
      ":memory:",
      20,
      serverPolicy({ FEEDFOLD_MANUAL_REFRESH: "true" }),
    );
    const auth = new AuthService(database.auth);
    const extraction = new ExtractionQueue(database.extractions, 1, 1_000);
    let requests = 0;
    const refresh = new FeedRefreshService(
      database.feeds,
      new DefaultFeedSourceLoader(
        (task) => database.feeds.runOutbound(task),
        1_000,
        undefined,
        async () => {
          requests += 1;
          return new Response(null, { status: 304 });
        },
      ),
      1,
    );
    const app = await createApp({
      ...createApplicationServices({
        credentialCipher: null,
        database,
        extractionQueue: extraction,
        refreshService: refresh,
      }),
      authService: auth,
    });
    cleanups.push(async () => {
      await app.close();
      await Promise.all([refresh.stop(), extraction.stop()]);
      database.close();
    });
    const registration = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "private-reader", password: "reader-password" },
    });
    const cookie = String(registration.headers["set-cookie"]).split(";", 1)[0];
    const registeredUser = database.auth.findEnabledUser("private-reader");
    if (!registeredUser) throw new Error("Registration did not create an account");
    for (const initialFeed of database.feeds.listFeeds(registeredUser.id)) {
      database.feeds.deleteFeed(registeredUser.id, initialFeed.id);
    }
    const feed = database.feeds.createFeed(registeredUser.id, {
      feedUrl: "https://publisher.example.test/paused-private.xml",
      paused: true,
    });

    const explicit = await app.inject({
      method: "POST",
      url: `/api/feeds/${feed.id}/refresh`,
      headers: { cookie },
      payload: {},
    });
    expect(explicit.statusCode).toBe(400);
    expect(explicit.json()).toEqual({ error: "Resume paused feeds before refreshing them." });
    const all = await app.inject({
      method: "POST",
      url: "/api/refresh",
      headers: { cookie },
      payload: {},
    });
    expect(all.statusCode).toBe(200);
    expect(all.json()).toEqual({ requested: 0, refreshingFeedIds: [] });
    expect(requests).toBe(0);
  });

  it("limits server accounts to 300 feeds while desktop stays unrestricted", () => {
    const serverDatabase = new AppDatabase(":memory:", 20, DEFAULT_SERVER_POLICY);
    const desktopDatabase = new AppDatabase(":memory:");
    try {
      for (let index = 0; index < 300; index += 1) {
        serverDatabase.feeds.createFeed(1, {
          feedUrl: `https://publisher.example.test/public-${index}.xml`,
        });
        desktopDatabase.feeds.createFeed(1, {
          feedUrl: `https://publisher.example.test/private-${index}.xml`,
        });
      }
      expect(() =>
        serverDatabase.feeds.createFeed(1, {
          feedUrl: "https://publisher.example.test/public-over-limit.xml",
        }),
      ).toThrow("This account can subscribe to up to 300 feeds.");
      expect(() =>
        serverDatabase.feeds.createWebFeed(1, {
          title: "Web over limit",
          pageUrl: "https://publisher.example.test/releases",
          folderId: null,
          config: {
            pageUrl: "https://publisher.example.test/releases",
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
          parsed: {
            title: "Releases",
            siteUrl: null,
            articles: [
              {
                externalId: "one",
                title: "One",
                url: "https://publisher.example.test/releases/one",
                author: null,
                publishedAt: null,
                summary: "",
                imageUrl: null,
                feedContentHtml: null,
              },
            ],
          },
        }),
      ).toThrow("This account can subscribe to up to 300 feeds.");

      expect(
        desktopDatabase.feeds.createFeed(1, {
          feedUrl: "https://publisher.example.test/private-300.xml",
        }).id,
      ).toBeGreaterThan(0);
    } finally {
      serverDatabase.close();
      desktopDatabase.close();
    }
  });

  it("bounds the configured refresh queue", async () => {
    const database = new AppDatabase(
      ":memory:",
      20,
      serverPolicy({
        FEEDFOLD_MAX_FEEDS_PER_ACCOUNT: "unlimited",
        FEEDFOLD_MAX_PENDING_REFRESHES: "2",
      }),
    );
    let requests = 0;
    const refresh = new FeedRefreshService(
      database.feeds,
      new DefaultFeedSourceLoader(
        (task) => database.feeds.runOutbound(task),
        1_000,
        undefined,
        async () => {
          requests += 1;
          return new Response(null, { status: 304 });
        },
      ),
      1,
    );
    try {
      const feedIds = Array.from(
        { length: 3 },
        (_, index) =>
          database.feeds.createFeed(1, {
            feedUrl: `https://publisher.example.test/queue-${index}.xml`,
          }).id,
      );
      expect(refresh.requestScheduled(feedIds)).toMatchObject({ requested: 2 });
      await refresh.waitForIdle();
      expect(requests).toBe(2);
      expect(
        database.connection
          .prepare("SELECT COUNT(*) FROM feed_sources WHERE refreshing = 1")
          .pluck()
          .get(),
      ).toBe(0);
    } finally {
      await refresh.stop();
      database.close();
    }
  });

  it("shares durable daily and concurrency quotas across server instances", async () => {
    const directory = mkdtempSync(join(tmpdir(), "feedfold-quotas-"));
    const path = join(directory, "feedfold.db");
    const policy = serverPolicy({
      FEEDFOLD_QUOTA_FEED_DISCOVERIES_PER_DAY: "1",
      FEEDFOLD_QUOTA_CHROMIUM_CONCURRENT: "1",
      FEEDFOLD_QUOTA_OUTBOUND_REQUESTS_PER_DAY: "1",
    });
    const first = new AppDatabase(path, 20, policy);
    const second = new AppDatabase(path, 20, policy);
    cleanups.push(() => rmSync(directory, { force: true, recursive: true }));
    cleanups.push(() => first.close());
    cleanups.push(() => second.close());

    first.quotas.consume("feed_discovery", 1);
    expect(() => second.quotas.consume("feed_discovery", 1)).toThrow(
      "This account has reached today's feed discovery limit",
    );
    await expect(first.quotas.runOutbound(async () => "sent")).resolves.toBe("sent");
    await expect(second.quotas.runOutbound(async () => "blocked")).rejects.toThrow(
      "today's outbound request limit",
    );

    let finishFirst: (() => void) | undefined;
    const held = first.quotas.runChromium(
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    await expect(second.quotas.runChromium(async () => undefined)).rejects.toThrow(
      "already analyzing other web pages",
    );
    finishFirst?.();
    await held;
    await expect(second.quotas.runChromium(async () => "available")).resolves.toBe("available");
  });

  it("waits for outbound capacity across server instances and cancels without spending quota", async () => {
    const directory = mkdtempSync(join(tmpdir(), "feedfold-outbound-"));
    const policy = serverPolicy({
      FEEDFOLD_QUOTA_OUTBOUND_REQUESTS_CONCURRENT: "1",
      FEEDFOLD_QUOTA_OUTBOUND_REQUESTS_PER_DAY: "2",
    });
    const first = new AppDatabase(join(directory, "feedfold.db"), 20, policy);
    const second = new AppDatabase(join(directory, "feedfold.db"), 20, policy);
    cleanups.push(() => rmSync(directory, { force: true, recursive: true }));
    cleanups.push(() => first.close());
    cleanups.push(() => second.close());
    const releaseFirst = await first.quotas.startOutboundRequest();
    const cancelled = new AbortController();
    const waiting = second.quotas.startOutboundRequest(cancelled.signal);
    const rejection = expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    cancelled.abort();
    await rejection;

    let started = false;
    const next = second.quotas.startOutboundRequest().then((release) => {
      started = true;
      return release;
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(started).toBe(false);
    releaseFirst();
    const releaseNext = await next;
    expect(started).toBe(true);
    releaseNext();
    await expect(first.quotas.startOutboundRequest()).rejects.toThrow(
      "today's outbound request limit",
    );
    expect(first.connection.prepare("SELECT COUNT(*) FROM quota_leases").pluck().get()).toBe(0);
  });

  it("rejects oversized OPML and too many imported feeds before storing anything", () => {
    const database = new AppDatabase(
      ":memory:",
      20,
      serverPolicy({
        FEEDFOLD_QUOTA_OPML_UPLOAD_BYTES: "1000",
        FEEDFOLD_QUOTA_OPML_FEEDS_PER_IMPORT: "1",
      }),
    );
    try {
      const twoFeeds = `<?xml version="1.0"?><opml version="2.0"><body>
        <outline text="One" xmlUrl="https://example.test/one.xml"/>
        <outline text="Two" xmlUrl="https://example.test/two.xml"/>
      </body></opml>`;
      expect(() => database.opml.import(1, twoFeeds)).toThrow(
        "An OPML file can import up to 1 feed.",
      );
      expect(database.feeds.listFeeds(1)).toHaveLength(0);

      const oversized = `<?xml version="1.0"?><opml version="2.0"><body>
        <outline text="${"x".repeat(1_000)}" xmlUrl="https://example.test/one.xml"/>
      </body></opml>`;
      expect(() => database.opml.import(1, oversized)).toThrow(
        "larger than the 1,000 bytes upload limit",
      );
      expect(database.feeds.listFeeds(1)).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it("keeps a shared source healthy when an account storage quota blocks its delivery", () => {
    const database = new AppDatabase(
      ":memory:",
      20,
      serverPolicy({ FEEDFOLD_QUOTA_ARTICLES_PER_ACCOUNT: "1" }),
    );
    try {
      const feed = database.feeds.createFeed(1, {
        feedUrl: "https://publisher.example.test/quota.xml",
      });
      expect(
        completeFeedRefresh(database.feeds, feed.id, {
          httpStatus: 200,
          etag: null,
          lastModified: null,
          parsed: {
            title: "Quota feed",
            siteUrl: "https://publisher.example.test/",
            articles: ["one", "two"].map((externalId) => ({
              externalId,
              title: externalId,
              url: `https://publisher.example.test/${externalId}`,
              author: null,
              publishedAt: null,
              summary: "",
              imageUrl: null,
              feedContentHtml: null,
            })),
          },
        }),
      ).toBe(true);
      expect(database.connection.prepare("SELECT COUNT(*) FROM articles").pluck().get()).toBe(2);
      expect(database.connection.prepare("SELECT COUNT(*) FROM feed_articles").pluck().get()).toBe(
        0,
      );
      expect(database.feeds.getFeed(1, feed.id)).toMatchObject({ healthStatus: "healthy" });

      // A publisher's 304 can still retry an earlier delivery blocked by the quota.
      expect(
        completeFeedRefresh(database.feeds, feed.id, {
          httpStatus: 304,
          etag: null,
          lastModified: null,
        }),
      ).toBe(true);
      expect(database.connection.prepare("SELECT COUNT(*) FROM feed_articles").pluck().get()).toBe(
        0,
      );
    } finally {
      database.close();
    }
  });

  it("enforces account bytes, registered accounts, and global storage limits", async () => {
    const storageDatabase = new AppDatabase(
      ":memory:",
      20,
      serverPolicy({ FEEDFOLD_QUOTA_STORED_BYTES_PER_ACCOUNT: "20" }),
    );
    try {
      const feed = storageDatabase.feeds.createFeed(1, {
        feedUrl: "https://publisher.example.test/bytes.xml",
      });
      expect(
        completeFeedRefresh(storageDatabase.feeds, feed.id, {
          httpStatus: 200,
          etag: null,
          lastModified: null,
          parsed: {
            title: "Large",
            siteUrl: null,
            articles: [
              {
                externalId: "large",
                title: "A stored article",
                url: "https://publisher.example.test/large",
                author: null,
                publishedAt: null,
                summary: "content that exceeds the configured account storage quota",
                imageUrl: null,
                feedContentHtml: null,
              },
            ],
          },
        }),
      ).toBe(true);
      expect(
        storageDatabase.connection.prepare("SELECT COUNT(*) FROM articles").pluck().get(),
      ).toBe(1);
      expect(
        storageDatabase.connection.prepare("SELECT COUNT(*) FROM feed_articles").pluck().get(),
      ).toBe(0);
    } finally {
      storageDatabase.close();
    }

    const accountDatabase = new AppDatabase(
      ":memory:",
      20,
      serverPolicy({ FEEDFOLD_QUOTA_REGISTERED_ACCOUNTS: "1" }),
    );
    try {
      const auth = new AuthService(accountDatabase.auth, 20, {
        maxAccounts: 2,
        registrationMode: "open",
      });
      await expect(auth.register("first-account", "reader-password")).resolves.toBeTruthy();
      await expect(auth.register("second-account", "reader-password")).rejects.toThrow(
        "not accepting more accounts",
      );
    } finally {
      accountDatabase.close();
    }

    const fullDatabase = new AppDatabase(
      ":memory:",
      20,
      serverPolicy({ FEEDFOLD_QUOTA_GLOBAL_STORED_BYTES: "1" }),
    );
    try {
      expect(() => fullDatabase.quotas.assertGlobalStorage()).toThrow(
        "server has reached its storage limit",
      );
    } finally {
      fullDatabase.close();
    }
  });
});
