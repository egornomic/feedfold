import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api as demoApi } from "../../src/demo/api.js";
import { DEMO_RELEASE_ARTICLE_ID } from "../../src/demo/fixtures.js";
import { DemoStore } from "../../src/demo/store.js";

const DEMO_NOW = new Date("2026-08-12T12:00:00.000Z");

describe("static demo data", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("exports subscriptions as valid OPML with their exact titles and URLs", () => {
    const store = new DemoStore(DEMO_NOW);
    store.invoke("updateFeed", {
      id: 1,
      input: { title: 'News & "ideas" <today>', feedUrl: "https://example.test/rss?a=1&b=2" },
    });
    const dom = new JSDOM(store.invoke("exportOpml", undefined), {
      contentType: "application/xml",
    });
    try {
      expect(dom.window.document.documentElement.tagName).toBe("opml");
      const exported = [...dom.window.document.querySelectorAll("outline")].map((outline) => ({
        title: outline.getAttribute("title"),
        text: outline.getAttribute("text"),
        feedUrl: outline.getAttribute("xmlUrl"),
      }));
      expect(exported).toEqual(
        store.bootstrap().feeds.map((feed) => ({
          title: feed.title,
          text: feed.title,
          feedUrl: feed.feedUrl,
        })),
      );
    } finally {
      dom.window.close();
    }
  });

  it("serves reader data without making a backend request", async () => {
    const fetch = vi.fn(() => Promise.reject(new Error("The network should not be used.")));
    vi.stubGlobal("fetch", fetch);

    await expect(demoApi.session()).resolves.toEqual({
      id: "demo",
      username: "demo",
      hasPassword: false,
    });
    await expect(demoApi.bootstrap()).resolves.toMatchObject({
      counts: { unread: 15, starred: 1, all: 17 },
      capabilities: { manualRefresh: true },
    });
    await expect(demoApi.authConfig()).resolves.toEqual({
      registrationAvailable: false,
      registrationMode: "closed",
      passkeysAvailable: false,
    });
    await expect(demoApi.passkeys()).resolves.toEqual({ passkeys: [], hasPassword: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps reader filters and counts in sync with article actions", () => {
    const store = new DemoStore(DEMO_NOW);

    expect(store.invoke("bootstrap", undefined).counts).toEqual({
      unread: 15,
      starred: 1,
      all: 17,
    });
    expect(store.invoke("articles", {}).articles).toHaveLength(15);
    expect(store.invoke("articles", { state: "starred" }).articles).toHaveLength(1);

    store.invoke("updateArticleState", { id: 1, state: { isRead: true, isStarred: true } });

    expect(store.invoke("bootstrap", undefined).counts).toEqual({
      unread: 14,
      starred: 2,
      all: 17,
    });
    expect(store.invoke("articles", {}).articles.map((article) => article.id)).not.toContain(1);
    expect(
      store.invoke("articles", { state: "all", search: "solar-powered" }).articles,
    ).toHaveLength(1);
  });

  it("explains that account management is unavailable without changing the demo session", async () => {
    await expect(demoApi.changePassword("demo-password")).rejects.toThrow(
      "Account management is unavailable in the demo.",
    );
    await expect(demoApi.passkeyAuthenticationOptions()).rejects.toThrow(
      "Account management is unavailable in the demo.",
    );
    await expect(demoApi.session()).resolves.toMatchObject({ id: "demo", hasPassword: false });
  });

  it("can reopen a searched article after marking the search results as read", () => {
    const store = new DemoStore(DEMO_NOW);
    const results = store.articles({ state: "unread", search: "solar-powered" });
    expect(results.articles.map((article) => article.id)).toEqual([10]);

    expect(store.markRead({ articleIds: results.articles.map((article) => article.id) })).toEqual({
      updated: 1,
    });
    expect(store.articles({ state: "unread", search: "solar-powered" }).articles).toEqual([]);
    expect(store.bootstrap().counts.unread).toBe(14);

    const reopened = store.articles({ state: "all", search: "solar-powered", anchorId: 10 });
    expect(reopened.articles).toMatchObject([{ id: 10, isRead: true }]);
    expect(reopened.anchorIndex).toBe(0);
  });

  it("starts with an explorable folder hierarchy", () => {
    const store = new DemoStore(DEMO_NOW);
    const bootstrap = store.bootstrap();

    expect(bootstrap.folders).toMatchObject([
      { id: 5, parentId: null, name: "feedfold", unreadCount: 1 },
      { id: 1, parentId: null, unreadCount: 6 },
      { id: 2, parentId: 1, unreadCount: 3 },
      { id: 3, parentId: null, unreadCount: 3 },
      { id: 4, parentId: null, unreadCount: 3 },
    ]);
    expect(bootstrap.feeds.some((feed) => feed.folderId === null)).toBe(true);
    expect(store.articles({ state: "all", folderId: 1 }).articles).toHaveLength(6);
    expect(store.articles({ state: "all", folderId: 2 }).articles).toHaveLength(3);
  });

  it("keeps the linked feedfold release saved and first in the demo", () => {
    const store = new DemoStore(new Date("2027-08-12T12:00:00.000Z"));
    const release = store.article(DEMO_RELEASE_ARTICLE_ID);
    expect(release.isStarred).toBe(true);
    expect(release.url).toMatch(/^https:\/\/github\.com\/egornomic\/feedfold\/releases\/tag\/v/);
    expect(store.articles({ state: "all", feedId: release.feedId }).articles).toEqual([release]);

    for (const state of ["all", "unread", "starred"] as const) {
      expect(store.articles({ state }).articles[0]?.id).toBe(release.id);
    }
  });

  it("moves a feed and its articles into a demo folder", () => {
    const store = new DemoStore(DEMO_NOW);
    const folder = store.invoke("createFolder", {
      name: "Design",
      parentId: null,
      sortDirection: "newest",
    });

    store.invoke("updateFeed", { id: 1, input: { folderId: folder.id } });

    const bootstrap = store.invoke("bootstrap", undefined);
    expect(bootstrap.folders.find((candidate) => candidate.id === folder.id)?.unreadCount).toBe(3);
    expect(store.invoke("articles", { state: "all", folderId: folder.id }).articles).toHaveLength(
      3,
    );
    expect(store.invoke("article", { id: 1 }).folderId).toBe(folder.id);
  });
});
