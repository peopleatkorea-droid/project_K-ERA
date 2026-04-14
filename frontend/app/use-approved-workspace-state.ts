"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { canUseDesktopLocalApiTransport } from "../lib/desktop-local-api";
import {
  fetchSiteSummary,
  fetchSiteSummaryCounts,
  fetchSites,
  mergeSiteSummaryCounts,
  type AuthUser,
  type SiteRecord,
  type SiteSummary,
} from "../lib/api";
import {
  cacheSiteRecords,
  mergeSiteRecordMetadata,
  mergeSitesWithCachedMetadata,
  optimisticSitesForUser,
  resolveSelectedSiteId,
} from "./home-page-auth-shared";

type UseApprovedWorkspaceStateOptions = {
  token: string | null;
  approved: boolean;
  bootstrapBusy: boolean;
  workspaceDataPlaneReady?: boolean;
  describeError: (nextError: unknown, fallback: string) => string;
  failedLoadSiteData: string;
};

function scheduleDeferredBrowserTask(task: () => void, timeoutMs = 240) {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  if (typeof window.requestIdleCallback === "function") {
    const idleId = window.requestIdleCallback(() => task(), { timeout: timeoutMs });
    return () => window.cancelIdleCallback(idleId);
  }
  const timerId = window.setTimeout(task, timeoutMs);
  return () => window.clearTimeout(timerId);
}

export function useApprovedWorkspaceState({
  token,
  approved,
  bootstrapBusy,
  workspaceDataPlaneReady = true,
  describeError,
  failedLoadSiteData,
}: UseApprovedWorkspaceStateOptions) {
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [summary, setSummary] = useState<SiteSummary | null>(null);
  const [siteBusy, setSiteBusy] = useState(false);
  const [siteError, setSiteError] = useState<string | null>(null);
  const siteSummaryCountsLoadedSiteIdRef = useRef<string | null>(null);
  const siteSummaryLoadedSiteIdRef = useRef<string | null>(null);
  const siteSummaryRequestSiteIdRef = useRef<string | null>(null);

  const clearSiteSummaryTracking = useCallback(() => {
    siteSummaryCountsLoadedSiteIdRef.current = null;
    siteSummaryLoadedSiteIdRef.current = null;
    siteSummaryRequestSiteIdRef.current = null;
  }, []);

  const clearApprovedWorkspaceState = useCallback(() => {
    clearSiteSummaryTracking();
    setSites([]);
    setSelectedSiteId(null);
    setSummary(null);
    setSiteError(null);
  }, [clearSiteSummaryTracking]);

  const applyApprovedWorkspaceState = useCallback(
    (nextUser: AuthUser, options?: { preferredSiteId?: string | null; sites?: SiteRecord[] }) => {
      const nextSites = mergeSitesWithCachedMetadata(options?.sites ?? optimisticSitesForUser(nextUser));
      cacheSiteRecords(nextSites);
      setSites((currentSites) => {
        if (currentSites.length === 0) {
          return nextSites;
        }
        const existingSitesById = new Map(currentSites.map((site) => [site.site_id, site]));
        return nextSites.map((site) => mergeSiteRecordMetadata(site, existingSitesById.get(site.site_id)));
      });
      setSelectedSiteId((current) => resolveSelectedSiteId(nextSites, current, options?.preferredSiteId));
    },
    [],
  );

  const refreshSiteData = useCallback(async (siteId: string, currentToken?: string | null) => {
    try {
      const nextCounts = await fetchSiteSummaryCounts(siteId, currentToken ?? undefined);
      siteSummaryCountsLoadedSiteIdRef.current = String(nextCounts.site_id ?? siteId);
      setSummary((current) => mergeSiteSummaryCounts(current, nextCounts));
    } catch {
      // Keep the refresh path resilient when the quick endpoint is unavailable.
    }
    const nextSummary = await fetchSiteSummary(siteId, currentToken ?? undefined);
    siteSummaryCountsLoadedSiteIdRef.current = String(nextSummary.site_id ?? siteId);
    siteSummaryLoadedSiteIdRef.current = String(nextSummary.site_id ?? siteId);
    setSummary(nextSummary);
    setSiteError(null);
    return nextSummary;
  }, []);

  const refreshApprovedSites = useCallback(
    async (currentToken?: string | null, options?: { preferredSiteId?: string | null }) => {
      const nextSites = mergeSitesWithCachedMetadata(await fetchSites(currentToken ?? undefined));
      cacheSiteRecords(nextSites);
      setSites(nextSites);
      setSelectedSiteId((current) => resolveSelectedSiteId(nextSites, current, options?.preferredSiteId));
      return nextSites;
    },
    [],
  );

  useEffect(() => {
    if (token && approved) {
      return;
    }
    clearSiteSummaryTracking();
  }, [approved, clearSiteSummaryTracking, token]);

  useEffect(() => {
    if (workspaceDataPlaneReady || canUseDesktopLocalApiTransport()) {
      return;
    }
    clearSiteSummaryTracking();
    setSummary(null);
    setSiteBusy(false);
    setSiteError(null);
  }, [clearSiteSummaryTracking, workspaceDataPlaneReady]);

  useEffect(() => {
    if (
      canUseDesktopLocalApiTransport() ||
      !workspaceDataPlaneReady ||
      !selectedSiteId ||
      !approved ||
      bootstrapBusy ||
      siteSummaryLoadedSiteIdRef.current === selectedSiteId ||
      siteSummaryRequestSiteIdRef.current === selectedSiteId
    ) {
      return;
    }

    const currentToken = token ?? undefined;
    const currentSiteId = selectedSiteId;
    const suppressSiteError = bootstrapBusy;
    let cancelled = false;
    siteSummaryRequestSiteIdRef.current = currentSiteId;

    async function loadSite() {
      setSiteBusy(true);
      if (!suppressSiteError) {
        setSiteError(null);
      }
      try {
        try {
          const nextCounts = await fetchSiteSummaryCounts(currentSiteId, currentToken);
          if (!cancelled) {
            siteSummaryCountsLoadedSiteIdRef.current = String(nextCounts.site_id ?? currentSiteId);
            setSummary((current) => mergeSiteSummaryCounts(current, nextCounts));
          }
        } catch {
          // Fall through to the full summary request.
        }

        const nextSummary = await fetchSiteSummary(currentSiteId, currentToken);
        if (!cancelled) {
          siteSummaryCountsLoadedSiteIdRef.current = String(nextSummary.site_id ?? currentSiteId);
          siteSummaryLoadedSiteIdRef.current = String(nextSummary.site_id ?? currentSiteId);
          setSummary(nextSummary);
          setSiteError(null);
        }
      } catch (nextError) {
        if (!cancelled && !suppressSiteError) {
          setSiteError(describeError(nextError, failedLoadSiteData));
        }
      } finally {
        if (siteSummaryRequestSiteIdRef.current === currentSiteId) {
          siteSummaryRequestSiteIdRef.current = null;
        }
        if (!cancelled) {
          setSiteBusy(false);
        }
      }
    }

    const cancelDeferredLoad = scheduleDeferredBrowserTask(() => {
      void loadSite();
    }, canUseDesktopLocalApiTransport() ? 4000 : 0);
    return () => {
      cancelled = true;
      cancelDeferredLoad();
      if (siteSummaryRequestSiteIdRef.current === currentSiteId) {
        siteSummaryRequestSiteIdRef.current = null;
      }
    };
  }, [approved, bootstrapBusy, describeError, failedLoadSiteData, selectedSiteId, token, workspaceDataPlaneReady]);

  return {
    applyApprovedWorkspaceState,
    clearApprovedWorkspaceState,
    refreshApprovedSites,
    refreshSiteData,
    selectedSiteId,
    setSelectedSiteId,
    setSummary,
    siteBusy,
    siteError,
    sites,
    summary,
  };
}
