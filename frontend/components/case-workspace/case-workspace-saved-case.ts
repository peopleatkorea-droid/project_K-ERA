import type {
  Dispatch,
  MutableRefObject,
  SetStateAction,
} from "react";

import {
  fetchCases,
  fetchImageBlob,
  fetchImages,
  fetchVisits,
  type CaseSummaryRecord,
  type OrganismRecord,
  type VisitRecord,
} from "../../lib/api";
import type { Locale } from "../../lib/i18n";
import type { LesionBoxMap, SavedImagePreview } from "./shared";
import {
  computeNextFollowUpNumber,
  displayVisitReference,
  FOLLOW_UP_VISIT_PATTERN,
  normalizeAdditionalOrganisms,
  normalizeCultureStatus,
} from "./case-workspace-draft-helpers";
import { normalizeBox } from "./case-workspace-core-helpers";

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

type EditingCaseContext = {
  patient_id: string;
  visit_date: string;
  created_at?: string | null;
  created_by_user_id?: string | null;
} | null;

type PendingOrganism = Pick<
  OrganismRecord,
  "culture_category" | "culture_species"
>;

type LocalePick = (locale: Locale, en: string, ko: string) => string;

function normalizeDraftCultureFields(
  cultureStatus: string | null | undefined,
  cultureCategory: string | null | undefined,
  cultureSpecies: string | null | undefined,
  additionalOrganisms: OrganismRecord[] | undefined,
): Pick<
  DraftState,
  "culture_status" | "culture_category" | "culture_species" | "additional_organisms"
> {
  const normalizedCultureStatus = normalizeCultureStatus(cultureStatus);
  if (normalizedCultureStatus !== "positive") {
    return {
      culture_status: normalizedCultureStatus,
      culture_category: "",
      culture_species: "",
      additional_organisms: [],
    };
  }
  const normalizedCultureCategory = String(cultureCategory ?? "").trim();
  const normalizedCultureSpecies = String(cultureSpecies ?? "").trim();
  return {
    culture_status: normalizedCultureStatus,
    culture_category: normalizedCultureCategory,
    culture_species: normalizedCultureSpecies,
    additional_organisms: normalizeAdditionalOrganisms(
      normalizedCultureCategory,
      normalizedCultureSpecies,
      additionalOrganisms,
    ),
  };
}

type OpenSavedCaseArgs = {
  caseRecord: CaseSummaryRecord;
  nextView?: "cases" | "patients";
  desktopFastMode: boolean;
  workspaceTimingLogs: boolean;
  caseOpenStartedAtRef: MutableRefObject<number | null>;
  caseOpenCaseIdRef: MutableRefObject<string | null>;
  caseImagesLoggedCaseIdRef: MutableRefObject<string | null>;
  cases: CaseSummaryRecord[];
  setCases: Dispatch<SetStateAction<CaseSummaryRecord[]>>;
  setSelectedCase: Dispatch<SetStateAction<CaseSummaryRecord | null>>;
  setSelectedPatientCases: Dispatch<SetStateAction<CaseSummaryRecord[]>>;
  setPanelOpen: Dispatch<SetStateAction<boolean>>;
  setRailView: Dispatch<SetStateAction<"cases" | "patients">>;
  buildKnownPatientTimeline: (
    caseRecords: CaseSummaryRecord[],
    patientId: string,
    fallbackCase?: CaseSummaryRecord | null,
  ) => CaseSummaryRecord[];
};

type StartFollowUpDraftArgs = {
  selectedCase: CaseSummaryRecord | null;
  selectedSiteId: string | null;
  token: string;
  locale: Locale;
  cultureSpecies: Record<string, string[]>;
  describeError: (error: unknown, fallback: string) => string;
  pick: LocalePick;
  setToast: Dispatch<SetStateAction<ToastState>>;
  setEditingCaseContext: Dispatch<SetStateAction<EditingCaseContext>>;
  replaceDraftImagesAndBoxes: (nextImages: DraftImage[]) => void;
  setDraftLesionPromptBoxes: Dispatch<SetStateAction<LesionBoxMap>>;
  clearDraftStorage: (siteId?: string | null) => void;
  resetAnalysisState: () => void;
  setSelectedCase: Dispatch<SetStateAction<CaseSummaryRecord | null>>;
  setSelectedCaseImages: Dispatch<SetStateAction<SavedImagePreview[]>>;
  setPanelOpen: Dispatch<SetStateAction<boolean>>;
  setRailView: Dispatch<SetStateAction<"cases" | "patients">>;
  setDraft: Dispatch<SetStateAction<DraftState>>;
  setPendingOrganism: Dispatch<SetStateAction<PendingOrganism>>;
  setShowAdditionalOrganismForm: Dispatch<SetStateAction<boolean>>;
  visitTimestamp: (visitRecord: VisitRecord) => number;
};

type StartEditDraftArgs = {
  selectedCase: CaseSummaryRecord | null;
  selectedSiteId: string | null;
  token: string;
  locale: Locale;
  cultureSpecies: Record<string, string[]>;
  describeError: (error: unknown, fallback: string) => string;
  pick: LocalePick;
  setToast: Dispatch<SetStateAction<ToastState>>;
  setEditDraftBusy: Dispatch<SetStateAction<boolean>>;
  clearDraftStorage: (siteId?: string | null) => void;
  resetAnalysisState: () => void;
  setPanelOpen: Dispatch<SetStateAction<boolean>>;
  setRailView: Dispatch<SetStateAction<"cases" | "patients">>;
  setEditingCaseContext: Dispatch<SetStateAction<EditingCaseContext>>;
  setSelectedCase: Dispatch<SetStateAction<CaseSummaryRecord | null>>;
  setSelectedCaseImages: Dispatch<SetStateAction<SavedImagePreview[]>>;
  replaceDraftImagesAndBoxes: (nextImages: DraftImage[]) => void;
  setDraftLesionPromptBoxes: Dispatch<SetStateAction<LesionBoxMap>>;
  setDraft: Dispatch<SetStateAction<DraftState>>;
  setPendingOrganism: Dispatch<SetStateAction<PendingOrganism>>;
  setShowAdditionalOrganismForm: Dispatch<SetStateAction<boolean>>;
  createDraftId: () => string;
};

type OpenImageTextSearchResultArgs = {
  patientId: string;
  visitDate: string;
  selectedSiteId: string | null;
  token: string;
  showOnlyMine: boolean;
  locale: Locale;
  cases: CaseSummaryRecord[];
  pick: LocalePick;
  selectSiteForCaseMessage: string;
  setToast: Dispatch<SetStateAction<ToastState>>;
  setCases: Dispatch<SetStateAction<CaseSummaryRecord[]>>;
  openSavedCase: (caseRecord: CaseSummaryRecord, nextView?: "cases" | "patients") => void;
};

export function openSavedCase({
  caseRecord,
  nextView = "cases",
  desktopFastMode,
  workspaceTimingLogs,
  caseOpenStartedAtRef,
  caseOpenCaseIdRef,
  caseImagesLoggedCaseIdRef,
  cases,
  setCases,
  setSelectedCase,
  setSelectedPatientCases,
  setPanelOpen,
  setRailView,
  buildKnownPatientTimeline,
}: OpenSavedCaseArgs) {
  if (desktopFastMode) {
    caseOpenStartedAtRef.current = performance.now();
    caseOpenCaseIdRef.current = caseRecord.case_id;
    caseImagesLoggedCaseIdRef.current = null;
    if (workspaceTimingLogs) {
      console.info("[kera-fast-path] case-open", {
        case_id: caseRecord.case_id,
        patient_id: caseRecord.patient_id,
        visit_date: caseRecord.visit_date,
      });
    }
  }
  setCases((current) => {
    if (current.some((item) => item.case_id === caseRecord.case_id)) {
      return current;
    }
    return [caseRecord, ...current];
  });
  setSelectedCase(caseRecord);
  setSelectedPatientCases(
    buildKnownPatientTimeline(cases, caseRecord.patient_id, caseRecord),
  );
  setPanelOpen(true);
  setRailView(nextView);
  window.scrollTo({ top: 0, behavior: "auto" });
}

export async function startFollowUpDraftFromSelectedCase({
  selectedCase,
  selectedSiteId,
  token,
  locale,
  cultureSpecies,
  describeError,
  pick,
  setToast,
  setEditingCaseContext,
  replaceDraftImagesAndBoxes,
  setDraftLesionPromptBoxes,
  clearDraftStorage,
  resetAnalysisState,
  setSelectedCase,
  setSelectedCaseImages,
  setPanelOpen,
  setRailView,
  setDraft,
  setPendingOrganism,
  setShowAdditionalOrganismForm,
  visitTimestamp,
}: StartFollowUpDraftArgs) {
  if (!selectedCase) {
    return;
  }

  setEditingCaseContext(null);
  replaceDraftImagesAndBoxes([]);
  setDraftLesionPromptBoxes({});
  clearDraftStorage();
  resetAnalysisState();
  setSelectedCase(null);
  setSelectedCaseImages([]);
  setPanelOpen(true);
  setRailView("cases");
  const selectedFollowUpMatch = String(selectedCase.visit_date ?? "").match(
    FOLLOW_UP_VISIT_PATTERN,
  );
  const fallbackFollowUpNumber = String(
    (selectedFollowUpMatch ? Number(selectedFollowUpMatch[1]) || 0 : 0) + 1,
  );

  const applyFallbackDraft = (followUpNumber: string) => {
    setDraft((current) => ({
      ...current,
      ...normalizeDraftCultureFields(
        selectedCase.culture_status || current.culture_status,
        selectedCase.culture_category || current.culture_category,
        selectedCase.culture_species || current.culture_species,
        selectedCase.additional_organisms,
      ),
      patient_id: selectedCase.patient_id,
      sex: selectedCase.sex || current.sex,
      age: String(selectedCase.age ?? current.age),
      chart_alias: selectedCase.chart_alias ?? current.chart_alias,
      local_case_code:
        selectedCase.local_case_code ?? current.local_case_code,
      actual_visit_date: "",
      contact_lens_use:
        selectedCase.contact_lens_use || current.contact_lens_use,
      visit_status: selectedCase.visit_status || current.visit_status,
      is_initial_visit: false,
      follow_up_number: followUpNumber,
      intake_completed: true,
    }));
    const pendingCultureStatus = normalizeCultureStatus(
      selectedCase.culture_status,
    );
    const pendingCultureCategory =
      pendingCultureStatus === "positive"
        ? selectedCase.culture_category || "bacterial"
        : "bacterial";
    setPendingOrganism({
      culture_category: pendingCultureCategory,
      culture_species:
        pendingCultureStatus === "positive"
          ? selectedCase.additional_organisms?.[0]?.culture_species ||
            selectedCase.culture_species ||
            (cultureSpecies[pendingCultureCategory]?.[0] ?? "")
          : (cultureSpecies[pendingCultureCategory]?.[0] ?? ""),
    });
    setShowAdditionalOrganismForm(false);
  };

  if (!selectedSiteId) {
    applyFallbackDraft(fallbackFollowUpNumber);
    return;
  }

  try {
    const visits = await fetchVisits(
      selectedSiteId,
      token,
      selectedCase.patient_id,
    );
    const nextFollowUpNumber = String(computeNextFollowUpNumber(visits));
    const latestVisit =
      [...visits].sort(
        (left, right) => visitTimestamp(right) - visitTimestamp(left),
      )[0] ?? null;
    if (!latestVisit) {
      applyFallbackDraft(nextFollowUpNumber);
      return;
    }
    setDraft((current) => ({
      ...current,
      ...normalizeDraftCultureFields(
        latestVisit.culture_status ||
          selectedCase.culture_status ||
          current.culture_status,
        latestVisit.culture_category ||
          selectedCase.culture_category ||
          current.culture_category,
        latestVisit.culture_species ||
          selectedCase.culture_species ||
          current.culture_species,
        latestVisit.additional_organisms ?? selectedCase.additional_organisms,
      ),
      patient_id: selectedCase.patient_id,
      sex: selectedCase.sex || current.sex,
      age: String(selectedCase.age ?? current.age),
      chart_alias: selectedCase.chart_alias ?? current.chart_alias,
      local_case_code:
        selectedCase.local_case_code ?? current.local_case_code,
      actual_visit_date: "",
      contact_lens_use:
        latestVisit.contact_lens_use ||
        selectedCase.contact_lens_use ||
        current.contact_lens_use,
      visit_status:
        latestVisit.visit_status ||
        selectedCase.visit_status ||
        current.visit_status,
      is_initial_visit: false,
      follow_up_number: nextFollowUpNumber,
      predisposing_factor:
        latestVisit.predisposing_factor ?? current.predisposing_factor,
      other_history: latestVisit.other_history ?? current.other_history,
      intake_completed: true,
    }));
    const pendingCultureStatus = normalizeCultureStatus(
      latestVisit.culture_status || selectedCase.culture_status,
    );
    const pendingCultureCategory =
      pendingCultureStatus === "positive"
        ? latestVisit.culture_category ||
          selectedCase.culture_category ||
          "bacterial"
        : "bacterial";
    setPendingOrganism({
      culture_category: pendingCultureCategory,
      culture_species:
        pendingCultureStatus === "positive"
          ? latestVisit.additional_organisms?.[0]?.culture_species ||
            latestVisit.culture_species ||
            selectedCase.culture_species ||
            (cultureSpecies[pendingCultureCategory]?.[0] ?? "")
          : (cultureSpecies[pendingCultureCategory]?.[0] ?? ""),
    });
    setShowAdditionalOrganismForm(false);
  } catch (nextError) {
    applyFallbackDraft(fallbackFollowUpNumber);
    setToast({
      tone: "error",
      message: describeError(
        nextError,
        pick(
          locale,
          "Unable to prepare the next follow-up draft for this patient.",
          "이 환자의 다음 추적 초안을 준비하지 못했습니다.",
        ),
      ),
    });
  }
}

export async function startEditDraftFromSelectedCase({
  selectedCase,
  selectedSiteId,
  token,
  locale,
  cultureSpecies,
  describeError,
  pick,
  setToast,
  setEditDraftBusy,
  clearDraftStorage,
  resetAnalysisState,
  setPanelOpen,
  setRailView,
  setEditingCaseContext,
  setSelectedCase,
  setSelectedCaseImages,
  replaceDraftImagesAndBoxes,
  setDraftLesionPromptBoxes,
  setDraft,
  setPendingOrganism,
  setShowAdditionalOrganismForm,
  createDraftId,
}: StartEditDraftArgs) {
  if (!selectedCase) {
    return;
  }

  const caseToEdit = selectedCase;
  setEditDraftBusy(true);
  try {
    let nextDraftImages: DraftImage[] = [];
    let nextDraftBoxes: LesionBoxMap = {};
    let selectedVisit: VisitRecord | null = null;

    if (selectedSiteId) {
      const [savedImages, savedVisits] = await Promise.all([
        fetchImages(
          selectedSiteId,
          token,
          caseToEdit.patient_id,
          caseToEdit.visit_date,
        ),
        fetchVisits(selectedSiteId, token, caseToEdit.patient_id),
      ]);
      selectedVisit =
        savedVisits.find(
          (visit) => visit.visit_date === caseToEdit.visit_date,
        ) ?? null;
      nextDraftImages = await Promise.all(
        savedImages.map(async (image) => {
          const blob = await fetchImageBlob(
            selectedSiteId,
            image.image_id,
            token,
          );
          const mediaType = blob.type || "image/jpeg";
          const extension =
            mediaType === "image/png"
              ? "png"
              : mediaType === "image/webp"
                ? "webp"
                : mediaType === "image/bmp"
                  ? "bmp"
                  : mediaType === "image/tiff"
                    ? "tiff"
                    : "jpg";
          const file = new File([blob], `${image.image_id}.${extension}`, {
            type: mediaType,
          });
          const draftId = createDraftId();
          nextDraftBoxes[draftId] =
            image.lesion_prompt_box &&
            typeof image.lesion_prompt_box === "object"
              ? normalizeBox(image.lesion_prompt_box)
              : null;
          return {
            draft_id: draftId,
            file,
            preview_url: URL.createObjectURL(blob),
            view: image.view,
            is_representative: image.is_representative,
          };
        }),
      );
    }

    clearDraftStorage();
    resetAnalysisState();
    setPanelOpen(true);
    setRailView("cases");
    setEditingCaseContext({
      patient_id: caseToEdit.patient_id,
      visit_date: caseToEdit.visit_date,
      created_at: caseToEdit.created_at,
      created_by_user_id: caseToEdit.created_by_user_id,
    });
    setSelectedCase(null);
    setSelectedCaseImages([]);
    replaceDraftImagesAndBoxes(nextDraftImages);
    setDraftLesionPromptBoxes(nextDraftBoxes);
    setDraft((current) => ({
      ...current,
      ...normalizeDraftCultureFields(
        selectedVisit?.culture_status ||
          caseToEdit.culture_status ||
          current.culture_status,
        caseToEdit.culture_category || current.culture_category,
        caseToEdit.culture_species || current.culture_species,
        selectedVisit?.additional_organisms ??
          caseToEdit.additional_organisms,
      ),
      patient_id: caseToEdit.patient_id,
      sex: caseToEdit.sex || current.sex,
      age: String(caseToEdit.age ?? current.age),
      chart_alias: caseToEdit.chart_alias ?? current.chart_alias,
      local_case_code: caseToEdit.local_case_code ?? current.local_case_code,
      actual_visit_date: caseToEdit.actual_visit_date?.trim() || "",
      contact_lens_use:
        selectedVisit?.contact_lens_use ||
        caseToEdit.contact_lens_use ||
        current.contact_lens_use,
      visit_status:
        selectedVisit?.visit_status ||
        caseToEdit.visit_status ||
        current.visit_status,
      is_initial_visit: /^initial$/i.test(caseToEdit.visit_date),
      follow_up_number: (() => {
        const followUpMatch = String(caseToEdit.visit_date ?? "").match(
          FOLLOW_UP_VISIT_PATTERN,
        );
        return followUpMatch
          ? String(Number(followUpMatch[1]) || 1)
          : current.follow_up_number;
      })(),
      predisposing_factor:
        selectedVisit?.predisposing_factor ?? current.predisposing_factor,
      other_history: selectedVisit?.other_history ?? current.other_history,
      intake_completed: false,
    }));
    const pendingCultureStatus = normalizeCultureStatus(
      selectedVisit?.culture_status || caseToEdit.culture_status,
    );
    const pendingCultureCategory =
      pendingCultureStatus === "positive"
        ? caseToEdit.culture_category || "bacterial"
        : "bacterial";
    setPendingOrganism({
      culture_category: pendingCultureCategory,
      culture_species:
        pendingCultureStatus === "positive"
          ? caseToEdit.additional_organisms?.[0]?.culture_species ||
            caseToEdit.culture_species ||
            (cultureSpecies[pendingCultureCategory]?.[0] ?? "")
          : (cultureSpecies[pendingCultureCategory]?.[0] ?? ""),
    });
    setShowAdditionalOrganismForm(false);
  } catch (nextError) {
    setToast({
      tone: "error",
      message: describeError(
        nextError,
        pick(
          locale,
          "Unable to open this saved case in edit mode.",
          "이 저장 케이스를 수정 모드로 열지 못했습니다.",
        ),
      ),
    });
  } finally {
    setEditDraftBusy(false);
  }
}

export async function handleOpenImageTextSearchResult({
  patientId,
  visitDate,
  selectedSiteId,
  token,
  showOnlyMine,
  locale,
  cases,
  pick,
  selectSiteForCaseMessage,
  setToast,
  setCases,
  openSavedCase,
}: OpenImageTextSearchResultArgs) {
  if (!selectedSiteId) {
    setToast({ tone: "error", message: selectSiteForCaseMessage });
    return;
  }

  const findMatchingCase = (items: CaseSummaryRecord[]) =>
    items.find(
      (item) => item.patient_id === patientId && item.visit_date === visitDate,
    ) ?? null;

  const cachedMatch = findMatchingCase(cases);
  if (cachedMatch) {
    openSavedCase(cachedMatch, "cases");
    return;
  }

  try {
    const nextCases = await fetchCases(selectedSiteId, token, {
      mine: showOnlyMine,
    });
    setCases(nextCases);
    const refreshedMatch = findMatchingCase(nextCases);
    if (refreshedMatch) {
      openSavedCase(refreshedMatch, "cases");
      return;
    }
    setToast({
      tone: "error",
      message: pick(
        locale,
        `Could not open ${patientId} / ${displayVisitReference(locale, visitDate)} from the current case list.`,
        `${patientId} / ${displayVisitReference(locale, visitDate)} 케이스를 현재 목록에서 열 수 없습니다.`,
      ),
    });
  } catch (nextError) {
    setToast({
      tone: "error",
      message:
        nextError instanceof Error
          ? nextError.message
          : pick(
              locale,
              "Unable to refresh cases for this patient.",
              "이 환자 케이스를 새로고침하지 못했습니다.",
            ),
    });
  }
}
