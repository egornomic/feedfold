import type { JSX } from "react";
import Markdown, { type Components, type ExtraProps, type UrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AiGrounding } from "../shared/types.js";
import { CodeBlock } from "./code-block.js";

const allowedElements = [
  "a",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "input",
  "li",
  "ol",
  "p",
  "pre",
  "section",
  "strong",
  "sup",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
] as const;

const safeUrl: UrlTransform = (value) => {
  if (value.startsWith("#")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
};

function MarkdownLink({
  node: _node,
  href,
  children,
  ...props
}: JSX.IntrinsicElements["a"] & ExtraProps) {
  if (!href) return children;
  if (href.startsWith("#")) {
    return (
      <a {...props} href={href}>
        {children}
      </a>
    );
  }
  return (
    <a {...props} href={href} target="_blank" rel="noreferrer">
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

const components: Components = {
  pre: ({ node: _node, ...props }) => <CodeBlock {...props} />,
  a: MarkdownLink,
  h1: ({ node: _node, ...props }) => <h4 {...props} />,
  h2: ({ node: _node, ...props }) => <h5 {...props} />,
  h3: ({ node: _node, ...props }) => <h6 {...props} />,
  h4: ({ node: _node, ...props }) => <h6 {...props} />,
  h5: ({ node: _node, ...props }) => <h6 {...props} />,
  h6: ({ node: _node, ...props }) => <h6 {...props} />,
  table: ({ node: _node, ...props }) => (
    <div className="article-summary-table-scroll">
      <table {...props} />
    </div>
  ),
};

function normalizeAiMarkdown(text: string): string {
  return text.replace(/^([ \t]{0,3})•(?=[ \t]|$)/gmu, "$1-");
}

function markdownLinkTitle(title: string): string {
  return title.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll(/\s+/gu, " ");
}

function addGroundingCitations(text: string, grounding: AiGrounding): string {
  const citationsByEndIndex = new Map<number, Set<number>>();
  for (const support of grounding.supports) {
    if (support.endIndex > text.length) continue;
    const citations = citationsByEndIndex.get(support.endIndex) ?? new Set<number>();
    for (const sourceIndex of support.sourceIndices) {
      if (grounding.sources[sourceIndex]) citations.add(sourceIndex);
    }
    if (citations.size > 0) citationsByEndIndex.set(support.endIndex, citations);
  }

  let citedText = text;
  const insertions = [...citationsByEndIndex].sort(([left], [right]) => right - left);
  for (const [endIndex, sourceIndices] of insertions) {
    const citations = [...sourceIndices]
      .sort((left, right) => left - right)
      .map((sourceIndex) => {
        const source = grounding.sources[sourceIndex];
        if (!source) return "";
        return `[${sourceIndex + 1}](${source.uri} "${markdownLinkTitle(source.title)}")`;
      })
      .join("");
    citedText = `${citedText.slice(0, endIndex)} ${citations}${citedText.slice(endIndex)}`;
  }
  return citedText;
}

export function AiMarkdown({
  text,
  grounding = null,
}: {
  text: string;
  grounding?: AiGrounding | null;
}) {
  const markdown = grounding ? addGroundingCitations(text, grounding) : text;
  return (
    <>
      <Markdown
        allowedElements={allowedElements}
        components={components}
        remarkPlugins={[[remarkGfm, { singleTilde: false }]]}
        skipHtml
        urlTransform={safeUrl}
      >
        {normalizeAiMarkdown(markdown)}
      </Markdown>
      {grounding?.searchSuggestionsHtml ? (
        <section
          className="article-summary-search-suggestions"
          aria-label="Google Search suggestions"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: Google requires its provider-generated Search Suggestions HTML to be displayed unchanged.
          dangerouslySetInnerHTML={{ __html: grounding.searchSuggestionsHtml }}
        />
      ) : null}
    </>
  );
}
