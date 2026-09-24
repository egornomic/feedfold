import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import {
  deploymentPolicy,
  type ResourceQuotas,
  registrationAccountCap,
  registrationMode,
} from "./deployment-policy.js";
import { AuthService } from "./features/auth/service.js";
import { youtubeConfiguration } from "./features/youtube/config.js";
import { YouTubeService } from "./features/youtube/service.js";
import { productionListenMessage, productionLogger } from "./logging.js";
import { createApplicationRuntime } from "./runtime/application-runtime.js";
import { positiveInteger, runtimeConfiguration } from "./runtime/configuration.js";

function quotaOverrides(environment: NodeJS.ProcessEnv): Partial<ResourceQuotas> {
  const overrides: Partial<ResourceQuotas> = {};
  const read = (key: keyof ResourceQuotas, name: string): void => {
    const value = environment[name];
    if (value !== undefined) overrides[key] = positiveInteger(value, 1, name);
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

function configuredPublicOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const origin = new URL(value);
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new Error("FEEDFOLD_PUBLIC_ORIGIN must be an http(s) origin without a path");
  }
  if (
    origin.protocol !== "https:" &&
    origin.hostname !== "localhost" &&
    origin.hostname !== "127.0.0.1" &&
    origin.hostname !== "::1"
  ) {
    throw new Error("FEEDFOLD_PUBLIC_ORIGIN must use HTTPS unless it is localhost");
  }
  return origin.origin;
}

const host = process.env.HOST ?? "127.0.0.1";
const port = positiveInteger(process.env.PORT, 3000, "PORT");
const configuredDatabasePath = process.env.DATABASE_PATH;
const databasePath = resolve(configuredDatabasePath ?? "./data/feedfold.db");
const configuration = runtimeConfiguration(process.env);
const staticDir = fileURLToPath(new URL("../client", import.meta.url));
const demoDir = fileURLToPath(new URL("../demo", import.meta.url));
const publicOrigin = configuredPublicOrigin(process.env.FEEDFOLD_PUBLIC_ORIGIN);
const policy = deploymentPolicy(process.env.FEEDFOLD_DEPLOYMENT_MODE, quotaOverrides(process.env));
const registrationCooldownMinutes = positiveInteger(
  process.env.FEEDFOLD_REGISTRATION_COOLDOWN_MINUTES,
  60,
  "FEEDFOLD_REGISTRATION_COOLDOWN_MINUTES",
);
const loginCooldownMinutes = positiveInteger(
  process.env.FEEDFOLD_LOGIN_COOLDOWN_MINUTES,
  15,
  "FEEDFOLD_LOGIN_COOLDOWN_MINUTES",
);
const stepUpCooldownMinutes = positiveInteger(
  process.env.FEEDFOLD_STEP_UP_COOLDOWN_MINUTES,
  15,
  "FEEDFOLD_STEP_UP_COOLDOWN_MINUTES",
);

const runtime = createApplicationRuntime({
  databasePath,
  configuration,
  deploymentPolicy: policy,
  credentialCipher: null,
});
const { database } = runtime.services;
const authService = new AuthService(database.auth, configuration.pollIntervalMinutes, {
  maxAccounts: registrationAccountCap(policy, process.env.FEEDFOLD_MAX_ACCOUNTS),
  registrationMode: registrationMode(policy, process.env.FEEDFOLD_REGISTRATION_MODE),
  recentAuthenticationSeconds: positiveInteger(
    process.env.FEEDFOLD_RECENT_AUTH_SECONDS,
    300,
    "FEEDFOLD_RECENT_AUTH_SECONDS",
  ),
  rateLimits: {
    registrationPerIp: {
      attempts: positiveInteger(
        process.env.FEEDFOLD_REGISTRATION_IP_LIMIT,
        10,
        "FEEDFOLD_REGISTRATION_IP_LIMIT",
      ),
      windowMs: registrationCooldownMinutes * 60_000,
    },
    registrationGlobal: {
      attempts: positiveInteger(
        process.env.FEEDFOLD_REGISTRATION_GLOBAL_LIMIT,
        100,
        "FEEDFOLD_REGISTRATION_GLOBAL_LIMIT",
      ),
      windowMs: registrationCooldownMinutes * 60_000,
    },
    loginPerIp: {
      attempts: positiveInteger(process.env.FEEDFOLD_LOGIN_IP_LIMIT, 50, "FEEDFOLD_LOGIN_IP_LIMIT"),
      windowMs: loginCooldownMinutes * 60_000,
    },
    loginPerAccount: {
      attempts: positiveInteger(
        process.env.FEEDFOLD_LOGIN_ACCOUNT_LIMIT,
        10,
        "FEEDFOLD_LOGIN_ACCOUNT_LIMIT",
      ),
      windowMs: loginCooldownMinutes * 60_000,
    },
    stepUp: {
      attempts: positiveInteger(process.env.FEEDFOLD_STEP_UP_LIMIT, 10, "FEEDFOLD_STEP_UP_LIMIT"),
      windowMs: stepUpCooldownMinutes * 60_000,
    },
  },
});
const youtubeConfig = youtubeConfiguration(process.env, publicOrigin);
const youtubeService = youtubeConfig
  ? new YouTubeService(database, runtime.services.refreshService, youtubeConfig)
  : undefined;
const app = await createApp({
  ...(youtubeService ? { youtubeService } : {}),
  ...runtime.services,
  authService,
  staticDir,
  demoDir,
  logger: process.env.NODE_ENV === "production" ? productionLogger() : false,
  ...(publicOrigin === undefined ? {} : { publicOrigin }),
});

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "Stopping feedfold");
  try {
    await app.close();
    await runtime.close();
  } catch {
    app.log.error({ event: "shutdown_failed" }, "feedfold did not shut down cleanly");
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  runtime.start();
  await app.listen({ host, port, listenTextResolver: productionListenMessage });
} catch {
  app.log.error({ event: "startup_failed" }, "feedfold failed to start");
  await runtime.close();
  process.exitCode = 1;
}
