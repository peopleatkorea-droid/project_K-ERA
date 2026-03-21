"use client";

import { pick, type Locale } from "../../lib/i18n";
import { getSiteDisplayName } from "../../lib/site-labels";
import type { SiteRecord, SiteSummary, SiteValidationRunRecord } from "../../lib/api";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { MetricGrid } from "../ui/metric-grid";
import {
  docSiteBadgeClass,
  emptySurfaceClass,
  momentumFillClass,
  momentumTrackClass,
  railActivityItemClass,
  railActivityListClass,
  railCopyClass,
  railLabelClass,
  railMetricCardClass,
  railMetricGridClass,
  railMetricLabelClass,
  railMetricValueClass,
  railRunButtonClass,
  railSectionClass,
  railSectionHeadClass,
  railSiteButtonClass,
  railSiteListClass,
  railSummaryClass,
  railSummaryMetaClass,
  railSummaryValueClass,
  validationRailHeadClass,
  workspaceBrandActionButtonClass,
  workspaceBrandActionsClass,
  workspaceBrandClass,
  workspaceBrandCopyClass,
  workspaceBrandTitleClass,
  workspaceKickerClass,
  workspaceRailClass,
} from "../ui/workspace-patterns";

type CaseWorkspaceLeftRailProps = {
  locale: Locale;
  visibleSites: SiteRecord[];
  selectedSiteId: string | null;
  summary: SiteSummary | null;
  newCaseModeActive: boolean;
  listModeActive: boolean;
  isAuthoringCanvas: boolean;
  draftCompletionPercent: number;
  draftImagesCount: number;
  draftRepresentativeCount: number;
  resolvedVisitReferenceLabel: string;
  draftStatusLabel: string;
  latestSiteValidation: SiteValidationRunRecord | null;
  siteValidationRuns: SiteValidationRunRecord[];
  siteValidationBusy: boolean;
  canRunValidation: boolean;
  commonNotAvailable: string;
  formatDateTime: (value: string | null | undefined) => string;
  onStartNewCase: () => void;
  onOpenPatientList: () => void;
  onSelectSite: (siteId: string) => void;
  onRunSiteValidation: () => void;
};

export function CaseWorkspaceLeftRail({
  locale,
  visibleSites,
  selectedSiteId,
  summary,
  newCaseModeActive,
  listModeActive,
  isAuthoringCanvas,
  draftCompletionPercent,
  draftImagesCount,
  draftRepresentativeCount,
  resolvedVisitReferenceLabel,
  draftStatusLabel,
  latestSiteValidation,
  siteValidationRuns,
  siteValidationBusy,
  canRunValidation,
  commonNotAvailable,
  formatDateTime,
  onStartNewCase,
  onOpenPatientList,
  onSelectSite,
  onRunSiteValidation,
}: CaseWorkspaceLeftRailProps) {
  return (
    <aside className={workspaceRailClass}>
      <div className={workspaceBrandClass}>
        <div className={workspaceBrandCopyClass}>
          <h1 className={workspaceBrandTitleClass}>{pick(locale, "K-ERA", "K-ERA")}</h1>
          <div className={workspaceKickerClass}>{pick(locale, "Case Studio", "케이스 스튜디오")}</div>
        </div>
        <div className={workspaceBrandActionsClass} role="group" aria-label={pick(locale, "Workspace mode", "작업 모드")}>
          <Button
            className={workspaceBrandActionButtonClass(newCaseModeActive)}
            type="button"
            variant={newCaseModeActive ? "primary" : "ghost"}
            aria-pressed={newCaseModeActive}
            data-state={newCaseModeActive ? "active" : "inactive"}
            onClick={onStartNewCase}
          >
            {pick(locale, "New case", "새 케이스")}
          </Button>
          <Button
            className={workspaceBrandActionButtonClass(listModeActive)}
            type="button"
            variant={listModeActive ? "primary" : "ghost"}
            aria-pressed={listModeActive}
            data-state={listModeActive ? "active" : "inactive"}
            onClick={onOpenPatientList}
          >
            {pick(locale, "List view", "리스트")}
          </Button>
        </div>
      </div>

      <Card as="section" variant="nested" className={railSectionClass}>
        <div className={railSectionHeadClass}>
          <span className={railLabelClass}>{pick(locale, "Hospital", "병원")}</span>
          {visibleSites.length > 1 ? (
            <span className={docSiteBadgeClass}>{`${visibleSites.length} ${pick(locale, "linked", "연결됨")}`}</span>
          ) : null}
        </div>
        <div className={railSiteListClass}>
          {visibleSites.map((site) => (
            <button
              key={site.site_id}
              className={railSiteButtonClass(selectedSiteId === site.site_id)}
              type="button"
              onClick={() => onSelectSite(site.site_id)}
            >
              <strong>{getSiteDisplayName(site)}</strong>
            </button>
          ))}
        </div>
        {selectedSiteId && summary ? (
          <MetricGrid className={railMetricGridClass} columns={2}>
            <div className={railMetricCardClass}>
              <strong className={railMetricValueClass}>{summary.n_patients ?? 0}</strong>
              <span className={railMetricLabelClass}>{pick(locale, "patients", "환자")}</span>
            </div>
            <div className={railMetricCardClass}>
              <strong className={railMetricValueClass}>{summary.n_visits ?? 0}</strong>
              <span className={railMetricLabelClass}>{pick(locale, "visits", "방문")}</span>
            </div>
            <div className={railMetricCardClass}>
              <strong className={railMetricValueClass}>{summary.n_images ?? 0}</strong>
              <span className={railMetricLabelClass}>{pick(locale, "images", "이미지")}</span>
            </div>
            <div className={railMetricCardClass}>
              <strong className={railMetricValueClass}>{summary.n_validation_runs ?? 0}</strong>
              <span className={railMetricLabelClass}>{pick(locale, "validations", "검증")}</span>
            </div>
          </MetricGrid>
        ) : null}
      </Card>

      {isAuthoringCanvas ? (
        <Card as="section" variant="nested" className={railSectionClass}>
          <div className={railSectionHeadClass}>
            <span className={railLabelClass}>{pick(locale, "Canvas", "캔버스")}</span>
            <div className={railSummaryClass}>
              <strong className={railSummaryValueClass}>{`${draftCompletionPercent}%`}</strong>
              <span className={railSummaryMetaClass}>{pick(locale, "structured", "구조화됨")}</span>
            </div>
          </div>
          <div className={momentumTrackClass}>
            <div className={momentumFillClass} style={{ width: `${draftCompletionPercent}%` }} />
          </div>
          <p className={railCopyClass}>
            {pick(
              locale,
              "The writing view stays focused on one clinical case. The dashboard metrics return once you switch back to list or review mode.",
              "작성 화면은 한 건의 임상 케이스에만 집중합니다. 리스트나 리뷰 모드로 돌아가면 운영 지표가 다시 보입니다."
            )}
          </p>
          <div className={railActivityListClass}>
            <div className={railActivityItemClass}>
              <strong>{pick(locale, "Draft images", "초안 이미지")}</strong>
              <span>{`${draftImagesCount} ${pick(locale, "files", "파일")}`}</span>
              <span>{`${draftRepresentativeCount} ${pick(locale, "representative", "대표")}`}</span>
            </div>
            <div className={railActivityItemClass}>
              <strong>{pick(locale, "Visit reference", "방문 기준")}</strong>
              <span>{resolvedVisitReferenceLabel}</span>
              <span>{draftStatusLabel}</span>
            </div>
          </div>
        </Card>
      ) : (
        <Card as="section" variant="nested" className={railSectionClass}>
          <div className={`${railSectionHeadClass} ${validationRailHeadClass}`}>
            <div className="grid gap-1">
              <span className={railLabelClass}>{pick(locale, "Validation", "검증")}</span>
              <p className="m-0 text-sm leading-6 text-muted">
                {pick(locale, "Run the latest site-level check from here", "여기에서 최신 병원 단위 검증을 실행합니다")}
              </p>
            </div>
            <Button
              className={railRunButtonClass}
              type="button"
              size="sm"
              variant="ghost"
              onClick={onRunSiteValidation}
              disabled={siteValidationBusy || !selectedSiteId || !canRunValidation}
            >
              {siteValidationBusy ? pick(locale, "Running...", "실행 중...") : pick(locale, "Run hospital validation", "병원 검증 실행")}
            </Button>
          </div>
          {latestSiteValidation ? (
            <div className={railMetricGridClass}>
              <div className={railMetricCardClass}>
                <strong className={railMetricValueClass}>
                  {typeof latestSiteValidation.AUROC === "number" ? latestSiteValidation.AUROC.toFixed(3) : commonNotAvailable}
                </strong>
                <span className={railMetricLabelClass}>AUROC</span>
              </div>
              <div className={railMetricCardClass}>
                <strong className={railMetricValueClass}>
                  {typeof latestSiteValidation.accuracy === "number" ? latestSiteValidation.accuracy.toFixed(3) : commonNotAvailable}
                </strong>
                <span className={railMetricLabelClass}>{pick(locale, "accuracy", "정확도")}</span>
              </div>
              <div className={railMetricCardClass}>
                <strong className={railMetricValueClass}>{latestSiteValidation.n_cases ?? 0}</strong>
                <span className={railMetricLabelClass}>{pick(locale, "cases", "케이스")}</span>
              </div>
              <div className={railMetricCardClass}>
                <strong className={railMetricValueClass}>{latestSiteValidation.model_version}</strong>
                <span className={railMetricLabelClass}>{pick(locale, "latest model", "최신 모델")}</span>
              </div>
            </div>
          ) : (
            <div className={emptySurfaceClass}>{pick(locale, "No hospital-level validation has been run yet.", "아직 병원 단위 검증이 실행되지 않았습니다.")}</div>
          )}
          <div className={railActivityListClass}>
            {siteValidationRuns.slice(0, 3).map((item) => (
              <div key={item.validation_id} className={railActivityItemClass}>
                <strong>{item.model_version}</strong>
                <span>{formatDateTime(item.run_date)}</span>
                <span>
                  {typeof item.accuracy === "number"
                    ? `${pick(locale, "acc", "정확도")} ${item.accuracy.toFixed(3)}`
                    : `${item.n_cases ?? 0} ${pick(locale, "cases", "케이스")}`}
                </span>
              </div>
            ))}
          </div>
          {!canRunValidation ? (
            <p className={railCopyClass}>
              {pick(locale, "Viewer accounts can review metrics but cannot run hospital validation.", "뷰어 계정은 지표만 확인할 수 있고 병원 검증은 실행할 수 없습니다.")}
            </p>
          ) : null}
        </Card>
      )}
    </aside>
  );
}
