import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";

const env = { ...process.env };
const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
const pathEntries = String(env[pathKey] ?? "")
  .split(path.delimiter)
  .filter(Boolean);
const cargoBinDir = path.join(os.homedir(), ".cargo", "bin");

if (fs.existsSync(cargoBinDir) && !pathEntries.includes(cargoBinDir)) {
  env[pathKey] = [cargoBinDir, ...pathEntries].join(path.delimiter);
}

if (!env.CARGO_TARGET_DIR) {
  env.CARGO_TARGET_DIR = path.join(os.tmpdir(), "kera-tauri-dev", "target");
}

if (!env.CARGO_BUILD_JOBS) {
  env.CARGO_BUILD_JOBS = "1";
}

if (!env.KERA_DESKTOP_RUNTIME_MODE) {
  env.KERA_DESKTOP_RUNTIME_MODE = "dev";
}

console.log("Cleaning up previous Tauri and DevServer processes...");
if (process.platform === "win32") {
  spawnSync("taskkill", ["/f", "/im", "kera-desktop-shell.exe", "/t"], { stdio: "ignore" });
  spawnSync("powershell", [
    "-Command",
    "Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
  ], { stdio: "ignore" });
} else {
  spawnSync("pkill", ["-f", "kera-desktop-shell"], { stdio: "ignore" });
  spawnSync("sh", ["-c", "lsof -ti:3000 | xargs kill -9 >/dev/null 2>&1"], { stdio: "ignore" });
}

const child =
  process.platform === "win32"
    ? spawn("cmd.exe", ["/d", "/s", "/c", "npx tauri dev --config src-tauri/tauri.dev.conf.json"], {
        stdio: "inherit",
        env,
      })
    : spawn("npx", ["tauri", "dev", "--config", "src-tauri/tauri.dev.conf.json"], {
        stdio: "inherit",
        env,
      });

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
