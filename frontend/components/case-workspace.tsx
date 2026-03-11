"use client";

import { useDeferredValue, useEffect, useRef, useState } from "react";

import { LocaleToggle, pick, translateApiError, translateOption, translateRole, useI18n } from "../lib/i18n";
import {
  type CaseHistoryResponse,
  type CaseContributionResponse,
  type OrganismRecord,
  type PatientRecord,
  type RoiPreviewRecord,
  type SiteActivityResponse,
  type SiteValidationRunRecord,
  createPatient,
  createVisit,
  fetchCaseHistory,
  fetchCaseRoiPreview,
  fetchCaseRoiPreviewArtifactBlob,
  fetchCases,
  fetchImageBlob,
  fetchPatients,
  fetchValidationArtifactBlob,
  fetchImages,
  fetchSiteActivity,
  fetchSiteValidations,
  type AuthUser,
  type CaseSummaryRecord,
  type CaseValidationResponse,
  type ImageRecord,
  type SiteRecord,
  type SiteSummary,
  runSiteValidation,
  runCaseContribution,
  runCaseValidation,
  uploadImage,
} from "../lib/api";

const SEX_OPTIONS = ["female", "male", "other", "unknown"];
const CONTACT_LENS_OPTIONS = [
  "none",
  "soft contact lens",
  "rigid gas permeable",
  "orthokeratology",
  "unknown",
];
const PREDISPOSING_FACTOR_OPTIONS = [
  "trauma",
  "ocular surface disease",
  "topical steroid use",
  "post surgery",
  "neurotrophic",
  "unknown",
];
const VISIT_STATUS_OPTIONS = ["active", "improving", "scar"];
const CULTURE_SPECIES: Record<string, string[]> = {
  bacterial: [
    "Staphylococcus aureus",
    "Staphylococcus epidermidis",
    "Coagulase-negative Staphylococcus",
    "Streptococcus pneumoniae",
    "Streptococcus viridans group",
    "Pseudomonas aeruginosa",
    "Moraxella",
    "Corynebacterium",
    "Serratia marcescens",
    "Bacillus",
    "Haemophilus influenzae",
    "Klebsiella pneumoniae",
    "Enterobacter",
    "Burkholderia",
    "Nocardia",
    "Other",
  ],
  fungal: [
    "Fusarium",
    "Aspergillus",
    "Candida",
    "Curvularia",
    "Alternaria",
    "Colletotrichum",
    "Acremonium",
    "Lasiodiplodia",
    "Cladophialophora",
    "Australiasca",
    "Penicillium",
    "Bipolaris",
    "Scedosporium",
    "Paecilomyces",
    "Exserohilum",
    "Cladosporium",
    "Other",
  ],
};

type DraftImage = {
  draft_id: string;
  file: File;
  preview_url: string;
  view: string;
  is_representative: boolean;
};

type SavedImagePreview = ImageRecord & {
  preview_url: string | null;
};

type RoiPreviewCard = RoiPreviewRecord & {
  source_preview_url: string | null;
  roi_crop_url: string | null;
};

type ValidationArtifactKind = "gradcam" | "roi_crop" | "medsam_mask";

type ValidationArtifactPreviews = Partial<Record<ValidationArtifactKind, string | null>>;

type DraftState = {
  patient_id: string;
  chart_alias: string;
  local_case_code: string;
  sex: string;
  age: string;
  actual_visit_date: string;
  follow_up_number: string;
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

type PersistedDraft = {
  draft: DraftState;
  updated_at: string;
};

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
};

type ToastState = {
  tone: "success" | "error";
  message: string;
} | null;

type CaseWorkspaceProps = {
  token: string;
  user: AuthUser;
  sites: SiteRecord[];
  selectedSiteId: string | null;
  summary: SiteSummary | null;
  canOpenOperations: boolean;
  theme: "dark" | "light";
  onSelectSite: (siteId: string) => void;
  onExportManifest: () => void;
  onLogout: () => void;
  onOpenOperations: () => void;
  onSiteDataChanged: (siteId: string) => Promise<void>;
  onToggleTheme: () => void;
};

function createDraft(): DraftState {
  return {
    patient_id: "",
    chart_alias: "",
    local_case_code: "",
    sex: "female",
    age: "65",
    actual_visit_date: "",
    follow_up_number: "1",
    culture_category: "bacterial",
    culture_species: CULTURE_SPECIES.bacterial[0],
    additional_organisms: [],
    contact_lens_use: "none",
    visit_status: "active",
    is_initial_visit: true,
    predisposing_factor: [],
    other_history: "",
    intake_completed: false,
  };
}

function createDraftId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatCaseTitle(caseRecord: CaseSummaryRecord): string {
  return caseRecord.local_case_code || caseRecord.patient_id;
}

function organismKey(organism: Pick<OrganismRecord, "culture_category" | "culture_species">): string {
  return `${organism.culture_category.trim().toLowerCase()}::${organism.culture_species.trim().toLowerCase()}`;
}

function normalizeAdditionalOrganisms(
  primaryCategory: string,
  primarySpecies: string,
  organisms: OrganismRecord[] | undefined
): OrganismRecord[] {
  const primaryKey = organismKey({
    culture_category: primaryCategory,
    culture_species: primarySpecies,
  });
  const seen = new Set<string>([primaryKey]);
  const normalized: OrganismRecord[] = [];
  for (const organism of organisms ?? []) {
    const culture_category = String(organism?.culture_category ?? "").trim().toLowerCase();
    const culture_species = String(organism?.culture_species ?? "").trim();
    if (!culture_category || !culture_species) {
      continue;
    }
    const nextKey = organismKey({ culture_category, culture_species });
    if (seen.has(nextKey)) {
      continue;
    }
    seen.add(nextKey);
    normalized.push({ culture_category, culture_species });
  }
  return normalized;
}

function listOrganisms(
  cultureCategory: string,
  cultureSpecies: string,
  additionalOrganisms: OrganismRecord[] | undefined
): OrganismRecord[] {
  const primarySpecies = cultureSpecies.trim();
  if (!primarySpecies) {
    return normalizeAdditionalOrganisms(cultureCategory, cultureSpecies, additionalOrganisms);
  }
  return [
    {
      culture_category: cultureCategory.trim().toLowerCase(),
      culture_species: primarySpecies,
    },
    ...normalizeAdditionalOrganisms(cultureCategory, cultureSpecies, additionalOrganisms),
  ];
}

function organismSummaryLabel(
  cultureCategory: string,
  cultureSpecies: string,
  additionalOrganisms: OrganismRecord[] | undefined
): string {
  const organisms = listOrganisms(cultureCategory, cultureSpecies, additionalOrganisms);
  if (!organisms.length) {
    return "";
  }
  if (organisms.length === 1) {
    return organisms[0].culture_species;
  }
  return `${organisms[0].culture_species} + ${organisms.length - 1}`;
}

function organismDetailLabel(
  cultureCategory: string,
  cultureSpecies: string,
  additionalOrganisms: OrganismRecord[] | undefined
): string {
  return listOrganisms(cultureCategory, cultureSpecies, additionalOrganisms)
    .map((organism) => organism.culture_species)
    .join(" · ");
}

function formatProbability(value: number | null | undefined, emptyLabel = "n/a"): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return emptyLabel;
  }
  return `${Math.round(value * 100)}%`;
}

function formatDateTime(value: string | null | undefined, localeTag: string, emptyLabel: string): string {
  if (!value) {
    return emptyLabel;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString(localeTag, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function confidencePercent(value: number | null | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

function confidenceTone(percent: number): "high" | "medium" | "low" {
  if (percent >= 80) {
    return "high";
  }
  if (percent >= 60) {
    return "medium";
  }
  return "low";
}

function draftStorageKey(userId: string, siteId: string): string {
  return `kera_workspace_draft:${userId}:${siteId}`;
}

function favoriteStorageKey(userId: string, siteId: string): string {
  return `kera_workspace_favorites:${userId}:${siteId}`;
}

function buildVisitReference(draft: DraftState): string {
  if (draft.is_initial_visit) {
    return "Initial";
  }
  return `F/U-${draft.follow_up_number.padStart(2, "0")}`;
}

function displayVisitReference(locale: "en" | "ko", visitReference: string): string {
  const normalized = String(visitReference ?? "").trim();
  if (!normalized) {
    return normalized;
  }
  if (/^(initial|초진)$/i.test(normalized)) {
    return pick(locale, "Initial", "초진");
  }
  const followUpMatch = normalized.match(/^(?:F\/?U|FU)[-\s_#]*0*(\d+)$/i);
  if (followUpMatch) {
    return `FU #${String(Number(followUpMatch[1]))}`;
  }
  return normalized;
}

function normalizeRecoveredDraft(draft: DraftState): DraftState {
  const recoveredDraft = draft as DraftState & { visit_date?: string };
  const normalizedAdditionalOrganisms = normalizeAdditionalOrganisms(
    draft.culture_category,
    draft.culture_species,
    draft.additional_organisms
  );
  const visitReference = String(recoveredDraft.visit_date ?? "").trim();
  const followUpMatch = visitReference.match(/^(?:F\/?U|FU)[-\s_#]*0*(\d+)$/i);
  if (followUpMatch) {
    return {
      ...draft,
      additional_organisms: normalizedAdditionalOrganisms,
      follow_up_number: String(Number(followUpMatch[1]) || 1),
      is_initial_visit: false,
    };
  }
  if (/^(initial|초진)$/i.test(visitReference)) {
    return {
      ...draft,
      additional_organisms: normalizedAdditionalOrganisms,
      follow_up_number: draft.follow_up_number || "1",
      is_initial_visit: true,
    };
  }
  return {
    ...draft,
    additional_organisms: normalizedAdditionalOrganisms,
    actual_visit_date:
      String(recoveredDraft.actual_visit_date ?? "").trim() || String(recoveredDraft.visit_date ?? "").trim(),
    follow_up_number: draft.follow_up_number || "1",
    is_initial_visit: draft.is_initial_visit ?? true,
    intake_completed: Boolean(draft.intake_completed),
  };
}

function hasDraftContent(draft: DraftState): boolean {
  const emptyDraft = createDraft();
  return (
    draft.patient_id.trim() !== emptyDraft.patient_id ||
    draft.chart_alias.trim() !== emptyDraft.chart_alias ||
    draft.local_case_code.trim() !== emptyDraft.local_case_code ||
    draft.sex !== emptyDraft.sex ||
    draft.age !== emptyDraft.age ||
    draft.actual_visit_date !== emptyDraft.actual_visit_date ||
    draft.follow_up_number !== emptyDraft.follow_up_number ||
    draft.culture_category !== emptyDraft.culture_category ||
    draft.culture_species !== emptyDraft.culture_species ||
    draft.additional_organisms.length > 0 ||
    draft.contact_lens_use !== emptyDraft.contact_lens_use ||
    draft.visit_status !== emptyDraft.visit_status ||
    draft.is_initial_visit !== emptyDraft.is_initial_visit ||
    draft.predisposing_factor.length > 0 ||
    draft.other_history.trim() !== emptyDraft.other_history ||
    draft.intake_completed !== emptyDraft.intake_completed
  );
}

function executionModeFromDevice(device: string | undefined): "auto" | "cpu" | "gpu" {
  if (device === "cuda") {
    return "gpu";
  }
  if (device === "cpu") {
    return "cpu";
  }
  return "auto";
}

function visitPhaseCopy(locale: "en" | "ko", isInitialVisit: boolean): string {
  return isInitialVisit ? pick(locale, "Initial", "초진") : pick(locale, "Follow-up", "재진");
}

export function CaseWorkspace({
  token,
  user,
  sites,
  selectedSiteId,
  summary,
  canOpenOperations,
  theme,
  onSelectSite,
  onExportManifest,
  onLogout,
  onOpenOperations,
  onSiteDataChanged,
  onToggleTheme,
}: CaseWorkspaceProps) {
  const { locale, localeTag, common } = useI18n();
  const describeError = (nextError: unknown, fallback: string) =>
    nextError instanceof Error ? translateApiError(locale, nextError.message) : fallback;
  const [draft, setDraft] = useState<DraftState>(() => createDraft());
  const [pendingOrganism, setPendingOrganism] = useState<OrganismRecord>({
    culture_category: "bacterial",
    culture_species: CULTURE_SPECIES.bacterial[0],
  });
  const [showAdditionalOrganismForm, setShowAdditionalOrganismForm] = useState(false);
  const [draftImages, setDraftImages] = useState<DraftImage[]>([]);
  const [patientRecords, setPatientRecords] = useState<PatientRecord[]>([]);
  const [patientsLoading, setPatientsLoading] = useState(false);
  const [cases, setCases] = useState<CaseSummaryRecord[]>([]);
  const [casesLoading, setCasesLoading] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [selectedCase, setSelectedCase] = useState<CaseSummaryRecord | null>(null);
  const [selectedCaseImages, setSelectedCaseImages] = useState<SavedImagePreview[]>([]);
  const [panelBusy, setPanelBusy] = useState(false);
  const [activityBusy, setActivityBusy] = useState(false);
  const [siteActivity, setSiteActivity] = useState<SiteActivityResponse | null>(null);
  const [siteValidationBusy, setSiteValidationBusy] = useState(false);
  const [siteValidationRuns, setSiteValidationRuns] = useState<SiteValidationRunRecord[]>([]);
  const [validationBusy, setValidationBusy] = useState(false);
  const [validationResult, setValidationResult] = useState<CaseValidationResponse | null>(null);
  const [validationArtifacts, setValidationArtifacts] = useState<ValidationArtifactPreviews>({});
  const [roiPreviewBusy, setRoiPreviewBusy] = useState(false);
  const [roiPreviewItems, setRoiPreviewItems] = useState<RoiPreviewCard[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [caseHistory, setCaseHistory] = useState<CaseHistoryResponse | null>(null);
  const [contributionBusy, setContributionBusy] = useState(false);
  const [contributionResult, setContributionResult] = useState<CaseContributionResponse | null>(null);
  const [completionState, setCompletionState] = useState<CompletionState | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [caseSearch, setCaseSearch] = useState("");
  const [favoriteCaseIds, setFavoriteCaseIds] = useState<string[]>([]);
  const [showOnlyMine, setShowOnlyMine] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const whiteFileInputRef = useRef<HTMLInputElement | null>(null);
  const fluoresceinFileInputRef = useRef<HTMLInputElement | null>(null);
  const draftImagesRef = useRef<DraftImage[]>([]);
  const validationArtifactUrlsRef = useRef<string[]>([]);
  const roiPreviewUrlsRef = useRef<string[]>([]);
  const deferredSearch = useDeferredValue(caseSearch);
  const copy = {
    unableLoadPatients: pick(locale, "Unable to load patients.", "환자 목록을 불러오지 못했습니다."),
    recoveredDraft: pick(locale, "Recovered the last saved draft properties for this hospital. Re-attach image files before saving.", "이 병원의 마지막 초안 속성을 복구했습니다. 저장 전 이미지 파일은 다시 첨부해 주세요."),
    unableLoadRecentCases: pick(locale, "Unable to load recent cases.", "최근 케이스를 불러오지 못했습니다."),
    unableLoadSiteActivity: pick(locale, "Unable to load hospital activity.", "병원 활동을 불러오지 못했습니다."),
    unableLoadSiteValidationHistory: pick(locale, "Unable to load hospital validation history.", "병원 검증 이력을 불러오지 못했습니다."),
    unableLoadCaseHistory: pick(locale, "Unable to load case history.", "케이스 이력을 불러오지 못했습니다."),
    selectSavedCaseForRoi: pick(locale, "Select a saved case before running ROI preview.", "ROI 미리보기를 실행하려면 저장된 케이스를 선택하세요."),
    roiPreviewGenerated: (patientId: string, visitDate: string) =>
      pick(locale, `ROI preview generated for ${patientId} / ${visitDate}.`, `${patientId} / ${visitDate} ROI 미리보기를 생성했습니다.`),
    roiPreviewFailed: pick(locale, "ROI preview failed.", "ROI 미리보기에 실패했습니다."),
    selectSiteForValidation: pick(locale, "Select a hospital before running hospital validation.", "병원 검증을 실행하려면 병원을 선택하세요."),
    siteValidationSaved: (validationId: string) =>
      pick(locale, `Hospital validation saved as ${validationId}.`, `병원 검증이 ${validationId}로 저장되었습니다.`),
    siteValidationFailed: pick(locale, "Hospital validation failed.", "병원 검증에 실패했습니다."),
    selectSavedCaseForValidation: pick(locale, "Select a saved case before running validation.", "검증을 실행하려면 저장된 케이스를 선택하세요."),
    validationSaved: (patientId: string, visitDate: string) =>
      pick(locale, `Validation saved for ${patientId} / ${visitDate}.`, `${patientId} / ${visitDate} 검증이 저장되었습니다.`),
    validationFailed: pick(locale, "Validation failed.", "검증에 실패했습니다."),
    selectSavedCaseForContribution: pick(locale, "Select a saved case before contributing.", "기여를 실행하려면 저장된 케이스를 선택하세요."),
    activeOnly: pick(locale, "Only active visits are enabled for contribution under the current policy.", "현재 정책에서는 active 방문만 기여할 수 있습니다."),
    contributionQueued: (patientId: string, visitDate: string) =>
      pick(locale, `Contribution queued for ${patientId} / ${visitDate}.`, `${patientId} / ${visitDate} 기여가 대기열에 등록되었습니다.`),
    contributionFailed: pick(locale, "Contribution failed.", "기여에 실패했습니다."),
    selectSiteForCase: pick(locale, "Select a hospital before creating a case.", "케이스를 생성하려면 병원을 선택하세요."),
    patientIdRequired: pick(locale, "Patient ID is required.", "환자 ID는 필수입니다."),
    visitDateRequired: pick(locale, "Visit reference is required.", "방문 기준값은 필수입니다."),
    cultureSpeciesRequired: pick(locale, "Culture species is required.", "균종은 필수입니다."),
    imageRequired: pick(locale, "Add at least one slit-lamp image to save this case.", "케이스를 저장하려면 세극등 이미지를 하나 이상 추가하세요."),
    patientCreationFailed: pick(locale, "Patient creation failed.", "환자 생성에 실패했습니다."),
    caseSaved: (patientId: string, visitDate: string, siteId: string) =>
      pick(locale, `Case ${patientId} / ${visitDate} saved to hospital ${siteId}.`, `${patientId} / ${visitDate} 케이스가 병원 ${siteId}에 저장되었습니다.`),
    caseSaveFailed: pick(locale, "Case save failed.", "케이스 저장에 실패했습니다."),
    organismAdded: pick(locale, "Organism added to this visit.", "이 방문에 균종을 추가했습니다."),
    organismDuplicate: pick(locale, "That organism is already attached to this visit.", "이미 이 방문에 추가된 균종입니다."),
    intakeComplete: pick(locale, "Core case intake is marked complete.", "기본 케이스 입력을 완료로 표시했습니다."),
    intakePatientRequired: pick(locale, "Enter the patient information first.", "먼저 환자 정보를 입력하세요."),
    intakeOrganismRequired: pick(locale, "Select the primary organism first.", "먼저 대표 균종을 선택하세요."),
    intakeStepRequired: pick(locale, "Complete patient, visit context, and organism input first.", "먼저 환자 정보, 방문 맥락, 균종 입력을 완료하세요."),
    draftAutosaved: (time: string) => pick(locale, `Draft autosaved ${time}`, `${time}에 초안 자동 저장`),
    draftUnsaved: pick(locale, "Draft changes live only in this tab", "초안 변경 내용은 현재 탭에만 유지됩니다"),
    patients: pick(locale, "patients", "환자"),
    savedCases: pick(locale, "saved cases", "저장된 케이스"),
    loadingPatients: pick(locale, "Loading patients...", "환자 목록을 불러오는 중..."),
    loadingSavedCases: pick(locale, "Loading saved cases...", "저장된 케이스를 불러오는 중..."),
    noPatients: pick(locale, "No patients have been registered in this hospital yet.", "이 병원에는 아직 등록된 환자가 없습니다."),
    noMyPatients: pick(locale, "You have not registered any patients in this hospital yet.", "이 병원에 내가 등록한 환자가 아직 없습니다."),
    noSavedCases: pick(locale, "No saved cases for this hospital yet.", "이 병원에는 아직 저장된 케이스가 없습니다."),
    allRecords: pick(locale, "All records", "전체"),
    myPatientsOnly: pick(locale, "My patients", "내 환자"),
    patientScopeAll: (count: number) =>
      pick(locale, `Showing all hospital patients (${count}).`, `병원 전체 환자 ${count}명을 표시합니다.`),
    patientScopeMine: (count: number) =>
      pick(locale, `Showing only patients registered by you (${count}).`, `내가 등록한 환자 ${count}명만 표시합니다.`),
    usePatientForDraft: pick(locale, "Use for draft", "초안에 사용"),
    mineBadge: pick(locale, "mine", "내 등록"),
    favoriteAdded: pick(locale, "Case added to favorites.", "케이스를 즐겨찾기에 추가했습니다."),
    favoriteRemoved: pick(locale, "Case removed from favorites.", "케이스 즐겨찾기를 해제했습니다."),
  };
  const whiteDraftImages = draftImages.filter((image) => image.view === "white");
  const fluoresceinDraftImages = draftImages.filter((image) => image.view === "fluorescein");

  useEffect(() => {
    draftImagesRef.current = draftImages;
  }, [draftImages]);

  useEffect(() => {
    return () => {
      for (const image of draftImagesRef.current) {
        URL.revokeObjectURL(image.preview_url);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      for (const url of validationArtifactUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      for (const url of roiPreviewUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  useEffect(() => {
    if (!selectedSiteId) {
      setDraft(createDraft());
      setPendingOrganism({
        culture_category: "bacterial",
        culture_species: CULTURE_SPECIES.bacterial[0],
      });
      setShowAdditionalOrganismForm(false);
      setDraftSavedAt(null);
      setFavoriteCaseIds([]);
      return;
    }

    const rawDraft = window.localStorage.getItem(draftStorageKey(user.user_id, selectedSiteId));
    const rawFavorites = window.localStorage.getItem(favoriteStorageKey(user.user_id, selectedSiteId));
    try {
      const parsedFavorites = rawFavorites ? (JSON.parse(rawFavorites) as string[]) : [];
      setFavoriteCaseIds(Array.isArray(parsedFavorites) ? parsedFavorites : []);
    } catch {
      window.localStorage.removeItem(favoriteStorageKey(user.user_id, selectedSiteId));
      setFavoriteCaseIds([]);
    }
    if (!rawDraft) {
      setDraft(createDraft());
      setPendingOrganism({
        culture_category: "bacterial",
        culture_species: CULTURE_SPECIES.bacterial[0],
      });
      setShowAdditionalOrganismForm(false);
      setDraftSavedAt(null);
      replaceDraftImages([]);
      return;
    }

    try {
      const parsed = JSON.parse(rawDraft) as PersistedDraft;
      setDraft(normalizeRecoveredDraft({
        ...createDraft(),
        ...parsed.draft,
      }));
      setPendingOrganism({
        culture_category: "bacterial",
        culture_species: CULTURE_SPECIES.bacterial[0],
      });
      setShowAdditionalOrganismForm(false);
      setDraftSavedAt(parsed.updated_at);
      replaceDraftImages([]);
      setToast({
        tone: "success",
        message: copy.recoveredDraft,
      });
    } catch {
      window.localStorage.removeItem(draftStorageKey(user.user_id, selectedSiteId));
      setDraft(createDraft());
      setPendingOrganism({
        culture_category: "bacterial",
        culture_species: CULTURE_SPECIES.bacterial[0],
      });
      setShowAdditionalOrganismForm(false);
      setDraftSavedAt(null);
      replaceDraftImages([]);
    }
  }, [selectedSiteId, user.user_id]);

  useEffect(() => {
    if (!selectedSiteId) {
      return;
    }
    window.localStorage.setItem(favoriteStorageKey(user.user_id, selectedSiteId), JSON.stringify(favoriteCaseIds));
  }, [favoriteCaseIds, selectedSiteId, user.user_id]);

  useEffect(() => {
    if (!selectedSiteId) {
      return;
    }

    const storageKey = draftStorageKey(user.user_id, selectedSiteId);
    if (!hasDraftContent(draft)) {
      window.localStorage.removeItem(storageKey);
      setDraftSavedAt(null);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const payload: PersistedDraft = {
        draft,
        updated_at: new Date().toISOString(),
      };
      window.localStorage.setItem(storageKey, JSON.stringify(payload));
      setDraftSavedAt(payload.updated_at);
    }, 450);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [draft, selectedSiteId, user.user_id]);

  useEffect(() => {
    if (!selectedSiteId) {
      setPatientRecords([]);
      setCases([]);
      setSiteActivity(null);
      setSiteValidationRuns([]);
      setSelectedCase(null);
      setSelectedCaseImages([]);
      return;
    }
    const currentSiteId = selectedSiteId;
    let cancelled = false;
    async function loadRecords() {
      setCasesLoading(true);
      setPatientsLoading(true);
      try {
        const [nextCases, nextPatients] = await Promise.all([
          fetchCases(currentSiteId, token, { mine: showOnlyMine }),
          fetchPatients(currentSiteId, token, { mine: showOnlyMine }),
        ]);
        if (cancelled) {
          return;
        }
        setCases(nextCases);
        setPatientRecords(nextPatients);
        setSelectedCase((current) => {
          if (!current) {
            return nextCases[0] ?? null;
          }
          return nextCases.find((item) => item.case_id === current.case_id) ?? nextCases[0] ?? null;
        });
      } catch (nextError) {
        if (!cancelled) {
          setPatientRecords([]);
          setToast({
            tone: "error",
            message: describeError(nextError, copy.unableLoadPatients),
          });
        }
      } finally {
        if (!cancelled) {
          setCasesLoading(false);
          setPatientsLoading(false);
        }
      }
    }
    async function loadActivity() {
      setActivityBusy(true);
      try {
        const nextActivity = await fetchSiteActivity(currentSiteId, token);
        if (!cancelled) {
          setSiteActivity(nextActivity);
        }
      } catch (nextError) {
        if (!cancelled) {
          setSiteActivity(null);
          setToast({
            tone: "error",
            message: describeError(nextError, copy.unableLoadSiteActivity),
          });
        }
      } finally {
        if (!cancelled) {
          setActivityBusy(false);
        }
      }
    }
    async function loadSiteValidations() {
      setSiteValidationBusy(true);
      try {
        const nextRuns = await fetchSiteValidations(currentSiteId, token);
        if (!cancelled) {
          setSiteValidationRuns(nextRuns);
        }
      } catch (nextError) {
        if (!cancelled) {
          setSiteValidationRuns([]);
          setToast({
            tone: "error",
            message: describeError(nextError, copy.unableLoadSiteValidationHistory),
          });
        }
      } finally {
        if (!cancelled) {
          setSiteValidationBusy(false);
        }
      }
    }
    void loadRecords();
    void loadActivity();
    void loadSiteValidations();
    return () => {
      cancelled = true;
    };
  }, [
    selectedSiteId,
    showOnlyMine,
    token,
    copy.recoveredDraft,
    copy.unableLoadPatients,
    copy.unableLoadSiteActivity,
    copy.unableLoadSiteValidationHistory,
  ]);

  useEffect(() => {
    for (const url of validationArtifactUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    validationArtifactUrlsRef.current = [];
    setValidationArtifacts({});
    clearRoiPreview();
    setValidationResult(null);
    setCaseHistory(null);
    setContributionResult(null);
    if (!selectedSiteId || !selectedCase) {
      setSelectedCaseImages([]);
      return;
    }
    const currentSiteId = selectedSiteId;
    const currentCase = selectedCase;
    let cancelled = false;
    const createdUrls: string[] = [];
    async function loadSelectedCaseImages() {
      setPanelBusy(true);
      try {
        const imageRecords = await fetchImages(currentSiteId, token, currentCase.patient_id, currentCase.visit_date);
        const nextImages = await Promise.all(
          imageRecords.map(async (record) => {
            try {
              const blob = await fetchImageBlob(currentSiteId, record.image_id, token);
              const previewUrl = URL.createObjectURL(blob);
              createdUrls.push(previewUrl);
              return { ...record, preview_url: previewUrl };
            } catch {
              return { ...record, preview_url: null };
            }
          })
        );
        if (!cancelled) {
          setSelectedCaseImages(nextImages);
        }
      } catch (nextError) {
        if (!cancelled) {
          setToast({
            tone: "error",
            message: describeError(nextError, pick(locale, "Unable to load case images.", "케이스 이미지를 불러오지 못했습니다.")),
          });
          setSelectedCaseImages([]);
        }
      } finally {
        if (!cancelled) {
          setPanelBusy(false);
        }
      }
    }
    async function loadSelectedCaseHistory() {
      setHistoryBusy(true);
      try {
        const nextHistory = await fetchCaseHistory(currentSiteId, currentCase.patient_id, currentCase.visit_date, token);
        if (!cancelled) {
          setCaseHistory(nextHistory);
        }
      } catch (nextError) {
        if (!cancelled) {
          setCaseHistory(null);
          setToast({
            tone: "error",
            message: describeError(nextError, copy.unableLoadCaseHistory),
          });
        }
      } finally {
        if (!cancelled) {
          setHistoryBusy(false);
        }
      }
    }
    void loadSelectedCaseImages();
    void loadSelectedCaseHistory();
    return () => {
      cancelled = true;
      for (const url of createdUrls) {
        URL.revokeObjectURL(url);
      }
    };
  }, [selectedCase, selectedSiteId, token]);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setToast(null);
    }, 3200);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [toast]);

  function replaceDraftImages(nextImages: DraftImage[]) {
    const nextIds = new Set(nextImages.map((image) => image.draft_id));
    for (const current of draftImagesRef.current) {
      if (!nextIds.has(current.draft_id)) {
        URL.revokeObjectURL(current.preview_url);
      }
    }
    setDraftImages(nextImages);
  }

  function clearValidationArtifacts() {
    for (const url of validationArtifactUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    validationArtifactUrlsRef.current = [];
    setValidationArtifacts({});
  }

  function clearRoiPreview() {
    for (const url of roiPreviewUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    roiPreviewUrlsRef.current = [];
    setRoiPreviewItems([]);
  }

  function clearDraftStorage(siteId: string | null = selectedSiteId) {
    if (!siteId) {
      setDraftSavedAt(null);
      return;
    }
    window.localStorage.removeItem(draftStorageKey(user.user_id, siteId));
    setDraftSavedAt(null);
  }

  function prefillDraftFromPatient(patient: PatientRecord) {
    setDraft((current) => ({
      ...current,
      patient_id: patient.patient_id,
      sex: patient.sex || current.sex,
      age: String(patient.age ?? current.age),
      chart_alias: patient.chart_alias ?? current.chart_alias,
      local_case_code: patient.local_case_code ?? current.local_case_code,
    }));
  }

  function resetDraft() {
    replaceDraftImages([]);
    clearDraftStorage();
    clearValidationArtifacts();
    clearRoiPreview();
    setValidationResult(null);
    setCaseHistory(null);
    setContributionResult(null);
    setSelectedCase(null);
    setSelectedCaseImages([]);
    setDraft(createDraft());
    setPendingOrganism({
      culture_category: "bacterial",
      culture_species: CULTURE_SPECIES.bacterial[0],
    });
    setShowAdditionalOrganismForm(false);
  }

  function isFavoriteCase(caseId: string): boolean {
    return favoriteCaseIds.includes(caseId);
  }

  function toggleFavoriteCase(caseId: string) {
    setFavoriteCaseIds((current) => {
      const exists = current.includes(caseId);
      const next = exists ? current.filter((item) => item !== caseId) : [...current, caseId];
      setToast({
        tone: "success",
        message: exists ? copy.favoriteRemoved : copy.favoriteAdded,
      });
      return next;
    });
  }

  function updatePrimaryOrganism(cultureCategory: string, cultureSpecies: string) {
    setDraft((current) => ({
      ...current,
      culture_category: cultureCategory,
      culture_species: cultureSpecies,
      additional_organisms: normalizeAdditionalOrganisms(
        cultureCategory,
        cultureSpecies,
        current.additional_organisms
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
    const currentOrganisms = listOrganisms(
      draft.culture_category,
      draft.culture_species,
      draft.additional_organisms
    );
    if (currentOrganisms.some((organism) => organismKey(organism) === organismKey(nextOrganism))) {
      setToast({
        tone: "error",
        message: copy.organismDuplicate,
      });
      return;
    }
    setDraft((current) => ({
      ...current,
      additional_organisms: [
        ...current.additional_organisms,
        nextOrganism,
      ],
    }));
    setToast({
      tone: "success",
      message: copy.organismAdded,
    });
  }

  function handleCompleteIntake() {
    if (!draft.patient_id.trim()) {
      setToast({ tone: "error", message: copy.intakePatientRequired });
      return;
    }
    if (!draft.culture_species.trim()) {
      setToast({ tone: "error", message: copy.intakeOrganismRequired });
      return;
    }
    setDraft((current) => ({ ...current, intake_completed: true }));
    setToast({ tone: "success", message: copy.intakeComplete });
  }

  function removeAdditionalOrganism(organismToRemove: OrganismRecord) {
    setDraft((current) => ({
      ...current,
      additional_organisms: current.additional_organisms.filter(
        (organism) => organismKey(organism) !== organismKey(organismToRemove)
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
    clearValidationArtifacts();
    clearRoiPreview();
    setValidationResult(null);
    setCaseHistory(null);
    setContributionResult(null);
    setSelectedCase(null);
    setSelectedCaseImages([]);
    setDraftImages((current) => {
      const next = [...current];
      const hasRepresentative = current.some((image) => image.is_representative);
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
    if (remaining.length > 0 && !remaining.some((image) => image.is_representative)) {
      remaining[0] = { ...remaining[0], is_representative: true };
    }
    replaceDraftImages(remaining);
  }

  function setRepresentativeImage(draftId: string) {
    setDraftImages((current) =>
      current.map((image) => ({
        ...image,
        is_representative: image.draft_id === draftId,
      }))
    );
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

  async function loadCaseHistory(siteId: string, patientId: string, visitDate: string) {
    setHistoryBusy(true);
    try {
      const nextHistory = await fetchCaseHistory(siteId, patientId, visitDate, token);
      setCaseHistory(nextHistory);
    } catch (nextError) {
      setCaseHistory(null);
      setToast({
        tone: "error",
        message: describeError(nextError, copy.unableLoadCaseHistory),
      });
    } finally {
      setHistoryBusy(false);
    }
  }

  async function loadSiteActivity(siteId: string) {
    setActivityBusy(true);
    try {
      const nextActivity = await fetchSiteActivity(siteId, token);
      setSiteActivity(nextActivity);
    } catch (nextError) {
      setSiteActivity(null);
      setToast({
        tone: "error",
        message: describeError(nextError, copy.unableLoadSiteActivity),
      });
    } finally {
      setActivityBusy(false);
    }
  }

  async function loadSiteValidationRuns(siteId: string) {
    setSiteValidationBusy(true);
    try {
      const nextRuns = await fetchSiteValidations(siteId, token);
      setSiteValidationRuns(nextRuns);
    } catch (nextError) {
      setSiteValidationRuns([]);
      setToast({
        tone: "error",
        message: describeError(nextError, copy.unableLoadSiteValidationHistory),
      });
    } finally {
      setSiteValidationBusy(false);
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

  async function handleRunSiteValidation() {
    if (!selectedSiteId) {
      setToast({ tone: "error", message: copy.selectSiteForValidation });
      return;
    }

    setSiteValidationBusy(true);
    try {
      const result = await runSiteValidation(selectedSiteId, token);
      await onSiteDataChanged(selectedSiteId);
      await loadSiteActivity(selectedSiteId);
      await loadSiteValidationRuns(selectedSiteId);
      setToast({
        tone: "success",
        message: copy.siteValidationSaved(result.summary.validation_id),
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, copy.siteValidationFailed),
      });
    } finally {
      setSiteValidationBusy(false);
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
    setContributionResult(null);
    setPanelOpen(true);
    try {
      const result = await runCaseValidation(selectedSiteId, token, {
        patient_id: selectedCase.patient_id,
        visit_date: selectedCase.visit_date,
      });
      const nextArtifacts: ValidationArtifactPreviews = {};
      const artifactKinds: ValidationArtifactKind[] = ["roi_crop", "gradcam", "medsam_mask"];

      for (const artifactKind of artifactKinds) {
        const isAvailable =
          artifactKind === "roi_crop"
            ? result.artifact_availability.roi_crop
            : artifactKind === "gradcam"
              ? result.artifact_availability.gradcam
              : result.artifact_availability.medsam_mask;
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
      await onSiteDataChanged(selectedSiteId);
      await loadCaseHistory(selectedSiteId, selectedCase.patient_id, selectedCase.visit_date);
      await loadSiteActivity(selectedSiteId);
      setToast({
        tone: "success",
        message: copy.validationSaved(selectedCase.patient_id, selectedCase.visit_date),
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, copy.validationFailed),
      });
    } finally {
      setValidationBusy(false);
    }
  }

  async function handleContributeCase() {
    if (!selectedSiteId || !selectedCase) {
      setToast({ tone: "error", message: copy.selectSavedCaseForContribution });
      return;
    }
    if (selectedCase.visit_status !== "active") {
      setToast({
        tone: "error",
        message: copy.activeOnly,
      });
      return;
    }

    setContributionBusy(true);
    setPanelOpen(true);
    try {
      const result = await runCaseContribution(selectedSiteId, token, {
        patient_id: selectedCase.patient_id,
        visit_date: selectedCase.visit_date,
        execution_mode: executionModeFromDevice(validationResult?.execution_device),
        model_version_id: validationResult?.model_version.version_id,
      });
      setContributionResult(result);
      await onSiteDataChanged(selectedSiteId);
      await loadCaseHistory(selectedSiteId, selectedCase.patient_id, selectedCase.visit_date);
      await loadSiteActivity(selectedSiteId);
      setCompletionState({
        kind: "contributed",
        patient_id: selectedCase.patient_id,
        visit_date: selectedCase.visit_date,
        timestamp: new Date().toISOString(),
        stats: {
          user_contributions: result.stats.user_contributions,
          total_contributions: result.stats.total_contributions,
          user_contribution_pct: result.stats.user_contribution_pct,
        },
        update_id: result.update.update_id,
      });
      setToast({
        tone: "success",
        message: copy.contributionQueued(selectedCase.patient_id, selectedCase.visit_date),
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, copy.contributionFailed),
      });
    } finally {
      setContributionBusy(false);
    }
  }

  async function handleSaveCase() {
    const nextVisitReference = buildVisitReference(draft);
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
    if (!draft.culture_species.trim()) {
      setToast({ tone: "error", message: copy.cultureSpeciesRequired });
      return;
    }
    if (draftImages.length === 0) {
      setToast({ tone: "error", message: copy.imageRequired });
      return;
    }

    setSaveBusy(true);
    try {
      try {
        await createPatient(selectedSiteId, token, {
          patient_id: draft.patient_id.trim(),
          sex: draft.sex,
          age: Number(draft.age || 0),
          chart_alias: "",
          local_case_code: draft.local_case_code.trim(),
        });
      } catch (nextError) {
        const message = describeError(nextError, copy.patientCreationFailed);
        if (!message.toLowerCase().includes("already exists")) {
          throw nextError;
        }
      }

      await createVisit(selectedSiteId, token, {
        patient_id: draft.patient_id.trim(),
        visit_date: nextVisitReference,
        actual_visit_date: draft.actual_visit_date.trim() || null,
        culture_category: draft.culture_category,
        culture_species: draft.culture_species.trim(),
        additional_organisms: normalizeAdditionalOrganisms(
          draft.culture_category,
          draft.culture_species,
          draft.additional_organisms
        ),
        contact_lens_use: draft.contact_lens_use,
        predisposing_factor: draft.predisposing_factor,
        other_history: draft.other_history.trim(),
        visit_status: draft.visit_status,
        is_initial_visit: draft.is_initial_visit,
        polymicrobial: draft.additional_organisms.length > 0,
      });

      for (const image of draftImages) {
        await uploadImage(selectedSiteId, token, {
          patient_id: draft.patient_id.trim(),
          visit_date: nextVisitReference,
          view: image.view,
          is_representative: image.is_representative,
          file: image.file,
        });
      }

      await onSiteDataChanged(selectedSiteId);
      const [nextCases, nextPatients] = await Promise.all([
        fetchCases(selectedSiteId, token, { mine: showOnlyMine }),
        fetchPatients(selectedSiteId, token, { mine: showOnlyMine }),
      ]);
      setCases(nextCases);
      setPatientRecords(nextPatients);
      const createdCase = nextCases.find(
        (item) => item.patient_id === draft.patient_id.trim() && item.visit_date === nextVisitReference
      );
      await loadSiteActivity(selectedSiteId);
      setToast({
        tone: "success",
        message: copy.caseSaved(draft.patient_id.trim(), nextVisitReference, selectedSiteId),
      });
      clearDraftStorage(selectedSiteId);
      resetDraft();
      setSelectedCase(createdCase ?? null);
      setPanelOpen(true);
      setCompletionState({
        kind: "saved",
        patient_id: draft.patient_id.trim(),
        visit_date: nextVisitReference,
        timestamp: new Date().toISOString(),
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, copy.caseSaveFailed),
      });
    } finally {
      setSaveBusy(false);
    }
  }

  const searchNeedle = deferredSearch.trim().toLowerCase();
  const filteredCases = cases
    .filter((item) => {
    if (!searchNeedle) {
      return true;
    }
    const haystack = [
      item.patient_id,
      item.chart_alias,
      item.culture_category,
      item.culture_species,
      ...(item.additional_organisms ?? []).map((organism) => organism.culture_species),
      item.visit_date,
      item.actual_visit_date ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(searchNeedle);
    })
    .sort((left, right) => {
      const leftFavorite = isFavoriteCase(left.case_id) ? 1 : 0;
      const rightFavorite = isFavoriteCase(right.case_id) ? 1 : 0;
      if (leftFavorite !== rightFavorite) {
        return rightFavorite - leftFavorite;
      }
      return 0;
    });
  const speciesOptions = CULTURE_SPECIES[draft.culture_category] ?? [];
  const pendingSpeciesOptions = CULTURE_SPECIES[pendingOrganism.culture_category] ?? [];
  const momentumPercent = cases.length === 0 ? 18 : Math.min(100, 18 + cases.length * 12);
  const patientScopeCopy = showOnlyMine ? copy.patientScopeMine(patientRecords.length) : copy.patientScopeAll(patientRecords.length);
  const canRunValidation = ["admin", "site_admin", "researcher"].includes(user.role);
  const canRunRoiPreview = canRunValidation;
  const canContributeSelectedCase =
    canRunValidation && Boolean(selectedCase) && selectedCase?.visit_status === "active";
  const latestSiteValidation = siteValidationRuns[0] ?? null;
  const validationConfidence = confidencePercent(validationResult?.summary.prediction_probability);
  const validationConfidenceTone = confidenceTone(validationConfidence);
  const selectedCompletion =
    selectedCase &&
    completionState &&
    completionState.patient_id === selectedCase.patient_id &&
    completionState.visit_date === selectedCase.visit_date
      ? completionState
      : null;
  const draftStatusLabel = draftSavedAt
    ? copy.draftAutosaved(new Date(draftSavedAt).toLocaleTimeString(localeTag, { hour: "2-digit", minute: "2-digit" }))
    : copy.draftUnsaved;
  const intakeOrganisms = listOrganisms(draft.culture_category, draft.culture_species, draft.additional_organisms);
  const resolvedVisitReference = buildVisitReference(draft);
  const resolvedVisitReferenceLabel = displayVisitReference(locale, resolvedVisitReference);
  const actualVisitDateLabel = draft.actual_visit_date.trim() || common.notAvailable;

  return (
    <main className="workspace-shell" data-workspace-theme={theme}>
      <div className="workspace-noise" />
      <aside className="workspace-rail">
        <div className="workspace-brand">
          <div>
            <div className="workspace-kicker">{pick(locale, "Case Studio", "케이스 스튜디오")}</div>
            <h1>{pick(locale, "K-ERA Canvas", "K-ERA 캔버스")}</h1>
          </div>
          <button className="ghost-button" type="button" onClick={resetDraft}>
            {pick(locale, "New draft", "새 초안")}
          </button>
        </div>

        <section className="workspace-card rail-section">
          <div className="rail-section-head">
            <span className="rail-label">{pick(locale, "Hospital", "병원")}</span>
            <strong>{sites.length} {pick(locale, "linked", "연결됨")}</strong>
          </div>
          <div className="rail-site-list">
            {sites.map((site) => (
              <button
                key={site.site_id}
                className={`rail-site-button ${selectedSiteId === site.site_id ? "active" : ""}`}
                type="button"
                onClick={() => onSelectSite(site.site_id)}
              >
                <strong>{site.display_name}</strong>
                <span>{site.hospital_name || site.site_id}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="workspace-card rail-section">
          <div className="rail-section-head">
            <span className="rail-label">{pick(locale, "Momentum", "진행도")}</span>
            <strong>{cases.length} {copy.savedCases}</strong>
          </div>
          <div className="momentum-track">
            <div className="momentum-fill" style={{ width: `${momentumPercent}%` }} />
          </div>
          <p className="rail-copy">
            {pick(
              locale,
              "Each saved case expands the local dataset surface and keeps the migration grounded in real workflow.",
              "저장된 케이스가 늘어날수록 로컬 데이터셋이 확장되고 실제 워크플로우 기준의 이전이 유지됩니다."
            )}
          </p>
        </section>

        <section className="workspace-card rail-section">
          <div className="rail-section-head">
            <span className="rail-label">{pick(locale, "Activity", "활동")}</span>
            <strong>{activityBusy ? pick(locale, "syncing", "동기화 중") : `${siteActivity?.pending_updates ?? 0} ${pick(locale, "pending", "대기")}`}</strong>
          </div>
          <div className="panel-metric-grid rail-metric-grid">
            <div>
              <strong>{siteActivity?.pending_updates ?? 0}</strong>
              <span>{pick(locale, "pending deltas", "대기 중 델타")}</span>
            </div>
            <div>
              <strong>{siteActivity?.recent_validations.length ?? 0}</strong>
              <span>{pick(locale, "recent validations", "최근 검증")}</span>
            </div>
          </div>
          <div className="rail-activity-list">
            {siteActivity?.recent_validations.slice(0, 2).map((item) => (
              <div key={item.validation_id} className="rail-activity-item">
                <strong>{item.model_version}</strong>
                <span>{formatDateTime(item.run_date, localeTag, common.notAvailable)}</span>
                <span>{typeof item.accuracy === "number" ? `${pick(locale, "acc", "정확도")} ${formatProbability(item.accuracy, common.notAvailable)}` : `${item.n_cases ?? 0} ${pick(locale, "cases", "케이스")}`}</span>
              </div>
            ))}
            {siteActivity?.recent_contributions.slice(0, 2).map((item) => (
              <div key={item.contribution_id} className="rail-activity-item">
                <strong>{item.patient_id}</strong>
                <span>{formatDateTime(item.created_at, localeTag, common.notAvailable)}</span>
                <span>{item.update_status ?? pick(locale, "queued", "대기열 등록")}</span>
              </div>
            ))}
            {!activityBusy && !siteActivity?.recent_validations.length && !siteActivity?.recent_contributions.length ? (
              <div className="empty-surface">{pick(locale, "No hospital activity recorded yet.", "아직 기록된 병원 활동이 없습니다.")}</div>
            ) : null}
          </div>
        </section>

        <section className="workspace-card rail-section">
          <div className="rail-section-head">
            <span className="rail-label">{pick(locale, "Hospital validation", "병원 검증")}</span>
            <button
              className="ghost-button"
              type="button"
              onClick={() => void handleRunSiteValidation()}
              disabled={siteValidationBusy || !selectedSiteId || !canRunValidation}
            >
              {siteValidationBusy ? pick(locale, "Running...", "실행 중...") : pick(locale, "Run hospital validation", "병원 검증 실행")}
            </button>
          </div>
          {latestSiteValidation ? (
            <div className="panel-metric-grid rail-metric-grid">
              <div>
                <strong>{typeof latestSiteValidation.AUROC === "number" ? latestSiteValidation.AUROC.toFixed(3) : common.notAvailable}</strong>
                <span>AUROC</span>
              </div>
              <div>
                <strong>{typeof latestSiteValidation.accuracy === "number" ? latestSiteValidation.accuracy.toFixed(3) : common.notAvailable}</strong>
                <span>{pick(locale, "accuracy", "정확도")}</span>
              </div>
              <div>
                <strong>{latestSiteValidation.n_cases ?? 0}</strong>
                <span>{pick(locale, "cases", "케이스")}</span>
              </div>
              <div>
                <strong>{latestSiteValidation.model_version}</strong>
                <span>{pick(locale, "latest model", "최신 모델")}</span>
              </div>
            </div>
          ) : (
            <div className="empty-surface">{pick(locale, "No hospital-level validation has been run yet.", "아직 병원 단위 검증이 실행되지 않았습니다.")}</div>
          )}
          <div className="rail-activity-list">
            {siteValidationRuns.slice(0, 3).map((item) => (
              <div key={item.validation_id} className="rail-activity-item">
                <strong>{item.model_version}</strong>
                <span>{formatDateTime(item.run_date, localeTag, common.notAvailable)}</span>
                <span>{typeof item.accuracy === "number" ? `${pick(locale, "acc", "정확도")} ${item.accuracy.toFixed(3)}` : `${item.n_cases ?? 0} ${pick(locale, "cases", "케이스")}`}</span>
              </div>
            ))}
          </div>
          {!canRunValidation ? <p className="rail-copy">{pick(locale, "Viewer accounts can review metrics but cannot run hospital validation.", "뷰어 계정은 지표만 확인할 수 있고 병원 검증은 실행할 수 없습니다.")}</p> : null}
        </section>

        <section className="workspace-card rail-section">
          <div className="rail-section-head">
            <span className="rail-label">{copy.patients}</span>
            <strong>{patientRecords.length}</strong>
          </div>
          <div className="segmented-toggle" role="group" aria-label={copy.patients}>
            <button
              className={`toggle-pill ${!showOnlyMine ? "active" : ""}`}
              type="button"
              onClick={() => setShowOnlyMine(false)}
            >
              {copy.allRecords}
            </button>
            <button
              className={`toggle-pill ${showOnlyMine ? "active" : ""}`}
              type="button"
              onClick={() => setShowOnlyMine(true)}
            >
              {copy.myPatientsOnly}
            </button>
          </div>
          <p className="rail-copy">{patientScopeCopy}</p>
          <div className="rail-case-list">
            {patientsLoading ? <div className="empty-surface">{copy.loadingPatients}</div> : null}
            {!patientsLoading && patientRecords.length === 0 ? (
              <div className="empty-surface">{showOnlyMine ? copy.noMyPatients : copy.noPatients}</div>
            ) : null}
            {patientRecords.map((patient) => (
              <button
                key={patient.patient_id}
                className={`case-list-item ${draft.patient_id.trim() === patient.patient_id ? "active" : ""}`}
                type="button"
                onClick={() => prefillDraftFromPatient(patient)}
              >
                <div className="case-list-head">
                  <strong>{patient.local_case_code || patient.patient_id}</strong>
                  <span>{copy.usePatientForDraft}</span>
                </div>
                <div className="case-list-meta">
                  <span>{patient.patient_id}</span>
                  <span>{translateOption(locale, "sex", patient.sex)}</span>
                  <span>{patient.age}</span>
                  {patient.created_by_user_id === user.user_id ? <span>{copy.mineBadge}</span> : null}
                </div>
                <div className="case-list-tagline">{formatDateTime(patient.created_at, localeTag, common.notAvailable)}</div>
              </button>
            ))}
          </div>
        </section>

        <section className="workspace-card rail-section rail-case-section">
          <div className="rail-section-head">
            <span className="rail-label">{pick(locale, "Recent cases", "최근 케이스")}</span>
            <strong>{filteredCases.length}</strong>
          </div>
          <input
            className="rail-search"
            value={caseSearch}
            onChange={(event) => setCaseSearch(event.target.value)}
            placeholder={pick(locale, "Search patient or species", "환자 또는 균종 검색")}
          />
          <div className="rail-case-list">
            {casesLoading ? <div className="empty-surface">{copy.loadingSavedCases}</div> : null}
            {!casesLoading && filteredCases.length === 0 ? (
              <div className="empty-surface">{copy.noSavedCases}</div>
            ) : null}
            {filteredCases.map((item) => (
              <button
                key={item.case_id}
                className={`case-list-item ${selectedCase?.case_id === item.case_id ? "active" : ""}`}
                type="button"
                onClick={() => {
                  setSelectedCase(item);
                  setPanelOpen(true);
                }}
              >
                <div className="case-list-head">
                  <strong className="case-list-title">
                    {isFavoriteCase(item.case_id) ? <span className="favorite-indicator" aria-hidden="true">★</span> : null}
                    <span>{formatCaseTitle(item)}</span>
                  </strong>
                  <span>{item.image_count} {pick(locale, "imgs", "이미지")}</span>
                </div>
                <div className="case-list-meta">
                  <span>{item.patient_id}</span>
                  <span>{displayVisitReference(locale, item.visit_date)}</span>
                  {item.actual_visit_date ? <span>{item.actual_visit_date}</span> : null}
                  <span>{visitPhaseCopy(locale, item.is_initial_visit)}</span>
                </div>
                <div className="case-list-tagline">
                  {translateOption(locale, "cultureCategory", item.culture_category)} / {organismSummaryLabel(
                    item.culture_category,
                    item.culture_species,
                    item.additional_organisms
                  )}
                </div>
              </button>
            ))}
          </div>
        </section>
      </aside>

      <section className="workspace-main">
        <header className="workspace-header">
          <div>
            <div className="workspace-kicker">{pick(locale, "Research document", "연구 문서")}</div>
            <h2>{pick(locale, "Compose one case as a living page", "한 케이스를 살아있는 페이지처럼 작성")}</h2>
            <p>
              {pick(
                locale,
                `Logged in as ${user.full_name} (${translateRole(locale, user.role)}). Case authoring, review, and contribution now stay in one continuous web workspace.`,
                `${user.full_name} (${translateRole(locale, user.role)}) 계정으로 로그인됨. 케이스 작성, 검토, 기여 흐름이 이제 하나의 연속된 웹 워크스페이스 안에서 이어집니다.`
              )}
            </p>
          </div>
          <div className="workspace-actions">
            <LocaleToggle />
            <button className="ghost-button" type="button" onClick={onToggleTheme}>
              {theme === "dark" ? pick(locale, "Light mode", "라이트 모드") : pick(locale, "Dark mode", "다크 모드")}
            </button>
            {canOpenOperations ? (
              <button className="ghost-button" type="button" onClick={onOpenOperations}>
                {pick(locale, "Operations", "운영 화면")}
              </button>
            ) : null}
            <button className="ghost-button" type="button" onClick={onExportManifest} disabled={!selectedSiteId}>
              {pick(locale, "Export manifest", "매니페스트 내보내기")}
            </button>
            <button className="primary-workspace-button" type="button" onClick={onLogout}>
              {pick(locale, "Log out", "로그아웃")}
            </button>
          </div>
        </header>

        <div className="workspace-center">
          <section className="doc-surface">
            <div className="doc-title-row">
              <div>
                <div className="doc-eyebrow">{pick(locale, "New case", "새 케이스")}</div>
                <h3>{draft.patient_id.trim() || pick(locale, "Untitled keratitis case", "제목 없는 각막염 케이스")}</h3>
              </div>
              <div className="doc-site-badge">{selectedSiteId ?? pick(locale, "Select a hospital", "병원 선택")}</div>
            </div>
            <div className="doc-badge-row">
              <span className="doc-site-badge">{draftStatusLabel}</span>
              {draftImages.length > 0 ? <span className="doc-site-badge">{pick(locale, "Unsaved image files stay in this tab only", "저장되지 않은 이미지 파일은 현재 탭에만 유지됩니다")}</span> : null}
            </div>

            {!draft.intake_completed ? (
              <>
            <section className="doc-section">
              <div className="doc-section-head">
                <div>
                  <div className="doc-section-label">{pick(locale, "Patient identity", "환자 정보")}</div>
                  <h4>{pick(locale, "Start with patient details", "환자 정보부터 입력")}</h4>
                </div>
                <span>{draftImages.length} {pick(locale, "image blocks", "이미지 블록")}</span>
              </div>
              <div className="inline-form-grid">
                <label className="inline-field">
                  <span>{pick(locale, "Patient ID", "환자 ID")}</span>
                  <input
                    value={draft.patient_id}
                    onChange={(event) => setDraft((current) => ({ ...current, patient_id: event.target.value }))}
                    placeholder="KERA-2026-001"
                  />
                </label>
                <label className="inline-field">
                  <span>{pick(locale, "Sex", "성별")}</span>
                  <select
                    value={draft.sex}
                    onChange={(event) => setDraft((current) => ({ ...current, sex: event.target.value }))}
                  >
                    {SEX_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {translateOption(locale, "sex", option)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="inline-field">
                  <span>{pick(locale, "Age", "나이")}</span>
                  <input
                    type="number"
                    min={0}
                    value={draft.age}
                    onChange={(event) => setDraft((current) => ({ ...current, age: event.target.value }))}
                  />
                </label>
              </div>
            </section>

            <section className="doc-section">
              <div className="doc-section-head">
                <div>
                  <div className="doc-section-label">{pick(locale, "Visit context", "방문 맥락")}</div>
                  <h4>{pick(locale, "Clinical tags instead of rigid steps", "고정 단계 대신 임상 태그로 정리")}</h4>
                </div>
              </div>
              <div className="visit-context-inline">
                <label className="visit-context-select">
                  <span>{pick(locale, "Contact lens", "콘택트렌즈")}</span>
                  <select
                    value={draft.contact_lens_use}
                    onChange={(event) => setDraft((current) => ({ ...current, contact_lens_use: event.target.value }))}
                  >
                    {CONTACT_LENS_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {translateOption(locale, "contactLens", option)}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="tag-cloud visit-context-tags">
                  {PREDISPOSING_FACTOR_OPTIONS.map((factor) => (
                    <button
                      key={factor}
                      className={`tag-pill ${draft.predisposing_factor.includes(factor) ? "active" : ""}`}
                      type="button"
                      onClick={() => togglePredisposingFactor(factor)}
                    >
                      {translateOption(locale, "predisposing", factor)}
                    </button>
                  ))}
                </div>
              </div>
              <label className="notes-field">
                <span>{pick(locale, "Case note", "케이스 메모")}</span>
                <textarea
                  rows={5}
                  value={draft.other_history}
                  onChange={(event) => setDraft((current) => ({ ...current, other_history: event.target.value }))}
                  placeholder={pick(locale, "Freeform note space for ocular surface context, referral history, or procedural remarks.", "안구 표면 상태, 전원 이력, 시술 관련 메모 등을 자유롭게 적을 수 있습니다.")}
                />
              </label>
            </section>

            <section className="doc-section">
              <div className="doc-section-head">
                <div>
                  <div className="doc-section-label">{pick(locale, "Organism", "균종")}</div>
                  <h4>{pick(locale, "Set the primary organism before timing metadata", "방문 시점 정보보다 먼저 균종 입력")}</h4>
                </div>
                <span>
                  {draft.additional_organisms.length > 0
                    ? pick(locale, "Polymicrobial", "다균종")
                    : pick(locale, "Single organism", "단일 균종")}
                </span>
              </div>
              <div className="property-grid organism-entry-grid">
                <label className="property-chip">
                <span>{pick(locale, "Category", "분류")}</span>
                <select
                  value={draft.culture_category}
                  onChange={(event) => {
                    const nextCategory = event.target.value;
                    updatePrimaryOrganism(
                      nextCategory,
                      (CULTURE_SPECIES[nextCategory] ?? [draft.culture_species])[0]
                    );
                  }}
                >
                  {Object.keys(CULTURE_SPECIES).map((option) => (
                    <option key={option} value={option}>
                      {translateOption(locale, "cultureCategory", option)}
                    </option>
                  ))}
                </select>
              </label>
                <label className="property-chip">
                <span>{pick(locale, "Species", "세부 균종")}</span>
                <select
                  value={draft.culture_species}
                  onChange={(event) => updatePrimaryOrganism(draft.culture_category, event.target.value)}
                >
                  {speciesOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <div className="property-hint">
                  {pick(locale, "This is the primary organism label for the case.", "이 값이 케이스의 주 균종 라벨로 저장됩니다.")}
                </div>
              </label>
                <div className="property-chip property-chip-wide">
                <span>{pick(locale, "Additional organisms", "추가 균종")}</span>
                <button
                  className={`ghost-button ${showAdditionalOrganismForm ? "active" : ""}`}
                  type="button"
                  onClick={() => setShowAdditionalOrganismForm((current) => !current)}
                >
                  {showAdditionalOrganismForm
                    ? pick(locale, "Hide additional organism (polymicrobial) input", "추가 균종(다균종) 입력 닫기")
                    : pick(locale, "Add additional organism (polymicrobial)", "추가 균종 (다균종) 입력")}
                </button>
                {showAdditionalOrganismForm ? (
                  <div className="organism-add-grid">
                    <select
                      value={pendingOrganism.culture_category}
                      onChange={(event) => {
                        const nextCategory = event.target.value;
                        setPendingOrganism({
                          culture_category: nextCategory,
                          culture_species: (CULTURE_SPECIES[nextCategory] ?? [pendingOrganism.culture_species])[0],
                        });
                      }}
                    >
                      {Object.keys(CULTURE_SPECIES).map((option) => (
                        <option key={`pending-${option}`} value={option}>
                          {translateOption(locale, "cultureCategory", option)}
                        </option>
                      ))}
                    </select>
                    <select
                      value={pendingOrganism.culture_species}
                      onChange={(event) =>
                        setPendingOrganism((current) => ({
                          ...current,
                          culture_species: event.target.value,
                        }))
                      }
                    >
                      {pendingSpeciesOptions.map((option) => (
                        <option key={`pending-species-${option}`} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                    <button className="ghost-button organism-add-button" type="button" onClick={addAdditionalOrganism}>
                      {pick(locale, "Add organism", "균종 추가")}
                    </button>
                  </div>
                ) : null}
                <div className="property-hint">
                  {pick(locale, "Only open this when a polymicrobial case needs extra organism labels.", "다균종 케이스에서만 추가 균종 입력을 열어 사용하세요.")}
                </div>
                </div>
              </div>
            </section>
            <section className="doc-section">
              <div className="doc-section-head">
                <div>
                  <div className="doc-section-label">{pick(locale, "Organism summary", "균종 요약")}</div>
                  <h4>{pick(locale, "Review the primary label and any polymicrobial additions", "대표 균종과 추가 균종 확인")}</h4>
                </div>
                <span>
                  {draft.additional_organisms.length > 0
                    ? pick(locale, "Polymicrobial", "다균종")
                    : pick(locale, "Single organism", "단일 균종")}
                </span>
              </div>
              <div className="organism-chip-row">
                {intakeOrganisms.map((organism, index) => (
                  <div key={`draft-organism-${organismKey(organism)}`} className="organism-chip">
                    <div className="organism-chip-copy">
                      <strong>{organism.culture_species}</strong>
                      <span>
                        {index === 0
                          ? pick(locale, "Primary", "대표 균종")
                          : translateOption(locale, "cultureCategory", organism.culture_category)}
                      </span>
                    </div>
                    {index > 0 ? (
                      <button
                        className="organism-chip-remove"
                        type="button"
                        onClick={() => removeAdditionalOrganism(organism)}
                        aria-label={pick(locale, "Remove organism", "균종 제거")}
                      >
                        {pick(locale, "Remove", "제거")}
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
              <div className="property-hint">
                {draft.additional_organisms.length > 0
                  ? pick(locale, "This visit will be saved as polymicrobial automatically.", "이 방문은 저장 시 자동으로 다균종으로 처리됩니다.")
                  : pick(locale, "Keep this as a single organism unless an additional isolate is confirmed.", "추가 분리 균주가 확인되기 전까지는 단일 균종으로 유지하세요.")}
              </div>
            </section>
            <div className="doc-footer">
              <div>
                <strong>{pick(locale, "Core intake checkpoint", "기본 입력 체크포인트")}</strong>
                <p>{pick(locale, "Lock patient, context, and organism into a summary card before entering visit timing.", "방문 시점 정보를 넣기 전에 환자 정보, 방문 맥락, 균종을 카드로 고정합니다.")}</p>
              </div>
              <button className="primary-workspace-button" type="button" onClick={handleCompleteIntake}>
                {pick(locale, "Mark intake complete", "완료 표시")}
              </button>
            </div>
              </>
            ) : (
              <>
            <section className="doc-section intake-summary-card">
              <div className="doc-section-head">
                <div>
                  <div className="doc-section-label">{pick(locale, "Core intake", "기본 입력")}</div>
                  <h4>{pick(locale, "Patient, context, and organism are now a summary card", "환자 정보, 방문 맥락, 균종이 요약 카드로 전환됨")}</h4>
                </div>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => setDraft((current) => ({ ...current, intake_completed: false }))}
                >
                  {pick(locale, "Edit", "수정")}
                </button>
              </div>
              <div className="intake-summary-grid">
                <div className="intake-summary-block">
                  <span>{pick(locale, "Patient", "환자")}</span>
                  <strong>{draft.patient_id.trim() || common.notAvailable}</strong>
                  <p>{`${translateOption(locale, "sex", draft.sex)} · ${draft.age || common.notAvailable}`}</p>
                </div>
                <div className="intake-summary-block">
                  <span>{pick(locale, "Visit context", "방문 맥락")}</span>
                  <strong>{translateOption(locale, "contactLens", draft.contact_lens_use)}</strong>
                  <p>
                    {draft.predisposing_factor.length > 0
                      ? draft.predisposing_factor.map((factor) => translateOption(locale, "predisposing", factor)).join(" · ")
                      : pick(locale, "No predisposing factor selected", "선택된 선행 인자 없음")}
                  </p>
                </div>
                <div className="intake-summary-block intake-summary-block-wide">
                  <span>{pick(locale, "Organism", "균종")}</span>
                  <strong>{`${translateOption(locale, "cultureCategory", draft.culture_category)} · ${draft.culture_species}`}</strong>
                  <div className="organism-chip-row">
                    {intakeOrganisms.map((organism, index) => (
                      <span key={`summary-organism-${organismKey(organism)}`} className="organism-chip static">
                        {index === 0 ? organism.culture_species : `${translateOption(locale, "cultureCategory", organism.culture_category)} · ${organism.culture_species}`}
                      </span>
                    ))}
                  </div>
                  {draft.other_history.trim() ? <p>{draft.other_history.trim()}</p> : null}
                </div>
              </div>
            </section>

            <section className="doc-section">
              <div className="doc-section-head">
                <div>
                  <div className="doc-section-label">{pick(locale, "Visit timing", "방문 시점")}</div>
                  <h4>{pick(locale, "Choose initial or follow-up, then add the date if needed", "초진/재진 선택 후 필요하면 날짜 입력")}</h4>
                </div>
                <span>{resolvedVisitReferenceLabel}</span>
              </div>
              <div className="property-grid visit-timing-grid">
                <div className="property-chip">
                  <span>{pick(locale, "Visit phase", "초진/재진")}</span>
                  <div className="segmented-toggle" role="group" aria-label={pick(locale, "Visit phase", "초진/재진")}>
                    <button
                      className={`toggle-pill phase-pill phase-initial ${draft.is_initial_visit ? "active" : ""}`}
                      type="button"
                      onClick={() => setDraft((current) => ({ ...current, is_initial_visit: true }))}
                    >
                      {pick(locale, "Initial", "초진")}
                    </button>
                    <button
                      className={`toggle-pill phase-pill phase-followup ${!draft.is_initial_visit ? "active" : ""}`}
                      type="button"
                      onClick={() => setDraft((current) => ({ ...current, is_initial_visit: false }))}
                    >
                      {pick(locale, "Follow-up", "재진")}
                    </button>
                  </div>
                </div>
                {!draft.is_initial_visit ? (
                  <label className="property-chip">
                    <span>{pick(locale, "FU number", "FU 번호")}</span>
                    <select
                      value={draft.follow_up_number}
                      onChange={(event) => setDraft((current) => ({ ...current, follow_up_number: event.target.value }))}
                    >
                      {Array.from({ length: 15 }, (_, index) => String(index + 1)).map((option) => (
                        <option key={option} value={option}>
                          {`FU #${option}`}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label className="property-chip">
                  <span>{pick(locale, "Date (optional)", "날짜 (선택)")}</span>
                  <input
                    type="date"
                    value={draft.actual_visit_date}
                    onChange={(event) => setDraft((current) => ({ ...current, actual_visit_date: event.target.value }))}
                  />
                  <div className="property-hint">
                    {pick(locale, "This uses the same date format as before and is stored separately from the visit reference.", "이전과 같은 날짜 형식을 사용하며 방문 기준값과 별도로 저장됩니다.")}
                  </div>
                </label>
                <label className="property-chip">
                  <span>{pick(locale, "Status", "상태")}</span>
                  <select
                    value={draft.visit_status}
                    onChange={(event) => setDraft((current) => ({ ...current, visit_status: event.target.value }))}
                  >
                    {VISIT_STATUS_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {translateOption(locale, "visitStatus", option)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="doc-badge-row">
                <span className="doc-site-badge">{pick(locale, "Visit reference", "방문 기준값")} · {resolvedVisitReferenceLabel}</span>
                <span className="doc-site-badge">{pick(locale, "Calendar date", "실제 날짜")} · {actualVisitDateLabel}</span>
              </div>
            </section>
              </>
            )}
            {draft.intake_completed ? (
              <>
            <section className="doc-section">
              <div className="doc-section-head">
                <div>
                  <div className="doc-section-label">{pick(locale, "Image board", "이미지 보드")}</div>
                  <h4>{pick(locale, "Place White (slit) and fluorescein images into separate slots", "White (slit) 뷰와 fluorescein 뷰를 나눠서 넣기")}</h4>
                </div>
              </div>
              <div className="ops-stack">
                <section className="ops-card">
                  <div className="panel-card-head">
                    <strong>{pick(locale, "White (slit) view", "White (slit) 뷰")}</strong>
                    <button className="ghost-button" type="button" onClick={() => openFilePicker("white")}>
                      {pick(locale, "Add files", "파일 추가")}
                    </button>
                  </div>
                  <div
                    className="drop-surface"
                    onClick={() => openFilePicker("white")}
                    onDragOver={(event) => {
                      event.preventDefault();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      appendFiles(Array.from(event.dataTransfer.files), "white");
                    }}
                  >
                    <input
                      ref={whiteFileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      hidden
                      onChange={(event) => {
                        appendFiles(Array.from(event.target.files ?? []), "white");
                        event.currentTarget.value = "";
                      }}
                    />
                    <div className="drop-copy">
                      <strong>{pick(locale, "Drop White (slit) photos here", "White (slit) 사진을 여기로 넣으세요")}</strong>
                      <span>{pick(locale, "These files will be stored as the white view without auto-detection.", "자동 인식 없이 white 뷰로 저장됩니다.")}</span>
                    </div>
                  </div>
                  {whiteDraftImages.length > 0 ? (
                    <div className="image-grid">
                      {whiteDraftImages.map((image) => (
                        <article key={image.draft_id} className="image-card">
                          <div className="image-preview-frame">
                            <img src={image.preview_url} alt={image.file.name} className="image-preview" />
                          </div>
                          <div className="image-card-body">
                            <div className="image-card-head">
                              <strong>{image.file.name}</strong>
                              <button className="text-button" type="button" onClick={() => removeDraftImage(image.draft_id)}>
                                {pick(locale, "Remove", "제거")}
                              </button>
                            </div>
                            <div className="image-card-controls">
                              <span>{pick(locale, "Stored as white view", "white 뷰로 저장")}</span>
                              <button
                                className={`toggle-pill ${image.is_representative ? "active" : ""}`}
                                type="button"
                                onClick={() => setRepresentativeImage(image.draft_id)}
                              >
                                {image.is_representative ? pick(locale, "Representative", "대표 이미지") : pick(locale, "Mark representative", "대표 이미지로 지정")}
                              </button>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : null}
                </section>

                <section className="ops-card">
                  <div className="panel-card-head">
                    <strong>{pick(locale, "Fluorescein view", "Fluorescein 뷰")}</strong>
                    <button className="ghost-button" type="button" onClick={() => openFilePicker("fluorescein")}>
                      {pick(locale, "Add files", "파일 추가")}
                    </button>
                  </div>
                  <div
                    className="drop-surface"
                    onClick={() => openFilePicker("fluorescein")}
                    onDragOver={(event) => {
                      event.preventDefault();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      appendFiles(Array.from(event.dataTransfer.files), "fluorescein");
                    }}
                  >
                    <input
                      ref={fluoresceinFileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      hidden
                      onChange={(event) => {
                        appendFiles(Array.from(event.target.files ?? []), "fluorescein");
                        event.currentTarget.value = "";
                      }}
                    />
                    <div className="drop-copy">
                      <strong>{pick(locale, "Drop fluorescein photos here", "fluorescein 사진을 여기로 넣으세요")}</strong>
                      <span>{pick(locale, "These files will be stored as the fluorescein view without auto-detection.", "자동 인식 없이 fluorescein 뷰로 저장됩니다.")}</span>
                    </div>
                  </div>
                  {fluoresceinDraftImages.length > 0 ? (
                    <div className="image-grid">
                      {fluoresceinDraftImages.map((image) => (
                        <article key={image.draft_id} className="image-card">
                          <div className="image-preview-frame">
                            <img src={image.preview_url} alt={image.file.name} className="image-preview" />
                          </div>
                          <div className="image-card-body">
                            <div className="image-card-head">
                              <strong>{image.file.name}</strong>
                              <button className="text-button" type="button" onClick={() => removeDraftImage(image.draft_id)}>
                                {pick(locale, "Remove", "제거")}
                              </button>
                            </div>
                            <div className="image-card-controls">
                              <span>{pick(locale, "Stored as fluorescein view", "fluorescein 뷰로 저장")}</span>
                              <button
                                className={`toggle-pill ${image.is_representative ? "active" : ""}`}
                                type="button"
                                onClick={() => setRepresentativeImage(image.draft_id)}
                              >
                                {image.is_representative ? pick(locale, "Representative", "대표 이미지") : pick(locale, "Mark representative", "대표 이미지로 지정")}
                              </button>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : null}
                </section>
              </div>
            </section>

            <div className="doc-footer">
              <div>
                <strong>{pick(locale, "Ready to save", "저장 준비 완료")}</strong>
                <p>
                  {pick(locale, "Patient, visit, and image records will be stored in the selected hospital workspace using the current dataset model.", "환자, 방문, 이미지 레코드는 현재 데이터셋 구조를 유지한 채 선택한 병원 워크스페이스에 저장됩니다.")}
                </p>
              </div>
              <button className="primary-workspace-button" type="button" onClick={() => void handleSaveCase()} disabled={saveBusy || !selectedSiteId}>
                {saveBusy ? pick(locale, "Saving case...", "케이스 저장 중...") : pick(locale, "Save case to hospital", "병원에 케이스 저장")}
              </button>
            </div>
              </>
            ) : null}
          </section>

          <aside className={`workspace-panel ${panelOpen ? "open" : ""}`}>
            <div className="workspace-panel-head">
              <div>
                <div className="doc-section-label">{pick(locale, "Slide-over", "슬라이드오버")}</div>
                <h4>{selectedCase ? pick(locale, "Saved case preview", "저장된 케이스 미리보기") : pick(locale, "Draft insight", "초안 인사이트")}</h4>
              </div>
              <button className="ghost-button" type="button" onClick={() => setPanelOpen((current) => !current)}>
                {panelOpen ? pick(locale, "Hide", "숨기기") : pick(locale, "Show", "보기")}
              </button>
            </div>

            {selectedCase ? (
              <div className="panel-stack">
                <section className="panel-card">
                  <div className="panel-card-head">
                    <strong className="case-list-title">
                      {isFavoriteCase(selectedCase.case_id) ? <span className="favorite-indicator" aria-hidden="true">★</span> : null}
                      <span>{formatCaseTitle(selectedCase)}</span>
                    </strong>
                    <div className="panel-card-actions">
                      <button
                        className={`ghost-button favorite-toggle ${isFavoriteCase(selectedCase.case_id) ? "active" : ""}`}
                        type="button"
                        onClick={() => toggleFavoriteCase(selectedCase.case_id)}
                      >
                        {isFavoriteCase(selectedCase.case_id) ? pick(locale, "Favorited", "즐겨찾기됨") : pick(locale, "Favorite", "즐겨찾기")}
                      </button>
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => void handleRunValidation()}
                        disabled={validationBusy || !canRunValidation}
                      >
                        {validationBusy ? pick(locale, "Validating...", "검증 중...") : pick(locale, "Run AI validation", "AI 검증 실행")}
                      </button>
                    </div>
                  </div>
                  <div className="panel-meta">
                    <span>{selectedCase.patient_id}</span>
                    <span>{displayVisitReference(locale, selectedCase.visit_date)}</span>
                    {selectedCase.actual_visit_date ? <span>{selectedCase.actual_visit_date}</span> : null}
                    <span>{visitPhaseCopy(locale, selectedCase.is_initial_visit)}</span>
                    <span>{translateOption(locale, "cultureCategory", selectedCase.culture_category)}</span>
                  </div>
                  <p>
                    {pick(
                      locale,
                      `${organismDetailLabel(selectedCase.culture_category, selectedCase.culture_species, selectedCase.additional_organisms)} with ${selectedCase.image_count} uploaded images. Current status is ${translateOption(locale, "visitStatus", selectedCase.visit_status)}.`,
                      `${organismDetailLabel(selectedCase.culture_category, selectedCase.culture_species, selectedCase.additional_organisms)} · 업로드 이미지 ${selectedCase.image_count}장 · 현재 상태 ${translateOption(locale, "visitStatus", selectedCase.visit_status)}`
                    )}
                  </p>
                  {selectedCase.polymicrobial || (selectedCase.additional_organisms?.length ?? 0) > 0 ? (
                    <div className="organism-chip-row">
                      {listOrganisms(
                        selectedCase.culture_category,
                        selectedCase.culture_species,
                        selectedCase.additional_organisms
                      ).map((organism) => (
                        <span key={`selected-${organismKey(organism)}`} className="organism-chip static">
                          {organism.culture_species}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {!canRunValidation ? <p>{pick(locale, "Viewer accounts can inspect saved images, but validation remains disabled.", "뷰어 계정은 저장된 이미지를 볼 수 있지만 검증은 실행할 수 없습니다.")}</p> : null}
                </section>

                {selectedCompletion ? (
                  <section className="panel-card completion-card">
                    <div className="panel-card-head">
                      <strong>{selectedCompletion.kind === "contributed" ? pick(locale, "Contribution recorded", "기여 기록됨") : pick(locale, "Case saved", "케이스 저장됨")}</strong>
                      <span>{formatDateTime(selectedCompletion.timestamp, localeTag, common.notAvailable)}</span>
                    </div>
                    <p>
                      {selectedCompletion.kind === "contributed"
                        ? pick(locale, `This case produced update ${selectedCompletion.update_id ?? "pending"} and is queued as a local weight delta.`, `이 케이스는 업데이트 ${selectedCompletion.update_id ?? pick(locale, "pending", "대기")}를 생성했고 로컬 weight delta로 대기열에 올라갔습니다.`)
                        : pick(locale, "The patient, visit, and image set are now stored in the selected hospital workspace.", "환자, 방문, 이미지 세트가 선택한 병원 워크스페이스에 저장되었습니다.")}
                    </p>
                    {selectedCompletion.kind === "contributed" && selectedCompletion.stats ? (
                      <div className="panel-metric-grid">
                        <div>
                          <strong>{selectedCompletion.stats.user_contributions}</strong>
                          <span>{pick(locale, "my contributions", "내 기여 수")}</span>
                        </div>
                        <div>
                          <strong>{selectedCompletion.stats.total_contributions}</strong>
                          <span>{pick(locale, "global contributions", "전체 기여 수")}</span>
                        </div>
                        <div>
                          <strong>{selectedCompletion.stats.user_contribution_pct}%</strong>
                          <span>{pick(locale, "my share", "내 비중")}</span>
                        </div>
                        <div>
                          <strong>{summary?.n_validation_runs ?? 0}</strong>
                          <span>{pick(locale, "hospital validations", "병원 검증 수")}</span>
                        </div>
                      </div>
                    ) : null}
                  </section>
                ) : null}

                <section className="panel-card">
                  <div className="panel-card-head">
                    <strong>{pick(locale, "Image strip", "이미지 스트립")}</strong>
                    <span>{panelBusy ? common.loading : `${selectedCaseImages.length} ${pick(locale, "loaded", "불러옴")}`}</span>
                  </div>
                  <div className="panel-image-stack">
                    {selectedCaseImages.map((image) => (
                      <div key={image.image_id} className="panel-image-card">
                        {image.preview_url ? (
                          <img src={image.preview_url} alt={image.image_id} className="panel-image-preview" />
                        ) : (
                          <div className="panel-image-fallback">{pick(locale, "Preview unavailable", "미리보기를 표시할 수 없습니다")}</div>
                        )}
                        <div className="panel-image-copy">
                          <strong>{translateOption(locale, "view", image.view)}</strong>
                          <span>{image.is_representative ? pick(locale, "Representative", "대표 이미지") : pick(locale, "Supporting image", "보조 이미지")}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="panel-card">
                  <div className="panel-card-head">
                    <strong>{pick(locale, "ROI preview", "ROI 미리보기")}</strong>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => void handleRunRoiPreview()}
                      disabled={roiPreviewBusy || !canRunRoiPreview}
                    >
                      {roiPreviewBusy ? pick(locale, "Preparing...", "준비 중...") : pick(locale, "Preview ROI", "ROI 미리보기 실행")}
                    </button>
                  </div>
                  {!canRunRoiPreview ? <p>{pick(locale, "Viewer accounts can inspect images, but ROI preview remains disabled.", "뷰어 계정은 이미지는 볼 수 있지만 ROI 미리보기는 실행할 수 없습니다.")}</p> : null}
                  {canRunRoiPreview && roiPreviewItems.length === 0 ? (
                    <p>{pick(locale, "Generate a preview to compare the saved source images with their ROI crops.", "저장된 원본 이미지와 ROI crop을 비교하려면 미리보기를 생성하세요.")}</p>
                  ) : null}
                  {roiPreviewItems.length > 0 ? (
                    <div className="panel-image-stack">
                      {roiPreviewItems.map((item) => (
                        <div key={`${item.image_id ?? item.source_image_path}:roi`} className="panel-image-card">
                          <div className="panel-card-head">
                            <strong>{translateOption(locale, "view", item.view)}</strong>
                            <span>{item.is_representative ? pick(locale, "Representative", "대표 이미지") : pick(locale, "Supporting image", "보조 이미지")}</span>
                          </div>
                          <div className="panel-preview-grid">
                            <div>
                              {item.source_preview_url ? (
                                <img src={item.source_preview_url} alt={`${item.view} source`} className="panel-image-preview" />
                              ) : (
                                <div className="panel-image-fallback">{pick(locale, "Source preview unavailable", "원본 미리보기를 표시할 수 없습니다")}</div>
                              )}
                              <div className="panel-image-copy">
                                <strong>{pick(locale, "Source", "원본")}</strong>
                              </div>
                            </div>
                            <div>
                              {item.roi_crop_url ? (
                                <img src={item.roi_crop_url} alt={`${item.view} ROI`} className="panel-image-preview" />
                              ) : (
                                <div className="panel-image-fallback">{pick(locale, "ROI crop unavailable", "ROI crop을 표시할 수 없습니다")}</div>
                              )}
                              <div className="panel-image-copy">
                                <strong>{pick(locale, "ROI crop", "ROI crop")}</strong>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </section>

                <section className="panel-card">
                  <div className="panel-card-head">
                    <strong>{pick(locale, "Validation insight", "검증 인사이트")}</strong>
                    <span>{validationResult ? validationResult.summary.validation_id : pick(locale, "Not run yet", "아직 실행되지 않음")}</span>
                  </div>
                  {validationResult ? (
                    <div className="panel-stack">
                      <div className="validation-summary-card">
                        <div className="validation-badge-row">
                          <span
                            className={`validation-badge ${
                              validationResult.summary.is_correct ? "tone-match" : "tone-mismatch"
                            }`}
                          >
                            {validationResult.summary.is_correct ? pick(locale, "Match", "일치") : pick(locale, "Mismatch", "불일치")}
                          </span>
                          <span className={`validation-badge tone-${validationConfidenceTone}`}>
                            {validationConfidence}% {pick(locale, "confidence", "신뢰도")}
                          </span>
                          <span className="validation-badge tone-neutral">{validationResult.execution_device}</span>
                        </div>
                        <div className="validation-pair-grid">
                          <div>
                            <span>{pick(locale, "Predicted", "예측")}</span>
                            <strong>{validationResult.summary.predicted_label}</strong>
                          </div>
                          <div>
                            <span>{pick(locale, "Culture label", "배양 라벨")}</span>
                            <strong>{validationResult.summary.true_label}</strong>
                          </div>
                        </div>
                        <div className="validation-gauge-meta">
                          <span>{pick(locale, "Model confidence", "모델 신뢰도")}</span>
                          <strong>{formatProbability(validationResult.summary.prediction_probability, common.notAvailable)}</strong>
                        </div>
                        <div className="validation-gauge" aria-hidden="true">
                          <div
                            className={`validation-gauge-fill tone-${validationConfidenceTone}`}
                            style={{ width: `${validationConfidence}%` }}
                          />
                        </div>
                      </div>
                      <div className="panel-metric-grid">
                        <div>
                          <strong>{validationResult.summary.predicted_label}</strong>
                          <span>{pick(locale, "predicted", "예측값")}</span>
                        </div>
                        <div>
                          <strong>{validationResult.summary.true_label}</strong>
                          <span>{pick(locale, "culture label", "배양 라벨")}</span>
                        </div>
                        <div>
                          <strong>{formatProbability(validationResult.summary.prediction_probability, common.notAvailable)}</strong>
                          <span>{pick(locale, "confidence", "신뢰도")}</span>
                        </div>
                        <div>
                          <strong>{validationResult.execution_device}</strong>
                          <span>{pick(locale, "device", "디바이스")}</span>
                        </div>
                      </div>
                      <p>
                        {pick(locale, "Model", "모델")} {validationResult.model_version.version_name} ({validationResult.model_version.architecture})
                        {" · "}
                        {validationResult.summary.is_correct
                          ? pick(locale, "prediction matched culture", "예측이 배양 결과와 일치합니다")
                          : pick(locale, "prediction diverged from culture", "예측이 배양 결과와 다릅니다")}
                      </p>
                      <div className="panel-image-stack">
                        {validationArtifacts.roi_crop ? (
                          <div className="panel-image-card">
                            <img src={validationArtifacts.roi_crop} alt={pick(locale, "ROI crop", "ROI crop")} className="panel-image-preview" />
                            <div className="panel-image-copy">
                              <strong>{pick(locale, "ROI crop", "ROI crop")}</strong>
                              <span>{pick(locale, "MedSAM-ready crop", "MedSAM 준비용 crop")}</span>
                            </div>
                          </div>
                        ) : null}
                        {validationArtifacts.gradcam ? (
                          <div className="panel-image-card">
                            <img src={validationArtifacts.gradcam} alt={pick(locale, "Grad-CAM", "Grad-CAM")} className="panel-image-preview" />
                            <div className="panel-image-copy">
                              <strong>{pick(locale, "Grad-CAM", "Grad-CAM")}</strong>
                              <span>{pick(locale, "Model evidence overlay", "모델 근거 오버레이")}</span>
                            </div>
                          </div>
                        ) : null}
                        {validationArtifacts.medsam_mask ? (
                          <div className="panel-image-card">
                            <img src={validationArtifacts.medsam_mask} alt={pick(locale, "MedSAM mask", "MedSAM mask")} className="panel-image-preview" />
                            <div className="panel-image-copy">
                              <strong>{pick(locale, "MedSAM mask", "MedSAM mask")}</strong>
                              <span>{pick(locale, "Segmentation proxy", "분할 프록시")}</span>
                            </div>
                          </div>
                        ) : null}
                        {!validationArtifacts.roi_crop && !validationArtifacts.gradcam && !validationArtifacts.medsam_mask ? (
                          <div className="panel-image-fallback">{pick(locale, "No validation artifacts were produced for this run.", "이 실행에서는 검증 아티팩트가 생성되지 않았습니다.")}</div>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <p>{pick(locale, "Run validation from this panel to generate ROI, Grad-CAM, and a saved case-level prediction.", "이 패널에서 검증을 실행하면 ROI, Grad-CAM, 케이스 단위 예측을 생성할 수 있습니다.")}</p>
                  )}
                </section>

                <section className="panel-card">
                  <div className="panel-card-head">
                    <strong>{pick(locale, "Contribution", "기여")}</strong>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => void handleContributeCase()}
                      disabled={contributionBusy || !canContributeSelectedCase}
                    >
                      {contributionBusy ? pick(locale, "Contributing...", "기여 중...") : pick(locale, "Contribute case update", "케이스 업데이트 기여")}
                    </button>
                  </div>
                  {selectedCase.visit_status !== "active" ? (
                    <p>{pick(locale, "Only active visits are enabled for contribution under the current training policy.", "현재 학습 정책에서는 active 방문만 기여 대상으로 허용됩니다.")}</p>
                  ) : null}
                  {selectedCase.visit_status === "active" && !validationResult ? (
                    <p>{pick(locale, "Validation is optional, but running it first keeps the review and contribution flow aligned.", "검증은 선택 사항이지만, 먼저 실행하면 검토와 기여 흐름을 더 잘 맞출 수 있습니다.")}</p>
                  ) : null}
                  {!canRunValidation ? (
                    <p>{pick(locale, "Viewer accounts cannot run validation or local contribution jobs.", "뷰어 계정은 검증이나 로컬 기여 작업을 실행할 수 없습니다.")}</p>
                  ) : null}
                  {contributionResult ? (
                    <div className="panel-stack">
                      <div className="panel-metric-grid">
                        <div>
                          <strong>{contributionResult.stats.user_contributions}</strong>
                          <span>{pick(locale, "my contributions", "내 기여 수")}</span>
                        </div>
                        <div>
                          <strong>{contributionResult.stats.total_contributions}</strong>
                          <span>{pick(locale, "global contributions", "전체 기여 수")}</span>
                        </div>
                        <div>
                          <strong>{contributionResult.stats.user_contribution_pct}%</strong>
                          <span>{pick(locale, "my share", "내 비중")}</span>
                        </div>
                        <div>
                          <strong>{contributionResult.execution_device}</strong>
                          <span>{pick(locale, "device", "디바이스")}</span>
                        </div>
                      </div>
                      <p>
                        {pick(
                          locale,
                          `Update ${contributionResult.update.update_id} is queued as a ${contributionResult.update.upload_type} against ${contributionResult.model_version.version_name}.`,
                          `업데이트 ${contributionResult.update.update_id}가 ${contributionResult.model_version.version_name}에 대한 ${contributionResult.update.upload_type} 형태로 대기열에 올라갔습니다.`
                        )}
                      </p>
                    </div>
                  ) : (
                    <p>{pick(locale, "Contribution trains locally and stores only the weight delta for later upload.", "기여는 로컬 학습을 수행하고 나중에 업로드할 weight delta만 저장합니다.")}</p>
                  )}
                </section>

                <section className="panel-card">
                  <div className="panel-card-head">
                    <strong>{pick(locale, "Case history", "케이스 이력")}</strong>
                    <span>{historyBusy ? pick(locale, "Refreshing...", "새로고침 중...") : `${caseHistory?.validations.length ?? 0} ${pick(locale, "validations", "검증")} / ${caseHistory?.contributions.length ?? 0} ${pick(locale, "contributions", "기여")}`}</span>
                  </div>
                  <div className="panel-stack">
                    <div>
                      <div className="doc-section-label">{pick(locale, "Validations", "검증")}</div>
                      <div className="panel-history-list">
                        {caseHistory?.validations.length ? (
                          caseHistory.validations.map((item) => (
                            <div key={item.validation_id} className="panel-history-item">
                              <strong>{item.model_version}</strong>
                              <div className="panel-meta">
                                <span>{item.run_scope}</span>
                                <span>{item.run_date}</span>
                              </div>
                              <div className="panel-meta">
                                <span>{item.predicted_label}</span>
                                <span>{formatProbability(item.prediction_probability, common.notAvailable)}</span>
                                <span>{item.is_correct ? pick(locale, "match", "일치") : pick(locale, "mismatch", "불일치")}</span>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="empty-surface">{pick(locale, "No validation history for this case yet.", "이 케이스에는 아직 검증 이력이 없습니다.")}</div>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="doc-section-label">{pick(locale, "Contributions", "기여")}</div>
                      <div className="panel-history-list">
                        {caseHistory?.contributions.length ? (
                          caseHistory.contributions.map((item) => (
                            <div key={item.contribution_id} className="panel-history-item">
                              <strong>{item.update_id}</strong>
                              <div className="panel-meta">
                                <span>{item.upload_type ?? pick(locale, "weight delta", "weight delta")}</span>
                                <span>{item.execution_device ?? pick(locale, "unknown device", "알 수 없는 디바이스")}</span>
                              </div>
                              <div className="panel-meta">
                                <span>{item.update_status ?? pick(locale, "unknown status", "알 수 없는 상태")}</span>
                                <span>{item.created_at}</span>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="empty-surface">{pick(locale, "No contribution history for this case yet.", "이 케이스에는 아직 기여 이력이 없습니다.")}</div>
                        )}
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            ) : (
              <div className="panel-stack">
                <section className="panel-card">
                  <strong>{pick(locale, "Draft checklist", "초안 체크리스트")}</strong>
                  <div className="panel-checklist">
                    <div className={draft.patient_id.trim() ? "complete" : ""}>{pick(locale, "Patient identity", "환자 정보")}</div>
                    <div className={draft.intake_completed ? "complete" : ""}>{pick(locale, "Core intake complete", "기본 입력 완료")}</div>
                    <div className={draft.intake_completed ? "complete" : ""}>{pick(locale, "Visit timing open", "방문 시점 입력 가능")}</div>
                    <div className={draft.culture_species.trim() ? "complete" : ""}>{pick(locale, "Organism metadata", "균종 메타데이터")}</div>
                    <div className={draftImages.length > 0 ? "complete" : ""}>{pick(locale, "Image blocks", "이미지 블록")}</div>
                  </div>
                </section>

                <section className="panel-card">
                  <div className="panel-card-head">
                    <strong>{pick(locale, "Selected hospital", "선택된 병원")}</strong>
                    <span>{selectedSiteId ?? pick(locale, "none", "없음")}</span>
                  </div>
                  <div className="panel-metric-grid">
                    <div>
                      <strong>{summary?.n_patients ?? 0}</strong>
                      <span>{pick(locale, "patients", "환자")}</span>
                    </div>
                    <div>
                      <strong>{summary?.n_visits ?? 0}</strong>
                      <span>{pick(locale, "visits", "방문")}</span>
                    </div>
                    <div>
                      <strong>{summary?.n_images ?? 0}</strong>
                      <span>{pick(locale, "images", "이미지")}</span>
                    </div>
                    <div>
                      <strong>{summary?.n_validation_runs ?? 0}</strong>
                      <span>{pick(locale, "validations", "검증")}</span>
                    </div>
                  </div>
                </section>
              </div>
            )}
          </aside>
        </div>
      </section>

      {toast ? (
        <div className={`workspace-toast tone-${toast.tone}`}>
          <strong>{toast.tone === "success" ? common.saved : common.actionNeeded}</strong>
          <span>{toast.message}</span>
        </div>
      ) : null}
    </main>
  );
}
