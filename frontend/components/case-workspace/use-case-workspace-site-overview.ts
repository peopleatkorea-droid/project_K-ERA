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
import type { SiteModelCatalogState } from "./shared";

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
  const SITE_MODEL_VERSIONS_TIMEOUT_MS = 8000;
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
  const [siteModelCatalogState, setSiteModelCatalogState] =
    useState<SiteModelCatalogState>("idle");
  const [selectedCompareModelVersionIds, setSelectedCompareModelVersionIds] =
    useState<string[]>([]);
  const [selectedValidationModelVersionId, setSelectedValidationModelVersionId] =
    useState<string | null>(null);

  const siteActivityLoadedSiteIdRef = useRef<string | null>(null);
  const siteValidationLoadedSiteIdRef = useRef<string | null>(null);
  const siteModelVersionsLoadedSiteIdRef = useRef<string | null>(null);
  const siteActivityPromiseRef = useRef<{
    siteId: string;
    promise: Promise<SiteActivityResponse | null>;
  } | null>(null);
  const siteValidationPromiseRef = useRef<{
    siteId: string;
    promise: Promise<SiteValidationRunRecord[]>;
  } | null>(null);
  const siteModelVersionsPromiseRef = useRef<{
    siteId: string;
    promise: Promise<ModelVersionRecord[]>;
  } | null>(null);

  useEffect(() => {
    siteActivityLoadedSiteIdRef.current = null;
    siteValidationLoadedSiteIdRef.current = null;
    siteModelVersionsLoadedSiteIdRef.current = null;
    siteActivityPromiseRef.current = null;
    siteValidationPromiseRef.current = null;
    siteModelVersionsPromiseRef.current = null;
    setActivityBusy(false);
    setSiteActivity(null);
    setSiteValidationBusy(false);
    setSiteValidationRuns([]);
    setSiteModelVersions([]);
    setSiteModelCatalogState("idle");
    setSelectedCompareModelVersionIds([]);
    setSelectedValidationModelVersionId(null);
  }, [selectedSiteId]);

  const loadSiteActivity = useCallback(
    async (siteId: string, signal?: AbortSignal) => {
      const pendingRequest = siteActivityPromiseRef.current;
      if (pendingRequest?.siteId === siteId) {
        return pendingRequest.promise;
      }
      setActivityBusy(true);
      const nextRequest = fetchSiteActivity(siteId, token, signal)
        .then((nextActivity) => {
          setSiteActivity(nextActivity);
          siteActivityLoadedSiteIdRef.current = siteId;
          return nextActivity;
        })
        .catch((nextError) => {
          if (isAbortError(nextError)) {
            return null;
          }
          setSiteActivity(null);
          setToast({
            tone: "error",
            message: describeError(nextError, unableLoadSiteActivity),
          });
          return null;
        })
        .finally(() => {
          if (siteActivityPromiseRef.current?.siteId === siteId) {
            siteActivityPromiseRef.current = null;
          }
          setActivityBusy(false);
        });
      siteActivityPromiseRef.current = { siteId, promise: nextRequest };
      return nextRequest;
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
      const pendingRequest = siteValidationPromiseRef.current;
      if (pendingRequest?.siteId === siteId) {
        return pendingRequest.promise;
      }
      setSiteValidationBusy(true);
      const nextRequest = fetchSiteValidations(siteId, token, signal)
        .then((nextRuns) => {
          setSiteValidationRuns(nextRuns);
          siteValidationLoadedSiteIdRef.current = siteId;
          return nextRuns;
        })
        .catch((nextError) => {
          if (isAbortError(nextError)) {
            return [];
          }
          setSiteValidationRuns([]);
          setToast({
            tone: "error",
            message: describeError(nextError, unableLoadSiteValidationHistory),
          });
          return [];
        })
        .finally(() => {
          if (siteValidationPromiseRef.current?.siteId === siteId) {
            siteValidationPromiseRef.current = null;
          }
          setSiteValidationBusy(false);
        });
      siteValidationPromiseRef.current = { siteId, promise: nextRequest };
      return nextRequest;
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
      const pendingRequest = siteModelVersionsPromiseRef.current;
      if (pendingRequest?.siteId === siteId) {
        return pendingRequest.promise;
      }
      setSiteModelCatalogState("loading");
      const nextRequest = new Promise<ModelVersionRecord[]>(
        (resolve, reject) => {
          const timeoutId = window.setTimeout(() => {
            reject(new Error("Site model catalog timed out."));
          }, SITE_MODEL_VERSIONS_TIMEOUT_MS);
          fetchSiteModelVersions(siteId, token, signal)
            .then(resolve)
            .catch(reject)
            .finally(() => {
              window.clearTimeout(timeoutId);
            });
        },
      )
        .then((nextVersions) => {
          setSiteModelVersions(nextVersions);
          siteModelVersionsLoadedSiteIdRef.current = siteId;
          setSiteModelCatalogState(
            nextVersions.length > 0 ? "ready" : "empty",
          );
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
            return null;
          });
          return nextVersions;
        })
        .catch((nextError) => {
          if (isAbortError(nextError)) {
            return [];
          }
          setSiteModelVersions([]);
          setSiteModelCatalogState("error");
          setSelectedCompareModelVersionIds([]);
          setSelectedValidationModelVersionId(null);
          return [];
        })
        .finally(() => {
          if (siteModelVersionsPromiseRef.current?.siteId === siteId) {
            siteModelVersionsPromiseRef.current = null;
          }
        });
      siteModelVersionsPromiseRef.current = { siteId, promise: nextRequest };
      return nextRequest;
    },
    [SITE_MODEL_VERSIONS_TIMEOUT_MS, defaultModelCompareSelection, token],
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
    siteModelCatalogState,
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
