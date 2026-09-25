import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { AppDatabase } from "../../src/server/database.js";
import { setInvitationOwner } from "../../src/server/features/auth/repository.js";
import { AuthService } from "../../src/server/features/auth/service.js";
import { ExtractionQueue } from "../../src/server/features/extraction/queue.js";
import { FeedRefreshService } from "../../src/server/features/refresh/service.js";
import { DefaultFeedSourceLoader } from "../../src/server/feed-source-loader.js";
import { createApplicationServices } from "../../src/server/runtime/application-runtime.js";
import { DEFAULT_SERVER_POLICY, registrationMode } from "../../src/server/service-policy.js";
import type { InvitationOverview, RegistrationMode } from "../../src/shared/types.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const password = "reader-password";

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "feedfold-invitations-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "feedfold.db");
  const database = new AppDatabase(path, 20, DEFAULT_SERVER_POLICY);
  cleanups.push(() => database.close());
  const setup = new AuthService(database.auth, 20, { registrationMode: "open" });
  const owner = await setup.register("owner", password);
  if (!owner) throw new Error("Owner setup failed");
  setInvitationOwner(database.connection, owner.user.publicId);
  const ownerCookie = `feedfold_session=${owner.token}`;

  const server = async (mode?: RegistrationMode, maxAccounts = 100, attempts = 100) => {
    const auth = new AuthService(database.auth, 20, {
      registrationMode: mode ?? "closed",
      maxAccounts,
      rateLimits: {
        registrationPerIp: { attempts, windowMs: 60_000 },
        registrationGlobal: { attempts, windowMs: 60_000 },
      },
    });
    const extractionQueue = new ExtractionQueue(database.extractions, 1, 1_000);
    const refreshService = new FeedRefreshService(
      database.feeds,
      new DefaultFeedSourceLoader((task) => database.feeds.runOutbound(task), 1_000),
      1,
    );
    const app = await createApp({
      ...createApplicationServices({
        credentialCipher: null,
        database,
        extractionQueue,
        refreshService,
      }),
      authService: auth,
    });
    const origin = (await app.listen({ host: "127.0.0.1", port: 0 })).replace(
      "127.0.0.1",
      "localhost",
    );
    cleanups.push(async () => {
      await app.close();
      await Promise.all([extractionQueue.stop(), refreshService.stop()]);
    });
    const request = async (method: string, route: string, body?: unknown, cookie?: string) => {
      const response = await fetch(`${origin}${route}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(cookie ? { cookie } : {}),
        },
        body: body === undefined ? null : JSON.stringify(body),
      });
      const payload = response.status === 204 ? null : await response.json();
      return {
        status: response.status,
        body: payload,
        cookie: response.headers.get("set-cookie")?.split(";", 1)[0] ?? "",
        retryAfter: response.headers.get("retry-after"),
      };
    };
    return {
      auth,
      origin,
      request,
      register: (username: string, inviteCode?: string) =>
        request("POST", "/api/auth/register", { username, password, inviteCode }),
      create: (cookie = ownerCookie, replaceId?: string) =>
        request("POST", "/api/auth/invitations", { replaceId }, cookie),
      list: async (cookie = ownerCookie) =>
        (await request("GET", "/api/auth/invitations", undefined, cookie))
          .body as InvitationOverview,
    };
  };
  return { database, path, server, ownerCookie, owner };
}

describe("invitation registration through HTTP", () => {
  it.each(["revoked", "expired", "redeemed", "closed", "open"] as const)(
    "rechecks admission when a passkey registration finishes after the invitation becomes %s",
    async (change) => {
      const { database, server, ownerCookie } = await fixture();
      const api = await server("invite");
      const issued = await api.create();
      const browser = await chromium.launch({ headless: true });
      cleanups.push(() => browser.close());
      const page = await browser.newPage();
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("WebAuthn.enable");
      await cdp.send("WebAuthn.addVirtualAuthenticator", {
        options: {
          protocol: "ctap2",
          transport: "internal",
          hasResidentKey: true,
          hasUserVerification: true,
          isUserVerified: true,
          automaticPresenceSimulation: true,
        },
      });
      await page.goto(`${api.origin}/health`);
      const completion = await page.evaluate(async (inviteCode) => {
        const response = await fetch("/api/auth/register/passkey/options", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: "passkey-friend", inviteCode }),
        });
        const pending = await response.json();
        if (!response.ok) throw new Error(JSON.stringify(pending));
        const credential = (await navigator.credentials.create({
          publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(pending.options),
        })) as PublicKeyCredential;
        return { registrationId: pending.registrationId, response: credential.toJSON() };
      }, issued.body.code);
      let completionServer = api;
      if (change === "revoked")
        expect(
          (
            await api.request(
              "DELETE",
              `/api/auth/invitations/${issued.body.id}`,
              undefined,
              ownerCookie,
            )
          ).status,
        ).toBe(204);
      if (change === "expired")
        database.connection
          .prepare("UPDATE invitations SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?")
          .run(issued.body.id);
      if (change === "redeemed")
        expect((await api.register("password-friend", issued.body.code)).status).toBe(201);
      if (change === "closed" || change === "open") completionServer = await server(change);
      const completed = await completionServer.request(
        "POST",
        "/api/auth/register/passkey",
        completion,
      );
      expect(completed.status).toBe(change === "open" ? 201 : 403);
      expect(database.auth.findEnabledUser("passkey-friend") !== null).toBe(change === "open");
      if (change === "open") {
        expect((await api.list()).invitations[0]?.redeemedAt).toBeNull();
        expect((await api.register("next-friend", issued.body.code)).status).toBe(201);
      }
    },
  );

  it("defaults public registration to closed and changes admission without changing accounts or invite history", async () => {
    const { server, database, ownerCookie } = await fixture();
    expect(registrationMode()).toBe("closed");
    expect(() => registrationMode("anything")).toThrow();
    const closed = await server();
    expect((await closed.register("blocked")).status).toBe(403);
    expect((await closed.request("GET", "/api/auth/config")).body).toMatchObject({
      registrationAvailable: false,
      registrationMode: "closed",
    });
    const invite = await server("invite");
    const issued = await invite.create();
    expect(issued.status).toBe(201);
    expect(issued.body.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/);
    expect((await closed.register("still-blocked", issued.body.code)).status).toBe(403);
    expect(
      (await closed.request("POST", "/api/auth/login", { username: "owner", password })).status,
    ).toBe(200);
    const open = await server("open");
    expect((await open.register("open-reader", issued.body.code)).status).toBe(201);
    expect((await open.register("no-invite-needed")).status).toBe(201);
    expect((await open.create()).status).toBe(403);
    expect(await open.list()).toMatchObject({ enabled: false, invitations: [] });
    expect((await invite.list()).invitations[0]?.redeemedAt).toBeNull();
    const joined = await invite.register("invited-reader", issued.body.code.toLowerCase());
    expect(joined.status).toBe(201);
    expect((await invite.register("replay-reader", issued.body.code)).status).toBe(403);
    expect(await invite.list(joined.cookie)).toMatchObject({
      allowance: { kind: "limited", remaining: 1 },
    });
    expect(database.auth.findEnabledUser("open-reader")).not.toBeNull();
    expect((await invite.request("GET", "/api/auth/session", undefined, ownerCookie)).status).toBe(
      200,
    );
  });

  it("grants unlimited invitations only to the designated owner and one successful referral to each newcomer", async () => {
    const { server } = await fixture();
    const api = await server("invite");
    const first = await api.create();
    const second = await api.create();
    expect(second.status).toBe(201);
    expect(first.body.number).toBe(1);
    expect(second.body.number).toBe(2);
    expect((await api.list()).invitations.map((invite) => invite.number)).toEqual([2, 1]);
    const friend = await api.register("friend", first.body.code);
    const issued = await api.create(friend.cookie);
    expect(issued.status).toBe(201);
    expect((await api.create(friend.cookie)).status).toBe(403);
    const joined = await api.register("friend-of-friend", issued.body.code);
    expect(joined.status).toBe(201);
    expect((await api.create(friend.cookie)).status).toBe(403);
    expect(await api.list(friend.cookie)).toMatchObject({
      allowance: { kind: "limited", remaining: 0 },
    });
    expect(await api.list(joined.cookie)).toMatchObject({
      allowance: { kind: "limited", remaining: 1 },
    });
    expect(
      (await api.request("DELETE", "/api/auth/account", undefined, joined.cookie)).status,
    ).toBe(204);
    expect((await api.create(friend.cookie)).status).toBe(403);
    expect((await api.register("reused-name", issued.body.code)).status).toBe(403);
    expect((await api.create()).status).toBe(201);
  });

  it("replaces, revokes and expires invitations without spending the referral or allowing old links to work", async () => {
    const { database, server } = await fixture();
    const api = await server("invite");
    const invitation = await api.create();
    const friend = await api.register("friend", invitation.body.code);
    const original = await api.create(friend.cookie);
    const replacement = await api.create(friend.cookie, original.body.id);
    expect(replacement.status).toBe(201);
    expect((await api.register("old-link", original.body.code)).status).toBe(403);
    expect(
      (await api.request("DELETE", `/api/auth/invitations/${replacement.body.id}`)).status,
    ).toBe(401);
    expect(
      (
        await api.request(
          "DELETE",
          `/api/auth/invitations/${replacement.body.id}`,
          undefined,
          friend.cookie,
        )
      ).status,
    ).toBe(204);
    expect((await api.register("revoked-link", replacement.body.code)).status).toBe(403);
    const expired = await api.create(friend.cookie);
    database.connection
      .prepare("UPDATE invitations SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?")
      .run(expired.body.id);
    expect((await api.register("expired-link", expired.body.code)).status).toBe(403);
    const fresh = await api.create(friend.cookie);
    expect(fresh.status).toBe(201);
    expect((await api.register("fresh-link", fresh.body.code)).status).toBe(201);
  });

  it("leaves invitations available after failed signup and passkey setup, and atomically rejects simultaneous redemption", async () => {
    const { server, database, path } = await fixture();
    const api = await server("invite");
    const issued = await api.create();
    expect((await api.register("owner", issued.body.code)).status).toBe(409);
    expect((await api.register("bad-code", "NOPE00")).status).toBe(403);
    const options = await api.request("POST", "/api/auth/register/passkey/options", {
      username: "pending-reader",
      inviteCode: issued.body.code,
    });
    expect(options.status).toBe(200);
    expect(
      (
        await api.request("POST", "/api/auth/register/passkey/options", {
          username: "pending-reader",
          inviteCode: issued.body.code,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await api.request("POST", "/api/auth/register/passkey/options", {
          username: "missing-invite",
        })
      ).status,
    ).toBe(403);
    expect((await api.list()).invitations[0]?.redeemedAt).toBeNull();
    const secondDatabase = new AppDatabase(path, 20, DEFAULT_SERVER_POLICY);
    try {
      const second = new AuthService(secondDatabase.auth, 20, {
        registrationMode: "invite",
        maxAccounts: 100,
      });
      const attempts = await Promise.allSettled([
        api.auth.register("first-reader", password, issued.body.code),
        second.register("second-reader", password, issued.body.code),
      ]);
      expect(
        attempts.filter((attempt) => attempt.status === "fulfilled" && attempt.value),
      ).toHaveLength(1);
      expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
      expect(
        database.connection.prepare("SELECT COUNT(*) FROM users WHERE enabled = 1").pluck().get(),
      ).toBe(2);
    } finally {
      secondDatabase.close();
    }
    expect((await api.register("third-reader", issued.body.code)).status).toBe(403);
  });

  it("keeps account caps and persisted guessing cooldowns in force for invite signup", async () => {
    const { server } = await fixture();
    const issuer = await server("invite");
    const issued = await issuer.create();
    const full = await server("invite", 1);
    expect((await full.register("full-reader", issued.body.code)).status).toBe(403);
    const limited = await server("invite", 100, 2);
    // The capacity rejection also counts towards the shared registration cooldown.
    expect((await limited.register("guess-reader", "NOPE00")).status).toBe(403);
    const afterRestart = await server("invite", 100, 2);
    const blocked = await afterRestart.register("limited-reader", issued.body.code);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.retryAfter)).toBeGreaterThan(0);
    expect((await issuer.list()).invitations[0]?.redeemedAt).toBeNull();
  });

  it("deletes invitation history and disables unused links when their creator deletes their account", async () => {
    const { server, database, ownerCookie } = await fixture();
    const api = await server("invite");
    const ownerInvite = await api.create();
    const friend = await api.register("friend", ownerInvite.body.code);
    const friendInvite = await api.create(friend.cookie);
    expect(
      (
        await api.request(
          "DELETE",
          `/api/auth/invitations/${friendInvite.body.id}`,
          undefined,
          ownerCookie,
        )
      ).status,
    ).toBe(403);
    expect((await api.create(ownerCookie, friendInvite.body.id)).status).toBe(403);
    expect((await api.list(friend.cookie)).invitations).toHaveLength(1);
    expect(
      (await api.request("DELETE", "/api/auth/account", undefined, friend.cookie)).status,
    ).toBe(204);
    expect((await api.register("orphan-link", friendInvite.body.code)).status).toBe(403);
    expect(database.connection.prepare("SELECT COUNT(*) FROM invitations").pluck().get()).toBe(0);
  });

  it("keeps a used invitation allowance after its recipient deletes their account", async () => {
    const { server } = await fixture();
    const api = await server("invite");
    const ownerInvite = await api.create();
    const friend = await api.register("friend", ownerInvite.body.code);
    const friendInvite = await api.create(friend.cookie);
    const recipient = await api.register("recipient", friendInvite.body.code);
    expect(
      (await api.request("DELETE", "/api/auth/account", undefined, recipient.cookie)).status,
    ).toBe(204);
    expect((await api.list(friend.cookie)).invitations).toHaveLength(0);
    expect((await api.list(friend.cookie)).allowance).toEqual({ kind: "limited", remaining: 0 });
    expect((await api.create(friend.cookie)).status).toBe(403);
  });

  it("expires old unused invitation history while preserving active and redeemed invitations", async () => {
    const { server, database } = await fixture();
    const api = await server("invite");
    const old = await api.create();
    const replacement = await api.create(undefined, old.body.id);
    const friend = await api.register("friend", replacement.body.code);
    const expired = await api.create(friend.cookie);
    const at = new Date("2026-09-24T12:00:00.000Z");
    database.connection
      .prepare("UPDATE invitations SET revoked_at = ? WHERE id = ?")
      .run("2026-08-01T00:00:00.000Z", old.body.id);
    database.connection
      .prepare("UPDATE invitations SET expires_at = ? WHERE id IN (?, ?)")
      .run("2026-08-01T00:00:00.000Z", expired.body.id, replacement.body.id);
    const active = await api.create();
    database.auth.pruneInvitationHistory(at);
    expect(
      database.connection.prepare("SELECT id FROM invitations ORDER BY id").pluck().all(),
    ).toEqual([replacement.body.id, active.body.id].sort());
    expect((await api.list(friend.cookie)).allowance).toEqual({ kind: "limited", remaining: 1 });
  });

  it("allows only one active invitation when requests race and refuses duplicate codes without revoking a replacement", async () => {
    const { server, database, owner } = await fixture();
    const api = await server("invite");
    const issued = await api.create();
    const friend = await api.register("friend", issued.body.code);
    const attempts = await Promise.all([api.create(friend.cookie), api.create(friend.cookie)]);
    expect(attempts.map((attempt) => attempt.status).sort()).toEqual([201, 403]);
    const invite = attempts.find((attempt) => attempt.status === 201)?.body;
    const hash = database.connection
      .prepare("SELECT code_hash FROM invitations WHERE id = ?")
      .pluck()
      .get(invite.id) as string;
    expect(database.auth.createInvitation(owner.user.id, "collision", hash, invite.id)).toEqual({
      status: "code-conflict",
    });
    expect((await api.register("recipient", invite.code)).status).toBe(201);
  });
});
