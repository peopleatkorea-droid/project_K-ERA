"use client";

import { useEffect, useRef } from "react";

import { pick, type Locale } from "../../lib/i18n";
import {
  backfillAiClinicEmbeddings,
  downloadImportTemplate,
  fetchAiClinicEmbeddingStatus,
  fetchImageBlob,
  fetchSiteActivity,
  fetchSiteComparison,
  fetchSiteValidations,
  fetchValidationArtifactBlob,
  fetchValidationCases,
  runBulkImport,
  runSiteValidation,
} from "../../lib/api";
import { waitForSiteJobSettlement } from "../../lib/site-job-runtime";
import { getDefaultRocSelection, useAdminWorkspaceState } from "./use-admin-workspace-state";

type AdminWorkspaceState = ReturnType<typeof useAdminWorkspaceState>;

type DashboardControllerCopy = {
  unableLoadSiteActivity: string;
  unableLoadMisclassified: string;
  unableLoadEmbeddingStatus: string;
  selectSiteForEmbedding: string;
  embeddingBackfillQueued: string;
  embeddingBackfillFailed: string;
  selectSiteForTemplate: string;
  templateDownloadFailed: string;
  selectSiteForImport: string;
  chooseCsvFirst: string;
  importedImages: (count: number, siteLabel: string) => string;
  bulkImportFailed: string;
};

type UseAdminWorkspaceDashboardControllerOptions = {
  state: AdminWorkspaceState;
  token: string;
  selectedSiteId: string | null;
  selectedSiteLabel: string;
  locale: Locale;
  dashboardValidationRunLimit: number;
  copy: DashboardControllerCopy;
  describeError: (nextError: unknown, fallback: string) => string;
  refreshWorkspace: (siteScoped?: boolean) => Promise<void>;
  isActiveJobStatus: (status: string | null | undefined) => boolean;
  isAbortError: (error: unknown) => boolean;
  getValidationRunRocPoints: (
    run: { roc_curve?: { fpr?: number[] | null; tpr?: number[] | null } | null } | null | undefined,
  ) => Array<{ x: number; y: number }>;
};

export function useAdminWorkspaceDashboardController({
  state,
  token,
  selectedSiteId,
  selectedSiteLabel,
  locale,
  dashboardValidationRunLimit,
  copy,
  describeError,
  refreshWorkspace,
  isActiveJobStatus,
  isAbortError,
  getValidationRunRocPoints,
}: UseAdminWorkspaceDashboardControllerOptions) {
  const {
    section,
    overview,
    bulkCsvFile,
    bulkFiles,
    embeddingStatus,
    selectedValidationId,
    selectedValidationRun,
    siteValidationRuns,
    setToast,
    setSiteComparison,
    setSiteValidationRuns,
    setSiteValidationBusy,
    setSelectedValidationId,
    setBaselineValidationId,
    setCompareValidationId,
    setRocValidationIds,
    setMisclassifiedCases,
    setSiteActivity,
    setSiteActivityBusy,
    setEmbeddingStatus,
    setEmbeddingStatusBusy,
    setEmbeddingBackfillBusy,
    setDashboardBusy,
    setValidationExportBusy,
    setBulkImportBusy,
    setBulkImportResult,
    setSection,
  } = state;
  const dashboardPreviewUrlsRef = useRef<string[]>([]);

  async function loadDashboardComparisonData() {
    const nextSiteComparison = await fetchSiteComparison(token);
    setSiteComparison(nextSiteComparison);
  }

  async function loadDashboardValidationRuns() {
    if (!selectedSiteId) {
      setSiteValidationRuns([]);
      return;
    }
    setSiteValidationBusy(true);
    setSiteValidationRuns([]);
    try {
      const nextSiteValidationRuns = await fetchSiteValidations(selectedSiteId, token, {
        limit: dashboardValidationRunLimit,
      });
      setSiteValidationRuns(nextSiteValidationRuns);
    } finally {
      setSiteValidationBusy(false);
    }
  }

  useEffect(() => {
    return () => {
      for (const url of dashboardPreviewUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  useEffect(() => {
    if (!overview || section !== "dashboard") {
      return;
    }
    let cancelled = false;
    async function loadDashboardComparison() {
      try {
        const nextSiteComparison = await fetchSiteComparison(token);
        if (!cancelled) {
          setSiteComparison(nextSiteComparison);
        }
      } catch (nextError) {
        if (!cancelled) {
          setToast({ tone: "error", message: describeError(nextError, copy.unableLoadSiteActivity) });
        }
      }
    }
    void loadDashboardComparison();
    return () => {
      cancelled = true;
    };
  }, [copy.unableLoadSiteActivity, describeError, overview, section, setSiteComparison, setToast, token]);

  useEffect(() => {
    if (!overview || section !== "dashboard") {
      return;
    }
    let cancelled = false;
    async function loadDashboardRuns() {
      try {
        if (!selectedSiteId) {
          setSiteValidationRuns([]);
          return;
        }
        setSiteValidationBusy(true);
        setSiteValidationRuns([]);
        const nextSiteValidationRuns = await fetchSiteValidations(selectedSiteId, token, {
          limit: dashboardValidationRunLimit,
        });
        if (!cancelled) {
          setSiteValidationRuns(nextSiteValidationRuns);
        }
      } catch (nextError) {
        if (!cancelled) {
          setToast({ tone: "error", message: describeError(nextError, copy.unableLoadMisclassified) });
        }
      } finally {
        if (!cancelled) {
          setSiteValidationBusy(false);
        }
      }
    }
    void loadDashboardRuns();
    return () => {
      cancelled = true;
    };
  }, [
    copy.unableLoadMisclassified,
    dashboardValidationRunLimit,
    describeError,
    overview,
    section,
    selectedSiteId,
    setSiteValidationBusy,
    setSiteValidationRuns,
    setToast,
    token,
  ]);

  useEffect(() => {
    if (!siteValidationRuns.length) {
      setSelectedValidationId(null);
      setBaselineValidationId(null);
      setCompareValidationId(null);
      setRocValidationIds([]);
      setMisclassifiedCases([]);
      return;
    }
    setSelectedValidationId((current) => current ?? siteValidationRuns[0]?.validation_id ?? null);
    setCompareValidationId((current) => current ?? siteValidationRuns[0]?.validation_id ?? null);
    setBaselineValidationId((current) => current ?? siteValidationRuns[1]?.validation_id ?? siteValidationRuns[0]?.validation_id ?? null);
    setRocValidationIds((current) => {
      const validIds = current.filter((validationId) =>
        siteValidationRuns.some((run) => run.validation_id === validationId && getValidationRunRocPoints(run).length > 0),
      );
      return validIds.length ? validIds : getDefaultRocSelection(siteValidationRuns);
    });
  }, [
    getValidationRunRocPoints,
    setBaselineValidationId,
    setCompareValidationId,
    setMisclassifiedCases,
    setRocValidationIds,
    setSelectedValidationId,
    siteValidationRuns,
  ]);

  useEffect(() => {
    if (section !== "dashboard" || !selectedSiteId) {
      if (!selectedSiteId) {
        setSiteActivity(null);
      }
      setSiteActivityBusy(false);
      return;
    }

    let cancelled = false;
    const currentSiteId = selectedSiteId;
    const controller = new AbortController();

    async function loadSiteActivity() {
      setSiteActivity(null);
      setSiteActivityBusy(true);
      try {
        const nextActivity = await fetchSiteActivity(currentSiteId, token, controller.signal);
        if (cancelled) {
          return;
        }
        setSiteActivity(nextActivity);
      } catch (nextError) {
        if (cancelled || isAbortError(nextError)) {
          return;
        }
        setToast({ tone: "error", message: describeError(nextError, copy.unableLoadSiteActivity) });
      } finally {
        if (!cancelled) {
          setSiteActivityBusy(false);
        }
      }
    }

    void loadSiteActivity();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [copy.unableLoadSiteActivity, describeError, isAbortError, section, selectedSiteId, setSiteActivity, setSiteActivityBusy, setToast, token]);

  useEffect(() => {
    if (section !== "dashboard" || !selectedSiteId) {
      setEmbeddingStatus(null);
      return;
    }
    const currentSiteId = selectedSiteId;
    let cancelled = false;
    async function loadEmbeddingStatus() {
      setEmbeddingStatusBusy(true);
      try {
        const nextStatus = await fetchAiClinicEmbeddingStatus(currentSiteId, token);
        if (!cancelled) {
          setEmbeddingStatus(nextStatus);
        }
      } catch (nextError) {
        if (!cancelled) {
          setToast({ tone: "error", message: describeError(nextError, copy.unableLoadEmbeddingStatus) });
        }
      } finally {
        if (!cancelled) {
          setEmbeddingStatusBusy(false);
        }
      }
    }
    void loadEmbeddingStatus();
    return () => {
      cancelled = true;
    };
  }, [copy.unableLoadEmbeddingStatus, describeError, section, selectedSiteId, setEmbeddingStatus, setEmbeddingStatusBusy, setToast, token]);

  useEffect(() => {
    if (
      section !== "dashboard" ||
      !selectedSiteId ||
      !embeddingStatus?.active_job ||
      !["queued", "running"].includes(embeddingStatus.active_job.status)
    ) {
      return;
    }
    const currentSiteId = selectedSiteId;
    let cancelled = false;
    const intervalId = window.setInterval(() => {
      void fetchAiClinicEmbeddingStatus(currentSiteId, token)
        .then((nextStatus) => {
          if (!cancelled) {
            setEmbeddingStatus(nextStatus);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setToast({ tone: "error", message: copy.unableLoadEmbeddingStatus });
          }
        });
    }, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [copy.unableLoadEmbeddingStatus, embeddingStatus?.active_job?.job_id, embeddingStatus?.active_job?.status, section, selectedSiteId, setEmbeddingStatus, setToast, token]);

  useEffect(() => {
    for (const url of dashboardPreviewUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    dashboardPreviewUrlsRef.current = [];
    if (section !== "dashboard" || !selectedSiteId || !selectedValidationId) {
      setMisclassifiedCases([]);
      return;
    }
    const currentSiteId = selectedSiteId;
    const currentValidationId = selectedValidationId;

    let cancelled = false;
    async function loadMisclassifiedCases() {
      setDashboardBusy(true);
      try {
        const cases = await fetchValidationCases(currentSiteId, currentValidationId, token, {
          misclassified_only: true,
        });
        const nextCases = await Promise.all(
          cases.map(async (item) => {
            let originalPreviewUrl: string | null = null;
            let roiPreviewUrl: string | null = null;
            let gradcamPreviewUrl: string | null = null;

            if (item.representative_image_id) {
              try {
                const blob = await fetchImageBlob(currentSiteId, item.representative_image_id, token);
                originalPreviewUrl = URL.createObjectURL(blob);
                dashboardPreviewUrlsRef.current.push(originalPreviewUrl);
              } catch {
                originalPreviewUrl = null;
              }
            }
            if (item.roi_crop_available) {
              try {
                const blob = await fetchValidationArtifactBlob(currentSiteId, currentValidationId, item.patient_id, item.visit_date, "roi_crop", token);
                roiPreviewUrl = URL.createObjectURL(blob);
                dashboardPreviewUrlsRef.current.push(roiPreviewUrl);
              } catch {
                roiPreviewUrl = null;
              }
            }
            if (item.gradcam_available) {
              try {
                const blob = await fetchValidationArtifactBlob(currentSiteId, currentValidationId, item.patient_id, item.visit_date, "gradcam", token);
                gradcamPreviewUrl = URL.createObjectURL(blob);
                dashboardPreviewUrlsRef.current.push(gradcamPreviewUrl);
              } catch {
                gradcamPreviewUrl = null;
              }
            }

            return {
              ...item,
              original_preview_url: originalPreviewUrl,
              roi_preview_url: roiPreviewUrl,
              gradcam_preview_url: gradcamPreviewUrl,
            };
          }),
        );
        if (!cancelled) {
          setMisclassifiedCases(nextCases);
        }
      } catch (nextError) {
        if (!cancelled) {
          setToast({ tone: "error", message: describeError(nextError, copy.unableLoadMisclassified) });
        }
      } finally {
        if (!cancelled) {
          setDashboardBusy(false);
        }
      }
    }
    void loadMisclassifiedCases();
    return () => {
      cancelled = true;
    };
  }, [copy.unableLoadMisclassified, describeError, section, selectedSiteId, selectedValidationId, setDashboardBusy, setMisclassifiedCases, setToast, token]);

  async function handleSiteValidation() {
    if (!selectedSiteId) {
      setToast({
        tone: "error",
        message: pick(locale, "Select a hospital before running hospital validation.", "병원 검증을 실행하려면 병원을 선택하세요."),
      });
      return;
    }
    setSiteValidationBusy(true);
    try {
      const started = await runSiteValidation(selectedSiteId, token);
      const latestJob = await waitForSiteJobSettlement({
        siteId: selectedSiteId,
        token,
        initialJob: started.job,
        isActive: isActiveJobStatus,
      });
      if (latestJob.status === "failed") {
        throw new Error(latestJob.result?.error || pick(locale, "Hospital validation failed.", "병원 검증에 실패했습니다."));
      }
      const result = latestJob.result?.response;
      if (!result || !("summary" in result)) {
        throw new Error(pick(locale, "Hospital validation finished without a saved report.", "병원 검증이 끝났지만 저장된 리포트가 없습니다."));
      }
      setSiteValidationRuns((current) => [result.summary, ...current.filter((item) => item.validation_id !== result.summary.validation_id)]);
      setSelectedValidationId(result.summary.validation_id);
      await refreshWorkspace(true);
      setSection("dashboard");
      setToast({
        tone: "success",
        message: pick(locale, `Saved validation ${result.summary.validation_id}.`, `${result.summary.validation_id} 검증 결과를 저장했습니다.`),
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, pick(locale, "Hospital validation failed.", "병원 검증에 실패했습니다.")),
      });
    } finally {
      setSiteValidationBusy(false);
    }
  }

  async function handleRefreshEmbeddingStatus() {
    if (!selectedSiteId) {
      setToast({ tone: "error", message: copy.selectSiteForEmbedding });
      return;
    }
    setEmbeddingStatusBusy(true);
    try {
      const nextStatus = await fetchAiClinicEmbeddingStatus(selectedSiteId, token, {
        model_version_id: embeddingStatus?.model_version.version_id,
      });
      setEmbeddingStatus(nextStatus);
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.unableLoadEmbeddingStatus) });
    } finally {
      setEmbeddingStatusBusy(false);
    }
  }

  async function handleEmbeddingBackfill() {
    if (!selectedSiteId) {
      setToast({ tone: "error", message: copy.selectSiteForEmbedding });
      return;
    }
    setEmbeddingBackfillBusy(true);
    try {
      await backfillAiClinicEmbeddings(selectedSiteId, token, {
        model_version_id: embeddingStatus?.model_version.version_id,
        force_refresh: false,
      });
      await handleRefreshEmbeddingStatus();
      setToast({ tone: "success", message: copy.embeddingBackfillQueued });
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.embeddingBackfillFailed) });
    } finally {
      setEmbeddingBackfillBusy(false);
    }
  }

  async function handleExportValidationReport() {
    if (!selectedSiteId || !selectedValidationId || !selectedValidationRun) {
      setToast({
        tone: "error",
        message: pick(locale, "Select a validation run before exporting.", "내보내기 전에 검증 실행을 선택하세요."),
      });
      return;
    }
    setValidationExportBusy(true);
    try {
      const casePredictions = await fetchValidationCases(selectedSiteId, selectedValidationId, token);
      const payload = { summary: selectedValidationRun, case_predictions: casePredictions };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${selectedValidationId}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setToast({
        tone: "success",
        message: pick(locale, `Exported ${selectedValidationId}.json.`, `${selectedValidationId}.json 파일을 내보냈습니다.`),
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, pick(locale, "Validation report export failed.", "검증 리포트 내보내기에 실패했습니다.")),
      });
    } finally {
      setValidationExportBusy(false);
    }
  }

  async function handleDownloadImportTemplate() {
    if (!selectedSiteId) {
      setToast({ tone: "error", message: copy.selectSiteForTemplate });
      return;
    }
    try {
      const blob = await downloadImportTemplate(selectedSiteId, token);
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "kera_import_template.csv";
      anchor.click();
      window.URL.revokeObjectURL(url);
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.templateDownloadFailed) });
    }
  }

  async function handleBulkImport() {
    if (!selectedSiteId) {
      setToast({ tone: "error", message: copy.selectSiteForImport });
      return;
    }
    if (!bulkCsvFile) {
      setToast({ tone: "error", message: copy.chooseCsvFirst });
      return;
    }
    setBulkImportBusy(true);
    try {
      const result = await runBulkImport(selectedSiteId, token, { csvFile: bulkCsvFile, files: bulkFiles });
      setBulkImportResult(result);
      await refreshWorkspace(true);
      setSection("dashboard");
      setToast({ tone: "success", message: copy.importedImages(result.imported_images, selectedSiteLabel || selectedSiteId) });
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.bulkImportFailed) });
    } finally {
      setBulkImportBusy(false);
    }
  }

  return {
    loadDashboardComparisonData,
    loadDashboardValidationRuns,
    handleSiteValidation,
    handleRefreshEmbeddingStatus,
    handleEmbeddingBackfill,
    handleExportValidationReport,
    handleDownloadImportTemplate,
    handleBulkImport,
  };
}
