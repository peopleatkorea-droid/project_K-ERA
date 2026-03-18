import React, { type ComponentProps } from "react";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ContributionHistoryPanel } from "./contribution-history-panel";

function buildProps(
  overrides: Partial<ComponentProps<typeof ContributionHistoryPanel>> = {}
): ComponentProps<typeof ContributionHistoryPanel> {
  return {
    locale: "ko",
    selectedCase: {
      case_id: "case_1",
      visit_id: "visit_1",
      patient_id: "KERA-2026-001",
      visit_date: "Initial",
      actual_visit_date: null,
      chart_alias: "",
      local_case_code: "",
      sex: "female",
      age: 61,
      culture_category: "bacterial",
      culture_species: "Staphylococcus aureus",
      additional_organisms: [],
      contact_lens_use: "none",
      predisposing_factor: [],
      other_history: "",
      visit_status: "active",
      is_initial_visit: true,
      smear_result: "negative",
      polymicrobial: false,
      research_registry_status: "included",
      image_count: 2,
      representative_image_id: "image_1",
      representative_view: "slit",
      created_at: "2026-03-18T00:00:00Z",
      latest_image_uploaded_at: "2026-03-18T00:00:00Z",
    },
    canRunValidation: true,
    canContributeSelectedCase: true,
    hasValidationResult: true,
    researchRegistryEnabled: true,
    researchRegistryUserEnrolled: true,
    researchRegistryBusy: false,
    contributionBusy: false,
    contributionResult: {
      update: {
        update_id: "update_1",
        site_id: "39100103",
        base_model_version_id: "model_v1",
        architecture: "vit",
        upload_type: "weight delta",
        execution_device: "cpu",
        n_cases: 1,
        contributed_by: "user_1",
        case_reference_id: "caseref_1",
        created_at: "2026-03-18T00:00:00Z",
        training_input_policy: "automated",
        training_summary: {},
        status: "pending_review",
      },
      updates: [
        {
          update_id: "update_1",
          site_id: "39100103",
          base_model_version_id: "model_v1",
          architecture: "vit",
          upload_type: "weight delta",
          execution_device: "cpu",
          n_cases: 1,
          contributed_by: "user_1",
          case_reference_id: "caseref_1",
          created_at: "2026-03-18T00:00:00Z",
          training_input_policy: "automated",
          training_summary: {},
          status: "pending_review",
        },
      ],
      update_count: 1,
      contribution_group_id: "group_1",
      visit_status: "active",
      execution_device: "cpu",
      model_version: {
        version_id: "model_v1",
        version_name: "vit-v1",
        architecture: "vit",
      },
      model_versions: [
        {
          version_id: "model_v1",
          version_name: "vit-v1",
          architecture: "vit",
        },
      ],
      stats: {
        total_contributions: 12,
        user_contributions: 3,
        user_contribution_pct: 25,
        current_model_version: "global-v1",
        user_public_alias: "warm_gorilla_221",
        user_rank: 2,
        leaderboard: {
          scope: "global",
          leaderboard: [
            {
              rank: 1,
              user_id: "user_2",
              public_alias: "tranquil_otter_010",
              contribution_count: 7,
            },
            {
              rank: 2,
              user_id: "user_1",
              public_alias: "warm_gorilla_221",
              contribution_count: 3,
              is_current_user: true,
            },
          ],
          current_user: {
            rank: 2,
            user_id: "user_1",
            public_alias: "warm_gorilla_221",
            contribution_count: 3,
            is_current_user: true,
          },
        },
      },
      failures: [],
    },
    currentUserPublicAlias: "warm_gorilla_221",
    contributionLeaderboard: {
      scope: "global",
      leaderboard: [
        {
          rank: 1,
          user_id: "user_2",
          public_alias: "tranquil_otter_010",
          contribution_count: 7,
        },
        {
          rank: 2,
          user_id: "user_1",
          public_alias: "warm_gorilla_221",
          contribution_count: 3,
          is_current_user: true,
        },
      ],
      current_user: {
        rank: 2,
        user_id: "user_1",
        public_alias: "warm_gorilla_221",
        contribution_count: 3,
        is_current_user: true,
      },
    },
    historyBusy: false,
    caseHistory: {
      validations: [],
      contributions: [
        {
          contribution_id: "contrib_1",
          contribution_group_id: "group_1",
          created_at: "2026-03-18T00:00:00Z",
          user_id: "user_1",
          public_alias: "warm_gorilla_221",
          case_reference_id: "caseref_1",
          update_id: "update_1",
          update_status: "pending_review",
          upload_type: "weight delta",
          architecture: "vit",
          execution_device: "cpu",
          base_model_version_id: "model_v1",
        },
      ],
    },
    onJoinResearchRegistry: vi.fn(),
    onIncludeResearchCase: vi.fn(),
    onExcludeResearchCase: vi.fn(),
    onContributeCase: vi.fn(),
    completionContent: null,
    formatProbability: () => "0.80",
    notAvailableLabel: "n/a",
    ...overrides,
  };
}

describe("ContributionHistoryPanel", () => {
  it("renders the public alias, leaderboard, and anonymous contribution history", () => {
    render(<ContributionHistoryPanel {...buildProps()} />);

    expect(screen.getByText("공개 별칭 / 따스한 고릴라 #221")).toBeInTheDocument();
    expect(screen.getByText("순위 / #2")).toBeInTheDocument();
    expect(screen.getByText("#1 고요한 수달 #010")).toBeInTheDocument();
    expect(screen.getByText("#2 따스한 고릴라 #221")).toBeInTheDocument();
  });

  it("renders the alias in English when the locale is English", () => {
    render(<ContributionHistoryPanel {...buildProps({ locale: "en" })} />);

    expect(screen.getByText("Public alias / Warm Gorilla #221")).toBeInTheDocument();
    expect(screen.getByText("#1 Tranquil Otter #010")).toBeInTheDocument();
  });
});
