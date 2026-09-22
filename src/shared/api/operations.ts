import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";
import type { z } from "zod";
import type {
  AiSettings,
  AppSettings,
  Article,
  ArticleAiSummary,
  ArticleAiTranslation,
  ArticlePage,
  BootstrapData,
  Feed,
  FeedDiscoveryResult,
  Folder,
  ImportResult,
  InvitationOverview,
  RefreshResult,
  RegistrationMode,
  Rule,
  SessionUser,
  TelegramArticleMedia,
  WebFeedAnalysis,
  XArticleMedia,
} from "../types.js";
import type { authInputs } from "./auth-inputs.js";
import type { inputs } from "./inputs.js";

interface AuthConfig {
  registrationMode: RegistrationMode;
  registrationAvailable: boolean;
  passkeysAvailable: boolean;
}

export interface PasskeySummary {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  deviceType: string;
  backedUp: boolean;
}

type Input<K extends keyof typeof inputs> = z.input<(typeof inputs)[K]>;
type AuthInput<K extends keyof typeof authInputs> = z.input<(typeof authInputs)[K]>;
type ResourceId = { id: number };
type Operation<Payload, Result> = { input: Payload; output: Result };

interface ApiOperations {
  session: Operation<undefined, { user: SessionUser }>;
  login: Operation<AuthInput<"loginCredentials">, { user: SessionUser }>;
  register: Operation<AuthInput<"registrationCredentials">, { user: SessionUser }>;
  passkeySignupOptions: Operation<
    AuthInput<"passkeySignup">,
    {
      registrationId: string;
      options: PublicKeyCredentialCreationOptionsJSON;
    }
  >;
  completePasskeySignup: Operation<
    { registrationId: string; response: RegistrationResponseJSON },
    { user: SessionUser }
  >;
  logout: Operation<undefined, void>;
  authConfig: Operation<undefined, AuthConfig>;
  invitations: Operation<undefined, InvitationOverview>;
  createInvitation: Operation<{ replaceId?: string }, { id: string; number: number; code: string }>;
  revokeInvitation: Operation<{ id: string }, void>;
  changePassword: Operation<AuthInput<"passwordCredential">, void>;
  removePassword: Operation<undefined, void>;
  deleteAccount: Operation<undefined, void>;
  stepUpPassword: Operation<AuthInput<"stepUpPassword">, void>;
  stepUpPasskeyOptions: Operation<
    AuthInput<"stepUpOptions">,
    {
      ceremonyId: string;
      options: PublicKeyCredentialRequestOptionsJSON;
    }
  >;
  stepUpPasskey: Operation<{ ceremonyId: string; response: AuthenticationResponseJSON }, void>;
  passkeys: Operation<undefined, { passkeys: PasskeySummary[]; hasPassword: boolean }>;
  passkeyRegistrationOptions: Operation<
    undefined,
    {
      ceremonyId: string;
      options: PublicKeyCredentialCreationOptionsJSON;
    }
  >;
  registerPasskey: Operation<
    { ceremonyId: string; response: RegistrationResponseJSON },
    { passkey: PasskeySummary }
  >;
  renamePasskey: Operation<{ id: string; name: string }, { passkey: PasskeySummary }>;
  deletePasskey: Operation<{ id: string }, void>;
  passkeyAuthenticationOptions: Operation<
    undefined,
    {
      ceremonyId: string;
      options: PublicKeyCredentialRequestOptionsJSON;
    }
  >;
  passkeyLogin: Operation<
    { ceremonyId: string; response: AuthenticationResponseJSON },
    { user: SessionUser }
  >;
  bootstrap: Operation<undefined, BootstrapData>;
  articles: Operation<Input<"articles">, ArticlePage>;
  article: Operation<ResourceId, Article>;
  telegramArticleMedia: Operation<ResourceId, TelegramArticleMedia>;
  xArticleMedia: Operation<ResourceId & { postId: string }, XArticleMedia>;
  loadFullContent: Operation<ResourceId, Article>;
  summarizeArticle: Operation<ResourceId & Input<"summarizeArticle">, ArticleAiSummary>;
  translateArticle: Operation<ResourceId & Input<"translateArticle">, ArticleAiTranslation>;
  updateArticleState: Operation<ResourceId & { state: Input<"updateArticleState"> }, Article>;
  markRead: Operation<Input<"markRead">, { updated: number }>;
  refresh: Operation<Input<"refresh">, RefreshResult>;
  discoverFeed: Operation<Input<"url">, FeedDiscoveryResult>;
  analyzeWebPage: Operation<Input<"url">, WebFeedAnalysis>;
  createFeed: Operation<Input<"createFeed">, Feed>;
  feed: Operation<ResourceId, Feed>;
  updateFeed: Operation<ResourceId & { input: Input<"updateFeed"> }, Feed>;
  deleteFeed: Operation<ResourceId, void>;
  analyzeWebFeed: Operation<ResourceId, WebFeedAnalysis>;
  updateWebFeedSelection: Operation<ResourceId & Input<"updateWebFeedSelection">, Feed>;
  createFolder: Operation<Input<"createFolder">, Folder>;
  updateFolder: Operation<ResourceId & { input: Input<"updateFolder"> }, Folder>;
  deleteFolder: Operation<ResourceId, void>;
  rules: Operation<undefined, { rules: Rule[] }>;
  createRule: Operation<Input<"createRule">, Rule>;
  updateRule: Operation<ResourceId & { input: Input<"updateRule"> }, Rule>;
  deleteRule: Operation<ResourceId, void>;
  updateSettings: Operation<Input<"updateSettings">, AppSettings>;
  updateAiFeature: Operation<
    { feature: Input<"aiFeature">; input: Input<"updateAiFeature"> },
    AiSettings
  >;
  saveAiProviderKey: Operation<
    Input<"saveAiProviderKey"> & { provider: Input<"aiProvider"> },
    AiSettings
  >;
  deleteAiProviderKey: Operation<{ provider: Input<"aiProvider"> }, AiSettings>;
  importOpml: Operation<Input<"importOpml">, ImportResult>;
  exportOpml: Operation<undefined, string>;
}

export type ApiOperation = keyof ApiOperations;
export type ApiInput<K extends ApiOperation> = ApiOperations[K]["input"];
export type ApiOutput<K extends ApiOperation> = ApiOperations[K]["output"];

export type ApiRequest<K extends ApiOperation = ApiOperation> = {
  [P in K]: { operation: P } & (undefined extends ApiInput<P>
    ? { payload?: ApiInput<P> }
    : { payload: ApiInput<P> });
}[K];

/** Only the operation is known until a transport's payload has been validated. */
export interface UntrustedApiRequest {
  operation: ApiOperation;
  payload?: unknown;
}

export const API_OPERATIONS = [
  "session",
  "login",
  "register",
  "passkeySignupOptions",
  "completePasskeySignup",
  "logout",
  "authConfig",
  "invitations",
  "createInvitation",
  "revokeInvitation",
  "changePassword",
  "removePassword",
  "deleteAccount",
  "stepUpPassword",
  "stepUpPasskeyOptions",
  "stepUpPasskey",
  "passkeys",
  "passkeyRegistrationOptions",
  "registerPasskey",
  "renamePasskey",
  "deletePasskey",
  "passkeyAuthenticationOptions",
  "passkeyLogin",
  "bootstrap",
  "articles",
  "article",
  "telegramArticleMedia",
  "xArticleMedia",
  "loadFullContent",
  "summarizeArticle",
  "translateArticle",
  "updateArticleState",
  "markRead",
  "refresh",
  "discoverFeed",
  "analyzeWebPage",
  "createFeed",
  "feed",
  "updateFeed",
  "deleteFeed",
  "analyzeWebFeed",
  "updateWebFeedSelection",
  "createFolder",
  "updateFolder",
  "deleteFolder",
  "rules",
  "createRule",
  "updateRule",
  "deleteRule",
  "updateSettings",
  "updateAiFeature",
  "saveAiProviderKey",
  "deleteAiProviderKey",
  "importOpml",
  "exportOpml",
] as const satisfies readonly ApiOperation[];
