from __future__ import annotations

import json
import sys
import threading
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any, Callable

from fastapi import HTTPException

from kera_research.api.app import (
    _build_embedding_backfill_status,
    _decode_access_token,
    _get_model_version,
    _get_semantic_prompt_scorer,
    _get_workflow,
    _latest_embedding_backfill_job,
    _project_id_for_site,
    _queue_site_embedding_backfill,
    _require_admin_workspace_permission,
    _require_site_access,
    _require_validation_permission,
    _resolve_execution_device,
    _serialize_lesion_preview_job,
    get_control_plane,
)
from kera_research.api.case_model_versions import (
    resolve_requested_contribution_models,
    resolve_requested_model_version,
    serialize_case_artifact_availability,
    serialize_case_model_version,
)
from kera_research.api.route_helpers import load_cross_validation_reports, site_level_validation_runs, validation_case_rows
from kera_research.api.site_jobs import (
    require_ready_model_version,
    resolve_execution_device_or_raise,
    serialize_site_model_version,
    start_cross_validation,
    start_initial_training,
    start_initial_training_benchmark,
    start_site_validation,
)
from kera_research.config import MODEL_DIR
from kera_research.domain import TRAINING_ARCHITECTURES, make_id
from kera_research.services.data_plane import SiteStore
from kera_research.services.image_artifact_status import sync_image_artifact_cache

_LESION_PREVIEW_JOBS: dict[str, dict[str, Any]] = {}
_LESION_PREVIEW_JOBS_LOCK = threading.Lock()


def _decode_user(token: str) -> dict[str, Any]:
    payload = _decode_access_token(str(token or "").strip())
    return {
        "user_id": payload["sub"],
        "username": payload.get("username", ""),
        "role": payload.get("role", "viewer"),
        "site_ids": payload.get("site_ids") or [],
        "approval_status": payload.get("approval_status", "approved"),
        "full_name": payload.get("full_name", ""),
        "public_alias": payload.get("public_alias"),
        "registry_consents": payload.get("registry_consents") or {},
    }


def _approved_user(token: str) -> dict[str, Any]:
    user = _decode_user(token)
    if user.get("approval_status") != "approved":
        raise HTTPException(status_code=403, detail="This account is not approved yet. Submit an institution request first.")
    return user


def _sync_case_artifact_cache_best_effort(workflow: Any, site_store: SiteStore, *, patient_id: str, visit_date: str) -> None:
    try:
        for image_record in site_store.list_images_for_visit(patient_id, visit_date):
            sync_image_artifact_cache(workflow, site_store, image_record)
    except Exception:
        return


def _sync_image_artifact_cache_best_effort(workflow: Any, site_store: SiteStore, image_record: dict[str, Any] | None) -> None:
    if not isinstance(image_record, dict):
        return
    try:
        sync_image_artifact_cache(workflow, site_store, image_record)
    except Exception:
        return


def _json_dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _write_message(payload: dict[str, Any]) -> None:
    sys.stdout.write(_json_dump(payload))
    sys.stdout.write("\n")
    sys.stdout.flush()


def _result(request_id: Any, result: Any) -> dict[str, Any]:
    return {"id": request_id, "ok": True, "result": result}


def _error(request_id: Any, message: str, *, code: int | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {"message": message}
    if code is not None:
        payload["code"] = code
    return {"id": request_id, "ok": False, "error": payload}


def _image_records_by_path(site_store: SiteStore, patient_id: str, visit_date: str) -> dict[str, dict[str, Any]]:
    return {
        str(image.get("image_path") or ""): image
        for image in site_store.list_images_for_visit(patient_id, visit_date)
    }


def _resolve_case_model_version(cp: Any, params: dict[str, Any]) -> dict[str, Any]:
    model_version = resolve_requested_model_version(
        cp,
        get_model_version=_get_model_version,
        model_version_id=str(params.get("model_version_id") or "").strip() or None,
        model_version_ids=[str(item).strip() for item in params.get("model_version_ids") or [] if str(item).strip()],
    )
    if model_version is None or not model_version.get("ready", True):
        raise HTTPException(status_code=503, detail="No ready global model is available for validation.")
    return model_version


def _queue_name_for_job_type(job_type: str) -> str:
    from kera_research.services.job_runner import queue_name_for_job_type

    return queue_name_for_job_type(job_type)


def _run_case_validation(params: dict[str, Any]) -> dict[str, Any]:
    cp = get_control_plane()
    user = _approved_user(str(params.get("token") or ""))
    _require_validation_permission(user)
    site_id = str(params.get("site_id") or "").strip()
    site_store = _require_site_access(cp, user, site_id)
    workflow = _get_workflow(cp)
    model_version = _resolve_case_model_version(cp, params)
    execution_device = _resolve_execution_device(str(params.get("execution_mode") or "auto"))
    patient_id = str(params.get("patient_id") or "").strip()
    visit_date = str(params.get("visit_date") or "").strip()
    summary, case_predictions = workflow.run_case_validation(
        project_id=_project_id_for_site(cp, site_id),
        site_store=site_store,
        patient_id=patient_id,
        visit_date=visit_date,
        model_version=model_version,
        execution_device=execution_device,
        generate_gradcam=bool(params.get("generate_gradcam", True)),
        generate_medsam=bool(params.get("generate_medsam", True)),
    )
    _sync_case_artifact_cache_best_effort(workflow, site_store, patient_id=patient_id, visit_date=visit_date)
    case_prediction = case_predictions[0] if case_predictions else None
    post_mortem = None
    if case_prediction is not None:
        case_reference_id = (
            str(case_prediction.get("case_reference_id") or "").strip()
            or cp.case_reference_id(site_id, patient_id, visit_date)
        )
        classification_context = {
            "validation_id": summary.get("validation_id"),
            "run_date": summary.get("run_date"),
            "model_version_id": summary.get("model_version_id"),
            "model_version": summary.get("model_version"),
            "predicted_label": case_prediction.get("predicted_label"),
            "true_label": case_prediction.get("true_label"),
            "prediction_probability": case_prediction.get("prediction_probability"),
            "is_correct": case_prediction.get("is_correct"),
        }
        try:
            post_mortem = workflow.run_case_postmortem(
                site_store,
                patient_id=patient_id,
                visit_date=visit_date,
                model_version=model_version,
                execution_device=execution_device,
                classification_context=classification_context,
                case_prediction=case_prediction,
                top_k=3,
                retrieval_backend="hybrid",
            )
            if post_mortem is not None and case_reference_id:
                case_prediction["post_mortem"] = post_mortem
                cp.update_validation_case_prediction(
                    str(summary.get("validation_id") or ""),
                    case_reference_id=case_reference_id,
                    updates={
                        "post_mortem": post_mortem,
                        "structured_analysis": post_mortem.get("structured_analysis"),
                    },
                )
                site_store.record_case_validation_history(
                    patient_id,
                    visit_date,
                    {
                        "validation_id": summary.get("validation_id"),
                        "run_date": summary.get("run_date"),
                        "model_version": summary.get("model_version"),
                        "model_version_id": summary.get("model_version_id"),
                        "model_architecture": summary.get("model_architecture"),
                        "run_scope": "case",
                        "predicted_label": case_prediction.get("predicted_label"),
                        "true_label": case_prediction.get("true_label"),
                        "prediction_probability": case_prediction.get("prediction_probability"),
                        "is_correct": case_prediction.get("is_correct"),
                        "prediction_snapshot": case_prediction.get("prediction_snapshot"),
                        "post_mortem": post_mortem,
                    },
                )
        except Exception:
            post_mortem = None
    return {
        "summary": summary,
        "case_prediction": case_prediction,
        "model_version": serialize_case_model_version(model_version),
        "execution_device": execution_device,
        "artifact_availability": serialize_case_artifact_availability(case_prediction),
        "post_mortem": post_mortem,
    }


def _run_case_validation_compare(params: dict[str, Any]) -> dict[str, Any]:
    cp = get_control_plane()
    user = _approved_user(str(params.get("token") or ""))
    _require_validation_permission(user)
    site_id = str(params.get("site_id") or "").strip()
    site_store = _require_site_access(cp, user, site_id)
    workflow = _get_workflow(cp)
    requested_ids = list(dict.fromkeys(str(item).strip() for item in params.get("model_version_ids") or [] if str(item).strip()))
    if not requested_ids:
        raise HTTPException(status_code=400, detail="At least one model version is required.")
    execution_device = _resolve_execution_device(str(params.get("execution_mode") or "auto"))
    patient_id = str(params.get("patient_id") or "").strip()
    visit_date = str(params.get("visit_date") or "").strip()
    comparisons: list[dict[str, Any]] = []
    for model_version_id in requested_ids[:8]:
        model_version = _get_model_version(cp, model_version_id)
        if model_version is None or not model_version.get("ready", True):
            comparisons.append({"model_version_id": model_version_id, "error": "Model version is not available or not ready."})
            continue
        try:
            summary, case_predictions = workflow.run_case_validation(
                project_id=_project_id_for_site(cp, site_id),
                site_store=site_store,
                patient_id=patient_id,
                visit_date=visit_date,
                model_version=model_version,
                execution_device=execution_device,
                generate_gradcam=bool(params.get("generate_gradcam", False)),
                generate_medsam=bool(params.get("generate_medsam", False)),
            )
            case_prediction = case_predictions[0] if case_predictions else None
            comparisons.append(
                {
                    "summary": summary,
                    "case_prediction": case_prediction,
                    "model_version": serialize_case_model_version(model_version),
                    "artifact_availability": serialize_case_artifact_availability(case_prediction),
                }
            )
        except Exception as exc:
            comparisons.append({"model_version": serialize_case_model_version(model_version), "error": str(exc)})
    if any(item.get("summary") for item in comparisons):
        _sync_case_artifact_cache_best_effort(workflow, site_store, patient_id=patient_id, visit_date=visit_date)
    return {
        "patient_id": patient_id,
        "visit_date": visit_date,
        "execution_device": execution_device,
        "comparisons": comparisons,
    }


def _run_case_ai_clinic(params: dict[str, Any]) -> dict[str, Any]:
    cp = get_control_plane()
    user = _approved_user(str(params.get("token") or ""))
    _require_validation_permission(user)
    site_id = str(params.get("site_id") or "").strip()
    site_store = _require_site_access(cp, user, site_id)
    workflow = _get_workflow(cp)
    model_version = _resolve_case_model_version(cp, params)
    execution_device = _resolve_execution_device(str(params.get("execution_mode") or "auto"))
    patient_id = str(params.get("patient_id") or "").strip()
    visit_date = str(params.get("visit_date") or "").strip()
    result = workflow.run_ai_clinic_report(
        site_store,
        patient_id=patient_id,
        visit_date=visit_date,
        model_version=model_version,
        execution_device=execution_device,
        top_k=int(params.get("top_k") or 3),
        retrieval_backend=str(params.get("retrieval_backend") or "standard"),
    )
    _sync_case_artifact_cache_best_effort(workflow, site_store, patient_id=patient_id, visit_date=visit_date)
    return result


def _run_case_contribution(params: dict[str, Any]) -> dict[str, Any]:
    cp = get_control_plane()
    user = _approved_user(str(params.get("token") or ""))
    _require_validation_permission(user)
    site_id = str(params.get("site_id") or "").strip()
    site_store = _require_site_access(cp, user, site_id)
    workflow = _get_workflow(cp)
    patient_id = str(params.get("patient_id") or "").strip()
    visit_date = str(params.get("visit_date") or "").strip()
    visit = site_store.get_visit(patient_id, visit_date)
    if visit is None:
        raise HTTPException(status_code=404, detail="Visit not found.")
    visit_status = visit.get("visit_status", "active" if visit.get("active_stage") else "scar")
    if visit_status != "active":
        raise HTTPException(status_code=400, detail="Only active visits are enabled for contribution under the current policy.")
    contribution_models = resolve_requested_contribution_models(
        cp,
        get_model_version=_get_model_version,
        model_version_id=str(params.get("model_version_id") or "").strip() or None,
        model_version_ids=[str(item).strip() for item in params.get("model_version_ids") or [] if str(item).strip()],
    )
    execution_device = _resolve_execution_device(str(params.get("execution_mode") or "auto"))
    updates: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    runtime_failure_count = 0
    contribution_group_id = make_id("contribgrp")
    for model_version in contribution_models:
        try:
            updates.append(
                workflow.contribute_case(
                    site_store=site_store,
                    patient_id=patient_id,
                    visit_date=visit_date,
                    model_version=model_version,
                    execution_device=execution_device,
                    user_id=user["user_id"],
                    user_public_alias=str(user.get("public_alias") or "").strip() or None,
                    contribution_group_id=contribution_group_id,
                )
            )
        except ValueError as exc:
            failures.append(
                {
                    "model_version_id": model_version.get("version_id"),
                    "version_name": model_version.get("version_name"),
                    "architecture": model_version.get("architecture"),
                    "error": str(exc),
                }
            )
        except RuntimeError as exc:
            runtime_failure_count += 1
            failures.append(
                {
                    "model_version_id": model_version.get("version_id"),
                    "version_name": model_version.get("version_name"),
                    "architecture": model_version.get("architecture"),
                    "error": str(exc),
                }
            )
    if not updates:
        detail = "; ".join(item["error"] for item in failures) or "Case contribution is unavailable."
        raise HTTPException(status_code=503 if runtime_failure_count and runtime_failure_count == len(failures) else 400, detail=detail)
    primary_update = updates[0]
    primary_model_version = next(
        (
            item
            for item in contribution_models
            if str(item.get("version_id") or "") == str(primary_update.get("base_model_version_id") or "")
        ),
        contribution_models[0],
    )
    _sync_case_artifact_cache_best_effort(workflow, site_store, patient_id=patient_id, visit_date=visit_date)
    return {
        "update": primary_update,
        "updates": updates,
        "update_count": len(updates),
        "contribution_group_id": contribution_group_id,
        "visit_status": visit_status,
        "execution_device": execution_device,
        "model_version": {
            "version_id": primary_model_version.get("version_id"),
            "version_name": primary_model_version.get("version_name"),
            "architecture": primary_model_version.get("architecture"),
        },
        "model_versions": [
            {
                "version_id": item.get("version_id"),
                "version_name": item.get("version_name"),
                "architecture": item.get("architecture"),
                "crop_mode": item.get("crop_mode"),
                "ensemble_mode": item.get("ensemble_mode"),
            }
            for item in contribution_models
        ],
        "failures": failures,
        "stats": cp.get_contribution_stats(user_id=user["user_id"]),
    }


def _fetch_case_roi_preview(params: dict[str, Any]) -> list[dict[str, Any]]:
    cp = get_control_plane()
    user = _approved_user(str(params.get("token") or ""))
    _require_validation_permission(user)
    site_id = str(params.get("site_id") or "").strip()
    patient_id = str(params.get("patient_id") or "").strip()
    visit_date = str(params.get("visit_date") or "").strip()
    site_store = _require_site_access(cp, user, site_id)
    workflow = _get_workflow(cp)
    image_by_path = _image_records_by_path(site_store, patient_id, visit_date)
    previews = workflow.preview_case_roi(site_store, patient_id, visit_date)
    _sync_case_artifact_cache_best_effort(workflow, site_store, patient_id=patient_id, visit_date=visit_date)
    return [
        {
            "patient_id": item["patient_id"],
            "visit_date": item["visit_date"],
            "image_id": image_by_path.get(item["source_image_path"], {}).get("image_id"),
            "view": item.get("view"),
            "is_representative": bool(item.get("is_representative")),
            "source_image_path": item.get("source_image_path"),
            "has_roi_crop": bool(item.get("roi_crop_path")),
            "has_medsam_mask": bool(item.get("medsam_mask_path")),
            "backend": item.get("backend", "unknown"),
        }
        for item in previews
    ]


def _fetch_case_lesion_preview(params: dict[str, Any]) -> list[dict[str, Any]]:
    cp = get_control_plane()
    user = _approved_user(str(params.get("token") or ""))
    _require_validation_permission(user)
    site_id = str(params.get("site_id") or "").strip()
    patient_id = str(params.get("patient_id") or "").strip()
    visit_date = str(params.get("visit_date") or "").strip()
    site_store = _require_site_access(cp, user, site_id)
    workflow = _get_workflow(cp)
    image_by_path = _image_records_by_path(site_store, patient_id, visit_date)
    previews = workflow.preview_case_lesion(site_store, patient_id, visit_date)
    _sync_case_artifact_cache_best_effort(workflow, site_store, patient_id=patient_id, visit_date=visit_date)
    return [
        {
            "patient_id": item["patient_id"],
            "visit_date": item["visit_date"],
            "image_id": image_by_path.get(item["source_image_path"], {}).get("image_id"),
            "view": item.get("view"),
            "is_representative": bool(item.get("is_representative")),
            "source_image_path": item.get("source_image_path"),
            "has_lesion_crop": bool(item.get("lesion_crop_path")),
            "has_lesion_mask": bool(item.get("lesion_mask_path")),
            "backend": item.get("backend", "unknown"),
            "lesion_prompt_box": item.get("lesion_prompt_box"),
        }
        for item in previews
    ]


def _start_live_lesion_preview(params: dict[str, Any]) -> dict[str, Any]:
    cp = get_control_plane()
    user = _approved_user(str(params.get("token") or ""))
    _require_validation_permission(user)
    site_id = str(params.get("site_id") or "").strip()
    image_id = str(params.get("image_id") or "").strip()
    site_store = _require_site_access(cp, user, site_id)
    image = site_store.get_image(image_id)
    if image is None:
        raise HTTPException(status_code=404, detail="Image not found.")
    lesion_prompt_box = image.get("lesion_prompt_box")
    if not isinstance(lesion_prompt_box, dict):
        raise HTTPException(status_code=400, detail="This image requires a saved lesion box.")
    workflow = _get_workflow(cp)
    prompt_signature = workflow._lesion_prompt_box_signature(lesion_prompt_box)
    with _LESION_PREVIEW_JOBS_LOCK:
        for existing in reversed(list(_LESION_PREVIEW_JOBS.values())):
            if (
                existing.get("site_id") == site_id
                and existing.get("image_id") == image_id
                and existing.get("prompt_signature") == prompt_signature
                and existing.get("status") in {"running", "done"}
            ):
                return _serialize_lesion_preview_job(dict(existing))
    job_id = make_id("lesionjob")
    job_record = {
        "job_id": job_id,
        "site_id": site_id,
        "image_id": image_id,
        "patient_id": image.get("patient_id"),
        "visit_date": image.get("visit_date"),
        "status": "running",
        "error": None,
        "result": None,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "finished_at": None,
        "prompt_signature": prompt_signature,
        "lesion_prompt_box": lesion_prompt_box,
    }
    with _LESION_PREVIEW_JOBS_LOCK:
        _LESION_PREVIEW_JOBS[job_id] = job_record

    def _run() -> None:
        try:
            result = workflow.preview_image_lesion(site_store, image_id, lesion_prompt_box=dict(lesion_prompt_box))
            refreshed_image = site_store.get_image(image_id) or image
            _sync_image_artifact_cache_best_effort(workflow, site_store, refreshed_image)
            with _LESION_PREVIEW_JOBS_LOCK:
                _LESION_PREVIEW_JOBS[job_id].update(
                    {
                        "status": "done",
                        "result": result,
                        "finished_at": datetime.now(timezone.utc).isoformat(),
                    }
                )
        except Exception as exc:
            with _LESION_PREVIEW_JOBS_LOCK:
                _LESION_PREVIEW_JOBS[job_id].update(
                    {
                        "status": "failed",
                        "error": str(exc),
                        "finished_at": datetime.now(timezone.utc).isoformat(),
                    }
                )

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()
    thread.join(timeout=0.25)
    with _LESION_PREVIEW_JOBS_LOCK:
        job_snapshot = dict(_LESION_PREVIEW_JOBS.get(job_id) or {})
    if not job_snapshot:
        raise HTTPException(status_code=500, detail="Live lesion preview job disappeared.")
    if job_snapshot.get("status") == "failed":
        raise HTTPException(status_code=503, detail=str(job_snapshot.get("error") or "Live lesion preview failed."))
    return _serialize_lesion_preview_job(job_snapshot)


def _fetch_live_lesion_preview_job(params: dict[str, Any]) -> dict[str, Any]:
    cp = get_control_plane()
    user = _approved_user(str(params.get("token") or ""))
    _require_validation_permission(user)
    site_id = str(params.get("site_id") or "").strip()
    image_id = str(params.get("image_id") or "").strip()
    job_id = str(params.get("job_id") or "").strip()
    _require_site_access(cp, user, site_id)
    with _LESION_PREVIEW_JOBS_LOCK:
        job = dict(_LESION_PREVIEW_JOBS.get(job_id) or {})
    if not job:
        raise HTTPException(status_code=404, detail="Live lesion preview job not found.")
    if job.get("site_id") != site_id or job.get("image_id") != image_id:
        raise HTTPException(status_code=404, detail="Live lesion preview job not found for this image.")
    return _serialize_lesion_preview_job(job)


def _fetch_image_semantic_prompt_scores(params: dict[str, Any]) -> dict[str, Any]:
    cp = get_control_plane()
    user = _approved_user(str(params.get("token") or ""))
    site_id = str(params.get("site_id") or "").strip()
    image_id = str(params.get("image_id") or "").strip()
    site_store = _require_site_access(cp, user, site_id)
    image = site_store.get_image(image_id)
    if image is None:
        raise HTTPException(status_code=404, detail="Image not found.")
    normalized_input_mode = str(params.get("input_mode") or "source").strip().lower()
    if normalized_input_mode not in {"source", "roi_crop", "lesion_crop"}:
        raise HTTPException(status_code=400, detail="Unknown semantic prompt input mode.")
    analysis_path = str(image["image_path"])
    if normalized_input_mode != "source":
        _require_validation_permission(user)
        workflow = _get_workflow(cp)
        if normalized_input_mode == "roi_crop":
            previews = workflow.preview_case_roi(site_store, image["patient_id"], image["visit_date"])
            preview = next((item for item in previews if item.get("source_image_path") == image.get("image_path")), None)
            if preview is None or not preview.get("roi_crop_path"):
                raise HTTPException(status_code=404, detail="ROI crop is not available for this image.")
            analysis_path = str(preview["roi_crop_path"])
        else:
            previews = workflow.preview_case_lesion(site_store, image["patient_id"], image["visit_date"])
            preview = next((item for item in previews if item.get("source_image_path") == image.get("image_path")), None)
            if preview is None or not preview.get("lesion_crop_path"):
                raise HTTPException(status_code=404, detail="Lesion crop is not available for this image.")
            analysis_path = str(preview["lesion_crop_path"])
        _sync_case_artifact_cache_best_effort(
            workflow,
            site_store,
            patient_id=str(image.get("patient_id") or ""),
            visit_date=str(image.get("visit_date") or ""),
        )
    scorer = _get_semantic_prompt_scorer()
    result = scorer.score_image(analysis_path, view=str(image.get("view") or "white"), top_k=int(params.get("top_k") or 3))
    return {
        "image_id": image_id,
        "view": str(image.get("view") or "white"),
        "input_mode": normalized_input_mode,
        **result,
    }


def _fetch_site_job(params: dict[str, Any]) -> dict[str, Any]:
    cp = get_control_plane()
    user = _approved_user(str(params.get("token") or ""))
    _require_admin_workspace_permission(user)
    site_store = _require_site_access(cp, user, str(params.get("site_id") or "").strip())
    job = site_store.get_job(str(params.get("job_id") or "").strip())
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    return job


def _fetch_site_validations(params: dict[str, Any]) -> list[dict[str, Any]]:
    cp = get_control_plane()
    user = _approved_user(str(params.get("token") or ""))
    site_id = str(params.get("site_id") or "").strip()
    _require_site_access(cp, user, site_id)
    limit = params.get("limit")
    normalized_limit = max(1, min(int(limit or 0), 100)) if limit else None
    return site_level_validation_runs(cp.list_validation_runs(site_id=site_id, limit=normalized_limit))


def _fetch_validation_cases(params: dict[str, Any]) -> list[dict[str, Any]]:
    cp = get_control_plane()
    user = _approved_user(str(params.get("token") or ""))
    site_id = str(params.get("site_id") or "").strip()
    validation_id = str(params.get("validation_id") or "").strip()
    site_store = _require_site_access(cp, user, site_id)
    validation_run = next((item for item in cp.list_validation_runs(site_id=site_id) if item.get("validation_id") == validation_id), None)
    if validation_run is None:
        raise HTTPException(status_code=404, detail="Validation run not found.")
    normalized_limit = max(0, min(int(params.get("limit") or 20), 100))
    return validation_case_rows(
        cp,
        site_store,
        validation_id,
        misclassified_only=bool(params.get("misclassified_only", False)),
        limit=normalized_limit,
    )


def _fetch_site_model_versions(params: dict[str, Any]) -> list[dict[str, Any]]:
    cp = get_control_plane()
    user = _approved_user(str(params.get("token") or ""))
    _require_validation_permission(user)
    _require_site_access(cp, user, str(params.get("site_id") or "").strip())
    return [item for item in cp.list_model_versions() if item.get("ready", True)]


def _run_site_validation(params: dict[str, Any]) -> dict[str, Any]:
    cp = get_control_plane()
    user = _approved_user(str(params.get("token") or ""))
    _require_validation_permission(user)
    site_id = str(params.get("site_id") or "").strip()
    site_store = _require_site_access(cp, user, site_id)
    model_version = require_ready_model_version(
        cp,
        get_model_version=_get_model_version,
        model_version_id=str(params.get("model_version_id") or "").strip() or None,
        unavailable_detail="No ready model version is available for site validation.",
    )
    execution_device = resolve_execution_device_or_raise(
        resolve_execution_device=_resolve_execution_device,
        execution_mode=str(params.get("execution_mode") or "auto"),
        unavailable_label="Site validation",
    )
    payload = SimpleNamespace(
        execution_mode=str(params.get("execution_mode") or "auto"),
        generate_gradcam=bool(params.get("generate_gradcam", True)),
        generate_medsam=bool(params.get("generate_medsam", True)),
    )
    return start_site_validation(
        site_store,
        site_id=site_id,
        project_id=_project_id_for_site(cp, site_id),
        model_version=model_version,
        payload=payload,
        execution_device=execution_device,
        queue_name_for_job_type=_queue_name_for_job_type,
    )


def _run_initial_training(params: dict[str, Any]) -> dict[str, Any]:
    cp = get_control_plane()
    user = _approved_user(str(params.get("token") or ""))
    _require_admin_workspace_permission(user)
    site_id = str(params.get("site_id") or "").strip()
    site_store = _require_site_access(cp, user, site_id)
    architecture = str(params.get("architecture") or "convnext_tiny")
    if architecture not in TRAINING_ARCHITECTURES:
        raise HTTPException(status_code=400, detail=f"Initial training supports only these architectures: {', '.join(TRAINING_ARCHITECTURES)}")
    execution_device = resolve_execution_device_or_raise(
        resolve_execution_device=_resolve_execution_device,
        execution_mode=str(params.get("execution_mode") or "auto"),
        unavailable_label="Initial training",
    )
    payload = SimpleNamespace(
        architecture=architecture,
        execution_mode=str(params.get("execution_mode") or "auto"),
        crop_mode=str(params.get("crop_mode") or "automated"),
        case_aggregation=str(params.get("case_aggregation") or "mean"),
        epochs=int(params.get("epochs") or 30),
        learning_rate=float(params.get("learning_rate") or 1e-4),
        batch_size=int(params.get("batch_size") or 16),
        val_split=float(params.get("val_split") or 0.2),
        test_split=float(params.get("test_split") or 0.2),
        use_pretrained=bool(params.get("use_pretrained", True)),
        regenerate_split=bool(params.get("regenerate_split", False)),
    )
    return start_initial_training(
        site_store,
        site_id=site_id,
        payload=payload,
        execution_device=execution_device,
        queue_name_for_job_type=_queue_name_for_job_type,
        model_dir=MODEL_DIR,
        make_id=make_id,
    )


def _run_initial_training_benchmark(params: dict[str, Any]) -> dict[str, Any]:
    cp = get_control_plane()
    user = _approved_user(str(params.get("token") or ""))
    _require_admin_workspace_permission(user)
    site_id = str(params.get("site_id") or "").strip()
    site_store = _require_site_access(cp, user, site_id)
    architectures = [str(item).strip() for item in params.get("architectures") or [] if str(item).strip()]
    if not architectures:
        raise HTTPException(status_code=400, detail="At least one architecture is required.")
    invalid = [item for item in architectures if item not in TRAINING_ARCHITECTURES]
    if invalid:
        raise HTTPException(status_code=400, detail=f"Initial training supports only these architectures: {', '.join(TRAINING_ARCHITECTURES)}")
    execution_device = resolve_execution_device_or_raise(
        resolve_execution_device=_resolve_execution_device,
        execution_mode=str(params.get("execution_mode") or "auto"),
        unavailable_label="Benchmark training",
    )
    payload = SimpleNamespace(
        execution_mode=str(params.get("execution_mode") or "auto"),
        crop_mode=str(params.get("crop_mode") or "automated"),
        case_aggregation=str(params.get("case_aggregation") or "mean"),
        epochs=int(params.get("epochs") or 30),
        learning_rate=float(params.get("learning_rate") or 1e-4),
        batch_size=int(params.get("batch_size") or 16),
        val_split=float(params.get("val_split") or 0.2),
        test_split=float(params.get("test_split") or 0.2),
        use_pretrained=bool(params.get("use_pretrained", True)),
        regenerate_split=bool(params.get("regenerate_split", False)),
    )
    return start_initial_training_benchmark(
        site_store,
        site_id=site_id,
        payload=payload,
        architectures=architectures,
        execution_device=execution_device,
        queue_name_for_job_type=_queue_name_for_job_type,
    )


def _resume_initial_training_benchmark(params: dict[str, Any]) -> dict[str, Any]:
    cp = get_control_plane()
    user = _approved_user(str(params.get("token") or ""))
    _require_admin_workspace_permission(user)
    site_id = str(params.get("site_id") or "").strip()
    site_store = _require_site_access(cp, user, site_id)
    job_id = str(params.get("job_id") or "").strip()
    source_job = site_store.get_job(job_id)
    if source_job is None:
        raise HTTPException(status_code=404, detail="Source benchmark job not found.")
    if str(source_job.get("job_type") or "") != "initial_training_benchmark":
        raise HTTPException(status_code=400, detail="Only benchmark training jobs can be resumed.")
    if str(source_job.get("status") or "").strip().lower() in {"queued", "running", "cancelling"}:
        raise HTTPException(status_code=409, detail="The selected benchmark job is still active.")
    source_payload = dict(source_job.get("payload") or {})
    requested_architectures = [str(item).strip() for item in source_payload.get("architectures") or [] if str(item).strip()]
    if not requested_architectures:
        raise HTTPException(status_code=400, detail="The selected benchmark job does not contain architectures.")
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
    remaining_architectures = [architecture for architecture in requested_architectures if architecture and architecture not in completed_architectures]
    if not remaining_architectures:
        raise HTTPException(status_code=400, detail="There are no incomplete architectures to resume.")
    execution_mode = str(params.get("execution_mode") or source_payload.get("execution_mode") or "auto")
    execution_device = resolve_execution_device_or_raise(
        resolve_execution_device=_resolve_execution_device,
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
        regenerate_split=False,
    )
    return start_initial_training_benchmark(
        site_store,
        site_id=site_id,
        payload=resume_payload,
        architectures=remaining_architectures,
        execution_device=execution_device,
        queue_name_for_job_type=_queue_name_for_job_type,
    )


def _cancel_site_job(params: dict[str, Any]) -> dict[str, Any]:
    cp = get_control_plane()
    user = _approved_user(str(params.get("token") or ""))
    _require_admin_workspace_permission(user)
    site_store = _require_site_access(cp, user, str(params.get("site_id") or "").strip())
    job = site_store.request_job_cancel(str(params.get("job_id") or "").strip())
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    return job


def _fetch_cross_validation_reports(params: dict[str, Any]) -> list[dict[str, Any]]:
    cp = get_control_plane()
    user = _approved_user(str(params.get("token") or ""))
    _require_admin_workspace_permission(user)
    site_store = _require_site_access(cp, user, str(params.get("site_id") or "").strip())
    return load_cross_validation_reports(site_store)


def _run_cross_validation(params: dict[str, Any]) -> dict[str, Any]:
    cp = get_control_plane()
    user = _approved_user(str(params.get("token") or ""))
    _require_admin_workspace_permission(user)
    site_id = str(params.get("site_id") or "").strip()
    site_store = _require_site_access(cp, user, site_id)
    architecture = str(params.get("architecture") or "convnext_tiny")
    if architecture not in TRAINING_ARCHITECTURES:
        raise HTTPException(status_code=400, detail=f"Cross-validation supports only these architectures: {', '.join(TRAINING_ARCHITECTURES)}")
    execution_device = resolve_execution_device_or_raise(
        resolve_execution_device=_resolve_execution_device,
        execution_mode=str(params.get("execution_mode") or "auto"),
        unavailable_label="Cross-validation",
    )
    payload = SimpleNamespace(
        architecture=architecture,
        execution_mode=str(params.get("execution_mode") or "auto"),
        crop_mode=str(params.get("crop_mode") or "automated"),
        case_aggregation=str(params.get("case_aggregation") or "mean"),
        num_folds=int(params.get("num_folds") or 5),
        epochs=int(params.get("epochs") or 10),
        learning_rate=float(params.get("learning_rate") or 1e-4),
        batch_size=int(params.get("batch_size") or 16),
        val_split=float(params.get("val_split") or 0.2),
        use_pretrained=bool(params.get("use_pretrained", True)),
    )
    return start_cross_validation(
        site_store,
        site_id=site_id,
        payload=payload,
        execution_device=execution_device,
        queue_name_for_job_type=_queue_name_for_job_type,
        model_dir=MODEL_DIR,
        make_id=make_id,
    )


def _fetch_ai_clinic_embedding_status(params: dict[str, Any]) -> dict[str, Any]:
    cp = get_control_plane()
    user = _approved_user(str(params.get("token") or ""))
    _require_admin_workspace_permission(user)
    site_store = _require_site_access(cp, user, str(params.get("site_id") or "").strip())
    model_version = require_ready_model_version(
        cp,
        get_model_version=_get_model_version,
        model_version_id=str(params.get("model_version_id") or "").strip() or None,
        unavailable_detail="No ready model version is available for AI Clinic embedding status.",
    )
    return _build_embedding_backfill_status(cp, site_store, model_version=model_version)


def _backfill_ai_clinic_embeddings(params: dict[str, Any]) -> dict[str, Any]:
    cp = get_control_plane()
    user = _approved_user(str(params.get("token") or ""))
    _require_admin_workspace_permission(user)
    site_id = str(params.get("site_id") or "").strip()
    site_store = _require_site_access(cp, user, site_id)
    active_job = _latest_embedding_backfill_job(site_store)
    if active_job is not None and active_job.get("status") in {"queued", "running"}:
        active_payload = dict(active_job.get("payload") or {})
        active_model_version = _get_model_version(cp, str(active_payload.get("model_version_id") or "") or None)
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
        get_model_version=_get_model_version,
        model_version_id=str(params.get("model_version_id") or "").strip() or None,
        unavailable_detail="No ready model version is available for AI Clinic embedding backfill.",
    )
    execution_device = resolve_execution_device_or_raise(
        resolve_execution_device=_resolve_execution_device,
        execution_mode=str(params.get("execution_mode") or "auto"),
        unavailable_label="AI Clinic embedding backfill",
    )
    job = _queue_site_embedding_backfill(
        cp,
        site_store,
        model_version=model_version,
        execution_device=execution_device,
        force_refresh=bool(params.get("force_refresh", False)),
    )
    return {
        "site_id": site_id,
        "job": job,
        "model_version": serialize_site_model_version(model_version),
        "execution_device": execution_device,
    }


_METHODS: dict[str, Callable[[dict[str, Any]], Any]] = {
    "ping": lambda _params: {"status": "ok"},
    "run_case_validation": _run_case_validation,
    "run_case_validation_compare": _run_case_validation_compare,
    "run_case_ai_clinic": _run_case_ai_clinic,
    "run_case_contribution": _run_case_contribution,
    "fetch_case_roi_preview": _fetch_case_roi_preview,
    "fetch_case_lesion_preview": _fetch_case_lesion_preview,
    "start_live_lesion_preview": _start_live_lesion_preview,
    "fetch_live_lesion_preview_job": _fetch_live_lesion_preview_job,
    "fetch_image_semantic_prompt_scores": _fetch_image_semantic_prompt_scores,
    "fetch_site_job": _fetch_site_job,
    "fetch_site_validations": _fetch_site_validations,
    "fetch_validation_cases": _fetch_validation_cases,
    "fetch_site_model_versions": _fetch_site_model_versions,
    "run_site_validation": _run_site_validation,
    "run_initial_training": _run_initial_training,
    "run_initial_training_benchmark": _run_initial_training_benchmark,
    "resume_initial_training_benchmark": _resume_initial_training_benchmark,
    "cancel_site_job": _cancel_site_job,
    "fetch_cross_validation_reports": _fetch_cross_validation_reports,
    "run_cross_validation": _run_cross_validation,
    "fetch_ai_clinic_embedding_status": _fetch_ai_clinic_embedding_status,
    "backfill_ai_clinic_embeddings": _backfill_ai_clinic_embeddings,
}


def _handle_request(raw: str) -> dict[str, Any]:
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        return {"id": None, "ok": False, "error": {"message": f"Invalid sidecar request JSON: {exc}"}}
    if not isinstance(payload, dict):
        return {"id": None, "ok": False, "error": {"message": "Invalid sidecar request payload."}}
    method = str(payload.get("method") or "").strip()
    request_id = payload.get("id")
    if not method:
        return {"id": request_id, "ok": False, "error": {"message": "Missing sidecar method."}}
    handler = _METHODS.get(method)
    if handler is None:
        return {"id": request_id, "ok": False, "error": {"message": f"Unknown sidecar method: {method}"}}
    try:
        result = handler(dict(payload.get("params") or {}))
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, str) else json.dumps(exc.detail, ensure_ascii=False)
        return _error(request_id, detail, code=int(exc.status_code))
    except Exception as exc:
        return _error(request_id, str(exc))
    return _result(request_id, result)


def main() -> None:
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        _write_message(_handle_request(line))


if __name__ == "__main__":
    main()
