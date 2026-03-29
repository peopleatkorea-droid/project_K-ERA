import concurrent.futures
import threading
from typing import Any

from fastapi.responses import JSONResponse
from pydantic import BaseModel

from kera_research.services.image_artifact_status import sync_image_artifact_cache


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
        except Exception:
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
