import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { CaseWorkspace } from "../components/case-workspace";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { DesktopLandingScreen } from "./desktop-landing";
import { DesktopLoginPanel, DesktopSessionOpeningCard, DesktopBlockedCard } from "./session-panels";
import { DesktopRuntimeStatusPanel } from "./runtime-status-panel";
import { DesktopSettingsForm } from "./settings-form";
import { createDesktopShellCopy } from "./shell-copy";
import { useDesktopRuntime } from "./use-desktop-runtime";
import { useDesktopSession } from "./use-desktop-session";
import { downloadManifest } from "../lib/api";
import { canUseDesktopGoogleAuth } from "../lib/desktop-google-auth";
import { LocaleProvider, LocaleToggle, useI18n } from "../lib/i18n";
import { ThemeProvider, useTheme } from "../lib/theme";

function DesktopShellApp() {
  const { locale } = useI18n();
  const { resolvedTheme, setTheme } = useTheme();
  const [error, setError] = useState<string | null>(null);
  const [workspaceSettingsOpen, setWorkspaceSettingsOpen] = useState(false);

  const copy = createDesktopShellCopy(locale);
  const desktopGoogleAuthEnabled = canUseDesktopGoogleAuth();

  const {
    config,
    configForm,
    settingsOpen,
    setSettingsOpen,
    configBusy,
    runtimeBusy,
    runtimeAction,
    runtimeError,
    diagnostics,
    selfCheck,
    selfCheckBusy,
    selfCheckError,
    supportBusy,
    supportMessage,
    supportBundlePath,
    supportError,
    updateState,
    updateBusy,
    updateMessage,
    updateProgress,
    settingsShouldBeVisible,
    backendHealthy,
    workerRunning,
    runtimeSummary,
    runtimeContract,
    storagePath,
    onboarding,
    selfCheckBlockingFailures,
    selfCheckSummary,
    runtimeServiceSummaries,
    updateConfigForm,
    warmDesktopRuntime,
    handleRefreshRuntime,
    handleStartRuntime,
    handleStopRuntime,
    handleSaveSettings,
    handleClearSettings,
    handleOpenPath,
    handleRunSelfCheck,
    handleExportSupportBundle,
    handleCheckUpdates,
    handleInstallUpdate,
    handleOpenReleaseDownload,
    handlePickStorageDir,
  } = useDesktopRuntime({
    locale,
    copy,
    setShellError: setError,
  });

  const {
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
  } = useDesktopSession({
    locale,
    copy: { loginFailed: copy.loginFailed },
    warmDesktopRuntime,
    setShellError: setError,
  });

  useEffect(() => {
    if (!token) {
      setWorkspaceSettingsOpen(false);
    }
  }, [token]);

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

  function scrollToDesktopShell() {
    window.setTimeout(() => {
      document.getElementById("desktop-local-shell")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 40);
  }

  function handleOpenLandingPrimary() {
    scrollToDesktopShell();
  }

  function handleOpenLandingSecondary() {
    setSettingsOpen(true);
    scrollToDesktopShell();
  }
  const approvedWorkspaceSession = token && user && user.approval_status === "approved";
  const showOnboarding = Boolean(token) && !onboarding.canOpenWorkspace;
  const showSetupPanel = settingsShouldBeVisible;
  const showRuntimePanel =
    Boolean(token) ||
    Boolean(runtimeError) ||
    Boolean(error) ||
    (diagnostics !== null && !backendHealthy);
  const showSessionAside = Boolean(token);
  const shellGridClassName = showSessionAside
    ? "mx-auto mt-6 grid w-full max-w-7xl gap-5 xl:grid-cols-[minmax(340px,420px)_minmax(0,1fr)]"
    : "mx-auto mt-6 grid w-full max-w-4xl gap-5";

  if (approvedWorkspaceSession) {
    if (workspaceSettingsOpen) {
      // fall through to the shell so desktop settings can be edited after sign-in
    } else {
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
        onOpenDesktopSettings={() => {
          setWorkspaceSettingsOpen(true);
          setSettingsOpen(true);
        }}
        onSiteDataChanged={handleRefreshSite}
        onToggleTheme={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      />
    );
    }
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
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              if (workspaceSettingsOpen) {
                setWorkspaceSettingsOpen(false);
                setSettingsOpen(false);
                return;
              }
              setSettingsOpen((current) => !current);
            }}
          >
            {workspaceSettingsOpen
              ? copy.returnToWorkspace
              : settingsShouldBeVisible
                ? copy.closeSettings
                : copy.openSettings}
          </Button>
          <LocaleToggle />
        </div>
      </div>

      <section className={shellGridClassName}>
        <Card as="section" variant="surface" className="grid h-fit gap-5 p-6">
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

          {showSetupPanel ? (
            <DesktopSettingsForm
              copy={copy}
              form={{
                config,
                configForm,
                configBusy,
                runtimeContract,
                storagePath,
              }}
              support={{
                supportBusy,
                supportMessage,
                supportBundlePath,
                supportError,
              }}
              updates={{
                updateState,
                updateBusy,
                updateMessage,
                updateProgress,
              }}
              actions={{
                onSubmit: handleSaveSettings,
                onReset: () => void handleClearSettings(),
                onConfigChange: updateConfigForm,
                onPickStorageDir: () => void handlePickStorageDir(),
                onOpenPath: (path) => void handleOpenPath(path),
                onExportSupportBundle: () => void handleExportSupportBundle(),
                onCheckUpdates: () => void handleCheckUpdates(),
                onInstallUpdate: () => void handleInstallUpdate(),
                onOpenReleaseDownload: () => void handleOpenReleaseDownload(),
              }}
            />
          ) : null}

          {showRuntimePanel ? (
            <DesktopRuntimeStatusPanel
              locale={locale}
              copy={copy}
              state={{
                runtimeError,
                error,
                showOnboarding,
                onboarding,
                runtimeServiceSummaries,
                runtimeBusy,
                runtimeAction,
                backendHealthy,
                workerRunning,
                runtimeSummary,
                selfCheck,
                selfCheckBusy,
                selfCheckError,
                selfCheckBlockingFailures,
                selfCheckSummary,
                canRunSelfCheck: Boolean(config && diagnostics),
                config,
                storagePath,
              }}
              actions={{
                onOpenSettings: () => setSettingsOpen(true),
                onRefreshRuntime: () => void handleRefreshRuntime(),
                onStartRuntime: () => void handleStartRuntime(),
                onStopRuntime: () => void handleStopRuntime(),
                onRunSelfCheck: () => void handleRunSelfCheck(),
                onOpenPath: (path) => void handleOpenPath(path),
              }}
            />
          ) : null}
        </Card>

        {showSessionAside ? (
          <div className="min-h-[620px]">
            {token && (!user || bootstrapBusy) ? (
              <DesktopSessionOpeningCard copy={copy} />
            ) : null}

            {token && user && user.approval_status !== "approved" ? (
              <DesktopBlockedCard copy={copy} onLogout={handleLogout} />
            ) : null}
          </div>
        ) : null}
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
const desktopStrictModeEnabled = process.env.NEXT_PUBLIC_KERA_DESKTOP_STRICT_MODE === "1";

if (!rootElement) {
  throw new Error("Desktop shell root element was not found.");
}

createRoot(rootElement).render(
  desktopStrictModeEnabled ? (
    <StrictMode>
      <DesktopShellProviders />
    </StrictMode>
  ) : (
    <DesktopShellProviders />
  ),
);
