import { AlertTriangle, Languages, LoaderCircle, RefreshCw, Sparkles } from "lucide-react";
import { useRef } from "react";
import type { AiCustomPrompt, Article } from "../../../../shared/types";
import { useMotionPresence } from "../../../motion";
import { AiMarkdown } from "./ai-markdown";
import type { ArticleSummaryViewState, ArticleTranslationViewState } from "./article-ai-state";

export function ArticleSummaryPanel({
  article,
  state,
  customPrompts,
  onRegenerate,
  onOpenSettings,
}: {
  article: Article;
  state: ArticleSummaryViewState;
  customPrompts: AiCustomPrompt[];
  onRegenerate: (article: Article) => void;
  onOpenSettings: () => void;
}) {
  const summaryPresence = useMotionPresence(state.visible);
  const retainedState = useRef(state);
  if (state.visible) retainedState.current = state;
  const displayedState = state.visible ? state : retainedState.current;
  if (!summaryPresence.present) return null;
  const summary = article.aiSummary;
  const titleId = `article-${article.id}-ai-summary-title`;
  const displayedPromptId = summary ? summary.promptId : displayedState.promptId;
  const customPromptName = displayedPromptId
    ? customPrompts.find((prompt) => prompt.id === displayedPromptId)?.name
    : null;

  return (
    <section
      id={`article-${article.id}-ai-summary`}
      className="article-ai-summary"
      data-motion-state={summaryPresence.state}
      inert={summaryPresence.state === "closed" ? true : undefined}
      aria-labelledby={titleId}
      aria-hidden={summaryPresence.state === "closed"}
      aria-live="polite"
      aria-busy={displayedState.loading}
    >
      <div className="article-ai-summary-heading">
        <div>
          <Sparkles aria-hidden="true" size={17} />
          <h3 id={titleId}>{customPromptName ?? "Summary"}</h3>
        </div>
        {summary ? (
          <button
            className="quiet-button article-summary-regenerate"
            type="button"
            disabled={displayedState.loading}
            onClick={() => onRegenerate(article)}
          >
            {displayedState.loading ? (
              <LoaderCircle className="spin" aria-hidden="true" size={14} />
            ) : (
              <RefreshCw aria-hidden="true" size={14} />
            )}
            {displayedState.loading ? "Updating summary" : "Update summary"}
          </button>
        ) : null}
      </div>

      {displayedState.loading && !summary ? (
        <div className="article-summary-loading" role="status">
          <span>Generating summary</span>
          <div className="article-summary-skeleton" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </div>
      ) : displayedState.configurationMissing ? (
        <div className="article-summary-message">
          <strong>Set up summaries first</strong>
          <p>In Settings, choose an AI provider and save its API key.</p>
          <button className="secondary-button" type="button" onClick={onOpenSettings}>
            Open Settings
          </button>
        </div>
      ) : summary ? (
        <div className="article-summary-text">
          <AiMarkdown text={summary.text} grounding={summary.grounding} />
        </div>
      ) : !displayedState.error ? (
        <div className="article-summary-message">
          <strong>This summary is out of date</strong>
          <p>The article text has changed. Create a summary from the current text.</p>
          <button className="secondary-button" type="button" onClick={() => onRegenerate(article)}>
            <Sparkles aria-hidden="true" size={14} />
            Update summary
          </button>
        </div>
      ) : null}

      {displayedState.error ? (
        <div className="article-summary-error" role="alert">
          <AlertTriangle aria-hidden="true" size={16} />
          <div>
            <strong>Could not create the summary</strong>
            <p>{displayedState.error}</p>
          </div>
          {!summary ? (
            <button
              className="secondary-button"
              type="button"
              disabled={displayedState.loading}
              onClick={() => onRegenerate(article)}
            >
              <RefreshCw aria-hidden="true" size={14} />
              Try again
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function ArticleTranslationNotice({
  state,
  language,
  onOpenSettings,
}: {
  state: ArticleTranslationViewState;
  language: string;
  onOpenSettings: () => void;
}) {
  if (state.visible || (!state.loading && !state.configurationMissing && !state.error)) return null;
  if (state.loading) {
    return (
      <div className="article-extraction-state article-translation-state" role="status">
        <LoaderCircle className="spin" aria-hidden="true" size={18} />
        <div>
          <strong>Translating to {language}</strong>
          <p>You can keep reading the original until the translation is ready.</p>
        </div>
      </div>
    );
  }
  if (state.configurationMissing) {
    return (
      <div className="article-extraction-state article-translation-state" role="note">
        <Languages aria-hidden="true" size={18} />
        <div>
          <strong>Set up translations first</strong>
          <p>In Settings, choose an AI provider and save its API key.</p>
          <button className="secondary-button" type="button" onClick={onOpenSettings}>
            Open Settings
          </button>
        </div>
      </div>
    );
  }
  return (
    <div
      className="article-extraction-state article-translation-state extraction-failed"
      role="alert"
    >
      <AlertTriangle aria-hidden="true" size={18} />
      <div>
        <strong>Could not translate the article</strong>
        <p>{state.error}</p>
      </div>
    </div>
  );
}
