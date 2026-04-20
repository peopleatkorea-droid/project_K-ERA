import { describe, expect, it, vi } from "vitest";

import {
  buildCaseWorkspaceAnalysisSectionContent,
  buildCaseWorkspaceAnalysisSectionProps,
  buildCaseWorkspaceContributionSectionProps,
  buildCaseWorkspaceLeftRailProps,
  buildCaseWorkspaceReviewContentProps,
  buildCaseWorkspaceReviewPanelProps,
  buildCaseWorkspaceSelectedCasePanelContent,
} from "./case-workspace-side-panel-props";

describe("case-workspace side panel props", () => {
  it("builds left-rail props with deferred history and formatted timestamps", async () => {
    const runSiteValidation = vi.fn(async () => undefined);
    const props = buildCaseWorkspaceLeftRailProps({
      locale: "en",
      visibleSites: [{ site_id: "site-1", site_name: "Demo" } as any],
      selectedSiteId: "site-1",
      summary: null,
      desktopFastMode: true,
      newCaseModeActive: false,
      listModeActive: true,
      isAuthoringCanvas: false,
      draftCompletionPercent: 25,
      draftImagesCount: 2,
      draftRepresentativeCount: 1,
      resolvedVisitReferenceLabel: "Initial",
      draftStatusLabel: "Autosaved",
      latestSiteValidation: null,
      siteValidationRuns: [],
      railView: "patients",
      siteValidationBusy: false,
      canRunValidation: true,
      commonNotAvailable: "N/A",
      localeTag: "en-US",
      formatDateTime: (value, localeTag, emptyLabel) =>
        value ? `${localeTag}:${value}` : emptyLabel,
      latestAutosavedDraft: null,
      onStartNewCase: vi.fn(),
      onOpenPatientList: vi.fn(),
      onOpenLatestAutosavedDraft: vi.fn(),
      onSelectSite: vi.fn(),
      onRunSiteValidation: runSiteValidation,
    });

    expect(props.allowCaseCreation).toBe(true);
    expect(props.fastMode).toBe(true);
    expect(props.deferValidationHistory).toBe(true);
    expect(props.formatDateTime("2026-04-13")).toBe("en-US:2026-04-13");
    await props.onRunSiteValidation();
    expect(runSiteValidation).toHaveBeenCalledTimes(1);
  });

  it("builds analysis props with selectable model sorting and wrapped callbacks", async () => {
    const runValidation = vi.fn(async () => null);
    const props = buildCaseWorkspaceAnalysisSectionProps({
      locale: "en",
      token: "token",
      selectedSiteId: "site-1",
      mounted: true,
      commonLoading: "Loading",
      commonNotAvailable: "N/A",
      hasSelectedCase: true,
      canRunRoiPreview: true,
      canRunValidation: true,
      canRunAiClinic: true,
      selectedCaseImageCount: 3,
      representativePreviewUrl: "/preview.png",
      selectedCompareModelVersionIds: ["v2"],
      selectedValidationModelVersionId: "v1",
      siteModelVersions: [
        {
          version_id: "v1",
          version_name: "Older",
          architecture: "convnext_tiny",
          created_at: "2026-04-11T00:00:00Z",
          ready: true,
        },
        {
          version_id: "v2",
          version_name: "Newest",
          architecture: "convnext_tiny",
          created_at: "2026-04-13T00:00:00Z",
          ready: true,
        },
        {
          version_id: "v3",
          version_name: "Analysis only",
          architecture: "convnext_tiny",
          created_at: "2026-04-12T00:00:00Z",
          ready: true,
          stage: "analysis",
        },
      ] as any,
      siteModelCatalogState: "ready",
      validationBusy: false,
      validationResult: null,
      validationArtifacts: {},
      modelCompareBusy: false,
      modelCompareResult: null,
      aiClinicBusy: false,
      aiClinicExpandedBusy: false,
      aiClinicResult: null,
      aiClinicPreviewBusy: false,
      hasAnySavedLesionBox: false,
      roiPreviewBusy: false,
      lesionPreviewBusy: false,
      roiPreviewItems: [],
      lesionPreviewItems: [],
      pickLabel: (_locale, en) => en,
      translateOption: (_locale, _group, value) => value,
      setToast: vi.fn(),
      setSelectedCompareModelVersionIds: vi.fn(),
      setSelectedValidationModelVersionId: vi.fn(),
      displayVisitReference: (_locale, visitReference) => `Visit ${visitReference}`,
      aiClinicTextUnavailableLabel: "Unavailable",
      onRunValidation: runValidation,
      onRunModelCompare: vi.fn(async () => null),
      onRunAiClinic: vi.fn(async () => null),
      onExpandAiClinic: vi.fn(),
      onRunRoiPreview: vi.fn(),
      onRunLesionPreview: vi.fn(),
    });

    expect(props.compareModelCandidates.map((item) => item.version_id)).toEqual([
      "v2",
      "v1",
    ]);
    expect(props.analysisTitle).toBe("Three-step analysis");
    expect(props.displayVisitReference("FU #1")).toBe("Visit FU #1");
    await props.onRunValidation();
    expect(runValidation).toHaveBeenCalledTimes(1);
  });

  it("builds contribution props with registry gating and leaderboard fallback", async () => {
    const contributeCase = vi.fn(async () => undefined);
    const props = buildCaseWorkspaceContributionSectionProps({
      locale: "en",
      mounted: true,
      selectedCase: {
        patient_id: "P-001",
        visit_date: "Initial",
        visit_status: "active",
        research_registry_status: "included",
        culture_status: "positive",
        image_count: 2,
      } as any,
      completionState: null,
      summary: {
        n_validation_runs: 4,
        research_registry: {
          site_enabled: true,
          user_enrolled: true,
        },
      },
      canRunValidation: true,
      validationResult: { ok: true },
      researchRegistryBusy: false,
      contributionBusy: false,
      contributionResult: {
        stats: {
          total_contributions: 5,
          user_contributions: 2,
          user_contribution_pct: 40,
          current_model_version: "v2",
          user_public_alias: "Fallback Alias",
          leaderboard: {
            scope: "site",
            leaderboard: [],
          },
        },
      } as any,
      siteContributionLeaderboard: null,
      historyBusy: false,
      caseHistory: null,
      commonNotAvailable: "N/A",
      localeTag: "en-US",
      formatDateTime: (value, localeTag, emptyLabel) =>
        value ? `${localeTag}:${value}` : emptyLabel,
      userPublicAlias: null,
      onJoinResearchRegistry: vi.fn(),
      onIncludeResearchCase: vi.fn(),
      onExcludeResearchCase: vi.fn(),
      onContributeCase: contributeCase,
    });

    expect(props.canContributeSelectedCase).toBe(true);
    expect(props.mounted).toBe(true);
    expect(props.currentUserPublicAlias).toBe("Fallback Alias");
    expect(props.contributionLeaderboard?.scope).toBe("site");
    expect(props.formatDateTime("2026-04-13", "N/A")).toBe(
      "en-US:2026-04-13",
    );
    await props.onContributeCase();
    expect(contributeCase).toHaveBeenCalledTimes(1);
  });

  it("builds review content and review panel props from section props", () => {
    const review = buildCaseWorkspaceReviewContentProps({
      analysisSectionProps: {
        locale: "en",
        token: "token",
        selectedSiteId: "site-1",
        mounted: true,
        analysisEyebrow: "Validation",
        analysisTitle: "Analysis",
        analysisDescription: "Description",
        imageCountLabel: "images",
        commonLoading: "Loading",
        commonNotAvailable: "N/A",
        hasSelectedCase: true,
        canRunRoiPreview: true,
        canRunValidation: true,
        canRunAiClinic: true,
        selectedCaseImageCount: 2,
        representativePreviewUrl: null,
        selectedCompareModelVersionIds: [],
        selectedValidationModelVersionId: null,
        compareModelCandidates: [],
        modelCatalogState: "idle",
        validationBusy: false,
        validationResult: null,
        validationArtifacts: {},
        modelCompareBusy: false,
        modelCompareResult: null,
        aiClinicBusy: false,
        aiClinicExpandedBusy: false,
        aiClinicResult: null,
        aiClinicPreviewBusy: false,
        hasAnySavedLesionBox: false,
        roiPreviewBusy: false,
        lesionPreviewBusy: false,
        roiPreviewItems: [],
        lesionPreviewItems: [],
        pickLabel: vi.fn(),
        translateOption: vi.fn(),
        setToast: vi.fn(),
        setSelectedCompareModelVersionIds: vi.fn(),
        setSelectedValidationModelVersionId: vi.fn(),
        onRunValidation: vi.fn(),
        onRunModelCompare: vi.fn(),
        onRunAiClinic: vi.fn(),
        onExpandAiClinic: vi.fn(),
        onRunRoiPreview: vi.fn(),
        onRunLesionPreview: vi.fn(),
        displayVisitReference: vi.fn(),
        aiClinicTextUnavailableLabel: "Unavailable",
      } as any,
      contributionSectionProps: {
        locale: "en",
        selectedCase: null,
        completionState: null,
        hospitalValidationCount: 0,
        canRunValidation: true,
        canContributeSelectedCase: false,
        hasValidationResult: false,
        researchRegistryEnabled: true,
        researchRegistryUserEnrolled: true,
        researchRegistryBusy: false,
        contributionBusy: false,
        contributionResult: null,
        currentUserPublicAlias: null,
        contributionLeaderboard: null,
        historyBusy: false,
        caseHistory: null,
        notAvailableLabel: "N/A",
        formatDateTime: vi.fn(),
        onJoinResearchRegistry: vi.fn(),
        onIncludeResearchCase: vi.fn(),
        onExcludeResearchCase: vi.fn(),
        onContributeCase: vi.fn(),
      } as any,
      locale: "en",
      isAuthoringCanvas: true,
      draftStatusLabel: "Autosaved",
      selectedSiteLabel: "Site A",
      draftCompletionCount: 2,
      draftImagesCount: 3,
      draftRepresentativeCount: 1,
      draftCompletionPercent: 50,
      draftPendingItems: [],
    });

    expect(review.analysisSectionContent).toBeTruthy();
    expect(review.reviewPanelProps).toMatchObject({
      locale: "en",
      isAuthoringCanvas: true,
      draftStatusLabel: "Autosaved",
      selectedSiteLabel: "Site A",
      draftCompletionCount: 2,
    });
  });

  it("builds analysis content and selected-case panel content independently", () => {
    const analysisSectionProps = {
      locale: "en",
      token: "token",
      selectedSiteId: "site-1",
      mounted: true,
      analysisEyebrow: "Validation",
      analysisTitle: "Analysis",
      analysisDescription: "Description",
      imageCountLabel: "images",
      commonLoading: "Loading",
      commonNotAvailable: "N/A",
      hasSelectedCase: true,
      canRunRoiPreview: true,
      canRunValidation: true,
      canRunAiClinic: true,
      selectedCaseImageCount: 2,
      representativePreviewUrl: null,
      selectedCompareModelVersionIds: [],
      selectedValidationModelVersionId: null,
      compareModelCandidates: [],
      modelCatalogState: "idle",
      validationBusy: false,
      validationResult: null,
      validationArtifacts: {},
      modelCompareBusy: false,
      modelCompareResult: null,
      aiClinicBusy: false,
      aiClinicExpandedBusy: false,
      aiClinicResult: null,
      aiClinicPreviewBusy: false,
      hasAnySavedLesionBox: false,
      roiPreviewBusy: false,
      lesionPreviewBusy: false,
      roiPreviewItems: [],
      lesionPreviewItems: [],
      pickLabel: vi.fn(),
      translateOption: vi.fn(),
      setToast: vi.fn(),
      setSelectedCompareModelVersionIds: vi.fn(),
      setSelectedValidationModelVersionId: vi.fn(),
      onRunValidation: vi.fn(),
      onRunModelCompare: vi.fn(),
      onRunAiClinic: vi.fn(),
      onExpandAiClinic: vi.fn(),
      onRunRoiPreview: vi.fn(),
      onRunLesionPreview: vi.fn(),
      displayVisitReference: vi.fn(),
      aiClinicTextUnavailableLabel: "Unavailable",
    } as any;
    const contributionSectionProps = {
      locale: "en",
      selectedCase: null,
      completionState: null,
      hospitalValidationCount: 0,
      canRunValidation: true,
      canContributeSelectedCase: false,
      hasValidationResult: false,
      researchRegistryEnabled: true,
      researchRegistryUserEnrolled: true,
      researchRegistryBusy: false,
      contributionBusy: false,
      contributionResult: null,
      currentUserPublicAlias: null,
      contributionLeaderboard: null,
      historyBusy: false,
      caseHistory: null,
      notAvailableLabel: "N/A",
      formatDateTime: vi.fn(),
      onJoinResearchRegistry: vi.fn(),
      onIncludeResearchCase: vi.fn(),
      onExcludeResearchCase: vi.fn(),
      onContributeCase: vi.fn(),
    } as any;

    const analysisSectionContent =
      buildCaseWorkspaceAnalysisSectionContent(analysisSectionProps);
    const selectedCasePanelContent =
      buildCaseWorkspaceSelectedCasePanelContent(contributionSectionProps);
    const reviewPanelProps = buildCaseWorkspaceReviewPanelProps({
      locale: "en",
      selectedCasePanelContent,
      isAuthoringCanvas: true,
      draftStatusLabel: "Autosaved",
      selectedSiteLabel: "Site A",
      draftCompletionCount: 2,
      draftImagesCount: 3,
      draftRepresentativeCount: 1,
      draftCompletionPercent: 50,
      draftPendingItems: [],
    });

    expect(analysisSectionContent).toBeTruthy();
    expect(selectedCasePanelContent).toBeTruthy();
    expect(reviewPanelProps.selectedCasePanelContent).toBe(
      selectedCasePanelContent,
    );
  });
});
