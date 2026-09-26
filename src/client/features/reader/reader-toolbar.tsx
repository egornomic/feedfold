import {
  Check,
  ChevronDown,
  CircleHelp,
  Ellipsis,
  FileText,
  LayoutList,
  Menu as MenuIcon,
  RefreshCw,
  Rss,
  Search,
  X,
} from "lucide-react";
import { type FormEvent, useLayoutEffect, useRef, useState } from "react";
import type { ArticleState, MarkReadAgeDays, ReadingMode } from "../../../shared/types";
import { MARK_READ_AGE_DAYS } from "../../../shared/types";
import { IconButton } from "../../ui/controls";
import { Menu, MenuItem, MenuPopup } from "../../ui/menu";
import { useMotionPresence } from "../../ui/motion";

interface ReaderToolbarProps {
  title: string;
  articleState: ArticleState;
  unreadCount: number;
  searchInput: string;
  searchActive: boolean;
  mode: ReadingMode;
  refreshing: boolean;
  markReadPending: boolean;
  navOpen: boolean;
  readingArticle: boolean;
  manualRefreshEnabled: boolean;
  onToggleNav: () => void;
  onArticleStateChange: (state: "unread" | "all") => void;
  onSearchInput: (value: string) => void;
  onSearch: (event: FormEvent) => void;
  onClearSearch: () => void;
  onModeChange: (mode: ReadingMode) => void;
  onRefresh: () => void;
  onRefreshAll: () => void;
  onMarkRead: () => void;
  onMarkReadByAge: (days: MarkReadAgeDays) => void;
  onHelp: () => void;
}

export function ReaderToolbar({
  title,
  articleState,
  unreadCount,
  searchInput,
  searchActive,
  mode,
  refreshing,
  markReadPending,
  navOpen,
  readingArticle,
  manualRefreshEnabled,
  onToggleNav,
  onArticleStateChange,
  onSearchInput,
  onSearch,
  onClearSearch,
  onModeChange,
  onRefresh,
  onRefreshAll,
  onMarkRead,
  onMarkReadByAge,
  onHelp,
}: ReaderToolbarProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchToggleRef = useRef<HTMLButtonElement>(null);
  const searchExpanded = searchOpen || searchActive || Boolean(searchInput);
  const searchPresence = useMotionPresence(searchExpanded);
  const showArticleStateSwitcher =
    !readingArticle && (articleState === "unread" || articleState === "all");

  useLayoutEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  function closeSearch() {
    setSearchOpen(false);
    onClearSearch();
    searchToggleRef.current?.focus();
  }

  return (
    <header
      className={`reader-toolbar${readingArticle ? " is-reading-article" : searchPresence.present ? " is-search-open" : ""}`}
    >
      <div className="reader-title-row">
        <IconButton
          label={navOpen ? "Close navigation" : "Open navigation"}
          onClick={onToggleNav}
          className="menu-button"
          tooltip
        >
          <MenuIcon aria-hidden="true" size={19} />
        </IconButton>
        <div className="scope-title">
          <h1>{title}</h1>
        </div>
        {showArticleStateSwitcher ? (
          <fieldset className="segmented-control article-state-switcher">
            <legend className="sr-only">Article filter</legend>
            <button
              type="button"
              aria-pressed={articleState === "unread"}
              onClick={() => onArticleStateChange("unread")}
            >
              {unreadCount} Unread
            </button>
            <button
              type="button"
              aria-pressed={articleState === "all"}
              onClick={() => onArticleStateChange("all")}
            >
              All articles
            </button>
          </fieldset>
        ) : null}
        <button
          ref={searchToggleRef}
          className="icon-button search-toggle"
          type="button"
          aria-label={searchExpanded ? "Close search" : "Search articles"}
          aria-expanded={searchExpanded}
          aria-controls={searchExpanded ? "article-search-form" : undefined}
          data-tooltip={searchExpanded ? "Close search" : "Search articles"}
          onClick={() => (searchExpanded ? closeSearch() : setSearchOpen(true))}
        >
          {searchExpanded ? (
            <X aria-hidden="true" size={19} />
          ) : (
            <Search aria-hidden="true" size={19} />
          )}
        </button>
        {searchPresence.present ? (
          <form
            id="article-search-form"
            className="search-form"
            data-motion-state={searchPresence.state}
            inert={!searchExpanded}
            aria-label="Article search"
            onSubmit={onSearch}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              event.stopPropagation();
              closeSearch();
            }}
          >
            <Search aria-hidden="true" size={16} />
            <label className="sr-only" htmlFor="article-search">
              Search articles
            </label>
            <input
              ref={searchInputRef}
              id="article-search"
              type="search"
              value={searchInput}
              placeholder="Search articles"
              onChange={(event) => onSearchInput(event.target.value)}
            />
            {searchInput || searchActive ? (
              <button
                type="button"
                onClick={() => {
                  setSearchOpen(true);
                  onClearSearch();
                  searchInputRef.current?.focus();
                }}
                aria-label="Clear search"
              >
                <X aria-hidden="true" size={15} />
              </button>
            ) : null}
            <button className="search-submit" type="submit">
              Search
            </button>
          </form>
        ) : null}
        <fieldset className="view-switcher">
          <legend className="sr-only">Reading view</legend>
          <button
            type="button"
            aria-label="Magazine view"
            data-tooltip="Magazine view (1)"
            aria-pressed={mode === "magazine"}
            onClick={() => onModeChange("magazine")}
          >
            <LayoutList aria-hidden="true" size={16} />
          </button>
          <button
            type="button"
            aria-label="Expanded view"
            data-tooltip="Expanded view (2)"
            aria-pressed={mode === "expanded"}
            onClick={() => onModeChange("expanded")}
          >
            <FileText aria-hidden="true" size={16} />
          </button>
        </fieldset>
        {!readingArticle ? (
          <ReaderOptionsMenu
            articleState={articleState}
            unreadCount={unreadCount}
            showArticleFilters={showArticleStateSwitcher}
            mode={mode}
            onArticleStateChange={onArticleStateChange}
            onModeChange={onModeChange}
          />
        ) : null}
        <div className="toolbar-actions">
          {manualRefreshEnabled ? (
            <>
              <IconButton
                label="Refresh this view (R)"
                onClick={onRefresh}
                disabled={refreshing}
                tooltip
              >
                <RefreshCw className={refreshing ? "spin" : ""} aria-hidden="true" size={17} />
              </IconButton>
              <IconButton
                label="Refresh all feeds (Shift+R)"
                onClick={onRefreshAll}
                disabled={refreshing}
                className="refresh-all-action"
                tooltip
              >
                <Rss aria-hidden="true" size={17} />
              </IconButton>
            </>
          ) : null}
          <MarkReadSplitButton
            disabled={markReadPending}
            onMarkRead={onMarkRead}
            onMarkReadByAge={onMarkReadByAge}
          />
          <IconButton
            label="Open keyboard shortcut reference (?)"
            onClick={onHelp}
            className="help-action"
            tooltip
          >
            <CircleHelp aria-hidden="true" size={18} />
          </IconButton>
        </div>
      </div>
    </header>
  );
}

const READER_OPTIONS_MENU_ID = "reader-options-menu";

function ReaderOptionsMenu({
  articleState,
  unreadCount,
  showArticleFilters,
  mode,
  onArticleStateChange,
  onModeChange,
}: {
  articleState: ArticleState;
  unreadCount: number;
  showArticleFilters: boolean;
  mode: ReadingMode;
  onArticleStateChange: (state: "unread" | "all") => void;
  onModeChange: (mode: ReadingMode) => void;
}) {
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger className="icon-button reader-options-trigger" aria-label="Reader options">
        <Ellipsis aria-hidden="true" size={18} />
      </Menu.Trigger>
      <MenuPopup
        id={READER_OPTIONS_MENU_ID}
        className="reader-options-menu dropdown-select-menu dropdown-menu-surface"
        aria-label="Reader options"
      >
        {showArticleFilters ? (
          <Menu.RadioGroup
            className="dropdown-select-group"
            value={articleState}
            onValueChange={onArticleStateChange}
            aria-labelledby="article-options-label"
          >
            <div id="article-options-label" className="dropdown-select-group-label">
              Articles
            </div>
            {(["unread", "all"] as const).map((state) => (
              <Menu.RadioItem
                key={state}
                value={state}
                className="dropdown-select-option"
                render={<button type="button" />}
                nativeButton
                closeOnClick
              >
                <span>{state === "unread" ? `${unreadCount} Unread` : "All articles"}</span>
                <Menu.RadioItemIndicator>
                  <Check aria-hidden="true" size={15} />
                </Menu.RadioItemIndicator>
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
        ) : null}
        <Menu.RadioGroup
          className="dropdown-select-group"
          value={mode}
          onValueChange={onModeChange}
          aria-labelledby="view-options-label"
        >
          <div id="view-options-label" className="dropdown-select-group-label">
            Reading view
          </div>
          {(["magazine", "expanded"] as const).map((view) => (
            <Menu.RadioItem
              key={view}
              value={view}
              className="dropdown-select-option"
              render={<button type="button" />}
              nativeButton
              closeOnClick
            >
              <span>{view === "magazine" ? "Magazine" : "Expanded"}</span>
              <Menu.RadioItemIndicator>
                <Check aria-hidden="true" size={15} />
              </Menu.RadioItemIndicator>
            </Menu.RadioItem>
          ))}
        </Menu.RadioGroup>
      </MenuPopup>
    </Menu.Root>
  );
}

const MARK_READ_AGE_LABELS: Record<MarkReadAgeDays, string> = {
  1: "Older than a day",
  2: "Older than two days",
  3: "Older than three days",
  7: "Older than a week",
  14: "Older than two weeks",
};

const MARK_READ_MENU_ID = "mark-read-age-menu";
const MARK_READ_MENU_HEADING_ID = "mark-read-age-menu-heading";

function MarkReadSplitButton({
  disabled,
  onMarkRead,
  onMarkReadByAge,
}: {
  disabled: boolean;
  onMarkRead: () => void;
  onMarkReadByAge: (days: MarkReadAgeDays) => void;
}) {
  return (
    <div className="mark-read-split-button">
      <IconButton
        label="Mark loaded articles as read"
        onClick={onMarkRead}
        disabled={disabled}
        className="mark-read-primary"
        tooltip
      >
        <CheckCheckIcon />
      </IconButton>
      <Menu.Root modal={false} disabled={disabled}>
        <Menu.Trigger
          className="icon-button mark-read-menu-trigger"
          aria-label="Mark older articles as read"
          data-tooltip="Mark older articles as read"
          disabled={disabled}
        >
          <ChevronDown aria-hidden="true" size={16} />
        </Menu.Trigger>
        <MenuPopup
          id={MARK_READ_MENU_ID}
          className="mark-read-menu context-action-menu"
          aria-labelledby={MARK_READ_MENU_HEADING_ID}
        >
          <p id={MARK_READ_MENU_HEADING_ID}>Mark older articles as read</p>
          {MARK_READ_AGE_DAYS.map((days) => (
            <MenuItem key={days} onClick={() => onMarkReadByAge(days)}>
              {MARK_READ_AGE_LABELS[days]}
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu.Root>
    </div>
  );
}

function CheckCheckIcon() {
  return (
    <span className="check-check" aria-hidden="true">
      <Check size={15} />
      <Check size={15} />
    </span>
  );
}
