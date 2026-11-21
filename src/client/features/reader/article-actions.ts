import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { appRoutePath } from "../../../shared/app-routes";
import type {
    Article,
    MarkReadAgeDays,
    ReadingMode,
} from "../../../shared/types";
import { api, errorMessage } from "../../api/api";
import { useRequestMutation } from "../../api/use-request-mutation";
import type { AppRouteController } from "../../app/route";
import { copyText } from "../../platform/clipboard";
import type { ArticleEnrichmentController } from "./article-enrichment";
import type { ArticleQueueController } from "./article-queue";
import {
    type ArticleStateChange,
    updateReaderArticleStates,
} from "./article-state";
import type { ReaderData } from "./reader-data";
import {
    articleQueryForReaderRoute,
    shouldAutoMarkRoutedArticleRead,
} from "./reader-state";

interface ArticleActionsOptions {
    loadFullArticle: ArticleEnrichmentController["loadFullArticle"];
    queue: ArticleQueueController;
    route: AppRouteController;
    dataResource: ReaderData;
    readingMode: ReadingMode;
    showToast: (message: string) => void;
}

interface QueueFocus {
    path: string;
    articleId: number;
    index: number;
}

export function useArticleActions({
    loadFullArticle,
    queue,
    route,
    dataResource,
    readingMode,
    showToast,
}: ArticleActionsOptions) {
    const client = useQueryClient();
    const { run: mutateRequest, isPending: markReadPending } =
        useRequestMutation();
    const manuallyUnreadArticleIds = useRef(new Set<number>());
    const activeArticleIdRef = useRef(queue.activeArticleId);
    activeArticleIdRef.current = queue.activeArticleId;
    const queueOrigin = useRef<QueueFocus | null>(null);
    const [keyboardFocus, setKeyboardFocus] = useState<
        | { kind: "article"; articleId: number }
        | ({ kind: "queue" } & QueueFocus)
        | null
    >(null);
    const clearKeyboardFocus = useCallback(() => setKeyboardFocus(null), []);
    const loadBootstrap = dataResource.loadBootstrap;
    const loadArticles = queue.loadArticles;

    const changeArticlesState = useCallback(
        async (
            candidates: Article[],
            change: ArticleStateChange,
            request: (ids: number[]) => Promise<unknown>,
            failureMessage: string,
        ): Promise<boolean> => {
            const ids = [...new Set(candidates.map((article) => article.id))];
            const protectedIds = new Set(
                ids.filter((id) => manuallyUnreadArticleIds.current.has(id)),
            );
            for (const id of ids) {
                if (change.isRead === false) {
                    manuallyUnreadArticleIds.current.add(id);
                }
                if (change.isRead === true) {
                    manuallyUnreadArticleIds.current.delete(id);
                }
            }
            try {
                await dataResource.runCounterMutation(
                    ids,
                    () => request(ids),
                    () => {
                        const rollback = updateReaderArticleStates(
                            client,
                            new Map(ids.map((id) => [id, change])),
                        );
                        return () => {
                            // Keep a rejected automatic read unread until the
                            // reader explicitly tries again.
                            for (const id of ids) {
                                if (
                                    protectedIds.has(id) ||
                                    change.isRead === true
                                ) {
                                    manuallyUnreadArticleIds.current.add(id);
                                } else if (change.isRead === false) {
                                    manuallyUnreadArticleIds.current.delete(id);
                                }
                            }
                            rollback();
                        };
                    },
                );
                return true;
            } catch (caught) {
                showToast(`${failureMessage}: ${errorMessage(caught)}`);
                return false;
            }
        },
        [client, dataResource, showToast],
    );
    const changeArticleState = useCallback(
        (article: Article, change: ArticleStateChange) =>
            changeArticlesState(
                [article],
                change,
                () => api.updateArticleState(article.id, change),
                "Could not update the article",
            ),
        [changeArticlesState],
    );

    const activateArticle = useCallback(
        (article: Article, keyboardTarget = false) => {
            queue.selectArticle(article.id, keyboardTarget);
            if (!article.isRead) {
                void changeArticleState(article, { isRead: true });
            }
            void loadFullArticle(article, true);
        },
        [changeArticleState, loadFullArticle, queue],
    );

    const openArticle = useCallback(
        (
            article: Article,
            keyboard = false,
            historyMode: "push" | "replace" = "push",
        ) => {
            const current = route.current();
            const index = queue
                .getArticles()
                .findIndex((item) => item.id === article.id);
            if (current.kind === "reader") {
                queueOrigin.current = {
                    path: appRoutePath(current),
                    articleId: article.id,
                    index,
                };
                setKeyboardFocus(
                    keyboard
                        ? { kind: "article", articleId: article.id }
                        : null,
                );
            }
            activateArticle(article);
            route.navigate(
                { kind: "article", articleId: article.id },
                historyMode,
                index,
            );
        },
        [activateArticle, queue.getArticles, route],
    );

    useEffect(() => {
        if (
            route.route.kind !== "article" &&
            route.current().kind !== "article"
        ) {
            queueOrigin.current = null;
        }
    }, [route.route.kind, route.current]);

    function returnToQueue(keyboard: boolean) {
        const current = route.current();
        if (
            keyboard &&
            queue.readingMode === "magazine" &&
            current.kind === "article"
        ) {
            const path = appRoutePath(route.readerRoute);
            const origin = queueOrigin.current;
            setKeyboardFocus({
                kind: "queue",
                ...(origin?.path === path
                    ? origin
                    : {
                          path,
                          articleId: current.articleId,
                          index:
                              route.articleContext()?.articleIndex ??
                              queue.activeArticleIndex,
                      }),
            });
        } else {
            clearKeyboardFocus();
        }
        route.returnToArticleList();
    }

    useEffect(() => {
        if (
            queue.activeArticle &&
            shouldAutoMarkRoutedArticleRead(
                queue.activeArticle,
                route.routedArticleId,
                manuallyUnreadArticleIds.current,
            )
        ) {
            void changeArticleState(queue.activeArticle, { isRead: true });
        }
    }, [changeArticleState, queue.activeArticle, route.routedArticleId]);

    const moveArticle = useCallback(
        async (direction: 1 | -1, keyboard = false): Promise<boolean> => {
            if (queue.articles.length === 0) {
                return false;
            }
            const currentRoute = route.current();
            const routed = currentRoute.kind === "article";
            const openReader = readingMode === "magazine" || routed;
            const open = (article: Article) => {
                if (openReader) {
                    openArticle(article, keyboard, routed ? "replace" : "push");
                } else {
                    activateArticle(article, true);
                }
            };
            if (openReader && !routed && queue.activeArticle) {
                open(queue.activeArticle);
                return true;
            }
            const currentId =
                currentRoute.kind === "article"
                    ? currentRoute.articleId
                    : queue.activeArticleId;
            const currentIndex = queue.articles.findIndex(
                (article) => article.id === currentId,
            );
            if (
                direction === 1 &&
                currentIndex === queue.articles.length - 1 &&
                queue.nextCursor
            ) {
                const appended = await queue.loadOlderArticles();
                const next = appended[0];
                if (!next) {
                    return false;
                }
                open(next);
                return true;
            }
            if (
                direction === 1 &&
                currentIndex === queue.articles.length - 1 &&
                !queue.nextCursor &&
                !queue.loading &&
                !queue.loadingMore &&
                queue.queueReady
            ) {
                await queue.refreshQueue();
                if (
                    route.current() !== currentRoute ||
                    (!routed && activeArticleIdRef.current !== currentId)
                ) {
                    return false;
                }
                const articles = queue.getArticles();
                const next =
                    articles[
                        articles.findIndex(
                            (article) => article.id === currentId,
                        ) + 1
                    ];
                if (next) {
                    open(next);
                    return true;
                }
                route.navigate(
                    { ...route.readerRoute, state: "unread" },
                    routed ? "replace" : "push",
                );
                return true;
            }
            const nextIndex = Math.min(
                queue.articles.length - 1,
                Math.max(0, currentIndex < 0 ? 0 : currentIndex + direction),
            );
            const next = queue.articles[nextIndex];
            if (next && next.id !== currentId) {
                open(next);
                return true;
            }
            return false;
        },
        [activateArticle, openArticle, queue, readingMode, route],
    );

    const copyArticleUrl = useCallback(
        async (article: Article | null) => {
            if (!article?.url) {
                showToast("This article has no source link.");
                return;
            }
            try {
                await copyText(article.url);
                showToast("Article link copied");
            } catch {
                showToast(
                    "Could not copy the article link. Copy it from the source page instead.",
                );
            }
        },
        [showToast],
    );

    const openArticleSource = useCallback(
        (article: Article | null) => {
            if (!article?.url) {
                showToast("This article has no source link.");
                return;
            }
            window.open(article.url, "_blank", "noopener,noreferrer");
        },
        [showToast],
    );

    const markArticleBatchRead = useCallback(
        async (candidates: Article[]): Promise<boolean> => {
            const unique = new Map<number, Article>();
            for (const article of candidates) {
                if (!article.isRead) {
                    unique.set(article.id, article);
                }
            }
            const unreadArticles = [...unique.values()];
            if (unreadArticles.length === 0) {
                return true;
            }

            return changeArticlesState(
                unreadArticles,
                { isRead: true },
                (ids) => api.markRead({ articleIds: ids }),
                "Could not mark articles as read",
            );
        },
        [changeArticlesState],
    );

    const markVisibleRead = useCallback(async () => {
        const unreadArticles = queue.articles.filter(
            (article) => !article.isRead,
        );
        if (unreadArticles.length === 0) {
            showToast("This view has no unread articles.");
            return;
        }
        if (await markArticleBatchRead(unreadArticles)) {
            showToast(
                `Marked ${unreadArticles.length} ` +
                    `${unreadArticles.length === 1 ? "article" : "articles"}` +
                    " as read",
            );
        }
    }, [markArticleBatchRead, queue.articles, showToast]);

    const markOlderArticlesRead = useCallback(
        async (days: MarkReadAgeDays) => {
            try {
                const filters = articleQueryForReaderRoute(route.readerRoute);
                await mutateRequest(async () => {
                    const noMatchesMessage = "No matching unread articles";
                    const { count, olderThan } = await api.previewMarkRead({
                        ...filters,
                        olderThanDays: days,
                    });
                    if (count === 0) {
                        showToast(noMatchesMessage);
                        return;
                    }
                    if (
                        !window.confirm(
                            `Mark ${count} ${count === 1 ? "article" : "articles"} as read?`,
                        )
                    ) {
                        return;
                    }
                    const { updated } = await api.markRead({
                        ...filters,
                        olderThan,
                        confirmedCount: count,
                    });
                    await Promise.all([loadBootstrap(), loadArticles()]);
                    showToast(
                        updated === 0
                            ? noMatchesMessage
                            : `Marked ${updated} ${updated === 1 ? "article" : "articles"} as read`,
                    );
                });
            } catch (caught) {
                showToast(
                    `Could not mark older articles as read: ${errorMessage(caught)}`,
                );
            }
        },
        [
            loadArticles,
            loadBootstrap,
            route.readerRoute,
            showToast,
            mutateRequest,
        ],
    );

    return {
        markReadPending,
        changeArticleState,
        openArticle,
        returnToQueue,
        keyboardFocus,
        clearKeyboardFocus,
        moveArticle,
        copyArticleUrl,
        openArticleSource,
        markPassedArticlesRead: markArticleBatchRead,
        markVisibleRead,
        markOlderArticlesRead,
    };
}
