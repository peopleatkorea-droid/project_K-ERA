"use client";

import { useMemo, useRef } from "react";
import type {
  Dispatch,
  PointerEvent as ReactPointerEvent,
  SetStateAction,
} from "react";

import type { CaseSummaryRecord, OrganismRecord } from "../../lib/api";
import { clamp01, normalizeBox } from "./case-workspace-core-helpers";
import {
  cultureStatusNeedsOrganism,
  listOrganisms,
  normalizeAdditionalOrganisms,
  organismKey,
} from "./case-workspace-draft-helpers";
import type { SavedImagePreview } from "./shared";

type Locale = "en" | "ko";

type ToastState = {
  tone: "success" | "error";
  message: string;
} | null;

type DraftImage = {
  draft_id: string;
  file: File;
  preview_url: string;
  view: string;
  is_representative: boolean;
};

type DraftState = {
  patient_id: string;
  chart_alias: string;
  local_case_code: string;
  sex: string;
  age: string;
  actual_visit_date: string;
  follow_up_number: string;
  culture_status: string;
  culture_category: string;
  culture_species: string;
  additional_organisms: OrganismRecord[];
  contact_lens_use: string;
  visit_status: string;
  is_initial_visit: boolean;
  predisposing_factor: string[];
  other_history: string;
  intake_completed: boolean;
};

type NormalizedBox = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

type LesionBoxMap = Record<string, NormalizedBox | null>;

type Args = {
  selectedSiteId: string | null;
  locale: Locale;
  pick: (locale: Locale, en: string, ko: string) => string;
  notAvailableLabel: string;
  cultureSpecies: Record<string, string[]>;
  draft: DraftState;
  pendingOrganism: OrganismRecord;
  draftImages: DraftImage[];
  setDraft: Dispatch<SetStateAction<DraftState>>;
  setDraftImages: Dispatch<SetStateAction<DraftImage[]>>;
  setSelectedCase: Dispatch<SetStateAction<CaseSummaryRecord | null>>;
  setSelectedCaseImages: Dispatch<SetStateAction<SavedImagePreview[]>>;
  setPanelOpen: Dispatch<SetStateAction<boolean>>;
  setDraftLesionPromptBoxes: Dispatch<SetStateAction<LesionBoxMap>>;
  replaceDraftImages: (nextImages: DraftImage[]) => void;
  resetAnalysisState: () => void;
  createDraftId: () => string;
  setToast: Dispatch<SetStateAction<ToastState>>;
  copy: {
    organismDuplicate: string;
    organismAdded: string;
    patientIdRequired: string;
    cultureSpeciesRequired: string;
    intakeComplete: string;
  };
};

export function useCaseWorkspaceDraftAuthoring({
  selectedSiteId,
  locale,
  pick,
  notAvailableLabel,
  cultureSpecies,
  draft,
  pendingOrganism,
  draftImages,
  setDraft,
  setDraftImages,
  setSelectedCase,
  setSelectedCaseImages,
  setPanelOpen,
  setDraftLesionPromptBoxes,
  replaceDraftImages,
  resetAnalysisState,
  createDraftId,
  setToast,
  copy,
}: Args) {
  const whiteFileInputRef = useRef<HTMLInputElement | null>(null);
  const fluoresceinFileInputRef = useRef<HTMLInputElement | null>(null);
  const draftLesionDrawStateRef = useRef<{
    imageId: string;
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);

  const speciesOptions = useMemo(
    () => cultureSpecies[draft.culture_category] ?? [],
    [cultureSpecies, draft.culture_category],
  );
  const pendingSpeciesOptions = useMemo(
    () => cultureSpecies[pendingOrganism.culture_category] ?? [],
    [cultureSpecies, pendingOrganism.culture_category],
  );
  const intakeOrganisms = useMemo(
    () =>
      listOrganisms(
        draft.culture_category,
        draft.culture_species,
        draft.additional_organisms,
      ),
    [
      draft.additional_organisms,
      draft.culture_category,
      draft.culture_species,
      listOrganisms,
    ],
  );
  const actualVisitDateLabel = draft.actual_visit_date.trim() || notAvailableLabel;
  const whiteDraftImages = useMemo(
    () => draftImages.filter((image) => image.view === "white"),
    [draftImages],
  );
  const fluoresceinDraftImages = useMemo(
    () => draftImages.filter((image) => image.view === "fluorescein"),
    [draftImages],
  );
  const draftRepresentativeCount = useMemo(
    () => draftImages.filter((image) => image.is_representative).length,
    [draftImages],
  );
  const draftNeedsPrimaryOrganism = useMemo(
    () => cultureStatusNeedsOrganism(draft.culture_status),
    [cultureStatusNeedsOrganism, draft.culture_status],
  );
  const draftChecklist = useMemo(
    () => [
      Boolean(draft.patient_id.trim() && draft.age.trim()),
      Boolean(draft.visit_status && draft.contact_lens_use),
      draftNeedsPrimaryOrganism
        ? Boolean(draft.culture_category && draft.culture_species.trim())
        : Boolean(draft.culture_status),
      draftImages.length > 0,
    ],
    [
      draft.age,
      draft.contact_lens_use,
      draft.culture_category,
      draft.culture_species,
      draft.culture_status,
      draft.patient_id,
      draft.visit_status,
      draftImages.length,
      draftNeedsPrimaryOrganism,
    ],
  );
  const draftCompletionCount = draftChecklist.filter(Boolean).length;
  const draftCompletionPercent = Math.round(
    (draftCompletionCount / draftChecklist.length) * 100,
  );
  const draftPendingItems = useMemo(() => {
    const items: string[] = [];
    if (!selectedSiteId) {
      items.push(
        pick(
          locale,
          "Select a hospital workspace.",
          "병원 워크스페이스를 선택하세요.",
        ),
      );
    }
    if (!draft.patient_id.trim()) {
      items.push(
        pick(locale, "Add a patient identifier.", "환자 식별자를 입력하세요."),
      );
    }
    if (draftNeedsPrimaryOrganism && !draft.culture_species.trim()) {
      items.push(
        pick(locale, "Choose the primary organism.", "기본 원인균을 선택하세요."),
      );
    }
    if (!draft.intake_completed) {
      items.push(
        pick(
          locale,
          "Complete the intake to unlock submission.",
          "제출을 열려면 intake를 완료하세요.",
        ),
      );
    }
    if (draftImages.length === 0) {
      items.push(
        pick(
          locale,
          "Add at least one image to the board.",
          "이미지를 한 장 이상 보드에 추가하세요.",
        ),
      );
    }
    if (draftImages.length > 0 && draftRepresentativeCount === 0) {
      items.push(
        pick(
          locale,
          "Mark one representative image.",
          "대표 이미지를 한 장 지정하세요.",
        ),
      );
    }
    return items;
  }, [
    draft.culture_species,
    draft.intake_completed,
    draft.patient_id,
    draftImages.length,
    draftNeedsPrimaryOrganism,
    draftRepresentativeCount,
    locale,
    pick,
    selectedSiteId,
  ]);

  function replaceDraftImagesAndBoxes(nextImages: DraftImage[]) {
    const nextIds = new Set(nextImages.map((image) => image.draft_id));
    setDraftLesionPromptBoxes((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([draftId]) => nextIds.has(draftId)),
      ),
    );
    replaceDraftImages(nextImages);
  }

  function updatePrimaryOrganism(
    cultureCategory: string,
    nextCultureSpecies: string,
  ) {
    setDraft((current) => ({
      ...current,
      culture_category: cultureCategory.trim().toLowerCase(),
      culture_species: nextCultureSpecies.trim(),
      additional_organisms: normalizeAdditionalOrganisms(
        cultureCategory,
        nextCultureSpecies,
        current.additional_organisms,
      ),
    }));
  }

  function addAdditionalOrganism() {
    const nextOrganism = {
      culture_category: pendingOrganism.culture_category.trim().toLowerCase(),
      culture_species: pendingOrganism.culture_species.trim(),
    };
    if (!nextOrganism.culture_category || !nextOrganism.culture_species) {
      return;
    }
    if (
      intakeOrganisms.some(
        (organism) => organismKey(organism) === organismKey(nextOrganism),
      )
    ) {
      setToast({
        tone: "error",
        message: copy.organismDuplicate,
      });
      return;
    }
    setDraft((current) => ({
      ...current,
      additional_organisms: [...current.additional_organisms, nextOrganism],
    }));
    setToast({
      tone: "success",
      message: copy.organismAdded,
    });
  }

  function handleCompleteIntake() {
    if (!draft.patient_id.trim()) {
      setToast({ tone: "error", message: copy.patientIdRequired });
      return;
    }
    if (draftNeedsPrimaryOrganism && !draft.culture_species.trim()) {
      setToast({ tone: "error", message: copy.cultureSpeciesRequired });
      return;
    }
    setDraft((current) => ({ ...current, intake_completed: true }));
    setToast({ tone: "success", message: copy.intakeComplete });
  }

  function removeAdditionalOrganism(organismToRemove: OrganismRecord) {
    setDraft((current) => ({
      ...current,
      additional_organisms: current.additional_organisms.filter(
        (organism) => organismKey(organism) !== organismKey(organismToRemove),
      ),
    }));
  }

  function openFilePicker(view: "white" | "fluorescein") {
    if (view === "fluorescein") {
      fluoresceinFileInputRef.current?.click();
      return;
    }
    whiteFileInputRef.current?.click();
  }

  function appendFiles(files: File[], view: "white" | "fluorescein") {
    if (!files.length) {
      return;
    }
    setPanelOpen(true);
    resetAnalysisState();
    setSelectedCase(null);
    setSelectedCaseImages([]);
    setDraftImages((current) => {
      const next = [...current];
      const hasRepresentative = current.some(
        (image) => image.is_representative,
      );
      for (const file of files) {
        next.push({
          draft_id: createDraftId(),
          file,
          preview_url: URL.createObjectURL(file),
          view,
          is_representative: false,
        });
      }
      if (!hasRepresentative && next[0]) {
        next[0] = { ...next[0], is_representative: true };
      }
      return next;
    });
  }

  function removeDraftImage(draftId: string) {
    const remaining = draftImages.filter((image) => image.draft_id !== draftId);
    if (
      remaining.length > 0 &&
      !remaining.some((image) => image.is_representative)
    ) {
      remaining[0] = { ...remaining[0], is_representative: true };
    }
    replaceDraftImagesAndBoxes(remaining);
  }

  function setRepresentativeImage(draftId: string) {
    setDraftImages((current) =>
      current.map((image) => ({
        ...image,
        is_representative: image.draft_id === draftId,
      })),
    );
  }

  function updateDraftLesionBoxFromPointer(
    draftId: string,
    clientX: number,
    clientY: number,
    element: HTMLDivElement,
  ) {
    const drawState = draftLesionDrawStateRef.current;
    if (!drawState || drawState.imageId !== draftId) {
      return;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const currentX = clamp01((clientX - rect.left) / rect.width);
    const currentY = clamp01((clientY - rect.top) / rect.height);
    setDraftLesionPromptBoxes((current) => ({
      ...current,
      [draftId]: normalizeBox({
        x0: drawState.x,
        y0: drawState.y,
        x1: currentX,
        y1: currentY,
      }),
    }));
  }

  function handleDraftLesionPointerDown(
    draftId: string,
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    event.preventDefault();
    const element = event.currentTarget;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const startX = clamp01((event.clientX - rect.left) / rect.width);
    const startY = clamp01((event.clientY - rect.top) / rect.height);
    draftLesionDrawStateRef.current = {
      imageId: draftId,
      pointerId: event.pointerId,
      x: startX,
      y: startY,
    };
    setDraftLesionPromptBoxes((current) => ({
      ...current,
      [draftId]: { x0: startX, y0: startY, x1: startX, y1: startY },
    }));
    element.setPointerCapture?.(event.pointerId);
  }

  function handleDraftLesionPointerMove(
    draftId: string,
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    if (
      draftLesionDrawStateRef.current?.pointerId !== event.pointerId ||
      draftLesionDrawStateRef.current?.imageId !== draftId
    ) {
      return;
    }
    updateDraftLesionBoxFromPointer(
      draftId,
      event.clientX,
      event.clientY,
      event.currentTarget,
    );
  }

  function finishDraftLesionPointer(
    draftId: string,
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    const drawState = draftLesionDrawStateRef.current;
    if (
      !drawState ||
      drawState.pointerId !== event.pointerId ||
      drawState.imageId !== draftId
    ) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const currentX = clamp01((event.clientX - rect.left) / rect.width);
    const currentY = clamp01((event.clientY - rect.top) / rect.height);
    const nextBox = normalizeBox({
      x0: drawState.x,
      y0: drawState.y,
      x1: currentX,
      y1: currentY,
    });
    setDraftLesionPromptBoxes((current) => ({
      ...current,
      [draftId]:
        nextBox.x1 - nextBox.x0 < 0.01 || nextBox.y1 - nextBox.y0 < 0.01
          ? null
          : nextBox,
    }));
    draftLesionDrawStateRef.current = null;
  }

  function togglePredisposingFactor(factor: string) {
    setDraft((current) => {
      const exists = current.predisposing_factor.includes(factor);
      return {
        ...current,
        predisposing_factor: exists
          ? current.predisposing_factor.filter((item) => item !== factor)
          : [...current.predisposing_factor, factor],
      };
    });
  }

  return {
    whiteFileInputRef,
    fluoresceinFileInputRef,
    speciesOptions,
    pendingSpeciesOptions,
    intakeOrganisms,
    actualVisitDateLabel,
    whiteDraftImages,
    fluoresceinDraftImages,
    draftRepresentativeCount,
    draftNeedsPrimaryOrganism,
    draftCompletionCount,
    draftCompletionPercent,
    draftPendingItems,
    replaceDraftImagesAndBoxes,
    updatePrimaryOrganism,
    addAdditionalOrganism,
    handleCompleteIntake,
    removeAdditionalOrganism,
    openFilePicker,
    appendFiles,
    removeDraftImage,
    setRepresentativeImage,
    handleDraftLesionPointerDown,
    handleDraftLesionPointerMove,
    finishDraftLesionPointer,
    togglePredisposingFactor,
  };
}
