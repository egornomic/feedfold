import { AlertTriangle } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Article, TelegramArticleMedia, XArticleMedia } from "../../../../shared/types";
import { xPostId } from "../../../../shared/x";
import { api, errorMessage } from "../../../api";
import { articleImageUrl } from "./article-image-url";
import { ImageLightbox, type ImageLightboxItem, type ImageLightboxState } from "./image-lightbox";

type XMediaViewState =
  | { status: "loading" }
  | { status: "ready"; media: XArticleMedia }
  | { status: "error"; message: string };

export function XPostVideo({
  article,
  postId,
  targetId,
}: {
  article: Article;
  postId: string;
  targetId: string | null;
}) {
  const [state, setState] = useState<XMediaViewState>({ status: "loading" });
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const requestController = useRef<AbortController | null>(null);

  const loadMedia = useCallback(() => {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setState({ status: "loading" });
    void api
      .xArticleMedia(article.id, postId, controller.signal)
      .then((media) => setState({ status: "ready", media }))
      .catch((error) => {
        if (!controller.signal.aborted) {
          setState({ status: "error", message: errorMessage(error) });
        }
      });
  }, [article.id, postId]);

  useEffect(() => {
    loadMedia();
    return () => requestController.current?.abort();
  }, [loadMedia]);

  useLayoutEffect(() => {
    setPortalTarget(targetId && article.feedContentHtml ? document.getElementById(targetId) : null);
  }, [article.feedContentHtml, targetId]);

  if (state.status === "loading") return null;
  const isQuotedPostVideo = xPostId(article.url) !== postId;
  if (state.status === "error") {
    const error = (
      <div className="x-media-state x-media-error" role="alert">
        <AlertTriangle aria-hidden="true" size={16} />
        <span>{state.message}</span>
        <button className="secondary-button" type="button" onClick={loadMedia}>
          Try again
        </button>
        <a href={`https://x.com/i/status/${postId}`} target="_blank" rel="noreferrer">
          Open on X
        </a>
      </div>
    );
    return portalTarget ? createPortal(error, portalTarget) : error;
  }

  const video = (
    // biome-ignore lint/a11y/useMediaCaption: X's public media metadata does not expose caption tracks.
    <video
      className="x-video-player"
      src={articleImageUrl(state.media.sourceUrl)}
      poster={state.media.posterUrl ? articleImageUrl(state.media.posterUrl) : undefined}
      aria-label={
        isQuotedPostVideo
          ? "X video from quoted post"
          : `X video from ${article.author ?? "this post"}`
      }
      style={state.media.aspectRatio ? { aspectRatio: state.media.aspectRatio } : undefined}
      controls
      playsInline
      preload="metadata"
    />
  );
  return portalTarget ? createPortal(video, portalTarget) : video;
}

type TelegramMediaViewState =
  | { status: "loading" }
  | { status: "ready"; media: TelegramArticleMedia }
  | { status: "error"; message: string };

export function TelegramPostMedia({ article }: { article: Article }) {
  const [state, setState] = useState<TelegramMediaViewState>({ status: "loading" });
  const [lightbox, setLightbox] = useState<ImageLightboxState | null>(null);
  const requestController = useRef<AbortController | null>(null);

  const loadMedia = useCallback(() => {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setState({ status: "loading" });
    void api
      .telegramArticleMedia(article.id, controller.signal)
      .then((media) => setState({ status: "ready", media }))
      .catch((error) => {
        if (!controller.signal.aborted) {
          setState({ status: "error", message: errorMessage(error) });
        }
      });
  }, [article.id]);

  useEffect(() => {
    loadMedia();
    return () => requestController.current?.abort();
  }, [loadMedia]);

  if (state.status === "loading") return null;
  if (state.status === "error") {
    return (
      <div className="telegram-media-state telegram-media-error" role="alert">
        <AlertTriangle aria-hidden="true" size={16} />
        <span>{state.message}</span>
        <button className="secondary-button" type="button" onClick={loadMedia}>
          Try again
        </button>
      </div>
    );
  }
  if (state.media.items.length === 0) return null;

  const multiple = state.media.items.length > 1;
  const galleryImages: ImageLightboxItem[] = state.media.items
    .filter((item) => item.kind === "image")
    .map((item, index, images) => ({
      src: articleImageUrl(item.sourceUrl),
      alt: `Telegram post image ${index + 1} of ${images.length}`,
    }));
  return (
    <>
      <section
        className={`telegram-media-gallery${multiple ? " is-grouped" : ""}`}
        aria-label="Telegram post media"
      >
        {state.media.items.map((item, index) => {
          const label = `Telegram post ${item.kind} ${index + 1} of ${state.media.items.length}`;
          const style = item.aspectRatio ? { aspectRatio: item.aspectRatio } : undefined;
          if (item.kind === "image") {
            const galleryIndex = state.media.items
              .slice(0, index)
              .filter((candidate) => candidate.kind === "image").length;
            return (
              <button
                key={item.sourceUrl}
                className="telegram-image-lightbox-trigger"
                type="button"
                data-image-lightbox-trigger
                aria-label={`Enlarge image: ${label}`}
                onClick={(event) =>
                  setLightbox({
                    images: galleryImages,
                    index: galleryIndex,
                    returnFocus: event.currentTarget,
                  })
                }
              >
                <img
                  src={articleImageUrl(item.sourceUrl)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  data-image-lightbox-trigger
                />
              </button>
            );
          }
          return (
            // biome-ignore lint/a11y/useMediaCaption: Telegram embeds do not expose caption tracks.
            <video
              key={item.sourceUrl}
              src={articleImageUrl(item.sourceUrl)}
              poster={item.posterUrl ? articleImageUrl(item.posterUrl) : undefined}
              aria-label={label}
              style={style}
              controls
              playsInline
              preload="metadata"
            />
          );
        })}
      </section>
      {lightbox ? <ImageLightbox state={lightbox} onClose={() => setLightbox(null)} /> : null}
    </>
  );
}

export function ArticleMediaPlayer({ article }: { article: Article }) {
  const media = article.media;
  const [interactive, setInteractive] = useState(false);
  if (!media) return null;
  const playerUrl = interactive ? `${media.embedUrl}?autoplay=1&playsinline=1` : media.embedUrl;
  return (
    <div className={`article-media-player ${media.type}`}>
      <iframe
        src={playerUrl}
        title={`Play ${article.title}`}
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
      />
      {!interactive ? (
        <button
          className="article-media-swipe-surface"
          type="button"
          aria-label={`Play ${article.title || "video"}`}
          data-article-swipe-surface
          onClick={() => setInteractive(true)}
        />
      ) : null}
    </div>
  );
}
