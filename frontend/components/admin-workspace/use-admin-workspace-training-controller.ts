"use client";

import { useEffect } from "react";

import { pick, type Locale } from "../../lib/i18n";
import {
  cancelSiteJob,
  fetchCrossValidationReports,
  runCrossValidation,
  runInitialTraining,
  runInitialTrainingBenchmark,
  resumeInitialTrainingBenchmark,
} from "../../lib/api";
import { waitForSiteJobSettlement } from "../../lib/site-job-runtime";
import { useAdminWorkspaceState } from "./use-admin-workspace-state";

type AdminWorkspaceState = ReturnType<typeof useAdminWorkspaceState>;

type TrainingControllerCopy = {
  selectSiteForInitial: string;
  registeredVersion: (name: string) => string;
  initialTrainingFailed: string;
  initialTrainingCancelled: string;
  cancellationRequested: string;
  benchmarkResumeCompleted: (count: number) => string;
  benchmarkCancelled: (count: number) => string;
  benchmarkResumeFailed: string;
  selectSiteForCrossValidation: string;
  savedReport: (reportId: string) => string;
  crossValidationFailed: string;
  initialTrainingMissingResult: string;
  crossValidationMissingResult: string;
};

type UseAdminWorkspaceTrainingControllerOptions = {
  state: AdminWorkspaceState;
  token: string;
  selectedSiteId: string | null;
  locale: Locale;
  benchmarkArchitectures: string[];
  copy: TrainingControllerCopy;
  describeError: (nextError: unknown, fallback: string) => string;
  refreshWorkspace: (siteScoped?: boolean) => Promise<void>;
  isActiveJobStatus: (status: string | null | undefined) => boolean;
  effectiveCaseAggregation: (
    architecture: string,
    caseAggregation: "mean" | "logit_mean" | "quality_weighted_mean" | "attention_mil",
  ) => "mean" | "logit_mean" | "quality_weighted_mean" | "attention_mil";
  isBenchmarkResponse: (
    response: unknown,
  ) => response is {
    results: Array<{ architecture: string; status: string }>;
    completed_architectures?: string[] | null;
  };
};

export function useAdminWorkspaceTrainingController({
  state,
  token,
  selectedSiteId,
  locale,
  benchmarkArchitectures,
  copy,
  describeError,
  refreshWorkspace,
  isActiveJobStatus,
  effectiveCaseAggregation,
  isBenchmarkResponse,
}: UseAdminWorkspaceTrainingControllerOptions) {
  const {
    overview,
    section,
    setSection,
    initialForm,
    initialJob,
    benchmarkJob,
    crossValidationForm,
    setToast,
    setInitialBusy,
    setInitialJob,
    setInitialResult,
    setBenchmarkBusy,
    setBenchmarkJob,
    setBenchmarkResult,
    setCrossValidationBusy,
    setCrossValidationJob,
    setCrossValidationReports,
    setSelectedReportId,
    selectedReport,
    setCrossValidationExportBusy,
  } = state;

  async function loadCrossValidationSectionData() {
    if (!selectedSiteId) {
      setCrossValidationReports([]);
      setSelectedReportId(null);
      return;
    }
    const nextCrossValidationReports = await fetchCrossValidationReports(selectedSiteId, token);
    setCrossValidationReports(nextCrossValidationReports);
    setSelectedReportId((current) => current ?? nextCrossValidationReports[0]?.cross_validation_id ?? null);
  }

  useEffect(() => {
    if (!overview || section !== "cross_validation") {
      return;
    }
    let cancelled = false;
    async function loadCrossValidation() {
      try {
        if (!selectedSiteId) {
          setCrossValidationReports([]);
          setSelectedReportId(null);
          return;
        }
        const nextCrossValidationReports = await fetchCrossValidationReports(selectedSiteId, token);
        if (!cancelled) {
          setCrossValidationReports(nextCrossValidationReports);
          setSelectedReportId((current) => current ?? nextCrossValidationReports[0]?.cross_validation_id ?? null);
        }
      } catch (nextError) {
        if (!cancelled) {
          setToast({ tone: "error", message: describeError(nextError, copy.crossValidationFailed) });
        }
      }
    }
    void loadCrossValidation();
    return () => {
      cancelled = true;
    };
  }, [
    copy.crossValidationFailed,
    describeError,
    overview,
    section,
    selectedSiteId,
    setCrossValidationReports,
    setSelectedReportId,
    setToast,
    token,
  ]);

  async function handleInitialTraining() {
    if (!selectedSiteId) {
      setToast({ tone: "error", message: copy.selectSiteForInitial });
      return;
    }
    setInitialBusy(true);
    setInitialJob(null);
    try {
      const started = await runInitialTraining(selectedSiteId, token, {
        ...initialForm,
        case_aggregation: effectiveCaseAggregation(initialForm.architecture, initialForm.case_aggregation),
      });
      setInitialJob(started.job);
      const latestJob = await waitForSiteJobSettlement({
        siteId: selectedSiteId,
        token,
        initialJob: started.job,
        isActive: isActiveJobStatus,
        onUpdate: setInitialJob,
      });
      if (latestJob.status === "cancelled") {
        setToast({ tone: "success", message: copy.initialTrainingCancelled });
        return;
      }
      if (latestJob.status === "failed") {
        throw new Error(latestJob.result?.error || copy.initialTrainingFailed);
      }
      const result = latestJob.result?.response;
      if (!result || !("result" in result)) {
        throw new Error(copy.initialTrainingMissingResult);
      }
      setInitialResult(result);
      await refreshWorkspace(true);
      setSection("registry");
      setToast({ tone: "success", message: copy.registeredVersion(result.result.version_name) });
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.initialTrainingFailed) });
    } finally {
      setInitialBusy(false);
    }
  }

  async function handleBenchmarkTraining() {
    if (!selectedSiteId) {
      setToast({ tone: "error", message: copy.selectSiteForInitial });
      return;
    }
    setBenchmarkBusy(true);
    setBenchmarkJob(null);
    try {
      const started = await runInitialTrainingBenchmark(selectedSiteId, token, {
        architectures: benchmarkArchitectures,
        execution_mode: initialForm.execution_mode,
        crop_mode: initialForm.crop_mode === "paired" ? "automated" : initialForm.crop_mode,
        case_aggregation: initialForm.case_aggregation,
        epochs: initialForm.epochs,
        learning_rate: initialForm.learning_rate,
        batch_size: initialForm.batch_size,
        val_split: initialForm.val_split,
        test_split: initialForm.test_split,
        use_pretrained: initialForm.use_pretrained,
        regenerate_split: initialForm.regenerate_split,
      });
      setBenchmarkJob(started.job);
      const latestJob = await waitForSiteJobSettlement({
        siteId: selectedSiteId,
        token,
        initialJob: started.job,
        isActive: isActiveJobStatus,
        onUpdate: setBenchmarkJob,
      });
      const result = latestJob.result?.response;
      if (isBenchmarkResponse(result)) {
        setBenchmarkResult(result);
      }
      if (latestJob.status === "cancelled") {
        const completedCount = isBenchmarkResponse(result) && Array.isArray(result.completed_architectures) ? result.completed_architectures.length : 0;
        setToast({ tone: "success", message: copy.benchmarkCancelled(completedCount) });
        return;
      }
      if (latestJob.status === "failed") {
        throw new Error(
          latestJob.result?.error ||
            pick(
              locale,
              `${benchmarkArchitectures.length}-model staged initial training failed.`,
              `${benchmarkArchitectures.length}개 단계 초기 학습이 실패했습니다.`,
            ),
        );
      }
      if (!isBenchmarkResponse(result)) {
        throw new Error(
          pick(
            locale,
            `${benchmarkArchitectures.length}-model staged initial-training result is missing.`,
            `${benchmarkArchitectures.length}개 단계 초기 학습 결과가 없습니다.`,
          ),
        );
      }
      setBenchmarkResult(result);
      await refreshWorkspace(true);
      setSection("registry");
      setToast({
        tone: "success",
        message: pick(
          locale,
          `${benchmarkArchitectures.length}-model staged initial training completed for ${result.results.length} architecture(s).`,
          `${result.results.length}개 아키텍처에 대한 ${benchmarkArchitectures.length}개 단계 초기 학습이 완료되었습니다.`,
        ),
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(
          nextError,
          pick(
            locale,
            `${benchmarkArchitectures.length}-model staged initial training failed.`,
            `${benchmarkArchitectures.length}개 단계 초기 학습이 실패했습니다.`,
          ),
        ),
      });
    } finally {
      setBenchmarkBusy(false);
    }
  }

  async function handleCancelInitialTraining() {
    if (!selectedSiteId || !initialJob) {
      return;
    }
    try {
      const job = await cancelSiteJob(selectedSiteId, initialJob.job_id, token);
      setInitialJob(job);
      setToast({ tone: "success", message: copy.cancellationRequested });
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.initialTrainingFailed) });
    }
  }

  async function handleCancelBenchmarkTraining() {
    if (!selectedSiteId || !benchmarkJob) {
      return;
    }
    try {
      const job = await cancelSiteJob(selectedSiteId, benchmarkJob.job_id, token);
      setBenchmarkJob(job);
      setToast({ tone: "success", message: copy.cancellationRequested });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, pick(locale, "Unable to stop benchmark training.", "benchmark 중단에 실패했습니다.")),
      });
    }
  }

  async function handleResumeBenchmarkTraining() {
    if (!selectedSiteId || !benchmarkJob) {
      return;
    }
    setBenchmarkBusy(true);
    try {
      const started = await resumeInitialTrainingBenchmark(selectedSiteId, token, {
        job_id: benchmarkJob.job_id,
        execution_mode: initialForm.execution_mode,
      });
      setBenchmarkResult(null);
      setBenchmarkJob(started.job);
      const latestJob = await waitForSiteJobSettlement({
        siteId: selectedSiteId,
        token,
        initialJob: started.job,
        isActive: isActiveJobStatus,
        onUpdate: setBenchmarkJob,
      });
      const result = latestJob.result?.response;
      if (isBenchmarkResponse(result)) {
        setBenchmarkResult(result);
      }
      if (latestJob.status === "cancelled") {
        const completedCount = isBenchmarkResponse(result) && Array.isArray(result.completed_architectures) ? result.completed_architectures.length : 0;
        setToast({ tone: "success", message: copy.benchmarkCancelled(completedCount) });
        return;
      }
      if (latestJob.status === "failed") {
        throw new Error(
          latestJob.result?.error ||
            pick(
              locale,
              `${benchmarkArchitectures.length}-model staged initial training failed.`,
              `${benchmarkArchitectures.length}개 단계 초기 학습이 실패했습니다.`,
            ),
        );
      }
      const completedCount = isBenchmarkResponse(result) ? result.results.length : 0;
      setToast({ tone: "success", message: copy.benchmarkResumeCompleted(completedCount) });
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.benchmarkResumeFailed) });
    } finally {
      setBenchmarkBusy(false);
    }
  }

  async function handleCrossValidation() {
    if (!selectedSiteId) {
      setToast({ tone: "error", message: copy.selectSiteForCrossValidation });
      return;
    }
    setCrossValidationBusy(true);
    setCrossValidationJob(null);
    try {
      const started = await runCrossValidation(selectedSiteId, token, {
        ...crossValidationForm,
        case_aggregation: effectiveCaseAggregation(crossValidationForm.architecture, crossValidationForm.case_aggregation),
      });
      setCrossValidationJob(started.job);
      const latestJob = await waitForSiteJobSettlement({
        siteId: selectedSiteId,
        token,
        initialJob: started.job,
        isActive: isActiveJobStatus,
        onUpdate: setCrossValidationJob,
      });
      if (latestJob.status === "failed") {
        throw new Error(latestJob.result?.error || copy.crossValidationFailed);
      }
      const result = latestJob.result?.response;
      if (!result || !("report" in result)) {
        throw new Error(copy.crossValidationMissingResult);
      }
      setCrossValidationReports((current) => [
        result.report,
        ...current.filter((item) => item.cross_validation_id !== result.report.cross_validation_id),
      ]);
      setSelectedReportId(result.report.cross_validation_id);
      setToast({ tone: "success", message: copy.savedReport(result.report.cross_validation_id) });
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.crossValidationFailed) });
    } finally {
      setCrossValidationBusy(false);
    }
  }

  async function handleExportCrossValidationReport() {
    if (!selectedReport) {
      setToast({
        tone: "error",
        message: pick(locale, "Select a cross-validation report before exporting.", "내보내기 전에 교차 검증 리포트를 선택하세요."),
      });
      return;
    }
    setCrossValidationExportBusy(true);
    try {
      const blob = new Blob([JSON.stringify(selectedReport, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${selectedReport.cross_validation_id}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setToast({
        tone: "success",
        message: pick(locale, `Exported ${selectedReport.cross_validation_id}.json.`, `${selectedReport.cross_validation_id}.json 파일을 내보냈습니다.`),
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, pick(locale, "Cross-validation report export failed.", "교차 검증 리포트 내보내기에 실패했습니다.")),
      });
    } finally {
      setCrossValidationExportBusy(false);
    }
  }

  return {
    loadCrossValidationSectionData,
    handleInitialTraining,
    handleBenchmarkTraining,
    handleCancelInitialTraining,
    handleCancelBenchmarkTraining,
    handleResumeBenchmarkTraining,
    handleCrossValidation,
    handleExportCrossValidationReport,
  };
}
