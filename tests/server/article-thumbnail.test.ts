import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { ApplicationApi } from "../../src/server/application-api.js";
import { ArticleThumbnailService } from "../../src/server/article-thumbnail.js";
import { AppDatabase } from "../../src/server/database.js";
import { AuthService } from "../../src/server/features/auth/service.js";
import { createApplicationServices } from "../../src/server/runtime/application-runtime.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
  const original = await sharp({
    create: { width: 720, height: 1080, channels: 3, background: "#287846" },
  })
    .png()
    .toBuffer();
  let requests = 0;
  let available = true;
  const source = createServer((request, response) => {
    requests++;
    if (!available) return response.writeHead(503).end();
    if (request.url === "/oversized") return response.end(Buffer.alloc(16 * 1024 * 1024 + 1));
    if (request.url === "/large-dimensions")
      return response.end('<svg xmlns="http://www.w3.org/2000/svg" width="10000" height="10000"/>');
    return response.writeHead(200, { "Content-Type": "image/png" }).end(original);
  });
  await new Promise<void>((resolve) => source.listen(0, "127.0.0.1", resolve));
  cleanups.push(
    () =>
      new Promise<void>((resolve, reject) =>
        source.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const origin = `http://127.0.0.1:${(source.address() as AddressInfo).port}`;
  const database = new AppDatabase(":memory:");
  cleanups.push(() => database.close());
  // Real loopback HTTP source; production's public-network boundary is checked separately below.
  const thumbnails = new ArticleThumbnailService(database.quotas, fetch);
  const services = createApplicationServices({
    database,
    credentialCipher: null,
    articleThumbnailService: thumbnails,
  });
  cleanups.push(async () => {
    await services.webFeedService.close();
    await Promise.all([services.refreshService.stop(), services.extractionQueue.stop()]);
  });
  return {
    database,
    services,
    thumbnails,
    original,
    origin,
    requests: () => requests,
    setAvailable: (value: boolean) => {
      available = value;
    },
  };
}

describe("article thumbnails", () => {
  it("crops real image responses to the queue size and screen density", async () => {
    const { thumbnails, origin } = await fixture();
    for (const [size, density, width, height] of [
      ["small", 3, 228, 228],
      ["medium", 2, 236, 176],
      ["large", 2, 308, 240],
    ] as const) {
      const image = await thumbnails.image(`${origin}/image`, { size, density });
      expect(await sharp(image).metadata()).toMatchObject({ format: "webp", width, height });
    }
  });

  it("shares concurrent image requests and reuses a completed thumbnail", async () => {
    const { thumbnails, origin, requests } = await fixture();
    const options = { size: "small", density: 3 } as const;
    const [first, second] = await Promise.all([
      thumbnails.image(`${origin}/image`, options),
      thumbnails.image(`${origin}/image`, options),
    ]);
    expect(first.equals(second)).toBe(true);
    expect((await thumbnails.image(`${origin}/image`, options)).equals(first)).toBe(true);
    expect(requests()).toBe(1);
    await thumbnails.image(`${origin}/updated-image`, options);
    expect(requests()).toBe(2);
  });

  it("can retry when the upstream image becomes available", async () => {
    const { thumbnails, origin, setAvailable, requests } = await fixture();
    setAvailable(false);
    await expect(
      thumbnails.image(`${origin}/image`, { size: "small", density: 1 }),
    ).rejects.toThrow("unavailable");
    setAvailable(true);
    expect(
      await sharp(
        await thumbnails.image(`${origin}/image`, { size: "small", density: 1 }),
      ).metadata(),
    ).toMatchObject({ width: 76, height: 76 });
    expect(requests()).toBe(2);
  });

  it("rejects images exceeding download and decoded-pixel limits", async () => {
    const { thumbnails, origin } = await fixture();
    await expect(
      thumbnails.image(`${origin}/oversized`, { size: "small", density: 1 }),
    ).rejects.toThrow("too large");
    await expect(
      thumbnails.image(`${origin}/large-dimensions`, { size: "small", density: 1 }),
    ).rejects.toThrow("pixel limit");
  });

  it("does not fetch private-network images through the production fetcher", async () => {
    const { database, origin, requests } = await fixture();
    await expect(
      new ArticleThumbnailService(database.quotas).image(`${origin}/image`, {
        size: "small",
        density: 1,
      }),
    ).rejects.toThrow("not public");
    expect(requests()).toBe(0);
  });

  it("serves the owner's thumbnail over HTTP and desktop while preserving the original article", async () => {
    const { database, services, origin, requests } = await fixture();
    const auth = new AuthService(database.auth, 20, { registrationMode: "open", maxAccounts: 2 });
    const owner = await auth.register("thumbnail-owner", "reader-password");
    const other = await auth.register("thumbnail-other", "reader-password");
    if (!owner || !other) throw new Error("Could not create thumbnail readers");
    const feed = database.feeds.createFeed(1, {
      title: "Photos",
      feedUrl: "https://example.test/photos.xml",
    });
    database.feeds.completeSourceRefresh(database.feeds.sourceIdForFeed(feed.id), {
      httpStatus: 200,
      etag: null,
      lastModified: null,
      parsed: {
        title: "Photos",
        siteUrl: "https://example.test",
        articles: [
          {
            externalId: "photo",
            title: "A photograph",
            url: "https://example.test/photo",
            author: null,
            publishedAt: null,
            summary: "A photograph",
            imageUrl: `${origin}/image`,
            feedContentHtml: `<img src="${origin}/image" alt="Original photograph">`,
          },
        ],
      },
    });
    const article = database.articles.listArticlePage(1, { state: "all" }).articles[0];
    if (!article) throw new Error("Missing photo article");
    const before = database.articles.getArticle(1, article.id);
    const app = await createApp({ ...services, authService: auth });
    cleanups.push(() => app.close());
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const path = `/api/articles/${article.id}/thumbnail/small/3`;
    const login = await fetch(`${address}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "thumbnail-owner", password: "reader-password" }),
    });
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new Error("Missing owner cookie");
    const response = await fetch(address + path, { headers: { cookie } });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await sharp(Buffer.from(await response.arrayBuffer())).metadata()).toMatchObject({
      width: 228,
      height: 228,
    });
    const desktop = new ApplicationApi(services);
    expect(
      await sharp(await desktop.articleThumbnail(article.id, "small", "3")).metadata(),
    ).toMatchObject({ width: 228, height: 228 });
    expect(requests()).toBe(1);
    expect(database.articles.getArticle(1, article.id)).toEqual(before);
    expect((await fetch(address + path)).status).toBe(401);
    const otherLogin = await fetch(`${address}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "thumbnail-other", password: "reader-password" }),
    });
    const otherCookie = otherLogin.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect((await fetch(address + path, { headers: { cookie: otherCookie } })).status).toBe(404);
    expect(
      (
        await fetch(`${address}/api/articles/${article.id}/thumbnail/small/100`, {
          headers: { cookie },
        })
      ).status,
    ).toBe(400);
    expect(requests()).toBe(1);
  });
});
