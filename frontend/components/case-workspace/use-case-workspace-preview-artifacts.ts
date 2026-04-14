"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import {
  fetchCaseLesionPreview,
  fetchCaseLesionPreviewArtifactUrl,
  fetchCaseRoiPreview,
  fetchCaseRoiPreviewArtifactUrl,
  fetchImagePreviewUrl,
  type CaseSummaryRecord,
} from "../../lib/api";
import type { Locale } from "../../lib/i18n";
import type {
  LesionBoxMap,
  LesionPreviewCard,
  LiveLesionPreviewMap,
  LocalePick,
  RoiPreviewCard,
  SavedImagePreview,
} from "./shared";
import {
  applyLesionPreviewFlags,
  applyRoiPreviewFlags,
  buildLesionPreviewCards,
  buildRoiPreviewCards,
  mergeResolvedPreviewUrls,
  revokeObjectUrls,
} from "./case-workspace-preview-artifact-helpers";
import {
  resolveSavedImageLesionCropArtifacts,
  resolveSavedImageRoiCropArtifacts,
} from "./case-workspace-preview-artifact-runtime";

type ToastState = {
  tone: "success" | "error";
  message: string;
} | null;

type PreviewCopy = {
  selectSavedCaseForRoi: string;
  roiPreviewGenerated: (patientId: string, visitDate: string) => string;
  roiPreviewFailed: string;
};

type Args = {
  locale: Locale;
  token: string;
  selectedSiteId: string | null;
  selectedCase: CaseSummaryRecord | null;
  selectedCaseImages: SavedImagePreview[];
  semanticPromptInputMode: "source" | "roi_crop" | "lesion_crop";
  liveLesionPreviews: LiveLesionPreviewMap;
  lesionPromptDrafts: LesionBoxMap;
  hasAnySavedLesionBox: boolean;
  pick: LocalePick;
  describeError: (error: unknown, fallback: string) => string;
  setToast: Dispatch<SetStateAction<ToastState>>;
  setPanelOpen: Dispatch<SetStateAction<boolean>>;
  setSelectedCaseImages: Dispatch<SetStateAction<SavedImagePreview[]>>;
  persistChangedLesionBoxes: () => Promise<void>;
  onArtifactsChanged?: () => void;
  copy: PreviewCopy;
};

export function useCaseWorkspacePreviewArtifacts({
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
  copy,
}: Args) {
  const [roiPreviewBusy, setRoiPreviewBusy] = useState(false);
  const [roiPreviewItems, setRoiPreviewItems] = useState<RoiPreviewCard[]>([]);
  const [lesionPreviewBusy, setLesionPreviewBusy] = useState(false);
  const [lesionPreviewItems, setLesionPreviewItems] = useState<
    LesionPreviewCard[]
  >([]);
  const [savedImageRoiCropUrls, setSavedImageRoiCropUrls] = useState<
    Record<string, string | null>
  >({});
  const [savedImageRoiCropBusy, setSavedImageRoiCropBusy] = useState(false);
  const [savedImageLesionCropUrls, setSavedImageLesionCropUrls] = useState<
    Record<string, string | null>
  >({});
  const [savedImageLesionCropBusy, setSavedImageLesionCropBusy] =
    useState(false);

  const roiPreviewUrlsRef = useRef<string[]>([]);
  const lesionPreviewUrlsRef = useRef<string[]>([]);
  const savedImageRoiCropUrlsRef = useRef<string[]>([]);
  const savedImageLesionCropUrlsRef = useRef<string[]>([]);

  const clearRoiPreview = useCallback(() => {
    revokeObjectUrls(roiPreviewUrlsRef.current);
    roiPreviewUrlsRef.current = [];
    setRoiPreviewItems([]);
    setRoiPreviewBusy(false);
  }, []);

  const clearLesionPreview = useCallback(() => {
    revokeObjectUrls(lesionPreviewUrlsRef.current);
    lesionPreviewUrlsRef.current = [];
    setLesionPreviewItems([]);
    setLesionPreviewBusy(false);
  }, []);

  const clearSavedImageRoiCrops = useCallback(() => {
    revokeObjectUrls(savedImageRoiCropUrlsRef.current);
    savedImageRoiCropUrlsRef.current = [];
    setSavedImageRoiCropUrls({});
    setSavedImageRoiCropBusy(false);
  }, []);

  const clearSavedImageLesionCrops = useCallback(() => {
    revokeObjectUrls(savedImageLesionCropUrlsRef.current);
    savedImageLesionCropUrlsRef.current = [];
    setSavedImageLesionCropUrls({});
    setSavedImageLesionCropBusy(false);
  }, []);

  const resetPreviewArtifacts = useCallback(() => {
    clearRoiPreview();
    clearLesionPreview();
    clearSavedImageRoiCrops();
    clearSavedImageLesionCrops();
  }, [
    clearLesionPreview,
    clearRoiPreview,
    clearSavedImageLesionCrops,
    clearSavedImageRoiCrops,
  ]);

  useEffect(() => {
    return () => revokeObjectUrls(roiPreviewUrlsRef.current);
  }, []);

  useEffect(() => {
    return () => revokeObjectUrls(lesionPreviewUrlsRef.current);
  }, []);

  useEffect(() => {
    return () => revokeObjectUrls(savedImageRoiCropUrlsRef.current);
  }, []);

  useEffect(() => {
    return () => revokeObjectUrls(savedImageLesionCropUrlsRef.current);
  }, []);

  useEffect(() => {
    if (
      semanticPromptInputMode !== "roi_crop" ||
      !selectedSiteId ||
      !selectedCase ||
      selectedCaseImages.length === 0
    ) {
      return;
    }

    let cancelled = false;
    setSavedImageRoiCropBusy(true);

    void (async () => {
      try {
        const { previewByImageId, entries, urls } =
          await resolveSavedImageRoiCropArtifacts({
            siteId: selectedSiteId,
            patientId: selectedCase.patient_id,
            visitDate: selectedCase.visit_date,
            token,
            images: selectedCaseImages,
            currentUrls: savedImageRoiCropUrls,
          });
        if (cancelled) {
          revokeObjectUrls(urls);
          return;
        }
        if (entries.length === 0) {
          return;
        }

        setSelectedCaseImages((current) =>
          applyRoiPreviewFlags(current, previewByImageId),
        );
        savedImageRoiCropUrlsRef.current.push(...urls);
        setSavedImageRoiCropUrls((current) =>
          mergeResolvedPreviewUrls(current, entries),
        );
      } catch (nextError) {
        if (!cancelled) {
          setToast({
            tone: "error",
            message: describeError(
              nextError,
              pick(
                locale,
                "Cornea crop preview failed.",
                "각막 crop 생성에 실패했습니다.",
              ),
            ),
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
    describeError,
    locale,
    pick,
    savedImageRoiCropUrls,
    selectedCase,
    selectedCaseImages,
    selectedSiteId,
    semanticPromptInputMode,
    setSelectedCaseImages,
    setToast,
    token,
  ]);

  useEffect(() => {
    if (
      semanticPromptInputMode !== "lesion_crop" ||
      !selectedSiteId ||
      !selectedCase ||
      selectedCaseImages.length === 0
    ) {
      return;
    }
    let cancelled = false;
    setSavedImageLesionCropBusy(true);

    void (async () => {
      try {
        const { previewByImageId, entries, urls } =
          await resolveSavedImageLesionCropArtifacts({
            siteId: selectedSiteId,
            patientId: selectedCase.patient_id,
            visitDate: selectedCase.visit_date,
            token,
            images: selectedCaseImages,
            liveLesionPreviews,
            currentUrls: savedImageLesionCropUrls,
          });
        if (cancelled) {
          revokeObjectUrls(urls);
          return;
        }
        if (previewByImageId.size > 0) {
          setSelectedCaseImages((current) =>
            applyLesionPreviewFlags(current, previewByImageId),
          );
        }
        if (entries.length === 0) {
          return;
        }

        savedImageLesionCropUrlsRef.current.push(...urls);
        setSavedImageLesionCropUrls((current) =>
          mergeResolvedPreviewUrls(current, entries),
        );
      } catch (nextError) {
        if (!cancelled) {
          setToast({
            tone: "error",
            message: describeError(
              nextError,
              pick(
                locale,
                "Lesion crop preview failed.",
                "병변 crop 생성에 실패했습니다.",
              ),
            ),
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
    describeError,
    liveLesionPreviews,
    locale,
    pick,
    savedImageLesionCropUrls,
    selectedCase,
    selectedCaseImages,
    selectedSiteId,
    semanticPromptInputMode,
    setSelectedCaseImages,
    setToast,
    token,
  ]);

  const handleRunLesionPreview = useCallback(async () => {
    if (!selectedSiteId || !selectedCase) {
      setToast({
        tone: "error",
        message: pick(
          locale,
          "Select a saved case before running lesion preview.",
          "병변 crop 미리보기를 실행하려면 저장된 케이스를 선택해 주세요.",
        ),
      });
      return;
    }
    const hasAnyDraftBox = Object.values(lesionPromptDrafts).some(
      (value) => value,
    );
    if (!hasAnyDraftBox && !hasAnySavedLesionBox) {
      setToast({
        tone: "error",
        message: pick(
          locale,
          "Draw and save at least one lesion box first.",
          "병변 박스를 하나 이상 그린 뒤 저장해 주세요.",
        ),
      });
      return;
    }

    setLesionPreviewBusy(true);
    clearLesionPreview();
    setPanelOpen(true);
    try {
      await persistChangedLesionBoxes();
      const previews = await fetchCaseLesionPreview(
        selectedSiteId,
        selectedCase.patient_id,
        selectedCase.visit_date,
        token,
      );
      const { cards: nextItems, urls } = await buildLesionPreviewCards({
        items: previews,
        fetchSourcePreviewUrl: (imageId) =>
          fetchImagePreviewUrl(selectedSiteId, imageId, token, {
            maxSide: 640,
          }),
        fetchLesionCropUrl: (imageId) =>
          fetchCaseLesionPreviewArtifactUrl(
            selectedSiteId,
            selectedCase.patient_id,
            selectedCase.visit_date,
            imageId,
            "lesion_crop",
            token,
          ),
        fetchLesionMaskUrl: (imageId) =>
          fetchCaseLesionPreviewArtifactUrl(
            selectedSiteId,
            selectedCase.patient_id,
            selectedCase.visit_date,
            imageId,
            "lesion_mask",
            token,
          ),
      });
      lesionPreviewUrlsRef.current.push(...urls);
      setLesionPreviewItems(nextItems);
      onArtifactsChanged?.();
      setToast({
        tone: "success",
        message: pick(
          locale,
          `Lesion preview generated for ${selectedCase.patient_id} / ${selectedCase.visit_date}.`,
          `${selectedCase.patient_id} / ${selectedCase.visit_date} 병변 crop 미리보기를 생성했습니다.`,
        ),
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(
          nextError,
          pick(
            locale,
            "Lesion preview failed.",
            "병변 crop 미리보기에 실패했습니다.",
          ),
        ),
      });
    } finally {
      setLesionPreviewBusy(false);
    }
  }, [
    clearLesionPreview,
    describeError,
    hasAnySavedLesionBox,
    lesionPromptDrafts,
    locale,
    onArtifactsChanged,
    persistChangedLesionBoxes,
    pick,
    selectedCase,
    selectedSiteId,
    setPanelOpen,
    setToast,
    token,
  ]);

  const handleRunRoiPreview = useCallback(async () => {
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
        token,
      );
      const { cards: nextItems, urls } = await buildRoiPreviewCards({
        items: previews,
        fetchSourcePreviewUrl: (imageId) =>
          fetchImagePreviewUrl(selectedSiteId, imageId, token, {
            maxSide: 640,
          }),
        fetchRoiCropUrl: (imageId) =>
          fetchCaseRoiPreviewArtifactUrl(
            selectedSiteId,
            selectedCase.patient_id,
            selectedCase.visit_date,
            imageId,
            "roi_crop",
            token,
          ),
        fetchMedsamMaskUrl: (imageId) =>
          fetchCaseRoiPreviewArtifactUrl(
            selectedSiteId,
            selectedCase.patient_id,
            selectedCase.visit_date,
            imageId,
            "medsam_mask",
            token,
          ),
      });
      roiPreviewUrlsRef.current.push(...urls);
      setRoiPreviewItems(nextItems);
      onArtifactsChanged?.();
      setToast({
        tone: "success",
        message: copy.roiPreviewGenerated(
          selectedCase.patient_id,
          selectedCase.visit_date,
        ),
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, copy.roiPreviewFailed),
      });
    } finally {
      setRoiPreviewBusy(false);
    }
  }, [
    clearRoiPreview,
    copy,
    describeError,
    onArtifactsChanged,
    selectedCase,
    selectedSiteId,
    setPanelOpen,
    setToast,
    token,
  ]);

  return {
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
  };
}
