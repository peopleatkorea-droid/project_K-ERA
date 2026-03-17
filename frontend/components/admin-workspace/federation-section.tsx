"use client";

import type { Dispatch, SetStateAction } from "react";

import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Field } from "../ui/field";
import { MetricGrid, MetricItem } from "../ui/metric-grid";
import { SectionHeader } from "../ui/section-header";
import { docSectionLabelClass, docSiteBadgeClass, emptySurfaceClass } from "../ui/workspace-patterns";
import type { AggregationRecord, ModelUpdateRecord } from "../../lib/api";
import { pick, type Locale } from "../../lib/i18n";
import type { UpdateThresholdAlert } from "./use-admin-workspace-state";

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
  newVersionName: string;
  aggregationBusy: boolean;
  setNewVersionName: Dispatch<SetStateAction<string>>;
  formatDateTime: (value: string | null | undefined, emptyLabel?: string) => string;
  onAggregation: (updateIds: string[]) => void;
  onAggregationAllReady: () => void;
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
  newVersionName,
  aggregationBusy,
  setNewVersionName,
  formatDateTime,
  onAggregation,
  onAggregationAllReady,
}: Props) {
  const aggregationLanes = buildAggregationLanes(approvedUpdates);
  const readyAggregationLanes = aggregationLanes.filter((lane) => lane.duplicate_site_count === 0);

  return (
    <Card as="section" variant="surface" className="grid gap-5 p-6">
      <SectionHeader
        eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Federation", "연합학습")}</div>}
        title={pick(locale, "Aggregate approved hospital deltas", "승인된 병원 델타 집계")}
        titleAs="h3"
        description={pick(
          locale,
          "Aggregate the approved queue into a new global model version while preserving site-level traceability.",
          "승인된 큐를 새로운 글로벌 모델 버전으로 집계하면서 병원 단위 추적성은 유지합니다."
        )}
        aside={<span className={docSiteBadgeClass}>{`${approvedUpdates.length} ${pick(locale, "approved", "승인")}`}</span>}
      />

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
                        aria-label={pick(
                          locale,
                          `Aggregate ${lane.architecture} lane`,
                          `${lane.architecture} lane 집계`
                        )}
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
