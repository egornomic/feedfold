import type { ServerResponse } from "node:http";
import { QueryObserver } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import { Agent, EventSource } from "undici";
import { expect, it, vi } from "vitest";
import { api } from "../../src/client/api/api.js";
import { createQueryClient, invalidateReader, readerKeys } from "../../src/client/api/query.js";
import { AppDatabase } from "../../src/server/database.js";
import { AuthService } from "../../src/server/features/auth/service.js";
import type { BootstrapData } from "../../src/shared/types.js";
import { createTestApp } from "../helpers/app.js";

it.each(["none", "before-pending", "before-settled", "during"])(
  "reconciles startup, deliveries, and reconnects (startup change: %s)",
  async (startupChange) => {
    const database = new AppDatabase(":memory:");
    const auth = new AuthService(database.auth, 20, { registrationMode: "open" });
    const session = await auth.register("events-reader", "reader-password");
    if (!session) throw new Error("Could not create the reader account");
    const cookie = auth.sessionCookie(session.token, false);
    const server = await createTestApp(database, auth);
    let stream: ServerResponse | undefined;
    let snapshots = 0;
    let release = () => {};
    const initialResponse = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.app.addHook("onRequest", async (request, reply) => {
      if (request.url === "/api/refresh/events") stream = reply.raw;
    });
    server.app.addHook("onSend", async (request, _reply, payload) => {
      if (request.url === "/api/bootstrap" && ++snapshots === 1) await initialResponse;
      return payload;
    });
    const origin = await server.app.listen({ host: "127.0.0.1", port: 0 });
    const dom = new JSDOM("", { url: origin });
    const events = new Agent().compose(
      (dispatch) => (options, handler) => dispatch({ ...options, headers: { cookie } }, handler),
    );
    let connections = 0;
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal(
      "EventSource",
      class extends EventSource {
        constructor(url: string) {
          super(new URL(url, origin), { node: { dispatcher: events } });
          this.addEventListener("connected", () => {
            connections += 1;
          });
        }
      },
    );
    const client = createQueryClient();
    const observer = new QueryObserver(client, {
      queryKey: readerKeys.bootstrap,
      queryFn: async ({ signal }) => {
        const response = await fetch(new URL("/api/bootstrap", origin), {
          headers: { cookie },
          signal,
        });
        return (await response.json()) as BootstrapData;
      },
    });
    const unsubscribeQuery = observer.subscribe(() => {});
    let unsubscribeEvents = () => {};
    const createFolder = async (name: string) => {
      const response = await fetch(new URL("/api/folders", origin), {
        method: "POST",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      expect(response.status).toBe(200);
    };
    try {
      await vi.waitFor(() => expect(snapshots).toBe(1));
      if (startupChange === "before-settled") {
        release();
        await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true));
      }
      if (startupChange.startsWith("before")) await createFolder("Delivered during startup");
      unsubscribeEvents = api.subscribeReaderDataInvalidations((reason) => {
        void invalidateReader(client, reason);
      });
      await vi.waitFor(() => expect(connections).toBe(1));
      if (startupChange !== "before-settled") expect(snapshots).toBe(1);
      if (startupChange === "during") await createFolder("Delivered during startup");
      release();
      await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true));
      if (startupChange !== "none")
        await vi.waitFor(() =>
          expect(observer.getCurrentResult().data?.folders.map((folder) => folder.name)).toContain(
            "Delivered during startup",
          ),
        );

      await createFolder("Delivered while connected");
      await vi.waitFor(() =>
        expect(observer.getCurrentResult().data?.folders.map((f) => f.name)).toContain(
          "Delivered while connected",
        ),
      );

      // Close the real connection and change the database while no stream can deliver an event.
      const beforeDisconnect = snapshots;
      stream?.end();
      await vi.waitFor(() => {
        expect(snapshots).toBeGreaterThan(beforeDisconnect);
        expect(observer.getCurrentResult().isFetching).toBe(false);
      });
      database.folders.createFolder(session.user.id, { name: "Created while disconnected" });
      await vi.waitFor(() => expect(connections).toBe(2), { timeout: 5_000 });
      await vi.waitFor(() =>
        expect(observer.getCurrentResult().data?.folders.map((f) => f.name)).toContain(
          "Created while disconnected",
        ),
      );
    } finally {
      release();
      unsubscribeEvents();
      unsubscribeQuery();
      client.clear();
      await events.destroy();
      vi.unstubAllGlobals();
      dom.window.close();
      await server.close();
      database.close();
    }
  },
);
