import { describe, expect, it } from "vitest";

import {
  buildDraftCanvasViewModel,
  buildDraftPatientVisitFormViewModel,
  buildSavedCaseSidebarViewModel,
} from "./case-workspace-view-models";

describe("case-workspace view models", () => {
  it("builds the draft canvas labels with fallback copy", () => {
    const viewModel = buildDraftCanvasViewModel({
      locale: "en",
      selectedSiteLabel: "Site A",
      draftStatusLabel: "Autosaved 10:30",
      resolvedVisitReferenceLabel: "Initial",
      draft: {
        patient_id: "",
        visit_status: "active",
        culture_category: "",
        culture_species: "",
        additional_organisms: [],
        intake_completed: false,
      },
      translateOption: (_locale, _group, value) => value,
      organismSummaryLabel: () => "",
    });

    expect(viewModel.patientSummaryLabel).toBe("Waiting for patient ID");
    expect(viewModel.visitSummaryLabel).toBe("Initial · active");
    expect(viewModel.organismSummary).toBe("Choose primary organism");
    expect(viewModel.intakeCompleted).toBe(false);
  });

  it("builds primary organism summary for the intake form", () => {
    const viewModel = buildDraftPatientVisitFormViewModel({
      draft: {
        culture_category: "fungal",
        culture_species: "Fusarium",
        additional_organisms: [],
      },
      resolvedVisitReferenceLabel: "FU #1",
      actualVisitDateLabel: "2026-04-13",
      organismSummaryLabel: (category, species) => `${category}:${species}`,
    });

    expect(viewModel.primaryOrganismSummary).toBe("fungal:Fusarium");
    expect(viewModel.resolvedVisitReferenceLabel).toBe("FU #1");
    expect(viewModel.actualVisitDateLabel).toBe("2026-04-13");
  });

  it("builds saved-case sidebar stats from images and case summary", () => {
    const viewModel = buildSavedCaseSidebarViewModel({
      selectedCase: {
        image_count: 3,
        representative_image_id: "",
      },
      selectedCaseImages: [
        {
          image_id: "img_1",
          visit_id: "visit_1",
          patient_id: "P-001",
          visit_date: "Initial",
          view: "white",
          image_path: "C:\\img_1.png",
          is_representative: true,
          content_url: "/content/img_1",
          uploaded_at: "2026-04-13T00:00:00Z",
          preview_url: "/preview/img_1",
          lesion_prompt_box: null,
          quality_scores: null,
        },
      ],
      hasAnySavedLesionBox: true,
    });

    expect(viewModel.selectedCaseImageCount).toBe(3);
    expect(viewModel.hasRepresentativeImage).toBe(true);
    expect(viewModel.hasAnySavedLesionBox).toBe(true);
  });
});
