import type Sqlite from "better-sqlite3";
import {
    type AppSettings,
    normalizeFeedPollInterval,
} from "../../../shared/types.js";
import type { AiRepository } from "../ai/repository.js";
import type { SettingsRepository } from "./repository.js";

export class SettingsService {
    constructor(
        private readonly sqlite: Sqlite.Database,
        private readonly repository: SettingsRepository,
        private readonly ai: AiRepository,
    ) {}

    getSettings(userId: number): AppSettings {
        return this.repository.getSettings(userId);
    }

    updateSettings(userId: number, input: Partial<AppSettings>): AppSettings {
        const current = this.repository.getSettings(userId);
        const next: AppSettings = {
            pollIntervalMinutes:
                input.pollIntervalMinutes === undefined
                    ? current.pollIntervalMinutes
                    : normalizeFeedPollInterval(input.pollIntervalMinutes),
            duplicateArticleWindowDays:
                input.duplicateArticleWindowDays ??
                current.duplicateArticleWindowDays,
            singleKeyShortcuts:
                input.singleKeyShortcuts ?? current.singleKeyShortcuts,
            markReadOnScroll:
                input.markReadOnScroll ?? current.markReadOnScroll,
            showYouTubeDescriptions:
                input.showYouTubeDescriptions ??
                current.showYouTubeDescriptions,
            translationLanguage:
                input.translationLanguage?.trim() ||
                current.translationLanguage,
            summaryPrompt: input.summaryPrompt?.trim() || current.summaryPrompt,
            translationPrompt:
                input.translationPrompt?.trim() || current.translationPrompt,
            customPrompts: input.customPrompts ?? current.customPrompts,
        };
        const nextCustomPrompts = new Map(
            next.customPrompts.map((prompt) => [prompt.id, prompt]),
        );
        const invalidatedPromptIds = current.customPrompts
            .filter(
                (prompt) =>
                    nextCustomPrompts.get(prompt.id)?.prompt !== prompt.prompt,
            )
            .map((prompt) => prompt.id);

        this.sqlite.transaction(() => {
            this.repository.saveSettings(userId, next);
            if (next.summaryPrompt !== current.summaryPrompt) {
                this.ai.deleteDefaultArticleSummaries(userId);
            }
            this.ai.deleteCustomPromptArticleSummaries(
                userId,
                invalidatedPromptIds,
            );
            if (next.translationPrompt !== current.translationPrompt) {
                this.ai.deleteArticleTranslations(userId);
            }
        })();
        return this.repository.getSettings(userId);
    }
}
