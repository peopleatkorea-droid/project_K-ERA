"use client";

import type { PatientIdLookupResponse } from "../../lib/api";
import { pick, type Locale } from "../../lib/i18n";
import {
  displayVisitReference,
  resolveDraftVisitReference,
  type DraftStateShape,
} from "./case-workspace-draft-helpers";
import { workspaceCenterClass } from "../ui/workspace-patterns";

export type CaseWorkspaceRailView = "cases" | "patients";

export type LatestAutosavedDraft = {
  patientId: string;
  visitLabel: string;
  savedLabel: string;
} | null;

type EditingCaseContext = {
  patient_id: string;
  visit_date: string;
  created_at?: string | null;
  created_by_user_id?: string | null;
} | null;

type BuildCaseWorkspaceChromeArgs = {
  locale: Locale;
  localeTag: string;
  railView: CaseWorkspaceRailView;
  hasSelectedCase: boolean;
  isAuthoringCanvas: boolean;
  desktopFastMode: boolean;
  draft: Pick<
    DraftStateShape,
    "patient_id" | "visit_status" | "follow_up_number" | "is_initial_visit" | "intake_completed"
  >;
  draftSavedAt: string | null;
  patientIdLookup: PatientIdLookupResponse | null;
  editingCaseContext: EditingCaseContext;
  listViewHeaderCopy: string;
  draftAutosaved: (time: string) => string;
  draftUnsaved: string;
};

export type CaseWorkspaceChromeState = {
  resolvedVisitReferenceLabel: string;
  draftStatusLabel: string;
  latestAutosavedDraft: LatestAutosavedDraft;
  mainHeaderTitle: string;
  mainHeaderCopy: string;
  showSecondaryPanel: boolean;
  showPatientListSidebar: boolean;
  mainLayoutClass: string;
};

function matchingDraftPatientLookup(
  patientIdLookup: PatientIdLookupResponse | null,
  draftPatientId: string,
): PatientIdLookupResponse | null {
  return patientIdLookup &&
    patientIdLookup.requested_patient_id.trim() === draftPatientId.trim()
    ? patientIdLookup
    : null;
}

function buildDraftStatusLabel(
  draftSavedAt: string | null,
  localeTag: string,
  draftAutosaved: (time: string) => string,
  draftUnsaved: string,
): string {
  if (!draftSavedAt) {
    return draftUnsaved;
  }
  return draftAutosaved(
    new Date(draftSavedAt).toLocaleTimeString(localeTag, {
      hour: "2-digit",
      minute: "2-digit",
    }),
  );
}

function buildLatestAutosavedDraft(
  locale: Locale,
  draft: Pick<DraftStateShape, "patient_id" | "intake_completed">,
  draftSavedAt: string | null,
  resolvedVisitReferenceLabel: string,
  draftStatusLabel: string,
): LatestAutosavedDraft {
  if (!draftSavedAt || draft.intake_completed) {
    return null;
  }
  return {
    patientId:
      draft.patient_id.trim() || pick(locale, "Untitled draft", "임시 케이스"),
    visitLabel: resolvedVisitReferenceLabel,
    savedLabel: draftStatusLabel,
  };
}

function buildWorkspaceHeader(
  locale: Locale,
  railView: CaseWorkspaceRailView,
  hasSelectedCase: boolean,
  listViewHeaderCopy: string,
): {
  title: string;
  copy: string;
} {
  if (railView === "patients") {
    return {
      title: pick(locale, "Patient list", "환자 목록"),
      copy: listViewHeaderCopy,
    };
  }
  if (hasSelectedCase) {
    return {
      title: pick(locale, "Case review", "케이스 리뷰"),
      copy: pick(
        locale,
        "Review the saved visit, validation context, and contribution history in one place.",
        "저장된 방문, 검증 맥락, 기여 이력을 한 곳에서 검토합니다.",
      ),
    };
  }
  return {
    title: pick(locale, "Case canvas", "케이스 캔버스"),
    copy: pick(
      locale,
      "Capture intake, images, and submission for one case.",
      "한 케이스의 intake, 이미지, 제출 상태를 정리합니다.",
    ),
  };
}

function buildWorkspaceLayoutState(
  railView: CaseWorkspaceRailView,
  hasSelectedCase: boolean,
  isAuthoringCanvas: boolean,
  desktopFastMode: boolean,
): {
  showSecondaryPanel: boolean;
  showPatientListSidebar: boolean;
  mainLayoutClass: string;
} {
  const showSecondaryPanel =
    !desktopFastMode &&
    railView !== "patients" &&
    (isAuthoringCanvas || hasSelectedCase);
  const showPatientListSidebar = railView === "patients";
  const selectedCaseLayoutClass =
    hasSelectedCase && showSecondaryPanel
      ? "grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px_360px] xl:items-start"
      : hasSelectedCase
        ? "grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px] xl:items-start"
        : null;
  const mainLayoutClass = hasSelectedCase
    ? (selectedCaseLayoutClass ?? "grid gap-6")
    : showSecondaryPanel || showPatientListSidebar
      ? workspaceCenterClass
      : "grid gap-6";
  return {
    showSecondaryPanel,
    showPatientListSidebar,
    mainLayoutClass,
  };
}

export function buildCaseWorkspaceChromeState({
  locale,
  localeTag,
  railView,
  hasSelectedCase,
  isAuthoringCanvas,
  desktopFastMode,
  draft,
  draftSavedAt,
  patientIdLookup,
  editingCaseContext,
  listViewHeaderCopy,
  draftAutosaved,
  draftUnsaved,
}: BuildCaseWorkspaceChromeArgs): CaseWorkspaceChromeState {
  const resolvedVisitReferenceLabel = displayVisitReference(
    locale,
    resolveDraftVisitReference(
      draft,
      editingCaseContext
        ? null
        : matchingDraftPatientLookup(patientIdLookup, draft.patient_id),
    ),
  );
  const draftStatusLabel = buildDraftStatusLabel(
    draftSavedAt,
    localeTag,
    draftAutosaved,
    draftUnsaved,
  );
  const latestAutosavedDraft = buildLatestAutosavedDraft(
    locale,
    draft,
    draftSavedAt,
    resolvedVisitReferenceLabel,
    draftStatusLabel,
  );
  const header = buildWorkspaceHeader(
    locale,
    railView,
    hasSelectedCase,
    listViewHeaderCopy,
  );
  const layout = buildWorkspaceLayoutState(
    railView,
    hasSelectedCase,
    isAuthoringCanvas,
    desktopFastMode,
  );
  return {
    resolvedVisitReferenceLabel,
    draftStatusLabel,
    latestAutosavedDraft,
    mainHeaderTitle: header.title,
    mainHeaderCopy: header.copy,
    showSecondaryPanel: layout.showSecondaryPanel,
    showPatientListSidebar: layout.showPatientListSidebar,
    mainLayoutClass: layout.mainLayoutClass,
  };
}
