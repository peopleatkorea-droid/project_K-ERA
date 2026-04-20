import type { MutableRefObject } from "react";

import type { CaseSummaryRecord } from "../../lib/api";

export const WORKSPACE_SLA_TARGET_MS = {
  patientListReady: 1200,
  caseOpenTimelineReady: 900,
  caseOpenGalleryReady: 2200,
} as const;

export type CaseOpenSlaSession = {
  request_id: string;
  site_id: string;
  case_id: string;
  patient_id: string;
  visit_date: string;
  started_at: number;
  seeded_cases: number;
  hydrated_cases: number | null;
  visit_count: number | null;
  uncached_visit_count: number | null;
  timeline_ready_elapsed_ms: number | null;
  gallery_ready_elapsed_ms: number | null;
  timeline_ready_source: "seed" | "hydrate" | null;
  gallery_ready_source: "cache" | "fetch" | null;
  timeline_ready_logged: boolean;
  gallery_ready_logged: boolean;
  summary_logged: boolean;
};

let caseOpenSlaSequence = 0;

function nextCaseOpenSlaRequestId(caseId: string): string {
  caseOpenSlaSequence += 1;
  return `${caseId}:${caseOpenSlaSequence}`;
}

function getMatchingCaseOpenSlaSession(
  sessionRef: MutableRefObject<CaseOpenSlaSession | null>,
  expectedCaseId: string,
): CaseOpenSlaSession | null {
  const session = sessionRef.current;
  if (!session || session.case_id !== expectedCaseId) {
    return null;
  }
  return session;
}

function logCaseOpenSlaSummary(session: CaseOpenSlaSession) {
  if (
    session.summary_logged ||
    session.timeline_ready_elapsed_ms === null ||
    session.gallery_ready_elapsed_ms === null
  ) {
    return;
  }
  session.summary_logged = true;
  console.info("[kera-sla]", {
    workflow: "case-open",
    stage: "summary",
    request_id: session.request_id,
    site_id: session.site_id,
    case_id: session.case_id,
    patient_id: session.patient_id,
    visit_date: session.visit_date,
    seeded_cases: session.seeded_cases,
    hydrated_cases: session.hydrated_cases ?? session.seeded_cases,
    visit_count: session.visit_count ?? session.hydrated_cases ?? session.seeded_cases,
    uncached_visit_count: session.uncached_visit_count ?? 0,
    timeline_ready_elapsed_ms: session.timeline_ready_elapsed_ms,
    gallery_ready_elapsed_ms: session.gallery_ready_elapsed_ms,
    timeline_target_ms: WORKSPACE_SLA_TARGET_MS.caseOpenTimelineReady,
    gallery_target_ms: WORKSPACE_SLA_TARGET_MS.caseOpenGalleryReady,
    timeline_within_sla:
      session.timeline_ready_elapsed_ms <=
      WORKSPACE_SLA_TARGET_MS.caseOpenTimelineReady,
    gallery_within_sla:
      session.gallery_ready_elapsed_ms <=
      WORKSPACE_SLA_TARGET_MS.caseOpenGalleryReady,
    timeline_ready_source: session.timeline_ready_source,
    gallery_ready_source: session.gallery_ready_source,
  });
}

export function startCaseOpenSlaSession(
  siteId: string,
  caseRecord: CaseSummaryRecord,
  seededCases: number,
  startedAt: number,
): CaseOpenSlaSession {
  return {
    request_id: nextCaseOpenSlaRequestId(caseRecord.case_id),
    site_id: siteId,
    case_id: caseRecord.case_id,
    patient_id: caseRecord.patient_id,
    visit_date: caseRecord.visit_date,
    started_at: startedAt,
    seeded_cases: seededCases,
    hydrated_cases: null,
    visit_count: null,
    uncached_visit_count: null,
    timeline_ready_elapsed_ms: null,
    gallery_ready_elapsed_ms: null,
    timeline_ready_source: null,
    gallery_ready_source: null,
    timeline_ready_logged: false,
    gallery_ready_logged: false,
    summary_logged: false,
  };
}

export function logPatientListReadySla(params: {
  siteId: string;
  rows: number;
  totalCount: number;
  startedAt: number;
}) {
  const elapsedMs = Math.round(performance.now() - params.startedAt);
  console.info("[kera-sla]", {
    workflow: "workspace-open",
    stage: "patient-list-ready",
    site_id: params.siteId,
    rows: params.rows,
    total_count: params.totalCount,
    elapsed_ms: elapsedMs,
    target_ms: WORKSPACE_SLA_TARGET_MS.patientListReady,
    within_sla: elapsedMs <= WORKSPACE_SLA_TARGET_MS.patientListReady,
  });
}

export function logCaseOpenTimelineReadySla(
  sessionRef: MutableRefObject<CaseOpenSlaSession | null>,
  expectedCaseId: string,
  params: {
    hydratedCases: number;
    source: "seed" | "hydrate";
  },
) {
  const session = getMatchingCaseOpenSlaSession(sessionRef, expectedCaseId);
  if (!session || session.timeline_ready_logged) {
    return;
  }
  const elapsedMs = Math.round(performance.now() - session.started_at);
  session.timeline_ready_logged = true;
  session.timeline_ready_elapsed_ms = elapsedMs;
  session.timeline_ready_source = params.source;
  session.hydrated_cases = params.hydratedCases;
  console.info("[kera-sla]", {
    workflow: "case-open",
    stage: "case-open-timeline-ready",
    request_id: session.request_id,
    site_id: session.site_id,
    case_id: session.case_id,
    patient_id: session.patient_id,
    visit_date: session.visit_date,
    seeded_cases: session.seeded_cases,
    hydrated_cases: params.hydratedCases,
    elapsed_ms: elapsedMs,
    target_ms: WORKSPACE_SLA_TARGET_MS.caseOpenTimelineReady,
    within_sla: elapsedMs <= WORKSPACE_SLA_TARGET_MS.caseOpenTimelineReady,
    source: params.source,
  });
  logCaseOpenSlaSummary(session);
}

export function logCaseOpenGalleryReadySla(
  sessionRef: MutableRefObject<CaseOpenSlaSession | null>,
  expectedCaseId: string,
  params: {
    visitCount: number;
    uncachedVisitCount: number;
    source: "cache" | "fetch";
  },
) {
  const session = getMatchingCaseOpenSlaSession(sessionRef, expectedCaseId);
  if (!session || session.gallery_ready_logged) {
    return;
  }
  const elapsedMs = Math.round(performance.now() - session.started_at);
  session.gallery_ready_logged = true;
  session.gallery_ready_elapsed_ms = elapsedMs;
  session.visit_count = params.visitCount;
  session.uncached_visit_count = params.uncachedVisitCount;
  session.gallery_ready_source = params.source;
  console.info("[kera-sla]", {
    workflow: "case-open",
    stage: "case-open-gallery-ready",
    request_id: session.request_id,
    site_id: session.site_id,
    case_id: session.case_id,
    patient_id: session.patient_id,
    visit_date: session.visit_date,
    visit_count: params.visitCount,
    uncached_visit_count: params.uncachedVisitCount,
    elapsed_ms: elapsedMs,
    target_ms: WORKSPACE_SLA_TARGET_MS.caseOpenGalleryReady,
    within_sla: elapsedMs <= WORKSPACE_SLA_TARGET_MS.caseOpenGalleryReady,
    source: params.source,
  });
  logCaseOpenSlaSummary(session);
}
