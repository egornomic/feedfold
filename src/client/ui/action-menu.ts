import type { KeyboardEvent as ReactKeyboardEvent } from "react";

export function handleActionMenuKeyDown(
  event: ReactKeyboardEvent<HTMLElement>,
  onEscape: () => void,
) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    onEscape();
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const items = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>(
      ':is([role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]):not(:disabled)',
    ),
  );
  if (items.length === 0) return;
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : event.key === "ArrowDown"
          ? (Math.max(current, -1) + 1) % items.length
          : (current <= 0 ? items.length : current) - 1;
  items[next]?.focus();
}
