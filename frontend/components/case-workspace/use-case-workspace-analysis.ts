"use client";

import { type PointerEvent as ReactPointerEvent, type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";

import {
  clearImageLesionBox,
  fetchCaseLesionPreview,
  fetchStoredCaseLesionPreview,
  fetchCaseLesionPreviewArtifactBlob,
  fetchCaseRoiPreview,
  fetchCaseRoiPreviewArtifactBlob,
  fetchCases,
  fetchImageBlob,
  fetchImageSemanticPromptScores,
  fetchLiveLesionPreviewJob,
  fetchValidationArtifactBlob,
  runCaseAiClinic,
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

type ValidationArtifactKind = "gradcam" | "roi_crop" | "medsam_mask" | "lesion_crop" | "lesion_mask";
type ValidationArtifactPreviews = Partial<Record<ValidationArtifactKind, string | null>>;

type AnalysisCopy = {
  selectSavedCaseForRoi: string;
  roiPreviewGenerated: (patientId: string, visitDate: string) => string;
  roiPreviewFailed: string;
  selectSavedCaseForValidation: string;
  validationSaved: (patientId: string, visitDate: string) => string;
  validationFailed: string;
  selectValidationBeforeAiClinic: string;
  aiClinicReady: (count: number) => string;
  aiClinicFailed: string;
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
  loadSiteActivity: (siteId: string) => Promise<void>;
  onSiteDataChanged: (siteId: string) => Promise<void>;
  onValidationCompleted?: (args: {
    siteId: string;
    selectedCase: CaseSummaryRecord;
    result: CaseValidationResponse;
  }) => Promise<void> | void;
};

function revokeUrls(urls: string[]) {
  for (const url of urls) {
    URL.revokeObjectURL(url);
  }
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
  onValidationCompleted,
}: Args) {
  const [validationBusy, setValidationBusy] = useState(false);
  const [validationResult, setValidationResult] = useState<CaseValidationResponse | null>(null);
  const [modelCompareBusy, setModelCompareBusy] = useState(false);
  const [modelCompareResult, setModelCompareResult] = useState<CaseValidationCompareResponse | null>(null);
  const [validationArtifacts, setValidationArtifacts] = useState<ValidationArtifactPreviews>({});
  const [aiClinicBusy, setAiClinicBusy] = useState(false);
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
  const [lesionPromptDrafts, setLesionPromptDrafts] = useState<LesionBoxMap>({});
  const [lesionPromptSaved, setLesionPromptSaved] = useState<LesionBoxMap>({});
  const [lesionBoxBusyImageId, setLesionBoxBusyImageId] = useState<string | null>(null);
  const [representativeBusyImageId, setRepresentativeBusyImageId] = useState<string | null>(null);

  const validationArtifactUrlsRef = useRef<string[]>([]);
  const aiClinicPreviewUrlsRef = useRef<string[]>([]);
  const roiPreviewUrlsRef = useRef<string[]>([]);
  const lesionPreviewUrlsRef = useRef<string[]>([]);
  const liveLesionPreviewUrlsRef = useRef<Record<string, string[]>>({});
  const liveLesionPreviewRequestRef = useRef<Record<string, number>>({});
  const liveLesionPreviewsRef = useRef<LiveLesionPreviewMap>({});
  const lesionDrawStateRef = useRef<{ imageId: string; pointerId: number; x: number; y: number } | null>(null);
  const selectedCaseImagesRef = useRef(selectedCaseImages);
  selectedCaseImagesRef.current = selectedCaseImages;
  const caseImagesKey = `${selectedCase?.case_id ?? ""}:${selectedCaseImages.map((i) => i.image_id).join(",")}`;

  const representativeSavedImage = selectedCaseImages.find((image) => image.is_representative) ?? null;
  const lesionBoxChangedImageIds = selectedCaseImages
    .map((image) => image.image_id)
    .filter((imageId) => JSON.stringify(lesionPromptDrafts[imageId] ?? null) !== JSON.stringify(lesionPromptSaved[imageId] ?? null));
  const hasAnySavedLesionBox = Object.values(lesionPromptSaved).some((value) => value);

  function clearValidationArtifacts() {
    revokeUrls(validationArtifactUrlsRef.current);
    validationArtifactUrlsRef.current = [];
    setValidationArtifacts({});
  }

  function clearAiClinicPreview() {
    revokeUrls(aiClinicPreviewUrlsRef.current);
    aiClinicPreviewUrlsRef.current = [];
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
    setValidationResult(null);
    setModelCompareResult(null);
    setCaseHistory(null);
    setContributionResult(null);
    setLesionPromptDrafts({});
    setLesionPromptSaved({});
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
  }, [selectedCase?.case_id, selectedSiteId, semanticPromptInputMode]);

  useEffect(() => {
    clearLiveLesionPreview();
  }, [selectedSiteId]);

  useEffect(() => {
    let cancelled = false;
    let hydrateTimer: number | null = null;

    async function hydrateStoredCaseLesionPreviews() {
      if (!liveLesionCropEnabled || !selectedSiteId) {
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
              const maskBlob = await fetchCaseLesionPreviewArtifactBlob(
                selectedSiteId,
                patientId,
                visitDate,
                image.image_id,
                "lesion_mask",
                token
              );
              const lesionMaskUrl = URL.createObjectURL(maskBlob);
              nextUrls.push(lesionMaskUrl);

              let lesionCropUrl: string | null = null;
              if (preview.has_lesion_crop) {
                try {
                  const cropBlob = await fetchCaseLesionPreviewArtifactBlob(
                    selectedSiteId,
                    patientId,
                    visitDate,
                    image.image_id,
                    "lesion_crop",
                    token
                  );
                  lesionCropUrl = URL.createObjectURL(cropBlob);
                  nextUrls.push(lesionCropUrl);
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
  }, [liveLesionCropEnabled, caseImagesKey, selectedSiteId, toNormalizedBox, token]);

  useEffect(() => {
    if (!liveLesionCropEnabled) {
      clearLiveLesionPreview();
    }
  }, [liveLesionCropEnabled]);

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
    setValidationResult(null);
    setModelCompareResult(null);
    setCaseHistory(null);
    setContributionResult(null);
  }, [selectedCase, selectedSiteId]);

  async function hydrateLiveLesionPreview(imageId: string, job: LiveLesionPreviewJobResponse, requestVersion: number) {
    if (!selectedSiteId || liveLesionPreviewRequestRef.current[imageId] !== requestVersion) {
      return;
    }

    const nextUrls: string[] = [];
    let lesionMaskUrl: string | null = null;
    let lesionCropUrl: string | null = null;

    if (job.has_lesion_mask) {
      try {
        const maskBlob = await fetchCaseLesionPreviewArtifactBlob(
          selectedSiteId,
          job.patient_id,
          job.visit_date,
          imageId,
          "lesion_mask",
          token
        );
        lesionMaskUrl = URL.createObjectURL(maskBlob);
        nextUrls.push(lesionMaskUrl);
      } catch {
        lesionMaskUrl = null;
      }
    }

    if (job.has_lesion_crop) {
      try {
        const cropBlob = await fetchCaseLesionPreviewArtifactBlob(
          selectedSiteId,
          job.patient_id,
          job.visit_date,
          imageId,
          "lesion_crop",
          token
        );
        lesionCropUrl = URL.createObjectURL(cropBlob);
        nextUrls.push(lesionCropUrl);
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
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 700));
      if (liveLesionPreviewRequestRef.current[imageId] !== requestVersion) {
        return;
      }
      try {
        const job = await fetchLiveLesionPreviewJob(selectedSiteId, imageId, jobId, token);
        if (liveLesionPreviewRequestRef.current[imageId] !== requestVersion) {
          return;
        }
        if (job.status === "running") {
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
          continue;
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
              error: job.error ?? pick(locale, "Live MedSAM preview failed.", "실시간 MedSAM 미리보기에 실패했습니다."),
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
              pick(locale, "Unable to check live MedSAM preview status.", "실시간 MedSAM 상태를 확인하지 못했습니다.")
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
        error: pick(locale, "Live MedSAM preview timed out.", "실시간 MedSAM 미리보기가 시간 초과되었습니다."),
        backend: current[imageId]?.backend ?? null,
        prompt_signature: current[imageId]?.prompt_signature ?? null,
        lesion_mask_url: current[imageId]?.lesion_mask_url ?? null,
        lesion_crop_url: current[imageId]?.lesion_crop_url ?? null,
      },
    }));
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
        pick(locale, "Unable to start live MedSAM preview.", "실시간 MedSAM 미리보기를 시작하지 못했습니다.")
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
      throw new Error(pick(locale, "Select a hospital first.", "먼저 병원을 선택해 주세요."));
    }
    setLesionBoxBusyImageId(imageId);
    try {
      const normalized = normalizeBox(nextBox);
      if (normalized.x1 - normalized.x0 < 0.01 || normalized.y1 - normalized.y0 < 0.01) {
        throw new Error(pick(locale, "Lesion box is too small.", "병변 박스가 너무 작습니다."));
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
      throw new Error(pick(locale, "Select a hospital first.", "먼저 병원을 선택해 주세요."));
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
    setLesionPromptDrafts((current) => ({
      ...current,
      [imageId]: normalizeBox({
        x0: drawState.x,
        y0: drawState.y,
        x1: currentX,
        y1: currentY,
      }),
    }));
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
          message: describeError(nextError, pick(locale, "Unable to clear lesion box.", "병변 박스를 지우지 못했습니다.")),
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
        message: describeError(nextError, pick(locale, "Unable to auto-save lesion box.", "병변 박스를 자동 저장하지 못했습니다.")),
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
        message: pick(locale, "Select a saved case before running lesion preview.", "병변 crop 미리보기를 실행하려면 저장 케이스를 선택해 주세요."),
      });
      return;
    }
    const hasAnyDraftBox = Object.values(lesionPromptDrafts).some((value) => value);
    if (!hasAnyDraftBox && !hasAnySavedLesionBox) {
      setToast({
        tone: "error",
        message: pick(locale, "Draw and save at least one lesion box first.", "병변 박스를 하나 이상 그린 뒤 저장해 주세요."),
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
              const sourceBlob = await fetchImageBlob(selectedSiteId, item.image_id, token);
              const sourceUrl = URL.createObjectURL(sourceBlob);
              lesionPreviewUrlsRef.current.push(sourceUrl);
              nextCard.source_preview_url = sourceUrl;
            } catch {
              nextCard.source_preview_url = null;
            }
            if (item.has_lesion_crop) {
              try {
                const cropBlob = await fetchCaseLesionPreviewArtifactBlob(
                  selectedSiteId,
                  selectedCase.patient_id,
                  selectedCase.visit_date,
                  item.image_id,
                  "lesion_crop",
                  token
                );
                const cropUrl = URL.createObjectURL(cropBlob);
                lesionPreviewUrlsRef.current.push(cropUrl);
                nextCard.lesion_crop_url = cropUrl;
              } catch {
                nextCard.lesion_crop_url = null;
              }
            }
            if (item.has_lesion_mask) {
              try {
                const maskBlob = await fetchCaseLesionPreviewArtifactBlob(
                  selectedSiteId,
                  selectedCase.patient_id,
                  selectedCase.visit_date,
                  item.image_id,
                  "lesion_mask",
                  token
                );
                const maskUrl = URL.createObjectURL(maskBlob);
                lesionPreviewUrlsRef.current.push(maskUrl);
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
      setToast({
        tone: "success",
        message: pick(
          locale,
          `Lesion preview generated for ${selectedCase.patient_id} / ${selectedCase.visit_date}.`,
          `${selectedCase.patient_id} / ${selectedCase.visit_date} 병변 crop 미리보기를 생성했습니다.`
        ),
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, pick(locale, "Lesion preview failed.", "병변 crop 미리보기에 실패했습니다.")),
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
        input_mode: semanticPromptInputMode,
      });
      setSemanticPromptReviews((current) => ({
        ...current,
        [imageId]: review,
      }));
      setSemanticPromptOpenImageIds((current) => (current.includes(imageId) ? current : [...current, imageId]));
    } catch (nextError) {
      const fallback = pick(locale, "BiomedCLIP analysis failed.", "BiomedCLIP 분석 실행에 실패했습니다.");
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
              const sourceBlob = await fetchImageBlob(selectedSiteId, item.image_id, token);
              const sourceUrl = URL.createObjectURL(sourceBlob);
              roiPreviewUrlsRef.current.push(sourceUrl);
              nextCard.source_preview_url = sourceUrl;
            } catch {
              nextCard.source_preview_url = null;
            }
            if (item.has_roi_crop) {
              try {
                const roiBlob = await fetchCaseRoiPreviewArtifactBlob(
                  selectedSiteId,
                  selectedCase.patient_id,
                  selectedCase.visit_date,
                  item.image_id,
                  "roi_crop",
                  token
                );
                const roiUrl = URL.createObjectURL(roiBlob);
                roiPreviewUrlsRef.current.push(roiUrl);
                nextCard.roi_crop_url = roiUrl;
              } catch {
                nextCard.roi_crop_url = null;
              }
            }
            if (item.has_medsam_mask) {
              try {
                const maskBlob = await fetchCaseRoiPreviewArtifactBlob(
                  selectedSiteId,
                  selectedCase.patient_id,
                  selectedCase.visit_date,
                  item.image_id,
                  "medsam_mask",
                  token
                );
                const maskUrl = URL.createObjectURL(maskBlob);
                roiPreviewUrlsRef.current.push(maskUrl);
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

    setValidationBusy(true);
    clearValidationArtifacts();
    setValidationResult(null);
    setModelCompareResult(null);
    setContributionResult(null);
    setPanelOpen(true);
    try {
      const result = await runCaseValidation(selectedSiteId, token, {
        patient_id: selectedCase.patient_id,
        visit_date: selectedCase.visit_date,
        model_version_id: validationResult?.model_version.version_id,
        model_version_ids: selectedCompareModelVersionIds,
      });
      const nextArtifacts: ValidationArtifactPreviews = {};
      const artifactKinds: ValidationArtifactKind[] = ["roi_crop", "gradcam", "medsam_mask", "lesion_crop", "lesion_mask"];

      for (const artifactKind of artifactKinds) {
        const isAvailable =
          artifactKind === "roi_crop"
            ? result.artifact_availability.roi_crop
            : artifactKind === "gradcam"
              ? result.artifact_availability.gradcam
              : artifactKind === "medsam_mask"
                ? result.artifact_availability.medsam_mask
                : artifactKind === "lesion_crop"
                  ? result.artifact_availability.lesion_crop
                  : result.artifact_availability.lesion_mask;
        if (!isAvailable) {
          continue;
        }
        try {
          const blob = await fetchValidationArtifactBlob(
            selectedSiteId,
            result.summary.validation_id,
            selectedCase.patient_id,
            selectedCase.visit_date,
            artifactKind,
            token
          );
          const url = URL.createObjectURL(blob);
          validationArtifactUrlsRef.current.push(url);
          nextArtifacts[artifactKind] = url;
        } catch {
          nextArtifacts[artifactKind] = null;
        }
      }

      setValidationArtifacts(nextArtifacts);
      setValidationResult(result);
      let autoCompareCount = 0;
      if (selectedCompareModelVersionIds.length > 0) {
        setModelCompareBusy(true);
        try {
          const compareResult = await runCaseValidationCompare(selectedSiteId, token, {
            patient_id: selectedCase.patient_id,
            visit_date: selectedCase.visit_date,
            model_version_ids: selectedCompareModelVersionIds,
            execution_mode: executionModeFromDevice(result.execution_device),
          });
          setModelCompareResult(compareResult);
          autoCompareCount = compareResult.comparisons.length;
        } catch {
          setModelCompareResult(null);
        } finally {
          setModelCompareBusy(false);
        }
      }
      await onSiteDataChanged(selectedSiteId);
      await loadCaseHistory(selectedSiteId, selectedCase.patient_id, selectedCase.visit_date);
      await loadSiteActivity(selectedSiteId);
      await onValidationCompleted?.({
        siteId: selectedSiteId,
        selectedCase,
        result,
      });
      setToast({
        tone: "success",
        message:
          autoCompareCount > 0
            ? pick(
                locale,
                `${copy.validationSaved(selectedCase.patient_id, selectedCase.visit_date)} ${autoCompareCount}-model analysis refreshed.`,
                `${copy.validationSaved(selectedCase.patient_id, selectedCase.visit_date)} ${autoCompareCount}개 모델 분석도 함께 갱신했습니다.`
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
    if (selectedCompareModelVersionIds.length === 0) {
      setToast({
        tone: "error",
        message: pick(locale, "Select at least one model version for comparison.", "비교할 모델 버전을 하나 이상 선택해 주세요."),
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
        model_version_ids: selectedCompareModelVersionIds,
        execution_mode: executionModeFromDevice(validationResult?.execution_device),
      });
      setModelCompareResult(result);
      setToast({
        tone: "success",
        message: pick(locale, `Compared ${result.comparisons.length} model(s).`, `${result.comparisons.length}개 모델 비교를 완료했습니다.`),
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, pick(locale, "Unable to compare models for this case.", "이 케이스의 모델 비교를 실행할 수 없습니다.")),
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

    setAiClinicBusy(true);
    clearAiClinicPreview();
    setPanelOpen(true);
    try {
      const result = await runCaseAiClinic(selectedSiteId, token, {
        patient_id: selectedCase.patient_id,
        visit_date: selectedCase.visit_date,
        execution_mode: executionModeFromDevice(validationResult.execution_device),
        model_version_id: validationResult.model_version.version_id,
        model_version_ids: selectedCompareModelVersionIds,
        top_k: 3,
        retrieval_backend: "hybrid",
      });
      const similarCases = await Promise.all(
        result.similar_cases.map(async (item) => {
          let previewUrl: string | null = null;
          if (item.representative_image_id) {
            try {
              const blob = await fetchImageBlob(selectedSiteId, item.representative_image_id, token);
              previewUrl = URL.createObjectURL(blob);
              aiClinicPreviewUrlsRef.current.push(previewUrl);
            } catch {
              previewUrl = null;
            }
          }
          return {
            ...item,
            preview_url: previewUrl,
          };
        })
      );
      setAiClinicResult({
        ...result,
        similar_cases: similarCases,
      });
      setToast({
        tone: "success",
        message: copy.aiClinicReady(similarCases.length),
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, copy.aiClinicFailed),
      });
    } finally {
      setAiClinicBusy(false);
    }
  }

  return {
    validationBusy,
    validationResult,
    modelCompareBusy,
    modelCompareResult,
    validationArtifacts,
    aiClinicBusy,
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
    handleRunRoiPreview,
    handleRunLesionPreview,
    handleSetSavedRepresentative,
    handleReviewSemanticPrompts,
    handleLesionPointerDown,
    handleLesionPointerMove,
    finishLesionPointer,
  };
}
