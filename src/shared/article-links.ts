export interface TextLink {
  href: string;
  label: string;
  start: number;
  end: number;
  text: string;
}

export function extractHttpLinks(text: string): TextLink[] {
  const links: TextLink[] = [];
  const pattern = /https?:\/\/[^\s<>"']+/giu;
  let previousMatchEnd = 0;

  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    const rawText = match[0];
    const linkText = rawText.replace(/[.,;!?]+$/u, "");
    const context = text.slice(previousMatchEnd, start).trim();
    const explicitLabel = /(?:^|[.!?]\s+)([\p{L}\p{N}][\p{L}\p{N} _+#&/-]{0,39}):$/u.exec(
      context,
    )?.[1];
    previousMatchEnd = start + rawText.length;

    try {
      const url = new URL(linkText);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      links.push({
        href: url.toString(),
        label: explicitLabel ?? url.hostname.replace(/^www\./, ""),
        start,
        end: start + linkText.length,
        text: linkText,
      });
    } catch {
      // Invalid URLs do not become links.
    }
  }

  return links;
}
