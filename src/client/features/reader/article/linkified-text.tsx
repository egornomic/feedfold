import { extractHttpLinks } from "../../../../shared/article-links";

export function LinkifiedText({ text }: { text: string }) {
  const links = extractHttpLinks(text);
  if (links.length === 0) return text;

  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  for (const link of links) {
    if (link.start > cursor) nodes.push(text.slice(cursor, link.start));
    nodes.push(
      <a
        key={`${link.href}-${link.start}`}
        href={link.href}
        target="_blank"
        rel="noreferrer"
        title={link.href}
      >
        {link.text}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>,
    );
    cursor = link.end;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return <>{nodes}</>;
}
