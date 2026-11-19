import { spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";

const url = `http://127.0.0.1:${process.env.FEEDFOLD_DEV_PORT ?? "45173"}/`;
const deadline = Date.now() + 30_000;

while (Date.now() < deadline) {
    try {
        const response = await fetch(url);
        if (response.ok) {
            break;
        }
    } catch {
        // Vite is still starting.
    }
    await setTimeout(100);
}

if (Date.now() >= deadline) {
    console.error(
        "The desktop renderer did not become ready within 30 seconds.",
    );
    process.exit(1);
}

const desktop = spawn(process.execPath, ["scripts/run-desktop.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, FEEDFOLD_DESKTOP_DEV_URL: url },
    stdio: "inherit",
});

desktop.once("error", (error) => {
    console.error(error);
    process.exit(1);
});
desktop.once("exit", (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
    } else {
        process.exit(code ?? 0);
    }
});
