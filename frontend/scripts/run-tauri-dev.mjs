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
const cargoTargetDir = path.resolve(env.CARGO_TARGET_DIR);
const repoPythonSourceDir = path.resolve(process.cwd(), "..", "src");

if (!env.CARGO_BUILD_JOBS) {
  env.CARGO_BUILD_JOBS = "1";
}

if (!env.KERA_DESKTOP_RUNTIME_MODE) {
  env.KERA_DESKTOP_RUNTIME_MODE = "dev";
}

if (!env.KERA_NEXT_DEV_CLEAN) {
  env.KERA_NEXT_DEV_CLEAN = "1";
}

function removePythonBytecodeCaches(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return;
  }
  const stack = [rootDir];
  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) {
      continue;
    }
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__pycache__") {
          fs.rmSync(entryPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
          continue;
        }
        stack.push(entryPath);
        continue;
      }
      if (entry.isFile() && (entry.name.endsWith(".pyc") || entry.name.endsWith(".pyo"))) {
        fs.rmSync(entryPath, { force: true, maxRetries: 3, retryDelay: 250 });
      }
    }
  }
}

console.log("Cleaning up previous Tauri and DevServer processes...");
if (process.platform === "win32") {
  spawnSync("taskkill", ["/f", "/im", "kera-desktop-shell.exe", "/t"], { stdio: "ignore" });
  spawnSync("powershell", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    [
      "$ErrorActionPreference = 'SilentlyContinue'",
      `$targetPrefix = ${JSON.stringify(cargoTargetDir)}`,
      "Get-CimInstance Win32_Process |",
      "  Where-Object {",
      "    $processPath = $_.ExecutablePath",
      "    if (-not $processPath) { return $false }",
      "    return $processPath.StartsWith($targetPrefix, [System.StringComparison]::OrdinalIgnoreCase)",
      "  } |",
      "  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
    ].join("\n"),
  ], { stdio: "ignore" });
  spawnSync("powershell", [
    "-Command",
    "Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
  ], { stdio: "ignore" });
} else {
  spawnSync("pkill", ["-f", "kera-desktop-shell"], { stdio: "ignore" });
  spawnSync("sh", ["-c", "lsof -ti:3000 | xargs kill -9 >/dev/null 2>&1"], { stdio: "ignore" });
}
removePythonBytecodeCaches(repoPythonSourceDir);

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
