import React from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";

import { LocaleProvider } from "../lib/i18n";
import { AdminWorkspace } from "./admin-workspace";

const apiMocks = vi.hoisted(() => ({
  fetchAdminOverview: vi.fn(),
  fetchStorageSettings: vi.fn(),
  fetchAccessRequests: vi.fn(),
  fetchModelVersions: vi.fn(),
  fetchModelUpdates: vi.fn(),
  fetchAggregations: vi.fn(),
  fetchProjects: vi.fn(),
  fetchAdminSites: vi.fn(),
  fetchUsers: vi.fn(),
  fetchSiteComparison: vi.fn(),
  fetchCrossValidationReports: vi.fn(),
  fetchSiteValidations: vi.fn(),
  fetchAiClinicEmbeddingStatus: vi.fn(),
  createAdminSite: vi.fn(),
  runInitialTraining: vi.fn(),
  fetchSiteJob: vi.fn(),
}));

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    fetchAdminOverview: apiMocks.fetchAdminOverview,
    fetchStorageSettings: apiMocks.fetchStorageSettings,
    fetchAccessRequests: apiMocks.fetchAccessRequests,
    fetchModelVersions: apiMocks.fetchModelVersions,
    fetchModelUpdates: apiMocks.fetchModelUpdates,
    fetchAggregations: apiMocks.fetchAggregations,
    fetchProjects: apiMocks.fetchProjects,
    fetchAdminSites: apiMocks.fetchAdminSites,
    fetchUsers: apiMocks.fetchUsers,
    fetchSiteComparison: apiMocks.fetchSiteComparison,
    fetchCrossValidationReports: apiMocks.fetchCrossValidationReports,
    fetchSiteValidations: apiMocks.fetchSiteValidations,
    fetchAiClinicEmbeddingStatus: apiMocks.fetchAiClinicEmbeddingStatus,
    createAdminSite: apiMocks.createAdminSite,
    runInitialTraining: apiMocks.runInitialTraining,
    fetchSiteJob: apiMocks.fetchSiteJob,
  };
});

describe("AdminWorkspace integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    window.localStorage.clear();
    apiMocks.fetchAdminOverview.mockResolvedValue({
      site_count: 1,
      model_version_count: 1,
      pending_access_requests: 0,
      pending_model_updates: 0,
      current_model_version: "global-http-seed",
      aggregation_count: 0,
    });
    apiMocks.fetchStorageSettings.mockResolvedValue({
      storage_root: "C:\\KERA",
      default_storage_root: "C:\\KERA",
      uses_custom_root: false,
    });
    apiMocks.fetchAccessRequests.mockResolvedValue([]);
    apiMocks.fetchModelVersions.mockResolvedValue([]);
    apiMocks.fetchModelUpdates.mockResolvedValue([]);
    apiMocks.fetchAggregations.mockResolvedValue([]);
    apiMocks.fetchProjects.mockResolvedValue([
      {
        project_id: "project_1",
        name: "Alpha Project",
        description: "test",
        site_ids: ["SITE_A"],
        created_at: "2026-03-15T00:00:00Z",
      },
    ]);
    apiMocks.fetchAdminSites.mockResolvedValue([
      {
        site_id: "SITE_A",
        project_id: "project_1",
        display_name: "Site A",
        hospital_name: "Hospital A",
        local_storage_root: "C:\\KERA\\SITE_A",
      },
    ]);
    apiMocks.fetchUsers.mockResolvedValue([]);
    apiMocks.fetchSiteComparison.mockResolvedValue([]);
    apiMocks.fetchCrossValidationReports.mockResolvedValue([]);
    apiMocks.fetchSiteValidations.mockResolvedValue([]);
    apiMocks.fetchAiClinicEmbeddingStatus.mockResolvedValue({
      site_id: "SITE_A",
      total_images: 0,
      total_cases: 0,
      missing_image_count: 0,
      missing_case_count: 0,
      needs_backfill: false,
      model_version: {
        version_id: "model_http_seed",
        version_name: "global-http-seed",
        architecture: "densenet121",
      },
      vector_index: {
        classifier_available: true,
        dinov2_embedding_available: false,
        dinov2_index_available: false,
      },
      active_job: null,
    });
    apiMocks.createAdminSite.mockResolvedValue({
      site_id: "SITE_B",
      project_id: "project_1",
      display_name: "Site B",
      hospital_name: "Hospital B",
    });
    apiMocks.runInitialTraining.mockResolvedValue({
      job: {
        job_id: "job_train_1",
        status: "queued",
      },
    });
    apiMocks.fetchSiteJob
      .mockResolvedValueOnce({
        job_id: "job_train_1",
        status: "running",
        result: {
          progress: {
            stage: "training",
            percent: 40,
          },
        },
      })
      .mockResolvedValueOnce({
        job_id: "job_train_1",
        status: "completed",
        result: {
          response: {
            result: {
              version_name: "global-vit-2026",
              n_train_patients: 4,
              n_val_patients: 1,
              n_test_patients: 1,
              best_val_acc: 0.91,
            },
          },
        },
      });
  });

  it("creates a hospital through the management section and refreshes workspace state", async () => {
    const onSelectSite = vi.fn();
    const onRefreshSites = vi.fn(async () => undefined);

    render(
      <LocaleProvider>
        <AdminWorkspace
          token="test-token"
          user={{
            user_id: "user_admin",
            username: "admin",
            full_name: "Admin User",
            role: "admin",
            site_ids: ["SITE_A"],
            approval_status: "approved",
          }}
          sites={[
            {
              site_id: "SITE_A",
              display_name: "Site A",
              hospital_name: "Hospital A",
            },
          ]}
          selectedSiteId="SITE_A"
          summary={{
            site_id: "SITE_A",
            n_patients: 0,
            n_visits: 0,
            n_images: 0,
            n_active_visits: 0,
            n_validation_runs: 0,
            latest_validation: null,
          }}
          theme="light"
          initialSection="management"
          onSelectSite={onSelectSite}
          onOpenCanvas={vi.fn()}
          onLogout={vi.fn()}
          onRefreshSites={onRefreshSites}
          onSiteDataChanged={vi.fn(async () => undefined)}
          onToggleTheme={vi.fn()}
        />
      </LocaleProvider>
    );

    await screen.findByRole("button", { name: "Register hospital" });

    fireEvent.change(screen.getByLabelText("Hospital code"), { target: { value: "SITE_B" } });
    fireEvent.change(screen.getByLabelText("App display name"), { target: { value: "Site B" } });
    fireEvent.change(screen.getByLabelText("Official hospital name"), { target: { value: "Hospital B" } });
    fireEvent.click(screen.getByRole("button", { name: "Register hospital" }));

    await waitFor(() => {
      expect(apiMocks.createAdminSite).toHaveBeenCalledWith("test-token", {
        project_id: "project_1",
        site_code: "SITE_B",
        display_name: "Site B",
        hospital_name: "Hospital B",
        research_registry_enabled: true,
      });
    });
    await waitFor(() => {
      expect(onRefreshSites).toHaveBeenCalledTimes(1);
      expect(onSelectSite).toHaveBeenCalledWith("SITE_B");
    });
    expect(await screen.findByText("Hospital SITE_B registered.")).toBeInTheDocument();
  });

  it("polls an initial training job until completion and switches to registry", async () => {
    const onSiteDataChanged = vi.fn(async () => undefined);

    render(
      <LocaleProvider>
        <AdminWorkspace
          token="test-token"
          user={{
            user_id: "user_admin",
            username: "admin",
            full_name: "Admin User",
            role: "admin",
            site_ids: ["SITE_A"],
            approval_status: "approved",
          }}
          sites={[
            {
              site_id: "SITE_A",
              display_name: "Site A",
              hospital_name: "Hospital A",
            },
          ]}
          selectedSiteId="SITE_A"
          summary={{
            site_id: "SITE_A",
            n_patients: 0,
            n_visits: 0,
            n_images: 0,
            n_active_visits: 0,
            n_validation_runs: 0,
            latest_validation: null,
          }}
          theme="light"
          initialSection="training"
          onSelectSite={vi.fn()}
          onOpenCanvas={vi.fn()}
          onLogout={vi.fn()}
          onRefreshSites={vi.fn(async () => undefined)}
          onSiteDataChanged={onSiteDataChanged}
          onToggleTheme={vi.fn()}
        />
      </LocaleProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Run initial training" }));

    await waitFor(() => {
      expect(apiMocks.runInitialTraining).toHaveBeenCalledWith("SITE_A", "test-token", expect.objectContaining({
        architecture: "convnext_tiny",
      }));
      expect(apiMocks.fetchSiteJob).toHaveBeenCalledTimes(2);
      expect(onSiteDataChanged).toHaveBeenCalledWith("SITE_A");
    }, { timeout: 6000 });
    expect(await screen.findByText("Registered global-vit-2026.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Model registry" })).toHaveClass("active");
  }, 8000);
});
