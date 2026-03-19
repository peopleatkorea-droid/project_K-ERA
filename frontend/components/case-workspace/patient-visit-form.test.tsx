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

  it("shows the locked intake summary as compact patient, visit, and organism chips", () => {
    render(
      <PatientVisitForm
        {...buildProps({
          draft: {
            ...buildProps().draft,
            patient_id: "17452298",
            sex: "female",
            age: "87",
            culture_category: "bacterial",
            culture_species: "Serratia marcescens",
            contact_lens_use: "none",
            visit_status: "active",
            intake_completed: true,
          },
          speciesOptions: ["Serratia marcescens"],
          primaryOrganismSummary: "Serratia marcescens",
        })}
      />
    );

    expect(screen.getByText("Patient")).toBeInTheDocument();
    expect(screen.getByText("17452298")).toBeInTheDocument();
    expect(screen.getByText("Visit")).toBeInTheDocument();
    expect(screen.getByText("initial · active")).toBeInTheDocument();
    expect(screen.getByText("Organism")).toBeInTheDocument();
    expect(screen.getByText("Serratia marcescens")).toBeInTheDocument();
    expect(screen.queryByText("female")).not.toBeInTheDocument();
    expect(screen.queryByText("No lens use")).not.toBeInTheDocument();
    expect(screen.queryByText("No predisposing factor selected")).not.toBeInTheDocument();
  });

  it("renders the visit editor as three columns without date or summary helper cards", () => {
    render(
      <PatientVisitForm
        {...buildProps({
          draft: {
            ...buildProps().draft,
            predisposing_factor: ["trauma"],
          },
        })}
      />
    );

    expect(screen.queryByText("Date")).not.toBeInTheDocument();
    expect(screen.queryByText("Current summary")).not.toBeInTheDocument();
    expect(screen.queryByText("Select only what matters for this visit. These tags flow straight into review.")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Status")).toBeInTheDocument();
    expect(screen.getByLabelText("Contact lens")).toBeInTheDocument();
    expect(screen.getByText("Predisposing factors")).toBeInTheDocument();
  });

  it("removes the duplicate note panel and the patient-side visit and image summary cards", () => {
    render(<PatientVisitForm {...buildProps()} />);

    expect(screen.queryByText("Clinical note")).not.toBeInTheDocument();
    expect(screen.queryByText("Case note")).not.toBeInTheDocument();
    expect(screen.queryByText("Local case code")).not.toBeInTheDocument();
    expect(screen.queryAllByText("Visit reference")).toHaveLength(0);
    expect(screen.queryByText("Draft images")).not.toBeInTheDocument();
  });

  it("uses a strong flat blue fill for selected predisposing factors", () => {
    render(
      <PatientVisitForm
        {...buildProps({
          draft: {
            ...buildProps().draft,
            predisposing_factor: ["trauma"],
          },
        })}
      />
    );

    const traumaButton = screen.getByRole("button", { name: "trauma" });
    expect(traumaButton.className).toContain("!border-blue-700");
    expect(traumaButton.className).toContain("!bg-blue-600");
    expect(traumaButton.className).toContain("!text-white");
    expect(traumaButton.className).toContain("ring-2");
    expect(traumaButton.className).not.toContain("bg-[linear-gradient(180deg,rgba(255,233,133,1),rgba(251,191,36,0.98))]");
    expect(traumaButton.className).not.toContain("ring-2 ring-amber-200/85");
    expect(traumaButton.className).not.toContain("shadow-[inset_0_1px_0_rgba(255,255,255,0.62),0_12px_24px_rgba(245,158,11,0.22)]");
  });
});
