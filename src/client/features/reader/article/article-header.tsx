import { ChevronDown } from "lucide-react";
import type { Article } from "../../../../shared/types";
import { FeedActionMenuItems, type FeedManagementAction } from "../../../feed-management";
import { useActionMenu } from "./article-action-menu";
import { articleDate, formatViewCount, mediaTypeLabel } from "./article-format";

function ArticleSourceMenu({
  article,
  onFeedAction,
}: {
  article: Article;
  onFeedAction: (feedId: number, action: FeedManagementAction) => void;
}) {
  const menu = useActionMenu();
  const menuId = `article-${article.id}-source-menu`;
  const anchorName = `--article-${article.id}-source`;

  return (
    <>
      <button
        ref={menu.triggerRef}
        data-management-feed-id={article.feedId}
        className="article-source-trigger"
        type="button"
        aria-label={`${article.feedTitle} feed actions`}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        aria-controls={menuId}
        popoverTarget={menuId}
        style={{ anchorName }}
        onPointerDown={menu.handleTriggerPointerDown}
        onKeyDown={menu.handleTriggerKeyDown}
      >
        <span>{article.feedTitle}</span>
        <ChevronDown aria-hidden="true" size={15} />
      </button>
      <div
        ref={menu.menuRef}
        id={menuId}
        className="article-source-menu context-action-menu"
        popover="auto"
        role="menu"
        aria-label={`${article.feedTitle} feed actions`}
        style={{ positionAnchor: anchorName }}
        onToggle={menu.handleMenuToggle}
        onKeyDown={menu.handleMenuKeyDown}
      >
        <FeedActionMenuItems
          sourceKind={article.feedSourceKind}
          onAction={(action) => {
            menu.closeMenu();
            onFeedAction(article.feedId, action);
          }}
        />
      </div>
    </>
  );
}

export function ArticleHeader({
  article,
  id,
  onFeedAction,
}: {
  article: Article;
  id: string;
  onFeedAction: (feedId: number, action: FeedManagementAction) => void;
}) {
  return (
    <header className="article-header" id={id}>
      <div className="article-source-row">
        <ArticleSourceMenu article={article} onFeedAction={onFeedAction} />
        <span aria-hidden="true">·</span>
        <time dateTime={article.publishedAt ?? article.discoveredAt}>{articleDate(article)}</time>
        {article.media ? (
          <>
            <span aria-hidden="true">·</span>
            <span className={`article-media-badge ${article.media.type}`}>
              {mediaTypeLabel(article)}
            </span>
            {article.media.viewCount !== null ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{formatViewCount(article.media.viewCount)} views</span>
              </>
            ) : null}
          </>
        ) : null}
        {article.author ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{article.author}</span>
          </>
        ) : null}
      </div>
      {article.title ? (
        <h2>
          {article.url ? (
            <a href={article.url} target="_blank" rel="noreferrer">
              {article.title}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : (
            article.title
          )}
        </h2>
      ) : null}
    </header>
  );
}
