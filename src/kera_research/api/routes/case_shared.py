from __future__ import annotations

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


def private_json_response(payload: Any, *, max_age: int = 15) -> JSONResponse:
    return JSONResponse(
        content=payload,
        headers={
            "Cache-Control": f"private, max-age={max_age}, stale-while-revalidate={max_age}",
            "Vary": "Authorization",
        },
    )


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

    def run_backfill() -> None:
        try:
            site_store.backfill_image_derivatives(requested_ids)
        except Exception:
            return

    threading.Thread(target=run_backfill, daemon=True).start()


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
