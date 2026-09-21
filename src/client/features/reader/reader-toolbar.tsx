import {
  Check,
  ChevronDown,
  CircleHelp,
  Ellipsis,
  FileText,
  LayoutList,
  Menu,
  RefreshCw,
  Rss,
  Search,
  X,
} from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { ArticleState, MarkReadAgeDays, ReadingMode } from "../../../shared/types";
import { MARK_READ_AGE_DAYS } from "../../../shared/types";
import { handleActionMenuKeyDown } from "../../feed-management";
import { useMotionPresence } from "../../motion";
import { IconButton } from "../navigation/navigation-controls";

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
          <Menu aria-hidden="true" size={19} />
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<"current" | "first" | "last">("current");
  const [open, setOpen] = useState(false);

  const optionButtons = () =>
    Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [],
    );

  const focusOption = (target: "current" | "first" | "last") => {
    const options = optionButtons();
    const current = options.find((option) => option.getAttribute("aria-checked") === "true");
    const next = target === "first" ? options[0] : target === "last" ? options.at(-1) : current;
    next?.focus({ preventScroll: true });
  };

  const closeMenu = useCallback((restoreFocus = true) => {
    const menu = menuRef.current;
    if (menu?.matches(":popover-open")) menu.hidePopover();
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  }, []);

  const openMenu = (target: "current" | "first" | "last") => {
    pendingFocus.current = target;
    const menu = menuRef.current;
    if (menu && !menu.matches(":popover-open")) menu.showPopover();
  };

  const handleToggle = (event: SyntheticEvent<HTMLDivElement>) => {
    const nextOpen = event.currentTarget.matches(":popover-open");
    setOpen(nextOpen);
    if (nextOpen) window.requestAnimationFrame(() => focusOption(pendingFocus.current));
  };

  const chooseArticleState = (state: "unread" | "all") => {
    closeMenu();
    onArticleStateChange(state);
  };

  const chooseMode = (nextMode: ReadingMode) => {
    closeMenu();
    onModeChange(nextMode);
  };

  const menu = (
    <div
      ref={menuRef}
      id={READER_OPTIONS_MENU_ID}
      className="reader-options-menu dropdown-select-menu dropdown-menu-surface"
      popover="auto"
      role="menu"
      aria-label="Reader options"
      onToggle={handleToggle}
      onKeyDown={(event) => handleActionMenuKeyDown(event, closeMenu)}
    >
      {showArticleFilters ? (
        <fieldset className="dropdown-select-group" aria-labelledby="article-options-label">
          <legend id="article-options-label" className="dropdown-select-group-label">
            Articles
          </legend>
          <button
            className="dropdown-select-option"
            type="button"
            role="menuitemradio"
            aria-checked={articleState === "unread"}
            onClick={() => chooseArticleState("unread")}
          >
            <span>{unreadCount} Unread</span>
            {articleState === "unread" ? <Check aria-hidden="true" size={15} /> : null}
          </button>
          <button
            className="dropdown-select-option"
            type="button"
            role="menuitemradio"
            aria-checked={articleState === "all"}
            onClick={() => chooseArticleState("all")}
          >
            <span>All articles</span>
            {articleState === "all" ? <Check aria-hidden="true" size={15} /> : null}
          </button>
        </fieldset>
      ) : null}
      <fieldset className="dropdown-select-group" aria-labelledby="view-options-label">
        <legend id="view-options-label" className="dropdown-select-group-label">
          Reading view
        </legend>
        <button
          className="dropdown-select-option"
          type="button"
          role="menuitemradio"
          aria-checked={mode === "magazine"}
          onClick={() => chooseMode("magazine")}
        >
          <span>Magazine</span>
          {mode === "magazine" ? <Check aria-hidden="true" size={15} /> : null}
        </button>
        <button
          className="dropdown-select-option"
          type="button"
          role="menuitemradio"
          aria-checked={mode === "expanded"}
          onClick={() => chooseMode("expanded")}
        >
          <span>Expanded</span>
          {mode === "expanded" ? <Check aria-hidden="true" size={15} /> : null}
        </button>
      </fieldset>
    </div>
  );

  return (
    <>
      <button
        ref={triggerRef}
        className="icon-button reader-options-trigger"
        type="button"
        aria-label="Reader options"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={READER_OPTIONS_MENU_ID}
        popoverTarget={READER_OPTIONS_MENU_ID}
        onPointerDown={() => {
          pendingFocus.current = "current";
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          openMenu(event.key === "ArrowDown" ? "first" : "last");
        }}
      >
        <Ellipsis aria-hidden="true" size={18} />
      </button>
      {typeof document === "undefined" ? null : createPortal(menu, document.body)}
    </>
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    right: number;
    maxHeight: number;
  } | null>(null);
  const controlRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuPresence = useMotionPresence(menuOpen);

  const closeMenu = useCallback((restoreFocus = false) => {
    setMenuOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  const positionMenu = useCallback(() => {
    const control = controlRef.current;
    if (!control) return;
    const bounds = control.getBoundingClientRect();
    setMenuPosition({
      top: bounds.bottom + 6,
      right: Math.max(8, window.innerWidth - bounds.right),
      maxHeight: Math.max(120, window.innerHeight - bounds.bottom - 14),
    });
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    positionMenu();

    const dismissOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (controlRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      closeMenu();
    };
    const dismissOnFocus = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (controlRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      closeMenu();
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeMenu(true);
    };

    document.addEventListener("pointerdown", dismissOnPointerDown, true);
    document.addEventListener("focusin", dismissOnFocus, true);
    document.addEventListener("keydown", dismissOnEscape);
    window.addEventListener("resize", positionMenu);
    return () => {
      document.removeEventListener("pointerdown", dismissOnPointerDown, true);
      document.removeEventListener("focusin", dismissOnFocus, true);
      document.removeEventListener("keydown", dismissOnEscape);
      window.removeEventListener("resize", positionMenu);
    };
  }, [closeMenu, menuOpen, positionMenu]);

  useEffect(() => {
    if (!menuOpen || !menuPosition) return;
    const frame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [menuOpen, menuPosition]);

  useEffect(() => {
    if (disabled && menuOpen) closeMenu();
  }, [closeMenu, disabled, menuOpen]);

  useEffect(() => {
    if (!menuPresence.present) setMenuPosition(null);
  }, [menuPresence.present]);

  const moveMenuFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!menuRef.current) return;
    const items = [...menuRef.current.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % items.length;
    if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + items.length) % items.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = items.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    items[nextIndex]?.focus();
  };

  return (
    <div className="mark-read-split-button" ref={controlRef}>
      <IconButton
        label="Mark loaded articles as read"
        onClick={onMarkRead}
        disabled={disabled}
        className="mark-read-primary"
        tooltip
      >
        <CheckCheckIcon />
      </IconButton>
      <button
        ref={triggerRef}
        className="icon-button mark-read-menu-trigger"
        type="button"
        aria-label="Mark older articles as read"
        data-tooltip="Mark older articles as read"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={MARK_READ_MENU_ID}
        disabled={disabled}
        onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown") return;
          event.preventDefault();
          setMenuOpen(true);
        }}
      >
        <ChevronDown aria-hidden="true" size={16} />
      </button>
      {menuPresence.present && menuPosition
        ? createPortal(
            <div
              ref={menuRef}
              id={MARK_READ_MENU_ID}
              className="mark-read-menu context-action-menu"
              data-state={menuPresence.state}
              role="menu"
              aria-labelledby={MARK_READ_MENU_HEADING_ID}
              inert={menuPresence.state === "closed"}
              style={menuPosition}
              onKeyDown={moveMenuFocus}
            >
              <p id={MARK_READ_MENU_HEADING_ID}>Mark older articles as read</p>
              {MARK_READ_AGE_DAYS.map((days) => (
                <button
                  key={days}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeMenu(true);
                    onMarkReadByAge(days);
                  }}
                >
                  {MARK_READ_AGE_LABELS[days]}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
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
