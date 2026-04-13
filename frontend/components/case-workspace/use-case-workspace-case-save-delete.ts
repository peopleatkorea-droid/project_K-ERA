"use client";

import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";

import {
  type CaseSummaryRecord,
  deleteVisit,
  fetchCases,
} from "../../lib/api";
import { handleSaveCase as runHandleSaveCase } from "./case-workspace-save-flow";
import type { SavedImagePreview } from "./shared";

type ToastState = {
  tone: "success" | "error";
  message: string;
} | null;

type SaveCaseArgs = Parameters<typeof runHandleSaveCase>[0];

type Args = {
  saveCaseArgs: SaveCaseArgs;
  selectedSiteId: string | null;
  token: string;
  showOnlyMine: boolean;
  selectedCase: CaseSummaryRecord | null;
  confirmDeleteSavedCase: (caseRecord: CaseSummaryRecord) => boolean;
  describeError: (error: unknown, fallback: string) => string;
  deleteVisitFailedMessage: string;
  patientDeletedMessage: (patientId: string) => string;
  visitDeletedMessage: (patientId: string, visitDate: string) => string;
  setToast: Dispatch<SetStateAction<ToastState>>;
  setCases: Dispatch<SetStateAction<CaseSummaryRecord[]>>;
  setSelectedCase: Dispatch<SetStateAction<CaseSummaryRecord | null>>;
  setSelectedPatientCases: Dispatch<SetStateAction<CaseSummaryRecord[]>>;
  setSelectedCaseImages: Dispatch<SetStateAction<SavedImagePreview[]>>;
  setPatientVisitGallery: Dispatch<
    SetStateAction<Record<string, SavedImagePreview[]>>
  >;
  setRailView: Dispatch<SetStateAction<"cases" | "patients">>;
  resetAnalysisState: () => void;
  invalidateCaseWorkspaceImageCaches: () => void;
  buildKnownPatientTimeline: (
    caseRecords: CaseSummaryRecord[],
    patientId: string,
    fallbackCase?: CaseSummaryRecord | null,
  ) => CaseSummaryRecord[];
  caseTimestamp: (caseRecord: CaseSummaryRecord) => number;
};

export function useCaseWorkspaceCaseSaveDelete({
  saveCaseArgs,
  selectedSiteId,
  token,
  showOnlyMine,
  selectedCase,
  confirmDeleteSavedCase,
  describeError,
  deleteVisitFailedMessage,
  patientDeletedMessage,
  visitDeletedMessage,
  setToast,
  setCases,
  setSelectedCase,
  setSelectedPatientCases,
  setSelectedCaseImages,
  setPatientVisitGallery,
  setRailView,
  resetAnalysisState,
  invalidateCaseWorkspaceImageCaches,
  buildKnownPatientTimeline,
  caseTimestamp,
}: Args) {
  const handleSaveCase = useCallback(async () => {
    await runHandleSaveCase(saveCaseArgs);
  }, [saveCaseArgs]);

  const handleDeleteSavedCase = useCallback(
    async (caseRecord: CaseSummaryRecord) => {
      if (!selectedSiteId) {
        return;
      }
      if (!confirmDeleteSavedCase(caseRecord)) {
        return;
      }

      try {
        const deleted = await deleteVisit(
          selectedSiteId,
          token,
          caseRecord.patient_id,
          caseRecord.visit_date,
        );
        invalidateCaseWorkspaceImageCaches();
        const nextCases = await fetchCases(selectedSiteId, token, {
          mine: showOnlyMine,
        });
        setCases(nextCases);

        if (deleted.deleted_patient) {
          setSelectedCase(null);
          setSelectedPatientCases([]);
          setSelectedCaseImages([]);
          setPatientVisitGallery({});
          resetAnalysisState();
          setRailView("patients");
          setToast({
            tone: "success",
            message: patientDeletedMessage(caseRecord.patient_id),
          });
          return;
        }

        const preservedCurrentCase =
          selectedCase && selectedCase.case_id !== caseRecord.case_id
            ? (nextCases.find((item) => item.case_id === selectedCase.case_id) ??
              null)
            : null;
        const remainingSamePatientCase =
          nextCases
            .filter((item) => item.patient_id === caseRecord.patient_id)
            .sort((left, right) => caseTimestamp(right) - caseTimestamp(left))[0] ??
          null;
        const nextSelectedCase =
          preservedCurrentCase ??
          remainingSamePatientCase ??
          nextCases[0] ??
          null;
        setSelectedCase(nextSelectedCase);
        setSelectedPatientCases(
          nextSelectedCase
            ? buildKnownPatientTimeline(
                nextCases,
                nextSelectedCase.patient_id,
                nextSelectedCase,
              )
            : [],
        );
        setToast({
          tone: "success",
          message: visitDeletedMessage(
            caseRecord.patient_id,
            caseRecord.visit_date,
          ),
        });
      } catch (nextError) {
        setToast({
          tone: "error",
          message: describeError(nextError, deleteVisitFailedMessage),
        });
      }
    },
    [
      buildKnownPatientTimeline,
      caseTimestamp,
      confirmDeleteSavedCase,
      deleteVisitFailedMessage,
      describeError,
      invalidateCaseWorkspaceImageCaches,
      patientDeletedMessage,
      resetAnalysisState,
      selectedCase,
      selectedSiteId,
      setCases,
      setPatientVisitGallery,
      setRailView,
      setSelectedCase,
      setSelectedCaseImages,
      setSelectedPatientCases,
      setToast,
      showOnlyMine,
      token,
      visitDeletedMessage,
    ],
  );

  return {
    handleSaveCase,
    handleDeleteSavedCase,
  };
}
