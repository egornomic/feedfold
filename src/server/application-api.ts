import { z } from "zod";
import { resourceId as id, inputs } from "../shared/api/inputs.js";
import type { ApiOperation, ApiOutput, UntrustedApiRequest } from "../shared/api/operations.js";
import { readerMutationRoutes } from "../shared/reader-mutations.js";
import type { MarkReadRequest } from "../shared/types.js";
import { accountActivityTouchBefore } from "./account-activity.js";
import { ApplicationService, type ApplicationServices } from "./application-service.js";
import type { AppDatabase } from "./database.js";
import { ApplicationApiError, requireResource as notFound } from "./errors.js";
import type { AiService } from "./features/ai/service.js";
import type { WebFeedService } from "./features/feeds/web/service.js";
import type { FeedRefreshService } from "./features/refresh/service.js";

function macOsAuthentication(): never {
  throw new ApplicationApiError(400, "Account authentication is managed by macOS.");
}

export const LOCAL_USER_ID = 1;
const LOCAL_USER = { id: "local", username: "On this Mac", hasPassword: false } as const;

function input<T>(schema: z.ZodType<T>, payload: unknown): T {
  return schema.parse(payload);
}

export interface ApplicationApiServices extends ApplicationServices {
  webFeedService: WebFeedService;
}

/**
 * The single-user application boundary used by local desktop transports.
 * It intentionally has no HTTP, cookies, or account lifecycle.
 */
export class ApplicationApi {
  readonly #refreshService: FeedRefreshService;
  readonly #application: ApplicationService;
  readonly #database: AppDatabase;
  readonly #webFeedService: WebFeedService;
  readonly #ai: AiService;
  readonly #userId = LOCAL_USER_ID;

  constructor(services: ApplicationApiServices) {
    this.#database = services.database;
    this.#refreshService = services.refreshService;
    this.#application = new ApplicationService(services);
    this.#webFeedService = services.webFeedService;
    this.#ai = services.aiService;
  }

  async invoke<K extends ApiOperation>(
    request: UntrustedApiRequest & { operation: K },
  ): Promise<ApiOutput<K>> {
    const result = await this.#execute(request);
    if (Object.hasOwn(readerMutationRoutes, request.operation)) {
      this.#refreshService.notifyDataChanged(this.#userId);
    }
    return result;
  }

  async #execute<K extends ApiOperation>(
    request: UntrustedApiRequest & { operation: K },
  ): Promise<ApiOutput<K>> {
    const activityAt = new Date().toISOString();
    this.#database.auth.touchUserActivity(
      this.#userId,
      activityAt,
      accountActivityTouchBefore(activityAt),
    );
    return this.#handlers[request.operation](request.payload);
  }

  readonly #handlers: { [K in ApiOperation]: (payload: unknown) => Promise<ApiOutput<K>> } = {
    session: async () => {
      return { user: LOCAL_USER };
    },
    login: async () => {
      return { user: LOCAL_USER };
    },
    register: async () => {
      return { user: LOCAL_USER };
    },
    logout: async () => {
      return undefined;
    },
    authConfig: async () => {
      return {
        registrationAvailable: false,
        registrationMode: "closed",
        passkeysAvailable: false,
      };
    },
    invitations: async () => {
      return {
        enabled: false,
        allowance: { kind: "limited", remaining: 0 },
        invitations: [],
      };
    },
    passkeys: async () => {
      return { passkeys: [], hasPassword: false };
    },
    createInvitation: async () => macOsAuthentication(),
    revokeInvitation: async () => macOsAuthentication(),
    changePassword: async () => macOsAuthentication(),
    removePassword: async () => macOsAuthentication(),
    deleteAccount: async () => macOsAuthentication(),
    passkeySignupOptions: async () => macOsAuthentication(),
    completePasskeySignup: async () => macOsAuthentication(),
    stepUpPassword: async () => macOsAuthentication(),
    stepUpPasskeyOptions: async () => macOsAuthentication(),
    stepUpPasskey: async () => macOsAuthentication(),
    passkeyRegistrationOptions: async () => macOsAuthentication(),
    registerPasskey: async () => macOsAuthentication(),
    renamePasskey: async () => macOsAuthentication(),
    deletePasskey: async () => macOsAuthentication(),
    passkeyAuthenticationOptions: async () => macOsAuthentication(),
    passkeyLogin: async () => macOsAuthentication(),
    bootstrap: async () => {
      return this.#application.bootstrap(this.#userId);
    },
    articles: async (payload) => {
      return this.#database.articles.listArticlePage(this.#userId, inputs.articles.parse(payload));
    },
    article: async (payload) => {
      const body = input(z.object({ id }).strict(), payload);
      return notFound(this.#database.articles.getArticle(this.#userId, body.id), "Article");
    },
    telegramArticleMedia: async (payload) => {
      const body = input(z.object({ id }).strict(), payload);
      const items = await this.#application.telegramItems(this.#userId, body.id);
      return {
        items: items.map((item) => ({
          kind: item.kind,
          sourceUrl: item.url,
          posterUrl: item.kind === "video" ? item.posterUrl : null,
          aspectRatio: item.aspectRatio,
        })),
      };
    },
    xArticleMedia: async (payload) => {
      const body = input(
        z.object({ id, postId: z.string().regex(/^\d{1,30}$/) }).strict(),
        payload,
      );
      const media = await this.#application.xMedia(this.#userId, body.id, body.postId);
      return {
        sourceUrl: media.url,
        posterUrl: media.posterUrl,
        aspectRatio: media.aspectRatio,
      };
    },
    loadFullContent: async (payload) => {
      const body = input(z.object({ id }).strict(), payload);
      return notFound(this.#application.loadFullContent(this.#userId, body.id), "Article");
    },
    summarizeArticle: async (payload) => {
      const body = input(inputs.summarizeArticle.extend({ id }), payload);
      return notFound(
        await this.#ai.summarizeArticle(this.#userId, body.id, body.promptId, body.regenerate),
        "Article",
      );
    },
    translateArticle: async (payload) => {
      const body = input(inputs.translateArticle.extend({ id }), payload);
      return notFound(
        await this.#ai.translateArticle(this.#userId, body.id, body.sourceKind),
        "Article",
      );
    },
    updateArticleState: async (payload) => {
      const body = input(z.object({ id, state: inputs.updateArticleState }).strict(), payload);
      return notFound(
        this.#database.articles.updateArticleState(this.#userId, body.id, body.state),
        "Article",
      );
    },
    markRead: async (payload) => {
      const body = inputs.markRead.parse(payload ?? {}) as MarkReadRequest;
      return { updated: this.#database.articles.markArticlesRead(this.#userId, body) };
    },
    refresh: async (payload) => {
      const body = inputs.refresh.parse(payload ?? {});
      return this.#application.refresh(this.#userId, body.feedIds);
    },
    discoverFeed: async (payload) => {
      const body = inputs.url.parse(payload);
      return this.#application.discoverFeed(this.#userId, body.url);
    },
    analyzeWebPage: async (payload) => {
      const body = inputs.url.parse(payload);
      return this.#application.analyzeWebPage(this.#userId, body.url);
    },
    createFeed: async (payload) => {
      return notFound(
        await this.#application.createFeed(this.#userId, inputs.createFeed.parse(payload)),
        "Feed",
      );
    },
    feed: async (payload) => {
      const body = input(z.object({ id }).strict(), payload);
      return notFound(this.#database.feeds.getFeed(this.#userId, body.id), "Feed");
    },
    updateFeed: async (payload) => {
      const body = input(z.object({ id, input: inputs.updateFeed }).strict(), payload);
      return notFound(this.#database.feeds.updateFeed(this.#userId, body.id, body.input), "Feed");
    },
    deleteFeed: async (payload) => {
      const body = input(z.object({ id }).strict(), payload);
      if (!this.#database.feeds.deleteFeed(this.#userId, body.id)) {
        throw new ApplicationApiError(404, "Feed was not found.");
      }
      return undefined;
    },
    analyzeWebFeed: async (payload) => {
      const body = input(z.object({ id }).strict(), payload);
      return this.#application.analyzeWebFeed(this.#userId, body.id);
    },
    updateWebFeedSelection: async (payload) => {
      const body = input(inputs.updateWebFeedSelection.extend({ id }), payload);
      return this.#application.updateWebFeedSelection(this.#userId, body.id, body.config);
    },
    createFolder: async (payload) => {
      const body = inputs.createFolder.parse(payload);
      return this.#database.folders.createFolder(this.#userId, body);
    },
    updateFolder: async (payload) => {
      const body = input(z.object({ id, input: inputs.updateFolder }).strict(), payload);
      return notFound(
        this.#database.folders.updateFolder(this.#userId, body.id, body.input),
        "Folder",
      );
    },
    deleteFolder: async (payload) => {
      const body = input(z.object({ id }).strict(), payload);
      if (!this.#database.folders.deleteFolder(this.#userId, body.id)) {
        throw new ApplicationApiError(404, "Folder was not found.");
      }
      return undefined;
    },
    rules: async () => {
      return { rules: this.#database.rules.listRules(this.#userId) };
    },
    createRule: async (payload) => {
      const body = inputs.createRule.parse(payload);
      return this.#database.rules.createRule(this.#userId, body);
    },
    updateRule: async (payload) => {
      const body = input(z.object({ id, input: inputs.updateRule }).strict(), payload);
      return notFound(this.#database.rules.updateRule(this.#userId, body.id, body.input), "Rule");
    },
    deleteRule: async (payload) => {
      const body = input(z.object({ id }).strict(), payload);
      if (!this.#database.rules.deleteRule(this.#userId, body.id)) {
        throw new ApplicationApiError(404, "Rule was not found.");
      }
      return undefined;
    },
    updateSettings: async (payload) => {
      const body = inputs.updateSettings.parse(payload);
      return this.#database.settings.updateSettings(this.#userId, body);
    },
    updateAiFeature: async (payload) => {
      const body = input(
        z
          .object({
            feature: inputs.aiFeature,
            input: inputs.updateAiFeature,
          })
          .strict(),
        payload,
      );
      return this.#ai.setFeatureSetting(
        this.#userId,
        body.feature,
        body.input.provider,
        body.input.model,
      );
    },
    saveAiProviderKey: async (payload) => {
      const body = input(inputs.saveAiProviderKey.extend({ provider: inputs.aiProvider }), payload);
      return this.#ai.setApiKey(this.#userId, body.provider, body.apiKey);
    },
    deleteAiProviderKey: async (payload) => {
      const body = input(z.object({ provider: inputs.aiProvider }).strict(), payload);
      return this.#ai.deleteApiKey(this.#userId, body.provider);
    },
    importOpml: async (payload) => {
      const body = inputs.importOpml.parse(payload);
      return this.#application.importOpml(this.#userId, body.opml);
    },
    exportOpml: async () => {
      return this.#database.opml.export(this.#userId);
    },
  };

  snapshot(id: string): string {
    return this.#webFeedService.snapshot(String(this.#userId), id);
  }

  telegramPreviewUrl(articleId: number): Promise<string> {
    return this.#application.telegramPreviewUrl(this.#userId, articleId);
  }
}
