import { existsSync, mkdirSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { createDemoData } from "../../src/demo/fixtures.js";
import { AppDatabase } from "../../src/server/database.js";
import { AuthService } from "../../src/server/features/auth/service.js";

const directory = resolve(".codex/runtime");
const path = resolve(directory, "feedfold.db");
if (!existsSync(path)) {
  mkdirSync(directory, { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  const database = new AppDatabase(temporaryPath);
  try {
    const auth = new AuthService(database.auth, 20, { registrationMode: "open" });
    const session = await auth.register("demo", "demo");
    if (!session) throw new Error("Could not create the development account");
    const userId = session.user.id;
    const demo = createDemoData();
    database.connection.transaction(() => {
      const folders = new Map(
        demo.folders.map((folder) => [
          folder.id,
          database.folders.createFolder(userId, { name: folder.name }).id,
        ]),
      );
      for (const source of demo.feeds.filter((feed) => feed.sourceKind === "published")) {
        const feed = database.feeds.createFeed(userId, {
          title: source.title,
          feedUrl: source.feedUrl,
          siteUrl: source.siteUrl,
          folderId: source.folderId === null ? null : folders.get(source.folderId),
        });
        database.feeds.completeSourceRefresh(database.feeds.sourceIdForFeed(feed.id), {
          httpStatus: 200,
          etag: null,
          lastModified: null,
          parsed: {
            title: source.title,
            siteUrl: source.siteUrl,
            articles: demo.articles
              .filter((article) => article.feedId === source.id)
              .map((article) => ({ ...article, externalId: String(article.id) })),
          },
        });
        database.feeds.updateFeed(userId, feed.id, { paused: true });
      }
    })();
    auth.endSession(session.token);
  } finally {
    database.close();
  }
  renameSync(temporaryPath, path);
  console.log("Development account: demo / demo (sample feeds are paused).");
}
