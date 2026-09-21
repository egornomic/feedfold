import { useEffect, useRef } from "react";
import type { Article } from "../../../../shared/types";

export function useMarkReadOnScroll({
  articles,
  activeId,
  enabled,
  onMarkPassedRead,
  rootRef,
  useParent = false,
  topAlignedId = null,
}: {
  articles: Article[];
  activeId: number | null;
  enabled: boolean;
  onMarkPassedRead: (articles: Article[]) => Promise<unknown>;
  rootRef: React.RefObject<HTMLElement | null>;
  useParent?: boolean;
  topAlignedId?: number | null;
}) {
  const itemRefs = useRef(new Map<number, HTMLElement>());
  const articlesRef = useRef(articles);
  const enabledRef = useRef(enabled);
  const markPassedRef = useRef(onMarkPassedRead);
  const scrollIntentUntil = useRef(0);
  const lastScrollTop = useRef(0);
  const readRequests = useRef(new Set<number>());
  const queuedReads = useRef(new Map<number, Article>());
  const readTimer = useRef<number | null>(null);
  articlesRef.current = articles;
  enabledRef.current = enabled;
  markPassedRef.current = onMarkPassedRead;

  useEffect(() => {
    const activeItem = activeId === null ? null : itemRefs.current.get(activeId);
    if (!activeItem) return;
    if (!useParent) {
      activeItem.scrollIntoView({ behavior: "auto", block: "nearest" });
      return;
    }
    const root = rootRef.current;
    const container = root?.parentElement;
    if (!container) return;
    const itemRect = activeItem.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    if (activeId === topAlignedId) {
      container.scrollTop += itemRect.top - containerRect.top;
      return;
    }

    const isVisible = itemRect.bottom > containerRect.top && itemRect.top < containerRect.bottom;
    if (isVisible) return;
    if (itemRect.top >= containerRect.bottom && itemRect.height <= containerRect.height) {
      container.scrollTop += itemRect.bottom - containerRect.bottom;
      return;
    }
    container.scrollTop += itemRect.top - containerRect.top;
  }, [activeId, rootRef, topAlignedId, useParent]);

  useEffect(() => {
    const root = rootRef.current;
    const container = useParent ? root?.parentElement : root;
    if (!container) return;
    lastScrollTop.current = container.scrollTop;

    const noteScrollIntent = () => {
      scrollIntentUntil.current = performance.now() + 1500;
    };
    const noteScrollbarIntent = (event: PointerEvent) => {
      if (event.target === container) noteScrollIntent();
    };
    const noteKeyboardScrollIntent = (event: KeyboardEvent) => {
      if (["ArrowDown", "End", "PageDown", " "].includes(event.key)) noteScrollIntent();
    };
    const flushQueuedReads = () => {
      readTimer.current = null;
      if (!enabledRef.current) {
        queuedReads.current.clear();
        return;
      }
      const currentArticles = new Map(articlesRef.current.map((article) => [article.id, article]));
      const batch = [...queuedReads.current.keys()].flatMap((id) => {
        const article = currentArticles.get(id);
        return article && !article.isRead ? [article] : [];
      });
      queuedReads.current.clear();
      if (batch.length === 0) return;
      for (const article of batch) readRequests.current.add(article.id);
      void markPassedRef.current(batch).finally(() => {
        for (const article of batch) readRequests.current.delete(article.id);
      });
    };
    const markPassedItemsRead = () => {
      const scrollingDown = container.scrollTop > lastScrollTop.current + 1;
      lastScrollTop.current = container.scrollTop;
      if (
        !enabledRef.current ||
        !scrollingDown ||
        container.scrollTop <= 0 ||
        performance.now() > scrollIntentUntil.current
      ) {
        return;
      }

      const passedBoundary = container.getBoundingClientRect().top;
      for (const article of articlesRef.current) {
        if (
          article.isRead ||
          queuedReads.current.has(article.id) ||
          readRequests.current.has(article.id)
        ) {
          continue;
        }
        const item = itemRefs.current.get(article.id);
        if (!item || item.getBoundingClientRect().bottom > passedBoundary) continue;
        queuedReads.current.set(article.id, article);
      }

      if (queuedReads.current.size > 0) {
        if (readTimer.current) window.clearTimeout(readTimer.current);
        readTimer.current = window.setTimeout(flushQueuedReads, 250);
      }
    };

    container.addEventListener("wheel", noteScrollIntent, { passive: true });
    container.addEventListener("pointerdown", noteScrollbarIntent, { passive: true });
    container.addEventListener("touchmove", noteScrollIntent, { passive: true });
    container.addEventListener("keydown", noteKeyboardScrollIntent, true);
    container.addEventListener("scroll", markPassedItemsRead, { passive: true });
    return () => {
      container.removeEventListener("wheel", noteScrollIntent);
      container.removeEventListener("pointerdown", noteScrollbarIntent);
      container.removeEventListener("touchmove", noteScrollIntent);
      container.removeEventListener("keydown", noteKeyboardScrollIntent, true);
      container.removeEventListener("scroll", markPassedItemsRead);
      if (readTimer.current) window.clearTimeout(readTimer.current);
      flushQueuedReads();
    };
  }, [rootRef, useParent]);

  return (id: number, element: HTMLElement | null) => {
    if (element) itemRefs.current.set(id, element);
    else itemRefs.current.delete(id);
  };
}
