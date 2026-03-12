"use client";

import { type PointerEvent as ReactPointerEvent, useDeferredValue, useEffect, useRef, useState } from "react";

import { LocaleToggle, pick, translateApiError, translateOption, translateRole, useI18n } from "../lib/i18n";
import {
  type CaseHistoryResponse,
  type CaseContributionResponse,
  type LesionPreviewRecord,
  type OrganismRecord,
  type PatientRecord,
  type RoiPreviewRecord,
  type SiteActivityResponse,
  type SiteValidationRunRecord,
  createPatient,
  createVisit,
  deleteVisitImages,
  fetchCaseHistory,
  fetchCaseLesionPreview,
  fetchCaseLesionPreviewArtifactBlob,
  fetchCaseRoiPreview,
  fetchCaseRoiPreviewArtifactBlob,
  clearImageLesionBox,
  fetchCases,
  fetchImageBlob,
  fetchPatients,
  fetchVisits,
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
  type VisitRecord,
  runSiteValidation,
  updateVisit,
  runCaseContribution,
  runCaseValidation,
  updateImageLesionBox,
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
  medsam_mask_url: string | null;
};

type LesionPreviewCard = LesionPreviewRecord & {
  source_preview_url: string | null;
  lesion_crop_url: string | null;
  lesion_mask_url: string | null;
};

type PatientListThumbnail = {
  case_id: string;
  image_id: string;
  view: string | null;
  preview_url: string | null;
};

type PatientListRow = {
  patient_id: string;
  latest_case: CaseSummaryRecord;
  case_count: number;
  organism_summary: string;
  representative_thumbnails: PatientListThumbnail[];
};

type NormalizedBox = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

type LesionBoxMap = Record<string, NormalizedBox | null>;

type ValidationArtifactKind = "gradcam" | "roi_crop" | "medsam_mask" | "lesion_crop" | "lesion_mask";

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

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load image: ${src}`));
    image.src = src;
  });
}

function MaskOverlayPreview({
  sourceUrl,
  maskUrl,
  alt,
  tint = [125, 211, 195],
}: {
  sourceUrl: string | null | undefined;
  maskUrl: string | null | undefined;
  alt: string;
  tint?: [number, number, number];
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [overlayReady, setOverlayReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function renderOverlay() {
      if (!canvasRef.current || !sourceUrl || !maskUrl) {
        setOverlayReady(false);
        return;
      }
      try {
        const [sourceImage, maskImage] = await Promise.all([loadHtmlImage(sourceUrl), loadHtmlImage(maskUrl)]);
        if (cancelled || !canvasRef.current) {
          return;
        }
        const canvas = canvasRef.current;
        canvas.width = sourceImage.naturalWidth || sourceImage.width;
        canvas.height = sourceImage.naturalHeight || sourceImage.height;
        const context = canvas.getContext("2d");
        if (!context) {
          setOverlayReady(false);
          return;
        }

        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);

        const maskCanvas = document.createElement("canvas");
        maskCanvas.width = canvas.width;
        maskCanvas.height = canvas.height;
        const maskContext = maskCanvas.getContext("2d");
        if (!maskContext) {
          setOverlayReady(false);
          return;
        }
        maskContext.drawImage(maskImage, 0, 0, canvas.width, canvas.height);
        const maskData = maskContext.getImageData(0, 0, canvas.width, canvas.height);
        const sourceData = context.getImageData(0, 0, canvas.width, canvas.height);
        const finalData = context.createImageData(canvas.width, canvas.height);
        finalData.data.set(sourceData.data);

        for (let index = 0; index < maskData.data.length; index += 4) {
          const intensity = maskData.data[index];
          if (intensity > 24) {
            const alpha = 0.34;
            finalData.data[index] = Math.round((1 - alpha) * sourceData.data[index] + alpha * tint[0]);
            finalData.data[index + 1] = Math.round((1 - alpha) * sourceData.data[index + 1] + alpha * tint[1]);
            finalData.data[index + 2] = Math.round((1 - alpha) * sourceData.data[index + 2] + alpha * tint[2]);
            finalData.data[index + 3] = 255;
          }
        }

        for (let y = 1; y < canvas.height - 1; y += 1) {
          for (let x = 1; x < canvas.width - 1; x += 1) {
            const pixelIndex = (y * canvas.width + x) * 4;
            const inside = maskData.data[pixelIndex] > 24;
            if (!inside) {
              continue;
            }
            const neighbors = [
              ((y - 1) * canvas.width + x) * 4,
              ((y + 1) * canvas.width + x) * 4,
              (y * canvas.width + (x - 1)) * 4,
              (y * canvas.width + (x + 1)) * 4,
            ];
            if (neighbors.some((neighborIndex) => maskData.data[neighborIndex] <= 24)) {
              finalData.data[pixelIndex] = Math.min(255, tint[0] + 20);
              finalData.data[pixelIndex + 1] = Math.min(255, tint[1] + 20);
              finalData.data[pixelIndex + 2] = Math.min(255, tint[2] + 20);
              finalData.data[pixelIndex + 3] = 255;
            }
          }
        }

        context.putImageData(finalData, 0, 0);
        setOverlayReady(true);
      } catch {
        if (!cancelled) {
          setOverlayReady(false);
        }
      }
    }
    void renderOverlay();
    return () => {
      cancelled = true;
    };
  }, [maskUrl, sourceUrl, tint]);

  if (!sourceUrl || !maskUrl) {
    return <div className="panel-image-fallback">{alt}</div>;
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        className={`panel-image-preview panel-image-overlay${overlayReady ? " ready" : ""}`}
        aria-label={alt}
      />
      {!overlayReady ? <img src={sourceUrl} alt={alt} className="panel-image-preview panel-image-overlay-fallback" /> : null}
    </>
  );
}

function createDraft(): DraftState {
  return {
    patient_id: "",
    chart_alias: "",
    local_case_code: "",
    sex: "female",
    age: "65",
    actual_visit_date: "",
    follow_up_number: "1",
    culture_category: "",
    culture_species: "",
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

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function normalizeBox(box: NormalizedBox): NormalizedBox {
  return {
    x0: clamp01(Math.min(box.x0, box.x1)),
    y0: clamp01(Math.min(box.y0, box.y1)),
    x1: clamp01(Math.max(box.x0, box.x1)),
    y1: clamp01(Math.max(box.y0, box.y1)),
  };
}

function toNormalizedBox(value: unknown): NormalizedBox | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const box = value as Record<string, unknown>;
  if (["x0", "y0", "x1", "y1"].every((key) => typeof box[key] === "number")) {
    return normalizeBox({
      x0: Number(box.x0),
      y0: Number(box.y0),
      x1: Number(box.x1),
      y1: Number(box.y1),
    });
  }
  return null;
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

function computeNextFollowUpNumber(visits: VisitRecord[]): number {
  let maxFollowUp = 0;
  for (const visit of visits) {
    const match = String(visit.visit_date ?? "").match(/^(?:F\/?U|FU)[-\s_#]*0*(\d+)$/i);
    if (!match) {
      continue;
    }
    maxFollowUp = Math.max(maxFollowUp, Number(match[1]) || 0);
  }
  return maxFollowUp + 1;
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
  const isAlreadyExistsError = (nextError: unknown) => {
    if (!(nextError instanceof Error)) {
      return false;
    }
    const rawMessage = nextError.message.toLowerCase();
    const translatedMessage = translateApiError(locale, nextError.message).toLowerCase();
    return (
      rawMessage.includes("already exists") ||
      rawMessage.includes("이미 존재") ||
      translatedMessage.includes("already exists") ||
      translatedMessage.includes("이미 존재")
    );
  };
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
  const [railView, setRailView] = useState<"cases" | "patients">("cases");
  const [selectedCase, setSelectedCase] = useState<CaseSummaryRecord | null>(null);
  const [selectedCaseImages, setSelectedCaseImages] = useState<SavedImagePreview[]>([]);
  const [patientVisitGallery, setPatientVisitGallery] = useState<Record<string, SavedImagePreview[]>>({});
  const [panelBusy, setPanelBusy] = useState(false);
  const [patientVisitGalleryBusy, setPatientVisitGalleryBusy] = useState(false);
  const [activityBusy, setActivityBusy] = useState(false);
  const [siteActivity, setSiteActivity] = useState<SiteActivityResponse | null>(null);
  const [siteValidationBusy, setSiteValidationBusy] = useState(false);
  const [siteValidationRuns, setSiteValidationRuns] = useState<SiteValidationRunRecord[]>([]);
  const [validationBusy, setValidationBusy] = useState(false);
  const [validationResult, setValidationResult] = useState<CaseValidationResponse | null>(null);
  const [validationArtifacts, setValidationArtifacts] = useState<ValidationArtifactPreviews>({});
  const [roiPreviewBusy, setRoiPreviewBusy] = useState(false);
  const [roiPreviewItems, setRoiPreviewItems] = useState<RoiPreviewCard[]>([]);
  const [lesionPreviewBusy, setLesionPreviewBusy] = useState(false);
  const [lesionPreviewItems, setLesionPreviewItems] = useState<LesionPreviewCard[]>([]);
  const [lesionPromptDrafts, setLesionPromptDrafts] = useState<LesionBoxMap>({});
  const [lesionPromptSaved, setLesionPromptSaved] = useState<LesionBoxMap>({});
  const [draftLesionPromptBoxes, setDraftLesionPromptBoxes] = useState<LesionBoxMap>({});
  const [lesionBoxBusyImageId, setLesionBoxBusyImageId] = useState<string | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [caseHistory, setCaseHistory] = useState<CaseHistoryResponse | null>(null);
  const [contributionBusy, setContributionBusy] = useState(false);
  const [contributionResult, setContributionResult] = useState<CaseContributionResponse | null>(null);
  const [completionState, setCompletionState] = useState<CompletionState | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [caseSearch, setCaseSearch] = useState("");
  const [favoriteCaseIds, setFavoriteCaseIds] = useState<string[]>([]);
  const [showOnlyMine, setShowOnlyMine] = useState(false);
  const [patientListThumbs, setPatientListThumbs] = useState<Record<string, PatientListThumbnail[]>>({});
  const [toast, setToast] = useState<ToastState>(null);
  const whiteFileInputRef = useRef<HTMLInputElement | null>(null);
  const fluoresceinFileInputRef = useRef<HTMLInputElement | null>(null);
  const draftImagesRef = useRef<DraftImage[]>([]);
  const validationArtifactUrlsRef = useRef<string[]>([]);
  const roiPreviewUrlsRef = useRef<string[]>([]);
  const lesionPreviewUrlsRef = useRef<string[]>([]);
  const patientListThumbUrlsRef = useRef<string[]>([]);
  const patientVisitGalleryUrlsRef = useRef<string[]>([]);
  const railListSectionRef = useRef<HTMLElement | null>(null);
  const lesionDrawStateRef = useRef<{ imageId: string; pointerId: number; x: number; y: number } | null>(null);
  const draftLesionDrawStateRef = useRef<{ imageId: string; pointerId: number; x: number; y: number } | null>(null);
  const deferredSearch = useDeferredValue(caseSearch);
  const copy = {
    unableLoadPatients: pick(locale, "Unable to load patients.", "환자 목록을 불러오지 못했습니다."),
    recoveredDraft: pick(locale, "Recovered the last saved draft properties for this hospital. Re-attach image files before saving.", "이 병원의 마지막 초안 속성을 복구했습니다. 저장 전 이미지 파일은 다시 첨부해 주세요."),
    unableLoadRecentCases: pick(locale, "Unable to load recent cases.", "최근 케이스를 불러오지 못했습니다."),
    unableLoadSiteActivity: pick(locale, "Unable to load hospital activity.", "병원 활동을 불러오지 못했습니다."),
    unableLoadSiteValidationHistory: pick(locale, "Unable to load hospital validation history.", "병원 검증 이력을 불러오지 못했습니다."),
    unableLoadCaseHistory: pick(locale, "Unable to load case history.", "케이스 이력을 불러오지 못했습니다."),
    selectSavedCaseForRoi: pick(locale, "Select a saved case before running cornea preview.", "각막 crop 미리보기를 실행하려면 저장된 케이스를 선택하세요."),
    roiPreviewGenerated: (patientId: string, visitDate: string) =>
      pick(locale, `Cornea preview generated for ${patientId} / ${visitDate}.`, `${patientId} / ${visitDate} 각막 crop 미리보기를 생성했습니다.`),
    roiPreviewFailed: pick(locale, "Cornea preview failed.", "각막 crop 미리보기에 실패했습니다."),
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
    cultureSpeciesRequired: pick(locale, "Select the primary organism.", "대표 균종을 선택하세요."),
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
    listViewHeaderCopy: pick(locale, "Browse saved patients and open the latest case.", "저장 환자를 보고 최신 케이스를 엽니다."),
    caseAuthoringHeaderCopy: pick(locale, "Create, review, and contribute cases from this workspace.", "이 작업공간에서 증례 작성, 검토, 기여를 진행할 수 있습니다."),
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
      for (const url of patientListThumbUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      for (const url of patientVisitGalleryUrlsRef.current) {
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
    return () => {
      for (const url of lesionPreviewUrlsRef.current) {
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
    clearLesionPreview();
    setValidationResult(null);
    setCaseHistory(null);
    setContributionResult(null);
    setLesionPromptDrafts({});
    setLesionPromptSaved({});
    for (const url of patientVisitGalleryUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    patientVisitGalleryUrlsRef.current = [];
    setPatientVisitGallery({});
    if (!selectedSiteId || !selectedCase) {
      setSelectedCaseImages([]);
      setPatientVisitGallery({});
      return;
    }
    const currentSiteId = selectedSiteId;
    const currentCase = selectedCase;
    const currentPatientCases = [...cases]
      .filter((item) => item.patient_id === currentCase.patient_id)
      .sort((left, right) => caseTimestamp(right) - caseTimestamp(left));
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
          const nextSavedBoxes = Object.fromEntries(
            nextImages.map((image) => [image.image_id, toNormalizedBox(image.lesion_prompt_box)])
          );
          setLesionPromptSaved(nextSavedBoxes);
          setLesionPromptDrafts(nextSavedBoxes);
        }
      } catch (nextError) {
        if (!cancelled) {
          setToast({
            tone: "error",
            message: describeError(nextError, pick(locale, "Unable to load case images.", "케이스 이미지를 불러오지 못했습니다.")),
          });
          setSelectedCaseImages([]);
          setLesionPromptSaved({});
          setLesionPromptDrafts({});
        }
      } finally {
        if (!cancelled) {
          setPanelBusy(false);
        }
      }
    }
    async function loadPatientVisitGallery() {
      setPatientVisitGalleryBusy(true);
      try {
        const nextEntries = await Promise.all(
          currentPatientCases.map(async (caseItem) => {
            const imageRecords = await fetchImages(currentSiteId, token, caseItem.patient_id, caseItem.visit_date);
            const images = await Promise.all(
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
            return [caseItem.case_id, images] as const;
          })
        );
        if (!cancelled) {
          const nextGallery = Object.fromEntries(nextEntries);
          patientVisitGalleryUrlsRef.current = createdUrls;
          setPatientVisitGallery(nextGallery);
        }
      } catch (nextError) {
        if (!cancelled) {
          setPatientVisitGallery({});
          setToast({
            tone: "error",
            message: describeError(nextError, pick(locale, "Unable to load this patient's visit gallery.", "이 환자의 방문 이미지 묶음을 불러오지 못했습니다.")),
          });
        }
      } finally {
        if (!cancelled) {
          setPatientVisitGalleryBusy(false);
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
    void loadPatientVisitGallery();
    void loadSelectedCaseHistory();
    return () => {
      cancelled = true;
      for (const url of createdUrls) {
        URL.revokeObjectURL(url);
      }
    };
  }, [cases, selectedCase, selectedSiteId, token]);

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

  useEffect(() => {
    if (railView !== "patients") {
      return;
    }
    railListSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [railView]);

  function replaceDraftImages(nextImages: DraftImage[]) {
    const nextIds = new Set(nextImages.map((image) => image.draft_id));
    for (const current of draftImagesRef.current) {
      if (!nextIds.has(current.draft_id)) {
        URL.revokeObjectURL(current.preview_url);
      }
    }
    setDraftLesionPromptBoxes((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([draftId]) => nextIds.has(draftId))
      )
    );
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

  function clearLesionPreview() {
    for (const url of lesionPreviewUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    lesionPreviewUrlsRef.current = [];
    setLesionPreviewItems([]);
  }

  function clearDraftStorage(siteId: string | null = selectedSiteId) {
    if (!siteId) {
      setDraftSavedAt(null);
      return;
    }
    window.localStorage.removeItem(draftStorageKey(user.user_id, siteId));
    setDraftSavedAt(null);
  }

  async function prefillDraftFromPatient(patient: PatientRecord) {
    setSelectedCase(null);
    setPanelOpen(true);
    setRailView("cases");
    const applyPatientOnly = () => {
      setDraft((current) => ({
        ...current,
        patient_id: patient.patient_id,
        sex: patient.sex || current.sex,
        age: String(patient.age ?? current.age),
        chart_alias: patient.chart_alias ?? current.chart_alias,
        local_case_code: patient.local_case_code ?? current.local_case_code,
        intake_completed: true,
      }));
    };
    applyPatientOnly();
    if (!selectedSiteId) {
      return;
    }
    try {
      const visits = await fetchVisits(selectedSiteId, token, patient.patient_id);
      const latestVisit = [...visits].sort((left, right) => visitTimestamp(right) - visitTimestamp(left))[0];
      if (!latestVisit) {
        return;
      }
      const followUpMatch = String(latestVisit.visit_date ?? "").match(/^(?:F\/?U|FU)[-\s_#]*0*(\d+)$/i);
      setDraft((current) => ({
        ...current,
        patient_id: patient.patient_id,
        sex: patient.sex || current.sex,
        age: String(patient.age ?? current.age),
        chart_alias: patient.chart_alias ?? current.chart_alias,
        local_case_code: patient.local_case_code ?? current.local_case_code,
        actual_visit_date: latestVisit.actual_visit_date?.trim() || current.actual_visit_date,
        culture_category: latestVisit.culture_category || current.culture_category,
        culture_species: latestVisit.culture_species || current.culture_species,
        additional_organisms: normalizeAdditionalOrganisms(
          latestVisit.culture_category,
          latestVisit.culture_species,
          latestVisit.additional_organisms
        ),
        contact_lens_use: latestVisit.contact_lens_use || current.contact_lens_use,
        visit_status: latestVisit.visit_status || current.visit_status,
        is_initial_visit: latestVisit.is_initial_visit,
        follow_up_number: followUpMatch ? String(Number(followUpMatch[1]) || 1) : current.follow_up_number,
        predisposing_factor: latestVisit.predisposing_factor ?? current.predisposing_factor,
        other_history: latestVisit.other_history ?? current.other_history,
        intake_completed: true,
      }));
      if (latestVisit.culture_category) {
        setPendingOrganism({
          culture_category: latestVisit.culture_category,
          culture_species:
            latestVisit.additional_organisms?.[0]?.culture_species ||
            (CULTURE_SPECIES[latestVisit.culture_category]?.[0] ?? pendingOrganism.culture_species),
        });
      }
      setShowAdditionalOrganismForm(false);
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, pick(locale, "Unable to load the latest visit details for this patient.", "이 환자의 최근 방문 정보를 불러오지 못했습니다.")),
      });
    }
  }

  async function startFollowUpDraftFromSelectedCase() {
    if (!selectedCase) {
      return;
    }

    replaceDraftImages([]);
    setDraftLesionPromptBoxes({});
    clearDraftStorage();
    clearValidationArtifacts();
    clearRoiPreview();
    clearLesionPreview();
    setValidationResult(null);
    setCaseHistory(null);
    setContributionResult(null);
    setSelectedCase(null);
    setSelectedCaseImages([]);
    setPanelOpen(true);
    setRailView("cases");
    const selectedFollowUpMatch = String(selectedCase.visit_date ?? "").match(/^(?:F\/?U|FU)[-\s_#]*0*(\d+)$/i);
    const fallbackFollowUpNumber = String((selectedFollowUpMatch ? Number(selectedFollowUpMatch[1]) || 0 : 0) + 1);

    const applyFallbackDraft = (followUpNumber: string) => {
      setDraft((current) => ({
        ...current,
        patient_id: selectedCase.patient_id,
        sex: selectedCase.sex || current.sex,
        age: String(selectedCase.age ?? current.age),
        chart_alias: selectedCase.chart_alias ?? current.chart_alias,
        local_case_code: selectedCase.local_case_code ?? current.local_case_code,
        actual_visit_date: "",
        culture_category: selectedCase.culture_category || current.culture_category,
        culture_species: selectedCase.culture_species || current.culture_species,
        additional_organisms: normalizeAdditionalOrganisms(
          selectedCase.culture_category,
          selectedCase.culture_species,
          selectedCase.additional_organisms
        ),
        contact_lens_use: selectedCase.contact_lens_use || current.contact_lens_use,
        visit_status: selectedCase.visit_status || current.visit_status,
        is_initial_visit: false,
        follow_up_number: followUpNumber,
        intake_completed: true,
      }));
      setPendingOrganism({
        culture_category: selectedCase.culture_category || "bacterial",
        culture_species:
          selectedCase.additional_organisms?.[0]?.culture_species ||
          selectedCase.culture_species ||
          (CULTURE_SPECIES[selectedCase.culture_category || "bacterial"]?.[0] ?? ""),
      });
      setShowAdditionalOrganismForm(false);
    };

    if (!selectedSiteId) {
      applyFallbackDraft(fallbackFollowUpNumber);
      return;
    }

    try {
      const visits = await fetchVisits(selectedSiteId, token, selectedCase.patient_id);
      const nextFollowUpNumber = String(computeNextFollowUpNumber(visits));
      const latestVisit = [...visits].sort((left, right) => visitTimestamp(right) - visitTimestamp(left))[0] ?? null;
      if (!latestVisit) {
        applyFallbackDraft(nextFollowUpNumber);
        return;
      }
      setDraft((current) => ({
        ...current,
        patient_id: selectedCase.patient_id,
        sex: selectedCase.sex || current.sex,
        age: String(selectedCase.age ?? current.age),
        chart_alias: selectedCase.chart_alias ?? current.chart_alias,
        local_case_code: selectedCase.local_case_code ?? current.local_case_code,
        actual_visit_date: "",
        culture_category: latestVisit.culture_category || selectedCase.culture_category || current.culture_category,
        culture_species: latestVisit.culture_species || selectedCase.culture_species || current.culture_species,
        additional_organisms: normalizeAdditionalOrganisms(
          latestVisit.culture_category || selectedCase.culture_category,
          latestVisit.culture_species || selectedCase.culture_species,
          latestVisit.additional_organisms ?? selectedCase.additional_organisms
        ),
        contact_lens_use: latestVisit.contact_lens_use || selectedCase.contact_lens_use || current.contact_lens_use,
        visit_status: latestVisit.visit_status || selectedCase.visit_status || current.visit_status,
        is_initial_visit: false,
        follow_up_number: nextFollowUpNumber,
        predisposing_factor: latestVisit.predisposing_factor ?? current.predisposing_factor,
        other_history: latestVisit.other_history ?? current.other_history,
        intake_completed: true,
      }));
      setPendingOrganism({
        culture_category: latestVisit.culture_category || selectedCase.culture_category || "bacterial",
        culture_species:
          latestVisit.additional_organisms?.[0]?.culture_species ||
          latestVisit.culture_species ||
          selectedCase.culture_species ||
          (CULTURE_SPECIES[latestVisit.culture_category || selectedCase.culture_category || "bacterial"]?.[0] ?? ""),
      });
      setShowAdditionalOrganismForm(false);
    } catch (nextError) {
      applyFallbackDraft(fallbackFollowUpNumber);
      setToast({
        tone: "error",
        message: describeError(
          nextError,
          pick(locale, "Unable to prepare the next follow-up draft for this patient.", "이 환자의 다음 재진 초안을 준비하지 못했습니다.")
        ),
      });
    }
  }

  function resetDraft() {
    setRailView("cases");
    replaceDraftImages([]);
    clearDraftStorage();
    clearValidationArtifacts();
    clearRoiPreview();
    clearLesionPreview();
    setValidationResult(null);
    setCaseHistory(null);
    setContributionResult(null);
    setSelectedCase(null);
    setSelectedCaseImages([]);
    setDraftLesionPromptBoxes({});
    setDraft(createDraft());
    setPendingOrganism({
      culture_category: "bacterial",
      culture_species: CULTURE_SPECIES.bacterial[0],
    });
    setShowAdditionalOrganismForm(false);
  }

  function startNewCaseDraft() {
    resetDraft();
    setPanelOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
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

  function openSavedCase(caseRecord: CaseSummaryRecord, nextView: "cases" | "patients" = "cases") {
    setSelectedCase(caseRecord);
    setPanelOpen(true);
    setRailView(nextView);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updatePrimaryOrganism(cultureCategory: string, cultureSpecies: string) {
    setDraft((current) => ({
      ...current,
      culture_category: cultureCategory.trim().toLowerCase(),
      culture_species: cultureSpecies.trim(),
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
    clearLesionPreview();
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

  function updateDraftLesionBoxFromPointer(draftId: string, clientX: number, clientY: number, element: HTMLDivElement) {
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

  function handleDraftLesionPointerDown(draftId: string, event: ReactPointerEvent<HTMLDivElement>) {
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
    element.setPointerCapture(event.pointerId);
  }

  function handleDraftLesionPointerMove(draftId: string, event: ReactPointerEvent<HTMLDivElement>) {
    if (
      draftLesionDrawStateRef.current?.pointerId !== event.pointerId ||
      draftLesionDrawStateRef.current?.imageId !== draftId
    ) {
      return;
    }
    updateDraftLesionBoxFromPointer(draftId, event.clientX, event.clientY, event.currentTarget);
  }

  function finishDraftLesionPointer(draftId: string, event: ReactPointerEvent<HTMLDivElement>) {
    const drawState = draftLesionDrawStateRef.current;
    if (!drawState || drawState.pointerId !== event.pointerId || drawState.imageId !== draftId) {
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
      [draftId]: nextBox.x1 - nextBox.x0 < 0.01 || nextBox.y1 - nextBox.y0 < 0.01 ? null : nextBox,
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

  const representativeSavedImage = selectedCaseImages.find((image) => image.is_representative) ?? null;
  const lesionBoxChangedImageIds = selectedCaseImages
    .map((image) => image.image_id)
    .filter((imageId) => JSON.stringify(lesionPromptDrafts[imageId] ?? null) !== JSON.stringify(lesionPromptSaved[imageId] ?? null));
  const hasAnySavedLesionBox = Object.values(lesionPromptSaved).some((value) => value);

  async function persistLesionPromptBox(imageId: string, nextBox: NormalizedBox) {
    if (!selectedSiteId) {
      throw new Error(pick(locale, "Select a hospital first.", "먼저 병원을 선택하세요."));
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
      return normalized;
    } finally {
      setLesionBoxBusyImageId(null);
    }
  }

  async function clearSavedLesionPromptBox(imageId: string) {
    if (!selectedSiteId) {
      throw new Error(pick(locale, "Select a hospital first.", "먼저 병원을 선택하세요."));
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
          message: describeError(nextError, pick(locale, "Unable to clear lesion box.", "병변 박스를 해제하지 못했습니다.")),
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
        message: pick(locale, "Select a saved case before running lesion preview.", "병변 crop 미리보기를 실행하려면 저장된 케이스를 선택하세요."),
      });
      return;
    }
    const hasAnyDraftBox = Object.values(lesionPromptDrafts).some((value) => value);
    const hasAnySavedBox = Object.values(lesionPromptSaved).some((value) => value);
    if (!hasAnyDraftBox && !hasAnySavedBox) {
      setToast({
        tone: "error",
        message: pick(locale, "Draw and save at least one lesion box first.", "병변 박스를 하나 이상 그리고 저장하세요."),
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
        model_version_id: validationResult?.model_version.version_id,
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
    const patientId = draft.patient_id.trim();
    const visitPayload = (visitReference: string) => ({
      patient_id: patientId,
      visit_date: visitReference,
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
      is_initial_visit: /^initial$/i.test(visitReference),
      polymicrobial: draft.additional_organisms.length > 0,
    });
    const uploadDraftImagesToVisit = async (visitReference: string) => {
      for (const image of draftImages) {
        const uploadedImage = await uploadImage(selectedSiteId!, token, {
          patient_id: patientId,
          visit_date: visitReference,
          view: image.view,
          is_representative: image.is_representative,
          file: image.file,
        });
        const draftBox = draftLesionPromptBoxes[image.draft_id];
        if (draftBox) {
          await updateImageLesionBox(selectedSiteId!, uploadedImage.image_id, token, draftBox);
        }
      }
    };
    const finalizeSavedCase = async (visitReference: string) => {
      await onSiteDataChanged(selectedSiteId!);
      const [nextCases, nextPatients] = await Promise.all([
        fetchCases(selectedSiteId!, token, { mine: showOnlyMine }),
        fetchPatients(selectedSiteId!, token, { mine: showOnlyMine }),
      ]);
      setCases(nextCases);
      setPatientRecords(nextPatients);
      const createdCase = nextCases.find(
        (item) => item.patient_id === patientId && item.visit_date === visitReference
      );
      await loadSiteActivity(selectedSiteId!);
      setToast({
        tone: "success",
        message: copy.caseSaved(patientId, visitReference, selectedSiteId!),
      });
      clearDraftStorage(selectedSiteId!);
      resetDraft();
      setSelectedCase(createdCase ?? null);
      setPanelOpen(true);
      setCompletionState({
        kind: "saved",
        patient_id: patientId,
        visit_date: visitReference,
        timestamp: new Date().toISOString(),
      });
    };
    const nextAvailableFollowUpReference = async () => {
      const visits = await fetchVisits(selectedSiteId!, token, patientId);
      const usedVisitReferences = visits.map((item) => item.visit_date);
      let maxFollowUp = 0;
      for (const item of usedVisitReferences) {
        const match = String(item).match(/^F\/U-(\d{2})$/i);
        if (match) {
          maxFollowUp = Math.max(maxFollowUp, Number(match[1]));
        }
      }
      return `F/U-${String(maxFollowUp + 1).padStart(2, "0")}`;
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
          patient_id: patientId,
          sex: draft.sex,
          age: Number(draft.age || 0),
          chart_alias: "",
          local_case_code: draft.local_case_code.trim(),
        });
      } catch (nextError) {
        if (!isAlreadyExistsError(nextError)) {
          throw nextError;
        }
      }

      try {
        await createVisit(selectedSiteId, token, visitPayload(nextVisitReference));
        await uploadDraftImagesToVisit(nextVisitReference);
        await finalizeSavedCase(nextVisitReference);
      } catch (nextError) {
        if (!isAlreadyExistsError(nextError)) {
          throw nextError;
        }
        const overwriteConfirmed = window.confirm(
          pick(
            locale,
            `Visit ${patientId} / ${displayVisitReference(locale, nextVisitReference)} already exists.\n\nPress OK to overwrite it.\nPress Cancel to save as another case.`,
            `방문 ${patientId} / ${displayVisitReference(locale, nextVisitReference)}가 이미 존재합니다.\n\n확인을 누르면 덮어쓰고, 취소를 누르면 다른 케이스로 저장합니다.`
          )
        );
        if (overwriteConfirmed) {
          await updateVisit(selectedSiteId, token, patientId, nextVisitReference, visitPayload(nextVisitReference));
          await deleteVisitImages(selectedSiteId, token, patientId, nextVisitReference);
          await uploadDraftImagesToVisit(nextVisitReference);
          await finalizeSavedCase(nextVisitReference);
        } else {
          const alternateVisitReference = await nextAvailableFollowUpReference();
          const saveAlternateConfirmed = window.confirm(
            pick(
              locale,
              `Save this case as ${displayVisitReference(locale, alternateVisitReference)} instead?`,
              `이 케이스를 ${displayVisitReference(locale, alternateVisitReference)}로 저장할까요?`
            )
          );
          if (!saveAlternateConfirmed) {
            return;
          }
          await createVisit(selectedSiteId, token, visitPayload(alternateVisitReference));
          await uploadDraftImagesToVisit(alternateVisitReference);
          await finalizeSavedCase(alternateVisitReference);
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
  const patientListRows = Array.from(
    filteredCases.reduce((groups, caseRecord) => {
      const currentGroup = groups.get(caseRecord.patient_id) ?? [];
      currentGroup.push(caseRecord);
      groups.set(caseRecord.patient_id, currentGroup);
      return groups;
    }, new Map<string, CaseSummaryRecord[]>()).entries()
  )
    .map(([patientId, groupedCases]): PatientListRow => {
      const sortedCases = [...groupedCases].sort((left, right) => caseTimestamp(right) - caseTimestamp(left));
      const latestCase = sortedCases[0];
      return {
        patient_id: patientId,
        latest_case: latestCase,
        case_count: groupedCases.length,
        organism_summary: Array.from(
          new Set(
            sortedCases
              .flatMap((item) => listOrganisms(item.culture_category, item.culture_species, item.additional_organisms))
              .map((organism) => organism.culture_species)
          )
        )
          .slice(0, 3)
          .join(" · "),
        representative_thumbnails: sortedCases
          .filter((item) => item.representative_image_id)
          .slice(0, 3)
          .map((item) => ({
            case_id: item.case_id,
            image_id: item.representative_image_id as string,
            view: item.representative_view,
            preview_url: null,
          })),
      };
    })
    .sort((left, right) => caseTimestamp(right.latest_case) - caseTimestamp(left.latest_case));
  const selectedPatientCases = selectedCase
    ? [...cases]
        .filter((item) => item.patient_id === selectedCase.patient_id)
        .sort((left, right) => caseTimestamp(right) - caseTimestamp(left))
    : [];
  const patientListThumbKey = patientListRows
    .map((row) => `${row.patient_id}:${row.representative_thumbnails.map((item) => item.image_id).join(",")}`)
    .join("|");
  useEffect(() => {
    for (const url of patientListThumbUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    patientListThumbUrlsRef.current = [];
    if (!selectedSiteId || railView !== "patients" || patientListRows.length === 0) {
      setPatientListThumbs({});
      return;
    }
    const currentSiteId = selectedSiteId;
    let cancelled = false;
    const createdUrls: string[] = [];
    async function loadPatientListThumbs() {
      const nextThumbs: Record<string, PatientListThumbnail[]> = {};
      for (const row of patientListRows) {
        nextThumbs[row.patient_id] = [];
        for (const item of row.representative_thumbnails) {
          try {
            const blob = await fetchImageBlob(currentSiteId, item.image_id, token);
            const previewUrl = URL.createObjectURL(blob);
            createdUrls.push(previewUrl);
            nextThumbs[row.patient_id].push({ ...item, preview_url: previewUrl });
          } catch {
            nextThumbs[row.patient_id].push({ ...item, preview_url: null });
          }
        }
      }
      if (!cancelled) {
        patientListThumbUrlsRef.current = createdUrls;
        setPatientListThumbs(nextThumbs);
      } else {
        for (const url of createdUrls) {
          URL.revokeObjectURL(url);
        }
      }
    }
    void loadPatientListThumbs();
    return () => {
      cancelled = true;
      for (const url of createdUrls) {
        URL.revokeObjectURL(url);
      }
    };
  }, [patientListThumbKey, railView, selectedSiteId, token]);
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
  const mainHeaderTitle =
    railView === "patients"
      ? pick(locale, "Patient list", "환자 리스트")
      : pick(locale, "Case Authoring", "증례 작성");
  const mainHeaderCopy =
    railView === "patients"
      ? copy.listViewHeaderCopy
      : copy.caseAuthoringHeaderCopy;

  return (
    <main className="workspace-shell" data-workspace-theme={theme}>
      <div className="workspace-noise" />
      <aside className="workspace-rail">
        <div className="workspace-brand">
          <div className="workspace-brand-copy">
            <div className="workspace-kicker">{pick(locale, "Case Studio", "케이스 스튜디오")}</div>
            <h1>{pick(locale, "K-ERA", "K-ERA")}</h1>
          </div>
          <div className="workspace-brand-actions">
            <button className="ghost-button compact-ghost-button brand-action-button brand-action-primary" type="button" onClick={startNewCaseDraft}>
              {pick(locale, "New case", "신규 케이스")}
            </button>
            <button
              className={`toggle-pill brand-action-button brand-action-secondary ${railView === "patients" ? "active" : ""}`}
              type="button"
              onClick={() => setRailView("patients")}
            >
              {pick(locale, "List view", "리스트")}
            </button>
          </div>
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
                <strong>{item.case_reference_id ?? common.notAvailable}</strong>
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
          <div className="rail-section-head validation-rail-head">
            <span className="rail-label">{pick(locale, "Hospital validation", "병원 검증")}</span>
            <button
              className="ghost-button compact-ghost-button rail-run-button"
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

      </aside>

      <section className="workspace-main">
        <header className="workspace-header">
          <div>
            <div className="workspace-kicker">{pick(locale, "Research document", "연구 문서")}</div>
            <div className="workspace-title-row">
              <h2>{mainHeaderTitle}</h2>
              <span className="workspace-title-copy">{mainHeaderCopy}</span>
            </div>
          </div>
          <div className="workspace-actions">
            <span className="workspace-user-badge">{translateRole(locale, user.role)}</span>
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
              <button className="primary-workspace-button complete-intake-button" type="button" onClick={onLogout}>
                {pick(locale, "Log out", "로그아웃")}
              </button>
          </div>
        </header>

        <div className="workspace-center">
          {railView === "patients" ? (
            <section className="doc-surface">
              <div className="doc-title-row">
                <div className="doc-title-copy">
                  <div className="doc-eyebrow">{pick(locale, "Patient list", "환자 리스트")}</div>
                  <h3>{pick(locale, "Saved patients", "저장 환자 목록")}</h3>
                </div>
                <div className="doc-title-meta">
                  <div className="doc-site-badge">{selectedSiteId ?? pick(locale, "Select a hospital", "병원 선택")}</div>
                  <span className="doc-site-badge">{`${patientListRows.length} ${pick(locale, "patients", "환자")}`}</span>
                </div>
              </div>
              <div className="doc-badge-row">
                <span className="doc-site-badge">
                  {pick(
                    locale,
                    "Each row is one patient. Click a row to load the latest saved case with images and lesion boxes.",
                    "각 행은 환자 1명입니다. 행을 누르면 최신 저장 케이스와 이미지, lesion box를 바로 불러옵니다."
                  )}
                </span>
              </div>
              <section className="doc-section list-board-section">
                <input
                  className="rail-search list-board-search"
                  value={caseSearch}
                  onChange={(event) => setCaseSearch(event.target.value)}
                  placeholder={pick(locale, "Search patient or organism", "환자 또는 균종으로 검색")}
                />
                {casesLoading ? <div className="empty-surface">{copy.loadingSavedCases}</div> : null}
                {!casesLoading && patientListRows.length === 0 ? (
                  <div className="empty-surface">{pick(locale, "No saved patients match this search yet.", "검색 조건에 맞는 저장 환자가 아직 없습니다.")}</div>
                ) : null}
                <div className="list-board-stack">
                  {patientListRows.map((row) => (
                    <button
                      key={`board-${row.patient_id}`}
                      className={`case-list-item patient-list-row board-patient-row ${
                        selectedCase?.patient_id === row.patient_id ? "active" : ""
                      }`}
                      type="button"
                      onClick={() => openSavedCase(row.latest_case, "cases")}
                    >
                      <div className="patient-list-row-main">
                        <div className="patient-list-row-chips">
                          <span className="patient-list-chip strong">{row.latest_case.local_case_code || row.patient_id}</span>
                          <span className="patient-list-chip">{row.patient_id}</span>
                          <span className="patient-list-chip">{`${translateOption(locale, "sex", row.latest_case.sex)} · ${row.latest_case.age ?? common.notAvailable}`}</span>
                          <span className="patient-list-chip">{`${row.case_count} ${pick(locale, "cases", "케이스")}`}</span>
                          <span className="patient-list-chip">{`${translateOption(locale, "cultureCategory", row.latest_case.culture_category)} · ${row.organism_summary}`}</span>
                        </div>
                        <div className="patient-list-row-meta">
                          <span>{displayVisitReference(locale, row.latest_case.visit_date)}</span>
                          {row.latest_case.actual_visit_date ? <span>{row.latest_case.actual_visit_date}</span> : null}
                          <span>{formatDateTime(row.latest_case.latest_image_uploaded_at ?? row.latest_case.created_at, localeTag, common.notAvailable)}</span>
                        </div>
                      </div>
                      <div className="patient-list-thumbnails">
                        {row.representative_thumbnails.length === 0 ? (
                          <span className="patient-list-thumb-empty">{pick(locale, "No thumbnails", "썸네일 없음")}</span>
                        ) : (
                          row.representative_thumbnails.slice(0, 4).map((thumbnail) => {
                            const previewUrl =
                              patientListThumbs[row.patient_id]?.find((item) => item.case_id === thumbnail.case_id)?.preview_url ?? null;
                            return previewUrl ? (
                              <img
                                key={`board-${thumbnail.case_id}`}
                                src={previewUrl}
                                alt={`${row.patient_id}-${thumbnail.case_id}`}
                                className="patient-list-thumb"
                              />
                            ) : (
                              <div key={`board-${thumbnail.case_id}`} className="patient-list-thumb patient-list-thumb-fallback">
                                {translateOption(locale, "view", thumbnail.view ?? "white")}
                              </div>
                            );
                          })
                        )}
                        {row.representative_thumbnails.length > 4 ? (
                          <span className="patient-list-thumb-more">+{row.representative_thumbnails.length - 4}</span>
                        ) : null}
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            </section>
          ) : selectedCase ? (
          <section className="doc-surface">
            <div className="doc-title-row">
              <div className="doc-title-copy">
                <div className="doc-eyebrow">{pick(locale, "Saved case", "저장 케이스")}</div>
                <h3>{formatCaseTitle(selectedCase)}</h3>
              </div>
              <div className="doc-title-meta">
                <div className="doc-site-badge">{selectedSiteId ?? pick(locale, "Select a hospital", "병원 선택")}</div>
                <span className="doc-site-badge">{displayVisitReference(locale, selectedCase.visit_date)}</span>
              </div>
            </div>

            <section className="doc-section intake-summary-card saved-case-summary-card">
              <div className="doc-section-head">
                <div>
                  <div className="doc-section-label">{pick(locale, "Case summary", "케이스 요약")}</div>
                </div>
                <div className="workspace-actions">
                  <button className="ghost-button saved-case-action-button" type="button" onClick={() => void startFollowUpDraftFromSelectedCase()}>
                    {pick(locale, "Add F/U", "재진 추가")}
                  </button>
                  <button
                    className={`ghost-button saved-case-action-button ${isFavoriteCase(selectedCase.case_id) ? "saved-case-action-button-active" : ""}`}
                    type="button"
                    onClick={() => toggleFavoriteCase(selectedCase.case_id)}
                  >
                    {isFavoriteCase(selectedCase.case_id) ? pick(locale, "Favorited", "즐겨찾기됨") : pick(locale, "Favorite", "즐겨찾기")}
                  </button>
                </div>
              </div>
              <div className="intake-summary-grid">
                <div className="intake-summary-block">
                  <div className="intake-summary-inline">
                    <strong>{selectedCase.local_case_code || selectedCase.patient_id}</strong>
                    <p>{`${translateOption(locale, "sex", selectedCase.sex)} · ${selectedCase.age ?? common.notAvailable}`}</p>
                  </div>
                </div>
                <div className="intake-summary-block">
                  <div className="intake-summary-inline">
                    <strong>{displayVisitReference(locale, selectedCase.visit_date)}</strong>
                    <p>{translateOption(locale, "visitStatus", selectedCase.visit_status)}</p>
                  </div>
                </div>
                <div className="intake-summary-block intake-summary-block-wide">
                  <div className="intake-summary-inline intake-summary-inline-organism">
                    <strong>{`${translateOption(locale, "cultureCategory", selectedCase.culture_category)} · ${selectedCase.culture_species}`}</strong>
                    {(selectedCase.additional_organisms?.length ?? 0) > 0 ? (
                      <div className="organism-chip-row">
                        {selectedCase.additional_organisms.map((organism) => (
                          <span key={`saved-summary-${organismKey(organism)}`} className="organism-chip static">
                            {`${translateOption(locale, "cultureCategory", organism.culture_category)} · ${organism.culture_species}`}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>

            <section className="doc-section">
              <div className="doc-section-head">
                <div className="visit-context-headline">
                  <div className="doc-section-label">{pick(locale, "Patient timeline", "환자 전체 방문")}</div>
                  <h4 className="visit-context-hint">
                    {pick(locale, "Review all saved visit images grouped by Initial and follow-ups.", "초진과 재진별로 저장된 이미지를 한 번에 확인합니다.")}
                  </h4>
                </div>
                <span className="doc-site-badge">
                  {patientVisitGalleryBusy
                    ? common.loading
                    : `${selectedPatientCases.length} ${pick(locale, "visits", "방문")}`}
                </span>
              </div>
              {patientVisitGalleryBusy ? <div className="empty-surface">{common.loading}</div> : null}
              {!patientVisitGalleryBusy && selectedPatientCases.length === 0 ? (
                <div className="empty-surface">{pick(locale, "No saved visits are available for this patient yet.", "이 환자에는 아직 저장된 방문이 없습니다.")}</div>
              ) : null}
              {!patientVisitGalleryBusy && selectedPatientCases.length > 0 ? (
                <div className="patient-visit-gallery-stack">
                  {selectedPatientCases.map((caseItem) => {
                    const visitImages = patientVisitGallery[caseItem.case_id] ?? [];
                    return (
                      <section
                        key={`visit-gallery-${caseItem.case_id}`}
                        className={`patient-visit-gallery-card ${selectedCase.case_id === caseItem.case_id ? "active" : ""}`}
                      >
                        <div className="panel-card-head">
                          <strong>{displayVisitReference(locale, caseItem.visit_date)}</strong>
                          <button
                            type="button"
                            className={`toggle-pill compact ${selectedCase.case_id === caseItem.case_id ? "active" : ""}`}
                            onClick={() => openSavedCase(caseItem, "cases")}
                          >
                            {selectedCase.case_id === caseItem.case_id ? pick(locale, "Current visit", "현재 방문") : pick(locale, "Open visit", "방문 열기")}
                          </button>
                        </div>
                        <div className="panel-meta">
                          <span>{formatDateTime(caseItem.latest_image_uploaded_at ?? caseItem.created_at, localeTag, common.notAvailable)}</span>
                          <span>{`${visitImages.length} ${pick(locale, "images", "이미지")}`}</span>
                          <span>{`${translateOption(locale, "cultureCategory", caseItem.culture_category)} · ${organismSummaryLabel(caseItem.culture_category, caseItem.culture_species, caseItem.additional_organisms)}`}</span>
                        </div>
                        {visitImages.length > 0 ? (
                          <div className="patient-visit-image-strip">
                            {visitImages.map((image) => (
                              <div key={`timeline-${image.image_id}`} className="patient-visit-image-card">
                                {image.preview_url ? (
                                  <img src={image.preview_url} alt={image.image_id} className="patient-visit-image-thumb" />
                                ) : (
                                  <div className="patient-visit-image-thumb patient-visit-image-thumb-fallback">
                                    {translateOption(locale, "view", image.view)}
                                  </div>
                                )}
                                <div className="patient-visit-image-meta">
                                  <strong>{translateOption(locale, "view", image.view)}</strong>
                                  <span>{image.is_representative ? pick(locale, "Representative", "대표 이미지") : pick(locale, "Supporting", "보조 이미지")}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="empty-surface">{pick(locale, "No saved images for this visit yet.", "이 방문에는 아직 저장 이미지가 없습니다.")}</div>
                        )}
                      </section>
                    );
                  })}
                </div>
              ) : null}
            </section>

            <section className="doc-section">
              <div className="doc-section-head">
                <div className="visit-context-headline">
                  <div className="doc-section-label">{pick(locale, "Saved images", "저장 이미지")}</div>
                  <h4 className="visit-context-hint">
                    {pick(locale, "Review the uploaded images and edit lesion boxes directly here", "업로드된 이미지를 확인하고 여기서 바로 lesion box를 수정")}</h4>
                </div>
                <span className="doc-site-badge">{panelBusy ? common.loading : `${selectedCaseImages.length} ${pick(locale, "images", "이미지")}`}</span>
              </div>
              <div className="ops-stack saved-case-image-board">
                {selectedCaseImages.map((image) => (
                  <section key={`doc-${image.image_id}`} className="ops-card">
                    {image.preview_url ? (
                      <div
                        className="lesion-editor-surface panel-image-annotation-surface"
                        onPointerDown={(event) => handleLesionPointerDown(image.image_id, event)}
                        onPointerMove={(event) => handleLesionPointerMove(image.image_id, event)}
                        onPointerUp={(event) => finishLesionPointer(image.image_id, event)}
                        onPointerCancel={(event) => finishLesionPointer(image.image_id, event)}
                      >
                        <img
                          src={image.preview_url}
                          alt={image.image_id}
                          className="panel-image-preview lesion-editor-image"
                          draggable={false}
                          onDragStart={(event) => event.preventDefault()}
                        />
                        {lesionPromptDrafts[image.image_id] ? (
                          <div
                            className="lesion-box-overlay"
                            style={{
                              left: `${(lesionPromptDrafts[image.image_id]?.x0 ?? 0) * 100}%`,
                              top: `${(lesionPromptDrafts[image.image_id]?.y0 ?? 0) * 100}%`,
                              width: `${((lesionPromptDrafts[image.image_id]?.x1 ?? 0) - (lesionPromptDrafts[image.image_id]?.x0 ?? 0)) * 100}%`,
                              height: `${((lesionPromptDrafts[image.image_id]?.y1 ?? 0) - (lesionPromptDrafts[image.image_id]?.y0 ?? 0)) * 100}%`,
                            }}
                          />
                        ) : null}
                      </div>
                    ) : (
                      <div className="panel-image-fallback">{pick(locale, "Preview unavailable", "미리보기를 표시할 수 없습니다")}</div>
                    )}
                    <div className="panel-meta panel-image-inline-meta">
                      <strong className="panel-image-inline-label">{translateOption(locale, "view", image.view)}</strong>
                      <span>{image.is_representative ? pick(locale, "Representative", "대표 이미지") : pick(locale, "Supporting image", "보조 이미지")}</span>
                      <span>
                        {lesionBoxBusyImageId === image.image_id
                          ? pick(locale, "Saving box...", "박스 자동 저장 중...")
                          : lesionPromptDrafts[image.image_id]
                          ? JSON.stringify(lesionPromptDrafts[image.image_id] ?? null) !== JSON.stringify(lesionPromptSaved[image.image_id] ?? null)
                            ? pick(locale, "Unsaved box", "미저장 박스")
                            : pick(locale, "Box saved", "박스 저장됨")
                          : pick(locale, "No box", "박스 없음")}
                      </span>
                    </div>
                  </section>
                ))}
              </div>
              {!selectedCaseImages.length && !panelBusy ? (
                <div className="empty-surface">{pick(locale, "No saved images are attached to this case yet.", "이 케이스에는 아직 저장 이미지가 없습니다.")}</div>
              ) : null}
            </section>

            <div className="ops-dual-grid">
              <section className="doc-section">
                <div className="doc-section-head preview-section-head">
                  <div className="preview-section-copy">
                    <div className="doc-section-label">{pick(locale, "Cornea preview", "각막 crop 미리보기")}</div>
                  </div>
                  <button
                    className="ghost-button preview-run-button"
                    type="button"
                    onClick={() => void handleRunRoiPreview()}
                    disabled={roiPreviewBusy || !canRunRoiPreview}
                  >
                    {roiPreviewBusy ? pick(locale, "Preparing...", "준비 중...") : pick(locale, "Preview cornea crop", "각막 crop 미리보기 실행")}
                  </button>
                </div>
                {!canRunRoiPreview ? <p>{pick(locale, "Viewer accounts can inspect images, but cornea preview remains disabled.", "뷰어 계정은 이미지는 볼 수 있지만 각막 crop 미리보기는 실행할 수 없습니다.")}</p> : null}
                {canRunRoiPreview && roiPreviewItems.length === 0 ? (
                  <p>{pick(locale, "Generate a preview to compare the saved source images with their cornea crops.", "저장된 원본 이미지와 각막 crop을 비교하려면 미리보기를 생성하세요.")}</p>
                ) : null}
                {roiPreviewItems.length > 0 ? (
                  <div className="panel-image-stack">
                    {roiPreviewItems.map((item) => (
                      <div key={`${item.image_id ?? item.source_image_path}:roi`} className="panel-image-card">
                        <div className="panel-card-head">
                          <strong>{translateOption(locale, "view", item.view)}</strong>
                          <span>{item.is_representative ? pick(locale, "Representative", "대표 이미지") : pick(locale, "Supporting image", "보조 이미지")}</span>
                        </div>
                        <div className="panel-meta">
                          <span>{`backend: ${item.backend}`}</span>
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
                            {item.medsam_mask_url ? (
                              <MaskOverlayPreview
                                sourceUrl={item.source_preview_url}
                                maskUrl={item.medsam_mask_url}
                                alt={`${item.view} cornea mask overlay`}
                                tint={[231, 211, 111]}
                              />
                            ) : (
                              <div className="panel-image-fallback">{pick(locale, "Cornea mask unavailable", "각막 mask를 표시할 수 없습니다")}</div>
                            )}
                            <div className="panel-image-copy">
                              <strong>{pick(locale, "Cornea mask", "각막 mask")}</strong>
                            </div>
                          </div>
                          <div>
                            {item.roi_crop_url ? (
                              <img src={item.roi_crop_url} alt={`${item.view} cornea crop`} className="panel-image-preview" />
                            ) : (
                              <div className="panel-image-fallback">{pick(locale, "Cornea crop unavailable", "각막 crop을 표시할 수 없습니다")}</div>
                            )}
                            <div className="panel-image-copy">
                              <strong>{pick(locale, "Cornea crop", "각막 crop")}</strong>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>

              <section className="doc-section">
                <div className="doc-section-head preview-section-head">
                  <div className="preview-section-copy">
                    <div className="doc-section-label">{pick(locale, "Lesion preview", "병변 crop 미리보기")}</div>
                  </div>
                  <button
                    className="ghost-button preview-run-button"
                    type="button"
                    onClick={() => void handleRunLesionPreview()}
                    disabled={lesionPreviewBusy || selectedCaseImages.length === 0}
                  >
                    {lesionPreviewBusy ? pick(locale, "Preparing...", "준비 중...") : pick(locale, "Preview lesion crop", "병변 crop 미리보기 실행")}
                  </button>
                </div>
                {!selectedCaseImages.length ? <p>{pick(locale, "Select a saved case with uploaded images before running lesion preview.", "병변 crop 미리보기를 실행하려면 업로드 이미지가 있는 저장된 케이스를 선택하세요.")}</p> : null}
                {selectedCaseImages.length > 0 && lesionPreviewItems.length === 0 ? (
                  <p>
                    {hasAnySavedLesionBox
                      ? pick(locale, "Generate a preview to compare each boxed image with its lesion-centered crop.", "박스가 저장된 각 이미지를 병변 중심 crop과 비교하려면 미리보기를 생성하세요.")
                      : pick(locale, "Save at least one lesion box in the saved images section, then run preview.", "저장 이미지 섹션에서 병변 박스를 하나 이상 저장한 뒤 미리보기를 실행하세요.")}
                  </p>
                ) : null}
                {lesionPreviewItems.length > 0 ? (
                  <div className="panel-image-stack">
                    {lesionPreviewItems.map((item) => (
                      <div key={`${item.image_id ?? item.source_image_path}:lesion`} className="panel-image-card">
                        <div className="panel-card-head">
                          <strong>{translateOption(locale, "view", item.view)}</strong>
                          <span>{item.is_representative ? pick(locale, "Representative", "대표 이미지") : pick(locale, "Supporting image", "보조 이미지")}</span>
                        </div>
                        <div className="panel-meta">
                          <span>{`backend: ${item.backend}`}</span>
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
                            {item.lesion_mask_url ? (
                              <MaskOverlayPreview
                                sourceUrl={item.source_preview_url}
                                maskUrl={item.lesion_mask_url}
                                alt={`${item.view} lesion mask overlay`}
                                tint={[242, 164, 154]}
                              />
                            ) : (
                              <div className="panel-image-fallback">{pick(locale, "Lesion mask unavailable", "병변 mask를 표시할 수 없습니다")}</div>
                            )}
                            <div className="panel-image-copy">
                              <strong>{pick(locale, "Lesion mask", "병변 mask")}</strong>
                            </div>
                          </div>
                          <div>
                            {item.lesion_crop_url ? (
                              <img src={item.lesion_crop_url} alt={`${item.view} lesion crop`} className="panel-image-preview" />
                            ) : (
                              <div className="panel-image-fallback">{pick(locale, "Lesion crop unavailable", "병변 crop을 표시할 수 없습니다")}</div>
                            )}
                            <div className="panel-image-copy">
                              <strong>{pick(locale, "Lesion crop", "병변 crop")}</strong>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>
            </div>
          </section>
          ) : (
          <section className="doc-surface">
            <div className="doc-title-row">
              <div className="doc-title-copy">
                <div className="doc-eyebrow">{pick(locale, "Case Authoring", "증례 작성")}</div>
                <h3>{draft.patient_id.trim() || pick(locale, "Untitled keratitis case", "제목 없는 각막염 케이스")}</h3>
              </div>
              <div className="doc-title-meta">
                <div className="doc-site-badge">{selectedSiteId ?? pick(locale, "Select a hospital", "병원 선택")}</div>
                <span className="doc-site-badge">{draftStatusLabel}</span>
              </div>
            </div>
            {draftImages.length > 0 ? (
              <div className="doc-badge-row">
                <span className="doc-site-badge">{pick(locale, "Unsaved image files stay in this tab only", "저장되지 않은 이미지 파일은 현재 탭에만 유지됩니다")}</span>
              </div>
            ) : null}

            {!draft.intake_completed ? (
              <>
            <section className="doc-section">
              <div className="patient-inline-header">
                <div className="doc-section-label">{pick(locale, "Patient identity", "환자 정보")}</div>
                <label className="patient-inline-item patient-inline-item-id">
                  <strong>{pick(locale, "Patient ID", "환자 ID")}</strong>
                  <input
                    value={draft.patient_id}
                    onChange={(event) => setDraft((current) => ({ ...current, patient_id: event.target.value }))}
                    placeholder="KERA-2026-001"
                  />
                </label>
                <label className="patient-inline-item">
                  <strong>{pick(locale, "Sex", "성별")}</strong>
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
                <label className="patient-inline-item patient-inline-item-age">
                  <strong>{pick(locale, "Age", "나이")}</strong>
                  <input
                    type="number"
                    min={0}
                    value={draft.age}
                    onChange={(event) => setDraft((current) => ({ ...current, age: event.target.value }))}
                  />
                </label>
                <span className="patient-inline-count">{draftImages.length} {pick(locale, "image blocks", "이미지 블록")}</span>
              </div>
            </section>

            <section className="doc-section">
              <div className="doc-section-head">
                <div className="visit-context-headline">
                  <div className="doc-section-label">{pick(locale, "Visit context", "방문 맥락")}</div>
                  <div className="property-hint visit-context-hint">
                    {pick(
                      locale,
                      "Select one or more risk factors below using the toggles.",
                      "아래 위험 인자를 토글로 하나 이상 선택할 수 있습니다."
                    )}
                  </div>
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
                  rows={1}
                  value={draft.other_history}
                  onChange={(event) => setDraft((current) => ({ ...current, other_history: event.target.value }))}
                  placeholder={pick(locale, "Freeform note space for ocular surface context, referral history, or procedural remarks.", "안구 표면 상태, 전원 이력, 시술 관련 메모 등을 자유롭게 적을 수 있습니다.")}
                />
              </label>
            </section>

            <section className="doc-section">
              <div className="organism-inline-header">
                <div className="organism-inline-meta">
                  <div className="doc-section-label">{pick(locale, "Organism", "균종")}</div>
                  <span className="organism-inline-state">
                    {draft.additional_organisms.length > 0
                      ? pick(locale, "Polymicrobial", "다균종")
                      : pick(locale, "Single organism", "단일 균종")}
                  </span>
                </div>
                <label className="organism-inline-item">
                  <strong>{pick(locale, "Category", "분류")}</strong>
                <select
                  value={draft.culture_category}
                  onChange={(event) => {
                    const nextCategory = event.target.value;
                    updatePrimaryOrganism(nextCategory, "");
                  }}
                >
                  <option value="">{pick(locale, "Select category", "분류 선택")}</option>
                  {Object.keys(CULTURE_SPECIES).map((option) => (
                    <option key={option} value={option}>
                      {translateOption(locale, "cultureCategory", option)}
                    </option>
                  ))}
                </select>
                </label>
                <label className="organism-inline-item organism-inline-item-species">
                  <strong>{pick(locale, "Species", "세부 균종")}</strong>
                <select
                  value={draft.culture_species}
                  disabled={!draft.culture_category}
                  onChange={(event) => updatePrimaryOrganism(draft.culture_category, event.target.value)}
                >
                  <option value="">{pick(locale, "Select species", "균종 선택")}</option>
                  {speciesOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                    ))}
                  </select>
                </label>
                <div className="organism-inline-item organism-inline-item-action">
                <strong>{pick(locale, "Additional organisms", "추가 균종")}</strong>
                <button
                  className={`ghost-button ${showAdditionalOrganismForm ? "active" : ""}`}
                  type="button"
                  onClick={() => setShowAdditionalOrganismForm((current) => !current)}
                >
                  {showAdditionalOrganismForm
                    ? pick(locale, "Hide mixed", "다균종 입력 닫기")
                    : pick(locale, "Add mixed", "다균종 입력")}
                </button>
                </div>
              </div>
              <div className="property-hint organism-primary-hint">
                {pick(locale, "This is the primary organism label for the case.", "이 값이 케이스의 주 균종 라벨로 저장됩니다.")}
              </div>
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
            </section>
            {draft.additional_organisms.length > 0 ? (
              <section className="doc-section">
                <div className="doc-section-head">
                  <div>
                    <div className="doc-section-label">{pick(locale, "Organism summary", "균종 요약")}</div>
                  </div>
                  <span>{pick(locale, "Polymicrobial", "다균종")}</span>
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
                  {pick(locale, "This visit will be saved as polymicrobial automatically.", "이 방문은 저장 시 자동으로 다균종으로 처리됩니다.")}
                </div>
              </section>
            ) : null}
            <div className="doc-footer">
              <div />
              <button className="primary-workspace-button complete-intake-button" type="button" onClick={handleCompleteIntake}>
                {pick(locale, "Complete", "완료")}
              </button>
            </div>
              </>
            ) : (
              <>
            <section className="doc-section intake-summary-card">
              <div className="doc-section-head">
                <div>
                  <div className="doc-section-label">{pick(locale, "Core intake", "기본 입력")}</div>
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
                  <div className="intake-summary-inline">
                    <strong>{draft.patient_id.trim() || common.notAvailable}</strong>
                    <p>{`${translateOption(locale, "sex", draft.sex)} · ${draft.age || common.notAvailable}`}</p>
                  </div>
                </div>
                <div className="intake-summary-block">
                  <div className="intake-summary-inline">
                    {draft.contact_lens_use !== "none" ? (
                      <strong>{translateOption(locale, "contactLens", draft.contact_lens_use)}</strong>
                    ) : null}
                    <p>
                      {draft.predisposing_factor.length > 0
                        ? draft.predisposing_factor.map((factor) => translateOption(locale, "predisposing", factor)).join(" · ")
                        : pick(locale, "No predisposing factor selected", "선택된 선행 인자 없음")}
                    </p>
                  </div>
                </div>
                <div className="intake-summary-block intake-summary-block-wide">
                  <div className="intake-summary-inline intake-summary-inline-organism">
                    <strong>{`${translateOption(locale, "cultureCategory", draft.culture_category)} · ${draft.culture_species}`}</strong>
                    {draft.additional_organisms.length > 0 ? (
                      <div className="organism-chip-row">
                        {intakeOrganisms.slice(1).map((organism) => (
                          <span key={`summary-organism-${organismKey(organism)}`} className="organism-chip static">
                            {`${translateOption(locale, "cultureCategory", organism.culture_category)} · ${organism.culture_species}`}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  {draft.other_history.trim() ? <p className="intake-summary-note">{draft.other_history.trim()}</p> : null}
                </div>
              </div>
            </section>

            <section className="doc-section">
              <div className="doc-section-head">
                <div>
                  <div className="doc-section-label">{pick(locale, "Visit timing", "방문 시점")}</div>
                  <h4>{pick(locale, "Choose initial or follow-up, then add the date if needed", "초진/재진 선택 후 필요하면 날짜 입력")}</h4>
                </div>
                <div className="doc-badge-row visit-timing-meta">
                  <span className="doc-site-badge">{pick(locale, "Visit reference", "방문 기준값")} · {resolvedVisitReferenceLabel}</span>
                  <span className="doc-site-badge">{pick(locale, "Calendar date", "실제 날짜")} · {actualVisitDateLabel}</span>
                </div>
              </div>
              <div
                className={`property-grid visit-timing-grid ${!draft.is_initial_visit ? "visit-timing-grid-follow-up" : ""}`}
              >
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
            </section>
              </>
            )}
            {draft.intake_completed ? (
              <>
            <section className="doc-section">
              <div className="doc-section-head">
                <div className="visit-context-headline">
                  <div className="doc-section-label">{pick(locale, "Image board", "이미지 보드")}</div>
                  <h4 className="visit-context-hint">{pick(locale, "Place White (Slit) and Fluorescein images into separate slots", "White (Slit) 뷰와 Fluorescein 뷰를 나눠서 넣기")}</h4>
                </div>
              </div>
              <div className="ops-stack">
                <section className="ops-card">
                  <div className="panel-card-head">
                    <strong>{pick(locale, "White (Slit) view", "White (Slit) 뷰")}</strong>
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
                      <strong>{pick(locale, "Drop White (Slit) photos here", "White (Slit) 사진을 여기로 넣으세요")}</strong>
                      <span>{pick(locale, "These files will be stored as the White view.", "White 뷰로 저장됩니다.")}</span>
                    </div>
                  </div>
                  {whiteDraftImages.length > 0 ? (
                    <div className={`image-grid ${whiteDraftImages.length === 1 ? "single" : ""}`}>
                      {whiteDraftImages.map((image) => (
                        <article key={image.draft_id} className="image-card">
                          <div
                            className="image-preview-frame lesion-editor-surface draft-lesion-surface"
                            onPointerDown={(event) => handleDraftLesionPointerDown(image.draft_id, event)}
                            onPointerMove={(event) => handleDraftLesionPointerMove(image.draft_id, event)}
                            onPointerUp={(event) => finishDraftLesionPointer(image.draft_id, event)}
                            onPointerCancel={(event) => finishDraftLesionPointer(image.draft_id, event)}
                          >
                            <img
                              src={image.preview_url}
                              alt={image.file.name}
                              className="image-preview lesion-editor-image"
                              draggable={false}
                              onDragStart={(event) => event.preventDefault()}
                            />
                            {draftLesionPromptBoxes[image.draft_id] ? (
                              <div
                                className="lesion-box-overlay"
                                style={{
                                  left: `${(draftLesionPromptBoxes[image.draft_id]?.x0 ?? 0) * 100}%`,
                                  top: `${(draftLesionPromptBoxes[image.draft_id]?.y0 ?? 0) * 100}%`,
                                  width: `${((draftLesionPromptBoxes[image.draft_id]?.x1 ?? 0) - (draftLesionPromptBoxes[image.draft_id]?.x0 ?? 0)) * 100}%`,
                                  height: `${((draftLesionPromptBoxes[image.draft_id]?.y1 ?? 0) - (draftLesionPromptBoxes[image.draft_id]?.y0 ?? 0)) * 100}%`,
                                }}
                              />
                            ) : null}
                          </div>
                          <div className="image-card-body">
                            <div className="image-card-head">
                              <strong className="image-card-name" title={image.file.name}>{image.file.name}</strong>
                              <button className="text-button" type="button" onClick={() => removeDraftImage(image.draft_id)}>
                                {pick(locale, "Remove", "제거")}
                              </button>
                            </div>
                            <div className="image-card-controls">
                              <span className="image-card-storage-label">{pick(locale, "Stored as White view", "White 뷰로 저장")}</span>
                              <button
                                className={`toggle-pill ${image.is_representative ? "active" : ""}`}
                                type="button"
                                onClick={() => setRepresentativeImage(image.draft_id)}
                              >
                                {image.is_representative ? pick(locale, "Representative", "대표 이미지") : pick(locale, "Mark representative", "대표 이미지로 지정")}
                              </button>
                            </div>
                            <div className="panel-meta draft-lesion-meta">
                              <span>
                                {draftLesionPromptBoxes[image.draft_id]
                                  ? pick(locale, "Local lesion box ready", "로컬 병변 박스 준비됨")
                                  : pick(locale, "Draw lesion box", "병변 박스 그리기")}
                              </span>
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
                      <strong>{pick(locale, "Drop Fluorescein photos here", "Fluorescein 사진을 여기로 넣으세요")}</strong>
                      <span>{pick(locale, "These files will be stored as the Fluorescein view.", "Fluorescein 뷰로 저장됩니다.")}</span>
                    </div>
                  </div>
                  {fluoresceinDraftImages.length > 0 ? (
                    <div className={`image-grid ${fluoresceinDraftImages.length === 1 ? "single" : ""}`}>
                      {fluoresceinDraftImages.map((image) => (
                        <article key={image.draft_id} className="image-card">
                          <div
                            className="image-preview-frame lesion-editor-surface draft-lesion-surface"
                            onPointerDown={(event) => handleDraftLesionPointerDown(image.draft_id, event)}
                            onPointerMove={(event) => handleDraftLesionPointerMove(image.draft_id, event)}
                            onPointerUp={(event) => finishDraftLesionPointer(image.draft_id, event)}
                            onPointerCancel={(event) => finishDraftLesionPointer(image.draft_id, event)}
                          >
                            <img
                              src={image.preview_url}
                              alt={image.file.name}
                              className="image-preview lesion-editor-image"
                              draggable={false}
                              onDragStart={(event) => event.preventDefault()}
                            />
                            {draftLesionPromptBoxes[image.draft_id] ? (
                              <div
                                className="lesion-box-overlay"
                                style={{
                                  left: `${(draftLesionPromptBoxes[image.draft_id]?.x0 ?? 0) * 100}%`,
                                  top: `${(draftLesionPromptBoxes[image.draft_id]?.y0 ?? 0) * 100}%`,
                                  width: `${((draftLesionPromptBoxes[image.draft_id]?.x1 ?? 0) - (draftLesionPromptBoxes[image.draft_id]?.x0 ?? 0)) * 100}%`,
                                  height: `${((draftLesionPromptBoxes[image.draft_id]?.y1 ?? 0) - (draftLesionPromptBoxes[image.draft_id]?.y0 ?? 0)) * 100}%`,
                                }}
                              />
                            ) : null}
                          </div>
                          <div className="image-card-body">
                            <div className="image-card-head">
                              <strong className="image-card-name" title={image.file.name}>{image.file.name}</strong>
                              <button className="text-button" type="button" onClick={() => removeDraftImage(image.draft_id)}>
                                {pick(locale, "Remove", "제거")}
                              </button>
                            </div>
                            <div className="image-card-controls">
                              <span className="image-card-storage-label">{pick(locale, "Stored as Fluorescein view", "Fluorescein 뷰로 저장")}</span>
                              <button
                                className={`toggle-pill ${image.is_representative ? "active" : ""}`}
                                type="button"
                                onClick={() => setRepresentativeImage(image.draft_id)}
                              >
                                {image.is_representative ? pick(locale, "Representative", "대표 이미지") : pick(locale, "Mark representative", "대표 이미지로 지정")}
                              </button>
                            </div>
                            <div className="panel-meta draft-lesion-meta">
                              <span>
                                {draftLesionPromptBoxes[image.draft_id]
                                  ? pick(locale, "Local lesion box ready", "로컬 병변 박스 준비됨")
                                  : pick(locale, "Draw lesion box", "병변 박스 그리기")}
                              </span>
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
          )}

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
                  <div className="panel-card-head validation-panel-head">
                    <strong className="validation-panel-title">{pick(locale, "Validation insight", "검증 인사이트")}</strong>
                    <div className="validation-panel-actions">
                      <span className="validation-panel-id">
                        {validationResult ? validationResult.summary.validation_id : pick(locale, "Not run yet", "아직 실행되지 않음")}
                      </span>
                      <button
                        type="button"
                        className="ghost-button compact-ghost-button validation-run-button"
                        onClick={() => void handleRunValidation()}
                        disabled={validationBusy || !selectedCase || !canRunValidation}
                      >
                        {validationBusy ? pick(locale, "Validating...", "검증 중...") : pick(locale, "Run AI validation", "AI 검증 실행")}
                      </button>
                    </div>
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
                        {validationResult.model_version.crop_mode
                          ? pick(locale, `mode ${validationResult.model_version.crop_mode}`, `모드 ${validationResult.model_version.crop_mode}`)
                          : null}
                        {validationResult.model_version.crop_mode ? " · " : ""}
                        {validationResult.summary.is_correct
                          ? pick(locale, "prediction matched culture", "예측이 배양 결과와 일치합니다")
                          : pick(locale, "prediction diverged from culture", "예측이 배양 결과와 다릅니다")}
                      </p>
                      <div className="panel-image-stack">
                        {validationArtifacts.roi_crop ? (
                          <div className="panel-image-card">
                            <img src={validationArtifacts.roi_crop} alt={pick(locale, "Cornea crop", "각막 crop")} className="panel-image-preview" />
                            <div className="panel-image-copy">
                              <strong>{pick(locale, "Cornea crop", "각막 crop")}</strong>
                              <span>{pick(locale, "Cornea-focused crop", "각막 중심 crop")}</span>
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
                            <MaskOverlayPreview
                              sourceUrl={representativeSavedImage?.preview_url}
                              maskUrl={validationArtifacts.medsam_mask}
                              alt={pick(locale, "Cornea mask overlay", "각막 mask 오버레이")}
                              tint={[231, 211, 111]}
                            />
                            <div className="panel-image-copy">
                              <strong>{pick(locale, "Cornea mask", "각막 mask")}</strong>
                              <span>{pick(locale, "Cornea segmentation", "각막 분할")}</span>
                            </div>
                          </div>
                        ) : null}
                        {validationArtifacts.lesion_crop ? (
                          <div className="panel-image-card">
                            <img src={validationArtifacts.lesion_crop} alt={pick(locale, "Lesion crop", "병변 crop")} className="panel-image-preview" />
                            <div className="panel-image-copy">
                              <strong>{pick(locale, "Lesion crop", "병변 crop")}</strong>
                              <span>{pick(locale, "Lesion-centered crop", "병변 중심 crop")}</span>
                            </div>
                          </div>
                        ) : null}
                        {validationArtifacts.lesion_mask ? (
                          <div className="panel-image-card">
                            <MaskOverlayPreview
                              sourceUrl={representativeSavedImage?.preview_url}
                              maskUrl={validationArtifacts.lesion_mask}
                              alt={pick(locale, "Lesion mask overlay", "병변 mask 오버레이")}
                              tint={[242, 164, 154]}
                            />
                            <div className="panel-image-copy">
                              <strong>{pick(locale, "Lesion mask", "병변 mask")}</strong>
                              <span>{pick(locale, "Lesion segmentation", "병변 분할")}</span>
                            </div>
                          </div>
                        ) : null}
                        {!validationArtifacts.roi_crop &&
                        !validationArtifacts.gradcam &&
                        !validationArtifacts.medsam_mask &&
                        !validationArtifacts.lesion_crop &&
                        !validationArtifacts.lesion_mask ? (
                          <div className="panel-image-fallback">{pick(locale, "No validation artifacts were produced for this run.", "이 실행에서는 검증 아티팩트가 생성되지 않았습니다.")}</div>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <p>{pick(locale, "Run validation from this panel to generate crop artifacts, Grad-CAM, and a saved case-level prediction.", "이 패널에서 검증을 실행하면 crop 아티팩트, Grad-CAM, 케이스 단위 예측을 생성할 수 있습니다.")}</p>
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

function caseTimestamp(caseRecord: CaseSummaryRecord): number {
  const rawValue = caseRecord.latest_image_uploaded_at ?? caseRecord.created_at ?? "";
  const parsed = new Date(rawValue);
  if (Number.isNaN(parsed.getTime())) {
    return 0;
  }
  return parsed.getTime();
}

function visitTimestamp(visitRecord: VisitRecord): number {
  const parsed = new Date(visitRecord.created_at ?? "");
  if (Number.isNaN(parsed.getTime())) {
    return 0;
  }
  return parsed.getTime();
}
