import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DesktopAppConfigState } from "./desktop-app-config";
import type { DesktopDiagnosticsSnapshot } from "./desktop-diagnostics";

const mockHasDesktopRuntime = vi.fn(() => true);
const mockRequestDesktopLocalApiJson = vi.fn();

vi.mock("./desktop-ipc", () => ({
  hasDesktopRuntime: mockHasDesktopRuntime,
}));

vi.mock("./desktop-local-api", () => ({
  requestDesktopLocalApiJson: mockRequestDesktopLocalApiJson,
}));

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
    setup_ready: true,
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
      storage_dir: "C:\\Users\\USER\\AppData\\Local\\KERA\\KERA_DATA",
      control_plane_api_base_url: "https://kera-bay.vercel.app/control-plane/api",
      control_plane_node_id: "node-1",
      control_plane_node_token: "secret",
      control_plane_site_id: "site-1",
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
    localBackend: {
      transport: "http",
      mode: "managed",
      base_url: "http://127.0.0.1:8000",
      local_url: true,
      managed: true,
      running: true,
      healthy: true,
      launched_by_desktop: true,
      last_error: null,
    },
    localWorker: {
      mode: "managed",
      managed: true,
      running: true,
      launched_by_desktop: true,
      last_error: null,
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
      last_error: null,
    },
    nodeStatus: null,
    nodeStatusError: null,
    ...overrides,
  };
}

describe("runDesktopSelfCheck", () => {
  beforeEach(() => {
    mockHasDesktopRuntime.mockReturnValue(true);
    mockRequestDesktopLocalApiJson.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("marks the desktop ready when blocking checks pass and model download is only a warning", async () => {
    mockRequestDesktopLocalApiJson.mockResolvedValue({
      checked_at: "2026-03-23T00:00:00.000Z",
      storage: {
        storage_dir: { path: "C:\\KERA_DATA", exists: true, writable: true, detail: "" },
        runtime_dir: { path: "C:\\Users\\USER\\AppData\\Local\\KERA\\runtime", exists: true, writable: true, detail: "" },
      },
      data_plane_database: { path: "C:\\KERA_DATA\\kera.db", exists: true, required: true, ready: true, detail: "" },
      control_plane_cache_database: {
        path: "C:\\KERA_DATA\\control_plane_cache.db",
        exists: false,
        required: false,
        ready: false,
        detail: "",
      },
      control_plane: {
        configured: true,
        node_sync_enabled: true,
        base_url: "https://kera-bay.vercel.app/control-plane/api",
        node_id: "node-1",
        bootstrap: { ok: true },
        ready: true,
        detail: "",
      },
      model_artifacts: {
        model_dir: "C:\\KERA_DATA\\models",
        model_dir_exists: true,
        active_manifest_path: "C:\\KERA_DATA\\models\\active-manifest.json",
        active_manifest_exists: true,
        active_manifest: {},
        active_model_path: "C:\\KERA_DATA\\models\\active.bin",
        active_model_exists: false,
        current_release: { version: "1.0.0", download_url: "https://example.org/model.bin" },
        resolved_model_path: "",
        ready: false,
        downloadable: true,
        detail: "Model will download on demand.",
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            client_id_configured: true,
            client_secret_configured: true,
            configured: true,
          }),
          { status: 200 },
        ),
      ),
    );

    const { runDesktopSelfCheck } = await import("./desktop-self-check");
    const snapshot = await runDesktopSelfCheck(createConfig(), createDiagnostics());

    expect(snapshot?.ready).toBe(true);
    expect(snapshot?.items.find((item) => item.id === "controlPlaneCache")?.status).toBe("warn");
    expect(snapshot?.items.find((item) => item.id === "modelArtifacts")?.status).toBe("warn");
    expect(snapshot?.items.find((item) => item.id === "googleAuth")?.status).toBe("pass");
  });

  it("blocks the desktop when storage or central Google auth is unavailable", async () => {
    mockRequestDesktopLocalApiJson.mockResolvedValue({
      checked_at: "2026-03-23T00:00:00.000Z",
      storage: {
        storage_dir: { path: "C:\\KERA_DATA", exists: true, writable: false, detail: "Access is denied." },
        runtime_dir: { path: "C:\\Users\\USER\\AppData\\Local\\KERA\\runtime", exists: true, writable: true, detail: "" },
      },
      data_plane_database: { path: "C:\\KERA_DATA\\kera.db", exists: false, required: true, ready: false, detail: "SQLITE_BUSY" },
      control_plane_cache_database: {
        path: "C:\\KERA_DATA\\control_plane_cache.db",
        exists: true,
        required: true,
        ready: true,
        detail: "",
      },
      control_plane: {
        configured: true,
        node_sync_enabled: true,
        base_url: "https://kera-bay.vercel.app/control-plane/api",
        node_id: "node-1",
        bootstrap: null,
        ready: false,
        detail: "Remote bootstrap failed.",
      },
      model_artifacts: {
        model_dir: "C:\\KERA_DATA\\models",
        model_dir_exists: true,
        active_manifest_path: "C:\\KERA_DATA\\models\\active-manifest.json",
        active_manifest_exists: false,
        active_manifest: {},
        active_model_path: "",
        active_model_exists: false,
        current_release: null,
        resolved_model_path: "",
        ready: false,
        downloadable: false,
        detail: "No model release is available.",
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            client_id_configured: true,
            client_secret_configured: false,
            configured: false,
          }),
          { status: 200 },
        ),
      ),
    );

    const { runDesktopSelfCheck } = await import("./desktop-self-check");
    const snapshot = await runDesktopSelfCheck(createConfig(), createDiagnostics());

    expect(snapshot?.ready).toBe(false);
    expect(snapshot?.items.find((item) => item.id === "storagePermissions")?.status).toBe("fail");
    expect(snapshot?.items.find((item) => item.id === "dataPlaneDatabase")?.status).toBe("fail");
    expect(snapshot?.items.find((item) => item.id === "controlPlane")?.status).toBe("fail");
    expect(snapshot?.items.find((item) => item.id === "googleAuth")?.status).toBe("fail");
  });
});
