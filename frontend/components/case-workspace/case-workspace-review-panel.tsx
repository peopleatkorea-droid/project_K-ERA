"use client";

import { type ReactNode } from "react";

import { pick, type Locale } from "../../lib/i18n";
import {
  canvasHeaderMetaChipClass,
  canvasSidebarCardClass,
  canvasSidebarClass,
  canvasSidebarItemClass,
  canvasSidebarListClass,
  canvasSidebarMetricCardClass,
  canvasSidebarMetricGridClass,
  canvasSidebarMetricLabelClass,
  canvasSidebarMetricValueClass,
  canvasSidebarSectionLabelClass,
  momentumFillClass,
  momentumTrackClass,
  panelStackClass,
  workspacePanelClass,
} from "../ui/workspace-patterns";

type CaseWorkspaceReviewPanelProps = {
  locale: Locale;
  selectedCasePanelContent?: ReactNode;
  isAuthoringCanvas: boolean;
  draftStatusLabel: string;
  selectedSiteLabel: string | null;
  draftCompletionCount: number;
  draftImagesCount: number;
  draftRepresentativeCount: number;
  draftCompletionPercent: number;
  draftPendingItems: string[];
};

export function CaseWorkspaceReviewPanel({
  locale,
  selectedCasePanelContent,
  isAuthoringCanvas,
  draftStatusLabel,
  selectedSiteLabel,
  draftCompletionCount,
  draftImagesCount,
  draftRepresentativeCount,
  draftCompletionPercent,
  draftPendingItems,
}: CaseWorkspaceReviewPanelProps) {
  if (selectedCasePanelContent) {
    return (
      <aside className={workspacePanelClass}>
        <div className={panelStackClass}>{selectedCasePanelContent}</div>
      </aside>
    );
  }

  if (!isAuthoringCanvas) {
    return null;
  }

  return (
    <aside className={workspacePanelClass}>
      <div className={canvasSidebarClass}>
        <section className={canvasSidebarCardClass}>
          <div className="flex items-start justify-between gap-3">
            <div className="grid gap-1">
              <span className={canvasSidebarSectionLabelClass}>{pick(locale, "Draft state", "초안 상태")}</span>
              <strong className="text-[1.1rem] font-semibold tracking-[-0.03em] text-ink">{draftStatusLabel}</strong>
            </div>
            <span className={canvasHeaderMetaChipClass}>{selectedSiteLabel ?? pick(locale, "No hospital", "병원 없음")}</span>
          </div>
          <div className={canvasSidebarMetricGridClass}>
            <div className={canvasSidebarMetricCardClass}>
              <strong className={canvasSidebarMetricValueClass}>{`${draftCompletionCount}/4`}</strong>
              <span className={canvasSidebarMetricLabelClass}>{pick(locale, "sections", "섹션")}</span>
            </div>
            <div className={canvasSidebarMetricCardClass}>
              <strong className={canvasSidebarMetricValueClass}>{draftImagesCount}</strong>
              <span className={canvasSidebarMetricLabelClass}>{pick(locale, "images", "이미지")}</span>
            </div>
            <div className={canvasSidebarMetricCardClass}>
              <strong className={canvasSidebarMetricValueClass}>{draftRepresentativeCount}</strong>
              <span className={canvasSidebarMetricLabelClass}>{pick(locale, "representative", "대표")}</span>
            </div>
          </div>
          <div className={momentumTrackClass}>
            <div className={momentumFillClass} style={{ width: `${draftCompletionPercent}%` }} />
          </div>
        </section>

        <section className={canvasSidebarCardClass}>
          <div className="grid gap-1">
            <span className={canvasSidebarSectionLabelClass}>{pick(locale, "Next up", "다음 작업")}</span>
            <p className="m-0 text-sm leading-6 text-muted">
              {pick(
                locale,
                "Keep the right rail focused on what blocks submission instead of on hospital analytics.",
                "우측 레일은 병원 분석보다 제출을 막는 항목에 집중합니다."
              )}
            </p>
          </div>
          <div className={canvasSidebarListClass}>
            {draftPendingItems.length > 0 ? (
              draftPendingItems.slice(0, 5).map((item) => (
                <div key={item} className={canvasSidebarItemClass}>
                  {item}
                </div>
              ))
            ) : (
              <div className={canvasSidebarItemClass}>
                {pick(locale, "All core draft checks are in place. Review the image board and submit when ready.", "핵심 초안 체크가 모두 완료되었습니다. 이미지 보드를 검토한 뒤 준비되면 제출하세요.")}
              </div>
            )}
          </div>
        </section>
      </div>
    </aside>
  );
}
