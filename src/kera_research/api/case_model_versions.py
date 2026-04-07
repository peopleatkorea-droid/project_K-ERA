from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any, Callable

from kera_research.domain import is_dual_input_training_architecture

_PREFERRED_ANALYSIS_MODEL_PATTERNS = (
    "efficientnet_v2_s_mil_full",
    "efficientnetv2-s mil",
    "efficientnet_v2_s_mil",
)


def _preferred_operating_model(versions: list[dict[str, Any]]) -> dict[str, Any] | None:
    ready_versions = [item for item in versions if item.get("ready", True)]
    if not ready_versions:
        return None
    for pattern in _PREFERRED_ANALYSIS_MODEL_PATTERNS:
        match = next(
            (
                item
                for item in ready_versions
                if pattern
                in " ".join(
                    [
                        str(item.get("version_id") or "").strip().lower(),
                        str(item.get("version_name") or "").strip().lower(),
                        str(item.get("architecture") or "").strip().lower(),
                    ]
                )
            ),
            None,
        )
        if match is not None:
            return match
    current_versions = [item for item in ready_versions if item.get("is_current")]
    if current_versions:
        return sorted(current_versions, key=lambda item: item.get("created_at", ""))[-1]
    return sorted(ready_versions, key=lambda item: item.get("created_at", ""))[-1]


def resolve_model_crop_mode(model_version: dict[str, Any]) -> str:
    if model_version.get("ensemble_mode") == "weighted_average":
        crop_mode = str(model_version.get("crop_mode") or "").strip().lower()
        if crop_mode in {"automated", "manual", "both", "paired"}:
            return crop_mode
        return "both"
    crop_mode = str(model_version.get("crop_mode") or "").strip().lower()
    if crop_mode in {"automated", "manual", "both", "paired"}:
        return crop_mode
    if is_dual_input_training_architecture(str(model_version.get("architecture") or "").strip().lower()):
        return "paired"
    return "automated" if model_version.get("requires_medsam_crop", False) else "raw"


def resolve_requested_model_version(
    cp: Any,
    *,
    get_model_version: Callable[[Any, str | None], dict[str, Any] | None],
    model_version_id: str | None,
    model_version_ids: list[str] | None,
) -> dict[str, Any] | None:
    ready_versions = [item for item in cp.list_model_versions() if item.get("ready", True)]
    normalized_ids = list(dict.fromkeys(str(item).strip() for item in (model_version_ids or []) if str(item).strip()))
    if normalized_ids:
        versions_by_id = {
            str(item.get("version_id") or ""): item
            for item in ready_versions
        }
        components: list[dict[str, Any]] = []
        missing_ids: list[str] = []
        for version_id in normalized_ids:
            component = versions_by_id.get(version_id)
            if component is None:
                missing_ids.append(version_id)
            else:
                components.append(component)
        if missing_ids:
            raise ValueError(f"Unknown or unavailable model version(s): {', '.join(missing_ids)}")
        if len(components) == 1:
            return components[0]

        sorted_component_ids = sorted(str(item.get("version_id") or "") for item in components)
        ensemble_suffix = hashlib.sha1("|".join(sorted_component_ids).encode("utf-8")).hexdigest()[:12]
        threshold_values: list[float] = []
        for component in components:
            try:
                threshold_values.append(float(component.get("decision_threshold")))
            except (TypeError, ValueError):
                continue
        crop_modes = {resolve_model_crop_mode(component) for component in components}
        ensemble_crop_mode = next(iter(crop_modes)) if len(crop_modes) == 1 else "both"
        component_weight = round(1.0 / max(len(components), 1), 6)
        created_at = max(
            (str(item.get("created_at") or "") for item in components),
            default=datetime.now(timezone.utc).isoformat(),
        )
        ensemble_record = {
            "version_id": f"analysis_ensemble_{ensemble_suffix}",
            "version_name": f"analysis-latest-{len(components)}-{ensemble_suffix}",
            "model_name": "keratitis_cls",
            "architecture": "multi_model_ensemble",
            "stage": "analysis",
            "model_path": "",
            "requires_medsam_crop": any(bool(item.get("requires_medsam_crop", False)) for item in components),
            "crop_mode": ensemble_crop_mode,
            "ensemble_mode": "weighted_average",
            "component_model_version_ids": sorted_component_ids,
            "ensemble_weights": {component_id: component_weight for component_id in sorted_component_ids},
            "preprocess_signature": next(
                (item.get("preprocess_signature") for item in components if item.get("preprocess_signature")),
                None,
            ),
            "num_classes": next((item.get("num_classes") for item in components if item.get("num_classes")), 2),
            "decision_threshold": sum(threshold_values) / len(threshold_values) if threshold_values else 0.5,
            "threshold_selection_metric": "component_threshold_mean",
            "threshold_selection_metrics": {
                "component_version_ids": sorted_component_ids,
                "component_thresholds": threshold_values,
                "weighting": "uniform",
            },
            "created_at": created_at,
            "ready": True,
            "is_current": False,
            "notes": f"Temporary analysis ensemble across {len(components)} model versions.",
            "notes_ko": f"{len(components)}媛?紐⑤뜽 踰꾩쟾??臾띠? ?꾩떆 遺꾩꽍 ensemble?낅땲??",
            "notes_en": f"Temporary analysis ensemble across {len(components)} model versions.",
        }
        return cp.ensure_model_version(ensemble_record)
    if model_version_id:
        return get_model_version(cp, model_version_id)
    return _preferred_operating_model(ready_versions)


def resolve_requested_contribution_models(
    cp: Any,
    *,
    get_model_version: Callable[[Any, str | None], dict[str, Any] | None],
    model_version_id: str | None,
    model_version_ids: list[str] | None,
) -> list[dict[str, Any]]:
    ready_versions = [item for item in cp.list_model_versions() if item.get("ready", True)]
    versions_by_id = {
        str(item.get("version_id") or ""): item
        for item in ready_versions
    }

    def expand_contribution_model(model_version: dict[str, Any]) -> list[dict[str, Any]]:
        if model_version.get("ensemble_mode") != "weighted_average":
            return [model_version]
        component_ids = [str(item).strip() for item in model_version.get("component_model_version_ids") or [] if str(item).strip()]
        components = [versions_by_id[component_id] for component_id in component_ids if component_id in versions_by_id]
        if not components:
            raise ValueError(
                f"Contribution base models are missing for ensemble {model_version.get('version_name') or model_version.get('version_id')}."
            )
        if str(model_version.get("architecture") or "") == "multi_model_ensemble":
            return components
        automated_component = next(
            (
                component
                for component in components
                if component.get("ensemble_mode") != "weighted_average" and resolve_model_crop_mode(component) == "automated"
            ),
            None,
        )
        if automated_component is not None:
            return [automated_component]
        base_component = next((component for component in components if component.get("ensemble_mode") != "weighted_average"), None)
        return [base_component or components[0]]

    requested_ids = list(dict.fromkeys(str(item).strip() for item in (model_version_ids or []) if str(item).strip()))
    if requested_ids:
        requested_models: list[dict[str, Any]] = []
        missing_ids: list[str] = []
        for version_id in requested_ids:
            model_version = versions_by_id.get(version_id)
            if model_version is None:
                missing_ids.append(version_id)
            else:
                requested_models.append(model_version)
        if missing_ids:
            raise ValueError(f"Unknown or unavailable model version(s): {', '.join(missing_ids)}")
    else:
        single_model = get_model_version(cp, model_version_id) if model_version_id else _preferred_operating_model(ready_versions)
        if single_model is None or not single_model.get("ready", True):
            raise ValueError("No ready model version is available for contribution.")
        requested_models = [single_model]

    expanded_models: list[dict[str, Any]] = []
    seen_version_ids: set[str] = set()
    for requested_model in requested_models:
        for expanded_model in expand_contribution_model(requested_model):
            version_id = str(expanded_model.get("version_id") or "").strip()
            if not version_id or version_id in seen_version_ids:
                continue
            seen_version_ids.add(version_id)
            expanded_models.append(expanded_model)
    if not expanded_models:
        raise ValueError("No contribution-ready model version is available.")
    return expanded_models


def serialize_case_model_version(model_version: dict[str, Any]) -> dict[str, Any]:
    return {
        "version_id": model_version.get("version_id"),
        "version_name": model_version.get("version_name"),
        "architecture": model_version.get("architecture"),
        "requires_medsam_crop": bool(model_version.get("requires_medsam_crop", False)),
        "crop_mode": model_version.get("crop_mode"),
        "case_aggregation": model_version.get("case_aggregation"),
        "bag_level": bool(model_version.get("bag_level", False)),
        "ensemble_mode": model_version.get("ensemble_mode"),
        "component_model_version_ids": list(model_version.get("component_model_version_ids") or []),
    }


def serialize_case_artifact_availability(case_prediction: dict[str, Any] | None) -> dict[str, bool]:
    return {
        "gradcam": bool(
            case_prediction
            and (
                case_prediction.get("gradcam_path")
                or case_prediction.get("gradcam_cornea_path")
                or case_prediction.get("gradcam_lesion_path")
            )
        ),
        "gradcam_cornea": bool(case_prediction and case_prediction.get("gradcam_cornea_path")),
        "gradcam_lesion": bool(case_prediction and case_prediction.get("gradcam_lesion_path")),
        "roi_crop": bool(case_prediction and case_prediction.get("roi_crop_path")),
        "medsam_mask": bool(case_prediction and case_prediction.get("medsam_mask_path")),
        "lesion_crop": bool(case_prediction and case_prediction.get("lesion_crop_path")),
        "lesion_mask": bool(case_prediction and case_prediction.get("lesion_mask_path")),
    }
