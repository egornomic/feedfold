export interface YouTubeStatus {
  available: boolean;
  connected: boolean;
  channelTitle: string | null;
  lastSyncAt: string | null;
  nextSyncAt: string | null;
  feedCount: number;
  error: string | null;
}
