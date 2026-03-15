"use client";

import type { ReactNode } from "react";

import type { CaseContributionResponse, CaseHistoryResponse, CaseSummaryRecord } from "../../lib/api";
import { pick, type Locale } from "../../lib/i18n";

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
  return (
    <>
      {completionContent}

      <section className="panel-card">
        <div className="panel-card-head">
          <strong>{pick(locale, "Contribution", "기여")}</strong>
          <button className="ghost-button" type="button" onClick={onContributeCase} disabled={contributionBusy || !canContributeSelectedCase}>
            {contributionBusy ? pick(locale, "Contributing...", "기여 중...") : pick(locale, "Contribute case update", "케이스 업데이트 기여")}
          </button>
        </div>
        {selectedCase.visit_status !== "active" ? (
          <p>{pick(locale, "Only active visits are enabled for contribution under the current training policy.", "현재 학습 정책에서는 active 방문만 기여 대상으로 허용됩니다.")}</p>
        ) : null}
        {selectedCase.visit_status === "active" && !hasValidationResult ? (
          <p>{pick(locale, "Validation is optional, but running it first keeps the review and contribution flow aligned.", "검증은 선택 사항이지만, 먼저 실행하면 검토와 기여 흐름을 더 잘 맞출 수 있습니다.")}</p>
        ) : null}
        {!canRunValidation ? (
          <p>{pick(locale, "Viewer accounts cannot run validation or local contribution jobs.", "뷰어 계정은 검증이나 로컬 기여 작업을 실행할 수 없습니다.")}</p>
        ) : null}
        {contributionResult ? (
          <div className="panel-stack">
            <div className="panel-metric-grid">
              <div>
                <strong>{contributionResult.stats.user_contributions}</strong>
                <span>{pick(locale, "my contributions", "내 기여 수")}</span>
              </div>
              <div>
                <strong>{contributionResult.stats.total_contributions}</strong>
                <span>{pick(locale, "global contributions", "전체 기여 수")}</span>
              </div>
              <div>
                <strong>{contributionResult.stats.user_contribution_pct}%</strong>
                <span>{pick(locale, "my share", "내 비중")}</span>
              </div>
              <div>
                <strong>{contributionResult.execution_device}</strong>
                <span>{pick(locale, "device", "디바이스")}</span>
              </div>
            </div>
            <p>
              {pick(
                locale,
                `Update ${contributionResult.update.update_id} is queued as a ${contributionResult.update.upload_type} against ${contributionResult.model_version.version_name}.`,
                `업데이트 ${contributionResult.update.update_id}가 ${contributionResult.model_version.version_name}에 대한 ${contributionResult.update.upload_type} 형태로 대기열에 올라갔습니다.`
              )}
            </p>
          </div>
        ) : (
          <p>{pick(locale, "Contribution trains locally and stores only the weight delta for later upload.", "기여는 로컬 학습을 수행하고 나중에 업로드할 weight delta만 저장합니다.")}</p>
        )}
      </section>

      <section className="panel-card">
        <div className="panel-card-head">
          <strong>{pick(locale, "Case history", "케이스 이력")}</strong>
          <span>
            {historyBusy
              ? pick(locale, "Refreshing...", "새로고침 중...")
              : `${caseHistory?.validations.length ?? 0} ${pick(locale, "validations", "검증")} / ${caseHistory?.contributions.length ?? 0} ${pick(locale, "contributions", "기여")}`}
          </span>
        </div>
        <div className="panel-stack">
          <div>
            <div className="doc-section-label">{pick(locale, "Validations", "검증")}</div>
            <div className="panel-history-list">
              {caseHistory?.validations.length ? (
                caseHistory.validations.map((item) => (
                  <div key={item.validation_id} className="panel-history-item">
                    <strong>{item.model_version}</strong>
                    <div className="panel-meta">
                      <span>{item.run_scope}</span>
                      <span>{item.run_date}</span>
                    </div>
                    <div className="panel-meta">
                      <span>{item.predicted_label}</span>
                      <span>{formatProbability(item.prediction_probability, notAvailableLabel)}</span>
                      <span>{item.is_correct ? pick(locale, "match", "일치") : pick(locale, "mismatch", "불일치")}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty-surface">{pick(locale, "No validation history for this case yet.", "이 케이스에는 아직 검증 이력이 없습니다.")}</div>
              )}
            </div>
          </div>
          <div>
            <div className="doc-section-label">{pick(locale, "Contributions", "기여")}</div>
            <div className="panel-history-list">
              {caseHistory?.contributions.length ? (
                caseHistory.contributions.map((item) => (
                  <div key={item.contribution_id} className="panel-history-item">
                    <strong>{item.update_id}</strong>
                    <div className="panel-meta">
                      <span>{item.upload_type ?? pick(locale, "weight delta", "weight delta")}</span>
                      <span>{item.execution_device ?? pick(locale, "unknown device", "알 수 없는 디바이스")}</span>
                    </div>
                    <div className="panel-meta">
                      <span>{item.update_status ?? pick(locale, "unknown status", "알 수 없는 상태")}</span>
                      <span>{item.created_at}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty-surface">{pick(locale, "No contribution history for this case yet.", "이 케이스에는 아직 기여 이력이 없습니다.")}</div>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
