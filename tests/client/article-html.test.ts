import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { ArticleHtml } from "../../src/client/features/reader/article/article-html.js";

describe("article HTML", () => {
  it("keeps code intact and updates copy controls when the reader changes content", async () => {
    const dom = new JSDOM('<div id="app"></div>');
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const previousActEnvironment = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: dom.window.document,
    });
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
    const container = dom.window.document.getElementById("app");
    if (!container) throw new Error("Article fixture is incomplete");
    const root = createRoot(container);
    try {
      const html =
        "<p>Inline <code>value</code></p><pre><code>\tconst value = &quot;&lt;tag&gt;&quot;;\n</code></pre><pre>second block</pre>";
      await act(async () => root.render(createElement(ArticleHtml, { sanitizedHtml: html })));
      expect(container.querySelectorAll('button[aria-label="Copy code"]')).toHaveLength(2);
      expect(container.querySelector("pre")?.textContent).toBe('\tconst value = "<tag>";\n');
      expect(container.querySelector("p code")?.textContent).toBe("value");
      await act(async () =>
        root.render(createElement(ArticleHtml, { sanitizedHtml: "<pre>replacement</pre>" })),
      );
      expect(container.querySelectorAll('button[aria-label="Copy code"]')).toHaveLength(1);
      expect(container.querySelector("pre")?.textContent).toBe("replacement");
      await act(async () =>
        root.render(createElement(ArticleHtml, { sanitizedHtml: "<p>Prose only</p>" })),
      );
      expect(container.querySelectorAll("button")).toHaveLength(0);
      expect(container.textContent).toBe("Prose only");
    } finally {
      await act(async () => root.unmount());
      Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
      Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousActEnvironment);
      dom.window.close();
    }
  });

  it("opens article images in a keyboard-accessible lightbox", async () => {
    const dom = new JSDOM('<div id="app"></div>', { url: "https://feedfold.test/" });
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const previousActEnvironment = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    let articleEscapeCount = 0;
    let articleNavigationCount = 0;
    const handleArticleShortcuts = (event: KeyboardEvent) => {
      if (event.key === "Escape") articleEscapeCount += 1;
      if (["arrowleft", "arrowright", "j", "k"].includes(event.key.toLowerCase())) {
        articleNavigationCount += 1;
      }
    };
    Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: dom.window.document,
    });
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
    dom.window.addEventListener("keydown", handleArticleShortcuts);
    Object.defineProperty(dom.window.HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.setAttribute("open", "");
      },
    });
    Object.defineProperty(dom.window.HTMLDialogElement.prototype, "close", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.removeAttribute("open");
        this.dispatchEvent(new dom.window.Event("close"));
      },
    });
    Object.defineProperty(dom.window, "requestAnimationFrame", {
      configurable: true,
      value(callback: FrameRequestCallback) {
        callback(0);
        return 1;
      },
    });

    const container = dom.window.document.querySelector<HTMLElement>("#app");
    if (!container) throw new Error("Article fixture is incomplete");
    const root = createRoot(container);
    const html = `
      <figure>
        <img src="https://images.test/diagram.png" alt="Detailed diagram">
        <figcaption>Small labels</figcaption>
      </figure>
      <a href="https://example.test/source"><img src="https://images.test/chart.png" alt="Chart"></a>
      <img src="https://images.test/tracker.gif" alt="" width="1" height="1">
    `;

    try {
      await act(async () => root.render(createElement(ArticleHtml, { sanitizedHtml: html })));

      const images = container.querySelectorAll<HTMLImageElement>(".article-content img");
      expect(images).toHaveLength(3);
      expect(container.querySelectorAll("[data-image-lightbox-trigger]")).toHaveLength(3);
      expect(images[0]?.tabIndex).toBe(0);
      expect(images[0]?.getAttribute("role")).toBe("button");
      expect(images[0]?.getAttribute("aria-label")).toContain("Detailed diagram");
      expect(images[2]?.hasAttribute("data-image-lightbox-trigger")).toBe(false);
      expect(images[2]?.getAttribute("role")).toBeNull();

      await act(async () => {
        images[0]?.dispatchEvent(
          new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });

      const dialog = container.querySelector<HTMLDialogElement>("dialog.image-lightbox");
      const pressViewerKey = (key: string) =>
        act(async () => {
          dialog?.dispatchEvent(
            new dom.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
          );
        });
      expect(dialog?.hasAttribute("open")).toBe(true);
      expect(dialog?.querySelector("img")?.alt).toBe("Detailed diagram");
      expect(dialog?.querySelector<HTMLImageElement>(".image-lightbox-stage img")?.src).toBe(
        "https://images.test/diagram.png",
      );
      expect(container.querySelectorAll<HTMLImageElement>(".article-content img")[0]).toBe(
        images[0],
      );
      expect(images[0]?.getAttribute("role")).toBe("button");
      const stage = dialog?.querySelector<HTMLDivElement>(".image-lightbox-stage");
      const viewerImage = stage?.querySelector<HTMLImageElement>("img");
      if (!stage || !viewerImage) throw new Error("Lightbox image is missing");
      Object.defineProperties(stage, {
        clientWidth: { configurable: true, value: 1000 },
        clientHeight: { configurable: true, value: 800 },
      });
      Object.defineProperties(viewerImage, {
        naturalWidth: { configurable: true, value: 800 },
        naturalHeight: { configurable: true, value: 600 },
        getBoundingClientRect: {
          value: () => {
            const width = Number.parseFloat(viewerImage.style.width) || 800;
            const height = Number.parseFloat(viewerImage.style.height) || 600;
            return {
              width,
              height,
              left: Math.max(0, (stage.clientWidth - width) / 2) - stage.scrollLeft,
              top: Math.max(0, (stage.clientHeight - height) / 2) - stage.scrollTop,
            };
          },
        },
      });
      await act(async () => {
        viewerImage.dispatchEvent(new dom.window.Event("load", { bubbles: true }));
      });
      const scrollViewer = async (deltaY: number, ctrlKey = false) => {
        let dispatched = true;
        await act(async () => {
          const wheel = new dom.window.WheelEvent("wheel", {
            deltaY,
            ctrlKey,
            bubbles: true,
            cancelable: true,
          });
          dispatched = stage?.dispatchEvent(wheel) ?? true;
        });
        return dispatched;
      };
      expect(await scrollViewer(-100)).toBe(false);
      expect(viewerImage.style.width).toBe("840px");
      expect(await scrollViewer(-100)).toBe(false);
      expect(Number.parseFloat(viewerImage.style.width)).toBeCloseTo(880);
      expect(await scrollViewer(100)).toBe(false);
      expect(viewerImage.style.width).toBe("840px");
      await pressViewerKey("0");
      expect(viewerImage.style.width).toBe("");
      await pressViewerKey("+");
      expect(viewerImage.style.width).toBe("840px");
      await pressViewerKey("-");
      expect(viewerImage.style.width).toBe("800px");
      expect(await scrollViewer(100, true)).toBe(false);
      expect(viewerImage.style.width).toBe("760px");
      const touchViewer = async (
        type: string,
        distance: number | null,
        midpoint = { x: 400, y: 300 },
      ) => {
        const touches =
          distance === null
            ? []
            : [
                { clientX: midpoint.x - distance / 2, clientY: midpoint.y },
                { clientX: midpoint.x + distance / 2, clientY: midpoint.y },
              ];
        const event = new dom.window.TouchEvent(type, {
          touches: touches as Touch[],
          bubbles: true,
          cancelable: true,
        });
        await act(async () => stage.dispatchEvent(event));
        return event.defaultPrevented;
      };
      await pressViewerKey("0");
      expect(await touchViewer("touchstart", 100)).toBe(true);
      expect(await touchViewer("touchmove", 200)).toBe(true);
      expect(viewerImage.style.width).toBe("1600px");
      const panStart = { x: stage.scrollLeft, y: stage.scrollTop };
      await touchViewer("touchmove", 200, { x: 360, y: 280 });
      expect(viewerImage.style.width).toBe("1600px");
      expect(stage.scrollLeft).toBeCloseTo(panStart.x + 40);
      expect(stage.scrollTop).toBeCloseTo(panStart.y + 20);
      await touchViewer("touchmove", 50);
      expect(viewerImage.style.width).toBe("400px");
      await touchViewer("touchmove", 500);
      expect(viewerImage.style.width).toBe("3200px");
      const clampedPanStart = { x: stage.scrollLeft, y: stage.scrollTop };
      await touchViewer("touchmove", 600, { x: 370, y: 275 });
      expect(viewerImage.style.width).toBe("3200px");
      expect(stage.scrollLeft).toBeCloseTo(clampedPanStart.x + 30);
      expect(stage.scrollTop).toBeCloseTo(clampedPanStart.y + 25);
      expect(await touchViewer("touchend", null)).toBe(true);
      await pressViewerKey("0");
      expect(viewerImage.style.width).toBe("");
      await touchViewer("touchstart", 100);
      await touchViewer("touchcancel", null);
      await act(async () => viewerImage.click());
      expect(dialog?.open).toBe(true);

      await pressViewerKey("ArrowRight");
      expect(dialog?.querySelector("img")?.alt).toBe("Chart");
      expect(dialog?.querySelector("img")?.style.width).toBe("");
      await pressViewerKey("k");
      expect(dialog?.querySelector("img")?.alt).toBe("Detailed diagram");
      await pressViewerKey("j");
      expect(dialog?.querySelector("img")?.alt).toBe("Chart");
      expect(articleNavigationCount).toBe(0);

      await act(async () => {
        dialog
          ?.querySelector<HTMLImageElement>(".image-lightbox-stage img")
          ?.dispatchEvent(new dom.window.Event("error", { bubbles: true }));
      });
      expect(dialog?.textContent).toContain("Image unavailable");
      expect(dialog?.textContent).toContain("Try the original image");

      dom.window.document.documentElement.dataset.inputModality = "keyboard";
      await pressViewerKey("Escape");
      expect(container.querySelector("dialog.image-lightbox")).toBeNull();
      expect(articleEscapeCount).toBe(0);
      expect(dom.window.document.activeElement).toBe(images[0]);

      for (const closeWith of ["button", "background"]) {
        await act(async () => images[1]?.click());
        const reopened = container.querySelector<HTMLDialogElement>("dialog.image-lightbox");
        expect(reopened?.querySelector("img")?.alt).toBe("Chart");
        await act(async () => {
          reopened
            ?.querySelector<HTMLElement>(
              closeWith === "button"
                ? '[aria-label="Close image viewer"]'
                : ".image-lightbox-stage",
            )
            ?.click();
        });
        expect(container.querySelector("dialog.image-lightbox")).toBeNull();
        expect(dom.window.document.activeElement).toBe(images[1]?.closest("a"));
      }

      await act(async () => {
        images[2]?.dispatchEvent(
          new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      expect(container.querySelector("dialog.image-lightbox")).toBeNull();
    } finally {
      dom.window.removeEventListener("keydown", handleArticleShortcuts);
      await act(async () => root.unmount());
      Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
      Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousActEnvironment);
      dom.window.close();
    }
  });

  it("keeps selected text visible when an article action renders", async () => {
    const dom = new JSDOM('<div id="app"></div>');
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const previousActEnvironment = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: dom.window.document,
    });
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

    const container = dom.window.document.querySelector<HTMLElement>("#app");
    if (!container) throw new Error("Article fixture is incomplete");
    const root = createRoot(container);
    const html = "<p>Readers should retain this selection.</p>";

    try {
      await act(async () => root.render(createElement(ArticleHtml, { sanitizedHtml: html })));

      const textNode = container.querySelector("p")?.firstChild;
      if (!textNode) throw new Error("Article fixture is incomplete");
      const range = dom.window.document.createRange();
      range.setStart(textNode, 8);
      range.setEnd(textNode, 21);
      const selection = dom.window.document.getSelection();
      selection?.addRange(range);
      expect(selection?.toString()).toBe("should retain");

      await act(async () => root.render(createElement(ArticleHtml, { sanitizedHtml: html })));

      expect(selection?.toString()).toBe("should retain");
      expect(selection?.isCollapsed).toBe(false);
    } finally {
      await act(async () => root.unmount());
      Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
      Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousActEnvironment);
      dom.window.close();
    }
  });
});
