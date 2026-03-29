"use client";

import { useEffect, useState } from "react";

import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { MetricGrid, MetricItem } from "../ui/metric-grid";
import { SectionHeader } from "../ui/section-header";
import {
  ensureDesktopDiagnosticsBackends,
  fetchDesktopDiagnosticsSnapshot,
  type DesktopNodeStatus,
  stopDesktopDiagnosticsBackends,
  type DesktopDiagnosticsSnapshot,
} from "../../lib/desktop-diagnostics";
import { pick, type Locale } from "../../lib/i18n";
import { registerLocalNodeViaMainAdmin } from "../../lib/local-node-client";
import type { ManagedSiteRecord } from "../../lib/types";

type Props = {
  token: string;
  locale: Locale;
  formatDateTime: (value: string | null | undefined, emptyLabel?: string) => string;
  selectedManagedSite?: ManagedSiteRecord | null;
  selectedSiteLabel?: string | null;
};

type InlineStatus = {
  tone: "success" | "danger";
  message: string;
};

function formatBoolean(locale: Locale, value: boolean | null | undefined) {
  if (value == null) {
    return pick(locale, "n/a", "정보 없음");
  }
  return value ? pick(locale, "Yes", "예") : pick(locale, "No", "아니오");
}

function formatProcessState(
  locale: Locale,
  process:
    | {
        running: boolean;
        healthy: boolean;
      }
    | null
    | undefined,
) {
  if (!process) {
    return pick(locale, "Unavailable", "사용 불가");
  }
  if (process.healthy) {
    return pick(locale, "Healthy", "정상");
  }
  if (process.running) {
    return pick(locale, "Starting", "시작 중");
  }
  return pick(locale, "Stopped", "중지");
}

function formatWorkerState(
  locale: Locale,
  process:
    | {
        running: boolean;
      }
    | null
    | undefined,
) {
  if (!process) {
    return pick(locale, "Unavailable", "사용 불가");
  }
  return process.running ? pick(locale, "Running", "실행 중") : pick(locale, "Stopped", "중지");
}

function formatCapabilityState(locale: Locale, value: boolean | null | undefined) {
  if (value == null) {
    return pick(locale, "Unavailable", "사용 불가");
  }
  return value ? pick(locale, "Present", "존재") : pick(locale, "Missing", "없음");
}

function formatStoredCredentialsState(locale: Locale, nodeStatus: DesktopNodeStatus | null | undefined) {
  if (!nodeStatus) {
    return pick(locale, "Unavailable", "사용 불가");
  }
  return nodeStatus.stored_credentials_present ? pick(locale, "Present", "존재") : pick(locale, "Missing", "없음");
}

function inlineStatusClassName(status: InlineStatus | null) {
  if (!status) {
    return null;
  }
  if (status.tone === "success") {
    return "rounded-[16px] border border-emerald-300/40 bg-emerald-50/80 px-4 py-3 text-sm leading-6 text-emerald-900 dark:border-emerald-200/20 dark:bg-[rgba(22,101,52,0.18)] dark:text-[rgba(220,252,231,0.96)]";
  }
  return "rounded-[16px] border border-danger/20 bg-danger/5 px-4 py-3 text-sm leading-6 text-danger";
}

function resolveSiteLabel(site: ManagedSiteRecord | null | undefined, selectedSiteLabel: string | null | undefined) {
  const candidates = [
    selectedSiteLabel,
    site?.source_institution_name,
    site?.hospital_name,
    site?.display_name,
    site?.site_id,
  ];
  for (const candidate of candidates) {
    const normalized = String(candidate ?? "").trim();
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function reconnectFailureMessage(_locale: Locale, detail: string) {
  return detail;
}

function renderProcessDetails(
  locale: Locale,
  process:
    | {
        mode: string;
        base_url?: string | null;
        transport?: string | null;
        pid?: number | null;
        python_path?: string | null;
        stdout_log_path?: string | null;
        stderr_log_path?: string | null;
        last_error?: string | null;
      }
    | null
    | undefined,
) {
  if (!process) {
    return (
      <div className="rounded-[14px] border border-border/70 bg-white/65 px-3 py-2 text-sm leading-6 text-muted dark:bg-white/4">
        {pick(locale, "No status available.", "상태 정보가 없습니다.")}
      </div>
    );
  }

  const rows = [
    [pick(locale, "Mode", "모드"), process.mode],
    [pick(locale, "Transport", "전송"), process.transport ?? null],
    [pick(locale, "Base URL", "기본 URL"), process.base_url ?? null],
    [pick(locale, "PID", "PID"), process.pid ? String(process.pid) : null],
    [pick(locale, "Python", "Python"), process.python_path],
    [pick(locale, "stdout log", "stdout 로그"), process.stdout_log_path],
    [pick(locale, "stderr log", "stderr 로그"), process.stderr_log_path],
  ].filter(([, value]) => Boolean(value));

  return (
    <div className="grid gap-2 text-sm leading-6 text-muted">
      {rows.map(([label, value]) => (
        <div key={String(label)} className="rounded-[14px] border border-border/70 bg-white/65 px-3 py-2 dark:bg-white/4">
          <div className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted">{label}</div>
          <div className="font-mono text-[0.78rem] text-ink break-all">{String(value)}</div>
        </div>
      ))}
      {process.last_error ? (
        <div className="rounded-[14px] border border-danger/20 bg-danger/5 px-3 py-2 text-danger">
          <div className="text-[0.68rem] font-semibold uppercase tracking-[0.12em]">
            {pick(locale, "Last error", "마지막 오류")}
          </div>
          <div className="font-mono text-[0.78rem] break-all">{process.last_error}</div>
        </div>
      ) : null}
    </div>
  );
}

export function DesktopDiagnosticsPanel({ token, locale, formatDateTime, selectedManagedSite = null, selectedSiteLabel = null }: Props) {
  const [snapshot, setSnapshot] = useState<DesktopDiagnosticsSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reconnectBusy, setReconnectBusy] = useState(false);
  const [reconnectStatus, setReconnectStatus] = useState<InlineStatus | null>(null);

  async function run(
    operation: (signal?: AbortSignal) => Promise<DesktopDiagnosticsSnapshot>,
  ) {
    const controller = new AbortController();
    setBusy(true);
    setError(null);
    try {
      const nextSnapshot = await operation(controller.signal);
      setSnapshot(nextSnapshot);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError(null);
    void fetchDesktopDiagnosticsSnapshot(controller.signal)
      .then((nextSnapshot) => {
        setSnapshot(nextSnapshot);
      })
      .catch((nextError) => {
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      })
      .finally(() => {
        setBusy(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    setReconnectStatus(null);
  }, [selectedManagedSite?.site_id]);

  const runtime = snapshot?.runtime ?? "web";
  const controlPlane = snapshot?.nodeStatus?.control_plane ?? null;
  const topology = snapshot?.nodeStatus?.database_topology ?? null;
  const selectedSiteId = String(selectedManagedSite?.site_id ?? "").trim();
  const resolvedSiteLabel = resolveSiteLabel(selectedManagedSite, selectedSiteLabel);
  const reconnectUnavailableReason =
    runtime !== "desktop"
      ? pick(locale, "This recovery flow is only available in the desktop app.", "이 복구 기능은 데스크톱 앱에서만 사용할 수 있습니다.")
      : !String(token ?? "").trim()
        ? pick(locale, "Your admin session is missing. Sign in again before reconnecting the operations hub.", "관리자 세션이 없습니다. 운영 허브를 다시 연결하기 전에 다시 로그인하세요.")
      : !selectedSiteId
        ? pick(locale, "Select a hospital above before reconnecting the operations hub.", "운영 허브를 다시 연결하려면 먼저 병원을 선택하세요.")
        : null;

  async function handleReconnect() {
    if (reconnectUnavailableReason) {
      setReconnectStatus({ tone: "danger", message: reconnectUnavailableReason });
      return;
    }
    setReconnectBusy(true);
    setReconnectStatus(null);
    setError(null);
    try {
      const preparedSnapshot = await ensureDesktopDiagnosticsBackends();
      setSnapshot(preparedSnapshot);
      const controlPlaneBaseUrl = String(preparedSnapshot?.nodeStatus?.control_plane?.base_url ?? controlPlane?.base_url ?? "").trim() || undefined;
      await registerLocalNodeViaMainAdmin({
        control_plane_user_token: token,
        control_plane_base_url: controlPlaneBaseUrl,
        device_name: "local-node",
        site_id: selectedSiteId,
        display_name: String(selectedManagedSite?.display_name ?? resolvedSiteLabel ?? selectedSiteId).trim() || selectedSiteId,
        hospital_name: String(selectedManagedSite?.hospital_name ?? resolvedSiteLabel ?? selectedSiteId).trim() || selectedSiteId,
        source_institution_id: String(selectedManagedSite?.source_institution_id ?? "").trim() || undefined,
        overwrite: true,
      });
      const refreshedSnapshot = await fetchDesktopDiagnosticsSnapshot();
      setSnapshot(refreshedSnapshot);
      setReconnectStatus({
        tone: "success",
        message: pick(
          locale,
          `Operations hub is reconnected for ${resolvedSiteLabel ?? selectedSiteId}.`,
          `${resolvedSiteLabel ?? selectedSiteId}에 운영 허브를 다시 연결했습니다.`,
        ),
      });
    } catch (nextError) {
      const detail = nextError instanceof Error ? nextError.message : String(nextError);
      setReconnectStatus({
        tone: "danger",
        message: reconnectFailureMessage(locale, detail),
      });
    } finally {
      setReconnectBusy(false);
    }
  }

  return (
    <Card as="section" variant="nested" className="grid gap-4 p-5">
      <SectionHeader
        title={pick(locale, "Desktop diagnostics", "Desktop 진단")}
        titleAs="h4"
        description={pick(
          locale,
          "Inspect the native runtime, local backend, ML sidecar, and node topology from inside the admin workspace.",
          "관리 화면 안에서 native runtime, local backend, ML sidecar, node topology를 확인합니다.",
        )}
        aside={
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" loading={busy} onClick={() => void run(fetchDesktopDiagnosticsSnapshot)}>
              {pick(locale, "Refresh", "새로고침")}
            </Button>
            <Button type="button" variant="ghost" size="sm" loading={busy} onClick={() => void run(ensureDesktopDiagnosticsBackends)}>
              {pick(locale, "Ensure services", "서비스 기동")}
            </Button>
            <Button type="button" variant="ghost" size="sm" loading={busy} onClick={() => void run(stopDesktopDiagnosticsBackends)}>
              {pick(locale, "Stop services", "서비스 중지")}
            </Button>
          </div>
        }
      />

      <MetricGrid columns={4}>
        <MetricItem value={runtime === "desktop" ? "desktop" : "web"} label={pick(locale, "Runtime", "Runtime")} />
        <MetricItem
          value={formatProcessState(locale, snapshot?.localBackend)}
          label={pick(locale, "Local backend", "로컬 backend")}
        />
        <MetricItem value={formatWorkerState(locale, snapshot?.localWorker)} label={pick(locale, "Local worker", "로컬 worker")} />
        <MetricItem value={formatProcessState(locale, snapshot?.mlBackend)} label={pick(locale, "ML sidecar", "ML sidecar")} />
        <MetricItem
          value={formatBoolean(locale, controlPlane?.node_sync_enabled ?? null)}
          label={pick(locale, "Node sync", "Node sync")}
        />
      </MetricGrid>

      {runtime !== "desktop" ? (
        <div className="rounded-[16px] border border-border/80 bg-surface-muted/70 px-4 py-3 text-sm leading-6 text-muted">
          {pick(
            locale,
            "This page is currently running in web mode, so the native desktop transport is unavailable here.",
            "현재 화면은 web 모드에서 실행 중이라 native desktop transport를 사용할 수 없습니다.",
          )}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-[16px] border border-danger/20 bg-danger/5 px-4 py-3 text-sm leading-6 text-danger">
          {error}
        </div>
      ) : null}

      {snapshot?.nodeStatusError ? (
        <div className="rounded-[16px] border border-amber-300/40 bg-amber-50/80 px-4 py-3 text-sm leading-6 text-[rgb(120,74,31)] dark:border-amber-200/20 dark:bg-[rgba(120,74,31,0.16)] dark:text-[rgba(255,232,204,0.92)]">
          {snapshot.nodeStatusError}
        </div>
      ) : null}

      {snapshot?.backendCapabilitiesError ? (
        <div className="rounded-[16px] border border-amber-300/40 bg-amber-50/80 px-4 py-3 text-sm leading-6 text-[rgb(120,74,31)] dark:border-amber-200/20 dark:bg-[rgba(120,74,31,0.16)] dark:text-[rgba(255,232,204,0.92)]">
          {snapshot.backendCapabilitiesError}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card as="section" variant="nested" className="grid gap-3 border border-border/80 p-4">
          <SectionHeader
            title={pick(locale, "Local backend", "로컬 backend")}
            titleAs="h4"
            description={
              snapshot?.localBackend?.last_started_at
                ? `${pick(locale, "Last started", "마지막 시작")} ${formatDateTime(snapshot.localBackend.last_started_at)}`
                : undefined
            }
          />
          {renderProcessDetails(locale, snapshot?.localBackend)}
        </Card>

        <Card as="section" variant="nested" className="grid gap-3 border border-border/80 p-4">
          <SectionHeader
            title={pick(locale, "Local worker", "로컬 worker")}
            titleAs="h4"
            description={
              snapshot?.localWorker?.last_started_at
                ? `${pick(locale, "Last started", "마지막 시작")} ${formatDateTime(snapshot.localWorker.last_started_at)}`
                : undefined
            }
          />
          {renderProcessDetails(locale, snapshot?.localWorker)}
        </Card>

        <Card as="section" variant="nested" className="grid gap-3 border border-border/80 p-4">
          <SectionHeader
            title={pick(locale, "ML sidecar", "ML sidecar")}
            titleAs="h4"
            description={
              snapshot?.mlBackend?.last_started_at
                ? `${pick(locale, "Last started", "마지막 시작")} ${formatDateTime(snapshot.mlBackend.last_started_at)}`
                : undefined
            }
          />
          {renderProcessDetails(locale, snapshot?.mlBackend)}
        </Card>
      </div>

      <Card as="section" variant="nested" className="grid gap-3 border border-border/80 p-4">
        <SectionHeader
          title={pick(locale, "Node topology", "Node topology")}
          titleAs="h4"
          description={pick(
            locale,
            "This reflects the local node status endpoint and helps verify that control and data planes are split as intended.",
            "로컬 node status endpoint 기준으로 control/data plane 분리가 의도대로 되었는지 확인합니다.",
          )}
        />
        <MetricGrid columns={4}>
          <MetricItem
            value={formatBoolean(locale, controlPlane?.configured ?? null)}
            label={pick(locale, "Control plane configured", "Control plane 설정")}
          />
          <MetricItem
            value={String(topology?.control_plane_connection_mode ?? "n/a")}
            label={pick(locale, "Control mode", "Control 모드")}
          />
          <MetricItem
            value={String(topology?.control_plane_backend ?? "n/a")}
            label={pick(locale, "Control DB", "Control DB")}
          />
          <MetricItem
            value={String(topology?.data_plane_backend ?? "n/a")}
            label={pick(locale, "Data DB", "Data DB")}
          />
        </MetricGrid>
        <MetricGrid columns={2}>
          <MetricItem
            value={formatStoredCredentialsState(locale, snapshot?.nodeStatus)}
            label={pick(locale, "Stored node credentials", "저장된 node credentials")}
          />
          <MetricItem
            value={formatBoolean(locale, snapshot?.nodeStatus ? Boolean(snapshot.nodeStatus.bootstrap) : null)}
            label={pick(locale, "Bootstrap cache", "Bootstrap cache")}
          />
        </MetricGrid>
        <div className="grid gap-2 text-sm leading-6 text-muted">
          <div className="rounded-[14px] border border-border/70 bg-white/65 px-3 py-2 dark:bg-white/4">
            <div className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted">Base URL</div>
            <div className="font-mono text-[0.78rem] text-ink break-all">{controlPlane?.base_url || "n/a"}</div>
          </div>
          <div className="rounded-[14px] border border-border/70 bg-white/65 px-3 py-2 dark:bg-white/4">
            <div className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted">Node ID</div>
            <div className="font-mono text-[0.78rem] text-ink break-all">{controlPlane?.node_id || "n/a"}</div>
          </div>
        </div>
      </Card>

      <Card as="section" variant="nested" className="grid gap-3 border border-border/80 p-4">
        <SectionHeader
          title={pick(locale, "Operations hub recovery", "운영 허브 복구")}
          titleAs="h4"
          description={pick(
            locale,
            "Use the current admin session to re-register this desktop node for the selected hospital and store fresh credentials in the local backend.",
            "현재 관리자 세션으로 선택한 병원용 데스크톱 node를 다시 등록하고 새 credentials를 로컬 backend에 저장합니다.",
          )}
          aside={
            <span className="rounded-full border border-border/80 bg-white/70 px-3 py-1 text-[0.72rem] font-semibold text-muted dark:bg-white/6">
              {resolvedSiteLabel ?? pick(locale, "No hospital selected", "병원 미선택")}
            </span>
          }
        />
        <div className="rounded-[14px] border border-border/70 bg-white/65 px-3 py-2 text-sm leading-6 text-muted dark:bg-white/4">
          {pick(
            locale,
            "No separate hub sign-in is required here. The reconnect action uses your current admin login and the hospital selected above.",
            "여기서는 별도 운영 허브 로그인이 필요하지 않습니다. 다시 연결은 현재 관리자 로그인과 위에서 선택한 병원 기준으로 진행됩니다.",
          )}
        </div>
        {reconnectUnavailableReason ? (
          <div className="rounded-[16px] border border-amber-300/40 bg-amber-50/80 px-4 py-3 text-sm leading-6 text-[rgb(120,74,31)] dark:border-amber-200/20 dark:bg-[rgba(120,74,31,0.16)] dark:text-[rgba(255,232,204,0.92)]">
            {reconnectUnavailableReason}
          </div>
        ) : null}
        {reconnectStatus ? <div className={inlineStatusClassName(reconnectStatus)!}>{reconnectStatus.message}</div> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="primary"
            size="sm"
            loading={reconnectBusy}
            disabled={Boolean(reconnectUnavailableReason)}
            onClick={() => void handleReconnect()}
          >
            {pick(locale, "Reconnect this hospital", "이 병원으로 다시 연결")}
          </Button>
        </div>
      </Card>

      <Card as="section" variant="nested" className="grid gap-3 border border-border/80 p-4">
        <SectionHeader
          title={pick(locale, "Desktop capability checks", "Desktop capability 확인")}
          titleAs="h4"
          description={pick(
            locale,
            "These checks stay in diagnostics only and do not block desktop startup.",
            "이 확인은 진단 전용이며 데스크톱 시작을 막지 않습니다.",
          )}
        />
        <MetricGrid columns={2}>
          <MetricItem
            value={formatCapabilityState(locale, snapshot?.backendCapabilities?.desktopAuthRoutes)}
            label={pick(locale, "Desktop auth routes", "Desktop auth route")}
          />
          <MetricItem
            value={formatCapabilityState(locale, snapshot?.backendCapabilities?.selfCheckRoute)}
            label={pick(locale, "Self-check route", "Self-check route")}
          />
        </MetricGrid>
      </Card>
    </Card>
  );
}
