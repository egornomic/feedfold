import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Sqlite from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../../src/server/database.js";
import { ArticleRepository } from "../../src/server/features/articles/repository.js";
import { AuthService } from "../../src/server/features/auth/service.js";
import { ExtractionRepository } from "../../src/server/features/extraction/repository.js";
import type { ParsedArticle } from "../../src/server/features/shared.js";
import { migrateDatabase } from "../../src/server/migrations.js";
import type { ArticlePage, ArticleQuery } from "../../src/shared/types.js";
import { createTestApp } from "../helpers/app.js";
import { completeFeedRefresh } from "../helpers/feeds.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function article(externalId: string, changes: Partial<ParsedArticle> = {}): ParsedArticle {
  return {
    externalId,
    title: externalId,
    url: `https://example.test/${externalId}`,
    author: null,
    publishedAt: "2026-10-01T12:00:00.000Z",
    summary: "",
    imageUrl: null,
    feedContentHtml: null,
    ...changes,
  };
}

async function reader(path = ":memory:") {
  const database = new AppDatabase(path);
  const auth = new AuthService(database.auth, 20, { maxAccounts: 100 });
  const session = await auth.register("search-reader", "reader-password");
  const stranger = await auth.register("other-reader", "reader-password");
  if (!session || !stranger) throw new Error("Accounts were not created");
  const server = await createTestApp(database, auth);
  cleanups.push(() => database.close(), server.close);
  const origin = await server.app.listen({ host: "127.0.0.1", port: 0 });
  const feed = database.feeds.createFeed(session.user.id, {
    title: "Search feed",
    feedUrl: "https://example.test/search.xml",
  });
  const store = (articles: ParsedArticle[], feedId = feed.id) =>
    completeFeedRefresh(database.feeds, feedId, {
      httpStatus: 200,
      etag: null,
      lastModified: null,
      parsed: { title: "Search feed", siteUrl: null, articles },
    });
  const search = async (query: ArticleQuery, token = session.token) => {
    const parameters = new URLSearchParams(
      Object.entries(query).map(([key, value]) => [key, String(value)]),
    );
    const response = await fetch(`${origin}/api/articles?${parameters}`, {
      headers: { cookie: `feedfold_session=${token}` },
    });
    expect(response.status).toBe(200);
    return response.json() as Promise<ArticlePage>;
  };
  return { database, userId: session.user.id, stranger, feed, store, search };
}

function indexIsConsistent(database: AppDatabase) {
  database.connection
    .prepare("INSERT INTO article_search(article_search) VALUES ('integrity-check')")
    .run();
  expect(database.connection.prepare("SELECT COUNT(*) FROM article_search").pluck().get()).toBe(
    database.connection.prepare("SELECT COUNT(*) FROM articles").pluck().get(),
  );
}

describe("indexed article search", () => {
  it("matches literal substrings, short queries and SQLite case rules over HTTP", async () => {
    const { database, store, search } = await reader();
    const feedHtml =
      '<p>inter<strong>oper</strong>able &amp; visible</p><p>next block</p><a href="https://hiddenneedle.test">Label</a><script>scriptneedle</script><style>stylen eedle</style><template>templateneedle</template>';
    store([
      article("literal", {
        title: 'C++ "quoted" 100% under_score a\\b Kelvin École 東京 😀🚀🌕',
        author: "Authorneedle",
        summary: "Summaryneedle raw  spaces",
        feedContentHtml: feedHtml,
      }),
      article("separate", { title: "cross", author: "boundary", summary: "other" }),
    ]);
    database.connection
      .prepare("UPDATE articles SET feed_content_html = ? WHERE external_id = 'literal'")
      .run(feedHtml);
    for (const text of [
      "++",
      "+",
      '"quoted"',
      "100%",
      "under_score",
      "a\\b",
      "uthornee",
      "ummarynee",
      "interoperable & visible next block",
      "東京",
      "😀🚀🌕",
      "École",
      "Kelvin",
      "RAW",
    ]) {
      expect(
        (await search({ state: "all", search: text })).articles.map(({ title }) => title),
      ).toEqual(['C++ "quoted" 100% under_score a\\b Kelvin École 東京 😀🚀🌕']);
    }
    for (const text of [
      "100_",
      "under%score",
      "a_b",
      "hiddenneedle",
      "scriptneedle",
      "stylen eedle",
      "templateneedle",
      "cross boundary",
      "kelvin",
      "école",
      "raw spaces",
      "strong",
      "zzmissingzz",
    ]) {
      expect((await search({ state: "all", search: text })).articles, text).toEqual([]);
    }
    expect((await search({ state: "all", search: "a" })).articles).toHaveLength(2);
    // SQLite LIKE ends its pattern at NUL; the index must preserve that existing behavior.
    expect((await search({ state: "all", search: "\0ignored" })).articles).toHaveLength(2);
    expect(
      (await search({ state: "all", search: "other\0ignored" })).articles.map(({ title }) => title),
    ).toEqual(["cross"]);
  });

  it("refreshes all searchable fields, extracted content and removals atomically", async () => {
    const { database, userId, feed, store, search } = await reader();
    store([
      article("entry", {
        title: "Oldtitle",
        author: "Oldauthor",
        summary: "Oldsummary",
        feedContentHtml: "<p>Oldbody</p>",
      }),
    ]);
    const [entry] = (await search({ state: "all", search: "Oldbody" })).articles;
    if (!entry) throw new Error("Article missing");
    const extraction = new ExtractionRepository(database.connection);
    expect(extraction.requestExtraction(userId, entry.id)).toBe(true);
    expect(extraction.markExtractionProcessing(entry.id)).toBe(true);
    expect(
      extraction.completeExtraction(entry.id, {
        contentHtml: "<p>Extractedneedle</p>",
        imageUrl: null,
        contentSource: "article",
        status: "complete",
        error: null,
      }),
    ).toBe(true);
    expect(
      (await search({ state: "all", search: "Extractedneedle" })).articles.map(({ id }) => id),
    ).toEqual([entry.id]);
    store([
      article("entry", {
        title: "Newtitle",
        author: "Newauthor",
        summary: "Newsummary",
        feedContentHtml: "<p>Newbody</p>",
      }),
    ]);
    for (const searchText of [
      "Oldtitle",
      "Oldauthor",
      "Oldsummary",
      "Oldbody",
      "Extractedneedle",
    ]) {
      expect((await search({ state: "all", search: searchText })).articles).toEqual([]);
    }
    for (const searchText of ["Newtitle", "Newauthor", "Newsummary", "Newbody"]) {
      expect(
        (await search({ state: "all", search: searchText })).articles.map(({ id }) => id),
      ).toEqual([entry.id]);
    }
    expect(() =>
      database.connection.transaction(() => {
        database.connection
          .prepare("UPDATE articles SET title = 'Rollbackneedle' WHERE id = ?")
          .run(entry.id);
        database.connection.prepare("DELETE FROM articles WHERE id = ?").run(entry.id);
        throw new Error("Rollback");
      })(),
    ).toThrow("Rollback");
    expect((await search({ state: "all", search: "Rollbackneedle" })).articles).toEqual([]);
    expect((await search({ state: "all", search: "Newtitle" })).articles).toHaveLength(1);
    indexIsConsistent(database);
    expect(database.feeds.deleteFeed(userId, feed.id)).toBe(true);
    expect((await search({ state: "all", search: "Newbody" })).articles).toEqual([]);
    indexIsConsistent(database);
  });

  it("keeps access, saved articles, folder order, cursors and anchors during simultaneous searches", async () => {
    const { database, userId, stranger, feed, store, search } = await reader();
    const parent = database.folders.createFolder(userId, { name: "Parent" });
    const child = database.folders.createFolder(userId, {
      name: "Child",
      parentId: parent.id,
      sortDirection: "oldest",
    });
    database.feeds.updateFeed(userId, feed.id, { folderId: child.id });
    store(
      Array.from({ length: 8 }, (_, index) =>
        article(`Match ${index}`, {
          publishedAt: `2026-10-01T12:00:0${index}.000Z`,
          feedContentHtml: "<p>Sharedneedle</p>",
        }),
      ),
    );
    const otherFeed = database.feeds.createFeed(stranger.user.id, {
      title: "Private",
      feedUrl: "https://example.test/private.xml",
    });
    store(
      [article("Private", { feedContentHtml: "<p>Sharedneedle Privateneedle</p>" })],
      otherFeed.id,
    );
    const query = { state: "all" as const, folderId: parent.id, search: "Sharedneedle", limit: 3 };
    const [first, short, privateResults, foreignFeed, foreignFolder] = await Promise.all([
      search(query),
      search({ ...query, search: "Sh" }),
      search({ state: "all", search: "Privateneedle" }),
      search({ ...query, feedId: otherFeed.id }),
      search(query, stranger.token),
    ]);
    expect(first.articles.map(({ title }) => title)).toEqual(["Match 0", "Match 1", "Match 2"]);
    expect(short.articles.map(({ id }) => id)).toEqual(first.articles.map(({ id }) => id));
    expect(privateResults.articles).toEqual([]);
    expect(foreignFeed.articles).toEqual([]);
    expect(foreignFolder.articles).toEqual([]);
    const seen = [...first.articles];
    let cursor = first.nextCursor;
    while (cursor) {
      const next = await search({ ...query, cursor });
      seen.push(...next.articles);
      cursor = next.nextCursor;
    }
    expect(seen.map(({ title }) => title)).toEqual(
      Array.from({ length: 8 }, (_, index) => `Match ${index}`),
    );
    const anchor = seen[5];
    if (!anchor) throw new Error("Anchor missing");
    const anchored = await search({ ...query, anchorId: anchor.id, search: "zzmissingzz" });
    expect(anchored.articles.map(({ id }) => id)).toEqual([anchor.id]);
    expect(anchored.anchorIndex).toBe(0);
    database.articles.updateArticleState(userId, anchor.id, { isRead: true, isSaved: true });
    expect((await search({ ...query, state: "read" })).articles.map(({ id }) => id)).toEqual([
      anchor.id,
    ]);
    expect((await search({ ...query, state: "unread", limit: 20 })).articles).toHaveLength(7);
    database.feeds.deleteFeed(userId, feed.id);
    expect((await search({ state: "all", search: "Sharedneedle" })).articles).toEqual([]);
    expect(
      (await search({ state: "saved", search: "Sharedneedle" })).articles.map(({ id }) => id),
    ).toEqual([anchor.id]);
    expect(
      (await search({ state: "saved", search: "Sharedneedle" }, stranger.token)).articles,
    ).toEqual([]);
    database.articles.updateArticleState(userId, anchor.id, { isSaved: false });
    expect((await search({ state: "saved", search: "Sharedneedle" })).articles).toEqual([]);
    indexIsConsistent(database);
  });

  it("backfills existing text and maintains the index after reopening the database", async () => {
    const directory = await mkdtemp(join(tmpdir(), "feedfold-search-migration-"));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, "feedfold.db");
    const connection = new Sqlite(path);
    migrateDatabase(connection, 180, 58);
    connection.exec(`
      INSERT INTO feed_sources(id, feed_url, source_kind, title, created_at, updated_at)
        VALUES(1, 'https://example.test/feed', 'published', 'Existing', '2026-10-01', '2026-10-01');
      INSERT INTO feeds(id, user_id, source_id, title, created_at, updated_at)
        VALUES(1, 1, 1, 'Existing', '2026-10-01', '2026-10-01');
      INSERT INTO articles(id, source_id, external_id, title, discovered_at, feed_content_html, content_html)
        VALUES(1, 1, 'old', 'Existing title', '2026-10-01', '<p>Backfill<strong>needle</strong></p>', '<p>Existingbody</p>');
      INSERT INTO feed_articles(feed_id, article_id, delivered_at) VALUES(1, 1, '2026-10-01');
    `);
    migrateDatabase(connection, 180);
    const repository = new ArticleRepository(connection);
    expect(
      repository.listArticlePage(1, { state: "all", search: "Backfillneedle" }).articles,
    ).toHaveLength(1);
    expect(
      repository.listArticlePage(1, { state: "all", search: "Existingbody" }).articles,
    ).toHaveLength(1);
    connection.close();
    const reopened = new AppDatabase(path);
    cleanups.push(() => reopened.close());
    reopened.connection
      .prepare("UPDATE articles SET feed_content_html = '<p>Reopenedneedle</p>' WHERE id = 1")
      .run();
    expect(
      reopened.articles.listArticlePage(1, { state: "all", search: "Reopenedneedle" }).articles,
    ).toHaveLength(1);
    expect(
      reopened.articles.listArticlePage(1, { state: "all", search: "Backfillneedle" }).articles,
    ).toEqual([]);
    indexIsConsistent(reopened);
  });
});
