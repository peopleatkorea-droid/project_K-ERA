import { startTransition, useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";

import { CaseWorkspace } from "../components/case-workspace";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Field } from "../components/ui/field";
import { SectionHeader } from "../components/ui/section-header";
import { DesktopLandingScreen } from "./desktop-landing";
import { downloadManifest, fetchSiteSummary, type AuthUser, type SiteRecord, type SiteSummary } from "../lib/api";
import { prewarmPatientListPage } from "../lib/cases";
import { clearDesktopSession, clearDesktopSessionCache, DESKTOP_TOKEN_KEY, desktopFetchApprovedSites, desktopFetchCurrentUser, desktopLocalDevLogin, desktopLocalLogin, exchangeDesktopGoogleLogin, loadDesktopSessionCache, persistDesktopSession, saveDesktopSessionCache, startDesktopGoogleLogin } from "../lib/desktop-auth";
import {
  clearDesktopAppConfig,
  fetchDesktopAppConfig,
  openDesktopPath,
  pickDesktopDirectory,
  saveDesktopAppConfig,
  type DesktopAppConfigState,
  type DesktopAppConfigValues,
} from "../lib/desktop-app-config";
import {
  ensureDesktopLocalRuntimeReady,
  fetchDesktopDiagnosticsSnapshot,
  fetchDesktopRuntimeSnapshot,
  stopDesktopLocalRuntime,
  type DesktopDiagnosticsSnapshot,
} from "../lib/desktop-diagnostics";
import { authenticateWithDesktopGoogle, canUseDesktopGoogleAuth } from "../lib/desktop-google-auth";
import { describeDesktopOnboarding, type DesktopOnboardingStepId } from "../lib/desktop-onboarding";
import { LocaleProvider, LocaleToggle, pick, translateApiError, useI18n } from "../lib/i18n";
import { ThemeProvider, useTheme } from "../lib/theme";

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

type RuntimeServiceSummary = {
  id: "backend" | "worker" | "ml";
  label: string;
  value: string;
  tone: "ready" | "attention" | "neutral";
};

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

  const copy = {
    title: pick(locale, "K-ERA Desktop Workspace", "K-ERA 데스크톱 워크스페이스"),
    subtitle: pick(
      locale,
      "Set up the local data folder, hospital connection, and sign-in for this PC.",
      "이 PC에서 사용할 데이터 폴더, 병원 연결 정보, 로그인만 설정하면 됩니다."
    ),
    openSettings: pick(locale, "Setup", "설정"),
    closeSettings: pick(locale, "Hide setup", "설정 닫기"),
    startRuntime: pick(locale, "Start app services", "앱 서비스 시작"),
    startingRuntime: pick(locale, "Starting app services...", "앱 서비스 시작 중..."),
    refreshingRuntime: pick(locale, "Refreshing status...", "상태 새로고침 중..."),
    stopRuntime: pick(locale, "Stop app services", "앱 서비스 중지"),
    stoppingRuntime: pick(locale, "Stopping app services...", "앱 서비스 중지 중..."),
    refreshRuntime: pick(locale, "Refresh status", "상태 새로고침"),
    saveSettings: pick(locale, "Save and continue", "저장하고 계속"),
    savingSettings: pick(locale, "Saving...", "저장 중..."),
    resetSettings: pick(locale, "Reset setup", "설정 초기화"),
    username: pick(locale, "Username", "아이디"),
    password: pick(locale, "Password", "비밀번호"),
    googleSignIn: pick(locale, "Sign in with Google", "Google로 로그인"),
    signIn: pick(locale, "Sign in and open workspace", "로그인하고 워크스페이스 열기"),
    signingIn: pick(locale, "Signing in...", "로그인 중..."),
    devSignIn: pick(locale, "Dev admin login", "개발용 관리자 로그인"),
    loginFailed: pick(locale, "Login failed.", "로그인에 실패했습니다."),
    runtimeFailed: pick(locale, "The desktop app could not start its local services.", "데스크톱 앱의 로컬 서비스를 시작하지 못했습니다."),
    storageDir: pick(locale, "Data folder", "데이터 폴더"),
    storageDirHint: pick(
      locale,
      "Choose where this PC should store SQLite, images, models, and logs.",
      "이 PC의 SQLite, 이미지, 모델, 로그를 저장할 폴더를 선택하세요."
    ),
    browseStorageDir: pick(locale, "Browse", "찾아보기"),
    browseStorageDirTitle: pick(locale, "Choose data folder", "데이터 폴더 선택"),
    controlPlaneUrl: pick(locale, "Hospital server URL", "병원 서버 주소"),
    controlPlaneUrlHint: pick(
      locale,
      "Enter the server address provided for this hospital or site.",
      "이 병원 또는 사이트에 대해 받은 서버 주소를 입력하세요."
    ),
    nodeId: pick(locale, "This PC ID", "이 PC ID"),
    nodeIdHint: pick(
      locale,
      "Use the PC ID provided during setup. It identifies this desktop in the hospital network.",
      "초기 설정 때 받은 PC ID를 입력하세요. 병원 네트워크에서 이 데스크톱을 구분하는 값입니다."
    ),
    nodeToken: pick(locale, "Connection key", "연결 키"),
    nodeTokenHint: pick(
      locale,
      "Use the connection key provided for this PC.",
      "이 PC에 대해 받은 연결 키를 입력하세요."
    ),
    siteId: pick(locale, "Default hospital code", "기본 병원 코드"),
    siteIdHint: pick(
      locale,
      "Enter the hospital code that should open by default after sign-in.",
      "로그인 후 기본으로 열 병원 코드를 입력하세요."
    ),
    pythonPath: pick(locale, "Python path override", "Python 경로 직접 지정"),
    pythonPathHint: pick(
      locale,
      "Leave this empty unless support asked you to change it.",
      "지원 담당자가 요청한 경우가 아니면 비워 두세요."
    ),
    managedBackend: pick(locale, "App-managed service", "앱이 직접 시작"),
    externalBackend: pick(locale, "Use an external service", "외부 서비스 사용"),
    sidecarTransport: pick(locale, "Built-in AI service", "내장 AI 서비스"),
    httpTransport: pick(locale, "External AI service", "외부 AI 서비스"),
    sessionBusy: pick(locale, "Opening saved session...", "저장된 세션을 여는 중..."),
    sessionBlocked: pick(
      locale,
      "This desktop app opens only approved local workspace accounts. Use the web admin app for access requests and central operations.",
      "이 데스크톱 앱은 승인된 로컬 워크스페이스 계정만 엽니다. 접근 요청과 중앙 운영은 웹 관리자 앱에서 진행하세요."
    ),
    signOut: pick(locale, "Sign out", "로그아웃"),
    runtimeStatus: pick(locale, "App status", "앱 상태"),
    appStatusDescription: pick(
      locale,
      "You only need the basic setup below. Technical details stay hidden unless you open them.",
      "아래 기본 설정만 입력하면 됩니다. 기술 정보는 필요할 때만 열어보세요."
    ),
    configPath: pick(locale, "Config file", "설정 파일"),
    backendUrl: pick(locale, "App server", "앱 서버"),
    backendHealthy: pick(locale, "App server status", "앱 서버 상태"),
    workerRunning: pick(locale, "Background jobs", "백그라운드 작업"),
    runtimeNotReady: pick(
      locale,
      "Finish the basic setup first, then start the app services.",
      "먼저 기본 설정을 마친 뒤 앱 서비스를 시작하세요."
    ),
    runtimeMode: pick(locale, "Install mode", "설치 모드"),
    backendSource: pick(locale, "App files", "앱 파일 위치"),
    envSource: pick(locale, "Settings source", "설정 읽기 위치"),
    resourceDir: pick(locale, "Bundled app files", "번들 앱 파일"),
    runtimeDir: pick(locale, "Runtime directory", "실행 폴더"),
    logsDir: pick(locale, "Logs directory", "로그 디렉터리"),
    runtimeErrors: pick(locale, "Runtime errors", "런타임 오류"),
    runtimeWarnings: pick(locale, "Runtime warnings", "런타임 경고"),
    runtimeLookupDetails: pick(locale, "Technical details", "기술 정보"),
    backendCandidates: pick(locale, "App file search paths", "앱 파일 탐색 경로"),
    pythonCandidates: pick(locale, "Python search paths", "Python 탐색 경로"),
    openConfigFile: pick(locale, "Open config", "설정 열기"),
    openAppData: pick(locale, "Open app data", "앱 데이터 열기"),
    openRuntimeLogs: pick(locale, "Open logs", "로그 열기"),
    openResources: pick(locale, "Open resources", "리소스 열기"),
    openStorage: pick(locale, "Open storage", "저장소 열기"),
    runtimeReady: pick(locale, "Installation check", "설치 점검"),
    setupChecklistTitle: pick(locale, "First-time setup", "처음 실행 설정"),
    setupChecklistDescription: pick(
      locale,
      "Most users only need three things: a data folder, the hospital connection, and a login.",
      "대부분의 사용자는 데이터 폴더, 병원 연결 정보, 로그인만 준비하면 됩니다."
    ),
    guidedSetupTitle: pick(locale, "Guided setup", "안내 설정"),
    guidedSetupDescription: pick(
      locale,
      "Follow the steps below once for this PC, then you can sign in normally.",
      "이 PC에서 아래 단계를 한 번만 완료하면 이후에는 바로 로그인해서 사용할 수 있습니다."
    ),
    setupProgress: pick(locale, "Setup progress", "설정 진행도"),
    nextAction: pick(locale, "Next action", "다음 작업"),
    openSettingsAction: pick(locale, "Open setup form", "설정 입력 열기"),
    signInStepReady: pick(locale, "Setup is complete. Use the sign-in form below.", "설정이 끝났습니다. 아래 로그인으로 진행하세요."),
    runtimeServicesTitle: pick(locale, "App services", "앱 서비스"),
    backendService: pick(locale, "App server", "앱 서버"),
    workerService: pick(locale, "Background worker", "백그라운드 작업"),
    mlService: pick(locale, "AI service", "AI 서비스"),
    readyState: pick(locale, "Ready", "준비됨"),
    attentionState: pick(locale, "Needs attention", "확인 필요"),
    optionalState: pick(locale, "Not required", "필수 아님"),
    currentStepState: pick(locale, "Current", "현재 단계"),
    pendingStepState: pick(locale, "Pending", "대기"),
    doneStepState: pick(locale, "Done", "완료"),
    requiredSettingsTitle: pick(locale, "1. Basic setup", "1. 기본 설정"),
    advancedSettingsTitle: pick(locale, "Advanced options", "고급 옵션"),
    advancedSettingsToggle: pick(locale, "Open advanced options", "고급 옵션 열기"),
    supportPathsTitle: pick(locale, "Troubleshooting", "문제 해결"),
    troubleshootingToggle: pick(locale, "Open troubleshooting tools", "문제 해결 도구 열기"),
    supportPathsDescription: pick(
      locale,
      "Use these only when something is broken or support asks for them.",
      "앱에 문제가 있거나 지원 담당자가 요청할 때만 사용하세요."
    ),
    requiredSettingsDescription: pick(
      locale,
      "Most users only need these fields.",
      "대부분의 사용자는 아래 항목만 입력하면 됩니다."
    ),
    advancedSettingsDescription: pick(
      locale,
      "Leave these alone unless support asked you to change them.",
      "지원 담당자가 요청한 경우가 아니라면 그대로 두세요."
    ),
    loginSectionTitle: pick(locale, "2. Sign in", "2. 로그인"),
    loginSectionDescription: pick(
      locale,
      "Researchers sign in with Google. Admin and site admin accounts can still use passwords after setup is complete.",
      "설정이 끝나면 승인된 로컬 워크스페이스 계정으로 로그인하세요."
    ),
    setupStepOne: pick(locale, "Choose a data folder.", "데이터 폴더를 선택합니다."),
    setupStepTwo: pick(locale, "Enter the hospital connection details.", "병원 연결 정보를 입력합니다."),
    setupStepThree: pick(locale, "Start the app services and check that they are ready.", "앱 서비스를 시작하고 준비 상태를 확인합니다."),
  };
  const desktopGoogleAuthEnabled = canUseDesktopGoogleAuth();

  function onboardingStepContent(stepId: DesktopOnboardingStepId) {
    switch (stepId) {
      case "storage":
        return {
          title: pick(locale, "Choose a data folder", "데이터 폴더 선택"),
          description: pick(
            locale,
            "Choose where this PC should store SQLite, images, models, and logs.",
            "이 PC의 SQLite, 이미지, 모델, 로그를 저장할 위치를 정합니다.",
          ),
        };
      case "controlPlane":
        return {
          title: pick(locale, "Enter the hospital connection", "병원 연결 정보 입력"),
          description: pick(
            locale,
            "Enter the hospital server URL, this PC ID, and the connection key.",
            "병원 서버 주소, 이 PC ID, 연결 키를 입력합니다.",
          ),
        };
      case "site":
        return {
          title: pick(locale, "Choose the default hospital", "기본 병원 선택"),
          description: pick(
            locale,
            "Set the hospital code that should open by default after sign-in.",
            "로그인 후 기본으로 열 병원 코드를 지정합니다.",
          ),
        };
      case "runtimeContract":
        return {
          title: pick(locale, "Check the installation", "설치 점검"),
          description: pick(
            locale,
            "The app checks that its bundled files are available before startup.",
            "앱이 시작되기 전에 필요한 번들 파일이 준비되어 있는지 확인합니다.",
          ),
        };
      case "runtimeServices":
        return {
          title: pick(locale, "Start app services", "앱 서비스 시작"),
          description: pick(
            locale,
            "Start the local app services and verify they are ready.",
            "로컬 앱 서비스를 시작하고 준비 상태를 확인합니다.",
          ),
        };
      case "signIn":
      default:
        return {
          title: pick(locale, "Sign in", "로그인"),
          description: pick(
            locale,
            "The app is ready. Continue with your approved local workspace account.",
            "앱 준비가 끝났습니다. 승인된 로컬 워크스페이스 계정으로 진행합니다.",
          ),
        };
    }
  }

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
      setRuntimeError(describeError(nextError, copy.runtimeFailed));
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
      setRuntimeError(describeError(nextError, copy.runtimeFailed));
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
      setError(describeError(nextError, copy.loginFailed));
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
      setError(describeError(nextError, copy.loginFailed));
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
      setError(describeError(nextError, copy.loginFailed));
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
      const nextConfig = await saveDesktopAppConfig({ config: configForm });
      setConfig(nextConfig);
      setConfigForm(nextConfig.values);
      setSettingsOpen(false);
      await loadConfigAndRuntime({ autoStart: true, diagnosticsMode: "runtime" });
    } catch (nextError) {
      setError(describeError(nextError, copy.runtimeFailed));
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
      setError(describeError(nextError, copy.runtimeFailed));
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
      setError(describeError(nextError, copy.runtimeFailed));
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
  const runtimeSummary = diagnostics?.localBackend;
  const runtimeContract = config?.runtime_contract ?? null;
  const storagePath = config?.values.storage_dir || configForm.storage_dir;
  const onboarding = describeDesktopOnboarding(config, diagnostics);
  const onboardingCurrentStep = onboardingStepContent(onboarding.currentStepId);
  const showOnboarding = !token || !onboarding.canOpenWorkspace;
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
            {pick(locale, "Desktop runtime", "데스크톱 런타임")}
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
          <SectionHeader title={copy.runtimeStatus} description={copy.appStatusDescription} />

          {runtimeError ? (
            <div className="rounded-[18px] border border-danger/25 bg-danger/8 px-4 py-3 text-sm text-danger">{runtimeError}</div>
          ) : null}
          {error ? (
            <div className="rounded-[18px] border border-danger/25 bg-danger/8 px-4 py-3 text-sm text-danger">{error}</div>
          ) : null}

          {showOnboarding ? (
            <div className="grid gap-4 rounded-[22px] border border-brand/20 bg-brand/6 p-4 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="grid gap-1">
                  <div className="font-semibold text-ink">{copy.guidedSetupTitle}</div>
                  <p className="m-0 text-muted">
                    {onboarding.firstRun ? copy.setupChecklistDescription : copy.guidedSetupDescription}
                  </p>
                </div>
                <div className="rounded-full border border-brand/20 bg-white/70 px-3 py-1 text-[0.76rem] font-semibold text-ink">
                  {copy.setupProgress} {onboarding.completed}/{onboarding.total}
                </div>
              </div>

              <div className="h-2 overflow-hidden rounded-full bg-white/70">
                <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${onboarding.percent}%` }} />
              </div>

              <div className="grid gap-2">
                {onboarding.steps.map((step, index) => {
                  const stepCopy = onboardingStepContent(step.id);
                  const toneClass =
                    step.status === "done"
                      ? "border-emerald-500/20 bg-emerald-500/8"
                      : step.status === "current"
                        ? "border-brand/20 bg-white/80"
                        : "border-border bg-white/55";
                  const statusLabel =
                    step.status === "done"
                      ? copy.doneStepState
                      : step.status === "current"
                        ? copy.currentStepState
                        : copy.pendingStepState;
                  return (
                    <div key={step.id} className={`grid gap-1 rounded-[18px] border px-4 py-3 ${toneClass}`}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-semibold text-ink">
                          {index + 1}. {stepCopy.title}
                        </div>
                        <div className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-muted">{statusLabel}</div>
                      </div>
                      <div className="text-muted">{stepCopy.description}</div>
                    </div>
                  );
                })}
              </div>

              <div className="grid gap-3 rounded-[18px] border border-border bg-white/65 p-4">
                <div className="font-semibold text-ink">{copy.runtimeServicesTitle}</div>
                <div className="grid gap-3 sm:grid-cols-3">
                  {runtimeServiceSummaries.map((item) => (
                    <div key={item.id} className="rounded-[16px] border border-border/80 bg-surface px-3 py-2">
                      <div className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-muted">{item.label}</div>
                      <div
                        className={
                          item.tone === "ready"
                            ? "text-sm font-semibold text-emerald-600"
                            : item.tone === "attention"
                              ? "text-sm font-semibold text-amber-600"
                              : "text-sm font-semibold text-muted"
                        }
                      >
                        {item.value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-1 rounded-[18px] border border-border bg-white/65 px-4 py-3">
                <div className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-muted">{copy.nextAction}</div>
                <div className="font-semibold text-ink">{onboardingCurrentStep.title}</div>
                <div className="text-muted">
                  {onboarding.currentStepId === "signIn" ? copy.signInStepReady : onboardingCurrentStep.description}
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                {onboarding.needsSettings ? (
                  <Button type="button" variant="primary" onClick={() => setSettingsOpen(true)}>
                    {copy.openSettingsAction}
                  </Button>
                ) : onboarding.currentStepId === "runtimeServices" ? (
                  <Button type="button" variant="primary" disabled={runtimeBusy || !onboarding.canStartRuntime} onClick={() => void handleStartRuntime()}>
                    {runtimeAction === "start" ? copy.startingRuntime : copy.startRuntime}
                  </Button>
                ) : null}
                <Button type="button" variant="ghost" disabled={runtimeBusy} onClick={() => void handleRefreshRuntime()}>
                  {runtimeAction === "refresh" ? copy.refreshingRuntime : copy.refreshRuntime}
                </Button>
                <Button type="button" variant="ghost" disabled={runtimeBusy} onClick={() => void handleStopRuntime()}>
                  {runtimeAction === "stop" ? copy.stoppingRuntime : copy.stopRuntime}
                </Button>
              </div>
            </div>
          ) : null}

          <div className="grid gap-3 rounded-[22px] border border-border bg-surface-muted/70 p-4 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted">{copy.backendUrl}</span>
              <strong className="text-ink">{runtimeSummary?.base_url ?? "http://127.0.0.1:8000"}</strong>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted">{copy.backendHealthy}</span>
              <strong className={backendHealthy ? "text-emerald-600" : "text-amber-600"}>
                {backendHealthy ? pick(locale, "Ready", "준비됨") : pick(locale, "Not ready", "미준비")}
              </strong>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted">{copy.workerRunning}</span>
              <strong className={workerRunning ? "text-emerald-600" : "text-amber-600"}>
                {workerRunning ? pick(locale, "Running", "실행 중") : pick(locale, "Stopped", "중지됨")}
              </strong>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button type="button" variant="ghost" size="sm" disabled={runtimeBusy} onClick={() => void handleRefreshRuntime()}>
                {runtimeAction === "refresh" ? copy.refreshingRuntime : copy.refreshRuntime}
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={runtimeBusy || !config?.setup_ready} onClick={() => void handleStartRuntime()}>
                {runtimeAction === "start" ? copy.startingRuntime : copy.startRuntime}
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={runtimeBusy} onClick={() => void handleStopRuntime()}>
                {runtimeAction === "stop" ? copy.stoppingRuntime : copy.stopRuntime}
              </Button>
            </div>
            {runtimeContract ? (
              <details className="rounded-[18px] border border-border bg-white/65 p-4">
                <summary className="cursor-pointer font-semibold text-ink">{copy.runtimeLookupDetails}</summary>
                <div className="mt-4 grid gap-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted">{copy.runtimeMode}</span>
                    <strong className="text-ink">
                      {runtimeContract.packaged_mode ? pick(locale, "Packaged", "설치형") : pick(locale, "Dev", "개발")}
                    </strong>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted">{copy.backendSource}</span>
                    <strong className="text-ink">{runtimeContract.backend_source}</strong>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted">{copy.envSource}</span>
                    <strong className="text-ink">{runtimeContract.env_source}</strong>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted">{copy.runtimeReady}</span>
                    <strong className={runtimeContract.errors.length ? "text-amber-600" : "text-emerald-600"}>
                      {runtimeContract.errors.length ? pick(locale, "Blocked", "차단됨") : pick(locale, "Ready", "준비됨")}
                    </strong>
                  </div>
                  {config?.config_path ? (
                    <div className="grid gap-1">
                      <span className="text-muted">{copy.configPath}</span>
                      <code className="overflow-x-auto whitespace-nowrap text-[0.82rem] text-ink">{config.config_path}</code>
                    </div>
                  ) : null}
                  {runtimeContract.resource_dir ? (
                    <div className="grid gap-1">
                      <span className="text-muted">{copy.resourceDir}</span>
                      <code className="overflow-x-auto whitespace-nowrap text-[0.82rem] text-ink">{runtimeContract.resource_dir}</code>
                    </div>
                  ) : null}
                  {runtimeContract.logs_dir ? (
                    <div className="grid gap-1">
                      <span className="text-muted">{copy.logsDir}</span>
                      <code className="overflow-x-auto whitespace-nowrap text-[0.82rem] text-ink">{runtimeContract.logs_dir}</code>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-3">
                    <Button type="button" variant="ghost" size="sm" disabled={!config?.config_path} onClick={() => void handleOpenPath(config?.config_path)}>
                      {copy.openConfigFile}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" disabled={!config?.app_local_data_dir} onClick={() => void handleOpenPath(config?.app_local_data_dir)}>
                      {copy.openAppData}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" disabled={!runtimeContract.logs_dir} onClick={() => void handleOpenPath(runtimeContract.logs_dir)}>
                      {copy.openRuntimeLogs}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" disabled={!runtimeContract.resource_dir} onClick={() => void handleOpenPath(runtimeContract.resource_dir)}>
                      {copy.openResources}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" disabled={!storagePath} onClick={() => void handleOpenPath(storagePath)}>
                      {copy.openStorage}
                    </Button>
                  </div>
                </div>
              </details>
            ) : null}
          </div>

          {settingsShouldBeVisible ? (
            <form className="grid gap-4" onSubmit={handleSaveSettings}>
              {runtimeContract?.errors.length ? (
                <div className="grid gap-2 rounded-[22px] border border-danger/25 bg-danger/8 p-4 text-sm">
                  <div className="font-semibold text-danger">{copy.runtimeErrors}</div>
                  <ul className="grid gap-1 pl-5 text-danger">
                    {runtimeContract.errors.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {runtimeContract?.warnings.length ? (
                <div className="grid gap-2 rounded-[22px] border border-amber-500/25 bg-amber-500/8 p-4 text-sm">
                  <div className="font-semibold text-amber-700 dark:text-amber-300">{copy.runtimeWarnings}</div>
                  <ul className="grid gap-1 pl-5 text-amber-700 dark:text-amber-300">
                    {runtimeContract.warnings.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="grid gap-4">
                <SectionHeader title={copy.requiredSettingsTitle} description={copy.requiredSettingsDescription} />

                <Field as="div" label={copy.storageDir} hint={copy.storageDirHint} htmlFor="desktop-storage-dir" unstyledControl>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <input
                      className="min-h-12 w-full rounded-[14px] border border-border/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(248,250,252,0.88))] px-3.5 py-2.5 text-sm text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_6px_16px_rgba(15,23,42,0.03)] outline-none transition duration-150 ease-out placeholder:text-muted focus:border-brand/25 focus:ring-4 focus:ring-[rgba(48,88,255,0.12)] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white/4"
                      id="desktop-storage-dir"
                      value={configForm.storage_dir}
                      onChange={(event) => setConfigForm((current) => ({ ...current, storage_dir: event.target.value }))}
                      placeholder="C:\\Users\\<user>\\AppData\\Local\\KERA\\KERA_DATA"
                    />
                    <Button type="button" variant="ghost" onClick={() => void handlePickStorageDir()}>
                      {copy.browseStorageDir}
                    </Button>
                  </div>
                </Field>

                <Field as="div" label={copy.controlPlaneUrl} hint={copy.controlPlaneUrlHint} htmlFor="desktop-control-plane-url">
                  <input
                    id="desktop-control-plane-url"
                    value={configForm.control_plane_api_base_url}
                    onChange={(event) =>
                      setConfigForm((current) => ({ ...current, control_plane_api_base_url: event.target.value }))
                    }
                    placeholder="https://example.org/control-plane/api"
                  />
                </Field>

                <Field as="div" label={copy.nodeId} hint={copy.nodeIdHint} htmlFor="desktop-node-id">
                  <input
                    id="desktop-node-id"
                    value={configForm.control_plane_node_id}
                    onChange={(event) => setConfigForm((current) => ({ ...current, control_plane_node_id: event.target.value }))}
                  />
                </Field>

                <Field as="div" label={copy.nodeToken} hint={copy.nodeTokenHint} htmlFor="desktop-node-token">
                  <input
                    id="desktop-node-token"
                    type="password"
                    value={configForm.control_plane_node_token}
                    onChange={(event) => setConfigForm((current) => ({ ...current, control_plane_node_token: event.target.value }))}
                  />
                </Field>

                <Field as="div" label={copy.siteId} hint={copy.siteIdHint} htmlFor="desktop-site-id">
                  <input
                    id="desktop-site-id"
                    value={configForm.control_plane_site_id}
                    onChange={(event) => setConfigForm((current) => ({ ...current, control_plane_site_id: event.target.value }))}
                  />
                </Field>
              </div>

              <details className="rounded-[22px] border border-border bg-surface-muted/50 p-4 text-sm">
                <summary className="cursor-pointer font-semibold text-ink">{copy.advancedSettingsToggle}</summary>
                <div className="mt-4 grid gap-4">
                  <SectionHeader title={copy.advancedSettingsTitle} description={copy.advancedSettingsDescription} />

                  <Field as="div" label={copy.pythonPath} hint={copy.pythonPathHint} htmlFor="desktop-python-path">
                    <input
                      id="desktop-python-path"
                      value={configForm.local_backend_python}
                      onChange={(event) => setConfigForm((current) => ({ ...current, local_backend_python: event.target.value }))}
                      placeholder="C:\\KERA\\runtime\\python\\python.exe"
                    />
                  </Field>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field as="div" label={pick(locale, "App service mode", "앱 서비스 모드")} htmlFor="desktop-backend-mode">
                      <select
                        id="desktop-backend-mode"
                        value={configForm.local_backend_mode}
                        onChange={(event) =>
                          setConfigForm((current) => ({
                            ...current,
                            local_backend_mode: event.target.value === "external" ? "external" : "managed",
                          }))
                        }
                      >
                        <option value="managed">{copy.managedBackend}</option>
                        <option value="external">{copy.externalBackend}</option>
                      </select>
                    </Field>

                    <Field as="div" label={pick(locale, "AI service mode", "AI 서비스 모드")} htmlFor="desktop-ml-transport">
                      <select
                        id="desktop-ml-transport"
                        value={configForm.ml_transport}
                        onChange={(event) =>
                          setConfigForm((current) => ({
                            ...current,
                            ml_transport: event.target.value === "http" ? "http" : "sidecar",
                          }))
                        }
                      >
                        <option value="sidecar">{copy.sidecarTransport}</option>
                        <option value="http">{copy.httpTransport}</option>
                      </select>
                    </Field>
                  </div>
                </div>
              </details>

              <details className="rounded-[22px] border border-border bg-surface-muted/50 p-4 text-sm">
                <summary className="cursor-pointer font-semibold text-ink">{copy.troubleshootingToggle}</summary>
                <div className="mt-4 grid gap-4">
                  <SectionHeader title={copy.supportPathsTitle} description={copy.supportPathsDescription} />
                  <div className="grid gap-1">
                    <span className="text-muted">{copy.runtimeDir}</span>
                    <code className="overflow-x-auto whitespace-nowrap text-[0.82rem] text-ink">
                      {runtimeContract?.runtime_dir || config?.app_local_data_dir || ""}
                    </code>
                  </div>
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
                    <Button type="button" variant="ghost" size="sm" disabled={!storagePath} onClick={() => void handleOpenPath(storagePath)}>
                      {copy.openStorage}
                    </Button>
                  </div>
                  {runtimeContract ? (
                    <div className="grid gap-4">
                      <div className="grid gap-2">
                        <span className="text-muted">{copy.backendCandidates}</span>
                        {runtimeContract.backend_candidates.map((item) => (
                          <code key={item} className="overflow-x-auto whitespace-nowrap text-[0.8rem] text-ink">
                            {item}
                          </code>
                        ))}
                      </div>
                      <div className="grid gap-2">
                        <span className="text-muted">{copy.pythonCandidates}</span>
                        {runtimeContract.python_candidates.length ? (
                          runtimeContract.python_candidates.map((item) => (
                            <code key={item} className="overflow-x-auto whitespace-nowrap text-[0.8rem] text-ink">
                              {item}
                            </code>
                          ))
                        ) : (
                          <span className="text-muted">{pick(locale, "No Python candidates resolved.", "파이썬 후보가 없습니다.")}</span>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              </details>

              <div className="flex flex-wrap gap-3">
                <Button type="submit" variant="primary" disabled={configBusy}>
                  {configBusy ? copy.savingSettings : copy.saveSettings}
                </Button>
                <Button type="button" variant="ghost" disabled={configBusy} onClick={() => void handleClearSettings()}>
                  {copy.resetSettings}
                </Button>
              </div>
            </form>
          ) : null}

          {!token || !user ? (
            <form className="grid gap-4" onSubmit={handleLocalLogin}>
              <SectionHeader
                title={copy.loginSectionTitle}
                description={copy.loginSectionDescription}
              />
              {desktopGoogleAuthEnabled ? (
                <Button type="button" variant="primary" disabled={authBusy || !backendHealthy} onClick={() => void handleGoogleLogin()}>
                  {authBusy ? copy.signingIn : copy.googleSignIn}
                </Button>
              ) : null}
              <Field as="div" label={copy.username} htmlFor="desktop-username">
                <input
                  id="desktop-username"
                  value={loginForm.username}
                  onChange={(event) => setLoginForm((current) => ({ ...current, username: event.target.value }))}
                />
              </Field>
              <Field as="div" label={copy.password} htmlFor="desktop-password">
                <input
                  id="desktop-password"
                  type="password"
                  value={loginForm.password}
                  onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
                />
              </Field>
              <div className="flex flex-wrap gap-3">
                <Button type="submit" variant={desktopGoogleAuthEnabled ? "ghost" : "primary"} disabled={authBusy || !backendHealthy}>
                  {authBusy ? copy.signingIn : copy.signIn}
                </Button>
                {process.env.NODE_ENV !== "production" ? (
                  <Button type="button" variant="ghost" disabled={authBusy || !backendHealthy} onClick={() => void handleDevLogin()}>
                    {copy.devSignIn}
                  </Button>
                ) : null}
              </div>
            </form>
          ) : null}
        </Card>

        <div className="min-h-[620px]">
          {token && (!user || bootstrapBusy) ? (
            <Card as="section" variant="surface" className="grid gap-4 p-6">
              <SectionHeader title={pick(locale, "Opening session", "세션 여는 중")} description={copy.sessionBusy} />
            </Card>
          ) : null}

          {token && user && user.approval_status !== "approved" ? (
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
