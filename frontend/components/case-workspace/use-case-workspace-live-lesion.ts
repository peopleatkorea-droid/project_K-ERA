"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import {
  fetchCaseLesionPreviewArtifactUrl,
  fetchStoredCaseLesionPreview,
  startLiveLesionPreview,
  type CaseSummaryRecord,
  type LiveLesionPreviewJobResponse,
} from "../../lib/api";
import type { Locale } from "../../lib/i18n";
import { waitForLiveLesionPreviewSettlement } from "../../lib/live-lesion-preview-runtime";
import { toNormalizedBox } from "./case-workspace-core-helpers";
import {
  buildFailedLiveLesionPreviewState,
  buildLesionPromptBoxMap,
  buildRunningLiveLesionPreviewState,
  groupImagesWithSavedLesionBoxes,
  hasSavedLesionPromptBox,
  listChangedLesionBoxImageIds,
  revokeObjectUrls,
} from "./case-workspace-live-lesion-helpers";
import {
  createCaseWorkspaceLiveLesionInteractions,
  type LesionDrawState,
} from "./case-workspace-live-lesion-interactions";
import {
  hydrateLiveLesionPreviewArtifacts,
  hydrateStoredCaseLesionPreviewGroups,
} from "./case-workspace-live-lesion-runtime";
import type {
  LesionBoxMap,
  LiveLesionPreviewMap,
  LocalePick,
  SavedImagePreview,
} from "./shared";

type ToastState = {
  tone: "success" | "error";
  message: string;
} | null;

type Args = {
  locale: Locale;
  token: string;
  selectedSiteId: string | null;
  selectedCase: CaseSummaryRecord | null;
  selectedCaseImages: SavedImagePreview[];
  pick: LocalePick;
  describeError: (error: unknown, fallback: string) => string;
  setToast: Dispatch<SetStateAction<ToastState>>;
  setSelectedCaseImages: Dispatch<SetStateAction<SavedImagePreview[]>>;
};

export function useCaseWorkspaceLiveLesion({
  locale,
  token,
  selectedSiteId,
  selectedCase,
  selectedCaseImages,
  pick,
  describeError,
  setToast,
  setSelectedCaseImages,
}: Args) {
  const [liveLesionCropEnabled, setLiveLesionCropEnabled] = useState(true);
  const [liveLesionPreviews, setLiveLesionPreviews] =
    useState<LiveLesionPreviewMap>({});
  const [lesionPromptDrafts, setLesionPromptDrafts] = useState<LesionBoxMap>(
    {},
  );
  const [lesionPromptSaved, setLesionPromptSaved] = useState<LesionBoxMap>({});
  const [lesionBoxBusyImageId, setLesionBoxBusyImageId] = useState<
    string | null
  >(null);

  const liveLesionPreviewUrlsRef = useRef<Record<string, string[]>>({});
  const liveLesionPreviewRequestRef = useRef<Record<string, number>>({});
  const liveLesionPreviewsRef = useRef<LiveLesionPreviewMap>({});
  const lesionDrawStateRef = useRef<LesionDrawState>(null);
  const selectedCaseImagesRef = useRef(selectedCaseImages);
  selectedCaseImagesRef.current = selectedCaseImages;
  const caseImagesKey = `${selectedCase?.case_id ?? ""}:${selectedCaseImages
    .map((image) => image.image_id)
    .join(",")}`;

  const lesionBoxChangedImageIds = listChangedLesionBoxImageIds(
    selectedCaseImages,
    lesionPromptDrafts,
    lesionPromptSaved,
  );
  const hasAnySavedLesionBox = hasSavedLesionPromptBox(lesionPromptSaved);

  const clearLiveLesionPreview = useCallback((imageId?: string) => {
    if (imageId) {
      revokeObjectUrls(liveLesionPreviewUrlsRef.current[imageId] ?? []);
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
      revokeObjectUrls(urls);
    }
    liveLesionPreviewUrlsRef.current = {};
    liveLesionPreviewRequestRef.current = {};
    setLiveLesionPreviews({});
  }, []);

  const resetLiveLesionState = useCallback(() => {
    clearLiveLesionPreview();
    setLesionPromptDrafts({});
    setLesionPromptSaved({});
    setLesionBoxBusyImageId(null);
  }, [clearLiveLesionPreview]);

  useEffect(() => {
    return () => {
      for (const urls of Object.values(liveLesionPreviewUrlsRef.current)) {
        revokeObjectUrls(urls);
      }
    };
  }, []);

  useEffect(() => {
    liveLesionPreviewsRef.current = liveLesionPreviews;
  }, [liveLesionPreviews]);

  useEffect(() => {
    const nextBoxes = buildLesionPromptBoxMap(selectedCaseImages, toNormalizedBox);
    setLesionPromptSaved(nextBoxes);
    setLesionPromptDrafts(nextBoxes);
  }, [selectedCase?.case_id, selectedCaseImages, toNormalizedBox]);

  useEffect(() => {
    clearLiveLesionPreview();
  }, [clearLiveLesionPreview, selectedSiteId]);

  useEffect(() => {
    let cancelled = false;
    let hydrateTimer: number | null = null;

    async function hydrateStoredCaseLesionPreviews() {
      if (!selectedSiteId) {
        return;
      }

      const boxedImageGroups = groupImagesWithSavedLesionBoxes(
        selectedCaseImagesRef.current,
        toNormalizedBox,
      );
      if (boxedImageGroups.length === 0) {
        return;
      }

      await hydrateStoredCaseLesionPreviewGroups({
        siteId: selectedSiteId,
        token,
        groups: boxedImageGroups,
        fetchStoredCaseLesionPreview,
        fetchCaseLesionPreviewArtifactUrl,
        revokeObjectUrls,
        shouldCancel: () => cancelled,
        getCurrentPreview: (imageId) =>
          liveLesionPreviewsRef.current[imageId],
        getCurrentUrls: (imageId) =>
          liveLesionPreviewUrlsRef.current[imageId] ?? [],
        setCurrentUrls: (imageId, urls) => {
          liveLesionPreviewUrlsRef.current[imageId] = urls;
        },
        onHydratedPreview: (imageId, nextState) => {
          setLiveLesionPreviews((current) => ({
            ...current,
            [imageId]: nextState,
          }));
        },
      });
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

  async function hydrateLiveLesionPreview(
    imageId: string,
    job: LiveLesionPreviewJobResponse,
    requestVersion: number,
  ) {
    if (!selectedSiteId) {
      return;
    }
    await hydrateLiveLesionPreviewArtifacts({
      siteId: selectedSiteId,
      token,
      imageId,
      job,
      requestVersion,
      fetchCaseLesionPreviewArtifactUrl,
      revokeObjectUrls,
      getCurrentRequestVersion: (currentImageId) =>
        liveLesionPreviewRequestRef.current[currentImageId],
      getCurrentPreview: (currentImageId) =>
        liveLesionPreviewsRef.current[currentImageId],
      getCurrentUrls: (currentImageId) =>
        liveLesionPreviewUrlsRef.current[currentImageId] ?? [],
      setCurrentUrls: (currentImageId, urls) => {
        liveLesionPreviewUrlsRef.current[currentImageId] = urls;
      },
      onHydratedPreview: (currentImageId, nextState) => {
        setLiveLesionPreviews((current) => ({
          ...current,
          [currentImageId]: nextState,
        }));
      },
    });
  }

  async function pollLiveLesionPreview(
    imageId: string,
    jobId: string,
    requestVersion: number,
  ) {
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
          return (
            liveLesionPreviewRequestRef.current[imageId] === requestVersion
          );
        },
        onRunning(job) {
          setLiveLesionPreviews((current) => ({
            ...current,
            [imageId]: buildRunningLiveLesionPreviewState(
              current[imageId],
              job,
            ),
          }));
        },
      });
      if (
        !job ||
        liveLesionPreviewRequestRef.current[imageId] !== requestVersion
      ) {
        return;
      }
      if (job.status === "failed") {
        setLiveLesionPreviews((current) => ({
          ...current,
          [imageId]: buildFailedLiveLesionPreviewState(current[imageId], {
            jobId: job.job_id,
            error:
              job.error ??
              pick(
                locale,
                "Live MedSAM preview failed.",
                "?ㅼ떆媛?MedSAM 誘몃━蹂닿린???ㅽ뙣?덉뒿?덈떎.",
              ),
            backend: job.backend ?? null,
            promptSignature: job.prompt_signature ?? null,
          }),
        }));
        return;
      }
      await hydrateLiveLesionPreview(imageId, job, requestVersion);
    } catch (nextError) {
      if (liveLesionPreviewRequestRef.current[imageId] !== requestVersion) {
        return;
      }
      setLiveLesionPreviews((current) => ({
        ...current,
        [imageId]: buildFailedLiveLesionPreviewState(current[imageId], {
          jobId,
          error: describeError(
            nextError,
            pick(
              locale,
              "Unable to check live MedSAM preview status.",
              "?ㅼ떆媛?MedSAM ?곹깭瑜??뺤씤?섏? 紐삵뻽?듬땲??",
            ),
          ),
          backend: current[imageId]?.backend ?? null,
          promptSignature: current[imageId]?.prompt_signature ?? null,
        }),
      }));
    }
  }

  async function triggerLiveLesionPreview(
    imageId: string,
    options: { quiet?: boolean; force?: boolean } = {},
  ) {
    if ((!liveLesionCropEnabled && !options.force) || !selectedSiteId) {
      return;
    }

    const requestVersion =
      (liveLesionPreviewRequestRef.current[imageId] ?? 0) + 1;
    liveLesionPreviewRequestRef.current[imageId] = requestVersion;
    revokeObjectUrls(liveLesionPreviewUrlsRef.current[imageId] ?? []);
    liveLesionPreviewUrlsRef.current[imageId] = [];
    setLiveLesionPreviews((current) => ({
      ...current,
      [imageId]: buildRunningLiveLesionPreviewState(current[imageId], {
        job_id: current[imageId]?.job_id ?? null,
        backend: current[imageId]?.backend ?? null,
        prompt_signature: current[imageId]?.prompt_signature ?? null,
      }),
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
        [imageId]: buildRunningLiveLesionPreviewState(current[imageId], job),
      }));
      void pollLiveLesionPreview(imageId, job.job_id, requestVersion);
    } catch (nextError) {
      if (liveLesionPreviewRequestRef.current[imageId] !== requestVersion) {
        return;
      }
      const message = describeError(
        nextError,
        pick(
          locale,
          "Unable to start live MedSAM preview.",
          "?ㅼ떆媛?MedSAM 誘몃━蹂닿린瑜??쒖옉?섏? 紐삵뻽?듬땲??",
        ),
      );
      setLiveLesionPreviews((current) => ({
        ...current,
        [imageId]: buildFailedLiveLesionPreviewState(current[imageId], {
          jobId: null,
          error: message,
          backend: current[imageId]?.backend ?? null,
          promptSignature: current[imageId]?.prompt_signature ?? null,
        }),
      }));
      if (!options.quiet) {
        setToast({ tone: "error", message });
      }
    }
  }

  const {
    persistChangedLesionBoxes,
    applySavedLesionBoxesAndStartLivePreview,
    handleLesionPointerDown,
    handleLesionPointerMove,
    finishLesionPointer,
  } = createCaseWorkspaceLiveLesionInteractions({
    locale,
    token,
    selectedSiteId,
    liveLesionCropEnabled,
    lesionPromptDrafts,
    lesionPromptSaved,
    lesionBoxChangedImageIds,
    lesionDrawStateRef,
    pick,
    describeError,
    setToast,
    setSelectedCaseImages,
    setLesionPromptSaved,
    setLesionPromptDrafts,
    setLesionBoxBusyImageId,
    clearLiveLesionPreview,
    triggerLiveLesionPreview,
  });

  return {
    liveLesionCropEnabled,
    setLiveLesionCropEnabled,
    liveLesionPreviews,
    lesionPromptDrafts,
    lesionPromptSaved,
    lesionBoxBusyImageId,
    hasAnySavedLesionBox,
    clearLiveLesionPreview,
    resetLiveLesionState,
    persistChangedLesionBoxes,
    applySavedLesionBoxesAndStartLivePreview,
    handleLesionPointerDown,
    handleLesionPointerMove,
    finishLesionPointer,
  };
}
