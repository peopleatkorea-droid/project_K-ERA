import type { CaseSummaryRecord } from "../../lib/api";

import type { SavedImagePreview } from "./shared";

const FOLLOW_UP_VISIT_PATTERN = /^(?:F[\s/]*U|U)[-\s_#]*0*(\d+)$/i;

export function normalizeVisitMatchKey(
  value: string | null | undefined,
): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "";
  }
  if (/^(initial|초진)$/i.test(normalized)) {
    return "initial";
  }
  const followUpMatch = normalized.match(FOLLOW_UP_VISIT_PATTERN);
  if (followUpMatch) {
    return `fu:${String(Number(followUpMatch[1]) || 0)}`;
  }
  return normalized.toLowerCase().replace(/\s+/g, " ");
}

export function scheduleDeferredBrowserTask(
  task: () => void,
  timeoutMs = 180,
) {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  if (typeof window.requestIdleCallback === "function") {
    const idleId = window.requestIdleCallback(() => task(), {
      timeout: timeoutMs,
    });
    return () => window.cancelIdleCallback(idleId);
  }
  const timerId = window.setTimeout(task, timeoutMs);
  return () => window.clearTimeout(timerId);
}

export function caseSummaryTimestamp(caseRecord: CaseSummaryRecord): number {
  const rawValue =
    caseRecord.latest_image_uploaded_at ?? caseRecord.created_at ?? "";
  const parsed = new Date(rawValue);
  if (Number.isNaN(parsed.getTime())) {
    return 0;
  }
  return parsed.getTime();
}

export function sortCaseTimelineRecords(
  records: CaseSummaryRecord[],
): CaseSummaryRecord[] {
  return [...records].sort(
    (left, right) => caseSummaryTimestamp(right) - caseSummaryTimestamp(left),
  );
}

export function buildCaseHistoryCacheKey(
  patientId: string,
  visitDate: string,
): string {
  return `${patientId}::${visitDate}`;
}

export function buildVisitImageCacheKey(
  patientId: string,
  visitDate: string,
): string {
  return `${patientId}::${normalizeVisitMatchKey(visitDate)}`;
}

export function buildPatientImageCacheKey(
  siteId: string,
  patientId: string,
): string {
  return `${siteId.trim()}::${patientId.trim()}`;
}

export function buildPatientCaseTimelineCacheKey(
  siteId: string,
  showOnlyMine: boolean,
  patientId: string,
): string {
  return `${siteId.trim()}::${showOnlyMine ? "mine" : "all"}::${patientId.trim()}`;
}

export function mergeCaseTimelineRecords(
  ...groups: CaseSummaryRecord[][]
): CaseSummaryRecord[] {
  const byCaseId = new Map<string, CaseSummaryRecord>();
  for (const group of groups) {
    for (const item of group) {
      const caseId = String(item.case_id ?? "").trim();
      if (!caseId) {
        continue;
      }
      byCaseId.set(caseId, item);
    }
  }
  return sortCaseTimelineRecords(Array.from(byCaseId.values()));
}

export function hasSettledCaseImageCache(
  caseRecord: CaseSummaryRecord,
  cachedImages: SavedImagePreview[] | undefined,
): cachedImages is SavedImagePreview[] {
  if (!cachedImages) {
    return false;
  }
  if (cachedImages.length > 0) {
    return true;
  }
  return Number(caseRecord.image_count || 0) <= 0;
}

export function sameSavedImagePreviewLists(
  left: SavedImagePreview[] | undefined,
  right: SavedImagePreview[] | undefined,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right || left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const leftImage = left[index];
    const rightImage = right[index];
    if (
      leftImage.image_id !== rightImage.image_id ||
      leftImage.patient_id !== rightImage.patient_id ||
      leftImage.visit_date !== rightImage.visit_date ||
      leftImage.view !== rightImage.view ||
      leftImage.preview_url !== rightImage.preview_url ||
      leftImage.content_url !== rightImage.content_url ||
      leftImage.is_representative !== rightImage.is_representative
    ) {
      return false;
    }
  }
  return true;
}
