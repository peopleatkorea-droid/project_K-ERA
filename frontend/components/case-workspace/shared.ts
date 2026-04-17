import type {
  AiClinicResponse,
  AiClinicSimilarCaseRecord,
  CaseSummaryRecord,
  CaseValidationResponse,
  ImageRecord,
  LesionPreviewRecord,
  PatientListRowRecord,
  PatientListThumbnailRecord,
  RoiPreviewRecord,
  SemanticPromptInputMode,
  SemanticPromptReviewResponse,
} from "../../lib/api";
import type { Locale } from "../../lib/i18n";

export type SavedImagePreview = ImageRecord & {
  preview_url: string | null;
};

export type RoiPreviewCard = RoiPreviewRecord & {
  source_preview_url: string | null;
  roi_crop_url: string | null;
  medsam_mask_url: string | null;
};

export type LesionPreviewCard = LesionPreviewRecord & {
  source_preview_url: string | null;
  lesion_crop_url: string | null;
  lesion_mask_url: string | null;
};

export type PatientListThumbnail = PatientListThumbnailRecord;
export type PatientListRow = PatientListRowRecord;

export type NormalizedBox = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type LesionBoxMap = Record<string, NormalizedBox | null>;
export type SemanticPromptReviewMap = Record<string, SemanticPromptReviewResponse>;
export type SemanticPromptErrorMap = Record<string, string>;
export type SemanticPromptInputOption = {
  value: SemanticPromptInputMode;
  label: string;
};

export type LiveLesionPreviewState = {
  job_id: string | null;
  status: "idle" | "running" | "done" | "failed";
  error: string | null;
  backend: string | null;
  prompt_signature: string | null;
  lesion_mask_url: string | null;
  lesion_crop_url: string | null;
};

export type LiveLesionPreviewMap = Record<string, LiveLesionPreviewState>;

export type AiClinicSimilarCasePreview = AiClinicSimilarCaseRecord & {
  preview_url: string | null;
};

export type AiClinicPreviewResponse = Omit<AiClinicResponse, "similar_cases"> & {
  similar_cases: AiClinicSimilarCasePreview[];
};

export type CaseWorkspaceValidationRunOptions = {
  modelVersionId?: string | null;
  selectionProfile?: "single_case_review" | "visit_level_review";
  ignoreSelectedModel?: boolean;
};

export type CaseWorkspaceModelCompareRunOptions = {
  modelVersionIds?: string[];
  executionDevice?: string | undefined;
  preferPreparedMil?: boolean;
};

export type CaseWorkspaceAiClinicRunOptions = {
  validationResult?: CaseValidationResponse | null;
};

export type LocalePick = (locale: Locale, en: string, ko: string) => string;
export type TranslateOption = (
  locale: Locale,
  group: "sex" | "contactLens" | "predisposing" | "smear" | "visitStatus" | "view" | "cultureCategory",
  value: string
) => string;
