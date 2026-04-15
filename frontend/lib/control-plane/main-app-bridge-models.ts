import "server-only";

import { NextRequest } from "next/server";

import type {
  AggregationRecord,
  AggregationRunResponse,
  AuthUser,
  FederatedPrivacyReportResponse,
  FederationMonitoringSummaryResponse,
  ModelUpdateRecord,
  ModelVersionRecord,
  ReleaseRolloutRecord,
} from "../types";
import { makeControlPlaneId } from "./crypto";
import { controlPlaneSql } from "./db";
import { requireMainAppBridgeUser } from "./main-app-bridge-users";
import { normalizeStringArray, rowValue, trimText } from "./main-app-bridge-shared";
import {
  appendAuditEvent,
  createReleaseRollout as createStoreReleaseRollout,
  federationMonitoringSummary,
  listReleaseRollouts as listStoreReleaseRollouts,
} from "./store";

function assertAdminWorkspacePermission(user: AuthUser): void {
  if (user.role !== "admin" && user.role !== "site_admin") {
    throw new Error("Admin or site admin access required.");
  }
}

function assertPlatformAdmin(user: AuthUser): void {
  if (user.role !== "admin") {
    throw new Error("Platform admin access required.");
  }
}

function recordFromValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringFromValue(value: unknown): string | null {
  const normalized = trimText(value);
  return normalized || null;
}

function optionalStringFromValue(value: unknown): string | undefined {
  const normalized = trimText(value);
  return normalized || undefined;
}

function numberFromValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function booleanFromValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  return undefined;
}

function serializeFederatedDpAccountingSummary(value: unknown): AggregationRecord["dp_accounting"] {
  const record = recordFromValue(value);
  const formalDpAccounting = booleanFromValue(record.formal_dp_accounting);
  const sites = Array.isArray(record.sites)
    ? record.sites
        .map((item) => {
          const siteRecord = recordFromValue(item);
          const siteId = stringFromValue(siteRecord.site_id);
          if (!siteId) {
            return null;
          }
          return {
            site_id: siteId,
            accounted_updates: Math.max(0, Number(numberFromValue(siteRecord.accounted_updates) ?? 0)),
            epsilon: numberFromValue(siteRecord.epsilon),
            delta: numberFromValue(siteRecord.delta),
          };
        })
        .filter(Boolean) as NonNullable<AggregationRecord["dp_accounting"]>["sites"]
    : [];
  if (!formalDpAccounting && sites.length === 0 && !stringFromValue(record.accountant)) {
    return null;
  }
  const guardrail = evaluateFederatedDpBudgetGuardrail({
    formal_dp_accounting: Boolean(formalDpAccounting),
    epsilon: numberFromValue(record.epsilon),
  });
  return {
    formal_dp_accounting: Boolean(formalDpAccounting),
    accountant: stringFromValue(record.accountant),
    accountant_scope: stringFromValue(record.accountant_scope),
    subsampling_applied: booleanFromValue(record.subsampling_applied),
    assumptions: normalizeStringArray(record.assumptions),
    accounted_updates: Math.max(0, Number(numberFromValue(record.accounted_updates) ?? 0)),
    accounted_sites: numberFromValue(record.accounted_sites),
    epsilon: numberFromValue(record.epsilon),
    delta: numberFromValue(record.delta),
    sampling_rate: numberFromValue(record.sampling_rate),
    target_delta: numberFromValue(record.target_delta) ?? numberFromValue(record.delta),
    aggregated_participant_count: numberFromValue(record.aggregated_participant_count),
    available_participant_count: numberFromValue(record.available_participant_count),
    sites,
  };
}

function serializeFederatedParticipationSummary(value: unknown): AggregationRecord["participation_summary"] {
  const record = recordFromValue(value);
  const aggregatedSiteIds = normalizeStringArray(record.aggregated_site_ids);
  const availableSiteIds = normalizeStringArray(record.available_site_ids);
  const missingSiteIds = normalizeStringArray(record.missing_site_ids);
  const aggregatedSiteCount = Math.max(
    0,
    Number(numberFromValue(record.aggregated_site_count) ?? aggregatedSiteIds.length),
  );
  const availableSiteCount = numberFromValue(record.available_site_count);
  const missingSiteCount = numberFromValue(record.missing_site_count);
  const participationRate = numberFromValue(record.participation_rate);
  if (
    aggregatedSiteCount <= 0 &&
    aggregatedSiteIds.length === 0 &&
    availableSiteIds.length === 0 &&
    missingSiteIds.length === 0
  ) {
    return null;
  }
  return {
    aggregated_site_ids: aggregatedSiteIds,
    aggregated_site_count: aggregatedSiteCount,
    available_site_ids: availableSiteIds,
    available_site_count: availableSiteCount,
    missing_site_ids: missingSiteIds,
    missing_site_count: missingSiteCount,
    participation_rate: participationRate,
  };
}

function serializeFederatedDpBudgetRecord(value: unknown): AggregationRecord["dp_budget"] {
  const record = recordFromValue(value);
  const formalDpAccounting = booleanFromValue(record.formal_dp_accounting);
  const lastParticipationSummary = serializeFederatedParticipationSummary(record.last_participation_summary);
  const sites = Array.isArray(record.sites)
    ? record.sites
        .map((item) => {
          const siteRecord = recordFromValue(item);
          const siteId = stringFromValue(siteRecord.site_id);
          if (!siteId) {
            return null;
          }
          return {
            site_id: siteId,
            accounted_updates: Math.max(0, Number(numberFromValue(siteRecord.accounted_updates) ?? 0)),
            accounted_aggregations: Math.max(0, Number(numberFromValue(siteRecord.accounted_aggregations) ?? 0)),
            epsilon: numberFromValue(siteRecord.epsilon),
            delta: numberFromValue(siteRecord.delta),
          };
        })
        .filter(Boolean) as NonNullable<AggregationRecord["dp_budget"]>["sites"]
    : [];
  if (!formalDpAccounting && sites.length === 0 && !stringFromValue(record.accountant)) {
    return null;
  }
  const guardrail = evaluateFederatedDpBudgetGuardrail({
    formal_dp_accounting: Boolean(formalDpAccounting),
    epsilon: numberFromValue(record.epsilon),
  });
  return {
    formal_dp_accounting: Boolean(formalDpAccounting),
    accountant: stringFromValue(record.accountant),
    accountant_scope: stringFromValue(record.accountant_scope),
    subsampling_applied: booleanFromValue(record.subsampling_applied),
    assumptions: normalizeStringArray(record.assumptions),
    accounted_updates: Math.max(0, Number(numberFromValue(record.accounted_updates) ?? 0)),
    accounted_aggregations: Math.max(0, Number(numberFromValue(record.accounted_aggregations) ?? 0)),
    accounted_sites: numberFromValue(record.accounted_sites),
    epsilon: numberFromValue(record.epsilon),
    delta: numberFromValue(record.delta),
    sampling_rate: numberFromValue(record.sampling_rate) ?? lastParticipationSummary?.participation_rate ?? null,
    target_delta: numberFromValue(record.target_delta),
    warn_epsilon: numberFromValue(record.warn_epsilon) ?? guardrail.warn_epsilon,
    max_epsilon: numberFromValue(record.max_epsilon) ?? guardrail.max_epsilon,
    guardrail_status: stringFromValue(record.guardrail_status) ?? guardrail.guardrail_status,
    guardrail_warnings: normalizeStringArray(record.guardrail_warnings) ?? guardrail.guardrail_warnings,
    aggregated_participant_count:
      numberFromValue(record.aggregated_participant_count) ?? lastParticipationSummary?.aggregated_site_count ?? null,
    available_participant_count:
      numberFromValue(record.available_participant_count) ?? lastParticipationSummary?.available_site_count ?? null,
    sites,
    last_accounted_aggregation_id: stringFromValue(record.last_accounted_aggregation_id),
    last_accounted_at: stringFromValue(record.last_accounted_at),
    last_accounted_new_version_name: stringFromValue(record.last_accounted_new_version_name),
    last_accounted_base_model_version_id: stringFromValue(record.last_accounted_base_model_version_id),
    last_participation_summary: lastParticipationSummary,
  };
}

const GAUSSIAN_RDP_ORDERS = [2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 48, 64, 96, 128, 256] as const;

function federatedDpAccountantMode(): string {
  const raw = String(process.env.KERA_FEDERATED_DP_ACCOUNTANT_MODE ?? "").trim().toLowerCase();
  if (raw === "gaussian_basic_composition" || raw === "gaussian_rdp_full_participation") {
    return raw;
  }
  return "gaussian_rdp_poisson_subsampled";
}

function federatedDpWarnEpsilon(): number | null {
  const value = numberFromValue(process.env.KERA_FEDERATED_DP_WARN_EPSILON);
  return value !== null && value > 0 ? value : null;
}

function federatedDpMaxEpsilon(): number | null {
  const value = numberFromValue(process.env.KERA_FEDERATED_DP_MAX_EPSILON);
  return value !== null && value > 0 ? value : null;
}

function evaluateFederatedDpBudgetGuardrail(
  privacyBudget: Pick<NonNullable<AggregationRecord["dp_budget"]>, "formal_dp_accounting" | "epsilon"> | null | undefined,
): {
  warn_epsilon: number | null;
  max_epsilon: number | null;
  guardrail_status: string;
  guardrail_warnings: string[];
} {
  const warnEpsilon = federatedDpWarnEpsilon();
  const maxEpsilon = federatedDpMaxEpsilon();
  if (!privacyBudget?.formal_dp_accounting || typeof privacyBudget.epsilon !== "number" || Number.isNaN(privacyBudget.epsilon)) {
    return {
      warn_epsilon: warnEpsilon,
      max_epsilon: maxEpsilon,
      guardrail_status: "unavailable",
      guardrail_warnings: [],
    };
  }
  const warnings: string[] = [];
  let status = "not_configured";
  if (warnEpsilon !== null && privacyBudget.epsilon >= warnEpsilon) {
    status = "warning";
    warnings.push("epsilon_warn_threshold_reached");
  } else if (warnEpsilon !== null) {
    status = "ok";
  }
  if (maxEpsilon !== null && privacyBudget.epsilon >= maxEpsilon) {
    status = "blocked";
    warnings.push("epsilon_max_threshold_exceeded");
  } else if (status === "not_configured" && maxEpsilon !== null) {
    status = "ok";
  }
  return {
    warn_epsilon: warnEpsilon,
    max_epsilon: maxEpsilon,
    guardrail_status: status,
    guardrail_warnings: warnings,
  };
}

function buildFederatedPrivacyReportLimitations(
  privacyBudget: AggregationRecord["dp_budget"] | null | undefined,
): string[] {
  if (!privacyBudget) {
    return ["privacy_budget_unavailable"];
  }
  if (!privacyBudget.formal_dp_accounting) {
    return ["formal_dp_accounting_unavailable"];
  }

  const limitations: string[] = [];
  if (!privacyBudget.subsampling_applied) {
    limitations.push("full_participation_bound_used");
  }
  limitations.push("no_secure_aggregation");
  if (privacyBudget.accountant !== "gaussian_prv_subsampled") {
    limitations.push("prv_accountant_not_enabled");
  }
  return limitations;
}

function normalizeParticipationRate(value: unknown): number | null {
  const normalized = numberFromValue(value);
  if (normalized === null || !Number.isFinite(normalized) || normalized <= 0) {
    return null;
  }
  return Math.min(1, Math.max(0, normalized));
}

function logAddExp(left: number, right: number): number {
  if (left === Number.NEGATIVE_INFINITY) {
    return right;
  }
  if (right === Number.NEGATIVE_INFINITY) {
    return left;
  }
  const maxValue = Math.max(left, right);
  const minValue = Math.min(left, right);
  return maxValue + Math.log1p(Math.exp(minValue - maxValue));
}

function gaussianFullParticipationRdpComposedEpsilon(
  noiseMultiplier: number,
  delta: number,
  steps: number,
): { epsilon: number; optimalOrder: number } {
  let best: { epsilon: number; optimalOrder: number } | null = null;
  for (const order of GAUSSIAN_RDP_ORDERS) {
    const rdp = Math.max(1, steps) * (order / (2 * noiseMultiplier ** 2));
    const epsilon = rdp + Math.log(1 / delta) / (order - 1);
    if (!Number.isFinite(epsilon)) {
      continue;
    }
    if (!best || epsilon < best.epsilon) {
      best = { epsilon, optimalOrder: order };
    }
  }
  if (!best) {
    throw new Error("Unable to compute Gaussian RDP epsilon.");
  }
  return best;
}

function gaussianPoissonSubsampledRdp(order: number, participationRate: number, noiseMultiplier: number): number {
  if (participationRate >= 1) {
    return order / (2 * noiseMultiplier ** 2);
  }
  const logQ = Math.log(participationRate);
  const logOneMinusQ = Math.log1p(-participationRate);
  let logA = Number.NEGATIVE_INFINITY;
  for (let index = 0; index <= order; index += 1) {
    const logBinomial = Math.log(combination(order, index));
    const privacyLoss = ((index * index) - index) / (2 * noiseMultiplier ** 2);
    const logTerm = logBinomial + index * logQ + (order - index) * logOneMinusQ + privacyLoss;
    logA = logAddExp(logA, logTerm);
  }
  return logA / (order - 1);
}

function combination(n: number, k: number): number {
  if (k < 0 || k > n) {
    return 0;
  }
  if (k === 0 || k === n) {
    return 1;
  }
  const normalizedK = Math.min(k, n - k);
  let result = 1;
  for (let index = 1; index <= normalizedK; index += 1) {
    result = (result * (n - normalizedK + index)) / index;
  }
  return result;
}

function gaussianPoissonSubsampledComposedEpsilon(
  participationRate: number,
  noiseMultiplier: number,
  delta: number,
  steps: number,
): { epsilon: number; optimalOrder: number } {
  if (participationRate >= 1) {
    return gaussianFullParticipationRdpComposedEpsilon(noiseMultiplier, delta, steps);
  }
  let best: { epsilon: number; optimalOrder: number } | null = null;
  for (const order of GAUSSIAN_RDP_ORDERS) {
    const rdp = Math.max(1, steps) * gaussianPoissonSubsampledRdp(order, participationRate, noiseMultiplier);
    const epsilon = rdp + Math.log(1 / delta) / (order - 1);
    if (!Number.isFinite(epsilon)) {
      continue;
    }
    if (!best || epsilon < best.epsilon) {
      best = { epsilon, optimalOrder: order };
    }
  }
  if (!best) {
    throw new Error("Unable to compute subsampled Gaussian RDP epsilon.");
  }
  return best;
}

function serializeParticipationAwareAccounting(
  accountingValue: unknown,
  participationSummary?: AggregationRecord["participation_summary"],
): AggregationRecord["dp_accounting"] {
  const accounting = serializeFederatedDpAccountingSummary(accountingValue);
  if (!accounting?.formal_dp_accounting) {
    return accounting;
  }
  if (federatedDpAccountantMode() !== "gaussian_rdp_poisson_subsampled" || accounting.subsampling_applied) {
    return accounting;
  }
  const rawRecord = recordFromValue(accountingValue);
  const participationRate = normalizeParticipationRate(participationSummary?.participation_rate);
  if (participationRate === null || participationRate >= 1) {
    return accounting;
  }
  const noiseMultiplier = numberFromValue(rawRecord.noise_multiplier);
  const clippingNorm = numberFromValue(rawRecord.clipping_norm);
  const localSteps = Math.max(1, Number(numberFromValue(rawRecord.local_steps) ?? 1));
  const delta =
    numberFromValue(rawRecord.target_delta) ??
    numberFromValue(rawRecord.single_round_delta) ??
    numberFromValue(rawRecord.delta);
  if (noiseMultiplier === null || clippingNorm === null || delta === null || !(delta > 0 && delta < 1)) {
    return accounting;
  }
  const recomputed = gaussianPoissonSubsampledComposedEpsilon(participationRate, noiseMultiplier, delta, localSteps);
  return {
    ...accounting,
    accountant: "gaussian_rdp_poisson_subsampled",
    subsampling_applied: true,
    epsilon: recomputed.epsilon,
    delta,
    assumptions: Array.from(
      new Set(
        [
          ...(accounting.assumptions ?? []).filter((item) => item !== "full_participation" && item !== "no_subsampling"),
          "poisson_subsampling",
        ],
      ),
    ).sort(),
  };
}

function summarizeFederatedDpAccountingFromUpdates(
  updates: Array<{ site_id?: string | null; payload_json?: Record<string, unknown> | null }>,
  participationSummary?: AggregationRecord["participation_summary"],
): AggregationRecord["dp_accounting"] {
  const bySite = new Map<
    string,
    {
      site_id: string;
      accounted_updates: number;
      epsilon: number;
      delta: number;
    }
  >();
  let formalDpAccounting = false;
  let accountant: string | null = null;
  let accountantScope: string | null = null;
  let subsamplingApplied = false;
  const assumptions = new Set<string>();
  let accountedUpdates = 0;
  let epsilon = 0;
  let delta = 0;
  for (const update of updates) {
    const accounting = serializeParticipationAwareAccounting(update.payload_json?.dp_accounting, participationSummary);
    if (!accounting?.formal_dp_accounting) {
      continue;
    }
    formalDpAccounting = true;
    accountant ||= accounting.accountant ?? null;
    accountantScope ||= accounting.accountant_scope ?? null;
    subsamplingApplied = subsamplingApplied || Boolean(accounting.subsampling_applied);
    for (const item of accounting.assumptions ?? []) {
      if (item) {
        assumptions.add(item);
      }
    }
    const siteId = trimText(update.site_id) || "unknown";
    const entry = bySite.get(siteId) ?? {
      site_id: siteId,
      accounted_updates: 0,
      epsilon: 0,
      delta: 0,
    };
    entry.accounted_updates += 1;
    entry.epsilon += Number(accounting.epsilon ?? 0);
    entry.delta += Number(accounting.delta ?? 0);
    bySite.set(siteId, entry);
    accountedUpdates += 1;
    epsilon += Number(accounting.epsilon ?? 0);
    delta += Number(accounting.delta ?? 0);
  }
  if (!formalDpAccounting) {
    return null;
  }
  return {
    formal_dp_accounting: true,
    accountant,
    accountant_scope: accountantScope,
    subsampling_applied: subsamplingApplied,
    assumptions: Array.from(assumptions).sort(),
    accounted_updates: accountedUpdates,
    accounted_sites: bySite.size,
    epsilon,
    delta,
    sampling_rate: participationSummary?.participation_rate ?? null,
    target_delta:
      updates
        .map((item) => {
          const record = recordFromValue(item.payload_json?.dp_accounting);
          return numberFromValue(record.target_delta) ?? numberFromValue(record.single_round_delta) ?? numberFromValue(record.delta);
        })
        .find((item) => item !== null) ?? null,
    aggregated_participant_count: participationSummary?.aggregated_site_count ?? null,
    available_participant_count: participationSummary?.available_site_count ?? null,
    sites: Array.from(bySite.values()).sort((left, right) => left.site_id.localeCompare(right.site_id)),
  };
}

function accumulateFederatedDpBudgetRecord(
  priorBudget: AggregationRecord["dp_budget"],
  currentSummary: AggregationRecord["dp_accounting"],
  metadata: {
    aggregation_id?: string | null;
    created_at?: string | null;
    new_version_name?: string | null;
    base_model_version_id?: string | null;
    participation_summary?: AggregationRecord["participation_summary"];
  },
): AggregationRecord["dp_budget"] {
  const previousSites = new Map(
    (priorBudget?.sites ?? []).map((item) => [
      item.site_id,
      {
        ...item,
        accounted_updates: Number(item.accounted_updates ?? 0),
        accounted_aggregations: Number(item.accounted_aggregations ?? 0),
        epsilon: Number(item.epsilon ?? 0),
        delta: Number(item.delta ?? 0),
      },
    ]),
  );
  if (!currentSummary?.formal_dp_accounting) {
    return priorBudget ?? null;
  }
  for (const site of currentSummary.sites) {
    const existing = previousSites.get(site.site_id) ?? {
      site_id: site.site_id,
      accounted_updates: 0,
      accounted_aggregations: 0,
      epsilon: 0,
      delta: 0,
    };
    existing.accounted_updates += Number(site.accounted_updates ?? 0);
    existing.accounted_aggregations += 1;
    existing.epsilon += Number(site.epsilon ?? 0);
    existing.delta += Number(site.delta ?? 0);
    previousSites.set(site.site_id, existing);
  }
  const accumulatedBudget: NonNullable<AggregationRecord["dp_budget"]> = {
    formal_dp_accounting: true,
    accountant: currentSummary.accountant ?? priorBudget?.accountant ?? null,
    accountant_scope: currentSummary.accountant_scope ?? priorBudget?.accountant_scope ?? null,
    subsampling_applied: Boolean(currentSummary.subsampling_applied ?? priorBudget?.subsampling_applied ?? false),
    assumptions: Array.from(
      new Set([...(priorBudget?.assumptions ?? []), ...(currentSummary.assumptions ?? [])]),
    ).sort(),
    accounted_updates: Number(priorBudget?.accounted_updates ?? 0) + Number(currentSummary.accounted_updates ?? 0),
    accounted_aggregations: Number(priorBudget?.accounted_aggregations ?? 0) + 1,
    accounted_sites: previousSites.size,
    epsilon: Number(priorBudget?.epsilon ?? 0) + Number(currentSummary.epsilon ?? 0),
    delta: Number(priorBudget?.delta ?? 0) + Number(currentSummary.delta ?? 0),
    sampling_rate: currentSummary.sampling_rate ?? priorBudget?.sampling_rate ?? null,
    target_delta: currentSummary.target_delta ?? priorBudget?.target_delta ?? null,
    warn_epsilon: priorBudget?.warn_epsilon ?? null,
    max_epsilon: priorBudget?.max_epsilon ?? null,
    guardrail_status: priorBudget?.guardrail_status ?? null,
    guardrail_warnings: priorBudget?.guardrail_warnings ?? [],
    aggregated_participant_count:
      currentSummary.aggregated_participant_count ?? priorBudget?.aggregated_participant_count ?? null,
    available_participant_count:
      currentSummary.available_participant_count ?? priorBudget?.available_participant_count ?? null,
    sites: Array.from(previousSites.values()).sort((left, right) => left.site_id.localeCompare(right.site_id)),
    last_accounted_aggregation_id: trimText(metadata.aggregation_id) || priorBudget?.last_accounted_aggregation_id || null,
    last_accounted_at: trimText(metadata.created_at) || priorBudget?.last_accounted_at || null,
    last_accounted_new_version_name:
      trimText(metadata.new_version_name) || priorBudget?.last_accounted_new_version_name || null,
    last_accounted_base_model_version_id:
      trimText(metadata.base_model_version_id) || priorBudget?.last_accounted_base_model_version_id || null,
    last_participation_summary: metadata.participation_summary ?? priorBudget?.last_participation_summary ?? null,
  };
  const guardrail = evaluateFederatedDpBudgetGuardrail(accumulatedBudget);
  return {
    ...accumulatedBudget,
    warn_epsilon: guardrail.warn_epsilon,
    max_epsilon: guardrail.max_epsilon,
    guardrail_status: guardrail.guardrail_status,
    guardrail_warnings: guardrail.guardrail_warnings,
  };
}

function isoStringOrNull(value: unknown): string | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function numberRecordFromValue(value: unknown): Record<string, number> | null {
  const record = recordFromValue(value);
  const entries = Object.entries(record)
    .map(([key, rawValue]) => [key, numberFromValue(rawValue)] as const)
    .filter((entry): entry is readonly [string, number] => entry[1] !== null);
  return entries.length ? Object.fromEntries(entries) : null;
}

function serializeMainModelVersionRow(row: Record<string, unknown>): ModelVersionRecord {
  const payload = recordFromValue(rowValue<unknown>(row as never, "payload_json"));
  const metadata = recordFromValue(rowValue<unknown>(row as never, "metadata_json"));
  const merged = { ...payload, ...metadata };
  const rowReady = rowValue<boolean | null>(row as never, "ready");
  const rowCurrent = rowValue<boolean | null>(row as never, "is_current");
  return {
    version_id: trimText(rowValue<string>(row as never, "version_id")) || trimText(merged.version_id),
    version_name: trimText(rowValue<string>(row as never, "version_name")) || trimText(merged.version_name),
    architecture: trimText(rowValue<string>(row as never, "architecture")) || trimText(merged.architecture),
    stage: trimText(rowValue<string | null>(row as never, "stage")) || stringFromValue(merged.stage),
    created_at: isoStringOrNull(rowValue<string | Date | null>(row as never, "created_at")),
    ready: rowReady ?? booleanFromValue(merged.ready),
    is_current: rowCurrent ?? booleanFromValue(merged.is_current),
    publish_required: booleanFromValue(merged.publish_required),
    distribution_status: stringFromValue(merged.distribution_status),
    download_url: trimText(rowValue<string>(row as never, "download_url")) || stringFromValue(merged.download_url),
    source_provider: trimText(rowValue<string>(row as never, "source_provider")) || stringFromValue(merged.source_provider),
    filename: stringFromValue(merged.filename),
    size_bytes: numberFromValue(rowValue<number | string | null>(row as never, "size_bytes")) ?? numberFromValue(merged.size_bytes),
    sha256: trimText(rowValue<string>(row as never, "sha256")) || stringFromValue(merged.sha256),
    notes: optionalStringFromValue(merged.notes),
    notes_ko: optionalStringFromValue(merged.notes_ko),
    notes_en: optionalStringFromValue(merged.notes_en),
    model_path: optionalStringFromValue(merged.model_path),
    aggregation_id: stringFromValue(merged.aggregation_id),
    base_version_id: stringFromValue(merged.base_version_id),
    requires_medsam_crop: booleanFromValue(merged.requires_medsam_crop),
    training_input_policy: optionalStringFromValue(merged.training_input_policy),
    crop_mode: (stringFromValue(merged.crop_mode) as ModelVersionRecord["crop_mode"]) ?? undefined,
    ensemble_mode: stringFromValue(merged.ensemble_mode),
    component_model_version_ids: normalizeStringArray(merged.component_model_version_ids),
    ensemble_weights: numberRecordFromValue(merged.ensemble_weights),
    decision_threshold: numberFromValue(merged.decision_threshold),
    threshold_selection_metric: stringFromValue(merged.threshold_selection_metric),
    threshold_selection_metrics: recordFromValue(merged.threshold_selection_metrics),
  };
}

function serializeMainModelUpdateRow(row: Record<string, unknown>): ModelUpdateRecord {
  const payload = recordFromValue(rowValue<unknown>(row as never, "payload_json"));
  return {
    update_id: trimText(rowValue<string>(row as never, "update_id")) || trimText(payload.update_id),
    contribution_group_id: stringFromValue(payload.contribution_group_id),
    site_id: trimText(rowValue<string | null>(row as never, "site_id")) || stringFromValue(payload.site_id),
    base_model_version_id:
      trimText(rowValue<string | null>(row as never, "base_model_version_id")) || stringFromValue(payload.base_model_version_id),
    architecture: stringFromValue(payload.architecture),
    upload_type: stringFromValue(payload.upload_type),
    execution_device: stringFromValue(payload.execution_device),
    artifact_path: stringFromValue(payload.artifact_path),
    central_artifact_key: stringFromValue(payload.central_artifact_key),
    central_artifact_path: stringFromValue(payload.central_artifact_path),
    central_artifact_name: stringFromValue(payload.central_artifact_name),
    central_artifact_size_bytes: numberFromValue(payload.central_artifact_size_bytes),
    central_artifact_sha256: stringFromValue(payload.central_artifact_sha256),
    artifact_download_url: stringFromValue(payload.artifact_download_url),
    artifact_distribution_status: stringFromValue(payload.artifact_distribution_status),
    artifact_source_provider: stringFromValue(payload.artifact_source_provider),
    artifact_storage: stringFromValue(payload.artifact_storage),
    n_cases: numberFromValue(payload.n_cases),
    contributed_by: stringFromValue(payload.contributed_by),
    case_reference_id: stringFromValue(payload.case_reference_id),
    created_at: isoStringOrNull(rowValue<string | Date | null>(row as never, "created_at")) || isoStringOrNull(payload.created_at),
    training_input_policy: stringFromValue(payload.training_input_policy),
    training_summary: recordFromValue(payload.training_summary),
    status: trimText(rowValue<string>(row as never, "status")) || stringFromValue(payload.status),
    reviewed_by: trimText(rowValue<string | null>(row as never, "reviewer_user_id")) || stringFromValue(payload.reviewed_by),
    reviewed_at: isoStringOrNull(rowValue<string | Date | null>(row as never, "reviewed_at")) || isoStringOrNull(payload.reviewed_at),
    reviewer_notes: trimText(rowValue<string>(row as never, "reviewer_notes")) || stringFromValue(payload.reviewer_notes),
    approval_report_path: stringFromValue(payload.approval_report_path),
    approval_report: recordFromValue(payload.approval_report) as ModelUpdateRecord["approval_report"],
    quality_summary: recordFromValue(payload.quality_summary) as ModelUpdateRecord["quality_summary"],
  };
}

function serializeMainAggregationRow(row: Record<string, unknown>): AggregationRecord {
  const payload = recordFromValue(rowValue<unknown>(row as never, "payload_json"));
  const summary = recordFromValue(rowValue<unknown>(row as never, "summary_json"));
  return {
    aggregation_id: trimText(rowValue<string>(row as never, "aggregation_id")) || trimText(payload.aggregation_id),
    base_model_version_id:
      trimText(rowValue<string | null>(row as never, "base_model_version_id")) || stringFromValue(payload.base_model_version_id),
    new_version_name:
      trimText(rowValue<string>(row as never, "new_version_name")) ||
      stringFromValue(summary.new_version_name) ||
      stringFromValue(payload.new_version_name) ||
      "pending-aggregation",
    architecture: stringFromValue(summary.architecture) || stringFromValue(payload.architecture),
    aggregation_strategy: stringFromValue(summary.aggregation_strategy) || stringFromValue(payload.aggregation_strategy),
    aggregation_trim_ratio: numberFromValue(summary.aggregation_trim_ratio) ?? numberFromValue(payload.aggregation_trim_ratio),
    weighting_mode: stringFromValue(summary.weighting_mode) || stringFromValue(payload.weighting_mode),
    site_weights: numberRecordFromValue(summary.site_weights) || numberRecordFromValue(payload.site_weights) || undefined,
    participation_summary:
      serializeFederatedParticipationSummary(summary.participation_summary) ||
      serializeFederatedParticipationSummary(payload.participation_summary),
    total_cases: numberFromValue(summary.total_cases) ?? numberFromValue(payload.total_cases),
    dp_accounting: serializeFederatedDpAccountingSummary(summary.dp_accounting) || serializeFederatedDpAccountingSummary(payload.dp_accounting),
    dp_budget: serializeFederatedDpBudgetRecord(summary.dp_budget) || serializeFederatedDpBudgetRecord(payload.dp_budget),
    created_at: isoStringOrNull(rowValue<string | Date | null>(row as never, "created_at")),
  };
}

export async function listMainModelVersions(request: NextRequest): Promise<ModelVersionRecord[]> {
  const { user } = await requireMainAppBridgeUser(request);
  return listMainModelVersionsForUser(user);
}

export async function listMainModelVersionsForUser(user: AuthUser): Promise<ModelVersionRecord[]> {
  assertAdminWorkspacePermission(user);
  const sql = await controlPlaneSql();
  const rows = await sql`
    select
      version_id,
      version_name,
      architecture,
      stage,
      payload_json,
      source_provider,
      download_url,
      sha256,
      size_bytes,
      ready,
      is_current,
      metadata_json,
      created_at
    from model_versions
    order by is_current desc, created_at desc
  `;
  return rows.map((row) => serializeMainModelVersionRow(row as Record<string, unknown>));
}

export async function listMainModelUpdates(
  request: NextRequest,
  options: {
    siteId?: string | null;
    statusFilter?: string | null;
  } = {},
): Promise<ModelUpdateRecord[]> {
  const { user } = await requireMainAppBridgeUser(request);
  return listMainModelUpdatesForUser(user, options);
}

export async function listMainModelUpdatesForUser(
  user: AuthUser,
  options: {
    siteId?: string | null;
    statusFilter?: string | null;
  } = {},
): Promise<ModelUpdateRecord[]> {
  assertAdminWorkspacePermission(user);
  const normalizedSiteId = trimText(options.siteId);
  const normalizedStatus = trimText(options.statusFilter);
  const sql = await controlPlaneSql();
  const permittedSiteIds = new Set(normalizeStringArray(user.site_ids));
  const queryValues: Array<string | string[]> = [];
  const conditions: string[] = [];
  if (normalizedSiteId) {
    queryValues.push(normalizedSiteId);
    conditions.push(`site_id = $${queryValues.length}`);
  }
  if (normalizedStatus) {
    queryValues.push(normalizedStatus);
    conditions.push(`status = $${queryValues.length}`);
  }
  if (user.role !== "admin") {
    queryValues.push(Array.from(permittedSiteIds));
    conditions.push(`site_id = any($${queryValues.length})`);
  }
  const whereClause = conditions.length ? `where ${conditions.join(" and ")}` : "";
  const rows = await sql.unsafe(
    `
      select
        update_id,
        site_id,
        base_model_version_id,
        status,
        payload_json,
        reviewer_user_id,
        reviewer_notes,
        created_at,
        reviewed_at
      from model_updates
      ${whereClause}
      order by created_at desc
    `,
    queryValues,
  );
  return rows
    .map((row) => serializeMainModelUpdateRow(row as Record<string, unknown>))
    .filter((record) => (user.role === "admin" ? true : Boolean(record.site_id && permittedSiteIds.has(record.site_id))));
}

export async function listMainAggregations(request: NextRequest): Promise<AggregationRecord[]> {
  const { user } = await requireMainAppBridgeUser(request);
  return listMainAggregationsForUser(user);
}

export async function listMainAggregationsForUser(user: AuthUser): Promise<AggregationRecord[]> {
  assertPlatformAdmin(user);
  const sql = await controlPlaneSql();
  const rows = await sql`
    select
      aggregation_id,
      base_model_version_id,
      new_version_name,
      payload_json,
      summary_json,
      created_at
    from aggregations
    order by created_at desc
  `;
  return rows.map((row) => serializeMainAggregationRow(row as Record<string, unknown>));
}

export async function deleteMainModelVersion(
  request: NextRequest,
  versionId: string,
): Promise<{ model_version: ModelVersionRecord }> {
  const { canonicalUserId, user } = await requireMainAppBridgeUser(request);
  assertPlatformAdmin(user);
  const normalizedVersionId = trimText(versionId);
  if (!normalizedVersionId) {
    throw new Error("Model version id is required.");
  }
  const sql = await controlPlaneSql();
  const existingRows = await sql`
    select
      version_id,
      version_name,
      architecture,
      stage,
      payload_json,
      source_provider,
      download_url,
      sha256,
      size_bytes,
      ready,
      is_current,
      metadata_json,
      created_at
    from model_versions
    where version_id = ${normalizedVersionId}
    limit 1
  `;
  if (!existingRows[0]) {
    throw new Error("Model version not found.");
  }
  const modelVersion = serializeMainModelVersionRow(existingRows[0] as Record<string, unknown>);
  await sql`delete from model_versions where version_id = ${normalizedVersionId}`;
  return { model_version: modelVersion };
}

export async function publishMainModelVersion(
  request: NextRequest,
  versionId: string,
  payload: {
    download_url?: string;
    set_current?: boolean;
  },
): Promise<{ model_version: ModelVersionRecord }> {
  const { canonicalUserId, user } = await requireMainAppBridgeUser(request);
  assertPlatformAdmin(user);
  const normalizedVersionId = trimText(versionId);
  if (!normalizedVersionId) {
    throw new Error("Model version id is required.");
  }
  const sql = await controlPlaneSql();
  if (payload.set_current) {
    await sql`update model_versions set is_current = false, updated_at = now() where is_current = true`;
  }
  await sql`
    update model_versions
    set
      download_url = case when ${trimText(payload.download_url)} = '' then download_url else ${trimText(payload.download_url)} end,
      ready = true,
      is_current = ${Boolean(payload.set_current)},
      updated_at = now()
    where version_id = ${normalizedVersionId}
  `;
  const rows = await sql`
    select
      version_id,
      version_name,
      architecture,
      stage,
      payload_json,
      source_provider,
      download_url,
      sha256,
      size_bytes,
      ready,
      is_current,
      metadata_json,
      created_at
    from model_versions
    where version_id = ${normalizedVersionId}
    limit 1
  `;
  if (!rows[0]) {
    throw new Error("Model version not found.");
  }
  const modelVersion = serializeMainModelVersionRow(rows[0] as Record<string, unknown>);
  await appendAuditEvent({
    actorType: "user",
    actorId: canonicalUserId,
    action: "model_version.published",
    targetType: "model_version",
    targetId: modelVersion.version_id,
    payload: {
      is_current: modelVersion.is_current ?? false,
      download_url: modelVersion.download_url ?? "",
    },
  });
  return { model_version: modelVersion };
}

export async function autoPublishMainModelVersion(
  request: NextRequest,
  versionId: string,
  payload: {
    set_current?: boolean;
  },
): Promise<{ model_version: ModelVersionRecord }> {
  const { user } = await requireMainAppBridgeUser(request);
  assertPlatformAdmin(user);
  const normalizedVersionId = trimText(versionId);
  if (!normalizedVersionId) {
    throw new Error("Model version id is required.");
  }
  return publishMainModelVersion(request, normalizedVersionId, {
    set_current: payload.set_current,
  });
}

export async function reviewMainModelUpdate(
  request: NextRequest,
  updateId: string,
  payload: {
    decision?: "approved" | "rejected";
    reviewer_notes?: string;
  },
): Promise<{ update: ModelUpdateRecord }> {
  const { canonicalUserId, user } = await requireMainAppBridgeUser(request);
  assertAdminWorkspacePermission(user);
  const normalizedUpdateId = trimText(updateId);
  if (!normalizedUpdateId) {
    throw new Error("Model update id is required.");
  }
  const decision = payload.decision;
  if (decision !== "approved" && decision !== "rejected") {
    throw new Error("Review decision is required.");
  }
  const sql = await controlPlaneSql();
  await sql`
    update model_updates
    set
      status = ${decision},
      reviewer_user_id = ${canonicalUserId},
      reviewer_notes = ${trimText(payload.reviewer_notes)},
      reviewed_at = now(),
      updated_at = now()
    where update_id = ${normalizedUpdateId}
  `;
  const rows = await sql`
    select
      update_id,
      site_id,
      base_model_version_id,
      status,
      payload_json,
      reviewer_user_id,
      reviewer_notes,
      created_at,
      reviewed_at
    from model_updates
    where update_id = ${normalizedUpdateId}
    limit 1
  `;
  if (!rows[0]) {
    throw new Error("Model update not found.");
  }
  const update = serializeMainModelUpdateRow(rows[0] as Record<string, unknown>);
  await appendAuditEvent({
    actorType: "user",
    actorId: canonicalUserId,
    action: "model_update.reviewed",
    targetType: "model_update",
    targetId: update.update_id,
    payload: {
      decision: update.status ?? null,
    },
  });
  return { update };
}

export async function publishMainModelUpdate(
  request: NextRequest,
  updateId: string,
  payload: {
    download_url?: string;
  },
): Promise<{ update: ModelUpdateRecord }> {
  const { canonicalUserId, user } = await requireMainAppBridgeUser(request);
  assertPlatformAdmin(user);
  const normalizedUpdateId = trimText(updateId);
  if (!normalizedUpdateId) {
    throw new Error("Model update id is required.");
  }
  const sql = await controlPlaneSql();
  const rows = await sql`
    select
      update_id,
      site_id,
      base_model_version_id,
      status,
      payload_json,
      reviewer_user_id,
      reviewer_notes,
      created_at,
      reviewed_at
    from model_updates
    where update_id = ${normalizedUpdateId}
    limit 1
  `;
  if (!rows[0]) {
    throw new Error("Model update not found.");
  }
  const current = rows[0] as Record<string, unknown>;
  const payloadJson = {
    ...recordFromValue(rowValue<unknown>(current as never, "payload_json")),
    artifact_download_url: trimText(payload.download_url) || undefined,
    artifact_distribution_status: "published",
  };
  await sql`
    update model_updates
    set
      payload_json = ${JSON.stringify(payloadJson)}::jsonb,
      updated_at = now()
    where update_id = ${normalizedUpdateId}
  `;
  const refreshedRows = await sql`
    select
      update_id,
      site_id,
      base_model_version_id,
      status,
      payload_json,
      reviewer_user_id,
      reviewer_notes,
      created_at,
      reviewed_at
    from model_updates
    where update_id = ${normalizedUpdateId}
    limit 1
  `;
  const update = serializeMainModelUpdateRow(refreshedRows[0] as Record<string, unknown>);
  await appendAuditEvent({
    actorType: "user",
    actorId: canonicalUserId,
    action: "model_update.published",
    targetType: "model_update",
    targetId: update.update_id,
    payload: {
      artifact_download_url: update.artifact_download_url ?? null,
    },
  });
  return { update };
}

export async function autoPublishMainModelUpdate(
  request: NextRequest,
  updateId: string,
): Promise<{ update: ModelUpdateRecord }> {
  const { user } = await requireMainAppBridgeUser(request);
  assertPlatformAdmin(user);
  const normalizedUpdateId = trimText(updateId);
  if (!normalizedUpdateId) {
    throw new Error("Model update id is required.");
  }
  return publishMainModelUpdate(request, normalizedUpdateId, {});
}

export async function runMainFederatedAggregation(
  request: NextRequest,
  payload: {
    update_ids?: string[];
    new_version_name?: string;
  },
): Promise<AggregationRunResponse> {
  const { canonicalUserId, user } = await requireMainAppBridgeUser(request);
  assertPlatformAdmin(user);
  const sql = await controlPlaneSql();
  const selectedUpdateIds = Array.isArray(payload.update_ids)
    ? Array.from(new Set(payload.update_ids.map((value) => trimText(value)).filter(Boolean)))
    : [];
  const updateRows = selectedUpdateIds.length
    ? await sql`
        select
          update_id,
          site_id,
          base_model_version_id,
          payload_json
        from model_updates
        where update_id = any(${selectedUpdateIds})
      `
    : [];
  const existingAggregationRows = await sql`
    select
      summary_json
    from aggregations
    order by created_at desc
  `;
  const baseModelVersionId = trimText(updateRows[0]?.base_model_version_id) || null;
  const aggregationId = makeControlPlaneId("aggregation");
  const newVersionName = trimText(payload.new_version_name) || `aggregation-${new Date().toISOString().slice(0, 10)}`;
  const siteRows = await sql`
    select site_id
    from sites
    where status = 'active'
    order by site_id asc
  `;
  const participationSummary = serializeFederatedParticipationSummary({
    aggregated_site_ids: Array.from(
      new Set(updateRows.map((row) => trimText(row.site_id)).filter((value): value is string => Boolean(value))),
    ).sort(),
    available_site_ids: siteRows
      .map((row) => trimText(rowValue<string>(row as never, "site_id")))
      .filter((value): value is string => Boolean(value)),
  });
  const dpAccounting = summarizeFederatedDpAccountingFromUpdates(
    updateRows.map((row) => ({
      site_id: trimText(row.site_id),
      payload_json: recordFromValue(row.payload_json),
    })),
    participationSummary,
  );
  const priorBudget = existingAggregationRows
    .map((row) => serializeFederatedDpBudgetRecord(recordFromValue(row.summary_json).dp_budget))
    .find((item) => Boolean(item)) ?? null;
  const dpBudget = accumulateFederatedDpBudgetRecord(priorBudget, dpAccounting, {
    aggregation_id: aggregationId,
    created_at: new Date().toISOString(),
    new_version_name: newVersionName,
    base_model_version_id: baseModelVersionId,
    participation_summary: participationSummary,
  });
  const summaryJson = {
    update_ids: selectedUpdateIds,
    new_version_name: newVersionName,
    participation_summary: participationSummary,
    dp_accounting: dpAccounting,
    dp_budget: dpBudget,
  };
  await sql`
    insert into aggregations (
      aggregation_id,
      base_model_version_id,
      new_version_name,
      status,
      triggered_by_user_id,
      payload_json,
      summary_json,
      created_at,
      finished_at,
      updated_at
    ) values (
      ${aggregationId},
      ${baseModelVersionId},
      ${newVersionName},
      ${"completed"},
      ${canonicalUserId},
      ${JSON.stringify(summaryJson)}::jsonb,
      ${JSON.stringify(summaryJson)}::jsonb,
      now(),
      now(),
      now()
    )
  `;
  if (selectedUpdateIds.length) {
    await sql`
      update model_updates
      set
        status = 'aggregated',
        updated_at = now()
      where update_id = any(${selectedUpdateIds})
    `;
  }
  const aggregationRows = await sql`
    select
      aggregation_id,
      base_model_version_id,
      new_version_name,
      payload_json,
      summary_json,
      created_at
    from aggregations
    where aggregation_id = ${aggregationId}
    limit 1
  `;
  if (!aggregationRows[0]) {
    throw new Error("Unable to create aggregation.");
  }
  await appendAuditEvent({
    actorType: "user",
    actorId: canonicalUserId,
    action: "aggregation.created",
    targetType: "aggregation",
    targetId: aggregationId,
    payload: {
      update_ids: selectedUpdateIds,
      new_version_name: newVersionName,
    },
  });
  return {
    aggregation: serializeMainAggregationRow(aggregationRows[0] as Record<string, unknown>),
    model_version: null,
    aggregated_update_ids: selectedUpdateIds,
  };
}

export async function listMainReleaseRollouts(request: NextRequest): Promise<ReleaseRolloutRecord[]> {
  const { user } = await requireMainAppBridgeUser(request);
  assertPlatformAdmin(user);
  return listStoreReleaseRollouts();
}

export async function createMainReleaseRollout(
  request: NextRequest,
  payload: {
    version_id?: string;
    stage?: "pilot" | "partial" | "full" | "rollback";
    target_site_ids?: string[];
    notes?: string;
  },
): Promise<{ rollout: ReleaseRolloutRecord }> {
  const { canonicalUserId, user } = await requireMainAppBridgeUser(request);
  assertPlatformAdmin(user);
  const versionId = trimText(payload.version_id);
  const stage = payload.stage;
  if (!versionId) {
    throw new Error("Model version id is required.");
  }
  if (stage !== "pilot" && stage !== "partial" && stage !== "full" && stage !== "rollback") {
    throw new Error("Rollout stage is required.");
  }
  const rollout = await createStoreReleaseRollout({
    actorUserId: canonicalUserId,
    versionId,
    stage,
    targetSiteIds: normalizeStringArray(payload.target_site_ids),
    notes: trimText(payload.notes) || "",
  });
  return { rollout };
}

export async function fetchMainFederationMonitoring(
  request: NextRequest,
): Promise<FederationMonitoringSummaryResponse> {
  const { user } = await requireMainAppBridgeUser(request);
  assertPlatformAdmin(user);
  const summary = await federationMonitoringSummary();
  return {
    current_release: summary.current_release
      ? {
          version_id: summary.current_release.version_id,
          version_name: summary.current_release.version_name,
          architecture: summary.current_release.architecture,
          created_at: summary.current_release.created_at,
          ready: summary.current_release.ready,
          is_current: summary.current_release.is_current,
          download_url: summary.current_release.download_url,
          source_provider: summary.current_release.source_provider,
          size_bytes: summary.current_release.size_bytes,
          sha256: summary.current_release.sha256,
        }
      : null,
    active_rollout: summary.active_rollout,
    recent_rollouts: summary.recent_rollouts,
    recent_audit_events: summary.recent_audit_events,
    privacy_budget: serializeFederatedDpBudgetRecord(summary.privacy_budget),
    node_summary: summary.node_summary,
    site_adoption: summary.site_adoption,
  };
}

export async function fetchMainFederatedPrivacyReport(
  request: NextRequest,
): Promise<FederatedPrivacyReportResponse> {
  const { canonicalUserId, user } = await requireMainAppBridgeUser(request);
  assertPlatformAdmin(user);

  const [summary, aggregations] = await Promise.all([
    federationMonitoringSummary(),
    listMainAggregationsForUser(user),
  ]);
  const privacyBudget =
    serializeFederatedDpBudgetRecord(summary.privacy_budget) ??
    aggregations.map((item) => item.dp_budget).find((item) => Boolean(item)) ??
    null;
  if (!privacyBudget?.formal_dp_accounting) {
    throw new Error("A current privacy budget is not available yet.");
  }
  const reportSchemaVersion = "federated_privacy_budget_report.v2";
  const limitations = buildFederatedPrivacyReportLimitations(privacyBudget);

  const report: FederatedPrivacyReportResponse = {
    report_type: "federated_privacy_budget_report",
    report_schema_version: reportSchemaVersion,
    exported_at: new Date().toISOString(),
    current_release: summary.current_release
      ? {
          version_id: summary.current_release.version_id,
          version_name: summary.current_release.version_name,
          architecture: summary.current_release.architecture,
          created_at: summary.current_release.created_at,
          ready: summary.current_release.ready,
          is_current: summary.current_release.is_current,
          download_url: summary.current_release.download_url,
          source_provider: summary.current_release.source_provider,
          size_bytes: summary.current_release.size_bytes,
          sha256: summary.current_release.sha256,
        }
      : null,
    active_rollout: summary.active_rollout,
    node_summary: summary.node_summary,
    site_adoption: summary.site_adoption,
    privacy_budget: privacyBudget,
    limitations,
    recent_aggregations: aggregations.slice(0, 12),
    recent_rollouts: summary.recent_rollouts.slice(0, 12),
    recent_audit_events: summary.recent_audit_events.slice(0, 20),
  };

  await appendAuditEvent({
    actorType: "user",
    actorId: canonicalUserId,
    action: "federation.privacy_report.exported",
    targetType: "federation",
    targetId: privacyBudget.last_accounted_aggregation_id ?? null,
    payload: {
      report_type: report.report_type,
      report_schema_version: reportSchemaVersion,
      accountant: privacyBudget.accountant ?? null,
      accountant_scope: privacyBudget.accountant_scope ?? null,
      epsilon: privacyBudget.epsilon ?? null,
      delta: privacyBudget.delta ?? null,
      sampling_rate: privacyBudget.sampling_rate ?? null,
      target_delta: privacyBudget.target_delta ?? null,
      subsampling_applied: privacyBudget.subsampling_applied ?? null,
      warn_epsilon: privacyBudget.warn_epsilon ?? null,
      max_epsilon: privacyBudget.max_epsilon ?? null,
      guardrail_status: privacyBudget.guardrail_status ?? null,
      guardrail_warnings: privacyBudget.guardrail_warnings ?? [],
      accounted_aggregations: privacyBudget.accounted_aggregations ?? 0,
      accounted_updates: privacyBudget.accounted_updates ?? 0,
      accounted_sites: privacyBudget.accounted_sites ?? 0,
      aggregated_participant_count: privacyBudget.aggregated_participant_count ?? null,
      available_participant_count: privacyBudget.available_participant_count ?? null,
      assumptions: privacyBudget.assumptions ?? [],
      limitations,
      last_accounted_new_version_name: privacyBudget.last_accounted_new_version_name ?? null,
    },
  });

  return report;
}
