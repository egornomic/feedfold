import { describe, expect, it } from "vitest";
import { seedReaderBacklog } from "../helpers/reader-backlog.js";
import {
  anchor,
  backlog,
  bottom,
  database,
  desktop,
  desktopAppPath,
  open,
  origin,
  other,
  settle,
  surface,
} from "./reader-browser-fixture.js";

describe(`${desktopAppPath ? "desktop" : "browser"} virtual reading with a populated database`, () => {
  for (const mode of ["magazine", "expanded"] as const) {
    for (const count of [1, 3]) {
      it.each([true, false])(
        `${mode}: scrolls past the last of ${count} posts with automatic reading set to %s`,
        async (markReadOnScroll) => {
          const sample = seedReaderBacklog(
            database,
            `Short queue ${mode} ${count} ${markReadOnScroll}`,
            count,
          );
          database.feeds.completeSourceRefresh(sample.sourceId, {
            ...sample.refresh,
            parsed: {
              title: sample.feed.title,
              siteUrl: null,
              articles: sample.articles.map((article) => ({
                ...article,
                feedContentHtml: "<p>A short post.</p>",
              })),
            },
          });
          database.settings.updateSettings(1, { markReadOnScroll });
          const page = await open(mode);
          const unreadCount = async () => {
            const response = await page.request.get(
              `/api/articles?feedId=${sample.feed.id}&state=unread`,
            );
            expect(response.status()).toBe(200);
            return (await response.json()).articles.length;
          };
          try {
            await page.goto(`${origin}feeds/${sample.feed.id}/unread`);
            await page
              .locator('.reading-workspace[aria-busy="false"] .virtual-article-row')
              .first()
              .waitFor();
            await settle(page);
            expect(await unreadCount()).toBe(count);
            if (count === 1) {
              for (const view of [
                mode === "magazine" ? "Expanded view" : "Magazine view",
                mode === "magazine" ? "Magazine view" : "Expanded view",
              ])
                await page.getByRole("button", { name: view, exact: true }).click();
              await page.locator(`.reading-workspace.mode-${mode}[aria-busy="false"]`).waitFor();
              const readButton = page.locator(
                mode === "magazine"
                  ? ".list-read-button"
                  : '.expanded-actions [aria-label^="Mark as"]',
              );
              await readButton.click();
              await expect.poll(unreadCount).toBe(0);
              await readButton.click();
              await expect.poll(unreadCount).toBe(1);
            } else {
              // Reaching the end without user input must not mark posts as read.
              await bottom(page);
              await page.waitForTimeout(400);
              expect(await unreadCount()).toBe(count);
              await surface(page).evaluate((element) => {
                element.scrollTop = 0;
              });
            }
            await settle(page);
            const box = await surface(page).boundingBox();
            if (!box) throw new Error("No scrolling surface");
            const lastBottom = await page
              .locator(".virtual-article-row")
              .last()
              .evaluate(
                (element) =>
                  element.getBoundingClientRect().bottom -
                  (element.closest("[data-virtuoso-scroller]")?.getBoundingClientRect().top ?? 0),
              );
            await page.mouse.move(box.x + box.width / 2, box.y + 100);
            await page.mouse.wheel(0, lastBottom - 2);
            await settle(page);
            for (let step = 0; step < 4; step++) {
              await page.mouse.wheel(0, 1);
              await settle(page);
            }
            await expect
              .poll(() => surface(page).evaluate((element) => element.scrollTop))
              .toBeGreaterThanOrEqual(lastBottom);
            if (markReadOnScroll) await expect.poll(unreadCount).toBe(0);
            else {
              await page.waitForTimeout(400);
              expect(await unreadCount()).toBe(count);
            }
          } finally {
            await page.close();
            database.settings.updateSettings(1, { markReadOnScroll: true });
          }
        },
      );
    }

    it(`${mode}: loads pages with bounded DOM, retries failure, and searches unmounted article bodies`, async () => {
      const page = await open(mode);
      try {
        expect(await page.locator(".virtual-article-row").count()).toBeLessThan(25);
        const scrolling = await surface(page).evaluate(async (element) => {
          const frames: Array<{ elapsed: number; rows: number; visible: boolean }> = [];
          let detachedFrames = 0;
          let previous = performance.now();
          for (let index = 0; index < 60; index++) {
            await new Promise(requestAnimationFrame);
            const now = performance.now();
            if (!element.isConnected) detachedFrames++;
            const viewport = element.getBoundingClientRect();
            const rows = [...element.querySelectorAll(".virtual-article-row")];
            frames.push({
              elapsed: now - previous,
              rows: rows.length,
              visible: rows.some((row) => {
                const bounds = row.getBoundingClientRect();
                return bounds.bottom > viewport.top && bounds.top < viewport.bottom;
              }),
            });
            element.scrollTop += 80;
            previous = now;
          }
          element.scrollTop = 0;
          return {
            detachedFrames,
            blankFrames: frames.filter((frame) => !frame.visible).length,
            maxRows: Math.max(...frames.map((frame) => frame.rows)),
            p95Milliseconds: frames.map((frame) => frame.elapsed).sort((a, b) => a - b)[56],
          };
        });
        expect(scrolling).toMatchObject({ blankFrames: 0, detachedFrames: 0 });
        expect(scrolling.maxRows).toBeLessThan(25);
        if (process.env.FEEDFOLD_READER_METRICS) console.info(mode, scrolling);
        let fail = true;
        let failures = 0;
        if (desktop)
          await desktop.evaluate(({ ipcMain }) => {
            const handlers = (
              ipcMain as unknown as {
                _invokeHandlers: Map<
                  string,
                  (
                    event: unknown,
                    request: { operation: string; payload?: { cursor?: string } },
                  ) => unknown
                >;
              }
            )._invokeHandlers;
            const original = handlers.get("feedfold:invoke");
            if (!original) throw new Error("Missing application IPC handler");
            const state = { fail: true, failures: 0 };
            Object.assign(globalThis, { paginationFailure: state });
            handlers.set("feedfold:invoke", (event, request) => {
              if (state.fail && request.operation === "articles" && request.payload?.cursor) {
                state.failures++;
                return original(event, {
                  ...request,
                  payload: { ...request.payload, cursor: "invalid-test-cursor" },
                });
              }
              return original(event, request);
            });
          });
        await page.route("**/api/articles?**", async (route) => {
          if (fail && new URL(route.request().url()).searchParams.has("cursor")) {
            failures++;
            await route.fulfill({
              status: 400,
              contentType: "application/json",
              body: JSON.stringify({ error: "Page temporarily unavailable" }),
            });
          } else await route.continue();
        });
        await bottom(page);
        await page.getByRole("button", { name: "Try loading more articles again" }).waitFor();
        await settle(page);
        if (desktop)
          failures = await desktop.evaluate(
            () =>
              (globalThis as unknown as { paginationFailure: { failures: number } })
                .paginationFailure.failures,
          );
        expect(failures).toBe(1);
        fail = false;
        if (desktop)
          await desktop.evaluate(() => {
            (
              globalThis as unknown as { paginationFailure: { fail: boolean } }
            ).paginationFailure.fail = false;
          });
        const height = await surface(page).evaluate((element) => element.scrollHeight);
        await page.getByRole("button", { name: "Try loading more articles again" }).click();
        await expect
          .poll(() => surface(page).evaluate((element) => element.scrollHeight))
          .toBeGreaterThan(height);
        for (let index = 0; index < 5; index++) {
          await bottom(page);
          await settle(page);
        }
        expect(await page.locator(".virtual-article-row").count()).toBeLessThan(25);
        await page.keyboard.press("ControlOrMeta+f");
        await page.getByRole("searchbox", { name: "Search articles" }).fill("bodyneedle1199");
        await page.getByRole("searchbox", { name: "Search articles" }).press("Enter");
        await page
          .locator(mode === "expanded" ? ".article-header h2" : ".article-list-title")
          .filter({ hasText: "Virtualization backlog 1199" })
          .waitFor();
        expect(await page.locator(".virtual-article-row").count()).toBe(1);
      } finally {
        await page.close();
      }
    }, 20_000);

    it(`${mode}: starts at the top without a selection after visiting another feed`, async () => {
      const page = await open(mode);
      try {
        await surface(page).evaluate((element) => {
          element.scrollTop = 3500;
        });
        await settle(page);
        expect(await surface(page).evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
        await page
          .getByRole("button", { name: new RegExp(`Feed health: Paused ${other.feed.title}`) })
          .click();
        await page.getByRole("heading", { name: other.feed.title, exact: true }).waitFor();
        expect(await page.locator(".virtual-article-row .is-active").count()).toBe(0);
        expect(await surface(page).evaluate((element) => element.scrollTop)).toBe(0);
        await page.goBack();
        await page.getByRole("heading", { name: backlog.feed.title, exact: true }).waitFor();
        await settle(page);
        expect(await page.locator(".virtual-article-row .is-active").count()).toBe(0);
        expect(await surface(page).evaluate((element) => element.scrollTop)).toBe(0);
      } finally {
        await page.close();
      }
    });

    it(`${mode}: unmounting unseen rows does not read them; intentional scrolling reads passed rows`, async () => {
      database.connection
        .prepare("UPDATE feed_articles SET is_read = 0 WHERE feed_id = ?")
        .run(backlog.feed.id);
      const page = await open(mode);
      try {
        const first = Number(
          await page.locator(".virtual-article-row").first().getAttribute("data-article-id"),
        );
        await surface(page).evaluate((element) => {
          element.scrollTop = 4000;
        });
        await settle(page);
        expect(database.articles.getArticle(1, first)?.isRead).toBe(false);
        await surface(page).evaluate((element) => {
          element.scrollTop = 0;
        });
        await settle(page);
        const box = await surface(page).boundingBox();
        if (!box) throw new Error("No scrolling surface");
        await page.mouse.move(box.x + box.width / 2, box.y + 200);
        const height = await page
          .locator(".virtual-article-row")
          .first()
          .evaluate((element) => element.getBoundingClientRect().height);
        await page.mouse.wheel(0, height + 200);
        await settle(page);
        await expect.poll(() => database.articles.getArticle(1, first)?.isRead).toBe(true);
      } finally {
        await page.close();
      }
    });
  }

  for (const mode of ["magazine", "expanded"] as const) {
    it(`${mode}: preserves the viewport during delivery and shows new articles at the top after feed switches`, async () => {
      const page = await open(mode);
      try {
        await surface(page).evaluate((element) => {
          element.scrollTop = 3500;
        });
        await settle(page);
        const before = await anchor(page);
        database.articles.updateArticleState(1, Number(before.id), { isSaved: true });
        database.feeds.updateFeed(1, backlog.feed.id, { paused: false });
        const firstArticle = backlog.articles[0];
        if (!firstArticle) throw new Error("The populated backlog must have an article");
        database.feeds.completeSourceRefresh(backlog.sourceId, {
          ...backlog.refresh,
          parsed: {
            title: backlog.feed.title,
            siteUrl: null,
            articles: [
              {
                ...firstArticle,
                externalId: `new-${mode}`,
                title: `New delivery ${mode}`,
                url: `https://example.test/new-${mode}`,
                publishedAt: new Date().toISOString(),
              },
            ],
          },
        });
        database.feeds.updateFeed(1, backlog.feed.id, { paused: true });
        await page.evaluate(() => window.dispatchEvent(new Event("online")));
        await expect
          .poll(() =>
            page.locator(`[data-article-id="${before.id}"] [aria-pressed="true"]`).count(),
          )
          .toBeGreaterThan(0);
        const after = await anchor(page);
        expect(after.id).toBe(before.id);
        expect(Math.abs(after.top - before.top)).toBeLessThan(2);
        for (let i = 0; i < 3; i++) {
          await page
            .getByRole("button", { name: new RegExp(`Feed health: Paused ${other.feed.title}`) })
            .click();
          await page
            .getByRole("button", { name: new RegExp(`Feed health: Paused ${backlog.feed.title}`) })
            .click();
        }
        await expect
          .poll(() => page.locator(".reading-workspace").getAttribute("aria-busy"))
          .toBe("false");
        await expect
          .poll(() => page.locator(".reader-toolbar h1").textContent())
          .toBe(backlog.feed.title);
        expect(await page.locator(".virtual-article-row").count()).toBeLessThan(25);
        await expect
          .poll(() => page.locator(".virtual-article-row").allTextContents())
          .toEqual(expect.arrayContaining([expect.stringContaining(backlog.feed.title)]));
        await settle(page);
        expect(await surface(page).evaluate((element) => element.scrollTop)).toBe(0);
        expect(await page.locator(".virtual-article-row .is-active").count()).toBe(0);
        expect(await page.locator(".virtual-article-row").first().textContent()).toContain(
          `New delivery ${mode}`,
        );
      } finally {
        await page.close();
        database.connection
          .prepare("DELETE FROM articles WHERE source_id = ? AND external_id = ?")
          .run(backlog.sourceId, `new-${mode}`);
      }
    });
  }
});
