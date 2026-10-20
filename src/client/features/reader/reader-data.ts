import {
  type Query,
  type QueryKey,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
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
  const [mutationRevision, setMutationRevision] = useState(0);
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
      api.subscribeReaderDataInvalidations((reason) => {
        void invalidateReader(client, reason);
      }),
    [client],
  );

  const { mutateAsync: mutate } = useMutation({
    mutationFn: ({ request }: { request: () => Promise<unknown>; reconcile: boolean }) => request(),
    onSuccess: async (_result, { reconcile }) => {
      await invalidateReader(client);
      if (reconcile) setMutationRevision((revision) => revision + 1);
    },
  });
  const { mutateAsync: counterMutation } = useMutation({
    mutationKey: counterMutationKey,
    scope: { id: "article-state" },
    mutationFn: async ({
      request,
      rollback,
    }: {
      request: () => Promise<unknown>;
      rollback: (() => void) | undefined;
      interrupted: QueryKey[];
    }) => {
      try {
        return await request();
      } catch (error) {
        rollback?.();
        throw error;
      }
    },
    onSettled: (_data, _error, { interrupted }) => {
      for (const queryKey of interrupted) void client.invalidateQueries({ queryKey, exact: true });
      if (client.isMutating({ mutationKey: counterMutationKey }) === 1) {
        void client.invalidateQueries({ queryKey: readerKeys.bootstrap });
      }
    },
  });

  const data = useMemo(() => {
    const run = async <T>(request: () => Promise<T>, reconcile = true): Promise<T> =>
      (await mutate({ request, reconcile })) as T;
    const mutations: ReaderDataMutations = {
      createFeed: (...args) => run(() => api.createFeed(...args)),
      importOpml: (...args) => run(() => api.importOpml(...args)),
      updateFeed: (id, input) =>
        run(
          () => api.updateFeed(id, input),
          input.folderId !== undefined || input.feedUrl !== undefined,
        ),
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
      runCounterMutation: async <T>(
        articleIds: readonly number[],
        request: () => Promise<T>,
        optimistic?: () => () => void,
      ): Promise<T> => {
        const changed = new Set(articleIds);
        // Another article's content carries no state this change replaces, so its preload continues.
        const replaced = (query: Query) =>
          query.queryKey[1] !== "article" || changed.has(query.queryKey[2] as number);
        const interrupted = client
          .getQueryCache()
          .findAll({
            queryKey: readerKeys.all,
            fetchStatus: "fetching",
            predicate: (query) =>
              (query.queryKey[1] === "articles" || query.queryKey[1] === "article") &&
              replaced(query),
          })
          .map((query) => query.queryKey);
        // Cancel stale deliveries before applying the immediate article and count changes.
        const cancelled = client.cancelQueries({ queryKey: readerKeys.all, predicate: replaced });
        const queued = client.isMutating({ mutationKey: counterMutationKey }) > 0;
        let rollback = queued ? undefined : optimistic?.();
        return (await counterMutation({
          request: async () => {
            await cancelled;
            // A queued action starts from the preceding action's committed or restored state.
            if (queued) rollback = optimistic?.();
            return request();
          },
          rollback: () => rollback?.(),
          interrupted,
        })) as T;
      },
      beginRefresh: async (feedIds: number[] | undefined, trackedIds: number[]) => {
        const result = await run(() => api.refresh(feedIds), false);
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

  return { data, bootstrap, rules, mutationRevision };
}

export type ReaderData = ReturnType<typeof useReaderData>["data"];
