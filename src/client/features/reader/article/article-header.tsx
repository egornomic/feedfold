import { ChevronDown } from "lucide-react";
import type { Article } from "../../../../shared/types";
import { Menu, MenuPopup } from "../../../ui/menu";
import { FeedActionMenuItems, type FeedManagementAction } from "../../feeds/feed-management";
import { articleDate, mediaTypeLabel } from "./article-format";

export function ArticleHeader({
  article,
  id,
  onFeedAction,
}: {
  article: Article;
  id: string;
  onFeedAction: (feedId: number, action: FeedManagementAction) => void;
}) {
  const feedId = article.feedId;
  const source =
    feedId === null ? (
      <span>{article.feedTitle}</span>
    ) : (
      <Menu.Root modal={false}>
        <Menu.Trigger
          data-management-feed-id={article.feedId}
          className="article-source-trigger"
          aria-label={`${article.feedTitle} feed actions`}
        >
          <span>{article.feedTitle}</span>
          <ChevronDown aria-hidden="true" size={15} />
        </Menu.Trigger>
        <MenuPopup
          positioner={{ align: "start" }}
          id={`article-${article.id}-source-menu`}
          className="article-source-menu context-action-menu"
          aria-label={`${article.feedTitle} feed actions`}
        >
          <FeedActionMenuItems
            sourceKind={article.feedSourceKind}
            onAction={(action) => {
              onFeedAction(feedId, action);
            }}
          />
        </MenuPopup>
      </Menu.Root>
    );
  const views = article.media?.viewCount;
  return (
    <header className="article-header" id={id}>
      <div className="article-source-row">
        {source}
        <span aria-hidden="true">·</span>
        <time dateTime={article.publishedAt ?? article.discoveredAt}>{articleDate(article)}</time>
        {article.media ? (
          <>
            <span aria-hidden="true">·</span>
            <span className={`article-media-badge ${article.media.type}`}>
              {mediaTypeLabel(article)}
            </span>
            {views != null ? (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {new Intl.NumberFormat(undefined, {
                    notation: "compact",
                    maximumFractionDigits: 1,
                  }).format(views)}{" "}
                  {views === 1 ? "view" : "views"}
                </span>
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
