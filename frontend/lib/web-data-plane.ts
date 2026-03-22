"use client";

import { buildApiUrl } from "./api-core";

const WEB_DATA_PLANE_TIMEOUT_MS = 4000;

export type WorkspaceDataPlaneState = "idle" | "checking" | "ready" | "unavailable";

export async function probeWebDataPlaneAvailability(): Promise<boolean> {
  if (typeof window === "undefined") {
    return true;
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, WEB_DATA_PLANE_TIMEOUT_MS);

  try {
    const response = await fetch(buildApiUrl("/api/health"), {
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeoutId);
  }
}
