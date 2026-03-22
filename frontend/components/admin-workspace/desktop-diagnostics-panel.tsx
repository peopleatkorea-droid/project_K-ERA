"use client";

import { useEffect, useState } from "react";

import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { MetricGrid, MetricItem } from "../ui/metric-grid";
import { SectionHeader } from "../ui/section-header";
import {
  ensureDesktopDiagnosticsBackends,
  fetchDesktopDiagnosticsSnapshot,
  stopDesktopDiagnosticsBackends,
  type DesktopDiagnosticsSnapshot,
} from "../../lib/desktop-diagnostics";
import { pick, type Locale } from "../../lib/i18n";

type Props = {
  locale: Locale;
  formatDateTime: (value: string | null | undefined, emptyLabel?: string) => string;
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

export function DesktopDiagnosticsPanel({ locale, formatDateTime }: Props) {
  const [snapshot, setSnapshot] = useState<DesktopDiagnosticsSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const runtime = snapshot?.runtime ?? "web";
  const controlPlane = snapshot?.nodeStatus?.control_plane ?? null;
  const topology = snapshot?.nodeStatus?.database_topology ?? null;

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
    </Card>
  );
}
