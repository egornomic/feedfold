import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { AppDatabase } from "../../src/server/database.js";
import { AuthService } from "../../src/server/features/auth/service.js";
import { ExtractionQueue } from "../../src/server/features/extraction/queue.js";
import { FeedRefreshService } from "../../src/server/features/refresh/service.js";
import { DefaultFeedSourceLoader } from "../../src/server/feed-source-loader.js";
import { createApplicationServices } from "../../src/server/runtime/application-runtime.js";

describe("production app hosting", () => {
  const securityContact =
    "Contact: https://example.test/private-report\nExpires: 2027-01-01T00:00:00Z\n";
  let directory: string;
  let database: AppDatabase;
  let extraction: ExtractionQueue;
  let refresh: FeedRefreshService;
  let app: FastifyInstance;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "feedfold-static-hosting-test-"));
    const staticDirectory = join(directory, "client");
    const demoDirectory = join(directory, "demo");
    await mkdir(join(staticDirectory, "assets"), { recursive: true });
    await mkdir(join(staticDirectory, ".well-known"));
    await mkdir(join(demoDirectory, "assets"), { recursive: true });
    await Promise.all([
      writeFile(join(staticDirectory, "index.html"), "<main>feedfold shell</main>"),
      writeFile(join(staticDirectory, ".well-known", "security.txt"), securityContact),
      writeFile(join(staticDirectory, "assets", "app.css"), "body { color: green; }"),
      writeFile(join(staticDirectory, "assets", "app-aB12_3-4.js"), "export default 1;"),
      writeFile(join(staticDirectory, "sw.js"), "self.addEventListener('fetch', () => {});"),
      writeFile(join(demoDirectory, "index.html"), "<main>feedfold demo</main>"),
      writeFile(join(demoDirectory, "assets", "app.css"), "body { color: blue; }"),
      writeFile(join(demoDirectory, "assets", "app-12345678.css"), "body { color: blue; }"),
    ]);

    database = new AppDatabase(join(directory, "feedfold.db"), 20);
    const authService = new AuthService(database.auth, 20);
    extraction = new ExtractionQueue(database.extractions, 1, 1_000);
    refresh = new FeedRefreshService(
      database.feeds,
      new DefaultFeedSourceLoader((task) => database.feeds.runOutbound(task), 1_000),
      1,
    );
    app = await createApp({
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
  });

  afterAll(async () => {
    await app.close();
    await Promise.all([refresh.stop(), extraction.stop()]);
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("serves navigation, assets, and APIs from the application root", async () => {
    const navigation = await app.inject({ method: "GET", url: "/articles/all" });
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
  });

  it("serves the security reporting file as plain text for browsers and file consumers", async () => {
    for (const accept of ["*/*", "text/plain", "text/html"]) {
      const security = await app.inject({
        method: "GET",
        url: "/.well-known/security.txt",
        headers: { accept },
      });
      expect(security.statusCode).toBe(200);
      expect(security.headers["content-type"]).toBe("text/plain; charset=utf-8");
      expect(security.headers["cache-control"]).toBe("no-cache");
      expect(security.body).toBe(securityContact);
    }
    const securityHead = await app.inject({ method: "HEAD", url: "/.well-known/security.txt" });
    expect(securityHead.statusCode).toBe(200);
    expect(securityHead.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(securityHead.body).toBe("");
  });

  const applicationPaths = [
    "/",
    "/articles/unread",
    "/articles/all/",
    "/articles/read",
    "/articles/saved?q=sqlite",
    "/articles/123",
    "/feeds",
    "/feeds/add?type=youtube",
    "/feeds/add/https%3A%2F%2Fexample.com%2Ffeed.xml",
    "/feeds/add/https://example.com/news/feed.xml",
    "/feeds/7/all",
    "/folders/42/read?q=sqlite",
    "/rules",
    "/settings",
    "/settings/appearance",
    "/settings/reading",
    "/settings/feeds",
    "/settings/ai",
    "/settings/account",
  ];

  it.each(applicationPaths)(
    "serves the reader deep link %s and its demo equivalent",
    async (path) => {
      for (const [url, shell] of [
        [path, "<main>feedfold shell</main>"],
        [`/demo${path}`, "<main>feedfold demo</main>"],
      ] as const) {
        const response = await app.inject({ method: "GET", url });
        expect(response.statusCode).toBe(200);
        expect(response.headers["content-type"]).toContain("text/html");
        expect(response.headers["cache-control"]).toBe("no-cache");
        expect(response.body).toBe(shell);
      }
    },
  );

  it.each([
    "/robots.txt",
    "/.well-known/missing.txt",
    "/sitemap.xml",
    "/assets/essential-audit-missing.js",
    "/assets/index-Bv9smjdE.js",
    "/assets/missing.css?version=1",
    "/icons/missing.png",
    "/sw.js/missing",
    "/does-not-exist-audit",
    "/does-not-exist-audit?next=/articles/unread",
    "/feeds/all",
    "/articles/0",
    "/articles/9007199254740992",
    "/articles/unread/extra",
    "/folders/nope/all",
    "/feeds/7/unknown",
    "/settings/unknown",
    "/demo/does-not-exist-audit",
    "/demo/settings/unknown",
    "/demo/assets/missing.js",
    "/demo/assets/index-Bv9smjdE.js?version=1",
    "/demo/robots.txt",
    "/demo/.well-known/security.txt",
    "/demo/sitemap.xml",
  ])("returns a missing response for %s", async (url) => {
    for (const method of ["GET", "HEAD"] as const) {
      const response = await app.inject({ method, url });
      expect(response.statusCode).toBe(404);
      expect(response.headers["content-type"]).toContain("application/json");
      expect(response.headers["cache-control"]).toBe("no-store");
      if (method === "GET") {
        expect(response.json()).toEqual({ error: "This page does not exist." });
      }
    }
  });

  it("serves HEAD navigation without a body and rejects unsupported navigation methods", async () => {
    const head = await app.inject({ method: "HEAD", url: "/articles/unread?q=sqlite" });
    expect(head.statusCode).toBe(200);
    expect(head.headers["content-type"]).toContain("text/html");
    expect(head.body).toBe("");
    for (const method of ["POST", "PUT", "DELETE", "OPTIONS"] as const) {
      const response = await app.inject({ method, url: "/articles/unread" });
      expect(response.statusCode).toBe(404);
      expect(response.headers["content-type"]).toContain("application/json");
    }
  });
});
