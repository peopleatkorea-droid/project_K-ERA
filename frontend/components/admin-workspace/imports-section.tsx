"use client";

import type { Dispatch, SetStateAction } from "react";

import type { BulkImportResponse } from "../../lib/api";
import { pick, type Locale } from "../../lib/i18n";

type Props = {
  locale: Locale;
  selectedSiteId: string | null;
  bulkCsvFile: File | null;
  bulkImportBusy: boolean;
  bulkImportResult: BulkImportResponse | null;
  setBulkCsvFile: Dispatch<SetStateAction<File | null>>;
  setBulkFiles: Dispatch<SetStateAction<File[]>>;
  onDownloadTemplate: () => void;
  onRunBulkImport: () => void;
};

export function ImportsSection({
  locale,
  selectedSiteId,
  bulkCsvFile,
  bulkImportBusy,
  bulkImportResult,
  setBulkCsvFile,
  setBulkFiles,
  onDownloadTemplate,
  onRunBulkImport,
}: Props) {
  return (
    <section className="doc-surface">
      <div className="doc-title-row">
        <div>
          <div className="doc-eyebrow">{pick(locale, "Bulk import", "대량 임포트")}</div>
          <h3>{pick(locale, "CSV + image ZIP migration", "CSV + 이미지 ZIP 이전")}</h3>
        </div>
        <div className="doc-site-badge">{selectedSiteId ?? pick(locale, "Select a hospital", "병원 선택")}</div>
      </div>
      <div className="ops-stack">
        <div className="panel-meta">
          <span>{pick(locale, "1. Download the CSV template", "1. CSV 템플릿 다운로드")}</span>
          <span>{pick(locale, "2. Match image filenames with ZIP entries", "2. 이미지 파일명을 ZIP 항목과 맞추기")}</span>
          <span>{pick(locale, "3. Start with 2-3 patients before a full backfill", "3. 전체 이전 전에 2~3명 환자로 먼저 검증")}</span>
        </div>
        <div className="workspace-actions">
          <button className="ghost-button" type="button" onClick={onDownloadTemplate} disabled={!selectedSiteId}>
            {pick(locale, "Download CSV template", "CSV 템플릿 다운로드")}
          </button>
        </div>
        <div className="ops-form-grid">
          <label className="inline-field">
            <span>{pick(locale, "Metadata CSV", "메타데이터 CSV")}</span>
            <input type="file" accept=".csv" onChange={(event) => setBulkCsvFile(event.target.files?.[0] ?? null)} />
          </label>
          <label className="inline-field">
            <span>{pick(locale, "Image ZIP or raw images", "이미지 ZIP 또는 원본 이미지")}</span>
            <input
              type="file"
              accept=".zip,.jpg,.jpeg,.png"
              multiple
              onChange={(event) => setBulkFiles(Array.from(event.target.files ?? []))}
            />
          </label>
        </div>
        <div className="doc-footer">
          <div>
            <strong>{pick(locale, "Legacy backfill only", "레거시 백필 전용")}</strong>
            <p>{pick(locale, "Daily case entry should stay in the document-style case canvas.", "일상 케이스 입력은 문서형 케이스 캔버스에서 계속 진행하는 것이 좋습니다.")}</p>
          </div>
          <button
            className="primary-workspace-button"
            type="button"
            disabled={bulkImportBusy || !selectedSiteId || !bulkCsvFile}
            onClick={onRunBulkImport}
          >
            {bulkImportBusy ? pick(locale, "Importing...", "임포트 중...") : pick(locale, "Run bulk import", "대량 임포트 실행")}
          </button>
        </div>
        {bulkImportResult ? (
          <div className="ops-stack">
            <div className="panel-metric-grid">
              <div><strong>{bulkImportResult.rows_received}</strong><span>{pick(locale, "rows received", "수신 행 수")}</span></div>
              <div><strong>{bulkImportResult.files_received}</strong><span>{pick(locale, "files read", "읽은 파일 수")}</span></div>
              <div><strong>{bulkImportResult.created_patients}</strong><span>{pick(locale, "patients created", "생성된 환자 수")}</span></div>
              <div><strong>{bulkImportResult.created_visits}</strong><span>{pick(locale, "visits created", "생성된 방문 수")}</span></div>
              <div><strong>{bulkImportResult.imported_images}</strong><span>{pick(locale, "images imported", "임포트된 이미지 수")}</span></div>
              <div><strong>{bulkImportResult.skipped_images}</strong><span>{pick(locale, "images skipped", "건너뛴 이미지 수")}</span></div>
            </div>
            {bulkImportResult.errors.length > 0 ? (
              <div className="ops-card">
                <div className="panel-card-head">
                  <strong>{pick(locale, "Import warnings", "임포트 경고")}</strong>
                  <span>{bulkImportResult.errors.length}</span>
                </div>
                <div className="ops-list">
                  {bulkImportResult.errors.map((item) => (
                    <div key={item} className="ops-item">{item}</div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
