"use client";

import type { Dispatch, SetStateAction } from "react";

import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Field } from "../ui/field";
import { MetricGrid, MetricItem } from "../ui/metric-grid";
import { SectionHeader } from "../ui/section-header";
import { docSectionLabelClass, docSiteBadgeClass, emptySurfaceClass } from "../ui/workspace-patterns";
import type {
  AggregationRecord,
  AuditEventRecord,
  FederationMonitoringSummaryResponse,
  ModelUpdateRecord,
  ModelVersionRecord,
  ReleaseRolloutRecord,
} from "../../lib/api";
import { pick, type Locale } from "../../lib/i18n";
import type { ReleaseRolloutFormState, UpdateThresholdAlert } from "./use-admin-workspace-state";

type AggregationLane = {
  lane_key: string;
  architecture: string;
  base_model_version_id: string;
  total_cases: number;
  update_count: number;
  site_count: number;
  duplicate_site_count: number;
  update_ids: string[];
};

type Props = {
  locale: Locale;
  notAvailableLabel: string;
  approvedUpdates: ModelUpdateRecord[];
  updateThresholdAlerts: UpdateThresholdAlert[];
  aggregations: AggregationRecord[];
  federationStatusBusy: boolean;
  federationMonitoring: FederationMonitoringSummaryResponse | null;
  federationMonitoringBusy: boolean;
  recentAuditEvents: AuditEventRecord[];
  modelVersions: ModelVersionRecord[];
  releaseRollouts: ReleaseRolloutRecord[];
  releaseRolloutBusy: boolean;
  releaseRolloutForm: ReleaseRolloutFormState;
  selectedSiteId: string | null;
  newVersionName: string;
  aggregationBusy: boolean;
  setReleaseRolloutForm: Dispatch<SetStateAction<ReleaseRolloutFormState>>;
  setNewVersionName: Dispatch<SetStateAction<string>>;
  formatDateTime: (value: string | null | undefined, emptyLabel?: string) => string;
  onAggregation: (updateIds: string[]) => void;
  onAggregationAllReady: () => void;
  onCreateReleaseRollout: () => void;
  onRefreshFederationStatus: () => void;
};

function buildAggregationLanes(approvedUpdates: ModelUpdateRecord[]): AggregationLane[] {
  const groups = new Map<
    string,
    {
      architecture: string;
      base_model_version_id: string;
      total_cases: number;
      update_count: number;
      sites: Set<string>;
      site_counts: Map<string, number>;
      update_ids: string[];
    }
  >();

  for (const item of approvedUpdates) {
    const architecture = String(item.architecture ?? "").trim();
    const baseModelVersionId = String(item.base_model_version_id ?? "").trim();
    const updateId = String(item.update_id ?? "").trim();
    if (!architecture || !baseModelVersionId || !updateId) {
      continue;
    }
    const laneKey = `${architecture}:${baseModelVersionId}`;
    const lane = groups.get(laneKey) ?? {
      architecture,
      base_model_version_id: baseModelVersionId,
      total_cases: 0,
      update_count: 0,
      sites: new Set<string>(),
      site_counts: new Map<string, number>(),
      update_ids: [],
    };
    const siteId = String(item.site_id ?? "").trim() || "unknown";
    const nCases = Math.max(1, Number(item.n_cases ?? 1) || 1);
    lane.total_cases += nCases;
    lane.update_count += 1;
    lane.sites.add(siteId);
    lane.site_counts.set(siteId, (lane.site_counts.get(siteId) ?? 0) + 1);
    lane.update_ids.push(updateId);
    groups.set(laneKey, lane);
  }

  return Array.from(groups.entries())
    .map(([laneKey, lane]) => ({
      lane_key: laneKey,
      architecture: lane.architecture,
      base_model_version_id: lane.base_model_version_id,
      total_cases: lane.total_cases,
      update_count: lane.update_count,
      site_count: lane.sites.size,
      duplicate_site_count: Array.from(lane.site_counts.values()).filter((count) => count > 1).length,
      update_ids: lane.update_ids,
    }))
    .sort((left, right) => right.total_cases - left.total_cases || right.update_count - left.update_count);
}

export function FederationSection({
  locale,
  notAvailableLabel,
  approvedUpdates,
  updateThresholdAlerts,
  aggregations,
  federationStatusBusy,
  federationMonitoring,
  federationMonitoringBusy,
  recentAuditEvents,
  modelVersions,
  releaseRollouts,
  releaseRolloutBusy,
  releaseRolloutForm,
  selectedSiteId,
  newVersionName,
  aggregationBusy,
  setReleaseRolloutForm,
  setNewVersionName,
  formatDateTime,
  onAggregation,
  onAggregationAllReady,
  onCreateReleaseRollout,
  onRefreshFederationStatus,
}: Props) {
  const aggregationLanes = buildAggregationLanes(approvedUpdates);
  const readyAggregationLanes = aggregationLanes.filter((lane) => lane.duplicate_site_count === 0);
  const readyModelVersions = modelVersions.filter((item) => item.ready);

  return (
    <Card as="section" variant="surface" className="grid gap-5 p-6">
      <SectionHeader
        eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Federation", "연합학습")}</div>}
        title={pick(locale, "Global aggregation, rollout, and monitoring", "글로벌 집계, rollout, 모니터링")}
        titleAs="h3"
        description={pick(
          locale,
          "Review approved update lanes, create staged release rollout plans, and monitor node adoption from one global operations surface.",
          "승인된 업데이트 lane을 검토하고 staged release rollout을 만들며 node adoption을 한 화면에서 모니터링합니다."
        )}
        aside={<span className={docSiteBadgeClass}>{`${approvedUpdates.length} ${pick(locale, "approved", "승인")}`}</span>}
      />

      <Card as="section" variant="nested" className="grid gap-4 p-5">
        <SectionHeader
          title={pick(locale, "Release rollout", "릴리스 rollout")}
          titleAs="h4"
          description={pick(
            locale,
            "Create pilot, partial, full, or rollback release plans from approved global model versions.",
            "승인된 글로벌 모델 버전에서 pilot, partial, full, rollback rollout 계획을 만듭니다."
          )}
          aside={
            <div className="flex flex-wrap items-center gap-2">
              <span className={docSiteBadgeClass}>{releaseRollouts.length}</span>
              <Button type="button" variant="ghost" size="sm" disabled={federationStatusBusy} onClick={onRefreshFederationStatus}>
                {federationStatusBusy ? pick(locale, "Refreshing...", "새로고침 중...") : pick(locale, "Refresh", "새로고침")}
              </Button>
            </div>
          }
        />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <div className="grid gap-4">
            <Field label={pick(locale, "Target model version", "대상 모델 버전")}>
              <select
                value={releaseRolloutForm.version_id}
                onChange={(event) =>
                  setReleaseRolloutForm((current) => ({
                    ...current,
                    version_id: event.target.value,
                  }))
                }
              >
                <option value="">{pick(locale, "Select a ready model", "준비된 모델 선택")}</option>
                {readyModelVersions.map((item) => (
                  <option key={item.version_id} value={item.version_id}>
                    {`${item.version_name} / ${item.architecture}`}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={pick(locale, "Rollout stage", "rollout 단계")}>
                <select
                  value={releaseRolloutForm.stage}
                  onChange={(event) =>
                    setReleaseRolloutForm((current) => ({
                      ...current,
                      stage: event.target.value as ReleaseRolloutFormState["stage"],
                    }))
                  }
                >
                  <option value="pilot">{pick(locale, "Pilot", "Pilot")}</option>
                  <option value="partial">{pick(locale, "Partial", "Partial")}</option>
                  <option value="full">{pick(locale, "Full", "Full")}</option>
                  <option value="rollback">{pick(locale, "Rollback", "Rollback")}</option>
                </select>
              </Field>
              <Field label={pick(locale, "Target hospitals", "대상 병원")}>
                <input
                  value={releaseRolloutForm.target_site_ids_text}
                  onChange={(event) =>
                    setReleaseRolloutForm((current) => ({
                      ...current,
                      target_site_ids_text: event.target.value,
                    }))
                  }
                  placeholder={selectedSiteId ?? "SITE_A,SITE_B"}
                />
              </Field>
            </div>
            <Field label={pick(locale, "Operator note", "운영 메모")}>
              <textarea
                rows={3}
                value={releaseRolloutForm.notes}
                onChange={(event) =>
                  setReleaseRolloutForm((current) => ({
                    ...current,
                    notes: event.target.value,
                  }))
                }
              />
            </Field>
            <div className="text-sm leading-6 text-muted">
              {pick(
                locale,
                "Pilot and partial rollout require comma-separated site IDs. Full rollout promotes the selected version as the current global release. Rollback uses the selected version as the recovery target.",
                "pilot/partial rollout은 쉼표로 구분한 site ID가 필요합니다. full rollout은 선택한 버전을 현재 글로벌 릴리스로 승격하고, rollback은 선택한 버전을 복구 대상으로 사용합니다."
              )}
            </div>
            <div className="flex flex-wrap justify-end gap-3">
              <Button type="button" variant="primary" disabled={releaseRolloutBusy} onClick={onCreateReleaseRollout}>
                {releaseRolloutBusy
                  ? pick(locale, "Saving rollout...", "rollout 저장 중...")
                  : pick(locale, "Save rollout plan", "rollout 계획 저장")}
              </Button>
            </div>
          </div>

          <Card as="div" variant="nested" className="grid gap-3 border border-border/80 p-4">
            <SectionHeader
              title={pick(locale, "Recent rollout history", "최근 rollout 이력")}
              titleAs="h4"
              aside={<span className={docSiteBadgeClass}>{releaseRollouts.length}</span>}
            />
            {releaseRollouts.length === 0 ? (
              <div className={emptySurfaceClass}>
                {pick(locale, "No rollout history is recorded yet.", "아직 기록된 rollout 이력이 없습니다.")}
              </div>
            ) : (
              <div className="grid gap-3">
                {releaseRollouts.slice(0, 6).map((item) => (
                  <Card key={item.rollout_id} as="article" variant="nested" className="grid gap-2 border border-border/80 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong className="text-sm text-ink">{item.version_name}</strong>
                      <span className={docSiteBadgeClass}>{`${item.stage} / ${item.status}`}</span>
                    </div>
                    <div className="text-xs leading-5 text-muted">{item.architecture}</div>
                    <div className="text-xs leading-5 text-muted">{formatDateTime(item.created_at, notAvailableLabel)}</div>
                    {item.target_site_ids.length > 0 ? (
                      <div className="text-xs leading-5 text-muted">{item.target_site_ids.join(", ")}</div>
                    ) : null}
                  </Card>
                ))}
              </div>
            )}
          </Card>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card as="section" variant="nested" className="grid gap-4 p-5">
          <SectionHeader
            title={pick(locale, "Release rollout monitor", "릴리스 rollout 모니터")}
            titleAs="h4"
            description={pick(
              locale,
              "Watch the current release, active staged rollout, and node-level alignment against the expected version.",
              "현재 릴리스, 활성 staged rollout, 기대 버전 대비 노드 정렬 상태를 함께 확인합니다."
            )}
            aside={<span className={docSiteBadgeClass}>{readyModelVersions.length}</span>}
          />
          {federationMonitoringBusy ? (
            <div className={emptySurfaceClass}>{pick(locale, "Loading monitoring summary...", "모니터링 요약을 불러오는 중...")}</div>
          ) : federationMonitoring ? (
            <div className="grid gap-4">
              <MetricGrid columns={4}>
                <MetricItem value={federationMonitoring.current_release?.version_name ?? notAvailableLabel} label={pick(locale, "Current release", "현재 릴리스")} />
                <MetricItem value={String(federationMonitoring.node_summary.total_nodes)} label={pick(locale, "Nodes", "노드")} />
                <MetricItem value={String(federationMonitoring.node_summary.aligned_nodes)} label={pick(locale, "Aligned", "정렬")} />
                <MetricItem value={String(federationMonitoring.node_summary.lagging_nodes)} label={pick(locale, "Lagging", "지연")} />
              </MetricGrid>
              <Card as="article" variant="nested" className="grid gap-3 border border-border/80 p-4">
                <SectionHeader
                  title={
                    federationMonitoring.active_rollout?.version_name ??
                    pick(locale, "No active staged rollout", "활성 staged rollout 없음")
                  }
                  titleAs="h4"
                  description={
                    federationMonitoring.active_rollout
                      ? `${federationMonitoring.active_rollout.stage} / ${federationMonitoring.active_rollout.architecture}`
                      : pick(locale, "The current release is serving as the only active model target.", "현재 릴리스만 활성 모델 대상으로 사용 중입니다.")
                  }
                  aside={
                    <span className={docSiteBadgeClass}>
                      {federationMonitoring.active_rollout?.status ?? pick(locale, "steady", "안정")}
                    </span>
                  }
                />
                {federationMonitoring.active_rollout?.target_site_ids?.length ? (
                  <div className="text-sm leading-6 text-muted">{federationMonitoring.active_rollout.target_site_ids.join(", ")}</div>
                ) : null}
                {federationMonitoring.site_adoption.length === 0 ? (
                  <div className={emptySurfaceClass}>
                    {pick(locale, "No site adoption record is available yet.", "아직 site adoption 기록이 없습니다.")}
                  </div>
                ) : (
                  <div className="grid gap-3">
                    {federationMonitoring.site_adoption.slice(0, 4).map((site) => (
                      <Card key={site.site_id} as="div" variant="nested" className="grid gap-2 border border-border/80 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <strong className="text-sm text-ink">{site.site_display_name}</strong>
                          <span className={docSiteBadgeClass}>{`${site.aligned_node_count}/${site.active_node_count}`}</span>
                        </div>
                        <MetricGrid columns={4}>
                          <MetricItem value={String(site.node_count)} label={pick(locale, "Nodes", "노드")} />
                          <MetricItem value={String(site.lagging_node_count)} label={pick(locale, "Lagging", "지연")} />
                          <MetricItem value={site.expected_version_name ?? notAvailableLabel} label={pick(locale, "Expected", "기대 버전")} />
                          <MetricItem value={formatDateTime(site.last_seen_at, notAvailableLabel)} label={pick(locale, "Last seen", "최근 신호")} />
                        </MetricGrid>
                      </Card>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          ) : (
            <div className={emptySurfaceClass}>
              {pick(locale, "Monitoring summary is not available yet.", "모니터링 요약이 아직 없습니다.")}
            </div>
          )}
        </Card>

        <Card as="section" variant="nested" className="grid gap-4 p-5">
          <SectionHeader
            title={pick(locale, "Recent audit trail", "최근 감사 로그")}
            titleAs="h4"
            aside={<span className={docSiteBadgeClass}>{recentAuditEvents.length}</span>}
          />
          {recentAuditEvents.length === 0 ? (
            <div className={emptySurfaceClass}>
              {pick(locale, "No recent control-plane audit event is available.", "최근 control-plane 감사 이벤트가 없습니다.")}
            </div>
          ) : (
            <div className="grid gap-3">
              {recentAuditEvents.slice(0, 6).map((item) => (
                <Card key={item.event_id} as="article" variant="nested" className="grid gap-2 border border-border/80 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-sm text-ink">{item.action}</strong>
                    <span className={docSiteBadgeClass}>{formatDateTime(item.created_at, notAvailableLabel)}</span>
                  </div>
                  <div className="text-xs leading-5 text-muted">
                    {`${item.actor_type}${item.actor_id ? ` / ${item.actor_id}` : ""} -> ${item.target_type}${item.target_id ? ` / ${item.target_id}` : ""}`}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </Card>
      </div>

      {updateThresholdAlerts.length > 0 ? (
        <Card as="section" variant="nested" className="grid gap-4 border border-amber-300/80 bg-amber-50/80 p-5 dark:border-amber-500/40 dark:bg-amber-500/10">
          <SectionHeader
            title={pick(locale, "Contribution threshold alerts", "기여 임계치 알림")}
            titleAs="h4"
            description={pick(
              locale,
              "The admin queue has enough contributed cases to start review or aggregation on specific architecture lanes.",
              "관리자 큐에 특정 아키텍처 lane의 검토 또는 집계를 시작할 만큼 기여 케이스가 모였습니다."
            )}
          />
          <div className="grid gap-3">
            {updateThresholdAlerts.map((alert) => (
              <Card key={`${alert.scope}:${alert.architecture}:${alert.base_model_version_id}`} as="article" variant="nested" className="grid gap-3 border border-border/80 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-sm text-ink">
                    {alert.scope === "aggregation_ready"
                      ? pick(locale, "Ready for aggregation", "집계 준비 완료")
                      : alert.scope === "aggregation_blocked"
                        ? pick(locale, "Aggregation blocked", "집계 보류")
                        : pick(locale, "Needs review", "검토 필요")}
                  </strong>
                  <span className={docSiteBadgeClass}>{alert.architecture}</span>
                </div>
                <p className="m-0 text-sm leading-6 text-muted">
                  {alert.scope === "aggregation_ready"
                    ? pick(
                        locale,
                        `${alert.total_cases} contributed cases across ${alert.site_count} hospital(s) are approved and ready for the next FedAvg run.`,
                        `${alert.site_count}개 병원에서 모인 ${alert.total_cases}개 기여 케이스가 승인되어 다음 FedAvg 집계를 바로 실행할 수 있습니다.`
                      )
                    : alert.scope === "aggregation_blocked"
                      ? pick(
                          locale,
                          `${alert.total_cases} approved cases are available, but ${alert.duplicate_site_count} hospital lane(s) have duplicate updates that must be resolved before aggregation.`,
                          `${alert.total_cases}개 승인 케이스가 모였지만 ${alert.duplicate_site_count}개 병원 lane에 중복 업데이트가 있어 집계 전에 정리가 필요합니다.`
                        )
                      : pick(
                          locale,
                          `${alert.total_cases} contributed cases are waiting in the review queue for this architecture lane.`,
                          `이 아키텍처 lane에는 ${alert.total_cases}개 기여 케이스가 검토 대기 중입니다.`
                        )}
                </p>
                <MetricGrid columns={3}>
                  <MetricItem value={alert.total_cases} label={pick(locale, "Cases", "케이스")} />
                  <MetricItem value={alert.site_count} label={pick(locale, "Hospitals", "병원")} />
                  <MetricItem value={alert.update_count} label={pick(locale, "Updates", "업데이트")} />
                </MetricGrid>
              </Card>
            ))}
          </div>
        </Card>
      ) : null}

      <Card as="div" variant="nested" className="grid gap-4 p-5">
        <SectionHeader
          title={pick(locale, "Aggregation launch", "집계 실행")}
          titleAs="h4"
          description={pick(
            locale,
            "Select one architecture lane at a time. Each lane must share the same architecture, base model, and at most one approved update per hospital.",
            "한 번에 하나의 아키텍처 lane만 집계하세요. 각 lane은 같은 아키텍처, 같은 기준 모델, 그리고 병원당 최대 1개의 승인 update만 포함해야 합니다."
          )}
        />
        <Field label={pick(locale, "Optional version name", "선택 버전 이름")}>
          <input
            value={newVersionName}
            onChange={(event) => setNewVersionName(event.target.value)}
            placeholder="global-densenet-fedavg-20260311"
          />
        </Field>
        <div className="text-sm leading-6 text-muted">
          {pick(
            locale,
            "Use a descriptive version name only when you need a human-readable checkpoint in the registry.",
            "레지스트리에서 사람이 바로 읽을 수 있는 체크포인트가 필요할 때만 설명형 버전 이름을 사용하세요."
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-3">
          <Button
            type="button"
            variant="primary"
            disabled={aggregationBusy || readyAggregationLanes.length === 0}
            onClick={onAggregationAllReady}
          >
            {aggregationBusy
              ? pick(locale, "Aggregating...", "집계 중...")
              : pick(
                  locale,
                  `Aggregate all ready lanes (${readyAggregationLanes.length})`,
                  `집계 가능한 lane 일괄 실행 (${readyAggregationLanes.length})`
                )}
          </Button>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card as="section" variant="nested" className="grid gap-4 p-5">
          <SectionHeader
            title={pick(locale, "Aggregation lanes", "집계 lane")}
            titleAs="h4"
            aside={<span className={docSiteBadgeClass}>{aggregationLanes.length}</span>}
          />
          {aggregationLanes.length === 0 ? (
            <div className={emptySurfaceClass}>
              {pick(locale, "No approved updates are available for aggregation.", "집계 가능한 승인 업데이트가 없습니다.")}
            </div>
          ) : (
            <div className="grid gap-3">
              {aggregationLanes.map((lane) => (
                <Card key={lane.lane_key} as="article" variant="nested" className="grid gap-3 border border-border/80 p-4">
                  <SectionHeader
                    title={lane.architecture}
                    titleAs="h4"
                    description={lane.base_model_version_id}
                    aside={
                      <Button
                        type="button"
                        size="sm"
                        variant="primary"
                        aria-label={pick(locale, `Aggregate ${lane.architecture} lane`, `${lane.architecture} lane 집계`)}
                        disabled={aggregationBusy || lane.duplicate_site_count > 0}
                        onClick={() => onAggregation(lane.update_ids)}
                      >
                        {aggregationBusy
                          ? pick(locale, "Aggregating...", "집계 중...")
                          : pick(locale, "Aggregate this lane", "이 lane 집계")}
                      </Button>
                    }
                  />
                  <MetricGrid columns={3}>
                    <MetricItem value={lane.total_cases} label={pick(locale, "Cases", "케이스")} />
                    <MetricItem value={lane.site_count} label={pick(locale, "Hospitals", "병원")} />
                    <MetricItem value={lane.update_count} label={pick(locale, "Updates", "업데이트")} />
                  </MetricGrid>
                  <p className="m-0 text-sm leading-6 text-muted">
                    {lane.duplicate_site_count > 0
                      ? pick(
                          locale,
                          `${lane.duplicate_site_count} hospital(s) have duplicate approved updates in this lane. Resolve duplicates before running aggregation.`,
                          `이 lane에는 ${lane.duplicate_site_count}개 병원의 중복 승인 update가 있어 집계 전에 정리가 필요합니다.`
                        )
                      : pick(
                          locale,
                          "This lane is compatible with the current FedAvg constraints and can be aggregated independently.",
                          "이 lane은 현재 FedAvg 제약과 호환되며 독립적으로 집계할 수 있습니다."
                        )}
                  </p>
                </Card>
              ))}
            </div>
          )}
        </Card>

        <Card as="section" variant="nested" className="grid gap-4 p-5">
          <SectionHeader
            title={pick(locale, "Aggregation history", "집계 이력")}
            titleAs="h4"
            aside={<span className={docSiteBadgeClass}>{aggregations.length}</span>}
          />
          {aggregations.length === 0 ? (
            <div className={emptySurfaceClass}>
              {pick(locale, "No aggregation record has been registered yet.", "아직 등록된 집계 기록이 없습니다.")}
            </div>
          ) : (
            <div className="grid gap-3">
              {aggregations.map((item) => (
                <Card key={item.aggregation_id} as="article" variant="nested" className="grid gap-3 border border-border/80 p-4">
                  <SectionHeader
                    title={item.new_version_name}
                    titleAs="h4"
                    description={formatDateTime(item.created_at, notAvailableLabel)}
                  />
                  <MetricGrid columns={3}>
                    <MetricItem value={item.architecture ?? notAvailableLabel} label={pick(locale, "Architecture", "아키텍처")} />
                    <MetricItem value={String(item.total_cases ?? 0)} label={pick(locale, "Cases", "케이스")} />
                    <MetricItem value={String(Object.keys(item.site_weights ?? {}).length)} label={pick(locale, "Hospitals", "병원")} />
                  </MetricGrid>
                </Card>
              ))}
            </div>
          )}
        </Card>
      </div>
    </Card>
  );
}
