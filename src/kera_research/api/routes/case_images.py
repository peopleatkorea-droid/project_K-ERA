import mimetypes
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import (
    APIRouter,
    Body,
    Depends,
    File,
    Form,
    Header,
    HTTPException,
    Request,
    UploadFile,
    status,
)
from pydantic import BaseModel
from fastapi.responses import FileResponse, Response

from kera_research.api.models import LesionBoxRequest, RepresentativeImageRequest
from kera_research.api.routes.case_shared import (
    ImagePreviewBatchRequest,
    MedsamArtifactBackfillRequest,
    private_json_response,
    schedule_image_derivative_backfill,
    sync_case_artifact_cache_best_effort,
    sync_image_artifact_cache_best_effort,
)
from kera_research.api.routes.workspace_visibility import workspace_visit_visible
from kera_research.services.image_artifact_status import (
    artifact_status_labels,
    build_artifact_status_items,
    build_artifact_status_summary,
    latest_medsam_backfill_job,
    queue_medsam_artifact_backfill,
    sync_site_artifact_cache,
)

logger = logging.getLogger(__name__)


def build_case_images_router(support: Any) -> APIRouter:
    router = APIRouter()

    get_control_plane = support.get_control_plane
    get_approved_user = support.get_approved_user
    require_site_access = support.require_site_access
    require_validation_permission = support.require_validation_permission
    require_visit_image_write_access = support.require_visit_image_write_access
    require_record_owner = support.require_record_owner
    image_owner_user_id = support.image_owner_user_id
    get_workflow = support.get_workflow
    get_semantic_prompt_scorer = support.get_semantic_prompt_scorer
    serialize_lesion_preview_job = support.serialize_lesion_preview_job
    queue_case_embedding_refresh = support.queue_case_embedding_refresh
    queue_ai_clinic_vector_index_rebuild = support.queue_ai_clinic_vector_index_rebuild
    queue_federated_retrieval_corpus_sync = support.queue_federated_retrieval_corpus_sync
    attach_image_quality_scores = support.attach_image_quality_scores
    make_id = support.make_id
    lesion_preview_jobs = support.lesion_preview_jobs
    lesion_preview_jobs_lock = support.lesion_preview_jobs_lock
    max_image_bytes = support.max_image_bytes
    InvalidImageUploadError = support.InvalidImageUploadError

    def _visible_workspace_case_keys(site_store: Any, patient_id: str | None = None) -> set[tuple[str, str]]:
        visits = (
            site_store.list_visits_for_patient(patient_id)
            if str(patient_id or "").strip()
            else site_store.list_visits()
        )
        return {
            (str(visit.get("patient_id") or "").strip(), str(visit.get("visit_date") or "").strip())
            for visit in visits
            if workspace_visit_visible(visit)
        }

    def _filter_visible_workspace_images(
        site_store: Any,
        images: list[dict[str, Any]],
        *,
        patient_id: str | None = None,
    ) -> list[dict[str, Any]]:
        allowed_case_keys = _visible_workspace_case_keys(site_store, patient_id=patient_id)
        return [
            image
            for image in images
            if (str(image.get("patient_id") or "").strip(), str(image.get("visit_date") or "").strip()) in allowed_case_keys
        ]

    @router.get("/api/sites/{site_id}/medsam-artifacts/status")
    def get_medsam_artifact_status(
        site_id: str,
        mine: bool = False,
        refresh: bool = False,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        site_store = require_site_access(cp, user, site_id)
        created_by_user_id = user["user_id"] if mine else None
        case_summaries = site_store.list_case_summaries(created_by_user_id=created_by_user_id)
        allowed_case_keys = {
            (str(item.get("patient_id") or ""), str(item.get("visit_date") or ""))
            for item in case_summaries
        }
        if refresh:
            workflow = get_workflow(cp)
            images = sync_site_artifact_cache(workflow, site_store, allowed_case_keys=allowed_case_keys)
        else:
            images = [
                item
                for item in site_store.list_images()
                if (str(item.get("patient_id") or ""), str(item.get("visit_date") or "")) in allowed_case_keys
            ]
        return build_artifact_status_summary(
            site_store,
            case_summaries=case_summaries,
            images=images,
            active_job=latest_medsam_backfill_job(site_store),
        )

    @router.get("/api/sites/{site_id}/medsam-artifacts/items")
    def list_medsam_artifact_items(
        site_id: str,
        scope: str = "visit",
        status_key: str = "medsam_backfill_ready",
        mine: bool = False,
        refresh: bool = False,
        page: int = 1,
        page_size: int = 25,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        normalized_scope = str(scope or "visit").strip().lower()
        if normalized_scope not in {"patient", "visit", "image"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="scope must be patient, visit, or image.")
        normalized_status = str(status_key or "medsam_backfill_ready").strip().lower()
        if normalized_status not in set(artifact_status_labels()):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"status_key must be one of: {', '.join(artifact_status_labels())}.",
            )
        if page < 1:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="page must be at least 1.")
        if page_size < 1 or page_size > 100:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="page_size must be between 1 and 100.")
        site_store = require_site_access(cp, user, site_id)
        created_by_user_id = user["user_id"] if mine else None
        case_summaries = site_store.list_case_summaries(created_by_user_id=created_by_user_id)
        allowed_case_keys = {
            (str(item.get("patient_id") or ""), str(item.get("visit_date") or ""))
            for item in case_summaries
        }
        if refresh:
            workflow = get_workflow(cp)
            images = sync_site_artifact_cache(workflow, site_store, allowed_case_keys=allowed_case_keys)
        else:
            images = [
                item
                for item in site_store.list_images()
                if (str(item.get("patient_id") or ""), str(item.get("visit_date") or "")) in allowed_case_keys
            ]
        return build_artifact_status_items(
            case_summaries=case_summaries,
            images=images,
            scope=normalized_scope,
            status=normalized_status,
            page=page,
            page_size=page_size,
        )

    @router.post("/api/sites/{site_id}/medsam-artifacts/backfill")
    def backfill_medsam_artifacts(
        site_id: str,
        payload: MedsamArtifactBackfillRequest,
        mine: bool = False,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_validation_permission(user)
        site_store = require_site_access(cp, user, site_id)
        created_by_user_id = user["user_id"] if mine else None
        job = queue_medsam_artifact_backfill(
            cp,
            site_store,
            created_by_user_id=created_by_user_id,
            refresh_cache=bool(payload.refresh_cache),
            trigger="manual",
        )
        return {
            "site_id": site_id,
            "job": job,
        }

    @router.get("/api/sites/{site_id}/images")
    def list_images(
        site_id: str,
        patient_id: str | None = None,
        visit_date: str | None = None,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> Response:
        site_store = require_site_access(cp, user, site_id)
        if patient_id and visit_date:
            payload = attach_image_quality_scores(site_store.list_images_for_visit(patient_id, visit_date))
        elif patient_id:
            payload = attach_image_quality_scores(site_store.list_images_for_patient(patient_id))
        else:
            payload = attach_image_quality_scores(site_store.list_images())
        payload = _filter_visible_workspace_images(site_store, payload, patient_id=patient_id)
        schedule_image_derivative_backfill(
            site_store,
            [str(item.get("image_id") or "").strip() for item in payload],
        )
        return private_json_response(payload, max_age=1)

    _VALID_IMAGE_VIEWS = frozenset({"white", "slit", "fluorescein"})

    @router.post("/api/sites/{site_id}/images")
    async def upload_image(
        request: Request,
        site_id: str,
        patient_id: str = Form(...),
        visit_date: str = Form(...),
        view: str = Form(...),
        is_representative: bool = Form(False),
        refresh_embeddings: bool = Form(True),
        file: UploadFile = File(...),
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        # Reject oversized requests before reading the body into memory.
        content_length_header = request.headers.get("content-length")
        if content_length_header is not None:
            try:
                if int(content_length_header) > max_image_bytes:
                    raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="File exceeds 20 MB limit.")
            except ValueError:
                pass
        normalized_view = view.strip().lower()
        if normalized_view not in _VALID_IMAGE_VIEWS:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invalid view. Allowed values: {', '.join(sorted(_VALID_IMAGE_VIEWS))}.",
            )
        site_store = require_site_access(cp, user, site_id)
        content = await file.read()
        if len(content) > max_image_bytes:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="File exceeds 20 MB limit.")
        try:
            saved_image = site_store.add_image(
                patient_id=patient_id,
                visit_date=visit_date,
                view=normalized_view,
                is_representative=is_representative,
                file_name=file.filename or "upload.bin",
                content=content,
                created_by_user_id=user["user_id"],
            )
            schedule_image_derivative_backfill(
                site_store,
                [str(saved_image.get("image_id") or "").strip()],
            )
            if refresh_embeddings:
                queue_case_embedding_refresh(
                    cp,
                    site_store,
                    patient_id=patient_id,
                    visit_date=visit_date,
                    trigger="image_upload",
                )
            queue_federated_retrieval_corpus_sync(
                cp,
                site_store,
                trigger="image_upload",
            )
            return saved_image
        except InvalidImageUploadError as exc:
            raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.delete("/api/sites/{site_id}/images")
    def delete_images(
        site_id: str,
        patient_id: str,
        visit_date: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        site_store = require_site_access(cp, user, site_id)
        require_visit_image_write_access(site_store, user, patient_id=patient_id, visit_date=visit_date)
        deleted_count = site_store.delete_images_for_visit(patient_id, visit_date)
        queue_federated_retrieval_corpus_sync(
            cp,
            site_store,
            trigger="delete_images",
        )
        queue_ai_clinic_vector_index_rebuild(
            cp,
            site_store,
            trigger="delete_images",
        )
        return {"deleted_count": deleted_count}

    @router.post("/api/sites/{site_id}/images/representative")
    def set_representative_image(
        site_id: str,
        payload: dict[str, Any] = Body(...),
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        parsed = RepresentativeImageRequest.model_validate(payload)
        site_store = require_site_access(cp, user, site_id)
        visit_images = site_store.list_images_for_visit(parsed.patient_id, parsed.visit_date)
        if not visit_images:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No images found for this visit.")
        require_visit_image_write_access(
            site_store,
            user,
            patient_id=parsed.patient_id,
            visit_date=parsed.visit_date,
        )
        if parsed.representative_image_id not in {image["image_id"] for image in visit_images}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Representative image is not part of this visit.")
        site_store.update_representative_flags(
            {
                image["image_id"]: image["image_id"] == parsed.representative_image_id
                for image in visit_images
            }
        )
        queue_case_embedding_refresh(
            cp,
            site_store,
            patient_id=parsed.patient_id,
            visit_date=parsed.visit_date,
            trigger="representative_change",
        )
        queue_federated_retrieval_corpus_sync(
            cp,
            site_store,
            trigger="representative_change",
        )
        return {
            "images": site_store.list_images_for_visit(parsed.patient_id, parsed.visit_date),
        }

    @router.post("/api/sites/{site_id}/images/previews")
    def ensure_image_previews(
        site_id: str,
        payload: ImagePreviewBatchRequest,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> Response:
        site_store = require_site_access(cp, user, site_id)
        normalized_max_side = min(max(int(payload.max_side or 512), 96), 1024)
        requested_ids: list[str] = []
        seen_ids: set[str] = set()
        for raw_image_id in payload.image_ids:
            image_id = str(raw_image_id or "").strip()
            if not image_id or image_id in seen_ids:
                continue
            requested_ids.append(image_id)
            seen_ids.add(image_id)

        if not requested_ids:
            return private_json_response(
                {
                    "max_side": normalized_max_side,
                    "requested_count": 0,
                    "ready_count": 0,
                    "items": [],
                },
                max_age=60,
            )

        images_by_id = {
            str(item.get("image_id") or "").strip(): item
            for item in site_store.get_images(requested_ids)
        }
        queued_ids: list[str] = []
        ready_count = 0
        items: list[dict[str, Any]] = []
        for image_id in requested_ids:
            preview_url = f"/api/sites/{site_id}/images/{image_id}/preview?max_side={normalized_max_side}"
            image = images_by_id.get(image_id)
            if image is None:
                items.append(
                    {
                        "image_id": image_id,
                        "max_side": normalized_max_side,
                        "ready": False,
                        "cache_status": "missing",
                        "preview_url": preview_url,
                        "error": "Image not found.",
                    }
                )
                continue

            preview_path = site_store.image_preview_cache_path(image_id, normalized_max_side)
            if preview_path.exists():
                ready_count += 1
                items.append(
                    {
                        "image_id": image_id,
                        "max_side": normalized_max_side,
                        "ready": True,
                        "cache_status": "hit",
                        "preview_url": preview_url,
                        "error": None,
                    }
                )
                continue

            queued_ids.append(image_id)
            items.append(
                {
                    "image_id": image_id,
                    "max_side": normalized_max_side,
                    "ready": False,
                    "cache_status": "queued",
                    "preview_url": preview_url,
                    "error": None,
                }
            )

        if queued_ids:
            schedule_image_derivative_backfill(site_store, queued_ids)

        return private_json_response(
            {
                "max_side": normalized_max_side,
                "requested_count": len(requested_ids),
                "ready_count": ready_count,
                "items": items,
            },
            max_age=60,
        )

    @router.patch("/api/sites/{site_id}/images/{image_id}/lesion-box")
    def update_lesion_box(
        site_id: str,
        image_id: str,
        payload: dict[str, Any] = Body(...),
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        parsed = LesionBoxRequest.model_validate(payload)
        site_store = require_site_access(cp, user, site_id)
        image = site_store.get_image(image_id)
        if image is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found.")
        require_record_owner(
            user,
            image_owner_user_id(site_store, image),
            detail="Only the creator or a site admin can modify this image.",
        )
        lesion_prompt_box = {
            "x0": min(max(float(parsed.x0), 0.0), 1.0),
            "y0": min(max(float(parsed.y0), 0.0), 1.0),
            "x1": min(max(float(parsed.x1), 0.0), 1.0),
            "y1": min(max(float(parsed.y1), 0.0), 1.0),
        }
        if lesion_prompt_box["x1"] <= lesion_prompt_box["x0"] or lesion_prompt_box["y1"] <= lesion_prompt_box["y0"]:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Lesion box coordinates are invalid.")
        try:
            updated = site_store.update_lesion_prompt_box(image_id, lesion_prompt_box)
            queue_case_embedding_refresh(
                cp,
                site_store,
                patient_id=str(updated.get("patient_id") or image.get("patient_id") or ""),
                visit_date=str(updated.get("visit_date") or image.get("visit_date") or ""),
                trigger="lesion_box_update",
            )
            queue_federated_retrieval_corpus_sync(
                cp,
                site_store,
                trigger="lesion_box_update",
            )
            return updated
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.delete("/api/sites/{site_id}/images/{image_id}/lesion-box")
    def clear_lesion_box(
        site_id: str,
        image_id: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        site_store = require_site_access(cp, user, site_id)
        image = site_store.get_image(image_id)
        if image is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found.")
        try:
            updated = site_store.update_lesion_prompt_box(image_id, None)
            queue_case_embedding_refresh(
                cp,
                site_store,
                patient_id=str(updated.get("patient_id") or image.get("patient_id") or ""),
                visit_date=str(updated.get("visit_date") or image.get("visit_date") or ""),
                trigger="lesion_box_update",
            )
            queue_federated_retrieval_corpus_sync(
                cp,
                site_store,
                trigger="lesion_box_update",
            )
            return updated
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.get("/api/sites/{site_id}/images/{image_id}/content")
    def get_image_content(
        site_id: str,
        image_id: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> FileResponse:
        site_store = require_site_access(cp, user, site_id)
        image = site_store.get_image(image_id)
        if image is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found.")
        image_path = Path(image["image_path"])
        if not image_path.exists():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image file not found on disk.")
        media_type = mimetypes.guess_type(image_path.name)[0] or "application/octet-stream"
        return FileResponse(path=image_path, media_type=media_type, filename=image_path.name)

    @router.get("/api/sites/{site_id}/images/{image_id}/preview")
    def get_image_preview(
        site_id: str,
        image_id: str,
        max_side: int = 512,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> Response:
        site_store = require_site_access(cp, user, site_id)
        normalized_max_side = min(max(int(max_side or 512), 96), 1024)
        preview_path = site_store.image_preview_cache_path(image_id, normalized_max_side)
        if preview_path.exists():
            return FileResponse(
                path=preview_path,
                media_type="image/jpeg",
                filename=preview_path.name,
                headers={"Cache-Control": "private, max-age=86400"},
        )
        image = site_store.get_image(image_id)
        if image is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found.")
        image_path = Path(str(image.get("image_path") or ""))
        if not image_path.exists():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image file not found on disk.")
        schedule_image_derivative_backfill(site_store, [image_id])
        media_type = mimetypes.guess_type(image_path.name)[0] or "application/octet-stream"
        return FileResponse(
            path=image_path,
            media_type=media_type,
            filename=image_path.name,
            headers={"Cache-Control": "private, max-age=15"},
        )

    @router.post("/api/sites/{site_id}/images/{image_id}/lesion-live-preview")
    def start_live_lesion_preview(
        site_id: str,
        image_id: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_validation_permission(user)
        site_store = require_site_access(cp, user, site_id)
        image = site_store.get_image(image_id)
        if image is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found.")
        lesion_prompt_box = image.get("lesion_prompt_box")
        if not isinstance(lesion_prompt_box, dict):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This image requires a saved lesion box.")

        workflow = get_workflow(cp)
        prompt_signature = workflow._lesion_prompt_box_signature(lesion_prompt_box)
        with lesion_preview_jobs_lock:
            for existing in reversed(list(lesion_preview_jobs.values())):
                if (
                    existing.get("site_id") == site_id
                    and existing.get("image_id") == image_id
                    and existing.get("status") == "running"
                ):
                    if prompt_signature in {
                        existing.get("prompt_signature"),
                        existing.get("pending_prompt_signature"),
                    }:
                        return serialize_lesion_preview_job(dict(existing))
                    existing["pending_prompt_signature"] = prompt_signature
                    existing["pending_lesion_prompt_box"] = dict(lesion_prompt_box)
                    existing["finished_at"] = None
                    return serialize_lesion_preview_job(dict(existing))
                if (
                    existing.get("site_id") == site_id
                    and existing.get("image_id") == image_id
                    and existing.get("prompt_signature") == prompt_signature
                    and existing.get("status") == "done"
                ):
                    return serialize_lesion_preview_job(dict(existing))
        job_id = make_id("lesionjob")
        job_record: dict[str, Any] = {
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
        with lesion_preview_jobs_lock:
            lesion_preview_jobs[job_id] = job_record

        def run_preview() -> None:
            while True:
                with lesion_preview_jobs_lock:
                    current_job = lesion_preview_jobs.get(job_id)
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
                    with lesion_preview_jobs_lock:
                        current_job = lesion_preview_jobs.get(job_id)
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
                with lesion_preview_jobs_lock:
                    current_job = lesion_preview_jobs.get(job_id)
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
                sync_image_artifact_cache_best_effort(workflow, site_store, refreshed_image)
                return

        preview_thread = threading.Thread(target=run_preview, daemon=True)
        preview_thread.start()
        preview_thread.join(timeout=0.25)

        with lesion_preview_jobs_lock:
            job_snapshot = dict(lesion_preview_jobs.get(job_id) or {})
        if not job_snapshot:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Live lesion preview job disappeared.")
        if job_snapshot.get("status") == "failed":
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(job_snapshot.get("error") or "Live lesion preview failed."),
            )
        return serialize_lesion_preview_job(job_snapshot)

    @router.get("/api/sites/{site_id}/images/{image_id}/lesion-live-preview/jobs/{job_id}")
    def get_live_lesion_preview_job(
        site_id: str,
        image_id: str,
        job_id: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_validation_permission(user)
        require_site_access(cp, user, site_id)
        with lesion_preview_jobs_lock:
            job = dict(lesion_preview_jobs.get(job_id) or {})
        if not job:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Live lesion preview job not found.")
        if job.get("site_id") != site_id or job.get("image_id") != image_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Live lesion preview job not found for this image.")
        return serialize_lesion_preview_job(job)

    @router.get("/api/sites/{site_id}/images/{image_id}/semantic-prompts")
    def score_image_semantic_prompts(
        site_id: str,
        image_id: str,
        top_k: int = 3,
        input_mode: str = "source",
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        site_store = require_site_access(cp, user, site_id)
        image = site_store.get_image(image_id)
        if image is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found.")
        try:
            normalized_input_mode = str(input_mode or "source").strip().lower()
            if normalized_input_mode not in {"source", "roi_crop", "lesion_crop"}:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown semantic prompt input mode.")
            analysis_path = str(image["image_path"])
            if normalized_input_mode != "source":
                require_validation_permission(user)
                workflow = get_workflow(cp)
                if normalized_input_mode == "roi_crop":
                    previews = workflow.preview_case_roi(site_store, image["patient_id"], image["visit_date"])
                    preview = next((item for item in previews if item.get("source_image_path") == image.get("image_path")), None)
                    if preview is None or not preview.get("roi_crop_path"):
                        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ROI crop is not available for this image.")
                    analysis_path = str(preview["roi_crop_path"])
                else:
                    previews = workflow.preview_case_lesion(site_store, image["patient_id"], image["visit_date"])
                    preview = next((item for item in previews if item.get("source_image_path") == image.get("image_path")), None)
                    if preview is None or not preview.get("lesion_crop_path"):
                        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lesion crop is not available for this image.")
                    analysis_path = str(preview["lesion_crop_path"])
                sync_case_artifact_cache_best_effort(
                    workflow,
                    site_store,
                    patient_id=str(image.get("patient_id") or ""),
                    visit_date=str(image.get("visit_date") or ""),
                )
            scorer = get_semantic_prompt_scorer()
            persistence_dir = site_store.embedding_dir / "biomedclip"
            result = scorer.score_image(
                analysis_path,
                view=str(image.get("view") or "white"),
                top_k=top_k,
                persistence_dir=persistence_dir,
            )
            return {
                "image_id": image_id,
                "view": str(image.get("view") or "white"),
                "input_mode": normalized_input_mode,
                **result,
            }
        except FileNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    class ImageTextSearchRequest(BaseModel):
        query: str
        top_k: int = 10

    @router.post("/api/sites/{site_id}/images/search/text")
    def search_images_by_text(
        site_id: str,
        body: ImageTextSearchRequest,
        authorization: str | None = Header(default=None),
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        site_store = require_site_access(cp, user, site_id)
        query = str(body.query or "").strip()
        if not query:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Query must not be empty.")
        try:
            workflow = get_workflow(cp)
            all_images = _filter_visible_workspace_images(
                site_store,
                site_store.list_images(),
            )
            persistence_dir = site_store.embedding_dir / "biomedclip"
            result = workflow.text_retriever.retrieve_images(
                query_text=query,
                image_records=all_images,
                requested_device="auto", # Changed from "cpu" to "auto" to leverage GPU if available
                top_k=max(1, min(int(body.top_k or 10), 50)),
                persistence_dir=persistence_dir,
            )
            token = (authorization or "").replace("Bearer ", "").strip()
            for item in result["results"]:
                preview_url = f"/api/sites/{site_id}/images/{item['image_id']}/preview"
                if token:
                    preview_url += f"?token={token}"
                item["preview_url"] = preview_url
                item.pop("image_path", None)
            return {"query": query, **result}
        except (RuntimeError, OSError, ValueError) as exc:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    return router
