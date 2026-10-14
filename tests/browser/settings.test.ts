import type { Page } from "playwright";
import { expect, it } from "vitest";
import { AuthService } from "../../src/server/features/auth/service.js";
import type { AppSettings, BootstrapData } from "../../src/shared/types.js";
import { browser, context, database, origin } from "./reader-browser-fixture.js";

async function refreshSettings(page: Page, check: (data: BootstrapData) => boolean) {
  const refreshed = page.waitForEvent("requestfinished", async (request) => {
    if (!request.url().endsWith("/api/bootstrap")) return false;
    const response = await request.response();
    return response?.ok() ? check((await response.json()) as BootstrapData) : false;
  });
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await refreshed;
  // Let React apply the response before checking the draft.
  await page.evaluate(() => new Promise(requestAnimationFrame));
}

async function updateSettings(change: Partial<AppSettings>) {
  const response = await context.request.patch("/api/settings", { data: change });
  expect(response.status()).toBe(200);
  return (await response.json()) as AppSettings;
}

it.each(["gemini", "openai"] as const)(
  "refreshes untouched AI fields when another tab saves a %s model",
  async (provider) => {
    const initial = await context.request.patch("/api/ai/features/article_summary", {
      data: { provider: "gemini", model: "initial-model" },
    });
    expect(initial.status()).toBe(200);
    const page = await context.newPage();
    page.setDefaultTimeout(3000);
    try {
      await page.goto(`${origin}settings/ai`);
      const model = page.locator("#ai-summary-model");
      const save = page.getByRole("button", { name: "Save model", exact: true });
      expect(await model.inputValue()).toBe("initial-model");
      const updated = await context.request.patch("/api/ai/features/article_summary", {
        data: { provider, model: "updated-model" },
      });
      expect(updated.status()).toBe(200);
      await refreshSettings(
        page,
        (data) => data.aiSettings.features.articleSummary?.model === "updated-model",
      );
      expect(await model.inputValue()).toBe("updated-model");
      expect(await page.locator("#ai-summary-provider").textContent()).toContain(
        provider === "gemini" ? "Google Gemini" : "OpenAI",
      );
      expect(await save.isDisabled()).toBe(true);

      await model.fill("my-saved-model");
      await save.click();
      await page.getByText("AI provider and model saved", { exact: true }).waitFor();
      const refreshed = await context.request.patch("/api/ai/features/article_summary", {
        data: { provider: "gemini", model: "latest-model" },
      });
      expect(refreshed.status()).toBe(200);
      await refreshSettings(
        page,
        (data) => data.aiSettings.features.articleSummary?.model === "latest-model",
      );
      expect(await model.inputValue()).toBe("latest-model");
      expect(await save.isDisabled()).toBe(true);
    } finally {
      await page.close();
    }
  },
);

it("refreshes an untouched translation language, including after a local save", async () => {
  await updateSettings({ translationLanguage: "English" });
  const page = await context.newPage();
  page.setDefaultTimeout(3000);
  try {
    await page.goto(`${origin}settings/reading`);
    const language = page.getByRole("combobox", { name: "Translation language", exact: true });
    const save = page.getByRole("button", { name: "Save language", exact: true });
    expect(await language.inputValue()).toBe("English");
    await updateSettings({ translationLanguage: "German" });
    await refreshSettings(page, (data) => data.settings.translationLanguage === "German");
    expect(await language.inputValue()).toBe("German");
    expect(await save.isDisabled()).toBe(true);

    await language.fill("Unfinished language");
    await updateSettings({ translationLanguage: "Polish" });
    await refreshSettings(page, (data) => data.settings.translationLanguage === "Polish");
    expect(await language.inputValue()).toBe("Unfinished language");
    await language.fill("German");
    await language.press("Escape");
    expect(await language.inputValue()).toBe("Polish");
    expect(await save.isDisabled()).toBe(true);

    await language.fill("Japanese");
    await language.press("Escape");
    await save.click();
    await page.getByText("Settings saved", { exact: true }).waitFor();
    await updateSettings({ translationLanguage: "French" });
    await refreshSettings(page, (data) => data.settings.translationLanguage === "French");
    expect(await language.inputValue()).toBe("French");
    expect(await save.isDisabled()).toBe(true);
  } finally {
    await page.close();
  }
});

it("keeps a pending API key attached to its selected provider during refresh", async () => {
  const initial = await context.request.patch("/api/ai/features/article_summary", {
    data: { provider: "gemini", model: "key-provider-model" },
  });
  expect(initial.status()).toBe(200);
  const page = await context.newPage();
  page.setDefaultTimeout(3000);
  try {
    await page.goto(`${origin}settings/ai`);
    await page.locator("#ai-api-key").fill("unfinished-key");
    const updated = await context.request.patch("/api/ai/features/article_summary", {
      data: { provider: "openai", model: "another-provider-model" },
    });
    expect(updated.status()).toBe(200);
    await refreshSettings(
      page,
      (data) => data.aiSettings.features.articleSummary?.model === "another-provider-model",
    );
    expect(await page.locator("#ai-summary-model").inputValue()).toBe("key-provider-model");
    expect(await page.locator("#ai-summary-provider").textContent()).toContain("Google Gemini");
    expect(await page.locator("#ai-api-key").inputValue()).toBe("unfinished-key");
    await page.locator("#ai-api-key").fill("");
    expect(await page.locator("#ai-summary-model").inputValue()).toBe("another-provider-model");
    expect(await page.locator("#ai-summary-provider").textContent()).toContain("OpenAI");
    expect(await page.getByRole("button", { name: "Save model", exact: true }).isDisabled()).toBe(
      true,
    );
  } finally {
    await page.close();
  }
});

it("keeps default prompt drafts during refresh and loads saved values on reopening", async () => {
  const page = await context.newPage();
  page.setDefaultTimeout(3000);
  try {
    await page.goto(`${origin}settings/ai`);
    await page.getByRole("button", { name: "Edit defaults", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Edit default prompts", exact: true });
    const summary = dialog.locator("#ai-summary-prompt");
    const translation = dialog.locator("#ai-translation-prompt");
    await summary.fill("My unfinished summary instructions");
    await translation.fill("My unfinished translation instructions");

    const saved = await updateSettings({
      summaryPrompt: "Summary instructions saved in another tab",
      translationPrompt: "Translation instructions saved in another tab",
    });
    await refreshSettings(page, (data) => data.settings.summaryPrompt === saved.summaryPrompt);
    expect(await summary.inputValue()).toBe("My unfinished summary instructions");
    expect(await translation.inputValue()).toBe("My unfinished translation instructions");

    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Edit defaults", exact: true }).click();
    expect(await summary.inputValue()).toBe(saved.summaryPrompt);
    expect(await translation.inputValue()).toBe(saved.translationPrompt);

    await summary.fill("My saved summary instructions");
    await dialog.getByRole("button", { name: "Save prompts", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    const bootstrap = await context.request.get("/api/bootstrap");
    expect((await bootstrap.json()).settings.summaryPrompt).toBe("My saved summary instructions");
  } finally {
    await page.close();
  }
});

it("keeps the model and key drafts when another tab changes the AI provider", async () => {
  const initial = await context.request.patch("/api/ai/features/article_summary", {
    data: { provider: "gemini", model: "initial-model" },
  });
  expect(initial.status()).toBe(200);
  const page = await context.newPage();
  page.setDefaultTimeout(3000);
  try {
    await page.goto(`${origin}settings/ai`);
    const model = page.locator("#ai-summary-model");
    await model.fill("my-unfinished-model");
    const key = page.locator("#ai-api-key");
    await key.fill("unfinished-key");
    const response = await context.request.patch("/api/ai/features/article_summary", {
      data: { provider: "openai", model: "another-tabs-model" },
    });
    expect(response.status()).toBe(200);
    await refreshSettings(
      page,
      (data) => data.aiSettings.features.articleSummary?.model === "another-tabs-model",
    );
    expect(await model.inputValue()).toBe("my-unfinished-model");
    expect(await key.inputValue()).toBe("unfinished-key");
    expect(await page.locator("#ai-summary-model-help").textContent()).toContain("Gemini");

    await page.getByRole("button", { name: "Save model", exact: true }).click();
    await page.getByText("AI provider and model saved", { exact: true }).waitFor();
    const bootstrap = (await (await context.request.get("/api/bootstrap")).json()) as BootstrapData;
    expect(bootstrap.aiSettings.features.articleSummary).toMatchObject({
      provider: "gemini",
      model: "my-unfinished-model",
    });
    await page.getByRole("tab", { name: "Reading", exact: true }).click();
    await page.getByRole("tab", { name: "AI", exact: true }).click();
    expect(await model.inputValue()).toBe("my-unfinished-model");
    expect(await key.inputValue()).toBe("");
  } finally {
    await page.close();
  }
});

it("keeps a translation language draft during refresh and saves it", async () => {
  const page = await context.newPage();
  page.setDefaultTimeout(3000);
  try {
    await page.goto(`${origin}settings/reading`);
    const language = page.getByRole("combobox", { name: "Translation language", exact: true });
    await language.fill("Japanese");
    await updateSettings({ translationLanguage: "French" });
    await refreshSettings(page, (data) => data.settings.translationLanguage === "French");
    expect(await language.inputValue()).toBe("Japanese");
    await language.press("Escape");

    await page.getByRole("button", { name: "Save language", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await (await context.request.get("/api/bootstrap")).json()).settings.translationLanguage,
      )
      .toBe("Japanese");
    await page.getByRole("tab", { name: "AI", exact: true }).click();
    await updateSettings({ translationLanguage: "Polish" });
    await refreshSettings(page, (data) => data.settings.translationLanguage === "Polish");
    await page.getByRole("tab", { name: "Reading", exact: true }).click();
    expect(await language.inputValue()).toBe("Polish");
  } finally {
    await page.close();
  }
});

it("keeps custom prompt drafts and saves them alongside another tab's changes", async () => {
  const prompt = { id: crypto.randomUUID(), name: "Original prompt", prompt: "Original task" };
  await updateSettings({ customPrompts: [prompt] });
  const page = await context.newPage();
  page.setDefaultTimeout(3000);
  try {
    await page.goto(`${origin}settings/ai`);
    await page.getByRole("button", { name: "Edit Original prompt", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Edit custom prompt", exact: true });
    await dialog.locator("#custom-prompt-name").fill("My draft name");
    await dialog.locator("#custom-prompt-text").fill("My draft task");

    const otherPrompt = { id: crypto.randomUUID(), name: "Another prompt", prompt: "Another task" };
    await updateSettings({
      customPrompts: [
        { ...prompt, name: "Updated elsewhere", prompt: "Changed task" },
        otherPrompt,
      ],
    });
    await refreshSettings(page, (data) => data.settings.customPrompts.length === 2);
    expect(await dialog.locator("#custom-prompt-name").inputValue()).toBe("My draft name");
    expect(await dialog.locator("#custom-prompt-text").inputValue()).toBe("My draft task");
    await dialog.getByRole("button", { name: "Save prompt", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    const bootstrap = (await (await context.request.get("/api/bootstrap")).json()) as BootstrapData;
    expect(bootstrap.settings.customPrompts).toEqual([
      { ...prompt, name: "My draft name", prompt: "My draft task" },
      otherPrompt,
    ]);
  } finally {
    await page.close();
  }
});

it("loads the next account's saved settings without carrying over drafts", async () => {
  const auth = new AuthService(database.auth, 20, { maxAccounts: 2 });
  const other = await auth.register("other-settings-reader", "other-reader-password");
  if (!other) throw new Error("Could not create the second account");
  const account = await browser.newContext({ baseURL: origin });
  try {
    const login = await account.request.post("/api/auth/login", {
      data: { username: "virtual-reader", password: "reader-password" },
    });
    expect(login.status()).toBe(200);
    const page = await account.newPage();
    page.setDefaultTimeout(3000);
    await page.goto("/settings/ai");
    await page.locator("#ai-summary-model").fill("previous-accounts-model-draft");
    await page.locator("#ai-api-key").fill("previous-accounts-key-draft");
    await page.getByRole("button", { name: "Edit defaults", exact: true }).click();
    await page.locator("#ai-summary-prompt").fill("Previous account's prompt draft");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Edit default prompts", exact: true })
      .waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Log out virtual-reader", exact: true }).click();
    await page.getByRole("button", { name: "i'm in", exact: true }).click();
    const signIn = page.getByRole("dialog", { name: "Sign in", exact: true });
    await signIn
      .getByRole("textbox", { name: "Username", exact: true })
      .fill("other-settings-reader");
    await signIn.locator("#auth-password").fill("other-reader-password");
    await signIn.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("button", { name: /^Settings/ }).click();
    await page.getByRole("tab", { name: "AI", exact: true }).click();
    const saved = (await (await account.request.get("/api/bootstrap")).json()) as BootstrapData;
    const provider = saved.aiSettings.providers.find((item) => item.id === "gemini");
    expect(await page.locator("#ai-summary-model").inputValue()).toBe(provider?.defaultModel);
    expect(await page.locator("#ai-api-key").inputValue()).toBe("");
    await page.getByRole("button", { name: "Edit defaults", exact: true }).click();
    expect(await page.locator("#ai-summary-prompt").inputValue()).toBe(
      saved.settings.summaryPrompt,
    );
    expect(await page.locator("#ai-translation-prompt").inputValue()).toBe(
      saved.settings.translationPrompt,
    );
  } finally {
    await account.close();
  }
});
