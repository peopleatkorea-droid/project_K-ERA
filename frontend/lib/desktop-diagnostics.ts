"use client";

import { invokeDesktop, hasDesktopRuntime } from "./desktop-ipc";
import {
  fetchDesktopMlBackendStatus,
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

export type DesktopWorkerStatus = {
  mode: string;
  managed: boolean;
  running: boolean;
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
  localWorker: DesktopWorkerStatus | null;
  mlBackend: DesktopMlBackendStatus | null;
  nodeStatus: DesktopNodeStatus | null;
  nodeStatusError: string | null;
};

function webSnapshot(): DesktopDiagnosticsSnapshot {
  return {
    runtime: "web",
    localBackend: null,
    localWorker: null,
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

export async function fetchDesktopLocalWorkerStatus(signal?: AbortSignal) {
  if (!hasDesktopRuntime()) {
    return null;
  }
  return invokeDesktop<DesktopWorkerStatus>("get_local_worker_status", {}, signal);
}

export async function ensureDesktopLocalWorkerReady(signal?: AbortSignal) {
  if (!hasDesktopRuntime()) {
    return null;
  }
  return invokeDesktop<DesktopWorkerStatus>("ensure_local_worker", {}, signal);
}

export async function stopDesktopLocalWorker(signal?: AbortSignal) {
  if (!hasDesktopRuntime()) {
    return null;
  }
  return invokeDesktop<DesktopWorkerStatus>("stop_local_worker", {}, signal);
}

export async function ensureDesktopLocalRuntimeReady(signal?: AbortSignal) {
  if (!hasDesktopRuntime()) {
    return null;
  }
  return invokeDesktop<DesktopManagedProcessStatus>("ensure_local_runtime", {}, signal);
}

export async function ensureDesktopLocalBackendReady(signal?: AbortSignal) {
  return ensureDesktopLocalRuntimeReady(signal);
}

export async function stopDesktopLocalRuntime(signal?: AbortSignal) {
  if (!hasDesktopRuntime()) {
    return null;
  }
  return invokeDesktop<DesktopManagedProcessStatus>("stop_local_runtime", {}, signal);
}

export async function stopDesktopLocalBackend(signal?: AbortSignal) {
  return stopDesktopLocalRuntime(signal);
}

export async function fetchDesktopNodeStatus(signal?: AbortSignal) {
  if (!hasDesktopRuntime()) {
    return null;
  }
  return requestDesktopLocalApiJson<DesktopNodeStatus>("/api/control-plane/node/status", "", {
    signal,
  });
}

async function fetchDesktopRuntimeSnapshotInternal(signal?: AbortSignal): Promise<DesktopDiagnosticsSnapshot> {
  if (!hasDesktopRuntime()) {
    return webSnapshot();
  }

  const [localBackendResult, localWorkerResult, mlBackendResult] = await Promise.allSettled([
    fetchDesktopLocalBackendStatus(signal),
    fetchDesktopLocalWorkerStatus(signal),
    fetchDesktopMlBackendStatus(signal),
  ]);

  return {
    runtime: "desktop",
    localBackend: localBackendResult.status === "fulfilled" ? localBackendResult.value : null,
    localWorker: localWorkerResult.status === "fulfilled" ? localWorkerResult.value : null,
    mlBackend: mlBackendResult.status === "fulfilled" ? mlBackendResult.value : null,
    nodeStatus: null,
    nodeStatusError: null,
  };
}

export async function fetchDesktopRuntimeSnapshot(signal?: AbortSignal): Promise<DesktopDiagnosticsSnapshot> {
  return fetchDesktopRuntimeSnapshotInternal(signal);
}

export async function fetchDesktopDiagnosticsSnapshot(signal?: AbortSignal): Promise<DesktopDiagnosticsSnapshot> {
  if (!hasDesktopRuntime()) {
    return webSnapshot();
  }

  const [runtimeSnapshot, nodeStatusResult] = await Promise.all([
    fetchDesktopRuntimeSnapshotInternal(signal),
    Promise.allSettled([fetchDesktopNodeStatus(signal)]),
  ]);
  const nodeStatus = nodeStatusResult[0];

  return {
    ...runtimeSnapshot,
    nodeStatus: nodeStatus.status === "fulfilled" ? nodeStatus.value : null,
    nodeStatusError:
      nodeStatus.status === "rejected"
        ? nodeStatus.reason instanceof Error
          ? nodeStatus.reason.message
          : String(nodeStatus.reason)
        : null,
  };
}

export async function ensureDesktopDiagnosticsBackends(signal?: AbortSignal) {
  if (!hasDesktopRuntime()) {
    return webSnapshot();
  }
  await ensureDesktopLocalRuntimeReady(signal);
  return fetchDesktopDiagnosticsSnapshot(signal);
}

export async function stopDesktopDiagnosticsBackends(signal?: AbortSignal) {
  if (!hasDesktopRuntime()) {
    return webSnapshot();
  }
  await stopDesktopLocalRuntime(signal);
  return fetchDesktopDiagnosticsSnapshot(signal);
}
