import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { inputs } from "../../../shared/api-inputs.js";
import type { MarkReadRequest } from "../../../shared/types.js";
import type { ApplicationService } from "../../application-service.js";
import { QuotaExceededError } from "../../quota.js";
import type { XMediaService } from "../../x-media.js";
import type { AiService } from "../ai/service.js";
import { idParams, missing, type UserId } from "../routes.js";
import type { ArticleRepository } from "./repository.js";

export async function articleRoutes(
  app: FastifyInstance,
  {
    articles,
    application,
    ai,
    xMedia,
    userId,
  }: {
    articles: ArticleRepository;
    application: ApplicationService;
    ai: AiService;
    xMedia: XMediaService;
    userId: UserId;
  },
): Promise<void> {
  app.get("/api/articles", async (request) => {
    const query = z
      .object({
        feedId: z.coerce.number().optional(),
        folderId: z.coerce.number().optional(),
        limit: z.coerce.number().optional(),
        anchorId: z.coerce.number().optional(),
        includeContent: z
          .enum(["true", "false"])
          .transform((value) => value === "true")
          .optional(),
      })
      .passthrough()
      .pipe(inputs.articles)
      .parse(request.query);
    return articles.listArticlePage(userId(request), query);
  });

  app.get("/api/articles/:id", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const article = articles.getArticle(userId(request), id);
    return article ?? missing(reply, "Article");
  });

  app.get("/api/articles/:id/telegram-media", async (request) => {
    const { id } = idParams.parse(request.params);
    const items = await application.telegramItems(userId(request), id);
    return {
      items: items.map((item, index) => ({
        kind: item.kind,
        sourceUrl: `/api/articles/${id}/telegram-media/${index}/source`,
        posterUrl:
          item.kind === "video" && item.posterUrl
            ? `/api/articles/${id}/telegram-media/${index}/poster`
            : null,
        aspectRatio: item.aspectRatio,
      })),
    };
  });

  app.get("/api/articles/:id/telegram-media-preview", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    return reply.redirect(await application.telegramPreviewUrl(userId(request), id));
  });

  const mediaItemParams = z.object({
    id: z.coerce.number().int().positive(),
    index: z.coerce.number().int().min(0).max(99),
  });

  app.get("/api/articles/:id/telegram-media/:index/source", async (request, reply) => {
    const { id, index } = mediaItemParams.parse(request.params);
    const items = await application.telegramItems(userId(request), id);
    const item = items[index];
    return item ? reply.redirect(item.url) : missing(reply, "Telegram media");
  });

  app.get("/api/articles/:id/telegram-media/:index/poster", async (request, reply) => {
    const { id, index } = mediaItemParams.parse(request.params);
    const items = await application.telegramItems(userId(request), id);
    const posterUrl = items[index]?.posterUrl;
    return posterUrl ? reply.redirect(posterUrl) : missing(reply, "Telegram media poster");
  });

  const xMediaParams = idParams.extend({ postId: z.string().regex(/^\d{1,30}$/) });

  app.get("/api/articles/:id/x-media/:postId", async (request) => {
    const { id, postId } = xMediaParams.parse(request.params);
    const media = await application.xMedia(userId(request), id, postId);
    return {
      sourceUrl: `/api/articles/${id}/x-media/${postId}/source`,
      posterUrl: media.posterUrl ? `/api/articles/${id}/x-media/${postId}/poster` : null,
      aspectRatio: media.aspectRatio,
    };
  });

  app.get("/api/articles/:id/x-media/:postId/source", async (request, reply) => {
    const { id, postId } = xMediaParams.parse(request.params);
    const media = await application.xMedia(userId(request), id, postId);
    try {
      const { response, cancel } = await xMedia.videoResponse(media, request.headers.range);
      for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) {
        const value = response.headers.get(name);
        if (value) reply.header(name, value);
      }
      reply.code(response.status);
      if (!response.body) {
        cancel();
        return reply.send();
      }
      const stream = Readable.fromWeb(
        response.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>,
      );
      stream.once("close", cancel);
      return reply.send(stream);
    } catch (error) {
      if (error instanceof QuotaExceededError) throw error;
      return reply.code(502).send({ error: "X video is temporarily unavailable. Try again." });
    }
  });

  app.get("/api/articles/:id/x-media/:postId/poster", async (request, reply) => {
    const { id, postId } = xMediaParams.parse(request.params);
    const media = await application.xMedia(userId(request), id, postId);
    return media?.posterUrl ? reply.redirect(media.posterUrl) : missing(reply, "X video poster");
  });

  app.patch("/api/articles/:id/state", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = inputs.updateArticleState.parse(request.body);
    const article = articles.updateArticleState(userId(request), id, body);
    return article ?? missing(reply, "Article");
  });

  app.post("/api/articles/mark-read", async (request) => {
    const body = inputs.markRead.parse(request.body ?? {}) as MarkReadRequest;
    return { updated: articles.markArticlesRead(userId(request), body) };
  });

  app.post("/api/articles/:id/extract", async (request) => {
    const { id } = idParams.parse(request.params);
    return application.loadFullContent(userId(request), id);
  });

  app.post("/api/articles/:id/summary", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { promptId, regenerate, credential } = inputs.summarizeArticle.parse(request.body ?? {});
    const summary = await ai.summarizeArticle(
      userId(request),
      id,
      promptId,
      regenerate,
      credential,
    );
    return summary ?? missing(reply, "Article");
  });

  app.post("/api/articles/:id/translation", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { sourceKind, credential } = inputs.translateArticle.parse(request.body);
    const translation = await ai.translateArticle(userId(request), id, sourceKind, credential);
    return translation ?? missing(reply, "Article");
  });
}
