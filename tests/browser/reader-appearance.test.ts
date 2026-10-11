import type { Page } from "playwright";
import { expect, it } from "vitest";
import { AuthService } from "../../src/server/features/auth/service.js";
import { browser, context, database, open, origin } from "./reader-browser-fixture.js";

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

it("forgets the deleted account's appearance on the next startup", async () => {
  const account = await browser.newContext({ baseURL: origin });
  try {
    const auth = new AuthService(database.auth, 20, { maxAccounts: 2 });
    await auth.register("appearance-deletion", "appearance-password");
    const login = await account.request.post("/api/auth/login", {
      data: { username: "appearance-deletion", password: "appearance-password" },
    });
    expect(login.status()).toBe(200);
    const page = await account.newPage();
    page.setDefaultTimeout(5000);
    await page.goto("/settings");
    await page.locator(".settings-page").waitFor();
    const defaults = await appearance(page);
    await page.getByRole("button", { name: "Light", exact: true }).click();
    await page
      .getByRole("radiogroup", { name: "Light theme", exact: true })
      .getByRole("radio", { name: "Sand", exact: true })
      .check();
    expect((await appearance(page)).palette).toBe("sand");

    await page.getByRole("tab", { name: "Account", exact: true }).click();
    await page.getByRole("button", { name: "Delete account", exact: true }).click();
    const deletion = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/auth/account") && response.request().method() === "DELETE",
    );
    await page
      .getByRole("dialog", { name: "Delete account", exact: true })
      .getByRole("button", { name: "Delete account", exact: true })
      .click();
    expect((await deletion).status()).toBe(204);
    await page.locator(".homepage").waitFor();
    expect((await account.request.get("/api/auth/session")).status()).toBe(401);

    await page.reload();
    await page.locator(".homepage").waitFor();
    expect(await appearance(page)).toEqual(defaults);
  } finally {
    await account.close();
  }
});
