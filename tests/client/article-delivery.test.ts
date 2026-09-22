import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { ApplicationApi } from "../../src/server/application-api.js";
import { AppDatabase, type ParsedFeed } from "../../src/server/database.js";
import { ApplicationApiError } from "../../src/server/errors.js";
import { ExtractionQueue } from "../../src/server/features/extraction/queue.js";
import { WebFeedService } from "../../src/server/features/feeds/web/service.js";
import { FeedRefreshService } from "../../src/server/features/refresh/service.js";
import { DefaultFeedSourceLoader } from "../../src/server/feed-source-loader.js";
import { createApplicationServices } from "../../src/server/runtime/application-runtime.js";
import type { ApiOperation, ApiOutput, ApiRequest } from "../../src/shared/api/operations.js";
import type { DesktopResponse, FeedfoldDesktopBridge } from "../../src/shared/desktop.js";
import { completeFeedRefresh } from "../helpers/feeds.js";
import { exposeBrowserGlobals, waitFor } from "./react-harness.js";

const TEST_USER_ID = 1;

function parsedArticle(
  externalId: string,
  title: string,
  publishedAt: string,
): ParsedFeed["articles"][number] {
  return {
    externalId,
    title,
    url: null,
    author: null,
    publishedAt,
    summary: `${title} summary`,
    imageUrl: null,
    feedContentHtml: null,
  };
}

function articleHeading(container: HTMLElement): string | null {
  return (
    container
      .querySelector<HTMLElement>(".article-swipe-layer.is-active .article-header h2")
      ?.textContent?.trim() ?? null
  );
}

function nextArticleButton(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>('[aria-label="Next article (J)"]');
  if (!button) throw new Error("The article reader did not render its next button");
  return button;
}

function openArticleButton(container: HTMLElement, title: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>(".article-open-button")].find(
    (candidate) => candidate.textContent?.includes(`Open ${title}`),
  );
  if (!button) throw new Error(`The article list did not render ${title}`);
  return button;
}

function articleSavedButton(container: HTMLElement, title: string): HTMLButtonElement {
  const button = openArticleButton(container, title)
    .closest("li")
    ?.querySelector<HTMLButtonElement>(".list-star-button");
  if (!button) throw new Error(`The article list did not render the Saved action for ${title}`);
  return button;
}

function expandedArticleTitles(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>(".expanded-article .article-header h2")].map(
    (heading) => heading.textContent?.trim() ?? "",
  );
}

function activeExpandedArticleTitle(container: HTMLElement): string | null {
  return (
    container
      .querySelector<HTMLElement>(".expanded-article.is-active .article-header h2")
      ?.textContent?.trim() ?? null
  );
}

describe("live article delivery", () => {
  it("reconciles saved state and keeps newly fetched articles at the end of active reading queues", async () => {
    const database = new AppDatabase(":memory:");
    const extraction = new ExtractionQueue(database.extractions, 1, 1_000);
    const webFeeds = new WebFeedService();
    let feedRefreshCount = 0;
    const refresh = new FeedRefreshService(
      database.feeds,
      new DefaultFeedSourceLoader(
        (task) => database.feeds.runOutbound(task),
        1_000,
        webFeeds,
        async () => {
          feedRefreshCount += 1;
          const latestItem =
            feedRefreshCount > 1
              ? `<item>
                <guid>delivered-expanded</guid>
                <title>Delivered into expanded view</title>
                <pubDate>Wed, 12 Aug 2026 12:00:00 GMT</pubDate>
                <description>Delivered into expanded view summary</description>
              </item>`
              : "";
          return new Response(
            `<?xml version="1.0" encoding="UTF-8"?>
          <rss version="2.0">
            <channel>
              <title>Live reading</title>
              <link>https://example.test/</link>
              <description>Stories delivered while the queue is open.</description>
              ${latestItem}
              <item>
                <guid>delivered</guid>
                <title>Delivered while reading</title>
                <pubDate>Tue, 11 Aug 2026 12:00:00 GMT</pubDate>
                <description>Delivered while reading summary</description>
              </item>
            </channel>
          </rss>`,
            { status: 200, headers: { "Content-Type": "application/rss+xml" } },
          );
        },
      ),
      1,
    );
    const application = new ApplicationApi(
      createApplicationServices({
        credentialCipher: null,
        database,
        extractionQueue: extraction,
        refreshService: refresh,
        webFeedService: webFeeds,
      }),
    );
    for (const initialFeed of database.feeds.listFeeds(TEST_USER_ID)) {
      database.feeds.deleteFeed(TEST_USER_ID, initialFeed.id);
    }
    const feed = database.feeds.createFeed(TEST_USER_ID, {
      title: "Live reading",
      feedUrl: "https://example.test/live-reading.xml",
      folderId: null,
    });
    completeFeedRefresh(database.feeds, feed.id, {
      httpStatus: 200,
      etag: null,
      lastModified: null,
      parsed: {
        title: feed.title,
        siteUrl: null,
        articles: [
          {
            ...parsedArticle("starting", "Starting article", "2026-08-10T12:00:00.000Z"),
            feedContentHtml: "<p><strong>Formatted opening</strong></p><p>Second paragraph.</p>",
          },
          parsedArticle("last-loaded", "Last loaded article", "2026-08-09T12:00:00.000Z"),
        ],
      },
    });

    let deliveredArticleListRequests = 0;
    let holdNextArticleResponse = false;
    let articleResponseHeld = false;
    let releaseArticleResponse = () => {};
    const delayedArticleResponse = new Promise<void>((resolve) => {
      releaseArticleResponse = resolve;
    });
    let initialContentRequests = 0;
    let holdNavigationResponses = false;
    const navigationResponses: Array<() => void> = [];
    let releaseInitialContent = () => {};
    const initialContentResponse = new Promise<void>((resolve) => {
      releaseInitialContent = resolve;
    });
    let failNextRuleLoad = false;
    let loadedRules: Array<{ id: number; matchedCount: number }> = [];
    const invoke = async <K extends ApiOperation>(
      request: ApiRequest<K>,
    ): Promise<DesktopResponse<ApiOutput<K>>> => {
      try {
        if (request.operation === "rules" && failNextRuleLoad) {
          failNextRuleLoad = false;
          throw new ApplicationApiError(503, "Rule service temporarily unavailable");
        }
        const value = await application.invoke(request);
        if (request.operation === "rules") {
          loadedRules = (value as { rules: typeof loadedRules }).rules;
        }
        if (request.operation === "articles" && holdNavigationResponses) {
          await new Promise<void>((resolve) => navigationResponses.push(resolve));
        }
        if (
          request.operation === "article" &&
          (value as { title: string }).title === "Starting article"
        ) {
          initialContentRequests += 1;
          await initialContentResponse;
        }
        if (request.operation === "articles" && holdNextArticleResponse) {
          holdNextArticleResponse = false;
          articleResponseHeld = true;
          await delayedArticleResponse;
        }
        if (
          request.operation === "articles" &&
          database.articles
            .listArticlePage(TEST_USER_ID, { state: "all" })
            .articles.some(({ title }) => title === "Delivered while reading")
        ) {
          deliveredArticleListRequests += 1;
        }
        return { ok: true, value };
      } catch (caught) {
        const error = caught instanceof Error ? caught : new Error(String(caught));
        return {
          ok: false,
          error: {
            message: error.message,
            status: caught instanceof ApplicationApiError ? caught.status : 500,
            code: caught instanceof ApplicationApiError ? caught.code : null,
          },
        };
      }
    };
    const bridge: FeedfoldDesktopBridge = {
      platform: "desktop",
      invoke,
      exportOpml: async () => {
        const response = await invoke({ operation: "exportOpml" });
        return response.ok ? { ok: true, value: undefined } : response;
      },
      onDataChanged: (listener) => refresh.subscribe(TEST_USER_ID, listener),
    };

    const dom = new JSDOM('<div id="app"></div>', {
      pretendToBeVisual: true,
      url: "https://feedfold.test/articles/unread",
    });
    Object.defineProperty(dom.window, "feedfoldDesktop", { configurable: true, value: bridge });
    Object.defineProperty(dom.window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => true,
      }),
    });
    Object.defineProperty(dom.window.HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: () => {},
    });
    dom.window.document.documentElement.dataset.inputModality = "keyboard";
    const restoreBrowserGlobals = exposeBrowserGlobals(dom.window);
    const previousActEnvironment = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
    const container = dom.window.document.querySelector<HTMLElement>("#app");
    if (!container) throw new Error("The app fixture is incomplete");
    const root = createRoot(container);

    try {
      const appModulePath: string = "../../src/client/app/app.js";
      const { App } = await import(appModulePath);
      await act(async () => root.render(createElement(App)));
      await waitFor(
        "the initial unread articles",
        () => container.querySelectorAll(".article-open-button").length === 2,
      );
      await waitFor("the selected article to prefetch", () => initialContentRequests === 1);
      expect(
        database.articles.listArticlePage(TEST_USER_ID, { state: "unread" }).articles,
      ).toHaveLength(2);
      await act(async () => openArticleButton(container, "Starting article").click());
      await waitFor(
        "the first article to open",
        () => articleHeading(container) === "Starting article",
      );
      const readerContent = () => container.querySelector(".article-swipe-layer.is-active");
      expect(readerContent()?.textContent).not.toContain("Starting article summary");
      expect(readerContent()?.querySelector('[aria-label="Loading article"]')).not.toBeNull();
      expect(initialContentRequests).toBe(1);
      await act(async () => releaseInitialContent());
      await waitFor(
        "formatted article content",
        () =>
          readerContent()?.querySelector(".article-content strong")?.textContent ===
          "Formatted opening",
      );
      expect(readerContent()?.querySelectorAll(".article-content p")).toHaveLength(2);
      expect(readerContent()?.querySelector('[aria-label="Loading article"]')).toBeNull();
      expect(nextArticleButton(container).disabled).toBe(false);

      await act(async () => nextArticleButton(container).click());
      await waitFor(
        "the end of the initially loaded sequence",
        () => articleHeading(container) === "Last loaded article",
      );
      await waitFor(
        "the initial articles to be read",
        () =>
          database.articles.listArticlePage(TEST_USER_ID, { state: "unread" }).articles.length ===
          0,
      );
      expect(nextArticleButton(container).disabled).toBe(true);

      const refreshButton = container.querySelector<HTMLButtonElement>(
        '[aria-label="Refresh this view (R)"]',
      );
      if (!refreshButton) throw new Error("The reader did not render its refresh button");
      await act(async () => refreshButton.click());
      await waitFor("the fetched article to be stored", () =>
        database.articles
          .listArticlePage(TEST_USER_ID, { state: "unread" })
          .articles.some(({ title }) => title === "Delivered while reading"),
      );
      await waitFor(
        "the delivered article to become reachable",
        () => !nextArticleButton(container).disabled,
      );
      await waitFor("the active refresh reconciliation", () => deliveredArticleListRequests >= 2);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(nextArticleButton(container).disabled).toBe(false);
      expect(articleHeading(container)).toBe("Last loaded article");

      await act(async () => nextArticleButton(container).click());
      await waitFor(
        "navigation into the delivered article",
        () => articleHeading(container) === "Delivered while reading",
      );
      const delivered = database.articles
        .listArticlePage(TEST_USER_ID, { state: "all" })
        .articles.find(({ title }) => title === "Delivered while reading");
      expect(delivered).toBeDefined();
      expect(dom.window.location.pathname).toBe(`/articles/${delivered?.id}`);

      await application.invoke({
        operation: "updateArticleState",
        payload: { id: delivered?.id, state: { isStarred: true } },
      });
      await act(async () => dom.window.dispatchEvent(new dom.window.Event("online")));
      await waitFor("the open read article to reflect a save from another client", () =>
        Boolean(container.querySelector('[aria-label="Remove from Saved (S)"]')),
      );

      const backButton = container.querySelector<HTMLButtonElement>(
        '[aria-label="Back to articles"]',
      );
      if (!backButton) throw new Error("The reader did not render its back button");
      await act(async () => backButton.click());
      await waitFor(
        "the unread article list to return",
        () => dom.window.location.pathname === "/articles/unread",
      );
      const allArticlesButton = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent?.trim() === "All articles",
      );
      if (!allArticlesButton) throw new Error("The reader did not render its All articles filter");
      await act(async () => allArticlesButton.click());
      await waitFor(
        "all articles to load",
        () => container.querySelectorAll(".article-open-button").length === 3,
      );

      await application.invoke({
        operation: "updateArticleState",
        payload: { id: delivered?.id, state: { isStarred: false } },
      });
      await act(async () => dom.window.dispatchEvent(new dom.window.Event("online")));
      await waitFor(
        "the magazine list to reflect removal from Saved",
        () =>
          articleSavedButton(container, "Delivered while reading").getAttribute("aria-pressed") ===
          "false",
      );

      const requestsBeforeLocalSave = deliveredArticleListRequests;
      holdNextArticleResponse = true;
      await act(async () => dom.window.dispatchEvent(new dom.window.Event("online")));
      await waitFor("the old article response to be held", () => articleResponseHeld);
      await act(async () => articleSavedButton(container, "Delivered while reading").click());
      await waitFor(
        "the local save to persist",
        () => database.articles.getArticle(TEST_USER_ID, delivered?.id ?? 0)?.isStarred === true,
      );
      releaseArticleResponse();
      await waitFor(
        "reconciliation after the overlapping local save",
        () => deliveredArticleListRequests >= requestsBeforeLocalSave + 2,
      );
      expect(
        articleSavedButton(container, "Delivered while reading").getAttribute("aria-pressed"),
      ).toBe("true");

      const expandedViewButton = container.querySelector<HTMLButtonElement>(
        '[aria-label="Expanded view"]',
      );
      if (!expandedViewButton)
        throw new Error("The reader did not render its Expanded view button");
      await act(async () => expandedViewButton.click());
      await waitFor(
        "the expanded article stream",
        () => expandedArticleTitles(container).length === 3,
      );
      expect(expandedArticleTitles(container)).toEqual([
        "Delivered while reading",
        "Starting article",
        "Last loaded article",
      ]);

      await application.invoke({
        operation: "updateArticleState",
        payload: { id: delivered?.id, state: { isStarred: false } },
      });
      await act(async () => dom.window.dispatchEvent(new dom.window.Event("online")));
      await waitFor(
        "the expanded queue to reflect removal from Saved",
        () =>
          Boolean(container.querySelector('.expanded-article [aria-label="Save article (S)"]')) &&
          !container.querySelector('.expanded-article [aria-label="Remove from Saved (S)"]'),
      );

      await act(async () => {
        dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "j" }));
      });
      await waitFor(
        "expanded navigation into the second article",
        () => activeExpandedArticleTitle(container) === "Starting article",
      );
      await act(async () => {
        dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight" }));
      });
      await waitFor(
        "the end of the expanded sequence",
        () => activeExpandedArticleTitle(container) === "Last loaded article",
      );

      const articleRequestsBeforeExpandedRefresh = deliveredArticleListRequests;
      await act(async () => refreshButton.click());
      await waitFor("the expanded article to be fetched", () =>
        database.articles
          .listArticlePage(TEST_USER_ID, { state: "all" })
          .articles.some(({ title }) => title === "Delivered into expanded view"),
      );
      await waitFor(
        "the expanded refresh reconciliation",
        () => deliveredArticleListRequests >= articleRequestsBeforeExpandedRefresh + 2,
      );
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(expandedArticleTitles(container)).toEqual([
        "Delivered while reading",
        "Starting article",
        "Last loaded article",
        "Delivered into expanded view",
      ]);
      expect(activeExpandedArticleTitle(container)).toBe("Last loaded article");

      await act(async () => {
        dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "j" }));
      });
      await waitFor(
        "expanded navigation into the delivered article",
        () => activeExpandedArticleTitle(container) === "Delivered into expanded view",
      );

      await application.invoke({
        operation: "updateArticleState",
        payload: { id: delivered?.id, state: { isStarred: true } },
      });
      const navigationButton = (label: string) => {
        const button = [...container.querySelectorAll<HTMLButtonElement>(".nav-item")].find(
          (candidate) =>
            [...candidate.querySelectorAll("span")].some((span) => span.textContent === label),
        );
        if (!button) throw new Error(`Missing navigation destination: ${label}`);
        return button;
      };
      const workspace = () => container.querySelector(".reading-workspace");
      const currentTitle = () => container.querySelector("h1")?.textContent;
      const previousTitles = expandedArticleTitles(container);
      holdNavigationResponses = true;
      await act(async () => navigationButton("Saved").click());
      await waitFor("the delayed Saved response", () => navigationResponses.length === 1);
      expect(currentTitle()).toBe("Feed");
      expect(navigationButton("Saved").getAttribute("aria-current")).toBe("page");
      expect(expandedArticleTitles(container)).toEqual(previousTitles);
      expect(container.querySelector('[aria-label="Loading articles"]')).toBeNull();
      expect(workspace()?.getAttribute("aria-busy")).toBe("true");
      expect(workspace()?.hasAttribute("inert")).toBe(true);

      await waitFor("loading feedback for a slow navigation", () =>
        Boolean(container.querySelector('[aria-label="Loading articles"]')),
      );
      expect(currentTitle()).toBe("Saved");
      expect(expandedArticleTitles(container)).toEqual([]);

      await act(async () => navigationResponses.shift()?.());
      await waitFor(
        "Saved to commit with its articles",
        () => workspace()?.getAttribute("aria-busy") === "false",
      );
      expect(expandedArticleTitles(container)).toEqual(["Delivered while reading"]);
      expect(navigationButton("Saved").getAttribute("aria-current")).toBe("page");
      expect(workspace()?.getAttribute("aria-busy")).toBe("false");
      expect(workspace()?.hasAttribute("inert")).toBe(false);

      await act(async () => navigationButton("Feed").click());
      await waitFor("the delayed Feed response", () => navigationResponses.length === 1);
      await act(async () => navigationButton("Saved").click());
      expect(currentTitle()).toBe("Saved");
      expect(workspace()?.getAttribute("aria-busy")).toBe("false");
      await act(async () => navigationResponses.shift()?.());
      expect(currentTitle()).toBe("Saved");
      expect(expandedArticleTitles(container)).toEqual(["Delivered while reading"]);

      await act(async () => navigationButton("Saved").click());
      expect(workspace()?.getAttribute("aria-busy")).toBe("false");
      expect(navigationResponses).toHaveLength(0);

      await act(async () => navigationButton("Feed").click());
      await waitFor("another delayed Feed response", () => navigationResponses.length === 1);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
      });
      expect(currentTitle()).toBe("Saved");
      expect(expandedArticleTitles(container)).toEqual(["Delivered while reading"]);
      expect(container.querySelector('[aria-label="Loading articles"]')).toBeNull();
      await act(async () => navigationButton("Live reading").click());
      await waitFor("the delayed individual feed response", () => navigationResponses.length === 2);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 160));
      });
      expect(currentTitle()).toBe("Saved");
      expect(container.querySelector('[aria-label="Loading articles"]')).toBeNull();
      await act(async () => navigationResponses.pop()?.());
      await waitFor(
        "the latest destination",
        () => workspace()?.getAttribute("aria-busy") === "false",
      );
      const latestTitles = expandedArticleTitles(container);
      await act(async () => navigationResponses.shift()?.());
      expect(currentTitle()).toBe("Live reading");
      expect(expandedArticleTitles(container)).toEqual(latestTitles);
      expect(workspace()?.getAttribute("aria-busy")).toBe("false");

      holdNavigationResponses = false;
      const rule = database.rules.createRule(TEST_USER_ID, {
        name: "Starting stories",
        conditions: [{ field: "title", pattern: "Starting" }],
        conditionOperator: "and",
        action: "keep",
      });
      const receivedMatches = () => loadedRules.find(({ id }) => id === rule.id)?.matchedCount;
      await act(async () => refresh.notifyDataChanged(TEST_USER_ID));
      await waitFor("the initial rule match count", () => receivedMatches() === 1);
      failNextRuleLoad = true;
      await act(async () => {
        await application.invoke({
          operation: "updateRule",
          payload: {
            id: rule.id,
            input: { conditions: [{ field: "title", pattern: "No matching story" }] },
          },
        });
      });
      await waitFor("the failed rule request", () => !failNextRuleLoad);
      expect(database.rules.getRule(TEST_USER_ID, rule.id)?.matchedCount).toBe(0);
      expect(receivedMatches()).toBe(1);
      await waitFor(
        "rule counts to recover without another event or user action",
        () => receivedMatches() === 0,
      );
    } finally {
      await act(async () => root.unmount());
      await Promise.all([refresh.stop(), extraction.stop()]);
      await webFeeds.close();
      database.close();
      Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousActEnvironment);
      restoreBrowserGlobals();
      dom.window.close();
    }
  }, 15_000);
});
