import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AiSettings,
  AppSettings,
  Article,
  BootstrapData,
  ReadingMode,
} from "../../../shared/types";
import { ApiError, api, errorMessage } from "../../api/api";
import type { AppRouteController } from "../../app/route";
import {
  type ArticleSummaryViewState,
  type ArticleTranslationViewState,
  EMPTY_ARTICLE_SUMMARY_STATE,
  EMPTY_ARTICLE_TRANSLATION_STATE,
} from "./article/article-ai-state";
import { articleTranslationSourceKind, fullContentToggleAction } from "./article/article-content";
import type { ArticleQueueController } from "./article-queue";
import type { ReaderDataResource } from "./data-resource";
import { articleSettingsInvalidation, invalidateArticleSummaries } from "./reader-state";

type ArticleAiRequestKind = "summary" | "translation";

function useArticleAiRequestLifecycle() {
  const activeRequests = useRef<Record<ArticleAiRequestKind, Map<number, number>>>({
    summary: new Map(),
    translation: new Map(),
  });
  const nextRequestId = useRef(0);

  const start = useCallback((kind: ArticleAiRequestKind, articleId: number): number | null => {
    const requests = activeRequests.current[kind];
    if (requests.has(articleId)) return null;
    const requestId = nextRequestId.current + 1;
    nextRequestId.current = requestId;
    requests.set(articleId, requestId);
    return requestId;
  }, []);

  const isCurrent = useCallback(
    (kind: ArticleAiRequestKind, articleId: number, requestId: number): boolean =>
      activeRequests.current[kind].get(articleId) === requestId,
    [],
  );

  const finish = useCallback(
    (kind: ArticleAiRequestKind, articleId: number, requestId: number): void => {
      const requests = activeRequests.current[kind];
      if (requests.get(articleId) === requestId) requests.delete(articleId);
    },
    [],
  );

  const invalidate = useCallback((kind: ArticleAiRequestKind, articleId?: number): void => {
    const requests = activeRequests.current[kind];
    if (articleId === undefined) requests.clear();
    else requests.delete(articleId);
  }, []);

  return { start, isCurrent, finish, invalidate };
}

interface ArticleEnrichmentOptions {
  bootstrap: BootstrapData | null;
  queue: ArticleQueueController;
  route: AppRouteController;
  dataResource: ReaderDataResource;
  readingMode: ReadingMode;
  showToast: (message: string) => void;
}

export function useArticleEnrichment({
  bootstrap,
  queue,
  route,
  dataResource,
  readingMode,
  showToast,
}: ArticleEnrichmentOptions) {
  const [fullContentVisibleIds, setFullContentVisibleIds] = useState<Set<number>>(() => new Set());
  const [articleSummaryStates, setArticleSummaryStates] = useState<
    Map<number, ArticleSummaryViewState>
  >(() => new Map());
  const [articleTranslationStates, setArticleTranslationStates] = useState<
    Map<number, ArticleTranslationViewState>
  >(() => new Map());
  const [articleContentErrors, setArticleContentErrors] = useState<Map<number, string>>(
    () => new Map(),
  );
  const fullContentVisibleIdsRef = useRef(new Set<number>());
  const fullContentLoadingIds = useRef(new Set<number>());
  const { start, isCurrent, finish, invalidate } = useArticleAiRequestLifecycle();
  const translationLanguageRef = useRef(bootstrap?.settings.translationLanguage);
  const previousQueryRevision = useRef(queue.queryRevision);
  translationLanguageRef.current = bootstrap?.settings.translationLanguage;

  useEffect(() => {
    if (previousQueryRevision.current === queue.queryRevision) return;
    previousQueryRevision.current = queue.queryRevision;
    fullContentVisibleIdsRef.current = new Set();
    fullContentLoadingIds.current.clear();
    setArticleContentErrors(new Map());
    invalidate("translation");
    setFullContentVisibleIds(new Set());
    setArticleTranslationStates(new Map());
  }, [invalidate, queue.queryRevision]);

  useEffect(
    () => () => {
      invalidate("summary");
      invalidate("translation");
    },
    [invalidate],
  );

  const loadFullArticle = useCallback(
    async (article: Article, retry = false) => {
      if (queue.fullContentLoadedIds.current.has(article.id)) return;
      if (fullContentLoadingIds.current.has(article.id)) return;
      if (!retry && articleContentErrors.has(article.id)) return;

      fullContentLoadingIds.current.add(article.id);
      if (retry) {
        setArticleContentErrors((current) => {
          if (!current.has(article.id)) return current;
          const next = new Map(current);
          next.delete(article.id);
          return next;
        });
      }
      try {
        const fullArticle = await api.article(article.id);
        if (!fullContentVisibleIdsRef.current.has(article.id)) queue.mergeArticle(fullArticle);
      } catch (caught) {
        setArticleContentErrors((current) =>
          new Map(current).set(article.id, errorMessage(caught)),
        );
      } finally {
        fullContentLoadingIds.current.delete(article.id);
      }
    },
    [articleContentErrors, queue],
  );

  useEffect(() => {
    if (readingMode !== "magazine" || queue.loading || queue.activeArticleIndex < 0) return;
    for (const article of queue.articles.slice(
      queue.activeArticleIndex,
      queue.activeArticleIndex + 2,
    )) {
      void loadFullArticle(article);
    }
  }, [loadFullArticle, queue, readingMode]);

  useEffect(() => {
    if (
      (readingMode === "magazine" && route.routedArticleId === null) ||
      !queue.activeArticle ||
      !fullContentVisibleIds.has(queue.activeArticle.id) ||
      (queue.activeArticle.extractionStatus !== "pending" &&
        queue.activeArticle.extractionStatus !== "processing")
    ) {
      return;
    }
    const articleId = queue.activeArticle.id;
    const poll = window.setInterval(() => {
      void api
        .article(articleId)
        .then(queue.mergeArticle)
        .catch(() => {
          // A transient poll error should not replace readable feed content with an error screen.
        });
    }, 2000);
    return () => window.clearInterval(poll);
  }, [
    fullContentVisibleIds,
    queue.activeArticle,
    queue.mergeArticle,
    readingMode,
    route.routedArticleId,
  ]);

  useEffect(() => {
    if (route.routedArticleId !== null && queue.activeArticle?.id === route.routedArticleId) {
      void loadFullArticle(queue.activeArticle);
    }
  }, [loadFullArticle, queue.activeArticle, route.routedArticleId]);

  const patchArticleTranslationState = useCallback(
    (articleId: number, change: Partial<ArticleTranslationViewState>) => {
      setArticleTranslationStates((current) => {
        const next = new Map(current);
        next.set(articleId, {
          ...(current.get(articleId) ?? EMPTY_ARTICLE_TRANSLATION_STATE),
          ...change,
        });
        return next;
      });
    },
    [],
  );

  const toggleFullContent = useCallback(
    async (article: Article) => {
      if (!article.url || article.media) return;
      const action = fullContentToggleAction(
        article,
        fullContentVisibleIdsRef.current.has(article.id),
      );
      if (action === "wait") return;
      invalidate("translation", article.id);
      patchArticleTranslationState(article.id, { visible: false, loading: false });
      if (action === "hide") {
        fullContentVisibleIdsRef.current.delete(article.id);
        setFullContentVisibleIds((current) => {
          const next = new Set(current);
          next.delete(article.id);
          return next;
        });
        return;
      }
      fullContentVisibleIdsRef.current.add(article.id);
      setFullContentVisibleIds((current) => new Set(current).add(article.id));
      if (action === "show") return;
      try {
        queue.mergeArticle(await api.loadFullContent(article.id));
      } catch (caught) {
        fullContentVisibleIdsRef.current.delete(article.id);
        setFullContentVisibleIds((current) => {
          const next = new Set(current);
          next.delete(article.id);
          return next;
        });
        showToast(`Could not load the full article: ${errorMessage(caught)}`);
        void loadFullArticle(article);
      }
    },
    [invalidate, loadFullArticle, patchArticleTranslationState, queue, showToast],
  );

  const patchArticleSummaryState = useCallback(
    (articleId: number, change: Partial<ArticleSummaryViewState>) => {
      setArticleSummaryStates((current) => {
        const next = new Map(current);
        next.set(articleId, {
          ...(current.get(articleId) ?? EMPTY_ARTICLE_SUMMARY_STATE),
          ...change,
        });
        return next;
      });
    },
    [],
  );

  const generateArticleSummary = useCallback(
    async (article: Article, promptId: string | null, regenerate: boolean) => {
      const isYouTubeVideo = article.media?.provider === "youtube";
      const feature = bootstrap?.aiSettings.features.articleSummary;
      const provider = feature
        ? bootstrap?.aiSettings.providers.find((option) => option.id === feature.provider)
        : null;
      if (
        !isYouTubeVideo &&
        (!bootstrap?.aiSettings.credentialStorageAvailable || !feature || !provider?.configured)
      ) {
        patchArticleSummaryState(article.id, {
          visible: true,
          loading: false,
          error: null,
          configurationMissing: true,
          promptId,
        });
        return;
      }

      const requestId = start("summary", article.id);
      if (requestId === null) return;
      patchArticleSummaryState(article.id, {
        visible: true,
        loading: true,
        error: null,
        configurationMissing: false,
        promptId,
      });
      try {
        const summary = await api.summarizeArticle(
          article.id,
          promptId,
          regenerate,
          isYouTubeVideo ? "gemini" : feature?.provider,
        );
        if (!isCurrent("summary", article.id, requestId)) return;
        queue.setArticles((current) =>
          current.map((item) => (item.id === article.id ? { ...item, aiSummary: summary } : item)),
        );
        patchArticleSummaryState(article.id, { loading: false });
      } catch (caught) {
        if (!isCurrent("summary", article.id, requestId)) return;
        patchArticleSummaryState(article.id, { loading: false, error: errorMessage(caught) });
      } finally {
        finish("summary", article.id, requestId);
      }
    },
    [bootstrap?.aiSettings, finish, isCurrent, patchArticleSummaryState, queue, start],
  );

  const toggleArticleSummary = useCallback(
    (article: Article) => {
      const state = articleSummaryStates.get(article.id) ?? EMPTY_ARTICLE_SUMMARY_STATE;
      if (state.loading) return;
      if (state.visible && article.aiSummary?.promptId === null) {
        patchArticleSummaryState(article.id, { visible: false });
        return;
      }
      if (article.aiSummary?.promptId === null) {
        patchArticleSummaryState(article.id, {
          visible: true,
          error: null,
          configurationMissing: false,
          promptId: null,
        });
        return;
      }
      void generateArticleSummary(article, null, false);
    },
    [articleSummaryStates, generateArticleSummary, patchArticleSummaryState],
  );

  const runArticleSummaryPrompt = useCallback(
    (article: Article, promptId: string | null) => {
      const state = articleSummaryStates.get(article.id) ?? EMPTY_ARTICLE_SUMMARY_STATE;
      if (state.loading) return;
      if (article.aiSummary?.promptId === promptId) {
        patchArticleSummaryState(article.id, {
          visible: true,
          error: null,
          configurationMissing: false,
          promptId,
        });
        return;
      }
      void generateArticleSummary(article, promptId, false);
    },
    [articleSummaryStates, generateArticleSummary, patchArticleSummaryState],
  );

  const regenerateArticleSummary = useCallback(
    (article: Article) => {
      const state = articleSummaryStates.get(article.id);
      const promptId = state ? state.promptId : (article.aiSummary?.promptId ?? null);
      void generateArticleSummary(article, promptId, true);
    },
    [articleSummaryStates, generateArticleSummary],
  );

  const generateArticleTranslation = useCallback(
    async (article: Article) => {
      const sourceKind = articleTranslationSourceKind(
        article,
        fullContentVisibleIdsRef.current.has(article.id),
      );
      const requestId = start("translation", article.id);
      if (requestId === null) return;
      patchArticleTranslationState(article.id, {
        visible: false,
        loading: true,
        error: null,
        configurationMissing: false,
      });
      try {
        const translation = await api.translateArticle(
          article.id,
          sourceKind,
          bootstrap?.aiSettings.features.articleSummary?.provider,
        );
        if (!isCurrent("translation", article.id, requestId)) return;
        const currentArticle = queue.articlesRef.current.find((item) => item.id === article.id);
        const currentSourceKind = currentArticle
          ? articleTranslationSourceKind(
              currentArticle,
              fullContentVisibleIdsRef.current.has(article.id),
            )
          : sourceKind;
        patchArticleTranslationState(article.id, {
          visible:
            currentSourceKind === translation.sourceKind &&
            translation.language === translationLanguageRef.current,
          loading: false,
          translation,
        });
      } catch (caught) {
        if (!isCurrent("translation", article.id, requestId)) return;
        const configurationMissing =
          caught instanceof ApiError &&
          ["AI_NOT_CONFIGURED", "AI_KEY_MISSING", "AI_CREDENTIAL_STORAGE_UNAVAILABLE"].includes(
            caught.code ?? "",
          );
        patchArticleTranslationState(article.id, {
          visible: false,
          loading: false,
          error: configurationMissing ? null : errorMessage(caught),
          configurationMissing,
        });
      } finally {
        finish("translation", article.id, requestId);
      }
    },
    [
      bootstrap?.aiSettings,
      finish,
      isCurrent,
      patchArticleTranslationState,
      queue.articlesRef,
      start,
    ],
  );

  const toggleArticleTranslation = useCallback(
    (article: Article) => {
      const state = articleTranslationStates.get(article.id) ?? EMPTY_ARTICLE_TRANSLATION_STATE;
      if (state.loading) return;
      if (state.visible) {
        patchArticleTranslationState(article.id, { visible: false });
        return;
      }
      const sourceKind = articleTranslationSourceKind(
        article,
        fullContentVisibleIdsRef.current.has(article.id),
      );
      const { translation } = state;
      if (
        translation !== null &&
        translation.language === bootstrap?.settings.translationLanguage &&
        translation.sourceKind === sourceKind
      ) {
        patchArticleTranslationState(article.id, {
          visible: true,
          error: null,
          configurationMissing: false,
        });
        return;
      }
      void generateArticleTranslation(article);
    },
    [
      articleTranslationStates,
      bootstrap?.settings.translationLanguage,
      generateArticleTranslation,
      patchArticleTranslationState,
    ],
  );

  const applySettings = useCallback(
    (settings: AppSettings) => {
      if (!bootstrap) return;
      const invalidation = articleSettingsInvalidation(bootstrap.settings, settings);
      if (invalidation.resetTranslationState) {
        invalidate("translation");
        setArticleTranslationStates(new Map());
      }
      if (invalidation.invalidatedSummaryPromptIds.size > 0) {
        invalidate("summary");
        setArticleSummaryStates(new Map());
        queue.setArticles((current) =>
          invalidateArticleSummaries(current, invalidation.invalidatedSummaryPromptIds),
        );
      }
      dataResource.mutateBootstrap((current) => ({ ...current, settings }));
    },
    [bootstrap, dataResource, invalidate, queue],
  );

  const applyAiSettings = useCallback(
    (aiSettings: AiSettings) => {
      dataResource.mutateBootstrap((current) => ({ ...current, aiSettings }));
    },
    [dataResource],
  );

  return {
    articleContentErrors,
    loadFullArticle,
    retryArticleContent: (article: Article) => void loadFullArticle(article, true),
    fullContentVisibleIds,
    articleSummaryStates,
    articleTranslationStates,
    toggleFullContent,
    toggleArticleSummary,
    runArticleSummaryPrompt,
    regenerateArticleSummary,
    toggleArticleTranslation,
    applySettings,
    applyAiSettings,
  };
}

export type ArticleEnrichmentController = ReturnType<typeof useArticleEnrichment>;
