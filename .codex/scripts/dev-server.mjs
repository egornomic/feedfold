import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const devCommand = ["npm", "run", "dev"];
const startupTimeoutMs = 60_000;

const worktreePath = realpathSync(process.env.CODEX_WORKTREE_PATH ?? process.cwd());
const runtimePath = join(worktreePath, ".codex", "runtime");
const worktreeDatabasePath = join(runtimePath, "feedfold.db");
const statePath = join(runtimePath, "dev-server.json");
const logPath = join(runtimePath, "dev-server.log");
const operation = process.argv[2] ?? "start";

function readState() {
  if (!existsSync(statePath)) return null;
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  if (
    !Number.isInteger(state.pid) ||
    state.pid <= 0 ||
    typeof state.worktreePath !== "string" ||
    !Array.isArray(state.command) ||
    typeof state.readyUrl !== "string" ||
    typeof state.healthUrl !== "string"
  ) {
    throw new Error(`Invalid dev-server state at ${statePath}`);
  }
  return state;
}

function removeState() {
  if (existsSync(statePath)) unlinkSync(statePath);
}

function writeState(state) {
  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(temporaryPath, statePath);
}

function isAlive(pid) {
  try {
    process.kill(process.platform === "win32" ? pid : -pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

function processIdentity(pid) {
  if (process.platform !== "darwin" && process.platform !== "linux") {
    throw new Error("Dev-server ownership verification requires macOS or Linux.");
  }
  const result = spawnSync("ps", ["-p", String(pid), "-o", "lstart="], {
    encoding: "utf8",
  });
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error(
      `Cannot verify dev-server process ${pid}: ${result.stderr || result.error || "process inspection failed"}`,
    );
  }
  let cwd;
  if (process.platform === "linux") {
    cwd = readlinkSync(`/proc/${pid}/cwd`);
  } else {
    const directory = spawnSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
      encoding: "utf8",
    });
    cwd = directory.stdout
      ?.split("\n")
      .find((line) => line.startsWith("n"))
      ?.slice(1);
    if (directory.status !== 0 || !cwd) {
      throw new Error(`Cannot verify working directory for dev-server process ${pid}`);
    }
  }
  return { startedAt: result.stdout.trim(), cwd: realpathSync(cwd) };
}

function assertOwnedProcess(state) {
  const identity = processIdentity(state.pid);
  if (identity.cwd !== worktreePath || identity.startedAt !== state.processStartedAt) {
    throw new Error(`Refusing to stop or reuse unverified process ${state.pid}`);
  }
}

async function checkEndpoints(state) {
  const [api, frontend] = await Promise.all(
    [state.healthUrl, state.readyUrl].map(async (url) => {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(1_500) });
        await response.body?.cancel();
        return response.ok;
      } catch {
        return false;
      }
    }),
  );
  return { api, frontend };
}

async function status() {
  const state = readState();
  if (!state) return { status: "stopped", worktreePath, databasePath: worktreeDatabasePath };
  if (state.worktreePath !== worktreePath) return { ...state, status: "foreign" };
  if (!isAlive(state.pid)) return { ...state, status: "stopped" };
  try {
    assertOwnedProcess(state);
  } catch (error) {
    return { ...state, status: "unverified", reason: error.message };
  }
  const endpoints = await checkEndpoints(state);
  return {
    ...state,
    status:
      state.status === "starting"
        ? "starting"
        : endpoints.api && endpoints.frontend
          ? "ready"
          : "unhealthy",
    endpoints,
  };
}

function signalProcessGroup(pid, signal, force = false) {
  if (process.platform === "win32") {
    const args = ["/PID", String(pid), "/T"];
    if (force) args.push("/F");
    spawnSync("taskkill", args, { stdio: "ignore" });
    return;
  }

  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

async function waitUntilStopped(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await delay(100);
  }
  return !isAlive(pid);
}

async function stop() {
  const state = readState();
  if (!state) {
    console.log("Dev server is not running.");
    return;
  }
  if (state.worktreePath !== worktreePath) {
    removeState();
    console.log("Removed foreign dev-server state without stopping its process.");
    return;
  }
  if (!isAlive(state.pid)) {
    removeState();
    console.log("Removed stale dev-server state.");
    return;
  }

  assertOwnedProcess(state);
  signalProcessGroup(state.pid, "SIGTERM");
  if (!(await waitUntilStopped(state.pid, 5_000))) {
    assertOwnedProcess(state);
    signalProcessGroup(state.pid, "SIGKILL", true);
  }
  if (!(await waitUntilStopped(state.pid, 2_000))) {
    throw new Error(`Could not stop dev-server process ${state.pid}`);
  }
  removeState();
  console.log(`Stopped dev server at ${state.readyUrl}`);
}

function logTail() {
  if (!existsSync(logPath)) return "No dev-server log was written.";
  return readFileSync(logPath, "utf8").slice(-4_000);
}

async function waitUntilReady(state) {
  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(state.pid)) {
      throw new Error(`Dev server exited during startup.\n${logTail()}`);
    }
    const endpoints = await checkEndpoints(state);
    if (endpoints.api && endpoints.frontend) return;
    await delay(250);
  }
  throw new Error(`Dev server did not become ready.\n${logTail()}`);
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a development port"));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

async function start() {
  const existingState = readState();
  if (existingState?.worktreePath === worktreePath && isAlive(existingState.pid)) {
    assertOwnedProcess(existingState);
    if (existingState.status === "starting") await waitUntilReady(existingState);
    const endpoints = await checkEndpoints(existingState);
    if (endpoints.api && endpoints.frontend) {
      if (existingState.status === "starting") writeState({ ...existingState, status: "ready" });
      console.log(`Dev server is already running at ${existingState.readyUrl}`);
      return;
    }
    console.log("Dev server is not responding; restarting the verified workspace process.");
    await stop();
  }
  if (existingState) removeState();

  const envPath = join(worktreePath, ".env");
  if (existsSync(envPath)) process.loadEnvFile(envPath);
  const [apiPort, webPort] = await Promise.all([availablePort(), availablePort()]);
  const apiOrigin = `http://127.0.0.1:${apiPort}`;
  const readyUrl = `http://localhost:${webPort}/`;
  const healthUrl = `${apiOrigin}/health`;
  mkdirSync(runtimePath, { recursive: true });
  if (!existsSync(worktreeDatabasePath)) {
    const seed = spawnSync(
      process.execPath,
      ["--import", "tsx", ".codex/scripts/seed-database.ts"],
      {
        cwd: worktreePath,
        stdio: "inherit",
      },
    );
    if (seed.status !== 0) throw new Error("Could not seed the development database");
  }
  const logDescriptor = openSync(logPath, "w");
  const child = spawn(devCommand[0], devCommand.slice(1), {
    cwd: worktreePath,
    detached: true,
    env: {
      ...process.env,
      FEEDFOLD_DEV_API_ORIGIN: apiOrigin,
      FEEDFOLD_PUBLIC_ORIGIN: new URL(readyUrl).origin,
      FEEDFOLD_DEV_PORT: String(webPort),
      DATABASE_PATH: worktreeDatabasePath,
      PORT: String(apiPort),
      HOST: "127.0.0.1",
    },
    stdio: ["ignore", logDescriptor, logDescriptor],
    windowsHide: true,
  });
  closeSync(logDescriptor);
  await once(child, "spawn");
  if (!child.pid) throw new Error("Dev server did not return a process ID");

  const state = {
    pid: child.pid,
    worktreePath,
    command: devCommand,
    readyUrl,
    healthUrl,
    databasePath: worktreeDatabasePath,
    status: "starting",
    startedAt: new Date().toISOString(),
  };
  child.unref();

  try {
    state.processStartedAt = processIdentity(child.pid).startedAt;
    writeState(state);
    await waitUntilReady(state);
    state.status = "ready";
    writeState(state);
  } catch (error) {
    if (state.processStartedAt) {
      await stop();
    } else {
      // This child was just spawned here; no saved PID is trusted for this cleanup.
      signalProcessGroup(child.pid, "SIGTERM");
      await waitUntilStopped(child.pid, 5_000);
    }
    throw error;
  }
  console.log(`Dev server is ready at ${readyUrl}`);
}

switch (operation) {
  case "status":
    console.log(JSON.stringify(await status(), null, 2));
    break;
  case "start":
    await start();
    break;
  case "stop":
    await stop();
    break;
  case "restart":
    await stop();
    await start();
    break;
  default:
    throw new Error(`Unknown dev-server operation: ${operation}`);
}
