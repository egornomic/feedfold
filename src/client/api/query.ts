import {
  type InfiniteData,
  infiniteQueryOptions,
  QueryClient,
  queryOptions,
} from "@tanstack/react-query";
import type { Article, ArticlePage, ArticleQuery } from "../../shared/types.js";
import type { YouTubeStatus } from "../../shared/youtube.js";
import { ApiError, api } from "../api/api.js";
import type { ReaderDataInvalidation } from "./api-client.js";
import { httpRequest } from "./http-request.js";

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failures, error) =>
          failures < 3 && !(error instanceof ApiError && error.status < 500),
        // IPC remains available when the computer has no network connection.
        networkMode: "always",
      },
      mutations: { retry: false, networkMode: "always" },
    },
  });
}

export const readerKeys = {
  all: ["reader"] as const,
  bootstrap: ["reader", "bootstrap"] as const,
  rules: ["reader", "rules"] as const,
  lists: ["reader", "articles"] as const,
  queue: ["reader", "queue"] as const,
  article: (id: number) => ["reader", "article", id] as const,
};
export const counterMutationKey = ["article-state"];

export const bootstrapQuery = () =>
  queryOptions({
    queryKey: readerKeys.bootstrap,
    queryFn: ({ signal }) => api.bootstrap(signal),
  });
export const rulesQuery = () =>
  queryOptions({
    queryKey: readerKeys.rules,
    queryFn: ({ signal }) => api.rules(signal),
  });
export const articleQuery = (id: number) =>
  queryOptions({
    queryKey: readerKeys.article(id),
    queryFn: ({ signal }) => api.article(id, signal),
  });
export const xArticleMediaQuery = (articleId: number, postId: string) =>
  queryOptions({
    queryKey: ["article-media", articleId, "x", postId],
    queryFn: ({ signal }) => api.xArticleMedia(articleId, postId, signal),
  });
export const telegramArticleMediaQuery = (articleId: number) =>
  queryOptions({
    queryKey: ["article-media", articleId, "telegram"],
    queryFn: ({ signal }) => api.telegramArticleMedia(articleId, signal),
  });
export const articlePagesQuery = (query: ArticleQuery) =>
  infiniteQueryOptions({
    queryKey: [...readerKeys.lists, query],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const { anchorId, ...rest } = query;
      return api.articles(pageParam ? { ...rest, cursor: pageParam } : query, signal);
    },
    getNextPageParam: (page) => page.nextCursor,
  });

export async function invalidateReader(
  client: QueryClient,
  reason: ReaderDataInvalidation = "change",
) {
  if (reason === "connected") {
    // Show initial results without interruption, then reconcile the gap before subscription.
    await Promise.all(
      client
        .getQueryCache()
        .findAll({ queryKey: readerKeys.all })
        .map(async (query) => {
          await Promise.allSettled([query.promise]);
          await client.invalidateQueries(
            { queryKey: query.queryKey, exact: true },
            { cancelRefetch: false },
          );
        }),
    );
    return;
  }
  await client.cancelQueries({ queryKey: readerKeys.all });
  await client.invalidateQueries({ queryKey: readerKeys.all });
}

export function updateCachedArticleStates(
  client: QueryClient,
  changes: ReadonlyMap<number, Partial<Pick<Article, "isRead" | "isSaved">>>,
) {
  const update = (article: Article) => {
    const change = changes.get(article.id);
    if (
      !change ||
      ((change.isRead === undefined || change.isRead === article.isRead) &&
        (change.isSaved === undefined || change.isSaved === article.isSaved))
    )
      return article;
    return { ...article, ...change };
  };
  const updateArticles = (articles: Article[]) => {
    const next = articles.map(update);
    return next.some((article, index) => article !== articles[index]) ? next : articles;
  };
  const queue = client.getQueryData<Article[]>(readerKeys.queue);
  if (queue) {
    const next = updateArticles(queue);
    if (next !== queue) client.setQueryData(readerKeys.queue, next);
  }
  for (const [key, data] of client.getQueriesData<InfiniteData<ArticlePage>>({
    queryKey: readerKeys.lists,
  })) {
    if (!data) continue;
    const pages = data.pages.map((page) => {
      const articles = updateArticles(page.articles);
      return articles === page.articles ? page : { ...page, articles };
    });
    if (pages.some((page, index) => page !== data.pages[index]))
      client.setQueryData(key, { ...data, pages });
  }
  for (const id of changes.keys()) {
    const article = client.getQueryData<Article>(readerKeys.article(id));
    if (!article) continue;
    const next = update(article);
    if (next !== article) client.setQueryData(readerKeys.article(id), next);
  }
}

export const youtubeQuery = (userId: string) =>
  queryOptions({
    queryKey: ["youtube", userId],
    queryFn: ({ signal }) =>
      httpRequest<YouTubeStatus>("/api/youtube", {
        headers: { "X-Feedfold-Account": userId },
        signal,
      }),
  });
