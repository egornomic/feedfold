import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type { Article, ArticlePage, BootstrapData } from "../../../shared/types.js";
import { readerKeys, updateCachedArticleStates } from "../../api/query.js";
import { updateBootstrapCounts } from "./reader-state.js";

export type ArticleStateChange = Partial<Pick<Article, "isRead" | "isSaved">>;

function cachedArticles(client: QueryClient): Map<number, Article> {
  const articles = new Map<number, Article>();
  for (const [, data] of client.getQueriesData<InfiniteData<ArticlePage>>({
    queryKey: readerKeys.lists,
  }))
    for (const page of data?.pages ?? [])
      for (const article of page.articles) articles.set(article.id, article);
  for (const [, article] of client.getQueriesData<Article>({
    queryKey: ["reader", "article"],
  }))
    if (article) articles.set(article.id, article);
  for (const article of client.getQueryData<Article[]>(readerKeys.queue) ?? [])
    articles.set(article.id, article);
  return articles;
}

export function updateReaderArticleStates(
  client: QueryClient,
  changes: ReadonlyMap<number, ArticleStateChange>,
  adjustCounts = true,
): () => void {
  const current = cachedArticles(client);
  const previous = new Map<number, ArticleStateChange>();
  for (const [id, change] of changes) {
    const article = current.get(id);
    if (!article) continue;
    previous.set(id, {
      ...(change.isRead !== undefined ? { isRead: article.isRead } : {}),
      ...(change.isSaved !== undefined ? { isSaved: article.isSaved } : {}),
    });
  }
  updateCachedArticleStates(client, changes);
  if (adjustCounts) {
    client.setQueryData<BootstrapData>(readerKeys.bootstrap, (bootstrap) => {
      if (!bootstrap) return bootstrap;
      for (const [id, change] of changes) {
        const article = current.get(id);
        if (!article) continue;
        bootstrap = updateBootstrapCounts(
          bootstrap,
          article,
          change.isRead === undefined ? 0 : Number(article.isRead) - Number(change.isRead),
          change.isSaved === undefined ? 0 : Number(change.isSaved) - Number(article.isSaved),
        );
      }
      return bootstrap;
    });
  }
  return () => {
    const latest = cachedArticles(client);
    const rollback = new Map<number, ArticleStateChange>();
    for (const [id, before] of previous) {
      const article = latest.get(id);
      const change = changes.get(id);
      if (!article || !change) continue;
      rollback.set(id, {
        ...(change.isRead !== undefined && article.isRead === change.isRead
          ? { isRead: before.isRead }
          : {}),
        ...(change.isSaved !== undefined && article.isSaved === change.isSaved
          ? { isSaved: before.isSaved }
          : {}),
      });
    }
    updateReaderArticleStates(client, rollback, adjustCounts);
  };
}
