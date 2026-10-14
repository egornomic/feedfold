import { Parser } from "htmlparser2";
import type { Article } from "./types.js";

export const articleSearchColumns = [
  "title",
  "author",
  "summary",
  "feed_text",
  "content_text",
] as const;

export function articleMatchesSearch(
  article: Pick<Article, "title" | "author" | "summary" | "feedContentHtml" | "contentHtml">,
  search: string,
): boolean {
  const values: Record<(typeof articleSearchColumns)[number], string> = {
    title: article.title,
    author: article.author ?? "",
    summary: article.summary,
    feed_text: articleSearchText(article.feedContentHtml),
    content_text: articleSearchText(article.contentHtml),
  };
  // SQLite LIKE folds ASCII case and stops at NUL.
  const fold = (text: string) =>
    (text.split("\0", 1)[0] ?? "").replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  const pattern = fold(normalizeSearchText(search));
  return articleSearchColumns.some((column) => fold(values[column]).includes(pattern));
}

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
