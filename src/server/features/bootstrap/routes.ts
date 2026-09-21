import type { FastifyInstance } from "fastify";
import type { ApplicationService } from "../../application-service.js";
import { browserDeviceId, type UserId } from "../routes.js";

export async function bootstrapRoutes(
  app: FastifyInstance,
  { application, userId }: { application: ApplicationService; userId: UserId },
): Promise<void> {
  app.get("/api/bootstrap", async (request) => {
    return application.bootstrap(userId(request), browserDeviceId(request));
  });
}
