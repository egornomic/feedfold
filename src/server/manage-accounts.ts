import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Sqlite from "better-sqlite3";
import { AppDatabase } from "./database.js";
import { setInvitationOwner } from "./features/auth/repository.js";
import { AuthService } from "./features/auth/service.js";
import { WEB_FEED_POLL_INTERVAL_MINUTES } from "./features/shared.js";
import { migrateDatabase } from "./migrations.js";

const [command, account] = process.argv.slice(2);
if (
  !command ||
  !["list", "set-owner", "create-owner"].includes(command) ||
  (command !== "list" && !account)
) {
  console.error(
    "Usage: node dist/server/manage-accounts.js list | set-owner <public-account-id> | create-owner <username>",
  );
  process.exit(1);
}
const path = resolve(process.env.DATABASE_PATH ?? "./data/feedfold.db");
mkdirSync(dirname(path), { recursive: true });
const connection = new Sqlite(path, { fileMustExist: command !== "create-owner" });
connection.pragma("busy_timeout = 5000");
connection.pragma("foreign_keys = ON");
try {
  if (command !== "create-owner") migrateDatabase(connection, WEB_FEED_POLL_INTERVAL_MINUTES);
  if (command === "list") {
    console.table(
      connection
        .prepare(
          "SELECT public_id AS id, username, unlimited_invites AS owner FROM users WHERE enabled = 1",
        )
        .all(),
    );
  } else if (command === "set-owner") {
    setInvitationOwner(connection, account);
    console.log("The selected account can now create unlimited invitations.");
  } else {
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]{1,30}[A-Za-z0-9])$/.test(account)) {
      throw new Error(
        "Use a username of 3–32 letters, numbers, dots, hyphens, or underscores; start and end with a letter or number.",
      );
    }
    if (
      connection
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'")
        .get() &&
      connection.prepare("SELECT 1 FROM users WHERE enabled = 1").get()
    ) {
      throw new Error(
        "Owner setup requires an empty server. Use list and set-owner for an existing account.",
      );
    }
    const database = new AppDatabase(path);
    try {
      const password = randomBytes(24).toString("base64url");
      const auth = new AuthService(database.auth, 20, { maxAccounts: 1, registrationMode: "open" });
      const session = await auth.register(account, password);
      if (!session)
        throw new Error(
          "Owner setup requires an empty server. Use list and set-owner for an existing account.",
        );
      setInvitationOwner(database.connection, session.user.publicId);
      auth.endSession(session.token);
      console.log(
        `Owner created: ${account}\nPassword: ${password}\nSign in and add a passkey or change this password in Account settings.`,
      );
    } finally {
      database.close();
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Account management failed.");
  process.exitCode = 1;
} finally {
  connection.close();
}
