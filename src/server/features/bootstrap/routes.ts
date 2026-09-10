import type { FastifyInstance } from "fastify";
import type { AiService } from "../ai/service.js";
import { browserDeviceId, type UserId } from "../routes.js";
import type { BootstrapService } from "./service.js";

export async function bootstrapRoutes(
  app: FastifyInstance,
  { bootstrap, ai, userId }: { bootstrap: BootstrapService; ai: AiService; userId: UserId },
): Promise<void> {
  app.get("/api/bootstrap", async (request) => {
    const accountId = userId(request);
    return {
      ...bootstrap.getBootstrap(accountId),
      aiSettings: ai.getSettings(accountId, browserDeviceId(request)),
    };
  });
}
