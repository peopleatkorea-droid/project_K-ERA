from __future__ import annotations

import math
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import numpy as np
from PIL import Image
from sklearn.metrics import accuracy_score, f1_score, roc_auc_score
from sklearn.model_selection import train_test_split

from kera_research.config import DEFAULT_GLOBAL_MODELS
from kera_research.domain import DENSENET_VARIANTS, INDEX_TO_LABEL, LABEL_TO_INDEX, make_id, utc_now

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

else:  # pragma: no cover - dependency guard
    class TinyKeratitisCNN:  # type: ignore[override]
        pass

    class TinyPatchViT:  # type: ignore[override]
        pass

    class TinySwinLike:  # type: ignore[override]
        pass

    class DenseNetKeratitis:  # type: ignore[override]
        pass


def preprocess_image(image_path: str | Path, image_size: int = 224) -> tuple[Image.Image, torch.Tensor]:
    require_torch()
    image = Image.open(image_path).convert("RGB")
    resized = image.resize((image_size, image_size))
    array = np.asarray(resized, dtype=np.float32) / 255.0
    tensor = torch.from_numpy(array.transpose(2, 0, 1)).unsqueeze(0)
    return image, tensor


def _augment_tensor(tensor: torch.Tensor) -> torch.Tensor:
    """학습용 간단한 augmentation (horizontal flip, 밝기/대비 jitter)."""
    if random.random() < 0.5:
        tensor = torch.flip(tensor, dims=[2])
    if random.random() < 0.5:
        tensor = torch.flip(tensor, dims=[1])
    brightness = random.uniform(0.8, 1.2)
    contrast = random.uniform(0.8, 1.2)
    tensor = torch.clamp(tensor * brightness, 0.0, 1.0)
    mean = tensor.mean()
    tensor = torch.clamp((tensor - mean) * contrast + mean, 0.0, 1.0)
    return tensor


class ManifestImageDataset(Dataset):
    def __init__(self, records: Iterable[dict[str, Any]], augment: bool = False) -> None:
        self.records = list(records)
        self.augment = augment

    def __len__(self) -> int:
        return len(self.records)

    def __getitem__(self, index: int) -> tuple[torch.Tensor, torch.Tensor]:
        _, tensor = preprocess_image(self.records[index]["image_path"])
        tensor = tensor.squeeze(0)
        if self.augment:
            tensor = _augment_tensor(tensor)
        label_value = LABEL_TO_INDEX[self.records[index]["culture_category"]]
        return tensor, torch.tensor(label_value, dtype=torch.long)


@dataclass
class Prediction:
    predicted_label: str
    probability: float
    logits: list[float]


class ModelManager:
    def __init__(self) -> None:
        seed_everything()

    def build_model(self, architecture: str) -> nn.Module:
        require_torch()
        if architecture == "cnn":
            return TinyKeratitisCNN()
        if architecture == "vit":
            return TinyPatchViT()
        if architecture == "swin":
            return TinySwinLike()
        if architecture in DENSENET_VARIANTS:
            return DenseNetKeratitis(variant=architecture)
        raise ValueError(f"Unsupported architecture: {architecture}")

    def ensure_baseline_models(self) -> list[dict[str, Any]]:
        require_torch()
        baselines: list[dict[str, Any]] = []
        for template in DEFAULT_GLOBAL_MODELS:
            model_path = Path(template["model_path"])
            # DenseNet 글로벌 모델은 .pth 파일로 제공됩니다.
            # 파일이 없으면 등록은 하되, 랜덤 초기화 모델을 자동 생성하지 않습니다.
            # (사용자가 직접 .pth 파일을 models/ 폴더에 넣어야 합니다.)
            if not model_path.exists():
                if template["architecture"] in DENSENET_VARIANTS:
                    baselines.append(
                        {
                            "version_id": template["version_id"],
                            "version_name": template["version_name"],
                            "architecture": template["architecture"],
                            "stage": "global",
                            "base_version_id": None,
                            "model_path": str(model_path),
                            "requires_medsam_crop": template.get("requires_medsam_crop", False),
                            "training_input_policy": (
                                "medsam_roi_crop_only" if template.get("requires_medsam_crop", False) else "raw_or_model_defined"
                            ),
                            "is_current": template.get("is_current", False),
                            "created_at": utc_now(),
                            "notes": template["notes"],
                            "notes_ko": template.get("notes_ko", template["notes"]),
                            "notes_en": template.get("notes_en", template["notes"]),
                            "ready": False,
                        }
                    )
                    continue
                model = self.build_model(template["architecture"])
                torch.save(
                    {
                        "architecture": template["architecture"],
                        "state_dict": model.state_dict(),
                    },
                    model_path,
                )
            baselines.append(
                {
                    "version_id": template["version_id"],
                    "version_name": template["version_name"],
                    "architecture": template["architecture"],
                    "stage": "global",
                    "base_version_id": None,
                    "model_path": str(model_path),
                    "requires_medsam_crop": template.get("requires_medsam_crop", False),
                    "training_input_policy": (
                        "medsam_roi_crop_only" if template.get("requires_medsam_crop", False) else "raw_or_model_defined"
                    ),
                    "is_current": template.get("is_current", False),
                    "created_at": utc_now(),
                    "notes": template["notes"],
                    "notes_ko": template.get("notes_ko", template["notes"]),
                    "notes_en": template.get("notes_en", template["notes"]),
                    "ready": True,
                },
            )
        return baselines

    def load_model(self, model_reference: dict[str, Any], device: str) -> nn.Module:
        require_torch()
        architecture = model_reference.get("architecture", "cnn")
        model_path = model_reference["model_path"]
        checkpoint = torch.load(model_path, map_location=device, weights_only=False)
        model = self.build_model(architecture).to(device)
        state_dict = self._extract_state_dict_from_checkpoint(checkpoint, architecture)
        strict = architecture not in DENSENET_VARIANTS
        model.load_state_dict(state_dict, strict=strict)
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
        _, tensor = preprocess_image(image_path)
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

    def generate_explanation(
        self,
        model: nn.Module,
        model_reference: dict[str, Any],
        image_path: str | Path,
        device: str,
        output_path: str | Path,
        target_class: int | None = None,
    ) -> str:
        architecture = model_reference.get("architecture", "cnn")
        if architecture == "cnn":
            return self._generate_cam_from_layer(
                model=model,
                image_path=image_path,
                device=device,
                output_path=output_path,
                target_layer=model.features[-2],
                target_class=target_class,
            )
        if architecture == "vit":
            return self._generate_cam_from_layer(
                model=model,
                image_path=image_path,
                device=device,
                output_path=output_path,
                target_layer=model.patch_embed,
                target_class=target_class,
            )
        if architecture == "swin":
            return self._generate_cam_from_layer(
                model=model,
                image_path=image_path,
                device=device,
                output_path=output_path,
                target_layer=model.stage3[-1],
                target_class=target_class,
            )
        if architecture in DENSENET_VARIANTS:
            # DenseNet: 마지막 denseblock의 마지막 레이어를 CAM 타겟으로 사용
            target_layer = model.features.denseblock4 if hasattr(model.features, "denseblock4") else model.features
            return self._generate_cam_from_layer(
                model=model,
                image_path=image_path,
                device=device,
                output_path=output_path,
                target_layer=target_layer,
                target_class=target_class,
            )
        raise ValueError(f"Unsupported architecture: {architecture}")

    def _generate_cam_from_layer(
        self,
        model: nn.Module,
        image_path: str | Path,
        device: str,
        output_path: str | Path,
        target_layer: nn.Module,
        target_class: int | None = None,
    ) -> str:
        require_torch()
        original_image, tensor = preprocess_image(image_path)
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

        activation = activations[-1][0]
        gradient = gradients[-1][0]
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
        color = np.zeros_like(original_array, dtype=np.float32)
        color[..., 0] = normalized * 255.0
        color[..., 1] = np.sqrt(normalized) * 110.0
        color[..., 2] = (1.0 - normalized) * 60.0
        blended = 0.55 * original_array.astype(np.float32) + 0.45 * color
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

        dataset = ManifestImageDataset(records)
        loader = DataLoader(dataset, batch_size=min(8, len(records)), shuffle=True)

        model = self.load_model(base_model_reference, device)
        architecture = base_model_reference.get("architecture", "cnn")
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
            for parameter in model.head.parameters():
                parameter.requires_grad = True
            return
        if architecture == "swin":
            for parameter in model.parameters():
                parameter.requires_grad = False
            for parameter in model.head.parameters():
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
        """ImageNet pretrained 가중치로 DenseNet 초기화 (초기 학습 전용)."""
        require_torch()
        if architecture not in DENSENET_VARIANTS:
            raise ValueError(f"Pretrained loading only supported for DenseNet variants, not {architecture}.")
        if not _TORCHVISION_AVAILABLE:
            raise RuntimeError("torchvision is required. Run: pip install torchvision")
        from torchvision.models import (
            DenseNet121_Weights, DenseNet161_Weights,
            DenseNet169_Weights, DenseNet201_Weights,
        )
        weight_map = {
            "densenet121": DenseNet121_Weights.IMAGENET1K_V1,
            "densenet161": DenseNet161_Weights.IMAGENET1K_V1,
            "densenet169": DenseNet169_Weights.IMAGENET1K_V1,
            "densenet201": DenseNet201_Weights.IMAGENET1K_V1,
        }
        builder = getattr(_torchvision_models, architecture)
        backbone = builder(weights=weight_map[architecture])
        in_features = backbone.classifier.in_features
        backbone.classifier = nn.Linear(in_features, num_classes)
        model = DenseNetKeratitis.__new__(DenseNetKeratitis)
        nn.Module.__init__(model)
        model.model = backbone
        return model

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
        use_pretrained: bool = True,
        progress_callback: Any = None,
    ) -> dict[str, Any]:
        """처음부터 DenseNet 학습 (ImageNet pretrained 권장).

        Args:
            records: manifest 레코드 리스트
            architecture: densenet121 / densenet161 / densenet169 / densenet201
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

        patient_labels = [patient_to_label[patient_id] for patient_id in patient_ids]
        stratify_labels = patient_labels if len(set(patient_labels)) > 1 else None
        test_size = max(1, int(round(len(patient_ids) * val_split)))
        if test_size >= len(patient_ids):
            test_size = len(patient_ids) - 1
        try:
            train_patient_ids, val_patient_ids = train_test_split(
                patient_ids,
                test_size=test_size,
                random_state=42,
                stratify=stratify_labels,
            )
        except ValueError:
            random.shuffle(patient_ids)
            val_patient_ids = patient_ids[:test_size]
            train_patient_ids = patient_ids[test_size:]

        train_records = [record for patient_id in train_patient_ids for record in patient_to_records[patient_id]]
        val_records = [record for patient_id in val_patient_ids for record in patient_to_records[patient_id]]

        train_ds = ManifestImageDataset(train_records, augment=True)
        val_ds = ManifestImageDataset(val_records, augment=False)
        bs = min(batch_size, len(train_records))
        train_loader = DataLoader(train_ds, batch_size=bs, shuffle=True)
        val_loader = DataLoader(val_ds, batch_size=bs, shuffle=False)

        # 모델 초기화
        if use_pretrained and architecture in DENSENET_VARIANTS:
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
        torch.save({"architecture": architecture, "state_dict": best_state}, output)

        return {
            "training_id": make_id("train"),
            "output_model_path": str(output),
            "architecture": architecture,
            "epochs": epochs,
            "n_train": len(train_records),
            "n_val": len(val_records),
            "n_train_patients": len(train_patient_ids),
            "n_val_patients": len(val_patient_ids),
            "best_val_acc": round(best_val_acc, 4),
            "use_pretrained": use_pretrained,
            "history": history,
        }

    def save_weight_delta(
        self,
        base_model_path: str | Path,
        tuned_model_path: str | Path,
        output_delta_path: str | Path,
    ) -> str:
        require_torch()
        tuned_checkpoint = torch.load(tuned_model_path, map_location="cpu", weights_only=False)
        architecture = tuned_checkpoint.get("architecture", "cnn") if isinstance(tuned_checkpoint, dict) else "cnn"
        base_checkpoint = torch.load(base_model_path, map_location="cpu", weights_only=False)
        base_state = self._extract_state_dict_from_checkpoint(base_checkpoint, architecture)
        tuned_state = self._extract_state_dict_from_checkpoint(tuned_checkpoint, architecture)
        delta_state = {key: tuned_state[key] - base_state[key] for key in base_state}
        output = Path(output_delta_path)
        output.parent.mkdir(parents=True, exist_ok=True)
        torch.save(
            {
                "architecture": architecture,
                "state_dict": delta_state,
            },
            output,
        )
        return str(output)

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
        delta_checkpoints = [torch.load(path, map_location="cpu", weights_only=False) for path in delta_paths]
        deltas = [checkpoint["state_dict"] for checkpoint in delta_checkpoints]
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

        architecture = delta_checkpoints[0].get("architecture", "cnn")
        state_dict_to_save = aggregated
        if base_model_path is not None:
            base_checkpoint = torch.load(base_model_path, map_location="cpu", weights_only=False)
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
            },
            output,
        )
        return str(output)

    def classification_metrics(
        self,
        true_labels: list[int],
        predicted_labels: list[int],
        positive_probabilities: list[float],
    ) -> dict[str, float | None]:
        accuracy = float(accuracy_score(true_labels, predicted_labels)) if true_labels else 0.0
        f1 = float(f1_score(true_labels, predicted_labels, zero_division=0)) if true_labels else 0.0

        true_positive = sum(1 for t, p in zip(true_labels, predicted_labels) if t == 1 and p == 1)
        true_negative = sum(1 for t, p in zip(true_labels, predicted_labels) if t == 0 and p == 0)
        false_positive = sum(1 for t, p in zip(true_labels, predicted_labels) if t == 0 and p == 1)
        false_negative = sum(1 for t, p in zip(true_labels, predicted_labels) if t == 1 and p == 0)

        sensitivity = true_positive / (true_positive + false_negative) if (true_positive + false_negative) else 0.0
        specificity = true_negative / (true_negative + false_positive) if (true_negative + false_positive) else 0.0

        auroc = None
        if len(set(true_labels)) > 1:
            auroc = float(roc_auc_score(true_labels, positive_probabilities))

        return {
            "AUROC": auroc,
            "accuracy": accuracy,
            "sensitivity": float(sensitivity),
            "specificity": float(specificity),
            "F1": f1,
        }
