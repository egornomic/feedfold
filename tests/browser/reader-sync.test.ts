import type { BrowserContext, Page } from "playwright";
import { describe, expect, it } from "vitest";
import { seedReaderBacklog } from "../helpers/reader-backlog.js";
import { browser, context, database, origin } from "./reader-browser-fixture.js";

async function otherDevice(): Promise<BrowserContext> {
  const device = await browser.newContext({ baseURL: origin });
  const login = await device.request.post("/api/auth/login", {
    data: { username: "virtual-reader", password: "reader-password" },
  });
  expect(login.status()).toBe(200);
  return device;
}

async function openFeed(device: BrowserContext, feedId: number): Promise<Page> {
  const page = await device.newPage();
  page.setDefaultTimeout(5000);
  const connected = page.waitForResponse((response) =>
    response.url().includes("/api/refresh/events"),
  );
  await page.goto(`${origin}feeds/${feedId}/all`);
  await page
    .locator('.reading-workspace[aria-busy="false"] .virtual-article-row')
    .first()
    .waitFor();
  await connected;
  return page;
}

const unreadCount = (page: Page) =>
  page.locator(".quick-links .nav-item").first().locator(".nav-count").getAttribute("title");

describe("reader state across devices and tabs", () => {
  it("shows articles read and saved on another device while this one stays open", async () => {
    const sample = seedReaderBacklog(database, "Read on another device", 3);
    const device = await otherDevice();
    const page = await openFeed(context, sample.feed.id);
    const [first, second] = database.articles.listArticlePage(1, {
      feedId: sample.feed.id,
      state: "all",
    }).articles;
    if (!first || !second) throw new Error("The sync fixture has no articles");
    try {
      const before = Number(await unreadCount(page));
      expect(
        (
          await device.request.patch(`/api/articles/${first.id}/state`, {
            data: { isRead: true, isSaved: true },
          })
        ).status(),
      ).toBe(200);
      await page
        .getByRole("button", { name: `Mark ${first.title} as unread`, exact: true })
        .waitFor();
      await expect.poll(() => unreadCount(page).then(Number)).toBe(before - 1);

      expect(
        (
          await device.request.post("/api/articles/mark-read", {
            data: { articleIds: [second.id] },
          })
        ).status(),
      ).toBe(200);
      await page
        .getByRole("button", { name: `Mark ${second.title} as unread`, exact: true })
        .waitFor();
    } finally {
      await page.close();
      await device.close();
    }
  });

  it("removes articles read in another tab from this tab's unread list", async () => {
    const sample = seedReaderBacklog(database, "Read in another tab", 3);
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const [first, second] = database.articles.listArticlePage(1, {
      feedId: sample.feed.id,
      state: "unread",
    }).articles;
    if (!first || !second) throw new Error("The sync fixture has no articles");
    const row = (title: string) => page.getByRole("button", { name: `Open ${title}`, exact: true });
    try {
      const connected = page.waitForResponse((response) =>
        response.url().includes("/api/refresh/events"),
      );
      await page.goto(`${origin}feeds/${sample.feed.id}/unread`);
      await row(first.title).waitFor();
      await connected;

      await page.getByRole("button", { name: `Mark ${second.title} as read`, exact: true }).click();
      await page
        .getByRole("button", { name: `Mark ${second.title} as unread`, exact: true })
        .waitFor();
      expect(
        (
          await context.request.patch(`/api/articles/${first.id}/state`, {
            data: { isRead: true },
          })
        ).status(),
      ).toBe(200);
      await row(first.title).waitFor({ state: "detached" });
      // An article this tab marked read keeps its place until the reader leaves the list.
      await row(second.title).waitFor();
    } finally {
      await page.close();
    }
  });

  it("keeps loaded unread articles when newer ones arrive in another delivery", async () => {
    const sample = seedReaderBacklog(database, "Pushed past the first page", 150);
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const queueLength = () =>
      page.locator(".virtual-article-row").first().getAttribute("aria-setsize").then(Number);
    try {
      const connected = page.waitForResponse((response) =>
        response.url().includes("/api/refresh/events"),
      );
      await page.goto(`${origin}feeds/${sample.feed.id}/unread`);
      await page
        .locator('.reading-workspace[aria-busy="false"] .virtual-article-row')
        .first()
        .waitFor();
      await connected;
      expect(await queueLength()).toBe(100);

      database.feeds.updateFeed(1, sample.feed.id, { paused: false });
      database.feeds.completeSourceRefresh(sample.sourceId, {
        ...sample.refresh,
        parsed: {
          title: sample.feed.title,
          siteUrl: null,
          articles: [
            {
              externalId: "newer-article",
              title: "Newer delivered article",
              url: "https://example.test/newer-delivered-article",
              author: null,
              publishedAt: new Date(Date.UTC(2026, 8, 23)).toISOString(),
              summary: "Delivered after the page loaded.",
              imageUrl: null,
              feedContentHtml: "<p>Delivered after the page loaded.</p>",
            },
          ],
        },
      });
      expect(
        (
          await context.request.patch(`/api/feeds/${sample.feed.id}`, {
            data: { title: "Pushed past the first page, renamed" },
          })
        ).status(),
      ).toBe(200);
      await page
        .getByRole("heading", { name: "Pushed past the first page, renamed" })
        .first()
        .waitFor();
      await expect.poll(queueLength).toBe(101);
    } finally {
      await page.close();
    }
  });

  it("does not reload its own reader after reading an article", async () => {
    const sample = seedReaderBacklog(database, "Read in this tab", 3);
    const page = await openFeed(context, sample.feed.id);
    const [first] = database.articles.listArticlePage(1, {
      feedId: sample.feed.id,
      state: "all",
    }).articles;
    if (!first) throw new Error("The sync fixture has no articles");
    try {
      const reloads: string[] = [];
      page.on("request", (request) => {
        if (/\/api\/(bootstrap|articles\?)/.test(request.url())) reloads.push(request.url());
      });
      const saved = page.waitForResponse((response) =>
        response.url().endsWith(`/api/articles/${first.id}/state`),
      );
      await page.getByRole("button", { name: `Mark ${first.title} as read`, exact: true }).click();
      await saved;
      await page.waitForTimeout(500);
      // The completed change refreshes its counts once; an echoed server event would reload the list too.
      expect(reloads.filter((url) => url.includes("/api/articles?"))).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it("keeps receiving changes after the event stream is briefly unavailable", async () => {
    const sample = seedReaderBacklog(database, "Before the outage", 2);
    const device = await otherDevice();
    const page = await device.newPage();
    page.setDefaultTimeout(5000);
    let outage = true;
    await page.route(/\/api\/refresh\/events/, async (route) => {
      if (outage) await route.fulfill({ status: 502, body: "Bad Gateway" });
      else await route.continue();
    });
    try {
      const unavailable = page.waitForResponse(
        (response) => response.url().includes("/api/refresh/events") && response.status() === 502,
      );
      await page.goto(`${origin}feeds/${sample.feed.id}/all`);
      await page
        .locator('.reading-workspace[aria-busy="false"] .virtual-article-row')
        .first()
        .waitFor();
      await unavailable;
      outage = false;
      const reconnected = page.waitForResponse(
        (response) => response.url().includes("/api/refresh/events") && response.status() === 200,
        { timeout: 15_000 },
      );
      await reconnected;
      expect(
        (
          await context.request.patch(`/api/feeds/${sample.feed.id}`, {
            data: { title: "After the outage" },
          })
        ).status(),
      ).toBe(200);
      await page.getByRole("heading", { name: "After the outage" }).first().waitFor();
    } finally {
      await page.close();
      await device.close();
    }
  }, 30_000);

  it("keeps a device preference chosen in another tab", async () => {
    const sample = seedReaderBacklog(database, "Preferences in two tabs", 2);
    const settings = await context.newPage();
    const reader = await openFeed(context, sample.feed.id);
    const theme = (page: Page) =>
      page.evaluate(() => document.documentElement.dataset.theme ?? null);
    try {
      settings.setDefaultTimeout(5000);
      await settings.goto(`${origin}settings`);
      await settings.locator(".settings-page").waitFor();
      const initial = await theme(reader);
      const chosen = initial === "light" ? "Dark" : "Light";
      await settings.getByRole("button", { name: chosen, exact: true }).click();
      await expect.poll(() => theme(reader)).toBe(chosen.toLowerCase());

      await reader.getByRole("button", { name: "Expanded view", exact: true }).click();
      await expect.poll(() => theme(settings)).toBe(chosen.toLowerCase());
      const next = await openFeed(context, sample.feed.id);
      try {
        expect(await theme(next)).toBe(chosen.toLowerCase());
        await next.locator(".reading-workspace.mode-expanded").waitFor();
      } finally {
        await next.close();
      }
    } finally {
      await settings.close();
      await reader.close();
    }
  });
});
