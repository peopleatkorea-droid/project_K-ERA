"use client";

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
    <section className="panel-card completion-card">
      <div className="panel-card-head">
        <strong>
          {completion.kind === "contributed"
            ? pick(locale, "Contribution recorded", "기여 기록됨")
            : pick(locale, "Case saved", "케이스 저장됨")}
        </strong>
        <span>{formatDateTime(completion.timestamp, notAvailableLabel)}</span>
      </div>
      <p>
        {completion.kind === "contributed"
          ? pick(
              locale,
              `This case produced update ${completion.update_id ?? "pending"} and is queued as a local weight delta.`,
              `이 케이스는 업데이트 ${completion.update_id ?? pick(locale, "pending", "대기")}를 생성했고 로컬 weight delta로 대기열에 올라갔습니다.`
            )
          : pick(
              locale,
              "The patient, visit, and image set are now stored in the selected hospital workspace.",
              "환자, 방문, 이미지 세트가 선택한 병원 워크스페이스에 저장되었습니다."
            )}
      </p>
      {completion.kind === "contributed" && completion.stats ? (
        <div className="panel-metric-grid">
          <div>
            <strong>{completion.stats.user_contributions}</strong>
            <span>{pick(locale, "my contributions", "내 기여 수")}</span>
          </div>
          <div>
            <strong>{completion.stats.total_contributions}</strong>
            <span>{pick(locale, "global contributions", "전체 기여 수")}</span>
          </div>
          <div>
            <strong>{completion.stats.user_contribution_pct}%</strong>
            <span>{pick(locale, "my share", "내 비중")}</span>
          </div>
          <div>
            <strong>{hospitalValidationCount}</strong>
            <span>{pick(locale, "hospital validations", "병원 검증 수")}</span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
