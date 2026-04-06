from __future__ import annotations

from pathlib import Path
from typing import Any


def _deps():
    from kera_research.services import data_plane as dp

    return dp


def job_row_to_dict(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "job_id": row["job_id"],
        "site_id": row["site_id"],
        "job_type": row["job_type"],
        "queue_name": row.get("queue_name", "default"),
        "priority": int(row.get("priority") or 100),
        "status": row["status"],
        "attempt_count": int(row.get("attempt_count") or 0),
        "max_attempts": int(row.get("max_attempts") or 1),
        "claimed_by": row.get("claimed_by"),
        "claimed_at": row.get("claimed_at"),
        "heartbeat_at": row.get("heartbeat_at"),
        "available_at": row.get("available_at"),
        "started_at": row.get("started_at"),
        "finished_at": row.get("finished_at"),
        "payload": row["payload_json"],
        "result": row["result_json"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def enqueue_job(
    store: Any,
    job_type: str,
    payload: dict[str, Any],
    *,
    queue_name: str = "default",
    priority: int = 100,
    max_attempts: int = 1,
    available_at: str | None = None,
) -> dict[str, Any]:
    dp = _deps()
    created_at = dp.utc_now()
    record = {
        "job_id": dp.make_id("job"),
        "site_id": store.site_id,
        "job_type": job_type,
        "status": "queued",
        "queue_name": queue_name,
        "priority": int(priority),
        "attempt_count": 0,
        "max_attempts": max(1, int(max_attempts)),
        "claimed_by": None,
        "claimed_at": None,
        "heartbeat_at": None,
        "available_at": available_at or created_at,
        "started_at": None,
        "finished_at": None,
        "payload_json": payload,
        "result_json": None,
        "created_at": created_at,
        "updated_at": None,
    }
    with dp.DATA_PLANE_ENGINE.begin() as conn:
        conn.execute(dp.site_jobs.insert().values(**record))
    return job_row_to_dict(record)


def list_jobs(store: Any, status: str | None = None) -> list[dict[str, Any]]:
    dp = _deps()
    query = dp.select(dp.site_jobs).where(dp.site_jobs.c.site_id == store.site_id).order_by(dp.site_jobs.c.created_at.desc())
    if status:
        query = query.where(dp.site_jobs.c.status == status)
    with dp.DATA_PLANE_ENGINE.begin() as conn:
        rows = conn.execute(query).mappings().all()
    return [job_row_to_dict(row) for row in rows]


def get_job(store: Any, job_id: str) -> dict[str, Any] | None:
    dp = _deps()
    with dp.DATA_PLANE_ENGINE.begin() as conn:
        row = conn.execute(
            dp.select(dp.site_jobs).where(dp.and_(dp.site_jobs.c.site_id == store.site_id, dp.site_jobs.c.job_id == job_id))
        ).mappings().first()
    if row is None:
        return None
    return job_row_to_dict(row)


def delete_jobs(store: Any, *, job_type: str | None = None) -> int:
    dp = _deps()
    query = dp.delete(dp.site_jobs).where(dp.site_jobs.c.site_id == store.site_id)
    normalized_job_type = str(job_type or "").strip()
    if normalized_job_type:
        query = query.where(dp.site_jobs.c.job_type == normalized_job_type)
    with dp.DATA_PLANE_ENGINE.begin() as conn:
        result = conn.execute(query)
    return int(result.rowcount or 0)


def request_job_cancel(store: Any, job_id: str) -> dict[str, Any] | None:
    dp = _deps()
    with dp.DATA_PLANE_ENGINE.begin() as conn:
        existing = conn.execute(
            dp.select(dp.site_jobs).where(dp.and_(dp.site_jobs.c.site_id == store.site_id, dp.site_jobs.c.job_id == job_id))
        ).mappings().first()
        if existing is None:
            return None

        current_status = str(existing.get("status") or "").strip().lower()
        if current_status in {"completed", "failed", "cancelled"}:
            return job_row_to_dict(existing)

        result_json = dict(existing.get("result_json") or {})
        progress = dict(result_json.get("progress") or {})
        now = dp.utc_now()

        if current_status == "queued":
            next_status = "cancelled"
            progress = {
                **progress,
                "stage": "cancelled",
                "message": "Job cancelled before execution.",
                "percent": int(progress.get("percent", 0) or 0),
            }
            values: dict[str, Any] = {
                "status": next_status,
                "result_json": {**result_json, "progress": progress},
                "finished_at": now,
                "updated_at": now,
            }
        else:
            next_status = "cancelling"
            progress = {
                **progress,
                "stage": "cancelling",
                "message": "Cancellation requested. Waiting for the worker to stop safely.",
                "percent": int(progress.get("percent", 0) or 0),
            }
            values = {
                "status": next_status,
                "result_json": {**result_json, "progress": progress},
                "updated_at": now,
            }
        conn.execute(
            dp.update(dp.site_jobs)
            .where(dp.and_(dp.site_jobs.c.site_id == store.site_id, dp.site_jobs.c.job_id == job_id))
            .values(**values)
        )
        row = conn.execute(
            dp.select(dp.site_jobs).where(dp.and_(dp.site_jobs.c.site_id == store.site_id, dp.site_jobs.c.job_id == job_id))
        ).mappings().first()
    return job_row_to_dict(row) if row is not None else None


def update_job_status(store: Any, job_id: str, status: str, result: dict[str, Any] | None = None) -> None:
    dp = _deps()
    with dp.DATA_PLANE_ENGINE.begin() as conn:
        existing = conn.execute(
            dp.select(dp.site_jobs).where(dp.and_(dp.site_jobs.c.site_id == store.site_id, dp.site_jobs.c.job_id == job_id))
        ).mappings().first()
        if existing is None:
            return
        result_json = result if result is not None else existing["result_json"]
        values: dict[str, Any] = {
            "status": status,
            "result_json": result_json,
            "updated_at": dp.utc_now(),
        }
        if status == "running":
            values["heartbeat_at"] = values["updated_at"]
            values["started_at"] = existing.get("started_at") or values["updated_at"]
        if status in {"completed", "failed", "cancelled"}:
            values["finished_at"] = values["updated_at"]
        conn.execute(
            dp.update(dp.site_jobs)
            .where(dp.and_(dp.site_jobs.c.site_id == store.site_id, dp.site_jobs.c.job_id == job_id))
            .values(**values)
        )


def claim_next_job(
    worker_id: str,
    *,
    queue_names: list[str] | None = None,
    site_id: str | None = None,
) -> dict[str, Any] | None:
    dp = _deps()
    dp.init_data_plane_db()
    now = dp.utc_now()
    with dp.DATA_PLANE_ENGINE.begin() as conn:
        query = dp.select(dp.site_jobs).where(
            dp.and_(
                dp.site_jobs.c.status == "queued",
                dp.or_(dp.site_jobs.c.available_at.is_(None), dp.site_jobs.c.available_at <= now),
            )
        )
        if queue_names:
            query = query.where(dp.site_jobs.c.queue_name.in_(queue_names))
        if site_id:
            query = query.where(dp.site_jobs.c.site_id == site_id)
        query = query.order_by(dp.site_jobs.c.priority.asc(), dp.site_jobs.c.created_at.asc())
        candidates = conn.execute(query.limit(20)).mappings().all()
        for candidate in candidates:
            updated = conn.execute(
                dp.update(dp.site_jobs)
                .where(dp.and_(dp.site_jobs.c.job_id == candidate["job_id"], dp.site_jobs.c.status == "queued"))
                .values(
                    status="running",
                    attempt_count=int(candidate.get("attempt_count") or 0) + 1,
                    claimed_by=worker_id,
                    claimed_at=now,
                    heartbeat_at=now,
                    started_at=candidate.get("started_at") or now,
                    updated_at=now,
                )
            )
            if int(updated.rowcount or 0) <= 0:
                continue
            row = conn.execute(dp.select(dp.site_jobs).where(dp.site_jobs.c.job_id == candidate["job_id"])).mappings().first()
            if row is not None:
                return job_row_to_dict(row)
    return None


def heartbeat_job(job_id: str, worker_id: str) -> None:
    dp = _deps()
    dp.init_data_plane_db()
    with dp.DATA_PLANE_ENGINE.begin() as conn:
        conn.execute(
            dp.update(dp.site_jobs)
            .where(
                dp.and_(
                    dp.site_jobs.c.job_id == job_id,
                    dp.site_jobs.c.status == "running",
                    dp.site_jobs.c.claimed_by == worker_id,
                )
            )
            .values(
                heartbeat_at=dp.utc_now(),
                updated_at=dp.utc_now(),
            )
        )


def requeue_stale_jobs(*, heartbeat_before: str) -> int:
    dp = _deps()
    dp.init_data_plane_db()
    with dp.DATA_PLANE_ENGINE.begin() as conn:
        rows = conn.execute(
            dp.select(dp.site_jobs).where(
                dp.and_(
                    dp.site_jobs.c.status == "running",
                    dp.site_jobs.c.heartbeat_at.is_not(None),
                    dp.site_jobs.c.heartbeat_at < heartbeat_before,
                )
            )
        ).mappings().all()
        requeued = 0
        for row in rows:
            attempt_count = int(row.get("attempt_count") or 0)
            max_attempts = int(row.get("max_attempts") or 1)
            if attempt_count < max_attempts:
                conn.execute(
                    dp.update(dp.site_jobs)
                    .where(dp.site_jobs.c.job_id == row["job_id"])
                    .values(
                        status="queued",
                        claimed_by=None,
                        claimed_at=None,
                        heartbeat_at=None,
                        available_at=dp.utc_now(),
                        updated_at=dp.utc_now(),
                    )
                )
            else:
                failure_result = dict(row.get("result_json") or {})
                failure_result.setdefault("error", "Job lease expired.")
                conn.execute(
                    dp.update(dp.site_jobs)
                    .where(dp.site_jobs.c.job_id == row["job_id"])
                    .values(
                        status="failed",
                        result_json=failure_result,
                        finished_at=dp.utc_now(),
                        updated_at=dp.utc_now(),
                    )
                )
            requeued += 1
    return requeued


def artifact_files(store: Any, artifact_type: str) -> list[Path]:
    mapping = {
        "gradcam": store.gradcam_dir,
        "medsam_mask": store.medsam_mask_dir,
        "roi_crop": store.roi_crop_dir,
        "lesion_mask": store.lesion_mask_dir,
        "lesion_crop": store.lesion_crop_dir,
    }
    directory = mapping[artifact_type]
    return sorted(directory.glob("*"))
