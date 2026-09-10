import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../../src/server/database.js";
import { AuthService } from "../../src/server/features/auth/service.js";

const paths: string[] = [];
afterEach(() => {
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true });
});
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "feedfold-owner-"));
  paths.push(directory);
  const path = join(directory, "feedfold.db");
  const run = (...args: string[]) =>
    execFileSync(process.execPath, ["--import", "tsx", "src/server/manage-accounts.ts", ...args], {
      env: { ...process.env, DATABASE_PATH: path },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  return { path, run };
}

describe("server account management", () => {
  it("provisions an owner with a working password once and grants unlimited invitations", async () => {
    const { path, run } = fixture();
    const output = run("create-owner", "owner");
    const password = output.match(/Password: (\S+)/)?.[1];
    expect(password).toBeDefined();
    const database = new AppDatabase(path);
    try {
      const auth = new AuthService(database.auth, 20, {
        registrationMode: "invite",
        maxAccounts: 100,
      });
      const login = await auth.login("owner", password ?? "");
      expect(login).not.toBeNull();
      expect(auth.invitations(login?.user.id ?? 0)).toMatchObject({
        allowance: { kind: "unlimited" },
      });
      expect(() => run("create-owner", "second-owner")).toThrow();
      expect(database.auth.findEnabledUser("second-owner")).toBeNull();
    } finally {
      database.close();
    }
  });

  it("assigns the owner by stable ID without interrupting active feed refreshes", async () => {
    const { path, run } = fixture();
    const database = new AppDatabase(path);
    try {
      const setup = new AuthService(database.auth, 20, { maxAccounts: 2 });
      const first = await setup.register("first", "reader-password");
      const second = await setup.register("second", "reader-password");
      if (!first || !second) throw new Error("Account setup failed");
      database.connection.prepare("UPDATE feed_sources SET refreshing = 1").run();
      expect(run("list")).toContain(first.user.publicId);
      run("set-owner", second.user.publicId);
      expect(setup.invitations(first.user.id).allowance.kind).toBe("limited");
      expect(setup.invitations(second.user.id).allowance.kind).toBe("unlimited");
      expect(() => run("set-owner", "missing-account")).toThrow();
      expect(setup.invitations(second.user.id).allowance.kind).toBe("unlimited");
      expect(
        database.connection.prepare("SELECT MIN(refreshing) FROM feed_sources").pluck().get(),
      ).toBe(1);
    } finally {
      database.close();
    }
  });
});
