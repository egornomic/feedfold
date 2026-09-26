import { Parser } from "htmlparser2";

const textBreaks = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "td",
  "th",
  "tr",
  "ul",
]);
const nonTextTags = new Set(["script", "style", "template"]);

export function normalizeSearchText(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

export function articleSearchText(html: string | null): string {
  const text: string[] = [];
  let ignoredDepth = 0;
  const parser = new Parser({
    onopentag(name) {
      if (ignoredDepth || nonTextTags.has(name)) ignoredDepth++;
      else if (textBreaks.has(name)) text.push(" ");
    },
    ontext(value) {
      if (!ignoredDepth) text.push(value);
    },
    onclosetag(name) {
      if (ignoredDepth) ignoredDepth--;
      else if (textBreaks.has(name)) text.push(" ");
    },
  });
  parser.end(html ?? "");
  return normalizeSearchText(text.join(""));
}
