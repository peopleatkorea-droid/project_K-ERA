import React from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DesktopDiagnosticsPanel } from "./desktop-diagnostics-panel";

const diagnosticsMocks = vi.hoisted(() => ({
  fetchDesktopDiagnosticsSnapshot: vi.fn(),
  ensureDesktopDiagnosticsBackends: vi.fn(),
  stopDesktopDiagnosticsBackends: vi.fn(),
}));

const controlPlaneMocks = vi.hoisted(() => ({
  registerLocalNodeViaMainAdmin: vi.fn(),
}));

vi.mock("../../lib/desktop-diagnostics", () => ({
  fetchDesktopDiagnosticsSnapshot: diagnosticsMocks.fetchDesktopDiagnosticsSnapshot,
  ensureDesktopDiagnosticsBackends: diagnosticsMocks.ensureDesktopDiagnosticsBackends,
  stopDesktopDiagnosticsBackends: diagnosticsMocks.stopDesktopDiagnosticsBackends,
}));

vi.mock("../../lib/local-node-client", () => ({
  registerLocalNodeViaMainAdmin: controlPlaneMocks.registerLocalNodeViaMainAdmin,
}));

function createSnapshot(overrides?: Record<string, unknown>) {
  return {
    runtime: "desktop",
    localBackend: null,
    localWorker: null,
    mlBackend: null,
    nodeStatus: {
      control_plane: {
        configured: true,
        node_sync_enabled: false,
        base_url: "https://kera.example/control-plane/api",
        node_id: "",
      },
      stored_credentials_present: false,
      database_topology: {
        control_plane_connection_mode: "remote",
        control_plane_backend: "sqlite",
        data_plane_backend: "sqlite",
      },
      bootstrap: null,
      current_release: null,
    },
    nodeStatusError: null,
    backendCapabilities: {
      desktopAuthRoutes: true,
      selfCheckRoute: true,
    },
    backendCapabilitiesError: null,
    ...overrides,
  };
}

describe("DesktopDiagnosticsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reconnects the selected hospital and stores fresh node credentials locally", async () => {
    diagnosticsMocks.fetchDesktopDiagnosticsSnapshot
      .mockResolvedValueOnce(createSnapshot())
      .mockResolvedValueOnce(
        createSnapshot({
          nodeStatus: {
            control_plane: {
              configured: true,
              node_sync_enabled: true,
              base_url: "https://kera.example/control-plane/api",
              node_id: "node_1",
            },
            stored_credentials_present: true,
            database_topology: {
              control_plane_connection_mode: "remote",
              control_plane_backend: "sqlite",
              data_plane_backend: "sqlite",
            },
            bootstrap: { site: { site_id: "39100103" } },
            current_release: null,
          },
        }),
      );
    diagnosticsMocks.ensureDesktopDiagnosticsBackends.mockResolvedValue(createSnapshot());
    controlPlaneMocks.registerLocalNodeViaMainAdmin.mockResolvedValue({
      registered: true,
      node_id: "node_1",
      node_token: "secret_1",
      bootstrap: {
        site: {
          site_id: "39100103",
        },
      },
      saved: true,
      credentials: {},
    });

    render(
      <DesktopDiagnosticsPanel
        token="desktop-token"
        locale="en"
        formatDateTime={(value) => value ?? "n/a"}
        selectedSiteLabel="Jeju National University Hospital"
        selectedManagedSite={{
          site_id: "39100103",
          project_id: "project_default",
          display_name: "Jeju National University Hospital",
          hospital_name: "Jeju National University Hospital",
          source_institution_id: "39100103",
          source_institution_name: "Jeju National University Hospital",
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reconnect this hospital" })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: "Reconnect this hospital" }));

    await waitFor(() => {
      expect(controlPlaneMocks.registerLocalNodeViaMainAdmin).toHaveBeenCalledWith({
        control_plane_user_token: "desktop-token",
        control_plane_base_url: "https://kera.example/control-plane/api",
        device_name: "local-node",
        site_id: "39100103",
        display_name: "Jeju National University Hospital",
        hospital_name: "Jeju National University Hospital",
        source_institution_id: "39100103",
        overwrite: true,
      });
    });

    expect(await screen.findByText("Operations hub is reconnected for Jeju National University Hospital.")).toBeInTheDocument();
  });

  it("shows the backend error when reconnect fails", async () => {
    diagnosticsMocks.fetchDesktopDiagnosticsSnapshot.mockResolvedValue(createSnapshot());
    diagnosticsMocks.ensureDesktopDiagnosticsBackends.mockResolvedValue(createSnapshot());
    controlPlaneMocks.registerLocalNodeViaMainAdmin.mockRejectedValue(new Error("Node registration failed: Invalid credentials."));

    render(
      <DesktopDiagnosticsPanel
        token="desktop-token"
        locale="en"
        formatDateTime={(value) => value ?? "n/a"}
        selectedSiteLabel="Jeju National University Hospital"
        selectedManagedSite={{
          site_id: "39100103",
          project_id: "project_default",
          display_name: "Jeju National University Hospital",
          hospital_name: "Jeju National University Hospital",
          source_institution_id: "39100103",
          source_institution_name: "Jeju National University Hospital",
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reconnect this hospital" })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: "Reconnect this hospital" }));

    expect(
      await screen.findByText(
        "Node registration failed: Invalid credentials.",
      ),
    ).toBeInTheDocument();
  });

  it("disables reconnect when the admin token is missing", async () => {
    diagnosticsMocks.fetchDesktopDiagnosticsSnapshot.mockResolvedValue(createSnapshot());

    render(
      <DesktopDiagnosticsPanel
        token=""
        locale="en"
        formatDateTime={(value) => value ?? "n/a"}
        selectedSiteLabel="Jeju National University Hospital"
        selectedManagedSite={{
          site_id: "39100103",
          project_id: "project_default",
          display_name: "Jeju National University Hospital",
          hospital_name: "Jeju National University Hospital",
          source_institution_id: "39100103",
          source_institution_name: "Jeju National University Hospital",
        }}
      />,
    );

    expect(
      await screen.findByText("Your admin session is missing. Sign in again before reconnecting the operations hub."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reconnect this hospital" })).toBeDisabled();
  });
});
