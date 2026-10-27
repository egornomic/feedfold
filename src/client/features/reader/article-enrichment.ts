import { isCancelledError, useIsMutating, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { telegramPostIdentity } from "../../../shared/telegram";
import type {
  AiSettings,
  AppSettings,
  Article,
  ArticleAiSummary,
  BootstrapData,
  ReadingMode,
} from "../../../shared/types";
import { xVideoPostIds } from "../../../shared/x";
import { ApiError, api, errorMessage } from "../../api/api";
import {
  articleQuery,
  counterMutationKey,
  telegramArticleMediaQuery,
  xArticleMediaQuery,
} from "../../api/query";
import { useRequestMutation } from "../../api/use-request-mutation";
import type { AppRouteController } from "../../app/route";
import {
  type ArticleSummaryViewState,
  type ArticleTranslationViewState,
  EMPTY_ARTICLE_SUMMARY_STATE,
  EMPTY_ARTICLE_TRANSLATION_STATE,
} from "./article/article-ai-state";
import { articleTranslationSourceKind, fullContentToggleAction } from "./article/article-content";
import { warmArticleImages } from "./article/article-image-url";
import type { ArticleQueueController } from "./article-queue";
import type { ReaderData } from "./reader-data";
import { articleSettingsInvalidation, invalidateArticleSummaries } from "./reader-state";

interface ArticleEnrichmentOptions {
  bootstrap: BootstrapData | null;
  queue: ArticleQueueController;
  route: AppRouteController;
  dataResource: ReaderData;
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
  const client = useQueryClient();
  const changingCounters = useIsMutating({ mutationKey: counterMutationKey }) > 0;
  const { run: mutateRequest } = useRequestMutation();
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
  const invalidate = useCallback(
    (kind: "summary" | "translation", articleId?: number) => {
      const queryKey =
        articleId === undefined ? ["enrichment", kind] : ["enrichment", kind, articleId];
      void client.cancelQueries({ queryKey });
      client.removeQueries({ queryKey });
    },
    [client],
  );
  const translationLanguageRef = useRef(bootstrap?.settings.translationLanguage);
  const previousQueryRevision = useRef(queue.queryRevision);
  translationLanguageRef.current = bootstrap?.settings.translationLanguage;

  useEffect(() => {
    if (previousQueryRevision.current === queue.queryRevision) return;
    previousQueryRevision.current = queue.queryRevision;
    fullContentVisibleIdsRef.current = new Set();
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
      if (!retry && articleContentErrors.has(article.id)) return;

      if (retry) {
        setArticleContentErrors((current) => {
          if (!current.has(article.id)) return current;
          const next = new Map(current);
          next.delete(article.id);
          return next;
        });
      }
      try {
        const fullArticle = await client.fetchQuery(articleQuery(article.id));
        if (fullContentVisibleIdsRef.current.has(article.id)) return;
        warmArticleImages(fullArticle.feedContentHtml);
        // Media inserted after the text appears pushes it down, so fetch its details with the text.
        for (const postId of xVideoPostIds(fullArticle.url, fullArticle.feedContentHtml))
          void client.prefetchQuery(xArticleMediaQuery(fullArticle.id, postId));
        if (telegramPostIdentity(fullArticle.url))
          void client.prefetchQuery(telegramArticleMediaQuery(fullArticle.id));
        queue.mergeArticle(fullArticle);
      } catch (caught) {
        if (isCancelledError(caught)) return;
        setArticleContentErrors((current) =>
          new Map(current).set(article.id, errorMessage(caught)),
        );
      }
    },
    [articleContentErrors, client, queue],
  );

  useEffect(() => {
    if (readingMode !== "magazine" || queue.loading) return;
    // Keep the articles one step back and two steps ahead ready, so rapid navigation never waits.
    const active = Math.max(0, queue.activeArticleIndex);
    for (const article of queue.articles.slice(Math.max(0, active - 1), active + 3)) {
      void loadFullArticle(article);
    }
  }, [loadFullArticle, queue, readingMode]);

  const mergeExtractedArticle = useCallback(
    (extracted: Article) => {
      queue.mergeArticle(extracted);
      if (extracted.extractionStatus !== "complete") return;
      // A result made from the feed text no longer describes the full article.
      setArticleSummaryStates((current) => {
        const state = current.get(extracted.id);
        if (!state?.summary || state.summary.sourceKind === "full") return current;
        return new Map(current).set(extracted.id, { ...state, summary: null });
      });
    },
    [queue.mergeArticle],
  );

  const extractingArticle = queue.activeArticle;
  const extraction = useQuery({
    ...articleQuery(extractingArticle?.id ?? 0),
    enabled:
      !changingCounters &&
      extractingArticle !== null &&
      fullContentVisibleIds.has(extractingArticle.id) &&
      (extractingArticle.extractionStatus === "pending" ||
        extractingArticle.extractionStatus === "processing"),
    refetchInterval: 2_000,
  });
  useEffect(() => {
    if (extraction.data && fullContentVisibleIds.has(extraction.data.id))
      mergeExtractedArticle(extraction.data);
  }, [extraction.data, fullContentVisibleIds, mergeExtractedArticle]);

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
        mergeExtractedArticle(await mutateRequest(() => api.loadFullContent(article.id)));
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
    [
      invalidate,
      loadFullArticle,
      mergeExtractedArticle,
      mutateRequest,
      patchArticleTranslationState,
      showToast,
    ],
  );

  const patchArticleSummaryState = useCallback(
    (articleId: number, change: Partial<ArticleSummaryViewState>, promptId?: string | null) => {
      setArticleSummaryStates((current) => {
        const state = current.get(articleId) ?? EMPTY_ARTICLE_SUMMARY_STATE;
        // A response for an action the reader has since switched away from must not replace it.
        if (promptId !== undefined && state.promptId !== promptId) return current;
        return new Map(current).set(articleId, { ...state, ...change });
      });
    },
    [],
  );

  const summaryQueryKey = useCallback(
    (articleId: number, promptId: string | null) => [
      "enrichment",
      "summary",
      articleId,
      promptId,
      bootstrap?.settings.customPrompts,
    ],
    [bootstrap?.settings.customPrompts],
  );

  const generateArticleSummary = useCallback(
    async (article: Article, promptId: string | null, regenerate: boolean) => {
      const isYouTubeVideo = article.media?.provider === "youtube";
      const feature = bootstrap?.aiSettings.features.articleSummary;
      const provider = feature
        ? bootstrap?.aiSettings.providers.find((option) => option.id === feature.provider)
        : null;
      const previous = articleSummaryStates.get(article.id);
      const start = {
        visible: true,
        error: null,
        promptId,
        // Updating keeps the current result readable; another action starts from its own skeleton.
        summary: previous?.promptId === promptId ? previous.summary : null,
      };
      if (
        !isYouTubeVideo &&
        (!bootstrap?.aiSettings.credentialStorageAvailable || !feature || !provider?.configured)
      ) {
        patchArticleSummaryState(article.id, {
          ...start,
          loading: false,
          configurationMissing: true,
        });
        return;
      }

      patchArticleSummaryState(article.id, {
        ...start,
        loading: true,
        configurationMissing: false,
      });
      try {
        const summary = await client.fetchQuery({
          queryKey: summaryQueryKey(article.id, promptId),
          queryFn: () =>
            mutateRequest(() =>
              api.summarizeArticle(
                article.id,
                promptId,
                regenerate,
                isYouTubeVideo ? "gemini" : feature?.provider,
              ),
            ),
          staleTime: regenerate ? 0 : Infinity,
          retry: false,
        });
        patchArticleSummaryState(article.id, { loading: false, summary }, promptId);
      } catch (caught) {
        if (isCancelledError(caught)) return;
        patchArticleSummaryState(
          article.id,
          { loading: false, error: errorMessage(caught) },
          promptId,
        );
      }
    },
    [
      articleSummaryStates,
      bootstrap?.aiSettings,
      client,
      mutateRequest,
      patchArticleSummaryState,
      summaryQueryKey,
    ],
  );

  const runArticleSummaryPrompt = useCallback(
    (article: Article, promptId: string | null) => {
      const state = articleSummaryStates.get(article.id) ?? EMPTY_ARTICLE_SUMMARY_STATE;
      const shown = { visible: true, error: null, configurationMissing: false };
      if (state.promptId === promptId && (state.loading || state.summary)) {
        patchArticleSummaryState(article.id, state.loading ? { visible: true } : shown);
        return;
      }
      // This session's latest result is newer than the one saved with the article.
      const summary =
        client.getQueryData<ArticleAiSummary>(summaryQueryKey(article.id, promptId)) ??
        (article.aiSummary?.promptId === promptId ? article.aiSummary : null);
      if (summary) {
        patchArticleSummaryState(article.id, { ...shown, loading: false, promptId, summary });
        return;
      }
      void generateArticleSummary(article, promptId, false);
    },
    [
      articleSummaryStates,
      client,
      generateArticleSummary,
      patchArticleSummaryState,
      summaryQueryKey,
    ],
  );

  const toggleArticleSummary = useCallback(
    (article: Article) => {
      const state = articleSummaryStates.get(article.id) ?? EMPTY_ARTICLE_SUMMARY_STATE;
      if (state.visible && state.promptId === null && !state.loading) {
        patchArticleSummaryState(article.id, { visible: false });
        return;
      }
      runArticleSummaryPrompt(article, null);
    },
    [articleSummaryStates, patchArticleSummaryState, runArticleSummaryPrompt],
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

      patchArticleTranslationState(article.id, {
        visible: false,
        loading: true,
        error: null,
        configurationMissing: false,
      });
      try {
        const translation = await client.fetchQuery({
          queryKey: [
            "enrichment",
            "translation",
            article.id,
            sourceKind,
            bootstrap?.settings.translationLanguage,
          ],
          queryFn: () =>
            mutateRequest(() =>
              api.translateArticle(
                article.id,
                sourceKind,
                bootstrap?.aiSettings.features.articleSummary?.provider,
              ),
            ),
          staleTime: Infinity,
          retry: false,
        });
        const currentArticle = queue.getArticles().find((item) => item.id === article.id);
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
        if (isCancelledError(caught)) return;
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
      }
    },
    [
      bootstrap?.aiSettings,
      bootstrap?.settings.translationLanguage,
      client,
      mutateRequest,
      patchArticleTranslationState,
      queue.getArticles,
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
