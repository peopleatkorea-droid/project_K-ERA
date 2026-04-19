"use client";

import { useCallback, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import {
  enrollResearchRegistry,
  runCaseContribution,
  runSiteValidation,
  type CaseContributionResponse,
  type CaseSummaryRecord,
  type CaseValidationResponse,
} from "../../lib/api";
import type { Locale } from "../../lib/i18n";
import { runAfterDesktopInteractionIdle } from "../../lib/desktop-runtime-prewarm";
import { waitForSiteJobSettlement } from "../../lib/site-job-runtime";
import { scheduleDeferredBrowserTask } from "./case-workspace-site-data-helpers";
import type {
  CaseWorkspaceCompletionState,
  CaseWorkspaceExecutionMode,
  CaseWorkspaceToastState,
} from "./case-workspace-definitions";

type Args = {
  locale: Locale;
  token: string;
  selectedSiteId: string | null;
  selectedCase: CaseSummaryRecord | null;
  researchRegistryJoinReady: boolean;
  pendingResearchRegistryAutoInclude: boolean;
  selectedCompareModelVersionIds: string[];
  validationResult: CaseValidationResponse | null;
  executionModeFromDevice: (
    device: string | undefined,
  ) => CaseWorkspaceExecutionMode;
  pick: (locale: Locale, en: string, ko: string) => string;
  describeError: (error: unknown, fallback: string) => string;
  setToast: Dispatch<SetStateAction<CaseWorkspaceToastState>>;
  setPanelOpen: Dispatch<SetStateAction<boolean>>;
  setSiteValidationBusy: Dispatch<SetStateAction<boolean>>;
  setCompletionState: Dispatch<
    SetStateAction<CaseWorkspaceCompletionState | null>
  >;
  setContributionResult: Dispatch<
    SetStateAction<CaseContributionResponse | null>
  >;
  setPendingResearchRegistryAutoInclude: Dispatch<SetStateAction<boolean>>;
  setResearchRegistryModalOpen: Dispatch<SetStateAction<boolean>>;
  setResearchRegistryExplanationConfirmed: Dispatch<SetStateAction<boolean>>;
  setResearchRegistryUsageConsented: Dispatch<SetStateAction<boolean>>;
  onSiteDataChanged: (siteId: string) => Promise<void>;
  loadSiteActivity: (siteId: string) => Promise<unknown>;
  loadSiteValidationRuns: (
    siteId: string,
    signal?: AbortSignal,
  ) => Promise<unknown>;
  loadCaseHistory: (
    siteId: string,
    patientId: string,
    visitDate: string,
    options?: { forceRefresh?: boolean },
  ) => Promise<void>;
  includeCaseInResearchRegistry: (
    patientId: string,
    visitDate: string,
    source: string,
    successMessage?: string,
  ) => Promise<void>;
  excludeCaseFromResearchRegistry: (
    patientId: string,
    visitDate: string,
    source: string,
    successMessage?: string,
  ) => Promise<void>;
  messages: {
    selectSiteForValidation: string;
    siteValidationFailed: string;
    siteValidationSaved: (validationId: string) => string;
    selectSavedCaseForContribution: string;
    activeOnly: string;
    contributionQueued: (patientId: string, visitDate: string) => string;
    contributionFailed: string;
    joinResearchRegistrySuccess: string;
    joinResearchRegistryFailed: string;
    includeResearchSuccess: string;
    includeResearchFailed: string;
    excludeResearchSuccess: string;
    excludeResearchFailed: string;
  };
};

export function useCaseWorkspaceReviewActions({
  locale,
  token,
  selectedSiteId,
  selectedCase,
  researchRegistryJoinReady,
  pendingResearchRegistryAutoInclude,
  selectedCompareModelVersionIds,
  validationResult,
  executionModeFromDevice,
  pick,
  describeError,
  setToast,
  setPanelOpen,
  setSiteValidationBusy,
  setCompletionState,
  setContributionResult,
  setPendingResearchRegistryAutoInclude,
  setResearchRegistryModalOpen,
  setResearchRegistryExplanationConfirmed,
  setResearchRegistryUsageConsented,
  onSiteDataChanged,
  loadSiteActivity,
  loadSiteValidationRuns,
  loadCaseHistory,
  includeCaseInResearchRegistry,
  excludeCaseFromResearchRegistry,
  messages,
}: Args) {
  const [contributionBusy, setContributionBusy] = useState(false);
  const [researchRegistryBusy, setResearchRegistryBusy] = useState(false);

  const scheduleSiteRefresh = useCallback(
    (
      siteId: string,
      task: () => Promise<void> | Promise<unknown>,
      label: string,
      delayMs = 120,
    ) => {
      let cancelInteractionAwareRefresh = () => undefined;
      const cancelDeferredRefresh = scheduleDeferredBrowserTask(() => {
        cancelInteractionAwareRefresh = runAfterDesktopInteractionIdle(
          () => {
            void Promise.resolve(task()).catch((nextError) => {
              console.warn(label, { siteId, error: nextError });
            });
          },
          1800,
        );
      }, delayMs);
      return () => {
        cancelDeferredRefresh();
        cancelInteractionAwareRefresh();
      };
    },
    [],
  );

  const handleRunSiteValidation = useCallback(async () => {
    if (!selectedSiteId) {
      setToast({ tone: "error", message: messages.selectSiteForValidation });
      return;
    }

    setSiteValidationBusy(true);
    try {
      const started = await runSiteValidation(selectedSiteId, token);
      const latestJob = await waitForSiteJobSettlement({
        siteId: selectedSiteId,
        token,
        initialJob: started.job,
        isActive(status) {
          return ["queued", "running"].includes(
            String(status || "")
              .trim()
              .toLowerCase(),
          );
        },
      });
      if (latestJob.status === "failed") {
        throw new Error(latestJob.result?.error || messages.siteValidationFailed);
      }
      const result = latestJob.result?.response;
      if (!result || !("summary" in result)) {
        throw new Error(messages.siteValidationFailed);
      }
      scheduleSiteRefresh(
        selectedSiteId,
        async () => {
          await onSiteDataChanged(selectedSiteId);
          await loadSiteActivity(selectedSiteId);
          await loadSiteValidationRuns(selectedSiteId);
        },
        "Site validation background refresh failed",
      );
      setToast({
        tone: "success",
        message: messages.siteValidationSaved(result.summary.validation_id),
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, messages.siteValidationFailed),
      });
    } finally {
      setSiteValidationBusy(false);
    }
  }, [
    describeError,
    loadSiteActivity,
    loadSiteValidationRuns,
    messages.selectSiteForValidation,
    messages.siteValidationFailed,
    messages.siteValidationSaved,
    onSiteDataChanged,
    scheduleSiteRefresh,
    selectedSiteId,
    setSiteValidationBusy,
    setToast,
    token,
  ]);

  const handleContributeCase = useCallback(async () => {
    if (!selectedSiteId || !selectedCase) {
      setToast({
        tone: "error",
        message: messages.selectSavedCaseForContribution,
      });
      return;
    }
    if (selectedCase.visit_status !== "active") {
      setToast({
        tone: "error",
        message: messages.activeOnly,
      });
      return;
    }

    setContributionBusy(true);
    setPanelOpen(true);
    try {
      const requestedContributionModelIds =
        selectedCompareModelVersionIds.length > 0
          ? selectedCompareModelVersionIds
          : undefined;
      const contributionModelVersionId =
        requestedContributionModelIds &&
        requestedContributionModelIds.length > 0
          ? undefined
          : validationResult?.model_version.ensemble_mode === "weighted_average"
            ? undefined
            : validationResult?.model_version.version_id;
      const result = await runCaseContribution(selectedSiteId, token, {
        patient_id: selectedCase.patient_id,
        visit_date: selectedCase.visit_date,
        execution_mode: executionModeFromDevice(
          validationResult?.execution_device,
        ),
        model_version_id: contributionModelVersionId,
        model_version_ids: requestedContributionModelIds,
      });
      setContributionResult(result);
      setCompletionState({
        kind: "contributed",
        patient_id: selectedCase.patient_id,
        visit_date: selectedCase.visit_date,
        timestamp: new Date().toISOString(),
        stats: {
          user_contributions: result.stats.user_contributions,
          total_contributions: result.stats.total_contributions,
          user_contribution_pct: result.stats.user_contribution_pct,
        },
        update_id: result.update.update_id,
        update_count: result.update_count,
      });
      setToast({
        tone: "success",
        message:
          result.failures && result.failures.length > 0
            ? pick(
                locale,
                `${result.update_count} updates were queued, with ${result.failures.length} model(s) failing.`,
                `${result.update_count}개 업데이트를 올렸고, ${result.failures.length}개 모델은 실패했습니다.`,
              )
            : result.update_count > 1
              ? pick(
                  locale,
                  `${result.update_count} contribution updates were queued for ${selectedCase.patient_id} / ${selectedCase.visit_date}.`,
                  `${selectedCase.patient_id} / ${selectedCase.visit_date}에 대해 ${result.update_count}개 기여 업데이트를 대기열에 올렸습니다.`,
                )
              : messages.contributionQueued(
                  selectedCase.patient_id,
                  selectedCase.visit_date,
                ),
      });
      scheduleSiteRefresh(
        selectedSiteId,
        async () => {
          await onSiteDataChanged(selectedSiteId);
          await loadCaseHistory(
            selectedSiteId,
            selectedCase.patient_id,
            selectedCase.visit_date,
            { forceRefresh: true },
          );
          await loadSiteActivity(selectedSiteId);
        },
        "Contribution background refresh failed",
      );
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, messages.contributionFailed),
      });
    } finally {
      setContributionBusy(false);
    }
  }, [
    describeError,
    executionModeFromDevice,
    loadCaseHistory,
    loadSiteActivity,
    locale,
    messages.activeOnly,
    messages.contributionFailed,
    messages.contributionQueued,
    messages.selectSavedCaseForContribution,
    onSiteDataChanged,
    pick,
    scheduleSiteRefresh,
    selectedCase,
    selectedCompareModelVersionIds,
    selectedSiteId,
    setCompletionState,
    setPanelOpen,
    setToast,
    token,
    validationResult,
  ]);

  const handleJoinResearchRegistry = useCallback(async () => {
    if (!selectedSiteId || !researchRegistryJoinReady) {
      return;
    }
    const shouldAutoInclude = pendingResearchRegistryAutoInclude;
    setResearchRegistryBusy(true);
    try {
      await enrollResearchRegistry(selectedSiteId, token);
      scheduleSiteRefresh(
        selectedSiteId,
        async () => {
          await onSiteDataChanged(selectedSiteId);
        },
        "Research registry enrollment refresh failed",
        0,
      );
      setResearchRegistryModalOpen(false);
      setResearchRegistryExplanationConfirmed(false);
      setResearchRegistryUsageConsented(false);
      setToast({
        tone: "success",
        message: messages.joinResearchRegistrySuccess,
      });
      if (shouldAutoInclude && selectedCase) {
        await includeCaseInResearchRegistry(
          selectedCase.patient_id,
          selectedCase.visit_date,
          "validation_auto_include",
          pick(
            locale,
            "This case was included in the research registry after validation.",
            "이 케이스는 검증 후 연구 레지스트리에 포함되었습니다.",
          ),
        );
      }
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, messages.joinResearchRegistryFailed),
      });
    } finally {
      setPendingResearchRegistryAutoInclude(false);
      setResearchRegistryBusy(false);
    }
  }, [
    describeError,
    includeCaseInResearchRegistry,
    locale,
    messages.joinResearchRegistryFailed,
    messages.joinResearchRegistrySuccess,
    onSiteDataChanged,
    pendingResearchRegistryAutoInclude,
    pick,
    researchRegistryJoinReady,
    scheduleSiteRefresh,
    selectedCase,
    selectedSiteId,
    setToast,
    token,
  ]);

  const handleIncludeResearchCase = useCallback(async () => {
    if (!selectedCase) {
      return;
    }
    setResearchRegistryBusy(true);
    try {
      await includeCaseInResearchRegistry(
        selectedCase.patient_id,
        selectedCase.visit_date,
        "manual_include",
        messages.includeResearchSuccess,
      );
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, messages.includeResearchFailed),
      });
    } finally {
      setResearchRegistryBusy(false);
    }
  }, [
    describeError,
    includeCaseInResearchRegistry,
    messages.includeResearchFailed,
    messages.includeResearchSuccess,
    selectedCase,
    setToast,
  ]);

  const handleExcludeResearchCase = useCallback(async () => {
    if (!selectedCase) {
      return;
    }
    setResearchRegistryBusy(true);
    try {
      await excludeCaseFromResearchRegistry(
        selectedCase.patient_id,
        selectedCase.visit_date,
        "manual_exclude",
        messages.excludeResearchSuccess,
      );
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, messages.excludeResearchFailed),
      });
    } finally {
      setResearchRegistryBusy(false);
    }
  }, [
    describeError,
    excludeCaseFromResearchRegistry,
    messages.excludeResearchFailed,
    messages.excludeResearchSuccess,
    selectedCase,
    setToast,
  ]);

  return {
    contributionBusy,
    researchRegistryBusy,
    handleRunSiteValidation,
    handleContributeCase,
    handleJoinResearchRegistry,
    handleIncludeResearchCase,
    handleExcludeResearchCase,
  };
}
