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

    try {
      const url = new URL(linkText);
      if (url.protocol === "http:" || url.protocol === "https:") {
        links.push({
          href: url.toString(),
          label: explicitLabel ?? url.hostname.replace(/^www\./, ""),
          start,
          end: start + linkText.length,
          text: linkText,
        });
      }
    } catch {
      // Invalid URLs do not become links.
    }
    previousMatchEnd = start + rawText.length;
  }

  return links;
}
