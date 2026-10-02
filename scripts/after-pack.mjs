import { join } from "node:path";
import { run } from "./run-command.mjs";

export default async function signAdHocMacBuild(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  // Apple silicon requires an ad-hoc signature to launch. This uses no identity or key.
  await run("codesign", ["--force", "--deep", "--sign", "-", appPath]);
}
