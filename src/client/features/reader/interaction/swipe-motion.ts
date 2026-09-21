const POSITION_THRESHOLD = 0.5;
const VELOCITY_THRESHOLD = 5;

interface HorizontalSpringUpdate {
  position: number;
  velocity: number;
  progress: number;
}

interface HorizontalSpringOptions {
  initialPosition: number;
  initialVelocity: number;
  target: number;
  damping: 1;
  response: number;
  onUpdate: (update: HorizontalSpringUpdate) => void;
  onComplete?: () => void;
}

export interface HorizontalSpringController {
  cancel: () => void;
}

export function animateHorizontalSpring({
  initialPosition,
  initialVelocity,
  target,
  response,
  onUpdate,
  onComplete,
}: HorizontalSpringOptions): HorizontalSpringController {
  const omega = (2 * Math.PI) / response;
  const initialOffset = initialPosition - target;
  const velocityOffset = initialVelocity + omega * initialOffset;
  const initialDistance = Math.abs(initialOffset);
  const startedAt = performance.now();
  let frameHandle: number | null = null;
  let cancelled = false;
  let maxProgress = 0;

  const report = (position: number, velocity: number) => {
    const remainingDistance = Math.abs(position - target);
    const computedProgress =
      initialDistance === 0 ? 1 : Math.min(1, Math.max(0, 1 - remainingDistance / initialDistance));
    maxProgress = Math.max(maxProgress, computedProgress);
    onUpdate({ position, velocity, progress: maxProgress });
  };

  report(initialPosition, initialVelocity);

  const tick = (now: number) => {
    if (cancelled) return;
    const elapsed = Math.max(0, (now - startedAt) / 1000);
    const decay = Math.exp(-omega * elapsed);
    const offset = (initialOffset + velocityOffset * elapsed) * decay;
    const velocity = (initialVelocity - omega * velocityOffset * elapsed) * decay;
    const position = target + offset;

    if (Math.abs(offset) <= POSITION_THRESHOLD && Math.abs(velocity) < VELOCITY_THRESHOLD) {
      report(target, 0);
      frameHandle = null;
      onComplete?.();
      return;
    }

    report(position, velocity);
    frameHandle = window.requestAnimationFrame(tick);
  };

  frameHandle = window.requestAnimationFrame(tick);

  return {
    cancel: () => {
      cancelled = true;
      if (frameHandle !== null) window.cancelAnimationFrame(frameHandle);
      frameHandle = null;
    },
  };
}
