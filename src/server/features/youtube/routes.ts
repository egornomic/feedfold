import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { YouTubeStatus } from "../../../shared/youtube.js";
import { ApplicationApiError } from "../../errors.js";
import { secureRequest } from "../auth/routes.js";
import { type AuthService, sessionToken } from "../auth/service.js";
import type { YouTubeService } from "./service.js";

const callback = z.object({
  state: z.string().min(1).max(200),
  code: z.string().max(4096).optional(),
  error: z.string().max(200).optional(),
});
export const unavailableYouTube: YouTubeStatus = {
  available: false,
  connected: false,
  channelTitle: null,
  lastSyncAt: null,
  nextSyncAt: null,
  feedCount: 0,
  error: null,
};

export async function youtubeRoutes(
  app: FastifyInstance,
  options: {
    youtube: YouTubeService | undefined;
    userId: (request: FastifyRequest) => number;
    basePath: string;
    authService: AuthService;
    publicOrigin: string | undefined;
  },
): Promise<void> {
  const service = () => {
    if (!options.youtube)
      throw new ApplicationApiError(503, "YouTube connections are unavailable.");
    return options.youtube;
  };
  app.get(
    "/api/youtube",
    async (request) => options.youtube?.status(options.userId(request)) ?? unavailableYouTube,
  );
  app.post("/api/youtube/connect", async (request, reply) => {
    const youtube = service();
    const userId = options.userId(request);
    const retryAfter = youtube.consumeConnectionAttempt(userId);
    if (retryAfter !== null) {
      return reply.header("Retry-After", retryAfter).code(429).send({
        error: "Too many YouTube connection attempts. Try again in a few minutes.",
      });
    }
    const token = sessionToken(request.headers.cookie) as string;
    const url = youtube.authorize(userId, token);
    reply.header(
      "Set-Cookie",
      options.authService.sessionCookie(token, secureRequest(request, options.publicOrigin)),
    );
    return { url };
  });
  app.get("/api/youtube/callback", async (request, reply) => {
    const input = callback.safeParse(request.query);
    let result = "failed";
    if (input.success) {
      try {
        const verifier = service().consumeState(
          options.userId(request),
          sessionToken(request.headers.cookie) as string,
          input.data.state,
        );
        if (input.data.error) result = "cancelled";
        else if (input.data.code) {
          await service().connect(options.userId(request), input.data.code, verifier);
          result = "connected";
        }
      } catch {
        /* Do not expose Google's callback or tokens in error output. */
      }
    }
    return reply.redirect(`${options.basePath}/settings/feeds?youtube=${result}`, 303);
  });
  app.delete("/api/youtube", async (request, reply) => {
    await service().disconnect(options.userId(request));
    return reply.code(204).send();
  });
}
