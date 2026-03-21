"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { fetchSiteSummary, fetchSites, type AuthUser, type SiteRecord, type SiteSummary } from "../lib/api";
import { optimisticSitesForUser, resolveSelectedSiteId } from "./home-page-auth-shared";

type UseApprovedWorkspaceStateOptions = {
  token: string | null;
  approved: boolean;
  bootstrapBusy: boolean;
  describeError: (nextError: unknown, fallback: string) => string;
  failedLoadSiteData: string;
};

export function useApprovedWorkspaceState({
  token,
  approved,
  bootstrapBusy,
  describeError,
  failedLoadSiteData,
}: UseApprovedWorkspaceStateOptions) {
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [summary, setSummary] = useState<SiteSummary | null>(null);
  const [siteBusy, setSiteBusy] = useState(false);
  const [siteError, setSiteError] = useState<string | null>(null);
  const siteSummaryLoadedSiteIdRef = useRef<string | null>(null);
  const siteSummaryRequestSiteIdRef = useRef<string | null>(null);

  const clearSiteSummaryTracking = useCallback(() => {
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
      const nextSites = options?.sites ?? optimisticSitesForUser(nextUser);
      setSites((currentSites) => {
        if (currentSites.length === 0) {
          return nextSites;
        }
        const existingSitesById = new Map(currentSites.map((site) => [site.site_id, site]));
        return nextSites.map((site) => existingSitesById.get(site.site_id) ?? site);
      });
      setSelectedSiteId((current) => resolveSelectedSiteId(nextSites, current, options?.preferredSiteId));
    },
    [],
  );

  const refreshSiteData = useCallback(async (siteId: string, currentToken: string) => {
    const nextSummary = await fetchSiteSummary(siteId, currentToken);
    siteSummaryLoadedSiteIdRef.current = String(nextSummary.site_id ?? siteId);
    setSummary(nextSummary);
    setSiteError(null);
    return nextSummary;
  }, []);

  const refreshApprovedSites = useCallback(
    async (currentToken: string, options?: { preferredSiteId?: string | null }) => {
      const nextSites = await fetchSites(currentToken);
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
    if (
      !token ||
      !selectedSiteId ||
      !approved ||
      summary?.site_id === selectedSiteId ||
      siteSummaryLoadedSiteIdRef.current === selectedSiteId ||
      siteSummaryRequestSiteIdRef.current === selectedSiteId
    ) {
      return;
    }

    const currentToken = token;
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
        const nextSummary = await fetchSiteSummary(currentSiteId, currentToken);
        if (!cancelled) {
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

    void loadSite();
    return () => {
      cancelled = true;
    };
  }, [approved, bootstrapBusy, describeError, failedLoadSiteData, selectedSiteId, summary?.site_id, token]);

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
