"use client";

import { useEffect } from "react";

import { canUseDesktopTransport } from "../../lib/desktop-transport";

type Args = {
  selectedSiteId: string | null;
  railView: "cases" | "patients";
  hasSelectedCase: boolean;
  canRunValidation: boolean;
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
  ensureSiteValidationRunsLoaded,
  ensureSiteModelVersionsLoaded,
}: Args) {
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
    if (canUseDesktopTransport()) {
      return;
    }
    if (
      !selectedSiteId ||
      railView === "patients" ||
      !hasSelectedCase ||
      !canRunValidation
    ) {
      return;
    }
    const controller = new AbortController();
    void ensureSiteModelVersionsLoaded(selectedSiteId, controller.signal);
    return () => {
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
