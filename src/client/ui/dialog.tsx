import { Dialog } from "@base-ui/react/dialog";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { surfaceTransition } from "./motion.js";

export function useDialog(onClosed: () => void, { autoOpen = true } = {}) {
  const [isOpen, setIsOpen] = useState(autoOpen);
  const dialogRef = useRef<HTMLDivElement>(null);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    if (autoOpen) open();
  }, [autoOpen, open]);

  return { isOpen, setIsOpen, dialogRef, open, close, onClosed };
}

export function Modal({
  dialog,
  dismissible = true,
  outsideDismiss = false,
  className,
  children,
  ...props
}: Omit<Dialog.Popup.Props, "className"> & {
  dialog: ReturnType<typeof useDialog>;
  dismissible?: boolean;
  outsideDismiss?: boolean;
  className: string;
}) {
  const reduced = Boolean(useReducedMotion());
  const actionsRef = useRef<Dialog.Root.Actions>(null);
  const closed = {
    opacity: 0,
    transform: reduced || className === "image-lightbox" ? "none" : "scale(0.96)",
  };
  return (
    <Dialog.Root
      actionsRef={actionsRef}
      open={dialog.isOpen}
      onOpenChange={(open, details) => {
        if (!open && !dismissible) details.cancel();
        else dialog.setIsOpen(open);
      }}
      disablePointerDismissal={!outsideDismiss || !dismissible}
    >
      <AnimatePresence
        custom={{ ...closed, transition: surfaceTransition(reduced) }}
        onExitComplete={() => {
          if (dialog.isOpen) return;
          actionsRef.current?.unmount();
          dialog.onClosed();
        }}
      >
        {dialog.isOpen ? (
          <Dialog.Portal keepMounted>
            <Dialog.Backdrop
              className={`dialog-backdrop${className === "image-lightbox" ? " image-lightbox-backdrop" : ""}`}
            />
            <Dialog.Popup
              ref={dialog.dialogRef}
              render={
                <motion.div
                  initial={surfaceTransition(reduced).duration === 0 ? false : closed}
                  animate={{
                    opacity: 1,
                    transform: reduced || className === "image-lightbox" ? "none" : "scale(1)",
                  }}
                  variants={{ closed: (target) => target }}
                  exit="closed"
                  transition={surfaceTransition(reduced)}
                />
              }
              className={`dialog-popup ${className}`}
              initialFocus={(type) =>
                type === "touch"
                  ? dialog.dialogRef.current
                  : (dialog.dialogRef.current?.querySelector<HTMLElement>(
                      "[data-dialog-initial-focus]",
                    ) ?? true)
              }
              {...props}
            >
              {children}
            </Dialog.Popup>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  );
}
