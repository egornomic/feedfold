import type { Feed, FeedSourceKind, Folder } from "../../../shared/types.js";
import { folderPathLabel } from "./folder-hierarchy.js";

export type FeedTypeFilter = "all" | FeedSourceKind;
export type FeedStatusFilter = "all" | "healthy" | "needs_attention" | "paused" | "refreshing";

export type VisibleFeedStatus = Exclude<FeedStatusFilter, "all">;

export const FEED_STATUS_LABELS: Record<VisibleFeedStatus, string> = {
  healthy: "Healthy",
  needs_attention: "Needs attention",
  paused: "Paused",
  refreshing: "Refreshing",
};

export function visibleFeedStatus(
  feed: Pick<Feed, "lastErrorKind" | "paused" | "refreshing">,
): VisibleFeedStatus {
  if (feed.lastErrorKind !== null) return "needs_attention";
  if (feed.paused) return "paused";
  if (feed.refreshing) return "refreshing";
  return "healthy";
}

export function filterFeeds(
  feeds: Feed[],
  folders: Folder[],
  { query, type, status }: { query: string; type: FeedTypeFilter; status: FeedStatusFilter },
): Feed[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return feeds.filter((feed) => {
    const searchText = [
      feed.title,
      feed.feedUrl,
      feed.siteUrl,
      folderPathLabel(feed.folderId, folders),
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase();
    return (
      (type === "all" || feed.sourceKind === type) &&
      (status === "all" || visibleFeedStatus(feed) === status) &&
      (!normalizedQuery || searchText.includes(normalizedQuery))
    );
  });
}
