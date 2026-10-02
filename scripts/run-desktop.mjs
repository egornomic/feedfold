import { join } from "node:path";
import { run } from "./run-command.mjs";

const projectPath = process.cwd();
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const electronExecutable = join(
  projectPath,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron.cmd" : "electron",
);

await run(npm, ["run", "desktop:prepare-browser"]);
await run(electronExecutable, ["."], { env: process.env });
