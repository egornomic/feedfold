import type { Page } from "playwright";
import { describe, expect, it } from "vitest";
import { AuthService } from "../../src/server/features/auth/service.js";
import { seedReaderBacklog } from "../helpers/reader-backlog.js";
import {
  bottom,
  browser,
  context,
  database,
  desktopAppPath,
  open,
  origin,
  settle,
} from "./reader-browser-fixture.js";

async function markOlder(page: Page) {
  await page.getByRole("button", { name: "Mark older articles as read", exact: true }).click();
  await page.getByRole("menuitem", { name: "Older than a day", exact: true }).click();
}

async function confirmOlderRead(page: Page, accept: boolean): Promise<string> {
  const dialog = page.waitForEvent("dialog").then(async (prompt) => {
    const message = prompt.message();
    await (accept ? prompt.accept() : prompt.dismiss());
    return message;
  });
  const [message] = await Promise.all([dialog, markOlder(page)]);
  return message;
}

describe(`${desktopAppPath ? "desktop" : "browser"} virtual reading with a populated database`, () => {
  it.skipIf(Boolean(desktopAppPath))(
    "opens feed management from an empty All articles queue",
    async () => {
      const auth = new AuthService(database.auth, 20, { maxAccounts: 2 });
      const reader = await auth.register("empty-reader", "reader-password");
      if (!reader) throw new Error("Could not create the empty reader account");
      const emptyContext = await browser.newContext({
        baseURL: origin,
        viewport: { width: 390, height: 844 },
      });
      try {
        const login = await emptyContext.request.post("/api/auth/login", {
          data: { username: "empty-reader", password: "reader-password" },
        });
        expect(login.status()).toBe(200);
        database.feeds.createFeed(reader.user.id, {
          title: "Empty subscription",
          feedUrl: "https://example.test/empty.xml",
          paused: true,
        });
        const response = await emptyContext.request.get("/api/articles?state=all");
        expect(response.status()).toBe(200);
        expect((await response.json()).articles).toEqual([]);

        const page = await emptyContext.newPage();
        page.setDefaultTimeout(5000);
        await page.goto("/articles/all");
        const empty = page.locator(".empty-state");
        await empty.getByRole("heading", { name: "No articles in this view" }).waitFor();
        await empty.getByRole("button", { name: "Manage feeds", exact: true }).click();
        await page.waitForURL(`${origin}feeds`);
        await page.getByRole("heading", { name: "Manage feeds", exact: true }).waitFor();
        await page
          .getByRole("list", { name: "Subscriptions", exact: true })
          .getByText("Empty subscription", { exact: true })
          .waitFor();
      } finally {
        await emptyContext.close();
      }
    },
  );

  it.each(["feed", "folder"] as const)(
    "broadens an empty All articles queue for a %s",
    async (scope) => {
      const { feed } = seedReaderBacklog(database, `Empty ${scope} subscription`, 0);
      const folder = database.folders.createFolder(1, { name: `Empty ${scope} group` });
      database.feeds.updateFeed(1, feed.id, { folderId: folder.id });
      const scopePath = scope === "feed" ? `feeds/${feed.id}` : `folders/${folder.id}`;
      const page = await open("magazine");
      try {
        await page.goto(`${origin}${scopePath}/saved`);
        const empty = page.locator(".empty-state");
        await empty.getByRole("button", { name: "Show all articles", exact: true }).click();
        await page.waitForURL(`${origin}${scopePath}/all`);
        await page.locator('.reading-workspace[aria-busy="false"]').waitFor();
        await empty
          .getByRole("button", { name: "Show articles from all feeds", exact: true })
          .click();
        await page.waitForURL(`${origin}articles/all`);
        await page
          .getByRole("button", { name: "Open Virtualization backlog 0000", exact: true })
          .waitFor();
      } finally {
        await page.close();
      }
    },
  );

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

  it.each(["feed", "folder"] as const)(
    "marks older unread articles across every page of a %s",
    async (scope) => {
      const sample = seedReaderBacklog(database, `Bulk read ${scope}`, 105);
      const outside = seedReaderBacklog(database, `Outside bulk read ${scope}`, 1);
      database.connection
        .prepare(
          "UPDATE articles SET published_at = '2000-01-01T00:00:00.000Z' WHERE source_id IN (?, ?)",
        )
        .run(sample.sourceId, outside.sourceId);
      const parent = database.folders.createFolder(1, { name: "Bulk read parent" });
      const child = database.folders.createFolder(1, {
        name: "Bulk read child",
        parentId: parent.id,
      });
      database.feeds.updateFeed(1, sample.feed.id, { folderId: child.id });
      const scopeId = scope === "feed" ? sample.feed.id : parent.id;
      const page = await open("magazine");
      try {
        const firstPage = desktopAppPath
          ? null
          : page.waitForResponse((response) => {
              const { pathname, searchParams } = new URL(response.url());
              return (
                pathname === "/api/articles" && searchParams.get(`${scope}Id`) === String(scopeId)
              );
            });
        await page.goto(`${origin}${scope}s/${scopeId}/unread`);
        const initial = firstPage
          ? await (await firstPage).json()
          : database.articles.listArticlePage(1, {
              state: "unread",
              limit: 100,
              ...(scope === "feed" ? { feedId: scopeId } : { folderId: scopeId }),
            });
        expect(initial.articles).toHaveLength(100);
        expect(initial.nextCursor).toBeTruthy();
        const message = await confirmOlderRead(page, true);
        expect(message).toBe("Mark 105 articles as read?");
        await page.getByText("Marked 105 articles as read", { exact: true }).waitFor();
        await page.getByText("No unread articles", { exact: true }).waitFor();
        expect(database.feeds.getFeed(1, sample.feed.id)?.unreadCount).toBe(0);
        expect(database.feeds.getFeed(1, outside.feed.id)?.unreadCount).toBe(1);
      } finally {
        await page.close();
      }
    },
  );

  it("keeps an overlong search editable and submits it after correction", async () => {
    const page = await open("magazine");
    try {
      await page.getByRole("button", { name: "Search articles", exact: true }).click();
      const search = page.getByRole("searchbox", { name: "Search articles" });
      const error = page.getByText("Use 300 characters or fewer.", { exact: true });
      const validQuery = "x".repeat(300);
      const invalidQuery = `${validQuery}x`;
      const attemptedSearches: string[] = [];
      page.on("request", (request) => {
        const { pathname, searchParams } = new URL(request.url());
        const query = searchParams.get("search");
        if (pathname === "/api/articles" && query !== null) attemptedSearches.push(query);
      });

      await search.fill(invalidQuery);
      await search.press("Enter");
      await error.waitFor();
      expect(await search.inputValue()).toBe(invalidQuery);
      expect(await search.getAttribute("aria-invalid")).toBe("true");

      await search.press("Backspace");
      expect(await search.inputValue()).toBe(validQuery);
      await error.waitFor({ state: "hidden" });
      const [response] = await Promise.all([
        page.waitForResponse((response) => {
          const { pathname, searchParams } = new URL(response.url());
          return pathname === "/api/articles" && searchParams.get("search") === validQuery;
        }),
        search.press("Enter"),
      ]);
      expect(response.status()).toBe(200);
      expect(attemptedSearches).toEqual([validQuery]);
    } finally {
      await page.close();
    }
  });

  it("confirms only the unread search matches older than the cutoff", async () => {
    const sample = seedReaderBacklog(database, "Filtered bulk read", 3);
    const titles = ["Target old", "Unrelated old", "Target recent"];
    database.feeds.completeSourceRefresh(sample.sourceId, {
      ...sample.refresh,
      parsed: {
        title: sample.feed.title,
        siteUrl: null,
        articles: sample.articles.map((article, index) => ({
          ...article,
          title: titles[index] ?? article.title,
          publishedAt: new Date(Date.now() - (index === 2 ? 0 : 172_800_000)).toISOString(),
        })),
      },
    });
    const page = await open("magazine");
    const path = `${origin}feeds/${sample.feed.id}/all`;
    const readTitles = () =>
      database.articles
        .listArticlePage(1, { feedId: sample.feed.id, state: "read" })
        .articles.map(({ title }) => title);
    try {
      await page.goto(`${path}?q=absent`);
      await page.getByText("No articles match “absent”", { exact: true }).waitFor();
      await markOlder(page);
      const feedback = await page
        .getByText(/^(No matching unread articles|Marked \d+ articles? as read)$/)
        .textContent();
      expect({ feedback, read: readTitles() }).toEqual({
        feedback: "No matching unread articles",
        read: [],
      });

      await page.goto(`${path}?q=target`);
      await page.getByRole("button", { name: "Open Target old", exact: true }).waitFor();
      expect(await confirmOlderRead(page, false)).toBe("Mark 1 article as read?");
      expect(readTitles()).toEqual([]);
      expect(await confirmOlderRead(page, true)).toBe("Mark 1 article as read?");
      await page.getByText("Marked 1 article as read", { exact: true }).waitFor();
      expect(readTitles()).toEqual(["Target old"]);
    } finally {
      await page.close();
    }
  });

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
      await page.setViewportSize({ width: 621, height: 900 });
      await page.goto(`${origin}feeds/${sample.feed.id}/unread`);
      await page
        .getByRole("button", { name: `Open ${sample.articles[0]?.title}`, exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Mark loaded articles as read", exact: true })
        .waitFor();
      expect(await confirmOlderRead(page, true)).toBe("Mark 3 articles as read?");
      await expect.poll(() => database.feeds.getFeed(1, sample.feed.id)?.unreadCount).toBe(0);
      await page.getByText("No unread articles", { exact: true }).waitFor();
      expect(await page.locator(".virtual-article-row").count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it.each([
    [320, "touch"],
    [320, "keyboard"],
    [620, "touch"],
    [620, "keyboard"],
  ] as const)("bulk marks articles from Reader options at %i px with %s", async (width, input) => {
    const sample = seedReaderBacklog(database, `Mobile bulk read ${width} ${input}`, 3);
    database.feeds.completeSourceRefresh(sample.sourceId, {
      ...sample.refresh,
      parsed: {
        title: sample.feed.title,
        siteUrl: null,
        articles: sample.articles.map((article, index) => ({
          ...article,
          publishedAt: new Date(
            Date.now() - (index === 2 ? 8 : index + 2) * 86_400_000,
          ).toISOString(),
        })),
      },
    });
    const mobileContext = await browser.newContext({
      baseURL: origin,
      storageState: await context.storageState(),
      viewport: { width, height: 640 },
      hasTouch: input === "touch",
      isMobile: true,
    });
    const page = await mobileContext.newPage();
    page.setDefaultTimeout(3000);
    const options = page.getByRole("button", { name: "Reader options", exact: true });
    const older = page.getByRole("menuitem", { name: "Mark older articles as read", exact: true });
    const loaded = page.getByRole("menuitem", {
      name: "Mark loaded articles as read",
      exact: true,
    });
    const week = page.getByRole("menuitem", { name: "Older than a week", exact: true });
    const ageRequest = Promise.withResolvers<void>();
    try {
      await page.goto(`${origin}feeds/${sample.feed.id}/unread`);
      await page.getByRole("button", { name: `Open ${sample.articles[0]?.title}` }).waitFor();
      if (input === "touch") {
        await options.tap();
        await older.tap();
      } else {
        await page.getByRole("button", { name: "Search articles", exact: true }).focus();
        await page.keyboard.press("Tab");
        await page.keyboard.press("Enter");
        await older.waitFor();
        await page.keyboard.press("End");
        await page.keyboard.press("ArrowRight");
      }
      await week.waitFor();
      expect(await page.getByRole("menuitem", { name: /^Older than / }).allTextContents()).toEqual([
        "Older than a day",
        "Older than two days",
        "Older than three days",
        "Older than a week",
        "Older than two weeks",
      ]);
      const confirmation = page.waitForEvent("dialog").then(async (dialog) => {
        const message = dialog.message();
        await dialog.accept();
        return message;
      });
      if (input === "touch") {
        await page.route(
          "**/api/articles/mark-read",
          async (route) => {
            await ageRequest.promise;
            await route.continue();
          },
          { times: 1 },
        );
        await week.tap();
        await options.tap();
        await loaded.waitFor();
        expect(await loaded.isDisabled()).toBe(true);
        expect(await older.isDisabled()).toBe(true);
        await options.tap();
        ageRequest.resolve();
      } else {
        await page.keyboard.press("End");
        await page.keyboard.press("ArrowUp");
        await page.keyboard.press("Enter");
      }
      expect(await confirmation).toBe("Mark 1 article as read?");
      await page.getByRole("button", { name: `Open ${sample.articles[2]?.title}` }).waitFor({
        state: "hidden",
      });
      const unreadTitles = () =>
        database.articles
          .listArticlePage(1, { feedId: sample.feed.id, state: "unread" })
          .articles.map((article) => article.title);
      expect(unreadTitles()).toEqual(sample.articles.slice(0, 2).map((article) => article.title));

      if (input === "touch") {
        await options.tap();
        await loaded.tap();
      } else {
        await page.keyboard.press("Enter");
        await loaded.waitFor();
        await page.keyboard.press("End");
        await page.keyboard.press("ArrowUp");
        await page.keyboard.press("Enter");
      }
      await page.getByText("Marked 2 articles as read", { exact: true }).waitFor();
      await expect.poll(unreadTitles).toEqual([]);
    } finally {
      ageRequest.resolve();
      await mobileContext.close();
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
