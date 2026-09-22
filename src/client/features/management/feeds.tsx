import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Folder as FolderIcon,
  FolderPlus,
  GripVertical,
  ListFilter,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Rss,
  Search,
  X,
} from "lucide-react";
import { type ReactNode, useId, useLayoutEffect, useRef, useState } from "react";
import type { BootstrapData, Feed, Folder } from "../../../shared/types";
import { handleActionMenuKeyDown } from "../../ui/action-menu";
import { DropdownSelect } from "../../ui/dropdown";
import {
  type FeedDragState,
  type FeedDropTarget,
  feedDropTarget,
  useFeedDrag,
} from "../feeds/feed-drag";
import {
  type FeedStatusFilter,
  type FeedTypeFilter,
  filterFeeds,
  visibleFeedStatus,
} from "../feeds/feed-filters";
import { feedHost } from "../feeds/feed-format";
import {
  FeedActionMenuItems,
  type FeedManagementAction,
  FolderActionMenuItems,
  type FolderManagementAction,
} from "../feeds/feed-management";
import { folderBranchFeedCount, folderHierarchy, folderPathLabel } from "../feeds/folder-hierarchy";
import type { ReaderDataMutations } from "../reader/data-resource";
import {
  ExportOpmlLink,
  formatDate,
  formatRefreshInterval,
  formatRelativeDate,
  handleTabListKeyDown,
  ImportOpmlButton,
  PageHeader,
} from "./shared";
import "./feeds.css";

type FeedsPageTab = "subscriptions" | "folders";

function feedFaviconUrl(value: string): string {
  return new URL("/favicon.ico", value).toString();
}

function formatCompactRefreshInterval(minutes: number): string {
  return minutes < 60 ? `${minutes}m` : `${minutes / 60}h`;
}

function FeedsDesignContract() {
  const markerRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    markerRef.current?.replaceChildren(
      document.createComment(`
THESIS: A compact signal ledger makes subscriptions findable and anomalies obvious; it refuses stacked mobile data cards.
OWN-WORLD: Feedfold charcoal and sparse moss, thin separators, compact controls, exception-only amber, flat rows, anchored menus.
STORY: Search or filter, scan health, repair failures in context, and open one menu for deeper management. Folders retain their own clear view.
FIRST VIEWPORT: Compact app bar, two tabs, one search/filter row, then 60–68px feed rows; Add feed stays top-right.
FORM: Grounded structure 6, flat adaptive ledger, surface seed acac87d8.
`),
    );
  }, []);
  return <span ref={markerRef} hidden data-design-contract="feeds" />;
}

function AnchoredPopover({
  label,
  triggerClassName,
  triggerContent,
  variant,
  managementTarget,
  children,
}: {
  label: string;
  triggerClassName: string;
  triggerContent: ReactNode;
  variant: "actions" | "transfer";
  managementTarget?: { kind: "feed" | "folder"; id: number };
  children: ReactNode;
}) {
  const id = useId().replace(/:/g, "");
  const menuId = `management-actions-${id}`;
  const anchorName = `--management-actions-${id}`;
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const close = () => {
    const menu = menuRef.current;
    if (menu?.matches(":popover-open")) menu.hidePopover();
  };

  const openAndFocus = () => {
    const menu = menuRef.current;
    if (menu && !menu.matches(":popover-open")) menu.showPopover();
    window.requestAnimationFrame(() => {
      menuRef.current
        ?.querySelector<HTMLElement>('[role="menuitem"]')
        ?.focus({ preventScroll: true });
    });
  };

  return (
    <>
      <button
        className={triggerClassName}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        popoverTarget={menuId}
        data-management-feed-id={
          managementTarget?.kind === "feed" ? managementTarget.id : undefined
        }
        data-management-folder-id={
          managementTarget?.kind === "folder" ? managementTarget.id : undefined
        }
        style={{ anchorName }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown") return;
          event.preventDefault();
          openAndFocus();
        }}
      >
        {triggerContent}
      </button>
      <div
        ref={menuRef}
        id={menuId}
        className={`management-actions-popover dropdown-menu-surface${
          variant === "actions" ? " context-action-menu" : " feed-transfer-popover"
        }`}
        popover="auto"
        role="menu"
        aria-label={label}
        style={{ positionAnchor: anchorName }}
        onToggle={(event) => {
          const nextOpen = event.currentTarget.matches(":popover-open");
          setOpen(nextOpen);
          if (nextOpen) {
            window.requestAnimationFrame(() => {
              menuRef.current
                ?.querySelector<HTMLElement>('[role="menuitem"]')
                ?.focus({ preventScroll: true });
            });
          }
        }}
        onKeyDown={(event) => {
          handleActionMenuKeyDown(event, close);
        }}
        onClickCapture={(event) => {
          if ((event.target as Element).closest("button, a")) close();
        }}
      >
        {children}
      </div>
    </>
  );
}

function FeedTransferMenu({
  mutations,
  showToast,
}: {
  mutations: ReaderDataMutations;
  showToast: (message: string) => void;
}) {
  return (
    <AnchoredPopover
      label="Import or export feeds"
      triggerClassName="secondary-button feed-transfer-trigger"
      triggerContent={
        <>
          <MoreHorizontal aria-hidden="true" size={17} />
          <span>Import / export</span>
        </>
      }
      variant="transfer"
    >
      <ImportOpmlButton menuItem mutations={mutations} showToast={showToast} />
      <ExportOpmlLink menuItem />
    </AnchoredPopover>
  );
}

function FeedsPage({
  bootstrap,
  mutations,
  onMenu,
  onAddFeed,
  onAddFolder,
  onRefresh,
  onFeedAction,
  onFolderAction,
  onMoveFeed,
  showToast,
}: {
  bootstrap: BootstrapData;
  mutations: ReaderDataMutations;
  onMenu: () => void;
  onAddFeed: () => void;
  onAddFolder: () => void;
  onRefresh: (feedId: number) => void;
  onFeedAction: (feed: Feed, action: FeedManagementAction) => void;
  onFolderAction: (folder: Folder, action: FolderManagementAction) => void;
  onMoveFeed: (feed: Feed, folderId: number | null) => Promise<boolean>;
  showToast: (message: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<FeedsPageTab>("subscriptions");
  const [searchQuery, setSearchQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [feedTypeFilter, setFeedTypeFilter] = useState<FeedTypeFilter>("all");
  const [feedStatusFilter, setFeedStatusFilter] = useState<FeedStatusFilter>("all");
  const filteredFeeds = filterFeeds(bootstrap.feeds, bootstrap.folders, {
    query: searchQuery,
    type: feedTypeFilter,
    status: feedStatusFilter,
  });
  const filtersActive =
    searchQuery.trim() !== "" || feedTypeFilter !== "all" || feedStatusFilter !== "all";
  const activeFilterCount = Number(feedTypeFilter !== "all") + Number(feedStatusFilter !== "all");
  const publishedFeedCount = bootstrap.feeds.filter(
    (feed) => feed.sourceKind === "published",
  ).length;
  const webFeedCount = bootstrap.feeds.length - publishedFeedCount;
  const orderedFolders = folderHierarchy(bootstrap.folders);
  const rootFolders = orderedFolders.filter(({ depth }) => depth === 0).map(({ folder }) => folder);
  const feedDrag = useFeedDrag(bootstrap.feeds, onMoveFeed);
  const [expandedLocations, setExpandedLocations] = useState<Set<FeedDropTarget>>(() => new Set());
  const statusCounts: Record<Exclude<FeedStatusFilter, "all">, number> = {
    healthy: 0,
    needs_attention: 0,
    paused: 0,
    refreshing: 0,
  };
  for (const feed of bootstrap.feeds) statusCounts[visibleFeedStatus(feed)] += 1;

  const selectTab = (tab: FeedsPageTab) => {
    if (tab === activeTab) return;
    setFiltersOpen(false);
    setActiveTab(tab);
  };

  const clearFeedView = () => {
    setSearchQuery("");
    setFeedTypeFilter("all");
    setFeedStatusFilter("all");
  };

  const toggleLocation = (target: FeedDropTarget) => {
    setExpandedLocations((current) => {
      const next = new Set(current);
      if (next.has(target)) next.delete(target);
      else next.add(target);
      return next;
    });
  };

  const revealLocation = (target: FeedDropTarget) => {
    setExpandedLocations((current) => {
      if (current.has(target)) return current;
      const next = new Set(current);
      next.add(target);
      return next;
    });
  };

  return (
    <div className="management-page feeds-management-page">
      <FeedsDesignContract />
      <PageHeader
        title="Manage feeds"
        description="Subscriptions, folders, and source health in one place."
        onMenu={onMenu}
        actions={
          activeTab === "subscriptions" ? (
            <div className="feed-page-actions">
              <FeedTransferMenu mutations={mutations} showToast={showToast} />
              <button className="primary-button" type="button" onClick={onAddFeed}>
                <Plus aria-hidden="true" size={16} />
                Add feed
              </button>
            </div>
          ) : (
            <button className="primary-button" type="button" onClick={onAddFolder}>
              <FolderPlus aria-hidden="true" size={16} />
              Add folder
            </button>
          )
        }
      />

      <div className="management-tabs-shell">
        <div
          className="management-tabs"
          role="tablist"
          aria-label="Feed management"
          onKeyDown={handleTabListKeyDown}
        >
          <button
            id="subscriptions-tab"
            type="button"
            role="tab"
            aria-controls="subscriptions-panel"
            aria-selected={activeTab === "subscriptions"}
            tabIndex={activeTab === "subscriptions" ? 0 : -1}
            onClick={() => selectTab("subscriptions")}
          >
            <Rss aria-hidden="true" size={15} />
            Subscriptions
            <span className="management-tab-count">{bootstrap.feeds.length}</span>
          </button>
          <button
            id="folders-tab"
            type="button"
            role="tab"
            aria-controls="folders-panel"
            aria-selected={activeTab === "folders"}
            tabIndex={activeTab === "folders" ? 0 : -1}
            onClick={() => selectTab("folders")}
          >
            <FolderIcon aria-hidden="true" size={15} />
            Folders
            <span className="management-tab-count">{bootstrap.folders.length}</span>
          </button>
        </div>
      </div>

      {activeTab === "subscriptions" ? (
        <div
          id="subscriptions-panel"
          role="tabpanel"
          aria-labelledby="subscriptions-tab"
          className="management-tab-panel"
        >
          <section
            className="management-section feed-management-section"
            aria-labelledby="subscriptions-heading"
          >
            <h2 id="subscriptions-heading" className="sr-only">
              Subscriptions
            </h2>

            {bootstrap.feeds.length > 0 ? (
              <div className="feed-tools">
                <label className="feed-search-field">
                  <Search aria-hidden="true" size={16} />
                  <span className="sr-only">Search feeds or folders</span>
                  <input
                    type="search"
                    value={searchQuery}
                    placeholder="Search feeds or folders"
                    onChange={(event) => setSearchQuery(event.target.value)}
                  />
                </label>
                <button
                  className={`secondary-button feed-filter-toggle${
                    activeFilterCount > 0 ? " has-active-filters" : ""
                  }`}
                  type="button"
                  aria-expanded={filtersOpen}
                  aria-controls="feed-filter-panel"
                  onClick={() => setFiltersOpen((current) => !current)}
                >
                  <ListFilter aria-hidden="true" size={16} />
                  Filters
                  {activeFilterCount > 0 ? (
                    <span className="filter-count">{activeFilterCount}</span>
                  ) : null}
                </button>
                <fieldset
                  id="feed-filter-panel"
                  className="feed-filter-panel"
                  data-open={filtersOpen || undefined}
                >
                  <legend className="sr-only">Filter subscriptions</legend>
                  <div className="feed-filter-field">
                    <span>Type</span>
                    <DropdownSelect
                      ariaLabel="Feed type"
                      value={feedTypeFilter}
                      options={[
                        { value: "all", label: `All types (${bootstrap.feeds.length})` },
                        { value: "published", label: `Published (${publishedFeedCount})` },
                        { value: "web", label: `Web (${webFeedCount})` },
                      ]}
                      onChange={(value) => setFeedTypeFilter(value as FeedTypeFilter)}
                    />
                  </div>
                  <div className="feed-filter-field">
                    <span>Status</span>
                    <DropdownSelect
                      ariaLabel="Feed status"
                      value={feedStatusFilter}
                      options={[
                        { value: "all", label: `All statuses (${bootstrap.feeds.length})` },
                        { value: "healthy", label: `Healthy (${statusCounts.healthy})` },
                        {
                          value: "needs_attention",
                          label: `Needs attention (${statusCounts.needs_attention})`,
                        },
                        { value: "paused", label: `Paused (${statusCounts.paused})` },
                        { value: "refreshing", label: `Refreshing (${statusCounts.refreshing})` },
                      ]}
                      onChange={(value) => setFeedStatusFilter(value as FeedStatusFilter)}
                    />
                  </div>
                  {feedTypeFilter !== "all" || feedStatusFilter !== "all" ? (
                    <button
                      className="quiet-button feed-filter-clear"
                      type="button"
                      onClick={() => {
                        setFeedTypeFilter("all");
                        setFeedStatusFilter("all");
                      }}
                    >
                      <X aria-hidden="true" size={14} />
                      Clear
                    </button>
                  ) : null}
                </fieldset>
                <p className="feed-result-count" aria-live="polite">
                  {filtersActive ? (
                    <>
                      <strong>{filteredFeeds.length}</strong> of {bootstrap.feeds.length}
                    </>
                  ) : (
                    <>
                      <strong>{bootstrap.feeds.length}</strong>{" "}
                      {bootstrap.feeds.length === 1 ? "feed" : "feeds"}
                    </>
                  )}
                </p>
              </div>
            ) : null}

            {bootstrap.feeds.length === 0 ? (
              <div className="section-empty">
                <Rss aria-hidden="true" size={22} />
                <h3>No feeds yet</h3>
                <p>Add a website or feed URL, or import subscriptions from an OPML file.</p>
                <button className="primary-button" type="button" onClick={onAddFeed}>
                  <Plus aria-hidden="true" size={16} />
                  Add your first feed
                </button>
              </div>
            ) : filteredFeeds.length === 0 ? (
              <div className="section-empty filtered-empty">
                <ListFilter aria-hidden="true" size={22} />
                <h3>No matching feeds</h3>
                <p>Try another search or reset the current filters.</p>
                <button className="secondary-button" type="button" onClick={clearFeedView}>
                  Reset view
                </button>
              </div>
            ) : (
              <div className="feed-management-list">
                <div className="feed-management-list-header" aria-hidden="true">
                  <span>Feed</span>
                  <span>Folder</span>
                  <span>Status</span>
                  <span>Update</span>
                  <span>Last Post</span>
                  <span />
                </div>
                <ul className="feed-management-rows" aria-label="Subscriptions">
                  {filteredFeeds.map((feed) => (
                    <FeedRow
                      key={feed.id}
                      feed={feed}
                      folders={bootstrap.folders}
                      manualRefreshEnabled={bootstrap.capabilities.manualRefresh}
                      onRefresh={() => onRefresh(feed.id)}
                      onAction={(action) => onFeedAction(feed, action)}
                    />
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      ) : (
        <section
          id="folders-panel"
          role="tabpanel"
          aria-labelledby="folders-tab"
          className="management-section management-tab-panel folder-management-section"
        >
          <div className="folder-section-heading">
            <div>
              <h2 id="folders-heading">Folder structure</h2>
              <p>Expand folders to see feeds, then drag a feed onto another folder.</p>
            </div>
            <span>
              {bootstrap.folders.length} {bootstrap.folders.length === 1 ? "folder" : "folders"}
              {` · ${bootstrap.feeds.length} ${bootstrap.feeds.length === 1 ? "feed" : "feeds"}`}
            </span>
          </div>
          {bootstrap.folders.length === 0 && bootstrap.feeds.length === 0 ? (
            <div className="section-empty">
              <FolderIcon aria-hidden="true" size={22} />
              <h3>No folders yet</h3>
              <p>Create a folder to group feeds. Until then, feeds remain at the top level.</p>
              <button className="secondary-button" type="button" onClick={onAddFolder}>
                <FolderPlus aria-hidden="true" size={16} />
                Add folder
              </button>
            </div>
          ) : (
            <ul
              className={`folder-management-list${feedDrag.draggedFeed ? " is-dragging-feed" : ""}`}
              aria-label="Folders and feeds"
            >
              <FolderBranch
                folder={null}
                folders={bootstrap.folders}
                feeds={bootstrap.feeds}
                expandedLocations={expandedLocations}
                feedDrag={feedDrag}
                onToggle={toggleLocation}
                onReveal={revealLocation}
                onFeedAction={onFeedAction}
                onFolderAction={onFolderAction}
              />
              {rootFolders.map((folder) => (
                <FolderBranch
                  key={folder.id}
                  folder={folder}
                  folders={bootstrap.folders}
                  feeds={bootstrap.feeds}
                  expandedLocations={expandedLocations}
                  feedDrag={feedDrag}
                  onToggle={toggleLocation}
                  onReveal={revealLocation}
                  onFeedAction={onFeedAction}
                  onFolderAction={onFolderAction}
                />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function feedFailureLabel(feed: Feed): string {
  if (feed.lastErrorKind === "selection_broken") return "Page changed";
  if (feed.lastErrorKind === "javascript_timeout") return "JavaScript timed out";
  if (feed.lastErrorKind === "inaccessible") return "Page inaccessible";
  if (feed.lastErrorKind === "access_blocked") return "Access blocked";
  if (feed.lastErrorKind === "unsupported_content") return "Unsupported page";
  if (feed.lastErrorKind === "timeout") return "Loading timed out";
  if (feed.lastHttpStatus) return `HTTP ${feed.lastHttpStatus}`;
  return "Refresh failed";
}

function feedStatusLabel(feed: Feed, status: ReturnType<typeof visibleFeedStatus>): string {
  if (status === "needs_attention") return feedFailureLabel(feed);
  if (status === "paused") return "Paused";
  if (status === "refreshing") return "Refreshing";
  return "Healthy";
}

function FeedSourceIcon({
  feed,
  sourceUrl,
  status,
  statusLabel,
}: {
  feed: Feed;
  sourceUrl: string;
  status: ReturnType<typeof visibleFeedStatus>;
  statusLabel: string;
}) {
  const faviconUrl = feedFaviconUrl(sourceUrl);
  const [failedFavicon, setFailedFavicon] = useState<string | null>(null);
  const fallbackLabel = Array.from(feed.title.trim())[0]?.toLocaleUpperCase() ?? "•";

  return (
    <span className="feed-source-icon">
      <span className="feed-source-icon-visual" aria-hidden="true">
        <span className="feed-source-icon-fallback">{fallbackLabel}</span>
        {failedFavicon !== faviconUrl ? (
          <img
            className="feed-source-favicon"
            src={faviconUrl}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setFailedFavicon(faviconUrl)}
          />
        ) : null}
      </span>
      <span className="feed-health-dot" data-status={status} role="img" aria-label={statusLabel} />
    </span>
  );
}

function FeedRow({
  feed,
  folders,
  manualRefreshEnabled,
  onRefresh,
  onAction,
}: {
  feed: Feed;
  folders: Folder[];
  manualRefreshEnabled: boolean;
  onRefresh: () => void;
  onAction: (action: FeedManagementAction) => void;
}) {
  const status = visibleFeedStatus(feed);
  const sourceUrl = feed.siteUrl ?? feed.feedUrl;
  const statusLabel = feedStatusLabel(feed, status);

  return (
    <li className="feed-management-row" data-feed-status={status}>
      <div className="feed-row-identity">
        <FeedSourceIcon
          feed={feed}
          sourceUrl={sourceUrl}
          status={status}
          statusLabel={statusLabel}
        />
        <div>
          <span className="feed-row-title">
            <strong>{feed.title}</strong>
            {feed.sourceKind === "web" ? <span className="feed-type-badge">Web</span> : null}
          </span>
          <a
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${feed.title} website`}
          >
            {feedHost(sourceUrl)}
          </a>
        </div>
      </div>
      <div className="feed-row-meta">
        <span className="feed-folder-path">{folderPathLabel(feed.folderId, folders)}</span>
        <div className="feed-health" data-status={status}>
          <span className="feed-health-label">
            {status === "needs_attention" ? (
              <AlertTriangle aria-hidden="true" size={14} />
            ) : status === "refreshing" ? (
              <LoaderCircle className="spin" aria-hidden="true" size={14} />
            ) : (
              <span className="feed-health-mini-dot" aria-hidden="true" />
            )}
            {statusLabel}
          </span>
          {feed.lastError ? <small title={feed.lastError}>{feed.lastError}</small> : null}
          {feed.lastErrorKind === "selection_broken" ? (
            <button
              className="feed-repair-button"
              type="button"
              onClick={() => onAction("selection")}
            >
              Repair
            </button>
          ) : null}
        </div>
        <span
          className="feed-update-interval"
          title={`Updates every ${formatRefreshInterval(feed.pollIntervalMinutes)}`}
        >
          <span className="sr-only">
            Updates every {formatRefreshInterval(feed.pollIntervalMinutes)}
          </span>
          <span aria-hidden="true">
            <span className="feed-mobile-meta-label">every </span>
            {formatCompactRefreshInterval(feed.pollIntervalMinutes)}
          </span>
        </span>
        <time
          className="feed-last-post"
          dateTime={feed.lastPostAt ?? undefined}
          title={formatDate(feed.lastPostAt)}
        >
          <span className="sr-only">Last post {formatRelativeDate(feed.lastPostAt)}</span>
          <span aria-hidden="true">
            <span className="feed-mobile-meta-label">post </span>
            {formatRelativeDate(feed.lastPostAt)}
          </span>
        </time>
      </div>
      <div className="feed-row-actions">
        {manualRefreshEnabled ? (
          <button
            className="feed-refresh-button"
            type="button"
            disabled={feed.refreshing || feed.paused}
            onClick={onRefresh}
            aria-label={`Refresh ${feed.title}`}
            title="Refresh feed"
          >
            <RefreshCw className={feed.refreshing ? "spin" : ""} aria-hidden="true" size={15} />
          </button>
        ) : null}
        <AnchoredPopover
          label={`${feed.title} actions`}
          triggerClassName="feed-actions-trigger"
          triggerContent={<MoreHorizontal aria-hidden="true" size={17} />}
          variant="actions"
          managementTarget={{ kind: "feed", id: feed.id }}
        >
          <FeedActionMenuItems feed={feed} onAction={onAction} />
        </AnchoredPopover>
      </div>
    </li>
  );
}

function FolderFeedRow({
  feed,
  feedDrag,
  onAction,
}: {
  feed: Feed;
  feedDrag: FeedDragState;
  onAction: (action: FeedManagementAction) => void;
}) {
  const status = visibleFeedStatus(feed);
  const statusLabel = feedStatusLabel(feed, status);
  const sourceUrl = feed.siteUrl ?? feed.feedUrl;
  const dragging = feedDrag.draggedFeed?.id === feed.id;
  const moving = feedDrag.movingFeedId === feed.id;

  return (
    <li
      className={`folder-feed-row${dragging ? " is-dragging" : ""}${moving ? " is-moving" : ""}`}
      data-feed-status={status}
      aria-busy={moving || undefined}
    >
      <button
        className="folder-feed-drag-region"
        type="button"
        aria-label={`Move ${feed.title} to another folder`}
        draggable={feedDrag.movingFeedId === null}
        title={`Drag ${feed.title} to another folder`}
        onDragStart={(event) => feedDrag.start(feed, event)}
        onDragEnd={feedDrag.end}
        onClick={() => onAction("move")}
      >
        <GripVertical className="folder-feed-grip" aria-hidden="true" size={15} />
        <FeedSourceIcon
          feed={feed}
          sourceUrl={sourceUrl}
          status={status}
          statusLabel={statusLabel}
        />
        <span className="folder-feed-copy">
          <strong>{feed.title}</strong>
          <small>{feedHost(sourceUrl)}</small>
        </span>
      </button>
      <AnchoredPopover
        label={`${feed.title} actions`}
        triggerClassName="feed-actions-trigger"
        triggerContent={<MoreHorizontal aria-hidden="true" size={17} />}
        variant="actions"
        managementTarget={{ kind: "feed", id: feed.id }}
      >
        <FeedActionMenuItems feed={feed} onAction={onAction} />
      </AnchoredPopover>
    </li>
  );
}

function FolderBranch({
  folder,
  folders,
  feeds,
  expandedLocations,
  feedDrag,
  onToggle,
  onReveal,
  onFeedAction,
  onFolderAction,
}: {
  folder: Folder | null;
  folders: Folder[];
  feeds: Feed[];
  expandedLocations: ReadonlySet<FeedDropTarget>;
  feedDrag: FeedDragState;
  onToggle: (target: FeedDropTarget) => void;
  onReveal: (target: FeedDropTarget) => void;
  onFeedAction: (feed: Feed, action: FeedManagementAction) => void;
  onFolderAction: (folder: Folder, action: FolderManagementAction) => void;
}) {
  const folderId = folder?.id ?? null;
  const target = feedDropTarget(folderId);
  const topLevel = folder === null;
  const path = folder ? folderPathLabel(folder.id, folders) : "Top level";
  const childFolders = folder
    ? folders
        .filter((candidate) => candidate.parentId === folder.id)
        .sort((left, right) => left.name.localeCompare(right.name))
    : [];
  const childFeeds = feeds.filter((feed) => feed.folderId === folderId);
  const feedCount = folder ? folderBranchFeedCount(folder.id, folders, feeds) : childFeeds.length;
  const hasChildren = childFolders.length > 0 || childFeeds.length > 0;
  const expanded = expandedLocations.has(target);
  const dropAvailable = feedDrag.draggedFeed !== null && feedDrag.draggedFeed.folderId !== folderId;
  const dropActive = feedDrag.dropTarget === target;
  const branchId = `folder-branch-${target}`;

  return (
    <li className="folder-tree-branch">
      <fieldset
        className={`folder-management-row${topLevel ? " is-top-level" : ""}${dropAvailable ? " is-feed-drop-available" : ""}${dropActive ? " is-feed-drop-target" : ""}`}
        aria-label={`${path} folder`}
        onDragEnter={(event) => feedDrag.enterTarget(folderId, event)}
        onDragOver={(event) => feedDrag.enterTarget(folderId, event)}
        onDragLeave={(event) => feedDrag.leaveTarget(folderId, event)}
        onDrop={(event) => {
          void feedDrag.dropOnTarget(folderId, event).then((moved) => {
            if (moved) onReveal(target);
          });
        }}
      >
        <button
          className="folder-disclosure"
          type="button"
          aria-label={`${expanded ? "Collapse" : "Expand"} ${path}`}
          aria-expanded={hasChildren ? expanded : undefined}
          aria-controls={hasChildren ? branchId : undefined}
          disabled={!hasChildren}
          onClick={() => onToggle(target)}
        >
          {expanded ? (
            <ChevronDown aria-hidden="true" size={15} />
          ) : (
            <ChevronRight aria-hidden="true" size={15} />
          )}
        </button>
        <div className="folder-row-identity" title={path}>
          {topLevel ? (
            <Rss aria-hidden="true" size={16} />
          ) : (
            <FolderIcon aria-hidden="true" size={16} />
          )}
          <span>
            <strong>{folder?.name ?? "Top level"}</strong>
            <small>
              {feedCount} {feedCount === 1 ? "feed" : "feeds"}
              {folder
                ? ` · ${folder.sortDirection === "oldest" ? "Oldest" : "Newest"} first`
                : " · No folder"}
            </small>
          </span>
        </div>
        {folder ? (
          <AnchoredPopover
            label={`${path} actions`}
            triggerClassName="folder-actions-trigger"
            triggerContent={<MoreHorizontal aria-hidden="true" size={17} />}
            variant="actions"
            managementTarget={{ kind: "folder", id: folder.id }}
          >
            <FolderActionMenuItems onAction={(action) => onFolderAction(folder, action)} />
          </AnchoredPopover>
        ) : (
          <span className="folder-row-action-space" aria-hidden="true" />
        )}
      </fieldset>
      {expanded && hasChildren ? (
        <ul id={branchId} className="folder-management-children">
          {childFolders.map((childFolder) => (
            <FolderBranch
              key={childFolder.id}
              folder={childFolder}
              folders={folders}
              feeds={feeds}
              expandedLocations={expandedLocations}
              feedDrag={feedDrag}
              onToggle={onToggle}
              onReveal={onReveal}
              onFeedAction={onFeedAction}
              onFolderAction={onFolderAction}
            />
          ))}
          {childFeeds.map((feed) => (
            <FolderFeedRow
              key={feed.id}
              feed={feed}
              feedDrag={feedDrag}
              onAction={(action) => onFeedAction(feed, action)}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export default FeedsPage;
