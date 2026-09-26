import { act, createElement, Fragment } from "react";
import { describe, expect, it } from "vitest";
import { waitFor } from "./react-harness.js";
import { readerFixture } from "./reader-fixture.js";

describe("reader navigation", () => {
  it("loads the reading queue while sidebar settings are still arriving", async () => {
    const fixture = readerFixture();
    const bootstrap = fixture.hold("bootstrap");
    const articles = fixture.hold("articles");
    try {
      await fixture.mount();
      await waitFor(
        "concurrent reader and sidebar responses",
        () => bootstrap.held > 0 && articles.held > 0,
      );
      await act(async () => articles.release());
      expect(fixture.container.querySelector(".article-open-button")).toBeNull();
      await act(async () => bootstrap.release());
      await waitFor(
        "the loaded reading queue",
        () => fixture.container.querySelectorAll(".article-open-button").length === 10,
      );
      expect(fixture.container.textContent).toContain("Article 10");
      expect(fixture.container.querySelector(".reading-workspace")?.getAttribute("aria-busy")).toBe(
        "false",
      );
    } finally {
      await fixture.close();
    }
  });

  it.each(["all", "unread", "saved"] as const)(
    "returns to the loaded %s queue without waiting for another download",
    async (state) => {
      const fixture = readerFixture(`/articles/${state}`, 250);
      try {
        if (state === "saved") {
          for (const article of fixture.database.articles.listArticlePage(1, {
            state: "all",
            limit: 500,
          }).articles) {
            await fixture.application.invoke({
              operation: "updateArticleState",
              payload: { id: article.id, state: { isStarred: true } },
            });
          }
        }
        await fixture.mount();
        const rows = () => fixture.container.querySelectorAll(".article-open-button");
        await waitFor("the first page", () => rows().length === 100);
        await fixture.reachListEnd();
        await waitFor("the second page", () => rows().length === 200);
        const selected = [...rows()].find((row) => row.textContent === "Open Article 151");
        expect(selected).toBeDefined();
        await act(async () => (selected as HTMLButtonElement).click());
        await waitFor(
          "the opened article",
          () =>
            fixture.container.querySelector(".article-swipe-layer.is-active .article-content")
              ?.textContent === "Full content 151",
        );
        if (state === "saved") {
          const unsave = fixture.container.querySelector<HTMLButtonElement>(
            '[aria-label="Remove from Saved (S)"]',
          );
          if (!unsave) throw new Error("The article is not saved");
          await act(async () => unsave.click());
        }
        const articles = fixture.hold("articles");
        const bootstrap = fixture.hold("bootstrap");
        const back = fixture.container.querySelector<HTMLButtonElement>(
          '[aria-label="Back to articles"]',
        );
        if (!back) throw new Error("The reader has no Back action");
        await act(async () => back.click());
        await waitFor(
          "the retained reading queue",
          () =>
            fixture.dom.window.location.pathname === `/articles/${state}` &&
            rows().length === (state === "all" ? 200 : 199) &&
            fixture.container.querySelector(".reading-workspace")?.getAttribute("aria-busy") ===
              "false",
        );
        const titles = [...rows()].map((row) => row.textContent);
        expect(titles).toContain("Open Article 200");
        expect(titles).toContain("Open Article 152");
        expect(titles.includes("Open Article 151")).toBe(state === "all");
        expect(articles.held).toBe(0);
        expect(bootstrap.held).toBe(0);
      } finally {
        await fixture.close();
      }
    },
  );

  it.each(["saved", "read"] as const)(
    "restores an article to %s when its state change fails after returning to the queue",
    async (state) => {
      const fixture = readerFixture(`/articles/${state}`);
      try {
        const selected = fixture.database.articles.listArticlePage(1, { state: "all" }).articles[0];
        if (!selected) throw new Error("The fixture has no article");
        await fixture.application.invoke({
          operation: "updateArticleState",
          payload: { id: selected.id, state: { isRead: true, isStarred: true } },
        });
        await fixture.mount();
        const row = () =>
          fixture.container.querySelector<HTMLButtonElement>(".article-open-button");
        await waitFor("the saved or read article", () => row() !== null);
        await act(async () => row()?.click());
        const label = state === "saved" ? "Remove from Saved (S)" : "Mark as unread (U)";
        const action = () =>
          fixture.container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
        await waitFor("the article action", () => action() !== null);
        const mutation = fixture.hold("updateArticleState", true);
        // Exercise a real rejected database write, leaving the server's article unchanged.
        fixture.database.connection.exec(`
          CREATE TRIGGER reject_article_state BEFORE UPDATE ON feed_articles
          BEGIN SELECT RAISE(ABORT, 'article state write rejected'); END;
        `);
        await act(async () => action()?.click());
        await waitFor("the pending state change", () => mutation.held > 0);
        const back = fixture.container.querySelector<HTMLButtonElement>(
          '[aria-label="Back to articles"]',
        );
        if (!back) throw new Error("The reader has no Back action");
        await act(async () => back.click());
        await waitFor(
          "the optimistically filtered queue",
          () => fixture.dom.window.location.pathname === `/articles/${state}` && row() === null,
        );
        await act(async () => mutation.release());
        await waitFor("the rejected database write", () => fixture.failures.length > 0);
        expect(fixture.failures[0]?.message).toContain("article state write rejected");
        const persisted = await fixture.application.invoke({
          operation: "article",
          payload: { id: selected.id },
        });
        expect(persisted.isStarred).toBe(true);
        expect(persisted.isRead).toBe(true);
        await waitFor("the restored article", () => row()?.textContent === "Open Article 1");
      } finally {
        await fixture.close();
      }
    },
  );

  it("keeps a failed automatic read unread and permits an explicit retry", async () => {
    const fixture = readerFixture();
    try {
      fixture.database.connection.exec(`
        CREATE TRIGGER reject_article_state BEFORE UPDATE ON feed_articles
        BEGIN SELECT RAISE(ABORT, 'article state write rejected'); END;
      `);
      const appPath: string = "../../src/client/app/app.js";
      const { App } = await import(appPath);
      const { Toaster } = await import("sonner");
      await fixture.mount(
        createElement(Fragment, null, createElement(App), createElement(Toaster)),
      );
      await waitFor("articles", () => !!fixture.container.querySelector(".article-open-button"));
      await act(async () =>
        fixture.container.querySelector<HTMLButtonElement>(".article-open-button")?.click(),
      );
      await waitFor("read failure", () => fixture.failures.length > 0);
      await waitFor(
        "unread rollback",
        () => !!fixture.container.querySelector('[aria-label="Mark as read (U)"]'),
      );
      // Refetch the live data while the failed article remains open.
      await act(async () =>
        fixture.dom.window.dispatchEvent(new fixture.dom.window.Event("online")),
      );
      await act(async () => new Promise((resolve) => setTimeout(resolve, 100)));
      expect(fixture.failures).toHaveLength(1);
      expect(fixture.database.bootstrap.getBootstrap(1).counts.unread).toBe(10);
      const key = (key: string) =>
        fixture.dom.window.dispatchEvent(
          new fixture.dom.window.KeyboardEvent("keydown", { key, bubbles: true }),
        );
      await act(async () => key("s"));
      await waitFor("save failure", () => fixture.failures.length === 2);
      expect(fixture.dom.window.document.body.textContent).not.toContain("Article saved");
      expect(fixture.container.querySelector('[aria-label="Save article (S)"]')).not.toBeNull();
      fixture.database.connection.exec("DROP TRIGGER reject_article_state");
      await act(async () => key("u"));
      await waitFor(
        "explicit read",
        () => fixture.database.bootstrap.getBootstrap(1).counts.unread === 9,
      );
      await waitFor(
        "read success",
        () =>
          fixture.dom.window.document.body.textContent?.includes("Article marked as read") === true,
      );
      expect(fixture.failures).toHaveLength(2);
    } finally {
      await fixture.close();
    }
  });

  it("keeps a save made while the full article response is still arriving", async () => {
    const fixture = readerFixture("/articles/all");
    const detail = fixture.hold("article");
    try {
      await fixture.mount();
      await waitFor(
        "article previews and prefetch",
        () => detail.held > 0 && !!fixture.container.querySelector(".article-open-button"),
      );
      await act(async () =>
        fixture.container.querySelector<HTMLButtonElement>(".article-open-button")?.click(),
      );
      await waitFor(
        "article toolbar",
        () => !!fixture.container.querySelector('[aria-label="Save article (S)"]'),
      );
      await act(async () =>
        fixture.container
          .querySelector<HTMLButtonElement>('[aria-label="Save article (S)"]')
          ?.click(),
      );
      await waitFor(
        "persisted save",
        () => fixture.database.bootstrap.getBootstrap(1).counts.starred === 1,
      );
      await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
      await act(async () => detail.release());
      await waitFor(
        "full article content",
        () =>
          fixture.container.querySelector(".article-swipe-layer.is-active .article-content")
            ?.textContent === "Full content 1",
      );
      expect(
        fixture.container.querySelector('[aria-label="Remove from Saved (S)"]'),
      ).not.toBeNull();
      expect(
        fixture.database.articles.listArticlePage(1, { state: "starred" }).articles,
      ).toHaveLength(1);
    } finally {
      await fixture.close();
    }
  });

  it.each(["read", "saved"] as const)(
    "keeps an explicit %s change when an older background detail response arrives",
    async (state) => {
      const fixture = readerFixture("/articles/all");
      try {
        await fixture.mount();
        await waitFor("articles", () => !!fixture.container.querySelector(".article-open-button"));
        await act(async () =>
          fixture.container.querySelector<HTMLButtonElement>(".article-open-button")?.click(),
        );
        await waitFor(
          "the read article and full content",
          () =>
            !!fixture.container.querySelector('[aria-label="Mark as unread (U)"]') &&
            fixture.container.querySelector(".article-swipe-layer.is-active .article-content")
              ?.textContent === "Full content 1",
        );
        const detail = fixture.hold("article");
        await act(async () =>
          fixture.dom.window.dispatchEvent(new fixture.dom.window.Event("online")),
        );
        await waitFor("the delayed background detail", () => detail.held > 0);
        const label = state === "read" ? "Mark as unread (U)" : "Save article (S)";
        await act(async () =>
          fixture.container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)?.click(),
        );
        await waitFor("persisted state change", () => {
          const counts = fixture.database.bootstrap.getBootstrap(1).counts;
          return state === "read" ? counts.unread === 10 : counts.starred === 1;
        });
        await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
        await act(async () => detail.release());
        await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
        const expectedLabel = state === "read" ? "Mark as read (U)" : "Remove from Saved (S)";
        expect(fixture.container.querySelector(`[aria-label="${expectedLabel}"]`)).not.toBeNull();
        const counts = fixture.database.bootstrap.getBootstrap(1).counts;
        expect(state === "read" ? counts.unread : counts.starred).toBe(state === "read" ? 10 : 1);
      } finally {
        await fixture.close();
      }
    },
  );

  it("shows a bookmarked article before its neighbors and preserves changes made while they load", async () => {
    const fixture = readerFixture();
    const articles = fixture.hold("articles");
    const selected = fixture.database.articles.listArticlePage(1, { state: "all" }).articles[4];
    if (!selected) throw new Error("The fixture has no bookmarked article");
    fixture.dom.window.history.replaceState(null, "", `/articles/${selected.id}`);
    try {
      await fixture.mount();
      await waitFor(
        "readable content while neighbors are pending",
        () =>
          articles.held > 0 &&
          fixture.container.querySelector(".article-swipe-layer.is-active .article-content")
            ?.textContent === "Full content 5",
      );
      const previous = () =>
        fixture.container.querySelector<HTMLButtonElement>('[aria-label="Previous article (K)"]');
      const next = () =>
        fixture.container.querySelector<HTMLButtonElement>('[aria-label="Next article (J)"]');
      expect(previous()?.disabled).toBe(true);
      expect(next()?.disabled).toBe(true);
      expect(fixture.container.querySelector(".reading-workspace")?.getAttribute("aria-busy")).toBe(
        "false",
      );
      const save = fixture.container.querySelector<HTMLButtonElement>(
        '[aria-label="Save article (S)"]',
      );
      if (!save) throw new Error("The article has no Save action");
      await act(async () => save.click());
      await waitFor(
        "the article to be saved",
        () => fixture.database.articles.getArticle(1, selected.id)?.isStarred === true,
      );
      await act(async () => articles.release());
      await waitFor(
        "neighbor navigation",
        () => previous()?.disabled === false && next()?.disabled === false,
      );
      expect(
        fixture.container.querySelector('[aria-label="Remove from Saved (S)"]'),
      ).not.toBeNull();
      expect(
        fixture.container.querySelector(".article-swipe-layer.is-active .article-content")
          ?.textContent,
      ).toBe("Full content 5");
      await act(async () => next()?.click());
      await waitFor(
        "the following article",
        () =>
          fixture.container.querySelector(".article-swipe-layer.is-active .article-header h2")
            ?.textContent === "Article 6",
      );
    } finally {
      await fixture.close();
    }
  });

  it.each(["failed", "pending"] as const)(
    "lets readers return from a bookmarked article while its neighbors are %s",
    async (result) => {
      const fixture = readerFixture();
      const articles = fixture.hold("articles");
      const selected = fixture.database.articles.listArticlePage(1, { state: "all" }).articles[4];
      if (!selected) throw new Error("The fixture has no bookmarked article");
      fixture.dom.window.history.replaceState(null, "", `/articles/${selected.id}`);
      try {
        await fixture.mount();
        await waitFor(
          "the bookmarked article",
          () =>
            articles.held > 0 &&
            fixture.container.querySelector(".article-swipe-layer.is-active .article-content")
              ?.textContent === "Full content 5",
        );
        if (result === "failed") await act(async () => articles.fail());
        expect(
          fixture.container.querySelector(".article-swipe-layer.is-active .article-content")
            ?.textContent,
        ).toBe("Full content 5");
        const back = fixture.container.querySelector<HTMLButtonElement>(
          '[aria-label="Back to articles"]',
        );
        if (!back) throw new Error("The reader has no Back action");
        await act(async () => back.click());
        if (result === "pending") await act(async () => articles.release());
        await waitFor(
          "the surrounding feed",
          () =>
            fixture.dom.window.location.pathname === `/feeds/${selected.feedId}/all` &&
            fixture.container.querySelectorAll(".article-open-button").length === 10 &&
            fixture.container.querySelector(".reading-workspace")?.getAttribute("aria-busy") ===
              "false",
        );
        expect(
          fixture.container
            .querySelector(".reading-workspace")
            ?.classList.contains("is-reading-article"),
        ).toBe(false);
      } finally {
        await fixture.close();
      }
    },
  );
});
