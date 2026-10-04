import { describe, expect, it } from "vitest";
import { seedReaderBacklog } from "../helpers/reader-backlog.js";
import {
  anchor,
  backlog,
  bottom,
  database,
  desktopAppPath,
  open,
  origin,
  settle,
  surface,
} from "./reader-browser-fixture.js";

describe(`${desktopAppPath ? "desktop" : "browser"} virtual reading with a populated database`, () => {
  it("returns from the final article when the queue refresh fails offline", async () => {
    const sample = seedReaderBacklog(database, "Offline queue completion", 1);
    const page = await open("magazine");
    try {
      await page.goto(`${origin}feeds/${sample.feed.id}/unread`);
      await page
        .getByRole("button", { name: `Open ${sample.feed.title} 0000`, exact: true })
        .click();
      await expect
        .poll(
          () =>
            database.articles.listArticlePage(1, { feedId: sample.feed.id, state: "unread" })
              .articles.length,
        )
        .toBe(0);
      await settle(page);
      const response = await page.request.get(
        `/api/articles?feedId=${sample.feed.id}&state=unread`,
      );
      expect(response.status()).toBe(200);
      expect((await response.json()).articles).toEqual([]);
      await page.context().setOffline(true);
      await page.keyboard.press("j");
      await expect
        .poll(() => new URL(page.url()).pathname, { timeout: 15_000 })
        .toBe(`/feeds/${sample.feed.id}/unread`);
      await expect.poll(() => page.locator(".article-swipe-layer.is-active").count()).toBe(0);
    } finally {
      await page.context().setOffline(false);
      await page.close();
    }
  }, 20_000);

  it.each(["keyboard", "focus"] as const)(
    "keeps a newer expanded article selection made by %s while the queue refresh is pending",
    async (input) => {
      const sample = seedReaderBacklog(database, `Expanded pending selection ${input}`, 2);
      const page = await open("expanded");
      let release = () => {};
      try {
        await page.goto(`${origin}feeds/${sample.feed.id}/all`);
        await page.locator(".expanded-article").first().waitFor();
        for (const title of ["0000", "0001"]) {
          await page.keyboard.press("j");
          await expect
            .poll(() => page.locator(".expanded-article.is-active h2").textContent())
            .toContain(title);
          await settle(page);
        }
        await expect
          .poll(
            () =>
              database.articles.listArticlePage(1, { feedId: sample.feed.id, state: "unread" })
                .articles.length,
          )
          .toBe(0);
        await page.waitForTimeout(500);
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        let requested = false;
        await page.route(/\/api\/articles\?/, async (route) => {
          const response = await route.fetch();
          expect(response.status()).toBe(200);
          requested = true;
          await held;
          await route.fulfill({ response });
        });
        await page.keyboard.press("j");
        await expect.poll(() => requested).toBe(true);
        if (input === "keyboard") await page.keyboard.press("k");
        else
          await page
            .locator(".expanded-article")
            .first()
            .getByRole("button", { name: "Save article (S)", exact: true })
            .focus();
        await expect
          .poll(() => page.locator(".expanded-article.is-active h2").textContent())
          .toContain("0000");
        const completed = page.waitForResponse((response) =>
          response.url().includes("/api/articles?"),
        );
        release();
        await completed;
        await settle(page);
        expect(new URL(page.url()).pathname).toBe(`/feeds/${sample.feed.id}/all`);
        expect(await page.locator(".expanded-article.is-active h2").textContent()).toContain(
          "0000",
        );
      } finally {
        release();
        await page.close();
      }
    },
    20_000,
  );

  it.each(["pending", "complete", "unannounced", "left reader"] as const)(
    "continues reading new deliveries with a %s queue update",
    async (delivery) => {
      const sample = seedReaderBacklog(database, `Queue delivery ${delivery}`, 2);
      const page = await open("magazine");
      let release = () => {};
      try {
        await page.goto(`${origin}feeds/${sample.feed.id}/unread`);
        await page
          .getByRole("button", { name: `Open ${sample.feed.title} 0000`, exact: true })
          .click();
        await expect
          .poll(
            () =>
              database.bootstrap.getBootstrap(1).feeds.find((feed) => feed.id === sample.feed.id)
                ?.unreadCount,
          )
          .toBe(1);
        await page.keyboard.press("j");
        await expect
          .poll(() => page.locator(".article-swipe-layer.is-active h2").textContent())
          .toContain("0001");
        await expect
          .poll(
            () =>
              database.bootstrap.getBootstrap(1).feeds.find((feed) => feed.id === sample.feed.id)
                ?.unreadCount,
          )
          .toBe(0);
        await settle(page);
        const template = sample.articles[0];
        if (!template) throw new Error("The delivery fixture has no article");
        const delivered = [1, 2].map((index) => ({
          ...template,
          externalId: `delivered-${index}`,
          title: `Delivered article ${index} (${delivery})`,
          url: null,
          publishedAt: new Date(Date.UTC(2026, 9, 4, 12, 0, -index)).toISOString(),
        }));
        database.feeds.updateFeed(1, sample.feed.id, { paused: false });
        database.feeds.completeSourceRefresh(sample.sourceId, {
          ...sample.refresh,
          parsed: { title: sample.feed.title, siteUrl: null, articles: delivered },
        });
        database.feeds.updateFeed(1, sample.feed.id, { paused: true });
        const fresh = await page.request.get(`/api/articles?feedId=${sample.feed.id}&state=unread`);
        expect(fresh.status()).toBe(200);
        expect(
          (await fresh.json()).articles.map((article: { title: string }) => article.title),
        ).toEqual(delivered.map((article) => article.title));
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        let requested = false;
        await page.route(/\/api\/articles\?/, async (route) => {
          const response = await route.fetch();
          requested = true;
          await held;
          await route.fulfill({ response });
        });
        if (delivery !== "unannounced") {
          await page.evaluate(() => window.dispatchEvent(new Event("online")));
          await expect.poll(() => requested).toBe(true);
        }
        if (delivery === "complete") {
          release();
          await settle(page);
        }
        await page.keyboard.press("j");
        expect(new URL(page.url()).pathname).toMatch(/^\/articles\/\d+$/);
        if (delivery === "left reader") {
          await page.getByRole("button", { name: "Back to articles", exact: true }).click();
          await expect
            .poll(() => new URL(page.url()).pathname)
            .toBe(`/feeds/${sample.feed.id}/unread`);
          release();
          await settle(page);
          expect(new URL(page.url()).pathname).toBe(`/feeds/${sample.feed.id}/unread`);
          expect(await page.locator(".article-swipe-layer.is-active").count()).toBe(0);
          return;
        }
        release();
        await expect
          .poll(() => page.locator(".article-swipe-layer.is-active h2").textContent())
          .toContain("Delivered article 1");
        await page.keyboard.press("k");
        await expect
          .poll(() => page.locator(".article-swipe-layer.is-active h2").textContent())
          .toContain("0001");
        for (const title of ["Delivered article 1", "Delivered article 2"]) {
          await page.keyboard.press("j");
          await expect
            .poll(() => page.locator(".article-swipe-layer.is-active h2").textContent())
            .toContain(title);
          await settle(page);
        }
        await page.keyboard.press("j");
        await expect
          .poll(() => new URL(page.url()).pathname)
          .toBe(`/feeds/${sample.feed.id}/unread`);
      } finally {
        release();
        await page.close();
      }
    },
  );

  it("clears a shared article selection when navigating between its feed and folder", async () => {
    const sample = seedReaderBacklog(database, "Selection reset", 30);
    const folder = database.folders.createFolder(1, { name: "Selection reset folder" });
    database.feeds.updateFeed(1, sample.feed.id, { folderId: folder.id });
    const page = await open("magazine");
    try {
      await page.goto(`${origin}folders/${folder.id}/all`);
      await page.locator(".article-open-button").first().waitFor();
      await surface(page).evaluate((element) => {
        element.scrollTop = 1500;
      });
      await settle(page);
      const selected = await anchor(page);
      await page.locator(`[data-article-id="${selected.id}"] .article-open-button`).click();
      await page.locator(".article-swipe-layer.is-active .article-content").waitFor();
      for (const scope of ["feed", "folder"] as const) {
        await page
          .locator(
            scope === "feed"
              ? `.feed-nav-item[data-management-feed-id="${sample.feed.id}"]`
              : `button[data-management-folder-id="${folder.id}"]`,
          )
          .click();
        await page
          .getByRole("heading", {
            name: scope === "feed" ? sample.feed.title : folder.name,
            exact: true,
          })
          .waitFor();
        await settle(page);
        expect(await page.locator(".article-list-item.is-active").count()).toBe(0);
        expect(await surface(page).evaluate((element) => element.scrollTop)).toBe(0);
        expect(await page.locator(".virtual-article-row").first().textContent()).toContain(
          sample.articles[0]?.title,
        );
      }
    } finally {
      await page.close();
    }
  });

  it.each(["back button", "browser back"] as const)(
    "returns from an article to an unselected magazine at the top using %s",
    async (navigation) => {
      const page = await open("magazine");
      try {
        await surface(page).evaluate((element) => {
          element.scrollTop = 3500;
        });
        await settle(page);
        const selected = await anchor(page);
        await page.locator(`[data-article-id="${selected.id}"] .article-open-button`).click();
        await page.locator(".article-swipe-layer.is-active .article-content").waitFor();
        if (navigation === "browser back") await page.goBack();
        else await page.getByRole("button", { name: "Back to articles", exact: true }).click();
        await page.getByRole("heading", { name: backlog.feed.title, exact: true }).waitFor();
        await settle(page);
        expect(await page.locator(".article-list-item.is-active").count()).toBe(0);
        expect(await surface(page).evaluate((element) => element.scrollTop)).toBe(0);
        const first = database.articles.listArticlePage(1, {
          feedId: backlog.feed.id,
          state: "all",
        }).articles[0];
        await page.keyboard.press("j");
        await expect
          .poll(() => page.locator(".article-swipe-layer.is-active h2").first().textContent())
          .toContain(first?.title);
      } finally {
        await page.close();
      }
    },
  );

  it("navigates beyond mounted rows and across page boundaries with the keyboard", async () => {
    const page = await open("expanded");
    try {
      for (let i = 0; i <= 26; i++) {
        await page.keyboard.press("j");
        await expect
          .poll(() => page.locator(".expanded-article.is-active h2").textContent())
          .toContain(String(i).padStart(4, "0"));
      }
      const active = page.locator(".expanded-article.is-active");
      expect(
        await active.evaluate((element) => element.getBoundingClientRect().top),
      ).toBeGreaterThanOrEqual(0);
      expect(await page.locator(".virtual-article-row").count()).toBeLessThan(25);
      const id = Number(await active.locator("..").getAttribute("data-article-id"));
      await page.keyboard.press("s");
      await expect.poll(() => database.articles.getArticle(1, id)?.isSaved).toBe(true);
      await page.keyboard.press("u");
      await expect.poll(() => database.articles.getArticle(1, id)?.isRead).toBe(false);
      await page.keyboard.press("k");
      await page.keyboard.press("j");
      await expect
        .poll(() =>
          page
            .locator(".expanded-article.is-active .save-state-action")
            .getAttribute("aria-pressed"),
        )
        .toBe("true");
    } finally {
      await page.close();
    }
  }, 20_000);

  it("returns to the unselected magazine top after keyboard navigation past a loaded page", async () => {
    const page = await open("magazine");
    try {
      await bottom(page);
      await settle(page);
      const row = page
        .locator(".virtual-article-row")
        .filter({ hasText: "Virtualization backlog 0099" });
      await row.locator(".article-open-button").click();
      for (const title of ["0100", "0101", "0102"]) {
        await page.keyboard.press("j");
        await expect
          .poll(() => page.locator(".article-swipe-layer.is-active h2").textContent(), {
            timeout: 5000,
          })
          .toContain(title);
      }
      await page.locator('.reading-workspace[aria-busy="false"]').waitFor();
      await page.getByRole("button", { name: "Back to articles", exact: true }).click();
      await page.locator(".article-list").waitFor();
      await settle(page);
      expect(await page.locator(".article-list-item.is-active").count()).toBe(0);
      expect(await surface(page).evaluate((element) => element.scrollTop)).toBe(0);
      expect(await page.locator(".virtual-article-row").first().textContent()).toContain("0000");
      expect(await page.locator(".virtual-article-row").count()).toBeLessThan(25);
    } finally {
      await page.close();
    }
  }, 30_000);
});
