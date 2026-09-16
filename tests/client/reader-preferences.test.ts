import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import {
  clearReaderPreferences,
  resolveAppearance,
  resolveTheme,
} from "../../src/client/reader-preferences.js";

describe("theme preference", () => {
  it("follows the device appearance in auto mode", () => {
    expect(resolveTheme("auto", true)).toBe("light");
    expect(resolveTheme("auto", false)).toBe("dark");
  });

  it("keeps an explicit appearance regardless of the device", () => {
    expect(resolveTheme("light", false)).toBe("light");
    expect(resolveTheme("dark", true)).toBe("dark");
  });

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
