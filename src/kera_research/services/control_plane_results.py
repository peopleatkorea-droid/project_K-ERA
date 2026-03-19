from __future__ import annotations

from pathlib import Path
from typing import Any

from sqlalchemy import delete, select, update

from kera_research.config import BASE_DIR, CONTROL_PLANE_CASE_DIR, CONTROL_PLANE_EXPERIMENT_DIR, CONTROL_PLANE_REPORT_DIR
from kera_research.db import CONTROL_PLANE_ENGINE, experiments, validation_cases, validation_runs
from kera_research.domain import utc_now
from kera_research.storage import read_json, write_json


class ControlPlaneResultsFacade:
    def __init__(self, store: Any) -> None:
        self.store = store

    def list_validation_runs(
        self,
        project_id: str | None = None,
        site_id: str | None = None,
    ) -> list[dict[str, Any]]:
        query = select(validation_runs)
        if project_id:
            query = query.where(validation_runs.c.project_id == project_id)
        if site_id:
            query = query.where(validation_runs.c.site_id == site_id)
        query = query.order_by(validation_runs.c.run_date.desc())
        with CONTROL_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(query).mappings().all()
        runs: list[dict[str, Any]] = []
        for row in rows:
            payload = dict(row["summary_json"] or {})
            payload["case_predictions_path"] = row["case_predictions_path"]
            runs.append(payload)
        return runs

    def list_validation_cases(
        self,
        *,
        validation_id: str | None = None,
        site_id: str | None = None,
        patient_reference_id: str | None = None,
        case_reference_id: str | None = None,
    ) -> list[dict[str, Any]]:
        query = select(validation_cases)
        if validation_id:
            query = query.where(validation_cases.c.validation_id == validation_id)
        if site_id:
            query = query.where(validation_cases.c.site_id == site_id)
        if patient_reference_id:
            query = query.where(validation_cases.c.patient_reference_id == patient_reference_id)
        if case_reference_id:
            query = query.where(validation_cases.c.case_reference_id == case_reference_id)
        query = query.order_by(
            validation_cases.c.visit_index.asc(),
            validation_cases.c.run_date.desc(),
            validation_cases.c.validation_case_id.asc(),
        )
        with CONTROL_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(query).mappings().all()
        merged_rows: list[dict[str, Any]] = []
        for row in rows:
            payload = dict(row.get("payload_json") or {})
            merged_rows.append(
                {
                    **payload,
                    **dict(row),
                }
            )
        return merged_rows

    def save_validation_run(
        self,
        summary: dict[str, Any],
        case_predictions: list[dict[str, Any]],
    ) -> dict[str, Any]:
        normalized_summary = self.store._normalize_validation_record(str(summary.get("site_id") or "").strip(), summary)
        normalized_predictions = [
            self.store._normalize_validation_record(str(summary.get("site_id") or "").strip(), prediction)
            for prediction in case_predictions
        ]
        case_path = CONTROL_PLANE_CASE_DIR / f"{summary['validation_id']}.json"
        write_json(case_path, normalized_predictions)
        report_path = CONTROL_PLANE_REPORT_DIR / f"{summary['validation_id']}.json"
        try:
            case_predictions_path = str(case_path.relative_to(BASE_DIR))
        except ValueError:
            case_predictions_path = str(case_path)
        payload = {
            **normalized_summary,
            "case_predictions_path": case_predictions_path,
        }
        try:
            payload["report_path"] = str(report_path.relative_to(BASE_DIR))
        except ValueError:
            payload["report_path"] = str(report_path)
        write_json(report_path, payload)
        record = {
            "validation_id": summary["validation_id"],
            "project_id": summary["project_id"],
            "site_id": summary["site_id"],
            "model_version": summary.get("model_version", ""),
            "run_date": summary.get("run_date", utc_now()),
            "n_cases": summary.get("n_cases"),
            "n_images": summary.get("n_images"),
            "AUROC": summary.get("AUROC"),
            "accuracy": summary.get("accuracy"),
            "sensitivity": summary.get("sensitivity"),
            "specificity": summary.get("specificity"),
            "F1": summary.get("F1"),
            "case_predictions_path": payload["case_predictions_path"],
            "summary_json": payload,
        }
        validation_case_records = [
            {
                "validation_case_id": f"{summary['validation_id']}::{prediction['case_reference_id']}",
                "validation_id": summary["validation_id"],
                "project_id": summary["project_id"],
                "site_id": summary["site_id"],
                "patient_reference_id": str(prediction.get("patient_reference_id") or ""),
                "case_reference_id": str(prediction.get("case_reference_id") or ""),
                "visit_index": int(prediction.get("visit_index") or 0),
                "model_version_id": summary.get("model_version_id"),
                "model_version": summary.get("model_version", ""),
                "run_date": summary.get("run_date", utc_now()),
                "true_label": prediction.get("true_label"),
                "predicted_label": str(prediction.get("predicted_label") or ""),
                "prediction_probability": float(prediction.get("prediction_probability") or 0.0),
                "is_correct": prediction.get("is_correct"),
                "n_source_images": prediction.get("n_source_images"),
                "crop_mode": prediction.get("crop_mode"),
                "has_gradcam": bool(
                    prediction.get("gradcam_path")
                    or prediction.get("gradcam_cornea_path")
                    or prediction.get("gradcam_lesion_path")
                ),
                "has_roi_crop": bool(prediction.get("roi_crop_path")),
                "has_medsam_mask": bool(prediction.get("medsam_mask_path")),
                "created_at": summary.get("run_date", utc_now()),
                "payload_json": prediction,
            }
            for prediction in normalized_predictions
            if str(prediction.get("case_reference_id") or "").strip()
            and str(prediction.get("patient_reference_id") or "").strip()
        ]
        with CONTROL_PLANE_ENGINE.begin() as conn:
            existing = conn.execute(
                select(validation_runs.c.validation_id).where(validation_runs.c.validation_id == summary["validation_id"])
            ).first()
            if existing:
                conn.execute(
                    update(validation_runs)
                    .where(validation_runs.c.validation_id == summary["validation_id"])
                    .values(**record)
                )
            else:
                conn.execute(validation_runs.insert().values(**record))
            conn.execute(delete(validation_cases).where(validation_cases.c.validation_id == summary["validation_id"]))
            if validation_case_records:
                conn.execute(validation_cases.insert(), validation_case_records)
        return payload

    def load_case_predictions(self, validation_id: str) -> list[dict[str, Any]]:
        case_path = CONTROL_PLANE_CASE_DIR / f"{validation_id}.json"
        saved = read_json(case_path, [])
        if isinstance(saved, list) and saved:
            return saved
        rows = self.list_validation_cases(validation_id=validation_id)
        return [
            {
                **dict(row.get("payload_json") or {}),
                "validation_id": row["validation_id"],
                "patient_reference_id": row["patient_reference_id"],
                "case_reference_id": row["case_reference_id"],
                "visit_index": row["visit_index"],
                "true_label": row.get("true_label"),
                "predicted_label": row.get("predicted_label"),
                "prediction_probability": row.get("prediction_probability"),
                "is_correct": row.get("is_correct"),
                "crop_mode": row.get("crop_mode"),
                "n_source_images": row.get("n_source_images"),
                "gradcam_path": None,
                "gradcam_cornea_path": None,
                "gradcam_cornea_heatmap_path": None,
                "gradcam_lesion_path": None,
                "gradcam_lesion_heatmap_path": None,
                "medsam_mask_path": None,
                "roi_crop_path": None,
                "lesion_mask_path": None,
                "lesion_crop_path": None,
            }
            for row in rows
        ]

    def update_validation_case_prediction(
        self,
        validation_id: str,
        *,
        case_reference_id: str,
        updates: dict[str, Any],
    ) -> dict[str, Any] | None:
        normalized_validation_id = str(validation_id or "").strip()
        normalized_case_reference_id = str(case_reference_id or "").strip()
        if not normalized_validation_id or not normalized_case_reference_id:
            return None

        case_path = CONTROL_PLANE_CASE_DIR / f"{normalized_validation_id}.json"
        saved_predictions = read_json(case_path, [])
        updated_prediction: dict[str, Any] | None = None
        rewritten_predictions: list[dict[str, Any]] = []
        for item in saved_predictions if isinstance(saved_predictions, list) else []:
            prediction = dict(item) if isinstance(item, dict) else {}
            if str(prediction.get("case_reference_id") or "").strip() == normalized_case_reference_id:
                prediction = {
                    **prediction,
                    **updates,
                }
                updated_prediction = prediction
            rewritten_predictions.append(prediction)
        if updated_prediction is not None:
            write_json(case_path, rewritten_predictions)

        with CONTROL_PLANE_ENGINE.begin() as conn:
            row = conn.execute(
                select(validation_cases).where(
                    validation_cases.c.validation_id == normalized_validation_id,
                    validation_cases.c.case_reference_id == normalized_case_reference_id,
                )
            ).mappings().first()
            if row is None:
                return updated_prediction
            merged_payload = {
                **dict(row.get("payload_json") or {}),
                **(updated_prediction or {}),
                **updates,
            }
            conn.execute(
                update(validation_cases)
                .where(
                    validation_cases.c.validation_id == normalized_validation_id,
                    validation_cases.c.case_reference_id == normalized_case_reference_id,
                )
                .values(
                    true_label=merged_payload.get("true_label"),
                    predicted_label=str(merged_payload.get("predicted_label") or ""),
                    prediction_probability=float(merged_payload.get("prediction_probability") or 0.0),
                    is_correct=merged_payload.get("is_correct"),
                    n_source_images=merged_payload.get("n_source_images"),
                    crop_mode=merged_payload.get("crop_mode"),
                    has_gradcam=bool(
                        merged_payload.get("gradcam_path")
                        or merged_payload.get("gradcam_cornea_path")
                        or merged_payload.get("gradcam_lesion_path")
                    ),
                    has_roi_crop=bool(merged_payload.get("roi_crop_path")),
                    has_medsam_mask=bool(merged_payload.get("medsam_mask_path")),
                    payload_json=merged_payload,
                )
            )
        return merged_payload

    def save_experiment(self, experiment_record: dict[str, Any]) -> dict[str, Any]:
        normalized = dict(experiment_record)
        normalized.setdefault("status", "completed")
        normalized.setdefault("created_at", utc_now())
        experiment_id = str(normalized.get("experiment_id") or "").strip()
        if not experiment_id:
            raise ValueError("experiment_id is required.")
        normalized["experiment_id"] = experiment_id

        report_path_value = str(normalized.get("report_path") or "").strip()
        if report_path_value:
            report_path = Path(report_path_value)
            if not report_path.is_absolute():
                report_path = (BASE_DIR / report_path).resolve()
            if not report_path.exists():
                experiment_report_path = CONTROL_PLANE_EXPERIMENT_DIR / f"{experiment_id}.json"
                write_json(experiment_report_path, normalized)
                normalized["report_path"] = str(experiment_report_path)
        else:
            experiment_report_path = CONTROL_PLANE_EXPERIMENT_DIR / f"{experiment_id}.json"
            write_json(experiment_report_path, normalized)
            normalized["report_path"] = str(experiment_report_path)

        values = {
            "experiment_id": experiment_id,
            "site_id": normalized.get("site_id"),
            "experiment_type": str(normalized.get("experiment_type") or "unknown"),
            "status": str(normalized.get("status") or "completed"),
            "model_version_id": normalized.get("model_version_id"),
            "created_at": normalized.get("created_at"),
            "payload_json": normalized,
        }
        with CONTROL_PLANE_ENGINE.begin() as conn:
            existing = conn.execute(
                select(experiments.c.experiment_id).where(experiments.c.experiment_id == experiment_id)
            ).first()
            if existing:
                conn.execute(update(experiments).where(experiments.c.experiment_id == experiment_id).values(**values))
            else:
                conn.execute(experiments.insert().values(**values))
        return normalized

    def get_experiment(self, experiment_id: str) -> dict[str, Any] | None:
        normalized_id = experiment_id.strip()
        if not normalized_id:
            return None
        with CONTROL_PLANE_ENGINE.begin() as conn:
            row = conn.execute(select(experiments).where(experiments.c.experiment_id == normalized_id)).first()
        if row is None:
            return None
        return self.store.payload_record(
            row,
            "payload_json",
            ["experiment_id", "site_id", "experiment_type", "status", "model_version_id", "created_at"],
        )

    def list_experiments(
        self,
        *,
        site_id: str | None = None,
        experiment_type: str | None = None,
        status_filter: str | None = None,
    ) -> list[dict[str, Any]]:
        query = select(experiments)
        if site_id:
            query = query.where(experiments.c.site_id == site_id)
        if experiment_type:
            query = query.where(experiments.c.experiment_type == experiment_type)
        if status_filter:
            query = query.where(experiments.c.status == status_filter)
        query = query.order_by(experiments.c.created_at.desc())
        with CONTROL_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(query).all()
        return [
            self.store.payload_record(
                row,
                "payload_json",
                ["experiment_id", "site_id", "experiment_type", "status", "model_version_id", "created_at"],
            )
            for row in rows
        ]
