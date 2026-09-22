import { BookOpen, List } from "lucide-react";
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
import {
  animateHorizontalSpring,
  type HorizontalSpringController,
} from "../interaction/swipe-motion";
import { InlineError } from "../reader-states";

const ARTICLE_SWIPE_TARGETS =
  "a, button, input, select, textarea, summary, video, audio, iframe, pre, dialog, .article-table-scroll, [contenteditable], [data-image-lightbox-trigger]";
const ARTICLE_SWIPE_SURFACE = "[data-article-swipe-surface], [data-image-lightbox-trigger]";
const SWIPE_SAMPLE_WINDOW = 100;
const SWIPE_SAMPLE_LIMIT = 5;
const SWIPE_SPRING_RESPONSE = 0.32;
const REDUCED_SWIPE_DURATION = 200;

type ArticleNavigationHandler = () => boolean | Promise<boolean>;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function surfaceTranslateX(element: HTMLElement): number {
  const transform = window.getComputedStyle(element).transform;
  return transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m41;
}

function clearSwipeSurface(element: HTMLElement): void {
  element.style.removeProperty("transform");
  element.style.removeProperty("opacity");
  delete element.dataset.swiping;
}

interface ArticleSurfaceSnapshot {
  article: Article;
  contentLoaded: boolean;
  contentError: string | null;
  fullContentVisible: boolean;
  summaryState: ArticleSummaryViewState;
  translationState: ArticleTranslationViewState;
}

interface PointerSample {
  x: number;
  timeStamp: number;
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
  samples: PointerSample[];
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

interface OutgoingArticleSurface {
  snapshot: ArticleSurfaceSnapshot;
  requestId: number;
}

interface ArticleTransitionSetup {
  requestId: number;
  direction: ArticleSwipeDirection;
  startX: number;
  startOpacity: number;
  releaseVelocity: number;
  reducedMotion: boolean;
}

function appendPointerSample(samples: PointerSample[], sample: PointerSample): PointerSample[] {
  return [...samples, sample]
    .filter((entry) => sample.timeStamp - entry.timeStamp <= SWIPE_SAMPLE_WINDOW)
    .slice(-SWIPE_SAMPLE_LIMIT);
}

function horizontalReleaseVelocity(samples: PointerSample[]): number {
  const first = samples[0];
  const last = samples.at(-1);
  if (!first || !last || last.timeStamp <= first.timeStamp) return 0;
  return (last.x - first.x) / (last.timeStamp - first.timeStamp);
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
  const initialSurface = article
    ? { article, contentLoaded, contentError, fullContentVisible, summaryState, translationState }
    : null;
  const [activeSurface, setActiveSurface] = useState<ArticleSurfaceSnapshot | null>(initialSurface);
  const [outgoingSurface, setOutgoingSurface] = useState<OutgoingArticleSurface | null>(null);
  const [navigationPending, setNavigationPending] = useState(false);
  const showContentLoading = useDelayedPending(
    article !== null && !contentLoaded && !contentError,
    article?.id ?? null,
  );
  const activeLayerRef = useRef<HTMLDivElement>(null);
  const outgoingLayerRef = useRef<HTMLDivElement>(null);
  const activeSurfaceRef = useRef(activeSurface);
  const outgoingSurfaceRef = useRef(outgoingSurface);
  const activeMotion = useRef<HorizontalSpringController | null>(null);
  const swipeStart = useRef<SwipeGestureState | null>(null);
  const fullContentPullStart = useRef<FullContentPullGesture | null>(null);
  const suppressSwipeSurfaceClick = useRef(false);
  const pendingNavigation = useRef<PendingArticleNavigation | null>(null);
  const nextRequestId = useRef(0);
  const paginationRestoreRequestId = useRef<number | null>(null);
  const transitionSetup = useRef<ArticleTransitionSetup | null>(null);
  activeSurfaceRef.current = activeSurface;
  outgoingSurfaceRef.current = outgoingSurface;

  const preserveActivePresentation = useCallback(() => {
    const surface = activeLayerRef.current;
    if (!surface) return { position: 0, opacity: 1 };
    const position = surfaceTranslateX(surface);
    const opacity = Number(window.getComputedStyle(surface).opacity);
    activeMotion.current?.cancel();
    activeMotion.current = null;
    surface.style.transform = `translate3d(${position}px, 0, 0)`;
    surface.style.opacity = String(opacity);
    surface.dataset.swiping = "true";
    return { position, opacity };
  }, []);

  const restoreActiveSurface = useCallback(
    (releaseVelocity = 0, reducedMotion = prefersReducedMotion()) => {
      const surface = activeLayerRef.current;
      if (!surface) return;
      const { position, opacity } = preserveActivePresentation();
      transitionSetup.current = null;
      if (outgoingSurfaceRef.current) {
        outgoingSurfaceRef.current = null;
        setOutgoingSurface(null);
      }

      if (reducedMotion) {
        const animation = surface.animate([{ opacity }, { opacity: 1 }], {
          duration: REDUCED_SWIPE_DURATION,
          easing: "ease",
          fill: "forwards",
        });
        const controller: HorizontalSpringController = {
          cancel: () => animation.cancel(),
        };
        activeMotion.current = controller;
        animation.onfinish = () => {
          if (activeMotion.current !== controller) return;
          animation.cancel();
          activeMotion.current = null;
          clearSwipeSurface(surface);
        };
        return;
      }

      let controller: HorizontalSpringController;
      controller = animateHorizontalSpring({
        initialPosition: position,
        initialVelocity: releaseVelocity,
        target: 0,
        response: SWIPE_SPRING_RESPONSE,
        onUpdate: ({ position: nextPosition, progress }) => {
          surface.style.transform = `translate3d(${nextPosition}px, 0, 0)`;
          surface.style.opacity = String(opacity + (1 - opacity) * progress);
        },
        onComplete: () => {
          if (activeMotion.current !== controller) return;
          activeMotion.current = null;
          clearSwipeSurface(surface);
        },
      });
      activeMotion.current = controller;
    },
    [preserveActivePresentation],
  );

  const navigateWithAnimation = useCallback(
    (
      direction: ArticleSwipeDirection,
      releaseVelocity = 0,
      reducedMotion = prefersReducedMotion(),
    ) => {
      const directionAvailable = direction === "next" ? canNext : canPrevious;
      if (!directionAvailable) {
        restoreActiveSurface(0, reducedMotion);
        return;
      }
      if (pendingNavigation.current) {
        restoreActiveSurface(releaseVelocity, reducedMotion);
        return;
      }

      const navigate = direction === "next" ? onNext : onPrevious;
      if (interactionMotionIsInstant()) {
        void navigate();
        return;
      }
      if (!activeLayerRef.current) {
        void navigate();
        return;
      }

      const requestId = ++nextRequestId.current;
      const restoreFrameHandle = window.requestAnimationFrame(() => {
        const request = pendingNavigation.current;
        if (request?.id !== requestId) return;
        paginationRestoreRequestId.current = requestId;
        restoreActiveSurface(request.releaseVelocity, request.reducedMotion);
      });
      const request = Object.freeze({
        id: requestId,
        direction,
        releaseVelocity,
        reducedMotion,
        restoreFrameHandle,
      });
      pendingNavigation.current = request;
      setNavigationPending(true);
      const navigationResult = navigate();
      void Promise.resolve(navigationResult).then((moved) => {
        if (pendingNavigation.current?.id !== requestId || moved) return;
        pendingNavigation.current = null;
        setNavigationPending(false);
        window.cancelAnimationFrame(restoreFrameHandle);
        const alreadyRestoring = paginationRestoreRequestId.current === requestId;
        paginationRestoreRequestId.current = null;
        if (!alreadyRestoring) restoreActiveSurface(releaseVelocity, reducedMotion);
      });
    },
    [canNext, canPrevious, onNext, onPrevious, restoreActiveSurface],
  );

  useLayoutEffect(() => {
    const nextSurface = article
      ? { article, contentLoaded, contentError, fullContentVisible, summaryState, translationState }
      : null;
    const currentSurface = activeSurfaceRef.current;
    if (
      nextSurface &&
      currentSurface &&
      nextSurface.article.id !== currentSurface.article.id &&
      !nextSurface.contentLoaded &&
      !nextSurface.contentError &&
      !showContentLoading
    )
      return;
    if (nextSurface?.article.id === currentSurface?.article.id) {
      if (
        nextSurface &&
        (nextSurface.article !== currentSurface?.article ||
          nextSurface.contentLoaded !== currentSurface.contentLoaded ||
          nextSurface.contentError !== currentSurface.contentError ||
          nextSurface.fullContentVisible !== currentSurface.fullContentVisible ||
          nextSurface.summaryState !== currentSurface.summaryState ||
          nextSurface.translationState !== currentSurface.translationState)
      ) {
        activeSurfaceRef.current = nextSurface;
        setActiveSurface(nextSurface);
      }
      return;
    }

    if (!nextSurface || !currentSurface) {
      activeMotion.current?.cancel();
      activeMotion.current = null;
      const request = pendingNavigation.current;
      if (request) window.cancelAnimationFrame(request.restoreFrameHandle);
      pendingNavigation.current = null;
      setNavigationPending(false);
      paginationRestoreRequestId.current = null;
      transitionSetup.current = null;
      outgoingSurfaceRef.current = null;
      activeSurfaceRef.current = nextSurface;
      setOutgoingSurface(null);
      setActiveSurface(nextSurface);
      return;
    }

    const request = pendingNavigation.current;
    if (!request) {
      activeMotion.current?.cancel();
      activeMotion.current = null;
      setNavigationPending(false);
      paginationRestoreRequestId.current = null;
      transitionSetup.current = null;
      outgoingSurfaceRef.current = null;
      activeSurfaceRef.current = nextSurface;
      setOutgoingSurface(null);
      setActiveSurface(nextSurface);
      return;
    }

    const { position, opacity } = preserveActivePresentation();
    window.cancelAnimationFrame(request.restoreFrameHandle);
    pendingNavigation.current = null;
    setNavigationPending(false);
    const wasRestoringPagination = paginationRestoreRequestId.current === request.id;
    paginationRestoreRequestId.current = null;
    transitionSetup.current = {
      requestId: request.id,
      direction: request.direction,
      startX: position,
      startOpacity: opacity,
      releaseVelocity: wasRestoringPagination ? 0 : request.releaseVelocity,
      reducedMotion: request.reducedMotion,
    };
    const nextOutgoingSurface = { snapshot: currentSurface, requestId: request.id };
    outgoingSurfaceRef.current = nextOutgoingSurface;
    activeSurfaceRef.current = nextSurface;
    setOutgoingSurface(nextOutgoingSurface);
    setActiveSurface(nextSurface);
  }, [
    article,
    contentLoaded,
    contentError,
    fullContentVisible,
    preserveActivePresentation,
    summaryState,
    showContentLoading,
    translationState,
  ]);

  useLayoutEffect(() => {
    const setup = transitionSetup.current;
    const outgoing = outgoingLayerRef.current;
    const incoming = activeLayerRef.current;
    if (!setup || !outgoing || !incoming || outgoingSurface?.requestId !== setup.requestId) return;
    transitionSetup.current = null;
    const width = outgoing.getBoundingClientRect().width;
    const targetX = setup.direction === "next" ? -width : width;
    const incomingStartX = setup.startX - targetX;
    outgoing.dataset.swiping = "true";
    incoming.dataset.swiping = "true";

    const complete = (controller: HorizontalSpringController) => {
      if (activeMotion.current !== controller) return;
      activeMotion.current = null;
      clearSwipeSurface(incoming);
      clearSwipeSurface(outgoing);
      outgoingSurfaceRef.current = null;
      setOutgoingSurface(null);
    };

    if (setup.reducedMotion) {
      outgoing.style.removeProperty("transform");
      incoming.style.removeProperty("transform");
      outgoing.style.opacity = String(setup.startOpacity);
      incoming.style.opacity = "0.65";
      const outgoingAnimation = outgoing.animate(
        [{ opacity: setup.startOpacity }, { opacity: 0.35 }],
        { duration: REDUCED_SWIPE_DURATION, easing: "ease", fill: "forwards" },
      );
      const incomingAnimation = incoming.animate([{ opacity: 0.65 }, { opacity: 1 }], {
        duration: REDUCED_SWIPE_DURATION,
        easing: "ease",
        fill: "forwards",
      });
      const controller: HorizontalSpringController = {
        cancel: () => {
          outgoingAnimation.cancel();
          incomingAnimation.cancel();
        },
      };
      activeMotion.current = controller;
      incomingAnimation.onfinish = () => {
        if (activeMotion.current !== controller) return;
        outgoingAnimation.cancel();
        incomingAnimation.cancel();
        complete(controller);
      };
      return;
    }

    outgoing.style.transform = `translate3d(${setup.startX}px, 0, 0)`;
    outgoing.style.opacity = String(setup.startOpacity);
    incoming.style.transform = `translate3d(${incomingStartX}px, 0, 0)`;
    incoming.style.opacity = "0.65";
    let controller: HorizontalSpringController;
    controller = animateHorizontalSpring({
      initialPosition: setup.startX,
      initialVelocity: setup.releaseVelocity,
      target: targetX,
      response: SWIPE_SPRING_RESPONSE,
      onUpdate: ({ position, progress }) => {
        outgoing.style.transform = `translate3d(${position}px, 0, 0)`;
        incoming.style.transform = `translate3d(${position - targetX}px, 0, 0)`;
        outgoing.style.opacity = String(
          setup.startOpacity + (0.35 - setup.startOpacity) * progress,
        );
        incoming.style.opacity = String(0.65 + 0.35 * progress);
      },
      onComplete: () => complete(controller),
    });
    activeMotion.current = controller;
  }, [outgoingSurface]);

  useEffect(
    () => () => {
      activeMotion.current?.cancel();
      const request = pendingNavigation.current;
      if (request) window.cancelAnimationFrame(request.restoreFrameHandle);
    },
    [],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType !== "touch") return;
      if (!event.isPrimary || pendingNavigation.current) return;

      const target = event.target instanceof Element ? event.target : null;
      const swipeSurface = target?.closest(ARTICLE_SWIPE_SURFACE);
      if (!activeLayerRef.current || (target?.closest(ARTICLE_SWIPE_TARGETS) && !swipeSurface)) {
        swipeStart.current = null;
        return;
      }

      const { position, opacity } = preserveActivePresentation();
      transitionSetup.current = null;
      if (outgoingSurfaceRef.current) {
        outgoingSurfaceRef.current = null;
        setOutgoingSurface(null);
      }
      // Preserve the original tap target so images and media buttons still open.
      target?.setPointerCapture(event.pointerId);
      swipeStart.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        surfaceX: position,
        surfaceOpacity: opacity,
        reducedMotion: prefersReducedMotion(),
        intent: "pending",
        startedOnSwipeSurface: Boolean(swipeSurface),
        samples: [{ x: event.clientX, timeStamp: event.timeStamp }],
      };
    },
    [preserveActivePresentation],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const start = swipeStart.current;
      if (!start || event.pointerId !== start.pointerId) return;
      start.samples = appendPointerSample(start.samples, {
        x: event.clientX,
        timeStamp: event.timeStamp,
      });

      const horizontalDistance = event.clientX - start.x;
      const verticalDistance = event.clientY - start.y;
      if (start.intent === "pending") {
        start.intent = articleSwipeIntent(horizontalDistance, verticalDistance);
      }
      if (start.intent !== "horizontal") return;

      event.preventDefault();
      const surface = activeLayerRef.current;
      if (!surface) return;
      const directionAvailable = horizontalDistance < 0 ? canNext : canPrevious;
      const visualDistance = articleSwipeOffset(
        horizontalDistance,
        surface.clientWidth,
        directionAvailable,
      );
      const nextX = start.surfaceX + visualDistance;
      const fadeProgress = Math.min(Math.abs(visualDistance) / surface.clientWidth, 1);
      if (!start.reducedMotion) {
        surface.style.transform = `translate3d(${nextX}px, 0, 0)`;
      }
      surface.style.opacity = String(Math.max(0.18, start.surfaceOpacity - fadeProgress * 0.18));
    },
    [canNext, canPrevious],
  );

  const finishPointerGesture = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const start = swipeStart.current;
      if (!start || event.pointerId !== start.pointerId) return;
      const samples = appendPointerSample(start.samples, {
        x: event.clientX,
        timeStamp: event.timeStamp,
      });
      const velocity = horizontalReleaseVelocity(samples);
      const horizontalDistance = event.clientX - start.x;
      const verticalDistance = event.clientY - start.y;
      const finalIntent =
        start.intent === "pending"
          ? articleSwipeIntent(horizontalDistance, verticalDistance)
          : start.intent;
      swipeStart.current = null;
      if (finalIntent === "horizontal" && start.startedOnSwipeSurface) {
        suppressSwipeSurfaceClick.current = true;
        window.setTimeout(() => {
          suppressSwipeSurfaceClick.current = false;
        }, 0);
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      if (finalIntent !== "horizontal") {
        restoreActiveSurface(0, start.reducedMotion);
        return;
      }

      const direction = articleSwipeDirection({
        startX: start.x,
        startY: start.y,
        endX: event.clientX,
        endY: event.clientY,
        horizontalVelocity: velocity,
      });
      if (!direction) {
        restoreActiveSurface(velocity * 1000, start.reducedMotion);
        return;
      }

      const directionAvailable = direction === "next" ? canNext : canPrevious;
      if (!directionAvailable) {
        restoreActiveSurface(0, start.reducedMotion);
        return;
      }

      navigateWithAnimation(direction, velocity * 1000, start.reducedMotion);
    },
    [canNext, canPrevious, navigateWithAnimation, restoreActiveSurface],
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
    const snapshot = activeSurfaceRef.current;
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
      const snapshot = activeSurfaceRef.current;
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
    <article
      className="reader-pane"
      aria-labelledby={activeTitleId}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointerGesture}
      onPointerCancel={cancelPointerGesture}
      onLostPointerCapture={cancelPointerGesture}
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
        {outgoingSurface ? (
          <div
            ref={outgoingLayerRef}
            className="article-swipe-layer is-outgoing"
            key={`article-${outgoingSurface.snapshot.article.id}`}
            aria-hidden="true"
            inert
          >
            {renderArticleDocument(
              outgoingSurface.snapshot,
              `article-${outgoingSurface.snapshot.article.id}-outgoing-${outgoingSurface.requestId}-title`,
            )}
          </div>
        ) : null}
        <div
          ref={activeLayerRef}
          className="article-swipe-layer is-active"
          key={`article-${activeSurface.article.id}`}
        >
          {renderArticleDocument(activeSurface, activeTitleId)}
        </div>
      </div>
    </article>
  );
}
