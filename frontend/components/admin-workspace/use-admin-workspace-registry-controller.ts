"use client";

import { useEffect, useRef } from "react";

import { pick, type Locale } from "../../lib/i18n";
import {
  activateLocalModelVersion,
  autoPublishModelUpdate,
  autoPublishModelVersion,
  deleteModelVersion,
  fetchAggregations,
  fetchModelUpdateArtifactBlob,
  fetchModelUpdates,
  fetchModelVersions,
  publishModelUpdate,
  publishModelVersion,
  reviewModelUpdate,
  runFederatedAggregation,
  type ModelUpdateRecord,
  type ModelVersionRecord,
} from "../../lib/api";
import { useAdminWorkspaceState } from "./use-admin-workspace-state";

type AdminWorkspaceState = ReturnType<typeof useAdminWorkspaceState>;

type RegistryControllerCopy = {
  updateReviewFailed: string;
  aggregationFailed: string;
  createdVersion: (name: string) => string;
  noReadyAggregationLanes: string;
  createdBatchVersions: (count: number) => string;
  batchAggregationPartialFailed: (count: number, detail: string) => string;
  modelDeleted: (name: string) => string;
  modelDeleteFailed: string;
  modelActivated: (name: string) => string;
  modelActivateFailed: string;
  modelPublishPrompt: (name: string) => string;
  modelPublishConfirmCurrent: (name: string) => string;
  modelPublished: (name: string) => string;
  modelPublishFailed: string;
  updateReviewed: (decision: "approved" | "rejected") => string;
  updatePublishPrompt: (updateId: string) => string;
  updatePublished: (updateId: string) => string;
  updatePublishFailed: string;
};

type UseAdminWorkspaceRegistryControllerOptions = {
  state: AdminWorkspaceState;
  token: string;
  selectedSiteId: string | null;
  locale: Locale;
  canAggregate: boolean;
  autoPublishEnabled: boolean;
  copy: RegistryControllerCopy;
  describeError: (nextError: unknown, fallback: string) => string;
  refreshWorkspace: (siteScoped?: boolean) => Promise<void>;
  buildReadyAggregationLanes: (
    items: ModelUpdateRecord[],
  ) => Array<{
    architecture: string;
    base_model_version_id: string;
    duplicate_site_count: number;
    update_ids: string[];
  }>;
  applyModelUpdateData: (nextUpdates: ModelUpdateRecord[]) => void;
};

export function useAdminWorkspaceRegistryController({
  state,
  token,
  selectedSiteId,
  locale,
  canAggregate,
  autoPublishEnabled,
  copy,
  describeError,
  refreshWorkspace,
  buildReadyAggregationLanes,
  applyModelUpdateData,
}: UseAdminWorkspaceRegistryControllerOptions) {
  const {
    overview,
    section,
    setSection,
    modelUpdates,
    selectedModelUpdate,
    setToast,
    setModelVersions,
    setAggregations,
    setSelectedModelUpdateId,
    setSelectedUpdatePreviewUrls,
    setPublishingModelVersionId,
    setPublishingModelUpdateId,
    setAggregationBusy,
    newVersionName,
    setNewVersionName,
  } = state;
  const modelUpdatePreviewUrlsRef = useRef<string[]>([]);

  async function loadRegistrySectionData() {
    const [nextVersions, nextUpdates] = await Promise.all([
      fetchModelVersions(token),
      fetchModelUpdates(token, { site_id: selectedSiteId ?? undefined }),
    ]);
    setModelVersions(nextVersions);
    applyModelUpdateData(nextUpdates);
  }

  async function loadFederationSectionData() {
    const [nextUpdates, nextAggregations] = await Promise.all([
      fetchModelUpdates(token, { site_id: selectedSiteId ?? undefined }),
      fetchAggregations(token),
    ]);
    applyModelUpdateData(nextUpdates);
    setAggregations(nextAggregations);
  }

  useEffect(() => {
    return () => {
      for (const url of modelUpdatePreviewUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  useEffect(() => {
    if (!overview || section !== "registry") {
      return;
    }
    let cancelled = false;
    async function loadRegistry() {
      try {
        const [nextVersions, nextUpdates] = await Promise.all([
          fetchModelVersions(token),
          fetchModelUpdates(token, { site_id: selectedSiteId ?? undefined }),
        ]);
        if (cancelled) {
          return;
        }
        setModelVersions(nextVersions);
        applyModelUpdateData(nextUpdates);
      } catch (nextError) {
        if (!cancelled) {
          setToast({ tone: "error", message: describeError(nextError, copy.updateReviewFailed) });
        }
      }
    }
    void loadRegistry();
    return () => {
      cancelled = true;
    };
  }, [applyModelUpdateData, copy.updateReviewFailed, describeError, overview, section, selectedSiteId, setModelVersions, setToast, token]);

  useEffect(() => {
    if (!overview || section !== "federation" || !canAggregate) {
      return;
    }
    let cancelled = false;
    async function loadFederation() {
      try {
        const [nextUpdates, nextAggregations] = await Promise.all([
          fetchModelUpdates(token, { site_id: selectedSiteId ?? undefined }),
          fetchAggregations(token),
        ]);
        if (cancelled) {
          return;
        }
        applyModelUpdateData(nextUpdates);
        setAggregations(nextAggregations);
      } catch (nextError) {
        if (!cancelled) {
          setToast({ tone: "error", message: describeError(nextError, copy.aggregationFailed) });
        }
      }
    }
    void loadFederation();
    return () => {
      cancelled = true;
    };
  }, [applyModelUpdateData, canAggregate, copy.aggregationFailed, describeError, overview, section, selectedSiteId, setAggregations, setToast, token]);

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
  }, [selectedModelUpdate, setSelectedUpdatePreviewUrls, token]);

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

  async function handleActivateLocalModelVersion(version: ModelVersionRecord) {
    setPublishingModelVersionId(version.version_id);
    try {
      await activateLocalModelVersion(version.version_id, token);
      await refreshWorkspace();
      setToast({ tone: "success", message: copy.modelActivated(version.version_name) });
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.modelActivateFailed) });
    } finally {
      setPublishingModelVersionId(null);
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

  return {
    loadRegistrySectionData,
    loadFederationSectionData,
    handleAggregation,
    handleAggregationAllReady,
    handleDeleteModelVersion,
    handleActivateLocalModelVersion,
    handlePublishModelVersion,
    handleModelUpdateReview,
    handlePublishModelUpdate,
  };
}
