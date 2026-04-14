import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const frontendRoot = process.cwd();
const bundleRoot = path.join(frontendRoot, "src-tauri", "target", "release", "bundle");
const args = process.argv.slice(2);

function parseBundleType() {
  const typeFlagIndex = args.findIndex((arg) => arg === "--type");
  if (typeFlagIndex >= 0) {
    const next = String(args[typeFlagIndex + 1] ?? "").trim().toLowerCase();
    if (["any", "nsis", "msi"].includes(next)) {
      return next;
    }
    throw new Error(`Unsupported bundle type '${next || "<missing>"}'. Expected one of: any, nsis, msi.`);
  }
  return "any";
}

async function existingFiles(dirPath, extensions) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(dirPath, entry.name))
      .filter((filePath) => extensions.includes(path.extname(filePath).toLowerCase()));
  } catch {
    return [];
  }
}

async function main() {
  const bundleType = parseBundleType();
  const nsisFiles = await existingFiles(path.join(bundleRoot, "nsis"), [".exe"]);
  const msiFiles = await existingFiles(path.join(bundleRoot, "msi"), [".msi"]);

  const packageFiles =
    bundleType === "nsis"
      ? nsisFiles
      : bundleType === "msi"
        ? msiFiles
        : [...nsisFiles, ...msiFiles];
  if (packageFiles.length === 0) {
    console.error(
      bundleType === "any"
        ? "No packaged installer artifacts were found under src-tauri/target/release/bundle."
        : `No packaged ${bundleType.toUpperCase()} installer artifacts were found under src-tauri/target/release/bundle.`,
    );
    process.exit(1);
  }

  for (const filePath of packageFiles) {
    const stat = await fs.stat(filePath);
    console.log(`OK   packaged artifact: ${filePath} (${stat.size} bytes)`);
  }

  console.log(
    `packaged ${bundleType === "any" ? "installer" : bundleType.toUpperCase()} verification passed (${packageFiles.length} artifact${packageFiles.length === 1 ? "" : "s"})`,
  );
}

await main();
