import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PatientListBoard } from "./patient-list-board";

vi.mock("../../lib/analysis-runtime", () => ({
  searchAnalysisImagesByText: vi.fn(),
}));

import { searchAnalysisImagesByText } from "../../lib/analysis-runtime";

describe("PatientListBoard", () => {
  it("runs site-wide image description search from the patient list panel", async () => {
    const handleOpenImageTextSearchResult = vi.fn();
    vi.mocked(searchAnalysisImagesByText).mockResolvedValue({
      query: "hypopyon",
      eligible_image_count: 12,
      results: [
        {
          image_id: "image-1",
          patient_id: "00324192",
          visit_date: "FU #1",
          view: "white",
          preview_url: "asset://image-1-preview",
          score: 0.8765,
        },
      ],
    });

    render(
      <PatientListBoard
        locale="en"
        localeTag="en-US"
        commonNotAvailable="n/a"
        siteId="site-1"
        token="token-1"
        selectedSiteLabel="Jeju"
        selectedPatientId={null}
        patientListRows={[
          {
            patient_id: "00324192",
            latest_case: {
              case_id: "case-1",
              visit_id: "visit-1",
              patient_id: "00324192",
              visit_date: "FU #1",
              sex: "female",
              age: 73,
              culture_category: "bacterial",
              culture_species: "Bacillus",
              additional_organisms: [],
              contact_lens_use: "none",
              visit_status: "active",
              is_initial_visit: false,
              smear_result: "not done",
              polymicrobial: false,
              image_count: 1,
              latest_image_uploaded_at: "2026-03-26T00:00:00Z",
              created_at: "2026-03-26T00:00:00Z",
              local_case_code: "",
              chart_alias: "",
              representative_image_id: "image-1",
              representative_view: "white",
              research_registry_status: "analysis_only",
            },
            case_count: 1,
            organism_summary: "Bacillus",
            representative_thumbnails: [],
          },
        ]}
        patientListTotalCount={1}
        patientListPage={1}
        patientListTotalPages={1}
        patientListThumbsByPatient={{}}
        caseSearch=""
        showOnlyMine={false}
        casesLoading={false}
        copyPatients="Patients"
        copyAllRecords="All"
        copyMyPatientsOnly="Mine"
        copyLoadingSavedCases="Loading..."
        pick={(_locale, en) => en}
        translateOption={(_locale, _group, value) => value}
        displayVisitReference={(_locale, value) => value}
        formatDateTime={(value) => value ?? "n/a"}
        onSearchChange={() => undefined}
        onShowOnlyMineChange={() => undefined}
        onPageChange={() => undefined}
        onOpenSavedCase={() => undefined}
        onOpenImageTextSearchResult={handleOpenImageTextSearchResult}
        medsamArtifactActiveStatus={null}
        medsamArtifactScope="visit"
        medsamArtifactItems={[]}
        medsamArtifactItemsBusy={false}
        medsamArtifactPage={1}
        medsamArtifactTotalCount={0}
        medsamArtifactTotalPages={1}
        onCloseMedsamArtifactBacklog={() => undefined}
        onMedsamArtifactScopeChange={() => undefined}
        onMedsamArtifactPageChange={() => undefined}
      />,
    );

    fireEvent.change(
      screen.getByPlaceholderText("Search images by description (e.g. hypopyon, feathery border)…"),
      { target: { value: "hypopyon" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText("00324192")).toBeInTheDocument();
    expect(screen.getByText("score 0.88")).toBeInTheDocument();

    fireEvent.click(screen.getByText("score 0.88").closest("button")!);
    expect(handleOpenImageTextSearchResult).toHaveBeenCalledWith("00324192", "FU #1");
  });
});
