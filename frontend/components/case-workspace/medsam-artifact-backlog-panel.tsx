"use client";

import type { MedsamArtifactStatusKey, MedsamArtifactStatusSummary } from "../../lib/api";
import type { Locale } from "../../lib/i18n";
import { Button } from "../ui/button";
import { docSiteBadgeClass, docSurfaceClass } from "../ui/workspace-patterns";
import type { LocalePick } from "./shared";

type MedsamArtifactBacklogPanelProps = {
  locale: Locale;
  pick: LocalePick;
  medsamArtifactStatus: MedsamArtifactStatusSummary | null;
  medsamArtifactStatusBusy: boolean;
  medsamArtifactBackfillBusy: boolean;
  medsamArtifactActiveStatus: MedsamArtifactStatusKey | null;
  canBackfillMedsamArtifacts: boolean;
  onRefreshMedsamArtifactStatus: () => void;
  onOpenMedsamArtifactBacklog: (status: MedsamArtifactStatusKey) => void;
  onCloseMedsamArtifactBacklog: () => void;
  onBackfillMedsamArtifacts: () => void;
};

export function MedsamArtifactBacklogPanel({
  locale,
  pick,
  medsamArtifactStatus,
  medsamArtifactStatusBusy,
  medsamArtifactBackfillBusy,
  medsamArtifactActiveStatus,
  canBackfillMedsamArtifacts,
  onRefreshMedsamArtifactStatus,
  onOpenMedsamArtifactBacklog,
  onCloseMedsamArtifactBacklog,
  onBackfillMedsamArtifacts,
}: MedsamArtifactBacklogPanelProps) {
  const activeJob = medsamArtifactStatus?.active_job as
    | {
        status?: string | null;
        result?: {
          progress?: {
            stage?: string | null;
            percent?: number | null;
            completed_images?: number | null;
            total_images?: number | null;
          } | null;
        } | null;
      }
    | null;
  const activeJobProgress = activeJob?.result?.progress ?? null;
  const completedImages = Number(activeJobProgress?.completed_images ?? Number.NaN);
  const totalImages = Number(activeJobProgress?.total_images ?? Number.NaN);
  const hasImageProgress = Number.isFinite(completedImages) && Number.isFinite(totalImages) && totalImages > 0;
  const progressPercent = Math.max(0, Math.min(100, Math.round(Number(activeJobProgress?.percent ?? 0))));
  const activeJobBadgeLabel = hasImageProgress
    ? `${completedImages}/${totalImages}`
    : `${progressPercent}%`;
  const activeJobStateLabel =
    activeJob?.status === "queued" || activeJobProgress?.stage === "queued"
      ? pick(locale, "Queued", "대기 중")
      : activeJob?.status === "running" || activeJobProgress?.stage === "running"
        ? pick(locale, "In progress", "진행 중")
        : null;
  const headerDescription = pick(
    locale,
    "Boxing and MedSAM status.",
    "boxing과 MedSAM 상태."
  );
  const statusCards: Array<{
    key: MedsamArtifactStatusKey;
    title: string;
    description: string;
  }> = [
    {
      key: "missing_lesion_box",
      title: pick(locale, "Lesion box missing", "Lesion box 누락"),
      description: pick(locale, "Manual boxing is needed.", "수동 boxing이 필요합니다."),
    },
    {
      key: "missing_roi",
      title: pick(locale, "Cornea ROI missing", "각막 ROI 누락"),
      description: pick(locale, "Corneal ROI is missing.", "각막 ROI가 없습니다."),
    },
    {
      key: "missing_lesion_crop",
      title: pick(locale, "Lesion crop missing", "병변 crop 누락"),
      description: pick(locale, "Lesion crop is missing.", "병변 crop이 없습니다."),
    },
    {
      key: "medsam_backfill_ready",
      title: pick(locale, "MedSAM backlog", "MedSAM 백로그"),
      description: pick(locale, "Ready for background processing.", "백그라운드 처리 가능합니다."),
    },
  ];

  return (
    <section className={`${docSurfaceClass} self-start content-start`}>
      <div className="grid content-start gap-4">
        <div className="flex flex-wrap items-center gap-3 xl:flex-nowrap">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 xl:flex-nowrap">
            <strong className="shrink-0 text-sm font-semibold text-ink">{pick(locale, "Artifact backlog", "아티팩트 백로그")}</strong>
            <span className="min-w-0 text-sm leading-6 text-muted xl:max-w-[720px] xl:truncate" title={headerDescription}>
              {headerDescription}
            </span>
            {activeJobStateLabel ? (
              <span aria-live="polite" className="shrink-0 whitespace-nowrap text-xs font-medium text-brand">
                {activeJobStateLabel}
              </span>
            ) : null}
            {medsamArtifactStatus?.active_job ? (
              <span className={`${docSiteBadgeClass} shrink-0 whitespace-nowrap`}>
                {activeJobBadgeLabel}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 xl:ml-auto xl:flex-nowrap">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="whitespace-nowrap"
              onClick={onRefreshMedsamArtifactStatus}
              disabled={medsamArtifactStatusBusy}
            >
              {medsamArtifactStatusBusy ? pick(locale, "Refreshing", "갱신 중") : pick(locale, "Refresh", "새로고침")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="primary"
              className="whitespace-nowrap"
              onClick={onBackfillMedsamArtifacts}
              disabled={
                !canBackfillMedsamArtifacts ||
                medsamArtifactBackfillBusy ||
                !medsamArtifactStatus ||
                medsamArtifactStatus.statuses.medsam_backfill_ready.images <= 0
              }
            >
              {medsamArtifactBackfillBusy ? pick(locale, "Queueing", "등록 중") : pick(locale, "Backfill", "백필")}
            </Button>
          </div>
        </div>

        <div className="grid content-start gap-3 lg:grid-cols-4">
          {statusCards.map((card) => {
            const counts = medsamArtifactStatus?.statuses[card.key] ?? { patients: 0, visits: 0, images: 0 };
            const active = medsamArtifactActiveStatus === card.key;
            return (
              <button
                key={card.key}
                type="button"
                onClick={() => {
                  if (active) {
                    onCloseMedsamArtifactBacklog();
                    return;
                  }
                  onOpenMedsamArtifactBacklog(card.key);
                }}
                aria-pressed={active}
                className={`grid h-full content-start gap-2 rounded-[18px] border px-4 py-3 text-left transition ${
                  active
                    ? "border-brand/40 bg-[rgba(48,88,255,0.08)] shadow-[0_12px_26px_rgba(48,88,255,0.12)]"
                    : "border-border/70 bg-white/75 hover:border-brand/25 hover:bg-white dark:bg-white/4"
                }`}
              >
                <div className="grid gap-1">
                  <strong className="text-sm font-semibold text-ink">{card.title}</strong>
                  <span className="text-xs leading-5 text-muted">{card.description}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink">
                  <span className="whitespace-nowrap">{`${counts.patients} ${pick(locale, "patients", "환자")}`}</span>
                  <span className="whitespace-nowrap">{`${counts.visits} ${pick(locale, "visits", "방문")}`}</span>
                  <span className="whitespace-nowrap">{`${counts.images} ${pick(locale, "images", "이미지")}`}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
