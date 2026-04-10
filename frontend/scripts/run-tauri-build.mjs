import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

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
const runtimeBundleRoot = path.join(frontendRoot, ".desktop-runtime-bundle");
const runtimeArchivePath = path.join(runtimeBundleRoot, "python-runtime.zip");
const bundledModelRoot = path.join(runtimeBundleRoot, "seed-model");
const bundledModelReferencePath = path.join(bundledModelRoot, "model-reference.json");
const bundledModelSuiteReferencePath = path.join(bundledModelRoot, "model-suite-reference.json");
const repoPythonSourceDir = path.resolve(frontendRoot, "..", "src");
const preferredOperatingModelsManifestPath = path.resolve(frontendRoot, "..", "src", "kera_research", "preferred_operating_models.json");
const devCargoTargetDir = path.join(os.tmpdir(), "kera-tauri-dev", "target");
const tauriConfigPath = path.join(srcTauriDir, "tauri.conf.json");
const generatedConfigPath = path.join(srcTauriDir, "tauri.build.generated.conf.json");
const wixNoticeGeneratorPath = path.join(srcTauriDir, "wix", "generate_notice_bitmaps.py");
const hasUpdaterSigningKey = Boolean(String(env.TAURI_SIGNING_PRIVATE_KEY ?? "").trim());
const buildVariant = String(env.KERA_DESKTOP_BUILD_VARIANT ?? "cpu").trim().toLowerCase() || "cpu";
const uvCommand = env.UV_BIN || (process.platform === "win32" ? "uv.exe" : "uv");
let bundledModelPrepared = false;

function candidateBundledModelDbPaths() {
  const candidates = [
    path.resolve(frontendRoot, "..", "..", "KERA_DATA", "kera.db"),
    path.resolve(frontendRoot, "..", "KERA_DATA", "kera.db"),
    path.join(os.homedir(), "KERA_DATA", "kera.db"),
    path.join(os.homedir(), "KERA", "KERA_DATA", "kera.db"),
  ];
  for (const envName of ["OneDrive", "OneDriveCommercial", "OneDriveConsumer"]) {
    const root = String(env[envName] ?? "").trim();
    if (!root) {
      continue;
    }
    candidates.push(path.join(root, "KERA_DATA", "kera.db"));
    candidates.push(path.join(root, "KERA", "KERA_DATA", "kera.db"));
  }
  return [...new Set(candidates.map((entry) => path.normalize(entry)))];
}

function resolveBundledModelDbPath() {
  const configured = resolveMaybePath(env.KERA_DESKTOP_BUNDLED_MODEL_DB_PATH);
  if (configured) {
    return configured;
  }
  return candidateBundledModelDbPaths().find((candidate) => fs.existsSync(candidate)) ?? "";
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

function stopRunningReleaseArtifacts() {
  if (process.platform !== "win32") {
    return;
  }
  const prefixes = [releaseDir, runtimeCacheDir, devCargoTargetDir]
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

function normalizeBooleanEnv(value, fallback = false) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function resolveMaybePath(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "";
  }
  return path.isAbsolute(normalized) ? path.normalize(normalized) : path.resolve(frontendRoot, normalized);
}

function safeJsonParse(raw, fallback = {}) {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function sha256File(filePath) {
  const hash = createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead <= 0) {
        break;
      }
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function bundledModelReferenceFromEnv() {
  const modelPath = resolveMaybePath(env.KERA_DESKTOP_BUNDLED_MODEL_PATH);
  if (!modelPath || !fs.existsSync(modelPath)) {
    return null;
  }
  const filename = path.basename(modelPath);
  const parsedName = path.parse(filename).name;
  return {
    version_id: String(env.KERA_DESKTOP_BUNDLED_MODEL_VERSION_ID ?? "").trim() || `model_bundled_${parsedName}`,
    version_name: String(env.KERA_DESKTOP_BUNDLED_MODEL_VERSION_NAME ?? "").trim() || parsedName,
    architecture: String(env.KERA_DESKTOP_BUNDLED_MODEL_ARCHITECTURE ?? "").trim() || "densenet121",
    model_name: String(env.KERA_DESKTOP_BUNDLED_MODEL_NAME ?? "").trim() || "keratitis_cls",
    model_path: modelPath,
    requires_medsam_crop: normalizeBooleanEnv(env.KERA_DESKTOP_BUNDLED_MODEL_REQUIRES_MEDSAM_CROP, false),
    crop_mode: String(env.KERA_DESKTOP_BUNDLED_MODEL_CROP_MODE ?? "").trim() || undefined,
    case_aggregation: String(env.KERA_DESKTOP_BUNDLED_MODEL_CASE_AGGREGATION ?? "").trim() || undefined,
    bag_level: normalizeBooleanEnv(env.KERA_DESKTOP_BUNDLED_MODEL_BAG_LEVEL, false),
    training_input_policy: String(env.KERA_DESKTOP_BUNDLED_MODEL_INPUT_POLICY ?? "").trim() || undefined,
    decision_threshold: Number(env.KERA_DESKTOP_BUNDLED_MODEL_DECISION_THRESHOLD ?? 0.5),
    created_at: new Date().toISOString(),
    notes: String(env.KERA_DESKTOP_BUNDLED_MODEL_NOTES ?? "").trim() || "Bundled desktop model seed.",
  };
}

function bundledModelSuiteFromPreferredManifest() {
  if (!fs.existsSync(preferredOperatingModelsManifestPath)) {
    return null;
  }
  const manifest = safeJsonParse(fs.readFileSync(preferredOperatingModelsManifestPath, "utf8"), {});
  const rawModels = Array.isArray(manifest.models) ? manifest.models : [];
  const suite = [];
  for (const rawModel of rawModels) {
    if (!rawModel || typeof rawModel !== "object") {
      continue;
    }
    const relativeModelPath = String(rawModel.relative_model_path ?? "").trim();
    if (!relativeModelPath) {
      continue;
    }
    const modelPath = path.resolve(frontendRoot, "..", relativeModelPath);
    if (!fs.existsSync(modelPath)) {
      continue;
    }

    let resultPayload = {};
    const relativeResultPath = String(rawModel.relative_result_path ?? "").trim();
    if (relativeResultPath) {
      const resultPath = path.resolve(frontendRoot, "..", relativeResultPath);
      if (fs.existsSync(resultPath)) {
        resultPayload = safeJsonParse(fs.readFileSync(resultPath, "utf8"), {});
      }
    }
    const resultRecord = resultPayload && typeof resultPayload.result === "object" ? resultPayload.result : {};
    const patientSplit = resultRecord && typeof resultRecord.patient_split === "object" ? resultRecord.patient_split : {};
    suite.push({
      version_id: String(rawModel.version_id ?? "").trim(),
      version_name: String(rawModel.version_name ?? "").trim(),
      architecture: String(rawModel.architecture ?? "").trim(),
      model_name: "keratitis_cls",
      model_path: modelPath,
      requires_medsam_crop: Boolean(rawModel.requires_medsam_crop ?? false),
      crop_mode: String(rawModel.crop_mode ?? "").trim() || undefined,
      case_aggregation: String(rawModel.case_aggregation ?? "").trim() || undefined,
      bag_level: Boolean(rawModel.bag_level ?? false),
      training_input_policy: String(rawModel.training_input_policy ?? "").trim() || undefined,
      decision_threshold: Number(resultRecord.decision_threshold ?? 0.5),
      threshold_selection_metric: String(resultRecord.threshold_selection_metric ?? "").trim() || undefined,
      threshold_selection_metrics:
        resultRecord.threshold_selection_metrics && typeof resultRecord.threshold_selection_metrics === "object"
          ? resultRecord.threshold_selection_metrics
          : undefined,
      created_at:
        String(resultRecord.created_at ?? "").trim() ||
        String(patientSplit.updated_at ?? "").trim() ||
        String(patientSplit.created_at ?? "").trim() ||
        new Date(fs.statSync(modelPath).mtimeMs).toISOString(),
      notes: String(rawModel.notes ?? "").trim() || "Bundled preferred operating model.",
      notes_ko: String(rawModel.notes_ko ?? rawModel.notes ?? "").trim() || "Bundled preferred operating model.",
      notes_en: String(rawModel.notes_en ?? rawModel.notes ?? "").trim() || "Bundled preferred operating model.",
      stage: "global",
      ready: true,
      is_current: Boolean(rawModel.is_current ?? false),
    });
  }
  if (!suite.length) {
    return null;
  }
  const currentCount = suite.filter((item) => item.is_current).length;
  if (currentCount === 0) {
    suite[0].is_current = true;
  } else if (currentCount > 1) {
    let foundCurrent = false;
    for (const item of suite) {
      if (item.is_current && !foundCurrent) {
        foundCurrent = true;
        continue;
      }
      item.is_current = false;
    }
  }
  return suite;
}

function bundledModelReferenceFromCurrentDb() {
  const dbPath = resolveBundledModelDbPath();
  if (!dbPath || !fs.existsSync(dbPath)) {
    return null;
  }

  let database;
  try {
    database = new DatabaseSync(dbPath, { open: true, readOnly: true });
    const rows = database
      .prepare(
        [
          "select version_id, version_name, architecture, stage, created_at, ready, is_current, payload_json",
          "from model_versions",
          "where stage = 'global' and ready = 1",
          "order by is_current desc, created_at desc",
          "limit 20",
        ].join(" "),
      )
      .all();
    for (const row of rows) {
      const payload = safeJsonParse(String(row.payload_json ?? "{}"), {});
      const modelPath = resolveMaybePath(payload.model_path);
      if (!modelPath || !fs.existsSync(modelPath)) {
        continue;
      }
      return {
        ...payload,
        version_id: String(payload.version_id ?? row.version_id ?? "").trim(),
        version_name: String(payload.version_name ?? row.version_name ?? "").trim(),
        architecture: String(payload.architecture ?? row.architecture ?? "").trim(),
        model_name: String(payload.model_name ?? "keratitis_cls").trim() || "keratitis_cls",
        model_path: modelPath,
        created_at: String(payload.created_at ?? row.created_at ?? new Date().toISOString()).trim() || new Date().toISOString(),
      };
    }
  } catch (error) {
    process.stdout.write(`[run-tauri-build] skipped bundled model auto-detect: ${error}\n`);
  } finally {
    database?.close();
  }
  return null;
}

function prepareBundledModelSeed() {
  fs.rmSync(bundledModelRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
  bundledModelPrepared = false;
  const modelSuite = bundledModelSuiteFromPreferredManifest();
  if (modelSuite && modelSuite.length > 0) {
    fs.mkdirSync(bundledModelRoot, { recursive: true });
    const normalizedSuite = [];
    for (const modelReference of modelSuite) {
      const sourceModelPath = resolveMaybePath(modelReference.model_path);
      if (!sourceModelPath || !fs.existsSync(sourceModelPath)) {
        process.stdout.write(
          `[run-tauri-build] preferred bundled model skipped because the source file was not found: ${sourceModelPath}\n`,
        );
        continue;
      }
      const filename = String(modelReference.filename ?? "").trim() || path.basename(sourceModelPath);
      const targetModelPath = path.join(bundledModelRoot, filename);
      fs.copyFileSync(sourceModelPath, targetModelPath);
      const sizeBytes =
        Number(modelReference.size_bytes ?? modelReference.sizeBytes ?? fs.statSync(sourceModelPath).size) || 0;
      const normalizedReference = {
        ...modelReference,
        filename,
        version_id: String(modelReference.version_id ?? "").trim() || `model_bundled_${path.parse(filename).name}`,
        version_name: String(modelReference.version_name ?? "").trim() || path.parse(filename).name,
        architecture: String(modelReference.architecture ?? "").trim() || "densenet121",
        model_name: String(modelReference.model_name ?? "keratitis_cls").trim() || "keratitis_cls",
        source_provider: "bundled",
        stage: "global",
        ready: true,
        is_current: Boolean(modelReference.is_current),
        size_bytes: sizeBytes,
        sha256: String(modelReference.sha256 ?? "").trim().toLowerCase() || sha256File(sourceModelPath),
        created_at: String(modelReference.created_at ?? new Date().toISOString()).trim() || new Date().toISOString(),
      };
      delete normalizedReference.model_path;
      delete normalizedReference.local_path;
      delete normalizedReference.download_url;
      normalizedSuite.push(normalizedReference);
    }
    if (normalizedSuite.length > 0) {
      const currentReference = normalizedSuite.find((item) => item.is_current) ?? normalizedSuite[0];
      fs.writeFileSync(
        bundledModelSuiteReferencePath,
        `${JSON.stringify({ version: 1, models: normalizedSuite }, null, 2)}\n`,
        "utf8",
      );
      fs.writeFileSync(bundledModelReferencePath, `${JSON.stringify(currentReference, null, 2)}\n`, "utf8");
      bundledModelPrepared = true;
      process.stdout.write(
        `[run-tauri-build] bundled preferred model suite prepared: ${normalizedSuite
          .map((item) => item.version_id)
          .join(", ")}\n`,
      );
      return;
    }
  }

  const modelReference = bundledModelReferenceFromEnv() ?? bundledModelReferenceFromCurrentDb();
  if (!modelReference) {
    process.stdout.write("[run-tauri-build] no bundled model seed was configured or auto-detected.\n");
    return;
  }

  const sourceModelPath = resolveMaybePath(modelReference.model_path);
  if (!sourceModelPath || !fs.existsSync(sourceModelPath)) {
    process.stdout.write(`[run-tauri-build] bundled model seed skipped because the source file was not found: ${sourceModelPath}\n`);
    return;
  }

  const filename = String(modelReference.filename ?? "").trim() || path.basename(sourceModelPath);
  const targetModelPath = path.join(bundledModelRoot, filename);
  fs.mkdirSync(bundledModelRoot, { recursive: true });
  fs.copyFileSync(sourceModelPath, targetModelPath);

  const sizeBytes = Number(modelReference.size_bytes ?? modelReference.sizeBytes ?? fs.statSync(sourceModelPath).size) || 0;
  const normalizedReference = {
    ...modelReference,
    filename,
    version_id: String(modelReference.version_id ?? "").trim() || `model_bundled_${path.parse(filename).name}`,
    version_name: String(modelReference.version_name ?? "").trim() || path.parse(filename).name,
    architecture: String(modelReference.architecture ?? "").trim() || "densenet121",
    model_name: String(modelReference.model_name ?? "keratitis_cls").trim() || "keratitis_cls",
    source_provider: "bundled",
    stage: "global",
    ready: true,
    is_current: true,
    size_bytes: sizeBytes,
    sha256: String(modelReference.sha256 ?? "").trim().toLowerCase() || sha256File(sourceModelPath),
    created_at: String(modelReference.created_at ?? new Date().toISOString()).trim() || new Date().toISOString(),
  };
  delete normalizedReference.model_path;
  delete normalizedReference.local_path;
  delete normalizedReference.download_url;

  fs.writeFileSync(bundledModelReferencePath, `${JSON.stringify(normalizedReference, null, 2)}\n`, "utf8");
  bundledModelPrepared = true;
  process.stdout.write(
    `[run-tauri-build] bundled model seed prepared: ${normalizedReference.version_id} (${filename}, ${sizeBytes} bytes)\n`,
  );
}

function prepareBuildConfig() {
  if (!fs.existsSync(runtimeCacheDir)) {
    throw new Error(`Desktop runtime cache was not found: ${runtimeCacheDir}`);
  }
  if (!fs.existsSync(runtimeArchivePath)) {
    throw new Error(`Desktop runtime archive was not found: ${runtimeArchivePath}`);
  }
  const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, "utf8"));
  const configuredTargets = Array.isArray(tauriConfig.bundle?.targets) ? tauriConfig.bundle.targets : [];
  const resolvedTargets = buildVariant === "gpu" ? ["msi"] : configuredTargets;
  const generatedConfig = {
    ...tauriConfig,
    build: {
      ...(tauriConfig.build ?? {}),
      beforeBuildCommand: 'node -e "process.exit(0)"',
    },
    bundle: {
      ...(tauriConfig.bundle ?? {}),
      targets: resolvedTargets,
      createUpdaterArtifacts: hasUpdaterSigningKey
        ? tauriConfig.bundle?.createUpdaterArtifacts ?? false
        : false,
      resources: {
        ...(tauriConfig.bundle?.resources ?? {}),
        "../.desktop-runtime-bundle/python-runtime.zip": "python-runtime.zip",
        ...(bundledModelPrepared ? { "../.desktop-runtime-bundle/seed-model": "seed-model" } : {}),
      },
    },
  };
  if (!hasUpdaterSigningKey && tauriConfig.bundle?.createUpdaterArtifacts) {
    process.stdout.write(
      "[run-tauri-build] TAURI_SIGNING_PRIVATE_KEY is not set; updater artifacts will be skipped for this local package build.\n",
    );
  }
  if (buildVariant === "gpu") {
    process.stdout.write("[run-tauri-build] GPU package build selected; restricting bundle targets to MSI.\n");
  }
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
removePythonBytecodeCaches(repoPythonSourceDir);
cleanupBuildArtifacts();
runChecked(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "desktop:bundle"]);
runChecked(uvCommand, ["run", "python", path.relative(frontendRoot, wixNoticeGeneratorPath)]);
removePythonBytecodeCaches(runtimeCacheDir);
prepareBundledModelSeed();
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
