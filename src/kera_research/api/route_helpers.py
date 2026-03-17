from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from kera_research.domain import visit_label_from_index
from kera_research.services.control_plane import ControlPlaneStore
from kera_research.services.data_plane import SiteStore
from kera_research.storage import read_json


def load_cross_validation_reports(site_store: SiteStore) -> list[dict[str, Any]]:
    reports: list[dict[str, Any]] = []
    for report_path in site_store.validation_dir.glob("cv_*.json"):
        report = read_json(report_path, {})
        if isinstance(report, dict) and report.get("cross_validation_id"):
            reports.append(report)
    reports.sort(key=lambda item: item.get("created_at", ""), reverse=True)
    return reports


def attach_image_quality_scores(images: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            **image,
            "quality_scores": image.get("quality_scores"),
        }
        for image in images
    ]


def site_level_validation_runs(validation_runs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        run
        for run in validation_runs
        if int(run.get("n_cases", 0) or 0) > 1 or run.get("AUROC") is not None
    ]


def _case_reference_lookup(cp: ControlPlaneStore, site_store: SiteStore) -> dict[str, dict[str, Any]]:
    lookup: dict[str, dict[str, Any]] = {}
    for visit in site_store.list_visits():
        patient_id = str(visit.get("patient_id") or "").strip()
        visit_date = str(visit.get("visit_date") or "").strip()
        if not patient_id or not visit_date:
            continue
        lookup[cp.case_reference_id(site_store.site_id, patient_id, visit_date)] = {
            "patient_id": patient_id,
            "visit_date": visit_date,
            "patient_reference_id": visit.get("patient_reference_id"),
            "visit_index": visit.get("visit_index"),
        }
    return lookup


def validation_case_rows(
    cp: ControlPlaneStore,
    site_store: SiteStore | None,
    validation_id: str,
    *,
    misclassified_only: bool = False,
    limit: int | None = None,
) -> list[dict[str, Any]]:
    central_cases = cp.list_validation_cases(validation_id=validation_id)
    predictions = cp.load_case_predictions(validation_id)
    predictions_by_case_reference = {
        str(item.get("case_reference_id") or "").strip(): item
        for item in predictions
        if str(item.get("case_reference_id") or "").strip()
    }
    case_lookup = _case_reference_lookup(cp, site_store) if site_store is not None else {}
    rows: list[dict[str, Any]] = []
    source_rows = central_cases or predictions
    for prediction in source_rows:
        if misclassified_only and prediction.get("is_correct", False):
            continue
        case_reference_id = str(prediction.get("case_reference_id") or "").strip()
        file_prediction = predictions_by_case_reference.get(case_reference_id, {})
        resolved_case = case_lookup.get(case_reference_id, {})
        patient_id = str(file_prediction.get("patient_id") or resolved_case.get("patient_id") or "").strip()
        visit_date = str(file_prediction.get("visit_date") or resolved_case.get("visit_date") or "").strip()
        visit_images = (
            site_store.list_images_for_visit(patient_id, visit_date)
            if site_store is not None and patient_id and visit_date
            else []
        )
        representative = next((item for item in visit_images if item.get("is_representative")), None)
        if representative is None and visit_images:
            representative = visit_images[0]
        rows.append(
            {
                "validation_id": validation_id,
                "patient_reference_id": prediction.get("patient_reference_id") or resolved_case.get("patient_reference_id"),
                "case_reference_id": case_reference_id,
                "visit_index": prediction.get("visit_index", resolved_case.get("visit_index")),
                "patient_id": patient_id,
                "visit_date": visit_date,
                "true_label": prediction.get("true_label"),
                "predicted_label": prediction.get("predicted_label"),
                "prediction_probability": prediction.get("prediction_probability"),
                "is_correct": bool(prediction.get("is_correct", False)),
                "roi_crop_available": bool(
                    (file_prediction.get("roi_crop_path") and Path(file_prediction["roi_crop_path"]).exists())
                    or prediction.get("has_roi_crop")
                ),
                "gradcam_available": bool(
                    (file_prediction.get("gradcam_path") and Path(file_prediction["gradcam_path"]).exists())
                    or prediction.get("has_gradcam")
                ),
                "medsam_mask_available": bool(
                    (file_prediction.get("medsam_mask_path") and Path(file_prediction["medsam_mask_path"]).exists())
                    or prediction.get("has_medsam_mask")
                ),
                "representative_image_id": representative.get("image_id") if representative else None,
                "representative_view": representative.get("view") if representative else None,
            }
        )
    rows.sort(
        key=lambda item: (item.get("is_correct", False), float(item.get("prediction_probability") or 0.0)),
    )
    if limit is not None and limit >= 0:
        return rows[:limit]
    return rows


def build_case_history(
    cp: ControlPlaneStore,
    site_id: str,
    patient_id: str,
    visit_date: str,
) -> dict[str, list[dict[str, Any]]]:
    case_reference_id = cp.case_reference_id(site_id, patient_id, visit_date)
    validation_history: list[dict[str, Any]] = []
    case_rows = cp.list_validation_cases(site_id=site_id, case_reference_id=case_reference_id)
    if case_rows:
        for case_prediction in case_rows:
            validation_history.append(
                {
                    "validation_id": case_prediction.get("validation_id"),
                    "run_date": case_prediction.get("run_date"),
                    "model_version": case_prediction.get("model_version"),
                    "model_version_id": case_prediction.get("model_version_id"),
                    "model_architecture": None,
                    "run_scope": "case",
                    "predicted_label": case_prediction.get("predicted_label"),
                    "true_label": case_prediction.get("true_label"),
                    "prediction_probability": case_prediction.get("prediction_probability"),
                    "is_correct": case_prediction.get("is_correct"),
                    "visit_index": case_prediction.get("visit_index"),
                    "patient_reference_id": case_prediction.get("patient_reference_id"),
                }
            )
    else:
        for run in cp.list_validation_runs(site_id=site_id):
            case_prediction = next(
                (
                    item
                    for item in cp.load_case_predictions(run["validation_id"])
                    if item.get("case_reference_id") == case_reference_id
                    or (item.get("patient_id") == patient_id and item.get("visit_date") == visit_date)
                ),
                None,
            )
            if case_prediction is None:
                continue
            validation_history.append(
                {
                    "validation_id": run.get("validation_id"),
                    "run_date": run.get("run_date"),
                    "model_version": run.get("model_version"),
                    "model_version_id": run.get("model_version_id"),
                    "model_architecture": run.get("model_architecture"),
                    "run_scope": "case"
                    if run.get("case_reference_id") == case_reference_id
                    or (run.get("patient_id") == patient_id and run.get("visit_date") == visit_date)
                    else "site",
                    "predicted_label": case_prediction.get("predicted_label"),
                    "true_label": case_prediction.get("true_label"),
                    "prediction_probability": case_prediction.get("prediction_probability"),
                    "is_correct": case_prediction.get("is_correct"),
                }
            )

    updates_by_id = {
        item["update_id"]: item
        for item in cp.list_model_updates(site_id=site_id)
        if item.get("case_reference_id") == case_reference_id
    }
    contribution_history: list[dict[str, Any]] = []
    for item in cp.list_contributions(site_id=site_id):
        if item.get("case_reference_id") != case_reference_id:
            continue
        update = updates_by_id.get(item.get("update_id"))
        contribution_history.append(
            {
                "contribution_id": item.get("contribution_id"),
                "contribution_group_id": item.get("contribution_group_id"),
                "created_at": item.get("created_at"),
                "user_id": item.get("user_id"),
                "case_reference_id": item.get("case_reference_id"),
                "update_id": item.get("update_id"),
                "update_status": update.get("status") if update else None,
                "upload_type": update.get("upload_type") if update else None,
                "architecture": update.get("architecture") if update else None,
                "execution_device": update.get("execution_device") if update else None,
                "base_model_version_id": update.get("base_model_version_id") if update else None,
            }
        )

    return {
        "validations": validation_history,
        "contributions": contribution_history,
    }


def build_patient_trajectory(
    cp: ControlPlaneStore,
    site_id: str,
    patient_reference_id: str,
) -> dict[str, Any]:
    rows = cp.list_validation_cases(site_id=site_id, patient_reference_id=patient_reference_id)
    trajectory_by_visit: dict[int, list[dict[str, Any]]] = {}
    for row in rows:
        visit_index = int(row.get("visit_index") or 0)
        trajectory_by_visit.setdefault(visit_index, []).append(
            {
                "validation_id": row.get("validation_id"),
                "run_date": row.get("run_date"),
                "model_version": row.get("model_version"),
                "model_version_id": row.get("model_version_id"),
                "case_reference_id": row.get("case_reference_id"),
                "predicted_label": row.get("predicted_label"),
                "true_label": row.get("true_label"),
                "prediction_probability": row.get("prediction_probability"),
                "is_correct": row.get("is_correct"),
            }
        )
    ordered_trajectory = [
        {
            "visit_index": visit_index,
            "visit_label": visit_label_from_index(visit_index),
            "validations": items,
        }
        for visit_index, items in sorted(trajectory_by_visit.items())
    ]
    return {
        "patient_reference_id": patient_reference_id,
        "trajectory": ordered_trajectory,
    }


def build_site_activity(
    cp: ControlPlaneStore,
    site_id: str,
    *,
    is_pending_model_update: Callable[[dict[str, Any]], bool],
) -> dict[str, Any]:
    validation_runs = cp.list_validation_runs(site_id=site_id)
    contributions = cp.list_contributions(site_id=site_id)
    updates_by_id = {
        item.get("update_id"): item
        for item in cp.list_model_updates(site_id=site_id)
        if item.get("update_id")
    }
    pending_updates = len([item for item in updates_by_id.values() if is_pending_model_update(item)])

    recent_validations = [
        {
            "validation_id": item.get("validation_id"),
            "run_date": item.get("run_date"),
            "model_version": item.get("model_version"),
            "model_architecture": item.get("model_architecture"),
            "n_cases": item.get("n_cases"),
            "n_images": item.get("n_images"),
            "accuracy": item.get("accuracy"),
            "AUROC": item.get("AUROC"),
            "site_id": item.get("site_id"),
        }
        for item in validation_runs[:5]
    ]
    recent_contributions = []
    for item in contributions[:5]:
        update = updates_by_id.get(item.get("update_id"))
        recent_contributions.append(
            {
                "contribution_id": item.get("contribution_id"),
                "contribution_group_id": item.get("contribution_group_id"),
                "created_at": item.get("created_at"),
                "user_id": item.get("user_id"),
                "case_reference_id": item.get("case_reference_id"),
                "update_id": item.get("update_id"),
                "update_status": update.get("status") if update else None,
                "upload_type": update.get("upload_type") if update else None,
            }
        )

    return {
        "pending_updates": pending_updates,
        "recent_validations": recent_validations,
        "recent_contributions": recent_contributions,
    }
