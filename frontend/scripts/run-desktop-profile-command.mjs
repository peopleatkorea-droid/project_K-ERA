import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const frontendRoot = process.cwd();
const repoRoot = path.resolve(frontendRoot, "..");
const bundleRoot = path.join(frontendRoot, "src-tauri", "target", "release", "bundle");
const releaseRoot = path.join(frontendRoot, "src-tauri", "target", "release");
const variantRoot = path.join(frontendRoot, "desktop-package-variants");
const defaultVenvDir = process.env.KERA_DESKTOP_EMBED_VENV
  ? path.resolve(frontendRoot, process.env.KERA_DESKTOP_EMBED_VENV)
  : path.join(repoRoot, ".venv");
const [action = "package", profile = "cpu"] = process.argv.slice(2);

const supportedActions = new Map([
  ["prepare-runtime", "desktop:prepare-runtime"],
  ["bundle", "desktop:bundle"],
  ["package", "desktop:package"],
  ["smoke", "desktop:smoke"],
]);
const supportedProfiles = new Set(["cpu", "gpu"]);

if (!supportedActions.has(action) || !supportedProfiles.has(profile)) {
  const actionLabels = [...supportedActions.keys()].join(", ");
  const profileLabels = [...supportedProfiles].join(", ");
  console.error(
    `[desktop-profile] Usage: node ./scripts/run-desktop-profile-command.mjs <${actionLabels}> <${profileLabels}>`,
  );
  process.exit(1);
}

const env = {
  ...process.env,
  KERA_DESKTOP_BUILD_VARIANT: profile,
};

if (profile === "gpu") {
  env.KERA_DESKTOP_KEEP_CUDA_TORCH = "1";
  delete env.KERA_DESKTOP_FORCE_CPU_TORCH;
} else {
  env.KERA_DESKTOP_FORCE_CPU_TORCH = "1";
  delete env.KERA_DESKTOP_KEEP_CUDA_TORCH;
}

if (profile === "gpu") {
  ensureCudaTorchSource(defaultVenvDir);
}

if (action === "package" && profile === "gpu") {
  runPortableGpuPackage(env);
} else {
  runNpmScript(supportedActions.get(action), env);
  if (action === "package") {
    snapshotBundleVariant(profile, env);
  }
}

function runNpmScript(scriptName, childEnv) {
  if (!scriptName) {
    throw new Error("Desktop profile script name was not resolved.");
  }

  process.stdout.write(`[desktop-profile] ${action} (${profile}) via npm run ${scriptName}\n`);
  const result = spawnSync("npm", ["run", scriptName], {
    cwd: frontendRoot,
    env: childEnv,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) {
    throw result.error;
  }
  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }
}

function runPortableGpuPackage(childEnv) {
  const buildScriptPath = path.join(frontendRoot, "scripts", "run-tauri-build.mjs");
  process.stdout.write("[desktop-profile] package (gpu) via portable release build\n");
  const result = spawnSync(process.execPath, [buildScriptPath, "--no-bundle"], {
    cwd: frontendRoot,
    env: childEnv,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }
  snapshotPortableVariant("gpu", childEnv);
}

function ensureCudaTorchSource(venvDir) {
  const pythonPath =
    process.platform === "win32"
      ? path.join(venvDir, "Scripts", "python.exe")
      : path.join(venvDir, "bin", "python");

  if (!fs.existsSync(pythonPath)) {
    console.error(
      `[desktop-profile] GPU package requested, but the source virtual environment was not found: ${pythonPath}`,
    );
    console.error(
      "[desktop-profile] Run .\\scripts\\setup_local_node.ps1 -TorchProfile gpu before building the GPU package.",
    );
    process.exit(1);
  }

  const result = spawnSync(
    pythonPath,
    [
      "-c",
      [
        "import json",
        "payload = {'torch_version': None}",
        "try:",
        "    import torch",
        "    payload['torch_version'] = getattr(torch, '__version__', None)",
        "except Exception:",
        "    pass",
        "print(json.dumps(payload))",
      ].join("\n"),
    ],
    {
      cwd: repoRoot,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  if (result.error || result.status !== 0) {
    console.error("[desktop-profile] Unable to inspect the source Python environment for GPU packaging.");
    if (result.stderr) {
      console.error(String(result.stderr).trim());
    }
    process.exit(result.status ?? 1);
  }

  let parsed;
  try {
    parsed = JSON.parse(String(result.stdout).trim());
  } catch {
    parsed = { torch_version: null };
  }

  const torchVersion = String(parsed.torch_version || "").trim();
  if (!torchVersion.includes("+cu")) {
    console.error(
      `[desktop-profile] GPU package requested, but the source virtual environment is not using a CUDA torch build: ${torchVersion || "missing torch"}`,
    );
    console.error(
      "[desktop-profile] Run .\\scripts\\setup_local_node.ps1 -TorchProfile gpu before building the GPU package.",
    );
    process.exit(1);
  }
}

function snapshotBundleVariant(currentProfile, childEnv) {
  if (!fs.existsSync(bundleRoot)) {
    console.error(`[desktop-profile] Packaged bundle output was not found: ${bundleRoot}`);
    process.exit(1);
  }

  const targetDir = path.join(variantRoot, currentProfile);
  fs.rmSync(targetDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
  fs.mkdirSync(variantRoot, { recursive: true });
  fs.cpSync(bundleRoot, targetDir, { recursive: true, force: true });

  const metadata = {
    profile: currentProfile,
    packaged_at: new Date().toISOString(),
    bundle_source: path.resolve(bundleRoot),
    keep_cuda_torch: childEnv.KERA_DESKTOP_KEEP_CUDA_TORCH === "1",
    force_cpu_torch: childEnv.KERA_DESKTOP_FORCE_CPU_TORCH === "1",
  };
  fs.writeFileSync(
    path.join(targetDir, "variant-manifest.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8",
  );

  process.stdout.write(`[desktop-profile] copied packaged artifacts to ${targetDir}\n`);
}

function snapshotPortableVariant(currentProfile, childEnv) {
  const portableEntries = ["kera-desktop-shell.exe", "backend", "_up_", "resources"];
  const missingEntries = portableEntries.filter((entry) => !fs.existsSync(path.join(releaseRoot, entry)));
  if (missingEntries.length > 0) {
    console.error(
      `[desktop-profile] Portable release output is incomplete. Missing: ${missingEntries.join(", ")}`,
    );
    process.exit(1);
  }

  const targetDir = path.join(variantRoot, currentProfile);
  const portableDir = path.join(targetDir, "portable");
  fs.rmSync(targetDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
  fs.mkdirSync(portableDir, { recursive: true });

  for (const entry of portableEntries) {
    fs.cpSync(path.join(releaseRoot, entry), path.join(portableDir, entry), {
      recursive: true,
      force: true,
    });
  }

  const metadata = {
    profile: currentProfile,
    packaged_at: new Date().toISOString(),
    package_kind: "portable",
    portable_source: path.resolve(releaseRoot),
    keep_cuda_torch: childEnv.KERA_DESKTOP_KEEP_CUDA_TORCH === "1",
    force_cpu_torch: childEnv.KERA_DESKTOP_FORCE_CPU_TORCH === "1",
  };
  fs.writeFileSync(
    path.join(targetDir, "variant-manifest.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8",
  );

  process.stdout.write(`[desktop-profile] copied portable GPU package to ${portableDir}\n`);
}
