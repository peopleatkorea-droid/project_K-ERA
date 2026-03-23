import { startTransition, useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";

import { CaseWorkspace } from "../components/case-workspace";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Field } from "../components/ui/field";
import { SectionHeader } from "../components/ui/section-header";
import { downloadManifest, fetchSiteSummary, type AuthUser, type SiteRecord, type SiteSummary } from "../lib/api";
import { prewarmPatientListPage } from "../lib/cases";
import {
  clearDesktopSession,
  clearDesktopSessionCache,
  DESKTOP_TOKEN_KEY,
  desktopFetchApprovedSites,
  desktopFetchCurrentUser,
  loadDesktopSessionCache,
  persistDesktopSession,
  saveDesktopSessionCache,
} from "../lib/desktop-auth";
import {
  fetchDesktopAppConfig,
  openDesktopPath,
  pickDesktopDirectory,
  saveDesktopAppConfig,
  type DesktopAppConfigState,
  type DesktopAppConfigValues,
} from "../lib/desktop-app-config";
import { ensureDesktopLocalRuntimeReady } from "../lib/desktop-diagnostics";
import { authenticateWithDesktopGoogle } from "../lib/desktop-google-auth";
import type { AuthResponse } from "../lib/types";
import { LocaleProvider, LocaleToggle, pick, translateApiError, useI18n } from "../lib/i18n";
import { ThemeProvider, useTheme } from "../lib/theme";
import { DesktopLandingScreen } from "./desktop-landing";

type ConfigFormState = DesktopAppConfigValues;

function createEmptyConfigForm(): ConfigFormState {
  return {
    storage_dir: "",
    control_plane_api_base_url: "",
    control_plane_node_id: "",
    control_plane_node_token: "",
    control_plane_site_id: "",
    local_backend_python: "",
    local_backend_mode: "managed",
    ml_transport: "sidecar",
  };
}

function DesktopShellApp() {
  const { locale } = useI18n();
  const { resolvedTheme, setTheme } = useTheme();
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [summary, setSummary] = useState<SiteSummary | null>(null);
  const [config, setConfig] = useState<DesktopAppConfigState | null>(null);
  const [configForm, setConfigForm] = useState<ConfigFormState>(createEmptyConfigForm);
  const [workspaceSettingsOpen, setWorkspaceSettingsOpen] = useState(false);
  const [bootstrapBusy, setBootstrapBusy] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [configBusy, setConfigBusy] = useState(false);
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const copy = {
    loginFailed: pick(locale, "Login failed.", "로그인에 실패했습니다."),
    runtimeFailed: pick(locale, "The desktop app could not start its local services.", "데스크톱 앱의 로컬 서비스를 시작하지 못했습니다."),
    sessionBusy: pick(locale, "Opening saved session...", "저장된 세션을 여는 중..."),
    sessionBlocked: pick(
      locale,
      "This desktop app opens only approved local workspace accounts. Use the web admin app for access requests and central operations.",
      "이 데스크톱 앱은 승인된 로컬 워크스페이스 계정만 엽니다. 접근 요청과 중앙 운영은 웹 관리자 앱에서 진행하세요.",
    ),
    signOut: pick(locale, "Sign out", "로그아웃"),
    settingsTitle: pick(locale, "Desktop settings", "데스크톱 설정"),
    settingsDescription: pick(
      locale,
      "Most users only need the local storage folder. The shared server address and secret keys stay on kera-bay.vercel.app.",
      "대부분의 사용자는 로컬 저장소 폴더만 보면 됩니다. 공용 서버 주소와 비밀 키는 kera-bay.vercel.app에서 관리합니다.",
    ),
    storageTitle: pick(locale, "Storage", "저장소"),
    storageDescription: pick(
      locale,
      "Choose where this PC stores images, SQLite data, models, and logs. Leave it blank to keep using the current default location.",
      "이 PC가 이미지, SQLite 데이터, 모델, 로그를 저장할 위치를 정합니다. 비워 두면 현재 기본 위치를 계속 사용합니다.",
    ),
    storageDir: pick(locale, "Data folder", "데이터 폴더"),
    storageDirHint: pick(
      locale,
      "This is the only setting most researchers need on the desktop app.",
      "대부분의 연구자에게는 이 항목만 있으면 됩니다.",
    ),
    browseStorageDir: pick(locale, "Browse", "찾아보기"),
    browseStorageDirTitle: pick(locale, "Choose data folder", "데이터 폴더 선택"),
    saveSettings: pick(locale, "Save", "저장"),
    savingSettings: pick(locale, "Saving...", "저장 중..."),
    backToWorkspace: pick(locale, "Back to workspace", "워크스페이스로 돌아가기"),
    supportTitle: pick(locale, "Support tools", "지원 도구"),
    supportDescription: pick(
      locale,
      "Open these only when support asks for them or something is broken.",
      "지원 담당자가 요청하거나 문제가 있을 때만 여세요.",
    ),
    configPath: pick(locale, "Config file", "설정 파일"),
    appDataDir: pick(locale, "App data", "앱 데이터"),
    runtimeLogs: pick(locale, "Logs", "로그"),
    resourceDir: pick(locale, "Resources", "리소스"),
    openConfigFile: pick(locale, "Open config", "설정 열기"),
    openAppData: pick(locale, "Open app data", "앱 데이터 열기"),
    openRuntimeLogs: pick(locale, "Open logs", "로그 열기"),
    openResources: pick(locale, "Open resources", "리소스 열기"),
  };

  function describeError(nextError: unknown, fallback: string) {
    if (nextError instanceof Error) {
      return translateApiError(locale, nextError.message);
    }
    if (typeof nextError === "string" && nextError.trim()) {
      return translateApiError(locale, nextError.trim());
    }
    if (
      nextError &&
      typeof nextError === "object" &&
      "message" in nextError &&
      typeof (nextError as { message?: unknown }).message === "string"
    ) {
      return translateApiError(locale, String((nextError as { message: string }).message));
    }
    return fallback;
  }

  async function loadDesktopRuntime(autoStart: boolean) {
    setRuntimeBusy(true);
    setRuntimeError(null);
    try {
      const nextConfig = await fetchDesktopAppConfig();
      setConfig(nextConfig);
      setConfigForm(nextConfig.values);
      if (autoStart && nextConfig.setup_ready) {
        await ensureDesktopLocalRuntimeReady();
      }
    } catch (nextError) {
      setRuntimeError(describeError(nextError, copy.runtimeFailed));
    } finally {
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
      void saveDesktopSessionCache({ token: currentToken, user: nextUser, sites: nextSites });
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
      setError(describeError(nextError, copy.loginFailed));
    } finally {
      setBootstrapBusy(false);
    }
  }

  useEffect(() => {
    void loadDesktopSessionCache().then((cached) => {
      if (cached?.token && cached.user && cached.sites.length > 0) {
        const preferredSiteId = cached.sites[0]?.site_id ?? null;
        setToken(cached.token);
        setUser(cached.user);
        setSites(cached.sites);
        setSelectedSiteId(preferredSiteId);
        if (preferredSiteId) {
          prewarmPatientListPage(preferredSiteId, cached.token, { page_size: 25 });
        }
        void loadDesktopRuntime(true).then(() => {
          void desktopFetchCurrentUser(cached.token)
            .then(async (nextUser) => {
              const nextSites =
                nextUser.approval_status === "approved" ? await desktopFetchApprovedSites(cached.token) : [];
              setUser(nextUser);
              setSites(nextSites);
              void saveDesktopSessionCache({ token: cached.token, user: nextUser, sites: nextSites });
            })
            .catch(() => undefined);
        });
        return;
      }

      const stored = window.localStorage.getItem(DESKTOP_TOKEN_KEY);
      if (stored) {
        setToken(stored);
        void loadDesktopRuntime(true);
      } else {
        void loadDesktopRuntime(false);
      }
    });
  }, []);

  useEffect(() => {
    if (!token || user) {
      return;
    }
    void bootstrapSession(token);
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
          setError(describeError(nextError, copy.loginFailed));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSiteId, token, user, locale]);

  async function handleGoogleLogin() {
    setAuthBusy(true);
    setError(null);
    try {
      const VERCEL_ROOT = "https://kera-bay.vercel.app";
      const auth = await authenticateWithDesktopGoogle<AuthResponse>({
        startLogin: async ({ redirect_uri }) => {
          const resp = await fetch(`${VERCEL_ROOT}/control-plane/api/main/auth/desktop/start`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ redirect_uri }),
          });
          if (!resp.ok) {
            const payload = await resp.json().catch(() => ({})) as { detail?: string };
            throw new Error(payload.detail || "Google 로그인을 시작할 수 없습니다.");
          }
          return resp.json();
        },
        exchangeLogin: async (payload) => {
          const resp = await fetch(`${VERCEL_ROOT}/control-plane/api/main/auth/desktop/exchange`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (!resp.ok) {
            const body = await resp.json().catch(() => ({})) as { detail?: string };
            throw new Error(body.detail || "Google 로그인에 실패했습니다.");
          }
          return resp.json() as Promise<AuthResponse>;
        },
      });
      persistDesktopSession(auth.access_token);
      setToken(auth.access_token);
    } catch (nextError) {
      console.error("[kera-desktop-google-login]", nextError);
      setError(describeError(nextError, copy.loginFailed));
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleSaveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setConfigBusy(true);
    setError(null);
    try {
      const nextConfig = await saveDesktopAppConfig({
        config: {
          storage_dir: configForm.storage_dir,
        },
      });
      setConfig(nextConfig);
      setConfigForm(nextConfig.values);
      await loadDesktopRuntime(true);
      setWorkspaceSettingsOpen(false);
    } catch (nextError) {
      setError(describeError(nextError, copy.runtimeFailed));
    } finally {
      setConfigBusy(false);
    }
  }

  async function handlePickStorageDir() {
    setError(null);
    try {
      const nextPath = await pickDesktopDirectory({
        title: copy.browseStorageDirTitle,
        defaultPath: configForm.storage_dir || config?.values.storage_dir || undefined,
      });
      if (nextPath) {
        setConfigForm((current) => ({ ...current, storage_dir: nextPath }));
      }
    } catch (nextError) {
      setError(describeError(nextError, copy.runtimeFailed));
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
      setError(describeError(nextError, copy.runtimeFailed));
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
    setWorkspaceSettingsOpen(false);
    setError(null);
  }

  const screenError = error ?? runtimeError;
  const approvedWorkspaceSession = token && user && user.approval_status === "approved";

  if (approvedWorkspaceSession && !workspaceSettingsOpen) {
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
        onOpenDesktopSettings={() => setWorkspaceSettingsOpen(true)}
        onSiteDataChanged={handleRefreshSite}
        onToggleTheme={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      />
    );
  }

  if (approvedWorkspaceSession && workspaceSettingsOpen) {
    const runtimeContract = config?.runtime_contract ?? null;
    const storageValue = configForm.storage_dir || config?.values.storage_dir || "";

    return (
      <main className="min-h-screen bg-[#0d0f14] px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-3xl gap-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="grid gap-2">
              <div className="text-[0.76rem] font-semibold uppercase tracking-[0.16em] text-[#7b88a8]">
                {copy.settingsTitle}
              </div>
              <h1 className="m-0 text-2xl font-semibold tracking-[-0.03em] text-[#e4e8f5]">{copy.settingsTitle}</h1>
              <p className="m-0 max-w-2xl text-sm leading-6 text-[#8c97b1]">{copy.settingsDescription}</p>
            </div>
            <div className="flex items-center gap-3">
              <LocaleToggle />
              <Button type="button" variant="ghost" onClick={() => setWorkspaceSettingsOpen(false)}>
                {copy.backToWorkspace}
              </Button>
            </div>
          </div>

          {screenError ? (
            <div className="rounded-[18px] border border-danger/25 bg-danger/8 px-4 py-3 text-sm text-danger">{screenError}</div>
          ) : null}

          <Card as="section" variant="surface" className="grid gap-5 p-6">
            <form className="grid gap-5" onSubmit={handleSaveSettings}>
              <SectionHeader title={copy.storageTitle} description={copy.storageDescription} />
              <Field as="div" label={copy.storageDir} hint={copy.storageDirHint} htmlFor="desktop-storage-dir" unstyledControl>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <input
                    className="min-h-12 w-full rounded-[14px] border border-border/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(248,250,252,0.88))] px-3.5 py-2.5 text-sm text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_6px_16px_rgba(15,23,42,0.03)] outline-none transition duration-150 ease-out placeholder:text-muted focus:border-brand/25 focus:ring-4 focus:ring-[rgba(48,88,255,0.12)]"
                    id="desktop-storage-dir"
                    value={storageValue}
                    onChange={(event) => setConfigForm((current) => ({ ...current, storage_dir: event.target.value }))}
                    placeholder="C:\\Users\\<user>\\AppData\\Local\\KERA\\KERA_DATA"
                  />
                  <Button type="button" variant="ghost" onClick={() => void handlePickStorageDir()}>
                    {copy.browseStorageDir}
                  </Button>
                </div>
              </Field>
              <div className="flex flex-wrap gap-3">
                <Button type="submit" variant="primary" disabled={configBusy || runtimeBusy}>
                  {configBusy ? copy.savingSettings : copy.saveSettings}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setWorkspaceSettingsOpen(false)}>
                  {copy.backToWorkspace}
                </Button>
              </div>
            </form>
          </Card>

          <details className="rounded-[22px] border border-border bg-surface p-5 text-sm text-ink">
            <summary className="cursor-pointer font-semibold text-ink">{copy.supportTitle}</summary>
            <div className="mt-4 grid gap-4">
              <p className="m-0 text-muted">{copy.supportDescription}</p>
              {config?.config_path ? (
                <div className="grid gap-1">
                  <span className="text-muted">{copy.configPath}</span>
                  <code className="overflow-x-auto whitespace-nowrap text-[0.82rem] text-ink">{config.config_path}</code>
                </div>
              ) : null}
              {config?.app_local_data_dir ? (
                <div className="grid gap-1">
                  <span className="text-muted">{copy.appDataDir}</span>
                  <code className="overflow-x-auto whitespace-nowrap text-[0.82rem] text-ink">{config.app_local_data_dir}</code>
                </div>
              ) : null}
              {runtimeContract?.logs_dir ? (
                <div className="grid gap-1">
                  <span className="text-muted">{copy.runtimeLogs}</span>
                  <code className="overflow-x-auto whitespace-nowrap text-[0.82rem] text-ink">{runtimeContract.logs_dir}</code>
                </div>
              ) : null}
              {runtimeContract?.resource_dir ? (
                <div className="grid gap-1">
                  <span className="text-muted">{copy.resourceDir}</span>
                  <code className="overflow-x-auto whitespace-nowrap text-[0.82rem] text-ink">{runtimeContract.resource_dir}</code>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-3">
                <Button type="button" variant="ghost" size="sm" disabled={!config?.config_path} onClick={() => void handleOpenPath(config?.config_path)}>
                  {copy.openConfigFile}
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={!config?.app_local_data_dir} onClick={() => void handleOpenPath(config?.app_local_data_dir)}>
                  {copy.openAppData}
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={!runtimeContract?.logs_dir} onClick={() => void handleOpenPath(runtimeContract?.logs_dir)}>
                  {copy.openRuntimeLogs}
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={!runtimeContract?.resource_dir} onClick={() => void handleOpenPath(runtimeContract?.resource_dir)}>
                  {copy.openResources}
                </Button>
              </div>
            </div>
          </details>
        </div>
      </main>
    );
  }

  if (!token) {
    return <DesktopLandingScreen authBusy={authBusy} error={screenError} onGoogleLaunch={() => void handleGoogleLogin()} />;
  }

  if (!user || bootstrapBusy) {
    return (
      <main className="min-h-screen bg-[#0d0f14] px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-xl gap-5">
          {screenError ? (
            <div className="rounded-[18px] border border-danger/25 bg-danger/8 px-4 py-3 text-sm text-danger">{screenError}</div>
          ) : null}
          <Card as="section" variant="surface" className="grid gap-4 p-6">
            <SectionHeader title={pick(locale, "Opening session", "세션 여는 중")} description={copy.sessionBusy} />
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0d0f14] px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-2xl gap-5">
        {screenError ? (
          <div className="rounded-[18px] border border-danger/25 bg-danger/8 px-4 py-3 text-sm text-danger">{screenError}</div>
        ) : null}
        <Card as="section" variant="surface" className="grid gap-5 p-6">
          <SectionHeader
            title={pick(locale, "Workspace access required", "워크스페이스 접근 필요")}
            description={copy.sessionBlocked}
            aside={
              <Button type="button" variant="ghost" size="sm" onClick={handleLogout}>
                {copy.signOut}
              </Button>
            }
          />
        </Card>
      </div>
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
