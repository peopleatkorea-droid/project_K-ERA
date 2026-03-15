"use client";

import { type PointerEvent as ReactPointerEvent, useDeferredValue, useEffect, useRef, useState } from "react";

import { LocaleToggle, pick, translateApiError, translateOption, translateRole, useI18n, type Locale } from "../lib/i18n";
import { AiClinicPanel } from "./case-workspace/ai-clinic-panel";
import { AiClinicResult } from "./case-workspace/ai-clinic-result";
import { CompletionCard } from "./case-workspace/completion-card";
import { ContributionHistoryPanel } from "./case-workspace/contribution-history-panel";
import { ImageManagerPanel } from "./case-workspace/image-manager-panel";
import { PatientVisitForm } from "./case-workspace/patient-visit-form";
import { ValidationArtifactStack } from "./case-workspace/validation-artifact-stack";
import { ValidationPanel } from "./case-workspace/validation-panel";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { MetricGrid, MetricItem } from "./ui/metric-grid";
import { SectionHeader } from "./ui/section-header";
import {
  docBadgeRowClass,
  docEyebrowClass,
  docSectionClass,
  docSectionHeadClass,
  docSectionLabelClass,
  docSiteBadgeClass,
  docSurfaceClass,
  docTitleMetaClass,
  docTitleRowClass,
  emptySurfaceClass,
  momentumFillClass,
  momentumTrackClass,
  panelImageCardClass,
  panelImageCopyClass,
  panelImageFallbackClass,
  panelImagePreviewClass,
  panelImageStackClass,
  panelMetricGridClass,
  panelPreviewGridClass,
  panelStackClass,
  previewRunButtonClass,
  previewSectionActionsClass,
  previewSectionHeadClass,
  railActivityItemClass,
  railActivityListClass,
  railCopyClass,
  railLabelClass,
  railMetricGridClass,
  railRunButtonClass,
  railSectionClass,
  railSectionHeadClass,
  railSiteButtonClass,
  railSiteListClass,
  researchLaunchActionsClass,
  researchLaunchCopyClass,
  researchLaunchStripClass,
  togglePillClass,
  completeIntakeButtonClass,
  intakeSummaryMetricCardClass,
  lesionBoxOverlayClass,
  lesionEditorImageClass,
  lesionEditorSurfaceClass,
  summaryNoteClass,
  visitContextSelectClass,
  listBoardSearchClass,
  listBoardStackClass,
  liveCropCanvasClass,
  liveCropCardClass,
  liveCropFallbackClass,
  liveCropPreviewSectionClass,
  liveCropToggleClass,
  organismChipClass,
  organismChipRowClass,
  organismChipStaticClass,
  panelImageAnnotationActionsClass,
  panelImageAnnotationSurfaceClass,
  panelImageOverlayClass,
  panelImageOverlayFallbackClass,
  patientListChipClass,
  patientListRowChipsClass,
  patientListRowClass,
  patientListRowMainClass,
  patientListRowMetaClass,
  patientListThumbClass,
  patientListThumbEmptyClass,
  patientListThumbMoreClass,
  patientListThumbnailsClass,
  patientVisitGalleryCardClass,
  patientVisitGalleryStackClass,
  patientVisitImageCardClass,
  patientVisitImageMetaClass,
  patientVisitImageStripClass,
  patientVisitImageThumbClass,
  previewItemMetricGridClass,
  savedCaseActionButtonClass,
  savedCaseImageBoardClass,
  savedCaseImageToolbarClass,
  savedCaseImageToolbarCopyClass,
  savedImageActionBarClass,
  savedImageMetricGridClass,
  segmentedToggleClass,
  selectedCaseChipClass,
  selectedCaseChipStripClass,
  semanticPromptCopyClass,
  semanticPromptGridClass,
  semanticPromptLayerClass,
  semanticPromptLayerHeadClass,
  semanticPromptMatchClass,
  semanticPromptMatchListClass,
  semanticPromptRankClass,
  semanticPromptReviewClass,
  semanticPromptReviewHeadClass,
  semanticPromptScoreClass,
  workspaceUserBadgeClass,
  validationRailHeadClass,
  workspaceBrandActionsClass,
  workspaceBrandClass,
  workspaceBrandCopyClass,
  workspaceCenterClass,
  workspaceHeaderClass,
  workspaceKickerClass,
  workspaceMainClass,
  workspaceNoiseClass,
  workspacePanelClass,
  workspaceRailClass,
  workspaceShellClass,
  workspaceTitleCopyClass,
  workspaceTitleRowClass,
  workspaceToastClass,
} from "./ui/workspace-patterns";
import {
  type AiClinicResponse,
  type AiClinicSimilarCaseRecord,
  type CaseHistoryResponse,
  type CaseValidationCompareResponse,
  type CaseContributionResponse,
  type LesionPreviewRecord,
  type OrganismRecord,
  type RoiPreviewRecord,
  type SiteActivityResponse,
  type SiteValidationRunRecord,
  createPatient,
  createVisit,
  deleteVisit,
  deleteVisitImages,
  fetchCaseHistory,
  fetchCaseLesionPreview,
  fetchCaseLesionPreviewArtifactBlob,
  fetchCaseRoiPreview,
  fetchCaseRoiPreviewArtifactBlob,
  clearImageLesionBox,
  fetchCases,
  fetchImageBlob,
  fetchLiveLesionPreviewJob,
  fetchImageSemanticPromptScores,
  fetchVisits,
  fetchValidationArtifactBlob,
  fetchImages,
  fetchSiteJob,
  fetchSiteActivity,
  fetchSiteModelVersions,
  fetchSiteValidations,
  type AuthUser,
  type CaseSummaryRecord,
  type CaseValidationResponse,
  type ImageRecord,
  type LiveLesionPreviewJobResponse,
  type ModelVersionRecord,
  type SemanticPromptInputMode,
  type SemanticPromptReviewResponse,
  type SiteRecord,
  type SiteSummary,
  type VisitRecord,
  runSiteValidation,
  setRepresentativeImage as setRepresentativeImageOnServer,
  startLiveLesionPreview,
  updateVisit,
  runCaseAiClinic,
  runCaseContribution,
  runCaseValidation,
  runCaseValidationCompare,
  updateImageLesionBox,
  uploadImage,
} from "../lib/api";

const SEX_OPTIONS = ["male", "female", "unknown"];
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
const MODEL_COMPARE_ARCHITECTURES = ["vit", "swin", "convnext_tiny", "densenet121", "efficientnet_v2_s"];
const CULTURE_SPECIES: Record<string, string[]> = {
  bacterial: [
    "Staphylococcus aureus",
    "Staphylococcus epidermidis",
    "Staphylococcus hominis",
    "Coagulase-negative Staphylococcus",
    "Streptococcus pneumoniae",
    "Streptococcus viridans group",
    "Enterococcus faecalis",
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

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

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
type SemanticPromptReviewMap = Record<string, SemanticPromptReviewResponse>;
type SemanticPromptErrorMap = Record<string, string>;
type SemanticPromptInputOption = {
  value: SemanticPromptInputMode;
  label: string;
};
type LiveLesionPreviewState = {
  job_id: string | null;
  status: "idle" | "running" | "done" | "failed";
  error: string | null;
  backend: string | null;
  prompt_signature: string | null;
  lesion_mask_url: string | null;
  lesion_crop_url: string | null;
};
type LiveLesionPreviewMap = Record<string, LiveLesionPreviewState>;

type ValidationArtifactKind = "gradcam" | "roi_crop" | "medsam_mask" | "lesion_crop" | "lesion_mask";

type ValidationArtifactPreviews = Partial<Record<ValidationArtifactKind, string | null>>;

type AiClinicSimilarCasePreview = AiClinicSimilarCaseRecord & {
  preview_url: string | null;
};

type AiClinicPreviewResponse = Omit<AiClinicResponse, "similar_cases"> & {
  similar_cases: AiClinicSimilarCasePreview[];
};

function LiveCropPreview({
  sourceUrl,
  box,
  alt,
}: {
  sourceUrl: string | null | undefined;
  box: NormalizedBox | null | undefined;
  alt: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [previewReady, setPreviewReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function renderPreview() {
      if (!canvasRef.current || !sourceUrl || !box) {
        setPreviewReady(false);
        return;
      }

      try {
        const sourceImage = await loadHtmlImage(sourceUrl);
        if (cancelled || !canvasRef.current) {
          return;
        }

        const cropWidth = Math.max(1, Math.round((box.x1 - box.x0) * (sourceImage.naturalWidth || sourceImage.width)));
        const cropHeight = Math.max(1, Math.round((box.y1 - box.y0) * (sourceImage.naturalHeight || sourceImage.height)));
        const cropX = Math.max(0, Math.round(box.x0 * (sourceImage.naturalWidth || sourceImage.width)));
        const cropY = Math.max(0, Math.round(box.y0 * (sourceImage.naturalHeight || sourceImage.height)));
        const scale = Math.min(1, 480 / Math.max(cropWidth, cropHeight));

        const canvas = canvasRef.current;
        canvas.width = Math.max(1, Math.round(cropWidth * scale));
        canvas.height = Math.max(1, Math.round(cropHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) {
          setPreviewReady(false);
          return;
        }

        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(sourceImage, cropX, cropY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
        setPreviewReady(true);
      } catch {
        if (!cancelled) {
          setPreviewReady(false);
        }
      }
    }

    void renderPreview();
    return () => {
      cancelled = true;
    };
  }, [box, sourceUrl]);

  if (!sourceUrl || !box) {
    return <div className={panelImageFallbackClass}>{alt}</div>;
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        className={liveCropCanvasClass(previewReady)}
        aria-label={alt}
      />
      {!previewReady ? <img src={sourceUrl} alt={alt} className={liveCropFallbackClass(previewReady)} /> : null}
    </>
  );
}

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
  onOpenOperations: (section?: "dashboard" | "training" | "cross_validation") => void;
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
    return <div className={panelImageFallbackClass}>{alt}</div>;
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        className={panelImageOverlayClass(overlayReady)}
        aria-label={alt}
      />
      {!overlayReady ? <img src={sourceUrl} alt={alt} className={panelImageOverlayFallbackClass(overlayReady)} /> : null}
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
  additionalOrganisms: OrganismRecord[] | undefined,
  maxVisibleSpecies = 1
): string {
  const organisms = listOrganisms(cultureCategory, cultureSpecies, additionalOrganisms);
  if (!organisms.length) {
    return "";
  }
  if (organisms.length <= maxVisibleSpecies) {
    return organisms.map((organism) => organism.culture_species).join(" 쨌 ");
  }
  const visible = organisms.slice(0, Math.max(1, maxVisibleSpecies)).map((organism) => organism.culture_species).join(" 쨌 ");
  return `${visible} + ${organisms.length - Math.max(1, maxVisibleSpecies)}`;
}

function organismDetailLabel(
  cultureCategory: string,
  cultureSpecies: string,
  additionalOrganisms: OrganismRecord[] | undefined
): string {
  return listOrganisms(cultureCategory, cultureSpecies, additionalOrganisms)
    .map((organism) => organism.culture_species)
    .join(" 쨌 ");
}

function formatProbability(value: number | null | undefined, emptyLabel = "n/a"): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return emptyLabel;
  }
  return `${Math.round(value * 100)}%`;
}

function formatSemanticScore(value: number | null | undefined, emptyLabel = "n/a"): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return emptyLabel;
  }
  return value.toFixed(3);
}

function formatImageQualityScore(value: number | null | undefined, emptyLabel = "n/a"): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return emptyLabel;
  }
  return `${value.toFixed(1)}`;
}

function formatAiClinicMetadataField(locale: Locale, field: string): string {
  switch (field) {
    case "representative_view":
      return pick(locale, "view", "view");
    case "visit_status":
      return pick(locale, "status", "status");
    case "active_stage":
      return pick(locale, "active stage", "active stage");
    case "contact_lens_use":
      return pick(locale, "contact lens", "contact lens");
    case "predisposing_factor":
      return pick(locale, "predisposing", "predisposing");
    case "smear_result":
      return pick(locale, "smear", "smear");
    case "polymicrobial":
      return pick(locale, "polymicrobial", "polymicrobial");
    default:
      return field.replaceAll("_", " ");
  }
}

function defaultModelCompareSelection(modelVersions: ModelVersionRecord[]): string[] {
  const selected: string[] = [];
  const sorted = [...modelVersions].reverse();
  for (const architecture of MODEL_COMPARE_ARCHITECTURES) {
    const match = sorted.find(
      (item) => item.ready !== false && String(item.architecture || "").trim().toLowerCase() === architecture
    );
    if (match?.version_id) {
      selected.push(match.version_id);
    }
  }
  return Array.from(new Set(selected));
}

function predictedClassConfidence(predictedLabel: string | null | undefined, probability: number | null | undefined): number | null {
  if (typeof probability !== "number" || Number.isNaN(probability)) {
    return null;
  }
  if (predictedLabel === "bacterial") {
    return 1 - probability;
  }
  return probability;
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
  if (/^(initial|珥덉쭊)$/i.test(normalized)) {
    return pick(locale, "Initial", "珥덉쭊");
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
  if (/^(initial|珥덉쭊)$/i.test(visitReference)) {
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
  return isInitialVisit ? pick(locale, "Initial", "珥덉쭊") : pick(locale, "Follow-up", "?ъ쭊");
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
      rawMessage.includes("?대? 議댁옱") ||
      translatedMessage.includes("already exists") ||
      translatedMessage.includes("?대? 議댁옱")
    );
  };
  const [draft, setDraft] = useState<DraftState>(() => createDraft());
  const [pendingOrganism, setPendingOrganism] = useState<OrganismRecord>({
    culture_category: "bacterial",
    culture_species: CULTURE_SPECIES.bacterial[0],
  });
  const [showAdditionalOrganismForm, setShowAdditionalOrganismForm] = useState(false);
  const [draftImages, setDraftImages] = useState<DraftImage[]>([]);
  const [cases, setCases] = useState<CaseSummaryRecord[]>([]);
  const [casesLoading, setCasesLoading] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [editDraftBusy, setEditDraftBusy] = useState(false);
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
  const [siteModelVersions, setSiteModelVersions] = useState<ModelVersionRecord[]>([]);
  const [modelCompareBusy, setModelCompareBusy] = useState(false);
  const [modelCompareResult, setModelCompareResult] = useState<CaseValidationCompareResponse | null>(null);
  const [selectedCompareModelVersionIds, setSelectedCompareModelVersionIds] = useState<string[]>([]);
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
  const [draftLesionPromptBoxes, setDraftLesionPromptBoxes] = useState<LesionBoxMap>({});
  const [lesionBoxBusyImageId, setLesionBoxBusyImageId] = useState<string | null>(null);
  const [representativeBusyImageId, setRepresentativeBusyImageId] = useState<string | null>(null);
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
  const aiClinicPreviewUrlsRef = useRef<string[]>([]);
  const roiPreviewUrlsRef = useRef<string[]>([]);
  const lesionPreviewUrlsRef = useRef<string[]>([]);
  const liveLesionPreviewUrlsRef = useRef<Record<string, string[]>>({});
  const liveLesionPreviewRequestRef = useRef<Record<string, number>>({});
  const patientListThumbUrlsRef = useRef<string[]>([]);
  const patientVisitGalleryUrlsRef = useRef<string[]>([]);
  const railListSectionRef = useRef<HTMLElement | null>(null);
  const lesionDrawStateRef = useRef<{ imageId: string; pointerId: number; x: number; y: number } | null>(null);
  const draftLesionDrawStateRef = useRef<{ imageId: string; pointerId: number; x: number; y: number } | null>(null);
  const deferredSearch = useDeferredValue(caseSearch);
  const copy = {
    recoveredDraft: pick(locale, "Recovered the last saved draft properties for this hospital. Re-attach image files before saving.", "??蹂묒썝??留덉?留?珥덉븞 ?띿꽦??蹂듦뎄?덉뒿?덈떎. ??????대?吏 ?뚯씪? ?ㅼ떆 泥⑤???二쇱꽭??"),
    unableLoadRecentCases: pick(locale, "Unable to load recent cases.", "理쒓렐 耳?댁뒪瑜?遺덈윭?ㅼ? 紐삵뻽?듬땲??"),
    unableLoadSiteActivity: pick(locale, "Unable to load hospital activity.", "蹂묒썝 ?쒕룞??遺덈윭?ㅼ? 紐삵뻽?듬땲??"),
    unableLoadSiteValidationHistory: pick(locale, "Unable to load hospital validation history.", "蹂묒썝 寃利??대젰??遺덈윭?ㅼ? 紐삵뻽?듬땲??"),
    unableLoadCaseHistory: pick(locale, "Unable to load case history.", "耳?댁뒪 ?대젰??遺덈윭?ㅼ? 紐삵뻽?듬땲??"),
    selectSavedCaseForRoi: pick(locale, "Select a saved case before running cornea preview.", "媛곷쭑 crop 誘몃━蹂닿린瑜??ㅽ뻾?섎젮硫???λ맂 耳?댁뒪瑜??좏깮?섏꽭??"),
    roiPreviewGenerated: (patientId: string, visitDate: string) =>
      pick(locale, `Cornea preview generated for ${patientId} / ${visitDate}.`, `${patientId} / ${visitDate} 媛곷쭑 crop 誘몃━蹂닿린瑜??앹꽦?덉뒿?덈떎.`),
    roiPreviewFailed: pick(locale, "Cornea preview failed.", "媛곷쭑 crop 誘몃━蹂닿린???ㅽ뙣?덉뒿?덈떎."),
    selectSiteForValidation: pick(locale, "Select a hospital before running hospital validation.", "蹂묒썝 寃利앹쓣 ?ㅽ뻾?섎젮硫?蹂묒썝???좏깮?섏꽭??"),
    siteValidationSaved: (validationId: string) =>
      pick(locale, `Hospital validation saved as ${validationId}.`, `蹂묒썝 寃利앹씠 ${validationId}濡???λ릺?덉뒿?덈떎.`),
    siteValidationFailed: pick(locale, "Hospital validation failed.", "蹂묒썝 寃利앹뿉 ?ㅽ뙣?덉뒿?덈떎."),
    selectSavedCaseForValidation: pick(locale, "Select a saved case before running validation.", "寃利앹쓣 ?ㅽ뻾?섎젮硫???λ맂 耳?댁뒪瑜??좏깮?섏꽭??"),
    validationSaved: (patientId: string, visitDate: string) =>
      pick(locale, `Validation saved for ${patientId} / ${visitDate}.`, `${patientId} / ${visitDate} 寃利앹씠 ??λ릺?덉뒿?덈떎.`),
    validationFailed: pick(locale, "Validation failed.", "寃利앹뿉 ?ㅽ뙣?덉뒿?덈떎."),
    selectValidationBeforeAiClinic: pick(locale, "Run validation before opening AI Clinic retrieval.", "AI Clinic 寃?됱쓣 ?닿린 ?꾩뿉 癒쇱? 寃利앹쓣 ?ㅽ뻾?섏꽭??"),
    aiClinicReady: (count: number) =>
      pick(locale, `AI Clinic found ${count} similar patient case(s).`, `AI Clinic???좎궗 ?섏옄 耳?댁뒪 ${count}嫄댁쓣 李얠븯?듬땲??`),
    aiClinicFailed: pick(locale, "AI Clinic retrieval failed.", "AI Clinic 寃?됱뿉 ?ㅽ뙣?덉뒿?덈떎."),
    aiClinicTextUnavailable: pick(locale, "BiomedCLIP text retrieval is currently unavailable in this runtime.", "?꾩옱 ?ㅽ뻾 ?섍꼍?먯꽌??BiomedCLIP ?띿뒪??寃?됱쓣 ?ъ슜?????놁뒿?덈떎."),
    selectSavedCaseForContribution: pick(locale, "Select a saved case before contributing.", "湲곗뿬瑜??ㅽ뻾?섎젮硫???λ맂 耳?댁뒪瑜??좏깮?섏꽭??"),
    activeOnly: pick(locale, "Only active visits are enabled for contribution under the current policy.", "?꾩옱 ?뺤콉?먯꽌??active 諛⑸Ц留?湲곗뿬?????덉뒿?덈떎."),
    contributionQueued: (patientId: string, visitDate: string) =>
      pick(locale, `Contribution queued for ${patientId} / ${visitDate}.`, `${patientId} / ${visitDate} 湲곗뿬媛 ?湲곗뿴???깅줉?섏뿀?듬땲??`),
    contributionFailed: pick(locale, "Contribution failed.", "湲곗뿬???ㅽ뙣?덉뒿?덈떎."),
    selectSiteForCase: pick(locale, "Select a hospital before creating a case.", "耳?댁뒪瑜??앹꽦?섎젮硫?蹂묒썝???좏깮?섏꽭??"),
    patientIdRequired: pick(locale, "Patient ID is required.", "?섏옄 ID???꾩닔?낅땲??"),
    visitDateRequired: pick(locale, "Visit reference is required.", "諛⑸Ц 湲곗?媛믪? ?꾩닔?낅땲??"),
    cultureSpeciesRequired: pick(locale, "Select the primary organism.", "???洹좎쥌???좏깮?섏꽭??"),
    imageRequired: pick(locale, "Add at least one slit-lamp image to save this case.", "耳?댁뒪瑜???ν븯?ㅻ㈃ ?멸레???대?吏瑜??섎굹 ?댁긽 異붽??섏꽭??"),
    patientCreationFailed: pick(locale, "Patient creation failed.", "?섏옄 ?앹꽦???ㅽ뙣?덉뒿?덈떎."),
    caseSaved: (patientId: string, visitDate: string, siteId: string) =>
      pick(locale, `Case ${patientId} / ${visitDate} saved to hospital ${siteId}.`, `${patientId} / ${visitDate} 耳?댁뒪媛 蹂묒썝 ${siteId}????λ릺?덉뒿?덈떎.`),
    caseSaveFailed: pick(locale, "Case save failed.", "耳?댁뒪 ??μ뿉 ?ㅽ뙣?덉뒿?덈떎."),
    organismAdded: pick(locale, "Organism added to this visit.", "??諛⑸Ц??洹좎쥌??異붽??덉뒿?덈떎."),
    organismDuplicate: pick(locale, "That organism is already attached to this visit.", "?대? ??諛⑸Ц??異붽???洹좎쥌?낅땲??"),
    intakeComplete: pick(locale, "Core case intake is marked complete.", "湲곕낯 耳?댁뒪 ?낅젰???꾨즺濡??쒖떆?덉뒿?덈떎."),
    intakeStepRequired: pick(locale, "Complete the intake section before saving this case.", "케이스 저장 전에 intake 섹션을 먼저 완료해 주세요."),
    intakeOrganismRequired: pick(locale, "Select the primary organism first.", "먼저 대표 균종을 선택해 주세요."),
    draftAutosaved: (time: string) => pick(locale, `Draft autosaved ${time}`, `${time}에 초안 자동 저장`),
    draftUnsaved: pick(locale, "Draft changes live only in this tab", "초안 변경 내용은 현재 탭에만 유지됩니다."),
    patients: pick(locale, "patients", "?섏옄"),
    savedCases: pick(locale, "saved cases", "??λ맂 耳?댁뒪"),
    loadingSavedCases: pick(locale, "Loading saved cases...", "??λ맂 耳?댁뒪瑜?遺덈윭?ㅻ뒗 以?.."),
    noSavedCases: pick(locale, "No saved cases for this hospital yet.", "??蹂묒썝?먮뒗 ?꾩쭅 ??λ맂 耳?댁뒪媛 ?놁뒿?덈떎."),
    allRecords: pick(locale, "All records", "?꾩껜"),
    myPatientsOnly: pick(locale, "My patients", "???섏옄"),
    patientScopeAll: (count: number) =>
      pick(locale, `Showing all hospital patients (${count}).`, `蹂묒썝 ?꾩껜 ?섏옄 ${count}紐낆쓣 ?쒖떆?⑸땲??`),
    patientScopeMine: (count: number) =>
      pick(locale, `Showing only patients registered by you (${count}).`, `?닿? ?깅줉???섏옄 ${count}紐낅쭔 ?쒖떆?⑸땲??`),
    favoriteAdded: pick(locale, "Case added to favorites.", "耳?댁뒪瑜?利먭꺼李얘린??異붽??덉뒿?덈떎."),
    favoriteRemoved: pick(locale, "Case removed from favorites.", "耳?댁뒪 利먭꺼李얘린瑜??댁젣?덉뒿?덈떎."),
    visitDeleted: (patientId: string, visitDate: string) =>
      pick(locale, `Deleted ${patientId} / ${visitDate}.`, `${patientId} / ${visitDate} 諛⑸Ц????젣?덉뒿?덈떎.`),
    patientDeleted: (patientId: string) =>
      pick(locale, `Deleted patient ${patientId}.`, `${patientId} ?섏옄瑜???젣?덉뒿?덈떎.`),
    deleteVisitFailed: pick(locale, "Unable to delete the visit.", "諛⑸Ц ??젣???ㅽ뙣?덉뒿?덈떎."),
    representativeUpdated: pick(locale, "Representative image updated.", "????대?吏瑜?蹂寃쏀뻽?듬땲??"),
    representativeUpdateFailed: pick(locale, "Unable to update the representative image.", "????대?吏 蹂寃쎌뿉 ?ㅽ뙣?덉뒿?덈떎."),
    listViewHeaderCopy: pick(locale, "Browse saved patients and open the latest case.", "????섏옄瑜?蹂닿퀬 理쒖떊 耳?댁뒪瑜??쎈땲??"),
    caseAuthoringHeaderCopy: pick(locale, "Create, review, and contribute cases from this workspace.", "???묒뾽怨듦컙?먯꽌 利앸? ?묒꽦, 寃?? 湲곗뿬瑜?吏꾪뻾?????덉뒿?덈떎."),
  };
  const semanticPromptInputOptions: SemanticPromptInputOption[] = [
    { value: "source", label: pick(locale, "Whole image", "?먮낯 ?대?吏") },
    { value: "roi_crop", label: pick(locale, "Cornea crop", "媛곷쭑 crop") },
    { value: "lesion_crop", label: pick(locale, "Lesion crop", "蹂묐? crop") },
  ];
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
      for (const url of aiClinicPreviewUrlsRef.current) {
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
    return () => {
      for (const urls of Object.values(liveLesionPreviewUrlsRef.current)) {
        for (const url of urls) {
          URL.revokeObjectURL(url);
        }
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
    setSemanticPromptBusyImageId(null);
    setSemanticPromptReviews({});
    setSemanticPromptErrors({});
    setSemanticPromptOpenImageIds([]);
    clearLiveLesionPreview();
  }, [selectedCase?.case_id, selectedSiteId, semanticPromptInputMode]);

  useEffect(() => {
    if (!liveLesionCropEnabled) {
      clearLiveLesionPreview();
    }
  }, [liveLesionCropEnabled]);

  useEffect(() => {
    if (!selectedSiteId) {
      return;
    }
    window.localStorage.setItem(favoriteStorageKey(user.user_id, selectedSiteId), JSON.stringify(favoriteCaseIds));
  }, [favoriteCaseIds, selectedSiteId, user.user_id]);

  useEffect(() => {
    if (validationResult) {
      return;
    }
    for (const url of aiClinicPreviewUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    aiClinicPreviewUrlsRef.current = [];
    setAiClinicResult(null);
    setModelCompareResult(null);
  }, [validationResult]);

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
      try {
        const nextCases = await fetchCases(currentSiteId, token, { mine: showOnlyMine });
        if (cancelled) {
          return;
        }
        setCases(nextCases);
        setSelectedCase((current) => {
          if (!current) {
            return nextCases[0] ?? null;
          }
          return nextCases.find((item) => item.case_id === current.case_id) ?? nextCases[0] ?? null;
        });
      } catch (nextError) {
        if (!cancelled) {
          setToast({
            tone: "error",
            message: describeError(nextError, copy.unableLoadRecentCases),
          });
        }
      } finally {
        if (!cancelled) {
          setCasesLoading(false);
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
    async function loadSiteModels() {
      try {
        const nextVersions = await fetchSiteModelVersions(currentSiteId, token);
        if (!cancelled) {
          setSiteModelVersions(nextVersions);
          setSelectedCompareModelVersionIds((current) => (current.length > 0 ? current : defaultModelCompareSelection(nextVersions)));
        }
      } catch {
        if (!cancelled) {
          setSiteModelVersions([]);
          setSelectedCompareModelVersionIds([]);
        }
      }
    }
    void loadRecords();
    void loadActivity();
    void loadSiteValidations();
    void loadSiteModels();
    return () => {
      cancelled = true;
    };
  }, [
    selectedSiteId,
    showOnlyMine,
    token,
    copy.recoveredDraft,
    copy.unableLoadRecentCases,
    copy.unableLoadSiteActivity,
    copy.unableLoadSiteValidationHistory,
  ]);

  useEffect(() => {
    for (const url of validationArtifactUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    validationArtifactUrlsRef.current = [];
    for (const url of aiClinicPreviewUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    aiClinicPreviewUrlsRef.current = [];
    setValidationArtifacts({});
    setAiClinicResult(null);
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
            message: describeError(nextError, pick(locale, "Unable to load case images.", "耳?댁뒪 ?대?吏瑜?遺덈윭?ㅼ? 紐삵뻽?듬땲??")),
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
            message: describeError(nextError, pick(locale, "Unable to load this patient's visit gallery.", "???섏옄??諛⑸Ц ?대?吏 臾띠쓬??遺덈윭?ㅼ? 紐삵뻽?듬땲??")),
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

  function clearLiveLesionPreview(imageId?: string) {
    if (imageId) {
      for (const url of liveLesionPreviewUrlsRef.current[imageId] ?? []) {
        URL.revokeObjectURL(url);
      }
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
      for (const url of urls) {
        URL.revokeObjectURL(url);
      }
    }
    liveLesionPreviewUrlsRef.current = {};
    liveLesionPreviewRequestRef.current = {};
    setLiveLesionPreviews({});
  }

  function clearDraftStorage(siteId: string | null = selectedSiteId) {
    if (!siteId) {
      setDraftSavedAt(null);
      return;
    }
    window.localStorage.removeItem(draftStorageKey(user.user_id, siteId));
    setDraftSavedAt(null);
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
          pick(locale, "Unable to prepare the next follow-up draft for this patient.", "???섏옄???ㅼ쓬 ?ъ쭊 珥덉븞??以鍮꾪븯吏 紐삵뻽?듬땲??")
        ),
      });
    }
  }

  async function startEditDraftFromSelectedCase() {
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
          fetchImages(selectedSiteId, token, caseToEdit.patient_id, caseToEdit.visit_date),
          fetchVisits(selectedSiteId, token, caseToEdit.patient_id),
        ]);
        selectedVisit =
          savedVisits.find((visit) => visit.visit_date === caseToEdit.visit_date) ?? null;
        nextDraftImages = await Promise.all(
          savedImages.map(async (image) => {
            const blob = await fetchImageBlob(selectedSiteId, image.image_id, token);
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
            const file = new File([blob], `${image.image_id}.${extension}`, { type: mediaType });
            const draftId = createDraftId();
            nextDraftBoxes[draftId] =
              image.lesion_prompt_box && typeof image.lesion_prompt_box === "object"
                ? normalizeBox(image.lesion_prompt_box)
                : null;
            return {
              draft_id: draftId,
              file,
              preview_url: URL.createObjectURL(blob),
              view: image.view,
              is_representative: image.is_representative,
            };
          })
        );
      }

      clearDraftStorage();
      clearValidationArtifacts();
      clearRoiPreview();
      clearLesionPreview();
      setValidationResult(null);
      setCaseHistory(null);
      setContributionResult(null);
      setPanelOpen(true);
      setRailView("cases");
      setSelectedCase(null);
      setSelectedCaseImages([]);
      replaceDraftImages(nextDraftImages);
      setDraftLesionPromptBoxes(nextDraftBoxes);
      setDraft((current) => ({
        ...current,
        patient_id: caseToEdit.patient_id,
        sex: caseToEdit.sex || current.sex,
        age: String(caseToEdit.age ?? current.age),
        chart_alias: caseToEdit.chart_alias ?? current.chart_alias,
        local_case_code: caseToEdit.local_case_code ?? current.local_case_code,
        actual_visit_date: caseToEdit.actual_visit_date?.trim() || "",
        culture_category: caseToEdit.culture_category || current.culture_category,
        culture_species: caseToEdit.culture_species || current.culture_species,
        additional_organisms: normalizeAdditionalOrganisms(
          caseToEdit.culture_category,
          caseToEdit.culture_species,
          selectedVisit?.additional_organisms ?? caseToEdit.additional_organisms
        ),
        contact_lens_use: selectedVisit?.contact_lens_use || caseToEdit.contact_lens_use || current.contact_lens_use,
        visit_status: selectedVisit?.visit_status || caseToEdit.visit_status || current.visit_status,
        is_initial_visit: /^initial$/i.test(caseToEdit.visit_date),
        follow_up_number: (() => {
          const followUpMatch = String(caseToEdit.visit_date ?? "").match(/^(?:F\/?U|FU)[-\s_#]*0*(\d+)$/i);
          return followUpMatch ? String(Number(followUpMatch[1]) || 1) : current.follow_up_number;
        })(),
        predisposing_factor: selectedVisit?.predisposing_factor ?? current.predisposing_factor,
        other_history: selectedVisit?.other_history ?? current.other_history,
        intake_completed: false,
      }));
      setPendingOrganism({
        culture_category: caseToEdit.culture_category || "bacterial",
        culture_species:
          caseToEdit.additional_organisms?.[0]?.culture_species ||
          caseToEdit.culture_species ||
          (CULTURE_SPECIES[caseToEdit.culture_category || "bacterial"]?.[0] ?? ""),
      });
      setShowAdditionalOrganismForm(false);
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(
          nextError,
          pick(locale, "Unable to open this saved case in edit mode.", "?????耳?댁뒪瑜??섏젙 紐⑤뱶濡??댁? 紐삵뻽?듬땲??")
        ),
      });
    } finally {
      setEditDraftBusy(false);
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

  async function handleDeleteSavedCase(caseRecord: CaseSummaryRecord) {
    if (!selectedSiteId) {
      return;
    }
    const samePatientCases = cases.filter((item) => item.patient_id === caseRecord.patient_id);
    const confirmMessage = samePatientCases.length <= 1
      ? pick(
          locale,
          `Delete ${caseRecord.patient_id} / ${displayVisitReference(locale, caseRecord.visit_date)}?\n\nThis is the only visit for the patient, so the patient record will also be removed.`,
          `${caseRecord.patient_id} / ${displayVisitReference(locale, caseRecord.visit_date)} 諛⑸Ц????젣?좉퉴??\n\n???섏옄??留덉?留?諛⑸Ц?대씪 ?섏옄 湲곕줉???④퍡 ??젣?⑸땲??`
        )
      : pick(
          locale,
          `Delete ${caseRecord.patient_id} / ${displayVisitReference(locale, caseRecord.visit_date)}?`,
          `${caseRecord.patient_id} / ${displayVisitReference(locale, caseRecord.visit_date)} 諛⑸Ц????젣?좉퉴??`
        );
    if (!window.confirm(confirmMessage)) {
      return;
    }

    try {
      const deleted = await deleteVisit(selectedSiteId, token, caseRecord.patient_id, caseRecord.visit_date);
      const nextCases = await fetchCases(selectedSiteId, token, { mine: showOnlyMine });
      setCases(nextCases);

      if (deleted.deleted_patient) {
        setSelectedCase(null);
        setSelectedCaseImages([]);
        setPatientVisitGallery({});
        clearValidationArtifacts();
        clearRoiPreview();
        clearLesionPreview();
        setValidationResult(null);
        setCaseHistory(null);
        setContributionResult(null);
        setRailView("patients");
        setToast({ tone: "success", message: copy.patientDeleted(caseRecord.patient_id) });
        return;
      }

      const preservedCurrentCase =
        selectedCase && selectedCase.case_id !== caseRecord.case_id
          ? nextCases.find((item) => item.case_id === selectedCase.case_id) ?? null
          : null;
      const remainingSamePatientCase = nextCases
        .filter((item) => item.patient_id === caseRecord.patient_id)
        .sort((left, right) => caseTimestamp(right) - caseTimestamp(left))[0] ?? null;
      const nextSelectedCase = preservedCurrentCase ?? remainingSamePatientCase ?? nextCases[0] ?? null;
      setSelectedCase(nextSelectedCase);
      setToast({ tone: "success", message: copy.visitDeleted(caseRecord.patient_id, caseRecord.visit_date) });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, copy.deleteVisitFailed),
      });
    }
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
      setToast({ tone: "error", message: copy.patientIdRequired });
      return;
    }
    if (!draft.culture_species.trim()) {
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

  async function hydrateLiveLesionPreview(
    imageId: string,
    job: LiveLesionPreviewJobResponse,
    requestVersion: number
  ) {
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
      for (const url of nextUrls) {
        URL.revokeObjectURL(url);
      }
      return;
    }

    for (const url of liveLesionPreviewUrlsRef.current[imageId] ?? []) {
      URL.revokeObjectURL(url);
    }
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
              error: job.error ?? pick(locale, "Live MedSAM preview failed.", "?ㅼ떆媛?MedSAM 誘몃━蹂닿린???ㅽ뙣?덉뒿?덈떎."),
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
              pick(locale, "Unable to check live MedSAM preview status.", "?ㅼ떆媛?MedSAM ?곹깭瑜??뺤씤?섏? 紐삵뻽?듬땲??")
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
        error: pick(locale, "Live MedSAM preview timed out.", "?ㅼ떆媛?MedSAM 誘몃━蹂닿린媛 ?쒓컙 珥덇낵?섏뿀?듬땲??"),
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
    setLiveLesionPreviews((current) => ({
      ...current,
      [imageId]: {
        job_id: current[imageId]?.job_id ?? null,
        status: "running",
        error: null,
        backend: current[imageId]?.backend ?? null,
        prompt_signature: current[imageId]?.prompt_signature ?? null,
        lesion_mask_url: current[imageId]?.lesion_mask_url ?? null,
        lesion_crop_url: current[imageId]?.lesion_crop_url ?? null,
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
        pick(locale, "Unable to start live MedSAM preview.", "?ㅼ떆媛?MedSAM 誘몃━蹂닿린瑜??쒖옉?섏? 紐삵뻽?듬땲??")
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

  const representativeSavedImage = selectedCaseImages.find((image) => image.is_representative) ?? null;
  const lesionBoxChangedImageIds = selectedCaseImages
    .map((image) => image.image_id)
    .filter((imageId) => JSON.stringify(lesionPromptDrafts[imageId] ?? null) !== JSON.stringify(lesionPromptSaved[imageId] ?? null));
  const hasAnySavedLesionBox = Object.values(lesionPromptSaved).some((value) => value);

  async function persistLesionPromptBox(imageId: string, nextBox: NormalizedBox) {
    if (!selectedSiteId) {
      throw new Error(pick(locale, "Select a hospital first.", "癒쇱? 蹂묒썝???좏깮?섏꽭??"));
    }
    setLesionBoxBusyImageId(imageId);
    try {
      const normalized = normalizeBox(nextBox);
      if (normalized.x1 - normalized.x0 < 0.01 || normalized.y1 - normalized.y0 < 0.01) {
        throw new Error(pick(locale, "Lesion box is too small.", "蹂묐? 諛뺤뒪媛 ?덈Т ?묒뒿?덈떎."));
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
      throw new Error(pick(locale, "Select a hospital first.", "癒쇱? 蹂묒썝???좏깮?섏꽭??"));
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
          message: describeError(nextError, pick(locale, "Unable to clear lesion box.", "蹂묐? 諛뺤뒪瑜??댁젣?섏? 紐삵뻽?듬땲??")),
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
        message: describeError(nextError, pick(locale, "Unable to auto-save lesion box.", "蹂묐? 諛뺤뒪瑜??먮룞 ??ν븯吏 紐삵뻽?듬땲??")),
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
        message: pick(locale, "Select a saved case before running lesion preview.", "蹂묐? crop 誘몃━蹂닿린瑜??ㅽ뻾?섎젮硫???λ맂 耳?댁뒪瑜??좏깮?섏꽭??"),
      });
      return;
    }
    const hasAnyDraftBox = Object.values(lesionPromptDrafts).some((value) => value);
    const hasAnySavedBox = Object.values(lesionPromptSaved).some((value) => value);
    if (!hasAnyDraftBox && !hasAnySavedBox) {
      setToast({
        tone: "error",
        message: pick(locale, "Draw and save at least one lesion box first.", "蹂묐? 諛뺤뒪瑜??섎굹 ?댁긽 洹몃━怨???ν븯?몄슂."),
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
          `${selectedCase.patient_id} / ${selectedCase.visit_date} 蹂묐? crop 誘몃━蹂닿린瑜??앹꽦?덉뒿?덈떎.`
        ),
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, pick(locale, "Lesion preview failed.", "蹂묐? crop 誘몃━蹂닿린???ㅽ뙣?덉뒿?덈떎.")),
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
      const fallback = pick(locale, "Semantic prompt review failed.", "Semantic prompt review ?遺욧퍕????쎈솭??됰뮸??덈뼄.");
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

  async function handleRunSiteValidation() {
    if (!selectedSiteId) {
      setToast({ tone: "error", message: copy.selectSiteForValidation });
      return;
    }

    setSiteValidationBusy(true);
    try {
      const started = await runSiteValidation(selectedSiteId, token);
      let latestJob = started.job;
      while (latestJob.status === "queued" || latestJob.status === "running") {
        await sleep(1000);
        latestJob = await fetchSiteJob(selectedSiteId, latestJob.job_id, token);
      }
      if (latestJob.status === "failed") {
        throw new Error(latestJob.result?.error || copy.siteValidationFailed);
      }
      const result = latestJob.result?.response;
      if (!result || !("summary" in result)) {
        throw new Error(copy.siteValidationFailed);
      }
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

  async function handleRunModelCompare() {
    if (!selectedSiteId || !selectedCase) {
      setToast({ tone: "error", message: copy.selectSavedCaseForValidation });
      return;
    }
    if (selectedCompareModelVersionIds.length === 0) {
      setToast({
        tone: "error",
        message: pick(locale, "Select at least one model version for comparison.", "鍮꾧탳??紐⑤뜽 踰꾩쟾???섎굹 ?댁긽 ?좏깮?섏꽭??"),
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
        message: pick(locale, `Compared ${result.comparisons.length} model(s).`, `${result.comparisons.length}媛?紐⑤뜽 鍮꾧탳瑜??꾨즺?덉뒿?덈떎.`),
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, pick(locale, "Unable to compare models for this case.", "??耳?댁뒪??紐⑤뜽 鍮꾧탳瑜??ㅽ뻾?????놁뒿?덈떎.")),
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
    for (const url of aiClinicPreviewUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    aiClinicPreviewUrlsRef.current = [];
    setAiClinicResult(null);
    setPanelOpen(true);
    try {
      const result = await runCaseAiClinic(selectedSiteId, token, {
        patient_id: selectedCase.patient_id,
        visit_date: selectedCase.visit_date,
        execution_mode: executionModeFromDevice(validationResult.execution_device),
        model_version_id: validationResult.model_version.version_id,
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
      const nextCases = await fetchCases(selectedSiteId!, token, { mine: showOnlyMine });
      setCases(nextCases);
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
            `諛⑸Ц ${patientId} / ${displayVisitReference(locale, nextVisitReference)}媛 ?대? 議댁옱?⑸땲??\n\n?뺤씤???꾨Ⅴ硫???뼱?곌퀬, 痍⑥냼瑜??꾨Ⅴ硫??ㅻⅨ 耳?댁뒪濡???ν빀?덈떎.`
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
              `??耳?댁뒪瑜?${displayVisitReference(locale, alternateVisitReference)}濡???ν븷源뚯슂?`
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
        organism_summary: organismSummaryLabel(
          latestCase.culture_category,
          latestCase.culture_species,
          latestCase.additional_organisms,
          2
        ),
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
  const patientScopeCopy = showOnlyMine ? copy.patientScopeMine(patientListRows.length) : copy.patientScopeAll(patientListRows.length);
  const canRunValidation = ["admin", "site_admin", "researcher"].includes(user.role);
  const canRunRoiPreview = canRunValidation;
  const canRunAiClinic = canRunValidation && Boolean(validationResult) && Boolean(selectedCase);
  const compareModelCandidates = MODEL_COMPARE_ARCHITECTURES.map((architecture) =>
    [...siteModelVersions]
      .reverse()
      .find((item) => item.ready !== false && String(item.architecture || "").trim().toLowerCase() === architecture)
  ).filter((item): item is ModelVersionRecord => Boolean(item?.version_id));
  const canContributeSelectedCase =
    canRunValidation && Boolean(selectedCase) && selectedCase?.visit_status === "active";
  const latestSiteValidation = siteValidationRuns[0] ?? null;
  const validationPredictedConfidence = predictedClassConfidence(
    validationResult?.summary.predicted_label,
    validationResult?.summary.prediction_probability
  );
  const validationConfidence = confidencePercent(validationPredictedConfidence);
  const validationConfidenceTone = confidenceTone(validationConfidence);
  const selectedCompletion =
    selectedCase &&
    completionState &&
    completionState.patient_id === selectedCase.patient_id &&
    completionState.visit_date === selectedCase.visit_date
      ? completionState
      : null;
  const completionContent = selectedCompletion ? (
    <CompletionCard
      locale={locale}
      completion={selectedCompletion}
      hospitalValidationCount={summary?.n_validation_runs ?? 0}
      formatDateTime={(value, emptyLabel = common.notAvailable) => formatDateTime(value, localeTag, emptyLabel)}
      notAvailableLabel={common.notAvailable}
    />
  ) : null;
  const draftStatusLabel = draftSavedAt
    ? copy.draftAutosaved(new Date(draftSavedAt).toLocaleTimeString(localeTag, { hour: "2-digit", minute: "2-digit" }))
    : copy.draftUnsaved;
  const intakeOrganisms = listOrganisms(draft.culture_category, draft.culture_species, draft.additional_organisms);
  const resolvedVisitReference = buildVisitReference(draft);
  const resolvedVisitReferenceLabel = displayVisitReference(locale, resolvedVisitReference);
  const actualVisitDateLabel = draft.actual_visit_date.trim() || common.notAvailable;
  const validationPanelContent = (
    <ValidationPanel
      locale={locale}
      common={common}
      validationResult={validationResult}
      validationBusy={validationBusy}
      canRunValidation={canRunValidation}
      hasSelectedCase={Boolean(selectedCase)}
      validationConfidence={validationConfidence}
      validationConfidenceTone={validationConfidenceTone}
      validationPredictedConfidence={validationPredictedConfidence}
      onRunValidation={() => void handleRunValidation()}
      artifactContent={
        <ValidationArtifactStack
          locale={locale}
          representativePreviewUrl={representativeSavedImage?.preview_url}
          roiCropUrl={validationArtifacts.roi_crop}
          gradcamUrl={validationArtifacts.gradcam}
          medsamMaskUrl={validationArtifacts.medsam_mask}
          lesionCropUrl={validationArtifacts.lesion_crop}
          lesionMaskUrl={validationArtifacts.lesion_mask}
        />
      }
      modelCompareBusy={modelCompareBusy}
      selectedCompareModelVersionIds={selectedCompareModelVersionIds}
      compareModelCandidates={compareModelCandidates}
      onToggleModelVersion={(versionId, checked) =>
        setSelectedCompareModelVersionIds((current) =>
          checked ? [...current, versionId] : current.filter((item) => item !== versionId)
        )
      }
      onRunModelCompare={() => void handleRunModelCompare()}
      modelCompareResult={modelCompareResult}
      formatProbability={formatProbability}
    />
  );
  const aiClinicPanelContent = (
    <AiClinicPanel
      locale={locale}
      validationResult={validationResult}
      aiClinicBusy={aiClinicBusy}
      canRunAiClinic={canRunAiClinic}
      onRunAiClinic={() => void handleRunAiClinic()}
    >
      <AiClinicResult
        locale={locale}
        result={aiClinicResult}
        notAvailableLabel={common.notAvailable}
        aiClinicTextUnavailableLabel={copy.aiClinicTextUnavailable}
        displayVisitReference={(visitReference) => displayVisitReference(locale, visitReference)}
        formatSemanticScore={formatSemanticScore}
        formatImageQualityScore={formatImageQualityScore}
        formatProbability={formatProbability}
        formatMetadataField={(field) => formatAiClinicMetadataField(locale, field)}
      />
    </AiClinicPanel>
  );
  const mainHeaderTitle =
    railView === "patients"
      ? pick(locale, "Patient list", "환자 목록")
      : pick(locale, "Case Authoring", "케이스 작성");
  const mainHeaderCopy =
    railView === "patients"
      ? copy.listViewHeaderCopy
      : copy.caseAuthoringHeaderCopy;

  return (
    <main className={workspaceShellClass} data-workspace-theme={theme}>
      <div className={workspaceNoiseClass} />
      <aside className={workspaceRailClass}>
        <div className={workspaceBrandClass}>
          <div className={workspaceBrandCopyClass}>
            <div className={workspaceKickerClass}>{pick(locale, "Case Studio", "耳?댁뒪 ?ㅽ뒠?붿삤")}</div>
            <h1>{pick(locale, "K-ERA", "K-ERA")}</h1>
          </div>
          <div className={workspaceBrandActionsClass}>
            <Button className="min-w-[108px]" type="button" variant="primary" onClick={startNewCaseDraft}>
              {pick(locale, "New case", "?좉퇋 耳?댁뒪")}
            </Button>
            <Button
              className={railView === "patients" ? "min-w-[108px] border-brand/20 bg-brand-soft text-brand" : "min-w-[108px]"}
              type="button"
              variant="ghost"
              onClick={() => setRailView("patients")}
            >
              {pick(locale, "List view", "리스트")}
            </Button>
          </div>
        </div>

        <Card as="section" variant="nested" className={railSectionClass}>
          <div className={railSectionHeadClass}>
            <span className={railLabelClass}>{pick(locale, "Hospital", "蹂묒썝")}</span>
            <strong>{sites.length} {pick(locale, "linked", "연결됨")}</strong>
          </div>
          <div className={railSiteListClass}>
            {sites.map((site) => (
              <button
                key={site.site_id}
                className={railSiteButtonClass(selectedSiteId === site.site_id)}
                type="button"
                onClick={() => onSelectSite(site.site_id)}
              >
                <strong>{site.display_name}</strong>
                <span>{site.hospital_name || site.site_id}</span>
              </button>
            ))}
          </div>
        </Card>

        <Card as="section" variant="nested" className={railSectionClass}>
          <div className={railSectionHeadClass}>
            <span className={railLabelClass}>{pick(locale, "Momentum", "진행도")}</span>
            <strong>{cases.length} {copy.savedCases}</strong>
          </div>
          <div className={momentumTrackClass}>
            <div className={momentumFillClass} style={{ width: `${momentumPercent}%` }} />
          </div>
          <p className={railCopyClass}>
            {pick(
              locale,
              "Each saved case expands the local dataset surface and keeps the migration grounded in real workflow.",
              "??λ맂 耳?댁뒪媛 ?섏뼱?좎닔濡?濡쒖뺄 ?곗씠?곗뀑???뺤옣?섍퀬 ?ㅼ젣 ?뚰겕?뚮줈??湲곗????댁쟾???좎??⑸땲??"
            )}
          </p>
        </Card>

        <Card as="section" variant="nested" className={railSectionClass}>
          <div className={railSectionHeadClass}>
            <strong>{activityBusy ? pick(locale, "syncing", "동기화 중") : `${siteActivity?.pending_updates ?? 0} ${pick(locale, "pending", "대기")}`}</strong>
          </div>
          <MetricGrid className={railMetricGridClass} columns={2}>
            <div>
              <strong>{siteActivity?.pending_updates ?? 0}</strong>
              <span>{pick(locale, "pending deltas", "?湲?以??명?")}</span>
            </div>
            <div>
              <strong>{siteActivity?.recent_validations.length ?? 0}</strong>
              <span>{pick(locale, "recent validations", "최근 검증")}</span>
            </div>
          </MetricGrid>
          <div className="mt-4 grid gap-3">
            {siteActivity?.recent_validations.slice(0, 2).map((item) => (
              <div key={item.validation_id} className={railActivityItemClass}>
                <strong>{item.model_version}</strong>
                <span>{formatDateTime(item.run_date, localeTag, common.notAvailable)}</span>
                <span>{typeof item.accuracy === "number" ? `${pick(locale, "acc", "정확도")} ${formatProbability(item.accuracy, common.notAvailable)}` : `${item.n_cases ?? 0} ${pick(locale, "cases", "케이스")}`}</span>
              </div>
            ))}
            {siteActivity?.recent_contributions.slice(0, 2).map((item) => (
              <div key={item.contribution_id} className={railActivityItemClass}>
                <strong>{item.case_reference_id ?? common.notAvailable}</strong>
                <span>{formatDateTime(item.created_at, localeTag, common.notAvailable)}</span>
                <span>{item.update_status ?? pick(locale, "queued", "?湲곗뿴 ?깅줉")}</span>
              </div>
            ))}
            {!activityBusy && !siteActivity?.recent_validations.length && !siteActivity?.recent_contributions.length ? (
              <div className={emptySurfaceClass}>{pick(locale, "No hospital activity recorded yet.", "?꾩쭅 湲곕줉??蹂묒썝 ?쒕룞???놁뒿?덈떎.")}</div>
            ) : null}
          </div>
        </Card>

        <Card as="section" variant="nested" className={railSectionClass}>
          <div className={`${railSectionHeadClass} ${validationRailHeadClass}`}>
            <span className={railLabelClass}>{pick(locale, "Hospital validation", "병원 검증")}</span>
            <Button
              className={railRunButtonClass}
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => void handleRunSiteValidation()}
              disabled={siteValidationBusy || !selectedSiteId || !canRunValidation}
            >
              {siteValidationBusy ? pick(locale, "Running...", "?ㅽ뻾 以?..") : pick(locale, "Run hospital validation", "蹂묒썝 寃利??ㅽ뻾")}
            </Button>
          </div>
          {latestSiteValidation ? (
            <div className={`${panelMetricGridClass} ${railMetricGridClass}`}>
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
                <span>{pick(locale, "cases", "耳?댁뒪")}</span>
              </div>
              <div>
                <strong>{latestSiteValidation.model_version}</strong>
                <span>{pick(locale, "latest model", "理쒖떊 紐⑤뜽")}</span>
              </div>
            </div>
          ) : (
            <div className={emptySurfaceClass}>{pick(locale, "No hospital-level validation has been run yet.", "?꾩쭅 蹂묒썝 ?⑥쐞 寃利앹씠 ?ㅽ뻾?섏? ?딆븯?듬땲??")}</div>
          )}
          <div className={railActivityListClass}>
            {siteValidationRuns.slice(0, 3).map((item) => (
              <div key={item.validation_id} className={railActivityItemClass}>
                <strong>{item.model_version}</strong>
                <span>{formatDateTime(item.run_date, localeTag, common.notAvailable)}</span>
                <span>{typeof item.accuracy === "number" ? `${pick(locale, "acc", "정확도")} ${item.accuracy.toFixed(3)}` : `${item.n_cases ?? 0} ${pick(locale, "cases", "케이스")}`}</span>
              </div>
            ))}
          </div>
          {!canRunValidation ? <p className={railCopyClass}>{pick(locale, "Viewer accounts can review metrics but cannot run hospital validation.", "酉곗뼱 怨꾩젙? 吏?쒕쭔 ?뺤씤?????덇퀬 蹂묒썝 寃利앹? ?ㅽ뻾?????놁뒿?덈떎.")}</p> : null}
        </Card>

      </aside>

      <section className={workspaceMainClass}>
        <header className={workspaceHeaderClass}>
          <div>
            <div className={workspaceKickerClass}>{pick(locale, "Research document", "?곌뎄 臾몄꽌")}</div>
            <div className={workspaceTitleRowClass}>
              <h2>{mainHeaderTitle}</h2>
              <span className={workspaceTitleCopyClass}>{mainHeaderCopy}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <span className={workspaceUserBadgeClass}>{translateRole(locale, user.role)}</span>
            <LocaleToggle />
            <Button variant="ghost" type="button" onClick={onToggleTheme}>
              {theme === "dark" ? pick(locale, "Light mode", "?쇱씠??紐⑤뱶") : pick(locale, "Dark mode", "?ㅽ겕 紐⑤뱶")}
            </Button>
            {canOpenOperations ? (
              <Button variant="ghost" type="button" onClick={() => onOpenOperations()}>
                {pick(locale, "Operations", "?댁쁺 ?붾㈃")}
              </Button>
            ) : null}
            <Button variant="ghost" type="button" onClick={onExportManifest} disabled={!selectedSiteId}>
              {pick(locale, "Export manifest", "留ㅻ땲?섏뒪???대낫?닿린")}
            </Button>
            <Button className={completeIntakeButtonClass} type="button" variant="primary" onClick={onLogout}>
                {pick(locale, "Log out", "濡쒓렇?꾩썐")}
            </Button>
          </div>
        </header>

        {canOpenOperations ? (
          <Card as="section" variant="nested" className={researchLaunchStripClass}>
            <div className={researchLaunchCopyClass}>
              <div className={docEyebrowClass}>{pick(locale, "Research runs", "?곌뎄 ?ㅽ뻾")}</div>
              <strong>{pick(locale, "Open training and validation tools directly", "?숈뒿怨?寃利??꾧뎄 諛붾줈 ?닿린")}</strong>
              <span>{pick(locale, "You no longer need to find the Python CLI manually.", "?댁젣 Python CLI ?ㅽ뻾 ?뚯씪???곕줈 李얠쓣 ?꾩슂媛 ?놁뒿?덈떎.")}</span>
            </div>
            <div className={researchLaunchActionsClass}>
              <Button variant="ghost" type="button" onClick={() => onOpenOperations("training")}>
                {pick(locale, "Initial training", "珥덇린 ?숈뒿")}
              </Button>
              <Button variant="ghost" type="button" onClick={() => onOpenOperations("cross_validation")}>
                {pick(locale, "Cross-validation", "교차 검증")}
              </Button>
              <Button variant="ghost" type="button" onClick={() => onOpenOperations("dashboard")}>
                {pick(locale, "Hospital validation", "병원 검증")}
              </Button>
              <Button variant="ghost" type="button" onClick={() => onOpenOperations("cross_validation")}>
                {pick(locale, "Report export", "由ы룷???대낫?닿린")}
              </Button>
            </div>
          </Card>
        ) : null}

        <div className={workspaceCenterClass}>
          {railView === "patients" ? (
            <section className={docSurfaceClass}>
              <SectionHeader
                className={docTitleRowClass}
                eyebrow={<div className={docEyebrowClass}>{pick(locale, "Patient list", "환자 목록")}</div>}
                title={pick(locale, "Saved patients", "????섏옄 紐⑸줉")}
                titleAs="h3"
                aside={
                  <div className={docTitleMetaClass}>
                    <div className={docSiteBadgeClass}>{selectedSiteId ?? pick(locale, "Select a hospital", "蹂묒썝 ?좏깮")}</div>
                    <span className={docSiteBadgeClass}>{`${patientListRows.length} ${pick(locale, "patients", "?섏옄")}`}</span>
                  </div>
                }
              />
              <div className={docBadgeRowClass}>
                <div className={segmentedToggleClass} role="group" aria-label={copy.patients}>
                  <Button
                    className={togglePillClass(!showOnlyMine)}
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowOnlyMine(false)}
                  >
                    {copy.allRecords}
                  </Button>
                  <Button
                    className={togglePillClass(showOnlyMine)}
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowOnlyMine(true)}
                  >
                    {copy.myPatientsOnly}
                  </Button>
                </div>
                <span className={docSiteBadgeClass}>{patientScopeCopy}</span>
                <span className={docSiteBadgeClass}>
                  {pick(
                    locale,
                    "Each row is one patient. Click a row to load the latest saved case with images and lesion boxes.",
                    "媛??됱? ?섏옄 1紐낆엯?덈떎. ?됱쓣 ?꾨Ⅴ硫?理쒖떊 ???耳?댁뒪? ?대?吏, lesion box瑜?諛붾줈 遺덈윭?듬땲??"
                  )}
                </span>
              </div>
              <section className={`${docSectionClass} grid gap-3`}>
                <input
                  className={`${listBoardSearchClass} min-h-12 rounded-[var(--radius-md)] border border-border bg-white/55 px-4 text-sm text-ink shadow-card outline-none transition duration-150 ease-out placeholder:text-muted focus:border-brand/25 focus:ring-4 focus:ring-[rgba(48,88,255,0.12)] dark:bg-white/4`}
                  value={caseSearch}
                  onChange={(event) => setCaseSearch(event.target.value)}
                  placeholder={pick(locale, "Search patient or organism", "환자 또는 균종 검색")}
                />
                {casesLoading ? <div className={emptySurfaceClass}>{copy.loadingSavedCases}</div> : null}
                {!casesLoading && patientListRows.length === 0 ? (
                  <div className={emptySurfaceClass}>{pick(locale, "No saved patients match this search yet.", "寃??議곌굔??留욌뒗 ????섏옄媛 ?꾩쭅 ?놁뒿?덈떎.")}</div>
                ) : null}
                <div className={listBoardStackClass}>
                  {patientListRows.map((row) => (
                    <button
                      key={`board-${row.patient_id}`}
                      className={patientListRowClass(selectedCase?.patient_id === row.patient_id)}
                      type="button"
                      onClick={() => openSavedCase(row.latest_case, "cases")}
                    >
                      <div className={patientListRowMainClass}>
                        <div className={patientListRowChipsClass}>
                          <span className={patientListChipClass(true)}>{row.latest_case.local_case_code || row.patient_id}</span>
                          <span className={patientListChipClass()}>{row.patient_id}</span>
                          <span className={patientListChipClass()}>{`${translateOption(locale, "sex", row.latest_case.sex)} 쨌 ${row.latest_case.age ?? common.notAvailable}`}</span>
                          <span className={patientListChipClass()}>{`${row.case_count} ${pick(locale, "cases", "耳?댁뒪")}`}</span>
                          <span className={patientListChipClass()}>{`${translateOption(locale, "cultureCategory", row.latest_case.culture_category)} 쨌 ${row.organism_summary}`}</span>
                        </div>
                        <div className={patientListRowMetaClass}>
                          <span>{displayVisitReference(locale, row.latest_case.visit_date)}</span>
                          {row.latest_case.actual_visit_date ? <span>{row.latest_case.actual_visit_date}</span> : null}
                          <span>{formatDateTime(row.latest_case.latest_image_uploaded_at ?? row.latest_case.created_at, localeTag, common.notAvailable)}</span>
                        </div>
                      </div>
                      <div className={patientListThumbnailsClass}>
                        {row.representative_thumbnails.length === 0 ? (
                          <span className={patientListThumbEmptyClass}>{pick(locale, "No thumbnails", "?몃꽕???놁쓬")}</span>
                        ) : (
                          row.representative_thumbnails.slice(0, 4).map((thumbnail) => {
                            const previewUrl =
                              patientListThumbs[row.patient_id]?.find((item) => item.case_id === thumbnail.case_id)?.preview_url ?? null;
                            return previewUrl ? (
                              <img
                                key={`board-${thumbnail.case_id}`}
                                src={previewUrl}
                                alt={`${row.patient_id}-${thumbnail.case_id}`}
                                className={patientListThumbClass}
                              />
                            ) : (
                              <div key={`board-${thumbnail.case_id}`} className={`${patientListThumbClass} grid place-items-center`}>
                                {translateOption(locale, "view", thumbnail.view ?? "white")}
                              </div>
                            );
                          })
                        )}
                        {row.representative_thumbnails.length > 4 ? (
                          <span className={patientListThumbMoreClass}>+{row.representative_thumbnails.length - 4}</span>
                        ) : null}
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            </section>
          ) : selectedCase ? (
          <section className={docSurfaceClass}>
            <SectionHeader
              className={docTitleRowClass}
              eyebrow={<div className={docEyebrowClass}>{pick(locale, "Saved case", "???耳?댁뒪")}</div>}
              title={formatCaseTitle(selectedCase)}
              titleAs="h3"
              aside={
                <div className={docTitleMetaClass}>
                  <div className={docSiteBadgeClass}>{selectedSiteId ?? pick(locale, "Select a hospital", "蹂묒썝 ?좏깮")}</div>
                  <span className={docSiteBadgeClass}>{displayVisitReference(locale, selectedCase.visit_date)}</span>
                </div>
              }
            />

            <Card as="section" variant="nested" className={`${docSectionClass} grid gap-4 pt-3`}>
              <SectionHeader
                className={docSectionHeadClass}
                eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Case summary", "耳?댁뒪 ?붿빟")}</div>}
                title={selectedCase.local_case_code || selectedCase.patient_id}
                titleAs="h4"
                description={pick(
                  locale,
                  "Pinned metadata for the saved case before you review images, validation, and contribution history.",
                  "?대?吏, 寃利? 湲곗뿬 ?대젰??蹂닿린 ?꾩뿉 ?????耳?댁뒪???듭떖 硫뷀??곗씠?곕? 癒쇱? 怨좎젙?⑸땲??"
                )}
                aside={
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Button
                      className={savedCaseActionButtonClass()}
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => void startEditDraftFromSelectedCase()}
                      disabled={editDraftBusy}
                    >
                      {editDraftBusy ? common.loading : pick(locale, "Edit", "?섏젙")}
                    </Button>
                    <Button
                      className={savedCaseActionButtonClass()}
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => void startFollowUpDraftFromSelectedCase()}
                    >
                      {pick(locale, "Add F/U", "?ъ쭊 異붽?")}
                    </Button>
                    <Button
                      className={savedCaseActionButtonClass(isFavoriteCase(selectedCase.case_id))}
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => toggleFavoriteCase(selectedCase.case_id)}
                    >
                      {isFavoriteCase(selectedCase.case_id) ? pick(locale, "Favorited", "즐겨찾기됨") : pick(locale, "Favorite", "즐겨찾기")}
                    </Button>
                  </div>
                }
              />
              <MetricGrid columns={3} className="saved-case-summary-metric-grid">
                <MetricItem
                  className={intakeSummaryMetricCardClass}
                  value={selectedCase.patient_id}
                  label={`${translateOption(locale, "sex", selectedCase.sex)} / ${selectedCase.age ?? common.notAvailable}`}
                />
                <MetricItem
                  className={intakeSummaryMetricCardClass}
                  value={displayVisitReference(locale, selectedCase.visit_date)}
                  label={`${translateOption(locale, "visitStatus", selectedCase.visit_status)} / ${
                    selectedCase.is_initial_visit ? pick(locale, "Initial visit", "珥덉쭊") : pick(locale, "Follow-up visit", "?ъ쭊")
                  }`}
                />
                <MetricItem
                  className={intakeSummaryMetricCardClass}
                  value={`${translateOption(locale, "cultureCategory", selectedCase.culture_category)} / ${organismSummaryLabel(selectedCase.culture_category, selectedCase.culture_species, selectedCase.additional_organisms, 2)}`}
                  label={pick(locale, "Primary culture and organism", "二??먯씤洹??붿빟")}
                />
              </MetricGrid>
              <div className={selectedCaseChipStripClass}>
                <div className={selectedCaseChipClass}>
                  <strong>{pick(locale, "Last updated", "留덉?留??낅뜲?댄듃")}</strong>
                  <span>{formatDateTime(selectedCase.latest_image_uploaded_at ?? selectedCase.created_at, localeTag, common.notAvailable)}</span>
                </div>
                <div className={selectedCaseChipClass}>
                  <strong>{pick(locale, "Representative view", "대표 뷰")}</strong>
                  <span>
                    {selectedCase.representative_view
                      ? translateOption(locale, "view", selectedCase.representative_view)
                      : common.notAvailable}
                  </span>
                </div>
                <div className={selectedCaseChipClass}>
                  <strong>{pick(locale, "Saved images", "????대?吏")}</strong>
                  <span>{`${selectedCase.image_count} ${pick(locale, "images", "?대?吏")}`}</span>
                </div>
                <div className={selectedCaseChipClass}>
                  <strong>{pick(locale, "Contact lens", "콘택트렌즈")}</strong>
                  <span>{translateOption(locale, "contactLens", selectedCase.contact_lens_use)}</span>
                </div>
                <div className={selectedCaseChipClass}>
                  <strong>{pick(locale, "Predisposing factors", "?좏뻾 ?몄옄")}</strong>
                  <span>
                    {selectedCase.predisposing_factor && selectedCase.predisposing_factor.length > 0
                      ? selectedCase.predisposing_factor.map((factor) => translateOption(locale, "predisposing", factor)).join(" / ")
                      : pick(locale, "No predisposing factor selected", "?좏깮???좏뻾 ?몄옄 ?놁쓬")}
                  </span>
                </div>
              </div>
              {(selectedCase.additional_organisms?.length ?? 0) > 0 ? (
                <div className={organismChipRowClass}>
                  {selectedCase.additional_organisms.map((organism) => (
                    <span key={`saved-summary-${organismKey(organism)}`} className={`${organismChipClass} ${organismChipStaticClass}`}>
                      {`${translateOption(locale, "cultureCategory", organism.culture_category)} / ${organism.culture_species}`}
                    </span>
                  ))}
                </div>
              ) : null}
              {selectedCase.other_history?.trim() ? <p className={summaryNoteClass}>{selectedCase.other_history.trim()}</p> : null}
            </Card>

            <section className={docSectionClass}>
              <SectionHeader
                className={docSectionHeadClass}
                eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Patient timeline", "?섏옄 ?꾩껜 諛⑸Ц")}</div>}
                title={pick(locale, "Saved visits for this patient", "???섏옄?????諛⑸Ц")}
                titleAs="h4"
                description={pick(
                  locale,
                  "Review all saved visit images grouped by initial and follow-up visits.",
                  "珥덉쭊怨??ъ쭊 湲곗??쇰줈 ??λ맂 諛⑸Ц怨??대?吏瑜???踰덉뿉 寃?좏빀?덈떎."
                )}
                aside={
                  <span className={docSiteBadgeClass}>
                    {patientVisitGalleryBusy
                      ? common.loading
                      : `${selectedPatientCases.length} ${pick(locale, "visits", "諛⑸Ц")}`}
                  </span>
                }
              />
              {patientVisitGalleryBusy ? <div className={emptySurfaceClass}>{common.loading}</div> : null}
              {!patientVisitGalleryBusy && selectedPatientCases.length === 0 ? (
                <div className={emptySurfaceClass}>{pick(locale, "No saved visits are available for this patient yet.", "???섏옄?먮뒗 ?꾩쭅 ??λ맂 諛⑸Ц???놁뒿?덈떎.")}</div>
              ) : null}
              {!patientVisitGalleryBusy && selectedPatientCases.length > 0 ? (
                <div className={patientVisitGalleryStackClass}>
                  {selectedPatientCases.map((caseItem) => {
                    const visitImages = patientVisitGallery[caseItem.case_id] ?? [];
                    const isCurrentVisit = selectedCase.case_id === caseItem.case_id;
                    return (
                      <Card
                        as="section"
                        variant="nested"
                        key={`visit-gallery-${caseItem.case_id}`}
                        className={patientVisitGalleryCardClass(isCurrentVisit)}
                      >
                        <SectionHeader
                          className={docSectionHeadClass}
                          title={displayVisitReference(locale, caseItem.visit_date)}
                          titleAs="h4"
                          description={
                            isCurrentVisit
                              ? pick(locale, "This visit is open in the editor and drives the panels below.", "??諛⑸Ц???꾩옱 ?몄쭛湲곗뿉 ?대젮 ?덇퀬 ?꾨옒 ?⑤꼸??湲곗????⑸땲??")
                              : pick(locale, "Open this saved visit to review its images and downstream validation.", "?????諛⑸Ц???대㈃ ?대?吏? ?꾩냽 寃利?寃곌낵瑜??뺤씤?????덉뒿?덈떎.")
                          }
                          aside={
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              <Button
                                type="button"
                                className={togglePillClass(isCurrentVisit, true)}
                                size="sm"
                                variant="ghost"
                                onClick={() => openSavedCase(caseItem, "cases")}
                              >
                                {isCurrentVisit ? pick(locale, "Current visit", "?꾩옱 諛⑸Ц") : pick(locale, "Open visit", "諛⑸Ц ?닿린")}
                              </Button>
                              <Button
                                type="button"
                                className="px-3"
                                size="sm"
                                variant="ghost"
                                onClick={() => void handleDeleteSavedCase(caseItem)}
                              >
                                {pick(locale, "Delete visit", "諛⑸Ц ??젣")}
                              </Button>
                            </div>
                          }
                        />
                        <MetricGrid columns={4}>
                          <MetricItem
                            value={formatDateTime(caseItem.latest_image_uploaded_at ?? caseItem.created_at, localeTag, common.notAvailable)}
                            label={pick(locale, "Last updated", "留덉?留??낅뜲?댄듃")}
                          />
                          <MetricItem
                            value={`${visitImages.length} ${pick(locale, "images", "?대?吏")}`}
                            label={pick(locale, "Saved images", "????대?吏")}
                          />
                          <MetricItem
                            value={translateOption(locale, "visitStatus", caseItem.visit_status)}
                            label={caseItem.is_initial_visit ? pick(locale, "Initial visit", "珥덉쭊") : pick(locale, "Follow-up visit", "?ъ쭊")}
                          />
                          <MetricItem
                            value={`${translateOption(locale, "cultureCategory", caseItem.culture_category)} / ${organismSummaryLabel(caseItem.culture_category, caseItem.culture_species, caseItem.additional_organisms)}`}
                            label={pick(locale, "Culture summary", "諛곗뼇 ?붿빟")}
                          />
                        </MetricGrid>
                        {(caseItem.additional_organisms?.length ?? 0) > 0 ? (
                          <div className={organismChipRowClass}>
                            {caseItem.additional_organisms.map((organism) => (
                              <span key={`timeline-organism-${caseItem.case_id}-${organismKey(organism)}`} className={`${organismChipClass} ${organismChipStaticClass}`}>
                                {`${translateOption(locale, "cultureCategory", organism.culture_category)} / ${organism.culture_species}`}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        {visitImages.length > 0 ? (
                          <div className={patientVisitImageStripClass}>
                            {visitImages.map((image) => (
                              <div key={`timeline-${image.image_id}`} className={patientVisitImageCardClass}>
                                {image.preview_url ? (
                                  <img src={image.preview_url} alt={image.image_id} className={patientVisitImageThumbClass} />
                                ) : (
                                  <div className={`${patientVisitImageThumbClass} grid place-items-center text-sm text-muted`}>
                                    {translateOption(locale, "view", image.view)}
                                  </div>
                                )}
                                <div className={patientVisitImageMetaClass}>
                                  <strong>{translateOption(locale, "view", image.view)}</strong>
                                  <span>{image.is_representative ? pick(locale, "Representative", "????대?吏") : pick(locale, "Supporting", "蹂댁“ ?대?吏")}</span>
                                  <span>{pick(locale, "Q-score", "Q-score")} {formatImageQualityScore(image.quality_scores?.quality_score, common.notAvailable)}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className={emptySurfaceClass}>{pick(locale, "No saved images for this visit yet.", "??諛⑸Ц?먮뒗 ?꾩쭅 ????대?吏媛 ?놁뒿?덈떎.")}</div>
                        )}
                      </Card>
                    );
                  })}
                </div>
              ) : null}
            </section>

            <section className={docSectionClass}>
              <SectionHeader
                className={docSectionHeadClass}
                eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Saved images", "????대?吏")}</div>}
                title={pick(locale, "Lesion editing board", "蹂묐? ?몄쭛 蹂대뱶")}
                titleAs="h4"
                description={pick(locale, "Review the uploaded images and edit lesion boxes directly here", "?낅줈?쒕맂 ?대?吏瑜??뺤씤?섍퀬 ?ш린??諛붾줈 lesion box瑜??섏젙")}
                aside={<span className={docSiteBadgeClass}>{panelBusy ? common.loading : `${selectedCaseImages.length} ${pick(locale, "images", "?대?吏")}`}</span>}
              />
              <Card as="div" variant="nested" className={savedCaseImageToolbarClass}>
                <label className={liveCropToggleClass}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-brand"
                    checked={liveLesionCropEnabled}
                    onChange={(event) => setLiveLesionCropEnabled(event.target.checked)}
                  />
                  <span>{pick(locale, "Live lesion crop preview", "?ㅼ떆媛?蹂묐? crop 誘몃━蹂닿린")}</span>
                </label>
                <span className={savedCaseImageToolbarCopyClass}>
                  {liveLesionCropEnabled
                    ? pick(locale, "Client-side crop preview is on.", "?대씪?댁뼵??crop 誘몃━蹂닿린媛 耳쒖졇 ?덉뒿?덈떎.")
                    : pick(locale, "Turn this on only when needed on lower-spec machines.", "??ъ뼇 ?섍꼍?먯꽌???꾩슂???뚮쭔 耳쒕뒗 寃껋씠 醫뗭뒿?덈떎.")}
                </span>
              </Card>
              <div className={savedCaseImageBoardClass}>
                {selectedCaseImages.map((image) => {
                  const promptReviewOpen = semanticPromptOpenImageIds.includes(image.image_id);
                  const boxStatusCopy =
                    lesionBoxBusyImageId === image.image_id
                      ? pick(locale, "Saving box...", "諛뺤뒪 ???以?..")
                      : lesionPromptDrafts[image.image_id]
                        ? JSON.stringify(lesionPromptDrafts[image.image_id] ?? null) !== JSON.stringify(lesionPromptSaved[image.image_id] ?? null)
                          ? pick(locale, "Unsaved box", "誘몄???諛뺤뒪")
                          : pick(locale, "Box saved", "諛뺤뒪 ??λ맖")
                        : pick(locale, "No box", "諛뺤뒪 ?놁쓬");

                  return (
                    <Card as="section" variant="panel" key={`doc-${image.image_id}`} className="grid gap-4 p-5">
                    {image.preview_url ? (
                      <div
                        className={`${lesionEditorSurfaceClass} ${panelImageAnnotationSurfaceClass}`}
                        onPointerDown={(event) => handleLesionPointerDown(image.image_id, event)}
                        onPointerMove={(event) => handleLesionPointerMove(image.image_id, event)}
                        onPointerUp={(event) => finishLesionPointer(image.image_id, event)}
                        onPointerCancel={(event) => finishLesionPointer(image.image_id, event)}
                      >
                        {liveLesionCropEnabled &&
                        liveLesionPreviews[image.image_id]?.status === "done" &&
                        liveLesionPreviews[image.image_id]?.lesion_mask_url ? (
                          <MaskOverlayPreview
                            sourceUrl={image.preview_url}
                            maskUrl={liveLesionPreviews[image.image_id]?.lesion_mask_url}
                            alt={pick(locale, "Saved image with lesion mask", "蹂묐? mask媛 諛섏쁺??????대?吏")}
                            tint={[242, 164, 154]}
                          />
                        ) : (
                          <img
                            src={image.preview_url}
                            alt={image.image_id}
                            className={lesionEditorImageClass}
                            draggable={false}
                            onDragStart={(event) => event.preventDefault()}
                          />
                        )}
                        {lesionPromptDrafts[image.image_id] ? (
                          <div
                            className={lesionBoxOverlayClass}
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
                      <div className={panelImageFallbackClass}>{pick(locale, "Preview unavailable", "誘몃━蹂닿린瑜??쒖떆?????놁뒿?덈떎")}</div>
                    )}
                    {false && liveLesionCropEnabled ? (
                      <div className={`${panelImageAnnotationActionsClass} ${liveCropPreviewSectionClass}`}>
                        <div className={`${panelImageCardClass} ${liveCropCardClass}`}>
                          <LiveCropPreview
                            sourceUrl={image.preview_url}
                            box={lesionPromptDrafts[image.image_id] ?? lesionPromptSaved[image.image_id] ?? null}
                            alt={pick(locale, "Live lesion crop preview", "?ㅼ떆媛?蹂묐? crop 誘몃━蹂닿린")}
                          />
                          <div className={panelImageCopyClass}>
                            <strong>{pick(locale, "Live lesion crop", "?ㅼ떆媛?蹂묐? crop")}</strong>
                            <span>
                              {lesionPromptDrafts[image.image_id] ?? lesionPromptSaved[image.image_id]
                                ? pick(locale, "Updates as you draw or adjust the lesion box.", "蹂묐? 諛뺤뒪瑜?洹몃━嫄곕굹 議곗젙?섎㈃ 諛붾줈 媛깆떊?⑸땲??")
                                : pick(locale, "Draw a lesion box to preview the crop here.", "蹂묐? 諛뺤뒪瑜?洹몃━硫??닿납??crop媛 ?쒖떆?⑸땲??")}
                            </span>
                          </div>
                        </div>
                      </div>
                    ) : null}
                    {liveLesionCropEnabled ? (
                      <div className={`${panelImageAnnotationActionsClass} ${liveCropPreviewSectionClass}`}>
                        <Card as="div" variant="nested" className={`${panelImageCardClass} ${liveCropCardClass}`}>
                          {liveLesionPreviews[image.image_id]?.lesion_mask_url || liveLesionPreviews[image.image_id]?.lesion_crop_url ? (
                            <div className={panelPreviewGridClass}>
                              <div>
                                {liveLesionPreviews[image.image_id]?.lesion_mask_url ? (
                                  <MaskOverlayPreview
                                    sourceUrl={image.preview_url}
                                    maskUrl={liveLesionPreviews[image.image_id]?.lesion_mask_url}
                                    alt={pick(locale, "Live MedSAM mask overlay", "?ㅼ떆媛?MedSAM mask overlay")}
                                    tint={[242, 164, 154]}
                                  />
                                ) : (
                                  <div className={panelImageFallbackClass}>{pick(locale, "Mask preview unavailable", "mask 誘몃━蹂닿린瑜??쒖떆?????놁뒿?덈떎.")}</div>
                                )}
                                <div className={panelImageCopyClass}>
                                  <strong>{pick(locale, "Mask", "Mask")}</strong>
                                </div>
                              </div>
                              <div>
                                {liveLesionPreviews[image.image_id]?.lesion_crop_url ? (
                                  <img
                                    src={liveLesionPreviews[image.image_id]?.lesion_crop_url ?? ""}
                                    alt={pick(locale, "Live MedSAM crop", "?ㅼ떆媛?MedSAM crop")}
                                    className={panelImagePreviewClass}
                                  />
                                ) : (
                                  <div className={panelImageFallbackClass}>{pick(locale, "Crop preview unavailable", "crop 誘몃━蹂닿린瑜??쒖떆?????놁뒿?덈떎.")}</div>
                                )}
                                <div className={panelImageCopyClass}>
                                  <strong>{pick(locale, "Crop", "Crop")}</strong>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className={panelImageFallbackClass}>
                              {!lesionPromptDrafts[image.image_id] && !lesionPromptSaved[image.image_id]
                                ? pick(locale, "Draw a lesion box to request MedSAM preview.", "蹂묐? 諛뺤뒪瑜?洹몃━硫?MedSAM 誘몃━蹂닿린瑜??붿껌?⑸땲??")
                                : liveLesionPreviews[image.image_id]?.status === "failed"
                                  ? liveLesionPreviews[image.image_id]?.error ?? pick(locale, "Live MedSAM preview failed.", "?ㅼ떆媛?MedSAM 誘몃━蹂닿린???ㅽ뙣?덉뒿?덈떎.")
                                  : liveLesionPreviews[image.image_id]?.status === "running"
                                    ? pick(locale, "Generating MedSAM preview...", "MedSAM 誘몃━蹂닿린瑜??앹꽦 以묒엯?덈떎...")
                                    : pick(locale, "Save or adjust the lesion box to generate MedSAM preview.", "蹂묐? 諛뺤뒪瑜???ν븯嫄곕굹 議곗젙?섎㈃ MedSAM 誘몃━蹂닿린媛 ?앹꽦?⑸땲??")}
                            </div>
                          )}
                          <div className={panelImageCopyClass}>
                            <strong>{pick(locale, "Live MedSAM preview", "?ㅼ떆媛?MedSAM 誘몃━蹂닿린")}</strong>
                            <span>
                              {liveLesionPreviews[image.image_id]?.status === "running"
                                ? pick(locale, "Background inference is running for the latest saved box.", "媛??理쒓렐 ??λ맂 諛뺤뒪 湲곗??쇰줈 諛깃렇?쇱슫??異붾줎???ㅽ뻾 以묒엯?덈떎.")
                                : liveLesionPreviews[image.image_id]?.status === "done"
                                  ? pick(locale, "Mask and crop reflect the latest completed MedSAM job.", "mask? crop??媛??理쒓렐 ?꾨즺??MedSAM ?묒뾽 寃곌낵?낅땲??")
                                  : pick(locale, "The preview starts after the lesion box is saved.", "蹂묐? 諛뺤뒪媛 ??λ릺硫?誘몃━蹂닿린媛 ?쒖옉?⑸땲??")}
                            </span>
                          </div>
                        </Card>
                      </div>
                    ) : null}
                    <MetricGrid columns={4} className={savedImageMetricGridClass}>
                          <MetricItem value={translateOption(locale, "view", image.view)} label={pick(locale, "View", "뷰")} />
                      <MetricItem
                        value={image.is_representative ? pick(locale, "Representative", "????대?吏") : pick(locale, "Supporting image", "蹂댁“ ?대?吏")}
                        label={pick(locale, "Role", "??븷")}
                      />
                      <MetricItem
                        value={formatImageQualityScore(image.quality_scores?.quality_score, common.notAvailable)}
                        label={pick(locale, "Q-score", "Q-score")}
                      />
                      <MetricItem
                        value={formatImageQualityScore(image.quality_scores?.view_score, common.notAvailable)}
                        label={pick(locale, "View score", "View score")}
                      />
                    </MetricGrid>
                    <div className={savedImageActionBarClass}>
                      <span className={docSiteBadgeClass}>{boxStatusCopy}</span>
                      <Button
                        className={togglePillClass(image.is_representative, true)}
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => void handleSetSavedRepresentative(image.image_id)}
                        disabled={representativeBusyImageId === image.image_id || image.is_representative}
                      >
                        {representativeBusyImageId === image.image_id
                          ? common.loading
                          : image.is_representative
                            ? pick(locale, "Representative", "????대?吏")
                            : pick(locale, "Set representative", "대표 이미지로 지정")}
                      </Button>
                      <label className={visitContextSelectClass}>
                        <span>{pick(locale, "Prompt input", "Prompt ?낅젰")}</span>
                        <select
                          className="min-h-11 rounded-[var(--radius-md)] border border-border bg-white/60 px-3.5 text-sm text-ink outline-none transition duration-150 ease-out focus:border-brand/25 focus:ring-4 focus:ring-[rgba(48,88,255,0.12)] dark:bg-white/4"
                          value={semanticPromptInputMode}
                          onChange={(event) => setSemanticPromptInputMode(event.target.value as SemanticPromptInputMode)}
                        >
                          {semanticPromptInputOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <Button
                        className={togglePillClass(promptReviewOpen, true)}
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => void handleReviewSemanticPrompts(image.image_id)}
                        disabled={semanticPromptBusyImageId === image.image_id}
                      >
                        {semanticPromptBusyImageId === image.image_id
                          ? common.loading
                          : promptReviewOpen
                            ? pick(locale, "Hide prompt review", "Prompt review ?リ린")
                            : pick(locale, "Review prompts", "Prompt review")}
                      </Button>
                    </div>
                    {promptReviewOpen ? (
                      <Card as="div" variant="nested" className={semanticPromptReviewClass}>
                        {semanticPromptErrors[image.image_id] ? (
                          <div className={emptySurfaceClass}>{semanticPromptErrors[image.image_id]}</div>
                        ) : semanticPromptReviews[image.image_id] ? (
                          <>
                            <div className={semanticPromptReviewHeadClass}>
                              <strong>{pick(locale, "BiomedCLIP prompt ranking", "BiomedCLIP prompt ranking")}</strong>
                              <span>
                                {semanticPromptReviews[image.image_id].dictionary_name} 쨌 {semanticPromptReviews[image.image_id].model_name}
                              </span>
                            </div>
                            <Card as="div" variant="nested" className={semanticPromptLayerClass}>
                              <div className={semanticPromptLayerHeadClass}>
                                <strong>{pick(locale, "Overall top 3", "Overall top 3")}</strong>
                              </div>
                              <div className={semanticPromptMatchListClass}>
                                {semanticPromptReviews[image.image_id].overall_top_matches.map((match, index) => (
                                  <div key={`${image.image_id}-overall-${match.prompt_id}`} className={semanticPromptMatchClass}>
                                    <div className={semanticPromptRankClass}>{index + 1}</div>
                                    <div className={semanticPromptCopyClass}>
                                      <strong>{match.label}</strong>
                                      <span>{match.prompt}</span>
                                    </div>
                                    <div className={semanticPromptScoreClass}>{formatSemanticScore(match.score, common.notAvailable)}</div>
                                  </div>
                                ))}
                              </div>
                            </Card>
                            <div className={semanticPromptGridClass}>
                              {semanticPromptReviews[image.image_id].layers.map((layer) => (
                                <Card as="div" variant="nested" key={`${image.image_id}-${layer.layer_id}`} className={semanticPromptLayerClass}>
                                  <div className={semanticPromptLayerHeadClass}>
                                    <strong>{layer.layer_label}</strong>
                                  </div>
                                  <div className={semanticPromptMatchListClass}>
                                    {layer.matches.map((match, index) => (
                                      <div key={`${image.image_id}-${layer.layer_id}-${match.prompt_id}`} className={semanticPromptMatchClass}>
                                        <div className={semanticPromptRankClass}>{index + 1}</div>
                                        <div className={semanticPromptCopyClass}>
                                          <strong>{match.label}</strong>
                                          <span>{match.prompt}</span>
                                        </div>
                                        <div className={semanticPromptScoreClass}>{formatSemanticScore(match.score, common.notAvailable)}</div>
                                      </div>
                                    ))}
                                  </div>
                                </Card>
                              ))}
                            </div>
                          </>
                        ) : (
                          <div className={emptySurfaceClass}>
                            {pick(locale, "Run the review once to inspect the top-ranked prompt matches.", "Top-ranked prompt score瑜?蹂대젮硫?review瑜??ㅽ뻾?섏꽭??")}
                          </div>
                        )}
                      </Card>
                    ) : null}
                    </Card>
                )})}
              </div>
              {!selectedCaseImages.length && !panelBusy ? (
                <div className={emptySurfaceClass}>{pick(locale, "No saved images are attached to this case yet.", "??耳?댁뒪?먮뒗 ?꾩쭅 ????대?吏媛 ?놁뒿?덈떎.")}</div>
              ) : null}
            </section>

            <div className="grid gap-6 xl:grid-cols-2">
              <section className={docSectionClass}>
                <SectionHeader
                  className={previewSectionHeadClass}
                  eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Cornea preview", "媛곷쭑 crop 誘몃━蹂닿린")}</div>}
                  title={pick(locale, "Source, cornea mask, and crop", "?먮낯, 媛곷쭑 mask, crop 鍮꾧탳")}
                  titleAs="h4"
                  description={pick(
                    locale,
                    "Generate ROI previews to compare the original image with the cornea segmentation and crop.",
                    "?먮낯 ?대?吏? 媛곷쭑 segmentation, crop????踰덉뿉 鍮꾧탳?????덈룄濡?ROI 誘몃━蹂닿린瑜??앹꽦?⑸땲??"
                  )}
                  aside={
                    <div className={previewSectionActionsClass}>
                      <span className={docSiteBadgeClass}>
                        {roiPreviewBusy ? common.loading : `${roiPreviewItems.length} ${pick(locale, "results", "寃곌낵")}`}
                      </span>
                      <Button
                        className={previewRunButtonClass}
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => void handleRunRoiPreview()}
                        disabled={roiPreviewBusy || !canRunRoiPreview}
                      >
                        {roiPreviewBusy ? pick(locale, "Preparing...", "以鍮?以?..") : pick(locale, "Preview cornea crop", "媛곷쭑 crop 誘몃━蹂닿린 ?ㅽ뻾")}
                      </Button>
                    </div>
                  }
                />
                {!canRunRoiPreview ? <p>{pick(locale, "Viewer accounts can inspect images, but cornea preview remains disabled.", "酉곗뼱 怨꾩젙? ?대?吏??蹂????덉?留?媛곷쭑 crop 誘몃━蹂닿린???ㅽ뻾?????놁뒿?덈떎.")}</p> : null}
                {canRunRoiPreview && roiPreviewItems.length === 0 ? (
                  <p>{pick(locale, "Generate a preview to compare the saved source images with their cornea crops.", "??λ맂 ?먮낯 ?대?吏? 媛곷쭑 crop??鍮꾧탳?섎젮硫?誘몃━蹂닿린瑜??앹꽦?섏꽭??")}</p>
                ) : null}
                {roiPreviewItems.length > 0 ? (
                  <div className={panelImageStackClass}>
                    {roiPreviewItems.map((item) => (
                      <Card as="article" variant="nested" key={`${item.image_id ?? item.source_image_path}:roi`} className={panelImageCardClass}>
                        <MetricGrid columns={3} className={previewItemMetricGridClass}>
                          <MetricItem value={translateOption(locale, "view", item.view)} label={pick(locale, "View", "뷰")} />
                          <MetricItem
                            value={item.is_representative ? pick(locale, "Representative", "????대?吏") : pick(locale, "Supporting image", "蹂댁“ ?대?吏")}
                            label={pick(locale, "Role", "??븷")}
                          />
                          <MetricItem value={item.backend} label={pick(locale, "Backend", "Backend")} />
                        </MetricGrid>
                        <div className={panelPreviewGridClass}>
                          <div>
                            {item.source_preview_url ? (
                              <img src={item.source_preview_url} alt={`${item.view} source`} className={panelImagePreviewClass} />
                            ) : (
                              <div className={panelImageFallbackClass}>{pick(locale, "Source preview unavailable", "?먮낯 誘몃━蹂닿린瑜??쒖떆?????놁뒿?덈떎")}</div>
                            )}
                            <div className={panelImageCopyClass}>
                              <strong>{pick(locale, "Source", "?먮낯")}</strong>
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
                              <div className={panelImageFallbackClass}>{pick(locale, "Cornea mask unavailable", "媛곷쭑 mask瑜??쒖떆?????놁뒿?덈떎")}</div>
                            )}
                            <div className={panelImageCopyClass}>
                              <strong>{pick(locale, "Cornea mask", "媛곷쭑 mask")}</strong>
                            </div>
                          </div>
                          <div>
                            {item.roi_crop_url ? (
                              <img src={item.roi_crop_url} alt={`${item.view} cornea crop`} className={panelImagePreviewClass} />
                            ) : (
                              <div className={panelImageFallbackClass}>{pick(locale, "Cornea crop unavailable", "媛곷쭑 crop???쒖떆?????놁뒿?덈떎")}</div>
                            )}
                            <div className={panelImageCopyClass}>
                              <strong>{pick(locale, "Cornea crop", "媛곷쭑 crop")}</strong>
                            </div>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                ) : null}
              </section>

              <section className={docSectionClass}>
                <SectionHeader
                  className={previewSectionHeadClass}
                  eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Lesion preview", "蹂묐? crop 誘몃━蹂닿린")}</div>}
                  title={pick(locale, "Source, lesion mask, and crop", "?먮낯, 蹂묐? mask, crop 鍮꾧탳")}
                  titleAs="h4"
                  description={pick(
                    locale,
                    "Generate lesion previews to compare boxed images with their lesion-centered mask and crop.",
                    "諛뺤뒪瑜?吏?뺥븳 ?대?吏? 蹂묐? 以묒떖 mask, crop 寃곌낵瑜???踰덉뿉 鍮꾧탳?????덈룄濡?誘몃━蹂닿린瑜??앹꽦?⑸땲??"
                  )}
                  aside={
                    <div className={previewSectionActionsClass}>
                      <span className={docSiteBadgeClass}>
                        {lesionPreviewBusy ? common.loading : `${lesionPreviewItems.length} ${pick(locale, "results", "寃곌낵")}`}
                      </span>
                      <Button
                        className={previewRunButtonClass}
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => void handleRunLesionPreview()}
                        disabled={lesionPreviewBusy || selectedCaseImages.length === 0}
                      >
                        {lesionPreviewBusy ? pick(locale, "Preparing...", "以鍮?以?..") : pick(locale, "Preview lesion crop", "蹂묐? crop 誘몃━蹂닿린 ?ㅽ뻾")}
                      </Button>
                    </div>
                  }
                />
                {!selectedCaseImages.length ? <p>{pick(locale, "Select a saved case with uploaded images before running lesion preview.", "蹂묐? crop 誘몃━蹂닿린瑜??ㅽ뻾?섎젮硫??낅줈???대?吏媛 ?덈뒗 ??λ맂 耳?댁뒪瑜??좏깮?섏꽭??")}</p> : null}
                {selectedCaseImages.length > 0 && lesionPreviewItems.length === 0 ? (
                  <p>
                    {hasAnySavedLesionBox
                      ? pick(locale, "Generate a preview to compare each boxed image with its lesion-centered crop.", "諛뺤뒪媛 ??λ맂 媛??대?吏瑜?蹂묐? 以묒떖 crop怨?鍮꾧탳?섎젮硫?誘몃━蹂닿린瑜??앹꽦?섏꽭??")
                      : pick(locale, "Save at least one lesion box in the saved images section, then run preview.", "????대?吏 ?뱀뀡?먯꽌 蹂묐? 諛뺤뒪瑜??섎굹 ?댁긽 ??ν븳 ??誘몃━蹂닿린瑜??ㅽ뻾?섏꽭??")}
                  </p>
                ) : null}
                {lesionPreviewItems.length > 0 ? (
                  <div className={panelImageStackClass}>
                    {lesionPreviewItems.map((item) => (
                      <Card as="article" variant="nested" key={`${item.image_id ?? item.source_image_path}:lesion`} className={panelImageCardClass}>
                        <MetricGrid columns={3} className={previewItemMetricGridClass}>
                          <MetricItem value={translateOption(locale, "view", item.view)} label={pick(locale, "View", "뷰")} />
                          <MetricItem
                            value={item.is_representative ? pick(locale, "Representative", "????대?吏") : pick(locale, "Supporting image", "蹂댁“ ?대?吏")}
                            label={pick(locale, "Role", "??븷")}
                          />
                          <MetricItem value={item.backend} label={pick(locale, "Backend", "Backend")} />
                        </MetricGrid>
                        <div className={panelPreviewGridClass}>
                          <div>
                            {item.source_preview_url ? (
                              <img src={item.source_preview_url} alt={`${item.view} source`} className={panelImagePreviewClass} />
                            ) : (
                              <div className={panelImageFallbackClass}>{pick(locale, "Source preview unavailable", "?먮낯 誘몃━蹂닿린瑜??쒖떆?????놁뒿?덈떎")}</div>
                            )}
                            <div className={panelImageCopyClass}>
                              <strong>{pick(locale, "Source", "?먮낯")}</strong>
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
                              <div className={panelImageFallbackClass}>{pick(locale, "Lesion mask unavailable", "蹂묐? mask瑜??쒖떆?????놁뒿?덈떎")}</div>
                            )}
                            <div className={panelImageCopyClass}>
                              <strong>{pick(locale, "Lesion mask", "蹂묐? mask")}</strong>
                            </div>
                          </div>
                          <div>
                            {item.lesion_crop_url ? (
                              <img src={item.lesion_crop_url} alt={`${item.view} lesion crop`} className={panelImagePreviewClass} />
                            ) : (
                              <div className={panelImageFallbackClass}>{pick(locale, "Lesion crop unavailable", "蹂묐? crop???쒖떆?????놁뒿?덈떎")}</div>
                            )}
                            <div className={panelImageCopyClass}>
                              <strong>{pick(locale, "Lesion crop", "蹂묐? crop")}</strong>
                            </div>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                ) : null}
              </section>
            </div>

            <section className={docSectionClass}>
              <SectionHeader
                className={docSectionHeadClass}
                eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Validation and AI Clinic", "寃利?諛?AI Clinic")}</div>}
                title={pick(locale, "Validation, artifacts, and retrieval support", "검증, 아티팩트, 검색 지원")}
                titleAs="h4"
                description={pick(
                  locale,
                  "Review model validation, artifacts, similar-patient retrieval, and differential support in a wider layout.",
                  "紐⑤뜽 寃利? ?꾪떚?⑺듃, ?좎궗 ?섏옄 寃?? differential support瑜??볦? ?덉씠?꾩썐?먯꽌 ?뺤씤?⑸땲??"
                )}
                aside={<span className={docSiteBadgeClass}>{`${selectedCaseImages.length} ${pick(locale, "images", "?대?吏")}`}</span>}
              />
              <div className={panelStackClass}>
                {validationPanelContent}
                {aiClinicPanelContent}
              </div>
            </section>
          </section>
          ) : (
          <section className={docSurfaceClass}>
            <SectionHeader
              className={docTitleRowClass}
              eyebrow={<div className={docEyebrowClass}>{pick(locale, "Case Authoring", "利앸? ?묒꽦")}</div>}
              title={draft.patient_id.trim() || pick(locale, "Untitled keratitis case", "?쒕ぉ ?녿뒗 媛곷쭑??耳?댁뒪")}
              titleAs="h3"
              description={pick(
                locale,
                "Capture the intake first, then move into image upload and box authoring once the visit details are fixed.",
                "癒쇱? 湲곕낯 intake瑜?留덉튂怨? 諛⑸Ц ?뺣낫媛 怨좎젙?섎㈃ ?대?吏 ?낅줈?쒖? box authoring ?④퀎濡??대룞?⑸땲??"
              )}
              aside={
                <div className={docTitleMetaClass}>
                  <div className={docSiteBadgeClass}>{selectedSiteId ?? pick(locale, "Select a hospital", "蹂묒썝 ?좏깮")}</div>
                  <span className={docSiteBadgeClass}>{draftStatusLabel}</span>
                </div>
              }
            />
            <div className={docBadgeRowClass}>
              <span className={docSiteBadgeClass}>{`${draftImages.length} ${pick(locale, "draft images", "?꾩떆 ?대?吏")}`}</span>
              <span className={docSiteBadgeClass}>{`${pick(locale, "Visit reference", "방문 기준")}`}</span>
              {draftImages.length > 0 ? (
                <span className={docSiteBadgeClass}>{pick(locale, "Unsaved image files stay in this tab only", "저장되지 않은 이미지 파일은 현재 탭에만 유지됩니다")}</span>
              ) : null}
            </div>

            <PatientVisitForm
              locale={locale}
              draft={draft}
              draftImagesCount={draftImages.length}
              notAvailableLabel={common.notAvailable}
              sexOptions={SEX_OPTIONS}
              contactLensOptions={CONTACT_LENS_OPTIONS}
              predisposingFactorOptions={PREDISPOSING_FACTOR_OPTIONS}
              visitStatusOptions={VISIT_STATUS_OPTIONS}
              cultureSpecies={CULTURE_SPECIES}
              speciesOptions={speciesOptions}
              pendingOrganism={pendingOrganism}
              pendingSpeciesOptions={pendingSpeciesOptions}
              showAdditionalOrganismForm={showAdditionalOrganismForm}
              intakeOrganisms={intakeOrganisms}
              primaryOrganismSummary={organismSummaryLabel(draft.culture_category, draft.culture_species, draft.additional_organisms, 2)}
              resolvedVisitReferenceLabel={resolvedVisitReferenceLabel}
              actualVisitDateLabel={actualVisitDateLabel}
              setDraft={setDraft}
              setPendingOrganism={setPendingOrganism}
              setShowAdditionalOrganismForm={setShowAdditionalOrganismForm}
              togglePredisposingFactor={togglePredisposingFactor}
              updatePrimaryOrganism={updatePrimaryOrganism}
              addAdditionalOrganism={addAdditionalOrganism}
              removeAdditionalOrganism={removeAdditionalOrganism}
              onCompleteIntake={handleCompleteIntake}
            />
            {draft.intake_completed ? (
              <ImageManagerPanel
                locale={locale}
                whiteDraftImages={whiteDraftImages}
                fluoresceinDraftImages={fluoresceinDraftImages}
                draftLesionPromptBoxes={draftLesionPromptBoxes}
                whiteFileInputRef={whiteFileInputRef}
                fluoresceinFileInputRef={fluoresceinFileInputRef}
                openFilePicker={openFilePicker}
                appendFiles={appendFiles}
                handleDraftLesionPointerDown={handleDraftLesionPointerDown}
                handleDraftLesionPointerMove={handleDraftLesionPointerMove}
                finishDraftLesionPointer={finishDraftLesionPointer}
                removeDraftImage={removeDraftImage}
                setRepresentativeImage={setRepresentativeImage}
                onSaveCase={() => void handleSaveCase()}
                saveBusy={saveBusy}
                selectedSiteId={selectedSiteId}
              />
            ) : null}
          </section>
          )}

          <aside className={workspacePanelClass}>
            {selectedCase ? (
              <div className={panelStackClass}>
                <ContributionHistoryPanel
                  locale={locale}
                  selectedCase={selectedCase}
                  canRunValidation={canRunValidation}
                  canContributeSelectedCase={canContributeSelectedCase}
                  hasValidationResult={Boolean(validationResult)}
                  contributionBusy={contributionBusy}
                  contributionResult={contributionResult}
                  historyBusy={historyBusy}
                  caseHistory={caseHistory}
                  onContributeCase={() => void handleContributeCase()}
                  completionContent={completionContent}
                  formatProbability={formatProbability}
                  notAvailableLabel={common.notAvailable}
                />
              </div>
            ) : (
              <div className={panelStackClass}>
                <Card as="section" variant="panel" className="grid gap-4 p-5">
                  <SectionHeader
                    titleAs="h4"
                    title={pick(locale, "Selected hospital", "선택한 병원")}
                    aside={
                      <span className="inline-flex min-h-9 items-center rounded-full border border-border bg-white/55 px-3 text-[0.78rem] font-medium text-muted dark:bg-white/4">
                        {selectedSiteId ?? pick(locale, "none", "없음")}
                      </span>
                    }
                  />
                  <MetricGrid columns={2}>
                    <MetricItem value={summary?.n_patients ?? 0} label={pick(locale, "patients", "환자")} />
                    <MetricItem value={summary?.n_visits ?? 0} label={pick(locale, "visits", "방문")} />
                    <MetricItem value={summary?.n_images ?? 0} label={pick(locale, "images", "이미지")} />
                    <MetricItem value={summary?.n_validation_runs ?? 0} label={pick(locale, "validations", "검증")} />
                  </MetricGrid>
                </Card>
              </div>
            )}
          </aside>
        </div>
      </section>

      {toast ? (
        <div className={workspaceToastClass(toast.tone)}>
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
