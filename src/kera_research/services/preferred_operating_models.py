from __future__ import annotations

import json
from pathlib import Path
from typing import Any


ROOT_DIR = Path(__file__).resolve().parents[3]
PREFERRED_OPERATING_MODELS_PATH = ROOT_DIR / "src" / "kera_research" / "preferred_operating_models.json"


def _read_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def preferred_operating_model_versions() -> list[dict[str, Any]]:
    manifest = _read_json(PREFERRED_OPERATING_MODELS_PATH)
    raw_models = manifest.get("models") if isinstance(manifest.get("models"), list) else []
    versions: list[dict[str, Any]] = []

    for raw_model in raw_models:
        if not isinstance(raw_model, dict):
            continue
        relative_model_path = str(raw_model.get("relative_model_path") or "").strip()
        if not relative_model_path:
            continue

        model_path = (ROOT_DIR / relative_model_path).resolve()
        if not model_path.exists():
            continue

        result_payload: dict[str, Any] = {}
        relative_result_path = str(raw_model.get("relative_result_path") or "").strip()
        if relative_result_path:
            result_path = (ROOT_DIR / relative_result_path).resolve()
            if result_path.exists():
                result_payload = _read_json(result_path)

        result_record = result_payload.get("result") if isinstance(result_payload.get("result"), dict) else {}
        threshold_metrics = (
            result_record.get("threshold_selection_metrics")
            if isinstance(result_record.get("threshold_selection_metrics"), dict)
            else {}
        )
        patient_split = result_record.get("patient_split") if isinstance(result_record.get("patient_split"), dict) else {}
        created_at = (
            str(result_record.get("created_at") or "").strip()
            or str(patient_split.get("updated_at") or "").strip()
            or str(patient_split.get("created_at") or "").strip()
        )
        if not created_at:
            created_at = "2026-04-08T00:00:00+00:00"

        record = {
            "version_id": str(raw_model.get("version_id") or "").strip(),
            "version_name": str(raw_model.get("version_name") or "").strip(),
            "model_name": "keratitis_cls",
            "architecture": str(raw_model.get("architecture") or "").strip(),
            "stage": "global",
            "base_version_id": None,
            "model_path": str(model_path),
            "requires_medsam_crop": bool(raw_model.get("requires_medsam_crop", False)),
            "crop_mode": str(raw_model.get("crop_mode") or "").strip() or None,
            "case_aggregation": str(raw_model.get("case_aggregation") or "").strip() or None,
            "bag_level": bool(raw_model.get("bag_level", False)),
            "training_input_policy": str(raw_model.get("training_input_policy") or "").strip() or None,
            "decision_threshold": float(result_record.get("decision_threshold", 0.5)),
            "threshold_selection_metric": str(result_record.get("threshold_selection_metric") or "").strip() or "balanced_accuracy",
            "threshold_selection_metrics": threshold_metrics,
            "created_at": created_at,
            "is_current": bool(raw_model.get("is_current", False)),
            "notes": str(raw_model.get("notes") or "").strip(),
            "notes_ko": str(raw_model.get("notes_ko") or raw_model.get("notes") or "").strip(),
            "notes_en": str(raw_model.get("notes_en") or raw_model.get("notes") or "").strip(),
            "ready": True,
        }
        versions.append(record)

    return [
        item
        for item in versions
        if str(item.get("version_id") or "").strip()
        and str(item.get("version_name") or "").strip()
        and str(item.get("architecture") or "").strip()
        and str(item.get("model_path") or "").strip()
    ]
