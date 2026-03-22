"use client";

import { hasDesktopRuntime, invokeDesktop } from "./desktop-ipc";

export type DesktopAppConfigValues = {
  storage_dir: string;
  control_plane_api_base_url: string;
  control_plane_node_id: string;
  control_plane_node_token: string;
  control_plane_site_id: string;
  local_backend_python: string;
  local_backend_mode: "managed" | "external";
  ml_transport: "sidecar" | "http";
};

export type DesktopRuntimeContractState = {
  mode: "dev" | "packaged";
  packaged_mode: boolean;
  env_source: string;
  resource_dir: string | null;
  runtime_dir: string;
  logs_dir: string;
  backend_source: string;
  backend_candidates: string[];
  python_candidates: string[];
  errors: string[];
  warnings: string[];
};

export type DesktopAppConfigState = {
  runtime: "desktop" | "web";
  config_path: string;
  app_local_data_dir: string;
  repo_root: string;
  backend_root: string;
  backend_entry: string;
  worker_module: string;
  storage_state_file?: string | null;
  setup_ready: boolean;
  runtime_contract: DesktopRuntimeContractState;
  values: DesktopAppConfigValues;
};

type SaveDesktopAppConfigPayload = {
  config: Partial<DesktopAppConfigValues>;
};

type PickDesktopDirectoryPayload = {
  title?: string;
  default_path?: string;
};

function webFallback(): DesktopAppConfigState {
  return {
    runtime: "web",
    config_path: "",
    app_local_data_dir: "",
    repo_root: "",
    backend_root: "",
    backend_entry: "",
    worker_module: "kera_research.worker",
    storage_state_file: null,
    setup_ready: false,
    runtime_contract: {
      mode: "dev",
      packaged_mode: false,
      env_source: "web",
      resource_dir: null,
      runtime_dir: "",
      logs_dir: "",
      backend_source: "web",
      backend_candidates: [],
      python_candidates: [],
      errors: [],
      warnings: [],
    },
    values: {
      storage_dir: "",
      control_plane_api_base_url: "",
      control_plane_node_id: "",
      control_plane_node_token: "",
      control_plane_site_id: "",
      local_backend_python: "",
      local_backend_mode: "managed",
      ml_transport: "sidecar",
    },
  };
}

export async function fetchDesktopAppConfig(signal?: AbortSignal) {
  if (!hasDesktopRuntime()) {
    return webFallback();
  }
  return invokeDesktop<DesktopAppConfigState>("get_desktop_app_config", {}, signal);
}

export async function saveDesktopAppConfig(payload: SaveDesktopAppConfigPayload, signal?: AbortSignal) {
  if (!hasDesktopRuntime()) {
    return webFallback();
  }
  return invokeDesktop<DesktopAppConfigState>("save_desktop_app_config", payload, signal);
}

export async function clearDesktopAppConfig(signal?: AbortSignal) {
  if (!hasDesktopRuntime()) {
    return webFallback();
  }
  return invokeDesktop<DesktopAppConfigState>("clear_desktop_app_config", {}, signal);
}

export async function openDesktopPath(path: string, signal?: AbortSignal) {
  if (!hasDesktopRuntime()) {
    throw new Error("Desktop runtime is unavailable.");
  }
  return invokeDesktop<void>("open_desktop_path", { payload: { path } }, signal);
}

export async function pickDesktopDirectory(
  options: { title?: string; defaultPath?: string } = {},
  signal?: AbortSignal,
) {
  if (!hasDesktopRuntime()) {
    throw new Error("Desktop runtime is unavailable.");
  }
  const payload: PickDesktopDirectoryPayload = {};
  if (options.title?.trim()) {
    payload.title = options.title.trim();
  }
  if (options.defaultPath?.trim()) {
    payload.default_path = options.defaultPath.trim();
  }
  return invokeDesktop<string | null>("pick_desktop_directory", { payload }, signal);
}
