import { JSDOM } from "jsdom";
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { ApplicationApi } from "../../src/server/application-api.js";
import { AppDatabase } from "../../src/server/database.js";
import { ApplicationApiError } from "../../src/server/errors.js";
import { createApplicationServices } from "../../src/server/runtime/application-runtime.js";
import type { ApiOperation, ApiOutput, ApiRequest } from "../../src/shared/api/operations.js";
import type { DesktopResponse, FeedfoldDesktopBridge } from "../../src/shared/desktop.js";
import { completeFeedRefresh } from "../helpers/feeds.js";
import { exposeBrowserGlobals, waitFor } from "./react-harness.js";

function readerFixture(path = "/articles/unread", count = 10) {
  const database = new AppDatabase(":memory:");
  for (const feed of database.feeds.listFeeds(1)) database.feeds.deleteFeed(1, feed.id);
  const feed = database.feeds.createFeed(1, {
    title: "Reading queue",
    feedUrl: "https://example.test/reading.xml",
  });
  const refresh = { httpStatus: 200, etag: null, lastModified: null };
  completeFeedRefresh(database.feeds, feed.id, {
    ...refresh,
    parsed: { title: feed.title, siteUrl: null, articles: [] },
  });
  completeFeedRefresh(database.feeds, feed.id, {
    ...refresh,
    parsed: {
      title: feed.title,
      siteUrl: null,
      articles: Array.from({ length: count }, (_, index) => ({
        externalId: `article-${index}`,
        title: `Article ${index + 1}`,
        url: null,
        author: null,
        publishedAt: new Date(Date.UTC(2026, 8, 22, 12, 0, -index)).toISOString(),
        summary: `Summary ${index + 1}`,
        imageUrl: null,
        feedContentHtml: `<p>Full content ${index + 1}</p>`,
      })),
    },
  });
  const services = createApplicationServices({ database, credentialCipher: null });
  const application = new ApplicationApi(services);
  const gates = new Map<ApiOperation, { wait: Promise<void>; release: () => void; held: number }>();
  const invoke = async <K extends ApiOperation>(
    request: ApiRequest<K>,
  ): Promise<DesktopResponse<ApiOutput<K>>> => {
    try {
      const value = await application.invoke(request);
      const gate = gates.get(request.operation);
      if (gate) {
        gate.held += 1;
        await gate.wait;
      }
      return { ok: true, value };
    } catch (error) {
      return {
        ok: false,
        error: {
          message: error instanceof Error ? error.message : String(error),
          status: error instanceof ApplicationApiError ? error.status : 500,
          code: error instanceof ApplicationApiError ? error.code : null,
        },
      };
    }
  };
  const bridge: FeedfoldDesktopBridge = {
    platform: "desktop",
    invoke,
    exportOpml: async () => ({ ok: true, value: undefined }),
    onDataChanged: (listener) => services.refreshService.subscribe(1, listener),
  };
  const dom = new JSDOM('<div id="app"></div>', {
    pretendToBeVisual: true,
    url: `https://feedfold.test${path}`,
  });
  Object.defineProperty(dom.window, "feedfoldDesktop", { value: bridge });
  Object.defineProperty(dom.window, "matchMedia", {
    value: (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      addEventListener() {},
      removeEventListener() {},
    }),
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "scrollIntoView", { value: () => {} });
  dom.window.document.documentElement.dataset.inputModality = "keyboard";
  const restore = exposeBrowserGlobals(dom.window);
  const observers = new Set<() => void>();
  const previousObserver = Object.getOwnPropertyDescriptor(globalThis, "IntersectionObserver");
  Object.defineProperty(globalThis, "IntersectionObserver", {
    configurable: true,
    value: class {
      readonly notify: () => void;
      constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
        this.notify = () => callback([{ isIntersecting: true }]);
      }
      observe() {
        observers.add(this.notify);
      }
      disconnect() {
        observers.delete(this.notify);
      }
    },
  });
  const previousActEnvironment = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  const container = dom.window.document.querySelector<HTMLElement>("#app");
  if (!container) throw new Error("The reader fixture is incomplete");
  const root = createRoot(container);

  return {
    database,
    application,
    container,
    dom,
    async reachListEnd() {
      await act(async () => {
        for (const notify of [...observers]) notify();
      });
    },
    hold(operation: ApiOperation) {
      let resolve = () => {};
      let reject: (error: Error) => void = () => {};
      const gate = {
        held: 0,
        wait: new Promise<void>((done, fail) => {
          resolve = done;
          reject = fail;
        }),
        release() {
          gates.delete(operation);
          resolve();
        },
        fail() {
          gates.delete(operation);
          reject(new ApplicationApiError(503, "The list is temporarily unavailable"));
        },
      };
      gates.set(operation, gate);
      return gate;
    },
    async mount() {
      const modulePath: string = "../../src/client/app/app.js";
      const { App } = await import(modulePath);
      await act(async () => root.render(createElement(StrictMode, null, createElement(App))));
    },
    async close() {
      await act(async () => {
        for (const gate of gates.values()) gate.release();
        root.unmount();
      });
      await Promise.all([services.refreshService.stop(), services.extractionQueue.stop()]);
      await services.webFeedService.close();
      database.close();
      dom.window.close();
      restore();
      if (previousObserver)
        Object.defineProperty(globalThis, "IntersectionObserver", previousObserver);
      else Reflect.deleteProperty(globalThis, "IntersectionObserver");
      if (previousActEnvironment === undefined)
        Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
      else Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousActEnvironment);
    },
  };
}

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
