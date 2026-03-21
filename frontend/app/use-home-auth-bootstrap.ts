"use client";

import { useEffect, useState, type Dispatch, type FormEvent, type RefObject, type SetStateAction } from "react";

import {
  fetchMainBootstrap,
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
import {
  CLIENT_BOOTSTRAP_TIMING_LOGS,
  GOOGLE_CLIENT_ID,
  isAuthBootstrapError,
  isTokenExpired,
  parseOperationsLaunchFromSearch,
  readOptimisticUserFromToken,
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
  googleButtonRef: RefObject<HTMLDivElement | null>;
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

  useEffect(() => {
    const stored = window.localStorage.getItem(TOKEN_KEY);
    if (stored) {
      if (isTokenExpired(stored)) {
        window.localStorage.removeItem(TOKEN_KEY);
      } else {
        setToken(stored);
        const optimisticUser = readOptimisticUserFromToken(stored);
        if (optimisticUser?.approval_status === "approved") {
          setUser(optimisticUser);
          setMyRequests([]);
          applyApprovedWorkspaceState(optimisticUser);
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

    void bootstrap();
  }, [applyApprovedWorkspaceState, clearApprovedWorkspaceState, copy.failedConnect, describeError, token]);

  useEffect(() => {
    if (!googleReady || !GOOGLE_CLIENT_ID || token || !googleButtonRef.current || !window.google?.accounts?.id) {
      return;
    }
    googleButtonRef.current.innerHTML = "";
    window.google.accounts.id.initialize({
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
    window.google.accounts.id.renderButton(googleButtonRef.current, {
      theme: "outline",
      size: "large",
      width: googleButtonWidth,
      text: "signin_with",
      shape: "pill",
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
    const host = googleButtonRef.current;
    const interactive =
      host?.querySelector<HTMLElement>('div[role="button"], [role="button"], button, [tabindex="0"]') ??
      host?.querySelector<HTMLElement>("iframe");
    if (!interactive) {
      setError(copy.googlePreparing);
      return;
    }
    setError(null);
    setGoogleLaunchPulse(true);
    interactive.click();
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
