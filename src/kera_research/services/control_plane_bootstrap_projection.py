from __future__ import annotations

from typing import Any, Callable

from kera_research.domain import utc_now


class ControlPlaneBootstrapProjectionFacade:
    def __init__(
        self,
        store: Any,
        *,
        infer_remote_source_provider: Callable[[str], str],
        site_display_label: Callable[[dict[str, Any] | None, str], str],
    ) -> None:
        self.store = store
        self.infer_remote_source_provider = infer_remote_source_provider
        self.site_display_label = site_display_label

    def normalize_remote_release(self, release: dict[str, Any]) -> dict[str, Any]:
        metadata = release.get("metadata_json") if isinstance(release.get("metadata_json"), dict) else {}
        normalized = {
            **metadata,
            "version_id": str(release.get("version_id") or "").strip(),
            "version_name": str(release.get("version_name") or "").strip(),
            "architecture": str(release.get("architecture") or metadata.get("architecture") or "").strip(),
            "stage": "global",
            "created_at": str(release.get("created_at") or metadata.get("created_at") or utc_now()),
            "ready": bool(release.get("ready", True)),
            "is_current": bool(release.get("is_current", True)),
            "model_name": str(metadata.get("model_name") or "keratitis_cls"),
            "download_url": str(release.get("download_url") or "").strip(),
            "sha256": str(release.get("sha256") or "").strip().lower(),
            "size_bytes": int(release.get("size_bytes") or 0),
            "source_provider": str(
                release.get("source_provider")
                or metadata.get("source_provider")
                or self.infer_remote_source_provider(str(release.get("download_url") or ""))
            ).strip(),
            "metadata_json": metadata,
        }
        if normalized.get("requires_medsam_crop") is None:
            normalized["requires_medsam_crop"] = bool(metadata.get("requires_medsam_crop", False))
        return normalized

    def cache_remote_release_locally(self, release: dict[str, Any]) -> dict[str, Any]:
        normalized = self.normalize_remote_release(release)
        try:
            self.store.registry.ensure_model_version(normalized)
        except Exception:
            pass
        return normalized

    def remote_bootstrap_project_records(self) -> list[dict[str, Any]]:
        bootstrap = self.store.remote_bootstrap_state()
        if not isinstance(bootstrap, dict):
            return []
        project = bootstrap.get("project")
        if not isinstance(project, dict):
            return []
        project_id = str(project.get("project_id") or "").strip()
        if not project_id:
            return []
        return [
            {
                "project_id": project_id,
                "name": str(project.get("name") or project_id).strip() or project_id,
                "description": str(project.get("description") or "").strip(),
                "owner_user_id": str(bootstrap.get("user", {}).get("user_id") or "").strip() or None,
                "site_ids": [
                    str(site.get("site_id") or "").strip()
                    for site in self.remote_bootstrap_site_records()
                    if str(site.get("site_id") or "").strip()
                ],
                "created_at": str(project.get("created_at") or utc_now()),
            }
        ]

    def remote_bootstrap_site_records(self) -> list[dict[str, Any]]:
        bootstrap = self.store.remote_bootstrap_state()
        if not isinstance(bootstrap, dict):
            return []

        project = bootstrap.get("project") if isinstance(bootstrap.get("project"), dict) else {}
        project_id = str(project.get("project_id") or "project_default").strip() or "project_default"
        raw_memberships = bootstrap.get("memberships") if isinstance(bootstrap.get("memberships"), list) else []
        site_index: dict[str, dict[str, Any]] = {}

        def add_site(raw_site: Any) -> None:
            if not isinstance(raw_site, dict):
                return
            site_id = str(raw_site.get("site_id") or "").strip()
            if not site_id:
                return
            site_index[site_id] = {
                "site_id": site_id,
                "project_id": project_id,
                "site_code": str(raw_site.get("site_code") or site_id).strip() or site_id,
                "display_name": str(raw_site.get("display_name") or site_id).strip() or site_id,
                "hospital_name": str(raw_site.get("hospital_name") or raw_site.get("display_name") or site_id).strip()
                or site_id,
                "source_institution_id": str(raw_site.get("source_institution_id") or "").strip() or None,
                "research_registry_enabled": bool(raw_site.get("research_registry_enabled", True)),
                "local_storage_root": raw_site.get("local_storage_root"),
                "status": str(raw_site.get("status") or "active").strip() or "active",
                "created_at": str(raw_site.get("created_at") or utc_now()),
            }

        add_site(bootstrap.get("site"))
        for membership in raw_memberships:
            if not isinstance(membership, dict):
                continue
            membership_site = membership.get("site")
            if isinstance(membership_site, dict):
                add_site(membership_site)
            elif str(membership.get("status") or "").strip().lower() == "approved":
                add_site(
                    {
                        "site_id": membership.get("site_id"),
                        "display_name": membership.get("site_id"),
                        "hospital_name": membership.get("site_id"),
                    }
                )

        return sorted(
            site_index.values(),
            key=lambda item: self.site_display_label(item, str(item.get("site_id") or "")).lower(),
        )
