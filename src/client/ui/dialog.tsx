import { Dialog } from "@base-ui/react/dialog";
import { useCallback, useEffect, useRef, useState } from "react";

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
  return (
    <Dialog.Root
      open={dialog.isOpen}
      onOpenChange={(open, details) => {
        if (!open && !dismissible) details.cancel();
        else dialog.setIsOpen(open);
      }}
      onOpenChangeComplete={(open) => {
        if (!open) dialog.onClosed();
      }}
      disablePointerDismissal={!outsideDismiss || !dismissible}
    >
      <Dialog.Portal>
        <Dialog.Backdrop
          className={`dialog-backdrop${className === "image-lightbox" ? " image-lightbox-backdrop" : ""}`}
        />
        <Dialog.Popup
          ref={dialog.dialogRef}
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
    </Dialog.Root>
  );
}
