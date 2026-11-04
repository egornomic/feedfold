import type { RefreshResult } from "../../../shared/types.js";
import { FeedSourceError, type FeedSourceLoader } from "../../feed-source-loader.js";
import { FeedRequestDeferred } from "../feeds/polling-policy.js";
import type { FeedService } from "../feeds/service.js";
import type { FeedRecord } from "../shared.js";

interface RefreshJob {
  feed: FeedRecord;
  scheduled: boolean;
  phase: "queued" | "running";
}

type QueueLifecycle =
  | { phase: "created" }
  | { phase: "polling"; timer: NodeJS.Timeout }
  | { phase: "stopped" };

export class FeedRefreshService {
  // Keyed by source and kept in request order, so the oldest queued job runs first.
  private readonly jobs = new Map<number, RefreshJob>();
  private readonly listeners = new Map<number, Set<(sourceReaderId?: string) => void>>();
  private lifecycle: QueueLifecycle = { phase: "created" };
  private idleResolvers: Array<() => void> = [];

  constructor(
    private readonly feeds: FeedService,
    private readonly sourceLoader: FeedSourceLoader,
    private readonly concurrency = 3,
    private readonly maxPending = feeds.refreshQueueLimit() ?? Number.POSITIVE_INFINITY,
  ) {}

  start(): void {
    if (this.lifecycle.phase !== "created") return;
    void this.requestScheduled(this.feeds.getDueFeedIds());
    const timer = setInterval(() => {
      void this.requestScheduled(this.feeds.getDueFeedIds());
    }, 30_000);
    timer.unref();
    this.lifecycle = { phase: "polling", timer };
  }

  request(feedIds?: number[]): RefreshResult {
    return this.enqueue(feedIds, false);
  }

  requestScheduled(feedIds?: number[]): RefreshResult {
    return this.enqueue(feedIds, true);
  }

  private enqueue(feedIds: number[] | undefined, scheduled: boolean): RefreshResult {
    if (this.lifecycle.phase === "stopped") return { requested: 0, refreshingFeedIds: [] };
    const candidates = this.feeds.getRefreshCandidates(feedIds);
    const available = Math.max(0, this.maxPending - this.jobsIn("queued").length);
    const accepted = candidates.filter((feed) => !this.jobs.has(feed.id)).slice(0, available);
    for (const feed of accepted) {
      this.jobs.set(feed.id, { feed, scheduled, phase: "queued" });
      this.feeds.markSourceRefreshing(feed.id);
    }
    this.pump();
    const acceptedSourceIds = new Set(accepted.map((feed) => feed.id));
    const refreshingFeedIds = feedIds
      ? feedIds.filter((feedId) => acceptedSourceIds.has(this.feeds.sourceIdForFeed(feedId)))
      : accepted.map((feed) => feed.id);
    return { requested: accepted.length, refreshingFeedIds };
  }

  subscribe(userId: number, listener: (sourceReaderId?: string) => void): () => void {
    const listeners = this.listeners.get(userId) ?? new Set<(sourceReaderId?: string) => void>();
    listeners.add(listener);
    this.listeners.set(userId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(userId);
    };
  }

  private jobsIn(phase: RefreshJob["phase"]): RefreshJob[] {
    return [...this.jobs.values()].filter((job) => job.phase === phase);
  }

  private pump(): void {
    let running = this.jobsIn("running").length;
    for (const job of this.jobs.values()) {
      if (running >= this.concurrency) break;
      if (job.phase !== "queued") continue;
      job.phase = "running";
      running += 1;
      const { feed, scheduled } = job;
      void this.refresh(feed, scheduled).finally(() => {
        this.jobs.delete(feed.id);
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
    if (this.feeds.listSourceSubscriptions(feed.id).length === 0) return;
    let httpStatus: number | null = null;
    const expectedSelectionRevision =
      feed.sourceKind === "web" ? feed.selectionRevision : undefined;
    try {
      this.feeds.polling.assertAllowed(feed.id);
      const result = await this.sourceLoader.load(feed, this.feeds.polling.forSource(feed.id));
      if (this.feeds.listSourceSubscriptions(feed.id).length === 0) return;
      httpStatus = result.httpStatus;
      this.feeds.completeSourceRefresh(feed.id, {
        ...result,
        httpStatus: result.httpStatus ?? 200,
        scheduled,
        ...(expectedSelectionRevision === undefined ? {} : { expectedSelectionRevision }),
      });
    } catch (error) {
      if (this.feeds.listSourceSubscriptions(feed.id).length === 0) return;
      if (error instanceof FeedRequestDeferred) {
        this.feeds.polling.defer(feed.id, error.until);
        return;
      }
      const failure =
        error instanceof FeedSourceError
          ? error.failure
          : {
              httpStatus,
              errorKind: httpStatus === null ? ("network" as const) : ("parse" as const),
            };
      this.feeds.failSourceRefresh(feed.id, {
        ...failure,
        error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
        retryMinutes: feed.pollIntervalMinutes,
        ...(expectedSelectionRevision === undefined ? {} : { expectedSelectionRevision }),
      });
    }
  }

  async waitForIdle(): Promise<void> {
    if (this.jobs.size === 0) return;
    await new Promise<void>((resolve) => this.idleResolvers.push(resolve));
  }

  async stop(): Promise<void> {
    if (this.lifecycle.phase === "polling") clearInterval(this.lifecycle.timer);
    this.lifecycle = { phase: "stopped" };
    for (const { feed } of this.jobsIn("queued")) {
      this.jobs.delete(feed.id);
      if (this.feeds.listSourceSubscriptions(feed.id).length === 0) continue;
      this.feeds.failSourceRefresh(feed.id, {
        httpStatus: null,
        error: "The refresh stopped because the server shut down. Refresh the feed again.",
        errorKind: "network",
        retryMinutes: feed.pollIntervalMinutes,
      });
    }
    await this.waitForIdle();
  }

  private resolveIdleIfNeeded(): void {
    if (this.jobs.size > 0) return;
    const resolvers = this.idleResolvers;
    this.idleResolvers = [];
    for (const resolve of resolvers) resolve();
  }

  notifyDataChanged(userId: number, sourceReaderId?: string): void {
    for (const listener of this.listeners.get(userId) ?? []) {
      try {
        listener(sourceReaderId);
      } catch {
        // A disconnected client must not leave the refresh queue permanently active.
      }
    }
  }
}
