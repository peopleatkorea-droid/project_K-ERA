import fs from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";

const frontendRoot = process.cwd();
const repoRoot = path.resolve(frontendRoot, "..");
const buildRoot = path.join(frontendRoot, ".desktop-runtime");
const runtimeDir = path.join(buildRoot, "python-runtime");
const runtimeBundleRoot = path.join(frontendRoot, ".desktop-runtime-bundle");
const runtimeArchivePath = path.join(runtimeBundleRoot, "python-runtime.zip");
const manifestPath = path.join(buildRoot, "python-runtime-manifest.json");
const cpuWheelCacheDir = path.join(buildRoot, "wheels", "cpu");
const defaultVenvDir = process.env.KERA_DESKTOP_EMBED_VENV
  ? path.resolve(frontendRoot, process.env.KERA_DESKTOP_EMBED_VENV)
  : path.join(repoRoot, ".venv");
const stagingLayoutVersion = 2;
const cpuTorchIndexUrl =
  process.env.KERA_DESKTOP_CPU_TORCH_INDEX_URL || "https://download.pytorch.org/whl/cpu";
const standardLibraryPruneTokens = new Set([
  "ensurepip",
  "idlelib",
  "test",
  "tkinter",
  "turtledemo",
  "venv",
]);
const sitePackagesPruneTokens = [
  "debugpy",
  "streamlit",
  "altair",
  "pydeck",
  "jupyter",
  "jupyterlab",
  "jupyter_server",
  "jupyter_client",
  "jupyter_core",
  "jupyter_events",
  "jupyter_lsp",
  "jupyter_server_terminals",
  "nbclient",
  "nbconvert",
  "nbformat",
  "notebook",
  "notebook_shim",
  "nbclassic",
  "ipython",
  "ipykernel",
  "ipywidgets",
  "widgetsnbextension",
  "pytest",
  "_pytest",
  "pluggy",
  "py",
  "pip",
  "setuptools",
  "wheel",
  "spyder",
  "spyder_kernels",
  "qtconsole",
  "qtpy",
];
const transientPathSegments = new Set(["__pycache__", ".pytest_cache", "test", "tests"]);
const torchCleanupTokens = ["torch", "torchgen", "functorch", "torchvision", "torchvision_libs"];

function log(message) {
  process.stdout.write(`[desktop-python] ${message}\n`);
}

function normalizeBoolean(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function readText(filePath) {
  return fs.readFile(filePath, "utf8");
}

function parsePyvenvCfg(raw) {
  const values = new Map();
  for (const line of raw.split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index <= 0) {
      continue;
    }
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (!key || !value) {
      continue;
    }
    values.set(key, value);
  }
  return values;
}

function venvPythonPath(venvDir) {
  return process.platform === "win32"
    ? path.join(venvDir, "Scripts", "python.exe")
    : path.join(venvDir, "bin", "python");
}

function runCommand(commandPath, args, options = {}) {
  try {
    return execFileSync(commandPath, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...(options.env ?? {}),
      },
    }).trim();
  } catch (error) {
    const stdout = error.stdout ? String(error.stdout).trim() : "";
    const stderr = error.stderr ? String(error.stderr).trim() : "";
    const details = [stderr, stdout].filter(Boolean).join("\n");
    throw new Error(
      `Command failed: ${[commandPath, ...args].join(" ")}${details ? `\n${details}` : ""}`,
    );
  }
}

function runPython(pythonPath, code, options = {}) {
  return runCommand(pythonPath, ["-c", code], options);
}

function runPythonArgs(pythonPath, args, options = {}) {
  return runCommand(pythonPath, args, options);
}

function normalizePackageToken(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function stripMetadataSuffix(entryName) {
  return entryName.replace(/\.(dist-info|egg-info|data|pth)$/i, "");
}

function topLevelEntryName(relativePath) {
  return relativePath.replace(/\\/g, "/").split("/")[0];
}

function hasTransientSegment(relativePath) {
  const segments = relativePath
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.toLowerCase());
  return segments.some((segment) => transientPathSegments.has(segment));
}

function matchesPackageToken(entryName, token) {
  const normalizedEntry = normalizePackageToken(stripMetadataSuffix(entryName));
  return normalizedEntry === token || normalizedEntry.startsWith(`${token}_`);
}

function shouldPruneSitePackagesTopLevel(entryName) {
  return sitePackagesPruneTokens.some((token) => matchesPackageToken(entryName, token));
}

function shouldReplaceCudaTorch(pythonInfo) {
  if (normalizeBoolean(process.env.KERA_DESKTOP_KEEP_CUDA_TORCH)) {
    return false;
  }
  if (normalizeBoolean(process.env.KERA_DESKTOP_FORCE_CPU_TORCH)) {
    return true;
  }
  return [pythonInfo.torchVersion, pythonInfo.torchvisionVersion].some((version) =>
    String(version ?? "").includes("+cu"),
  );
}

function basePackageVersion(version) {
  return String(version ?? "").split("+")[0].trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function resolveSourcePython() {
  const venvDir = defaultVenvDir;
  const pythonPath = venvPythonPath(venvDir);
  if (!existsSync(pythonPath)) {
    throw new Error(`Python virtual environment was not found: ${pythonPath}`);
  }

  const pyvenvCfgPath = path.join(venvDir, "pyvenv.cfg");
  let sourceHome = process.env.KERA_DESKTOP_EMBED_PYTHON_HOME
    ? path.resolve(frontendRoot, process.env.KERA_DESKTOP_EMBED_PYTHON_HOME)
    : "";
  if (!sourceHome && existsSync(pyvenvCfgPath)) {
    const parsed = parsePyvenvCfg(await readText(pyvenvCfgPath));
    sourceHome = parsed.get("home") ? path.resolve(parsed.get("home")) : "";
  }
  if (!sourceHome) {
    sourceHome = runPython(
      pythonPath,
      "import json, sys; print(json.dumps({'base_prefix': sys.base_prefix}))",
    );
    sourceHome = JSON.parse(sourceHome).base_prefix;
  }

  const info = JSON.parse(
    runPython(
      pythonPath,
      [
        "import json, platform, site, sys, sysconfig",
        "payload = {",
        "  'venv_python': sys.executable,",
        "  'base_prefix': sys.base_prefix,",
        "  'version': platform.python_version(),",
        "  'torch_version': None,",
        "  'torchvision_version': None,",
        "}",
        "try:",
        "  import torch",
        "  payload['torch_version'] = getattr(torch, '__version__', None)",
        "except Exception:",
        "  pass",
        "try:",
        "  import torchvision",
        "  payload['torchvision_version'] = getattr(torchvision, '__version__', None)",
        "except Exception:",
        "  pass",
        "print(json.dumps(payload))",
      ].join("\n"),
    ),
  );

  return {
    venvDir,
    venvPythonPath: pythonPath,
    sourceHome: path.resolve(sourceHome),
    version: info.version,
    torchVersion: info.torch_version || null,
    torchvisionVersion: info.torchvision_version || null,
    pyvenvCfgPath,
  };
}

function signatureForPath(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }
  const stat = statSync(filePath);
  return {
    path: path.resolve(filePath),
    mtimeMs: stat.mtimeMs,
    size: stat.size,
  };
}

function computeSignature(pythonInfo) {
  const useCpuTorch = shouldReplaceCudaTorch(pythonInfo);
  const payload = {
    layoutVersion: stagingLayoutVersion,
    version: pythonInfo.version,
    sourceHome: path.resolve(pythonInfo.sourceHome),
    venvDir: path.resolve(pythonInfo.venvDir),
    sourcePython: signatureForPath(path.join(pythonInfo.sourceHome, "python.exe")),
    venvPython: signatureForPath(pythonInfo.venvPythonPath),
    pyvenvCfg: signatureForPath(pythonInfo.pyvenvCfgPath),
    requirements: [
      signatureForPath(path.join(repoRoot, "requirements.txt")),
      signatureForPath(path.join(repoRoot, "requirements-cpu.txt")),
      signatureForPath(path.join(repoRoot, "requirements-gpu-cu128.txt")),
    ],
    sitePackages: signatureForPath(path.join(pythonInfo.venvDir, "Lib", "site-packages")),
    torchVersion: pythonInfo.torchVersion,
    torchvisionVersion: pythonInfo.torchvisionVersion,
    cpuTorchIndexUrl: useCpuTorch ? cpuTorchIndexUrl : null,
    useCpuTorch,
    sitePackagesPruneTokens,
    standardLibraryPruneTokens: [...standardLibraryPruneTokens],
    forceCpuTorch: normalizeBoolean(process.env.KERA_DESKTOP_FORCE_CPU_TORCH),
    keepCudaTorch: normalizeBoolean(process.env.KERA_DESKTOP_KEEP_CUDA_TORCH),
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function loadManifest() {
  if (!existsSync(manifestPath)) {
    return null;
  }
  try {
    return JSON.parse(await readText(manifestPath));
  } catch {
    return null;
  }
}

function shouldCopyRootFile(name) {
  if (name === "python.exe" || name === "pythonw.exe") {
    return true;
  }
  if (name === "LICENSE_PYTHON.txt" || name === "README.txt") {
    return true;
  }
  return name.toLowerCase().endsWith(".dll");
}

function shouldCopyLibEntry(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized === "site-packages" || normalized.startsWith("site-packages/")) {
    return false;
  }
  if (hasTransientSegment(relativePath)) {
    return false;
  }
  if (normalized.endsWith(".pyc") || normalized.endsWith(".pyo")) {
    return false;
  }
  if (standardLibraryPruneTokens.has(normalizePackageToken(topLevelEntryName(relativePath)))) {
    return false;
  }
  return true;
}

function shouldCopySitePackagesEntry(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/");
  if (hasTransientSegment(relativePath)) {
    return false;
  }
  if (shouldPruneSitePackagesTopLevel(topLevelEntryName(relativePath))) {
    return false;
  }
  if (normalized.endsWith(".pyc") || normalized.endsWith(".pyo")) {
    return false;
  }
  return true;
}

async function copyDirectoryFiltered(sourceDir, destinationDir, filter) {
  await fs.cp(sourceDir, destinationDir, {
    recursive: true,
    force: true,
    filter: (source) => {
      const relative = path.relative(sourceDir, source);
      if (!relative) {
        return true;
      }
      return filter(relative);
    },
  });
}

async function findCachedWheel(wheelDirectory, packageName, packageVersion) {
  if (!existsSync(wheelDirectory)) {
    return null;
  }
  const wheelPattern = new RegExp(
    `^${escapeRegExp(packageName)}-${escapeRegExp(packageVersion)}(?:\\+cpu)?-.*\\.whl$`,
    "i",
  );
  const entries = await fs.readdir(wheelDirectory);
  const match = entries.find((entry) => wheelPattern.test(entry));
  return match ? path.join(wheelDirectory, match) : null;
}

async function ensureCpuTorchWheels(pythonInfo) {
  const torchVersion = basePackageVersion(pythonInfo.torchVersion);
  const torchvisionVersion = basePackageVersion(pythonInfo.torchvisionVersion);
  if (!torchVersion) {
    throw new Error("Embedded runtime requested a CPU torch override, but torch is not installed.");
  }

  await fs.mkdir(cpuWheelCacheDir, { recursive: true });

  let torchWheel = await findCachedWheel(cpuWheelCacheDir, "torch", torchVersion);
  let torchvisionWheel = torchvisionVersion
    ? await findCachedWheel(cpuWheelCacheDir, "torchvision", torchvisionVersion)
    : null;

  if (!torchWheel || (torchvisionVersion && !torchvisionWheel)) {
    const specs = [`torch==${torchVersion}`];
    if (torchvisionVersion) {
      specs.push(`torchvision==${torchvisionVersion}`);
    }
    log(`downloading CPU torch wheels from ${cpuTorchIndexUrl}`);
    runPythonArgs(pythonInfo.venvPythonPath, [
      "-m",
      "pip",
      "download",
      "--dest",
      cpuWheelCacheDir,
      "--no-deps",
      "--index-url",
      cpuTorchIndexUrl,
      ...specs,
    ]);
    torchWheel = await findCachedWheel(cpuWheelCacheDir, "torch", torchVersion);
    torchvisionWheel = torchvisionVersion
      ? await findCachedWheel(cpuWheelCacheDir, "torchvision", torchvisionVersion)
      : null;
  }

  if (!torchWheel || (torchvisionVersion && !torchvisionWheel)) {
    throw new Error("Failed to resolve cached CPU torch wheels for the embedded runtime.");
  }

  return {
    torchVersion,
    torchvisionVersion,
    torchWheel,
    torchvisionWheel,
  };
}

async function removeMatchingSitePackagesEntries(sitePackagesDir, tokens) {
  if (!existsSync(sitePackagesDir)) {
    return;
  }
  const entries = await fs.readdir(sitePackagesDir);
  for (const entry of entries) {
    if (!tokens.some((token) => matchesPackageToken(entry, token))) {
      continue;
    }
    await fs.rm(path.join(sitePackagesDir, entry), {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 500,
    });
  }
}

async function replaceCudaTorchWithCpuWheels(pythonInfo) {
  const sitePackagesDir = path.join(runtimeDir, "Lib", "site-packages");
  const wheelInfo = await ensureCpuTorchWheels(pythonInfo);
  log(`replacing CUDA torch packages with CPU wheels (${wheelInfo.torchVersion})`);
  await removeMatchingSitePackagesEntries(sitePackagesDir, torchCleanupTokens);

  const installArgs = [
    "-m",
    "pip",
    "install",
    "--no-deps",
    "--force-reinstall",
    "--target",
    sitePackagesDir,
    wheelInfo.torchWheel,
  ];
  if (wheelInfo.torchvisionWheel) {
    installArgs.push(wheelInfo.torchvisionWheel);
  }
  runPythonArgs(pythonInfo.venvPythonPath, installArgs);
}

async function prepareEmbeddedPythonRuntime(pythonInfo) {
  log(`staging runtime from ${pythonInfo.sourceHome}`);
  await fs.rm(runtimeDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
  await fs.mkdir(runtimeDir, { recursive: true });

  const sourceEntries = await fs.readdir(pythonInfo.sourceHome, { withFileTypes: true });
  for (const entry of sourceEntries) {
    if (!entry.isFile() || !shouldCopyRootFile(entry.name)) {
      continue;
    }
    await fs.copyFile(
      path.join(pythonInfo.sourceHome, entry.name),
      path.join(runtimeDir, entry.name),
    );
  }

  for (const directoryName of ["DLLs", "Library", "libs", "share"]) {
    const sourceDir = path.join(pythonInfo.sourceHome, directoryName);
    if (!existsSync(sourceDir)) {
      continue;
    }
    await copyDirectoryFiltered(sourceDir, path.join(runtimeDir, directoryName), () => true);
  }

  const sourceLibDir = path.join(pythonInfo.sourceHome, "Lib");
  if (existsSync(sourceLibDir)) {
    await copyDirectoryFiltered(sourceLibDir, path.join(runtimeDir, "Lib"), shouldCopyLibEntry);
  }

  const sitePackagesSource = path.join(pythonInfo.venvDir, "Lib", "site-packages");
  if (!existsSync(sitePackagesSource)) {
    throw new Error(`Virtual environment site-packages was not found: ${sitePackagesSource}`);
  }
  await fs.mkdir(path.join(runtimeDir, "Lib"), { recursive: true });
  await copyDirectoryFiltered(
    sitePackagesSource,
    path.join(runtimeDir, "Lib", "site-packages"),
    shouldCopySitePackagesEntry,
  );

  const cpuTorchEnabled = shouldReplaceCudaTorch(pythonInfo);
  if (cpuTorchEnabled) {
    await replaceCudaTorchWithCpuWheels(pythonInfo);
  }

  const metadata = {
    prepared_at: new Date().toISOString(),
    python_version: pythonInfo.version,
    source_home: path.resolve(pythonInfo.sourceHome),
    venv_dir: path.resolve(pythonInfo.venvDir),
    torch_version: pythonInfo.torchVersion,
    torchvision_version: pythonInfo.torchvisionVersion,
    cpu_torch_enabled: cpuTorchEnabled,
    site_packages_pruned: sitePackagesPruneTokens,
  };
  await fs.mkdir(buildRoot, { recursive: true });
  await fs.writeFile(path.join(runtimeDir, "kera-runtime.json"), `${JSON.stringify(metadata, null, 2)}\n`);
}

function buildValidationImports(runtimePythonPath) {
  const checks = [
    "import fastapi, uvicorn, numpy, pandas, PIL, sklearn, requests, httpx, jwt, bcrypt",
    "import google.auth",
  ];

  const sitePackagesDir = path.join(runtimeDir, "Lib", "site-packages");
  const maybeModules = [
    ["torch", "import torch"],
    ["torchvision", "import torchvision"],
    ["transformers", "import transformers"],
    ["open_clip", "import open_clip"],
    ["faiss", "import faiss"],
  ];
  for (const [moduleName, statement] of maybeModules) {
    const packageDir = path.join(sitePackagesDir, moduleName);
    const packageFile = path.join(sitePackagesDir, `${moduleName}.py`);
    if (existsSync(packageDir) || existsSync(packageFile)) {
      checks.push(statement);
    }
  }

  const tempStorage = path.join(buildRoot, "runtime-validation-storage");
  const backendImport = [
    "import kera_research.api.app",
    "import kera_research.worker",
    "print('backend-ok')",
  ].join("; ");
  const backendEnv = {
    KERA_SKIP_LOCAL_ENV_FILE: "1",
    KERA_STORAGE_DIR: tempStorage,
    KERA_DATA_PLANE_DATABASE_URL: `sqlite:///${path.join(tempStorage, "kera.db").replace(/\\/g, "/")}`,
    KERA_CONTROL_PLANE_DATABASE_URL: `sqlite:///${path.join(tempStorage, "kera.db").replace(/\\/g, "/")}`,
    PYTHONPATH: path.join(repoRoot, "src"),
  };

  return { checks, backendEnv, backendImport, tempStorage, runtimePythonPath };
}

async function validateEmbeddedPythonRuntime(runtimePythonPath) {
  log("validating staged runtime");
  const { checks, backendEnv, backendImport, tempStorage } = buildValidationImports(runtimePythonPath);
  await fs.rm(tempStorage, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
  await fs.mkdir(tempStorage, { recursive: true });

  for (const statement of checks) {
    runPython(runtimePythonPath, `${statement}; print("ok")`);
  }
  runPython(runtimePythonPath, backendImport, { env: backendEnv });
}

async function syncBundledRuntimeArchive(runtimePythonPath) {
  log(`syncing bundled runtime archive to ${runtimeArchivePath}`);
  await fs.mkdir(runtimeBundleRoot, { recursive: true });
  const archiveScript = [
    "from pathlib import Path",
    "import sys, zipfile",
    "source = Path(sys.argv[1])",
    "target = Path(sys.argv[2])",
    "tmp = target.with_suffix('.tmp')",
    "if tmp.exists():",
    "    tmp.unlink()",
    "with zipfile.ZipFile(tmp, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:",
    "    for path in sorted(source.rglob('*')):",
    "        if path.is_dir():",
    "            continue",
    "        archive.write(path, path.relative_to(source).as_posix())",
    "if target.exists():",
    "    target.unlink()",
    "tmp.replace(target)",
  ].join("\n");
  runPythonArgs(runtimePythonPath, ["-c", archiveScript, runtimeDir, runtimeArchivePath]);
}

async function main() {
  if (normalizeBoolean(process.env.KERA_DESKTOP_SKIP_EMBED_PYTHON)) {
    log("skipping embedded python preparation because KERA_DESKTOP_SKIP_EMBED_PYTHON is set");
    return;
  }

  const pythonInfo = await resolveSourcePython();
  const cpuTorchEnabled = shouldReplaceCudaTorch(pythonInfo);
  if (cpuTorchEnabled && pythonInfo.torchVersion) {
    log(
      `detected CUDA torch build (${pythonInfo.torchVersion}); the embedded runtime will be normalized to CPU wheels.`,
    );
  }

  const signature = computeSignature(pythonInfo);
  const existingManifest = await loadManifest();
  const force = normalizeBoolean(process.env.KERA_DESKTOP_FORCE_EMBED_PYTHON);

  if (!force && existingManifest?.signature === signature && existsSync(path.join(runtimeDir, "python.exe"))) {
    if (!existsSync(runtimeArchivePath)) {
      await syncBundledRuntimeArchive(pythonInfo.venvPythonPath);
    }
    log(`reusing cached runtime at ${runtimeDir}`);
    return;
  }

  await prepareEmbeddedPythonRuntime(pythonInfo);
  await validateEmbeddedPythonRuntime(path.join(runtimeDir, "python.exe"));

  const manifest = {
    signature,
    prepared_at: new Date().toISOString(),
    python_version: pythonInfo.version,
    source_home: path.resolve(pythonInfo.sourceHome),
    venv_dir: path.resolve(pythonInfo.venvDir),
    runtime_dir: path.resolve(runtimeDir),
    torch_version: pythonInfo.torchVersion,
    torchvision_version: pythonInfo.torchvisionVersion,
    cpu_torch_enabled: cpuTorchEnabled,
  };
  await fs.mkdir(buildRoot, { recursive: true });
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await syncBundledRuntimeArchive(pythonInfo.venvPythonPath);
  log(`runtime ready: ${runtimeDir}`);
}

await main();
