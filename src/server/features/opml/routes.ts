import type { FastifyInstance } from "fastify";
import { inputs } from "../../../shared/api-inputs.js";
import type { ApplicationService } from "../../application-service.js";
import type { UserId } from "../routes.js";
import type { OpmlService } from "./service.js";

export async function opmlRoutes(
  app: FastifyInstance,
  {
    opml,
    application,
    userId,
  }: { opml: OpmlService; application: ApplicationService; userId: UserId },
): Promise<void> {
  app.post("/api/opml/import", async (request) => {
    const { opml: source } = inputs.importOpml.parse(request.body);
    return application.importOpml(userId(request), source);
  });

  app.get("/api/opml/export", async (request, reply) => {
    return reply
      .header("Content-Type", "text/x-opml; charset=utf-8")
      .header("Content-Disposition", 'attachment; filename="feedfold-subscriptions.opml"')
      .send(opml.export(userId(request)));
  });
}
