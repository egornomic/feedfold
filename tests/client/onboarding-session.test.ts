// @vitest-environment jsdom
/// <reference types="vite/client" />
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { assert, expect, it } from "vitest";
import { api } from "../../src/client/api/api.js";
import { httpRequest } from "../../src/client/api/http-request.js";
import { LoginDialog } from "../../src/client/features/auth/auth.js";
import { createApp } from "../../src/server/app.js";
import { AuthService } from "../../src/server/features/auth/service.js";
import { createApplicationRuntime } from "../../src/server/runtime/application-runtime.js";
import { runtimeConfiguration } from "../../src/server/runtime/configuration.js";
import { exposeBrowserGlobals, waitFor } from "./react-harness.js";

it.each(["logout", "account switch"])(
  "returns onboarding to a dismissible sign-in dialog after %s",
  async (revocation) => {
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
    const nativeFetch = globalThis.fetch;
    let cookie = "";
    // Supply browser URL resolution and cookie transport to the real HTTP server.
    globalThis.fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      if (cookie) headers.set("cookie", cookie);
      const response = await nativeFetch(new URL(String(input), origin), { ...init, headers });
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";", 1)[0] ?? "";
      return response;
    };
    browser.window.document.documentElement.dataset.inputModality = "keyboard";
    const container = browser.window.document.getElementById("root");
    assert(container);
    const root = createRoot(container);
    let dismissed = false;
    let authenticated = false;
    try {
      const user = await api.register("onboarding-revoked", "reader-password");
      await act(async () => {
        root.render(
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
        );
      });
      await waitFor(
        "onboarding to load",
        () => browser.window.document.querySelector(".onboarding-feedback") !== null,
      );
      expect((await api.bootstrap()).feeds).toEqual([]);

      if (revocation === "logout") await api.logout();
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
      globalThis.fetch = nativeFetch;
      restore();
      browser.window.close();
      await app.close();
      await runtime.close();
    }
  },
);
