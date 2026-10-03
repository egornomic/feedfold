import { lstat, realpath, rm, symlink } from "node:fs/promises";
import { join, relative } from "node:path";
import { run } from "./run-command.mjs";

const profile = process.argv[2] ?? "main";
if (!["main", "server", "web", "desktop", "packaging"].includes(profile)) {
  throw new Error("Choose main, server, web, desktop, or packaging.");
}
const projectPath = process.cwd();
process.env.npm_config_cache = join(projectPath, ".npm-cache");
const manifest = await import("../package.json", { with: { type: "json" } });
if (process.versions.node !== manifest.default.engines.node) {
  throw new Error(`Use Node ${manifest.default.engines.node}.`);
}
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
await run(npm, ["--version"]);
const modules = join(projectPath, "node_modules");
if (profile === "main") {
  if ((await lstat(modules).catch(() => null))?.isSymbolicLink()) await rm(modules);
  await run(npm, ["ci"]);
} else {
  const directory = join(projectPath, "environments", profile);
  await run(npm, ["ci"], { cwd: directory });
  await rm(modules, { recursive: true, force: true });
  await symlink(relative(projectPath, join(directory, "node_modules")), modules, "junction");
  if (["desktop", "packaging"].includes(profile)) {
    // Electron 43 has no lifecycle hook. Its reviewed installer verifies checksums
    // committed in the exact Electron package before extracting the runtime.
    await run(process.execPath, [join(modules, "electron", "install.js")], {
      env: { ...process.env, electron_config_cache: join(projectPath, ".npm-cache", "electron") },
    });
  }
}
await run(process.execPath, ["scripts/verify-dependencies.mjs", profile]);
console.log(`Active installation: ${await realpath(modules)}`);
