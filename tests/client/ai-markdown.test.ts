import { JSDOM } from "jsdom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AiMarkdown } from "../../src/client/features/reader/article/ai-markdown.js";
import type { AiGrounding } from "../../src/shared/types.js";

function renderMarkdown(text: string, grounding?: AiGrounding): DocumentFragment {
  return JSDOM.fragment(renderToStaticMarkup(createElement(AiMarkdown, { text, grounding })));
}

describe("AI Markdown", () => {
  it("offers copying for fenced code while preserving whitespace and inline code", () => {
    const fragment = renderMarkdown('Inline `value`\n\n```js\n\tconst value = "<tag>";\n```');
    expect(fragment.querySelectorAll('button[aria-label="Copy code"]')).toHaveLength(1);
    expect(fragment.querySelector("pre")?.textContent).toBe('\tconst value = "<tag>";\n');
    expect(fragment.querySelector("p code")?.textContent).toBe("value");
  });

  it("renders formatted LLM output without changing its block order", () => {
    const fragment = renderMarkdown(`Here is the result:

• **Core technology:** Uses \`pread\`.
• **Value:** Runs locally.

Closing note.`);

    expect([...fragment.children].map((element) => element.tagName)).toEqual(["P", "UL", "P"]);
    expect(fragment.querySelectorAll("li")).toHaveLength(2);
    expect(fragment.querySelector("li strong")?.textContent).toBe("Core technology:");
    expect(fragment.querySelector("li code")?.textContent).toBe("pread");
    expect(fragment.textContent).not.toContain("**");
  });

  it("supports headings and GitHub-flavored result structures", () => {
    const fragment = renderMarkdown(`# Recommendation

~~Discarded~~ Current

| Model | Status |
| --- | --- |
| Local | Ready |

- [x] Verified`);

    expect(fragment.querySelector("h4")?.textContent).toBe("Recommendation");
    expect(fragment.querySelector("del")?.textContent).toBe("Discarded");
    expect(fragment.querySelector("table")?.textContent).toContain("LocalReady");
    expect(fragment.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true);
  });

  it("keeps generated HTML, unsafe links, and remote images inert", () => {
    const fragment = renderMarkdown(`
[Safe](https://example.test/path)
[Unsafe](javascript:alert(1))
![Tracking pixel](https://tracker.example.test/pixel.png)
<strong>Raw HTML</strong>
`);
    const links = [...fragment.querySelectorAll("a")];

    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toBe("https://example.test/path");
    expect(links[0]?.getAttribute("target")).toBe("_blank");
    expect(fragment.querySelector("img")).toBeNull();
    expect(fragment.querySelector("strong")).toBeNull();
  });

  it("links grounded claims to their sources and displays Google Search Suggestions", () => {
    const text = "The product launched in July 2026.";
    const fragment = renderMarkdown(text, {
      sources: [
        {
          uri: "https://search.example.test/release",
          title: "Release announcement",
        },
      ],
      supports: [{ startIndex: 0, endIndex: text.length, sourceIndices: [0] }],
      searchSuggestionsHtml: '<div class="google-search">Search suggestions</div>',
    });
    const citation = fragment.querySelector("p a");
    const suggestions = fragment.querySelector(".article-summary-search-suggestions");

    expect(citation?.textContent).toContain("1");
    expect(citation?.getAttribute("href")).toBe("https://search.example.test/release");
    expect(citation?.getAttribute("title")).toBe("Release announcement");
    expect(suggestions?.querySelector(".google-search")?.textContent).toBe("Search suggestions");
    expect(suggestions?.getAttribute("aria-label")).toBe("Google Search suggestions");
  });

  it("renders grounded citations without Google-specific attribution", () => {
    const text = "The product launched in July 2026.";
    const fragment = renderMarkdown(text, {
      sources: [
        {
          uri: "https://source.example.test/release",
          title: "Release announcement",
        },
      ],
      supports: [{ startIndex: 0, endIndex: text.length, sourceIndices: [0] }],
      searchSuggestionsHtml: null,
    });

    expect(fragment.querySelector("p a")?.getAttribute("href")).toBe(
      "https://source.example.test/release",
    );
    expect(fragment.querySelector(".article-summary-search-suggestions")).toBeNull();
  });
});
