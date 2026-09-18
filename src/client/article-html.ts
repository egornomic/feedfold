import {
  createElement,
  Fragment,
  memo,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { CopyCodeButton } from "./code-block.js";
import {
  ImageLightbox,
  type ImageLightboxItem,
  type ImageLightboxState,
} from "./image-lightbox.js";

const TRACKING_PIXEL_SIZE = 1;

function eventElement(target: EventTarget | null): Element | null {
  return target && typeof (target as Element).closest === "function" ? (target as Element) : null;
}

function imageLabel(image: HTMLImageElement): string {
  return (
    image.alt.trim() ||
    image.closest("figure")?.querySelector("figcaption")?.textContent?.trim() ||
    image.title.trim()
  );
}

function isPreviewableImage(image: HTMLImageElement): boolean {
  const declaredWidth = Number.parseFloat(image.getAttribute("width") ?? "");
  const declaredHeight = Number.parseFloat(image.getAttribute("height") ?? "");
  const isDeclaredTrackingPixel =
    declaredWidth > 0 &&
    declaredHeight > 0 &&
    declaredWidth <= TRACKING_PIXEL_SIZE &&
    declaredHeight <= TRACKING_PIXEL_SIZE;
  const isLoadedTrackingPixel =
    image.complete &&
    image.naturalWidth > 0 &&
    image.naturalHeight > 0 &&
    image.naturalWidth <= TRACKING_PIXEL_SIZE &&
    image.naturalHeight <= TRACKING_PIXEL_SIZE;
  return !isDeclaredTrackingPixel && !isLoadedTrackingPixel;
}

function previewableImages(container: HTMLElement): HTMLImageElement[] {
  return Array.from(container.querySelectorAll<HTMLImageElement>("img[src]")).filter(
    isPreviewableImage,
  );
}

function imageItem(image: HTMLImageElement): ImageLightboxItem {
  return {
    src: image.currentSrc || image.src,
    alt: imageLabel(image),
  };
}

function imageTrigger(image: HTMLImageElement, container: HTMLElement): HTMLElement {
  const link = image.closest<HTMLAnchorElement>("a[href]");
  return link && container.contains(link) ? link : image;
}

// Replacing unchanged inner HTML collapses any native text range inside it.
export const ArticleHtml = memo(function ArticleHtml({
  sanitizedHtml,
  className = "article-content",
}: {
  sanitizedHtml: string;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [lightbox, setLightbox] = useState<ImageLightboxState | null>(null);
  const [codeBlocks, setCodeBlocks] = useState<
    Array<{ block: HTMLPreElement; wrapper: HTMLDivElement }>
  >([]);

  useLayoutEffect(() => {
    if (!sanitizedHtml.includes("<pre")) {
      setCodeBlocks([]);
      return;
    }
    const blocks = Array.from(containerRef.current?.querySelectorAll("pre") ?? []);
    const targets = blocks.map((block) => {
      const wrapper = document.createElement("div");
      wrapper.className = "article-code-block";
      block.before(wrapper);
      wrapper.append(block);
      return { block, wrapper };
    });
    setCodeBlocks(targets);
    return () => {
      for (const { block, wrapper } of targets) wrapper.replaceWith(block);
    };
  }, [sanitizedHtml]);

  useEffect(() => {
    if (!sanitizedHtml.includes("<img")) return;
    const container = containerRef.current;
    if (!container) return;
    const cleanups: Array<() => void> = [];
    for (const image of container.querySelectorAll<HTMLImageElement>("img[src]")) {
      const trigger = imageTrigger(image, container);
      const label = `Enlarge image: ${imageLabel(image) || "Article image"}`;
      const originalTabIndex = image.getAttribute("tabindex");
      const originalRole = image.getAttribute("role");
      const originalImageLabel = image.getAttribute("aria-label");
      const originalTriggerLabel = trigger.getAttribute("aria-label");
      const updateTrigger = () => {
        if (isPreviewableImage(image)) {
          image.dataset.imageLightboxTrigger = "";
          trigger.dataset.imageLightboxTrigger = "";
          if (trigger === image) {
            image.tabIndex = 0;
            image.setAttribute("role", "button");
            image.setAttribute("aria-label", label);
          } else if (!trigger.getAttribute("aria-label") && !trigger.textContent?.trim()) {
            trigger.setAttribute("aria-label", label);
          }
          return;
        }

        delete image.dataset.imageLightboxTrigger;
        delete trigger.dataset.imageLightboxTrigger;
        if (trigger === image) {
          if (originalTabIndex === null) image.removeAttribute("tabindex");
          else image.setAttribute("tabindex", originalTabIndex);
          if (originalRole === null) image.removeAttribute("role");
          else image.setAttribute("role", originalRole);
          if (originalImageLabel === null) image.removeAttribute("aria-label");
          else image.setAttribute("aria-label", originalImageLabel);
        } else if (originalTriggerLabel === null) {
          trigger.removeAttribute("aria-label");
        } else {
          trigger.setAttribute("aria-label", originalTriggerLabel);
        }
      };
      updateTrigger();
      if (!image.complete) {
        image.addEventListener("load", updateTrigger);
        cleanups.push(() => image.removeEventListener("load", updateTrigger));
      }
    }
    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, [sanitizedHtml]);

  const openImage = useCallback((image: HTMLImageElement) => {
    const container = containerRef.current;
    if (!container) return;
    const imageElements = previewableImages(container);
    const index = imageElements.indexOf(image);
    if (index < 0) return;
    setLightbox({
      images: imageElements.map(imageItem),
      index,
      returnFocus: imageTrigger(image, container),
    });
  }, []);

  const handleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const image = eventElement(event.target)?.closest<HTMLImageElement>(
        "img[data-image-lightbox-trigger]",
      );
      if (!image || !event.currentTarget.contains(image)) return;
      event.preventDefault();
      event.stopPropagation();
      openImage(image);
    },
    [openImage],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const target = eventElement(event.target);
      if (!target) return;
      const image = target.matches("img[data-image-lightbox-trigger]")
        ? (target as HTMLImageElement)
        : target.matches("a[data-image-lightbox-trigger]")
          ? target.querySelector<HTMLImageElement>("img[src]")
          : null;
      if (!image || !event.currentTarget.contains(image)) return;
      event.preventDefault();
      event.stopPropagation();
      openImage(image);
    },
    [openImage],
  );

  const article = useMemo(
    () =>
      createElement("div", {
        ref: containerRef,
        className,
        onClick: handleClick,
        onKeyDown: handleKeyDown,
        dangerouslySetInnerHTML: { __html: sanitizedHtml },
      }),
    [className, handleClick, handleKeyDown, sanitizedHtml],
  );

  return createElement(
    Fragment,
    null,
    article,
    ...codeBlocks.map(({ block, wrapper }, index) =>
      createPortal(
        createElement(CopyCodeButton, { getText: () => block.textContent ?? "" }),
        wrapper,
        String(index),
      ),
    ),
    lightbox
      ? createElement(ImageLightbox, {
          state: lightbox,
          onClose: () => setLightbox(null),
        })
      : null,
  );
});
