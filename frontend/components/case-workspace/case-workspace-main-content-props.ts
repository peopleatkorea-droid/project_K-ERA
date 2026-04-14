"use client";

import type { ComponentProps } from "react";

import { CaseWorkspaceAuthoringCanvas } from "./case-workspace-authoring-canvas";
import { ImageManagerPanel } from "./image-manager-panel";
import { MedsamArtifactBacklogPanel } from "./medsam-artifact-backlog-panel";
import { PatientListBoard } from "./patient-list-board";
import { PatientVisitForm } from "./patient-visit-form";
import { SavedCaseImageBoard } from "./saved-case-image-board";
import { SavedCaseOverview, SavedCaseSidebar } from "./saved-case-overview";
import {
  buildDraftCanvasViewModel,
  buildDraftPatientVisitFormViewModel,
  buildSavedCaseSidebarViewModel,
} from "./case-workspace-view-models";

type SavedCaseOverviewProps = ComponentProps<typeof SavedCaseOverview>;
type SavedCaseImageBoardProps = ComponentProps<typeof SavedCaseImageBoard>;
type SavedCaseSidebarProps = ComponentProps<typeof SavedCaseSidebar>;
type PatientVisitFormProps = ComponentProps<typeof PatientVisitForm>;
type ImageManagerPanelProps = ComponentProps<typeof ImageManagerPanel>;
type PatientListBoardProps = ComponentProps<typeof PatientListBoard>;
type MedsamArtifactBacklogPanelProps = ComponentProps<
  typeof MedsamArtifactBacklogPanel
>;
type AuthoringCanvasProps = Omit<
  ComponentProps<typeof CaseWorkspaceAuthoringCanvas>,
  "patientVisitForm" | "imageManagerPanel"
>;

export function buildPatientListViewProps(args: {
  locale: PatientListBoardProps["locale"];
  localeTag: PatientListBoardProps["localeTag"];
  commonNotAvailable: PatientListBoardProps["commonNotAvailable"];
  selectedSiteId: string | null;
  token: PatientListBoardProps["token"];
  selectedSiteLabel: PatientListBoardProps["selectedSiteLabel"];
  selectedPatientId: PatientListBoardProps["selectedPatientId"];
  patientListRows: PatientListBoardProps["patientListRows"];
  patientListTotalCount: PatientListBoardProps["patientListTotalCount"];
  patientListPage: PatientListBoardProps["patientListPage"];
  patientListTotalPages: PatientListBoardProps["patientListTotalPages"];
  patientListThumbsByPatient: PatientListBoardProps["patientListThumbsByPatient"];
  caseSearch: PatientListBoardProps["caseSearch"];
  showOnlyMine: PatientListBoardProps["showOnlyMine"];
  casesLoading: PatientListBoardProps["casesLoading"];
  copyPatients: PatientListBoardProps["copyPatients"];
  copyAllRecords: PatientListBoardProps["copyAllRecords"];
  copyMyPatientsOnly: PatientListBoardProps["copyMyPatientsOnly"];
  copyLoadingSavedCases: PatientListBoardProps["copyLoadingSavedCases"];
  pick: PatientListBoardProps["pick"];
  translateOption: PatientListBoardProps["translateOption"];
  displayVisitReference: PatientListBoardProps["displayVisitReference"];
  formatDateTime: PatientListBoardProps["formatDateTime"];
  onSearchChange: PatientListBoardProps["onSearchChange"];
  onShowOnlyMineChange: PatientListBoardProps["onShowOnlyMineChange"];
  onPageChange: PatientListBoardProps["onPageChange"];
  onOpenSavedCase: PatientListBoardProps["onOpenSavedCase"];
  onOpenImageTextSearchResult: PatientListBoardProps["onOpenImageTextSearchResult"];
  prefetchDesktopVisitImages?: (
    siteId: string,
    patientId: string,
    visitDate: string,
  ) => void;
  medsamArtifactActiveStatus: PatientListBoardProps["medsamArtifactActiveStatus"];
  medsamArtifactScope: PatientListBoardProps["medsamArtifactScope"];
  medsamArtifactItems: PatientListBoardProps["medsamArtifactItems"];
  medsamArtifactItemsBusy: PatientListBoardProps["medsamArtifactItemsBusy"];
  medsamArtifactPage: PatientListBoardProps["medsamArtifactPage"];
  medsamArtifactTotalCount: PatientListBoardProps["medsamArtifactTotalCount"];
  medsamArtifactTotalPages: PatientListBoardProps["medsamArtifactTotalPages"];
  medsamArtifactPanelEnabled: MedsamArtifactBacklogPanelProps["medsamArtifactPanelEnabled"];
  medsamArtifactStatus: MedsamArtifactBacklogPanelProps["medsamArtifactStatus"];
  medsamArtifactStatusBusy: MedsamArtifactBacklogPanelProps["medsamArtifactStatusBusy"];
  medsamArtifactBackfillBusy: MedsamArtifactBacklogPanelProps["medsamArtifactBackfillBusy"];
  canBackfillMedsamArtifacts: MedsamArtifactBacklogPanelProps["canBackfillMedsamArtifacts"];
  onEnableMedsamArtifactPanel: () => void | Promise<void>;
  onDisableMedsamArtifactPanel: MedsamArtifactBacklogPanelProps["onDisableMedsamArtifactPanel"];
  onRefreshMedsamArtifactStatus: (force?: boolean) => void | Promise<void>;
  onOpenMedsamArtifactBacklog: MedsamArtifactBacklogPanelProps["onOpenMedsamArtifactBacklog"];
  onCloseMedsamArtifactBacklog: MedsamArtifactBacklogPanelProps["onCloseMedsamArtifactBacklog"];
  onMedsamArtifactScopeChange: PatientListBoardProps["onMedsamArtifactScopeChange"];
  onMedsamArtifactPageChange: PatientListBoardProps["onMedsamArtifactPageChange"];
  onBackfillMedsamArtifacts: () => void | Promise<void>;
}) {
  const {
    locale,
    localeTag,
    commonNotAvailable,
    selectedSiteId,
    token,
    selectedSiteLabel,
    selectedPatientId,
    patientListRows,
    patientListTotalCount,
    patientListPage,
    patientListTotalPages,
    patientListThumbsByPatient,
    caseSearch,
    showOnlyMine,
    casesLoading,
    copyPatients,
    copyAllRecords,
    copyMyPatientsOnly,
    copyLoadingSavedCases,
    pick,
    translateOption,
    displayVisitReference,
    formatDateTime,
    onSearchChange,
    onShowOnlyMineChange,
    onPageChange,
    onOpenSavedCase,
    onOpenImageTextSearchResult,
    prefetchDesktopVisitImages,
    medsamArtifactActiveStatus,
    medsamArtifactScope,
    medsamArtifactItems,
    medsamArtifactItemsBusy,
    medsamArtifactPage,
    medsamArtifactTotalCount,
    medsamArtifactTotalPages,
    medsamArtifactPanelEnabled,
    medsamArtifactStatus,
    medsamArtifactStatusBusy,
    medsamArtifactBackfillBusy,
    canBackfillMedsamArtifacts,
    onEnableMedsamArtifactPanel,
    onDisableMedsamArtifactPanel,
    onRefreshMedsamArtifactStatus,
    onOpenMedsamArtifactBacklog,
    onCloseMedsamArtifactBacklog,
    onMedsamArtifactScopeChange,
    onMedsamArtifactPageChange,
    onBackfillMedsamArtifacts,
  } = args;

  const boardProps: PatientListBoardProps = {
    locale,
    localeTag,
    commonNotAvailable,
    siteId: selectedSiteId,
    token,
    selectedSiteLabel,
    selectedPatientId,
    patientListRows,
    patientListTotalCount,
    patientListPage,
    patientListTotalPages,
    patientListThumbsByPatient,
    caseSearch,
    showOnlyMine,
    casesLoading,
    copyPatients,
    copyAllRecords,
    copyMyPatientsOnly,
    copyLoadingSavedCases,
    pick,
    translateOption,
    displayVisitReference,
    formatDateTime,
    onSearchChange,
    onShowOnlyMineChange,
    onPageChange,
    onOpenSavedCase,
    onOpenImageTextSearchResult,
    onPrefetchCase: (caseRecord) => {
      if (!selectedSiteId || !prefetchDesktopVisitImages) {
        return;
      }
      prefetchDesktopVisitImages(
        selectedSiteId,
        caseRecord.patient_id,
        caseRecord.visit_date,
      );
    },
    medsamArtifactActiveStatus,
    medsamArtifactScope,
    medsamArtifactItems,
    medsamArtifactItemsBusy,
    medsamArtifactPage,
    medsamArtifactTotalCount,
    medsamArtifactTotalPages,
    onCloseMedsamArtifactBacklog,
    onMedsamArtifactScopeChange,
    onMedsamArtifactPageChange,
  };

  const backlogProps: MedsamArtifactBacklogPanelProps = {
    locale,
    pick,
    medsamArtifactPanelEnabled,
    medsamArtifactStatus,
    medsamArtifactStatusBusy,
    medsamArtifactBackfillBusy,
    medsamArtifactActiveStatus,
    canBackfillMedsamArtifacts,
    onEnableMedsamArtifactPanel: () => {
      void onEnableMedsamArtifactPanel();
    },
    onDisableMedsamArtifactPanel,
    onRefreshMedsamArtifactStatus: () => {
      void onRefreshMedsamArtifactStatus(true);
    },
    onOpenMedsamArtifactBacklog,
    onCloseMedsamArtifactBacklog,
    onBackfillMedsamArtifacts: () => {
      void onBackfillMedsamArtifacts();
    },
  };

  return {
    boardProps,
    backlogProps,
  };
}

export function buildSavedCaseViewProps(args: {
  locale: SavedCaseOverviewProps["locale"];
  localeTag: SavedCaseOverviewProps["localeTag"];
  commonLoading: SavedCaseOverviewProps["commonLoading"];
  commonNotAvailable: SavedCaseOverviewProps["commonNotAvailable"];
  selectedCase: SavedCaseOverviewProps["selectedCase"];
  selectedPatientCases: SavedCaseOverviewProps["selectedPatientCases"];
  panelBusy: SavedCaseOverviewProps["panelBusy"];
  patientVisitGalleryBusy: SavedCaseOverviewProps["patientVisitGalleryBusy"];
  patientVisitGallery: SavedCaseOverviewProps["patientVisitGallery"];
  patientVisitGalleryLoadingCaseIds: SavedCaseOverviewProps["patientVisitGalleryLoadingCaseIds"];
  patientVisitGalleryErrorCaseIds: SavedCaseOverviewProps["patientVisitGalleryErrorCaseIds"];
  pick: SavedCaseOverviewProps["pick"];
  translateOption: SavedCaseOverviewProps["translateOption"];
  displayVisitReference: SavedCaseOverviewProps["displayVisitReference"];
  formatDateTime: SavedCaseOverviewProps["formatDateTime"];
  organismSummaryLabel: SavedCaseOverviewProps["organismSummaryLabel"];
  editDraftBusy: SavedCaseOverviewProps["editDraftBusy"];
  onStartEditDraft: SavedCaseOverviewProps["onStartEditDraft"];
  onStartFollowUpDraft: SavedCaseOverviewProps["onStartFollowUpDraft"];
  onToggleFavorite: SavedCaseOverviewProps["onToggleFavorite"];
  onOpenSavedCase: SavedCaseOverviewProps["onOpenSavedCase"];
  selectedSiteId: string | null;
  ensurePatientVisitImagesLoaded: (
    siteId: string,
    caseRecord: SavedCaseOverviewProps["selectedCase"],
  ) => Promise<SavedCaseImageBoardProps["selectedCaseImages"]>;
  onDeleteSavedCase: SavedCaseOverviewProps["onDeleteSavedCase"];
  isFavoriteCase: SavedCaseOverviewProps["isFavoriteCase"];
  caseTitle: SavedCaseOverviewProps["caseTitle"];
  selectedCaseImages: SavedCaseImageBoardProps["selectedCaseImages"];
  liveLesionMaskEnabled: SavedCaseImageBoardProps["liveLesionMaskEnabled"];
  semanticPromptInputMode: SavedCaseImageBoardProps["semanticPromptInputMode"];
  semanticPromptInputOptions: SavedCaseImageBoardProps["semanticPromptInputOptions"];
  semanticPromptBusyImageId: SavedCaseImageBoardProps["semanticPromptBusyImageId"];
  semanticPromptReviews: SavedCaseImageBoardProps["semanticPromptReviews"];
  semanticPromptErrors: SavedCaseImageBoardProps["semanticPromptErrors"];
  semanticPromptOpenImageIds: SavedCaseImageBoardProps["semanticPromptOpenImageIds"];
  liveLesionPreviews: SavedCaseImageBoardProps["liveLesionPreviews"];
  savedImageRoiCropUrls: SavedCaseImageBoardProps["savedImageRoiCropUrls"];
  savedImageRoiCropBusy: SavedCaseImageBoardProps["savedImageRoiCropBusy"];
  savedImageLesionCropUrls: SavedCaseImageBoardProps["savedImageLesionCropUrls"];
  savedImageLesionCropBusy: SavedCaseImageBoardProps["savedImageLesionCropBusy"];
  lesionPromptDrafts: SavedCaseImageBoardProps["lesionPromptDrafts"];
  lesionPromptSaved: SavedCaseImageBoardProps["lesionPromptSaved"];
  lesionBoxBusyImageId: SavedCaseImageBoardProps["lesionBoxBusyImageId"];
  representativeBusyImageId: SavedCaseImageBoardProps["representativeBusyImageId"];
  formatSemanticScore: SavedCaseImageBoardProps["formatSemanticScore"];
  onToggleLiveLesionMask: SavedCaseImageBoardProps["onToggleLiveLesionMask"];
  onSemanticPromptInputModeChange: SavedCaseImageBoardProps["onSemanticPromptInputModeChange"];
  onSetSavedRepresentative: SavedCaseImageBoardProps["onSetSavedRepresentative"];
  onReviewSemanticPrompts: SavedCaseImageBoardProps["onReviewSemanticPrompts"];
  onLesionPointerDown: SavedCaseImageBoardProps["onLesionPointerDown"];
  onLesionPointerMove: SavedCaseImageBoardProps["onLesionPointerMove"];
  onFinishLesionPointer: SavedCaseImageBoardProps["onFinishLesionPointer"];
  hasAnySavedLesionBox: boolean;
}) {
  const {
    locale,
    localeTag,
    commonLoading,
    commonNotAvailable,
    selectedCase,
    selectedPatientCases,
    panelBusy,
    patientVisitGalleryBusy,
    patientVisitGallery,
    patientVisitGalleryLoadingCaseIds,
    patientVisitGalleryErrorCaseIds,
    pick,
    translateOption,
    displayVisitReference,
    formatDateTime,
    organismSummaryLabel,
    editDraftBusy,
    onStartEditDraft,
    onStartFollowUpDraft,
    onToggleFavorite,
    onOpenSavedCase,
    selectedSiteId,
    ensurePatientVisitImagesLoaded,
    onDeleteSavedCase,
    isFavoriteCase,
    caseTitle,
    selectedCaseImages,
    liveLesionMaskEnabled,
    semanticPromptInputMode,
    semanticPromptInputOptions,
    semanticPromptBusyImageId,
    semanticPromptReviews,
    semanticPromptErrors,
    semanticPromptOpenImageIds,
    liveLesionPreviews,
    savedImageRoiCropUrls,
    savedImageRoiCropBusy,
    savedImageLesionCropUrls,
    savedImageLesionCropBusy,
    lesionPromptDrafts,
    lesionPromptSaved,
    lesionBoxBusyImageId,
    representativeBusyImageId,
    formatSemanticScore,
    onToggleLiveLesionMask,
    onSemanticPromptInputModeChange,
    onSetSavedRepresentative,
    onReviewSemanticPrompts,
    onLesionPointerDown,
    onLesionPointerMove,
    onFinishLesionPointer,
    hasAnySavedLesionBox,
  } = args;

  const overviewProps: SavedCaseOverviewProps = {
    locale,
    localeTag,
    commonLoading,
    commonNotAvailable,
    selectedCase,
    selectedPatientCases,
    panelBusy,
    patientVisitGalleryBusy,
    patientVisitGallery,
    patientVisitGalleryLoadingCaseIds,
    patientVisitGalleryErrorCaseIds,
    pick,
    translateOption,
    displayVisitReference,
    formatDateTime,
    organismSummaryLabel,
    editDraftBusy,
    onStartEditDraft,
    onStartFollowUpDraft,
    onToggleFavorite,
    onOpenSavedCase,
    onEnsureVisitImages: (caseRecord) => {
      if (!selectedSiteId) {
        return Promise.resolve([]);
      }
      return ensurePatientVisitImagesLoaded(selectedSiteId, caseRecord);
    },
    onDeleteSavedCase,
    isFavoriteCase,
    caseTitle,
  };

  const imageBoardProps: SavedCaseImageBoardProps = {
    locale,
    commonLoading,
    commonNotAvailable,
    selectedVisitLabel: displayVisitReference(locale, selectedCase.visit_date),
    panelBusy,
    selectedCaseImageCountHint: selectedCase.image_count,
    selectedCaseImages,
    liveLesionMaskEnabled,
    semanticPromptInputMode,
    semanticPromptInputOptions,
    semanticPromptBusyImageId,
    semanticPromptReviews,
    semanticPromptErrors,
    semanticPromptOpenImageIds,
    liveLesionPreviews,
    savedImageRoiCropUrls,
    savedImageRoiCropBusy,
    savedImageLesionCropUrls,
    savedImageLesionCropBusy,
    lesionPromptDrafts,
    lesionPromptSaved,
    lesionBoxBusyImageId,
    representativeBusyImageId,
    pick,
    translateOption,
    formatSemanticScore,
    onToggleLiveLesionMask,
    onSemanticPromptInputModeChange,
    onSetSavedRepresentative,
    onReviewSemanticPrompts,
    onLesionPointerDown,
    onLesionPointerMove,
    onFinishLesionPointer,
  };

  const sidebarProps: SavedCaseSidebarProps = {
    locale,
    pick,
    ...buildSavedCaseSidebarViewModel({
      selectedCase,
      selectedCaseImages,
      hasAnySavedLesionBox,
    }),
  };

  return {
    overviewProps,
    imageBoardProps,
    sidebarProps,
  };
}

export function buildDraftViewProps(args: {
  locale: AuthoringCanvasProps["locale"];
  draft: PatientVisitFormProps["draft"];
  selectedSiteLabel: AuthoringCanvasProps["selectedSiteLabel"];
  draftStatusLabel: AuthoringCanvasProps["draftStatusLabel"];
  resolvedVisitReferenceLabel: AuthoringCanvasProps["resolvedVisitReferenceLabel"];
  translateOption: (
    locale: AuthoringCanvasProps["locale"],
    group:
      | "sex"
      | "contactLens"
      | "predisposing"
      | "smear"
      | "visitStatus"
      | "view"
      | "cultureCategory",
    value: string,
  ) => string;
  organismSummaryLabel: (
    cultureCategory: string,
    cultureSpecies: string,
    additionalOrganisms: Array<{
      culture_category: string;
      culture_species: string;
    }>,
    limit?: number,
  ) => string;
  actualVisitDateLabel: PatientVisitFormProps["actualVisitDateLabel"];
  commonNotAvailable: PatientVisitFormProps["notAvailableLabel"];
  sexOptions: PatientVisitFormProps["sexOptions"];
  contactLensOptions: PatientVisitFormProps["contactLensOptions"];
  predisposingFactorOptions: PatientVisitFormProps["predisposingFactorOptions"];
  visitStatusOptions: PatientVisitFormProps["visitStatusOptions"];
  cultureStatusOptions: PatientVisitFormProps["cultureStatusOptions"];
  cultureSpecies: PatientVisitFormProps["cultureSpecies"];
  speciesOptions: PatientVisitFormProps["speciesOptions"];
  pendingOrganism: PatientVisitFormProps["pendingOrganism"];
  pendingSpeciesOptions: PatientVisitFormProps["pendingSpeciesOptions"];
  showAdditionalOrganismForm: PatientVisitFormProps["showAdditionalOrganismForm"];
  intakeOrganisms: PatientVisitFormProps["intakeOrganisms"];
  patientIdLookup: PatientVisitFormProps["patientIdLookup"];
  patientIdLookupBusy: PatientVisitFormProps["patientIdLookupBusy"];
  patientIdLookupError: PatientVisitFormProps["patientIdLookupError"];
  setDraft: PatientVisitFormProps["setDraft"];
  setPendingOrganism: PatientVisitFormProps["setPendingOrganism"];
  setShowAdditionalOrganismForm: PatientVisitFormProps["setShowAdditionalOrganismForm"];
  togglePredisposingFactor: PatientVisitFormProps["togglePredisposingFactor"];
  updatePrimaryOrganism: PatientVisitFormProps["updatePrimaryOrganism"];
  addAdditionalOrganism: PatientVisitFormProps["addAdditionalOrganism"];
  removeAdditionalOrganism: PatientVisitFormProps["removeAdditionalOrganism"];
  onCompleteIntake: PatientVisitFormProps["onCompleteIntake"];
  whiteDraftImages: ImageManagerPanelProps["whiteDraftImages"];
  fluoresceinDraftImages: ImageManagerPanelProps["fluoresceinDraftImages"];
  draftLesionPromptBoxes: ImageManagerPanelProps["draftLesionPromptBoxes"];
  whiteFileInputRef: ImageManagerPanelProps["whiteFileInputRef"];
  fluoresceinFileInputRef: ImageManagerPanelProps["fluoresceinFileInputRef"];
  openFilePicker: ImageManagerPanelProps["openFilePicker"];
  appendFiles: ImageManagerPanelProps["appendFiles"];
  handleDraftLesionPointerDown: ImageManagerPanelProps["handleDraftLesionPointerDown"];
  handleDraftLesionPointerMove: ImageManagerPanelProps["handleDraftLesionPointerMove"];
  finishDraftLesionPointer: ImageManagerPanelProps["finishDraftLesionPointer"];
  removeDraftImage: ImageManagerPanelProps["removeDraftImage"];
  setRepresentativeImage: ImageManagerPanelProps["setRepresentativeImage"];
  onSaveCase: ImageManagerPanelProps["onSaveCase"];
  saveBusy: ImageManagerPanelProps["saveBusy"];
  selectedSiteId: ImageManagerPanelProps["selectedSiteId"];
}) {
  const {
    locale,
    draft,
    selectedSiteLabel,
    draftStatusLabel,
    resolvedVisitReferenceLabel,
    translateOption,
    organismSummaryLabel,
    actualVisitDateLabel,
    commonNotAvailable,
    sexOptions,
    contactLensOptions,
    predisposingFactorOptions,
    visitStatusOptions,
    cultureStatusOptions,
    cultureSpecies,
    speciesOptions,
    pendingOrganism,
    pendingSpeciesOptions,
    showAdditionalOrganismForm,
    intakeOrganisms,
    patientIdLookup,
    patientIdLookupBusy,
    patientIdLookupError,
    setDraft,
    setPendingOrganism,
    setShowAdditionalOrganismForm,
    togglePredisposingFactor,
    updatePrimaryOrganism,
    addAdditionalOrganism,
    removeAdditionalOrganism,
    onCompleteIntake,
    whiteDraftImages,
    fluoresceinDraftImages,
    draftLesionPromptBoxes,
    whiteFileInputRef,
    fluoresceinFileInputRef,
    openFilePicker,
    appendFiles,
    handleDraftLesionPointerDown,
    handleDraftLesionPointerMove,
    finishDraftLesionPointer,
    removeDraftImage,
    setRepresentativeImage,
    onSaveCase,
    saveBusy,
    selectedSiteId,
  } = args;

  const canvasProps: AuthoringCanvasProps = buildDraftCanvasViewModel({
    locale,
    draft,
    selectedSiteLabel,
    draftStatusLabel,
    resolvedVisitReferenceLabel,
    translateOption,
    organismSummaryLabel,
  });

  const patientVisitFormProps: PatientVisitFormProps = {
    locale,
    draft,
    draftStatusLabel,
    notAvailableLabel: commonNotAvailable,
    sexOptions,
    contactLensOptions,
    predisposingFactorOptions,
    visitStatusOptions,
    cultureStatusOptions,
    cultureSpecies,
    speciesOptions,
    pendingOrganism,
    pendingSpeciesOptions,
    showAdditionalOrganismForm,
    intakeOrganisms,
    patientIdLookup,
    patientIdLookupBusy,
    patientIdLookupError,
    ...buildDraftPatientVisitFormViewModel({
      draft,
      resolvedVisitReferenceLabel,
      actualVisitDateLabel,
      organismSummaryLabel,
    }),
    setDraft,
    setPendingOrganism,
    setShowAdditionalOrganismForm,
    togglePredisposingFactor,
    updatePrimaryOrganism,
    addAdditionalOrganism,
    removeAdditionalOrganism,
    onCompleteIntake,
  };

  const imageManagerPanelProps: ImageManagerPanelProps | null =
    draft.intake_completed
      ? {
          locale,
          intakeCompleted: draft.intake_completed,
          resolvedVisitReferenceLabel,
          whiteDraftImages,
          fluoresceinDraftImages,
          draftLesionPromptBoxes,
          whiteFileInputRef,
          fluoresceinFileInputRef,
          openFilePicker,
          appendFiles,
          handleDraftLesionPointerDown,
          handleDraftLesionPointerMove,
          finishDraftLesionPointer,
          removeDraftImage,
          setRepresentativeImage,
          onSaveCase,
          saveBusy,
          selectedSiteId,
        }
      : null;

  return {
    canvasProps,
    patientVisitFormProps,
    imageManagerPanelProps,
  };
}
