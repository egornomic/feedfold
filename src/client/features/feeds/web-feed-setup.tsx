import {
  ArrowDown,
  ArrowLeft,
  Check,
  LoaderCircle,
  LockKeyhole,
  MousePointer2,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { WebFeedAnalysis, WebFeedCandidate, WebFeedField } from "../../../shared/types";
import { appUrl } from "../../api/api";
import { FeedEntriesPreview } from "./feed-entries-preview";
import { groupWebFeedCandidates } from "./web-feed-candidate-options";
import { parseWebFeedSelectionMessage, webFeedHighlightMessage } from "./web-feed-selection";
import "./web-feed-setup.css";

const WEB_FEED_FIELDS: WebFeedField[] = ["title", "link", "date", "author", "summary", "image"];

const WEB_FEED_FIELD_LABELS: Record<WebFeedField, string> = {
  title: "Title",
  link: "Link",
  date: "Date",
  author: "Author",
  summary: "Summary",
  image: "Image",
};

const COMPACT_WEB_FEED_QUERY = "(max-width: 620px)";

function candidateExample(candidate: WebFeedCandidate): string {
  const article = candidate.articles[0];
  return article?.title || article?.summary || "Untitled entry";
}

function compactWebFeedLayout(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(COMPACT_WEB_FEED_QUERY).matches
  );
}

function useCompactWebFeedLayout(): boolean {
  const [compact, setCompact] = useState(compactWebFeedLayout);

  useEffect(() => {
    const media = window.matchMedia(COMPACT_WEB_FEED_QUERY);
    const update = () => setCompact(media.matches);
    media.addEventListener("change", update);
    update();
    return () => media.removeEventListener("change", update);
  }, []);

  return compact;
}

export interface WebFeedSetupProps {
  analysis: WebFeedAnalysis;
  selectedCandidateId: string | null;
  disabled?: boolean;
  busyLabel?: string;
  confirmation?: ReactNode;
  onSelect: (candidateId: string | null) => void;
  onBack?: () => void;
}

function CandidateSuggestion({
  candidate,
  selected,
  recommended,
  disabled,
  onSelect,
}: {
  candidate: WebFeedCandidate;
  selected: boolean;
  recommended?: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`web-feed-suggestion${selected ? " is-selected" : ""}`}
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="web-feed-suggestion-state" aria-hidden="true">
        <Check size={11} strokeWidth={2.5} />
      </span>
      <span className="web-feed-suggestion-copy">
        <span>
          <strong>{candidate.label}</strong>
          {recommended ? <em>Recommended</em> : null}
        </span>
        <small>
          {candidate.itemCount} {candidate.itemCount === 1 ? "item" : "items"} ·{" "}
          {candidate.availableFields.length} of {WEB_FEED_FIELDS.length} fields
        </small>
        {candidate.articles[0] ? <small>Example: {candidateExample(candidate)}</small> : null}
      </span>
    </button>
  );
}

function FieldAvailability({ candidate }: { candidate: WebFeedCandidate }) {
  const availableFields = new Set(candidate.availableFields);

  return (
    <ul className="web-feed-field-availability" aria-label="Available article fields">
      {WEB_FEED_FIELDS.map((field) => {
        const available = availableFields.has(field);
        return (
          <li
            key={field}
            className={`web-feed-field${available ? " is-available" : " is-missing"}`}
          >
            {available ? <Check aria-hidden="true" size={12} /> : <span aria-hidden="true">–</span>}
            {WEB_FEED_FIELD_LABELS[field]}
            <span className="sr-only"> {available ? "available" : "not found"}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function WebFeedSetup({
  analysis,
  selectedCandidateId,
  disabled = false,
  busyLabel = "Saving selection…",
  confirmation,
  onSelect,
  onBack,
}: WebFeedSetupProps) {
  const compact = useCompactWebFeedLayout();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const suggestionsHeadingId = useId();
  const candidateIds = useMemo(
    () => new Set(analysis.candidates.map((candidate) => candidate.id)),
    [analysis.candidates],
  );
  const { suggested: suggestedCandidates, other: otherCandidates } = useMemo(
    () => groupWebFeedCandidates(analysis.candidates, analysis.suggestedCandidateIds),
    [analysis.candidates, analysis.suggestedCandidateIds],
  );
  const selectedCandidate =
    analysis.candidates.find((candidate) => candidate.id === selectedCandidateId) ?? null;

  const highlightSelection = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage(
      webFeedHighlightMessage(analysis.messageToken, selectedCandidate?.id ?? null),
      "*",
    );
  }, [analysis.messageToken, selectedCandidate?.id]);

  useEffect(() => {
    highlightSelection();
  }, [highlightSelection]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() =>
      headingRef.current?.focus({ preventScroll: true }),
    );
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const receiveSelection = (event: MessageEvent<unknown>) => {
      if (event.source !== iframeRef.current?.contentWindow) return;

      const action = parseWebFeedSelectionMessage(event.data, analysis.messageToken, candidateIds);
      if (!action || disabled) return;
      onSelect(action.candidateId);
    };

    window.addEventListener("message", receiveSelection);
    return () => window.removeEventListener("message", receiveSelection);
  }, [analysis.messageToken, candidateIds, disabled, onSelect]);

  const matchAnnouncement = selectedCandidate
    ? `${selectedCandidate.itemCount} matching ${selectedCandidate.itemCount === 1 ? "item is" : "items are"} highlighted.`
    : "No group is selected.";
  const reviewSelectedEntries = () => {
    const heading = reviewHeadingRef.current;
    if (!heading) return;
    heading.focus({ preventScroll: true });
    heading.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
  };
  const compactGroups = (
    <>
      {suggestedCandidates.length > 0 ? (
        <section
          className="web-feed-compact-group"
          aria-labelledby={`${suggestionsHeadingId}-suggested`}
        >
          <h5 id={`${suggestionsHeadingId}-suggested`}>Suggested</h5>
          {suggestedCandidates.map((candidate, index) => (
            <CandidateSuggestion
              key={candidate.id}
              candidate={candidate}
              selected={candidate.id === selectedCandidate?.id}
              recommended={index === 0}
              disabled={disabled}
              onSelect={() => onSelect(candidate.id)}
            />
          ))}
        </section>
      ) : null}
      {otherCandidates.length > 0 ? (
        <details className="web-feed-other-groups" open={suggestedCandidates.length === 0}>
          <summary>
            {suggestedCandidates.length > 0 ? "Other groups" : "Groups found"} (
            {otherCandidates.length})
          </summary>
          <div className="web-feed-compact-group">
            {otherCandidates.map((candidate) => (
              <CandidateSuggestion
                key={candidate.id}
                candidate={candidate}
                selected={candidate.id === selectedCandidate?.id}
                disabled={disabled}
                onSelect={() => onSelect(candidate.id)}
              />
            ))}
          </div>
        </details>
      ) : null}
    </>
  );

  return (
    <section className="web-feed-setup" aria-labelledby={headingId} aria-busy={disabled}>
      <header className="web-feed-setup-heading">
        {onBack ? (
          <button
            className="icon-button web-feed-back-button"
            type="button"
            disabled={disabled}
            onClick={onBack}
            aria-label="Back to website address"
          >
            <ArrowLeft aria-hidden="true" size={18} />
          </button>
        ) : null}
        <div className="web-feed-setup-title">
          <h3 ref={headingRef} id={headingId} tabIndex={-1}>
            Choose which entries to follow
          </h3>
          <p>
            {compact
              ? `Choose an entry group found on ${analysis.title}, then review its recent entries.`
              : `Choose a suggested group, or select one representative entry on ${analysis.title}.`}
          </p>
        </div>
        <span className="web-feed-selection-badge" aria-live="polite">
          {selectedCandidate ? (
            <Check aria-hidden="true" size={13} />
          ) : (
            <LockKeyhole aria-hidden="true" size={13} />
          )}
          {selectedCandidate ? `${selectedCandidate.itemCount} selected` : "Choose entries"}
        </span>
      </header>

      {compact ? (
        <fieldset className="web-feed-compact-picker">
          <legend className="sr-only">Entry groups found</legend>
          {selectedCandidate ? (
            <>
              <div className="web-feed-compact-selected">
                <span aria-hidden="true">
                  <Check size={13} strokeWidth={2.5} />
                </span>
                <div>
                  <strong>{selectedCandidate.label}</strong>
                  <small>
                    {selectedCandidate.itemCount} entries selected · Example:{" "}
                    {candidateExample(selectedCandidate)}
                  </small>
                </div>
              </div>
              <details key={selectedCandidate.id} className="web-feed-change-groups">
                <summary>Choose a different group</summary>
                {compactGroups}
              </details>
            </>
          ) : (
            <>
              <div className="web-feed-suggestions-heading">
                <h4>Entry groups found</h4>
                <p>Choose one group. An example from each group is shown below its name.</p>
              </div>
              {compactGroups}
            </>
          )}
        </fieldset>
      ) : (
        <div className="web-feed-workspace">
          <div className="web-feed-page-pane">
            <div className="web-feed-page-toolbar">
              <div>
                <strong>Page preview</strong>
                <span>
                  Scroll the page, then select one representative entry. Page controls are disabled.
                </span>
              </div>
              <span className="web-feed-match-count" aria-hidden="true">
                <MousePointer2 aria-hidden="true" size={14} />
                {selectedCandidate ? `${selectedCandidate.itemCount} matched` : "Select an entry"}
              </span>
            </div>
            <div className="web-feed-frame-wrap" data-disabled={disabled || undefined}>
              <iframe
                ref={iframeRef}
                key={`${analysis.snapshotId}:${analysis.messageToken}`}
                className="web-feed-frame"
                src={appUrl(`/api/web-feed-snapshots/${encodeURIComponent(analysis.snapshotId)}`)}
                title={`Select repeating items on ${analysis.title}`}
                sandbox="allow-scripts"
                referrerPolicy="no-referrer"
                tabIndex={disabled ? -1 : 0}
                onLoad={highlightSelection}
              />
              {disabled ? (
                <div className="web-feed-frame-busy" role="status">
                  <LoaderCircle className="spin" aria-hidden="true" size={16} />
                  <span>{busyLabel}</span>
                </div>
              ) : null}
            </div>
          </div>

          <aside className="web-feed-suggestions" aria-labelledby={suggestionsHeadingId}>
            <div className="web-feed-suggestions-heading">
              <h4 id={suggestionsHeadingId}>Suggested entry groups</h4>
              <p>Choose the group that should become this feed.</p>
            </div>
            {suggestedCandidates.length > 0 ? (
              <div className="web-feed-suggestion-list">
                {suggestedCandidates.map((candidate, index) => (
                  <CandidateSuggestion
                    key={candidate.id}
                    candidate={candidate}
                    selected={candidate.id === selectedCandidate?.id}
                    recommended={index === 0}
                    disabled={disabled}
                    onSelect={() => onSelect(candidate.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="web-feed-suggestions-empty" role="status">
                <p>
                  {analysis.candidates.length > 0
                    ? "No group could be recommended. Select one representative entry in the page preview."
                    : "This page has no repeated entry groups that feedfold can follow."}
                </p>
                {analysis.candidates.length === 0 && onBack ? (
                  <button className="secondary-button" type="button" onClick={onBack}>
                    Choose another page
                  </button>
                ) : null}
              </div>
            )}
            {selectedCandidate ? (
              <div className="web-feed-review-selection">
                <button
                  className="primary-button"
                  type="button"
                  disabled={disabled}
                  onClick={reviewSelectedEntries}
                >
                  Review selected entries
                  <ArrowDown aria-hidden="true" size={15} />
                </button>
              </div>
            ) : null}
          </aside>
        </div>
      )}

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {matchAnnouncement}
      </p>

      {selectedCandidate ? (
        <section className="web-feed-selected-preview" aria-labelledby={`${headingId}-preview`}>
          <div className="web-feed-preview-heading">
            <div>
              <h4 ref={reviewHeadingRef} id={`${headingId}-preview`} tabIndex={-1}>
                Review this entry group
              </h4>
              <p>These are the entries Feedfold will follow from this page.</p>
            </div>
            <FieldAvailability candidate={selectedCandidate} />
          </div>
          <FeedEntriesPreview
            articles={selectedCandidate.articles}
            totalEntries={selectedCandidate.itemCount}
            emptyMessage="This group has no entries that can be previewed."
          />
        </section>
      ) : null}

      {confirmation ? <div className="web-feed-confirmation-slot">{confirmation}</div> : null}
    </section>
  );
}
