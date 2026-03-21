"use client";

import { invokeDesktop, hasDesktopRuntime } from "./desktop-ipc";
import {
  ensureDesktopMlBackendReady,
  fetchDesktopMlBackendStatus,
  stopDesktopMlBackend,
  type DesktopMlBackendStatus,
} from "./desktop-sidecar-config";
import { requestDesktopLocalApiJson } from "./desktop-local-api";

export type DesktopManagedProcessStatus = {
  transport: string;
  mode: string;
  base_url: string;
  local_url: boolean;
  managed: boolean;
  running: boolean;
  healthy: boolean;
  launched_by_desktop: boolean;
  pid?: number | null;
  python_path?: string | null;
  launch_command?: string[] | null;
  stdout_log_path?: string | null;
  stderr_log_path?: string | null;
  last_started_at?: string | null;
  last_error?: string | null;
};

export type DesktopNodeStatus = {
  control_plane?: {
    configured?: boolean;
    node_sync_enabled?: boolean;
    base_url?: string | null;
    node_id?: string | null;
  } | null;
  credentials?: Record<string, unknown> | null;
  stored_credentials_present?: boolean;
  database_topology?: {
    control_plane_split_enabled?: boolean;
    control_plane_connection_mode?: string | null;
    control_plane_backend?: string | null;
    data_plane_backend?: string | null;
    data_plane_local_sqlite?: boolean;
    legacy_database_env_present?: boolean;
    legacy_database_env_names?: string[] | null;
    split_database_env_names?: string[] | null;
  } | null;
  bootstrap?: Record<string, unknown> | null;
  current_release?: Record<string, unknown> | null;
};

export type DesktopDiagnosticsSnapshot = {
  runtime: "desktop" | "web";
  localBackend: DesktopManagedProcessStatus | null;
  mlBackend: DesktopMlBackendStatus | null;
  nodeStatus: DesktopNodeStatus | null;
  nodeStatusError: string | null;
};

function webSnapshot(): DesktopDiagnosticsSnapshot {
  return {
    runtime: "web",
    localBackend: null,
    mlBackend: null,
    nodeStatus: null,
    nodeStatusError: null,
  };
}

export async function fetchDesktopLocalBackendStatus(signal?: AbortSignal) {
  if (!hasDesktopRuntime()) {
    return null;
  }
  return invokeDesktop<DesktopManagedProcessStatus>("get_local_backend_status", {}, signal);
}

export async function ensureDesktopLocalBackendReady(signal?: AbortSignal) {
  if (!hasDesktopRuntime()) {
    return null;
  }
  return invokeDesktop<DesktopManagedProcessStatus>("ensure_local_backend", {}, signal);
}

export async function stopDesktopLocalBackend(signal?: AbortSignal) {
  if (!hasDesktopRuntime()) {
    return null;
  }
  return invokeDesktop<DesktopManagedProcessStatus>("stop_local_backend", {}, signal);
}

export async function fetchDesktopNodeStatus(signal?: AbortSignal) {
  if (!hasDesktopRuntime()) {
    return null;
  }
  return requestDesktopLocalApiJson<DesktopNodeStatus>("/api/control-plane/node/status", "", {
    signal,
  });
}

export async function fetchDesktopDiagnosticsSnapshot(signal?: AbortSignal): Promise<DesktopDiagnosticsSnapshot> {
  if (!hasDesktopRuntime()) {
    return webSnapshot();
  }

  const [localBackendResult, mlBackendResult, nodeStatusResult] = await Promise.allSettled([
    fetchDesktopLocalBackendStatus(signal),
    fetchDesktopMlBackendStatus(signal),
    fetchDesktopNodeStatus(signal),
  ]);

  return {
    runtime: "desktop",
    localBackend: localBackendResult.status === "fulfilled" ? localBackendResult.value : null,
    mlBackend: mlBackendResult.status === "fulfilled" ? mlBackendResult.value : null,
    nodeStatus: nodeStatusResult.status === "fulfilled" ? nodeStatusResult.value : null,
    nodeStatusError:
      nodeStatusResult.status === "rejected"
        ? nodeStatusResult.reason instanceof Error
          ? nodeStatusResult.reason.message
          : String(nodeStatusResult.reason)
        : null,
  };
}

export async function ensureDesktopDiagnosticsBackends(signal?: AbortSignal) {
  if (!hasDesktopRuntime()) {
    return webSnapshot();
  }
  await Promise.allSettled([
    ensureDesktopLocalBackendReady(signal),
    ensureDesktopMlBackendReady(signal),
  ]);
  return fetchDesktopDiagnosticsSnapshot(signal);
}

export async function stopDesktopDiagnosticsBackends(signal?: AbortSignal) {
  if (!hasDesktopRuntime()) {
    return webSnapshot();
  }
  await Promise.allSettled([
    stopDesktopLocalBackend(signal),
    stopDesktopMlBackend(signal),
  ]);
  return fetchDesktopDiagnosticsSnapshot(signal);
}
