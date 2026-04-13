"use client";

import { pick, type Locale } from "../../lib/i18n";

export function formatProbability(
  value: number | null | undefined,
  emptyLabel = "n/a",
): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return emptyLabel;
  }
  return `${Math.round(value * 100)}%`;
}

export function formatSemanticScore(
  value: number | null | undefined,
  emptyLabel = "n/a",
): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return emptyLabel;
  }
  return value.toFixed(3);
}

export function formatImageQualityScore(
  value: number | null | undefined,
  emptyLabel = "n/a",
): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return emptyLabel;
  }
  return `${value.toFixed(1)}`;
}

export function formatAiClinicMetadataField(
  locale: Locale,
  field: string,
): string {
  switch (field) {
    case "representative_view":
      return pick(locale, "view", "view");
    case "visit_status":
      return pick(locale, "status", "status");
    case "active_stage":
      return pick(locale, "active stage", "active stage");
    case "contact_lens_use":
      return pick(locale, "contact lens", "contact lens");
    case "predisposing_factor":
      return pick(locale, "predisposing", "predisposing");
    case "smear_result":
      return pick(locale, "smear", "smear");
    case "polymicrobial":
      return pick(locale, "polymicrobial", "polymicrobial");
    default:
      return field.replaceAll("_", " ");
  }
}

export function predictedClassConfidence(
  predictedLabel: string | null | undefined,
  probability: number | null | undefined,
): number | null {
  if (typeof probability !== "number" || Number.isNaN(probability)) {
    return null;
  }
  if (predictedLabel === "bacterial") {
    return 1 - probability;
  }
  return probability;
}

export function confidencePercent(
  value: number | null | undefined,
): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

export function confidenceTone(
  percent: number,
): "high" | "medium" | "low" {
  if (percent >= 80) {
    return "high";
  }
  if (percent >= 60) {
    return "medium";
  }
  return "low";
}
