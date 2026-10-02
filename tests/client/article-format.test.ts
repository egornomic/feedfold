import { describe, expect, it } from "vitest";
import { articleLabel } from "../../src/client/features/reader/article/article-format.js";
import { createDemoData } from "../../src/demo/fixtures.js";

describe("article labels", () => {
  const article = createDemoData().articles[0];
  if (!article) throw new Error("Demo article is missing");

  it.each([
    ["A normal titled article", "Useful description", "A normal titled article"],
    ["  A padded title  ", "Useful description", "A padded title"],
    ["", "Useful description", "Useful description"],
    [" \t\n", "  Useful description  ", "Useful description"],
    ["", "", "Untitled article"],
    ["", " \t\n", "Untitled article"],
    [" \t\n", " \t\n", "Untitled article"],
    [" \t\n", "", "Untitled article"],
  ])("labels title %j and summary %j as %j", (title, summary, expected) => {
    expect(articleLabel({ ...article, title, summary })).toBe(expected);
  });
});
