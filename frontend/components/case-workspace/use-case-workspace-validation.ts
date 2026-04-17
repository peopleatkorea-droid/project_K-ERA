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
  type ModelVersionRecord,
} from "../../lib/api";
import { convertDesktopFilePath, hasDesktopRuntime } from "../../lib/desktop-ipc";
import type { Locale } from "../../lib/i18n";
import type {
  CaseWorkspaceExecutionMode,
  CaseWorkspaceToastState,
  CaseWorkspaceValidationArtifactKind,
  CaseWorkspaceValidationArtifactPreviews,
} from "./case-workspace-definitions";
import { preferredVisitLevelMilModelVersion } from "./case-workspace-core-helpers";
import type {
  CaseWorkspaceModelCompareRunOptions,
  CaseWorkspaceValidationRunOptions,
  LocalePick,
} from "./shared";

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
  siteModelVersions: ModelVersionRecord[];
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
  ensureSiteModelVersionsLoaded: (
    siteId: string,
    signal?: AbortSignal,
  ) => Promise<ModelVersionRecord[]>;
  defaultValidationModelVersionSelection: (
    modelVersions: ModelVersionRecord[],
  ) => string | null;
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

function appendArtifactVersion(
  url: string | null,
  validationId: string,
  artifactKind: CaseWorkspaceValidationArtifactKind,
) {
  if (!url || url.startsWith("blob:")) {
    return url;
  }
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}kera_v=${encodeURIComponent(`${validationId}:${artifactKind}`)}`;
}

export function useCaseWorkspaceValidation({
  locale,
  token,
  selectedSiteId,
  selectedCase,
  siteModelVersions,
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
  ensureSiteModelVersionsLoaded,
  defaultValidationModelVersionSelection,
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
    const prediction = result.case_prediction;
    const artifactPathForKind = (
      artifactKind: CaseWorkspaceValidationArtifactKind,
    ) => {
      if (!prediction) {
        return null;
      }
      switch (artifactKind) {
        case "gradcam":
          return prediction.gradcam_path ?? null;
        case "gradcam_cornea":
          return prediction.gradcam_cornea_path ?? null;
        case "gradcam_lesion":
          return prediction.gradcam_lesion_path ?? null;
        case "roi_crop":
          return prediction.roi_crop_path ?? null;
        case "medsam_mask":
          return prediction.medsam_mask_path ?? null;
        case "lesion_crop":
          return prediction.lesion_crop_path ?? null;
        case "lesion_mask":
          return prediction.lesion_mask_path ?? null;
      }
    };

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
        const desktopArtifactPath =
          hasDesktopRuntime() ? artifactPathForKind(artifactKind) : null;
        if (desktopArtifactPath) {
          const desktopUrl = await convertDesktopFilePath(desktopArtifactPath);
          if (desktopUrl) {
            nextArtifacts[artifactKind] = appendArtifactVersion(
              desktopUrl,
              result.summary.validation_id,
              artifactKind,
            );
            continue;
          }
        }
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
        nextArtifacts[artifactKind] = appendArtifactVersion(
          url,
          result.summary.validation_id,
          artifactKind,
        );
      } catch {
        nextArtifacts[artifactKind] = null;
      }
    }

    return nextArtifacts;
  }

  async function runAnchorValidation(args: {
    patientId: string;
    visitDate: string;
    modelVersionId?: string | null;
    selectionProfile?: "single_case_review" | "visit_level_review";
    executionMode?: "auto" | "cpu" | "gpu";
  }) {
    const result = await runCaseValidation(selectedSiteId!, token, {
      patient_id: args.patientId,
      visit_date: args.visitDate,
      execution_mode: args.executionMode,
      model_version_id: args.modelVersionId
        ? String(args.modelVersionId).trim()
        : undefined,
      selection_profile: args.selectionProfile,
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

  const handleRunValidation = useCallback(async (
    options?: CaseWorkspaceValidationRunOptions,
  ) => {
    if (!selectedSiteId || !selectedCase) {
      setToast({ tone: "error", message: copy.selectSavedCaseForValidation });
      return null;
    }

    let availableModelVersions = siteModelVersions;
    if (availableModelVersions.length === 0) {
      try {
        availableModelVersions = await ensureSiteModelVersionsLoaded(
          selectedSiteId,
        );
      } catch {
        availableModelVersions = [];
      }
    }
    const explicitModelVersionId =
      String(options?.modelVersionId || "").trim() || null;
    const normalizedSelectedValidationModelVersionId =
      String(selectedValidationModelVersionId || "").trim() || null;
    const shouldUsePreparedSelectionProfile =
      Boolean(options?.selectionProfile) && !explicitModelVersionId;
    const requestedValidationModelVersionId = options?.ignoreSelectedModel
      ? explicitModelVersionId
      : explicitModelVersionId ||
        normalizedSelectedValidationModelVersionId ||
        (shouldUsePreparedSelectionProfile
          ? null
          : defaultValidationModelVersionSelection(availableModelVersions)) ||
        null;
    const previousExecutionMode = executionModeFromDevice(
      validationResult?.execution_device,
    );

    setValidationBusy(true);
    clearValidationArtifacts();
    setValidationResult(null);
    setModelCompareResult(null);
    setContributionResult(null);
    setPanelOpen(true);
    try {
      const effectiveValidationModelVersionId = requestedValidationModelVersionId;
      const result = await runAnchorValidation({
        patientId: selectedCase.patient_id,
        visitDate: selectedCase.visit_date,
        modelVersionId: effectiveValidationModelVersionId,
        selectionProfile:
          options?.selectionProfile ??
          (effectiveValidationModelVersionId ? undefined : "single_case_review"),
        executionMode: previousExecutionMode,
      });

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
        message: copy.validationSaved(
          selectedCase.patient_id,
          selectedCase.visit_date,
        ),
      });
      return result;
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, copy.validationFailed),
      });
      return null;
    } finally {
      setValidationBusy(false);
      setModelCompareBusy(false);
    }
  }, [
    clearValidationArtifacts,
    copy,
    defaultValidationModelVersionSelection,
    describeError,
    ensureSiteModelVersionsLoaded,
    executionModeFromDevice,
    loadCaseHistory,
    loadSiteActivity,
    locale,
    onArtifactsChanged,
    onSiteDataChanged,
    onValidationCompleted,
    pick,
    selectedCase,
    selectedSiteId,
    setContributionResult,
    setPanelOpen,
    setToast,
    siteModelVersions,
    token,
    selectedValidationModelVersionId,
    validationResult?.execution_device,
  ]);

  const handleRunModelCompare = useCallback(
    async (options?: CaseWorkspaceModelCompareRunOptions) => {
      if (!selectedSiteId || !selectedCase) {
        setToast({ tone: "error", message: copy.selectSavedCaseForValidation });
        return null;
      }
      let availableModelVersions = siteModelVersions;
      if (availableModelVersions.length === 0) {
        try {
          availableModelVersions =
            await ensureSiteModelVersionsLoaded(selectedSiteId);
        } catch {
          availableModelVersions = [];
        }
      }
      const requestedModelVersionIds = Array.from(
        new Set(
          (
            options?.modelVersionIds ??
            normalizeSelectedCompareModelVersionIds()
          )
            .map((item) => String(item).trim())
            .filter((item) => item.length > 0),
        ),
      ).slice(0, maxCompareSelections);
      const preparedMilVersionId =
        options?.preferPreparedMil === true
          ? preferredVisitLevelMilModelVersion(availableModelVersions)
              ?.version_id ?? null
          : null;
      const effectiveModelVersionIds =
        requestedModelVersionIds.length > 0
          ? requestedModelVersionIds
          : preparedMilVersionId
            ? [preparedMilVersionId]
            : [];
      const selectionProfile =
        effectiveModelVersionIds.length === 0 &&
        options?.preferPreparedMil === true
          ? "visit_level_review"
          : undefined;
      if (effectiveModelVersionIds.length === 0 && !selectionProfile) {
        setToast({
          tone: "error",
          message: pick(
            locale,
            "Select at least one model version for comparison.",
            "비교할 모델 버전을 하나 이상 선택해 주세요.",
          ),
        });
        return null;
      }

      setModelCompareBusy(true);
      setModelCompareResult(null);
      setPanelOpen(true);
      try {
        const result = await runCaseValidationCompare(selectedSiteId, token, {
          patient_id: selectedCase.patient_id,
          visit_date: selectedCase.visit_date,
          model_version_ids:
            effectiveModelVersionIds.length > 0
              ? effectiveModelVersionIds
              : undefined,
          selection_profile: selectionProfile,
          execution_mode: executionModeFromDevice(
            options?.executionDevice ?? validationResult?.execution_device,
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
        return result;
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
        return null;
      } finally {
        setModelCompareBusy(false);
      }
    },
    [
      copy.selectSavedCaseForValidation,
      describeError,
      ensureSiteModelVersionsLoaded,
      executionModeFromDevice,
      locale,
      normalizeSelectedCompareModelVersionIds,
      pick,
      selectedCase,
      selectedSiteId,
      setPanelOpen,
      setToast,
      siteModelVersions,
      token,
      validationResult?.execution_device,
    ],
  );

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
