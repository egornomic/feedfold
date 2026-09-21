import type { ArticleAiTranslation } from "../../../shared/types";

export interface ArticleSummaryViewState {
  visible: boolean;
  loading: boolean;
  error: string | null;
  configurationMissing: boolean;
  promptId: string | null;
}

export const EMPTY_ARTICLE_SUMMARY_STATE: ArticleSummaryViewState = {
  visible: false,
  loading: false,
  error: null,
  configurationMissing: false,
  promptId: null,
};

export interface ArticleTranslationViewState {
  visible: boolean;
  loading: boolean;
  error: string | null;
  configurationMissing: boolean;
  translation: ArticleAiTranslation | null;
}

export const EMPTY_ARTICLE_TRANSLATION_STATE: ArticleTranslationViewState = {
  visible: false,
  loading: false,
  error: null,
  configurationMissing: false,
  translation: null,
};
