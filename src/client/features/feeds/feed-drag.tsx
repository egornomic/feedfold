import { pointerIntersection } from "@dnd-kit/collision";
import {
  Accessibility,
  Feedback,
  KeyboardSensor,
  PointerActivationConstraints,
  PointerSensor,
} from "@dnd-kit/dom";
import { DragDropProvider, useDraggable, useDragOperation, useDroppable } from "@dnd-kit/react";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import type { Feed } from "../../../shared/types";

export type FeedDropTarget = number | "top-level";

export interface FeedDragState {
  draggedFeed: Feed | null;
  movingFeedId: number | null;
}

interface FeedFocusTarget {
  feedId: number;
  folderId: number | null;
}

const FeedDragContext = createContext<
  FeedDragState & { focusAfterMove: FeedFocusTarget | null; clearFocusAfterMove: () => void }
>({ draggedFeed: null, movingFeedId: null, focusAfterMove: null, clearFocusAfterMove: () => {} });
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
        : `Move requested for ${source?.data.feed.title} to ${target.data.label}.`,
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

  const [focusAfterMove, setFocusAfterMove] = useState<FeedFocusTarget | null>(null);
  const clearFocusAfterMove = useCallback(() => setFocusAfterMove(null), []);

  return (
    <DragDropProvider
      sensors={sensors}
      plugins={(defaults) => [
        ...defaults,
        Accessibility.configure(accessibility),
        Feedback.configure({ feedback: "clone", dropAnimation: null }),
      ]}
      onDragStart={({ operation }) => {
        setFocusAfterMove(null);
        setDraggedFeed(operation.source?.data.feed ?? null);
      }}
      onDragEnd={async ({ operation, canceled }) => {
        setDraggedFeed(null);
        const feed: Feed | undefined = operation.source?.data.feed;
        const destination = operation.target?.data;
        if (canceled || !feed || !destination || feed.folderId === destination.folderId) return;
        setMovingFeedId(feed.id);
        try {
          if (await onMoveFeed(feed, destination.folderId)) {
            destination.onMoved?.();
            if (operation.activatorEvent instanceof KeyboardEvent) {
              // A fast move can batch away the moving state; focus needs its own update.
              setFocusAfterMove({ feedId: feed.id, folderId: destination.folderId });
            }
          }
        } finally {
          setMovingFeedId(null);
        }
      }}
    >
      <FeedDragContext value={{ draggedFeed, movingFeedId, focusAfterMove, clearFocusAfterMove }}>
        {children}
      </FeedDragContext>
    </DragDropProvider>
  );
}

export function useFeedDrag(): FeedDragState {
  return useContext(FeedDragContext);
}

export function useFeedDraggable(feed: Feed) {
  const { movingFeedId, focusAfterMove, clearFocusAfterMove } = useContext(FeedDragContext);
  const { source } = useDragOperation();
  const result = useDraggable({
    id: `feed:${feed.id}`,
    data: { feed },
    disabled: movingFeedId !== null,
  });
  useEffect(() => {
    // Query notifications can render the destination after the move promise resolves.
    // Wait for that row and for removal of the drag preview before restoring focus.
    if (source || focusAfterMove?.feedId !== feed.id || focusAfterMove.folderId !== feed.folderId)
      return;
    const element = result.draggable.element;
    if (element instanceof HTMLElement) {
      element.focus();
      clearFocusAfterMove();
    }
  }, [source, focusAfterMove, feed.id, feed.folderId, result.draggable, clearFocusAfterMove]);
  return result;
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
