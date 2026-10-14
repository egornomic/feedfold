import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ApiRuntime, createApiClient } from "../../src/client/api/api-client.js";
import { folderHierarchy } from "../../src/client/features/feeds/folder-hierarchy.js";
import { createDemoData } from "../../src/demo/fixtures.js";
import { DemoStore } from "../../src/demo/store.js";
import { AppDatabase } from "../../src/server/database.js";
import { AuthService } from "../../src/server/features/auth/service.js";
import type { ArticleQuery, RuleCondition } from "../../src/shared/types.js";
import { createTestApp } from "../helpers/app.js";
import { completeFeedRefresh } from "../helpers/feeds.js";

function readerData() {
  const data = createDemoData(new Date("2026-10-14T12:00:00Z"));
  data.rules = [];
  data.folders = data.folders.slice(0, 3).map((folder, index) => ({
    ...folder,
    id: index + 1,
    parentId: index === 1 ? 1 : null,
    name: ["Parent", "Child", "Outside"][index] ?? "",
  }));
  data.feeds = data.feeds.slice(0, 3).map((feed, index) => ({
    ...feed,
    id: index + 1,
    folderId: index + 1,
    title: "FeedTitleOnlyZqx",
  }));
  data.articles = data.articles.slice(0, 4).map((article, index) => ({
    ...article,
    id: index + 1,
    feedId: index < 2 ? 1 : index,
    folderId: index < 2 ? 1 : index,
    feedTitle: "FeedTitleOnlyZqx",
    title: ["Alpha Rust École", "Alpha only", "Rust report", "Plain"][index] ?? "",
    author: index % 2 === 0 ? "Avery" : "Someone",
    summary: "Summaryneedle raw  spaces",
    feedContentHtml: "<p>Bodyneedle <strong>visible</strong> 50%_done</p>",
    contentHtml: null,
    media: null,
    isRead: false,
    isSaved: false,
    publishedAt: `2026-10-14T0${index}:00:00Z`,
  }));
  return data;
}

describe.each(["demo", "server"] as const)("%s reader business rules", (mode) => {
  let api: ReturnType<typeof createApiClient>;
  let close = async () => {};
  let parentId: number;
  let childId: number;
  let outsideId: number;
  let scopedFeedId: number;
  let outsideFeedId: number;
  let alphaId: number;

  beforeEach(async () => {
    const data = readerData();
    let request: ApiRuntime["request"];
    if (mode === "demo") {
      const store = new DemoStore(undefined, data);
      request = async (operation, payload) => store.invoke(operation, payload);
    } else {
      const database = new AppDatabase(":memory:");
      const auth = new AuthService(database.auth, 20, { maxAccounts: 100 });
      const session = await auth.register("reader-rules", "reader-password");
      if (!session) throw new Error("Account was not created");
      const server = await createTestApp(database, auth);
      close = async () => {
        await server.close();
        database.close();
      };
      const origin = await server.app.listen({ host: "127.0.0.1", port: 0 });
      const folderIds = new Map<number, number>();
      for (const folder of data.folders) {
        const created = database.folders.createFolder(session.user.id, {
          name: folder.name,
          parentId: folder.parentId === null ? null : (folderIds.get(folder.parentId) ?? null),
        });
        folderIds.set(folder.id, created.id);
      }
      for (const feed of data.feeds) {
        const created = database.feeds.createFeed(session.user.id, {
          title: feed.title,
          feedUrl: feed.feedUrl,
          folderId: folderIds.get(feed.folderId ?? 0) ?? null,
        });
        completeFeedRefresh(database.feeds, created.id, {
          httpStatus: 200,
          etag: null,
          lastModified: null,
          parsed: {
            title: feed.title,
            siteUrl: null,
            articles: data.articles
              .filter((article) => article.feedId === feed.id)
              .map((article) => ({
                externalId: String(article.id),
                title: article.title,
                url: article.url,
                author: article.author,
                publishedAt: article.publishedAt,
                summary: article.summary,
                imageUrl: null,
                feedContentHtml: article.feedContentHtml,
              })),
          },
        });
      }
      request = async (_operation, _payload, path, init) => {
        const response = await fetch(`${origin}${path}`, {
          ...init,
          headers: {
            ...(init?.body ? { "content-type": "application/json" } : {}),
            cookie: `feedfold_session=${session.token}`,
          },
        });
        if (!response.ok) throw new Error((await response.json()).error);
        return response.status === 204 ? undefined : response.json();
      };
    }
    api = createApiClient({
      request,
      subscribeReaderDataInvalidations: () => () => {},
      exportOpml: async () => {},
    });
    const bootstrap = await api.bootstrap();
    parentId = bootstrap.folders.find((folder) => folder.name === "Parent")?.id ?? 0;
    childId = bootstrap.folders.find((folder) => folder.name === "Child")?.id ?? 0;
    outsideId = bootstrap.folders.find((folder) => folder.name === "Outside")?.id ?? 0;
    scopedFeedId = bootstrap.feeds.find((feed) => feed.folderId === parentId)?.id ?? 0;
    outsideFeedId = bootstrap.feeds.find((feed) => feed.folderId === outsideId)?.id ?? 0;
    alphaId = (await api.articles({ state: "all", search: "Alpha Rust" })).articles[0]?.id ?? 0;
  });

  afterEach(async () => close());

  async function titles(query: ArticleQuery = { state: "all" }) {
    return (await api.articles(query)).articles.map((article) => article.title).sort();
  }

  function rule(conditions: RuleCondition[] = [{ field: "title", pattern: "alpha" }]) {
    return {
      name: "Reader rule",
      conditions,
      conditionOperator: "and" as const,
      action: "hide" as const,
    };
  }

  it("applies hide rules immediately, updates counts, and keeps saved articles available", async () => {
    const lastPostAt = (await api.bootstrap()).feeds.find(
      (feed) => feed.id === scopedFeedId,
    )?.lastPostAt;
    await api.updateArticleState(alphaId, { isSaved: true });
    const created = await api.createRule(rule());
    expect(created.matchedCount).toBe(2);
    expect(await titles()).toEqual(["Plain", "Rust report"]);
    expect((await api.bootstrap()).counts).toEqual({ all: 2, unread: 2, saved: 1 });
    expect((await api.bootstrap()).feeds.find((feed) => feed.id === scopedFeedId)).toMatchObject({
      totalCount: 0,
      unreadCount: 0,
      lastPostAt,
    });
    expect(
      (await api.bootstrap()).folders.find((folder) => folder.id === parentId)?.unreadCount,
    ).toBe(1);
    expect(await titles({ state: "saved" })).toEqual(["Alpha Rust École"]);
    await api.updateRule(created.id, { enabled: false });
    expect(await titles()).toHaveLength(4);
    await api.updateRule(created.id, {
      enabled: true,
      conditions: [{ field: "title", pattern: "plain" }],
    });
    expect(await titles()).toEqual(["Alpha Rust École", "Alpha only", "Rust report"]);
    expect((await api.rules()).find((item) => item.id === created.id)?.matchedCount).toBe(1);
    await api.deleteRule(created.id);
    expect(await titles()).toHaveLength(4);
  });

  it("marks existing matches read when a rule is enabled and preserves manual unread changes", async () => {
    const created = await api.createRule({ ...rule(), action: "mark_read", enabled: false });
    expect(created.matchedCount).toBe(2);
    expect(await titles({ state: "unread" })).toHaveLength(4);
    await api.updateRule(created.id, { enabled: true });
    expect(await titles({ state: "unread" })).toEqual(["Plain", "Rust report"]);
    expect((await api.bootstrap()).counts.unread).toBe(2);
    await api.updateArticleState(alphaId, { isRead: false });
    expect(await titles({ state: "unread" })).toContain("Alpha Rust École");
    await api.createRule({ ...rule(), conditions: [{ field: "title", pattern: "absent" }] });
    expect((await api.article(alphaId)).isRead).toBe(false);
    await api.deleteRule(created.id);
    expect(await titles({ state: "read" })).toEqual(["Alpha only"]);
  });

  it("limits keep rules to their folder branch and gives hide rules priority", async () => {
    const keep = await api.createRule({
      ...rule(),
      action: "keep",
      folderId: parentId,
      conditions: [{ field: "title", pattern: "rust" }],
    });
    expect(keep.matchedCount).toBe(2);
    expect(await titles()).toEqual(["Alpha Rust École", "Plain", "Rust report"]);
    const hide = await api.createRule({ ...rule(), feedId: scopedFeedId });
    expect(await titles()).toEqual(["Plain", "Rust report"]);
    await api.deleteRule(hide.id);
    await api.deleteRule(keep.id);
    expect(await titles()).toHaveLength(4);
  });

  it("reapplies folder rules when feeds or folder branches move into their scope", async () => {
    const created = await api.createRule({
      ...rule(),
      folderId: parentId,
      action: "mark_read",
      conditions: [{ field: "title", pattern: "plain" }],
    });
    expect(created.matchedCount).toBe(0);
    await api.updateFeed(outsideFeedId, { folderId: childId });
    expect(await titles({ state: "read" })).toEqual(["Plain"]);
    await api.updateFeed(outsideFeedId, { folderId: outsideId });
    const plain = (await api.articles({ state: "all", search: "Plain" })).articles[0];
    if (!plain) throw new Error("Plain article is missing");
    await api.updateArticleState(plain.id, { isRead: false });
    await api.updateFolder(outsideId, { parentId: childId });
    expect(await titles({ state: "read" })).toEqual(["Plain"]);
    expect((await api.rules()).find((item) => item.id === created.id)?.matchedCount).toBe(1);
  });

  it("matches all or any conditions across article fields", async () => {
    const conditions: RuleCondition[] = [
      { field: "title", pattern: "ALPHA" },
      { field: "author", pattern: "avery" },
    ];
    const created = await api.createRule(rule(conditions));
    expect(created.matchedCount).toBe(1);
    await api.updateRule(created.id, { conditionOperator: "or" });
    expect((await api.rules()).find((item) => item.id === created.id)?.matchedCount).toBe(3);
    for (const condition of [
      { field: "summary", pattern: "summaryneedle" },
      { field: "content", pattern: "<strong>" },
      { field: "media", pattern: "article" },
      { field: "any", pattern: "bodyneedle" },
    ] as RuleCondition[]) {
      const updated = await api.updateRule(created.id, { conditions: [condition] });
      expect(updated.matchedCount).toBe(4);
    }
  });

  it("searches article fields with literal substrings and the server's case rules", async () => {
    for (const search of [
      "ALPHA",
      "Avery",
      "Summaryneedle",
      "Bodyneedle visible",
      "50%_done",
      "École",
      "\0ignored",
    ]) {
      expect((await api.articles({ state: "all", search })).articles.length).toBeGreaterThan(0);
    }
    for (const search of [
      "FeedTitleOnlyZqx",
      "école",
      "raw spaces",
      "50%_missing",
      "strong",
      "absent",
    ]) {
      expect(await titles({ state: "all", search })).toEqual([]);
    }
  });

  it("keeps a now-read selection in unread results and respects feed and folder scope", async () => {
    await api.updateArticleState(alphaId, { isRead: true });
    expect(await titles({ state: "unread" })).not.toContain("Alpha Rust École");
    const anchored = await api.articles({ state: "unread", search: "absent", anchorId: alphaId });
    expect(anchored.articles.map((article) => article.id)).toEqual([alphaId]);
    expect(anchored.anchorIndex).toBe(0);
    const outside = await api.articles({
      state: "unread",
      folderId: outsideId,
      search: "absent",
      anchorId: alphaId,
    });
    expect(outside.articles).toEqual([]);
    expect(outside.anchorIndex).toBeNull();
    expect(
      (
        await api.articles({
          state: "unread",
          feedId: outsideFeedId,
          search: "absent",
          anchorId: alphaId,
        })
      ).articles,
    ).toEqual([]);
    expect((await api.articles({ state: "unread", anchorId: 999999 })).anchorIndex).toBeNull();
  });

  it("rejects circular parents without changing the tree and permits a valid move", async () => {
    await expect(api.updateFolder(parentId, { parentId: childId })).rejects.toThrow(
      "Choose a parent outside this folder.",
    );
    await expect(api.updateFolder(parentId, { parentId })).rejects.toThrow(
      "Choose a parent outside this folder.",
    );
    expect(
      folderHierarchy((await api.bootstrap()).folders)
        .map((entry) => entry.folder.id)
        .sort(),
    ).toEqual([parentId, childId, outsideId].sort());
    await api.updateFolder(childId, { parentId: outsideId });
    expect((await api.bootstrap()).folders.find((folder) => folder.id === childId)?.parentId).toBe(
      outsideId,
    );
  });

  it("keeps an unsubscribed selection available only in saved articles", async () => {
    await api.updateArticleState(alphaId, { isSaved: true });
    await api.deleteFeed(scopedFeedId);
    expect(
      (await api.articles({ state: "all", anchorId: alphaId })).articles.map(
        (article) => article.id,
      ),
    ).not.toContain(alphaId);
    expect(
      (await api.articles({ state: "saved", anchorId: alphaId })).articles.map(
        (article) => article.id,
      ),
    ).toEqual([alphaId]);
  });
});
