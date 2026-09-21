import { CheckCircle2, Circle, Star } from "lucide-react";
import { useRef } from "react";
import type { Article } from "../../../../shared/types";
import { shouldShowArticleDescription } from "../article/article-content";
import { articleDate, articleLabel, mediaTypeLabel } from "../article/article-format";
import { articleImageUrl } from "../article/article-image-url";
import { ArticleThumbnailPlaceholder } from "../article/article-thumbnail-placeholder";
import { LinkifiedText } from "../article/linkified-text";
import { useMarkReadOnScroll } from "../interaction/mark-read-on-scroll";
import { ArticleLoadSentinel } from "./article-load-sentinel";

export function ArticleList({
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
  const listRef = useRef<HTMLElement>(null);
  const registerItem = useMarkReadOnScroll({
    articles,
    activeId,
    enabled: markReadOnScroll,
    onMarkPassedRead,
    rootRef: listRef,
  });

  return (
    <section ref={listRef} className="article-list" aria-label="Articles">
      <ol>
        {articles.map((article) => (
          <li
            key={article.id}
            ref={(element) => registerItem(article.id, element)}
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
          </li>
        ))}
      </ol>
      <ArticleLoadSentinel
        rootRef={listRef}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={onLoadMore}
      />
      {!hasMore ? (
        <div className="article-list-end" role="status">
          No more articles here
        </div>
      ) : null}
    </section>
  );
}
