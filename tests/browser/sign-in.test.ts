import { expect, it } from "vitest";
import { browser, origin } from "./reader-browser-fixture.js";

it("shows a failed sign-in and signs in after a retry", async () => {
  const visitor = await browser.newContext({ baseURL: origin });
  try {
    const page = await visitor.newPage();
    page.setDefaultTimeout(3000);
    await page.goto("/");
    await page.getByRole("button", { name: "i'm in", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Sign in", exact: true });
    await dialog.getByRole("textbox", { name: "Username", exact: true }).fill("virtual-reader");
    await dialog.locator("#auth-password").fill("not-the-password");
    await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
    await dialog.getByRole("alert").waitFor();

    expect(await dialog.getByRole("button", { name: "Sign in", exact: true }).isEnabled()).toBe(
      true,
    );
    await dialog.locator("#auth-password").fill("reader-password");
    await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.locator(".reader-toolbar").waitFor();
  } finally {
    await visitor.close();
  }
});
