import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { run } from "./run-command.mjs";

const projectPath = process.cwd();
const browserPath = join(projectPath, "node_modules", "playwright-core", ".local-browsers");
const playwright = join(
  projectPath,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "playwright.cmd" : "playwright",
);

const installed = await readdir(browserPath).catch(() => []);
if (
  installed.some((entry) => entry.startsWith("chromium_headless_shell-")) &&
  installed.some((entry) => entry.startsWith("ffmpeg-")) &&
  !installed.some((entry) => entry.startsWith("chromium-"))
) {
  console.log("Desktop browser runtime is ready.");
  process.exit(0);
}

await rm(browserPath, { recursive: true, force: true });

await run(playwright, ["install", "chromium", "--only-shell"], {
  cwd: projectPath,
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: "0" },
});
