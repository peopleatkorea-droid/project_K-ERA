from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi.responses import FileResponse, Response

from kera_research.api.control_plane_proxy import call_remote_control_plane_method, remote_control_plane_is_primary


def build_admin_registry_router(support: Any) -> APIRouter:
    router = APIRouter()

    get_control_plane = support.get_control_plane
    get_approved_user = support.get_approved_user
    get_workflow = support.get_workflow
    require_admin_workspace_permission = support.require_admin_workspace_permission
    require_platform_admin = support.require_platform_admin
    require_site_access = support.require_site_access
    visible_model_updates = support.visible_model_updates
    embedded_review_artifact_response = support.embedded_review_artifact_response
    load_approval_report = support.load_approval_report
    registry_orchestrator = support.registry_orchestrator

    ModelUpdateReviewRequest = support.ModelUpdateReviewRequest
    ModelVersionPublishRequest = support.ModelVersionPublishRequest
    ModelVersionAutoPublishRequest = support.ModelVersionAutoPublishRequest
    AggregationRunRequest = support.AggregationRunRequest

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

    return router
