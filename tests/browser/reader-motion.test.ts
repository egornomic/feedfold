import { describe, expect, it } from "vitest";
import { backlog, browser, context, database, open, origin } from "./reader-browser-fixture.js";

async function openTouchReader(
  index = 3,
  reducedMotion: "reduce" | "no-preference" = "no-preference",
  cpuSlowdown = 1,
) {
  const touchContext = await browser.newContext({
    baseURL: origin,
    storageState: await context.storageState(),
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    reducedMotion,
  });
  const page = await touchContext.newPage();
  page.setDefaultTimeout(5000);
  await page.goto(`${origin}feeds/${backlog.feed.id}/all`);
  await page.getByRole("button", { name: "Reader options", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Magazine", exact: true }).click();
  await page.locator(".article-open-button").nth(index).click();
  await page.locator(".article-swipe-layer.is-active .article-content").waitFor();
  const session = await touchContext.newCDPSession(page);
  await session.send("Emulation.setCPUThrottlingRate", { rate: cpuSlowdown });
  const touch = async (
    type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel",
    x = 0,
    y = 450,
  ) => {
    await session.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" || type === "touchCancel" ? [] : [{ x, y, id: 1 }],
    });
  };
  const swipe = async (from: number, to: number, cancelled = false) => {
    await touch("touchStart", from);
    for (let step = 1; step <= 6; step++) {
      await touch("touchMove", from + ((to - from) * step) / 6);
      await page.waitForTimeout(16);
    }
    await touch(cancelled ? "touchCancel" : "touchEnd");
  };
  const title = () =>
    page.locator(".article-swipe-layer.is-active .article-header h2").textContent();
  const settled = async () => {
    await expect.poll(() => page.locator(".article-swipe-layer").count()).toBe(1);
    await expect
      .poll(() =>
        page
          .locator(".article-swipe-layer.is-active")
          .evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m41),
      )
      .toBe(0);
  };
  return { page, touchContext, touch, swipe, title, settled };
}

describe("reader motion with touch input and the live API", () => {
  it("scrolls wide equations without navigating away from the article", async () => {
    const articleId = 5;
    const originalHtml = database.articles.getArticle(1, articleId)?.feedContentHtml;
    database.connection
      .prepare("UPDATE articles SET feed_content_html = ? WHERE id = ?")
      .run(
        String.raw`<p>\[\sum_{i=1}^{n} x_i = x_1 + x_2 + x_3 + x_4 + x_5 + x_6 + x_7 + x_8 + x_9 + x_{10}\]</p>`,
        articleId,
      );
    const { page, touchContext, touch, title, settled } = await openTouchReader(articleId - 1);
    try {
      const originalTitle = await title();
      const equation = page.locator(".article-swipe-layer.is-active .katex-display");
      const box = await equation.boundingBox();
      if (!box) throw new Error("The equation is missing");
      const x = box.x + box.width - 10;
      const y = box.y + box.height / 2;
      await touch("touchStart", x, y);
      for (let step = 1; step <= 6; step++) {
        await touch("touchMove", x - step * 30, y);
        await page.waitForTimeout(16);
      }
      await touch("touchEnd");
      await settled();
      expect(await title()).toBe(originalTitle);
      await expect
        .poll(() => equation.evaluate((element) => element.scrollLeft))
        .toBeGreaterThan(0);
    } finally {
      await touchContext.close();
      database.connection
        .prepare("UPDATE articles SET feed_content_html = ? WHERE id = ?")
        .run(originalHtml, articleId);
    }
  });

  it.each([1, 6])(
    "restores cancelled and boundary swipes, then navigates and reverses without losing a visible page (%ix CPU slowdown)",
    async (cpuSlowdown) => {
      const { page, touchContext, touch, swipe, title, settled } = await openTouchReader(
        0,
        "no-preference",
        cpuSlowdown,
      );
      try {
        const original = await title();
        await swipe(320, 130, true);
        await settled();
        expect(await title()).toBe(original);
        await swipe(100, 280);
        await settled();
        expect(await title()).toBe(original);
        await swipe(320, 130);
        await expect.poll(title).toContain("0001");
        await touch("touchStart", 110);
        // A finger resting on an entering page must not discard its visible neighbour.
        const pages = await page.locator(".article-swipe-layer").evaluateAll((elements) =>
          elements.map((element) => {
            const rect = element.getBoundingClientRect();
            return { left: rect.left, right: rect.right };
          }),
        );
        const [outgoing, incoming] = pages.sort((a, b) => a.left - b.left);
        if (!outgoing || !incoming) throw new Error("A visible article disappeared during entry");
        expect(Math.abs(outgoing.right - incoming.left)).toBeLessThan(1);
        for (const x of [140, 170, 200, 230, 260]) {
          await touch("touchMove", x);
          await page.waitForTimeout(16);
        }
        await touch("touchEnd");
        await expect.poll(title).toBe(original);
        await settled();
      } finally {
        await touchContext.close();
      }
    },
  );

  it("accepts repeated navigation and a keyboard interruption, with actions applying to the visible article", async () => {
    const { page, touchContext, swipe, title, settled } = await openTouchReader();
    try {
      await swipe(320, 140);
      await expect.poll(title).toContain("0004");
      await swipe(320, 140);
      await expect.poll(title).toContain("0005");
      await page.keyboard.press("j");
      await expect.poll(title).toContain("0006");
      await settled();
      await page.keyboard.press("s");
      await expect.poll(() => database.articles.getArticle(1, 7)?.isStarred).toBe(true);
      await page.keyboard.press("k");
      await expect.poll(title).toContain("0005");
    } finally {
      await touchContext.close();
    }
  });

  it("keeps reduced-motion swipes stationary and preserves vertical scrolling and selected text", async () => {
    const { page, touchContext, touch, swipe, title, settled } = await openTouchReader(8, "reduce");
    try {
      const original = await title();
      await touch("touchStart", 200, 680);
      for (const y of [630, 580, 530, 480, 430, 380]) {
        await touch("touchMove", 200, y);
        await page.waitForTimeout(16);
      }
      await touch("touchEnd");
      await expect
        .poll(() =>
          page.locator(".article-swipe-layer.is-active").evaluate((element) => element.scrollTop),
        )
        .toBeGreaterThan(0);
      expect(await title()).toBe(original);
      await touch("touchStart", 320);
      await touch("touchMove", 230);
      await page.waitForTimeout(32);
      expect(
        await page
          .locator(".article-swipe-layer.is-active")
          .evaluate((element) => getComputedStyle(element).transform),
      ).toBe("none");
      await touch("touchCancel");
      await settled();
      const selected = await page
        .locator(".article-swipe-layer.is-active .article-content p")
        .first()
        .evaluate((element) => {
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(element);
          selection?.removeAllRanges();
          selection?.addRange(range);
          return selection?.toString();
        });
      expect(selected?.length).toBeGreaterThan(0);
      await swipe(320, 120);
      expect(await title()).toBe(original);
      await page.evaluate(() => window.getSelection()?.removeAllRanges());
      await swipe(320, 120);
      await expect.poll(title).toContain("0009");
      await settled();
    } finally {
      await touchContext.close();
    }
  });

  it("closes dialogs during entry and restores usable keyboard controls on each reopening", async () => {
    const page = await open("magazine");
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        await page
          .getByRole("button", { name: "Open keyboard shortcut reference (?)", exact: true })
          .click();
        await page.getByRole("button", { name: "Close shortcuts", exact: true }).waitFor();
        await page
          .getByRole("button", { name: "Close shortcuts", exact: true })
          .click({ force: true });
        await page.locator(".shortcut-dialog").waitFor({ state: "detached" });
      }
      await page.keyboard.press("?");
      await page.getByRole("heading", { name: "Keyboard shortcuts", exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await page.locator(".shortcut-dialog").waitFor({ state: "detached" });
      await page.keyboard.press("j");
      await expect
        .poll(() => page.locator(".article-swipe-layer.is-active h2").textContent())
        .toContain("0000");
      expect(await page.locator(".dialog-backdrop").count()).toBe(0);
    } finally {
      await page.close();
    }
  });
});

it("swipes across an article image without opening it and still opens the image on a tap", async () => {
  const { page, touchContext, touch, title, settled } = await openTouchReader(0);
  try {
    const image = page.locator("[data-image-lightbox-trigger]").first();
    await image.scrollIntoViewIfNeeded();
    const bounds = await image.boundingBox();
    if (!bounds) throw new Error("Expected a visible article image");
    const y = Math.min(700, bounds.y + bounds.height / 2);
    await touch("touchStart", 300, y);
    for (const x of [270, 240, 210, 180, 150]) {
      await touch("touchMove", x, y);
      await page.waitForTimeout(16);
    }
    await touch("touchEnd");
    await expect.poll(title).toContain("0001");
    await settled();
    expect(await page.locator(".image-lightbox").count()).toBe(0);
    await page.keyboard.press("k");
    await expect.poll(title).toContain("0000");
    await image.tap();
    await page.locator(".image-lightbox").waitFor();
    await page.keyboard.press("Escape");
    await page.locator(".image-lightbox").waitFor({ state: "detached" });
  } finally {
    await touchContext.close();
  }
});

it("interrupts a summary entrance with keyboard toggles without stale text or shifted reading content", async () => {
  const id = 4;
  const { revision } = database.connection
    .prepare("SELECT content_revision AS revision FROM articles WHERE id = ?")
    .get(id) as { revision: number };
  database.ai.saveArticleAiSummary(1, id, revision, {
    promptVersion: 1,
    promptId: null,
    sourceKind: "feed",
    provider: "openai",
    model: "saved-summary",
    text: "A cached summary for repeated opening.",
    usage: { inputTokens: 20, outputTokens: 20 },
  });
  const { page, touchContext } = await openTouchReader(3);
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.getByRole("button", { name: "Choose an AI action", exact: true }).click();
      await page.getByRole("menuitem", { name: "Summarize", exact: true }).click();
      await page.getByText("A cached summary for repeated opening.", { exact: true }).waitFor();
      await page.keyboard.press("m");
      await page.locator(".article-ai-summary").waitFor({ state: "detached" });
      await page.keyboard.press("m");
      await page.getByText("A cached summary for repeated opening.", { exact: true }).waitFor();
      await page.keyboard.press("m");
      await page.locator(".article-ai-summary").waitFor({ state: "detached" });
    }
    expect(
      await page.locator(".article-reading-flow").evaluate(async (element) => {
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        return getComputedStyle(element).transform;
      }),
    ).toBe("none");
    expect(await page.locator(".summary-action").getAttribute("aria-pressed")).toBe("false");
  } finally {
    await touchContext.close();
  }
});
