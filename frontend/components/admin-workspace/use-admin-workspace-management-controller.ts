"use client";

import { useEffect } from "react";

import { getSiteDisplayName } from "../../lib/site-labels";
import {
  createAdminSite,
  createProject,
  deleteManagedUser,
  fetchAccessRequests,
  fetchInstitutionDirectoryStatus,
  fetchStorageSettings,
  fetchUsers,
  migrateAdminSiteStorageRoot,
  recoverAdminSiteMetadata,
  reviewAccessRequest,
  syncInstitutionDirectory,
  updateAdminSite,
  updateAdminSiteStorageRoot,
  updateStorageSettings,
  upsertManagedUser,
  type ManagedSiteRecord,
} from "../../lib/api";
import { toStorageRootDisplayPath } from "../../lib/storage-paths";
import { createSiteForm, createUserForm, useAdminWorkspaceState } from "./use-admin-workspace-state";

type AdminWorkspaceState = ReturnType<typeof useAdminWorkspaceState>;

type ManagementControllerCopy = {
  unableReview: string;
  requestReviewed: (decision: "approved" | "rejected") => string;
  requestReviewedAndSiteCreated: (siteLabel: string) => string;
  institutionSyncSucceeded: (count: number, pages?: number | null) => string;
  institutionSyncFailed: string;
  projectNameRequired: string;
  projectRegistered: string;
  unableCreateProject: string;
  siteFieldsRequired: string;
  siteNameRequired: string;
  siteRegistered: (siteLabel: string) => string;
  unableCreateSite: string;
  siteUpdated: (siteLabel: string) => string;
  unableUpdateSite: string;
  storageRootSaved: string;
  unableSaveStorageRoot: string;
  selectedSiteStorageRootSaved: (siteLabel: string) => string;
  unableSaveSelectedSiteStorageRoot: string;
  selectedSiteStorageMigrated: (siteLabel: string) => string;
  unableMigrateSelectedSiteStorageRoot: string;
  selectSiteForMetadataRecovery: string;
  recoverSelectedSiteMetadataConfirm: (siteLabel: string) => string;
  selectedSiteMetadataRecovered: (siteLabel: string, source: string, counts: string) => string;
  unableRecoverSelectedSiteMetadata: string;
  selectSiteForStorageRoot: string;
  usernameRequired: string;
  assignSiteRequired: string;
  userSaved: string;
  unableSaveUser: string;
  unableLoadStorageSettings: string;
  deleteUserConfirm: (username: string) => string;
  userDeleted: (username: string) => string;
  unableDeleteUser: string;
};

type UseAdminWorkspaceManagementControllerOptions = {
  state: AdminWorkspaceState;
  token: string;
  selectedSiteId: string | null;
  selectedSiteLabel: string;
  canManagePlatform: boolean;
  defaultWorkspaceProjectId: string;
  copy: ManagementControllerCopy;
  describeError: (nextError: unknown, fallback: string) => string;
  refreshWorkspace: (siteScoped?: boolean) => Promise<void>;
  onRefreshSites: () => Promise<void>;
  onSelectSite: (siteId: string) => void;
  applyRequestData: (
    nextPendingRequests: AdminWorkspaceState["pendingRequests"],
    nextApprovedRequests: AdminWorkspaceState["pendingRequests"],
    projectIdHint?: string,
  ) => void;
};

export function useAdminWorkspaceManagementController({
  state,
  token,
  selectedSiteId,
  selectedSiteLabel,
  canManagePlatform,
  defaultWorkspaceProjectId,
  copy,
  describeError,
  refreshWorkspace,
  onRefreshSites,
  onSelectSite,
  applyRequestData,
}: UseAdminWorkspaceManagementControllerOptions) {
  const {
    overview,
    section,
    projects,
    pendingRequests,
    reviewDrafts,
    institutionSyncBusy,
    projectForm,
    siteForm,
    editingSiteId,
    userForm,
    storageSettings,
    selectedManagedSite,
    setToast,
    setOverview,
    setPendingRequests,
    setAutoApprovedRequests,
    setReviewDrafts,
    setInstitutionSyncBusy,
    setInstitutionSyncStatus,
    setProjectForm,
    setSiteForm,
    setManagedUsers,
    setStorageSettings,
    setInstanceStorageRootForm,
    setSiteStorageRootForm,
    setEditingSiteId,
    setStorageSettingsBusy,
    setMetadataRecoveryBusy,
    setUserForm,
    setSection,
  } = state;

  async function loadRequestSectionData(projectIdHint?: string) {
    const effectiveProjectId = projectIdHint ?? projects[0]?.project_id ?? defaultWorkspaceProjectId;
    const [nextPendingRequests, nextApprovedRequests, nextInstitutionSyncStatus] = await Promise.all([
      fetchAccessRequests(token, "pending"),
      fetchAccessRequests(token, "approved"),
      fetchInstitutionDirectoryStatus(token),
    ]);
    applyRequestData(nextPendingRequests, nextApprovedRequests, effectiveProjectId);
    setInstitutionSyncStatus(nextInstitutionSyncStatus);
  }

  async function loadManagementSectionData() {
    setStorageSettingsBusy(true);
    try {
      const [nextStorageSettings, nextManagedUsers] = await Promise.all([
        fetchStorageSettings(token),
        canManagePlatform ? fetchUsers(token) : Promise.resolve([]),
      ]);
      setStorageSettings(nextStorageSettings);
      setManagedUsers(nextManagedUsers);
      setInstanceStorageRootForm(toStorageRootDisplayPath(nextStorageSettings.storage_root));
    } finally {
      setStorageSettingsBusy(false);
    }
  }

  useEffect(() => {
    if (!overview || section !== "requests") {
      return;
    }
    let cancelled = false;
    async function loadRequests() {
      try {
        const [nextPendingRequests, nextApprovedRequests, nextInstitutionSyncStatus] = await Promise.all([
          fetchAccessRequests(token, "pending"),
          fetchAccessRequests(token, "approved"),
          fetchInstitutionDirectoryStatus(token),
        ]);
        if (cancelled) {
          return;
        }
        applyRequestData(nextPendingRequests, nextApprovedRequests, projects[0]?.project_id ?? defaultWorkspaceProjectId);
        setInstitutionSyncStatus(nextInstitutionSyncStatus);
      } catch (nextError) {
        if (!cancelled) {
          setToast({ tone: "error", message: describeError(nextError, copy.unableReview) });
        }
      }
    }
    void loadRequests();
    return () => {
      cancelled = true;
    };
  }, [
    applyRequestData,
    copy.unableReview,
    defaultWorkspaceProjectId,
    describeError,
    overview,
    projects,
    section,
    setInstitutionSyncStatus,
    setToast,
    token,
  ]);

  useEffect(() => {
    if (section !== "management") {
      return;
    }
    let cancelled = false;
    async function loadManagement() {
      try {
        setStorageSettingsBusy(true);
        const [nextStorageSettings, nextManagedUsers] = await Promise.all([
          fetchStorageSettings(token),
          canManagePlatform ? fetchUsers(token) : Promise.resolve([]),
        ]);
        if (cancelled) {
          return;
        }
        setStorageSettings(nextStorageSettings);
        setManagedUsers(nextManagedUsers);
        setInstanceStorageRootForm(toStorageRootDisplayPath(nextStorageSettings.storage_root));
      } catch (nextError) {
        if (!cancelled) {
          setToast({ tone: "error", message: describeError(nextError, copy.unableLoadStorageSettings) });
        }
      } finally {
        if (!cancelled) {
          setStorageSettingsBusy(false);
        }
      }
    }
    void loadManagement();
    return () => {
      cancelled = true;
    };
  }, [canManagePlatform, copy.unableLoadStorageSettings, describeError, section, setInstanceStorageRootForm, setManagedUsers, setStorageSettings, setStorageSettingsBusy, setToast, token]);

  useEffect(() => {
    if (storageSettings) {
      setInstanceStorageRootForm(toStorageRootDisplayPath(storageSettings.storage_root));
    }
  }, [setInstanceStorageRootForm, storageSettings]);

  useEffect(() => {
    setSiteStorageRootForm(selectedManagedSite?.local_storage_root ?? "");
  }, [selectedManagedSite?.local_storage_root, selectedManagedSite?.site_id, setSiteStorageRootForm]);

  async function handleReview(requestId: string, decision: "approved" | "rejected") {
    const request = pendingRequests.find((item) => item.request_id === requestId);
    const draft = request ? reviewDrafts[requestId] ?? null : reviewDrafts[requestId] ?? null;
    try {
      const response = await reviewAccessRequest(requestId, token, {
        decision,
        assigned_role: "researcher",
        assigned_site_id: draft?.assigned_site_id,
        create_site_if_missing: draft?.create_site_if_missing,
        hospital_name: draft?.hospital_name,
        research_registry_enabled: draft?.research_registry_enabled,
        reviewer_notes: draft?.reviewer_notes,
      });
      setPendingRequests((current) => current.filter((item) => item.request_id !== requestId));
      setReviewDrafts((current) => {
        if (!(requestId in current)) {
          return current;
        }
        const next = { ...current };
        delete next[requestId];
        return next;
      });
      setOverview((current) =>
        current
          ? {
              ...current,
              pending_access_requests: Math.max(0, Number(current.pending_access_requests ?? 0) - 1),
            }
          : current,
      );
      if (response.created_site?.site_id) {
        onSelectSite(response.created_site.site_id);
        setToast({
          tone: "success",
          message: copy.requestReviewedAndSiteCreated(getSiteDisplayName(response.created_site, response.created_site.site_id)),
        });
      } else {
        setToast({ tone: "success", message: copy.requestReviewed(decision) });
      }
      try {
        await refreshWorkspace();
      } catch {
        // The review already succeeded; ignore follow-up refresh failures.
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
      await onRefreshSites();
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

  function handleResetSiteForm(projectId = siteForm.project_id || projects[0]?.project_id || defaultWorkspaceProjectId) {
    setEditingSiteId(null);
    setSiteForm(createSiteForm(projectId));
  }

  function handleEditSite(site: ManagedSiteRecord) {
    setEditingSiteId(site.site_id);
    setSiteForm({
      project_id: site.project_id,
      hospital_name: site.hospital_name ?? "",
      research_registry_enabled: site.research_registry_enabled ?? true,
      source_institution_id: site.source_institution_id ?? undefined,
      source_institution_name: site.source_institution_name ?? undefined,
      source_institution_address: site.source_institution_address ?? undefined,
    });
  }

  async function handleCreateSite() {
    const effectiveProjectId = siteForm.project_id || projects[0]?.project_id || defaultWorkspaceProjectId;
    if (!String(siteForm.source_institution_id ?? "").trim() || !siteForm.hospital_name.trim()) {
      setToast({ tone: "error", message: copy.siteFieldsRequired });
      return;
    }
    try {
      const createdSite = await createAdminSite(token, {
        project_id: effectiveProjectId,
        hospital_name: siteForm.hospital_name,
        source_institution_id: siteForm.source_institution_id ?? null,
        research_registry_enabled: siteForm.research_registry_enabled,
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
    if (!editingSiteId) {
      setToast({ tone: "error", message: copy.siteNameRequired });
      return;
    }
    if (!String(siteForm.source_institution_id ?? "").trim() || !siteForm.hospital_name.trim()) {
      setToast({ tone: "error", message: copy.siteFieldsRequired });
      return;
    }
    try {
      const updatedSite = await updateAdminSite(editingSiteId, token, {
        hospital_name: siteForm.hospital_name,
        source_institution_id: siteForm.source_institution_id ?? null,
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
    if (!state.instanceStorageRootForm.trim()) {
      setToast({ tone: "error", message: copy.unableSaveStorageRoot });
      return;
    }
    setStorageSettingsBusy(true);
    try {
      const nextSettings = await updateStorageSettings(token, { storage_root: state.instanceStorageRootForm }, selectedSiteId);
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
    if (!state.siteStorageRootForm.trim()) {
      setToast({ tone: "error", message: copy.unableSaveSelectedSiteStorageRoot });
      return;
    }
    setStorageSettingsBusy(true);
    try {
      await updateAdminSiteStorageRoot(selectedSiteId, token, { storage_root: state.siteStorageRootForm });
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
    if (!state.siteStorageRootForm.trim()) {
      setToast({ tone: "error", message: copy.unableMigrateSelectedSiteStorageRoot });
      return;
    }
    setStorageSettingsBusy(true);
    try {
      await migrateAdminSiteStorageRoot(selectedSiteId, token, { storage_root: state.siteStorageRootForm });
      await refreshWorkspace(true);
      setToast({ tone: "success", message: copy.selectedSiteStorageMigrated(selectedSiteLabel || selectedSiteId) });
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.unableMigrateSelectedSiteStorageRoot) });
    } finally {
      setStorageSettingsBusy(false);
    }
  }

  async function handleRecoverSelectedSiteMetadata() {
    if (!selectedSiteId) {
      setToast({ tone: "error", message: copy.selectSiteForMetadataRecovery });
      return;
    }
    const siteLabel = selectedSiteLabel || selectedSiteId;
    const confirmed = window.confirm(copy.recoverSelectedSiteMetadataConfirm(siteLabel));
    if (!confirmed) {
      return;
    }
    setMetadataRecoveryBusy(true);
    try {
      const result = await recoverAdminSiteMetadata(selectedSiteId, token, {
        source: "auto",
        force_replace: true,
      });
      await refreshWorkspace(true);
      setSection("dashboard");
      setToast({
        tone: "success",
        message: copy.selectedSiteMetadataRecovered(
          siteLabel,
          result.source,
          `${result.restored_patients}/${result.restored_visits}/${result.restored_images}`,
        ),
      });
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.unableRecoverSelectedSiteMetadata) });
    } finally {
      setMetadataRecoveryBusy(false);
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

  async function handleDeleteUser(userId: string, username: string) {
    const confirmed = window.confirm(copy.deleteUserConfirm(username));
    if (!confirmed) {
      return;
    }
    try {
      await deleteManagedUser(userId, token);
      handleResetUserForm();
      setManagedUsers((current) => current.filter((u) => u.user_id !== userId));
      setToast({ tone: "success", message: copy.userDeleted(username) });
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.unableDeleteUser) });
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
    loadRequestSectionData,
    loadManagementSectionData,
    handleReview,
    handleInstitutionSync,
    handleCreateProject,
    handleEditSite,
    handleResetSiteForm,
    handleSaveSite,
    handleSaveStorageRoot,
    handleSaveSelectedSiteStorageRoot,
    handleMigrateSelectedSiteStorageRoot,
    handleRecoverSelectedSiteMetadata,
    handleResetUserForm,
    handleSaveUser,
    handleDeleteUser,
  };
}
