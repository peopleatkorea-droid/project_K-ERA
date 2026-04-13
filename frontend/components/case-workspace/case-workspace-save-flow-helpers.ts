import type {
  CaseSummaryRecord,
  OrganismRecord,
  VisitRecord,
} from "../../lib/api";

import type {
  PatientListRow,
  PatientListThumbnail,
  SavedImagePreview,
} from "./shared";

export type SaveFlowDraftSnapshot = {
  actual_visit_date: string;
  sex: string;
  age: string;
  culture_status: string;
  culture_category: string;
  culture_species: string;
  contact_lens_use: string;
  predisposing_factor: string[];
  other_history: string;
  visit_status: string;
};

export type SaveFlowPatientPayload = {
  chart_alias: string;
  local_case_code: string;
};

export type SaveFlowEditingCaseSnapshot = {
  created_at?: string | null;
  created_by_user_id?: string | null;
} | null;

export function pickRepresentativeSavedImage(
  uploadedImages: SavedImagePreview[],
): SavedImagePreview | null {
  return (
    uploadedImages.find((image) => image.is_representative) ??
    uploadedImages[0] ??
    null
  );
}

export function buildRepresentativeThumbnail(
  caseId: string,
  uploadedImages: SavedImagePreview[],
): PatientListThumbnail | null {
  const representativeImage = pickRepresentativeSavedImage(uploadedImages);
  if (!representativeImage) {
    return null;
  }
  return {
    case_id: caseId,
    image_id: representativeImage.image_id,
    view: representativeImage.view,
    preview_url: representativeImage.preview_url,
    fallback_url: representativeImage.content_url ?? null,
  };
}

export function buildOptimisticSavedCase(args: {
  patientId: string;
  visitReference: string;
  draft: SaveFlowDraftSnapshot;
  patientPayload: SaveFlowPatientPayload;
  draftNeedsPrimaryOrganism: boolean;
  additionalOrganisms: OrganismRecord[];
  uploadedImages: SavedImagePreview[];
  visitRecord: Partial<VisitRecord>;
  editingSourceCase: SaveFlowEditingCaseSnapshot;
  userId: string;
}): CaseSummaryRecord {
  const {
    patientId,
    visitReference,
    draft,
    patientPayload,
    draftNeedsPrimaryOrganism,
    additionalOrganisms,
    uploadedImages,
    visitRecord,
    editingSourceCase,
    userId,
  } = args;
  const representativeImage = pickRepresentativeSavedImage(uploadedImages);
  const createdAt =
    visitRecord.created_at ??
    editingSourceCase?.created_at ??
    new Date().toISOString();

  return {
    case_id: `${patientId}::${visitReference}`,
    visit_id: String(visitRecord.visit_id ?? `${patientId}::${visitReference}`),
    patient_id: patientId,
    created_by_user_id:
      visitRecord.created_by_user_id ??
      editingSourceCase?.created_by_user_id ??
      userId,
    visit_date: visitReference,
    actual_visit_date: draft.actual_visit_date.trim() || null,
    chart_alias: patientPayload.chart_alias,
    local_case_code: patientPayload.local_case_code,
    sex: draft.sex,
    age: draft.age.trim().length > 0 ? Number(draft.age) : null,
    culture_status: draft.culture_status,
    culture_confirmed:
      draftNeedsPrimaryOrganism &&
      Boolean(draft.culture_category && draft.culture_species.trim()),
    culture_category: draftNeedsPrimaryOrganism ? draft.culture_category : "",
    culture_species: draftNeedsPrimaryOrganism
      ? draft.culture_species.trim()
      : "",
    additional_organisms: draftNeedsPrimaryOrganism ? additionalOrganisms : [],
    contact_lens_use: draft.contact_lens_use,
    predisposing_factor: draft.predisposing_factor,
    other_history: draft.other_history.trim(),
    visit_status: draft.visit_status,
    active_stage: draft.visit_status === "active",
    is_initial_visit: /^initial$/i.test(visitReference),
    smear_result: visitRecord.smear_result ?? "not done",
    polymicrobial:
      draftNeedsPrimaryOrganism && additionalOrganisms.length > 0,
    image_count: uploadedImages.length,
    representative_image_id: representativeImage?.image_id ?? null,
    representative_view: representativeImage?.view ?? null,
    created_at: createdAt,
    latest_image_uploaded_at:
      uploadedImages[uploadedImages.length - 1]?.uploaded_at ?? createdAt,
  };
}

export function buildOptimisticPatientRow(args: {
  optimisticCase: CaseSummaryRecord;
  uploadedImages: SavedImagePreview[];
  currentPatientRow: PatientListRow | undefined;
  currentPatientCaseCount: number;
  organismSummaryLabel: (
    cultureCategory: string,
    cultureSpecies: string,
    additionalOrganisms: OrganismRecord[] | undefined,
    maxVisibleSpecies?: number,
  ) => string;
}): PatientListRow {
  const {
    optimisticCase,
    uploadedImages,
    currentPatientRow,
    currentPatientCaseCount,
    organismSummaryLabel,
  } = args;
  const optimisticThumbnail = buildRepresentativeThumbnail(
    optimisticCase.case_id,
    uploadedImages,
  );

  return {
    patient_id: optimisticCase.patient_id,
    latest_case: optimisticCase,
    case_count: Math.max(1, currentPatientCaseCount),
    representative_thumbnail_count: Math.max(
      optimisticThumbnail ? 1 : 0,
      currentPatientRow?.representative_thumbnail_count ??
        currentPatientRow?.representative_thumbnails.length ??
        0,
    ),
    organism_summary: organismSummaryLabel(
      optimisticCase.culture_category,
      optimisticCase.culture_species,
      optimisticCase.additional_organisms,
      2,
    ),
    representative_thumbnails: [
      ...(optimisticThumbnail ? [optimisticThumbnail] : []),
      ...(currentPatientRow?.representative_thumbnails ?? []).filter(
        (thumbnail) => thumbnail.case_id !== optimisticCase.case_id,
      ),
    ].slice(0, 3),
  };
}
