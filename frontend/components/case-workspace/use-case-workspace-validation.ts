"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import {
  fetchValidationArtifactUrl,
  runCaseValidation,
  runCaseValidationCompare,
  type CaseContributionResponse,
  type CaseSummaryRecord,
  type CaseValidationCompareResponse,
  type CaseValidationResponse,
} from "../../lib/api";
import type { Locale } from "../../lib/i18n";
import type {
  CaseWorkspaceExecutionMode,
  CaseWorkspaceToastState,
  CaseWorkspaceValidationArtifactKind,
  CaseWorkspaceValidationArtifactPreviews,
} from "./case-workspace-definitions";
import type { LocalePick } from "./shared";

type ModelCompareItem = CaseValidationCompareResponse["comparisons"][number];
type SuccessfulModelCompareItem = ModelCompareItem & {
  summary: NonNullable<ModelCompareItem["summary"]>;
  model_version: NonNullable<ModelCompareItem["model_version"]>;
};

type ValidationCopy = {
  selectSavedCaseForValidation: string;
  validationSaved: (patientId: string, visitDate: string) => string;
  validationFailed: string;
};

type Args = {
  locale: Locale;
  token: string;
  selectedSiteId: string | null;
  selectedCase: CaseSummaryRecord | null;
  selectedCompareModelVersionIds: string[];
  selectedValidationModelVersionId: string | null;
  pick: LocalePick;
  copy: ValidationCopy;
  executionModeFromDevice: (
    device: string | undefined,
  ) => CaseWorkspaceExecutionMode;
  describeError: (error: unknown, fallback: string) => string;
  setToast: Dispatch<SetStateAction<CaseWorkspaceToastState>>;
  setPanelOpen: Dispatch<SetStateAction<boolean>>;
  setContributionResult: Dispatch<
    SetStateAction<CaseContributionResponse | null>
  >;
  loadCaseHistory: (
    siteId: string,
    patientId: string,
    visitDate: string,
  ) => Promise<void>;
  loadSiteActivity: (siteId: string) => Promise<unknown>;
  onSiteDataChanged: (siteId: string) => Promise<void>;
  onValidationCompleted?: (args: {
    siteId: string;
    selectedCase: CaseSummaryRecord;
    result: CaseValidationResponse;
  }) => Promise<void> | void;
  onArtifactsChanged?: () => void;
};

function revokeUrls(urls: string[]) {
  for (const url of urls) {
    if (String(url).startsWith("blob:")) {
      URL.revokeObjectURL(url);
    }
  }
}

export function useCaseWorkspaceValidation({
  locale,
  token,
  selectedSiteId,
  selectedCase,
  selectedCompareModelVersionIds,
  selectedValidationModelVersionId,
  pick,
  copy,
  executionModeFromDevice,
  describeError,
  setToast,
  setPanelOpen,
  setContributionResult,
  loadCaseHistory,
  loadSiteActivity,
  onSiteDataChanged,
  onValidationCompleted,
  onArtifactsChanged,
}: Args) {
  const maxCompareSelections = 8;
  const [validationBusy, setValidationBusy] = useState(false);
  const [validationResult, setValidationResult] =
    useState<CaseValidationResponse | null>(null);
  const [modelCompareBusy, setModelCompareBusy] = useState(false);
  const [modelCompareResult, setModelCompareResult] =
    useState<CaseValidationCompareResponse | null>(null);
  const [validationArtifacts, setValidationArtifacts] =
    useState<CaseWorkspaceValidationArtifactPreviews>({});

  const validationArtifactUrlsRef = useRef<string[]>([]);

  const normalizeSelectedCompareModelVersionIds = useCallback(() => {
    return Array.from(
      new Set(
        selectedCompareModelVersionIds
          .map((item) => String(item).trim())
          .filter((item) => item.length > 0),
      ),
    ).slice(0, maxCompareSelections);
  }, [selectedCompareModelVersionIds]);

  const clearValidationArtifacts = useCallback(() => {
    revokeUrls(validationArtifactUrlsRef.current);
    validationArtifactUrlsRef.current = [];
    setValidationArtifacts({});
  }, []);

  const resetValidationState = useCallback(() => {
    clearValidationArtifacts();
    setValidationBusy(false);
    setValidationResult(null);
    setModelCompareBusy(false);
    setModelCompareResult(null);
  }, [clearValidationArtifacts]);

  useEffect(() => {
    return () => revokeUrls(validationArtifactUrlsRef.current);
  }, []);

  async function resolveValidationArtifacts(
    result: CaseValidationResponse,
    patientId: string,
    visitDate: string,
  ): Promise<CaseWorkspaceValidationArtifactPreviews> {
    const nextArtifacts: CaseWorkspaceValidationArtifactPreviews = {};
    const hasBranchAwareGradcam =
      result.artifact_availability.gradcam_cornea ||
      result.artifact_availability.gradcam_lesion;
    const artifactKinds: CaseWorkspaceValidationArtifactKind[] = [
      "roi_crop",
      ...(hasBranchAwareGradcam ? [] : ["gradcam" as const]),
      "gradcam_cornea",
      "gradcam_lesion",
      "medsam_mask",
      "lesion_crop",
      "lesion_mask",
    ];

    for (const artifactKind of artifactKinds) {
      const isAvailable =
        artifactKind === "roi_crop"
          ? result.artifact_availability.roi_crop
          : artifactKind === "gradcam"
            ? result.artifact_availability.gradcam
            : artifactKind === "gradcam_cornea"
              ? result.artifact_availability.gradcam_cornea
              : artifactKind === "gradcam_lesion"
                ? result.artifact_availability.gradcam_lesion
                : artifactKind === "medsam_mask"
                  ? result.artifact_availability.medsam_mask
                  : artifactKind === "lesion_crop"
                    ? result.artifact_availability.lesion_crop
                    : result.artifact_availability.lesion_mask;
      if (!isAvailable) {
        continue;
      }
      try {
        const url = await fetchValidationArtifactUrl(
          selectedSiteId!,
          result.summary.validation_id,
          patientId,
          visitDate,
          artifactKind,
          token,
        );
        if (url) {
          validationArtifactUrlsRef.current.push(url);
        }
        nextArtifacts[artifactKind] = url;
      } catch {
        nextArtifacts[artifactKind] = null;
      }
    }

    return nextArtifacts;
  }

  function resolveAnchorModelVersionId(
    compareResult: CaseValidationCompareResponse,
    requestedModelVersionIds: string[],
    fallbackModelVersionId?: string | null,
  ): string | null {
    const successfulComparisons = compareResult.comparisons.filter(
      (item): item is SuccessfulModelCompareItem =>
        Boolean(item.summary && !item.error && item.model_version?.version_id),
    );
    for (const requestedId of requestedModelVersionIds) {
      const match = successfulComparisons.find(
        (item) =>
          String(item.model_version.version_id || "").trim() === requestedId,
      );
      if (match?.model_version.version_id) {
        return String(match.model_version.version_id).trim();
      }
    }
    const normalizedFallback = String(fallbackModelVersionId || "").trim();
    if (normalizedFallback) {
      const match = successfulComparisons.find(
        (item) =>
          String(item.model_version.version_id || "").trim() ===
          normalizedFallback,
      );
      if (match?.model_version.version_id) {
        return String(match.model_version.version_id).trim();
      }
    }
    return successfulComparisons[0]?.model_version?.version_id
      ? String(successfulComparisons[0].model_version.version_id).trim()
      : null;
  }

  async function runAnchorValidation(args: {
    patientId: string;
    visitDate: string;
    modelVersionId?: string | null;
    executionMode?: "auto" | "cpu" | "gpu";
  }) {
    const result = await runCaseValidation(selectedSiteId!, token, {
      patient_id: args.patientId,
      visit_date: args.visitDate,
      execution_mode: args.executionMode,
      model_version_id: args.modelVersionId
        ? String(args.modelVersionId).trim()
        : undefined,
    });
    const nextArtifacts = await resolveValidationArtifacts(
      result,
      args.patientId,
      args.visitDate,
    );
    setValidationArtifacts(nextArtifacts);
    setValidationResult(result);
    return result;
  }

  const handleRunValidation = useCallback(async () => {
    if (!selectedSiteId || !selectedCase) {
      setToast({ tone: "error", message: copy.selectSavedCaseForValidation });
      return;
    }

    const requestedModelVersionIds = normalizeSelectedCompareModelVersionIds();
    const requestedValidationModelVersionId =
      String(selectedValidationModelVersionId || "").trim() || null;
    const previousValidationModelVersionId =
      String(validationResult?.model_version.version_id || "").trim() || null;
    const previousExecutionMode = executionModeFromDevice(
      validationResult?.execution_device,
    );

    setValidationBusy(true);
    setModelCompareBusy(requestedModelVersionIds.length > 0);
    clearValidationArtifacts();
    setValidationResult(null);
    setModelCompareResult(null);
    setContributionResult(null);
    setPanelOpen(true);
    try {
      let result: CaseValidationResponse;
      let autoCompareCount = 0;

      if (requestedModelVersionIds.length > 0) {
        const compareResult = await runCaseValidationCompare(
          selectedSiteId,
          token,
          {
            patient_id: selectedCase.patient_id,
            visit_date: selectedCase.visit_date,
            model_version_ids: requestedModelVersionIds,
            execution_mode: previousExecutionMode,
          },
        );
        setModelCompareResult(compareResult);
        autoCompareCount = compareResult.comparisons.length;

        const anchorModelVersionId = resolveAnchorModelVersionId(
          compareResult,
          requestedModelVersionIds,
          previousValidationModelVersionId,
        );
        const effectiveValidationModelVersionId =
          requestedValidationModelVersionId ?? anchorModelVersionId;
        if (!effectiveValidationModelVersionId) {
          throw new Error(
            pick(
              locale,
              "No selected model completed successfully for anchor validation.",
              "anchor validation을 진행할 수 있는 모델이 없습니다.",
            ),
          );
        }

        result = await runAnchorValidation({
          patientId: selectedCase.patient_id,
          visitDate: selectedCase.visit_date,
          modelVersionId: effectiveValidationModelVersionId,
          executionMode: executionModeFromDevice(
            compareResult.execution_device,
          ),
        });
      } else {
        result = await runAnchorValidation({
          patientId: selectedCase.patient_id,
          visitDate: selectedCase.visit_date,
          modelVersionId:
            requestedValidationModelVersionId ?? previousValidationModelVersionId,
          executionMode: previousExecutionMode,
        });
      }

      await onSiteDataChanged(selectedSiteId);
      await loadCaseHistory(
        selectedSiteId,
        selectedCase.patient_id,
        selectedCase.visit_date,
      );
      await loadSiteActivity(selectedSiteId);
      await onValidationCompleted?.({
        siteId: selectedSiteId,
        selectedCase,
        result,
      });
      onArtifactsChanged?.();
      setToast({
        tone: "success",
        message:
          autoCompareCount > 0
            ? pick(
                locale,
                `${copy.validationSaved(selectedCase.patient_id, selectedCase.visit_date)} ${autoCompareCount}-model analysis refreshed.`,
                `${copy.validationSaved(selectedCase.patient_id, selectedCase.visit_date)} ${autoCompareCount}개 모델 분석 결과를 갱신했습니다.`,
              )
            : copy.validationSaved(
                selectedCase.patient_id,
                selectedCase.visit_date,
              ),
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, copy.validationFailed),
      });
    } finally {
      setValidationBusy(false);
      setModelCompareBusy(false);
    }
  }, [
    clearValidationArtifacts,
    copy,
    describeError,
    executionModeFromDevice,
    loadCaseHistory,
    loadSiteActivity,
    locale,
    normalizeSelectedCompareModelVersionIds,
    onArtifactsChanged,
    onSiteDataChanged,
    onValidationCompleted,
    pick,
    selectedCase,
    selectedSiteId,
    setContributionResult,
    setPanelOpen,
    setToast,
    token,
    selectedValidationModelVersionId,
    validationResult?.execution_device,
    validationResult?.model_version.version_id,
  ]);

  const handleRunModelCompare = useCallback(async () => {
    if (!selectedSiteId || !selectedCase) {
      setToast({ tone: "error", message: copy.selectSavedCaseForValidation });
      return;
    }
    const requestedModelVersionIds = normalizeSelectedCompareModelVersionIds();
    if (requestedModelVersionIds.length === 0) {
      setToast({
        tone: "error",
        message: pick(
          locale,
          "Select at least one model version for comparison.",
          "비교할 모델 버전을 하나 이상 선택해 주세요.",
        ),
      });
      return;
    }

    setModelCompareBusy(true);
    setModelCompareResult(null);
    setPanelOpen(true);
    try {
      const result = await runCaseValidationCompare(selectedSiteId, token, {
        patient_id: selectedCase.patient_id,
        visit_date: selectedCase.visit_date,
        model_version_ids: requestedModelVersionIds,
        execution_mode: executionModeFromDevice(
          validationResult?.execution_device,
        ),
      });
      setModelCompareResult(result);
      setToast({
        tone: "success",
        message: pick(
          locale,
          `Compared ${result.comparisons.length} model(s).`,
          `${result.comparisons.length}개 모델을 비교했습니다.`,
        ),
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(
          nextError,
          pick(
            locale,
            "Unable to compare models for this case.",
            "이 케이스에서 모델 비교를 실행할 수 없습니다.",
          ),
        ),
      });
    } finally {
      setModelCompareBusy(false);
    }
  }, [
    copy.selectSavedCaseForValidation,
    describeError,
    executionModeFromDevice,
    locale,
    normalizeSelectedCompareModelVersionIds,
    pick,
    selectedCase,
    selectedSiteId,
    setPanelOpen,
    setToast,
    token,
    validationResult?.execution_device,
  ]);

  return {
    validationBusy,
    validationResult,
    modelCompareBusy,
    modelCompareResult,
    validationArtifacts,
    resetValidationState,
    handleRunValidation,
    handleRunModelCompare,
  };
}
