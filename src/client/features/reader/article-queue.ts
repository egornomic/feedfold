import { useInfiniteQuery, useIsMutating, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Article, ReadingMode } from "../../../shared/types";
import { errorMessage } from "../../api/api";
import { articlePagesQuery, articleQuery, counterMutationKey, readerKeys } from "../../api/query";
import type { AppRouteController } from "../../app/route";
import { appRoutePath, type ReaderRoute } from "../../app/routes";
import { useDelayedPending } from "../../ui/loading";
import { articlesWithContextReturn, type ContextArticleReturn } from "./contextual-filter";
import {
  appendUnseenArticles,
  articleQueryForReaderRoute,
  articlesWithUpdatedState,
  firstUnseenArticlePage,
} from "./reader-state";

export interface ArticleQueueController {
  readingMode: ReadingMode;
  articles: Article[];
  setArticles: Dispatch<SetStateAction<Article[]>>;
  articlesRef: React.RefObject<Article[]>;
  loading: boolean;
  showLoading: boolean;
  loadedReaderRoute: ReaderRoute | null;
  loadingMore: boolean;
  error: string | null;
  nextCursor: string | null;
  activeArticleId: number | null;
  activeArticle: Article | null;
  activeArticleIndex: number;
  expandedKeyboardTargetId: number | null;
  queryRevision: number;
  fullContentLoadedIds: React.RefObject<Set<number>>;
  loadArticles: () => Promise<void>;
  loadOlderArticles: () => Promise<Article[]>;
  selectArticle: (articleId: number, keyboardTarget?: boolean) => void;
  clearKeyboardTarget: () => void;
  mergeArticle: (article: Article) => void;
  preserveContextArticle: (
    article: Article,
    articleIndex: number,
    returnRoute: ReaderRoute,
  ) => void;
  invalidate: () => void;
  retryRoutedArticle: () => void;
}

interface ArticleQueueOptions {
  route: AppRouteController;
  enabled: boolean;
  readingMode: ReadingMode;
  onReadingModeChange: (mode: ReadingMode) => void;
  showToast: (message: string) => void;
}

export function useArticleQueue({
  route,
  enabled,
  readingMode,
  onReadingModeChange,
  showToast,
}: ArticleQueueOptions): ArticleQueueController {
  const client = useQueryClient();
  const changingCounters = useIsMutating({ mutationKey: counterMutationKey }) > 0;
  const [articles, updateArticles] = useState<Article[]>([]);
  const articlesRef = useRef(articles);
  const setArticles: Dispatch<SetStateAction<Article[]>> = useCallback((update) => {
    const next = typeof update === "function" ? update(articlesRef.current) : update;
    articlesRef.current = next;
    updateArticles(next);
  }, []);
  const [displayedReadingMode, setDisplayedReadingMode] = useState(readingMode);
  const [loadedReaderRoute, setLoadedReaderRoute] = useState<ReaderRoute | null>(null);
  const [activeArticleId, setActiveArticleId] = useState<number | null>(route.routedArticleId);
  const [expandedKeyboardTargetId, setExpandedKeyboardTargetId] = useState<number | null>(
    route.routedArticleId,
  );
  const [queryRevision, setQueryRevision] = useState(0);
  const fullContentLoadedIds = useRef(new Set<number>());
  const contextReturn = useRef<(ContextArticleReturn & { route: ReaderRoute }) | null>(null);
  const [anchor, setAnchor] = useState<number | null>(() => route.routedArticleId);
  const [anchorReady, setAnchorReady] = useState(route.routedArticleId === null);
  const applied = useRef<{ key: string; data: unknown; updatedAt: number } | null>(null);
  const appliedDetail = useRef<Article | null>(null);
  const previousRouteKind = useRef(route.route.kind);

  const detail = useQuery({
    ...articleQuery(route.routedArticleId ?? 0),
    enabled: enabled && route.routedArticleId !== null && !changingCounters,
  });
  const request = articleQueryForReaderRoute(route.readerRoute, {
    limit: readingMode === "expanded" ? 20 : 100,
    includeContent: readingMode === "expanded",
    ...(anchor !== null ? { anchorId: anchor } : {}),
  });
  const options = articlePagesQuery(request);
  const requestKey = JSON.stringify(options.queryKey);
  const pages = useInfiniteQuery({
    ...options,
    enabled: enabled && anchorReady && route.view === "reader" && !changingCounters,
  });
  const latestRequestKey = useRef(requestKey);
  latestRequestKey.current = requestKey;

  useLayoutEffect(() => {
    const article = detail.data;
    if (
      !article ||
      article.id !== route.routedArticleId ||
      changingCounters ||
      appliedDetail.current === article
    )
      return;
    appliedDetail.current = article;
    fullContentLoadedIds.current.add(article.id);
    setArticles((current) =>
      current.some((item) => item.id === article.id)
        ? current.map((item) => (item.id === article.id ? article : item))
        : [article, ...current],
    );
    setActiveArticleId(article.id);
    if (!anchorReady) {
      const context = route.articleContext();
      const surrounding: ReaderRoute = context?.route ?? {
        kind: "reader",
        scope: "feed",
        scopeId: article.feedId,
        state: "all",
        search: "",
      };
      route.setArticleContext(surrounding, context?.articleIndex);
      setLoadedReaderRoute(surrounding);
      setAnchorReady(true);
    }
  }, [
    detail.data,
    route.routedArticleId,
    anchorReady,
    changingCounters,
    route.articleContext,
    route.setArticleContext,
    setArticles,
  ]);

  useLayoutEffect(() => {
    if (route.routedArticleId !== null) setActiveArticleId(route.routedArticleId);
    const returning = previousRouteKind.current === "article" && route.route.kind === "reader";
    previousRouteKind.current = route.route.kind;
    if (!returning) return;
    setAnchor(null);
    const target = contextReturn.current;
    setArticles((current) =>
      current.filter((article) => {
        if (article.id === target?.article.id) return true;
        if (route.readerRoute.state === "unread") return !article.isRead;
        if (route.readerRoute.state === "read") return article.isRead;
        if (route.readerRoute.state === "starred") return article.isStarred;
        return true;
      }),
    );
  }, [route.route.kind, route.routedArticleId, route.readerRoute.state, setArticles]);

  useLayoutEffect(() => {
    if (!pages.data || route.view !== "reader" || changingCounters) return;
    if (
      applied.current?.key === requestKey &&
      applied.current.data === pages.data &&
      applied.current.updatedAt === pages.dataUpdatedAt
    )
      return;
    const sameQueue = applied.current?.key === requestKey;
    const candidates = appendUnseenArticles(
      [],
      pages.data.pages.flatMap((page) => page.articles),
    ).articles;
    const target = contextReturn.current;
    const returnTarget =
      target && appRoutePath(target.route) === appRoutePath(route.readerRoute) ? target : null;
    const current = articlesRef.current;
    const reading = route.routedArticleId !== null || (sameQueue && readingMode === "expanded");
    let next =
      reading && (sameQueue || anchor === null)
        ? appendUnseenArticles(articlesWithUpdatedState(current, candidates), candidates).articles
        : candidates.map((article) => {
            const complete = current.find((item) => item.id === article.id);
            return complete && fullContentLoadedIds.current.has(article.id)
              ? { ...complete, isRead: article.isRead, isStarred: article.isStarred }
              : article;
          });
    next = articlesWithContextReturn(next, returnTarget);
    if (readingMode === "expanded")
      for (const article of candidates) fullContentLoadedIds.current.add(article.id);
    if (detail.data && route.routedArticleId === detail.data.id) {
      next = next.map((article) =>
        article.id === detail.data.id
          ? { ...detail.data, isRead: article.isRead, isStarred: article.isStarred }
          : article,
      );
    }
    applied.current = { key: requestKey, data: pages.data, updatedAt: pages.dataUpdatedAt };
    setArticles(next);
    setLoadedReaderRoute(route.readerRoute);
    setDisplayedReadingMode(readingMode);
    setActiveArticleId(
      (id) =>
        returnTarget?.article.id ??
        (next.some((article) => article.id === id) ? id : (next[0]?.id ?? null)),
    );
    if (!sameQueue) {
      setQueryRevision((revision) => revision + 1);
      setExpandedKeyboardTargetId(
        returnTarget && readingMode === "expanded" ? returnTarget.article.id : null,
      );
    }
    if (returnTarget) contextReturn.current = null;
  }, [
    pages.data,
    pages.dataUpdatedAt,
    anchor,
    requestKey,
    readingMode,
    route.view,
    route.routedArticleId,
    route.readerRoute,
    detail.data,
    changingCounters,
    setArticles,
  ]);

  useLayoutEffect(() => {
    if (pages.isError && readingMode !== displayedReadingMode && loadedReaderRoute) {
      onReadingModeChange(displayedReadingMode);
      showToast(`Could not change reading view: ${errorMessage(pages.error)}`);
    }
  }, [
    pages.isError,
    pages.error,
    readingMode,
    displayedReadingMode,
    loadedReaderRoute,
    onReadingModeChange,
    showToast,
  ]);

  const loadOlderArticles = useCallback(async () => {
    const cursor = pages.data?.pages.at(-1)?.nextCursor;
    if (!cursor || pages.isFetching || changingCounters) return [];
    const before = articlesRef.current;
    try {
      const { appended } = await firstUnseenArticlePage(before, cursor, async () => {
        if (latestRequestKey.current !== requestKey) return;
        const result = await pages.fetchNextPage({ cancelRefetch: false, throwOnError: true });
        return {
          candidates: result.data?.pages.flatMap((page) => page.articles) ?? [],
          nextCursor: result.data?.pages.at(-1)?.nextCursor ?? null,
        };
      });
      if (latestRequestKey.current !== requestKey) return [];
      setArticles((current) => appendUnseenArticles(current, appended).articles);
      return appended;
    } catch (error) {
      showToast(`Could not load more articles: ${errorMessage(error)}`);
      return [];
    }
  }, [pages, changingCounters, requestKey, setArticles, showToast]);

  const loadArticles = useCallback(async () => {
    await client.invalidateQueries({ queryKey: readerKeys.lists });
  }, [client]);
  const mergeArticle = useCallback(
    (updated: Article) => {
      fullContentLoadedIds.current.add(updated.id);
      setArticles((current) =>
        current.map((article) =>
          article.id === updated.id
            ? { ...updated, isRead: article.isRead, isStarred: article.isStarred }
            : article,
        ),
      );
    },
    [setArticles],
  );
  const selectArticle = useCallback((id: number, keyboardTarget = false) => {
    setActiveArticleId(id);
    setExpandedKeyboardTargetId(keyboardTarget ? id : null);
  }, []);
  const activeArticleIndex = useMemo(
    () => articles.findIndex((article) => article.id === activeArticleId),
    [articles, activeArticleId],
  );
  const articleReady =
    route.routedArticleId !== null &&
    articles.some((article) => article.id === route.routedArticleId);
  const loading =
    route.routedArticleId !== null ? !articleReady && detail.isPending : pages.isPending;
  const showLoading = useDelayedPending(loading && route.route.kind === "reader", requestKey);
  const error =
    route.routedArticleId !== null
      ? !articleReady && detail.error
        ? errorMessage(detail.error)
        : null
      : pages.error && !pages.data
        ? errorMessage(pages.error)
        : null;

  return {
    readingMode: displayedReadingMode,
    articles,
    setArticles,
    articlesRef,
    loading,
    showLoading: loading && (route.route.kind !== "reader" || showLoading),
    loadedReaderRoute,
    loadingMore: pages.isFetchingNextPage || (articleReady && pages.isPending),
    error,
    nextCursor: pages.data?.pages.at(-1)?.nextCursor ?? null,
    activeArticleId,
    activeArticle: articles[activeArticleIndex] ?? null,
    activeArticleIndex,
    expandedKeyboardTargetId,
    queryRevision,
    fullContentLoadedIds,
    loadArticles,
    loadOlderArticles,
    selectArticle,
    clearKeyboardTarget: () => setExpandedKeyboardTargetId(null),
    mergeArticle,
    preserveContextArticle: (article, index, returnRoute) => {
      contextReturn.current = { article, index, route: returnRoute };
    },
    invalidate: () => {
      void client.invalidateQueries({ queryKey: readerKeys.lists });
    },
    retryRoutedArticle: () => {
      void detail.refetch();
    },
  };
}
