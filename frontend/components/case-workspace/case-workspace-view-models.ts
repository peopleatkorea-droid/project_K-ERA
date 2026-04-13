"use client";

import type { CaseSummaryRecord } from "../../lib/api";
import { pick, type Locale } from "../../lib/i18n";
import { type DraftStateShape } from "./case-workspace-draft-helpers";
import type { SavedImagePreview } from "./shared";

type TranslateOption = (
  locale: Locale,
  group: "sex" | "contactLens" | "predisposing" | "smear" | "visitStatus" | "view" | "cultureCategory",
  value: string,
) => string;

type OrganismSummaryLabel = (
  cultureCategory: string,
  cultureSpecies: string,
  additionalOrganisms: Array<{ culture_category: string; culture_species: string }>,
  limit?: number,
) => string;

export function buildDraftCanvasViewModel(args: {
  locale: Locale;
  draft: Pick<
    DraftStateShape,
    | "patient_id"
    | "visit_status"
    | "culture_category"
    | "culture_species"
    | "additional_organisms"
    | "intake_completed"
  >;
  selectedSiteLabel: string | null;
  draftStatusLabel: string;
  resolvedVisitReferenceLabel: string;
  translateOption: TranslateOption;
  organismSummaryLabel: OrganismSummaryLabel;
}) {
  const {
    locale,
    draft,
    selectedSiteLabel,
    draftStatusLabel,
    resolvedVisitReferenceLabel,
    translateOption,
    organismSummaryLabel,
  } = args;
  return {
    locale,
    selectedSiteLabel,
    draftStatusLabel,
    resolvedVisitReferenceLabel,
    intakeCompleted: draft.intake_completed,
    patientSummaryLabel:
      draft.patient_id.trim() ||
      pick(locale, "Waiting for patient ID", "환자 ID 대기 중"),
    visitSummaryLabel: `${resolvedVisitReferenceLabel} · ${translateOption(
      locale,
      "visitStatus",
      draft.visit_status,
    )}`,
    organismSummary:
      organismSummaryLabel(
        draft.culture_category,
        draft.culture_species,
        draft.additional_organisms,
        1,
      ) || pick(locale, "Choose primary organism", "기본 원인균 선택"),
  };
}

export function buildDraftPatientVisitFormViewModel(args: {
  draft: Pick<
    DraftStateShape,
    "culture_category" | "culture_species" | "additional_organisms"
  >;
  resolvedVisitReferenceLabel: string;
  actualVisitDateLabel: string;
  organismSummaryLabel: OrganismSummaryLabel;
}) {
  const { draft, resolvedVisitReferenceLabel, actualVisitDateLabel, organismSummaryLabel } = args;
  return {
    resolvedVisitReferenceLabel,
    actualVisitDateLabel,
    primaryOrganismSummary: organismSummaryLabel(
      draft.culture_category,
      draft.culture_species,
      draft.additional_organisms,
      2,
    ),
  };
}

export function buildSavedCaseSidebarViewModel(args: {
  selectedCase: Pick<CaseSummaryRecord, "image_count" | "representative_image_id">;
  selectedCaseImages: SavedImagePreview[];
  hasAnySavedLesionBox: boolean;
}) {
  const { selectedCase, selectedCaseImages, hasAnySavedLesionBox } = args;
  return {
    selectedCaseImageCount: Math.max(
      selectedCaseImages.length,
      Number(selectedCase.image_count ?? 0),
    ),
    hasRepresentativeImage:
      Boolean(selectedCase.representative_image_id) ||
      selectedCaseImages.some((image) => image.is_representative),
    hasAnySavedLesionBox,
  };
}
