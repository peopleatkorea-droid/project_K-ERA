import concurrent.futures
import logging
import threading
from collections.abc import Callable
from typing import Any

from fastapi.responses import JSONResponse
from pydantic import BaseModel

from kera_research.services.image_artifact_status import sync_image_artifact_cache

logger = logging.getLogger(__name__)


class CaseResearchRegistryRequest(BaseModel):
    patient_id: str
    visit_date: str
    action: str
    source: str = "manual"


class MedsamArtifactBackfillRequest(BaseModel):
    refresh_cache: bool = True


class ImagePreviewBatchRequest(BaseModel):
    image_ids: list[str]
    max_side: int = 512


def private_json_response(payload: Any, *, max_age: int = 1) -> JSONResponse:
    return JSONResponse(
        content=payload,
        headers={
            "Cache-Control": f"private, max-age={max_age}, stale-while-revalidate=5",
            "Vary": "Authorization",
        },
    )


_IMAGE_DERIVATIVE_EXECUTOR = concurrent.futures.ThreadPoolExecutor(max_workers=1)
_PENDING_IMAGE_DERIVATIVE_IDS: set[tuple[str, str]] = set()
_PENDING_IMAGE_DERIVATIVE_LOCK = threading.Lock()
_CASE_ROUTE_TASK_EXECUTOR = concurrent.futures.ThreadPoolExecutor(max_workers=2)
_CASE_ARTIFACT_CACHE_RESPONSE_BUDGET_SECONDS = 0.25
_CASE_POSTMORTEM_RESPONSE_BUDGET_SECONDS = 0.4


def schedule_image_derivative_backfill(site_store: Any, image_ids: list[str] | None) -> None:
    requested_ids = sorted(
        {
            str(image_id or "").strip()
            for image_id in (image_ids or [])
            if str(image_id or "").strip()
        }
    )
    if not requested_ids:
        return
    site_id = str(getattr(site_store, "site_id", "") or "").strip()
    if not site_id:
        return
    pending_keys = [(site_id, image_id) for image_id in requested_ids]
    with _PENDING_IMAGE_DERIVATIVE_LOCK:
        queued_ids = [
            image_id
            for key, image_id in zip(pending_keys, requested_ids, strict=False)
            if key not in _PENDING_IMAGE_DERIVATIVE_IDS
        ]
        if not queued_ids:
            return
        for image_id in queued_ids:
            _PENDING_IMAGE_DERIVATIVE_IDS.add((site_id, image_id))

    def run_backfill() -> None:
        try:
            site_store.backfill_image_derivatives(queued_ids)
        except Exception as exc:
            logger.warning(
                "Image derivative backfill failed for site=%s image_ids=%s: %s",
                site_id,
                queued_ids,
                exc,
            )
            return
        finally:
            with _PENDING_IMAGE_DERIVATIVE_LOCK:
                for image_id in queued_ids:
                    _PENDING_IMAGE_DERIVATIVE_IDS.discard((site_id, image_id))

    _IMAGE_DERIVATIVE_EXECUTOR.submit(run_backfill)


def sync_case_artifact_cache_best_effort(
    workflow: Any,
    site_store: Any,
    *,
    patient_id: str,
    visit_date: str,
) -> None:
    try:
        for image_record in site_store.list_images_for_visit(patient_id, visit_date):
            sync_image_artifact_cache(workflow, site_store, image_record)
    except Exception:
        return


def sync_image_artifact_cache_best_effort(
    workflow: Any,
    site_store: Any,
    image_record: dict[str, Any] | None,
) -> None:
    if not isinstance(image_record, dict):
        return
    try:
        sync_image_artifact_cache(workflow, site_store, image_record)
    except Exception:
        return


def _run_case_route_task_with_response_budget(
    *,
    work: Callable[[], Any],
    task_label: str,
    timeout_seconds: float,
    on_success: Callable[[Any], None] | None = None,
) -> tuple[Any | None, bool]:
    future = _CASE_ROUTE_TASK_EXECUTOR.submit(work)

    def finalize(completed_future: concurrent.futures.Future[Any]) -> None:
        try:
            result = completed_future.result()
        except Exception as exc:
            logger.warning("%s failed: %s", task_label, exc)
            return
        if on_success is None:
            return
        try:
            on_success(result)
        except Exception as exc:
            logger.warning("%s completion hook failed: %s", task_label, exc)

    try:
        result = future.result(timeout=max(float(timeout_seconds), 0.0))
    except concurrent.futures.TimeoutError:
        future.add_done_callback(finalize)
        return None, False
    except Exception as exc:
        logger.warning("%s failed: %s", task_label, exc)
        return None, False

    if on_success is not None:
        try:
            on_success(result)
        except Exception as exc:
            logger.warning("%s completion hook failed: %s", task_label, exc)
    return result, True


def sync_case_artifact_cache_with_response_budget(
    workflow: Any,
    site_store: Any,
    *,
    patient_id: str,
    visit_date: str,
    timeout_seconds: float = _CASE_ARTIFACT_CACHE_RESPONSE_BUDGET_SECONDS,
) -> None:
    _run_case_route_task_with_response_budget(
        work=lambda: sync_case_artifact_cache_best_effort(
            workflow,
            site_store,
            patient_id=patient_id,
            visit_date=visit_date,
        ),
        task_label=f"Case artifact cache sync site={getattr(site_store, 'site_id', '')} patient={patient_id} visit={visit_date}",
        timeout_seconds=timeout_seconds,
    )


def _persist_case_postmortem(
    cp: Any,
    site_store: Any,
    *,
    patient_id: str,
    visit_date: str,
    summary: dict[str, Any],
    case_prediction_snapshot: dict[str, Any] | None,
    case_reference_id: str,
    post_mortem: dict[str, Any] | None,
) -> None:
    if not isinstance(post_mortem, dict) or not case_reference_id:
        return
    prediction = case_prediction_snapshot or {}
    try:
        cp.update_validation_case_prediction(
            str(summary.get("validation_id") or ""),
            case_reference_id=case_reference_id,
            updates={
                "post_mortem": post_mortem,
                "structured_analysis": post_mortem.get("structured_analysis"),
            },
        )
    except Exception as exc:
        logger.warning(
            "Validation post-mortem persistence failed for validation=%s case_reference_id=%s: %s",
            summary.get("validation_id"),
            case_reference_id,
            exc,
        )
    try:
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
                "predicted_label": prediction.get("predicted_label"),
                "true_label": prediction.get("true_label"),
                "prediction_probability": prediction.get("prediction_probability"),
                "is_correct": prediction.get("is_correct"),
                "prediction_snapshot": prediction.get("prediction_snapshot"),
                "post_mortem": post_mortem,
            },
        )
    except Exception as exc:
        logger.warning(
            "Validation history post-mortem write failed for validation=%s patient=%s visit=%s: %s",
            summary.get("validation_id"),
            patient_id,
            visit_date,
            exc,
        )


def resolve_case_postmortem_with_response_budget(
    workflow: Any,
    site_store: Any,
    cp: Any,
    *,
    patient_id: str,
    visit_date: str,
    model_version: dict[str, Any],
    execution_device: str,
    summary: dict[str, Any],
    classification_context: dict[str, Any],
    case_prediction: dict[str, Any] | None,
    case_reference_id: str,
    timeout_seconds: float = _CASE_POSTMORTEM_RESPONSE_BUDGET_SECONDS,
) -> dict[str, Any] | None:
    case_prediction_snapshot = dict(case_prediction or {})

    def persist(post_mortem: Any) -> None:
        _persist_case_postmortem(
            cp,
            site_store,
            patient_id=patient_id,
            visit_date=visit_date,
            summary=summary,
            case_prediction_snapshot=case_prediction_snapshot,
            case_reference_id=case_reference_id,
            post_mortem=post_mortem if isinstance(post_mortem, dict) else None,
        )

    post_mortem, completed_in_budget = _run_case_route_task_with_response_budget(
        work=lambda: workflow.run_case_postmortem(
            site_store,
            patient_id=patient_id,
            visit_date=visit_date,
            model_version=model_version,
            execution_device=execution_device,
            classification_context=classification_context,
            case_prediction=case_prediction_snapshot,
            top_k=3,
            retrieval_backend="hybrid",
        ),
        task_label=f"Case post-mortem site={getattr(site_store, 'site_id', '')} patient={patient_id} visit={visit_date}",
        timeout_seconds=timeout_seconds,
        on_success=persist,
    )
    if completed_in_budget and isinstance(post_mortem, dict) and isinstance(case_prediction, dict):
        case_prediction["post_mortem"] = post_mortem
    return post_mortem if completed_in_budget and isinstance(post_mortem, dict) else None
