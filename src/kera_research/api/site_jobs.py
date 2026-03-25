from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from fastapi import HTTPException, status


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
            "regenerate_split": bool(payload.regenerate_split),
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
            "regenerate_split": bool(payload.regenerate_split),
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
