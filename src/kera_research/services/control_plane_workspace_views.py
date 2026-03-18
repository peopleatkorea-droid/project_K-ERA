from __future__ import annotations

from typing import Any


class ControlPlaneWorkspaceFacade:
    def __init__(self, store: Any) -> None:
        self.store = store

    def list_projects(self) -> list[dict[str, Any]]:
        merged: dict[str, dict[str, Any]] = {
            str(row["project_id"]): dict(row)
            for row in self.store.workspace.list_projects()
            if str(row.get("project_id") or "").strip()
        }
        for project in self.store._remote_bootstrap_project_records():
            project_id = str(project.get("project_id") or "").strip()
            if not project_id:
                continue
            existing = dict(merged.get(project_id) or {})
            merged[project_id] = {
                **project,
                **existing,
                "project_id": project_id,
                "name": str(project.get("name") or existing.get("name") or project_id).strip() or project_id,
            }
        return sorted(merged.values(), key=lambda item: str(item.get("created_at") or ""))

    def create_project(self, name: str, description: str, owner_user_id: str) -> dict[str, Any]:
        return self.store.workspace.create_project(name, description, owner_user_id)

    def list_sites(self, project_id: str | None = None) -> list[dict[str, Any]]:
        merged: dict[str, dict[str, Any]] = {
            str(row["site_id"]): dict(row)
            for row in self.store.workspace.list_sites(project_id)
            if str(row.get("site_id") or "").strip()
        }
        for remote_site in self.store._remote_bootstrap_site_records():
            site_id = str(remote_site.get("site_id") or "").strip()
            if not site_id:
                continue
            existing = dict(merged.get(site_id) or {})
            local_storage_root = existing.get("local_storage_root")
            research_registry_enabled = existing.get("research_registry_enabled")
            merged_site = {
                **remote_site,
                **existing,
                "site_id": site_id,
                "project_id": str(existing.get("project_id") or remote_site.get("project_id") or "project_default").strip()
                or "project_default",
                "site_code": str(existing.get("site_code") or remote_site.get("site_code") or site_id).strip() or site_id,
                "display_name": str(remote_site.get("display_name") or existing.get("display_name") or site_id).strip()
                or site_id,
                "hospital_name": str(remote_site.get("hospital_name") or existing.get("hospital_name") or site_id).strip()
                or site_id,
            }
            if local_storage_root:
                merged_site["local_storage_root"] = local_storage_root
            if research_registry_enabled is not None:
                merged_site["research_registry_enabled"] = bool(research_registry_enabled)
            merged[site_id] = merged_site
        site_rows = list(merged.values())
        if project_id:
            site_rows = [site for site in site_rows if str(site.get("project_id") or "") == project_id]
        return sorted(
            site_rows,
            key=lambda item: self.store.site_display_label(item, str(item.get("site_id") or "")).lower(),
        )

    def get_site(self, site_id: str) -> dict[str, Any] | None:
        normalized_site_id = site_id.strip()
        if not normalized_site_id:
            return None
        local_site = self.store.workspace.get_site(normalized_site_id)
        remote_site = next(
            (item for item in self.store._remote_bootstrap_site_records() if str(item.get("site_id") or "").strip() == normalized_site_id),
            None,
        )
        if local_site and remote_site:
            merged = {
                **remote_site,
                **local_site,
            }
            if local_site.get("local_storage_root"):
                merged["local_storage_root"] = local_site.get("local_storage_root")
            if local_site.get("research_registry_enabled") is not None:
                merged["research_registry_enabled"] = bool(local_site.get("research_registry_enabled"))
            return merged
        return local_site or remote_site

    def get_site_by_source_institution_id(self, source_institution_id: str) -> dict[str, Any] | None:
        return self.store.workspace.get_site_by_source_institution_id(source_institution_id)
