import { describe, expect, it } from "vitest";
import {
  folderBranchFeedCount,
  folderHierarchy,
  folderPathLabel,
} from "../../src/client/features/feeds/folder-hierarchy.js";
import type { Feed, Folder } from "../../src/shared/types.js";

function folder(id: number, name: string, parentId: number | null = null): Folder {
  return { id, name, parentId, position: id, sortDirection: "newest", unreadCount: 0 };
}

function feed(id: number, folderId: number | null): Feed {
  return {
    id,
    title: `Feed ${id}`,
    feedUrl: `https://example.com/${id}.xml`,
    siteUrl: "https://example.com",
    folderId,
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
  };
}

describe("folder hierarchy", () => {
  const folders = [
    folder(3, "Reading", 1),
    folder(2, "Work"),
    folder(1, "Personal"),
    folder(4, "Reading", 2),
  ];

  it("orders folders as a tree and gives duplicate names distinct paths", () => {
    expect(
      folderHierarchy(folders).map(({ folder, depth, path }) => [folder.id, depth, path]),
    ).toEqual([
      [1, 0, "Personal"],
      [3, 1, "Personal / Reading"],
      [2, 0, "Work"],
      [4, 1, "Work / Reading"],
    ]);
    expect(folderPathLabel(3, folders)).toBe("Personal / Reading");
    expect(folderPathLabel(null, folders)).toBe("Top level");
  });

  it("counts feeds across the complete folder branch", () => {
    const feeds = [feed(1, 1), feed(2, 3), feed(3, 2), feed(4, null)];
    expect(folderBranchFeedCount(1, folders, feeds)).toBe(2);
    expect(folderBranchFeedCount(3, folders, feeds)).toBe(1);
  });
});
