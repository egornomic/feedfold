import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Sqlite from "better-sqlite3";
import { isValidUsername } from "../shared/auth.js";
import { AppDatabase } from "./database.js";
import { setInvitationOwner } from "./features/auth/repository.js";
import { AuthService } from "./features/auth/service.js";
import { WEB_FEED_POLL_INTERVAL_MINUTES } from "./features/shared.js";
import { migrateDatabase } from "./migrations.js";

const USAGE =
  "Usage: node dist/server/manage-accounts.js list | set-owner <public-account-id> | create-owner <username>";

type AccountCommand =
  | { name: "list" }
  | { name: "set-owner"; publicId: string }
  | { name: "create-owner"; username: string };

function parseCommand(args: string[]): AccountCommand {
  const [name, value, ...extra] = args;
  if (extra.length > 0) throw new Error(USAGE);
  if (name === "list" && value === undefined) return { name };
  if (name === "set-owner" && value) return { name, publicId: value };
  if (name === "create-owner" && value) return { name, username: value.trim() };
  throw new Error(USAGE);
}

function listAccounts(connection: Sqlite.Database): void {
  console.table(
    connection
      .prepare(
        "SELECT public_id AS id, username, unlimited_invites AS owner FROM users WHERE enabled = 1",
      )
      .all(),
  );
}

function selectOwner(connection: Sqlite.Database, publicId: string): void {
  setInvitationOwner(connection, publicId);
  console.log("The selected account is now the invite owner.");
}

async function createOwner(
  connection: Sqlite.Database,
  databasePath: string,
  username: string,
): Promise<void> {
  if (!isValidUsername(username)) {
    throw new Error(
      "Use a username of 3–32 letters, numbers, dots, hyphens, or underscores; start and end with a letter or number.",
    );
  }
  const usersTableExists = connection
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'")
    .get();
  if (usersTableExists && connection.prepare("SELECT 1 FROM users WHERE enabled = 1").get()) {
    throw new Error(
      "Owner setup requires an empty server. Use list and set-owner for an existing account.",
    );
  }

  const database = new AppDatabase(databasePath);
  try {
    const password = randomBytes(24).toString("base64url");
    const auth = new AuthService(database.auth, 20, { maxAccounts: 1, registrationMode: "open" });
    const session = await auth.register(username, password);
    if (!session) {
      throw new Error(
        "Owner setup requires an empty server. Use list and set-owner for an existing account.",
      );
    }
    setInvitationOwner(database.connection, session.user.publicId);
    auth.endSession(session.token);
    console.log(
      `Owner created: ${username}\nPassword: ${password}\nSign in and add a passkey or change this password in Account settings.`,
    );
  } finally {
    database.close();
  }
}

async function main(): Promise<void> {
  const command = parseCommand(process.argv.slice(2));
  const databasePath = resolve(process.env.DATABASE_PATH ?? "./data/feedfold.db");
  mkdirSync(dirname(databasePath), { recursive: true });
  const connection = new Sqlite(databasePath, { fileMustExist: command.name !== "create-owner" });
  connection.pragma("busy_timeout = 5000");
  connection.pragma("foreign_keys = ON");
  try {
    if (command.name !== "create-owner") {
      migrateDatabase(connection, WEB_FEED_POLL_INTERVAL_MINUTES);
    }
    switch (command.name) {
      case "list":
        listAccounts(connection);
        break;
      case "set-owner":
        selectOwner(connection, command.publicId);
        break;
      case "create-owner":
        await createOwner(connection, databasePath, command.username);
        break;
    }
  } finally {
    connection.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Account management failed.");
  process.exitCode = 1;
}
