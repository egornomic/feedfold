import type { FeedService } from "../../src/server/features/feeds/service.js";

export function completeFeedRefresh(
  feeds: FeedService,
  feedId: number,
  input: Parameters<FeedService["completeSourceRefresh"]>[1],
): boolean {
  return feeds.completeSourceRefresh(feeds.sourceIdForFeed(feedId), input);
}

export function failFeedRefresh(
  feeds: FeedService,
  feedId: number,
  input: Parameters<FeedService["failSourceRefresh"]>[1],
): void {
  feeds.failSourceRefresh(feeds.sourceIdForFeed(feedId), input);
}
