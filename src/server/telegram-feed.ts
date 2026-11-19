import { JSDOM } from "jsdom";
import { telegramPostIdentity, telegramUrlPath } from "../shared/telegram.js";
import { firstSafeImageUrl } from "./article-image.js";
import type { ParsedArticle, ParsedFeed } from "./features/shared.js";
import { plainText } from "./feed-parser.js";

const TELEGRAM_HOST = "t.me";
const CHANNEL_NAME = /^[a-zA-Z0-9_]{5,32}$/;
const POST_ID = /^\d+$/;

export interface TelegramChannelUrls {
    channelUrl: string;
    previewUrl: string;
}

export function telegramChannelUrls(value: string): TelegramChannelUrls | null {
    const path = telegramUrlPath(value);
    if (!path) {
        return null;
    }
    const channel =
        path.length === 1
            ? path[0]
            : path.length === 2 && path[0] === "s"
              ? path[1]
              : null;
    if (!channel || !CHANNEL_NAME.test(channel)) {
        return null;
    }
    return {
        channelUrl: `https://${TELEGRAM_HOST}/${channel}`,
        previewUrl: `https://${TELEGRAM_HOST}/s/${channel}`,
    };
}

function date(value: string | null): string | null {
    if (!value) {
        return null;
    }
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function backgroundImageUrl(
    element: Element | null,
    baseUrl: string,
): string | null {
    const style = element?.getAttribute("style") ?? "";
    const match =
        /background-image\s*:\s*url\((?:"([^"]*)"|'([^']*)'|([^)]*))\)/i.exec(
            style,
        );
    const candidate = match?.[1] ?? match?.[2] ?? match?.[3]?.trim();
    if (!candidate) {
        return null;
    }
    const image = element?.ownerDocument.createElement("img");
    if (!image) {
        return null;
    }
    image.setAttribute("src", candidate);
    return firstSafeImageUrl(image.outerHTML, baseUrl);
}

function mediaUrl(value: string | null, baseUrl: string): string | null {
    if (!value) {
        return null;
    }
    try {
        const url = new URL(value, baseUrl);
        return url.protocol === "http:" || url.protocol === "https:"
            ? url.toString()
            : null;
    } catch {
        return null;
    }
}

export interface TelegramPostMedia {
    kind: "image" | "video";
    url: string;
    posterUrl: string | null;
    aspectRatio: number | null;
}

function messageMedia(message: Element, baseUrl: string): TelegramPostMedia[] {
    const media: TelegramPostMedia[] = [];
    for (const element of message.querySelectorAll<HTMLElement>(
        ".tgme_widget_message_photo_wrap[style], .tgme_widget_message_video_player",
    )) {
        if (element.classList.contains("tgme_widget_message_photo_wrap")) {
            const url = backgroundImageUrl(element, baseUrl);
            if (url) {
                media.push({
                    kind: "image",
                    url,
                    posterUrl: null,
                    aspectRatio: null,
                });
            }
            continue;
        }

        const video = element.querySelector("video[src]");
        const url = mediaUrl(video?.getAttribute("src") ?? null, baseUrl);
        if (!url) {
            continue;
        }
        const ratio = Number(element.getAttribute("data-ratio"));
        media.push({
            kind: "video",
            url,
            posterUrl: backgroundImageUrl(
                element.querySelector(
                    ".tgme_widget_message_video_thumb[style]",
                ),
                baseUrl,
            ),
            aspectRatio: Number.isFinite(ratio) && ratio > 0 ? ratio : null,
        });
    }
    return media;
}

export function telegramPostEmbedUrl(value: string): string | null {
    const identity = telegramPostIdentity(value);
    if (!identity) {
        return null;
    }
    const url = new URL(
        `https://${TELEGRAM_HOST}/${identity.channel}/${identity.postId}`,
    );
    url.search = new URLSearchParams({ embed: "1", mode: "tme" }).toString();
    return url.toString();
}

export function parseTelegramPostMedia(
    source: string,
    postUrl: string,
): TelegramPostMedia[] {
    const identity = telegramPostIdentity(postUrl);
    const embedUrl = telegramPostEmbedUrl(postUrl);
    if (!identity || !embedUrl) {
        throw new Error("Invalid Telegram post URL");
    }
    const expectedPost = `${identity.channel}/${identity.postId}`.toLowerCase();
    const dom = new JSDOM(source, { url: embedUrl });
    try {
        const message = Array.from(
            dom.window.document.querySelectorAll(
                ".tgme_widget_message[data-post]",
            ),
        ).find(
            (candidate) =>
                candidate.getAttribute("data-post")?.toLowerCase() ===
                expectedPost,
        );
        return message ? messageMedia(message, embedUrl) : [];
    } finally {
        dom.window.close();
    }
}

export function removeTelegramFeedImages(html: string): string {
    if (!/<img\b/i.test(html)) {
        return html;
    }
    const fragment = JSDOM.fragment(html);
    for (const image of fragment.querySelectorAll("img")) {
        image.remove();
    }
    const container = fragment.ownerDocument.createElement("div");
    container.append(fragment);
    return container.innerHTML.trim();
}

export function parseAndNormalizeTelegramFeed(
    source: string,
    channelUrl: string,
): ParsedFeed {
    const urls = telegramChannelUrls(channelUrl);
    if (!urls) {
        throw new Error("Invalid Telegram channel URL");
    }
    const channel = new URL(urls.channelUrl).pathname.slice(1);
    const dom = new JSDOM(source, { url: urls.previewUrl });
    try {
        const value = dom.window.document.querySelector(
            ".tgme_channel_info_header_title",
        )?.textContent;
        const title = value?.replace(/\s+/g, " ").trim() ?? "";
        if (!title) {
            throw new Error("Telegram channel preview was not found");
        }
        const articles = Array.from(
            dom.window.document.querySelectorAll(
                ".js-widget_message[data-post]",
            ),
        )
            .map((message): ParsedArticle | null => {
                const externalId = message.getAttribute("data-post");
                if (!externalId) {
                    return null;
                }
                const [postChannel, postId, ...rest] = externalId.split("/");
                if (
                    rest.length > 0 ||
                    postChannel?.toLowerCase() !== channel.toLowerCase() ||
                    !postId ||
                    !POST_ID.test(postId)
                ) {
                    return null;
                }

                const postUrl = `${urls.channelUrl}/${postId}`;
                const messageText =
                    message.querySelector<HTMLElement>(".js-message_text");
                const summary = plainText(messageText?.innerHTML ?? null);
                const media = messageMedia(message, urls.channelUrl);
                const imageUrl = media[0]?.posterUrl ?? media[0]?.url ?? null;
                const content = message.ownerDocument.createElement("div");
                if (messageText) {
                    content.innerHTML = messageText.innerHTML.trim();
                }
                if (!content.innerHTML.trim()) {
                    const link = message.ownerDocument.createElement("a");
                    link.href = postUrl;
                    link.textContent = "View this post on Telegram";
                    content.append(link);
                }

                return {
                    externalId,
                    title: "",
                    url: postUrl,
                    author: title,
                    publishedAt: date(
                        message
                            .querySelector("time[datetime]")
                            ?.getAttribute("datetime") ?? null,
                    ),
                    summary,
                    imageUrl,
                    feedContentHtml: content.innerHTML,
                };
            })
            .filter((item): item is ParsedArticle => item !== null)
            .reverse();
        return { title, siteUrl: urls.channelUrl, articles };
    } finally {
        dom.window.close();
    }
}
