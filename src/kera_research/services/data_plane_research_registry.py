from __future__ import annotations

from typing import Any

from sqlalchemy import and_, update

from kera_research.db import DATA_PLANE_ENGINE, visits as db_visits
from kera_research.domain import normalize_patient_pseudonym, normalize_visit_label, utc_now
from kera_research.services.data_plane_normalizers import (
    _normalize_culture_status as _normalize_culture_status_impl,
)

_CULTURE_STATUS_OPTIONS = {"positive", "negative", "not_done", "unknown"}
_REGISTRY_STATUS_OPTIONS = {"analysis_only", "candidate", "included", "excluded"}


def _normalize_culture_status(value: Any, default: str = "unknown") -> str:
    return _normalize_culture_status_impl(
        value,
        _CULTURE_STATUS_OPTIONS,
        default=default,
    )


def case_research_policy_state(
    site_store: Any,
    patient_id: str,
    visit_date: str,
) -> dict[str, Any]:
    visit = site_store.get_visit(patient_id, visit_date)
    if visit is None:
        raise ValueError(f"Visit {patient_id} / {visit_date} does not exist.")
    normalized_patient_id = str(visit.get("patient_id") or patient_id)
    normalized_visit_date = str(visit.get("visit_date") or visit_date)
    case_summary = next(
        (
            item
            for item in site_store.list_case_summaries(patient_id=normalized_patient_id)
            if str(item.get("patient_id") or "") == normalized_patient_id
            and str(item.get("visit_date") or "") == normalized_visit_date
        ),
        None,
    )
    image_count = (
        int(case_summary.get("image_count") or 0)
        if case_summary
        else len(site_store.list_images_for_visit(normalized_patient_id, normalized_visit_date))
    )
    culture_status = _normalize_culture_status(visit.get("culture_status"), default="unknown")
    visit_status = str(visit.get("visit_status") or "").strip().lower() or (
        "active" if visit.get("active_stage") else "scar"
    )
    research_registry_status = (
        str(visit.get("research_registry_status") or "analysis_only").strip().lower()
        or "analysis_only"
    )
    return {
        "patient_id": normalized_patient_id,
        "visit_date": normalized_visit_date,
        "visit": visit,
        "case_summary": case_summary,
        "culture_status": culture_status,
        "is_positive": culture_status == "positive",
        "visit_status": visit_status,
        "is_active": visit_status == "active",
        "image_count": image_count,
        "has_images": image_count > 0,
        "research_registry_status": research_registry_status,
        "is_registry_included": research_registry_status == "included",
    }


def update_visit_registry_status(
    site_store: Any,
    patient_id: str,
    visit_date: str,
    *,
    status_value: str,
    updated_by_user_id: str | None,
    source: str,
) -> dict[str, Any]:
    normalized_patient_id = normalize_patient_pseudonym(patient_id)
    normalized_visit_date = normalize_visit_label(visit_date)
    existing = site_store.get_visit(normalized_patient_id, normalized_visit_date)
    if existing is None:
        raise ValueError(
            f"Visit {normalized_patient_id} / {normalized_visit_date} does not exist."
        )
    normalized_status = str(status_value or "").strip().lower()
    if normalized_status not in _REGISTRY_STATUS_OPTIONS:
        raise ValueError("Invalid registry status.")
    values = {
        "research_registry_status": normalized_status,
        "research_registry_updated_at": utc_now(),
        "research_registry_updated_by": updated_by_user_id,
        "research_registry_source": str(source or "").strip() or None,
    }
    with DATA_PLANE_ENGINE.begin() as conn:
        conn.execute(
            update(db_visits)
            .where(
                and_(
                    db_visits.c.site_id == site_store.site_id,
                    db_visits.c.visit_id == existing["visit_id"],
                )
            )
            .values(**values)
        )
    refreshed = site_store._get_visit_by_id(str(existing.get("visit_id") or "").strip())
    if refreshed is None:
        raise ValueError(
            f"Visit {normalized_patient_id} / {normalized_visit_date} does not exist."
        )
    return refreshed
