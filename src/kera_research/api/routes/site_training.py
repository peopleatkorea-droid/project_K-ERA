from types import SimpleNamespace
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from kera_research.api.routes.site_shared import assert_site_access_only
from kera_research.api.site_jobs import (
    require_ready_model_version,
    resolve_execution_device_or_raise,
    serialize_site_model_version,
    start_cross_validation,
    start_initial_training,
    start_initial_training_benchmark,
    start_retrieval_baseline,
    start_site_validation,
    start_ssl_pretraining,
)
from kera_research.services.ssl_pretraining import SUPPORTED_SSL_ARCHITECTURES
from kera_research.services.data_plane import SiteStore


def build_site_training_router(support: Any) -> APIRouter:
    router = APIRouter()

    get_control_plane = support.get_control_plane
    get_approved_user = support.get_approved_user
    require_admin_workspace_permission = support.require_admin_workspace_permission
    require_validation_permission = support.require_validation_permission
    require_site_access = support.require_site_access
    user_can_access_site = support.user_can_access_site
    get_model_version = support.get_model_version
    resolve_execution_device = support.resolve_execution_device
    project_id_for_site = support.project_id_for_site
    queue_name_for_job_type = support.queue_name_for_job_type
    get_embedding_backfill_status = support.get_embedding_backfill_status
    latest_embedding_backfill_job = support.latest_embedding_backfill_job
    queue_site_embedding_backfill = support.queue_site_embedding_backfill
    site_level_validation_runs = support.site_level_validation_runs
    validation_case_rows = support.validation_case_rows
    model_dir = support.model_dir
    make_id = support.make_id
    training_architectures = support.training_architectures
    load_cross_validation_reports = support.load_cross_validation_reports

    SiteValidationRunRequest = support.SiteValidationRunRequest
    InitialTrainingRequest = support.InitialTrainingRequest
    InitialTrainingBenchmarkRequest = support.InitialTrainingBenchmarkRequest
    ResumeBenchmarkRequest = support.ResumeBenchmarkRequest
    EmbeddingBackfillRequest = support.EmbeddingBackfillRequest
    CrossValidationRunRequest = support.CrossValidationRunRequest
    SSLPretrainingRunRequest = support.SSLPretrainingRunRequest
    RetrievalBaselineRequest = support.RetrievalBaselineRequest

    @router.get("/api/sites/{site_id}/validations")
    def list_site_validations(
        site_id: str,
        limit: int | None = None,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> list[dict[str, Any]]:
        assert_site_access_only(user, site_id, user_can_access_site=user_can_access_site)
        normalized_limit = max(1, min(int(limit or 0), 100)) if limit else None
        return site_level_validation_runs(cp.list_validation_runs(site_id=site_id, limit=normalized_limit))

    @router.get("/api/sites/{site_id}/validations/{validation_id}/cases")
    def list_validation_cases(
        site_id: str,
        validation_id: str,
        misclassified_only: bool = False,
        limit: int | None = 20,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> list[dict[str, Any]]:
        assert_site_access_only(user, site_id, user_can_access_site=user_can_access_site)
        try:
            site_store: SiteStore | None = SiteStore(site_id)
        except Exception:
            site_store = None
        validation_run = next((item for item in cp.list_validation_runs(site_id=site_id) if item.get("validation_id") == validation_id), None)
        if validation_run is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Validation run not found.")
        normalized_limit = max(0, min(limit if limit is not None else 20, 100))
        return validation_case_rows(cp, site_store, validation_id, misclassified_only=misclassified_only, limit=normalized_limit)

    @router.post("/api/sites/{site_id}/validations/run")
    def run_site_validation(
        site_id: str,
        payload: SiteValidationRunRequest,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_validation_permission(user)
        site_store = require_site_access(cp, user, site_id)
        model_version = require_ready_model_version(
            cp,
            get_model_version=get_model_version,
            model_version_id=payload.model_version_id,
            unavailable_detail="No ready model version is available for site validation.",
        )
        execution_device = resolve_execution_device_or_raise(
            resolve_execution_device=resolve_execution_device,
            execution_mode=payload.execution_mode,
            unavailable_label="Site validation",
        )
        return start_site_validation(
            site_store,
            site_id=site_id,
            project_id=project_id_for_site(cp, site_id),
            model_version=model_version,
            payload=payload,
            execution_device=execution_device,
            queue_name_for_job_type=queue_name_for_job_type,
        )

    @router.post("/api/sites/{site_id}/training/initial")
    def run_initial_training(
        site_id: str,
        payload: InitialTrainingRequest,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        site_store = require_site_access(cp, user, site_id)

        if payload.architecture not in training_architectures:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Initial training supports only these architectures: {', '.join(training_architectures)}",
            )
        execution_device = resolve_execution_device_or_raise(
            resolve_execution_device=resolve_execution_device,
            execution_mode=payload.execution_mode,
            unavailable_label="Initial training",
        )
        return start_initial_training(
            site_store,
            site_id=site_id,
            payload=payload,
            execution_device=execution_device,
            queue_name_for_job_type=queue_name_for_job_type,
            model_dir=model_dir,
            make_id=make_id,
        )

    @router.post("/api/sites/{site_id}/training/initial/benchmark")
    def run_initial_training_benchmark(
        site_id: str,
        payload: InitialTrainingBenchmarkRequest,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        site_store = require_site_access(cp, user, site_id)

        architectures = [str(item).strip() for item in payload.architectures if str(item).strip()]
        architectures = list(dict.fromkeys(architectures))
        if not architectures:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one architecture is required.")
        unsupported = [item for item in architectures if item not in training_architectures]
        if unsupported:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported architectures: {', '.join(unsupported)}. Supported: {', '.join(training_architectures)}",
            )
        execution_device = resolve_execution_device_or_raise(
            resolve_execution_device=resolve_execution_device,
            execution_mode=payload.execution_mode,
            unavailable_label="Initial benchmark training",
        )
        return start_initial_training_benchmark(
            site_store,
            site_id=site_id,
            payload=payload,
            architectures=architectures,
            execution_device=execution_device,
            queue_name_for_job_type=queue_name_for_job_type,
        )

    @router.post("/api/sites/{site_id}/training/initial/benchmark/resume")
    def resume_initial_training_benchmark(
        site_id: str,
        payload: ResumeBenchmarkRequest,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        site_store = require_site_access(cp, user, site_id)
        source_job = site_store.get_job(payload.job_id)
        if source_job is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source benchmark job not found.")
        if str(source_job.get("job_type") or "") != "initial_training_benchmark":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only benchmark training jobs can be resumed.")
        if str(source_job.get("status") or "").strip().lower() in {"queued", "running", "cancelling"}:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The selected benchmark job is still active.")

        source_payload = dict(source_job.get("payload") or {})
        requested_architectures = [str(item).strip() for item in source_payload.get("architectures") or [] if str(item).strip()]
        if not requested_architectures:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The selected benchmark job does not contain architectures.")

        result_payload = dict(source_job.get("result") or {})
        response_payload = dict(result_payload.get("response") or {})
        progress_payload = dict(result_payload.get("progress") or {})
        completed_architectures = {
            str(item.get("architecture") or "").strip()
            for item in response_payload.get("results", [])
            if isinstance(item, dict) and str(item.get("status") or "").strip().lower() == "completed"
        }
        completed_architectures.update(
            str(item).strip()
            for item in progress_payload.get("completed_architectures", [])
            if str(item).strip()
        )
        remaining_architectures = [
            architecture
            for architecture in requested_architectures
            if architecture and architecture not in completed_architectures
        ]
        if not remaining_architectures:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="There are no incomplete architectures to resume.")

        execution_mode = str(payload.execution_mode or source_payload.get("execution_mode") or "auto")
        execution_device = resolve_execution_device_or_raise(
            resolve_execution_device=resolve_execution_device,
            execution_mode=execution_mode,
            unavailable_label="Benchmark resume",
        )
        resume_payload = SimpleNamespace(
            execution_mode=execution_mode,
            crop_mode=str(source_payload.get("crop_mode") or "automated"),
            case_aggregation=str(source_payload.get("case_aggregation") or "mean"),
            epochs=int(source_payload.get("epochs") or 30),
            learning_rate=float(source_payload.get("learning_rate") or 1e-4),
            batch_size=int(source_payload.get("batch_size") or 16),
            val_split=float(source_payload.get("val_split") or 0.2),
            test_split=float(source_payload.get("test_split") or 0.2),
            use_pretrained=bool(source_payload.get("use_pretrained", True)),
            pretraining_source=str(source_payload.get("pretraining_source") or "").strip() or None,
            ssl_checkpoint_path=str(source_payload.get("ssl_checkpoint_path") or "").strip() or None,
            benchmark_suite_key=str(source_payload.get("benchmark_suite_key") or "").strip() or None,
            regenerate_split=False,
        )
        return start_initial_training_benchmark(
            site_store,
            site_id=site_id,
            payload=resume_payload,
            architectures=remaining_architectures,
            execution_device=execution_device,
            queue_name_for_job_type=queue_name_for_job_type,
        )

    @router.delete("/api/sites/{site_id}/training/initial/benchmark")
    def clear_initial_training_benchmark_history(
        site_id: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        site_store = require_site_access(cp, user, site_id)
        active_statuses = {"queued", "running", "cancelling"}
        active_jobs = [
            job
            for job in site_store.list_jobs()
            if str(job.get("job_type") or "") == "initial_training_benchmark"
            and str(job.get("status") or "").strip().lower() in active_statuses
        ]
        if active_jobs:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Stop the active benchmark job before deleting benchmark history.",
            )
        deleted_jobs = site_store.delete_jobs(job_type="initial_training_benchmark")
        return {
            "site_id": site_id,
            "deleted_jobs": deleted_jobs,
        }

    @router.get("/api/sites/{site_id}/jobs/{job_id}")
    def get_site_job(
        site_id: str,
        job_id: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        site_store = require_site_access(cp, user, site_id)
        job = site_store.get_job(job_id)
        if job is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found.")
        return job

    @router.get("/api/sites/{site_id}/jobs")
    def list_site_jobs(
        site_id: str,
        job_type: str | None = None,
        status: str | None = None,
        limit: int | None = None,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> list[dict[str, Any]]:
        require_admin_workspace_permission(user)
        site_store = require_site_access(cp, user, site_id)
        jobs = site_store.list_jobs(status=status)
        normalized_job_type = str(job_type or "").strip()
        if normalized_job_type:
          jobs = [job for job in jobs if str(job.get("job_type") or "").strip() == normalized_job_type]
        normalized_limit = max(1, min(int(limit or 0), 100)) if limit else None
        if normalized_limit is not None:
            jobs = jobs[:normalized_limit]
        return jobs

    @router.post("/api/sites/{site_id}/jobs/{job_id}/cancel")
    def cancel_site_job(
        site_id: str,
        job_id: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        site_store = require_site_access(cp, user, site_id)
        job = site_store.request_job_cancel(job_id)
        if job is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found.")
        return job

    @router.get("/api/sites/{site_id}/ai-clinic/embeddings/status")
    def get_ai_clinic_embedding_status(
        site_id: str,
        model_version_id: str | None = None,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        site_store = require_site_access(cp, user, site_id)
        model_version = require_ready_model_version(
            cp,
            get_model_version=get_model_version,
            model_version_id=model_version_id,
            unavailable_detail="No ready model version is available for AI Clinic embedding status.",
        )
        return get_embedding_backfill_status(cp, site_store, model_version=model_version)

    @router.post("/api/sites/{site_id}/ai-clinic/embeddings/backfill")
    def backfill_ai_clinic_embeddings(
        site_id: str,
        payload: EmbeddingBackfillRequest,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        site_store = require_site_access(cp, user, site_id)
        active_job = latest_embedding_backfill_job(site_store)
        if active_job is not None and active_job.get("status") in {"queued", "running"}:
            active_payload = dict(active_job.get("payload") or {})
            active_model_version = get_model_version(cp, str(active_payload.get("model_version_id") or "") or None)
            return {
                "site_id": site_id,
                "job": active_job,
                "model_version": {
                    **serialize_site_model_version(active_model_version),
                    "version_id": active_payload.get("model_version_id"),
                    "version_name": active_payload.get("model_version_name"),
                },
                "execution_device": active_payload.get("execution_device", "unknown"),
            }
        model_version = require_ready_model_version(
            cp,
            get_model_version=get_model_version,
            model_version_id=payload.model_version_id,
            unavailable_detail="No ready model version is available for AI Clinic embedding backfill.",
        )
        execution_device = resolve_execution_device_or_raise(
            resolve_execution_device=resolve_execution_device,
            execution_mode=payload.execution_mode,
            unavailable_label="AI Clinic embedding backfill",
        )
        job = queue_site_embedding_backfill(
            cp,
            site_store,
            model_version=model_version,
            execution_device=execution_device,
            force_refresh=bool(payload.force_refresh),
        )
        return {
            "site_id": site_id,
            "job": job,
            "model_version": serialize_site_model_version(model_version),
            "execution_device": execution_device,
        }

    @router.get("/api/sites/{site_id}/training/cross-validation")
    def list_cross_validation_reports(
        site_id: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> list[dict[str, Any]]:
        require_admin_workspace_permission(user)
        site_store = require_site_access(cp, user, site_id)
        return load_cross_validation_reports(site_store)

    @router.post("/api/sites/{site_id}/training/cross-validation")
    def run_cross_validation(
        site_id: str,
        payload: CrossValidationRunRequest,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        site_store = require_site_access(cp, user, site_id)
        if payload.architecture not in training_architectures:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cross-validation supports only these architectures: {', '.join(training_architectures)}",
            )
        execution_device = resolve_execution_device_or_raise(
            resolve_execution_device=resolve_execution_device,
            execution_mode=payload.execution_mode,
            unavailable_label="Cross-validation",
        )
        return start_cross_validation(
            site_store,
            site_id=site_id,
            payload=payload,
            execution_device=execution_device,
            queue_name_for_job_type=queue_name_for_job_type,
            model_dir=model_dir,
            make_id=make_id,
        )

    @router.post("/api/sites/{site_id}/training/ssl")
    def run_ssl_pretraining(
        site_id: str,
        payload: SSLPretrainingRunRequest,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        site_store = require_site_access(cp, user, site_id)
        if payload.architecture not in SUPPORTED_SSL_ARCHITECTURES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"SSL pretraining supports only these architectures: {', '.join(SUPPORTED_SSL_ARCHITECTURES)}",
            )
        if not str(payload.archive_base_dir or "").strip():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="archive_base_dir is required.")
        execution_device = resolve_execution_device_or_raise(
            resolve_execution_device=resolve_execution_device,
            execution_mode=payload.execution_mode,
            unavailable_label="SSL pretraining",
        )
        return start_ssl_pretraining(
            site_store,
            site_id=site_id,
            payload=payload,
            execution_device=execution_device,
            queue_name_for_job_type=queue_name_for_job_type,
        )

    @router.post("/api/sites/{site_id}/training/retrieval-baseline")
    def run_retrieval_baseline(
        site_id: str,
        payload: RetrievalBaselineRequest,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        site_store = require_site_access(cp, user, site_id)
        execution_device = resolve_execution_device_or_raise(
            resolve_execution_device=resolve_execution_device,
            execution_mode=payload.execution_mode,
            unavailable_label="Retrieval baseline",
        )
        return start_retrieval_baseline(
            site_store,
            site_id=site_id,
            payload=payload,
            execution_device=execution_device,
            queue_name_for_job_type=queue_name_for_job_type,
        )

    return router
