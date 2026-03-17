"use client";

import { Card } from "../ui/card";
import { MetricGrid, MetricItem } from "../ui/metric-grid";
import { SectionHeader } from "../ui/section-header";
import { docSectionLabelClass, docSiteBadgeClass, panelMetricGridClass } from "../ui/workspace-patterns";
import { pick, type Locale } from "../../lib/i18n";

type CompletionStats = {
  user_contributions: number;
  total_contributions: number;
  user_contribution_pct: number;
};

type CompletionState = {
  kind: "saved" | "contributed";
  timestamp: string;
  stats?: CompletionStats;
  update_id?: string;
  update_count?: number;
};

type Props = {
  locale: Locale;
  completion: CompletionState | null;
  hospitalValidationCount: number;
  formatDateTime: (value: string | null | undefined, emptyLabel?: string) => string;
  notAvailableLabel: string;
};

export function CompletionCard({
  locale,
  completion,
  hospitalValidationCount,
  formatDateTime,
  notAvailableLabel,
}: Props) {
  if (!completion) {
    return null;
  }

  return (
    <Card as="section" variant="panel" className="grid gap-4 p-5">
      <SectionHeader
        eyebrow={
          <div className={docSectionLabelClass}>
            {completion.kind === "contributed"
              ? pick(locale, "Contribution", "기여")
              : pick(locale, "Saved", "저장")}
          </div>
        }
        title={
          completion.kind === "contributed"
            ? pick(locale, "Contribution recorded", "기여 기록 완료")
            : pick(locale, "Case saved", "케이스 저장 완료")
        }
        titleAs="h4"
        aside={<span className={docSiteBadgeClass}>{formatDateTime(completion.timestamp, notAvailableLabel)}</span>}
      />

      <p className="m-0 text-sm leading-6 text-muted">
        {completion.kind === "contributed"
          ? completion.update_count && completion.update_count > 1
            ? pick(
                locale,
                `This case produced ${completion.update_count} local updates. The first queued update is ${completion.update_id ?? "pending"}.`,
                `이 케이스는 ${completion.update_count}개의 로컬 업데이트를 생성했습니다. 첫 queued update는 ${completion.update_id ?? pick(locale, "pending", "대기")}입니다.`
              )
            : pick(
                locale,
                `This case produced update ${completion.update_id ?? "pending"} and is queued as a local weight delta.`,
                `이 케이스는 업데이트 ${completion.update_id ?? pick(locale, "pending", "대기")}를 생성했고 로컬 weight delta로 대기열에 올라갔습니다.`
              )
          : pick(
              locale,
              "The patient, visit, and image set are now stored in the selected hospital workspace and ready for the next step.",
              "환자, 방문, 이미지 세트가 선택한 병원 워크스페이스에 저장되었고 다음 단계로 이어질 준비가 되었습니다."
            )}
      </p>

      {completion.kind === "contributed" && completion.stats ? (
        <MetricGrid className={panelMetricGridClass}>
          <MetricItem value={completion.stats.user_contributions} label={pick(locale, "my contributions", "내 기여 수")} />
          <MetricItem value={completion.stats.total_contributions} label={pick(locale, "global contributions", "전체 기여 수")} />
          <MetricItem value={`${completion.stats.user_contribution_pct}%`} label={pick(locale, "my share", "내 비중")} />
          <MetricItem value={hospitalValidationCount} label={pick(locale, "hospital validations", "병원 검증 수")} />
        </MetricGrid>
      ) : null}
    </Card>
  );
}
