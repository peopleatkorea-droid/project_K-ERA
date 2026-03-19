import React from "react";

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  reviewAccessRequest: vi.fn(),
  createAdminSite: vi.fn(),
  updateAdminSite: vi.fn(),
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
    reviewAccessRequest: apiMocks.reviewAccessRequest,
    createAdminSite: apiMocks.createAdminSite,
    updateAdminSite: apiMocks.updateAdminSite,
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
      effective_default_storage_root: "C:\\KERA",
      storage_root_source: "built_in_default",
      uses_custom_root: false,
    });
    apiMocks.fetchAccessRequests.mockImplementation((_token, statusFilter = "pending") => Promise.resolve(statusFilter === "approved" ? [] : []));
    apiMocks.fetchModelVersions.mockResolvedValue([]);
    apiMocks.fetchModelUpdates.mockResolvedValue([]);
    apiMocks.fetchAggregations.mockResolvedValue([]);
    apiMocks.fetchProjects.mockResolvedValue([
      {
        project_id: "project_default",
        name: "Default Workspace",
        description: "test",
        site_ids: ["SITE_A"],
        created_at: "2026-03-15T00:00:00Z",
      },
    ]);
    apiMocks.fetchAdminSites.mockResolvedValue([
      {
        site_id: "SITE_A",
        project_id: "project_default",
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
    apiMocks.reviewAccessRequest.mockResolvedValue({
      request: {
        request_id: "access_1",
        user_id: "user_researcher",
        email: "researcher@example.com",
        requested_site_id: "SITE_A",
        requested_site_label: "Site A",
        requested_site_source: "site",
        resolved_site_id: "SITE_A",
        resolved_site_label: "Site A",
        requested_role: "researcher",
        message: "Need access",
        status: "rejected",
        reviewed_by: "user_admin",
        reviewer_notes: "",
        created_at: "2026-03-17T00:00:00Z",
        reviewed_at: "2026-03-17T00:01:00Z",
      },
      created_site: null,
    });
    apiMocks.createAdminSite.mockResolvedValue({
      site_id: "SITE_B",
      project_id: "project_default",
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
    apiMocks.searchPublicInstitutions.mockResolvedValue([
      {
        institution_id: "39100103",
        source: "hira",
        name: "Jeju National University Hospital",
        institution_type_code: "11",
        institution_type_name: "Tertiary hospital",
        address: "Jeju Special Self-Governing Province",
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

    await screen.findByRole("button", { name: "Register hospital" });

    fireEvent.change(screen.getByPlaceholderText("Jeju, Seoul, Kim's Eye..."), { target: { value: "Jeju" } });

    await waitFor(() => {
      expect(apiMocks.searchPublicInstitutions).toHaveBeenCalledWith("Jeju", { limit: 8 });
    });

    fireEvent.click(await screen.findByRole("button", { name: "Select this hospital" }));
    fireEvent.change(screen.getByPlaceholderText("e.g. JNUH"), { target: { value: "JNUH" } });
    fireEvent.click(screen.getByRole("button", { name: "Register hospital" }));

    await waitFor(() => {
      expect(apiMocks.createAdminSite).toHaveBeenCalledWith(
        "test-token",
        expect.objectContaining({
          project_id: "project_default",
          site_code: "39100103",
          display_name: "JNUH",
          hospital_name: "Jeju National University Hospital",
          source_institution_id: "39100103",
          research_registry_enabled: true,
        }),
      );
    });
    await waitFor(() => {
      expect(onRefreshSites).toHaveBeenCalledTimes(1);
      expect(onSelectSite).toHaveBeenCalledWith("SITE_B");
    });
    expect(await screen.findByText("Registered Hospital B.")).toBeInTheDocument();
  });

  it("hides smoke test hospitals from the linked site rail", async () => {
    render(
      <LocaleProvider>
        <AdminWorkspace
          token="test-token"
          user={{
            user_id: "user_admin",
            username: "admin",
            full_name: "Admin User",
            role: "admin",
            site_ids: ["SITE_A", "smoke-site"],
            approval_status: "approved",
          }}
          sites={[
            {
              site_id: "SITE_A",
              display_name: "Site A",
              hospital_name: "Hospital A",
            },
            {
              site_id: "smoke-site",
              display_name: "Smoke Site",
              hospital_name: "Smoke Hospital",
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
          onSelectSite={vi.fn()}
          onOpenCanvas={vi.fn()}
          onLogout={vi.fn()}
          onRefreshSites={vi.fn(async () => undefined)}
          onSiteDataChanged={vi.fn(async () => undefined)}
          onToggleTheme={vi.fn()}
        />
      </LocaleProvider>
    );

    expect(await screen.findByText("1 linked")).toBeInTheDocument();
    expect(screen.queryByText("Smoke Hospital")).not.toBeInTheDocument();
  });

  it("searches HIRA institutions in management and prefills a new hospital mapping", async () => {
    const onSelectSite = vi.fn();
    const onRefreshSites = vi.fn(async () => undefined);
    apiMocks.searchPublicInstitutions.mockResolvedValue([
      {
        institution_id: "39100103",
        source: "hira",
        name: "Jeju National University Hospital",
        institution_type_code: "11",
        institution_type_name: "Tertiary hospital",
        address: "Jeju Special Self-Governing Province",
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

    expect(screen.queryByLabelText("HIRA site ID")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Official hospital name")).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "Select this hospital" }));

    await waitFor(() => {
      expect(hiraSearch).toHaveValue("");
    });
    expect(screen.queryByRole("button", { name: "Select this hospital" })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g. JNUH")).toHaveValue("");
    expect(screen.getAllByText("Jeju National University Hospital").length).toBeGreaterThan(0);
    expect(screen.getByText(/Jeju National University Hospital - HIRA 39100103 - Jeju Special Self-Governing Province/i)).toBeInTheDocument();
    expect(screen.getByText(/Linked HIRA institution/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Register hospital" }));

    await waitFor(() => {
        expect(apiMocks.createAdminSite).toHaveBeenCalledWith(
        "test-token",
        expect.objectContaining({
          project_id: "project_default",
          site_code: "39100103",
          display_name: "Jeju National University Hospital",
          hospital_name: "Jeju National University Hospital",
          source_institution_id: "39100103",
          research_registry_enabled: true,
        }),
      );
    });
  });

  it("shows detailed registry guidance in the hospital registration form", async () => {
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
          onSelectSite={vi.fn()}
          onOpenCanvas={vi.fn()}
          onLogout={vi.fn()}
          onRefreshSites={vi.fn(async () => undefined)}
          onSiteDataChanged={vi.fn(async () => undefined)}
          onToggleTheme={vi.fn()}
        />
      </LocaleProvider>
    );

    expect(await screen.findByText("Enable research registry for this hospital")).toBeInTheDocument();
    expect(
      screen.getByText("This is not a patient consent form. It is the registry explanation shown to K-ERA researchers and institution users at this hospital.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("The central registry stores case_reference_id instead of raw patient identifiers.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Each case can still be reviewed later as Included or Excluded and opted out individually when needed.")
    ).toBeInTheDocument();
  });

  it("hides opaque source institution ids in hospital management", async () => {
    apiMocks.fetchAdminSites.mockResolvedValue([
      {
        site_id: "39100103",
        project_id: "project_default",
        display_name: "JNUH",
        hospital_name: "Jeju National University Hospital",
        source_institution_id: "JDQ4MTYyMiM4MSMkMSMkOCMkODkkMzgxMzUxIzExIyQxIyQzIyQ4OSQyNjE0ODEjNTEjJDEjJDYjJDgz",
        source_institution_name: "Jeju National University Hospital",
        source_institution_address: "Jeju Special Self-Governing Province",
        local_storage_root: "C:\\KERA\\39100103",
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
            site_ids: ["39100103"],
            approval_status: "approved",
          }}
          sites={[
            {
              site_id: "39100103",
              display_name: "JNUH",
              hospital_name: "Jeju National University Hospital",
            },
          ]}
          selectedSiteId="39100103"
          summary={{
            site_id: "39100103",
            n_patients: 0,
            n_visits: 0,
            n_images: 0,
            n_active_visits: 0,
            n_validation_runs: 0,
            latest_validation: null,
          }}
          theme="light"
          initialSection="management"
          onSelectSite={vi.fn()}
          onOpenCanvas={vi.fn()}
          onLogout={vi.fn()}
          onRefreshSites={vi.fn(async () => undefined)}
          onSiteDataChanged={vi.fn(async () => undefined)}
          onToggleTheme={vi.fn()}
        />
      </LocaleProvider>
    );

    expect(await screen.findByText("39100103")).toBeInTheDocument();
    fireEvent.click(screen.getByText("JNUH"));
    expect(await screen.findByText(/HIRA 39100103/)).toBeInTheDocument();
    expect(screen.queryByText("JDQ4MTYyMiM4MSMkMSMkOCMkODkkMzgxMzUxIzExIyQxIyQzIyQ4OSQyNjE0ODEjNTEjJDEjJDYjJDgz")).not.toBeInTheDocument();
  });

  it("explains when a hospital storage root is pinned away from the active default root", async () => {
    apiMocks.fetchStorageSettings.mockResolvedValue({
      storage_root: "D:\\ActiveRoot",
      default_storage_root: "C:\\KERA\\sites",
      effective_default_storage_root: "D:\\EnvDefault",
      storage_root_source: "custom",
      uses_custom_root: true,
    });
    apiMocks.fetchAdminSites.mockResolvedValue([
      {
        site_id: "SITE_A",
        project_id: "project_default",
        display_name: "Site A",
        hospital_name: "Hospital A",
        local_storage_root: "C:\\KERA\\sites\\SITE_A",
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
            n_patients: 22,
            n_visits: 43,
            n_images: 112,
            n_active_visits: 0,
            n_validation_runs: 0,
            latest_validation: null,
          }}
          theme="light"
          initialSection="management"
          onSelectSite={vi.fn()}
          onOpenCanvas={vi.fn()}
          onLogout={vi.fn()}
          onRefreshSites={vi.fn(async () => undefined)}
          onSiteDataChanged={vi.fn(async () => undefined)}
          onToggleTheme={vi.fn()}
        />
      </LocaleProvider>
    );

    expect(await screen.findByText("This hospital is pinned to its own storage root, so it does not currently follow the active default root.")).toBeInTheDocument();
    expect(screen.getByText("D:\\ActiveRoot\\SITE_A")).toBeInTheDocument();
    expect(screen.getByText("22/43/112")).toBeInTheDocument();
  });

  it("separates the built-in fallback root from an environment-provided default root", async () => {
    apiMocks.fetchStorageSettings.mockResolvedValue({
      storage_root: "D:\\EnvDefault",
      default_storage_root: "C:\\InstallParent\\KERA_DATA\\sites",
      effective_default_storage_root: "D:\\EnvDefault",
      storage_root_source: "environment_default",
      uses_custom_root: false,
    });

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
          onSelectSite={vi.fn()}
          onOpenCanvas={vi.fn()}
          onLogout={vi.fn()}
          onRefreshSites={vi.fn(async () => undefined)}
          onSiteDataChanged={vi.fn(async () => undefined)}
          onToggleTheme={vi.fn()}
        />
      </LocaleProvider>
    );

    expect(await screen.findByText("Environment")).toBeInTheDocument();
    expect(screen.getByText("C:\\InstallParent\\KERA_DATA\\sites")).toBeInTheDocument();
    expect(screen.getAllByText("D:\\EnvDefault").length).toBeGreaterThan(0);
    expect(
      screen.getByText("This node is using an environment-provided default root. The built-in fallback is the install-relative location shown separately above.")
    ).toBeInTheDocument();
  });

  it("explains that the default storage root is the parent directory for per-site folders", async () => {
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
          onSelectSite={vi.fn()}
          onOpenCanvas={vi.fn()}
          onLogout={vi.fn()}
          onRefreshSites={vi.fn(async () => undefined)}
          onSiteDataChanged={vi.fn(async () => undefined)}
          onToggleTheme={vi.fn()}
        />
      </LocaleProvider>
    );

    await screen.findByRole("button", { name: "Register hospital" });
    const folderInputs = await screen.findAllByLabelText("Folder path");
    expect(folderInputs[0]).toHaveAttribute("placeholder", "D:\\KERA_DATA\\sites");
    expect(screen.getByText("Enter the parent folder that will contain per-site subfolders.")).toBeInTheDocument();
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

  it("shows recent auto-approved researcher access in the requests section", async () => {
    apiMocks.fetchAccessRequests.mockImplementation((_token, statusFilter = "pending") =>
      Promise.resolve(
        statusFilter === "approved"
          ? [
              {
                request_id: "access_auto_1",
                user_id: "user_researcher",
                email: "researcher@example.com",
                requested_site_id: "SITE_A",
                requested_site_label: "Site A",
                requested_site_source: "site",
                resolved_site_id: "SITE_A",
                resolved_site_label: "Site A",
                requested_role: "researcher",
                message: "Immediate access",
                status: "approved",
                reviewed_by: null,
                reviewer_notes: "Automatically approved researcher access request.",
                created_at: "2026-03-17T00:00:00Z",
                reviewed_at: "2026-03-17T00:01:00Z",
              },
            ]
          : [],
      ),
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

    expect(await screen.findByText("Recent auto-approved researcher access")).toBeInTheDocument();
    expect(screen.getByText("researcher@example.com")).toBeInTheDocument();
    expect(screen.getByText("Immediate access")).toBeInTheDocument();
  });

  it("keeps a rejected request removed even if the follow-up refresh fails", async () => {
    apiMocks.fetchAdminOverview
      .mockResolvedValueOnce({
        site_count: 1,
        model_version_count: 1,
        pending_access_requests: 1,
        pending_model_updates: 0,
        current_model_version: "global-http-seed",
        aggregation_count: 0,
      })
      .mockRejectedValueOnce(new Error("overview refresh failed"));
    apiMocks.fetchAccessRequests.mockImplementation((_token, statusFilter = "pending") =>
      Promise.resolve(
        statusFilter === "approved"
          ? []
          : [
              {
                request_id: "access_1",
                user_id: "user_researcher",
                email: "people.at.korea@gmail.com",
                requested_site_id: "SITE_A",
                requested_site_label: "Jeju National University Hospital",
                requested_site_source: "site",
                resolved_site_id: "SITE_A",
                resolved_site_label: "JNUH",
                requested_role: "researcher",
                message: "",
                status: "pending",
                reviewed_by: null,
                reviewer_notes: "",
                created_at: "2026-03-17T00:57:00Z",
                reviewed_at: null,
              },
            ],
      ),
    );
    apiMocks.reviewAccessRequest.mockResolvedValueOnce({
      request: {
        request_id: "access_1",
        user_id: "user_researcher",
        email: "people.at.korea@gmail.com",
        requested_site_id: "SITE_A",
        requested_site_label: "Jeju National University Hospital",
        requested_site_source: "site",
        resolved_site_id: "SITE_A",
        resolved_site_label: "JNUH",
        requested_role: "researcher",
        message: "",
        status: "rejected",
        reviewed_by: "user_admin",
        reviewer_notes: "",
        created_at: "2026-03-17T00:57:00Z",
        reviewed_at: "2026-03-17T00:58:00Z",
      },
      created_site: null,
    });

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

    expect(await screen.findByText("people.at.korea@gmail.com")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));

    await waitFor(() => {
      expect(apiMocks.reviewAccessRequest).toHaveBeenCalledWith(
        "access_1",
        "test-token",
        expect.objectContaining({
          decision: "rejected",
          assigned_role: "researcher",
          assigned_site_id: "SITE_A",
        }),
      );
    });

    await waitFor(() => {
      expect(screen.queryByText("people.at.korea@gmail.com")).not.toBeInTheDocument();
      expect(screen.getByText("Request rejected.")).toBeInTheDocument();
    });
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

    fireEvent.click(screen.getByRole("button", { name: "Recent alerts" }));

    const alertsDialog = await screen.findByRole("dialog", { name: "Recent alerts" });
    expect(within(alertsDialog).getByText("Transient toasts stay here for this session.")).toBeInTheDocument();
    expect(within(alertsDialog).getByText("Registered global-vit-2026.")).toBeInTheDocument();

    fireEvent.click(within(alertsDialog).getByRole("button", { name: "Clear alerts" }));

    await waitFor(() => {
      expect(within(alertsDialog).getByText("No alerts yet in this session.")).toBeInTheDocument();
    });
  }, 8000);
});
