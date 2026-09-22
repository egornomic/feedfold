import { type CSSProperties, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import "@fontsource-variable/ibm-plex-sans/wght.css";
import "@fontsource-variable/ibm-plex-sans/wght-italic.css";
import { App } from "./app/app";
import { PwaUpdate } from "./app/pwa-update";
import { isDesktopApp } from "./platform/desktop";
import "./features/management/common.css";
import "./styles/base.css";
import "./features/navigation/sidebar.css";
import "./features/auth/authentication.css";
import "./features/reader/reader-toolbar.css";
import "./features/reader/reader.css";
import "./styles/responsive.css";

const root = document.getElementById("root");
if (!root) throw new Error("The feedfold root element is missing.");

const POINTER_MOVE_THRESHOLD = 4;
const TOASTER_OFFSET = {
  top: "max(18px, env(safe-area-inset-top, 0px))",
  right: "max(18px, env(safe-area-inset-right, 0px))",
  bottom: "max(18px, env(safe-area-inset-bottom, 0px))",
  left: "max(18px, env(safe-area-inset-left, 0px))",
};
const TOASTER_STYLE = {
  "--width": "min(430px, calc(100vw - 36px))",
  "--border-radius": "var(--radius-md)",
  zIndex: "var(--z-toast)",
  fontFamily: "var(--font-ui)",
} as CSSProperties;
const TOAST_STYLE: CSSProperties = {
  minHeight: 0,
  gap: 8,
  padding: "10px 13px",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-md)",
  background: "var(--surface-raised)",
  color: "var(--text)",
  boxShadow: "0 4px 8px oklch(0 0 0 / 0.28)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--type-body)",
  fontWeight: "var(--weight-semibold)",
  transition:
    "transform var(--duration-surface) var(--ease-out), opacity var(--duration-surface) var(--ease-out), height var(--duration-surface) var(--ease-out), box-shadow var(--duration-fast) var(--ease-out)",
};
let lastMousePosition: { x: number; y: number } | null = null;

window.addEventListener(
  "keydown",
  () => {
    document.documentElement.dataset.inputModality = "keyboard";
  },
  { capture: true },
);
window.addEventListener(
  "pointerdown",
  () => {
    document.documentElement.dataset.inputModality = "pointer";
  },
  { capture: true },
);
window.addEventListener(
  "pointermove",
  (event) => {
    if (event.pointerType !== "mouse") return;
    const previousPosition = lastMousePosition;
    const deltaX = previousPosition ? event.clientX - previousPosition.x : event.movementX;
    const deltaY = previousPosition ? event.clientY - previousPosition.y : event.movementY;
    lastMousePosition = { x: event.clientX, y: event.clientY };
    if (
      document.documentElement.dataset.inputModality === "keyboard" &&
      Math.hypot(deltaX, deltaY) >= POINTER_MOVE_THRESHOLD
    ) {
      document.documentElement.dataset.inputModality = "pointer";
    }
  },
  { capture: true, passive: true },
);

createRoot(root).render(
  <StrictMode>
    <App />
    {isDesktopApp() ? null : <PwaUpdate />}
    <Toaster
      theme="system"
      position="bottom-right"
      offset={TOASTER_OFFSET}
      mobileOffset={TOASTER_OFFSET}
      duration={2800}
      gap={8}
      style={TOASTER_STYLE}
      toastOptions={{
        classNames: { title: "sonner-toast-title" },
        style: TOAST_STYLE,
      }}
    />
  </StrictMode>,
);
