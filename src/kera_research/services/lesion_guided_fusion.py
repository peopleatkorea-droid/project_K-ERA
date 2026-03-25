from __future__ import annotations

import math

import torch
from torch import nn
from torch.nn import functional as F

from kera_research.domain import (
    LESION_GUIDED_FUSION_BACKBONES,
    is_lesion_guided_fusion_architecture,
    lesion_guided_fusion_backbone,
)
from kera_research.services.ssl_pretraining import build_ssl_encoder


class LesionGuidedFusionBackboneAdapter(nn.Module):
    def __init__(self, backbone_name: str, *, init_mode: str = "random") -> None:
        super().__init__()
        normalized_backbone = str(backbone_name or "").strip().lower()
        if normalized_backbone not in LESION_GUIDED_FUSION_BACKBONES:
            raise ValueError(
                f"Unsupported lesion-guided fusion backbone: {backbone_name}. "
                f"Supported: {', '.join(LESION_GUIDED_FUSION_BACKBONES)}"
            )
        self.backbone_name = normalized_backbone
        self.encoder = build_ssl_encoder(self.backbone_name, init_mode=init_mode)
        self.feature_dim = int(getattr(self.encoder, "feature_dim"))

    def forward_map_and_global(self, inputs: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        if self.backbone_name == "densenet121":
            feature_map = F.relu(self.encoder.features(inputs), inplace=False)
            global_feature = torch.flatten(F.adaptive_avg_pool2d(feature_map, (1, 1)), 1)
            return feature_map, global_feature
        if self.backbone_name == "convnext_tiny":
            feature_map = self.encoder.features(inputs)
            global_feature = self.encoder.avgpool(feature_map)
            global_feature = self.encoder.norm(global_feature)
            global_feature = self.encoder.flatten(global_feature)
            return feature_map, global_feature
        if self.backbone_name == "efficientnet_v2_s":
            feature_map = self.encoder.features(inputs)
            global_feature = torch.flatten(self.encoder.avgpool(feature_map), 1)
            return feature_map, global_feature
        if self.backbone_name == "vit":
            batch_size = inputs.shape[0]
            patch_grid = self.encoder.conv_proj(inputs)
            patch_height, patch_width = patch_grid.shape[-2:]
            tokens = patch_grid.reshape(batch_size, self.feature_dim, -1).permute(0, 2, 1)
            class_token = self.encoder.class_token.expand(batch_size, -1, -1)
            encoded = self.encoder.encoder(torch.cat([class_token, tokens], dim=1))
            feature_map = encoded[:, 1:].transpose(1, 2).reshape(batch_size, self.feature_dim, patch_height, patch_width)
            return feature_map, encoded[:, 0]
        if self.backbone_name == "swin":
            stage_outputs = self.encoder.features(inputs)
            stage_outputs = self.encoder.norm(stage_outputs)
            feature_map = self.encoder.permute(stage_outputs)
            global_feature = self.encoder.flatten(self.encoder.avgpool(feature_map))
            return feature_map, global_feature
        if self.backbone_name == "dinov2":
            outputs = self.encoder.backbone(pixel_values=inputs)
            hidden_states = outputs.last_hidden_state
            patch_tokens = hidden_states[:, 1:]
            token_count = patch_tokens.shape[1]
            grid_size = int(math.sqrt(token_count))
            if grid_size * grid_size != token_count:
                raise RuntimeError(f"DINOv2 token grid is not square: {token_count}")
            feature_map = patch_tokens.transpose(1, 2).reshape(hidden_states.shape[0], self.feature_dim, grid_size, grid_size)
            global_feature = outputs.pooler_output if getattr(outputs, "pooler_output", None) is not None else hidden_states[:, 0]
            return feature_map, global_feature
        raise ValueError(f"Unsupported lesion-guided fusion backbone: {self.backbone_name}")

    def forward_global(self, inputs: torch.Tensor) -> torch.Tensor:
        return self.forward_map_and_global(inputs)[1]

    @property
    def gradcam_target_layer(self) -> nn.Module:
        if self.backbone_name == "vit":
            return self.encoder.conv_proj
        if self.backbone_name == "dinov2":
            patch_embeddings = getattr(getattr(self.encoder.backbone, "embeddings", None), "patch_embeddings", None)
            projection = getattr(patch_embeddings, "projection", None)
            if projection is None:
                raise ValueError("DINOv2 Grad-CAM target layer is unavailable.")
            return projection
        if self.backbone_name == "densenet121":
            return self.encoder.features
        if self.backbone_name in {"convnext_tiny", "efficientnet_v2_s", "swin"}:
            return self.encoder.features[-1]
        raise ValueError(f"Grad-CAM target layer is unavailable for lesion-guided fusion backbone: {self.backbone_name}")


class LesionGuidedFusionKeratitis(nn.Module):
    def __init__(
        self,
        architecture: str,
        *,
        num_classes: int = 2,
        init_mode: str = "random",
        dropout: float = 0.2,
        attention_scale: float = 0.8,
        mask_gate_floor: float = 0.25,
    ) -> None:
        super().__init__()
        if not is_lesion_guided_fusion_architecture(architecture):
            raise ValueError(f"Lesion-guided fusion architecture is invalid: {architecture}")
        backbone_name = lesion_guided_fusion_backbone(architecture)
        if not backbone_name:
            raise ValueError(f"Unable to resolve lesion-guided fusion backbone from architecture: {architecture}")
        self.architecture = architecture
        self.backbone_name = backbone_name
        self.backbone_adapter = LesionGuidedFusionBackboneAdapter(backbone_name, init_mode=init_mode)
        self.backbone = self.backbone_adapter.encoder
        self.hidden_size = int(self.backbone_adapter.feature_dim)
        self.attention_scale = float(attention_scale)
        self.mask_gate_floor = float(mask_gate_floor)
        attention_hidden = max(64, min(256, self.hidden_size // 2))
        self.lesion_projection = nn.Sequential(
            nn.LayerNorm(self.hidden_size),
            nn.Linear(self.hidden_size, self.hidden_size),
            nn.GELU(),
            nn.Dropout(dropout),
        )
        self.channel_gate = nn.Sequential(
            nn.LayerNorm(self.hidden_size),
            nn.Linear(self.hidden_size, self.hidden_size),
            nn.Sigmoid(),
        )
        self.spatial_attention = nn.Sequential(
            nn.Conv2d(self.hidden_size + 1, attention_hidden, kernel_size=1),
            nn.GELU(),
            nn.Conv2d(attention_hidden, 1, kernel_size=1),
        )
        self.fusion_projection = nn.Sequential(
            nn.LayerNorm(self.hidden_size * 3),
            nn.Linear(self.hidden_size * 3, self.hidden_size),
            nn.GELU(),
            nn.Dropout(dropout),
        )
        self.classifier = nn.Linear(self.hidden_size, num_classes)
        self._cam_active_branch: str | None = None

    def _soft_mask(
        self,
        lesion_masks: torch.Tensor | None,
        spatial_size: tuple[int, int],
        *,
        batch_size: int,
        device: torch.device,
    ) -> torch.Tensor:
        if lesion_masks is None:
            return torch.zeros((batch_size, 1, *spatial_size), device=device, dtype=torch.float32)
        if lesion_masks.ndim == 3:
            lesion_masks = lesion_masks.unsqueeze(1)
        resized = F.interpolate(
            lesion_masks.to(dtype=torch.float32),
            size=spatial_size,
            mode="bilinear",
            align_corners=False,
        )
        softened = resized
        for _ in range(2):
            softened = F.avg_pool2d(softened, kernel_size=5, stride=1, padding=2)
        return torch.clamp(torch.maximum(resized, softened), 0.0, 1.0)

    def _encode_map_and_global(
        self,
        inputs: torch.Tensor,
        *,
        branch_name: str | None = None,
    ) -> tuple[torch.Tensor, torch.Tensor]:
        self._cam_active_branch = branch_name
        try:
            return self.backbone_adapter.forward_map_and_global(inputs)
        finally:
            self._cam_active_branch = None

    def _encode_global(
        self,
        inputs: torch.Tensor,
        *,
        branch_name: str | None = None,
    ) -> torch.Tensor:
        return self._encode_map_and_global(inputs, branch_name=branch_name)[1]

    def forward_features(
        self,
        cornea_inputs: torch.Tensor,
        lesion_inputs: torch.Tensor,
        lesion_masks: torch.Tensor | None = None,
    ) -> torch.Tensor:
        cornea_map, cornea_global = self._encode_map_and_global(cornea_inputs, branch_name="cornea")
        lesion_global = self._encode_global(lesion_inputs, branch_name="lesion")
        lesion_feature = self.lesion_projection(lesion_global)
        channel_gate = self.channel_gate(lesion_feature).unsqueeze(-1).unsqueeze(-1)
        soft_mask = self._soft_mask(
            lesion_masks,
            cornea_map.shape[-2:],
            batch_size=cornea_map.shape[0],
            device=cornea_map.device,
        )
        conditioned_map = cornea_map * (1.0 + 0.5 * channel_gate)
        attention_logits = self.spatial_attention(torch.cat([conditioned_map, soft_mask], dim=1))
        learned_attention = torch.sigmoid(attention_logits)
        guided_attention = learned_attention * (self.mask_gate_floor + (1.0 - self.mask_gate_floor) * soft_mask)
        guided_map = cornea_map * (1.0 + self.attention_scale * guided_attention) * (1.0 + 0.5 * channel_gate)
        guided_global = F.adaptive_avg_pool2d(guided_map, (1, 1)).flatten(1)
        fused_feature = torch.cat([cornea_global, guided_global, lesion_feature], dim=1)
        return self.fusion_projection(fused_feature)

    def forward(
        self,
        cornea_inputs: torch.Tensor,
        lesion_inputs: torch.Tensor,
        lesion_masks: torch.Tensor | None = None,
    ) -> torch.Tensor:
        return self.classifier(self.forward_features(cornea_inputs, lesion_inputs, lesion_masks))
