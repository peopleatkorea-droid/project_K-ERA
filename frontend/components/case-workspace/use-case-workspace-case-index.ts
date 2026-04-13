"use client";

import { useEffect } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import { type CaseSummaryRecord, fetchCases } from "../../lib/api";
import {
  buildPatientCaseTimelineCacheKey,
  mergeCaseTimelineRecords,
  sortCaseTimelineRecords,
} from "./case-workspace-site-data-helpers";

type ToastState = {
  tone: "success" | "error";
  message: string;
} | null;

type Setter<T> = Dispatch<SetStateAction<T>>;

type Args = {
  caseImageCacheVersion: number;
  selectedSiteId: string | null;
  railView: "cases" | "patients";
  token: string;
  showOnlyMine: boolean;
  locale: "en" | "ko";
  unableLoadRecentCases: string;
  describeError: (error: unknown, fallback: string) => string;
  pick: (locale: "en" | "ko", en: string, ko: string) => string;
  setToast: (toast: ToastState) => void;
  cases: CaseSummaryRecord[];
  selectedCase: CaseSummaryRecord | null;
  selectedPatientCases: CaseSummaryRecord[];
  setCases: Setter<CaseSummaryRecord[]>;
  setCasesLoading: Setter<boolean>;
  setSelectedCase: Setter<CaseSummaryRecord | null>;
  setSelectedPatientCases: Setter<CaseSummaryRecord[]>;
  patientCaseTimelineCacheRef: MutableRefObject<Map<string, CaseSummaryRecord[]>>;
  patientCaseTimelinePromiseCacheRef: MutableRefObject<
    Map<string, Promise<CaseSummaryRecord[]>>
  >;
  patientCaseTimelineReadyRef: MutableRefObject<Map<string, boolean>>;
};

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function useCaseWorkspaceCaseIndex({
  caseImageCacheVersion,
  selectedSiteId,
  railView,
  token,
  showOnlyMine,
  locale,
  unableLoadRecentCases,
  describeError,
  pick,
  setToast,
  cases,
  selectedCase,
  selectedPatientCases,
  setCases,
  setCasesLoading,
  setSelectedCase,
  setSelectedPatientCases,
  patientCaseTimelineCacheRef,
  patientCaseTimelinePromiseCacheRef,
  patientCaseTimelineReadyRef,
}: Args) {
  useEffect(() => {
    if (!selectedSiteId || selectedPatientCases.length === 0) {
      return;
    }
    const patientId = selectedPatientCases[0]?.patient_id?.trim();
    if (!patientId) {
      return;
    }
    const cacheKey = buildPatientCaseTimelineCacheKey(
      selectedSiteId,
      showOnlyMine,
      patientId,
    );
    if (!patientCaseTimelineReadyRef.current.get(cacheKey)) {
      return;
    }
    patientCaseTimelineCacheRef.current.set(
      cacheKey,
      sortCaseTimelineRecords(selectedPatientCases),
    );
  }, [selectedPatientCases, selectedSiteId, showOnlyMine]);

  useEffect(() => {
    if (!selectedSiteId) {
      setCases([]);
      setSelectedCase(null);
      return;
    }
    if (railView === "patients") {
      setCasesLoading(false);
      return;
    }
    const currentSiteId = selectedSiteId;
    let cancelled = false;
    const controller = new AbortController();

    async function loadRecords() {
      setCasesLoading(true);
      try {
        const nextCases = await fetchCases(currentSiteId, token, {
          mine: showOnlyMine,
          signal: controller.signal,
        });
        if (cancelled) {
          return;
        }
        setCases(nextCases);
        setSelectedCase((current) => {
          if (!current) {
            return null;
          }
          return (
            nextCases.find((item) => item.case_id === current.case_id) ?? null
          );
        });
      } catch (nextError) {
        if (isAbortError(nextError)) {
          return;
        }
        if (!cancelled) {
          setToast({
            tone: "error",
            message: describeError(nextError, unableLoadRecentCases),
          });
        }
      } finally {
        if (!cancelled) {
          setCasesLoading(false);
        }
      }
    }

    void loadRecords();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    describeError,
    railView,
    selectedSiteId,
    setToast,
    showOnlyMine,
    token,
    unableLoadRecentCases,
  ]);

  useEffect(() => {
    if (!selectedSiteId || !selectedCase) {
      setSelectedPatientCases([]);
      return;
    }

    const currentSiteId = selectedSiteId;
    const currentCase = selectedCase;
    const cacheKey = buildPatientCaseTimelineCacheKey(
      currentSiteId,
      showOnlyMine,
      currentCase.patient_id,
    );
    let cancelled = false;
    const controller = new AbortController();

    function syncSelectedCaseFromTimeline(timeline: CaseSummaryRecord[]) {
      const refreshedCase =
        timeline.find((item) => item.case_id === currentCase.case_id) ??
        timeline.find(
          (item) =>
            item.patient_id === currentCase.patient_id &&
            item.visit_date === currentCase.visit_date,
        ) ??
        null;
      if (!refreshedCase) {
        return;
      }
      setSelectedCase((active) => {
        if (!active) {
          return active;
        }
        if (
          active.patient_id !== currentCase.patient_id ||
          active.visit_date !== currentCase.visit_date
        ) {
          return active;
        }
        return refreshedCase;
      });
    }

    async function loadPatientCaseTimeline(
      patientId: string,
    ): Promise<CaseSummaryRecord[]> {
      const patientTimelineCacheKey = buildPatientCaseTimelineCacheKey(
        currentSiteId,
        showOnlyMine,
        patientId,
      );
      const cachedTimeline =
        patientCaseTimelineCacheRef.current.get(patientTimelineCacheKey);
      if (
        cachedTimeline &&
        patientCaseTimelineReadyRef.current.get(patientTimelineCacheKey)
      ) {
        return cachedTimeline;
      }
      const pendingRequest = patientCaseTimelinePromiseCacheRef.current.get(
        patientTimelineCacheKey,
      );
      if (pendingRequest) {
        return pendingRequest;
      }
      const nextRequest = fetchCases(currentSiteId, token, {
        mine: showOnlyMine,
        patientId,
        signal: controller.signal,
      })
        .then((items) => {
          const sortedItems = sortCaseTimelineRecords(items);
          patientCaseTimelineReadyRef.current.set(patientTimelineCacheKey, true);
          patientCaseTimelineCacheRef.current.set(
            patientTimelineCacheKey,
            sortedItems,
          );
          return sortedItems;
        })
        .finally(() => {
          patientCaseTimelinePromiseCacheRef.current.delete(
            patientTimelineCacheKey,
          );
        });
      patientCaseTimelinePromiseCacheRef.current.set(
        patientTimelineCacheKey,
        nextRequest,
      );
      return nextRequest;
    }

    const cachedTimeline = patientCaseTimelineCacheRef.current.get(cacheKey);
    if (
      cachedTimeline &&
      patientCaseTimelineReadyRef.current.get(cacheKey) &&
      cachedTimeline.some((item) => item.case_id === currentCase.case_id)
    ) {
      setSelectedPatientCases(cachedTimeline);
      syncSelectedCaseFromTimeline(cachedTimeline);
      return () => {
        cancelled = true;
        controller.abort();
      };
    }

    const optimisticTimeline = mergeCaseTimelineRecords(
      selectedPatientCases.filter(
        (item) => item.patient_id === currentCase.patient_id,
      ),
      cases.filter((item) => item.patient_id === currentCase.patient_id),
      [currentCase],
    );
    if (optimisticTimeline.length > 0) {
      setSelectedPatientCases(optimisticTimeline);
      syncSelectedCaseFromTimeline(optimisticTimeline);
    } else {
      setSelectedPatientCases([currentCase]);
    }

    void loadPatientCaseTimeline(currentCase.patient_id)
      .then((timeline) => {
        if (cancelled) {
          return;
        }
        setSelectedPatientCases(timeline);
        syncSelectedCaseFromTimeline(timeline);
      })
      .catch((nextError) => {
        if (isAbortError(nextError)) {
          return;
        }
        if (!cancelled) {
          setToast({
            tone: "error",
            message: describeError(
              nextError,
              pick(
                locale,
                "Unable to load this patient's visit timeline.",
                "이 환자의 방문 타임라인을 불러오지 못했습니다.",
              ),
            ),
          });
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    caseImageCacheVersion,
    cases,
    describeError,
    locale,
    pick,
    selectedCase,
    selectedSiteId,
    setToast,
    showOnlyMine,
    token,
  ]);
}
