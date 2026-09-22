import { z } from "zod";
import { AI_PROMPT_MAX_LENGTH } from "../ai-prompts.js";
import {
  DUPLICATE_ARTICLE_WINDOW_DAYS,
  type DuplicateArticleWindowDays,
  FEED_POLL_INTERVAL_MINUTES,
  type FeedPollIntervalMinutes,
  MARK_READ_AGE_DAYS,
  type MarkReadAgeDays,
} from "../types.js";

export const resourceId = z.number().int().positive();
const nullableId = resourceId.nullable();
const httpUrl = z
  .string()
  .trim()
  .min(1)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }, "Enter a URL that begins with http:// or https://.");
const selector = z.string().trim().min(1).max(2_000);
const webFeedConfig = z
  .object({
    pageUrl: httpUrl,
    selectors: z
      .object({
        item: selector,
        title: selector,
        link: selector,
        date: selector.nullable(),
        author: selector.nullable(),
        summary: selector.nullable(),
        image: selector.nullable(),
      })
      .strict(),
  })
  .strict();
const feedFields = z
  .object({
    title: z.string().trim().min(1).max(300).exactOptional(),
    feedUrl: httpUrl,
    siteUrl: httpUrl.nullable().exactOptional(),
    folderId: nullableId.exactOptional(),
  })
  .strict();
const folderFields = z
  .object({
    name: z.string().trim().min(1).max(200),
    parentId: nullableId.exactOptional(),
    position: z.number().int().min(0).exactOptional(),
    sortDirection: z.enum(["newest", "oldest"]).exactOptional(),
  })
  .strict();
const ruleFields = z
  .object({
    name: z.string().trim().min(1).max(200),
    feedId: nullableId.exactOptional(),
    folderId: nullableId.exactOptional(),
    conditions: z
      .array(
        z
          .object({
            field: z.enum(["title", "author", "summary", "content", "media", "any"]),
            pattern: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .min(1),
    conditionOperator: z.enum(["and", "or"]),
    action: z.enum(["hide", "keep", "mark_read"]),
    enabled: z.boolean().exactOptional(),
  })
  .strict();
const aiProvider = z.enum(["gemini", "openai", "anthropic"]);
const aiRequestCredential = z
  .object({ provider: aiProvider, apiKey: z.string().trim().min(1).max(10_000) })
  .strict();

export const inputs = {
  url: z.object({ url: httpUrl }).strict(),
  articles: z
    .object({
      state: z.enum(["all", "unread", "read", "starred"]).default("unread"),
      feedId: resourceId.exactOptional(),
      folderId: resourceId.exactOptional(),
      search: z.string().trim().max(300).exactOptional(),
      limit: z.number().int().min(1).max(500).exactOptional(),
      cursor: z.string().min(1).max(50_000).exactOptional(),
      anchorId: resourceId.exactOptional(),
      includeContent: z.boolean().exactOptional(),
    })
    .strict(),
  updateArticleState: z
    .object({
      isRead: z.boolean().exactOptional(),
      isStarred: z.boolean().exactOptional(),
    })
    .strict()
    .refine(
      (state) => state.isRead !== undefined || state.isStarred !== undefined,
      "Choose whether to update read state or saved state.",
    ),
  markRead: z
    .object({
      articleIds: z.array(resourceId).max(1_000).exactOptional(),
      feedId: resourceId.exactOptional(),
      folderId: resourceId.exactOptional(),
      olderThanDays: z
        .number()
        .int()
        .refine(
          (value) => MARK_READ_AGE_DAYS.includes(value as MarkReadAgeDays),
          "Choose one of the available age thresholds.",
        )
        .exactOptional(),
    })
    .strict(),
  summarizeArticle: z
    .object({
      promptId: z.uuid().nullable(),
      regenerate: z.boolean(),
      credential: aiRequestCredential.exactOptional(),
    })
    .strict(),
  translateArticle: z
    .object({
      sourceKind: z.enum(["full", "feed", "excerpt"]),
      credential: aiRequestCredential.exactOptional(),
    })
    .strict(),
  refresh: z.object({ feedIds: z.array(resourceId).max(1_000).exactOptional() }).strict(),
  createFeed: z.discriminatedUnion("sourceKind", [
    feedFields.extend({ sourceKind: z.literal("published"), paused: z.boolean().exactOptional() }),
    feedFields.extend({ sourceKind: z.literal("web"), webConfig: webFeedConfig }),
  ]),
  updateFeed: feedFields.exactPartial().extend({ paused: z.boolean().exactOptional() }),
  updateWebFeedSelection: z.object({ config: webFeedConfig }).strict(),
  createFolder: folderFields,
  updateFolder: folderFields.exactPartial(),
  createRule: ruleFields,
  updateRule: ruleFields.exactPartial(),
  updateSettings: z
    .object({
      pollIntervalMinutes: z
        .custom<FeedPollIntervalMinutes>(
          (value) =>
            typeof value === "number" &&
            FEED_POLL_INTERVAL_MINUTES.includes(value as FeedPollIntervalMinutes),
          "Choose 5, 10, 20, 30, or 60 minutes.",
        )
        .exactOptional(),
      duplicateArticleWindowDays: z
        .custom<DuplicateArticleWindowDays>(
          (value) =>
            typeof value === "number" &&
            DUPLICATE_ARTICLE_WINDOW_DAYS.includes(value as DuplicateArticleWindowDays),
          "Choose 1, 7, or 30 days.",
        )
        .exactOptional(),
      singleKeyShortcuts: z.boolean().exactOptional(),
      markReadOnScroll: z.boolean().exactOptional(),
      showYouTubeDescriptions: z.boolean().exactOptional(),
      translationLanguage: z.string().trim().min(1).max(80).exactOptional(),
      summaryPrompt: z.string().trim().min(1).max(AI_PROMPT_MAX_LENGTH).exactOptional(),
      translationPrompt: z.string().trim().min(1).max(AI_PROMPT_MAX_LENGTH).exactOptional(),
      customPrompts: z
        .array(
          z
            .object({
              id: z.uuid(),
              name: z.string().trim().min(1).max(80),
              prompt: z.string().trim().min(1).max(AI_PROMPT_MAX_LENGTH),
            })
            .strict(),
        )
        .exactOptional(),
    })
    .strict(),
  aiFeature: z.literal("article_summary"),
  aiProvider,
  updateAiFeature: z
    .object({ provider: aiProvider, model: z.string().trim().min(1).max(200).exactOptional() })
    .strict(),
  saveAiProviderKey: z.object({ apiKey: z.string().trim().min(1).max(10_000) }).strict(),
  saveBrowserAiKey: z
    .object({
      encryptedApiKey: z
        .string()
        .max(20_000)
        .regex(/^browser-v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{23,}$/),
    })
    .strict(),
  importOpml: z.object({ opml: z.string().min(1) }).strict(),
};

export type FeedInput = z.input<typeof inputs.createFeed>;
export type FeedUpdateInput = z.input<typeof inputs.updateFeed>;
export type FolderInput = z.input<typeof inputs.createFolder>;
export type RuleInput = z.input<typeof inputs.createRule>;
