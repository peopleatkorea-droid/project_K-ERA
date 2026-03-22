"use client";

import { Button } from "../components/ui/button";
import { SectionHeader } from "../components/ui/section-header";
import type { DesktopAppConfigState } from "../lib/desktop-app-config";
import type { DesktopManagedProcessStatus } from "../lib/desktop-diagnostics";
import type { DesktopSelfCheckItem, DesktopSelfCheckSnapshot } from "../lib/desktop-self-check";
import type { Locale } from "../lib/i18n";
import type { DesktopOnboardingState } from "../lib/desktop-onboarding";

import { onboardingStepContent, formatSelfCheckTone } from "./shell-helpers";
import type { DesktopShellCopy } from "./shell-copy";

export type RuntimeServiceSummary = {
  id: "backend" | "worker" | "ml";
  label: string;
  value: string;
  tone: "ready" | "attention" | "neutral";
};

type DesktopRuntimeStatusPanelProps = {
  locale: Locale;
  copy: DesktopShellCopy;
  runtimeError: string | null;
  error: string | null;
  showOnboarding: boolean;
  onboarding: DesktopOnboardingState;
  runtimeServiceSummaries: RuntimeServiceSummary[];
  runtimeBusy: boolean;
  runtimeAction: "refresh" | "start" | "stop" | null;
  backendHealthy: boolean;
  workerRunning: boolean;
  runtimeSummary: DesktopManagedProcessStatus | null;
  selfCheck: DesktopSelfCheckSnapshot | null;
  selfCheckBusy: boolean;
  selfCheckError: string | null;
  selfCheckBlockingFailures: DesktopSelfCheckItem[];
  selfCheckSummary: string;
  canRunSelfCheck: boolean;
  config: DesktopAppConfigState | null;
  storagePath: string;
  onOpenSettings: () => void;
  onRefreshRuntime: () => void;
  onStartRuntime: () => void;
  onStopRuntime: () => void;
  onRunSelfCheck: () => void;
  onOpenPath: (path: string | null | undefined) => void;
};

export function DesktopRuntimeStatusPanel({
  locale,
  copy,
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
  canRunSelfCheck,
  config,
  storagePath,
  onOpenSettings,
  onRefreshRuntime,
  onStartRuntime,
  onStopRuntime,
  onRunSelfCheck,
  onOpenPath,
}: DesktopRuntimeStatusPanelProps) {
  const runtimeContract = config?.runtime_contract ?? null;
  const onboardingCurrentStep = onboardingStepContent(locale, onboarding.currentStepId);

  return (
    <>
      <SectionHeader title={copy.runtimeStatus} description={copy.appStatusDescription} />

      {runtimeError ? (
        <div className="rounded-[18px] border border-danger/25 bg-danger/8 px-4 py-3 text-sm text-danger">
          {runtimeError}
        </div>
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
              const stepCopy = onboardingStepContent(locale, step.id);
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
              <Button type="button" variant="primary" onClick={onOpenSettings}>
                {copy.openSettingsAction}
              </Button>
            ) : onboarding.currentStepId === "runtimeServices" ? (
              <Button type="button" variant="primary" disabled={runtimeBusy || !onboarding.canStartRuntime} onClick={onStartRuntime}>
                {runtimeAction === "start" ? copy.startingRuntime : copy.startRuntime}
              </Button>
            ) : null}
            <Button type="button" variant="ghost" disabled={runtimeBusy} onClick={onRefreshRuntime}>
              {runtimeAction === "refresh" ? copy.refreshingRuntime : copy.refreshRuntime}
            </Button>
            <Button type="button" variant="ghost" disabled={runtimeBusy} onClick={onStopRuntime}>
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
            {backendHealthy ? copy.runtimeReadyLabel : copy.runtimeNotReadyLabel}
          </strong>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted">{copy.workerRunning}</span>
          <strong className={workerRunning ? "text-emerald-600" : "text-amber-600"}>
            {workerRunning ? copy.runtimeRunningLabel : copy.runtimeStoppedLabel}
          </strong>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="ghost" size="sm" disabled={runtimeBusy} onClick={onRefreshRuntime}>
            {runtimeAction === "refresh" ? copy.refreshingRuntime : copy.refreshRuntime}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={runtimeBusy || !config?.setup_ready} onClick={onStartRuntime}>
            {runtimeAction === "start" ? copy.startingRuntime : copy.startRuntime}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={runtimeBusy} onClick={onStopRuntime}>
            {runtimeAction === "stop" ? copy.stoppingRuntime : copy.stopRuntime}
          </Button>
        </div>
        <div className="grid gap-4 rounded-[18px] border border-border bg-white/65 p-4">
          <SectionHeader
            title={copy.selfCheckTitle}
            description={copy.selfCheckDescription}
            aside={
              <Button type="button" variant="ghost" size="sm" disabled={selfCheckBusy || !canRunSelfCheck} onClick={onRunSelfCheck}>
                {selfCheckBusy ? copy.refreshingRuntime : copy.refreshChecks}
              </Button>
            }
          />
          <div
            className={`rounded-[18px] border px-4 py-3 text-sm font-semibold ${
              selfCheckBlockingFailures.length === 0
                ? "border-emerald-500/25 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300"
                : "border-danger/20 bg-danger/8 text-danger"
            }`}
          >
            {selfCheckSummary}
          </div>
          {selfCheckError ? (
            <div className="rounded-[18px] border border-danger/25 bg-danger/8 px-4 py-3 text-sm text-danger">
              {selfCheckError}
            </div>
          ) : null}
          <div className="grid gap-3">
            {selfCheck?.items.length ? (
              selfCheck.items.map((item) => {
                const tone = formatSelfCheckTone(copy, item);
                return (
                  <div key={item.id} className="grid gap-3 rounded-[18px] border border-border bg-surface px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="grid gap-1">
                        <div className="font-semibold text-ink">{item.label}</div>
                        <div className={`text-sm ${tone.detailClass}`}>{item.detail}</div>
                      </div>
                      <span
                        className={`rounded-full border px-2.5 py-1 text-[0.72rem] font-semibold uppercase tracking-[0.12em] ${tone.badgeClass}`}
                      >
                        {tone.badge}
                      </span>
                    </div>
                    {item.path ? (
                      <div className="flex flex-wrap items-center gap-3">
                        <code className="overflow-x-auto whitespace-nowrap text-[0.78rem] text-muted">{item.path}</code>
                        <Button type="button" variant="ghost" size="sm" onClick={() => onOpenPath(item.path)}>
                          {copy.openPath}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <div className="rounded-[18px] border border-border bg-surface px-4 py-3 text-sm text-muted">
                {selfCheckBusy ? copy.refreshingRuntime : copy.runtimeNotReady}
              </div>
            )}
          </div>
        </div>
        {runtimeContract ? (
          <details className="rounded-[18px] border border-border bg-white/65 p-4">
            <summary className="cursor-pointer font-semibold text-ink">{copy.runtimeLookupDetails}</summary>
            <div className="mt-4 grid gap-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">{copy.runtimeMode}</span>
                <strong className="text-ink">{runtimeContract.packaged_mode ? copy.packagedLabel : copy.devLabel}</strong>
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
                  {runtimeContract.errors.length ? copy.blockedLabel : copy.runtimeReadyLabel}
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
                <Button type="button" variant="ghost" size="sm" disabled={!config?.config_path} onClick={() => onOpenPath(config?.config_path)}>
                  {copy.openConfigFile}
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={!config?.app_local_data_dir} onClick={() => onOpenPath(config?.app_local_data_dir)}>
                  {copy.openAppData}
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={!runtimeContract.logs_dir} onClick={() => onOpenPath(runtimeContract.logs_dir)}>
                  {copy.openRuntimeLogs}
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={!runtimeContract.resource_dir} onClick={() => onOpenPath(runtimeContract.resource_dir)}>
                  {copy.openResources}
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={!storagePath} onClick={() => onOpenPath(storagePath)}>
                  {copy.openStorage}
                </Button>
              </div>
            </div>
          </details>
        ) : null}
      </div>
    </>
  );
}
