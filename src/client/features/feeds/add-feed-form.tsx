import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  Globe2,
  LoaderCircle,
  MousePointer2,
  Plus,
  Rss,
  Search,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  Feed,
  FeedPreview,
  Folder,
  WebFeedAnalysis,
  WebPageFeedDiscovery,
} from "../../../shared/types";
import { api, errorMessage } from "../../api/api";
import { DropdownSelect } from "../../ui/dropdown";
import type { ReaderDataMutations } from "../reader/data-resource";
import { FeedEntriesPreview } from "./feed-entries-preview";
import { feedHost } from "./feed-format";
import {
  type AddFeedSourceType,
  feedSourceUrl,
  TELEGRAM_HANDLE_PATTERN,
  X_HANDLE_PATTERN,
  YOUTUBE_HANDLE_PATTERN,
} from "./feed-source";
import { ADD_FEED_SOURCE_OPTIONS } from "./feed-source-options";
import { folderPathLabel } from "./folder-hierarchy";
import { WebFeedSetup } from "./web-feed-setup";
import "./add-feed-form.css";

const ADD_FEED_INPUTS: Record<
  AddFeedSourceType,
  {
    label: string;
    heading: string;
    placeholder: string;
    help: string;
    prefix: string | null;
    pattern?: string;
    action: string;
    loading: string;
    add: string;
  }
> = {
  rss: {
    label: "Website or feed address",
    heading: "Which website or feed do you want to follow?",
    placeholder: "gwern.net/blog",
    help: "Enter a website or feed address. No need to include https://.",
    prefix: null,
    action: "Find feed",
    loading: "Finding the published feed",
    add: "Add feed",
  },
  youtube: {
    label: "YouTube channel handle",
    heading: "Which YouTube channel?",
    placeholder: "@kurzgesagt",
    help: "Enter the channel handle, with or without @. Links aren't supported.",
    prefix: "youtube.com/",
    pattern: YOUTUBE_HANDLE_PATTERN,
    action: "Preview channel",
    loading: "Loading channel",
    add: "Add YouTube feed",
  },
  telegram: {
    label: "Telegram channel handle",
    heading: "Which public Telegram channel?",
    placeholder: "durov",
    help: "Enter the public channel handle, with or without @. Links aren't supported.",
    prefix: "t.me/",
    pattern: TELEGRAM_HANDLE_PATTERN,
    action: "Preview channel",
    loading: "Loading channel",
    add: "Add Telegram feed",
  },
  x: {
    label: "X profile handle",
    heading: "Which X profile?",
    placeholder: "egornomic",
    help: "Enter the handle, with or without @. Links aren't supported. Updates come from Nitter RSS.",
    prefix: "x.com/",
    pattern: X_HANDLE_PATTERN,
    action: "Preview profile",
    loading: "Loading profile",
    add: "Add X feed",
  },
};

function FeedConfirmationSettings({
  title,
  folderId,
  folders,
  disabled,
  onTitleChange,
  onFolderChange,
}: {
  title: string;
  folderId: number | null;
  folders: Folder[];
  disabled: boolean;
  onTitleChange: (title: string) => void;
  onFolderChange: (folderId: number | null) => void;
}) {
  return (
    <div className="feed-confirmation-settings">
      <label className="field">
        <span>Name</span>
        <input
          value={title}
          disabled={disabled}
          onChange={(event) => onTitleChange(event.target.value)}
        />
      </label>
      <div className="field">
        <span>Folder</span>
        <DropdownSelect
          ariaLabel="Folder"
          value={folderId === null ? "" : String(folderId)}
          disabled={disabled}
          options={[
            { value: "", label: "No folder" },
            ...folders.map((folder) => ({
              value: String(folder.id),
              label: folderPathLabel(folder.id, folders),
            })),
          ]}
          onChange={(value) => onFolderChange(value ? Number(value) : null)}
        />
      </div>
    </div>
  );
}

function FeedConfirmationBar({
  sourceType,
  title,
  folderId,
  folders,
  disabled,
  existingFeed,
  canSave,
  onCancel,
  onTitleChange,
  onFolderChange,
}: {
  sourceType: AddFeedSourceType | "web";
  title: string;
  folderId: number | null;
  folders: Folder[];
  disabled: boolean;
  existingFeed?: Feed;
  canSave: boolean;
  onCancel: () => void;
  onTitleChange: (title: string) => void;
  onFolderChange: (folderId: number | null) => void;
}) {
  const addLabel = sourceType === "web" ? "Add web feed" : ADD_FEED_INPUTS[sourceType].add;
  const statusTitle = existingFeed ? "Already in your feeds" : "Finish setup";
  const statusDescription = existingFeed
    ? `You already follow this source as ${existingFeed.title}.`
    : "Give the feed a name and choose where it belongs.";
  const actionLabel = disabled
    ? `${addLabel.replace(/^Add /, "Adding ")}…`
    : existingFeed
      ? "Already added"
      : addLabel;

  return (
    <section
      className="feed-confirmation-bar"
      aria-label="Confirm subscription"
      data-blocked={!canSave || !!existingFeed || undefined}
    >
      <div className="feed-confirmation-status" aria-live="polite">
        {existingFeed ? (
          <CheckCircle2 aria-hidden="true" size={18} />
        ) : canSave ? (
          <Check aria-hidden="true" size={18} />
        ) : (
          <MousePointer2 aria-hidden="true" size={18} />
        )}
        <span>
          <strong>{statusTitle}</strong>
          <small>{statusDescription}</small>
        </span>
      </div>

      <FeedConfirmationSettings
        title={title}
        folderId={folderId}
        folders={folders}
        disabled={disabled || !!existingFeed}
        onTitleChange={onTitleChange}
        onFolderChange={onFolderChange}
      />

      <div className="feed-confirmation-actions">
        <button className="secondary-button" type="button" onClick={onCancel} disabled={disabled}>
          Back to feeds
        </button>
        <button
          className="primary-button"
          type="submit"
          disabled={disabled || !canSave || !!existingFeed}
        >
          {disabled ? (
            <LoaderCircle className="spin" aria-hidden="true" size={16} />
          ) : existingFeed ? (
            <Check aria-hidden="true" size={16} />
          ) : (
            <Plus aria-hidden="true" size={16} />
          )}
          {actionLabel}
        </button>
      </div>
    </section>
  );
}

export function AddFeedForm({
  feeds,
  folders,
  initialSourceUrl,
  initialSourceType,
  mutations,
  onCancel,
  onSaved,
}: {
  feeds: Feed[];
  folders: Folder[];
  initialSourceUrl: string;
  initialSourceType?: AddFeedSourceType;
  mutations: ReaderDataMutations;
  onCancel: () => void;
  onSaved: (feed: Feed) => Promise<void> | void;
}) {
  const [sourceType, setSourceType] = useState<AddFeedSourceType | null>(
    initialSourceType ?? (initialSourceUrl ? "rss" : null),
  );
  const [sourceInputs, setSourceInputs] = useState<Record<AddFeedSourceType, string>>({
    rss: initialSourceUrl,
    youtube: "",
    telegram: "",
    x: "",
  });
  const [previewSourceType, setPreviewSourceType] = useState<AddFeedSourceType>("rss");
  const [preview, setPreview] = useState<FeedPreview | null>(null);
  const [webPage, setWebPage] = useState<WebPageFeedDiscovery | null>(null);
  const [webAnalysis, setWebAnalysis] = useState<WebFeedAnalysis | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [folderId, setFolderId] = useState<number | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [analyzingWebPage, setAnalyzingWebPage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewHeadingRef = useRef<HTMLHeadingElement>(null);
  const sourceHeadingRef = useRef<HTMLHeadingElement>(null);
  const addressInputRef = useRef<HTMLInputElement>(null);
  const flowRef = useRef<HTMLElement>(null);
  const previewFocusFrame = useRef<number | null>(null);
  const autoDiscoveryStarted = useRef(false);
  const sourceInput = sourceType ? sourceInputs[sourceType] : "";
  const inputConfig = sourceType ? ADD_FEED_INPUTS[sourceType] : null;
  const sourceOption = sourceType
    ? ADD_FEED_SOURCE_OPTIONS.find((option) => option.value === sourceType)
    : null;
  const SelectedSourceIcon = sourceOption?.icon ?? Rss;
  const SourcePreviewIcon =
    ADD_FEED_SOURCE_OPTIONS.find((option) => option.value === previewSourceType)?.icon ?? Rss;
  const selectedCandidate =
    webAnalysis?.candidates.find((candidate) => candidate.id === selectedCandidateId) ?? null;
  const currentSourceUrl = preview?.feedUrl ?? webAnalysis?.pageUrl ?? webPage?.pageUrl;
  const existingFeed = currentSourceUrl
    ? feeds.find((feed) => feed.feedUrl === currentSourceUrl)
    : undefined;
  const stageKey =
    sourceType === null
      ? "source"
      : discovering || analyzingWebPage
        ? "loading"
        : preview
          ? "published-review"
          : webAnalysis
            ? "web-review"
            : webPage
              ? "web-offer"
              : "address";

  useLayoutEffect(() => {
    void stageKey;
    const scrollContainer = flowRef.current?.closest<HTMLElement>(".management-page");
    if (scrollContainer) scrollContainer.scrollTop = 0;
  }, [stageKey]);

  useEffect(
    () => () => {
      if (previewFocusFrame.current !== null) {
        window.cancelAnimationFrame(previewFocusFrame.current);
      }
    },
    [],
  );

  const clearDiscoveryResult = () => {
    setPreview(null);
    setWebPage(null);
    setWebAnalysis(null);
    setSelectedCandidateId(null);
    setTitle("");
    setError(null);
  };

  const selectSourceType = (nextSourceType: AddFeedSourceType) => {
    if (nextSourceType === sourceType) return;
    setSourceType(nextSourceType);
    clearDiscoveryResult();
    window.requestAnimationFrame(() => addressInputRef.current?.focus());
  };

  const chooseAnotherSource = () => {
    clearDiscoveryResult();
    setSourceType(null);
    window.requestAnimationFrame(() => sourceHeadingRef.current?.focus());
  };

  const editAddress = () => {
    clearDiscoveryResult();
    window.requestAnimationFrame(() => addressInputRef.current?.focus());
  };

  const discover = useCallback(async (url: string, requestedSourceType: AddFeedSourceType) => {
    if (previewFocusFrame.current !== null) {
      window.cancelAnimationFrame(previewFocusFrame.current);
      previewFocusFrame.current = null;
    }
    setDiscovering(true);
    setError(null);
    setPreview(null);
    setWebPage(null);
    setWebAnalysis(null);
    setSelectedCandidateId(null);
    try {
      const result = await api.discoverFeed(url);
      if (result.kind === "published") {
        setPreview(result.preview);
        setPreviewSourceType(requestedSourceType);
        setTitle(result.preview.title);
      } else {
        setWebPage(result);
        setTitle(result.title);
      }
      previewFocusFrame.current = window.requestAnimationFrame(() => {
        previewFocusFrame.current = null;
        previewHeadingRef.current?.focus({ preventScroll: true });
      });
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setDiscovering(false);
    }
  }, []);

  useEffect(() => {
    if (!initialSourceUrl || autoDiscoveryStarted.current) return;
    autoDiscoveryStarted.current = true;
    void discover(feedSourceUrl("rss", initialSourceUrl), "rss");
  }, [discover, initialSourceUrl]);

  const analyzeWebPage = async (url: string) => {
    setAnalyzingWebPage(true);
    setError(null);
    setPreview(null);
    setWebPage(null);
    setWebAnalysis(null);
    setSelectedCandidateId(null);
    try {
      const result = await api.analyzeWebPage(url);
      setWebAnalysis(result);
      setSelectedCandidateId(result.selectedCandidateId);
      setTitle(result.title);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setAnalyzingWebPage(false);
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if ((!preview && !selectedCandidate) || existingFeed) return;
    setSaving(true);
    setError(null);
    try {
      const feed = preview
        ? await mutations.createFeed({
            title: title.trim() || preview.title,
            feedUrl: preview.feedUrl,
            siteUrl: preview.siteUrl,
            folderId,
            sourceKind: "published",
          })
        : selectedCandidate
          ? await mutations.createFeed({
              title: title.trim() || webAnalysis?.title,
              feedUrl: selectedCandidate.config.pageUrl,
              siteUrl: selectedCandidate.config.pageUrl,
              folderId,
              sourceKind: "web",
              webConfig: selectedCandidate.config,
            })
          : null;
      if (!feed) return;
      await onSaved(feed);
    } catch (error) {
      setError(`Could not add this feed. ${errorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      ref={flowRef}
      className="add-feed-flow"
      aria-busy={discovering || analyzingWebPage || saving}
    >
      {sourceType === null ? (
        <div className="add-feed-stage add-feed-source-stage">
          <header className="add-feed-stage-heading">
            <span className="add-feed-step">Step 1 of 3 · Choose a source</span>
            <h2 ref={sourceHeadingRef} tabIndex={-1}>
              What do you want to follow?
            </h2>
            <p>Choose a source. You will preview what Feedfold found before anything is added.</p>
          </header>
          <div className="add-feed-source-list">
            {ADD_FEED_SOURCE_OPTIONS.map((option) => {
              const OptionIcon = option.icon;
              return (
                <button
                  className="add-feed-source-row"
                  data-source-type={option.value}
                  key={option.value}
                  type="button"
                  onClick={() => selectSourceType(option.value)}
                >
                  <span className="add-feed-source-mark" aria-hidden="true">
                    <OptionIcon size={19} />
                  </span>
                  <span className="add-feed-source-copy">
                    <span>
                      <strong>{option.label}</strong>
                      {option.recommended ? (
                        <span className="add-feed-recommended">Recommended</span>
                      ) : null}
                    </span>
                    <small>{option.description}</small>
                    <em>{option.detail}</em>
                  </span>
                  <ChevronRight aria-hidden="true" size={18} />
                </button>
              );
            })}
          </div>
        </div>
      ) : discovering || analyzingWebPage ? (
        <div className="add-feed-stage add-feed-loading-stage" role="status">
          <LoaderCircle className="spin" aria-hidden="true" size={24} />
          <span className="add-feed-step">Step 2 of 3 · Find the source</span>
          <h2>{analyzingWebPage ? "Finding repeatable entries" : inputConfig?.loading}</h2>
          <p>
            {analyzingWebPage
              ? "Feedfold is loading the page and looking for groups of links that repeat."
              : sourceType === "youtube"
                ? "Loading the channel's feed and its latest videos."
                : sourceType === "telegram"
                  ? "Loading the public channel and its latest posts."
                  : sourceType === "x"
                    ? "Loading the profile through Nitter RSS."
                    : "Checking the website for a published feed and loading its latest entries."}
          </p>
          <div className="feed-preview-loading-lines" aria-hidden="true">
            <div className="skeleton-line wide" />
            <div className="skeleton-line" />
            <div className="skeleton-line short" />
          </div>
        </div>
      ) : preview ? (
        <form
          className="add-feed-stage feed-confirmation-form"
          onSubmit={(event) => void save(event)}
        >
          <header className="add-feed-stage-heading add-feed-review-heading">
            <div>
              <span className="add-feed-step">Step 3 of 3 · Review and add</span>
              <h2 ref={previewHeadingRef} tabIndex={-1}>
                This feed is ready
              </h2>
              <p>Check the recent entries, then choose its name and folder.</p>
            </div>
            <button className="quiet-button" type="button" onClick={editAddress}>
              <ArrowLeft aria-hidden="true" size={15} />
              Edit address
            </button>
          </header>

          {error ? (
            <div className="feed-discovery-error" role="alert">
              <AlertTriangle aria-hidden="true" size={17} />
              <span>{error}</span>
            </div>
          ) : null}

          <section className="feed-preview" aria-labelledby="feed-preview-heading">
            <div className="feed-preview-header">
              <div className="feed-preview-mark" aria-hidden="true">
                <SourcePreviewIcon size={20} />
              </div>
              <div className="feed-preview-title-copy">
                <h3 id="feed-preview-heading">{preview.title}</h3>
                <div className="feed-preview-links">
                  {preview.siteUrl ? (
                    <a href={preview.siteUrl} target="_blank" rel="noreferrer">
                      {feedHost(preview.siteUrl)}
                      <ExternalLink aria-hidden="true" size={12} />
                    </a>
                  ) : (
                    <span>{feedHost(preview.feedUrl)}</span>
                  )}
                  <span aria-hidden="true">·</span>
                  <a href={preview.feedUrl} target="_blank" rel="noreferrer">
                    Open feed source
                    <ExternalLink aria-hidden="true" size={12} />
                  </a>
                </div>
              </div>
            </div>

            <FeedEntriesPreview articles={preview.articles} totalEntries={preview.totalArticles} />

            <FeedConfirmationBar
              sourceType={previewSourceType}
              title={title}
              folderId={folderId}
              folders={folders}
              disabled={saving}
              existingFeed={existingFeed}
              canSave
              onCancel={onCancel}
              onTitleChange={setTitle}
              onFolderChange={setFolderId}
            />
          </section>
        </form>
      ) : webAnalysis ? (
        <form
          className="add-feed-stage web-feed-confirmation-form"
          onSubmit={(event) => void save(event)}
        >
          <span className="add-feed-step">Step 3 of 3 · Choose and review</span>
          {error ? (
            <div className="feed-discovery-error" role="alert">
              <AlertTriangle aria-hidden="true" size={17} />
              <span>{error}</span>
            </div>
          ) : null}
          <WebFeedSetup
            analysis={webAnalysis}
            selectedCandidateId={selectedCandidateId}
            disabled={saving}
            busyLabel="Adding web feed…"
            onSelect={setSelectedCandidateId}
            onBack={editAddress}
            confirmation={
              selectedCandidate ? (
                <>
                  {!selectedCandidate.availableFields.includes("date") ? (
                    <p className="web-feed-date-fallback">
                      These entries have no publication date. Feedfold will use the time it first
                      discovers each one.
                    </p>
                  ) : null}
                  <FeedConfirmationBar
                    sourceType="web"
                    title={title}
                    folderId={folderId}
                    folders={folders}
                    disabled={saving}
                    existingFeed={existingFeed}
                    canSave
                    onCancel={onCancel}
                    onTitleChange={setTitle}
                    onFolderChange={setFolderId}
                  />
                </>
              ) : undefined
            }
          />
        </form>
      ) : webPage ? (
        <div className="add-feed-stage">
          <header className="add-feed-stage-heading">
            <span className="add-feed-step">Step 2 of 3 · Find the source</span>
            <h2 ref={previewHeadingRef} tabIndex={-1}>
              No RSS feed found
            </h2>
          </header>
          <div className="add-feed-fallback">
            <span className="add-feed-source-mark" aria-hidden="true">
              <Globe2 size={20} />
            </span>
            <div>
              <strong>Use a web feed instead</strong>
              <p>
                RSS delivers updates published by the site. A web feed checks this page for new
                links in a list you choose.
              </p>
            </div>
            <div className="add-feed-fallback-actions">
              <button className="secondary-button" type="button" onClick={editAddress}>
                Try another address
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => void analyzeWebPage(webPage.pageUrl)}
              >
                <Globe2 aria-hidden="true" size={16} />
                Set up web feed
              </button>
            </div>
          </div>
        </div>
      ) : inputConfig && sourceOption ? (
        <div className="add-feed-stage add-feed-address-stage">
          <header className="add-feed-stage-heading">
            <span className="add-feed-step">Step 2 of 3 · Enter the source</span>
            <h2>{inputConfig.heading}</h2>
            <p>{sourceOption.description}</p>
          </header>

          <div className="add-feed-selected-source">
            <span className="add-feed-source-mark" aria-hidden="true">
              <SelectedSourceIcon size={18} />
            </span>
            <span>
              <strong>{sourceOption.label}</strong>
              <small>{sourceOption.detail}</small>
            </span>
            <button className="quiet-button" type="button" onClick={chooseAnotherSource}>
              Change
            </button>
          </div>

          <form
            className="add-feed-address-form"
            onSubmit={(event) => {
              event.preventDefault();
              try {
                const url = feedSourceUrl(sourceType, sourceInput);
                void discover(url, sourceType);
              } catch (caught) {
                setError(errorMessage(caught));
              }
            }}
          >
            <label className="field feed-url-field">
              <span>{inputConfig.label}</span>
              <span
                className={
                  inputConfig.prefix ? "feed-source-input has-prefix" : "feed-source-input"
                }
              >
                {inputConfig.prefix ? <span aria-hidden="true">{inputConfig.prefix}</span> : null}
                <input
                  ref={addressInputRef}
                  type="text"
                  inputMode={sourceType === "rss" ? "url" : "text"}
                  required
                  value={sourceInput}
                  pattern={inputConfig.pattern}
                  title={inputConfig.help}
                  placeholder={inputConfig.placeholder}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "feed-url-help feed-discovery-error" : "feed-url-help"}
                  onChange={(event) => {
                    setSourceInputs((current) => ({
                      ...current,
                      [sourceType]: event.target.value,
                    }));
                    clearDiscoveryResult();
                  }}
                />
              </span>
              <small id="feed-url-help">{inputConfig.help}</small>
            </label>

            {error ? (
              <div id="feed-discovery-error" className="feed-discovery-error" role="alert">
                <AlertTriangle aria-hidden="true" size={17} />
                <span>{error}</span>
              </div>
            ) : null}

            <button className="primary-button" type="submit" disabled={!sourceInput.trim()}>
              <Search aria-hidden="true" size={16} />
              {inputConfig.action}
            </button>
          </form>
        </div>
      ) : null}
    </section>
  );
}
