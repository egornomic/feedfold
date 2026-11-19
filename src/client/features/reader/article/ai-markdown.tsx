import Markdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import type { AiGrounding } from "../../../../shared/types.js";
import { CodeBlock } from "./code-block.js";

const components: Components = {
  pre: ({ node: _node, ...props }) => <CodeBlock {...props} />,
  a: ({ node: _node, href, children, ...props }) => {
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
  },
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

export function AiMarkdown({
  text,
  grounding = null,
}: {
  text: string;
  grounding?: AiGrounding | null;
}) {
  let citedText = text;
  if (grounding) {
    const citationsByEndIndex = new Map<number, Set<number>>();
    for (const support of grounding.supports) {
      if (support.endIndex > text.length) continue;
      const citations = citationsByEndIndex.get(support.endIndex) ?? new Set<number>();
      for (const sourceIndex of support.sourceIndices) {
        if (grounding.sources[sourceIndex]) citations.add(sourceIndex);
      }
      if (citations.size > 0) citationsByEndIndex.set(support.endIndex, citations);
    }

    const insertions = [...citationsByEndIndex].sort(([left], [right]) => right - left);
    for (const [endIndex, sourceIndices] of insertions) {
      const citations = [...sourceIndices]
        .sort((left, right) => left - right)
        .map((sourceIndex) => {
          const source = grounding.sources[sourceIndex];
          if (!source) return "";
          const title = source.title
            .replaceAll("\\", "\\\\")
            .replaceAll('"', '\\"')
            .replaceAll(/\s+/gu, " ");
          return `[${sourceIndex + 1}](${source.uri} "${title}")`;
        })
        .join("");
      citedText = `${citedText.slice(0, endIndex)} ${citations}${citedText.slice(endIndex)}`;
    }
  }
  return (
    <>
      <Markdown
        disallowedElements={["img"]}
        components={components}
        remarkPlugins={[
          [remarkGfm, { singleTilde: false }],
          [remarkMath, { singleDollarTextMath: false }],
        ]}
        rehypePlugins={[[rehypeKatex, { errorColor: "currentColor" }]]}
        skipHtml
        urlTransform={(value) => {
          if (value.startsWith("#")) return value;
          try {
            const url = new URL(value);
            return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
          } catch {
            return null;
          }
        }}
      >
        {citedText.replace(/^([ \t]{0,3})•(?=[ \t]|$)/gmu, "$1-")}
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
