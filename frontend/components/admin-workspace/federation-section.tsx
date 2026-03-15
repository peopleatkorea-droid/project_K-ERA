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

type Props = {
  locale: Locale;
  notAvailableLabel: string;
  approvedUpdates: ModelUpdateRecord[];
  aggregations: AggregationRecord[];
  newVersionName: string;
  aggregationBusy: boolean;
  setNewVersionName: Dispatch<SetStateAction<string>>;
  formatDateTime: (value: string | null | undefined, emptyLabel?: string) => string;
  onAggregation: () => void;
};

export function FederationSection({
  locale,
  notAvailableLabel,
  approvedUpdates,
  aggregations,
  newVersionName,
  aggregationBusy,
  setNewVersionName,
  formatDateTime,
  onAggregation,
}: Props) {
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

      <Card as="div" variant="nested" className="grid gap-4 p-5">
        <SectionHeader
          title={pick(locale, "Aggregation launch", "집계 실행")}
          titleAs="h4"
          description={pick(
            locale,
            "The server aggregates only approved deltas that share the same architecture and compatible base version.",
            "서버는 같은 아키텍처와 호환 가능한 기준 버전을 공유하는 승인 델타만 집계합니다."
          )}
        />
        <Field label={pick(locale, "Optional version name", "선택 버전 이름")}>
          <input
            value={newVersionName}
            onChange={(event) => setNewVersionName(event.target.value)}
            placeholder="global-densenet-fedavg-20260311"
          />
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm leading-6 text-muted">
            {pick(
              locale,
              "Use a descriptive version name only when you need a human-readable checkpoint in the registry.",
              "레지스트리에서 사람이 바로 읽을 수 있는 체크포인트가 필요할 때만 설명형 버전 이름을 사용하세요."
            )}
          </div>
          <Button type="button" variant="primary" disabled={aggregationBusy || approvedUpdates.length === 0} onClick={onAggregation}>
            {aggregationBusy ? pick(locale, "Aggregating...", "집계 중...") : pick(locale, "Run FedAvg aggregation", "FedAvg 집계 실행")}
          </Button>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card as="section" variant="nested" className="grid gap-4 p-5">
          <SectionHeader
            title={pick(locale, "Approved updates", "승인된 업데이트")}
            titleAs="h4"
            aside={<span className={docSiteBadgeClass}>{approvedUpdates.length}</span>}
          />
          {approvedUpdates.length === 0 ? (
            <div className={emptySurfaceClass}>
              {pick(locale, "No approved updates are available for aggregation.", "집계 가능한 승인 업데이트가 없습니다.")}
            </div>
          ) : (
            <div className="grid gap-3">
              {approvedUpdates.map((item) => (
                <Card key={item.update_id} as="article" variant="nested" className="grid gap-3 border border-border/80 p-4">
                  <SectionHeader
                    title={item.update_id}
                    titleAs="h4"
                    description={item.site_id ?? notAvailableLabel}
                    aside={<span className={docSiteBadgeClass}>{formatDateTime(item.created_at, notAvailableLabel)}</span>}
                  />
                  <MetricGrid columns={3}>
                    <MetricItem value={item.architecture ?? notAvailableLabel} label={pick(locale, "Architecture", "아키텍처")} />
                    <MetricItem value={String(item.n_cases ?? 0)} label={pick(locale, "Cases", "케이스")} />
                    <MetricItem value={item.status ?? notAvailableLabel} label={pick(locale, "Status", "상태")} />
                  </MetricGrid>
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
