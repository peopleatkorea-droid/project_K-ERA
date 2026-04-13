"use client";

import type {
  OrganismRecord,
  PatientIdLookupResponse,
  VisitRecord,
} from "../../lib/api";
import { pick, type Locale } from "../../lib/i18n";

const CULTURE_STATUS_OPTIONS = new Set([
  "positive",
  "negative",
  "not_done",
  "unknown",
]);
const DEFAULT_CULTURE_STATUS = "unknown";

export const FOLLOW_UP_VISIT_PATTERN = /^(?:F[\s/]*U|U)[-\s_#]*0*(\d+)$/i;

export type DraftStateShape = {
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

export function createDraftState(): DraftStateShape {
  return {
    patient_id: "",
    chart_alias: "",
    local_case_code: "",
    sex: "female",
    age: "65",
    actual_visit_date: "",
    follow_up_number: "1",
    culture_status: DEFAULT_CULTURE_STATUS,
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

export function draftStorageKey(userId: string, siteId: string): string {
  return `kera_workspace_draft:${userId}:${siteId}`;
}

export function favoriteStorageKey(userId: string, siteId: string): string {
  return `kera_workspace_favorites:${userId}:${siteId}`;
}

export function normalizeCultureStatus(
  value: string | null | undefined,
): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  return CULTURE_STATUS_OPTIONS.has(normalized)
    ? normalized
    : DEFAULT_CULTURE_STATUS;
}

export function isPositiveCultureStatus(
  value: string | null | undefined,
): boolean {
  return normalizeCultureStatus(value) === "positive";
}

export function cultureStatusNeedsOrganism(
  value: string | null | undefined,
): boolean {
  return isPositiveCultureStatus(value);
}

export function organismKey(
  organism: Pick<OrganismRecord, "culture_category" | "culture_species">,
): string {
  return `${organism.culture_category.trim().toLowerCase()}::${organism.culture_species.trim().toLowerCase()}`;
}

export function normalizeAdditionalOrganisms(
  primaryCategory: string,
  primarySpecies: string,
  organisms: OrganismRecord[] | undefined,
): OrganismRecord[] {
  const primaryKey = organismKey({
    culture_category: primaryCategory,
    culture_species: primarySpecies,
  });
  const seen = new Set<string>([primaryKey]);
  const normalized: OrganismRecord[] = [];
  for (const organism of organisms ?? []) {
    const culture_category = String(organism?.culture_category ?? "")
      .trim()
      .toLowerCase();
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

export function buildVisitReference(
  draft: Pick<DraftStateShape, "follow_up_number" | "is_initial_visit">,
): string {
  if (draft.is_initial_visit) {
    return "Initial";
  }
  return `FU #${String(Number(draft.follow_up_number) || 1)}`;
}

function followUpReferenceFromPatientLookup(
  patientLookup: PatientIdLookupResponse | null,
): string | null {
  if (!patientLookup?.exists || Number(patientLookup.visit_count || 0) <= 0) {
    return null;
  }
  const latestVisitDate = String(patientLookup.latest_visit_date ?? "").trim();
  const followUpMatch = latestVisitDate.match(FOLLOW_UP_VISIT_PATTERN);
  const nextFollowUpNumber = followUpMatch ? Number(followUpMatch[1]) || 1 : 1;
  return `FU #${String(nextFollowUpNumber + (followUpMatch ? 1 : 0))}`;
}

export function resolveDraftVisitReference(
  draft: Pick<DraftStateShape, "follow_up_number" | "is_initial_visit">,
  patientLookup: PatientIdLookupResponse | null,
): string {
  const requestedVisitReference = buildVisitReference(draft);
  if (!/^initial$/i.test(requestedVisitReference)) {
    return requestedVisitReference;
  }
  return (
    followUpReferenceFromPatientLookup(patientLookup) ?? requestedVisitReference
  );
}

export function displayVisitReference(
  locale: Locale,
  visitReference: string,
): string {
  const normalized = String(visitReference ?? "").trim();
  if (!normalized) {
    return normalized;
  }
  if (/^(initial|초진|珥덉쭊)$/i.test(normalized)) {
    return pick(locale, "Initial", "초진");
  }
  const followUpMatch = normalized.match(FOLLOW_UP_VISIT_PATTERN);
  if (followUpMatch) {
    return `FU #${String(Number(followUpMatch[1]))}`;
  }
  return normalized;
}

export function normalizeRecoveredDraft(
  draft: DraftStateShape,
): DraftStateShape {
  const recoveredDraft = draft as DraftStateShape & { visit_date?: string };
  const normalizedCultureStatus = normalizeCultureStatus(draft.culture_status);
  const normalizedCultureCategory = cultureStatusNeedsOrganism(
    normalizedCultureStatus,
  )
    ? draft.culture_category
    : "";
  const normalizedCultureSpecies = cultureStatusNeedsOrganism(
    normalizedCultureStatus,
  )
    ? draft.culture_species
    : "";
  const normalizedAdditionalOrganisms = normalizeAdditionalOrganisms(
    normalizedCultureCategory,
    normalizedCultureSpecies,
    cultureStatusNeedsOrganism(normalizedCultureStatus)
      ? draft.additional_organisms
      : [],
  );
  const visitReference = String(recoveredDraft.visit_date ?? "").trim();
  const followUpMatch = visitReference.match(FOLLOW_UP_VISIT_PATTERN);
  if (followUpMatch) {
    return {
      ...draft,
      culture_status: normalizedCultureStatus,
      culture_category: normalizedCultureCategory,
      culture_species: normalizedCultureSpecies,
      additional_organisms: normalizedAdditionalOrganisms,
      follow_up_number: String(Number(followUpMatch[1]) || 1),
      is_initial_visit: false,
    };
  }
  if (/^(initial|초진|珥덉쭊)$/i.test(visitReference)) {
    return {
      ...draft,
      culture_status: normalizedCultureStatus,
      culture_category: normalizedCultureCategory,
      culture_species: normalizedCultureSpecies,
      additional_organisms: normalizedAdditionalOrganisms,
      follow_up_number: draft.follow_up_number || "1",
      is_initial_visit: true,
    };
  }
  return {
    ...draft,
    culture_status: normalizedCultureStatus,
    culture_category: normalizedCultureCategory,
    culture_species: normalizedCultureSpecies,
    additional_organisms: normalizedAdditionalOrganisms,
    actual_visit_date:
      String(recoveredDraft.actual_visit_date ?? "").trim() ||
      String(recoveredDraft.visit_date ?? "").trim(),
    follow_up_number: draft.follow_up_number || "1",
    is_initial_visit: draft.is_initial_visit ?? true,
    intake_completed: Boolean(draft.intake_completed),
  };
}

export function hasDraftContent(draft: DraftStateShape): boolean {
  const emptyDraft = createDraftState();
  return (
    draft.patient_id.trim() !== emptyDraft.patient_id ||
    draft.chart_alias.trim() !== emptyDraft.chart_alias ||
    draft.local_case_code.trim() !== emptyDraft.local_case_code ||
    draft.sex !== emptyDraft.sex ||
    draft.age !== emptyDraft.age ||
    draft.actual_visit_date !== emptyDraft.actual_visit_date ||
    draft.follow_up_number !== emptyDraft.follow_up_number ||
    draft.culture_status !== emptyDraft.culture_status ||
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

export function listOrganisms(
  cultureCategory: string,
  cultureSpecies: string,
  additionalOrganisms: OrganismRecord[] | undefined,
): OrganismRecord[] {
  const primarySpecies = cultureSpecies.trim();
  if (!primarySpecies) {
    return normalizeAdditionalOrganisms(
      cultureCategory,
      cultureSpecies,
      additionalOrganisms,
    );
  }
  return [
    {
      culture_category: cultureCategory.trim().toLowerCase(),
      culture_species: primarySpecies,
    },
    ...normalizeAdditionalOrganisms(
      cultureCategory,
      cultureSpecies,
      additionalOrganisms,
    ),
  ];
}

export function organismSummaryLabel(
  cultureCategory: string,
  cultureSpecies: string,
  additionalOrganisms: OrganismRecord[] | undefined,
  maxVisibleSpecies = 1,
): string {
  const organisms = listOrganisms(
    cultureCategory,
    cultureSpecies,
    additionalOrganisms,
  );
  if (!organisms.length) {
    return "";
  }
  if (organisms.length <= maxVisibleSpecies) {
    return organisms.map((organism) => organism.culture_species).join(" / ");
  }
  const visible = organisms
    .slice(0, Math.max(1, maxVisibleSpecies))
    .map((organism) => organism.culture_species)
    .join(" / ");
  return `${visible} + ${organisms.length - Math.max(1, maxVisibleSpecies)}`;
}

export function organismDetailLabel(
  cultureCategory: string,
  cultureSpecies: string,
  additionalOrganisms: OrganismRecord[] | undefined,
): string {
  return listOrganisms(cultureCategory, cultureSpecies, additionalOrganisms)
    .map((organism) => organism.culture_species)
    .join(" / ");
}

export function visitPhaseCopy(
  locale: Locale,
  isInitialVisit: boolean,
): string {
  return isInitialVisit
    ? pick(locale, "Initial", "초진")
    : pick(locale, "Follow-up", "재진");
}

export function computeNextFollowUpNumber(
  visits: Array<Pick<VisitRecord, "visit_date">>,
): number {
  let maxFollowUp = 0;
  for (const visit of visits) {
    const match = String(visit.visit_date ?? "").match(FOLLOW_UP_VISIT_PATTERN);
    if (!match) {
      continue;
    }
    maxFollowUp = Math.max(maxFollowUp, Number(match[1]) || 0);
  }
  return maxFollowUp + 1;
}
