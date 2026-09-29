import { describe, expect, it } from "vitest";
import { seedReaderBacklog } from "../helpers/reader-backlog.js";
import {
  bottom,
  context,
  database,
  desktopAppPath,
  open,
  origin,
  settle,
} from "./reader-browser-fixture.js";

describe(`${desktopAppPath ? "desktop" : "browser"} virtual reading with a populated database`, () => {
  it("keeps a read article open after refreshing its unread reader context", async () => {
    const sample = seedReaderBacklog(database, "Refreshed unread article", 3);
    const page = await open("magazine");
    const selected = database.articles.listArticlePage(1, {
      feedId: sample.feed.id,
      state: "unread",
    }).articles[1];
    if (!selected) throw new Error("The refresh fixture has no article");
    try {
      await page.goto(`${origin}feeds/${sample.feed.id}/unread`);
      await page.getByRole("button", { name: `Open ${selected.title}`, exact: true }).click();
      await expect.poll(() => database.articles.getArticle(1, selected.id)?.isRead).toBe(true);
      const anchoredPage = page.waitForResponse((response) =>
        response.url().includes(`anchorId=${selected.id}`),
      );
      await page.reload();
      expect((await anchoredPage).status()).toBe(200);
      await page.locator('.reading-workspace[aria-busy="false"]').waitFor();
      await settle(page);
      await expect
        .poll(() => page.locator(".article-swipe-layer.is-active h2").allTextContents())
        .toEqual([`${selected.title} (opens in a new tab)`]);
      await page.getByRole("button", { name: "Back to articles", exact: true }).click();
      await expect.poll(() => page.locator(".article-open-button").count()).toBe(2);
      expect(await page.locator(".article-open-button").allTextContents()).not.toContain(
        `Open ${selected.title}`,
      );
    } finally {
      await page.close();
    }
  });

  it("keeps excluded cached read articles out when loading the next unread page", async () => {
    const sample = seedReaderBacklog(database, "Cached unread pagination", 105);
    const page = await open("magazine");
    const selected = database.articles.listArticlePage(1, {
      feedId: sample.feed.id,
      state: "unread",
    }).articles[0];
    if (!selected) throw new Error("The pagination fixture has no article");
    try {
      await page.goto(`${origin}feeds/${sample.feed.id}/unread`);
      await page.getByRole("button", { name: `Open ${selected.title}`, exact: true }).waitFor();
      await page.getByRole("button", { name: "All articles", exact: true }).click();
      await page
        .getByRole("button", { name: `Mark ${selected.title} as read`, exact: true })
        .click();
      await expect.poll(() => database.articles.getArticle(1, selected.id)?.isRead).toBe(true);
      await page.getByRole("button", { name: /104 Unread/ }).click();
      await page
        .getByRole("button", { name: `Open ${sample.feed.title} 0001`, exact: true })
        .waitFor();
      expect(await page.locator(".article-open-button").allTextContents()).not.toContain(
        `Open ${selected.title}`,
      );
      const nextPage = page.waitForResponse((response) => response.url().includes("cursor="));
      await bottom(page);
      const response = await nextPage;
      expect(response.status()).toBe(200);
      const result = await response.json();
      expect(result.articles.map((article: { id: number }) => article.id)).not.toContain(
        selected.id,
      );
      await settle(page);
      await bottom(page);
      await page
        .getByRole("button", { name: `Open ${sample.feed.title} 0104`, exact: true })
        .waitFor();
      expect(await page.locator(".article-open-button").allTextContents()).not.toContain(
        `Open ${selected.title}`,
      );
    } finally {
      await page.close();
    }
  });

  it.each(["folder", "feed"] as const)(
    "excludes a newly read article when revisiting a cached unread %s",
    async (scope) => {
      const sample = seedReaderBacklog(database, `Unread ${scope}`, 3);
      const folder = database.folders.createFolder(1, { name: `Unread ${scope} folder` });
      database.feeds.updateFeed(1, sample.feed.id, { folderId: folder.id });
      const page = await open("magazine");
      const scopePath =
        scope === "folder" ? `folders/${folder.id}/unread` : `feeds/${sample.feed.id}/unread`;
      const selected = database.articles.listArticlePage(1, {
        feedId: sample.feed.id,
        state: "unread",
      }).articles[1];
      if (!selected) throw new Error("The unread fixture has no article");
      const rows = () => page.locator(".article-open-button").allTextContents();
      try {
        await page.goto(`${origin}${scopePath}`);
        await expect.poll(rows).toHaveLength(3);
        await page.locator(".quick-links .nav-item").first().click();
        await page.getByRole("button", { name: `Open ${selected.title}`, exact: true }).click();
        await expect.poll(() => database.articles.getArticle(1, selected.id)?.isRead).toBe(true);
        await page.locator(".article-swipe-layer.is-active .article-content").waitFor();
        // The live API excludes the read article; a cached list must agree immediately.
        const response = await page.request.get(
          `/api/articles?state=unread&${scope}Id=${scope === "folder" ? folder.id : sample.feed.id}`,
        );
        expect(response.status()).toBe(200);
        const result = await response.json();
        expect(result.articles.map((article: { id: number }) => article.id)).not.toContain(
          selected.id,
        );
        await page
          .locator(
            scope === "folder"
              ? `button[data-management-folder-id="${folder.id}"]`
              : `.feed-nav-item[data-management-feed-id="${sample.feed.id}"]`,
          )
          .click();
        await page.waitForURL(`${origin}${scopePath}`);
        await page
          .locator('.reading-workspace[aria-busy="false"] .article-open-button')
          .first()
          .waitFor();
        expect(await rows()).not.toContain(`Open ${selected.title}`);
        expect(await rows()).toHaveLength(2);
      } finally {
        await page.close();
      }
    },
  );

  it.each(["rename", "pause"] as const)(
    "keeps read articles in the unread queue after a feed %s",
    async (action) => {
      const sample = seedReaderBacklog(database, `Metadata ${action}`, 3);
      database.feeds.updateFeed(1, sample.feed.id, { paused: false });
      const page = await open("expanded");
      const titles = () => page.locator(".expanded-article .article-header h2").allTextContents();
      try {
        await page.goto(`${origin}feeds/${sample.feed.id}/unread`);
        await expect.poll(() => page.locator(".expanded-article").count()).toBe(3);
        const original = await titles();
        await page.getByRole("button", { name: "Mark as read (U)", exact: true }).first().click();
        await expect.poll(() => database.feeds.getFeed(1, sample.feed.id)?.unreadCount).toBe(2);
        await expect.poll(titles).toEqual(original);
        await page
          .getByRole("button", { name: `Manage ${sample.feed.title}`, exact: true })
          .click();
        if (action === "rename") {
          await page.getByRole("menuitem", { name: "Rename feed", exact: true }).click();
          await page.getByRole("textbox", { name: "Feed name" }).fill("Renamed metadata feed");
          await page.getByRole("button", { name: "Save name", exact: true }).click();
          await page
            .getByRole("dialog", { name: "Rename feed", exact: true })
            .waitFor({ state: "hidden" });
          expect(database.feeds.getFeed(1, sample.feed.id)?.title).toBe("Renamed metadata feed");
        } else {
          await page.getByRole("menuitem", { name: "Feed settings", exact: true }).click();
          await page.getByRole("button", { name: "Pause feed", exact: true }).click();
          await page.getByRole("button", { name: "Resume feed", exact: true }).waitFor();
          expect(database.feeds.getFeed(1, sample.feed.id)?.paused).toBe(true);
          await page.getByRole("button", { name: "Close", exact: true }).click();
          await page.getByRole("dialog").waitFor({ state: "hidden" });
        }
        await expect.poll(titles).toEqual(original);
      } finally {
        await page.close();
      }
    },
  );

  it("removes older articles from the unread queue after a bulk read without reloading", async () => {
    const sample = seedReaderBacklog(database, "Bulk read queue", 3);
    database.feeds.completeSourceRefresh(sample.sourceId, {
      ...sample.refresh,
      parsed: {
        title: sample.feed.title,
        siteUrl: null,
        articles: sample.articles.map((article, index) => ({
          ...article,
          publishedAt: new Date(Date.now() - (index + 2) * 86_400_000).toISOString(),
        })),
      },
    });
    const page = await open("magazine");
    try {
      await page.goto(`${origin}feeds/${sample.feed.id}/unread`);
      await page
        .getByRole("button", { name: `Open ${sample.articles[0]?.title}`, exact: true })
        .waitFor();
      await page.getByRole("button", { name: "Mark older articles as read", exact: true }).click();
      await page.getByRole("menuitem", { name: "Older than a day", exact: true }).click();
      await expect.poll(() => database.feeds.getFeed(1, sample.feed.id)?.unreadCount).toBe(0);
      await page.getByText("No unread articles", { exact: true }).waitFor();
      expect(await page.locator(".virtual-article-row").count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it.each(["normal save", "overlapping update"])(
    "applies a saved folder order without reloading: %s",
    async (scenario) => {
      const sample = seedReaderBacklog(database, `Sorted queue ${scenario}`, 3);
      const folder = database.folders.createFolder(1, {
        name: `Sort review ${scenario}`,
        sortDirection: "oldest",
      });
      database.feeds.updateFeed(1, sample.feed.id, { folderId: folder.id });
      const page = await open("magazine");
      const firstTitle = () => page.locator(".virtual-article-row").first().textContent();
      let releaseArticles = () => {};
      try {
        await page.goto(`${origin}folders/${folder.id}/all`);
        await expect.poll(firstTitle).toContain(sample.articles.at(-1)?.title);
        if (scenario === "overlapping update") {
          let folderSaved = false;
          page.on("response", (response) => {
            if (
              response.request().method() === "PATCH" &&
              response.url() === `${origin}api/folders/${folder.id}`
            )
              folderSaved = true;
          });
          const articlesReady = new Promise<void>((resolve) => {
            releaseArticles = resolve;
          });
          let interrupted = false;
          await page.route(/\/api\/articles\?/, async (route) => {
            // A startup refresh must not consume the interruption intended for Save folder.
            if (!folderSaved) {
              await route.continue();
              return;
            }
            if (!interrupted) {
              interrupted = true;
              // A real server notification replaces the reload started by Save folder.
              const response = await context.request.patch(`/api/feeds/${sample.feed.id}`, {
                data: { title: "Concurrent rename" },
              });
              expect(response.ok()).toBe(true);
            }
            await articlesReady;
            await route.continue();
          });
        }
        await page.getByRole("button", { name: `Manage ${folder.name}`, exact: true }).click();
        await page.getByRole("menuitem", { name: "Folder settings", exact: true }).click();
        await page.getByRole("combobox", { name: "Article order", exact: true }).click();
        await page.getByRole("option", { name: "Newest first", exact: true }).click();
        await page.getByRole("button", { name: "Save folder", exact: true }).click();
        await expect
          .poll(() => database.folders.getFolder(1, folder.id)?.sortDirection)
          .toBe("newest");
        await page
          .getByRole("dialog", { name: "Folder settings", exact: true })
          .waitFor({ state: "hidden" });
        if (scenario === "overlapping update")
          expect(await firstTitle()).toContain(sample.articles.at(-1)?.title);
        releaseArticles();
        await expect.poll(firstTitle).toContain(sample.articles[0]?.title);
      } finally {
        releaseArticles();
        await page.close();
      }
    },
  );
});
