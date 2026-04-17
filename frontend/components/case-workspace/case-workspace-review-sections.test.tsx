import React from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CaseWorkspaceAnalysisSection } from "./case-workspace-review-sections";

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

    fireEvent.click(screen.getByRole("button", { name: "Run single-case judgment" }));

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

    expect(screen.getByText("Single-case AI judgment")).toBeInTheDocument();
    expect(screen.getByText("Similar-patient review")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Use this after Step 1. The prepared visit-level Efficient MIL model is the default Step 2 path, and you can still add extra models here for an advanced comparison if needed.",
      ),
    ).toBeInTheDocument();

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
});
