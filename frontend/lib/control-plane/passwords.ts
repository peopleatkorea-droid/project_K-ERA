import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

const PASSWORD_SCHEME = "pbkdf2_sha256";
const PASSWORD_ITERATIONS = 210_000;
const PASSWORD_KEY_LENGTH = 32;

function encodeHash(password: string, salt: string, iterations: number): string {
  return pbkdf2Sync(password, salt, iterations, PASSWORD_KEY_LENGTH, "sha256").toString("base64url");
}

export function hashControlPlanePassword(password: string): string {
  const normalized = String(password || "").trim();
  if (!normalized) {
    throw new Error("Password is required.");
  }
  const salt = randomBytes(16).toString("base64url");
  const digest = encodeHash(normalized, salt, PASSWORD_ITERATIONS);
  return `${PASSWORD_SCHEME}$${PASSWORD_ITERATIONS}$${salt}$${digest}`;
}

export function verifyControlPlanePassword(password: string, storedHash: string): boolean {
  const normalizedPassword = String(password || "");
  const normalizedStored = String(storedHash || "").trim();
  if (!normalizedPassword || !normalizedStored) {
    return false;
  }
  if (normalizedStored.startsWith("$2")) {
    throw new Error("Legacy local password hashes are not supported here. Use Google sign-in or reset the password in the control plane.");
  }
  const [scheme, iterationsText, salt, expectedDigest] = normalizedStored.split("$");
  if (scheme === PASSWORD_SCHEME && iterationsText && salt && expectedDigest) {
    const iterations = Number(iterationsText);
    if (!Number.isFinite(iterations) || iterations < 1) {
      return false;
    }
    const actualDigest = encodeHash(normalizedPassword, salt, iterations);
    return timingSafeEqual(Buffer.from(actualDigest), Buffer.from(expectedDigest));
  }
  return normalizedPassword === normalizedStored;
}
