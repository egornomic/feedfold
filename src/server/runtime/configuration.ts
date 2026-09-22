export function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function runtimeConfiguration(environment: NodeJS.ProcessEnv) {
  return {
    pollIntervalMinutes: positiveInteger(
      environment.POLL_INTERVAL_MINUTES,
      20,
      "POLL_INTERVAL_MINUTES",
    ),
    feedFetchTimeoutMs: positiveInteger(
      environment.FEED_FETCH_TIMEOUT_MS,
      15_000,
      "FEED_FETCH_TIMEOUT_MS",
    ),
    webFeedLoadTimeoutMs: positiveInteger(
      environment.WEB_FEED_LOAD_TIMEOUT_MS,
      30_000,
      "WEB_FEED_LOAD_TIMEOUT_MS",
    ),
    articleFetchTimeoutMs: positiveInteger(
      environment.ARTICLE_FETCH_TIMEOUT_MS,
      20_000,
      "ARTICLE_FETCH_TIMEOUT_MS",
    ),
    aiRequestTimeoutMs: positiveInteger(
      environment.AI_REQUEST_TIMEOUT_MS,
      60_000,
      "AI_REQUEST_TIMEOUT_MS",
    ),
  };
}

export type RuntimeConfiguration = ReturnType<typeof runtimeConfiguration>;
