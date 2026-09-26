import {
  type InfiniteData,
  infiniteQueryOptions,
  QueryClient,
  queryOptions,
} from "@tanstack/react-query";
import type { Article, ArticlePage, ArticleQuery } from "../../shared/types.js";
import type { YouTubeStatus } from "../../shared/youtube.js";
import { ApiError, api } from "../api/api.js";
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

export async function invalidateReader(client: QueryClient) {
  await client.cancelQueries({ queryKey: readerKeys.all });
  await client.invalidateQueries({ queryKey: readerKeys.all });
}

export function updateCachedArticleStates(
  client: QueryClient,
  ids: ReadonlySet<number>,
  change: { isRead?: boolean; isStarred?: boolean },
) {
  client.setQueriesData<InfiniteData<ArticlePage>>({ queryKey: readerKeys.lists }, (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            articles: page.articles.map((article) =>
              ids.has(article.id) ? { ...article, ...change } : article,
            ),
          })),
        }
      : data,
  );
  for (const id of ids)
    client.setQueryData(readerKeys.article(id), (article: Article | undefined) =>
      article ? { ...article, ...change } : article,
    );
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
