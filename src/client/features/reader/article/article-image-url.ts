import { thumbnailUrl } from "../../../../shared/thumbnail";
import { appUrl } from "../../../api/api";

export function articleImageUrl(value: string): string {
  return value.startsWith("/api/") ? appUrl(value) : value;
}

export function articleThumbnailUrl(value: string): string {
  return articleImageUrl(thumbnailUrl(value));
}

// Start downloading an article's images before it is shown, so they appear with its text.
// Images the article defers until scrolled to stay deferred, as they would when shown.
export function warmArticleImages(html: string | null): void {
  if (!html?.includes("<img")) return;
  const parsed = new DOMParser().parseFromString(html, "text/html");
  for (const source of parsed.querySelectorAll<HTMLImageElement>("img:not([loading='lazy' i])")) {
    const image = new Image();
    image.sizes = source.sizes;
    image.srcset = source.srcset;
    image.src = source.src;
  }
}
