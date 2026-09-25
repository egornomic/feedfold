import { randomBytes } from "node:crypto";
import type { YouTubeStatus } from "../../../shared/youtube.js";
import type { AppDatabase } from "../../database.js";
import { ApplicationApiError } from "../../errors.js";
import type { FeedRefreshService } from "../refresh/service.js";
import type { YouTubeConfig } from "./config.js";
import { digest, YouTubeTokenCipher } from "./crypto.js";
import {
  GoogleAccessExpired,
  YOUTUBE_SCOPE,
  type YouTubeChannel,
  YouTubeGoogleClient,
} from "./google.js";

const HOUR = 3_600_000;
const timestamp = (offset = 0): string => new Date(Date.now() + offset).toISOString();
const feedUrl = (id: string): string => `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
interface Connection {
  user_id: number;
  channel_id: string;
  channel_title: string;
  refresh_token: string;
  last_sync_at: string | null;
  next_sync_at: string;
  last_attempt_at: string | null;
  error: string | null;
}

export class YouTubeService {
  private readonly cipher: YouTubeTokenCipher;
  private readonly google: YouTubeGoogleClient;
  private readonly active = new Map<number, Promise<unknown>>();
  private timer: NodeJS.Timeout | undefined;
  private sweep: Promise<void> | undefined;
  private stopped = false;

  constructor(
    private readonly database: AppDatabase,
    private readonly refresh: FeedRefreshService,
    private readonly config: YouTubeConfig,
  ) {
    this.cipher = new YouTubeTokenCipher(config.encryptionKey);
    this.google = new YouTubeGoogleClient(config, (task) => database.quotas.runOutbound(task));
  }

  private connection(userId: number): Connection | undefined {
    return this.database.connection
      .prepare("SELECT * FROM youtube_connections WHERE user_id = ?")
      .get(userId) as Connection | undefined;
  }

  status(userId: number): YouTubeStatus {
    const connection = this.connection(userId);
    const count = this.database.connection
      .prepare("SELECT count(*) AS total FROM youtube_feeds WHERE user_id = ?")
      .get(userId) as { total: number };
    return {
      available: true,
      connected: !!connection,
      channelTitle: connection?.channel_title ?? null,
      lastSyncAt: connection?.last_sync_at ?? null,
      nextSyncAt: connection?.next_sync_at ?? null,
      feedCount: count.total,
      error: connection?.error ?? null,
    };
  }

  authorize(userId: number, sessionToken: string, filterShorts = false): string {
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    this.database.connection
      .prepare("DELETE FROM youtube_oauth_states WHERE expires_at <= ? OR user_id = ?")
      .run(timestamp(), userId);
    this.database.connection
      .prepare(
        "INSERT INTO youtube_oauth_states (state_hash, user_id, session_hash, verifier, expires_at, filter_shorts) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        digest(state),
        userId,
        digest(sessionToken),
        this.cipher.encrypt(userId, verifier),
        timestamp(10 * 60_000),
        Number(filterShorts),
      );
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      scope: YOUTUBE_SCOPE,
      access_type: "offline",
      prompt: "consent",
      state,
      code_challenge: digest(verifier),
      code_challenge_method: "S256",
    }).toString();
    return url.href;
  }

  consumeConnectionAttempt(userId: number): number | null {
    return this.database.auth.consumeRateLimit(
      digest(`youtube-connect:${userId}`),
      5,
      10 * 60_000,
      Date.now(),
    );
  }

  consumeState(
    userId: number,
    sessionToken: string,
    state: string,
  ): { verifier: string; filterShorts: boolean } {
    const row = this.database.connection
      .prepare(`DELETE FROM youtube_oauth_states
      WHERE state_hash = ? AND user_id = ? AND session_hash = ? AND expires_at > ? RETURNING verifier, filter_shorts`)
      .get(digest(state), userId, digest(sessionToken), timestamp()) as
      | { verifier: string; filter_shorts: number }
      | undefined;
    if (!row)
      throw new ApplicationApiError(
        400,
        "This YouTube connection request expired. Connect again from Settings.",
      );
    return {
      verifier: this.cipher.decrypt(userId, row.verifier),
      filterShorts: row.filter_shorts === 1,
    };
  }

  private async exclusive<T>(userId: number, action: () => Promise<T>): Promise<T> {
    if (this.stopped)
      throw new ApplicationApiError(503, "The server is restarting. Try again shortly.");
    if (this.active.has(userId))
      throw new ApplicationApiError(
        409,
        "YouTube is syncing. Wait for it to finish and try again.",
      );
    const promise = action();
    this.active.set(userId, promise);
    try {
      return await promise;
    } finally {
      this.active.delete(userId);
    }
  }

  async connect(
    userId: number,
    code: string,
    verifier: string,
    filterShorts: boolean,
  ): Promise<void> {
    await this.exclusive(userId, async () => {
      const tokens = await this.google.exchange(code, verifier);
      if (!tokens.refresh_token || !tokens.scope?.split(" ").includes(YOUTUBE_SCOPE)) {
        await this.google.revoke(tokens.refresh_token ?? tokens.access_token);
        throw new ApplicationApiError(
          400,
          "Allow read-only YouTube access to connect your subscriptions.",
        );
      }
      const channel = await this.google.channel(tokens.access_token);
      const previous = this.connection(userId);
      if (previous && previous.channel_id !== channel.id) {
        await this.google.revoke(tokens.refresh_token);
        throw new ApplicationApiError(
          409,
          "Disconnect the current YouTube channel before connecting a different one.",
        );
      }
      this.database.connection
        .prepare(`INSERT INTO youtube_connections
        (user_id, channel_id, channel_title, refresh_token, next_sync_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET channel_title = excluded.channel_title,
        refresh_token = excluded.refresh_token, next_sync_at = excluded.next_sync_at,
        error = NULL`)
        .run(
          userId,
          channel.id,
          channel.title,
          this.cipher.encrypt(userId, tokens.refresh_token),
          timestamp(),
        );
      if (filterShorts) this.createShortsRule(userId);
      await this.performSync(userId, tokens.access_token);
    });
  }

  createShortsRule(userId: number): void {
    this.database.connection.transaction(() => {
      const folder =
        this.database.folders
          .listFolders(userId)
          .find((candidate) => candidate.name === "YouTube" && candidate.parentId === null) ??
        this.database.folders.createFolder(userId, { name: "YouTube" });
      const existing = this.database.rules
        .listRules(userId)
        .find(
          (rule) =>
            rule.folderId === folder.id &&
            rule.action === "hide" &&
            rule.enabled &&
            rule.conditions.length === 1 &&
            rule.conditions[0]?.field === "media" &&
            rule.conditions[0]?.pattern === "short",
        );
      if (!existing)
        this.database.rules.createRule(userId, {
          name: "Hide YouTube Shorts",
          folderId: folder.id,
          conditions: [{ field: "media", pattern: "short" }],
          conditionOperator: "and",
          action: "hide",
        });
    })();
  }

  // Called only with the complete, validated subscription snapshot. All feed changes commit together.
  reconcile(userId: number, channels: YouTubeChannel[]): void {
    this.database.connection.transaction(() => {
      if (!this.connection(userId)) throw new ApplicationApiError(409, "Connect YouTube first.");
      const wanted = new Set(channels.map((channel) => channel.id));
      const managed = this.database.connection
        .prepare("SELECT channel_id, feed_id FROM youtube_feeds WHERE user_id = ?")
        .all(userId) as Array<{ channel_id: string; feed_id: number }>;
      for (const item of managed) {
        if (!wanted.has(item.channel_id)) this.database.feeds.deleteFeed(userId, item.feed_id);
      }
      const existing = new Map(
        this.database.feeds.listFeeds(userId).map((feed) => [feed.feedUrl, feed]),
      );
      const missing = channels.filter((channel) => !existing.has(feedUrl(channel.id)));
      const limit = this.database.deploymentPolicy.maxFeedsPerAccount;
      if (limit !== null && existing.size + missing.length > limit) {
        throw new ApplicationApiError(
          409,
          `Your YouTube subscriptions would exceed the ${limit}-feed account limit. Remove some subscriptions before the next automatic sync. Your feeds have not changed.`,
        );
      }
      let folder = this.database.folders
        .listFolders(userId)
        .find((candidate) => candidate.name === "YouTube" && candidate.parentId === null);
      if (missing.length && !folder)
        folder = this.database.folders.createFolder(userId, { name: "YouTube" });
      const track =
        this.database.connection.prepare(`INSERT INTO youtube_feeds (user_id, channel_id, feed_id) VALUES (?, ?, ?)
        ON CONFLICT(user_id, channel_id) DO UPDATE SET feed_id = excluded.feed_id`);
      for (const channel of channels) {
        const url = feedUrl(channel.id);
        const feed =
          existing.get(url) ??
          this.database.feeds.createFeed(userId, {
            feedUrl: url,
            title: channel.title,
            siteUrl: `https://www.youtube.com/channel/${channel.id}`,
            folderId: folder?.id ?? null,
          });
        track.run(userId, channel.id, feed.id);
      }
      this.database.connection
        .prepare(
          `UPDATE youtube_connections SET last_sync_at = ?, next_sync_at = ?, error = NULL WHERE user_id = ?`,
        )
        .run(timestamp(), timestamp(24 * HOUR), userId);
    })();
    this.refresh.notifyDataChanged(userId);
  }

  private async performSync(userId: number, accessToken?: string): Promise<void> {
    const connection = this.connection(userId);
    if (!connection) throw new ApplicationApiError(409, "Connect YouTube first.");
    this.database.connection
      .prepare(
        "UPDATE youtube_connections SET last_attempt_at = ?, next_sync_at = ? WHERE user_id = ?",
      )
      .run(timestamp(), timestamp(HOUR), userId);
    try {
      const token =
        accessToken ??
        (await this.google.refresh(this.cipher.decrypt(userId, connection.refresh_token)))
          .access_token;
      this.reconcile(userId, await this.google.subscriptions(token));
    } catch (error) {
      if (error instanceof GoogleAccessExpired) this.removeConnection(userId);
      const message =
        error instanceof ApplicationApiError
          ? error.message
          : "YouTube sync could not finish. Your feeds have not changed. Try again later.";
      this.database.connection
        .prepare("UPDATE youtube_connections SET error = ? WHERE user_id = ?")
        .run(message, userId);
      throw new ApplicationApiError(
        error instanceof ApplicationApiError ? error.status : 502,
        message,
      );
    }
  }

  private removeConnection(userId: number): void {
    this.database.connection.transaction(() => {
      const feeds = this.database.connection
        .prepare("SELECT feed_id FROM youtube_feeds WHERE user_id = ?")
        .all(userId) as Array<{ feed_id: number }>;
      for (const feed of feeds) this.database.feeds.deleteFeed(userId, feed.feed_id);
      this.database.connection
        .prepare("DELETE FROM youtube_connections WHERE user_id = ?")
        .run(userId);
      this.database.connection
        .prepare("DELETE FROM youtube_oauth_states WHERE user_id = ?")
        .run(userId);
    })();
    this.refresh.notifyDataChanged(userId);
  }

  expireStaleConnections(): void {
    const stale = this.database.connection
      .prepare(
        "SELECT user_id FROM youtube_connections WHERE COALESCE(last_sync_at, connected_at) <= ?",
      )
      .all(timestamp(-29 * 24 * HOUR)) as Array<{ user_id: number }>;
    for (const row of stale) {
      if (!this.active.has(row.user_id)) this.removeConnection(row.user_id);
    }
  }

  async disconnect(userId: number): Promise<void> {
    await this.exclusive(userId, async () => {
      const connection = this.connection(userId);
      if (connection) {
        await this.google.revoke(this.cipher.decrypt(userId, connection.refresh_token));
      }
      this.removeConnection(userId);
    });
  }

  start(): void {
    const tick = () => {
      if (this.sweep || this.stopped) return;
      this.sweep = this.syncDue().finally(() => {
        this.sweep = undefined;
      });
    };
    tick();
    this.timer = setInterval(tick, 60_000);
    this.timer.unref();
  }

  private async syncDue(): Promise<void> {
    this.expireStaleConnections();
    this.database.connection
      .prepare("DELETE FROM youtube_oauth_states WHERE expires_at <= ?")
      .run(timestamp());
    const users = this.database.connection
      .prepare(`SELECT connection.user_id FROM youtube_connections connection
      JOIN users ON users.id = connection.user_id WHERE connection.next_sync_at <= ?
      AND users.enabled = 1`)
      .all(timestamp()) as Array<{ user_id: number }>;
    for (const user of users) {
      if (this.stopped) break;
      try {
        await this.exclusive(user.user_id, () => this.performSync(user.user_id));
      } catch {
        /* Status contains the recovery message; retry on the next scheduled attempt. */
      }
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    await Promise.allSettled([
      ...this.active.values(),
      ...(this.sweep !== undefined ? [this.sweep] : []),
    ]);
  }
}
