import React from "react";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  fetchPatientListPage: vi.fn(),
  fetchSiteActivity: vi.fn(),
  fetchSiteValidations: vi.fn(),
  fetchSiteModelVersions: vi.fn(),
  fetchVisits: vi.fn(),
  fetchImages: vi.fn(),
  fetchImageBlob: vi.fn(),
  fetchImagePreviewBlob: vi.fn(),
  fetchCaseHistory: vi.fn(),
  fetchStoredCaseLesionPreview: vi.fn(),
  runCaseValidation: vi.fn(),
  runCaseValidationCompare: vi.fn(),
  runCaseContribution: vi.fn(),
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
    fetchPatientListPage: apiMocks.fetchPatientListPage,
    fetchSiteActivity: apiMocks.fetchSiteActivity,
    fetchSiteValidations: apiMocks.fetchSiteValidations,
    fetchSiteModelVersions: apiMocks.fetchSiteModelVersions,
    fetchVisits: apiMocks.fetchVisits,
    fetchImages: apiMocks.fetchImages,
    fetchImageBlob: apiMocks.fetchImageBlob,
    fetchImagePreviewBlob: apiMocks.fetchImagePreviewBlob,
    fetchCaseHistory: apiMocks.fetchCaseHistory,
    fetchStoredCaseLesionPreview: apiMocks.fetchStoredCaseLesionPreview,
    runCaseValidation: apiMocks.runCaseValidation,
    runCaseValidationCompare: apiMocks.runCaseValidationCompare,
    runCaseContribution: apiMocks.runCaseContribution,
  };
});

describe("CaseWorkspace integration", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
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
    apiMocks.fetchPatientListPage.mockResolvedValue({
      items: [],
      page: 1,
      page_size: 25,
      total_count: 0,
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
    apiMocks.fetchImagePreviewBlob.mockResolvedValue(new Blob(["image"], { type: "image/jpeg" }));
    apiMocks.fetchCaseHistory.mockResolvedValue({
      validations: [],
      contributions: [],
    });
    apiMocks.fetchStoredCaseLesionPreview.mockResolvedValue([]);
    apiMocks.runCaseValidation.mockResolvedValue({
      summary: {
        validation_id: "validation_1",
        patient_id: "KERA-2026-001",
        visit_date: "Initial",
        predicted_label: "fungal",
        true_label: "bacterial",
        prediction_probability: 0.82,
        is_correct: false,
      },
      case_prediction: null,
      model_version: {
        version_id: "model_convnext",
        version_name: "global-convnext",
        architecture: "convnext_tiny",
        requires_medsam_crop: true,
        crop_mode: "automated",
        ensemble_mode: null,
      },
      execution_device: "cpu",
      artifact_availability: {
        gradcam: false,
        roi_crop: false,
        medsam_mask: false,
        lesion_crop: false,
        lesion_mask: false,
      },
    });
    apiMocks.runCaseValidationCompare.mockResolvedValue({
      patient_id: "KERA-2026-001",
      visit_date: "Initial",
      execution_device: "cpu",
      comparisons: [],
    });
    apiMocks.runCaseContribution.mockResolvedValue({
      update: {
        update_id: "update_1",
        site_id: "SITE_A",
        base_model_version_id: "model_vit",
        architecture: "vit",
        upload_type: "weight delta",
        execution_device: "cpu",
        artifact_path: "C:\\KERA\\delta_1.pth",
        n_cases: 1,
        contributed_by: "user_researcher",
        case_reference_id: "case_ref_1",
        created_at: "2026-03-15T00:00:00Z",
        training_input_policy: "medsam_cornea_crop_only",
        training_summary: {},
        status: "pending_review",
      },
      updates: [
        {
          update_id: "update_1",
          site_id: "SITE_A",
          base_model_version_id: "model_vit",
          architecture: "vit",
          upload_type: "weight delta",
          execution_device: "cpu",
          artifact_path: "C:\\KERA\\delta_1.pth",
          n_cases: 1,
          contributed_by: "user_researcher",
          case_reference_id: "case_ref_1",
          created_at: "2026-03-15T00:00:00Z",
          training_input_policy: "medsam_cornea_crop_only",
          training_summary: {},
          status: "pending_review",
          crop_mode: "automated",
        },
      ],
      update_count: 1,
      visit_status: "active",
      execution_device: "cpu",
      model_version: {
        version_id: "model_vit",
        version_name: "vit-v1",
        architecture: "vit",
      },
      model_versions: [
        {
          version_id: "model_vit",
          version_name: "vit-v1",
          architecture: "vit",
          crop_mode: "automated",
          ensemble_mode: null,
        },
      ],
      failures: [],
      stats: {
        total_contributions: 1,
        user_contributions: 1,
        user_contribution_pct: 100,
        current_model_version: "global-http-seed",
      },
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

  it("keeps startup recovery toasts in the recent alerts card", async () => {
    seedDraft();
    renderWorkspace();

    expect(await screen.findByText("Recent alerts")).toBeInTheDocument();
    expect(
      (
        await screen.findAllByText(
          "Recovered the last saved draft properties for this hospital. Re-attach image files before saving."
        )
      ).length
    ).toBeGreaterThan(0);
  });

  it("highlights selected predisposing factors and mirrors them in the authoring rail", async () => {
    seedDraft();
    renderWorkspace();

    expect(await screen.findByText("No predisposing factor selected yet.")).toBeInTheDocument();

    const traumaButton = screen.getByRole("button", { name: "trauma" });
    expect(traumaButton.className).not.toContain("border-amber-300/70");

    fireEvent.click(traumaButton);

    await waitFor(() => {
      expect(traumaButton.className).toContain("border-amber-300/70");
    });
    expect(screen.queryByText("No predisposing factor selected yet.")).not.toBeInTheDocument();
    expect(screen.getAllByText("trauma").length).toBeGreaterThan(1);
  });

  it("completes intake, uploads an image, and saves a new case", async () => {
    const onSiteDataChanged = vi.fn(async () => undefined);
    seedDraft();
    const { container } = renderWorkspace(onSiteDataChanged);

    await waitFor(() => {
      expect(apiMocks.fetchCases).toHaveBeenCalledWith(
        "SITE_A",
        "test-token",
        expect.objectContaining({ mine: false, signal: expect.any(AbortSignal) }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Lock intake" }));

    const file = await addDraftImage(container);

    fireEvent.click(screen.getByRole("button", { name: "Save to hospital" }));

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
    expect((await screen.findAllByText("Case KERA-2026-001 / Initial saved to Hospital A.")).length).toBeGreaterThan(0);
  });

  it("overwrites an existing visit when the user confirms overwrite", async () => {
    seedDraft();
    const confirmMock = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmMock);
    apiMocks.createVisit.mockRejectedValueOnce(new Error("Visit KERA-2026-001 / Initial already exists."));

    const { container } = renderWorkspace();
    await screen.findByRole("button", { name: "Lock intake" });
    fireEvent.click(screen.getByRole("button", { name: "Lock intake" }));
    await addDraftImage(container);
    fireEvent.click(screen.getByRole("button", { name: "Save to hospital" }));

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
        visit_date: "FU #3",
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
        visit_date: "FU #1",
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
        visit_date: "FU #2",
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
    await screen.findByRole("button", { name: "Lock intake" });
    fireEvent.click(screen.getByRole("button", { name: "Lock intake" }));
    await addDraftImage(container);
    fireEvent.click(screen.getByRole("button", { name: "Save to hospital" }));

    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalledTimes(2);
      expect(apiMocks.createVisit).toHaveBeenLastCalledWith(
        "SITE_A",
        "test-token",
        expect.objectContaining({ visit_date: "FU #3" })
      );
      expect(apiMocks.uploadImage).toHaveBeenLastCalledWith(
        "SITE_A",
        "test-token",
        expect.objectContaining({ visit_date: "FU #3" })
      );
    });
  });

  it("returns to the patient list when browser back is used from case review", async () => {
    apiMocks.fetchCases.mockReset();
    apiMocks.fetchCases.mockResolvedValue([
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

    renderWorkspace();

    expect(await screen.findByText("Case summary")).toBeInTheDocument();

    await act(async () => {
      window.history.back();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(await screen.findByText("Patient list")).toBeInTheDocument();
    expect(screen.getByText("Browse saved patients and open the latest case.")).toBeInTheDocument();
  });

  it("loads patient list pages with numbered pagination", async () => {
    apiMocks.fetchCases.mockReset();
    apiMocks.fetchCases.mockResolvedValue(
      Array.from({ length: 30 }, (_, index) => {
        const caseNumber = index + 1;
        const padded = String(caseNumber).padStart(3, "0");
        return {
          case_id: `case_${caseNumber}`,
          patient_id: `KERA-2026-${padded}`,
          chart_alias: "",
          local_case_code: "",
          culture_category: "bacterial",
          culture_species: caseNumber === 26 ? "Pseudomonas aeruginosa" : "Staphylococcus aureus",
          additional_organisms: [],
          visit_date: "Initial",
          actual_visit_date: null,
          created_by_user_id: "user_researcher",
          created_at: `2026-03-${String(Math.min(caseNumber, 28)).padStart(2, "0")}T00:00:00Z`,
          latest_image_uploaded_at: `2026-03-${String(Math.min(caseNumber, 28)).padStart(2, "0")}T00:00:00Z`,
          image_count: 1,
          representative_image_id: `image_${caseNumber}`,
          representative_view: "white",
          age: 60,
          sex: caseNumber % 2 === 0 ? "male" : "female",
          visit_status: "active",
          is_initial_visit: true,
          smear_result: "not done",
          polymicrobial: false,
        };
      }),
    );

    renderWorkspace();

    fireEvent.click(await screen.findByRole("button", { name: "List view" }));

    expect(await screen.findByText("Page 1 of 2")).toBeInTheDocument();
    expect(apiMocks.fetchPatientListPage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "2" }));

    expect(await screen.findByText("Page 2 of 2")).toBeInTheDocument();
  });

  it("auto-runs five-model analysis after AI validation", async () => {
    apiMocks.fetchCases.mockReset();
    apiMocks.fetchCases.mockResolvedValue([
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
    apiMocks.fetchSiteModelVersions.mockResolvedValue([
      { version_id: "model_vit", version_name: "vit-v1", architecture: "vit", ready: true },
      { version_id: "model_swin", version_name: "swin-v1", architecture: "swin", ready: true },
      { version_id: "model_convnext", version_name: "conv-v1", architecture: "convnext_tiny", ready: true },
      { version_id: "model_dense", version_name: "dense-v1", architecture: "densenet121", ready: true },
      { version_id: "model_eff", version_name: "eff-v1", architecture: "efficientnet_v2_s", ready: true },
    ]);
    apiMocks.runCaseValidationCompare.mockResolvedValue({
      patient_id: "KERA-2026-001",
      visit_date: "Initial",
      execution_device: "cpu",
      comparisons: [
        {
          summary: {
            validation_id: "cmp_1",
            patient_id: "KERA-2026-001",
            visit_date: "Initial",
            predicted_label: "fungal",
            true_label: "bacterial",
            prediction_probability: 0.81,
            is_correct: false,
          },
          model_version: { version_id: "model_vit", version_name: "vit-v1", architecture: "vit", crop_mode: "automated" },
          artifact_availability: { gradcam: false, roi_crop: false, medsam_mask: false, lesion_crop: false, lesion_mask: false },
        },
        {
          summary: {
            validation_id: "cmp_2",
            patient_id: "KERA-2026-001",
            visit_date: "Initial",
            predicted_label: "fungal",
            true_label: "bacterial",
            prediction_probability: 0.77,
            is_correct: false,
          },
          model_version: { version_id: "model_swin", version_name: "swin-v1", architecture: "swin", crop_mode: "automated" },
          artifact_availability: { gradcam: false, roi_crop: false, medsam_mask: false, lesion_crop: false, lesion_mask: false },
        },
        {
          summary: {
            validation_id: "cmp_3",
            patient_id: "KERA-2026-001",
            visit_date: "Initial",
            predicted_label: "fungal",
            true_label: "bacterial",
            prediction_probability: 0.79,
            is_correct: false,
          },
          model_version: { version_id: "model_convnext", version_name: "conv-v1", architecture: "convnext_tiny", crop_mode: "automated" },
          artifact_availability: { gradcam: false, roi_crop: false, medsam_mask: false, lesion_crop: false, lesion_mask: false },
        },
        {
          summary: {
            validation_id: "cmp_4",
            patient_id: "KERA-2026-001",
            visit_date: "Initial",
            predicted_label: "bacterial",
            true_label: "bacterial",
            prediction_probability: 0.41,
            is_correct: true,
          },
          model_version: { version_id: "model_dense", version_name: "dense-v1", architecture: "densenet121", crop_mode: "automated" },
          artifact_availability: { gradcam: false, roi_crop: false, medsam_mask: false, lesion_crop: false, lesion_mask: false },
        },
        {
          summary: {
            validation_id: "cmp_5",
            patient_id: "KERA-2026-001",
            visit_date: "Initial",
            predicted_label: "fungal",
            true_label: "bacterial",
            prediction_probability: 0.74,
            is_correct: false,
          },
          model_version: { version_id: "model_eff", version_name: "eff-v1", architecture: "efficientnet_v2_s", crop_mode: "automated" },
          artifact_availability: { gradcam: false, roi_crop: false, medsam_mask: false, lesion_crop: false, lesion_mask: false },
        },
      ],
    });

    renderWorkspace();

    await waitFor(() => {
      expect(apiMocks.fetchSiteModelVersions).toHaveBeenCalledWith("SITE_A", "test-token", expect.any(AbortSignal));
    });

    fireEvent.click(await screen.findByRole("button", { name: "Run AI validation" }));

    await waitFor(() => {
      expect(apiMocks.runCaseValidation).toHaveBeenCalledWith("SITE_A", "test-token", {
        patient_id: "KERA-2026-001",
        visit_date: "Initial",
        model_version_id: undefined,
        model_version_ids: ["model_vit", "model_swin", "model_convnext", "model_dense", "model_eff"],
      });
    });

    await waitFor(() => {
      expect(apiMocks.runCaseValidationCompare).toHaveBeenCalledWith("SITE_A", "test-token", {
        patient_id: "KERA-2026-001",
        visit_date: "Initial",
        model_version_ids: ["model_vit", "model_swin", "model_convnext", "model_dense", "model_eff"],
        execution_mode: "cpu",
      });
    });

    expect(await screen.findByText("Consensus snapshot")).toBeInTheDocument();
    expect(screen.getByText("4 / 5")).toBeInTheDocument();
  });

  it("submits contribution with the selected five-model set", async () => {
    apiMocks.fetchCases.mockReset();
    apiMocks.fetchCases.mockResolvedValue([
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
    apiMocks.fetchSiteModelVersions.mockResolvedValue([
      { version_id: "model_vit", version_name: "vit-v1", architecture: "vit", ready: true },
      { version_id: "model_swin", version_name: "swin-v1", architecture: "swin", ready: true },
      { version_id: "model_convnext", version_name: "conv-v1", architecture: "convnext_tiny", ready: true },
      { version_id: "model_dense", version_name: "dense-v1", architecture: "densenet121", ready: true },
      { version_id: "model_eff", version_name: "eff-v1", architecture: "efficientnet_v2_s", ready: true },
    ]);
    apiMocks.runCaseContribution.mockResolvedValue({
      update: {
        update_id: "update_1",
        site_id: "SITE_A",
        base_model_version_id: "model_vit",
        architecture: "vit",
        upload_type: "weight delta",
        execution_device: "cpu",
        artifact_path: "C:\\KERA\\delta_1.pth",
        n_cases: 1,
        contributed_by: "user_researcher",
        case_reference_id: "case_ref_1",
        created_at: "2026-03-15T00:00:00Z",
        training_input_policy: "medsam_cornea_crop_only",
        training_summary: {},
        status: "pending_review",
      },
      updates: [
        {
          update_id: "update_1",
          site_id: "SITE_A",
          base_model_version_id: "model_vit",
          architecture: "vit",
          upload_type: "weight delta",
          execution_device: "cpu",
          artifact_path: "C:\\KERA\\delta_1.pth",
          n_cases: 1,
          contributed_by: "user_researcher",
          case_reference_id: "case_ref_1",
          created_at: "2026-03-15T00:00:00Z",
          training_input_policy: "medsam_cornea_crop_only",
          training_summary: {},
          status: "pending_review",
          crop_mode: "automated",
        },
      ],
      update_count: 1,
      visit_status: "active",
      execution_device: "cpu",
      model_version: {
        version_id: "model_vit",
        version_name: "vit-v1",
        architecture: "vit",
      },
      model_versions: [
        {
          version_id: "model_vit",
          version_name: "vit-v1",
          architecture: "vit",
          crop_mode: "automated",
          ensemble_mode: null,
        },
      ],
      failures: [],
      stats: {
        total_contributions: 1,
        user_contributions: 1,
        user_contribution_pct: 100,
        current_model_version: "global-http-seed",
      },
    });

    renderWorkspace();

    await waitFor(() => {
      expect(apiMocks.fetchSiteModelVersions).toHaveBeenCalledWith("SITE_A", "test-token", expect.any(AbortSignal));
    });

    fireEvent.click(await screen.findByRole("button", { name: "Contribute case update" }));

    await waitFor(() => {
      expect(apiMocks.runCaseContribution).toHaveBeenCalledWith("SITE_A", "test-token", {
        patient_id: "KERA-2026-001",
        visit_date: "Initial",
        execution_mode: "auto",
        model_version_id: undefined,
        model_version_ids: ["model_vit", "model_swin", "model_convnext", "model_dense", "model_eff"],
      });
    });
  });
});
