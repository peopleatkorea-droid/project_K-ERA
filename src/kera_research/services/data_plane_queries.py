from __future__ import annotations

from typing import Any


def _deps():
    from kera_research.services import data_plane as dp

    return dp


def _image_stats_subquery(dp: Any, store: Any, image_table: Any) -> Any:
    return (
        dp.select(
            image_table.c.visit_id,
            dp.func.count(image_table.c.image_id).label("image_count"),
            dp.func.max(image_table.c.uploaded_at).label("latest_image_uploaded_at"),
        )
        .where(image_table.c.site_id == store.site_id)
        .group_by(image_table.c.visit_id)
        .subquery("image_stats")
    )


def _representative_images_subquery(dp: Any, store: Any, image_table: Any) -> Any:
    return (
        dp.select(
            image_table.c.visit_id,
            image_table.c.image_id.label("representative_image_id"),
            image_table.c.view.label("representative_view"),
        )
        .where(
            dp.and_(
                image_table.c.site_id == store.site_id,
                image_table.c.is_representative == True,
            )
        )
        .subquery("representative_images")
    )


def _case_summary_record(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "case_id": f"{row['patient_id']}::{row['visit_date']}",
        "visit_id": row["visit_id"],
        "patient_id": row["patient_id"],
        "patient_reference_id": row["patient_reference_id"],
        "visit_date": row["visit_date"],
        "visit_index": row["visit_index"],
        "actual_visit_date": row["actual_visit_date"],
        "chart_alias": row["chart_alias"] or "",
        "local_case_code": row["local_case_code"] or "",
        "sex": row["sex"] or "",
        "age": row["age"],
        "culture_category": row["culture_category"] or "",
        "culture_species": row["culture_species"] or "",
        "additional_organisms": row["additional_organisms"] or [],
        "contact_lens_use": row["contact_lens_use"] or "",
        "predisposing_factor": row["predisposing_factor"] or [],
        "other_history": row["other_history"] or "",
        "visit_status": row["visit_status"] or "active",
        "active_stage": bool(row["active_stage"]) if row["active_stage"] is not None else (row["visit_status"] == "active"),
        "is_initial_visit": bool(row["is_initial_visit"]),
        "smear_result": row["smear_result"] or "",
        "polymicrobial": bool(row["polymicrobial"] or row["additional_organisms"]),
        "research_registry_status": row["research_registry_status"] or "analysis_only",
        "image_count": int(row["image_count"] or 0),
        "representative_image_id": row["representative_image_id"],
        "representative_view": row["representative_view"],
        "created_by_user_id": row["created_by_user_id"],
        "created_at": row["created_at"],
        "latest_image_uploaded_at": row["latest_image_uploaded_at"],
    }


def list_case_summaries(
    store: Any,
    created_by_user_id: str | None = None,
    patient_id: str | None = None,
) -> list[dict[str, Any]]:
    dp = _deps()
    patient_table = dp.db_patients.alias("p")
    visit_table = dp.db_visits.alias("v")
    image_table = dp.db_images.alias("i")
    normalized_patient_id = (
        dp.normalize_patient_pseudonym(patient_id)
        if str(patient_id or "").strip()
        else None
    )

    image_stats = _image_stats_subquery(dp, store, image_table)
    representative_images = _representative_images_subquery(dp, store, image_table)

    query = (
        dp.select(
            visit_table.c.visit_id,
            visit_table.c.patient_id,
            visit_table.c.patient_reference_id,
            visit_table.c.visit_date,
            visit_table.c.visit_index,
            visit_table.c.actual_visit_date,
            visit_table.c.culture_category,
            visit_table.c.culture_species,
            visit_table.c.additional_organisms,
            visit_table.c.contact_lens_use,
            visit_table.c.predisposing_factor,
            visit_table.c.other_history,
            visit_table.c.visit_status,
            visit_table.c.active_stage,
            visit_table.c.is_initial_visit,
            visit_table.c.smear_result,
            visit_table.c.polymicrobial,
            visit_table.c.research_registry_status,
            visit_table.c.research_registry_updated_at,
            visit_table.c.research_registry_updated_by,
            visit_table.c.research_registry_source,
            visit_table.c.created_at,
            patient_table.c.chart_alias,
            patient_table.c.local_case_code,
            patient_table.c.sex,
            patient_table.c.age,
            patient_table.c.created_by_user_id,
            dp.func.coalesce(image_stats.c.image_count, 0).label("image_count"),
            image_stats.c.latest_image_uploaded_at,
            representative_images.c.representative_image_id,
            representative_images.c.representative_view,
        )
        .select_from(
            visit_table
            .join(
                patient_table,
                dp.and_(
                    visit_table.c.site_id == patient_table.c.site_id,
                    visit_table.c.patient_id == patient_table.c.patient_id,
                ),
            )
            .outerjoin(image_stats, visit_table.c.visit_id == image_stats.c.visit_id)
            .outerjoin(representative_images, visit_table.c.visit_id == representative_images.c.visit_id)
        )
        .where(dp.and_(visit_table.c.site_id == store.site_id, visit_table.c.culture_confirmed == True))
        .order_by(
            dp.desc(visit_table.c.visit_index),
            dp.desc(image_stats.c.latest_image_uploaded_at),
            dp.desc(visit_table.c.created_at),
        )
    )

    if created_by_user_id:
        query = query.where(patient_table.c.created_by_user_id == created_by_user_id)
    if normalized_patient_id:
        query = query.where(visit_table.c.patient_id == normalized_patient_id)

    with dp.DATA_PLANE_ENGINE.begin() as conn:
        rows = conn.execute(query).mappings().all()

    records = []
    for row in rows:
        record = _case_summary_record(row)
        record["research_registry_updated_at"] = row["research_registry_updated_at"]
        record["research_registry_updated_by"] = row["research_registry_updated_by"]
        record["research_registry_source"] = row["research_registry_source"]
        records.append(record)
    return records


def list_patient_case_rows(
    store: Any,
    *,
    created_by_user_id: str | None = None,
    search: str | None = None,
    page: int = 1,
    page_size: int = 25,
) -> dict[str, Any]:
    dp = _deps()
    normalized_search = str(search or "").strip().lower()
    bounded_page_size = max(1, min(int(page_size or 25), 100))
    safe_page = max(1, int(page or 1))

    patient_table = dp.db_patients.alias("p")
    visit_table = dp.db_visits.alias("v")
    image_table = dp.db_images.alias("i")

    image_stats = _image_stats_subquery(dp, store, image_table)
    representative_images = _representative_images_subquery(dp, store, image_table)

    patient_latest = (
        dp.select(
            visit_table.c.patient_id,
            dp.func.count(visit_table.c.visit_id).label("case_count"),
            dp.func.max(
                visit_table.c.visit_index * 1000000000000
                + dp.func.coalesce(dp.func.length(visit_table.c.created_at), 0)
            ).label("sort_key"),
        )
        .where(dp.and_(visit_table.c.site_id == store.site_id, visit_table.c.culture_confirmed == True))
        .group_by(visit_table.c.patient_id)
        .subquery("patient_latest")
    )

    search_conditions = []
    fts_match_query = (
        dp._sqlite_patient_case_match_query(normalized_search)
        if normalized_search and dp.data_plane_sqlite_search_ready()
        else None
    )
    if fts_match_query:
        fts_search = dp.table(
            "patient_case_search",
            dp.column("site_id"),
            dp.column("visit_id"),
        )
        matching_visit_ids = (
            dp.select(fts_search.c.visit_id)
            .select_from(fts_search)
            .where(
                dp.and_(
                    fts_search.c.site_id == store.site_id,
                    dp.literal_column("patient_case_search").op("MATCH")(fts_match_query),
                )
            )
        )
        search_conditions = [visit_table.c.visit_id.in_(matching_visit_ids)]
    elif normalized_search:
        search_pattern = f"%{normalized_search}%"
        search_conditions = [
            dp.or_(
                patient_table.c.patient_id.ilike(search_pattern),
                patient_table.c.local_case_code.ilike(search_pattern),
                patient_table.c.chart_alias.ilike(search_pattern),
                visit_table.c.culture_category.ilike(search_pattern),
                visit_table.c.culture_species.ilike(search_pattern),
                visit_table.c.visit_date.ilike(search_pattern),
                visit_table.c.actual_visit_date.ilike(search_pattern),
            )
        ]

    count_base = (
        dp.select(dp.func.count(dp.func.distinct(visit_table.c.patient_id)))
        .select_from(
            visit_table.join(
                patient_table,
                dp.and_(
                    visit_table.c.site_id == patient_table.c.site_id,
                    visit_table.c.patient_id == patient_table.c.patient_id,
                ),
            )
        )
        .where(dp.and_(visit_table.c.site_id == store.site_id, visit_table.c.culture_confirmed == True))
    )
    if created_by_user_id:
        count_base = count_base.where(patient_table.c.created_by_user_id == created_by_user_id)
    if search_conditions:
        count_base = count_base.where(dp.and_(*search_conditions))

    patient_ids_query_base = (
        dp.select(
            patient_table.c.patient_id,
            patient_latest.c.case_count,
            dp.func.max(image_stats.c.latest_image_uploaded_at).label("max_upload"),
            dp.func.max(visit_table.c.created_at).label("max_created"),
            dp.func.max(visit_table.c.visit_index).label("max_visit_index"),
        )
        .select_from(
            patient_table
            .join(
                visit_table,
                dp.and_(
                    patient_table.c.site_id == visit_table.c.site_id,
                    patient_table.c.patient_id == visit_table.c.patient_id,
                ),
            )
            .join(patient_latest, patient_table.c.patient_id == patient_latest.c.patient_id)
            .outerjoin(image_stats, visit_table.c.visit_id == image_stats.c.visit_id)
        )
        .where(dp.and_(patient_table.c.site_id == store.site_id, visit_table.c.culture_confirmed == True))
        .group_by(patient_table.c.patient_id, patient_latest.c.case_count)
    )
    if created_by_user_id:
        patient_ids_query_base = patient_ids_query_base.where(patient_table.c.created_by_user_id == created_by_user_id)
    if search_conditions:
        patient_ids_query_base = patient_ids_query_base.where(dp.and_(*search_conditions))

    cases_query_base = (
        dp.select(
            visit_table.c.visit_id,
            visit_table.c.patient_id,
            visit_table.c.patient_reference_id,
            visit_table.c.visit_date,
            visit_table.c.visit_index,
            visit_table.c.actual_visit_date,
            visit_table.c.culture_category,
            visit_table.c.culture_species,
            visit_table.c.additional_organisms,
            visit_table.c.contact_lens_use,
            visit_table.c.predisposing_factor,
            visit_table.c.other_history,
            visit_table.c.visit_status,
            visit_table.c.active_stage,
            visit_table.c.is_initial_visit,
            visit_table.c.smear_result,
            visit_table.c.polymicrobial,
            visit_table.c.research_registry_status,
            visit_table.c.created_at,
            patient_table.c.chart_alias,
            patient_table.c.local_case_code,
            patient_table.c.sex,
            patient_table.c.age,
            patient_table.c.created_by_user_id,
            dp.func.coalesce(image_stats.c.image_count, 0).label("image_count"),
            image_stats.c.latest_image_uploaded_at,
            representative_images.c.representative_image_id,
            representative_images.c.representative_view,
        )
        .select_from(
            visit_table
            .join(
                patient_table,
                dp.and_(
                    visit_table.c.site_id == patient_table.c.site_id,
                    visit_table.c.patient_id == patient_table.c.patient_id,
                ),
            )
            .outerjoin(image_stats, visit_table.c.visit_id == image_stats.c.visit_id)
            .outerjoin(representative_images, visit_table.c.visit_id == representative_images.c.visit_id)
        )
        .where(dp.and_(visit_table.c.site_id == store.site_id, visit_table.c.culture_confirmed == True))
        .order_by(
            dp.desc(image_stats.c.latest_image_uploaded_at),
            dp.desc(visit_table.c.created_at),
            dp.desc(visit_table.c.visit_index),
        )
    )

    with dp.DATA_PLANE_ENGINE.connect() as conn:
        total_count = conn.execute(count_base).scalar() or 0

        total_pages = max(1, (total_count + bounded_page_size - 1) // bounded_page_size)
        safe_page = min(safe_page, total_pages) if total_pages > 0 else 1
        offset = (safe_page - 1) * bounded_page_size

        patient_ids_query = (
            patient_ids_query_base
            .order_by(
                dp.desc(dp.func.coalesce(dp.func.max(image_stats.c.latest_image_uploaded_at), "")),
                dp.desc(dp.func.max(visit_table.c.created_at)),
                dp.desc(dp.func.max(visit_table.c.visit_index)),
            )
            .limit(bounded_page_size)
            .offset(offset)
        )
        patient_rows = conn.execute(patient_ids_query).mappings().all()

        if not patient_rows:
            return {
                "items": [],
                "page": safe_page,
                "page_size": bounded_page_size,
                "total_count": total_count,
                "total_pages": total_pages,
            }

        patient_ids = [row["patient_id"] for row in patient_rows]
        case_counts = {row["patient_id"]: int(row["case_count"] or 0) for row in patient_rows}

        cases_query = cases_query_base.where(visit_table.c.patient_id.in_(patient_ids))
        case_rows = conn.execute(cases_query).mappings().all()

    cases_by_patient: dict[str, list[dict[str, Any]]] = {}
    for row in case_rows:
        patient_id = row["patient_id"]
        case_record = _case_summary_record(row)
        cases_by_patient.setdefault(patient_id, []).append(case_record)

    rows: list[dict[str, Any]] = []
    for patient_id in patient_ids:
        cases = cases_by_patient.get(patient_id, [])
        if not cases:
            continue
        sorted_cases = sorted(cases, key=dp._case_summary_sort_key, reverse=True)
        latest_case = sorted_cases[0]
        representative_cases = [
            item
            for item in sorted_cases
            if item.get("representative_image_id")
        ]
        rows.append(
            {
                "patient_id": patient_id,
                "latest_case": latest_case,
                "case_count": case_counts.get(patient_id, len(sorted_cases)),
                "representative_thumbnail_count": len(representative_cases),
                "organism_summary": dp._organism_summary_label(
                    str(latest_case.get("culture_category") or ""),
                    str(latest_case.get("culture_species") or ""),
                    latest_case.get("additional_organisms", []) or [],
                    max_visible_species=2,
                ),
                "representative_thumbnails": [
                    {
                        "case_id": item["case_id"],
                        "image_id": item["representative_image_id"],
                        "view": item.get("representative_view"),
                        "preview_url": None,
                    }
                    for item in representative_cases
                ][:3],
            }
        )

    return {
        "items": rows,
        "page": safe_page,
        "page_size": bounded_page_size,
        "total_count": total_count,
        "total_pages": total_pages,
    }
