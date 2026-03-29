"use client";

type MainAppTokenPayload = {
  sub?: unknown;
  role?: unknown;
  exp?: unknown;
};

function decodeBase64Url(segment: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    return window.atob(padded);
  } catch {
    return null;
  }
}

function readTokenPayload(token: string): MainAppTokenPayload | null {
  const parts = String(token ?? "").split(".");
  if (parts.length < 2) {
    return null;
  }
  const payloadText = decodeBase64Url(parts[1]);
  if (!payloadText) {
    return null;
  }
  try {
    return JSON.parse(payloadText) as MainAppTokenPayload;
  } catch {
    return null;
  }
}

export function readUserIdFromToken(token: string): string | null {
  const payload = readTokenPayload(token);
  return typeof payload?.sub === "string" && payload.sub.trim() ? payload.sub.trim() : null;
}

export function readUserRoleFromToken(token: string): string | null {
  const payload = readTokenPayload(token);
  return typeof payload?.role === "string" && payload.role.trim() ? payload.role.trim() : null;
}

export function readTokenExpiresAt(token: string): number | null {
  const payload = readTokenPayload(token);
  const exp = payload?.exp;
  const numericExp =
    typeof exp === "number" ? exp : typeof exp === "string" && exp.trim() ? Number(exp.trim()) : Number.NaN;
  if (!Number.isFinite(numericExp) || numericExp <= 0) {
    return null;
  }
  return numericExp * 1000;
}

export function isTokenExpired(token: string, options?: { now?: number; clockSkewMs?: number }): boolean {
  const expiresAt = readTokenExpiresAt(token);
  if (expiresAt === null) {
    return false;
  }
  const now = options?.now ?? Date.now();
  const clockSkewMs = options?.clockSkewMs ?? 30_000;
  return now >= expiresAt - clockSkewMs;
}
