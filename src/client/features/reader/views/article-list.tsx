import { CheckCircle2, Circle, Star } from "lucide-react";
import { useCallback, useState } from "react";
import type { Article } from "../../../../shared/types";
import { shouldShowArticleDescription } from "../article/article-content";
import {
    articleDate,
    articleLabel,
    mediaTypeLabel,
} from "../article/article-format";
import { articleThumbnailUrl } from "../article/article-image-url";
import { ArticleThumbnailPlaceholder } from "../article/article-thumbnail-placeholder";
import { LinkifiedText } from "../article/linkified-text";
import { VirtualArticles } from "./virtual-articles";

const warmedThumbnails = new Set<string>();

function ArticleListThumbnail({ imageUrl }: { imageUrl: string | null }) {
    const [failed, setFailed] = useState(false);

    if (imageUrl && !failed) {
        return (
            <img
                className="article-card-image"
                src={articleThumbnailUrl(imageUrl)}
                alt=""
                loading="lazy"
                onError={() => setFailed(true)}
            />
        );
    }

    return (
        <span
            className="article-card-image article-card-image-placeholder"
            aria-hidden="true"
        >
            <ArticleThumbnailPlaceholder />
        </span>
    );
}

export function ArticleList({
    enabled,
    loadMoreError,
    articles,
    activeId,
    focusArticleId,
    onFocusArticle,
    markReadOnScroll,
    showYouTubeDescriptions,
    hasMore,
    loadingMore,
    onLoadMore,
    onOpen,
    onMarkPassedRead,
    onToggleRead,
    onToggleSave,
}: {
    enabled: boolean;
    loadMoreError: boolean;
    articles: Article[];
    activeId: number | null;
    focusArticleId: number | undefined;
    onFocusArticle: () => void;
    markReadOnScroll: boolean;
    showYouTubeDescriptions: boolean;
    hasMore: boolean;
    loadingMore: boolean;
    onLoadMore: () => void;
    onOpen: (article: Article, keyboard: boolean) => void;
    onMarkPassedRead: (articles: Article[]) => Promise<unknown>;
    onToggleRead: (article: Article) => void;
    onToggleSave: (article: Article) => void;
}) {
    const focusRow = useCallback(
        (button: HTMLButtonElement | null) => {
            const list = button?.closest('[role="list"]');
            if (!button || !list) {
                return;
            }
            const focusWhenVisible = () => {
                if (getComputedStyle(button).visibility === "visible") {
                    observer.disconnect();
                    button.focus();
                    onFocusArticle();
                }
            };
            const observer = new MutationObserver(focusWhenVisible);
            // Virtuoso mounts the row hidden and reveals it after its initial scroll.
            observer.observe(list, { attributeFilter: ["style"] });
            focusWhenVisible();
            return () => observer.disconnect();
        },
        [onFocusArticle],
    );
    return (
        <VirtualArticles
            articles={articles}
            activeId={activeId}
            initialIndex={
                focusArticleId === undefined
                    ? undefined
                    : articles.findIndex(
                          (article) => article.id === focusArticleId,
                      )
            }
            enabled={enabled}
            loadMoreError={loadMoreError}
            markReadOnScroll={markReadOnScroll}
            onMarkPassedRead={onMarkPassedRead}
            hasMore={hasMore}
            loadingMore={loadingMore}
            onLoadMore={onLoadMore}
            onRangeChanged={({ endIndex }) => {
                // Start downloading thumbnails just beyond the visible rows.
                for (const { imageUrl } of articles.slice(
                    endIndex + 1,
                    endIndex + 21,
                )) {
                    if (!imageUrl) {
                        continue;
                    }
                    const url = articleThumbnailUrl(imageUrl);
                    if (warmedThumbnails.has(url)) {
                        continue;
                    }
                    warmedThumbnails.add(url);
                    new Image().src = url;
                }
            }}
        >
            {(article) => (
                <div
                    key={article.id}
                    className={
                        "article-list-item" +
                        `${article.id === activeId ? " is-active" : ""}` +
                        `${article.isRead ? " is-read" : ""}`
                    }
                >
                    <button
                        className="article-open-button"
                        ref={
                            article.id === focusArticleId ? focusRow : undefined
                        }
                        type="button"
                        aria-current={
                            article.id === activeId ? "true" : undefined
                        }
                        onClick={(event) => onOpen(article, event.detail === 0)}
                    >
                        <span className="sr-only">
                            Open {articleLabel(article)}
                        </span>
                    </button>
                    <div className="article-card-content">
                        <ArticleListThumbnail
                            key={article.imageUrl}
                            imageUrl={article.imageUrl}
                        />
                        <span className="article-list-copy">
                            <span className="article-list-title">
                                {articleLabel(article)}
                            </span>
                            <span className="article-list-meta">
                                <span className="article-feed-identity">
                                    <span className="feed-name truncate">
                                        {article.feedTitle}
                                    </span>
                                </span>
                                {article.media ? (
                                    <span
                                        className={`article-media-badge ${article.media.type}`}
                                    >
                                        {mediaTypeLabel(article)}
                                    </span>
                                ) : null}
                                <span
                                    className="article-meta-divider"
                                    aria-hidden="true"
                                >
                                    ·
                                </span>
                                <time
                                    dateTime={
                                        article.publishedAt ??
                                        article.discoveredAt
                                    }
                                >
                                    {articleDate(article)}
                                </time>
                            </span>
                            {article.title &&
                            article.summary &&
                            shouldShowArticleDescription(
                                article,
                                showYouTubeDescriptions,
                            ) ? (
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
                            title={
                                article.isRead
                                    ? "Mark as unread"
                                    : "Mark as read"
                            }
                            onClick={() => onToggleRead(article)}
                        >
                            {article.isRead ? (
                                <CheckCircle2 aria-hidden="true" size={15} />
                            ) : (
                                <Circle aria-hidden="true" size={15} />
                            )}
                        </button>
                        <button
                            className={`list-save-button${article.isSaved ? " is-saved" : ""}`}
                            type="button"
                            aria-label={
                                article.isSaved
                                    ? `Remove ${articleLabel(article)} from Saved`
                                    : `Save ${articleLabel(article)}`
                            }
                            title={
                                article.isSaved ? "Remove from Saved" : "Save"
                            }
                            aria-pressed={article.isSaved}
                            onClick={() => onToggleSave(article)}
                        >
                            <Star
                                aria-hidden="true"
                                size={15}
                                fill={article.isSaved ? "currentColor" : "none"}
                            />
                        </button>
                    </div>
                </div>
            )}
        </VirtualArticles>
    );
}
