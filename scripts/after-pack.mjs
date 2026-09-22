import { join } from "node:path";
import { run } from "./run-command.mjs";

export default async function signLocalMacBuild(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const localIdentity = process.env.FEEDFOLD_LOCAL_SIGNING_IDENTITY;
  if (localIdentity) {
    console.log(`Signing the local macOS build with ${localIdentity}.`);
    await run("codesign", ["--force", "--deep", "--sign", localIdentity, appPath]);
    return;
  }

  if (process.env.CSC_LINK || process.env.CSC_NAME) return;

  console.log("Applying an ad-hoc signature for the local macOS build.");
  await run("codesign", ["--force", "--deep", "--sign", "-", appPath]);
}
