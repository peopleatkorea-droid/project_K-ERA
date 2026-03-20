from __future__ import annotations

import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from kera_research.domain import utc_now
from kera_research.services.artifacts import CORNEA_CROP_STYLE
from kera_research.services.pipeline import ResearchWorkflowService
from kera_research.services.pipeline_case_support import crop_metadata_dir, load_cached_crop, load_stored_lesion_crop

ArtifactScope = Literal["patient", "visit", "image"]
ArtifactStatusKey = Literal["missing_lesion_box", "missing_roi", "missing_lesion_crop", "medsam_backfill_ready"]

MEDSAM_BACKFILL_JOB_TYPE = "medsam_artifact_backfill"


def _case_key(record: dict[str, Any]) -> tuple[str, str]:
    return (str(record.get("patient_id") or ""), str(record.get("visit_date") or ""))


def _matches_case_scope(record: dict[str, Any], allowed_case_keys: set[tuple[str, str]] | None) -> bool:
    if allowed_case_keys is None:
        return True
    return _case_key(record) in allowed_case_keys


def image_missing_lesion_box(record: dict[str, Any]) -> bool:
    return not bool(record.get("has_lesion_box"))


def image_missing_roi(record: dict[str, Any]) -> bool:
    return not bool(record.get("has_roi_crop")) or not bool(record.get("has_medsam_mask"))


def image_missing_lesion_artifacts(record: dict[str, Any]) -> bool:
    return bool(record.get("has_lesion_box")) and (not bool(record.get("has_lesion_crop")) or not bool(record.get("has_lesion_mask")))


def image_ready_for_medsam_backfill(record: dict[str, Any]) -> bool:
    return image_missing_roi(record) or image_missing_lesion_artifacts(record)


def image_matches_status(record: dict[str, Any], status: ArtifactStatusKey) -> bool:
    if status == "missing_lesion_box":
        return image_missing_lesion_box(record)
    if status == "missing_roi":
        return image_missing_roi(record)
    if status == "missing_lesion_crop":
        return image_missing_lesion_artifacts(record)
    return image_ready_for_medsam_backfill(record)


def artifact_status_labels() -> list[str]:
    return ["missing_lesion_box", "missing_roi", "missing_lesion_crop", "medsam_backfill_ready"]


def compute_image_artifact_flags(
    workflow: ResearchWorkflowService,
    site_store: Any,
    image_record: dict[str, Any],
) -> dict[str, Any]:
    image_path = str(image_record.get("image_path") or "").strip()
    has_lesion_box = isinstance(image_record.get("lesion_prompt_box"), dict)
    roi = None
    lesion = None
    if image_path:
        artifact_name = Path(image_path).stem
        roi = load_cached_crop(
            metadata_path=crop_metadata_dir(site_store, "roi") / f"{artifact_name}.json",
            mask_path=site_store.medsam_mask_dir / f"{artifact_name}_mask.png",
            crop_path=site_store.roi_crop_dir / f"{artifact_name}_crop.png",
            expected_backend=workflow.medsam_service.backend,
            expected_crop_style=CORNEA_CROP_STYLE,
        )
        lesion = load_stored_lesion_crop(
            site_store,
            image_record,
            expected_backend=workflow.medsam_service.backend,
        )
    return {
        "has_lesion_box": has_lesion_box,
        "has_roi_crop": bool(roi and roi.get("roi_crop_path")),
        "has_medsam_mask": bool(roi and roi.get("medsam_mask_path")),
        "has_lesion_crop": bool(lesion and lesion.get("lesion_crop_path")),
        "has_lesion_mask": bool(lesion and lesion.get("lesion_mask_path")),
        "artifact_status_updated_at": utc_now(),
    }


def sync_image_artifact_cache(
    workflow: ResearchWorkflowService,
    site_store: Any,
    image_record: dict[str, Any],
) -> dict[str, Any]:
    image_id = str(image_record.get("image_id") or "").strip()
    if not image_id:
        return {**image_record}
    flags = compute_image_artifact_flags(workflow, site_store, image_record)
    updated = site_store.update_image_artifact_cache(
        image_id,
        has_lesion_box=flags["has_lesion_box"],
        has_roi_crop=flags["has_roi_crop"],
        has_medsam_mask=flags["has_medsam_mask"],
        has_lesion_crop=flags["has_lesion_crop"],
        has_lesion_mask=flags["has_lesion_mask"],
    )
    return updated


def sync_site_artifact_cache(
    workflow: ResearchWorkflowService,
    site_store: Any,
    *,
    allowed_case_keys: set[tuple[str, str]] | None = None,
) -> list[dict[str, Any]]:
    synced: list[dict[str, Any]] = []
    for image_record in site_store.list_images():
        if not _matches_case_scope(image_record, allowed_case_keys):
            continue
        synced.append(sync_image_artifact_cache(workflow, site_store, image_record))
    return synced


def _scope_counts(images: list[dict[str, Any]], status: ArtifactStatusKey) -> dict[str, int]:
    matching = [record for record in images if image_matches_status(record, status)]
    return {
        "patients": len({str(record.get("patient_id") or "") for record in matching}),
        "visits": len({_case_key(record) for record in matching}),
        "images": len(matching),
    }


def _case_summary_maps(case_summaries: list[dict[str, Any]]) -> tuple[dict[tuple[str, str], dict[str, Any]], dict[str, dict[str, Any]]]:
    by_case: dict[tuple[str, str], dict[str, Any]] = {}
    by_patient: dict[str, dict[str, Any]] = {}
    for summary in case_summaries:
        case_key = _case_key(summary)
        by_case[case_key] = summary
        patient_id = str(summary.get("patient_id") or "")
        if patient_id and patient_id not in by_patient:
            by_patient[patient_id] = summary
    return by_case, by_patient


def _sort_timestamp(case_summary: dict[str, Any] | None) -> str:
    if not isinstance(case_summary, dict):
        return ""
    return str(case_summary.get("latest_image_uploaded_at") or case_summary.get("created_at") or "")


def build_artifact_status_summary(
    site_store: Any,
    *,
    case_summaries: list[dict[str, Any]],
    images: list[dict[str, Any]],
    active_job: dict[str, Any] | None,
) -> dict[str, Any]:
    return {
        "site_id": site_store.site_id,
        "total": {
            "patients": len({str(summary.get("patient_id") or "") for summary in case_summaries}),
            "visits": len(case_summaries),
            "images": len(images),
        },
        "statuses": {
            status: _scope_counts(images, status) for status in artifact_status_labels()
        },
        "active_job": active_job,
        "last_synced_at": utc_now(),
    }


def build_artifact_status_items(
    *,
    case_summaries: list[dict[str, Any]],
    images: list[dict[str, Any]],
    scope: ArtifactScope,
    status: ArtifactStatusKey,
    page: int,
    page_size: int,
) -> dict[str, Any]:
    safe_page = max(1, int(page or 1))
    safe_page_size = max(1, min(int(page_size or 25), 100))
    case_map, patient_map = _case_summary_maps(case_summaries)
    matching_images = [record for record in images if image_matches_status(record, status)]

    if scope == "image":
        rows = []
        for record in matching_images:
            case_summary = case_map.get(_case_key(record))
            rows.append(
                {
                    "scope": "image",
                    "patient_id": record.get("patient_id"),
                    "visit_date": record.get("visit_date"),
                    "image_id": record.get("image_id"),
                    "view": record.get("view"),
                    "uploaded_at": record.get("uploaded_at"),
                    "is_representative": bool(record.get("is_representative")),
                    "has_lesion_box": bool(record.get("has_lesion_box")),
                    "has_roi_crop": bool(record.get("has_roi_crop")),
                    "has_medsam_mask": bool(record.get("has_medsam_mask")),
                    "has_lesion_crop": bool(record.get("has_lesion_crop")),
                    "has_lesion_mask": bool(record.get("has_lesion_mask")),
                    "case_summary": case_summary,
                }
            )
        rows.sort(
            key=lambda item: (
                not bool(item.get("is_representative")),
                str(item.get("uploaded_at") or ""),
                str(item.get("image_id") or ""),
            ),
            reverse=True,
        )
    else:
        grouped: dict[tuple[str, ...], dict[str, Any]] = {}
        for record in matching_images:
            group_key = (str(record.get("patient_id") or ""),) if scope == "patient" else _case_key(record)
            entry = grouped.setdefault(
                group_key,
                {
                    "scope": scope,
                    "patient_id": record.get("patient_id"),
                    "visit_date": record.get("visit_date") if scope == "visit" else None,
                    "image_count": 0,
                    "visit_count": 0,
                    "missing_lesion_box_count": 0,
                    "missing_roi_count": 0,
                    "missing_lesion_crop_count": 0,
                    "medsam_backfill_ready_count": 0,
                    "case_summary": case_map.get(_case_key(record)) if scope == "visit" else patient_map.get(str(record.get("patient_id") or "")),
                    "_visit_keys": set(),
                },
            )
            entry["image_count"] += 1
            entry["_visit_keys"].add(_case_key(record))
            if image_missing_lesion_box(record):
                entry["missing_lesion_box_count"] += 1
            if image_missing_roi(record):
                entry["missing_roi_count"] += 1
            if image_missing_lesion_artifacts(record):
                entry["missing_lesion_crop_count"] += 1
            if image_ready_for_medsam_backfill(record):
                entry["medsam_backfill_ready_count"] += 1
        rows = []
        for entry in grouped.values():
            entry["visit_count"] = len(entry.pop("_visit_keys"))
            rows.append(entry)
        rows.sort(
            key=lambda item: (
                int(item.get("medsam_backfill_ready_count") or 0),
                int(item.get("missing_lesion_box_count") or 0),
                _sort_timestamp(item.get("case_summary")),
                str(item.get("patient_id") or ""),
            ),
            reverse=True,
        )

    total_count = len(rows)
    total_pages = max(1, (total_count + safe_page_size - 1) // safe_page_size) if total_count else 1
    safe_page = min(safe_page, total_pages)
    start = (safe_page - 1) * safe_page_size
    end = start + safe_page_size
    return {
        "scope": scope,
        "status": status,
        "items": rows[start:end],
        "page": safe_page,
        "page_size": safe_page_size,
        "total_count": total_count,
        "total_pages": total_pages,
    }


_STALE_JOB_MINUTES = 10


def _job_is_stale(job: dict[str, Any]) -> bool:
    heartbeat = str(job.get("heartbeat_at") or job.get("updated_at") or "").strip()
    if not heartbeat:
        return True
    try:
        dt = datetime.fromisoformat(heartbeat)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        elapsed_minutes = (datetime.now(timezone.utc) - dt).total_seconds() / 60
        return elapsed_minutes > _STALE_JOB_MINUTES
    except Exception:
        return True


def latest_medsam_backfill_job(site_store: Any) -> dict[str, Any] | None:
    jobs = [job for job in site_store.list_jobs() if job.get("job_type") == MEDSAM_BACKFILL_JOB_TYPE]
    if not jobs:
        return None
    active = next((job for job in jobs if job.get("status") in {"queued", "running"}), None)
    return active or jobs[0]


def queue_medsam_artifact_backfill(
    cp: Any,
    site_store: Any,
    *,
    created_by_user_id: str | None = None,
    refresh_cache: bool = True,
    trigger: str = "manual",
) -> dict[str, Any]:
    active_job = latest_medsam_backfill_job(site_store)
    if active_job is not None and active_job.get("status") in {"queued", "running"}:
        if not _job_is_stale(active_job):
            return active_job
        # Stale job: thread died without completing — mark as failed and allow a fresh run
        site_store.update_job_status(
            active_job["job_id"],
            "failed",
            {
                "progress": {
                    "stage": "failed",
                    "message": "Job timed out (no heartbeat). A new backfill will be started.",
                    "percent": int((active_job.get("result") or {}).get("progress", {}).get("percent") or 0),
                }
            },
        )

    workflow = ResearchWorkflowService(cp)
    case_summaries = site_store.list_case_summaries(created_by_user_id=created_by_user_id)
    allowed_case_keys = {_case_key(summary) for summary in case_summaries}
    if refresh_cache:
        images = sync_site_artifact_cache(workflow, site_store, allowed_case_keys=allowed_case_keys)
    else:
        images = [record for record in site_store.list_images() if _matches_case_scope(record, allowed_case_keys)]
    candidates = [record for record in images if image_ready_for_medsam_backfill(record)]
    job = site_store.enqueue_job(
        MEDSAM_BACKFILL_JOB_TYPE,
        {
            "trigger": trigger,
            "created_by_user_id": created_by_user_id,
            "refresh_cache": bool(refresh_cache),
            "total_images": len(candidates),
        },
    )
    site_store.update_job_status(
        job["job_id"],
        "running",
        {
            "progress": {
                "stage": "queued",
                "message": "MedSAM artifact backfill queued.",
                "percent": 0,
                "completed_images": 0,
                "total_images": len(candidates),
                "roi_completed": 0,
                "lesion_completed": 0,
                "failed_images": 0,
                "skipped_images": 0,
            }
        },
    )

    def run_backfill_job() -> None:
        roi_completed = 0
        lesion_completed = 0
        failed_images = 0
        skipped_images = 0
        failed_image_ids: list[str] = []
        total_images = len(candidates)
        for index, record in enumerate(candidates, start=1):
            image_id = str(record.get("image_id") or "")
            try:
                if image_missing_roi(record):
                    workflow._ensure_roi_crop(site_store, str(record.get("image_path") or ""))
                    roi_completed += 1
                if image_missing_lesion_artifacts(record):
                    workflow._ensure_lesion_crop(site_store, record)
                    lesion_completed += 1
                refreshed_record = site_store.get_image(image_id) or record
                sync_image_artifact_cache(workflow, site_store, refreshed_record)
            except Exception:
                failed_images += 1
                if image_id and len(failed_image_ids) < 25:
                    failed_image_ids.append(image_id)
            percent = 100 if total_images <= 0 else int((index / total_images) * 100)
            site_store.update_job_status(
                job["job_id"],
                "running",
                {
                    "progress": {
                        "stage": "running",
                        "message": "MedSAM artifact backfill in progress.",
                        "percent": percent,
                        "completed_images": index,
                        "total_images": total_images,
                        "roi_completed": roi_completed,
                        "lesion_completed": lesion_completed,
                        "failed_images": failed_images,
                        "skipped_images": skipped_images,
                    }
                },
            )
        site_store.update_job_status(
            job["job_id"],
            "completed",
            {
                "progress": {
                    "stage": "completed",
                    "message": "MedSAM artifact backfill completed.",
                    "percent": 100,
                    "completed_images": total_images,
                    "total_images": total_images,
                    "roi_completed": roi_completed,
                    "lesion_completed": lesion_completed,
                    "failed_images": failed_images,
                    "skipped_images": skipped_images,
                },
                "response": {
                    "trigger": trigger,
                    "created_by_user_id": created_by_user_id,
                    "total_images": total_images,
                    "roi_completed": roi_completed,
                    "lesion_completed": lesion_completed,
                    "failed_images": failed_images,
                    "skipped_images": skipped_images,
                    "failed_image_ids": failed_image_ids,
                },
            },
        )

    threading.Thread(target=run_backfill_job, daemon=True).start()
    return site_store.get_job(job["job_id"]) or job
