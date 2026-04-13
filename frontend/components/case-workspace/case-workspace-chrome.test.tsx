import { describe, expect, it } from "vitest";

import { buildCaseWorkspaceChromeState } from "./case-workspace-chrome";

describe("case-workspace chrome helpers", () => {
  it("builds a draft autosave summary for an unsaved canvas", () => {
    const state = buildCaseWorkspaceChromeState({
      locale: "en",
      localeTag: "en-US",
      railView: "cases",
      hasSelectedCase: false,
      isAuthoringCanvas: true,
      desktopFastMode: false,
      draft: {
        patient_id: "P-001",
        visit_status: "active",
        follow_up_number: "1",
        is_initial_visit: true,
        intake_completed: false,
      },
      draftSavedAt: "2026-04-13T01:02:00Z",
      patientIdLookup: null,
      editingCaseContext: null,
      listViewHeaderCopy: "List copy",
      draftAutosaved: (time) => `Autosaved ${time}`,
      draftUnsaved: "Unsaved",
    });

    expect(state.resolvedVisitReferenceLabel).toBe("Initial");
    expect(state.draftStatusLabel).toMatch(/^Autosaved /);
    expect(state.latestAutosavedDraft).toMatchObject({
      patientId: "P-001",
      visitLabel: "Initial",
    });
    expect(state.mainHeaderTitle).toBe("Case canvas");
    expect(state.showSecondaryPanel).toBe(true);
  });

  it("uses the patient lookup to advance the default initial visit label", () => {
    const state = buildCaseWorkspaceChromeState({
      locale: "en",
      localeTag: "en-US",
      railView: "cases",
      hasSelectedCase: false,
      isAuthoringCanvas: true,
      desktopFastMode: false,
      draft: {
        patient_id: "P-010",
        visit_status: "active",
        follow_up_number: "1",
        is_initial_visit: true,
        intake_completed: false,
      },
      draftSavedAt: null,
      patientIdLookup: {
        requested_patient_id: "P-010",
        normalized_patient_id: "P-010",
        exists: true,
        patient: null,
        visit_count: 1,
        image_count: 3,
        latest_visit_date: "FU #1",
      },
      editingCaseContext: null,
      listViewHeaderCopy: "List copy",
      draftAutosaved: (time) => `Autosaved ${time}`,
      draftUnsaved: "Unsaved",
    });

    expect(state.resolvedVisitReferenceLabel).toBe("FU #2");
    expect(state.draftStatusLabel).toBe("Unsaved");
  });

  it("keeps the list header copy and patient-list layout in list mode", () => {
    const state = buildCaseWorkspaceChromeState({
      locale: "en",
      localeTag: "en-US",
      railView: "patients",
      hasSelectedCase: false,
      isAuthoringCanvas: false,
      desktopFastMode: false,
      draft: {
        patient_id: "",
        visit_status: "active",
        follow_up_number: "1",
        is_initial_visit: true,
        intake_completed: false,
      },
      draftSavedAt: null,
      patientIdLookup: null,
      editingCaseContext: null,
      listViewHeaderCopy: "Saved patients appear here.",
      draftAutosaved: (time) => `Autosaved ${time}`,
      draftUnsaved: "Unsaved",
    });

    expect(state.mainHeaderTitle).toBe("Patient list");
    expect(state.mainHeaderCopy).toBe("Saved patients appear here.");
    expect(state.showPatientListSidebar).toBe(true);
    expect(state.mainLayoutClass).not.toBe("grid gap-6");
  });

  it("uses the saved-case layout and hides the autosave card for completed intake", () => {
    const state = buildCaseWorkspaceChromeState({
      locale: "en",
      localeTag: "en-US",
      railView: "cases",
      hasSelectedCase: true,
      isAuthoringCanvas: false,
      desktopFastMode: false,
      draft: {
        patient_id: "P-200",
        visit_status: "active",
        follow_up_number: "2",
        is_initial_visit: false,
        intake_completed: true,
      },
      draftSavedAt: "2026-04-13T01:02:00Z",
      patientIdLookup: null,
      editingCaseContext: {
        patient_id: "P-200",
        visit_date: "FU #2",
      },
      listViewHeaderCopy: "List copy",
      draftAutosaved: (time) => `Autosaved ${time}`,
      draftUnsaved: "Unsaved",
    });

    expect(state.mainHeaderTitle).toBe("Case review");
    expect(state.latestAutosavedDraft).toBeNull();
    expect(state.mainLayoutClass).toContain("_300px");
  });
});
