"use client";

import { useDeferredValue, useEffect, useState, type Dispatch, type SetStateAction } from "react";

import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Field } from "../ui/field";
import { MetricGrid, MetricItem } from "../ui/metric-grid";
import { SectionHeader } from "../ui/section-header";
import { docSectionLabelClass, docSiteBadgeClass, emptySurfaceClass } from "../ui/workspace-patterns";
import { searchPublicInstitutions, type ManagedSiteRecord, type ManagedUserRecord, type ProjectRecord, type PublicInstitutionRecord, type SiteSummary, type StorageSettingsRecord } from "../../lib/api";
import { pick, translateApiError, translateRole, type Locale } from "../../lib/i18n";
import type { SiteFormState } from "./use-admin-workspace-state";

type UserFormState = {
  username: string;
  full_name: string;
  password: string;
  role: string;
  site_ids: string[];
};

type Props = {
  locale: Locale;
  notAvailableLabel: string;
  canManagePlatform: boolean;
  canManageStorageRoot: boolean;
  storageSettings: StorageSettingsRecord | null;
  storageSettingsBusy: boolean;
  instanceStorageRootForm: string;
  siteStorageRootForm: string;
  selectedSiteId: string | null;
  selectedManagedSite: ManagedSiteRecord | null;
  summary: SiteSummary | null;
  projects: ProjectRecord[];
  managedSites: ManagedSiteRecord[];
  managedUsers: ManagedUserRecord[];
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
  onCreateProject: () => void;
  onEditSite: (site: ManagedSiteRecord) => void;
  onResetSiteForm: () => void;
  onSaveSite: () => void;
  onResetUserForm: () => void;
  onSaveUser: () => void;
};

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

function normalizeSiteCode(value: string) {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}

function suggestedSiteCodeFromInstitution(institution: PublicInstitutionRecord): string {
  const fromName = normalizeSiteCode(institution.name);
  if (fromName) {
    return fromName;
  }
  const fromId = normalizeSiteCode(`HIRA_${institution.institution_id}`);
  if (fromId) {
    return fromId;
  }
  const hash = Array.from(institution.institution_id).reduce(
    (accumulator, char) => ((accumulator * 31) + char.charCodeAt(0)) >>> 0,
    7,
  );
  return `HIRA_${hash.toString(16).toUpperCase()}`.slice(0, 32);
}

export function ManagementSection({
  locale,
  notAvailableLabel,
  canManagePlatform,
  canManageStorageRoot,
  storageSettings,
  storageSettingsBusy,
  instanceStorageRootForm,
  siteStorageRootForm,
  selectedSiteId,
  selectedManagedSite,
  summary,
  projects,
  managedSites,
  managedUsers,
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
  onCreateProject,
  onEditSite,
  onResetSiteForm,
  onSaveSite,
  onResetUserForm,
  onSaveUser,
}: Props) {
  const hospitalHasData = Boolean(summary && (summary.n_patients > 0 || summary.n_visits > 0 || summary.n_images > 0));
  const [institutionQuery, setInstitutionQuery] = useState("");
  const [institutionResults, setInstitutionResults] = useState<PublicInstitutionRecord[]>([]);
  const [institutionSearchBusy, setInstitutionSearchBusy] = useState(false);
  const [institutionSearchError, setInstitutionSearchError] = useState<string | null>(null);
  const deferredInstitutionQuery = useDeferredValue(institutionQuery);

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
    setInstitutionSearchBusy(true);
    setInstitutionSearchError(null);
    void searchPublicInstitutions(query, { limit: 8 })
      .then((items) => {
        if (!cancelled) {
          setInstitutionResults(items);
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          setInstitutionSearchError(
            nextError instanceof Error
              ? translateApiError(locale, nextError.message)
              : pick(locale, "Unable to search institutions.", "기관 검색에 실패했습니다."),
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setInstitutionSearchBusy(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canManagePlatform, deferredInstitutionQuery, locale]);

  return (
    <Card as="section" variant="surface" className="grid gap-5 p-6">
      <SectionHeader
        eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Management", "관리")}</div>}
        title={pick(locale, "Projects, hospitals, and users", "프로젝트, 병원, 사용자 관리")}
        titleAs="h3"
        description={pick(
          locale,
          "Manage storage roots, platform projects, hospital identities, and user access from one administrative document.",
          "저장 경로, 프로젝트, 병원 ID, 사용자 접근 권한을 하나의 운영 문서에서 관리합니다."
        )}
        aside={<span className={docSiteBadgeClass}>{translateRole(locale, canManagePlatform ? "admin" : "site_admin")}</span>}
      />

      {canManageStorageRoot ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card as="section" variant="nested" className="grid gap-4 p-5">
            <SectionHeader
              title={pick(locale, "Default storage root", "기본 저장 경로")}
              titleAs="h4"
              aside={<span className={docSiteBadgeClass}>{storageSettings?.uses_custom_root ? pick(locale, "Custom", "사용자 지정") : pick(locale, "Default", "기본값")}</span>}
            />
            <Field label={pick(locale, "Folder path", "폴더 경로")}>
              <input value={instanceStorageRootForm} onChange={(event) => setInstanceStorageRootForm(event.target.value)} placeholder="D:\\KERA_DATA" />
            </Field>
            <MetricGrid columns={2}>
              <MetricItem value={storageSettings?.default_storage_root ?? notAvailableLabel} label={pick(locale, "Current default", "현재 기본 경로")} />
              <MetricItem value={storageSettings?.storage_root ?? notAvailableLabel} label={pick(locale, "Active root", "활성 경로")} />
            </MetricGrid>
            <div className="flex flex-wrap justify-end gap-3">
              <Button type="button" variant="ghost" onClick={() => setInstanceStorageRootForm(storageSettings?.default_storage_root ?? "")}>
                {pick(locale, "Use built-in default", "기본 경로 사용")}
              </Button>
              <Button type="button" variant="primary" loading={storageSettingsBusy} onClick={onSaveStorageRoot}>
                {pick(locale, "Save default root", "기본 경로 저장")}
              </Button>
            </div>
          </Card>

          <Card as="section" variant="nested" className="grid gap-4 p-5">
            <SectionHeader
              title={pick(locale, "Selected hospital storage root", "선택 병원 저장 경로")}
              titleAs="h4"
              aside={<span className={docSiteBadgeClass}>{selectedSiteId ?? notAvailableLabel}</span>}
            />
            {selectedManagedSite ? (
              <>
                <Field label={pick(locale, "Folder path", "폴더 경로")}>
                  <input value={siteStorageRootForm} onChange={(event) => setSiteStorageRootForm(event.target.value)} placeholder="D:\\HospitalAData\\JNUH" />
                </Field>
                <MetricGrid columns={2}>
                  <MetricItem value={selectedManagedSite.local_storage_root ?? notAvailableLabel} label={pick(locale, "Current root", "현재 경로")} />
                  <MetricItem
                    value={summary ? `${summary.n_patients}/${summary.n_visits}/${summary.n_images}` : notAvailableLabel}
                    label={pick(locale, "Patients / visits / images", "환자 / 방문 / 이미지")}
                  />
                </MetricGrid>
                <div className="text-sm leading-6 text-muted">
                  {pick(
                    locale,
                    "Before any patient data exists, the root can be reassigned directly. After data exists, use migration so files move safely.",
                    "데이터가 없을 때는 경로를 바로 바꿀 수 있고, 데이터가 있으면 안전하게 이동하도록 migration을 사용해야 합니다."
                  )}
                </div>
                <div className="flex flex-wrap justify-end gap-3">
                  <Button type="button" variant="ghost" onClick={() => setSiteStorageRootForm(selectedManagedSite.local_storage_root ?? "")}>
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
        </div>
      ) : null}

      {canManagePlatform ? (
        <>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card as="section" variant="nested" className="grid gap-4 p-5">
              <SectionHeader title={pick(locale, "Projects", "프로젝트")} titleAs="h4" aside={<span className={docSiteBadgeClass}>{projects.length}</span>} />
              {projects.length === 0 ? (
                <div className={emptySurfaceClass}>{pick(locale, "No project has been registered yet.", "아직 등록된 프로젝트가 없습니다.")}</div>
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

            <Card as="section" variant="nested" className="grid gap-4 p-5">
              <SectionHeader title={pick(locale, "New project", "프로젝트 생성")} titleAs="h4" />
              <Field label={pick(locale, "Project name", "프로젝트 이름")}>
                <input value={projectForm.name} onChange={(event) => setProjectForm((current) => ({ ...current, name: event.target.value }))} />
              </Field>
              <Field label={pick(locale, "Description", "설명")}>
                <textarea
                  rows={4}
                  value={projectForm.description}
                  onChange={(event) => setProjectForm((current) => ({ ...current, description: event.target.value }))}
                />
              </Field>
              <div className="flex justify-end">
                <Button type="button" variant="primary" onClick={onCreateProject}>
                  {pick(locale, "Create project", "프로젝트 생성")}
                </Button>
              </div>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card as="section" variant="nested" className="grid gap-4 p-5">
              <SectionHeader title={pick(locale, "Hospitals", "병원")} titleAs="h4" aside={<span className={docSiteBadgeClass}>{managedSites.length}</span>} />
              {managedSites.length === 0 ? (
                <div className={emptySurfaceClass}>{pick(locale, "No hospital is visible to this account.", "이 계정에서 볼 수 있는 병원이 없습니다.")}</div>
              ) : (
                <div className="grid gap-3">
                  {managedSites.map((site) => (
                    <SiteRecordCard
                      key={site.site_id}
                      title={site.display_name}
                      subtitle={site.hospital_name || pick(locale, "No hospital name", "병원명 없음")}
                      metrics={[
                        { label: pick(locale, "Site ID", "병원 ID"), value: site.site_id },
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
                    ? pick(locale, `Editing ${editingSiteId}`, `${editingSiteId} 수정 중`)
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
                {deferredInstitutionQuery.trim().length >= 2 && !institutionSearchBusy && !institutionSearchError ? (
                  institutionResults.length > 0 ? (
                    <div className="grid gap-2">
                      {institutionResults.map((institution) => {
                        const linkedSite =
                          managedSites.find((site) => site.source_institution_id === institution.institution_id) ?? null;
                        return (
                          <Card key={institution.institution_id} as="article" variant="nested" className="grid gap-3 border border-border/80 p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="grid gap-1">
                                <strong className="text-sm font-semibold text-ink">{institution.name}</strong>
                                <div className="text-xs leading-5 text-muted">
                                  {[institution.institution_type_name, institution.address].filter(Boolean).join(" / ")}
                                </div>
                              </div>
                              <span className={docSiteBadgeClass}>
                                {linkedSite
                                  ? pick(locale, `Linked to ${linkedSite.site_id}`, `${linkedSite.site_id}에 연결됨`)
                                  : institution.institution_id}
                              </span>
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
                                    const suggestedCode = suggestedSiteCodeFromInstitution(institution);
                                    const effectiveProjectId = siteForm.project_id || projects[0]?.project_id || "";
                                    if (editingSiteId) {
                                      onResetSiteForm();
                                    }
                                    setSiteForm((current) => ({
                                      ...current,
                                      project_id: current.project_id || effectiveProjectId,
                                      site_code: current.site_code || suggestedCode,
                                      display_name: institution.name,
                                      hospital_name: institution.name,
                                      source_institution_id: institution.institution_id,
                                    }));
                                    setInstitutionQuery(institution.name);
                                  }}
                                >
                                  {pick(locale, "Use for new site", "새 site 초안으로 사용")}
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
              <Field label={pick(locale, "Project", "프로젝트")}>
                <select
                  value={siteForm.project_id || projects[0]?.project_id || ""}
                  onChange={(event) => setSiteForm((current) => ({ ...current, project_id: event.target.value }))}
                  disabled={Boolean(editingSiteId)}
                >
                  {projects.map((project) => (
                    <option key={project.project_id} value={project.project_id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label={pick(locale, "Hospital code", "병원 코드")}>
                  <input
                    value={siteForm.site_code}
                    onChange={(event) => setSiteForm((current) => ({ ...current, site_code: event.target.value }))}
                    placeholder={pick(locale, "e.g. JNUH", "예: JNUH")}
                    disabled={Boolean(editingSiteId)}
                  />
                </Field>
                <Field label={pick(locale, "App display name", "앱 표시 이름")}>
                  <input
                    value={siteForm.display_name}
                    onChange={(event) => setSiteForm((current) => ({ ...current, display_name: event.target.value }))}
                    placeholder={pick(locale, "Jeju National University Hospital", "예: 제주대학교병원")}
                  />
                </Field>
              </div>
              <Field label={pick(locale, "Official hospital name", "공식 병원명")}>
                <input
                  value={siteForm.hospital_name}
                  onChange={(event) => setSiteForm((current) => ({ ...current, hospital_name: event.target.value }))}
                  placeholder={pick(locale, "Jeju National University Hospital", "예: 제주대학교병원")}
                />
              </Field>
              {siteForm.source_institution_id ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-brand/20 bg-brand-soft/60 px-4 py-3 text-sm text-ink">
                  <span>
                    <strong>{pick(locale, "Linked HIRA institution", "연결된 HIRA 기관")}:</strong> {siteForm.source_institution_id}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setSiteForm((current) => ({
                        ...current,
                        source_institution_id: undefined,
                      }))
                    }
                  >
                    {pick(locale, "Clear mapping", "연결 해제")}
                  </Button>
                </div>
              ) : null}
              <Field
                as="div"
                label={pick(locale, "Research registry", "연구 레지스트리")}
                hint={pick(
                  locale,
                  "Enable one-time clinician opt-in and automatic inclusion of eligible validated cases, while keeping case-level exclusion available.",
                  "연구자의 1회 가입과 적격 검증 케이스의 자동 포함을 허용하되, 케이스별 제외는 계속 가능하게 합니다."
                )}
              >
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
              </Field>
              <div className="flex flex-wrap justify-end gap-3">
                <Button type="button" variant="ghost" onClick={onResetSiteForm}>
                  {pick(locale, "Reset", "초기화")}
                </Button>
                <Button type="button" variant="primary" disabled={projects.length === 0} onClick={onSaveSite}>
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
              <div className="grid gap-3">
                {managedUsers.map((managedUser) => (
                  <SiteRecordCard
                    key={managedUser.user_id}
                    title={managedUser.username}
                    subtitle={managedUser.full_name}
                    metrics={[
                      { label: pick(locale, "Role", "역할"), value: translateRole(locale, managedUser.role) },
                      { label: pick(locale, "Hospitals", "병원"), value: (managedUser.site_ids ?? []).join(", ") || pick(locale, "All", "전체") },
                      { label: pick(locale, "Approval", "승인 상태"), value: managedUser.approval_status },
                    ]}
                    onClick={() =>
                      setUserForm({
                        username: managedUser.username,
                        full_name: managedUser.full_name,
                        password: "",
                        role: managedUser.role,
                        site_ids: managedUser.site_ids ?? [],
                      })
                    }
                  />
                ))}
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
                {managedSites.map((site) => (
                  <option key={site.site_id} value={site.site_id}>
                    {site.display_name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex flex-wrap justify-end gap-3">
              <Button type="button" variant="ghost" onClick={onResetUserForm}>
                {pick(locale, "Reset", "초기화")}
              </Button>
              <Button type="button" variant="primary" onClick={onSaveUser}>
                {pick(locale, "Save user", "사용자 저장")}
              </Button>
            </div>
          </Card>
        </>
      ) : (
        <Card as="section" variant="nested" className="grid gap-4 p-5">
          <SectionHeader title={pick(locale, "Hospitals", "병원")} titleAs="h4" aside={<span className={docSiteBadgeClass}>{managedSites.length}</span>} />
          {managedSites.length === 0 ? (
            <div className={emptySurfaceClass}>{pick(locale, "No hospital is visible to this account.", "이 계정에서 볼 수 있는 병원이 없습니다.")}</div>
          ) : (
            <div className="grid gap-3">
              {managedSites.map((site) => (
                <SiteRecordCard
                  key={site.site_id}
                  title={site.display_name}
                  subtitle={site.hospital_name || pick(locale, "No hospital name", "병원명 없음")}
                  metrics={[
                    { label: pick(locale, "Site ID", "병원 ID"), value: site.site_id },
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
