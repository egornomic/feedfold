import { ApiError } from "../client/api/api-contract.js";
import { httpRequest as liveHttpRequest } from "../client/api/http-request.js";
import type { YouTubeStatus } from "../shared/youtube.js";
import { selectedDataMode } from "./stress-api.js";

const UNAVAILABLE_YOUTUBE: YouTubeStatus = {
  available: false,
  connected: false,
  channelTitle: null,
  lastSyncAt: null,
  nextSyncAt: null,
  feedCount: 0,
  error: null,
};

export async function httpRequest<T>(path: string, init?: RequestInit): Promise<T> {
  if (!selectedDataMode()) return liveHttpRequest<T>(path, init);
  if (init?.signal?.aborted) throw new DOMException("The request was aborted.", "AbortError");
  if (path === "/api/youtube" && (!init?.method || init.method.toUpperCase() === "GET")) {
    return structuredClone(UNAVAILABLE_YOUTUBE) as T;
  }
  throw new ApiError("Live service requests are unavailable with development test data.", 501);
}
