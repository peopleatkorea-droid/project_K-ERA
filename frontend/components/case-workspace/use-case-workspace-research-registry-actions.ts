"use client";

import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";

import {
  type CaseSummaryRecord,
  updateCaseResearchRegistry,
} from "../../lib/api";

type ToastState = {
  tone: "success" | "error";
  message: string;
} | null;

type Args = {
  selectedSiteId: string | null;
  token: string;
  onSiteDataChanged: (siteId: string) => Promise<void>;
  setToast: Dispatch<SetStateAction<ToastState>>;
  setCases: Dispatch<SetStateAction<CaseSummaryRecord[]>>;
  setSelectedCase: Dispatch<SetStateAction<CaseSummaryRecord | null>>;
  setSelectedPatientCases: Dispatch<SetStateAction<CaseSummaryRecord[]>>;
};

export function useCaseWorkspaceResearchRegistryActions({
  selectedSiteId,
  token,
  onSiteDataChanged,
  setToast,
  setCases,
  setSelectedCase,
  setSelectedPatientCases,
}: Args) {
  const applyResearchRegistryStatusToLocalCase = useCallback(
    (
      patientId: string,
      visitDate: string,
      updates: {
        research_registry_status:
          | "analysis_only"
          | "candidate"
          | "included"
          | "excluded";
        research_registry_updated_at?: string | null;
        research_registry_updated_by?: string | null;
        research_registry_source?: string | null;
      },
    ) => {
      setCases((current) =>
        current.map((item) =>
          item.patient_id === patientId && item.visit_date === visitDate
            ? { ...item, ...updates }
            : item,
        ),
      );
      setSelectedCase((current) =>
        current &&
        current.patient_id === patientId &&
        current.visit_date === visitDate
          ? { ...current, ...updates }
          : current,
      );
      setSelectedPatientCases((current) =>
        current.map((item) =>
          item.patient_id === patientId && item.visit_date === visitDate
            ? { ...item, ...updates }
            : item,
        ),
      );
    },
    [setCases, setSelectedCase, setSelectedPatientCases],
  );

  const includeCaseInResearchRegistry = useCallback(
    async (
      patientId: string,
      visitDate: string,
      source: string,
      successMessage?: string,
    ) => {
      if (!selectedSiteId) {
        return;
      }
      const result = await updateCaseResearchRegistry(selectedSiteId, token, {
        patient_id: patientId,
        visit_date: visitDate,
        action: "include",
        source,
      });
      applyResearchRegistryStatusToLocalCase(patientId, visitDate, result);
      await onSiteDataChanged(selectedSiteId);
      if (successMessage) {
        setToast({ tone: "success", message: successMessage });
      }
    },
    [
      applyResearchRegistryStatusToLocalCase,
      onSiteDataChanged,
      selectedSiteId,
      setToast,
      token,
    ],
  );

  const excludeCaseFromResearchRegistry = useCallback(
    async (
      patientId: string,
      visitDate: string,
      source: string,
      successMessage?: string,
    ) => {
      if (!selectedSiteId) {
        return;
      }
      const result = await updateCaseResearchRegistry(selectedSiteId, token, {
        patient_id: patientId,
        visit_date: visitDate,
        action: "exclude",
        source,
      });
      applyResearchRegistryStatusToLocalCase(patientId, visitDate, result);
      await onSiteDataChanged(selectedSiteId);
      if (successMessage) {
        setToast({ tone: "success", message: successMessage });
      }
    },
    [
      applyResearchRegistryStatusToLocalCase,
      onSiteDataChanged,
      selectedSiteId,
      setToast,
      token,
    ],
  );

  return {
    includeCaseInResearchRegistry,
    excludeCaseFromResearchRegistry,
  };
}
