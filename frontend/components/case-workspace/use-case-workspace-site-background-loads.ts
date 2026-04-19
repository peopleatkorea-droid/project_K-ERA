"use client";

import { useEffect } from "react";

import type { CaseSummaryRecord } from "../../lib/api";
import { canUseDesktopTransport } from "../../lib/desktop-transport";
import {
  prewarmDesktopMlBackend,
  prewarmDesktopWorker,
  runAfterDesktopInteractionIdle,
} from "../../lib/desktop-runtime-prewarm";
import { scheduleDeferredBrowserTask } from "./case-workspace-site-data-helpers";

type Args = {
  selectedSiteId: string | null;
  railView: "cases" | "patients";
  hasSelectedCase: boolean;
  canRunValidation: boolean;
  idlePatientListPrefetchCases: CaseSummaryRecord[];
  preloadCaseVisitImages: (
    siteId: string,
    caseRecord: CaseSummaryRecord,
    options?: { signal?: AbortSignal },
  ) => Promise<unknown>;
  ensureSiteValidationRunsLoaded: (
    siteId: string,
    signal?: AbortSignal,
  ) => Promise<unknown>;
  ensureSiteModelVersionsLoaded: (
    siteId: string,
    signal?: AbortSignal,
  ) => Promise<unknown>;
};

export function useCaseWorkspaceSiteBackgroundLoads({
  selectedSiteId,
  railView,
  hasSelectedCase,
  canRunValidation,
  idlePatientListPrefetchCases,
  preloadCaseVisitImages,
  ensureSiteValidationRunsLoaded,
  ensureSiteModelVersionsLoaded,
}: Args) {
  useEffect(() => {
    if (
      !selectedSiteId ||
      !canRunValidation ||
      hasSelectedCase ||
      railView !== "patients"
    ) {
      return;
    }
    const controller = new AbortController();
    let cancelInteractionAwareRuntimePrewarm = () => undefined;
    const cancelCatalogLoad = scheduleDeferredBrowserTask(() => {
      void ensureSiteModelVersionsLoaded(selectedSiteId, controller.signal);
    }, canUseDesktopTransport() ? 1800 : 800);
    const cancelRuntimePrewarm = canUseDesktopTransport()
      ? scheduleDeferredBrowserTask(() => {
          cancelInteractionAwareRuntimePrewarm = runAfterDesktopInteractionIdle(
            () => {
              void prewarmDesktopWorker()
                .then(() => prewarmDesktopMlBackend())
                .catch(() => undefined);
            },
            2600,
          );
        }, 5000)
      : () => undefined;
    return () => {
      cancelCatalogLoad();
      cancelRuntimePrewarm();
      cancelInteractionAwareRuntimePrewarm();
      controller.abort();
    };
  }, [
    canRunValidation,
    ensureSiteModelVersionsLoaded,
    hasSelectedCase,
    railView,
    selectedSiteId,
  ]);

  useEffect(() => {
    if (
      !selectedSiteId ||
      hasSelectedCase ||
      railView !== "patients" ||
      idlePatientListPrefetchCases.length === 0
    ) {
      return;
    }
    const controller = new AbortController();
    const queuedCases = idlePatientListPrefetchCases.slice(0, 2);
    let cancelInteractionAwareVisitPrefetch = () => undefined;
    const cancelIdleVisitPrefetch = scheduleDeferredBrowserTask(() => {
      cancelInteractionAwareVisitPrefetch = runAfterDesktopInteractionIdle(
        () => {
          void (async () => {
            for (const caseRecord of queuedCases) {
              if (controller.signal.aborted) {
                return;
              }
              try {
                await preloadCaseVisitImages(selectedSiteId, caseRecord, {
                  signal: controller.signal,
                });
              } catch {
                if (controller.signal.aborted) {
                  return;
                }
              }
            }
          })();
        },
        2200,
      );
    }, canUseDesktopTransport() ? 2600 : 1400);
    return () => {
      cancelIdleVisitPrefetch();
      cancelInteractionAwareVisitPrefetch();
      controller.abort();
    };
  }, [
    hasSelectedCase,
    idlePatientListPrefetchCases,
    preloadCaseVisitImages,
    railView,
    selectedSiteId,
  ]);

  useEffect(() => {
    if (canUseDesktopTransport()) {
      return;
    }
    if (!selectedSiteId || railView === "patients" || !hasSelectedCase) {
      return;
    }
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      void ensureSiteValidationRunsLoaded(selectedSiteId, controller.signal);
    }, 120);
    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [
    ensureSiteValidationRunsLoaded,
    hasSelectedCase,
    railView,
    selectedSiteId,
  ]);

  useEffect(() => {
    if (
      !selectedSiteId ||
      railView === "patients" ||
      !hasSelectedCase ||
      !canRunValidation
    ) {
      return;
    }
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      void ensureSiteModelVersionsLoaded(selectedSiteId, controller.signal);
    }, canUseDesktopTransport() ? 220 : 0);
    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [
    canRunValidation,
    ensureSiteModelVersionsLoaded,
    hasSelectedCase,
    railView,
    selectedSiteId,
  ]);
}
