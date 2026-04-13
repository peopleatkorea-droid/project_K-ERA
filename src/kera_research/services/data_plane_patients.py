from __future__ import annotations

from typing import Any


def _deps():
    from kera_research.services import data_plane as dp

    return dp


def _patient_record_from_row(dp: Any, row: dict[str, Any]) -> dict[str, Any]:
    return {
        "patient_id": row["patient_id"],
        "created_by_user_id": row.get("created_by_user_id"),
        "sex": row["sex"],
        "age": row["age"],
        "chart_alias": row["chart_alias"],
        "local_case_code": row["local_case_code"],
        "created_at": row["created_at"],
    }


def get_visit_by_id(store: Any, visit_id: str) -> dict[str, Any] | None:
    dp = _deps()
    query = dp.select(dp.db_visits).where(
        dp.and_(dp.db_visits.c.site_id == store.site_id, dp.db_visits.c.visit_id == visit_id)
    )
    with dp.DATA_PLANE_ENGINE.begin() as conn:
        row = conn.execute(query).mappings().first()
    return dp._hydrate_visit_culture_fields(dict(row)) if row else None


def list_patients(store: Any, created_by_user_id: str | None = None) -> list[dict[str, Any]]:
    dp = _deps()
    store._sync_raw_inventory_metadata_if_due()
    query = dp.select(dp.db_patients).where(dp.db_patients.c.site_id == store.site_id)
    if created_by_user_id:
        query = query.where(dp.db_patients.c.created_by_user_id == created_by_user_id)
    query = query.order_by(dp.db_patients.c.created_at.desc())
    with dp.DATA_PLANE_ENGINE.begin() as conn:
        rows = conn.execute(query).mappings().all()
    return [_patient_record_from_row(dp, row) for row in rows]


def _workspace_visible_visit_clause(dp: Any, visit_table: Any) -> Any:
    normalized_culture_status = dp.func.lower(
        dp.func.trim(dp.func.coalesce(visit_table.c.culture_status, ""))
    )
    inferred_positive_culture = dp.or_(
        visit_table.c.culture_confirmed == True,
        dp.func.length(dp.func.trim(dp.func.coalesce(visit_table.c.culture_category, ""))) > 0,
        dp.func.length(dp.func.trim(dp.func.coalesce(visit_table.c.culture_species, ""))) > 0,
    )
    workspace_positive_culture = dp.or_(
        normalized_culture_status == "positive",
        dp.and_(
            dp.or_(
                visit_table.c.culture_status.is_(None),
                normalized_culture_status == "",
            ),
            inferred_positive_culture,
        ),
    )
    return dp.or_(
        visit_table.c.research_registry_source.is_(None),
        visit_table.c.research_registry_source != "raw_inventory_sync",
        workspace_positive_culture,
    )


def list_visible_workspace_patients(
    store: Any,
    created_by_user_id: str | None = None,
) -> list[dict[str, Any]]:
    dp = _deps()
    store._sync_raw_inventory_metadata_if_due()
    patient_table = dp.db_patients.alias("p")
    visit_table = dp.db_visits.alias("v")
    any_visible_visit = dp.and_(
        visit_table.c.site_id == store.site_id,
        dp._visit_visible_clause(visit_table),
    )
    visible_workspace_visit = dp.and_(
        any_visible_visit,
        _workspace_visible_visit_clause(dp, visit_table),
    )
    patient_ids_with_any_visit = (
        dp.select(visit_table.c.patient_id)
        .where(any_visible_visit)
        .group_by(visit_table.c.patient_id)
        .subquery("patient_ids_with_any_visit")
    )
    visible_patient_ids = (
        dp.select(visit_table.c.patient_id)
        .where(visible_workspace_visit)
        .group_by(visit_table.c.patient_id)
        .subquery("visible_workspace_patient_ids")
    )
    query = (
        dp.select(patient_table)
        .select_from(
            patient_table
            .outerjoin(
                visible_patient_ids,
                patient_table.c.patient_id == visible_patient_ids.c.patient_id,
            )
            .outerjoin(
                patient_ids_with_any_visit,
                patient_table.c.patient_id == patient_ids_with_any_visit.c.patient_id,
            )
        )
        .where(patient_table.c.site_id == store.site_id)
        .where(
            dp.or_(
                visible_patient_ids.c.patient_id.is_not(None),
                patient_ids_with_any_visit.c.patient_id.is_(None),
            )
        )
        .order_by(patient_table.c.created_at.desc())
    )
    if created_by_user_id:
        query = query.where(patient_table.c.created_by_user_id == created_by_user_id)
    with dp.DATA_PLANE_ENGINE.begin() as conn:
        rows = conn.execute(query).mappings().all()
    return [_patient_record_from_row(dp, row) for row in rows]


def get_patient(store: Any, patient_id: str) -> dict[str, Any] | None:
    dp = _deps()
    store._sync_raw_inventory_metadata_if_due()
    query = dp.select(dp.db_patients).where(
        dp.and_(dp.db_patients.c.site_id == store.site_id, dp.db_patients.c.patient_id == patient_id)
    )
    with dp.DATA_PLANE_ENGINE.begin() as conn:
        row = conn.execute(query).mappings().first()
    if row is None:
        return None
    return _patient_record_from_row(dp, row)


def lookup_patient_id(store: Any, patient_id: str) -> dict[str, Any]:
    dp = _deps()
    store._sync_raw_inventory_metadata_if_due()
    requested_patient_id = str(patient_id or "").strip()
    normalized_patient_id = dp.normalize_patient_pseudonym(patient_id)
    if not normalized_patient_id:
        raise ValueError("Patient id is required.")

    patient_query = dp.select(dp.db_patients).where(
        dp.and_(dp.db_patients.c.site_id == store.site_id, dp.db_patients.c.patient_id == normalized_patient_id)
    )
    visit_count_query = (
        dp.select(dp.func.count())
        .select_from(dp.db_visits)
        .where(dp.and_(dp.db_visits.c.site_id == store.site_id, dp.db_visits.c.patient_id == normalized_patient_id))
    )
    image_count_query = (
        dp.select(dp.func.count())
        .select_from(dp.db_images)
        .where(dp.and_(dp.db_images.c.site_id == store.site_id, dp.db_images.c.patient_id == normalized_patient_id))
    )
    latest_visit_query = (
        dp.select(dp.db_visits.c.visit_date)
        .where(dp.and_(dp.db_visits.c.site_id == store.site_id, dp.db_visits.c.patient_id == normalized_patient_id))
        .order_by(dp.desc(dp.db_visits.c.visit_index), dp.desc(dp.db_visits.c.visit_date))
        .limit(1)
    )

    with dp.DATA_PLANE_ENGINE.begin() as conn:
        patient_row = conn.execute(patient_query).mappings().first()
        visit_count = conn.execute(visit_count_query).scalar() or 0
        image_count = conn.execute(image_count_query).scalar() or 0
        latest_visit_date = conn.execute(latest_visit_query).scalar()

    patient_record = _patient_record_from_row(dp, patient_row) if patient_row is not None else None
    return {
        "requested_patient_id": requested_patient_id,
        "normalized_patient_id": normalized_patient_id,
        "exists": patient_record is not None,
        "patient": patient_record,
        "visit_count": int(visit_count or 0),
        "image_count": int(image_count or 0),
        "latest_visit_date": str(latest_visit_date or "") or None,
    }


def create_patient(
    store: Any,
    patient_id: str,
    sex: str,
    age: int,
    chart_alias: str = "",
    local_case_code: str = "",
    created_by_user_id: str | None = None,
) -> dict[str, Any]:
    dp = _deps()
    normalized_patient_id = dp.normalize_patient_pseudonym(patient_id)
    if get_patient(store, normalized_patient_id):
        raise ValueError(f"Patient {normalized_patient_id} already exists.")
    record = {
        "site_id": store.site_id,
        "patient_id": normalized_patient_id,
        "created_by_user_id": created_by_user_id,
        "sex": sex,
        "age": int(age),
        "chart_alias": chart_alias.strip(),
        "local_case_code": local_case_code.strip(),
        "created_at": dp.utc_now(),
    }
    with dp.DATA_PLANE_ENGINE.begin() as conn:
        conn.execute(dp.db_patients.insert().values(**record))
    return {
        key: record[key]
        for key in [
            "patient_id",
            "created_by_user_id",
            "sex",
            "age",
            "chart_alias",
            "local_case_code",
            "created_at",
        ]
    }


def update_patient(
    store: Any,
    patient_id: str,
    sex: str,
    age: int,
    chart_alias: str = "",
    local_case_code: str = "",
) -> dict[str, Any]:
    dp = _deps()
    normalized_patient_id = dp.normalize_patient_pseudonym(patient_id)
    existing = get_patient(store, normalized_patient_id)
    if existing is None:
        raise ValueError(f"Patient {normalized_patient_id} does not exist.")
    values = {
        "sex": sex,
        "age": int(age),
        "chart_alias": chart_alias.strip(),
        "local_case_code": local_case_code.strip(),
    }
    with dp.DATA_PLANE_ENGINE.begin() as conn:
        conn.execute(
            dp.update(dp.db_patients)
            .where(
                dp.and_(
                    dp.db_patients.c.site_id == store.site_id,
                    dp.db_patients.c.patient_id == normalized_patient_id,
                )
            )
            .values(**values)
        )
    refreshed = get_patient(store, normalized_patient_id)
    if refreshed is None:
        raise ValueError(f"Patient {normalized_patient_id} does not exist.")
    return refreshed


def get_visit_row(
    store: Any,
    patient_id: str,
    visit_date: str,
    *,
    include_soft_deleted: bool = False,
) -> dict[str, Any] | None:
    dp = _deps()
    normalized_patient_id = dp.normalize_patient_pseudonym(patient_id)
    requested_visit_date = dp._coerce_optional_text(visit_date)
    if not requested_visit_date:
        return None
    try:
        normalized_visit_date = dp.normalize_visit_label(requested_visit_date)
        normalized_visit_index = dp.visit_index_from_label(normalized_visit_date)
    except ValueError:
        normalized_visit_date = None
        normalized_visit_index = None

    predicates = [
        dp.db_visits.c.site_id == store.site_id,
        dp.db_visits.c.patient_id == normalized_patient_id,
    ]
    if not include_soft_deleted:
        predicates.append(dp._visit_visible_clause(dp.db_visits))
    base_query = dp.select(dp.db_visits).where(dp.and_(*predicates))
    with dp.DATA_PLANE_ENGINE.begin() as conn:
        row = conn.execute(base_query.where(dp.db_visits.c.visit_date == requested_visit_date)).mappings().first()
        if row is not None:
            return dp._hydrate_visit_culture_fields(dict(row))
        if normalized_visit_date and normalized_visit_date != requested_visit_date:
            row = conn.execute(base_query.where(dp.db_visits.c.visit_date == normalized_visit_date)).mappings().first()
            if row is not None:
                return dp._hydrate_visit_culture_fields(dict(row))
        if normalized_visit_index is not None:
            row = conn.execute(
                base_query.where(dp.db_visits.c.visit_index == normalized_visit_index).order_by(
                    dp.case((dp.db_visits.c.visit_date == normalized_visit_date, 0), else_=1),
                    dp.db_visits.c.created_at.desc(),
                )
            ).mappings().first()
            if row is not None:
                return dp._hydrate_visit_culture_fields(dict(row))
    return None


def is_visit_fl_retained(visit: dict[str, Any] | None) -> bool:
    return bool(visit and visit.get("fl_retained"))


def mark_visit_fl_retained(
    store: Any,
    patient_id: str,
    visit_date: str,
    *,
    scope: str,
    update_id: str | None = None,
) -> dict[str, Any]:
    dp = _deps()
    normalized_scope = str(scope or "").strip()
    if not normalized_scope:
        raise ValueError("Retention scope is required.")
    existing = get_visit_row(store, patient_id, visit_date, include_soft_deleted=True)
    if existing is None:
        raise ValueError(f"Visit {patient_id} / {visit_date} does not exist.")
    scopes = [str(item or "").strip() for item in existing.get("fl_retention_scopes") or [] if str(item or "").strip()]
    if normalized_scope not in scopes:
        scopes.append(normalized_scope)
    retained_at = dp._coerce_optional_text(existing.get("fl_retained_at")) or dp.utc_now()
    with dp.DATA_PLANE_ENGINE.begin() as conn:
        conn.execute(
            dp.update(dp.db_visits)
            .where(dp.and_(dp.db_visits.c.site_id == store.site_id, dp.db_visits.c.visit_id == existing["visit_id"]))
            .values(
                fl_retained=True,
                fl_retained_at=retained_at,
                fl_retention_scopes=scopes,
                fl_retention_last_update_id=str(update_id or "").strip() or existing.get("fl_retention_last_update_id"),
            )
        )
    refreshed = get_visit_row(
        store,
        dp._coerce_optional_text(existing.get("patient_id")) or patient_id,
        dp._coerce_optional_text(existing.get("visit_date")) or visit_date,
        include_soft_deleted=True,
    )
    if refreshed is None:
        raise ValueError(f"Visit {patient_id} / {visit_date} does not exist.")
    return refreshed


def list_retained_case_archive(store: Any) -> list[dict[str, Any]]:
    dp = _deps()
    image_counts = (
        dp.select(
            dp.db_images.c.visit_id.label("visit_id"),
            dp.func.count().label("total_image_count"),
            dp.func.coalesce(
                dp.func.sum(
                    dp.case(
                        (dp.db_images.c.soft_deleted_at.is_(None), 1),
                        else_=0,
                    )
                ),
                0,
            ).label("visible_image_count"),
            dp.func.coalesce(
                dp.func.sum(
                    dp.case(
                        (dp.db_images.c.soft_deleted_at.is_not(None), 1),
                        else_=0,
                    )
                ),
                0,
            ).label("soft_deleted_image_count"),
        )
        .where(dp.db_images.c.site_id == store.site_id)
        .group_by(dp.db_images.c.visit_id)
        .subquery()
    )
    query = (
        dp.select(
            dp.db_visits,
            dp.db_patients.c.chart_alias.label("chart_alias"),
            dp.db_patients.c.local_case_code.label("local_case_code"),
            dp.func.coalesce(image_counts.c.total_image_count, 0).label("total_image_count"),
            dp.func.coalesce(image_counts.c.visible_image_count, 0).label("visible_image_count"),
            dp.func.coalesce(image_counts.c.soft_deleted_image_count, 0).label("soft_deleted_image_count"),
        )
        .select_from(
            dp.db_visits.outerjoin(
                dp.db_patients,
                dp.and_(
                    dp.db_patients.c.site_id == dp.db_visits.c.site_id,
                    dp.db_patients.c.patient_id == dp.db_visits.c.patient_id,
                ),
            ).outerjoin(
                image_counts,
                image_counts.c.visit_id == dp.db_visits.c.visit_id,
            )
        )
        .where(
            dp.and_(
                dp.db_visits.c.site_id == store.site_id,
                dp.db_visits.c.fl_retained.is_(True),
                dp.or_(
                    dp.db_visits.c.soft_deleted_at.is_not(None),
                    dp.func.coalesce(image_counts.c.soft_deleted_image_count, 0) > 0,
                ),
            )
        )
        .order_by(dp.db_visits.c.patient_id, dp.db_visits.c.visit_index, dp.db_visits.c.visit_date)
    )
    with dp.DATA_PLANE_ENGINE.begin() as conn:
        rows = conn.execute(query).mappings().all()
    archive_records: list[dict[str, Any]] = []
    for row in rows:
        record = dp._hydrate_visit_culture_fields(dict(row))
        visit_soft_deleted_at = dp._coerce_optional_text(record.get("soft_deleted_at"))
        soft_deleted_image_count = int(record.get("soft_deleted_image_count") or 0)
        archive_records.append(
            {
                **record,
                "chart_alias": dp._coerce_optional_text(record.get("chart_alias")),
                "local_case_code": dp._coerce_optional_text(record.get("local_case_code")),
                "total_image_count": int(record.get("total_image_count") or 0),
                "visible_image_count": int(record.get("visible_image_count") or 0),
                "soft_deleted_image_count": soft_deleted_image_count,
                "visit_soft_deleted_at": visit_soft_deleted_at,
                "visit_soft_delete_reason": dp._coerce_optional_text(record.get("soft_delete_reason")),
                "can_restore_visit": bool(visit_soft_deleted_at),
                "can_restore_images": not bool(visit_soft_deleted_at) and soft_deleted_image_count > 0,
            }
        )
    return archive_records


def list_visits(store: Any) -> list[dict[str, Any]]:
    dp = _deps()
    store._sync_raw_inventory_metadata_if_due()
    query = (
        dp.select(dp.db_visits)
        .where(dp.and_(dp.db_visits.c.site_id == store.site_id, dp._visit_visible_clause(dp.db_visits)))
        .order_by(dp.db_visits.c.patient_id, dp.db_visits.c.visit_index, dp.db_visits.c.visit_date)
    )
    with dp.DATA_PLANE_ENGINE.begin() as conn:
        rows = conn.execute(query).mappings().all()
    return [dp._hydrate_visit_culture_fields(dict(row)) for row in rows]


def get_visit(store: Any, patient_id: str, visit_date: str) -> dict[str, Any] | None:
    store._sync_raw_inventory_metadata_if_due()
    return get_visit_row(store, patient_id, visit_date, include_soft_deleted=False)


def create_visit(
    store: Any,
    patient_id: str,
    visit_date: str,
    actual_visit_date: str | None,
    culture_confirmed: bool | None,
    culture_category: str | None,
    culture_species: str | None,
    additional_organisms: list[dict[str, Any]] | None,
    contact_lens_use: str,
    predisposing_factor: list[str],
    other_history: str,
    active_stage: bool = True,
    visit_status: str = "active",
    is_initial_visit: bool = False,
    smear_result: str = "",
    polymicrobial: bool = False,
    created_by_user_id: str | None = None,
    culture_status: str | None = None,
) -> dict[str, Any]:
    dp = _deps()
    normalized_patient_id = dp.normalize_patient_pseudonym(patient_id)
    normalized_visit_date = dp.normalize_visit_label(visit_date)
    normalized_actual_visit_date = dp.normalize_actual_visit_date(actual_visit_date)
    if not get_patient(store, normalized_patient_id):
        raise ValueError(f"Patient {normalized_patient_id} does not exist.")
    if normalized_visit_date == "Initial":
        visit_count_query = (
            dp.select(dp.func.count())
            .select_from(dp.db_visits)
            .where(dp.and_(dp.db_visits.c.site_id == store.site_id, dp.db_visits.c.patient_id == normalized_patient_id))
        )
        with dp.DATA_PLANE_ENGINE.begin() as conn:
            existing_visit_count = int(conn.execute(visit_count_query).scalar() or 0)
        if existing_visit_count > 0:
            raise ValueError("Existing patients can only receive follow-up visits. Use a FU #N label.")
    if get_visit(store, normalized_patient_id, normalized_visit_date):
        raise ValueError(f"Visit {normalized_patient_id} / {normalized_visit_date} already exists.")
    normalized_culture = dp._normalize_visit_culture_fields(
        culture_status=culture_status,
        culture_confirmed=culture_confirmed,
        culture_category=culture_category,
        culture_species=culture_species,
        additional_organisms=additional_organisms,
        polymicrobial=polymicrobial,
    )
    normalized_status = (visit_status or "").strip().lower()
    if normalized_status not in dp.VISIT_STATUS_OPTIONS:
        normalized_status = "active" if active_stage else "scar"
    record = {
        "visit_id": dp.make_id("visit"),
        "site_id": store.site_id,
        "patient_id": normalized_patient_id,
        "patient_reference_id": dp.make_patient_reference_id(
            store.site_id,
            normalized_patient_id,
            dp.PATIENT_REFERENCE_SALT,
        ),
        "created_by_user_id": created_by_user_id,
        "visit_date": normalized_visit_date,
        "visit_index": dp.visit_index_from_label(normalized_visit_date),
        "actual_visit_date": normalized_actual_visit_date,
        **normalized_culture,
        "contact_lens_use": contact_lens_use,
        "predisposing_factor": predisposing_factor,
        "other_history": other_history,
        "visit_status": normalized_status,
        "active_stage": normalized_status == "active",
        "is_initial_visit": bool(is_initial_visit),
        "smear_result": smear_result.strip(),
        "research_registry_status": "analysis_only",
        "research_registry_updated_at": dp.utc_now(),
        "research_registry_updated_by": created_by_user_id,
        "research_registry_source": "visit_create",
        "created_at": dp.utc_now(),
    }
    with dp.DATA_PLANE_ENGINE.begin() as conn:
        conn.execute(dp.db_visits.insert().values(**record))
    return record


def update_visit(
    store: Any,
    patient_id: str,
    visit_date: str,
    target_patient_id: str | None,
    target_visit_date: str | None,
    actual_visit_date: str | None,
    culture_confirmed: bool | None,
    culture_category: str | None,
    culture_species: str | None,
    additional_organisms: list[dict[str, Any]] | None,
    contact_lens_use: str,
    predisposing_factor: list[str],
    other_history: str,
    active_stage: bool = True,
    visit_status: str = "active",
    is_initial_visit: bool = False,
    smear_result: str = "",
    polymicrobial: bool = False,
    culture_status: str | None = None,
) -> dict[str, Any]:
    dp = _deps()
    normalized_patient_id = dp.normalize_patient_pseudonym(patient_id)
    normalized_visit_date = dp.normalize_visit_label(visit_date)
    normalized_target_patient_id = dp.normalize_patient_pseudonym(target_patient_id or patient_id)
    normalized_target_visit_date = dp.normalize_visit_label(target_visit_date or visit_date)
    normalized_actual_visit_date = dp.normalize_actual_visit_date(actual_visit_date)
    existing = get_visit(store, normalized_patient_id, normalized_visit_date)
    if existing is None:
        raise ValueError(f"Visit {normalized_patient_id} / {normalized_visit_date} does not exist.")
    if get_patient(store, normalized_target_patient_id) is None:
        raise ValueError(f"Patient {normalized_target_patient_id} does not exist.")
    existing_visit_id = dp._coerce_optional_text(existing.get("visit_id"))
    existing_patient_id = dp._coerce_optional_text(existing.get("patient_id")) or normalized_patient_id
    existing_visit_date = dp._coerce_optional_text(existing.get("visit_date")) or normalized_visit_date
    target_changed = (
        normalized_target_patient_id != existing_patient_id
        or normalized_target_visit_date != existing_visit_date
    )
    if target_changed:
        with dp.DATA_PLANE_ENGINE.begin() as conn:
            duplicate_visit = conn.execute(
                dp.select(dp.db_visits.c.visit_id).where(
                    dp.and_(
                        dp.db_visits.c.site_id == store.site_id,
                        dp.db_visits.c.patient_id == normalized_target_patient_id,
                        dp.db_visits.c.visit_date == normalized_target_visit_date,
                        dp.db_visits.c.visit_id != existing_visit_id,
                    )
                )
            ).scalar()
        if duplicate_visit:
            raise ValueError(
                f"Visit {normalized_target_patient_id} / {normalized_target_visit_date} already exists."
            )
    normalized_culture = dp._normalize_visit_culture_fields(
        culture_status=culture_status,
        culture_confirmed=culture_confirmed,
        culture_category=culture_category,
        culture_species=culture_species,
        additional_organisms=additional_organisms,
        polymicrobial=polymicrobial,
    )
    normalized_status = (visit_status or "").strip().lower()
    if normalized_status not in dp.VISIT_STATUS_OPTIONS:
        normalized_status = "active" if active_stage else "scar"
    values = {
        "patient_id": normalized_target_patient_id,
        "patient_reference_id": dp.make_patient_reference_id(
            store.site_id,
            normalized_target_patient_id,
            dp.PATIENT_REFERENCE_SALT,
        ),
        "actual_visit_date": normalized_actual_visit_date,
        "visit_date": normalized_target_visit_date,
        "visit_index": dp.visit_index_from_label(normalized_target_visit_date),
        **normalized_culture,
        "contact_lens_use": contact_lens_use,
        "predisposing_factor": predisposing_factor,
        "other_history": other_history,
        "visit_status": normalized_status,
        "active_stage": normalized_status == "active",
        "is_initial_visit": bool(is_initial_visit),
        "smear_result": smear_result.strip(),
    }
    with dp.DATA_PLANE_ENGINE.begin() as conn:
        conn.execute(
            dp.update(dp.db_visits)
            .where(dp.and_(dp.db_visits.c.site_id == store.site_id, dp.db_visits.c.visit_id == existing_visit_id))
            .values(**values)
        )
        conn.execute(
            dp.update(dp.db_images)
            .where(dp.and_(dp.db_images.c.site_id == store.site_id, dp.db_images.c.visit_id == existing_visit_id))
            .values(
                patient_id=normalized_target_patient_id,
                visit_date=normalized_target_visit_date,
            )
        )
    if target_changed:
        source_history_path = store._case_history_path(existing_patient_id, existing_visit_date)
        target_history_path = store._case_history_path(normalized_target_patient_id, normalized_target_visit_date)
        if source_history_path.exists():
            dp.ensure_dir(target_history_path.parent)
            if target_history_path.exists():
                target_history_path.unlink(missing_ok=True)
            source_history_path.replace(target_history_path)
        elif target_history_path.exists():
            target_history_path.unlink(missing_ok=True)
        if normalized_target_patient_id != existing_patient_id:
            store._delete_patient_if_empty(existing_patient_id)
    refreshed = get_visit_by_id(store, existing_visit_id)
    if refreshed is None:
        raise ValueError(
            f"Visit {normalized_target_patient_id} / {normalized_target_visit_date} does not exist."
        )
    return refreshed


def list_visits_for_patient(store: Any, patient_id: str) -> list[dict[str, Any]]:
    dp = _deps()
    query = (
        dp.select(dp.db_visits)
        .where(
            dp.and_(
                dp.db_visits.c.site_id == store.site_id,
                dp.db_visits.c.patient_id == patient_id,
                dp._visit_visible_clause(dp.db_visits),
            )
        )
        .order_by(dp.db_visits.c.visit_index, dp.db_visits.c.visit_date)
    )
    with dp.DATA_PLANE_ENGINE.begin() as conn:
        rows = conn.execute(query).mappings().all()
    return [dp._hydrate_visit_culture_fields(dict(row)) for row in rows]
