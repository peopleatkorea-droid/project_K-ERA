import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const frontendRoot = process.cwd();
const tauriRoot = path.join(frontendRoot, "src-tauri");
const env = { ...process.env };

const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
const pathEntries = String(env[pathKey] ?? "")
  .split(path.delimiter)
  .filter(Boolean);
const cargoBinDir = path.join(os.homedir(), ".cargo", "bin");

if (fs.existsSync(cargoBinDir) && !pathEntries.includes(cargoBinDir)) {
  env[pathKey] = [cargoBinDir, ...pathEntries].join(path.delimiter);
}

const steps = [
  { label: "desktop bundle", command: "npm", args: ["run", "desktop:bundle"], cwd: frontendRoot },
  { label: "desktop verify", command: "npm", args: ["run", "desktop:verify"], cwd: frontendRoot },
  { label: "frontend tests", command: "npm", args: ["run", "test:run"], cwd: frontendRoot },
  { label: "frontend build", command: "npm", args: ["run", "build"], cwd: frontendRoot },
  { label: "cargo check", command: "cargo", args: ["check"], cwd: tauriRoot },
];

function runStep(step) {
  process.stdout.write(`\n[desktop-smoke] ${step.label}\n`);
  const result = spawnSync(step.command, step.args, {
    cwd: step.cwd,
    env,
    stdio: "inherit",
    shell: process.platform === "win32" && step.command === "npm",
  });
  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }
  if (result.error) {
    throw result.error;
  }
}

for (const step of steps) {
  runStep(step);
}

process.stdout.write("\n[desktop-smoke] completed successfully\n");
