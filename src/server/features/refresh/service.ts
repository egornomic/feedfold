import type { RefreshResult } from "../../../shared/types.js";
import { FeedSourceError, type FeedSourceLoader } from "../../feed-source-loader.js";
import type { FeedService } from "../feeds/service.js";
import type { FeedRecord } from "../shared.js";

export class FeedRefreshService {
  private readonly pending: Array<{ feed: FeedRecord; scheduled: boolean }> = [];
  private readonly requestedIds = new Set<number>();
  private readonly listeners = new Map<number, Set<() => void>>();
  private active = 0;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private idleResolvers: Array<() => void> = [];

  constructor(
    private readonly feeds: FeedService,
    private readonly sourceLoader: FeedSourceLoader,
    private readonly concurrency = 3,
    private readonly maxPending = feeds.refreshQueueLimit() ?? Number.POSITIVE_INFINITY,
  ) {}

  start(): void {
    if (this.stopped || this.timer) return;
    void this.requestScheduled(this.feeds.getDueFeedIds());
    this.timer = setInterval(() => {
      void this.requestScheduled(this.feeds.getDueFeedIds());
    }, 30_000);
    this.timer.unref();
  }

  request(feedIds?: number[]): RefreshResult {
    return this.enqueue(feedIds, false);
  }

  requestScheduled(feedIds?: number[]): RefreshResult {
    return this.enqueue(feedIds, true);
  }

  private enqueue(feedIds: number[] | undefined, scheduled: boolean): RefreshResult {
    if (this.stopped) return { requested: 0, refreshingFeedIds: [] };
    const candidates = this.feeds.getRefreshCandidates(feedIds);
    const available = Math.max(0, this.maxPending - this.pending.length);
    const accepted = candidates
      .filter((feed) => !this.requestedIds.has(feed.id))
      .slice(0, available);
    for (const feed of accepted) {
      this.requestedIds.add(feed.id);
      this.feeds.markSourceRefreshing(feed.id);
      this.pending.push({ feed, scheduled });
    }
    this.pump();
    const acceptedSourceIds = new Set(accepted.map((feed) => feed.id));
    const refreshingFeedIds = feedIds
      ? feedIds.filter((feedId) => acceptedSourceIds.has(this.feeds.sourceIdForFeed(feedId)))
      : accepted.map((feed) => feed.id);
    return { requested: accepted.length, refreshingFeedIds };
  }

  subscribe(userId: number, listener: () => void): () => void {
    const listeners = this.listeners.get(userId) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(userId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(userId);
    };
  }

  private pump(): void {
    while (!this.stopped && this.active < this.concurrency && this.pending.length > 0) {
      const queued = this.pending.shift();
      if (!queued) break;
      const { feed, scheduled } = queued;
      this.active += 1;
      void this.refresh(feed, scheduled).finally(() => {
        this.active -= 1;
        this.requestedIds.delete(feed.id);
        for (const subscription of this.feeds.listSourceSubscriptions(feed.id)) {
          this.notifyDataChanged(subscription.userId);
        }
        this.pump();
        this.resolveIdleIfNeeded();
      });
    }
    this.resolveIdleIfNeeded();
  }

  private async refresh(feed: FeedRecord, scheduled: boolean): Promise<void> {
    let httpStatus: number | null = null;
    const expectedSelectionRevision =
      feed.sourceKind === "web" ? feed.selectionRevision : undefined;
    try {
      const result = await this.sourceLoader.load(feed);
      httpStatus = result.httpStatus;
      this.feeds.completeSourceRefresh(feed.id, {
        ...result,
        httpStatus: result.httpStatus ?? 200,
        scheduled,
        expectedSelectionRevision,
      });
    } catch (error) {
      const failure =
        error instanceof FeedSourceError
          ? error.failure
          : {
              httpStatus,
              errorKind: httpStatus === null ? ("network" as const) : ("parse" as const),
              healthStatus: "failing" as const,
            };
      this.feeds.failSourceRefresh(feed.id, {
        ...failure,
        error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
        retryMinutes: feed.pollIntervalMinutes,
        expectedSelectionRevision,
      });
    }
  }

  async waitForIdle(): Promise<void> {
    if (this.pending.length === 0 && this.active === 0) return;
    await new Promise<void>((resolve) => this.idleResolvers.push(resolve));
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const { feed } of this.pending.splice(0)) {
      this.requestedIds.delete(feed.id);
      this.feeds.failSourceRefresh(feed.id, {
        httpStatus: null,
        error: "The refresh stopped because the server shut down. Refresh the feed again.",
        errorKind: "network",
        healthStatus: "failing",
        retryMinutes: feed.pollIntervalMinutes,
      });
    }
    await this.waitForIdle();
  }

  private resolveIdleIfNeeded(): void {
    if (this.pending.length > 0 || this.active > 0) return;
    const resolvers = this.idleResolvers;
    this.idleResolvers = [];
    for (const resolve of resolvers) resolve();
  }

  notifyDataChanged(userId: number): void {
    for (const listener of this.listeners.get(userId) ?? []) {
      try {
        listener();
      } catch {
        // A disconnected client must not leave the refresh queue permanently active.
      }
    }
  }
}
