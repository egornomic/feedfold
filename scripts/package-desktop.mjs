import { join } from "node:path";
import { rebuildSqliteForElectron, rebuildSqliteForNode } from "./native-sqlite.mjs";
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

await run(npm, ["run", "desktop:prepare-browser"]);
await run(npm, ["run", "build:desktop"]);
try {
  await rebuildSqliteForElectron(projectPath);
  const builderArguments = [electronBuilderCli, "--mac"];
  if (process.env.FEEDFOLD_LOCAL_SIGNING_IDENTITY) {
    builderArguments.push("-c.mac.identity=null");
  }
  if (process.argv.includes("--dir")) builderArguments.push("--dir");
  const configuredIdentity = process.env.CSC_LINK || process.env.CSC_NAME;
  const builderEnvironment = {
    ...process.env,
    npm_config_ignore_scripts: "false",
    ...(process.platform === "darwin" && !configuredIdentity
      ? { CSC_IDENTITY_AUTO_DISCOVERY: "false" }
      : {}),
  };
  await run(process.execPath, builderArguments, { env: builderEnvironment });
} finally {
  await rebuildSqliteForNode(projectPath);
}
