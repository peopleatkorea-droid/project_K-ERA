"use client";

import { useEffect, useState } from "react";

import { cn } from "../../lib/cn";
import { pick, type Locale } from "../../lib/i18n";
import type {
  ConfusionMatrixRecord,
  InitialTrainingBenchmarkEntry,
  InitialTrainingBenchmarkResponse,
  InitialTrainingMetricsRecord,
  InitialTrainingPredictionRecord,
  RocCurveRecord,
} from "../../lib/api";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { MetricGrid, MetricItem } from "../ui/metric-grid";
import { SectionHeader } from "../ui/section-header";
import { docSectionLabelClass, docSiteBadgeClass } from "../ui/workspace-patterns";

const TRAINING_ARCHITECTURE_OPTIONS = [
  { value: "densenet121", label: "DenseNet121" },
  { value: "convnext_tiny", label: "ConvNeXt-Tiny" },
  { value: "vit", label: "ViT" },
  { value: "swin", label: "Swin" },
  { value: "efficientnet_v2_s", label: "EfficientNetV2-S" },
  { value: "dinov2", label: "DINOv2" },
  { value: "dinov2_mil", label: "DINOv2 Attention MIL" },
  { value: "dual_input_concat", label: "Dual-input Concat Fusion" },
];

const TRAINING_ARCHITECTURE_LABELS = new Map(TRAINING_ARCHITECTURE_OPTIONS.map((option) => [option.value, option.label]));
const FIGURE_COLORS = ["#2e6cff", "#0f9d7a", "#f39c12", "#8f2bb3", "#d64545", "#334155"];
const ROC_TICKS = [0, 0.25, 0.5, 0.75, 1];

type Props = {
  locale: Locale;
  benchmarkResult: InitialTrainingBenchmarkResponse;
  selectedSiteLabel: string | null;
  notAvailableLabel: string;
  formatMetric: (value: number | null | undefined, emptyLabel?: string) => string;
};

type RocPoint = { x: number; y: number };

type RocSeries = {
  architecture: string;
  label: string;
  color: string;
  auroc: number | null;
  points: RocPoint[];
};

type EnsembleSummary = {
  matrix: number[][];
  labels: [string, string];
  nSamples: number;
  averageProbabilityThreshold: number;
  sampleKind: string;
  metrics: {
    accuracy: number | null;
    sensitivity: number | null;
    specificity: number | null;
    balancedAccuracy: number | null;
    F1: number | null;
    AUROC: number | null;
  };
  predictions: InitialTrainingPredictionRecord[];
};

function resolveArchitectureLabel(architecture: string | null | undefined): string {
  const normalized = String(architecture || "").trim();
  return (TRAINING_ARCHITECTURE_LABELS.get(normalized) ?? normalized) || "n/a";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function clampUnitInterval(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function getCompletedEntries(result: InitialTrainingBenchmarkResponse): InitialTrainingBenchmarkEntry[] {
  return result.results.filter((entry) => entry.status === "completed" && Boolean(entry.result));
}

function getTestMetrics(entry: InitialTrainingBenchmarkEntry): InitialTrainingMetricsRecord | null {
  const raw = entry.result?.test_metrics;
  return raw && typeof raw === "object" ? (raw as InitialTrainingMetricsRecord) : null;
}

function getMetric(entry: InitialTrainingBenchmarkEntry, metricName: keyof InitialTrainingMetricsRecord): number | null {
  const rawValue = getTestMetrics(entry)?.[metricName];
  return typeof rawValue === "number" ? rawValue : null;
}

function getTestPredictions(entry: InitialTrainingBenchmarkEntry): InitialTrainingPredictionRecord[] {
  const predictions = entry.result?.test_predictions;
  if (!Array.isArray(predictions)) {
    return [];
  }
  return predictions.filter(
    (item): item is InitialTrainingPredictionRecord =>
      Boolean(
        item &&
          typeof item === "object" &&
          typeof item.sample_key === "string" &&
          typeof item.true_label === "string" &&
          typeof item.positive_probability === "number"
      )
  );
}

function compareBenchmarkEntries(left: InitialTrainingBenchmarkEntry, right: InitialTrainingBenchmarkEntry): number {
  return (
    (getMetric(right, "balanced_accuracy") ?? -1) - (getMetric(left, "balanced_accuracy") ?? -1) ||
    (getMetric(right, "AUROC") ?? -1) - (getMetric(left, "AUROC") ?? -1) ||
    ((right.result?.best_val_acc ?? -1) - (left.result?.best_val_acc ?? -1))
  );
}

function getRocPoints(entry: InitialTrainingBenchmarkEntry): RocPoint[] {
  const rocCurve = getTestMetrics(entry)?.roc_curve;
  const fpr = rocCurve?.fpr;
  const tpr = rocCurve?.tpr;
  if (!Array.isArray(fpr) || !Array.isArray(tpr) || fpr.length !== tpr.length || fpr.length < 2) {
    return [];
  }
  const points = fpr
    .map((falsePositiveRate, index) => {
      const truePositiveRate = tpr[index];
      if (typeof falsePositiveRate !== "number" || typeof truePositiveRate !== "number") {
        return null;
      }
      return {
        x: clampUnitInterval(falsePositiveRate),
        y: clampUnitInterval(truePositiveRate),
      };
    })
    .filter((point): point is RocPoint => point !== null)
    .sort((left, right) => left.x - right.x || left.y - right.y);
  return points.length >= 2 ? points : [];
}

function getConfusionMatrix(entry: InitialTrainingBenchmarkEntry): { labels: string[]; matrix: number[][] } | null {
  const record = getTestMetrics(entry)?.confusion_matrix;
  const rawMatrix = record?.matrix;
  if (
    !Array.isArray(rawMatrix) ||
    rawMatrix.length !== 2 ||
    !rawMatrix.every((row) => Array.isArray(row) && row.length === 2 && row.every((value) => typeof value === "number"))
  ) {
    return null;
  }
  const rawLabels = Array.isArray(record?.labels) ? record?.labels.filter((label): label is string => typeof label === "string" && label.trim().length > 0) : [];
  return {
    labels: rawLabels.length === 2 ? rawLabels : [],
    matrix: rawMatrix as number[][],
  };
}

function svgText(value: string, x: number, y: number, extra = ""): string {
  return `<text x="${x}" y="${y}" ${extra}>${escapeHtml(value)}</text>`;
}

function formatFigureMetric(value: number | null | undefined): string {
  return typeof value === "number" ? value.toFixed(3) : "n/a";
}

function buildRocSvg(series: RocSeries[], locale: Locale): string {
  const width = 900;
  const height = 410;
  const padding = { top: 30, right: 28, bottom: 54, left: 60 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const plotX = (value: number) => padding.left + clampUnitInterval(value) * plotWidth;
  const plotY = (value: number) => height - padding.bottom - clampUnitInterval(value) * plotHeight;
  const legendY = padding.top - 10;

  const pathMarkup = series
    .map((item) => {
      const path = item.points
        .map((point, index) => `${index === 0 ? "M" : "L"} ${plotX(point.x).toFixed(2)} ${plotY(point.y).toFixed(2)}`)
        .join(" ");
      return `<path d="${path}" fill="none" stroke="${item.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />`;
    })
    .join("");

  const gridMarkup = ROC_TICKS.map((tick) => {
    const x = plotX(tick);
    const y = plotY(tick);
    return `
      <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="rgba(148,163,184,0.22)" stroke-width="1" />
      <line x1="${x}" y1="${padding.top}" x2="${x}" y2="${height - padding.bottom}" stroke="rgba(148,163,184,0.18)" stroke-width="1" />
      ${svgText(tick.toFixed(2), x, height - padding.bottom + 22, 'text-anchor="middle" fill="#64748b" font-size="12" font-family="ui-sans-serif,system-ui"')}
      ${svgText(tick.toFixed(2), padding.left - 12, y + 4, 'text-anchor="end" fill="#64748b" font-size="12" font-family="ui-sans-serif,system-ui"')}
    `;
  }).join("");

  const legendMarkup = series
    .map(
      (item, index) => `
        <rect x="${padding.left + index * 170}" y="${legendY}" width="14" height="14" rx="4" fill="${item.color}" />
        ${svgText(
          `${item.label} (AUROC ${formatFigureMetric(item.auroc)})`,
          padding.left + index * 170 + 22,
          legendY + 11.5,
          'fill="#0f172a" font-size="12.5" font-family="ui-sans-serif,system-ui"'
        )}
      `
    )
    .join("");

  return `
    <svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeHtml(
      pick(locale, "ROC curve comparison", "ROC 곡선 비교")
    )}">
      <rect x="0" y="0" width="${width}" height="${height}" rx="22" fill="white" />
      ${gridMarkup}
      <line x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${padding.top}" stroke="rgba(100,116,139,0.5)" stroke-dasharray="6 6" stroke-width="2" />
      <rect x="${padding.left}" y="${padding.top}" width="${plotWidth}" height="${plotHeight}" rx="18" fill="transparent" stroke="rgba(148,163,184,0.24)" stroke-width="1.2" />
      ${pathMarkup}
      ${legendMarkup}
      ${svgText(
        pick(locale, "False positive rate", "거짓 양성 비율"),
        width / 2,
        height - 12,
        'text-anchor="middle" fill="#334155" font-size="13" font-family="ui-sans-serif,system-ui"'
      )}
      <g transform="translate(16 ${height / 2}) rotate(-90)">
        ${svgText(
          pick(locale, "True positive rate", "참 양성 비율"),
          0,
          0,
          'text-anchor="middle" fill="#334155" font-size="13" font-family="ui-sans-serif,system-ui"'
        )}
      </g>
    </svg>
  `;
}

function buildGapSvg(entries: InitialTrainingBenchmarkEntry[], locale: Locale): string {
  const rows = [...entries]
    .filter((entry) => typeof entry.result?.best_val_acc === "number" && typeof getMetric(entry, "accuracy") === "number")
    .map((entry) => ({
      label: resolveArchitectureLabel(entry.architecture),
      bestVal: clampUnitInterval(entry.result?.best_val_acc ?? 0),
      testAcc: clampUnitInterval(getMetric(entry, "accuracy") ?? 0),
      gap: Math.max(0, (entry.result?.best_val_acc ?? 0) - (getMetric(entry, "accuracy") ?? 0)),
    }))
    .sort((left, right) => right.gap - left.gap);

  const width = 900;
  const rowHeight = 34;
  const height = Math.max(360, 120 + rows.length * rowHeight);
  const padding = { top: 52, right: 80, bottom: 44, left: 220 };
  const plotWidth = width - padding.left - padding.right;
  const plotX = (value: number) => padding.left + clampUnitInterval(value) * plotWidth;

  const rowMarkup = rows
    .map((row, index) => {
      const y = padding.top + index * rowHeight;
      const valX = plotX(row.bestVal);
      const testX = plotX(row.testAcc);
      return `
        ${svgText(row.label, padding.left - 16, y + 5, 'text-anchor="end" fill="#0f172a" font-size="12.5" font-family="ui-sans-serif,system-ui"')}
        <line x1="${testX}" y1="${y}" x2="${valX}" y2="${y}" stroke="rgba(100,116,139,0.42)" stroke-width="3" stroke-linecap="round" />
        <circle cx="${valX}" cy="${y}" r="6" fill="#2e6cff" />
        <circle cx="${testX}" cy="${y}" r="6" fill="#f39c12" />
        ${svgText(`gap ${row.gap.toFixed(3)}`, width - padding.right + 10, y + 4, 'fill="#475569" font-size="12" font-family="ui-sans-serif,system-ui"')}
      `;
    })
    .join("");

  const tickMarkup = ROC_TICKS.map((tick) => {
    const x = plotX(tick);
    return `
      <line x1="${x}" y1="${padding.top - 16}" x2="${x}" y2="${height - padding.bottom}" stroke="rgba(148,163,184,0.2)" stroke-width="1" />
      ${svgText(tick.toFixed(2), x, height - padding.bottom + 24, 'text-anchor="middle" fill="#64748b" font-size="12" font-family="ui-sans-serif,system-ui"')}
    `;
  }).join("");

  return `
    <svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeHtml(
      pick(locale, "Generalization gap", "일반화 격차")
    )}">
      <rect x="0" y="0" width="${width}" height="${height}" rx="22" fill="white" />
      ${tickMarkup}
      <rect x="${padding.left}" y="${padding.top - 16}" width="${plotWidth}" height="${height - padding.top - padding.bottom + 16}" rx="18" fill="transparent" stroke="rgba(148,163,184,0.24)" stroke-width="1.2" />
      <circle cx="${padding.left}" cy="24" r="6" fill="#2e6cff" />
      ${svgText(pick(locale, "best val acc", "최고 검증 정확도"), padding.left + 14, 28, 'fill="#0f172a" font-size="12.5" font-family="ui-sans-serif,system-ui"')}
      <circle cx="${padding.left + 170}" cy="24" r="6" fill="#f39c12" />
      ${svgText(pick(locale, "test acc", "테스트 정확도"), padding.left + 184, 28, 'fill="#0f172a" font-size="12.5" font-family="ui-sans-serif,system-ui"')}
      ${rowMarkup}
      ${svgText(
        pick(locale, "performance", "성능"),
        width / 2,
        height - 10,
        'text-anchor="middle" fill="#334155" font-size="13" font-family="ui-sans-serif,system-ui"'
      )}
    </svg>
  `;
}

function buildRankingSvg(entries: InitialTrainingBenchmarkEntry[], locale: Locale): string {
  const rows = [...entries].sort(compareBenchmarkEntries);
  const width = 960;
  const height = 420;
  const padding = { top: 32, right: 28, bottom: 120, left: 60 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const groupWidth = rows.length > 0 ? plotWidth / rows.length : plotWidth;
  const barWidth = Math.max(16, Math.min(28, groupWidth * 0.22));
  const plotY = (value: number) => height - padding.bottom - clampUnitInterval(value) * plotHeight;

  const axisMarkup = ROC_TICKS.map((tick) => {
    const y = plotY(tick);
    return `
      <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="rgba(148,163,184,0.2)" stroke-width="1" />
      ${svgText(tick.toFixed(2), padding.left - 10, y + 4, 'text-anchor="end" fill="#64748b" font-size="12" font-family="ui-sans-serif,system-ui"')}
    `;
  }).join("");

  const barsMarkup = rows
    .map((entry, index) => {
      const groupCenter = padding.left + groupWidth * index + groupWidth / 2;
      const auroc = clampUnitInterval(getMetric(entry, "AUROC") ?? 0);
      const balanced = clampUnitInterval(getMetric(entry, "balanced_accuracy") ?? 0);
      const aurocY = plotY(auroc);
      const balancedY = plotY(balanced);
      return `
        <rect x="${groupCenter - barWidth - 4}" y="${aurocY}" width="${barWidth}" height="${height - padding.bottom - aurocY}" rx="8" fill="#2e6cff" />
        <rect x="${groupCenter + 4}" y="${balancedY}" width="${barWidth}" height="${height - padding.bottom - balancedY}" rx="8" fill="#0f9d7a" />
        <g transform="translate(${groupCenter} ${height - padding.bottom + 22}) rotate(32)">
          ${svgText(resolveArchitectureLabel(entry.architecture), 0, 0, 'fill="#334155" font-size="11.5" font-family="ui-sans-serif,system-ui"')}
        </g>
      `;
    })
    .join("");

  return `
    <svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeHtml(
      pick(locale, "Model ranking", "모델 순위")
    )}">
      <rect x="0" y="0" width="${width}" height="${height}" rx="22" fill="white" />
      ${axisMarkup}
      <rect x="${padding.left}" y="${padding.top}" width="${plotWidth}" height="${plotHeight}" rx="18" fill="transparent" stroke="rgba(148,163,184,0.24)" stroke-width="1.2" />
      <rect x="${padding.left}" y="12" width="14" height="14" rx="4" fill="#2e6cff" />
      ${svgText("AUROC", padding.left + 22, 24, 'fill="#0f172a" font-size="12.5" font-family="ui-sans-serif,system-ui"')}
      <rect x="${padding.left + 90}" y="12" width="14" height="14" rx="4" fill="#0f9d7a" />
      ${svgText(
        pick(locale, "balanced acc", "균형 정확도"),
        padding.left + 112,
        24,
        'fill="#0f172a" font-size="12.5" font-family="ui-sans-serif,system-ui"'
      )}
      ${barsMarkup}
      ${svgText(
        pick(locale, "score", "점수"),
        18,
        padding.top - 8,
        'fill="#334155" font-size="13" font-family="ui-sans-serif,system-ui"'
      )}
    </svg>
  `;
}

function buildConfusionMatrixHtml(
  entry: InitialTrainingBenchmarkEntry,
  locale: Locale,
  formatMetric: (value: number | null | undefined, emptyLabel?: string) => string,
  notAvailableLabel: string
): string {
  const confusion = getConfusionMatrix(entry);
  if (!confusion) {
    return "";
  }
  const [negativeLabel, positiveLabel] =
    confusion.labels.length === 2 ? confusion.labels : [pick(locale, "Bacterial", "세균"), pick(locale, "Fungal", "진균")];
  const metrics = [
    `AUROC ${formatMetric(getMetric(entry, "AUROC"), notAvailableLabel)}`,
    `${pick(locale, "balanced acc", "균형 정확도")} ${formatMetric(getMetric(entry, "balanced_accuracy"), notAvailableLabel)}`,
    `F1 ${formatMetric(getMetric(entry, "F1"), notAvailableLabel)}`,
  ];
  return `
    <section class="matrix-card">
      <h3>${escapeHtml(resolveArchitectureLabel(entry.architecture))}</h3>
      <p>${metrics.map(escapeHtml).join(" · ")}</p>
      <table>
        <thead>
          <tr>
            <th>${escapeHtml(pick(locale, "True / Pred", "실제 / 예측"))}</th>
            <th>${escapeHtml(negativeLabel)}</th>
            <th>${escapeHtml(positiveLabel)}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>${escapeHtml(negativeLabel)}</th>
            <td>${confusion.matrix[0][0]}</td>
            <td>${confusion.matrix[0][1]}</td>
          </tr>
          <tr>
            <th>${escapeHtml(positiveLabel)}</th>
            <td>${confusion.matrix[1][0]}</td>
            <td>${confusion.matrix[1][1]}</td>
          </tr>
        </tbody>
      </table>
    </section>
  `;
}

function buildPaperReportHtml({
  locale,
  benchmarkResult,
  selectedEntries,
  ensembleSummary,
  rocSvg,
  gapSvg,
  rankingSvg,
  siteLabel,
  generatedLabel,
  formatMetric,
  notAvailableLabel,
}: {
  locale: Locale;
  benchmarkResult: InitialTrainingBenchmarkResponse;
  selectedEntries: InitialTrainingBenchmarkEntry[];
  ensembleSummary: EnsembleSummary | null;
  rocSvg: string;
  gapSvg: string;
  rankingSvg: string;
  siteLabel: string;
  generatedLabel: string;
  formatMetric: (value: number | null | undefined, emptyLabel?: string) => string;
  notAvailableLabel: string;
}): string {
  const completedEntries = [...getCompletedEntries(benchmarkResult)].sort(compareBenchmarkEntries);
  const summaryRows = completedEntries
    .map(
      (entry) => `
        <tr>
          <td>${escapeHtml(resolveArchitectureLabel(entry.architecture))}</td>
          <td>${escapeHtml(formatMetric(entry.result?.best_val_acc, notAvailableLabel))}</td>
          <td>${escapeHtml(formatMetric(getMetric(entry, "accuracy"), notAvailableLabel))}</td>
          <td>${escapeHtml(formatMetric(getMetric(entry, "AUROC"), notAvailableLabel))}</td>
          <td>${escapeHtml(formatMetric(getMetric(entry, "balanced_accuracy"), notAvailableLabel))}</td>
          <td>${escapeHtml(entry.model_version?.version_name ?? notAvailableLabel)}</td>
        </tr>
      `
    )
    .join("");
  const confusionMarkup = selectedEntries.map((entry) => buildConfusionMatrixHtml(entry, locale, formatMetric, notAvailableLabel)).join("");
  const ensembleMarkup = ensembleSummary
    ? `
      <section class="card" style="margin-top: 18px;">
        <h2>${escapeHtml(pick(locale, "Ensemble confusion matrix", "Ensemble confusion matrix"))}</h2>
        <p>${escapeHtml(
          pick(
            locale,
            `Average positive probability across ${selectedEntries.length} models on the shared ${ensembleSummary.sampleKind} cohort (${ensembleSummary.nSamples} samples).`,
            `선택 모델 ${selectedEntries.length}개의 양성 확률 평균으로 계산한 ${ensembleSummary.sampleKind} 단위 공통 cohort (${ensembleSummary.nSamples}개 샘플) 결과입니다.`
          )
        )}</p>
        <div class="metrics">
          <div class="metric"><strong>${escapeHtml(formatMetric(ensembleSummary.metrics.accuracy, notAvailableLabel))}</strong><span>Accuracy</span></div>
          <div class="metric"><strong>${escapeHtml(formatMetric(ensembleSummary.metrics.balancedAccuracy, notAvailableLabel))}</strong><span>${escapeHtml(pick(locale, "Balanced acc", "균형 정확도"))}</span></div>
          <div class="metric"><strong>${escapeHtml(formatMetric(ensembleSummary.metrics.F1, notAvailableLabel))}</strong><span>F1</span></div>
          <div class="metric"><strong>${escapeHtml(formatMetric(ensembleSummary.metrics.AUROC, notAvailableLabel))}</strong><span>AUROC</span></div>
        </div>
        <table style="margin-top: 16px;">
          <thead>
            <tr>
              <th>${escapeHtml(pick(locale, "True / Pred", "실제 / 예측"))}</th>
              <th>bacterial</th>
              <th>fungal</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>bacterial</th>
              <td>${ensembleSummary.matrix[0][0]}</td>
              <td>${ensembleSummary.matrix[0][1]}</td>
            </tr>
            <tr>
              <th>fungal</th>
              <td>${ensembleSummary.matrix[1][0]}</td>
              <td>${ensembleSummary.matrix[1][1]}</td>
            </tr>
          </tbody>
        </table>
      </section>
    `
    : "";

  return `<!doctype html>
<html lang="${locale === "ko" ? "ko" : "en"}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(siteLabel)} - ${escapeHtml(pick(locale, "Paper-ready training figures", "논문용 학습 도표"))}</title>
    <style>
      body { margin: 0; background: #f8fafc; color: #0f172a; font: 15px/1.6 Inter, "Noto Sans KR", system-ui, sans-serif; }
      main { max-width: 1320px; margin: 0 auto; padding: 32px 28px 56px; }
      header { margin-bottom: 28px; }
      h1 { margin: 0 0 10px; font-size: 32px; line-height: 1.1; }
      h2 { margin: 0 0 14px; font-size: 22px; line-height: 1.2; }
      h3 { margin: 0 0 8px; font-size: 17px; line-height: 1.2; }
      p { margin: 0; color: #475569; }
      .chip-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
      .chip { display: inline-flex; align-items: center; min-height: 32px; padding: 0 12px; border: 1px solid #d7dee8; border-radius: 999px; background: white; font-size: 13px; color: #334155; }
      .grid { display: grid; gap: 18px; }
      .grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .card { border: 1px solid #d7dee8; border-radius: 20px; background: white; padding: 20px; box-shadow: 0 10px 26px rgba(15, 23, 42, 0.05); }
      .figure { overflow: hidden; }
      .figure svg { width: 100%; height: auto; display: block; }
      .metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-top: 18px; }
      .metric { border: 1px solid #d7dee8; border-radius: 16px; background: #f8fafc; padding: 14px 16px; }
      .metric strong { display: block; font-size: 24px; line-height: 1.1; margin-bottom: 4px; }
      .metric span { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.08em; }
      table { width: 100%; border-collapse: collapse; }
      th, td { padding: 11px 12px; border-bottom: 1px solid #e5e7eb; text-align: left; }
      thead th { color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
      .matrix-grid { display: grid; gap: 18px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .matrix-card { border: 1px solid #d7dee8; border-radius: 18px; background: #fff; padding: 18px; }
      .matrix-card p { margin-bottom: 12px; }
      @media (max-width: 1100px) {
        .grid-2, .matrix-grid, .metrics { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>${escapeHtml(pick(locale, "Paper-ready benchmark figures", "논문용 benchmark 정리"))}</h1>
        <p>${escapeHtml(siteLabel)} · ${escapeHtml(generatedLabel)}</p>
        <div class="chip-row">
          ${selectedEntries.map((entry) => `<span class="chip">${escapeHtml(resolveArchitectureLabel(entry.architecture))}</span>`).join("")}
        </div>
      </header>
      <section class="card">
        <h2>${escapeHtml(pick(locale, "Benchmark overview", "benchmark 개요"))}</h2>
        <div class="metrics">
          <div class="metric"><strong>${completedEntries.length}</strong><span>${escapeHtml(pick(locale, "completed", "완료 모델"))}</span></div>
          <div class="metric"><strong>${benchmarkResult.failures.length}</strong><span>${escapeHtml(pick(locale, "failed", "실패 모델"))}</span></div>
          <div class="metric"><strong>${escapeHtml(resolveArchitectureLabel(benchmarkResult.best_architecture))}</strong><span>${escapeHtml(pick(locale, "best val", "val 최고"))}</span></div>
          <div class="metric"><strong>${escapeHtml(resolveArchitectureLabel(completedEntries[0]?.architecture ?? null))}</strong><span>${escapeHtml(pick(locale, "best test", "test 최고"))}</span></div>
        </div>
      </section>
      <section class="grid grid-2" style="margin-top: 18px;">
        <article class="card figure">
          <h2>${escapeHtml(pick(locale, "Figure 1. ROC curve", "Figure 1. ROC curve"))}</h2>
          ${rocSvg || `<p>${escapeHtml(pick(locale, "ROC data is not available for the selected models.", "선택한 모델의 ROC 데이터가 없습니다."))}</p>`}
        </article>
        <article class="card figure">
          <h2>${escapeHtml(pick(locale, "Figure 2. Generalization gap", "Figure 2. 일반화 격차"))}</h2>
          ${gapSvg}
        </article>
      </section>
      <section class="card figure" style="margin-top: 18px;">
        <h2>${escapeHtml(pick(locale, "Figure 3. Model ranking", "Figure 3. 모델 순위"))}</h2>
        ${rankingSvg}
      </section>
      <section class="card" style="margin-top: 18px;">
        <h2>${escapeHtml(pick(locale, "Selected confusion matrices", "선택 모델 confusion matrix"))}</h2>
        <div class="matrix-grid">
          ${confusionMarkup || `<p>${escapeHtml(pick(locale, "Confusion matrix data is not available for the selected models.", "선택한 모델의 confusion matrix 데이터가 없습니다."))}</p>`}
        </div>
      </section>
      ${ensembleMarkup}
      <section class="card" style="margin-top: 18px;">
        <h2>${escapeHtml(pick(locale, "Benchmark summary table", "benchmark 요약 표"))}</h2>
        <table>
          <thead>
            <tr>
              <th>${escapeHtml(pick(locale, "architecture", "아키텍처"))}</th>
              <th>${escapeHtml(pick(locale, "best val acc", "최고 검증 정확도"))}</th>
              <th>${escapeHtml(pick(locale, "test acc", "테스트 정확도"))}</th>
              <th>AUROC</th>
              <th>${escapeHtml(pick(locale, "balanced acc", "균형 정확도"))}</th>
              <th>${escapeHtml(pick(locale, "version", "버전"))}</th>
            </tr>
          </thead>
          <tbody>
            ${summaryRows}
          </tbody>
        </table>
      </section>
    </main>
  </body>
</html>`;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadText(filename: string, contents: string, mimeType: string) {
  downloadBlob(filename, new Blob([contents], { type: mimeType }));
}

function svgFilename(baseName: string) {
  return `${slugify(baseName) || "figure"}.svg`;
}

function pngFilename(baseName: string) {
  return `${slugify(baseName) || "figure"}.png`;
}

function svgSizeFromMarkup(svgMarkup: string): { width: number; height: number } {
  const match = svgMarkup.match(/viewBox="[^"]*0\s+0\s+([0-9.]+)\s+([0-9.]+)"/i);
  const width = Number(match?.[1] ?? 1200);
  const height = Number(match?.[2] ?? 800);
  return {
    width: Number.isFinite(width) && width > 0 ? width : 1200,
    height: Number.isFinite(height) && height > 0 ? height : 800,
  };
}

async function svgMarkupToPngBlob(svgMarkup: string): Promise<Blob> {
  const svgBlob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () => reject(new Error("Unable to render SVG for PNG export."));
      nextImage.src = url;
    });
    const size = svgSizeFromMarkup(svgMarkup);
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(size.width * scale);
    canvas.height = Math.round(size.height * scale);
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas export is unavailable.");
    }
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((nextBlob) => {
        if (nextBlob) {
          resolve(nextBlob);
          return;
        }
        reject(new Error("PNG export failed."));
      }, "image/png");
    });
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function mean(values: number[]): number | null {
  if (!values.length) {
    return null;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function binaryMetrics(trueLabels: number[], probabilities: number[], threshold = 0.5) {
  if (!trueLabels.length || trueLabels.length !== probabilities.length) {
    return {
      matrix: [
        [0, 0],
        [0, 0],
      ],
      accuracy: null,
      sensitivity: null,
      specificity: null,
      balancedAccuracy: null,
      F1: null,
      AUROC: null,
    };
  }
  const predictedLabels = probabilities.map((value) => (value >= threshold ? 1 : 0));
  let truePositive = 0;
  let trueNegative = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  for (let index = 0; index < trueLabels.length; index += 1) {
    const truth = trueLabels[index];
    const predicted = predictedLabels[index];
    if (truth === 1 && predicted === 1) {
      truePositive += 1;
    } else if (truth === 0 && predicted === 0) {
      trueNegative += 1;
    } else if (truth === 0 && predicted === 1) {
      falsePositive += 1;
    } else if (truth === 1 && predicted === 0) {
      falseNegative += 1;
    }
  }
  const accuracy = (truePositive + trueNegative) / trueLabels.length;
  const sensitivity = truePositive + falseNegative > 0 ? truePositive / (truePositive + falseNegative) : null;
  const specificity = trueNegative + falsePositive > 0 ? trueNegative / (trueNegative + falsePositive) : null;
  const balancedAccuracy = sensitivity !== null && specificity !== null ? (sensitivity + specificity) / 2 : null;
  const precision = truePositive + falsePositive > 0 ? truePositive / (truePositive + falsePositive) : null;
  const F1 = precision !== null && sensitivity !== null && precision + sensitivity > 0 ? (2 * precision * sensitivity) / (precision + sensitivity) : null;

  let AUROC: number | null = null;
  const positiveCount = trueLabels.filter((value) => value === 1).length;
  const negativeCount = trueLabels.length - positiveCount;
  if (positiveCount > 0 && negativeCount > 0) {
    const ranked = probabilities
      .map((probability, index) => ({ probability, truth: trueLabels[index] }))
      .sort((left, right) => right.probability - left.probability);
    let tp = 0;
    let fp = 0;
    let previousProbability = Number.POSITIVE_INFINITY;
    const rocPoints: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }];
    for (const item of ranked) {
      if (item.probability !== previousProbability) {
        rocPoints.push({ x: fp / negativeCount, y: tp / positiveCount });
        previousProbability = item.probability;
      }
      if (item.truth === 1) {
        tp += 1;
      } else {
        fp += 1;
      }
    }
    rocPoints.push({ x: fp / negativeCount, y: tp / positiveCount });
    AUROC = 0;
    for (let index = 1; index < rocPoints.length; index += 1) {
      const left = rocPoints[index - 1];
      const right = rocPoints[index];
      AUROC += (right.x - left.x) * ((right.y + left.y) / 2);
    }
  }

  return {
    matrix: [
      [trueNegative, falsePositive],
      [falseNegative, truePositive],
    ],
    accuracy,
    sensitivity,
    specificity,
    balancedAccuracy,
    F1,
    AUROC,
  };
}

function buildEnsembleSummary(entries: InitialTrainingBenchmarkEntry[]): EnsembleSummary | null {
  if (entries.length < 2) {
    return null;
  }
  const entryPredictions = entries.map((entry) => ({
    entry,
    predictions: getTestPredictions(entry),
  }));
  if (entryPredictions.some((item) => item.predictions.length === 0)) {
    return null;
  }
  const predictionMaps = entryPredictions.map((item) => new Map(item.predictions.map((prediction) => [prediction.sample_key, prediction])));
  const sharedKeys = [...predictionMaps[0].keys()].filter((sampleKey) => predictionMaps.every((map) => map.has(sampleKey)));
  if (!sharedKeys.length) {
    return null;
  }
  const predictions: InitialTrainingPredictionRecord[] = [];
  for (const sampleKey of sharedKeys) {
    const rows = predictionMaps.map((map) => map.get(sampleKey)).filter((row): row is InitialTrainingPredictionRecord => row !== undefined);
    if (rows.length !== entryPredictions.length) {
      continue;
    }
    const trueLabelIndex = Number(rows[0].true_label_index);
    if (!rows.every((row) => Number(row.true_label_index) === trueLabelIndex)) {
      continue;
    }
    const averageProbability = mean(rows.map((row) => Number(row.positive_probability))) ?? 0;
    const predictedLabelIndex = averageProbability >= 0.5 ? 1 : 0;
    predictions.push({
      ...rows[0],
      predicted_label: predictedLabelIndex === 1 ? "fungal" : "bacterial",
      predicted_label_index: predictedLabelIndex,
      positive_probability: averageProbability,
      is_correct: predictedLabelIndex === trueLabelIndex,
    });
  }
  if (!predictions.length) {
    return null;
  }
  const labels = predictions.map((prediction) => Number(prediction.true_label_index));
  const probabilities = predictions.map((prediction) => Number(prediction.positive_probability));
  const metrics = binaryMetrics(labels, probabilities, 0.5);
  const sampleKind = predictions[0]?.sample_kind ?? "sample";
  return {
    matrix: metrics.matrix,
    labels: ["bacterial", "fungal"],
    nSamples: predictions.length,
    averageProbabilityThreshold: 0.5,
    sampleKind,
    metrics: {
      accuracy: metrics.accuracy,
      sensitivity: metrics.sensitivity,
      specificity: metrics.specificity,
      balancedAccuracy: metrics.balancedAccuracy,
      F1: metrics.F1,
      AUROC: metrics.AUROC,
    },
    predictions,
  };
}

function ConfusionMatrixCard({
  locale,
  entry,
  notAvailableLabel,
  formatMetric,
}: {
  locale: Locale;
  entry: InitialTrainingBenchmarkEntry;
  notAvailableLabel: string;
  formatMetric: (value: number | null | undefined, emptyLabel?: string) => string;
}) {
  const confusion = getConfusionMatrix(entry);
  if (!confusion) {
    return (
      <Card as="section" variant="nested" className="grid gap-3 p-4">
        <SectionHeader title={resolveArchitectureLabel(entry.architecture)} titleAs="h5" />
        <div className="rounded-[14px] border border-dashed border-border bg-surface px-4 py-4 text-sm leading-6 text-muted">
          {pick(locale, "Confusion matrix is not available for this model.", "이 모델의 confusion matrix 데이터가 없습니다.")}
        </div>
      </Card>
    );
  }

  const [negativeLabel, positiveLabel] =
    confusion.labels.length === 2 ? confusion.labels : [pick(locale, "Bacterial", "세균"), pick(locale, "Fungal", "진균")];

  return (
    <Card as="section" variant="nested" className="grid gap-4 p-4">
      <SectionHeader
        title={resolveArchitectureLabel(entry.architecture)}
        titleAs="h5"
        description={[
          `AUROC ${formatMetric(getMetric(entry, "AUROC"), notAvailableLabel)}`,
          `${pick(locale, "balanced acc", "균형 정확도")} ${formatMetric(getMetric(entry, "balanced_accuracy"), notAvailableLabel)}`,
          `F1 ${formatMetric(getMetric(entry, "F1"), notAvailableLabel)}`,
        ].join(" · ")}
      />
      <div className="grid gap-2">
        <div className="grid grid-cols-[1.2fr_repeat(2,minmax(0,1fr))] gap-2">
          <div className="rounded-[14px] border border-border bg-surface px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted">
            {pick(locale, "True / Pred", "실제 / 예측")}
          </div>
          <div className="rounded-[14px] border border-border bg-surface px-3 py-2 text-sm font-medium text-ink">{negativeLabel}</div>
          <div className="rounded-[14px] border border-border bg-surface px-3 py-2 text-sm font-medium text-ink">{positiveLabel}</div>
        </div>
        {[
          [negativeLabel, confusion.matrix[0][0], confusion.matrix[0][1]],
          [positiveLabel, confusion.matrix[1][0], confusion.matrix[1][1]],
        ].map(([label, leftValue, rightValue]) => (
          <div key={String(label)} className="grid grid-cols-[1.2fr_repeat(2,minmax(0,1fr))] gap-2">
            <div className="rounded-[14px] border border-border bg-surface px-3 py-3 text-sm font-medium text-ink">{label}</div>
            <div className="rounded-[14px] border border-border bg-brand-soft/40 px-3 py-3 text-center text-lg font-semibold text-ink">{leftValue}</div>
            <div className="rounded-[14px] border border-border bg-brand-soft/15 px-3 py-3 text-center text-lg font-semibold text-ink">{rightValue}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function FigureExportRow({
  locale,
  label,
  description,
  onSaveSvg,
  onSavePng,
  disabled = false,
}: {
  locale: Locale;
  label: string;
  description: string;
  onSaveSvg: () => void;
  onSavePng: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-3 rounded-[18px] border border-border bg-surface px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div className="grid gap-1">
        <strong className="text-sm font-semibold text-ink">{label}</strong>
        <p className="m-0 text-sm leading-6 text-muted">{description}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onSaveSvg} disabled={disabled}>
          {pick(locale, "Save SVG", "SVG 저장")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onSavePng} disabled={disabled}>
          {pick(locale, "Save PNG", "PNG 저장")}
        </Button>
      </div>
    </div>
  );
}

function EnsembleMatrixCard({
  locale,
  ensemble,
  selectedCount,
  notAvailableLabel,
  formatMetric,
}: {
  locale: Locale;
  ensemble: EnsembleSummary;
  selectedCount: number;
  notAvailableLabel: string;
  formatMetric: (value: number | null | undefined, emptyLabel?: string) => string;
}) {
  return (
    <Card as="section" variant="nested" className="grid gap-4 p-4">
      <SectionHeader
        title={pick(locale, "Ensemble confusion matrix", "Ensemble confusion matrix")}
        titleAs="h5"
        description={pick(
          locale,
          `Mean positive probability across ${selectedCount} selected models on the shared ${ensemble.sampleKind} cohort (${ensemble.nSamples} samples).`,
          `선택 모델 ${selectedCount}개의 양성 확률 평균으로 계산한 ${ensemble.sampleKind} 단위 공통 cohort (${ensemble.nSamples}개 샘플) 결과입니다.`
        )}
        aside={<span className={docSiteBadgeClass}>{`${ensemble.nSamples} ${pick(locale, "samples", "샘플")}`}</span>}
      />
      <MetricGrid columns={4}>
        <MetricItem value={formatMetric(ensemble.metrics.accuracy, notAvailableLabel)} label="Accuracy" />
        <MetricItem value={formatMetric(ensemble.metrics.balancedAccuracy, notAvailableLabel)} label={pick(locale, "Balanced acc", "균형 정확도")} />
        <MetricItem value={formatMetric(ensemble.metrics.F1, notAvailableLabel)} label="F1" />
        <MetricItem value={formatMetric(ensemble.metrics.AUROC, notAvailableLabel)} label="AUROC" />
      </MetricGrid>
      <div className="grid gap-2">
        <div className="grid grid-cols-[1.2fr_repeat(2,minmax(0,1fr))] gap-2">
          <div className="rounded-[14px] border border-border bg-surface px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted">
            {pick(locale, "True / Pred", "실제 / 예측")}
          </div>
          <div className="rounded-[14px] border border-border bg-surface px-3 py-2 text-sm font-medium text-ink">{ensemble.labels[0]}</div>
          <div className="rounded-[14px] border border-border bg-surface px-3 py-2 text-sm font-medium text-ink">{ensemble.labels[1]}</div>
        </div>
        {[
          [ensemble.labels[0], ensemble.matrix[0][0], ensemble.matrix[0][1]],
          [ensemble.labels[1], ensemble.matrix[1][0], ensemble.matrix[1][1]],
        ].map(([label, leftValue, rightValue]) => (
          <div key={String(label)} className="grid grid-cols-[1.2fr_repeat(2,minmax(0,1fr))] gap-2">
            <div className="rounded-[14px] border border-border bg-surface px-3 py-3 text-sm font-medium text-ink">{label}</div>
            <div className="rounded-[14px] border border-border bg-brand-soft/40 px-3 py-3 text-center text-lg font-semibold text-ink">{leftValue}</div>
            <div className="rounded-[14px] border border-border bg-brand-soft/15 px-3 py-3 text-center text-lg font-semibold text-ink">{rightValue}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function TrainingPaperFigures({ locale, benchmarkResult, selectedSiteLabel, notAvailableLabel, formatMetric }: Props) {
  const [open, setOpen] = useState(false);
  const [exportFeedback, setExportFeedback] = useState<string | null>(null);
  const completedEntries = [...getCompletedEntries(benchmarkResult)].sort(compareBenchmarkEntries);
  const defaultSelectedArchitectures = completedEntries.slice(0, 3).map((entry) => entry.architecture);
  const completedArchitectureSet = new Set(completedEntries.map((entry) => entry.architecture));
  const [selectedArchitectures, setSelectedArchitectures] = useState<string[]>(defaultSelectedArchitectures);

  useEffect(() => {
    setSelectedArchitectures((current) => {
      const filtered = current.filter((architecture) => completedArchitectureSet.has(architecture));
      return filtered.length ? filtered : defaultSelectedArchitectures;
    });
  }, [benchmarkResult]);

  const selectedEntries = selectedArchitectures
    .map((architecture) => completedEntries.find((entry) => entry.architecture === architecture) ?? null)
    .filter((entry): entry is InitialTrainingBenchmarkEntry => entry !== null);

  const rocSeries = selectedEntries
    .map((entry, index) => ({
      architecture: entry.architecture,
      label: resolveArchitectureLabel(entry.architecture),
      color: FIGURE_COLORS[index % FIGURE_COLORS.length],
      auroc: getMetric(entry, "AUROC"),
      points: getRocPoints(entry),
    }))
    .filter((item) => item.points.length >= 2);

  const rocSvg = rocSeries.length ? buildRocSvg(rocSeries, locale) : "";
  const gapSvg = buildGapSvg(completedEntries, locale);
  const rankingSvg = buildRankingSvg(completedEntries, locale);
  const ensembleSummary = buildEnsembleSummary(selectedEntries);
  const selectedSiteTitle = selectedSiteLabel ?? benchmarkResult.site_id ?? notAvailableLabel;
  const generatedLabel = pick(
    locale,
    `Generated ${new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`,
    `${new Date().toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })} 생성`
  );

  async function handleSavePng(baseName: string, svgMarkup: string) {
    if (!svgMarkup) {
      return;
    }
    try {
      const pngBlob = await svgMarkupToPngBlob(svgMarkup);
      downloadBlob(pngFilename(baseName), pngBlob);
      setExportFeedback(pick(locale, `${baseName} exported as PNG.`, `${baseName} PNG를 저장했습니다.`));
    } catch (error) {
      setExportFeedback(pick(locale, "PNG export failed.", "PNG 저장에 실패했습니다."));
      console.error(error);
    }
  }

  function handleSaveSvg(baseName: string, svgMarkup: string) {
    if (!svgMarkup) {
      return;
    }
    downloadText(svgFilename(baseName), svgMarkup, "image/svg+xml;charset=utf-8");
    setExportFeedback(pick(locale, `${baseName} exported as SVG.`, `${baseName} SVG를 저장했습니다.`));
  }

  function toggleArchitecture(architecture: string) {
    setSelectedArchitectures((current) => {
      if (current.includes(architecture)) {
        return current.length > 1 ? current.filter((item) => item !== architecture) : current;
      }
      return [...current, architecture];
    });
  }

  function handleDownloadHtml() {
    const html = buildPaperReportHtml({
      locale,
      benchmarkResult,
      selectedEntries,
      ensembleSummary,
      rocSvg,
      gapSvg,
      rankingSvg,
      siteLabel: selectedSiteTitle,
      generatedLabel,
      formatMetric,
      notAvailableLabel,
    });
    downloadText(`${slugify(selectedSiteTitle || "kera") || "kera"}-paper-figures.html`, html, "text/html;charset=utf-8");
    setExportFeedback(pick(locale, "Paper-ready HTML exported.", "논문용 HTML을 저장했습니다."));
  }

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {pick(locale, "Paper figures", "논문 작성용 보기")}
      </Button>

      {open ? (
        <div
          className="fixed inset-0 z-80 overflow-y-auto bg-black/45 p-4 backdrop-blur-sm md:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={pick(locale, "Paper-ready benchmark figures", "논문용 benchmark 정리")}
        >
          <Card as="div" variant="panel" className="mx-auto my-4 grid w-full max-w-[min(96vw,1540px)] gap-4 p-5 md:p-6">
            <SectionHeader
              title={pick(locale, "Paper-ready benchmark figures", "논문용 benchmark 정리")}
              titleAs="h4"
              description={pick(
                locale,
                "Collect ROC, generalization gap, ranking, confusion matrices, and the benchmark summary in one export-friendly view.",
                "ROC, 일반화 격차, 모델 순위, confusion matrix, benchmark 요약을 한 화면에 모아 보고 내보낼 수 있습니다."
              )}
              aside={
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <span className={docSiteBadgeClass}>{selectedSiteTitle}</span>
                  <Button type="button" variant="primary" size="sm" onClick={handleDownloadHtml}>
                    {pick(locale, "Save HTML", "HTML 저장")}
                  </Button>
                </div>
              }
            />

            <Card as="section" variant="nested" className="grid gap-4 p-4">
              <SectionHeader
                title={pick(locale, "Model selection", "모델 선택")}
                titleAs="h5"
                description={pick(
                  locale,
                  "Select the models to compare in ROC and confusion-matrix views. Ranking and gap figures still summarize the full benchmark.",
                  "ROC 및 confusion matrix에서 비교할 모델을 고릅니다. 순위와 일반화 격차 도표는 전체 benchmark를 계속 요약합니다."
                )}
                aside={<span className={docSectionLabelClass}>{generatedLabel}</span>}
              />
              <div className="flex flex-wrap gap-2">
                {completedEntries.map((entry) => {
                  const active = selectedArchitectures.includes(entry.architecture);
                  return (
                    <button
                      key={entry.architecture}
                      type="button"
                      className={cn(
                        "inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-semibold transition",
                        active ? "border-brand/20 bg-brand-soft text-brand" : "border-border bg-surface text-muted hover:border-brand/20 hover:text-ink"
                      )}
                      onClick={() => toggleArchitecture(entry.architecture)}
                    >
                      {resolveArchitectureLabel(entry.architecture)}
                    </button>
                  );
                })}
              </div>
            </Card>

            <Card as="section" variant="nested" className="grid gap-4 p-4">
              <SectionHeader
                title={pick(locale, "Figure export", "Figure Export")}
                titleAs="h5"
                description={pick(
                  locale,
                  "Export the core manuscript figures directly from this benchmark view. SVG is the better default for paper figures; PNG is useful for slides.",
                  "이 benchmark 화면에서 핵심 논문 도표를 바로 저장합니다. 논문용이면 SVG가 기본값이고, PNG는 슬라이드용으로 좋습니다."
                )}
                aside={
                  exportFeedback ? (
                    <span className={docSectionLabelClass}>{exportFeedback}</span>
                  ) : (
                    <span className={docSectionLabelClass}>{pick(locale, "Top 3 export set", "핵심 3개 도표")}</span>
                  )
                }
              />
              <div className="grid gap-3">
                <FigureExportRow
                  locale={locale}
                  label={pick(locale, "Top ROC comparison", "Top ROC 비교")}
                  description={pick(
                    locale,
                    "Exports the current selected-model ROC comparison.",
                    "현재 선택된 모델들의 ROC 비교 도표를 저장합니다."
                  )}
                  onSaveSvg={() => handleSaveSvg(`${selectedSiteTitle} roc-comparison`, rocSvg)}
                  onSavePng={() => void handleSavePng(`${selectedSiteTitle} roc-comparison`, rocSvg)}
                  disabled={!rocSvg}
                />
                <FigureExportRow
                  locale={locale}
                  label={pick(locale, "Val vs Test gap", "Val vs Test gap")}
                  description={pick(
                    locale,
                    "Exports the validation-to-test generalization gap figure for the full benchmark.",
                    "전체 benchmark의 검증-테스트 일반화 격차 도표를 저장합니다."
                  )}
                  onSaveSvg={() => handleSaveSvg(`${selectedSiteTitle} generalization-gap`, gapSvg)}
                  onSavePng={() => void handleSavePng(`${selectedSiteTitle} generalization-gap`, gapSvg)}
                />
                <FigureExportRow
                  locale={locale}
                  label={pick(locale, "AUROC / Balanced Acc ranking", "AUROC / Balanced Acc ranking")}
                  description={pick(
                    locale,
                    "Exports the reviewer-friendly model ranking bar chart.",
                    "reviewer용 모델 순위 막대그래프를 저장합니다."
                  )}
                  onSaveSvg={() => handleSaveSvg(`${selectedSiteTitle} model-ranking`, rankingSvg)}
                  onSavePng={() => void handleSavePng(`${selectedSiteTitle} model-ranking`, rankingSvg)}
                />
              </div>
            </Card>

            <MetricGrid columns={4}>
              <MetricItem value={completedEntries.length} label={pick(locale, "completed", "완료 모델")} />
              <MetricItem value={benchmarkResult.failures.length} label={pick(locale, "failed", "실패 모델")} />
              <MetricItem value={resolveArchitectureLabel(benchmarkResult.best_architecture)} label={pick(locale, "best val", "val 최고")} />
              <MetricItem value={resolveArchitectureLabel(completedEntries[0]?.architecture ?? null)} label={pick(locale, "best test", "test 최고")} />
            </MetricGrid>

            <div className="grid gap-4 xl:grid-cols-2">
              <Card as="section" variant="nested" className="grid gap-4 p-4">
                <SectionHeader
                  title={pick(locale, "Figure 1 · ROC curve", "Figure 1 · ROC curve")}
                  titleAs="h5"
                  description={pick(
                    locale,
                    "Use this to compare the discrimination of the selected models directly.",
                    "선택한 모델들의 분리 성능을 직접 비교할 때 사용합니다."
                  )}
                />
                {rocSvg ? (
                  <div className="overflow-x-auto rounded-[18px] border border-border bg-surface px-2 py-2" dangerouslySetInnerHTML={{ __html: rocSvg }} />
                ) : (
                  <div className="rounded-[18px] border border-dashed border-border bg-surface px-4 py-6 text-sm leading-6 text-muted">
                    {pick(locale, "ROC data is not available for the selected models.", "선택한 모델의 ROC 데이터가 없습니다.")}
                  </div>
                )}
              </Card>

              <Card as="section" variant="nested" className="grid gap-4 p-4">
                <SectionHeader
                  title={pick(locale, "Figure 2 · Generalization gap", "Figure 2 · 일반화 격차")}
                  titleAs="h5"
                  description={pick(
                    locale,
                    "Best validation accuracy is compared with held-out test accuracy to expose overfitting.",
                    "최고 검증 정확도와 테스트 정확도를 비교해 과적합 신호를 확인합니다."
                  )}
                />
                <div className="overflow-x-auto rounded-[18px] border border-border bg-surface px-2 py-2" dangerouslySetInnerHTML={{ __html: gapSvg }} />
              </Card>
            </div>

            <Card as="section" variant="nested" className="grid gap-4 p-4">
              <SectionHeader
                title={pick(locale, "Figure 3 · Model ranking", "Figure 3 · 모델 순위")}
                titleAs="h5"
                description={pick(
                  locale,
                  "AUROC and balanced accuracy are plotted together so reviewers can read overall ranking at a glance.",
                  "AUROC와 균형 정확도를 함께 그려 전체 순위를 한눈에 읽을 수 있게 합니다."
                )}
              />
              <div className="overflow-x-auto rounded-[18px] border border-border bg-surface px-2 py-2" dangerouslySetInnerHTML={{ __html: rankingSvg }} />
            </Card>

            <Card as="section" variant="nested" className="grid gap-4 p-4">
              <SectionHeader
                title={pick(locale, "Selected confusion matrices", "선택 모델 confusion matrix")}
                titleAs="h5"
                description={pick(
                  locale,
                  "Keep the selected model set small here. Three or fewer panels usually read best in a manuscript. When compatible per-sample predictions exist, the panel also shows an ensemble confusion matrix.",
                  "여기서는 선택 모델 수를 작게 유지하는 편이 좋습니다. 논문 그림에는 보통 3개 이하가 가장 읽기 쉽고, 샘플 단위 예측이 호환되면 ensemble confusion matrix도 같이 보여줍니다."
                )}
              />
              {ensembleSummary ? (
                <EnsembleMatrixCard
                  locale={locale}
                  ensemble={ensembleSummary}
                  selectedCount={selectedEntries.length}
                  notAvailableLabel={notAvailableLabel}
                  formatMetric={formatMetric}
                />
              ) : (
                <div className="rounded-[18px] border border-dashed border-border bg-surface px-4 py-4 text-sm leading-6 text-muted">
                  {selectedEntries.length < 2
                    ? pick(locale, "Select at least two models to build an ensemble confusion matrix.", "ensemble confusion matrix를 만들려면 모델을 두 개 이상 선택하세요.")
                    : pick(
                        locale,
                        "A shared sample cohort could not be found across the selected models yet. Re-run the benchmark after this update, or choose models with the same sample granularity.",
                        "선택한 모델들 사이에 공통 샘플 cohort를 찾지 못했습니다. 이 업데이트 이후 benchmark를 다시 돌리거나, 같은 샘플 단위 모델끼리 선택하세요."
                      )}
                </div>
              )}
              <div className="grid gap-4 xl:grid-cols-3">
                {selectedEntries.map((entry) => (
                  <ConfusionMatrixCard
                    key={`matrix-${entry.architecture}`}
                    locale={locale}
                    entry={entry}
                    notAvailableLabel={notAvailableLabel}
                    formatMetric={formatMetric}
                  />
                ))}
              </div>
            </Card>

            <Card as="section" variant="nested" className="grid gap-4 p-4">
              <SectionHeader
                title={pick(locale, "Benchmark summary table", "benchmark 요약 표")}
                titleAs="h5"
                description={pick(
                  locale,
                  "This is the same benchmark result reorganized for writing, discussion, and appendix export.",
                  "같은 benchmark 결과를 글쓰기, 토의, 부록 정리에 맞게 다시 배열한 표입니다."
                )}
              />
              <div className="overflow-x-auto">
                <div className="grid min-w-[1080px] gap-2">
                  <div className="grid gap-3 rounded-[18px] border border-border bg-surface px-4 py-3 text-sm font-medium text-muted md:grid-cols-[1.35fr_0.9fr_0.9fr_0.9fr_1fr_0.8fr_1.5fr]">
                    <span>{pick(locale, "architecture", "아키텍처")}</span>
                    <span>{pick(locale, "best val acc", "최고 검증 정확도")}</span>
                    <span>{pick(locale, "test acc", "테스트 정확도")}</span>
                    <span>AUROC</span>
                    <span>{pick(locale, "balanced acc", "균형 정확도")}</span>
                    <span>F1</span>
                    <span>{pick(locale, "version", "버전")}</span>
                  </div>
                  {completedEntries.map((entry) => (
                    <div
                      key={`paper-summary-${entry.architecture}`}
                      className="grid gap-3 rounded-[18px] border border-border bg-surface-muted/80 px-4 py-3 text-sm md:grid-cols-[1.35fr_0.9fr_0.9fr_0.9fr_1fr_0.8fr_1.5fr]"
                    >
                      <span className="font-medium text-ink">{resolveArchitectureLabel(entry.architecture)}</span>
                      <span>{formatMetric(entry.result?.best_val_acc, notAvailableLabel)}</span>
                      <span>{formatMetric(getMetric(entry, "accuracy"), notAvailableLabel)}</span>
                      <span>{formatMetric(getMetric(entry, "AUROC"), notAvailableLabel)}</span>
                      <span>{formatMetric(getMetric(entry, "balanced_accuracy"), notAvailableLabel)}</span>
                      <span>{formatMetric(getMetric(entry, "F1"), notAvailableLabel)}</span>
                      <span className="break-words">{entry.model_version?.version_name ?? notAvailableLabel}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>

            <div className="flex flex-wrap justify-end gap-3 border-t border-border/70 pt-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                {pick(locale, "Close", "닫기")}
              </Button>
              <Button type="button" variant="primary" onClick={handleDownloadHtml}>
                {pick(locale, "Save HTML", "HTML 저장")}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </>
  );
}
