import { pointerIntersection } from "@dnd-kit/collision";
import {
  Accessibility,
  type DragDropManager,
  Feedback,
  KeyboardSensor,
  PointerActivationConstraints,
  PointerSensor,
} from "@dnd-kit/dom";
import { DragDropProvider, useDraggable, useDroppable } from "@dnd-kit/react";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import type { Feed } from "../../../shared/types";

export type FeedDropTarget = number | "top-level";

export interface FeedDragState {
  draggedFeed: Feed | null;
  movingFeedId: number | null;
}

const FeedDragContext = createContext<FeedDragState>({ draggedFeed: null, movingFeedId: null });
const sensors = [
  PointerSensor.configure({
    activationConstraints: (event) =>
      event.pointerType === "touch"
        ? [new PointerActivationConstraints.Delay({ value: 250, tolerance: 5 })]
        : [new PointerActivationConstraints.Distance({ value: 5 })],
  }),
  KeyboardSensor.configure({
    offset: 20,
    keyboardCodes: { ...KeyboardSensor.defaults.keyboardCodes, start: ["Space"] },
  }),
];

const accessibility: NonNullable<ConstructorParameters<typeof Accessibility>[1]> = {
  announcements: {
    dragstart: ({ operation: { source } }) => `Picked up ${source?.data.feed.title}.`,
    dragover: ({ operation: { target } }) =>
      target ? `Move to ${target.data.label}.` : "Choose a folder or the top level.",
    dragend: ({ operation: { source, target }, canceled }) =>
      canceled || !target
        ? "Move canceled."
        : `Dropped ${source?.data.feed.title} on ${target.data.label}.`,
  },
};

export function feedDropTarget(folderId: number | null): FeedDropTarget {
  return folderId ?? "top-level";
}

export function FeedDragProvider({
  children,
  onMoveFeed,
}: {
  children: ReactNode;
  onMoveFeed: (feed: Feed, folderId: number | null) => Promise<boolean>;
}) {
  const [draggedFeed, setDraggedFeed] = useState<Feed | null>(null);
  const [movingFeedId, setMovingFeedId] = useState<number | null>(null);

  const focusAfterMove = useRef<{ manager: DragDropManager; feedId: number } | null>(null);
  useEffect(() => {
    const pending = focusAfterMove.current;
    if (movingFeedId !== null || !pending) return;
    const element = pending.manager.registry.draggables.get(`feed:${pending.feedId}`)?.element;
    if (element instanceof HTMLElement) element.focus();
    focusAfterMove.current = null;
  }, [movingFeedId]);

  return (
    <DragDropProvider
      sensors={sensors}
      plugins={(defaults) => [
        ...defaults,
        Accessibility.configure(accessibility),
        Feedback.configure({ feedback: "clone", dropAnimation: null }),
      ]}
      onDragStart={({ operation }) => setDraggedFeed(operation.source?.data.feed ?? null)}
      onDragEnd={async ({ operation, canceled }, manager) => {
        setDraggedFeed(null);
        const feed: Feed | undefined = operation.source?.data.feed;
        const destination = operation.target?.data;
        if (canceled || !feed || !destination || feed.folderId === destination.folderId) return;
        setMovingFeedId(feed.id);
        try {
          if (await onMoveFeed(feed, destination.folderId)) {
            destination.onMoved?.();
            if (operation.activatorEvent instanceof KeyboardEvent) {
              // The destination row mounts when the successful move finishes rendering.
              focusAfterMove.current = { manager, feedId: feed.id };
            }
          }
        } finally {
          setMovingFeedId(null);
        }
      }}
    >
      <FeedDragContext value={{ draggedFeed, movingFeedId }}>{children}</FeedDragContext>
    </DragDropProvider>
  );
}

export function useFeedDrag(): FeedDragState {
  return useContext(FeedDragContext);
}

export function useFeedDraggable(feed: Feed) {
  const { movingFeedId } = useFeedDrag();
  return useDraggable({ id: `feed:${feed.id}`, data: { feed }, disabled: movingFeedId !== null });
}

export function useFeedDropTarget(folderId: number | null, label: string, onMoved?: () => void) {
  const { draggedFeed, movingFeedId } = useFeedDrag();
  const available = draggedFeed !== null && draggedFeed.folderId !== folderId;
  const droppable = useDroppable({
    id: feedDropTarget(folderId),
    data: { folderId, label, onMoved },
    disabled: movingFeedId !== null,
    accept: (source) => source.data.feed.folderId !== folderId,
    collisionDetector: pointerIntersection,
  });
  return { ...droppable, available };
}
