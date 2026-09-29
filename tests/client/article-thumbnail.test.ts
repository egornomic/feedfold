import { describe, expect, it } from "vitest";
import {
  articleImageUrl,
  articleThumbnailUrl,
} from "../../src/client/features/reader/article/article-image-url.js";

describe("queue thumbnail delivery", () => {
  it("requests a cropped, high-density image directly from Unsplash and preserves the original URL", () => {
    const original =
      "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=720&q=82";
    const thumbnail = new URL(articleThumbnailUrl(1, original, "small", 3));
    expect(thumbnail.searchParams.get("w")).toBe("228");
    expect(thumbnail.searchParams.get("h")).toBe("228");
    expect(thumbnail.searchParams.get("q")).toBe("82");
    expect(articleImageUrl(original)).toBe(original);
  });

  it("uses the account's article resource for other publishers and internal media previews", () => {
    for (const original of [
      "https://publisher.test/photo.jpg",
      "/api/articles/42/telegram-media-preview",
    ]) {
      expect(articleThumbnailUrl(42, original, "large", 2)).toBe(
        "/api/articles/42/thumbnail/large/2",
      );
    }
  });
});
