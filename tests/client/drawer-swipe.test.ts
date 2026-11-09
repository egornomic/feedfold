import { describe, expect, it } from "vitest";
import {
  drawerSwipeDismisses,
  drawerSwipeOffset,
} from "../../src/client/features/navigation/drawer-swipe.js";

describe("navigation drawer swipe", () => {
  it("follows a leftward drag from the open position exactly", () => {
    expect(drawerSwipeOffset(0, -90, 300)).toBe(-90);
  });

  it("continues from where a drawer still sliding open was caught", () => {
    expect(drawerSwipeOffset(-120, 40, 300)).toBe(-80);
  });

  it("never travels past fully closed", () => {
    expect(drawerSwipeOffset(0, -500, 300)).toBe(-300);
  });

  it("stretches with resistance when dragged further open", () => {
    const offset = drawerSwipeOffset(0, 120, 300);
    expect(offset).toBeGreaterThan(0);
    expect(offset).toBeLessThan(120);
  });

  it("closes after a slow drag across 40% of its width", () => {
    expect(drawerSwipeDismisses(-120, -50, 300)).toBe(true);
    expect(drawerSwipeDismisses(-110, -50, 300)).toBe(false);
  });

  it("closes on a quick short flick toward its edge", () => {
    expect(drawerSwipeDismisses(-40, -800, 300)).toBe(true);
  });

  it("stays open when a fast flick ends on the open side", () => {
    expect(drawerSwipeDismisses(10, -800, 300)).toBe(false);
    expect(drawerSwipeDismisses(-40, 800, 300)).toBe(false);
  });
});
