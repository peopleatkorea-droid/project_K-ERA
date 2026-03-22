"use client";

import { useEffect, useState, type Dispatch, type FormEvent, type MutableRefObject, type SetStateAction } from "react";

import {
  fetchMainBootstrap,
  fetchPatientListPage,
  fetchMyAccessRequests,
  fetchPublicSites,
  searchPublicInstitutions,
  submitAccessRequest,
  type AccessRequestRecord,
  type AuthUser,
  type PublicInstitutionRecord,
  type SiteRecord,
} from "../lib/api";
import { googleLogin } from "../lib/auth";
import { canUseDesktopTransport, prefetchDesktopVisitImages } from "../lib/desktop-transport";
import {
  CLIENT_BOOTSTRAP_TIMING_LOGS,
  GOOGLE_CLIENT_ID,
  isAuthBootstrapError,
  isTokenExpired,
  optimisticSitesForUser,
  parseOperationsLaunchFromSearch,
  readOptimisticUserFromToken,
  sitesNeedLabelHydration,
  TOKEN_KEY,
  type LaunchTarget,
  type RequestFormState,
} from "./home-page-auth-shared";
import { useApprovedWorkspaceState } from "./use-approved-workspace-state";

type CopyBundle = {
  failedConnect: string;
  failedLoadSiteData: string;
  googleDisabled: string;
  googleLoginFailed: string;
  googleNoCredential: string;
  googlePreparing: string;
  requestSubmissionFailed: string;
  unableLoadInstitutions: string;
};

type UseHomeAuthBootstrapOptions = {
  copy: CopyBundle;
  deferredInstitutionQuery: string;
  describeError: (nextError: unknown, fallback: string) => string;
  googleButtonRefs: MutableRefObject<HTMLDivElement[]>;
  googleButtonSlotVersion: number;
  googleButtonWidth: number;
  googleReady: boolean;
  requestForm: RequestFormState;
  setRequestForm: Dispatch<SetStateAction<RequestFormState>>;
};

type GooglePromptMomentNotification = {
  isDismissedMoment?: () => boolean;
  isNotDisplayed?: () => boolean;
  isSkippedMoment?: () => boolean;
};

type GoogleAccountsIdApi = {
  initialize: (config: Record<string, unknown>) => void;
  prompt?: (listener?: (notification: GooglePromptMomentNotification) => void) => void;
  renderButton: (element: HTMLElement, options: Record<string, unknown>) => void;
};

export function useHomeAuthBootstrap({
  copy,
  deferredInstitutionQuery,
  describeError,
  googleButtonRefs,
  googleButtonSlotVersion,
  googleButtonWidth,
  googleReady,
  requestForm,
  setRequestForm,
}: UseHomeAuthBootstrapOptions) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [publicSites, setPublicSites] = useState<SiteRecord[]>([]);
  const [publicInstitutions, setPublicInstitutions] = useState<PublicInstitutionRecord[]>([]);
  const [myRequests, setMyRequests] = useState<AccessRequestRecord[]>([]);
  const [authBusy, setAuthBusy] = useState(false);
  const [bootstrapBusy, setBootstrapBusy] = useState(false);
  const [requestBusy, setRequestBusy] = useState(false);
  const [institutionSearchBusy, setInstitutionSearchBusy] = useState(false);
  const [googleLaunchPulse, setGoogleLaunchPulse] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launchTarget, setLaunchTarget] = useState<LaunchTarget | null>(null);

  const approved = user?.approval_status === "approved";
  const {
    applyApprovedWorkspaceState,
    clearApprovedWorkspaceState,
    refreshApprovedSites,
    refreshSiteData,
    selectedSiteId,
    setSelectedSiteId,
    setSummary,
    siteError,
    sites,
    summary,
  } = useApprovedWorkspaceState({
    token,
    approved,
    bootstrapBusy,
    describeError,
    failedLoadSiteData: copy.failedLoadSiteData,
  });

  function scheduleDeferredBootstrap(task: () => void, timeoutMs = 0) {
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

  function getGoogleButtonHosts() {
    return googleButtonRefs.current.filter((host) => host?.isConnected);
  }

  function resetGoogleButtonHost(host: HTMLDivElement) {
    host.dataset.googleReady = "false";
    host.replaceChildren();
  }

  function findGoogleInteractive(host?: HTMLDivElement) {
    if (!host) {
      return null;
    }
    return host.querySelector<HTMLElement>('div[role="button"], [role="button"], button, [tabindex="0"]');
  }

  function focusGoogleButtonHost(host?: HTMLDivElement) {
    if (!host) {
      return;
    }
    host.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    findGoogleInteractive(host)?.focus?.();
  }

  useEffect(() => {
    const stored = window.localStorage.getItem(TOKEN_KEY);
    if (stored) {
      if (isTokenExpired(stored)) {
        window.localStorage.removeItem(TOKEN_KEY);
      } else {
        setBootstrapBusy(true);
        setToken(stored);
        const optimisticUser = readOptimisticUserFromToken(stored);
        if (optimisticUser?.approval_status === "approved") {
          const optimisticSites = optimisticSitesForUser(optimisticUser);
          setUser(optimisticUser);
          setMyRequests([]);
          applyApprovedWorkspaceState(optimisticUser, { sites: optimisticSites });
        }
      }
    }
    setLaunchTarget(parseOperationsLaunchFromSearch());
  }, [applyApprovedWorkspaceState]);

  useEffect(() => {
    if (!token || !user || approved) {
      return;
    }
    void fetchPublicSites()
      .then((items) => {
        setPublicSites(items);
        setRequestForm((current) => ({
          ...current,
          requested_site_id: current.requested_site_id || items[0]?.site_id || "",
        }));
      })
      .catch((nextError) => {
        setError(describeError(nextError, copy.unableLoadInstitutions));
      });
  }, [approved, applyApprovedWorkspaceState, copy.unableLoadInstitutions, describeError, setRequestForm, token, user]);

  useEffect(() => {
    if (!token || !user || approved) {
      setPublicInstitutions([]);
      setInstitutionSearchBusy(false);
      return;
    }
    const query = deferredInstitutionQuery.trim();
    if (query.length < 2) {
      setPublicInstitutions([]);
      setInstitutionSearchBusy(false);
      return;
    }
    let cancelled = false;
    setInstitutionSearchBusy(true);
    void searchPublicInstitutions(query, { limit: 8 })
      .then((items) => {
        if (!cancelled) {
          setPublicInstitutions(items);
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(describeError(nextError, copy.unableLoadInstitutions));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setInstitutionSearchBusy(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [approved, copy.unableLoadInstitutions, deferredInstitutionQuery, describeError, token, user]);

  useEffect(() => {
    if (!token) {
      return;
    }
    const currentToken = token;
    const optimisticBootstrapUser = readOptimisticUserFromToken(currentToken);
    const optimisticSites =
      optimisticBootstrapUser?.approval_status === "approved" ? optimisticSitesForUser(optimisticBootstrapUser) : [];
    const canDeferApprovedBootstrap = optimisticSites.length > 0;
    const deferredBootstrapDelayMs =
      canUseDesktopTransport() && !sitesNeedLabelHydration(optimisticSites) ? 4000 : 0;

    async function bootstrap() {
      const startedAt = performance.now();
      setBootstrapBusy(true);
      setError(null);
      try {
        const bootstrapResult = await fetchMainBootstrap(currentToken);
        setUser(bootstrapResult.user);
        if (bootstrapResult.user.approval_status === "approved") {
          setMyRequests([]);
          applyApprovedWorkspaceState(bootstrapResult.user, { sites: bootstrapResult.sites });
        } else {
          clearApprovedWorkspaceState();
          setMyRequests(bootstrapResult.my_access_requests);
        }
        if (CLIENT_BOOTSTRAP_TIMING_LOGS) {
          console.info("[kera-home-bootstrap]", {
            approval_status: bootstrapResult.user.approval_status,
            role: bootstrapResult.user.role,
            site_count: bootstrapResult.sites.length,
            my_request_count: bootstrapResult.my_access_requests.length,
            total_ms: Math.round(performance.now() - startedAt),
          });
        }
      } catch (nextError) {
        window.localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
        clearApprovedWorkspaceState();
        if (!(nextError instanceof Error && isAuthBootstrapError(nextError.message))) {
          setError(describeError(nextError, copy.failedConnect));
        }
      } finally {
        setBootstrapBusy(false);
      }
    }

    if (canDeferApprovedBootstrap) {
      setBootstrapBusy(true);
      const cancelDeferredBootstrap = scheduleDeferredBootstrap(() => {
        void bootstrap();
      }, deferredBootstrapDelayMs);
      return () => {
        cancelDeferredBootstrap();
      };
    }

    void bootstrap();
  }, [applyApprovedWorkspaceState, clearApprovedWorkspaceState, copy.failedConnect, describeError, token]);

  useEffect(() => {
    if (!token || !approved || !selectedSiteId) {
      return;
    }
    const currentToken = token;
    const currentSiteId = selectedSiteId;
    let cancelled = false;
    const cancelDeferredWarm = scheduleDeferredBootstrap(() => {
      void fetchPatientListPage(currentSiteId, currentToken, {
        page: 1,
        page_size: 25,
      })
        .then((response) => {
          if (cancelled) {
            return;
          }
          response.items.slice(0, 6).forEach((row) => {
            prefetchDesktopVisitImages(currentSiteId, row.latest_case.patient_id, row.latest_case.visit_date);
          });
        })
        .catch(() => undefined);
    });
    return () => {
      cancelled = true;
      cancelDeferredWarm();
    };
  }, [approved, selectedSiteId, token]);

  useEffect(() => {
    const hosts = getGoogleButtonHosts();
    if (hosts.length === 0) {
      return;
    }
    const googleId = window.google?.accounts?.id as GoogleAccountsIdApi | undefined;
    if (!googleReady || !GOOGLE_CLIENT_ID || token || !googleId) {
      hosts.forEach((host) => {
        resetGoogleButtonHost(host);
      });
      return;
    }
    hosts.forEach((host) => {
      resetGoogleButtonHost(host);
    });
    googleId.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: async (response: { credential?: string }) => {
        if (!response.credential) {
          setError(copy.googleNoCredential);
          return;
        }
        setAuthBusy(true);
        setError(null);
        try {
          const auth = await googleLogin(response.credential);
          window.localStorage.setItem(TOKEN_KEY, auth.access_token);
          setToken(auth.access_token);
          setUser(auth.user);
          if (auth.user.approval_status === "approved") {
            setMyRequests([]);
            applyApprovedWorkspaceState(auth.user);
          }
        } catch (nextError) {
          setError(describeError(nextError, copy.googleLoginFailed));
        } finally {
          setAuthBusy(false);
        }
      },
    });
    hosts.forEach((host) => {
      googleId.renderButton(host, {
        theme: "outline",
        size: "large",
        width: host.clientWidth || googleButtonWidth,
        text: "signin_with",
        shape: "pill",
      });
      host.dataset.googleReady = "true";
    });
  }, [
    applyApprovedWorkspaceState,
    copy.googleLoginFailed,
    copy.googleNoCredential,
    describeError,
    googleButtonRefs,
    googleButtonSlotVersion,
    googleButtonWidth,
    googleReady,
    token,
  ]);

  async function handleRequestAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      return;
    }
    setRequestBusy(true);
    setError(null);
    try {
      const response = await submitAccessRequest(token, requestForm);
      const refreshedToken = window.localStorage.getItem(TOKEN_KEY) || token;
      if (refreshedToken !== token) {
        setToken(refreshedToken);
      }
      setUser(response.user);
      if (response.user.approval_status === "approved") {
        const preferredSiteId = response.request.resolved_site_id || response.request.requested_site_id;
        setMyRequests([]);
        applyApprovedWorkspaceState(response.user, { preferredSiteId });
        const nextRequests = await fetchMyAccessRequests(refreshedToken);
        setMyRequests(nextRequests);
        const nextSites = await refreshApprovedSites(refreshedToken, { preferredSiteId });
        applyApprovedWorkspaceState(response.user, { preferredSiteId, sites: nextSites });
      } else {
        clearApprovedWorkspaceState();
        const nextRequests = await fetchMyAccessRequests(refreshedToken);
        setMyRequests(nextRequests);
      }
    } catch (nextError) {
      setError(describeError(nextError, copy.requestSubmissionFailed));
    } finally {
      setRequestBusy(false);
    }
  }

  function handleLogout() {
    window.localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    clearApprovedWorkspaceState();
    setMyRequests([]);
    setPublicInstitutions([]);
    setError(null);
  }

  function handleGoogleLaunch() {
    if (!GOOGLE_CLIENT_ID) {
      setError(copy.googleDisabled);
      return;
    }
    if (!googleReady) {
      setError(copy.googlePreparing);
      return;
    }
    const [host] = getGoogleButtonHosts();
    const googleId = window.google?.accounts?.id as GoogleAccountsIdApi | undefined;
    setError(null);
    setGoogleLaunchPulse(true);
    const interactive = findGoogleInteractive(host);
    if (host?.dataset.googleReady === "true" && interactive) {
      focusGoogleButtonHost(host);
      interactive.click();
    } else if (typeof googleId?.prompt === "function") {
      googleId.prompt((notification) => {
        if (
          notification.isNotDisplayed?.() ||
          notification.isSkippedMoment?.() ||
          notification.isDismissedMoment?.()
        ) {
          focusGoogleButtonHost(host);
        }
      });
    } else {
      focusGoogleButtonHost(host);
      if (!interactive) {
        setError(copy.googlePreparing);
        setGoogleLaunchPulse(false);
        return;
      }
      interactive.click();
    }
    window.setTimeout(() => {
      setGoogleLaunchPulse(false);
    }, 400);
  }

  return {
    authBusy,
    bootstrapBusy,
    error,
    googleLaunchPulse,
    handleGoogleLaunch,
    handleLogout,
    handleRequestAccess,
    institutionSearchBusy,
    launchTarget,
    myRequests,
    publicInstitutions,
    publicSites,
    requestBusy,
    refreshApprovedSites,
    refreshSiteData,
    selectedSiteId,
    setSelectedSiteId,
    setSummary,
    siteError,
    sites,
    summary,
    token,
    user,
    setError,
    approved,
  };
}
