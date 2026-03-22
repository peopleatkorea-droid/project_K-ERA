import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const cwd = process.cwd();
const defaultPort = Number.parseInt(process.env.PORT ?? "3000", 10);
const portArgIndex = process.argv.indexOf("--port");
const port =
  portArgIndex >= 0 && process.argv[portArgIndex + 1]
    ? Number.parseInt(process.argv[portArgIndex + 1], 10)
    : defaultPort;
const shouldClean =
  args.has("--clean") ||
  args.has("--clean-only") ||
  ["1", "true", "yes", "on"].includes(String(process.env.KERA_NEXT_DEV_CLEAN ?? "").trim().toLowerCase());
const cleanOnly = args.has("--clean-only");

if (!Number.isInteger(port) || port <= 0) {
  console.error("[prepare-dev] Invalid port.");
  process.exit(1);
}

await main();

async function main() {
  if (shouldClean) {
    cleanBuildArtifacts();
  }

  if (!cleanOnly) {
    await releaseDevPort(port);
  }
}

function cleanBuildArtifacts() {
  for (const dir of [".next", ".next_broken"]) {
    const target = path.join(cwd, dir);
    if (!fs.existsSync(target)) {
      continue;
    }

    fs.rmSync(target, { recursive: true, force: true });
    console.log(`[prepare-dev] Removed ${dir}`);
  }
}

async function releaseDevPort(targetPort) {
  const pids = getListeningPids(targetPort);
  if (pids.length === 0) {
    return;
  }

  for (const pid of pids) {
    const info = getProcessInfo(pid);
    if (!canStopProcess(info)) {
      const details = info?.name ? `${info.name} (PID ${pid})` : `PID ${pid}`;
      throw new Error(
        `[prepare-dev] Port ${targetPort} is in use by ${details}. Stop it manually or change the dev port.`,
      );
    }

    console.log(`[prepare-dev] Stopping ${info.name} (PID ${pid}) on port ${targetPort}`);
    stopProcess(pid);
  }

  await waitForPortRelease(targetPort);
}

function canStopProcess(info) {
  if (!info?.name) {
    return false;
  }

  const processName = info.name.toLowerCase();
  const commandLine = normalizeSlashes(info.commandLine ?? "");
  const projectRoot = normalizeSlashes(cwd);
  const nextBin = normalizeSlashes(path.join(cwd, "node_modules", "next", "dist", "bin", "next"));
  const nextCache = normalizeSlashes(path.join(cwd, ".next"));

  if (!/^(node|node\.exe|npm|npm\.cmd|pnpm|pnpm\.cmd)$/i.test(processName)) {
    return false;
  }

  return commandLine.includes(projectRoot) || commandLine.includes(nextBin) || commandLine.includes(nextCache);
}

async function waitForPortRelease(targetPort) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (getListeningPids(targetPort).length === 0) {
      return;
    }

    await delay(250);
  }

  throw new Error(`[prepare-dev] Port ${targetPort} did not become available in time.`);
}

function getListeningPids(targetPort) {
  if (process.platform === "win32") {
    return getListeningPidsWindows(targetPort);
  }

  return getListeningPidsPosix(targetPort);
}

function getListeningPidsWindows(targetPort) {
  let output = "";
  try {
    output = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Get-NetTCPConnection -State Listen -LocalPort ${targetPort} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique`,
      ],
      { encoding: "utf8" },
    ).trim();
  } catch {
    return [];
  }

  if (!output) {
    return [];
  }

  return output
    .split(/\r?\n/)
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function getListeningPidsPosix(targetPort) {
  const commands = [
    ["lsof", ["-tiTCP:" + targetPort, "-sTCP:LISTEN"]],
    ["ss", ["-ltnp", `sport = :${targetPort}`]],
  ];

  for (const [command, commandArgs] of commands) {
    try {
      const output = execFileSync(command, commandArgs, { encoding: "utf8" }).trim();
      if (!output) {
        return [];
      }

      if (command === "lsof") {
        return output
          .split(/\r?\n/)
          .map((value) => Number.parseInt(value.trim(), 10))
          .filter((value) => Number.isInteger(value) && value > 0);
      }

      return [...output.matchAll(/pid=(\d+)/g)]
        .map((match) => Number.parseInt(match[1], 10))
        .filter((value) => Number.isInteger(value) && value > 0);
    } catch {
      continue;
    }
  }

  return [];
}

function getProcessInfo(pid) {
  if (process.platform === "win32") {
    return getProcessInfoWindows(pid);
  }

  return getProcessInfoPosix(pid);
}

function getProcessInfoWindows(pid) {
  try {
    const output = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue; if ($p) { [pscustomobject]@{ Name = $p.Name; CommandLine = $p.CommandLine } | ConvertTo-Json -Compress }`,
      ],
      { encoding: "utf8" },
    ).trim();

    if (!output) {
      return null;
    }

    const parsed = JSON.parse(output);
    return {
      name: parsed.Name,
      commandLine: parsed.CommandLine ?? "",
    };
  } catch {
    return null;
  }
}

function getProcessInfoPosix(pid) {
  try {
    const name = execFileSync("ps", ["-p", String(pid), "-o", "comm="], {
      encoding: "utf8",
    }).trim();
    const commandLine = execFileSync("ps", ["-p", String(pid), "-o", "args="], {
      encoding: "utf8",
    }).trim();

    if (!name) {
      return null;
    }

    return { name, commandLine };
  } catch {
    return null;
  }
}

function stopProcess(pid) {
  if (process.platform === "win32") {
    execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }

  process.kill(pid, "SIGTERM");
}

function normalizeSlashes(value) {
  return value.replaceAll("\\", "/").toLowerCase();
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
