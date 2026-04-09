from __future__ import annotations

import threading
from pathlib import Path
from typing import Any, Callable

from fastapi import HTTPException, status

from kera_research.services.pipeline import ResearchWorkflowService


def serialize_site_model_version(model_version: dict[str, Any] | None) -> dict[str, Any]:
    return {
        "version_id": model_version.get("version_id") if model_version else None,
        "version_name": model_version.get("version_name") if model_version else None,
        "architecture": model_version.get("architecture") if model_version else None,
        "case_aggregation": model_version.get("case_aggregation") if model_version else None,
        "bag_level": bool(model_version.get("bag_level")) if model_version else None,
    }


def require_ready_model_version(
    cp: Any,
    *,
    get_model_version: Callable[[Any, str | None], dict[str, Any] | None],
    model_version_id: str | None,
    unavailable_detail: str,
) -> dict[str, Any]:
    model_version = get_model_version(cp, model_version_id)
    if model_version is None or not model_version.get("ready", True):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=unavailable_detail,
        )
    return model_version


def resolve_execution_device_or_raise(
    *,
    resolve_execution_device: Callable[[str], str],
    execution_mode: str,
    unavailable_label: str,
) -> str:
    try:
        return resolve_execution_device(execution_mode)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"{unavailable_label} is unavailable: {exc}",
        ) from exc


def latest_embedding_backfill_job(site_store: Any) -> dict[str, Any] | None:
    jobs = [job for job in site_store.list_jobs() if job.get("job_type") == "ai_clinic_embedding_backfill"]
    if not jobs:
        return None
    return next((job for job in jobs if job.get("status") in {"queued", "running"}), None)


def latest_federated_retrieval_sync_job(
    site_store: Any,
    *,
    retrieval_profile: str | None = None,
) -> dict[str, Any] | None:
    normalized_profile = str(retrieval_profile or "").strip().lower()
    jobs = [job for job in site_store.list_jobs() if job.get("job_type") == "federated_retrieval_corpus_sync"]
    if normalized_profile:
        jobs = [
            job
            for job in jobs
            if str((job.get("payload") or {}).get("retrieval_profile") or "").strip().lower() == normalized_profile
        ]
    if not jobs:
        return None
    return next((job for job in jobs if job.get("status") in {"queued", "running"}), None)


def latest_image_level_federated_round_job(
    site_store: Any,
    *,
    model_version_id: str | None = None,
    execution_device: str | None = None,
    epochs: int | None = None,
    learning_rate: float | None = None,
    batch_size: int | None = None,
) -> dict[str, Any] | None:
    normalized_model_version_id = str(model_version_id or "").strip()
    normalized_execution_device = str(execution_device or "").strip().lower()
    jobs = [job for job in site_store.list_jobs() if job.get("job_type") == "image_level_federated_round"]
    if normalized_model_version_id:
        jobs = [
            job
            for job in jobs
            if str((job.get("payload") or {}).get("model_version_id") or "").strip() == normalized_model_version_id
        ]
    if normalized_execution_device:
        jobs = [
            job
            for job in jobs
            if str((job.get("payload") or {}).get("execution_device") or "").strip().lower() == normalized_execution_device
        ]
    if epochs is not None:
        jobs = [
            job
            for job in jobs
            if int(((job.get("payload") or {}).get("epochs") or 0)) == int(epochs)
        ]
    if learning_rate is not None:
        jobs = [
            job
            for job in jobs
            if abs(float(((job.get("payload") or {}).get("learning_rate") or 0.0)) - float(learning_rate)) < 1e-12
        ]
    if batch_size is not None:
        jobs = [
            job
            for job in jobs
            if int(((job.get("payload") or {}).get("batch_size") or 0)) == int(batch_size)
        ]
    if not jobs:
        return None
    return next((job for job in jobs if job.get("status") in {"queued", "running"}), None)


def latest_visit_level_federated_round_job(
    site_store: Any,
    *,
    model_version_id: str | None = None,
    execution_device: str | None = None,
    epochs: int | None = None,
    learning_rate: float | None = None,
    batch_size: int | None = None,
) -> dict[str, Any] | None:
    normalized_model_version_id = str(model_version_id or "").strip()
    normalized_execution_device = str(execution_device or "").strip().lower()
    jobs = [job for job in site_store.list_jobs() if job.get("job_type") == "visit_level_federated_round"]
    if normalized_model_version_id:
        jobs = [
            job
            for job in jobs
            if str((job.get("payload") or {}).get("model_version_id") or "").strip() == normalized_model_version_id
        ]
    if normalized_execution_device:
        jobs = [
            job
            for job in jobs
            if str((job.get("payload") or {}).get("execution_device") or "").strip().lower() == normalized_execution_device
        ]
    if epochs is not None:
        jobs = [
            job
            for job in jobs
            if int(((job.get("payload") or {}).get("epochs") or 0)) == int(epochs)
        ]
    if learning_rate is not None:
        jobs = [
            job
            for job in jobs
            if abs(float(((job.get("payload") or {}).get("learning_rate") or 0.0)) - float(learning_rate)) < 1e-12
        ]
    if batch_size is not None:
        jobs = [
            job
            for job in jobs
            if int(((job.get("payload") or {}).get("batch_size") or 0)) == int(batch_size)
        ]
    if not jobs:
        return None
    return next((job for job in jobs if job.get("status") in {"queued", "running"}), None)


def build_image_level_federated_round_status(
    site_store: Any,
    *,
    model_version: dict[str, Any],
) -> dict[str, Any]:
    eligible_case_count = 0
    eligible_image_count = 0
    skipped_not_positive = 0
    skipped_not_active = 0
    skipped_not_included = 0
    skipped_no_images = 0
    for summary in site_store.list_case_summaries():
        patient_id = str(summary.get("patient_id") or "").strip()
        visit_date = str(summary.get("visit_date") or "").strip()
        if not patient_id or not visit_date:
            continue
        try:
            policy_state = site_store.case_research_policy_state(patient_id, visit_date)
        except ValueError:
            continue
        if not bool(policy_state.get("is_positive")):
            skipped_not_positive += 1
            continue
        if not bool(policy_state.get("is_active")):
            skipped_not_active += 1
            continue
        if not bool(policy_state.get("is_registry_included")):
            skipped_not_included += 1
            continue
        image_count = int(policy_state.get("image_count") or 0)
        if image_count <= 0:
            skipped_no_images += 1
            continue
        eligible_case_count += 1
        eligible_image_count += image_count

    active_job = latest_image_level_federated_round_job(
        site_store,
        model_version_id=str(model_version.get("version_id") or ""),
    )
    return {
        "site_id": site_store.site_id,
        "model_version": serialize_site_model_version(model_version),
        "eligible_case_count": eligible_case_count,
        "eligible_image_count": eligible_image_count,
        "skipped": {
            "not_positive": skipped_not_positive,
            "not_active": skipped_not_active,
            "not_included": skipped_not_included,
            "no_images": skipped_no_images,
        },
        "active_job": active_job,
    }


def build_visit_level_federated_round_status(
    site_store: Any,
    *,
    model_version: dict[str, Any],
) -> dict[str, Any]:
    eligible_case_count = 0
    eligible_image_count = 0
    skipped_not_positive = 0
    skipped_not_active = 0
    skipped_not_included = 0
    skipped_no_images = 0
    for summary in site_store.list_case_summaries():
        patient_id = str(summary.get("patient_id") or "").strip()
        visit_date = str(summary.get("visit_date") or "").strip()
        if not patient_id or not visit_date:
            continue
        try:
            policy_state = site_store.case_research_policy_state(patient_id, visit_date)
        except ValueError:
            continue
        if not bool(policy_state.get("is_positive")):
            skipped_not_positive += 1
            continue
        if not bool(policy_state.get("is_active")):
            skipped_not_active += 1
            continue
        if not bool(policy_state.get("is_registry_included")):
            skipped_not_included += 1
            continue
        image_count = int(policy_state.get("image_count") or 0)
        if image_count <= 0:
            skipped_no_images += 1
            continue
        eligible_case_count += 1
        eligible_image_count += image_count

    active_job = latest_visit_level_federated_round_job(
        site_store,
        model_version_id=str(model_version.get("version_id") or ""),
    )
    return {
        "site_id": site_store.site_id,
        "model_version": serialize_site_model_version(model_version),
        "eligible_case_count": eligible_case_count,
        "eligible_image_count": eligible_image_count,
        "skipped": {
            "not_positive": skipped_not_positive,
            "not_active": skipped_not_active,
            "not_included": skipped_not_included,
            "no_images": skipped_no_images,
        },
        "active_job": active_job,
    }


def build_embedding_backfill_status(
    cp: Any,
    site_store: Any,
    *,
    model_version: dict[str, Any],
    workflow_factory: Callable[[Any], Any] | None = None,
) -> dict[str, Any]:
    try:
        workflow = workflow_factory(cp) if workflow_factory is not None else ResearchWorkflowService(cp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"AI workflow is not available on this server: {exc}",
        ) from exc

    case_summaries = site_store.list_case_summaries()
    total_cases = len(case_summaries)
    total_images = sum(int(item.get("image_count") or 0) for item in case_summaries)
    missing_cases = workflow.list_cases_requiring_embedding(
        site_store,
        model_version=model_version,
        backend="classifier",
    )
    missing_case_count = len(missing_cases)
    missing_image_count = sum(int(item.get("image_count") or 0) for item in missing_cases)
    classifier_index_available = workflow.case_vector_index_exists(
        site_store,
        model_version=model_version,
        backend="classifier",
    )
    version_id = str(model_version.get("version_id") or "")
    dinov2_embedding_dir = site_store.embedding_dir / version_id / "dinov2"
    dinov2_embedding_available = dinov2_embedding_dir.exists()
    dinov2_index_available = (
        workflow.case_vector_index_exists(
            site_store,
            model_version=model_version,
            backend="dinov2",
        )
        if dinov2_embedding_available
        else False
    )
    active_job = latest_embedding_backfill_job(site_store)

    return {
        "site_id": site_store.site_id,
        "model_version": {
            "version_id": model_version.get("version_id"),
            "version_name": model_version.get("version_name"),
            "architecture": model_version.get("architecture"),
        },
        "total_cases": total_cases,
        "total_images": total_images,
        "missing_case_count": missing_case_count,
        "missing_image_count": missing_image_count,
        "needs_backfill": bool(
            missing_case_count > 0
            or not classifier_index_available
            or (dinov2_embedding_available and not dinov2_index_available)
        ),
        "vector_index": {
            "classifier_available": classifier_index_available,
            "dinov2_embedding_available": dinov2_embedding_available,
            "dinov2_index_available": dinov2_index_available,
        },
        "active_job": active_job,
    }


def queue_site_embedding_backfill(
    cp: Any,
    site_store: Any,
    *,
    model_version: dict[str, Any],
    execution_device: str,
    force_refresh: bool,
    case_summaries: list[dict[str, Any]] | None = None,
    trigger: str = "manual",
    workflow_factory: Callable[[Any], Any] | None = None,
) -> dict[str, Any]:
    case_summaries = list(case_summaries) if case_summaries is not None else site_store.list_case_summaries()
    job = site_store.enqueue_job(
        "ai_clinic_embedding_backfill",
        {
            "model_version_id": model_version.get("version_id"),
            "model_version_name": model_version.get("version_name"),
            "execution_device": execution_device,
            "force_refresh": bool(force_refresh),
            "trigger": trigger,
            "total_cases": len(case_summaries),
        },
    )
    site_store.update_job_status(
        job["job_id"],
        "running",
        {
            "progress": {
                "stage": "queued",
                "message": "AI Clinic embedding backfill queued.",
                "percent": 0,
                "completed_cases": 0,
                "total_cases": len(case_summaries),
                "indexed_cases": 0,
                "failed_cases": 0,
            }
        },
    )

    def run_backfill_job() -> None:
        try:
            workflow = workflow_factory(cp) if workflow_factory is not None else ResearchWorkflowService(cp)
            indexed_cases = 0
            failed_cases = 0
            failed_case_refs: list[str] = []
            total_cases = len(case_summaries)
            for index, summary in enumerate(case_summaries, start=1):
                patient_id = str(summary.get("patient_id") or "")
                visit_date = str(summary.get("visit_date") or "")
                case_id = str(summary.get("case_id") or f"{patient_id}::{visit_date}")
                try:
                    workflow.index_case_embedding(
                        site_store,
                        patient_id=patient_id,
                        visit_date=visit_date,
                        model_version=model_version,
                        execution_device=execution_device,
                        force_refresh=force_refresh,
                        update_index=False,
                    )
                    indexed_cases += 1
                except Exception:
                    failed_cases += 1
                    if len(failed_case_refs) < 20:
                        failed_case_refs.append(case_id)
                percent = 100 if total_cases <= 0 else int((index / total_cases) * 100)
                site_store.update_job_status(
                    job["job_id"],
                    "running",
                    {
                        "progress": {
                            "stage": "running",
                            "message": "AI Clinic embedding backfill in progress.",
                            "percent": percent,
                            "completed_cases": index,
                            "total_cases": total_cases,
                            "indexed_cases": indexed_cases,
                            "failed_cases": failed_cases,
                        }
                    },
                )

            vector_index: dict[str, Any] | None = None
            vector_index_error: str | None = None
            try:
                vector_index = {
                    "classifier": workflow.rebuild_case_vector_index(
                        site_store,
                        model_version=model_version,
                        backend="classifier",
                    )
                }
                dinov2_meta = site_store.embedding_dir / str(model_version.get("version_id") or "unknown") / "dinov2"
                if dinov2_meta.exists():
                    vector_index["dinov2"] = workflow.rebuild_case_vector_index(
                        site_store,
                        model_version=model_version,
                        backend="dinov2",
                    )
            except Exception as exc:
                vector_index_error = str(exc)

            site_store.update_job_status(
                job["job_id"],
                "completed",
                {
                    "progress": {
                        "stage": "completed",
                        "message": "AI Clinic embedding backfill completed.",
                        "percent": 100,
                        "completed_cases": total_cases,
                        "total_cases": total_cases,
                        "indexed_cases": indexed_cases,
                        "failed_cases": failed_cases,
                    },
                    "response": {
                        "model_version_id": model_version.get("version_id"),
                        "model_version_name": model_version.get("version_name"),
                        "execution_device": execution_device,
                        "force_refresh": bool(force_refresh),
                        "total_cases": total_cases,
                        "indexed_cases": indexed_cases,
                        "failed_cases": failed_cases,
                        "failed_case_ids": failed_case_refs,
                        "vector_index": vector_index,
                        "vector_index_error": vector_index_error,
                    },
                },
            )
        except Exception as exc:
            site_store.update_job_status(
                job["job_id"],
                "failed",
                {
                    "progress": {
                        "stage": "failed",
                        "message": "AI Clinic embedding backfill failed.",
                        "percent": 100,
                    },
                    "error": str(exc),
                },
            )

    threading.Thread(target=run_backfill_job, daemon=True).start()
    return site_store.get_job(job["job_id"]) or job


def start_federated_retrieval_corpus_sync(
    site_store: Any,
    *,
    site_id: str,
    payload: Any,
    execution_device: str,
    queue_name_for_job_type: Callable[[str], str],
) -> dict[str, Any]:
    retrieval_profile = str(getattr(payload, "retrieval_profile", "dinov2_lesion_crop") or "dinov2_lesion_crop")
    force_refresh = bool(getattr(payload, "force_refresh", False))
    job = site_store.enqueue_job(
        "federated_retrieval_corpus_sync",
        {
            "execution_mode": getattr(payload, "execution_mode", "auto"),
            "execution_device": execution_device,
            "retrieval_profile": retrieval_profile,
            "force_refresh": force_refresh,
            "total_cases": len(site_store.list_case_summaries()),
        },
        queue_name=queue_name_for_job_type("federated_retrieval_corpus_sync"),
    )
    site_store.update_job_status(
        job["job_id"],
        "queued",
        {
            "progress": {
                "stage": "queued",
                "message": "Federated retrieval corpus sync queued.",
                "percent": 0,
                "retrieval_profile": retrieval_profile,
                "force_refresh": force_refresh,
            }
        },
    )
    return {
        "site_id": site_id,
        "execution_device": execution_device,
        "retrieval_profile": retrieval_profile,
        "force_refresh": force_refresh,
        "job": site_store.get_job(job["job_id"]) or job,
    }


def start_site_validation(
    site_store: Any,
    *,
    site_id: str,
    project_id: str,
    model_version: dict[str, Any],
    payload: Any,
    execution_device: str,
    queue_name_for_job_type: Callable[[str], str],
) -> dict[str, Any]:
    job = site_store.enqueue_job(
        "site_validation",
        {
            "project_id": project_id,
            "model_version_id": model_version.get("version_id"),
            "execution_mode": payload.execution_mode,
            "execution_device": execution_device,
            "generate_gradcam": bool(payload.generate_gradcam),
            "generate_medsam": bool(payload.generate_medsam),
        },
        queue_name=queue_name_for_job_type("site_validation"),
    )
    site_store.update_job_status(
        job["job_id"],
        "queued",
        {
            "progress": {
                "stage": "queued",
                "message": "Hospital validation job queued.",
                "percent": 0,
            }
        },
    )
    return {
        "site_id": site_id,
        "execution_device": execution_device,
        "job": site_store.get_job(job["job_id"]) or job,
        "model_version": serialize_site_model_version(model_version),
    }


def start_initial_training(
    site_store: Any,
    *,
    site_id: str,
    payload: Any,
    execution_device: str,
    queue_name_for_job_type: Callable[[str], str],
    model_dir: Path,
    make_id: Callable[[str], str],
) -> dict[str, Any]:
    output_path = model_dir / f"global_{payload.architecture}_{make_id('init')[:8]}.pth"
    job = site_store.enqueue_job(
        "initial_training",
        {
            "architecture": payload.architecture,
            "execution_mode": payload.execution_mode,
            "execution_device": execution_device,
            "crop_mode": payload.crop_mode,
            "case_aggregation": payload.case_aggregation,
            "epochs": int(payload.epochs),
            "learning_rate": float(payload.learning_rate),
            "batch_size": int(payload.batch_size),
            "val_split": float(payload.val_split),
            "test_split": float(payload.test_split),
            "use_pretrained": bool(payload.use_pretrained),
            "pretraining_source": getattr(payload, "pretraining_source", None),
            "ssl_checkpoint_path": getattr(payload, "ssl_checkpoint_path", None),
            "regenerate_split": True,
            "output_model_path": str(output_path),
        },
        queue_name=queue_name_for_job_type("initial_training"),
    )
    site_store.update_job_status(
        job["job_id"],
        "queued",
        {
            "progress": {
                "stage": "queued",
                "message": "Training job queued.",
                "percent": 0,
                "crop_mode": payload.crop_mode,
                "case_aggregation": payload.case_aggregation,
                "pretraining_source": getattr(payload, "pretraining_source", None),
            }
        },
    )
    return {
        "site_id": site_id,
        "execution_device": execution_device,
        "job": site_store.get_job(job["job_id"]) or job,
    }


def start_image_level_federated_round(
    site_store: Any,
    *,
    site_id: str,
    model_version: dict[str, Any],
    payload: Any,
    execution_device: str,
    queue_name_for_job_type: Callable[[str], str],
) -> dict[str, Any]:
    job = site_store.enqueue_job(
        "image_level_federated_round",
        {
            "model_version_id": model_version.get("version_id"),
            "model_version_name": model_version.get("version_name"),
            "architecture": model_version.get("architecture"),
            "execution_mode": getattr(payload, "execution_mode", "auto"),
            "execution_device": execution_device,
            "epochs": int(getattr(payload, "epochs", 1) or 1),
            "learning_rate": float(getattr(payload, "learning_rate", 5e-5) or 5e-5),
            "batch_size": int(getattr(payload, "batch_size", 8) or 8),
        },
        queue_name=queue_name_for_job_type("image_level_federated_round"),
    )
    site_store.update_job_status(
        job["job_id"],
        "queued",
        {
            "progress": {
                "stage": "queued",
                "message": "Image-level federated training round queued.",
                "percent": 0,
                "architecture": model_version.get("architecture"),
                "model_version_id": model_version.get("version_id"),
                "epochs": int(getattr(payload, "epochs", 1) or 1),
            }
        },
    )
    return {
        "site_id": site_id,
        "execution_device": execution_device,
        "job": site_store.get_job(job["job_id"]) or job,
        "model_version": serialize_site_model_version(model_version),
    }


def start_visit_level_federated_round(
    site_store: Any,
    *,
    site_id: str,
    model_version: dict[str, Any],
    payload: Any,
    execution_device: str,
    queue_name_for_job_type: Callable[[str], str],
) -> dict[str, Any]:
    job = site_store.enqueue_job(
        "visit_level_federated_round",
        {
            "model_version_id": model_version.get("version_id"),
            "model_version_name": model_version.get("version_name"),
            "architecture": model_version.get("architecture"),
            "execution_mode": getattr(payload, "execution_mode", "auto"),
            "execution_device": execution_device,
            "epochs": int(getattr(payload, "epochs", 1) or 1),
            "learning_rate": float(getattr(payload, "learning_rate", 5e-5) or 5e-5),
            "batch_size": int(getattr(payload, "batch_size", 4) or 4),
        },
        queue_name=queue_name_for_job_type("visit_level_federated_round"),
    )
    site_store.update_job_status(
        job["job_id"],
        "queued",
        {
            "progress": {
                "stage": "queued",
                "message": "Visit-level federated training round queued.",
                "percent": 0,
                "architecture": model_version.get("architecture"),
                "model_version_id": model_version.get("version_id"),
                "epochs": int(getattr(payload, "epochs", 1) or 1),
            }
        },
    )
    return {
        "site_id": site_id,
        "execution_device": execution_device,
        "job": site_store.get_job(job["job_id"]) or job,
        "model_version": serialize_site_model_version(model_version),
    }


def start_initial_training_benchmark(
    site_store: Any,
    *,
    site_id: str,
    payload: Any,
    architectures: list[str],
    execution_device: str,
    queue_name_for_job_type: Callable[[str], str],
) -> dict[str, Any]:
    job = site_store.enqueue_job(
        "initial_training_benchmark",
        {
            "architectures": architectures,
            "execution_mode": payload.execution_mode,
            "execution_device": execution_device,
            "crop_mode": payload.crop_mode,
            "case_aggregation": payload.case_aggregation,
            "epochs": int(payload.epochs),
            "learning_rate": float(payload.learning_rate),
            "batch_size": int(payload.batch_size),
            "val_split": float(payload.val_split),
            "test_split": float(payload.test_split),
            "use_pretrained": bool(payload.use_pretrained),
            "pretraining_source": getattr(payload, "pretraining_source", None),
            "ssl_checkpoint_path": getattr(payload, "ssl_checkpoint_path", None),
            "benchmark_suite_key": getattr(payload, "benchmark_suite_key", None),
            "regenerate_split": True,
        },
        queue_name=queue_name_for_job_type("initial_training_benchmark"),
    )
    site_store.update_job_status(
        job["job_id"],
        "queued",
        {
            "progress": {
                "stage": "queued",
                "message": "Benchmark training job queued.",
                "percent": 0,
                "crop_mode": payload.crop_mode,
                "case_aggregation": payload.case_aggregation,
                "pretraining_source": getattr(payload, "pretraining_source", None),
                "architecture_count": len(architectures),
            }
        },
    )
    return {
        "site_id": site_id,
        "execution_device": execution_device,
        "job": site_store.get_job(job["job_id"]) or job,
    }


def start_retrieval_baseline(
    site_store: Any,
    *,
    site_id: str,
    payload: Any,
    execution_device: str,
    queue_name_for_job_type: Callable[[str], str],
) -> dict[str, Any]:
    job = site_store.enqueue_job(
        "retrieval_baseline",
        {
            "execution_mode": payload.execution_mode,
            "execution_device": execution_device,
            "crop_mode": getattr(payload, "crop_mode", "automated"),
            "top_k": int(getattr(payload, "top_k", 10)),
        },
        queue_name=queue_name_for_job_type("retrieval_baseline"),
    )
    site_store.update_job_status(
        job["job_id"],
        "queued",
        {
            "progress": {
                "stage": "queued",
                "message": "Retrieval baseline job queued.",
                "percent": 0,
                "crop_mode": getattr(payload, "crop_mode", "automated"),
            }
        },
    )
    return {
        "site_id": site_id,
        "execution_device": execution_device,
        "job": site_store.get_job(job["job_id"]) or job,
    }


def start_cross_validation(
    site_store: Any,
    *,
    site_id: str,
    payload: Any,
    execution_device: str,
    queue_name_for_job_type: Callable[[str], str],
    model_dir: Path,
    make_id: Callable[[str], str],
) -> dict[str, Any]:
    output_dir = model_dir / f"cross_validation_{make_id('cvdir')[:8]}"
    job = site_store.enqueue_job(
        "cross_validation",
        {
            "architecture": payload.architecture,
            "execution_mode": payload.execution_mode,
            "execution_device": execution_device,
            "crop_mode": payload.crop_mode,
            "case_aggregation": payload.case_aggregation,
            "num_folds": int(payload.num_folds),
            "epochs": int(payload.epochs),
            "learning_rate": float(payload.learning_rate),
            "batch_size": int(payload.batch_size),
            "val_split": float(payload.val_split),
            "use_pretrained": bool(payload.use_pretrained),
            "output_dir": str(output_dir),
        },
        queue_name=queue_name_for_job_type("cross_validation"),
    )
    site_store.update_job_status(
        job["job_id"],
        "queued",
        {
            "progress": {
                "stage": "queued",
                "message": "Cross-validation job queued.",
                "percent": 0,
                "crop_mode": payload.crop_mode,
                "case_aggregation": payload.case_aggregation,
                "num_folds": payload.num_folds,
            }
        },
    )
    return {
        "site_id": site_id,
        "execution_device": execution_device,
        "job": site_store.get_job(job["job_id"]) or job,
    }


def start_ssl_pretraining(
    site_store: Any,
    *,
    site_id: str,
    payload: Any,
    execution_device: str,
    queue_name_for_job_type: Callable[[str], str],
) -> dict[str, Any]:
    job = site_store.enqueue_job(
        "ssl_pretraining",
        {
            "archive_base_dir": str(payload.archive_base_dir),
            "architecture": payload.architecture,
            "init_mode": payload.init_mode,
            "method": payload.method,
            "execution_mode": payload.execution_mode,
            "execution_device": execution_device,
            "image_size": int(payload.image_size),
            "batch_size": int(payload.batch_size),
            "epochs": int(payload.epochs),
            "learning_rate": float(payload.learning_rate),
            "weight_decay": float(payload.weight_decay),
            "num_workers": int(payload.num_workers),
            "min_patient_quality": payload.min_patient_quality,
            "include_review_rows": bool(payload.include_review_rows),
            "use_amp": bool(payload.use_amp),
        },
        queue_name=queue_name_for_job_type("ssl_pretraining"),
    )
    site_store.update_job_status(
        job["job_id"],
        "queued",
        {
            "progress": {
                "stage": "queued",
                "message": "SSL pretraining job queued.",
                "percent": 0,
                "architecture": payload.architecture,
                "init_mode": payload.init_mode,
                "method": payload.method,
                "archive_base_dir": str(payload.archive_base_dir),
            }
        },
    )
    return {
        "site_id": site_id,
        "execution_device": execution_device,
        "job": site_store.get_job(job["job_id"]) or job,
    }
