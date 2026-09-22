import { join } from "node:path";
import { rebuildSqliteForElectron, rebuildSqliteForNode } from "./native-sqlite.mjs";
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
try {
  await rebuildSqliteForElectron(projectPath);
  await run(electronExecutable, ["."], { env: process.env });
} finally {
  await rebuildSqliteForNode(projectPath);
}
