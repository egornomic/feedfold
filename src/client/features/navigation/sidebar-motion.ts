import { type Dispatch, type SetStateAction, useCallback, useLayoutEffect, useRef } from "react";

interface SidebarLayoutSnapshot {
  items: Array<{ element: HTMLElement; left: number; top: number }>;
}

function visibleSidebarMotionItems(main: HTMLElement | null): HTMLElement[] {
  if (!main) return [];
  const content = main.querySelectorAll<HTMLElement>(
    [
      ".reader-title-row > *",
      ".article-list > ol",
      ".mode-magazine .article-document",
      ".expanded-stream",
    ].join(","),
  );
  return [...content].filter((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.width > 0 && bounds.height > 0;
  });
}

export function useSidebarMotion(
  readerView: boolean,
  desktopSidebarCollapsed: boolean,
  setDesktopSidebarCollapsed: Dispatch<SetStateAction<boolean>>,
) {
  const sidebarLayoutSnapshot = useRef<SidebarLayoutSnapshot | null>(null);
  const sidebarLayoutAnimations = useRef<Animation[]>([]);
  const toggleDesktopSidebar = useCallback(() => {
    const main = document.querySelector<HTMLElement>(".main-column");
    sidebarLayoutSnapshot.current = {
      items: (readerView ? visibleSidebarMotionItems(main) : []).map((element) => {
        const bounds = element.getBoundingClientRect();
        return { element, left: bounds.left, top: bounds.top };
      }),
    };
    setDesktopSidebarCollapsed((current) => !current);
  }, [readerView, setDesktopSidebarCollapsed]);

  useLayoutEffect(() => {
    const snapshot = sidebarLayoutSnapshot.current;
    if (!snapshot) return;
    sidebarLayoutSnapshot.current = null;
    for (const animation of sidebarLayoutAnimations.current) animation.cancel();

    const main = document.querySelector<HTMLElement>(".main-column");
    const toggleLabel = desktopSidebarCollapsed ? "Show sidebar" : "Hide sidebar";
    const toggle = document.querySelector<HTMLElement>(
      `.sidebar-collapse-button[aria-label="${toggleLabel}"]`,
    );
    const styles = window.getComputedStyle(document.documentElement);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = Number.parseFloat(
      styles.getPropertyValue(reducedMotion ? "--duration-reduced" : "--duration-surface"),
    );
    const easing = reducedMotion ? "ease" : styles.getPropertyValue("--ease-in-out").trim();
    const animations: Animation[] = [];

    if (reducedMotion) {
      if (main) {
        animations.push(main.animate([{ opacity: 0.86 }, { opacity: 1 }], { duration, easing }));
      }
      if (toggle) {
        animations.push(toggle.animate([{ opacity: 0.72 }, { opacity: 1 }], { duration, easing }));
      }
    } else {
      for (const { element, left, top } of snapshot.items) {
        if (!element.isConnected) continue;
        const bounds = element.getBoundingClientRect();
        const offsetX = left - bounds.left;
        const offsetY = top - bounds.top;
        if (Math.abs(offsetX) < 0.5 && Math.abs(offsetY) < 0.5) continue;
        animations.push(
          element.animate(
            [
              { transform: `translate3d(${offsetX}px, ${offsetY}px, 0)` },
              { transform: "translate3d(0, 0, 0)" },
            ],
            { duration, easing },
          ),
        );
      }
    }

    sidebarLayoutAnimations.current = animations;
    return () => {
      for (const animation of animations) animation.cancel();
    };
  }, [desktopSidebarCollapsed]);

  return toggleDesktopSidebar;
}
