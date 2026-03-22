import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const frontendRoot = process.cwd();
const repoRoot = path.resolve(frontendRoot, "..");
const [command = "dev", ...rawArgs] = process.argv.slice(2);

if (!["dev", "build", "start"].includes(command)) {
  console.error(`[run-next-command] Unsupported Next command: ${command}`);
  process.exit(1);
}

loadEnvIfPresent(path.join(frontendRoot, ".env.local"));
loadEnvIfPresent(path.join(frontendRoot, ".env"));
loadEnvIfPresent(path.join(repoRoot, ".env.local"));
loadEnvIfPresent(path.join(repoRoot, ".env"));

if (command === "dev") {
  const prepare = spawnSync(process.execPath, [path.join(frontendRoot, "scripts", "prepare-dev.mjs"), ...rawArgs], {
    stdio: "inherit",
    env: process.env,
  });
  if (prepare.status !== 0) {
    process.exit(prepare.status ?? 1);
  }
}

const nextArgs = [
  path.join(frontendRoot, "node_modules", "next", "dist", "bin", "next"),
  command,
  ...rawArgs.filter((arg) => arg !== "--clean" && arg !== "--clean-only"),
];

const child = spawn(process.execPath, nextArgs, {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

function loadEnvIfPresent(filePath) {
  try {
    process.loadEnvFile(filePath);
  } catch {
    // Missing optional env files are expected in local dev.
  }
}
