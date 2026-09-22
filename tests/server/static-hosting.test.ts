import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { AppDatabase } from "../../src/server/database.js";
import { AuthService } from "../../src/server/features/auth/service.js";
import { ExtractionQueue } from "../../src/server/features/extraction/queue.js";
import { FeedRefreshService } from "../../src/server/features/refresh/service.js";
import { DefaultFeedSourceLoader } from "../../src/server/feed-source-loader.js";
import { createApplicationServices } from "../../src/server/runtime/application-runtime.js";

describe("production app hosting", () => {
  it("serves navigation, assets, and APIs from the application root", async () => {
    const directory = await mkdtemp(join(tmpdir(), "feedfold-static-hosting-test-"));
    const staticDirectory = join(directory, "client");
    const demoDirectory = join(directory, "demo");
    await mkdir(join(staticDirectory, "assets"), { recursive: true });
    await mkdir(join(demoDirectory, "assets"), { recursive: true });
    await Promise.all([
      writeFile(join(staticDirectory, "index.html"), "<main>feedfold shell</main>"),
      writeFile(join(staticDirectory, "assets", "app.css"), "body { color: green; }"),
      writeFile(join(staticDirectory, "assets", "app-aB12_3-4.js"), "export default 1;"),
      writeFile(join(staticDirectory, "sw.js"), "self.addEventListener('fetch', () => {});"),
      writeFile(join(demoDirectory, "index.html"), "<main>feedfold demo</main>"),
      writeFile(join(demoDirectory, "assets", "app.css"), "body { color: blue; }"),
      writeFile(join(demoDirectory, "assets", "app-12345678.css"), "body { color: blue; }"),
    ]);

    const database = new AppDatabase(join(directory, "feedfold.db"), 20);
    const authService = new AuthService(database.auth, 20);
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
      staticDir: staticDirectory,
      demoDir: demoDirectory,
    });

    try {
      const navigation = await app.inject({ method: "GET", url: "/feeds/all" });
      expect(navigation.statusCode).toBe(200);
      expect(navigation.body).toBe("<main>feedfold shell</main>");
      expect(navigation.headers["cache-control"]).toBe("no-cache");

      for (const url of ["/assets/app-aB12_3-4.js", "/demo/assets/app-12345678.css"]) {
        const versioned = await app.inject({ method: "GET", url });
        expect(versioned.statusCode).toBe(200);
        expect(versioned.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
      }
      const serviceWorker = await app.inject({ method: "GET", url: "/sw.js" });
      expect(serviceWorker.headers["cache-control"]).toBe("no-cache");

      const asset = await app.inject({ method: "GET", url: "/assets/app.css" });
      expect(asset.statusCode).toBe(200);
      expect(asset.headers["content-type"]).toContain("text/css");
      expect(asset.body).toBe("body { color: green; }");
      expect(asset.headers["cache-control"]).toBe("public, max-age=0");

      const demoRedirect = await app.inject({ method: "GET", url: "/demo" });
      expect(demoRedirect.statusCode).toBe(308);
      expect(demoRedirect.headers.location).toBe("/demo/");
      for (const url of ["/demo/", "/demo/articles/unread", "/demo/settings/appearance"]) {
        const demo = await app.inject({ method: "GET", url });
        expect(demo.statusCode).toBe(200);
        expect(demo.body).toBe("<main>feedfold demo</main>");
      }
      const demoAsset = await app.inject({ method: "GET", url: "/demo/assets/app.css" });
      expect(demoAsset.statusCode).toBe(200);
      expect(demoAsset.body).toBe("body { color: blue; }");

      const api = await app.inject({ method: "GET", url: "/api/auth/session" });
      expect(api.statusCode).toBe(401);
      expect(api.json()).toEqual({ error: "Sign in to continue." });
    } finally {
      await app.close();
      await Promise.all([refresh.stop(), extraction.stop()]);
      database.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
