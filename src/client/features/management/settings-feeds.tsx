import type { DuplicateArticleWindowDays, FeedPollIntervalMinutes } from "../../../shared/types";
import { DUPLICATE_ARTICLE_WINDOW_DAYS, FEED_POLL_INTERVAL_MINUTES } from "../../../shared/types";
import { isDesktopApp } from "../../platform/desktop";
import { DropdownSelect } from "../../ui/dropdown";
import type { ReaderDataMutations } from "../reader/reader-data";
import type { SettingsPreferencesProps } from "./settings";
import { ExportOpmlLink, formatRefreshInterval, ImportOpmlButton } from "./shared";
import { YouTubeSettings } from "./youtube";

export function FeedSettingsSection({
  userId,
  settings,
  saving,
  saveSettings,
  mutations,
  showToast,
}: SettingsPreferencesProps & {
  userId: string;
  mutations: ReaderDataMutations;
  showToast: (message: string) => void;
}) {
  const desktopApp = isDesktopApp();
  return (
    <>
      <section className="settings-section" aria-labelledby="refresh-heading">
        <div className="settings-heading">
          <h2 id="refresh-heading">Refresh</h2>
        </div>
        <div className="setting-row">
          <label htmlFor="poll-interval">
            <strong>New feed interval</strong>
            <p>
              Published feeds start here, then adapt between 5 minutes and 12 hours based on their
              usual time between posts.
            </p>
          </label>
          <DropdownSelect
            id="poll-interval"
            value={String(settings.pollIntervalMinutes)}
            disabled={saving}
            options={FEED_POLL_INTERVAL_MINUTES.map((minutes) => ({
              value: String(minutes),
              label: formatRefreshInterval(minutes),
            }))}
            onChange={(value) =>
              void saveSettings({
                pollIntervalMinutes: Number(value) as FeedPollIntervalMinutes,
              })
            }
          />
        </div>
        <div className="setting-row">
          <label htmlFor="duplicate-article-window">
            <strong>Duplicate article window</strong>
            <p>
              Skip a new article when its exact URL or exact title appeared in any feed during this
              period.
            </p>
          </label>
          <DropdownSelect
            id="duplicate-article-window"
            value={String(settings.duplicateArticleWindowDays)}
            disabled={saving}
            options={DUPLICATE_ARTICLE_WINDOW_DAYS.map((days) => ({
              value: String(days),
              label: days === 1 ? "Past day" : `Past ${days} days`,
            }))}
            onChange={(value) =>
              void saveSettings({
                duplicateArticleWindowDays: Number(value) as DuplicateArticleWindowDays,
              })
            }
          />
        </div>
      </section>

      {!desktopApp && import.meta.env.VITE_FEEDFOLD_DEMO !== "true" ? (
        <YouTubeSettings userId={userId} />
      ) : null}

      <section className="settings-section" aria-labelledby="portable-heading">
        <div className="settings-heading">
          <h2 id="portable-heading">Subscriptions</h2>
          <p>Use OPML to move feed URLs and folder structure between readers.</p>
        </div>
        <div className="setting-row">
          <div>
            <strong>Import or export OPML</strong>
            <p>Import adds new feeds and skips feed URLs you already follow.</p>
          </div>
          <div className="settings-actions">
            <ImportOpmlButton mutations={mutations} showToast={showToast} />
            <ExportOpmlLink />
          </div>
        </div>
      </section>
    </>
  );
}
