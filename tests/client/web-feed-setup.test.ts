import { describe, expect, it } from "vitest";
import { groupWebFeedCandidates } from "../../src/client/features/feeds/web-feed-candidate-options.js";
import type { WebFeedCandidate } from "../../src/shared/types.js";

function candidate(id: string, label: string, title: string): WebFeedCandidate {
  return {
    id,
    label,
    itemCount: id === "suggested" ? 12 : 2,
    availableFields: ["title", "link"],
    config: {
      pageUrl: "https://example.test/articles",
      selectors: {
        item: `[data-group="${id}"]`,
        title: "a",
        link: "a",
        date: null,
        author: null,
        summary: null,
        image: null,
      },
    },
    articles: [
      {
        title,
        url: `https://example.test/${id}`,
        author: null,
        publishedAt: null,
        summary: "",
        imageUrl: null,
      },
    ],
  };
}

describe("web feed setup options", () => {
  it("keeps detected groups available when they were not suggested", () => {
    const suggested = candidate("suggested", "Articles", "Recommended story");
    const manual = candidate("manual", "Repeated page entries", "Manual release");

    expect(groupWebFeedCandidates([suggested, manual], [suggested.id])).toEqual({
      suggested: [suggested],
      other: [manual],
    });
  });
});
