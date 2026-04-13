import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const tauriRoot = path.join(repoRoot, "src-tauri");
const tauriConfigPath = path.join(tauriRoot, "tauri.conf.json");
const cargoTomlPath = path.join(tauriRoot, "Cargo.toml");
const packageJsonPath = path.join(repoRoot, "package.json");
const pyprojectTomlPath = path.resolve(repoRoot, "..", "pyproject.toml");

const checks = [];

function record(ok, label, detail) {
  checks.push({ ok, label, detail });
}

function verifyExists(label, targetPath) {
  const exists = fs.existsSync(targetPath);
  record(exists, label, targetPath);
  return exists;
}

async function verifyDesktopBundle() {
  const outDir = path.join(repoRoot, "desktop-dist");
  const htmlPath = path.join(outDir, "index.html");
  const cssPath = path.join(outDir, "assets", "desktop-shell.css");
  const jsPath = path.join(outDir, "assets", "desktop-shell.js");

  verifyExists("desktop-dist/index.html", htmlPath);
  verifyExists("desktop-shell.css", cssPath);
  verifyExists("desktop-shell.js", jsPath);

  if (!fs.existsSync(htmlPath)) {
    return;
  }

  const html = await fsp.readFile(htmlPath, "utf8");
  record(!html.includes("127.0.0.1:3000"), "desktop shell is not a localhost stub", htmlPath);
  record(html.includes("./assets/desktop-shell.css"), "desktop shell references packaged CSS", htmlPath);
  record(html.includes("./assets/desktop-shell.js"), "desktop shell references packaged JS", htmlPath);
}

async function verifyTauriResources() {
  const raw = await fsp.readFile(tauriConfigPath, "utf8");
  const config = JSON.parse(raw);
  const resources = config.bundle?.resources ?? {};

  for (const [source, destination] of Object.entries(resources)) {
    const sourcePath = path.resolve(tauriRoot, source);
    verifyExists(`bundle resource input -> ${destination}`, sourcePath);
  }
}

function extractTomlVersion(raw, label) {
  const match = raw.match(/^\s*version\s*=\s*"([^"]+)"/m);
  if (!match) {
    throw new Error(`Unable to find version in ${label}.`);
  }
  return match[1].trim();
}

async function verifyDesktopSecurityAndVersions() {
  const tauriConfig = JSON.parse(await fsp.readFile(tauriConfigPath, "utf8"));
  const packageJson = JSON.parse(await fsp.readFile(packageJsonPath, "utf8"));
  const cargoToml = await fsp.readFile(cargoTomlPath, "utf8");
  const pyprojectToml = await fsp.readFile(pyprojectTomlPath, "utf8");

  const tauriVersion = String(tauriConfig.version ?? "").trim();
  const tauriCsp = tauriConfig.app?.security?.csp;
  const cargoVersion = extractTomlVersion(cargoToml, "Cargo.toml");
  const packageVersion = String(packageJson.version ?? "").trim();
  const pyprojectVersion = extractTomlVersion(pyprojectToml, "pyproject.toml");

  record(Boolean(tauriCsp), "desktop CSP is configured", tauriConfigPath);
  record(
    tauriVersion.length > 0 &&
      tauriVersion === cargoVersion &&
      tauriVersion === packageVersion &&
      tauriVersion === pyprojectVersion,
    "desktop/web/python versions stay aligned",
    `tauri=${tauriVersion || "<missing>"}, cargo=${cargoVersion}, package=${packageVersion}, pyproject=${pyprojectVersion}`,
  );
}

async function main() {
  verifyExists("tauri.conf.json", tauriConfigPath);
  await verifyDesktopBundle();
  await verifyTauriResources();
  await verifyDesktopSecurityAndVersions();

  const failed = checks.filter((entry) => !entry.ok);
  for (const entry of checks) {
    const prefix = entry.ok ? "OK  " : "FAIL";
    console.log(`${prefix} ${entry.label}: ${entry.detail}`);
  }

  if (failed.length > 0) {
    console.error(`desktop runtime verification failed (${failed.length} check${failed.length === 1 ? "" : "s"})`);
    process.exit(1);
  }

  console.log(`desktop runtime verification passed (${checks.length} checks)`);
}

await main();
