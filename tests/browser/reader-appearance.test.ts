import type { Page } from "playwright";
import { expect, it } from "vitest";
import { context, open } from "./reader-browser-fixture.js";

function appearance(page: Page) {
  return page
    .locator(".brand-logo")
    .first()
    .evaluate((logo) => ({
      theme: document.documentElement.dataset.theme,
      palette: document.documentElement.dataset.palette,
      background: getComputedStyle(document.body).backgroundColor,
      logo: getComputedStyle(logo).color,
      browserColor: document.querySelector('meta[name="theme-color"]')?.getAttribute("content"),
    }));
}

it.each([
  { theme: "light", palette: "sand", device: "dark" },
  { theme: "dark", palette: "codex", device: "light" },
  { theme: "auto", palette: "slate", device: "light" },
  { theme: "auto", palette: "sand", device: "dark" },
] as const)(
  "keeps $theme / $palette during session loading on a $device device",
  async (choice) => {
    const page = await open("magazine");
    let release = () => {};
    try {
      await page.emulateMedia({ colorScheme: choice.device });
      await page.goto("/settings");
      await page.getByRole("button", { name: new RegExp(`^${choice.theme}$`, "i") }).click();
      const mode = choice.theme === "auto" ? choice.device : choice.theme;
      await page
        .locator(`.color-palette-preview[data-theme="${mode}"][data-palette="${choice.palette}"]`)
        .click();
      const reader = await appearance(page);
      expect(reader.theme).toBe(mode);
      expect(reader.palette).toBe(choice.palette);

      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route("**/api/auth/session", async (route) => {
        await held;
        await route.continue();
      });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator(".session-loading .brand-logo.is-loading").waitFor();
      const loading = await appearance(page);
      expect(loading).toEqual(reader);
      if (choice.theme === "auto") {
        const oppositeMode = choice.device === "light" ? "dark" : "light";
        await page.emulateMedia({ colorScheme: oppositeMode });
        await expect.poll(async () => (await appearance(page)).theme).toBe(oppositeMode);
        expect((await appearance(page)).browserColor).toBe((await appearance(page)).background);
      }
      release();
      await page.locator(".settings-page").waitFor();
      expect((await context.request.get("/api/auth/session")).status()).toBe(200);
    } finally {
      release();
      await page.close();
    }
  },
);
