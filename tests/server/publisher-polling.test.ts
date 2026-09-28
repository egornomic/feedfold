import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppDatabase } from "../../src/server/database.js";
import { WebFeedService } from "../../src/server/features/feeds/web/service.js";
import { FeedRefreshService } from "../../src/server/features/refresh/service.js";
import { DefaultFeedSourceLoader } from "../../src/server/feed-source-loader.js";
import type { WebFeedConfig } from "../../src/shared/types.js";

const start = Date.parse("2026-09-28T12:00:00.000Z");
const minute = 60_000;
const cleanups: Array<() => void | Promise<void>> = [];
const at = (time: number) => vi.setSystemTime(time);
const rss = (hints = "") => `<rss version="2.0"><channel><title>News</title>
  <link>https://example.test</link><description>News</description>${hints}
  <item><guid>one</guid><title>One</title><pubDate>Mon, 28 Sep 2026 11:00:00 GMT</pubDate></item>
  <item><guid>two</guid><title>Two</title><pubDate>Mon, 28 Sep 2026 12:00:00 GMT</pubDate></item>
  </channel></rss>`;

async function publisher(handler: (path: string, response: ServerResponse) => void) {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? "/");
    handler(request.url ?? "/", response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests };
}

async function reader(webFeedService?: WebFeedService) {
  const directory = await mkdtemp(join(tmpdir(), "feedfold-polling-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "feedfold.db");
  let database = new AppDatabase(path, 10);
  const service = () =>
    new FeedRefreshService(
      database.feeds,
      new DefaultFeedSourceLoader(
        (task) => database.feeds.runOutbound(task),
        2_000,
        webFeedService,
        fetch,
      ),
      1,
    );
  let refresh = service();
  cleanups.push(async () => {
    await refresh.stop();
    database.close();
  });
  return {
    get database() {
      return database;
    },
    get refresh() {
      return refresh;
    },
    async restart() {
      await refresh.stop();
      database.close();
      database = new AppDatabase(path, 10);
      refresh = service();
    },
    async check(ids: number[], scheduled = false) {
      if (scheduled) refresh.requestScheduled(ids);
      else refresh.request(ids);
      await refresh.waitForIdle();
    },
  };
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("publisher-aware polling over HTTP", () => {
  it.each([
    { kind: "beyond year 9999", ttl: "4200000000" },
    { kind: "outside the Date range", ttl: String(Number.MAX_SAFE_INTEGER) },
    { kind: "overflowing during conversion to milliseconds", ttl: `1${"0".repeat(304)}` },
  ])("ingests articles and keeps normal polling for a TTL $kind", async ({ ttl }) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at(start);
    const origin = await publisher((_path, response) => response.end(rss(`<ttl>${ttl}</ttl>`)));
    const app = await reader();
    const feed = app.database.feeds.createFeed(1, { feedUrl: `${origin.origin}/feed.xml` });
    await app.check([feed.id]);
    expect(app.database.feeds.getFeed(1, feed.id)).toMatchObject({
      totalCount: 2,
      healthStatus: "healthy",
      pollIntervalMinutes: 10,
    });
    const next = Date.parse(app.database.feeds.getFeed(1, feed.id)?.nextPollAt as string);
    expect(next - start).toBeGreaterThanOrEqual(10 * minute);
    expect(next - start).toBeLessThan(20 * minute);
    await app.restart();
    at(next);
    await app.check(app.database.feeds.getDueFeedIds(), true);
    expect(origin.requests).toEqual(["/feed.xml", "/feed.xml"]);
    expect(app.database.feeds.getFeed(1, feed.id)).toMatchObject({
      totalCount: 2,
      healthStatus: "healthy",
    });
  });

  it("keeps a 10-minute feed behind its 60-minute TTL even for manual refreshes and after restart", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at(start);
    const origin = await publisher((_path, response) => response.end(rss("<ttl>60</ttl>")));
    const app = await reader();
    const feed = app.database.feeds.createFeed(1, { feedUrl: `${origin.origin}/feed.xml` });
    await app.check([feed.id]);
    expect(origin.requests).toHaveLength(1);
    expect(app.database.feeds.getFeed(1, feed.id)?.pollIntervalMinutes).toBe(10);
    expect(app.database.feeds.getFeed(1, feed.id)?.nextPollAt).toBe(
      new Date(start + 60 * minute).toISOString(),
    );
    at(start + 59 * minute);
    await app.check([feed.id]);
    expect(origin.requests).toHaveLength(1);
    await app.restart();
    await app.check([feed.id]);
    expect(origin.requests).toHaveLength(1);
    at(start + 60 * minute);
    await app.check([feed.id]);
    expect(origin.requests).toHaveLength(2);
  });

  it.each(["28800", "Mon, 28 Sep 2026 20:00:00 GMT"])(
    "persists a 503 deadline expressed as %s without affecting another feed",
    async (retryAfter) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      at(start);
      let unavailable = true;
      const origin = await publisher((path, response) => {
        if (path === "/limited" && unavailable)
          response.writeHead(503, { "Retry-After": retryAfter });
        response.end(rss());
      });
      const app = await reader();
      const limited = app.database.feeds.createFeed(1, { feedUrl: `${origin.origin}/limited` });
      const other = app.database.feeds.createFeed(1, { feedUrl: `${origin.origin}/other` });
      await app.check([limited.id, other.id]);
      expect(origin.requests).toEqual(["/limited", "/other"]);
      expect(app.database.feeds.getFeed(1, limited.id)?.nextPollAt).toBe(
        new Date(start + 480 * minute).toISOString(),
      );
      unavailable = false;
      at(start + 479 * minute);
      await app.restart();
      await app.check([limited.id]);
      expect(origin.requests).toEqual(["/limited", "/other"]);
      at(start + 480 * minute);
      await app.check([limited.id]);
      expect(origin.requests).toEqual(["/limited", "/other", "/limited"]);
    },
  );
});

describe("staggering and shared publisher restrictions", () => {
  it("spreads equal-interval sources while keeping ten-minute cadence through restart and interval changes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at(start);
    const origin = await publisher((_path, response) => response.end(rss()));
    const app = await reader();
    const feeds = Array.from({ length: 12 }, (_, index) =>
      app.database.feeds.createFeed(1, { feedUrl: `${origin.origin}/${index}.xml` }),
    );
    expect(app.database.feeds.getDueFeedIds()).toHaveLength(12);
    await app.check(
      feeds.map(({ id }) => id),
      true,
    );
    expect(origin.requests).toHaveLength(12);
    const due = () =>
      feeds.map(({ id }) => ({
        id,
        time: Date.parse(app.database.feeds.getFeed(1, id)?.nextPollAt as string),
      }));
    const initial = due();
    expect(new Set(initial.map(({ time }) => time)).size).toBe(12);
    expect(
      Math.max(...initial.map(({ time }) => time)) - Math.min(...initial.map(({ time }) => time)),
    ).toBeGreaterThan(8 * minute);
    for (const { time } of initial) {
      expect(time - start).toBeGreaterThanOrEqual(10 * minute);
      expect(time - start).toBeLessThan(20 * minute);
    }
    await app.restart();
    expect(due()).toEqual(initial);
    for (let cycle = 0; cycle < 8; cycle += 1) {
      for (const { id, time } of due().sort((a, b) => a.time - b.time)) {
        at(time + 7_000); // Scheduler/HTTP completion lateness must not cost another interval.
        await app.check([id], true);
        expect(Date.parse(app.database.feeds.getFeed(1, id)?.nextPollAt as string) - time).toBe(
          10 * minute,
        );
      }
    }
    expect(origin.requests).toHaveLength(12 * 9);
    at(start + 240 * minute);
    await app.check(
      feeds.map(({ id }) => id),
      true,
    );
    const changed = due();
    for (const [index, item] of changed.entries()) {
      expect(app.database.feeds.getFeed(1, item.id)?.pollIntervalMinutes).toBe(30);
      const original = initial[index];
      if (!original) throw new Error("Missing initial schedule");
      expect((item.time % (30 * minute)) / (30 * minute)).toBeCloseTo(
        (original.time % (10 * minute)) / (10 * minute),
        5,
      );
    }
    await app.restart();
    expect(due()).toEqual(changed);
  });

  it.each(["28800", "Mon, 28 Sep 2026 20:00:00 GMT"])(
    "shares a 429 cooldown (%s) across accounts, including requests already queued",
    async (retryAfter) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      at(start);
      let limited = true;
      const origin = await publisher((path, response) => {
        if (path === "/limited" && limited) response.writeHead(429, { "Retry-After": retryAfter });
        response.end(rss());
      });
      const independent = await publisher((_path, response) => response.end(rss()));
      const app = await reader();
      const { AuthService } = await import("../../src/server/features/auth/service.js");
      const auth = new AuthService(app.database.auth, 20, { maxAccounts: 100 });
      const second = (await auth.register("second-reader", "reader-password"))?.user;
      if (!second) throw new Error("Account was not created");
      const first = app.database.feeds.createFeed(1, { feedUrl: `${origin.origin}/limited` });
      const other = app.database.feeds.createFeed(second.id, { feedUrl: `${origin.origin}/other` });
      const unrelated = app.database.feeds.createFeed(1, { feedUrl: `${independent.origin}/news` });
      await app.check([first.id, other.id, unrelated.id]);
      expect(origin.requests).toEqual(["/limited"]);
      expect(independent.requests).toEqual(["/news"]);
      expect(app.database.feeds.getFeed(second.id, other.id)).toMatchObject({
        refreshing: false,
        lastAttemptAt: null,
      });
      limited = false;
      at(start + 479 * minute);
      await app.restart();
      await app.check([other.id]);
      expect(origin.requests).toEqual(["/limited"]);
      at(start + 480 * minute);
      await app.check([other.id]);
      expect(origin.requests).toEqual(["/limited", "/other"]);
    },
  );

  it("rechecks an outbound request after it has waited for network capacity", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at(start);
    const origin = await publisher((_path, response) => {
      response.writeHead(429, { "Retry-After": "28800" });
      response.end();
    });
    const app = await reader();
    const { serverPolicy } = await import("../../src/server/service-policy.js");
    const { QuotaService } = await import("../../src/server/quota.js");
    const quotas = new QuotaService(
      app.database.connection,
      serverPolicy({ FEEDFOLD_QUOTA_OUTBOUND_REQUESTS_CONCURRENT: "1" }),
    );
    const refresh = new FeedRefreshService(
      app.database.feeds,
      new DefaultFeedSourceLoader((task) => quotas.runOutbound(task), 2_000, undefined, fetch),
      3,
    );
    cleanups.push(() => refresh.stop());
    const feeds = ["one", "two"].map((path) =>
      app.database.feeds.createFeed(1, { feedUrl: `${origin.origin}/${path}` }),
    );
    refresh.request(feeds.map(({ id }) => id));
    await refresh.waitForIdle();
    expect(origin.requests).toEqual(["/one"]);
  });

  it("retains all RSS hints on 304 and replaces omitted hints with a new body", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at(start);
    let body = rss(
      "<ttl>60</ttl><skipHours><hour>13</hour></skipHours><skipDays><day>Tuesday</day></skipDays>",
    );
    let status = 200;
    const origin = await publisher((_path, response) => {
      response.writeHead(status, { ETag: '"v1"' });
      response.end(status === 304 ? undefined : body);
    });
    const app = await reader();
    const feed = app.database.feeds.createFeed(1, { feedUrl: `${origin.origin}/feed.xml` });
    await app.check([feed.id]);
    expect(app.database.feeds.getFeed(1, feed.id)?.nextPollAt).toBe("2026-09-28T14:00:00.000Z");
    at(start + 119 * minute);
    await app.check([feed.id]);
    expect(origin.requests).toHaveLength(1);
    at(start + 120 * minute);
    status = 304;
    await app.check([feed.id]);
    expect(origin.requests).toHaveLength(2);
    await app.restart();
    at(start + 179 * minute);
    await app.check([feed.id]);
    expect(origin.requests).toHaveLength(2);
    at(Date.parse("2026-09-29T16:00:00.000Z"));
    await app.check([feed.id]);
    expect(origin.requests).toHaveLength(2);
    at(Date.parse("2026-09-30T13:30:00.000Z"));
    await app.check([feed.id]);
    expect(origin.requests).toHaveLength(2);
    at(Date.parse("2026-09-30T14:00:00.000Z"));
    status = 200;
    body = rss();
    await app.check([feed.id]);
    expect(origin.requests).toHaveLength(3);
    at(Date.parse("2026-09-30T14:01:00.000Z"));
    await app.check([feed.id]);
    expect(origin.requests).toHaveLength(4);
    at(Date.parse("2026-10-06T13:30:00.000Z"));
    await app.check([feed.id]);
    expect(origin.requests).toHaveLength(5);
    expect(app.database.feeds.getFeed(1, feed.id)?.pollIntervalMinutes).toBe(10);
  });

  it("combines UTC days and hours across midnight", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at(Date.parse("2026-09-27T23:30:00.000Z"));
    const origin = await publisher((_path, response) =>
      response.end(
        rss(
          "<ttl>60</ttl><skipHours><hour>0</hour></skipHours><skipDays><day>Monday</day></skipDays>",
        ),
      ),
    );
    const app = await reader();
    const feed = app.database.feeds.createFeed(1, { feedUrl: `${origin.origin}/feed.xml` });
    await app.check([feed.id]);
    expect(app.database.feeds.getFeed(1, feed.id)?.nextPollAt).toBe("2026-09-29T01:00:00.000Z");
    at(Date.parse("2026-09-29T00:59:59.999Z"));
    await app.check([feed.id]);
    expect(origin.requests).toHaveLength(1);
    at(Date.parse("2026-09-29T01:00:00.000Z"));
    await app.check([feed.id]);
    expect(origin.requests).toHaveLength(2);
  });

  it.each([null, "nonsense", "-1", "1.5", "2026-09-29", "999999999999999999999"])(
    "uses ordinary failure retry for invalid or absent Retry-After: %s",
    async (header) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      at(start);
      const origin = await publisher((_path, response) => {
        response.writeHead(503, header === null ? {} : { "Retry-After": header });
        response.end();
      });
      const app = await reader();
      const feed = app.database.feeds.createFeed(1, { feedUrl: `${origin.origin}/feed.xml` });
      await app.check([feed.id]);
      expect(app.database.feeds.getFeed(1, feed.id)).toMatchObject({
        pollIntervalMinutes: 10,
        nextPollAt: new Date(start + 10 * minute).toISOString(),
        lastHttpStatus: 503,
      });
      expect(
        app.database.feeds.getDueFeedIds(new Date(start + 10 * minute - 1).toISOString()),
      ).toEqual([]);
      at(start + 10 * minute);
      await app.check(app.database.feeds.getDueFeedIds(), true);
      expect(origin.requests).toHaveLength(2);
    },
  );
});

describe("publisher policy at the actual request destination", () => {
  it("keeps each unavailable Nitter provider's deadline while loading a healthy fallback", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at(start);
    const posts = `<rss version="2.0"><channel><title>Posts</title>
      <link>https://x.com/reader</link><description>Posts</description>
      <item><guid>12345</guid><title>New post</title>
      <link>https://x.com/reader/status/12345</link></item></channel></rss>`;
    let unavailable = true;
    const primary = await publisher((_path, response) => {
      if (unavailable) response.writeHead(503, { "Retry-After": "14400" });
      response.end(posts);
    });
    const secondary = await publisher((_path, response) => {
      response.writeHead(503, { "Retry-After": "28800" }).end();
    });
    const available = await publisher((_path, response) => response.end(posts));
    vi.stubEnv("NITTER_BASE_URLS", [primary.origin, secondary.origin, available.origin].join(","));
    const app = await reader();
    const first = app.database.feeds.createFeed(1, { feedUrl: "https://x.com/reader" });
    const other = app.database.feeds.createFeed(1, { feedUrl: "https://x.com/other" });
    await app.check([first.id, other.id]);
    expect(available.requests).toHaveLength(2);
    expect(primary.requests).toHaveLength(2);
    expect(secondary.requests).toHaveLength(2);
    expect(app.database.feeds.getFeed(1, first.id)).toMatchObject({
      totalCount: 1,
      healthStatus: "healthy",
      lastHttpStatus: 200,
    });
    at(start + 239 * minute);
    await app.restart();
    await app.check([first.id]);
    expect(primary.requests).toHaveLength(2);
    expect(secondary.requests).toHaveLength(2);
    expect(available.requests).toHaveLength(3);
    unavailable = false;
    at(start + 240 * minute);
    await app.check([first.id]);
    expect(primary.requests).toHaveLength(3);
    expect(secondary.requests).toHaveLength(2);
    expect(available.requests).toHaveLength(3);
  });

  it.each(["page", "script", "iframe"])(
    "honors publisher cooldowns through a web %s's redirect chain and resumes afterward",
    async (resource) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      at(start);
      let posts = 2;
      const entries = () =>
        Array.from(
          { length: posts },
          (_, index) =>
            `<article><a href="https://example.test/${index}">Post ${index}</a></article>`,
        ).join("");
      const destination = await publisher((path, response) => {
        if (path === "/limited") {
          response.writeHead(429, { "Retry-After": "3600" }).end();
          return;
        }
        response.writeHead(200, {
          "Content-Type": resource === "page" ? "text/html" : "text/javascript",
        });
        response.end(
          resource === "page"
            ? `<title>News</title><main>${entries()}</main>`
            : `document.querySelector('main').innerHTML = ${JSON.stringify(entries())};`,
        );
      });
      let frameOrigin = "";
      const source = await publisher((path, response) => {
        if (path === "/start" && resource === "iframe") {
          response.writeHead(200, { "Content-Type": "text/html" });
          response.end(
            `<title>News</title><main>${entries()}</main><iframe src="${frameOrigin}/embedded"></iframe>`,
          );
          return;
        }
        if ((path === "/start" && resource === "script") || path === "/embedded") {
          response.writeHead(200, { "Content-Type": "text/html" });
          response.end('<title>News</title><main></main><script src="/first"></script>');
          return;
        }
        const target =
          path === "/start"
            ? "/first"
            : path === "/first"
              ? "/second"
              : `${destination.origin}/posts`;
        response.writeHead(path === "/first" ? 307 : 302, { Location: target }).end();
      });
      frameOrigin = source.origin.replace("127.0.0.1", "localhost");
      const web = new WebFeedService({
        allowPrivateNetworks: true,
        settleQuietMs: 50,
        settleTimeoutMs: 1_000,
      });
      cleanups.push(() => web.close());
      const app = await reader(web);
      const config: WebFeedConfig = {
        pageUrl: `${source.origin}/start`,
        selectors: {
          item: "main > article",
          link: "a",
          title: "a",
          date: null,
          author: null,
          summary: null,
          image: null,
        },
      };
      const initial = await web.extract(config);
      const feed = app.database.feeds.createWebFeed(1, {
        title: "News",
        pageUrl: config.pageUrl,
        folderId: null,
        config,
        parsed: initial.parsed,
      });
      expect(feed.totalCount).toBe(2);
      const limited = app.database.feeds.createFeed(1, {
        feedUrl: `${destination.origin}/limited`,
      });
      await app.check([limited.id]);
      expect(destination.requests).toEqual(["/posts", "/limited"]);
      posts = 3;
      await app.check([feed.id]);
      expect(destination.requests).toEqual(["/posts", "/limited"]);
      expect(app.database.feeds.getFeed(1, feed.id)).toMatchObject({
        totalCount: 2,
        refreshing: false,
      });
      expect(
        Date.parse(app.database.feeds.getFeed(1, feed.id)?.nextPollAt as string),
      ).toBeGreaterThanOrEqual(start + 60 * minute);
      at(start + 60 * minute);
      await app.check([feed.id]);
      expect(destination.requests).toEqual(["/posts", "/limited", "/posts"]);
      expect(app.database.feeds.getFeed(1, feed.id)).toMatchObject({
        totalCount: 3,
        healthStatus: "healthy",
      });
    },
  );

  it("checks redirected origins and keeps a different origin available", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at(start);
    let limited = true;
    const destination = await publisher((_path, response) => {
      if (limited) response.writeHead(429, { "Retry-After": "28800" });
      response.end(rss());
    });
    const source = await publisher((path, response) => {
      if (path !== "/local")
        response.writeHead(302, { Location: `${destination.origin}/feed.xml` });
      response.end(rss());
    });
    const app = await reader();
    const redirect = app.database.feeds.createFeed(1, { feedUrl: `${source.origin}/redirect` });
    const anotherRedirect = app.database.feeds.createFeed(1, {
      feedUrl: `${source.origin}/another`,
    });
    const local = app.database.feeds.createFeed(1, { feedUrl: `${source.origin}/local` });
    const direct = app.database.feeds.createFeed(1, { feedUrl: `${destination.origin}/other` });
    await app.check([redirect.id, anotherRedirect.id, local.id, direct.id]);
    expect(source.requests).toEqual(["/redirect", "/another", "/local"]);
    expect(destination.requests).toEqual(["/feed.xml"]);
    expect(app.database.feeds.getFeed(1, redirect.id)?.nextPollAt).toBe("2026-09-28T20:00:00.000Z");
    await app.restart();
    await app.check([direct.id]);
    expect(destination.requests).toHaveLength(1);
    at(start + 480 * minute);
    limited = false;
    await app.check([direct.id]);
    expect(destination.requests).toEqual(["/feed.xml", "/other"]);
  });

  it("stops a WordPress fallback when its origin requests a cooldown", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at(start);
    const origin = await publisher((_path, response) => {
      response.writeHead(429, { "Retry-After": "3600", "cf-mitigated": "challenge" });
      response.end();
    });
    const app = await reader();
    const feed = app.database.feeds.createFeed(1, { feedUrl: `${origin.origin}/feed` });
    await app.check([feed.id]);
    expect(origin.requests).toEqual(["/feed"]);
    expect(app.database.feeds.getFeed(1, feed.id)?.lastHttpStatus).toBe(429);
    expect(app.database.feeds.getFeed(1, feed.id)?.nextPollAt).toBe("2026-09-28T13:00:00.000Z");
  });

  it("persists a retry deadline returned by the WordPress fallback", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at(start);
    const origin = await publisher((path, response) => {
      response.writeHead(
        path === "/feed" ? 415 : 503,
        path === "/feed" ? {} : { "Retry-After": "28800" },
      );
      response.end();
    });
    const app = await reader();
    const feed = app.database.feeds.createFeed(1, { feedUrl: `${origin.origin}/feed` });
    await app.check([feed.id]);
    expect(origin.requests).toHaveLength(2);
    expect(origin.requests[1]).toContain("/wp-json/wp/v2/posts?");
    expect(app.database.feeds.getFeed(1, feed.id)?.lastHttpStatus).toBe(503);
    expect(app.database.feeds.getFeed(1, feed.id)?.nextPollAt).toBe("2026-09-28T20:00:00.000Z");
    await app.restart();
    at(start + 479 * minute);
    await app.check([feed.id]);
    expect(origin.requests).toHaveLength(2);
  });

  it("skips cooled Nitter providers for other X feeds while trying available origins", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at(start);
    let limited = true;
    const primary = await publisher((_path, response) => {
      response.writeHead(403).end();
    });
    const fallback = await publisher((_path, response) => {
      if (limited) response.writeHead(429, { "Retry-After": "28800" });
      response.end(rss().replace(/<item>[\s\S]*<\/item>/, ""));
    });
    const available = await publisher((_path, response) =>
      response.end(rss().replace(/<item>[\s\S]*<\/item>/, "")),
    );
    vi.stubEnv("NITTER_BASE_URLS", [primary.origin, fallback.origin, available.origin].join(","));
    const app = await reader();
    const one = app.database.feeds.createFeed(1, { feedUrl: "https://x.com/first" });
    const two = app.database.feeds.createFeed(1, { feedUrl: "https://x.com/second" });
    await app.check([one.id, two.id]);
    expect(primary.requests).toHaveLength(2);
    expect(fallback.requests).toHaveLength(1);
    expect(available.requests).toHaveLength(2);
    expect(app.database.feeds.getFeed(1, two.id)?.healthStatus).toBe("healthy");
    await app.restart();
    await app.check([one.id]);
    expect(fallback.requests).toHaveLength(1);
    expect(available.requests).toHaveLength(3);
    limited = false;
    at(start + 480 * minute);
    await app.check([one.id]);
    expect(fallback.requests).toHaveLength(2);
    expect(available.requests).toHaveLength(3);
  });

  it.each([
    `<skipHours>${Array.from({ length: 24 }, (_, hour) => `<hour>${hour}</hour>`).join("")}</skipHours>`,
    "<skipDays><day>Monday</day><day>Tuesday</day><day>Wednesday</day><day>Thursday</day><day>Friday</day><day>Saturday</day><day>Sunday</day></skipDays>",
  ])("does not poll a feed with no allowed UTC window", async (hints) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at(start);
    const origin = await publisher((_path, response) => response.end(rss(hints)));
    const app = await reader();
    const feed = app.database.feeds.createFeed(1, { feedUrl: `${origin.origin}/feed.xml` });
    await app.check([feed.id]);
    at(start + 8 * 24 * 60 * minute);
    await app.restart();
    await app.check([feed.id]);
    expect(origin.requests).toHaveLength(1);
    expect(app.database.feeds.getDueFeedIds()).toEqual([]);
  });
});

describe("polling lifecycle", () => {
  it("finishes safely when active and queued feeds are deleted", async () => {
    const arrived = Promise.withResolvers<void>();
    const complete = Promise.withResolvers<void>();
    const origin = await publisher((_path, response) => {
      arrived.resolve();
      void complete.promise.then(() => response.end(rss()));
    });
    const app = await reader();
    const first = app.database.feeds.createFeed(1, { feedUrl: `${origin.origin}/first` });
    const queued = app.database.feeds.createFeed(1, { feedUrl: `${origin.origin}/queued` });
    app.refresh.request([first.id, queued.id]);
    await arrived.promise;
    app.database.feeds.deleteFeed(1, first.id);
    app.database.feeds.deleteFeed(1, queued.id);
    complete.resolve();
    await app.refresh.waitForIdle();
    expect(origin.requests).toEqual(["/first"]);
    expect(app.database.feeds.listFeeds(1)).toEqual([]);
  });
});

it("checks a WordPress fallback against a cooldown received during its initial request", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at(start);
  const release = Promise.withResolvers<void>();
  const origin = await publisher((path, response) => {
    if (path === "/feed") {
      void release.promise.then(() => response.writeHead(415).end());
    } else {
      response.writeHead(429, { "Retry-After": "28800" }).end();
    }
  });
  const app = await reader();
  const refresh = new FeedRefreshService(
    app.database.feeds,
    new DefaultFeedSourceLoader(
      (task) => app.database.feeds.runOutbound(task),
      2_000,
      undefined,
      fetch,
    ),
    2,
  );
  cleanups.push(() => refresh.stop());
  const wordpress = app.database.feeds.createFeed(1, { feedUrl: `${origin.origin}/feed` });
  const limited = app.database.feeds.createFeed(1, { feedUrl: `${origin.origin}/limited` });
  refresh.request([wordpress.id, limited.id]);
  await vi.waitFor(() =>
    expect(app.database.feeds.getFeed(1, limited.id)?.lastHttpStatus).toBe(429),
  );
  release.resolve();
  await refresh.waitForIdle();
  expect(origin.requests).toEqual(["/feed", "/limited"]);
  const deadline = app.database.feeds.getFeed(1, limited.id)?.nextPollAt as string;
  expect(Date.parse(deadline)).toBeGreaterThanOrEqual(start + 480 * minute);
  expect(app.database.feeds.getFeed(1, wordpress.id)?.nextPollAt).toBe(deadline);
});
