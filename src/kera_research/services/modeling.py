from __future__ import annotations

import hashlib
import json
import math
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import pandas as pd
from PIL import Image
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, roc_auc_score, roc_curve
from sklearn.model_selection import StratifiedKFold, train_test_split

from kera_research.config import DEFAULT_GLOBAL_MODELS
from kera_research.domain import DENSENET_VARIANTS, INDEX_TO_LABEL, LABEL_TO_INDEX, make_id, utc_now
from kera_research.services.model_artifacts import ModelArtifactStore

try:
    import torch
    import torch.nn.functional as F
    from torch import nn
    from torch.utils.data import DataLoader, Dataset
except ImportError:  # pragma: no cover - dependency guard
    torch = None
    F = None
    nn = None
    DataLoader = None
    Dataset = object

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


DEFAULT_IMAGE_SIZE = 224
DEFAULT_NUM_CLASSES = len(LABEL_TO_INDEX)
IMAGENET_CHANNEL_MEAN = (0.485, 0.456, 0.406)
IMAGENET_CHANNEL_STD = (0.229, 0.224, 0.225)


def _legacy_preprocess_metadata(image_size: int = DEFAULT_IMAGE_SIZE) -> dict[str, Any]:
    return {
        "color_mode": "RGB",
        "resize": [int(image_size), int(image_size)],
        "scaling": "0_1",
    }


def _imagenet_preprocess_metadata(image_size: int = DEFAULT_IMAGE_SIZE) -> dict[str, Any]:
    metadata = _legacy_preprocess_metadata(image_size=image_size)
    metadata["normalization"] = {
        "type": "imagenet",
        "mean": [float(value) for value in IMAGENET_CHANNEL_MEAN],
        "std": [float(value) for value in IMAGENET_CHANNEL_STD],
    }
    return metadata


def _preprocess_signature_from_metadata(metadata: dict[str, Any]) -> str:
    payload = json.dumps(metadata, sort_keys=True, separators=(",", ":"))
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:16]


def _preprocess_image_size(preprocess_metadata: dict[str, Any] | None, fallback: int = DEFAULT_IMAGE_SIZE) -> int:
    if not isinstance(preprocess_metadata, dict):
        return int(fallback)
    resize = preprocess_metadata.get("resize")
    if (
        isinstance(resize, list)
        and len(resize) >= 2
        and all(isinstance(item, (int, float)) for item in resize[:2])
    ):
        return int(resize[0])
    return int(fallback)


def _normalize_view(view: Any) -> str:
    return str(view or "white").strip().lower() or "white"


def _apply_preprocess_to_tensor(tensor: torch.Tensor, preprocess_metadata: dict[str, Any] | None) -> torch.Tensor:
    if tensor.ndim not in {3, 4}:
        raise ValueError(f"Expected a 3D or 4D tensor, got shape {tuple(tensor.shape)}.")
    if not isinstance(preprocess_metadata, dict):
        return tensor
    normalization = preprocess_metadata.get("normalization")
    if not isinstance(normalization, dict):
        return tensor
    normalization_type = str(normalization.get("type") or "").strip().lower()
    if normalization_type in {"", "none"}:
        return tensor
    if normalization_type != "imagenet":
        raise ValueError(f"Unsupported normalization type: {normalization_type}")
    mean = normalization.get("mean") or IMAGENET_CHANNEL_MEAN
    std = normalization.get("std") or IMAGENET_CHANNEL_STD
    mean_tensor = tensor.new_tensor(mean).view((1, -1, 1, 1) if tensor.ndim == 4 else (-1, 1, 1))
    std_tensor = tensor.new_tensor(std).view((1, -1, 1, 1) if tensor.ndim == 4 else (-1, 1, 1))
    return (tensor - mean_tensor) / std_tensor


def _load_image_tensor(
    image_path: str | Path,
    image_size: int = DEFAULT_IMAGE_SIZE,
) -> tuple[Image.Image, torch.Tensor]:
    require_torch()
    image = Image.open(image_path).convert("RGB")
    resized = image.resize((image_size, image_size))
    array = np.asarray(resized, dtype=np.float32) / 255.0
    tensor = torch.from_numpy(array.transpose(2, 0, 1)).unsqueeze(0)
    return image, tensor


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
    class DenseNetKeratitis(nn.Module):
        """Wrapper for torchvision DenseNet variants (121/169/201).

        Replaces the classifier head with a 2-class output.
        When loading the user's pre-trained .pth, call load_densenet_checkpoint()
        which handles the flexible key-mapping needed for custom checkpoints.
        """

        def __init__(self, variant: str = "densenet121", num_classes: int = 2) -> None:
            super().__init__()
            if not _TORCHVISION_AVAILABLE:
                raise RuntimeError("torchvision is required for DenseNet. Run: pip install torchvision")
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
                raise RuntimeError("torchvision is required for ConvNeXt. Run: pip install torchvision")
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


def preprocess_image(
    image_path: str | Path,
    image_size: int = DEFAULT_IMAGE_SIZE,
    *,
    preprocess_metadata: dict[str, Any] | None = None,
) -> tuple[Image.Image, torch.Tensor]:
    effective_size = _preprocess_image_size(preprocess_metadata, fallback=image_size)
    image, tensor = _load_image_tensor(image_path, image_size=effective_size)
    return image, _apply_preprocess_to_tensor(tensor, preprocess_metadata)


def _apply_random_affine(
    tensor: torch.Tensor,
    *,
    max_rotate_degrees: float,
    max_translate: float,
    min_scale: float,
    max_scale: float,
) -> torch.Tensor:
    angle = math.radians(random.uniform(-max_rotate_degrees, max_rotate_degrees))
    scale = random.uniform(min_scale, max_scale)
    translate_x = random.uniform(-max_translate, max_translate)
    translate_y = random.uniform(-max_translate, max_translate)
    theta = tensor.new_tensor(
        [
            [scale * math.cos(angle), -scale * math.sin(angle), translate_x],
            [scale * math.sin(angle), scale * math.cos(angle), translate_y],
        ]
    )
    grid = F.affine_grid(theta.unsqueeze(0), size=(1, *tensor.shape), align_corners=False)
    warped = F.grid_sample(
        tensor.unsqueeze(0),
        grid,
        mode="bilinear",
        padding_mode="border",
        align_corners=False,
    )
    return warped.squeeze(0)


def _apply_box_blur(tensor: torch.Tensor, kernel_size: int = 3) -> torch.Tensor:
    blurred = F.avg_pool2d(tensor.unsqueeze(0), kernel_size=kernel_size, stride=1, padding=kernel_size // 2)
    return blurred.squeeze(0)


def _apply_specular_glare(tensor: torch.Tensor, intensity_scale: float = 1.0) -> torch.Tensor:
    _, height, width = tensor.shape
    yy, xx = torch.meshgrid(
        torch.linspace(-1.0, 1.0, height, device=tensor.device),
        torch.linspace(-1.0, 1.0, width, device=tensor.device),
        indexing="ij",
    )
    center_x = random.uniform(-0.45, 0.45)
    center_y = random.uniform(-0.45, 0.45)
    radius = random.uniform(0.08, 0.22)
    distance = ((xx - center_x) ** 2 + (yy - center_y) ** 2) / max(radius**2, 1e-6)
    spot = torch.exp(-distance * 2.4) * random.uniform(0.06, 0.18) * intensity_scale
    return torch.clamp(tensor + spot.unsqueeze(0), 0.0, 1.0)


def _adjust_color_by_view(tensor: torch.Tensor, view: str) -> torch.Tensor:
    brightness = random.uniform(0.9, 1.12)
    contrast = random.uniform(0.9, 1.12)
    tensor = torch.clamp(tensor * brightness, 0.0, 1.0)
    channel_mean = tensor.mean(dim=(1, 2), keepdim=True)
    tensor = torch.clamp((tensor - channel_mean) * contrast + channel_mean, 0.0, 1.0)
    if view == "fluorescein":
        channel_gain = tensor.new_tensor(
            [
                random.uniform(0.94, 1.02),
                random.uniform(0.98, 1.12),
                random.uniform(0.94, 1.04),
            ]
        ).view(3, 1, 1)
        return torch.clamp(tensor * channel_gain, 0.0, 1.0)
    channel_gain = tensor.new_tensor(
        [
            random.uniform(0.92, 1.08),
            random.uniform(0.92, 1.08),
            random.uniform(0.92, 1.08),
        ]
    ).view(3, 1, 1)
    return torch.clamp(tensor * channel_gain, 0.0, 1.0)


def _augment_tensor(tensor: torch.Tensor, *, view: str | None = None) -> torch.Tensor:
    """Apply slit-lamp aware augmentation on raw 0-1 RGB tensors before normalization."""
    normalized_view = _normalize_view(view)
    if random.random() < 0.5:
        tensor = torch.flip(tensor, dims=[2])
    if random.random() < 0.8:
        tensor = _apply_random_affine(
            tensor,
            max_rotate_degrees=7.0 if normalized_view == "slit" else 10.0,
            max_translate=0.05,
            min_scale=0.95,
            max_scale=1.05,
        )
    tensor = _adjust_color_by_view(tensor, normalized_view)
    if random.random() < 0.18:
        tensor = _apply_box_blur(tensor)
    if normalized_view != "fluorescein" and random.random() < 0.16:
        tensor = _apply_specular_glare(tensor, intensity_scale=1.15 if normalized_view == "slit" else 1.0)
    if random.random() < 0.22:
        noise_scale = 0.018 if normalized_view == "fluorescein" else 0.024
        tensor = torch.clamp(tensor + torch.randn_like(tensor) * noise_scale, 0.0, 1.0)
    return tensor


class ManifestImageDataset(Dataset):
    def __init__(
        self,
        records: Iterable[dict[str, Any]],
        augment: bool = False,
        *,
        preprocess_metadata: dict[str, Any] | None = None,
    ) -> None:
        self.records = list(records)
        self.augment = augment
        self.preprocess_metadata = dict(preprocess_metadata) if isinstance(preprocess_metadata, dict) else None

    def __len__(self) -> int:
        return len(self.records)

    def __getitem__(self, index: int) -> tuple[torch.Tensor, torch.Tensor]:
        record = self.records[index]
        _, tensor = _load_image_tensor(
            record["image_path"],
            image_size=_preprocess_image_size(self.preprocess_metadata),
        )
        tensor = tensor.squeeze(0)
        if self.augment:
            tensor = _augment_tensor(tensor, view=record.get("view"))
        tensor = _apply_preprocess_to_tensor(tensor, self.preprocess_metadata)
        label_value = LABEL_TO_INDEX[record["culture_category"]]
        return tensor, torch.tensor(label_value, dtype=torch.long)


@dataclass
class Prediction:
    predicted_label: str
    probability: float
    logits: list[float]


class ModelManager:
    def __init__(self) -> None:
        seed_everything()
        self.artifact_store = ModelArtifactStore()

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
            if signature == self.legacy_preprocess_signature(image_size=image_size):
                return self.legacy_preprocess_metadata(image_size=image_size)
            if signature == self.preprocess_signature(image_size=image_size):
                return self.preprocess_metadata(image_size=image_size)

        return self.preprocess_metadata(image_size=image_size)

    def model_preprocess_metadata(
        self,
        model: nn.Module,
        model_reference: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        metadata = getattr(model, "_kera_preprocess_metadata", None)
        if isinstance(metadata, dict):
            return dict(metadata)
        return self.resolve_preprocess_metadata(model_reference)

    def build_artifact_metadata(
        self,
        *,
        architecture: str,
        artifact_type: str = "model",
        crop_mode: str | None = None,
        training_input_policy: str | None = None,
        image_size: int = DEFAULT_IMAGE_SIZE,
        num_classes: int = DEFAULT_NUM_CLASSES,
        preprocess_metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        resolved_preprocess = dict(preprocess_metadata) if isinstance(preprocess_metadata, dict) else self.preprocess_metadata(image_size=image_size)
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
        if training_input_policy is not None:
            metadata["training_input_policy"] = str(training_input_policy)
        return metadata

    def _checkpoint_metadata(self, checkpoint: Any) -> dict[str, Any]:
        if not isinstance(checkpoint, dict):
            return {}
        metadata = checkpoint.get("artifact_metadata")
        return dict(metadata) if isinstance(metadata, dict) else {}

    def validate_model_artifact(
        self,
        model_reference: dict[str, Any],
        checkpoint: Any,
    ) -> dict[str, Any]:
        architecture = str(model_reference.get("architecture") or "densenet121")
        metadata = self._checkpoint_metadata(checkpoint)
        checkpoint_architecture = str((metadata.get("architecture") or checkpoint.get("architecture") or "")).strip()
        if checkpoint_architecture and checkpoint_architecture != architecture:
            raise ValueError(
                f"Checkpoint architecture mismatch: expected {architecture}, found {checkpoint_architecture}."
            )

        expected_num_classes = int(model_reference.get("num_classes") or DEFAULT_NUM_CLASSES)
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

        expected_signature = str(model_reference.get("preprocess_signature") or self.preprocess_signature()).strip()
        checkpoint_signature = str(metadata.get("preprocess_signature") or "").strip()
        if checkpoint_signature and checkpoint_signature != expected_signature:
            raise ValueError(
                f"Checkpoint preprocess signature mismatch: expected {expected_signature}, found {checkpoint_signature}."
            )

        return metadata

    def build_model(self, architecture: str) -> nn.Module:
        require_torch()
        if architecture == "cnn":
            return TinyKeratitisCNN()
        if architecture == "vit":
            if not _TORCHVISION_AVAILABLE:
                raise RuntimeError("torchvision is required for ViT. Run: pip install torchvision")
            backbone = _torchvision_models.vit_b_16(weights=None)
            in_features = backbone.heads.head.in_features
            backbone.heads.head = nn.Linear(in_features, DEFAULT_NUM_CLASSES)
            return backbone
        if architecture == "swin":
            if not _TORCHVISION_AVAILABLE:
                raise RuntimeError("torchvision is required for Swin. Run: pip install torchvision")
            backbone = _torchvision_models.swin_t(weights=None)
            in_features = backbone.head.in_features
            backbone.head = nn.Linear(in_features, DEFAULT_NUM_CLASSES)
            return backbone
        if architecture == "convnext_tiny":
            return ConvNeXtTinyKeratitis()
        if architecture == "efficientnet_v2_s":
            if not _TORCHVISION_AVAILABLE:
                raise RuntimeError("torchvision is required for EfficientNetV2-S. Run: pip install torchvision")
            backbone = _torchvision_models.efficientnet_v2_s(weights=None)
            in_features = backbone.classifier[-1].in_features
            backbone.classifier[-1] = nn.Linear(in_features, DEFAULT_NUM_CLASSES)
            return backbone
        if architecture in DENSENET_VARIANTS:
            return DenseNetKeratitis(variant=architecture)
        raise ValueError(f"Unsupported architecture: {architecture}")

    def ensure_baseline_models(self) -> list[dict[str, Any]]:
        require_torch()
        baselines: list[dict[str, Any]] = []
        for template in DEFAULT_GLOBAL_MODELS:
            model_path = Path(template["model_path"])
            checkpoint_metadata: dict[str, Any] = {}
            if not model_path.exists():
                model_path.parent.mkdir(parents=True, exist_ok=True)
                model = self.build_model_pretrained(template["architecture"])
                checkpoint_metadata = self.build_artifact_metadata(
                    architecture=template["architecture"],
                    crop_mode="automated" if template.get("requires_medsam_crop", False) else "raw",
                    training_input_policy=(
                        "medsam_cornea_crop_only"
                        if template.get("requires_medsam_crop", False)
                        else "raw_or_model_defined"
                    ),
                )
                torch.save(
                    {
                        "architecture": template["architecture"],
                        "state_dict": model.state_dict(),
                        "artifact_metadata": checkpoint_metadata,
                    },
                    model_path,
                )
            else:
                try:
                    checkpoint = torch.load(model_path, map_location="cpu", weights_only=True)
                    checkpoint_metadata = self._checkpoint_metadata(checkpoint)
                except Exception:
                    checkpoint_metadata = {}
            resolved_preprocess = self.resolve_preprocess_metadata(template, checkpoint_metadata)
            resolved_signature = str(checkpoint_metadata.get("preprocess_signature") or "").strip() or _preprocess_signature_from_metadata(
                resolved_preprocess
            )
            sha256_value = self.artifact_store.sha256_file(model_path)
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
                    "requires_medsam_crop": template.get("requires_medsam_crop", False),
                    "training_input_policy": (
                        "medsam_cornea_crop_only" if template.get("requires_medsam_crop", False) else "raw_or_model_defined"
                    ),
                    "preprocess": resolved_preprocess,
                    "preprocess_signature": resolved_signature,
                    "num_classes": DEFAULT_NUM_CLASSES,
                    "decision_threshold": 0.5,
                    "threshold_selection_metric": "default",
                    "is_current": template.get("is_current", False),
                    "created_at": utc_now(),
                    "notes": template["notes"],
                    "notes_ko": template.get("notes_ko", template["notes"]),
                    "notes_en": template.get("notes_en", template["notes"]),
                    "ready": True,
                },
            )
        return baselines

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
        require_torch()
        resolved_reference = self.resolve_model_reference(model_reference, allow_download=True)
        architecture = resolved_reference.get("architecture", "densenet121")
        model_path = resolved_reference["model_path"]
        checkpoint = torch.load(model_path, map_location=device, weights_only=True)
        checkpoint_metadata = self.validate_model_artifact(resolved_reference, checkpoint)
        model = self.build_model(architecture).to(device)
        state_dict = self._extract_state_dict_from_checkpoint(checkpoint, architecture)
        strict = architecture not in DENSENET_VARIANTS
        model.load_state_dict(state_dict, strict=strict)
        model._kera_preprocess_metadata = self.resolve_preprocess_metadata(
            resolved_reference,
            checkpoint_metadata,
        )
        model.eval()
        return model

    def _extract_state_dict_from_checkpoint(self, checkpoint: Any, architecture: str) -> dict[str, Any]:
        """Load various checkpoint shapes into the model's expected key format."""
        if not isinstance(checkpoint, dict):
            try:
                state_dict = checkpoint.state_dict()
            except AttributeError:
                state_dict = checkpoint
        else:
            state_dict = None
            for key in ("state_dict", "model", "model_state_dict", "weights"):
                if key in checkpoint:
                    state_dict = checkpoint[key]
                    break
            if state_dict is None:
                state_dict = checkpoint

        if hasattr(state_dict, "items"):
            state_dict = dict(state_dict)
        if state_dict is None:
            raise ValueError("Checkpoint did not contain a readable state_dict.")

        if any(k.startswith("module.") for k in state_dict):
            state_dict = {k.replace("module.", "", 1): v for k, v in state_dict.items()}

        model = self.build_model(architecture)
        model_expects_prefix = any(k.startswith("model.") for k in model.state_dict())
        has_model_prefix = any(k.startswith("model.") for k in state_dict)
        if has_model_prefix and not model_expects_prefix:
            state_dict = {k.replace("model.", "", 1): v for k, v in state_dict.items()}
        elif not has_model_prefix and model_expects_prefix:
            state_dict = {f"model.{k}": v for k, v in state_dict.items()}

        return state_dict

    def predict_image(self, model: nn.Module, image_path: str | Path, device: str) -> Prediction:
        require_torch()
        _, tensor = preprocess_image(
            image_path,
            preprocess_metadata=self.model_preprocess_metadata(model),
        )
        tensor = tensor.to(device)
        model.eval()
        with torch.no_grad():
            logits = model(tensor)
            probabilities = torch.softmax(logits, dim=1).squeeze(0)
        pred_index = int(torch.argmax(probabilities).item())
        return Prediction(
            predicted_label=INDEX_TO_LABEL[pred_index],
            probability=float(probabilities[1].item()),
            logits=[float(value) for value in logits.squeeze(0).tolist()],
        )

    def extract_image_embedding(
        self,
        model: nn.Module,
        model_reference: dict[str, Any],
        image_path: str | Path,
        device: str,
    ) -> np.ndarray:
        require_torch()
        _, tensor = preprocess_image(
            image_path,
            preprocess_metadata=self.model_preprocess_metadata(model, model_reference),
        )
        tensor = tensor.to(device)
        model.eval()
        architecture = str(model_reference.get("architecture") or "densenet121")

        classifier_module = self._classifier_module(model, architecture)

        captured_inputs: list[torch.Tensor] = []

        def capture_pre_classifier_input(_module: nn.Module, inputs: tuple[torch.Tensor, ...]) -> None:
            if inputs:
                captured_inputs.append(inputs[0].detach())

        hook_handle = classifier_module.register_forward_pre_hook(capture_pre_classifier_input)
        try:
            with torch.no_grad():
                _ = model(tensor)
        finally:
            hook_handle.remove()

        if not captured_inputs:
            raise RuntimeError("Unable to extract the penultimate feature embedding from the model.")
        embedding = captured_inputs[0].reshape(captured_inputs[0].shape[0], -1)[0].cpu().numpy().astype(np.float32)
        return embedding

    def generate_explanation(
        self,
        model: nn.Module,
        model_reference: dict[str, Any],
        image_path: str | Path,
        device: str,
        output_path: str | Path,
        target_class: int | None = None,
    ) -> str:
        architecture = model_reference.get("architecture", "densenet121")
        return self._generate_cam_from_layer(
            model=model,
            preprocess_metadata=self.model_preprocess_metadata(model, model_reference),
            image_path=image_path,
            device=device,
            output_path=output_path,
            target_layer=self._gradcam_target_layer(model, architecture),
            target_class=target_class,
        )

    def _classifier_module(self, model: nn.Module, architecture: str) -> nn.Module:
        if architecture == "cnn":
            return model.classifier
        if architecture == "vit":
            return model.heads.head
        if architecture == "swin":
            return model.head
        if architecture == "convnext_tiny":
            return model.classifier[-1]
        if architecture == "efficientnet_v2_s":
            return model.classifier[-1]
        if architecture in DENSENET_VARIANTS:
            return model.classifier
        raise ValueError(f"Unsupported architecture: {architecture}")

    def _gradcam_target_layer(self, model: nn.Module, architecture: str) -> nn.Module:
        if architecture == "cnn":
            return model.features[-2]
        if architecture == "vit":
            return model.conv_proj
        if architecture == "swin":
            return model.features[-1]
        if architecture == "convnext_tiny":
            return model.features[-1]
        if architecture == "efficientnet_v2_s":
            return model.features[-1]
        if architecture in DENSENET_VARIANTS:
            return model.features.denseblock4 if hasattr(model.features, "denseblock4") else model.features
        raise ValueError(f"Unsupported architecture: {architecture}")

    def _normalize_cam_feature_map(self, tensor: torch.Tensor) -> torch.Tensor:
        if tensor.ndim != 3:
            raise RuntimeError(f"Grad-CAM target layer must produce a 3D feature map, got shape {tuple(tensor.shape)}.")
        if tensor.shape[0] <= tensor.shape[-1]:
            return tensor
        return tensor.permute(2, 0, 1).contiguous()

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
        require_torch()
        original_image, tensor = preprocess_image(image_path, preprocess_metadata=preprocess_metadata)
        tensor = tensor.to(device)
        model.eval()

        activations: list[torch.Tensor] = []
        gradients: list[torch.Tensor] = []

        def forward_hook(_module: nn.Module, _input: tuple[torch.Tensor, ...], output: torch.Tensor) -> None:
            activations.append(output.detach())

        def backward_hook(
            _module: nn.Module,
            grad_input: tuple[torch.Tensor, ...],
            grad_output: tuple[torch.Tensor, ...],
        ) -> None:
            del grad_input
            gradients.append(grad_output[0].detach())

        forward_handle = target_layer.register_forward_hook(forward_hook)
        backward_handle = target_layer.register_full_backward_hook(backward_hook)

        scores = model(tensor)
        if target_class is None:
            target_class = int(torch.argmax(scores, dim=1).item())
        model.zero_grad()
        scores[:, target_class].backward()

        forward_handle.remove()
        backward_handle.remove()

        activation = self._normalize_cam_feature_map(activations[-1][0])
        gradient = self._normalize_cam_feature_map(gradients[-1][0])
        weights = gradient.mean(dim=(1, 2), keepdim=True)
        cam = torch.relu((weights * activation).sum(dim=0)).cpu().numpy()
        cam = cam - cam.min()
        denominator = cam.max() if cam.max() > 0 else 1.0
        cam = cam / denominator

        overlay = self._overlay_heatmap(np.asarray(original_image), cam)
        output = Path(output_path)
        output.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(overlay).save(output)
        return str(output)

    def _overlay_heatmap(self, original_array: np.ndarray, heatmap: np.ndarray) -> np.ndarray:
        resized_heatmap = np.array(
            Image.fromarray((heatmap * 255).astype(np.uint8)).resize(
                (original_array.shape[1], original_array.shape[0]),
            ),
        )
        normalized = resized_heatmap.astype(np.float32) / 255.0
        # Keep the source image intact and emphasize only the hotter Grad-CAM regions.
        emphasis = np.clip((normalized - 0.35) / 0.65, 0.0, 1.0)
        alpha = np.where(emphasis > 0, 0.12 + emphasis * 0.43, 0.0).astype(np.float32)
        alpha = alpha[..., None]

        color = np.zeros_like(original_array, dtype=np.float32)
        color[..., 0] = 255.0
        color[..., 1] = 90.0 + emphasis * 120.0
        color[..., 2] = 20.0 + (1.0 - emphasis) * 35.0

        original = original_array.astype(np.float32)
        blended = original * (1.0 - alpha) + color * alpha
        return np.clip(blended, 0, 255).astype(np.uint8)

    def fine_tune(
        self,
        records: list[dict[str, Any]],
        base_model_reference: dict[str, Any],
        output_model_path: str | Path,
        device: str,
        full_finetune: bool,
        epochs: int,
    ) -> dict[str, Any]:
        require_torch()
        if not records:
            raise ValueError("No records are available for fine-tuning.")

        dataset = ManifestImageDataset(
            records,
            preprocess_metadata=self.resolve_preprocess_metadata(base_model_reference),
        )
        loader = DataLoader(dataset, batch_size=min(8, len(records)), shuffle=True)

        model = self.load_model(base_model_reference, device)
        architecture = base_model_reference.get("architecture", "densenet121")
        if not full_finetune:
            self._freeze_backbone(model, architecture)

        optimizer = torch.optim.Adam(
            [param for param in model.parameters() if param.requires_grad],
            lr=1e-3,
        )
        loss_fn = nn.CrossEntropyLoss()

        model.train()
        epoch_losses: list[float] = []
        for _ in range(max(1, epochs)):
            batch_losses: list[float] = []
            for batch_inputs, batch_labels in loader:
                batch_inputs = batch_inputs.to(device)
                batch_labels = batch_labels.to(device)
                optimizer.zero_grad()
                logits = model(batch_inputs)
                loss = loss_fn(logits, batch_labels)
                loss.backward()
                optimizer.step()
                batch_losses.append(float(loss.item()))
            epoch_losses.append(float(np.mean(batch_losses)) if batch_losses else math.nan)

        output = Path(output_model_path)
        output.parent.mkdir(parents=True, exist_ok=True)
        torch.save(
            {
                "architecture": architecture,
                "state_dict": model.state_dict(),
                "artifact_metadata": self.build_artifact_metadata(
                    architecture=architecture,
                    artifact_type="model",
                    crop_mode=str(base_model_reference.get("crop_mode") or ""),
                    training_input_policy=str(base_model_reference.get("training_input_policy") or ""),
                    preprocess_metadata=self.resolve_preprocess_metadata(base_model_reference),
                ),
            },
            output,
        )

        return {
            "training_id": make_id("train"),
            "output_model_path": str(output),
            "architecture": architecture,
            "epochs": int(max(1, epochs)),
            "full_finetune": bool(full_finetune),
            "average_loss": float(np.nanmean(epoch_losses)),
        }

    def _freeze_backbone(self, model: nn.Module, architecture: str) -> None:
        if architecture == "cnn":
            for parameter in model.features.parameters():
                parameter.requires_grad = False
            return
        if architecture == "vit":
            for parameter in model.parameters():
                parameter.requires_grad = False
            for parameter in model.heads.parameters():
                parameter.requires_grad = True
            return
        if architecture == "swin":
            for parameter in model.parameters():
                parameter.requires_grad = False
            for parameter in model.head.parameters():
                parameter.requires_grad = True
            return
        if architecture == "convnext_tiny":
            for parameter in model.parameters():
                parameter.requires_grad = False
            for parameter in model.classifier.parameters():
                parameter.requires_grad = True
            return
        if architecture == "efficientnet_v2_s":
            for parameter in model.parameters():
                parameter.requires_grad = False
            for parameter in model.classifier.parameters():
                parameter.requires_grad = True
            return
        if architecture in DENSENET_VARIANTS:
            for parameter in model.parameters():
                parameter.requires_grad = False
            for parameter in model.classifier.parameters():
                parameter.requires_grad = True
            return
        raise ValueError(f"Unsupported architecture: {architecture}")

    def build_model_pretrained(self, architecture: str, num_classes: int = 2) -> nn.Module:
        """ImageNet pretrained 가중치로 학습용 backbone을 초기화합니다."""
        require_torch()
        if not _TORCHVISION_AVAILABLE:
            raise RuntimeError("torchvision is required. Run: pip install torchvision")
        if architecture == "vit":
            from torchvision.models import ViT_B_16_Weights

            backbone = _torchvision_models.vit_b_16(weights=ViT_B_16_Weights.IMAGENET1K_V1)
            in_features = backbone.heads.head.in_features
            backbone.heads.head = nn.Linear(in_features, num_classes)
            return backbone
        if architecture == "swin":
            from torchvision.models import Swin_T_Weights

            backbone = _torchvision_models.swin_t(weights=Swin_T_Weights.IMAGENET1K_V1)
            in_features = backbone.head.in_features
            backbone.head = nn.Linear(in_features, num_classes)
            return backbone
        if architecture in DENSENET_VARIANTS:
            from torchvision.models import DenseNet121_Weights

            weight_map = {
                "densenet121": DenseNet121_Weights.IMAGENET1K_V1,
            }
            builder = getattr(_torchvision_models, architecture)
            backbone = builder(weights=weight_map[architecture])
            in_features = backbone.classifier.in_features
            backbone.classifier = nn.Linear(in_features, num_classes)
            model = DenseNetKeratitis.__new__(DenseNetKeratitis)
            nn.Module.__init__(model)
            model.model = backbone
            return model
        if architecture == "convnext_tiny":
            from torchvision.models import ConvNeXt_Tiny_Weights

            backbone = _torchvision_models.convnext_tiny(weights=ConvNeXt_Tiny_Weights.IMAGENET1K_V1)
            in_features = backbone.classifier[-1].in_features
            backbone.classifier[-1] = nn.Linear(in_features, num_classes)
            model = ConvNeXtTinyKeratitis.__new__(ConvNeXtTinyKeratitis)
            nn.Module.__init__(model)
            model.model = backbone
            return model
        if architecture == "efficientnet_v2_s":
            from torchvision.models import EfficientNet_V2_S_Weights

            backbone = _torchvision_models.efficientnet_v2_s(weights=EfficientNet_V2_S_Weights.IMAGENET1K_V1)
            in_features = backbone.classifier[-1].in_features
            backbone.classifier[-1] = nn.Linear(in_features, num_classes)
            return backbone
        raise ValueError(f"Pretrained loading is not supported for architecture: {architecture}.")

    def _split_ids_with_fallback(
        self,
        patient_ids: list[str],
        patient_labels: dict[str, str],
        test_size: int,
        seed: int,
    ) -> tuple[list[str], list[str]]:
        if test_size <= 0 or test_size >= len(patient_ids):
            raise ValueError("test_size must leave at least one patient on each side of the split.")
        labels = [patient_labels[patient_id] for patient_id in patient_ids]
        stratify_labels = labels if len(set(labels)) > 1 else None
        try:
            left_ids, right_ids = train_test_split(
                patient_ids,
                test_size=test_size,
                random_state=seed,
                stratify=stratify_labels,
            )
        except ValueError:
            shuffled = patient_ids[:]
            random.Random(seed).shuffle(shuffled)
            right_ids = shuffled[:test_size]
            left_ids = shuffled[test_size:]
        return list(left_ids), list(right_ids)

    def _build_patient_split(
        self,
        patient_ids: list[str],
        patient_labels: dict[str, str],
        val_split: float,
        test_split: float,
        saved_split: dict[str, Any] | None = None,
        seed: int = 42,
    ) -> dict[str, Any]:
        unique_patient_ids = list(dict.fromkeys(patient_ids))
        if len(unique_patient_ids) < 4:
            raise ValueError(f"At least 4 patients are required (current: {len(unique_patient_ids)}).")

        if saved_split:
            train_ids = [
                patient_id
                for patient_id in saved_split.get("train_patient_ids", [])
                if patient_id in unique_patient_ids
            ]
            val_ids = [
                patient_id
                for patient_id in saved_split.get("val_patient_ids", [])
                if patient_id in unique_patient_ids
            ]
            test_ids = [
                patient_id
                for patient_id in saved_split.get("test_patient_ids", [])
                if patient_id in unique_patient_ids
            ]
            assigned = set(train_ids + val_ids + test_ids)
            new_ids = [patient_id for patient_id in unique_patient_ids if patient_id not in assigned]
            train_ids.extend(new_ids)
            if train_ids and val_ids and test_ids:
                return {
                    **saved_split,
                    "train_patient_ids": train_ids,
                    "val_patient_ids": val_ids,
                    "test_patient_ids": test_ids,
                    "n_train_patients": len(train_ids),
                    "n_val_patients": len(val_ids),
                    "n_test_patients": len(test_ids),
                    "total_patients": len(unique_patient_ids),
                    "updated_at": utc_now(),
                }

        test_count = max(1, int(round(len(unique_patient_ids) * test_split)))
        test_count = min(test_count, len(unique_patient_ids) - 2)
        train_val_ids, test_ids = self._split_ids_with_fallback(unique_patient_ids, patient_labels, test_count, seed)

        val_count = max(1, int(round(len(unique_patient_ids) * val_split)))
        val_count = min(val_count, len(train_val_ids) - 1)
        train_ids, val_ids = self._split_ids_with_fallback(train_val_ids, patient_labels, val_count, seed + 1)

        return {
            "split_id": make_id("split"),
            "strategy": "patient_level_fixed_train_val_test",
            "split_seed": seed,
            "val_split": float(val_split),
            "test_split": float(test_split),
            "train_patient_ids": train_ids,
            "val_patient_ids": val_ids,
            "test_patient_ids": test_ids,
            "n_train_patients": len(train_ids),
            "n_val_patients": len(val_ids),
            "n_test_patients": len(test_ids),
            "total_patients": len(unique_patient_ids),
            "created_at": utc_now(),
        }

    def _predicted_labels_from_threshold(
        self,
        positive_probabilities: list[float],
        threshold: float = 0.5,
    ) -> list[int]:
        normalized_threshold = min(max(float(threshold), 0.0), 1.0)
        return [1 if float(probability) >= normalized_threshold else 0 for probability in positive_probabilities]

    def _collect_loader_outputs(
        self,
        model: nn.Module,
        loader: DataLoader,
        device: str,
    ) -> dict[str, list[float] | list[int]]:
        require_torch()
        model.eval()
        true_labels: list[int] = []
        positive_probabilities: list[float] = []
        with torch.no_grad():
            for batch_inputs, batch_labels in loader:
                batch_inputs = batch_inputs.to(device)
                batch_labels = batch_labels.to(device)
                logits = model(batch_inputs)
                probabilities = torch.softmax(logits, dim=1)
                true_labels.extend(int(value) for value in batch_labels.tolist())
                positive_probabilities.extend(float(value) for value in probabilities[:, 1].tolist())
        return {
            "true_labels": true_labels,
            "positive_probabilities": positive_probabilities,
        }

    def _evaluate_loader(
        self,
        model: nn.Module,
        loader: DataLoader,
        device: str,
        threshold: float = 0.5,
    ) -> dict[str, Any]:
        outputs = self._collect_loader_outputs(model, loader, device)
        true_labels = [int(value) for value in outputs["true_labels"]]
        positive_probabilities = [float(value) for value in outputs["positive_probabilities"]]
        predicted_labels = self._predicted_labels_from_threshold(positive_probabilities, threshold=threshold)
        metrics = self.classification_metrics(
            true_labels,
            predicted_labels,
            positive_probabilities,
            threshold=threshold,
        )
        metrics["n_samples"] = len(true_labels)
        return metrics

    def select_decision_threshold(
        self,
        true_labels: list[int],
        positive_probabilities: list[float],
    ) -> dict[str, Any]:
        if not true_labels or not positive_probabilities or len(true_labels) != len(positive_probabilities):
            metrics = self.classification_metrics(true_labels, [], positive_probabilities, threshold=0.5)
            return {
                "decision_threshold": 0.5,
                "selection_metric": "default",
                "selection_metrics": metrics,
            }

        unique_probabilities = sorted({min(max(float(value), 0.0), 1.0) for value in positive_probabilities})
        threshold_candidates: set[float] = {0.5}
        threshold_candidates.update(unique_probabilities)
        threshold_candidates.update(
            round((left + right) / 2.0, 6)
            for left, right in zip(unique_probabilities, unique_probabilities[1:])
        )

        best_result: dict[str, Any] | None = None
        for threshold in sorted(threshold_candidates):
            metrics = self.classification_metrics(true_labels, [], positive_probabilities, threshold=threshold)
            score_tuple = (
                float(metrics.get("balanced_accuracy") or 0.0),
                float(metrics.get("F1") or 0.0),
                float(metrics.get("accuracy") or 0.0),
                float(metrics["AUROC"]) if metrics.get("AUROC") is not None else -1.0,
                -abs(float(threshold) - 0.5),
            )
            candidate = {
                "decision_threshold": float(threshold),
                "selection_metric": "balanced_accuracy",
                "selection_metrics": metrics,
                "score_tuple": score_tuple,
            }
            if best_result is None or candidate["score_tuple"] > best_result["score_tuple"]:
                best_result = candidate

        assert best_result is not None
        best_result.pop("score_tuple", None)
        return best_result

    def _build_cross_validation_splits(
        self,
        patient_ids: list[str],
        patient_labels: dict[str, str],
        num_folds: int,
        val_split: float,
        seed: int = 42,
    ) -> list[dict[str, Any]]:
        unique_patient_ids = list(dict.fromkeys(patient_ids))
        if len(unique_patient_ids) < num_folds:
            raise ValueError(f"At least {num_folds} patients are required for {num_folds}-fold cross-validation.")

        label_list = [patient_labels[patient_id] for patient_id in unique_patient_ids]
        label_counts = pd.Series(label_list).value_counts().to_dict()
        use_stratified = len(set(label_list)) > 1 and min(label_counts.values()) >= num_folds

        if use_stratified:
            splitter = StratifiedKFold(n_splits=num_folds, shuffle=True, random_state=seed)
            split_iter = splitter.split(unique_patient_ids, label_list)
        else:
            shuffled_ids = unique_patient_ids[:]
            random.Random(seed).shuffle(shuffled_ids)
            fold_buckets = [[] for _ in range(num_folds)]
            for index, patient_id in enumerate(shuffled_ids):
                fold_buckets[index % num_folds].append(patient_id)
            split_iter = []
            for fold_index in range(num_folds):
                test_ids = fold_buckets[fold_index]
                train_ids = [patient_id for idx, bucket in enumerate(fold_buckets) if idx != fold_index for patient_id in bucket]
                split_iter.append((train_ids, test_ids))

        folds: list[dict[str, Any]] = []
        for fold_index, split in enumerate(split_iter, start=1):
            if use_stratified:
                train_val_idx, test_idx = split
                train_val_ids = [unique_patient_ids[index] for index in train_val_idx.tolist()]
                test_ids = [unique_patient_ids[index] for index in test_idx.tolist()]
            else:
                train_val_ids, test_ids = split
            if len(train_val_ids) < 2 or not test_ids:
                raise ValueError("Cross-validation fold construction failed. Not enough patients in a fold.")
            val_count = max(1, int(round(len(train_val_ids) * val_split)))
            val_count = min(val_count, len(train_val_ids) - 1)
            train_ids, val_ids = self._split_ids_with_fallback(train_val_ids, patient_labels, val_count, seed + fold_index)
            folds.append(
                {
                    "split_id": make_id("cvsplit"),
                    "strategy": "patient_level_cross_validation",
                    "fold_index": fold_index,
                    "num_folds": num_folds,
                    "split_seed": seed,
                    "val_split": float(val_split),
                    "test_split": len(test_ids) / len(unique_patient_ids),
                    "train_patient_ids": train_ids,
                    "val_patient_ids": val_ids,
                    "test_patient_ids": test_ids,
                    "n_train_patients": len(train_ids),
                    "n_val_patients": len(val_ids),
                    "n_test_patients": len(test_ids),
                    "total_patients": len(unique_patient_ids),
                    "created_at": utc_now(),
                }
            )
        return folds

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
        saved_split: dict[str, Any] | None = None,
        crop_mode: str | None = None,
        training_input_policy: str | None = None,
        progress_callback: Any = None,
    ) -> dict[str, Any]:
        """처음부터 학습 가능한 backbone을 학습합니다 (ImageNet pretrained 권장).

        Args:
            records: manifest 레코드 리스트
            architecture: 지원되는 training architecture 이름
            output_model_path: 저장 경로
            device: cpu / cuda
            epochs: 학습 에포크
            learning_rate: 초기 학습률
            batch_size: 배치 크기
            val_split: validation 비율 (0~1)
            use_pretrained: ImageNet 초기화 사용 여부
            progress_callback: (epoch, total, train_loss, val_acc) → None
        """
        require_torch()
        if len(records) < 4:
            raise ValueError(f"최소 4개 케이스가 필요합니다 (현재 {len(records)}개).")

        seed_everything(42)
        patient_to_records: dict[str, list[dict[str, Any]]] = {}
        patient_to_label: dict[str, str] = {}
        for record in records:
            patient_id = str(record["patient_id"])
            patient_to_records.setdefault(patient_id, []).append(record)
            patient_to_label.setdefault(patient_id, str(record["culture_category"]))

        patient_ids = list(patient_to_records)
        if len(patient_ids) < 4:
            raise ValueError(f"최소 4명의 환자가 필요합니다 (현재 {len(patient_ids)}명).")

        patient_split = self._build_patient_split(
            patient_ids=patient_ids,
            patient_labels=patient_to_label,
            val_split=val_split,
            test_split=test_split,
            saved_split=saved_split,
            seed=42,
        )
        train_patient_ids = patient_split["train_patient_ids"]
        val_patient_ids = patient_split["val_patient_ids"]
        test_patient_ids = patient_split["test_patient_ids"]

        train_records = [record for patient_id in train_patient_ids for record in patient_to_records[patient_id]]
        val_records = [record for patient_id in val_patient_ids for record in patient_to_records[patient_id]]
        test_records = [record for patient_id in test_patient_ids for record in patient_to_records[patient_id]]

        preprocess_metadata = self.preprocess_metadata()
        train_ds = ManifestImageDataset(train_records, augment=True, preprocess_metadata=preprocess_metadata)
        val_ds = ManifestImageDataset(val_records, augment=False, preprocess_metadata=preprocess_metadata)
        test_ds = ManifestImageDataset(test_records, augment=False, preprocess_metadata=preprocess_metadata)
        bs = max(1, min(batch_size, len(train_records)))
        train_loader = DataLoader(train_ds, batch_size=bs, shuffle=True)
        val_loader = DataLoader(val_ds, batch_size=bs, shuffle=False)
        test_loader = DataLoader(test_ds, batch_size=max(1, min(batch_size, len(test_records))), shuffle=False)

        # 모델 초기화
        if use_pretrained and architecture in {"vit", "swin", "convnext_tiny", "efficientnet_v2_s", *DENSENET_VARIANTS}:
            model = self.build_model_pretrained(architecture).to(device)
        else:
            model = self.build_model(architecture).to(device)

        optimizer = torch.optim.Adam(model.parameters(), lr=learning_rate, weight_decay=1e-4)
        scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs, eta_min=1e-6)
        class_counts = np.bincount(
            [LABEL_TO_INDEX[item["culture_category"]] for item in train_records],
            minlength=len(LABEL_TO_INDEX),
        )
        class_weights = np.array(
            [0.0 if count == 0 else len(train_records) / (len(LABEL_TO_INDEX) * count) for count in class_counts],
            dtype=np.float32,
        )
        loss_fn = nn.CrossEntropyLoss(weight=torch.tensor(class_weights, device=device))

        best_val_acc = 0.0
        best_state: dict[str, Any] = {}
        history: list[dict[str, Any]] = []

        for epoch in range(1, epochs + 1):
            # Train
            model.train()
            train_losses: list[float] = []
            for batch_inputs, batch_labels in train_loader:
                batch_inputs = batch_inputs.to(device)
                batch_labels = batch_labels.to(device)
                optimizer.zero_grad()
                loss = loss_fn(model(batch_inputs), batch_labels)
                loss.backward()
                optimizer.step()
                train_losses.append(float(loss.item()))
            scheduler.step()

            # Validation
            model.eval()
            correct = 0
            total = 0
            with torch.no_grad():
                for batch_inputs, batch_labels in val_loader:
                    batch_inputs = batch_inputs.to(device)
                    batch_labels = batch_labels.to(device)
                    preds = torch.argmax(model(batch_inputs), dim=1)
                    correct += int((preds == batch_labels).sum().item())
                    total += len(batch_labels)

            train_loss = float(np.mean(train_losses)) if train_losses else math.nan
            val_acc = correct / total if total > 0 else 0.0
            history.append({"epoch": epoch, "train_loss": train_loss, "val_acc": val_acc})

            if val_acc >= best_val_acc:
                best_val_acc = val_acc
                best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}

            if progress_callback:
                progress_callback(epoch, epochs, train_loss, val_acc)

        output = Path(output_model_path)
        output.parent.mkdir(parents=True, exist_ok=True)
        model.load_state_dict(best_state)
        val_outputs = self._collect_loader_outputs(model, val_loader, device)
        threshold_selection = self.select_decision_threshold(
            [int(value) for value in val_outputs["true_labels"]],
            [float(value) for value in val_outputs["positive_probabilities"]],
        )
        decision_threshold = float(threshold_selection["decision_threshold"])
        val_metrics = self.classification_metrics(
            [int(value) for value in val_outputs["true_labels"]],
            [],
            [float(value) for value in val_outputs["positive_probabilities"]],
            threshold=decision_threshold,
        )
        val_metrics["n_samples"] = len(val_outputs["true_labels"])
        test_metrics = self._evaluate_loader(model, test_loader, device, threshold=decision_threshold)
        torch.save(
            {
                "architecture": architecture,
                "state_dict": best_state,
                "artifact_metadata": self.build_artifact_metadata(
                    architecture=architecture,
                    artifact_type="model",
                    crop_mode=crop_mode,
                    training_input_policy=training_input_policy,
                ),
            },
            output,
        )

        return {
            "training_id": make_id("train"),
            "output_model_path": str(output),
            "architecture": architecture,
            "epochs": epochs,
            "n_train": len(train_records),
            "n_val": len(val_records),
            "n_test": len(test_records),
            "n_train_patients": len(train_patient_ids),
            "n_val_patients": len(val_patient_ids),
            "n_test_patients": len(test_patient_ids),
            "best_val_acc": round(best_val_acc, 4),
            "use_pretrained": use_pretrained,
            "history": history,
            "patient_split": patient_split,
            "decision_threshold": decision_threshold,
            "threshold_selection_metric": threshold_selection["selection_metric"],
            "threshold_selection_metrics": threshold_selection["selection_metrics"],
            "val_metrics": val_metrics,
            "test_metrics": test_metrics,
        }

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
        progress_callback: Any = None,
    ) -> dict[str, Any]:
        patient_labels = {
            str(record["patient_id"]): str(record["culture_category"])
            for record in records
        }
        patient_ids = list(dict.fromkeys(str(record["patient_id"]) for record in records))
        folds = self._build_cross_validation_splits(
            patient_ids=patient_ids,
            patient_labels=patient_labels,
            num_folds=num_folds,
            val_split=val_split,
            seed=42,
        )

        output_root = Path(output_dir)
        output_root.mkdir(parents=True, exist_ok=True)
        fold_results: list[dict[str, Any]] = []

        for fold in folds:
            fold_output_path = output_root / f"{architecture}_fold{fold['fold_index']}.pth"
            if progress_callback:
                progress_callback(
                    {
                        "stage": "preparing_fold",
                        "fold_index": fold["fold_index"],
                        "num_folds": num_folds,
                    }
                )

            def fold_progress_callback(epoch: int, total_epochs: int, train_loss: float, val_acc: float) -> None:
                if progress_callback:
                    progress_callback(
                        {
                            "stage": "training_fold",
                            "fold_index": fold["fold_index"],
                            "num_folds": num_folds,
                            "epoch": epoch,
                            "epochs": total_epochs,
                            "train_loss": train_loss,
                            "val_acc": val_acc,
                        }
                    )

            train_result = self.initial_train(
                records=records,
                architecture=architecture,
                output_model_path=fold_output_path,
                device=device,
                epochs=epochs,
                learning_rate=learning_rate,
                batch_size=batch_size,
                val_split=val_split,
                test_split=fold["test_split"],
                use_pretrained=use_pretrained,
                saved_split=fold,
                progress_callback=fold_progress_callback,
            )
            fold_results.append(
                {
                    "fold_index": fold["fold_index"],
                    "output_model_path": train_result["output_model_path"],
                    "n_train_patients": train_result["n_train_patients"],
                    "n_val_patients": train_result["n_val_patients"],
                    "n_test_patients": train_result["n_test_patients"],
                    "n_train": train_result["n_train"],
                    "n_val": train_result["n_val"],
                    "n_test": train_result["n_test"],
                    "best_val_acc": train_result["best_val_acc"],
                    "val_metrics": train_result["val_metrics"],
                    "test_metrics": train_result["test_metrics"],
                    "patient_split": train_result["patient_split"],
                }
            )

        aggregate_metrics: dict[str, dict[str, float | None]] = {}
        for metric_name in ["AUROC", "accuracy", "sensitivity", "specificity", "F1", "balanced_accuracy", "brier_score", "ece"]:
            metric_values = [
                float(fold["test_metrics"][metric_name])
                for fold in fold_results
                if fold["test_metrics"].get(metric_name) is not None
            ]
            aggregate_metrics[metric_name] = {
                "mean": round(float(np.mean(metric_values)), 4) if metric_values else None,
                "std": round(float(np.std(metric_values)), 4) if metric_values else None,
            }

        return {
            "cross_validation_id": make_id("cv"),
            "architecture": architecture,
            "num_folds": num_folds,
            "epochs": epochs,
            "val_split": float(val_split),
            "use_pretrained": use_pretrained,
            "fold_results": fold_results,
            "aggregate_metrics": aggregate_metrics,
            "total_patients": len(patient_ids),
            "total_records": len(records),
            "created_at": utc_now(),
        }

    def save_weight_delta(
        self,
        base_model_path: str | Path,
        tuned_model_path: str | Path,
        output_delta_path: str | Path,
    ) -> str:
        require_torch()
        tuned_checkpoint = torch.load(tuned_model_path, map_location="cpu", weights_only=True)
        architecture = tuned_checkpoint.get("architecture", "densenet121") if isinstance(tuned_checkpoint, dict) else "densenet121"
        base_checkpoint = torch.load(base_model_path, map_location="cpu", weights_only=True)
        tuned_metadata = self._checkpoint_metadata(tuned_checkpoint)
        base_state = self._extract_state_dict_from_checkpoint(base_checkpoint, architecture)
        tuned_state = self._extract_state_dict_from_checkpoint(tuned_checkpoint, architecture)
        delta_state = {key: tuned_state[key] - base_state[key] for key in base_state}
        output = Path(output_delta_path)
        output.parent.mkdir(parents=True, exist_ok=True)
        torch.save(
            {
                "architecture": architecture,
                "state_dict": delta_state,
                "artifact_metadata": self.build_artifact_metadata(
                    architecture=architecture,
                    artifact_type="weight_delta",
                    preprocess_metadata=self.resolve_preprocess_metadata(checkpoint_metadata=tuned_metadata),
                ),
            },
            output,
        )
        return str(output)

    def _validate_deltas(self, deltas: list[dict]) -> None:
        """Reject deltas containing NaN/Inf or statistical outliers (poisoning guard)."""
        if not deltas:
            return
        reference_keys = set(deltas[0].keys())
        norms: list[float] = []
        for i, delta in enumerate(deltas):
            if set(delta.keys()) != reference_keys:
                raise ValueError(f"Delta {i} has mismatched layer keys — cannot aggregate.")
            total_norm = 0.0
            for key, tensor in delta.items():
                t = tensor.float()
                if torch.isnan(t).any() or torch.isinf(t).any():
                    raise ValueError(f"Delta {i} contains NaN or Inf in layer '{key}' — rejecting.")
                total_norm += float(t.norm().item()) ** 2
            norms.append(total_norm ** 0.5)

        if len(norms) >= 2:
            median_norm = float(np.median(norms))
            if median_norm > 0:
                for i, norm in enumerate(norms):
                    if norm > 10.0 * median_norm:
                        raise ValueError(
                            f"Delta {i} L2 norm ({norm:.4f}) is more than 10× the median norm "
                            f"({median_norm:.4f}). Possible poisoning — rejecting aggregation."
                        )

    def aggregate_weight_deltas(
        self,
        delta_paths: list[str | Path],
        output_path: str | Path,
        weights: list[float] | None = None,
        base_model_path: str | Path | None = None,
    ) -> str:
        require_torch()
        if not delta_paths:
            raise ValueError("At least one delta path is required.")
        delta_checkpoints = [torch.load(path, map_location="cpu", weights_only=True) for path in delta_paths]
        deltas = [checkpoint["state_dict"] for checkpoint in delta_checkpoints]
        self._validate_deltas(deltas)
        keys = deltas[0].keys()
        if weights is None:
            weights_tensor = torch.full((len(deltas),), 1.0 / len(deltas), dtype=torch.float32)
        else:
            if len(weights) != len(deltas):
                raise ValueError("weights length must match delta_paths length.")
            weights_tensor = torch.tensor(weights, dtype=torch.float32)
            weights_tensor = weights_tensor / weights_tensor.sum()

        aggregated = {}
        for key in keys:
            stacked = torch.stack([delta[key] for delta in deltas], dim=0)
            view_shape = [len(deltas)] + [1] * (stacked.ndim - 1)
            aggregated[key] = (stacked * weights_tensor.view(*view_shape)).sum(dim=0)

        architecture = delta_checkpoints[0].get("architecture", "densenet121")
        reference_metadata = self._checkpoint_metadata(delta_checkpoints[0])
        state_dict_to_save = aggregated
        if base_model_path is not None:
            base_checkpoint = torch.load(base_model_path, map_location="cpu", weights_only=True)
            reference_metadata = self._checkpoint_metadata(base_checkpoint) or reference_metadata
            base_state = self._extract_state_dict_from_checkpoint(base_checkpoint, architecture)
            state_dict_to_save = {
                key: base_state[key] + aggregated[key]
                for key in base_state
            }

        output = Path(output_path)
        output.parent.mkdir(parents=True, exist_ok=True)
        torch.save(
            {
                "architecture": architecture,
                "state_dict": state_dict_to_save,
                "artifact_metadata": self.build_artifact_metadata(
                    architecture=architecture,
                    artifact_type="model" if base_model_path is not None else "weight_delta",
                    preprocess_metadata=self.resolve_preprocess_metadata(checkpoint_metadata=reference_metadata),
                ),
            },
            output,
        )
        return str(output)

    def classification_metrics(
        self,
        true_labels: list[int],
        predicted_labels: list[int],
        positive_probabilities: list[float],
        threshold: float | None = None,
    ) -> dict[str, Any]:
        if threshold is not None:
            predicted_labels = self._predicted_labels_from_threshold(positive_probabilities, threshold=threshold)
        accuracy = float(accuracy_score(true_labels, predicted_labels)) if true_labels else 0.0
        f1 = float(f1_score(true_labels, predicted_labels, zero_division=0)) if true_labels else 0.0

        true_positive = sum(1 for t, p in zip(true_labels, predicted_labels) if t == 1 and p == 1)
        true_negative = sum(1 for t, p in zip(true_labels, predicted_labels) if t == 0 and p == 0)
        false_positive = sum(1 for t, p in zip(true_labels, predicted_labels) if t == 0 and p == 1)
        false_negative = sum(1 for t, p in zip(true_labels, predicted_labels) if t == 1 and p == 0)

        sensitivity = true_positive / (true_positive + false_negative) if (true_positive + false_negative) else 0.0
        specificity = true_negative / (true_negative + false_positive) if (true_negative + false_positive) else 0.0
        balanced_accuracy = float((sensitivity + specificity) / 2.0)
        confusion = confusion_matrix(true_labels, predicted_labels, labels=[0, 1]).tolist() if true_labels else [[0, 0], [0, 0]]

        auroc = None
        roc = None
        if len(set(true_labels)) > 1:
            auroc = float(roc_auc_score(true_labels, positive_probabilities))
            fpr, tpr, thresholds = roc_curve(true_labels, positive_probabilities)
            roc = {
                "fpr": [float(value) for value in fpr.tolist()],
                "tpr": [float(value) for value in tpr.tolist()],
                "thresholds": [
                    None if not math.isfinite(float(value)) else float(value)
                    for value in thresholds.tolist()
                ],
            }

        brier_score = (
            float(np.mean([(float(probability) - float(label)) ** 2 for label, probability in zip(true_labels, positive_probabilities)]))
            if true_labels
            else None
        )
        calibration_bins: list[dict[str, Any]] = []
        ece = 0.0
        if true_labels and positive_probabilities:
            n_bins = 10
            total = len(true_labels)
            for bin_index in range(n_bins):
                lower = bin_index / n_bins
                upper = (bin_index + 1) / n_bins
                if bin_index == n_bins - 1:
                    members = [
                        (float(probability), int(label))
                        for label, probability in zip(true_labels, positive_probabilities)
                        if lower <= float(probability) <= upper
                    ]
                else:
                    members = [
                        (float(probability), int(label))
                        for label, probability in zip(true_labels, positive_probabilities)
                        if lower <= float(probability) < upper
                    ]
                if not members:
                    continue
                mean_confidence = float(np.mean([member[0] for member in members]))
                positive_rate = float(np.mean([member[1] for member in members]))
                fraction = len(members) / total
                ece += fraction * abs(positive_rate - mean_confidence)
                calibration_bins.append(
                    {
                        "bin_start": round(lower, 4),
                        "bin_end": round(upper, 4),
                        "count": len(members),
                        "mean_confidence": round(mean_confidence, 4),
                        "positive_rate": round(positive_rate, 4),
                    }
                )

        return {
            "AUROC": auroc,
            "accuracy": accuracy,
            "sensitivity": float(sensitivity),
            "specificity": float(specificity),
            "balanced_accuracy": balanced_accuracy,
            "F1": f1,
            "brier_score": brier_score,
            "ece": round(float(ece), 6) if calibration_bins else None,
            "decision_threshold": float(threshold) if threshold is not None else None,
            "confusion_matrix": {
                "labels": ["bacterial", "fungal"],
                "matrix": confusion,
            },
            "roc_curve": roc,
            "calibration": {
                "n_bins": 10,
                "bins": calibration_bins,
            },
        }
