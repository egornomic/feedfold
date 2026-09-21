import { describe, expect, it } from "vitest";
import {
  articleSwipeDirection,
  articleSwipeDownAction,
  articleSwipeIntent,
  articleSwipeOffset,
} from "../../src/client/features/reader/article-swipe.js";

describe("article swipe navigation", () => {
  it("commits a normal 100px swipe in either direction", () => {
    expect(
      articleSwipeDirection({
        startX: 280,
        startY: 360,
        endX: 180,
        endY: 370,
        horizontalVelocity: -0.08,
      }),
    ).toBe("next");
    expect(
      articleSwipeDirection({
        startX: 110,
        startY: 360,
        endX: 210,
        endY: 350,
        horizontalVelocity: 0.08,
      }),
    ).toBe("previous");
  });

  it("commits a 52px flick from its recent release velocity", () => {
    expect(
      articleSwipeDirection({
        startX: 280,
        startY: 360,
        endX: 228,
        endY: 364,
        horizontalVelocity: -52 / 110,
      }),
    ).toBe("next");
  });

  it("does not let a one-pixel threshold crossing reverse the release direction", () => {
    expect(
      articleSwipeDirection({
        startX: 200,
        startY: 360,
        endX: 137,
        endY: 362,
        horizontalVelocity: 0.5,
      }),
    ).toBeNull();
    expect(
      articleSwipeDirection({
        startX: 200,
        startY: 360,
        endX: 136,
        endY: 362,
        horizontalVelocity: 0.5,
      }),
    ).toBeNull();
  });

  it("uses the projected release endpoint to continue, cancel, or reverse", () => {
    const gesture = {
      startX: 200,
      startY: 360,
      endX: 100,
      endY: 362,
    };

    expect(articleSwipeDirection({ ...gesture, horizontalVelocity: 0.2 })).toBe("next");
    expect(articleSwipeDirection({ ...gesture, horizontalVelocity: 0.5 })).toBeNull();
    expect(articleSwipeDirection({ ...gesture, horizontalVelocity: 1.8 })).toBe("previous");
  });

  it("commits a deliberate 100px drag even after 850ms", () => {
    expect(
      articleSwipeDirection({
        startX: 280,
        startY: 360,
        endX: 180,
        endY: 370,
        horizontalVelocity: -100 / 850,
      }),
    ).toBe("next");
  });

  it("leaves short slow and vertically dominant movement alone", () => {
    expect(
      articleSwipeDirection({
        startX: 230,
        startY: 360,
        endX: 180,
        endY: 365,
        horizontalVelocity: -0.08,
      }),
    ).toBeNull();
    expect(
      articleSwipeDirection({
        startX: 200,
        startY: 500,
        endX: 135,
        endY: 420,
        horizontalVelocity: -0.8,
      }),
    ).toBeNull();
  });

  it("does not turn a small touch wobble into a navigation flick", () => {
    expect(
      articleSwipeDirection({
        startX: 200,
        startY: 360,
        endX: 212,
        endY: 362,
        horizontalVelocity: 0.24,
      }),
    ).toBeNull();
  });
});

describe("article swipe intent", () => {
  it("waits through ambiguous diagonal movement before choosing an axis", () => {
    expect(articleSwipeIntent(6, 2)).toBe("pending");
    expect(articleSwipeIntent(8, 8)).toBe("pending");
    expect(articleSwipeIntent(12, 4)).toBe("horizontal");
    expect(articleSwipeIntent(4, 12)).toBe("vertical");
  });
});

describe("article swipe-down action", () => {
  it("accepts a deliberate downward swipe", () => {
    expect(articleSwipeDownAction({ startX: 190, startY: 120, endX: 198, endY: 196 })).toBe(true);
  });

  it("rejects short, upward, and horizontally dominant gestures", () => {
    expect(articleSwipeDownAction({ startX: 190, startY: 120, endX: 190, endY: 180 })).toBe(false);
    expect(articleSwipeDownAction({ startX: 190, startY: 196, endX: 190, endY: 120 })).toBe(false);
    expect(articleSwipeDownAction({ startX: 190, startY: 120, endX: 280, endY: 196 })).toBe(false);
  });
});

describe("article swipe boundaries", () => {
  it("tracks available directions directly and resists unavailable ones", () => {
    expect(articleSwipeOffset(200, 390, true)).toBe(200);

    const resisted = articleSwipeOffset(200, 390, false);
    expect(resisted).toBeGreaterThan(0);
    expect(resisted).toBeLessThan(200);
    expect(articleSwipeOffset(-200, 390, false)).toBeCloseTo(-resisted);
  });
});
