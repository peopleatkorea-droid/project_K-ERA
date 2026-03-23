"use client";

import { useEffect, useState, type FormEvent } from "react";

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
import { runDesktopSelfCheck, type DesktopSelfCheckSnapshot } from "../lib/desktop-self-check";
import { describeDesktopOnboarding } from "../lib/desktop-onboarding";
import { checkDesktopForUpdates, installDesktopUpdate, type DesktopUpdateCheckResult } from "../lib/desktop-updater";
import type { Locale } from "../lib/i18n";

import type { RuntimeServiceSummary } from "./runtime-status-panel";
import type { DesktopShellCopy } from "./shell-copy";
import {
  createEmptyDesktopConfigForm,
  describeDesktopShellError,
  formatTransferSize,
  normalizeDesktopConfigForm,
} from "./shell-helpers";

type ConfigFormState = DesktopAppConfigValues;
type RuntimeAction = "refresh" | "start" | "stop" | null;
type DiagnosticsMode = "runtime" | "full";

type UseDesktopRuntimeOptions = {
  locale: Locale;
  copy: DesktopShellCopy;
  setShellError: (message: string | null) => void;
};

export function useDesktopRuntime({ locale, copy, setShellError }: UseDesktopRuntimeOptions) {
  const [config, setConfig] = useState<DesktopAppConfigState | null>(null);
  const [configForm, setConfigForm] = useState<ConfigFormState>(() =>
    createEmptyDesktopConfigForm(process.env.NEXT_PUBLIC_KERA_CONTROL_PLANE_API_BASE_URL || ""),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [configBusy, setConfigBusy] = useState(false);
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [runtimeAction, setRuntimeAction] = useState<RuntimeAction>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
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

  function updateConfigForm(patch: Partial<ConfigFormState>) {
    setConfigForm((current) => ({ ...current, ...patch }));
  }

  async function loadConfigAndRuntime({
    autoStart,
    diagnosticsMode,
  }: {
    autoStart: boolean;
    diagnosticsMode: DiagnosticsMode;
  }) {
    setRuntimeBusy(true);
    setRuntimeAction(autoStart ? "start" : "refresh");
    setRuntimeError(null);
    try {
      const loadDiagnostics =
        diagnosticsMode === "full" ? fetchDesktopDiagnosticsSnapshot : fetchDesktopRuntimeSnapshot;
      const nextConfig = await fetchDesktopAppConfig();
      setConfig(nextConfig);
      setConfigForm(
        normalizeDesktopConfigForm(
          nextConfig.values,
          process.env.NEXT_PUBLIC_KERA_CONTROL_PLANE_API_BASE_URL || "",
        ),
      );
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

  async function warmDesktopRuntime() {
    await loadConfigAndRuntime({ autoStart: true, diagnosticsMode: "runtime" });
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
  }, [config, diagnostics, locale, copy.runtimeFailed]);

  useEffect(() => {
    void handleCheckUpdates({ silent: true });
  }, []);

  async function handleSaveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setConfigBusy(true);
    setShellError(null);
    try {
      const nextConfig = await saveDesktopAppConfig({ config: configForm });
      setConfig(nextConfig);
      setConfigForm(
        normalizeDesktopConfigForm(
          nextConfig.values,
          process.env.NEXT_PUBLIC_KERA_CONTROL_PLANE_API_BASE_URL || "",
        ),
      );
      setSettingsOpen(false);
      await loadConfigAndRuntime({ autoStart: true, diagnosticsMode: "runtime" });
    } catch (nextError) {
      setShellError(describeDesktopShellError(locale, nextError, copy.runtimeFailed));
    } finally {
      setConfigBusy(false);
    }
  }

  async function handleClearSettings() {
    setConfigBusy(true);
    setShellError(null);
    try {
      const nextConfig = await clearDesktopAppConfig();
      setConfig(nextConfig);
      setConfigForm(
        normalizeDesktopConfigForm(
          nextConfig.values,
          process.env.NEXT_PUBLIC_KERA_CONTROL_PLANE_API_BASE_URL || "",
        ),
      );
      await loadConfigAndRuntime({ autoStart: false, diagnosticsMode: "runtime" });
    } catch (nextError) {
      setShellError(describeDesktopShellError(locale, nextError, copy.runtimeFailed));
    } finally {
      setConfigBusy(false);
    }
  }

  async function handleOpenPath(path: string | null | undefined) {
    const normalized = typeof path === "string" ? path.trim() : "";
    if (!normalized) {
      return;
    }
    setShellError(null);
    try {
      await openDesktopPath(normalized);
    } catch (nextError) {
      setShellError(describeDesktopShellError(locale, nextError, copy.runtimeFailed));
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
    setShellError(null);
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
      setShellError(describeDesktopShellError(locale, nextError, copy.runtimeFailed));
    }
  }

  const settingsShouldBeVisible = settingsOpen;
  const backendHealthy = diagnostics?.localBackend?.healthy ?? false;
  const workerRunning = diagnostics?.localWorker?.running ?? false;
  const runtimeSummary = diagnostics?.localBackend ?? null;
  const runtimeContract = config?.runtime_contract ?? null;
  const storagePath = config?.values.storage_dir || configForm.storage_dir;
  const onboarding = describeDesktopOnboarding(config, diagnostics);
  const selfCheckBlockingFailures = selfCheck?.items.filter((item) => item.blocking && item.status === "fail") ?? [];
  const selfCheckSummary = selfCheckBlockingFailures.length === 0 ? copy.checksReady : copy.checksBlocked;
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

  return {
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
  };
}
