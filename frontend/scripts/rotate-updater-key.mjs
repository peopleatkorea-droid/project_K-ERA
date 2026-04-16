import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function localAppDataDir() {
  const explicit = process.env.LOCALAPPDATA?.trim();
  if (explicit) {
    return explicit;
  }
  const userProfile = process.env.USERPROFILE?.trim();
  if (userProfile) {
    return join(userProfile, "AppData", "Local");
  }
  throw new Error("LOCALAPPDATA is not available.");
}

const privateKeyPath = join(localAppDataDir(), "KERA", "release-signing", "kera-updater.key");
mkdirSync(dirname(privateKeyPath), { recursive: true });

const tauriCliPath = require.resolve("@tauri-apps/cli/tauri.js");

const result = spawnSync(
  process.execPath,
  [tauriCliPath, "signer", "generate", "--ci", "--force", "--write-keys", privateKeyPath],
  {
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env,
  },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const publicKeyPath = `${privateKeyPath}.pub`;
const publicKey = readFileSync(publicKeyPath, "utf8").trim();

console.log("");
console.log("Updater key rotation complete.");
console.log(`Private key path: ${privateKeyPath}`);
console.log(`Public key path: ${publicKeyPath}`);
console.log("");
console.log("Next steps:");
console.log(`1. Set TAURI_SIGNING_PRIVATE_KEY in GitHub Actions secrets from: ${privateKeyPath}`);
console.log("2. Update frontend/src-tauri/tauri.conf.json plugins.updater.pubkey with:");
console.log(publicKey);
console.log("3. Redeploy the next tagged desktop release so latest.json is signed with the rotated key.");
