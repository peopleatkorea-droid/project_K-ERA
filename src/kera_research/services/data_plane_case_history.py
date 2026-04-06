from __future__ import annotations

from pathlib import Path
from typing import Any


def _deps():
    from kera_research.services import data_plane as dp

    return dp


def case_history_path(store: Any, patient_id: str, visit_date: str) -> Path:
    dp = _deps()
    patient_dir = dp.ensure_dir(store.case_history_dir / dp._safe_path_component(patient_id))
    return patient_dir / f"{dp._safe_path_component(visit_date)}.json"


def resolve_visit_reference(store: Any, patient_id: str, visit_date: str) -> tuple[str, str]:
    dp = _deps()
    normalized_patient_id = dp.normalize_patient_pseudonym(patient_id)
    requested_visit_date = dp._coerce_optional_text(visit_date)
    if requested_visit_date:
        existing_visit = store.get_visit(normalized_patient_id, requested_visit_date)
        if existing_visit is not None:
            return (
                dp._coerce_optional_text(existing_visit.get("patient_id")) or normalized_patient_id,
                dp._coerce_optional_text(existing_visit.get("visit_date")) or requested_visit_date,
            )
    return normalized_patient_id, requested_visit_date


def load_case_history(store: Any, patient_id: str, visit_date: str) -> dict[str, list[dict[str, Any]]]:
    dp = _deps()
    resolved_patient_id, resolved_visit_date = resolve_visit_reference(store, patient_id, visit_date)
    history_path = case_history_path(store, resolved_patient_id, resolved_visit_date)
    payload = dp.read_json(history_path, {"validations": [], "contributions": []})
    validations = [
        dict(dp.remap_bundle_paths_in_value(dict(item)))
        for item in payload.get("validations", [])
        if isinstance(item, dict)
    ]
    contributions = [
        dict(dp.remap_bundle_paths_in_value(dict(item)))
        for item in payload.get("contributions", [])
        if isinstance(item, dict)
    ]
    validations.sort(
        key=lambda item: (
            str(item.get("run_date") or ""),
            str(item.get("validation_id") or ""),
        ),
        reverse=True,
    )
    contributions.sort(
        key=lambda item: (
            str(item.get("created_at") or ""),
            str(item.get("contribution_id") or ""),
        ),
        reverse=True,
    )
    return {
        "validations": validations,
        "contributions": contributions,
    }


def record_case_validation_history(
    store: Any,
    patient_id: str,
    visit_date: str,
    entry: dict[str, Any],
) -> dict[str, list[dict[str, Any]]]:
    dp = _deps()
    resolved_patient_id, resolved_visit_date = resolve_visit_reference(store, patient_id, visit_date)
    history = load_case_history(store, resolved_patient_id, resolved_visit_date)
    validation_id = str(entry.get("validation_id") or "").strip()
    if validation_id:
        history["validations"] = [
            item
            for item in history["validations"]
            if str(item.get("validation_id") or "").strip() != validation_id
        ]
    history["validations"].append(dict(entry))
    history["validations"].sort(
        key=lambda item: (
            str(item.get("run_date") or ""),
            str(item.get("validation_id") or ""),
        ),
        reverse=True,
    )
    dp.write_json(case_history_path(store, resolved_patient_id, resolved_visit_date), history)
    return history


def record_case_contribution_history(
    store: Any,
    patient_id: str,
    visit_date: str,
    entry: dict[str, Any],
) -> dict[str, list[dict[str, Any]]]:
    dp = _deps()
    resolved_patient_id, resolved_visit_date = resolve_visit_reference(store, patient_id, visit_date)
    history = load_case_history(store, resolved_patient_id, resolved_visit_date)
    contribution_id = str(entry.get("contribution_id") or "").strip()
    if contribution_id:
        history["contributions"] = [
            item
            for item in history["contributions"]
            if str(item.get("contribution_id") or "").strip() != contribution_id
        ]
    history["contributions"].append(dict(entry))
    history["contributions"].sort(
        key=lambda item: (
            str(item.get("created_at") or ""),
            str(item.get("contribution_id") or ""),
        ),
        reverse=True,
    )
    dp.write_json(case_history_path(store, resolved_patient_id, resolved_visit_date), history)
    return history
