import type { FastifyInstance } from "fastify";
import { inputs } from "../../../shared/api/inputs.js";
import type { UserId } from "../routes.js";
import type { SettingsService } from "./service.js";

export async function settingsRoutes(
  app: FastifyInstance,
  { settings, userId }: { settings: SettingsService; userId: UserId },
): Promise<void> {
  app.patch("/api/settings", async (request) =>
    settings.updateSettings(userId(request), inputs.updateSettings.parse(request.body)),
  );
}
