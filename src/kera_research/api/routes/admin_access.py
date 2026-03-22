from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, status

from kera_research.api.admin_workflows import (
    build_admin_overview as build_admin_workspace_overview,
)
from kera_research.api.control_plane_proxy import call_remote_control_plane_method, remote_control_plane_is_primary
from kera_research.api.routes.admin_shared import (
    FIXED_PROJECT_ID,
    FIXED_RESEARCHER_ROLE,
    resolve_fixed_project,
)
from kera_research.services.institution_directory import HiraApiError


def build_admin_access_router(support: Any) -> APIRouter:
    router = APIRouter()

    get_control_plane = support.get_control_plane
    get_approved_user = support.get_approved_user
    require_admin_workspace_permission = support.require_admin_workspace_permission
    require_platform_admin = support.require_platform_admin
    assert_request_review_permission = support.assert_request_review_permission
    visible_model_updates = support.visible_model_updates
    is_pending_model_update = support.is_pending_model_update
    normalize_default_storage_root = support.normalize_default_storage_root
    invalidate_site_storage_root_cache = support.invalidate_site_storage_root_cache
    case_reference_salt_fingerprint = support.case_reference_salt_fingerprint

    AccessRequestReviewRequest = support.AccessRequestReviewRequest
    StorageSettingsUpdateRequest = support.StorageSettingsUpdateRequest

    @router.get("/api/admin/access-requests")
    def list_access_requests(
        status_filter: str | None = None,
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
        authorization: str | None = Header(default=None),
        control_plane_owner: str | None = Header(default=None, alias="x-kera-control-plane-owner"),
    ) -> list[dict[str, Any]]:
        remote_requests = call_remote_control_plane_method(
            cp,
            authorization=authorization,
            control_plane_owner=control_plane_owner,
            method_name="main_admin_access_requests",
            status_filter=status_filter,
        )
        if remote_requests is not None:
            return remote_requests
        if remote_control_plane_is_primary(cp, control_plane_owner=control_plane_owner):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Central control plane access requests are unavailable.",
            )
        if user.get("role") == "admin":
            return cp.list_access_requests(status=status_filter)
        if user.get("role") == "site_admin":
            site_ids = list(user.get("site_ids") or [])
            if not site_ids:
                return []
            return cp.list_access_requests(status=status_filter, site_ids=site_ids)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin or site admin access required.")

    @router.post("/api/admin/access-requests/{request_id}/review")
    def review_access_request(
        request_id: str,
        payload: AccessRequestReviewRequest,
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
        authorization: str | None = Header(default=None),
        control_plane_owner: str | None = Header(default=None, alias="x-kera-control-plane-owner"),
    ) -> dict[str, Any]:
        remote_review = call_remote_control_plane_method(
            cp,
            authorization=authorization,
            control_plane_owner=control_plane_owner,
            method_name="main_admin_review_access_request",
            request_id=request_id,
            payload_json=payload.model_dump(),
        )
        if remote_review is not None:
            return remote_review
        if remote_control_plane_is_primary(cp, control_plane_owner=control_plane_owner):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Central control plane request review is unavailable.",
            )
        access_request = next((item for item in cp.list_access_requests() if item["request_id"] == request_id), None)
        if access_request is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown access request.")
        if payload.decision not in {"approved", "rejected"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid review decision.")
        if payload.decision == "approved" and payload.assigned_role not in {None, FIXED_RESEARCHER_ROLE}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Access requests can only be approved as researcher accounts.",
            )
        created_site = None
        target_site_id = payload.assigned_site_id or access_request.get("resolved_site_id") or access_request["requested_site_id"]

        if payload.create_site_if_missing:
            require_platform_admin(user)
            if payload.decision != "approved":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Site creation during request review is only available for approvals.",
                )
            if access_request.get("requested_site_source") != "institution_directory":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Only institution-directory requests can create a new site during review.",
                )
            institution_id = str(access_request.get("requested_site_id") or "").strip()
            mapped_site = cp.get_site_by_source_institution_id(institution_id)
            if mapped_site is None:
                if not payload.site_code or not payload.display_name:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="site_code and display_name are required to create a site from this request.",
                    )
                institution = cp.get_institution(institution_id)
                fixed_project = resolve_fixed_project(cp, user.get("user_id"))
                try:
                    created_site = cp.create_site(
                        str(fixed_project.get("project_id") or FIXED_PROJECT_ID),
                        payload.site_code,
                        payload.display_name,
                        payload.hospital_name
                        or str(institution.get("name") if institution is not None else access_request.get("requested_site_label") or ""),
                        source_institution_id=institution_id,
                        research_registry_enabled=payload.research_registry_enabled,
                    )
                except ValueError as exc:
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
                target_site_id = created_site["site_id"]
            else:
                target_site_id = mapped_site["site_id"]
        elif cp.get_site(target_site_id) is not None:
            assert_request_review_permission(cp, user, target_site_id)

        if payload.decision == "approved" and cp.get_site(target_site_id) is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Approved access requests must be assigned to an existing site.",
            )
        try:
            reviewed = cp.review_access_request(
                request_id=request_id,
                reviewer_user_id=user["user_id"],
                decision=payload.decision,
                assigned_role=FIXED_RESEARCHER_ROLE if payload.decision == "approved" else payload.assigned_role,
                assigned_site_id=target_site_id,
                reviewer_notes=payload.reviewer_notes,
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        return {"request": reviewed, "created_site": created_site}

    @router.post("/api/admin/institutions/sync")
    def sync_institutions(
        page_size: int = 100,
        max_pages: int | None = None,
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
    ) -> dict[str, Any]:
        require_platform_admin(user)
        if page_size < 1 or page_size > 500:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="page_size must be between 1 and 500.",
            )
        if max_pages is not None and max_pages < 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="max_pages must be at least 1.",
            )
        try:
            return cp.sync_hira_ophthalmology_directory(page_size=page_size, max_pages=max_pages)
        except HiraApiError as exc:
            detail = str(exc)
            status_code = (
                status.HTTP_503_SERVICE_UNAVAILABLE
                if "not configured" in detail.lower()
                else status.HTTP_502_BAD_GATEWAY
            )
            raise HTTPException(status_code=status_code, detail=detail) from exc

    @router.get("/api/admin/institutions/status")
    def institution_sync_status(
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
        authorization: str | None = Header(default=None),
        control_plane_owner: str | None = Header(default=None, alias="x-kera-control-plane-owner"),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        remote_status = call_remote_control_plane_method(
            cp,
            authorization=authorization,
            control_plane_owner=control_plane_owner,
            method_name="main_admin_institution_status",
        )
        if remote_status is not None:
            return remote_status
        if remote_control_plane_is_primary(cp, control_plane_owner=control_plane_owner):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Central control plane institution status is unavailable.",
            )
        return cp.institution_directory_sync_status()

    @router.get("/api/admin/overview")
    def admin_overview(
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
        authorization: str | None = Header(default=None),
        control_plane_owner: str | None = Header(default=None, alias="x-kera-control-plane-owner"),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        remote_overview = call_remote_control_plane_method(
            cp,
            authorization=authorization,
            control_plane_owner=control_plane_owner,
            method_name="main_admin_overview",
        )
        if remote_overview is not None:
            return remote_overview
        if remote_control_plane_is_primary(cp, control_plane_owner=control_plane_owner):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Central control plane admin overview is unavailable.",
            )
        return build_admin_workspace_overview(
            cp,
            user,
            visible_model_updates=visible_model_updates,
            is_pending_model_update=is_pending_model_update,
        )

    @router.get("/api/admin/storage-settings")
    def get_storage_settings(
        site_id: str | None = None,
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        default_root = str(cp.default_instance_storage_root())
        effective_default_root = str(cp.configured_default_instance_storage_root())
        current_root = cp.instance_storage_root()
        source = cp.instance_storage_root_source()
        normalized_site_id = str(site_id or "").strip()
        selected_site_storage_root = cp.site_storage_root(normalized_site_id) if normalized_site_id else None
        return {
            "storage_root": current_root,
            "default_storage_root": default_root,
            "effective_default_storage_root": effective_default_root,
            "storage_root_source": source,
            "uses_custom_root": source == "custom",
            "selected_site_id": normalized_site_id or None,
            "selected_site_storage_root": selected_site_storage_root,
        }

    @router.patch("/api/admin/storage-settings")
    def update_storage_settings(
        payload: StorageSettingsUpdateRequest,
        site_id: str | None = None,
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        try:
            normalized_root = normalize_default_storage_root(payload.storage_root)
            cp.set_app_setting("instance_storage_root", str(normalized_root))
            invalidate_site_storage_root_cache()
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        default_root = str(cp.default_instance_storage_root())
        effective_default_root = str(cp.configured_default_instance_storage_root())
        source = cp.instance_storage_root_source()
        normalized_site_id = str(site_id or "").strip()
        selected_site_storage_root = cp.site_storage_root(normalized_site_id) if normalized_site_id else None
        return {
            "storage_root": cp.instance_storage_root(),
            "default_storage_root": default_root,
            "effective_default_storage_root": effective_default_root,
            "storage_root_source": source,
            "uses_custom_root": source == "custom",
            "selected_site_id": normalized_site_id or None,
            "selected_site_storage_root": selected_site_storage_root,
        }

    @router.get("/api/admin/system/salt-fingerprint")
    def get_salt_fingerprint(
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_platform_admin(user)
        return {"salt_fingerprint": case_reference_salt_fingerprint}

    return router
