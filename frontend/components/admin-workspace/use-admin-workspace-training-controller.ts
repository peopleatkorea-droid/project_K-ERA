"use client";

import { useEffect } from "react";

import { pick, type Locale } from "../../lib/i18n";
import {
  cancelSiteJob,
  clearInitialTrainingBenchmarkHistory,
  fetchSiteJob,
  fetchSiteJobs,
  fetchCrossValidationReports,
  runCrossValidation,
  runInitialTraining,
  runInitialTrainingBenchmark,
  runSslPretraining,
  resumeInitialTrainingBenchmark,
} from "../../lib/api";
import { pickDesktopDirectory } from "../../lib/desktop-app-config";
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
  lesionGuidedBenchmarkArchitectures: string[];
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
  lesionGuidedBenchmarkArchitectures,
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
    benchmarkResult,
    crossValidationForm,
    sslForm,
    sslJob,
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
    setSslBusy,
    setSslForm,
    setSslJob,
    setSslResult,
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

  async function loadLatestBenchmarkJob() {
    if (!selectedSiteId) {
      return null;
    }
    const jobs = await fetchSiteJobs(selectedSiteId, token, {
      job_type: "initial_training_benchmark",
      limit: 1,
    });
    const latestJob = jobs[0] ?? null;
    if (!latestJob) {
      return null;
    }
    setBenchmarkJob(latestJob);
    const result = latestJob.result?.response;
    if (isBenchmarkResponse(result)) {
      setBenchmarkResult(result);
    }
    return latestJob;
  }

  function isSslResponse(response: unknown): response is { run: { run_id: string } } {
    return Boolean(
      response &&
        typeof response === "object" &&
        "run" in response &&
        (response as { run?: unknown }).run &&
        typeof (response as { run?: { run_id?: unknown } }).run?.run_id === "string",
    );
  }

  async function loadSslSectionData() {
    if (!selectedSiteId) {
      setSslJob(null);
      setSslResult(null);
      return null;
    }
    const jobs = await fetchSiteJobs(selectedSiteId, token, {
      job_type: "ssl_pretraining",
      limit: 1,
    });
    const latestJob = jobs[0] ?? null;
    setSslJob(latestJob);
    if (isSslResponse(latestJob?.result?.response)) {
      setSslResult(latestJob.result.response);
    } else {
      setSslResult(null);
    }
    return latestJob;
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

  useEffect(() => {
    if (section !== "training" || !selectedSiteId || benchmarkJob || benchmarkResult) {
      return;
    }
    let cancelled = false;
    async function hydrateLatestBenchmark() {
      try {
        const latestJob = await loadLatestBenchmarkJob();
        if (cancelled || !latestJob) {
          return;
        }
      } catch {
        // Keep this silent; the operator can explicitly press refresh status.
      }
    }
    void hydrateLatestBenchmark();
    return () => {
      cancelled = true;
    };
  }, [benchmarkJob, benchmarkResult, section, selectedSiteId, token]);

  useEffect(() => {
    if (section !== "ssl") {
      return;
    }
    let cancelled = false;
    async function hydrateLatestSslJob() {
      try {
        const latestJob = await loadSslSectionData();
        if (cancelled || !latestJob) {
          return;
        }
      } catch {
        // Keep this quiet so the operator can explicitly refresh if needed.
      }
    }
    void hydrateLatestSslJob();
    return () => {
      cancelled = true;
    };
  }, [section, selectedSiteId, token]);

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
        regenerate_split: true,
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

  async function runBenchmarkSuite({
    architectures,
    benchmarkSuiteKey,
    cropMode,
    pretrainingSource,
    usePretrained,
    runLabel,
  }: {
    architectures: string[];
    benchmarkSuiteKey: string;
    cropMode: "automated" | "manual" | "both" | "paired";
    pretrainingSource?: "imagenet" | "scratch" | "ssl";
    usePretrained: boolean;
    runLabel: string;
  }) {
    if (!selectedSiteId) {
      setToast({ tone: "error", message: copy.selectSiteForInitial });
      return;
    }
    setBenchmarkBusy(true);
    setBenchmarkJob(null);
    try {
      const started = await runInitialTrainingBenchmark(selectedSiteId, token, {
        architectures,
        execution_mode: initialForm.execution_mode,
        crop_mode: cropMode,
        case_aggregation: initialForm.case_aggregation,
        epochs: initialForm.epochs,
        learning_rate: initialForm.learning_rate,
        batch_size: initialForm.batch_size,
        val_split: initialForm.val_split,
        test_split: initialForm.test_split,
        use_pretrained: usePretrained,
        pretraining_source: pretrainingSource,
        benchmark_suite_key: benchmarkSuiteKey,
        regenerate_split: true,
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
        throw new Error(latestJob.result?.error || `${runLabel} failed.`);
      }
      if (!isBenchmarkResponse(result)) {
        throw new Error(`${runLabel} result is missing.`);
      }
      setBenchmarkResult(result);
      await refreshWorkspace(true);
      setSection("registry");
      setToast({
        tone: "success",
        message: pick(locale, `${runLabel} completed for ${result.results.length} architecture(s).`, `${runLabel}이 ${result.results.length}개 아키텍처에 대해 완료되었습니다.`),
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, `${runLabel} failed.`),
      });
    } finally {
      setBenchmarkBusy(false);
    }
  }

  async function handleBenchmarkTraining() {
    await runBenchmarkSuite({
      architectures: benchmarkArchitectures,
      benchmarkSuiteKey: "baseline_8",
      cropMode: initialForm.crop_mode === "paired" ? "automated" : initialForm.crop_mode,
      pretrainingSource: undefined,
      usePretrained: initialForm.use_pretrained,
      runLabel: pick(locale, `${benchmarkArchitectures.length}-model staged initial training`, `${benchmarkArchitectures.length}개 단계형 초기 학습`),
    });
  }

  async function handleLesionGuidedBenchmarkTraining() {
    await runBenchmarkSuite({
      architectures: lesionGuidedBenchmarkArchitectures,
      benchmarkSuiteKey: "lesion_guided_ssl_6",
      cropMode: "paired",
      pretrainingSource: "ssl",
      usePretrained: true,
      runLabel: pick(
        locale,
        `${lesionGuidedBenchmarkArchitectures.length}-model lesion-guided fusion + SSL training`,
        `${lesionGuidedBenchmarkArchitectures.length}개 lesion-guided fusion + SSL 학습`,
      ),
    });
  }

  async function handleLesionGuidedInitialBenchmarkTraining() {
    await runBenchmarkSuite({
      architectures: lesionGuidedBenchmarkArchitectures,
      benchmarkSuiteKey: "lesion_guided_6",
      cropMode: "paired",
      pretrainingSource: undefined,
      usePretrained: initialForm.use_pretrained,
      runLabel: pick(
        locale,
        `${lesionGuidedBenchmarkArchitectures.length}-model lesion-guided fusion training`,
        `${lesionGuidedBenchmarkArchitectures.length}개 lesion-guided fusion 학습`,
      ),
    });
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

  async function handleClearBenchmarkHistory() {
    if (!selectedSiteId) {
      return;
    }
    if (benchmarkJob && isActiveJobStatus(benchmarkJob.status)) {
      setToast({
        tone: "error",
        message: pick(locale, "Stop the active benchmark before deleting its records.", "실행 중인 benchmark를 먼저 중단한 뒤 기록을 삭제하세요."),
      });
      return;
    }
    setBenchmarkBusy(true);
    try {
      const response = await clearInitialTrainingBenchmarkHistory(selectedSiteId, token);
      setBenchmarkJob(null);
      setBenchmarkResult(null);
      await refreshWorkspace(true).catch(() => undefined);
      setToast({
        tone: "success",
        message: pick(
          locale,
          `Deleted ${response.deleted_jobs} benchmark record(s).`,
          `benchmark 기록 ${response.deleted_jobs}개를 삭제했습니다.`,
        ),
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, pick(locale, "Unable to delete benchmark records.", "benchmark 기록 삭제에 실패했습니다.")),
      });
    } finally {
      setBenchmarkBusy(false);
    }
  }

  async function handleRefreshBenchmarkStatus() {
    if (!selectedSiteId) {
      return;
    }
    setBenchmarkBusy(true);
    try {
      const refreshWorkspaceBestEffort = async () => {
        try {
          await refreshWorkspace(true);
        } catch {
          // The benchmark summary/paper figures should still become available
          // even if a broader workspace refresh fails.
        }
      };
      if (!benchmarkJob) {
        let latestJob;
        try {
          latestJob = await loadLatestBenchmarkJob();
        } catch {
          // If the job list cannot be fetched (e.g. backend not yet ready),
          // still attempt a workspace refresh so other panel data stays current.
          await refreshWorkspaceBestEffort();
          return;
        }
        if (!latestJob) {
          setBenchmarkJob(null);
          setBenchmarkResult(null);
          await refreshWorkspaceBestEffort();
        } else if (String(latestJob.status || "").trim().toLowerCase() === "completed") {
          await refreshWorkspaceBestEffort();
        }
        return;
      }
      try {
        const latestJob = await fetchSiteJob(selectedSiteId, benchmarkJob.job_id, token);
        setBenchmarkJob(latestJob);
        const result = latestJob.result?.response;
        if (isBenchmarkResponse(result)) {
          setBenchmarkResult(result);
        }
        if (String(latestJob.status || "").trim().toLowerCase() === "completed") {
          await refreshWorkspaceBestEffort();
        }
      } catch {
        const latestJob = await loadLatestBenchmarkJob().catch(() => null);
        if (!latestJob) {
          setBenchmarkJob(null);
          setBenchmarkResult(null);
          await refreshWorkspaceBestEffort();
          return;
        }
        if (String(latestJob.status || "").trim().toLowerCase() === "completed") {
          await refreshWorkspaceBestEffort();
        }
      }
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, pick(locale, "Unable to refresh benchmark status.", "benchmark 상태를 새로 고치지 못했습니다.")),
      });
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

  async function handlePickSslArchiveDirectory() {
    try {
      const selectedPath = await pickDesktopDirectory({
        title: pick(locale, "Select SSL archive folder", "SSL 원본 폴더 선택"),
        defaultPath: sslForm.archive_base_dir.trim() || undefined,
      });
      if (!selectedPath) {
        return;
      }
      setSslForm((current) => ({ ...current, archive_base_dir: selectedPath }));
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, pick(locale, "Unable to open the folder picker.", "폴더 선택기를 열지 못했습니다.")),
      });
    }
  }

  async function handleRunSslPretraining() {
    if (!selectedSiteId) {
      setToast({ tone: "error", message: pick(locale, "Select a hospital before starting SSL pretraining.", "SSL 학습을 시작하려면 병원을 선택하세요.") });
      return;
    }
    if (!sslForm.archive_base_dir.trim()) {
      setToast({ tone: "error", message: pick(locale, "Select an SSL archive folder first.", "먼저 SSL 원본 폴더를 선택하세요.") });
      return;
    }
    setSslBusy(true);
    setSslJob(null);
    setSslResult(null);
    try {
      const started = await runSslPretraining(selectedSiteId, token, {
        ...sslForm,
      });
      setSslJob(started.job);
      const latestJob = await waitForSiteJobSettlement({
        siteId: selectedSiteId,
        token,
        initialJob: started.job,
        isActive: isActiveJobStatus,
        onUpdate: setSslJob,
      });
      if (latestJob.status === "cancelled") {
        setToast({ tone: "success", message: pick(locale, "SSL pretraining was cancelled.", "SSL 학습이 중단되었습니다.") });
        return;
      }
      if (latestJob.status === "failed") {
        throw new Error(latestJob.result?.error || pick(locale, "SSL pretraining failed.", "SSL 학습에 실패했습니다."));
      }
      const result = latestJob.result?.response;
      if (!isSslResponse(result)) {
        throw new Error(pick(locale, "SSL pretraining finished without a saved result.", "SSL 학습이 끝났지만 저장된 결과가 없습니다."));
      }
      setSslResult(result);
      setToast({
        tone: "success",
        message: pick(locale, `SSL pretraining completed for ${sslForm.architecture}.`, `${sslForm.architecture} SSL 학습이 완료되었습니다.`),
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, pick(locale, "SSL pretraining failed.", "SSL 학습에 실패했습니다.")),
      });
    } finally {
      setSslBusy(false);
    }
  }

  async function handleCancelSslPretraining() {
    if (!selectedSiteId || !sslJob) {
      return;
    }
    try {
      const job = await cancelSiteJob(selectedSiteId, sslJob.job_id, token);
      setSslJob(job);
      setToast({ tone: "success", message: copy.cancellationRequested });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, pick(locale, "Unable to stop SSL pretraining.", "SSL 학습을 중단하지 못했습니다.")),
      });
    }
  }

  async function handleRefreshSslStatus() {
    if (!selectedSiteId) {
      return;
    }
    setSslBusy(true);
    try {
      if (!sslJob) {
        await loadSslSectionData();
        return;
      }
      const latestJob = await fetchSiteJob(selectedSiteId, sslJob.job_id, token);
      setSslJob(latestJob);
      if (isSslResponse(latestJob.result?.response)) {
        setSslResult(latestJob.result.response);
      } else {
        setSslResult(null);
      }
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, pick(locale, "Unable to refresh SSL status.", "SSL 상태를 새로 고치지 못했습니다.")),
      });
    } finally {
      setSslBusy(false);
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
    loadSslSectionData,
    handleInitialTraining,
    handleBenchmarkTraining,
    handleLesionGuidedInitialBenchmarkTraining,
    handleLesionGuidedBenchmarkTraining,
    handleCancelInitialTraining,
    handleCancelBenchmarkTraining,
    handleResumeBenchmarkTraining,
    handleClearBenchmarkHistory,
    handleRefreshBenchmarkStatus,
    handleCrossValidation,
    handlePickSslArchiveDirectory,
    handleRunSslPretraining,
    handleCancelSslPretraining,
    handleRefreshSslStatus,
    handleExportCrossValidationReport,
  };
}
