from __future__ import annotations

import math
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from kera_research.domain import (
    DENSENET_VARIANTS,
    LABEL_TO_INDEX,
    LESION_GUIDED_FUSION_ARCHITECTURES,
    is_attention_mil_architecture,
    is_dual_input_training_architecture,
    is_lesion_guided_fusion_architecture,
    is_paired_attention_mil_architecture,
    is_three_scale_lesion_guided_fusion_architecture,
)
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
from kera_research.services.modeling_data import (
    DEFAULT_IMAGE_SIZE,
    ManifestImageDataset,
    PairedCropDataset,
    ThreeScaleLesionGuidedFusionDataset,
    VisitBagDataset,
    VisitPairedBagDataset,
    _apply_preprocess_to_tensor,
    _augment_cornea_tensor_and_mask,
    _augment_tensor,
    _extract_medium_crop_tensor,
    _imagenet_preprocess_metadata,
    _legacy_preprocess_metadata,
    _load_image_tensor,
    _load_mask_tensor,
    _normalize_view,
    _preprocess_image_size,
    _preprocess_signature_from_metadata,
    collate_visit_bags,
    collate_visit_paired_bags,
    preprocess_image,
)
from kera_research.services.modeling_evaluation import (
    bag_forward as _bag_forward_impl,
    bag_inputs_to_device as _bag_inputs_to_device_impl,
    build_patient_split as _build_patient_split_impl,
    build_prediction_records as _build_prediction_records_impl,
    classification_metrics as _classification_metrics_impl,
    collect_bag_loader_outputs as _collect_bag_loader_outputs_impl,
    collect_loader_outputs as _collect_loader_outputs_impl,
    collect_paired_loader_outputs as _collect_paired_loader_outputs_impl,
    evaluate_loader as _evaluate_loader_impl,
    evaluate_paired_loader as _evaluate_paired_loader_impl,
    image_prediction_rows_from_records as _image_prediction_rows_from_records_impl,
    normalize_case_aggregation as _normalize_case_aggregation_impl,
    paired_forward_from_batch as _paired_forward_from_batch_impl,
    predicted_labels_from_threshold as _predicted_labels_from_threshold_impl,
    select_decision_threshold as _select_decision_threshold_impl,
    split_ids_with_fallback as _split_ids_with_fallback_impl,
    visit_prediction_rows_from_records as _visit_prediction_rows_from_records_impl,
)
from kera_research.services.modeling_runtime import (
    build_model as _build_model_impl,
    build_model_pretrained as _build_model_pretrained_impl,
    extract_image_embedding as _extract_image_embedding_impl,
    extract_paired_image_embedding as _extract_paired_image_embedding_impl,
    extract_state_dict_from_checkpoint as _extract_state_dict_from_checkpoint_impl,
    load_model as _load_model_impl,
    predict_image as _predict_image_impl,
    predict_paired_image as _predict_paired_image_impl,
)
from kera_research.services.modeling_training import (
    adapt_ssl_state_dict_shapes as _adapt_ssl_state_dict_shapes_impl,
    allowed_missing_ssl_keys as _allowed_missing_ssl_keys_impl,
    build_model_for_training as _build_model_for_training_impl,
    build_training_optimizer as _build_training_optimizer_impl,
    build_training_scheduler as _build_training_scheduler_impl,
    configure_fine_tuning as _configure_fine_tuning_impl,
    enable_partial_backbone as _enable_partial_backbone_impl,
    fine_tune as _fine_tune_impl,
    fine_tune_attention_mil as _fine_tune_attention_mil_impl,
    freeze_all_parameters as _freeze_all_parameters_impl,
    freeze_backbone as _freeze_backbone_impl,
    head_modules as _head_modules_impl,
    load_ssl_encoder_into_model as _load_ssl_encoder_into_model_impl,
    normalize_fine_tuning_mode as _normalize_fine_tuning_mode_impl,
    normalize_ssl_state_dict_for_target as _normalize_ssl_state_dict_for_target_impl,
    normalize_training_pretraining_source as _normalize_training_pretraining_source_impl,
    resize_ssl_tensor_for_target as _resize_ssl_tensor_for_target_impl,
    ssl_backbone_architecture_for_model as _ssl_backbone_architecture_for_model_impl,
    ssl_target_module as _ssl_target_module_impl,
    supports_imagenet_pretraining as _supports_imagenet_pretraining_impl,
    unfreeze_last_children as _unfreeze_last_children_impl,
    unfreeze_module_parameters as _unfreeze_module_parameters_impl,
)
from kera_research.services.modeling_training_runs import (
    build_cross_validation_splits as _build_cross_validation_splits_impl,
    cross_validate as _cross_validate_impl,
    initial_train as _initial_train_impl,
    initial_train_attention_mil as _initial_train_attention_mil_impl,
    refit_all_cases as _refit_all_cases_impl,
)
from kera_research.services.modeling_deltas import (
    aggregate_weight_deltas as _aggregate_weight_deltas_impl,
    save_weight_delta as _save_weight_delta_impl,
    validate_deltas as _validate_deltas_impl,
)
from kera_research.services.modeling_metadata import (
    baseline_model_settings as _baseline_model_settings_impl,
    build_artifact_metadata as _build_artifact_metadata_impl,
    checkpoint_metadata as _checkpoint_metadata_impl,
    ensure_baseline_models as _ensure_baseline_models_impl,
    model_preprocess_metadata as _model_preprocess_metadata_impl,
    resolve_preprocess_metadata as _resolve_preprocess_metadata_impl,
    validate_model_artifact as _validate_model_artifact_impl,
)
from kera_research.services.model_artifacts import ModelArtifactStore
from kera_research.services.lesion_guided_fusion import (
    LesionGuidedFusionKeratitis,
    ThreeScaleLesionGuidedFusionKeratitis,
)
from kera_research.services.retrieval import DINOv2_MODEL_ID

try:
    import torch
    import torch.nn.functional as F
    from torch import nn
    from torch.utils.data import DataLoader
except ImportError:  # pragma: no cover - dependency guard
    torch = None
    F = None
    nn = None
    DataLoader = None

try:
    import torchvision.models as _torchvision_models
    _TORCHVISION_AVAILABLE = True
except ImportError:  # pragma: no cover
    _torchvision_models = None
    _TORCHVISION_AVAILABLE = False


def require_torch() -> None:
    if torch is None or nn is None or F is None:
        raise RuntimeError("PyTorch is required for model inference and training.")


def seed_everything(seed: int = 42) -> None:
    random.seed(seed)
    np.random.seed(seed)
    if torch is not None:
        torch.manual_seed(seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(seed)


DEFAULT_NUM_CLASSES = len(LABEL_TO_INDEX)
DEFAULT_CASE_AGGREGATION = "mean"
CASE_AGGREGATIONS = ("mean", "logit_mean", "quality_weighted_mean", "attention_mil")
DUAL_INPUT_ARCHITECTURES = ("dual_input_concat", *LESION_GUIDED_FUSION_ARCHITECTURES)


if nn is not None:
    class TinyKeratitisCNN(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.features = nn.Sequential(
                nn.Conv2d(3, 16, kernel_size=3, padding=1),
                nn.ReLU(inplace=True),
                nn.MaxPool2d(2),
                nn.Conv2d(16, 32, kernel_size=3, padding=1),
                nn.ReLU(inplace=True),
                nn.MaxPool2d(2),
                nn.Conv2d(32, 64, kernel_size=3, padding=1),
                nn.ReLU(inplace=True),
            )
            self.pool = nn.AdaptiveAvgPool2d(1)
            self.classifier = nn.Linear(64, 2)

        def forward(self, inputs: torch.Tensor) -> torch.Tensor:
            features = self.features(inputs)
            pooled = self.pool(features).flatten(1)
            return self.classifier(pooled)


    class TinyPatchViT(nn.Module):
        def __init__(
            self,
            image_size: int = 224,
            patch_size: int = 16,
            embed_dim: int = 128,
            depth: int = 4,
            num_heads: int = 4,
            mlp_dim: int = 256,
            num_classes: int = 2,
        ) -> None:
            super().__init__()
            self.patch_embed = nn.Conv2d(3, embed_dim, kernel_size=patch_size, stride=patch_size)
            num_patches = (image_size // patch_size) ** 2
            self.cls_token = nn.Parameter(torch.zeros(1, 1, embed_dim))
            self.pos_embed = nn.Parameter(torch.zeros(1, num_patches + 1, embed_dim))
            encoder_layer = nn.TransformerEncoderLayer(
                d_model=embed_dim,
                nhead=num_heads,
                dim_feedforward=mlp_dim,
                dropout=0.1,
                batch_first=True,
                activation="gelu",
            )
            self.encoder = nn.TransformerEncoder(encoder_layer, num_layers=depth)
            self.norm = nn.LayerNorm(embed_dim)
            self.head = nn.Linear(embed_dim, num_classes)
            nn.init.normal_(self.cls_token, std=0.02)
            nn.init.normal_(self.pos_embed, std=0.02)

        def forward(self, inputs: torch.Tensor) -> torch.Tensor:
            patches = self.patch_embed(inputs)
            tokens = patches.flatten(2).transpose(1, 2)
            batch_size = tokens.size(0)
            cls_tokens = self.cls_token.expand(batch_size, -1, -1)
            tokens = torch.cat((cls_tokens, tokens), dim=1)
            tokens = tokens + self.pos_embed[:, : tokens.size(1)]
            encoded = self.encoder(tokens)
            cls_representation = self.norm(encoded[:, 0])
            return self.head(cls_representation)


    def window_partition(x: torch.Tensor, window_size: int) -> tuple[torch.Tensor, tuple[int, int, int, int]]:
        batch_size, channels, height, width = x.shape
        pad_h = (window_size - height % window_size) % window_size
        pad_w = (window_size - width % window_size) % window_size
        if pad_h or pad_w:
            x = F.pad(x, (0, pad_w, 0, pad_h))
        padded_height, padded_width = x.shape[2], x.shape[3]
        x = x.view(
            batch_size,
            channels,
            padded_height // window_size,
            window_size,
            padded_width // window_size,
            window_size,
        )
        windows = x.permute(0, 2, 4, 3, 5, 1).contiguous().view(-1, window_size * window_size, channels)
        return windows, (pad_h, pad_w, padded_height, padded_width)


    def window_reverse(
        windows: torch.Tensor,
        window_size: int,
        batch_size: int,
        channels: int,
        padded_height: int,
        padded_width: int,
        pad_h: int,
        pad_w: int,
    ) -> torch.Tensor:
        x = windows.view(
            batch_size,
            padded_height // window_size,
            padded_width // window_size,
            window_size,
            window_size,
            channels,
        )
        x = x.permute(0, 5, 1, 3, 2, 4).contiguous().view(batch_size, channels, padded_height, padded_width)
        if pad_h:
            x = x[:, :, :-pad_h, :]
        if pad_w:
            x = x[:, :, :, :-pad_w]
        return x


    class SwinWindowBlock(nn.Module):
        def __init__(
            self,
            dim: int,
            num_heads: int,
            window_size: int = 7,
            shifted: bool = False,
            mlp_ratio: float = 4.0,
        ) -> None:
            super().__init__()
            self.window_size = window_size
            self.shifted = shifted
            self.norm1 = nn.LayerNorm(dim)
            self.attn = nn.MultiheadAttention(dim, num_heads, batch_first=True)
            self.norm2 = nn.LayerNorm(dim)
            hidden_dim = int(dim * mlp_ratio)
            self.mlp = nn.Sequential(
                nn.Linear(dim, hidden_dim),
                nn.GELU(),
                nn.Linear(hidden_dim, dim),
            )

        def forward(self, x: torch.Tensor) -> torch.Tensor:
            batch_size, channels, height, width = x.shape
            if self.shifted:
                shift = self.window_size // 2
                x = torch.roll(x, shifts=(-shift, -shift), dims=(2, 3))

            windows, (pad_h, pad_w, padded_height, padded_width) = window_partition(x, self.window_size)
            attended_input = self.norm1(windows)
            attended_windows, _ = self.attn(attended_input, attended_input, attended_input, need_weights=False)
            windows = windows + attended_windows
            windows = windows + self.mlp(self.norm2(windows))
            x = window_reverse(
                windows,
                self.window_size,
                batch_size,
                channels,
                padded_height,
                padded_width,
                pad_h,
                pad_w,
            )

            if self.shifted:
                shift = self.window_size // 2
                x = torch.roll(x, shifts=(shift, shift), dims=(2, 3))
            return x


    class PatchMerging(nn.Module):
        def __init__(self, in_channels: int, out_channels: int) -> None:
            super().__init__()
            self.proj = nn.Conv2d(in_channels, out_channels, kernel_size=2, stride=2)
            self.norm = nn.BatchNorm2d(out_channels)
            self.act = nn.GELU()

        def forward(self, x: torch.Tensor) -> torch.Tensor:
            return self.act(self.norm(self.proj(x)))


    class TinySwinLike(nn.Module):
        def __init__(self, embed_dim: int = 64, num_classes: int = 2) -> None:
            super().__init__()
            self.stem = nn.Sequential(
                nn.Conv2d(3, embed_dim, kernel_size=4, stride=4),
                nn.BatchNorm2d(embed_dim),
                nn.GELU(),
            )
            self.stage1 = nn.Sequential(
                SwinWindowBlock(embed_dim, num_heads=4, window_size=7, shifted=False),
                SwinWindowBlock(embed_dim, num_heads=4, window_size=7, shifted=True),
            )
            self.merge1 = PatchMerging(embed_dim, embed_dim * 2)
            self.stage2 = nn.Sequential(
                SwinWindowBlock(embed_dim * 2, num_heads=4, window_size=7, shifted=False),
                SwinWindowBlock(embed_dim * 2, num_heads=4, window_size=7, shifted=True),
            )
            self.merge2 = PatchMerging(embed_dim * 2, embed_dim * 4)
            self.stage3 = nn.Sequential(
                SwinWindowBlock(embed_dim * 4, num_heads=8, window_size=7, shifted=False),
                SwinWindowBlock(embed_dim * 4, num_heads=8, window_size=7, shifted=True),
            )
            self.pool = nn.AdaptiveAvgPool2d(1)
            self.head = nn.Linear(embed_dim * 4, num_classes)

        def forward(self, inputs: torch.Tensor) -> torch.Tensor:
            x = self.stem(inputs)
            x = self.stage1(x)
            x = self.merge1(x)
            x = self.stage2(x)
            x = self.merge2(x)
            x = self.stage3(x)
            x = self.pool(x).flatten(1)
            return self.head(x)


    def _encode_swin_backbone(backbone: nn.Module, inputs: torch.Tensor) -> torch.Tensor:
        features = backbone.features(inputs)
        features = backbone.norm(features)
        permute = getattr(backbone, "permute", None)
        if callable(permute):
            features = permute(features)
        else:
            features = features.permute(0, 3, 1, 2).contiguous()
        features = backbone.avgpool(features)
        return torch.flatten(features, 1)


    def _encode_efficientnet_backbone(backbone: nn.Module, inputs: torch.Tensor) -> torch.Tensor:
        features = backbone.features(inputs)
        features = backbone.avgpool(features)
        return torch.flatten(features, 1)


    def _encode_convnext_backbone(backbone: nn.Module, inputs: torch.Tensor) -> torch.Tensor:
        features = backbone.features(inputs)
        features = backbone.avgpool(features)
        features = backbone.classifier[0](features)
        features = backbone.classifier[1](features)
        return features


    def _encode_densenet_backbone(backbone: nn.Module, inputs: torch.Tensor) -> torch.Tensor:
        features = backbone.features(inputs)
        features = F.relu(features, inplace=False)
        features = F.adaptive_avg_pool2d(features, (1, 1))
        return torch.flatten(features, 1)


    class DenseNetKeratitis(nn.Module):
        """Wrapper for torchvision DenseNet variants (121/169/201).

        Replaces the classifier head with a 2-class output.
        When loading the user's pre-trained .pth, call load_densenet_checkpoint()
        which handles the flexible key-mapping needed for custom checkpoints.
        """

        def __init__(self, variant: str = "densenet121", num_classes: int = 2) -> None:
            super().__init__()
            if not _TORCHVISION_AVAILABLE:
                raise RuntimeError(
                    "torchvision is required for DenseNet. Run uv sync --frozen --extra cpu --extra dev (or --extra gpu)."
                )
            builder = getattr(_torchvision_models, variant, None)
            if builder is None:
                raise ValueError(f"Unknown DenseNet variant: {variant}")
            backbone = builder(weights=None)
            in_features = backbone.classifier.in_features
            backbone.classifier = nn.Linear(in_features, num_classes)
            self.model = backbone

        def forward(self, inputs: torch.Tensor) -> torch.Tensor:
            return self.model(inputs)

        @property
        def features(self) -> nn.Module:
            return self.model.features

        @property
        def classifier(self) -> nn.Module:
            return self.model.classifier


    class ConvNeXtTinyKeratitis(nn.Module):
        def __init__(self, num_classes: int = 2) -> None:
            super().__init__()
            if not _TORCHVISION_AVAILABLE:
                raise RuntimeError(
                    "torchvision is required for ConvNeXt. Run uv sync --frozen --extra cpu --extra dev (or --extra gpu)."
                )
            backbone = _torchvision_models.convnext_tiny(weights=None)
            in_features = backbone.classifier[-1].in_features
            backbone.classifier[-1] = nn.Linear(in_features, num_classes)
            self.model = backbone

        def forward(self, inputs: torch.Tensor) -> torch.Tensor:
            return self.model(inputs)

        @property
        def features(self) -> nn.Module:
            return self.model.features

        @property
        def classifier(self) -> nn.Module:
            return self.model.classifier


    class Dinov2FeatureExtractor(nn.Module):
        def __init__(self, num_classes: int = 2, *, pretrained: bool = False) -> None:
            super().__init__()
            try:
                from transformers import Dinov2Config, Dinov2Model
            except ImportError as exc:  # pragma: no cover - dependency guard
                raise RuntimeError(
                    "transformers is required for DINOv2. Run uv sync --frozen --extra cpu --extra dev (or --extra gpu)."
                ) from exc

            if pretrained:
                backbone = Dinov2Model.from_pretrained(DINOv2_MODEL_ID)
            else:
                backbone = Dinov2Model(Dinov2Config())

            self.backbone = backbone
            self.hidden_size = int(backbone.config.hidden_size)

        def encode(self, inputs: torch.Tensor) -> torch.Tensor:
            outputs = self.backbone(pixel_values=inputs)
            return outputs.pooler_output if getattr(outputs, "pooler_output", None) is not None else outputs.last_hidden_state[:, 0]


    class Dinov2Keratitis(nn.Module):
        def __init__(self, num_classes: int = 2, *, pretrained: bool = False) -> None:
            super().__init__()
            encoder = Dinov2FeatureExtractor(num_classes=num_classes, pretrained=pretrained)
            self.backbone = encoder.backbone
            self.hidden_size = encoder.hidden_size
            self.classifier = nn.Linear(self.hidden_size, num_classes)

        def forward(self, inputs: torch.Tensor) -> torch.Tensor:
            outputs = self.backbone(pixel_values=inputs)
            features = outputs.pooler_output if getattr(outputs, "pooler_output", None) is not None else outputs.last_hidden_state[:, 0]
            return self.classifier(features)


    class DualInputConcatKeratitis(nn.Module):
        def __init__(
            self,
            num_classes: int = 2,
            *,
            pretrained: bool = False,
            dropout: float = 0.2,
        ) -> None:
            super().__init__()
            encoder = Dinov2FeatureExtractor(num_classes=num_classes, pretrained=pretrained)
            self.backbone = encoder.backbone
            self.hidden_size = encoder.hidden_size
            self.fusion_projection = nn.Sequential(
                nn.LayerNorm(self.hidden_size * 2),
                nn.Linear(self.hidden_size * 2, self.hidden_size),
                nn.GELU(),
                nn.Dropout(dropout),
            )
            self.classifier = nn.Linear(self.hidden_size, num_classes)
            self._cam_active_branch: str | None = None

        def encode(self, inputs: torch.Tensor, *, branch_name: str | None = None) -> torch.Tensor:
            self._cam_active_branch = branch_name
            try:
                outputs = self.backbone(pixel_values=inputs)
            finally:
                self._cam_active_branch = None
            return outputs.pooler_output if getattr(outputs, "pooler_output", None) is not None else outputs.last_hidden_state[:, 0]

        def forward_features(
            self,
            cornea_inputs: torch.Tensor,
            lesion_inputs: torch.Tensor,
            lesion_masks: torch.Tensor | None = None,
        ) -> torch.Tensor:
            del lesion_masks
            cornea_features = self.encode(cornea_inputs, branch_name="cornea")
            lesion_features = self.encode(lesion_inputs, branch_name="lesion")
            fused_features = torch.cat([cornea_features, lesion_features], dim=1)
            return self.fusion_projection(fused_features)

        def forward(
            self,
            cornea_inputs: torch.Tensor,
            lesion_inputs: torch.Tensor,
            lesion_masks: torch.Tensor | None = None,
        ) -> torch.Tensor:
            return self.classifier(self.forward_features(cornea_inputs, lesion_inputs, lesion_masks))


    class AttentionMILPool(nn.Module):
        def __init__(self, hidden_size: int, attention_size: int = 256) -> None:
            super().__init__()
            self.attn_v = nn.Linear(hidden_size, attention_size)
            self.attn_u = nn.Linear(hidden_size, attention_size)
            self.attn_w = nn.Linear(attention_size, 1)

        def forward(
            self,
            instance_features: torch.Tensor,
            *,
            mask: torch.Tensor | None = None,
        ) -> tuple[torch.Tensor, torch.Tensor]:
            gated = torch.tanh(self.attn_v(instance_features)) * torch.sigmoid(self.attn_u(instance_features))
            scores = self.attn_w(gated).squeeze(-1)
            if mask is not None:
                scores = scores.masked_fill(~mask, float("-inf"))
            attention = torch.softmax(scores, dim=1)
            if mask is not None:
                attention = attention * mask.to(dtype=attention.dtype)
                attention = attention / attention.sum(dim=1, keepdim=True).clamp_min(1e-6)
            pooled = torch.sum(attention.unsqueeze(-1) * instance_features, dim=1)
            return pooled, attention


    class Dinov2AttentionMIL(nn.Module):
        def __init__(
            self,
            num_classes: int = 2,
            *,
            pretrained: bool = False,
            attention_size: int = 256,
        ) -> None:
            super().__init__()
            encoder = Dinov2FeatureExtractor(num_classes=num_classes, pretrained=pretrained)
            self.backbone = encoder.backbone
            self.hidden_size = encoder.hidden_size
            self.attention_pool = AttentionMILPool(self.hidden_size, attention_size=attention_size)
            self.classifier = nn.Linear(self.hidden_size, num_classes)

        def encode_instances(self, inputs: torch.Tensor) -> torch.Tensor:
            if inputs.ndim == 4:
                batch_size = inputs.shape[0]
                outputs = self.backbone(pixel_values=inputs)
                features = outputs.pooler_output if getattr(outputs, "pooler_output", None) is not None else outputs.last_hidden_state[:, 0]
                return features.view(batch_size, 1, -1)
            if inputs.ndim != 5:
                raise ValueError(f"Dinov2AttentionMIL expects a 4D or 5D tensor, got shape {tuple(inputs.shape)}.")
            batch_size, bag_size, channels, height, width = inputs.shape
            flattened = inputs.view(batch_size * bag_size, channels, height, width)
            outputs = self.backbone(pixel_values=flattened)
            features = outputs.pooler_output if getattr(outputs, "pooler_output", None) is not None else outputs.last_hidden_state[:, 0]
            return features.view(batch_size, bag_size, -1)

        def forward_features(
            self,
            inputs: torch.Tensor,
            *,
            bag_mask: torch.Tensor | None = None,
        ) -> tuple[torch.Tensor, torch.Tensor]:
            instance_features = self.encode_instances(inputs)
            if bag_mask is None:
                bag_mask = torch.ones(instance_features.shape[:2], dtype=torch.bool, device=instance_features.device)
            elif bag_mask.ndim == 1:
                bag_mask = bag_mask.unsqueeze(0)
            pooled, attention = self.attention_pool(instance_features, mask=bag_mask)
            return pooled, attention

        def forward(
            self,
            inputs: torch.Tensor,
            bag_mask: torch.Tensor | None = None,
            *,
            return_attention: bool = False,
        ) -> torch.Tensor | tuple[torch.Tensor, torch.Tensor]:
            pooled, attention = self.forward_features(inputs, bag_mask=bag_mask)
            logits = self.classifier(pooled)
            if return_attention:
                return logits, attention
            return logits


    class SwinAttentionMIL(nn.Module):
        def __init__(
            self,
            num_classes: int = 2,
            *,
            pretrained: bool = False,
            attention_size: int = 256,
        ) -> None:
            super().__init__()
            if not _TORCHVISION_AVAILABLE:
                raise RuntimeError(
                    "torchvision is required for Swin Attention MIL. Run uv sync --frozen --extra cpu --extra dev (or --extra gpu)."
                )

            if pretrained:
                from torchvision.models import Swin_T_Weights

                backbone = _torchvision_models.swin_t(weights=Swin_T_Weights.IMAGENET1K_V1)
            else:
                backbone = _torchvision_models.swin_t(weights=None)

            self.backbone = backbone
            self.hidden_size = int(backbone.head.in_features)
            self.attention_pool = AttentionMILPool(self.hidden_size, attention_size=attention_size)
            self.classifier = nn.Linear(self.hidden_size, num_classes)

        def encode_instances(self, inputs: torch.Tensor) -> torch.Tensor:
            if inputs.ndim == 4:
                batch_size = inputs.shape[0]
                features = _encode_swin_backbone(self.backbone, inputs)
                return features.view(batch_size, 1, -1)
            if inputs.ndim != 5:
                raise ValueError(f"SwinAttentionMIL expects a 4D or 5D tensor, got shape {tuple(inputs.shape)}.")
            batch_size, bag_size, channels, height, width = inputs.shape
            flattened = inputs.view(batch_size * bag_size, channels, height, width)
            features = _encode_swin_backbone(self.backbone, flattened)
            return features.view(batch_size, bag_size, -1)

        def forward_features(
            self,
            inputs: torch.Tensor,
            *,
            bag_mask: torch.Tensor | None = None,
        ) -> tuple[torch.Tensor, torch.Tensor]:
            instance_features = self.encode_instances(inputs)
            if bag_mask is None:
                bag_mask = torch.ones(instance_features.shape[:2], dtype=torch.bool, device=instance_features.device)
            elif bag_mask.ndim == 1:
                bag_mask = bag_mask.unsqueeze(0)
            pooled, attention = self.attention_pool(instance_features, mask=bag_mask)
            return pooled, attention

        def forward(
            self,
            inputs: torch.Tensor,
            bag_mask: torch.Tensor | None = None,
            *,
            return_attention: bool = False,
        ) -> torch.Tensor | tuple[torch.Tensor, torch.Tensor]:
            pooled, attention = self.forward_features(inputs, bag_mask=bag_mask)
            logits = self.classifier(pooled)
            if return_attention:
                return logits, attention
            return logits


    class EfficientNetV2AttentionMIL(nn.Module):
        def __init__(
            self,
            num_classes: int = 2,
            *,
            pretrained: bool = False,
            attention_size: int = 256,
        ) -> None:
            super().__init__()
            if not _TORCHVISION_AVAILABLE:
                raise RuntimeError(
                    "torchvision is required for EfficientNetV2-S Attention MIL. Run uv sync --frozen --extra cpu --extra dev (or --extra gpu)."
                )

            if pretrained:
                from torchvision.models import EfficientNet_V2_S_Weights

                backbone = _torchvision_models.efficientnet_v2_s(weights=EfficientNet_V2_S_Weights.IMAGENET1K_V1)
            else:
                backbone = _torchvision_models.efficientnet_v2_s(weights=None)

            self.backbone = backbone
            self.hidden_size = int(backbone.classifier[-1].in_features)
            self.attention_pool = AttentionMILPool(self.hidden_size, attention_size=attention_size)
            self.classifier = nn.Linear(self.hidden_size, num_classes)

        def encode_instances(self, inputs: torch.Tensor) -> torch.Tensor:
            if inputs.ndim == 4:
                batch_size = inputs.shape[0]
                features = _encode_efficientnet_backbone(self.backbone, inputs)
                return features.view(batch_size, 1, -1)
            if inputs.ndim != 5:
                raise ValueError(
                    f"EfficientNetV2AttentionMIL expects a 4D or 5D tensor, got shape {tuple(inputs.shape)}."
                )
            batch_size, bag_size, channels, height, width = inputs.shape
            flattened = inputs.view(batch_size * bag_size, channels, height, width)
            features = _encode_efficientnet_backbone(self.backbone, flattened)
            return features.view(batch_size, bag_size, -1)

        def forward_features(
            self,
            inputs: torch.Tensor,
            *,
            bag_mask: torch.Tensor | None = None,
        ) -> tuple[torch.Tensor, torch.Tensor]:
            instance_features = self.encode_instances(inputs)
            if bag_mask is None:
                bag_mask = torch.ones(instance_features.shape[:2], dtype=torch.bool, device=instance_features.device)
            elif bag_mask.ndim == 1:
                bag_mask = bag_mask.unsqueeze(0)
            pooled, attention = self.attention_pool(instance_features, mask=bag_mask)
            return pooled, attention

        def forward(
            self,
            inputs: torch.Tensor,
            bag_mask: torch.Tensor | None = None,
            *,
            return_attention: bool = False,
        ) -> torch.Tensor | tuple[torch.Tensor, torch.Tensor]:
            pooled, attention = self.forward_features(inputs, bag_mask=bag_mask)
            logits = self.classifier(pooled)
            if return_attention:
                return logits, attention
            return logits


    class EfficientNetDinov2LesionAttentionMIL(nn.Module):
        def __init__(
            self,
            num_classes: int = 2,
            *,
            pretrained: bool = False,
            attention_size: int = 256,
            dropout: float = 0.2,
            freeze_lesion_encoder: bool = True,
        ) -> None:
            super().__init__()
            if not _TORCHVISION_AVAILABLE:
                raise RuntimeError(
                    "torchvision is required for EfficientNetV2-S + DINOv2 lesion MIL. "
                    "Run uv sync --frozen --extra cpu --extra dev (or --extra gpu)."
                )
            if pretrained:
                from torchvision.models import EfficientNet_V2_S_Weights

                full_backbone = _torchvision_models.efficientnet_v2_s(weights=EfficientNet_V2_S_Weights.IMAGENET1K_V1)
            else:
                full_backbone = _torchvision_models.efficientnet_v2_s(weights=None)

            self.full_backbone = full_backbone
            self.hidden_size = int(full_backbone.classifier[-1].in_features)
            self.full_backbone.classifier = nn.Identity()
            lesion_encoder = Dinov2FeatureExtractor(num_classes=num_classes, pretrained=pretrained)
            self.lesion_backbone = lesion_encoder.backbone
            self.lesion_hidden_size = int(lesion_encoder.hidden_size)
            self.lesion_projection = nn.Sequential(
                nn.LayerNorm(self.lesion_hidden_size),
                nn.Linear(self.lesion_hidden_size, self.hidden_size),
                nn.GELU(),
                nn.Dropout(dropout),
            )
            self.fusion_projection = nn.Sequential(
                nn.LayerNorm(self.hidden_size * 2),
                nn.Linear(self.hidden_size * 2, self.hidden_size),
                nn.GELU(),
                nn.Dropout(dropout),
            )
            self.attention_pool = AttentionMILPool(self.hidden_size, attention_size=attention_size)
            self.classifier = nn.Linear(self.hidden_size, num_classes)
            self.freeze_lesion_encoder = bool(freeze_lesion_encoder)
            if self.freeze_lesion_encoder:
                for parameter in self.lesion_backbone.parameters():
                    parameter.requires_grad = False

        def _encode_full(self, inputs: torch.Tensor) -> torch.Tensor:
            return _encode_efficientnet_backbone(self.full_backbone, inputs)

        def _encode_lesion(self, inputs: torch.Tensor) -> torch.Tensor:
            if self.freeze_lesion_encoder:
                with torch.no_grad():
                    outputs = self.lesion_backbone(pixel_values=inputs)
            else:
                outputs = self.lesion_backbone(pixel_values=inputs)
            return outputs.pooler_output if getattr(outputs, "pooler_output", None) is not None else outputs.last_hidden_state[:, 0]

        def encode_instances(
            self,
            full_inputs: torch.Tensor,
            lesion_inputs: torch.Tensor,
        ) -> torch.Tensor:
            if full_inputs.ndim == 4 and lesion_inputs.ndim == 4:
                full_features = self._encode_full(full_inputs)
                lesion_features = self.lesion_projection(self._encode_lesion(lesion_inputs))
                fused = torch.cat([full_features, lesion_features], dim=1)
                return self.fusion_projection(fused).view(full_inputs.shape[0], 1, -1)
            if full_inputs.ndim != 5 or lesion_inputs.ndim != 5:
                raise ValueError(
                    "EfficientNetDinov2LesionAttentionMIL expects paired 4D or 5D tensors, "
                    f"got {tuple(full_inputs.shape)} and {tuple(lesion_inputs.shape)}."
                )
            batch_size, bag_size, channels, height, width = full_inputs.shape
            flat_full = full_inputs.view(batch_size * bag_size, channels, height, width)
            flat_lesion = lesion_inputs.view(batch_size * bag_size, channels, height, width)
            full_features = self._encode_full(flat_full)
            lesion_features = self.lesion_projection(self._encode_lesion(flat_lesion))
            fused = torch.cat([full_features, lesion_features], dim=1)
            fused = self.fusion_projection(fused)
            return fused.view(batch_size, bag_size, -1)

        def forward_features(
            self,
            full_inputs: torch.Tensor,
            lesion_inputs: torch.Tensor,
            *,
            bag_mask: torch.Tensor | None = None,
        ) -> tuple[torch.Tensor, torch.Tensor]:
            instance_features = self.encode_instances(full_inputs, lesion_inputs)
            if bag_mask is None:
                bag_mask = torch.ones(instance_features.shape[:2], dtype=torch.bool, device=instance_features.device)
            elif bag_mask.ndim == 1:
                bag_mask = bag_mask.unsqueeze(0)
            pooled, attention = self.attention_pool(instance_features, mask=bag_mask)
            return pooled, attention

        def forward(
            self,
            full_inputs: torch.Tensor,
            lesion_inputs: torch.Tensor,
            bag_mask: torch.Tensor | None = None,
            *,
            return_attention: bool = False,
        ) -> torch.Tensor | tuple[torch.Tensor, torch.Tensor]:
            pooled, attention = self.forward_features(full_inputs, lesion_inputs, bag_mask=bag_mask)
            logits = self.classifier(pooled)
            if return_attention:
                return logits, attention
            return logits


    class ConvNeXtTinyAttentionMIL(nn.Module):
        def __init__(
            self,
            num_classes: int = 2,
            *,
            pretrained: bool = False,
            attention_size: int = 256,
        ) -> None:
            super().__init__()
            if not _TORCHVISION_AVAILABLE:
                raise RuntimeError(
                    "torchvision is required for ConvNeXt Attention MIL. Run uv sync --frozen --extra cpu --extra dev (or --extra gpu)."
                )

            if pretrained:
                from torchvision.models import ConvNeXt_Tiny_Weights

                backbone = _torchvision_models.convnext_tiny(weights=ConvNeXt_Tiny_Weights.IMAGENET1K_V1)
            else:
                backbone = _torchvision_models.convnext_tiny(weights=None)

            self.backbone = backbone
            self.hidden_size = int(backbone.classifier[-1].in_features)
            self.attention_pool = AttentionMILPool(self.hidden_size, attention_size=attention_size)
            self.classifier = nn.Linear(self.hidden_size, num_classes)

        def encode_instances(self, inputs: torch.Tensor) -> torch.Tensor:
            if inputs.ndim == 4:
                batch_size = inputs.shape[0]
                features = _encode_convnext_backbone(self.backbone, inputs)
                return features.view(batch_size, 1, -1)
            if inputs.ndim != 5:
                raise ValueError(f"ConvNeXtTinyAttentionMIL expects a 4D or 5D tensor, got shape {tuple(inputs.shape)}.")
            batch_size, bag_size, channels, height, width = inputs.shape
            flattened = inputs.view(batch_size * bag_size, channels, height, width)
            features = _encode_convnext_backbone(self.backbone, flattened)
            return features.view(batch_size, bag_size, -1)

        def forward_features(
            self,
            inputs: torch.Tensor,
            *,
            bag_mask: torch.Tensor | None = None,
        ) -> tuple[torch.Tensor, torch.Tensor]:
            instance_features = self.encode_instances(inputs)
            if bag_mask is None:
                bag_mask = torch.ones(instance_features.shape[:2], dtype=torch.bool, device=instance_features.device)
            elif bag_mask.ndim == 1:
                bag_mask = bag_mask.unsqueeze(0)
            pooled, attention = self.attention_pool(instance_features, mask=bag_mask)
            return pooled, attention

        def forward(
            self,
            inputs: torch.Tensor,
            bag_mask: torch.Tensor | None = None,
            *,
            return_attention: bool = False,
        ) -> torch.Tensor | tuple[torch.Tensor, torch.Tensor]:
            pooled, attention = self.forward_features(inputs, bag_mask=bag_mask)
            logits = self.classifier(pooled)
            if return_attention:
                return logits, attention
            return logits


    class DenseNetAttentionMIL(nn.Module):
        def __init__(
            self,
            num_classes: int = 2,
            *,
            pretrained: bool = False,
            attention_size: int = 256,
            variant: str = "densenet121",
        ) -> None:
            super().__init__()
            if not _TORCHVISION_AVAILABLE:
                raise RuntimeError(
                    "torchvision is required for DenseNet Attention MIL. Run uv sync --frozen --extra cpu --extra dev (or --extra gpu)."
                )
            if variant not in DENSENET_VARIANTS:
                raise ValueError(f"Unsupported DenseNet Attention MIL variant: {variant}")

            if pretrained:
                from torchvision.models import DenseNet121_Weights

                weight_map = {
                    "densenet121": DenseNet121_Weights.IMAGENET1K_V1,
                }
                backbone = getattr(_torchvision_models, variant)(weights=weight_map[variant])
            else:
                backbone = getattr(_torchvision_models, variant)(weights=None)

            self.backbone = backbone
            self.hidden_size = int(backbone.classifier.in_features)
            self.attention_pool = AttentionMILPool(self.hidden_size, attention_size=attention_size)
            self.classifier = nn.Linear(self.hidden_size, num_classes)

        def encode_instances(self, inputs: torch.Tensor) -> torch.Tensor:
            if inputs.ndim == 4:
                batch_size = inputs.shape[0]
                features = _encode_densenet_backbone(self.backbone, inputs)
                return features.view(batch_size, 1, -1)
            if inputs.ndim != 5:
                raise ValueError(f"DenseNetAttentionMIL expects a 4D or 5D tensor, got shape {tuple(inputs.shape)}.")
            batch_size, bag_size, channels, height, width = inputs.shape
            flattened = inputs.view(batch_size * bag_size, channels, height, width)
            features = _encode_densenet_backbone(self.backbone, flattened)
            return features.view(batch_size, bag_size, -1)

        def forward_features(
            self,
            inputs: torch.Tensor,
            *,
            bag_mask: torch.Tensor | None = None,
        ) -> tuple[torch.Tensor, torch.Tensor]:
            instance_features = self.encode_instances(inputs)
            if bag_mask is None:
                bag_mask = torch.ones(instance_features.shape[:2], dtype=torch.bool, device=instance_features.device)
            elif bag_mask.ndim == 1:
                bag_mask = bag_mask.unsqueeze(0)
            pooled, attention = self.attention_pool(instance_features, mask=bag_mask)
            return pooled, attention

        def forward(
            self,
            inputs: torch.Tensor,
            bag_mask: torch.Tensor | None = None,
            *,
            return_attention: bool = False,
        ) -> torch.Tensor | tuple[torch.Tensor, torch.Tensor]:
            pooled, attention = self.forward_features(inputs, bag_mask=bag_mask)
            logits = self.classifier(pooled)
            if return_attention:
                return logits, attention
            return logits

else:  # pragma: no cover - dependency guard
    class TinyKeratitisCNN:  # type: ignore[override]
        pass

    class TinyPatchViT:  # type: ignore[override]
        pass

    class TinySwinLike:  # type: ignore[override]
        pass

    class DenseNetKeratitis:  # type: ignore[override]
        pass

    class ConvNeXtTinyKeratitis:  # type: ignore[override]
        pass

    class Dinov2Keratitis:  # type: ignore[override]
        pass

    class Dinov2AttentionMIL:  # type: ignore[override]
        pass

    class SwinAttentionMIL:  # type: ignore[override]
        pass

    class EfficientNetV2AttentionMIL:  # type: ignore[override]
        pass

    class ConvNeXtTinyAttentionMIL:  # type: ignore[override]
        pass

    class DenseNetAttentionMIL:  # type: ignore[override]
        pass

    class DualInputConcatKeratitis:  # type: ignore[override]
        pass

@dataclass
class Prediction:
    predicted_label: str
    probability: float
    logits: list[float]


class ModelManager:
    def __init__(self) -> None:
        seed_everything()
        self.artifact_store = ModelArtifactStore()
        self._model_cache: dict[tuple[str, str], nn.Module] = {}

    def is_dual_input_architecture(self, architecture: str | None) -> bool:
        return is_dual_input_training_architecture(architecture)

    def supports_gradcam(self, architecture: str | None) -> bool:
        normalized = str(architecture or "").strip().lower()
        if normalized in DENSENET_VARIANTS:
            return True
        return normalized in {
            "cnn",
            "vit",
            "swin",
            "convnext_tiny",
            "efficientnet_v2_s",
            "dinov2",
            "dinov2_mil",
            "swin_mil",
            "dual_input_concat",
        } or is_lesion_guided_fusion_architecture(normalized)

    def preprocess_metadata(self, image_size: int = DEFAULT_IMAGE_SIZE) -> dict[str, Any]:
        return _imagenet_preprocess_metadata(image_size=image_size)

    def legacy_preprocess_metadata(self, image_size: int = DEFAULT_IMAGE_SIZE) -> dict[str, Any]:
        return _legacy_preprocess_metadata(image_size=image_size)

    def preprocess_signature(self, image_size: int = DEFAULT_IMAGE_SIZE) -> str:
        return _preprocess_signature_from_metadata(self.preprocess_metadata(image_size=image_size))

    def legacy_preprocess_signature(self, image_size: int = DEFAULT_IMAGE_SIZE) -> str:
        return _preprocess_signature_from_metadata(self.legacy_preprocess_metadata(image_size=image_size))

    def resolve_preprocess_metadata(
        self,
        model_reference: dict[str, Any] | None = None,
        checkpoint_metadata: dict[str, Any] | None = None,
        *,
        image_size: int = DEFAULT_IMAGE_SIZE,
    ) -> dict[str, Any]:
        return _resolve_preprocess_metadata_impl(
            self,
            model_reference,
            checkpoint_metadata,
            image_size=image_size,
        )

    def model_preprocess_metadata(
        self,
        model: nn.Module,
        model_reference: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return _model_preprocess_metadata_impl(self, model, model_reference)

    def build_artifact_metadata(
        self,
        *,
        architecture: str,
        artifact_type: str = "model",
        crop_mode: str | None = None,
        case_aggregation: str | None = None,
        bag_level: bool | None = None,
        training_input_policy: str | None = None,
        image_size: int = DEFAULT_IMAGE_SIZE,
        num_classes: int = DEFAULT_NUM_CLASSES,
        preprocess_metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return _build_artifact_metadata_impl(
            self,
            architecture=architecture,
            artifact_type=artifact_type,
            crop_mode=crop_mode,
            case_aggregation=case_aggregation,
            bag_level=bag_level,
            training_input_policy=training_input_policy,
            image_size=image_size,
            num_classes=num_classes,
            preprocess_metadata=preprocess_metadata,
        )

    def _checkpoint_metadata(self, checkpoint: Any) -> dict[str, Any]:
        return _checkpoint_metadata_impl(checkpoint)

    def validate_model_artifact(
        self,
        model_reference: dict[str, Any],
        checkpoint: Any,
    ) -> dict[str, Any]:
        return _validate_model_artifact_impl(
            self,
            model_reference,
            checkpoint,
            default_num_classes=DEFAULT_NUM_CLASSES,
        )

    def baseline_model_settings(self, template: dict[str, Any]) -> dict[str, Any]:
        return _baseline_model_settings_impl(self, template)

    def build_model(self, architecture: str) -> nn.Module:
        return _build_model_impl(self, architecture)

    def ensure_baseline_models(self) -> list[dict[str, Any]]:
        return _ensure_baseline_models_impl(
            self,
            default_num_classes=DEFAULT_NUM_CLASSES,
        )

    def resolve_model_reference(
        self,
        model_reference: dict[str, Any],
        *,
        allow_download: bool | None = None,
    ) -> dict[str, Any]:
        return self.artifact_store.resolve_model_reference(model_reference, allow_download=allow_download)

    def resolve_model_path(
        self,
        model_reference: dict[str, Any],
        *,
        allow_download: bool | None = None,
    ) -> str:
        return str(self.artifact_store.resolve_model_path(model_reference, allow_download=allow_download))

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

    def fine_tune(
        self,
        records: list[dict[str, Any]],
        base_model_reference: dict[str, Any],
        output_model_path: str | Path,
        device: str,
        full_finetune: bool,
        epochs: int,
        learning_rate: float = 1e-3,
        batch_size: int = 8,
        progress_callback: Any = None,
    ) -> dict[str, Any]:
        return _fine_tune_impl(
            self,
            records=records,
            base_model_reference=base_model_reference,
            output_model_path=output_model_path,
            device=device,
            full_finetune=full_finetune,
            epochs=epochs,
            learning_rate=learning_rate,
            batch_size=batch_size,
            progress_callback=progress_callback,
        )

    def _fine_tune_attention_mil(
        self,
        *,
        records: list[dict[str, Any]],
        base_model_reference: dict[str, Any],
        model: nn.Module,
        output_model_path: str | Path,
        device: str,
        full_finetune: bool,
        epochs: int,
        learning_rate: float,
        batch_size: int,
        progress_callback: Any = None,
    ) -> dict[str, Any]:
        return _fine_tune_attention_mil_impl(
            self,
            records=records,
            base_model_reference=base_model_reference,
            model=model,
            output_model_path=output_model_path,
            device=device,
            full_finetune=full_finetune,
            epochs=epochs,
            learning_rate=learning_rate,
            batch_size=batch_size,
            progress_callback=progress_callback,
        )

    def _freeze_backbone(self, model: nn.Module, architecture: str) -> None:
        _freeze_backbone_impl(model, architecture)

    def build_model_pretrained(self, architecture: str, num_classes: int = 2) -> nn.Module:
        return _build_model_pretrained_impl(self, architecture, num_classes=num_classes)

    def normalize_training_pretraining_source(
        self,
        pretraining_source: str | None,
        *,
        use_pretrained: bool = True,
    ) -> str:
        return _normalize_training_pretraining_source_impl(
            pretraining_source,
            use_pretrained=use_pretrained,
        )

    def normalize_fine_tuning_mode(self, fine_tuning_mode: str | None) -> str:
        return _normalize_fine_tuning_mode_impl(fine_tuning_mode)

    def _head_modules(self, model: nn.Module, architecture: str) -> list[nn.Module]:
        return _head_modules_impl(model, architecture)

    def _freeze_all_parameters(self, model: nn.Module) -> None:
        _freeze_all_parameters_impl(model)

    def _unfreeze_module_parameters(self, module: nn.Module) -> None:
        _unfreeze_module_parameters_impl(module)

    def _unfreeze_last_children(self, module: nn.Module, count: int) -> None:
        _unfreeze_last_children_impl(module, count)

    def _enable_partial_backbone(self, model: nn.Module, architecture: str, *, unfreeze_last_blocks: int) -> None:
        _enable_partial_backbone_impl(
            model,
            architecture,
            unfreeze_last_blocks=unfreeze_last_blocks,
        )

    def _configure_fine_tuning(
        self,
        model: nn.Module,
        architecture: str,
        *,
        fine_tuning_mode: str,
        unfreeze_last_blocks: int,
    ) -> None:
        _configure_fine_tuning_impl(
            model,
            architecture,
            fine_tuning_mode=fine_tuning_mode,
            unfreeze_last_blocks=unfreeze_last_blocks,
        )

    def _build_training_optimizer(
        self,
        model: nn.Module,
        architecture: str,
        *,
        learning_rate: float,
        backbone_learning_rate: float | None,
        head_learning_rate: float | None,
        weight_decay: float = 1e-4,
    ) -> torch.optim.Optimizer:
        return _build_training_optimizer_impl(
            model,
            architecture,
            learning_rate=learning_rate,
            backbone_learning_rate=backbone_learning_rate,
            head_learning_rate=head_learning_rate,
            weight_decay=weight_decay,
        )

    def _build_training_scheduler(
        self,
        optimizer: torch.optim.Optimizer,
        *,
        epochs: int,
        learning_rate: float,
        warmup_epochs: int,
    ) -> torch.optim.lr_scheduler.LRScheduler:
        return _build_training_scheduler_impl(
            optimizer,
            epochs=epochs,
            learning_rate=learning_rate,
            warmup_epochs=warmup_epochs,
        )

    def supports_imagenet_pretraining(self, architecture: str) -> bool:
        return _supports_imagenet_pretraining_impl(architecture)

    def ssl_backbone_architecture_for_model(self, architecture: str) -> str:
        return _ssl_backbone_architecture_for_model_impl(architecture)

    def _ssl_target_module(self, model: nn.Module, architecture: str) -> nn.Module:
        return _ssl_target_module_impl(model, architecture)

    def _allowed_missing_ssl_keys(self, architecture: str) -> tuple[str, ...]:
        return _allowed_missing_ssl_keys_impl(architecture)

    def _normalize_ssl_state_dict_for_target(
        self,
        state_dict: dict[str, Any],
        target_module: nn.Module,
    ) -> dict[str, Any]:
        return _normalize_ssl_state_dict_for_target_impl(state_dict, target_module)

    def _adapt_ssl_state_dict_shapes(
        self,
        state_dict: dict[str, Any],
        target_module: nn.Module,
    ) -> dict[str, Any]:
        return _adapt_ssl_state_dict_shapes_impl(state_dict, target_module)

    def _resize_ssl_tensor_for_target(
        self,
        key: str,
        source_tensor: Any,
        target_tensor: Any,
    ) -> Any | None:
        return _resize_ssl_tensor_for_target_impl(key, source_tensor, target_tensor)

    def load_ssl_encoder_into_model(
        self,
        model: nn.Module,
        architecture: str,
        ssl_checkpoint_path: str | Path,
    ) -> dict[str, Any]:
        return _load_ssl_encoder_into_model_impl(self, model, architecture, ssl_checkpoint_path)

    def build_model_for_training(
        self,
        architecture: str,
        *,
        pretraining_source: str | None = None,
        use_pretrained: bool = True,
        ssl_checkpoint_path: str | Path | None = None,
        num_classes: int = DEFAULT_NUM_CLASSES,
    ) -> tuple[nn.Module, str, dict[str, Any] | None]:
        return _build_model_for_training_impl(
            self,
            architecture,
            pretraining_source=pretraining_source,
            use_pretrained=use_pretrained,
            ssl_checkpoint_path=ssl_checkpoint_path,
            num_classes=num_classes,
        )

    def _split_ids_with_fallback(
        self,
        patient_ids: list[str],
        patient_labels: dict[str, str],
        test_size: int,
        seed: int,
    ) -> tuple[list[str], list[str]]:
        return _split_ids_with_fallback_impl(patient_ids, patient_labels, test_size, seed)

    def normalize_case_aggregation(self, value: str | None, architecture: str | None = None) -> str:
        return _normalize_case_aggregation_impl(
            value,
            architecture,
            default_case_aggregation=DEFAULT_CASE_AGGREGATION,
            case_aggregations=CASE_AGGREGATIONS,
        )

    def _bag_inputs_to_device(
        self,
        batch_inputs: torch.Tensor | tuple[torch.Tensor, ...] | list[torch.Tensor],
        device: str,
    ) -> torch.Tensor | tuple[torch.Tensor, ...]:
        return _bag_inputs_to_device_impl(batch_inputs, device)

    def _bag_forward(
        self,
        model: nn.Module,
        batch_inputs: torch.Tensor | tuple[torch.Tensor, ...] | list[torch.Tensor],
        batch_mask: torch.Tensor | None = None,
        *,
        return_attention: bool = False,
    ) -> torch.Tensor | tuple[torch.Tensor, torch.Tensor]:
        return _bag_forward_impl(
            model,
            batch_inputs,
            batch_mask,
            return_attention=return_attention,
        )

    def _collect_bag_loader_outputs(
        self,
        model: nn.Module,
        loader: DataLoader,
        device: str,
    ) -> dict[str, list[float] | list[int]]:
        return _collect_bag_loader_outputs_impl(model, loader, device)

    def _build_patient_split(
        self,
        patient_ids: list[str],
        patient_labels: dict[str, str],
        val_split: float,
        test_split: float,
        saved_split: dict[str, Any] | None = None,
        seed: int = 42,
    ) -> dict[str, Any]:
        return _build_patient_split_impl(
            self,
            patient_ids,
            patient_labels,
            val_split,
            test_split,
            saved_split=saved_split,
            seed=seed,
        )

    def _predicted_labels_from_threshold(
        self,
        positive_probabilities: list[float],
        threshold: float = 0.5,
    ) -> list[int]:
        return _predicted_labels_from_threshold_impl(positive_probabilities, threshold=threshold)

    def _image_prediction_rows_from_records(self, records: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return _image_prediction_rows_from_records_impl(records)

    def _visit_prediction_rows_from_records(self, visit_records: list[list[dict[str, Any]]]) -> list[dict[str, Any]]:
        return _visit_prediction_rows_from_records_impl(visit_records)

    def _build_prediction_records(
        self,
        sample_rows: list[dict[str, Any]],
        positive_probabilities: list[float],
        *,
        threshold: float = 0.5,
    ) -> list[dict[str, Any]]:
        return _build_prediction_records_impl(
            sample_rows,
            positive_probabilities,
            threshold=threshold,
        )

    def _collect_loader_outputs(
        self,
        model: nn.Module,
        loader: DataLoader,
        device: str,
    ) -> dict[str, list[float] | list[int]]:
        return _collect_loader_outputs_impl(model, loader, device)

    def _paired_forward_from_batch(
        self,
        model: nn.Module,
        batch: Any,
        device: str,
    ) -> tuple[torch.Tensor, torch.Tensor]:
        return _paired_forward_from_batch_impl(model, batch, device)

    def _collect_paired_loader_outputs(
        self,
        model: nn.Module,
        loader: DataLoader,
        device: str,
    ) -> dict[str, list[float] | list[int]]:
        return _collect_paired_loader_outputs_impl(model, loader, device)

    def _evaluate_loader(
        self,
        model: nn.Module,
        loader: DataLoader,
        device: str,
        threshold: float = 0.5,
    ) -> dict[str, Any]:
        return _evaluate_loader_impl(self, model, loader, device, threshold=threshold)

    def _evaluate_paired_loader(
        self,
        model: nn.Module,
        loader: DataLoader,
        device: str,
        threshold: float = 0.5,
    ) -> dict[str, Any]:
        return _evaluate_paired_loader_impl(self, model, loader, device, threshold=threshold)

    def select_decision_threshold(
        self,
        true_labels: list[int],
        positive_probabilities: list[float],
    ) -> dict[str, Any]:
        return _select_decision_threshold_impl(true_labels, positive_probabilities)

    def _build_cross_validation_splits(
        self,
        patient_ids: list[str],
        patient_labels: dict[str, str],
        num_folds: int,
        val_split: float,
        seed: int = 42,
    ) -> list[dict[str, Any]]:
        return _build_cross_validation_splits_impl(
            self,
            patient_ids,
            patient_labels,
            num_folds,
            val_split,
            seed=seed,
        )

    def _initial_train_attention_mil(
        self,
        *,
        records: list[dict[str, Any]],
        architecture: str,
        output_model_path: str | Path,
        device: str,
        epochs: int,
        learning_rate: float,
        batch_size: int,
        val_split: float,
        test_split: float,
        use_pretrained: bool,
        pretraining_source: str | None,
        ssl_checkpoint_path: str | Path | None,
        saved_split: dict[str, Any] | None,
        crop_mode: str | None,
        training_input_policy: str | None,
        progress_callback: Any,
        fine_tuning_mode: str,
        backbone_learning_rate: float | None,
        head_learning_rate: float | None,
        warmup_epochs: int,
        early_stop_patience: int | None,
        partial_unfreeze_blocks: int,
    ) -> dict[str, Any]:
        return _initial_train_attention_mil_impl(
            self,
            records=records,
            architecture=architecture,
            output_model_path=output_model_path,
            device=device,
            epochs=epochs,
            learning_rate=learning_rate,
            batch_size=batch_size,
            val_split=val_split,
            test_split=test_split,
            use_pretrained=use_pretrained,
            pretraining_source=pretraining_source,
            ssl_checkpoint_path=ssl_checkpoint_path,
            saved_split=saved_split,
            crop_mode=crop_mode,
            training_input_policy=training_input_policy,
            progress_callback=progress_callback,
            fine_tuning_mode=fine_tuning_mode,
            backbone_learning_rate=backbone_learning_rate,
            head_learning_rate=head_learning_rate,
            warmup_epochs=warmup_epochs,
            early_stop_patience=early_stop_patience,
            partial_unfreeze_blocks=partial_unfreeze_blocks,
        )

    def initial_train(
        self,
        records: list[dict[str, Any]],
        architecture: str,
        output_model_path: str | Path,
        device: str,
        epochs: int = 30,
        learning_rate: float = 1e-4,
        batch_size: int = 16,
        val_split: float = 0.2,
        test_split: float = 0.2,
        use_pretrained: bool = True,
        pretraining_source: str | None = None,
        ssl_checkpoint_path: str | Path | None = None,
        saved_split: dict[str, Any] | None = None,
        crop_mode: str | None = None,
        case_aggregation: str | None = None,
        training_input_policy: str | None = None,
        progress_callback: Any = None,
        fine_tuning_mode: str = "full",
        backbone_learning_rate: float | None = None,
        head_learning_rate: float | None = None,
        warmup_epochs: int = 0,
        early_stop_patience: int | None = None,
        partial_unfreeze_blocks: int = 1,
    ) -> dict[str, Any]:
        return _initial_train_impl(
            self,
            records=records,
            architecture=architecture,
            output_model_path=output_model_path,
            device=device,
            epochs=epochs,
            learning_rate=learning_rate,
            batch_size=batch_size,
            val_split=val_split,
            test_split=test_split,
            use_pretrained=use_pretrained,
            pretraining_source=pretraining_source,
            ssl_checkpoint_path=ssl_checkpoint_path,
            saved_split=saved_split,
            crop_mode=crop_mode,
            case_aggregation=case_aggregation,
            training_input_policy=training_input_policy,
            progress_callback=progress_callback,
            fine_tuning_mode=fine_tuning_mode,
            backbone_learning_rate=backbone_learning_rate,
            head_learning_rate=head_learning_rate,
            warmup_epochs=warmup_epochs,
            early_stop_patience=early_stop_patience,
            partial_unfreeze_blocks=partial_unfreeze_blocks,
        )

    def refit_all_cases(
        self,
        records: list[dict[str, Any]],
        architecture: str,
        output_model_path: str | Path,
        device: str,
        epochs: int = 30,
        learning_rate: float = 1e-4,
        batch_size: int = 16,
        use_pretrained: bool = True,
        pretraining_source: str | None = None,
        ssl_checkpoint_path: str | Path | None = None,
        crop_mode: str | None = None,
        case_aggregation: str | None = None,
        training_input_policy: str | None = None,
        progress_callback: Any = None,
        fine_tuning_mode: str = "full",
        backbone_learning_rate: float | None = None,
        head_learning_rate: float | None = None,
        warmup_epochs: int = 0,
        early_stop_patience: int | None = None,
        partial_unfreeze_blocks: int = 1,
    ) -> dict[str, Any]:
        return _refit_all_cases_impl(
            self,
            records=records,
            architecture=architecture,
            output_model_path=output_model_path,
            device=device,
            epochs=epochs,
            learning_rate=learning_rate,
            batch_size=batch_size,
            use_pretrained=use_pretrained,
            pretraining_source=pretraining_source,
            ssl_checkpoint_path=ssl_checkpoint_path,
            crop_mode=crop_mode,
            case_aggregation=case_aggregation,
            training_input_policy=training_input_policy,
            progress_callback=progress_callback,
            fine_tuning_mode=fine_tuning_mode,
            backbone_learning_rate=backbone_learning_rate,
            head_learning_rate=head_learning_rate,
            warmup_epochs=warmup_epochs,
            early_stop_patience=early_stop_patience,
            partial_unfreeze_blocks=partial_unfreeze_blocks,
        )

    def cross_validate(
        self,
        records: list[dict[str, Any]],
        architecture: str,
        output_dir: str | Path,
        device: str,
        num_folds: int = 5,
        epochs: int = 30,
        learning_rate: float = 1e-4,
        batch_size: int = 16,
        val_split: float = 0.2,
        use_pretrained: bool = True,
        pretraining_source: str | None = None,
        ssl_checkpoint_path: str | Path | None = None,
        case_aggregation: str | None = None,
        progress_callback: Any = None,
    ) -> dict[str, Any]:
        return _cross_validate_impl(
            self,
            records=records,
            architecture=architecture,
            output_dir=output_dir,
            device=device,
            num_folds=num_folds,
            epochs=epochs,
            learning_rate=learning_rate,
            batch_size=batch_size,
            val_split=val_split,
            use_pretrained=use_pretrained,
            pretraining_source=pretraining_source,
            ssl_checkpoint_path=ssl_checkpoint_path,
            case_aggregation=case_aggregation,
            progress_callback=progress_callback,
        )

    def save_weight_delta(
        self,
        base_model_path: str | Path,
        tuned_model_path: str | Path,
        output_delta_path: str | Path,
    ) -> str:
        return _save_weight_delta_impl(
            self,
            base_model_path,
            tuned_model_path,
            output_delta_path,
        )

    def _validate_deltas(self, deltas: list[dict]) -> None:
        return _validate_deltas_impl(deltas)

    def aggregate_weight_deltas(
        self,
        delta_paths: list[str | Path],
        output_path: str | Path,
        weights: list[float] | None = None,
        base_model_path: str | Path | None = None,
    ) -> str:
        return _aggregate_weight_deltas_impl(
            self,
            delta_paths,
            output_path,
            weights=weights,
            base_model_path=base_model_path,
        )

    def classification_metrics(
        self,
        true_labels: list[int],
        predicted_labels: list[int],
        positive_probabilities: list[float],
        threshold: float | None = None,
    ) -> dict[str, Any]:
        return _classification_metrics_impl(
            true_labels,
            predicted_labels,
            positive_probabilities,
            threshold=threshold,
        )
