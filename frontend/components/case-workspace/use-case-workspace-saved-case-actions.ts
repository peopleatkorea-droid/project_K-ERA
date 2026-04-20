"use client";

import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";

import {
  handleOpenImageTextSearchResult as runHandleOpenImageTextSearchResult,
  openSavedCase as runOpenSavedCase,
  startEditDraftFromSelectedCase as runStartEditDraftFromSelectedCase,
  startFollowUpDraftFromSelectedCase as runStartFollowUpDraftFromSelectedCase,
} from "./case-workspace-saved-case";
import { createDraftState } from "./case-workspace-draft-helpers";

type OpenSavedCaseInput = Parameters<typeof runOpenSavedCase>[0];
type StartFollowUpDraftInput =
  Parameters<typeof runStartFollowUpDraftFromSelectedCase>[0];
type StartEditDraftInput =
  Parameters<typeof runStartEditDraftFromSelectedCase>[0];
type OpenImageTextSearchResultInput =
  Parameters<typeof runHandleOpenImageTextSearchResult>[0];

type Args = {
  selectedCase: StartFollowUpDraftInput["selectedCase"];
  selectedSiteId: StartFollowUpDraftInput["selectedSiteId"];
  cases: OpenSavedCaseInput["cases"];
  token: StartFollowUpDraftInput["token"];
  locale: StartFollowUpDraftInput["locale"];
  desktopFastMode: OpenSavedCaseInput["desktopFastMode"];
  workspaceTimingLogs: OpenSavedCaseInput["workspaceTimingLogs"];
  caseOpenStartedAtRef: OpenSavedCaseInput["caseOpenStartedAtRef"];
  caseOpenCaseIdRef: OpenSavedCaseInput["caseOpenCaseIdRef"];
  caseImagesLoggedCaseIdRef: OpenSavedCaseInput["caseImagesLoggedCaseIdRef"];
  caseOpenSlaSessionRef: OpenSavedCaseInput["caseOpenSlaSessionRef"];
  setCases: OpenSavedCaseInput["setCases"];
  setSelectedCase: StartFollowUpDraftInput["setSelectedCase"];
  setSelectedPatientCases: OpenSavedCaseInput["setSelectedPatientCases"];
  setPanelOpen: StartFollowUpDraftInput["setPanelOpen"];
  setRailView: StartFollowUpDraftInput["setRailView"];
  buildKnownPatientTimeline: OpenSavedCaseInput["buildKnownPatientTimeline"];
  hydratePatientTimeline: OpenSavedCaseInput["hydratePatientTimeline"];
  cultureSpecies: StartFollowUpDraftInput["cultureSpecies"];
  describeError: StartFollowUpDraftInput["describeError"];
  pick: StartFollowUpDraftInput["pick"];
  setToast: StartFollowUpDraftInput["setToast"];
  setEditingCaseContext: StartFollowUpDraftInput["setEditingCaseContext"];
  replaceDraftImagesAndBoxes:
    StartFollowUpDraftInput["replaceDraftImagesAndBoxes"];
  setDraftLesionPromptBoxes:
    StartFollowUpDraftInput["setDraftLesionPromptBoxes"];
  clearDraftStorage: StartFollowUpDraftInput["clearDraftStorage"];
  resetAnalysisState: StartFollowUpDraftInput["resetAnalysisState"];
  setSelectedCaseImages: StartFollowUpDraftInput["setSelectedCaseImages"];
  setDraft: StartFollowUpDraftInput["setDraft"];
  setPendingOrganism: StartFollowUpDraftInput["setPendingOrganism"];
  setShowAdditionalOrganismForm:
    StartFollowUpDraftInput["setShowAdditionalOrganismForm"];
  visitTimestamp: StartFollowUpDraftInput["visitTimestamp"];
  setEditDraftBusy: StartEditDraftInput["setEditDraftBusy"];
  createDraftId: StartEditDraftInput["createDraftId"];
  setCaseSearch: Dispatch<SetStateAction<string>>;
  setPatientListPage: Dispatch<SetStateAction<number>>;
  defaultPendingOrganism: {
    culture_category: string;
    culture_species: string;
  };
  showOnlyMine: OpenImageTextSearchResultInput["showOnlyMine"];
  selectSiteForCaseMessage:
    OpenImageTextSearchResultInput["selectSiteForCaseMessage"];
};

export function useCaseWorkspaceSavedCaseActions({
  selectedCase,
  selectedSiteId,
  cases,
  token,
  locale,
  desktopFastMode,
  workspaceTimingLogs,
  caseOpenStartedAtRef,
  caseOpenCaseIdRef,
  caseImagesLoggedCaseIdRef,
  caseOpenSlaSessionRef,
  setCases,
  setSelectedCase,
  setSelectedPatientCases,
  setPanelOpen,
  setRailView,
  buildKnownPatientTimeline,
  hydratePatientTimeline,
  cultureSpecies,
  describeError,
  pick,
  setToast,
  setEditingCaseContext,
  replaceDraftImagesAndBoxes,
  setDraftLesionPromptBoxes,
  clearDraftStorage,
  resetAnalysisState,
  setSelectedCaseImages,
  setDraft,
  setPendingOrganism,
  setShowAdditionalOrganismForm,
  visitTimestamp,
  setEditDraftBusy,
  createDraftId,
  setCaseSearch,
  setPatientListPage,
  defaultPendingOrganism,
  showOnlyMine,
  selectSiteForCaseMessage,
}: Args) {
  const openSavedCase = useCallback(
    (
      caseRecord: OpenSavedCaseInput["caseRecord"],
      nextView: "cases" | "patients" = "cases",
    ) => {
      runOpenSavedCase({
        selectedSiteId,
        caseRecord,
        nextView,
        desktopFastMode,
        workspaceTimingLogs,
        caseOpenStartedAtRef,
        caseOpenCaseIdRef,
        caseImagesLoggedCaseIdRef,
        caseOpenSlaSessionRef,
        cases,
        setCases,
        setSelectedCase,
        setSelectedPatientCases,
        setPanelOpen,
        setRailView,
        buildKnownPatientTimeline,
        hydratePatientTimeline,
      });
    },
    [
      selectedSiteId,
      buildKnownPatientTimeline,
      caseImagesLoggedCaseIdRef,
      caseOpenCaseIdRef,
      caseOpenStartedAtRef,
      cases,
      caseOpenSlaSessionRef,
      desktopFastMode,
      setCases,
      setPanelOpen,
      setRailView,
      setSelectedCase,
      setSelectedPatientCases,
      hydratePatientTimeline,
      workspaceTimingLogs,
    ],
  );

  const startFollowUpDraftFromSelectedCase = useCallback(async () => {
    await runStartFollowUpDraftFromSelectedCase({
      selectedCase,
      selectedSiteId,
      token,
      locale,
      cultureSpecies,
      describeError,
      pick,
      setToast,
      setEditingCaseContext,
      replaceDraftImagesAndBoxes,
      setDraftLesionPromptBoxes,
      clearDraftStorage,
      resetAnalysisState,
      setSelectedCase,
      setSelectedCaseImages,
      setPanelOpen,
      setRailView,
      setDraft,
      setPendingOrganism,
      setShowAdditionalOrganismForm,
      visitTimestamp,
    });
  }, [
    clearDraftStorage,
    cultureSpecies,
    describeError,
    locale,
    pick,
    replaceDraftImagesAndBoxes,
    resetAnalysisState,
    selectedCase,
    selectedSiteId,
    setDraft,
    setDraftLesionPromptBoxes,
    setEditingCaseContext,
    setPanelOpen,
    setPendingOrganism,
    setRailView,
    setSelectedCase,
    setSelectedCaseImages,
    setShowAdditionalOrganismForm,
    setToast,
    token,
    visitTimestamp,
  ]);

  const startEditDraftFromSelectedCase = useCallback(async () => {
    await runStartEditDraftFromSelectedCase({
      selectedCase,
      selectedSiteId,
      token,
      locale,
      cultureSpecies,
      describeError,
      pick,
      setToast,
      setEditDraftBusy,
      clearDraftStorage,
      resetAnalysisState,
      setPanelOpen,
      setRailView,
      setEditingCaseContext,
      setSelectedCase,
      setSelectedCaseImages,
      replaceDraftImagesAndBoxes,
      setDraftLesionPromptBoxes,
      setDraft,
      setPendingOrganism,
      setShowAdditionalOrganismForm,
      createDraftId,
    });
  }, [
    clearDraftStorage,
    createDraftId,
    cultureSpecies,
    describeError,
    locale,
    pick,
    replaceDraftImagesAndBoxes,
    resetAnalysisState,
    selectedCase,
    selectedSiteId,
    setDraft,
    setDraftLesionPromptBoxes,
    setEditDraftBusy,
    setEditingCaseContext,
    setPanelOpen,
    setPendingOrganism,
    setRailView,
    setSelectedCase,
    setSelectedCaseImages,
    setShowAdditionalOrganismForm,
    setToast,
    token,
  ]);

  const resetDraft = useCallback(() => {
    setRailView("cases");
    setEditingCaseContext(null);
    replaceDraftImagesAndBoxes([]);
    clearDraftStorage();
    resetAnalysisState();
    setSelectedCase(null);
    setSelectedCaseImages([]);
    setDraftLesionPromptBoxes({});
    setDraft(createDraftState());
    setPendingOrganism(defaultPendingOrganism);
    setShowAdditionalOrganismForm(false);
  }, [
    clearDraftStorage,
    defaultPendingOrganism,
    replaceDraftImagesAndBoxes,
    resetAnalysisState,
    setDraft,
    setDraftLesionPromptBoxes,
    setEditingCaseContext,
    setPendingOrganism,
    setRailView,
    setSelectedCase,
    setSelectedCaseImages,
    setShowAdditionalOrganismForm,
  ]);

  const startNewCaseDraft = useCallback(() => {
    if (!selectedSiteId) {
      setToast({ tone: "error", message: selectSiteForCaseMessage });
      return;
    }
    resetDraft();
    setPanelOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [
    resetDraft,
    selectSiteForCaseMessage,
    selectedSiteId,
    setPanelOpen,
    setToast,
  ]);

  const handleOpenPatientList = useCallback(() => {
    setCaseSearch("");
    setPatientListPage(1);
    setRailView("patients");
  }, [setCaseSearch, setPatientListPage, setRailView]);

  const handleOpenLatestAutosavedDraft = useCallback(() => {
    setSelectedCase(null);
    setSelectedCaseImages([]);
    setPanelOpen(true);
    setRailView("cases");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [
    setPanelOpen,
    setRailView,
    setSelectedCase,
    setSelectedCaseImages,
  ]);

  const handleOpenImageTextSearchResult = useCallback(
    async (
      patientId: string,
      visitDate: string,
    ) => {
      await runHandleOpenImageTextSearchResult({
        patientId,
        visitDate,
        selectedSiteId,
        token,
        showOnlyMine,
      locale,
      cases,
      pick,
      selectSiteForCaseMessage,
      setToast,
      setCases,
      openSavedCase,
      });
    },
    [
    cases,
    locale,
    openSavedCase,
      pick,
      selectSiteForCaseMessage,
      selectedSiteId,
      setCases,
      setToast,
      showOnlyMine,
      token,
    ],
  );

  return {
    openSavedCase,
    startFollowUpDraftFromSelectedCase,
    startEditDraftFromSelectedCase,
    resetDraft,
    startNewCaseDraft,
    handleOpenPatientList,
    handleOpenLatestAutosavedDraft,
    handleOpenImageTextSearchResult,
  };
}
