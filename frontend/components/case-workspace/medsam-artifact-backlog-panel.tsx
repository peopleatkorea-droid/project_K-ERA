"use client";

import type { MedsamArtifactStatusKey, MedsamArtifactStatusSummary } from "../../lib/api";
import type { Locale } from "../../lib/i18n";
import { Button } from "../ui/button";
import { docSiteBadgeClass, docSurfaceClass } from "../ui/workspace-patterns";
import type { LocalePick } from "./shared";

type MedsamArtifactBacklogPanelProps = {
  locale: Locale;
  pick: LocalePick;
  medsamArtifactPanelEnabled: boolean;
  medsamArtifactStatus: MedsamArtifactStatusSummary | null;
  medsamArtifactStatusBusy: boolean;
  medsamArtifactBackfillBusy: boolean;
  medsamArtifactActiveStatus: MedsamArtifactStatusKey | null;
  canBackfillMedsamArtifacts: boolean;
  onEnableMedsamArtifactPanel: () => void;
  onDisableMedsamArtifactPanel: () => void;
  onRefreshMedsamArtifactStatus: () => void;
  onOpenMedsamArtifactBacklog: (status: MedsamArtifactStatusKey) => void;
  onCloseMedsamArtifactBacklog: () => void;
  onBackfillMedsamArtifacts: () => void;
};

export function MedsamArtifactBacklogPanel({
  locale,
  pick,
  medsamArtifactPanelEnabled,
  medsamArtifactStatus,
  medsamArtifactStatusBusy,
  medsamArtifactBackfillBusy,
  medsamArtifactActiveStatus,
  canBackfillMedsamArtifacts,
  onEnableMedsamArtifactPanel,
  onDisableMedsamArtifactPanel,
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
  const activeJobBadgeLabel = hasImageProgress ? `${completedImages}/${totalImages}` : `${progressPercent}%`;
  const activeJobStateLabel =
    activeJob?.status === "queued" || activeJobProgress?.stage === "queued"
      ? pick(locale, "Queued", "대기 중")
      : activeJob?.status === "running" || activeJobProgress?.stage === "running"
        ? pick(locale, "In progress", "진행 중")
        : null;
  const statusCards: Array<{
    key: MedsamArtifactStatusKey;
    title: string;
  }> = [
    {
      key: "missing_lesion_box",
      title: pick(locale, "Lesion box missing", "Lesion box 누락"),
    },
    {
      key: "missing_roi",
      title: pick(locale, "Cornea ROI missing", "각막 ROI 누락"),
    },
    {
      key: "missing_lesion_crop",
      title: pick(locale, "Lesion crop missing", "병변 crop 누락"),
    },
    {
      key: "medsam_backfill_ready",
      title: pick(locale, "MedSAM backlog", "MedSAM 백로그"),
    },
  ];
  const cardsWithCounts = statusCards.map((card) => ({
    ...card,
    counts: medsamArtifactStatus?.statuses[card.key] ?? { patients: 0, visits: 0, images: 0 },
  }));
  const hasLoadedStatus = medsamArtifactStatus !== null;
  const visibleCards = cardsWithCounts.filter(
    (card) => card.counts.patients > 0 || card.counts.visits > 0 || card.counts.images > 0
  );
  const totalCounts = medsamArtifactStatus?.total ?? { patients: 0, visits: 0, images: 0 };
  const hasBacklog = hasLoadedStatus && visibleCards.length > 0;
  const showBackfillButton =
    medsamArtifactBackfillBusy ||
    Boolean(hasLoadedStatus && medsamArtifactStatus && medsamArtifactStatus.statuses.medsam_backfill_ready.images > 0);
  const activationSummaryLabel = pick(
    locale,
    "Artifact backlog stays idle until you enable it.",
    "활성화 전까지 아티팩트 백로그는 대기 상태로 유지됩니다."
  );
  const activationHintLabel = pick(
    locale,
    "No status fetches or polling run until you turn it on.",
    "켜기 전에는 상태 조회나 폴링이 실행되지 않습니다."
  );
  const summaryLabel = !medsamArtifactPanelEnabled
    ? activationSummaryLabel
    : !hasLoadedStatus
      ? pick(locale, "Refresh to check artifact backlog", "새로고침으로 아티팩트 백로그를 확인하세요")
    : hasBacklog
      ? pick(
          locale,
          `${visibleCards.length} queues · ${totalCounts.images} images`,
          `${visibleCards.length}개 항목 · ${totalCounts.images} 이미지`
        )
      : pick(locale, "No artifact backlog", "아티팩트 백로그 없음");

  return (
    <section className={`${docSurfaceClass} self-start content-start`}>
      <div className="grid content-start gap-4">
        <div className="grid gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-sm font-semibold text-ink">{pick(locale, "Artifact backlog", "아티팩트 백로그")}</strong>
                {medsamArtifactPanelEnabled && activeJobStateLabel ? (
                  <span aria-live="polite" className="text-xs font-medium text-brand">
                    {activeJobStateLabel}
                  </span>
                ) : null}
                {medsamArtifactPanelEnabled && medsamArtifactStatus?.active_job ? (
                  <span className={docSiteBadgeClass}>{activeJobBadgeLabel}</span>
                ) : null}
              </div>
              <p className="m-0 text-sm leading-6 text-muted">{summaryLabel}</p>
              {!medsamArtifactPanelEnabled ? (
                <p className="m-0 text-xs leading-5 text-muted">{activationHintLabel}</p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {!medsamArtifactPanelEnabled ? (
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  className="justify-center"
                  onClick={onEnableMedsamArtifactPanel}
                  disabled={medsamArtifactStatusBusy}
                >
                  {medsamArtifactStatusBusy
                    ? pick(locale, "Activating", "활성화 중")
                    : pick(locale, "Enable backlog", "백로그 활성화")}
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="justify-center"
                    onClick={onDisableMedsamArtifactPanel}
                  >
                    {pick(locale, "Disable", "비활성화")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="justify-center"
                    onClick={onRefreshMedsamArtifactStatus}
                    disabled={medsamArtifactStatusBusy}
                  >
                    {medsamArtifactStatusBusy ? pick(locale, "Refreshing", "새로고침 중") : pick(locale, "Refresh", "새로고침")}
                  </Button>
                  {showBackfillButton ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="primary"
                      className="justify-center"
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
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>

        {medsamArtifactPanelEnabled && hasBacklog ? (
          <div className="grid content-start gap-3">
            {visibleCards.map((card) => {
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
                  className={`grid h-full content-start gap-2 rounded-[18px] border px-4 py-3.5 text-left transition ${
                    active
                      ? "border-brand/40 bg-[rgba(48,88,255,0.08)] shadow-[0_12px_26px_rgba(48,88,255,0.12)]"
                      : "border-border/70 bg-white/75 hover:border-brand/25 hover:bg-white dark:bg-white/4"
                  }`}
                >
                  <strong className="text-[1.02rem] font-semibold leading-7 text-ink">{card.title}</strong>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-[12px] border border-border/70 bg-surface px-3 py-2">
                      <div className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted">
                        {pick(locale, "patients", "환자")}
                      </div>
                      <div className="pt-1 text-base font-semibold text-ink">{card.counts.patients}</div>
                    </div>
                    <div className="rounded-[12px] border border-border/70 bg-surface px-3 py-2">
                      <div className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted">
                        {pick(locale, "visits", "방문")}
                      </div>
                      <div className="pt-1 text-base font-semibold text-ink">{card.counts.visits}</div>
                    </div>
                    <div className="rounded-[12px] border border-border/70 bg-surface px-3 py-2">
                      <div className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted">
                        {pick(locale, "images", "이미지")}
                      </div>
                      <div className="pt-1 text-base font-semibold text-ink">{card.counts.images}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}
