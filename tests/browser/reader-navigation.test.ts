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
      await expect.poll(() => database.articles.getArticle(1, id)?.isStarred).toBe(true);
      await page.keyboard.press("u");
      await expect.poll(() => database.articles.getArticle(1, id)?.isRead).toBe(false);
      await page.keyboard.press("k");
      await page.keyboard.press("j");
      await expect
        .poll(() =>
          page
            .locator(".expanded-article.is-active .star-state-action")
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
