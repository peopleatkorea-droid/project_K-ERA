from datetime import datetime, timezone
from pathlib import Path
import threading
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse, Response


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
    embedded_review_artifact_response = support.embedded_review_artifact_response
    load_approval_report = support.load_approval_report
    site_comparison_rows = support.site_comparison_rows
    hash_password = support.hash_password
    agg_jobs = support.agg_jobs
    agg_jobs_lock = support.agg_jobs_lock
    agg_running = support.agg_running
    make_id = support.make_id
    model_dir = support.model_dir
    case_reference_salt_fingerprint = support.case_reference_salt_fingerprint

    AccessRequestReviewRequest = support.AccessRequestReviewRequest
    StorageSettingsUpdateRequest = support.StorageSettingsUpdateRequest
    ModelUpdateReviewRequest = support.ModelUpdateReviewRequest
    AggregationRunRequest = support.AggregationRunRequest
    ProjectCreateRequest = support.ProjectCreateRequest
    SiteCreateRequest = support.SiteCreateRequest
    SiteUpdateRequest = support.SiteUpdateRequest
    UserUpsertRequest = support.UserUpsertRequest
    SiteStorageRootUpdateRequest = support.SiteStorageRootUpdateRequest

    @router.get("/api/admin/access-requests")
    def list_access_requests(
        status_filter: str | None = None,
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
    ) -> list[dict[str, Any]]:
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
    ) -> dict[str, Any]:
        access_request = next((item for item in cp.list_access_requests() if item["request_id"] == request_id), None)
        if access_request is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown access request.")
        target_site_id = payload.assigned_site_id or access_request["requested_site_id"]
        assert_request_review_permission(cp, user, target_site_id)
        if payload.decision not in {"approved", "rejected"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid review decision.")
        if payload.decision == "approved" and payload.assigned_role not in {None, "site_admin", "researcher", "viewer"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid assigned role.")
        reviewed = cp.review_access_request(
            request_id=request_id,
            reviewer_user_id=user["user_id"],
            decision=payload.decision,
            assigned_role=payload.assigned_role,
            assigned_site_id=payload.assigned_site_id,
            reviewer_notes=payload.reviewer_notes,
        )
        return {"request": reviewed}

    @router.get("/api/admin/overview")
    def admin_overview(
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        visible_sites = cp.list_sites() if user.get("role") == "admin" else cp.accessible_sites_for_user(user)
        pending_requests = (
            cp.list_access_requests(status="pending")
            if user.get("role") == "admin"
            else cp.list_access_requests(status="pending", site_ids=[site["site_id"] for site in visible_sites])
        )
        visible_updates = [item for item in visible_model_updates(cp, user) if is_pending_model_update(item)]
        current_model = cp.current_global_model()
        overview = {
            "site_count": len(visible_sites),
            "model_version_count": len(cp.list_model_versions()),
            "pending_access_requests": len(pending_requests),
            "pending_model_updates": len(visible_updates),
            "current_model_version": current_model.get("version_name") if current_model else None,
        }
        if user.get("role") == "admin":
            overview["aggregation_count"] = len(cp.list_aggregations())
        return overview

    @router.get("/api/admin/storage-settings")
    def get_storage_settings(
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        default_root = str(cp.default_instance_storage_root())
        current_root = cp.instance_storage_root()
        return {
            "storage_root": current_root,
            "default_storage_root": default_root,
            "uses_custom_root": current_root != default_root,
        }

    @router.patch("/api/admin/storage-settings")
    def update_storage_settings(
        payload: StorageSettingsUpdateRequest,
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        try:
            normalized_root = normalize_storage_root(payload.storage_root)
            cp.set_app_setting("instance_storage_root", str(normalized_root))
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        default_root = str(cp.default_instance_storage_root())
        return {
            "storage_root": cp.instance_storage_root(),
            "default_storage_root": default_root,
            "uses_custom_root": cp.instance_storage_root() != default_root,
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
    ) -> list[dict[str, Any]]:
        require_admin_workspace_permission(user)
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

    @router.get("/api/admin/model-updates")
    def list_model_updates(
        site_id: str | None = None,
        status_filter: str | None = None,
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
    ) -> list[dict[str, Any]]:
        require_admin_workspace_permission(user)
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

        if payload.decision.strip().lower() == "approved":
            delta_path = str(update_record.get("central_artifact_path") or update_record.get("artifact_path") or "")
            if not delta_path or not Path(delta_path).exists():
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Delta artifact file is missing — cannot approve.",
                )
            try:
                import torch as _torch

                checkpoint = _torch.load(delta_path, map_location="cpu", weights_only=True)
                delta_state = checkpoint.get("state_dict") if isinstance(checkpoint, dict) else None
                if delta_state is None:
                    raise ValueError("Delta file has no state_dict key.")
                workflow = get_workflow(cp)
                workflow.model_manager._validate_deltas([delta_state])
            except ValueError as exc:
                cp.review_model_update(
                    update_id,
                    reviewer_user_id=user["user_id"],
                    decision="rejected",
                    reviewer_notes=f"[Auto-rejected by validation] {exc}",
                )
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Delta validation failed — update auto-rejected: {exc}",
                ) from exc
            except Exception as exc:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Delta file could not be loaded: {exc}",
                ) from exc

        try:
            reviewed = cp.review_model_update(
                update_id,
                reviewer_user_id=user["user_id"],
                decision=payload.decision,
                reviewer_notes=payload.reviewer_notes,
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        return {"update": reviewed}

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
    ) -> list[dict[str, Any]]:
        require_platform_admin(user)
        return cp.list_aggregations()

    @router.post("/api/admin/aggregations/run")
    def run_federated_aggregation(
        payload: AggregationRunRequest,
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
    ) -> dict[str, Any]:
        require_platform_admin(user)

        if agg_running.is_set():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Another aggregation job is already running. Poll /api/admin/aggregations/jobs to check status.",
            )

        workflow = get_workflow(cp)
        selected_ids = set(payload.update_ids)
        approved_updates = [
            item
            for item in cp.list_model_updates()
            if item.get("status") == "approved" and (not selected_ids or item.get("update_id") in selected_ids)
        ]
        if not approved_updates:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No approved updates are available for aggregation.",
            )

        site_update_counts: dict[str, int] = {}
        for item in approved_updates:
            site_key = str(item.get("site_id") or "unknown")
            site_update_counts[site_key] = site_update_counts.get(site_key, 0) + 1
        duplicate_sites = sorted(site_id for site_id, count in site_update_counts.items() if count > 1)
        if duplicate_sites:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Only one approved update per site can be aggregated at a time. Duplicate sites: {', '.join(duplicate_sites)}.",
            )

        architectures = {item.get("architecture") for item in approved_updates}
        if len(architectures) != 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Only updates with the same architecture can be aggregated together.",
            )
        architecture = next(iter(architectures))

        base_model_ids = {item.get("base_model_version_id") for item in approved_updates}
        if len(base_model_ids) != 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Only updates based on the same global model can be aggregated together.",
            )
        base_model_version_id = next(iter(base_model_ids))
        base_model = next(
            (item for item in cp.list_model_versions() if item.get("version_id") == base_model_version_id),
            cp.current_global_model(),
        )
        if base_model is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="No global model is available for aggregation.",
            )

        delta_paths = [str(item.get("central_artifact_path") or item.get("artifact_path") or "") for item in approved_updates]
        missing_paths = [path for path in delta_paths if not path or not Path(path).exists()]
        if missing_paths:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="One or more approved update artifacts are missing on disk.",
            )

        site_weights: dict[str, int] = {}
        delta_weights: list[int] = []
        for update_record in approved_updates:
            site_key = str(update_record.get("site_id") or "unknown")
            n_cases = max(1, int(update_record.get("n_cases", 1) or 1))
            site_weights[site_key] = site_weights.get(site_key, 0) + n_cases
            delta_weights.append(n_cases)

        new_version_name = (payload.new_version_name or "").strip() or f"global-{architecture}-fedavg-{make_id('v')[:6]}"
        output_path = model_dir / f"global_{architecture}_{make_id('agg')}.pth"
        update_ids = [item["update_id"] for item in approved_updates]

        job_id = make_id("job")
        job_record: dict[str, Any] = {
            "job_id": job_id,
            "status": "running",
            "result": None,
            "error": None,
            "started_at": datetime.now(timezone.utc).isoformat(),
            "finished_at": None,
        }
        with agg_jobs_lock:
            agg_jobs[job_id] = job_record

        def run() -> None:
            agg_running.set()
            try:
                workflow.model_manager.aggregate_weight_deltas(
                    delta_paths,
                    output_path,
                    weights=delta_weights,
                    base_model_path=base_model["model_path"],
                )
                aggregation = cp.register_aggregation(
                    base_model_version_id=base_model["version_id"],
                    new_model_path=str(output_path),
                    new_version_name=new_version_name,
                    architecture=str(architecture or base_model.get("architecture") or "unknown"),
                    site_weights=site_weights,
                    requires_medsam_crop=bool(base_model.get("requires_medsam_crop", False)),
                    decision_threshold=base_model.get("decision_threshold"),
                    threshold_selection_metric="inherited_from_base_model",
                    threshold_selection_metrics={
                        "source_model_version_id": base_model.get("version_id"),
                        "source_decision_threshold": base_model.get("decision_threshold"),
                    },
                )
                cp.update_model_update_statuses(update_ids, "aggregated")
                model_version = next(
                    (item for item in cp.list_model_versions() if item.get("aggregation_id") == aggregation["aggregation_id"]),
                    cp.current_global_model(),
                )
                with agg_jobs_lock:
                    agg_jobs[job_id].update(
                        {
                            "status": "done",
                            "result": {
                                "aggregation": aggregation,
                                "model_version": model_version,
                                "aggregated_update_ids": update_ids,
                            },
                            "finished_at": datetime.now(timezone.utc).isoformat(),
                        }
                    )
            except Exception as exc:
                with agg_jobs_lock:
                    agg_jobs[job_id].update(
                        {
                            "status": "failed",
                            "error": str(exc),
                            "finished_at": datetime.now(timezone.utc).isoformat(),
                        }
                    )
            finally:
                agg_running.clear()

        t = threading.Thread(target=run, daemon=True)
        t.start()
        t.join(timeout=0.25)

        with agg_jobs_lock:
            job_snapshot = dict(agg_jobs.get(job_id) or {})
        if job_snapshot.get("status") == "done" and isinstance(job_snapshot.get("result"), dict):
            return job_snapshot["result"]
        if job_snapshot.get("status") == "failed":
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=str(job_snapshot.get("error") or "Aggregation job failed."),
            )

        return {"job_id": job_id, "status": "running"}

    @router.get("/api/admin/aggregations/jobs")
    def list_aggregation_jobs(
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> list[dict[str, Any]]:
        require_platform_admin(user)
        with agg_jobs_lock:
            return list(agg_jobs.values())

    @router.get("/api/admin/aggregations/jobs/{job_id}")
    def get_aggregation_job(
        job_id: str,
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_platform_admin(user)
        with agg_jobs_lock:
            job = agg_jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Aggregation job not found.")
        return job

    @router.get("/api/admin/projects")
    def list_projects(
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
    ) -> list[dict[str, Any]]:
        require_admin_workspace_permission(user)
        return cp.list_projects()

    @router.post("/api/admin/projects")
    def create_project(
        payload: ProjectCreateRequest,
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
    ) -> dict[str, Any]:
        require_platform_admin(user)
        try:
            return cp.create_project(payload.name, payload.description, user["user_id"])
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.get("/api/admin/sites")
    def list_admin_sites(
        project_id: str | None = None,
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
    ) -> list[dict[str, Any]]:
        require_admin_workspace_permission(user)
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
    ) -> dict[str, Any]:
        require_platform_admin(user)
        try:
            return cp.create_site(
                payload.project_id,
                payload.site_code,
                payload.display_name,
                payload.hospital_name,
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.patch("/api/admin/sites/{site_id}")
    def update_site(
        site_id: str,
        payload: SiteUpdateRequest,
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
    ) -> dict[str, Any]:
        require_platform_admin(user)
        try:
            return cp.update_site_metadata(site_id, payload.display_name, payload.hospital_name)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.get("/api/admin/users")
    def list_users(
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
    ) -> list[dict[str, Any]]:
        require_platform_admin(user)
        return cp.list_users()

    @router.post("/api/admin/users")
    def upsert_user(
        payload: UserUpsertRequest,
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
    ) -> dict[str, Any]:
        require_platform_admin(user)
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

    return router
