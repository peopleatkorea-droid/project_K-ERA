import { startTransition, useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";

import { CaseWorkspace } from "../components/case-workspace";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { DesktopLandingScreen } from "./desktop-landing";
import { DesktopLoginPanel, DesktopSessionOpeningCard, DesktopBlockedCard } from "./session-panels";
import { DesktopRuntimeStatusPanel, type RuntimeServiceSummary } from "./runtime-status-panel";
import { DesktopSettingsForm } from "./settings-form";
import { createDesktopShellCopy } from "./shell-copy";
import { createEmptyDesktopConfigForm, describeDesktopShellError, formatTransferSize } from "./shell-helpers";
import { downloadManifest, fetchSiteSummary, type AuthUser, type SiteRecord, type SiteSummary } from "../lib/api";
import { prewarmPatientListPage } from "../lib/cases";
import { clearDesktopSession, clearDesktopSessionCache, DESKTOP_TOKEN_KEY, desktopFetchApprovedSites, desktopFetchCurrentUser, desktopLocalDevLogin, desktopLocalLogin, exchangeDesktopGoogleLogin, loadDesktopSessionCache, persistDesktopSession, saveDesktopSessionCache, startDesktopGoogleLogin } from "../lib/desktop-auth";
import {
  clearDesktopAppConfig,
  fetchDesktopAppConfig,
  openDesktopExternalUrl,
  openDesktopPath,
  pickDesktopDirectory,
  saveDesktopAppConfig,
  type DesktopAppConfigState,
  type DesktopAppConfigValues,
} from "../lib/desktop-app-config";
import {
  ensureDesktopLocalRuntimeReady,
  exportDesktopDiagnosticsBundle,
  fetchDesktopDiagnosticsSnapshot,
  fetchDesktopRuntimeSnapshot,
  stopDesktopLocalRuntime,
  type DesktopDiagnosticsSnapshot,
} from "../lib/desktop-diagnostics";
import { authenticateWithDesktopGoogle, canUseDesktopGoogleAuth } from "../lib/desktop-google-auth";
import { runDesktopSelfCheck, type DesktopSelfCheckSnapshot } from "../lib/desktop-self-check";
import { describeDesktopOnboarding } from "../lib/desktop-onboarding";
import { checkDesktopForUpdates, installDesktopUpdate, type DesktopUpdateCheckResult } from "../lib/desktop-updater";
import { LocaleProvider, LocaleToggle, useI18n } from "../lib/i18n";
import { ThemeProvider, useTheme } from "../lib/theme";

type ConfigFormState = DesktopAppConfigValues;

function DesktopShellApp() {
  const { locale } = useI18n();
  const { resolvedTheme, setTheme } = useTheme();
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [summary, setSummary] = useState<SiteSummary | null>(null);
  const [config, setConfig] = useState<DesktopAppConfigState | null>(null);
  const [configForm, setConfigForm] = useState<ConfigFormState>(() =>
    createEmptyDesktopConfigForm(process.env.NEXT_PUBLIC_KERA_CONTROL_PLANE_API_BASE_URL || ""),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [configBusy, setConfigBusy] = useState(false);
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [runtimeAction, setRuntimeAction] = useState<"refresh" | "start" | "stop" | null>(null);
  const [bootstrapBusy, setBootstrapBusy] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [diagnostics, setDiagnostics] = useState<DesktopDiagnosticsSnapshot | null>(null);
  const [selfCheck, setSelfCheck] = useState<DesktopSelfCheckSnapshot | null>(null);
  const [selfCheckBusy, setSelfCheckBusy] = useState(false);
  const [selfCheckError, setSelfCheckError] = useState<string | null>(null);
  const [supportBusy, setSupportBusy] = useState(false);
  const [supportMessage, setSupportMessage] = useState<string | null>(null);
  const [supportBundlePath, setSupportBundlePath] = useState<string | null>(null);
  const [supportError, setSupportError] = useState<string | null>(null);
  const [updateState, setUpdateState] = useState<DesktopUpdateCheckResult | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const [updateProgress, setUpdateProgress] = useState<string | null>(null);

  const copy = createDesktopShellCopy(locale);
  const desktopGoogleAuthEnabled = canUseDesktopGoogleAuth();

  function updateConfigForm(patch: Partial<ConfigFormState>) {
    setConfigForm((current) => ({ ...current, ...patch }));
  }

  function updateLoginForm(patch: Partial<typeof loginForm>) {
    setLoginForm((current) => ({ ...current, ...patch }));
  }

  async function loadConfigAndRuntime({
    autoStart,
    diagnosticsMode,
  }: {
    autoStart: boolean;
    diagnosticsMode: "runtime" | "full";
  }) {
    setRuntimeBusy(true);
    setRuntimeAction(autoStart ? "start" : "refresh");
    setRuntimeError(null);
    try {
      const loadDiagnostics =
        diagnosticsMode === "full" ? fetchDesktopDiagnosticsSnapshot : fetchDesktopRuntimeSnapshot;
      const nextConfig = await fetchDesktopAppConfig();
      setConfig(nextConfig);
      setConfigForm(nextConfig.values);
      if (!autoStart || !nextConfig.setup_ready) {
        setDiagnostics(await loadDiagnostics());
        return;
      }
      await ensureDesktopLocalRuntimeReady();
      setDiagnostics(await loadDiagnostics());
    } catch (nextError) {
      setRuntimeError(describeDesktopShellError(locale, nextError, copy.runtimeFailed));
    } finally {
      setRuntimeAction(null);
      setRuntimeBusy(false);
    }
  }

  async function handleRefreshRuntime() {
    await loadConfigAndRuntime({ autoStart: false, diagnosticsMode: settingsOpen ? "full" : "runtime" });
  }

  async function handleStartRuntime() {
    await loadConfigAndRuntime({ autoStart: true, diagnosticsMode: settingsOpen ? "full" : "runtime" });
  }

  async function handleStopRuntime() {
    setRuntimeBusy(true);
    setRuntimeAction("stop");
    setRuntimeError(null);
    try {
      await stopDesktopLocalRuntime();
      setDiagnostics(await (settingsOpen ? fetchDesktopDiagnosticsSnapshot() : fetchDesktopRuntimeSnapshot()));
    } catch (nextError) {
      setRuntimeError(describeDesktopShellError(locale, nextError, copy.runtimeFailed));
    } finally {
      setRuntimeAction(null);
      setRuntimeBusy(false);
    }
  }

  async function bootstrapSession(currentToken: string) {
    setBootstrapBusy(true);
    setError(null);
    try {
      const nextUser = await desktopFetchCurrentUser(currentToken);
      const nextSites =
        nextUser.approval_status === "approved" ? await desktopFetchApprovedSites(currentToken) : [];
      setUser(nextUser);
      setSites(nextSites);
      const preferredSiteId = nextSites[0]?.site_id ?? null;
      setSelectedSiteId((current) => (current && nextSites.some((item) => item.site_id === current) ? current : preferredSiteId));
      // 사용자+병원 정보를 로컬 파일에 저장 → 다음 실행부터 Python 없이 즉시 표시
      void saveDesktopSessionCache({ token: currentToken, user: nextUser, sites: nextSites });
      // Pre-warm patient list immediately — result is cached and ready when CaseWorkspace renders
      if (preferredSiteId) {
        prewarmPatientListPage(preferredSiteId, currentToken, { page_size: 25 });
      }
    } catch (nextError) {
      clearDesktopSession();
      setToken(null);
      setUser(null);
      setSites([]);
      setSelectedSiteId(null);
      setSummary(null);
      setError(describeDesktopShellError(locale, nextError, copy.loginFailed));
    } finally {
      setBootstrapBusy(false);
    }
  }

  useEffect(() => {
    // 1. 로컬 캐시에서 즉시 로드 (Python 대기 없음)
    void loadDesktopSessionCache().then((cached) => {
      if (cached?.token && cached.user && cached.sites.length > 0) {
        const preferredSiteId = cached.sites[0]?.site_id ?? null;
        setToken(cached.token);
        setUser(cached.user);
        setSites(cached.sites);
        setSelectedSiteId(preferredSiteId);
        // 캐시에서 복원했으면 bootstrapSession 대신 pre-warm만 실행
        if (preferredSiteId) {
          prewarmPatientListPage(preferredSiteId, cached.token, { page_size: 25 });
        }
        // 백그라운드에서 Python 시작 + 조용히 세션 갱신 (실패해도 화면 유지)
        void loadConfigAndRuntime({ autoStart: true, diagnosticsMode: "runtime" }).then(() => {
          void desktopFetchCurrentUser(cached.token).then(async (nextUser) => {
            const nextSites =
              nextUser.approval_status === "approved" ? await desktopFetchApprovedSites(cached.token) : [];
            setUser(nextUser);
            setSites(nextSites);
            void saveDesktopSessionCache({ token: cached.token, user: nextUser, sites: nextSites });
          }).catch(() => {
            // 토큰 만료 등 → 다음번 명시적 액션 시 재로그인 유도
          });
        });
        return;
      }
      // 캐시 없으면 기존 localStorage 토큰으로 시도
      const stored = window.localStorage.getItem(DESKTOP_TOKEN_KEY);
      if (stored) {
        setToken(stored);
      }
      void loadConfigAndRuntime({ autoStart: true, diagnosticsMode: "runtime" });
    });
  }, []);

  useEffect(() => {
    if (!token || user) {
      // user가 이미 있으면 (캐시에서 복원) bootstrapSession 재실행 불필요
      return;
    }
    void bootstrapSession(token);
  }, [token]);

  useEffect(() => {
    if (!settingsOpen) {
      return;
    }
    const controller = new AbortController();
    void fetchDesktopDiagnosticsSnapshot(controller.signal)
      .then((nextSnapshot) => {
        setDiagnostics(nextSnapshot);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [settingsOpen]);

  // Polling removed — background status checks caused unnecessary CPU/IPC overhead for a 1-2 user desktop app.

  useEffect(() => {
    if (!config || !diagnostics) {
      setSelfCheck(null);
      setSelfCheckError(null);
      return;
    }
    const controller = new AbortController();
    setSelfCheckBusy(true);
    setSelfCheckError(null);
    void runDesktopSelfCheck(config, diagnostics, controller.signal)
      .then((nextSnapshot) => {
        setSelfCheck(nextSnapshot);
      })
      .catch((nextError) => {
        if (!controller.signal.aborted) {
          setSelfCheckError(describeDesktopShellError(locale, nextError, copy.runtimeFailed));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setSelfCheckBusy(false);
        }
      });
    return () => controller.abort();
  }, [config, diagnostics]);

  useEffect(() => {
    void handleCheckUpdates({ silent: true });
  }, []);

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
          setError(describeDesktopShellError(locale, nextError, copy.loginFailed));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSiteId, token, user]);

  async function handleLocalLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthBusy(true);
    setError(null);
    try {
      const auth = await desktopLocalLogin(loginForm.username, loginForm.password);
      persistDesktopSession(auth.access_token);
      setToken(auth.access_token);
    } catch (nextError) {
      setError(describeDesktopShellError(locale, nextError, copy.loginFailed));
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleGoogleLogin() {
    setAuthBusy(true);
    setError(null);
    try {
      const auth = await authenticateWithDesktopGoogle({
        exchangeLogin: exchangeDesktopGoogleLogin,
        startLogin: ({ redirect_uri }) => startDesktopGoogleLogin(redirect_uri),
      });
      persistDesktopSession(auth.access_token);
      setToken(auth.access_token);
    } catch (nextError) {
      console.error("[kera-desktop-google-login]", nextError);
      setError(describeDesktopShellError(locale, nextError, copy.loginFailed));
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleDevLogin() {
    setAuthBusy(true);
    setError(null);
    try {
      const auth = await desktopLocalDevLogin();
      persistDesktopSession(auth.access_token);
      setToken(auth.access_token);
    } catch (nextError) {
      setError(describeDesktopShellError(locale, nextError, copy.loginFailed));
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleSaveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setConfigBusy(true);
    setError(null);
    try {
      const nextConfig = await saveDesktopAppConfig({ config: configForm });
      setConfig(nextConfig);
      setConfigForm(nextConfig.values);
      setSettingsOpen(false);
      await loadConfigAndRuntime({ autoStart: true, diagnosticsMode: "runtime" });
    } catch (nextError) {
      setError(describeDesktopShellError(locale, nextError, copy.runtimeFailed));
    } finally {
      setConfigBusy(false);
    }
  }

  async function handleClearSettings() {
    setConfigBusy(true);
    setError(null);
    try {
      const nextConfig = await clearDesktopAppConfig();
      setConfig(nextConfig);
      setConfigForm(nextConfig.values);
      await loadConfigAndRuntime({ autoStart: false, diagnosticsMode: "runtime" });
    } catch (nextError) {
      setError(describeDesktopShellError(locale, nextError, copy.runtimeFailed));
    } finally {
      setConfigBusy(false);
    }
  }

  async function handleOpenPath(path: string | null | undefined) {
    const normalized = typeof path === "string" ? path.trim() : "";
    if (!normalized) {
      return;
    }
    setError(null);
    try {
      await openDesktopPath(normalized);
    } catch (nextError) {
      setError(describeDesktopShellError(locale, nextError, copy.runtimeFailed));
    }
  }

  async function handleRunSelfCheck() {
    if (!config || !diagnostics) {
      return;
    }
    setSelfCheckBusy(true);
    setSelfCheckError(null);
    try {
      setSelfCheck(await runDesktopSelfCheck(config, diagnostics));
    } catch (nextError) {
      setSelfCheckError(describeDesktopShellError(locale, nextError, copy.runtimeFailed));
    } finally {
      setSelfCheckBusy(false);
    }
  }

  async function handleExportSupportBundle() {
    setSupportBusy(true);
    setSupportError(null);
    setSupportMessage(null);
    try {
      const exported = await exportDesktopDiagnosticsBundle();
      if (!exported?.path) {
        setSupportBundlePath(null);
        return;
      }
      setSupportBundlePath(exported.path);
      setSupportMessage(`${copy.supportBundleReady} ${exported.path}`);
    } catch (nextError) {
      setSupportError(describeDesktopShellError(locale, nextError, copy.runtimeFailed));
    } finally {
      setSupportBusy(false);
    }
  }

  async function handleCheckUpdates(options: { silent?: boolean } = {}) {
    if (!options.silent) {
      setUpdateBusy(true);
      setUpdateMessage(null);
      setSupportError(null);
    }
    try {
      const nextState = await checkDesktopForUpdates();
      setUpdateState(nextState);
      if (!options.silent && nextState && !nextState.available && !nextState.error) {
        setUpdateMessage(copy.noUpdateAvailable);
      }
    } catch (nextError) {
      const message = describeDesktopShellError(locale, nextError, copy.runtimeFailed);
      setSupportError(message);
      setUpdateMessage(message);
    } finally {
      if (!options.silent) {
        setUpdateBusy(false);
      }
    }
  }

  async function handleInstallUpdate() {
    if (!updateState?.installable || !updateState.updateHandle) {
      return;
    }
    setUpdateBusy(true);
    setUpdateMessage(null);
    setUpdateProgress(null);
    setSupportError(null);
    try {
      let downloaded = 0;
      const installResult = await installDesktopUpdate(updateState.updateHandle, (event) => {
        if (event.event === "Started") {
          const total = Number(event.data?.contentLength || 0);
          setUpdateProgress(
            total > 0
              ? `${copy.updateProgress}: 0 / ${formatTransferSize(total)}`
              : `${copy.updateProgress}: 0 B`,
          );
          return;
        }
        if (event.event === "Progress") {
          downloaded += Number(event.data?.chunkLength || 0);
          setUpdateProgress(`${copy.updateProgress}: ${formatTransferSize(downloaded)}`);
          return;
        }
        if (event.event === "Finished") {
          setUpdateProgress(`${copy.updateProgress}: ${copy.installingUpdate}`);
        }
      });
      setUpdateMessage(installResult === "restart_required" ? copy.updateRestartRequired : copy.updateInstalled);
      setUpdateState((current) => (current ? { ...current, available: false } : current));
    } catch (nextError) {
      const message = describeDesktopShellError(locale, nextError, copy.runtimeFailed);
      setSupportError(message);
      setUpdateMessage(message);
    } finally {
      setUpdateBusy(false);
    }
  }

  async function handleOpenReleaseDownload() {
    const url = updateState?.downloadUrl?.trim() || "";
    if (!url) {
      return;
    }
    try {
      await openDesktopExternalUrl(url);
    } catch (nextError) {
      setSupportError(describeDesktopShellError(locale, nextError, copy.runtimeFailed));
    }
  }

  async function handlePickStorageDir() {
    setError(null);
    try {
      const nextPath = await pickDesktopDirectory({
        title: copy.browseStorageDirTitle,
        defaultPath: configForm.storage_dir || config?.values.storage_dir || config?.app_local_data_dir || undefined,
      });
      if (!nextPath) {
        return;
      }
      setConfigForm((current) => ({ ...current, storage_dir: nextPath }));
    } catch (nextError) {
      setError(describeDesktopShellError(locale, nextError, copy.runtimeFailed));
    }
  }

  async function handleExportManifest() {
    if (!token || !selectedSiteId) {
      return;
    }
    const blob = await downloadManifest(selectedSiteId, token);
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${selectedSiteId}_dataset_manifest.csv`;
    anchor.click();
    window.URL.revokeObjectURL(url);
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
    clearDesktopSession();
    void clearDesktopSessionCache();
    setToken(null);
    setUser(null);
    setSites([]);
    setSelectedSiteId(null);
    setSummary(null);
    setError(null);
  }

  function scrollToDesktopShell() {
    window.setTimeout(() => {
      document.getElementById("desktop-local-shell")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 40);
  }

  function handleOpenLandingPrimary() {
    if (!config?.setup_ready) {
      setSettingsOpen(true);
    }
    scrollToDesktopShell();
  }

  function handleOpenLandingSecondary() {
    setSettingsOpen(true);
    scrollToDesktopShell();
  }

  const settingsShouldBeVisible = settingsOpen || !config?.setup_ready;
  const backendHealthy = diagnostics?.localBackend?.healthy ?? false;
  const workerRunning = diagnostics?.localWorker?.running ?? false;
  const runtimeSummary = diagnostics?.localBackend ?? null;
  const runtimeContract = config?.runtime_contract ?? null;
  const storagePath = config?.values.storage_dir || configForm.storage_dir;
  const onboarding = describeDesktopOnboarding(config, diagnostics);
  const showOnboarding = !token || !onboarding.canOpenWorkspace;
  const selfCheckBlockingFailures = selfCheck?.items.filter((item) => item.blocking && item.status === "fail") ?? [];
  const selfCheckSummary = selfCheckBlockingFailures.length === 0 ? copy.checksReady : copy.checksBlocked;
  const approvedWorkspaceSession = token && user && user.approval_status === "approved";
  const runtimeServiceSummaries: RuntimeServiceSummary[] = [
    {
      id: "backend",
      label: copy.backendService,
      value: onboarding.runtimeServices.backendReady ? copy.readyState : copy.attentionState,
      tone: onboarding.runtimeServices.backendReady ? "ready" : "attention",
    },
    {
      id: "worker",
      label: copy.workerService,
      value: onboarding.runtimeServices.workerRequired
        ? onboarding.runtimeServices.workerReady
          ? copy.readyState
          : copy.attentionState
        : copy.optionalState,
      tone: onboarding.runtimeServices.workerRequired
        ? onboarding.runtimeServices.workerReady
          ? "ready"
          : "attention"
        : "neutral",
    },
    {
      id: "ml",
      label: copy.mlService,
      value: onboarding.runtimeServices.mlRequired
        ? onboarding.runtimeServices.mlReady
          ? copy.readyState
          : copy.attentionState
        : copy.optionalState,
      tone: onboarding.runtimeServices.mlRequired
        ? onboarding.runtimeServices.mlReady
          ? "ready"
          : "attention"
        : "neutral",
    },
  ];

  if (approvedWorkspaceSession) {
    return (
      <CaseWorkspace
        token={token}
        user={user}
        sites={sites}
        selectedSiteId={selectedSiteId}
        summary={summary}
        canOpenOperations={false}
        theme={resolvedTheme}
        onSelectSite={setSelectedSiteId}
        onExportManifest={() => void handleExportManifest()}
        onLogout={handleLogout}
        onOpenOperations={() => undefined}
        onSiteDataChanged={handleRefreshSite}
        onToggleTheme={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      />
    );
  }

  return (
    <main className="min-h-screen bg-[#0d0f14]">
      <DesktopLandingScreen
        setupReady={Boolean(config?.setup_ready)}
        onPrimaryAction={handleOpenLandingPrimary}
        onSecondaryAction={handleOpenLandingSecondary}
      />
      <section
        id="desktop-local-shell"
        className="bg-[radial-gradient(circle_at_top,rgba(48,88,255,0.12),transparent_30%),linear-gradient(180deg,var(--surface-muted),var(--surface))] px-4 py-6 sm:px-6 lg:px-8"
      >
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4">
        <div>
          <div className="text-[0.76rem] font-semibold uppercase tracking-[0.16em] text-muted">
            {copy.desktopRuntimeEyebrow}
          </div>
          <h1 className="m-0 text-2xl font-semibold tracking-[-0.03em] text-ink">{copy.title}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{copy.subtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          <Button type="button" variant="ghost" size="sm" onClick={() => setSettingsOpen((current) => !current)}>
            {settingsShouldBeVisible ? copy.closeSettings : copy.openSettings}
          </Button>
          <LocaleToggle />
        </div>
      </div>

      <section className="mx-auto mt-6 grid w-full max-w-7xl gap-5 xl:grid-cols-[minmax(340px,420px)_minmax(0,1fr)]">
        <Card as="section" variant="surface" className="grid h-fit gap-5 p-6">
          <DesktopRuntimeStatusPanel
            locale={locale}
            copy={copy}
            runtimeError={runtimeError}
            error={error}
            showOnboarding={showOnboarding}
            onboarding={onboarding}
            runtimeServiceSummaries={runtimeServiceSummaries}
            runtimeBusy={runtimeBusy}
            runtimeAction={runtimeAction}
            backendHealthy={backendHealthy}
            workerRunning={workerRunning}
            runtimeSummary={runtimeSummary}
            selfCheck={selfCheck}
            selfCheckBusy={selfCheckBusy}
            selfCheckError={selfCheckError}
            selfCheckBlockingFailures={selfCheckBlockingFailures}
            selfCheckSummary={selfCheckSummary}
            canRunSelfCheck={Boolean(config && diagnostics)}
            config={config}
            storagePath={storagePath}
            onOpenSettings={() => setSettingsOpen(true)}
            onRefreshRuntime={() => void handleRefreshRuntime()}
            onStartRuntime={() => void handleStartRuntime()}
            onStopRuntime={() => void handleStopRuntime()}
            onRunSelfCheck={() => void handleRunSelfCheck()}
            onOpenPath={(path) => void handleOpenPath(path)}
          />

          {settingsShouldBeVisible ? (
            <DesktopSettingsForm
              copy={copy}
              config={config}
              configForm={configForm}
              configBusy={configBusy}
              runtimeContract={runtimeContract}
              storagePath={storagePath}
              supportBusy={supportBusy}
              supportMessage={supportMessage}
              supportBundlePath={supportBundlePath}
              supportError={supportError}
              updateState={updateState}
              updateBusy={updateBusy}
              updateMessage={updateMessage}
              updateProgress={updateProgress}
              onSubmit={handleSaveSettings}
              onReset={() => void handleClearSettings()}
              onConfigChange={updateConfigForm}
              onPickStorageDir={() => void handlePickStorageDir()}
              onOpenPath={(path) => void handleOpenPath(path)}
              onExportSupportBundle={() => void handleExportSupportBundle()}
              onCheckUpdates={() => void handleCheckUpdates()}
              onInstallUpdate={() => void handleInstallUpdate()}
              onOpenReleaseDownload={() => void handleOpenReleaseDownload()}
            />
          ) : null}

          {!token || !user ? (
            <DesktopLoginPanel
              copy={copy}
              authBusy={authBusy}
              backendHealthy={backendHealthy}
              desktopGoogleAuthEnabled={desktopGoogleAuthEnabled}
              loginForm={loginForm}
              showDevLogin={process.env.NODE_ENV !== "production"}
              onSubmit={handleLocalLogin}
              onGoogleLogin={() => void handleGoogleLogin()}
              onDevLogin={() => void handleDevLogin()}
              onLoginChange={updateLoginForm}
            />
          ) : null}
        </Card>

        <div className="min-h-[620px]">
          {token && (!user || bootstrapBusy) ? (
            <DesktopSessionOpeningCard copy={copy} />
          ) : null}

          {token && user && user.approval_status !== "approved" ? (
            <DesktopBlockedCard copy={copy} onLogout={handleLogout} />
          ) : null}

        </div>
      </section>
      </section>
    </main>
  );
}

function DesktopShellProviders() {
  return (
    <ThemeProvider>
      <LocaleProvider>
        <DesktopShellApp />
      </LocaleProvider>
    </ThemeProvider>
  );
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Desktop shell root element was not found.");
}

createRoot(rootElement).render(<DesktopShellProviders />);
