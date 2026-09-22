import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { AppDatabase } from "../database.js";
import { type DeploymentPolicy, PRIVATE_DEPLOYMENT_POLICY } from "../deployment-policy.js";
import type { CredentialCipherLike } from "../features/ai/credential-cipher.js";
import { AiService } from "../features/ai/service.js";
import { ExtractionQueue } from "../features/extraction/queue.js";
import { WebFeedService, type WebFeedServiceOptions } from "../features/feeds/web/service.js";
import { FeedRefreshService } from "../features/refresh/service.js";
import { DefaultFeedSourceLoader } from "../feed-source-loader.js";
import { closePublicNetwork } from "../public-network.js";
import { TelegramMediaService } from "../telegram-media.js";
import { XMediaService } from "../x-media.js";
import { type RuntimeConfiguration, runtimeConfiguration } from "./configuration.js";

export interface ApplicationServicesOptions {
  database: AppDatabase;
  credentialCipher: CredentialCipherLike | null;
  configuration?: RuntimeConfiguration;
  webFeed?: Omit<WebFeedServiceOptions, "quotas" | "timeoutMs">;
  extractionQueue?: ExtractionQueue;
  refreshService?: FeedRefreshService;
  webFeedService?: WebFeedService;
  aiService?: AiService;
  telegramMediaService?: TelegramMediaService;
  xMediaService?: XMediaService;
  feedDiscoveryTimeoutMs?: number;
}

/** Builds services for an existing database; the caller owns their lifetime. */
export function createApplicationServices({
  database,
  credentialCipher,
  configuration = runtimeConfiguration({}),
  extractionQueue = new ExtractionQueue(
    database.extractions,
    2,
    configuration.articleFetchTimeoutMs,
  ),
  webFeed,
  webFeedService = new WebFeedService({
    ...webFeed,
    timeoutMs: configuration.webFeedLoadTimeoutMs,
    quotas: database.quotas,
  }),
  refreshService = new FeedRefreshService(
    database.feeds,
    new DefaultFeedSourceLoader(
      (task) => database.feeds.runOutbound(task),
      configuration.feedFetchTimeoutMs,
      webFeedService,
    ),
    3,
  ),
  aiService = new AiService(database, {
    credentialCipher,
    requestTimeoutMs: configuration.aiRequestTimeoutMs,
  }),
  feedDiscoveryTimeoutMs = configuration.feedFetchTimeoutMs,
  telegramMediaService = new TelegramMediaService(
    feedDiscoveryTimeoutMs,
    undefined,
    database.quotas,
  ),
  xMediaService = new XMediaService(feedDiscoveryTimeoutMs, undefined, database.quotas),
}: ApplicationServicesOptions) {
  return {
    database,
    extractionQueue,
    webFeedService,
    refreshService,
    aiService,
    telegramMediaService,
    xMediaService,
    feedDiscoveryTimeoutMs,
  };
}

export interface ApplicationRuntimeOptions {
  databasePath: string;
  configuration: RuntimeConfiguration;
  credentialCipher: CredentialCipherLike | null;
  deploymentPolicy?: DeploymentPolicy;
  webFeed?: Omit<WebFeedServiceOptions, "quotas" | "timeoutMs">;
}

/** Owns the application services and their process lifetime in either host. */
export function createApplicationRuntime({
  databasePath,
  configuration,
  credentialCipher,
  deploymentPolicy = PRIVATE_DEPLOYMENT_POLICY,
  webFeed,
}: ApplicationRuntimeOptions) {
  mkdirSync(dirname(databasePath), { recursive: true });
  const database = new AppDatabase(
    databasePath,
    configuration.pollIntervalMinutes,
    deploymentPolicy,
  );
  const services = createApplicationServices({
    database,
    configuration,
    credentialCipher,
    webFeed,
  });
  const { extractionQueue, refreshService, webFeedService } = services;

  return {
    services,
    start(): void {
      extractionQueue.start();
      refreshService.start();
    },
    async close(): Promise<void> {
      await Promise.all([refreshService.stop(), extractionQueue.stop()]);
      await webFeedService.close();
      await closePublicNetwork();
      database.close();
    },
  };
}
