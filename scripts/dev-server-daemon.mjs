import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const supervisorPath = resolve(projectRoot, "scripts/dev-server-supervisor.mjs");
const pidPath = resolve(projectRoot, ".dev-server.pid");
const logPath = resolve(projectRoot, ".dev-server.log");
const command = process.argv[2] ?? "start";

function readPid() {
  try {
    const pid = Number.parseInt(readFileSync(pidPath, "utf8").trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function clearPidFile() {
  try {
    unlinkSync(pidPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function start() {
  const existingPid = readPid();
  if (existingPid && isRunning(existingPid)) {
    console.log(`[dev-daemon] already running (pid ${existingPid})`);
    return;
  }
  clearPidFile();

  const logFd = openSync(logPath, "a");
  const child = spawn(process.execPath, [supervisorPath], {
    cwd: projectRoot,
    detached: true,
    env: process.env,
    stdio: ["ignore", logFd, logFd]
  });
  child.unref();
  closeSync(logFd);
  writeFileSync(pidPath, `${child.pid}\n`, "utf8");
  console.log(`[dev-daemon] started (pid ${child.pid}); log: ${logPath}`);
}

async function stop() {
  const pid = readPid();
  if (!pid || !isRunning(pid)) {
    clearPidFile();
    console.log("[dev-daemon] not running");
    return;
  }

  process.kill(pid, "SIGTERM");
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    if (!isRunning(pid)) {
      clearPidFile();
      console.log(`[dev-daemon] stopped (pid ${pid})`);
      return;
    }
  }
  throw new Error(`[dev-daemon] pid ${pid} did not stop after SIGTERM`);
}

async function main() {
  if (command === "start") {
    start();
    return;
  }
  if (command === "stop") {
    await stop();
    return;
  }
  if (command === "restart") {
    await stop();
    start();
    return;
  }
  if (command === "status") {
    const pid = readPid();
    if (pid && isRunning(pid)) {
      console.log(`[dev-daemon] running (pid ${pid})`);
      return;
    }
    console.log("[dev-daemon] stopped");
    process.exitCode = 1;
    return;
  }
  throw new Error(`unknown command: ${command}`);
}

await main();
