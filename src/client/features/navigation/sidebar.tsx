import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Ellipsis,
  ExternalLink,
  Folder,
  ListFilter,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Rss,
  Settings,
  UserRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type {
  ArticleState,
  BootstrapData,
  Feed,
  Folder as FolderType,
  SessionUser,
} from "../../../shared/types";
import type { AppView } from "../../app/routes";
import { BrandIdentity } from "../../ui/brand";
import { IconButton, Kbd } from "../../ui/controls";
import { Menu, MenuItem, MenuPopup } from "../../ui/menu";
import {
  FeedDragProvider,
  type FeedDragState,
  useFeedDrag,
  useFeedDraggable,
  useFeedDropTarget,
} from "../feeds/feed-drag";
import {
  FeedActionMenuItems,
  type FeedManagementAction,
  FolderActionMenuItems,
  type FolderManagementAction,
} from "../feeds/feed-management";
import type { AddFeedSourceType } from "../feeds/feed-source";
import { ADD_FEED_SOURCE_OPTIONS } from "../feeds/feed-source-options";

function selectedFolderPath(
  folders: FolderType[],
  feeds: Feed[],
  selectedFeedId: number | null,
  selectedFolderId: number | null,
): Set<number> {
  const parentIds = new Map(folders.map((folder) => [folder.id, folder.parentId]));
  let folderId =
    selectedFolderId ?? feeds.find((feed) => feed.id === selectedFeedId)?.folderId ?? null;
  const path = new Set<number>();

  while (folderId !== null) {
    path.add(folderId);
    folderId = parentIds.get(folderId) ?? null;
  }

  return path;
}

function ArticleCount({ count }: { count: number }) {
  const exactCount = count.toLocaleString();

  return (
    <span className="nav-count" title={exactCount}>
      <span aria-hidden="true">{count > 999 ? "999+" : count}</span>
      <span className="sr-only">{exactCount}</span>
    </span>
  );
}

interface SidebarProps {
  bootstrap: BootstrapData;
  user: SessionUser;
  localApp?: boolean;
  sourceUrl?: string | undefined;
  currentState: ArticleState;
  selectedFeedId: number | null;
  selectedFolderId: number | null;
  currentView: AppView;
  open: boolean;
  collapsed: boolean;
  onClose: () => void;
  onToggleCollapse: () => void;
  onSelectState: (state: ArticleState) => void;
  onSelectScope: (feedId: number | null, folderId: number | null) => void;
  onAddFeed: () => void;
  onAddSubscription: (sourceType: AddFeedSourceType) => void;
  onAddFolder: () => void;
  onNavigate: (view: AppView) => void;
  onFeedAction: (feed: Feed, action: FeedManagementAction) => void;
  onFolderAction: (folder: FolderType, action: FolderManagementAction) => void;
  onMoveFeed: (feed: Feed, folderId: number | null) => Promise<boolean>;
  onRefresh: () => void;
  onLogout: () => Promise<void>;
}

type SidebarContextMenuState =
  | { kind: "add"; trigger: HTMLButtonElement; left: number; top: number }
  | {
      kind: "feed";
      feed: Feed;
      trigger: HTMLButtonElement;
      left: number;
      top: number;
    }
  | {
      kind: "folder";
      folder: FolderType;
      trigger: HTMLButtonElement;
      left: number;
      top: number;
    };

export function Sidebar(props: SidebarProps) {
  return (
    <FeedDragProvider onMoveFeed={props.onMoveFeed}>
      <SidebarContent {...props} />
    </FeedDragProvider>
  );
}

function SidebarContent({
  bootstrap,
  user,
  localApp = false,
  sourceUrl,
  currentState,
  selectedFeedId,
  selectedFolderId,
  currentView,
  open,
  collapsed,
  onClose,
  onToggleCollapse,
  onSelectState,
  onSelectScope,
  onAddFeed,
  onAddSubscription,
  onAddFolder,
  onNavigate,
  onFeedAction,
  onFolderAction,
  onRefresh,
  onLogout,
}: SidebarProps) {
  const [contextMenu, setContextMenu] = useState<SidebarContextMenuState | null>(null);
  const [compact, setCompact] = useState(() => window.matchMedia("(max-width: 1020px)").matches);

  useEffect(() => {
    const viewport = window.matchMedia("(max-width: 1020px)");
    const update = () => setCompact(viewport.matches);
    viewport.addEventListener("change", update);
    update();
    return () => viewport.removeEventListener("change", update);
  }, []);

  const rootFolders = bootstrap.folders.filter((folder) => folder.parentId === null);
  const uncategorized = bootstrap.feeds.filter((feed) => feed.folderId === null);
  const feedDrag = useFeedDrag();
  const { draggedFeed } = feedDrag;
  const hasFeedErrors = bootstrap.feeds.some((feed) => feed.lastError);
  const refreshing = bootstrap.feeds.some((feed) => feed.refreshing);
  const selectedFolderPathIds = selectedFolderPath(
    bootstrap.folders,
    bootstrap.feeds,
    selectedFeedId,
    selectedFolderId,
  );

  const closeContextMenu = useCallback(() => {
    contextMenu?.trigger.focus();
    setContextMenu(null);
  }, [contextMenu]);

  const openFeedMenu = useCallback(
    (feed: Feed, trigger: HTMLButtonElement, left: number, top: number) => {
      trigger.focus();
      setContextMenu({ kind: "feed", feed, trigger, left, top });
    },
    [],
  );

  const openFolderMenu = useCallback(
    (folder: FolderType, trigger: HTMLButtonElement, left: number, top: number) => {
      trigger.focus();
      setContextMenu({ kind: "folder", folder, trigger, left, top });
    },
    [],
  );

  const {
    ref: topLevelRef,
    available: topLevelDropAvailable,
    isDropTarget: topLevelDropActive,
  } = useFeedDropTarget(null, "Top level");

  return (
    <aside
      className={`sidebar${open ? " is-open" : ""}${collapsed ? " is-collapsed" : ""}${draggedFeed ? " is-dragging-feed" : ""}`}
      aria-label="Primary navigation"
      inert={compact && !open}
    >
      <div className="brand-row">
        <button className="brand" type="button" onClick={() => onSelectScope(null, null)}>
          <BrandIdentity />
        </button>
        <IconButton
          label={collapsed ? "Show sidebar" : "Hide sidebar"}
          onClick={onToggleCollapse}
          className="sidebar-collapse-button"
        >
          {collapsed ? (
            <PanelLeftOpen aria-hidden="true" size={18} />
          ) : (
            <PanelLeftClose aria-hidden="true" size={18} />
          )}
        </IconButton>
        <IconButton label="Close navigation" onClick={onClose} className="close-nav">
          <X aria-hidden="true" size={18} />
        </IconButton>
      </div>

      <nav className="sidebar-navigation">
        <ul className="nav-list quick-links">
          <li>
            <button
              className="nav-item"
              aria-current={
                currentView === "reader" &&
                currentState !== "starred" &&
                selectedFeedId === null &&
                selectedFolderId === null
                  ? "page"
                  : undefined
              }
              type="button"
              onClick={() => onSelectState("unread")}
            >
              <span>Feed</span>
              <ArticleCount count={bootstrap.counts.unread} />
              <Kbd>g u</Kbd>
            </button>
          </li>
          <li>
            <button
              className="nav-item"
              aria-current={
                currentView === "reader" &&
                currentState === "starred" &&
                selectedFeedId === null &&
                selectedFolderId === null
                  ? "page"
                  : undefined
              }
              type="button"
              onClick={() => onSelectState("starred")}
            >
              <span>Saved</span>
              <ArticleCount count={bootstrap.counts.starred} />
              <Kbd>g s</Kbd>
            </button>
          </li>
        </ul>

        <div className="sidebar-scroll">
          <fieldset
            className={`sidebar-section-heading sidebar-top-level-drop${topLevelDropAvailable ? " is-feed-drop-available" : ""}${topLevelDropActive ? " is-feed-drop-target" : ""}`}
            aria-label={topLevelDropAvailable ? "Move feed to top level" : "Subscription actions"}
            ref={topLevelRef}
          >
            <span>
              {topLevelDropActive
                ? "Drop at top level"
                : topLevelDropAvailable
                  ? "Top level"
                  : "Subscriptions"}
            </span>
            <span className="sidebar-section-actions">
              {bootstrap.capabilities.manualRefresh ? (
                <button
                  type="button"
                  onClick={onRefresh}
                  disabled={refreshing}
                  aria-label="Refresh feeds"
                  title="Refresh feeds (R)"
                >
                  <RefreshCw className={refreshing ? "spin" : ""} aria-hidden="true" size={14} />
                </button>
              ) : null}
              <button
                type="button"
                aria-label="Add subscription or folder"
                title="Add subscription or folder"
                aria-haspopup="menu"
                aria-expanded={contextMenu?.kind === "add"}
                aria-controls={contextMenu?.kind === "add" ? "sidebar-add-menu" : undefined}
                onClick={(event) => {
                  const trigger = event.currentTarget;
                  const bounds = trigger.getBoundingClientRect();
                  if (contextMenu?.kind === "add") closeContextMenu();
                  else
                    setContextMenu({
                      kind: "add",
                      trigger,
                      left: bounds.left,
                      top: bounds.bottom + 4,
                    });
                }}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                  event.preventDefault();
                  event.currentTarget.click();
                }}
              >
                <Plus aria-hidden="true" size={15} />
              </button>
            </span>
          </fieldset>

          {bootstrap.feeds.length === 0 ? (
            <button className="sidebar-empty" type="button" onClick={onAddFeed}>
              <Plus aria-hidden="true" size={15} />
              Add your first feed
            </button>
          ) : (
            <ul className="folder-tree">
              {rootFolders.map((folder) => (
                <SidebarFolder
                  key={folder.id}
                  folder={folder}
                  folders={bootstrap.folders}
                  feeds={bootstrap.feeds}
                  selectedFeedId={selectedFeedId}
                  selectedFolderId={selectedFolderId}
                  selectedFolderPathIds={selectedFolderPathIds}
                  currentView={currentView}
                  feedDrag={feedDrag}
                  onSelectScope={onSelectScope}
                  onOpenFeedMenu={openFeedMenu}
                  onOpenFolderMenu={openFolderMenu}
                />
              ))}
              {uncategorized.map((feed) => (
                <SidebarFeed
                  key={feed.id}
                  feed={feed}
                  selected={currentView === "reader" && selectedFeedId === feed.id}
                  feedDrag={feedDrag}
                  onSelect={() => onSelectScope(feed.id, null)}
                  onOpenMenu={openFeedMenu}
                />
              ))}
            </ul>
          )}
        </div>
      </nav>

      <div className="sidebar-footer">
        <button
          data-management-focus-fallback
          className="nav-item"
          aria-current={currentView === "feeds" ? "page" : undefined}
          type="button"
          onClick={() => onNavigate("feeds")}
        >
          {hasFeedErrors ? (
            <AlertTriangle className="status-warning" aria-hidden="true" size={16} />
          ) : (
            <Rss aria-hidden="true" size={16} />
          )}
          <span>Manage feeds</span>
          <Kbd>g f</Kbd>
        </button>
        <button
          className="nav-item"
          aria-current={currentView === "rules" ? "page" : undefined}
          type="button"
          onClick={() => onNavigate("rules")}
        >
          <ListFilter aria-hidden="true" size={16} />
          <span>Rules</span>
          <Kbd>g r</Kbd>
        </button>
        <button
          className="nav-item"
          aria-current={currentView === "settings" ? "page" : undefined}
          type="button"
          onClick={() => onNavigate("settings")}
        >
          <Settings aria-hidden="true" size={16} />
          <span>Settings</span>
          <Kbd>g ,</Kbd>
        </button>
        {!localApp ? (
          <div className="sidebar-account">
            <span className="account-name" title={user.username}>
              <UserRound aria-hidden="true" size={16} />
              <span className="truncate">{user.username}</span>
            </span>
            <span className="sidebar-account-actions">
              {sourceUrl ? (
                <a
                  className="icon-button"
                  href={sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="View feedfold on GitHub"
                  title="View on GitHub"
                >
                  <ExternalLink aria-hidden="true" size={16} />
                </a>
              ) : null}
              <button
                className="icon-button"
                type="button"
                aria-label={`Log out ${user.username}`}
                title="Log out"
                onClick={() => void onLogout()}
              >
                <LogOut aria-hidden="true" size={16} />
              </button>
            </span>
          </div>
        ) : null}
      </div>
      {contextMenu ? (
        <SidebarContextMenu
          state={contextMenu}
          onClose={closeContextMenu}
          onAddSubscription={(sourceType) => {
            closeContextMenu();
            onAddSubscription(sourceType);
          }}
          onAddFolder={() => {
            closeContextMenu();
            onAddFolder();
          }}
          onFeedAction={(feed, action) => {
            closeContextMenu();
            onFeedAction(feed, action);
          }}
          onFolderAction={(folder, action) => {
            closeContextMenu();
            onFolderAction(folder, action);
          }}
        />
      ) : null}
    </aside>
  );
}

function SidebarContextMenu({
  state,
  onClose,
  onAddSubscription,
  onAddFolder,
  onFeedAction,
  onFolderAction,
}: {
  state: SidebarContextMenuState;
  onAddSubscription: (sourceType: AddFeedSourceType) => void;
  onAddFolder: () => void;
  onClose: () => void;
  onFeedAction: (feed: Feed, action: FeedManagementAction) => void;
  onFolderAction: (folder: FolderType, action: FolderManagementAction) => void;
}) {
  return (
    <Menu.Root
      defaultOpen
      modal={false}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <MenuPopup
        id={state.kind === "add" ? "sidebar-add-menu" : undefined}
        className="sidebar-context-menu context-action-menu"
        aria-label={
          state.kind === "add"
            ? "Add subscription or folder"
            : `${state.kind === "feed" ? state.feed.title : state.folder.name} actions`
        }
        finalFocus={() => state.trigger}
        positioner={{
          anchor: { getBoundingClientRect: () => new DOMRect(state.left, state.top, 0, 0) },
          align: "start",
          sideOffset: 0,
        }}
        onContextMenu={(event) => event.preventDefault()}
      >
        {state.kind === "add" ? (
          <>
            {ADD_FEED_SOURCE_OPTIONS.map(({ value, label, icon: Icon }) => (
              <MenuItem key={value} onClick={() => onAddSubscription(value)}>
                <Icon aria-hidden="true" size={16} />
                {label}
              </MenuItem>
            ))}
            <hr className="context-menu-separator" />
            <MenuItem onClick={onAddFolder}>
              <Folder aria-hidden="true" size={16} />
              New folder
            </MenuItem>
          </>
        ) : state.kind === "feed" ? (
          <FeedActionMenuItems
            feed={state.feed}
            onAction={(action) => onFeedAction(state.feed, action)}
          />
        ) : (
          <FolderActionMenuItems onAction={(action) => onFolderAction(state.folder, action)} />
        )}
      </MenuPopup>
    </Menu.Root>
  );
}

function SidebarFolder({
  folder,
  folders,
  feeds,
  selectedFeedId,
  selectedFolderId,
  selectedFolderPathIds,
  currentView,
  feedDrag,
  onSelectScope,
  onOpenFeedMenu,
  onOpenFolderMenu,
}: {
  folder: FolderType;
  folders: FolderType[];
  feeds: Feed[];
  selectedFeedId: number | null;
  selectedFolderId: number | null;
  selectedFolderPathIds: Set<number>;
  currentView: AppView;
  feedDrag: FeedDragState;
  onSelectScope: (feedId: number | null, folderId: number | null) => void;
  onOpenFeedMenu: (feed: Feed, trigger: HTMLButtonElement, left: number, top: number) => void;
  onOpenFolderMenu: (
    folder: FolderType,
    trigger: HTMLButtonElement,
    left: number,
    top: number,
  ) => void;
}) {
  const revealsSelection = selectedFolderPathIds.has(folder.id);
  const [expanded, setExpanded] = useState(revealsSelection);
  const childFolders = folders.filter((candidate) => candidate.parentId === folder.id);
  const childFeeds = feeds.filter((feed) => feed.folderId === folder.id);
  const hasChildren = childFolders.length > 0 || childFeeds.length > 0;
  const selectedScope =
    selectedFeedId !== null
      ? `feed:${selectedFeedId}`
      : selectedFolderId !== null
        ? `folder:${selectedFolderId}`
        : null;
  const {
    ref: dropRef,
    available: dropAvailable,
    isDropTarget: dropActive,
  } = useFeedDropTarget(folder.id, folder.name, () => setExpanded(true));

  useEffect(() => {
    if (revealsSelection && selectedScope) setExpanded(true);
  }, [revealsSelection, selectedScope]);

  return (
    <li>
      <div
        className={`tree-row${dropAvailable ? " is-feed-drop-available" : ""}${dropActive ? " is-feed-drop-target" : ""}`}
      >
        <button
          className="tree-toggle"
          type="button"
          aria-label={`${expanded ? "Collapse" : "Expand"} ${folder.name}`}
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
          disabled={!hasChildren}
        >
          {expanded ? (
            <ChevronDown aria-hidden="true" size={14} />
          ) : (
            <ChevronRight aria-hidden="true" size={14} />
          )}
        </button>
        <button
          data-management-folder-id={folder.id}
          className="nav-item tree-nav-item"
          aria-current={
            currentView === "reader" && selectedFolderId === folder.id && selectedFeedId === null
              ? "page"
              : undefined
          }
          type="button"
          ref={dropRef}
          onClick={() => onSelectScope(null, folder.id)}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onOpenFolderMenu(folder, event.currentTarget, event.clientX, event.clientY);
          }}
          onKeyDown={(event) => {
            if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
            event.preventDefault();
            const bounds = event.currentTarget.getBoundingClientRect();
            onOpenFolderMenu(folder, event.currentTarget, bounds.left + 24, bounds.bottom - 4);
          }}
          aria-haspopup="menu"
        >
          <Folder aria-hidden="true" size={15} />
          <span className="truncate" title={folder.name}>
            {folder.name}
          </span>
          {folder.unreadCount > 0 ? <ArticleCount count={folder.unreadCount} /> : null}
        </button>
        <button
          className="folder-menu-button"
          type="button"
          aria-label={`Manage ${folder.name}`}
          title={`Manage ${folder.name}`}
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            onOpenFolderMenu(folder, event.currentTarget, bounds.right, bounds.bottom);
          }}
        >
          <Ellipsis aria-hidden="true" size={15} />
        </button>
      </div>
      {expanded && hasChildren ? (
        <ul className="folder-tree nested-tree">
          {childFolders.map((child) => (
            <SidebarFolder
              key={child.id}
              folder={child}
              folders={folders}
              feeds={feeds}
              selectedFeedId={selectedFeedId}
              selectedFolderId={selectedFolderId}
              selectedFolderPathIds={selectedFolderPathIds}
              currentView={currentView}
              feedDrag={feedDrag}
              onSelectScope={onSelectScope}
              onOpenFeedMenu={onOpenFeedMenu}
              onOpenFolderMenu={onOpenFolderMenu}
            />
          ))}
          {childFeeds.map((feed) => (
            <SidebarFeed
              key={feed.id}
              feed={feed}
              selected={currentView === "reader" && selectedFeedId === feed.id}
              feedDrag={feedDrag}
              onSelect={() => onSelectScope(feed.id, null)}
              onOpenMenu={onOpenFeedMenu}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function SidebarFeed({
  feed,
  selected,
  feedDrag,
  onSelect,
  onOpenMenu,
}: {
  feed: Feed;
  selected: boolean;
  feedDrag: FeedDragState;
  onSelect: () => void;
  onOpenMenu: (feed: Feed, trigger: HTMLButtonElement, left: number, top: number) => void;
}) {
  const healthClass =
    feed.healthStatus !== "healthy" ? "failed" : feed.paused ? "paused" : "healthy";
  const healthLabel =
    feed.healthStatus !== "healthy" ? "Needs attention" : feed.paused ? "Paused" : "Healthy";
  const { ref: dragRef, isDragging: dragging } = useFeedDraggable(feed);
  const moving = feedDrag.movingFeedId === feed.id;

  return (
    <li>
      <div
        className={`feed-tree-row${dragging ? " is-dragging" : ""}${moving ? " is-moving" : ""}`}
      >
        <button
          data-management-feed-id={feed.id}
          className="nav-item feed-nav-item"
          aria-current={selected ? "page" : undefined}
          aria-haspopup="menu"
          aria-busy={moving || undefined}
          ref={dragRef}
          type="button"
          onClick={onSelect}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onOpenMenu(feed, event.currentTarget, event.clientX, event.clientY);
          }}
          onKeyDown={(event) => {
            if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
            event.preventDefault();
            const bounds = event.currentTarget.getBoundingClientRect();
            onOpenMenu(feed, event.currentTarget, bounds.left + 24, bounds.bottom - 4);
          }}
        >
          <span
            className={`status-dot ${healthClass}`}
            role="img"
            aria-label={`Feed health: ${healthLabel}`}
            title={feed.lastError ?? healthLabel}
          />
          <span className="truncate">{feed.title}</span>
          {feed.unreadCount > 0 ? <ArticleCount count={feed.unreadCount} /> : null}
        </button>
        <button
          className="feed-menu-button"
          type="button"
          aria-label={`Manage ${feed.title}`}
          title={`Manage ${feed.title}`}
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            onOpenMenu(feed, event.currentTarget, bounds.right, bounds.bottom);
          }}
        >
          <Ellipsis aria-hidden="true" size={15} />
        </button>
      </div>
    </li>
  );
}
