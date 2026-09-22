import { useCallback, useEffect, useRef, useState } from "react";
import type { Article, MarkReadAgeDays, ReadingMode } from "../../../shared/types";
import { api, errorMessage } from "../../api/api";
import type { AppRouteController } from "../../app/route";
import { copyText } from "../../platform/clipboard";
import type { ArticleEnrichmentController } from "./article-enrichment";
import type { ArticleQueueController } from "./article-queue";
import type { ReaderDataResource } from "./data-resource";
import { shouldAutoMarkRoutedArticleRead, updateBootstrapCounts } from "./reader-state";

interface ArticleActionsOptions {
  loadFullArticle: ArticleEnrichmentController["loadFullArticle"];
  queue: ArticleQueueController;
  route: AppRouteController;
  dataResource: ReaderDataResource;
  readingMode: ReadingMode;
  showToast: (message: string) => void;
}

export function useArticleActions({
  loadFullArticle,
  queue,
  route,
  dataResource,
  readingMode,
  showToast,
}: ArticleActionsOptions) {
  const [markReadPending, setMarkReadPending] = useState(false);
  const manuallyUnreadArticleIds = useRef(new Set<number>());
  const loadBootstrap = dataResource.loadBootstrap;
  const loadArticles = queue.loadArticles;

  const changeArticleState = useCallback(
    async (article: Article, change: { isRead?: boolean; isStarred?: boolean }) => {
      const nextRead = change.isRead ?? article.isRead;
      const nextStarred = change.isStarred ?? article.isStarred;
      const unreadDelta = nextRead === article.isRead ? 0 : nextRead ? -1 : 1;
      const starredDelta = nextStarred === article.isStarred ? 0 : nextStarred ? 1 : -1;
      const wasManuallyUnread = manuallyUnreadArticleIds.current.has(article.id);

      if (change.isRead === false) manuallyUnreadArticleIds.current.add(article.id);
      if (change.isRead === true) manuallyUnreadArticleIds.current.delete(article.id);

      queue.setArticles((current) =>
        current.map((item) =>
          item.id === article.id ? { ...item, isRead: nextRead, isStarred: nextStarred } : item,
        ),
      );
      dataResource.mutateBootstrap((current) =>
        updateBootstrapCounts(current, article, unreadDelta, starredDelta),
      );

      try {
        await dataResource.runCounterMutation(() => api.updateArticleState(article.id, change));
      } catch (caught) {
        if (wasManuallyUnread) manuallyUnreadArticleIds.current.add(article.id);
        else manuallyUnreadArticleIds.current.delete(article.id);
        queue.setArticles((current) =>
          current.map((item) =>
            item.id === article.id
              ? {
                  ...item,
                  isRead:
                    change.isRead !== undefined && item.isRead === nextRead
                      ? article.isRead
                      : item.isRead,
                  isStarred:
                    change.isStarred !== undefined && item.isStarred === nextStarred
                      ? article.isStarred
                      : item.isStarred,
                }
              : item,
          ),
        );
        dataResource.mutateBootstrap((current) =>
          updateBootstrapCounts(current, article, -unreadDelta, -starredDelta),
        );
        showToast(`Could not update the article: ${errorMessage(caught)}`);
        await loadBootstrap();
        if (route.routedArticleId === null) await loadArticles();
      }
    },
    [dataResource, loadArticles, loadBootstrap, queue, route.routedArticleId, showToast],
  );

  const activateArticle = useCallback(
    (article: Article, keyboardTarget = false) => {
      queue.selectArticle(article.id, keyboardTarget);
      if (!article.isRead) void changeArticleState(article, { isRead: true });
      void loadFullArticle(article, true);
    },
    [changeArticleState, loadFullArticle, queue],
  );

  const openArticle = useCallback(
    (article: Article, openReader = true, historyMode: "push" | "replace" = "push") => {
      activateArticle(article, !openReader);
      if (openReader) {
        route.navigate(
          { kind: "article", articleId: article.id },
          historyMode,
          queue.articles.findIndex((item) => item.id === article.id),
        );
      }
    },
    [activateArticle, queue.articles, route],
  );

  useEffect(() => {
    if (route.routedArticleId !== null && queue.activeArticle?.id === route.routedArticleId) {
      if (
        shouldAutoMarkRoutedArticleRead(
          queue.activeArticle,
          route.routedArticleId,
          manuallyUnreadArticleIds.current,
        )
      ) {
        void changeArticleState(queue.activeArticle, { isRead: true });
      }
    }
  }, [changeArticleState, queue.activeArticle, route.routedArticleId]);

  const moveArticle = useCallback(
    async (direction: 1 | -1): Promise<boolean> => {
      if (queue.articles.length === 0) return false;
      const openReader = readingMode === "magazine" || route.routedArticleId !== null;
      if (openReader && route.routedArticleId === null && queue.activeArticle) {
        openArticle(queue.activeArticle, true);
        return true;
      }
      const currentIndex = queue.articles.findIndex(
        (article) => article.id === queue.activeArticleId,
      );
      if (
        direction === 1 &&
        currentIndex === queue.articles.length - 1 &&
        queue.nextCursor &&
        !queue.loadingMore
      ) {
        const appended = await queue.loadOlderArticles();
        const next = appended[0];
        if (!next) return false;
        openArticle(next, openReader, route.routedArticleId !== null ? "replace" : "push");
        return true;
      }
      const nextIndex = Math.min(
        queue.articles.length - 1,
        Math.max(0, (currentIndex < 0 ? 0 : currentIndex) + direction),
      );
      const next = queue.articles[nextIndex];
      if (next && next.id !== queue.activeArticleId) {
        openArticle(next, openReader, route.routedArticleId !== null ? "replace" : "push");
        return true;
      }
      return false;
    },
    [openArticle, queue, readingMode, route.routedArticleId],
  );

  const copyArticleUrl = useCallback(
    async (article: Article | null) => {
      if (!article?.url) {
        showToast("This article has no source link.");
        return;
      }
      try {
        await copyText(article.url);
        showToast("Article link copied");
      } catch {
        showToast("Could not copy the article link. Copy it from the source page instead.");
      }
    },
    [showToast],
  );

  const openArticleSource = useCallback(
    (article: Article | null) => {
      if (!article?.url) {
        showToast("This article has no source link.");
        return;
      }
      window.open(article.url, "_blank", "noopener,noreferrer");
    },
    [showToast],
  );

  const markArticleBatchRead = useCallback(
    async (candidates: Article[]): Promise<boolean> => {
      const unique = new Map<number, Article>();
      for (const article of candidates) {
        if (!article.isRead) unique.set(article.id, article);
      }
      const unreadArticles = [...unique.values()];
      if (unreadArticles.length === 0) return true;

      const ids = new Set(unreadArticles.map((article) => article.id));
      const protectedIds = unreadArticles
        .filter((article) => manuallyUnreadArticleIds.current.has(article.id))
        .map((article) => article.id);
      for (const id of ids) manuallyUnreadArticleIds.current.delete(id);
      queue.setArticles((current) =>
        current.map((article) => (ids.has(article.id) ? { ...article, isRead: true } : article)),
      );
      dataResource.mutateBootstrap((current) => {
        return unreadArticles.reduce(
          (next, article) => updateBootstrapCounts(next, article, -1, 0),
          current,
        );
      });

      try {
        await dataResource.runCounterMutation(() => api.markRead({ articleIds: [...ids] }));
        return true;
      } catch (caught) {
        for (const id of protectedIds) manuallyUnreadArticleIds.current.add(id);
        showToast(`Could not mark articles as read: ${errorMessage(caught)}`);
        await Promise.all([loadBootstrap(), loadArticles()]);
        return false;
      }
    },
    [dataResource, loadArticles, loadBootstrap, queue, showToast],
  );

  const markPassedArticlesRead = useCallback(
    (candidates: Article[]) =>
      markArticleBatchRead(
        candidates.filter((article) => !manuallyUnreadArticleIds.current.has(article.id)),
      ),
    [markArticleBatchRead],
  );

  const markVisibleRead = useCallback(async () => {
    const unreadArticles = queue.articles.filter((article) => !article.isRead);
    if (unreadArticles.length === 0) {
      showToast("This view has no unread articles.");
      return;
    }
    if (await markArticleBatchRead(unreadArticles)) {
      showToast(
        `Marked ${unreadArticles.length} ${unreadArticles.length === 1 ? "article" : "articles"} as read`,
      );
    }
  }, [markArticleBatchRead, queue.articles, showToast]);

  const markOlderArticlesRead = useCallback(
    async (days: MarkReadAgeDays) => {
      setMarkReadPending(true);
      try {
        const readerRoute = route.readerRoute;
        const result = await api.markRead({
          olderThanDays: days,
          ...(readerRoute.scope === "feed" ? { feedId: readerRoute.scopeId ?? undefined } : {}),
          ...(readerRoute.scope === "folder" ? { folderId: readerRoute.scopeId ?? undefined } : {}),
        });
        await Promise.all([loadBootstrap(), loadArticles()]);
        showToast(
          result.updated === 0
            ? "No unread articles are older than that."
            : `Marked ${result.updated} ${result.updated === 1 ? "article" : "articles"} as read`,
        );
      } catch (caught) {
        showToast(`Could not mark older articles as read: ${errorMessage(caught)}`);
      } finally {
        setMarkReadPending(false);
      }
    },
    [loadArticles, loadBootstrap, route.readerRoute, showToast],
  );

  return {
    markReadPending,
    changeArticleState,
    activateArticle,
    openArticle,
    moveArticle,
    copyArticleUrl,
    openArticleSource,
    markPassedArticlesRead,
    markVisibleRead,
    markOlderArticlesRead,
  };
}
