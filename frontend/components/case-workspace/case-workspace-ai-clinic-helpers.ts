import type { AiClinicResponse } from "../../lib/api";

import type { AiClinicPreviewResponse } from "./shared";

export function aiClinicSimilarCaseKey(item: {
  patient_id: string;
  visit_date: string;
}) {
  return `${String(item.patient_id)}::${String(item.visit_date)}`;
}

export function withAiClinicSimilarCasePreviews(
  result: AiClinicResponse,
  previousResult: AiClinicPreviewResponse | null,
): AiClinicPreviewResponse {
  const previewByCaseKey = new Map(
    (previousResult?.similar_cases ?? []).map(
      (item) => [aiClinicSimilarCaseKey(item), item.preview_url] as const,
    ),
  );
  return {
    ...result,
    similar_cases: result.similar_cases.map((item) => ({
      ...item,
      preview_url:
        previewByCaseKey.get(aiClinicSimilarCaseKey(item)) ??
        item.preview_url ??
        null,
    })),
  };
}

export function withAiClinicSimilarCasePreviewPatch(
  result: AiClinicPreviewResponse,
  previewByCaseKey: ReadonlyMap<string, string | null>,
): AiClinicPreviewResponse {
  if (previewByCaseKey.size === 0) {
    return result;
  }
  let changed = false;
  const nextCases = result.similar_cases.map((item) => {
    const nextPreview = previewByCaseKey.get(aiClinicSimilarCaseKey(item));
    if (nextPreview === undefined || nextPreview === item.preview_url) {
      return item;
    }
    changed = true;
    return {
      ...item,
      preview_url: nextPreview,
    };
  });
  if (!changed) {
    return result;
  }
  return {
    ...result,
    similar_cases: nextCases,
  };
}
