"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";
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
import type { Locale } from "../../lib/i18n";
import { runAfterDesktopInteractionIdle } from "../../lib/desktop-runtime-prewarm";
import { scheduleDeferredBrowserTask } from "./case-workspace-site-data-helpers";
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

const VALIDATION_ARTIFACT_PREVIEW_MAX_SIDE = 448;

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
  const [validationArtifactsBusy, setValidationArtifactsBusy] =
    useState(false);

  const validationArtifactUrlsRef = useRef<string[]>([]);
  const validationArtifactRequestRef = useRef(0);
  const latestValidationExecutionDeviceRef = useRef<string | undefined>(
    undefined,
  );
  const validationBackgroundRefreshCleanupRef = useRef<() => void>(
    () => undefined,
  );

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
    validationArtifactRequestRef.current += 1;
    revokeUrls(validationArtifactUrlsRef.current);
    validationArtifactUrlsRef.current = [];
    startTransition(() => {
      setValidationArtifactsBusy(false);
      setValidationArtifacts({});
    });
  }, []);
  const cancelPendingValidationBackgroundRefresh = useCallback(() => {
    validationBackgroundRefreshCleanupRef.current();
    validationBackgroundRefreshCleanupRef.current = () => undefined;
  }, []);

  const resetValidationState = useCallback(() => {
    cancelPendingValidationBackgroundRefresh();
    clearValidationArtifacts();
    latestValidationExecutionDeviceRef.current = undefined;
    setValidationBusy(false);
    setValidationResult(null);
    setModelCompareBusy(false);
    setModelCompareResult(null);
  }, [cancelPendingValidationBackgroundRefresh, clearValidationArtifacts]);

  useEffect(() => {
    return () => {
      revokeUrls(validationArtifactUrlsRef.current);
      validationBackgroundRefreshCleanupRef.current();
    };
  }, []);

  const resolveValidationArtifacts = useCallback(async (
    result: CaseValidationResponse,
    patientId: string,
    visitDate: string,
  ): Promise<{
    artifacts: CaseWorkspaceValidationArtifactPreviews;
    urls: string[];
  }> => {
    const nextArtifacts: CaseWorkspaceValidationArtifactPreviews = {};
    const nextUrls: string[] = [];
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
    const availableArtifactKinds = artifactKinds.filter((artifactKind) => {
      return artifactKind === "roi_crop"
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
    });

    const resolvedEntries = await Promise.all(
      availableArtifactKinds.map(async (artifactKind) => {
        try {
          const url = await fetchValidationArtifactUrl(
            selectedSiteId!,
            result.summary.validation_id,
            patientId,
            visitDate,
            artifactKind,
            token,
            { previewMaxSide: VALIDATION_ARTIFACT_PREVIEW_MAX_SIDE },
          );
          return [
            artifactKind,
            appendArtifactVersion(
              url,
              result.summary.validation_id,
              artifactKind,
            ),
            url,
          ] as const;
        } catch {
          return [artifactKind, null, null] as const;
        }
      }),
    );

    for (const [artifactKind, resolvedUrl, revokeUrl] of resolvedEntries) {
      nextArtifacts[artifactKind] = resolvedUrl;
      if (revokeUrl) {
        nextUrls.push(revokeUrl);
      }
    }

    return {
      artifacts: nextArtifacts,
      urls: nextUrls,
    };
  }, [selectedSiteId, token]);

  const hydrateValidationArtifacts = useCallback(
    async (
      result: CaseValidationResponse,
      patientId: string,
      visitDate: string,
      requestId: number,
    ) => {
      try {
        const { artifacts, urls } = await resolveValidationArtifacts(
          result,
          patientId,
          visitDate,
        );
        if (validationArtifactRequestRef.current !== requestId) {
          revokeUrls(urls);
          return;
        }
        validationArtifactUrlsRef.current = urls;
        startTransition(() => {
          setValidationArtifacts(artifacts);
          setValidationArtifactsBusy(false);
        });
      } catch {
        if (validationArtifactRequestRef.current !== requestId) {
          return;
        }
        startTransition(() => {
          setValidationArtifactsBusy(false);
          setValidationArtifacts({});
        });
      }
    },
    [resolveValidationArtifacts],
  );

  const scheduleValidationBackgroundRefresh = useCallback(
    (
      siteId: string,
      patientId: string,
      visitDate: string,
      result: CaseValidationResponse,
      selectedCaseRecord: CaseSummaryRecord,
    ) => {
      const scheduleRefreshTask = (
        task: () => Promise<void> | void,
        delayMs: number,
        warningLabel: string,
      ) => {
        let cancelInteractionAwareRefresh = () => undefined;
        const cancelDeferredRefresh = scheduleDeferredBrowserTask(() => {
          cancelInteractionAwareRefresh = runAfterDesktopInteractionIdle(
            () => {
              void Promise.resolve(task()).catch((nextError) => {
                console.warn(warningLabel, nextError);
              });
            },
            delayMs,
          );
        }, Math.max(120, delayMs - 1400));
        return () => {
          cancelDeferredRefresh();
          cancelInteractionAwareRefresh();
        };
      };
      const cancelSiteRefresh = scheduleRefreshTask(
        () => onSiteDataChanged(siteId),
        1800,
        "Validation site refresh failed",
      );
      const cancelHistoryRefresh = scheduleRefreshTask(
        () => loadCaseHistory(siteId, patientId, visitDate),
        2400,
        "Validation history refresh failed",
      );
      const cancelActivityRefresh = scheduleRefreshTask(
        () => loadSiteActivity(siteId),
        3000,
        "Validation activity refresh failed",
      );
      const cancelCompletionHook = scheduleRefreshTask(
        () =>
          Promise.resolve(
            onValidationCompleted?.({
              siteId,
              selectedCase: selectedCaseRecord,
              result,
            }),
          ),
        3600,
        "Validation completion hook failed",
      );
      return () => {
        cancelSiteRefresh();
        cancelHistoryRefresh();
        cancelActivityRefresh();
        cancelCompletionHook();
      };
    },
    [loadCaseHistory, loadSiteActivity, onSiteDataChanged, onValidationCompleted],
  );

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
    const hasReviewArtifacts = Object.values(
      result.artifact_availability ?? {},
    ).some(Boolean);
    const requestId = validationArtifactRequestRef.current + 1;
    validationArtifactRequestRef.current = requestId;
    latestValidationExecutionDeviceRef.current = result.execution_device;
    startTransition(() => {
      setValidationResult(result);
      setValidationArtifacts({});
      setValidationArtifactsBusy(hasReviewArtifacts);
    });
    if (hasReviewArtifacts) {
      scheduleDeferredBrowserTask(() => {
        void hydrateValidationArtifacts(
          result,
          args.patientId,
          args.visitDate,
          requestId,
        );
      }, 40);
    }
    return result;
  }

  const handleRunValidation = useCallback(async (
    options?: CaseWorkspaceValidationRunOptions,
  ) => {
    if (!selectedSiteId || !selectedCase) {
      setToast({ tone: "error", message: copy.selectSavedCaseForValidation });
      return null;
    }

    const explicitModelVersionId =
      String(options?.modelVersionId || "").trim() || null;
    const normalizedSelectedValidationModelVersionId =
      String(selectedValidationModelVersionId || "").trim() || null;
    const shouldUsePreparedSelectionProfile =
      Boolean(options?.selectionProfile) && !explicitModelVersionId;
    let availableModelVersions = siteModelVersions;
    const needsModelCatalogLoad =
      availableModelVersions.length === 0 &&
      !shouldUsePreparedSelectionProfile &&
      !explicitModelVersionId &&
      !normalizedSelectedValidationModelVersionId;
    if (needsModelCatalogLoad) {
      try {
        availableModelVersions = await ensureSiteModelVersionsLoaded(
          selectedSiteId,
        );
      } catch {
        availableModelVersions = [];
      }
    }
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
    cancelPendingValidationBackgroundRefresh();
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

      onArtifactsChanged?.();
      validationBackgroundRefreshCleanupRef.current =
        scheduleValidationBackgroundRefresh(
        selectedSiteId,
        selectedCase.patient_id,
        selectedCase.visit_date,
        result,
        selectedCase,
        );
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
    cancelPendingValidationBackgroundRefresh,
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
    scheduleValidationBackgroundRefresh,
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
      let availableModelVersions = siteModelVersions;
      const shouldSkipCatalogLoadForPreparedFallback =
        availableModelVersions.length === 0 &&
        requestedModelVersionIds.length === 0 &&
        options?.preferPreparedMil === true;
      if (
        availableModelVersions.length === 0 &&
        !shouldSkipCatalogLoadForPreparedFallback
      ) {
        try {
          availableModelVersions =
            await ensureSiteModelVersionsLoaded(selectedSiteId);
        } catch {
          availableModelVersions = [];
        }
      }
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
            options?.executionDevice ??
              validationResult?.execution_device ??
              latestValidationExecutionDeviceRef.current,
          ),
        });
        startTransition(() => {
          setModelCompareResult(result);
        });
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
    validationArtifactsBusy,
    resetValidationState,
    handleRunValidation,
    handleRunModelCompare,
  };
}
