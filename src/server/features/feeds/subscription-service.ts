import assert from "node:assert/strict";
import type { FeedInput } from "../../../shared/api/inputs.js";
import type { Feed } from "../../../shared/types.js";
import { ApplicationApiError } from "../../errors.js";
import type { FeedRefreshService } from "../refresh/service.js";
import type { FeedService } from "./service.js";
import type { WebFeedService } from "./web/service.js";

export class WebFeedUnavailableError extends ApplicationApiError {
  constructor() {
    super(503, "Web feed loading is unavailable. Check the server's Chromium setup.");
    this.name = "WebFeedUnavailableError";
  }
}

export class FeedSubscriptionService {
  constructor(
    private readonly feeds: FeedService,
    private readonly refresh: FeedRefreshService,
    private readonly webFeeds?: WebFeedService,
  ) {}

  async create(userId: number, input: FeedInput): Promise<Feed> {
    if (input.sourceKind === "published") {
      const feed = this.feeds.createFeed(userId, input);
      if (feed.paused || !this.feeds.subscriptionNeedsRefresh(feed.id)) return feed;
      this.refresh.request([feed.id]);
      const refreshing = this.feeds.getFeed(userId, feed.id);
      assert(refreshing, "The new feed is missing after scheduling its refresh");
      return refreshing;
    }

    this.feeds.assertCanCreateFeed(userId, "web");
    if (!this.webFeeds) throw new WebFeedUnavailableError();
    const extracted = await this.webFeeds.extract(input.webConfig);
    return this.feeds.createWebFeed(userId, {
      title: input.title ?? extracted.parsed.title,
      pageUrl: input.feedUrl,
      folderId: input.folderId ?? null,
      config: input.webConfig,
      parsed: extracted.parsed,
    });
  }
}
