"use client";

import type { DesktopAppConfigState } from "./desktop-app-config";
import type { DesktopDiagnosticsSnapshot } from "./desktop-diagnostics";
import { hasDesktopRuntime } from "./desktop-ipc";
import { requestDesktopLocalApiJson } from "./desktop-local-api";

type DesktopWriteProbe = {
  path: string;
  exists: boolean;
  writable: boolean;
  detail?: string | null;
};

type DesktopSqliteProbe = {
  path: string;
  exists: boolean;
  required: boolean;
  ready: boolean;
  detail?: string | null;
};

type DesktopControlPlaneProbe = {
  configured: boolean;
  node_sync_enabled: boolean;
  base_url?: string | null;
  node_id?: string | null;
  bootstrap?: Record<string, unknown> | null;
  ready: boolean;
  detail?: string | null;
};

type DesktopModelProbe = {
  model_dir: string;
  model_dir_exists: boolean;
  active_manifest_path: string;
  active_manifest_exists: boolean;
  active_manifest?: Record<string, unknown> | null;
  active_model_path?: string | null;
  active_model_exists: boolean;
  current_release?: Record<string, unknown> | null;
  resolved_model_path?: string | null;
  ready: boolean;
  downloadable: boolean;
  detail?: string | null;
};

type DesktopLocalSelfCheckResponse = {
  checked_at: string;
  storage: {
    storage_dir: DesktopWriteProbe;
    runtime_dir: DesktopWriteProbe;
  };
  data_plane_database: DesktopSqliteProbe;
  control_plane_cache_database: DesktopSqliteProbe;
  control_plane: DesktopControlPlaneProbe;
  model_artifacts: DesktopModelProbe;
};

type DesktopControlPlaneAuthStatus = {
  client_id_configured: boolean;
  client_secret_configured: boolean;
  configured: boolean;
};

export type DesktopSelfCheckItemStatus = "pass" | "warn" | "fail";

export type DesktopSelfCheckItem = {
  id:
    | "installation"
    | "localServices"
    | "storagePermissions"
    | "dataPlaneDatabase"
    | "controlPlaneCache"
    | "controlPlane"
    | "googleAuth"
    | "modelArtifacts";
  label: string;
  status: DesktopSelfCheckItemStatus;
  detail: string;
  path?: string | null;
  blocking: boolean;
};

export type DesktopSelfCheckSnapshot = {
  checkedAt: string;
  items: DesktopSelfCheckItem[];
  ready: boolean;
};

async function fetchLocalDesktopSelfCheck(signal?: AbortSignal): Promise<DesktopLocalSelfCheckResponse> {
  return requestDesktopLocalApiJson<DesktopLocalSelfCheckResponse>("/api/desktop/self-check", "", { signal });
}

async function fetchDesktopControlPlaneAuthStatus(
  baseUrl: string,
  signal?: AbortSignal,
): Promise<DesktopControlPlaneAuthStatus> {
  const normalized = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!normalized) {
    throw new Error("Hospital server URL is missing.");
  }
  const response = await fetch(`${normalized}/main/auth/desktop/status`, {
    method: "GET",
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new Error(`Desktop sign-in status request failed: ${response.status}`);
  }
  return (await response.json()) as DesktopControlPlaneAuthStatus;
}

function firstDetail(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

export async function runDesktopSelfCheck(
  config: DesktopAppConfigState | null,
  diagnostics: DesktopDiagnosticsSnapshot | null,
  signal?: AbortSignal,
): Promise<DesktopSelfCheckSnapshot | null> {
  if (!hasDesktopRuntime()) {
    return null;
  }

  const controlPlaneBaseUrl = config?.values.control_plane_api_base_url || "";
  const [localCheckResult, authStatusResult] = await Promise.allSettled([
    fetchLocalDesktopSelfCheck(signal),
    fetchDesktopControlPlaneAuthStatus(controlPlaneBaseUrl, signal),
  ]);

  const checkedAt = new Date().toISOString();
  const items: DesktopSelfCheckItem[] = [];
  const runtimeErrors = config?.runtime_contract.errors ?? [];
  items.push({
    id: "installation",
    label: "Installation files",
    status: runtimeErrors.length ? "fail" : "pass",
    detail: runtimeErrors.length ? runtimeErrors.join(" ") : "Bundled runtime files are available.",
    blocking: true,
  });

  const workerRequired = (config?.values.local_backend_mode ?? "managed") !== "external";
  const mlRequired = (config?.values.ml_transport ?? "sidecar") === "sidecar";
  const backendHealthy = diagnostics?.localBackend?.healthy === true;
  const workerReady = !workerRequired || diagnostics?.localWorker?.running === true;
  const mlReady = !mlRequired || diagnostics?.mlBackend?.healthy === true;
  const localServicesReady = backendHealthy && workerReady && mlReady;
  items.push({
    id: "localServices",
    label: "Local services",
    status: localServicesReady ? "pass" : "fail",
    detail: localServicesReady
      ? "Local backend, worker, and ML sidecar are ready."
      : firstDetail(
          diagnostics?.localBackend?.last_error,
          diagnostics?.localWorker?.last_error,
          diagnostics?.mlBackend?.last_error,
          "One or more local services are not ready.",
        ),
    blocking: true,
  });

  if (localCheckResult.status === "fulfilled") {
    const localCheck = localCheckResult.value;
    const storageWritable =
      localCheck.storage.storage_dir.writable && localCheck.storage.runtime_dir.writable;
    items.push({
      id: "storagePermissions",
      label: "Storage permissions",
      status: storageWritable ? "pass" : "fail",
      detail: storageWritable
        ? "Desktop storage and runtime folders are writable."
        : firstDetail(
            localCheck.storage.storage_dir.detail,
            localCheck.storage.runtime_dir.detail,
            "Desktop storage folders are not writable.",
          ),
      path: !storageWritable
        ? localCheck.storage.storage_dir.path || localCheck.storage.runtime_dir.path
        : localCheck.storage.storage_dir.path,
      blocking: true,
    });
    items.push({
      id: "dataPlaneDatabase",
      label: "Local patient database",
      status: localCheck.data_plane_database.ready ? "pass" : "fail",
      detail: localCheck.data_plane_database.ready
        ? "The local data-plane database is writable."
        : firstDetail(localCheck.data_plane_database.detail, "The local data-plane database is unavailable."),
      path: localCheck.data_plane_database.path,
      blocking: true,
    });

    const controlPlaneCacheRequired = localCheck.control_plane_cache_database.required;
    let controlPlaneCacheStatus: DesktopSelfCheckItemStatus = "pass";
    let controlPlaneCacheDetail = "The control-plane cache database is ready.";
    if (!localCheck.control_plane_cache_database.ready && controlPlaneCacheRequired) {
      controlPlaneCacheStatus = "fail";
      controlPlaneCacheDetail = firstDetail(
        localCheck.control_plane_cache_database.detail,
        "The control-plane cache database is unavailable.",
      );
    } else if (!localCheck.control_plane_cache_database.ready) {
      controlPlaneCacheStatus = "warn";
      controlPlaneCacheDetail = firstDetail(
        localCheck.control_plane_cache_database.detail,
        "A local control-plane cache database is not configured for this node.",
      );
    }
    items.push({
      id: "controlPlaneCache",
      label: "Control-plane cache",
      status: controlPlaneCacheStatus,
      detail: controlPlaneCacheDetail,
      path: localCheck.control_plane_cache_database.path,
      blocking: controlPlaneCacheRequired,
    });

    let controlPlaneStatus: DesktopSelfCheckItemStatus = "pass";
    let controlPlaneDetail = "The desktop node reached the central control plane successfully.";
    let controlPlaneBlocking = true;
    if (!localCheck.control_plane.node_sync_enabled) {
      controlPlaneStatus = "warn";
      controlPlaneBlocking = false;
      controlPlaneDetail = firstDetail(
        localCheck.control_plane.detail,
        "This desktop is not linked to a hospital server yet. Complete node registration to enable federation.",
      );
    } else if (!localCheck.control_plane.ready) {
      controlPlaneStatus = "fail";
      controlPlaneDetail = firstDetail(
        localCheck.control_plane.detail,
        "The desktop node could not complete its control-plane bootstrap.",
      );
    }
    items.push({
      id: "controlPlane",
      label: "Hospital server handshake",
      status: controlPlaneStatus,
      detail: controlPlaneDetail,
      blocking: controlPlaneBlocking,
    });

    let modelStatus: DesktopSelfCheckItemStatus = "pass";
    let modelDetail = "A current model release is ready on disk.";
    if (!localCheck.model_artifacts.ready && localCheck.model_artifacts.downloadable) {
      modelStatus = "warn";
      modelDetail = firstDetail(
        localCheck.model_artifacts.detail,
        "The current model is not cached locally yet and will download on demand.",
      );
    } else if (!localCheck.model_artifacts.ready) {
      modelStatus = "fail";
      modelDetail = firstDetail(
        localCheck.model_artifacts.detail,
        "No usable model artifact is available for this node.",
      );
    }
    items.push({
      id: "modelArtifacts",
      label: "Model files",
      status: modelStatus,
      detail: modelDetail,
      path:
        localCheck.model_artifacts.resolved_model_path ||
        localCheck.model_artifacts.active_model_path ||
        localCheck.model_artifacts.model_dir,
      blocking: false,
    });
  } else {
    items.push({
      id: "storagePermissions",
      label: "Storage permissions",
      status: "fail",
      detail:
        localCheckResult.reason instanceof Error
          ? localCheckResult.reason.message
          : "Desktop self-check could not read local runtime state.",
      blocking: true,
    });
    items.push({
      id: "dataPlaneDatabase",
      label: "Local patient database",
      status: "fail",
      detail: "Desktop self-check could not confirm the local database state.",
      blocking: true,
    });
    items.push({
      id: "controlPlaneCache",
      label: "Control-plane cache",
      status: "warn",
      detail: "Desktop self-check could not confirm the control-plane cache state.",
      blocking: false,
    });
    items.push({
      id: "controlPlane",
      label: "Hospital server handshake",
      status: "fail",
      detail: "Desktop self-check could not confirm the control-plane connection.",
      blocking: true,
    });
    items.push({
      id: "modelArtifacts",
      label: "Model files",
      status: "warn",
      detail: "Desktop self-check could not confirm the model state.",
      blocking: false,
    });
  }

  if (authStatusResult.status === "fulfilled") {
    items.push({
      id: "googleAuth",
      label: "Google sign-in",
      status: authStatusResult.value.configured ? "pass" : "fail",
      detail: authStatusResult.value.configured
        ? "Central desktop Google sign-in is configured."
        : "Central desktop Google sign-in is not configured on the control plane.",
      blocking: true,
    });
  } else {
    items.push({
      id: "googleAuth",
      label: "Google sign-in",
      status: "fail",
      detail:
        authStatusResult.reason instanceof Error
          ? authStatusResult.reason.message
          : "The desktop app could not verify central Google sign-in.",
      blocking: true,
    });
  }

  return {
    checkedAt:
      localCheckResult.status === "fulfilled" ? localCheckResult.value.checked_at : checkedAt,
    items,
    ready: !items.some((item) => item.blocking && item.status === "fail"),
  };
}
