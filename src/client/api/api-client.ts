import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/browser";
import type {
  ApiInput,
  ApiOperation,
  ApiOutput,
  PasskeySummary,
} from "../../shared/api/operations.js";
import type {
  AiArticleSourceKind,
  AiFeature,
  AiProvider,
  ArticleQuery,
  ImportResult,
  MarkReadRequest,
  Rule,
  SessionUser,
  WebFeedConfig,
} from "../../shared/types.js";
import type { FeedInput, FeedUpdateInput, FolderInput, RuleInput } from "./api-contract.js";

export type ReaderDataInvalidation = "connected" | "change";

export interface ApiRequestOptions {
  signal?: AbortSignal | null;
  aiProvider?: AiProvider | null;
}

export interface ApiRuntime {
  request<K extends ApiOperation>(
    operation: K,
    payload: ApiInput<NoInfer<K>>,
    options?: ApiRequestOptions,
  ): Promise<ApiOutput<K>>;
  subscribeReaderDataInvalidations(listener: (reason: ReaderDataInvalidation) => void): () => void;
  exportOpml(): Promise<void>;
}

export function createApiClient(runtime: ApiRuntime) {
  const { request } = runtime;
  return {
    async session(): Promise<SessionUser> {
      const body = await request("session", undefined);
      return body.user;
    },

    async login(username: string, password: string): Promise<SessionUser> {
      const body = await request("login", { username, password });
      return body.user;
    },

    async register(username: string, password: string, inviteCode?: string): Promise<SessionUser> {
      const body = await request("register", { username, password, inviteCode });
      return body.user;
    },

    passkeySignupOptions: (username: string, inviteCode?: string) =>
      request("passkeySignupOptions", { username, inviteCode }),

    async completePasskeySignup(
      registrationId: string,
      response: RegistrationResponseJSON,
    ): Promise<SessionUser> {
      const body = await request("completePasskeySignup", { registrationId, response });
      return body.user;
    },

    logout: () => request("logout", undefined),

    authConfig: () => request("authConfig", undefined),

    invitations: () => request("invitations", undefined),
    createInvitation: (replaceId?: string) =>
      request("createInvitation", replaceId === undefined ? {} : { replaceId }),
    revokeInvitation: (id: string) => request("revokeInvitation", { id }),

    changePassword: (password: string) => request("changePassword", { password }),

    removePassword: () => request("removePassword", undefined),

    deleteAccount: () => request("deleteAccount", undefined),

    async passkeys(): Promise<{ passkeys: PasskeySummary[]; hasPassword: boolean }> {
      return request("passkeys", undefined);
    },

    passkeyRegistrationOptions: () => request("passkeyRegistrationOptions", undefined),

    registerPasskey: (ceremonyId: string, response: RegistrationResponseJSON) =>
      request("registerPasskey", { ceremonyId, response }),

    renamePasskey: (id: string, name: string) => request("renamePasskey", { id, name }),

    deletePasskey: (id: string) => request("deletePasskey", { id }),

    stepUpPassword: (operationId: string, password: string) =>
      request("stepUpPassword", { operationId, password }),

    stepUpPasskeyOptions: (operationId: string) => request("stepUpPasskeyOptions", { operationId }),

    stepUpPasskey: (ceremonyId: string, response: AuthenticationResponseJSON) =>
      request("stepUpPasskey", { ceremonyId, response }),

    passkeyAuthenticationOptions: () => request("passkeyAuthenticationOptions", undefined),

    async passkeyLogin(
      ceremonyId: string,
      response: AuthenticationResponseJSON,
    ): Promise<SessionUser> {
      const body = await request("passkeyLogin", { ceremonyId, response });
      return body.user;
    },

    bootstrap: (signal?: AbortSignal) =>
      request("bootstrap", undefined, { signal: signal ?? null }),

    subscribeReaderDataInvalidations: runtime.subscribeReaderDataInvalidations,

    articles: (query: ArticleQuery, signal?: AbortSignal) =>
      request("articles", query, { signal: signal ?? null }),

    article: (id: number, signal?: AbortSignal) =>
      request("article", { id }, { signal: signal ?? null }),

    telegramArticleMedia: (id: number, signal?: AbortSignal) =>
      request("telegramArticleMedia", { id }, { signal: signal ?? null }),

    xArticleMedia: (id: number, postId: string, signal?: AbortSignal) =>
      request("xArticleMedia", { id, postId }, { signal: signal ?? null }),

    loadFullContent: (id: number) => request("loadFullContent", { id }),

    summarizeArticle: (
      id: number,
      promptId: string | null,
      regenerate = false,
      provider?: AiProvider | null,
    ) =>
      request("summarizeArticle", { id, promptId, regenerate }, { aiProvider: provider ?? null }),

    translateArticle: (id: number, sourceKind: AiArticleSourceKind, provider?: AiProvider | null) =>
      request("translateArticle", { id, sourceKind }, { aiProvider: provider ?? null }),

    updateArticleState: (id: number, state: { isRead?: boolean; isSaved?: boolean }) =>
      request("updateArticleState", { id, state }),

    markRead: (body: MarkReadRequest) => request("markRead", body),

    refresh: (feedIds?: number[]) => request("refresh", feedIds ? { feedIds } : {}),

    discoverFeed: (url: string) => request("discoverFeed", { url }),

    analyzeWebPage: (url: string) => request("analyzeWebPage", { url }),

    createFeed: (input: FeedInput) => request("createFeed", input),

    feed: (id: number) => request("feed", { id }),

    updateFeed: (id: number, input: FeedUpdateInput) => request("updateFeed", { id, input }),

    deleteFeed: (id: number) => request("deleteFeed", { id }),

    analyzeWebFeed: (id: number) => request("analyzeWebFeed", { id }),

    updateWebFeedSelection: (id: number, config: WebFeedConfig) =>
      request("updateWebFeedSelection", { id, config }),

    createFolder: (input: FolderInput) => request("createFolder", input),

    updateFolder: (id: number, input: Partial<FolderInput>) =>
      request("updateFolder", { id, input }),

    deleteFolder: (id: number) => request("deleteFolder", { id }),

    async rules(signal?: AbortSignal): Promise<Rule[]> {
      const body = await request("rules", undefined, { signal: signal ?? null });
      return body.rules;
    },

    createRule: (input: RuleInput) => request("createRule", input),

    updateRule: (id: number, input: Partial<RuleInput>) => request("updateRule", { id, input }),

    deleteRule: (id: number) => request("deleteRule", { id }),

    updateSettings: (input: ApiInput<"updateSettings">) => request("updateSettings", input),

    updateAiFeature: (feature: AiFeature, input: { provider: AiProvider; model?: string }) =>
      request("updateAiFeature", { feature, input }),

    saveAiProviderKey: (provider: AiProvider, apiKey: string) =>
      request("saveAiProviderKey", { provider, apiKey }),

    deleteAiProviderKey: (provider: AiProvider) => request("deleteAiProviderKey", { provider }),

    async importOpml(file: File): Promise<ImportResult> {
      const opml = await file.text();
      return request("importOpml", { opml });
    },

    exportOpml: runtime.exportOpml,
  };
}
