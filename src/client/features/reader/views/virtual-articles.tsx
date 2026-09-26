import {
  Children,
  cloneElement,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  type ContextProp,
  type ItemProps,
  type ListProps,
  Virtuoso,
  type VirtuosoHandle,
} from "react-virtuoso";
import type { Article } from "../../../../shared/types";
import {
  PassedArticles,
  type ReadingPosition,
  readingPositionIndex,
} from "../interaction/reading-position";

type RowProps = ItemProps<Article> & { context: ListContext; retained?: boolean };
type Row = ReactElement<RowProps>;
interface ListContext {
  retained: ReadonlySet<number>;
  offsets: Map<number, number>;
  articles: Article[];
  renderArticle: (article: Article) => ReactNode;
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreError: boolean;
  loadMore: () => void;
}

function ArticleRow({ item, context, children: _children, retained, ...props }: RowProps) {
  return (
    <li
      {...props}
      data-index={retained ? undefined : props["data-index"]}
      data-article-id={item.id}
      className="virtual-article-row"
      aria-posinset={props["data-item-index"] + 1}
      aria-setsize={context.articles.length}
    >
      {context.renderArticle(item)}
    </li>
  );
}

// Keep the SAME keyed nodes under the SAME parent. Moving an iframe into a portal
// or parking container reloads it, and removing a selected text node clears its range.
function ArticleRows({ context, children, style, ...props }: ListProps & ContextProp<ListContext>) {
  const previous = useRef(new Map<number, Row>());
  const rows = new Map<number, Row>();
  for (const child of Children.toArray(children) as Row[]) rows.set(child.props.item.id, child);
  for (const id of context.retained) {
    if (rows.has(id)) continue;
    const row = previous.current.get(id);
    const article = context.articles.find((item) => item.id === id);
    if (!row || !article) continue;
    rows.set(
      id,
      cloneElement(row, {
        item: article,
        context,
        // Retained rows are outside Virtuoso's measurement window and normal flow.
        retained: true,
        style: { position: "absolute", top: context.offsets.get(id) ?? 0, left: 0, right: 0 },
      }),
    );
  }
  previous.current = rows;
  return (
    // biome-ignore lint/a11y/useSemanticElements: Virtuoso supplies an HTMLDivElement ref for its measured list.
    <div {...props} role="list" style={{ ...style, position: "relative" }}>
      {[...rows.values()].sort((a, b) => a.props["data-item-index"] - b.props["data-item-index"])}
    </div>
  );
}

function ArticleFooter({ context }: ContextProp<ListContext>) {
  return (
    <div className="virtual-article-footer" aria-live="polite">
      {context.hasMore ? (
        <button
          type="button"
          className="secondary-button"
          disabled={context.loadingMore}
          onClick={context.loadMore}
        >
          {context.loadingMore
            ? "Loading more articles…"
            : context.loadMoreError
              ? "Try loading more articles again"
              : "Load more articles"}
        </button>
      ) : (
        <span>No more articles here</span>
      )}
    </div>
  );
}
function ArticleHeader() {
  return <div className="virtual-article-header" />;
}
const components = {
  Item: ArticleRow,
  List: ArticleRows,
  Header: ArticleHeader,
  Footer: ArticleFooter,
};
const articleKey = (_index: number, article: Article) => article.id;

export function VirtualArticles({
  articles,
  activeId,
  topAlignedId,
  expanded = false,
  enabled,
  markReadOnScroll,
  onMarkPassedRead,
  hasMore,
  loadingMore,
  loadMoreError,
  onLoadMore,
  positions,
  positionKey,
  children,
}: {
  articles: Article[];
  activeId: number | null;
  topAlignedId?: number | null;
  expanded?: boolean;
  enabled: boolean;
  markReadOnScroll: boolean;
  onMarkPassedRead: (articles: Article[]) => Promise<unknown>;
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreError: boolean;
  onLoadMore: () => void;
  positions: Map<string, ReadingPosition>;
  positionKey: string;
  children: (article: Article) => ReactNode;
}) {
  const virtuoso = useRef<VirtuosoHandle>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [retained, setRetained] = useState<ReadonlySet<number>>(new Set());
  const offsets = useRef(new Map<number, number>());
  const latest = useRef({ articles, enabled, markReadOnScroll, onMarkPassedRead });
  latest.current = { articles, enabled, markReadOnScroll, onMarkPassedRead };
  const intentUntil = useRef(0);
  const initial = useRef(positions.get(positionKey));
  const initialLocation = useRef(
    initial.current
      ? {
          index: readingPositionIndex(articles, initial.current),
          align: "start" as const,
          offset: -initial.current.offset,
        }
      : {
          index: Math.max(
            0,
            articles.findIndex((article) => article.id === activeId),
          ),
          align: "start" as const,
        },
  );
  const previousActive = useRef(activeId);

  useLayoutEffect(() => {
    if (!enabled) return;
    const changed = previousActive.current !== activeId;
    previousActive.current = activeId;
    if (!changed) return;
    const index = articles.findIndex((article) => article.id === activeId);
    if (index < 0) return;
    intentUntil.current = 0;
    if (topAlignedId === activeId) virtuoso.current?.scrollToIndex({ index, align: "start" });
    else virtuoso.current?.scrollIntoView({ index, align: "start" });
  }, [activeId, articles, enabled, topAlignedId]);

  useEffect(() => {
    if (!scroller) return;
    const passed = new PassedArticles();
    const queued = new Set<number>();
    const pending = new Set<number>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastTop = scroller.scrollTop;
    let anchor: { element: HTMLElement; top: number; articleId: number; rowTop: number } | null =
      null;
    let resizeFrame: number | null = null;
    const docking = new WeakMap<HTMLElement, { lead: number; radius: number }>();
    const rows = () => [...scroller.querySelectorAll<HTMLElement>(".virtual-article-row")];
    const measure = () => {
      if (!latest.current.enabled || !scroller.clientHeight) return;
      const top = scroller.getBoundingClientRect().top;
      const bottom = top + scroller.clientHeight;
      let first: HTMLElement | undefined;
      for (const row of rows()) {
        const card = row.firstElementChild ?? row;
        const rect = card.getBoundingClientRect();
        const actions = expanded ? row.querySelector<HTMLElement>(".expanded-actions") : null;
        if (actions) {
          let corners = docking.get(actions);
          if (!corners) {
            corners = {
              lead: Number.parseFloat(getComputedStyle(card).borderBottomRightRadius),
              radius: Number.parseFloat(getComputedStyle(actions).borderTopRightRadius),
            };
            docking.set(actions, corners);
          }
          const progress = Math.min(
            1,
            Math.max(0, (top + actions.offsetHeight + corners.lead - rect.bottom) / corners.lead),
          );
          const radius = `${Math.round(corners.radius * progress * 100) / 100}px`;
          actions.style.borderBottomRightRadius = radius;
          actions.style.borderBottomLeftRadius = radius;
        }
        passed.observe(
          Number(row.dataset.articleId),
          rect.top - top + scroller.scrollTop,
          rect.bottom - top + scroller.scrollTop,
          scroller.scrollTop,
          scroller.scrollTop + scroller.clientHeight,
        );
        if (!first && rect.bottom > top + 1 && rect.top < bottom) first = row;
      }
      if (first) {
        const articleId = Number(first.dataset.articleId);
        positions.set(positionKey, {
          articleId,
          index: latest.current.articles.findIndex((article) => article.id === articleId),
          offset: first.getBoundingClientRect().top - top,
        });
        const block =
          [...first.querySelectorAll<HTMLElement>("h2, p, img, pre, video, iframe")].find(
            (element) => element.getBoundingClientRect().bottom > top + 1,
          ) ?? first;
        anchor = {
          element: block,
          top: block.getBoundingClientRect().top,
          articleId,
          rowTop: first.getBoundingClientRect().top - top,
        };
      }
    };
    const flush = () => {
      timer = undefined;
      const state = latest.current;
      const batch = state.articles.filter(
        (article) => queued.has(article.id) && !article.isRead && !pending.has(article.id),
      );
      queued.clear();
      if (!state.enabled || !state.markReadOnScroll || !batch.length) return;
      for (const article of batch) pending.add(article.id);
      void state.onMarkPassedRead(batch).finally(() => {
        for (const article of batch) pending.delete(article.id);
      });
    };
    const scroll = () => {
      const down = scroller.scrollTop > lastTop + 1;
      lastTop = scroller.scrollTop;
      measure();
      const passedIds = down ? passed.passed(scroller.scrollTop) : [];
      if (
        down &&
        performance.now() < intentUntil.current &&
        latest.current.enabled &&
        latest.current.markReadOnScroll
      ) {
        for (const id of passedIds) queued.add(id);
        if (!timer && queued.size) timer = setTimeout(flush, 250);
      }
    };
    const intent = () => {
      intentUntil.current = performance.now() + 1500;
    };
    const pointer = (event: PointerEvent) => {
      if (event.target === scroller) intent();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest("input, textarea, [contenteditable=true]")
      )
        return;
      if (["ArrowDown", "PageDown", "End", " "].includes(event.key)) intent();
    };
    const heights = new WeakMap<Element, number>();
    const resize = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const height =
          entry.borderBoxSize[0]?.blockSize ?? entry.target.getBoundingClientRect().height;
        const previous = heights.get(entry.target);
        if (previous !== undefined && Math.abs(previous - height) > 1) changed = true;
        heights.set(entry.target, height);
      }
      if (!changed || !latest.current.enabled || !anchor || resizeFrame !== null) return;
      const saved = anchor;
      // Let Virtuoso commit the new measurements before correcting the reading
      // anchor. Scrolling against its old sizes can evict the very row being read.
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        intentUntil.current = 0;
        if (saved.element.isConnected) {
          scroller.scrollTop += saved.element.getBoundingClientRect().top - saved.top;
        } else {
          const index = latest.current.articles.findIndex(
            (article) => article.id === saved.articleId,
          );
          if (index >= 0)
            virtuoso.current?.scrollToIndex({ index, align: "start", offset: -saved.rowTop });
        }
        lastTop = scroller.scrollTop;
        measure();
      });
    });
    const observed = new Set<HTMLElement>();
    const observe = () => {
      const mounted = new Set(rows());
      for (const row of observed)
        if (!mounted.has(row)) {
          resize.unobserve(row);
          observed.delete(row);
        }
      for (const row of mounted)
        if (!observed.has(row)) {
          resize.observe(row);
          observed.add(row);
        }
      if (!anchor) measure();
    };
    const mutations = new MutationObserver(observe);
    mutations.observe(scroller, { childList: true, subtree: true });
    observe();
    scroller.addEventListener("scroll", scroll, { passive: true });
    // A blocking listener records intent before a large compositor scroll can
    // recycle the wheel target. It never prevents the browser's default scroll.
    scroller.addEventListener("wheel", intent, { passive: false, capture: true });
    scroller.addEventListener("touchmove", intent, { passive: true });
    scroller.addEventListener("pointerdown", pointer, { passive: true });
    window.addEventListener("keydown", keyboard, true);
    return () => {
      clearTimeout(timer);
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      resize.disconnect();
      mutations.disconnect();
      scroller.removeEventListener("scroll", scroll);
      scroller.removeEventListener("wheel", intent, true);
      scroller.removeEventListener("touchmove", intent);
      scroller.removeEventListener("pointerdown", pointer);
      window.removeEventListener("keydown", keyboard, true);
    };
  }, [scroller, positions, positionKey, expanded]);

  useEffect(() => {
    if (!expanded || !scroller) return;
    const frames = new Set<number>();
    const update = () => {
      const protectedIds = new Set(frames);
      const selection = window.getSelection();
      for (const row of scroller.querySelectorAll<HTMLElement>(".virtual-article-row")) {
        const selected =
          selection &&
          !selection.isCollapsed &&
          Array.from({ length: selection.rangeCount }, (_, index) =>
            selection.getRangeAt(index),
          ).some((range) => range.intersectsNode(row));
        const playing = [...row.querySelectorAll<HTMLMediaElement>("video, audio")].some(
          (media) => !media.paused && !media.ended,
        );
        if (selected || playing || row.contains(document.activeElement))
          protectedIds.add(Number(row.dataset.articleId));
      }
      setRetained((current) =>
        current.size === protectedIds.size && [...current].every((id) => protectedIds.has(id))
          ? current
          : protectedIds,
      );
    };
    const frameInteraction = (event: Event) => {
      const target = event.target instanceof Element ? event.target : document.activeElement;
      const row = target?.closest<HTMLElement>(".virtual-article-row");
      if (row && (target?.closest(".article-media-player") || target?.tagName === "IFRAME"))
        frames.add(Number(row.dataset.articleId));
      update();
    };
    document.addEventListener("selectionchange", update);
    for (const name of ["play", "pause", "ended", "focusin", "focusout"])
      scroller.addEventListener(name, update, true);
    scroller.addEventListener("pointerdown", frameInteraction, true);
    scroller.addEventListener("click", frameInteraction, true);
    window.addEventListener("blur", frameInteraction);
    return () => {
      document.removeEventListener("selectionchange", update);
      for (const name of ["play", "pause", "ended", "focusin", "focusout"])
        scroller.removeEventListener(name, update, true);
      scroller.removeEventListener("pointerdown", frameInteraction, true);
      scroller.removeEventListener("click", frameInteraction, true);
      window.removeEventListener("blur", frameInteraction);
    };
  }, [expanded, scroller]);

  const loadMore = useCallback(() => {
    if (enabled && hasMore && !loadingMore) onLoadMore();
  }, [enabled, hasMore, loadingMore, onLoadMore]);
  return (
    <Virtuoso
      ref={virtuoso}
      className={expanded ? "expanded-stream" : "article-list"}
      aria-label={expanded ? "Expanded articles" : "Articles"}
      data={articles}
      computeItemKey={articleKey}
      components={components}
      context={{
        retained,
        offsets: offsets.current,
        articles,
        renderArticle: children,
        hasMore,
        loadingMore,
        loadMoreError,
        loadMore,
      }}
      scrollerRef={useCallback(
        (element: HTMLElement | Window | null) =>
          setScroller(element instanceof HTMLElement ? element : null),
        [],
      )}
      initialTopMostItemIndex={initialLocation.current}
      increaseViewportBy={{ top: 500, bottom: 700 }}
      endReached={() => {
        if (!loadMoreError) loadMore();
      }}
      itemsRendered={(items) => {
        for (const item of items) if (item.data) offsets.current.set(item.data.id, item.offset);
      }}
    />
  );
}
