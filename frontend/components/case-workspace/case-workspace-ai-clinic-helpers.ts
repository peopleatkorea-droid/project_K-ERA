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
