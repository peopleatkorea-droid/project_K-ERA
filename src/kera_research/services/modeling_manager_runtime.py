from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

import numpy as np

from kera_research.services.modeling_gradcam import (
    cam_array_from_tensors as _cam_array_from_tensors_impl,
    classifier_module as _classifier_module_impl,
    dinov2_gradcam_projection as _dinov2_gradcam_projection_impl,
    generate_cam_artifacts_from_layer as _generate_cam_artifacts_from_layer_impl,
    generate_cam_from_layer as _generate_cam_from_layer_impl,
    generate_explanation as _generate_explanation_impl,
    generate_explanation_artifacts as _generate_explanation_artifacts_impl,
    generate_paired_cam_artifacts_from_layer as _generate_paired_cam_artifacts_from_layer_impl,
    generate_paired_explanation_artifacts as _generate_paired_explanation_artifacts_impl,
    gradcam_target_layer as _gradcam_target_layer_impl,
    normalize_cam_feature_map as _normalize_cam_feature_map_impl,
    overlay_heatmap as _overlay_heatmap_impl,
)
from kera_research.services.modeling_runtime import (
    extract_image_embedding as _extract_image_embedding_impl,
    extract_paired_image_embedding as _extract_paired_image_embedding_impl,
    extract_state_dict_from_checkpoint as _extract_state_dict_from_checkpoint_impl,
    load_model as _load_model_impl,
    predict_image as _predict_image_impl,
    predict_paired_image as _predict_paired_image_impl,
)

try:
    import torch
    from torch import nn
except ImportError:  # pragma: no cover - dependency guard
    torch = None
    nn = None

if TYPE_CHECKING:
    from kera_research.services.modeling import Prediction


class ModelManagerRuntimeMixin:
    def load_model(self, model_reference: dict[str, Any], device: str) -> nn.Module:
        return _load_model_impl(self, model_reference, device)

    def _extract_state_dict_from_checkpoint(self, checkpoint: Any, architecture: str) -> dict[str, Any]:
        return _extract_state_dict_from_checkpoint_impl(self, checkpoint, architecture)

    def predict_image(self, model: nn.Module, image_path: str | Path, device: str) -> Prediction:
        return _predict_image_impl(self, model, image_path, device)

    def predict_paired_image(
        self,
        model: nn.Module,
        model_reference: dict[str, Any],
        cornea_image_path: str | Path,
        lesion_image_path: str | Path,
        lesion_mask_path: str | Path | None,
        device: str,
    ) -> Prediction:
        return _predict_paired_image_impl(
            self,
            model,
            model_reference,
            cornea_image_path,
            lesion_image_path,
            lesion_mask_path,
            device,
        )

    def extract_image_embedding(
        self,
        model: nn.Module,
        model_reference: dict[str, Any],
        image_path: str | Path,
        device: str,
    ) -> np.ndarray:
        return _extract_image_embedding_impl(
            self,
            model,
            model_reference,
            image_path,
            device,
        )

    def extract_paired_image_embedding(
        self,
        model: nn.Module,
        model_reference: dict[str, Any],
        cornea_image_path: str | Path,
        lesion_image_path: str | Path,
        lesion_mask_path: str | Path | None,
        device: str,
    ) -> np.ndarray:
        return _extract_paired_image_embedding_impl(
            self,
            model,
            model_reference,
            cornea_image_path,
            lesion_image_path,
            lesion_mask_path,
            device,
        )

    def generate_explanation(
        self,
        model: nn.Module,
        model_reference: dict[str, Any],
        image_path: str | Path,
        device: str,
        output_path: str | Path,
        target_class: int | None = None,
    ) -> str:
        return _generate_explanation_impl(
            self,
            model,
            model_reference,
            image_path,
            device,
            output_path,
            target_class=target_class,
        )

    def generate_explanation_artifacts(
        self,
        model: nn.Module,
        model_reference: dict[str, Any],
        image_path: str | Path,
        device: str,
        output_path: str | Path,
        target_class: int | None = None,
        heatmap_output_path: str | Path | None = None,
    ) -> dict[str, str]:
        return _generate_explanation_artifacts_impl(
            self,
            model,
            model_reference,
            image_path,
            device,
            output_path,
            target_class=target_class,
            heatmap_output_path=heatmap_output_path,
        )

    def generate_paired_explanation_artifacts(
        self,
        model: nn.Module,
        model_reference: dict[str, Any],
        *,
        cornea_image_path: str | Path,
        lesion_image_path: str | Path,
        lesion_mask_path: str | Path | None,
        device: str,
        cornea_output_path: str | Path,
        lesion_output_path: str | Path,
        target_class: int | None = None,
        cornea_heatmap_output_path: str | Path | None = None,
        lesion_heatmap_output_path: str | Path | None = None,
    ) -> dict[str, str]:
        return _generate_paired_explanation_artifacts_impl(
            self,
            model,
            model_reference,
            cornea_image_path=cornea_image_path,
            lesion_image_path=lesion_image_path,
            lesion_mask_path=lesion_mask_path,
            device=device,
            cornea_output_path=cornea_output_path,
            lesion_output_path=lesion_output_path,
            target_class=target_class,
            cornea_heatmap_output_path=cornea_heatmap_output_path,
            lesion_heatmap_output_path=lesion_heatmap_output_path,
        )

    def _classifier_module(self, model: nn.Module, architecture: str) -> nn.Module:
        return _classifier_module_impl(self, model, architecture)

    def _gradcam_target_layer(self, model: nn.Module, architecture: str) -> nn.Module:
        return _gradcam_target_layer_impl(self, model, architecture)

    def _dinov2_gradcam_projection(self, model: nn.Module, label: str) -> nn.Module:
        return _dinov2_gradcam_projection_impl(self, model, label)

    def _normalize_cam_feature_map(self, tensor: torch.Tensor) -> torch.Tensor:
        return _normalize_cam_feature_map_impl(self, tensor)

    def _cam_array_from_tensors(
        self,
        activation_tensor: torch.Tensor,
        gradient_tensor: torch.Tensor,
    ) -> np.ndarray:
        return _cam_array_from_tensors_impl(self, activation_tensor, gradient_tensor)

    def _generate_cam_from_layer(
        self,
        model: nn.Module,
        preprocess_metadata: dict[str, Any] | None,
        image_path: str | Path,
        device: str,
        output_path: str | Path,
        target_layer: nn.Module,
        target_class: int | None = None,
    ) -> str:
        return _generate_cam_from_layer_impl(
            self,
            model,
            preprocess_metadata,
            image_path,
            device,
            output_path,
            target_layer,
            target_class=target_class,
        )["overlay_path"]

    def _generate_cam_artifacts_from_layer(
        self,
        model: nn.Module,
        preprocess_metadata: dict[str, Any] | None,
        image_path: str | Path,
        device: str,
        output_path: str | Path,
        heatmap_output_path: str | Path | None,
        target_layer: nn.Module,
        target_class: int | None = None,
    ) -> dict[str, str]:
        return _generate_cam_artifacts_from_layer_impl(
            self,
            model=model,
            preprocess_metadata=preprocess_metadata,
            image_path=image_path,
            device=device,
            output_path=output_path,
            heatmap_output_path=heatmap_output_path,
            target_layer=target_layer,
            target_class=target_class,
        )

    def _generate_paired_cam_artifacts_from_layer(
        self,
        *,
        model: nn.Module,
        preprocess_metadata: dict[str, Any] | None,
        cornea_image_path: str | Path,
        lesion_image_path: str | Path,
        lesion_mask_path: str | Path | None,
        device: str,
        cornea_output_path: str | Path,
        lesion_output_path: str | Path,
        cornea_heatmap_output_path: str | Path | None,
        lesion_heatmap_output_path: str | Path | None,
        target_layer: nn.Module,
        target_class: int | None = None,
    ) -> dict[str, str]:
        return _generate_paired_cam_artifacts_from_layer_impl(
            self,
            model=model,
            preprocess_metadata=preprocess_metadata,
            cornea_image_path=cornea_image_path,
            lesion_image_path=lesion_image_path,
            lesion_mask_path=lesion_mask_path,
            device=device,
            cornea_output_path=cornea_output_path,
            lesion_output_path=lesion_output_path,
            cornea_heatmap_output_path=cornea_heatmap_output_path,
            lesion_heatmap_output_path=lesion_heatmap_output_path,
            target_layer=target_layer,
            target_class=target_class,
        )

    def _overlay_heatmap(self, original_array: np.ndarray, heatmap: np.ndarray) -> np.ndarray:
        return _overlay_heatmap_impl(self, original_array, heatmap)
