import React, { type ComponentProps } from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PatientVisitForm } from "./patient-visit-form";

function buildProps(
  overrides: Partial<ComponentProps<typeof PatientVisitForm>> = {}
): ComponentProps<typeof PatientVisitForm> {
  return {
    locale: "en",
    draft: {
      patient_id: "KERA-2026-001",
      chart_alias: "",
      local_case_code: "",
      sex: "female",
      age: "61",
      actual_visit_date: "",
      follow_up_number: "1",
      culture_category: "bacterial",
      culture_species: "Staphylococcus aureus",
      additional_organisms: [],
      contact_lens_use: "none",
      visit_status: "active",
      is_initial_visit: true,
      predisposing_factor: [],
      other_history: "",
      intake_completed: false,
    },
    draftImagesCount: 2,
    notAvailableLabel: "n/a",
    sexOptions: ["female", "male", "unknown"],
    contactLensOptions: ["none", "soft contact lens", "unknown"],
    predisposingFactorOptions: ["trauma", "neurotrophic"],
    visitStatusOptions: ["active", "scar"],
    cultureSpecies: {
      bacterial: ["Staphylococcus aureus", "Pseudomonas aeruginosa"],
      fungal: ["Fusarium"],
    },
    speciesOptions: ["Staphylococcus aureus", "Pseudomonas aeruginosa"],
    pendingOrganism: {
      culture_category: "bacterial",
      culture_species: "Pseudomonas aeruginosa",
    },
    pendingSpeciesOptions: ["Pseudomonas aeruginosa"],
    showAdditionalOrganismForm: false,
    intakeOrganisms: [
      {
        culture_category: "bacterial",
        culture_species: "Staphylococcus aureus",
      },
    ],
    primaryOrganismSummary: "Staphylococcus aureus",
    resolvedVisitReferenceLabel: "initial",
    actualVisitDateLabel: "Not set",
    setDraft: vi.fn(),
    setPendingOrganism: vi.fn(),
    setShowAdditionalOrganismForm: vi.fn(),
    togglePredisposingFactor: vi.fn(),
    updatePrimaryOrganism: vi.fn(),
    addAdditionalOrganism: vi.fn(),
    removeAdditionalOrganism: vi.fn(),
    onCompleteIntake: vi.fn(),
    ...overrides,
  };
}

describe("PatientVisitForm", () => {
  it("handles intake actions before the intake is completed", () => {
    const togglePredisposingFactor = vi.fn();
    const onCompleteIntake = vi.fn();

    render(
      <PatientVisitForm
        {...buildProps({
          togglePredisposingFactor,
          onCompleteIntake,
        })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "trauma" }));
    fireEvent.click(screen.getByRole("button", { name: "Lock intake" }));

    expect(togglePredisposingFactor).toHaveBeenCalledWith("trauma");
    expect(onCompleteIntake).toHaveBeenCalledTimes(1);
  });

  it("returns to edit mode after intake completion", () => {
    const setDraft = vi.fn();
    const completedDraft = {
      ...buildProps().draft,
      intake_completed: true,
    };

    render(
      <PatientVisitForm
        {...buildProps({
          draft: completedDraft,
          setDraft,
        })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const updater = setDraft.mock.calls.at(-1)?.[0];
    expect(typeof updater).toBe("function");
    expect(updater(completedDraft).intake_completed).toBe(false);
  });
});
