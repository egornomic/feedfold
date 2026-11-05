import { expect, it } from "vitest";
import type { WebFeedAnalysis } from "../../src/shared/types.js";
import { failFeedRefresh } from "../helpers/feeds.js";
import { context, database, origin } from "./reader-browser-fixture.js";

const pageUrl = "https://example.test/changed";
const selectors = (item: string) => ({
  item,
  title: "h2",
  link: "a",
  date: null,
  author: null,
  summary: null,
  image: null,
});
const entry = (title: string) => ({
  title,
  url: `${pageUrl}/${title}`,
  author: null,
  publishedAt: null,
  summary: "",
  imageUrl: null,
});

it("recovers from a failed page reload and a failed save while repairing a web feed", async () => {
  const feed = database.feeds.createWebFeed(1, {
    title: "Changed page",
    pageUrl,
    folderId: null,
    config: { pageUrl, selectors: selectors(".old") },
    parsed: {
      title: "Changed page",
      siteUrl: pageUrl,
      articles: [
        {
          externalId: "web:old",
          title: "Old",
          url: `${pageUrl}/old`,
          author: null,
          publishedAt: null,
          summary: "",
          imageUrl: null,
          feedContentHtml: null,
        },
      ],
    },
  });
  failFeedRefresh(database.feeds, feed.id, {
    httpStatus: 200,
    error: "The saved selection no longer matches",
    errorKind: "selection_broken",
  });
  const analysis: WebFeedAnalysis = {
    pageUrl,
    title: "Changed page",
    snapshotId: "missing",
    messageToken: "token",
    candidates: [
      {
        id: "cards",
        label: "Cards",
        itemCount: 2,
        availableFields: ["title", "link"],
        config: { pageUrl, selectors: selectors(".card") },
        articles: [entry("one"), entry("two")],
      },
    ],
    suggestedCandidateIds: ["cards"],
    selectedCandidateId: null,
    savedSelectionMatched: false,
  };
  let pageLoads = false;
  const saves: Array<"fail" | "pass"> = ["fail", "pass"];
  const page = await context.newPage();
  page.setDefaultTimeout(3000);
  try {
    await page.route(`**/api/feeds/${feed.id}/web-feed/analyze`, (route) =>
      pageLoads
        ? route.fulfill({ json: analysis })
        : route.fulfill({ status: 500, json: { error: "The page could not be loaded" } }),
    );
    await page.route(`**/api/feeds/${feed.id}/web-feed`, (route) =>
      saves.shift() === "fail"
        ? route.fulfill({ status: 500, json: { error: "The selection could not be saved" } })
        : route.fulfill({ json: { ...feed, lastErrorKind: null } }),
    );
    await page.goto(`${origin}feeds`);
    await page.getByRole("button", { name: "Repair", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const save = dialog.getByRole("button", { name: "Save selection", exact: true });

    await dialog.getByText("The page could not be loaded", { exact: true }).waitFor();
    expect(await save.isDisabled()).toBe(true);

    pageLoads = true;
    await dialog.getByRole("button", { name: "Reload page", exact: true }).click();
    await dialog.getByText(/This page has changed/).waitFor();
    expect(await dialog.getByText("The page could not be loaded", { exact: true }).count()).toBe(0);

    await save.click();
    await dialog.getByText("The selection could not be saved", { exact: true }).waitFor();
    expect(await save.isEnabled()).toBe(true);

    await save.click();
    await page.getByText("Page selection updated for Changed page", { exact: true }).waitFor();
    await dialog.waitFor({ state: "hidden" });
    expect(saves).toHaveLength(0);
  } finally {
    await page.close();
  }
});
