import React from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CaseWorkspaceAnalysisSection } from "./case-workspace-review-sections";

function getHubCardButton(stepLabel: string, title: string): HTMLButtonElement {
  const button = screen.getAllByRole("button").find(
    (item) =>
      item.getAttribute("aria-expanded") !== null &&
      item.textContent?.includes(stepLabel) &&
      item.textContent?.includes(title),
  );
  expect(button).toBeDefined();
  return button as HTMLButtonElement;
}

describe("case-workspace review sections", () => {
  it("uses the prepared single-case review profile when Step 1 is run directly", async () => {
    const onRunValidation = vi.fn(async () => null);

    render(
      <CaseWorkspaceAnalysisSection
        locale="en"
        token="token"
        selectedSiteId="SITE_A"
        mounted
        analysisEyebrow="Clinical AI review"
        analysisTitle="Analysis"
        analysisDescription="Description"
        imageCountLabel="images"
        commonLoading="Loading"
        commonNotAvailable="N/A"
        hasSelectedCase
        canRunRoiPreview
        canRunValidation
        canRunAiClinic={false}
        selectedCaseImageCount={3}
        representativePreviewUrl={null}
        selectedCompareModelVersionIds={[]}
        selectedValidationModelVersionId={"model_eff_mil"}
        compareModelCandidates={[]}
        modelCatalogState="idle"
        validationBusy={false}
        validationResult={null}
        validationArtifacts={{}}
        modelCompareBusy={false}
        modelCompareResult={null}
        aiClinicBusy={false}
        aiClinicExpandedBusy={false}
        aiClinicResult={null}
        aiClinicPreviewBusy={false}
        hasAnySavedLesionBox={false}
        roiPreviewBusy={false}
        lesionPreviewBusy={false}
        roiPreviewItems={[]}
        lesionPreviewItems={[]}
        pickLabel={(_locale, en) => en}
        translateOption={(_locale, _group, value) => value}
        setToast={vi.fn()}
        setSelectedCompareModelVersionIds={vi.fn()}
        setSelectedValidationModelVersionId={vi.fn()}
        onRunValidation={onRunValidation}
        onRunModelCompare={vi.fn()}
        onRunAiClinic={vi.fn()}
        onExpandAiClinic={vi.fn()}
        onRunRoiPreview={vi.fn()}
        onRunLesionPreview={vi.fn()}
        displayVisitReference={(visitReference) => visitReference}
        aiClinicTextUnavailableLabel="Unavailable"
      />,
    );

    fireEvent.click(getHubCardButton("Step 1", "Image-level analysis"));
    fireEvent.click(screen.getByRole("button", { name: "Run image-level analysis" }));

    await waitFor(() => {
      expect(onRunValidation).toHaveBeenCalledWith({
        selectionProfile: "single_case_review",
      });
    });
  });

  it("runs steps 1-3 in order and forwards the fresh Step 1 result", async () => {
    const callOrder: string[] = [];
    const validationResult = {
      summary: {
        validation_id: "validation_1",
        patient_id: "P-001",
        visit_date: "Initial",
        predicted_label: "bacterial",
        true_label: "bacterial",
        prediction_probability: 0.79,
        is_correct: true,
      },
      model_version: {
        version_id: "model_convnext",
        version_name: "conv-v1",
        architecture: "convnext_tiny",
        crop_mode: "raw",
      },
      execution_device: "gpu",
      artifact_availability: {
        gradcam: true,
        gradcam_cornea: false,
        gradcam_lesion: false,
        roi_crop: false,
        medsam_mask: false,
        lesion_crop: false,
        lesion_mask: false,
      },
      case_prediction: null,
      post_mortem: null,
    } as any;
    const onRunValidation = vi.fn(async () => {
      callOrder.push("validation");
      return validationResult;
    });
    const onRunModelCompare = vi.fn(async () => {
      callOrder.push("compare");
      return {
        patient_id: "P-001",
        visit_date: "Initial",
        execution_device: "gpu",
        comparisons: [],
      } as any;
    });
    const onRunAiClinic = vi.fn(async () => {
      callOrder.push("ai_clinic");
      return {
        analysis_stage: "similar_cases",
        similar_cases: [],
      } as any;
    });

    render(
      <CaseWorkspaceAnalysisSection
        locale="en"
        token="token"
        selectedSiteId="SITE_A"
        mounted
        analysisEyebrow="Clinical AI review"
        analysisTitle="Analysis"
        analysisDescription="Description"
        imageCountLabel="images"
        commonLoading="Loading"
        commonNotAvailable="N/A"
        hasSelectedCase
        canRunRoiPreview
        canRunValidation
        canRunAiClinic={false}
        selectedCaseImageCount={3}
        representativePreviewUrl={null}
        selectedCompareModelVersionIds={[]}
        selectedValidationModelVersionId={null}
        compareModelCandidates={[]}
        modelCatalogState="idle"
        validationBusy={false}
        validationResult={null}
        validationArtifacts={{}}
        modelCompareBusy={false}
        modelCompareResult={null}
        aiClinicBusy={false}
        aiClinicExpandedBusy={false}
        aiClinicResult={null}
        aiClinicPreviewBusy={false}
        hasAnySavedLesionBox={false}
        roiPreviewBusy={false}
        lesionPreviewBusy={false}
        roiPreviewItems={[]}
        lesionPreviewItems={[]}
        pickLabel={(_locale, en) => en}
        translateOption={(_locale, _group, value) => value}
        setToast={vi.fn()}
        setSelectedCompareModelVersionIds={vi.fn()}
        setSelectedValidationModelVersionId={vi.fn()}
        onRunValidation={onRunValidation}
        onRunModelCompare={onRunModelCompare}
        onRunAiClinic={onRunAiClinic}
        onExpandAiClinic={vi.fn()}
        onRunRoiPreview={vi.fn()}
        onRunLesionPreview={vi.fn()}
        displayVisitReference={(visitReference) => visitReference}
        aiClinicTextUnavailableLabel="Unavailable"
      />,
    );

    expect(screen.getAllByText("Image-level analysis").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Image retrieval").length).toBeGreaterThan(0);
    expect(
      screen.getByText("Runs Steps 1 -> 2 -> 3 automatically."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'The top "Run steps 1-3" button is the default path. Use these cards only when you want to check or rerun a single step.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Run image-level analysis" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Run visit-level analysis" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Run steps 1-3" }),
    ).toHaveAttribute("data-size", "md");
    expect(
      screen.getByRole("button", { name: "Run steps 1-3" }),
    ).toHaveAttribute("data-variant", "primary");

    fireEvent.click(screen.getByRole("button", { name: "Run steps 1-3" }));

    await waitFor(() => {
      expect(onRunValidation).toHaveBeenCalledTimes(1);
      expect(onRunValidation).toHaveBeenCalledWith({
        ignoreSelectedModel: true,
        selectionProfile: "single_case_review",
      });
      expect(onRunModelCompare).toHaveBeenCalledWith({
        modelVersionIds: undefined,
        executionDevice: "gpu",
        preferPreparedMil: true,
      });
      expect(onRunAiClinic).toHaveBeenCalledWith({
        validationResult,
      });
    });

    expect(callOrder).toEqual(["validation", "compare", "ai_clinic"]);
  });

  it("stops the 1-3 sequence when Step 2 fails", async () => {
    const callOrder: string[] = [];
    const validationResult = {
      summary: {
        validation_id: "validation_1",
        patient_id: "P-001",
        visit_date: "Initial",
        predicted_label: "bacterial",
        true_label: "bacterial",
        prediction_probability: 0.79,
        is_correct: true,
      },
      model_version: {
        version_id: "model_convnext",
        version_name: "conv-v1",
        architecture: "convnext_tiny",
        crop_mode: "raw",
      },
      execution_device: "gpu",
      artifact_availability: {
        gradcam: true,
        gradcam_cornea: false,
        gradcam_lesion: false,
        roi_crop: false,
        medsam_mask: false,
        lesion_crop: false,
        lesion_mask: false,
      },
      case_prediction: null,
      post_mortem: null,
    } as any;
    const onRunValidation = vi.fn(async () => {
      callOrder.push("validation");
      return validationResult;
    });
    const onRunModelCompare = vi.fn(async () => {
      callOrder.push("compare");
      return null;
    });
    const onRunAiClinic = vi.fn(async () => {
      callOrder.push("ai_clinic");
      return {
        analysis_stage: "similar_cases",
        similar_cases: [],
      } as any;
    });

    render(
      <CaseWorkspaceAnalysisSection
        locale="en"
        token="token"
        selectedSiteId="SITE_A"
        mounted
        analysisEyebrow="Clinical AI review"
        analysisTitle="Analysis"
        analysisDescription="Description"
        imageCountLabel="images"
        commonLoading="Loading"
        commonNotAvailable="N/A"
        hasSelectedCase
        canRunRoiPreview
        canRunValidation
        canRunAiClinic={false}
        selectedCaseImageCount={3}
        representativePreviewUrl={null}
        selectedCompareModelVersionIds={[]}
        selectedValidationModelVersionId={null}
        compareModelCandidates={[]}
        modelCatalogState="idle"
        validationBusy={false}
        validationResult={null}
        validationArtifacts={{}}
        modelCompareBusy={false}
        modelCompareResult={null}
        aiClinicBusy={false}
        aiClinicExpandedBusy={false}
        aiClinicResult={null}
        aiClinicPreviewBusy={false}
        hasAnySavedLesionBox={false}
        roiPreviewBusy={false}
        lesionPreviewBusy={false}
        roiPreviewItems={[]}
        lesionPreviewItems={[]}
        pickLabel={(_locale, en) => en}
        translateOption={(_locale, _group, value) => value}
        setToast={vi.fn()}
        setSelectedCompareModelVersionIds={vi.fn()}
        setSelectedValidationModelVersionId={vi.fn()}
        onRunValidation={onRunValidation}
        onRunModelCompare={onRunModelCompare}
        onRunAiClinic={onRunAiClinic}
        onExpandAiClinic={vi.fn()}
        onRunRoiPreview={vi.fn()}
        onRunLesionPreview={vi.fn()}
        displayVisitReference={(visitReference) => visitReference}
        aiClinicTextUnavailableLabel="Unavailable"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Run steps 1-3" }));

    await waitFor(() => {
      expect(onRunValidation).toHaveBeenCalledTimes(1);
      expect(onRunModelCompare).toHaveBeenCalledTimes(1);
    });

    expect(onRunAiClinic).not.toHaveBeenCalled();
    expect(callOrder).toEqual(["validation", "compare"]);
  });

  it("reveals only the clicked card action button", () => {
    render(
      <CaseWorkspaceAnalysisSection
        locale="en"
        token="token"
        selectedSiteId="SITE_A"
        mounted
        analysisEyebrow="Clinical AI review"
        analysisTitle="Analysis"
        analysisDescription="Description"
        imageCountLabel="images"
        commonLoading="Loading"
        commonNotAvailable="N/A"
        hasSelectedCase
        canRunRoiPreview
        canRunValidation
        canRunAiClinic={false}
        selectedCaseImageCount={3}
        representativePreviewUrl={null}
        selectedCompareModelVersionIds={[]}
        selectedValidationModelVersionId={null}
        compareModelCandidates={[]}
        modelCatalogState="idle"
        validationBusy={false}
        validationResult={null}
        validationArtifacts={{}}
        modelCompareBusy={false}
        modelCompareResult={null}
        aiClinicBusy={false}
        aiClinicExpandedBusy={false}
        aiClinicResult={null}
        aiClinicPreviewBusy={false}
        hasAnySavedLesionBox={false}
        roiPreviewBusy={false}
        lesionPreviewBusy={false}
        roiPreviewItems={[]}
        lesionPreviewItems={[]}
        pickLabel={(_locale, en) => en}
        translateOption={(_locale, _group, value) => value}
        setToast={vi.fn()}
        setSelectedCompareModelVersionIds={vi.fn()}
        setSelectedValidationModelVersionId={vi.fn()}
        onRunValidation={vi.fn()}
        onRunModelCompare={vi.fn()}
        onRunAiClinic={vi.fn()}
        onExpandAiClinic={vi.fn()}
        onRunRoiPreview={vi.fn()}
        onRunLesionPreview={vi.fn()}
        displayVisitReference={(visitReference) => visitReference}
        aiClinicTextUnavailableLabel="Unavailable"
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Run image-level analysis" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Run visit-level analysis" }),
    ).not.toBeInTheDocument();

    fireEvent.click(getHubCardButton("Step 2", "Visit-level analysis (MIL)"));

    expect(
      screen.queryByRole("button", { name: "Run image-level analysis" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Run visit-level analysis" }),
    ).toHaveAttribute("data-variant", "ghost");
  });

  it("runs Step 3 retrieval when the cluster tab is selected without a prepared result", async () => {
    const onRunAiClinic = vi.fn(async () => ({
      analysis_stage: "similar_cases",
      query_case: {
        patient_id: "P-001",
        visit_date: "Initial",
      },
      similar_cases: [],
      eligible_candidate_count: 0,
      ai_clinic_profile: null,
      text_evidence: [],
    } as any));

    render(
      <CaseWorkspaceAnalysisSection
        locale="en"
        token="token"
        selectedSiteId="SITE_A"
        mounted
        analysisEyebrow="Clinical AI review"
        analysisTitle="Analysis"
        analysisDescription="Description"
        imageCountLabel="images"
        commonLoading="Loading"
        commonNotAvailable="N/A"
        hasSelectedCase
        canRunRoiPreview
        canRunValidation
        canRunAiClinic
        selectedCaseImageCount={3}
        representativePreviewUrl={null}
        selectedCompareModelVersionIds={[]}
        selectedValidationModelVersionId={null}
        compareModelCandidates={[]}
        modelCatalogState="idle"
        validationBusy={false}
        validationResult={{
          summary: {
            validation_id: "validation_1",
            patient_id: "P-001",
            visit_date: "Initial",
            predicted_label: "bacterial",
            true_label: "bacterial",
            prediction_probability: 0.79,
            is_correct: true,
          },
          model_version: {
            version_id: "model_convnext",
            version_name: "conv-v1",
            architecture: "convnext_tiny",
            crop_mode: "raw",
          },
          execution_device: "gpu",
          artifact_availability: {
            gradcam: true,
            gradcam_cornea: false,
            gradcam_lesion: false,
            roi_crop: false,
            medsam_mask: false,
            lesion_crop: false,
            lesion_mask: false,
          },
          case_prediction: null,
          post_mortem: null,
        } as any}
        validationArtifacts={{}}
        modelCompareBusy={false}
        modelCompareResult={null}
        aiClinicBusy={false}
        aiClinicExpandedBusy={false}
        aiClinicResult={null}
        aiClinicPreviewBusy={false}
        hasAnySavedLesionBox={false}
        roiPreviewBusy={false}
        lesionPreviewBusy={false}
        roiPreviewItems={[]}
        lesionPreviewItems={[]}
        pickLabel={(_locale, en) => en}
        translateOption={(_locale, _group, value) => value}
        setToast={vi.fn()}
        setSelectedCompareModelVersionIds={vi.fn()}
        setSelectedValidationModelVersionId={vi.fn()}
        onRunValidation={vi.fn()}
        onRunModelCompare={vi.fn()}
        onRunAiClinic={onRunAiClinic}
        onExpandAiClinic={vi.fn()}
        onRunRoiPreview={vi.fn()}
        onRunLesionPreview={vi.fn()}
        displayVisitReference={(visitReference) => visitReference}
        aiClinicTextUnavailableLabel="Unavailable"
      />,
    );

    fireEvent.click(getHubCardButton("Step 3", "Image retrieval"));
    fireEvent.click(screen.getByRole("button", { name: "3D cluster map" }));

    await waitFor(() => {
      expect(onRunAiClinic).toHaveBeenCalledWith({
        validationResult: expect.objectContaining({
          summary: expect.objectContaining({
            validation_id: "validation_1",
          }),
        }),
      });
    });
  });

  it("keeps Step 2 fallback runnable when the compare-model catalog is unavailable", () => {
    render(
      <CaseWorkspaceAnalysisSection
        locale="en"
        token="token"
        selectedSiteId="SITE_A"
        mounted
        analysisEyebrow="Clinical AI review"
        analysisTitle="Analysis"
        analysisDescription="Description"
        imageCountLabel="images"
        commonLoading="Loading"
        commonNotAvailable="N/A"
        hasSelectedCase
        canRunRoiPreview
        canRunValidation
        canRunAiClinic={false}
        selectedCaseImageCount={3}
        representativePreviewUrl={null}
        selectedCompareModelVersionIds={[]}
        selectedValidationModelVersionId={null}
        compareModelCandidates={[]}
        modelCatalogState="error"
        validationBusy={false}
        validationResult={null}
        validationArtifacts={{}}
        modelCompareBusy={false}
        modelCompareResult={null}
        aiClinicBusy={false}
        aiClinicExpandedBusy={false}
        aiClinicResult={null}
        aiClinicPreviewBusy={false}
        hasAnySavedLesionBox={false}
        roiPreviewBusy={false}
        lesionPreviewBusy={false}
        roiPreviewItems={[]}
        lesionPreviewItems={[]}
        pickLabel={(_locale, en) => en}
        translateOption={(_locale, _group, value) => value}
        setToast={vi.fn()}
        setSelectedCompareModelVersionIds={vi.fn()}
        setSelectedValidationModelVersionId={vi.fn()}
        onRunValidation={vi.fn()}
        onRunModelCompare={vi.fn()}
        onRunAiClinic={vi.fn()}
        onExpandAiClinic={vi.fn()}
        onRunRoiPreview={vi.fn()}
        onRunLesionPreview={vi.fn()}
        displayVisitReference={(visitReference) => visitReference}
        aiClinicTextUnavailableLabel="Unavailable"
      />,
    );

    expect(screen.getByText("Prepared fallback ready")).toBeInTheDocument();
    fireEvent.click(getHubCardButton("Step 2", "Visit-level analysis (MIL)"));
    expect(
      screen.getAllByText(
        "The prepared Efficient MIL fallback is already runnable on this case. The visible Step 2 model catalog may still load in the background or be temporarily unavailable.",
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("Catalog unavailable")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Run visit-level analysis" }),
    ).toBeEnabled();
  });
});
