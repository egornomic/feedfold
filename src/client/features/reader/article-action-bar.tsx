import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  ChevronDown,
  Copy,
  Download,
  Ellipsis,
  ExternalLink,
  FileText,
  Languages,
  LoaderCircle,
  Mail,
  MailOpen,
  MessageSquareText,
  RefreshCw,
  Rss,
  Sparkles,
  Star,
} from "lucide-react";
import type { AiCustomPrompt, Article } from "../../../shared/types";
import { useActionMenu } from "./article-action-menu";
import type { ArticleSummaryViewState, ArticleTranslationViewState } from "./article-ai-state";

interface ArticleActionsProps {
  article: Article;
  fullContentVisible: boolean;
  summaryState: ArticleSummaryViewState;
  translationState: ArticleTranslationViewState;
  translationLanguage: string;
  customPrompts: AiCustomPrompt[];
  onPrevious?: () => void;
  onNext?: () => void;
  canPrevious?: boolean;
  canNext?: boolean;
  navigationPending?: boolean;
  onToggleRead: (article: Article) => void;
  onToggleStar: (article: Article) => void;
  onCopy: (article: Article) => void;
  onOpenSource: (article: Article) => void;
  onToggleFullContent: (article: Article) => void;
  onRunSummaryPrompt: (article: Article, promptId: string | null) => void;
  onToggleTranslation: (article: Article) => void;
}

export function ArticleActions({
  article,
  fullContentVisible,
  summaryState,
  translationState,
  translationLanguage,
  customPrompts,
  onPrevious,
  onNext,
  canPrevious = true,
  canNext = true,
  navigationPending = false,
  onToggleRead,
  onToggleStar,
  onCopy,
  onOpenSource,
  onToggleFullContent,
  onRunSummaryPrompt,
  onToggleTranslation,
}: ArticleActionsProps) {
  const summaryMenu = useActionMenu();
  const moreMenu = useActionMenu();
  const summaryMenuId = `article-${article.id}-summary-menu`;
  const summaryAnchorName = `--article-${article.id}-summary`;
  const moreMenuId = `article-${article.id}-more-menu`;
  const moreAnchorName = `--article-${article.id}-more`;
  const fullContentAvailable = Boolean(article.url) && !article.media;
  const cachedFullContent = article.extractionStatus === "complete" && Boolean(article.contentHtml);
  const fullContentLoading =
    fullContentVisible &&
    (article.extractionStatus === "pending" || article.extractionStatus === "processing");
  const fullContentLoaded = fullContentVisible && cachedFullContent;
  const fullContentFailed = fullContentVisible && article.extractionStatus === "failed";
  const fullContentLabel = fullContentLoading
    ? "Loading the full article"
    : fullContentLoaded
      ? "Show feed text"
      : fullContentFailed
        ? "Retry full article"
        : cachedFullContent
          ? "Show full article"
          : "Load full article";
  const FullContentIcon = fullContentLoading
    ? LoaderCircle
    : fullContentLoaded
      ? Rss
      : fullContentFailed
        ? RefreshCw
        : cachedFullContent
          ? FileText
          : Download;
  const translationLabel = translationState.loading
    ? `Translating to ${translationLanguage}`
    : translationState.visible
      ? "Show original article"
      : translationState.error
        ? `Retry ${translationLanguage} translation`
        : `Translate to ${translationLanguage}`;
  const readTooltip = article.isRead ? "Mark as unread (U)" : "Mark as read (U)";
  const savedTooltip = article.isStarred ? "Remove from Saved (S)" : "Save article (S)";
  return (
    <div className="article-actions" role="toolbar" aria-label="Article actions">
      {onPrevious ? (
        <button
          className="article-navigation-action"
          type="button"
          disabled={!canPrevious || navigationPending}
          onClick={onPrevious}
          aria-label="Previous article (K)"
          data-tooltip="Previous article (K)"
        >
          <ArrowLeft aria-hidden="true" size={16} />
        </button>
      ) : null}
      {onNext ? (
        <button
          className="article-navigation-action"
          type="button"
          disabled={!canNext || navigationPending}
          onClick={onNext}
          aria-label="Next article (J)"
          data-tooltip="Next article (J)"
        >
          <ArrowRight aria-hidden="true" size={16} />
        </button>
      ) : null}
      <span className="action-divider" aria-hidden="true" />
      {fullContentAvailable ? (
        <button
          className="full-content-action"
          type="button"
          disabled={fullContentLoading}
          aria-pressed={fullContentLoaded}
          onClick={() => onToggleFullContent(article)}
          aria-label={`${fullContentLabel} (W)`}
          data-tooltip={`${fullContentLabel} (W)`}
        >
          <FullContentIcon
            className={fullContentLoading ? "spin" : undefined}
            aria-hidden="true"
            size={16}
          />
        </button>
      ) : null}
      <button
        ref={summaryMenu.triggerRef}
        className="summary-action"
        type="button"
        disabled={summaryState.loading}
        aria-haspopup="menu"
        aria-expanded={summaryMenu.open}
        aria-pressed={summaryState.visible}
        aria-controls={summaryMenuId}
        popoverTarget={summaryMenuId}
        style={{ anchorName: summaryAnchorName }}
        onPointerDown={summaryMenu.handleTriggerPointerDown}
        onKeyDown={summaryMenu.handleTriggerKeyDown}
        aria-label="Choose an AI action"
        data-tooltip="Choose an AI action"
      >
        {summaryState.loading ? (
          <LoaderCircle className="spin" aria-hidden="true" size={16} />
        ) : summaryState.error && !summaryState.visible ? (
          <RefreshCw aria-hidden="true" size={16} />
        ) : (
          <Sparkles
            aria-hidden="true"
            size={16}
            fill={summaryState.visible ? "currentColor" : "none"}
          />
        )}
        <ChevronDown className="summary-action-chevron" aria-hidden="true" size={10} />
      </button>
      <div
        ref={summaryMenu.menuRef}
        id={summaryMenuId}
        className="summary-prompt-menu context-action-menu"
        popover="auto"
        role="menu"
        aria-label="AI actions"
        style={{ positionAnchor: summaryAnchorName }}
        onToggle={summaryMenu.handleMenuToggle}
        onKeyDown={summaryMenu.handleMenuKeyDown}
      >
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            summaryMenu.closeMenu();
            onRunSummaryPrompt(article, null);
          }}
        >
          <Sparkles aria-hidden="true" size={15} />
          <span>Summarize</span>
          <kbd>M</kbd>
        </button>
        {customPrompts.length > 0 ? <hr className="context-menu-separator" /> : null}
        {customPrompts.map((prompt) => (
          <button
            key={prompt.id}
            type="button"
            role="menuitem"
            onClick={() => {
              summaryMenu.closeMenu();
              onRunSummaryPrompt(article, prompt.id);
            }}
          >
            <MessageSquareText aria-hidden="true" size={15} />
            <span>{prompt.name}</span>
          </button>
        ))}
      </div>
      <button
        className="translation-action"
        type="button"
        disabled={translationState.loading}
        aria-pressed={translationState.visible}
        onClick={() => onToggleTranslation(article)}
        aria-label={`${translationLabel} (T)`}
        data-tooltip={`${translationLabel} (T)`}
      >
        {translationState.loading ? (
          <LoaderCircle className="spin" aria-hidden="true" size={16} />
        ) : translationState.visible ? (
          <BookOpenText aria-hidden="true" size={16} />
        ) : (
          <Languages aria-hidden="true" size={16} />
        )}
      </button>
      <span className="action-divider" aria-hidden="true" />
      <button
        className="read-state-action"
        type="button"
        aria-label={readTooltip}
        aria-pressed={article.isRead}
        onClick={() => onToggleRead(article)}
        data-tooltip={readTooltip}
      >
        {article.isRead ? (
          <MailOpen aria-hidden="true" size={16} />
        ) : (
          <Mail aria-hidden="true" size={16} />
        )}
      </button>
      <button
        className={`star-state-action${article.isStarred ? " is-starred" : ""}`}
        type="button"
        aria-pressed={article.isStarred}
        onClick={() => onToggleStar(article)}
        aria-label={savedTooltip}
        data-tooltip={savedTooltip}
      >
        <Star aria-hidden="true" size={16} fill={article.isStarred ? "currentColor" : "none"} />
      </button>
      <button
        className="copy-action"
        type="button"
        onClick={() => onCopy(article)}
        aria-label="Copy article link (C)"
        data-tooltip="Copy article link (C)"
      >
        <Copy aria-hidden="true" size={16} />
      </button>
      <button
        className="open-source-action"
        type="button"
        onClick={() => onOpenSource(article)}
        aria-label="Open article source (O)"
        data-tooltip="Open article source (O)"
      >
        <ExternalLink aria-hidden="true" size={16} />
      </button>
      <button
        ref={moreMenu.triggerRef}
        className="article-more-action"
        type="button"
        aria-label="More article actions"
        aria-haspopup="menu"
        aria-expanded={moreMenu.open}
        aria-controls={moreMenuId}
        popoverTarget={moreMenuId}
        style={{ anchorName: moreAnchorName }}
        onPointerDown={moreMenu.handleTriggerPointerDown}
        onKeyDown={moreMenu.handleTriggerKeyDown}
        data-tooltip="More article actions"
      >
        <Ellipsis aria-hidden="true" size={18} />
      </button>
      <div
        ref={moreMenu.menuRef}
        id={moreMenuId}
        className="article-more-menu context-action-menu"
        popover="auto"
        role="menu"
        aria-label="More article actions"
        style={{ positionAnchor: moreAnchorName }}
        onToggle={moreMenu.handleMenuToggle}
        onKeyDown={moreMenu.handleMenuKeyDown}
      >
        {fullContentAvailable ? (
          <>
            <button
              type="button"
              role="menuitem"
              disabled={fullContentLoading}
              onClick={() => {
                moreMenu.closeMenu();
                onToggleFullContent(article);
              }}
            >
              <FullContentIcon
                className={fullContentLoading ? "spin" : undefined}
                aria-hidden="true"
                size={15}
              />
              <span>{fullContentLabel}</span>
              <kbd>W</kbd>
            </button>
            <hr className="context-menu-separator" />
          </>
        ) : null}
        <button
          type="button"
          role="menuitem"
          disabled={translationState.loading}
          onClick={() => {
            moreMenu.closeMenu();
            onToggleTranslation(article);
          }}
        >
          {translationState.loading ? (
            <LoaderCircle className="spin" aria-hidden="true" size={15} />
          ) : translationState.visible ? (
            <BookOpenText aria-hidden="true" size={15} />
          ) : (
            <Languages aria-hidden="true" size={15} />
          )}
          <span>{translationLabel}</span>
          <kbd>T</kbd>
        </button>
        <hr className="context-menu-separator" />
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            moreMenu.closeMenu();
            onToggleRead(article);
          }}
        >
          {article.isRead ? (
            <Mail aria-hidden="true" size={15} />
          ) : (
            <MailOpen aria-hidden="true" size={15} />
          )}
          <span>{article.isRead ? "Mark as unread" : "Mark as read"}</span>
          <kbd>U</kbd>
        </button>
        <hr className="context-menu-separator" />
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            moreMenu.closeMenu();
            onCopy(article);
          }}
        >
          <Copy aria-hidden="true" size={15} />
          <span>Copy article link</span>
          <kbd>C</kbd>
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            moreMenu.closeMenu();
            onOpenSource(article);
          }}
        >
          <ExternalLink aria-hidden="true" size={15} />
          <span>Open article source</span>
          <kbd>O</kbd>
        </button>
      </div>
    </div>
  );
}
