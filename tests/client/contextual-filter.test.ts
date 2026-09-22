import { describe, expect, it } from "vitest";
import { articlesWithContextReturn } from "../../src/client/features/reader/contextual-filter.js";
import type { Article } from "../../src/shared/types.js";

function article(id: number, contentHtml: string | null = null): Article {
  return {
    id,
    feedId: 1,
    feedTitle: "Example feed",
    feedSourceKind: "published",
    folderId: null,
    title: `Article ${id}`,
    url: null,
    author: null,
    publishedAt: null,
    discoveredAt: "2026-07-17T00:00:00.000Z",
    summary: `Summary ${id}`,
    imageUrl: null,
    media: null,
    feedContentHtml: null,
    contentHtml,
    contentSource: contentHtml ? "article" : null,
    extractionStatus: contentHtml ? "complete" : "feed",
    extractionError: null,
    aiSummary: null,
    isRead: false,
    isStarred: false,
  };
}

describe("returning from a contextual filter", () => {
  it("keeps the source article at its prior position when the new rule hides it", () => {
    const source = article(2, "<p>Full source article</p>");

    expect(
      articlesWithContextReturn([article(1), article(3)], { article: source, index: 1 }).map(
        ({ id }) => id,
      ),
    ).toEqual([1, 2, 3]);
  });

  it("keeps loaded article content while using its refreshed read and star state", () => {
    const source = article(2, "<p>Full source article</p>");
    const refreshed = { ...article(2), isRead: true, isStarred: true };

    expect(articlesWithContextReturn([refreshed], { article: source, index: 0 })[0]).toMatchObject({
      id: 2,
      contentHtml: "<p>Full source article</p>",
      isRead: true,
      isStarred: true,
    });
  });
});
