import { createStore } from "zustand/vanilla";
import type { ReadingMode } from "../../../shared/types.js";
import { type ColorPalette, DEFAULT_COLOR_PALETTE } from "../../ui/color-palettes.js";

export type Theme = "auto" | "dark" | "light";
export type ResolvedTheme = Exclude<Theme, "auto">;
export type ColorPalettes = Record<ResolvedTheme, ColorPalette>;

export const ARTICLE_FONT_MIN = 16;
export const ARTICLE_FONT_MAX = 23;
const ARTICLE_FONT_DEFAULT = 18;

function storedValue<T extends string>(storage: Storage, key: string, fallback: T): T {
  const value = storage.getItem(key);
  return (value as T | null) ?? fallback;
}

function storedNumber(storage: Storage, key: string, fallback: number): number {
  const stored = storage.getItem(key);
  if (stored === null) return fallback;
  const value = Number(stored);
  return Number.isFinite(value) ? value : fallback;
}

function storedBoolean(storage: Storage, key: string, fallback: boolean): boolean {
  const stored = storage.getItem(key);
  if (stored === null) return fallback;
  return stored === "true";
}

function accountStorageKey(userId: string, setting: string): string {
  return `feedfold-account-${userId}-${setting}`;
}

export function clearReaderPreferences(userId: string): void {
  for (const setting of [
    "reading-mode",
    "theme",
    "color-palette-light",
    "color-palette-dark",
    "article-font-size",
    "desktop-sidebar-collapsed",
  ]) {
    window.localStorage.removeItem(accountStorageKey(userId, setting));
  }
}

function resolveTheme(theme: Theme, prefersLight: boolean): ResolvedTheme {
  if (theme !== "auto") return theme;
  return prefersLight ? "light" : "dark";
}

export function resolveAppearance(theme: Theme, palettes: ColorPalettes, prefersLight: boolean) {
  const mode = resolveTheme(theme, prefersLight);
  return { mode, palette: palettes[mode] };
}

interface ReaderPreferencesState {
  readingMode: ReadingMode;
  theme: Theme;
  colorPalettes: ColorPalettes;
  articleFontSize: number;
  desktopSidebarCollapsed: boolean;
  setReadingMode: (mode: ReadingMode) => void;
  setTheme: (theme: Theme) => void;
  setColorPalette: (mode: ResolvedTheme, palette: ColorPalette) => void;
  setArticleFontSize: (size: number | ((current: number) => number)) => void;
  toggleDesktopSidebar: () => void;
}

export function createReaderPreferencesStore(userId: string, storage = window.localStorage) {
  const store = createStore<ReaderPreferencesState>()((set) => ({
    readingMode: storedValue<ReadingMode>(
      storage,
      accountStorageKey(userId, "reading-mode"),
      "magazine",
    ),
    theme: storedValue<Theme>(storage, accountStorageKey(userId, "theme"), "dark"),
    colorPalettes: {
      light: storedValue<ColorPalette>(
        storage,
        accountStorageKey(userId, "color-palette-light"),
        DEFAULT_COLOR_PALETTE,
      ),
      dark: storedValue<ColorPalette>(
        storage,
        accountStorageKey(userId, "color-palette-dark"),
        DEFAULT_COLOR_PALETTE,
      ),
    },
    articleFontSize: Math.min(
      ARTICLE_FONT_MAX,
      Math.max(
        ARTICLE_FONT_MIN,
        storedNumber(storage, accountStorageKey(userId, "article-font-size"), ARTICLE_FONT_DEFAULT),
      ),
    ),
    desktopSidebarCollapsed: storedBoolean(
      storage,
      accountStorageKey(userId, "desktop-sidebar-collapsed"),
      false,
    ),
    setReadingMode: (readingMode) => set({ readingMode }),
    setTheme: (theme) => set({ theme }),
    setColorPalette: (mode, palette) =>
      set((state) => ({ colorPalettes: { ...state.colorPalettes, [mode]: palette } })),
    setArticleFontSize: (size) =>
      set((state) => ({
        articleFontSize: typeof size === "function" ? size(state.articleFontSize) : size,
      })),
    toggleDesktopSidebar: () =>
      set((state) => ({ desktopSidebarCollapsed: !state.desktopSidebarCollapsed })),
  }));

  // Keep the account's existing storage format; Zustand is the only in-memory owner.
  store.subscribe((state) => {
    const values = {
      "reading-mode": state.readingMode,
      theme: state.theme,
      "color-palette-light": state.colorPalettes.light,
      "color-palette-dark": state.colorPalettes.dark,
      "article-font-size": state.articleFontSize,
      "desktop-sidebar-collapsed": state.desktopSidebarCollapsed,
    };
    for (const [setting, value] of Object.entries(values)) {
      storage.setItem(accountStorageKey(userId, setting), String(value));
    }
  });
  return store;
}
