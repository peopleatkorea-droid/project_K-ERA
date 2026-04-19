import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SavedCaseOverview } from "./saved-case-overview";

describe("SavedCaseOverview", () => {
  it("stages patient timeline cards while keeping the current visit visible immediately", () => {
    vi.useFakeTimers();
    try {
      const selectedPatientCases = [
        {
          case_id: "case_1",
          patient_id: "P-001",
          visit_date: "FU #1",
          is_initial_visit: false,
          local_case_code: "CASE-1",
          age: 70,
          sex: "male",
          visit_status: "active",
          culture_category: "bacterial",
          culture_species: "Pseudomonas",
          latest_image_uploaded_at: "2026-04-19T00:00:00Z",
          created_at: "2026-04-18T00:00:00Z",
          image_count: 1,
          representative_image_id: "image_1",
          representative_view: "white",
          additional_organisms: [],
        },
        {
          case_id: "case_2",
          patient_id: "P-001",
          visit_date: "FU #2",
          is_initial_visit: false,
          local_case_code: "CASE-2",
          age: 70,
          sex: "male",
          visit_status: "active",
          culture_category: "fungal",
          culture_species: "Fusarium",
          latest_image_uploaded_at: "2026-04-18T00:00:00Z",
          created_at: "2026-04-17T00:00:00Z",
          image_count: 1,
          representative_image_id: "image_2",
          representative_view: "white",
          additional_organisms: [],
        },
        {
          case_id: "case_3",
          patient_id: "P-001",
          visit_date: "FU #3",
          is_initial_visit: false,
          local_case_code: "CASE-3",
          age: 70,
          sex: "male",
          visit_status: "active",
          culture_category: "fungal",
          culture_species: "Aspergillus",
          latest_image_uploaded_at: "2026-04-17T00:00:00Z",
          created_at: "2026-04-16T00:00:00Z",
          image_count: 1,
          representative_image_id: "image_3",
          representative_view: "white",
          additional_organisms: [],
        },
        {
          case_id: "case_4",
          patient_id: "P-001",
          visit_date: "FU #4",
          is_initial_visit: false,
          local_case_code: "CASE-4",
          age: 70,
          sex: "male",
          visit_status: "active",
          culture_category: "bacterial",
          culture_species: "Staphylococcus",
          latest_image_uploaded_at: "2026-04-16T00:00:00Z",
          created_at: "2026-04-15T00:00:00Z",
          image_count: 1,
          representative_image_id: "image_4",
          representative_view: "white",
          additional_organisms: [],
        },
      ] as any[];

      render(
        <SavedCaseOverview
          locale="en"
          localeTag="en-US"
          commonLoading="Loading..."
          commonNotAvailable="n/a"
          selectedCase={selectedPatientCases[2]}
          selectedPatientCases={selectedPatientCases as any}
          panelBusy={false}
          patientVisitGalleryBusy={false}
          patientVisitGallery={{
            case_1: [{ image_id: "image_1", view: "white", preview_url: "/preview/1", is_representative: true }],
            case_2: [{ image_id: "image_2", view: "white", preview_url: "/preview/2", is_representative: true }],
            case_3: [{ image_id: "image_3", view: "white", preview_url: "/preview/3", is_representative: true }],
            case_4: [{ image_id: "image_4", view: "white", preview_url: "/preview/4", is_representative: true }],
          } as any}
          patientVisitGalleryLoadingCaseIds={{}}
          patientVisitGalleryErrorCaseIds={{}}
          pick={(locale, en, ko) => (locale === "ko" ? ko : en)}
          translateOption={(_locale, _group, value) => value}
          displayVisitReference={(_locale, value) => value}
          formatDateTime={(value) => String(value)}
          organismSummaryLabel={(_category, species) => species}
          editDraftBusy={false}
          onStartEditDraft={vi.fn()}
          onStartFollowUpDraft={vi.fn()}
          onToggleFavorite={vi.fn()}
          onOpenSavedCase={vi.fn()}
          onEnsureVisitImages={vi.fn()}
          onDeleteSavedCase={vi.fn()}
          isFavoriteCase={() => false}
          caseTitle="CASE-3"
        />,
      );

      expect(screen.getByText("FU #1")).toBeInTheDocument();
      expect(screen.getByText("FU #2")).toBeInTheDocument();
      expect(screen.getAllByText("FU #3").length).toBeGreaterThan(0);
      expect(screen.queryByText("FU #4")).not.toBeInTheDocument();

      act(() => {
        vi.runAllTimers();
      });

      expect(screen.getByText("FU #4")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stages visit thumbnails while keeping the representative thumbnail visible immediately", () => {
    vi.useFakeTimers();
    try {
      const selectedPatientCases = [
        {
          case_id: "case_1",
          patient_id: "P-001",
          visit_date: "FU #1",
          is_initial_visit: false,
          local_case_code: "CASE-1",
          age: 70,
          sex: "male",
          visit_status: "active",
          culture_category: "bacterial",
          culture_species: "Pseudomonas",
          latest_image_uploaded_at: "2026-04-19T00:00:00Z",
          created_at: "2026-04-18T00:00:00Z",
          image_count: 3,
          representative_image_id: "image_2",
          representative_view: "white",
          additional_organisms: [],
        },
      ] as any[];

      render(
        <SavedCaseOverview
          locale="en"
          localeTag="en-US"
          commonLoading="Loading..."
          commonNotAvailable="n/a"
          selectedCase={selectedPatientCases[0]}
          selectedPatientCases={selectedPatientCases as any}
          panelBusy={false}
          patientVisitGalleryBusy={false}
          patientVisitGallery={{
            case_1: [
              { image_id: "image_1", view: "white", preview_url: "/preview/1", is_representative: false },
              { image_id: "image_2", view: "fluorescein", preview_url: "/preview/2", is_representative: true },
              { image_id: "image_3", view: "white", preview_url: "/preview/3", is_representative: false },
            ],
          } as any}
          patientVisitGalleryLoadingCaseIds={{}}
          patientVisitGalleryErrorCaseIds={{}}
          pick={(locale, en, ko) => (locale === "ko" ? ko : en)}
          translateOption={(_locale, _group, value) => value}
          displayVisitReference={(_locale, value) => value}
          formatDateTime={(value) => String(value)}
          organismSummaryLabel={(_category, species) => species}
          editDraftBusy={false}
          onStartEditDraft={vi.fn()}
          onStartFollowUpDraft={vi.fn()}
          onToggleFavorite={vi.fn()}
          onOpenSavedCase={vi.fn()}
          onEnsureVisitImages={vi.fn()}
          onDeleteSavedCase={vi.fn()}
          isFavoriteCase={() => false}
          caseTitle="CASE-1"
        />,
      );

      expect(screen.getByAltText("image_1")).toBeInTheDocument();
      expect(screen.getByAltText("image_2")).toBeInTheDocument();
      expect(screen.queryByAltText("image_3")).not.toBeInTheDocument();

      act(() => {
        vi.runAllTimers();
      });

      expect(screen.getByAltText("image_3")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
