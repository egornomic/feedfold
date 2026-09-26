import { useEffect, useState } from "react";

const MOTION_EXIT_MS = 140;
const REDUCED_MOTION_EXIT_MS = 200;

export type MotionState = "open" | "closed";

export function interactionMotionIsInstant(): boolean {
  return document.documentElement.dataset.inputModality === "keyboard";
}

export function motionExitDuration(): number {
  if (interactionMotionIsInstant()) return 0;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? REDUCED_MOTION_EXIT_MS
    : MOTION_EXIT_MS;
}

export function useMotionPresence(visible: boolean): {
  present: boolean;
  state: MotionState;
} {
  const [retained, setRetained] = useState(visible);

  useEffect(() => {
    if (visible) {
      setRetained(true);
      return;
    }
    if (!retained) return;

    const timer = window.setTimeout(() => setRetained(false), motionExitDuration());
    return () => window.clearTimeout(timer);
  }, [retained, visible]);

  return {
    present: visible || retained,
    state: visible ? "open" : "closed",
  };
}
