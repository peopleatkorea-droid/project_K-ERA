from __future__ import annotations

from pathlib import Path
from typing import Any

from kera_research.config import DEFAULT_GLOBAL_MODELS
from kera_research.domain import (
    INDEX_TO_LABEL,
    LABEL_TO_INDEX,
    is_attention_mil_architecture,
    is_lesion_guided_fusion_architecture,
    lesion_guided_fusion_backbone,
    utc_now,
)
from kera_research.services.modeling_data import (
    DEFAULT_IMAGE_SIZE,
    _preprocess_signature_from_metadata,
)

try:
    import torch
except ImportError:  # pragma: no cover - dependency guard
    torch = None


def resolve_preprocess_metadata(
    manager: Any,
    model_reference: dict[str, Any] | None = None,
    checkpoint_metadata: dict[str, Any] | None = None,
    *,
    image_size: int = DEFAULT_IMAGE_SIZE,
) -> dict[str, Any]:
    for source in (checkpoint_metadata, model_reference):
        if not isinstance(source, dict):
            continue
        preprocess = source.get("preprocess")
        if isinstance(preprocess, dict):
            return dict(preprocess)

    for source in (checkpoint_metadata, model_reference):
        if not isinstance(source, dict):
            continue
        signature = str(source.get("preprocess_signature") or "").strip()
        if not signature:
            continue
        if signature == manager.legacy_preprocess_signature(image_size=image_size):
            return manager.legacy_preprocess_metadata(image_size=image_size)
        if signature == manager.preprocess_signature(image_size=image_size):
            return manager.preprocess_metadata(image_size=image_size)

    return manager.preprocess_metadata(image_size=image_size)


def model_preprocess_metadata(
    manager: Any,
    model: Any,
    model_reference: dict[str, Any] | None = None,
) -> dict[str, Any]:
    metadata = getattr(model, "_kera_preprocess_metadata", None)
    if isinstance(metadata, dict):
        return dict(metadata)
    return resolve_preprocess_metadata(manager, model_reference)


def build_artifact_metadata(
    manager: Any,
    *,
    architecture: str,
    artifact_type: str = "model",
    crop_mode: str | None = None,
    case_aggregation: str | None = None,
    bag_level: bool | None = None,
    training_input_policy: str | None = None,
    image_size: int = DEFAULT_IMAGE_SIZE,
    num_classes: int = 2,
    preprocess_metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    resolved_preprocess = (
        dict(preprocess_metadata)
        if isinstance(preprocess_metadata, dict)
        else manager.preprocess_metadata(image_size=image_size)
    )
    metadata = {
        "artifact_format": "kera_model_artifact_v1",
        "artifact_type": artifact_type,
        "architecture": architecture,
        "num_classes": int(num_classes),
        "label_schema": {
            "index_to_label": {str(key): value for key, value in INDEX_TO_LABEL.items()},
            "label_to_index": LABEL_TO_INDEX,
        },
        "preprocess": resolved_preprocess,
        "preprocess_signature": _preprocess_signature_from_metadata(resolved_preprocess),
        "saved_at": utc_now(),
    }
    if crop_mode is not None:
        metadata["crop_mode"] = str(crop_mode)
    if case_aggregation is not None:
        metadata["case_aggregation"] = str(case_aggregation)
    if bag_level is not None:
        metadata["bag_level"] = bool(bag_level)
    if training_input_policy is not None:
        metadata["training_input_policy"] = str(training_input_policy)
    if is_lesion_guided_fusion_architecture(architecture):
        metadata["architecture_family"] = "lesion_guided_fusion"
        metadata["backbone"] = lesion_guided_fusion_backbone(architecture)
    return metadata


def checkpoint_metadata(checkpoint: Any) -> dict[str, Any]:
    if not isinstance(checkpoint, dict):
        return {}
    metadata = checkpoint.get("artifact_metadata")
    return dict(metadata) if isinstance(metadata, dict) else {}


def validate_model_artifact(
    manager: Any,
    model_reference: dict[str, Any],
    checkpoint: Any,
    *,
    default_num_classes: int,
) -> dict[str, Any]:
    architecture = str(model_reference.get("architecture") or "densenet121")
    metadata = checkpoint_metadata(checkpoint)
    checkpoint_architecture = str((metadata.get("architecture") or checkpoint.get("architecture") or "")).strip()
    if checkpoint_architecture and checkpoint_architecture != architecture:
        raise ValueError(
            f"Checkpoint architecture mismatch: expected {architecture}, found {checkpoint_architecture}."
        )

    expected_num_classes = int(model_reference.get("num_classes") or default_num_classes)
    checkpoint_num_classes = metadata.get("num_classes")
    if checkpoint_num_classes is not None and int(checkpoint_num_classes) != expected_num_classes:
        raise ValueError(
            f"Checkpoint class count mismatch: expected {expected_num_classes}, found {checkpoint_num_classes}."
        )

    expected_policy = str(model_reference.get("training_input_policy") or "").strip()
    checkpoint_policy = str(metadata.get("training_input_policy") or "").strip()
    if expected_policy and checkpoint_policy and checkpoint_policy != expected_policy:
        raise ValueError(
            f"Checkpoint input policy mismatch: expected {expected_policy}, found {checkpoint_policy}."
        )

    expected_crop_mode = str(model_reference.get("crop_mode") or "").strip()
    checkpoint_crop_mode = str(metadata.get("crop_mode") or "").strip()
    if expected_crop_mode and checkpoint_crop_mode and checkpoint_crop_mode != expected_crop_mode:
        raise ValueError(
            f"Checkpoint crop mode mismatch: expected {expected_crop_mode}, found {checkpoint_crop_mode}."
        )

    expected_signature = str(
        model_reference.get("preprocess_signature") or manager.preprocess_signature()
    ).strip()
    checkpoint_signature = str(metadata.get("preprocess_signature") or "").strip()
    if checkpoint_signature and checkpoint_signature != expected_signature:
        raise ValueError(
            f"Checkpoint preprocess signature mismatch: expected {expected_signature}, found {checkpoint_signature}."
        )

    return metadata


def baseline_model_settings(manager: Any, template: dict[str, Any]) -> dict[str, Any]:
    architecture = str(template.get("architecture") or "").strip().lower()
    requires_medsam_crop = bool(template.get("requires_medsam_crop", False))
    crop_mode = str(template.get("crop_mode") or "").strip().lower()
    if not crop_mode:
        crop_mode = "automated" if requires_medsam_crop else "raw"
    case_aggregation = str(template.get("case_aggregation") or "").strip()
    if not case_aggregation:
        case_aggregation = manager.normalize_case_aggregation(None, architecture)
    bag_level_value = template.get("bag_level")
    bag_level = (
        bool(bag_level_value)
        if bag_level_value is not None
        else is_attention_mil_architecture(architecture)
    )
    training_input_policy = str(template.get("training_input_policy") or "").strip()
    if not training_input_policy:
        if crop_mode == "manual":
            training_input_policy = "medsam_lesion_crop_only"
        elif crop_mode == "paired":
            training_input_policy = "medsam_cornea_plus_lesion_paired_fusion"
        elif requires_medsam_crop or crop_mode in {"automated", "both"}:
            training_input_policy = "medsam_cornea_crop_only"
        else:
            training_input_policy = "raw_or_model_defined"
    return {
        "architecture": architecture,
        "requires_medsam_crop": requires_medsam_crop,
        "crop_mode": crop_mode,
        "case_aggregation": case_aggregation,
        "bag_level": bag_level,
        "training_input_policy": training_input_policy,
    }


def ensure_baseline_models(
    manager: Any,
    *,
    default_num_classes: int,
) -> list[dict[str, Any]]:
    if torch is None:
        raise RuntimeError("PyTorch is required for model inference and training.")
    baselines: list[dict[str, Any]] = []
    for template in DEFAULT_GLOBAL_MODELS:
        baseline_settings = baseline_model_settings(manager, template)
        model_path = Path(template["model_path"])
        checkpoint_metadata_payload: dict[str, Any] = {}
        if not model_path.exists():
            model_path.parent.mkdir(parents=True, exist_ok=True)
            model = manager.build_model_pretrained(template["architecture"])
            checkpoint_metadata_payload = build_artifact_metadata(
                manager,
                architecture=template["architecture"],
                crop_mode=baseline_settings["crop_mode"],
                case_aggregation=baseline_settings["case_aggregation"],
                bag_level=baseline_settings["bag_level"],
                training_input_policy=baseline_settings["training_input_policy"],
                num_classes=default_num_classes,
            )
            torch.save(
                {
                    "architecture": template["architecture"],
                    "state_dict": model.state_dict(),
                    "artifact_metadata": checkpoint_metadata_payload,
                },
                model_path,
            )
        else:
            try:
                checkpoint = torch.load(model_path, map_location="cpu", weights_only=True)
                checkpoint_metadata_payload = checkpoint_metadata(checkpoint)
            except Exception:
                checkpoint_metadata_payload = {}
        resolved_preprocess = resolve_preprocess_metadata(
            manager,
            template,
            checkpoint_metadata_payload,
        )
        resolved_signature = (
            str(checkpoint_metadata_payload.get("preprocess_signature") or "").strip()
            or _preprocess_signature_from_metadata(resolved_preprocess)
        )
        sha256_value = manager.artifact_store.sha256_file(model_path)
        baselines.append(
            {
                "version_id": template["version_id"],
                "version_name": template["version_name"],
                "model_name": "keratitis_cls",
                "architecture": template["architecture"],
                "stage": "global",
                "base_version_id": None,
                "model_path": str(model_path),
                "filename": model_path.name,
                "sha256": sha256_value,
                "size_bytes": int(model_path.stat().st_size),
                "source_provider": "local",
                "requires_medsam_crop": baseline_settings["requires_medsam_crop"],
                "crop_mode": baseline_settings["crop_mode"],
                "case_aggregation": baseline_settings["case_aggregation"],
                "bag_level": baseline_settings["bag_level"],
                "training_input_policy": baseline_settings["training_input_policy"],
                "preprocess": resolved_preprocess,
                "preprocess_signature": resolved_signature,
                "num_classes": int(default_num_classes),
                "decision_threshold": 0.5,
                "threshold_selection_metric": "default",
                "is_current": template.get("is_current", False),
                "created_at": utc_now(),
                "notes": template["notes"],
                "notes_ko": template.get("notes_ko", template["notes"]),
                "notes_en": template.get("notes_en", template["notes"]),
                "ready": True,
            }
        )
    return baselines
