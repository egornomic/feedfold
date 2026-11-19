import { setTimeout } from "node:timers/promises";

const apiOrigin =
    process.env.FEEDFOLD_DEV_API_ORIGIN ?? "http://127.0.0.1:43001";
const healthUrl = new URL("/health", apiOrigin);
const deadline = Date.now() + 30_000;

while (Date.now() < deadline) {
    try {
        const response = await fetch(healthUrl);
        if (response.ok) {
            console.log("API ready");
            process.exit(0);
        }
    } catch {
        // The API process is still starting.
    }
    await setTimeout(100);
}

console.error("API did not become ready within 30 seconds");
process.exit(1);
