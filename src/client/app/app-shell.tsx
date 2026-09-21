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
} from "../../shared/types";
import { api, errorMessage } from "../api";
import { SessionLoading } from "../auth";
import { type ReaderDataBinding, ReaderDataResource } from "../data-resource";
import { isDesktopApp } from "../desktop";
import type { RuleFormDraft } from "../features/management/rules";
import { Sidebar } from "../features/navigation/sidebar";
import { useSidebarMotion } from "../features/navigation/sidebar-motion";
import { useArticleActions } from "../features/reader/article-actions";
import { useArticleQueue } from "../features/reader/article-queue";
import { useReaderPreferences } from "../features/reader/reader-preferences";
import {
  filterRuleName,
  readerRouteForSelection,
  refreshFeedIds,
} from "../features/reader/reader-state";
import { StartupError } from "../features/reader/reader-states";
import { ReaderWorkspace } from "../features/reader/reader-workspace";
import type {
  FeedManagementAction,
  FolderManagementAction,
  ManagementRequest,
} from "../feed-management";
import type { AddFeedSourceType } from "../feed-source";
import { folderPathLabel } from "../folder-hierarchy";
import { useDelayedPending } from "../loading";
import { useAppRoute } from "./route";
import type { AppView } from "./routes";
import {
  appRoutePath,
  DEFAULT_READER_ROUTE,
  type ReaderRoute,
  routeAfterFeedDeletion,
} from "./routes";
import { useAppShortcuts } from "./shortcuts";

const APP_BASE_PATH = import.meta.env.BASE_URL;
const DEMO_SOURCE_URL =
  (import.meta as ImportMeta & { env?: { VITE_FEEDFOLD_DEMO?: string } }).env
    ?.VITE_FEEDFOLD_DEMO === "true"
    ? "https://github.com/egornomic/feedfold"
    : undefined;
const FeedsPage = lazy(() => import("../features/management/feeds"));
const AddFeedPage = lazy(async () => ({
  default: (await import("../features/management/feeds")).AddFeedPage,
}));
const RulesPage = lazy(() => import("../features/management/rules"));
const SettingsPage = lazy(() => import("../features/management/settings"));
const ShortcutHelp = lazy(() => import("../features/management/shortcut-help"));
const ContextManagementDialog = lazy(() => import("../features/management/context-dialog"));

function feedManagementRequest(feedId: number, action: FeedManagementAction): ManagementRequest {
  if (action === "settings") return { kind: "feed-settings", feedId };
  if (action === "selection") return { kind: "web-feed-selection", feedId };
  if (action === "rename") return { kind: "rename-feed", feedId };
  if (action === "move") return { kind: "move-feed", feedId };
  if (action === "rule") return { kind: "create-feed-rule", feedId };
  return { kind: "unsubscribe-feed", feedId };
}

export default function AppShell({
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
  const ruleDraftId = useRef(0);
  const ruleReturnRoute = useRef<ReaderRoute | null>(null);
  const bootstrapRef = useRef(bootstrap);
  const readingWorkspaceRef = useRef<HTMLDivElement>(null);
  bootstrapRef.current = bootstrap;

  const toggleDesktopSidebar = useSidebarMotion(
    route.view === "reader",
    desktopSidebarCollapsed,
    setDesktopSidebarCollapsed,
  );

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

  useAppShortcuts({
    bootstrap,
    managementRequest,
    shortcutHelpOpen,
    setShortcutHelpOpen,
    setNavOpen,
    route,
    queue,
    articleActions,
    preferences,
    selectScope,
    navigateTo,
    refresh,
    scrollArticlePage,
    changeReadingMode,
  });

  if (!bootstrap || (route.view === "reader" && !queue.loadedReaderRoute && !queue.error)) {
    return bootstrapError ? (
      <StartupError message={bootstrapError} retry={() => void dataResource.loadBootstrap()} />
    ) : (
      <SessionLoading />
    );
  }

  const selectedFeedId = route.readerRoute.scope === "feed" ? route.readerRoute.scopeId : null;
  const selectedFolderId = route.readerRoute.scope === "folder" ? route.readerRoute.scopeId : null;
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
          <ReaderWorkspace
            bootstrap={bootstrap}
            queue={queue}
            articleActions={articleActions}
            route={route}
            preferences={preferences}
            displayedReaderRoute={displayedReaderRoute}
            readerOpen={readerOpen}
            readingWorkspaceRef={readingWorkspaceRef}
            navOpen={navOpen}
            setNavOpen={setNavOpen}
            setShortcutHelpOpen={setShortcutHelpOpen}
            selectScope={selectScope}
            submitSearch={submitSearch}
            changeReadingMode={changeReadingMode}
            refresh={refresh}
            openAddFeed={openAddFeed}
            openFeedManagementById={openFeedManagementById}
            filterSelectedText={filterSelectedText}
          />
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
