import { z } from "zod";
import { resourceId as id, inputs } from "../shared/api-inputs.js";
import type { DesktopRequest } from "../shared/desktop.js";
import { readerMutationRoutes } from "../shared/reader-mutations.js";
import type { MarkReadRequest } from "../shared/types.js";
import { accountActivityTouchBefore } from "./account-activity.js";
import { ApplicationService, type ApplicationServices } from "./application-service.js";
import type { AppDatabase } from "./database.js";
import { ApplicationApiError, requireResource as notFound } from "./errors.js";
import type { AiService } from "./features/ai/service.js";
import type { FeedRefreshService } from "./refresh.js";
import type { WebFeedService } from "./web-feed.js";

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
    if (this.#database.wasNewDatabase) {
      this.#database.feeds.createDefaultFeed(this.#userId);
    }
    this.#application = new ApplicationService(services);
    this.#webFeedService = services.webFeedService;
    this.#ai = services.aiService;
  }

  async invoke(request: DesktopRequest): Promise<unknown> {
    const result = await this.#execute(request);
    if (Object.hasOwn(readerMutationRoutes, request.operation)) {
      this.#refreshService.notifyDataChanged(this.#userId);
    }
    return result;
  }

  async #execute(request: DesktopRequest): Promise<unknown> {
    const activityAt = new Date().toISOString();
    this.#database.auth.touchUserActivity(
      this.#userId,
      activityAt,
      accountActivityTouchBefore(activityAt),
    );
    switch (request.operation) {
      case "session":
      case "login":
      case "register":
        return { user: LOCAL_USER };
      case "logout":
        return undefined;
      case "authConfig":
        return {
          registrationAvailable: false,
          registrationMode: "closed",
          passkeysAvailable: false,
        };
      case "invitations":
        return {
          enabled: false,
          allowance: { kind: "limited", remaining: 0 },
          invitations: [],
        };
      case "passkeys":
        return { passkeys: [] };
      case "createInvitation":
      case "revokeInvitation":
      case "changePassword":
      case "removePassword":
      case "deleteAccount":
      case "passkeySignupOptions":
      case "completePasskeySignup":
      case "stepUpPassword":
      case "stepUpPasskeyOptions":
      case "stepUpPasskey":
      case "passkeyRegistrationOptions":
      case "registerPasskey":
      case "renamePasskey":
      case "deletePasskey":
      case "passkeyAuthenticationOptions":
      case "passkeyLogin":
        throw new ApplicationApiError(400, "Account authentication is managed by macOS.");
      case "bootstrap":
        return this.#application.bootstrap(this.#userId);
      case "articles":
        return this.#database.articles.listArticlePage(
          this.#userId,
          inputs.articles.parse(request.payload),
        );
      case "article": {
        const body = input(z.object({ id }).strict(), request.payload);
        return notFound(this.#database.articles.getArticle(this.#userId, body.id), "Article");
      }
      case "telegramArticleMedia": {
        const body = input(z.object({ id }).strict(), request.payload);
        const items = await this.#application.telegramItems(this.#userId, body.id);
        return {
          items: items.map((item) => ({
            kind: item.kind,
            sourceUrl: item.url,
            posterUrl: item.kind === "video" ? item.posterUrl : null,
            aspectRatio: item.aspectRatio,
          })),
        };
      }
      case "xArticleMedia": {
        const body = input(
          z.object({ id, postId: z.string().regex(/^\d{1,30}$/) }).strict(),
          request.payload,
        );
        const media = await this.#application.xMedia(this.#userId, body.id, body.postId);
        return {
          sourceUrl: media.url,
          posterUrl: media.posterUrl,
          aspectRatio: media.aspectRatio,
        };
      }
      case "loadFullContent": {
        const body = input(z.object({ id }).strict(), request.payload);
        return this.#application.loadFullContent(this.#userId, body.id);
      }
      case "summarizeArticle": {
        const body = input(inputs.summarizeArticle.extend({ id }), request.payload);
        return notFound(
          await this.#ai.summarizeArticle(this.#userId, body.id, body.promptId, body.regenerate),
          "Article",
        );
      }
      case "translateArticle": {
        const body = input(inputs.translateArticle.extend({ id }), request.payload);
        return notFound(
          await this.#ai.translateArticle(this.#userId, body.id, body.sourceKind),
          "Article",
        );
      }
      case "updateArticleState": {
        const body = input(
          z.object({ id, state: inputs.updateArticleState }).strict(),
          request.payload,
        );
        return notFound(
          this.#database.articles.updateArticleState(this.#userId, body.id, body.state),
          "Article",
        );
      }
      case "markRead": {
        const body = inputs.markRead.parse(request.payload ?? {}) as MarkReadRequest;
        return { updated: this.#database.articles.markArticlesRead(this.#userId, body) };
      }
      case "refresh": {
        const body = inputs.refresh.parse(request.payload ?? {});
        return this.#application.refresh(this.#userId, body.feedIds);
      }
      case "discoverFeed": {
        const body = inputs.url.parse(request.payload);
        return this.#application.discoverFeed(this.#userId, body.url);
      }
      case "analyzeWebPage": {
        const body = inputs.url.parse(request.payload);
        return this.#application.analyzeWebPage(this.#userId, body.url);
      }
      case "createFeed":
        return this.#application.createFeed(this.#userId, inputs.createFeed.parse(request.payload));
      case "feed": {
        const body = input(z.object({ id }).strict(), request.payload);
        return notFound(this.#database.feeds.getFeed(this.#userId, body.id), "Feed");
      }
      case "updateFeed": {
        const body = input(z.object({ id, input: inputs.updateFeed }).strict(), request.payload);
        return notFound(this.#database.feeds.updateFeed(this.#userId, body.id, body.input), "Feed");
      }
      case "deleteFeed": {
        const body = input(z.object({ id }).strict(), request.payload);
        if (!this.#database.feeds.deleteFeed(this.#userId, body.id)) {
          throw new ApplicationApiError(404, "Feed was not found.");
        }
        return undefined;
      }
      case "analyzeWebFeed": {
        const body = input(z.object({ id }).strict(), request.payload);
        return this.#application.analyzeWebFeed(this.#userId, body.id);
      }
      case "updateWebFeedSelection": {
        const body = input(inputs.updateWebFeedSelection.extend({ id }), request.payload);
        return this.#application.updateWebFeedSelection(this.#userId, body.id, body.config);
      }
      case "createFolder": {
        const body = inputs.createFolder.parse(request.payload);
        return this.#database.folders.createFolder(this.#userId, body);
      }
      case "updateFolder": {
        const body = input(z.object({ id, input: inputs.updateFolder }).strict(), request.payload);
        return notFound(
          this.#database.folders.updateFolder(this.#userId, body.id, body.input),
          "Folder",
        );
      }
      case "deleteFolder": {
        const body = input(z.object({ id }).strict(), request.payload);
        if (!this.#database.folders.deleteFolder(this.#userId, body.id)) {
          throw new ApplicationApiError(404, "Folder was not found.");
        }
        return undefined;
      }
      case "rules":
        return { rules: this.#database.rules.listRules(this.#userId) };
      case "createRule": {
        const body = inputs.createRule.parse(request.payload);
        return this.#database.rules.createRule(this.#userId, body);
      }
      case "updateRule": {
        const body = input(z.object({ id, input: inputs.updateRule }).strict(), request.payload);
        return notFound(this.#database.rules.updateRule(this.#userId, body.id, body.input), "Rule");
      }
      case "deleteRule": {
        const body = input(z.object({ id }).strict(), request.payload);
        if (!this.#database.rules.deleteRule(this.#userId, body.id)) {
          throw new ApplicationApiError(404, "Rule was not found.");
        }
        return undefined;
      }
      case "updateSettings": {
        const body = inputs.updateSettings.parse(request.payload);
        return this.#database.settings.updateSettings(this.#userId, body);
      }
      case "aiSettings":
        return this.#ai.getSettings(this.#userId);
      case "updateAiFeature": {
        const body = input(
          z
            .object({
              feature: inputs.aiFeature,
              input: inputs.updateAiFeature,
            })
            .strict(),
          request.payload,
        );
        return this.#ai.setFeatureSetting(
          this.#userId,
          body.feature,
          body.input.provider,
          body.input.model,
        );
      }
      case "saveAiProviderKey": {
        const body = input(
          inputs.saveAiProviderKey.extend({ provider: inputs.aiProvider }),
          request.payload,
        );
        return this.#ai.setApiKey(this.#userId, body.provider, body.apiKey);
      }
      case "deleteAiProviderKey": {
        const body = input(z.object({ provider: inputs.aiProvider }).strict(), request.payload);
        return this.#ai.deleteApiKey(this.#userId, body.provider);
      }
      case "importOpml": {
        const body = inputs.importOpml.parse(request.payload);
        return this.#application.importOpml(this.#userId, body.opml);
      }
      case "exportOpml":
        return this.#database.opml.export(this.#userId);
      default:
        return this.#unsupported(request.operation);
    }
  }

  snapshot(id: string): string {
    return this.#webFeedService.snapshot(String(this.#userId), id);
  }

  telegramPreviewUrl(articleId: number): Promise<string> {
    return this.#application.telegramPreviewUrl(this.#userId, articleId);
  }

  #unsupported(operation: never): never {
    throw new ApplicationApiError(400, `Unsupported desktop operation: ${operation}`);
  }
}
