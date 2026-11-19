export const YOUTUBE_EMBED_REFERRER = "https://github.com/egornomic/feedfold/";

interface YouTubeEmbedRequest {
  requestHeaders: Record<string, string>;
  resourceType: string;
  url: string;
  webContentsId?: number;
}

export function youtubeEmbedRequestHeaders(
  request: YouTubeEmbedRequest,
  rendererId: number,
): Record<string, string> {
  if (request.webContentsId !== rendererId || request.resourceType !== "subFrame") {
    return request.requestHeaders;
  }

  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return request.requestHeaders;
  }
  if (url.protocol !== "https:" || url.hostname !== "www.youtube.com") {
    return request.requestHeaders;
  }
  if (!url.pathname.startsWith("/embed/")) return request.requestHeaders;

  const headers = request.requestHeaders;
  const normalizedName = "referer".toLowerCase();
  const refererHeader = Object.keys(headers).find(
    (candidate) => candidate.toLowerCase() === normalizedName,
  );
  const referer = refererHeader ? request.requestHeaders[refererHeader] : null;
  if (referer && !referer.startsWith("feedfold://")) return request.requestHeaders;

  return {
    ...request.requestHeaders,
    [refererHeader ?? "Referer"]: YOUTUBE_EMBED_REFERRER,
  };
}
