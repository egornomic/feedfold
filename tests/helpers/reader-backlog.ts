import type { AppDatabase } from "../../src/server/database.js";

export function seedReaderBacklog(
  database: AppDatabase,
  title = "Virtualization backlog",
  count = 1200,
  assetOrigin = "https://example.test",
) {
  const feed = database.feeds.createFeed(1, {
    title,
    feedUrl: `https://example.test/${encodeURIComponent(title)}.xml`,
  });
  const refresh = { httpStatus: 200, etag: null, lastModified: null };
  const sourceId = database.feeds.sourceIdForFeed(feed.id);
  database.feeds.completeSourceRefresh(sourceId, {
    ...refresh,
    parsed: { title, siteUrl: null, articles: [] },
  });
  const articles = Array.from({ length: count }, (_, index) => ({
    externalId: `article-${index}`,
    title: `${title} ${String(index).padStart(4, "0")}`,
    url: `https://example.test/${encodeURIComponent(title)}/${index}`,
    author: "Backlog author",
    publishedAt: new Date(Date.UTC(2026, 8, 22, 12, 0, -index)).toISOString(),
    summary: `Summary ${index}. ${"A variable length description. ".repeat((index % 5) + 1)}`,
    imageUrl: null,
    feedContentHtml: `${index === 0 ? `<img src="${assetOrigin}/delayed-image.svg" alt="Delayed landscape"><video src="${assetOrigin}/tone.wav" controls loop></video>` : ""}<p>Introduction ${index}.</p>${"<p>Reading continuity matters when articles have different heights and content arrives while reading.</p>".repeat((index % 12) + 1)}<p>bodyneedle${index} searchable text.</p>`,
  }));
  database.feeds.completeSourceRefresh(sourceId, {
    ...refresh,
    parsed: { title, siteUrl: null, articles },
  });
  database.feeds.updateFeed(1, feed.id, { paused: true });
  return { feed, articles, sourceId, refresh };
}
