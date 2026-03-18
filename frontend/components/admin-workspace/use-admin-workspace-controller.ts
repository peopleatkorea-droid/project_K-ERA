"use client";

import { useEffect, useRef } from "react";

import { pick, translateApiError } from "../../lib/i18n";
import { getRequestedSiteLabel, getSiteDisplayName } from "../../lib/site-labels";
import {
  autoPublishModelUpdate,
  autoPublishModelVersion,
  backfillAiClinicEmbeddings,
  createAdminSite,
  createProject,
  deleteModelVersion,
  downloadImportTemplate,
  fetchAccessRequests,
  fetchAdminOverview,
  fetchAdminSites,
  fetchAggregations,
  fetchAiClinicEmbeddingStatus,
  fetchCrossValidationReports,
  fetchImageBlob,
  fetchInstitutionDirectoryStatus,
  fetchModelUpdateArtifactBlob,
  fetchModelUpdates,
  fetchModelVersions,
  fetchProjects,
  fetchSiteComparison,
  fetchSiteJob,
  fetchSiteValidations,
  fetchStorageSettings,
  fetchUsers,
  fetchValidationArtifactBlob,
  fetchValidationCases,
  migrateAdminSiteStorageRoot,
  publishModelVersion,
  publishModelUpdate,
  reviewAccessRequest,
  reviewModelUpdate,
  syncInstitutionDirectory,
  runBulkImport,
  runCrossValidation,
  runFederatedAggregation,
  runInitialTraining,
  runInitialTrainingBenchmark,
  runSiteValidation,
  updateAdminSite,
  updateAdminSiteStorageRoot,
  updateStorageSettings,
  upsertManagedUser,
  type ManagedSiteRecord,
  type ModelUpdateRecord,
  type ModelVersionRecord,
} from "../../lib/api";
import { createSiteForm, createUserForm, getDefaultRocSelection, type WorkspaceSection, useAdminWorkspaceState } from "./use-admin-workspace-state";

const BENCHMARK_ARCHITECTURES = ["vit", "swin", "convnext_tiny", "densenet121", "efficientnet_v2_s"];
const HIRA_SITE_ID_PATTERN = /^\d{8}$/;

type AdminWorkspaceState = ReturnType<typeof useAdminWorkspaceState>;

type UseAdminWorkspaceControllerOptions = {
  state: AdminWorkspaceState;
  token: string;
  selectedSiteId: string | null;
  initialSection?: WorkspaceSection;
  onRefreshSites: () => Promise<void>;
  onSiteDataChanged: (siteId: string) => Promise<void>;
  onSelectSite: (siteId: string) => void;
};

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function sanitizeSiteCodeSegment(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}

function suggestedSiteCodeFromRequest(request: {
  requested_site_label?: string;
  requested_site_id: string;
  requested_site_source?: string;
}) {
  if (request.requested_site_source === "institution_directory") {
    return HIRA_SITE_ID_PATTERN.test(request.requested_site_id) ? request.requested_site_id : "";
  }
  const humanReadable = sanitizeSiteCodeSegment(request.requested_site_label ?? "");
  if (humanReadable) {
    return humanReadable;
  }
  return sanitizeSiteCodeSegment(request.requested_site_id);
}

function createReviewDraft(
  request: {
    requested_role: string;
    requested_site_id: string;
    requested_site_label?: string;
    requested_site_source?: string;
    resolved_site_id?: string | null;
  },
  projectId: string,
) {
  const label = getRequestedSiteLabel(request);
  const hasResolvedSite = Boolean(request.resolved_site_id);
  const shouldCreateSite =
    request.requested_site_source === "institution_directory" && !hasResolvedSite;
  return {
    assigned_role: request.requested_role,
    assigned_site_id:
      request.resolved_site_id ??
      (request.requested_site_source === "site" ? request.requested_site_id : ""),
    create_site_if_missing: shouldCreateSite,
    project_id: projectId,
    site_code: suggestedSiteCodeFromRequest(request),
    display_name: label,
    hospital_name: label,
    research_registry_enabled: false,
    reviewer_notes: "",
  };
}

function mergeReviewDraft(
  existingDraft: AdminWorkspaceState["reviewDrafts"][string] | undefined,
  request: Parameters<typeof createReviewDraft>[0],
  projectId: string,
) {
  const defaultDraft = createReviewDraft(request, projectId);
  if (!existingDraft) {
    return defaultDraft;
  }
  return {
    ...defaultDraft,
    ...existingDraft,
    assigned_site_id: existingDraft.assigned_site_id || defaultDraft.assigned_site_id,
    project_id: existingDraft.project_id || defaultDraft.project_id,
    site_code: existingDraft.site_code || defaultDraft.site_code,
    display_name: existingDraft.display_name || defaultDraft.display_name,
    hospital_name: existingDraft.hospital_name || defaultDraft.hospital_name,
    create_site_if_missing: defaultDraft.create_site_if_missing
      ? existingDraft.create_site_if_missing
      : false,
  };
}

function getValidationRunRocPoints(
  run: { roc_curve?: { fpr?: number[] | null; tpr?: number[] | null } | null } | null | undefined,
): Array<{ x: number; y: number }> {
  const fpr = run?.roc_curve?.fpr;
  const tpr = run?.roc_curve?.tpr;
  if (!Array.isArray(fpr) || !Array.isArray(tpr) || fpr.length !== tpr.length || fpr.length < 2) {
    return [];
  }
  return fpr
    .map((falsePositiveRate, index) => {
      const truePositiveRate = tpr[index];
      if (typeof falsePositiveRate !== "number" || typeof truePositiveRate !== "number") {
        return null;
      }
      return {
        x: Math.max(0, Math.min(1, falsePositiveRate)),
        y: Math.max(0, Math.min(1, truePositiveRate)),
      };
    })
    .filter((point): point is { x: number; y: number } => point !== null)
    .sort((left, right) => left.x - right.x || left.y - right.y);
}

export function useAdminWorkspaceController({
  state,
  token,
  selectedSiteId,
  initialSection,
  onRefreshSites,
  onSiteDataChanged,
  onSelectSite,
}: UseAdminWorkspaceControllerOptions) {
  const buildReadyAggregationLanes = (items: ModelUpdateRecord[]) => {
    const groups = new Map<
      string,
      {
        architecture: string;
        base_model_version_id: string;
        duplicate_site_count: number;
        update_ids: string[];
      }
    >();
    const siteCounts = new Map<string, Map<string, number>>();

    for (const item of items) {
      const status = String(item.status ?? "").trim().toLowerCase();
      if (status !== "approved") {
        continue;
      }
      const architecture = String(item.architecture ?? "").trim();
      const baseModelVersionId = String(item.base_model_version_id ?? "").trim();
      const updateId = String(item.update_id ?? "").trim();
      if (!architecture || !baseModelVersionId || !updateId) {
        continue;
      }
      const laneKey = `${architecture}:${baseModelVersionId}`;
      const lane = groups.get(laneKey) ?? {
        architecture,
        base_model_version_id: baseModelVersionId,
        duplicate_site_count: 0,
        update_ids: [],
      };
      const siteId = String(item.site_id ?? "").trim() || "unknown";
      const laneSiteCounts = siteCounts.get(laneKey) ?? new Map<string, number>();
      laneSiteCounts.set(siteId, (laneSiteCounts.get(siteId) ?? 0) + 1);
      siteCounts.set(laneKey, laneSiteCounts);
      lane.update_ids.push(updateId);
      groups.set(laneKey, lane);
    }

    return Array.from(groups.entries())
      .map(([laneKey, lane]) => {
        const laneSiteCounts = siteCounts.get(laneKey) ?? new Map<string, number>();
        const duplicateSiteCount = Array.from(laneSiteCounts.values()).filter((count) => count > 1).length;
        return {
          architecture: lane.architecture,
          base_model_version_id: lane.base_model_version_id,
          duplicate_site_count: duplicateSiteCount,
          update_ids: lane.update_ids,
        };
      })
      .filter((lane) => lane.duplicate_site_count === 0 && lane.update_ids.length > 0);
  };

  const {
    locale,
    section,
    setSection,
    toast,
    setToast,
    overview,
    setOverview,
    storageSettings,
    setStorageSettings,
    setPendingRequests,
    reviewDrafts,
    setReviewDrafts,
    setModelVersions,
    modelUpdates,
    setModelUpdates,
    setAggregations,
    projects,
    setProjects,
    setManagedSites,
    setManagedUsers,
    institutionSyncBusy,
    setInstitutionSyncBusy,
    setInstitutionSyncStatus,
    setSiteComparison,
    siteValidationRuns,
    setSiteValidationRuns,
    selectedValidationId,
    setSelectedValidationId,
    setBaselineValidationId,
    setCompareValidationId,
    setRocValidationIds,
    setMisclassifiedCases,
    setDashboardBusy,
    bulkCsvFile,
    bulkFiles,
    setBulkImportBusy,
    setBulkImportResult,
    projectForm,
    setProjectForm,
    siteForm,
    setSiteForm,
    instanceStorageRootForm,
    setInstanceStorageRootForm,
    siteStorageRootForm,
    setSiteStorageRootForm,
    editingSiteId,
    setEditingSiteId,
    userForm,
    setUserForm,
    initialForm,
    setInitialBusy,
    setInitialResult,
    setInitialJob,
    benchmarkBusy,
    setBenchmarkBusy,
    setBenchmarkResult,
    setBenchmarkJob,
    crossValidationForm,
    crossValidationReports,
    setCrossValidationBusy,
    setCrossValidationJob,
    setCrossValidationReports,
    siteValidationBusy,
    setSiteValidationBusy,
    embeddingStatus,
    setEmbeddingStatus,
    setEmbeddingStatusBusy,
    setEmbeddingBackfillBusy,
    setValidationExportBusy,
    setCrossValidationExportBusy,
    selectedReportId,
    setSelectedReportId,
    selectedModelUpdateId,
    setSelectedModelUpdateId,
    modelUpdateReviewNotes,
    setModelUpdateReviewNotes,
    selectedModelUpdate,
    selectedReport,
    selectedValidationRun,
    setSelectedUpdatePreviewUrls,
    setPublishingModelVersionId,
    setPublishingModelUpdateId,
    setAggregationBusy,
    canAggregate,
    canManagePlatform,
    selectedManagedSite,
    currentModel,
    setStorageSettingsBusy,
    newVersionName,
    setNewVersionName,
  } = state;
  const dashboardPreviewUrlsRef = useRef<string[]>([]);
  const modelUpdatePreviewUrlsRef = useRef<string[]>([]);
  const autoPublishEnabled = Boolean(overview?.federation_setup?.onedrive_auto_publish_enabled);
  const describeError = (nextError: unknown, fallback: string) =>
    nextError instanceof Error ? translateApiError(locale, nextError.message) : fallback;
  const selectedSiteLabel = selectedSiteId ? getSiteDisplayName(selectedManagedSite, selectedSiteId) : "";
  const copy = {
    unableLoadStorageSettings: pick(locale, "Unable to load storage settings.", "저장 경로 설정을 불러오지 못했습니다."),
    unableLoadMisclassified: pick(locale, "Unable to load misclassified cases.", "오분류 케이스를 불러오지 못했습니다."),
    unableLoadEmbeddingStatus: pick(locale, "Unable to load embedding status.", "임베딩 상태를 불러오지 못했습니다."),
    institutionSyncSucceeded: (count: number, pages?: number | null) =>
      pages && pages > 0
        ? pick(
            locale,
            `Synced ${count} institutions from ${pages} HIRA page(s).`,
            `HIRA ${pages}페이지에서 기관 ${count}개를 동기화했습니다.`,
          )
        : pick(
            locale,
            `Synced ${count} institutions from HIRA.`,
            `HIRA에서 기관 ${count}개를 동기화했습니다.`,
          ),
    institutionSyncFailed: pick(locale, "Unable to sync the HIRA directory.", "HIRA 기관 디렉터리 동기화에 실패했습니다."),
    requestReviewed: (decision: "approved" | "rejected") =>
      pick(locale, `Request ${decision}.`, `요청이 ${decision === "approved" ? "승인" : "반려"} 처리되었습니다.`),
    requestReviewedAndSiteCreated: (siteLabel: string) =>
      pick(locale, `Request approved and ${siteLabel} created.`, `요청을 승인했고 ${siteLabel} site를 생성했습니다.`),
    unableReview: pick(locale, "Unable to review request.", "요청 검토에 실패했습니다."),
    selectSiteForInitial: pick(locale, "Select a hospital before starting initial training.", "초기 학습을 시작하려면 병원을 선택하세요."),
    registeredVersion: (name: string) => pick(locale, `Registered ${name}.`, `${name} 버전을 등록했습니다.`),
    initialTrainingFailed: pick(locale, "Initial training failed.", "초기 학습에 실패했습니다."),
    selectSiteForCrossValidation: pick(locale, "Select a hospital before running cross-validation.", "교차 검증을 실행하려면 병원을 선택하세요."),
    savedReport: (reportId: string) => pick(locale, `Saved report ${reportId}.`, `${reportId} 리포트를 저장했습니다.`),
    crossValidationFailed: pick(locale, "Cross-validation failed.", "교차 검증에 실패했습니다."),
    createdVersion: (name: string) => pick(locale, `Created ${name}.`, `${name} 버전을 생성했습니다.`),
    aggregationFailed: pick(locale, "Federated aggregation failed.", "연합 집계에 실패했습니다."),
    noReadyAggregationLanes: pick(locale, "No aggregation-ready lanes are available.", "일괄 집계할 준비된 lane이 없습니다."),
    createdBatchVersions: (count: number) =>
      pick(locale, `Created ${count} aggregated version(s).`, `${count}개 집계 버전을 생성했습니다.`),
    batchAggregationPartialFailed: (count: number, detail: string) =>
      pick(
        locale,
        `Created ${count} aggregated version(s), then stopped: ${detail}`,
        `${count}개 집계 버전을 생성한 뒤 중단되었습니다: ${detail}`
      ),
    updateReviewed: (decision: "approved" | "rejected") =>
      pick(locale, `Update ${decision}.`, `업데이트를 ${decision === "approved" ? "승인" : "반려"}했습니다.`),
    updateReviewFailed: pick(locale, "Unable to review model update.", "모델 업데이트 검토에 실패했습니다."),
    updatePublishPrompt: (updateId: string) =>
      pick(locale, `Enter the artifact download URL for ${updateId}.`, `${updateId} delta의 download URL을 입력하세요.`),
    updatePublished: (updateId: string) => pick(locale, `Published ${updateId}.`, `${updateId} delta를 발행했습니다.`),
    updatePublishFailed: pick(locale, "Unable to publish the update artifact.", "업데이트 아티팩트 발행에 실패했습니다."),
    modelDeleted: (name: string) => pick(locale, `Deleted ${name}.`, `${name} 모델을 삭제했습니다.`),
    modelDeleteFailed: pick(locale, "Unable to delete the model.", "모델 삭제에 실패했습니다."),
    modelPublishPrompt: (name: string) =>
      pick(
        locale,
        `Enter the download URL for ${name}.`,
        `${name} 모델의 download URL을 입력하세요.`,
      ),
    modelPublishConfirmCurrent: (name: string) =>
      pick(
        locale,
        `Mark ${name} as the current global model after publishing?`,
        `${name} 모델을 발행 후 현재 글로벌 모델로 승격할까요?`,
      ),
    modelPublished: (name: string) => pick(locale, `Published ${name}.`, `${name} 모델을 발행했습니다.`),
    modelPublishFailed: pick(locale, "Unable to publish the model.", "모델 발행에 실패했습니다."),
    selectSiteForTemplate: pick(locale, "Select a hospital before downloading the template.", "템플릿을 내려받으려면 병원을 선택하세요."),
    templateDownloadFailed: pick(locale, "Template download failed.", "템플릿 다운로드에 실패했습니다."),
    selectSiteForImport: pick(locale, "Select a hospital before importing.", "임포트를 하려면 병원을 선택하세요."),
    chooseCsvFirst: pick(locale, "Choose a CSV file first.", "먼저 CSV 파일을 선택하세요."),
    importedImages: (count: number, siteLabel: string) => pick(locale, `Imported ${count} images into ${siteLabel}.`, `${siteLabel}에 이미지 ${count}개를 임포트했습니다.`),
    bulkImportFailed: pick(locale, "Bulk import failed.", "대량 임포트에 실패했습니다."),
    projectNameRequired: pick(locale, "Project name is required.", "프로젝트 이름은 필수입니다."),
    projectRegistered: pick(locale, "Project registered.", "프로젝트를 등록했습니다."),
    unableCreateProject: pick(locale, "Unable to create project.", "프로젝트 생성에 실패했습니다."),
    siteFieldsRequired: pick(locale, "Project, HIRA site ID, and official hospital name are required.", "프로젝트, HIRA site ID, 공식 병원명은 필수입니다."),
    siteNameRequired: pick(locale, "Official hospital name is required.", "공식 병원명은 필수입니다."),
    siteRegistered: (siteLabel: string) => pick(locale, `Registered ${siteLabel}.`, `${siteLabel} 병원을 등록했습니다.`),
    unableCreateSite: pick(locale, "Unable to create hospital.", "병원 생성에 실패했습니다."),
    siteUpdated: (siteLabel: string) => pick(locale, `Updated ${siteLabel}.`, `${siteLabel} 병원 정보를 수정했습니다.`),
    unableUpdateSite: pick(locale, "Unable to update hospital.", "병원 수정에 실패했습니다."),
    storageRootSaved: pick(locale, "Default storage root saved.", "기본 저장 경로를 저장했습니다."),
    unableSaveStorageRoot: pick(locale, "Unable to save storage root.", "저장 경로 저장에 실패했습니다."),
    selectedSiteStorageRootSaved: (siteLabel: string) => pick(locale, `Saved storage root for ${siteLabel}.`, `${siteLabel}의 저장 경로를 저장했습니다.`),
    unableSaveSelectedSiteStorageRoot: pick(locale, "Unable to save the selected hospital storage root.", "선택한 병원의 저장 경로 저장에 실패했습니다."),
    selectedSiteStorageMigrated: (siteLabel: string) => pick(locale, `Migrated stored files for ${siteLabel}.`, `${siteLabel}의 저장 파일을 새 경로로 이동했습니다.`),
    unableMigrateSelectedSiteStorageRoot: pick(locale, "Unable to migrate the selected hospital storage root.", "선택한 병원의 저장 경로 마이그레이션에 실패했습니다."),
    selectSiteForStorageRoot: pick(locale, "Select a hospital before changing its storage root.", "저장 경로를 바꾸려면 먼저 병원을 선택하세요."),
    usernameRequired: pick(locale, "Username is required.", "아이디는 필수입니다."),
    assignSiteRequired: pick(locale, "Assign at least one hospital for non-admin users.", "관리자가 아닌 사용자는 최소 한 개 이상의 병원을 지정해야 합니다."),
    userSaved: pick(locale, "User settings saved.", "사용자 설정을 저장했습니다."),
    unableSaveUser: pick(locale, "Unable to save user.", "사용자 저장에 실패했습니다."),
    initialTrainingMissingResult: pick(locale, "Training finished without a result payload.", "학습이 끝났지만 결과를 받지 못했습니다."),
    crossValidationMissingResult: pick(locale, "Cross-validation finished without a report payload.", "교차 검증이 끝났지만 리포트를 받지 못했습니다."),
    selectSiteForEmbedding: pick(locale, "Select a hospital before checking embeddings.", "임베딩 상태를 확인하려면 먼저 병원을 선택하세요."),
    embeddingBackfillQueued: pick(locale, "Embedding backfill started in the background.", "임베딩 백필이 백그라운드에서 시작되었습니다."),
    embeddingBackfillFailed: pick(locale, "Embedding backfill failed.", "임베딩 백필에 실패했습니다."),
  };

  useEffect(() => {
    if (initialSection) {
      setSection(initialSection);
    }
  }, [initialSection, setSection]);

  useEffect(() => {
    if (!toast) return;
    const timeoutId = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timeoutId);
  }, [toast, setToast]);

  useEffect(() => {
    return () => {
      for (const url of dashboardPreviewUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      for (const url of modelUpdatePreviewUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadWorkspace() {
      try {
        const [
          nextOverview,
          nextStorageSettings,
          nextRequests,
          nextVersions,
          nextUpdates,
          nextAggregations,
          nextProjects,
          nextManagedSites,
          nextManagedUsers,
          nextInstitutionSyncStatus,
          nextSiteComparison,
          nextCrossValidationReports,
          nextSiteValidationRuns,
        ] = await Promise.all([
          fetchAdminOverview(token),
          fetchStorageSettings(token),
          fetchAccessRequests(token, "pending"),
          fetchModelVersions(token),
          fetchModelUpdates(token, { site_id: selectedSiteId ?? undefined }),
          canAggregate ? fetchAggregations(token) : Promise.resolve([]),
          fetchProjects(token),
          fetchAdminSites(token),
          canManagePlatform ? fetchUsers(token) : Promise.resolve([]),
          fetchInstitutionDirectoryStatus(token),
          fetchSiteComparison(token),
          selectedSiteId ? fetchCrossValidationReports(selectedSiteId, token) : Promise.resolve([]),
          selectedSiteId ? fetchSiteValidations(selectedSiteId, token) : Promise.resolve([]),
        ]);
        if (cancelled) return;
        setOverview(nextOverview);
        setStorageSettings(nextStorageSettings);
        setPendingRequests(nextRequests);
        setModelVersions(nextVersions);
        setModelUpdates(nextUpdates);
        setAggregations(nextAggregations);
        setProjects(nextProjects);
        setManagedSites(nextManagedSites);
        setManagedUsers(nextManagedUsers);
        setInstitutionSyncStatus(nextInstitutionSyncStatus);
        setSiteComparison(nextSiteComparison);
        setCrossValidationReports(nextCrossValidationReports);
        setSelectedReportId((current) => current ?? nextCrossValidationReports[0]?.cross_validation_id ?? null);
        setSiteValidationRuns(nextSiteValidationRuns);
        setInstanceStorageRootForm((current) => current || nextStorageSettings.storage_root);
        setSiteStorageRootForm((current) => {
          if (current) {
            return current;
          }
          const activeSite = nextManagedSites.find((item) => item.site_id === selectedSiteId) ?? nextManagedSites[0];
          return activeSite?.local_storage_root ?? "";
        });
        setSiteForm((current) => ({
          ...current,
          project_id: current.project_id || nextProjects[0]?.project_id || "",
        }));
        setReviewDrafts((current) => {
          const next = { ...current };
          for (const item of nextRequests) {
            next[item.request_id] = mergeReviewDraft(next[item.request_id], item, nextProjects[0]?.project_id ?? "");
          }
          return next;
        });
        setModelUpdateReviewNotes((current) => {
          const next = { ...current };
          for (const item of nextUpdates) {
            if (next[item.update_id] === undefined) {
              next[item.update_id] = item.reviewer_notes ?? "";
            }
          }
          return next;
        });
      } catch (nextError) {
        if (!cancelled) {
          setToast({ tone: "error", message: describeError(nextError, copy.unableLoadStorageSettings) });
        }
      }
    }
    void loadWorkspace();
    return () => {
      cancelled = true;
    };
  }, [
    token,
    selectedSiteId,
    canAggregate,
    canManagePlatform,
    setAggregations,
    setCrossValidationReports,
    setInstanceStorageRootForm,
    setManagedSites,
    setManagedUsers,
    setInstitutionSyncStatus,
    setModelUpdateReviewNotes,
    setModelUpdates,
    setModelVersions,
    setOverview,
    setPendingRequests,
    setProjects,
    setReviewDrafts,
    setSelectedReportId,
    setSiteComparison,
    setSiteForm,
    setSiteStorageRootForm,
    setSiteValidationRuns,
    setStorageSettings,
    setToast,
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
    setBaselineValidationId,
    setCompareValidationId,
    setMisclassifiedCases,
    setRocValidationIds,
    setSelectedValidationId,
    siteValidationRuns,
  ]);

  useEffect(() => {
    if (!modelUpdates.length) {
      setSelectedModelUpdateId(null);
      return;
    }
    setSelectedModelUpdateId((current) =>
      current && modelUpdates.some((item) => item.update_id === current) ? current : modelUpdates[0]?.update_id ?? null,
    );
  }, [modelUpdates, setSelectedModelUpdateId]);

  useEffect(() => {
    if (!selectedSiteId) {
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
  }, [selectedSiteId, token, setEmbeddingStatus, setEmbeddingStatusBusy, setToast]);

  useEffect(() => {
    if (!selectedSiteId || !embeddingStatus?.active_job || !["queued", "running"].includes(embeddingStatus.active_job.status)) {
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
  }, [selectedSiteId, token, embeddingStatus?.active_job?.job_id, embeddingStatus?.active_job?.status, setEmbeddingStatus, setToast]);

  useEffect(() => {
    for (const url of dashboardPreviewUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    dashboardPreviewUrlsRef.current = [];
    if (!selectedSiteId || !selectedValidationId) {
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
          limit: 4,
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
                const blob = await fetchValidationArtifactBlob(
                  currentSiteId,
                  currentValidationId,
                  item.patient_id,
                  item.visit_date,
                  "roi_crop",
                  token,
                );
                roiPreviewUrl = URL.createObjectURL(blob);
                dashboardPreviewUrlsRef.current.push(roiPreviewUrl);
              } catch {
                roiPreviewUrl = null;
              }
            }
            if (item.gradcam_available) {
              try {
                const blob = await fetchValidationArtifactBlob(
                  currentSiteId,
                  currentValidationId,
                  item.patient_id,
                  item.visit_date,
                  "gradcam",
                  token,
                );
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
  }, [selectedSiteId, selectedValidationId, token, setDashboardBusy, setMisclassifiedCases, setToast]);

  useEffect(() => {
    for (const url of modelUpdatePreviewUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    modelUpdatePreviewUrlsRef.current = [];
    setSelectedUpdatePreviewUrls({ source: null, roi: null, mask: null });
    if (!selectedModelUpdate) {
      return;
    }

    let cancelled = false;
    async function loadModelUpdatePreviews() {
      const nextUrls = { source: null as string | null, roi: null as string | null, mask: null as string | null };
      const artifactKinds: Array<["source" | "roi" | "mask", "source_thumbnail" | "roi_thumbnail" | "mask_thumbnail"]> = [
        ["source", "source_thumbnail"],
        ["roi", "roi_thumbnail"],
        ["mask", "mask_thumbnail"],
      ];
      for (const [key, artifactKind] of artifactKinds) {
        try {
          const blob = await fetchModelUpdateArtifactBlob(selectedModelUpdate.update_id, artifactKind, token);
          const url = URL.createObjectURL(blob);
          modelUpdatePreviewUrlsRef.current.push(url);
          nextUrls[key] = url;
        } catch {
          nextUrls[key] = null;
        }
      }
      if (!cancelled) {
        setSelectedUpdatePreviewUrls(nextUrls);
      }
    }

    void loadModelUpdatePreviews();
    return () => {
      cancelled = true;
    };
  }, [selectedModelUpdate, token, setSelectedUpdatePreviewUrls]);

  useEffect(() => {
    if (storageSettings) {
      setInstanceStorageRootForm(storageSettings.storage_root);
    }
  }, [setInstanceStorageRootForm, storageSettings]);

  useEffect(() => {
    setSiteStorageRootForm(selectedManagedSite?.local_storage_root ?? "");
  }, [selectedManagedSite?.local_storage_root, selectedManagedSite?.site_id, setSiteStorageRootForm]);

  async function refreshWorkspace(siteScoped = false) {
    const [
      nextOverview,
      nextStorageSettings,
      nextVersions,
      nextUpdates,
      nextAggregations,
      nextProjects,
      nextManagedSites,
      nextManagedUsers,
      nextInstitutionSyncStatus,
      nextSiteComparison,
      nextCrossValidationReports,
      nextSiteValidationRuns,
      nextRequests,
    ] = await Promise.all([
      fetchAdminOverview(token),
      fetchStorageSettings(token),
      fetchModelVersions(token),
      fetchModelUpdates(token, { site_id: selectedSiteId ?? undefined }),
      canAggregate ? fetchAggregations(token) : Promise.resolve([]),
      fetchProjects(token),
      fetchAdminSites(token),
      canManagePlatform ? fetchUsers(token) : Promise.resolve([]),
      fetchInstitutionDirectoryStatus(token),
      fetchSiteComparison(token),
      selectedSiteId ? fetchCrossValidationReports(selectedSiteId, token) : Promise.resolve([]),
      selectedSiteId ? fetchSiteValidations(selectedSiteId, token) : Promise.resolve([]),
      fetchAccessRequests(token, "pending"),
    ]);
    setOverview(nextOverview);
    setStorageSettings(nextStorageSettings);
    setModelVersions(nextVersions);
    setModelUpdates(nextUpdates);
    setAggregations(nextAggregations);
    setProjects(nextProjects);
    setManagedSites(nextManagedSites);
    setManagedUsers(nextManagedUsers);
    setInstitutionSyncStatus(nextInstitutionSyncStatus);
    setSiteComparison(nextSiteComparison);
    setCrossValidationReports(nextCrossValidationReports);
    setSiteValidationRuns(nextSiteValidationRuns);
    setPendingRequests(nextRequests);
    setReviewDrafts((current) => {
      const next = { ...current };
      for (const item of nextRequests) {
        next[item.request_id] = mergeReviewDraft(next[item.request_id], item, nextProjects[0]?.project_id ?? "");
      }
      return next;
    });
    setInstanceStorageRootForm(nextStorageSettings.storage_root);
    if (siteScoped && selectedSiteId) {
      await onSiteDataChanged(selectedSiteId);
    }
  }

  async function handleReview(requestId: string, decision: "approved" | "rejected") {
    const draft = reviewDrafts[requestId];
    try {
      const response = await reviewAccessRequest(requestId, token, {
        decision,
        assigned_role: draft?.assigned_role,
        assigned_site_id: draft?.assigned_site_id,
        create_site_if_missing: draft?.create_site_if_missing,
        project_id: draft?.project_id,
        site_code: draft?.site_code,
        display_name: draft?.display_name?.trim() || draft?.hospital_name?.trim(),
        hospital_name: draft?.hospital_name,
        research_registry_enabled: draft?.research_registry_enabled,
        reviewer_notes: draft?.reviewer_notes,
      });
      await refreshWorkspace();
      if (response.created_site?.site_id) {
        onSelectSite(response.created_site.site_id);
        setToast({
          tone: "success",
          message: copy.requestReviewedAndSiteCreated(getSiteDisplayName(response.created_site, response.created_site.site_id)),
        });
      } else {
        setToast({ tone: "success", message: copy.requestReviewed(decision) });
      }
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.unableReview) });
    }
  }

  async function handleInstitutionSync() {
    if (!canManagePlatform || institutionSyncBusy) {
      return;
    }
    setInstitutionSyncBusy(true);
    try {
      const result = await syncInstitutionDirectory(token, { page_size: 100 });
      await refreshWorkspace();
      setToast({
        tone: "success",
        message: copy.institutionSyncSucceeded(result.institutions_synced, result.pages_synced),
      });
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.institutionSyncFailed) });
    } finally {
      setInstitutionSyncBusy(false);
    }
  }

  async function handleInitialTraining() {
    if (!selectedSiteId) {
      setToast({ tone: "error", message: copy.selectSiteForInitial });
      return;
    }
    setInitialBusy(true);
    setInitialJob(null);
    try {
      const started = await runInitialTraining(selectedSiteId, token, initialForm);
      setInitialJob(started.job);
      let latestJob = started.job;
      while (latestJob.status === "queued" || latestJob.status === "running") {
        await sleep(1000);
        latestJob = await fetchSiteJob(selectedSiteId, latestJob.job_id, token);
        setInitialJob(latestJob);
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
        architectures: BENCHMARK_ARCHITECTURES,
        execution_mode: initialForm.execution_mode,
        crop_mode: initialForm.crop_mode,
        epochs: initialForm.epochs,
        learning_rate: initialForm.learning_rate,
        batch_size: initialForm.batch_size,
        val_split: initialForm.val_split,
        test_split: initialForm.test_split,
        use_pretrained: initialForm.use_pretrained,
        regenerate_split: initialForm.regenerate_split,
      });
      setBenchmarkJob(started.job);
      let latestJob = started.job;
      while (latestJob.status === "queued" || latestJob.status === "running") {
        await sleep(1000);
        latestJob = await fetchSiteJob(selectedSiteId, latestJob.job_id, token);
        setBenchmarkJob(latestJob);
      }
      if (latestJob.status === "failed") {
        throw new Error(latestJob.result?.error || pick(locale, "Five-model initial training failed.", "5종 순차 초기 학습에 실패했습니다."));
      }
      const result = latestJob.result?.response;
      if (!result || !("results" in result)) {
        throw new Error(pick(locale, "Five-model initial training result is missing.", "5종 순차 초기 학습 결과가 없습니다."));
      }
      setBenchmarkResult(result);
      await refreshWorkspace(true);
      setSection("registry");
      setToast({
        tone: "success",
        message: pick(locale, `Five-model initial training completed for ${result.results.length} architecture(s).`, `${result.results.length}개 아키텍처의 5종 순차 초기 학습이 완료되었습니다.`),
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, pick(locale, "Five-model initial training failed.", "5종 순차 초기 학습에 실패했습니다.")),
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
      const started = await runCrossValidation(selectedSiteId, token, crossValidationForm);
      setCrossValidationJob(started.job);
      let latestJob = started.job;
      while (latestJob.status === "queued" || latestJob.status === "running") {
        await sleep(1000);
        latestJob = await fetchSiteJob(selectedSiteId, latestJob.job_id, token);
        setCrossValidationJob(latestJob);
      }
      if (latestJob.status === "failed") {
        throw new Error(latestJob.result?.error || copy.crossValidationFailed);
      }
      const result = latestJob.result?.response;
      if (!result || !("report" in result)) {
        throw new Error(copy.crossValidationMissingResult);
      }
      setCrossValidationReports((current) => [result.report, ...current.filter((item) => item.cross_validation_id !== result.report.cross_validation_id)]);
      setSelectedReportId(result.report.cross_validation_id);
      setToast({ tone: "success", message: copy.savedReport(result.report.cross_validation_id) });
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.crossValidationFailed) });
    } finally {
      setCrossValidationBusy(false);
    }
  }

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
      let latestJob = started.job;
      while (latestJob.status === "queued" || latestJob.status === "running") {
        await sleep(1000);
        latestJob = await fetchSiteJob(selectedSiteId, latestJob.job_id, token);
      }
      if (latestJob.status === "failed") {
        throw new Error(latestJob.result?.error || pick(locale, "Hospital validation failed.", "병원 검증에 실패했습니다."));
      }
      const result = latestJob.result?.response;
      if (!result || !("summary" in result)) {
        throw new Error(pick(locale, "Hospital validation finished without a saved report.", "병원 검증이 끝났지만 저장된 리포트를 받지 못했습니다."));
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

  async function handleAggregation(updateIds: string[] = []) {
    setAggregationBusy(true);
    try {
      const result = await runFederatedAggregation(token, {
        update_ids: updateIds,
        new_version_name: newVersionName.trim() || undefined,
      });
      setNewVersionName("");
      await refreshWorkspace();
      setSection("registry");
      setToast({ tone: "success", message: copy.createdVersion(result.aggregation.new_version_name) });
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.aggregationFailed) });
    } finally {
      setAggregationBusy(false);
    }
  }

  async function handleDeleteModelVersion(version: ModelVersionRecord) {
    const confirmed = window.confirm(pick(locale, `Delete model ${version.version_name}?`, `${version.version_name} 모델을 삭제할까요?`));
    if (!confirmed) {
      return;
    }
    try {
      await deleteModelVersion(version.version_id, token);
      await refreshWorkspace();
      setToast({ tone: "success", message: copy.modelDeleted(version.version_name) });
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.modelDeleteFailed) });
    }
  }

  async function handleAggregationAllReady() {
    const readyLanes = buildReadyAggregationLanes(modelUpdates);
    if (readyLanes.length === 0) {
      setToast({ tone: "error", message: copy.noReadyAggregationLanes });
      return;
    }
    setAggregationBusy(true);
    let completedCount = 0;
    try {
      for (const lane of readyLanes) {
        const laneVersionName =
          newVersionName.trim().length > 0
            ? readyLanes.length === 1
              ? newVersionName.trim()
              : `${newVersionName.trim()}-${lane.architecture}`
            : undefined;
        await runFederatedAggregation(token, {
          update_ids: lane.update_ids,
          new_version_name: laneVersionName,
        });
        completedCount += 1;
      }
      setNewVersionName("");
      await refreshWorkspace();
      setSection("registry");
      setToast({ tone: "success", message: copy.createdBatchVersions(completedCount) });
    } catch (nextError) {
      await refreshWorkspace();
      setSection("registry");
      if (completedCount > 0) {
        setToast({
          tone: "error",
          message: copy.batchAggregationPartialFailed(completedCount, describeError(nextError, copy.aggregationFailed)),
        });
      } else {
        setToast({ tone: "error", message: describeError(nextError, copy.aggregationFailed) });
      }
    } finally {
      setAggregationBusy(false);
    }
  }

  async function handlePublishModelVersion(version: ModelVersionRecord) {
    const setCurrent = window.confirm(copy.modelPublishConfirmCurrent(version.version_name));
    setPublishingModelVersionId(version.version_id);
    try {
      if (autoPublishEnabled) {
        await autoPublishModelVersion(version.version_id, token, {
          set_current: setCurrent,
        });
      } else {
        const initialUrl = String(version.download_url ?? "").trim();
        const nextUrl = window.prompt(copy.modelPublishPrompt(version.version_name), initialUrl);
        if (!nextUrl || !nextUrl.trim()) {
          return;
        }
        await publishModelVersion(version.version_id, token, {
          download_url: nextUrl.trim(),
          set_current: setCurrent,
        });
      }
      await refreshWorkspace();
      setToast({ tone: "success", message: copy.modelPublished(version.version_name) });
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.modelPublishFailed) });
    } finally {
      setPublishingModelVersionId(null);
    }
  }

  async function handleModelUpdateReview(decision: "approved" | "rejected") {
    if (!selectedModelUpdate) {
      return;
    }
    try {
      await reviewModelUpdate(selectedModelUpdate.update_id, token, {
        decision,
        reviewer_notes: state.modelUpdateReviewNotes[selectedModelUpdate.update_id] ?? "",
      });
      await refreshWorkspace();
      setToast({ tone: "success", message: copy.updateReviewed(decision) });
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.updateReviewFailed) });
    }
  }

  async function handlePublishModelUpdate() {
    if (!selectedModelUpdate) {
      return;
    }
    setPublishingModelUpdateId(selectedModelUpdate.update_id);
    try {
      if (autoPublishEnabled) {
        await autoPublishModelUpdate(selectedModelUpdate.update_id, token);
      } else {
        const initialUrl = String(selectedModelUpdate.artifact_download_url ?? "").trim();
        const nextUrl = window.prompt(copy.updatePublishPrompt(selectedModelUpdate.update_id), initialUrl);
        if (!nextUrl || !nextUrl.trim()) {
          return;
        }
        await publishModelUpdate(selectedModelUpdate.update_id, token, {
          download_url: nextUrl.trim(),
        });
      }
      await refreshWorkspace();
      setToast({ tone: "success", message: copy.updatePublished(selectedModelUpdate.update_id) });
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.updatePublishFailed) });
    } finally {
      setPublishingModelUpdateId(null);
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
      const result = await runBulkImport(selectedSiteId, token, { csvFile: bulkCsvFile, files: state.bulkFiles });
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

  async function handleCreateProject() {
    if (!projectForm.name.trim()) {
      setToast({ tone: "error", message: copy.projectNameRequired });
      return;
    }
    try {
      const createdProject = await createProject(token, projectForm);
      setProjectForm({ name: "", description: "" });
      setSiteForm((current) => ({ ...current, project_id: createdProject.project_id }));
      await refreshWorkspace();
      setToast({ tone: "success", message: copy.projectRegistered });
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.unableCreateProject) });
    }
  }

  function handleResetSiteForm(projectId = siteForm.project_id || projects[0]?.project_id || "") {
    setEditingSiteId(null);
    setSiteForm(createSiteForm(projectId));
  }

  function handleEditSite(site: ManagedSiteRecord) {
    setEditingSiteId(site.site_id);
    setSiteForm({
      project_id: site.project_id,
      site_code: site.site_id,
      display_name: site.display_name,
      hospital_name: site.hospital_name ?? "",
      research_registry_enabled: site.research_registry_enabled ?? true,
      source_institution_id: site.source_institution_id ?? undefined,
    });
  }

  async function handleCreateSite() {
    const effectiveProjectId = siteForm.project_id || projects[0]?.project_id || "";
    const normalizedDisplayName = siteForm.display_name.trim() || siteForm.hospital_name.trim();
    if (!effectiveProjectId || !siteForm.site_code.trim() || !siteForm.hospital_name.trim()) {
      setToast({ tone: "error", message: copy.siteFieldsRequired });
      return;
    }
    try {
      const createdSite = await createAdminSite(token, {
        ...siteForm,
        project_id: effectiveProjectId,
        display_name: normalizedDisplayName,
      });
      handleResetSiteForm(effectiveProjectId);
      await onRefreshSites();
      await refreshWorkspace();
      onSelectSite(createdSite.site_id);
      setToast({ tone: "success", message: copy.siteRegistered(getSiteDisplayName(createdSite, createdSite.site_id)) });
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.unableCreateSite) });
    }
  }

  async function handleUpdateSite() {
    const normalizedDisplayName = siteForm.display_name.trim() || siteForm.hospital_name.trim();
    if (!editingSiteId || !siteForm.hospital_name.trim()) {
      setToast({ tone: "error", message: copy.siteNameRequired });
      return;
    }
    try {
      const updatedSite = await updateAdminSite(editingSiteId, token, {
        display_name: normalizedDisplayName,
        hospital_name: siteForm.hospital_name,
        research_registry_enabled: siteForm.research_registry_enabled,
      });
      handleResetSiteForm(updatedSite.project_id);
      await onRefreshSites();
      await refreshWorkspace();
      onSelectSite(updatedSite.site_id);
      setToast({ tone: "success", message: copy.siteUpdated(getSiteDisplayName(updatedSite, updatedSite.site_id)) });
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.unableUpdateSite) });
    }
  }

  async function handleSaveStorageRoot() {
    if (!instanceStorageRootForm.trim()) {
      setToast({ tone: "error", message: copy.unableSaveStorageRoot });
      return;
    }
    setStorageSettingsBusy(true);
    try {
      const nextSettings = await updateStorageSettings(token, { storage_root: instanceStorageRootForm });
      setStorageSettings(nextSettings);
      await refreshWorkspace();
      setToast({ tone: "success", message: copy.storageRootSaved });
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.unableSaveStorageRoot) });
    } finally {
      setStorageSettingsBusy(false);
    }
  }

  async function handleSaveSelectedSiteStorageRoot() {
    if (!selectedSiteId) {
      setToast({ tone: "error", message: copy.selectSiteForStorageRoot });
      return;
    }
    if (!siteStorageRootForm.trim()) {
      setToast({ tone: "error", message: copy.unableSaveSelectedSiteStorageRoot });
      return;
    }
    setStorageSettingsBusy(true);
    try {
      await updateAdminSiteStorageRoot(selectedSiteId, token, { storage_root: siteStorageRootForm });
      await refreshWorkspace();
      setToast({ tone: "success", message: copy.selectedSiteStorageRootSaved(selectedSiteLabel || selectedSiteId) });
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.unableSaveSelectedSiteStorageRoot) });
    } finally {
      setStorageSettingsBusy(false);
    }
  }

  async function handleMigrateSelectedSiteStorageRoot() {
    if (!selectedSiteId) {
      setToast({ tone: "error", message: copy.selectSiteForStorageRoot });
      return;
    }
    if (!siteStorageRootForm.trim()) {
      setToast({ tone: "error", message: copy.unableMigrateSelectedSiteStorageRoot });
      return;
    }
    setStorageSettingsBusy(true);
    try {
      await migrateAdminSiteStorageRoot(selectedSiteId, token, { storage_root: siteStorageRootForm });
      await refreshWorkspace(true);
      setToast({ tone: "success", message: copy.selectedSiteStorageMigrated(selectedSiteLabel || selectedSiteId) });
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.unableMigrateSelectedSiteStorageRoot) });
    } finally {
      setStorageSettingsBusy(false);
    }
  }

  function handleResetUserForm() {
    setUserForm(createUserForm());
  }

  async function handleSaveUser() {
    if (!userForm.username.trim()) {
      setToast({ tone: "error", message: copy.usernameRequired });
      return;
    }
    if (userForm.role !== "admin" && userForm.site_ids.length === 0) {
      setToast({ tone: "error", message: copy.assignSiteRequired });
      return;
    }
    try {
      await upsertManagedUser(token, userForm);
      handleResetUserForm();
      await refreshWorkspace();
      setToast({ tone: "success", message: copy.userSaved });
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.unableSaveUser) });
    }
  }

  async function handleSaveSite() {
    if (editingSiteId) {
      await handleUpdateSite();
      return;
    }
    await handleCreateSite();
  }

  return {
    handleInstitutionSync,
    handleReview,
    handleInitialTraining,
    handleBenchmarkTraining,
    handleCrossValidation,
    handleSiteValidation,
    handleRefreshEmbeddingStatus,
    handleEmbeddingBackfill,
    handleExportValidationReport,
    handleExportCrossValidationReport,
    handleAggregation,
    handleAggregationAllReady,
    handleDeleteModelVersion,
    handlePublishModelVersion,
    handleModelUpdateReview,
    handlePublishModelUpdate,
    handleDownloadImportTemplate,
    handleBulkImport,
    handleCreateProject,
    handleEditSite,
    handleResetSiteForm,
    handleSaveSite,
    handleSaveStorageRoot,
    handleSaveSelectedSiteStorageRoot,
    handleMigrateSelectedSiteStorageRoot,
    handleResetUserForm,
    handleSaveUser,
  };
}
