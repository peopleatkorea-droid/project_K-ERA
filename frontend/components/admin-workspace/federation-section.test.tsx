import React, { type ComponentProps } from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FederationSection } from "./federation-section";

function buildProps(
  overrides: Partial<ComponentProps<typeof FederationSection>> = {}
): ComponentProps<typeof FederationSection> {
  return {
    locale: "en",
    notAvailableLabel: "n/a",
    approvedUpdates: [],
    updateThresholdAlerts: [],
    aggregations: [
      {
        aggregation_id: "agg-1",
        new_version_name: "global-convnext-agg",
        architecture: "convnext_tiny",
        total_cases: 12,
        site_weights: { SITE_A: 6, SITE_B: 6 },
        dp_accounting: {
          formal_dp_accounting: true,
          accountant: "gaussian_basic_composition",
          accountant_scope: "site_local_training",
          subsampling_applied: false,
          assumptions: ["client_delta_noise", "full_participation", "no_subsampling", "no_secure_aggregation"],
          accounted_updates: 2,
          accounted_sites: 2,
          epsilon: 0.9,
          delta: 0.00002,
          sites: [
            { site_id: "SITE_A", accounted_updates: 1, epsilon: 0.4, delta: 0.00001 },
            { site_id: "SITE_B", accounted_updates: 1, epsilon: 0.5, delta: 0.00001 },
          ],
        },
        participation_summary: {
          aggregated_site_ids: ["SITE_A", "SITE_B"],
          aggregated_site_count: 2,
          available_site_ids: ["SITE_A", "SITE_B", "SITE_C"],
          available_site_count: 3,
          missing_site_ids: ["SITE_C"],
          missing_site_count: 1,
          participation_rate: 2 / 3,
        },
        dp_budget: {
          formal_dp_accounting: true,
          accountant: "gaussian_basic_composition",
          accountant_scope: "site_local_training",
          subsampling_applied: false,
          assumptions: ["client_delta_noise", "full_participation", "no_subsampling", "no_secure_aggregation"],
          accounted_updates: 4,
          accounted_aggregations: 2,
          accounted_sites: 2,
          epsilon: 1.3,
          delta: 0.00003,
          sites: [
            { site_id: "SITE_A", accounted_updates: 2, accounted_aggregations: 2, epsilon: 0.8, delta: 0.00002 },
            { site_id: "SITE_B", accounted_updates: 2, accounted_aggregations: 1, epsilon: 0.5, delta: 0.00001 },
          ],
          last_participation_summary: {
            aggregated_site_ids: ["SITE_A", "SITE_B"],
            aggregated_site_count: 2,
            available_site_ids: ["SITE_A", "SITE_B", "SITE_C"],
            available_site_count: 3,
            missing_site_ids: ["SITE_C"],
            missing_site_count: 1,
            participation_rate: 2 / 3,
          },
        },
        created_at: "2026-04-15T00:00:00.000Z",
      },
    ],
    federationStatusBusy: false,
    federationMonitoring: {
      current_release: null,
      active_rollout: null,
      recent_rollouts: [],
      recent_audit_events: [],
      privacy_budget: {
        formal_dp_accounting: true,
        accountant: "gaussian_basic_composition",
        accountant_scope: "site_local_training",
        subsampling_applied: false,
        assumptions: ["client_delta_noise", "full_participation", "no_subsampling", "no_secure_aggregation"],
        accounted_updates: 4,
        accounted_aggregations: 2,
        accounted_sites: 2,
        epsilon: 1.3,
        delta: 0.00003,
        last_accounted_aggregation_id: "agg-1",
        last_accounted_at: "2026-04-15T00:00:00.000Z",
        last_accounted_new_version_name: "global-convnext-agg",
        last_participation_summary: {
          aggregated_site_ids: ["SITE_A", "SITE_B"],
          aggregated_site_count: 2,
          available_site_ids: ["SITE_A", "SITE_B", "SITE_C"],
          available_site_count: 3,
          missing_site_ids: ["SITE_C"],
          missing_site_count: 1,
          participation_rate: 2 / 3,
        },
        sites: [
          { site_id: "SITE_A", accounted_updates: 2, accounted_aggregations: 2, epsilon: 0.8, delta: 0.00002 },
          { site_id: "SITE_B", accounted_updates: 2, accounted_aggregations: 1, epsilon: 0.5, delta: 0.00001 },
        ],
      },
      node_summary: {
        total_nodes: 0,
        active_nodes: 0,
        aligned_nodes: 0,
        lagging_nodes: 0,
        unknown_nodes: 0,
      },
      site_adoption: [],
    },
    federationMonitoringBusy: false,
    recentAuditEvents: [],
    modelVersions: [],
    releaseRollouts: [],
    releaseRolloutBusy: false,
    releaseRolloutForm: {
      version_id: "",
      stage: "pilot",
      target_site_ids_text: "",
      notes: "",
    },
    selectedSiteId: "SITE_A",
    newVersionName: "",
    aggregationBusy: false,
    setReleaseRolloutForm: vi.fn(),
    setNewVersionName: vi.fn(),
    formatDateTime: (value) => value ?? "n/a",
    onAggregation: vi.fn(),
    onAggregationAllReady: vi.fn(),
    onCreateReleaseRollout: vi.fn(),
    onExportPrivacyReport: vi.fn(),
    onRefreshFederationStatus: vi.fn(),
    privacyReportExportBusy: false,
    ...overrides,
  };
}

describe("FederationSection", () => {
  it("renders current and per-aggregation privacy budget summaries", () => {
    const props = buildProps();
    render(<FederationSection {...props} />);

    expect(screen.getByText("Current privacy budget")).toBeInTheDocument();
    expect(screen.getAllByText("gaussian_basic_composition").length).toBeGreaterThan(0);
    expect(screen.getByText("SITE_A · ε 0.800 · δ 2.00e-5")).toBeInTheDocument();
    expect(screen.getByText("This round privacy accounting")).toBeInTheDocument();
    expect(screen.getAllByText("SITE_B · ε 0.500 · δ 1.00e-5")).toHaveLength(2);
    expect(screen.getByText("Latest snapshot: global-convnext-agg · 2026-04-15T00:00:00.000Z")).toBeInTheDocument();
    expect(screen.getAllByText("2 / 3 hospitals (66.7%)").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/site-local training scope, client delta noise, full participation, no subsampling, no secure aggregation/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));
    expect(props.onExportPrivacyReport).toHaveBeenCalledTimes(1);
  });
});
