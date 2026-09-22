import { ExternalLink } from "lucide-react";
import type { FeedPreviewArticle } from "../../../shared/types";
import { ArticleThumbnailPlaceholder } from "../reader/article/article-thumbnail-placeholder";
import "./feed-entries-preview.css";

function formatPreviewDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

function previewTitle(article: FeedPreviewArticle): string {
  return article.title || article.summary || "Untitled entry";
}

function previewSummary(article: FeedPreviewArticle, title: string): string | null {
  const summary = article.summary.trim();
  return summary && summary !== title.trim() ? summary : null;
}

function PreviewArticle({ article }: { article: FeedPreviewArticle }) {
  const title = previewTitle(article);
  const summary = previewSummary(article, title);

  return (
    <li className="feed-preview-article">
      {article.imageUrl ? (
        <img className="feed-preview-article-image" src={article.imageUrl} alt="" loading="lazy" />
      ) : (
        <span className="feed-preview-article-image is-placeholder" aria-hidden="true">
          <ArticleThumbnailPlaceholder />
        </span>
      )}
      <div>
        {article.url ? (
          <a
            className="feed-preview-article-title"
            href={article.url}
            target="_blank"
            rel="noreferrer"
          >
            <span>{title}</span>
            <ExternalLink aria-hidden="true" size={12} />
          </a>
        ) : (
          <strong className="feed-preview-article-title">
            <span>{title}</span>
          </strong>
        )}
        {article.author || article.publishedAt ? (
          <div className="feed-preview-article-meta">
            {article.author ? <span>{article.author}</span> : null}
            {article.author && article.publishedAt ? <span aria-hidden="true">·</span> : null}
            {article.publishedAt ? (
              <time dateTime={article.publishedAt}>{formatPreviewDate(article.publishedAt)}</time>
            ) : null}
          </div>
        ) : null}
        {summary ? <p>{summary}</p> : null}
      </div>
    </li>
  );
}

export function FeedEntriesPreview({
  articles,
  totalEntries,
  emptyMessage = "This feed has no entries to preview.",
}: {
  articles: FeedPreviewArticle[];
  totalEntries: number;
  emptyMessage?: string;
}) {
  return (
    <>
      <div className="feed-preview-list-heading">
        <h4>Recent entries</h4>
        <span>
          {totalEntries} {totalEntries === 1 ? "entry" : "entries"} in this feed
        </span>
      </div>
      {articles.length > 0 ? (
        <ol className="feed-preview-articles">
          {articles.map((article) => (
            <PreviewArticle
              key={`${article.url ?? ""}\u0000${article.publishedAt ?? ""}\u0000${article.title}`}
              article={article}
            />
          ))}
        </ol>
      ) : (
        <p className="feed-preview-empty">{emptyMessage}</p>
      )}
    </>
  );
}
