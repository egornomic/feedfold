import {
  AlertTriangle,
  CheckCheck,
  Inbox,
  Plus,
  RefreshCw,
  Rss,
  SearchX,
  Star,
} from "lucide-react";
import type { ArticleState, ReadingMode } from "../../../shared/types";
import { BrandLogo } from "../../ui/brand";

export function StartupError({ message, retry }: { message: string; retry: () => void }) {
  return (
    <main className="startup-state">
      <BrandLogo className="startup-logo" />
      <h1>feedfold is unavailable</h1>
      <p>{message}</p>
      <button className="primary-button" type="button" onClick={retry}>
        <RefreshCw aria-hidden="true" size={16} />
        Try again
      </button>
    </main>
  );
}

export function ArticleListSkeleton({ mode }: { mode: ReadingMode }) {
  if (mode === "expanded") {
    return (
      <div
        className="expanded-stream skeleton-stream"
        role="status"
        aria-busy="true"
        aria-label="Loading articles"
      >
        {[0, 1, 2].map((key) => (
          <div className="expanded-article skeleton-expanded" key={key}>
            <div className="skeleton-line short" />
            <div className="skeleton-line wide" />
            <div className="skeleton-line" />
            <div className="skeleton-block" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <>
      <div
        className="article-list skeleton-list"
        role="status"
        aria-busy="true"
        aria-label="Loading articles"
      >
        <ol aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map((key) => (
            <li className="article-list-item" key={key}>
              <div className="article-card-content">
                <div className="article-card-image" />
                <div className="article-list-copy">
                  <div className="skeleton-line wide" />
                  <div className="skeleton-line short" />
                  <div className="skeleton-line" />
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
      <div className="reader-pane skeleton-reader">
        <div className="skeleton-line short" />
        <div className="skeleton-line wide" />
        <div className="skeleton-line" />
        <div className="skeleton-block" />
      </div>
    </>
  );
}

export function InlineError({
  title,
  detail,
  retry,
}: {
  title: string;
  detail: string;
  retry: () => void;
}) {
  return (
    <section className="inline-state error-state" role="alert">
      <AlertTriangle aria-hidden="true" size={22} />
      <h2>{title}</h2>
      <p>{detail}</p>
      <button className="secondary-button" type="button" onClick={retry}>
        <RefreshCw aria-hidden="true" size={16} />
        Try again
      </button>
    </section>
  );
}

export function EmptyArticles({
  hasFeeds,
  search,
  state,
  onAddFeed,
  onShowSaved,
  onShowAll,
  onClearSearch,
}: {
  hasFeeds: boolean;
  search: string;
  state: ArticleState;
  onAddFeed: () => void;
  onShowSaved: () => void;
  onShowAll: () => void;
  onClearSearch: () => void;
}) {
  if (!hasFeeds) {
    return (
      <section className="inline-state empty-state">
        <Rss aria-hidden="true" size={40} strokeWidth={1.7} />
        <h2>Add your first feed</h2>
        <p>Enter a website or feed URL, or import subscriptions from an OPML file.</p>
        <button className="primary-button" type="button" onClick={onAddFeed}>
          Add a feed
        </button>
      </section>
    );
  }
  if (search) {
    return (
      <section className="inline-state empty-state">
        <SearchX aria-hidden="true" size={40} strokeWidth={1.7} />
        <h2>No articles match “{search}”</h2>
        <p>Use a shorter phrase, or clear the search to show this queue again.</p>
        <button className="secondary-button" type="button" onClick={onClearSearch}>
          Clear search
        </button>
      </section>
    );
  }
  if (state === "unread") {
    return (
      <section className="inline-state empty-state">
        <CheckCheck aria-hidden="true" size={40} strokeWidth={1.7} />
        <h2>No unread articles</h2>
        <p>New articles will appear after the next refresh.</p>
        <div className="empty-state-actions">
          <button className="primary-button" type="button" onClick={onShowSaved}>
            <Star aria-hidden="true" size={16} />
            Read Saved
          </button>
          <button className="secondary-button" type="button" onClick={onAddFeed}>
            <Plus aria-hidden="true" size={16} />
            Add more feeds
          </button>
        </div>
      </section>
    );
  }
  return (
    <section className="inline-state empty-state">
      <Inbox aria-hidden="true" size={40} strokeWidth={1.7} />
      <h2>No articles in this view</h2>
      <p>Choose another feed or article state.</p>
      <button className="secondary-button" type="button" onClick={onShowAll}>
        Show all articles
      </button>
    </section>
  );
}
