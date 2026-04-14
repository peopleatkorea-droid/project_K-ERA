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
import { exchangeDesktopGoogleLogin, googleLogin, startDesktopGoogleLogin } from "../lib/auth";
import { authenticateWithDesktopGoogle, canUseDesktopGoogleAuth } from "../lib/desktop-google-auth";
import { canUseDesktopTransport, prefetchDesktopVisitImages } from "../lib/desktop-transport";
import {
  findGoogleInteractive,
  renderGoogleButtons,
  resetGoogleButtonHost,
  triggerRenderedGoogleButton,
  type GoogleAccountsIdApi,
} from "../lib/google-login-bridge";
import {
  CLIENT_BOOTSTRAP_TIMING_LOGS,
  GOOGLE_CLIENT_ID,
  cacheMainAuthHint,
  clearMainAuthHint,
  isAuthBootstrapError,
  optimisticSitesForUser,
  parseOperationsLaunchFromSearch,
  readOptimisticUserFromAuthHint,
  readOptimisticUserFromToken,
  sitesNeedLabelHydration,
  TOKEN_KEY,
  type LaunchTarget,
  type RequestFormState,
} from "./home-page-auth-shared";
import { useApprovedWorkspaceState } from "./use-approved-workspace-state";
import { probeWebDataPlaneAvailability, type WorkspaceDataPlaneState } from "../lib/web-data-plane";

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
  googleButtonRef: MutableRefObject<HTMLDivElement | null>;
  googleButtonWidth: number;
  googleReady: boolean;
  requestForm: RequestFormState;
  setRequestForm: Dispatch<SetStateAction<RequestFormState>>;
};

export function useHomeAuthBootstrap({
  copy,
  deferredInstitutionQuery,
  describeError,
  googleButtonRef,
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
  const [workspaceDataPlaneState, setWorkspaceDataPlaneState] = useState<WorkspaceDataPlaneState>("idle");
  const [sessionBootstrapAttempted, setSessionBootstrapAttempted] = useState(false);

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
    workspaceDataPlaneReady: canUseDesktopTransport() || workspaceDataPlaneState === "ready",
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
    window.localStorage.removeItem(TOKEN_KEY);
    const optimisticUser = readOptimisticUserFromAuthHint();
    if (optimisticUser) {
      setUser(optimisticUser);
      setBootstrapBusy(true);
      if (optimisticUser.approval_status === "approved") {
        const optimisticSites = optimisticSitesForUser(optimisticUser);
        setMyRequests([]);
        applyApprovedWorkspaceState(optimisticUser, { sites: optimisticSites });
      } else {
        clearApprovedWorkspaceState();
        setMyRequests(optimisticUser.latest_access_request ? [optimisticUser.latest_access_request] : []);
      }
    }
    setLaunchTarget(parseOperationsLaunchFromSearch());
  }, [applyApprovedWorkspaceState, clearApprovedWorkspaceState]);

  useEffect(() => {
    if (!token || !user) {
      return;
    }
    cacheMainAuthHint(user, token);
  }, [token, user]);

  useEffect(() => {
    if (token || sessionBootstrapAttempted) {
      return;
    }
    let cancelled = false;
    setSessionBootstrapAttempted(true);
    setBootstrapBusy(true);
    setError(null);
    void fetchMainBootstrap()
      .then((bootstrapResult) => {
        if (cancelled) {
          return;
        }
        setToken(bootstrapResult.access_token);
        setUser(bootstrapResult.user);
        cacheMainAuthHint(bootstrapResult.user, bootstrapResult.access_token);
        if (bootstrapResult.user.approval_status === "approved") {
          setMyRequests([]);
          applyApprovedWorkspaceState(bootstrapResult.user, { sites: bootstrapResult.sites });
        } else {
          clearApprovedWorkspaceState();
          setMyRequests(bootstrapResult.my_access_requests);
        }
      })
      .catch((nextError) => {
        if (cancelled) {
          return;
        }
        clearApprovedWorkspaceState();
        clearMainAuthHint();
        if (!(nextError instanceof Error && isAuthBootstrapError(nextError.message))) {
          setError(describeError(nextError, copy.failedConnect));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBootstrapBusy(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    applyApprovedWorkspaceState,
    clearApprovedWorkspaceState,
    copy.failedConnect,
    describeError,
    sessionBootstrapAttempted,
    token,
  ]);

  useEffect(() => {
    if (!user) {
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
  }, [approved, applyApprovedWorkspaceState, copy.unableLoadInstitutions, describeError, setRequestForm, user]);

  useEffect(() => {
    if (!user) {
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
  }, [approved, copy.unableLoadInstitutions, deferredInstitutionQuery, describeError, user]);

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
        cacheMainAuthHint(bootstrapResult.user, bootstrapResult.access_token);
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
        clearMainAuthHint();
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
    if (!user || !approved) {
      setWorkspaceDataPlaneState("idle");
      return;
    }
    if (canUseDesktopTransport()) {
      setWorkspaceDataPlaneState("ready");
      return;
    }

    let cancelled = false;
    setWorkspaceDataPlaneState("checking");
    void probeWebDataPlaneAvailability().then((available) => {
      if (!cancelled) {
        setWorkspaceDataPlaneState(available ? "ready" : "unavailable");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [approved, token, user]);

  useEffect(() => {
    if (!token || !approved || !selectedSiteId) {
      return;
    }
    if (!canUseDesktopTransport() && workspaceDataPlaneState !== "ready") {
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
  }, [approved, selectedSiteId, token, workspaceDataPlaneState]);

  useEffect(() => {
    const host = googleButtonRef.current;
    if (!host?.isConnected) {
      return;
    }
    if (canUseDesktopGoogleAuth()) {
      resetGoogleButtonHost(host);
      return;
    }
    const googleId = window.google?.accounts?.id as GoogleAccountsIdApi | undefined;
    if (!googleReady || !GOOGLE_CLIENT_ID || token || !googleId) {
      resetGoogleButtonHost(host);
      return;
    }
    renderGoogleButtons({
      clientId: GOOGLE_CLIENT_ID,
      googleButtonWidth,
      googleId,
      hosts: [host],
      callback: async (response: { credential?: string }) => {
        if (!response.credential) {
          setError(copy.googleNoCredential);
          return;
        }
        setAuthBusy(true);
        setError(null);
        try {
          const auth = await googleLogin(response.credential);
          setSessionBootstrapAttempted(true);
          setToken(auth.access_token);
          setUser(auth.user);
          cacheMainAuthHint(auth.user, auth.access_token);
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
  }, [
    applyApprovedWorkspaceState,
    copy.googleLoginFailed,
    copy.googleNoCredential,
    describeError,
    googleButtonRef,
    googleButtonWidth,
    googleReady,
    token,
  ]);

  async function handleRequestAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) {
      return;
    }
    setRequestBusy(true);
    setError(null);
    try {
      const response = await submitAccessRequest(token, requestForm);
      const refreshedToken = response.access_token || token || null;
      if (refreshedToken && refreshedToken !== token) {
        setToken(refreshedToken);
      }
      setUser(response.user);
      cacheMainAuthHint(response.user, refreshedToken);
      if (response.user.approval_status === "approved" && response.request.status === "approved") {
        const preferredSiteId = response.request.resolved_site_id || response.request.requested_site_id;
        setMyRequests([]);
        applyApprovedWorkspaceState(response.user, { preferredSiteId });
        const nextRequests = await fetchMyAccessRequests(refreshedToken ?? undefined);
        setMyRequests(nextRequests);
        const nextSites = await refreshApprovedSites(refreshedToken ?? undefined, { preferredSiteId });
        applyApprovedWorkspaceState(response.user, { preferredSiteId, sites: nextSites });
      } else if (response.user.approval_status === "approved") {
        const nextRequests = await fetchMyAccessRequests(refreshedToken ?? undefined);
        setMyRequests(nextRequests);
        const nextSites = await refreshApprovedSites(refreshedToken ?? undefined);
        applyApprovedWorkspaceState(response.user, { sites: nextSites });
      } else {
        clearApprovedWorkspaceState();
        const nextRequests = await fetchMyAccessRequests(refreshedToken ?? undefined);
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
    void fetch("/control-plane/api/main/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    }).catch(() => undefined);
    setSessionBootstrapAttempted(true);
    setToken(null);
    setUser(null);
    clearApprovedWorkspaceState();
    clearMainAuthHint();
    setMyRequests([]);
    setPublicInstitutions([]);
    setError(null);
  }

  function handleGoogleLaunch() {
    if (canUseDesktopGoogleAuth()) {
      setError(null);
      setGoogleLaunchPulse(true);
      setAuthBusy(true);
      void authenticateWithDesktopGoogle({
        exchangeLogin: exchangeDesktopGoogleLogin,
        startLogin: ({ redirect_uri }) => startDesktopGoogleLogin(redirect_uri),
      })
        .then((auth) => {
          setSessionBootstrapAttempted(true);
          setToken(auth.access_token);
          setUser(auth.user);
          cacheMainAuthHint(auth.user, auth.access_token);
          if (auth.user.approval_status === "approved") {
            setMyRequests([]);
            applyApprovedWorkspaceState(auth.user);
          }
        })
        .catch((nextError) => {
          console.error("[kera-desktop-google-login]", nextError);
          setError(describeError(nextError, copy.googleLoginFailed));
        })
        .finally(() => {
          setAuthBusy(false);
          setGoogleLaunchPulse(false);
        });
      return;
    }
    if (!GOOGLE_CLIENT_ID) {
      setError(copy.googleDisabled);
      return;
    }
    if (!googleReady) {
      setError(copy.googlePreparing);
      return;
    }
    const host = googleButtonRef.current ?? undefined;
    const interactive = findGoogleInteractive(host);
    const googleId = window.google?.accounts?.id as GoogleAccountsIdApi | undefined;
    setError(null);
    setGoogleLaunchPulse(true);
    if (host?.dataset.googleReady === "true" && interactive) {
      focusGoogleButtonHost(host);
      triggerRenderedGoogleButton(host);
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
    workspaceDataPlaneState,
  };
}
