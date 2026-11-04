import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../../src/server/database.js";
import { FeedRefreshService } from "../../src/server/features/refresh/service.js";
import type { FeedSourceLoader, LoadedFeedSource } from "../../src/server/feed-source-loader.js";

const TEST_USER_ID = 1;
const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

// Holds every load open until the test finishes it, so the queue can be observed mid-refresh.
function heldLoader() {
  const loads: Array<{ feedUrl: string; finish: () => void }> = [];
  const loader: FeedSourceLoader = {
    load: (feed) =>
      new Promise<LoadedFeedSource>((resolve) => {
        loads.push({
          feedUrl: feed.feedUrl,
          finish: () => resolve({ httpStatus: 200, etag: null, lastModified: null }),
        });
      }),
  };
  return { loader, loads };
}

function setup(concurrency: number, maxPending?: number) {
  const database = new AppDatabase(":memory:");
  const { loader, loads } = heldLoader();
  const refresh = new FeedRefreshService(database.feeds, loader, concurrency, maxPending);
  cleanups.push(async () => {
    for (const load of loads) load.finish();
    await refresh.stop();
    database.close();
  });
  const feed = (name: string) =>
    database.feeds.createFeed(TEST_USER_ID, { feedUrl: `https://example.test/${name}.xml` });
  const loadedUrls = () => loads.map(({ feedUrl }) => feedUrl);
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  return { database, refresh, loads, feed, loadedUrls, flush };
}

describe("feed refresh queue", () => {
  it("limits waiting and running refreshes and ignores feeds that are already queued", async () => {
    const { refresh, loads, feed, loadedUrls, flush } = setup(1, 1);
    const first = feed("first");
    const second = feed("second");
    const third = feed("third");

    expect(refresh.request([first.id, second.id, third.id])).toEqual({
      requested: 1,
      refreshingFeedIds: [first.id],
    });
    expect(refresh.request([first.id, second.id, third.id])).toEqual({
      requested: 1,
      refreshingFeedIds: [second.id],
    });
    expect(refresh.request([third.id])).toEqual({ requested: 0, refreshingFeedIds: [] });
    expect(loadedUrls()).toEqual([first.feedUrl]);

    loads[0]?.finish();
    await flush();
    expect(loadedUrls()).toEqual([first.feedUrl, second.feedUrl]);
    expect(refresh.request([first.id])).toEqual({ requested: 1, refreshingFeedIds: [first.id] });

    loads[1]?.finish();
    await flush();
    loads[2]?.finish();
    await refresh.waitForIdle();
    expect(loadedUrls()).toEqual([first.feedUrl, second.feedUrl, first.feedUrl]);
  });

  it("finishes running refreshes on shutdown, fails queued ones, and refuses new work", async () => {
    const { database, refresh, loads, feed, loadedUrls } = setup(1);
    const running = feed("running");
    const queued = feed("queued");
    refresh.request([running.id, queued.id]);

    let stopped = false;
    const stopping = refresh.stop().then(() => {
      stopped = true;
    });
    expect(database.feeds.getFeed(TEST_USER_ID, queued.id)).toMatchObject({
      refreshing: false,
      healthStatus: "failing",
      lastErrorKind: "network",
      lastError: "The refresh stopped because the server shut down. Refresh the feed again.",
    });
    expect(refresh.request([queued.id])).toEqual({ requested: 0, refreshingFeedIds: [] });
    await new Promise((resolve) => setImmediate(resolve));
    expect(stopped).toBe(false);

    loads[0]?.finish();
    await stopping;
    expect(database.feeds.getFeed(TEST_USER_ID, running.id)).toMatchObject({
      refreshing: false,
      healthStatus: "healthy",
    });

    refresh.start();
    expect(loadedUrls()).toEqual([running.feedUrl]);
  });
});
