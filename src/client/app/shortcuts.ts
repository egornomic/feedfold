import { useEffect, useRef } from "react";
import { toast as showToast } from "sonner";
import type { BootstrapData, ReadingMode } from "../../shared/types";
import type { ManagementRequest } from "../features/feeds/feed-management";
import type { useArticleActions } from "../features/reader/article-actions";
import type { ArticleEnrichmentController } from "../features/reader/article-enrichment";
import type { ArticleQueueController } from "../features/reader/article-queue";
import {
  ARTICLE_FONT_MAX,
  ARTICLE_FONT_MIN,
  type useReaderPreferences,
} from "../features/reader/reader-preferences";
import type { AppRouteController } from "./route";

interface AppShortcuts {
  bootstrap: BootstrapData | null;
  managementRequest: ManagementRequest | null;
  shortcutHelpOpen: boolean;
  setShortcutHelpOpen: (open: boolean) => void;
  setNavOpen: (open: boolean) => void;
  route: AppRouteController;
  queue: ArticleQueueController;
  articleActions: ReturnType<typeof useArticleActions>;
  articleEnrichment: ArticleEnrichmentController;
  preferences: ReturnType<typeof useReaderPreferences>;
  selectScope: AppRouteController["selectScope"];
  navigateTo: AppRouteController["navigateToView"];
  refresh: (feedId?: number, forceAll?: boolean) => Promise<void>;
  scrollArticlePage: (direction: 1 | -1) => boolean;
  changeReadingMode: (mode: ReadingMode) => void;
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

export function useAppShortcuts({
  bootstrap,
  managementRequest,
  shortcutHelpOpen,
  setShortcutHelpOpen,
  setNavOpen,
  route,
  queue,
  articleActions,
  articleEnrichment,
  preferences,
  selectScope,
  navigateTo,
  refresh,
  scrollArticlePage,
  changeReadingMode,
}: AppShortcuts) {
  const sequence = useRef<{ startedAt: number } | null>(null);
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
            void articleEnrichment.toggleFullContent(activeArticle);
          }
        },
        m: () => {
          if (activeArticle && (queue.readingMode === "expanded" || route.routedArticleId)) {
            articleEnrichment.toggleArticleSummary(activeArticle);
          }
        },
        t: () => {
          if (activeArticle && (queue.readingMode === "expanded" || route.routedArticleId)) {
            articleEnrichment.toggleArticleTranslation(activeArticle);
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
    articleEnrichment,
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
    setShortcutHelpOpen,
    setNavOpen,
  ]);
}
