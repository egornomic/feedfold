import { describe, expect, it } from "vitest";
import { filterFeeds, visibleFeedStatus } from "../../src/client/features/feeds/feed-filters.js";
import type { Feed } from "../../src/shared/types.js";

function feed(
  id: number,
  overrides: Partial<Pick<Feed, "sourceKind" | "healthStatus" | "paused" | "refreshing">> = {},
): Feed {
  return {
    id,
    title: `Feed ${id}`,
    feedUrl: `https://example.com/${id}.xml`,
    siteUrl: "https://example.com",
    folderId: null,
    sourceKind: "published",
    healthStatus: "healthy",
    lastError: null,
    lastErrorKind: null,
    lastMatchCount: null,
    lastHttpStatus: 200,
    lastAttemptAt: null,
    lastSuccessAt: null,
    nextPollAt: null,
    refreshing: false,
    paused: false,
    pollIntervalMinutes: 20,
    lastPostAt: null,
    createdAt: "2026-07-27T12:00:00.000Z",
    unreadCount: 0,
    totalCount: 0,
    ...overrides,
  };
}

describe("feed filters", () => {
  it("matches the status users see in the feed table", () => {
    expect(visibleFeedStatus(feed(1))).toBe("healthy");
    expect(visibleFeedStatus(feed(2, { refreshing: true }))).toBe("refreshing");
    expect(visibleFeedStatus(feed(3, { paused: true }))).toBe("paused");
    expect(
      visibleFeedStatus(
        feed(4, {
          healthStatus: "failing",
          paused: true,
          refreshing: true,
        }),
      ),
    ).toBe("needs_attention");
  });

  it("combines feed type and visible status without changing order", () => {
    const feeds = [
      feed(1),
      feed(2, { sourceKind: "web" }),
      feed(3, { sourceKind: "web", healthStatus: "needs_attention" }),
      feed(4, { healthStatus: "failing" }),
    ];

    expect(
      filterFeeds(feeds, [], { query: "", type: "web", status: "needs_attention" }).map(
        ({ id }) => id,
      ),
    ).toEqual([3]);
    expect(
      filterFeeds(feeds, [], { query: "", type: "all", status: "needs_attention" }).map(
        ({ id }) => id,
      ),
    ).toEqual([3, 4]);
    expect(
      filterFeeds(feeds, [], { query: "", type: "published", status: "all" }).map(({ id }) => id),
    ).toEqual([1, 4]);
  });

  it("searches feed identity and folder paths case-insensitively", () => {
    const folders = [
      {
        id: 1,
        name: "Personal",
        parentId: null,
        position: 1,
        sortDirection: "newest" as const,
        unreadCount: 0,
      },
      {
        id: 2,
        name: "Reading",
        parentId: 1,
        position: 2,
        sortDirection: "newest" as const,
        unreadCount: 0,
      },
    ];
    const feeds = [
      { ...feed(1), title: "Signal Notes", folderId: 2 },
      { ...feed(2), title: "Elsewhere", feedUrl: "https://example.com/special.xml" },
    ];

    expect(
      filterFeeds(feeds, folders, { query: "personal / reading", type: "all", status: "all" }).map(
        ({ id }) => id,
      ),
    ).toEqual([1]);
    expect(
      filterFeeds(feeds, folders, { query: "SPECIAL.XML", type: "all", status: "all" }).map(
        ({ id }) => id,
      ),
    ).toEqual([2]);
  });
});
