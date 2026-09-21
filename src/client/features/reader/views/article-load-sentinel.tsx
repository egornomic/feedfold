import { LoaderCircle } from "lucide-react";
import { useEffect, useRef } from "react";

export function ArticleLoadSentinel({
  rootRef,
  useParent = false,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  rootRef: React.RefObject<HTMLElement | null>;
  useParent?: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef(onLoadMore);
  loadMoreRef.current = onLoadMore;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = useParent ? rootRef.current?.parentElement : rootRef.current;
    if (!sentinel || !root || !hasMore || loadingMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMoreRef.current();
      },
      { root, rootMargin: "0px 0px 400px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, rootRef, useParent]);

  if (!hasMore) return null;
  return (
    <div
      ref={sentinelRef}
      className={`article-load-sentinel${loadingMore ? " is-loading" : ""}`}
      role="status"
      aria-live="polite"
      aria-busy={loadingMore}
    >
      {loadingMore ? (
        <>
          <LoaderCircle className="spin" aria-hidden="true" size={15} />
          <span>Loading more articles</span>
        </>
      ) : null}
    </div>
  );
}
