import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { run } from "./run-command.mjs";

const projectPath = process.cwd();
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const electronBuilderCli = join(
  projectPath,
  "node_modules",
  "electron-builder",
  "out",
  "cli",
  "cli.js",
);
const electron = JSON.parse(await readFile("node_modules/electron/package.json", "utf8"));

// Consume the built renderer and runtime. Signing must consume these artifacts too.
await readFile("dist/client/index.html");
await readFile("dist/desktop/main.js");
await run(npm, ["run", "desktop:prepare-browser"]);
const builderArguments = [
  electronBuilderCli,
  "--mac",
  `-c.electronVersion=${electron.version}`,
  `-c.electronDist=${join(projectPath, "node_modules", "electron", "dist")}`,
  "-c.mac.identity=null",
];
if (process.argv.includes("--dir")) builderArguments.push("--dir");
const builderEnvironment = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" };
for (const name of [
  "CSC_LINK",
  "CSC_NAME",
  "CSC_KEY_PASSWORD",
  "FEEDFOLD_LOCAL_SIGNING_IDENTITY",
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_API_KEY",
  "APPLE_API_KEY_ID",
  "APPLE_API_ISSUER",
])
  delete builderEnvironment[name];
await run(process.execPath, builderArguments, { env: builderEnvironment });
