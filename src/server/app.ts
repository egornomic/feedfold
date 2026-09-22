import { existsSync } from "node:fs";
import { join } from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type FastifyServerOptions,
  LogController,
} from "fastify";
import { readerMutationRoutes } from "../shared/reader-mutations.js";
import { applicationError } from "./application-error.js";
import { ApplicationService } from "./application-service.js";
import type { AppDatabase } from "./database.js";
import { aiRoutes } from "./features/ai/routes.js";
import { AiService } from "./features/ai/service.js";
import { articleRoutes } from "./features/articles/routes.js";
import { authRoutes } from "./features/auth/routes.js";
import { type AuthService, sessionToken } from "./features/auth/service.js";
import { bootstrapRoutes } from "./features/bootstrap/routes.js";
import type { ExtractionQueue } from "./features/extraction/queue.js";
import { feedRoutes } from "./features/feeds/routes.js";
import type { WebFeedService } from "./features/feeds/web/service.js";
import { folderRoutes } from "./features/folders/routes.js";
import { opmlRoutes } from "./features/opml/routes.js";
import { refreshRoutes } from "./features/refresh/routes.js";
import type { FeedRefreshService } from "./features/refresh/service.js";
import { browserDeviceId } from "./features/routes.js";
import { ruleRoutes } from "./features/rules/routes.js";
import { settingsRoutes } from "./features/settings/routes.js";
import { registerOperationalLogging } from "./logging.js";
import { responsePolicies } from "./response-policy.js";
import { TelegramMediaService } from "./telegram-media.js";
import { XMediaService } from "./x-media.js";

export interface AppServices {
  database: AppDatabase;
  authService: AuthService;
  extractionQueue: ExtractionQueue;
  refreshService: FeedRefreshService;
  webFeedService?: WebFeedService;
  aiService?: AiService;
  telegramMediaService?: TelegramMediaService;
  xMediaService?: XMediaService;
  feedDiscoveryTimeoutMs?: number;
  staticDir?: string;
  demoDir?: string;
  logger?: FastifyServerOptions["logger"];
  publicOrigin?: string;
}

function staticHeaders(reply: FastifyReply, path: string): void {
  if (path.endsWith("sw.js") || path.endsWith("index.html")) {
    reply.header("Cache-Control", "no-cache");
  }
}

export async function createApp(services: AppServices): Promise<FastifyInstance> {
  const app = Fastify({
    logger: services.logger ?? false,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 10 * 1024 * 1024,
    trustProxy: ["loopback", "linklocal", "uniquelocal"],
  });
  registerOperationalLogging(app);
  const ai =
    services.aiService ??
    new AiService(services.database, {
      credentialCipher: null,
    });
  const telegramMedia =
    services.telegramMediaService ??
    new TelegramMediaService(
      services.feedDiscoveryTimeoutMs ?? 15_000,
      undefined,
      services.database.quotas,
    );
  const xMedia =
    services.xMediaService ??
    new XMediaService(
      services.feedDiscoveryTimeoutMs ?? 15_000,
      undefined,
      services.database.quotas,
    );
  const application = new ApplicationService({
    ...services,
    aiService: ai,
    telegramMediaService: telegramMedia,
    xMediaService: xMedia,
  });
  const requestUsers = new WeakMap<FastifyRequest, { id: number; username: string }>();
  const userId = (request: FastifyRequest): number => {
    const user = requestUsers.get(request);
    if (!user) throw new Error("Authenticated user is missing");
    return user.id;
  };

  const mutationRoutes = new Set<string>(Object.values(readerMutationRoutes));
  app.addHook("onResponse", async (request, reply) => {
    const account = requestUsers.get(request);
    if (
      account &&
      reply.statusCode >= 200 &&
      reply.statusCode < 300 &&
      mutationRoutes.has(`${request.method} ${request.routeOptions.url}`)
    ) {
      services.refreshService.notifyDataChanged(account.id);
    }
  });

  app.setErrorHandler((error, request, reply) => {
    const known = applicationError(error);
    if (known) {
      reply
        .code(known.status)
        .send({ error: known.message, ...(known.code ? { code: known.code } : {}) });
      return;
    }
    request.log.error({ event: "request_handler_failed" }, "request handler failed");
    reply.code(500).send({ error: "The server could not complete the request. Try again." });
  });

  app.get("/health", async () => {
    services.database.connection.prepare("SELECT 1").get();
    return { status: "ok" };
  });

  app.addHook("onSend", async (request, reply) => {
    reply.headers(responsePolicies[request.routeOptions.config.responsePolicy ?? "application"]);
    reply.header(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), publickey-credentials-get=(self)",
    );
    reply.header("X-Content-Type-Options", "nosniff");
    if (request.protocol === "https" || services.publicOrigin?.startsWith("https://")) {
      reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
  });

  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/")) return;
    reply.header("Cache-Control", "no-store");
    const [path = ""] = request.url.split("?", 1);
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      const expectedOrigin =
        services.publicOrigin ??
        `${request.protocol}://${request.headers.host ?? request.hostname}`;
      if (request.headers.origin && request.headers.origin !== new URL(expectedOrigin).origin) {
        return reply.code(403).send({ error: "This request is not allowed." });
      }
      if (request.headers["sec-fetch-site"] === "cross-site") {
        return reply.code(403).send({ error: "This request is not allowed." });
      }
    }
    if (
      path === "/api/auth/config" ||
      path === "/api/auth/login" ||
      path === "/api/auth/register" ||
      path === "/api/auth/register/passkey/options" ||
      path === "/api/auth/register/passkey" ||
      path === "/api/auth/session" ||
      path === "/api/auth/passkey/options" ||
      path === "/api/auth/passkey"
    )
      return;
    const user = services.authService.userForToken(sessionToken(request.headers.cookie));
    if (!user) return reply.code(401).send({ error: "Sign in to continue." });
    const browserAccount = request.headers["x-feedfold-account"];
    if (browserAccount !== undefined && browserAccount !== user.publicId) {
      return reply
        .code(401)
        .send({ error: "The signed-in account changed. Sign in again to continue." });
    }
    if (request.method === "POST" && path === "/api/auth/logout") {
      ai.deleteDeviceKeys(user.id, browserDeviceId(request));
    }
    requestUsers.set(request, user);
    const sensitive =
      (request.method === "POST" &&
        (path === "/api/auth/passkeys/options" || path === "/api/auth/passkeys")) ||
      (request.method === "DELETE" && path.startsWith("/api/auth/passkeys/")) ||
      (request.method === "DELETE" && path === "/api/auth/account") ||
      (["PUT", "DELETE"].includes(request.method) && path === "/api/auth/password") ||
      (["PUT", "DELETE"].includes(request.method) &&
        /^\/api\/ai\/providers\/[^/]+\/key$/.test(path));
    if (sensitive) {
      const recent = services.authService.beginSensitiveOperation(
        sessionToken(request.headers.cookie),
      );
      if (!recent) return reply.code(401).send({ error: "Sign in to continue." });
      if (recent.required) {
        return reply.code(428).send({
          error: "Authenticate again to continue.",
          code: "RECENT_AUTH_REQUIRED",
          operationId: recent.operationId,
        });
      }
    }
  });

  await app.register(authRoutes, {
    authService: services.authService,
    configuredOrigin: services.publicOrigin,
  });
  await app.register(bootstrapRoutes, {
    application,
    userId,
  });
  await app.register(articleRoutes, {
    articles: services.database.articles,
    application,
    ai,
    xMedia,
    userId,
  });
  await app.register(feedRoutes, {
    feeds: services.database.feeds,
    application,
    webFeedService: services.webFeedService,
    userId,
  });
  await app.register(folderRoutes, { folders: services.database.folders, userId });
  await app.register(ruleRoutes, { rules: services.database.rules, userId });
  await app.register(settingsRoutes, { settings: services.database.settings, userId });
  await app.register(aiRoutes, { ai, userId });
  await app.register(refreshRoutes, {
    application,
    refreshService: services.refreshService,
    authService: services.authService,
    userId,
  });
  await app.register(opmlRoutes, {
    opml: services.database.opml,
    application,
    userId,
  });

  if (services.staticDir && existsSync(join(services.staticDir, "index.html"))) {
    const demoDir =
      services.demoDir && existsSync(join(services.demoDir, "index.html"))
        ? services.demoDir
        : undefined;
    if (demoDir) {
      app.get("/demo", (_request, reply) => reply.redirect("/demo/", 308));
      await app.register(fastifyStatic, {
        root: demoDir,
        prefix: "/demo/",
        wildcard: false,
        decorateReply: false,
        setHeaders: staticHeaders,
      });
    }
    await app.register(fastifyStatic, {
      root: services.staticDir,
      wildcard: false,
      setHeaders: staticHeaders,
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/") || request.url === "/health") {
        return reply.code(404).send({ error: "This page does not exist." });
      }
      if (demoDir && request.url.startsWith("/demo/")) {
        return reply.sendFile("index.html", demoDir);
      }
      return reply.sendFile("index.html");
    });
  }

  return app;
}
