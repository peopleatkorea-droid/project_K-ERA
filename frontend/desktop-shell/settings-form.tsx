"use client";

import type { FormEvent } from "react";

import { Button } from "../components/ui/button";
import { Field } from "../components/ui/field";
import { SectionHeader } from "../components/ui/section-header";
import type { DesktopAppConfigState, DesktopAppConfigValues, DesktopRuntimeContractState } from "../lib/desktop-app-config";
import type { DesktopUpdateCheckResult } from "../lib/desktop-updater";

import type { DesktopShellCopy } from "./shell-copy";

type DesktopSettingsFormProps = {
  copy: DesktopShellCopy;
  config: DesktopAppConfigState | null;
  configForm: DesktopAppConfigValues;
  configBusy: boolean;
  runtimeContract: DesktopRuntimeContractState | null;
  storagePath: string;
  supportBusy: boolean;
  supportMessage: string | null;
  supportBundlePath: string | null;
  supportError: string | null;
  updateState: DesktopUpdateCheckResult | null;
  updateBusy: boolean;
  updateMessage: string | null;
  updateProgress: string | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onReset: () => void;
  onConfigChange: (patch: Partial<DesktopAppConfigValues>) => void;
  onPickStorageDir: () => void;
  onOpenPath: (path: string | null | undefined) => void;
  onExportSupportBundle: () => void;
  onCheckUpdates: () => void;
  onInstallUpdate: () => void;
  onOpenReleaseDownload: () => void;
};

export function DesktopSettingsForm({
  copy,
  config,
  configForm,
  configBusy,
  runtimeContract,
  storagePath,
  supportBusy,
  supportMessage,
  supportBundlePath,
  supportError,
  updateState,
  updateBusy,
  updateMessage,
  updateProgress,
  onSubmit,
  onReset,
  onConfigChange,
  onPickStorageDir,
  onOpenPath,
  onExportSupportBundle,
  onCheckUpdates,
  onInstallUpdate,
  onOpenReleaseDownload,
}: DesktopSettingsFormProps) {
  return (
    <form className="grid gap-4" onSubmit={onSubmit}>
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
              onChange={(event) => onConfigChange({ storage_dir: event.target.value })}
              placeholder="C:\\Users\\<user>\\AppData\\Local\\KERA\\KERA_DATA"
            />
            <Button type="button" variant="ghost" onClick={onPickStorageDir}>
              {copy.browseStorageDir}
            </Button>
          </div>
        </Field>

        <Field as="div" label={copy.controlPlaneUrl} hint={copy.controlPlaneUrlHint} htmlFor="desktop-control-plane-url">
          <input
            id="desktop-control-plane-url"
            value={configForm.control_plane_api_base_url}
            onChange={(event) => onConfigChange({ control_plane_api_base_url: event.target.value })}
            placeholder="https://example.org/control-plane/api"
          />
        </Field>

        <Field as="div" label={copy.nodeId} hint={copy.nodeIdHint} htmlFor="desktop-node-id">
          <input
            id="desktop-node-id"
            value={configForm.control_plane_node_id}
            onChange={(event) => onConfigChange({ control_plane_node_id: event.target.value })}
          />
        </Field>

        <Field as="div" label={copy.nodeToken} hint={copy.nodeTokenHint} htmlFor="desktop-node-token">
          <input
            id="desktop-node-token"
            type="password"
            value={configForm.control_plane_node_token}
            onChange={(event) => onConfigChange({ control_plane_node_token: event.target.value })}
          />
        </Field>

        <Field as="div" label={copy.siteId} hint={copy.siteIdHint} htmlFor="desktop-site-id">
          <input
            id="desktop-site-id"
            value={configForm.control_plane_site_id}
            onChange={(event) => onConfigChange({ control_plane_site_id: event.target.value })}
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
              onChange={(event) => onConfigChange({ local_backend_python: event.target.value })}
              placeholder="C:\\KERA\\runtime\\python\\python.exe"
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field as="div" label={copy.appServiceModeLabel} htmlFor="desktop-backend-mode">
              <select
                id="desktop-backend-mode"
                value={configForm.local_backend_mode}
                onChange={(event) =>
                  onConfigChange({
                    local_backend_mode: event.target.value === "external" ? "external" : "managed",
                  })
                }
              >
                <option value="managed">{copy.managedBackend}</option>
                <option value="external">{copy.externalBackend}</option>
              </select>
            </Field>

            <Field as="div" label={copy.aiServiceModeLabel} htmlFor="desktop-ml-transport">
              <select
                id="desktop-ml-transport"
                value={configForm.ml_transport}
                onChange={(event) =>
                  onConfigChange({
                    ml_transport: event.target.value === "http" ? "http" : "sidecar",
                  })
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
            <Button type="button" variant="ghost" size="sm" disabled={!config?.config_path} onClick={() => onOpenPath(config?.config_path)}>
              {copy.openConfigFile}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={!config?.app_local_data_dir} onClick={() => onOpenPath(config?.app_local_data_dir)}>
              {copy.openAppData}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={!runtimeContract?.logs_dir} onClick={() => onOpenPath(runtimeContract?.logs_dir)}>
              {copy.openRuntimeLogs}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={!runtimeContract?.resource_dir} onClick={() => onOpenPath(runtimeContract?.resource_dir)}>
              {copy.openResources}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={!storagePath} onClick={() => onOpenPath(storagePath)}>
              {copy.openStorage}
            </Button>
          </div>
          <div className="grid gap-3 rounded-[18px] border border-border bg-white/65 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid gap-1">
                <div className="font-semibold text-ink">{copy.exportSupportBundle}</div>
                <div className="text-sm text-muted">{copy.supportBundleDescription}</div>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button type="button" variant="ghost" size="sm" disabled={supportBusy} onClick={onExportSupportBundle}>
                  {supportBusy ? copy.exportingSupportBundle : copy.exportSupportBundle}
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={!supportBundlePath} onClick={() => onOpenPath(supportBundlePath)}>
                  {copy.openExportedBundle}
                </Button>
              </div>
            </div>
            {supportMessage ? (
              <div className="rounded-[16px] border border-emerald-500/25 bg-emerald-500/8 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
                {supportMessage}
              </div>
            ) : null}
            {supportError ? (
              <div className="rounded-[16px] border border-danger/25 bg-danger/8 px-3 py-2 text-sm text-danger">{supportError}</div>
            ) : null}
          </div>
          <div className="grid gap-3 rounded-[18px] border border-border bg-white/65 p-4">
            <SectionHeader
              title={copy.updateTitle}
              description={copy.updateDescription}
              aside={
                <div className="flex flex-wrap gap-3">
                  <Button type="button" variant="ghost" size="sm" disabled={updateBusy} onClick={onCheckUpdates}>
                    {updateBusy ? copy.checkingUpdates : copy.checkUpdates}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={updateBusy || !updateState?.available || !updateState.installable}
                    onClick={onInstallUpdate}
                  >
                    {updateBusy && updateState?.installable ? copy.installingUpdate : copy.installUpdate}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" disabled={!updateState?.downloadUrl} onClick={onOpenReleaseDownload}>
                    {copy.updateDownload}
                  </Button>
                </div>
              }
            />
            <div className="rounded-[16px] border border-border bg-surface px-3 py-2 text-sm text-ink">
              {updateMessage
                ? updateMessage
                : updateState?.available
                  ? `${copy.updateAvailable} ${updateState.availableVersion ? `v${updateState.availableVersion}` : ""}`.trim()
                  : updateState
                    ? copy.noUpdateAvailable
                    : copy.updateCheckHint}
            </div>
            {updateState?.available ? (
              <div className="text-sm text-muted">
                {updateState.installable ? copy.updateInstallReady : copy.updateInstallManual}
              </div>
            ) : null}
            {updateProgress ? <div className="text-sm text-muted">{updateProgress}</div> : null}
            {updateState?.error && !updateMessage && (!updateState.available || updateState.source === "none") ? (
              <div className="text-sm text-muted">{updateState.error}</div>
            ) : null}
            {updateState?.notes ? (
              <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-[16px] border border-border bg-surface px-3 py-2 text-sm text-muted">
                {updateState.notes}
              </div>
            ) : null}
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
                  <span className="text-muted">{copy.noPythonCandidatesResolved}</span>
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
        <Button type="button" variant="ghost" disabled={configBusy} onClick={onReset}>
          {copy.resetSettings}
        </Button>
      </div>
    </form>
  );
}
