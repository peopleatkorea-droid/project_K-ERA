"use client";

import type { Dispatch, SetStateAction } from "react";

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
    <section className="doc-surface">
      <div className="doc-title-row">
        <div>
          <div className="doc-eyebrow">{pick(locale, "Federation", "연합학습")}</div>
          <h3>{pick(locale, "Aggregate approved hospital deltas", "승인된 병원 델타 집계")}</h3>
        </div>
        <div className="doc-site-badge">{approvedUpdates.length} {pick(locale, "approved", "승인됨")}</div>
      </div>
      <label className="inline-field">
        <span>{pick(locale, "Optional version name", "선택적 버전 이름")}</span>
        <input
          value={newVersionName}
          onChange={(event) => setNewVersionName(event.target.value)}
          placeholder="global-densenet-fedavg-20260311"
        />
      </label>
      <div className="doc-footer">
        <div>
          <strong>{pick(locale, "Aggregate the full approved queue", "승인 대기열 전체 집계")}</strong>
          <p>{pick(locale, "The API now aggregates only approved deltas that share one architecture and base model.", "이제 API는 같은 아키텍처와 기준 모델을 공유하는 승인된 delta만 집계합니다.")}</p>
        </div>
        <button className="primary-workspace-button" type="button" disabled={aggregationBusy || approvedUpdates.length === 0} onClick={onAggregation}>
          {aggregationBusy ? pick(locale, "Aggregating...", "집계 중...") : pick(locale, "Run FedAvg aggregation", "FedAvg 집계 실행")}
        </button>
      </div>
      <div className="ops-dual-grid">
        <section className="ops-card">
          {approvedUpdates.length === 0 ? (
            <div className="empty-surface">{pick(locale, "No approved updates are available for aggregation.", "집계할 승인된 업데이트가 없습니다.")}</div>
          ) : (
            <div className="ops-list">
              {approvedUpdates.map((item) => (
                <div key={item.update_id} className="ops-item">
                  <div className="panel-card-head"><strong>{item.update_id}</strong><span>{item.site_id}</span></div>
                  <div className="panel-meta">
                    <span>{item.architecture ?? pick(locale, "unknown architecture", "알 수 없는 아키텍처")}</span>
                    <span>{item.n_cases ?? 0} {pick(locale, "cases", "케이스")}</span>
                    <span>{formatDateTime(item.created_at, notAvailableLabel)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="ops-card">
          {aggregations.length === 0 ? (
            <div className="empty-surface">{pick(locale, "No aggregation record has been registered yet.", "아직 등록된 집계 기록이 없습니다.")}</div>
          ) : (
            <div className="ops-list">
              {aggregations.map((item) => (
                <div key={item.aggregation_id} className="ops-item">
                  <div className="panel-card-head">
                    <strong>{item.new_version_name}</strong>
                    <span>{formatDateTime(item.created_at, notAvailableLabel)}</span>
                  </div>
                  <div className="panel-meta">
                    <span>{item.architecture ?? pick(locale, "unknown architecture", "알 수 없는 아키텍처")}</span>
                    <span>{item.total_cases ?? 0} {pick(locale, "cases", "케이스")}</span>
                    <span>{Object.keys(item.site_weights ?? {}).length} {pick(locale, "hospitals", "병원")}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
