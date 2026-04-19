import type { AiClinicResponse } from "../../lib/api";

import type { AiClinicPreviewResponse } from "./shared";

const AI_CLINIC_SIMILAR_CASE_COLLECTION_KEYS = [
  "similar_cases",
  "local_similar_cases",
  "cross_site_similar_cases",
] as const;

type AiClinicSimilarCaseCollectionKey =
  (typeof AI_CLINIC_SIMILAR_CASE_COLLECTION_KEYS)[number];

type SimilarCaseItem = {
  patient_id: string;
  visit_date: string;
  preview_url?: string | null;
};

type SimilarCaseCollections<T extends SimilarCaseItem> = {
  similar_cases: T[];
  local_similar_cases?: T[];
  cross_site_similar_cases?: T[];
};

export function aiClinicSimilarCaseKey(item: {
  patient_id: string;
  visit_date: string;
}) {
  return `${String(item.patient_id)}::${String(item.visit_date)}`;
}

function hydrateSimilarCaseCollection<T extends SimilarCaseItem>(
  items: T[] | undefined,
  previewByCaseKey: ReadonlyMap<string, string | null>,
) {
  if (!items) {
    return items;
  }
  return items.map((item) => ({
    ...item,
    preview_url:
      previewByCaseKey.get(aiClinicSimilarCaseKey(item)) ??
      item.preview_url ??
      null,
  }));
}

function patchSimilarCaseCollection<T extends SimilarCaseItem>(
  items: T[] | undefined,
  previewByCaseKey: ReadonlyMap<string, string | null>,
) {
  if (!items) {
    return { changed: false, items };
  }
  let changed = false;
  const nextItems = items.map((item) => {
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
  return {
    changed,
    items: nextItems,
  };
}

export function collectAiClinicSimilarCases<T extends SimilarCaseItem>(
  result: SimilarCaseCollections<T> | null | undefined,
): T[] {
  if (!result) {
    return [];
  }
  const seenCaseKeys = new Set<string>();
  const mergedCases: T[] = [];
  for (const key of AI_CLINIC_SIMILAR_CASE_COLLECTION_KEYS) {
    for (const item of result[key] ?? []) {
      const caseKey = aiClinicSimilarCaseKey(item);
      if (seenCaseKeys.has(caseKey)) {
        continue;
      }
      seenCaseKeys.add(caseKey);
      mergedCases.push(item);
    }
  }
  return mergedCases;
}

export function countDisplayedAiClinicSimilarCases<T extends SimilarCaseItem>(
  result: SimilarCaseCollections<T> | null | undefined,
) {
  if (!result) {
    return 0;
  }
  const splitCount =
    (result.local_similar_cases?.length ?? 0) +
    (result.cross_site_similar_cases?.length ?? 0);
  return splitCount > 0 ? splitCount : result.similar_cases.length;
}

export function withAiClinicSimilarCasePreviews(
  result: AiClinicResponse,
  previousResult: AiClinicPreviewResponse | null,
): AiClinicPreviewResponse {
  const previewByCaseKey = new Map<string, string | null>();
  for (const key of AI_CLINIC_SIMILAR_CASE_COLLECTION_KEYS) {
    for (const item of previousResult?.[key] ?? []) {
      const caseKey = aiClinicSimilarCaseKey(item);
      const nextPreview = item.preview_url ?? null;
      const currentPreview = previewByCaseKey.get(caseKey);
      if (
        currentPreview === undefined ||
        (currentPreview === null && nextPreview !== null)
      ) {
        previewByCaseKey.set(caseKey, nextPreview);
      }
    }
  }
  return {
    ...result,
    similar_cases: hydrateSimilarCaseCollection(
      result.similar_cases,
      previewByCaseKey,
    ),
    local_similar_cases: hydrateSimilarCaseCollection(
      result.local_similar_cases,
      previewByCaseKey,
    ),
    cross_site_similar_cases: hydrateSimilarCaseCollection(
      result.cross_site_similar_cases,
      previewByCaseKey,
    ),
  };
}

export function withAiClinicSimilarCasePreviewPatch(
  result: AiClinicPreviewResponse,
  previewByCaseKey: ReadonlyMap<string, string | null>,
): AiClinicPreviewResponse {
  if (previewByCaseKey.size === 0) {
    return result;
  }
  const nextCollections = {} as Partial<
    Record<AiClinicSimilarCaseCollectionKey, SimilarCaseItem[] | undefined>
  >;
  let changed = false;
  for (const key of AI_CLINIC_SIMILAR_CASE_COLLECTION_KEYS) {
    const nextCollection = patchSimilarCaseCollection(result[key], previewByCaseKey);
    nextCollections[key] = nextCollection.items;
    changed = changed || nextCollection.changed;
  }
  if (!changed) {
    return result;
  }
  return {
    ...result,
    similar_cases: nextCollections.similar_cases as AiClinicPreviewResponse["similar_cases"],
    local_similar_cases:
      nextCollections.local_similar_cases as AiClinicPreviewResponse["local_similar_cases"],
    cross_site_similar_cases:
      nextCollections.cross_site_similar_cases as AiClinicPreviewResponse["cross_site_similar_cases"],
  };
}
