import type { ReactNode } from "react";

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd>{children}</kbd>;
}

export function IconButton({
  label,
  children,
  pressed,
  disabled,
  tooltip = false,
  onClick,
  className = "",
}: {
  label: string;
  children: ReactNode;
  pressed?: boolean;
  disabled?: boolean;
  tooltip?: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      className={`icon-button ${className}`}
      type="button"
      aria-label={label}
      title={tooltip ? undefined : label}
      data-tooltip={tooltip ? label : undefined}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
