import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import type { BootstrapData } from "../../../shared/types.js";
import { api } from "../../api/api.js";
import {
  bootstrapQuery,
  counterMutationKey,
  invalidateReader,
  readerKeys,
  rulesQuery,
} from "../../api/query.js";

export type ReaderDataMutations = Pick<
  typeof api,
  | "createFeed"
  | "importOpml"
  | "updateFeed"
  | "deleteFeed"
  | "updateWebFeedSelection"
  | "createFolder"
  | "updateFolder"
  | "deleteFolder"
  | "createRule"
  | "updateRule"
  | "deleteRule"
>;

export function useReaderData() {
  const client = useQueryClient();
  const changingCounters = useIsMutating({ mutationKey: counterMutationKey }) > 0;
  const bootstrap = useQuery({
    ...bootstrapQuery(),
    enabled: !changingCounters,
    refetchInterval: (query) =>
      query.state.data?.feeds.some((feed) => feed.refreshing) ? 1_000 : false,
  });
  const rules = useQuery({ ...rulesQuery(), enabled: !changingCounters });

  useEffect(
    () =>
      api.subscribeReaderDataInvalidations(() => {
        void invalidateReader(client);
      }),
    [client],
  );

  const { mutateAsync: mutate } = useMutation({
    mutationFn: (request: () => Promise<unknown>) => request(),
    onSuccess: () => invalidateReader(client),
  });
  const { mutateAsync: counterMutation } = useMutation({
    mutationKey: counterMutationKey,
    scope: { id: "article-state" },
    mutationFn: (request: () => Promise<unknown>) => request(),
    onMutate: async () => {
      const interrupted = client.getQueryCache().findAll({
        queryKey: readerKeys.all,
        fetchStatus: "fetching",
        predicate: (query) => query.queryKey[1] === "articles" || query.queryKey[1] === "article",
      });
      await client.cancelQueries({ queryKey: readerKeys.all });
      return interrupted.map((query) => query.queryKey);
    },
    onSettled: (_data, _error, _request, interrupted) => {
      for (const queryKey of interrupted ?? [])
        void client.invalidateQueries({ queryKey, exact: true, refetchType: "none" });
      if (client.isMutating({ mutationKey: counterMutationKey }) === 1) {
        void client.invalidateQueries({ queryKey: readerKeys.bootstrap });
      }
    },
  });

  const data = useMemo(() => {
    const run = async <T>(request: () => Promise<T>): Promise<T> => (await mutate(request)) as T;
    const mutations: ReaderDataMutations = {
      createFeed: (...args) => run(() => api.createFeed(...args)),
      importOpml: (...args) => run(() => api.importOpml(...args)),
      updateFeed: (...args) => run(() => api.updateFeed(...args)),
      deleteFeed: (...args) => run(() => api.deleteFeed(...args)),
      updateWebFeedSelection: (...args) => run(() => api.updateWebFeedSelection(...args)),
      createFolder: (...args) => run(() => api.createFolder(...args)),
      updateFolder: (...args) => run(() => api.updateFolder(...args)),
      deleteFolder: (...args) => run(() => api.deleteFolder(...args)),
      createRule: (...args) => run(() => api.createRule(...args)),
      updateRule: (...args) => run(() => api.updateRule(...args)),
      deleteRule: (...args) => run(() => api.deleteRule(...args)),
    };
    return {
      ...mutations,
      loadBootstrap: () => client.invalidateQueries({ queryKey: readerKeys.bootstrap }),
      reload: () => invalidateReader(client),
      mutateBootstrap: (update: (current: BootstrapData) => BootstrapData) => {
        void client.cancelQueries({ queryKey: readerKeys.bootstrap });
        client.setQueryData(readerKeys.bootstrap, (current: BootstrapData | undefined) =>
          current ? update(current) : current,
        );
      },
      runCounterMutation: async <T>(request: () => Promise<T>): Promise<T> =>
        (await counterMutation(request)) as T,
      beginRefresh: async (feedIds: number[] | undefined, trackedIds: number[]) => {
        const result = await run(() => api.refresh(feedIds));
        const ids = new Set([...trackedIds, ...result.refreshingFeedIds]);
        const settled = new Promise<void>((resolve) => {
          const done = () => {
            const state = client.getQueryState<BootstrapData>(readerKeys.bootstrap);
            return (
              !state ||
              (state.status === "success" &&
                !state.isInvalidated &&
                state.fetchStatus === "idle" &&
                !state.data?.feeds.some((feed) => ids.has(feed.id) && feed.refreshing))
            );
          };
          if (done()) {
            resolve();
            return;
          }
          const unsubscribe = client.getQueryCache().subscribe(() => {
            if (done()) {
              unsubscribe();
              resolve();
            }
          });
        });
        return { result, settled };
      },
    };
  }, [client, mutate, counterMutation]);

  return { data, bootstrap, rules };
}

export type ReaderData = ReturnType<typeof useReaderData>["data"];
