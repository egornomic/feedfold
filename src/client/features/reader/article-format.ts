import type { Article } from "../../../shared/types";

function formatRelativeDate(value: string | null): string {
  if (!value) return "No date";
  const date = new Date(value);
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const ranges: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of ranges) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit);
  }
  return "Just now";
}

export function articleDate(article: Article): string {
  return formatRelativeDate(article.publishedAt ?? article.discoveredAt);
}

export function articleLabel(article: Article): string {
  return article.title || article.summary || "article";
}

export function formatViewCount(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}

export function mediaTypeLabel(article: Article): string | null {
  if (!article.media) return null;
  return article.media.type === "short" ? "Short" : "Video";
}
