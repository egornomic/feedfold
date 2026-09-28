import { afterEach, describe, expect, it, vi } from "vitest";
import { AppDatabase } from "../../src/server/database.js";
import { pollIntervalForPosts } from "../../src/server/features/feeds/schedule.js";
import { completeFeedRefresh, failFeedRefresh } from "../helpers/feeds.js";

const completedAt = "2026-09-27T12:00:00.000Z";
const completed = Date.parse(completedAt);
const earlier = (minutes: number) => new Date(completed - minutes * 60_000).toISOString();
const article = (externalId: string, publishedAt: string | null, title = externalId) => ({
  externalId,
  title,
  url: `https://example.test/${externalId}`,
  author: null,
  publishedAt,
  summary: "",
  imageUrl: null,
  feedContentHtml: null,
});

const refresh = (
  database: AppDatabase,
  feedId: number,
  articles: ReturnType<typeof article>[],
  scheduled = true,
) =>
  completeFeedRefresh(database.feeds, feedId, {
    httpStatus: 200,
    etag: null,
    lastModified: null,
    scheduled,
    parsed: { title: "News", siteUrl: "https://example.test", articles },
  });

afterEach(() => vi.useRealTimers());

describe("adaptive feed scheduling", () => {
  it.each([
    [29, 5],
    [30, 10],
    [119, 10],
    [120, 30],
    [1_439, 30],
    [1_440, 180],
    [4_319, 180],
    [4_320, 360],
    [10_079, 360],
    [10_080, 720],
    [43_200, 720],
  ] as const)(
    "refreshes a feed posting every %i minutes at a %i-minute interval",
    (gap, interval) => {
      expect(pollIntervalForPosts([earlier(gap), completedAt], 30, completedAt)).toBe(interval);
    },
  );

  it("keeps a monthly feed at 12 hours when its next monthly post arrives", () => {
    const oldPosts = [earlier(86_400), earlier(43_200)];
    expect(pollIntervalForPosts(oldPosts, 720, completedAt)).toBe(720);
    expect(pollIntervalForPosts([...oldPosts, completedAt], 720, completedAt)).toBe(720);
  });

  it("learns from the last ten posting gaps rather than all historical posts", () => {
    const dailyPosts = Array.from({ length: 11 }, (_, index) => earlier(index * 1_440));
    expect(pollIntervalForPosts([earlier(100_000), ...dailyPosts], 720, completedAt)).toBe(180);
  });

  it("keeps the usual interval through empty checks and slows after prolonged silence", () => {
    const posts = [earlier(60), completedAt];
    expect(pollIntervalForPosts(posts, 10, new Date(completed + 120 * 60_000).toISOString())).toBe(
      10,
    );
    expect(pollIntervalForPosts(posts, 10, new Date(completed + 240 * 60_000).toISOString())).toBe(
      30,
    );
  });

  it("does not infer a burst from simultaneous posts or posts dated in the future", () => {
    expect(
      pollIntervalForPosts([earlier(60), completedAt, completedAt, earlier(-10)], 30, completedAt),
    ).toBe(10);
    expect(pollIntervalForPosts([completedAt, completedAt], 180, completedAt)).toBe(180);
  });

  it("keeps the starting interval without history and slows an isolated old post", () => {
    expect(pollIntervalForPosts([], 30, completedAt)).toBe(30);
    expect(pollIntervalForPosts([completedAt], 180, completedAt)).toBe(180);
    expect(pollIntervalForPosts([earlier(30 * 1_440)], 30, completedAt)).toBe(720);
  });

  it("starts a changed feed URL with a fresh schedule", () => {
    const database = new AppDatabase(":memory:");
    try {
      database.settings.updateSettings(1, { pollIntervalMinutes: 180 });
      const feed = database.feeds.createFeed(1, { feedUrl: "https://example.test/old.xml" });
      database.connection
        .prepare("UPDATE feed_sources SET poll_interval_minutes = 5 WHERE id = ?")
        .run(database.feeds.sourceIdForFeed(feed.id));
      expect(
        database.feeds.updateFeed(1, feed.id, { feedUrl: "https://example.test/new.xml" }),
      ).toMatchObject({ pollIntervalMinutes: 180 });
    } finally {
      database.close();
    }
  });

  it("seeds a new feed from publication history and reevaluates each scheduled refresh", () => {
    vi.useFakeTimers();
    vi.setSystemTime(completed);
    const database = new AppDatabase(":memory:");
    try {
      const feed = database.feeds.createFeed(1, { feedUrl: "https://example.test/news.xml" });
      refresh(database, feed.id, [article("one", earlier(60)), article("two", completedAt)]);
      expect(database.feeds.getFeed(1, feed.id)).toMatchObject({ pollIntervalMinutes: 10 });
      expect(database.feeds.getDueFeedIds(earlier(-9))).toEqual([]);
      const firstDue = database.feeds.getFeed(1, feed.id)?.nextPollAt as string;
      expect(Date.parse(firstDue)).toBeGreaterThanOrEqual(completed + 10 * 60_000);
      expect(Date.parse(firstDue)).toBeLessThan(completed + 20 * 60_000);
      expect(database.feeds.getDueFeedIds(firstDue)).toEqual([feed.id]);

      vi.setSystemTime(completed + 240 * 60_000);
      completeFeedRefresh(database.feeds, feed.id, {
        httpStatus: 304,
        etag: null,
        lastModified: null,
        scheduled: true,
      });
      expect(database.feeds.getFeed(1, feed.id)).toMatchObject({
        pollIntervalMinutes: 30,
      });
      const nextDue = Date.parse(database.feeds.getFeed(1, feed.id)?.nextPollAt as string);
      expect(nextDue).toBeGreaterThanOrEqual(completed + 270 * 60_000);
      expect(nextDue).toBeLessThan(completed + 300 * 60_000);
    } finally {
      database.close();
    }
  });

  it("keeps original posting times through edits and leaves manual refreshes and failures unchanged", () => {
    vi.useFakeTimers();
    vi.setSystemTime(completed);
    const database = new AppDatabase(":memory:");
    try {
      const feed = database.feeds.createFeed(1, { feedUrl: "https://example.test/news.xml" });
      refresh(database, feed.id, [article("one", earlier(60)), article("two", completedAt)]);
      refresh(database, feed.id, [
        article("one", earlier(5), "Corrected title"),
        article("two", completedAt),
      ]);
      expect(database.feeds.getFeed(1, feed.id)?.pollIntervalMinutes).toBe(10);

      vi.setSystemTime(completed + 240 * 60_000);
      refresh(database, feed.id, [article("three", earlier(-240))], false);
      expect(database.feeds.getFeed(1, feed.id)?.pollIntervalMinutes).toBe(10);
      failFeedRefresh(database.feeds, feed.id, {
        httpStatus: 503,
        error: "Unavailable",
        errorKind: "http",
        healthStatus: "failing",
        retryMinutes: 10,
      });
      expect(database.feeds.getFeed(1, feed.id)).toMatchObject({
        pollIntervalMinutes: 10,
        healthStatus: "failing",
      });
    } finally {
      database.close();
    }
  });

  it("learns undated posts from later refreshes without treating the initial import as a burst", () => {
    vi.useFakeTimers();
    vi.setSystemTime(completed);
    const database = new AppDatabase(":memory:");
    try {
      const feed = database.feeds.createFeed(1, { feedUrl: "https://example.test/undated.xml" });
      refresh(
        database,
        feed.id,
        Array.from({ length: 10 }, (_, index) => article(`initial-${index}`, null)),
      );
      expect(database.feeds.getFeed(1, feed.id)?.pollIntervalMinutes).toBe(30);
      vi.setSystemTime(completed + 60 * 60_000);
      refresh(database, feed.id, [article("next-one", null), article("next-two", null)]);
      expect(database.feeds.getFeed(1, feed.id)?.pollIntervalMinutes).toBe(30);
      vi.setSystemTime(completed + 120 * 60_000);
      refresh(database, feed.id, [article("later", null)]);
      expect(database.feeds.getFeed(1, feed.id)?.pollIntervalMinutes).toBe(10);
    } finally {
      database.close();
    }
  });
});
