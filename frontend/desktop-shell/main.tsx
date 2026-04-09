import { startTransition, useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";

import { AdminWorkspace, type WorkspaceSection } from "../components/admin-workspace";
import { CaseWorkspace } from "../components/case-workspace";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Field } from "../components/ui/field";
import { SectionHeader } from "../components/ui/section-header";
import {
  downloadManifest,
  fetchSiteSummary,
  fetchSiteSummaryCounts,
  mergeSiteSummaryCounts,
  type AuthUser,
  type SiteRecord,
  type SiteSummary,
} from "../lib/api";
import { prewarmPatientListPage } from "../lib/cases";
import {
  clearDesktopSession,
  clearDesktopSessionCache,
  DESKTOP_TOKEN_KEY,
  desktopFetchApprovedSites,
  desktopFetchCurrentUser,
  desktopLocalLogin,
  exchangeDesktopGoogleLogin,
  loadDesktopSessionCache,
  persistDesktopSession,
  saveDesktopSessionCache,
  startDesktopGoogleLogin,
} from "../lib/desktop-auth";
import {
  fetchDesktopAppConfig,
  openDesktopPath,
  pickDesktopDirectory,
  saveDesktopAppConfig,
  type DesktopAppConfigState,
  type DesktopAppConfigValues,
} from "../lib/desktop-app-config";
import { describeDesktopGoogleLoginError } from "../lib/desktop-auth-errors";
import { ensureDesktopLocalBackendReady, stopDesktopLocalRuntime } from "../lib/desktop-diagnostics";
import { authenticateWithDesktopGoogle } from "../lib/desktop-google-auth";
import {
  probeDesktopControlPlaneStatus,
  type DesktopControlPlaneProbe,
} from "../lib/desktop-control-plane-status";
import { LocaleProvider, LocaleToggle, pick, translateApiError, useI18n } from "../lib/i18n";
import { prewarmDesktopWorker } from "../lib/desktop-runtime-prewarm";
import { isTokenExpired, readTokenExpiresAt } from "../lib/token-payload";
import { ThemeProvider, useTheme } from "../lib/theme";
import { DesktopLandingScreen } from "./desktop-landing";

type ConfigFormState = DesktopAppConfigValues;
type DesktopWorkspaceMode = "canvas" | "operations";

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

function formatApproxGiB(bytes: number) {
  return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
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
  const [workspaceMode, setWorkspaceMode] = useState<DesktopWorkspaceMode>("canvas");
  const [operationsSection, setOperationsSection] = useState<WorkspaceSection>("management");
  const [workspaceSettingsOpen, setWorkspaceSettingsOpen] = useState(false);
  const [adminLoginOpen, setAdminLoginOpen] = useState(false);
  const [adminForm, setAdminForm] = useState({ username: "", password: "" });
  const [bootstrapBusy, setBootstrapBusy] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [configBusy, setConfigBusy] = useState(false);
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [runtimeReadyCycle, setRuntimeReadyCycle] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [controlPlaneStatus, setControlPlaneStatus] = useState<DesktopControlPlaneProbe | null>(null);
  const [controlPlaneStatusBusy, setControlPlaneStatusBusy] = useState(false);

  const copy = {
    loginFailed: pick(locale, "Login failed.", "로그인에 실패했습니다."),
    runtimeFailed: pick(locale, "The desktop app could not start its local services.", "데스크톱 앱의 로컬 서비스를 시작하지 못했습니다."),
    sessionBusy: pick(locale, "Opening saved session...", "저장된 세션을 여는 중..."),
    sessionExpired: pick(locale, "Your session expired. Sign in again.", "세션이 만료되었습니다. 다시 로그인해 주세요."),
    sessionBlocked: pick(
      locale,
      "This desktop app opens only approved local workspace accounts. Use the web admin app for access requests and central operations.",
      "이 데스크톱 앱은 승인된 로컬 워크스페이스 계정만 엽니다. 접근 요청과 중앙 운영은 웹 관리자 앱에서 진행하세요.",
    ),
    signOut: pick(locale, "Sign out", "로그아웃"),
    adminLoginEyebrow: pick(locale, "Operator Sign-In", "운영 계정 로그인"),
    adminLoginPanelTitle: pick(locale, "Admin Access", "관리자 접근"),
    adminLoginTitle: pick(locale, "Local admin / site admin sign-in", "로컬 admin / site admin 로그인"),
    adminLoginDescription: pick(
      locale,
      "Use this path for admin and site admin accounts. Research users should return to Google sign-in.",
      "이 경로는 admin 및 site admin 계정 전용입니다. 연구 사용자는 Google 로그인으로 돌아가야 합니다."
    ),
    adminUsername: pick(locale, "Username", "아이디"),
    adminPassword: pick(locale, "Password", "비밀번호"),
    adminSubmit: pick(locale, "Enter operator workspace", "운영 계정으로 입장"),
    adminSubmitting: pick(locale, "Signing in...", "로그인 중..."),
    adminBackToMain: pick(locale, "Back to Google sign-in", "Google 로그인으로 돌아가기"),
    adminSafetyTitle: pick(locale, "Restricted entry", "제한된 진입"),
    adminSafetyBody: pick(
      locale,
      "This route bypasses the standard researcher flow. Use it only for operational accounts.",
      "이 경로는 일반 연구자 흐름을 우회합니다. 운영 계정에만 사용하세요."
    ),
    adminSafetyFootnote: pick(
      locale,
      "Admin and site admin accounts should sign in here with passwords.",
      "admin 및 site admin 계정은 이곳에서 비밀번호로 로그인해야 합니다."
    ),
    researchUserSignIn: pick(locale, "Research user sign-in", "연구 사용자 로그인"),
    settingsTitle: pick(locale, "Desktop settings", "데스크톱 설정"),
    settingsDescription: pick(
      locale,
      "Most users only need the local storage folder. The shared server address and secret keys stay on kera-bay.vercel.app.",
      "대부분의 사용자는 로컬 저장소 폴더만 보면 됩니다. 공용 서버 주소와 비밀 키는 kera-bay.vercel.app에서 관리합니다.",
    ),
    storageTitle: pick(locale, "Storage", "저장소"),
    storageDescription: pick(
      locale,
      "Choose where this PC stores images, SQLite data, models, and logs. The CPU desktop build uses about 2.3 GB total after first launch, including the bundled runtime under AppData. Leave it blank to keep using the current default location.",
      "이 PC가 이미지, SQLite 데이터, 모델, 로그를 저장할 위치를 정합니다. CPU 데스크톱 배포본은 첫 실행 후 AppData 아래 번들 런타임까지 포함해 총 약 2.3 GB를 사용합니다. 비워 두면 현재 기본 위치를 계속 사용합니다.",
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
    diskNoticeTitle: pick(locale, "CPU desktop storage footprint", "CPU 데스크톱 저장 공간 안내"),
    diskNoticeBody: pick(
      locale,
      "This installed CPU build uses about {total} total disk after first launch. The app itself occupies about {install}, and first launch unpacks about {runtime} more under {runtimeDir}.",
      "설치된 CPU 배포본은 첫 실행 후 총 {total} 정도의 디스크를 사용합니다. 설치 직후 앱 자체가 약 {install}를 차지하고, 첫 실행 때 {runtimeDir} 아래로 약 {runtime}를 추가로 풉니다.",
    ),
    diskNoticeBlocking: pick(
      locale,
      "Only {free} is currently free on the runtime drive. Free at least {required} there before starting local services.",
      "현재 런타임 드라이브 여유 공간은 {free}뿐입니다. 로컬 서비스를 시작하기 전에 해당 드라이브에 최소 {required} 이상을 확보해야 합니다.",
    ),
    diskNoticeRuntimeLabel: pick(locale, "First launch runtime folder", "첫 실행 런타임 폴더"),
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

  function resetSession(nextError: string | null = null) {
    clearDesktopSession();
    void clearDesktopSessionCache();
    setToken(null);
    setUser(null);
    setSites([]);
    setSelectedSiteId(null);
    setSummary(null);
    setWorkspaceMode("canvas");
    setOperationsSection("management");
    setWorkspaceSettingsOpen(false);
    setAdminLoginOpen(false);
    setAdminForm({ username: "", password: "" });
    setError(nextError);
  }

  function isSessionAuthFailure(nextError: unknown): boolean {
    const detail = describeError(nextError, "").toLowerCase();
    return (
      detail.includes("invalid token") ||
      detail.includes("authentication required") ||
      detail.includes("missing bearer token") ||
      detail.includes("expired")
    );
  }

  async function loadDesktopRuntime(autoStart: boolean, options: { throwOnError?: boolean } = {}) {
    setRuntimeBusy(true);
    setRuntimeError(null);
    try {
      const nextConfig = await fetchDesktopAppConfig();
      setConfig(nextConfig);
      setConfigForm(nextConfig.values);
      if (nextConfig.runtime_contract.errors.length > 0) {
        setRuntimeError(describeError(nextConfig.runtime_contract.errors[0], copy.runtimeFailed));
      }
      if (autoStart && nextConfig.setup_ready) {
        await ensureDesktopLocalBackendReady();
        setRuntimeReadyCycle((current) => current + 1);
      }
    } catch (nextError) {
      const message = describeError(nextError, copy.runtimeFailed);
      setRuntimeError(message);
      if (options.throwOnError) {
        throw nextError instanceof Error ? nextError : new Error(message);
      }
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
      resetSession(describeError(nextError, copy.loginFailed));
    } finally {
      setBootstrapBusy(false);
    }
  }

  useEffect(() => {
    void loadDesktopSessionCache().then((cached) => {
      if (cached?.token && isTokenExpired(cached.token)) {
        resetSession(copy.sessionExpired);
        void loadDesktopRuntime(false);
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
        void loadDesktopRuntime(true).then(() => {
          void desktopFetchCurrentUser(cached.token)
            .then(async (nextUser) => {
              const nextSites =
                nextUser.approval_status === "approved" ? await desktopFetchApprovedSites(cached.token) : [];
              setUser(nextUser);
              setSites(nextSites);
              void saveDesktopSessionCache({ token: cached.token, user: nextUser, sites: nextSites });
            })
            .catch((nextError) => {
              if (isSessionAuthFailure(nextError)) {
                resetSession(copy.sessionExpired);
              }
            });
        });
        return;
      }

      const stored = window.localStorage.getItem(DESKTOP_TOKEN_KEY);
      if (stored) {
        if (isTokenExpired(stored)) {
          resetSession(copy.sessionExpired);
          void loadDesktopRuntime(false);
          return;
        }
        setToken(stored);
        void loadDesktopRuntime(true);
      } else {
        void loadDesktopRuntime(false);
      }
    });
  }, [copy.sessionExpired]);

  useEffect(() => {
    if (!token) {
      return;
    }
    if (isTokenExpired(token)) {
      resetSession(copy.sessionExpired);
      return;
    }
    const expiresAt = readTokenExpiresAt(token);
    if (!expiresAt) {
      return;
    }
    const timeout = window.setTimeout(() => {
      if (isTokenExpired(token)) {
        resetSession(copy.sessionExpired);
      }
    }, Math.max(expiresAt - Date.now() - 30_000, 0));
    return () => {
      window.clearTimeout(timeout);
    };
  }, [copy.sessionExpired, token]);

  useEffect(() => {
    if (!token || user) {
      return;
    }
    void bootstrapSession(token);
  }, [token, user]);

  useEffect(() => {
    if (!token || !user) {
      setControlPlaneStatus(null);
      setControlPlaneStatusBusy(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setControlPlaneStatusBusy(true);
    void probeDesktopControlPlaneStatus(controller.signal)
      .then((nextStatus) => {
        if (!cancelled) {
          setControlPlaneStatus(nextStatus);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setControlPlaneStatusBusy(false);
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [token, user, workspaceMode]);

  useEffect(() => {
    if (!token || !user || user.approval_status !== "approved" || workspaceMode !== "operations") {
      return;
    }
    void prewarmDesktopWorker().catch((nextError) => {
      console.warn("[kera-desktop-worker-prewarm]", nextError);
    });
  }, [token, user, workspaceMode]);

  useEffect(() => {
    if (!token || !selectedSiteId || !user || user.approval_status !== "approved") {
      setSummary(null);
      return;
    }
    if (runtimeBusy) {
      return;
    }
    const currentSiteId = selectedSiteId;
    const currentToken = token;
    let cancelled = false;

    async function loadSiteSummary() {
      try {
        const nextCounts = await fetchSiteSummaryCounts(currentSiteId, currentToken);
        if (!cancelled) {
          setSummary((current) => mergeSiteSummaryCounts(current, nextCounts));
        }
      } catch {
        // Counts are an optimization; fall back to the full summary request.
      }

      try {
        const nextSummary = await fetchSiteSummary(currentSiteId, currentToken);
        if (!cancelled) {
          setSummary(nextSummary);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(describeError(nextError, copy.loginFailed));
        }
      }
    }

    void loadSiteSummary();
    return () => {
      cancelled = true;
    };
  }, [selectedSiteId, token, user, locale, runtimeBusy, runtimeReadyCycle]);

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
      setError(describeDesktopGoogleLoginError(locale, nextError, copy.loginFailed));
    } finally {
      setAuthBusy(false);
    }
  }

  function closeAdminLogin() {
    setAdminLoginOpen(false);
    setError(null);
    setAdminForm({ username: "", password: "" });
  }

  async function handleAdminLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthBusy(true);
    setError(null);
    try {
      await stopDesktopLocalRuntime().catch(() => null);
      await loadDesktopRuntime(true, { throwOnError: true });
      const auth = await desktopLocalLogin(adminForm.username.trim(), adminForm.password);
      persistDesktopSession(auth.access_token);
      setToken(auth.access_token);
      setAdminLoginOpen(false);
      setAdminForm({ username: "", password: "" });
    } catch (nextError) {
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
    try {
      const nextCounts = await fetchSiteSummaryCounts(siteId, token);
      startTransition(() => {
        setSummary((current) => mergeSiteSummaryCounts(current, nextCounts));
      });
    } catch {
      // Explicit refresh still falls back to the full summary if the quick path is unavailable.
    }
    const nextSummary = await fetchSiteSummary(siteId, token);
    startTransition(() => {
      setSummary(nextSummary);
    });
  }

  async function refreshApprovedSites(currentToken: string) {
    const nextSites = await desktopFetchApprovedSites(currentToken);
    setSites(nextSites);
    setSelectedSiteId((current) =>
      current && nextSites.some((item) => item.site_id === current) ? current : (nextSites[0]?.site_id ?? null),
    );
    if (user) {
      void saveDesktopSessionCache({ token: currentToken, user, sites: nextSites });
    }
  }

  function handleLogout() {
    resetSession(null);
  }

  const screenError = error ?? runtimeError;
  const approvedWorkspaceSession = token && user && user.approval_status === "approved";
  const canOpenOperations = Boolean(approvedWorkspaceSession && user && ["admin", "site_admin"].includes(user.role));

  if (approvedWorkspaceSession && workspaceMode === "operations" && canOpenOperations && !workspaceSettingsOpen) {
    return (
      <AdminWorkspace
        token={token}
        user={user}
        sites={sites}
        sitesBusy={bootstrapBusy && sites.length === 0}
        selectedSiteId={selectedSiteId}
        summary={summary}
        initialSection={operationsSection}
        controlPlaneStatus={controlPlaneStatus}
        controlPlaneStatusBusy={controlPlaneStatusBusy}
        onSelectSite={setSelectedSiteId}
        onOpenCanvas={() => setWorkspaceMode("canvas")}
        onLogout={handleLogout}
        onRefreshSites={async () => {
          await refreshApprovedSites(token);
        }}
        onSiteDataChanged={handleRefreshSite}
        theme={resolvedTheme}
        onToggleTheme={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      />
    );
  }

  if (approvedWorkspaceSession && !workspaceSettingsOpen) {
    return (
      <CaseWorkspace
        token={token}
        user={user}
        sites={sites}
        selectedSiteId={selectedSiteId}
        summary={summary}
        canOpenOperations={canOpenOperations}
        theme={resolvedTheme}
        controlPlaneStatus={controlPlaneStatus}
        controlPlaneStatusBusy={controlPlaneStatusBusy}
        onSelectSite={setSelectedSiteId}
        onExportManifest={() => void handleExportManifest()}
        onLogout={handleLogout}
        onOpenOperations={(section) => {
          setOperationsSection(section ?? "management");
          setWorkspaceMode("operations");
        }}
        onOpenDesktopSettings={() => setWorkspaceSettingsOpen(true)}
        onSiteDataChanged={handleRefreshSite}
        onToggleTheme={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      />
    );
  }

  if (approvedWorkspaceSession && workspaceSettingsOpen) {
    const runtimeContract = config?.runtime_contract ?? null;
    const storageValue = configForm.storage_dir || config?.values.storage_dir || "";
    const diskNotice = runtimeContract?.disk_notice ?? null;
    const settingsDiskBody = diskNotice
      ? copy.diskNoticeBody
          .replace("{total}", formatApproxGiB(diskNotice.estimated_total_after_first_launch_bytes))
          .replace("{install}", formatApproxGiB(diskNotice.estimated_install_footprint_bytes))
          .replace("{runtime}", formatApproxGiB(diskNotice.estimated_first_launch_runtime_bytes))
          .replace("{runtimeDir}", runtimeContract?.runtime_dir || "the desktop runtime folder")
      : null;
    const settingsDiskBlocking =
      diskNotice?.runtime_space_ok === false && diskNotice.runtime_drive_free_bytes != null
        ? copy.diskNoticeBlocking
            .replace("{free}", formatApproxGiB(diskNotice.runtime_drive_free_bytes))
            .replace("{required}", formatApproxGiB(diskNotice.recommended_runtime_free_bytes))
        : null;

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
              {diskNotice ? (
                <div
                  className={`rounded-[18px] border px-4 py-3 ${
                    settingsDiskBlocking
                      ? "border-danger/25 bg-danger/8 text-danger"
                      : "border-[rgba(224,183,88,0.28)] bg-[rgba(255,248,220,0.96)] text-[#5f4f17]"
                  }`}
                >
                  <div className="grid gap-2 text-sm leading-6">
                    <strong className="font-semibold">{copy.diskNoticeTitle}</strong>
                    {settingsDiskBody ? <p className="m-0">{settingsDiskBody}</p> : null}
                    {runtimeContract?.runtime_dir ? (
                      <p className="m-0">
                        {copy.diskNoticeRuntimeLabel}: <code className="font-mono">{runtimeContract.runtime_dir}</code>
                      </p>
                    ) : null}
                    {settingsDiskBlocking ? <p className="m-0 font-medium">{settingsDiskBlocking}</p> : null}
                  </div>
                </div>
              ) : null}
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

  if (!token && adminLoginOpen) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(48,88,255,0.14),transparent_36%),linear-gradient(180deg,var(--surface-muted),var(--surface))] px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto flex w-full max-w-6xl justify-end">
          <LocaleToggle />
        </div>

        <section className="mx-auto mt-6 grid w-full max-w-6xl gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
          <Card as="article" variant="surface" className="flex min-h-[540px] flex-col justify-between gap-8 p-6 sm:p-8">
            <SectionHeader
              eyebrow={
                <span className="inline-flex min-h-8 items-center rounded-full border border-border bg-surface-muted/80 px-3 text-[0.76rem] font-semibold uppercase tracking-[0.14em] text-muted">
                  {copy.adminLoginEyebrow}
                </span>
              }
              title={copy.adminLoginPanelTitle}
              description={copy.adminLoginDescription}
            />

            <div className="grid gap-4">
              <Card as="div" variant="nested" className="grid gap-3 p-5">
                <strong className="text-sm font-semibold text-ink">{copy.adminSafetyTitle}</strong>
                <p className="m-0 text-sm leading-6 text-muted">{copy.adminSafetyBody}</p>
                <p className="m-0 text-sm leading-6 text-muted">{copy.adminSafetyFootnote}</p>
              </Card>
            </div>
          </Card>

          <Card as="section" variant="panel" className="grid gap-6 p-6 sm:p-8">
            <SectionHeader
              title={copy.adminLoginTitle}
              description={copy.adminLoginDescription}
              eyebrow={
                <span className="inline-flex min-h-8 items-center rounded-full border border-border bg-surface-muted/80 px-3 text-[0.76rem] font-semibold uppercase tracking-[0.14em] text-muted">
                  {copy.adminLoginEyebrow}
                </span>
              }
            />

            <form className="grid gap-4" onSubmit={handleAdminLogin}>
              <Field as="div" label={copy.adminUsername} htmlFor="admin-username">
                <input
                  id="admin-username"
                  autoComplete="username"
                  disabled={authBusy}
                  value={adminForm.username}
                  onChange={(e) => setAdminForm((f) => ({ ...f, username: e.target.value }))}
                />
              </Field>

              <Field as="div" label={copy.adminPassword} htmlFor="admin-password">
                <input
                  id="admin-password"
                  type="password"
                  autoComplete="current-password"
                  disabled={authBusy}
                  value={adminForm.password}
                  onChange={(e) => setAdminForm((f) => ({ ...f, password: e.target.value }))}
                />
              </Field>

              {screenError ? (
                <div className="rounded-[18px] border border-danger/25 bg-danger/8 px-4 py-3 text-sm text-danger">{screenError}</div>
              ) : null}

              <Button type="submit" variant="primary" className="w-full" disabled={authBusy || !adminForm.username || !adminForm.password}>
                {authBusy ? copy.adminSubmitting : copy.adminSubmit}
              </Button>
            </form>

            <div className="grid gap-3">
              <div className="text-[0.76rem] font-semibold uppercase tracking-[0.14em] text-muted">{copy.researchUserSignIn}</div>
              <Button type="button" variant="ghost" className="w-full rounded-full" disabled={authBusy} onClick={closeAdminLogin}>
                {copy.adminBackToMain}
              </Button>
            </div>
          </Card>
        </section>
      </main>
    );
  }

  if (!token) {
    return (
      <DesktopLandingScreen
        authBusy={authBusy}
        error={screenError}
        config={config}
        onGoogleLaunch={() => void handleGoogleLogin()}
        onAdminLaunch={() => setAdminLoginOpen(true)}
      />
    );
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
