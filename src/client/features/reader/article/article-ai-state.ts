import type { ArticleAiSummary, ArticleAiTranslation } from "../../../../shared/types.js";

// Each panel is in exactly one state. The latest result travels through every state, so it stays
// readable while an update runs and reappears when the panel opens again.
export type ArticleSummaryViewState =
  | { kind: "closed"; promptId: string | null; summary: ArticleAiSummary | null; failed: boolean }
  | { kind: "loading"; promptId: string | null; summary: ArticleAiSummary | null }
  | { kind: "ready"; promptId: string | null; summary: ArticleAiSummary }
  | { kind: "outdated"; promptId: string | null; summary: null }
  | { kind: "failed"; promptId: string | null; summary: ArticleAiSummary | null; error: string }
  | { kind: "setup-needed"; promptId: string | null; summary: ArticleAiSummary | null };

export const EMPTY_ARTICLE_SUMMARY_STATE: ArticleSummaryViewState = {
  kind: "closed",
  promptId: null,
  summary: null,
  failed: false,
};

export function startSummary(
  previous: ArticleSummaryViewState,
  promptId: string | null,
  configured: boolean,
): ArticleSummaryViewState {
  // Updating keeps the current result readable; another action starts from its own skeleton.
  const summary = previous.promptId === promptId ? previous.summary : null;
  return configured
    ? { kind: "loading", promptId, summary }
    : { kind: "setup-needed", promptId, summary };
}

export function settleSummary(
  state: ArticleSummaryViewState,
  promptId: string | null,
  outcome: { summary: ArticleAiSummary } | { error: string },
): ArticleSummaryViewState {
  // A response for an action the reader has since switched away from must not replace it.
  if (state.kind !== "loading" || state.promptId !== promptId) return state;
  return "summary" in outcome
    ? { kind: "ready", promptId, summary: outcome.summary }
    : { kind: "failed", promptId, summary: state.summary, error: outcome.error };
}

export function closeSummary(state: ArticleSummaryViewState): ArticleSummaryViewState {
  return {
    kind: "closed",
    promptId: state.promptId,
    summary: state.summary,
    failed: state.kind === "failed",
  };
}

export function dropFeedTextSummary(state: ArticleSummaryViewState): ArticleSummaryViewState {
  // A result made from the feed text no longer describes the full article.
  if (!state.summary || state.summary.sourceKind === "full") return state;
  if (state.kind === "ready") return { kind: "outdated", promptId: state.promptId, summary: null };
  return { ...state, summary: null };
}

export type ArticleTranslationViewState =
  | { kind: "original"; translation: ArticleAiTranslation | null }
  | { kind: "translating"; translation: ArticleAiTranslation | null }
  | { kind: "translated"; translation: ArticleAiTranslation }
  | { kind: "failed"; translation: ArticleAiTranslation | null; error: string }
  | { kind: "setup-needed"; translation: ArticleAiTranslation | null };

export const EMPTY_ARTICLE_TRANSLATION_STATE: ArticleTranslationViewState = {
  kind: "original",
  translation: null,
};

export function showOriginal(state: ArticleTranslationViewState): ArticleTranslationViewState {
  if (state.kind !== "translating" && state.kind !== "translated") return state;
  return { kind: "original", translation: state.translation };
}

export function settleTranslation(
  state: ArticleTranslationViewState,
  outcome:
    | { translation: ArticleAiTranslation; current: boolean }
    | { error: string; configurationMissing: boolean },
): ArticleTranslationViewState {
  // Showing the original or changing the article text abandons the request.
  if (state.kind !== "translating") return state;
  if ("translation" in outcome) {
    return outcome.current
      ? { kind: "translated", translation: outcome.translation }
      : { kind: "original", translation: outcome.translation };
  }
  return outcome.configurationMissing
    ? { kind: "setup-needed", translation: state.translation }
    : { kind: "failed", translation: state.translation, error: outcome.error };
}
