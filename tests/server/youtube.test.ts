import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Sqlite from "better-sqlite3";
import { chromium } from "playwright";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { youtubeMediaFromUrl } from "../../src/server/article-media.js";
import { AppDatabase } from "../../src/server/database.js";
import { PRIVATE_DEPLOYMENT_POLICY } from "../../src/server/deployment-policy.js";
import { AuthService } from "../../src/server/features/auth/service.js";
import { FeedRefreshService } from "../../src/server/features/refresh/service.js";
import { youtubeConfiguration } from "../../src/server/features/youtube/config.js";
import { digest, YouTubeTokenCipher } from "../../src/server/features/youtube/crypto.js";
import { YouTubeService } from "../../src/server/features/youtube/service.js";
import { DefaultFeedSourceLoader } from "../../src/server/feed-source-loader.js";
import { createApplicationServices } from "../../src/server/runtime/application-runtime.js";
import { completeFeedRefresh } from "../helpers/feeds.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
const first = { id: `UC${"a".repeat(22)}`, title: "First channel" };
const second = { id: `UC${"b".repeat(22)}`, title: "Second channel" };
const third = { id: `UC${"c".repeat(22)}`, title: "Third channel" };
const url = (id: string) => `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;

describe("YouTube configuration", () => {
  it("loads local credentials or a complete secrets file without mixing their keys", () => {
    const directory = mkdtempSync(join(tmpdir(), "youtube-config-"));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const file = join(directory, "secrets.json");
    const key = randomBytes(32);
    const environment = {
      FEEDFOLD_YOUTUBE_CLIENT_ID: "local-client",
      FEEDFOLD_YOUTUBE_CLIENT_SECRET: "local-secret",
      FEEDFOLD_YOUTUBE_TOKEN_KEY: key.toString("base64"),
    };
    expect(youtubeConfiguration({}, undefined)).toBeUndefined();
    expect(youtubeConfiguration(environment, "http://localhost:45173")).toMatchObject({
      clientId: "local-client",
      clientSecret: "local-secret",
      encryptionKey: key,
      redirectUri: "http://localhost:45173/api/youtube/callback",
    });
    expect(
      youtubeConfiguration(
        { ...environment, FEEDFOLD_BASE_PATH: "/feedfold/" },
        "https://example.test",
      )?.redirectUri,
    ).toBe("https://example.test/feedfold/api/youtube/callback");
    const fileEnvironment = { ...environment, FEEDFOLD_YOUTUBE_SECRETS_FILE: file };
    writeFileSync(
      file,
      JSON.stringify({
        clientId: "public-client",
        clientSecret: "public-secret",
        tokenKey: key.toString("base64"),
      }),
    );
    expect(youtubeConfiguration(fileEnvironment, "https://feedfold.com")).toMatchObject({
      clientId: "public-client",
      clientSecret: "public-secret",
      encryptionKey: key,
      redirectUri: "https://feedfold.com/api/youtube/callback",
    });
    writeFileSync(file, JSON.stringify({ clientId: "public-client" }));
    expect(() => youtubeConfiguration(fileEnvironment, "https://feedfold.com")).toThrow();
    writeFileSync(file, '{"clientSecret":"private-value",');
    expect(() => youtubeConfiguration(fileEnvironment, "https://feedfold.com")).toThrow();
  });
});

function setup(limit: number | null = null, basePath = "") {
  const database = new AppDatabase(":memory:", 20, {
    ...PRIVATE_DEPLOYMENT_POLICY,
    maxFeedsPerAccount: limit,
  });
  cleanups.push(() => database.close());
  const key = randomBytes(32);
  const cipher = new YouTubeTokenCipher(key);
  const refresh = new FeedRefreshService(
    database.feeds,
    new DefaultFeedSourceLoader((task) => database.feeds.runOutbound(task), 1000),
  );
  const service = new YouTubeService(database, refresh, {
    clientId: "test-client",
    clientSecret: "test-secret",
    encryptionKey: key,
    redirectUri: `http://localhost:45173${basePath}/api/youtube/callback`,
  });
  const connect = (userId: number) =>
    database.connection
      .prepare(
        `INSERT INTO youtube_connections (user_id, channel_id, channel_title, refresh_token, next_sync_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        userId,
        first.id,
        first.title,
        cipher.encrypt(userId, "test-refresh-token"),
        new Date().toISOString(),
      );
  connect(1);
  return { database, service, cipher, connect };
}

describe("YouTube subscription sync", () => {
  it("hides Shorts only in the YouTube folder and reuses the rule on reconnect", () => {
    const { database, service } = setup();
    service.reconcile(1, [first]);
    const feed = database.feeds.listFeeds(1)[0];
    if (!feed) throw new Error("Missing synced feed");
    const outside = database.feeds.createFeed(1, { feedUrl: "https://example.com/feed" });
    for (const feedId of [feed.id, outside.id]) {
      completeFeedRefresh(database.feeds, feedId, {
        httpStatus: 200,
        etag: null,
        lastModified: null,
        parsed: {
          title: "Videos",
          siteUrl: null,
          articles: ["shorts/short123", "watch?v=video123"].map((path) => ({
            externalId: `${path}${feedId}`,
            title: `${path}${feedId}`,
            url: `https://www.youtube.com/${path}${feedId}`,
            author: null,
            publishedAt: null,
            summary: "",
            imageUrl: null,
            feedContentHtml: null,
            media: youtubeMediaFromUrl(`https://www.youtube.com/${path}${feedId}`),
          })),
        },
      });
    }
    expect(database.articles.listArticlePage(1, { state: "all" }).articles).toHaveLength(4);
    service.createShortsRule(1);
    service.createShortsRule(1);
    const rules = database.rules.listRules(1);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ folderId: feed.folderId, action: "hide", matchedCount: 1 });
    const visible = database.articles.listArticlePage(1, { state: "all" }).articles;
    expect(visible).toHaveLength(3);
    expect(visible.filter((article) => article.media?.type === "short")).toHaveLength(1);
    expect(visible.filter((article) => article.media?.type === "video")).toHaveLength(2);
  });

  it.each([false, true])(
    "carries the Shorts preference %s through authorization without creating a rule early",
    async (filterShorts) => {
      const { database, service } = setup();
      const auth = new AuthService(database.auth, 20);
      const session = await auth.register("shorts-reader", "test-password-long");
      if (!session) throw new Error("Registration failed");
      const authorization = new URL(service.authorize(1, session.token, filterShorts));
      const state = authorization.searchParams.get("state") as string;
      expect(service.consumeState(1, session.token, state).filterShorts).toBe(filterShorts);
      expect(database.rules.listRules(1)).toHaveLength(0);
      expect(database.folders.listFolders(1)).toHaveLength(0);
    },
  );

  it("keeps an existing login when returning from another site after starting YouTube connect", async () => {
    const { database, service } = setup();
    database.connection.prepare("DELETE FROM youtube_connections").run();
    const auth = new AuthService(database.auth, 20, { registrationMode: "open" });
    const session = await auth.register("oauth-reader", "test-password-long");
    if (!session) throw new Error("Registration failed");
    const services = createApplicationServices({ database, credentialCipher: null });
    const app = await createApp({ ...services, authService: auth, youtubeService: service });
    const provider = createServer((_request, response) => {
      response.setHeader("Content-Type", "text/html");
      response.end("<html><body>OAuth provider</body></html>");
    });
    await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
    const browser = await chromium.launch({ headless: true });
    try {
      const origin = await app.listen({ host: "0.0.0.0", port: 0 });
      const local = origin.replace("0.0.0.0", "127.0.0.1");
      const external = `http://localhost:${(provider.address() as AddressInfo).port}`;
      const context = await browser.newContext();
      await context.addCookies([
        {
          name: "feedfold_session",
          value: session.token,
          url: local,
          httpOnly: true,
          sameSite: "Strict",
        },
      ]);
      const page = await context.newPage();
      await page.goto(`${local}/health`);
      const authorization = await page.evaluate(async () => {
        const response = await fetch("/api/youtube/connect", { method: "POST" });
        return response.json() as Promise<{ url: string }>;
      });
      const state = new URL(authorization.url).searchParams.get("state");
      await page.goto(`${external}/health`);
      const responsePromise = page.waitForResponse((response) =>
        response.url().includes("/api/youtube/callback"),
      );
      await page.evaluate((url) => {
        window.location.href = url;
      }, `${local}/api/youtube/callback?state=${state}&error=access_denied`);
      const response = await responsePromise;
      expect(response.status()).toBe(303);
      expect(response.headers().location).toBe("/settings/feeds?youtube=cancelled");
      expect(auth.userForToken(session.token)?.id).toBe(session.user.id);
    } finally {
      await browser.close();
      await new Promise<void>((resolve, reject) =>
        provider.close((error) => (error ? reject(error) : resolve())),
      );
      await app.close();
      await services.refreshService.stop();
      await services.extractionQueue.stop();
    }
  });

  it("adds channels once, adopts matching feeds, preserves organization, and removes unsubscribed feeds", () => {
    const { database, service } = setup();
    const folder = database.folders.createFolder(1, { name: "Learning" });
    const manual = database.feeds.createFeed(1, {
      feedUrl: url(first.id),
      title: "My channel name",
      folderId: folder.id,
    });
    const unrelated = database.feeds.createFeed(1, { feedUrl: "https://example.com/feed" });
    service.reconcile(1, [first, second]);
    service.reconcile(1, [first, second]);
    expect(database.feeds.listFeeds(1)).toHaveLength(3);
    expect(database.feeds.getFeed(1, manual.id)).toMatchObject({
      title: "My channel name",
      folderId: folder.id,
    });
    expect(service.status(1)).toMatchObject({ connected: true, feedCount: 2, error: null });
    const nextSync = Date.parse(service.status(1).nextSyncAt as string);
    expect(nextSync - Date.now()).toBeGreaterThan(23 * 60 * 60_000);
    expect(nextSync - Date.now()).toBeLessThanOrEqual(24 * 60 * 60_000);
    service.reconcile(1, [second]);
    expect(database.feeds.getFeed(1, manual.id)).toBeNull();
    expect(database.feeds.getFeed(1, unrelated.id)).not.toBeNull();
    service.reconcile(1, []);
    expect(service.status(1).feedCount).toBe(0);
    expect(database.feeds.listFeeds(1)).toHaveLength(1);
  });

  it("rolls back removals and additions together when the account limit would be exceeded", () => {
    const { database, service } = setup(2);
    service.reconcile(1, [first]);
    database.feeds.createFeed(1, { feedUrl: "https://example.com/feed" });
    const before = database.feeds.listFeeds(1);
    const lastSync = service.status(1).lastSyncAt;
    expect(() => service.reconcile(1, [second, third])).toThrow("2-feed account limit");
    expect(database.feeds.listFeeds(1)).toEqual(before);
    expect(service.status(1).lastSyncAt).toBe(lastSync);
    expect(service.status(1).feedCount).toBe(1);
    service.reconcile(1, [second]);
    expect(database.feeds.listFeeds(1).map((feed) => feed.feedUrl)).toContain(url(second.id));
  });

  it("removes one account's subscription without affecting another reader following the same channel", () => {
    const { database, service, connect } = setup();
    database.connection
      .prepare(
        "INSERT INTO users (id, username, password_hash, enabled, created_at, updated_at, public_id) VALUES (2, 'other', '', 1, '', '', 'other-public')",
      )
      .run();
    connect(2);
    service.reconcile(1, [first]);
    service.reconcile(2, [first]);
    service.reconcile(1, []);
    expect(database.feeds.listFeeds(1)).toHaveLength(0);
    expect(database.feeds.listFeeds(2)).toHaveLength(1);
    expect(service.status(2).feedCount).toBe(1);
  });

  it("keeps a synced channel tied to its original source while allowing renaming", () => {
    const { database, service } = setup();
    service.reconcile(1, [first]);
    const feed = database.feeds.listFeeds(1)[0];
    if (!feed) throw new Error("Feed missing");
    expect(() =>
      database.feeds.updateFeed(1, feed.id, { feedUrl: "https://example.com/different-feed" }),
    ).toThrow("synced YouTube feed");
    expect(database.feeds.updateFeed(1, feed.id, { title: "My channel" })?.title).toBe(
      "My channel",
    );
    service.reconcile(1, []);
    expect(database.feeds.listFeeds(1)).toHaveLength(0);
  });

  it("requires an active connection before adding any feeds", () => {
    const { database, service } = setup();
    database.connection.prepare("DELETE FROM youtube_connections WHERE user_id = 1").run();
    expect(() => service.reconcile(1, [first])).toThrow("Connect YouTube first");
    expect(database.feeds.listFeeds(1)).toHaveLength(0);
  });

  it("decrypts tokens only for their owner and rejects modified tokens", () => {
    const { cipher } = setup();
    const encrypted = cipher.encrypt(1, "private-google-token");
    expect(cipher.decrypt(1, encrypted)).toBe("private-google-token");
    expect(() => cipher.decrypt(2, encrypted)).toThrow();
    const modified = Buffer.from(encrypted, "base64");
    modified[modified.length - 1] = (modified[modified.length - 1] ?? 0) ^ 1;
    expect(() => cipher.decrypt(1, modified.toString("base64"))).toThrow();
  });

  it("binds authorization to its account and login session and accepts each callback only once", async () => {
    const { database, service } = setup();
    const auth = new AuthService(database.auth, 20);
    const session = await auth.register("youtube-reader", "test-password-long");
    if (!session) throw new Error("Registration failed");
    // The authorized user id comes from the same session lookup used by HTTP authentication.
    const user = auth.userForToken(session.token);
    if (!user) throw new Error("Session not found");
    const authorization = new URL(service.authorize(user.id, session.token));
    const state = authorization.searchParams.get("state") as string;
    expect(authorization.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/youtube.readonly",
    );
    expect(() => service.consumeState(user.id + 1, session.token, state)).toThrow("expired");
    expect(() => service.consumeState(user.id, "another-session", state)).toThrow("expired");
    const { verifier, filterShorts } = service.consumeState(user.id, session.token, state);
    expect(filterShorts).toBe(false);
    expect(digest(verifier)).toBe(authorization.searchParams.get("code_challenge"));
    expect(() => service.consumeState(user.id, session.token, state)).toThrow("expired");
    const expired = new URL(service.authorize(user.id, session.token));
    database.connection.prepare("UPDATE youtube_oauth_states SET expires_at = '2000-01-01'").run();
    expect(() =>
      service.consumeState(user.id, session.token, expired.searchParams.get("state") as string),
    ).toThrow("expired");
  });
});

describe("YouTube data retention", () => {
  it("expires stale imports even for disabled accounts while retaining fresh imports", () => {
    const { database, service } = setup();
    service.reconcile(1, [first]);
    service.expireStaleConnections();
    expect(service.status(1).connected).toBe(true);
    database.connection.prepare("UPDATE youtube_connections SET last_sync_at = '2000-01-01'").run();
    service.expireStaleConnections();
    expect(service.status(1)).toMatchObject({ connected: false, feedCount: 0 });
    expect(database.feeds.listFeeds(1)).toHaveLength(0);
  });
});

describe("YouTube backup privacy", () => {
  it("restores ordinary feeds but cannot restore Google connections or synced subscriptions", () => {
    const { database, service } = setup();
    const ordinary = database.feeds.createFeed(1, { feedUrl: "https://example.com/feed" });
    service.reconcile(1, [first]);
    const snapshot = new Sqlite(database.connection.serialize());
    try {
      snapshot.exec(
        readFileSync(new URL("../../scripts/sanitize-youtube-backup.sql", import.meta.url), "utf8"),
      );
      expect(snapshot.prepare("SELECT * FROM youtube_connections").all()).toHaveLength(0);
      expect(snapshot.prepare("SELECT * FROM youtube_feeds").all()).toHaveLength(0);
      expect(snapshot.prepare("SELECT id FROM feeds").all()).toEqual([{ id: ordinary.id }]);
      expect(snapshot.prepare("SELECT id FROM feed_sources").all()).toHaveLength(1);
      expect(snapshot.pragma("foreign_key_check")).toEqual([]);
      expect(database.feeds.listFeeds(1)).toHaveLength(2);
      expect(service.status(1).connected).toBe(true);
    } finally {
      snapshot.close();
    }
  });
});

describe("YouTube HTTP account boundaries", () => {
  it("deletes the local account and imported feeds when Google access cannot be revoked", async () => {
    const { database, service } = setup();
    const auth = new AuthService(database.auth, 20);
    const session = await auth.register("deleting-reader", "test-password-long");
    if (!session) throw new Error("Registration failed");
    service.reconcile(1, [first]);
    database.connection
      .prepare("UPDATE youtube_connections SET refresh_token = 'corrupted-token'")
      .run();
    const services = createApplicationServices({ database, credentialCipher: null });
    const app = await createApp({ ...services, authService: auth, youtubeService: service });
    const cookie = auth.sessionCookie(session.token, false).split(";", 1)[0];
    try {
      const response = await app.inject({
        method: "DELETE",
        url: "/api/auth/account",
        headers: { cookie },
      });
      expect(response.statusCode).toBe(204);
      expect(auth.userForToken(session.token)).toBeNull();
      expect(service.status(1)).toMatchObject({ connected: false, feedCount: 0 });
      expect(database.feeds.listFeeds(1)).toHaveLength(0);
      expect(database.connection.pragma("foreign_key_check")).toEqual([]);
    } finally {
      await app.close();
      await services.refreshService.stop();
      await services.extractionQueue.stop();
      await services.webFeedService.close();
    }
  });

  it.each(["", "/feedfold"])(
    "protects account boundaries and handles OAuth returns under %s",
    async (basePath) => {
      const { database, service } = setup(null, basePath);
      database.connection
        .prepare("UPDATE youtube_connections SET next_sync_at = '2100-01-01'")
        .run();
      const auth = new AuthService(database.auth, 20, { maxAccounts: 2, registrationMode: "open" });
      const firstSession = await auth.register("first-reader", "test-password-long");
      const secondSession = await auth.register("second-reader", "test-password-long");
      if (!firstSession || !secondSession) throw new Error("Registration failed");
      database.connection.prepare("UPDATE sessions SET recent_auth_at = '2000-01-01'").run();
      const services = createApplicationServices({ database, credentialCipher: null });
      const app = await createApp({
        ...services,
        authService: auth,
        youtubeService: service,
        publicOrigin: "http://localhost:45173",
        basePath: `${basePath}/`,
      });
      const cookie = auth.sessionCookie(firstSession.token, false).split(";", 1)[0];
      const otherCookie = auth.sessionCookie(secondSession.token, false).split(";", 1)[0];
      try {
        expect((await app.inject({ url: "/api/youtube" })).statusCode).toBe(401);
        expect(
          (
            await app.inject({
              method: "POST",
              url: "/api/youtube/connect",
              headers: { cookie, origin: "https://another-site.example" },
            })
          ).statusCode,
        ).toBe(403);
        expect(
          (
            await app.inject({
              url: "/api/youtube",
              headers: { cookie, "x-feedfold-account": secondSession.user.id },
            })
          ).statusCode,
        ).toBe(401);
        const response = await app.inject({
          method: "POST",
          url: "/api/youtube/connect",
          headers: { cookie, origin: "http://localhost:45173" },
        });
        expect(response.statusCode).toBe(200);
        const authorization = new URL(response.json<{ url: string }>().url);
        expect(authorization.searchParams.get("redirect_uri")).toBe(
          `http://localhost:45173${basePath}/api/youtube/callback`,
        );
        const state = authorization.searchParams.get("state");
        const otherCallback = await app.inject({
          url: `/api/youtube/callback?state=${state}&error=access_denied`,
          headers: { cookie: otherCookie },
        });
        expect(otherCallback.headers.location).toBe(`${basePath}/settings/feeds?youtube=failed`);
        const cancelled = await app.inject({
          url: `/api/youtube/callback?state=${state}&error=access_denied`,
          headers: { cookie },
        });
        expect(cancelled.headers.location).toBe(`${basePath}/settings/feeds?youtube=cancelled`);
        expect(cancelled.headers["referrer-policy"]).toBe("no-referrer");
        expect(cancelled.headers["cache-control"]).toBe("no-store");
        const replayed = await app.inject({
          url: `/api/youtube/callback?state=${state}&error=access_denied`,
          headers: { cookie },
        });
        expect(replayed.headers.location).toBe(`${basePath}/settings/feeds?youtube=failed`);

        let pendingState: string | null = null;
        for (let attempt = 0; attempt < 4; attempt++) {
          const allowed = await app.inject({
            method: "POST",
            url: "/api/youtube/connect",
            headers: { cookie, origin: "http://localhost:45173" },
          });
          expect(allowed.statusCode).toBe(200);
          pendingState = new URL(allowed.json<{ url: string }>().url).searchParams.get("state");
        }
        const newSession = await auth.login("first-reader", "test-password-long");
        if (!newSession) throw new Error("Login failed");
        const throttled = await app.inject({
          method: "POST",
          url: "/api/youtube/connect",
          headers: {
            cookie: auth.sessionCookie(newSession.token, false).split(";", 1)[0],
            origin: "http://localhost:45173",
          },
        });
        expect(throttled.statusCode).toBe(429);
        expect(Number(throttled.headers["retry-after"])).toBeGreaterThan(0);
        expect(Number(throttled.headers["retry-after"])).toBeLessThanOrEqual(600);
        const otherConnect = await app.inject({
          method: "POST",
          url: "/api/youtube/connect",
          headers: { cookie: otherCookie, origin: "http://localhost:45173" },
        });
        expect(otherConnect.statusCode).toBe(200);
        const pendingCallback = await app.inject({
          url: `/api/youtube/callback?state=${pendingState}&error=access_denied`,
          headers: { cookie },
        });
        expect(pendingCallback.headers.location).toBe(
          `${basePath}/settings/feeds?youtube=cancelled`,
        );
        database.connection.prepare("UPDATE auth_rate_limits SET reset_at = 0").run();
        const afterCooldown = await app.inject({
          method: "POST",
          url: "/api/youtube/connect",
          headers: { cookie, origin: "http://localhost:45173" },
        });
        expect(afterCooldown.statusCode).toBe(200);
        const disconnected = await app.inject({
          method: "DELETE",
          url: "/api/youtube",
          headers: { cookie: otherCookie, origin: "http://localhost:45173" },
        });
        expect(disconnected.statusCode).toBe(204);
      } finally {
        await app.close();
        await services.refreshService.stop();
        await services.extractionQueue.stop();
        await services.webFeedService.close();
      }
    },
  );
});
