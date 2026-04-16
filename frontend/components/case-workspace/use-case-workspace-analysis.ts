"use client";

import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  fetchCases,
  setRepresentativeImage as setRepresentativeImageOnServer,
  type CaseContributionResponse,
  type CaseHistoryResponse,
  type CaseSummaryRecord,
  type CaseValidationResponse,
} from "../../lib/api";
import type { Locale } from "../../lib/i18n";
import { prewarmDesktopMlBackend } from "../../lib/desktop-runtime-prewarm";
import type { LocalePick, SavedImagePreview } from "./shared";
import { useCaseWorkspaceAiClinic } from "./use-case-workspace-ai-clinic";
import { useCaseWorkspaceLiveLesion } from "./use-case-workspace-live-lesion";
import { useCaseWorkspacePreviewArtifacts } from "./use-case-workspace-preview-artifacts";
import { useCaseWorkspaceSemanticPrompt } from "./use-case-workspace-semantic-prompt";
import { useCaseWorkspaceValidation } from "./use-case-workspace-validation";

type ToastState = {
  tone: "success" | "error";
  message: string;
} | null;

type AnalysisCopy = {
  selectSavedCaseForRoi: string;
  roiPreviewGenerated: (patientId: string, visitDate: string) => string;
  roiPreviewFailed: string;
  selectSavedCaseForValidation: string;
  validationSaved: (patientId: string, visitDate: string) => string;
  validationFailed: string;
  selectValidationBeforeAiClinic: string;
  aiClinicReady: (count: number) => string;
  aiClinicExpandedReady: string;
  aiClinicFailed: string;
  aiClinicExpandFirst: string;
  selectSiteForCase: string;
  representativeUpdated: string;
  representativeUpdateFailed: string;
};

type Args = {
  locale: Locale;
  token: string;
  selectedSiteId: string | null;
  selectedCase: CaseSummaryRecord | null;
  panelBusy: boolean;
  selectedCaseImages: SavedImagePreview[];
  patientVisitGallery: Record<string, SavedImagePreview[]>;
  selectedCompareModelVersionIds: string[];
  selectedValidationModelVersionId: string | null;
  showOnlyMine: boolean;
  copy: AnalysisCopy;
  pick: LocalePick;
  executionModeFromDevice: (
    device: string | undefined,
  ) => "auto" | "cpu" | "gpu";
  describeError: (error: unknown, fallback: string) => string;
  setToast: Dispatch<SetStateAction<ToastState>>;
  setPanelOpen: Dispatch<SetStateAction<boolean>>;
  setCases: Dispatch<SetStateAction<CaseSummaryRecord[]>>;
  setSelectedCase: Dispatch<SetStateAction<CaseSummaryRecord | null>>;
  setSelectedPatientCases: Dispatch<SetStateAction<CaseSummaryRecord[]>>;
  setSelectedCaseImages: Dispatch<SetStateAction<SavedImagePreview[]>>;
  setCaseHistory: Dispatch<SetStateAction<CaseHistoryResponse | null>>;
  setContributionResult: Dispatch<
    SetStateAction<CaseContributionResponse | null>
  >;
  loadCaseHistory: (
    siteId: string,
    patientId: string,
    visitDate: string,
  ) => Promise<void>;
  loadSiteActivity: (siteId: string) => Promise<unknown>;
  onSiteDataChanged: (siteId: string) => Promise<void>;
  onValidationCompleted?: (args: {
    siteId: string;
    selectedCase: CaseSummaryRecord;
    result: CaseValidationResponse;
  }) => Promise<void> | void;
  onArtifactsChanged?: () => void;
};

export function useCaseWorkspaceAnalysis({
  locale,
  token,
  selectedSiteId,
  selectedCase,
  panelBusy,
  selectedCaseImages,
  patientVisitGallery,
  selectedCompareModelVersionIds,
  selectedValidationModelVersionId,
  showOnlyMine,
  copy,
  pick,
  executionModeFromDevice,
  describeError,
  setToast,
  setPanelOpen,
  setCases,
  setSelectedCase,
  setSelectedPatientCases,
  setSelectedCaseImages,
  setCaseHistory,
  setContributionResult,
  loadCaseHistory,
  loadSiteActivity,
  onSiteDataChanged,
  onValidationCompleted,
  onArtifactsChanged,
}: Args) {
  const [representativeBusyImageId, setRepresentativeBusyImageId] = useState<
    string | null
  >(null);
  const desktopMlPrewarmedSiteIdRef = useRef<string | null>(null);

  useEffect(() => {
    desktopMlPrewarmedSiteIdRef.current = null;
  }, [selectedSiteId]);

  useEffect(() => {
    if (!selectedSiteId || !selectedCase || panelBusy) {
      return;
    }
    if (desktopMlPrewarmedSiteIdRef.current === selectedSiteId) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      desktopMlPrewarmedSiteIdRef.current = selectedSiteId;
      void prewarmDesktopMlBackend().catch(() => {
        if (desktopMlPrewarmedSiteIdRef.current === selectedSiteId) {
          desktopMlPrewarmedSiteIdRef.current = null;
        }
      });
    }, 2500);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [panelBusy, selectedSiteId, selectedCase?.case_id]);

  const representativeSavedImage =
    selectedCaseImages.find((image) => image.is_representative) ?? null;

  const {
    liveLesionCropEnabled,
    setLiveLesionCropEnabled,
    liveLesionPreviews,
    lesionPromptDrafts,
    lesionPromptSaved,
    lesionBoxBusyImageId,
    hasAnySavedLesionBox,
    resetLiveLesionState,
    persistChangedLesionBoxes,
    applySavedLesionBoxesAndStartLivePreview,
    handleLesionPointerDown,
    handleLesionPointerMove,
    finishLesionPointer,
  } = useCaseWorkspaceLiveLesion({
    locale,
    token,
    selectedSiteId,
    selectedCase,
    selectedCaseImages,
    pick,
    describeError,
    setToast,
    setSelectedCaseImages,
  });

  const {
    validationBusy,
    validationResult,
    modelCompareBusy,
    modelCompareResult,
    validationArtifacts,
    resetValidationState,
    handleRunValidation,
    handleRunModelCompare,
  } = useCaseWorkspaceValidation({
    locale,
    token,
    selectedSiteId,
    selectedCase,
    selectedCompareModelVersionIds,
    selectedValidationModelVersionId,
    pick,
    copy: {
      selectSavedCaseForValidation: copy.selectSavedCaseForValidation,
      validationSaved: copy.validationSaved,
      validationFailed: copy.validationFailed,
    },
    executionModeFromDevice,
    describeError,
    setToast,
    setPanelOpen,
    setContributionResult,
    loadCaseHistory,
    loadSiteActivity,
    onSiteDataChanged,
    onValidationCompleted,
    onArtifactsChanged,
  });

  const {
    semanticPromptBusyImageId,
    semanticPromptReviews,
    semanticPromptErrors,
    semanticPromptOpenImageIds,
    semanticPromptInputMode,
    setSemanticPromptInputMode,
    clearSemanticPromptState,
    handleReviewSemanticPrompts,
  } = useCaseWorkspaceSemanticPrompt({
    locale,
    token,
    selectedSiteId,
    pick,
    describeError,
    setToast,
    selectSiteForCase: copy.selectSiteForCase,
  });

  const {
    roiPreviewBusy,
    roiPreviewItems,
    lesionPreviewBusy,
    lesionPreviewItems,
    savedImageRoiCropUrls,
    savedImageRoiCropBusy,
    savedImageLesionCropUrls,
    savedImageLesionCropBusy,
    resetPreviewArtifacts,
    handleRunRoiPreview,
    handleRunLesionPreview,
  } = useCaseWorkspacePreviewArtifacts({
    locale,
    token,
    selectedSiteId,
    selectedCase,
    selectedCaseImages,
    semanticPromptInputMode,
    liveLesionPreviews,
    lesionPromptDrafts,
    hasAnySavedLesionBox,
    pick,
    describeError,
    setToast,
    setPanelOpen,
    setSelectedCaseImages,
    persistChangedLesionBoxes,
    onArtifactsChanged,
    copy: {
      selectSavedCaseForRoi: copy.selectSavedCaseForRoi,
      roiPreviewGenerated: copy.roiPreviewGenerated,
      roiPreviewFailed: copy.roiPreviewFailed,
    },
  });

  function resetAnalysisState() {
    clearSemanticPromptState();
    resetValidationState();
    clearAiClinicPreview();
    resetPreviewArtifacts();
    resetLiveLesionState();
    setCaseHistory(null);
    setContributionResult(null);
  }

  const {
    aiClinicBusy,
    aiClinicExpandedBusy,
    aiClinicPreviewBusy,
    aiClinicResult,
    clearAiClinicPreview,
    handleRunAiClinic,
    handleExpandAiClinic,
  } = useCaseWorkspaceAiClinic({
    token,
    selectedSiteId,
    selectedCase,
    validationResult,
    executionModeFromDevice,
    describeError,
    setToast,
    setPanelOpen,
    copy: {
      selectSavedCaseForValidation: copy.selectSavedCaseForValidation,
      selectValidationBeforeAiClinic: copy.selectValidationBeforeAiClinic,
      aiClinicReady: copy.aiClinicReady,
      aiClinicExpandedReady: copy.aiClinicExpandedReady,
      aiClinicFailed: copy.aiClinicFailed,
      aiClinicExpandFirst: copy.aiClinicExpandFirst,
    },
  });

  useEffect(() => {
    clearSemanticPromptState();
  }, [clearSemanticPromptState, selectedCase?.case_id, selectedSiteId]);

  useEffect(() => {
    resetValidationState();
    clearAiClinicPreview();
    resetPreviewArtifacts();
    resetLiveLesionState();
    setCaseHistory(null);
    setContributionResult(null);
  }, [
    clearAiClinicPreview,
    resetPreviewArtifacts,
    resetLiveLesionState,
    resetValidationState,
    selectedCase,
    selectedSiteId,
  ]);

  async function handleSetSavedRepresentative(imageId: string) {
    if (!selectedSiteId || !selectedCase) {
      setToast({ tone: "error", message: copy.selectSiteForCase });
      return;
    }
    const targetImage = selectedCaseImages.find(
      (image) => image.image_id === imageId,
    );
    if (!targetImage || targetImage.is_representative) {
      return;
    }

    setRepresentativeBusyImageId(imageId);
    try {
      await setRepresentativeImageOnServer(selectedSiteId, token, {
        patient_id: selectedCase.patient_id,
        visit_date: selectedCase.visit_date,
        representative_image_id: imageId,
      });
      setSelectedCaseImages((current) =>
        current.map((image) => ({
          ...image,
          is_representative: image.image_id === imageId,
        })),
      );
      const nextCases = await fetchCases(selectedSiteId, token, {
        mine: showOnlyMine,
      });
      setCases(nextCases);
      const refreshedCase =
        nextCases.find((item) => item.case_id === selectedCase.case_id) ??
        nextCases.find(
          (item) =>
            item.patient_id === selectedCase.patient_id &&
            item.visit_date === selectedCase.visit_date,
        ) ??
        null;
      setSelectedPatientCases((current) =>
        current.map((item) =>
          item.case_id === selectedCase.case_id
            ? {
                ...item,
                representative_image_id: imageId,
                representative_view: targetImage.view,
              }
            : item,
        ),
      );
      setSelectedCase(refreshedCase);
      setToast({
        tone: "success",
        message: copy.representativeUpdated,
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, copy.representativeUpdateFailed),
      });
    } finally {
      setRepresentativeBusyImageId(null);
    }
  }

  return {
    validationBusy,
    validationResult,
    modelCompareBusy,
    modelCompareResult,
    validationArtifacts,
    aiClinicBusy,
    aiClinicExpandedBusy,
    aiClinicPreviewBusy,
    aiClinicResult,
    roiPreviewBusy,
    roiPreviewItems,
    lesionPreviewBusy,
    lesionPreviewItems,
    semanticPromptBusyImageId,
    semanticPromptReviews,
    semanticPromptErrors,
    semanticPromptOpenImageIds,
    semanticPromptInputMode,
    setSemanticPromptInputMode,
    liveLesionCropEnabled,
    setLiveLesionCropEnabled,
    liveLesionPreviews,
    savedImageRoiCropUrls,
    savedImageRoiCropBusy,
    savedImageLesionCropUrls,
    savedImageLesionCropBusy,
    lesionPromptDrafts,
    lesionPromptSaved,
    lesionBoxBusyImageId,
    representativeBusyImageId,
    representativeSavedImage,
    hasAnySavedLesionBox,
    resetAnalysisState,
    handleRunValidation,
    handleRunModelCompare,
    handleRunAiClinic,
    handleExpandAiClinic,
    handleRunRoiPreview,
    handleRunLesionPreview,
    handleSetSavedRepresentative,
    handleReviewSemanticPrompts,
    handleLesionPointerDown,
    handleLesionPointerMove,
    finishLesionPointer,
    applySavedLesionBoxesAndStartLivePreview,
  };
}
