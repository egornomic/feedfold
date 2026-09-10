import { createHash } from "node:crypto";
import {
  DEFAULT_ARTICLE_SUMMARY_PROMPT,
  DEFAULT_ARTICLE_TRANSLATION_PROMPT,
} from "../../../shared/ai-prompts.js";
import type {
  AiArticleSourceKind,
  AiFeature,
  AiFeatureSetting,
  AiProvider,
  AiRequestCredential,
  AiSettings,
  ArticleAiSummary,
  ArticleAiTranslation,
} from "../../../shared/types.js";
import {
  ARTICLE_GROUNDED_MAX_OUTPUT_TOKENS,
  ARTICLE_SUMMARY_MAX_OUTPUT_TOKENS,
  ARTICLE_SUMMARY_PROMPT_VERSION,
  articleSummaryNeedsWebSearch,
  articleSummarySystemPrompt,
  prepareArticleSummary,
  prepareYouTubeVideoSummary,
} from "../../ai/article-summary.js";
import {
  ARTICLE_TRANSLATION_MAX_OUTPUT_TOKENS,
  ARTICLE_TRANSLATION_PROMPT_VERSION,
  prepareArticleTranslation,
  renderArticleTranslation,
} from "../../ai/article-translation.js";
import type { CredentialCipherLike } from "../../ai/credential-cipher.js";
import { AiError } from "../../ai/errors.js";
import { createAiProviders } from "../../ai/providers.js";
import type { AiGenerationResult, AiProviderAdapter } from "../../ai/types.js";
import type { AppDatabase } from "../../database.js";
import type { StoredArticleAiSummary, StoredArticleAiTranslation } from "../shared.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const VIDEO_REQUEST_TIMEOUT_MS = 240_000;

function promptVersion(prompt: string, defaultPrompt: string, defaultVersion: number): number {
  if (prompt === defaultPrompt) return defaultVersion;
  const digest = createHash("sha256").update(`${defaultVersion}\0${prompt}`).digest();
  return -digest.readUIntBE(0, 6) - 1;
}

function youtubeSummaryVersion(prompt: string): number {
  const digest = createHash("sha256").update(`youtube-video-summary-v1\0${prompt}`).digest();
  return -digest.readUIntBE(0, 6) - 1;
}

export interface AiServiceOptions {
  credentialCipher: CredentialCipherLike | null;
  currentDate?: () => Date;
  providers?: ReadonlyMap<AiProvider, AiProviderAdapter>;
  requestTimeoutMs?: number;
}

interface FeatureGenerationRequest {
  system: string;
  input: string;
  videoUrl?: string;
  maxOutputTokens: number;
  webSearch: boolean;
}

interface FeatureGenerationResult extends AiGenerationResult {
  provider: AiProvider;
  model: string;
}

function publicSummary(summary: StoredArticleAiSummary): ArticleAiSummary {
  return {
    text: summary.text,
    promptId: summary.promptId,
    provider: summary.provider,
    model: summary.model,
    sourceKind: summary.sourceKind,
    generatedAt: summary.generatedAt,
    usage: summary.usage,
    grounding: summary.grounding,
  };
}

function publicTranslation(translation: StoredArticleAiTranslation): ArticleAiTranslation {
  return {
    html: translation.html,
    language: translation.language,
    provider: translation.provider,
    model: translation.model,
    sourceKind: translation.sourceKind,
    generatedAt: translation.generatedAt,
    usage: translation.usage,
  };
}

export class AiService {
  private readonly providers: ReadonlyMap<AiProvider, AiProviderAdapter>;
  private readonly currentDate: () => Date;
  private readonly summariesInFlight = new Map<string, Promise<ArticleAiSummary | null>>();
  private readonly translationsInFlight = new Map<string, Promise<ArticleAiTranslation | null>>();

  constructor(
    private readonly database: AppDatabase,
    private readonly options: AiServiceOptions,
  ) {
    this.providers = options.providers ?? createAiProviders();
    this.currentDate = options.currentDate ?? (() => new Date());
  }

  getSettings(userId: number, deviceId?: string): AiSettings {
    const configured = new Set(this.database.ai.listConfiguredAiProviders(userId, deviceId));
    const articleSummary = this.validFeatureSetting(
      this.database.ai.getAiFeatureSetting(userId, "article_summary"),
    );
    return {
      credentialStorageAvailable: deviceId !== undefined || this.options.credentialCipher !== null,
      providers: [...this.providers.values()].map((provider) => ({
        id: provider.id,
        label: provider.label,
        configured: configured.has(provider.id),
        defaultModel: provider.defaultModel,
        models: provider.models.map((model) => ({ ...model })),
      })),
      features: { articleSummary },
    };
  }

  setFeatureSetting(
    userId: number,
    feature: AiFeature,
    providerId: AiProvider,
    model?: string,
    deviceId?: string,
  ): AiSettings {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new AiError("AI_NOT_CONFIGURED", 422, "Choose an AI provider in Settings.");
    }
    const selectedModel = model?.trim() || provider.defaultModel;
    this.database.ai.setAiFeatureSetting(userId, feature, {
      provider: providerId,
      model: selectedModel,
    });
    return this.getSettings(userId, deviceId);
  }

  setApiKey(userId: number, provider: AiProvider, apiKey: string): AiSettings {
    const cipher = this.options.credentialCipher;
    if (!cipher) {
      throw new AiError(
        "AI_CREDENTIAL_STORAGE_UNAVAILABLE",
        503,
        "Secure API-key storage is unavailable on this Mac.",
      );
    }
    const encrypted = cipher.encrypt(userId, provider, apiKey.trim());
    this.database.ai.setEncryptedAiCredential(userId, provider, encrypted);
    return this.getSettings(userId);
  }

  setBrowserKey(
    userId: number,
    deviceId: string,
    provider: AiProvider,
    encryptedApiKey: string,
  ): AiSettings {
    this.database.ai.setEncryptedAiCredential(userId, provider, encryptedApiKey, deviceId);
    return this.getSettings(userId, deviceId);
  }

  browserKey(userId: number, deviceId: string, provider: AiProvider): string | null {
    return this.database.ai.getEncryptedAiCredential(userId, provider, deviceId);
  }

  deleteDeviceKeys(userId: number, deviceId: string): void {
    this.database.ai.deleteDeviceAiCredentials(userId, deviceId);
  }

  deleteApiKey(userId: number, provider: AiProvider, deviceId?: string): AiSettings {
    this.database.ai.deleteAiCredential(userId, provider, deviceId);
    return this.getSettings(userId, deviceId);
  }

  async generateText(
    userId: number,
    feature: AiFeature,
    request: FeatureGenerationRequest,
    credential?: AiRequestCredential,
  ): Promise<FeatureGenerationResult> {
    const setting = this.validFeatureSetting(this.database.ai.getAiFeatureSetting(userId, feature));
    if (!setting) {
      throw new AiError(
        "AI_NOT_CONFIGURED",
        422,
        "Choose an AI provider and model in Settings, then try again.",
      );
    }
    return this.generateWithProvider(userId, setting.provider, setting.model, request, credential);
  }

  private async generateWithProvider(
    userId: number,
    providerId: AiProvider,
    model: string,
    request: FeatureGenerationRequest,
    credential?: AiRequestCredential,
    missingKeyMessage?: string,
  ): Promise<FeatureGenerationResult> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new AiError("AI_NOT_CONFIGURED", 422, "Choose an AI provider in Settings.");
    }
    const cipher = this.options.credentialCipher;
    const encryptedKey = cipher
      ? this.database.ai.getEncryptedAiCredential(userId, providerId)
      : null;
    const apiKey =
      credential?.provider === providerId
        ? credential.apiKey
        : encryptedKey && cipher
          ? cipher.decrypt(userId, providerId, encryptedKey)
          : null;
    if (!apiKey) {
      throw new AiError(
        "AI_KEY_MISSING",
        422,
        missingKeyMessage ??
          `Add an API key for ${provider.label} on this device in Settings, then try again.`,
      );
    }
    const result = await this.database.quotas.runOutbound(() =>
      provider.generateText({
        apiKey,
        model,
        ...request,
        signal: AbortSignal.timeout(
          this.options.requestTimeoutMs ??
            (request.videoUrl ? VIDEO_REQUEST_TIMEOUT_MS : DEFAULT_REQUEST_TIMEOUT_MS),
        ),
      }),
    );
    return { ...result, provider: providerId, model };
  }

  private generateYouTubeSummary(
    userId: number,
    setting: AiFeatureSetting | null,
    request: FeatureGenerationRequest,
    credential?: AiRequestCredential,
  ): Promise<FeatureGenerationResult> {
    const gemini = this.providers.get("gemini");
    if (!gemini) {
      throw new AiError("AI_NOT_CONFIGURED", 422, "Google Gemini is unavailable.");
    }
    const model = setting?.provider === "gemini" ? setting.model : gemini.defaultModel;
    return this.generateWithProvider(
      userId,
      "gemini",
      model,
      request,
      credential,
      "Add a Google Gemini API key in Settings to summarize YouTube videos.",
    );
  }

  async summarizeArticle(
    userId: number,
    articleId: number,
    customPromptId: string | null,
    regenerate = false,
    credential?: AiRequestCredential,
  ): Promise<ArticleAiSummary | null> {
    const { summaryPrompt, customPrompts } = this.database.settings.getSettings(userId);
    const customPrompt = customPromptId
      ? customPrompts.find((prompt) => prompt.id === customPromptId)
      : null;
    if (customPromptId && !customPrompt) {
      throw new AiError(
        "CUSTOM_PROMPT_NOT_FOUND",
        404,
        "This custom prompt no longer exists. Choose another AI action.",
      );
    }
    const prompt = customPrompt?.prompt ?? summaryPrompt;
    const version = promptVersion(
      prompt,
      DEFAULT_ARTICLE_SUMMARY_PROMPT,
      ARTICLE_SUMMARY_PROMPT_VERSION,
    );
    const key = `${userId}:${articleId}:${customPromptId ?? "default"}:${version}`;
    const running = this.summariesInFlight.get(key);
    if (running) return running;
    const summary = this.createArticleSummary(
      userId,
      articleId,
      regenerate,
      prompt,
      customPromptId,
      version,
      credential,
    ).finally(() => {
      this.summariesInFlight.delete(key);
    });
    this.summariesInFlight.set(key, summary);
    return summary;
  }

  translateArticle(
    userId: number,
    articleId: number,
    sourceKind: AiArticleSourceKind,
    credential?: AiRequestCredential,
  ): Promise<ArticleAiTranslation | null> {
    const { translationLanguage: language, translationPrompt } =
      this.database.settings.getSettings(userId);
    const version = promptVersion(
      translationPrompt,
      DEFAULT_ARTICLE_TRANSLATION_PROMPT,
      ARTICLE_TRANSLATION_PROMPT_VERSION,
    );
    const key = `${userId}:${articleId}:${sourceKind}:${language.toLocaleLowerCase()}:${version}`;
    const running = this.translationsInFlight.get(key);
    if (running) return running;
    const translation = this.createArticleTranslation(
      userId,
      articleId,
      sourceKind,
      language,
      translationPrompt,
      version,
      credential,
    ).finally(() => {
      this.translationsInFlight.delete(key);
    });
    this.translationsInFlight.set(key, translation);
    return translation;
  }

  private async createArticleSummary(
    userId: number,
    articleId: number,
    regenerate: boolean,
    prompt: string,
    promptId: string | null,
    version: number,
    credential?: AiRequestCredential,
  ): Promise<ArticleAiSummary | null> {
    const article = this.database.ai.getArticleForAi(userId, articleId);
    if (!article) return null;
    const setting = this.validFeatureSetting(
      this.database.ai.getAiFeatureSetting(userId, "article_summary"),
    );
    const videoUrl = article.media?.provider === "youtube" ? article.url : null;
    const summaryVersion = videoUrl ? youtubeSummaryVersion(prompt) : version;
    const useWebSearch =
      articleSummaryNeedsWebSearch(prompt) && (videoUrl !== null || setting !== null);
    if (
      !useWebSearch &&
      !regenerate &&
      article.currentSummary?.promptVersion === summaryVersion &&
      article.currentSummary.promptId === promptId
    ) {
      return publicSummary(article.currentSummary);
    }
    const prepared = videoUrl
      ? prepareYouTubeVideoSummary(article)
      : prepareArticleSummary(article);
    const request = {
      system: articleSummarySystemPrompt(
        prompt,
        this.currentDate(),
        useWebSearch,
        videoUrl ? "youtube_video" : "article",
      ),
      input: prepared.input,
      ...(videoUrl ? { videoUrl } : {}),
      maxOutputTokens: useWebSearch
        ? ARTICLE_GROUNDED_MAX_OUTPUT_TOKENS
        : ARTICLE_SUMMARY_MAX_OUTPUT_TOKENS,
      webSearch: useWebSearch,
    };
    const generated = videoUrl
      ? await this.generateYouTubeSummary(userId, setting, request, credential)
      : await this.generateText(userId, "article_summary", request, credential);
    if (useWebSearch) {
      return {
        text: generated.text,
        promptId,
        provider: generated.provider,
        model: generated.model,
        sourceKind: prepared.sourceKind,
        generatedAt: this.currentDate().toISOString(),
        usage: generated.usage,
        grounding: generated.grounding,
      };
    }
    const saved = this.database.ai.saveArticleAiSummary(userId, articleId, article.revision, {
      promptVersion: summaryVersion,
      promptId,
      sourceKind: prepared.sourceKind,
      provider: generated.provider,
      model: generated.model,
      text: generated.text,
      usage: generated.usage,
    });
    if (!saved) {
      throw new AiError(
        "ARTICLE_CHANGED",
        409,
        "The article changed while it was being summarized. Try again.",
      );
    }
    return publicSummary(saved);
  }

  private async createArticleTranslation(
    userId: number,
    articleId: number,
    sourceKind: AiArticleSourceKind,
    language: string,
    prompt: string,
    version: number,
    credential?: AiRequestCredential,
  ): Promise<ArticleAiTranslation | null> {
    const article = this.database.ai.getArticleForAi(userId, articleId);
    if (!article) return null;
    const current = this.database.ai.getArticleAiTranslation(
      userId,
      articleId,
      language,
      sourceKind,
    );
    if (current?.promptVersion === version) {
      return publicTranslation(current);
    }
    const prepared = prepareArticleTranslation(article, language, sourceKind);
    const generated = await this.generateText(
      userId,
      "article_summary",
      {
        system: prompt,
        input: prepared.input,
        maxOutputTokens: ARTICLE_TRANSLATION_MAX_OUTPUT_TOKENS,
        webSearch: false,
      },
      credential,
    );
    const html = renderArticleTranslation(prepared, generated.text);
    const saved = this.database.ai.saveArticleAiTranslation(userId, articleId, article.revision, {
      promptVersion: version,
      language,
      sourceKind: prepared.sourceKind,
      provider: generated.provider,
      model: generated.model,
      html,
      usage: generated.usage,
    });
    if (!saved) {
      throw new AiError(
        "ARTICLE_CHANGED",
        409,
        "The article changed while it was being translated. Try again.",
      );
    }
    return publicTranslation(saved);
  }

  private validFeatureSetting(setting: AiFeatureSetting | null): AiFeatureSetting | null {
    if (!setting) return null;
    if (!this.providers.has(setting.provider) || !setting.model.trim()) return null;
    return setting;
  }
}
