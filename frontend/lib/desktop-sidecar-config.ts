"use client";

import { hasDesktopRuntime, invokeDesktop } from "./desktop-ipc";

export type DesktopMlTransport = "http" | "sidecar";
export type DesktopBackendMode = "managed" | "external";

export type DesktopMlBackendStatus = {
  transport: DesktopMlTransport;
  mode: DesktopBackendMode;
  base_url: string;
  local_url: boolean;
  managed: boolean;
  running: boolean;
  healthy: boolean;
  launched_by_desktop: boolean;
  pid?: number | null;
  python_path?: string | null;
  python_preflight?: {
    candidate_path: string;
    candidate_source: string;
    interpreter_path: string;
    python_version?: string | null;
    torch_version?: string | null;
    cuda_available?: boolean | null;
    gpu_name?: string | null;
  } | null;
  launch_command?: string[] | null;
  stdout_log_path?: string | null;
  stderr_log_path?: string | null;
  last_started_at?: string | null;
  last_error?: string | null;
};

const warnedSidecarFallbacks = new Set<string>();

function readConfiguredDesktopTransport() {
  return process.env.NEXT_PUBLIC_KERA_DESKTOP_ML_TRANSPORT?.trim().toLowerCase();
}

export function resolveDesktopMlTransport(): DesktopMlTransport {
  if (!hasDesktopRuntime()) {
    return "http";
  }
  return readConfiguredDesktopTransport() === "http" ? "http" : "sidecar";
}

function webRuntimeStatus(): DesktopMlBackendStatus {
  return {
    transport: "http",
    mode: "external",
    base_url: process.env.NEXT_PUBLIC_LOCAL_NODE_API_BASE_URL?.trim() || process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "",
    local_url: false,
    managed: false,
    running: false,
    healthy: false,
    launched_by_desktop: false,
    pid: null,
    python_path: null,
    launch_command: null,
    stdout_log_path: null,
    stderr_log_path: null,
    last_started_at: null,
    last_error: null,
  };
}

export async function fetchDesktopMlBackendStatus(signal?: AbortSignal) {
  if (!hasDesktopRuntime()) {
    return webRuntimeStatus();
  }
  return invokeDesktop<DesktopMlBackendStatus>(
    resolveDesktopMlTransport() === "sidecar" ? "get_ml_sidecar_status" : "get_local_backend_status",
    {},
    signal,
  );
}

export async function ensureDesktopMlBackendReady(signal?: AbortSignal) {
  if (!hasDesktopRuntime()) {
    return webRuntimeStatus();
  }
  return invokeDesktop<DesktopMlBackendStatus>(
    resolveDesktopMlTransport() === "sidecar" ? "ensure_ml_sidecar" : "ensure_local_backend",
    {},
    signal,
  );
}

export async function stopDesktopMlBackend(signal?: AbortSignal) {
  if (!hasDesktopRuntime()) {
    return webRuntimeStatus();
  }
  return invokeDesktop<DesktopMlBackendStatus>(
    resolveDesktopMlTransport() === "sidecar" ? "stop_ml_sidecar" : "stop_local_backend",
    {},
    signal,
  );
}

export function warnDesktopMlFallback(operation: string) {
  if (!hasDesktopRuntime() || resolveDesktopMlTransport() !== "sidecar") {
    return;
  }
  if (warnedSidecarFallbacks.has(operation)) {
    return;
  }
  warnedSidecarFallbacks.add(operation);
  if (typeof console !== "undefined") {
    console.warn(
      `[K-ERA desktop] Falling back away from the desktop-managed ML sidecar for "${operation}".`,
    );
  }
}

export function describeDesktopMlRuntime() {
  return {
    runtime: hasDesktopRuntime() ? "desktop" : "web",
    transport: resolveDesktopMlTransport(),
  } as const;
}
