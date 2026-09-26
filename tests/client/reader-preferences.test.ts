import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import {
  clearReaderPreferences,
  createReaderPreferencesStore,
  resolveAppearance,
} from "../../src/client/features/reader/reader-preferences.js";

describe("theme preference", () => {
  it("uses independently chosen light and dark palettes as the device changes in auto mode", () => {
    const palettes = { light: "sand", dark: "slate" } as const;
    expect(resolveAppearance("auto", palettes, true)).toEqual({ mode: "light", palette: "sand" });
    expect(resolveAppearance("auto", palettes, false)).toEqual({ mode: "dark", palette: "slate" });
  });

  it("uses the explicit mode's palette even when the device uses the other appearance", () => {
    const palettes = { light: "sand", dark: "slate" } as const;
    expect(resolveAppearance("light", palettes, false)).toEqual({ mode: "light", palette: "sand" });
    expect(resolveAppearance("dark", palettes, true)).toEqual({ mode: "dark", palette: "slate" });
  });

  it("forgets both theme choices when an account is deleted without clearing another account", () => {
    const dom = new JSDOM("", { url: "https://feedfold.test" });
    vi.stubGlobal("window", dom.window);
    try {
      const storage = dom.window.localStorage;
      storage.setItem("feedfold-account-alice-color-palette-light", "sand");
      storage.setItem("feedfold-account-alice-color-palette-dark", "slate");
      storage.setItem("feedfold-account-bob-color-palette-light", "moss");
      storage.setItem("feedfold-account-bob-color-palette-dark", "sand");

      clearReaderPreferences("alice");

      expect(storage.getItem("feedfold-account-alice-color-palette-light")).toBeNull();
      expect(storage.getItem("feedfold-account-alice-color-palette-dark")).toBeNull();
      expect(storage.getItem("feedfold-account-bob-color-palette-light")).toBe("moss");
      expect(storage.getItem("feedfold-account-bob-color-palette-dark")).toBe("sand");
    } finally {
      vi.unstubAllGlobals();
      dom.window.close();
    }
  });
});

describe("account reader preferences", () => {
  it("restores every saved choice before the first render", () => {
    const dom = new JSDOM("", { url: "https://feedfold.test" });
    try {
      const storage = dom.window.localStorage;
      const saved = {
        "reading-mode": "expanded",
        theme: "auto",
        "color-palette-light": "sand",
        "color-palette-dark": "slate",
        "article-font-size": "22",
        "desktop-sidebar-collapsed": "true",
      };
      for (const [setting, value] of Object.entries(saved)) {
        storage.setItem(`feedfold-account-alice-${setting}`, value);
      }
      expect(createReaderPreferencesStore("alice", storage).getState()).toMatchObject({
        readingMode: "expanded",
        theme: "auto",
        colorPalettes: { light: "sand", dark: "slate" },
        articleFontSize: 22,
        desktopSidebarCollapsed: true,
      });
    } finally {
      dom.window.close();
    }
  });

  it("saves changes immediately and restores each account's choices independently", () => {
    const dom = new JSDOM("", { url: "https://feedfold.test" });
    try {
      const storage = dom.window.localStorage;
      const alice = createReaderPreferencesStore("alice", storage).getState();
      alice.setReadingMode("expanded");
      alice.setTheme("light");
      alice.setColorPalette("light", "sand");
      alice.setColorPalette("dark", "slate");
      alice.setArticleFontSize((current) => current + 2);
      alice.toggleDesktopSidebar();

      const bob = createReaderPreferencesStore("bob", storage);
      expect(bob.getState()).toMatchObject({
        readingMode: "magazine",
        theme: "dark",
        articleFontSize: 18,
        desktopSidebarCollapsed: false,
      });
      bob.getState().setTheme("auto");
      bob.getState().setColorPalette("dark", "moss");
      bob.getState().setArticleFontSize(23);

      expect(createReaderPreferencesStore("alice", storage).getState()).toMatchObject({
        readingMode: "expanded",
        theme: "light",
        articleFontSize: 20,
        colorPalettes: { light: "sand", dark: "slate" },
        desktopSidebarCollapsed: true,
      });
      expect(createReaderPreferencesStore("bob", storage).getState()).toMatchObject({
        readingMode: "magazine",
        theme: "auto",
        articleFontSize: 23,
        colorPalettes: { dark: "moss" },
        desktopSidebarCollapsed: false,
      });
      alice.toggleDesktopSidebar();
      expect(
        createReaderPreferencesStore("alice", storage).getState().desktopSidebarCollapsed,
      ).toBe(false);
    } finally {
      dom.window.close();
    }
  });

  it.each([
    ["12", 16],
    ["30", 23],
    ["not-a-size", 18],
  ])("restores a usable font size from %s", (saved, expected) => {
    const dom = new JSDOM("", { url: "https://feedfold.test" });
    try {
      dom.window.localStorage.setItem("feedfold-account-alice-article-font-size", saved);
      expect(
        createReaderPreferencesStore("alice", dom.window.localStorage).getState().articleFontSize,
      ).toBe(expected);
    } finally {
      dom.window.close();
    }
  });
});
