import { createElement } from "react";
import { expect, it } from "vitest";
import { waitFor } from "./react-harness.js";
import { readerFixture } from "./reader-fixture.js";

it("explains when feed settings can no longer be loaded after an unsubscribe elsewhere", async () => {
  const fixture = readerFixture();
  const { QueryClientProvider } = await import("@tanstack/react-query");
  const { createQueryClient } = await import("../../src/client/api/query.js");
  const { api } = await import("../../src/client/api/api.js");
  const dialogPath: string = "../../src/client/features/management/context-dialog.js";
  const { default: ContextManagementDialog } = await import(dialogPath);
  const client = createQueryClient();
  const bootstrap = fixture.database.bootstrap.getBootstrap(1);
  fixture.database.feeds.deleteFeed(1, fixture.feed.id);
  try {
    await fixture.mount(
      createElement(
        QueryClientProvider,
        { client },
        createElement(ContextManagementDialog, {
          request: { kind: "feed-settings", feedId: fixture.feed.id },
          bootstrap,
          mutations: api,
          onClose: () => {},
          onRefresh: async () => {},
          onUnsubscribe: async () => false,
          showToast: () => {},
        }),
      ),
    );
    await waitFor("missing feed response", () => fixture.failures.length > 0);
    expect(fixture.failures[0]?.message).toContain("Feed was not found");
    await waitFor(
      "explanation in the dialog",
      () =>
        fixture.dom.window.document
          .querySelector('[role="alert"]')
          ?.textContent?.includes("Feed was not found") === true,
    );
  } finally {
    await fixture.close();
    client.clear();
  }
});
