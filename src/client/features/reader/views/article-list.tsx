import { CheckCircle2, Circle, Star } from "lucide-react";
import type { Article } from "../../../../shared/types";
import { shouldShowArticleDescription } from "../article/article-content";
import { articleDate, articleLabel, mediaTypeLabel } from "../article/article-format";
import { articleImageUrl } from "../article/article-image-url";
import { ArticleThumbnailPlaceholder } from "../article/article-thumbnail-placeholder";
import { LinkifiedText } from "../article/linkified-text";
import type { ReadingPosition } from "../interaction/reading-position";
import { VirtualArticles } from "./virtual-articles";

export function ArticleList({
  enabled,
  positions,
  positionKey,
  loadMoreError,
  articles,
  activeId,
  markReadOnScroll,
  showYouTubeDescriptions,
  hasMore,
  loadingMore,
  onLoadMore,
  onOpen,
  onMarkPassedRead,
  onToggleRead,
  onToggleStar,
}: {
  enabled: boolean;
  positions: Map<string, ReadingPosition>;
  positionKey: string;
  loadMoreError: boolean;
  articles: Article[];
  activeId: number | null;
  markReadOnScroll: boolean;
  showYouTubeDescriptions: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onOpen: (article: Article, openReader?: boolean) => void;
  onMarkPassedRead: (articles: Article[]) => Promise<unknown>;
  onToggleRead: (article: Article) => void;
  onToggleStar: (article: Article) => void;
}) {
  return (
    <VirtualArticles
      articles={articles}
      activeId={activeId}
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
        <div
          key={article.id}
          className={`article-list-item${article.id === activeId ? " is-active" : ""}${article.isRead ? " is-read" : ""}`}
        >
          <button
            className="article-open-button"
            type="button"
            aria-current={article.id === activeId ? "true" : undefined}
            onClick={() => onOpen(article)}
          >
            <span className="sr-only">Open {articleLabel(article)}</span>
          </button>
          <div className="article-card-content">
            {article.imageUrl ? (
              <img
                className="article-card-image"
                src={articleImageUrl(article.imageUrl)}
                alt=""
                loading="lazy"
              />
            ) : (
              <span
                className="article-card-image article-card-image-placeholder"
                aria-hidden="true"
              >
                <ArticleThumbnailPlaceholder />
              </span>
            )}
            <span className="article-list-copy">
              <span className="article-list-title">{article.title || article.summary}</span>
              <span className="article-list-meta">
                <span className="article-feed-identity">
                  <span className="feed-name truncate">{article.feedTitle}</span>
                </span>
                {article.media ? (
                  <span className={`article-media-badge ${article.media.type}`}>
                    {mediaTypeLabel(article)}
                  </span>
                ) : null}
                <span className="article-meta-divider" aria-hidden="true">
                  ·
                </span>
                <time dateTime={article.publishedAt ?? article.discoveredAt}>
                  {articleDate(article)}
                </time>
              </span>
              {article.title &&
              article.summary &&
              shouldShowArticleDescription(article, showYouTubeDescriptions) ? (
                <span className="article-list-summary-text">
                  <LinkifiedText text={article.summary} />
                </span>
              ) : null}
            </span>
          </div>
          <div className="article-card-state-actions">
            <button
              className="list-read-button"
              type="button"
              aria-label={
                article.isRead
                  ? `Mark ${articleLabel(article)} as unread`
                  : `Mark ${articleLabel(article)} as read`
              }
              title={article.isRead ? "Mark as unread" : "Mark as read"}
              onClick={() => onToggleRead(article)}
            >
              {article.isRead ? (
                <CheckCircle2 aria-hidden="true" size={15} />
              ) : (
                <Circle aria-hidden="true" size={15} />
              )}
            </button>
            <button
              className={`list-star-button${article.isStarred ? " is-starred" : ""}`}
              type="button"
              aria-label={
                article.isStarred
                  ? `Remove ${articleLabel(article)} from Saved`
                  : `Save ${articleLabel(article)}`
              }
              title={article.isStarred ? "Remove from Saved" : "Save"}
              aria-pressed={article.isStarred}
              onClick={() => onToggleStar(article)}
            >
              <Star
                aria-hidden="true"
                size={15}
                fill={article.isStarred ? "currentColor" : "none"}
              />
            </button>
          </div>
        </div>
      )}
    </VirtualArticles>
  );
}
