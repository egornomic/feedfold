import { createApp } from "../../src/server/app.js";
import type { AppDatabase } from "../../src/server/database.js";
import type { AuthService } from "../../src/server/features/auth/service.js";
import { ExtractionQueue } from "../../src/server/features/extraction/queue.js";
import { FeedRefreshService } from "../../src/server/features/refresh/service.js";
import { DefaultFeedSourceLoader } from "../../src/server/feed-source-loader.js";
import { createApplicationServices } from "../../src/server/runtime/application-runtime.js";

export async function createTestApp(database: AppDatabase, authService: AuthService) {
  const extraction = new ExtractionQueue(database.extractions, 1, 1_000);
  const refresh = new FeedRefreshService(
    database.feeds,
    new DefaultFeedSourceLoader((task) => database.feeds.runOutbound(task), 1_000),
    1,
  );
  const app = await createApp({
    ...createApplicationServices({
      credentialCipher: null,
      database,
      extractionQueue: extraction,
      refreshService: refresh,
    }),
    authService,
  });

  return {
    app,
    async close() {
      await app.close();
      await Promise.all([refresh.stop(), extraction.stop()]);
    },
  };
}
