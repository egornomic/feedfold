import { expect, it } from "vitest";
import type { YouTubeStatus } from "../../src/shared/youtube.js";
import { context, origin } from "./reader-browser-fixture.js";

it("keeps the disconnect choice open after a failure and reports the finished disconnect", async () => {
  let status: YouTubeStatus = {
    available: true,
    connected: true,
    channelTitle: "Reader channel",
    lastSyncAt: null,
    nextSyncAt: null,
    feedCount: 2,
    error: null,
  };
  const disconnects: Array<"fail" | "pass"> = ["fail", "pass"];
  const page = await context.newPage();
  page.setDefaultTimeout(3000);
  try {
    await page.route("**/api/youtube", (route) => {
      if (route.request().method() === "GET") return route.fulfill({ json: status });
      if (disconnects.shift() === "fail")
        return route.fulfill({ status: 500, json: { error: "Google did not respond" } });
      status = { ...status, connected: false, channelTitle: null, feedCount: 0 };
      return route.fulfill({ status: 204 });
    });
    await page.route("**/api/youtube/connect", (route) =>
      route.fulfill({ status: 500, json: { error: "YouTube sign-in is unavailable" } }),
    );
    await page.goto(`${origin}settings/feeds?youtube=cancelled`);
    const section = page.getByRole("region", { name: "YouTube", exact: true });
    await section
      .getByText("YouTube connection cancelled. Your feeds have not changed.", { exact: true })
      .waitFor();

    await section.getByRole("button", { name: "Disconnect", exact: true }).click();
    expect(await section.getByRole("status").count()).toBe(0);
    await section
      .getByRole("button", { name: "Disconnect and keep channels", exact: true })
      .click();
    await section.getByRole("alert").getByText("Google did not respond", { exact: true }).waitFor();
    await section
      .getByRole("button", { name: "Disconnect and keep channels", exact: true })
      .click();
    await section
      .getByText("YouTube disconnected. Imported channels and their reading history were kept.", {
        exact: true,
      })
      .waitFor();
    expect(await section.getByText("Remove imported channels too?").count()).toBe(0);
    expect(await section.getByRole("alert").count()).toBe(0);

    await section.getByRole("button", { name: "Connect YouTube", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Hide Shorts from your feed?" });
    await dialog.getByRole("button", { name: "Hide Shorts", exact: true }).click();
    await dialog.getByText("YouTube sign-in is unavailable", { exact: true }).waitFor();
    await dialog.getByRole("button", { name: "Cancel YouTube connection", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    expect(await section.getByRole("alert").count()).toBe(0);
  } finally {
    await page.close();
  }
});
