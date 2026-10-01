import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../../src/server/database.js";
import { AuthService } from "../../src/server/features/auth/service.js";
import { DESKTOP_POLICY, serverPolicy } from "../../src/server/service-policy.js";
import type { Article, ArticlePage, BootstrapData } from "../../src/shared/types.js";
import { createTestApp } from "../helpers/app.js";
import { completeFeedRefresh } from "../helpers/feeds.js";

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function savedReader(path = ":memory:", policy = DESKTOP_POLICY) {
  const database = new AppDatabase(path, 30, policy);
  const auth = new AuthService(database.auth, 20, { maxAccounts: 100 });
  const reader = await auth.register("collector", "reader-password");
  const stranger = await auth.register("other-reader", "reader-password");
  if (!reader || !stranger) throw new Error("Accounts were not created");
  const { app, close } = await createTestApp(database, auth);
  cleanups.push(() => database.close(), close);
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  const request = (path: string, method = "GET", body?: unknown, token = reader.token) =>
    fetch(origin + path, {
      method,
      headers: {
        cookie: `feedfold_session=${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const feed = database.feeds.createFeed(reader.user.id, {
    title: "Collected essays",
    feedUrl: "https://essays.example.test/feed",
  });
  const parsed = {
    title: feed.title,
    siteUrl: null,
    articles: ["First essay", "Second essay"].map((title) => ({
      externalId: title,
      title,
      url: null,
      author: "Writer",
      publishedAt: null,
      summary: title,
      imageUrl: null,
      feedContentHtml: `<p>${title} in full.</p>`,
    })),
  };
  completeFeedRefresh(database.feeds, feed.id, {
    httpStatus: 200,
    etag: null,
    lastModified: null,
    parsed,
  });
  const articles = ((await (await request("/api/articles?state=all")).json()) as ArticlePage)
    .articles;
  for (const article of articles) {
    expect(
      (await request(`/api/articles/${article.id}/state`, "PATCH", { isSaved: true })).status,
    ).toBe(200);
  }
  const saved = async () =>
    ((await (await request("/api/articles?state=saved&includeContent=true")).json()) as ArticlePage)
      .articles;
  return { database, reader, stranger, feed, articles, request, saved, parsed };
}

describe("account-owned Saved", () => {
  it("updates saved membership and returns matching collection counts over HTTP", async () => {
    const { articles, request } = await savedReader();
    const article = articles[0];
    if (!article) throw new Error("Articles were not delivered");
    const unsaved = await request(`/api/articles/${article.id}/state`, "PATCH", {
      isSaved: false,
    });
    expect(unsaved.status).toBe(200);
    expect(await unsaved.json()).toMatchObject({ id: article.id, isSaved: false });
    const collection = (await (await request("/api/articles?state=saved")).json()) as ArticlePage;
    expect(collection.articles.map(({ id }) => id)).not.toContain(article.id);
    expect(collection.articles).toHaveLength(1);
    expect(await (await request("/api/bootstrap")).json()).toMatchObject({
      counts: { saved: 1 },
    });
    const saved = await request(`/api/articles/${article.id}/state`, "PATCH", { isSaved: true });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ id: article.id, isSaved: true });
    expect(await (await request("/api/articles?state=saved")).json()).toMatchObject({
      articles: [{ id: article.id, isSaved: true }, { isSaved: true }],
    });
    expect(await (await request("/api/bootstrap")).json()).toMatchObject({
      counts: { saved: 2 },
    });
  });

  it.each(["unsubscribe", "delete account"])(
    "prunes unsaved content after the final subscriber leaves through %s",
    async (action) => {
      const { database, reader, stranger, feed, articles, request, saved } = await savedReader();
      const kept = articles[0];
      const discarded = articles[1];
      if (!kept || !discarded) throw new Error("Articles were not delivered");
      expect(
        (await request(`/api/articles/${discarded.id}/state`, "PATCH", { isSaved: false })).status,
      ).toBe(200);
      const otherFeed = database.feeds.createFeed(stranger.user.id, { feedUrl: feed.feedUrl });
      const storedIds = () =>
        database.connection.prepare("SELECT id FROM articles ORDER BY id").pluck().all();
      const originalIds = storedIds();
      expect(originalIds).toHaveLength(2);
      expect((await request(`/api/feeds/${feed.id}`, "DELETE")).status).toBe(204);
      expect(storedIds()).toEqual(originalIds);
      expect(
        (await request(`/api/articles/${discarded.id}`, "GET", undefined, stranger.token)).status,
      ).toBe(200);
      if (action === "unsubscribe") {
        expect(
          (await request(`/api/feeds/${otherFeed.id}`, "DELETE", undefined, stranger.token)).status,
        ).toBe(204);
      } else {
        expect(database.auth.deleteAccount(stranger.user.id)).toBe(true);
      }
      expect(storedIds()).toEqual([kept.id]);
      expect(database.connection.prepare("SELECT COUNT(*) FROM feed_sources").pluck().get()).toBe(
        1,
      );
      expect((await request(`/api/articles/${discarded.id}`)).status).toBe(404);
      expect(await saved()).toMatchObject([
        { id: kept.id, feedContentHtml: `<p>${kept.title} in full.</p>` },
      ]);
      expect(database.articles.getSavedCount(reader.user.id)).toBe(1);
      expect(
        (await request(`/api/articles/${kept.id}/state`, "PATCH", { isSaved: false })).status,
      ).toBe(200);
      expect(storedIds()).toEqual([]);
      expect(database.connection.prepare("SELECT COUNT(*) FROM feed_sources").pluck().get()).toBe(
        0,
      );
    },
  );

  it.each(["cached", "refreshed"])(
    "restores the owner's saved read state on %s redelivery",
    async (delivery) => {
      const { database, reader, stranger, feed, articles, request, saved, parsed } =
        await savedReader();
      const readArticle = articles[0];
      const unreadArticle = articles[1];
      if (!readArticle || !unreadArticle) throw new Error("Articles were not delivered");
      expect(
        (await request(`/api/articles/${readArticle.id}/state`, "PATCH", { isRead: true })).status,
      ).toBe(200);
      const originalDates = database.connection
        .prepare("SELECT article_id, saved_at FROM saved_articles ORDER BY article_id")
        .all();
      const savedStates = async () => (await saved()).map(({ id, isRead }) => ({ id, isRead }));
      const originalStates = await savedStates();
      expect((await request(`/api/feeds/${feed.id}`, "DELETE")).status).toBe(204);
      expect(await savedStates()).toEqual(originalStates);
      const returnedFeed = database.feeds.createFeed(reader.user.id, {
        feedUrl: feed.feedUrl,
        paused: delivery === "refreshed",
      });
      if (delivery === "refreshed") {
        database.feeds.updateFeed(reader.user.id, returnedFeed.id, { paused: false });
        expect(
          completeFeedRefresh(database.feeds, returnedFeed.id, {
            httpStatus: 200,
            etag: null,
            lastModified: null,
            parsed,
          }),
        ).toBe(true);
      }
      const detail = await request(`/api/articles/${readArticle.id}`);
      expect(detail.status).toBe(200);
      expect(await detail.json()).toMatchObject({ feedId: returnedFeed.id, isRead: true });
      expect(await savedStates()).toEqual(originalStates);
      expect((await (await request("/api/bootstrap")).json()) as BootstrapData).toMatchObject({
        counts: { saved: 2, unread: 1, all: 2 },
      });
      expect(
        database.connection
          .prepare("SELECT article_id, saved_at FROM saved_articles ORDER BY article_id")
          .all(),
      ).toEqual(originalDates);
      const otherFeed = database.feeds.createFeed(stranger.user.id, { feedUrl: feed.feedUrl });
      const otherDetail = await request(
        `/api/articles/${readArticle.id}`,
        "GET",
        undefined,
        stranger.token,
      );
      expect(otherDetail.status).toBe(200);
      expect(await otherDetail.json()).toMatchObject({
        feedId: otherFeed.id,
        isRead: false,
        isSaved: false,
      });
      expect(
        (await request(`/api/articles/${readArticle.id}/state`, "PATCH", { isRead: false })).status,
      ).toBe(200);
      expect((await request(`/api/feeds/${returnedFeed.id}`, "DELETE")).status).toBe(204);
      expect(await savedStates()).toEqual(
        originalStates.map((article) => ({ ...article, isRead: false })),
      );
    },
  );

  it.each(["hide", "keep"] as const)(
    "bypasses %s rules while ordinary queues still filter",
    async (action) => {
      const { request, saved, articles } = await savedReader();
      expect(await saved()).toHaveLength(2);
      const response = await request("/api/rules", "POST", {
        name: "Filter essays",
        action,
        conditions: [{ field: "title", pattern: "First essay" }],
        conditionOperator: "and",
      });
      expect(response.status).toBe(200);
      const ordinary = (await (await request("/api/articles?state=all")).json()) as ArticlePage;
      expect(ordinary.articles.map(({ title }) => title)).toEqual([
        action === "hide" ? "Second essay" : "First essay",
      ]);
      expect(
        (await (await request(`/api/articles/${articles[0]?.id}`)).json()) as Article,
      ).toMatchObject({ isSaved: true });
      expect(await saved()).toHaveLength(2);
      expect((await (await request("/api/bootstrap")).json()) as BootstrapData).toMatchObject({
        counts: { saved: 2, all: 1 },
      });
    },
  );

  it("keeps content and save ordering after hide and unsubscribe, then revokes access on unsave", async () => {
    const { database, reader, request, saved, articles, feed, stranger } = await savedReader();
    const before = await saved();
    const dates = () =>
      database.connection
        .prepare(
          "SELECT article_id, saved_at FROM saved_articles WHERE user_id = ? ORDER BY article_id",
        )
        .all(reader.user.id);
    const originalDates = dates();
    const article = articles[0];
    if (!article) throw new Error("No article delivered");
    expect(database.extractions.requestExtraction(reader.user.id, article.id)).toBe(true);
    expect(database.extractions.markExtractionProcessing(article.id)).toBe(true);
    database.extractions.completeExtraction(article.id, {
      contentHtml: "<p>The complete collected essay.</p>",
      contentSource: "article",
      imageUrl: null,
      status: "complete",
      error: null,
    });
    expect(
      (await request("/api/articles/mark-read", "POST", { articleIds: [article.id] })).status,
    ).toBe(200);
    expect(
      (
        await request("/api/rules", "POST", {
          name: "Hide essays",
          action: "hide",
          conditions: [{ field: "title", pattern: "essay" }],
          conditionOperator: "and",
        })
      ).status,
    ).toBe(200);
    expect((await request(`/api/feeds/${feed.id}`, "DELETE")).status).toBe(204);
    const after = await saved();
    expect(after.map(({ id }) => id)).toEqual(before.map(({ id }) => id));
    const detail = await request(`/api/articles/${article.id}`);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      feedId: null,
      feedTitle: "Collected essays",
      feedContentHtml: `<p>${article.title} in full.</p>`,
      contentHtml: "<p>The complete collected essay.</p>",
      isSaved: true,
      isRead: true,
    });
    expect(dates()).toEqual(originalDates);
    expect((await (await request("/api/bootstrap")).json()) as BootstrapData).toMatchObject({
      counts: { saved: 2, all: 0, unread: 0 },
      feeds: [],
    });
    expect(database.feeds.getRefreshCandidates()).toEqual([]);
    const firstPage = (await (
      await request("/api/articles?state=saved&limit=1")
    ).json()) as ArticlePage;
    expect(firstPage.articles[0]?.id).toBe(before[0]?.id);
    expect(firstPage.nextCursor).not.toBeNull();
    const secondPage = (await (
      await request(`/api/articles?state=saved&limit=1&cursor=${firstPage.nextCursor}`)
    ).json()) as ArticlePage;
    expect(secondPage.articles[0]?.id).toBe(before[1]?.id);
    expect(secondPage.nextCursor).toBeNull();
    const anchored = (await (
      await request(`/api/articles?state=saved&limit=1&anchorId=${article.id}`)
    ).json()) as ArticlePage;
    expect(anchored.articles[0]?.id).toBe(article.id);
    expect(anchored.anchorIndex).toBe(0);
    expect(
      ((await (await request("/api/articles?state=saved&search=First")).json()) as ArticlePage)
        .articles,
    ).toHaveLength(1);
    expect(
      (
        await request(`/api/articles/${article.id}/state`, "PATCH", {
          isRead: false,
          isSaved: true,
        })
      ).status,
    ).toBe(200);
    const marked = await request("/api/articles/mark-read", "POST", { articleIds: [article.id] });
    expect(await marked.json()).toEqual({ updated: 1 });
    expect((await (await request(`/api/articles/${article.id}`)).json()) as Article).toMatchObject({
      isRead: true,
    });
    expect(dates()).toEqual(originalDates);
    expect(
      (await request(`/api/articles/${article.id}`, "GET", undefined, stranger.token)).status,
    ).toBe(404);
    expect(
      (await request(`/api/articles/${article.id}/extract`, "POST", {}, stranger.token)).status,
    ).toBe(404);
    expect(database.ai.getArticleForAi(reader.user.id, article.id)).not.toBeNull();
    expect(database.ai.getArticleForAi(stranger.user.id, article.id)).toBeNull();
    expect(database.extractions.requestExtraction(stranger.user.id, article.id)).toBe(false);
    expect(
      (
        await request(
          `/api/articles/${article.id}/state`,
          "PATCH",
          { isSaved: true },
          stranger.token,
        )
      ).status,
    ).toBe(404);
    const unsaved = await request(`/api/articles/${article.id}/state`, "PATCH", {
      isSaved: false,
    });
    expect(unsaved.status).toBe(200);
    expect(await unsaved.json()).toMatchObject({ isSaved: false });
    expect(await saved()).toHaveLength(1);
    expect((await request(`/api/articles/${article.id}`)).status).toBe(404);
    expect(database.ai.getArticleForAi(reader.user.id, article.id)).toBeNull();
    for (const remaining of await saved()) {
      expect(
        (await request(`/api/articles/${remaining.id}/state`, "PATCH", { isSaved: false })).status,
      ).toBe(200);
    }
    expect(await saved()).toHaveLength(0);
    expect(database.connection.prepare("SELECT COUNT(*) FROM articles").pluck().get()).toBe(0);
    expect(database.connection.prepare("SELECT COUNT(*) FROM feed_sources").pluck().get()).toBe(0);
  });

  it("marks a large subscription read without losing its saved collection", async () => {
    const { database, reader, feed, request, saved } = await savedReader();
    const sourceId = database.feeds.sourceIdForFeed(feed.id);
    database.connection
      .prepare(`
      WITH RECURSIVE entries(id) AS (
        SELECT 1 UNION ALL SELECT id + 1 FROM entries WHERE id < 33000
      )
      INSERT INTO articles (source_id, external_id, title, discovered_at)
        SELECT ?, CAST(id AS TEXT), 'Story ' || id, '2026-10-01' FROM entries
    `)
      .run(sourceId);
    database.connection
      .prepare(`
      INSERT OR IGNORE INTO feed_articles (feed_id, article_id, delivered_at)
        SELECT ?, id, '2026-10-01' FROM articles WHERE source_id = ?
    `)
      .run(feed.id, sourceId);
    const response = await request("/api/articles/mark-read", "POST", { feedId: feed.id });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ updated: 33002 });
    expect((await saved()).map(({ isRead }) => isRead)).toEqual([true, true]);
    expect(database.bootstrap.getBootstrap(reader.user.id).counts.unread).toBe(0);
  });

  it("preserves retained content and save dates when the database is reopened", async () => {
    const directory = await mkdtemp(join(tmpdir(), "feedfold-saved-"));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, "reader.db");
    const { database, reader, feed, saved, request } = await savedReader(path);
    const before = await saved();
    const dates = database.connection
      .prepare("SELECT article_id, saved_at FROM saved_articles")
      .all();
    expect((await request(`/api/feeds/${feed.id}`, "DELETE")).status).toBe(204);
    const reopened = new AppDatabase(path);
    cleanups.push(() => reopened.close());
    expect(
      reopened.articles.listArticlePage(reader.user.id, { state: "saved", includeContent: true })
        .articles,
    ).toEqual(before.map((article) => ({ ...article, feedId: null, folderId: null })));
    expect(
      reopened.connection.prepare("SELECT article_id, saved_at FROM saved_articles").all(),
    ).toEqual(dates);
  });

  it("keeps each account's collection independent and releases content after the last owner is removed", async () => {
    const { database, reader, stranger, request, articles, feed } = await savedReader();
    const article = articles[0];
    if (!article) throw new Error("No article delivered");
    const otherFeed = database.feeds.createFeed(stranger.user.id, {
      title: "Other label",
      feedUrl: feed.feedUrl,
    });
    expect(
      (
        await request(
          `/api/articles/${article.id}/state`,
          "PATCH",
          { isSaved: true },
          stranger.token,
        )
      ).status,
    ).toBe(200);
    expect((await request(`/api/feeds/${feed.id}`, "DELETE")).status).toBe(204);
    expect(
      (await request(`/api/feeds/${otherFeed.id}`, "DELETE", undefined, stranger.token)).status,
    ).toBe(204);
    expect(database.auth.deleteAccount(reader.user.id)).toBe(true);
    expect(database.articles.getSavedCount(reader.user.id)).toBe(0);
    expect((await request(`/api/articles/${article.id}`)).status).toBe(401);
    const detail = await request(`/api/articles/${article.id}`, "GET", undefined, stranger.token);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ feedTitle: "Other label", isSaved: true });
    expect(database.auth.deleteAccount(stranger.user.id)).toBe(true);
    expect(database.connection.prepare("SELECT COUNT(*) FROM saved_articles").pluck().get()).toBe(
      0,
    );
    expect(database.connection.prepare("SELECT COUNT(*) FROM articles").pluck().get()).toBe(0);
    expect(database.connection.prepare("SELECT COUNT(*) FROM feed_sources").pluck().get()).toBe(0);
  });

  it("continues counting retained saves toward the account's storage limit", async () => {
    const { database, reader, feed, request } = await savedReader(
      ":memory:",
      serverPolicy({ FEEDFOLD_QUOTA_ARTICLES_PER_ACCOUNT: "2" }),
    );
    expect(() => database.quotas.assertAccountStorage(reader.user.id, 1)).toThrow("article limit");
    expect((await request(`/api/feeds/${feed.id}`, "DELETE")).status).toBe(204);
    expect(() => database.quotas.assertAccountStorage(reader.user.id, 1)).toThrow("article limit");
  });
});
