import { createHash, randomBytes, randomUUID } from "node:crypto";

export function makeControlPlaneId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

export function makeNodeToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashNodeToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeSiteId(value: string, fallbackPrefix = "site"): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || `${fallbackPrefix}_${randomUUID().slice(0, 8)}`;
}
