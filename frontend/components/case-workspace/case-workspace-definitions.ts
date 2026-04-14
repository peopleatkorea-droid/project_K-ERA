"use client";

import type { AuthUser, SiteRecord, SiteSummary } from "../../lib/api";
import type { DesktopControlPlaneProbe } from "../../lib/desktop-control-plane-status";
import type { DraftStateShape } from "./case-workspace-draft-helpers";

export const CASE_WORKSPACE_SEX_OPTIONS = ["male", "female", "unknown"];
export const CASE_WORKSPACE_CONTACT_LENS_OPTIONS = [
  "none",
  "soft contact lens",
  "rigid gas permeable",
  "orthokeratology",
  "unknown",
];
export const CASE_WORKSPACE_PREDISPOSING_FACTOR_OPTIONS = [
  "trauma",
  "ocular surface disease",
  "topical steroid use",
  "post surgery",
  "neurotrophic",
  "unknown",
];
export const CASE_WORKSPACE_VISIT_STATUS_OPTIONS = [
  "active",
  "improving",
  "scar",
];
export const CASE_WORKSPACE_CULTURE_STATUS_OPTIONS = [
  "positive",
  "negative",
  "not_done",
  "unknown",
];
export const CASE_WORKSPACE_CULTURE_SPECIES: Record<string, string[]> = {
  bacterial: [
    "Staphylococcus aureus",
    "Staphylococcus epidermidis",
    "Staphylococcus hominis",
    "Coagulase-negative Staphylococcus",
    "Other Staphylococcus species",
    "Streptococcus pneumoniae",
    "Streptococcus viridans group",
    "Other Streptococcus species",
    "Enterococcus faecalis",
    "Gemella species",
    "Granulicatella species",
    "Pseudomonas aeruginosa",
    "Moraxella",
    "Corynebacterium",
    "Rothia",
    "Serratia marcescens",
    "Bacillus",
    "Other Gram-positive rods",
    "Other Gram-negative rods",
    "Haemophilus influenzae",
    "Klebsiella pneumoniae",
    "Enterobacter",
    "Citrobacter",
    "Burkholderia",
    "Pandoraea species",
    "Stenotrophomonas",
    "Achromobacter",
    "Nocardia",
    "Other",
  ],
  fungal: [
    "Fusarium",
    "Aspergillus",
    "Acremonium",
    "Alternaria",
    "Australiasca species",
    "Beauveria bassiana",
    "Bipolaris",
    "Cladophialophora",
    "Cladosporium",
    "Colletotrichum",
    "Curvularia",
    "Exserohilum",
    "Lasiodiplodia",
    "Paecilomyces",
    "Penicillium",
    "Scedosporium",
    "Other Molds",
    "Candida",
    "Other Yeasts",
    "Other",
  ],
};

export const CASE_WORKSPACE_TIMING_LOGS =
  process.env.NEXT_PUBLIC_KERA_WORKSPACE_TIMING_LOGS === "1" ||
  process.env.NEXT_PUBLIC_KERA_BOOTSTRAP_TIMING_LOGS === "1";

export type CaseWorkspaceExecutionMode = "auto" | "cpu" | "gpu";

export type CaseWorkspaceValidationArtifactKind =
  | "gradcam"
  | "gradcam_cornea"
  | "gradcam_lesion"
  | "roi_crop"
  | "medsam_mask"
  | "lesion_crop"
  | "lesion_mask";

export type CaseWorkspaceValidationArtifactPreviews = Partial<
  Record<CaseWorkspaceValidationArtifactKind, string | null>
>;

export type CaseWorkspaceDraftState = DraftStateShape;

export type CaseWorkspacePersistedDraft = {
  draft: CaseWorkspaceDraftState;
  updated_at: string;
};

export type CaseWorkspaceCompletionState = {
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

export type CaseWorkspaceToastState = {
  tone: "success" | "error";
  message: string;
} | null;

export type CaseWorkspaceToastLogEntry = {
  id: string;
  tone: "success" | "error";
  message: string;
  created_at: string;
};

export type CaseWorkspaceProps = {
  token: string;
  user: AuthUser;
  sites: SiteRecord[];
  selectedSiteId: string | null;
  summary: SiteSummary | null;
  canOpenOperations: boolean;
  theme: "dark" | "light";
  controlPlaneStatus?: DesktopControlPlaneProbe | null;
  controlPlaneStatusBusy?: boolean;
  onSelectSite: (siteId: string) => void;
  onExportManifest: () => void;
  onLogout: () => void;
  onOpenOperations: (
    section?: "management" | "dashboard" | "training" | "cross_validation",
  ) => void;
  onOpenHospitalAccessRequest?: () => void;
  onOpenDesktopSettings?: () => void;
  onSiteDataChanged: (siteId: string) => Promise<void>;
  onToggleTheme: () => void;
};

export function formatCaseWorkspaceDateTime(
  value: string | null | undefined,
  localeTag: string,
  emptyLabel: string,
): string {
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

export function executionModeFromDevice(
  device: string | undefined,
): CaseWorkspaceExecutionMode {
  if (device === "cuda") {
    return "gpu";
  }
  if (device === "cpu") {
    return "cpu";
  }
  return "auto";
}
