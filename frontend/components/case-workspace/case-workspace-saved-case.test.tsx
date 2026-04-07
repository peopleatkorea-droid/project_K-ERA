import { describe, expect, it, vi } from "vitest";

import {
  startEditDraftFromSelectedCase,
  startFollowUpDraftFromSelectedCase,
} from "./case-workspace-saved-case";

function createSetStateRecorder<T>(initialState: T) {
  let state = initialState;
  const setter = vi.fn((nextState: T | ((current: T) => T)) => {
    state =
      typeof nextState === "function"
        ? (nextState as (current: T) => T)(state)
        : nextState;
  });
  return {
    getState: () => state,
    setter,
  };
}

describe("case workspace saved-case draft normalization", () => {
  it("clears organism fields when a negative case is opened as a follow-up draft", async () => {
    const draftState = createSetStateRecorder({
      patient_id: "",
      chart_alias: "",
      local_case_code: "",
      sex: "female",
      age: "60",
      actual_visit_date: "",
      follow_up_number: "1",
      culture_status: "positive",
      culture_category: "bacterial",
      culture_species: "Pseudomonas",
      additional_organisms: [
        { culture_category: "bacterial", culture_species: "Staphylococcus aureus" },
      ],
      contact_lens_use: "none",
      visit_status: "active",
      is_initial_visit: true,
      predisposing_factor: [],
      other_history: "",
      intake_completed: false,
    });

    await startFollowUpDraftFromSelectedCase({
      selectedCase: {
        patient_id: "P-001",
        visit_date: "Initial",
        sex: "female",
        age: 60,
        chart_alias: "",
        local_case_code: "",
        actual_visit_date: null,
        culture_status: "negative",
        culture_category: "bacterial",
        culture_species: "Pseudomonas",
        additional_organisms: [
          { culture_category: "bacterial", culture_species: "Staphylococcus aureus" },
        ],
        contact_lens_use: "none",
        visit_status: "active",
      } as never,
      selectedSiteId: null,
      token: "desktop-token",
      locale: "en",
      followUpVisitPattern: /^(?:F[\s/]*U|U)[-\s_#]*0*(\d+)$/i,
      cultureSpecies: {
        bacterial: ["Pseudomonas"],
      },
      describeError: (error, fallback) => (error instanceof Error ? error.message : fallback),
      pick: (_locale, en) => en,
      setToast: vi.fn(),
      setEditingCaseContext: vi.fn(),
      replaceDraftImagesAndBoxes: vi.fn(),
      setDraftLesionPromptBoxes: vi.fn(),
      clearDraftStorage: vi.fn(),
      resetAnalysisState: vi.fn(),
      setSelectedCase: vi.fn(),
      setSelectedCaseImages: vi.fn(),
      setPanelOpen: vi.fn(),
      setRailView: vi.fn(),
      setDraft: draftState.setter,
      setPendingOrganism: vi.fn(),
      setShowAdditionalOrganismForm: vi.fn(),
      normalizeAdditionalOrganisms: (primaryCategory, primarySpecies, organisms) =>
        (organisms ?? []).filter(
          (organism) =>
            organism.culture_category !== primaryCategory ||
            organism.culture_species !== primarySpecies,
        ),
      computeNextFollowUpNumber: () => 2,
      visitTimestamp: () => 0,
    });

    expect(draftState.getState()).toMatchObject({
      culture_status: "negative",
      culture_category: "",
      culture_species: "",
      additional_organisms: [],
    });
  });

  it("clears organism fields when an unknown case is opened in edit mode", async () => {
    const draftState = createSetStateRecorder({
      patient_id: "",
      chart_alias: "",
      local_case_code: "",
      sex: "female",
      age: "60",
      actual_visit_date: "",
      follow_up_number: "1",
      culture_status: "positive",
      culture_category: "bacterial",
      culture_species: "Pseudomonas",
      additional_organisms: [
        { culture_category: "bacterial", culture_species: "Staphylococcus aureus" },
      ],
      contact_lens_use: "none",
      visit_status: "active",
      is_initial_visit: true,
      predisposing_factor: [],
      other_history: "",
      intake_completed: false,
    });

    await startEditDraftFromSelectedCase({
      selectedCase: {
        patient_id: "P-001",
        visit_date: "Initial",
        sex: "female",
        age: 60,
        chart_alias: "",
        local_case_code: "",
        actual_visit_date: null,
        culture_status: "unknown",
        culture_category: "bacterial",
        culture_species: "Pseudomonas",
        additional_organisms: [
          { culture_category: "bacterial", culture_species: "Staphylococcus aureus" },
        ],
        contact_lens_use: "none",
        visit_status: "active",
        created_at: "2026-04-07T00:00:00Z",
        created_by_user_id: "user_researcher",
      } as never,
      selectedSiteId: null,
      token: "desktop-token",
      locale: "en",
      followUpVisitPattern: /^(?:F[\s/]*U|U)[-\s_#]*0*(\d+)$/i,
      cultureSpecies: {
        bacterial: ["Pseudomonas"],
      },
      describeError: (error, fallback) => (error instanceof Error ? error.message : fallback),
      pick: (_locale, en) => en,
      setToast: vi.fn(),
      setEditDraftBusy: vi.fn(),
      clearDraftStorage: vi.fn(),
      resetAnalysisState: vi.fn(),
      setPanelOpen: vi.fn(),
      setRailView: vi.fn(),
      setEditingCaseContext: vi.fn(),
      setSelectedCase: vi.fn(),
      setSelectedCaseImages: vi.fn(),
      replaceDraftImagesAndBoxes: vi.fn(),
      setDraftLesionPromptBoxes: vi.fn(),
      setDraft: draftState.setter,
      setPendingOrganism: vi.fn(),
      setShowAdditionalOrganismForm: vi.fn(),
      createDraftId: vi.fn(() => "draft_1"),
      normalizeBox: vi.fn((box) => box),
      normalizeAdditionalOrganisms: (primaryCategory, primarySpecies, organisms) =>
        (organisms ?? []).filter(
          (organism) =>
            organism.culture_category !== primaryCategory ||
            organism.culture_species !== primarySpecies,
        ),
    });

    expect(draftState.getState()).toMatchObject({
      culture_status: "unknown",
      culture_category: "",
      culture_species: "",
      additional_organisms: [],
    });
  });
});
