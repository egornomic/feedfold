import type { FeedErrorKind, FeedHealthStatus } from "../shared/types.js";
import { xFeedUrl } from "../shared/x.js";
import type { FeedRecord, ParsedFeed } from "./features/shared.js";
import { fetchFeed } from "./feed-http.js";
import { parseAndNormalizeFeed, parseAndNormalizeWordPressPosts } from "./feed-parser.js";
import { parseAndNormalizeTelegramFeed, telegramChannelUrls } from "./telegram-feed.js";
import { WebFeedError, type WebFeedService } from "./web-feed.js";
import { fetchXFeed, nitterBaseUrls, XFeedError } from "./x-feed.js";

export interface LoadedFeedSource {
  httpStatus: number | null;
  etag: string | null;
  lastModified: string | null;
  parsed?: ParsedFeed;
  webMatchCount?: number;
}

export interface FeedSourceLoader {
  load(feed: FeedRecord): Promise<LoadedFeedSource>;
}

export class FeedSourceError extends Error {
  constructor(
    message: string,
    readonly failure: {
      httpStatus: number | null;
      errorKind: FeedErrorKind;
      healthStatus: FeedHealthStatus;
    },
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "FeedSourceError";
  }
}

const USER_AGENT = "feedfold/0.1 (+self-hosted feed reader)";

class FeedHttpError extends Error {
  constructor(
    readonly status: number,
    detail?: string,
    readonly kind: FeedErrorKind = status === 401 || status === 403 ? "inaccessible" : "http",
  ) {
    super(detail ?? `The feed returned HTTP ${status}.`);
  }
}

function browserVerificationProvider(response: Response, source: string | null): string | null {
  if (response.headers.get("cf-mitigated") === "challenge") return "Cloudflare";
  if (response.headers.get("x-vercel-mitigated") === "challenge") return "Vercel";
  if (
    source?.includes("Imunify360 bot-protection") ||
    (source?.includes("One moment, please") &&
      source.includes("Please wait while your request is being verified"))
  ) {
    return "Imunify360";
  }
  return null;
}

function wordpressPostsUrl(feedUrl: string): string | null {
  const url = new URL(feedUrl);
  if (url.pathname.replace(/\/+$/, "") !== "/feed" && url.searchParams.get("feed") !== "rss2") {
    return null;
  }
  url.pathname = "/wp-json/wp/v2/posts";
  url.search = new URLSearchParams({
    per_page: "20",
    _fields: "id,guid,date_gmt,link,title,excerpt,content",
  }).toString();
  url.hash = "";
  return url.toString();
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

function failureDetails(
  error: unknown,
  sourceKind: FeedRecord["sourceKind"],
  httpStatus: number | null,
): {
  httpStatus: number | null;
  errorKind: FeedErrorKind;
  healthStatus: FeedHealthStatus;
} {
  if (sourceKind === "web" && error instanceof WebFeedError) {
    return {
      httpStatus: error.httpStatus ?? httpStatus,
      errorKind: error.kind,
      healthStatus: error.kind === "selection_broken" ? "needs_attention" : "failing",
    };
  }
  if (error instanceof FeedHttpError || error instanceof XFeedError) {
    return { httpStatus: error.status, errorKind: error.kind, healthStatus: "failing" };
  }
  if (
    error instanceof DOMException &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  ) {
    return { httpStatus, errorKind: "timeout", healthStatus: "failing" };
  }
  return {
    httpStatus,
    errorKind: httpStatus === null ? "network" : "parse",
    healthStatus: "failing",
  };
}

export class DefaultFeedSourceLoader implements FeedSourceLoader {
  constructor(
    private readonly runOutbound: <T>(task: () => Promise<T>) => Promise<T>,
    private readonly timeoutMs = 15_000,
    private readonly webFeedService?: WebFeedService,
    private readonly feedFetcher: typeof fetchFeed = fetchFeed,
  ) {
    nitterBaseUrls();
  }

  async load(feed: FeedRecord): Promise<LoadedFeedSource> {
    let httpStatus: number | null = null;
    try {
      if (feed.sourceKind === "web") {
        if (!this.webFeedService) {
          throw new WebFeedError(
            "Web feed loading is unavailable. Check the server's Chromium setup.",
            "unsupported_content",
          );
        }
        const result = await this.webFeedService.extract(feed.webConfig);
        httpStatus = result.httpStatus;
        return {
          httpStatus: result.httpStatus,
          etag: null,
          lastModified: null,
          parsed: result.parsed,
          webMatchCount: result.matchCount,
        };
      }

      const xUrl = xFeedUrl(feed.feedUrl, nitterBaseUrls());
      if (xUrl) {
        const parsed = await fetchXFeed(xUrl, this.timeoutMs, this.feedFetcher, (task) =>
          this.runOutbound(task),
        );
        return {
          httpStatus: 200,
          etag: null,
          lastModified: null,
          parsed,
        };
      }
      const telegram = telegramChannelUrls(feed.feedUrl);
      const sourceUrl = telegram?.previewUrl ?? feed.feedUrl;
      const headers = new Headers({
        Accept:
          "application/atom+xml,application/rss+xml,application/feed+json,application/json;q=0.9,application/xml;q=0.8,text/xml;q=0.8,*/*;q=0.5",
        "User-Agent": USER_AGENT,
      });
      if (feed.etag) headers.set("If-None-Match", feed.etag);
      if (feed.lastModified) headers.set("If-Modified-Since", feed.lastModified);
      let response = await this.runOutbound(() =>
        this.feedFetcher(sourceUrl, {
          headers,
          redirect: "follow",
          signal: AbortSignal.timeout(this.timeoutMs),
        }),
      );
      httpStatus = response.status;
      if (response.status === 304) {
        return {
          httpStatus: response.status,
          etag: response.headers.get("etag"),
          lastModified: response.headers.get("last-modified"),
        };
      }
      let source = response.ok ? await response.text() : null;
      const verificationProvider = browserVerificationProvider(response, source);
      let parsed: ParsedFeed | null = null;
      if (verificationProvider || response.status === 415) {
        const fallback = await this.fetchWordPressPosts(feed, response.url || feed.feedUrl);
        if (fallback) {
          response = fallback.response;
          httpStatus = response.status;
          parsed = fallback.parsed;
          source = null;
        } else if (verificationProvider) {
          throw new FeedHttpError(
            response.status,
            `This feed requires browser verification from ${verificationProvider}, so feedfold cannot refresh it automatically.`,
            "access_blocked",
          );
        }
      }
      if (!parsed) {
        if (!response.ok) throw new FeedHttpError(response.status);
        const feedSource = source ?? (await response.text());
        parsed = telegram
          ? parseAndNormalizeTelegramFeed(feedSource, telegram.channelUrl)
          : parseAndNormalizeFeed(feedSource, response.url || sourceUrl);
      }
      return {
        httpStatus: response.status,
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
        parsed,
      };
    } catch (error) {
      const failure = failureDetails(error, feed.sourceKind, httpStatus);
      throw new FeedSourceError(message(error), failure, { cause: error });
    }
  }

  private async fetchWordPressPosts(
    feed: FeedRecord,
    feedUrl: string,
  ): Promise<{ response: Response; parsed: ParsedFeed } | null> {
    const url = wordpressPostsUrl(feedUrl);
    if (!url) return null;
    const response = await this.runOutbound(() =>
      this.feedFetcher(url, {
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
        redirect: "follow",
        signal: AbortSignal.timeout(this.timeoutMs),
      }),
    );
    if (!response.ok) return null;
    return {
      response,
      parsed: parseAndNormalizeWordPressPosts(await response.text(), feedUrl, feed.title),
    };
  }
}
