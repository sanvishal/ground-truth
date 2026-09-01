import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const viteEntry = resolve(projectRoot, "node_modules/vite/bin/vite.js");
const viteArgs = process.argv.slice(2);

if (!viteArgs.some((argument) => argument === "--host" || argument.startsWith("--host="))) {
  viteArgs.push("--host", "127.0.0.1");
}

let child;
let restartTimer;
let stopping = false;

function startServer() {
  if (stopping) return;
  console.log("[dev-supervisor] starting Vite");
  child = spawn(process.execPath, [viteEntry, ...viteArgs], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit"
  });

  child.once("exit", (code, signal) => {
    child = undefined;
    if (stopping) {
      process.exit(code ?? 0);
      return;
    }
    const reason = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
    console.warn(`[dev-supervisor] Vite exited (${reason}); restarting in 1.2s`);
    restartTimer = setTimeout(startServer, 1200);
  });

  child.once("error", (error) => {
    console.error("[dev-supervisor] failed to launch Vite", error);
  });
}

function stopServer(signal) {
  if (stopping) return;
  stopping = true;
  if (restartTimer) clearTimeout(restartTimer);
  if (!child) {
    process.exit(0);
    return;
  }
  child.kill(signal);
  setTimeout(() => child?.kill("SIGKILL"), 3000).unref();
}

process.on("SIGINT", () => stopServer("SIGINT"));
process.on("SIGTERM", () => stopServer("SIGTERM"));

startServer();
