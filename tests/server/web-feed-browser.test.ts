import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { type Browser, chromium } from "playwright";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../../src/server/database.js";
import { deploymentPolicy } from "../../src/server/deployment-policy.js";
import { PublicNetworkError } from "../../src/server/public-network.js";
import {
  isBlockedNetworkAddress,
  type WebFeedError,
  WebFeedService,
} from "../../src/server/web-feed.js";
import type { WebFeedConfig } from "../../src/shared/types.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function savedArticleConfig(pageUrl: string): WebFeedConfig {
  return {
    pageUrl,
    selectors: {
      item: "main > article",
      link: "a[href]",
      title: "a[href]",
      date: null,
      author: null,
      summary: null,
      image: null,
    },
  };
}

function fixturePage(broken: boolean): string {
  const renderedContent = broken
    ? `<ul id="new-layout">
        <li><a href="/elsewhere/one">Unrelated one</a></li>
        <li><a href="/elsewhere/two">Unrelated two</a></li>
      </ul>`
    : `<section id="openings" aria-label="Latest openings">
        <article class="job-card">
          <h2><a href="/jobs/alpha#overview">Alpha engineer</a></h2>
          <time datetime="2026-07-20T10:00:00Z">20 July</time>
          <span class="byline">Ada</span>
          <p class="summary">Build careful tools.</p>
          <img src="/images/alpha.jpg" alt="">
        </article>
        <article class="job-card">
          <h2><a href="/jobs/beta">Beta designer</a></h2>
          <time datetime="2026-07-21T11:30:00Z">21 July</time>
          <span class="byline">Grace</span>
          <p class="summary">Shape a calmer reader.</p>
          <img src="/images/beta.jpg" alt="">
        </article>
        <article class="job-card">
          <h2><a href="/jobs/gamma">Gamma researcher</a></h2>
          <span class="byline">Lin</span>
          <p class="summary">Explore useful signals.</p>
          <img src="/images/gamma.jpg" alt="">
        </article>
        <article class="job-card duplicate">
          <h2><a href="/jobs/alpha#apply">Alpha engineer application</a></h2>
          <p class="summary">The same role linked twice.</p>
        </article>
      </section>`;
  return `<!doctype html>
    <html>
      <head>
        <title>feedfold fixture</title>
        <link rel="stylesheet" href="/fixture.css">
      </head>
      <body>
        <nav><a href="/account">Account</a><a href="/settings">Settings</a></nav>
        <main>
          <h1>Careers</h1>
          <p>Our security team researches CAPTCHA accessibility and bot verification UX.</p>
          <div id="app"></div>
        </main>
        <form action="/subscribe"><input name="email"><button>Subscribe</button></form>
        <script>
          window.__fixtureScriptRan = true;
          setTimeout(() => {
            document.querySelector("#app").innerHTML = ${JSON.stringify(renderedContent)};
          }, 80);
        </script>
      </body>
    </html>`;
}

describe("web-feed browser loading and network security", () => {
  it("loads all page resources while keeping outbound requests within the shared limit", async () => {
    const database = new AppDatabase(
      ":memory:",
      20,
      deploymentPolicy("public", { outboundRequestsConcurrent: 2 }),
    );
    cleanups.push(async () => database.close());
    let active = 0;
    let peak = 0;
    let completed = 0;
    const server = createServer((request, response) => {
      if (request.url?.startsWith("/script/")) {
        active += 1;
        peak = Math.max(peak, active);
        setTimeout(() => {
          active -= 1;
          completed += 1;
          response.writeHead(200, { "Content-Type": "text/javascript" });
          response.end(`document.querySelector('main').insertAdjacentHTML('beforeend',
            '<article><a href="/entry/${completed}">Release ${completed}</a></article>');`);
        }, 100);
        return;
      }
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(
        `<title>Releases</title><main></main>${Array.from(
          { length: 12 },
          (_, i) => `<script defer src="/script/${i}"></script>`,
        ).join("")}`,
      );
    });
    const baseUrl = await listen(server);
    const service = new WebFeedService({ allowPrivateNetworks: true, quotas: database.quotas });
    cleanups.push(() => service.close());
    const analysis = await service.analyze("1", baseUrl);
    expect(analysis.candidates.some((candidate) => candidate.itemCount === 12)).toBe(true);
    expect(completed).toBe(12);
    expect(peak).toBe(2);
    expect(database.connection.prepare("SELECT COUNT(*) FROM quota_leases").pluck().get()).toBe(0);
  }, 15_000);

  it("cancels queued resources and releases capacity when the browser closes", async () => {
    const database = new AppDatabase(
      ":memory:",
      20,
      deploymentPolicy("public", { outboundRequestsConcurrent: 1 }),
    );
    cleanups.push(async () => database.close());
    let scriptRequests = 0;
    let scriptStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      scriptStarted = resolve;
    });
    const server = createServer((request, response) => {
      if (request.url?.startsWith("/script/")) {
        scriptRequests += 1;
        scriptStarted();
        return;
      }
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(
        `<title>Releases</title><main></main>${Array.from(
          { length: 12 },
          (_, i) => `<script defer src="/script/${i}"></script>`,
        ).join("")}`,
      );
    });
    const baseUrl = await listen(server);
    const service = new WebFeedService({ allowPrivateNetworks: true, quotas: database.quotas });
    cleanups.push(() => service.close());
    const analysis = service.analyze("1", baseUrl);
    const rejected = expect(analysis).rejects.toBeInstanceOf(Error);
    await started;
    await service.close();
    await rejected;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(scriptRequests).toBe(1);
    expect(database.connection.prepare("SELECT COUNT(*) FROM quota_leases").pluck().get()).toBe(0);
    await expect(database.quotas.runOutbound(async () => "available")).resolves.toBe("available");
  });

  it("allows public addresses while rejecting private and reserved networks", () => {
    expect(isBlockedNetworkAddress("140.82.121.3")).toBe(false);
    expect(isBlockedNetworkAddress("104.18.37.130")).toBe(false);
    expect(isBlockedNetworkAddress("2606:4700:4700::1111")).toBe(false);
    expect(isBlockedNetworkAddress("127.0.0.1")).toBe(true);
    expect(isBlockedNetworkAddress("192.168.1.1")).toBe(true);
    expect(isBlockedNetworkAddress("::1")).toBe(true);
    expect(isBlockedNetworkAddress("not-an-address")).toBe(true);
  });

  it("loads JavaScript-rendered items and captures their computed styles", async () => {
    const server = createServer((request, response) => {
      if (request.url === "/fixture.css") {
        response.writeHead(200, { "Content-Type": "text/css" });
        response.end(`
          #openings { display: grid; grid-template-columns: 240px 240px; color: rgb(17, 34, 51); }
          .job-card { padding: 13px; background-color: rgb(231, 239, 247); border-radius: 7px; }
        `);
        return;
      }
      if (request.url?.startsWith("/images/")) {
        response.writeHead(204).end();
        return;
      }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(fixturePage(false));
    });
    const baseUrl = await listen(server);
    let now = Date.parse("2026-07-27T12:00:00Z");
    const service = new WebFeedService({
      allowPrivateNetworks: true,
      now: () => now,
      settleQuietMs: 150,
      settleTimeoutMs: 3_000,
      snapshotTtlMs: 1_000,
    });
    cleanups.push(() => service.close());

    const analysis = await service.analyze("owner", baseUrl);
    expect(analysis).toMatchObject({
      pageUrl: `${baseUrl}/`,
      title: "feedfold fixture",
      savedSelectionMatched: false,
      selectedCandidateId: null,
    });
    const candidate = analysis.candidates.find(
      (suggestion) => suggestion.label === "Latest openings",
    );
    expect(candidate?.articles.map((article) => article.title)).toEqual([
      "Alpha engineer",
      "Beta designer",
      "Gamma researcher",
    ]);

    const snapshot = service.snapshot("owner", analysis.snapshotId);
    expect(snapshot).toContain("display: grid");
    expect(snapshot).toContain("background-color: rgb(231, 239, 247)");
    expect(() => service.snapshot("someone-else", analysis.snapshotId)).toThrowError(
      expect.objectContaining({ kind: "inaccessible" }),
    );

    now += 1_001;
    expect(() => service.snapshot("owner", analysis.snapshotId)).toThrowError(
      expect.objectContaining({ kind: "inaccessible" }),
    );
  }, 15_000);
  it("rejects private-network pages before launching a browser", async () => {
    let launched = false;
    const service = new WebFeedService({
      browserFactory: async () => {
        launched = true;
        throw new Error("The browser should not launch");
      },
    });
    cleanups.push(() => service.close());

    await expect(service.analyze("owner", "http://127.0.0.1/private")).rejects.toMatchObject({
      kind: "inaccessible",
    } satisfies Partial<WebFeedError>);
    expect(launched).toBe(false);
  });

  it("uses the rendered document when a deferred resource never finishes loading", async () => {
    const server = createServer((request, response) => {
      if (request.url === "/stalled.js") {
        response.writeHead(200, { "Content-Type": "text/javascript" });
        response.write("/* This response intentionally remains open.");
        return;
      }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
        <title>Available releases</title>
        <script defer src="/stalled.js"></script>
        <main>
          <article><h2><a href="/one">Release one</a></h2></article>
          <article><h2><a href="/two">Release two</a></h2></article>
          <article><h2><a href="/three">Release three</a></h2></article>
        </main>`);
    });
    const baseUrl = await listen(server);
    const service = new WebFeedService({
      allowPrivateNetworks: true,
      timeoutMs: 1_000,
      settleQuietMs: 100,
      settleTimeoutMs: 500,
    });
    cleanups.push(() => service.close());

    const analysis = await service.analyze("owner", baseUrl);
    expect(analysis.candidates[0]).toMatchObject({
      itemCount: 3,
      articles: [{ title: "Release one" }, { title: "Release two" }, { title: "Release three" }],
    });
  });

  it("waits for a saved selection whose items appear after delayed JavaScript", async () => {
    const delayed = true;
    const server = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
        <title>Late items</title>
        <main id="app"></main>
        <script>
          const render = () => {
            document.querySelector("#app").innerHTML =
              '<article class="card"><a href="/one">One</a></article>' +
              '<article class="card"><a href="/two">Two</a></article>' +
              '<article class="card"><a href="/three">Three</a></article>';
          };
          ${delayed ? "setTimeout(render, 1500)" : "render()"};
        </script>`);
    });
    const baseUrl = await listen(server);
    const service = new WebFeedService({
      allowPrivateNetworks: true,
      settleQuietMs: 100,
      settleTimeoutMs: 2_500,
    });
    cleanups.push(() => service.close());

    const refreshed = await service.extract(savedArticleConfig(baseUrl));
    expect(refreshed.parsed.articles.map((article) => article.title)).toEqual([
      "One",
      "Two",
      "Three",
    ]);
  }, 15_000);

  it("keeps a saved selection valid when its matching group shrinks", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
        <title>Current releases</title>
        <main>
          <article class="card"><a href="/new-year">First release of the new year</a></article>
        </main>`);
    });
    const baseUrl = await listen(server);
    const service = new WebFeedService({
      allowPrivateNetworks: true,
      settleQuietMs: 100,
      settleTimeoutMs: 500,
    });
    cleanups.push(() => service.close());

    const refreshed = await service.extract(savedArticleConfig(baseUrl));

    expect(refreshed.parsed.articles.map((article) => article.title)).toEqual([
      "First release of the new year",
    ]);
  });

  it("waits through the configured window for a slowly rendered saved selection", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
        <title>Slow catalogue</title>
        <main><p>Loading items</p></main>
        <script>
          setTimeout(() => {
            document.querySelector("main").innerHTML =
              '<article><a href="/one">One</a></article>' +
              '<article><a href="/two">Two</a></article>' +
              '<article><a href="/three">Three</a></article>';
          }, 5200);
        </script>`);
    });
    const baseUrl = await listen(server);
    const service = new WebFeedService({
      allowPrivateNetworks: true,
      settleQuietMs: 100,
      settleTimeoutMs: 6_500,
    });
    cleanups.push(() => service.close());

    const refreshed = await service.extract(savedArticleConfig(baseUrl));

    expect(refreshed.parsed.articles.map((article) => article.title)).toEqual([
      "One",
      "Two",
      "Three",
    ]);
  }, 15_000);

  it("keeps a pending SPA request as a temporary JavaScript timeout", async () => {
    const server = createServer((request, response) => {
      if (request.url === "/items") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.write("[");
        return;
      }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
        <title>Pending catalogue</title>
        <main><p>Loading items</p></main>
        <script>
          fetch("/items")
            .then((response) => response.json())
            .then((items) => {
              document.querySelector("main").innerHTML = items.join("");
            })
            .catch(() => undefined);
        </script>`);
    });
    const baseUrl = await listen(server);
    const service = new WebFeedService({
      allowPrivateNetworks: true,
      settleQuietMs: 100,
      settleTimeoutMs: 500,
    });
    cleanups.push(() => service.close());

    await expect(service.extract(savedArticleConfig(baseUrl))).rejects.toMatchObject({
      kind: "javascript_timeout",
      httpStatus: 200,
    });
  });

  it("reports a failed SPA data request instead of a broken selection", async () => {
    const server = createServer((request, response) => {
      if (request.url === "/items") {
        response.writeHead(503, { "Content-Type": "application/json" });
        response.end('{"error":"temporarily unavailable"}');
        return;
      }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
        <title>Unavailable catalogue</title>
        <main><p>Loading items</p></main>
        <script>fetch("/items").then(() => undefined).catch(() => undefined);</script>`);
    });
    const baseUrl = await listen(server);
    const service = new WebFeedService({
      allowPrivateNetworks: true,
      settleQuietMs: 100,
      settleTimeoutMs: 500,
    });
    cleanups.push(() => service.close());

    await expect(service.extract(savedArticleConfig(baseUrl))).rejects.toMatchObject({
      kind: "http",
      httpStatus: 503,
    });
  });

  it("launches a fresh browser after the shared browser disconnects", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><title>Recovery</title><main>
        <article><a href="/one">One</a></article>
        <article><a href="/two">Two</a></article>
      </main>`);
    });
    const baseUrl = await listen(server);
    let launches = 0;
    const browsers: Browser[] = [];
    const service = new WebFeedService({
      allowPrivateNetworks: true,
      browserFactory: async () => {
        launches += 1;
        const browser = await chromium.launch({ headless: true });
        browsers.push(browser);
        return browser;
      },
      settleQuietMs: 100,
      settleTimeoutMs: 500,
    });
    cleanups.push(() => service.close());

    await service.extract(savedArticleConfig(baseUrl));
    const firstBrowser = browsers[0];
    if (!firstBrowser) throw new Error("Expected the first browser to launch");
    await firstBrowser.close();
    await service.extract(savedArticleConfig(baseUrl));

    expect(launches).toBe(2);
  });

  it("pins browser connections so resolver rebinding cannot reach loopback", async () => {
    let internalHits = 0;
    const server = createServer((_request, response) => {
      internalHits += 1;
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><title>Internal</title><main>
        <article><a href="/one">One</a></article>
        <article><a href="/two">Two</a></article>
      </main>`);
    });
    const baseUrl = await listen(server);
    const port = new URL(baseUrl).port;
    const service = new WebFeedService({
      browserFactory: () =>
        chromium.launch({
          args: ["--host-resolver-rules=MAP example.com 127.0.0.1"],
          headless: true,
        }),
      publicAddressResolver: async () => ({ address: "203.0.113.1", family: 4 }),
      timeoutMs: 500,
      settleQuietMs: 100,
      settleTimeoutMs: 500,
    });
    cleanups.push(() => service.close());

    await expect(service.analyze("owner", `http://example.com:${port}`)).rejects.toBeInstanceOf(
      Error,
    );
    expect(internalHits).toBe(0);
  });

  it("does not offer item groups that link to private destinations", async () => {
    let articleHits = 0;
    const articleServer = createServer((_request, response) => {
      articleHits += 1;
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end("<!doctype html><title>Private article</title>");
    });
    const articleBaseUrl = await listen(articleServer);
    const pageServer = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><title>Public shell</title><main>
        <article><a href="${articleBaseUrl}/one">One</a></article>
        <article><a href="${articleBaseUrl}/two">Two</a></article>
      </main>`);
    });
    const pageBaseUrl = await listen(pageServer);
    const pagePort = new URL(pageBaseUrl).port;
    const service = new WebFeedService({
      browserFactory: () =>
        chromium.launch({
          args: ["--host-resolver-rules=MAP public.test 127.0.0.1"],
          headless: true,
        }),
      publicAddressResolver: async (hostname) => {
        if (hostname === "public.test") return { address: "127.0.0.1", family: 4 };
        throw new PublicNetworkError(
          "This address is not a publicly accessible webpage.",
          "inaccessible",
        );
      },
      settleQuietMs: 100,
      settleTimeoutMs: 500,
    });
    cleanups.push(() => service.close());

    await expect(service.analyze("owner", `http://public.test:${pagePort}`)).rejects.toMatchObject({
      kind: "unsupported_content",
    });
    expect(articleHits).toBe(0);
  });

  it("reports an unfinished document as a loading failure instead of unsupported content", async () => {
    let stalled = false;
    const server = createServer((request, response) => {
      if (request.url === "/stalled.js") {
        response.writeHead(200, { "Content-Type": "text/javascript" });
        response.write("/* This parser-blocking response intentionally remains open.");
        return;
      }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
        <title>Delayed catalogue</title>
        ${stalled ? '<script src="/stalled.js"></script>' : ""}
        <main>
          <article><a href="/one">Item one</a></article>
          <article><a href="/two">Item two</a></article>
        </main>`);
    });
    const baseUrl = await listen(server);
    const service = new WebFeedService({
      allowPrivateNetworks: true,
      timeoutMs: 500,
      settleQuietMs: 100,
      settleTimeoutMs: 300,
    });
    cleanups.push(() => service.close());

    const config = savedArticleConfig(baseUrl);
    await service.extract(config);
    stalled = true;

    await expect(service.analyze("owner", baseUrl)).rejects.toMatchObject({
      kind: "javascript_timeout",
      httpStatus: 200,
    });
    await expect(service.extract(config)).rejects.toMatchObject({
      kind: "javascript_timeout",
      httpStatus: 200,
    });
  });

  it("distinguishes a specific bot-protection page from legitimate CAPTCHA content", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(
        "<!doctype html><title>Security check</title><main><h1>Verify you are human</h1></main>",
      );
    });
    const baseUrl = await listen(server);
    const service = new WebFeedService({
      allowPrivateNetworks: true,
      settleQuietMs: 100,
      settleTimeoutMs: 1_000,
    });
    cleanups.push(() => service.close());

    await expect(service.analyze("owner", baseUrl)).rejects.toMatchObject({
      kind: "access_blocked",
      httpStatus: 200,
    });
  });
});
