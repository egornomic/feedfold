// Add a palette here and its semantic color tokens in color-palettes.css.
// The picker, saved preference type, and light/dark previews use this registry.
export const COLOR_PALETTES = [
  { id: "moss", name: "Moss" },
  { id: "sand", name: "Sand" },
  { id: "slate", name: "Slate" },
  { id: "codex", name: "Codex" },
] as const;

export type ColorPalette = (typeof COLOR_PALETTES)[number]["id"];
export const DEFAULT_COLOR_PALETTE: ColorPalette = "moss";
