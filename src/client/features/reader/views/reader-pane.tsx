import { BookOpen, List } from "lucide-react";
import {
  type AnimationPlaybackControls,
  animate,
  type MotionValue,
  motion,
  motionValue,
  type PanInfo,
  useReducedMotion,
} from "motion/react";
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { AiCustomPrompt, Article } from "../../../../shared/types";
import { useDelayedPending } from "../../../ui/loading";
import { interactionMotionIsInstant } from "../../../ui/motion";
import type { FeedManagementAction } from "../../feeds/feed-management";
import { ArticleActions } from "../article/article-action-bar";
import type {
  ArticleSummaryViewState,
  ArticleTranslationViewState,
} from "../article/article-ai-state";
import { ArticleDocument } from "../article/article-document";
import {
  type ArticleSwipeDirection,
  type ArticleSwipeIntent,
  articleSwipeDirection,
  articleSwipeDownAction,
  articleSwipeIntent,
  articleSwipeOffset,
} from "../interaction/article-swipe";
import { InlineError } from "../reader-states";

const ARTICLE_SWIPE_TARGETS =
  "a, button, input, select, textarea, summary, video, audio, iframe, pre, dialog, .article-table-scroll, [contenteditable], [data-image-lightbox-trigger]";
const ARTICLE_SWIPE_SURFACE = "[data-article-swipe-surface], [data-image-lightbox-trigger]";
// Match the existing critically damped spring's 0.32 s response.
const SWIPE_OMEGA = (2 * Math.PI) / 0.32;
const SWIPE_SPRING = {
  type: "spring",
  stiffness: SWIPE_OMEGA ** 2,
  damping: 2 * SWIPE_OMEGA,
  mass: 1,
  restDelta: 0.5,
  restSpeed: 5,
} as const;

type ArticleNavigationHandler = () => boolean | Promise<boolean>;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface ArticleSurfaceSnapshot {
  article: Article;
  contentLoaded: boolean;
  contentError: string | null;
  fullContentVisible: boolean;
  summaryState: ArticleSummaryViewState;
  translationState: ArticleTranslationViewState;
}

interface MotionSurface {
  snapshot: ArticleSurfaceSnapshot;
  x: MotionValue<number>;
  opacity: MotionValue<number>;
}

function createSurface(snapshot: ArticleSurfaceSnapshot, x = 0, opacity = 1): MotionSurface {
  return { snapshot, x: motionValue(x), opacity: motionValue(opacity) };
}

interface SwipeGestureState {
  pointerId: number;
  x: number;
  y: number;
  surfaceX: number;
  surfaceOpacity: number;
  reducedMotion: boolean;
  intent: ArticleSwipeIntent;
  startedOnSwipeSurface: boolean;
}

interface FullContentPullGesture {
  identifier: number;
  articleId: number;
  startX: number;
  startY: number;
}

interface PendingArticleNavigation {
  readonly id: number;
  readonly direction: ArticleSwipeDirection;
  readonly releaseVelocity: number;
  readonly reducedMotion: boolean;
  readonly restoreFrameHandle: number;
}

export function ReaderPane({
  article,
  contentLoaded,
  contentError,
  onRetryContent,
  fullContentVisible,
  summaryState,
  translationState,
  translationLanguage,
  customPrompts,
  showYouTubeDescriptions,
  canPrevious,
  canNext,
  onBack,
  onPrevious,
  onNext,
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
  article: Article | null;
  contentLoaded: boolean;
  contentError: string | null;
  onRetryContent: (article: Article) => void;
  fullContentVisible: boolean;
  summaryState: ArticleSummaryViewState;
  translationState: ArticleTranslationViewState;
  translationLanguage: string;
  customPrompts: AiCustomPrompt[];
  showYouTubeDescriptions: boolean;
  canPrevious: boolean;
  canNext: boolean;
  onBack: () => void;
  onPrevious: ArticleNavigationHandler;
  onNext: ArticleNavigationHandler;
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
  const snapshot = article
    ? { article, contentLoaded, contentError, fullContentVisible, summaryState, translationState }
    : null;
  const [surfaces, setSurfaces] = useState<MotionSurface[]>(() =>
    snapshot ? [createSurface(snapshot)] : [],
  );
  const surfacesRef = useRef(surfaces);
  const activeSurfaceRef = useRef(surfaces[0] ?? null);
  const activeSurface = activeSurfaceRef.current?.snapshot ?? null;
  const [navigationPending, setNavigationPending] = useState(false);
  const showContentLoading = useDelayedPending(
    article !== null && !contentLoaded && !contentError,
    article?.id ?? null,
  );
  const activeLayerRef = useRef<HTMLDivElement>(null);
  const activeMotion = useRef<AnimationPlaybackControls | null>(null);
  const swipeStart = useRef<SwipeGestureState | null>(null);
  const fullContentPullStart = useRef<FullContentPullGesture | null>(null);
  const suppressSwipeSurfaceClick = useRef(false);
  const pendingNavigation = useRef<PendingArticleNavigation | null>(null);
  const nextRequestId = useRef(0);
  const transitionSetup = useRef<{ velocity: number; reducedMotion: boolean } | null>(null);
  const reducedMotion = useReducedMotion();

  const updateSurfaces = useCallback((next: MotionSurface[]) => {
    surfacesRef.current = next;
    setSurfaces(next);
  }, []);

  const stopMotion = useCallback(() => {
    activeMotion.current?.stop();
    activeMotion.current = null;
  }, []);

  // All retained pages share one displacement. A new swipe can take over the
  // current presentation, including a page that is still leaving the viewport.
  const restoreActiveSurface = useCallback(
    (velocity = 0, reduce = prefersReducedMotion()) => {
      stopMotion();
      const active = activeSurfaceRef.current;
      if (!active) return;
      const layers = surfacesRef.current.map((surface) => ({
        surface,
        x: surface.x.get(),
        opacity: surface.opacity.get(),
      }));
      const startX = active.x.get();
      if (reduce) for (const { surface } of layers) surface.x.set(0);
      const finish = () => {
        activeMotion.current = null;
        active.x.set(0);
        active.opacity.set(1);
        updateSurfaces([active]);
      };
      if (interactionMotionIsInstant()) {
        finish();
        return;
      }
      const update = (position: number) => {
        const progress =
          reduce || startX === 0 ? position : Math.min(1, Math.max(0, 1 - position / startX));
        for (const { surface, x, opacity } of layers) {
          if (!reduce && startX !== 0) surface.x.set(x + position - startX);
          const targetOpacity = surface === active ? 1 : 0.35;
          surface.opacity.set(opacity + (targetOpacity - opacity) * progress);
        }
      };
      activeMotion.current =
        reduce || startX === 0
          ? animate(0, 1, {
              duration: reduce ? 0.2 : 0.14,
              ease: "easeOut",
              onUpdate: update,
              onComplete: finish,
            })
          : animate(startX, 0, { ...SWIPE_SPRING, velocity, onUpdate: update, onComplete: finish });
    },
    [stopMotion, updateSurfaces],
  );

  const navigateWithAnimation = useCallback(
    (direction: ArticleSwipeDirection, releaseVelocity = 0, reduce = prefersReducedMotion()) => {
      if (!(direction === "next" ? canNext : canPrevious) || pendingNavigation.current) {
        restoreActiveSurface(0, reduce);
        return;
      }
      const navigate = direction === "next" ? onNext : onPrevious;
      if (interactionMotionIsInstant() || !activeLayerRef.current) {
        void navigate();
        return;
      }
      const requestId = ++nextRequestId.current;
      const restoreFrameHandle = window.requestAnimationFrame(() => {
        if (pendingNavigation.current?.id === requestId)
          restoreActiveSurface(releaseVelocity, reduce);
      });
      pendingNavigation.current = {
        id: requestId,
        direction,
        releaseVelocity,
        reducedMotion: reduce,
        restoreFrameHandle,
      };
      setNavigationPending(true);
      void Promise.resolve(navigate()).then((moved) => {
        if (pendingNavigation.current?.id !== requestId || moved) return;
        pendingNavigation.current = null;
        setNavigationPending(false);
        window.cancelAnimationFrame(restoreFrameHandle);
        restoreActiveSurface(releaseVelocity, reduce);
      });
    },
    [canNext, canPrevious, onNext, onPrevious, restoreActiveSurface],
  );

  useLayoutEffect(() => {
    const next = article
      ? { article, contentLoaded, contentError, fullContentVisible, summaryState, translationState }
      : null;
    const current = activeSurfaceRef.current;
    if (
      next &&
      current &&
      next.article.id !== current.snapshot.article.id &&
      !next.contentLoaded &&
      !next.contentError &&
      !showContentLoading
    )
      return;
    if (next && current && next.article.id === current.snapshot.article.id) {
      current.snapshot = next;
      updateSurfaces([...surfacesRef.current]);
      return;
    }
    stopMotion();
    swipeStart.current = null;
    const request = pendingNavigation.current;
    if (request) window.cancelAnimationFrame(request.restoreFrameHandle);
    pendingNavigation.current = null;
    setNavigationPending(false);
    if (!next || !current || !request || interactionMotionIsInstant()) {
      const surface = next ? createSurface(next) : null;
      activeSurfaceRef.current = surface;
      transitionSetup.current = null;
      updateSurfaces(surface ? [surface] : []);
      return;
    }
    const width = activeLayerRef.current?.clientWidth ?? 0;
    const offset = request.direction === "next" ? width : -width;
    const existing = surfacesRef.current.find(
      (surface) => surface.snapshot.article.id === next.article.id,
    );
    const incoming =
      existing ?? createSurface(next, request.reducedMotion ? 0 : current.x.get() + offset, 0.65);
    incoming.snapshot = next;
    activeSurfaceRef.current = incoming;
    transitionSetup.current = {
      velocity: request.releaseVelocity,
      reducedMotion: request.reducedMotion,
    };
    updateSurfaces(existing ? [...surfacesRef.current] : [...surfacesRef.current, incoming]);
  }, [
    article,
    contentLoaded,
    contentError,
    fullContentVisible,
    summaryState,
    translationState,
    showContentLoading,
    stopMotion,
    updateSurfaces,
  ]);

  useLayoutEffect(() => {
    const setup = transitionSetup.current;
    const active = activeSurfaceRef.current;
    if (!setup || !active || !surfaces.includes(active)) return;
    transitionSetup.current = null;
    restoreActiveSurface(setup.velocity, setup.reducedMotion);
  }, [surfaces, restoreActiveSurface]);

  useEffect(() => {
    if (reducedMotion && activeMotion.current) restoreActiveSurface(0, true);
  }, [reducedMotion, restoreActiveSurface]);

  useEffect(
    () => () => {
      activeMotion.current?.stop();
      const request = pendingNavigation.current;
      if (request) window.cancelAnimationFrame(request.restoreFrameHandle);
    },
    [],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType !== "touch" || !event.isPrimary || pendingNavigation.current) return;
      swipeStart.current = null;
      suppressSwipeSurfaceClick.current = false;
      const target = event.target instanceof Element ? event.target : null;
      const swipeSurface = target?.closest(ARTICLE_SWIPE_SURFACE);
      const active = activeSurfaceRef.current;
      if (
        !active ||
        !activeLayerRef.current ||
        (target?.closest(ARTICLE_SWIPE_TARGETS) && !swipeSurface) ||
        !window.getSelection()?.isCollapsed
      )
        return;
      stopMotion();
      swipeStart.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        surfaceX: active.x.get(),
        surfaceOpacity: active.opacity.get(),
        reducedMotion: prefersReducedMotion(),
        intent: "pending",
        startedOnSwipeSurface: Boolean(swipeSurface),
      };
    },
    [stopMotion],
  );

  const handlePan = useCallback(
    (event: PointerEvent, info: PanInfo) => {
      const start = swipeStart.current;
      const active = activeSurfaceRef.current;
      const surface = activeLayerRef.current;
      if (!start || !active || !surface || event.pointerId !== start.pointerId) return;
      if (start.intent === "pending") {
        start.intent = articleSwipeIntent(info.offset.x, info.offset.y);
      }
      if (start.intent !== "horizontal") return;
      if (!window.getSelection()?.isCollapsed) {
        swipeStart.current = null;
        restoreActiveSurface();
        return;
      }
      const visualDistance = articleSwipeOffset(
        info.offset.x,
        surface.clientWidth,
        info.offset.x < 0 ? canNext : canPrevious,
      );
      if (!start.reducedMotion) {
        const delta = start.surfaceX + visualDistance - active.x.get();
        for (const layer of surfacesRef.current) layer.x.set(layer.x.get() + delta);
      }
      active.opacity.set(
        Math.max(
          0.18,
          start.surfaceOpacity - Math.min(Math.abs(visualDistance) / surface.clientWidth, 1) * 0.18,
        ),
      );
    },
    [canNext, canPrevious, restoreActiveSurface],
  );

  const finishPointerGesture = useCallback(
    (event: PointerEvent, info: PanInfo) => {
      const start = swipeStart.current;
      if (!start || event.pointerId !== start.pointerId) return;
      swipeStart.current = null;
      if (start.intent !== "horizontal") return;
      if (start.startedOnSwipeSurface) {
        suppressSwipeSurfaceClick.current = true;
        window.setTimeout(() => {
          suppressSwipeSurfaceClick.current = false;
        }, 0);
      }
      const direction =
        event.type === "pointercancel"
          ? null
          : articleSwipeDirection({
              startX: start.x,
              startY: start.y,
              endX: event.clientX,
              endY: event.clientY,
              horizontalVelocity: info.velocity.x / 1000,
            });
      if (direction) navigateWithAnimation(direction, info.velocity.x, start.reducedMotion);
      else restoreActiveSurface(info.velocity.x, start.reducedMotion);
    },
    [navigateWithAnimation, restoreActiveSurface],
  );

  const handleClickCapture = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!suppressSwipeSurfaceClick.current || !target?.closest(ARTICLE_SWIPE_SURFACE)) return;
    suppressSwipeSurfaceClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const cancelPointerGesture = useCallback(() => {
    const start = swipeStart.current;
    if (!start) return;
    swipeStart.current = null;
    restoreActiveSurface(0, start.reducedMotion);
  }, [restoreActiveSurface]);

  const handleTouchStart = useCallback((event: ReactTouchEvent<HTMLElement>) => {
    fullContentPullStart.current = null;
    const touch = event.touches[0];
    if (!touch || event.touches.length > 1 || pendingNavigation.current) return;

    const surface = activeLayerRef.current;
    const snapshot = activeSurfaceRef.current?.snapshot;
    const target = event.target instanceof Element ? event.target : null;
    if (
      !surface ||
      surface.scrollTop > 1 ||
      !snapshot ||
      snapshot.fullContentVisible ||
      !snapshot.article.url ||
      snapshot.article.media ||
      target?.closest(ARTICLE_SWIPE_TARGETS)
    ) {
      return;
    }

    fullContentPullStart.current = {
      identifier: touch.identifier,
      articleId: snapshot.article.id,
      startX: touch.clientX,
      startY: touch.clientY,
    };
  }, []);

  const handleTouchEnd = useCallback(
    (event: ReactTouchEvent<HTMLElement>) => {
      const start = fullContentPullStart.current;
      fullContentPullStart.current = null;
      if (!start) return;

      const touch = Array.from(event.changedTouches).find(
        (candidate) => candidate.identifier === start.identifier,
      );
      const snapshot = activeSurfaceRef.current?.snapshot;
      if (
        !touch ||
        !snapshot ||
        snapshot.article.id !== start.articleId ||
        snapshot.fullContentVisible ||
        !snapshot.article.url ||
        snapshot.article.media ||
        !articleSwipeDownAction({
          startX: start.startX,
          startY: start.startY,
          endX: touch.clientX,
          endY: touch.clientY,
        })
      ) {
        return;
      }

      onToggleFullContent(snapshot.article);
    },
    [onToggleFullContent],
  );

  const cancelFullContentPull = useCallback(() => {
    fullContentPullStart.current = null;
  }, []);

  if (!activeSurface) {
    return (
      <section className="reader-pane reader-placeholder">
        <BookOpen aria-hidden="true" size={24} />
        <p>Choose an article from the list.</p>
      </section>
    );
  }

  const renderArticleDocument = (surface: ArticleSurfaceSnapshot, titleId: string) => (
    <ArticleDocument
      article={surface.article}
      titleId={titleId}
      contentPlaceholder={
        surface.contentLoaded ? undefined : surface.contentError ? (
          <InlineError
            title="Could not load the article"
            detail={surface.contentError}
            retry={() => onRetryContent(surface.article)}
          />
        ) : (
          <div
            className="article-content"
            role="status"
            aria-label="Loading article"
            aria-busy="true"
          >
            <div className="skeleton-line wide" />
            <div className="skeleton-line" />
            <div className="skeleton-line short" />
            <div className="skeleton-block" />
          </div>
        )
      }
      fullContentVisible={surface.fullContentVisible}
      summaryState={surface.summaryState}
      translationState={surface.translationState}
      translationLanguage={translationLanguage}
      customPrompts={customPrompts}
      showYouTubeDescriptions={showYouTubeDescriptions}
      onFeedAction={onFeedAction}
      onToggleFullContent={onToggleFullContent}
      onRegenerateSummary={onRegenerateSummary}
      onOpenAiSettings={onOpenAiSettings}
      onFilterSelection={onFilterSelection}
    />
  );
  const activeTitleId = `article-${activeSurface.article.id}-title`;

  return (
    <motion.article
      className="reader-pane"
      aria-labelledby={activeTitleId}
      onPointerDown={handlePointerDown}
      onPointerUp={() => {
        if (swipeStart.current?.intent !== "horizontal") cancelPointerGesture();
      }}
      onPan={handlePan}
      onPanEnd={finishPointerGesture}
      onPointerCancel={cancelPointerGesture}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={cancelFullContentPull}
      onClickCapture={handleClickCapture}
    >
      <div className="reader-action-bar">
        <div className="reader-action-row">
          <button
            data-management-focus-fallback
            className="reader-back-button"
            type="button"
            aria-label="Back to articles"
            data-tooltip="Back to articles"
            onClick={onBack}
          >
            <List aria-hidden="true" size={16} />
          </button>
          <span className="reader-action-divider" aria-hidden="true" />
          <ArticleActions
            article={activeSurface.article}
            fullContentVisible={activeSurface.fullContentVisible}
            summaryState={activeSurface.summaryState}
            translationState={activeSurface.translationState}
            translationLanguage={translationLanguage}
            customPrompts={customPrompts}
            onPrevious={onPrevious}
            onNext={onNext}
            canPrevious={canPrevious}
            canNext={canNext}
            navigationPending={navigationPending || activeSurface.article.id !== article?.id}
            onToggleRead={onToggleRead}
            onToggleStar={onToggleStar}
            onCopy={onCopy}
            onOpenSource={onOpenSource}
            onToggleFullContent={onToggleFullContent}
            onRunSummaryPrompt={onRunSummaryPrompt}
            onToggleTranslation={onToggleTranslation}
          />
        </div>
      </div>
      <div className="article-swipe-stage">
        {surfaces.map((surface) => {
          const active = surface === activeSurfaceRef.current;
          return (
            <motion.div
              ref={active ? activeLayerRef : undefined}
              className={`article-swipe-layer ${active ? "is-active" : "is-outgoing"}`}
              key={surface.snapshot.article.id}
              style={{ x: surface.x, opacity: surface.opacity, zIndex: active ? 1 : 0 }}
              aria-hidden={active ? undefined : true}
              inert={!active}
            >
              {renderArticleDocument(
                surface.snapshot,
                active ? activeTitleId : `article-${surface.snapshot.article.id}-outgoing-title`,
              )}
            </motion.div>
          );
        })}
      </div>
    </motion.article>
  );
}
