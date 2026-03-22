import { describe, expect, it } from "vitest";

import type { DesktopAppConfigState } from "./desktop-app-config";
import type { DesktopDiagnosticsSnapshot } from "./desktop-diagnostics";
import { describeDesktopOnboarding } from "./desktop-onboarding";

function createConfig(overrides?: Partial<DesktopAppConfigState>): DesktopAppConfigState {
  return {
    runtime: "desktop",
    config_path: "C:\\Users\\USER\\AppData\\Local\\KERA\\desktop-config.json",
    app_local_data_dir: "C:\\Users\\USER\\AppData\\Local\\KERA",
    repo_root: "C:\\repo",
    backend_root: "C:\\Users\\USER\\AppData\\Local\\KERA\\runtime\\backend",
    backend_entry: "C:\\Users\\USER\\AppData\\Local\\KERA\\runtime\\backend\\app.py",
    worker_module: "kera_research.worker",
    storage_state_file: "C:\\Users\\USER\\AppData\\Local\\KERA\\storage_dir.txt",
    setup_ready: false,
    runtime_contract: {
      mode: "packaged",
      packaged_mode: true,
      env_source: "desktop_config_only",
      resource_dir: "C:\\Program Files\\K-ERA Desktop\\resources",
      runtime_dir: "C:\\Users\\USER\\AppData\\Local\\KERA\\runtime",
      logs_dir: "C:\\Users\\USER\\AppData\\Local\\KERA\\runtime",
      backend_source: "bundled_resources/backend",
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
    ...overrides,
  };
}

function createDiagnostics(overrides?: Partial<DesktopDiagnosticsSnapshot>): DesktopDiagnosticsSnapshot {
  return {
    runtime: "desktop",
    localBackend: null,
    localWorker: null,
    mlBackend: null,
    nodeStatus: null,
    nodeStatusError: null,
    ...overrides,
  };
}

describe("describeDesktopOnboarding", () => {
  it("starts at storage on a fresh packaged machine", () => {
    const state = describeDesktopOnboarding(createConfig(), createDiagnostics());

    expect(state.firstRun).toBe(true);
    expect(state.currentStepId).toBe("storage");
    expect(state.canStartRuntime).toBe(false);
    expect(state.completed).toBe(1);
  });

  it("blocks on runtime services after config is complete but services are down", () => {
    const state = describeDesktopOnboarding(
      createConfig({
        values: {
          storage_dir: "C:\\KERA_DATA",
          control_plane_api_base_url: "https://example.org/control-plane/api",
          control_plane_node_id: "node_1",
          control_plane_node_token: "secret",
          control_plane_site_id: "site_1",
          local_backend_python: "",
          local_backend_mode: "managed",
          ml_transport: "sidecar",
        },
      }),
      createDiagnostics(),
    );

    expect(state.currentStepId).toBe("runtimeServices");
    expect(state.canStartRuntime).toBe(true);
    expect(state.canSignIn).toBe(false);
    expect(state.runtimeServices.workerRequired).toBe(true);
    expect(state.runtimeServices.mlRequired).toBe(true);
  });

  it("marks the desktop shell ready once runtime services are healthy", () => {
    const state = describeDesktopOnboarding(
      createConfig({
        setup_ready: true,
        values: {
          storage_dir: "C:\\KERA_DATA",
          control_plane_api_base_url: "https://example.org/control-plane/api",
          control_plane_node_id: "node_1",
          control_plane_node_token: "secret",
          control_plane_site_id: "site_1",
          local_backend_python: "",
          local_backend_mode: "managed",
          ml_transport: "sidecar",
        },
      }),
      createDiagnostics({
        localBackend: {
          transport: "http",
          mode: "managed",
          base_url: "http://127.0.0.1:8000",
          local_url: true,
          managed: true,
          running: true,
          healthy: true,
          launched_by_desktop: true,
        },
        localWorker: {
          mode: "managed",
          managed: true,
          running: true,
          launched_by_desktop: true,
        },
        mlBackend: {
          transport: "sidecar",
          mode: "managed",
          base_url: "http://127.0.0.1:8000",
          local_url: true,
          managed: true,
          running: true,
          healthy: true,
          launched_by_desktop: true,
        },
      }),
    );

    expect(state.currentStepId).toBe("signIn");
    expect(state.canSignIn).toBe(true);
    expect(state.canOpenWorkspace).toBe(true);
    expect(state.percent).toBe(100);
  });
});
