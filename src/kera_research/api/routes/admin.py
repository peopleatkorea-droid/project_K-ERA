from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi.responses import FileResponse, Response
from kera_research.api.admin_workflows import (
    build_admin_overview as build_admin_workspace_overview,
)
from kera_research.api.control_plane_proxy import call_remote_control_plane_method, remote_control_plane_is_primary
from kera_research.services.institution_directory import HiraApiError

FIXED_PROJECT_ID = "project_default"
FIXED_PROJECT_NAME = "Default Workspace"
FIXED_RESEARCHER_ROLE = "researcher"


def resolve_fixed_project(cp: Any, owner_user_id: str | None = None) -> dict[str, Any]:
    projects = cp.list_projects()
    fixed_project = next((project for project in projects if project.get("project_id") == FIXED_PROJECT_ID), None)
    if fixed_project is not None:
        return fixed_project
    if projects:
        return projects[0]
    return cp.create_project(FIXED_PROJECT_NAME, "", str(owner_user_id or "").strip() or "system")


def build_admin_router(support: Any) -> APIRouter:
    router = APIRouter()

    get_control_plane = support.get_control_plane
    get_approved_user = support.get_approved_user
    get_workflow = support.get_workflow
    require_admin_workspace_permission = support.require_admin_workspace_permission
    require_platform_admin = support.require_platform_admin
    require_site_access = support.require_site_access
    assert_request_review_permission = support.assert_request_review_permission
    visible_model_updates = support.visible_model_updates
    is_pending_model_update = support.is_pending_model_update
    normalize_storage_root = support.normalize_storage_root
    normalize_default_storage_root = support.normalize_default_storage_root
    invalidate_site_storage_root_cache = support.invalidate_site_storage_root_cache
    embedded_review_artifact_response = support.embedded_review_artifact_response
    load_approval_report = support.load_approval_report
    site_comparison_rows = support.site_comparison_rows
    hash_password = support.hash_password
    registry_orchestrator = support.registry_orchestrator
    make_id = support.make_id
    case_reference_salt_fingerprint = support.case_reference_salt_fingerprint

    AccessRequestReviewRequest = support.AccessRequestReviewRequest
    StorageSettingsUpdateRequest = support.StorageSettingsUpdateRequest
    ModelUpdateReviewRequest = support.ModelUpdateReviewRequest
    ModelVersionPublishRequest = support.ModelVersionPublishRequest
    ModelVersionAutoPublishRequest = support.ModelVersionAutoPublishRequest
    AggregationRunRequest = support.AggregationRunRequest
    ProjectCreateRequest = support.ProjectCreateRequest
    SiteCreateRequest = support.SiteCreateRequest
    SiteUpdateRequest = support.SiteUpdateRequest
    UserUpsertRequest = support.UserUpsertRequest
    SiteStorageRootUpdateRequest = support.SiteStorageRootUpdateRequest
    SiteMetadataRecoveryRequest = support.SiteMetadataRecoveryRequest

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
        target_site_id = (
            payload.assigned_site_id
            or access_request.get("resolved_site_id")
            or access_request["requested_site_id"]
        )

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

    @router.get("/api/admin/model-versions")
    def list_model_versions(
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
        authorization: str | None = Header(default=None),
        control_plane_owner: str | None = Header(default=None, alias="x-kera-control-plane-owner"),
    ) -> list[dict[str, Any]]:
        require_admin_workspace_permission(user)
        remote_versions = call_remote_control_plane_method(
            cp,
            authorization=authorization,
            control_plane_owner=control_plane_owner,
            method_name="main_admin_model_versions",
        )
        if remote_versions is not None:
            return remote_versions
        if remote_control_plane_is_primary(cp, control_plane_owner=control_plane_owner):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Central control plane model versions are unavailable.",
            )
        return cp.list_model_versions()

    @router.get("/api/admin/experiments")
    def list_experiments(
        site_id: str | None = None,
        experiment_type: str | None = None,
        status_filter: str | None = None,
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
    ) -> list[dict[str, Any]]:
        require_admin_workspace_permission(user)
        experiments = cp.list_experiments(site_id=site_id, experiment_type=experiment_type, status_filter=status_filter)
        if user.get("role") == "admin":
            return experiments
        accessible_site_ids = {site["site_id"] for site in cp.accessible_sites_for_user(user)}
        return [item for item in experiments if item.get("site_id") in accessible_site_ids]

    @router.get("/api/admin/experiments/{experiment_id}")
    def get_experiment(
        experiment_id: str,
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        experiment = cp.get_experiment(experiment_id)
        if experiment is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Experiment not found.")
        if user.get("role") != "admin":
            accessible_site_ids = {site["site_id"] for site in cp.accessible_sites_for_user(user)}
            if experiment.get("site_id") not in accessible_site_ids:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Experiment not found.")
        return experiment

    @router.delete("/api/admin/model-versions/{version_id}")
    def archive_model_version(
        version_id: str,
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        if user.get("role") != "admin":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only platform admin can delete models.")
        try:
            return {"model_version": cp.archive_model_version(version_id)}
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.post("/api/admin/model-versions/{version_id}/publish")
    def publish_model_version(
        version_id: str,
        payload: ModelVersionPublishRequest,
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
    ) -> dict[str, Any]:
        require_platform_admin(user)
        return registry_orchestrator.publish_model_version(
            cp,
            version_id=version_id,
            download_url=payload.download_url,
            set_current=payload.set_current,
        )

    @router.post("/api/admin/model-versions/{version_id}/auto-publish")
    def auto_publish_model_version(
        version_id: str,
        payload: ModelVersionAutoPublishRequest,
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
    ) -> dict[str, Any]:
        require_platform_admin(user)
        return registry_orchestrator.auto_publish_model_version(
            cp,
            version_id=version_id,
            set_current=payload.set_current,
        )

    @router.get("/api/admin/model-updates")
    def list_model_updates(
        site_id: str | None = None,
        status_filter: str | None = None,
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
        authorization: str | None = Header(default=None),
        control_plane_owner: str | None = Header(default=None, alias="x-kera-control-plane-owner"),
    ) -> list[dict[str, Any]]:
        require_admin_workspace_permission(user)
        remote_updates = call_remote_control_plane_method(
            cp,
            authorization=authorization,
            control_plane_owner=control_plane_owner,
            method_name="main_admin_model_updates",
            site_id=site_id,
            status_filter=status_filter,
        )
        if remote_updates is not None:
            return remote_updates
        if remote_control_plane_is_primary(cp, control_plane_owner=control_plane_owner):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Central control plane model updates are unavailable.",
            )
        if site_id:
            require_site_access(cp, user, site_id)
        return visible_model_updates(cp, user, site_id=site_id, status_filter=status_filter)

    @router.post("/api/admin/model-updates/{update_id}/review")
    def review_model_update(
        update_id: str,
        payload: ModelUpdateReviewRequest,
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        update_record = cp.get_model_update(update_id)
        if update_record is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown model update.")
        site_id = str(update_record.get("site_id") or "").strip()
        if site_id:
            require_site_access(cp, user, site_id)
        return registry_orchestrator.review_model_update(
            cp,
            update_id=update_id,
            reviewer_user_id=user["user_id"],
            decision=payload.decision,
            reviewer_notes=payload.reviewer_notes,
            get_workflow=get_workflow,
        )

    @router.post("/api/admin/model-updates/{update_id}/publish")
    def publish_model_update(
        update_id: str,
        payload: ModelVersionPublishRequest,
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
    ) -> dict[str, Any]:
        require_platform_admin(user)
        return registry_orchestrator.publish_model_update(
            cp,
            update_id=update_id,
            download_url=payload.download_url,
        )

    @router.post("/api/admin/model-updates/{update_id}/auto-publish")
    def auto_publish_model_update(
        update_id: str,
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
    ) -> dict[str, Any]:
        require_platform_admin(user)
        return registry_orchestrator.auto_publish_model_update(cp, update_id=update_id)

    @router.get("/api/admin/model-updates/{update_id}/artifacts/{artifact_kind}")
    def get_model_update_artifact(
        update_id: str,
        artifact_kind: str,
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
    ) -> Response:
        require_admin_workspace_permission(user)
        update_record = cp.get_model_update(update_id)
        if update_record is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown model update.")
        site_id = str(update_record.get("site_id") or "").strip()
        if site_id:
            require_site_access(cp, user, site_id)
        report = load_approval_report(update_record)
        artifacts = report.get("artifacts") if isinstance(report, dict) else {}
        if not isinstance(artifacts, dict):
            artifacts = {}
        embedded_key = {
            "source_thumbnail": "source_thumbnail",
            "roi_thumbnail": "roi_thumbnail",
            "mask_thumbnail": "mask_thumbnail",
        }.get(artifact_kind)
        if embedded_key is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported artifact kind.")
        embedded_artifact = artifacts.get(embedded_key)
        if isinstance(embedded_artifact, dict):
            embedded_response = embedded_review_artifact_response(embedded_artifact)
            if embedded_response is not None:
                return embedded_response

        legacy_path_key = {
            "source_thumbnail": "source_thumbnail_path",
            "roi_thumbnail": "roi_thumbnail_path",
            "mask_thumbnail": "mask_thumbnail_path",
        }[artifact_kind]
        artifact_path = str(artifacts.get(legacy_path_key) or "").strip()
        if artifact_path and Path(artifact_path).exists():
            return FileResponse(artifact_path)
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artifact is not available.")

    @router.get("/api/admin/aggregations")
    def list_aggregations(
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
        authorization: str | None = Header(default=None),
        control_plane_owner: str | None = Header(default=None, alias="x-kera-control-plane-owner"),
    ) -> list[dict[str, Any]]:
        require_platform_admin(user)
        remote_aggregations = call_remote_control_plane_method(
            cp,
            authorization=authorization,
            control_plane_owner=control_plane_owner,
            method_name="main_admin_aggregations",
        )
        if remote_aggregations is not None:
            return remote_aggregations
        if remote_control_plane_is_primary(cp, control_plane_owner=control_plane_owner):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Central control plane aggregations are unavailable.",
            )
        return cp.list_aggregations()

    @router.post("/api/admin/aggregations/run")
    def run_federated_aggregation(
        payload: AggregationRunRequest,
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
    ) -> dict[str, Any]:
        require_platform_admin(user)
        return registry_orchestrator.run_federated_aggregation(
            cp,
            get_workflow=get_workflow,
            selected_update_ids=payload.update_ids,
            new_version_name=payload.new_version_name,
        )

    @router.get("/api/admin/aggregations/jobs")
    def list_aggregation_jobs(
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> list[dict[str, Any]]:
        require_platform_admin(user)
        return registry_orchestrator.list_aggregation_jobs()

    @router.get("/api/admin/aggregations/jobs/{job_id}")
    def get_aggregation_job(
        job_id: str,
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_platform_admin(user)
        return registry_orchestrator.get_aggregation_job(job_id)

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
                str(fixed_project.get("project_id") or FIXED_PROJECT_ID),
                payload.site_code,
                payload.display_name,
                payload.hospital_name,
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
                payload.display_name,
                payload.hospital_name,
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

    return router
