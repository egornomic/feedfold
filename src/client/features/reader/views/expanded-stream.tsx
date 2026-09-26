import type { AiCustomPrompt, Article } from "../../../../shared/types";
import type { FeedManagementAction } from "../../feeds/feed-management";
import { ArticleActions } from "../article/article-action-bar";
import {
  type ArticleSummaryViewState,
  type ArticleTranslationViewState,
  EMPTY_ARTICLE_SUMMARY_STATE,
  EMPTY_ARTICLE_TRANSLATION_STATE,
} from "../article/article-ai-state";
import { ArticleDocument } from "../article/article-document";
import type { ReadingPosition } from "../interaction/reading-position";
import { VirtualArticles } from "./virtual-articles";

export function ExpandedStream({
  enabled,
  positions,
  positionKey,
  loadMoreError,
  articles,
  activeId,
  topAlignedId,
  fullContentVisibleIds,
  summaryStates,
  translationStates,
  translationLanguage,
  customPrompts,
  showYouTubeDescriptions,
  markReadOnScroll,
  hasMore,
  loadingMore,
  onLoadMore,
  onActivate,
  onMarkPassedRead,
  onToggleRead,
  onToggleStar,
  onCopy,
  onOpenSource,
  onFeedAction,
  onToggleFullContent,
  onRunSummaryPrompt,
  onToggleTranslation,
  onRegenerateSummary,
  onOpenAiSettings,
  onFilterSelection,
}: {
  enabled: boolean;
  positions: Map<string, ReadingPosition>;
  positionKey: string;
  loadMoreError: boolean;
  articles: Article[];
  activeId: number | null;
  topAlignedId: number | null;
  fullContentVisibleIds: ReadonlySet<number>;
  summaryStates: ReadonlyMap<number, ArticleSummaryViewState>;
  translationStates: ReadonlyMap<number, ArticleTranslationViewState>;
  translationLanguage: string;
  customPrompts: AiCustomPrompt[];
  showYouTubeDescriptions: boolean;
  markReadOnScroll: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onActivate: (article: Article) => void;
  onMarkPassedRead: (articles: Article[]) => Promise<unknown>;
  onToggleRead: (article: Article) => void;
  onToggleStar: (article: Article) => void;
  onCopy: (article: Article) => void;
  onOpenSource: (article: Article) => void;
  onFeedAction: (feedId: number, action: FeedManagementAction) => void;
  onToggleFullContent: (article: Article) => void;
  onRunSummaryPrompt: (article: Article, promptId: string | null) => void;
  onToggleTranslation: (article: Article) => void;
  onRegenerateSummary: (article: Article) => void;
  onOpenAiSettings: () => void;
  onFilterSelection: (article: Article, text: string) => void;
}) {
  return (
    <VirtualArticles
      expanded
      articles={articles}
      activeId={activeId}
      topAlignedId={topAlignedId}
      enabled={enabled}
      positions={positions}
      positionKey={positionKey}
      loadMoreError={loadMoreError}
      markReadOnScroll={markReadOnScroll}
      onMarkPassedRead={onMarkPassedRead}
      hasMore={hasMore}
      loadingMore={loadingMore}
      onLoadMore={onLoadMore}
    >
      {(article) => (
        <article
          className={`expanded-article${article.id === activeId ? " is-active" : ""}${article.isRead ? " is-read" : ""}`}
          key={article.id}
          aria-labelledby={`expanded-${article.id}-title`}
          onFocus={() => onActivate(article)}
        >
          <div className="expanded-actions">
            <ArticleActions
              article={article}
              fullContentVisible={fullContentVisibleIds.has(article.id)}
              summaryState={summaryStates.get(article.id) ?? EMPTY_ARTICLE_SUMMARY_STATE}
              translationState={
                translationStates.get(article.id) ?? EMPTY_ARTICLE_TRANSLATION_STATE
              }
              translationLanguage={translationLanguage}
              customPrompts={customPrompts}
              onToggleRead={onToggleRead}
              onToggleStar={onToggleStar}
              onCopy={onCopy}
              onOpenSource={onOpenSource}
              onToggleFullContent={onToggleFullContent}
              onRunSummaryPrompt={onRunSummaryPrompt}
              onToggleTranslation={onToggleTranslation}
            />
          </div>
          <ArticleDocument
            article={article}
            titleId={`expanded-${article.id}-title`}
            fullContentVisible={fullContentVisibleIds.has(article.id)}
            summaryState={summaryStates.get(article.id) ?? EMPTY_ARTICLE_SUMMARY_STATE}
            translationState={translationStates.get(article.id) ?? EMPTY_ARTICLE_TRANSLATION_STATE}
            translationLanguage={translationLanguage}
            customPrompts={customPrompts}
            showYouTubeDescriptions={showYouTubeDescriptions}
            onFeedAction={onFeedAction}
            onToggleFullContent={onToggleFullContent}
            onRegenerateSummary={onRegenerateSummary}
            onOpenAiSettings={onOpenAiSettings}
            onFilterSelection={onFilterSelection}
          />
        </article>
      )}
    </VirtualArticles>
  );
}
