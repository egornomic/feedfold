import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase, type ParsedArticle } from "../../src/server/database.js";
import { completeFeedRefresh } from "../helpers/feeds.js";

const TEST_USER_ID = 1;
const databases: AppDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0).reverse()) database.close();
});

function article(
  externalId: string,
  title: string,
  author: string,
  publishedAt: string,
): ParsedArticle {
  return {
    externalId,
    title,
    url: null,
    author,
    publishedAt,
    summary: "",
    imageUrl: null,
    feedContentHtml: null,
  };
}

function seededDatabase(): {
  database: AppDatabase;
  folderId: number;
  scopedFeedId: number;
  outsideFeedId: number;
} {
  const database = new AppDatabase(":memory:");
  databases.push(database);

  const folder = database.folders.createFolder(TEST_USER_ID, { name: "Scoped" });
  const scopedFeed = database.feeds.createFeed(TEST_USER_ID, {
    title: "Scoped feed",
    feedUrl: "https://scoped.example.test/feed",
    folderId: folder.id,
  });
  const outsideFeed = database.feeds.createFeed(TEST_USER_ID, {
    title: "Outside feed",
    feedUrl: "https://outside.example.test/feed",
  });

  completeFeedRefresh(database.feeds, scopedFeed.id, {
    httpStatus: 200,
    etag: null,
    lastModified: null,
    parsed: {
      title: "Scoped feed",
      siteUrl: null,
      articles: [
        article("alpha-rust", "Alpha Rust", "Avery", "2026-07-16T12:00:00.000Z"),
        article("alpha-only", "Alpha only", "Someone", "2026-07-16T11:00:00.000Z"),
        article("rust-report", "Rust report", "Avery", "2026-07-16T10:00:00.000Z"),
        article("rust-only", "Rust only", "Someone", "2026-07-16T09:00:00.000Z"),
        article("other", "Other", "Avery", "2026-07-16T08:00:00.000Z"),
        article("plain", "Plain", "Someone", "2026-07-16T07:00:00.000Z"),
      ],
    },
  });
  completeFeedRefresh(database.feeds, outsideFeed.id, {
    httpStatus: 200,
    etag: null,
    lastModified: null,
    parsed: {
      title: "Outside feed",
      siteUrl: null,
      articles: [
        article("outside-unmatched", "Outside unmatched", "Someone", "2026-07-16T06:00:00.000Z"),
      ],
    },
  });

  return {
    database,
    folderId: folder.id,
    scopedFeedId: scopedFeed.id,
    outsideFeedId: outsideFeed.id,
  };
}

function titles(database: AppDatabase, state: "all" | "unread" = "all"): string[] {
  return database.articles
    .listArticlePage(TEST_USER_ID, { state })
    .articles.map((candidate) => candidate.title);
}

describe("article filtering rules", () => {
  it("counts only remaining matches after subscriptions are removed", () => {
    const { database, scopedFeedId, outsideFeedId } = seededDatabase();
    const rule = database.rules.createRule(TEST_USER_ID, {
      name: "Articles by Someone",
      conditions: [{ field: "author", pattern: "Someone" }],
      conditionOperator: "and",
      action: "keep",
    });
    expect(rule.matchedCount).toBe(4);

    expect(database.feeds.deleteFeed(TEST_USER_ID, scopedFeedId)).toBe(true);
    expect(database.rules.getRule(TEST_USER_ID, rule.id)?.matchedCount).toBe(1);
    expect(titles(database)).toEqual(["Outside unmatched"]);

    expect(database.feeds.deleteFeed(TEST_USER_ID, outsideFeedId)).toBe(true);
    expect(database.rules.getRule(TEST_USER_ID, rule.id)?.matchedCount).toBe(0);
    expect(titles(database)).toEqual([]);
  });

  it("applies saved rules when a feed refresh stores several articles at once", () => {
    const database = new AppDatabase(":memory:");
    databases.push(database);
    const feed = database.feeds.createFeed(TEST_USER_ID, {
      title: "Incoming",
      feedUrl: "https://incoming.example.test/feed",
    });
    const hiddenRule = database.rules.createRule(TEST_USER_ID, {
      name: "Hide hidden stories",
      feedId: feed.id,
      conditions: [{ field: "title", pattern: "hidden" }],
      conditionOperator: "and",
      action: "hide",
    });
    const readRule = database.rules.createRule(TEST_USER_ID, {
      name: "Read robot stories",
      feedId: feed.id,
      conditions: [{ field: "author", pattern: "robot" }],
      conditionOperator: "and",
      action: "mark_read",
    });

    completeFeedRefresh(database.feeds, feed.id, {
      httpStatus: 200,
      etag: null,
      lastModified: null,
      parsed: {
        title: "Incoming",
        siteUrl: null,
        articles: [
          article("hidden", "Hidden story", "Person", "2026-07-16T12:00:00.000Z"),
          article("robot", "Robot story", "Robot", "2026-07-16T11:00:00.000Z"),
          article("plain", "Plain story", "Person", "2026-07-16T10:00:00.000Z"),
        ],
      },
    });

    expect(database.rules.getRule(TEST_USER_ID, hiddenRule.id)?.matchedCount).toBe(1);
    expect(database.rules.getRule(TEST_USER_ID, readRule.id)?.matchedCount).toBe(1);
    expect(new Set(titles(database))).toEqual(new Set(["Robot story", "Plain story"]));
    expect(titles(database, "unread")).toEqual(["Plain story"]);
  });

  it("applies one AND or OR operator to every condition and leaves articles outside scope alone", () => {
    const { database, folderId, scopedFeedId, outsideFeedId } = seededDatabase();
    const conditions = [
      { field: "title" as const, pattern: "alpha" },
      { field: "author" as const, pattern: "avery" },
    ];

    const rule = database.rules.createRule(TEST_USER_ID, {
      name: "Focused topics",
      feedId: scopedFeedId,
      conditions,
      conditionOperator: "and",
      action: "keep",
    });

    expect(rule).toMatchObject({
      conditions,
      conditionOperator: "and",
      matchedCount: 1,
    });
    expect(titles(database)).toEqual(["Alpha Rust", "Outside unmatched"]);
    expect(database.bootstrap.getBootstrap(TEST_USER_ID).counts).toEqual({
      unread: 2,
      starred: 0,
      all: 2,
    });
    expect(database.feeds.getFeed(TEST_USER_ID, scopedFeedId)).toMatchObject({
      unreadCount: 1,
      totalCount: 1,
    });
    expect(database.feeds.getFeed(TEST_USER_ID, outsideFeedId)).toMatchObject({
      unreadCount: 1,
      totalCount: 1,
    });
    expect(database.folders.getFolder(TEST_USER_ID, folderId)).toMatchObject({ unreadCount: 1 });

    const updated = database.rules.updateRule(TEST_USER_ID, rule.id, { conditionOperator: "or" });

    expect(updated).toMatchObject({ conditionOperator: "or", matchedCount: 4 });
    expect(titles(database)).toEqual([
      "Alpha Rust",
      "Outside unmatched",
      "Alpha only",
      "Rust report",
      "Other",
    ]);
    expect(database.bootstrap.getBootstrap(TEST_USER_ID).counts).toEqual({
      unread: 5,
      starred: 0,
      all: 5,
    });
    expect(database.feeds.getFeed(TEST_USER_ID, scopedFeedId)).toMatchObject({
      unreadCount: 4,
      totalCount: 4,
    });
    expect(database.folders.getFolder(TEST_USER_ID, folderId)).toMatchObject({ unreadCount: 4 });
  });

  it("unites applicable keep rules, lets matching hide rules win, and ignores disabled keep rules", () => {
    const { database, folderId, scopedFeedId } = seededDatabase();
    const keepAlpha = database.rules.createRule(TEST_USER_ID, {
      name: "Keep Alpha",
      feedId: scopedFeedId,
      conditions: [{ field: "title", pattern: "alpha" }],
      conditionOperator: "and",
      action: "keep",
    });
    const keepAvery = database.rules.createRule(TEST_USER_ID, {
      name: "Keep Avery",
      folderId,
      conditions: [{ field: "author", pattern: "avery" }],
      conditionOperator: "and",
      action: "keep",
    });

    expect(keepAlpha.matchedCount).toBe(2);
    expect(keepAvery.matchedCount).toBe(3);
    expect(titles(database)).toEqual([
      "Alpha Rust",
      "Outside unmatched",
      "Alpha only",
      "Rust report",
      "Other",
    ]);

    database.rules.createRule(TEST_USER_ID, {
      name: "Hide Rust",
      folderId,
      conditions: [{ field: "title", pattern: "rust" }],
      conditionOperator: "and",
      action: "hide",
    });

    expect(titles(database)).toEqual(["Alpha only", "Outside unmatched", "Other"]);
    expect(database.bootstrap.getBootstrap(TEST_USER_ID).counts).toEqual({
      unread: 3,
      starred: 0,
      all: 3,
    });
    expect(database.feeds.getFeed(TEST_USER_ID, scopedFeedId)).toMatchObject({
      unreadCount: 2,
      totalCount: 2,
    });

    expect(database.rules.updateRule(TEST_USER_ID, keepAvery.id, { enabled: false })).toMatchObject(
      {
        enabled: false,
        matchedCount: 3,
      },
    );
    expect(titles(database)).toEqual(["Alpha only", "Outside unmatched"]);

    expect(database.rules.updateRule(TEST_USER_ID, keepAlpha.id, { enabled: false })).toMatchObject(
      {
        enabled: false,
        matchedCount: 2,
      },
    );
    expect(titles(database)).toEqual(["Alpha only", "Outside unmatched", "Other", "Plain"]);
    expect(database.bootstrap.getBootstrap(TEST_USER_ID).counts).toEqual({
      unread: 4,
      starred: 0,
      all: 4,
    });
  });

  it("uses the same multi-condition matcher when marking articles as read", () => {
    const { database, scopedFeedId } = seededDatabase();

    const rule = database.rules.createRule(TEST_USER_ID, {
      name: "Read Rust by Avery",
      feedId: scopedFeedId,
      conditions: [
        { field: "title", pattern: "rust" },
        { field: "author", pattern: "avery" },
      ],
      conditionOperator: "and",
      action: "mark_read",
    });

    expect(rule.matchedCount).toBe(2);
    expect(titles(database)).toEqual([
      "Alpha Rust",
      "Outside unmatched",
      "Alpha only",
      "Rust report",
      "Rust only",
      "Other",
      "Plain",
    ]);
    expect(titles(database, "unread")).toEqual([
      "Alpha only",
      "Outside unmatched",
      "Rust only",
      "Other",
      "Plain",
    ]);
    expect(database.bootstrap.getBootstrap(TEST_USER_ID).counts).toEqual({
      unread: 5,
      starred: 0,
      all: 7,
    });
  });
});
