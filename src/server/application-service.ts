import type { FeedInput } from "../shared/api/inputs.js";
import { telegramPostIdentity } from "../shared/telegram.js";
import type { WebFeedConfig } from "../shared/types.js";
import { xVideoPostIds } from "../shared/x.js";
import type { AppDatabase } from "./database.js";
import { ApplicationApiError, requireResource } from "./errors.js";
import type { AiService } from "./features/ai/service.js";
import type { ExtractionQueue } from "./features/extraction/queue.js";
import {
  FeedSubscriptionService,
  WebFeedUnavailableError,
} from "./features/feeds/subscription-service.js";
import type { WebFeedService } from "./features/feeds/web/service.js";
import type { FeedRefreshService } from "./features/refresh/service.js";
import { discoverFeed } from "./feed-discovery.js";
import { QuotaExceededError } from "./quota.js";
import type { TelegramMediaService } from "./telegram-media.js";
import type { XMediaService } from "./x-media.js";

export interface ApplicationServices {
  database: AppDatabase;
  extractionQueue: ExtractionQueue;
  refreshService: FeedRefreshService;
  webFeedService?: WebFeedService;
  aiService: AiService;
  telegramMediaService: TelegramMediaService;
  xMediaService: XMediaService;
  feedDiscoveryTimeoutMs?: number;
}

/** Account-scoped workflows shared by HTTP and local desktop transports. */
export class ApplicationService {
  private readonly subscriptions: FeedSubscriptionService;

  constructor(private readonly services: ApplicationServices) {
    this.subscriptions = new FeedSubscriptionService(
      services.database.feeds,
      services.refreshService,
      services.webFeedService,
    );
  }

  bootstrap(userId: number, deviceId?: string) {
    return {
      ...this.services.database.bootstrap.getBootstrap(userId),
      aiSettings: this.services.aiService.getSettings(userId, deviceId),
    };
  }

  createFeed(userId: number, input: FeedInput) {
    return this.subscriptions.create(userId, input);
  }

  discoverFeed(userId: number, url: string) {
    const { database, feedDiscoveryTimeoutMs } = this.services;
    database.quotas.consume("feed_discovery", userId);
    return discoverFeed(url, feedDiscoveryTimeoutMs, undefined, (task) =>
      database.feeds.runOutbound(task),
    );
  }

  refresh(userId: number, feedIds?: number[]) {
    return this.services.refreshService.request(
      this.services.database.feeds.getManualRefreshFeedIds(userId, feedIds),
    );
  }

  private webFeeds(): WebFeedService {
    if (!this.services.webFeedService) throw new WebFeedUnavailableError();
    return this.services.webFeedService;
  }

  analyzeWebPage(userId: number, url: string) {
    return this.webFeeds().analyze(String(userId), url);
  }

  private requireWebFeed(userId: number, id: number): void {
    const feed = requireResource(this.services.database.feeds.getFeed(userId, id), "Feed");
    if (feed.sourceKind !== "web") {
      throw new ApplicationApiError(400, "Choose a web feed before editing a page selection.");
    }
  }

  analyzeWebFeed(userId: number, id: number) {
    const webFeeds = this.webFeeds();
    this.requireWebFeed(userId, id);
    const config = requireResource(
      this.services.database.feeds.getWebFeedConfig(userId, id),
      "Page selection",
    );
    return webFeeds.analyze(String(userId), config.pageUrl, config);
  }

  async updateWebFeedSelection(userId: number, id: number, config: WebFeedConfig) {
    const webFeeds = this.webFeeds();
    this.requireWebFeed(userId, id);
    const extracted = await webFeeds.extract(config);
    const updated = requireResource(
      this.services.database.feeds.updateWebFeedSelection(userId, id, config, extracted.parsed),
      "Feed",
    );
    return updated;
  }

  loadFullContent(userId: number, id: number) {
    const { database, extractionQueue } = this.services;
    requireResource(database.articles.getArticle(userId, id), "Article");
    if (database.extractions.requestExtraction(userId, id)) extractionQueue.prioritize(id);
    return database.articles.getArticle(userId, id);
  }

  importOpml(userId: number, source: string) {
    try {
      const { feedIds, ...result } = this.services.database.opml.import(userId, source);
      this.services.refreshService.request(feedIds);
      return result;
    } catch (error) {
      if (error instanceof QuotaExceededError) throw error;
      throw new ApplicationApiError(400, error instanceof Error ? error.message : String(error));
    }
  }

  async telegramItems(userId: number, articleId: number) {
    const { database, telegramMediaService } = this.services;
    const article = database.articles.getArticle(userId, articleId);
    if (!article?.url || !telegramPostIdentity(article.url)) {
      throw new ApplicationApiError(404, "Telegram media was not found.");
    }
    database.quotas.consume("media_proxy", userId);
    try {
      return await telegramMediaService.mediaForPost(article.url);
    } catch (error) {
      if (error instanceof QuotaExceededError) throw error;
      throw new ApplicationApiError(502, "Telegram media is temporarily unavailable. Try again.");
    }
  }

  async telegramPreviewUrl(userId: number, articleId: number): Promise<string> {
    const first = (await this.telegramItems(userId, articleId))[0];
    return requireResource(first?.posterUrl ?? first?.url, "Telegram media");
  }

  async xMedia(userId: number, articleId: number, postId: string) {
    const { database, xMediaService } = this.services;
    const article = database.articles.getArticle(userId, articleId);
    const postIds = article ? xVideoPostIds(article.url, article.feedContentHtml) : [];
    if (!postIds.includes(postId)) throw new ApplicationApiError(404, "X video was not found.");
    database.quotas.consume("media_proxy", userId);
    try {
      return await xMediaService.mediaForPost(postId);
    } catch (error) {
      if (error instanceof QuotaExceededError) throw error;
      throw new ApplicationApiError(502, "X video is temporarily unavailable. Try again.");
    }
  }
}
