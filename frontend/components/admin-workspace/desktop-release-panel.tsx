"use client";

import { useEffect, useMemo, useState } from "react";

import { activateAdminDesktopRelease, fetchAdminDesktopReleases, saveAdminDesktopRelease } from "../../lib/admin";
import type { DesktopReleaseRecord } from "../../lib/types";
import { pick, translateApiError, type Locale } from "../../lib/i18n";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Field } from "../ui/field";
import { MetricGrid, MetricItem } from "../ui/metric-grid";
import { SectionHeader } from "../ui/section-header";
import { docSiteBadgeClass } from "../ui/workspace-patterns";

type Props = {
  token: string;
  locale: Locale;
};

type ReleaseFormState = {
  release_id: string;
  label: string;
  version: string;
  download_url: string;
  folder_url: string;
  sha256: string;
  size_bytes: string;
  notes: string;
};

const DEFAULT_FORM_STATE: ReleaseFormState = {
  release_id: "",
  label: "K-ERA Desktop (CPU)",
  version: "",
  download_url: "",
  folder_url: "",
  sha256: "",
  size_bytes: "",
  notes: "",
};

function formatBinarySize(locale: Locale, value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return pick(locale, "Unavailable", "없음");
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 100 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
}

function releaseFormFromRecord(record: DesktopReleaseRecord): ReleaseFormState {
  return {
    release_id: record.release_id,
    label: record.label,
    version: record.version,
    download_url: record.download_url,
    folder_url: record.folder_url || "",
    sha256: record.sha256 || "",
    size_bytes: typeof record.size_bytes === "number" && Number.isFinite(record.size_bytes) ? String(record.size_bytes) : "",
    notes: record.notes || "",
  };
}

export function DesktopReleasePanel({ token, locale }: Props) {
  const [releases, setReleases] = useState<DesktopReleaseRecord[]>([]);
  const [form, setForm] = useState<ReleaseFormState>(DEFAULT_FORM_STATE);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const activeRelease = useMemo(
    () => releases.find((record) => record.active) ?? null,
    [releases],
  );

  async function refreshReleases() {
    setLoading(true);
    setError(null);
    try {
      const nextReleases = await fetchAdminDesktopReleases(token);
      setReleases(nextReleases);
      if (nextReleases.length > 0 && !form.version && !form.download_url) {
        setForm(releaseFormFromRecord(nextReleases[0]));
      }
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? translateApiError(locale, nextError.message)
          : pick(locale, "Unable to load desktop releases.", "데스크톱 설치본을 불러오지 못했습니다."),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshReleases();
  }, []);

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      const sizeValue = Number.parseInt(form.size_bytes.trim(), 10);
      const saved = await saveAdminDesktopRelease(token, {
        release_id: form.release_id.trim() || undefined,
        channel: "desktop_cpu_nsis",
        label: form.label.trim() || "K-ERA Desktop (CPU)",
        version: form.version.trim(),
        platform: "windows",
        installer_type: "nsis",
        download_url: form.download_url.trim(),
        folder_url: form.folder_url.trim() || null,
        sha256: form.sha256.trim() || null,
        size_bytes: Number.isFinite(sizeValue) && sizeValue > 0 ? sizeValue : null,
        notes: form.notes.trim() || null,
        active: true,
      });
      const nextReleases = await fetchAdminDesktopReleases(token);
      setReleases(nextReleases);
      setForm(releaseFormFromRecord(saved));
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? translateApiError(locale, nextError.message)
          : pick(locale, "Unable to save desktop release.", "데스크톱 설치본을 저장하지 못했습니다."),
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleActivate(releaseId: string) {
    setBusy(true);
    setError(null);
    try {
      const activated = await activateAdminDesktopRelease(token, releaseId);
      const nextReleases = await fetchAdminDesktopReleases(token);
      setReleases(nextReleases);
      setForm(releaseFormFromRecord(activated));
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? translateApiError(locale, nextError.message)
          : pick(locale, "Unable to activate desktop release.", "데스크톱 설치본을 활성화하지 못했습니다."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card as="section" variant="nested" className="grid gap-4 p-5">
      <SectionHeader
        title={pick(locale, "Desktop installer releases", "데스크톱 설치본 관리")}
        titleAs="h4"
        description={pick(
          locale,
          "Register CPU installer metadata in the control-plane database so web downloads do not depend on Vercel environment variables.",
          "CPU 설치본 메타데이터를 control-plane DB에 등록해서 웹 다운로드가 Vercel 환경변수에 묶이지 않게 합니다.",
        )}
        aside={
          <span className={docSiteBadgeClass}>
            {activeRelease
              ? `${pick(locale, "Active", "활성")} ${activeRelease.version}`
              : pick(locale, "No active release", "활성 설치본 없음")}
          </span>
        }
      />

      {error ? <div className="rounded-[18px] border border-danger/25 bg-danger/8 px-4 py-3 text-sm text-danger">{error}</div> : null}

      <MetricGrid columns={3}>
        <MetricItem
          value={activeRelease?.version || pick(locale, "Unavailable", "없음")}
          label={pick(locale, "Active version", "활성 버전")}
        />
        <MetricItem
          value={formatBinarySize(locale, activeRelease?.size_bytes)}
          label={pick(locale, "Package size", "패키지 크기")}
        />
        <MetricItem
          value={String(releases.length)}
          label={pick(locale, "Saved releases", "등록된 설치본")}
        />
      </MetricGrid>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <div className="grid gap-3">
          <Field label={pick(locale, "Version", "버전")}>
            <input value={form.version} onChange={(event) => setForm((current) => ({ ...current, version: event.target.value }))} />
          </Field>
          <Field label={pick(locale, "Label", "라벨")}>
            <input value={form.label} onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))} />
          </Field>
          <Field label={pick(locale, "Installer URL", "설치 파일 URL")}>
            <input value={form.download_url} onChange={(event) => setForm((current) => ({ ...current, download_url: event.target.value }))} />
          </Field>
          <Field label={pick(locale, "Folder URL", "폴더 URL")} hint={pick(locale, "Optional OneDrive folder link.", "선택값입니다. OneDrive 폴더 링크를 넣을 수 있습니다.")}>
            <input value={form.folder_url} onChange={(event) => setForm((current) => ({ ...current, folder_url: event.target.value }))} />
          </Field>
          <Field label="SHA256">
            <input value={form.sha256} onChange={(event) => setForm((current) => ({ ...current, sha256: event.target.value.toUpperCase() }))} />
          </Field>
          <Field label={pick(locale, "Size in bytes", "바이트 크기")}>
            <input value={form.size_bytes} onChange={(event) => setForm((current) => ({ ...current, size_bytes: event.target.value }))} inputMode="numeric" />
          </Field>
          <Field label={pick(locale, "Notes", "메모")} unstyledControl>
            <textarea
              className="min-h-28 w-full rounded-[14px] border border-border/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(248,250,252,0.88))] px-3.5 py-2.5 text-sm text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_6px_16px_rgba(15,23,42,0.03)] outline-none transition duration-150 ease-out placeholder:text-muted focus:border-brand/25 focus:ring-4 focus:ring-[rgba(48,88,255,0.12)]"
              value={form.notes}
              onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
            />
          </Field>
          <div className="flex flex-wrap justify-end gap-3">
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => setForm(activeRelease ? releaseFormFromRecord(activeRelease) : DEFAULT_FORM_STATE)}
            >
              {pick(locale, "Use active release", "현재 활성 설치본 불러오기")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => setForm(DEFAULT_FORM_STATE)}
            >
              {pick(locale, "New release", "새 설치본")}
            </Button>
            <Button type="button" variant="primary" loading={busy} onClick={() => void handleSave()}>
              {pick(locale, "Save as active CPU release", "CPU 설치본으로 저장 및 활성화")}
            </Button>
          </div>
        </div>

        <div className="grid gap-3">
          {loading ? (
            <div className="rounded-[18px] border border-border bg-surface-muted/55 px-4 py-5 text-sm text-muted">
              {pick(locale, "Loading desktop releases...", "데스크톱 설치본을 불러오는 중입니다.")}
            </div>
          ) : releases.length === 0 ? (
            <div className="rounded-[18px] border border-dashed border-border bg-surface-muted/55 px-4 py-5 text-sm text-muted">
              {pick(locale, "No desktop releases have been registered yet.", "등록된 데스크톱 설치본이 아직 없습니다.")}
            </div>
          ) : (
            releases.map((release) => (
              <Card key={release.release_id} as="article" variant="nested" className="grid gap-3 border border-border/80 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-ink">{release.label}</div>
                    <div className="mt-1 text-xs text-muted">{`${release.version} · ${release.platform}/${release.installer_type}`}</div>
                  </div>
                  <span className={docSiteBadgeClass}>
                    {release.active ? pick(locale, "Active", "활성") : pick(locale, "Inactive", "비활성")}
                  </span>
                </div>
                <MetricGrid columns={2}>
                  <MetricItem value={formatBinarySize(locale, release.size_bytes)} label={pick(locale, "Size", "크기")} />
                  <MetricItem value={release.updated_at} label={pick(locale, "Updated", "갱신 시각")} />
                </MetricGrid>
                <div className="text-xs leading-5 text-muted break-all">{release.download_url}</div>
                {release.notes ? <div className="text-xs leading-5 text-muted">{release.notes}</div> : null}
                <div className="flex flex-wrap justify-end gap-3">
                  <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setForm(releaseFormFromRecord(release))}>
                    {pick(locale, "Load into form", "폼으로 불러오기")}
                  </Button>
                  {!release.active ? (
                    <Button type="button" size="sm" variant="primary" loading={busy} onClick={() => void handleActivate(release.release_id)}>
                      {pick(locale, "Make active", "활성으로 전환")}
                    </Button>
                  ) : null}
                </div>
              </Card>
            ))
          )}
        </div>
      </div>
    </Card>
  );
}
