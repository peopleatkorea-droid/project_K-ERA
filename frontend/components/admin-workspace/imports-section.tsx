"use client";

import type { Dispatch, SetStateAction } from "react";

import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Field } from "../ui/field";
import { MetricGrid, MetricItem } from "../ui/metric-grid";
import { SectionHeader } from "../ui/section-header";
import { docSectionLabelClass, docSiteBadgeClass } from "../ui/workspace-patterns";
import type { BulkImportResponse } from "../../lib/api";
import { pick, type Locale } from "../../lib/i18n";

type Props = {
  locale: Locale;
  selectedSiteId: string | null;
  selectedSiteLabel: string | null;
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
  selectedSiteLabel,
  bulkCsvFile,
  bulkImportBusy,
  bulkImportResult,
  setBulkCsvFile,
  setBulkFiles,
  onDownloadTemplate,
  onRunBulkImport,
}: Props) {
  return (
    <Card as="section" variant="surface" className="grid gap-5 p-6">
      <SectionHeader
        eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Bulk import", "대량 임포트")}</div>}
        title={pick(locale, "CSV + image ZIP migration", "CSV + 이미지 ZIP 이관")}
        titleAs="h3"
        description={pick(
          locale,
          "Use this path for legacy backfill only. Daily clinical entry should continue in the document-style case canvas.",
          "이 경로는 레거시 백필 전용입니다. 일상 입력은 문서형 케이스 캔버스에서 계속 진행하는 것이 맞습니다."
        )}
        aside={<span className={docSiteBadgeClass}>{selectedSiteLabel ?? pick(locale, "Select a hospital", "병원 선택")}</span>}
      />

      <Card as="div" variant="nested" className="grid gap-4 p-5">
        <SectionHeader title={pick(locale, "Migration checklist", "이관 체크리스트")} titleAs="h4" />
        <ol className="grid gap-3 pl-5 text-sm leading-6 text-muted">
          <li>{pick(locale, "Download the CSV template and validate one small batch first.", "CSV 템플릿을 내려받고 작은 배치부터 먼저 검증하세요.")}</li>
          <li>{pick(locale, "Use the local chart or MRN-style ID used inside your institution. Do not import patient names, and remember that the central registry converts these IDs to case_reference_id values.", "기관 내부 차트/MRN 형태 ID를 사용하세요. 환자 실명은 임포트하지 말고, 중앙 registry에는 이 값이 case_reference_id로 변환되어 저장된다는 점을 기억하세요.")}</li>
          <li>{pick(locale, "Use visit labels such as Initial and FU #1. Keep exact dates only in actual_visit_date.", "visit_date는 Initial, FU #1 같은 라벨만 사용하고 실제 날짜는 actual_visit_date에만 넣으세요.")}</li>
          <li>{pick(locale, "Match image filenames with ZIP entries before uploading.", "업로드 전에 이미지 파일명과 ZIP 항목을 먼저 맞추세요.")}</li>
          <li>{pick(locale, "Start with two or three patients before a full backfill.", "전체 이관 전에 환자 2~3건으로 먼저 점검하세요.")}</li>
        </ol>
        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" variant="ghost" disabled={!selectedSiteId} onClick={onDownloadTemplate}>
            {pick(locale, "Download CSV template", "CSV 템플릿 다운로드")}
          </Button>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label={pick(locale, "Metadata CSV", "메타데이터 CSV")}>
          <input type="file" accept=".csv" onChange={(event) => setBulkCsvFile(event.target.files?.[0] ?? null)} />
        </Field>
        <Field label={pick(locale, "Image ZIP or raw images", "이미지 ZIP 또는 원본 이미지")}>
          <input
            type="file"
            accept=".zip,.jpg,.jpeg,.png"
            multiple
            onChange={(event) => setBulkFiles(Array.from(event.target.files ?? []))}
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-border bg-surface-muted/70 p-4">
        <div className="text-sm leading-6 text-muted">
          {pick(
            locale,
            "Run the importer only after both the metadata CSV and the image archive are ready. The CSV can use local patient IDs, but the central registry still stores only case_reference_id values plus visit labels.",
            "메타데이터 CSV와 이미지 아카이브가 모두 준비된 뒤에만 임포터를 실행하세요. CSV에는 병원 내부 환자 ID를 써도 되지만, 중앙 registry에는 case_reference_id와 방문 라벨만 저장됩니다."
          )}
        </div>
        <Button
          type="button"
          variant="primary"
          className="min-w-[190px] rounded-[16px] border-[#294cf0]/45 bg-[#3058ff] text-white shadow-none hover:border-[#2449e6] hover:bg-[#274de9] hover:shadow-none disabled:border-border/70 disabled:bg-surface-muted/82 disabled:text-muted dark:border-[rgba(124,150,255,0.18)] dark:bg-[rgba(104,129,255,0.2)] dark:text-[rgba(244,247,255,0.96)] dark:hover:border-[rgba(124,150,255,0.3)] dark:hover:bg-[rgba(104,129,255,0.28)] dark:disabled:border-white/8 dark:disabled:bg-[rgba(255,255,255,0.12)] dark:disabled:text-[rgba(226,232,240,0.78)]"
          disabled={bulkImportBusy || !selectedSiteId || !bulkCsvFile}
          onClick={onRunBulkImport}
        >
          {bulkImportBusy ? pick(locale, "Importing...", "임포트 중...") : pick(locale, "Run bulk import", "대량 임포트 실행")}
        </Button>
      </div>

      {bulkImportResult ? (
        <div className="grid gap-4">
          <MetricGrid columns={3}>
            <MetricItem value={bulkImportResult.rows_received} label={pick(locale, "Rows received", "수신 행")} />
            <MetricItem value={bulkImportResult.files_received} label={pick(locale, "Files read", "읽은 파일")} />
            <MetricItem value={bulkImportResult.created_patients} label={pick(locale, "Patients created", "생성 환자")} />
            <MetricItem value={bulkImportResult.created_visits} label={pick(locale, "Visits created", "생성 방문")} />
            <MetricItem value={bulkImportResult.imported_images} label={pick(locale, "Images imported", "임포트 이미지")} />
            <MetricItem value={bulkImportResult.skipped_images} label={pick(locale, "Images skipped", "건너뛴 이미지")} />
          </MetricGrid>

          {bulkImportResult.errors.length > 0 ? (
            <Card as="section" variant="nested" className="grid gap-4 p-5">
              <SectionHeader
                title={pick(locale, "Import warnings", "임포트 경고")}
                titleAs="h4"
                aside={<span className={docSiteBadgeClass}>{bulkImportResult.errors.length}</span>}
              />
              <div className="grid gap-3">
                {bulkImportResult.errors.map((item) => (
                  <div key={item} className="rounded-[18px] border border-border bg-surface px-4 py-3 text-sm leading-6 text-muted">
                    {item}
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
