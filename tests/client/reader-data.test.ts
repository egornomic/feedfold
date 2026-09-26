import { act, createElement } from "react";
import { describe, expect, it } from "vitest";
import { completeFeedRefresh } from "../helpers/feeds.js";
import { waitFor } from "./react-harness.js";
import { readerFixture } from "./reader-fixture.js";

async function dataFixture(count = 1) {
  const fixture = readerFixture("/articles/all", count);
  const { QueryClientProvider, useInfiniteQuery, useIsMutating } = await import(
    "@tanstack/react-query"
  );
  const queries = await import("../../src/client/api/query.js");
  const { useReaderData } = await import("../../src/client/features/reader/reader-data.js");
  const client = queries.createQueryClient();
  client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retryDelay: 5 } });
  let current: ReturnType<typeof useReaderData> | undefined;
  let titles: string[] = [];
  function Harness() {
    current = useReaderData();
    const pending = useIsMutating({ mutationKey: queries.counterMutationKey });
    const articles = useInfiniteQuery({
      ...queries.articlePagesQuery({ state: "all", limit: 100 }),
      enabled: pending === 0,
    });
    titles =
      articles.data?.pages.flatMap((page) => page.articles.map((article) => article.title)) ?? [];
    return null;
  }
  return {
    ...fixture,
    client,
    queries,
    get current() {
      if (!current) throw new Error("Reader has not mounted");
      return current;
    },
    get titles() {
      return titles;
    },
    mount: () =>
      fixture.mount(createElement(QueryClientProvider, { client }, createElement(Harness))),
    deliver(title: string) {
      completeFeedRefresh(fixture.database.feeds, fixture.feed.id, {
        httpStatus: 200,
        etag: null,
        lastModified: null,
        parsed: {
          title: fixture.feed.title,
          siteUrl: null,
          articles: [
            {
              externalId: title,
              title,
              url: null,
              author: null,
              publishedAt: new Date().toISOString(),
              summary: title,
              imageUrl: null,
              feedContentHtml: null,
            },
          ],
        },
      });
      fixture.services.refreshService.notifyDataChanged(1);
    },
    async close() {
      await fixture.close();
      client.clear();
    },
  };
}

describe("reader query coordination", () => {
  it.each([false, true])(
    "reconciles deliveries and reconnects, including during startup (%s)",
    async (duringStartup) => {
      const fixture = await dataFixture();
      const snapshot = duringStartup ? fixture.hold("bootstrap") : null;
      try {
        await fixture.mount();
        if (!duringStartup)
          await waitFor("initial snapshot", () => !!fixture.current.bootstrap.data);
        else await waitFor("pending snapshot", () => !!snapshot?.held);
        fixture.database.folders.createFolder(1, { name: "Another client" });
        await act(async () => fixture.services.refreshService.notifyDataChanged(1));
        await act(async () => snapshot?.release());
        await waitFor(
          "new folder",
          () =>
            fixture.current.bootstrap.data?.folders.some(
              (folder) => folder.name === "Another client",
            ) === true,
        );
        fixture.database.folders.createFolder(1, { name: "While disconnected" });
        await act(async () =>
          fixture.dom.window.dispatchEvent(new fixture.dom.window.Event("online")),
        );
        await waitFor(
          "reconnected snapshot",
          () => fixture.current.bootstrap.data?.folders.length === 2,
        );
      } finally {
        await fixture.close();
      }
    },
  );

  it.each(["feed", "folder"] as const)(
    "reapplies folder rules and counts when moving a %s",
    async (kind) => {
      const fixture = await dataFixture();
      const source = fixture.database.folders.createFolder(1, { name: "Source" });
      const destination = fixture.database.folders.createFolder(1, { name: "Destination" });
      fixture.database.feeds.updateFeed(1, fixture.feed.id, { folderId: source.id });
      const rule = fixture.database.rules.createRule(1, {
        name: "Hidden in destination",
        folderId: destination.id,
        conditions: [{ field: "title", pattern: "Article" }],
        conditionOperator: "and",
        action: "hide",
      });
      try {
        await fixture.mount();
        await waitFor("initial article", () => fixture.titles.length === 1);
        expect(
          fixture.current.rules.data?.find((candidate) => candidate.id === rule.id)?.matchedCount,
        ).toBe(0);
        await act(async () => {
          if (kind === "feed")
            await fixture.current.data.updateFeed(fixture.feed.id, { folderId: destination.id });
          else await fixture.current.data.updateFolder(source.id, { parentId: destination.id });
        });
        await waitFor("hidden article", () => fixture.titles.length === 0);
        expect(fixture.current.bootstrap.data?.counts.unread).toBe(0);
        expect(
          fixture.current.rules.data?.find((candidate) => candidate.id === rule.id)?.matchedCount,
        ).toBe(1);
      } finally {
        await fixture.close();
      }
    },
  );

  it("updates every unread count and rule match after delivery, and retries a failed snapshot", async () => {
    const fixture = await dataFixture(0);
    const folder = fixture.database.folders.createFolder(1, { name: "Live" });
    fixture.database.feeds.updateFeed(1, fixture.feed.id, { folderId: folder.id });
    const rule = fixture.database.rules.createRule(1, {
      name: "Delivered",
      conditions: [{ field: "title", pattern: "Delivered" }],
      conditionOperator: "and",
      action: "keep",
    });
    try {
      await fixture.mount();
      await waitFor("empty snapshot", () => !!fixture.current.bootstrap.data);
      expect(fixture.current.bootstrap.data?.counts.unread).toBe(0);
      const snapshot = fixture.hold("bootstrap");
      await act(async () => fixture.deliver("Delivered while reading"));
      await waitFor("held snapshot", () => snapshot.held > 0);
      await act(async () => snapshot.fail());
      await waitFor("retried delivery", () => fixture.current.bootstrap.data?.counts.unread === 1);
      expect(fixture.titles).toEqual(["Delivered while reading"]);
      expect(fixture.current.bootstrap.data?.feeds[0]?.unreadCount).toBe(1);
      expect(fixture.current.bootstrap.data?.folders[0]?.unreadCount).toBe(1);
      expect(
        fixture.current.rules.data?.find((candidate) => candidate.id === rule.id)?.matchedCount,
      ).toBe(1);
    } finally {
      await fixture.close();
    }
  });

  it("does not let an overlapping snapshot undo immediate read feedback", async () => {
    const fixture = await dataFixture();
    try {
      await fixture.mount();
      await waitFor(
        "initial unread count",
        () => fixture.current.bootstrap.data?.counts.unread === 1,
      );
      const snapshot = fixture.hold("bootstrap");
      await act(async () => fixture.deliver("New delivery"));
      await waitFor("old snapshot", () => snapshot.held > 0);
      const article = fixture.database.articles
        .listArticlePage(1, { state: "all" })
        .articles.find((article) => article.title === "Article 1");
      if (!article) throw new Error("Missing initial article");
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let mutation: Promise<void> | undefined;
      await act(async () => {
        fixture.current.data.mutateBootstrap((data) => ({
          ...data,
          counts: { ...data.counts, unread: 0 },
          feeds: data.feeds.map((feed) => ({ ...feed, unreadCount: 0 })),
        }));
        mutation = fixture.current.data.runCounterMutation(async () => {
          await gate;
          await fixture.application.invoke({
            operation: "updateArticleState",
            payload: { id: article.id, state: { isRead: true } },
          });
        });
      });
      await waitFor("optimistic count", () => fixture.current.bootstrap.data?.counts.unread === 0);
      await act(async () => snapshot.release());
      expect(
        fixture.client.getQueryData(fixture.queries.bootstrapQuery().queryKey)?.counts.unread,
      ).toBe(0);
      await act(async () => {
        release();
        await mutation;
      });
      await waitFor(
        "reconciled unread count",
        () => fixture.current.bootstrap.data?.counts.unread === 1,
      );
      expect(fixture.current.bootstrap.data?.feeds[0]?.unreadCount).toBe(1);
    } finally {
      await fixture.close();
    }
  });

  it("waits for a fresh snapshot before reporting refresh complete during a read mutation", async () => {
    const fixture = await dataFixture();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let mutation: Promise<void> | undefined;
    try {
      await fixture.mount();
      await waitFor("initial snapshot", () => !!fixture.current.bootstrap.data);
      await act(async () => {
        mutation = fixture.current.data.runCounterMutation(() => gate);
      });
      await waitFor(
        "pending read",
        () => fixture.client.isMutating({ mutationKey: fixture.queries.counterMutationKey }) === 1,
      );
      let settled = false;
      await act(async () => {
        const refresh = await fixture.current.data.beginRefresh(
          [fixture.feed.id],
          [fixture.feed.id],
        );
        void refresh.settled.then(() => {
          settled = true;
        });
      });
      expect(settled).toBe(false);
      const snapshot = fixture.hold("bootstrap");
      await act(async () => {
        release();
        await mutation;
      });
      await waitFor("fresh snapshot request", () => snapshot.held > 0);
      expect(settled).toBe(false);
      await act(async () => snapshot.release());
      await waitFor("confirmed refresh completion", () => settled);
    } finally {
      release();
      await mutation;
      await fixture.close();
    }
  });

  it("reports a rejected refresh without discarding the readable snapshot", async () => {
    const fixture = await dataFixture();
    try {
      await fixture.mount();
      await waitFor("initial snapshot", () => !!fixture.current.bootstrap.data);
      fixture.database.connection.exec("ALTER TABLE folders RENAME TO unavailable_folders");
      await act(async () => {
        await expect(
          fixture.current.data.beginRefresh([fixture.feed.id], [fixture.feed.id]),
        ).rejects.toThrow("no such table: folders");
      });
      expect(fixture.current.bootstrap.data?.counts.unread).toBe(1);
      expect(fixture.titles).toEqual(["Article 1"]);
    } finally {
      fixture.database.connection.exec("ALTER TABLE unavailable_folders RENAME TO folders");
      await fixture.close();
    }
  });

  it("keeps saved settings when an older delivery response arrives", async () => {
    const fixture = await dataFixture();
    try {
      await fixture.mount();
      await waitFor("initial settings", () => !!fixture.current.bootstrap.data);
      const snapshot = fixture.hold("bootstrap");
      await act(async () => fixture.services.refreshService.notifyDataChanged(1));
      await waitFor("old settings", () => snapshot.held > 0);
      const settings = fixture.database.settings.updateSettings(1, { singleKeyShortcuts: false });
      await act(async () =>
        fixture.current.data.mutateBootstrap((current) => ({ ...current, settings })),
      );
      await waitFor(
        "saved settings",
        () => fixture.current.bootstrap.data?.settings.singleKeyShortcuts === false,
      );
      await act(async () => snapshot.release());
      expect(
        fixture.client.getQueryData(fixture.queries.bootstrapQuery().queryKey)?.settings
          .singleKeyShortcuts,
      ).toBe(false);
      await act(async () => fixture.current.data.loadBootstrap());
      expect(fixture.current.bootstrap.data?.settings.singleKeyShortcuts).toBe(false);
    } finally {
      await fixture.close();
    }
  });

  it("delivers articles after a feed is added with an initially empty snapshot", async () => {
    const fixture = await dataFixture(0);
    try {
      await fixture.mount();
      await waitFor("initial snapshot", () => !!fixture.current.bootstrap.data);
      const added = await fixture.application.invoke({
        operation: "createFeed",
        payload: {
          sourceKind: "published",
          title: "New subscription",
          feedUrl: "https://example.test/added.xml",
        },
      });
      await act(async () => fixture.services.refreshService.notifyDataChanged(1));
      await waitFor(
        "added feed",
        () => fixture.current.bootstrap.data?.feeds.some((feed) => feed.id === added.id) === true,
      );
      expect(fixture.titles).toEqual([]);
      await act(async () => {
        completeFeedRefresh(fixture.database.feeds, added.id, {
          httpStatus: 200,
          etag: null,
          lastModified: null,
          parsed: {
            title: added.title,
            siteUrl: null,
            articles: [
              {
                externalId: "first",
                title: "First delivery",
                url: null,
                author: null,
                publishedAt: null,
                summary: "",
                imageUrl: null,
                feedContentHtml: null,
              },
            ],
          },
        });
        fixture.services.refreshService.notifyDataChanged(1);
      });
      await waitFor("first delivery", () => fixture.titles.includes("First delivery"));
      expect(fixture.current.bootstrap.data?.counts.unread).toBe(1);
    } finally {
      await fixture.close();
    }
  });
});
