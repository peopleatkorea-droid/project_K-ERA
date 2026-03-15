import React from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";

import { LocaleProvider } from "../lib/i18n";
import { CaseWorkspace } from "./case-workspace";

const apiMocks = vi.hoisted(() => ({
  createPatient: vi.fn(),
  createVisit: vi.fn(),
  updateVisit: vi.fn(),
  deleteVisitImages: vi.fn(),
  uploadImage: vi.fn(),
  updateImageLesionBox: vi.fn(),
  fetchCases: vi.fn(),
  fetchSiteActivity: vi.fn(),
  fetchSiteValidations: vi.fn(),
  fetchSiteModelVersions: vi.fn(),
  fetchVisits: vi.fn(),
  fetchImages: vi.fn(),
  fetchImageBlob: vi.fn(),
  fetchCaseHistory: vi.fn(),
}));

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    createPatient: apiMocks.createPatient,
    createVisit: apiMocks.createVisit,
    updateVisit: apiMocks.updateVisit,
    deleteVisitImages: apiMocks.deleteVisitImages,
    uploadImage: apiMocks.uploadImage,
    updateImageLesionBox: apiMocks.updateImageLesionBox,
    fetchCases: apiMocks.fetchCases,
    fetchSiteActivity: apiMocks.fetchSiteActivity,
    fetchSiteValidations: apiMocks.fetchSiteValidations,
    fetchSiteModelVersions: apiMocks.fetchSiteModelVersions,
    fetchVisits: apiMocks.fetchVisits,
    fetchImages: apiMocks.fetchImages,
    fetchImageBlob: apiMocks.fetchImageBlob,
    fetchCaseHistory: apiMocks.fetchCaseHistory,
  };
});

describe("CaseWorkspace integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.stubGlobal("confirm", vi.fn(() => true));
    vi.stubGlobal("scrollTo", vi.fn());
    URL.createObjectURL = vi.fn(() => "blob:preview-url");
    URL.revokeObjectURL = vi.fn();

    apiMocks.createPatient.mockResolvedValue({
      patient_id: "KERA-2026-001",
    });
    apiMocks.createVisit.mockResolvedValue({
      patient_id: "KERA-2026-001",
      visit_date: "Initial",
    });
    apiMocks.updateVisit.mockResolvedValue({
      patient_id: "KERA-2026-001",
      visit_date: "Initial",
    });
    apiMocks.deleteVisitImages.mockResolvedValue(undefined);
    apiMocks.uploadImage.mockResolvedValue({
      image_id: "image_1",
      patient_id: "KERA-2026-001",
      visit_date: "initial",
      view: "white",
      is_representative: true,
    });
    apiMocks.updateImageLesionBox.mockResolvedValue({});
    apiMocks.fetchCases
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          case_id: "case_1",
          patient_id: "KERA-2026-001",
          chart_alias: "",
          culture_category: "bacterial",
          culture_species: "Staphylococcus aureus",
          additional_organisms: [],
          visit_date: "Initial",
          actual_visit_date: null,
          created_by_user_id: "user_researcher",
          created_at: "2026-03-15T00:00:00Z",
          image_count: 1,
          representative_image_id: "image_1",
          age: 0,
          sex: "female",
          visit_status: "active",
        },
      ]);
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
    apiMocks.fetchVisits.mockResolvedValue([
      {
        patient_id: "KERA-2026-001",
        visit_date: "Initial",
        actual_visit_date: null,
        culture_category: "bacterial",
        culture_species: "Staphylococcus aureus",
        additional_organisms: [],
        contact_lens_use: "none",
        predisposing_factor: [],
        other_history: "",
        visit_status: "active",
        is_initial_visit: true,
        polymicrobial: false,
      },
    ]);
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
    apiMocks.fetchCaseHistory.mockResolvedValue({
      validations: [],
      contributions: [],
    });
  });

  function seedDraft() {
    window.localStorage.setItem(
      "kera_workspace_draft:user_researcher:SITE_A",
      JSON.stringify({
        draft: {
          patient_id: "KERA-2026-001",
          chart_alias: "",
          local_case_code: "",
          sex: "female",
          age: "",
          actual_visit_date: "",
          follow_up_number: "1",
          culture_category: "bacterial",
          culture_species: "Staphylococcus aureus",
          additional_organisms: [],
          contact_lens_use: "none",
          visit_status: "active",
          is_initial_visit: true,
          predisposing_factor: [],
          other_history: "",
          intake_completed: false,
        },
        updated_at: "2026-03-15T00:00:00Z",
      })
    );
  }

  function renderWorkspace(onSiteDataChanged = vi.fn(async () => undefined)) {
    return render(
      <LocaleProvider>
        <CaseWorkspace
          token="test-token"
          user={{
            user_id: "user_researcher",
            username: "researcher",
            full_name: "Researcher",
            role: "researcher",
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
          canOpenOperations
          theme="light"
          onSelectSite={vi.fn()}
          onExportManifest={vi.fn()}
          onLogout={vi.fn()}
          onOpenOperations={vi.fn()}
          onSiteDataChanged={onSiteDataChanged}
          onToggleTheme={vi.fn()}
        />
      </LocaleProvider>
    );
  }

  async function addDraftImage(container: HTMLElement) {
    const file = new File(["white-image"], "slit.png", { type: "image/png" });
    const fileInputs = container.querySelectorAll('input[type="file"]');
    fireEvent.change(fileInputs[0] as HTMLInputElement, {
      target: { files: [file] },
    });
    return file;
  }

  it("completes intake, uploads an image, and saves a new case", async () => {
    const onSiteDataChanged = vi.fn(async () => undefined);
    seedDraft();
    const { container } = renderWorkspace(onSiteDataChanged);

    await waitFor(() => {
      expect(apiMocks.fetchCases).toHaveBeenCalledWith("SITE_A", "test-token", { mine: false });
    });

    fireEvent.click(screen.getByRole("button", { name: "Complete" }));

    const file = await addDraftImage(container);

    fireEvent.click(screen.getByRole("button", { name: "Save case to hospital" }));

    await waitFor(() => {
      expect(apiMocks.createPatient).toHaveBeenCalledWith("SITE_A", "test-token", {
        patient_id: "KERA-2026-001",
        sex: "female",
        age: 0,
        chart_alias: "",
        local_case_code: "",
      });
      expect(apiMocks.createVisit).toHaveBeenCalled();
      expect(apiMocks.uploadImage).toHaveBeenCalledWith("SITE_A", "test-token", {
        patient_id: "KERA-2026-001",
        visit_date: "Initial",
        view: "white",
        is_representative: true,
        file,
      });
    });
    await waitFor(() => {
      expect(onSiteDataChanged).toHaveBeenCalledWith("SITE_A");
    });
    expect(await screen.findByText("Case KERA-2026-001 / Initial saved to hospital SITE_A.")).toBeInTheDocument();
  });

  it("overwrites an existing visit when the user confirms overwrite", async () => {
    seedDraft();
    const confirmMock = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmMock);
    apiMocks.createVisit.mockRejectedValueOnce(new Error("Visit KERA-2026-001 / Initial already exists."));

    const { container } = renderWorkspace();
    await screen.findByRole("button", { name: "Complete" });
    fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    await addDraftImage(container);
    fireEvent.click(screen.getByRole("button", { name: "Save case to hospital" }));

    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalledTimes(1);
      expect(apiMocks.updateVisit).toHaveBeenCalledWith(
        "SITE_A",
        "test-token",
        "KERA-2026-001",
        "Initial",
        expect.objectContaining({ visit_date: "Initial" })
      );
      expect(apiMocks.deleteVisitImages).toHaveBeenCalledWith("SITE_A", "test-token", "KERA-2026-001", "Initial");
    });
  });

  it("creates an alternate follow-up visit when overwrite is declined", async () => {
    seedDraft();
    const confirmMock = vi.fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    vi.stubGlobal("confirm", confirmMock);
    apiMocks.createVisit
      .mockRejectedValueOnce(new Error("Visit KERA-2026-001 / Initial already exists."))
      .mockResolvedValueOnce({
        patient_id: "KERA-2026-001",
        visit_date: "F/U-03",
      });
    apiMocks.fetchVisits.mockResolvedValue([
      {
        patient_id: "KERA-2026-001",
        visit_date: "Initial",
        actual_visit_date: null,
        culture_category: "bacterial",
        culture_species: "Staphylococcus aureus",
        additional_organisms: [],
        contact_lens_use: "none",
        predisposing_factor: [],
        other_history: "",
        visit_status: "active",
        is_initial_visit: true,
        polymicrobial: false,
      },
      {
        patient_id: "KERA-2026-001",
        visit_date: "F/U-01",
        actual_visit_date: null,
        culture_category: "bacterial",
        culture_species: "Staphylococcus aureus",
        additional_organisms: [],
        contact_lens_use: "none",
        predisposing_factor: [],
        other_history: "",
        visit_status: "active",
        is_initial_visit: false,
        polymicrobial: false,
      },
      {
        patient_id: "KERA-2026-001",
        visit_date: "F/U-02",
        actual_visit_date: null,
        culture_category: "bacterial",
        culture_species: "Staphylococcus aureus",
        additional_organisms: [],
        contact_lens_use: "none",
        predisposing_factor: [],
        other_history: "",
        visit_status: "active",
        is_initial_visit: false,
        polymicrobial: false,
      },
    ]);

    const { container } = renderWorkspace();
    await screen.findByRole("button", { name: "Complete" });
    fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    await addDraftImage(container);
    fireEvent.click(screen.getByRole("button", { name: "Save case to hospital" }));

    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalledTimes(2);
      expect(apiMocks.createVisit).toHaveBeenLastCalledWith(
        "SITE_A",
        "test-token",
        expect.objectContaining({ visit_date: "F/U-03" })
      );
      expect(apiMocks.uploadImage).toHaveBeenLastCalledWith(
        "SITE_A",
        "test-token",
        expect.objectContaining({ visit_date: "F/U-03" })
      );
    });
  });
});
