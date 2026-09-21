import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { CredentialCipherLike } from "../ai/credential-cipher.js";
import { AppDatabase } from "../database.js";
import { type DeploymentPolicy, PRIVATE_DEPLOYMENT_POLICY } from "../deployment-policy.js";
import { ExtractionQueue } from "../extraction.js";
import { AiService } from "../features/ai/service.js";
import { DefaultFeedSourceLoader } from "../feed-source-loader.js";
import { closePublicNetwork } from "../public-network.js";
import { FeedRefreshService } from "../refresh.js";
import { TelegramMediaService } from "../telegram-media.js";
import { WebFeedService, type WebFeedServiceOptions } from "../web-feed.js";
import { XMediaService } from "../x-media.js";
import type { RuntimeConfiguration } from "./configuration.js";

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
  const extractionQueue = new ExtractionQueue(
    database.extractions,
    2,
    configuration.articleFetchTimeoutMs,
  );
  const webFeedService = new WebFeedService({
    ...webFeed,
    timeoutMs: configuration.webFeedLoadTimeoutMs,
    quotas: database.quotas,
  });
  const refreshService = new FeedRefreshService(
    database.feeds,
    new DefaultFeedSourceLoader(
      (task) => database.feeds.runOutbound(task),
      configuration.feedFetchTimeoutMs,
      webFeedService,
    ),
    3,
  );
  const aiService = new AiService(database, {
    credentialCipher,
    requestTimeoutMs: configuration.aiRequestTimeoutMs,
  });
  const services = {
    database,
    extractionQueue,
    webFeedService,
    refreshService,
    aiService,
    telegramMediaService: new TelegramMediaService(
      configuration.feedFetchTimeoutMs,
      undefined,
      database.quotas,
    ),
    xMediaService: new XMediaService(configuration.feedFetchTimeoutMs, undefined, database.quotas),
    feedDiscoveryTimeoutMs: configuration.feedFetchTimeoutMs,
  };

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
