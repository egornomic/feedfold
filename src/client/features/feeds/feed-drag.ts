import { type DragEvent as ReactDragEvent, useCallback, useState } from "react";
import type { Feed } from "../../../shared/types";

export type FeedDropTarget = number | "top-level";

export interface FeedDragState {
  draggedFeed: Feed | null;
  dropTarget: FeedDropTarget | null;
  movingFeedId: number | null;
  start: (feed: Feed, event: ReactDragEvent<HTMLElement>) => void;
  end: () => void;
  enterTarget: (folderId: number | null, event: ReactDragEvent<HTMLElement>) => boolean;
  leaveTarget: (folderId: number | null, event: ReactDragEvent<HTMLElement>) => void;
  dropOnTarget: (folderId: number | null, event: ReactDragEvent<HTMLElement>) => Promise<boolean>;
}

export function feedDropTarget(folderId: number | null): FeedDropTarget {
  return folderId ?? "top-level";
}

export function useFeedDrag(
  feeds: Feed[],
  onMoveFeed: (feed: Feed, folderId: number | null) => Promise<boolean>,
): FeedDragState {
  const [draggedFeedId, setDraggedFeedId] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<FeedDropTarget | null>(null);
  const [movingFeedId, setMovingFeedId] = useState<number | null>(null);
  const draggedFeed = feeds.find((feed) => feed.id === draggedFeedId) ?? null;

  const end = useCallback(() => {
    setDraggedFeedId(null);
    setDropTarget(null);
  }, []);

  const start = useCallback(
    (feed: Feed, event: ReactDragEvent<HTMLElement>) => {
      if (movingFeedId !== null) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/x-feedfold-feed", String(feed.id));
      setDraggedFeedId(feed.id);
      setDropTarget(null);
    },
    [movingFeedId],
  );

  const enterTarget = useCallback(
    (folderId: number | null, event: ReactDragEvent<HTMLElement>) => {
      const target = feedDropTarget(folderId);
      if (!draggedFeed || movingFeedId !== null || draggedFeed.folderId === folderId) {
        event.dataTransfer.dropEffect = "none";
        setDropTarget((current) => (current === target ? null : current));
        return false;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDropTarget(target);
      return true;
    },
    [draggedFeed, movingFeedId],
  );

  const leaveTarget = useCallback((folderId: number | null, event: ReactDragEvent<HTMLElement>) => {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) return;
    const target = feedDropTarget(folderId);
    setDropTarget((current) => (current === target ? null : current));
  }, []);

  const dropOnTarget = useCallback(
    async (folderId: number | null, event: ReactDragEvent<HTMLElement>) => {
      if (!draggedFeed || movingFeedId !== null || draggedFeed.folderId === folderId) return false;
      event.preventDefault();
      event.stopPropagation();
      const feed = draggedFeed;
      end();
      setMovingFeedId(feed.id);
      try {
        return await onMoveFeed(feed, folderId);
      } finally {
        setMovingFeedId((current) => (current === feed.id ? null : current));
      }
    },
    [draggedFeed, end, movingFeedId, onMoveFeed],
  );

  return {
    draggedFeed,
    dropTarget,
    movingFeedId,
    start,
    end,
    enterTarget,
    leaveTarget,
    dropOnTarget,
  };
}
