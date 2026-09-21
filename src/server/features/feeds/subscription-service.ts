import type { FeedInput } from "../../../shared/api-inputs.js";
import type { Feed } from "../../../shared/types.js";
import type { FeedRefreshService } from "../../refresh.js";
import type { WebFeedService } from "../../web-feed.js";
import type { FeedService } from "./service.js";

export class WebFeedUnavailableError extends Error {
  constructor() {
    super("Web feed loading is unavailable. Check the server's Chromium setup.");
    this.name = "WebFeedUnavailableError";
  }
}

export class FeedSubscriptionService {
  constructor(
    private readonly feeds: FeedService,
    private readonly refresh: FeedRefreshService,
    private readonly webFeeds?: WebFeedService,
  ) {}

  async create(userId: number, input: FeedInput): Promise<Feed | null> {
    this.feeds.assertCanCreateFeed(userId, input.sourceKind);
    if (input.sourceKind === "published") {
      const feed = this.feeds.createFeed(userId, input);
      if (!feed.paused && this.feeds.subscriptionNeedsRefresh(feed.id)) {
        this.refresh.request([feed.id]);
      }
      return this.feeds.getFeed(userId, feed.id);
    }

    if (!this.webFeeds) throw new WebFeedUnavailableError();
    const extracted = await this.webFeeds.extract(input.webConfig);
    const feed = this.feeds.createWebFeed(userId, {
      title: input.title ?? extracted.parsed.title,
      pageUrl: input.feedUrl,
      folderId: input.folderId ?? null,
      config: input.webConfig,
      parsed: extracted.parsed,
    });
    this.refresh.notifyDataChanged(userId);
    return feed;
  }
}
