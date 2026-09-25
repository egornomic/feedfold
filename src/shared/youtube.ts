export interface YouTubeStatus {
  available: boolean;
  connected: boolean;
  channelTitle: string | null;
  lastSyncAt: string | null;
  nextSyncAt: string | null;
  feedCount: number;
  error: string | null;
}

export function isYouTubeChannelFeed(feedUrl: string): boolean {
  const url = new URL(feedUrl);
  return (
    (url.hostname === "www.youtube.com" || url.hostname === "youtube.com") &&
    url.pathname === "/feeds/videos.xml" &&
    !!url.searchParams.get("channel_id")
  );
}
