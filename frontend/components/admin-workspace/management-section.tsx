"use client";

import { useDeferredValue, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Field } from "../ui/field";
import { MetricGrid, MetricItem } from "../ui/metric-grid";
import { SectionHeader } from "../ui/section-header";
import { docSectionLabelClass, docSiteBadgeClass, emptySurfaceClass } from "../ui/workspace-patterns";
import { searchPublicInstitutions, type ManagedSiteRecord, type ManagedUserRecord, type ProjectRecord, type PublicInstitutionRecord, type RetainedCaseArchiveRecord, type SiteSummary, type StorageSettingsRecord } from "../../lib/api";
import { pick, translateApiError, translateRole, type Locale } from "../../lib/i18n";
import { filterVisibleSiteIds, filterVisibleSites, getSiteAlias, getSiteDisplayName } from "../../lib/site-labels";
import { toStorageRootDisplayPath } from "../../lib/storage-paths";
import { DesktopDiagnosticsPanel } from "./desktop-diagnostics-panel";
import { DesktopReleasePanel } from "./desktop-release-panel";
import type { SiteFormState } from "./use-admin-workspace-state";

type UserFormState = {
  user_id?: string;
  username: string;
  full_name: string;
  password: string;
  role: string;
  site_ids: string[];
};

type Props = {
  token: string;
  locale: Locale;
  notAvailableLabel: string;
  canManagePlatform: boolean;
  canManageStorageRoot: boolean;
  storageSettings: StorageSettingsRecord | null;
  storageSettingsBusy: boolean;
  metadataRecoveryBusy: boolean;
  institutionSyncBusy: boolean;
  instanceStorageRootForm: string;
  siteStorageRootForm: string;
  selectedSiteLabel: string | null;
  selectedManagedSite: ManagedSiteRecord | null;
  summary: SiteSummary | null;
  projects: ProjectRecord[];
  managedSites: ManagedSiteRecord[];
  managedUsers: ManagedUserRecord[];
  retainedCaseArchive: RetainedCaseArchiveRecord[];
  retainedCaseArchiveBusy: boolean;
  retainedCaseRestoreBusyKey: string | null;
  siteForm: SiteFormState;
  editingSiteId: string | null;
  projectForm: { name: string; description: string };
  userForm: UserFormState;
  setInstanceStorageRootForm: Dispatch<SetStateAction<string>>;
  setSiteStorageRootForm: Dispatch<SetStateAction<string>>;
  setProjectForm: Dispatch<SetStateAction<{ name: string; description: string }>>;
  setSiteForm: Dispatch<SetStateAction<SiteFormState>>;
  setUserForm: Dispatch<SetStateAction<UserFormState>>;
  formatDateTime: (value: string | null | undefined, emptyLabel?: string) => string;
  onSaveStorageRoot: () => void;
  onSaveSelectedSiteStorageRoot: () => void;
  onMigrateSelectedSiteStorageRoot: () => void;
  onRecoverSelectedSiteMetadata: () => void;
  onRefreshRetainedCaseArchive: () => void;
  onRestoreRetainedCase: (patientId: string, visitDate: string, mode: "visit" | "images") => void;
  onInstitutionSync: () => void;
  onCreateProject: () => void;
  onEditSite: (site: ManagedSiteRecord) => void;
  onResetSiteForm: () => void;
  onSaveSite: () => void;
  onResetUserForm: () => void;
  onSaveUser: () => void;
  onDeleteUser: (userId: string, username: string) => void;
};

const HIRA_SITE_ID_PATTERN = /^\d{8}$/;

function LoadingMetricValue({ locale }: { locale: Locale }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm font-medium text-muted">
      <span aria-hidden="true" className="h-3.5 w-14 animate-pulse rounded-full bg-border/80" />
      <span>{pick(locale, "Loading...", "불러오는 중...")}</span>
    </span>
  );
}

function SiteRecordCard({
  title,
  subtitle,
  metrics,
  onClick,
}: {
  title: string;
  subtitle?: string;
  metrics: Array<{ label: string; value: string | number }>;
  onClick?: () => void;
}) {
  const content = (
    <Card as="article" variant="nested" className="grid min-w-0 gap-3 border border-border/80 p-4">
      <SectionHeader title={title} titleAs="h4" description={subtitle} />
      <MetricGrid columns={Math.min(Math.max(metrics.length, 1), 3) as 2 | 3}>
        {metrics.map((metric) => (
          <MetricItem key={`${title}-${metric.label}`} value={metric.value} label={metric.label} />
        ))}
      </MetricGrid>
    </Card>
  );

  if (!onClick) {
    return content;
  }

  return (
    <button type="button" className="w-full min-w-0 text-left" onClick={onClick}>
      {content}
    </button>
  );
}

function UserAccessRow({
  locale,
  managedUser,
  onClick,
}: {
  locale: Locale;
  managedUser: ManagedUserRecord;
  onClick: () => void;
}) {
  const rowLabelClass = "shrink-0 text-[0.66rem] font-semibold uppercase tracking-[0.12em] text-muted";
  const rowValueClass = "truncate text-[0.82rem] font-medium text-ink";
  const visibleSiteIds = filterVisibleSiteIds(managedUser.site_ids ?? []);

  return (
    <button
      type="button"
      className="grid min-w-[860px] grid-cols-[minmax(0,1.7fr)_minmax(0,0.85fr)_minmax(0,1.05fr)_minmax(0,0.85fr)] items-center gap-4 rounded-[var(--radius-md)] border border-border/80 bg-white/60 px-4 py-3 text-left transition hover:border-ink/15 hover:bg-white/80 dark:bg-white/4 dark:hover:bg-white/7"
      onClick={onClick}
    >
      <div className="min-w-0 flex items-center gap-2 overflow-hidden">
        <span className="truncate text-[0.88rem] font-semibold text-ink">{managedUser.username}</span>
        <span className="shrink-0 text-[0.72rem] text-muted">/</span>
        <span className="truncate text-[0.78rem] text-muted">{managedUser.full_name}</span>
      </div>
      <div className="min-w-0 flex items-center gap-2 overflow-hidden">
        <span className={rowLabelClass}>{pick(locale, "Role", "역할")}</span>
        <span className={rowValueClass}>{translateRole(locale, managedUser.role)}</span>
      </div>
      <div className="min-w-0 flex items-center gap-2 overflow-hidden">
        <span className={rowLabelClass}>{pick(locale, "Hospitals", "병원")}</span>
        <span className={rowValueClass}>{visibleSiteIds.join(", ") || pick(locale, "All", "전체")}</span>
      </div>
      <div className="min-w-0 flex items-center gap-2 overflow-hidden">
        <span className={rowLabelClass}>{pick(locale, "Approval", "승인 상태")}</span>
        <span className={rowValueClass}>{managedUser.approval_status}</span>
      </div>
    </button>
  );
}

function siteHiraCode(site: ManagedSiteRecord, notAvailableLabel: string): string {
  if (HIRA_SITE_ID_PATTERN.test(site.site_id)) {
    return site.site_id;
  }
  if (HIRA_SITE_ID_PATTERN.test(String(site.source_institution_id ?? ""))) {
    return String(site.source_institution_id);
  }
  return notAvailableLabel;
}

function normalizeComparableText(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function linkedInstitutionHiraCode(
  siteForm: SiteFormState,
  editingSiteId: string | null,
  managedSites: ManagedSiteRecord[],
): string | null {
  if (HIRA_SITE_ID_PATTERN.test(String(siteForm.source_institution_id ?? ""))) {
    return String(siteForm.source_institution_id);
  }
  if (editingSiteId && HIRA_SITE_ID_PATTERN.test(editingSiteId)) {
    return editingSiteId;
  }
  const normalizedSourceInstitutionId = String(siteForm.source_institution_id ?? "").trim();
  const normalizedHospitalName = normalizeComparableText(siteForm.hospital_name);
  const normalizedInstitutionName = normalizeComparableText(siteForm.source_institution_name);
  const matchedSite = managedSites.find((site) => {
    if (editingSiteId && site.site_id === editingSiteId) {
      return true;
    }
    if (normalizedSourceInstitutionId && String(site.source_institution_id ?? "").trim() === normalizedSourceInstitutionId) {
      return true;
    }
    if (normalizedInstitutionName && normalizeComparableText(site.source_institution_name) === normalizedInstitutionName) {
      return true;
    }
    if (normalizedHospitalName && normalizeComparableText(site.hospital_name) === normalizedHospitalName) {
      return true;
    }
    return false;
  });
  if (matchedSite) {
    if (HIRA_SITE_ID_PATTERN.test(matchedSite.site_id)) {
      return matchedSite.site_id;
    }
    if (HIRA_SITE_ID_PATTERN.test(String(matchedSite.source_institution_id ?? ""))) {
      return String(matchedSite.source_institution_id);
    }
  }
  return null;
}

function joinStorageRoot(root: string | null | undefined, siteId: string | null | undefined): string | null {
  const normalizedRoot = String(root ?? "").trim().replace(/[\\/]+$/, "");
  const normalizedSiteId = String(siteId ?? "").trim().replace(/^[\\/]+/, "");
  if (!normalizedRoot || !normalizedSiteId) {
    return null;
  }
  const separator = normalizedRoot.includes("\\") ? "\\" : "/";
  return `${normalizedRoot}${separator}${normalizedSiteId}`;
}

function normalizeStoragePath(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .replace(/[\\/]+/g, "\\")
    .replace(/\\$/, "")
    .toLowerCase();
}

export function ManagementSection({
  token,
  locale,
  notAvailableLabel,
  canManagePlatform,
  canManageStorageRoot,
  storageSettings,
  storageSettingsBusy,
  metadataRecoveryBusy,
  institutionSyncBusy,
  instanceStorageRootForm,
  siteStorageRootForm,
  selectedSiteLabel,
  selectedManagedSite,
  summary,
  projects,
  managedSites,
  managedUsers,
  retainedCaseArchive,
  retainedCaseArchiveBusy,
  retainedCaseRestoreBusyKey,
  siteForm,
  editingSiteId,
  projectForm,
  userForm,
  setInstanceStorageRootForm,
  setSiteStorageRootForm,
  setProjectForm,
  setSiteForm,
  setUserForm,
  formatDateTime,
  onSaveStorageRoot,
  onSaveSelectedSiteStorageRoot,
  onMigrateSelectedSiteStorageRoot,
  onRecoverSelectedSiteMetadata,
  onRefreshRetainedCaseArchive,
  onRestoreRetainedCase,
  onInstitutionSync,
  onCreateProject,
  onEditSite,
  onResetSiteForm,
  onSaveSite,
  onResetUserForm,
  onSaveUser,
  onDeleteUser,
}: Props) {
  const hospitalHasData = Boolean(summary && (summary.n_patients > 0 || summary.n_visits > 0 || summary.n_images > 0));
  const visibleManagedSites = filterVisibleSites(managedSites);
  const storageSettingsLoading = storageSettingsBusy && !storageSettings;
  const storageLoadingLabel = pick(locale, "Loading...", "불러오는 중...");
  const storageRootSource = storageSettings?.storage_root_source ?? (storageSettings?.uses_custom_root ? "custom" : "built_in_default");
  const effectiveDefaultStorageRoot = storageSettings?.effective_default_storage_root ?? storageSettings?.default_storage_root ?? null;
  const defaultStorageRootDisplay = toStorageRootDisplayPath(storageSettings?.default_storage_root);
  const effectiveDefaultStorageRootDisplay = toStorageRootDisplayPath(effectiveDefaultStorageRoot);
  const activeStorageRootDisplay = toStorageRootDisplayPath(storageSettings?.storage_root);
  const instanceStorageRootPlaceholder =
    activeStorageRootDisplay ||
    effectiveDefaultStorageRootDisplay ||
    (storageSettingsLoading ? pick(locale, "Loading active root...", "활성 경로를 불러오는 중...") : "");
  const hasEnvironmentDefaultOverride = Boolean(
    storageSettings?.default_storage_root &&
      effectiveDefaultStorageRoot &&
      normalizeStoragePath(storageSettings.default_storage_root) !== normalizeStoragePath(effectiveDefaultStorageRoot)
  );
  const [institutionQuery, setInstitutionQuery] = useState("");
  const [institutionResults, setInstitutionResults] = useState<PublicInstitutionRecord[]>([]);
  const [institutionSearchBusy, setInstitutionSearchBusy] = useState(false);
  const [institutionSearchError, setInstitutionSearchError] = useState<string | null>(null);
  const deferredInstitutionQuery = useDeferredValue(institutionQuery);
  const institutionSearchResetKeyRef = useRef(0);
  const normalizedInstitutionQuery = institutionQuery.trim();
  const linkedHiraCode = linkedInstitutionHiraCode(siteForm, editingSiteId, visibleManagedSites);
  const linkedInstitutionLabel = siteForm.source_institution_name || siteForm.hospital_name || "HIRA";
  const linkedInstitutionSummary = [linkedInstitutionLabel, linkedHiraCode ? `HIRA ${linkedHiraCode}` : null]
    .filter(Boolean)
    .join(" - ");
  const linkedInstitutionCardTitle = [linkedInstitutionSummary, siteForm.source_institution_address || null]
    .filter(Boolean)
    .join(" - ");
  const inheritedSelectedSiteStorageRoot = selectedManagedSite
    ? joinStorageRoot(storageSettings?.storage_root, selectedManagedSite.site_id)
    : null;
  const selectedSiteCurrentStorageRoot = selectedManagedSite
    ? String(selectedManagedSite.local_storage_root ?? "").trim() || inheritedSelectedSiteStorageRoot
    : null;
  const selectedSiteResolvedStorageRoot = selectedManagedSite
    ? String(storageSettings?.selected_site_storage_root ?? "").trim() || selectedSiteCurrentStorageRoot
    : null;
  const selectedSiteUsesPinnedStorageRoot = Boolean(
    selectedManagedSite &&
      selectedSiteCurrentStorageRoot &&
      inheritedSelectedSiteStorageRoot &&
      normalizeStoragePath(selectedSiteCurrentStorageRoot) !== normalizeStoragePath(inheritedSelectedSiteStorageRoot)
  );

  const [userInstitutionQuery, setUserInstitutionQuery] = useState("");
  const [userInstitutionResults, setUserInstitutionResults] = useState<PublicInstitutionRecord[]>([]);
  const [userInstitutionSearchBusy, setUserInstitutionSearchBusy] = useState(false);
  const [userInstitutionSearchError, setUserInstitutionSearchError] = useState<string | null>(null);
  const deferredUserInstitutionQuery = useDeferredValue(userInstitutionQuery);
  const userInstitutionSearchResetKeyRef = useRef(0);

  function resetInstitutionSearch() {
    institutionSearchResetKeyRef.current += 1;
    setInstitutionQuery("");
    setInstitutionResults([]);
    setInstitutionSearchBusy(false);
    setInstitutionSearchError(null);
  }

  function resetUserInstitutionSearch() {
    userInstitutionSearchResetKeyRef.current += 1;
    setUserInstitutionQuery("");
    setUserInstitutionResults([]);
    setUserInstitutionSearchBusy(false);
    setUserInstitutionSearchError(null);
  }

  useEffect(() => {
    if (!canManagePlatform) {
      setInstitutionResults([]);
      setInstitutionSearchBusy(false);
      setInstitutionSearchError(null);
      return;
    }
    const query = deferredInstitutionQuery.trim();
    if (query.length < 2) {
      setInstitutionResults([]);
      setInstitutionSearchBusy(false);
      setInstitutionSearchError(null);
      return;
    }
    let cancelled = false;
    const searchResetKey = institutionSearchResetKeyRef.current;
    setInstitutionSearchBusy(true);
    setInstitutionSearchError(null);
    void searchPublicInstitutions(query, { limit: 8 })
      .then((items) => {
        if (!cancelled && searchResetKey === institutionSearchResetKeyRef.current) {
          setInstitutionResults(items);
        }
      })
      .catch((nextError) => {
        if (!cancelled && searchResetKey === institutionSearchResetKeyRef.current) {
          setInstitutionSearchError(
            nextError instanceof Error
              ? translateApiError(locale, nextError.message)
              : pick(locale, "Unable to search institutions.", "기관 검색에 실패했습니다."),
          );
        }
      })
      .finally(() => {
        if (!cancelled && searchResetKey === institutionSearchResetKeyRef.current) {
          setInstitutionSearchBusy(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canManagePlatform, deferredInstitutionQuery, locale]);

  useEffect(() => {
    const query = deferredUserInstitutionQuery.trim();
    if (query.length < 2) {
      setUserInstitutionResults([]);
      setUserInstitutionSearchBusy(false);
      setUserInstitutionSearchError(null);
      return;
    }
    let cancelled = false;
    const searchResetKey = userInstitutionSearchResetKeyRef.current;
    setUserInstitutionSearchBusy(true);
    setUserInstitutionSearchError(null);
    void searchPublicInstitutions(query, { limit: 8 })
      .then((items) => {
        if (!cancelled && searchResetKey === userInstitutionSearchResetKeyRef.current) {
          setUserInstitutionResults(items);
        }
      })
      .catch((nextError) => {
        if (!cancelled && searchResetKey === userInstitutionSearchResetKeyRef.current) {
          setUserInstitutionSearchError(
            nextError instanceof Error
              ? translateApiError(locale, nextError.message)
              : pick(locale, "Unable to search institutions.", "기관 검색에 실패했습니다."),
          );
        }
      })
      .finally(() => {
        if (!cancelled && searchResetKey === userInstitutionSearchResetKeyRef.current) {
          setUserInstitutionSearchBusy(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [deferredUserInstitutionQuery, locale]);

  const archiveLoadingLabel = pick(locale, "Loading retained cases...", "보존 케이스를 불러오는 중...");

  return (
    <Card as="section" variant="surface" className="grid gap-5 p-6">
      <SectionHeader
        eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Management", "관리")}</div>}
        title={pick(locale, "Workspace, hospitals, and users", "워크스페이스, 병원, 사용자 관리")}
        titleAs="h3"
        description={pick(
          locale,
          "Manage the fixed workspace project, hospital identities, storage roots, and user access from one administrative document.",
          "고정된 워크스페이스 프로젝트, 병원 정보, 저장 경로, 사용자 접근 권한을 하나의 운영 문서에서 관리합니다."
        )}
        aside={<span className={docSiteBadgeClass}>{translateRole(locale, canManagePlatform ? "admin" : "site_admin")}</span>}
      />

      <DesktopDiagnosticsPanel
        token={token}
        locale={locale}
        formatDateTime={formatDateTime}
        selectedManagedSite={selectedManagedSite}
        selectedSiteLabel={selectedSiteLabel}
      />

      {canManagePlatform ? <DesktopReleasePanel token={token} locale={locale} /> : null}

      {canManageStorageRoot ? (
        <div className="grid gap-4">
          <Card as="section" variant="nested" className="grid gap-4 p-5">
            <SectionHeader
              title={pick(locale, "Default storage root", "기본 저장 경로")}
              titleAs="h4"
              aside={
                <span className={docSiteBadgeClass}>
                  {storageSettingsLoading
                    ? storageLoadingLabel
                    : storageRootSource === "custom"
                    ? pick(locale, "Custom", "사용자 지정")
                    : storageRootSource === "environment_default"
                      ? pick(locale, "Environment", "환경설정")
                      : pick(locale, "Default", "기본값")}
                </span>
              }
            />
            <Field label={pick(locale, "Folder path", "폴더 경로")}>
              <input
                value={instanceStorageRootForm}
                onChange={(event) => setInstanceStorageRootForm(event.target.value)}
                placeholder={instanceStorageRootPlaceholder}
                disabled={storageSettingsLoading}
                aria-busy={storageSettingsLoading}
              />
            </Field>
            <div className="text-sm leading-6 text-muted">
              {pick(
                locale,
                "Enter either the KERA_DATA folder or the direct site-root folder. If you provide KERA_DATA, the app will use its sites subfolder automatically.",
                "KERA_DATA 폴더 또는 사이트 폴더들의 상위 경로를 입력하세요. KERA_DATA를 입력하면 앱이 자동으로 그 안의 sites 하위 폴더를 사용합니다."
              )}
            </div>
            <MetricGrid columns={hasEnvironmentDefaultOverride ? 3 : 2}>
              <MetricItem
                value={storageSettingsLoading ? <LoadingMetricValue locale={locale} /> : defaultStorageRootDisplay || notAvailableLabel}
                label={pick(locale, "Built-in default", "내장 기본 경로")}
              />
              {hasEnvironmentDefaultOverride ? (
                <MetricItem
                  value={storageSettingsLoading ? <LoadingMetricValue locale={locale} /> : effectiveDefaultStorageRootDisplay || notAvailableLabel}
                  label={pick(locale, "Environment default", "환경설정 기본 경로")}
                />
              ) : null}
              <MetricItem
                value={storageSettingsLoading ? <LoadingMetricValue locale={locale} /> : activeStorageRootDisplay || notAvailableLabel}
                label={pick(locale, "Active root", "활성 경로")}
              />
            </MetricGrid>
            <div className="text-sm leading-6 text-muted">
              {pick(
                locale,
                "The active root above is the configured storage path. If you enter KERA_DATA, the app resolves its sites subfolder internally. The selected hospital's actual folder is shown in the metadata card below.",
                "위의 활성 경로는 앱에 표시하는 기본 저장 경로입니다. KERA_DATA를 입력한 경우 앱은 내부적으로 그 안의 sites 하위 폴더를 사용합니다. 현재 선택한 병원의 실제 폴더는 아래 메타데이터 카드에 표시합니다."
              )}
            </div>
            {storageRootSource === "custom" ? (
              <div className="text-sm leading-6 text-muted">
                {pick(
                  locale,
                  hasEnvironmentDefaultOverride
                    ? "A custom active root is in use. The built-in fallback and the environment-provided default are shown separately for reference."
                    : "A custom active root is in use. The built-in fallback remains available if you switch back.",
                  hasEnvironmentDefaultOverride
                    ? "현재는 사용자 지정 활성 경로를 사용 중입니다. 설치 위치 기준 내장 기본 경로와 환경설정 기본 경로를 참고용으로 함께 표시합니다."
                    : "현재는 사용자 지정 활성 경로를 사용 중입니다. 기본값으로 되돌리면 설치 위치 기준 내장 기본 경로를 사용합니다."
                )}
              </div>
            ) : storageRootSource === "environment_default" ? (
              <div className="text-sm leading-6 text-muted">
                {pick(
                  locale,
                  "This node is using an environment-provided default root. The built-in fallback is the install-relative location shown separately above.",
                  "현재 이 노드는 환경설정으로 지정된 기본 경로를 사용 중입니다. 설치 위치 기준 내장 fallback 경로는 위에 별도로 표시합니다."
                )}
              </div>
            ) : null}
            <div className="flex flex-wrap justify-end gap-3">
              <Button
                type="button"
                variant="ghost"
                disabled={storageSettingsLoading || !storageSettings?.default_storage_root}
                onClick={() => setInstanceStorageRootForm(toStorageRootDisplayPath(storageSettings?.default_storage_root))}
              >
                {pick(locale, "Use built-in default", "기본 경로 사용")}
              </Button>
              <Button type="button" variant="primary" loading={storageSettingsBusy} disabled={storageSettingsLoading} onClick={onSaveStorageRoot}>
                {pick(locale, "Save default root", "기본 경로 저장")}
              </Button>
            </div>
          </Card>

          <Card as="section" variant="nested" className="grid gap-4 p-5">
            <SectionHeader
              title={pick(locale, "Selected hospital metadata", "선택 병원 메타데이터")}
              titleAs="h4"
              aside={<span className={docSiteBadgeClass}>{selectedSiteLabel ?? notAvailableLabel}</span>}
            />
            {selectedManagedSite ? (
              <>
                <div className="text-sm leading-6 text-muted">
                  {pick(
                    locale,
                    "If files still exist under this hospital root but the patient, visit, or image rows are missing, rebuild them from metadata_backup.json first and fall back to dataset_manifest.csv when needed.",
                    "이 병원 폴더 아래 파일은 남아 있는데 patient, visit, image row가 비어 있으면 metadata_backup.json을 우선 사용하고 필요하면 dataset_manifest.csv로 내려가며 다시 구성합니다.",
                  )}
                </div>
                <MetricGrid columns={3}>
                  <MetricItem value={summary?.n_patients ?? 0} label={pick(locale, "Patients", "환자")} />
                  <MetricItem value={summary?.n_visits ?? 0} label={pick(locale, "Visits", "방문")} />
                  <MetricItem value={summary?.n_images ?? 0} label={pick(locale, "Images", "이미지")} />
                </MetricGrid>
                <div className="grid gap-2">
                  <div className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-muted">
                    {pick(locale, "Active data folder", "실제 데이터 폴더")}
                  </div>
                  <div className="rounded-[16px] border border-border/80 bg-white/65 px-4 py-3 font-mono text-sm leading-6 text-ink break-all dark:bg-white/4">
                    {storageSettingsLoading ? pick(locale, "Loading active root...", "활성 경로를 불러오는 중...") : selectedSiteResolvedStorageRoot ?? notAvailableLabel}
                  </div>
                </div>
                <div className="rounded-[16px] border border-amber-300/70 bg-amber-50/80 px-4 py-3 text-sm leading-6 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                  {pick(
                    locale,
                    "Recovery replaces the existing metadata rows for this hospital, then rewrites the manifest and metadata backup using the current storage path.",
                    "복구를 실행하면 현재 병원의 메타데이터 row를 교체한 뒤, 현재 저장 경로 기준으로 manifest와 metadata backup을 다시 씁니다.",
                  )}
                </div>
                <div className="flex flex-wrap justify-end gap-3">
                  <Button type="button" variant="danger" loading={metadataRecoveryBusy} onClick={onRecoverSelectedSiteMetadata}>
                    {pick(locale, "Recover metadata", "메타데이터 복구")}
                  </Button>
                </div>
              </>
            ) : (
              <div className={emptySurfaceClass}>
                {pick(
                  locale,
                  "Choose a hospital from the rail before running metadata recovery.",
                  "메타데이터 복구를 실행하려면 먼저 좌측에서 병원을 선택하세요.",
                )}
              </div>
            )}
          </Card>

          <Card as="section" variant="nested" className="grid gap-4 p-5">
            <SectionHeader
              title={pick(locale, "Retained case restore", "보존 케이스 복구")}
              titleAs="h4"
              description={pick(
                locale,
                "Federated-retained cases stay hidden instead of being hard-deleted. Restore the whole visit or just hidden images from this archive.",
                "연합학습 보존 케이스는 완전 삭제 대신 숨김 처리됩니다. 이 보관함에서 방문 전체 또는 숨겨진 이미지만 다시 복구할 수 있습니다."
              )}
              aside={
                <div className="flex flex-wrap items-center gap-2">
                  <span className={docSiteBadgeClass}>{selectedSiteLabel ?? notAvailableLabel}</span>
                  <Button type="button" variant="ghost" size="sm" disabled={retainedCaseArchiveBusy || !selectedManagedSite} onClick={onRefreshRetainedCaseArchive}>
                    {retainedCaseArchiveBusy ? pick(locale, "Refreshing...", "새로고침 중...") : pick(locale, "Refresh", "새로고침")}
                  </Button>
                </div>
              }
            />
            {!selectedManagedSite ? (
              <div className={emptySurfaceClass}>
                {pick(
                  locale,
                  "Choose a hospital from the rail before reviewing retained-case recovery options.",
                  "보존 케이스 복구를 검토하려면 먼저 왼쪽 레일에서 병원을 선택하세요."
                )}
              </div>
            ) : retainedCaseArchiveBusy && retainedCaseArchive.length === 0 ? (
              <div className={emptySurfaceClass}>{archiveLoadingLabel}</div>
            ) : retainedCaseArchive.length === 0 ? (
              <div className={emptySurfaceClass}>
                {pick(
                  locale,
                  "No retained case is waiting for restore at this hospital.",
                  "현재 병원에는 복구 대기 중인 보존 케이스가 없습니다."
                )}
              </div>
            ) : (
              <div className="grid gap-3">
                {retainedCaseArchive.map((item) => {
                  const caseLabel = item.local_case_code || item.chart_alias || item.patient_id;
                  const restoreVisitBusy = retainedCaseRestoreBusyKey === `${item.patient_id}:${item.visit_date}:visit`;
                  const restoreImagesBusy = retainedCaseRestoreBusyKey === `${item.patient_id}:${item.visit_date}:images`;
                  const anyRestoreBusy = retainedCaseRestoreBusyKey !== null;
                  return (
                    <Card key={`${item.patient_id}:${item.visit_date}`} as="article" variant="nested" className="grid gap-3 border border-border/80 p-4">
                      <SectionHeader
                        title={caseLabel}
                        titleAs="h4"
                        description={`${item.patient_id} / ${item.visit_date}`}
                        aside={
                          <div className="flex flex-wrap gap-2">
                            <span className={docSiteBadgeClass}>
                              {item.can_restore_visit
                                ? pick(locale, "Visit archived", "방문 숨김")
                                : pick(locale, "Images archived", "이미지 숨김")}
                            </span>
                            <span className={docSiteBadgeClass}>{item.culture_status || "unknown"}</span>
                          </div>
                        }
                      />
                      <MetricGrid columns={4}>
                        <MetricItem value={item.total_image_count} label={pick(locale, "Total images", "전체 이미지")} />
                        <MetricItem value={item.visible_image_count} label={pick(locale, "Visible", "보이는 수")} />
                        <MetricItem value={item.soft_deleted_image_count} label={pick(locale, "Hidden", "숨김 수")} />
                        <MetricItem value={formatDateTime(item.fl_retained_at, notAvailableLabel)} label={pick(locale, "Retained", "보존 시각")} />
                      </MetricGrid>
                      <div className="flex flex-wrap gap-2 text-xs leading-5 text-muted">
                        {item.culture_category ? <span className={docSiteBadgeClass}>{item.culture_category}</span> : null}
                        {item.culture_species ? <span className={docSiteBadgeClass}>{item.culture_species}</span> : null}
                        {item.fl_retention_scopes.length ? <span className={docSiteBadgeClass}>{item.fl_retention_scopes.join(", ")}</span> : null}
                      </div>
                      <div className="text-sm leading-6 text-muted">
                        {item.can_restore_visit
                          ? pick(
                              locale,
                              "The visit row is hidden and all archived images will come back together when you restore the visit.",
                              "이 방문 row가 숨겨진 상태이며, 방문을 복구하면 보관된 이미지도 함께 다시 표시됩니다."
                            )
                          : pick(
                              locale,
                              "The visit is still visible, but some images are hidden for federated-retention safety.",
                              "방문은 보이지만 연합학습 보존 정책 때문에 일부 이미지가 숨겨져 있습니다."
                            )}
                      </div>
                      <div className="flex flex-wrap justify-end gap-3">
                        {item.can_restore_images ? (
                          <Button
                            type="button"
                            variant="ghost"
                            disabled={anyRestoreBusy}
                            loading={restoreImagesBusy}
                            onClick={() => onRestoreRetainedCase(item.patient_id, item.visit_date, "images")}
                          >
                            {pick(locale, "Restore images", "이미지 복구")}
                          </Button>
                        ) : null}
                        {item.can_restore_visit ? (
                          <Button
                            type="button"
                            variant="primary"
                            disabled={anyRestoreBusy}
                            loading={restoreVisitBusy}
                            onClick={() => onRestoreRetainedCase(item.patient_id, item.visit_date, "visit")}
                          >
                            {pick(locale, "Restore visit", "방문 복구")}
                          </Button>
                        ) : null}
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </Card>

          {false ? (
            <Card as="section" variant="nested" className="grid gap-4 p-5">
            <SectionHeader
              title={pick(locale, "Selected hospital storage root", "선택 병원 저장 경로")}
              titleAs="h4"
              aside={<span className={docSiteBadgeClass}>{selectedSiteLabel ?? notAvailableLabel}</span>}
            />
            {selectedManagedSite ? (
              <>
                <Field label={pick(locale, "Folder path", "폴더 경로")}>
                  <input value={siteStorageRootForm} onChange={(event) => setSiteStorageRootForm(event.target.value)} placeholder="D:\HospitalAData\39100103" />
                </Field>
                <MetricGrid columns={selectedSiteUsesPinnedStorageRoot ? 3 : 2}>
                  <MetricItem value={selectedSiteCurrentStorageRoot ?? notAvailableLabel} label={pick(locale, "Current root", "현재 경로")} />
                  {selectedSiteUsesPinnedStorageRoot ? (
                    <MetricItem
                      value={inheritedSelectedSiteStorageRoot ?? notAvailableLabel}
                      label={pick(locale, "Active default would be", "활성 기본 경로 기준")}
                    />
                  ) : null}
                  <MetricItem
                    value={`${summary?.n_patients ?? notAvailableLabel}/${summary?.n_visits ?? notAvailableLabel}/${summary?.n_images ?? notAvailableLabel}`}
                    label={pick(locale, "Patients / visits / images", "환자 / 방문 / 이미지")}
                  />
                </MetricGrid>
                {selectedSiteUsesPinnedStorageRoot ? (
                  <div className="rounded-[16px] border border-amber-300/45 bg-amber-50/80 px-4 py-3 text-sm leading-6 text-[rgb(120,74,31)] dark:border-amber-200/20 dark:bg-[rgba(120,74,31,0.16)] dark:text-[rgba(255,232,204,0.92)]">
                    {pick(
                      locale,
                      "This hospital is pinned to its own storage root, so it does not currently follow the active default root.",
                      "이 병원은 개별 저장 경로에 고정되어 있어 현재 활성 기본 경로를 따라가지 않습니다."
                    )}
                  </div>
                ) : null}
                <div className="text-sm leading-6 text-muted">
                  {pick(
                    locale,
                    "Before any patient data exists, the root can be reassigned directly. After data exists, use migration so files move safely.",
                    "데이터가 없을 때는 경로를 바로 바꿀 수 있고, 데이터가 있으면 안전하게 이동하도록 migration을 사용해야 합니다."
                  )}
                </div>
                <div className="flex flex-wrap justify-end gap-3">
                  <Button type="button" variant="ghost" onClick={() => setSiteStorageRootForm(selectedManagedSite?.local_storage_root ?? "")}>
                    {pick(locale, "Reset", "초기화")}
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    loading={storageSettingsBusy}
                    disabled={hospitalHasData}
                    onClick={onSaveSelectedSiteStorageRoot}
                  >
                    {pick(locale, "Save hospital root", "병원 경로 저장")}
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    loading={storageSettingsBusy}
                    disabled={!hospitalHasData}
                    onClick={onMigrateSelectedSiteStorageRoot}
                  >
                    {pick(locale, "Migrate existing data", "기존 데이터 이동")}
                  </Button>
                </div>
              </>
            ) : (
              <div className={emptySurfaceClass}>
                {pick(locale, "Select a hospital to review or change its storage path.", "병원을 선택하면 저장 경로를 검토하거나 변경할 수 있습니다.")}
              </div>
            )}
            </Card>
          ) : null}
        </div>
      ) : null}

      {canManagePlatform ? (
        <>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card as="section" variant="nested" className="grid gap-4 p-5">
              <SectionHeader
                title={pick(locale, "Workspace project", "워크스페이스 프로젝트")}
                titleAs="h4"
                description={pick(
                  locale,
                  "K-ERA currently runs on a single fixed project. New hospitals are attached to this default workspace automatically.",
                  "K-ERA는 현재 단일 고정 프로젝트로 운영됩니다. 새 병원은 이 기본 워크스페이스에 자동 연결됩니다."
                )}
                aside={<span className={docSiteBadgeClass}>{projects.length}</span>}
              />
              {projects.length === 0 ? (
                <div className={emptySurfaceClass}>{pick(locale, "No workspace project is available yet.", "아직 워크스페이스 프로젝트가 없습니다.")}</div>
              ) : (
                <div className="grid gap-3">
                  {projects.map((project) => (
                    <SiteRecordCard
                      key={project.project_id}
                      title={project.name}
                      subtitle={project.description || project.project_id}
                      metrics={[
                        { label: pick(locale, "Project ID", "프로젝트 ID"), value: project.project_id },
                        { label: pick(locale, "Hospitals", "병원"), value: project.site_ids.length },
                        { label: pick(locale, "Created", "생성 시각"), value: formatDateTime(project.created_at, notAvailableLabel) },
                      ]}
                    />
                  ))}
                </div>
              )}
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card as="section" variant="nested" className="grid gap-4 p-5">
              <SectionHeader title={pick(locale, "Hospitals", "병원")} titleAs="h4" aside={<span className={docSiteBadgeClass}>{visibleManagedSites.length}</span>} />
              {visibleManagedSites.length === 0 ? (
                <div className={emptySurfaceClass}>{pick(locale, "No hospital is visible to this account.", "이 계정에서 볼 수 있는 병원이 없습니다.")}</div>
              ) : (
                <div className="grid gap-3">
                  {visibleManagedSites.map((site) => (
                    <SiteRecordCard
                      key={site.site_id}
                      title={getSiteDisplayName(site, pick(locale, "No hospital name", "병원명 없음"))}
                      subtitle={getSiteAlias(site) ?? undefined}
                      metrics={[
                        { label: pick(locale, "HIRA code", "HIRA 코드"), value: siteHiraCode(site, notAvailableLabel) },
                        { label: pick(locale, "Project", "프로젝트"), value: site.project_id },
                        { label: pick(locale, "Created", "생성 시각"), value: formatDateTime(site.created_at, notAvailableLabel) },
                      ]}
                      onClick={() => onEditSite(site)}
                    />
                  ))}
                </div>
              )}
            </Card>

            <Card as="section" variant="nested" className="grid gap-4 p-5">
              <SectionHeader
                title={editingSiteId ? pick(locale, "Edit hospital", "병원 수정") : pick(locale, "Register hospital", "병원 등록")}
                titleAs="h4"
                description={
                  editingSiteId
                    ? pick(
                        locale,
                        `Editing ${siteForm.hospital_name || editingSiteId}`,
                        `${siteForm.hospital_name || editingSiteId} 수정 중`,
                      )
                    : pick(locale, "Registering a new hospital", "새 병원 등록")
                }
              />
              <Card as="section" variant="nested" className="grid gap-3 border border-border/80 p-4">
                <SectionHeader
                  title={pick(locale, "Official institution search (HIRA)", "공식 기관 검색 (HIRA)")}
                  titleAs="h4"
                  description={pick(
                    locale,
                    "Search the synced ophthalmology directory and prefill a new hospital registration from an official institution.",
                    "동기화된 안과 기관 디렉터리를 검색해서 공식 기관 정보로 새 병원 등록 폼을 채울 수 있습니다.",
                  )}
                  aside={
                    canManagePlatform ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        loading={institutionSyncBusy}
                        onClick={onInstitutionSync}
                      >
                        {pick(locale, "Sync HIRA directory", "HIRA 디렉터리 동기화")}
                      </Button>
                    ) : null
                  }
                />
                <Field
                  label={pick(locale, "Institution keyword", "기관 검색어")}
                  hint={pick(
                    locale,
                    "Try Jeju, Seoul, Kim's Eye, or a hospital name. Selecting a result prepares a new site draft.",
                    "제주, 서울, 김안과, 병원명 등을 검색하세요. 결과를 선택하면 새 site 초안이 채워집니다.",
                  )}
                >
                  <input
                    value={institutionQuery}
                    onChange={(event) => setInstitutionQuery(event.target.value)}
                    placeholder={pick(locale, "Jeju, Seoul, Kim's Eye...", "제주, 서울, 김안과...")}
                  />
                </Field>
                {institutionSearchBusy ? (
                  <div className="rounded-[18px] border border-border/80 bg-surface-muted/80 px-4 py-3 text-sm text-muted">
                    {pick(locale, "Searching institutions...", "기관 검색 중...")}
                  </div>
                ) : null}
                {institutionSearchError ? (
                  <div className="rounded-[18px] border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
                    {institutionSearchError}
                  </div>
                ) : null}
                {normalizedInstitutionQuery.length >= 2 && !institutionSearchBusy && !institutionSearchError ? (
                  institutionResults.length > 0 ? (
                    <div className="grid gap-2">
                      {institutionResults.map((institution) => {
                        const linkedSite =
                          visibleManagedSites.find((site) => site.source_institution_id === institution.institution_id) ?? null;
                        return (
                          <Card key={institution.institution_id} as="article" variant="nested" className="grid gap-3 border border-border/80 p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="grid gap-1">
                                <strong className="text-sm font-semibold text-ink">{institution.name}</strong>
                                <div className="text-xs leading-5 text-muted">
                                  {[institution.institution_type_name, institution.address].filter(Boolean).join(" / ")}
                                </div>
                              </div>
                              {linkedSite ? (
                                <span className={docSiteBadgeClass}>
                                  {pick(
                                    locale,
                                    `Linked to ${getSiteDisplayName(linkedSite)}`,
                                    `${getSiteDisplayName(linkedSite)}에 연결됨`,
                                  )}
                                </span>
                              ) : null}
                            </div>
                            <div className="flex flex-wrap justify-end gap-3">
                              {linkedSite ? (
                                <Button type="button" variant="ghost" onClick={() => onEditSite(linkedSite)}>
                                  {pick(locale, "Open linked site", "연결된 site 열기")}
                                </Button>
                              ) : (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={() => {
                                    const effectiveProjectId = siteForm.project_id || projects[0]?.project_id || "";
                                    setSiteForm((current) => ({
                                      ...current,
                                      project_id: current.project_id || effectiveProjectId,
                                      hospital_name: institution.name,
                                      source_institution_id: institution.institution_id,
                                      source_institution_name: institution.name,
                                      source_institution_address: institution.address || undefined,
                                    }));
                                    resetInstitutionSearch();
                                  }}
                                >
                                  {pick(locale, "Select this hospital", "이 병원으로 선택")}
                                </Button>
                              )}
                            </div>
                          </Card>
                        );
                      })}
                    </div>
                  ) : (
                    <div className={emptySurfaceClass}>
                      {pick(locale, "No synced institution matched this search yet.", "동기화된 기관 목록에서 일치하는 결과가 없습니다.")}
                    </div>
                  )
                ) : null}
              </Card>
              <Field
                label={pick(locale, "Hospital", "병원명")}
                hint={pick(
                  locale,
                  "This is filled automatically from the selected HIRA institution and stays read-only.",
                  "선택한 HIRA 기관명을 자동으로 채우며, 이 값은 수정할 수 없습니다.",
                )}
              >
                <div className="rounded-[var(--radius-md)] border border-border bg-white/55 px-3.5 py-3 text-sm font-semibold text-ink dark:bg-white/4">
                  {siteForm.hospital_name || pick(locale, "Select a HIRA institution first.", "먼저 HIRA 기관을 선택하세요.")}
                </div>
              </Field>
              <Field
                as="div"
                label={pick(locale, "Linked HIRA institution", "연결된 HIRA 기관")}
                hint={pick(
                  locale,
                  "The official institution mapping is shown as read-only chips.",
                  "공식 기관 연결 정보는 읽기 전용 칩으로 표시됩니다.",
                )}
              >
                {siteForm.source_institution_id ? (
                  <div className="grid gap-3 rounded-[18px] border border-brand/20 bg-brand-soft/60 px-4 py-3 text-sm text-ink">
                    <div className="min-w-0">
                      <span
                        title={linkedInstitutionCardTitle}
                        className={`${docSiteBadgeClass} flex w-full min-w-0 justify-start overflow-hidden text-ellipsis whitespace-nowrap`}
                      >
                        {linkedInstitutionSummary}
                        {siteForm.source_institution_address ? ` - ${siteForm.source_institution_address}` : ""}
                      </span>
                    </div>
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setSiteForm((current) => ({
                            ...current,
                            hospital_name: "",
                            source_institution_id: undefined,
                            source_institution_name: undefined,
                            source_institution_address: undefined,
                          }))
                        }
                      >
                        {pick(locale, "Clear mapping", "연결 해제")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className={emptySurfaceClass}>
                    {pick(
                      locale,
                      "Search and select a HIRA institution to link this hospital.",
                      "이 병원을 연결할 HIRA 기관을 검색해서 선택하세요.",
                    )}
                  </div>
                )}
              </Field>
              <Field
                as="div"
                label={pick(locale, "Research registry", "연구 레지스트리")}
                hint={pick(
                  locale,
                  "Enable the site-level registry policy used by K-ERA researchers after a separate one-time opt-in.",
                  "연구자가 별도의 1회 가입 후 사용할 수 있는 사이트 단위 연구 레지스트리 정책을 활성화합니다."
                )}
              >
                <div className="grid gap-3">
                  <label className="inline-flex min-h-12 cursor-pointer items-center gap-3 rounded-[var(--radius-md)] border border-border bg-white/55 px-3.5 py-2.5 text-sm text-ink dark:bg-white/4">
                    <input
                      type="checkbox"
                      checked={siteForm.research_registry_enabled}
                      onChange={(event) =>
                        setSiteForm((current) => ({ ...current, research_registry_enabled: event.target.checked }))
                      }
                    />
                    <span>{pick(locale, "Enable research registry for this hospital", "이 병원의 연구 레지스트리 활성화")}</span>
                  </label>
                  <div className="rounded-[16px] border border-border/80 bg-surface-muted/70 px-4 py-4 text-sm leading-6 text-muted">
                    <p className="m-0">
                      {pick(
                        locale,
                        "This is not a patient consent form. It is the registry explanation shown to K-ERA researchers and institution users at this hospital.",
                        "이 문구는 환자 동의서가 아니라, 이 병원에서 K-ERA를 사용하는 연구자와 기관 사용자에게 보여주는 연구 레지스트리 설명입니다."
                      )}
                    </p>
                    <p className="mb-0 mt-3">
                      {pick(
                        locale,
                        "If enabled, users who complete a separate one-time registry opt-in can allow eligible analysed cases from this hospital to flow into the multicenter registry and model validation or improvement studies using pseudonymized research data.",
                        "활성화하면, 별도의 1회 레지스트리 가입을 완료한 사용자는 이 병원에서 분석한 적격 케이스의 가명처리 연구데이터를 다기관 레지스트리와 모델 검증·개선 연구에 포함할 수 있습니다."
                      )}
                    </p>
                    <ul className="mb-0 mt-3 grid gap-1.5 pl-5">
                      <li>
                        {pick(
                          locale,
                          "The central registry stores case_reference_id instead of raw patient identifiers.",
                          "중앙 레지스트리에는 raw patient ID 대신 case_reference_id가 저장됩니다."
                        )}
                      </li>
                      <li>
                        {pick(
                          locale,
                          "Exact calendar visit dates are not stored centrally; visit labels are used instead.",
                          "정확한 방문일은 중앙에 저장하지 않고 방문 라벨만 사용합니다."
                        )}
                      </li>
                      <li>
                        {pick(
                          locale,
                          "Original images and source records remain in the institution-local workspace.",
                          "원본 이미지와 원자료 기록은 기관 내부 워크스페이스에 남습니다."
                        )}
                      </li>
                      <li>
                        {pick(
                          locale,
                          "Each case can still be reviewed later as Included or Excluded and opted out individually when needed.",
                          "각 케이스는 이후 Included / Excluded 상태로 확인할 수 있고 필요하면 개별 제외할 수 있습니다."
                        )}
                      </li>
                    </ul>
                  </div>
                </div>
              </Field>
              <div className="flex flex-wrap justify-end gap-3">
                <Button type="button" variant="ghost" onClick={onResetSiteForm}>
                  {pick(locale, "Reset", "초기화")}
                </Button>
                <Button type="button" variant="primary" onClick={onSaveSite}>
                  {editingSiteId ? pick(locale, "Save hospital", "병원 저장") : pick(locale, "Register hospital", "병원 등록")}
                </Button>
              </div>
            </Card>
          </div>

          <Card as="section" variant="nested" className="grid gap-4 p-5">
            <SectionHeader title={pick(locale, "Users and access", "사용자 및 접근 권한")} titleAs="h4" aside={<span className={docSiteBadgeClass}>{managedUsers.length}</span>} />
            {managedUsers.length === 0 ? (
              <div className={emptySurfaceClass}>{pick(locale, "No user record has been created yet.", "아직 생성된 사용자 레코드가 없습니다.")}</div>
            ) : (
              <div className="overflow-x-auto">
                <div className="grid gap-2">
                {managedUsers.map((managedUser) => (
                  <UserAccessRow
                    key={managedUser.user_id}
                    locale={locale}
                    managedUser={managedUser}
                    onClick={() => {
                      resetUserInstitutionSearch();
                      setUserForm({
                        user_id: managedUser.user_id,
                        username: managedUser.username,
                        full_name: managedUser.full_name,
                        password: "",
                        role: managedUser.role,
                        site_ids: filterVisibleSiteIds(managedUser.site_ids ?? []),
                      });
                    }}
                  />
                ))}
                </div>
              </div>
            )}

            <div className="grid gap-4 xl:grid-cols-2">
              <Field label={pick(locale, "Username", "아이디")}>
                <input value={userForm.username} onChange={(event) => setUserForm((current) => ({ ...current, username: event.target.value }))} />
              </Field>
              <Field label={pick(locale, "Full name", "이름")}>
                <input value={userForm.full_name} onChange={(event) => setUserForm((current) => ({ ...current, full_name: event.target.value }))} />
              </Field>
              <Field label={pick(locale, "Password", "비밀번호")}>
                <input
                  type="password"
                  value={userForm.password}
                  onChange={(event) => setUserForm((current) => ({ ...current, password: event.target.value }))}
                  placeholder={pick(locale, "Leave blank to keep existing password", "기존 비밀번호를 유지하려면 비워두세요")}
                />
              </Field>
              <Field label={pick(locale, "Role", "역할")}>
                <select value={userForm.role} onChange={(event) => setUserForm((current) => ({ ...current, role: event.target.value }))}>
                  <option value="admin">{translateRole(locale, "admin")}</option>
                  <option value="site_admin">{translateRole(locale, "site_admin")}</option>
                  <option value="researcher">{translateRole(locale, "researcher")}</option>
                  <option value="viewer">{translateRole(locale, "viewer")}</option>
                </select>
              </Field>
            </div>
            <Field
              label={pick(locale, "Accessible hospitals", "접근 가능한 병원")}
              hint={pick(locale, "Use Ctrl/Cmd + click to select multiple hospitals.", "여러 병원을 선택하려면 Ctrl/Cmd + 클릭을 사용하세요.")}
            >
              <select
                multiple
                value={userForm.site_ids}
                onChange={(event) =>
                  setUserForm((current) => ({
                    ...current,
                    site_ids: Array.from(event.target.selectedOptions, (option) => option.value),
                  }))
                }
              >
                {visibleManagedSites.map((site) => (
                  <option key={site.site_id} value={site.site_id}>
                    {getSiteDisplayName(site)}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={pick(locale, "Search hospital (HIRA)", "병원 검색 (HIRA)")}
              hint={pick(locale, "Search and click to add a hospital to the accessible list.", "병원을 검색하고 클릭하면 접근 가능 목록에 추가됩니다.")}
            >
              <input
                value={userInstitutionQuery}
                onChange={(event) => setUserInstitutionQuery(event.target.value)}
                placeholder={pick(locale, "Hospital name or HIRA code...", "병원명 또는 HIRA 코드...")}
              />
            </Field>
            {userInstitutionSearchBusy && (
              <div className="text-sm text-muted">{pick(locale, "Searching...", "검색 중...")}</div>
            )}
            {userInstitutionSearchError && (
              <div className="text-sm text-error">{userInstitutionSearchError}</div>
            )}
            {userInstitutionResults.length > 0 && (
              <div className="grid gap-1">
                {userInstitutionResults.map((institution) => {
                  const matchedSite = visibleManagedSites.find(
                    (site) =>
                      site.site_id === institution.institution_id ||
                      String(site.source_institution_id ?? "") === institution.institution_id,
                  );
                  const isAlreadyAdded = matchedSite ? userForm.site_ids.includes(matchedSite.site_id) : false;
                  return (
                    <button
                      key={institution.institution_id}
                      type="button"
                      disabled={!matchedSite || isAlreadyAdded}
                      className="grid min-w-0 gap-0.5 rounded-[var(--radius-md)] border border-border/80 bg-white/60 px-3 py-2 text-left text-sm transition hover:border-ink/15 hover:bg-white/80 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white/4 dark:hover:bg-white/7"
                      onClick={() => {
                        if (!matchedSite || isAlreadyAdded) return;
                        setUserForm((current) => ({
                          ...current,
                          site_ids: [...current.site_ids, matchedSite.site_id],
                        }));
                        resetUserInstitutionSearch();
                      }}
                    >
                      <span className="font-medium text-ink">{institution.name}</span>
                      <span className="text-[0.75rem] text-muted">
                        {[`HIRA ${institution.institution_id}`, institution.address].filter(Boolean).join(" · ")}
                        {!matchedSite && ` · ${pick(locale, "Not registered", "미등록")}`}
                        {isAlreadyAdded && ` · ${pick(locale, "Already added", "이미 추가됨")}`}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex flex-wrap justify-end gap-3">
              <Button type="button" variant="ghost" onClick={() => { onResetUserForm(); resetUserInstitutionSearch(); }}>
                {pick(locale, "Reset", "초기화")}
              </Button>
              {userForm.user_id && (
                <Button type="button" variant="danger" onClick={() => onDeleteUser(userForm.user_id!, userForm.username)}>
                  {pick(locale, "Delete user", "사용자 삭제")}
                </Button>
              )}
              <Button type="button" variant="primary" onClick={onSaveUser}>
                {pick(locale, "Save user", "사용자 저장")}
              </Button>
            </div>
          </Card>
        </>
      ) : (
        <Card as="section" variant="nested" className="grid gap-4 p-5">
          <SectionHeader title={pick(locale, "Hospitals", "병원")} titleAs="h4" aside={<span className={docSiteBadgeClass}>{visibleManagedSites.length}</span>} />
          {visibleManagedSites.length === 0 ? (
            <div className={emptySurfaceClass}>{pick(locale, "No hospital is visible to this account.", "이 계정에서 볼 수 있는 병원이 없습니다.")}</div>
          ) : (
            <div className="grid gap-3">
              {visibleManagedSites.map((site) => (
                <SiteRecordCard
                  key={site.site_id}
                  title={getSiteDisplayName(site, pick(locale, "No hospital name", "병원명 없음"))}
                  subtitle={getSiteAlias(site) ?? undefined}
                  metrics={[
                    { label: pick(locale, "HIRA code", "HIRA 코드"), value: siteHiraCode(site, notAvailableLabel) },
                    { label: pick(locale, "Project", "프로젝트"), value: site.project_id },
                    { label: pick(locale, "Created", "생성 시각"), value: formatDateTime(site.created_at, notAvailableLabel) },
                  ]}
                />
              ))}
            </div>
          )}
        </Card>
      )}
    </Card>
  );
}
