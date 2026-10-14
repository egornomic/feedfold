import { BookOpenText, LoaderCircle, Palette, Rss, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ApiInput } from "../../../shared/api/operations";
import type { SettingsCategory } from "../../../shared/app-routes";
import type { AiSettings, AppSettings } from "../../../shared/types";
import { api, errorMessage } from "../../api/api";
import { useRequestMutation } from "../../api/use-request-mutation";
import { isDesktopApp } from "../../platform/desktop";
import type { ReaderDataMutations } from "../reader/reader-data";
import { InvitationsSection } from "./invitations";
import { AccountSettingsSection } from "./settings-account";
import { AiSettingsSection } from "./settings-ai";
import { AppearanceSettingsSection } from "./settings-appearance";
import { FeedSettingsSection } from "./settings-feeds";
import { ReadingSettingsSection } from "./settings-reading";
import { useSensitiveAction } from "./settings-security";
import { handleTabListKeyDown, PageHeader } from "./shared";
import "./dialogs.css";
import "./settings.css";

export interface SettingsPreferencesProps {
  settings: AppSettings;
  saving: boolean;
  saveSettings: (change: ApiInput<"updateSettings">) => Promise<void>;
}

const SETTINGS_CATEGORIES = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "reading", label: "Reading", icon: BookOpenText },
  { id: "feeds", label: "Feeds", icon: Rss },
  { id: "ai", label: "AI", icon: Sparkles },
  { id: "account", label: "Account", icon: ShieldCheck },
] satisfies ReadonlyArray<{
  id: SettingsCategory;
  label: string;
  icon: typeof BookOpenText;
}>;

function SettingsPage({
  userId,
  category,
  settings,
  aiSettings,
  mutations,
  onCategory,
  onSettings,
  onAiSettings,
  showToast,
  onAccountDeleted,
}: {
  userId: string;
  category: SettingsCategory;
  settings: AppSettings;
  aiSettings: AiSettings;
  mutations: ReaderDataMutations;
  onCategory: (category: SettingsCategory, historyMode?: "push" | "replace") => void;
  onSettings: (settings: AppSettings) => void;
  onAiSettings: (settings: AiSettings) => void;
  showToast: (message: string) => void;
  onAccountDeleted: () => void;
}) {
  const { run: mutateRequest } = useRequestMutation();
  const [saving, setSaving] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);
  const { runSensitive, authenticationDialog } = useSensitiveAction();
  const desktopApp = isDesktopApp();
  const visibleCategories = desktopApp
    ? SETTINGS_CATEGORIES.filter((option) => option.id !== "account")
    : SETTINGS_CATEGORIES;

  useLayoutEffect(() => {
    if (pageRef.current?.querySelector(`#settings-${category}-panel`)) {
      pageRef.current.scrollTo({ top: 0 });
    }
  }, [category]);

  useEffect(() => {
    if (desktopApp && category === "account") onCategory("appearance", "replace");
  }, [category, desktopApp, onCategory]);

  const saveSettings = async (change: ApiInput<"updateSettings">) => {
    setSaving(true);
    try {
      onSettings(await mutateRequest(() => api.updateSettings(change)));
      showToast("Settings saved");
    } catch (error) {
      showToast(`Could not save settings: ${errorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div ref={pageRef} className="management-page settings-page">
      <PageHeader
        title="Settings"
        actions={
          saving ? (
            <span className="saving-label">
              <LoaderCircle className="spin" aria-hidden="true" size={15} />
              Saving
            </span>
          ) : undefined
        }
      />

      <div className="management-tabs-shell">
        <div
          className="management-tabs settings-tabs"
          role="tablist"
          aria-label="Settings categories"
          onKeyDown={handleTabListKeyDown}
        >
          {visibleCategories.map((option) => {
            const Icon = option.icon;
            const selected = category === option.id;
            return (
              <button
                id={`settings-${option.id}-tab`}
                key={option.id}
                type="button"
                role="tab"
                aria-controls={`settings-${option.id}-panel`}
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => onCategory(option.id)}
              >
                <Icon aria-hidden="true" size={15} />
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {category === "account" && !desktopApp ? (
        <div
          id="settings-account-panel"
          className="settings-category-panel"
          role="tabpanel"
          aria-labelledby="settings-account-tab"
        >
          <InvitationsSection showToast={showToast} />
          <AccountSettingsSection
            userId={userId}
            onAccountDeleted={onAccountDeleted}
            showToast={showToast}
            runSensitive={runSensitive}
          />
        </div>
      ) : null}

      {category === "appearance" ? (
        <div
          id="settings-appearance-panel"
          className="settings-category-panel"
          role="tabpanel"
          aria-labelledby="settings-appearance-tab"
        >
          <AppearanceSettingsSection />
        </div>
      ) : null}

      {category === "reading" ? (
        <div
          id="settings-reading-panel"
          className="settings-category-panel"
          role="tabpanel"
          aria-labelledby="settings-reading-tab"
        >
          <ReadingSettingsSection settings={settings} saving={saving} saveSettings={saveSettings} />
        </div>
      ) : null}

      {category === "ai" ? (
        <div
          id="settings-ai-panel"
          className="settings-category-panel"
          role="tabpanel"
          aria-labelledby="settings-ai-tab"
        >
          <AiSettingsSection
            settings={settings}
            aiSettings={aiSettings}
            onSettings={onSettings}
            onAiSettings={onAiSettings}
            showToast={showToast}
            runSensitive={runSensitive}
          />
        </div>
      ) : null}

      {category === "feeds" ? (
        <div
          id="settings-feeds-panel"
          className="settings-category-panel"
          role="tabpanel"
          aria-labelledby="settings-feeds-tab"
        >
          <FeedSettingsSection
            userId={userId}
            settings={settings}
            saving={saving}
            saveSettings={saveSettings}
            mutations={mutations}
            showToast={showToast}
          />
        </div>
      ) : null}
      {authenticationDialog}
    </div>
  );
}

export default SettingsPage;
