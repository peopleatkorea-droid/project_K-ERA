from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, status

from kera_research.api.control_plane_proxy import call_remote_control_plane_method, remote_control_plane_is_primary
from kera_research.api.routes.admin_shared import FIXED_PROJECT_ID, resolve_fixed_project
from kera_research.services.control_plane_workspace_ops import SOURCE_INSTITUTION_ID_UNSET


def build_admin_management_router(support: Any) -> APIRouter:
    router = APIRouter()

    get_control_plane = support.get_control_plane
    get_approved_user = support.get_approved_user
    require_admin_workspace_permission = support.require_admin_workspace_permission
    require_platform_admin = support.require_platform_admin
    require_site_access = support.require_site_access
    normalize_storage_root = support.normalize_storage_root
    site_comparison_rows = support.site_comparison_rows
    hash_password = support.hash_password
    make_id = support.make_id

    ProjectCreateRequest = support.ProjectCreateRequest
    SiteCreateRequest = support.SiteCreateRequest
    SiteUpdateRequest = support.SiteUpdateRequest
    UserUpsertRequest = support.UserUpsertRequest
    SiteStorageRootUpdateRequest = support.SiteStorageRootUpdateRequest
    SiteMetadataRecoveryRequest = support.SiteMetadataRecoveryRequest

    @router.get("/api/admin/projects")
    def list_projects(
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
        authorization: str | None = Header(default=None),
        control_plane_owner: str | None = Header(default=None, alias="x-kera-control-plane-owner"),
    ) -> list[dict[str, Any]]:
        require_admin_workspace_permission(user)
        remote_projects = call_remote_control_plane_method(
            cp,
            authorization=authorization,
            control_plane_owner=control_plane_owner,
            method_name="main_admin_projects",
        )
        if remote_projects is not None:
            return remote_projects
        if remote_control_plane_is_primary(cp, control_plane_owner=control_plane_owner):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Central control plane projects are unavailable.",
            )
        return [resolve_fixed_project(cp, user.get("user_id"))]

    @router.post("/api/admin/projects")
    def create_project(
        payload: ProjectCreateRequest,
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
        authorization: str | None = Header(default=None),
        control_plane_owner: str | None = Header(default=None, alias="x-kera-control-plane-owner"),
    ) -> dict[str, Any]:
        require_platform_admin(user)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Projects are fixed to the default workspace.",
        )

    @router.get("/api/admin/sites")
    def list_admin_sites(
        project_id: str | None = None,
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
        authorization: str | None = Header(default=None),
        control_plane_owner: str | None = Header(default=None, alias="x-kera-control-plane-owner"),
    ) -> list[dict[str, Any]]:
        require_admin_workspace_permission(user)
        remote_sites = call_remote_control_plane_method(
            cp,
            authorization=authorization,
            control_plane_owner=control_plane_owner,
            method_name="main_admin_sites",
            project_id=project_id,
        )
        if remote_sites is not None:
            return remote_sites
        if remote_control_plane_is_primary(cp, control_plane_owner=control_plane_owner):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Central control plane sites are unavailable.",
            )
        if user.get("role") == "admin":
            return cp.list_sites(project_id=project_id)
        sites = cp.accessible_sites_for_user(user)
        if project_id:
            sites = [site for site in sites if site.get("project_id") == project_id]
        return sites

    @router.post("/api/admin/sites")
    def create_site(
        payload: SiteCreateRequest,
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
        authorization: str | None = Header(default=None),
        control_plane_owner: str | None = Header(default=None, alias="x-kera-control-plane-owner"),
    ) -> dict[str, Any]:
        require_platform_admin(user)
        if not str(payload.source_institution_id or "").strip():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Linked HIRA institution is required.")
        remote_site = call_remote_control_plane_method(
            cp,
            authorization=authorization,
            control_plane_owner=control_plane_owner,
            method_name="main_admin_create_site",
            payload_json=payload.model_dump(),
        )
        if remote_site is not None:
            return remote_site
        if remote_control_plane_is_primary(cp, control_plane_owner=control_plane_owner):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Central control plane site creation is unavailable.",
            )
        fixed_project = resolve_fixed_project(cp, user.get("user_id"))
        try:
            return cp.create_site(
                project_id=str(fixed_project.get("project_id") or FIXED_PROJECT_ID),
                hospital_name=payload.hospital_name,
                source_institution_id=payload.source_institution_id,
                research_registry_enabled=payload.research_registry_enabled,
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.patch("/api/admin/sites/{site_id}")
    def update_site(
        site_id: str,
        payload: SiteUpdateRequest,
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
        authorization: str | None = Header(default=None),
        control_plane_owner: str | None = Header(default=None, alias="x-kera-control-plane-owner"),
    ) -> dict[str, Any]:
        require_platform_admin(user)
        remote_site = call_remote_control_plane_method(
            cp,
            authorization=authorization,
            control_plane_owner=control_plane_owner,
            method_name="main_admin_update_site",
            site_id=site_id,
            payload_json=payload.model_dump(),
        )
        if remote_site is not None:
            return remote_site
        if remote_control_plane_is_primary(cp, control_plane_owner=control_plane_owner):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Central control plane site update is unavailable.",
            )
        try:
            return cp.update_site_metadata(
                site_id,
                hospital_name=payload.hospital_name,
                source_institution_id=(
                    payload.source_institution_id
                    if "source_institution_id" in payload.model_fields_set
                    else SOURCE_INSTITUTION_ID_UNSET
                ),
                research_registry_enabled=payload.research_registry_enabled,
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.get("/api/admin/users")
    def list_users(
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
        authorization: str | None = Header(default=None),
        control_plane_owner: str | None = Header(default=None, alias="x-kera-control-plane-owner"),
    ) -> list[dict[str, Any]]:
        require_platform_admin(user)
        remote_users = call_remote_control_plane_method(
            cp,
            authorization=authorization,
            control_plane_owner=control_plane_owner,
            method_name="main_admin_users",
        )
        if remote_users is not None:
            return remote_users
        if remote_control_plane_is_primary(cp, control_plane_owner=control_plane_owner):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Central control plane users are unavailable.",
            )
        return cp.list_users()

    @router.post("/api/admin/users")
    def upsert_user(
        payload: UserUpsertRequest,
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
        authorization: str | None = Header(default=None),
        control_plane_owner: str | None = Header(default=None, alias="x-kera-control-plane-owner"),
    ) -> dict[str, Any]:
        require_platform_admin(user)
        remote_user = call_remote_control_plane_method(
            cp,
            authorization=authorization,
            control_plane_owner=control_plane_owner,
            method_name="main_admin_upsert_user",
            payload_json=payload.model_dump(),
        )
        if remote_user is not None:
            return remote_user
        if remote_control_plane_is_primary(cp, control_plane_owner=control_plane_owner):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Central control plane user management is unavailable.",
            )
        if payload.role not in {"admin", "site_admin", "researcher", "viewer"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid user role.")
        if payload.role != "admin" and not payload.site_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Non-admin accounts must be assigned to at least one site.",
            )

        existing = cp.get_user_by_id(payload.user_id) if payload.user_id else cp.get_user_by_username(payload.username)
        existing_raw = cp._load_user_by_id(existing["user_id"]) if existing else None
        new_password = payload.password.strip()
        if new_password:
            password = hash_password(new_password)
        elif existing_raw:
            password = str(existing_raw.get("password") or "")
        else:
            password = ""
        if not password:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password is required for user creation.")

        try:
            return cp.upsert_user(
                {
                    "user_id": existing["user_id"] if existing else make_id("user"),
                    "username": payload.username.strip().lower(),
                    "full_name": payload.full_name.strip() or payload.username.strip(),
                    "password": password,
                    "role": payload.role,
                    "site_ids": [] if payload.role == "admin" else payload.site_ids,
                    "google_sub": existing_raw.get("google_sub") if existing_raw else None,
                }
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.delete("/api/admin/users/{user_id}")
    def delete_user(
        user_id: str,
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
        authorization: str | None = Header(default=None),
        control_plane_owner: str | None = Header(default=None, alias="x-kera-control-plane-owner"),
    ) -> dict[str, Any]:
        require_platform_admin(user)
        remote_result = call_remote_control_plane_method(
            cp,
            authorization=authorization,
            control_plane_owner=control_plane_owner,
            method_name="main_admin_delete_user",
            user_id=user_id,
        )
        if remote_result is not None:
            return remote_result
        if remote_control_plane_is_primary(cp, control_plane_owner=control_plane_owner):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Central control plane user management is unavailable.",
            )
        target = cp.get_user_by_id(user_id)
        if not target:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
        if target.get("user_id") == user.get("user_id"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete your own account.")
        cp.delete_user(user_id)
        return {"deleted": True, "user_id": user_id}

    @router.get("/api/admin/site-comparison")
    def site_comparison(
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
    ) -> list[dict[str, Any]]:
        require_admin_workspace_permission(user)
        return site_comparison_rows(cp, user)

    @router.patch("/api/admin/sites/{site_id}/storage-root")
    def update_site_storage_root(
        site_id: str,
        payload: SiteStorageRootUpdateRequest,
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        site_store = require_site_access(cp, user, site_id)
        if site_store.list_patients() or site_store.list_visits() or site_store.list_images():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Storage root can only be changed before any patient, visit, or image is stored for this site.",
            )
        try:
            normalized_root = normalize_storage_root(payload.storage_root)
            updated_site = cp.update_site_storage_root(site_id, str(normalized_root))
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        return updated_site

    @router.post("/api/admin/sites/{site_id}/storage-root/migrate")
    def migrate_site_storage_root(
        site_id: str,
        payload: SiteStorageRootUpdateRequest,
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        require_site_access(cp, user, site_id)
        try:
            normalized_root = normalize_storage_root(payload.storage_root)
            updated_site = cp.migrate_site_storage_root(site_id, str(normalized_root))
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        return updated_site

    @router.post("/api/admin/sites/{site_id}/metadata/recover")
    def recover_site_metadata(
        site_id: str,
        payload: SiteMetadataRecoveryRequest,
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        site_store = require_site_access(cp, user, site_id)
        normalized_backup_path = str(payload.backup_path or "").strip() or None
        try:
            if payload.source == "backup":
                backup_candidate = Path(normalized_backup_path).expanduser() if normalized_backup_path else site_store.metadata_backup_path()
                if not backup_candidate.exists():
                    raise ValueError(f"Backup file not found: {backup_candidate}")
                result = site_store.recover_metadata(
                    prefer_backup=True,
                    force_replace=payload.force_replace,
                    backup_path=str(backup_candidate),
                )
            elif payload.source == "manifest":
                result = site_store.recover_metadata(
                    prefer_backup=False,
                    force_replace=payload.force_replace,
                    backup_path=normalized_backup_path,
                )
            else:
                result = site_store.recover_metadata(
                    prefer_backup=True,
                    force_replace=payload.force_replace,
                    backup_path=normalized_backup_path,
                )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        return {
            "site_id": site_store.site_id,
            "site_dir": str(site_store.site_dir),
            "manifest_path": str(site_store.manifest_path),
            "metadata_backup_path": str(site_store.metadata_backup_path()),
            **result,
        }

    @router.post("/api/admin/sites/{site_id}/metadata/sync-raw")
    def sync_site_metadata_from_raw(
        site_id: str,
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        site_store = require_site_access(cp, user, site_id)
        result = site_store.sync_raw_inventory_metadata()
        if any(int(result.get(key) or 0) > 0 for key in ("created_patients", "created_visits", "created_images")):
            site_store.generate_manifest()
            site_store.export_metadata_backup()
        return {
            "site_id": site_store.site_id,
            "site_dir": str(site_store.site_dir),
            "raw_dir": str(site_store.raw_dir),
            "manifest_path": str(site_store.manifest_path),
            "metadata_backup_path": str(site_store.metadata_backup_path()),
            **result,
        }

    return router
