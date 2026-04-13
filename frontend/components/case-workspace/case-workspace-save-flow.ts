import { startTransition, type Dispatch, type SetStateAction } from "react";

import { canUseDesktopTransport } from "../../lib/desktop-transport";
import {
  createPatient,
  createVisit,
  deleteVisit,
  deleteVisitImages,
  fetchCaseRoiPreview,
  fetchCases,
  fetchPatientListPage,
  fetchVisits,
  setRepresentativeImage as setRepresentativeImageOnServer,
  updatePatient,
  updateVisit,
  uploadImage,
  type AuthUser,
  type CaseSummaryRecord,
  type OrganismRecord,
  type PatientIdLookupResponse,
  type VisitRecord,
} from "../../lib/api";
import type { Locale } from "../../lib/i18n";
import type { NormalizedBox, PatientListRow, SavedImagePreview } from "./shared";
import {
  buildOptimisticPatientRow,
  buildOptimisticSavedCase,
  pickRepresentativeSavedImage,
} from "./case-workspace-save-flow-helpers";
import {
  hasUsableLesionPromptBox,
  normalizeBox,
  toNormalizedBox,
  toSavedCaseImagePreview,
} from "./case-workspace-core-helpers";
import {
  buildVisitReference,
  computeNextFollowUpNumber,
  displayVisitReference,
  normalizeAdditionalOrganisms,
  resolveDraftVisitReference,
} from "./case-workspace-draft-helpers";

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

type ToastState = {
  tone: "success" | "error";
  message: string;
} | null;

type CompletionState = {
  kind: "saved" | "contributed";
  patient_id: string;
  visit_date: string;
  timestamp: string;
  stats?: {
    user_contributions: number;
    total_contributions: number;
    user_contribution_pct: number;
  };
  update_id?: string;
  update_count?: number;
};

type EditingCaseContext = {
  patient_id: string;
  visit_date: string;
  created_at?: string | null;
  created_by_user_id?: string | null;
} | null;

type LocalePick = (locale: Locale, en: string, ko: string) => string;

type CopyShape = {
  selectSiteForCase: string;
  intakeStepRequired: string;
  patientIdRequired: string;
  cultureSpeciesRequired: string;
  imageRequired: string;
  lesionBoxesRequired: string;
  caseSaveFailed: string;
  caseSaved: (patientId: string, visitDate: string, siteLabel: string) => string;
};

type HandleSaveCaseArgs = {
  locale: Locale;
  selectedSiteId: string | null;
  selectedSiteLabel: string | null;
  token: string;
  user: AuthUser;
  showOnlyMine: boolean;
  patientIdLookup: PatientIdLookupResponse | null;
  draft: DraftState;
  draftImages: DraftImage[];
  draftLesionPromptBoxes: Record<string, NormalizedBox | null>;
  editingCaseContext: EditingCaseContext;
  cases: CaseSummaryRecord[];
  patientListRows: PatientListRow[];
  patientListPage: number;
  patientListTotalCount: number;
  normalizedPatientListSearch: string;
  pick: LocalePick;
  copy: CopyShape;
  describeError: (error: unknown, fallback: string) => string;
  isAlreadyExistsError: (error: unknown) => boolean;
  setToast: Dispatch<SetStateAction<ToastState>>;
  setSaveBusy: Dispatch<SetStateAction<boolean>>;
  setCases: Dispatch<SetStateAction<CaseSummaryRecord[]>>;
  setPatientListRows: Dispatch<SetStateAction<PatientListRow[]>>;
  setPatientListTotalCount: Dispatch<SetStateAction<number>>;
  setPatientListTotalPages: Dispatch<SetStateAction<number>>;
  setPatientListPage: Dispatch<SetStateAction<number>>;
  setSelectedCase: Dispatch<SetStateAction<CaseSummaryRecord | null>>;
  setSelectedPatientCases: Dispatch<SetStateAction<CaseSummaryRecord[]>>;
  setPanelOpen: Dispatch<SetStateAction<boolean>>;
  setCompletionState: Dispatch<SetStateAction<CompletionState | null>>;
  clearDraftStorage: (siteId?: string | null) => void;
  resetDraft: () => void;
  primeCaseImageCache: (
    caseRecord: CaseSummaryRecord,
    images: SavedImagePreview[],
  ) => void;
  onSiteDataChanged: (siteId: string) => Promise<void>;
  loadSiteActivity: (siteId: string) => Promise<unknown>;
  upsertCaseSummaryRecord: (
    caseRecords: CaseSummaryRecord[],
    nextCase: CaseSummaryRecord,
    options?: {
      replaceCase?:
        | {
            case_id?: string | null;
            patient_id: string;
            visit_date: string;
          }
        | null;
    },
  ) => CaseSummaryRecord[];
  patientMatchesListSearch: (
    normalizedSearch: string,
    caseRecord: CaseSummaryRecord,
  ) => boolean;
  organismSummaryLabel: (
    cultureCategory: string,
    cultureSpecies: string,
    additionalOrganisms: OrganismRecord[] | undefined,
    maxVisibleSpecies?: number,
  ) => string;
  upsertPatientListRow: (
    rows: PatientListRow[],
    nextRow: PatientListRow,
  ) => PatientListRow[];
  buildKnownPatientTimeline: (
    caseRecords: CaseSummaryRecord[],
    patientId: string,
    fallbackCase?: CaseSummaryRecord | null,
  ) => CaseSummaryRecord[];
  applySavedLesionBoxesAndStartLivePreview: (
    entries: Array<{
      imageId: string;
      lesionBox: NormalizedBox;
      isRepresentative: boolean;
    }>,
  ) => Promise<void>;
};

function yieldUploadLoopToBrowser(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

const DESKTOP_SAVE_UPLOAD_CONCURRENCY = 2;
const PATIENT_LIST_PAGE_SIZE = 25;

async function mapWithConcurrency<TInput, TOutput>(
  items: readonly TInput[],
  concurrency: number,
  worker: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  if (items.length === 0) {
    return [];
  }
  const normalizedConcurrency = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;

  const runWorker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) {
        return;
      }
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
      if (currentIndex < items.length - 1) {
        await yieldUploadLoopToBrowser();
      }
    }
  };

  await Promise.all(
    Array.from({ length: normalizedConcurrency }, () => runWorker()),
  );
  return results;
}

export async function handleSaveCase({
  locale,
  selectedSiteId,
  selectedSiteLabel,
  token,
  user,
  showOnlyMine,
  patientIdLookup,
  draft,
  draftImages,
  draftLesionPromptBoxes,
  editingCaseContext,
  cases,
  patientListRows,
  patientListPage,
  patientListTotalCount,
  normalizedPatientListSearch,
  pick,
  copy,
  describeError,
  isAlreadyExistsError,
  setToast,
  setSaveBusy,
  setCases,
  setPatientListRows,
  setPatientListTotalCount,
  setPatientListTotalPages,
  setPatientListPage,
  setSelectedCase,
  setSelectedPatientCases,
  setPanelOpen,
  setCompletionState,
  clearDraftStorage,
  resetDraft,
  primeCaseImageCache,
  onSiteDataChanged,
  loadSiteActivity,
  upsertCaseSummaryRecord,
  patientMatchesListSearch,
  organismSummaryLabel,
  upsertPatientListRow,
  buildKnownPatientTimeline,
  applySavedLesionBoxesAndStartLivePreview,
}: HandleSaveCaseArgs) {
  const draftNeedsPrimaryOrganism =
    String(draft.culture_status || "").trim().toLowerCase() === "positive";
  const requestedVisitReference = buildVisitReference(draft);
  const patientId = draft.patient_id.trim();
  const editingSourceCase = editingCaseContext;
  const matchingPatientLookup =
    patientIdLookup &&
    patientIdLookup.requested_patient_id.trim() === patientId
      ? patientIdLookup
      : null;
  const nextVisitReference = resolveDraftVisitReference(
    draft,
    editingSourceCase ? null : matchingPatientLookup,
  );
  const patientPayload = {
    sex: draft.sex,
    age: Number(draft.age || 0),
    chart_alias: draft.chart_alias.trim(),
    local_case_code: draft.local_case_code.trim(),
  };
  const additionalOrganisms = normalizeAdditionalOrganisms(
    draft.culture_category,
    draft.culture_species,
    draft.additional_organisms,
  );
  const draftImageLesionBoxes = draftImages.map((image) => {
    const nextBox = draftLesionPromptBoxes[image.draft_id] ?? null;
    if (!nextBox) {
      return null;
    }
    const normalized = normalizeBox(nextBox);
    return hasUsableLesionPromptBox(normalized) ? normalized : null;
  });
  const visitPayload = (visitReference: string) => ({
    patient_id: patientId,
    visit_date: visitReference,
    actual_visit_date: draft.actual_visit_date.trim() || null,
    culture_status: draft.culture_status,
    culture_confirmed:
      draftNeedsPrimaryOrganism &&
      Boolean(draft.culture_category && draft.culture_species.trim()),
    culture_category: draftNeedsPrimaryOrganism ? draft.culture_category : "",
    culture_species: draftNeedsPrimaryOrganism ? draft.culture_species.trim() : "",
    additional_organisms: draftNeedsPrimaryOrganism ? additionalOrganisms : [],
    contact_lens_use: draft.contact_lens_use,
    predisposing_factor: draft.predisposing_factor,
    other_history: draft.other_history.trim(),
    visit_status: draft.visit_status,
    is_initial_visit: /^initial$/i.test(visitReference),
    polymicrobial: additionalOrganisms.length > 0,
  });
  const uploadDraftImagesToVisit = async (visitReference: string) => {
    const uploadSingleDraftImage = async (
      image: (typeof draftImages)[number],
    ) => {
      const uploadedImage = await uploadImage(selectedSiteId!, token, {
        patient_id: patientId,
        visit_date: visitReference,
        view: image.view,
        is_representative: image.is_representative,
        refresh_embeddings: false,
        file: image.file,
      });
      return toSavedCaseImagePreview(selectedSiteId!, token, uploadedImage);
    };
    const uploadedImages: SavedImagePreview[] = [];
    if (canUseDesktopTransport()) {
      uploadedImages.push(
        ...(await mapWithConcurrency(
          draftImages,
          DESKTOP_SAVE_UPLOAD_CONCURRENCY,
          async (image) => uploadSingleDraftImage(image),
        )),
      );
    } else {
      uploadedImages.push(
        ...(await Promise.all(
          draftImages.map((image) => uploadSingleDraftImage(image)),
        )),
      );
    }
    const representativeImage = pickRepresentativeSavedImage(uploadedImages);
    if (representativeImage && !canUseDesktopTransport()) {
      void setRepresentativeImageOnServer(selectedSiteId!, token, {
        patient_id: patientId,
        visit_date: visitReference,
        representative_image_id: representativeImage.image_id,
      }).catch((nextError) => {
        console.warn("Post-save embedding refresh queue failed", nextError);
      });
    }
    return uploadedImages.map((image, index) => {
      const lesionPromptBox = draftImageLesionBoxes[index];
      if (!lesionPromptBox) {
        return image;
      }
      return {
        ...image,
        lesion_prompt_box: lesionPromptBox,
        has_lesion_box: true,
      };
    });
  };
  const finalizeSavedCase = (
    visitRecord: Partial<VisitRecord>,
    visitReference: string,
    uploadedImages: SavedImagePreview[] = [],
  ) => {
    const optimisticCase = buildOptimisticSavedCase({
      patientId,
      visitReference,
      draft,
      patientPayload,
      draftNeedsPrimaryOrganism,
      additionalOrganisms,
      uploadedImages,
      visitRecord,
      editingSourceCase,
      userId: user.user_id,
    });
    const nextKnownCases = upsertCaseSummaryRecord(cases, optimisticCase, {
      replaceCase: editingSourceCase,
    });
    const shouldIncludeOptimisticCase =
      !showOnlyMine ||
      String(
        visitRecord.created_by_user_id ??
          editingSourceCase?.created_by_user_id ??
          user.user_id,
      ) === user.user_id;
    const shouldOptimisticallyUpdatePatientList =
      shouldIncludeOptimisticCase &&
      patientMatchesListSearch(normalizedPatientListSearch, optimisticCase);
    const currentPatientCaseCount = nextKnownCases.filter(
      (item) => item.patient_id === optimisticCase.patient_id,
    ).length;
    const currentPatientRow = patientListRows.find(
      (row) => row.patient_id === optimisticCase.patient_id,
    );
    const optimisticPatientRow = buildOptimisticPatientRow({
      optimisticCase,
      uploadedImages,
      currentPatientRow,
      currentPatientCaseCount,
      organismSummaryLabel,
    });

    if (shouldIncludeOptimisticCase) {
      startTransition(() => {
        setCases(nextKnownCases);
        if (shouldOptimisticallyUpdatePatientList) {
          const rowExistsOnCurrentPage = Boolean(currentPatientRow);
          const nextPatientListRows =
            rowExistsOnCurrentPage || patientListPage === 1
              ? upsertPatientListRow(patientListRows, optimisticPatientRow).slice(
                  0,
                  PATIENT_LIST_PAGE_SIZE,
                )
              : patientListRows;
          const nextTotalCount = currentPatientRow
            ? patientListTotalCount
            : patientListTotalCount + 1;
          setPatientListRows(nextPatientListRows);
          setPatientListTotalCount(nextTotalCount);
          setPatientListTotalPages(
            Math.max(1, Math.ceil(nextTotalCount / PATIENT_LIST_PAGE_SIZE)),
          );
          if (patientListPage === 1) {
            setPatientListPage(1);
          }
        }
      });
    }

    if (uploadedImages.length > 0) {
      primeCaseImageCache(optimisticCase, uploadedImages);
    }
    setToast({
      tone: "success",
      message: copy.caseSaved(
        patientId,
        visitReference,
        selectedSiteLabel ?? selectedSiteId!,
      ),
    });
    clearDraftStorage(selectedSiteId!);
    resetDraft();
    setSelectedCase(optimisticCase);
    setSelectedPatientCases(
      buildKnownPatientTimeline(nextKnownCases, optimisticCase.patient_id, optimisticCase),
    );
    setPanelOpen(true);
    void loadSiteActivity(selectedSiteId!);
    setCompletionState({
      kind: "saved",
      patient_id: patientId,
      visit_date: visitReference,
      timestamp: new Date().toISOString(),
    });
    const postSaveLesionEntries = uploadedImages
      .map((image) => ({
        imageId: image.image_id,
        lesionBox: toNormalizedBox(image.lesion_prompt_box),
        isRepresentative: Boolean(image.is_representative),
      }))
      .filter(
        (entry): entry is {
          imageId: string;
          lesionBox: NormalizedBox;
          isRepresentative: boolean;
        } => hasUsableLesionPromptBox(entry.lesionBox),
      );
    if (postSaveLesionEntries.length > 0) {
      window.setTimeout(() => {
        void applySavedLesionBoxesAndStartLivePreview(
          postSaveLesionEntries,
        ).catch((nextError) => {
          console.warn("Post-save lesion preview warm-up failed", nextError);
        });
      }, 0);
    }
    if (uploadedImages.length > 0) {
      window.setTimeout(() => {
        void fetchCaseRoiPreview(
          selectedSiteId!,
          patientId,
          visitReference,
          token,
        ).catch((nextError) => {
          console.warn("Saved case MedSAM warm-up failed", nextError);
        });
      }, postSaveLesionEntries.length > 0 ? 600 : 200);
    }

    void (async () => {
      try {
        await onSiteDataChanged(selectedSiteId!);
        const [nextCases, nextPatientList] = await Promise.all([
          fetchCases(selectedSiteId!, token, { mine: showOnlyMine }),
          fetchPatientListPage(selectedSiteId!, token, {
            mine: showOnlyMine,
            page: 1,
            page_size: PATIENT_LIST_PAGE_SIZE,
            search: normalizedPatientListSearch,
          }),
        ]);
        const refreshedCase =
          nextCases.find(
            (item) =>
              item.patient_id === patientId && item.visit_date === visitReference,
          ) ?? optimisticCase;
        if (uploadedImages.length > 0) {
          primeCaseImageCache(refreshedCase, uploadedImages);
        }
        startTransition(() => {
          setCases(nextCases);
          setPatientListRows(nextPatientList.items);
          setPatientListTotalCount(nextPatientList.total_count);
          setPatientListTotalPages(
            Math.max(1, nextPatientList.total_pages || 1),
          );
          setPatientListPage(nextPatientList.page);
          setSelectedCase((current) => {
            if (!current) {
              return current;
            }
            return current.patient_id === patientId &&
              current.visit_date === visitReference
              ? refreshedCase
              : current;
          });
          setSelectedPatientCases((current) =>
            current.some((item) => item.patient_id === patientId)
              ? buildKnownPatientTimeline(nextCases, patientId, refreshedCase)
              : current,
          );
        });
      } catch (nextError) {
        console.warn("Saved case background refresh failed", nextError);
      }
    })();
  };
  const nextAvailableFollowUpReference = async () => {
    const visits = await fetchVisits(selectedSiteId!, token, patientId);
    return `FU #${String(computeNextFollowUpNumber(visits))}`;
  };
  if (!selectedSiteId) {
    setToast({ tone: "error", message: copy.selectSiteForCase });
    return;
  }
  if (!draft.intake_completed) {
    setToast({ tone: "error", message: copy.intakeStepRequired });
    return;
  }
  if (!draft.patient_id.trim()) {
    setToast({ tone: "error", message: copy.patientIdRequired });
    return;
  }
  if (draftNeedsPrimaryOrganism && !draft.culture_species.trim()) {
    setToast({ tone: "error", message: copy.cultureSpeciesRequired });
    return;
  }
  if (draftImages.length === 0) {
    setToast({ tone: "error", message: copy.imageRequired });
    return;
  }
  if (draftImageLesionBoxes.some((box) => !hasUsableLesionPromptBox(box))) {
    setToast({ tone: "error", message: copy.lesionBoxesRequired });
    return;
  }

  setSaveBusy(true);
  try {
    const ensureAndSyncPatient = async () => {
      try {
        if (matchingPatientLookup?.exists) {
          await updatePatient(selectedSiteId, token, patientId, patientPayload);
          return;
        }
        await createPatient(selectedSiteId, token, {
          patient_id: patientId,
          ...patientPayload,
        });
      } catch (nextError) {
        if (!isAlreadyExistsError(nextError)) {
          throw nextError;
        }
        await updatePatient(selectedSiteId, token, patientId, patientPayload);
      }
    };
    const overwriteEditedVisit = async (visitReference: string) => {
      const savedVisit = (await updateVisit(
        selectedSiteId,
        token,
        editingSourceCase?.patient_id ?? patientId,
        editingSourceCase?.visit_date ?? visitReference,
        visitPayload(visitReference),
      )) as Partial<VisitRecord>;
      await deleteVisitImages(selectedSiteId, token, patientId, visitReference);
      const uploadedImages = await uploadDraftImagesToVisit(visitReference);
      finalizeSavedCase(savedVisit, visitReference, uploadedImages);
    };

    await ensureAndSyncPatient();

    if (editingSourceCase) {
      try {
        await overwriteEditedVisit(nextVisitReference);
        return;
      } catch (nextError) {
        if (!isAlreadyExistsError(nextError)) {
          throw nextError;
        }
        const overwriteConfirmed = window.confirm(
          pick(
            locale,
            `Visit ${patientId} / ${displayVisitReference(locale, nextVisitReference)} already exists.\n\nPress OK to overwrite it.\nPress Cancel to save as another case.`,
            `방문 ${patientId} / ${displayVisitReference(locale, nextVisitReference)}가 이미 존재합니다.\n\n확인을 누르면 덮어쓰고, 취소를 누르면 다른 케이스로 저장합니다.`,
          ),
        );
        if (overwriteConfirmed) {
          await deleteVisit(selectedSiteId, token, patientId, nextVisitReference);
          await overwriteEditedVisit(nextVisitReference);
        } else {
          const alternateVisitReference = await nextAvailableFollowUpReference();
          const saveAlternateConfirmed = window.confirm(
            pick(
              locale,
              `Save this case as ${displayVisitReference(locale, alternateVisitReference)} instead?`,
              `이 케이스를 ${displayVisitReference(locale, alternateVisitReference)}로 저장할까요?`,
            ),
          );
          if (!saveAlternateConfirmed) {
            return;
          }
          await overwriteEditedVisit(alternateVisitReference);
        }
        return;
      }
    }

    const createVisitReference =
      matchingPatientLookup?.exists &&
      Number(matchingPatientLookup.visit_count || 0) > 0 &&
      /^initial$/i.test(requestedVisitReference)
        ? await nextAvailableFollowUpReference()
        : nextVisitReference;
    const existingPatientFollowUpOnly =
      matchingPatientLookup?.exists &&
      Number(matchingPatientLookup.visit_count || 0) > 0;

    try {
      const savedVisit = (await createVisit(
        selectedSiteId,
        token,
        visitPayload(createVisitReference),
      )) as Partial<VisitRecord>;
      const uploadedImages = await uploadDraftImagesToVisit(createVisitReference);
      finalizeSavedCase(savedVisit, createVisitReference, uploadedImages);
    } catch (nextError) {
      if (!isAlreadyExistsError(nextError)) {
        throw nextError;
      }
      if (existingPatientFollowUpOnly) {
        const alternateVisitReference = await nextAvailableFollowUpReference();
        if (alternateVisitReference === createVisitReference) {
          throw nextError;
        }
        const savedVisit = (await createVisit(
          selectedSiteId,
          token,
          visitPayload(alternateVisitReference),
        )) as Partial<VisitRecord>;
        const uploadedImages = await uploadDraftImagesToVisit(alternateVisitReference);
        finalizeSavedCase(savedVisit, alternateVisitReference, uploadedImages);
        return;
      }
      const overwriteConfirmed = window.confirm(
        pick(
          locale,
          `Visit ${patientId} / ${displayVisitReference(locale, createVisitReference)} already exists.\n\nPress OK to overwrite it.\nPress Cancel to save as another case.`,
          `방문 ${patientId} / ${displayVisitReference(locale, createVisitReference)}가 이미 존재합니다.\n\n확인을 누르면 덮어쓰고, 취소를 누르면 다른 케이스로 저장합니다.`,
        ),
      );
      if (overwriteConfirmed) {
        const savedVisit = (await updateVisit(
          selectedSiteId,
          token,
          patientId,
          createVisitReference,
          visitPayload(createVisitReference),
        )) as Partial<VisitRecord>;
        await deleteVisitImages(
          selectedSiteId,
          token,
          patientId,
          createVisitReference,
        );
        const uploadedImages = await uploadDraftImagesToVisit(createVisitReference);
        finalizeSavedCase(savedVisit, createVisitReference, uploadedImages);
      } else {
        const alternateVisitReference = await nextAvailableFollowUpReference();
        const saveAlternateConfirmed = window.confirm(
          pick(
            locale,
            `Save this case as ${displayVisitReference(locale, alternateVisitReference)} instead?`,
            `이 케이스를 ${displayVisitReference(locale, alternateVisitReference)}로 저장할까요?`,
          ),
        );
        if (!saveAlternateConfirmed) {
          return;
        }
        const savedVisit = (await createVisit(
          selectedSiteId,
          token,
          visitPayload(alternateVisitReference),
        )) as Partial<VisitRecord>;
        const uploadedImages = await uploadDraftImagesToVisit(alternateVisitReference);
        finalizeSavedCase(savedVisit, alternateVisitReference, uploadedImages);
      }
    }
  } catch (nextError) {
    setToast({
      tone: "error",
      message: describeError(nextError, copy.caseSaveFailed),
    });
  } finally {
    setSaveBusy(false);
  }
}
