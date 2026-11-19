import type Sqlite from "better-sqlite3";
import type { AiCustomPrompt, AppSettings } from "../../../shared/types.js";
import { type Row, toBoolean } from "../shared.js";

export class SettingsRepository {
    constructor(private readonly sqlite: Sqlite.Database) {}

    getSettings(userId: number): AppSettings {
        const row = this.sqlite
            .prepare(
                `SELECT poll_interval_minutes AS pollIntervalMinutes,
                duplicate_article_window_days AS duplicateArticleWindowDays,
                single_key_shortcuts AS singleKeyShortcuts,
                mark_read_on_scroll AS markReadOnScroll,
                show_youtube_descriptions AS showYouTubeDescriptions,
                translation_language AS translationLanguage,
                summary_prompt AS summaryPrompt,
                translation_prompt AS translationPrompt,
                custom_prompts_json AS customPromptsJson
         FROM settings WHERE user_id = ?`,
            )
            .get(userId) as Row;
        return {
            pollIntervalMinutes: Number(row.pollIntervalMinutes),
            duplicateArticleWindowDays: Number(
                row.duplicateArticleWindowDays,
            ) as AppSettings["duplicateArticleWindowDays"],
            singleKeyShortcuts: toBoolean(row.singleKeyShortcuts),
            markReadOnScroll: toBoolean(row.markReadOnScroll),
            showYouTubeDescriptions: toBoolean(row.showYouTubeDescriptions),
            translationLanguage: String(row.translationLanguage),
            summaryPrompt: String(row.summaryPrompt),
            translationPrompt: String(row.translationPrompt),
            customPrompts: JSON.parse(
                String(row.customPromptsJson),
            ) as AiCustomPrompt[],
        };
    }

    saveSettings(userId: number, settings: AppSettings): void {
        this.sqlite
            .prepare(
                `UPDATE settings
         SET poll_interval_minutes = ?, duplicate_article_window_days = ?,
             single_key_shortcuts = ?, mark_read_on_scroll = ?, show_youtube_descriptions = ?,
             translation_language = ?, summary_prompt = ?, translation_prompt = ?,
             custom_prompts_json = ?
         WHERE user_id = ?`,
            )
            .run(
                settings.pollIntervalMinutes,
                settings.duplicateArticleWindowDays,
                settings.singleKeyShortcuts ? 1 : 0,
                settings.markReadOnScroll ? 1 : 0,
                settings.showYouTubeDescriptions ? 1 : 0,
                settings.translationLanguage,
                settings.summaryPrompt,
                settings.translationPrompt,
                JSON.stringify(settings.customPrompts),
                userId,
            );
    }
}
