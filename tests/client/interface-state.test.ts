// @vitest-environment jsdom
import { act, createElement } from "react";
import { assert, expect, it } from "vitest";
import { waitFor } from "./react-harness.js";
import { readerFixture } from "./reader-fixture.js";

async function click(document: Document, selector: string) {
  const button = document.querySelector<HTMLButtonElement>(selector);
  assert(button, `Missing control: ${selector}`);
  await act(async () => button.click());
}

it("shares navigation, preferences, and panel controls across the reader and management pages", async () => {
  const fixture = readerFixture();
  const { document } = fixture.dom.window;
  const key = async (key: string) => {
    await act(async () => {
      document.body.dispatchEvent(
        new fixture.dom.window.KeyboardEvent("keydown", { key, bubbles: true }),
      );
    });
  };
  try {
    await fixture.mount();
    await waitFor("reader", () => document.querySelector(".reading-workspace") !== null);
    await click(document, '[aria-label="Hide sidebar"]');
    expect(document.querySelector(".app-shell")?.classList.contains("is-sidebar-collapsed")).toBe(
      true,
    );
    await click(document, '[aria-label="Show sidebar"]');
    expect(document.querySelector(".app-shell")?.classList.contains("is-sidebar-collapsed")).toBe(
      false,
    );

    await click(document, '.reader-toolbar [aria-label="Open navigation"]');
    expect(document.querySelector(".nav-scrim.is-open")).not.toBeNull();
    await key("Escape");
    expect(document.querySelector(".nav-scrim.is-open")).toBeNull();
    await click(document, '.reader-toolbar [aria-label="Open navigation"]');
    await click(document, ".nav-scrim");
    expect(document.querySelector(".nav-scrim.is-open")).toBeNull();

    await key("?");
    await waitFor("shortcut help", () => document.querySelector('[role="dialog"]') !== null);
    const beforeSize = document.documentElement.style.getPropertyValue("--article-font-size");
    await key("]");
    expect(document.documentElement.style.getPropertyValue("--article-font-size")).toBe(beforeSize);
    await key("Escape");
    await waitFor("dismissed shortcuts", () => document.querySelector('[role="dialog"]') === null);
    await key("]");
    expect(document.documentElement.style.getPropertyValue("--article-font-size")).toBe("19px");

    await key("g");
    await key("f");
    await waitFor(
      "feeds page",
      () => document.querySelector(".page-header h1")?.textContent === "Manage feeds",
    );
    expect(fixture.dom.window.location.pathname).toBe("/feeds");
    await click(document, '.page-header [aria-label="Open navigation"]');
    expect(document.querySelector(".nav-scrim.is-open")).not.toBeNull();
    await key("Escape");
    await click(document, '[role="tab"][id="folders-tab"]');
    const addFolder = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Add folder",
    );
    assert(addFolder);
    await act(async () => addFolder.click());
    await waitFor("new folder dialog", () => document.querySelector('[role="dialog"]') !== null);
    const dialog = document.querySelector('[role="dialog"]');
    assert(dialog);
    await act(async () =>
      dialog.dispatchEvent(
        new fixture.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    await waitFor(
      "dismissed folder dialog",
      () => document.querySelector('[role="dialog"]') === null,
    );
    expect(fixture.database.folders.listFolders(1)).toEqual([]);
  } finally {
    await fixture.close();
  }
});

it.each(["shortcut help", "folder management"])(
  "discards navigation and %s after session expiry while retaining reader preferences",
  async (panel) => {
    const fixture = readerFixture(panel === "folder management" ? "/feeds" : "/articles/unread");
    const { document } = fixture.dom.window;
    try {
      await fixture.mount();
      await waitFor("signed-in shell", () => document.querySelector(".app-shell") !== null);
      await click(document, '[aria-label="Hide sidebar"]');
      await click(document, '[aria-label="Open navigation"]');
      if (panel === "shortcut help") {
        await click(document, '[aria-label="Open keyboard shortcut reference (?)"]');
      } else {
        await click(document, "#folders-tab");
        await click(document, ".page-header-actions .primary-button");
      }
      await waitFor("open panel", () => document.querySelector('[role="dialog"]') !== null);
      expect(document.querySelector(".nav-scrim.is-open")).not.toBeNull();
      const openPanel = document.querySelector('[role="dialog"]');
      assert(openPanel);
      const { AUTH_REQUIRED_EVENT } = await import("../../src/client/api/api.js");
      await act(async () =>
        fixture.dom.window.dispatchEvent(new fixture.dom.window.Event(AUTH_REQUIRED_EVENT)),
      );
      await waitFor("signed-out shell", () => document.querySelector(".app-shell") === null);
      expect(openPanel.isConnected).toBe(false);

      // A new sign-in mounts a fresh App, while loaded modules and account storage remain alive.
      const modulePath: string = "../../src/client/app/app.js";
      const { App } = await import(modulePath);
      await fixture.mount(createElement(App, { key: "new-session" }));
      await waitFor("restored account", () => document.querySelector(".app-shell") !== null);
      expect(document.querySelector(".nav-scrim.is-open")).toBeNull();
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(document.querySelector(".app-shell")?.classList.contains("is-sidebar-collapsed")).toBe(
        true,
      );
    } finally {
      await fixture.close();
    }
  },
);
