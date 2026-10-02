import { JSDOM } from "jsdom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createDemoData } from "../../src/demo/fixtures.js";
import type { Article } from "../../src/shared/types.js";

async function sourceRow(viewCount: number | null): Promise<string[]> {
  const modulePath: string = "../../src/client/features/reader/article/article-header.js";
  const { ArticleHeader } = await import(modulePath);
  const base = createDemoData().articles[0];
  if (!base) throw new Error("The demo article fixture is empty");
  const article: Article = {
    ...base,
    feedId: null,
    media: {
      provider: "youtube",
      type: "video",
      embedUrl: "https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ",
      thumbnailUrl: "https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg",
      viewCount,
    },
  };
  const dom = new JSDOM(
    renderToStaticMarkup(
      createElement(ArticleHeader, { article, id: "article-title", onFeedAction: () => {} }),
    ),
  );
  const labels = Array.from(
    dom.window.document.querySelectorAll(".article-source-row > span"),
    (element) => element.textContent ?? "",
  );
  dom.window.close();
  return labels;
}

describe("article header view counts", () => {
  it.each([
    [0, "0 views"],
    [1, "1 view"],
    [2, "2 views"],
    [12, "12 views"],
    [
      1_284_000,
      `${new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(1_284_000)} views`,
    ],
  ] as const)("labels %s recorded views", async (count, label) => {
    expect(await sourceRow(count)).toContain(label);
  });

  it("omits the view count when the publisher supplies none", async () => {
    const labels = await sourceRow(null);
    expect(labels).toContain("Video");
    expect(labels.some((label) => /\bviews?\b/.test(label))).toBe(false);
  });
});
