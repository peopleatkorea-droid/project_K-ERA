from __future__ import annotations

from pathlib import Path
from typing import Any


def _deps():
    from kera_research.services import data_plane as dp

    return dp


def raw_inventory_index(
    store: Any,
    *,
    raw_inventory_image_extensions: set[str],
) -> dict[str, Any]:
    if not store.raw_dir.exists():
        return {
            "patient_ids": set(),
            "visit_keys": set(),
            "n_images": 0,
        }

    patient_ids: set[str] = set()
    visit_keys: set[tuple[str, str]] = set()
    image_count = 0
    raw_root = store.raw_dir.resolve()

    for image_path in raw_root.rglob("*"):
        if (
            not image_path.is_file()
            or image_path.suffix.lower() not in raw_inventory_image_extensions
        ):
            continue
        try:
            relative_parts = image_path.resolve().relative_to(raw_root).parts
        except ValueError:
            continue
        if len(relative_parts) < 2:
            continue
        patient_id = str(relative_parts[0] or "").strip()
        if not patient_id:
            continue
        patient_ids.add(patient_id)
        if len(relative_parts) >= 3:
            visit_label = str(relative_parts[1] or "").strip()
            if visit_label:
                visit_keys.add((patient_id, visit_label))
        image_count += 1

    return {
        "patient_ids": patient_ids,
        "visit_keys": visit_keys,
        "n_images": int(image_count),
    }


def site_summary_stats(
    store: Any,
    *,
    placeholder_sync_source: str,
    raw_inventory_image_extensions: set[str],
) -> dict[str, int]:
    dp = _deps()
    store._repair_missing_image_paths_if_due(force=True)
    store._sync_raw_inventory_metadata_if_due()
    normalized_culture_category = dp.func.lower(
        dp.func.trim(dp.func.coalesce(dp.db_visits.c.culture_category, ""))
    )
    patient_count_query = (
        dp.select(dp.func.count())
        .select_from(dp.db_patients)
        .where(dp.db_patients.c.site_id == store.site_id)
    )
    patient_ids_query = dp.select(dp.db_patients.c.patient_id).where(
        dp.db_patients.c.site_id == store.site_id
    )
    image_count_query = (
        dp.select(dp.func.count())
        .select_from(dp.db_images)
        .where(dp.db_images.c.site_id == store.site_id)
    )
    visit_keys_query = dp.select(
        dp.db_visits.c.patient_id,
        dp.db_visits.c.visit_date,
    ).where(dp.db_visits.c.site_id == store.site_id)
    visit_summary_query = (
        dp.select(
            dp.func.count(dp.db_visits.c.visit_id).label("n_visits"),
            dp.func.sum(
                dp.case(
                    (
                        dp.or_(
                            dp.db_visits.c.visit_status == "active",
                            dp.and_(
                                dp.db_visits.c.visit_status.is_(None),
                                dp.db_visits.c.active_stage == True,
                            ),
                        ),
                        1,
                    ),
                    else_=0,
                )
            ).label("n_active_visits"),
            dp.func.sum(
                dp.case(
                    (dp.db_visits.c.research_registry_status == "included", 1),
                    else_=0,
                )
            ).label("n_included_visits"),
            dp.func.sum(
                dp.case(
                    (dp.db_visits.c.research_registry_status == "excluded", 1),
                    else_=0,
                )
            ).label("n_excluded_visits"),
            dp.func.sum(
                dp.case(
                    (
                        dp.and_(
                            normalized_culture_category == "fungal",
                            dp.or_(
                                dp.db_visits.c.culture_status == "positive",
                                dp.db_visits.c.research_registry_source
                                != placeholder_sync_source,
                            ),
                        ),
                        1,
                    ),
                    else_=0,
                )
            ).label("n_fungal_visits"),
            dp.func.sum(
                dp.case(
                    (
                        dp.and_(
                            normalized_culture_category == "bacterial",
                            dp.or_(
                                dp.db_visits.c.culture_status == "positive",
                                dp.db_visits.c.research_registry_source
                                != placeholder_sync_source,
                            ),
                        ),
                        1,
                    ),
                    else_=0,
                )
            ).label("n_bacterial_visits"),
        )
        .where(dp.db_visits.c.site_id == store.site_id)
    )

    with dp.DATA_PLANE_ENGINE.begin() as conn:
        patient_count = conn.execute(patient_count_query).scalar() or 0
        indexed_patient_ids = {
            str(row[0] or "").strip()
            for row in conn.execute(patient_ids_query).all()
            if str(row[0] or "").strip()
        }
        image_count = conn.execute(image_count_query).scalar() or 0
        indexed_visit_keys = {
            (str(row[0] or "").strip(), str(row[1] or "").strip())
            for row in conn.execute(visit_keys_query).all()
            if str(row[0] or "").strip() and str(row[1] or "").strip()
        }
        visit_summary = conn.execute(visit_summary_query).mappings().first() or {}

    raw_inventory = raw_inventory_index(
        store,
        raw_inventory_image_extensions=raw_inventory_image_extensions,
    )
    indexed_patient_ids.update(raw_inventory["patient_ids"])
    indexed_visit_keys.update(raw_inventory["visit_keys"])
    return {
        "n_patients": len(indexed_patient_ids) or int(patient_count or 0),
        "n_visits": len(indexed_visit_keys)
        or int(visit_summary.get("n_visits") or 0),
        "n_images": max(
            int(image_count or 0),
            int(raw_inventory["n_images"] or 0),
        ),
        "n_active_visits": int(visit_summary.get("n_active_visits") or 0),
        "n_included_visits": int(visit_summary.get("n_included_visits") or 0),
        "n_excluded_visits": int(visit_summary.get("n_excluded_visits") or 0),
        "n_fungal_visits": int(visit_summary.get("n_fungal_visits") or 0),
        "n_bacterial_visits": int(
            visit_summary.get("n_bacterial_visits") or 0
        ),
    }
