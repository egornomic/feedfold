import {
  type FormEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { toast as showToast } from "sonner";
import type {
  Article,
  ArticleState,
  BootstrapData,
  Feed,
  Folder as FolderType,
  Rule,
  SessionUser,
} from "../../../shared/types";
import { api, errorMessage } from "../../api";
import { useAppRoute } from "../../app-route";
import { SessionLoading } from "../../auth";
import { type ReaderDataBinding, ReaderDataResource } from "../../data-resource";
import { isDesktopApp } from "../../desktop";
import type {
  FeedManagementAction,
  FolderManagementAction,
  ManagementRequest,
} from "../../feed-management";
import type { AddFeedSourceType } from "../../feed-source";
import { folderPathLabel } from "../../folder-hierarchy";
import { useDelayedPending } from "../../loading";
import type { RuleFormDraft } from "../../management/rules";
import {
  appRoutePath,
  DEFAULT_READER_ROUTE,
  type ReaderRoute,
  routeAfterFeedDeletion,
} from "../../routes";
import { type AppView, Sidebar } from "../navigation/sidebar";
import {
  EMPTY_ARTICLE_SUMMARY_STATE,
  EMPTY_ARTICLE_TRANSLATION_STATE,
} from "./article/article-ai-state";
import { useArticleActions } from "./article-actions";
import { useArticleQueue } from "./article-queue";
import { ARTICLE_FONT_MAX, ARTICLE_FONT_MIN, useReaderPreferences } from "./reader-preferences";
import {
  filterRuleName,
  readerRouteForSelection,
  readerScopeLabel,
  readerScopeUnreadCount,
  refreshFeedIds,
} from "./reader-state";
import { ArticleListSkeleton, EmptyArticles, InlineError, StartupError } from "./reader-states";
import { ReaderToolbar } from "./reader-toolbar";
import { ArticleList } from "./views/article-list";
import { ExpandedStream } from "./views/expanded-stream";
import { ReaderPane } from "./views/reader-pane";

const APP_BASE_PATH = import.meta.env.BASE_URL;
const DEMO_SOURCE_URL =
  (import.meta as ImportMeta & { env?: { VITE_FEEDFOLD_DEMO?: string } }).env
    ?.VITE_FEEDFOLD_DEMO === "true"
    ? "https://github.com/egornomic/feedfold"
    : undefined;
const FeedsPage = lazy(() => import("../../management/feeds"));
const AddFeedPage = lazy(async () => ({
  default: (await import("../../management/feeds")).AddFeedPage,
}));
const RulesPage = lazy(() => import("../../management/rules"));
const SettingsPage = lazy(() => import("../../management/settings"));
const ShortcutHelp = lazy(() => import("../../management/shortcut-help"));
const ContextManagementDialog = lazy(() => import("../../management/context-dialog"));

interface SidebarLayoutSnapshot {
  items: Array<{ element: HTMLElement; left: number; top: number }>;
}

function visibleSidebarMotionItems(main: HTMLElement | null): HTMLElement[] {
  if (!main) return [];
  const content = main.querySelectorAll<HTMLElement>(
    [
      ".reader-title-row > *",
      ".article-list > ol",
      ".mode-magazine .article-document",
      ".expanded-stream",
    ].join(","),
  );
  return [...content].filter((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.width > 0 && bounds.height > 0;
  });
}

function feedManagementRequest(feedId: number, action: FeedManagementAction): ManagementRequest {
  if (action === "settings") return { kind: "feed-settings", feedId };
  if (action === "selection") return { kind: "web-feed-selection", feedId };
  if (action === "rename") return { kind: "rename-feed", feedId };
  if (action === "move") return { kind: "move-feed", feedId };
  if (action === "rule") return { kind: "create-feed-rule", feedId };
  return { kind: "unsubscribe-feed", feedId };
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

function usesSpaceForActivation(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(
      'button, a[href], summary, [role="button"], [role="checkbox"], [role="menuitem"], [role="option"], [role="radio"], [role="switch"], [role="tab"]',
    ) !== null
  );
}

export default function ReaderApp({
  user,
  onLogout,
  onAccountDeleted,
}: {
  user: SessionUser;
  onLogout: () => Promise<void>;
  onAccountDeleted: () => void;
}) {
  const route = useAppRoute(APP_BASE_PATH);
  const preferences = useReaderPreferences(user.id);
  const { desktopSidebarCollapsed, setDesktopSidebarCollapsed } = preferences;
  const dataResourceRef = useRef<ReaderDataResource | null>(null);
  if (!dataResourceRef.current) dataResourceRef.current = new ReaderDataResource();
  const dataResource = dataResourceRef.current;
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [ruleDraft, setRuleDraft] = useState<RuleFormDraft | null>(null);
  const [managementRequest, setManagementRequest] = useState<ManagementRequest | null>(null);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const sequence = useRef<{ startedAt: number } | null>(null);
  const ruleDraftId = useRef(0);
  const ruleReturnRoute = useRef<ReaderRoute | null>(null);
  const bootstrapRef = useRef(bootstrap);
  const readingWorkspaceRef = useRef<HTMLDivElement>(null);
  const sidebarLayoutSnapshot = useRef<SidebarLayoutSnapshot | null>(null);
  const sidebarLayoutAnimations = useRef<Animation[]>([]);
  bootstrapRef.current = bootstrap;

  const toggleDesktopSidebar = useCallback(() => {
    const main = document.querySelector<HTMLElement>(".main-column");
    sidebarLayoutSnapshot.current = {
      items: (route.view === "reader" ? visibleSidebarMotionItems(main) : []).map((element) => {
        const bounds = element.getBoundingClientRect();
        return { element, left: bounds.left, top: bounds.top };
      }),
    };
    setDesktopSidebarCollapsed((current) => !current);
  }, [route.view, setDesktopSidebarCollapsed]);

  useLayoutEffect(() => {
    const snapshot = sidebarLayoutSnapshot.current;
    if (!snapshot) return;
    sidebarLayoutSnapshot.current = null;
    for (const animation of sidebarLayoutAnimations.current) animation.cancel();

    const main = document.querySelector<HTMLElement>(".main-column");
    const toggleLabel = desktopSidebarCollapsed ? "Show sidebar" : "Hide sidebar";
    const toggle = document.querySelector<HTMLElement>(
      `.sidebar-collapse-button[aria-label="${toggleLabel}"]`,
    );
    const styles = window.getComputedStyle(document.documentElement);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = Number.parseFloat(
      styles.getPropertyValue(reducedMotion ? "--duration-reduced" : "--duration-surface"),
    );
    const easing = reducedMotion ? "ease" : styles.getPropertyValue("--ease-in-out").trim();
    const animations: Animation[] = [];

    if (reducedMotion) {
      if (main) {
        animations.push(main.animate([{ opacity: 0.86 }, { opacity: 1 }], { duration, easing }));
      }
      if (toggle) {
        animations.push(toggle.animate([{ opacity: 0.72 }, { opacity: 1 }], { duration, easing }));
      }
    } else {
      for (const { element, left, top } of snapshot.items) {
        if (!element.isConnected) continue;
        const bounds = element.getBoundingClientRect();
        const offsetX = left - bounds.left;
        const offsetY = top - bounds.top;
        if (Math.abs(offsetX) < 0.5 && Math.abs(offsetY) < 0.5) continue;
        animations.push(
          element.animate(
            [
              { transform: `translate3d(${offsetX}px, ${offsetY}px, 0)` },
              { transform: "translate3d(0, 0, 0)" },
            ],
            { duration, easing },
          ),
        );
      }
    }

    sidebarLayoutAnimations.current = animations;
    return () => {
      for (const animation of animations) animation.cancel();
    };
  }, [desktopSidebarCollapsed]);

  const queue = useArticleQueue({
    route,
    dataResource,
    bootstrapReady: bootstrap !== null,
    readingMode: preferences.readingMode,
    onReadingModeChange: preferences.setReadingMode,
    showToast,
  });
  const articleActions = useArticleActions({
    bootstrap,
    queue,
    route,
    dataResource,
    readingMode: queue.readingMode,
    showToast,
  });
  const showRouteLoading = useDelayedPending(route.pending, appRoutePath(route.current()));
  const articlePending =
    queue.readingMode === "magazine" &&
    route.routedArticleId !== null &&
    !queue.fullContentLoadedIds.current.has(route.routedArticleId) &&
    !articleActions.articleContentErrors.has(route.routedArticleId);
  const showArticleLoading = useDelayedPending(articlePending, route.routedArticleId);
  const readerWasOpen = useRef(false);
  const readerOpen =
    route.routedArticleId !== null &&
    (readerWasOpen.current || !articlePending || showArticleLoading);
  useLayoutEffect(() => {
    readerWasOpen.current = readerOpen;
  }, [readerOpen]);
  const displayedReaderRoute =
    route.route.kind === "reader" && !queue.showLoading && !queue.error
      ? (queue.loadedReaderRoute ?? route.readerRoute)
      : route.readerRoute;
  const readerPath = appRoutePath(displayedReaderRoute);

  useLayoutEffect(() => {
    if (readerPath && readingWorkspaceRef.current) {
      readingWorkspaceRef.current.scrollTop = 0;
    }
  }, [readerPath]);

  const reloadRules = useCallback(async (signal: AbortSignal) => {
    setRulesLoading(true);
    setRulesError(null);
    try {
      const nextRules = await api.rules(signal);
      if (!signal.aborted) setRules(nextRules);
    } catch (error) {
      if (!signal.aborted) setRulesError(errorMessage(error));
      throw error;
    } finally {
      if (!signal.aborted) setRulesLoading(false);
    }
  }, []);

  const resourceBinding: ReaderDataBinding = {
    getBootstrap: () => bootstrapRef.current,
    applyBootstrap: (nextBootstrap) => {
      bootstrapRef.current = nextBootstrap;
      setBootstrap(nextBootstrap);
    },
    setBootstrapError,
    reloadArticles: (signal, mode) =>
      mode === "query"
        ? queue.reloadQuery(signal)
        : mode === "delivery"
          ? queue.reloadAfterDelivery(signal)
          : queue.reloadAfterMutation(signal),
    reloadRules,
  };
  dataResource.connect(resourceBinding);

  useEffect(() => {
    dataResource.resume();
    void dataResource.loadBootstrap();
    return () => dataResource.pause();
  }, [dataResource]);

  useEffect(() => {
    if (route.view === "rules") void dataResource.loadRules();
  }, [dataResource, route.view]);

  useEffect(() => {
    if (route.route) setNavOpen(false);
  }, [route.route]);

  const selectScope = useCallback(
    (feedId: number | null, folderId: number | null, state: ArticleState = "unread") => {
      const nextRoute = readerRouteForSelection(state, feedId, folderId, route.readerRoute.search);
      if (appRoutePath(route.current()) === appRoutePath(nextRoute)) {
        setNavOpen(false);
        return;
      }
      route.selectScope(feedId, folderId, state);
      setNavOpen(false);
      void dataResource.loadBootstrap();
    },
    [dataResource, route],
  );

  const navigateTo = useCallback(
    (view: AppView) => {
      route.navigateToView(view);
      setNavOpen(false);
    },
    [route],
  );

  const openAddFeed = useCallback(() => {
    route.navigate({ kind: "add-feed", sourceUrl: "" });
    setNavOpen(false);
  }, [route]);

  const submitSearch = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      route.navigate(
        readerRouteForSelection(
          route.readerRoute.state,
          route.readerRoute.scope === "feed" ? route.readerRoute.scopeId : null,
          route.readerRoute.scope === "folder" ? route.readerRoute.scopeId : null,
          route.searchInput.trim(),
        ),
      );
    },
    [route],
  );

  const filterSelectedText = useCallback(
    (article: Article, text: string) => {
      const pattern = text.replace(/\s+/g, " ").trim();
      if (!pattern) return;
      ruleDraftId.current += 1;
      setRuleDraft({
        id: ruleDraftId.current,
        name: filterRuleName(pattern),
        article,
        articleIndex: Math.max(
          0,
          queue.articles.findIndex((item) => item.id === article.id),
        ),
        feedId: article.feedId,
        field: "any",
        pattern,
      });
      ruleReturnRoute.current = route.readerRoute;
      route.openRulesFromArticle(route.readerRoute);
    },
    [queue.articles, route],
  );

  const returnToContextArticle = useCallback(
    (draft: RuleFormDraft) => {
      const returnRoute = ruleReturnRoute.current ?? route.readerRoute;
      queue.preserveContextArticle(draft.article, draft.articleIndex, returnRoute);
      route.returnToContextArticle(draft.article.id, returnRoute);
    },
    [queue, route],
  );

  const openFeedManagement = useCallback((feed: Feed, action: FeedManagementAction) => {
    setManagementRequest(feedManagementRequest(feed.id, action));
  }, []);

  const openFeedManagementById = useCallback(
    (feedId: number, action: FeedManagementAction) => {
      const feed = bootstrap?.feeds.find((candidate) => candidate.id === feedId);
      if (feed) openFeedManagement(feed, action);
    },
    [bootstrap, openFeedManagement],
  );

  const openFolderManagement = useCallback((folder: FolderType, action: FolderManagementAction) => {
    if (action === "settings") {
      setManagementRequest({ kind: "folder-settings", folderId: folder.id });
    } else if (action === "add-feed") {
      setManagementRequest({ kind: "add-feed-to-folder", folderId: folder.id });
    } else if (action === "add-folder") {
      setManagementRequest({ kind: "add-folder", parentId: folder.id });
    } else if (action === "rule") {
      setManagementRequest({ kind: "create-folder-rule", folderId: folder.id });
    } else {
      setManagementRequest({ kind: "delete-folder", folderId: folder.id });
    }
  }, []);

  const moveFeed = useCallback(
    async (feed: Feed, folderId: number | null): Promise<boolean> => {
      try {
        await dataResource.updateFeed(feed.id, { folderId });
        const destination = folderPathLabel(folderId, bootstrapRef.current?.folders ?? []);
        showToast(`Moved ${feed.title} to ${destination}`);
        return true;
      } catch (error) {
        showToast(`Could not move ${feed.title}: ${errorMessage(error)}`);
        return false;
      }
    },
    [dataResource],
  );

  const unsubscribeFromFeed = useCallback(
    async (feed: Feed): Promise<boolean> => {
      try {
        await dataResource.deleteFeed(feed.id);
        showToast(`Unsubscribed from ${feed.title}`);
        const currentRoute = route.current();
        const readerRoute =
          currentRoute.kind === "reader" || currentRoute.kind === "article"
            ? route.readerRoute
            : DEFAULT_READER_ROUTE;
        const nextRoute = routeAfterFeedDeletion(currentRoute, readerRoute, feed.id);
        queue.invalidate();
        if (nextRoute) route.navigate(nextRoute, "replace");
        return true;
      } catch (error) {
        showToast(`Could not unsubscribe from ${feed.title}: ${errorMessage(error)}`);
        return false;
      }
    },
    [dataResource, queue, route],
  );

  const refresh = useCallback(
    async (feedId?: number, forceAll = false) => {
      if (!bootstrap?.capabilities.manualRefresh) return;
      const selectedFeedId = route.readerRoute.scope === "feed" ? route.readerRoute.scopeId : null;
      const selectedFolderId =
        route.readerRoute.scope === "folder" ? route.readerRoute.scopeId : null;
      const ids = forceAll
        ? undefined
        : refreshFeedIds(bootstrap, feedId ?? selectedFeedId, selectedFolderId);
      const trackedIds = bootstrap.feeds
        .filter((feed) => !feed.paused && (!ids || ids.includes(feed.id)))
        .map((feed) => feed.id);
      try {
        const { result, settled } = await dataResource.beginRefresh(ids, trackedIds);
        showToast(`Refreshing ${result.requested} ${result.requested === 1 ? "feed" : "feeds"}`);
        await settled;
        showToast("Feeds refreshed");
      } catch (error) {
        showToast(`Could not refresh feeds: ${errorMessage(error)}`);
      }
    },
    [bootstrap, dataResource, route.readerRoute],
  );

  const changeReadingMode = useCallback(
    (mode: "magazine" | "expanded") => {
      queue.clearKeyboardTarget();
      preferences.setReadingMode(mode);
    },
    [preferences, queue],
  );

  const scrollArticlePage = useCallback(
    (direction: 1 | -1): boolean => {
      const workspace = readingWorkspaceRef.current;
      if (!workspace || route.view !== "reader") return false;
      const scrollContainer =
        queue.readingMode === "expanded"
          ? workspace
          : route.routedArticleId !== null
            ? workspace.querySelector<HTMLElement>(".article-swipe-layer.is-active")
            : null;
      if (!scrollContainer) return false;
      scrollContainer.scrollTop += direction * scrollContainer.clientHeight * 0.85;
      return true;
    },
    [queue.readingMode, route.routedArticleId, route.view],
  );

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (managementRequest) return;
      if (event.key === "Escape") {
        setShortcutHelpOpen(false);
        setNavOpen(false);
        if (route.routedArticleId !== null) route.returnToArticleList();
        return;
      }
      if (shortcutHelpOpen) return;
      if (isEditable(event.target) || !bootstrap?.settings.singleKeyShortcuts) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const key = event.key.toLowerCase();
      if (sequence.current && Date.now() - sequence.current.startedAt < 1200) {
        sequence.current = null;
        const destinations: Record<string, () => void> = {
          u: () => selectScope(null, null, "unread"),
          s: () => selectScope(null, null, "starred"),
          a: () => selectScope(null, null, "all"),
          f: () => navigateTo("feeds"),
          r: () => navigateTo("rules"),
          ",": () => navigateTo("settings"),
        };
        if (destinations[key]) {
          event.preventDefault();
          destinations[key]();
        }
        return;
      }

      if (key === "g") {
        sequence.current = { startedAt: Date.now() };
        return;
      }
      if (queue.loading || route.pending) return;
      if (key === "r" && !bootstrap.capabilities.manualRefresh) return;
      if (event.shiftKey && key === "r") {
        event.preventDefault();
        void refresh(undefined, true);
        return;
      }
      if (key === " ") {
        if (usesSpaceForActivation(event.target)) return;
        if (scrollArticlePage(event.shiftKey ? -1 : 1)) event.preventDefault();
        return;
      }

      const activeArticle = queue.activeArticle;
      const actions: Record<string, () => void> = {
        j: () => void articleActions.moveArticle(1),
        k: () => void articleActions.moveArticle(-1),
        arrowright: () => void articleActions.moveArticle(1),
        arrowleft: () => void articleActions.moveArticle(-1),
        u: () => {
          if (!activeArticle) return;
          const nextRead = !activeArticle.isRead;
          void articleActions.changeArticleState(activeArticle, { isRead: nextRead });
          showToast(nextRead ? "Article marked as read" : "Article marked as unread");
        },
        s: () => {
          if (!activeArticle) return;
          void articleActions.changeArticleState(activeArticle, {
            isStarred: !activeArticle.isStarred,
          });
          showToast(activeArticle.isStarred ? "Removed from Saved" : "Article saved");
        },
        c: () => void articleActions.copyArticleUrl(activeArticle),
        o: () => articleActions.openArticleSource(activeArticle),
        w: () => {
          if (activeArticle && (queue.readingMode === "expanded" || route.routedArticleId)) {
            void articleActions.toggleFullContent(activeArticle);
          }
        },
        m: () => {
          if (activeArticle && (queue.readingMode === "expanded" || route.routedArticleId)) {
            articleActions.toggleArticleSummary(activeArticle);
          }
        },
        t: () => {
          if (activeArticle && (queue.readingMode === "expanded" || route.routedArticleId)) {
            articleActions.toggleArticleTranslation(activeArticle);
          }
        },
        r: () => void refresh(),
        "[": () => {
          const next = Math.max(ARTICLE_FONT_MIN, preferences.articleFontSize - 1);
          preferences.setArticleFontSize(next);
          showToast(`Article text size set to ${next}px`);
        },
        "]": () => {
          const next = Math.min(ARTICLE_FONT_MAX, preferences.articleFontSize + 1);
          preferences.setArticleFontSize(next);
          showToast(`Article text size set to ${next}px`);
        },
        "1": () => changeReadingMode("magazine"),
        "2": () => changeReadingMode("expanded"),
        "?": () => setShortcutHelpOpen(true),
      };
      if (actions[key]) {
        event.preventDefault();
        actions[key]();
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [
    articleActions,
    bootstrap?.capabilities.manualRefresh,
    bootstrap?.settings.singleKeyShortcuts,
    changeReadingMode,
    managementRequest,
    navigateTo,
    preferences,
    queue.activeArticle,
    queue.loading,
    queue.readingMode,
    refresh,
    route,
    scrollArticlePage,
    selectScope,
    shortcutHelpOpen,
  ]);

  if (!bootstrap || (route.view === "reader" && !queue.loadedReaderRoute && !queue.error)) {
    return bootstrapError ? (
      <StartupError message={bootstrapError} retry={() => void dataResource.loadBootstrap()} />
    ) : (
      <SessionLoading />
    );
  }

  const selectedFeedId = route.readerRoute.scope === "feed" ? route.readerRoute.scopeId : null;
  const selectedFolderId = route.readerRoute.scope === "folder" ? route.readerRoute.scopeId : null;
  const displayedFeedId =
    displayedReaderRoute.scope === "feed" ? displayedReaderRoute.scopeId : null;
  const displayedFolderId =
    displayedReaderRoute.scope === "folder" ? displayedReaderRoute.scopeId : null;
  const title = readerScopeLabel(
    bootstrap,
    displayedFeedId,
    displayedFolderId,
    displayedReaderRoute.state,
  );

  return (
    <div
      className={`app-shell${route.view === "reader" ? "" : " is-management-view"}${readerOpen ? " is-reading-article" : ""}${desktopSidebarCollapsed ? " is-sidebar-collapsed" : ""}`}
    >
      <a className="skip-link" href="#main-content">
        Skip to articles
      </a>
      <Sidebar
        bootstrap={bootstrap}
        user={user}
        localApp={isDesktopApp()}
        sourceUrl={DEMO_SOURCE_URL}
        currentState={route.readerRoute.state}
        selectedFeedId={selectedFeedId}
        selectedFolderId={selectedFolderId}
        currentView={route.view}
        open={navOpen}
        collapsed={desktopSidebarCollapsed}
        onClose={() => setNavOpen(false)}
        onToggleCollapse={toggleDesktopSidebar}
        onSelectState={(state) => selectScope(null, null, state)}
        onSelectScope={selectScope}
        onAddFeed={openAddFeed}
        onAddSubscription={(sourceType: AddFeedSourceType) => {
          route.navigate({ kind: "add-feed", sourceUrl: "", sourceType });
          setNavOpen(false);
        }}
        onAddFolder={() => setManagementRequest({ kind: "create-folder" })}
        onNavigate={navigateTo}
        onFeedAction={openFeedManagement}
        onFolderAction={openFolderManagement}
        onMoveFeed={moveFeed}
        onRefresh={() => void refresh()}
        onLogout={onLogout}
      />

      {showRouteLoading ? (
        <div className="route-loading-status" role="status">
          Opening page…
        </div>
      ) : null}
      <main
        id="main-content"
        className="main-column"
        tabIndex={-1}
        inert={route.pending}
        aria-busy={route.pending}
      >
        {route.view === "reader" ? (
          <>
            <ReaderToolbar
              title={title}
              articleState={displayedReaderRoute.state}
              unreadCount={readerScopeUnreadCount(bootstrap, displayedFeedId, displayedFolderId)}
              searchInput={route.searchInput}
              searchActive={Boolean(route.readerRoute.search)}
              mode={queue.readingMode}
              refreshing={bootstrap.feeds.some((feed) => feed.refreshing)}
              markReadPending={articleActions.markReadPending || queue.loading}
              navOpen={navOpen}
              readingArticle={readerOpen && queue.readingMode === "magazine"}
              manualRefreshEnabled={bootstrap.capabilities.manualRefresh}
              onToggleNav={() => setNavOpen((current) => !current)}
              onArticleStateChange={(state) =>
                selectScope(displayedFeedId, displayedFolderId, state)
              }
              onSearchInput={route.setSearchInput}
              onSearch={submitSearch}
              onClearSearch={() => {
                route.setSearchInput("");
                route.navigate(
                  readerRouteForSelection(
                    route.readerRoute.state,
                    selectedFeedId,
                    selectedFolderId,
                    "",
                  ),
                );
              }}
              onModeChange={changeReadingMode}
              onRefresh={() => void refresh()}
              onRefreshAll={() => void refresh(undefined, true)}
              onMarkRead={() => void articleActions.markVisibleRead()}
              onMarkReadByAge={(days) => void articleActions.markOlderArticlesRead(days)}
              onHelp={() => setShortcutHelpOpen(true)}
            />

            <div
              ref={readingWorkspaceRef}
              className={`reading-workspace mode-${queue.readingMode}${readerOpen ? " is-reading-article" : ""}`}
              aria-busy={queue.loading}
              inert={queue.loading && !queue.showLoading}
            >
              {queue.showLoading ? (
                <ArticleListSkeleton mode={queue.readingMode} />
              ) : queue.loading && !queue.loadedReaderRoute ? null : queue.error ? (
                <InlineError
                  title={
                    route.routedArticleId === null
                      ? "Could not load articles"
                      : "Could not load the article"
                  }
                  detail={queue.error}
                  retry={() =>
                    route.routedArticleId === null
                      ? void queue.loadArticles()
                      : queue.retryRoutedArticle()
                  }
                />
              ) : queue.articles.length === 0 ? (
                <EmptyArticles
                  hasFeeds={bootstrap.feeds.length > 0}
                  search={displayedReaderRoute.search}
                  state={displayedReaderRoute.state}
                  onAddFeed={openAddFeed}
                  onShowSaved={() => selectScope(null, null, "starred")}
                  onShowAll={() =>
                    route.navigate(
                      readerRouteForSelection(
                        "all",
                        selectedFeedId,
                        selectedFolderId,
                        route.readerRoute.search,
                      ),
                    )
                  }
                  onClearSearch={() => {
                    route.navigate(
                      readerRouteForSelection(
                        route.readerRoute.state,
                        selectedFeedId,
                        selectedFolderId,
                        "",
                      ),
                    );
                  }}
                />
              ) : queue.readingMode === "magazine" ? (
                <>
                  <ArticleList
                    key={readerPath}
                    articles={queue.articles}
                    activeId={queue.activeArticleId}
                    markReadOnScroll={!queue.loading && bootstrap.settings.markReadOnScroll}
                    showYouTubeDescriptions={bootstrap.settings.showYouTubeDescriptions}
                    hasMore={
                      queue.nextCursor !== null && queue.readingMode === preferences.readingMode
                    }
                    loadingMore={queue.loadingMore}
                    onLoadMore={() => void queue.loadOlderArticles()}
                    onOpen={articleActions.openArticle}
                    onMarkPassedRead={articleActions.markPassedArticlesRead}
                    onToggleRead={(article) =>
                      void articleActions.changeArticleState(article, { isRead: !article.isRead })
                    }
                    onToggleStar={(article) =>
                      void articleActions.changeArticleState(article, {
                        isStarred: !article.isStarred,
                      })
                    }
                  />
                  <ReaderPane
                    article={queue.activeArticle}
                    contentLoaded={
                      queue.activeArticle !== null &&
                      queue.fullContentLoadedIds.current.has(queue.activeArticle.id)
                    }
                    contentError={
                      queue.activeArticle
                        ? (articleActions.articleContentErrors.get(queue.activeArticle.id) ?? null)
                        : null
                    }
                    onRetryContent={articleActions.retryArticleContent}
                    canPrevious={queue.activeArticleIndex > 0}
                    canNext={
                      queue.activeArticleIndex >= 0 &&
                      (queue.activeArticleIndex < queue.articles.length - 1 ||
                        (queue.nextCursor !== null && !queue.loadingMore))
                    }
                    fullContentVisible={
                      queue.activeArticle
                        ? articleActions.fullContentVisibleIds.has(queue.activeArticle.id)
                        : false
                    }
                    summaryState={
                      queue.activeArticle
                        ? (articleActions.articleSummaryStates.get(queue.activeArticle.id) ??
                          EMPTY_ARTICLE_SUMMARY_STATE)
                        : EMPTY_ARTICLE_SUMMARY_STATE
                    }
                    translationState={
                      queue.activeArticle
                        ? (articleActions.articleTranslationStates.get(queue.activeArticle.id) ??
                          EMPTY_ARTICLE_TRANSLATION_STATE)
                        : EMPTY_ARTICLE_TRANSLATION_STATE
                    }
                    translationLanguage={bootstrap.settings.translationLanguage}
                    customPrompts={bootstrap.settings.customPrompts}
                    showYouTubeDescriptions={bootstrap.settings.showYouTubeDescriptions}
                    onBack={route.returnToArticleList}
                    onPrevious={() => articleActions.moveArticle(-1)}
                    onNext={() => articleActions.moveArticle(1)}
                    onToggleRead={(article) =>
                      void articleActions.changeArticleState(article, { isRead: !article.isRead })
                    }
                    onToggleStar={(article) =>
                      void articleActions.changeArticleState(article, {
                        isStarred: !article.isStarred,
                      })
                    }
                    onCopy={(article) => void articleActions.copyArticleUrl(article)}
                    onOpenSource={articleActions.openArticleSource}
                    onFeedAction={openFeedManagementById}
                    onToggleFullContent={(article) =>
                      void articleActions.toggleFullContent(article)
                    }
                    onRunSummaryPrompt={articleActions.runArticleSummaryPrompt}
                    onToggleTranslation={articleActions.toggleArticleTranslation}
                    onRegenerateSummary={articleActions.regenerateArticleSummary}
                    onOpenAiSettings={() => route.navigate({ kind: "settings", category: "ai" })}
                    onFilterSelection={filterSelectedText}
                  />
                </>
              ) : (
                <ExpandedStream
                  key={readerPath}
                  articles={
                    route.routedArticleId !== null && queue.activeArticle
                      ? [queue.activeArticle]
                      : queue.articles
                  }
                  activeId={queue.activeArticleId}
                  topAlignedId={queue.expandedKeyboardTargetId}
                  fullContentVisibleIds={articleActions.fullContentVisibleIds}
                  summaryStates={articleActions.articleSummaryStates}
                  translationStates={articleActions.articleTranslationStates}
                  translationLanguage={bootstrap.settings.translationLanguage}
                  customPrompts={bootstrap.settings.customPrompts}
                  showYouTubeDescriptions={bootstrap.settings.showYouTubeDescriptions}
                  markReadOnScroll={!queue.loading && bootstrap.settings.markReadOnScroll}
                  hasMore={
                    route.routedArticleId === null &&
                    queue.nextCursor !== null &&
                    queue.readingMode === preferences.readingMode
                  }
                  loadingMore={queue.loadingMore}
                  onLoadMore={() => void queue.loadOlderArticles()}
                  onActivate={(article) => queue.selectArticle(article.id)}
                  onMarkPassedRead={articleActions.markPassedArticlesRead}
                  onToggleRead={(article) =>
                    void articleActions.changeArticleState(article, { isRead: !article.isRead })
                  }
                  onToggleStar={(article) =>
                    void articleActions.changeArticleState(article, {
                      isStarred: !article.isStarred,
                    })
                  }
                  onCopy={(article) => void articleActions.copyArticleUrl(article)}
                  onOpenSource={articleActions.openArticleSource}
                  onFeedAction={openFeedManagementById}
                  onToggleFullContent={(article) => void articleActions.toggleFullContent(article)}
                  onRunSummaryPrompt={articleActions.runArticleSummaryPrompt}
                  onToggleTranslation={articleActions.toggleArticleTranslation}
                  onRegenerateSummary={articleActions.regenerateArticleSummary}
                  onOpenAiSettings={() => route.navigate({ kind: "settings", category: "ai" })}
                  onFilterSelection={filterSelectedText}
                />
              )}
            </div>
          </>
        ) : route.route.kind === "add-feed" ? (
          <AddFeedPage
            bootstrap={bootstrap}
            initialSourceUrl={route.route.sourceUrl}
            initialSourceType={route.route.sourceType}
            mutations={dataResource}
            onMenu={() => setNavOpen(true)}
            onBack={() => route.navigate({ kind: "feeds" }, "replace")}
            showToast={showToast}
          />
        ) : route.view === "feeds" ? (
          <FeedsPage
            bootstrap={bootstrap}
            mutations={dataResource}
            onMenu={() => setNavOpen(true)}
            onAddFeed={openAddFeed}
            onAddFolder={() => setManagementRequest({ kind: "create-folder" })}
            onRefresh={(feedId) => void refresh(feedId)}
            onFeedAction={openFeedManagement}
            onFolderAction={openFolderManagement}
            onMoveFeed={moveFeed}
            showToast={showToast}
          />
        ) : route.view === "rules" ? (
          <RulesPage
            bootstrap={bootstrap}
            rules={rules}
            loading={rulesLoading}
            error={rulesError}
            draft={ruleDraft}
            mutations={dataResource}
            onMenu={() => setNavOpen(true)}
            onClearDraft={() => setRuleDraft(null)}
            onReturnToArticle={returnToContextArticle}
            onRetry={() => dataResource.reload({ articles: true, rules: true })}
            showToast={showToast}
          />
        ) : (
          <SettingsPage
            userId={user.id}
            category={route.route.kind === "settings" ? route.route.category : "appearance"}
            settings={bootstrap.settings}
            aiSettings={bootstrap.aiSettings}
            theme={preferences.theme}
            colorPalettes={preferences.colorPalettes}
            fontSize={preferences.articleFontSize}
            mutations={dataResource}
            onMenu={() => setNavOpen(true)}
            onCategory={(category, historyMode) =>
              route.navigate({ kind: "settings", category }, historyMode)
            }
            onTheme={preferences.setTheme}
            onColorPalette={preferences.setColorPalette}
            onFontSize={preferences.setArticleFontSize}
            onSettings={articleActions.applySettings}
            onAiSettings={articleActions.applyAiSettings}
            onAccountDeleted={onAccountDeleted}
            showToast={showToast}
          />
        )}
      </main>

      {shortcutHelpOpen ? (
        <Suspense fallback={null}>
          <ShortcutHelp
            enabled={bootstrap.settings.singleKeyShortcuts}
            manualRefreshEnabled={bootstrap.capabilities.manualRefresh}
            onClose={() => setShortcutHelpOpen(false)}
          />
        </Suspense>
      ) : null}
      {managementRequest ? (
        <Suspense fallback={null}>
          <ContextManagementDialog
            key={
              "feedId" in managementRequest
                ? `${managementRequest.kind}:${managementRequest.feedId}`
                : "folderId" in managementRequest
                  ? `${managementRequest.kind}:${managementRequest.folderId}`
                  : "parentId" in managementRequest
                    ? `${managementRequest.kind}:${managementRequest.parentId}`
                    : managementRequest.kind
            }
            request={managementRequest}
            bootstrap={bootstrap}
            mutations={dataResource}
            onClose={() => setManagementRequest(null)}
            onRefresh={(feedId) => refresh(feedId)}
            onUnsubscribe={unsubscribeFromFeed}
            showToast={showToast}
          />
        </Suspense>
      ) : null}
      <button
        className={`nav-scrim${navOpen ? " is-open" : ""}`}
        type="button"
        aria-label="Close navigation"
        onClick={() => setNavOpen(false)}
      />
    </div>
  );
}
