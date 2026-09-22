import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { run } from "./run-command.mjs";

function sqliteBinary(projectPath) {
  return join(
    projectPath,
    "node_modules",
    "better-sqlite3",
    "build",
    "Release",
    "better_sqlite3.node",
  );
}

export async function rebuildSqliteForElectron(projectPath) {
  const electronPackage = JSON.parse(
    await readFile(join(projectPath, "node_modules", "electron", "package.json"), "utf8"),
  );
  const electronRebuild = join(
    projectPath,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "electron-rebuild.cmd" : "electron-rebuild",
  );
  await run(
    electronRebuild,
    [
      "--force",
      "--build-from-source",
      "--which-module",
      "better-sqlite3",
      "--version",
      electronPackage.version,
    ],
    { cwd: projectPath, env: { ...process.env, npm_config_ignore_scripts: "false" } },
  );
}

export async function rebuildSqliteForNode(projectPath) {
  // Packaging can hard-link this file into the app. Unlinking the source first preserves the
  // Electron ABI in that app while npm creates a separate Node-compatible development binary.
  await rm(sqliteBinary(projectPath), { force: true });
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  await run(npm, ["rebuild", "better-sqlite3"], {
    cwd: projectPath,
    env: { ...process.env, npm_config_ignore_scripts: "false" },
  });
}
