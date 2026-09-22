import { describe, expect, it } from "vitest";
import {
  articleContentView,
  articleTranslationSourceKind,
  fullContentToggleAction,
  shouldShowArticleDescription,
} from "../../src/client/features/reader/article/article-content.js";
import type { Article } from "../../src/shared/types.js";

function linkedArticle(): Article {
  return {
    id: 1,
    feedId: 1,
    feedTitle: "Linked feed",
    feedSourceKind: "published",
    folderId: null,
    title: "Commentary about an external post",
    url: "https://external.example/post",
    author: "Feed author",
    publishedAt: null,
    discoveredAt: "2026-07-17T00:00:00.000Z",
    summary: "Feed summary",
    imageUrl: null,
    media: null,
    feedContentHtml: "<p>Complete commentary supplied by the feed.</p>",
    contentHtml: "<p>Text extracted from the external post.</p>",
    contentSource: "article",
    extractionStatus: "complete",
    extractionError: null,
    aiSummary: null,
    isRead: false,
    isStarred: false,
  };
}

describe("article content source selection", () => {
  it("switches between the feed article and cached publisher content", () => {
    const article = linkedArticle();

    expect(articleContentView(article, false)).toBe("feed");
    expect(articleContentView(article, true)).toBe("full");
    expect(fullContentToggleAction(article, false)).toBe("show");
    expect(fullContentToggleAction(article, true)).toBe("hide");
  });

  it("keeps extraction progress and failure distinct from the feed fallback", () => {
    const article = linkedArticle();

    expect(
      articleContentView({ ...article, contentHtml: null, extractionStatus: "processing" }, true),
    ).toBe("loading");
    expect(
      articleContentView({ ...article, contentHtml: null, extractionStatus: "failed" }, true),
    ).toBe("failed");
    expect(
      fullContentToggleAction(
        { ...article, contentHtml: null, extractionStatus: "processing" },
        true,
      ),
    ).toBe("wait");
    expect(
      fullContentToggleAction({ ...article, contentHtml: null, extractionStatus: "failed" }, true),
    ).toBe("load");
  });

  it("translates the article text currently shown in the reader", () => {
    const article = linkedArticle();

    expect(articleTranslationSourceKind(article, false)).toBe("feed");
    expect(articleTranslationSourceKind(article, true)).toBe("full");
    expect(
      articleTranslationSourceKind(
        { ...article, contentHtml: null, extractionStatus: "processing" },
        true,
      ),
    ).toBe("feed");
    expect(
      articleTranslationSourceKind(
        { ...article, contentHtml: null, feedContentHtml: null, extractionStatus: "feed" },
        false,
      ),
    ).toBe("excerpt");
  });

  it("hides only YouTube descriptions when the preference is off", () => {
    const article = linkedArticle();
    const youtubeArticle: Article = {
      ...article,
      media: {
        provider: "youtube",
        type: "video",
        embedUrl: "https://www.youtube.com/embed/video-id",
        thumbnailUrl: "https://i.ytimg.com/vi/video-id/hqdefault.jpg",
        viewCount: null,
      },
    };

    expect(shouldShowArticleDescription(article, false)).toBe(true);
    expect(shouldShowArticleDescription(youtubeArticle, false)).toBe(false);
    expect(shouldShowArticleDescription(youtubeArticle, true)).toBe(true);
  });
});
