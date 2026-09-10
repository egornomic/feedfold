import { createHash } from "node:crypto";
import { FEED_PREVIEW_ARTICLE_LIMIT } from "../shared/feed-preview.js";
import type {
  FeedPreviewArticle,
  WebFeedCandidate,
  WebFeedConfig,
  WebFeedField,
  WebFeedSelectors,
} from "../shared/types.js";
import type { ParsedArticle } from "./features/shared.js";
import { WebFeedError } from "./web-feed-error.js";

const MAX_MATCHED_ITEMS = 2_000;
const MAX_SUGGESTIONS = 8;
const MAX_SELECTABLE_CANDIDATES = 100;
const MIN_CANDIDATE_SCORE = 28;

const REPEATED_ITEM_TAGS = new Set(["a", "article", "div", "li", "section", "tr"]);
const EXCLUDED_REGION_SELECTOR =
  'nav, header, footer, aside, [role="navigation"], [role="menu"], [aria-hidden="true"], [hidden]';
const EXCLUDED_REGION_NAME = /(?:^|[-_\s])(header|footer|nav|menu|sidebar)(?:$|[-_\s])/i;
const STATE_CLASS_PATTERN =
  /^(?:active|current|disabled|expanded|focus|focused|hidden|hover|open|selected)$/i;

export interface ExtractedWebFeedSelection {
  articles: ParsedArticle[];
  elements: Element[];
}

export interface RankedWebFeedCandidate {
  candidate: WebFeedCandidate;
  elements: Element[];
  articleUrls: string[];
  linkKey: string;
  score: number;
}

function singleLine(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function truncated(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1).trimEnd()}…`;
}

function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function cssString(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\a ")
    .replaceAll("\r", "\\d ")
    .replaceAll("\f", "\\c ");
}

function stableClasses(element: Element): string[] {
  return [...element.classList]
    .filter((name) => name.length <= 80 && !STATE_CLASS_PATTERN.test(name))
    .sort();
}

function normalizedHttpUrl(value: string, baseUrl: string): string | null {
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function imageUrl(element: Element | null, baseUrl: string): string | null {
  if (!element) return null;
  const direct =
    element.getAttribute("src") ??
    element.getAttribute("data-src") ??
    element.getAttribute("data-lazy-src") ??
    element.getAttribute("data-original") ??
    element.getAttribute("content");
  if (direct) return normalizedHttpUrl(direct, baseUrl);
  const srcset = element.getAttribute("srcset") ?? element.getAttribute("data-srcset");
  const first = srcset?.split(",", 1)[0]?.trim().split(/\s+/, 1)[0];
  return first ? normalizedHttpUrl(first, baseUrl) : null;
}

function parsedDate(element: Element | null): string | null {
  if (!element) return null;
  const value = singleLine(
    element.getAttribute("datetime") ??
      element.getAttribute("content") ??
      element.getAttribute("title") ??
      element.textContent,
  );
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function selectedElement(item: Element, selector: string | null): Element | null {
  if (!selector) return null;
  if (selector === ":scope") return item;
  return item.querySelector(selector);
}

function fieldSelector(items: Element[], patterns: string[]): string | null {
  let best: { selector: string; matches: number } | null = null;
  for (const selector of patterns) {
    let matches = 0;
    for (const item of items) {
      try {
        if (selectedElement(item, selector)) matches += 1;
      } catch {
        matches = 0;
        break;
      }
    }
    if (matches === 0) continue;
    if (!best || matches > best.matches) best = { selector, matches };
    if (matches === items.length) break;
  }
  return best?.selector ?? null;
}

function selectorsFor(items: Element[], itemSelector: string): WebFeedSelectors | null {
  const itemIsLink = items.every((item) => item.matches("a[href]"));
  const link = itemIsLink
    ? ":scope"
    : fieldSelector(items, [
        'a[itemprop~="url"][href]',
        'a[rel~="bookmark"][href]',
        "h1 a[href], h2 a[href], h3 a[href], h4 a[href]",
        'a[class*="title" i][href], a[class*="headline" i][href]',
        "a[href]",
      ]);
  if (!link) return null;
  const title =
    fieldSelector(items, [
      '[itemprop~="headline"]',
      '[itemprop~="name"]',
      "h1, h2, h3, h4, h5, h6",
      '[class*="headline" i]',
      '[class*="title" i]',
      '[class*="name" i]',
      link,
    ]) ?? link;
  return {
    item: itemSelector,
    title,
    link,
    date: fieldSelector(items, [
      "time[datetime]",
      '[itemprop~="datePublished"]',
      '[itemprop~="dateCreated"]',
      "time",
      '[class*="date" i]',
      '[class*="time" i]',
    ]),
    author: fieldSelector(items, [
      '[itemprop~="author"]',
      '[rel~="author"]',
      '[class*="byline" i]',
      '[class*="author" i]',
    ]),
    summary: fieldSelector(items, [
      '[itemprop~="description"]',
      '[class*="summary" i]',
      '[class*="excerpt" i]',
      '[class*="description" i]',
      "p",
    ]),
    image: fieldSelector(items, [
      '[itemprop~="image"] img',
      'img[itemprop~="image"]',
      "picture img",
      "img",
    ]),
  };
}

function fallbackTitle(url: string): string {
  const parsed = new URL(url);
  const lastSegment = parsed.pathname.split("/").filter(Boolean).at(-1);
  if (!lastSegment) return parsed.hostname;
  try {
    return singleLine(decodeURIComponent(lastSegment).replaceAll(/[-_]+/g, " ")) || parsed.hostname;
  } catch {
    return singleLine(lastSegment.replaceAll(/[-_]+/g, " ")) || parsed.hostname;
  }
}

function mergeDuplicate(existing: ParsedArticle, incoming: ParsedArticle): void {
  if (!existing.title && incoming.title) existing.title = incoming.title;
  if (!existing.author && incoming.author) existing.author = incoming.author;
  if (!existing.publishedAt && incoming.publishedAt) existing.publishedAt = incoming.publishedAt;
  if (!existing.summary && incoming.summary) {
    existing.summary = incoming.summary;
    existing.feedContentHtml = incoming.feedContentHtml;
  }
  if (!existing.imageUrl && incoming.imageUrl) existing.imageUrl = incoming.imageUrl;
}

export function extractWebFeedSelection(
  document: Document,
  pageUrl: string,
  selectors: WebFeedSelectors,
): ExtractedWebFeedSelection {
  let items: Element[];
  try {
    items = [...document.querySelectorAll(selectors.item)];
  } catch {
    throw new WebFeedError(
      "This page has changed, so the saved selection is no longer valid. Edit the page selection to repair the feed.",
      "selection_broken",
    );
  }
  if (items.length > MAX_MATCHED_ITEMS) {
    throw new WebFeedError(
      "This selection matches too many page elements. Choose a smaller entry group.",
      "unsupported_content",
    );
  }
  const articlesByUrl = new Map<string, ParsedArticle>();
  for (const item of items) {
    let linkElement: Element | null;
    let titleElement: Element | null;
    let dateElement: Element | null;
    let authorElement: Element | null;
    let summaryElement: Element | null;
    let imageElement: Element | null;
    try {
      linkElement = selectedElement(item, selectors.link);
      titleElement = selectedElement(item, selectors.title);
      dateElement = selectedElement(item, selectors.date);
      authorElement = selectedElement(item, selectors.author);
      summaryElement = selectedElement(item, selectors.summary);
      imageElement = selectedElement(item, selectors.image);
    } catch {
      throw new WebFeedError(
        "This page has changed, so the saved selection is no longer valid. Edit the page selection to repair the feed.",
        "selection_broken",
      );
    }
    const rawLink = linkElement?.getAttribute("href") ?? linkElement?.getAttribute("data-href");
    const url = rawLink ? normalizedHttpUrl(rawLink, pageUrl) : null;
    if (!url) continue;
    const linkText = singleLine(linkElement?.textContent);
    const title = truncated(
      singleLine(titleElement?.textContent) || linkText || fallbackTitle(url),
      500,
    );
    const author = truncated(singleLine(authorElement?.textContent), 200) || null;
    const summary = truncated(singleLine(summaryElement?.textContent), 4_000);
    const article: ParsedArticle = {
      externalId: url,
      title,
      url,
      author,
      publishedAt: parsedDate(dateElement),
      summary,
      imageUrl: imageUrl(imageElement, pageUrl),
      feedContentHtml: summary ? `<p>${htmlEscape(summary)}</p>` : null,
    };
    const existing = articlesByUrl.get(url);
    if (existing) mergeDuplicate(existing, article);
    else articlesByUrl.set(url, article);
  }
  return { articles: [...articlesByUrl.values()], elements: items };
}

function previewArticle(article: ParsedArticle): FeedPreviewArticle {
  return {
    title: article.title,
    url: article.url,
    author: article.author,
    publishedAt: article.publishedAt,
    summary: article.summary,
    imageUrl: article.imageUrl,
  };
}

function availableFields(articles: ParsedArticle[]): WebFeedField[] {
  const fields: WebFeedField[] = ["link"];
  if (articles.some((article) => article.title.length > 0)) fields.unshift("title");
  if (articles.some((article) => article.publishedAt)) fields.push("date");
  if (articles.some((article) => article.author)) fields.push("author");
  if (articles.some((article) => article.summary)) fields.push("summary");
  if (articles.some((article) => article.imageUrl)) fields.push("image");
  return fields;
}

function candidateId(config: WebFeedConfig): string {
  const hash = createHash("sha256").update(JSON.stringify(config)).digest("hex").slice(0, 16);
  return `web-${hash}`;
}

function elementSegment(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const id = element.getAttribute("id");
  if (id) return `${tag}[id="${cssString(id)}"]`;
  const classes = stableClasses(element).slice(0, 3);
  const classPart = classes.map((name) => `[class~="${cssString(name)}"]`).join("");
  const base = `${tag}${classPart}`;
  const parent = element.parentElement;
  if (!parent) return base;
  const peers = [...parent.children].filter((peer) => {
    if (peer.tagName !== element.tagName) return false;
    return classes.every((name) => peer.classList.contains(name));
  });
  if (peers.length <= 1) return base;
  const sameTag = [...parent.children].filter((peer) => peer.tagName === element.tagName);
  return `${base}:nth-of-type(${sameTag.indexOf(element) + 1})`;
}

function uniqueSelector(element: Element, document: Document): string {
  const id = element.getAttribute("id");
  if (id) {
    const selector = `[id="${cssString(id)}"]`;
    if (document.querySelectorAll(selector).length === 1) return selector;
  }
  const path: string[] = [];
  let current: Element | null = element;
  while (current && current.tagName.toLowerCase() !== "html") {
    path.unshift(elementSegment(current));
    const selector = path.join(" > ");
    if (document.querySelectorAll(selector).length === 1) return selector;
    current = current.parentElement;
  }
  return `html > ${path.join(" > ")}`;
}

function sharedClasses(elements: Element[]): string[] {
  const [first, ...remaining] = elements;
  if (!first) return [];
  const rest = remaining.map((element) => new Set(stableClasses(element)));
  return stableClasses(first).filter((name) => rest.every((classes) => classes.has(name)));
}

function itemSelector(parent: Element, elements: Element[], document: Document): string {
  const tag = elements[0]?.tagName.toLowerCase() ?? "div";
  const classes = sharedClasses(elements).slice(0, 4);
  const classPart = classes.map((name) => `[class~="${cssString(name)}"]`).join("");
  return `${uniqueSelector(parent, document)} > ${tag}${classPart}`;
}

function isExcludedRegion(element: Element): boolean {
  let current: Element | null = element;
  while (current) {
    if (current.matches(EXCLUDED_REGION_SELECTOR)) return true;
    const name = `${current.id} ${current.getAttribute("class") ?? ""}`;
    if (EXCLUDED_REGION_NAME.test(name)) return true;
    current = current.parentElement;
  }
  return false;
}

function isPotentialItem(element: Element, pageUrl: string): boolean {
  if (!REPEATED_ITEM_TAGS.has(element.tagName.toLowerCase())) return false;
  if (isExcludedRegion(element)) return false;
  const style = element.getAttribute("style")?.toLowerCase() ?? "";
  if (style.includes("display:none") || style.includes("visibility:hidden")) return false;
  const link = element.matches("a[href]") ? element : element.querySelector("a[href]");
  const href = link?.getAttribute("href");
  return Boolean(
    href && normalizedHttpUrl(href, pageUrl) && singleLine(element.textContent).length >= 3,
  );
}

function groupLabel(parent: Element, elements: Element[]): string {
  const explicit = singleLine(parent.getAttribute("aria-label"));
  if (explicit) return truncated(explicit, 80);
  const heading = parent.querySelector(":scope > h1, :scope > h2, :scope > h3");
  if (singleLine(heading?.textContent)) return truncated(singleLine(heading?.textContent), 80);
  let sibling = parent.previousElementSibling;
  while (sibling) {
    if (/^H[1-6]$/.test(sibling.tagName) && singleLine(sibling.textContent)) {
      return truncated(singleLine(sibling.textContent), 80);
    }
    if (sibling.tagName.toLowerCase() !== "script") break;
    sibling = sibling.previousElementSibling;
  }
  const words = `${parent.className} ${elements[0]?.className ?? ""}`.toLowerCase();
  if (/\bjob|career|position|vacanc/.test(words)) return "Jobs";
  if (/\bproduct|shop|store|catalog/.test(words)) return "Products";
  if (/\brelease|version|changelog/.test(words)) return "Releases";
  if (/\bannounce|notice|update/.test(words)) return "Announcements";
  if (/\barticle|post|story|news|entry/.test(words)) return "Articles";
  return "Repeated page entries";
}

function groupScore(parent: Element, elements: Element[], fields: WebFeedField[]): number {
  const first = elements[0];
  const tag = first?.tagName.toLowerCase();
  let score = Math.min(elements.length, 30) * 2 + fields.length * 6;
  if (tag === "article") score += 45;
  else if (tag === "li") score += 20;
  else if (tag === "tr") score += 12;
  const semantics = `${parent.className} ${first?.className ?? ""}`;
  if (/article|post|story|news|job|product|release|result|entry|card/i.test(semantics)) score += 24;
  if (parent.tagName.toLowerCase() === "body" || parent.tagName.toLowerCase() === "main")
    score -= 15;
  if (fields.includes("date")) score += 8;
  if (fields.includes("summary")) score += 5;
  if (fields.includes("image")) score += 4;
  return score;
}

function rankedCandidate(
  document: Document,
  pageUrl: string,
  parent: Element,
  elements: Element[],
): RankedWebFeedCandidate | null {
  const selector = itemSelector(parent, elements, document);
  let selectedItems: Element[];
  try {
    selectedItems = [...document.querySelectorAll(selector)];
  } catch {
    return null;
  }
  const selectors = selectorsFor(selectedItems, selector);
  if (!selectors) return null;
  const extracted = extractWebFeedSelection(document, pageUrl, selectors);
  if (extracted.articles.length < 2) return null;
  const config: WebFeedConfig = {
    pageUrl,
    selectors,
  };
  const fields = availableFields(extracted.articles);
  const score = groupScore(parent, elements, fields);
  const candidate: WebFeedCandidate = {
    id: candidateId(config),
    label: groupLabel(parent, elements),
    itemCount: extracted.articles.length,
    availableFields: fields,
    config,
    articles: extracted.articles.slice(0, FEED_PREVIEW_ARTICLE_LIMIT).map(previewArticle),
  };
  return {
    candidate,
    elements: selectedItems,
    articleUrls: extracted.articles.map((article) => article.url).filter((url) => url !== null),
    linkKey: extracted.articles
      .map((article) => article.externalId)
      .sort()
      .join("\n"),
    score,
  };
}

function detectCandidates(document: Document, pageUrl: string): RankedWebFeedCandidate[] {
  const found: RankedWebFeedCandidate[] = [];
  const parents = document.body
    ? [document.body, ...document.querySelectorAll("body *")]
    : [...document.querySelectorAll("*")];
  for (const parent of parents) {
    if (isExcludedRegion(parent)) continue;
    const eligible = [...parent.children].filter((child) => isPotentialItem(child, pageUrl));
    if (eligible.length < 2) continue;
    const groups = new Map<string, Element[]>();
    for (const element of eligible) {
      const tag = element.tagName.toLowerCase();
      const exactKey = `${tag}|${stableClasses(element).join(".")}`;
      const exact = groups.get(exactKey) ?? [];
      exact.push(element);
      groups.set(exactKey, exact);
      const tagKey = `${tag}|*`;
      const byTag = groups.get(tagKey) ?? [];
      byTag.push(element);
      groups.set(tagKey, byTag);
    }
    for (const elements of groups.values()) {
      if (elements.length < 2) continue;
      const candidate = rankedCandidate(document, pageUrl, parent, elements);
      if (candidate) found.push(candidate);
    }
  }
  found.sort(
    (left, right) =>
      right.score - left.score || right.candidate.itemCount - left.candidate.itemCount,
  );
  const unique: RankedWebFeedCandidate[] = [];
  const seenLinks = new Set<string>();
  for (const candidate of found) {
    if (seenLinks.has(candidate.linkKey)) continue;
    seenLinks.add(candidate.linkKey);
    unique.push(candidate);
    if (unique.length === MAX_SELECTABLE_CANDIDATES) break;
  }
  return unique;
}

function candidateFromConfig(
  document: Document,
  pageUrl: string,
  savedConfig: WebFeedConfig,
): RankedWebFeedCandidate | null {
  try {
    const extracted = extractWebFeedSelection(document, pageUrl, savedConfig.selectors);
    if (extracted.articles.length === 0) return null;
    const config: WebFeedConfig = { ...savedConfig, pageUrl };
    const fields = availableFields(extracted.articles);
    return {
      candidate: {
        id: candidateId(config),
        label: "Saved selection",
        itemCount: extracted.articles.length,
        availableFields: fields,
        config,
        articles: extracted.articles.slice(0, FEED_PREVIEW_ARTICLE_LIMIT).map(previewArticle),
      },
      elements: extracted.elements,
      articleUrls: extracted.articles.map((article) => article.url).filter((url) => url !== null),
      linkKey: extracted.articles
        .map((article) => article.externalId)
        .sort()
        .join("\n"),
      score: Number.POSITIVE_INFINITY,
    };
  } catch {
    return null;
  }
}

export interface WebFeedDocumentAnalysis {
  candidates: RankedWebFeedCandidate[];
  savedCandidateId: string | null;
}

export function analyzeWebFeedDocument(
  document: Document,
  pageUrl: string,
  savedConfig: WebFeedConfig | null = null,
): WebFeedDocumentAnalysis {
  let candidates = detectCandidates(document, pageUrl);
  let savedCandidateId: string | null = null;
  if (savedConfig) {
    const saved = candidateFromConfig(document, pageUrl, savedConfig);
    if (saved) {
      savedCandidateId = saved.candidate.id;
      candidates = [
        saved,
        ...candidates.filter((candidate) => candidate.linkKey !== saved.linkKey),
      ];
      candidates = candidates.slice(0, MAX_SELECTABLE_CANDIDATES);
    }
  }
  return { candidates, savedCandidateId };
}

export function suggestedWebFeedCandidateIds(candidates: RankedWebFeedCandidate[]): string[] {
  return candidates
    .filter(({ score }) => score >= MIN_CANDIDATE_SCORE)
    .slice(0, MAX_SUGGESTIONS)
    .map(({ candidate }) => candidate.id);
}
