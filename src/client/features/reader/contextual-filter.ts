import type { Article } from "../../../shared/types.js";

export interface ContextArticleReturn {
  article: Article;
  index: number;
}

export function articlesWithContextReturn(
  articles: Article[],
  returnTarget: ContextArticleReturn | null,
): Article[] {
  const nextArticles = [...articles];
  if (!returnTarget) return nextArticles;

  const currentIndex = nextArticles.findIndex((article) => article.id === returnTarget.article.id);
  if (currentIndex === -1) {
    nextArticles.splice(Math.min(returnTarget.index, nextArticles.length), 0, returnTarget.article);
    return nextArticles;
  }

  const currentArticle = nextArticles[currentIndex];
  if (currentArticle) {
    nextArticles[currentIndex] = {
      ...returnTarget.article,
      isRead: currentArticle.isRead,
      isStarred: currentArticle.isStarred,
    };
  }
  return nextArticles;
}
