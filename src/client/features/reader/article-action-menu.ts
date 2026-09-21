import {
  type KeyboardEvent as ReactKeyboardEvent,
  type SyntheticEvent,
  useCallback,
  useRef,
  useState,
} from "react";
import { handleActionMenuKeyDown } from "../../feed-management";

export function useActionMenu() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusMenuOnOpen = useRef(false);

  const closeMenu = useCallback(() => {
    menuRef.current?.hidePopover();
    triggerRef.current?.focus();
  }, []);

  const handleTriggerPointerDown = useCallback(() => {
    focusMenuOnOpen.current = false;
  }, []);

  const handleTriggerKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "Escape" && open) {
        event.preventDefault();
        event.stopPropagation();
        closeMenu();
        return;
      }
      if (["ArrowDown", "Enter", " "].includes(event.key)) {
        focusMenuOnOpen.current = true;
      }
      if (event.key !== "ArrowDown") return;
      event.preventDefault();
      menuRef.current?.showPopover();
    },
    [closeMenu, open],
  );

  const handleMenuToggle = useCallback((event: SyntheticEvent<HTMLDivElement>) => {
    const nextOpen = event.currentTarget.matches(":popover-open");
    setOpen(nextOpen);
    if (!nextOpen || !focusMenuOnOpen.current) return;
    window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    });
  }, []);

  const handleMenuKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      event.stopPropagation();
      handleActionMenuKeyDown(event, closeMenu);
    },
    [closeMenu],
  );

  return {
    closeMenu,
    handleMenuKeyDown,
    handleMenuToggle,
    handleTriggerKeyDown,
    handleTriggerPointerDown,
    menuRef,
    open,
    triggerRef,
  };
}
