const MINIMUM_SWIPE_DISTANCE = 64;
const MINIMUM_INTENT_DISTANCE = 10;
const HORIZONTAL_DOMINANCE = 1.25;
const MOMENTUM_DECELERATION_RATE = 0.99;
const RUBBER_BAND_CONSTANT = 0.55;

export type ArticleSwipeDirection = "previous" | "next";
export type ArticleSwipeIntent = "pending" | "horizontal" | "vertical";

interface ArticleSwipeGesture {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  horizontalVelocity: number;
}

interface ArticleSwipeDownGesture {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export function articleSwipeDirection({
  startX,
  startY,
  endX,
  endY,
  horizontalVelocity,
}: ArticleSwipeGesture): ArticleSwipeDirection | null {
  const horizontalDistance = endX - startX;
  const verticalDistance = endY - startY;
  const projectedDistance =
    horizontalDistance +
    (horizontalVelocity * MOMENTUM_DECELERATION_RATE) / (1 - MOMENTUM_DECELERATION_RATE);

  if (
    Math.abs(horizontalDistance) < MINIMUM_INTENT_DISTANCE ||
    Math.abs(projectedDistance) < MINIMUM_SWIPE_DISTANCE ||
    Math.abs(horizontalDistance) < Math.abs(verticalDistance) * HORIZONTAL_DOMINANCE
  ) {
    return null;
  }

  return projectedDistance < 0 ? "next" : "previous";
}

export function articleSwipeIntent(
  horizontalDistance: number,
  verticalDistance: number,
): ArticleSwipeIntent {
  if (Math.hypot(horizontalDistance, verticalDistance) < MINIMUM_INTENT_DISTANCE) {
    return "pending";
  }

  const horizontalMagnitude = Math.abs(horizontalDistance);
  const verticalMagnitude = Math.abs(verticalDistance);
  if (horizontalMagnitude >= verticalMagnitude * HORIZONTAL_DOMINANCE) return "horizontal";
  if (verticalMagnitude >= horizontalMagnitude * HORIZONTAL_DOMINANCE) return "vertical";
  return "pending";
}

export function articleSwipeDownAction({
  startX,
  startY,
  endX,
  endY,
}: ArticleSwipeDownGesture): boolean {
  const horizontalDistance = endX - startX;
  const verticalDistance = endY - startY;
  return (
    verticalDistance >= MINIMUM_SWIPE_DISTANCE &&
    verticalDistance >= Math.abs(horizontalDistance) * HORIZONTAL_DOMINANCE
  );
}

export function articleSwipeOffset(
  distance: number,
  surfaceWidth: number,
  directionAvailable: boolean,
): number {
  if (directionAvailable || surfaceWidth <= 0) return distance;
  return (
    (distance * surfaceWidth * RUBBER_BAND_CONSTANT) /
    (surfaceWidth + RUBBER_BAND_CONSTANT * Math.abs(distance))
  );
}
