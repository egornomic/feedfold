import { randomBytes } from "node:crypto";
import type { RankedWebFeedCandidate } from "./dom.js";

function markCandidateElements(candidates: RankedWebFeedCandidate[]): void {
  for (const { candidate, elements } of candidates) {
    for (const element of elements) {
      const ids = new Set((element.getAttribute("data-feedfold-candidates") ?? "").split(/\s+/));
      ids.delete("");
      ids.add(candidate.id);
      element.setAttribute("data-feedfold-candidates", [...ids].join(" "));
    }
  }
}

function safeSnapshotResource(element: Element, attributeName: string): boolean {
  const value = element.getAttribute(attributeName);
  if (!value) return false;
  return /^(?:data|blob):/i.test(value);
}

function pickerScript(messageToken: string): string {
  return `(() => {
  const MESSAGE_TOKEN = ${JSON.stringify(messageToken)};
  const ITEM_SELECTOR = "[data-feedfold-candidates]";
  const INSTRUCTIONS_ID = "feedfold-picker-instructions";
  let activeCandidateId = null;
  let pointerStart = null;

  const items = () => Array.from(document.querySelectorAll(ITEM_SELECTOR));
  const candidateIds = (element) => (element.getAttribute("data-feedfold-candidates") || "")
    .split(/\\s+/).filter(Boolean);
  const setHighlight = (candidateId) => {
    activeCandidateId = candidateId;
    for (const element of items()) {
      const highlighted = Boolean(candidateId) && candidateIds(element).includes(candidateId);
      element.toggleAttribute("data-feedfold-highlighted", highlighted);
      element.setAttribute("aria-pressed", String(highlighted));
    }
  };
  const select = (element) => {
    const ids = candidateIds(element);
    const candidateId = ids.includes(activeCandidateId) ? activeCandidateId : (ids[0] || null);
    if (!candidateId) return;
    setHighlight(candidateId);
    parent.postMessage({
      type: "feedfold:web-feed-select",
      messageToken: MESSAGE_TOKEN,
      candidateId,
    }, "*");
  };
  const itemFor = (target) => target instanceof Element ? target.closest(ITEM_SELECTOR) : null;

  const instructions = document.createElement("p");
  instructions.id = INSTRUCTIONS_ID;
  instructions.textContent = "Choose entries for this feed. Page controls are disabled. Use the arrow keys to move, Enter or Space to select a group, and Escape to clear the selection.";
  Object.assign(instructions.style, {
    position: "absolute",
    width: "1px",
    height: "1px",
    padding: "0",
    margin: "-1px",
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    whiteSpace: "nowrap",
    border: "0",
  });
  document.body.prepend(instructions);

  for (const element of items()) {
    const visibleName = (element.querySelector("h1, h2, h3, h4, h5, h6")?.textContent ||
      element.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 120);
    element.tabIndex = 0;
    element.setAttribute("role", "button");
    element.setAttribute("aria-label", visibleName
      ? "Choose the entry group represented by " + visibleName
      : "Choose this entry group for the feed");
    element.setAttribute("aria-describedby", INSTRUCTIONS_ID);
    element.setAttribute("aria-pressed", "false");
  }

  addEventListener("message", (event) => {
    const data = event.data;
    if (event.source !== parent || !data || data.type !== "feedfold:web-feed-highlight" ||
        data.messageToken !== MESSAGE_TOKEN) return;
    setHighlight(typeof data.candidateId === "string" ? data.candidateId : null);
  });
  addEventListener("submit", (event) => event.preventDefault(), true);
  for (const eventName of ["auxclick", "dragstart", "drop"]) {
    addEventListener(eventName, (event) => event.preventDefault(), true);
  }
  addEventListener("pointerdown", (event) => {
    const item = itemFor(event.target);
    pointerStart = item ? { item, x: event.clientX, y: event.clientY, pointerId: event.pointerId } : null;
  }, true);
  addEventListener("pointerup", (event) => {
    const start = pointerStart;
    pointerStart = null;
    const item = itemFor(event.target);
    if (!start || !item || start.item !== item || start.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 8) select(item);
  }, true);
  addEventListener("click", (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.detail === 0) {
      const item = itemFor(event.target);
      if (item) select(item);
    }
  }, true);
  addEventListener("keydown", (event) => {
    const item = itemFor(event.target);
    if (event.key === "Escape") {
      event.preventDefault();
      setHighlight(null);
      parent.postMessage({
        type: "feedfold:web-feed-select",
        messageToken: MESSAGE_TOKEN,
        candidateId: null,
      }, "*");
      return;
    }
    if (!item) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select(item);
      return;
    }
    if (!["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(event.key)) return;
    event.preventDefault();
    const allItems = items();
    const offset = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
    const next = allItems[(allItems.indexOf(item) + offset + allItems.length) % allItems.length];
    next?.focus();
  }, true);
})();`;
}

function sanitizeSnapshot(document: Document, messageToken: string): string {
  document
    .querySelectorAll(
      "script, noscript, iframe, frame, object, embed, template, video, audio, meta[http-equiv], base",
    )
    .forEach((element) => {
      element.remove();
    });
  for (const link of document.querySelectorAll("link")) link.remove();
  for (const element of document.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || name === "srcdoc" || name === "autofocus" || name === "nonce") {
        element.removeAttribute(attribute.name);
      }
    }
    element.removeAttribute("contenteditable");
    element.removeAttribute("formaction");
    element.removeAttribute("background");
    element.removeAttribute("ping");
    element.removeAttribute("xlink:href");
    if (element.matches("a, area")) element.removeAttribute("href");
    if (element.matches("form")) {
      element.removeAttribute("action");
      element.removeAttribute("method");
    }
    if (element.matches("button, input, select, textarea")) {
      element.setAttribute("disabled", "");
      element.setAttribute("tabindex", "-1");
    }
    if (element.hasAttribute("src") && !element.matches("img")) element.removeAttribute("src");
    if (element.hasAttribute("href")) element.removeAttribute("href");
    for (const attributeName of ["src", "href", "poster"] as const) {
      if (element.hasAttribute(attributeName) && !safeSnapshotResource(element, attributeName)) {
        element.removeAttribute(attributeName);
      }
    }
    for (const attributeName of ["srcset", "data-srcset"] as const) {
      element.removeAttribute(attributeName);
    }
    element.removeAttribute("data-src");
    element.removeAttribute("data-lazy-src");
    element.removeAttribute("data-original");
  }

  const head = document.head ?? document.documentElement.prepend(document.createElement("head"));
  const nonce = randomBytes(18).toString("base64url");
  const csp = document.createElement("meta");
  csp.httpEquiv = "Content-Security-Policy";
  csp.content = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "font-src data:",
    "connect-src 'none'",
    "media-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
  ].join("; ");
  head.prepend(csp);
  const pickerStyle = document.createElement("style");
  pickerStyle.textContent = `
    [data-feedfold-candidates] {
      cursor: pointer !important;
      touch-action: pan-x pan-y pinch-zoom;
    }
    [data-feedfold-candidates]:focus-visible {
      outline: 3px solid #2563eb !important;
      outline-offset: 3px !important;
    }
    [data-feedfold-highlighted] {
      outline: 3px solid #2563eb !important;
      outline-offset: 3px !important;
      background-color: color-mix(in srgb, #2563eb 12%, transparent) !important;
    }
  `;
  head.append(pickerStyle);
  const script = document.createElement("script");
  script.setAttribute("nonce", nonce);
  script.textContent = pickerScript(messageToken);
  document.body?.append(script);
  return `<!doctype html>\n${document.documentElement.outerHTML}`;
}

export function createWebFeedSnapshot(
  document: Document,
  candidates: RankedWebFeedCandidate[],
  messageToken: string,
): string {
  markCandidateElements(candidates);
  return sanitizeSnapshot(document, messageToken);
}
