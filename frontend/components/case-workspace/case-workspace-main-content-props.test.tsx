import { describe, expect, it, vi } from "vitest";

import {
  buildDraftViewProps,
  buildPatientListViewProps,
  buildSavedCaseViewProps,
} from "./case-workspace-main-content-props";

describe("case-workspace main content props", () => {
  it("builds saved-case props with guarded image hydration fallback", async () => {
    const ensurePatientVisitImagesLoaded = vi.fn(async () => [
      {
        image_id: "img_1",
        visit_id: "visit_1",
        patient_id: "P-001",
        visit_date: "2026-04-13",
        view: "white",
        image_path: "C:\\img_1.png",
        is_representative: false,
        content_url: "/content/img_1",
        uploaded_at: "2026-04-13T00:00:00Z",
        preview_url: "/preview/img_1",
        lesion_prompt_box: null,
        quality_scores: null,
      },
    ]);
    const selectedCase = {
      case_id: "case_1",
      patient_id: "P-001",
      visit_date: "2026-04-13",
      image_count: 3,
      representative_image_id: "",
      culture_category: "fungal",
      culture_species: "Fusarium",
      additional_organisms: [],
    } as any;
    const props = buildSavedCaseViewProps({
      locale: "en",
      localeTag: "en-US",
      commonLoading: "Loading...",
      commonNotAvailable: "N/A",
      selectedCase,
      selectedPatientCases: [selectedCase],
      panelBusy: false,
      patientVisitGalleryBusy: false,
      patientVisitGallery: {},
      patientVisitGalleryLoadingCaseIds: {},
      patientVisitGalleryErrorCaseIds: {},
      pick: (_locale, en) => en,
      translateOption: (_locale, _group, value) => value,
      displayVisitReference: (_locale, visitReference) => `Visit ${visitReference}`,
      formatDateTime: (value) => value ?? "N/A",
      organismSummaryLabel: (category, species) => `${category}:${species}`,
      editDraftBusy: false,
      onStartEditDraft: vi.fn(),
      onStartFollowUpDraft: vi.fn(),
      onToggleFavorite: vi.fn(),
      onOpenSavedCase: vi.fn(),
      selectedSiteId: null,
      ensurePatientVisitImagesLoaded,
      onDeleteSavedCase: vi.fn(),
      isFavoriteCase: () => false,
      caseTitle: "Case Title",
      selectedCaseImages: [
        {
          image_id: "img_1",
          visit_id: "visit_1",
          patient_id: "P-001",
          visit_date: "2026-04-13",
          view: "white",
          image_path: "C:\\img_1.png",
          is_representative: true,
          content_url: "/content/img_1",
          uploaded_at: "2026-04-13T00:00:00Z",
          preview_url: "/preview/img_1",
          lesion_prompt_box: null,
          quality_scores: null,
        },
      ] as any,
      liveLesionMaskEnabled: true,
      semanticPromptInputMode: "source",
      semanticPromptInputOptions: [],
      semanticPromptBusyImageId: null,
      semanticPromptReviews: {},
      semanticPromptErrors: {},
      semanticPromptOpenImageIds: [],
      liveLesionPreviews: {},
      savedImageRoiCropUrls: {},
      savedImageRoiCropBusy: false,
      savedImageLesionCropUrls: {},
      savedImageLesionCropBusy: false,
      lesionPromptDrafts: {},
      lesionPromptSaved: {},
      lesionBoxBusyImageId: null,
      representativeBusyImageId: null,
      formatSemanticScore: (value, emptyLabel) =>
        value == null ? emptyLabel : String(value),
      onToggleLiveLesionMask: vi.fn(),
      onSemanticPromptInputModeChange: vi.fn(),
      onSetSavedRepresentative: vi.fn(),
      onReviewSemanticPrompts: vi.fn(),
      onLesionPointerDown: vi.fn(),
      onLesionPointerMove: vi.fn(),
      onFinishLesionPointer: vi.fn(),
      hasAnySavedLesionBox: true,
    });

    await expect(
      props.overviewProps.onEnsureVisitImages(selectedCase),
    ).resolves.toEqual([]);
    expect(ensurePatientVisitImagesLoaded).not.toHaveBeenCalled();
    expect(props.imageBoardProps.selectedVisitLabel).toBe("Visit 2026-04-13");
    expect(props.sidebarProps.selectedCaseImageCount).toBe(3);
    expect(props.sidebarProps.hasRepresentativeImage).toBe(true);
    expect(props.sidebarProps.hasAnySavedLesionBox).toBe(true);
  });

  it("builds draft props and only enables the image manager after intake completion", () => {
    const saveSpy = vi.fn();
    const draft = {
      patient_id: "",
      chart_alias: "",
      local_case_code: "",
      sex: "female",
      age: "71",
      actual_visit_date: "2026-04-13",
      follow_up_number: "",
      culture_status: "positive",
      culture_category: "fungal",
      culture_species: "Fusarium",
      additional_organisms: [],
      contact_lens_use: "none",
      visit_status: "active",
      is_initial_visit: true,
      predisposing_factor: [],
      other_history: "",
      intake_completed: false,
    } as any;

    const props = buildDraftViewProps({
      locale: "en",
      draft,
      selectedSiteLabel: "Site A",
      draftStatusLabel: "Autosaved",
      resolvedVisitReferenceLabel: "Initial",
      translateOption: (_locale, _group, value) => value,
      organismSummaryLabel: (category, species) => `${category}:${species}`,
      actualVisitDateLabel: "2026-04-13",
      commonNotAvailable: "N/A",
      sexOptions: ["female"],
      contactLensOptions: ["none"],
      predisposingFactorOptions: ["trauma"],
      visitStatusOptions: ["active"],
      cultureStatusOptions: ["positive"],
      cultureSpecies: { fungal: ["Fusarium"] },
      speciesOptions: ["Fusarium"],
      pendingOrganism: {
        culture_category: "",
        culture_species: "",
      } as any,
      pendingSpeciesOptions: [],
      showAdditionalOrganismForm: false,
      intakeOrganisms: [],
      patientIdLookup: null,
      patientIdLookupBusy: false,
      patientIdLookupError: null,
      setDraft: vi.fn(),
      setPendingOrganism: vi.fn(),
      setShowAdditionalOrganismForm: vi.fn(),
      togglePredisposingFactor: vi.fn(),
      updatePrimaryOrganism: vi.fn(),
      addAdditionalOrganism: vi.fn(),
      removeAdditionalOrganism: vi.fn(),
      onCompleteIntake: vi.fn(),
      whiteDraftImages: [],
      fluoresceinDraftImages: [],
      draftLesionPromptBoxes: {},
      whiteFileInputRef: { current: null },
      fluoresceinFileInputRef: { current: null },
      openFilePicker: vi.fn(),
      appendFiles: vi.fn(),
      handleDraftLesionPointerDown: vi.fn(),
      handleDraftLesionPointerMove: vi.fn(),
      finishDraftLesionPointer: vi.fn(),
      removeDraftImage: vi.fn(),
      setRepresentativeImage: vi.fn(),
      onSaveCase: saveSpy,
      saveBusy: false,
      selectedSiteId: "39100103",
    });

    expect(props.canvasProps.patientSummaryLabel).toBe("Waiting for patient ID");
    expect(props.patientVisitFormProps.primaryOrganismSummary).toBe(
      "fungal:Fusarium",
    );
    expect(props.imageManagerPanelProps).toBeNull();

    const completedProps = buildDraftViewProps({
      ...props.patientVisitFormProps,
      locale: "en",
      draft: { ...draft, intake_completed: true },
      selectedSiteLabel: "Site A",
      draftStatusLabel: "Autosaved",
      resolvedVisitReferenceLabel: "Initial",
      translateOption: (_locale, _group, value) => value,
      organismSummaryLabel: (category, species) => `${category}:${species}`,
      actualVisitDateLabel: "2026-04-13",
      commonNotAvailable: "N/A",
      sexOptions: ["female"],
      contactLensOptions: ["none"],
      predisposingFactorOptions: ["trauma"],
      visitStatusOptions: ["active"],
      cultureStatusOptions: ["positive"],
      cultureSpecies: { fungal: ["Fusarium"] },
      speciesOptions: ["Fusarium"],
      pendingOrganism: {
        culture_category: "",
        culture_species: "",
      } as any,
      pendingSpeciesOptions: [],
      showAdditionalOrganismForm: false,
      intakeOrganisms: [],
      patientIdLookup: null,
      patientIdLookupBusy: false,
      patientIdLookupError: null,
      setDraft: vi.fn(),
      setPendingOrganism: vi.fn(),
      setShowAdditionalOrganismForm: vi.fn(),
      togglePredisposingFactor: vi.fn(),
      updatePrimaryOrganism: vi.fn(),
      addAdditionalOrganism: vi.fn(),
      removeAdditionalOrganism: vi.fn(),
      onCompleteIntake: vi.fn(),
      whiteDraftImages: [],
      fluoresceinDraftImages: [],
      draftLesionPromptBoxes: {},
      whiteFileInputRef: { current: null },
      fluoresceinFileInputRef: { current: null },
      openFilePicker: vi.fn(),
      appendFiles: vi.fn(),
      handleDraftLesionPointerDown: vi.fn(),
      handleDraftLesionPointerMove: vi.fn(),
      finishDraftLesionPointer: vi.fn(),
      removeDraftImage: vi.fn(),
      setRepresentativeImage: vi.fn(),
      onSaveCase: saveSpy,
      saveBusy: false,
      selectedSiteId: "39100103",
    });

    expect(completedProps.imageManagerPanelProps).not.toBeNull();
    completedProps.imageManagerPanelProps?.onSaveCase();
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it("builds patient-list props with guarded prefetch and async backlog wrappers", async () => {
    const prefetchDesktopVisitImages = vi.fn();
    const enableBacklog = vi.fn(async () => undefined);
    const refreshBacklog = vi.fn(async () => undefined);
    const backfillArtifacts = vi.fn(async () => undefined);

    const props = buildPatientListViewProps({
      locale: "en",
      localeTag: "en-US",
      commonNotAvailable: "N/A",
      selectedSiteId: null,
      token: "token",
      selectedSiteLabel: "Site A",
      selectedPatientId: "P-001",
      patientListRows: [],
      patientListTotalCount: 0,
      patientListPage: 1,
      patientListTotalPages: 1,
      patientListThumbsByPatient: {},
      caseSearch: "",
      showOnlyMine: false,
      casesLoading: false,
      copyPatients: "Patients",
      copyAllRecords: "All",
      copyMyPatientsOnly: "Mine",
      copyLoadingSavedCases: "Loading",
      pick: (_locale, en) => en,
      translateOption: (_locale, _group, value) => value,
      displayVisitReference: (_locale, visitReference) => visitReference,
      formatDateTime: (value) => value ?? "N/A",
      onSearchChange: vi.fn(),
      onShowOnlyMineChange: vi.fn(),
      onPageChange: vi.fn(),
      onOpenSavedCase: vi.fn(),
      onOpenImageTextSearchResult: vi.fn(),
      prefetchDesktopVisitImages,
      medsamArtifactActiveStatus: null,
      medsamArtifactScope: "patient",
      medsamArtifactItems: [],
      medsamArtifactItemsBusy: false,
      medsamArtifactPage: 1,
      medsamArtifactTotalCount: 0,
      medsamArtifactTotalPages: 1,
      medsamArtifactPanelEnabled: true,
      medsamArtifactStatus: null,
      medsamArtifactStatusBusy: false,
      medsamArtifactBackfillBusy: false,
      canBackfillMedsamArtifacts: true,
      onEnableMedsamArtifactPanel: enableBacklog,
      onDisableMedsamArtifactPanel: vi.fn(),
      onRefreshMedsamArtifactStatus: refreshBacklog,
      onOpenMedsamArtifactBacklog: vi.fn(),
      onCloseMedsamArtifactBacklog: vi.fn(),
      onMedsamArtifactScopeChange: vi.fn(),
      onMedsamArtifactPageChange: vi.fn(),
      onBackfillMedsamArtifacts: backfillArtifacts,
    });

    props.boardProps.onPrefetchCase?.({
      case_id: "case_1",
      visit_id: "visit_1",
      patient_id: "P-001",
      visit_date: "Initial",
    } as any);
    expect(prefetchDesktopVisitImages).not.toHaveBeenCalled();

    await props.backlogProps.onEnableMedsamArtifactPanel();
    await props.backlogProps.onRefreshMedsamArtifactStatus();
    await props.backlogProps.onBackfillMedsamArtifacts();
    expect(enableBacklog).toHaveBeenCalledTimes(1);
    expect(refreshBacklog).toHaveBeenCalledWith(true);
    expect(backfillArtifacts).toHaveBeenCalledTimes(1);

    const hydratedProps = buildPatientListViewProps({
      ...props.boardProps,
      selectedSiteId: "site-1",
      onOpenImageTextSearchResult: vi.fn(),
      patientListRows: [],
      patientListTotalCount: 0,
      patientListPage: 1,
      patientListTotalPages: 1,
      patientListThumbsByPatient: {},
      caseSearch: "",
      showOnlyMine: false,
      casesLoading: false,
      copyPatients: "Patients",
      copyAllRecords: "All",
      copyMyPatientsOnly: "Mine",
      copyLoadingSavedCases: "Loading",
      prefetchDesktopVisitImages,
      medsamArtifactPanelEnabled: true,
      medsamArtifactStatus: null,
      medsamArtifactStatusBusy: false,
      medsamArtifactBackfillBusy: false,
      canBackfillMedsamArtifacts: true,
      onEnableMedsamArtifactPanel: enableBacklog,
      onDisableMedsamArtifactPanel: vi.fn(),
      onRefreshMedsamArtifactStatus: refreshBacklog,
      onOpenMedsamArtifactBacklog: vi.fn(),
      onCloseMedsamArtifactBacklog: vi.fn(),
      onMedsamArtifactScopeChange: vi.fn(),
      onMedsamArtifactPageChange: vi.fn(),
      onBackfillMedsamArtifacts: backfillArtifacts,
    });

    hydratedProps.boardProps.onPrefetchCase?.({
      case_id: "case_2",
      visit_id: "visit_2",
      patient_id: "P-002",
      visit_date: "FU #1",
    } as any);
    expect(prefetchDesktopVisitImages).toHaveBeenCalledWith(
      "site-1",
      "P-002",
      "FU #1",
    );
  });
});
