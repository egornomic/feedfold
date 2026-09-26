import type { Article } from "../../../../shared/types.js";

export interface ReadingPosition {
  articleId: number;
  index: number;
  offset: number;
}

export function readingPositionIndex(articles: Article[], position: ReadingPosition) {
  const index = articles.findIndex((article) => article.id === position.articleId);
  return index < 0 ? Math.min(position.index, Math.max(0, articles.length - 1)) : index;
}

// Only articles actually seen during this visit can be passed by a deliberate scroll.
export class PassedArticles {
  private seen = new Map<number, number>();

  observe(id: number, top: number, bottom: number, viewportTop: number, viewportBottom: number) {
    if (bottom > viewportTop && top < viewportBottom) this.seen.set(id, bottom);
    else if (this.seen.has(id)) this.seen.set(id, bottom);
  }

  passed(scrollTop: number): number[] {
    const ids: number[] = [];
    for (const [id, bottom] of this.seen) {
      if (bottom <= scrollTop) {
        ids.push(id);
        this.seen.delete(id);
      }
    }
    return ids;
  }
}
