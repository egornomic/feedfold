import type { RegistrationMode } from "../shared/types.js";

export interface ResourceQuotas {
  feedDiscoveriesPerDay: number | null;
  webAnalysesPerDay: number | null;
  chromiumConcurrent: number | null;
  articleExtractionsPerDay: number | null;
  articleExtractionsConcurrent: number | null;
  mediaProxyRequestsPerDay: number | null;
  opmlUploadBytes: number | null;
  opmlFeedsPerImport: number | null;
  articlesPerAccount: number | null;
  storedBytesPerAccount: number | null;
  outboundRequestsConcurrent: number | null;
  outboundRequestsPerDay: number | null;
  registeredAccounts: number | null;
  globalStoredBytes: number | null;
}

export interface ServicePolicy {
  manualRefresh: boolean;
  accountActivityWindowDays: number | null;
  maxFeedsPerAccount: number | null;
  maxWebFeedsPerAccount: number | null;
  maxPendingRefreshes: number | null;
  quotas: ResourceQuotas;
}

const UNLIMITED_QUOTAS: ResourceQuotas = {
  feedDiscoveriesPerDay: null,
  webAnalysesPerDay: null,
  chromiumConcurrent: null,
  articleExtractionsPerDay: null,
  articleExtractionsConcurrent: null,
  mediaProxyRequestsPerDay: null,
  opmlUploadBytes: null,
  opmlFeedsPerImport: null,
  articlesPerAccount: null,
  storedBytesPerAccount: null,
  outboundRequestsConcurrent: null,
  outboundRequestsPerDay: null,
  registeredAccounts: null,
  globalStoredBytes: null,
};

const DEFAULT_RESOURCE_QUOTAS: ResourceQuotas = {
  feedDiscoveriesPerDay: 100,
  webAnalysesPerDay: 20,
  chromiumConcurrent: 2,
  articleExtractionsPerDay: 200,
  articleExtractionsConcurrent: 4,
  mediaProxyRequestsPerDay: 1_000,
  opmlUploadBytes: 1_048_576,
  opmlFeedsPerImport: 300,
  articlesPerAccount: 50_000,
  storedBytesPerAccount: 536_870_912,
  outboundRequestsConcurrent: 20,
  outboundRequestsPerDay: 50_000,
  registeredAccounts: 1_000,
  globalStoredBytes: 21_474_836_480,
};

export const DESKTOP_POLICY: ServicePolicy = {
  manualRefresh: true,
  accountActivityWindowDays: null,
  maxFeedsPerAccount: null,
  maxWebFeedsPerAccount: null,
  maxPendingRefreshes: null,
  quotas: UNLIMITED_QUOTAS,
};

export const DEFAULT_SERVER_POLICY: ServicePolicy = {
  manualRefresh: false,
  accountActivityWindowDays: 7,
  maxFeedsPerAccount: 300,
  maxWebFeedsPerAccount: 10,
  maxPendingRefreshes: 2_000,
  quotas: DEFAULT_RESOURCE_QUOTAS,
};

function optionalLimit(
  value: string | undefined,
  fallback: number | null,
  name: string,
): number | null {
  if (value === undefined) return fallback;
  if (value === "unlimited") return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer or unlimited`);
  }
  return parsed;
}

function quotaOverrides(environment: NodeJS.ProcessEnv): Partial<ResourceQuotas> {
  const overrides: Partial<ResourceQuotas> = {};
  const read = (key: keyof ResourceQuotas, name: string): void => {
    const value = environment[name];
    if (value !== undefined) overrides[key] = optionalLimit(value, null, name);
  };
  read("feedDiscoveriesPerDay", "FEEDFOLD_QUOTA_FEED_DISCOVERIES_PER_DAY");
  read("webAnalysesPerDay", "FEEDFOLD_QUOTA_WEB_ANALYSES_PER_DAY");
  read("chromiumConcurrent", "FEEDFOLD_QUOTA_CHROMIUM_CONCURRENT");
  read("articleExtractionsPerDay", "FEEDFOLD_QUOTA_ARTICLE_EXTRACTIONS_PER_DAY");
  read("articleExtractionsConcurrent", "FEEDFOLD_QUOTA_ARTICLE_EXTRACTIONS_CONCURRENT");
  read("mediaProxyRequestsPerDay", "FEEDFOLD_QUOTA_MEDIA_PROXY_REQUESTS_PER_DAY");
  read("opmlUploadBytes", "FEEDFOLD_QUOTA_OPML_UPLOAD_BYTES");
  read("opmlFeedsPerImport", "FEEDFOLD_QUOTA_OPML_FEEDS_PER_IMPORT");
  read("articlesPerAccount", "FEEDFOLD_QUOTA_ARTICLES_PER_ACCOUNT");
  read("storedBytesPerAccount", "FEEDFOLD_QUOTA_STORED_BYTES_PER_ACCOUNT");
  read("outboundRequestsConcurrent", "FEEDFOLD_QUOTA_OUTBOUND_REQUESTS_CONCURRENT");
  read("outboundRequestsPerDay", "FEEDFOLD_QUOTA_OUTBOUND_REQUESTS_PER_DAY");
  read("registeredAccounts", "FEEDFOLD_QUOTA_REGISTERED_ACCOUNTS");
  read("globalStoredBytes", "FEEDFOLD_QUOTA_GLOBAL_STORED_BYTES");
  return overrides;
}

export function serverPolicy(environment: NodeJS.ProcessEnv): ServicePolicy {
  const manualRefresh = environment.FEEDFOLD_MANUAL_REFRESH;
  if (manualRefresh !== undefined && manualRefresh !== "true" && manualRefresh !== "false") {
    throw new Error("FEEDFOLD_MANUAL_REFRESH must be true or false");
  }
  return {
    manualRefresh: manualRefresh === "true",
    accountActivityWindowDays: optionalLimit(
      environment.FEEDFOLD_ACCOUNT_ACTIVITY_WINDOW_DAYS,
      DEFAULT_SERVER_POLICY.accountActivityWindowDays,
      "FEEDFOLD_ACCOUNT_ACTIVITY_WINDOW_DAYS",
    ),
    maxFeedsPerAccount: optionalLimit(
      environment.FEEDFOLD_MAX_FEEDS_PER_ACCOUNT,
      DEFAULT_SERVER_POLICY.maxFeedsPerAccount,
      "FEEDFOLD_MAX_FEEDS_PER_ACCOUNT",
    ),
    maxWebFeedsPerAccount: optionalLimit(
      environment.FEEDFOLD_MAX_WEB_FEEDS_PER_ACCOUNT,
      DEFAULT_SERVER_POLICY.maxWebFeedsPerAccount,
      "FEEDFOLD_MAX_WEB_FEEDS_PER_ACCOUNT",
    ),
    maxPendingRefreshes: optionalLimit(
      environment.FEEDFOLD_MAX_PENDING_REFRESHES,
      DEFAULT_SERVER_POLICY.maxPendingRefreshes,
      "FEEDFOLD_MAX_PENDING_REFRESHES",
    ),
    quotas: { ...DEFAULT_RESOURCE_QUOTAS, ...quotaOverrides(environment) },
  };
}

export function registrationAccountCap(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export function registrationMode(value?: string): RegistrationMode {
  if (value !== undefined && value !== "closed" && value !== "invite" && value !== "open") {
    throw new Error("FEEDFOLD_REGISTRATION_MODE must be closed, invite, or open");
  }
  return value ?? "closed";
}
