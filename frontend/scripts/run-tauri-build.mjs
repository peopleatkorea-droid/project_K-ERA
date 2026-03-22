import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const env = { ...process.env };
const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
const pathEntries = String(env[pathKey] ?? "")
  .split(path.delimiter)
  .filter(Boolean);
const cargoBinDir = path.join(os.homedir(), ".cargo", "bin");

if (fs.existsSync(cargoBinDir) && !pathEntries.includes(cargoBinDir)) {
  env[pathKey] = [cargoBinDir, ...pathEntries].join(path.delimiter);
}

if (!env.KERA_DESKTOP_RUNTIME_MODE) {
  env.KERA_DESKTOP_RUNTIME_MODE = "packaged";
}

const frontendRoot = process.cwd();
const srcTauriDir = path.join(frontendRoot, "src-tauri");
const releaseDir = path.join(srcTauriDir, "target", "release");
const bundleOutputDir = path.join(releaseDir, "bundle");
const nsisWorkDir = path.join(releaseDir, "nsis");
const runtimeCacheDir = path.join(frontendRoot, ".desktop-runtime", "python-runtime");
const runtimeSnapshotRoot = path.join(frontendRoot, ".desktop-runtime-bundle");
const runtimeSnapshotDir = path.join(runtimeSnapshotRoot, "python-runtime");
const tauriConfigPath = path.join(srcTauriDir, "tauri.conf.json");
const generatedConfigPath = path.join(srcTauriDir, "tauri.build.generated.conf.json");

function stopRunningReleaseArtifacts() {
  if (process.platform !== "win32") {
    return;
  }
  const prefixes = [releaseDir, runtimeCacheDir]
    .map((entry) => path.resolve(entry))
    .filter((entry, index, values) => values.indexOf(entry) === index);
  const nsisNeedle = path.resolve(nsisWorkDir);
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$targets = @(${prefixes.map((entry) => JSON.stringify(entry)).join(", ")})`,
    `$nsisNeedle = ${JSON.stringify(nsisNeedle)}`,
    "$projectNeedle = 'project_K-ERA'",
    "Get-CimInstance Win32_Process |",
    "  Where-Object {",
    "    $processPath = $_.ExecutablePath",
    "    if ($processPath) {",
    "      foreach ($prefix in $targets) {",
    "        if ($prefix -and $processPath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) { return $true }",
    "      }",
    "    }",
    "    $commandLine = $_.CommandLine",
    "    if (-not $commandLine) { return $false }",
    "    if ($_.Name -eq 'makensis.exe') { return $true }",
    "    if ($_.Name -eq 'node.exe' -and $commandLine.Contains('@tauri-apps\\\\cli\\\\tauri.js') -and $commandLine.Contains(' build') -and $commandLine.Contains($projectNeedle)) { return $true }",
    "    return $false",
    "  } |",
    "  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }",
  ].join("\n");
  spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    stdio: "inherit",
    env,
  });
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function cleanupBuildArtifacts() {
  const cleanupTargets = [bundleOutputDir];
  const attempts = 5;
  for (const targetPath of cleanupTargets) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        if (!fs.existsSync(targetPath)) {
          break;
        }
        fs.rmSync(targetPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
        break;
      } catch (error) {
        if (attempt === attempts) {
          throw error;
        }
        stopRunningReleaseArtifacts();
        sleep(500 * attempt);
      }
    }
  }
}

function runChecked(command, args) {
  const result =
    process.platform === "win32"
      ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", [command, ...args].map(quoteWindowsArg).join(" ")], {
          stdio: "inherit",
          env,
          cwd: frontendRoot,
        })
      : spawnSync(command, args, {
          stdio: "inherit",
          env,
          cwd: frontendRoot,
        });
  if (result.error) {
    throw result.error;
  }
  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }
}

function copyDirectorySnapshot(sourceDir, destinationDir) {
  const attempts = 6;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      fs.rmSync(destinationDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
      fs.mkdirSync(path.dirname(destinationDir), { recursive: true });
      fs.cpSync(sourceDir, destinationDir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === attempts) {
        throw error;
      }
      stopRunningReleaseArtifacts();
      sleep(750 * attempt);
    }
  }
}

function prepareBuildConfig() {
  if (!fs.existsSync(runtimeCacheDir)) {
    throw new Error(`Desktop runtime cache was not found: ${runtimeCacheDir}`);
  }
  copyDirectorySnapshot(runtimeCacheDir, runtimeSnapshotDir);
  const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, "utf8"));
  const generatedConfig = {
    ...tauriConfig,
    build: {
      ...(tauriConfig.build ?? {}),
      beforeBuildCommand: 'node -e "process.exit(0)"',
    },
    bundle: {
      ...(tauriConfig.bundle ?? {}),
      resources: {
        ...(tauriConfig.bundle?.resources ?? {}),
        "../.desktop-runtime/python-runtime": "../.desktop-runtime-bundle/python-runtime",
      },
    },
  };
  fs.writeFileSync(generatedConfigPath, `${JSON.stringify(generatedConfig, null, 2)}\n`, "utf8");
}

function quoteWindowsArg(value) {
  const stringValue = String(value);
  if (!/[ \t"&()^%!]/.test(stringValue)) {
    return stringValue;
  }
  return `"${stringValue.replace(/(\\*)"/g, "$1$1\\\"").replace(/(\\+)$/g, "$1$1")}"`;
}

stopRunningReleaseArtifacts();
cleanupBuildArtifacts();
runChecked(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "desktop:bundle"]);
prepareBuildConfig();
const cliArgs = ["tauri", "build", "--config", path.relative(frontendRoot, generatedConfigPath), ...process.argv.slice(2)];
const child =
  process.platform === "win32"
    ? spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", ["npx", ...cliArgs].map(quoteWindowsArg).join(" ")], {
        stdio: "inherit",
        env,
      })
    : spawn("npx", cliArgs, {
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
