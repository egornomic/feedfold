import { useState } from "react";
import { DropdownCombobox } from "../../ui/dropdown";
import type { SettingsPreferencesProps } from "./settings";
import { ShortcutReference } from "./shortcut-help";

export function ReadingSettingsSection({
  settings,
  saving,
  saveSettings,
}: SettingsPreferencesProps) {
  const [translationLanguage, setTranslationLanguage] = useState(settings.translationLanguage);
  return (
    <>
      <section className="settings-section" aria-labelledby="reading-behavior-heading">
        <div className="settings-heading">
          <h2 id="reading-behavior-heading">Reading behavior</h2>
          <p>These choices apply to every feed and folder.</p>
        </div>
        <div className="setting-row">
          <div>
            <strong>Mark as read on scroll</strong>
            <p>Mark an article as read after you scroll completely past it.</p>
          </div>
          <button
            className={`switch ${settings.markReadOnScroll ? "is-on" : ""}`}
            type="button"
            role="switch"
            aria-label="Mark as read on scroll"
            aria-checked={settings.markReadOnScroll}
            disabled={saving}
            onClick={() => void saveSettings({ markReadOnScroll: !settings.markReadOnScroll })}
          >
            <span />
          </button>
        </div>
        <div className="setting-row">
          <div>
            <strong>YouTube descriptions</strong>
            <p>Show descriptions from YouTube videos and Shorts in lists and below the player.</p>
          </div>
          <button
            className={`switch ${settings.showYouTubeDescriptions ? "is-on" : ""}`}
            type="button"
            role="switch"
            aria-label="Show YouTube descriptions"
            aria-checked={settings.showYouTubeDescriptions}
            disabled={saving}
            onClick={() =>
              void saveSettings({
                showYouTubeDescriptions: !settings.showYouTubeDescriptions,
              })
            }
          >
            <span />
          </button>
        </div>
        <div className="setting-row">
          <label htmlFor="translation-language">
            <strong>Translation language</strong>
            <p>Translate articles into this language with the configured AI model.</p>
          </label>
          <form
            className="translation-language-form"
            onSubmit={(event) => {
              event.preventDefault();
              const language = translationLanguage.trim();
              if (language) void saveSettings({ translationLanguage: language });
            }}
          >
            <DropdownCombobox
              id="translation-language"
              ariaLabel="Translation language"
              value={translationLanguage}
              suggestions={[
                "English",
                "Polish",
                "German",
                "Spanish",
                "French",
                "Italian",
                "Portuguese",
                "Ukrainian",
              ]}
              maxLength={80}
              required
              disabled={saving}
              onChange={setTranslationLanguage}
            />
            <button
              className="secondary-button"
              type="submit"
              disabled={
                saving ||
                !translationLanguage.trim() ||
                translationLanguage.trim() === settings.translationLanguage
              }
            >
              Save language
            </button>
          </form>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="keyboard-heading">
        <div className="settings-heading">
          <h2 id="keyboard-heading">Keyboard</h2>
          <p>Single-key shortcuts pause while you type in a form field.</p>
        </div>
        <div className="setting-row">
          <div>
            <strong>Single-key shortcuts</strong>
            <p>Turn off letter and number shortcuts. Tab navigation remains available.</p>
          </div>
          <button
            className={`switch ${settings.singleKeyShortcuts ? "is-on" : ""}`}
            type="button"
            role="switch"
            aria-label="Single-key shortcuts"
            aria-checked={settings.singleKeyShortcuts}
            disabled={saving}
            onClick={() => void saveSettings({ singleKeyShortcuts: !settings.singleKeyShortcuts })}
          >
            <span />
          </button>
        </div>
        <ShortcutReference compact />
      </section>
    </>
  );
}
