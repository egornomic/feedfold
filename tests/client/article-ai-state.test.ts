import { JSDOM } from "jsdom";
import { act, createElement, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { DemoStore } from "../../src/demo/store.js";
import type { ApiOperation, ApiOutput, ApiRequest } from "../../src/shared/api/operations.js";
import type { DesktopResponse, FeedfoldDesktopBridge } from "../../src/shared/desktop.js";
import type {
  AppSettings,
  Article,
  ArticleAiTranslation,
  BootstrapData,
} from "../../src/shared/types.js";
import { exposeBrowserGlobals, waitFor } from "./react-harness.js";

type HarnessState = {
  bootstrap: BootstrapData;
  queue: { articles: Article[] };
  enrichment: {
    articleTranslationStates: ReadonlyMap<
      number,
      { visible: boolean; loading: boolean; translation: ArticleAiTranslation | null }
    >;
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
      let resource: { pause: () => void } | null = null;

      try {
        const enrichmentModulePath: string =
          "../../src/client/features/reader/article-enrichment.js";
        const queueModulePath: string = "../../src/client/features/reader/article-queue.js";
        const routeModulePath: string = "../../src/client/app/route.js";
        const resourceModulePath: string = "../../src/client/features/reader/data-resource.js";
        const [enrichmentModule, queueModule, routeModule, resourceModule] = await Promise.all([
          import(enrichmentModulePath),
          import(queueModulePath),
          import(routeModulePath),
          import(resourceModulePath),
        ]);
        const dataResource = new resourceModule.ReaderDataResource();
        resource = dataResource;

        function Harness() {
          const [bootstrap, setBootstrap] = useState(initialBootstrap);
          const bootstrapRef = useRef(bootstrap);
          bootstrapRef.current = bootstrap;
          const route = routeModule.useAppRoute("/");
          const queue = queueModule.useArticleQueue({
            route,
            dataResource,
            bootstrapReady: true,
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
          dataResource.connect({
            getBootstrap: () => bootstrapRef.current,
            applyBootstrap: (next: BootstrapData) => {
              bootstrapRef.current = next;
              setBootstrap(next);
            },
            setBootstrapError: () => {},
            reloadArticles: (signal: AbortSignal, mode: "query" | "mutation" | "delivery") =>
              mode === "query"
                ? queue.reloadQuery(signal)
                : mode === "delivery"
                  ? queue.reloadAfterDelivery(signal)
                  : queue.reloadAfterMutation(signal),
            reloadRules: async () => {},
          });
          current = { bootstrap, queue, enrichment };

          const article = queue.articles.find((item: Article) => item.media === null);
          const state = article ? enrichment.articleTranslationStates.get(article.id) : null;
          return createElement(
            "output",
            { "data-testid": "translation-state" },
            `${bootstrap.settings.translationLanguage}:${state?.loading ? "loading" : state?.visible ? `${state.translation?.language}:${state.translation?.sourceKind}` : "hidden"}`,
          );
        }

        root = createRoot(container);
        await act(async () => root?.render(createElement(Harness)));
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
        resource?.pause();
        if (root) await act(async () => root?.unmount());
        dom.window.close();
        if (previousActEnvironment === undefined)
          Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
        else Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousActEnvironment);
        restoreBrowserGlobals();
      }
    },
  );
});
