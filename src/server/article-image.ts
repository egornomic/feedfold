import { Buffer } from "node:buffer";
import parseSrcset from "parse-srcset";
import sanitizeHtml from "sanitize-html";
import { thumbnailWidth } from "../shared/thumbnail.js";

const blockedBadgeHosts = new Set(["img.shields.io", "api.star-history.com"]);

function hasBadgePathToken(pathname: string): boolean {
  return pathname.split("/").some((segment) => /(?:^|[-_.])badge(?:$|[-_.])/i.test(segment));
}

function isDirectBadgeUrl(url: URL): boolean {
  if (blockedBadgeHosts.has(url.hostname)) return true;
  return hasBadgePathToken(url.pathname);
}

function isBlockedBadgeUrl(url: URL): boolean {
  if (isDirectBadgeUrl(url)) return true;
  if (url.hostname !== "camo.githubusercontent.com") return false;

  const encodedTarget = url.pathname.split("/").at(-1);
  if (!encodedTarget || encodedTarget.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(encodedTarget)) {
    return false;
  }
  try {
    return isDirectBadgeUrl(new URL(Buffer.from(encodedTarget, "hex").toString("utf8")));
  } catch {
    return false;
  }
}

function safeHttpUrl(value: string, baseUrl?: string): string | null {
  try {
    const parsed = new URL(value, baseUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (isBlockedBadgeUrl(parsed)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function imageThumbnailUrl(
  attributes: Record<string, string | undefined>,
  baseUrl?: string,
): string | null {
  const original = attributes.src ? safeHttpUrl(attributes.src, baseUrl) : null;
  if (attributes.src && !original) return null;
  const width = thumbnailWidth(Number(attributes.width), Number(attributes.height));
  const candidates = parseSrcset(attributes.srcset ?? "")
    .map((candidate) => ({ ...candidate, url: safeHttpUrl(candidate.url, baseUrl) }))
    .filter((candidate) => candidate.url !== null)
    .sort((left, right) => (left.w ?? left.d ?? 1) - (right.w ?? right.d ?? 1));
  const suitable = candidates.find((candidate) =>
    candidate.w ? candidate.w >= width : (candidate.d ?? 1) >= 2,
  );
  return suitable?.url ?? original ?? candidates.at(-1)?.url ?? null;
}

export function firstSafeImageUrl(html: string | null, baseUrl?: string): string | null {
  if (!html) return null;
  let imageUrl: string | null = null;
  sanitizeHtml(html, {
    allowedTags: ["img"],
    allowedAttributes: { img: ["src", "srcset", "width", "height"] },
    transformTags: {
      img: (_tagName, attributes) => {
        if (!imageUrl) imageUrl = imageThumbnailUrl(attributes, baseUrl);
        return { tagName: "img", attribs: {} };
      },
    },
  });
  return imageUrl;
}
