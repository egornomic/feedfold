import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type PreviewServer, type ViteDevServer } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { normalizeBasePath } from "./src/shared/base-path";
import { socialUrlMetadata } from "./src/shared/social-metadata";

const apiOrigin = process.env.FEEDFOLD_DEV_API_ORIGIN ?? "http://127.0.0.1:43001";
const devPort = Number(process.env.FEEDFOLD_DEV_PORT ?? 45173);
const demoMode = process.env.VITE_FEEDFOLD_DEMO === "true";
const appBasePath = normalizeBasePath(process.env.FEEDFOLD_BASE_PATH);
const appBaseUrl = `${appBasePath}/`;
const appUrl = (path: string) => `${appBasePath}${path}`;
const appBasePattern = appBasePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const apiPathPattern = `${appBasePattern}/(?:api|health)(?:/|$)`;
const stripBasePath = (path: string) => path.slice(appBasePath.length) || "/";
const demoApiPath = fileURLToPath(new URL("./src/demo/api.ts", import.meta.url));
const stressApiPath = fileURLToPath(new URL("./src/demo/stress-api.ts", import.meta.url));
const stressHttpPath = fileURLToPath(new URL("./src/demo/stress-http.ts", import.meta.url));

function legalPages(server: ViteDevServer | PreviewServer): void {
  server.middlewares.use((request, response, next) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    for (const page of ["privacy", "terms"]) {
      if (url.pathname === appUrl(`/${page}/`)) {
        response.writeHead(308, { Location: `${appUrl(`/${page}`)}${url.search}` });
        response.end();
        return;
      }
      if (url.pathname === appUrl(`/${page}`)) {
        request.url = `${appUrl(`/legal/${page}.html`)}${url.search}`;
        break;
      }
    }
    next();
  });
}

function socialMetadataPlugin(): Plugin {
  const description = demoMode
    ? "Explore feedfold, a quiet, keyboard-first feed reader."
    : "Add RSS feeds and X posts, sync YouTube subscriptions, filter out shorts and other noise, and read a feed you can finish.";
  return {
    name: "feedfold-social-metadata",
    transformIndexHtml(html) {
      return {
        html: demoMode
          ? html.replace("</head>", `${socialUrlMetadata("https://feedfold.com/demo/")}\n</head>`)
          : html,
        tags: [
          { tag: "meta", attrs: { name: "description", content: description } },
          ...Object.entries({
            type: "website",
            title: "feedfold",
            description,
          }).map(([property, content]) => ({
            tag: "meta",
            attrs: { property: `og:${property}`, content },
          })),
          ...Object.entries({
            card: "summary_large_image",
            title: "feedfold",
            description,
          }).map(([name, content]) => ({
            tag: "meta",
            attrs: { name: `twitter:${name}`, content },
          })),
        ],
      };
    },
  };
}

export default defineConfig(({ command }) => ({
  base: appBaseUrl,
  resolve: {
    alias:
      demoMode || command === "serve"
        ? [
            {
              find: /^(?:\.\/|(?:\.\.\/)+)api\/api(?:\.js)?$/,
              replacement: command === "serve" ? stressApiPath : demoApiPath,
            },
            ...(command === "serve"
              ? [
                  {
                    find: /^(?:(?:\.\.\/)+api\/|\.\/)http-request(?:\.js)?$/,
                    replacement: stressHttpPath,
                  },
                ]
              : []),
          ]
        : [],
  },
  plugins: [
    {
      name: "feedfold-legal-pages",
      configureServer: legalPages,
      configurePreviewServer: legalPages,
    },
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      manifest: {
        id: appBaseUrl,
        name: "feedfold",
        short_name: "feedfold",
        description: demoMode
          ? "Explore feedfold with a curated, interactive demo."
          : "A quiet, keyboard-first, self-hosted feed reader.",
        start_url: appBaseUrl,
        scope: appBaseUrl,
        display: "standalone",
        categories: ["news", "productivity"],
        background_color: "#0e0f0e",
        theme_color: "#0e0f0e",
        icons: [
          {
            src: appUrl("/icons/pwa-192.png"),
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: appUrl("/icons/pwa-512.png"),
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
        shortcuts: [
          {
            name: "Unread articles",
            short_name: "Unread",
            url: appUrl("/articles/unread"),
            icons: [{ src: appUrl("/icons/pwa-192.png"), sizes: "192x192" }],
          },
          {
            name: "Saved articles",
            short_name: "Saved",
            url: appUrl("/articles/saved"),
            icons: [{ src: appUrl("/icons/pwa-192.png"), sizes: "192x192" }],
          },
        ],
      },
      workbox: {
        clientsClaim: true,
        skipWaiting: true,
        importScripts: [appUrl("/sw-reload.js")],
        globPatterns: ["**/*.{js,css,html,png}"],
        globIgnores: [
          "og.png",
          "legal/**",
          "**/{feeds,add-feed,rules,settings,shortcut-help,context-dialog,web-feed-setup,folder-form,rule-form,ai-markdown,auto-render,katex}-*.{js,css}",
        ],
        runtimeCaching: [
          {
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin && /\/assets\/[^/]+-[\w-]{8}\.\w+$/.test(url.pathname),
            handler: "CacheFirst",
            options: {
              cacheName: `feedfold${appBasePath}-assets`,
              expiration: { maxEntries: 100, maxAgeSeconds: 31_536_000 },
            },
          },
        ],
        navigateFallback: appUrl("/index.html"),
        navigateFallbackDenylist: [
          new RegExp(`^${appBasePattern}/og\\.png(?:\\?|$)`),
          new RegExp(`^${appBasePattern}/\\.well-known/security\\.txt(?:\\?|$)`),
          /^\/robots\.txt$/,
          new RegExp(`^${appBasePattern}/(?:privacy|terms)(?:/|$)`),
          new RegExp(`^${apiPathPattern}`),
          ...(!demoMode ? [/^\/demo(?:\/|$)/] : []),
        ],
      },
    }),
    socialMetadataPlugin(),
  ],
  root: ".",
  build: {
    outDir: demoMode ? "dist/demo" : "dist/client",
    emptyOutDir: true,
  },
  server: {
    host: "0.0.0.0",
    port: devPort,
    strictPort: true,
    proxy: {
      [appUrl("/api")]: {
        target: apiOrigin,
        rewrite: stripBasePath,
      },
      [appUrl("/health")]: {
        target: apiOrigin,
        rewrite: stripBasePath,
      },
    },
  },
}));
