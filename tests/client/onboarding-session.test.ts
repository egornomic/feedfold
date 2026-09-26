// @vitest-environment jsdom
/// <reference types="vite/client" />
import { transferableAbortController } from "node:util";
import { QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import {
  Agent,
  EventSource as HttpEventSource,
  type RequestInit as HttpRequestInit,
  fetch as httpFetch,
} from "undici";
import { assert, expect, it } from "vitest";
import { api } from "../../src/client/api/api.js";
import { httpRequest } from "../../src/client/api/http-request.js";
import { createQueryClient } from "../../src/client/api/query.js";
import { LoginDialog } from "../../src/client/features/auth/auth.js";
import { createApp } from "../../src/server/app.js";
import { AuthService } from "../../src/server/features/auth/service.js";
import { createApplicationRuntime } from "../../src/server/runtime/application-runtime.js";
import { runtimeConfiguration } from "../../src/server/runtime/configuration.js";
import { exposeBrowserGlobals, waitFor } from "./react-harness.js";

it.each(["logout", "account switch", "a failed default Shorts rule"])(
  "allows recovery from %s in onboarding without restarting the app",
  async (scenario) => {
    const runtime = createApplicationRuntime({
      databasePath: ":memory:",
      configuration: runtimeConfiguration({}),
      credentialCipher: null,
    });
    const app = await createApp({
      ...runtime.services,
      authService: new AuthService(runtime.services.database.auth, 20, {
        registrationMode: "open",
        maxAccounts: 20,
      }),
    });
    const origin = await app.listen({ host: "127.0.0.1", port: 0 });
    const browser = new JSDOM('<div id="root"></div>', { url: origin });
    const restore = exposeBrowserGlobals(browser.window);
    const previousFetch = globalThis.fetch;
    const requests = new Agent();
    let cookie = "";
    const previousEventSource = Object.getOwnPropertyDescriptor(globalThis, "EventSource");
    const events = new Agent().compose(
      (dispatch) => (options, handler) => dispatch({ ...options, headers: { cookie } }, handler),
    );
    Object.defineProperty(globalThis, "EventSource", {
      configurable: true,
      value: class extends HttpEventSource {
        constructor(url: string) {
          super(new URL(url, origin), { node: { dispatcher: events } });
        }
      },
    });
    // Supply browser URL resolution and cookie transport to the real HTTP server.
    globalThis.fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      if (cookie) headers.set("cookie", cookie);
      const controller = transferableAbortController();
      const abort = () => controller.abort();
      if (init?.signal?.aborted) abort();
      init?.signal?.addEventListener("abort", abort, { once: true });
      const response = await httpFetch(new URL(String(input), origin), {
        ...(init as HttpRequestInit),
        headers,
        signal: controller.signal,
        dispatcher: requests,
      }).finally(() => init?.signal?.removeEventListener("abort", abort));
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";", 1)[0] ?? "";
      return response as unknown as Response;
    };
    browser.window.document.documentElement.dataset.inputModality = "keyboard";
    const container = browser.window.document.getElementById("root");
    assert(container);
    const root = createRoot(container);
    const client = createQueryClient();
    let dismissed = false;
    let authenticated = false;
    try {
      const user = await api.register("onboarding-revoked", "reader-password");
      if (scenario === "a failed default Shorts rule") {
        runtime.services.database.connection.exec(`
          CREATE TRIGGER reject_default_rule BEFORE INSERT ON rules
          BEGIN SELECT RAISE(ABORT, 'default rule write rejected'); END;
        `);
      }
      await act(async () => {
        root.render(
          createElement(
            QueryClientProvider,
            { client },
            createElement(LoginDialog, {
              initialOnboardingUser: user,
              onAuthenticated: () => {
                authenticated = true;
              },
              onDismiss: () => {
                dismissed = true;
              },
              onReady: () => {},
            }),
          ),
        );
      });
      await waitFor(
        "onboarding to load",
        () => browser.window.document.querySelector(".onboarding-feedback") !== null,
      );
      expect((await api.bootstrap()).feeds).toEqual([]);

      if (scenario === "a failed default Shorts rule") {
        await waitFor(
          "the failed rule error",
          () => browser.window.document.querySelector('[role="alert"]') !== null,
        );
        expect(await api.rules()).toEqual([]);
        runtime.services.database.connection.exec("DROP TRIGGER reject_default_rule");
        const retry = [...browser.window.document.querySelectorAll("button")].find(
          (button) => button.textContent === "Retry",
        );
        assert(retry, "The failed default rule must offer Retry");
        await act(async () => retry.click());
        const account = runtime.services.database.auth.findEnabledUser(user.username);
        assert(account);
        await waitFor("the default rule to persist", () =>
          runtime.services.database.rules
            .listRules(account.id)
            .some((rule) => rule.name === "Hide YouTube Shorts"),
        );
        const rules = await api.rules();
        expect(rules).toHaveLength(1);
        expect(rules[0]).toMatchObject({ name: "Hide YouTube Shorts", enabled: true });
        expect(browser.window.document.querySelector('[role="alert"]')).toBeNull();
        return;
      }

      if (scenario === "logout") await api.logout();
      else await api.register("another-reader", "reader-password");
      await act(async () => {
        await expect(
          httpRequest("/api/youtube", {
            headers: { "X-Feedfold-Account": user.id },
          }),
        ).rejects.toMatchObject({ status: 401 });
      });
      await waitFor(
        "sign-in after revocation",
        () => browser.window.document.querySelector("#auth-heading")?.textContent === "Sign in",
      );
      expect(browser.window.document.querySelector(".onboarding")).toBeNull();
      expect(
        browser.window.document.querySelector('button[aria-label="Close sign in"]'),
      ).not.toBeNull();
      await act(async () => {
        const dialog = browser.window.document.querySelector('[role="dialog"]');
        assert(dialog);
        dialog.dispatchEvent(
          new browser.window.KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      expect(dismissed).toBe(true);
      expect(authenticated).toBe(false);
    } finally {
      await act(async () => root.unmount());
      client.clear();
      await Promise.all([events.destroy(), requests.destroy()]);
      if (previousEventSource)
        Object.defineProperty(globalThis, "EventSource", previousEventSource);
      else Reflect.deleteProperty(globalThis, "EventSource");
      globalThis.fetch = previousFetch;
      restore();
      browser.window.close();
      await app.close();
      await runtime.close();
    }
  },
);
