import { describe, expect, it } from "vitest";
import {
  PassedArticles,
  readingPositionIndex,
} from "../../src/client/features/reader/interaction/reading-position.js";
import type { Article } from "../../src/shared/types.js";

const article = (id: number) => ({ id }) as Article;

describe("reading a virtual article queue", () => {
  it("marks only articles seen and passed, even after their elements are removed", () => {
    const reading = new PassedArticles();
    reading.observe(1, 0, 200, 0, 600);
    reading.observe(2, 200, 900, 0, 600);
    reading.observe(3, 900, 1100, 0, 600);
    expect(reading.passed(201)).toEqual([1]);
    expect(reading.passed(1200)).toEqual([2]);
    expect(reading.passed(1200)).toEqual([]);
  });
  it("does not finish reading an article merely because its height changed", () => {
    const reading = new PassedArticles();
    reading.observe(1, 0, 200, 0, 600);
    reading.observe(1, 0, 800, 0, 600);
    expect(reading.passed(500)).toEqual([]);
    expect(reading.passed(800)).toEqual([1]);
  });
  it("restores the same article after earlier articles have left the queue", () => {
    expect(
      readingPositionIndex([article(2), article(3)], { articleId: 3, index: 2, offset: -70 }),
    ).toBe(1);
    expect(readingPositionIndex([article(2)], { articleId: 3, index: 2, offset: -70 })).toBe(0);
  });
});
