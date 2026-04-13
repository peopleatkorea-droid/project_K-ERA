"use client";

import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Dispatch, SetStateAction } from "react";

import {
  clearImageLesionBox,
  fetchStoredCaseLesionPreview,
  fetchCaseLesionPreviewArtifactUrl,
  startLiveLesionPreview,
  updateImageLesionBox,
  type CaseSummaryRecord,
  type LiveLesionPreviewJobResponse,
} from "../../lib/api";
import type { Locale } from "../../lib/i18n";
import { waitForLiveLesionPreviewSettlement } from "../../lib/live-lesion-preview-runtime";
import {
  normalizeBox,
  toNormalizedBox,
} from "./case-workspace-core-helpers";
import {
  areNormalizedBoxesEqual,
  buildDoneLiveLesionPreviewState,
  buildFailedLiveLesionPreviewState,
  buildLesionPromptBoxMap,
  buildPointerAnchor,
  buildPointerDraftBox,
  buildRunningLiveLesionPreviewState,
  filterPersistableLesionEntries,
  groupImagesWithSavedLesionBoxes,
  hasMeaningfulLesionBox,
  hasSavedLesionPromptBox,
  listChangedLesionBoxImageIds,
  resolveLiveLesionArtifactUrls,
  revokeObjectUrls,
} from "./case-workspace-live-lesion-helpers";
import type {
  LesionBoxMap,
  LiveLesionPreviewMap,
  LocalePick,
  NormalizedBox,
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
  const lesionDrawStateRef = useRef<{
    imageId: string;
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);
  const selectedCaseImagesRef = useRef(selectedCaseImages);
  selectedCaseImagesRef.current = selectedCaseImages;
  const caseImagesKey = `${selectedCase?.case_id ?? ""}:${selectedCaseImages.map((i) => i.image_id).join(",")}`;

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
  }, [selectedSiteId]);

  useEffect(() => {
    let cancelled = false;
    let hydrateTimer: number | null = null;

    async function hydrateStoredCaseLesionPreviews() {
      if (!selectedSiteId) {
        return;
      }

      const visibleImages = selectedCaseImagesRef.current;
      const boxedImageGroups = groupImagesWithSavedLesionBoxes(
        visibleImages,
        toNormalizedBox,
      );
      if (boxedImageGroups.length === 0) {
        return;
      }

      for (const {
        patientId,
        visitDate,
        images: caseImages,
      } of boxedImageGroups) {
        try {
          const previews = await fetchStoredCaseLesionPreview(
            selectedSiteId,
            patientId,
            visitDate,
            token,
          );
          if (cancelled) {
            return;
          }

          const previewByImageId = new Map(
            previews
              .filter((item) => item.image_id)
              .map((item) => [String(item.image_id), item] as const),
          );

          for (const image of caseImages) {
            const preview = previewByImageId.get(image.image_id);
            const existing = liveLesionPreviewsRef.current[image.image_id];
            if (
              !preview?.has_lesion_mask ||
              (existing?.status === "done" && existing.lesion_mask_url)
            ) {
              continue;
            }

            try {
              const { lesionMaskUrl, lesionCropUrl, urls } =
                await resolveLiveLesionArtifactUrls({
                  hasLesionMask: preview.has_lesion_mask,
                  hasLesionCrop: preview.has_lesion_crop,
                  fetchLesionMaskUrl: () =>
                    fetchCaseLesionPreviewArtifactUrl(
                      selectedSiteId,
                      patientId,
                      visitDate,
                      image.image_id,
                      "lesion_mask",
                      token,
                    ),
                  fetchLesionCropUrl: () =>
                    fetchCaseLesionPreviewArtifactUrl(
                      selectedSiteId,
                      patientId,
                      visitDate,
                      image.image_id,
                      "lesion_crop",
                      token,
                    ),
                });

              if (cancelled) {
                revokeObjectUrls(urls);
                return;
              }

              revokeObjectUrls(
                liveLesionPreviewUrlsRef.current[image.image_id] ?? [],
              );
              liveLesionPreviewUrlsRef.current[image.image_id] = urls;
              setLiveLesionPreviews((current) => ({
                ...current,
                [image.image_id]: buildDoneLiveLesionPreviewState(
                  current[image.image_id],
                  {
                    job_id: current[image.image_id]?.job_id ?? null,
                    backend: preview.backend ?? null,
                    prompt_signature:
                      current[image.image_id]?.prompt_signature ?? null,
                  },
                  {
                    lesionMaskUrl,
                    lesionCropUrl,
                  },
                ),
              }));
            } catch {
              // Ignore individual preview artifacts that cannot be resolved.
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

  async function hydrateLiveLesionPreview(
    imageId: string,
    job: LiveLesionPreviewJobResponse,
    requestVersion: number,
  ) {
    if (
      !selectedSiteId ||
      liveLesionPreviewRequestRef.current[imageId] !== requestVersion
    ) {
      return;
    }

    const { lesionMaskUrl, lesionCropUrl, urls } =
      await resolveLiveLesionArtifactUrls({
        hasLesionMask: job.has_lesion_mask,
        hasLesionCrop: job.has_lesion_crop,
        fetchLesionMaskUrl: () =>
          fetchCaseLesionPreviewArtifactUrl(
            selectedSiteId,
            job.patient_id,
            job.visit_date,
            imageId,
            "lesion_mask",
            token,
          ),
        fetchLesionCropUrl: () =>
          fetchCaseLesionPreviewArtifactUrl(
            selectedSiteId,
            job.patient_id,
            job.visit_date,
            imageId,
            "lesion_crop",
            token,
          ),
      });

    if (liveLesionPreviewRequestRef.current[imageId] !== requestVersion) {
      revokeObjectUrls(urls);
      return;
    }

    revokeObjectUrls(liveLesionPreviewUrlsRef.current[imageId] ?? []);
    liveLesionPreviewUrlsRef.current[imageId] = urls;
    setLiveLesionPreviews((current) => ({
      ...current,
      [imageId]: buildDoneLiveLesionPreviewState(current[imageId], job, {
        lesionMaskUrl,
        lesionCropUrl,
      }),
    }));
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
                "실시간 MedSAM 미리보기에 실패했습니다.",
              ),
            backend: job.backend ?? null,
            promptSignature: job.prompt_signature ?? null,
          }),
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
        [imageId]: buildFailedLiveLesionPreviewState(current[imageId], {
          jobId,
          error: describeError(
            nextError,
            pick(
              locale,
              "Unable to check live MedSAM preview status.",
              "실시간 MedSAM 상태를 확인하지 못했습니다.",
            ),
          ),
          backend: current[imageId]?.backend ?? null,
          promptSignature: current[imageId]?.prompt_signature ?? null,
        }),
      }));
      return;
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
          "실시간 MedSAM 미리보기를 시작하지 못했습니다.",
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

  async function persistLesionPromptBox(
    imageId: string,
    nextBox: NormalizedBox,
    options: { forceLivePreview?: boolean; trackBusy?: boolean } = {},
  ) {
    if (!selectedSiteId) {
      throw new Error(
        pick(
          locale,
          "Select a hospital first.",
          "먼저 병원을 선택해 주세요.",
        ),
      );
    }
    const shouldTrackBusy = options.trackBusy !== false;
    if (shouldTrackBusy) {
      setLesionBoxBusyImageId(imageId);
    }
    try {
      const normalized = normalizeBox(nextBox);
      if (!hasMeaningfulLesionBox(normalized)) {
        throw new Error(
          pick(
            locale,
            "Lesion box is too small.",
            "병변 박스가 너무 작습니다.",
          ),
        );
      }
      const updatedImage = await updateImageLesionBox(
        selectedSiteId,
        imageId,
        token,
        normalized,
      );
      setSelectedCaseImages((current) =>
        current.map((image) =>
          image.image_id === updatedImage.image_id
            ? { ...image, ...updatedImage, preview_url: image.preview_url }
            : image,
        ),
      );
      setLesionPromptSaved((current) => ({
        ...current,
        [imageId]: normalized,
      }));
      setLesionPromptDrafts((current) => ({
        ...current,
        [imageId]: normalized,
      }));
      if (liveLesionCropEnabled || options.forceLivePreview) {
        void triggerLiveLesionPreview(imageId, {
          quiet: true,
          force: options.forceLivePreview,
        });
      }
      return normalized;
    } finally {
      if (shouldTrackBusy) {
        setLesionBoxBusyImageId(null);
      }
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

  async function applySavedLesionBoxesAndStartLivePreview(
    entries: Array<{
      imageId: string;
      lesionBox: NormalizedBox;
      isRepresentative?: boolean;
    }>,
  ) {
    const deduplicated = filterPersistableLesionEntries(entries);
    const results = await Promise.allSettled(
      deduplicated.map((entry) =>
        persistLesionPromptBox(entry.imageId, entry.lesionBox, {
          forceLivePreview: true,
          trackBusy: false,
        }),
      ),
    );
    const firstRejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (firstRejected) {
      throw firstRejected.reason;
    }
  }

  async function clearSavedLesionPromptBox(imageId: string) {
    if (!selectedSiteId) {
      throw new Error(
        pick(
          locale,
          "Select a hospital first.",
          "먼저 병원을 선택해 주세요.",
        ),
      );
    }
    setLesionBoxBusyImageId(imageId);
    try {
      const updatedImage = await clearImageLesionBox(
        selectedSiteId,
        imageId,
        token,
      );
      setSelectedCaseImages((current) =>
        current.map((image) =>
          image.image_id === updatedImage.image_id
            ? { ...image, ...updatedImage, preview_url: image.preview_url }
            : image,
        ),
      );
      setLesionPromptSaved((current) => ({ ...current, [imageId]: null }));
      setLesionPromptDrafts((current) => ({ ...current, [imageId]: null }));
      clearLiveLesionPreview(imageId);
    } finally {
      setLesionBoxBusyImageId(null);
    }
  }

  function updateLesionDraftFromPointer(
    imageId: string,
    clientX: number,
    clientY: number,
    element: HTMLDivElement,
  ) {
    const drawState = lesionDrawStateRef.current;
    if (!drawState || drawState.imageId !== imageId) {
      return;
    }
    const nextBox = buildPointerDraftBox(
      { x: drawState.x, y: drawState.y },
      clientX,
      clientY,
      element.getBoundingClientRect(),
    );
    if (!nextBox) {
      return;
    }
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

  function handleLesionPointerDown(
    imageId: string,
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    event.preventDefault();
    const element = event.currentTarget;
    const anchor = buildPointerAnchor(
      event.clientX,
      event.clientY,
      element.getBoundingClientRect(),
    );
    if (!anchor) {
      return;
    }
    clearLiveLesionPreview(imageId);
    lesionDrawStateRef.current = {
      imageId,
      pointerId: event.pointerId,
      x: anchor.x,
      y: anchor.y,
    };
    setLesionPromptDrafts((current) => ({
      ...current,
      [imageId]: {
        x0: anchor.x,
        y0: anchor.y,
        x1: anchor.x,
        y1: anchor.y,
      },
    }));
    element.setPointerCapture?.(event.pointerId);
  }

  function handleLesionPointerMove(
    imageId: string,
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    if (
      lesionDrawStateRef.current?.pointerId !== event.pointerId ||
      lesionDrawStateRef.current?.imageId !== imageId
    ) {
      return;
    }
    updateLesionDraftFromPointer(
      imageId,
      event.clientX,
      event.clientY,
      event.currentTarget,
    );
  }

  async function finishLesionPointer(
    imageId: string,
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    const drawState = lesionDrawStateRef.current;
    if (
      !drawState ||
      drawState.pointerId !== event.pointerId ||
      drawState.imageId !== imageId
    ) {
      return;
    }
    const draftBox = buildPointerDraftBox(
      { x: drawState.x, y: drawState.y },
      event.clientX,
      event.clientY,
      event.currentTarget.getBoundingClientRect(),
    );
    setLesionPromptDrafts((current) => ({ ...current, [imageId]: draftBox }));
    lesionDrawStateRef.current = null;
    if (!draftBox) {
      return;
    }
    if (!hasMeaningfulLesionBox(draftBox)) {
      try {
        await clearSavedLesionPromptBox(imageId);
      } catch (nextError) {
        setLesionPromptDrafts((current) => ({
          ...current,
          [imageId]: lesionPromptSaved[imageId] ?? null,
        }));
        setToast({
          tone: "error",
          message: describeError(
            nextError,
            pick(
              locale,
              "Unable to clear lesion box.",
              "병변 박스를 지우지 못했습니다.",
            ),
          ),
        });
      }
      return;
    }
    try {
      await persistLesionPromptBox(imageId, draftBox);
    } catch (nextError) {
      setLesionPromptDrafts((current) => ({
        ...current,
        [imageId]: lesionPromptSaved[imageId] ?? null,
      }));
      setToast({
        tone: "error",
        message: describeError(
          nextError,
          pick(
            locale,
            "Unable to auto-save lesion box.",
            "병변 박스를 자동 저장하지 못했습니다.",
          ),
        ),
      });
    }
  }

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
