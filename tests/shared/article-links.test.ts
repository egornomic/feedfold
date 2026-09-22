import { describe, expect, it } from "vitest";
import { extractHttpLinks } from "../../src/shared/article-links.js";

describe("article summary links", () => {
  it("turns labelled absolute URLs from any feed summary into links", () => {
    const summary =
      "Source URL: https://example.test/story A short note. Discussion URL: https://forum.example.test/thread?id=42";

    expect(
      extractHttpLinks(summary).map(({ href, label, text }) => ({ href, label, text })),
    ).toEqual([
      {
        href: "https://example.test/story",
        label: "Source URL",
        text: "https://example.test/story",
      },
      {
        href: "https://forum.example.test/thread?id=42",
        label: "Discussion URL",
        text: "https://forum.example.test/thread?id=42",
      },
    ]);
  });
});
