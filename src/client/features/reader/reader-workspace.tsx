import type { FormEvent, RefObject } from "react";
import type { Article, BootstrapData, ReadingMode } from "../../../shared/types";
import type { AppRouteController } from "../../app/route";
import { appRoutePath, type ReaderRoute } from "../../app/routes";
import { useReaderPreferences } from "../../app/session-state";
import type { FeedManagementAction } from "../feeds/feed-management";
import {
  EMPTY_ARTICLE_SUMMARY_STATE,
  EMPTY_ARTICLE_TRANSLATION_STATE,
} from "./article/article-ai-state";
import type { useArticleActions } from "./article-actions";
import type { ArticleEnrichmentController } from "./article-enrichment";
import type { ArticleQueueController } from "./article-queue";
import { readerRouteForSelection, readerScopeLabel, readerScopeUnreadCount } from "./reader-state";
import { ArticleListSkeleton, EmptyArticles, InlineError } from "./reader-states";
import { ReaderToolbar } from "./reader-toolbar";
import { ArticleList } from "./views/article-list";
import { ExpandedStream } from "./views/expanded-stream";
import { ReaderPane } from "./views/reader-pane";

interface ReaderWorkspaceProps {
  bootstrap: BootstrapData;
  queue: ArticleQueueController;
  articleActions: ReturnType<typeof useArticleActions>;
  articleEnrichment: ArticleEnrichmentController;
  route: AppRouteController;
  displayedReaderRoute: ReaderRoute;
  readerOpen: boolean;
  readingWorkspaceRef: RefObject<HTMLDivElement | null>;
  selectScope: AppRouteController["selectScope"];
  submitSearch: (event: FormEvent) => void;
  changeReadingMode: (mode: ReadingMode) => void;
  refresh: (feedId?: number, forceAll?: boolean) => Promise<void>;
  openAddFeed: () => void;
  openFeedManagementById: (feedId: number, action: FeedManagementAction) => void;
  filterSelectedText: (article: Article, text: string) => void;
}

export function ReaderWorkspace({
  bootstrap,
  queue,
  articleActions,
  articleEnrichment,
  route,
  displayedReaderRoute,
  readerOpen,
  readingWorkspaceRef,
  selectScope,
  submitSearch,
  changeReadingMode,
  refresh,
  openAddFeed,
  openFeedManagementById,
  filterSelectedText,
}: ReaderWorkspaceProps) {
  const readingMode = useReaderPreferences((state) => state.readingMode);
  const selectedFeedId = route.readerRoute.scope === "feed" ? route.readerRoute.scopeId : null;
  const selectedFolderId = route.readerRoute.scope === "folder" ? route.readerRoute.scopeId : null;
  const displayedFeedId =
    displayedReaderRoute.scope === "feed" ? displayedReaderRoute.scopeId : null;
  const displayedFolderId =
    displayedReaderRoute.scope === "folder" ? displayedReaderRoute.scopeId : null;
  const title = readerScopeLabel(
    bootstrap,
    displayedFeedId,
    displayedFolderId,
    displayedReaderRoute.state,
  );

  const readerPath = appRoutePath(displayedReaderRoute);
  return (
    <>
      <ReaderToolbar
        title={title}
        articleState={displayedReaderRoute.state}
        unreadCount={readerScopeUnreadCount(bootstrap, displayedFeedId, displayedFolderId)}
        searchInput={route.searchInput}
        searchActive={Boolean(route.readerRoute.search)}
        mode={queue.readingMode}
        refreshing={bootstrap.feeds.some((feed) => feed.refreshing)}
        markReadPending={articleActions.markReadPending || queue.loading}
        readingArticle={readerOpen && queue.readingMode === "magazine"}
        manualRefreshEnabled={bootstrap.capabilities.manualRefresh}
        onArticleStateChange={(state) => selectScope(displayedFeedId, displayedFolderId, state)}
        onSearchInput={route.setSearchInput}
        onSearch={submitSearch}
        onClearSearch={() => {
          route.setSearchInput("");
          route.navigate(
            readerRouteForSelection(route.readerRoute.state, selectedFeedId, selectedFolderId, ""),
          );
        }}
        onModeChange={changeReadingMode}
        onRefresh={() => void refresh()}
        onRefreshAll={() => void refresh(undefined, true)}
        onMarkRead={() => void articleActions.markVisibleRead()}
        onMarkReadByAge={(days) => void articleActions.markOlderArticlesRead(days)}
      />

      <div
        ref={readingWorkspaceRef}
        className={`reading-workspace mode-${queue.readingMode}${readerOpen ? " is-reading-article" : ""}`}
        aria-busy={queue.loading}
        inert={queue.loading && !queue.showLoading}
      >
        {queue.showLoading ? (
          <ArticleListSkeleton mode={queue.readingMode} />
        ) : queue.loading && !queue.loadedReaderRoute ? null : queue.error ? (
          <InlineError
            title={
              route.routedArticleId === null
                ? "Could not load articles"
                : "Could not load the article"
            }
            detail={queue.error}
            retry={() =>
              route.routedArticleId === null
                ? void queue.loadArticles()
                : queue.retryRoutedArticle()
            }
          />
        ) : queue.articles.length === 0 ? (
          <EmptyArticles
            hasFeeds={bootstrap.feeds.length > 0}
            search={displayedReaderRoute.search}
            state={displayedReaderRoute.state}
            onAddFeed={openAddFeed}
            onShowSaved={() => selectScope(null, null, "starred")}
            onShowAll={() =>
              route.navigate(
                readerRouteForSelection(
                  "all",
                  selectedFeedId,
                  selectedFolderId,
                  route.readerRoute.search,
                ),
              )
            }
            onClearSearch={() => {
              route.navigate(
                readerRouteForSelection(
                  route.readerRoute.state,
                  selectedFeedId,
                  selectedFolderId,
                  "",
                ),
              );
            }}
          />
        ) : queue.readingMode === "magazine" ? (
          <>
            <ArticleList
              key={readerPath}
              articles={queue.articles}
              activeId={queue.activeArticleId}
              markReadOnScroll={!queue.loading && bootstrap.settings.markReadOnScroll}
              showYouTubeDescriptions={bootstrap.settings.showYouTubeDescriptions}
              hasMore={queue.nextCursor !== null && queue.readingMode === readingMode}
              loadingMore={queue.loadingMore}
              onLoadMore={() => void queue.loadOlderArticles()}
              onOpen={articleActions.openArticle}
              onMarkPassedRead={articleActions.markPassedArticlesRead}
              onToggleRead={(article) =>
                void articleActions.changeArticleState(article, { isRead: !article.isRead })
              }
              onToggleStar={(article) =>
                void articleActions.changeArticleState(article, {
                  isStarred: !article.isStarred,
                })
              }
            />
            <ReaderPane
              article={queue.activeArticle}
              contentLoaded={
                queue.activeArticle !== null &&
                queue.fullContentLoadedIds.current.has(queue.activeArticle.id)
              }
              contentError={
                queue.activeArticle
                  ? (articleEnrichment.articleContentErrors.get(queue.activeArticle.id) ?? null)
                  : null
              }
              onRetryContent={articleEnrichment.retryArticleContent}
              canPrevious={queue.activeArticleIndex > 0}
              canNext={
                queue.activeArticleIndex >= 0 &&
                (queue.activeArticleIndex < queue.articles.length - 1 ||
                  (queue.nextCursor !== null && !queue.loadingMore))
              }
              fullContentVisible={
                queue.activeArticle
                  ? articleEnrichment.fullContentVisibleIds.has(queue.activeArticle.id)
                  : false
              }
              summaryState={
                queue.activeArticle
                  ? (articleEnrichment.articleSummaryStates.get(queue.activeArticle.id) ??
                    EMPTY_ARTICLE_SUMMARY_STATE)
                  : EMPTY_ARTICLE_SUMMARY_STATE
              }
              translationState={
                queue.activeArticle
                  ? (articleEnrichment.articleTranslationStates.get(queue.activeArticle.id) ??
                    EMPTY_ARTICLE_TRANSLATION_STATE)
                  : EMPTY_ARTICLE_TRANSLATION_STATE
              }
              translationLanguage={bootstrap.settings.translationLanguage}
              customPrompts={bootstrap.settings.customPrompts}
              showYouTubeDescriptions={bootstrap.settings.showYouTubeDescriptions}
              onBack={route.returnToArticleList}
              onPrevious={() => articleActions.moveArticle(-1)}
              onNext={() => articleActions.moveArticle(1)}
              onToggleRead={(article) =>
                void articleActions.changeArticleState(article, { isRead: !article.isRead })
              }
              onToggleStar={(article) =>
                void articleActions.changeArticleState(article, {
                  isStarred: !article.isStarred,
                })
              }
              onCopy={(article) => void articleActions.copyArticleUrl(article)}
              onOpenSource={articleActions.openArticleSource}
              onFeedAction={openFeedManagementById}
              onToggleFullContent={(article) => void articleEnrichment.toggleFullContent(article)}
              onRunSummaryPrompt={articleEnrichment.runArticleSummaryPrompt}
              onToggleTranslation={articleEnrichment.toggleArticleTranslation}
              onRegenerateSummary={articleEnrichment.regenerateArticleSummary}
              onOpenAiSettings={() => route.navigate({ kind: "settings", category: "ai" })}
              onFilterSelection={filterSelectedText}
            />
          </>
        ) : (
          <ExpandedStream
            key={readerPath}
            articles={
              route.routedArticleId !== null && queue.activeArticle
                ? [queue.activeArticle]
                : queue.articles
            }
            activeId={queue.activeArticleId}
            topAlignedId={queue.expandedKeyboardTargetId}
            fullContentVisibleIds={articleEnrichment.fullContentVisibleIds}
            summaryStates={articleEnrichment.articleSummaryStates}
            translationStates={articleEnrichment.articleTranslationStates}
            translationLanguage={bootstrap.settings.translationLanguage}
            customPrompts={bootstrap.settings.customPrompts}
            showYouTubeDescriptions={bootstrap.settings.showYouTubeDescriptions}
            markReadOnScroll={!queue.loading && bootstrap.settings.markReadOnScroll}
            hasMore={
              route.routedArticleId === null &&
              queue.nextCursor !== null &&
              queue.readingMode === readingMode
            }
            loadingMore={queue.loadingMore}
            onLoadMore={() => void queue.loadOlderArticles()}
            onActivate={(article) => queue.selectArticle(article.id)}
            onMarkPassedRead={articleActions.markPassedArticlesRead}
            onToggleRead={(article) =>
              void articleActions.changeArticleState(article, { isRead: !article.isRead })
            }
            onToggleStar={(article) =>
              void articleActions.changeArticleState(article, {
                isStarred: !article.isStarred,
              })
            }
            onCopy={(article) => void articleActions.copyArticleUrl(article)}
            onOpenSource={articleActions.openArticleSource}
            onFeedAction={openFeedManagementById}
            onToggleFullContent={(article) => void articleEnrichment.toggleFullContent(article)}
            onRunSummaryPrompt={articleEnrichment.runArticleSummaryPrompt}
            onToggleTranslation={articleEnrichment.toggleArticleTranslation}
            onRegenerateSummary={articleEnrichment.regenerateArticleSummary}
            onOpenAiSettings={() => route.navigate({ kind: "settings", category: "ai" })}
            onFilterSelection={filterSelectedText}
          />
        )}
      </div>
    </>
  );
}
