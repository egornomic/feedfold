import { describe, expect, it } from "vitest";
import { firstSafeImageUrl } from "../../src/server/article-image.js";

describe("article thumbnails", () => {
  it("selects a wide enough image to preserve a tall crop on Retina displays", () => {
    expect(
      firstSafeImageUrl(
        '<img src="/full.jpg" width="1200" height="400" srcset="/small.jpg 480w, /medium.jpg 800w, /full.jpg 1200w">',
        "https://example.com/article",
      ),
    ).toBe("https://example.com/medium.jpg");
  });

  it("selects density variants and images supplied only through srcset", () => {
    expect(
      firstSafeImageUrl(
        '<img src="/full.jpg" srcset="/one.jpg 1x, /two.jpg 2x, /three.jpg 3x">',
        "https://example.com",
      ),
    ).toBe("https://example.com/two.jpg");
    expect(
      firstSafeImageUrl(
        '<img srcset="/small.jpg 200w, /medium.jpg 600w, /large.jpg 1200w">',
        "https://example.com",
      ),
    ).toBe("https://example.com/medium.jpg");
  });

  it("retains the original when the provided variants would lose thumbnail detail", () => {
    expect(
      firstSafeImageUrl(
        '<img src="/full.jpg" srcset="/tiny.jpg 160w, /small.jpg 240w">',
        "https://example.com",
      ),
    ).toBe("https://example.com/full.jpg");
  });

  it("excludes badges and non-HTTP image candidates", () => {
    expect(
      firstSafeImageUrl(
        '<img src="https://img.shields.io/badge/build-green"><img src="/full.jpg" srcset="javascript:alert(1) 480w, https://img.shields.io/badge/build-green 600w, /medium.jpg 800w">',
        "https://example.com",
      ),
    ).toBe("https://example.com/medium.jpg");
  });
});
