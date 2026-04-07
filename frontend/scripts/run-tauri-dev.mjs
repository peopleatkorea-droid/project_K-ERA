import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import {
  DEFAULT_DESKTOP_SHELL_DEV_PORT,
  resolveDesktopShellDevPort,
} from "./desktop-dev-port-lib.mjs";

const env = { ...process.env };
const rawArgs = process.argv.slice(2);
const useNextDev = rawArgs.includes("--next");
const cleanNextDev = rawArgs.includes("--clean");
const strictNextDev = rawArgs.includes("--strict");
const cleanPythonBytecode =
  rawArgs.includes("--clean-python-cache") ||
  ["1", "true", "yes", "on"].includes(String(env.KERA_CLEAN_PYTHON_BYTECODE ?? "").trim().toLowerCase());
const tauriArgs = rawArgs.filter((arg) => !["--next", "--clean", "--strict", "--clean-python-cache"].includes(arg));
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
const repoRootDir = path.resolve(process.cwd(), "..");
const runtimeCacheDir = path.resolve(process.cwd(), ".desktop-runtime", "python-runtime");
const runtimeArchivePath = path.resolve(process.cwd(), ".desktop-runtime-bundle", "python-runtime.zip");
const repoVenvPython = process.platform === "win32"
  ? path.join(repoRootDir, ".venv", "Scripts", "python.exe")
  : path.join(repoRootDir, ".venv", "bin", "python");
const repoVenvBinDir = path.dirname(repoVenvPython);
const srcTauriDir = path.resolve(process.cwd(), "src-tauri");
const baseTauriConfigPath = path.join(
  srcTauriDir,
  useNextDev ? "tauri.next.dev.conf.json" : "tauri.dev.conf.json",
);
const generatedTauriConfigPath = path.join(srcTauriDir, "tauri.dev.generated.conf.json");

if (!fs.existsSync(repoVenvPython)) {
  console.error(`K-ERA desktop dev requires the uv-managed repository .venv interpreter, but it was not found: ${repoVenvPython}`);
  console.error("Run .\\scripts\\setup_local_node.ps1 from the repository root first.");
  process.exit(1);
}

if (!env.CARGO_BUILD_JOBS) {
  env.CARGO_BUILD_JOBS = String(Math.max(1, Math.min(os.cpus().length, 4)));
}

if (!env.KERA_DESKTOP_RUNTIME_MODE) {
  env.KERA_DESKTOP_RUNTIME_MODE = "dev";
}

env.KERA_DESKTOP_LOCAL_BACKEND_PYTHON = repoVenvPython;

if (!env.KERA_RUNTIME_OWNER) {
  env.KERA_RUNTIME_OWNER = randomUUID();
}

if (!env.KERA_DESKTOP_BACKEND_ROOT) {
  env.KERA_DESKTOP_BACKEND_ROOT = path.resolve(process.cwd(), "..");
}

if (!env.KERA_NEXT_DEV_CLEAN) {
  env.KERA_NEXT_DEV_CLEAN = cleanNextDev ? "1" : "0";
}

if (!env.KERA_NEXT_STRICT_MODE) {
  env.KERA_NEXT_STRICT_MODE = strictNextDev ? "1" : "0";
}

if (!env.KERA_DESKTOP_STRICT_MODE) {
  env.KERA_DESKTOP_STRICT_MODE = strictNextDev ? "1" : "0";
}

const desktopShellPreferredPort = Number.parseInt(
  env.KERA_DESKTOP_SHELL_DEV_PORT ?? String(DEFAULT_DESKTOP_SHELL_DEV_PORT),
  10,
);
const desktopShellPortResolution = useNextDev
  ? null
  : await resolveDesktopShellDevPort({
      preferredPort: desktopShellPreferredPort,
    });
const devServerPort = useNextDev ? 3000 : desktopShellPortResolution.port;
const tauriConfigPath = useNextDev
  ? path.relative(process.cwd(), baseTauriConfigPath)
  : prepareDesktopShellDevConfig(baseTauriConfigPath, generatedTauriConfigPath, devServerPort);

if (!useNextDev) {
  env.KERA_DESKTOP_SHELL_DEV_PORT = String(devServerPort);
  if (desktopShellPortResolution.usedFallback) {
    console.warn(
      `[run-tauri-dev] Port ${desktopShellPreferredPort} was unavailable (${desktopShellPortResolution.fallbackReason ?? "unknown"}); using ${devServerPort}.`,
    );
  }
}

function cleanupDevProcesses() {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/f", "/im", "kera-desktop-shell.exe", "/t"], { stdio: "ignore" });
    spawnSync("powershell", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      [
        "$ErrorActionPreference = 'SilentlyContinue'",
        `$targets = @(${[cargoTargetDir, runtimeCacheDir, repoVenvBinDir].map((entry) => JSON.stringify(entry)).join(", ")})`,
        "Get-CimInstance Win32_Process |",
        "  Where-Object {",
        "    $processPath = $_.ExecutablePath",
        "    if (-not $processPath) { return $false }",
        "    foreach ($targetPrefix in $targets) {",
        "      if ($processPath.StartsWith($targetPrefix, [System.StringComparison]::OrdinalIgnoreCase)) { return $true }",
        "    }",
        "    return $false",
        "  } |",
        "  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
      ].join("\n"),
    ], { stdio: "ignore" });
    spawnSync("powershell", [
      "-Command",
      `Get-NetTCPConnection -LocalPort ${devServerPort} -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }`
    ], { stdio: "ignore" });
    return;
  }
  spawnSync("pkill", ["-f", "kera-desktop-shell"], { stdio: "ignore" });
  spawnSync("sh", ["-c", `lsof -ti:${devServerPort} | xargs kill -9 >/dev/null 2>&1`], { stdio: "ignore" });
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

function prepareDesktopShellDevConfig(sourceConfigPath, outputConfigPath, port) {
  const tauriConfig = JSON.parse(fs.readFileSync(sourceConfigPath, "utf8"));
  const generatedConfig = {
    ...tauriConfig,
    build: {
      ...(tauriConfig.build ?? {}),
      devUrl: `http://127.0.0.1:${port}`,
    },
  };
  fs.writeFileSync(outputConfigPath, `${JSON.stringify(generatedConfig, null, 2)}\n`, "utf8");
  return path.relative(process.cwd(), outputConfigPath);
}

function ensureRuntimeArchiveExists() {
  if (fs.existsSync(runtimeArchivePath)) {
    return;
  }
  const result =
    process.platform === "win32"
      ? spawnSync("cmd.exe", ["/d", "/s", "/c", "node ./scripts/prepare-embedded-python.mjs"], {
          stdio: "inherit",
          env,
        })
      : spawnSync("node", ["./scripts/prepare-embedded-python.mjs"], {
          stdio: "inherit",
          env,
        });
  if (result.error) {
    throw result.error;
  }
  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }
}

console.log(`Cleaning up previous Tauri and ${useNextDev ? "Next" : "desktop-shell"} dev processes...`);
cleanupDevProcesses();
ensureRuntimeArchiveExists();
if (cleanPythonBytecode) {
  removePythonBytecodeCaches(repoPythonSourceDir);
}

const child =
  process.platform === "win32"
    ? spawn(
        "cmd.exe",
        ["/d", "/s", "/c", `npx tauri dev --config ${tauriConfigPath} ${tauriArgs.join(" ")}`.trim()],
        {
          stdio: "inherit",
          env,
        },
      )
    : spawn("npx", ["tauri", "dev", "--config", tauriConfigPath, ...tauriArgs], {
        stdio: "inherit",
        env,
      });

child.on("exit", (code, signal) => {
  cleanupDevProcesses();
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    cleanupDevProcesses();
  });
}
