from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi.responses import FileResponse, Response

from kera_research.api.control_plane_proxy import call_remote_control_plane_method, remote_control_plane_is_primary
from kera_research.services.federated_update_security import (
    FederatedPrivacyRuntimePolicyError,
    assert_federated_privacy_runtime_ready,
    latest_federated_dp_budget_snapshot,
)


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
    ReleaseRolloutRequest = support.ReleaseRolloutRequest

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

    @router.post("/api/admin/model-versions/{version_id}/activate-local")
    def activate_local_model_version(
        version_id: str,
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
    ) -> dict[str, Any]:
        require_platform_admin(user)
        return registry_orchestrator.activate_local_model_version(cp, version_id=version_id)

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

    @router.get("/api/admin/release-rollouts")
    def list_release_rollouts(
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
        authorization: str | None = Header(default=None),
        control_plane_owner: str | None = Header(default=None, alias="x-kera-control-plane-owner"),
    ) -> list[dict[str, Any]]:
        require_platform_admin(user)
        remote_rollouts = call_remote_control_plane_method(
            cp,
            authorization=authorization,
            control_plane_owner=control_plane_owner,
            method_name="main_admin_release_rollouts",
        )
        if remote_rollouts is not None:
            return remote_rollouts
        if remote_control_plane_is_primary(cp, control_plane_owner=control_plane_owner):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Central control plane release rollouts are unavailable.",
            )
        return []

    @router.post("/api/admin/release-rollouts")
    def create_release_rollout(
        payload: ReleaseRolloutRequest,
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
        authorization: str | None = Header(default=None),
        control_plane_owner: str | None = Header(default=None, alias="x-kera-control-plane-owner"),
    ) -> dict[str, Any]:
        require_platform_admin(user)
        remote_rollout = call_remote_control_plane_method(
            cp,
            authorization=authorization,
            control_plane_owner=control_plane_owner,
            method_name="main_admin_create_release_rollout",
            payload_json=payload.model_dump(),
        )
        if remote_rollout is not None:
            return remote_rollout
        if payload.stage in {"pilot", "partial"}:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Staged rollout requires the central control plane.",
            )
        activated = registry_orchestrator.activate_local_model_version(cp, version_id=payload.version_id)
        return {
            "rollout": {
                "rollout_id": f"local_rollout_{payload.version_id}",
                "version_id": payload.version_id,
                "version_name": activated["model_version"].get("version_name") or payload.version_id,
                "architecture": activated["model_version"].get("architecture") or "unknown",
                "previous_version_id": None,
                "previous_version_name": None,
                "stage": payload.stage,
                "status": "active",
                "target_site_ids": [],
                "notes": payload.notes,
                "created_by_user_id": user.get("user_id"),
                "created_at": activated["model_version"].get("created_at"),
                "activated_at": activated["model_version"].get("created_at"),
                "superseded_at": None,
                "metadata_json": {"fallback": "local_only"},
            }
        }

    @router.get("/api/admin/federation/monitoring")
    def get_federation_monitoring(
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
        authorization: str | None = Header(default=None),
        control_plane_owner: str | None = Header(default=None, alias="x-kera-control-plane-owner"),
    ) -> dict[str, Any]:
        require_platform_admin(user)
        remote_summary = call_remote_control_plane_method(
            cp,
            authorization=authorization,
            control_plane_owner=control_plane_owner,
            method_name="main_admin_federation_monitoring",
        )
        if remote_summary is not None:
            return remote_summary
        current_model = cp.current_global_model()
        visible_sites = cp.list_sites()
        site_adoption = [
            {
                "site_id": str(site.get("site_id") or ""),
                "site_display_name": str(site.get("hospital_name") or site.get("display_name") or site.get("site_id") or ""),
                "node_count": 0,
                "active_node_count": 0,
                "aligned_node_count": 0,
                "unknown_node_count": 0,
                "lagging_node_count": 0,
                "expected_version_id": current_model.get("version_id") if isinstance(current_model, dict) else None,
                "expected_version_name": current_model.get("version_name") if isinstance(current_model, dict) else None,
                "latest_reported_version_id": None,
                "latest_reported_version_name": None,
                "latest_validation_version_id": None,
                "latest_validation_version_name": None,
                "latest_validation_run_date": None,
                "last_seen_at": None,
            }
            for site in visible_sites
        ]
        return {
            "current_release": current_model,
            "active_rollout": None,
            "recent_rollouts": [],
            "recent_audit_events": cp.list_audit_events(limit=12),
            "privacy_budget": latest_federated_dp_budget_snapshot(cp.list_aggregations()),
            "node_summary": {
                "total_nodes": 0,
                "active_nodes": 0,
                "aligned_nodes": 0,
                "lagging_nodes": 0,
                "unknown_nodes": 0,
            },
            "site_adoption": site_adoption,
        }

    @router.get("/api/admin/federation/privacy-report")
    def get_federated_privacy_report(
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
        authorization: str | None = Header(default=None),
        control_plane_owner: str | None = Header(default=None, alias="x-kera-control-plane-owner"),
    ) -> dict[str, Any]:
        require_platform_admin(user)
        remote_report = call_remote_control_plane_method(
            cp,
            authorization=authorization,
            control_plane_owner=control_plane_owner,
            method_name="main_admin_federation_privacy_report",
        )
        if remote_report is not None:
            return remote_report
        if remote_control_plane_is_primary(cp, control_plane_owner=control_plane_owner):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Central control plane privacy report is unavailable.",
            )

        aggregations = cp.list_aggregations()
        privacy_budget = latest_federated_dp_budget_snapshot(aggregations)
        if not bool(privacy_budget.get("formal_dp_accounting")):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A current privacy budget is not available yet.",
            )

        current_model = cp.current_global_model()
        visible_sites = cp.list_sites()
        site_adoption = [
            {
                "site_id": str(site.get("site_id") or ""),
                "site_display_name": str(site.get("hospital_name") or site.get("display_name") or site.get("site_id") or ""),
                "node_count": 0,
                "active_node_count": 0,
                "aligned_node_count": 0,
                "unknown_node_count": 0,
                "lagging_node_count": 0,
                "expected_version_id": current_model.get("version_id") if isinstance(current_model, dict) else None,
                "expected_version_name": current_model.get("version_name") if isinstance(current_model, dict) else None,
                "latest_reported_version_id": None,
                "latest_reported_version_name": None,
                "latest_validation_version_id": None,
                "latest_validation_version_name": None,
                "latest_validation_run_date": None,
                "last_seen_at": None,
            }
            for site in visible_sites
        ]
        cp.write_audit_event(
            actor_type="user",
            actor_id=str(user.get("user_id") or "").strip() or None,
            action="federation.privacy_report.exported",
            target_type="federation",
            target_id=str(privacy_budget.get("last_accounted_aggregation_id") or "").strip() or None,
            payload={
                "report_type": "federated_privacy_budget_report",
                "accountant": privacy_budget.get("accountant"),
                "accountant_scope": privacy_budget.get("accountant_scope"),
                "epsilon": privacy_budget.get("epsilon"),
                "delta": privacy_budget.get("delta"),
                "accounted_aggregations": privacy_budget.get("accounted_aggregations"),
                "accounted_updates": privacy_budget.get("accounted_updates"),
                "accounted_sites": privacy_budget.get("accounted_sites"),
                "last_accounted_new_version_name": privacy_budget.get("last_accounted_new_version_name"),
            },
        )
        return {
            "report_type": "federated_privacy_budget_report",
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "current_release": current_model,
            "active_rollout": None,
            "node_summary": {
                "total_nodes": 0,
                "active_nodes": 0,
                "aligned_nodes": 0,
                "lagging_nodes": 0,
                "unknown_nodes": 0,
            },
            "site_adoption": site_adoption,
            "privacy_budget": privacy_budget,
            "recent_aggregations": aggregations[:12],
            "recent_rollouts": [],
            "recent_audit_events": cp.list_audit_events(limit=20),
        }

    @router.post("/api/admin/aggregations/run")
    def run_federated_aggregation(
        payload: AggregationRunRequest,
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
    ) -> dict[str, Any]:
        require_platform_admin(user)
        try:
            assert_federated_privacy_runtime_ready(operation="Federated aggregation")
        except FederatedPrivacyRuntimePolicyError as exc:
            raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
        return registry_orchestrator.run_federated_aggregation(
            cp,
            get_workflow=get_workflow,
            selected_update_ids=payload.update_ids,
            new_version_name=payload.new_version_name,
        )

    @router.get("/api/admin/aggregations/jobs")
    def list_aggregation_jobs(
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
    ) -> list[dict[str, Any]]:
        require_platform_admin(user)
        return registry_orchestrator.list_aggregation_jobs(cp=cp)

    @router.get("/api/admin/aggregations/jobs/{job_id}")
    def get_aggregation_job(
        job_id: str,
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
    ) -> dict[str, Any]:
        require_platform_admin(user)
        return registry_orchestrator.get_aggregation_job(job_id, cp=cp)

    return router
