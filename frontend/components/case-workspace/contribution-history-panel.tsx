"use client";

import type { ReactNode } from "react";

import type { CaseContributionResponse, CaseHistoryResponse, CaseSummaryRecord } from "../../lib/api";
import { pick, translateOption, type Locale } from "../../lib/i18n";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { MetricGrid, MetricItem } from "../ui/metric-grid";
import { SectionHeader } from "../ui/section-header";
import {
  contributionMetricGridClass,
  contributionNoteClass,
  contributionNoteStackClass,
  contributionPanelClass,
  contributionStatusCardClass,
  docBadgeRowClass,
  docSectionLabelClass,
  docSiteBadgeClass,
  emptySurfaceClass,
  historyColumnClass,
  historyColumnHeadClass,
  historyEntryClass,
  historyEntryHeadClass,
  historyEntryMetaClass,
  historyPanelClass,
  historyPanelColumnsClass,
  historyPanelListClass,
  historyPanelMetricGridClass,
} from "../ui/workspace-patterns";

type Props = {
  locale: Locale;
  selectedCase: CaseSummaryRecord;
  canRunValidation: boolean;
  canContributeSelectedCase: boolean;
  hasValidationResult: boolean;
  contributionBusy: boolean;
  contributionResult: CaseContributionResponse | null;
  historyBusy: boolean;
  caseHistory: CaseHistoryResponse | null;
  onContributeCase: () => void;
  completionContent: ReactNode;
  formatProbability: (value: number | null | undefined, emptyLabel?: string) => string;
  notAvailableLabel: string;
};

export function ContributionHistoryPanel({
  locale,
  selectedCase,
  canRunValidation,
  canContributeSelectedCase,
  hasValidationResult,
  contributionBusy,
  contributionResult,
  historyBusy,
  caseHistory,
  onContributeCase,
  completionContent,
  formatProbability,
  notAvailableLabel,
}: Props) {
  const validationCount = caseHistory?.validations.length ?? 0;
  const contributionCount = caseHistory?.contributions.length ?? 0;
  const contributionMessages = [
    selectedCase.visit_status !== "active"
      ? pick(
          locale,
          "Only active visits are enabled for contribution under the current training policy.",
          "현재 학습 정책에서는 active 방문만 기여 대상으로 허용됩니다."
        )
      : null,
    selectedCase.visit_status === "active" && !hasValidationResult
      ? pick(
          locale,
          "Validation is optional, but running it first keeps review and contribution aligned.",
          "검증은 선택 사항이지만, 먼저 실행하면 리뷰와 기여 흐름을 더 맞추기 쉽습니다."
        )
      : null,
    !canRunValidation
      ? pick(
          locale,
          "Viewer accounts cannot run validation or local contribution jobs.",
          "뷰어 계정은 검증과 로컬 기여 작업을 실행할 수 없습니다."
        )
      : null,
  ].filter(Boolean) as string[];

  const visitStatusLabel = translateOption(locale, "visitStatus", selectedCase.visit_status);
  const representativeViewLabel = selectedCase.representative_view
    ? translateOption(locale, "view", selectedCase.representative_view)
    : notAvailableLabel;
  const organismModeLabel = selectedCase.polymicrobial
    ? pick(locale, "Polymicrobial", "다균종")
    : pick(locale, "Single organism", "단일 균종");

  return (
    <>
      {completionContent}

      <Card as="section" variant="panel" className={`grid gap-4 p-5 ${contributionPanelClass}`}>
        <SectionHeader
          eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Contribution", "기여")}</div>}
          title={pick(locale, "Prepare a local contribution update", "로컬 기여 업데이트 준비")}
          titleAs="h4"
          description={pick(
            locale,
            "Contribution runs locally and stores the weight delta for later upload to the shared model workflow.",
            "기여는 로컬에서 실행되고, 이후 공유 모델 흐름으로 올릴 weight delta만 저장합니다."
          )}
          aside={
            <Button type="button" variant="primary" size="sm" onClick={onContributeCase} disabled={contributionBusy || !canContributeSelectedCase}>
              {contributionBusy ? pick(locale, "Contributing...", "기여 중...") : pick(locale, "Contribute case update", "케이스 업데이트 기여")}
            </Button>
          }
        />

        <div className={docBadgeRowClass}>
          <span className={docSiteBadgeClass}>{`${pick(locale, "Visit status", "방문 상태")} / ${visitStatusLabel}`}</span>
          <span className={docSiteBadgeClass}>
            {hasValidationResult
              ? pick(locale, "Validation available", "검증 결과 있음")
              : pick(locale, "Validation optional", "검증 선택 가능")}
          </span>
          <span className={docSiteBadgeClass}>{`${pick(locale, "Images", "이미지")} / ${selectedCase.image_count}`}</span>
        </div>

        {contributionMessages.length > 0 ? (
          <Card as="div" variant="nested" className={contributionNoteStackClass}>
            {contributionMessages.map((message) => (
              <p key={message} className={contributionNoteClass}>
                {message}
              </p>
            ))}
          </Card>
        ) : null}

        {contributionResult ? (
          <>
            <MetricGrid columns={2} className={contributionMetricGridClass}>
              <MetricItem value={contributionResult.stats.user_contributions} label={pick(locale, "my contributions", "내 기여 수")} />
              <MetricItem value={contributionResult.stats.total_contributions} label={pick(locale, "global contributions", "전체 기여 수")} />
              <MetricItem value={`${contributionResult.stats.user_contribution_pct}%`} label={pick(locale, "my share", "내 비중")} />
              <MetricItem value={contributionResult.execution_device} label={pick(locale, "device", "디바이스")} />
            </MetricGrid>
            <Card as="div" variant="nested" className={contributionStatusCardClass}>
              <p className="m-0 text-sm leading-6 text-muted">
                {pick(
                  locale,
                  `Update ${contributionResult.update.update_id} is queued as a ${contributionResult.update.upload_type} against ${contributionResult.model_version.version_name}.`,
                  `업데이트 ${contributionResult.update.update_id}가 ${contributionResult.model_version.version_name} 기준 ${contributionResult.update.upload_type} 형태로 대기열에 추가되었습니다.`
                )}
              </p>
            </Card>
          </>
        ) : (
          <Card as="div" variant="nested" className={contributionStatusCardClass}>
            <p className="m-0 text-sm leading-6 text-muted">
              {pick(
                locale,
                "Contribution trains locally and stores only the weight delta for later upload.",
                "기여는 로컬 학습을 수행하고, 이후 업로드할 weight delta만 저장합니다."
              )}
            </p>
          </Card>
        )}
      </Card>

      <Card as="section" variant="panel" className={`grid gap-4 p-5 ${historyPanelClass}`}>
        <SectionHeader
          eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Case history", "케이스 이력")}</div>}
          title={pick(locale, "Review validation and contribution activity", "검증과 기여 기록 검토")}
          titleAs="h4"
          description={pick(
            locale,
            "This side panel keeps the selected case's validation timeline and contribution trail in one place.",
            "선택된 케이스의 검증 타임라인과 기여 기록을 한 패널에서 이어서 확인합니다."
          )}
          aside={
            <span className={docSiteBadgeClass}>
              {historyBusy
                ? pick(locale, "Refreshing...", "새로고침 중...")
                : `${validationCount} ${pick(locale, "validations", "검증")} / ${contributionCount} ${pick(locale, "contributions", "기여")}`}
            </span>
          }
        />

        <MetricGrid columns={2} className={historyPanelMetricGridClass}>
          <MetricItem value={validationCount} label={pick(locale, "validations", "검증")} />
          <MetricItem value={contributionCount} label={pick(locale, "contributions", "기여")} />
          <MetricItem value={representativeViewLabel} label={pick(locale, "representative view", "대표 view")} />
          <MetricItem value={organismModeLabel} label={pick(locale, "organism mode", "균주 구성")} />
        </MetricGrid>

        <div className={docBadgeRowClass}>
          <span className={docSiteBadgeClass}>{`${pick(locale, "Patient", "환자")} / ${selectedCase.patient_id}`}</span>
          <span className={docSiteBadgeClass}>{`${pick(locale, "Visit date", "방문 날짜")} / ${selectedCase.visit_date}`}</span>
          <span className={docSiteBadgeClass}>{`${pick(locale, "Culture", "배양")} / ${selectedCase.culture_species || notAvailableLabel}`}</span>
        </div>

        <div className={historyPanelColumnsClass}>
          <Card as="div" variant="nested" className={historyColumnClass}>
            <div className={historyColumnHeadClass}>
              <strong>{pick(locale, "Validations", "검증")}</strong>
              <span className={docSiteBadgeClass}>{validationCount}</span>
            </div>
            <div className={historyPanelListClass}>
              {caseHistory?.validations.length ? (
                caseHistory.validations.map((item) => (
                  <Card key={item.validation_id} as="article" variant="nested" className={historyEntryClass}>
                    <div className={historyEntryHeadClass}>
                      <strong>{item.model_version}</strong>
                      <span>{item.run_date}</span>
                    </div>
                    <div className={historyEntryMetaClass}>
                      <span>{item.run_scope}</span>
                      <span>{item.predicted_label}</span>
                      <span>{formatProbability(item.prediction_probability, notAvailableLabel)}</span>
                    </div>
                    <div className={historyEntryMetaClass}>
                      <span>{item.true_label}</span>
                      <span>{item.is_correct ? pick(locale, "match", "일치") : pick(locale, "mismatch", "불일치")}</span>
                    </div>
                  </Card>
                ))
              ) : (
                <div className={emptySurfaceClass}>{pick(locale, "No validation history for this case yet.", "이 케이스에는 아직 검증 이력이 없습니다.")}</div>
              )}
            </div>
          </Card>

          <Card as="div" variant="nested" className={historyColumnClass}>
            <div className={historyColumnHeadClass}>
              <strong>{pick(locale, "Contributions", "기여")}</strong>
              <span className={docSiteBadgeClass}>{contributionCount}</span>
            </div>
            <div className={historyPanelListClass}>
              {caseHistory?.contributions.length ? (
                caseHistory.contributions.map((item) => (
                  <Card key={item.contribution_id} as="article" variant="nested" className={historyEntryClass}>
                    <div className={historyEntryHeadClass}>
                      <strong>{item.update_id}</strong>
                      <span>{item.created_at}</span>
                    </div>
                    <div className={historyEntryMetaClass}>
                      <span>{item.upload_type ?? pick(locale, "weight delta", "weight delta")}</span>
                      <span>{item.execution_device ?? pick(locale, "unknown device", "알 수 없는 디바이스")}</span>
                    </div>
                    <div className={historyEntryMetaClass}>
                      <span>{item.update_status ?? pick(locale, "unknown status", "알 수 없는 상태")}</span>
                      <span>{item.architecture ?? notAvailableLabel}</span>
                    </div>
                  </Card>
                ))
              ) : (
                <div className={emptySurfaceClass}>{pick(locale, "No contribution history for this case yet.", "이 케이스에는 아직 기여 이력이 없습니다.")}</div>
              )}
            </div>
          </Card>
        </div>
      </Card>
    </>
  );
}
