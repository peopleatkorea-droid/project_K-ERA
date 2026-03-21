"use client";

type MainAppTokenPayload = {
  sub?: unknown;
  role?: unknown;
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
