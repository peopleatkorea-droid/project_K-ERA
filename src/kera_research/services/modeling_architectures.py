from __future__ import annotations

from kera_research.domain import DENSENET_VARIANTS
from kera_research.services.retrieval import DINOv2_MODEL_ID

try:
    import torch
    import torch.nn.functional as F
    from torch import nn
except ImportError:  # pragma: no cover - dependency guard
    torch = None
    F = None
    nn = None

try:
    import torchvision.models as _torchvision_models

    _TORCHVISION_AVAILABLE = True
except ImportError:  # pragma: no cover
    _torchvision_models = None
    _TORCHVISION_AVAILABLE = False


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
            return (
                outputs.pooler_output
                if getattr(outputs, "pooler_output", None) is not None
                else outputs.last_hidden_state[:, 0]
            )


    class Dinov2Keratitis(nn.Module):
        def __init__(self, num_classes: int = 2, *, pretrained: bool = False) -> None:
            super().__init__()
            encoder = Dinov2FeatureExtractor(num_classes=num_classes, pretrained=pretrained)
            self.backbone = encoder.backbone
            self.hidden_size = encoder.hidden_size
            self.classifier = nn.Linear(self.hidden_size, num_classes)

        def forward(self, inputs: torch.Tensor) -> torch.Tensor:
            outputs = self.backbone(pixel_values=inputs)
            features = (
                outputs.pooler_output
                if getattr(outputs, "pooler_output", None) is not None
                else outputs.last_hidden_state[:, 0]
            )
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
            return (
                outputs.pooler_output
                if getattr(outputs, "pooler_output", None) is not None
                else outputs.last_hidden_state[:, 0]
            )

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
                features = (
                    outputs.pooler_output
                    if getattr(outputs, "pooler_output", None) is not None
                    else outputs.last_hidden_state[:, 0]
                )
                return features.view(batch_size, 1, -1)
            if inputs.ndim != 5:
                raise ValueError(f"Dinov2AttentionMIL expects a 4D or 5D tensor, got shape {tuple(inputs.shape)}.")
            batch_size, bag_size, channels, height, width = inputs.shape
            flattened = inputs.view(batch_size * bag_size, channels, height, width)
            outputs = self.backbone(pixel_values=flattened)
            features = (
                outputs.pooler_output
                if getattr(outputs, "pooler_output", None) is not None
                else outputs.last_hidden_state[:, 0]
            )
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
            return (
                outputs.pooler_output
                if getattr(outputs, "pooler_output", None) is not None
                else outputs.last_hidden_state[:, 0]
            )

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

    class Dinov2FeatureExtractor:  # type: ignore[override]
        pass

    class Dinov2Keratitis:  # type: ignore[override]
        pass

    class Dinov2AttentionMIL:  # type: ignore[override]
        pass

    class SwinAttentionMIL:  # type: ignore[override]
        pass

    class EfficientNetV2AttentionMIL:  # type: ignore[override]
        pass

    class EfficientNetDinov2LesionAttentionMIL:  # type: ignore[override]
        pass

    class ConvNeXtTinyAttentionMIL:  # type: ignore[override]
        pass

    class DenseNetAttentionMIL:  # type: ignore[override]
        pass

    class DualInputConcatKeratitis:  # type: ignore[override]
        pass

    class AttentionMILPool:  # type: ignore[override]
        pass
