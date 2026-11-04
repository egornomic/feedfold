import { access, readFile, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";

const profile = process.argv[2] ?? "main";
const modules = await realpath("node_modules");
const directory = dirname(modules);
const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
const lock = JSON.parse(await readFile(join(modules, ".package-lock.json"), "utf8"));
const installed = await Promise.all(
  Object.keys(lock.packages).map(async (path) => {
    const packagePath = join(directory, path, "package.json");
    await access(packagePath);
    return JSON.parse(await readFile(packagePath, "utf8"));
  }),
);
const packagingTools = installed.filter(({ name }) =>
  /^(electron-builder|app-builder-lib|app-builder-bin|builder-util|builder-util-runtime|dmg-builder|electron-winstaller|7zip-bin|@electron\/.*)$/.test(
    name,
  ),
);
if (["main", "server", "web"].includes(profile)) {
  if (packagingTools.length || installed.some(({ name }) => name === "electron")) {
    throw new Error(
      `${profile} contains Electron tools: ${packagingTools.map(({ name }) => name)}`,
    );
  }
}
if (profile === "desktop" && installed.some(({ name }) => name === "electron-builder")) {
  throw new Error("Desktop development contains the packaging tool.");
}
if (["desktop", "packaging"].includes(profile)) {
  await access(join(modules, "electron/path.txt"));
}
await Promise.all(
  Object.entries({
    ...manifest.dependencies,
    ...(process.argv.includes("--omit-dev") ? {} : manifest.devDependencies),
  }).map(async ([name, version]) => {
    const actual = JSON.parse(await readFile(join(modules, name, "package.json"), "utf8"));
    if (actual.version !== version)
      throw new Error(`${name}: expected ${version}, got ${actual.version}`);
  }),
);
console.log(
  `${profile}: ${installed.length} installed packages; ${packagingTools.length} Electron tools`,
);
