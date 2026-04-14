"use client";

import type { MutableRefObject, PointerEvent as ReactPointerEvent } from "react";
import type { Dispatch, SetStateAction } from "react";

import {
  clearImageLesionBox,
  updateImageLesionBox,
} from "../../lib/api";
import type { Locale } from "../../lib/i18n";
import { normalizeBox } from "./case-workspace-core-helpers";
import {
  areNormalizedBoxesEqual,
  buildPointerAnchor,
  buildPointerDraftBox,
  filterPersistableLesionEntries,
  hasMeaningfulLesionBox,
} from "./case-workspace-live-lesion-helpers";
import { mergeSelectedCaseImageUpdate } from "./case-workspace-live-lesion-runtime";
import type {
  LesionBoxMap,
  LocalePick,
  NormalizedBox,
  SavedImagePreview,
} from "./shared";

type ToastState = {
  tone: "success" | "error";
  message: string;
} | null;

export type LesionDrawState = {
  imageId: string;
  pointerId: number;
  x: number;
  y: number;
} | null;

type CreateCaseWorkspaceLiveLesionInteractionsArgs = {
  locale: Locale;
  token: string;
  selectedSiteId: string | null;
  liveLesionCropEnabled: boolean;
  lesionPromptDrafts: LesionBoxMap;
  lesionPromptSaved: LesionBoxMap;
  lesionBoxChangedImageIds: string[];
  lesionDrawStateRef: MutableRefObject<LesionDrawState>;
  pick: LocalePick;
  describeError: (error: unknown, fallback: string) => string;
  setToast: Dispatch<SetStateAction<ToastState>>;
  setSelectedCaseImages: Dispatch<SetStateAction<SavedImagePreview[]>>;
  setLesionPromptSaved: Dispatch<SetStateAction<LesionBoxMap>>;
  setLesionPromptDrafts: Dispatch<SetStateAction<LesionBoxMap>>;
  setLesionBoxBusyImageId: Dispatch<SetStateAction<string | null>>;
  clearLiveLesionPreview: (imageId?: string) => void;
  triggerLiveLesionPreview: (
    imageId: string,
    options?: { quiet?: boolean; force?: boolean },
  ) => Promise<void>;
};

export function createCaseWorkspaceLiveLesionInteractions({
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
}: CreateCaseWorkspaceLiveLesionInteractionsArgs) {
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
          "癒쇱? 蹂묒썝???좏깮??二쇱꽭??",
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
            "蹂묐? 諛뺤뒪媛 ?덈Т ?묒뒿?덈떎.",
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
        mergeSelectedCaseImageUpdate(current, updatedImage),
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
          "癒쇱? 蹂묒썝???좏깮??二쇱꽭??",
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
        mergeSelectedCaseImageUpdate(current, updatedImage),
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
              "蹂묐? 諛뺤뒪瑜?吏?곗? 紐삵뻽?듬땲??",
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
            "蹂묐? 諛뺤뒪瑜??먮룞 ??ν븯吏 紐삵뻽?듬땲??",
          ),
        ),
      });
    }
  }

  return {
    persistLesionPromptBox,
    persistChangedLesionBoxes,
    applySavedLesionBoxesAndStartLivePreview,
    clearSavedLesionPromptBox,
    handleLesionPointerDown,
    handleLesionPointerMove,
    finishLesionPointer,
  };
}
