import { useLayoutEffect, useRef } from "react";
import type { AiCustomPrompt, Article } from "../../../shared/types";
import type { FeedManagementAction } from "../../feed-management";
import { ArticleActions } from "./article-action-bar";
import {
  type ArticleSummaryViewState,
  type ArticleTranslationViewState,
  EMPTY_ARTICLE_SUMMARY_STATE,
  EMPTY_ARTICLE_TRANSLATION_STATE,
} from "./article-ai-state";
import { ArticleDocument } from "./article-document";
import { ArticleLoadSentinel } from "./article-load-sentinel";
import { useMarkReadOnScroll } from "./mark-read-on-scroll";

function useExpandedActionDocking(
  streamRef: React.RefObject<HTMLElement | null>,
  articleIds: string,
) {
  useLayoutEffect(() => {
    const stream = streamRef.current;
    const container = stream?.parentElement;
    if (!stream || !container || !articleIds) return;

    const dockingTargets: Array<{ actions: HTMLElement; article: HTMLElement }> = [];
    for (const article of stream.querySelectorAll<HTMLElement>(".expanded-article")) {
      const actions = article.querySelector<HTMLElement>(".expanded-actions");
      if (actions) dockingTargets.push({ actions, article });
    }
    const dockingLead = dockingTargets[0]
      ? Number.parseFloat(
          window.getComputedStyle(dockingTargets[0].article).borderBottomRightRadius,
        )
      : 0;
    const dockedRadius = dockingTargets[0]
      ? Number.parseFloat(window.getComputedStyle(dockingTargets[0].actions).borderTopRightRadius)
      : 0;
    const actionHeight = dockingTargets[0]?.actions.getBoundingClientRect().height ?? 0;
    const currentRadii = new WeakMap<HTMLElement, number>();
    let frameHandle: number | null = null;
    const updateDockingState = () => {
      frameHandle = null;
      const containerTop = container.getBoundingClientRect().top;
      const nextRadii = dockingTargets.map(({ article }) => {
        if (dockingLead === 0) return 0;
        const articleBottom = article.getBoundingClientRect().bottom;
        const progress = Math.min(
          1,
          Math.max(0, (containerTop + actionHeight + dockingLead - articleBottom) / dockingLead),
        );
        return Math.round(dockedRadius * progress * 100) / 100;
      });
      for (const [index, { actions }] of dockingTargets.entries()) {
        const radius = nextRadii[index] ?? 0;
        if (currentRadii.get(actions) === radius) continue;
        currentRadii.set(actions, radius);
        actions.style.borderBottomRightRadius = `${radius}px`;
        actions.style.borderBottomLeftRadius = `${radius}px`;
      }
    };
    const scheduleDockingUpdate = () => {
      if (frameHandle !== null) return;
      frameHandle = window.requestAnimationFrame(updateDockingState);
    };

    updateDockingState();
    container.addEventListener("scroll", scheduleDockingUpdate, { passive: true });
    window.addEventListener("resize", scheduleDockingUpdate);
    return () => {
      container.removeEventListener("scroll", scheduleDockingUpdate);
      window.removeEventListener("resize", scheduleDockingUpdate);
      if (frameHandle !== null) window.cancelAnimationFrame(frameHandle);
      for (const { actions } of dockingTargets) {
        actions.style.removeProperty("border-bottom-right-radius");
        actions.style.removeProperty("border-bottom-left-radius");
      }
    };
  }, [articleIds, streamRef]);
}

export function ExpandedStream({
  articles,
  activeId,
  topAlignedId,
  fullContentVisibleIds,
  summaryStates,
  translationStates,
  translationLanguage,
  customPrompts,
  showYouTubeDescriptions,
  markReadOnScroll,
  hasMore,
  loadingMore,
  onLoadMore,
  onActivate,
  onMarkPassedRead,
  onToggleRead,
  onToggleStar,
  onCopy,
  onOpenSource,
  onFeedAction,
  onToggleFullContent,
  onRunSummaryPrompt,
  onToggleTranslation,
  onRegenerateSummary,
  onOpenAiSettings,
  onFilterSelection,
}: {
  articles: Article[];
  activeId: number | null;
  topAlignedId: number | null;
  fullContentVisibleIds: ReadonlySet<number>;
  summaryStates: ReadonlyMap<number, ArticleSummaryViewState>;
  translationStates: ReadonlyMap<number, ArticleTranslationViewState>;
  translationLanguage: string;
  customPrompts: AiCustomPrompt[];
  showYouTubeDescriptions: boolean;
  markReadOnScroll: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onActivate: (article: Article) => void;
  onMarkPassedRead: (articles: Article[]) => Promise<unknown>;
  onToggleRead: (article: Article) => void;
  onToggleStar: (article: Article) => void;
  onCopy: (article: Article) => void;
  onOpenSource: (article: Article) => void;
  onFeedAction: (feedId: number, action: FeedManagementAction) => void;
  onToggleFullContent: (article: Article) => void;
  onRunSummaryPrompt: (article: Article, promptId: string | null) => void;
  onToggleTranslation: (article: Article) => void;
  onRegenerateSummary: (article: Article) => void;
  onOpenAiSettings: () => void;
  onFilterSelection: (article: Article, text: string) => void;
}) {
  const streamRef = useRef<HTMLElement>(null);
  useExpandedActionDocking(streamRef, articles.map((article) => article.id).join(","));
  const registerItem = useMarkReadOnScroll({
    articles,
    activeId,
    enabled: markReadOnScroll,
    onMarkPassedRead,
    rootRef: streamRef,
    useParent: true,
    topAlignedId,
  });

  return (
    <section ref={streamRef} className="expanded-stream" aria-label="Expanded articles">
      {articles.map((article) => (
        <article
          ref={(element) => registerItem(article.id, element)}
          className={`expanded-article${article.id === activeId ? " is-active" : ""}${article.isRead ? " is-read" : ""}`}
          key={article.id}
          aria-labelledby={`expanded-${article.id}-title`}
          onFocus={() => onActivate(article)}
        >
          <div className="expanded-actions">
            <ArticleActions
              article={article}
              fullContentVisible={fullContentVisibleIds.has(article.id)}
              summaryState={summaryStates.get(article.id) ?? EMPTY_ARTICLE_SUMMARY_STATE}
              translationState={
                translationStates.get(article.id) ?? EMPTY_ARTICLE_TRANSLATION_STATE
              }
              translationLanguage={translationLanguage}
              customPrompts={customPrompts}
              onToggleRead={onToggleRead}
              onToggleStar={onToggleStar}
              onCopy={onCopy}
              onOpenSource={onOpenSource}
              onToggleFullContent={onToggleFullContent}
              onRunSummaryPrompt={onRunSummaryPrompt}
              onToggleTranslation={onToggleTranslation}
            />
          </div>
          <ArticleDocument
            article={article}
            titleId={`expanded-${article.id}-title`}
            fullContentVisible={fullContentVisibleIds.has(article.id)}
            summaryState={summaryStates.get(article.id) ?? EMPTY_ARTICLE_SUMMARY_STATE}
            translationState={translationStates.get(article.id) ?? EMPTY_ARTICLE_TRANSLATION_STATE}
            translationLanguage={translationLanguage}
            customPrompts={customPrompts}
            showYouTubeDescriptions={showYouTubeDescriptions}
            onFeedAction={onFeedAction}
            onToggleFullContent={onToggleFullContent}
            onRegenerateSummary={onRegenerateSummary}
            onOpenAiSettings={onOpenAiSettings}
            onFilterSelection={onFilterSelection}
          />
        </article>
      ))}
      <ArticleLoadSentinel
        rootRef={streamRef}
        useParent
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={onLoadMore}
      />
    </section>
  );
}
