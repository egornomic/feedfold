import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import {
  type ArticleTranslationViewState,
  closeSummary,
  dropFeedTextSummary,
  EMPTY_ARTICLE_SUMMARY_STATE,
  EMPTY_ARTICLE_TRANSLATION_STATE,
  settleSummary,
  settleTranslation,
  showOriginal,
  startSummary,
} from "../../src/client/features/reader/article/article-ai-state.js";
import { DemoStore } from "../../src/demo/store.js";
import type { ApiOperation, ApiOutput, ApiRequest } from "../../src/shared/api/operations.js";
import type { DesktopResponse, FeedfoldDesktopBridge } from "../../src/shared/desktop.js";
import type {
  AiArticleSourceKind,
  AppSettings,
  Article,
  ArticleAiSummary,
  ArticleAiTranslation,
  BootstrapData,
} from "../../src/shared/types.js";
import { exposeBrowserGlobals, waitFor } from "./react-harness.js";

type HarnessState = {
  bootstrap: BootstrapData;
  queue: { articles: Article[] };
  enrichment: {
    articleTranslationStates: ReadonlyMap<number, ArticleTranslationViewState>;
    fullContentVisibleIds: ReadonlySet<number>;
    applySettings: (settings: AppSettings) => void;
    toggleArticleTranslation: (article: Article) => void;
    toggleFullContent: (article: Article) => Promise<void>;
  };
};

describe("article AI state", () => {
  it.each(["language", "content"] as const)(
    "keeps the current translation visible when a response invalidated by a %s change arrives",
    async (change) => {
      const store = new DemoStore();
      const initialBootstrap = store.invoke("bootstrap", undefined) as BootstrapData;
      let releaseFirstTranslation = () => {};
      let firstTranslationObserved = () => {};
      let firstTranslationSettled = () => {};
      const firstTranslationStarted = new Promise<void>((resolve) => {
        firstTranslationObserved = resolve;
      });
      const firstTranslationFinished = new Promise<void>((resolve) => {
        firstTranslationSettled = resolve;
      });
      let translationRequests = 0;

      const invoke = async <K extends ApiOperation>(
        request: ApiRequest<K>,
      ): Promise<DesktopResponse<ApiOutput<K>>> => {
        try {
          const value = store.invoke(request.operation, request.payload);
          if (request.operation === "translateArticle" && translationRequests++ === 0) {
            firstTranslationObserved();
            await new Promise<void>((resolve) => {
              releaseFirstTranslation = resolve;
            });
            firstTranslationSettled();
          }
          return { ok: true, value } as DesktopResponse<ApiOutput<K>>;
        } catch (caught) {
          const error = caught instanceof Error ? caught : new Error(String(caught));
          return { ok: false, error: { message: error.message, status: 500, code: null } };
        }
      };
      const bridge: FeedfoldDesktopBridge = {
        platform: "desktop",
        invoke,
        exportOpml: async () => {
          const response = await invoke({ operation: "exportOpml" });
          return response.ok ? { ok: true, value: undefined } : response;
        },
        onDataChanged: () => () => {},
      };
      const dom = new JSDOM('<div id="app"></div>', {
        pretendToBeVisual: true,
        url: "https://feedfold.test/",
      });
      Object.defineProperty(dom.window, "feedfoldDesktop", { configurable: true, value: bridge });
      Object.defineProperty(dom.window, "matchMedia", {
        configurable: true,
        value: () => ({
          matches: false,
          media: "",
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => true,
        }),
      });

      const restoreBrowserGlobals = exposeBrowserGlobals(dom.window);
      const previousActEnvironment = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");
      Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
      const container = dom.window.document.querySelector<HTMLElement>("#app");
      if (!container) throw new Error("The app fixture is incomplete");
      let current: HarnessState | null = null;
      let root: ReturnType<typeof createRoot> | null = null;
      let clearQueries = () => {};

      try {
        const enrichmentModulePath: string =
          "../../src/client/features/reader/article-enrichment.js";
        const queueModulePath: string = "../../src/client/features/reader/article-queue.js";
        const routeModulePath: string = "../../src/client/app/route.js";
        const resourceModulePath: string = "../../src/client/features/reader/reader-data.js";
        const [enrichmentModule, queueModule, routeModule, resourceModule] = await Promise.all([
          import(enrichmentModulePath),
          import(queueModulePath),
          import(routeModulePath),
          import(resourceModulePath),
        ]);
        const { QueryClientProvider } = await import("@tanstack/react-query");
        const queryModulePath: string = "../../src/client/api/query.js";
        const { createQueryClient, readerKeys } = await import(queryModulePath);
        const client = createQueryClient();
        client.setQueryData(readerKeys.bootstrap, initialBootstrap);
        clearQueries = () => client.clear();

        function Harness() {
          const { data: dataResource, bootstrap: bootstrapResult } = resourceModule.useReaderData();
          const bootstrap = bootstrapResult.data ?? initialBootstrap;
          const route = routeModule.useAppRoute("/");
          const queue = queueModule.useArticleQueue({
            route,
            enabled: true,
            onReadingModeChange: () => {},
            readingMode: "magazine",
            showToast: () => {},
          });
          const enrichment = enrichmentModule.useArticleEnrichment({
            bootstrap,
            queue,
            route,
            dataResource,
            readingMode: "magazine",
            showToast: () => {},
          });
          current = { bootstrap, queue, enrichment };

          const article = queue.articles.find((item: Article) => item.media === null);
          const state = article ? enrichment.articleTranslationStates.get(article.id) : null;
          return createElement(
            "output",
            { "data-testid": "translation-state" },
            `${bootstrap.settings.translationLanguage}:${state?.kind === "translating" ? "loading" : state?.kind === "translated" ? `${state.translation.language}:${state.translation.sourceKind}` : "hidden"}`,
          );
        }

        root = createRoot(container);
        await act(async () =>
          root?.render(createElement(QueryClientProvider, { client }, createElement(Harness))),
        );
        await waitFor(
          "a readable demo article",
          () => current?.queue.articles.some((item) => !item.media) === true,
        );

        const article = () => {
          const selected = current?.queue.articles.find((item) => item.media === null);
          if (!selected) throw new Error("The demo did not load a readable article");
          return selected;
        };
        const translationState = () =>
          container.querySelector<HTMLOutputElement>('[data-testid="translation-state"]')
            ?.textContent;
        const germanSettings = store.invoke("updateSettings", {
          translationLanguage: "German",
        }) as AppSettings;
        await act(async () => current?.enrichment.applySettings(germanSettings));
        await waitFor("German settings", () => translationState() === "German:hidden");

        await act(async () => current?.enrichment.toggleArticleTranslation(article()));
        await firstTranslationStarted;
        await waitFor(
          "the delayed German translation",
          () => translationState() === "German:loading",
        );

        if (change === "language") {
          const polishSettings = store.invoke("updateSettings", {
            translationLanguage: "Polish",
          }) as AppSettings;
          await act(async () => current?.enrichment.applySettings(polishSettings));
        } else {
          await act(async () => current?.enrichment.toggleFullContent(article()));
          await waitFor(
            "the full article to be visible",
            () => current?.enrichment.fullContentVisibleIds.has(article().id) === true,
          );
        }
        const expectedLanguage = change === "language" ? "Polish" : "German";
        const expectedSource = change === "content" ? "full" : "feed";
        const expectedTranslation = `${expectedLanguage}:${expectedLanguage}:${expectedSource}`;
        await waitFor(
          "the invalidated translation to clear",
          () => translationState() === `${expectedLanguage}:hidden`,
        );

        await act(async () => current?.enrichment.toggleArticleTranslation(article()));
        await waitFor("the current translation", () => translationState() === expectedTranslation);

        await act(async () => {
          releaseFirstTranslation();
          await firstTranslationFinished;
        });
        await waitFor(
          "the stale German feed translation to be ignored",
          () => translationState() === expectedTranslation,
        );
        expect(translationState()).toBe(expectedTranslation);
        expect(translationRequests).toBe(2);
      } finally {
        releaseFirstTranslation();
        clearQueries();
        if (root) await act(async () => root?.unmount());
        await new Promise((resolve) => setTimeout(resolve, 0));
        dom.window.close();
        if (previousActEnvironment === undefined)
          Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
        else Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousActEnvironment);
        restoreBrowserGlobals();
      }
    },
  );
});

function summary(promptId: string | null, sourceKind: AiArticleSourceKind): ArticleAiSummary {
  return {
    text: `${promptId ?? "summary"} from ${sourceKind}`,
    promptId,
    provider: "openai",
    model: "test-model",
    sourceKind,
    generatedAt: "2026-11-04T00:00:00.000Z",
    usage: { inputTokens: null, outputTokens: null },
    grounding: null,
  };
}

function translation(language: string): ArticleAiTranslation {
  return {
    html: `<p>${language}</p>`,
    language,
    provider: "openai",
    model: "test-model",
    sourceKind: "feed",
    generatedAt: "2026-11-04T00:00:00.000Z",
    usage: { inputTokens: null, outputTokens: null },
  };
}

describe("article summary panel", () => {
  it("keeps the current result readable while the same action updates it", () => {
    const ready = settleSummary(startSummary(EMPTY_ARTICLE_SUMMARY_STATE, null, true), null, {
      summary: summary(null, "feed"),
    });
    expect(startSummary(ready, null, true)).toEqual({
      kind: "loading",
      promptId: null,
      summary: summary(null, "feed"),
    });
    expect(startSummary(ready, "bullets", true)).toEqual({
      kind: "loading",
      promptId: "bullets",
      summary: null,
    });
  });

  it("asks for setup instead of loading when no AI provider is configured", () => {
    expect(startSummary(EMPTY_ARTICLE_SUMMARY_STATE, null, false)).toEqual({
      kind: "setup-needed",
      promptId: null,
      summary: null,
    });
  });

  it("ignores a response for an action the reader switched away from", () => {
    const switched = startSummary(
      startSummary(EMPTY_ARTICLE_SUMMARY_STATE, null, true),
      "bullets",
      true,
    );
    expect(settleSummary(switched, null, { summary: summary(null, "feed") })).toBe(switched);
    expect(settleSummary(switched, null, { error: "Too slow" })).toBe(switched);
  });

  it("ignores a response that arrives after the panel was reset", () => {
    expect(
      settleSummary(EMPTY_ARTICLE_SUMMARY_STATE, null, { summary: summary(null, "feed") }),
    ).toBe(EMPTY_ARTICLE_SUMMARY_STATE);
  });

  it("keeps the previous result next to the error when an update fails", () => {
    const updating = startSummary(
      settleSummary(startSummary(EMPTY_ARTICLE_SUMMARY_STATE, null, true), null, {
        summary: summary(null, "feed"),
      }),
      null,
      true,
    );
    expect(settleSummary(updating, null, { error: "Rate limited" })).toEqual({
      kind: "failed",
      promptId: null,
      summary: summary(null, "feed"),
      error: "Rate limited",
    });
  });

  it("remembers a failure after the panel closes so the action can offer a retry", () => {
    const failed = settleSummary(startSummary(EMPTY_ARTICLE_SUMMARY_STATE, null, true), null, {
      error: "Rate limited",
    });
    expect(closeSummary(failed)).toMatchObject({ kind: "closed", failed: true });
    expect(closeSummary(startSummary(EMPTY_ARTICLE_SUMMARY_STATE, null, false))).toMatchObject({
      kind: "closed",
      failed: false,
    });
  });

  it("marks a summary of the feed text out of date once the full article loads", () => {
    const fromFeed = settleSummary(startSummary(EMPTY_ARTICLE_SUMMARY_STATE, null, true), null, {
      summary: summary(null, "feed"),
    });
    expect(dropFeedTextSummary(fromFeed)).toEqual({
      kind: "outdated",
      promptId: null,
      summary: null,
    });
    expect(dropFeedTextSummary(startSummary(fromFeed, null, true))).toEqual({
      kind: "loading",
      promptId: null,
      summary: null,
    });
    const fromFullText = settleSummary(
      startSummary(EMPTY_ARTICLE_SUMMARY_STATE, null, true),
      null,
      { summary: summary(null, "full") },
    );
    expect(dropFeedTextSummary(fromFullText)).toBe(fromFullText);
  });
});

describe("article translation panel", () => {
  const translating = { kind: "translating", translation: null } as const;

  it("shows a finished translation only when it still matches the article and language", () => {
    expect(
      settleTranslation(translating, { translation: translation("German"), current: true }),
    ).toEqual({ kind: "translated", translation: translation("German") });
    expect(
      settleTranslation(translating, { translation: translation("German"), current: false }),
    ).toEqual({ kind: "original", translation: translation("German") });
  });

  it("ignores a translation that arrives after the reader went back to the original", () => {
    const original = showOriginal(translating);
    expect(original).toEqual(EMPTY_ARTICLE_TRANSLATION_STATE);
    expect(settleTranslation(original, { translation: translation("German"), current: true })).toBe(
      original,
    );
  });

  it("asks for setup when the AI provider is missing and keeps the earlier translation", () => {
    const withEarlier = { kind: "translating", translation: translation("German") } as const;
    expect(settleTranslation(withEarlier, { error: "No key", configurationMissing: true })).toEqual(
      { kind: "setup-needed", translation: translation("German") },
    );
    expect(
      settleTranslation(withEarlier, { error: "Rate limited", configurationMissing: false }),
    ).toEqual({ kind: "failed", translation: translation("German"), error: "Rate limited" });
  });

  it("keeps a translation error on screen when the article text changes", () => {
    const failed = settleTranslation(translating, {
      error: "Rate limited",
      configurationMissing: false,
    });
    expect(showOriginal(failed)).toBe(failed);
  });
});
