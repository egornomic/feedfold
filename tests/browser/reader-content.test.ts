import { describe, expect, it } from "vitest";
import { seedReaderBacklog } from "../helpers/reader-backlog.js";
import {
  database,
  delayedImage,
  desktopAppPath,
  open,
  origin,
  settle,
  surface,
} from "./reader-browser-fixture.js";

describe(`${desktopAppPath ? "desktop" : "browser"} virtual reading with a populated database`, () => {
  it("loads equations on demand without blocking navigation while the renderer downloads", async () => {
    const sample = seedReaderBacklog(database, "On-demand equations", 2);
    const articles = database.articles.listArticlePage(1, {
      feedId: sample.feed.id,
      state: "all",
    }).articles;
    const [plain, formula] = articles;
    if (!plain || !formula) throw new Error("Equation fixture is incomplete");
    const update = database.connection.prepare(
      "UPDATE articles SET feed_content_html = ? WHERE id = ?",
    );
    update.run(
      String.raw`<p>Ordinary prose costs $5.</p><pre><code>\(code\) $$example$$</code></pre>`,
      plain.id,
    );
    update.run(String.raw`<p>An equation: \(E = mc^2\).</p>`, formula.id);
    const page = await open("magazine");
    const requests: string[] = [];
    let release = () => {};
    const download = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(/katex|auto-render/, async (route) => {
      requests.push(route.request().url());
      await download;
      await route.continue();
    });
    try {
      await page.goto(`${origin}feeds/${sample.feed.id}/all`);
      await page.getByRole("button", { name: `Open ${plain.title}`, exact: true }).click();
      const content = page.locator(".article-swipe-layer.is-active .article-content");
      await content.locator("pre").waitFor();
      expect(requests).toHaveLength(0);
      expect(await content.textContent()).toContain("Ordinary prose costs $5.");
      await page.getByRole("button", { name: "Next article (J)", exact: true }).click();
      await expect.poll(() => requests.length).toBeGreaterThan(0);
      expect(await content.textContent()).toContain(String.raw`\(E = mc^2\)`);
      await page.getByRole("button", { name: "Previous article (K)", exact: true }).click();
      await content.locator("pre").waitFor();
      release();
      await page.getByRole("button", { name: "Next article (J)", exact: true }).click();
      await content.locator("math").waitFor();
      expect(await content.locator("annotation").textContent()).toBe("E = mc^2");
      await page.getByRole("button", { name: "Previous article (K)", exact: true }).click();
      await content.locator("pre").waitFor();
      expect(await content.locator("math").count()).toBe(0);
      expect(await content.locator("code").textContent()).toBe(String.raw`\(code\) $$example$$`);
    } finally {
      release();
      await page.close();
    }
  });

  for (const update of ["full text", "AI summary"] as const) {
    it(`keeps the next article heading steady after loading ${update} above it`, async () => {
      const id = 4;
      database.connection
        .prepare(
          "UPDATE articles SET content_html = ?, extraction_status = 'complete' WHERE id = ?",
        )
        .run("<p>Expanded article text.</p>".repeat(30), id);
      const revision = (
        database.connection
          .prepare("SELECT content_revision AS revision FROM articles WHERE id = ?")
          .get(id) as { revision: number }
      ).revision;
      database.ai.saveArticleAiSummary(1, id, revision, {
        promptVersion: 1,
        promptId: null,
        sourceKind: "feed",
        provider: "openai",
        model: "saved-summary",
        text: `## Cached summary\n\n${"A saved summary paragraph.\n\n".repeat(20)}`,
        usage: { inputTokens: 20, outputTokens: 20 },
      });
      const page = await open("expanded");
      try {
        for (let activeId = 1; activeId <= id; activeId++) {
          await page.keyboard.press("j");
          await expect
            .poll(() =>
              page
                .locator(".expanded-article.is-active")
                .locator("..")
                .getAttribute("data-article-id"),
            )
            .toBe(String(activeId));
        }
        const next = page.locator(`[data-article-id="${id + 1}"] h2`);
        await next.evaluate(async (element) => {
          element.scrollIntoView({ block: "start" });
          await new Promise(requestAnimationFrame);
          await new Promise(requestAnimationFrame);
        });
        const before = await next.evaluate((element) => element.getBoundingClientRect().top);
        await page.keyboard.press(update === "full text" ? "w" : "m");
        const changedArticle = page.locator(`[data-article-id="${id}"]`);
        await expect
          .poll(
            () =>
              changedArticle
                .getByText(
                  update === "full text" ? "Expanded article text." : "A saved summary paragraph.",
                  { exact: true },
                )
                .count(),
            { timeout: 5000 },
          )
          .toBe(update === "full text" ? 30 : 20);
        // Content rendering and the observer's scroll correction finish in separate frames.
        await expect
          .poll(async () =>
            Math.abs(
              (await next.evaluate((element) => element.getBoundingClientRect().top)) - before,
            ),
          )
          .toBeLessThan(2);
      } finally {
        await page.close();
      }
    });
  }

  it("keeps native and embedded players alive while scrolling away and back", async () => {
    const page = await open("expanded");
    try {
      const video = page.locator(".article-content video").first();
      const handle = await video.elementHandle();
      await video.evaluate(async (element: HTMLVideoElement) => {
        element.muted = true;
        await element.play();
      });
      await expect
        .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
        .toBeGreaterThan(0);
      const start = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
      await page.locator(".article-media-player iframe").click();
      const frameElement = await page.locator(".article-media-player iframe").elementHandle();
      const frame = await frameElement?.contentFrame();
      if (!frame) throw new Error("Missing embedded player");
      await frame.locator("video").evaluate(async (element: HTMLVideoElement) => {
        element.muted = true;
        await element.play();
      });
      await expect
        .poll(() =>
          frame.locator("video").evaluate((element: HTMLVideoElement) => element.currentTime),
        )
        .toBeGreaterThan(0);
      await surface(page).evaluate((element) => {
        element.scrollTop = 14000;
      });
      await settle(page);
      expect(
        await handle?.evaluate((element: HTMLVideoElement) => ({
          connected: element.isConnected,
          paused: element.paused,
          playing: element.currentTime > 0,
        })),
      ).toEqual({ connected: true, paused: false, playing: true });
      expect(await frameElement?.evaluate((element) => element.isConnected)).toBe(true);
      const timeAway = await frame
        .locator("video")
        .evaluate((element: HTMLVideoElement) => element.currentTime);
      await surface(page).evaluate((element) => {
        element.scrollTop = 0;
      });
      await settle(page);
      expect(
        await video.evaluate((element: HTMLVideoElement) => element.currentTime),
      ).toBeGreaterThan(start);
      expect(
        await frame.locator("video").evaluate((element: HTMLVideoElement) => element.currentTime),
      ).toBeGreaterThan(timeAway);
      expect(await page.locator(".virtual-article-row").count()).toBeLessThan(25);
    } finally {
      await page.close();
    }
  });

  it("holds the visible paragraph steady when a delayed image above it loads", async () => {
    delayedImage.held = true;
    const page = await open("expanded");
    try {
      const paragraph = page.locator(".article-content p").first();
      await paragraph.evaluate((element) => element.scrollIntoView({ block: "start" }));
      await settle(page);
      const before = await paragraph.evaluate((element) => element.getBoundingClientRect().top);
      delayedImage.release();
      delayedImage.held = false;
      await expect
        .poll(() =>
          page
            .locator(".article-content img")
            .first()
            .evaluate((image: HTMLImageElement) => image.naturalHeight),
        )
        .toBe(600);
      await settle(page);
      const after = await paragraph.evaluate((element) => element.getBoundingClientRect().top);
      expect(Math.abs(after - before)).toBeLessThan(2);
    } finally {
      delayedImage.release();
      delayedImage.held = false;
      await page.close();
    }
  });

  it("keeps a text selection attached while its article leaves and reenters the rendered range", async () => {
    const page = await open("expanded");
    try {
      const text = await page
        .locator(".article-content p")
        .first()
        .evaluate((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          window.getSelection()?.removeAllRanges();
          window.getSelection()?.addRange(range);
          return window.getSelection()?.toString();
        });
      await settle(page);
      await surface(page).evaluate((element) => {
        element.scrollTop = 9000;
      });
      await settle(page);
      expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(text);
      expect(await page.locator(".virtual-article-row").count()).toBeLessThan(25);
      await surface(page).evaluate((element) => {
        element.scrollTop = 0;
      });
      await settle(page);
      expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(text);
    } finally {
      await page.close();
    }
  });
});
