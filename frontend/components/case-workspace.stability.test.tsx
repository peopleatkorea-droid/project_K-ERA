import React from "react";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../lib/i18n";
import { CaseWorkspace } from "./case-workspace";

const apiMocks = vi.hoisted(() => ({
  fetchCases: vi.fn(),
  fetchPatientListPage: vi.fn(),
  fetchSiteActivity: vi.fn(),
  fetchSiteValidations: vi.fn(),
  fetchSiteModelVersions: vi.fn(),
  fetchVisits: vi.fn(),
  fetchImages: vi.fn(),
  fetchImageBlob: vi.fn(),
  fetchImagePreviewBatch: vi.fn(),
  fetchImagePreviewBlob: vi.fn(),
  fetchCaseHistory: vi.fn(),
  fetchStoredCaseLesionPreview: vi.fn(),
}));

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    fetchCases: apiMocks.fetchCases,
    fetchPatientListPage: apiMocks.fetchPatientListPage,
    fetchSiteActivity: apiMocks.fetchSiteActivity,
    fetchSiteValidations: apiMocks.fetchSiteValidations,
    fetchSiteModelVersions: apiMocks.fetchSiteModelVersions,
    fetchVisits: apiMocks.fetchVisits,
    fetchImages: apiMocks.fetchImages,
    fetchImageBlob: apiMocks.fetchImageBlob,
    fetchImagePreviewBatch: apiMocks.fetchImagePreviewBatch,
    fetchImagePreviewBlob: apiMocks.fetchImagePreviewBlob,
    fetchCaseHistory: apiMocks.fetchCaseHistory,
    fetchStoredCaseLesionPreview: apiMocks.fetchStoredCaseLesionPreview,
  };
});

class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("CaseWorkspace stability", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
    vi.stubGlobal("scrollTo", vi.fn());
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    URL.createObjectURL = vi.fn(() => "blob:preview-url");
    URL.revokeObjectURL = vi.fn();

    apiMocks.fetchCases.mockResolvedValue([
      {
        case_id: "case_1",
        patient_id: "KERA-2026-001",
        chart_alias: "",
        local_case_code: "",
        culture_category: "bacterial",
        culture_species: "Staphylococcus aureus",
        additional_organisms: [],
        visit_date: "Initial",
        actual_visit_date: null,
        created_by_user_id: "user_admin",
        created_at: "2026-03-15T00:00:00Z",
        latest_image_uploaded_at: "2026-03-15T00:00:00Z",
        image_count: 1,
        representative_image_id: "image_1",
        representative_view: "white",
        age: 65,
        sex: "female",
        visit_status: "active",
        is_initial_visit: true,
        smear_result: "not done",
        polymicrobial: false,
      },
    ]);
    apiMocks.fetchPatientListPage.mockResolvedValue({
      items: [
        {
          patient_id: "KERA-2026-001",
          latest_case: {
            case_id: "case_1",
            patient_id: "KERA-2026-001",
            chart_alias: "",
            local_case_code: "",
            culture_category: "bacterial",
            culture_species: "Staphylococcus aureus",
            additional_organisms: [],
            visit_date: "Initial",
            actual_visit_date: null,
            created_by_user_id: "user_admin",
            created_at: "2026-03-15T00:00:00Z",
            latest_image_uploaded_at: "2026-03-15T00:00:00Z",
            image_count: 1,
            representative_image_id: "image_1",
            representative_view: "white",
            age: 65,
            sex: "female",
            visit_status: "active",
            is_initial_visit: true,
            smear_result: "not done",
            polymicrobial: false,
          },
          case_count: 1,
          organism_summary: "Staphylococcus aureus",
          representative_thumbnails: [
            {
              case_id: "case_1",
              image_id: "image_1",
              view: "white",
              preview_url: null,
            },
          ],
        },
      ],
      page: 1,
      page_size: 25,
      total_count: 1,
      total_pages: 1,
    });
    apiMocks.fetchSiteActivity.mockResolvedValue({
      totals: {
        patients: 1,
        visits: 1,
        images: 1,
      },
      pending_updates: 0,
      recent_cases: [],
      recent_validations: [],
      recent_contributions: [],
    });
    apiMocks.fetchSiteValidations.mockResolvedValue([]);
    apiMocks.fetchSiteModelVersions.mockResolvedValue([]);
    apiMocks.fetchVisits.mockResolvedValue([]);
    apiMocks.fetchImages.mockResolvedValue([
      {
        image_id: "image_1",
        patient_id: "KERA-2026-001",
        visit_date: "Initial",
        image_path: "C:\\KERA\\image_1.png",
        view: "white",
        is_representative: true,
        lesion_prompt_box: null,
      },
    ]);
    apiMocks.fetchImageBlob.mockResolvedValue(new Blob(["image"], { type: "image/png" }));
    apiMocks.fetchImagePreviewBatch.mockImplementation(async (_siteId, _token, options: { imageIds: string[]; maxSide?: number }) => ({
      max_side: options.maxSide ?? 512,
      requested_count: options.imageIds.length,
      ready_count: options.imageIds.length,
      items: options.imageIds.map((imageId) => ({
        image_id: imageId,
        max_side: options.maxSide ?? 512,
        ready: true,
        cache_status: "generated" as const,
        preview_url: `/api/sites/SITE_A/images/${imageId}/preview`,
        error: null,
      })),
    }));
    apiMocks.fetchImagePreviewBlob.mockResolvedValue(new Blob(["image"], { type: "image/jpeg" }));
    apiMocks.fetchCaseHistory.mockResolvedValue({
      validations: [],
      contributions: [],
    });
    apiMocks.fetchStoredCaseLesionPreview.mockResolvedValue([]);
  });

  it("loads the selected case once without triggering a maximum update depth loop", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <LocaleProvider>
        <CaseWorkspace
          token="test-token"
          user={{
            user_id: "user_admin",
            username: "admin",
            full_name: "Admin",
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
            n_patients: 1,
            n_visits: 1,
            n_images: 1,
            n_active_visits: 1,
            n_validation_runs: 0,
            latest_validation: null,
          }}
          canOpenOperations
          theme="light"
          onSelectSite={vi.fn()}
          onExportManifest={vi.fn()}
          onLogout={vi.fn()}
          onOpenOperations={vi.fn()}
          onSiteDataChanged={vi.fn(async () => undefined)}
          onToggleTheme={vi.fn()}
        />
      </LocaleProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /KERA-2026-001/i }));

    await waitFor(() => {
      expect(apiMocks.fetchCaseHistory).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    });

    expect(apiMocks.fetchCaseHistory).toHaveBeenCalledTimes(1);
    expect(
      consoleErrorSpy.mock.calls.some((call) =>
        call.some((arg) => String(arg).includes("Maximum update depth exceeded")),
      ),
    ).toBe(false);

    consoleErrorSpy.mockRestore();
  });

  it("fetches patient images once when opening a saved case", async () => {
    render(
      <LocaleProvider>
        <CaseWorkspace
          token="test-token"
          user={{
            user_id: "user_admin",
            username: "admin",
            full_name: "Admin",
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
            n_patients: 1,
            n_visits: 1,
            n_images: 1,
            n_active_visits: 1,
            n_validation_runs: 0,
            latest_validation: null,
          }}
          canOpenOperations
          theme="light"
          onSelectSite={vi.fn()}
          onExportManifest={vi.fn()}
          onLogout={vi.fn()}
          onOpenOperations={vi.fn()}
          onSiteDataChanged={vi.fn(async () => undefined)}
          onToggleTheme={vi.fn()}
        />
      </LocaleProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /KERA-2026-001/i }));

    await waitFor(() => {
      expect(apiMocks.fetchImages).toHaveBeenCalledTimes(1);
    });
    expect(apiMocks.fetchImages).toHaveBeenCalledWith(
      "SITE_A",
      "test-token",
      "KERA-2026-001",
      "Initial",
      expect.any(AbortSignal),
    );
    await waitFor(() => {
      expect(apiMocks.fetchImagePreviewBatch).toHaveBeenCalledWith(
        "SITE_A",
        "test-token",
        expect.objectContaining({ imageIds: ["image_1"], maxSide: 640, signal: expect.any(AbortSignal) }),
      );
      expect(apiMocks.fetchImagePreviewBlob).toHaveBeenCalledWith(
        "SITE_A",
        "image_1",
        "test-token",
        expect.objectContaining({ maxSide: 640 }),
      );
    });
  });
});
