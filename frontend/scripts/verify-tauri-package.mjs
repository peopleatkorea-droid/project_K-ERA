import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const frontendRoot = process.cwd();
const bundleRoot = path.join(frontendRoot, "src-tauri", "target", "release", "bundle");

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
  const nsisFiles = await existingFiles(path.join(bundleRoot, "nsis"), [".exe"]);
  const msiFiles = await existingFiles(path.join(bundleRoot, "msi"), [".msi"]);

  const packageFiles = [...nsisFiles, ...msiFiles];
  if (packageFiles.length === 0) {
    console.error("No packaged installer artifacts were found under src-tauri/target/release/bundle.");
    process.exit(1);
  }

  for (const filePath of packageFiles) {
    const stat = await fs.stat(filePath);
    console.log(`OK   packaged artifact: ${filePath} (${stat.size} bytes)`);
  }

  console.log(`packaged installer verification passed (${packageFiles.length} artifact${packageFiles.length === 1 ? "" : "s"})`);
}

await main();
