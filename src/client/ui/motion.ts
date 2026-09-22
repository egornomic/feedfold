import { type SyntheticEvent, useCallback, useEffect, useRef, useState } from "react";

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

function dialogExitDuration(): number {
  const styles = window.getComputedStyle(document.documentElement);
  const property = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "--duration-reduced"
    : "--duration-surface";
  return Number.parseFloat(styles.getPropertyValue(property));
}

export function useAnimatedDialog(
  onClosed: () => void,
  { autoOpen = true }: { autoOpen?: boolean } = {},
): {
  open: () => void;
  close: () => void;
  closing: boolean;
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  handleCancel: (event: SyntheticEvent<HTMLDialogElement>) => void;
  handleClose: () => void;
} {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeTimer = useRef<number | null>(null);
  const [closing, setClosing] = useState(false);

  const open = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    setClosing(false);
    dialog.showModal();
  }, []);

  useEffect(() => {
    if (autoOpen) open();
    return () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    };
  }, [autoOpen, open]);

  const handleClose = useCallback(() => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
    setClosing(false);
    onClosed();
  }, [onClosed]);

  const close = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog?.open) {
      handleClose();
      return;
    }
    if (interactionMotionIsInstant()) {
      dialog.close();
      return;
    }
    setClosing(true);
    closeTimer.current = window.setTimeout(() => dialog.close(), dialogExitDuration());
  }, [handleClose]);

  const handleCancel = useCallback(
    (event: SyntheticEvent<HTMLDialogElement>) => {
      event.preventDefault();
      close();
    },
    [close],
  );

  return {
    open,
    close,
    closing,
    dialogRef,
    handleCancel,
    handleClose,
  };
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
