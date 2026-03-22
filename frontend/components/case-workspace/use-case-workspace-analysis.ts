"use client";

import { type PointerEvent as ReactPointerEvent, type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";

import {
  clearImageLesionBox,
  type AiClinicResponse,
  fetchCaseLesionPreview,
  fetchStoredCaseLesionPreview,
  fetchCaseLesionPreviewArtifactUrl,
  fetchCaseRoiPreview,
  fetchCaseRoiPreviewArtifactUrl,
  fetchCases,
  fetchImagePreviewUrl,
  fetchImageSemanticPromptScores,
  fetchValidationArtifactUrl,
  runCaseAiClinic,
  runCaseAiClinicSimilarCases,
  runCaseValidation,
  runCaseValidationCompare,
  setRepresentativeImage as setRepresentativeImageOnServer,
  startLiveLesionPreview,
  updateImageLesionBox,
  type CaseContributionResponse,
  type CaseHistoryResponse,
  type CaseSummaryRecord,
  type CaseValidationCompareResponse,
  type CaseValidationResponse,
  type LiveLesionPreviewJobResponse,
  type SemanticPromptInputMode,
} from "../../lib/api";
import type { Locale } from "../../lib/i18n";
import {
  LiveLesionPreviewTimeoutError,
  waitForLiveLesionPreviewSettlement,
} from "../../lib/live-lesion-preview-runtime";
import type {
  AiClinicPreviewResponse,
  LesionBoxMap,
  LesionPreviewCard,
  LiveLesionPreviewMap,
  LocalePick,
  NormalizedBox,
  RoiPreviewCard,
  SavedImagePreview,
  SemanticPromptErrorMap,
  SemanticPromptReviewMap,
} from "./shared";

type ToastState = {
  tone: "success" | "error";
  message: string;
} | null;

type ValidationArtifactKind =
  | "gradcam"
  | "gradcam_cornea"
  | "gradcam_lesion"
  | "roi_crop"
  | "medsam_mask"
  | "lesion_crop"
  | "lesion_mask";
type ValidationArtifactPreviews = Partial<Record<ValidationArtifactKind, string | null>>;
type ModelCompareItem = CaseValidationCompareResponse["comparisons"][number];
type SuccessfulModelCompareItem = ModelCompareItem & {
  summary: NonNullable<ModelCompareItem["summary"]>;
  model_version: NonNullable<ModelCompareItem["model_version"]>;
};

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
  selectedCaseImages: SavedImagePreview[];
  patientVisitGallery: Record<string, SavedImagePreview[]>;
  selectedCompareModelVersionIds: string[];
  showOnlyMine: boolean;
  copy: AnalysisCopy;
  pick: LocalePick;
  toNormalizedBox: (value: unknown) => NormalizedBox | null;
  normalizeBox: (box: NormalizedBox) => NormalizedBox;
  clamp01: (value: number) => number;
  executionModeFromDevice: (device: string | undefined) => "auto" | "cpu" | "gpu";
  describeError: (error: unknown, fallback: string) => string;
  setToast: Dispatch<SetStateAction<ToastState>>;
  setPanelOpen: Dispatch<SetStateAction<boolean>>;
  setCases: Dispatch<SetStateAction<CaseSummaryRecord[]>>;
  setSelectedCase: Dispatch<SetStateAction<CaseSummaryRecord | null>>;
  setSelectedCaseImages: Dispatch<SetStateAction<SavedImagePreview[]>>;
  setCaseHistory: Dispatch<SetStateAction<CaseHistoryResponse | null>>;
  setContributionResult: Dispatch<SetStateAction<CaseContributionResponse | null>>;
  loadCaseHistory: (siteId: string, patientId: string, visitDate: string) => Promise<void>;
  loadSiteActivity: (siteId: string) => Promise<unknown>;
  onSiteDataChanged: (siteId: string) => Promise<void>;
  onSavedImageDataChanged?: () => void;
  onValidationCompleted?: (args: {
    siteId: string;
    selectedCase: CaseSummaryRecord;
    result: CaseValidationResponse;
  }) => Promise<void> | void;
  onArtifactsChanged?: () => void;
};

function revokeUrls(urls: string[]) {
  for (const url of urls) {
    if (String(url).startsWith("blob:")) {
      URL.revokeObjectURL(url);
    }
  }
}

function areNormalizedBoxesEqual(left: NormalizedBox | null | undefined, right: NormalizedBox | null | undefined): boolean {
  if (!left || !right) {
    return left == null && right == null;
  }
  return (
    left.x0 === right.x0 &&
    left.y0 === right.y0 &&
    left.x1 === right.x1 &&
    left.y1 === right.y1
  );
}

export function useCaseWorkspaceAnalysis({
  locale,
  token,
  selectedSiteId,
  selectedCase,
  selectedCaseImages,
  patientVisitGallery,
  selectedCompareModelVersionIds,
  showOnlyMine,
  copy,
  pick,
  toNormalizedBox,
  normalizeBox,
  clamp01,
  executionModeFromDevice,
  describeError,
  setToast,
  setPanelOpen,
  setCases,
  setSelectedCase,
  setSelectedCaseImages,
  setCaseHistory,
  setContributionResult,
  loadCaseHistory,
  loadSiteActivity,
  onSiteDataChanged,
  onSavedImageDataChanged,
  onValidationCompleted,
  onArtifactsChanged,
}: Args) {
  const AI_CLINIC_LITE_RETRIEVAL_BACKEND = "classifier";
  const [validationBusy, setValidationBusy] = useState(false);
  const [validationResult, setValidationResult] = useState<CaseValidationResponse | null>(null);
  const [modelCompareBusy, setModelCompareBusy] = useState(false);
  const [modelCompareResult, setModelCompareResult] = useState<CaseValidationCompareResponse | null>(null);
  const [validationArtifacts, setValidationArtifacts] = useState<ValidationArtifactPreviews>({});
  const [aiClinicBusy, setAiClinicBusy] = useState(false);
  const [aiClinicExpandedBusy, setAiClinicExpandedBusy] = useState(false);
  const [aiClinicPreviewBusy, setAiClinicPreviewBusy] = useState(false);
  const [aiClinicResult, setAiClinicResult] = useState<AiClinicPreviewResponse | null>(null);
  const [roiPreviewBusy, setRoiPreviewBusy] = useState(false);
  const [roiPreviewItems, setRoiPreviewItems] = useState<RoiPreviewCard[]>([]);
  const [lesionPreviewBusy, setLesionPreviewBusy] = useState(false);
  const [lesionPreviewItems, setLesionPreviewItems] = useState<LesionPreviewCard[]>([]);
  const [semanticPromptBusyImageId, setSemanticPromptBusyImageId] = useState<string | null>(null);
  const [semanticPromptReviews, setSemanticPromptReviews] = useState<SemanticPromptReviewMap>({});
  const [semanticPromptErrors, setSemanticPromptErrors] = useState<SemanticPromptErrorMap>({});
  const [semanticPromptOpenImageIds, setSemanticPromptOpenImageIds] = useState<string[]>([]);
  const [semanticPromptInputMode, setSemanticPromptInputMode] = useState<SemanticPromptInputMode>("source");
  const [liveLesionCropEnabled, setLiveLesionCropEnabled] = useState(true);
  const [liveLesionPreviews, setLiveLesionPreviews] = useState<LiveLesionPreviewMap>({});
  const [savedImageRoiCropUrls, setSavedImageRoiCropUrls] = useState<Record<string, string | null>>({});
  const [savedImageRoiCropBusy, setSavedImageRoiCropBusy] = useState(false);
  const [savedImageLesionCropUrls, setSavedImageLesionCropUrls] = useState<Record<string, string | null>>({});
  const [savedImageLesionCropBusy, setSavedImageLesionCropBusy] = useState(false);
  const [lesionPromptDrafts, setLesionPromptDrafts] = useState<LesionBoxMap>({});
  const [lesionPromptSaved, setLesionPromptSaved] = useState<LesionBoxMap>({});
  const [lesionBoxBusyImageId, setLesionBoxBusyImageId] = useState<string | null>(null);
  const [representativeBusyImageId, setRepresentativeBusyImageId] = useState<string | null>(null);

  const validationArtifactUrlsRef = useRef<string[]>([]);
  const aiClinicPreviewUrlsRef = useRef<string[]>([]);
  const aiClinicRequestRef = useRef(0);
  const aiClinicPreviewRequestRef = useRef(0);
  const roiPreviewUrlsRef = useRef<string[]>([]);
  const lesionPreviewUrlsRef = useRef<string[]>([]);
  const liveLesionPreviewUrlsRef = useRef<Record<string, string[]>>({});
  const savedImageRoiCropUrlsRef = useRef<string[]>([]);
  const savedImageLesionCropUrlsRef = useRef<string[]>([]);
  const liveLesionPreviewRequestRef = useRef<Record<string, number>>({});
  const liveLesionPreviewsRef = useRef<LiveLesionPreviewMap>({});
  const lesionDrawStateRef = useRef<{ imageId: string; pointerId: number; x: number; y: number } | null>(null);
  const selectedCaseImagesRef = useRef(selectedCaseImages);
  selectedCaseImagesRef.current = selectedCaseImages;
  const caseImagesKey = `${selectedCase?.case_id ?? ""}:${selectedCaseImages.map((i) => i.image_id).join(",")}`;

  const representativeSavedImage = selectedCaseImages.find((image) => image.is_representative) ?? null;
  const lesionBoxChangedImageIds = selectedCaseImages
    .map((image) => image.image_id)
    .filter((imageId) => !areNormalizedBoxesEqual(lesionPromptDrafts[imageId] ?? null, lesionPromptSaved[imageId] ?? null));
  const hasAnySavedLesionBox = Object.values(lesionPromptSaved).some((value) => value);

  function normalizeSelectedCompareModelVersionIds() {
    return Array.from(
      new Set(
        selectedCompareModelVersionIds.map((item) => String(item).trim()).filter((item) => item.length > 0)
      )
    );
  }

  function clearValidationArtifacts() {
    revokeUrls(validationArtifactUrlsRef.current);
    validationArtifactUrlsRef.current = [];
    setValidationArtifacts({});
  }

  function clearAiClinicPreview() {
    aiClinicRequestRef.current += 1;
    aiClinicPreviewRequestRef.current += 1;
    revokeUrls(aiClinicPreviewUrlsRef.current);
    aiClinicPreviewUrlsRef.current = [];
    setAiClinicBusy(false);
    setAiClinicPreviewBusy(false);
    setAiClinicExpandedBusy(false);
    setAiClinicResult(null);
  }

  function clearRoiPreview() {
    revokeUrls(roiPreviewUrlsRef.current);
    roiPreviewUrlsRef.current = [];
    setRoiPreviewItems([]);
  }

  function clearLesionPreview() {
    revokeUrls(lesionPreviewUrlsRef.current);
    lesionPreviewUrlsRef.current = [];
    setLesionPreviewItems([]);
  }

  function clearLiveLesionPreview(imageId?: string) {
    if (imageId) {
      revokeUrls(liveLesionPreviewUrlsRef.current[imageId] ?? []);
      delete liveLesionPreviewUrlsRef.current[imageId];
      delete liveLesionPreviewRequestRef.current[imageId];
      setLiveLesionPreviews((current) => {
        const next = { ...current };
        delete next[imageId];
        return next;
      });
      return;
    }
    for (const urls of Object.values(liveLesionPreviewUrlsRef.current)) {
      revokeUrls(urls);
    }
    liveLesionPreviewUrlsRef.current = {};
    liveLesionPreviewRequestRef.current = {};
    setLiveLesionPreviews({});
  }

  function clearSavedImageRoiCrops() {
    revokeUrls(savedImageRoiCropUrlsRef.current);
    savedImageRoiCropUrlsRef.current = [];
    setSavedImageRoiCropUrls({});
    setSavedImageRoiCropBusy(false);
  }

  function clearSavedImageLesionCrops() {
    revokeUrls(savedImageLesionCropUrlsRef.current);
    savedImageLesionCropUrlsRef.current = [];
    setSavedImageLesionCropUrls({});
    setSavedImageLesionCropBusy(false);
  }

  function clearSemanticPromptState() {
    setSemanticPromptBusyImageId(null);
    setSemanticPromptReviews({});
    setSemanticPromptErrors({});
    setSemanticPromptOpenImageIds([]);
  }

  function resetAnalysisState() {
    clearSemanticPromptState();
    clearValidationArtifacts();
    clearAiClinicPreview();
    clearRoiPreview();
    clearLesionPreview();
    clearLiveLesionPreview();
    clearSavedImageRoiCrops();
    clearSavedImageLesionCrops();
    setValidationResult(null);
    setModelCompareResult(null);
    setCaseHistory(null);
    setContributionResult(null);
    setLesionPromptDrafts({});
    setLesionPromptSaved({});
  }

  async function resolveValidationArtifacts(
    result: CaseValidationResponse,
    patientId: string,
    visitDate: string,
  ): Promise<ValidationArtifactPreviews> {
    const nextArtifacts: ValidationArtifactPreviews = {};
    const hasBranchAwareGradcam =
      result.artifact_availability.gradcam_cornea || result.artifact_availability.gradcam_lesion;
    const artifactKinds: ValidationArtifactKind[] = [
      "roi_crop",
      ...(hasBranchAwareGradcam ? [] : ["gradcam" as const]),
      "gradcam_cornea",
      "gradcam_lesion",
      "medsam_mask",
      "lesion_crop",
      "lesion_mask",
    ];

    for (const artifactKind of artifactKinds) {
      const isAvailable =
        artifactKind === "roi_crop"
          ? result.artifact_availability.roi_crop
          : artifactKind === "gradcam"
            ? result.artifact_availability.gradcam
            : artifactKind === "gradcam_cornea"
              ? result.artifact_availability.gradcam_cornea
              : artifactKind === "gradcam_lesion"
                ? result.artifact_availability.gradcam_lesion
                : artifactKind === "medsam_mask"
                  ? result.artifact_availability.medsam_mask
                  : artifactKind === "lesion_crop"
                    ? result.artifact_availability.lesion_crop
                    : result.artifact_availability.lesion_mask;
      if (!isAvailable) {
        continue;
      }
      try {
        const url = await fetchValidationArtifactUrl(
          selectedSiteId!,
          result.summary.validation_id,
          patientId,
          visitDate,
          artifactKind,
          token
        );
        if (url) {
          validationArtifactUrlsRef.current.push(url);
        }
        nextArtifacts[artifactKind] = url;
      } catch {
        nextArtifacts[artifactKind] = null;
      }
    }

    return nextArtifacts;
  }

  function resolveAnchorModelVersionId(
    compareResult: CaseValidationCompareResponse,
    requestedModelVersionIds: string[],
    fallbackModelVersionId?: string | null,
  ): string | null {
    const successfulComparisons = compareResult.comparisons.filter(
      (item): item is SuccessfulModelCompareItem =>
        Boolean(item.summary && !item.error && item.model_version?.version_id)
    );
    for (const requestedId of requestedModelVersionIds) {
      const match = successfulComparisons.find(
        (item) => String(item.model_version.version_id || "").trim() === requestedId
      );
      if (match?.model_version.version_id) {
        return String(match.model_version.version_id).trim();
      }
    }
    const normalizedFallback = String(fallbackModelVersionId || "").trim();
    if (normalizedFallback) {
      const match = successfulComparisons.find(
        (item) => String(item.model_version.version_id || "").trim() === normalizedFallback
      );
      if (match?.model_version.version_id) {
        return String(match.model_version.version_id).trim();
      }
    }
    return successfulComparisons[0]?.model_version?.version_id
      ? String(successfulComparisons[0].model_version.version_id).trim()
      : null;
  }

  async function runAnchorValidation(args: {
    patientId: string;
    visitDate: string;
    modelVersionId?: string | null;
    executionMode?: "auto" | "cpu" | "gpu";
  }) {
    const result = await runCaseValidation(selectedSiteId!, token, {
      patient_id: args.patientId,
      visit_date: args.visitDate,
      execution_mode: args.executionMode,
      model_version_id: args.modelVersionId ? String(args.modelVersionId).trim() : undefined,
    });
    const nextArtifacts = await resolveValidationArtifacts(result, args.patientId, args.visitDate);
    setValidationArtifacts(nextArtifacts);
    setValidationResult(result);
    return result;
  }

  function aiClinicSimilarCaseKey(item: { patient_id: string; visit_date: string }) {
    return `${String(item.patient_id)}::${String(item.visit_date)}`;
  }

  function withAiClinicSimilarCasePreviews(
    result: AiClinicResponse,
    previousResult: AiClinicPreviewResponse | null,
  ): AiClinicPreviewResponse {
    const previewByCaseKey = new Map(
      (previousResult?.similar_cases ?? []).map((item) => [aiClinicSimilarCaseKey(item), item.preview_url] as const)
    );
    return {
      ...result,
      similar_cases: result.similar_cases.map((item) => ({
        ...item,
        preview_url: previewByCaseKey.get(aiClinicSimilarCaseKey(item)) ?? null,
      })),
    };
  }

  async function hydrateAiClinicSimilarCasePreviews(
    cases: AiClinicPreviewResponse["similar_cases"],
    previewRequestId: number,
  ) {
    if (!selectedSiteId) {
      return;
    }
    const casesNeedingPreview = cases.filter((item) => item.representative_image_id && !item.preview_url);
    if (casesNeedingPreview.length === 0) {
      if (aiClinicPreviewRequestRef.current === previewRequestId) {
        setAiClinicPreviewBusy(false);
      }
      return;
    }

    setAiClinicPreviewBusy(true);
    const nextUrls: string[] = [];
    try {
      const resolvedCases = await Promise.all(
        cases.map(async (item) => {
          if (!item.representative_image_id || item.preview_url) {
            return item;
          }
          try {
            const previewUrl = await fetchImagePreviewUrl(selectedSiteId, item.representative_image_id, token, {
              maxSide: 384,
            });
            if (previewUrl) {
              nextUrls.push(previewUrl);
            }
            return {
              ...item,
              preview_url: previewUrl,
            };
          } catch {
            return {
              ...item,
              preview_url: null,
            };
          }
        })
      );
      if (aiClinicPreviewRequestRef.current !== previewRequestId) {
        revokeUrls(nextUrls);
        return;
      }
      aiClinicPreviewUrlsRef.current.push(...nextUrls);
      const previewByCaseKey = new Map(
        resolvedCases.map((item) => [aiClinicSimilarCaseKey(item), item.preview_url] as const)
      );
      setAiClinicResult((current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          similar_cases: current.similar_cases.map((item) => ({
            ...item,
            preview_url: previewByCaseKey.get(aiClinicSimilarCaseKey(item)) ?? item.preview_url ?? null,
          })),
        };
      });
    } finally {
      if (aiClinicPreviewRequestRef.current === previewRequestId) {
        setAiClinicPreviewBusy(false);
      }
    }
  }

  useEffect(() => {
    return () => revokeUrls(validationArtifactUrlsRef.current);
  }, []);

  useEffect(() => {
    return () => revokeUrls(aiClinicPreviewUrlsRef.current);
  }, []);

  useEffect(() => {
    return () => revokeUrls(roiPreviewUrlsRef.current);
  }, []);

  useEffect(() => {
    return () => revokeUrls(lesionPreviewUrlsRef.current);
  }, []);

  useEffect(() => {
    return () => revokeUrls(savedImageRoiCropUrlsRef.current);
  }, []);

  useEffect(() => {
    return () => revokeUrls(savedImageLesionCropUrlsRef.current);
  }, []);

  useEffect(() => {
    return () => {
      for (const urls of Object.values(liveLesionPreviewUrlsRef.current)) {
        revokeUrls(urls);
      }
    };
  }, []);

  useEffect(() => {
    liveLesionPreviewsRef.current = liveLesionPreviews;
  }, [liveLesionPreviews]);

  useEffect(() => {
    const nextBoxes = Object.fromEntries(
      selectedCaseImages.map((image) => [image.image_id, toNormalizedBox(image.lesion_prompt_box)])
    );
    setLesionPromptSaved(nextBoxes);
    setLesionPromptDrafts(nextBoxes);
  }, [selectedCase?.case_id, selectedCaseImages, toNormalizedBox]);

  useEffect(() => {
    clearSemanticPromptState();
  }, [selectedCase?.case_id, selectedSiteId]);

  useEffect(() => {
    clearLiveLesionPreview();
    clearSavedImageRoiCrops();
    clearSavedImageLesionCrops();
  }, [selectedSiteId]);

  useEffect(() => {
    let cancelled = false;
    let hydrateTimer: number | null = null;

    async function hydrateStoredCaseLesionPreviews() {
      if (!selectedSiteId) {
        return;
      }

      const visibleImages = selectedCaseImagesRef.current;
      const boxedImages = Array.from(
        new Map(
          visibleImages
            .filter((image) => Boolean(toNormalizedBox(image.lesion_prompt_box)))
            .map((image) => [image.image_id, image] as const)
        ).values()
      );
      if (boxedImages.length === 0) {
        return;
      }

      const boxedImagesByCase = boxedImages.reduce(
        (groups, image) => {
          const key = `${image.patient_id}::${image.visit_date}`;
          const current = groups.get(key) ?? [];
          current.push(image);
          groups.set(key, current);
          return groups;
        },
        new Map<string, SavedImagePreview[]>()
      );

      for (const [caseKey, caseImages] of boxedImagesByCase.entries()) {
        const separatorIndex = caseKey.indexOf("::");
        if (separatorIndex <= 0) {
          continue;
        }
        const patientId = caseKey.slice(0, separatorIndex);
        const visitDate = caseKey.slice(separatorIndex + 2);

        try {
          const previews = await fetchStoredCaseLesionPreview(selectedSiteId, patientId, visitDate, token);
          if (cancelled) {
            return;
          }

          const previewByImageId = new Map(
            previews
              .filter((item) => item.image_id)
              .map((item) => [String(item.image_id), item] as const)
          );

          for (const image of caseImages) {
            const preview = previewByImageId.get(image.image_id);
            const existing = liveLesionPreviewsRef.current[image.image_id];
            if (!preview?.has_lesion_mask || (existing?.status === "done" && existing.lesion_mask_url)) {
              continue;
            }

            const nextUrls: string[] = [];
            try {
              const lesionMaskUrl = await fetchCaseLesionPreviewArtifactUrl(
                selectedSiteId,
                patientId,
                visitDate,
                image.image_id,
                "lesion_mask",
                token
              );
              if (lesionMaskUrl) {
                nextUrls.push(lesionMaskUrl);
              }

              let lesionCropUrl: string | null = null;
              if (preview.has_lesion_crop) {
                try {
                  lesionCropUrl = await fetchCaseLesionPreviewArtifactUrl(
                    selectedSiteId,
                    patientId,
                    visitDate,
                    image.image_id,
                    "lesion_crop",
                    token
                  );
                  if (lesionCropUrl) {
                    nextUrls.push(lesionCropUrl);
                  }
                } catch {
                  lesionCropUrl = null;
                }
              }

              if (cancelled) {
                revokeUrls(nextUrls);
                return;
              }

              revokeUrls(liveLesionPreviewUrlsRef.current[image.image_id] ?? []);
              liveLesionPreviewUrlsRef.current[image.image_id] = nextUrls;
              setLiveLesionPreviews((current) => ({
                ...current,
                [image.image_id]: {
                  job_id: current[image.image_id]?.job_id ?? null,
                  status: "done",
                  error: null,
                  backend: preview.backend ?? current[image.image_id]?.backend ?? null,
                  prompt_signature: current[image.image_id]?.prompt_signature ?? null,
                  lesion_mask_url: lesionMaskUrl,
                  lesion_crop_url: lesionCropUrl,
                },
              }));
            } catch {
              revokeUrls(nextUrls);
            }
          }
        } catch {
          // Ignore quietly when there is no stored lesion preview yet or the role cannot access it.
        }
      }
    }

    hydrateTimer = window.setTimeout(() => {
      void hydrateStoredCaseLesionPreviews();
    }, 900);
    return () => {
      cancelled = true;
      if (hydrateTimer !== null) {
        window.clearTimeout(hydrateTimer);
      }
    };
  }, [caseImagesKey, selectedSiteId, toNormalizedBox, token]);

  useEffect(() => {
    if (validationResult) {
      return;
    }
    clearAiClinicPreview();
    setModelCompareResult(null);
  }, [validationResult]);

  useEffect(() => {
    clearValidationArtifacts();
    clearAiClinicPreview();
    clearRoiPreview();
    clearLesionPreview();
    clearSavedImageRoiCrops();
    clearSavedImageLesionCrops();
    setValidationResult(null);
    setModelCompareResult(null);
    setCaseHistory(null);
    setContributionResult(null);
  }, [selectedCase, selectedSiteId]);

  useEffect(() => {
    if (semanticPromptInputMode !== "roi_crop" || !selectedSiteId || !selectedCase || selectedCaseImages.length === 0) {
      return;
    }

    const unresolvedImages = selectedCaseImages.filter(
      (image) => !Object.prototype.hasOwnProperty.call(savedImageRoiCropUrls, image.image_id)
    );
    if (unresolvedImages.length === 0) {
      return;
    }

    let cancelled = false;
    setSavedImageRoiCropBusy(true);

    void (async () => {
      try {
        const previews = await fetchCaseRoiPreview(
          selectedSiteId,
          selectedCase.patient_id,
          selectedCase.visit_date,
          token
        );
        if (cancelled) {
          return;
        }

        const previewByImageId = new Map(
          previews
            .filter((item) => item.image_id)
            .map((item) => [String(item.image_id), item] as const)
        );

        setSelectedCaseImages((current) =>
          current.map((image) => {
            const preview = previewByImageId.get(image.image_id);
            if (!preview) {
              return image;
            }
            return {
              ...image,
              has_roi_crop: preview.has_roi_crop,
              has_medsam_mask: preview.has_medsam_mask,
            };
          })
        );

        const entries = await Promise.all(
          unresolvedImages.map(async (image) => {
            const preview = previewByImageId.get(image.image_id);
            if (!preview?.has_roi_crop) {
              return [image.image_id, null] as const;
            }
            try {
              const url = await fetchCaseRoiPreviewArtifactUrl(
                selectedSiteId,
                selectedCase.patient_id,
                selectedCase.visit_date,
                image.image_id,
                "roi_crop",
                token
              );
              return [image.image_id, url] as const;
            } catch {
              return [image.image_id, null] as const;
            }
          })
        );

        if (cancelled) {
          revokeUrls(entries.map(([, url]) => url).filter((url): url is string => Boolean(url)));
          return;
        }

        const nextUrls = entries.map(([, url]) => url).filter((url): url is string => Boolean(url));
        savedImageRoiCropUrlsRef.current.push(...nextUrls);
        setSavedImageRoiCropUrls((current) => ({
          ...current,
          ...Object.fromEntries(entries),
        }));
      } catch (nextError) {
        if (!cancelled) {
          setToast({
            tone: "error",
            message: describeError(nextError, pick(locale, "Cornea crop preview failed.", "각막 crop 생성에 실패했습니다.")),
          });
        }
      } finally {
        if (!cancelled) {
          setSavedImageRoiCropBusy(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    savedImageRoiCropUrls,
    selectedCase,
    selectedCaseImages,
    selectedSiteId,
    semanticPromptInputMode,
    token,
  ]);

  useEffect(() => {
    if (semanticPromptInputMode !== "lesion_crop" || !selectedSiteId || !selectedCase || selectedCaseImages.length === 0) {
      return;
    }

    const unresolvedImages = selectedCaseImages.filter(
      (image) =>
        !liveLesionPreviews[image.image_id]?.lesion_crop_url &&
        !Object.prototype.hasOwnProperty.call(savedImageLesionCropUrls, image.image_id)
    );
    if (unresolvedImages.length === 0) {
      return;
    }

    const hasAnySavedLesionBox = selectedCaseImages.some((image) => typeof image.lesion_prompt_box === "object" && image.lesion_prompt_box !== null);
    let cancelled = false;
    setSavedImageLesionCropBusy(true);

    void (async () => {
      try {
        let previewByImageId = new Map<string, Awaited<ReturnType<typeof fetchCaseLesionPreview>>[number]>();
        if (hasAnySavedLesionBox) {
          const previews = await fetchCaseLesionPreview(
            selectedSiteId,
            selectedCase.patient_id,
            selectedCase.visit_date,
            token
          );
          if (cancelled) {
            return;
          }

          previewByImageId = new Map(
            previews
              .filter((item) => item.image_id)
              .map((item) => [String(item.image_id), item] as const)
          );

          setSelectedCaseImages((current) =>
            current.map((image) => {
              const preview = previewByImageId.get(image.image_id);
              if (!preview) {
                return image;
              }
              return {
                ...image,
                has_lesion_crop: preview.has_lesion_crop,
                has_lesion_mask: preview.has_lesion_mask,
              };
            })
          );
        }

        const entries = await Promise.all(
          unresolvedImages.map(async (image) => {
            const preview = previewByImageId.get(image.image_id);
            const canResolveCrop = preview?.has_lesion_crop ?? Boolean(image.has_lesion_crop);
            if (!canResolveCrop) {
              return [image.image_id, null] as const;
            }
            try {
              const url = await fetchCaseLesionPreviewArtifactUrl(
                selectedSiteId,
                selectedCase.patient_id,
                selectedCase.visit_date,
                image.image_id,
                "lesion_crop",
                token
              );
              return [image.image_id, url] as const;
            } catch {
              return [image.image_id, null] as const;
            }
          })
        );

        if (cancelled) {
          revokeUrls(entries.map(([, url]) => url).filter((url): url is string => Boolean(url)));
          return;
        }

        const nextUrls = entries.map(([, url]) => url).filter((url): url is string => Boolean(url));
        savedImageLesionCropUrlsRef.current.push(...nextUrls);
        setSavedImageLesionCropUrls((current) => ({
          ...current,
          ...Object.fromEntries(entries),
        }));
      } catch (nextError) {
        if (!cancelled) {
          setToast({
            tone: "error",
            message: describeError(nextError, pick(locale, "Lesion crop preview failed.", "병변 crop 생성에 실패했습니다.")),
          });
        }
      } finally {
        if (!cancelled) {
          setSavedImageLesionCropBusy(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    liveLesionPreviews,
    savedImageLesionCropUrls,
    selectedCase,
    selectedCaseImages,
    selectedSiteId,
    semanticPromptInputMode,
    token,
  ]);

  async function hydrateLiveLesionPreview(imageId: string, job: LiveLesionPreviewJobResponse, requestVersion: number) {
    if (!selectedSiteId || liveLesionPreviewRequestRef.current[imageId] !== requestVersion) {
      return;
    }

    const nextUrls: string[] = [];
    let lesionMaskUrl: string | null = null;
    let lesionCropUrl: string | null = null;

    if (job.has_lesion_mask) {
      try {
        lesionMaskUrl = await fetchCaseLesionPreviewArtifactUrl(
          selectedSiteId,
          job.patient_id,
          job.visit_date,
          imageId,
          "lesion_mask",
          token
        );
        if (lesionMaskUrl) {
          nextUrls.push(lesionMaskUrl);
        }
      } catch {
        lesionMaskUrl = null;
      }
    }

    if (job.has_lesion_crop) {
      try {
        lesionCropUrl = await fetchCaseLesionPreviewArtifactUrl(
          selectedSiteId,
          job.patient_id,
          job.visit_date,
          imageId,
          "lesion_crop",
          token
        );
        if (lesionCropUrl) {
          nextUrls.push(lesionCropUrl);
        }
      } catch {
        lesionCropUrl = null;
      }
    }

    if (liveLesionPreviewRequestRef.current[imageId] !== requestVersion) {
      revokeUrls(nextUrls);
      return;
    }

    revokeUrls(liveLesionPreviewUrlsRef.current[imageId] ?? []);
    liveLesionPreviewUrlsRef.current[imageId] = nextUrls;
    setLiveLesionPreviews((current) => ({
      ...current,
      [imageId]: {
        job_id: job.job_id,
        status: "done",
        error: null,
        backend: job.backend ?? null,
        prompt_signature: job.prompt_signature ?? null,
        lesion_mask_url: lesionMaskUrl,
        lesion_crop_url: lesionCropUrl,
      },
    }));
  }

  async function pollLiveLesionPreview(imageId: string, jobId: string, requestVersion: number) {
    if (!selectedSiteId) {
      return;
    }
    try {
      const job = await waitForLiveLesionPreviewSettlement({
        siteId: selectedSiteId,
        imageId,
        jobId,
        token,
        shouldContinue() {
          return liveLesionPreviewRequestRef.current[imageId] === requestVersion;
        },
        onRunning(job) {
          setLiveLesionPreviews((current) => ({
            ...current,
            [imageId]: {
              ...(current[imageId] ?? {
                job_id: job.job_id,
                lesion_mask_url: null,
                lesion_crop_url: null,
              }),
              job_id: job.job_id,
              status: "running",
              error: null,
              backend: job.backend ?? null,
              prompt_signature: job.prompt_signature ?? null,
              lesion_mask_url: current[imageId]?.lesion_mask_url ?? null,
              lesion_crop_url: current[imageId]?.lesion_crop_url ?? null,
            },
          }));
        },
      });
      if (!job || liveLesionPreviewRequestRef.current[imageId] !== requestVersion) {
        return;
      }
      if (job.status === "failed") {
          setLiveLesionPreviews((current) => ({
            ...current,
            [imageId]: {
              ...(current[imageId] ?? {
                lesion_mask_url: null,
                lesion_crop_url: null,
              }),
              job_id: job.job_id,
              status: "failed",
              error: job.error ?? pick(locale, "Live MedSAM preview failed.", "?ㅼ떆媛?MedSAM 誘몃━蹂닿린???ㅽ뙣?덉뒿?덈떎."),
              backend: job.backend ?? null,
              prompt_signature: job.prompt_signature ?? null,
              lesion_mask_url: current[imageId]?.lesion_mask_url ?? null,
              lesion_crop_url: current[imageId]?.lesion_crop_url ?? null,
            },
          }));
          return;
        }
        await hydrateLiveLesionPreview(imageId, job, requestVersion);
        return;
      } catch (nextError) {
        if (liveLesionPreviewRequestRef.current[imageId] !== requestVersion) {
          return;
        }
        setLiveLesionPreviews((current) => ({
          ...current,
          [imageId]: {
            ...(current[imageId] ?? {
              lesion_mask_url: null,
              lesion_crop_url: null,
            }),
            job_id: jobId,
            status: "failed",
            error: describeError(
              nextError,
              pick(locale, "Unable to check live MedSAM preview status.", "?ㅼ떆媛?MedSAM ?곹깭瑜??뺤씤?섏? 紐삵뻽?듬땲??")
            ),
            backend: current[imageId]?.backend ?? null,
            prompt_signature: current[imageId]?.prompt_signature ?? null,
            lesion_mask_url: current[imageId]?.lesion_mask_url ?? null,
            lesion_crop_url: current[imageId]?.lesion_crop_url ?? null,
          },
        }));
        return;
      }
    }

  async function triggerLiveLesionPreview(imageId: string, options: { quiet?: boolean } = {}) {
    if (!liveLesionCropEnabled || !selectedSiteId) {
      return;
    }
    const requestVersion = (liveLesionPreviewRequestRef.current[imageId] ?? 0) + 1;
    liveLesionPreviewRequestRef.current[imageId] = requestVersion;
    revokeUrls(liveLesionPreviewUrlsRef.current[imageId] ?? []);
    liveLesionPreviewUrlsRef.current[imageId] = [];
    setLiveLesionPreviews((current) => ({
      ...current,
      [imageId]: {
        job_id: current[imageId]?.job_id ?? null,
        status: "running",
        error: null,
        backend: current[imageId]?.backend ?? null,
        prompt_signature: current[imageId]?.prompt_signature ?? null,
        lesion_mask_url: null,
        lesion_crop_url: null,
      },
    }));

    try {
      const job = await startLiveLesionPreview(selectedSiteId, imageId, token);
      if (liveLesionPreviewRequestRef.current[imageId] !== requestVersion) {
        return;
      }
      if (job.status === "done") {
        await hydrateLiveLesionPreview(imageId, job, requestVersion);
        return;
      }
      setLiveLesionPreviews((current) => ({
        ...current,
        [imageId]: {
          ...(current[imageId] ?? {
            lesion_mask_url: null,
            lesion_crop_url: null,
          }),
          job_id: job.job_id,
          status: "running",
          error: null,
          backend: job.backend ?? null,
          prompt_signature: job.prompt_signature ?? null,
          lesion_mask_url: current[imageId]?.lesion_mask_url ?? null,
          lesion_crop_url: current[imageId]?.lesion_crop_url ?? null,
        },
      }));
      void pollLiveLesionPreview(imageId, job.job_id, requestVersion);
    } catch (nextError) {
      if (liveLesionPreviewRequestRef.current[imageId] !== requestVersion) {
        return;
      }
      const message = describeError(
        nextError,
        pick(locale, "Unable to start live MedSAM preview.", "?ㅼ떆媛?MedSAM 誘몃━蹂닿린瑜??쒖옉?섏? 紐삵뻽?듬땲??")
      );
      setLiveLesionPreviews((current) => ({
        ...current,
        [imageId]: {
          ...(current[imageId] ?? {
            lesion_mask_url: null,
            lesion_crop_url: null,
          }),
          job_id: null,
          status: "failed",
          error: message,
          backend: current[imageId]?.backend ?? null,
          prompt_signature: current[imageId]?.prompt_signature ?? null,
          lesion_mask_url: current[imageId]?.lesion_mask_url ?? null,
          lesion_crop_url: current[imageId]?.lesion_crop_url ?? null,
        },
      }));
      if (!options.quiet) {
        setToast({ tone: "error", message });
      }
    }
  }

  async function persistLesionPromptBox(imageId: string, nextBox: NormalizedBox) {
    if (!selectedSiteId) {
      throw new Error(pick(locale, "Select a hospital first.", "癒쇱? 蹂묒썝???좏깮??二쇱꽭??"));
    }
    setLesionBoxBusyImageId(imageId);
    try {
      const normalized = normalizeBox(nextBox);
      if (normalized.x1 - normalized.x0 < 0.01 || normalized.y1 - normalized.y0 < 0.01) {
        throw new Error(pick(locale, "Lesion box is too small.", "蹂묐? 諛뺤뒪媛 ?덈Т ?묒뒿?덈떎."));
      }
      const updatedImage = await updateImageLesionBox(selectedSiteId, imageId, token, normalized);
      setSelectedCaseImages((current) =>
        current.map((image) =>
          image.image_id === updatedImage.image_id
            ? { ...image, ...updatedImage, preview_url: image.preview_url }
            : image
        )
      );
      setLesionPromptSaved((current) => ({ ...current, [imageId]: normalized }));
      setLesionPromptDrafts((current) => ({ ...current, [imageId]: normalized }));
      if (liveLesionCropEnabled) {
        void triggerLiveLesionPreview(imageId, { quiet: true });
      }
      return normalized;
    } finally {
      setLesionBoxBusyImageId(null);
    }
  }

  async function clearSavedLesionPromptBox(imageId: string) {
    if (!selectedSiteId) {
      throw new Error(pick(locale, "Select a hospital first.", "癒쇱? 蹂묒썝???좏깮??二쇱꽭??"));
    }
    setLesionBoxBusyImageId(imageId);
    try {
      const updatedImage = await clearImageLesionBox(selectedSiteId, imageId, token);
      setSelectedCaseImages((current) =>
        current.map((image) =>
          image.image_id === updatedImage.image_id
            ? { ...image, ...updatedImage, preview_url: image.preview_url }
            : image
        )
      );
      setLesionPromptSaved((current) => ({ ...current, [imageId]: null }));
      setLesionPromptDrafts((current) => ({ ...current, [imageId]: null }));
      clearLiveLesionPreview(imageId);
    } finally {
      setLesionBoxBusyImageId(null);
    }
  }

  function updateLesionDraftFromPointer(imageId: string, clientX: number, clientY: number, element: HTMLDivElement) {
    const drawState = lesionDrawStateRef.current;
    if (!drawState || drawState.imageId !== imageId) {
      return;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const currentX = clamp01((clientX - rect.left) / rect.width);
    const currentY = clamp01((clientY - rect.top) / rect.height);
    const nextBox = normalizeBox({
      x0: drawState.x,
      y0: drawState.y,
      x1: currentX,
      y1: currentY,
    });
    setLesionPromptDrafts((current) => {
      if (areNormalizedBoxesEqual(current[imageId] ?? null, nextBox)) {
        return current;
      }
      return {
        ...current,
        [imageId]: nextBox,
      };
    });
  }

  function handleLesionPointerDown(imageId: string, event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    clearLiveLesionPreview(imageId);
    const startX = clamp01((event.clientX - rect.left) / rect.width);
    const startY = clamp01((event.clientY - rect.top) / rect.height);
    lesionDrawStateRef.current = {
      imageId,
      pointerId: event.pointerId,
      x: startX,
      y: startY,
    };
    setLesionPromptDrafts((current) => ({
      ...current,
      [imageId]: { x0: startX, y0: startY, x1: startX, y1: startY },
    }));
    element.setPointerCapture(event.pointerId);
  }

  function handleLesionPointerMove(imageId: string, event: ReactPointerEvent<HTMLDivElement>) {
    if (
      lesionDrawStateRef.current?.pointerId !== event.pointerId ||
      lesionDrawStateRef.current?.imageId !== imageId
    ) {
      return;
    }
    updateLesionDraftFromPointer(imageId, event.clientX, event.clientY, event.currentTarget);
  }

  async function finishLesionPointer(imageId: string, event: ReactPointerEvent<HTMLDivElement>) {
    const drawState = lesionDrawStateRef.current;
    if (!drawState || drawState.pointerId !== event.pointerId || drawState.imageId !== imageId) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const currentX = clamp01((event.clientX - rect.left) / rect.width);
    const currentY = clamp01((event.clientY - rect.top) / rect.height);
    const draftBox = normalizeBox({
      x0: drawState.x,
      y0: drawState.y,
      x1: currentX,
      y1: currentY,
    });
    setLesionPromptDrafts((current) => ({ ...current, [imageId]: draftBox }));
    lesionDrawStateRef.current = null;
    if (draftBox.x1 - draftBox.x0 < 0.01 || draftBox.y1 - draftBox.y0 < 0.01) {
      try {
        await clearSavedLesionPromptBox(imageId);
      } catch (nextError) {
        setLesionPromptDrafts((current) => ({ ...current, [imageId]: lesionPromptSaved[imageId] ?? null }));
        setToast({
          tone: "error",
          message: describeError(nextError, pick(locale, "Unable to clear lesion box.", "蹂묐? 諛뺤뒪瑜?吏?곗? 紐삵뻽?듬땲??")),
        });
      }
      return;
    }
    try {
      await persistLesionPromptBox(imageId, draftBox);
    } catch (nextError) {
      setLesionPromptDrafts((current) => ({ ...current, [imageId]: lesionPromptSaved[imageId] ?? null }));
      setToast({
        tone: "error",
        message: describeError(nextError, pick(locale, "Unable to auto-save lesion box.", "蹂묐? 諛뺤뒪瑜??먮룞 ??ν븯吏 紐삵뻽?듬땲??")),
      });
    }
  }

  async function persistChangedLesionBoxes() {
    for (const imageId of lesionBoxChangedImageIds) {
      const draftBox = lesionPromptDrafts[imageId];
      if (draftBox) {
        await persistLesionPromptBox(imageId, draftBox);
      }
    }
  }

  async function handleRunLesionPreview() {
    if (!selectedSiteId || !selectedCase) {
      setToast({
        tone: "error",
        message: pick(locale, "Select a saved case before running lesion preview.", "蹂묐? crop 誘몃━蹂닿린瑜??ㅽ뻾?섎젮硫????耳?댁뒪瑜??좏깮??二쇱꽭??"),
      });
      return;
    }
    const hasAnyDraftBox = Object.values(lesionPromptDrafts).some((value) => value);
    if (!hasAnyDraftBox && !hasAnySavedLesionBox) {
      setToast({
        tone: "error",
        message: pick(locale, "Draw and save at least one lesion box first.", "蹂묐? 諛뺤뒪瑜??섎굹 ?댁긽 洹몃┛ ????ν빐 二쇱꽭??"),
      });
      return;
    }

    setLesionPreviewBusy(true);
    clearLesionPreview();
    setPanelOpen(true);
    try {
      if (lesionBoxChangedImageIds.length > 0) {
        await persistChangedLesionBoxes();
      }
      const previews = await fetchCaseLesionPreview(
        selectedSiteId,
        selectedCase.patient_id,
        selectedCase.visit_date,
        token
      );
      const nextItems = await Promise.all(
        previews.map(async (item) => {
          const nextCard: LesionPreviewCard = {
            ...item,
            source_preview_url: null,
            lesion_crop_url: null,
            lesion_mask_url: null,
          };
          if (item.image_id) {
            try {
              const sourceUrl = await fetchImagePreviewUrl(selectedSiteId, item.image_id, token, { maxSide: 640 });
              if (sourceUrl) {
                lesionPreviewUrlsRef.current.push(sourceUrl);
              }
              nextCard.source_preview_url = sourceUrl;
            } catch {
              nextCard.source_preview_url = null;
            }
            if (item.has_lesion_crop) {
              try {
                const cropUrl = await fetchCaseLesionPreviewArtifactUrl(
                  selectedSiteId,
                  selectedCase.patient_id,
                  selectedCase.visit_date,
                  item.image_id,
                  "lesion_crop",
                  token
                );
                if (cropUrl) {
                  lesionPreviewUrlsRef.current.push(cropUrl);
                }
                nextCard.lesion_crop_url = cropUrl;
              } catch {
                nextCard.lesion_crop_url = null;
              }
            }
            if (item.has_lesion_mask) {
              try {
                const maskUrl = await fetchCaseLesionPreviewArtifactUrl(
                  selectedSiteId,
                  selectedCase.patient_id,
                  selectedCase.visit_date,
                  item.image_id,
                  "lesion_mask",
                  token
                );
                if (maskUrl) {
                  lesionPreviewUrlsRef.current.push(maskUrl);
                }
                nextCard.lesion_mask_url = maskUrl;
              } catch {
                nextCard.lesion_mask_url = null;
              }
            }
          }
          return nextCard;
        })
      );
      setLesionPreviewItems(nextItems);
      onArtifactsChanged?.();
      setToast({
        tone: "success",
        message: pick(
          locale,
          `Lesion preview generated for ${selectedCase.patient_id} / ${selectedCase.visit_date}.`,
          `${selectedCase.patient_id} / ${selectedCase.visit_date} 蹂묐? crop 誘몃━蹂닿린瑜??앹꽦?덉뒿?덈떎.`
        ),
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, pick(locale, "Lesion preview failed.", "蹂묐? crop 誘몃━蹂닿린???ㅽ뙣?덉뒿?덈떎.")),
      });
    } finally {
      setLesionPreviewBusy(false);
    }
  }

  async function handleSetSavedRepresentative(imageId: string) {
    if (!selectedSiteId || !selectedCase) {
      setToast({ tone: "error", message: copy.selectSiteForCase });
      return;
    }
    const targetImage = selectedCaseImages.find((image) => image.image_id === imageId);
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
      onSavedImageDataChanged?.();
      setSelectedCaseImages((current) =>
        current.map((image) => ({
          ...image,
          is_representative: image.image_id === imageId,
        }))
      );
      const nextCases = await fetchCases(selectedSiteId, token, { mine: showOnlyMine });
      setCases(nextCases);
      const refreshedCase =
        nextCases.find((item) => item.case_id === selectedCase.case_id) ??
        nextCases.find(
          (item) => item.patient_id === selectedCase.patient_id && item.visit_date === selectedCase.visit_date
        ) ??
        null;
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

  async function handleReviewSemanticPrompts(imageId: string) {
    if (!selectedSiteId) {
      setToast({ tone: "error", message: copy.selectSiteForCase });
      return;
    }
    if (semanticPromptOpenImageIds.includes(imageId) && semanticPromptReviews[imageId]) {
      setSemanticPromptOpenImageIds((current) => current.filter((item) => item !== imageId));
      return;
    }
    if (semanticPromptReviews[imageId]) {
      setSemanticPromptErrors((current) => {
        const next = { ...current };
        delete next[imageId];
        return next;
      });
      setSemanticPromptOpenImageIds((current) => (current.includes(imageId) ? current : [...current, imageId]));
      return;
    }

    setSemanticPromptBusyImageId(imageId);
    setSemanticPromptErrors((current) => {
      const next = { ...current };
      delete next[imageId];
      return next;
    });
    try {
      const review = await fetchImageSemanticPromptScores(selectedSiteId, imageId, token, {
        top_k: 3,
        input_mode: "source",
      });
      setSemanticPromptReviews((current) => ({
        ...current,
        [imageId]: review,
      }));
      setSemanticPromptOpenImageIds((current) => (current.includes(imageId) ? current : [...current, imageId]));
    } catch (nextError) {
      const fallback = pick(locale, "BiomedCLIP analysis failed.", "BiomedCLIP 遺꾩꽍 ?ㅽ뻾???ㅽ뙣?덉뒿?덈떎.");
      const message = describeError(nextError, fallback);
      setSemanticPromptErrors((current) => ({
        ...current,
        [imageId]: message,
      }));
      setSemanticPromptOpenImageIds((current) => (current.includes(imageId) ? current : [...current, imageId]));
      setToast({ tone: "error", message });
    } finally {
      setSemanticPromptBusyImageId((current) => (current === imageId ? null : current));
    }
  }

  async function handleRunRoiPreview() {
    if (!selectedSiteId || !selectedCase) {
      setToast({ tone: "error", message: copy.selectSavedCaseForRoi });
      return;
    }

    setRoiPreviewBusy(true);
    clearRoiPreview();
    setPanelOpen(true);
    try {
      const previews = await fetchCaseRoiPreview(
        selectedSiteId,
        selectedCase.patient_id,
        selectedCase.visit_date,
        token
      );
      const nextItems = await Promise.all(
        previews.map(async (item) => {
          const nextCard: RoiPreviewCard = {
            ...item,
            source_preview_url: null,
            roi_crop_url: null,
            medsam_mask_url: null,
          };
          if (item.image_id) {
            try {
              const sourceUrl = await fetchImagePreviewUrl(selectedSiteId, item.image_id, token, { maxSide: 640 });
              if (sourceUrl) {
                roiPreviewUrlsRef.current.push(sourceUrl);
              }
              nextCard.source_preview_url = sourceUrl;
            } catch {
              nextCard.source_preview_url = null;
            }
            if (item.has_roi_crop) {
              try {
                const roiUrl = await fetchCaseRoiPreviewArtifactUrl(
                  selectedSiteId,
                  selectedCase.patient_id,
                  selectedCase.visit_date,
                  item.image_id,
                  "roi_crop",
                  token
                );
                if (roiUrl) {
                  roiPreviewUrlsRef.current.push(roiUrl);
                }
                nextCard.roi_crop_url = roiUrl;
              } catch {
                nextCard.roi_crop_url = null;
              }
            }
            if (item.has_medsam_mask) {
              try {
                const maskUrl = await fetchCaseRoiPreviewArtifactUrl(
                  selectedSiteId,
                  selectedCase.patient_id,
                  selectedCase.visit_date,
                  item.image_id,
                  "medsam_mask",
                  token
                );
                if (maskUrl) {
                  roiPreviewUrlsRef.current.push(maskUrl);
                }
                nextCard.medsam_mask_url = maskUrl;
              } catch {
                nextCard.medsam_mask_url = null;
              }
            }
          }
          return nextCard;
        })
      );
      setRoiPreviewItems(nextItems);
      onArtifactsChanged?.();
      setToast({
        tone: "success",
        message: copy.roiPreviewGenerated(selectedCase.patient_id, selectedCase.visit_date),
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, copy.roiPreviewFailed),
      });
    } finally {
      setRoiPreviewBusy(false);
    }
  }

  async function handleRunValidation() {
    if (!selectedSiteId || !selectedCase) {
      setToast({ tone: "error", message: copy.selectSavedCaseForValidation });
      return;
    }

    const requestedModelVersionIds = normalizeSelectedCompareModelVersionIds();
    const previousValidationModelVersionId = String(validationResult?.model_version.version_id || "").trim() || null;
    const previousExecutionMode = executionModeFromDevice(validationResult?.execution_device);

    setValidationBusy(true);
    setModelCompareBusy(requestedModelVersionIds.length > 0);
    clearValidationArtifacts();
    setValidationResult(null);
    setModelCompareResult(null);
    setContributionResult(null);
    setPanelOpen(true);
    try {
      let result: CaseValidationResponse;
      let autoCompareCount = 0;

      if (requestedModelVersionIds.length > 0) {
        const compareResult = await runCaseValidationCompare(selectedSiteId, token, {
          patient_id: selectedCase.patient_id,
          visit_date: selectedCase.visit_date,
          model_version_ids: requestedModelVersionIds,
          execution_mode: previousExecutionMode,
        });
        setModelCompareResult(compareResult);
        autoCompareCount = compareResult.comparisons.length;

        const anchorModelVersionId = resolveAnchorModelVersionId(
          compareResult,
          requestedModelVersionIds,
          previousValidationModelVersionId,
        );
        if (!anchorModelVersionId) {
          throw new Error(
            pick(
              locale,
              "No selected model completed successfully for anchor validation.",
              "anchor validation을 진행할 수 있는 모델이 없습니다."
            )
          );
        }

        result = await runAnchorValidation({
          patientId: selectedCase.patient_id,
          visitDate: selectedCase.visit_date,
          modelVersionId: anchorModelVersionId,
          executionMode: executionModeFromDevice(compareResult.execution_device),
        });
      } else {
        result = await runAnchorValidation({
          patientId: selectedCase.patient_id,
          visitDate: selectedCase.visit_date,
          modelVersionId: previousValidationModelVersionId,
          executionMode: previousExecutionMode,
        });
      }

      await onSiteDataChanged(selectedSiteId);
      await loadCaseHistory(selectedSiteId, selectedCase.patient_id, selectedCase.visit_date);
      await loadSiteActivity(selectedSiteId);
      await onValidationCompleted?.({
        siteId: selectedSiteId,
        selectedCase,
        result,
      });
      onArtifactsChanged?.();
      setToast({
        tone: "success",
        message:
          autoCompareCount > 0
            ? pick(
                locale,
                `${copy.validationSaved(selectedCase.patient_id, selectedCase.visit_date)} ${autoCompareCount}-model analysis refreshed.`,
                `${copy.validationSaved(selectedCase.patient_id, selectedCase.visit_date)} ${autoCompareCount}媛?紐⑤뜽 遺꾩꽍???④퍡 媛깆떊?덉뒿?덈떎.`
              )
            : copy.validationSaved(selectedCase.patient_id, selectedCase.visit_date),
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, copy.validationFailed),
      });
    } finally {
      setValidationBusy(false);
      setModelCompareBusy(false);
    }
  }

  async function handleRunModelCompare() {
    if (!selectedSiteId || !selectedCase) {
      setToast({ tone: "error", message: copy.selectSavedCaseForValidation });
      return;
    }
    const requestedModelVersionIds = normalizeSelectedCompareModelVersionIds();
    if (requestedModelVersionIds.length === 0) {
      setToast({
        tone: "error",
        message: pick(locale, "Select at least one model version for comparison.", "鍮꾧탳??紐⑤뜽 踰꾩쟾???섎굹 ?댁긽 ?좏깮??二쇱꽭??"),
      });
      return;
    }

    setModelCompareBusy(true);
    setModelCompareResult(null);
    setPanelOpen(true);
    try {
      const result = await runCaseValidationCompare(selectedSiteId, token, {
        patient_id: selectedCase.patient_id,
        visit_date: selectedCase.visit_date,
        model_version_ids: requestedModelVersionIds,
        execution_mode: executionModeFromDevice(validationResult?.execution_device),
      });
      setModelCompareResult(result);
      setToast({
        tone: "success",
        message: pick(locale, `Compared ${result.comparisons.length} model(s).`, `${result.comparisons.length}媛?紐⑤뜽 鍮꾧탳瑜??꾨즺?덉뒿?덈떎.`),
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, pick(locale, "Unable to compare models for this case.", "??耳?댁뒪??紐⑤뜽 鍮꾧탳瑜??ㅽ뻾?????놁뒿?덈떎.")),
      });
    } finally {
      setModelCompareBusy(false);
    }
  }

  async function handleRunAiClinic() {
    if (!selectedSiteId || !selectedCase) {
      setToast({ tone: "error", message: copy.selectSavedCaseForValidation });
      return;
    }
    if (!validationResult) {
      setToast({ tone: "error", message: copy.selectValidationBeforeAiClinic });
      return;
    }

    clearAiClinicPreview();
    setAiClinicBusy(true);
    setPanelOpen(true);
    const requestId = aiClinicRequestRef.current;
    try {
      const result = await runCaseAiClinicSimilarCases(selectedSiteId, token, {
        patient_id: selectedCase.patient_id,
        visit_date: selectedCase.visit_date,
        execution_mode: executionModeFromDevice(validationResult.execution_device),
        model_version_id: validationResult.model_version.version_id,
        top_k: 3,
        retrieval_backend: AI_CLINIC_LITE_RETRIEVAL_BACKEND,
      });
      if (aiClinicRequestRef.current !== requestId) {
        return;
      }
      const nextResult = withAiClinicSimilarCasePreviews(result, null);
      const previewRequestId = aiClinicPreviewRequestRef.current;
      setAiClinicResult(nextResult);
      setToast({
        tone: "success",
        message: copy.aiClinicReady(nextResult.similar_cases.length),
      });
      void hydrateAiClinicSimilarCasePreviews(nextResult.similar_cases, previewRequestId);
    } catch (nextError) {
      if (aiClinicRequestRef.current === requestId) {
        setToast({
          tone: "error",
          message: describeError(nextError, copy.aiClinicFailed),
        });
      }
    } finally {
      if (aiClinicRequestRef.current === requestId) {
        setAiClinicBusy(false);
      }
    }
  }

  async function handleExpandAiClinic() {
    if (!selectedSiteId || !selectedCase) {
      setToast({ tone: "error", message: copy.selectSavedCaseForValidation });
      return;
    }
    if (!validationResult) {
      setToast({ tone: "error", message: copy.selectValidationBeforeAiClinic });
      return;
    }
    if (!aiClinicResult) {
      setToast({ tone: "error", message: copy.aiClinicExpandFirst });
      return;
    }

    const previousResult = aiClinicResult;
    const requestId = aiClinicRequestRef.current + 1;
    aiClinicRequestRef.current = requestId;
    setAiClinicExpandedBusy(true);
    setPanelOpen(true);
    try {
      const result = await runCaseAiClinic(selectedSiteId, token, {
        patient_id: selectedCase.patient_id,
        visit_date: selectedCase.visit_date,
        execution_mode: executionModeFromDevice(validationResult.execution_device),
        model_version_id: validationResult.model_version.version_id,
        top_k: 3,
        retrieval_backend: AI_CLINIC_LITE_RETRIEVAL_BACKEND,
      });
      if (aiClinicRequestRef.current !== requestId) {
        return;
      }
      const nextResult = withAiClinicSimilarCasePreviews(result, previousResult);
      const previewRequestId = aiClinicPreviewRequestRef.current + 1;
      aiClinicPreviewRequestRef.current = previewRequestId;
      setAiClinicResult(nextResult);
      void hydrateAiClinicSimilarCasePreviews(nextResult.similar_cases, previewRequestId);
      setToast({
        tone: "success",
        message: copy.aiClinicExpandedReady,
      });
    } catch (nextError) {
      if (aiClinicRequestRef.current === requestId) {
        setToast({
          tone: "error",
          message: describeError(nextError, copy.aiClinicFailed),
        });
      }
    } finally {
      if (aiClinicRequestRef.current === requestId) {
        setAiClinicExpandedBusy(false);
      }
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
  };
}
