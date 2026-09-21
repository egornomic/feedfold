import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { inputs } from "../../../shared/api-inputs.js";
import type { ApplicationService } from "../../application-service.js";
import { WebFeedError, type WebFeedService } from "../../web-feed.js";
import { idParams, missing, type UserId } from "../routes.js";
import type { FeedService } from "./service.js";

export async function feedRoutes(
  app: FastifyInstance,
  {
    feeds,
    application,
    webFeedService,
    userId,
  }: {
    feeds: FeedService;
    application: ApplicationService;
    webFeedService?: WebFeedService;
    userId: UserId;
  },
): Promise<void> {
  app.get("/api/feeds", async (request) => ({
    feeds: feeds.listFeeds(userId(request)),
  }));

  app.get("/api/feeds/:id", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const feed = feeds.getFeed(userId(request), id);
    return feed ?? missing(reply, "Feed");
  });

  app.post("/api/feeds/discover", async (request) => {
    const { url } = inputs.url.parse(request.body);
    return application.discoverFeed(userId(request), url);
  });

  app.post("/api/web-feeds/analyze", async (request) => {
    const { url } = inputs.url.parse(request.body);
    return application.analyzeWebPage(userId(request), url);
  });

  app.get(
    "/api/web-feed-snapshots/:id",
    {
      config: { responsePolicy: "webFeedSnapshot" },
    },
    async (request, reply) => {
      if (!webFeedService) return missing(reply, "Page preview");
      const { id } = z.object({ id: z.string().min(1).max(200) }).parse(request.params);
      try {
        const snapshot = webFeedService.snapshot(String(userId(request)), id);
        return reply.type("text/html; charset=utf-8").send(snapshot);
      } catch (error) {
        if (error instanceof WebFeedError) {
          return reply.code(404).send({
            error: "This page preview has expired. Reload the page, then choose the entries again.",
            code: error.kind,
          });
        }
        throw error;
      }
    },
  );

  app.post("/api/feeds", async (request) => {
    return application.createFeed(userId(request), inputs.createFeed.parse(request.body));
  });

  app.post("/api/feeds/:id/web-feed/analyze", async (request) => {
    const { id } = idParams.parse(request.params);
    return application.analyzeWebFeed(userId(request), id);
  });

  app.patch("/api/feeds/:id/web-feed", async (request) => {
    const { id } = idParams.parse(request.params);
    const { config } = inputs.updateWebFeedSelection.parse(request.body);
    return application.updateWebFeedSelection(userId(request), id, config);
  });

  app.patch("/api/feeds/:id", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = inputs.updateFeed.parse(request.body);
    const feed = feeds.updateFeed(userId(request), id, body);
    return feed ?? missing(reply, "Feed");
  });

  app.delete("/api/feeds/:id", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    if (!feeds.deleteFeed(userId(request), id)) return missing(reply, "Feed");
    return reply.code(204).send();
  });

  app.post("/api/feeds/:id/refresh", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const accountId = userId(request);
    if (!feeds.getFeed(accountId, id)) return missing(reply, "Feed");
    return application.refresh(accountId, [id]);
  });
}
