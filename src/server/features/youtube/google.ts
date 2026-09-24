import { z } from "zod";
import { ApplicationApiError } from "../../errors.js";
import type { YouTubeConfig } from "./config.js";

export const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
const channelId = z.string().regex(/^UC[\w-]{22}$/);
const tokenResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
});
const subscriptionPage = z.object({
  items: z.array(
    z.object({
      snippet: z.object({
        title: z.string(),
        resourceId: z.object({ channelId }),
      }),
    }),
  ),
  nextPageToken: z.string().min(1).optional(),
});
const channelsResponse = z.object({
  items: z.array(z.object({ id: channelId, snippet: z.object({ title: z.string() }) })),
});

export interface YouTubeChannel {
  id: string;
  title: string;
}

export class GoogleAccessExpired extends ApplicationApiError {
  constructor() {
    super(409, "Google access expired. Reconnect YouTube to resume sync.");
  }
}

export class YouTubeGoogleClient {
  constructor(
    private readonly config: YouTubeConfig,
    private readonly runOutbound: <T>(task: () => Promise<T>) => Promise<T> = (task) => task(),
  ) {}

  private async request(url: string, init: RequestInit): Promise<Response> {
    return this.runOutbound(() =>
      fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(20_000) }),
    );
  }

  private async token(parameters: Record<string, string>) {
    const response = await this.request("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        ...parameters,
      }),
    });
    if (!response.ok) {
      const result = (await response.json()) as { error?: string };
      if (result.error === "invalid_grant") throw new GoogleAccessExpired();
      throw new ApplicationApiError(502, "Google could not authorize this connection. Try again.");
    }
    return tokenResponse.parse(await response.json());
  }

  exchange(code: string, verifier: string) {
    return this.token({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: this.config.redirectUri,
    });
  }

  refresh(refreshToken: string) {
    return this.token({ grant_type: "refresh_token", refresh_token: refreshToken });
  }

  private async get(
    path: string,
    parameters: Record<string, string>,
    accessToken: string,
  ): Promise<unknown> {
    const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
    url.search = new URLSearchParams(parameters).toString();
    const response = await this.request(url.href, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.status === 401) throw new GoogleAccessExpired();
    if (!response.ok)
      throw new ApplicationApiError(
        502,
        "YouTube could not complete the sync. Your feeds have not changed. Try again later.",
      );
    return response.json();
  }

  async channel(accessToken: string): Promise<YouTubeChannel> {
    const result = channelsResponse.parse(
      await this.get(
        "channels",
        { part: "snippet", mine: "true", fields: "items(id,snippet/title)" },
        accessToken,
      ),
    );
    const channel = result.items[0];
    if (!channel)
      throw new ApplicationApiError(
        400,
        "This Google account has no YouTube channel. Choose an account with YouTube subscriptions.",
      );
    return { id: channel.id, title: channel.snippet.title };
  }

  async subscriptions(accessToken: string): Promise<YouTubeChannel[]> {
    const channels = new Map<string, YouTubeChannel>();
    const pages = new Set<string>();
    let pageToken: string | undefined;
    do {
      const result = subscriptionPage.parse(
        await this.get(
          "subscriptions",
          {
            part: "snippet",
            mine: "true",
            maxResults: "50",
            fields: "nextPageToken,items/snippet(title,resourceId/channelId)",
            ...(pageToken ? { pageToken } : {}),
          },
          accessToken,
        ),
      );
      for (const { snippet } of result.items)
        channels.set(snippet.resourceId.channelId, {
          id: snippet.resourceId.channelId,
          title: snippet.title,
        });
      pageToken = result.nextPageToken;
      if (pageToken && pages.has(pageToken))
        throw new ApplicationApiError(
          502,
          "YouTube returned an incomplete list. Your feeds have not changed.",
        );
      if (pageToken) pages.add(pageToken);
    } while (pageToken);
    return [...channels.values()];
  }

  async revoke(token: string): Promise<void> {
    const response = await this.request("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      body: new URLSearchParams({ token }),
    });
    // Google returns invalid_token when access has already been revoked.
    if (!response.ok) {
      const body = (await response.json()) as { error?: string };
      if (response.status === 400 && body.error === "invalid_token") return;
      throw new ApplicationApiError(502, "Google could not disconnect YouTube. Try again.");
    }
  }
}
