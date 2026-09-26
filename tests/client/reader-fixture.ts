import { JSDOM } from "jsdom";
import { act, createElement, type ReactElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ApplicationApi } from "../../src/server/application-api.js";
import { AppDatabase } from "../../src/server/database.js";
import { ApplicationApiError } from "../../src/server/errors.js";
import { createApplicationServices } from "../../src/server/runtime/application-runtime.js";
import type { ApiOperation, ApiOutput, ApiRequest } from "../../src/shared/api/operations.js";
import type { DesktopResponse, FeedfoldDesktopBridge } from "../../src/shared/desktop.js";
import { completeFeedRefresh } from "../helpers/feeds.js";
import { exposeBrowserGlobals } from "./react-harness.js";

export function readerFixture(path = "/articles/unread", count = 10) {
  const database = new AppDatabase(":memory:");
  for (const feed of database.feeds.listFeeds(1)) database.feeds.deleteFeed(1, feed.id);
  const feed = database.feeds.createFeed(1, {
    title: "Reading queue",
    feedUrl: "https://example.test/reading.xml",
  });
  const refresh = { httpStatus: 200, etag: null, lastModified: null };
  completeFeedRefresh(database.feeds, feed.id, {
    ...refresh,
    parsed: { title: feed.title, siteUrl: null, articles: [] },
  });
  completeFeedRefresh(database.feeds, feed.id, {
    ...refresh,
    parsed: {
      title: feed.title,
      siteUrl: null,
      articles: Array.from({ length: count }, (_, index) => ({
        externalId: `article-${index}`,
        title: `Article ${index + 1}`,
        url: null,
        author: null,
        publishedAt: new Date(Date.UTC(2026, 8, 22, 12, 0, -index)).toISOString(),
        summary: `Summary ${index + 1}`,
        imageUrl: null,
        feedContentHtml: `<p>Full content ${index + 1}</p>`,
      })),
    },
  });
  const services = createApplicationServices({ database, credentialCipher: null });
  const application = new ApplicationApi(services);
  const gates = new Map<
    ApiOperation,
    { wait: Promise<void>; release: () => void; held: number; beforeRequest: boolean }
  >();
  const failures: Error[] = [];
  const invoke = async <K extends ApiOperation>(
    request: ApiRequest<K>,
  ): Promise<DesktopResponse<ApiOutput<K>>> => {
    try {
      const gate = gates.get(request.operation);
      if (gate?.beforeRequest) {
        gate.held += 1;
        await gate.wait;
      }
      const value = await application.invoke(request);
      if (gate && !gate.beforeRequest) {
        gate.held += 1;
        await gate.wait;
      }
      return { ok: true, value };
    } catch (error) {
      if (error instanceof Error) failures.push(error);
      return {
        ok: false,
        error: {
          message: error instanceof Error ? error.message : String(error),
          status: error instanceof ApplicationApiError ? error.status : 500,
          code: error instanceof ApplicationApiError ? error.code : null,
        },
      };
    }
  };
  const bridge: FeedfoldDesktopBridge = {
    platform: "desktop",
    invoke,
    exportOpml: async () => ({ ok: true, value: undefined }),
    onDataChanged: (listener) => services.refreshService.subscribe(1, listener),
  };
  const dom = new JSDOM('<div id="app"></div>', {
    pretendToBeVisual: true,
    url: `https://feedfold.test${path}`,
  });
  Object.defineProperty(dom.window, "feedfoldDesktop", { value: bridge });
  Object.defineProperty(dom.window, "matchMedia", {
    value: (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      addEventListener() {},
      removeEventListener() {},
    }),
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "scrollIntoView", { value: () => {} });
  dom.window.document.documentElement.dataset.inputModality = "keyboard";
  const restore = exposeBrowserGlobals(dom.window);
  const observers = new Set<() => void>();
  const previousObserver = Object.getOwnPropertyDescriptor(globalThis, "IntersectionObserver");
  Object.defineProperty(globalThis, "IntersectionObserver", {
    configurable: true,
    value: class {
      readonly notify: () => void;
      constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
        this.notify = () => callback([{ isIntersecting: true }]);
      }
      observe() {
        observers.add(this.notify);
      }
      disconnect() {
        observers.delete(this.notify);
      }
    },
  });
  const previousActEnvironment = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  const container = dom.window.document.querySelector<HTMLElement>("#app");
  if (!container) throw new Error("The reader fixture is incomplete");
  const root = createRoot(container);

  return {
    database,
    services,
    feed,
    application,
    failures,
    container,
    dom,
    async reachListEnd() {
      await act(async () => {
        for (const notify of [...observers]) notify();
      });
    },
    hold(operation: ApiOperation, beforeRequest = false) {
      let resolve = () => {};
      let reject: (error: Error) => void = () => {};
      const gate = {
        beforeRequest,
        held: 0,
        wait: new Promise<void>((done, fail) => {
          resolve = done;
          reject = fail;
        }),
        release() {
          gates.delete(operation);
          resolve();
        },
        fail() {
          gates.delete(operation);
          reject(new ApplicationApiError(503, "The list is temporarily unavailable"));
        },
      };
      gates.set(operation, gate);
      return gate;
    },
    async mount(element?: ReactElement) {
      const modulePath: string = "../../src/client/app/app.js";
      const { App } = await import(modulePath);
      await act(async () =>
        root.render(createElement(StrictMode, null, element ?? createElement(App))),
      );
    },
    async close() {
      await act(async () => {
        for (const gate of gates.values()) gate.release();
        root.unmount();
      });
      await Promise.all([services.refreshService.stop(), services.extractionQueue.stop()]);
      await services.webFeedService.close();
      database.close();
      await new Promise((resolve) => setTimeout(resolve, 0));
      dom.window.close();
      restore();
      if (previousObserver)
        Object.defineProperty(globalThis, "IntersectionObserver", previousObserver);
      else Reflect.deleteProperty(globalThis, "IntersectionObserver");
      if (previousActEnvironment === undefined)
        Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
      else Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousActEnvironment);
    },
  };
}
