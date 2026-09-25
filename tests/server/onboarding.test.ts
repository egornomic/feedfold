import { describe, expect, it } from "vitest";
import { HIDE_SHORTS_RULE } from "../../src/client/features/auth/onboarding-state.js";
import { youtubeMediaFromUrl } from "../../src/server/article-media.js";
import { AppDatabase } from "../../src/server/database.js";
import { completeFeedRefresh } from "../helpers/feeds.js";

describe("onboarding Shorts preference", () => {
  it("hides existing and incoming Shorts, keeps videos and articles, and restores Shorts when disabled", () => {
    const database = new AppDatabase(":memory:");
    try {
      const feed = database.feeds.createFeed(1, {
        title: "Mixed reading",
        feedUrl: "https://example.com/feed.xml",
      });
      const refresh = (entries: Array<[string, string]>) =>
        completeFeedRefresh(database.feeds, feed.id, {
          httpStatus: 200,
          etag: null,
          lastModified: null,
          parsed: {
            title: "Mixed reading",
            siteUrl: null,
            articles: entries.map(([title, url]) => ({
              externalId: url,
              title,
              url,
              media: youtubeMediaFromUrl(url),
              author: null,
              publishedAt: null,
              summary: "",
              imageUrl: null,
              feedContentHtml: null,
            })),
          },
        });
      const titles = () =>
        database.articles
          .listArticlePage(1, { state: "all" })
          .articles.map((article) => article.title)
          .sort();
      refresh([
        ["Short", "https://www.youtube.com/shorts/short123"],
        ["Video", "https://www.youtube.com/watch?v=video123"],
        ["Article about Shorts", "https://example.com/shorts"],
      ]);
      expect(titles()).toEqual(["Article about Shorts", "Short", "Video"]);
      const rule = database.rules.createRule(1, HIDE_SHORTS_RULE);
      expect(titles()).toEqual(["Article about Shorts", "Video"]);
      refresh([["Incoming Short", "https://www.youtube.com/shorts/short456"]]);
      expect(titles()).toEqual(["Article about Shorts", "Video"]);
      database.rules.updateRule(1, rule.id, { enabled: false });
      expect(titles()).toEqual(["Article about Shorts", "Incoming Short", "Short", "Video"]);
      database.rules.updateRule(1, rule.id, { enabled: true });
      expect(titles()).toEqual(["Article about Shorts", "Video"]);
      expect(database.rules.listRules(1)).toHaveLength(1);
    } finally {
      database.close();
    }
  });
});
