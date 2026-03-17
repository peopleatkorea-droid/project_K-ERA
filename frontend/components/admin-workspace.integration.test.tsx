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
  fetchInstitutionDirectoryStatus: vi.fn(),
  searchPublicInstitutions: vi.fn(),
  fetchCrossValidationReports: vi.fn(),
  fetchSiteValidations: vi.fn(),
  fetchAiClinicEmbeddingStatus: vi.fn(),
  syncInstitutionDirectory: vi.fn(),
  createAdminSite: vi.fn(),
  autoPublishModelVersion: vi.fn(),
  autoPublishModelUpdate: vi.fn(),
  publishModelVersion: vi.fn(),
  publishModelUpdate: vi.fn(),
  runFederatedAggregation: vi.fn(),
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
    fetchInstitutionDirectoryStatus: apiMocks.fetchInstitutionDirectoryStatus,
    searchPublicInstitutions: apiMocks.searchPublicInstitutions,
    fetchCrossValidationReports: apiMocks.fetchCrossValidationReports,
    fetchSiteValidations: apiMocks.fetchSiteValidations,
    fetchAiClinicEmbeddingStatus: apiMocks.fetchAiClinicEmbeddingStatus,
    syncInstitutionDirectory: apiMocks.syncInstitutionDirectory,
    createAdminSite: apiMocks.createAdminSite,
    autoPublishModelVersion: apiMocks.autoPublishModelVersion,
    autoPublishModelUpdate: apiMocks.autoPublishModelUpdate,
    publishModelVersion: apiMocks.publishModelVersion,
    publishModelUpdate: apiMocks.publishModelUpdate,
    runFederatedAggregation: apiMocks.runFederatedAggregation,
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
    apiMocks.fetchInstitutionDirectoryStatus.mockResolvedValue({
      source: "hira",
      pages_synced: 44,
      total_count: 4385,
      institutions_synced: 4385,
      synced_at: "2026-03-17T00:00:00Z",
    });
    apiMocks.searchPublicInstitutions.mockResolvedValue([]);
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
    apiMocks.syncInstitutionDirectory.mockResolvedValue({
      source: "hira",
      pages_synced: 2,
      total_count: 128,
      institutions_synced: 128,
    });
    apiMocks.createAdminSite.mockResolvedValue({
      site_id: "SITE_B",
      project_id: "project_1",
      display_name: "Site B",
      hospital_name: "Hospital B",
    });
    apiMocks.publishModelVersion.mockResolvedValue({
      model_version: {
        version_id: "model_pending_publish",
        version_name: "global-pending-publish",
        architecture: "convnext_tiny",
        distribution_status: "published",
        download_url: "https://example.com/model.pt",
      },
    });
    apiMocks.publishModelUpdate.mockResolvedValue({
      update: {
        update_id: "update_publish_1",
        site_id: "SITE_A",
        architecture: "convnext_tiny",
        status: "approved",
        artifact_distribution_status: "published",
        artifact_download_url: "https://example.com/delta.pth",
      },
    });
    apiMocks.autoPublishModelVersion.mockResolvedValue({
      model_version: {
        version_id: "model_pending_publish",
        version_name: "global-pending-publish",
        architecture: "convnext_tiny",
        distribution_status: "published",
        download_url: "https://sharepoint.example/model.pt",
        source_provider: "onedrive_sharepoint",
        ready: true,
        is_current: true,
      },
    });
    apiMocks.autoPublishModelUpdate.mockResolvedValue({
      update: {
        update_id: "update_publish_1",
        site_id: "SITE_A",
        architecture: "convnext_tiny",
        status: "approved",
        artifact_distribution_status: "published",
        artifact_download_url: "https://sharepoint.example/delta.pth",
      },
    });
    apiMocks.runFederatedAggregation.mockResolvedValue({
      aggregation: {
        aggregation_id: "agg_1",
        new_version_name: "global-convnext-fedavg-20260317",
        architecture: "convnext_tiny",
        total_cases: 10,
        site_weights: {},
      },
      model_version: {
        version_id: "model_agg_1",
        version_name: "global-convnext-fedavg-20260317",
        architecture: "convnext_tiny",
      },
      aggregated_update_ids: [],
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

  it("searches HIRA institutions in management and prefills a new hospital mapping", async () => {
    const onSelectSite = vi.fn();
    const onRefreshSites = vi.fn(async () => undefined);
    apiMocks.searchPublicInstitutions.mockResolvedValue([
      {
        institution_id: "HIRA_12345678",
        source: "hira",
        name: "Jeju National University Hospital",
        institution_type_code: "11",
        institution_type_name: "Tertiary hospital",
        address: "Jeju",
        phone: "064-000-0000",
        homepage: "",
        sido_code: "50",
        sggu_code: "500",
        emdong_name: "",
        postal_code: "",
        x_pos: "",
        y_pos: "",
        ophthalmology_available: true,
        open_status: "active",
        synced_at: "2026-03-17T00:00:00Z",
      },
    ]);

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

    const hiraSearch = await screen.findByPlaceholderText("Jeju, Seoul, Kim's Eye...");
    fireEvent.change(hiraSearch, { target: { value: "Jeju" } });

    await waitFor(() => {
      expect(apiMocks.searchPublicInstitutions).toHaveBeenCalledWith("Jeju", { limit: 8 });
    });

    fireEvent.click(await screen.findByRole("button", { name: "Use for new site" }));

    expect(screen.getByLabelText("App display name")).toHaveValue("Jeju National University Hospital");
    expect(screen.getByLabelText("Official hospital name")).toHaveValue("Jeju National University Hospital");
    expect(screen.getByText(/Linked HIRA institution/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Register hospital" }));

    await waitFor(() => {
      expect(apiMocks.createAdminSite).toHaveBeenCalledWith(
        "test-token",
        expect.objectContaining({
          project_id: "project_1",
          display_name: "Jeju National University Hospital",
          hospital_name: "Jeju National University Hospital",
          source_institution_id: "HIRA_12345678",
          research_registry_enabled: true,
        }),
      );
    });
  });

  it("runs HIRA institution sync from the requests section", async () => {
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
          initialSection="requests"
          onSelectSite={vi.fn()}
          onOpenCanvas={vi.fn()}
          onLogout={vi.fn()}
          onRefreshSites={vi.fn(async () => undefined)}
          onSiteDataChanged={vi.fn(async () => undefined)}
          onToggleTheme={vi.fn()}
        />
      </LocaleProvider>
    );

    await screen.findByRole("button", { name: "Sync HIRA directory" });
    fireEvent.click(screen.getByRole("button", { name: "Sync HIRA directory" }));

    await waitFor(() => {
      expect(apiMocks.syncInstitutionDirectory).toHaveBeenCalledWith("test-token", { page_size: 100 });
    });
    expect(await screen.findByText("Synced 128 institutions from 2 HIRA page(s).")).toBeInTheDocument();
  });

  it("shows the latest HIRA sync snapshot in the requests section", async () => {
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
          initialSection="requests"
          onSelectSite={vi.fn()}
          onOpenCanvas={vi.fn()}
          onLogout={vi.fn()}
          onRefreshSites={vi.fn(async () => undefined)}
          onSiteDataChanged={vi.fn(async () => undefined)}
          onToggleTheme={vi.fn()}
        />
      </LocaleProvider>
    );

    expect(await screen.findByText("Last HIRA sync")).toBeInTheDocument();
    expect(screen.getByText(/4,385 institutions cached/i)).toBeInTheDocument();
  });

  it("shows contribution threshold alerts when 10 approved cases are ready for aggregation", async () => {
    apiMocks.fetchModelUpdates.mockResolvedValue(
      Array.from({ length: 10 }, (_, index) => ({
        update_id: `update_${index + 1}`,
        site_id: `SITE_${index + 1}`,
        base_model_version_id: "model_convnext_global_v1",
        architecture: "convnext_tiny",
        upload_type: "weight delta",
        execution_device: "cuda",
        artifact_path: `C:\\KERA\\delta_${index + 1}.pth`,
        n_cases: 1,
        contributed_by: `user_${index + 1}`,
        case_reference_id: `case_ref_${index + 1}`,
        created_at: "2026-03-17T00:00:00Z",
        training_input_policy: "medsam_cornea_crop_only",
        training_summary: {},
        status: "approved",
      })),
    );

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
          initialSection="federation"
          onSelectSite={vi.fn()}
          onOpenCanvas={vi.fn()}
          onLogout={vi.fn()}
          onRefreshSites={vi.fn(async () => undefined)}
          onSiteDataChanged={vi.fn(async () => undefined)}
          onToggleTheme={vi.fn()}
        />
      </LocaleProvider>
    );

    expect(await screen.findByText("Contribution threshold alerts")).toBeInTheDocument();
    expect(screen.getByText("Ready for aggregation")).toBeInTheDocument();
    expect(screen.getByText(/10 contributed cases across 10 hospital/i)).toBeInTheDocument();
    expect(screen.getByText(/1 contribution threshold alert/i)).toBeInTheDocument();
  });

  it("runs aggregation for a single architecture lane with explicit update ids", async () => {
    apiMocks.fetchModelUpdates.mockResolvedValue(
      [
        ...Array.from({ length: 2 }, (_, index) => ({
          update_id: `conv_update_${index + 1}`,
          site_id: `SITE_${index + 1}`,
          base_model_version_id: "model_convnext_global_v1",
          architecture: "convnext_tiny",
          upload_type: "weight delta",
          execution_device: "cuda",
          artifact_path: `C:\\KERA\\conv_delta_${index + 1}.pth`,
          n_cases: 1,
          contributed_by: `user_${index + 1}`,
          case_reference_id: `conv_case_ref_${index + 1}`,
          created_at: "2026-03-17T00:00:00Z",
          training_input_policy: "medsam_cornea_crop_only",
          training_summary: {},
          status: "approved",
        })),
        {
          update_id: "vit_update_1",
          site_id: "SITE_3",
          base_model_version_id: "model_vit_global_v1",
          architecture: "vit",
          upload_type: "weight delta",
          execution_device: "cuda",
          artifact_path: "C:\\KERA\\vit_delta_1.pth",
          n_cases: 1,
          contributed_by: "user_3",
          case_reference_id: "vit_case_ref_1",
          created_at: "2026-03-17T00:00:00Z",
          training_input_policy: "medsam_cornea_crop_only",
          training_summary: {},
          status: "approved",
        },
      ],
    );

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
          initialSection="federation"
          onSelectSite={vi.fn()}
          onOpenCanvas={vi.fn()}
          onLogout={vi.fn()}
          onRefreshSites={vi.fn(async () => undefined)}
          onSiteDataChanged={vi.fn(async () => undefined)}
          onToggleTheme={vi.fn()}
        />
      </LocaleProvider>
    );

    fireEvent.click(await screen.findByRole("button", { name: "Aggregate convnext_tiny lane" }));

    await waitFor(() => {
      expect(apiMocks.runFederatedAggregation).toHaveBeenCalledWith("test-token", {
        update_ids: ["conv_update_1", "conv_update_2"],
        new_version_name: undefined,
      });
    });
  });

  it("aggregates all ready lanes from the federation workspace", async () => {
    apiMocks.fetchModelUpdates.mockResolvedValue([
      {
        update_id: "conv_update_1",
        site_id: "SITE_A",
        base_model_version_id: "model_base_conv",
        architecture: "convnext_tiny",
        upload_type: "weight delta",
        execution_device: "cuda",
        artifact_path: "C:\\KERA\\conv_delta_1.pth",
        n_cases: 1,
        contributed_by: "user_1",
        case_reference_id: "conv_case_ref_1",
        created_at: "2026-03-17T00:00:00Z",
        training_input_policy: "medsam_cornea_crop_only",
        training_summary: {},
        status: "approved",
      },
      {
        update_id: "vit_update_1",
        site_id: "SITE_B",
        base_model_version_id: "model_base_vit",
        architecture: "vit",
        upload_type: "weight delta",
        execution_device: "cuda",
        artifact_path: "C:\\KERA\\vit_delta_1.pth",
        n_cases: 1,
        contributed_by: "user_2",
        case_reference_id: "vit_case_ref_1",
        created_at: "2026-03-17T00:01:00Z",
        training_input_policy: "medsam_cornea_crop_only",
        training_summary: {},
        status: "approved",
      },
    ]);

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
          initialSection="federation"
          onSelectSite={vi.fn()}
          onOpenCanvas={vi.fn()}
          onLogout={vi.fn()}
          onRefreshSites={vi.fn(async () => undefined)}
          onSiteDataChanged={vi.fn(async () => undefined)}
          onToggleTheme={vi.fn()}
        />
      </LocaleProvider>
    );

    fireEvent.click(await screen.findByRole("button", { name: "Aggregate all ready lanes (2)" }));

    await waitFor(() => {
      expect(apiMocks.runFederatedAggregation).toHaveBeenNthCalledWith(1, "test-token", {
        update_ids: ["conv_update_1"],
        new_version_name: undefined,
      });
      expect(apiMocks.runFederatedAggregation).toHaveBeenNthCalledWith(2, "test-token", {
        update_ids: ["vit_update_1"],
        new_version_name: undefined,
      });
    });
  });

  it("publishes a pending model version from the registry", async () => {
    apiMocks.fetchModelVersions.mockResolvedValue([
      {
        version_id: "model_pending_publish",
        version_name: "global-pending-publish",
        architecture: "convnext_tiny",
        created_at: "2026-03-17T00:00:00Z",
        ready: false,
        is_current: false,
        crop_mode: "automated",
        distribution_status: "pending_upload",
        source_provider: "onedrive_sharepoint",
      },
    ]);

    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("https://example.com/model.pt");
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

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
          initialSection="registry"
          onSelectSite={vi.fn()}
          onOpenCanvas={vi.fn()}
          onLogout={vi.fn()}
          onRefreshSites={vi.fn(async () => undefined)}
          onSiteDataChanged={vi.fn(async () => undefined)}
          onToggleTheme={vi.fn()}
        />
      </LocaleProvider>
    );

    fireEvent.click(await screen.findByRole("button", { name: "Publish model" }));

    await waitFor(() => {
      expect(apiMocks.publishModelVersion).toHaveBeenCalledWith("model_pending_publish", "test-token", {
        download_url: "https://example.com/model.pt",
        set_current: true,
      });
    });

    promptSpy.mockRestore();
    confirmSpy.mockRestore();
  });

  it("publishes a selected model update artifact from the registry", async () => {
    apiMocks.fetchModelUpdates.mockResolvedValue([
      {
        update_id: "update_publish_1",
        site_id: "SITE_A",
        architecture: "convnext_tiny",
        status: "pending_review",
        upload_type: "weight delta",
        execution_device: "cpu",
        created_at: "2026-03-17T00:00:00Z",
        artifact_distribution_status: "local_only",
        central_artifact_key: "model_updates/update_publish_1/delta.pth",
      },
    ]);

    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("https://example.com/delta.pth");

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
          initialSection="registry"
          onSelectSite={vi.fn()}
          onOpenCanvas={vi.fn()}
          onLogout={vi.fn()}
          onRefreshSites={vi.fn(async () => undefined)}
          onSiteDataChanged={vi.fn(async () => undefined)}
          onToggleTheme={vi.fn()}
        />
      </LocaleProvider>
    );

    fireEvent.click(await screen.findByRole("button", { name: "Publish delta" }));

    await waitFor(() => {
      expect(apiMocks.publishModelUpdate).toHaveBeenCalledWith("update_publish_1", "test-token", {
        download_url: "https://example.com/delta.pth",
      });
    });

    promptSpy.mockRestore();
  });

  it("auto publishes a pending model version when auto publish is configured", async () => {
    apiMocks.fetchAdminOverview.mockResolvedValue({
      site_count: 1,
      model_version_count: 1,
      pending_access_requests: 0,
      pending_model_updates: 0,
      current_model_version: "global-http-seed",
      aggregation_count: 0,
      federation_setup: {
        control_plane_split_enabled: true,
        control_plane_backend: "postgresql",
        data_plane_backend: "sqlite",
        control_plane_artifact_dir: "C:\\KERA\\artifacts",
        uses_default_control_plane_artifact_dir: false,
        model_distribution_mode: "download_url",
        onedrive_auto_publish_enabled: true,
      },
    });
    apiMocks.fetchModelVersions.mockResolvedValue([
      {
        version_id: "model_pending_publish",
        version_name: "global-pending-publish",
        architecture: "convnext_tiny",
        created_at: "2026-03-17T00:00:00Z",
        ready: false,
        is_current: false,
        crop_mode: "automated",
        distribution_status: "pending_upload",
        source_provider: "onedrive_sharepoint",
      },
    ]);

    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("https://example.com/unused.pt");
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

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
          initialSection="registry"
          onSelectSite={vi.fn()}
          onOpenCanvas={vi.fn()}
          onLogout={vi.fn()}
          onRefreshSites={vi.fn(async () => undefined)}
          onSiteDataChanged={vi.fn(async () => undefined)}
          onToggleTheme={vi.fn()}
        />
      </LocaleProvider>
    );

    fireEvent.click(await screen.findByRole("button", { name: "Auto publish" }));

    await waitFor(() => {
      expect(apiMocks.autoPublishModelVersion).toHaveBeenCalledWith("model_pending_publish", "test-token", {
        set_current: true,
      });
    });
    expect(promptSpy).not.toHaveBeenCalled();

    promptSpy.mockRestore();
    confirmSpy.mockRestore();
  });

  it("auto publishes a selected model update when auto publish is configured", async () => {
    apiMocks.fetchAdminOverview.mockResolvedValue({
      site_count: 1,
      model_version_count: 1,
      pending_access_requests: 0,
      pending_model_updates: 0,
      current_model_version: "global-http-seed",
      aggregation_count: 0,
      federation_setup: {
        control_plane_split_enabled: true,
        control_plane_backend: "postgresql",
        data_plane_backend: "sqlite",
        control_plane_artifact_dir: "C:\\KERA\\artifacts",
        uses_default_control_plane_artifact_dir: false,
        model_distribution_mode: "download_url",
        onedrive_auto_publish_enabled: true,
      },
    });
    apiMocks.fetchModelUpdates.mockResolvedValue([
      {
        update_id: "update_publish_1",
        site_id: "SITE_A",
        architecture: "convnext_tiny",
        status: "pending_review",
        upload_type: "weight delta",
        execution_device: "cpu",
        created_at: "2026-03-17T00:00:00Z",
        artifact_distribution_status: "local_only",
        central_artifact_key: "model_updates/update_publish_1/delta.pth",
      },
    ]);

    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("https://example.com/unused-delta.pt");

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
          initialSection="registry"
          onSelectSite={vi.fn()}
          onOpenCanvas={vi.fn()}
          onLogout={vi.fn()}
          onRefreshSites={vi.fn(async () => undefined)}
          onSiteDataChanged={vi.fn(async () => undefined)}
          onToggleTheme={vi.fn()}
        />
      </LocaleProvider>
    );

    fireEvent.click(await screen.findByRole("button", { name: "Auto publish delta" }));

    await waitFor(() => {
      expect(apiMocks.autoPublishModelUpdate).toHaveBeenCalledWith("update_publish_1", "test-token");
    });
    expect(promptSpy).not.toHaveBeenCalled();

    promptSpy.mockRestore();
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
