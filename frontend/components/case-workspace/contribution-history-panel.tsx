"use client";

import type { ReactNode } from "react";

import type { CaseContributionResponse, CaseHistoryResponse, CaseSummaryRecord, ContributionLeaderboard } from "../../lib/api";
import { pick, translateOption, type Locale } from "../../lib/i18n";
import { formatPublicAlias } from "../../lib/public-alias";
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
  researchRegistryEnabled: boolean;
  researchRegistryUserEnrolled: boolean;
  researchRegistryBusy: boolean;
  contributionBusy: boolean;
  contributionResult: CaseContributionResponse | null;
  currentUserPublicAlias: string | null;
  contributionLeaderboard: ContributionLeaderboard | null;
  historyBusy: boolean;
  caseHistory: CaseHistoryResponse | null;
  onJoinResearchRegistry: () => void;
  onIncludeResearchCase: () => void;
  onExcludeResearchCase: () => void;
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
  researchRegistryEnabled,
  researchRegistryUserEnrolled,
  researchRegistryBusy,
  contributionBusy,
  contributionResult,
  currentUserPublicAlias,
  contributionLeaderboard,
  historyBusy,
  caseHistory,
  onJoinResearchRegistry,
  onIncludeResearchCase,
  onExcludeResearchCase,
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
  const anonymousLabel = pick(locale, "Anonymous member", "익명 참여자");
  const leaderboardEntries = contributionLeaderboard?.leaderboard ?? [];
  const currentLeaderboardEntry = contributionLeaderboard?.current_user ?? null;
  const resolvedCurrentUserAlias = formatPublicAlias(
    currentUserPublicAlias ?? contributionResult?.stats.user_public_alias ?? currentLeaderboardEntry?.public_alias ?? null,
    locale
  );
  const resolvedCurrentUserRank = contributionResult?.stats.user_rank ?? currentLeaderboardEntry?.rank ?? null;
  const representativeViewLabel = selectedCase.representative_view
    ? translateOption(locale, "view", selectedCase.representative_view)
    : notAvailableLabel;
  const organismModeLabel = selectedCase.polymicrobial
    ? pick(locale, "Polymicrobial", "다균종")
    : pick(locale, "Single organism", "단일 균종");
  const researchRegistryStatus = selectedCase.research_registry_status ?? "analysis_only";
  const researchRegistryStatusLabel =
    {
      analysis_only: pick(locale, "Analysis only", "분석 전용"),
      candidate: pick(locale, "Candidate", "후보"),
      included: pick(locale, "Included", "포함됨"),
      excluded: pick(locale, "Excluded", "제외됨"),
    }[researchRegistryStatus] ?? pick(locale, "Analysis only", "분석 전용");

  return (
    <>
      {completionContent}

      <Card as="section" variant="panel" className={`grid gap-4 p-5 ${contributionPanelClass}`}>
        <SectionHeader
          eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Research registry", "연구 레지스트리")}</div>}
          title={pick(locale, "Control automatic dataset inclusion", "자동 데이터셋 포함 제어")}
          titleAs="h4"
          description={pick(
            locale,
            "Validation remains free. Once you join the registry, eligible cases can be included automatically and each case can still be excluded here.",
            "검증은 무료로 유지됩니다. 한 번 레지스트리에 가입하면 적격 케이스가 자동 포함될 수 있고, 각 케이스는 여기서 계속 제외할 수 있습니다."
          )}
        />

        <div className={docBadgeRowClass}>
          <span className={docSiteBadgeClass}>{`${pick(locale, "Site", "기관")} / ${
            researchRegistryEnabled ? pick(locale, "Enabled", "사용 중") : pick(locale, "Disabled", "비활성")
          }`}</span>
          <span className={docSiteBadgeClass}>{`${pick(locale, "Me", "내 상태")} / ${
            researchRegistryUserEnrolled ? pick(locale, "Joined", "가입 완료") : pick(locale, "Not joined", "미가입")
          }`}</span>
          <span className={docSiteBadgeClass}>{`${pick(locale, "Case", "케이스")} / ${researchRegistryStatusLabel}`}</span>
        </div>

        <Card as="div" variant="nested" className={contributionStatusCardClass}>
          <p className="m-0 text-sm leading-6 text-muted">
            {researchRegistryStatus === "included"
              ? pick(
                  locale,
                  "This case is currently included in the site's research dataset flow.",
                  "이 케이스는 현재 기관 연구 데이터셋 흐름에 포함되어 있습니다."
                )
              : researchRegistryStatus === "excluded"
                ? pick(
                    locale,
                    "This case is excluded from the research dataset until you include it again.",
                    "이 케이스는 다시 포함하기 전까지 연구 데이터셋에서 제외되어 있습니다."
                  )
                : pick(
                    locale,
                    "Join the registry once, then keep each case included or excluded explicitly from this panel.",
                    "한 번 레지스트리에 가입한 뒤, 각 케이스를 이 패널에서 명시적으로 포함하거나 제외할 수 있습니다."
                  )}
          </p>
        </Card>

        <div className="flex flex-wrap gap-2">
          {!researchRegistryUserEnrolled ? (
            <Button type="button" variant="primary" size="sm" onClick={onJoinResearchRegistry} disabled={researchRegistryBusy || !researchRegistryEnabled}>
              {researchRegistryBusy ? pick(locale, "Joining...", "가입 중...") : pick(locale, "Join research registry", "연구 레지스트리 가입")}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onIncludeResearchCase}
            disabled={researchRegistryBusy || !researchRegistryEnabled || !researchRegistryUserEnrolled || researchRegistryStatus === "included"}
          >
            {researchRegistryBusy ? pick(locale, "Updating...", "업데이트 중...") : pick(locale, "Include this case", "이 케이스 포함")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onExcludeResearchCase}
            disabled={researchRegistryBusy || researchRegistryStatus === "excluded"}
          >
            {researchRegistryBusy ? pick(locale, "Updating...", "업데이트 중...") : pick(locale, "Exclude this case", "이 케이스 제외")}
          </Button>
        </div>
      </Card>

      <Card as="section" variant="panel" className={`grid gap-4 p-5 ${contributionPanelClass}`}>
        <SectionHeader
          eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Contribution", "기여")}</div>}
          title={pick(locale, "Prepare a local contribution update", "로컬 기여 업데이트 준비")}
          titleAs="h4"
          description={pick(
            locale,
            "One click can fan out into multiple local model updates and store their weight deltas for the shared workflow.",
            "한 번의 클릭으로 여러 로컬 모델 업데이트를 fan-out 실행하고, 공유 모델 흐름에 올릴 weight delta들을 저장합니다."
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
              <MetricItem value={contributionResult.update_count} label={pick(locale, "queued updates", "생성된 업데이트")} />
              <MetricItem value={contributionResult.stats.user_contributions} label={pick(locale, "my contributions", "내 기여 수")} />
              <MetricItem value={contributionResult.stats.total_contributions} label={pick(locale, "global contributions", "전체 기여 수")} />
              <MetricItem value={`${contributionResult.stats.user_contribution_pct}%`} label={pick(locale, "my share", "내 비중")} />
              <MetricItem value={contributionResult.execution_device} label={pick(locale, "device", "디바이스")} />
            </MetricGrid>
            <Card as="div" variant="nested" className={contributionStatusCardClass}>
              <p className="m-0 text-sm leading-6 text-muted">
                {contributionResult.update_count > 1
                  ? pick(
                      locale,
                      `${contributionResult.update_count} updates are queued from this one-click contribution. The first update is ${contributionResult.update.update_id}.`,
                      `한 번의 기여로 ${contributionResult.update_count}개 업데이트가 대기열에 올랐습니다. 첫 update는 ${contributionResult.update.update_id}입니다.`
                    )
                  : pick(
                      locale,
                      `Update ${contributionResult.update.update_id} is queued as a ${contributionResult.update.upload_type} against ${contributionResult.model_version.version_name}.`,
                      `업데이트 ${contributionResult.update.update_id}가 ${contributionResult.model_version.version_name} 기준 ${contributionResult.update.upload_type} 형태로 대기열에 추가되었습니다.`
                    )}
              </p>
            </Card>
            <div className={docBadgeRowClass}>
              {contributionResult.contribution_group_id ? (
                <span className={docSiteBadgeClass}>{`${pick(locale, "Group", "그룹")} · ${contributionResult.contribution_group_id}`}</span>
              ) : null}
              {contributionResult.updates.map((item) => (
                <span key={item.update_id} className={docSiteBadgeClass}>
                  {`${item.architecture} · ${item.update_id}`}
                </span>
              ))}
            </div>
            {contributionResult.failures?.length ? (
              <Card as="div" variant="nested" className={contributionStatusCardClass}>
                <div className="grid gap-2">
                  {contributionResult.failures.map((item) => (
                    <p key={`${item.model_version_id ?? item.architecture ?? "failed"}-${item.error}`} className="m-0 text-sm leading-6 text-muted">
                      {pick(locale, "Failed", "실패")} {item.version_name ?? item.architecture ?? notAvailableLabel}: {item.error}
                    </p>
                  ))}
                </div>
              </Card>
            ) : null}
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

        <Card as="div" variant="nested" className={contributionStatusCardClass}>
          <div className="grid gap-3">
            <div className={docBadgeRowClass}>
              <span className={docSiteBadgeClass}>{`${pick(locale, "Public alias", "공개 별칭")} / ${resolvedCurrentUserAlias ?? anonymousLabel}`}</span>
              {resolvedCurrentUserRank ? <span className={docSiteBadgeClass}>{`${pick(locale, "Rank", "순위")} / #${resolvedCurrentUserRank}`}</span> : null}
            </div>
            <p className="m-0 text-sm leading-6 text-muted">
              {pick(
                locale,
                "Contribution ranking keeps identities hidden and uses a stable alias instead.",
                "기여 랭킹은 실명 대신 고정된 공개 별칭만 사용합니다."
              )}
            </p>
            {leaderboardEntries.length ? (
              <div className="grid gap-2">
                {leaderboardEntries.map((entry) => (
                  <div
                    key={`${entry.user_id}-${entry.rank}`}
                    className={`flex items-center justify-between gap-3 rounded-[1rem] border px-3 py-2 ${
                      entry.is_current_user
                        ? "border-[rgba(15,23,42,0.18)] bg-white"
                        : "border-[rgba(15,23,42,0.08)] bg-[rgba(255,255,255,0.68)]"
                    }`}
                  >
                    <div className="grid gap-0.5">
                      <strong className="text-sm leading-6 text-ink">{`#${entry.rank} ${formatPublicAlias(entry.public_alias, locale) ?? anonymousLabel}`}</strong>
                      <span className="text-xs leading-5 text-muted">
                        {entry.is_current_user ? pick(locale, "You", "나") : pick(locale, "Contributor", "기여자")}
                      </span>
                    </div>
                    <div className="text-right">
                      <strong className="text-sm leading-6 text-ink">{entry.contribution_count}</strong>
                      <span className="block text-xs leading-5 text-muted">{pick(locale, "contributions", "기여")}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="m-0 text-sm leading-6 text-muted">
                {pick(
                  locale,
                  "The anonymous leaderboard appears after the first contribution is recorded.",
                  "첫 기여가 기록되면 익명 랭킹이 여기에 나타납니다."
                )}
              </p>
            )}
          </div>
        </Card>
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
                      <span>{formatPublicAlias(item.public_alias, locale) ?? anonymousLabel}</span>
                      <span>{item.execution_device ?? pick(locale, "unknown device", "알 수 없는 디바이스")}</span>
                    </div>
                    <div className={historyEntryMetaClass}>
                      <span>{item.upload_type ?? pick(locale, "weight delta", "weight delta")}</span>
                      <span>{item.update_status ?? pick(locale, "unknown status", "알 수 없는 상태")}</span>
                    </div>
                    <div className={historyEntryMetaClass}>
                      <span>{item.architecture ?? notAvailableLabel}</span>
                      {item.contribution_group_id ? <span>{item.contribution_group_id}</span> : null}
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
