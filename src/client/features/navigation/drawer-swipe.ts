import type { PanInfo } from "motion/react";
import { useCallback, useRef } from "react";
import {
  type ArticleSwipeIntent,
  articleSwipeIntent,
  articleSwipeOffset,
} from "../reader/interaction/article-swipe.js";

const DISMISS_DISTANCE_RATIO = 0.4;
const DISMISS_VELOCITY = 500;

/** Where the drawer sits for a drag that starts at `base` and has moved `distance`. */
export function drawerSwipeOffset(base: number, distance: number, width: number): number {
  const offset = base + distance;
  // The open position is the edge: dragging further outward only stretches.
  return offset < 0 ? Math.max(offset, -width) : articleSwipeOffset(offset, width, false);
}

/** A drawer closes after a long drag or a quick flick back toward the edge it came from. */
export function drawerSwipeDismisses(offset: number, velocity: number, width: number): boolean {
  return offset <= -width * DISMISS_DISTANCE_RATIO || (offset < 0 && velocity <= -DISMISS_VELOCITY);
}

interface DrawerGesture {
  intent: ArticleSwipeIntent;
  base: number;
  offset: number;
}

// While the finger is down the drawer and scrim follow it directly; on release the
// inline styles are dropped so the open/closed CSS transitions continue from where it was.
export function useDrawerSwipe(enabled: boolean, onDismiss: () => void) {
  const drawerRef = useRef<HTMLElement>(null);
  const scrimRef = useRef<HTMLButtonElement>(null);
  const gesture = useRef<DrawerGesture | null>(null);

  const release = useCallback(() => {
    gesture.current = null;
    drawerRef.current?.style.removeProperty("transform");
    drawerRef.current?.style.removeProperty("transition");
    scrimRef.current?.style.removeProperty("opacity");
    scrimRef.current?.style.removeProperty("transition");
  }, []);

  const onPanStart = useCallback(
    (event: PointerEvent) => {
      const drawer = drawerRef.current;
      if (!enabled || event.pointerType !== "touch" || !drawer) return;
      gesture.current = {
        intent: "pending",
        base: new DOMMatrixReadOnly(getComputedStyle(drawer).transform).m41,
        offset: 0,
      };
    },
    [enabled],
  );

  const onPan = useCallback((_event: PointerEvent, info: PanInfo) => {
    const current = gesture.current;
    const drawer = drawerRef.current;
    if (!current || !drawer) return;
    if (current.intent === "pending")
      current.intent = articleSwipeIntent(info.offset.x, info.offset.y);
    if (current.intent !== "horizontal") return;
    const width = drawer.offsetWidth;
    current.offset = drawerSwipeOffset(current.base, info.offset.x, width);
    drawer.style.transition = "none";
    drawer.style.transform = `translateX(${current.offset}px)`;
    const scrim = scrimRef.current;
    if (scrim) {
      scrim.style.transition = "none";
      scrim.style.opacity = String(Math.min(1, 1 + current.offset / width));
    }
  }, []);

  const onPanEnd = useCallback(
    (event: PointerEvent, info: PanInfo) => {
      const current = gesture.current;
      const drawer = drawerRef.current;
      if (!current || !drawer) return;
      if (
        current.intent === "horizontal" &&
        event.type !== "pointercancel" &&
        drawerSwipeDismisses(current.offset, info.velocity.x, drawer.offsetWidth)
      )
        onDismiss();
      release();
    },
    [onDismiss, release],
  );

  return { drawerRef, scrimRef, onPanStart, onPan, onPanEnd };
}
