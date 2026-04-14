import React from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DesktopReleasePanel } from "./desktop-release-panel";

const adminMocks = vi.hoisted(() => ({
  fetchAdminDesktopReleases: vi.fn(),
  saveAdminDesktopRelease: vi.fn(),
  activateAdminDesktopRelease: vi.fn(),
}));

vi.mock("../../lib/admin", () => ({
  fetchAdminDesktopReleases: adminMocks.fetchAdminDesktopReleases,
  saveAdminDesktopRelease: adminMocks.saveAdminDesktopRelease,
  activateAdminDesktopRelease: adminMocks.activateAdminDesktopRelease,
}));

function createRelease(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    release_id: "desktop_cpu_nsis_1_0_0",
    channel: "desktop_cpu_nsis",
    label: "K-ERA Desktop (CPU)",
    version: "1.0.0",
    platform: "windows",
    installer_type: "nsis",
    download_url: "https://example.com/kera-1.0.0.exe",
    folder_url: "https://example.com/folder",
    sha256: "ABC123",
    size_bytes: 100,
    notes: "Initial release",
    active: true,
    created_at: "2026-04-14T00:00:00Z",
    updated_at: "2026-04-14T00:00:00Z",
    metadata_json: {},
    ...overrides,
  };
}

describe("DesktopReleasePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads and displays the active desktop release", async () => {
    adminMocks.fetchAdminDesktopReleases.mockResolvedValue([createRelease()]);

    render(<DesktopReleasePanel token="admin-token" locale="en" />);

    expect(await screen.findByText("Desktop installer releases")).toBeInTheDocument();
    expect(await screen.findByText("Active 1.0.0")).toBeInTheDocument();
    expect(await screen.findByDisplayValue("Initial release")).toBeInTheDocument();
    expect(adminMocks.fetchAdminDesktopReleases).toHaveBeenCalledWith("admin-token");
  });

  it("saves a new active CPU release and refreshes the list", async () => {
    adminMocks.fetchAdminDesktopReleases
      .mockResolvedValueOnce([createRelease()])
      .mockResolvedValueOnce([
        createRelease({
          release_id: "desktop_cpu_nsis_1_1_0",
          version: "1.1.0",
          download_url: "https://example.com/kera-1.1.0.exe",
          notes: "Updated release",
        }),
      ]);
    adminMocks.saveAdminDesktopRelease.mockResolvedValue(
      createRelease({
        release_id: "desktop_cpu_nsis_1_1_0",
        version: "1.1.0",
        download_url: "https://example.com/kera-1.1.0.exe",
        notes: "Updated release",
      }),
    );

    render(<DesktopReleasePanel token="admin-token" locale="en" />);

    const versionInput = await screen.findByDisplayValue("1.0.0");
    fireEvent.change(versionInput, { target: { value: "1.1.0" } });
    fireEvent.change(screen.getByDisplayValue("https://example.com/kera-1.0.0.exe"), {
      target: { value: "https://example.com/kera-1.1.0.exe" },
    });
    fireEvent.change(screen.getByDisplayValue("Initial release"), {
      target: { value: "Updated release" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save as active CPU release" }));

    await waitFor(() => {
      expect(adminMocks.saveAdminDesktopRelease).toHaveBeenCalledWith(
        "admin-token",
        expect.objectContaining({
          channel: "desktop_cpu_nsis",
          version: "1.1.0",
          download_url: "https://example.com/kera-1.1.0.exe",
          active: true,
        }),
      );
    });
    expect(await screen.findByText("Active 1.1.0")).toBeInTheDocument();
    expect(await screen.findByDisplayValue("Updated release")).toBeInTheDocument();
  });
});
