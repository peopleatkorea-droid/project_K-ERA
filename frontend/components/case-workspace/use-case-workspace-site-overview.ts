"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  type ModelVersionRecord,
  type SiteActivityResponse,
  type SiteValidationRunRecord,
  fetchSiteActivity,
  fetchSiteModelVersions,
  fetchSiteValidations,
} from "../../lib/api";

type ToastState = {
  tone: "success" | "error";
  message: string;
} | null;

type Args = {
  selectedSiteId: string | null;
  token: string;
  unableLoadSiteActivity: string;
  unableLoadSiteValidationHistory: string;
  defaultModelCompareSelection: (
    modelVersions: ModelVersionRecord[],
  ) => string[];
  defaultValidationModelVersionSelection: (
    modelVersions: ModelVersionRecord[],
  ) => string | null;
  describeError: (error: unknown, fallback: string) => string;
  setToast: (toast: ToastState) => void;
};

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function useCaseWorkspaceSiteOverview({
  selectedSiteId,
  token,
  unableLoadSiteActivity,
  unableLoadSiteValidationHistory,
  defaultModelCompareSelection,
  defaultValidationModelVersionSelection,
  describeError,
  setToast,
}: Args) {
  const [activityBusy, setActivityBusy] = useState(false);
  const [siteActivity, setSiteActivity] = useState<SiteActivityResponse | null>(
    null,
  );
  const [siteValidationBusy, setSiteValidationBusy] = useState(false);
  const [siteValidationRuns, setSiteValidationRuns] = useState<
    SiteValidationRunRecord[]
  >([]);
  const [siteModelVersions, setSiteModelVersions] = useState<
    ModelVersionRecord[]
  >([]);
  const [selectedCompareModelVersionIds, setSelectedCompareModelVersionIds] =
    useState<string[]>([]);
  const [selectedValidationModelVersionId, setSelectedValidationModelVersionId] =
    useState<string | null>(null);

  const siteActivityLoadedSiteIdRef = useRef<string | null>(null);
  const siteValidationLoadedSiteIdRef = useRef<string | null>(null);
  const siteModelVersionsLoadedSiteIdRef = useRef<string | null>(null);

  useEffect(() => {
    siteActivityLoadedSiteIdRef.current = null;
    siteValidationLoadedSiteIdRef.current = null;
    siteModelVersionsLoadedSiteIdRef.current = null;
    setActivityBusy(false);
    setSiteActivity(null);
    setSiteValidationBusy(false);
    setSiteValidationRuns([]);
    setSiteModelVersions([]);
    setSelectedCompareModelVersionIds([]);
    setSelectedValidationModelVersionId(null);
  }, [selectedSiteId]);

  const loadSiteActivity = useCallback(
    async (siteId: string, signal?: AbortSignal) => {
      setActivityBusy(true);
      try {
        const nextActivity = await fetchSiteActivity(siteId, token, signal);
        setSiteActivity(nextActivity);
        siteActivityLoadedSiteIdRef.current = siteId;
        return nextActivity;
      } catch (nextError) {
        if (isAbortError(nextError)) {
          return null;
        }
        setSiteActivity(null);
        setToast({
          tone: "error",
          message: describeError(nextError, unableLoadSiteActivity),
        });
        return null;
      } finally {
        setActivityBusy(false);
      }
    },
    [describeError, setToast, token, unableLoadSiteActivity],
  );

  const ensureSiteActivityLoaded = useCallback(
    async (siteId: string, signal?: AbortSignal) => {
      if (siteActivityLoadedSiteIdRef.current === siteId) {
        return siteActivity;
      }
      return loadSiteActivity(siteId, signal);
    },
    [loadSiteActivity, siteActivity],
  );

  const loadSiteValidationRuns = useCallback(
    async (siteId: string, signal?: AbortSignal) => {
      setSiteValidationBusy(true);
      try {
        const nextRuns = await fetchSiteValidations(siteId, token, signal);
        setSiteValidationRuns(nextRuns);
        siteValidationLoadedSiteIdRef.current = siteId;
        return nextRuns;
      } catch (nextError) {
        if (isAbortError(nextError)) {
          return [];
        }
        setSiteValidationRuns([]);
        setToast({
          tone: "error",
          message: describeError(nextError, unableLoadSiteValidationHistory),
        });
        return [];
      } finally {
        setSiteValidationBusy(false);
      }
    },
    [describeError, setToast, token, unableLoadSiteValidationHistory],
  );

  const ensureSiteValidationRunsLoaded = useCallback(
    async (siteId: string, signal?: AbortSignal) => {
      if (siteValidationLoadedSiteIdRef.current === siteId) {
        return siteValidationRuns;
      }
      return loadSiteValidationRuns(siteId, signal);
    },
    [loadSiteValidationRuns, siteValidationRuns],
  );

  const loadSiteModelVersions = useCallback(
    async (siteId: string, signal?: AbortSignal) => {
      try {
        const nextVersions = await fetchSiteModelVersions(siteId, token, signal);
        setSiteModelVersions(nextVersions);
        siteModelVersionsLoadedSiteIdRef.current = siteId;
        setSelectedCompareModelVersionIds((current) => {
          const availableVersionIds = new Set(
            nextVersions.map((item) => item.version_id),
          );
          const retained = current.filter((versionId) =>
            availableVersionIds.has(versionId),
          );
          return retained.length > 0
            ? retained
            : defaultModelCompareSelection(nextVersions);
        });
        setSelectedValidationModelVersionId((current) => {
          const normalizedCurrent = String(current || "").trim();
          if (
            normalizedCurrent.length > 0 &&
            nextVersions.some(
              (modelVersion) => modelVersion.version_id === normalizedCurrent,
            )
          ) {
            return normalizedCurrent;
          }
          return defaultValidationModelVersionSelection(nextVersions);
        });
        return nextVersions;
      } catch (nextError) {
        if (isAbortError(nextError)) {
          return [];
        }
        setSiteModelVersions([]);
        setSelectedCompareModelVersionIds([]);
        setSelectedValidationModelVersionId(null);
        return [];
      }
    },
    [defaultModelCompareSelection, defaultValidationModelVersionSelection, token],
  );

  const ensureSiteModelVersionsLoaded = useCallback(
    async (siteId: string, signal?: AbortSignal) => {
      if (siteModelVersionsLoadedSiteIdRef.current === siteId) {
        return siteModelVersions;
      }
      return loadSiteModelVersions(siteId, signal);
    },
    [loadSiteModelVersions, siteModelVersions],
  );

  return {
    activityBusy,
    siteActivity,
    setSiteActivity,
    siteValidationBusy,
    setSiteValidationBusy,
    siteValidationRuns,
    setSiteValidationRuns,
    siteModelVersions,
    setSiteModelVersions,
    selectedCompareModelVersionIds,
    setSelectedCompareModelVersionIds,
    selectedValidationModelVersionId,
    setSelectedValidationModelVersionId,
    loadSiteActivity,
    loadSiteValidationRuns,
    loadSiteModelVersions,
    ensureSiteActivityLoaded,
    ensureSiteValidationRunsLoaded,
    ensureSiteModelVersionsLoaded,
  };
}
