from __future__ import annotations

from pathlib import Path
from typing import Any

from kera_research.services.data_plane_helpers import FileUploadValidator


def _deps():
    from kera_research.services import data_plane as dp

    return dp


def list_images(store: Any) -> list[dict[str, Any]]:
    dp = _deps()
    store._sync_raw_inventory_metadata_if_due()
    query = (
        dp.select(dp.db_images)
        .where(dp.and_(dp.db_images.c.site_id == store.site_id, dp._image_visible_clause(dp.db_images)))
        .order_by(dp.db_images.c.patient_id, dp.db_images.c.visit_date, dp.db_images.c.uploaded_at)
    )
    with dp.DATA_PLANE_ENGINE.begin() as conn:
        rows = conn.execute(query).mappings().all()
    return [store._resolve_image_record_path(dict(row)) for row in rows]


def get_image(store: Any, image_id: str) -> dict[str, Any] | None:
    dp = _deps()
    store._sync_raw_inventory_metadata_if_due()
    query = dp.select(dp.db_images).where(
        dp.and_(
            dp.db_images.c.site_id == store.site_id,
            dp.db_images.c.image_id == image_id,
            dp._image_visible_clause(dp.db_images),
        )
    )
    with dp.DATA_PLANE_ENGINE.begin() as conn:
        row = conn.execute(query).mappings().first()
    return store._resolve_image_record_path(dict(row)) if row else None


def get_images(store: Any, image_ids: list[str]) -> list[dict[str, Any]]:
    dp = _deps()
    store._sync_raw_inventory_metadata_if_due()
    requested_ids = [str(image_id or "").strip() for image_id in image_ids if str(image_id or "").strip()]
    if not requested_ids:
        return []
    query = dp.select(dp.db_images).where(
        dp.and_(
            dp.db_images.c.site_id == store.site_id,
            dp.db_images.c.image_id.in_(requested_ids),
            dp._image_visible_clause(dp.db_images),
        )
    )
    with dp.DATA_PLANE_ENGINE.begin() as conn:
        rows = conn.execute(query).mappings().all()
    records_by_id = {
        str(record.get("image_id") or ""): store._resolve_image_record_path(dict(record))
        for record in rows
    }
    return [records_by_id[image_id] for image_id in requested_ids if image_id in records_by_id]


def add_image(
    store: Any,
    patient_id: str,
    visit_date: str,
    view: str,
    is_representative: bool,
    file_name: str,
    content: bytes,
    created_by_user_id: str | None = None,
) -> dict[str, Any]:
    dp = _deps()
    upload_validator = FileUploadValidator()
    normalized_patient_id = dp.normalize_patient_pseudonym(patient_id)
    normalized_visit_date = dp.normalize_visit_label(visit_date)
    visit = store.get_visit(normalized_patient_id, normalized_visit_date)
    if visit is None:
        raise ValueError("Visit must exist before image upload.")
    visit_dir = dp.ensure_dir(store.raw_dir / normalized_patient_id / normalized_visit_date)
    image_id = dp.make_id("image")
    validated_upload = upload_validator.validate_image_upload(content=content, file_name=file_name)
    normalized_suffix = validated_upload.normalized_suffix
    destination = visit_dir / f"{image_id}{normalized_suffix}"
    destination.write_bytes(validated_upload.sanitized_content)
    image_record = {
        "image_id": image_id,
        "visit_id": visit["visit_id"],
        "site_id": store.site_id,
        "patient_id": normalized_patient_id,
        "visit_date": normalized_visit_date,
        "created_by_user_id": created_by_user_id,
        "view": view,
        "image_path": str(destination),
        "is_representative": bool(is_representative),
        "lesion_prompt_box": None,
        "has_lesion_box": False,
        "has_roi_crop": False,
        "has_medsam_mask": False,
        "has_lesion_crop": False,
        "has_lesion_mask": False,
        "quality_scores": None,
        "artifact_status_updated_at": dp.utc_now(),
        "uploaded_at": dp.utc_now(),
    }
    with dp.DATA_PLANE_ENGINE.begin() as conn:
        conn.execute(dp.db_images.insert().values(**image_record))
    return image_record


def delete_images_for_visit(store: Any, patient_id: str, visit_date: str) -> int:
    dp = _deps()
    existing_visit = store.get_visit(patient_id, visit_date)
    if existing_visit is None:
        return 0
    existing_images = store.list_images_for_visit(
        dp._coerce_optional_text(existing_visit.get("patient_id")),
        dp._coerce_optional_text(existing_visit.get("visit_date")),
    )
    if store._is_visit_fl_retained(existing_visit):
        deleted_at = dp.utc_now()
        with dp.DATA_PLANE_ENGINE.begin() as conn:
            for image in existing_images:
                image_id = str(image.get("image_id") or "").strip()
                if image_id:
                    store.delete_image_preview_cache(image_id)
            conn.execute(
                dp.update(dp.db_images)
                .where(
                    dp.and_(
                        dp.db_images.c.site_id == store.site_id,
                        dp.db_images.c.visit_id == existing_visit["visit_id"],
                        dp._image_visible_clause(dp.db_images),
                    )
                )
                .values(
                    soft_deleted_at=deleted_at,
                    soft_delete_reason="federated_retention_soft_delete",
                )
            )
        return len(existing_images)
    for image in existing_images:
        image_id = str(image.get("image_id") or "").strip()
        if image_id:
            store.delete_image_preview_cache(image_id)
        image_path = Path(str(image.get("image_path") or ""))
        if image_path.exists():
            image_path.unlink(missing_ok=True)
    with dp.DATA_PLANE_ENGINE.begin() as conn:
        conn.execute(
            dp.delete(dp.db_images).where(
                dp.and_(
                    dp.db_images.c.site_id == store.site_id,
                    dp.db_images.c.visit_id == existing_visit["visit_id"],
                )
            )
        )
    return len(existing_images)


def update_representative_flags(store: Any, updates: dict[str, bool]) -> None:
    dp = _deps()
    with dp.DATA_PLANE_ENGINE.begin() as conn:
        for image_id, is_representative in updates.items():
            conn.execute(
                dp.update(dp.db_images)
                .where(dp.and_(dp.db_images.c.site_id == store.site_id, dp.db_images.c.image_id == image_id))
                .values(is_representative=bool(is_representative))
            )


def update_lesion_prompt_box(
    store: Any,
    image_id: str,
    lesion_prompt_box: dict[str, Any] | None,
) -> dict[str, Any]:
    dp = _deps()
    if store.get_image(image_id) is None:
        raise ValueError("Image not found.")
    has_lesion_box = isinstance(lesion_prompt_box, dict)
    with dp.DATA_PLANE_ENGINE.begin() as conn:
        conn.execute(
            dp.update(dp.db_images)
            .where(dp.and_(dp.db_images.c.site_id == store.site_id, dp.db_images.c.image_id == image_id))
            .values(
                lesion_prompt_box=lesion_prompt_box,
                has_lesion_box=has_lesion_box,
                has_lesion_crop=False,
                has_lesion_mask=False,
                artifact_status_updated_at=dp.utc_now(),
            )
        )
    refreshed = store.get_image(image_id)
    if refreshed is None:
        raise ValueError("Image not found.")
    return refreshed


def update_image_artifact_cache(
    store: Any,
    image_id: str,
    *,
    has_lesion_box: bool | None = None,
    has_roi_crop: bool | None = None,
    has_medsam_mask: bool | None = None,
    has_lesion_crop: bool | None = None,
    has_lesion_mask: bool | None = None,
) -> dict[str, Any]:
    dp = _deps()
    if store.get_image(image_id) is None:
        raise ValueError("Image not found.")
    values: dict[str, Any] = {
        "artifact_status_updated_at": dp.utc_now(),
    }
    if has_lesion_box is not None:
        values["has_lesion_box"] = bool(has_lesion_box)
    if has_roi_crop is not None:
        values["has_roi_crop"] = bool(has_roi_crop)
    if has_medsam_mask is not None:
        values["has_medsam_mask"] = bool(has_medsam_mask)
    if has_lesion_crop is not None:
        values["has_lesion_crop"] = bool(has_lesion_crop)
    if has_lesion_mask is not None:
        values["has_lesion_mask"] = bool(has_lesion_mask)
    with dp.DATA_PLANE_ENGINE.begin() as conn:
        conn.execute(
            dp.update(dp.db_images)
            .where(dp.and_(dp.db_images.c.site_id == store.site_id, dp.db_images.c.image_id == image_id))
            .values(**values)
        )
    refreshed = store.get_image(image_id)
    if refreshed is None:
        raise ValueError("Image not found.")
    return refreshed


def update_image_quality_scores(
    store: Any,
    image_id: str,
    quality_scores: dict[str, Any] | None,
) -> dict[str, Any]:
    dp = _deps()
    if store.get_image(image_id) is None:
        raise ValueError("Image not found.")
    with dp.DATA_PLANE_ENGINE.begin() as conn:
        conn.execute(
            dp.update(dp.db_images)
            .where(dp.and_(dp.db_images.c.site_id == store.site_id, dp.db_images.c.image_id == image_id))
            .values(quality_scores=quality_scores)
        )
    refreshed = store.get_image(image_id)
    if refreshed is None:
        raise ValueError("Image not found.")
    return refreshed


def backfill_image_derivatives(
    store: Any,
    image_ids: list[str] | None = None,
    *,
    preview_sides: tuple[int, ...] | None = None,
) -> dict[str, int]:
    dp = _deps()
    preview_sides = preview_sides or dp._PREWARMED_IMAGE_PREVIEW_SIDES
    if image_ids:
        requested_ids = {str(image_id or "").strip() for image_id in image_ids if str(image_id or "").strip()}
        images = [record for record in store.list_images() if str(record.get("image_id") or "") in requested_ids]
    else:
        images = store.list_images()

    quality_updated = 0
    previews_generated = 0
    for image in images:
        image_id = str(image.get("image_id") or "").strip()
        image_path = str(image.get("image_path") or "").strip()
        if not image_id or not image_path:
            continue
        if image.get("quality_scores") is None:
            try:
                quality_scores = dp.score_slit_lamp_image(image_path, view=str(image.get("view") or "white"))
            except Exception:
                quality_scores = None
            store.update_image_quality_scores(image_id, quality_scores)
            quality_updated += 1
        for max_side in preview_sides:
            preview_path = store.image_preview_cache_path(image_id, max_side)
            if preview_path.exists():
                continue
            try:
                store.ensure_image_preview(image, max_side)
            except Exception:
                continue
            previews_generated += 1
    return {
        "quality_updated": quality_updated,
        "previews_generated": previews_generated,
    }


def list_images_for_visit(store: Any, patient_id: str, visit_date: str) -> list[dict[str, Any]]:
    dp = _deps()
    store._sync_raw_inventory_metadata_if_due()
    existing_visit = store.get_visit(patient_id, visit_date)
    if existing_visit is None:
        return []
    query = (
        dp.select(dp.db_images)
        .where(
            dp.and_(
                dp.db_images.c.site_id == store.site_id,
                dp.db_images.c.visit_id == existing_visit["visit_id"],
                dp._image_visible_clause(dp.db_images),
            )
        )
        .order_by(dp.db_images.c.uploaded_at)
    )
    with dp.DATA_PLANE_ENGINE.begin() as conn:
        rows = conn.execute(query).mappings().all()
    return [store._resolve_image_record_path(dict(row)) for row in rows]


def list_images_for_patient(store: Any, patient_id: str) -> list[dict[str, Any]]:
    dp = _deps()
    store._sync_raw_inventory_metadata_if_due()
    query = (
        dp.select(dp.db_images)
        .where(
            dp.and_(
                dp.db_images.c.site_id == store.site_id,
                dp.db_images.c.patient_id == patient_id,
                dp._image_visible_clause(dp.db_images),
            )
        )
        .order_by(dp.db_images.c.uploaded_at)
    )
    with dp.DATA_PLANE_ENGINE.begin() as conn:
        rows = conn.execute(query).mappings().all()
    return [store._resolve_image_record_path(dict(row)) for row in rows]
