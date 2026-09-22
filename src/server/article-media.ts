import type { ArticleMedia } from "../shared/types.js";

interface YouTubeMediaDetails {
  videoId?: string | null;
  thumbnailUrl?: string | null;
  viewCount?: number | null;
}

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);

export function youtubeMediaFromUrl(
  value: string | null,
  details: YouTubeMediaDetails = {},
): ArticleMedia | null {
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (!YOUTUBE_HOSTS.has(parsed.hostname.toLowerCase())) return null;

  const segments = parsed.pathname.split("/").filter(Boolean);
  const videoId =
    details.videoId ??
    (parsed.hostname.toLowerCase() === "youtu.be"
      ? segments[0]
      : (parsed.searchParams.get("v") ??
        (segments[0] === "shorts" || segments[0] === "embed" || segments[0] === "v"
          ? segments[1]
          : null)));
  if (!videoId || !/^[A-Za-z0-9_-]+$/.test(videoId)) return null;

  return {
    provider: "youtube",
    type: segments[0] === "shorts" ? "short" : "video",
    embedUrl: `https://www.youtube.com/embed/${videoId}`,
    thumbnailUrl: details.thumbnailUrl ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    viewCount: details.viewCount ?? null,
  };
}

export function articleMediaRuleText(media: ArticleMedia | null): string {
  return media ? `${media.provider} ${media.type}` : "article";
}
