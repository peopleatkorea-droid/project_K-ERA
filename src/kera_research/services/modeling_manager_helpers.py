from __future__ import annotations

from typing import Any

from kera_research.domain import DENSENET_VARIANTS

_GRADCAM_ARCHITECTURES = {
    "cnn",
    "vit",
    "swin",
    "convnext_tiny",
    "efficientnet_v2_s",
    "dinov2",
    "dinov2_mil",
    "swin_mil",
    "dual_input_concat",
}


def supports_gradcam(is_lesion_guided_fusion_architecture: Any, architecture: str | None) -> bool:
    normalized = str(architecture or "").strip().lower()
    if normalized in DENSENET_VARIANTS:
        return True
    return normalized in _GRADCAM_ARCHITECTURES or is_lesion_guided_fusion_architecture(normalized)


def preprocess_metadata(imagenet_preprocess_metadata: Any, *, image_size: int) -> dict[str, Any]:
    return imagenet_preprocess_metadata(image_size=image_size)


def legacy_preprocess_metadata(
    legacy_preprocess_metadata_impl: Any,
    *,
    image_size: int,
) -> dict[str, Any]:
    return legacy_preprocess_metadata_impl(image_size=image_size)


def preprocess_signature(
    preprocess_signature_from_metadata: Any,
    preprocess_metadata_value: dict[str, Any],
) -> str:
    return preprocess_signature_from_metadata(preprocess_metadata_value)


def resolve_model_reference(
    artifact_store: Any,
    model_reference: dict[str, Any],
    *,
    allow_download: bool | None = None,
) -> dict[str, Any]:
    return artifact_store.resolve_model_reference(
        model_reference,
        allow_download=allow_download,
    )


def resolve_model_path(
    artifact_store: Any,
    model_reference: dict[str, Any],
    *,
    allow_download: bool | None = None,
) -> str:
    return str(
        artifact_store.resolve_model_path(
            model_reference,
            allow_download=allow_download,
        )
    )
