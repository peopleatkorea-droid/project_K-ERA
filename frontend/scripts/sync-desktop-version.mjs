import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const frontendRoot = process.cwd();
const repoRoot = path.resolve(frontendRoot, "..");
const pyprojectPath = path.join(repoRoot, "pyproject.toml");
const packageJsonPath = path.join(frontendRoot, "package.json");
const packageLockPath = path.join(frontendRoot, "package-lock.json");
const tauriConfigPath = path.join(frontendRoot, "src-tauri", "tauri.conf.json");
const cargoTomlPath = path.join(frontendRoot, "src-tauri", "Cargo.toml");

function readText(targetPath) {
  return fs.readFileSync(targetPath, "utf8");
}

function writeTextIfChanged(targetPath, nextValue, changedFiles) {
  const previousValue = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, "utf8") : "";
  if (previousValue === nextValue) {
    return;
  }
  fs.writeFileSync(targetPath, nextValue, "utf8");
  changedFiles.push(path.relative(frontendRoot, targetPath));
}

function extractTomlVersion(raw, label) {
  const match = raw.match(/^\s*version\s*=\s*"([^"]+)"/m);
  if (!match) {
    throw new Error(`Unable to find version in ${label}.`);
  }
  return match[1].trim();
}

function replaceTomlVersion(raw, nextVersion, label) {
  if (!/^\s*version\s*=\s*"([^"]+)"/m.test(raw)) {
    throw new Error(`Unable to replace version in ${label}.`);
  }
  return raw.replace(/^\s*version\s*=\s*"([^"]+)"/m, `version = "${nextVersion}"`);
}

function main() {
  const changedFiles = [];
  const sourceVersion = extractTomlVersion(readText(pyprojectPath), "pyproject.toml");

  const packageJson = JSON.parse(readText(packageJsonPath));
  packageJson.version = sourceVersion;
  writeTextIfChanged(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, changedFiles);

  const packageLock = JSON.parse(readText(packageLockPath));
  packageLock.version = sourceVersion;
  if (packageLock.packages && packageLock.packages[""]) {
    packageLock.packages[""].version = sourceVersion;
  }
  writeTextIfChanged(packageLockPath, `${JSON.stringify(packageLock, null, 2)}\n`, changedFiles);

  const tauriConfig = JSON.parse(readText(tauriConfigPath));
  tauriConfig.version = sourceVersion;
  writeTextIfChanged(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`, changedFiles);

  const cargoToml = replaceTomlVersion(readText(cargoTomlPath), sourceVersion, "Cargo.toml");
  writeTextIfChanged(cargoTomlPath, cargoToml, changedFiles);

  if (changedFiles.length > 0) {
    console.log(
      `[sync-desktop-version] aligned version ${sourceVersion} across ${changedFiles.join(", ")}`,
    );
    return;
  }
  console.log(`[sync-desktop-version] version ${sourceVersion} already aligned`);
}

main();
