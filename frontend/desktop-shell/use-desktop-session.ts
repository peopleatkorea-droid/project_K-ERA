"use client";

import { startTransition, useEffect, useRef, useState, type FormEvent } from "react";

import { fetchSiteSummary, type AuthUser, type SiteRecord, type SiteSummary } from "../lib/api";
import { prewarmPatientListPage } from "../lib/cases";
import {
  clearDesktopSession,
  clearDesktopSessionCache,
  DESKTOP_TOKEN_KEY,
  desktopFetchApprovedSites,
  desktopFetchCurrentUser,
  desktopLocalDevLogin,
  desktopLocalLogin,
  exchangeDesktopGoogleLogin,
  loadDesktopSessionCache,
  persistDesktopSession,
  saveDesktopSessionCache,
  startDesktopGoogleLogin,
} from "../lib/desktop-auth";
import { authenticateWithDesktopGoogle } from "../lib/desktop-google-auth";
import type { Locale } from "../lib/i18n";

import type { DesktopShellCopy } from "./shell-copy";
import { describeDesktopShellError } from "./shell-helpers";

type LoginFormState = {
  username: string;
  password: string;
};

type UseDesktopSessionOptions = {
  locale: Locale;
  copy: Pick<DesktopShellCopy, "loginFailed">;
  warmDesktopRuntime: () => Promise<void>;
  setShellError: (message: string | null) => void;
};

type SyncSessionOptions = {
  preserveCurrentSite: boolean;
  resetOnFailure: boolean;
  silentFailure: boolean;
  setBusy: boolean;
};

export function useDesktopSession({ locale, copy, warmDesktopRuntime, setShellError }: UseDesktopSessionOptions) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [summary, setSummary] = useState<SiteSummary | null>(null);
  const [bootstrapBusy, setBootstrapBusy] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [loginForm, setLoginForm] = useState<LoginFormState>({ username: "", password: "" });
  const selectedSiteIdRef = useRef<string | null>(null);
  const optionsRef = useRef({ locale, copy, warmDesktopRuntime, setShellError });

  useEffect(() => {
    selectedSiteIdRef.current = selectedSiteId;
  }, [selectedSiteId]);

  useEffect(() => {
    optionsRef.current = { locale, copy, warmDesktopRuntime, setShellError };
  }, [locale, copy, warmDesktopRuntime, setShellError]);

  function updateLoginForm(patch: Partial<LoginFormState>) {
    setLoginForm((current) => ({ ...current, ...patch }));
  }

  function clearSessionState() {
    clearDesktopSession();
    setToken(null);
    setUser(null);
    setSites([]);
    setSelectedSiteId(null);
    setSummary(null);
  }

  async function syncSessionFromToken(currentToken: string, options: SyncSessionOptions) {
    if (options.setBusy) {
      setBootstrapBusy(true);
    }
    if (!options.silentFailure) {
      optionsRef.current.setShellError(null);
    }
    try {
      const nextUser = await desktopFetchCurrentUser(currentToken);
      const nextSites =
        nextUser.approval_status === "approved" ? await desktopFetchApprovedSites(currentToken) : [];
      const currentSiteId = selectedSiteIdRef.current;
      const nextSelectedSiteId =
        options.preserveCurrentSite && currentSiteId && nextSites.some((item) => item.site_id === currentSiteId)
          ? currentSiteId
          : nextSites[0]?.site_id ?? null;
      setUser(nextUser);
      setSites(nextSites);
      setSelectedSiteId(nextSelectedSiteId);
      void saveDesktopSessionCache({ token: currentToken, user: nextUser, sites: nextSites });
      if (nextSelectedSiteId) {
        prewarmPatientListPage(nextSelectedSiteId, currentToken, { page_size: 25 });
      }
    } catch (nextError) {
      if (options.resetOnFailure) {
        clearSessionState();
      }
      if (!options.silentFailure) {
        optionsRef.current.setShellError(
          describeDesktopShellError(optionsRef.current.locale, nextError, optionsRef.current.copy.loginFailed),
        );
      }
    } finally {
      if (options.setBusy) {
        setBootstrapBusy(false);
      }
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function restoreDesktopSession() {
      const cached = await loadDesktopSessionCache();
      if (cancelled) {
        return;
      }
      if (cached?.token && cached.user && cached.sites.length > 0) {
        const preferredSiteId = cached.sites[0]?.site_id ?? null;
        setToken(cached.token);
        setUser(cached.user);
        setSites(cached.sites);
        setSelectedSiteId(preferredSiteId);
        if (preferredSiteId) {
          prewarmPatientListPage(preferredSiteId, cached.token, { page_size: 25 });
        }
        void optionsRef.current.warmDesktopRuntime()
          .then(() => {
            if (cancelled) {
              return;
            }
            void syncSessionFromToken(cached.token, {
              preserveCurrentSite: true,
              resetOnFailure: false,
              silentFailure: true,
              setBusy: false,
            });
          })
          .catch(() => undefined);
        return;
      }
      const stored = window.localStorage.getItem(DESKTOP_TOKEN_KEY);
      if (cancelled) {
        return;
      }
      if (stored) {
        setToken(stored);
      }
      void optionsRef.current.warmDesktopRuntime().catch(() => undefined);
    }

    void restoreDesktopSession();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!token || user) {
      return;
    }
    void syncSessionFromToken(token, {
      preserveCurrentSite: true,
      resetOnFailure: true,
      silentFailure: false,
      setBusy: true,
    });
  }, [token, user]);

  useEffect(() => {
    if (!token || !selectedSiteId || !user || user.approval_status !== "approved") {
      setSummary(null);
      return;
    }
    let cancelled = false;
    void fetchSiteSummary(selectedSiteId, token)
      .then((nextSummary) => {
        if (!cancelled) {
          setSummary(nextSummary);
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          optionsRef.current.setShellError(
            describeDesktopShellError(optionsRef.current.locale, nextError, optionsRef.current.copy.loginFailed),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSiteId, token, user]);

  async function handleLocalLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthBusy(true);
    optionsRef.current.setShellError(null);
    try {
      const auth = await desktopLocalLogin(loginForm.username, loginForm.password);
      persistDesktopSession(auth.access_token);
      setToken(auth.access_token);
    } catch (nextError) {
      optionsRef.current.setShellError(
        describeDesktopShellError(optionsRef.current.locale, nextError, optionsRef.current.copy.loginFailed),
      );
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleGoogleLogin() {
    setAuthBusy(true);
    optionsRef.current.setShellError(null);
    try {
      const auth = await authenticateWithDesktopGoogle({
        exchangeLogin: exchangeDesktopGoogleLogin,
        startLogin: ({ redirect_uri }) => startDesktopGoogleLogin(redirect_uri),
      });
      persistDesktopSession(auth.access_token);
      setToken(auth.access_token);
    } catch (nextError) {
      console.error("[kera-desktop-google-login]", nextError);
      optionsRef.current.setShellError(
        describeDesktopShellError(optionsRef.current.locale, nextError, optionsRef.current.copy.loginFailed),
      );
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleDevLogin() {
    setAuthBusy(true);
    optionsRef.current.setShellError(null);
    try {
      const auth = await desktopLocalDevLogin();
      persistDesktopSession(auth.access_token);
      setToken(auth.access_token);
    } catch (nextError) {
      optionsRef.current.setShellError(
        describeDesktopShellError(optionsRef.current.locale, nextError, optionsRef.current.copy.loginFailed),
      );
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleRefreshSite(siteId: string) {
    if (!token) {
      return;
    }
    const nextSummary = await fetchSiteSummary(siteId, token);
    startTransition(() => {
      setSummary(nextSummary);
    });
  }

  function handleLogout() {
    clearSessionState();
    void clearDesktopSessionCache();
    optionsRef.current.setShellError(null);
  }

  return {
    token,
    user,
    sites,
    selectedSiteId,
    setSelectedSiteId,
    summary,
    bootstrapBusy,
    authBusy,
    loginForm,
    updateLoginForm,
    handleLocalLogin,
    handleGoogleLogin,
    handleDevLogin,
    handleRefreshSite,
    handleLogout,
  };
}
