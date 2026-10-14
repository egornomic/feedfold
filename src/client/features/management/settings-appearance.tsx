import { Check, Minus, Monitor, Moon, Plus, Sun } from "lucide-react";
import { useReaderPreferences } from "../../app/session-state";
import { COLOR_PALETTES } from "../../ui/color-palettes";
import { Kbd } from "../../ui/controls";

export function AppearanceSettingsSection() {
  const theme = useReaderPreferences((state) => state.theme);
  const colorPalettes = useReaderPreferences((state) => state.colorPalettes);
  const fontSize = useReaderPreferences((state) => state.articleFontSize);
  const onTheme = useReaderPreferences((state) => state.setTheme);
  const onColorPalette = useReaderPreferences((state) => state.setColorPalette);
  const onFontSize = useReaderPreferences((state) => state.setArticleFontSize);

  return (
    <section className="settings-section" aria-labelledby="appearance-heading">
      <div className="settings-heading">
        <h2 id="appearance-heading">Appearance</h2>
        <p>These display choices apply to this account in this browser.</p>
      </div>
      <div className="setting-row">
        <div>
          <strong>Mode</strong>
          <p>Auto switches between your light and dark themes with your device.</p>
        </div>
        <div className="theme-options">
          <button type="button" aria-pressed={theme === "auto"} onClick={() => onTheme("auto")}>
            <Monitor aria-hidden="true" size={17} />
            Auto
          </button>
          <button type="button" aria-pressed={theme === "dark"} onClick={() => onTheme("dark")}>
            <Moon aria-hidden="true" size={17} />
            Dark
          </button>
          <button type="button" aria-pressed={theme === "light"} onClick={() => onTheme("light")}>
            <Sun aria-hidden="true" size={17} />
            Light
          </button>
        </div>
      </div>
      {(["light", "dark"] as const).map((mode) => (
        <div className="setting-row" key={mode}>
          <div>
            <strong id={`color-palette-${mode}-label`}>
              {mode === "light" ? "Light theme" : "Dark theme"}
            </strong>
            <p>
              {mode === "light"
                ? "Used in Light mode and when your device is light."
                : "Used in Dark mode and when your device is dark."}
            </p>
          </div>
          <div
            className="color-palette-options"
            role="radiogroup"
            aria-labelledby={`color-palette-${mode}-label`}
          >
            {COLOR_PALETTES.map((palette) => (
              <label className="color-palette-option" key={palette.id}>
                <input
                  type="radio"
                  name={`color-palette-${mode}`}
                  value={palette.id}
                  checked={colorPalettes[mode] === palette.id}
                  onChange={() => onColorPalette(mode, palette.id)}
                  aria-label={palette.name}
                />
                <span
                  className="color-palette-preview"
                  data-palette={palette.id}
                  data-theme={mode}
                  aria-hidden="true"
                >
                  <span className="color-palette-preview-sidebar">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="color-palette-preview-page">
                    <i />
                    <i />
                    <i />
                  </span>
                </span>
                <span className="color-palette-name">
                  {palette.name}
                  <Check size={14} aria-hidden="true" />
                </span>
              </label>
            ))}
          </div>
        </div>
      ))}
      <div className="setting-row">
        <div>
          <strong>Article text size</strong>
          <p>This size applies to full articles in both reading views.</p>
        </div>
        <div className="font-stepper">
          <button
            type="button"
            disabled={fontSize <= 15}
            onClick={() => onFontSize((current) => Math.max(15, current - 1))}
            aria-label="Decrease article text size"
          >
            <Minus aria-hidden="true" size={16} />
            <Kbd>[</Kbd>
          </button>
          <output>{fontSize}px</output>
          <button
            type="button"
            disabled={fontSize >= 23}
            onClick={() => onFontSize((current) => Math.min(23, current + 1))}
            aria-label="Increase article text size"
          >
            <Plus aria-hidden="true" size={16} />
            <Kbd>]</Kbd>
          </button>
        </div>
      </div>
    </section>
  );
}
