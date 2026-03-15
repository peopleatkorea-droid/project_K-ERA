"use client";

import type { Dispatch, SetStateAction } from "react";

import type { ManagedSiteRecord, ManagedUserRecord, ProjectRecord, SiteSummary, StorageSettingsRecord } from "../../lib/api";
import { pick, translateRole, type Locale } from "../../lib/i18n";

type SiteFormState = {
  project_id: string;
  site_code: string;
  display_name: string;
  hospital_name: string;
};

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
  return (
    <section className="doc-surface">
      <div className="doc-title-row">
        <div>
          <div className="doc-eyebrow">{pick(locale, "Management", "관리")}</div>
          <h3>{pick(locale, "Projects, hospitals, and users", "프로젝트, 병원, 사용자 관리")}</h3>
        </div>
        <div className="doc-site-badge">{translateRole(locale, canManagePlatform ? "admin" : "site_admin")}</div>
      </div>
      <div className="ops-stack">
        {canManageStorageRoot ? (
          <div className="ops-dual-grid">
            <section className="ops-card">
              <div className="panel-card-head"><strong>{pick(locale, "Default storage root", "기본 저장 경로")}</strong><span>{storageSettings?.uses_custom_root ? pick(locale, "custom", "사용자 지정") : pick(locale, "default", "기본값")}</span></div>
              <div className="storage-settings-grid">
                <label className="inline-field"><span>{pick(locale, "Folder path", "폴더 경로")}</span><input value={instanceStorageRootForm} onChange={(event) => setInstanceStorageRootForm(event.target.value)} placeholder="D:\\KERA_DATA" /></label>
                <div className="storage-settings-copy"><p>{pick(locale, "Used as the default root when a new hospital is created.", "새 병원을 만들 때 기본 저장 루트로 사용됩니다.")}</p><div className="storage-settings-meta"><strong>{pick(locale, "Current default", "현재 기본값")}</strong><span>{storageSettings?.default_storage_root ?? notAvailableLabel}</span></div></div>
              </div>
              <div className="storage-settings-actions"><button className="ghost-button" type="button" onClick={() => setInstanceStorageRootForm(storageSettings?.default_storage_root ?? "")}>{pick(locale, "Use built-in default", "기본 경로 사용")}</button><button className="primary-workspace-button" type="button" onClick={onSaveStorageRoot} disabled={storageSettingsBusy}>{storageSettingsBusy ? pick(locale, "Saving...", "저장 중...") : pick(locale, "Save default root", "기본 경로 저장")}</button></div>
            </section>
            <section className="ops-card">
              <div className="panel-card-head"><strong>{pick(locale, "Selected hospital storage root", "선택한 병원 저장 경로")}</strong><span>{selectedSiteId ?? notAvailableLabel}</span></div>
              {selectedManagedSite ? (
                <>
                  <div className="storage-settings-grid">
                    <label className="inline-field"><span>{pick(locale, "Folder path", "폴더 경로")}</span><input value={siteStorageRootForm} onChange={(event) => setSiteStorageRootForm(event.target.value)} placeholder="D:\\HospitalAData\\JNUH" /></label>
                    <div className="storage-settings-copy"><p>{pick(locale, "This changes where new files for the selected hospital will be written.", "선택한 병원의 새 파일이 저장될 경로를 바꿉니다.")}</p><p>{pick(locale, "For safety, the app only allows this before any patient, visit, or image exists for the hospital.", "안전을 위해 환자, 방문, 이미지가 하나도 없을 때만 변경할 수 있습니다.")}</p><div className="storage-settings-meta"><strong>{pick(locale, "Current root", "현재 경로")}</strong><span>{selectedManagedSite.local_storage_root ?? notAvailableLabel}</span></div><div className="storage-settings-meta"><strong>{pick(locale, "Current hospital data", "현재 병원 데이터")}</strong><span>{summary ? `${summary.n_patients}/${summary.n_visits}/${summary.n_images}` : notAvailableLabel}</span></div></div>
                  </div>
                  <div className="storage-settings-actions">
                    <button className="ghost-button" type="button" onClick={() => setSiteStorageRootForm(selectedManagedSite.local_storage_root ?? "")}>{pick(locale, "Reset", "초기화")}</button>
                    <button className="primary-workspace-button" type="button" onClick={onSaveSelectedSiteStorageRoot} disabled={storageSettingsBusy || Boolean(summary && (summary.n_patients > 0 || summary.n_visits > 0 || summary.n_images > 0))}>{storageSettingsBusy ? pick(locale, "Saving...", "저장 중...") : pick(locale, "Save hospital root", "병원 경로 저장")}</button>
                    <button className="primary-workspace-button" type="button" onClick={onMigrateSelectedSiteStorageRoot} disabled={storageSettingsBusy || !Boolean(summary && (summary.n_patients > 0 || summary.n_visits > 0 || summary.n_images > 0))}>{storageSettingsBusy ? pick(locale, "Migrating...", "이동 중...") : pick(locale, "Migrate existing data", "기존 데이터 이동")}</button>
                  </div>
                </>
              ) : <div className="empty-surface">{pick(locale, "Select a hospital to review or change its storage path.", "저장 경로를 확인하거나 변경하려면 병원을 선택하세요.")}</div>}
            </section>
          </div>
        ) : null}
        {canManagePlatform ? (
          <>
            <div className="ops-dual-grid">
              <section className="ops-card">
                <div className="panel-card-head"><strong>{pick(locale, "Projects", "프로젝트")}</strong><span>{projects.length}</span></div>
                {projects.length === 0 ? <div className="empty-surface">{pick(locale, "No project has been registered yet.", "아직 등록된 프로젝트가 없습니다.")}</div> : <div className="ops-list">{projects.map((project) => <div key={project.project_id} className="ops-item"><div className="panel-card-head"><strong>{project.name}</strong><span>{project.site_ids.length} {pick(locale, "hospital(s)", "병원")}</span></div><div className="panel-meta"><span>{project.project_id}</span><span>{formatDateTime(project.created_at, notAvailableLabel)}</span></div></div>)}</div>}
              </section>
              <section className="ops-card">
                <div className="panel-card-head"><strong>{pick(locale, "New project", "프로젝트 생성")}</strong><span>{pick(locale, "Create", "생성")}</span></div>
                <div className="ops-stack">
                  <label className="inline-field"><span>{pick(locale, "Project name", "프로젝트 이름")}</span><input value={projectForm.name} onChange={(event) => setProjectForm((current) => ({ ...current, name: event.target.value }))} /></label>
                  <label className="notes-field"><span>{pick(locale, "Description", "설명")}</span><textarea rows={3} value={projectForm.description} onChange={(event) => setProjectForm((current) => ({ ...current, description: event.target.value }))} /></label>
                  <div className="workspace-actions"><button className="primary-workspace-button" type="button" onClick={onCreateProject}>{pick(locale, "Create project", "프로젝트 생성")}</button></div>
                </div>
              </section>
            </div>
            <div className="ops-dual-grid">
              <section className="ops-card">
                <div className="panel-card-head"><strong>{pick(locale, "Hospitals", "병원")}</strong><span>{managedSites.length}</span></div>
                {managedSites.length === 0 ? <div className="empty-surface">{pick(locale, "No hospital is visible to this account.", "이 계정에서 볼 수 있는 병원이 없습니다.")}</div> : <div className="ops-list">{managedSites.map((site) => <button key={site.site_id} className="ops-item ops-table-button" type="button" onClick={() => onEditSite(site)}><div className="panel-card-head"><strong>{site.display_name}</strong><span>{site.project_id}</span></div><div className="panel-meta"><span>{site.site_id}</span><span>{site.hospital_name || pick(locale, "No hospital name", "병원명 없음")}</span></div></button>)}</div>}
              </section>
              <section className="ops-card">
                <div className="panel-card-head"><strong>{editingSiteId ? pick(locale, "Edit hospital", "병원 수정") : pick(locale, "Register hospital", "병원 등록")}</strong><span>{editingSiteId ?? pick(locale, "new", "신규")}</span></div>
                <div className="ops-stack">
                  <div className="panel-meta"><span>{editingSiteId ? pick(locale, `Editing ${editingSiteId}`, `${editingSiteId} 수정 중`) : pick(locale, "Registering a new hospital", "새 병원 등록")}</span><span>{pick(locale, "Hospital code remains immutable after creation.", "병원 코드는 생성 후 수정하지 않습니다.")}</span></div>
                  <label className="inline-field"><span>{pick(locale, "Project", "프로젝트")}</span><select value={siteForm.project_id || projects[0]?.project_id || ""} onChange={(event) => setSiteForm((current) => ({ ...current, project_id: event.target.value }))} disabled={Boolean(editingSiteId)}>{projects.map((project) => <option key={project.project_id} value={project.project_id}>{project.name}</option>)}</select></label>
                  <div className="ops-form-grid">
                    <label className="inline-field"><span>{pick(locale, "Hospital code", "병원 코드")}</span><input value={siteForm.site_code} onChange={(event) => setSiteForm((current) => ({ ...current, site_code: event.target.value }))} placeholder={pick(locale, "e.g. JNUH", "예: JNUH")} disabled={Boolean(editingSiteId)} /></label>
                    <label className="inline-field"><span>{pick(locale, "App display name", "앱 표시명")}</span><input value={siteForm.display_name} onChange={(event) => setSiteForm((current) => ({ ...current, display_name: event.target.value }))} placeholder={pick(locale, "Jeju National University Hospital", "예: 제주대병원")} /></label>
                  </div>
                  <p className="muted">{pick(locale, "The app display name is the short label shown in lists and sidebars.", "앱 표시명은 목록과 사이드바에 보이는 짧은 이름입니다.")}</p>
                  <label className="inline-field"><span>{pick(locale, "Official hospital name", "공식 병원명")}</span><input value={siteForm.hospital_name} onChange={(event) => setSiteForm((current) => ({ ...current, hospital_name: event.target.value }))} placeholder={pick(locale, "Jeju National University Hospital", "예: 제주대학교병원")} /></label>
                  <p className="muted">{pick(locale, "The official hospital name is stored as the formal institution name.", "공식 병원명은 정식 기관명으로 저장됩니다.")}</p>
                  <div className="workspace-actions"><button className="ghost-button" type="button" onClick={onResetSiteForm}>{pick(locale, "Reset", "초기화")}</button><button className="primary-workspace-button" type="button" onClick={onSaveSite} disabled={projects.length === 0}>{editingSiteId ? pick(locale, "Save hospital", "병원 저장") : pick(locale, "Register hospital", "병원 등록")}</button></div>
                </div>
              </section>
            </div>
          </>
        ) : (
          <section className="ops-card">
            <div className="panel-card-head"><strong>{pick(locale, "Hospitals", "병원")}</strong><span>{managedSites.length}</span></div>
            {managedSites.length === 0 ? <div className="empty-surface">{pick(locale, "No hospital is visible to this account.", "이 계정에서 볼 수 있는 병원이 없습니다.")}</div> : <div className="ops-list">{managedSites.map((site) => <div key={site.site_id} className="ops-item"><div className="panel-card-head"><strong>{site.display_name}</strong><span>{site.project_id}</span></div><div className="panel-meta"><span>{site.site_id}</span><span>{site.hospital_name || pick(locale, "No hospital name", "병원명 없음")}</span></div></div>)}</div>}
          </section>
        )}
        {canManagePlatform ? <section className="ops-card"><div className="panel-card-head"><strong>{pick(locale, "Users and access", "사용자 및 접근 권한")}</strong><span>{managedUsers.length}</span></div>{managedUsers.length === 0 ? <div className="empty-surface">{pick(locale, "No user record has been created yet.", "아직 생성된 사용자 레코드가 없습니다.")}</div> : <div className="ops-table"><div className="ops-table-row ops-table-head"><span>{pick(locale, "username", "아이디")}</span><span>{pick(locale, "full name", "이름")}</span><span>{pick(locale, "role", "역할")}</span><span>{pick(locale, "hospitals", "병원")}</span></div>{managedUsers.map((managedUser) => <button key={managedUser.user_id} className="ops-table-row ops-table-button" type="button" onClick={() => setUserForm({ username: managedUser.username, full_name: managedUser.full_name, password: "", role: managedUser.role, site_ids: managedUser.site_ids ?? [] })}><span>{managedUser.username}</span><span>{managedUser.full_name}</span><span>{translateRole(locale, managedUser.role)}</span><span>{(managedUser.site_ids ?? []).join(", ") || pick(locale, "all", "전체")}</span></button>)}</div>}<div className="ops-stack"><div className="ops-form-grid"><label className="inline-field"><span>{pick(locale, "Username", "아이디")}</span><input value={userForm.username} onChange={(event) => setUserForm((current) => ({ ...current, username: event.target.value }))} /></label><label className="inline-field"><span>{pick(locale, "Full name", "이름")}</span><input value={userForm.full_name} onChange={(event) => setUserForm((current) => ({ ...current, full_name: event.target.value }))} /></label></div><div className="ops-form-grid"><label className="inline-field"><span>{pick(locale, "Password", "비밀번호")}</span><input type="password" value={userForm.password} onChange={(event) => setUserForm((current) => ({ ...current, password: event.target.value }))} placeholder={pick(locale, "Leave blank to keep existing password", "기존 비밀번호를 유지하려면 비워두세요")} /></label><label className="inline-field"><span>{pick(locale, "Role", "역할")}</span><select value={userForm.role} onChange={(event) => setUserForm((current) => ({ ...current, role: event.target.value }))}><option value="admin">{translateRole(locale, "admin")}</option><option value="site_admin">{translateRole(locale, "site_admin")}</option><option value="researcher">{translateRole(locale, "researcher")}</option><option value="viewer">{translateRole(locale, "viewer")}</option></select></label></div><label className="inline-field"><span>{pick(locale, "Accessible hospitals", "접근 가능한 병원")}</span><select multiple value={userForm.site_ids} onChange={(event) => setUserForm((current) => ({ ...current, site_ids: Array.from(event.target.selectedOptions, (option) => option.value) }))}>{managedSites.map((site) => <option key={site.site_id} value={site.site_id}>{site.display_name}</option>)}</select></label><div className="workspace-actions"><button className="ghost-button" type="button" onClick={onResetUserForm}>{pick(locale, "Reset", "초기화")}</button><button className="primary-workspace-button" type="button" onClick={onSaveUser}>{pick(locale, "Save user", "사용자 저장")}</button></div></div></section> : null}
      </div>
    </section>
  );
}
