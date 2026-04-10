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
    resolve_requested_image_level_federated_model,
    resolve_requested_model_version,
    resolve_requested_visit_level_federated_model,
    serialize_case_artifact_availability,
    serialize_case_model_version,
)
from kera_research.api.route_helpers import load_cross_validation_reports, site_level_validation_runs, validation_case_rows
from kera_research.api.site_jobs import (
    build_federated_retrieval_corpus_status,
    build_image_level_federated_round_status,
    build_visit_level_federated_round_status,
    latest_federated_retrieval_sync_job,
    latest_image_level_federated_round_job,
    latest_visit_level_federated_round_job,
    require_ready_model_version,
    resolve_execution_device_or_raise,
    serialize_site_model_version,
    start_federated_retrieval_corpus_sync,
    start_image_level_federated_round,
    start_visit_level_federated_round,
    start_cross_validation,
    start_initial_training,
    start_initial_training_benchmark,
    start_retrieval_baseline,
    start_site_validation,
    start_ssl_pretraining,
)
from kera_research.config import MODEL_DIR
from kera_research.domain import TRAINING_ARCHITECTURES, make_id
from kera_research.services.data_plane import SiteStore
from kera_research.services.image_artifact_status import sync_image_artifact_cache
from kera_research.services.ssl_pretraining import SUPPORTED_SSL_ARCHITECTURES

_LESION_PREVIEW_JOBS: dict[str, dict[str, Any]] = {}
_LESION_PREVIEW_JOBS_LOCK = threading.Lock()
_SHARED_WORKFLOW: Any | None = None
_SHARED_WORKFLOW_CONDITION = threading.Condition()
_SHARED_WORKFLOW_WARMING = False
_SHARED_WORKFLOW_WARM_STARTED_AT: str | None = None
_SHARED_WORKFLOW_WARM_COMPLETED_AT: str | None = None
_SHARED_WORKFLOW_WARM_ERROR: str | None = None


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _workflow_warm_status() -> dict[str, Any]:
    with _SHARED_WORKFLOW_CONDITION:
        if _SHARED_WORKFLOW is not None:
            status = "ready"
        elif _SHARED_WORKFLOW_WARMING:
            status = "warming"
        elif _SHARED_WORKFLOW_WARM_ERROR:
            status = "failed"
        else:
            status = "idle"
        return {
            "status": status,
            "warmed": _SHARED_WORKFLOW is not None,
            "started_at": _SHARED_WORKFLOW_WARM_STARTED_AT,
            "completed_at": _SHARED_WORKFLOW_WARM_COMPLETED_AT,
            "last_error": _SHARED_WORKFLOW_WARM_ERROR,
        }


def _build_shared_workflow(cp: Any) -> tuple[Any | None, str | None]:
    try:
        return _get_workflow(cp), None
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, str) else json.dumps(exc.detail, ensure_ascii=False)
        return None, detail
    except Exception as exc:
        return None, str(exc)


def _finish_shared_workflow_build(workflow: Any | None, error: str | None) -> None:
    global _SHARED_WORKFLOW, _SHARED_WORKFLOW_WARMING, _SHARED_WORKFLOW_WARM_COMPLETED_AT, _SHARED_WORKFLOW_WARM_ERROR
    with _SHARED_WORKFLOW_CONDITION:
        if workflow is not None:
            _SHARED_WORKFLOW = workflow
            _SHARED_WORKFLOW_WARM_COMPLETED_AT = _utc_now_iso()
            _SHARED_WORKFLOW_WARM_ERROR = None
        elif error:
            _SHARED_WORKFLOW_WARM_ERROR = error
        _SHARED_WORKFLOW_WARMING = False
        _SHARED_WORKFLOW_CONDITION.notify_all()


def _warm_shared_workflow_runner() -> None:
    cp = get_control_plane()
    workflow, error = _build_shared_workflow(cp)
    _finish_shared_workflow_build(workflow, error)


def _start_shared_workflow_warmup() -> dict[str, Any]:
    global _SHARED_WORKFLOW_WARMING, _SHARED_WORKFLOW_WARM_STARTED_AT, _SHARED_WORKFLOW_WARM_COMPLETED_AT, _SHARED_WORKFLOW_WARM_ERROR
    with _SHARED_WORKFLOW_CONDITION:
        if _SHARED_WORKFLOW is not None or _SHARED_WORKFLOW_WARMING:
            return _workflow_warm_status()
        _SHARED_WORKFLOW_WARMING = True
        _SHARED_WORKFLOW_WARM_STARTED_AT = _utc_now_iso()
        _SHARED_WORKFLOW_WARM_COMPLETED_AT = None
        _SHARED_WORKFLOW_WARM_ERROR = None
    threading.Thread(target=_warm_shared_workflow_runner, daemon=True, name="kera-sidecar-workflow-warmup").start()
    return _workflow_warm_status()


def _ensure_shared_workflow(cp: Any) -> Any:
    global _SHARED_WORKFLOW_WARMING, _SHARED_WORKFLOW_WARM_STARTED_AT, _SHARED_WORKFLOW_WARM_COMPLETED_AT, _SHARED_WORKFLOW_WARM_ERROR
    with _SHARED_WORKFLOW_CONDITION:
        if _SHARED_WORKFLOW is not None:
            return _SHARED_WORKFLOW
        while _SHARED_WORKFLOW_WARMING and _SHARED_WORKFLOW is None:
            _SHARED_WORKFLOW_CONDITION.wait(timeout=0.1)
        if _SHARED_WORKFLOW is not None:
            return _SHARED_WORKFLOW
        _SHARED_WORKFLOW_WARMING = True
        _SHARED_WORKFLOW_WARM_STARTED_AT = _utc_now_iso()
        _SHARED_WORKFLOW_WARM_COMPLETED_AT = None
        _SHARED_WORKFLOW_WARM_ERROR = None
    workflow, error = _build_shared_workflow(cp)
    _finish_shared_workflow_build(workflow, error)
    if workflow is None:
        raise HTTPException(status_code=503, detail=error or "AI workflow is not available on this server.")
    return workflow


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
    workflow = _ensure_shared_workflow(cp)
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
    if case_prediction is not None and summary.get("validation_mode") != "inference_only":
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
    workflow = _ensure_shared_workflow(cp)
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
    workflow = _ensure_shared_workflow(cp)
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
        retrieval_profile=str(params.get("retrieval_profile") or "dinov2_lesion_crop"),
    )
    _sync_case_artifact_cache_best_effort(workflow, site_store, patient_id=patient_id, visit_date=visit_date)
    return {
        **result,
        "analysis_stage": "expanded",
    }


def _run_case_ai_clinic_similar_cases(params: dict[str, Any]) -> dict[str, Any]:
    cp = get_control_plane()
    user = _approved_user(str(params.get("token") or ""))
    _require_validation_permission(user)
    site_id = str(params.get("site_id") or "").strip()
    site_store = _require_site_access(cp, user, site_id)
    workflow = _ensure_shared_workflow(cp)
    model_version = _resolve_case_model_version(cp, params)
    execution_device = _resolve_execution_device(str(params.get("execution_mode") or "auto"))
    patient_id = str(params.get("patient_id") or "").strip()
    visit_date = str(params.get("visit_date") or "").strip()
    result = workflow.run_ai_clinic_similar_cases(
        site_store,
        patient_id=patient_id,
        visit_date=visit_date,
        model_version=model_version,
        execution_device=execution_device,
        top_k=int(params.get("top_k") or 3),
        retrieval_backend=str(params.get("retrieval_backend") or "standard"),
        retrieval_profile=str(params.get("retrieval_profile") or "dinov2_lesion_crop"),
    )
    _sync_case_artifact_cache_best_effort(workflow, site_store, patient_id=patient_id, visit_date=visit_date)
    return {
        **result,
        "analysis_stage": "similar_cases",
        "text_retrieval_mode": None,
        "text_embedding_model": None,
        "eligible_text_count": 0,
        "text_evidence": [],
        "text_retrieval_error": None,
        "classification_context": None,
        "differential": None,
        "workflow_recommendation": None,
    }


def _run_case_contribution(params: dict[str, Any]) -> dict[str, Any]:
    cp = get_control_plane()
    user = _approved_user(str(params.get("token") or ""))
    _require_validation_permission(user)
    site_id = str(params.get("site_id") or "").strip()
    site_store = _require_site_access(cp, user, site_id)
    workflow = _ensure_shared_workflow(cp)
    patient_id = str(params.get("patient_id") or "").strip()
    visit_date = str(params.get("visit_date") or "").strip()
    try:
        policy_state = site_store.case_research_policy_state(patient_id, visit_date)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    visit_status = str(policy_state.get("visit_status") or "active")
    if cp.get_registry_consent(user["user_id"], site_id) is None:
        raise HTTPException(status_code=409, detail="Join the research registry before contributing this case.")
    if not policy_state.get("is_active"):
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
                    registry_consent_granted=True,
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
    workflow = _ensure_shared_workflow(cp)
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
    workflow = _ensure_shared_workflow(cp)
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
    workflow = _ensure_shared_workflow(cp)
    prompt_signature = workflow._lesion_prompt_box_signature(lesion_prompt_box)
    with _LESION_PREVIEW_JOBS_LOCK:
        for existing in reversed(list(_LESION_PREVIEW_JOBS.values())):
            if (
                existing.get("site_id") == site_id
                and existing.get("image_id") == image_id
                and existing.get("status") == "running"
            ):
                if prompt_signature in {
                    existing.get("prompt_signature"),
                    existing.get("pending_prompt_signature"),
                }:
                    return _serialize_lesion_preview_job(dict(existing))
                existing["pending_prompt_signature"] = prompt_signature
                existing["pending_lesion_prompt_box"] = dict(lesion_prompt_box)
                existing["finished_at"] = None
                return _serialize_lesion_preview_job(dict(existing))
            if (
                existing.get("site_id") == site_id
                and existing.get("image_id") == image_id
                and existing.get("prompt_signature") == prompt_signature
                and existing.get("status") == "done"
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
        "pending_prompt_signature": None,
        "pending_lesion_prompt_box": None,
    }
    with _LESION_PREVIEW_JOBS_LOCK:
        _LESION_PREVIEW_JOBS[job_id] = job_record

    def _run() -> None:
        while True:
            with _LESION_PREVIEW_JOBS_LOCK:
                current_job = _LESION_PREVIEW_JOBS.get(job_id)
                if current_job is None:
                    return
                pending_signature = current_job.pop("pending_prompt_signature", None)
                pending_box = current_job.pop("pending_lesion_prompt_box", None)
                if pending_signature:
                    current_job["prompt_signature"] = pending_signature
                    if isinstance(pending_box, dict):
                        current_job["lesion_prompt_box"] = dict(pending_box)
                active_box = dict(current_job.get("lesion_prompt_box") or lesion_prompt_box)
                active_signature = str(
                    current_job.get("prompt_signature")
                    or workflow._lesion_prompt_box_signature(active_box)
                    or ""
                )
                current_job.update(
                    {
                        "status": "running",
                        "error": None,
                        "result": None,
                        "finished_at": None,
                        "prompt_signature": active_signature,
                        "lesion_prompt_box": active_box,
                    }
                )
            try:
                result = workflow.preview_image_lesion(
                    site_store,
                    image_id,
                    lesion_prompt_box=active_box,
                )
            except Exception as exc:
                with _LESION_PREVIEW_JOBS_LOCK:
                    current_job = _LESION_PREVIEW_JOBS.get(job_id)
                    if current_job is None:
                        return
                    if current_job.get("pending_prompt_signature"):
                        continue
                    current_job.update(
                        {
                            "status": "failed",
                            "error": str(exc),
                            "finished_at": datetime.now(timezone.utc).isoformat(),
                        }
                    )
                return

            rerun_required = False
            with _LESION_PREVIEW_JOBS_LOCK:
                current_job = _LESION_PREVIEW_JOBS.get(job_id)
                if current_job is None:
                    return
                rerun_required = bool(current_job.get("pending_prompt_signature"))
                if rerun_required:
                    current_job.update(
                        {
                            "status": "running",
                            "error": None,
                            "finished_at": None,
                        }
                    )
                else:
                    current_job.update(
                        {
                            "status": "done",
                            "result": result,
                            "finished_at": datetime.now(timezone.utc).isoformat(),
                            "prompt_signature": active_signature,
                            "lesion_prompt_box": active_box,
                        }
                    )
            if rerun_required:
                continue

            refreshed_image = site_store.get_image(image_id) or image
            _sync_image_artifact_cache_best_effort(workflow, site_store, refreshed_image)
            return

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
        workflow = _ensure_shared_workflow(cp)
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


def _list_site_jobs(params: dict[str, Any]) -> list[dict[str, Any]]:
    cp = get_control_plane()
    user = _approved_user(str(params.get("token") or ""))
    _require_admin_workspace_permission(user)
    site_store = _require_site_access(cp, user, str(params.get("site_id") or "").strip())
    jobs = site_store.list_jobs(status=str(params.get("status") or "").strip() or None)
    normalized_job_type = str(params.get("job_type") or "").strip()
    if normalized_job_type:
        jobs = [job for job in jobs if str(job.get("job_type") or "").strip() == normalized_job_type]
    limit = params.get("limit")
    normalized_limit = max(1, min(int(limit or 0), 100)) if limit else None
    if normalized_limit is not None:
        jobs = jobs[:normalized_limit]
    return jobs


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
        pretraining_source=str(params.get("pretraining_source") or "").strip() or None,
        ssl_checkpoint_path=str(params.get("ssl_checkpoint_path") or "").strip() or None,
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


def _run_image_level_federated_round(params: dict[str, Any]) -> dict[str, Any]:
    cp = get_control_plane()
    user = _approved_user(str(params.get("token") or ""))
    _require_admin_workspace_permission(user)
    site_id = str(params.get("site_id") or "").strip()
    site_store = _require_site_access(cp, user, site_id)
    if cp.get_registry_consent(user["user_id"], site_id) is None:
        raise HTTPException(
            status_code=409,
            detail="Research registry consent is required before running image-level federated learning.",
        )
    try:
        model_version = resolve_requested_image_level_federated_model(
            cp,
            get_model_version=_get_model_version,
            model_version_id=str(params.get("model_version_id") or "").strip() or None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    execution_device = resolve_execution_device_or_raise(
        resolve_execution_device=_resolve_execution_device,
        execution_mode=str(params.get("execution_mode") or "auto"),
        unavailable_label="Image-level federated learning",
    )
    requested_epochs = int(params.get("epochs") or 1)
    requested_learning_rate = float(params.get("learning_rate") or 5e-5)
    requested_batch_size = int(params.get("batch_size") or 8)
    active_job = latest_image_level_federated_round_job(
        site_store,
        model_version_id=str(model_version.get("version_id") or ""),
        execution_device=execution_device,
        epochs=requested_epochs,
        learning_rate=requested_learning_rate,
        batch_size=requested_batch_size,
    )
    if active_job is not None and active_job.get("status") in {"queued", "running"}:
        active_payload = dict(active_job.get("payload") or {})
        return {
            "site_id": site_id,
            "execution_device": active_payload.get("execution_device", execution_device),
            "job": active_job,
            "model_version": serialize_site_model_version(model_version),
        }
    status_snapshot = build_image_level_federated_round_status(site_store, model_version=model_version, cp=cp)
    if int(status_snapshot.get("eligible_case_count") or 0) <= 0:
        skipped = dict(status_snapshot.get("skipped") or {})
        raise HTTPException(
            status_code=409,
            detail=(
                "Image-level federated learning requires at least one positive, active, included case with saved images. "
                f"Skipped: positive={int(skipped.get('not_positive') or 0)}, "
                f"active={int(skipped.get('not_active') or 0)}, "
                f"included={int(skipped.get('not_included') or 0)}, "
                f"images={int(skipped.get('no_images') or 0)}."
            ),
        )
    payload = SimpleNamespace(
        execution_mode=str(params.get("execution_mode") or "auto"),
        epochs=int(params.get("epochs") or 1),
        learning_rate=float(params.get("learning_rate") or 5e-5),
        batch_size=int(params.get("batch_size") or 8),
    )
    return start_image_level_federated_round(
        site_store,
        site_id=site_id,
        model_version=model_version,
        payload=payload,
        execution_device=execution_device,
        queue_name_for_job_type=_queue_name_for_job_type,
    )


def _fetch_image_level_federated_round_status(params: dict[str, Any]) -> dict[str, Any]:
    cp = get_control_plane()
    user = _approved_user(str(params.get("token") or ""))
    _require_admin_workspace_permission(user)
    site_store = _require_site_access(cp, user, str(params.get("site_id") or "").strip())
    try:
        model_version = resolve_requested_image_level_federated_model(
            cp,
            get_model_version=_get_model_version,
            model_version_id=str(params.get("model_version_id") or "").strip() or None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return build_image_level_federated_round_status(site_store, model_version=model_version, cp=cp)


def _run_visit_level_federated_round(params: dict[str, Any]) -> dict[str, Any]:
    cp = get_control_plane()
    user = _approved_user(str(params.get("token") or ""))
    _require_admin_workspace_permission(user)
    site_id = str(params.get("site_id") or "").strip()
    site_store = _require_site_access(cp, user, site_id)
    if cp.get_registry_consent(user["user_id"], site_id) is None:
        raise HTTPException(
            status_code=409,
            detail="Research registry consent is required before running visit-level federated learning.",
        )
    try:
        model_version = resolve_requested_visit_level_federated_model(
            cp,
            get_model_version=_get_model_version,
            model_version_id=str(params.get("model_version_id") or "").strip() or None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    execution_device = resolve_execution_device_or_raise(
        resolve_execution_device=_resolve_execution_device,
        execution_mode=str(params.get("execution_mode") or "auto"),
        unavailable_label="Visit-level federated learning",
    )
    requested_epochs = int(params.get("epochs") or 1)
    requested_learning_rate = float(params.get("learning_rate") or 5e-5)
    requested_batch_size = int(params.get("batch_size") or 4)
    active_job = latest_visit_level_federated_round_job(
        site_store,
        model_version_id=str(model_version.get("version_id") or ""),
        execution_device=execution_device,
        epochs=requested_epochs,
        learning_rate=requested_learning_rate,
        batch_size=requested_batch_size,
    )
    if active_job is not None and active_job.get("status") in {"queued", "running"}:
        active_payload = dict(active_job.get("payload") or {})
        return {
            "site_id": site_id,
            "execution_device": active_payload.get("execution_device", execution_device),
            "job": active_job,
            "model_version": serialize_site_model_version(model_version),
        }
    status_snapshot = build_visit_level_federated_round_status(site_store, model_version=model_version, cp=cp)
    if int(status_snapshot.get("eligible_case_count") or 0) <= 0:
        skipped = dict(status_snapshot.get("skipped") or {})
        raise HTTPException(
            status_code=409,
            detail=(
                "Visit-level federated learning requires at least one positive, active, included case with saved images. "
                f"Skipped: positive={int(skipped.get('not_positive') or 0)}, "
                f"active={int(skipped.get('not_active') or 0)}, "
                f"included={int(skipped.get('not_included') or 0)}, "
                f"images={int(skipped.get('no_images') or 0)}."
            ),
        )
    payload = SimpleNamespace(
        execution_mode=str(params.get("execution_mode") or "auto"),
        epochs=int(params.get("epochs") or 1),
        learning_rate=float(params.get("learning_rate") or 5e-5),
        batch_size=int(params.get("batch_size") or 4),
    )
    return start_visit_level_federated_round(
        site_store,
        site_id=site_id,
        model_version=model_version,
        payload=payload,
        execution_device=execution_device,
        queue_name_for_job_type=_queue_name_for_job_type,
    )


def _fetch_visit_level_federated_round_status(params: dict[str, Any]) -> dict[str, Any]:
    cp = get_control_plane()
    user = _approved_user(str(params.get("token") or ""))
    _require_admin_workspace_permission(user)
    site_store = _require_site_access(cp, user, str(params.get("site_id") or "").strip())
    try:
        model_version = resolve_requested_visit_level_federated_model(
            cp,
            get_model_version=_get_model_version,
            model_version_id=str(params.get("model_version_id") or "").strip() or None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return build_visit_level_federated_round_status(site_store, model_version=model_version, cp=cp)


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
        pretraining_source=str(params.get("pretraining_source") or "").strip() or None,
        ssl_checkpoint_path=str(params.get("ssl_checkpoint_path") or "").strip() or None,
        benchmark_suite_key=str(params.get("benchmark_suite_key") or "").strip() or None,
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
        queue_name_for_job_type=_queue_name_for_job_type,
    )


def _run_retrieval_baseline(params: dict[str, Any]) -> dict[str, Any]:
    cp = get_control_plane()
    user = _approved_user(str(params.get("token") or ""))
    _require_admin_workspace_permission(user)
    site_id = str(params.get("site_id") or "").strip()
    site_store = _require_site_access(cp, user, site_id)
    execution_device = resolve_execution_device_or_raise(
        resolve_execution_device=_resolve_execution_device,
        execution_mode=str(params.get("execution_mode") or "auto"),
        unavailable_label="Retrieval baseline",
    )
    payload = SimpleNamespace(
        execution_mode=str(params.get("execution_mode") or "auto"),
        crop_mode=str(params.get("crop_mode") or "automated"),
        top_k=int(params.get("top_k") or 10),
    )
    return start_retrieval_baseline(
        site_store,
        site_id=site_id,
        payload=payload,
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


def _clear_initial_training_benchmark_history(params: dict[str, Any]) -> dict[str, Any]:
    cp = get_control_plane()
    user = _approved_user(str(params.get("token") or ""))
    _require_admin_workspace_permission(user)
    site_id = str(params.get("site_id") or "").strip()
    site_store = _require_site_access(cp, user, site_id)
    active_statuses = {"queued", "running", "cancelling"}
    active_jobs = [
        job
        for job in site_store.list_jobs()
        if str(job.get("job_type") or "") == "initial_training_benchmark"
        and str(job.get("status") or "").strip().lower() in active_statuses
    ]
    if active_jobs:
        raise HTTPException(status_code=409, detail="Stop the active benchmark job before deleting benchmark history.")
    deleted_jobs = site_store.delete_jobs(job_type="initial_training_benchmark")
    return {
        "site_id": site_id,
        "deleted_jobs": deleted_jobs,
    }


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


def _run_ssl_pretraining(params: dict[str, Any]) -> dict[str, Any]:
    cp = get_control_plane()
    user = _approved_user(str(params.get("token") or ""))
    _require_admin_workspace_permission(user)
    site_id = str(params.get("site_id") or "").strip()
    site_store = _require_site_access(cp, user, site_id)
    archive_base_dir = str(params.get("archive_base_dir") or "").strip()
    if not archive_base_dir:
        raise HTTPException(status_code=400, detail="archive_base_dir is required.")
    architecture = str(params.get("architecture") or "convnext_tiny").strip().lower() or "convnext_tiny"
    if architecture not in SUPPORTED_SSL_ARCHITECTURES:
        raise HTTPException(
            status_code=400,
            detail=f"SSL pretraining supports only these architectures: {', '.join(SUPPORTED_SSL_ARCHITECTURES)}",
        )
    execution_device = resolve_execution_device_or_raise(
        resolve_execution_device=_resolve_execution_device,
        execution_mode=str(params.get("execution_mode") or "auto"),
        unavailable_label="SSL pretraining",
    )
    payload = SimpleNamespace(
        archive_base_dir=archive_base_dir,
        architecture=architecture,
        init_mode=str(params.get("init_mode") or "imagenet"),
        method=str(params.get("method") or "byol"),
        execution_mode=str(params.get("execution_mode") or "auto"),
        image_size=int(params.get("image_size") or 224),
        batch_size=int(params.get("batch_size") or 24),
        epochs=int(params.get("epochs") or 10),
        learning_rate=float(params.get("learning_rate") or 1e-4),
        weight_decay=float(params.get("weight_decay") or 1e-4),
        num_workers=int(params.get("num_workers") or 8),
        min_patient_quality=str(params.get("min_patient_quality") or "medium"),
        include_review_rows=bool(params.get("include_review_rows", False)),
        use_amp=bool(params.get("use_amp", True)),
    )
    return start_ssl_pretraining(
        site_store,
        site_id=site_id,
        payload=payload,
        execution_device=execution_device,
        queue_name_for_job_type=_queue_name_for_job_type,
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


def _fetch_federated_retrieval_corpus_status(params: dict[str, Any]) -> dict[str, Any]:
    cp = get_control_plane()
    user = _approved_user(str(params.get("token") or ""))
    _require_admin_workspace_permission(user)
    site_id = str(params.get("site_id") or "").strip()
    retrieval_profile = str(params.get("retrieval_profile") or "dinov2_lesion_crop")
    site_store = _require_site_access(cp, user, site_id)
    return build_federated_retrieval_corpus_status(
        cp,
        site_store,
        retrieval_profile=retrieval_profile,
        workflow_factory=_get_workflow,
    )


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


def _sync_federated_retrieval_corpus(params: dict[str, Any]) -> dict[str, Any]:
    cp = get_control_plane()
    user = _approved_user(str(params.get("token") or ""))
    _require_admin_workspace_permission(user)
    site_id = str(params.get("site_id") or "").strip()
    site_store = _require_site_access(cp, user, site_id)
    if cp.get_registry_consent(user["user_id"], site_id) is None:
        raise HTTPException(
            status_code=409,
            detail="Research registry consent is required before syncing retrieval corpus entries.",
        )
    if not cp.remote_node_sync_enabled():
        raise HTTPException(
            status_code=503,
            detail="Remote control-plane node sync is not configured.",
        )
    retrieval_profile = str(params.get("retrieval_profile") or "dinov2_lesion_crop")
    active_job = latest_federated_retrieval_sync_job(site_store, retrieval_profile=retrieval_profile)
    execution_device = resolve_execution_device_or_raise(
        resolve_execution_device=_resolve_execution_device,
        execution_mode=str(params.get("execution_mode") or "auto"),
        unavailable_label="Federated retrieval corpus sync",
    )
    if active_job is not None and active_job.get("status") in {"queued", "running"}:
        active_payload = dict(active_job.get("payload") or {})
        return {
            "site_id": site_id,
            "execution_device": active_payload.get("execution_device", execution_device),
            "retrieval_profile": active_payload.get("retrieval_profile", retrieval_profile),
            "force_refresh": bool(active_payload.get("force_refresh", False)),
            "job": active_job,
        }
    payload = SimpleNamespace(
        execution_mode=str(params.get("execution_mode") or "auto"),
        retrieval_profile=retrieval_profile,
        force_refresh=bool(params.get("force_refresh", False)),
    )
    return start_federated_retrieval_corpus_sync(
        site_store,
        site_id=site_id,
        payload=payload,
        execution_device=execution_device,
        queue_name_for_job_type=_queue_name_for_job_type,
    )


_METHODS: dict[str, Callable[[dict[str, Any]], Any]] = {
    "ping": lambda _params: {"status": "ok"},
    "warm_workflow": lambda _params: _start_shared_workflow_warmup(),
    "workflow_status": lambda _params: _workflow_warm_status(),
    "run_case_validation": _run_case_validation,
    "run_case_validation_compare": _run_case_validation_compare,
    "run_case_ai_clinic": _run_case_ai_clinic,
    "run_case_ai_clinic_similar_cases": _run_case_ai_clinic_similar_cases,
    "run_case_contribution": _run_case_contribution,
    "fetch_case_roi_preview": _fetch_case_roi_preview,
    "fetch_case_lesion_preview": _fetch_case_lesion_preview,
    "start_live_lesion_preview": _start_live_lesion_preview,
    "fetch_live_lesion_preview_job": _fetch_live_lesion_preview_job,
    "fetch_image_semantic_prompt_scores": _fetch_image_semantic_prompt_scores,
    "fetch_site_job": _fetch_site_job,
    "list_site_jobs": _list_site_jobs,
    "fetch_site_validations": _fetch_site_validations,
    "fetch_validation_cases": _fetch_validation_cases,
    "fetch_site_model_versions": _fetch_site_model_versions,
    "run_site_validation": _run_site_validation,
    "run_initial_training": _run_initial_training,
    "run_image_level_federated_round": _run_image_level_federated_round,
    "fetch_image_level_federated_round_status": _fetch_image_level_federated_round_status,
    "run_visit_level_federated_round": _run_visit_level_federated_round,
    "fetch_visit_level_federated_round_status": _fetch_visit_level_federated_round_status,
    "run_initial_training_benchmark": _run_initial_training_benchmark,
    "run_retrieval_baseline": _run_retrieval_baseline,
    "resume_initial_training_benchmark": _resume_initial_training_benchmark,
    "cancel_site_job": _cancel_site_job,
    "clear_initial_training_benchmark_history": _clear_initial_training_benchmark_history,
    "fetch_cross_validation_reports": _fetch_cross_validation_reports,
    "run_cross_validation": _run_cross_validation,
    "run_ssl_pretraining": _run_ssl_pretraining,
    "fetch_ai_clinic_embedding_status": _fetch_ai_clinic_embedding_status,
    "fetch_federated_retrieval_corpus_status": _fetch_federated_retrieval_corpus_status,
    "backfill_ai_clinic_embeddings": _backfill_ai_clinic_embeddings,
    "sync_federated_retrieval_corpus": _sync_federated_retrieval_corpus,
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
