from __future__ import annotations

import copy
import csv
import json
import logging
import math
import random
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable

import numpy as np
import torch
from PIL import Image
from torch import nn
from torch.nn import functional as F
from torch.utils.data import DataLoader, Dataset
from torchvision import transforms
from torchvision.transforms import InterpolationMode

LOGGER = logging.getLogger(__name__)

IMAGENET_CHANNEL_MEAN = (0.485, 0.456, 0.406)
IMAGENET_CHANNEL_STD = (0.229, 0.224, 0.225)
SUPPORTED_SSL_ARCHITECTURES = ("densenet121", "convnext_tiny", "swin", "vit", "dinov2", "efficientnet_v2_s")
SSL_AUGMENT_PRESETS = ("default", "weak_ocular")


def seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def resolve_device(device: str) -> str:
    normalized = str(device or "auto").strip().lower()
    if normalized == "auto":
        return "cuda" if torch.cuda.is_available() else "cpu"
    if normalized == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA was requested but no CUDA device is available.")
    if normalized not in {"cuda", "cpu"}:
        raise ValueError(f"Unsupported device: {device}")
    return normalized


def _parse_bool(value: str | bool | None) -> bool:
    if isinstance(value, bool):
        return value
    text = str(value or "").strip().lower()
    return text in {"1", "true", "yes", "y"}


def load_ssl_manifest_records(
    manifest_path: Path,
    *,
    include_review_rows: bool = False,
    min_patient_quality: str = "medium",
    max_images: int | None = None,
    seed: int = 42,
) -> list[dict[str, Any]]:
    manifest_path = manifest_path.expanduser().resolve()
    if not manifest_path.exists():
        raise FileNotFoundError(f"Manifest does not exist: {manifest_path}")

    quality_rank = {"low": 0, "medium": 1, "high": 2}
    min_rank = quality_rank.get(str(min_patient_quality or "medium").strip().lower())
    if min_rank is None:
        raise ValueError("min_patient_quality must be one of: low, medium, high")

    rows: list[dict[str, Any]] = []
    with manifest_path.open("r", newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            if not row.get("image_path"):
                continue
            row["needs_review"] = _parse_bool(row.get("needs_review"))
            row["patient_quality"] = str(row.get("patient_quality") or "low").strip().lower()
            if quality_rank.get(row["patient_quality"], -1) < min_rank:
                continue
            if row["needs_review"] and not include_review_rows:
                continue
            rows.append(row)

    if not rows:
        raise ValueError("No SSL manifest rows remain after filtering.")

    if max_images is not None and len(rows) > max_images:
        rng = random.Random(seed)
        sampled_indices = sorted(rng.sample(range(len(rows)), max_images))
        rows = [rows[index] for index in sampled_indices]

    return rows


class AddGaussianNoise:
    def __init__(self, std: float = 0.02, p: float = 0.15) -> None:
        self.std = float(std)
        self.p = float(p)

    def __call__(self, tensor: torch.Tensor) -> torch.Tensor:
        if random.random() >= self.p:
            return tensor
        return torch.clamp(tensor + torch.randn_like(tensor) * self.std, 0.0, 1.0)


class AnteriorSegmentSSLViewTransform:
    def __init__(self, image_size: int, *, preset: str = "default") -> None:
        normalized_preset = str(preset or "default").strip().lower() or "default"
        if normalized_preset not in SSL_AUGMENT_PRESETS:
            raise ValueError(
                f"Unsupported SSL augment preset: {preset}. Supported: {', '.join(SSL_AUGMENT_PRESETS)}"
            )

        if normalized_preset == "weak_ocular":
            crop_scale = (0.88, 1.0)
            crop_ratio = (0.95, 1.05)
            horizontal_flip_p = 0.15
            rotation_degrees = 4
            jitter = transforms.ColorJitter(
                brightness=0.06,
                contrast=0.06,
                saturation=0.03,
                hue=0.0,
            )
            jitter_probability = 0.35
            blur_probability = 0.04
            noise_std = 0.01
            noise_probability = 0.08
        else:
            crop_scale = (0.72, 1.0)
            crop_ratio = (0.9, 1.1)
            horizontal_flip_p = 0.5
            rotation_degrees = 10
            jitter = transforms.ColorJitter(
                brightness=0.16,
                contrast=0.16,
                saturation=0.08,
                hue=0.02,
            )
            jitter_probability = 0.75
            blur_probability = 0.15
            noise_std = 0.018
            noise_probability = 0.18

        self.transform = transforms.Compose(
            [
                transforms.RandomResizedCrop(
                    size=image_size,
                    scale=crop_scale,
                    ratio=crop_ratio,
                    interpolation=InterpolationMode.BICUBIC,
                ),
                transforms.RandomHorizontalFlip(p=horizontal_flip_p),
                transforms.RandomRotation(
                    degrees=rotation_degrees,
                    interpolation=InterpolationMode.BILINEAR,
                    fill=0,
                ),
                transforms.RandomApply([jitter], p=jitter_probability),
                transforms.RandomApply([transforms.GaussianBlur(kernel_size=5, sigma=(0.1, 1.5))], p=blur_probability),
                transforms.ToTensor(),
                AddGaussianNoise(std=noise_std, p=noise_probability),
                transforms.Normalize(IMAGENET_CHANNEL_MEAN, IMAGENET_CHANNEL_STD),
            ]
        )

    def __call__(self, image: Image.Image) -> torch.Tensor:
        return self.transform(image)


class SSLArchiveDataset(Dataset):
    def __init__(self, records: list[dict[str, Any]], image_size: int, *, augment_preset: str = "default") -> None:
        self.records = list(records)
        self.transform = AnteriorSegmentSSLViewTransform(image_size=image_size, preset=augment_preset)

    def __len__(self) -> int:
        return len(self.records)

    def __getitem__(self, index: int) -> tuple[torch.Tensor, torch.Tensor]:
        row = self.records[index]
        image_path = Path(str(row["image_path"]))
        with Image.open(image_path) as image:
            image = image.convert("RGB")
            view_one = self.transform(image)
            view_two = self.transform(image)
        return view_one, view_two


class ConvNeXtTinyEncoder(nn.Module):
    def __init__(self, *, init_mode: str) -> None:
        super().__init__()
        from torchvision.models import ConvNeXt_Tiny_Weights, convnext_tiny

        weights = ConvNeXt_Tiny_Weights.IMAGENET1K_V1 if init_mode == "imagenet" else None
        backbone = convnext_tiny(weights=weights)
        self.features = backbone.features
        self.avgpool = backbone.avgpool
        self.norm = backbone.classifier[0]
        self.flatten = backbone.classifier[1]
        self.feature_dim = int(backbone.classifier[-1].in_features)

    def forward(self, inputs: torch.Tensor) -> torch.Tensor:
        outputs = self.features(inputs)
        outputs = self.avgpool(outputs)
        outputs = self.norm(outputs)
        outputs = self.flatten(outputs)
        return outputs


class EfficientNetV2SEncoder(nn.Module):
    def __init__(self, *, init_mode: str) -> None:
        super().__init__()
        from torchvision.models import EfficientNet_V2_S_Weights, efficientnet_v2_s

        weights = EfficientNet_V2_S_Weights.IMAGENET1K_V1 if init_mode == "imagenet" else None
        backbone = efficientnet_v2_s(weights=weights)
        self.features = backbone.features
        self.avgpool = backbone.avgpool
        self.feature_dim = int(backbone.classifier[-1].in_features)

    def forward(self, inputs: torch.Tensor) -> torch.Tensor:
        outputs = self.features(inputs)
        outputs = self.avgpool(outputs)
        outputs = torch.flatten(outputs, 1)
        return outputs


class DenseNet121Encoder(nn.Module):
    def __init__(self, *, init_mode: str) -> None:
        super().__init__()
        from torchvision.models import DenseNet121_Weights, densenet121

        weights = DenseNet121_Weights.IMAGENET1K_V1 if init_mode == "imagenet" else None
        backbone = densenet121(weights=weights)
        self.features = backbone.features
        self.feature_dim = int(backbone.classifier.in_features)

    def forward(self, inputs: torch.Tensor) -> torch.Tensor:
        outputs = self.features(inputs)
        outputs = F.relu(outputs, inplace=False)
        outputs = F.adaptive_avg_pool2d(outputs, (1, 1))
        return torch.flatten(outputs, 1)


class VisionTransformerEncoder(nn.Module):
    def __init__(self, *, init_mode: str) -> None:
        super().__init__()
        from torchvision.models import ViT_B_16_Weights, vit_b_16

        weights = ViT_B_16_Weights.IMAGENET1K_V1 if init_mode == "imagenet" else None
        backbone = vit_b_16(weights=weights)
        self.conv_proj = backbone.conv_proj
        self.class_token = backbone.class_token
        self.encoder = backbone.encoder
        self.feature_dim = int(backbone.heads.head.in_features)

    def forward(self, inputs: torch.Tensor) -> torch.Tensor:
        batch_size = inputs.shape[0]
        outputs = self.conv_proj(inputs)
        outputs = outputs.reshape(batch_size, self.feature_dim, -1).permute(0, 2, 1)
        class_token = self.class_token.expand(batch_size, -1, -1)
        outputs = torch.cat([class_token, outputs], dim=1)
        outputs = self.encoder(outputs)
        return outputs[:, 0]


class SwinTinyEncoder(nn.Module):
    def __init__(self, *, init_mode: str) -> None:
        super().__init__()
        from torchvision.models import Swin_T_Weights, swin_t

        weights = Swin_T_Weights.IMAGENET1K_V1 if init_mode == "imagenet" else None
        backbone = swin_t(weights=weights)
        self.features = backbone.features
        self.norm = backbone.norm
        self.permute = backbone.permute
        self.avgpool = backbone.avgpool
        self.flatten = backbone.flatten
        self.feature_dim = int(backbone.head.in_features)

    def forward(self, inputs: torch.Tensor) -> torch.Tensor:
        outputs = self.features(inputs)
        outputs = self.norm(outputs)
        outputs = self.permute(outputs)
        outputs = self.avgpool(outputs)
        outputs = self.flatten(outputs)
        return outputs


class Dinov2Encoder(nn.Module):
    def __init__(self, *, init_mode: str) -> None:
        super().__init__()
        try:
            from transformers import Dinov2Config, Dinov2Model
        except ImportError as exc:  # pragma: no cover - dependency guard
            raise RuntimeError("transformers is required for DINOv2 SSL pretraining. Run: pip install transformers") from exc

        from kera_research.services.retrieval import DINOv2_MODEL_ID

        if init_mode == "imagenet":
            backbone = Dinov2Model.from_pretrained(DINOv2_MODEL_ID)
        else:
            backbone = Dinov2Model(Dinov2Config())
        self.backbone = backbone
        self.feature_dim = int(backbone.config.hidden_size)

    def forward(self, inputs: torch.Tensor) -> torch.Tensor:
        outputs = self.backbone(pixel_values=inputs)
        if getattr(outputs, "pooler_output", None) is not None:
            return outputs.pooler_output
        return outputs.last_hidden_state[:, 0]


def build_ssl_encoder(architecture: str, *, init_mode: str) -> nn.Module:
    normalized = str(architecture or "").strip().lower()
    if normalized == "densenet121":
        return DenseNet121Encoder(init_mode=init_mode)
    if normalized == "convnext_tiny":
        return ConvNeXtTinyEncoder(init_mode=init_mode)
    if normalized == "swin":
        return SwinTinyEncoder(init_mode=init_mode)
    if normalized == "vit":
        return VisionTransformerEncoder(init_mode=init_mode)
    if normalized == "dinov2":
        return Dinov2Encoder(init_mode=init_mode)
    if normalized == "efficientnet_v2_s":
        return EfficientNetV2SEncoder(init_mode=init_mode)
    raise ValueError(
        f"Unsupported SSL architecture: {architecture}. Supported: {', '.join(SUPPORTED_SSL_ARCHITECTURES)}"
    )


class MLPHead(nn.Module):
    def __init__(self, input_dim: int, hidden_dim: int, output_dim: int) -> None:
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, hidden_dim),
            nn.BatchNorm1d(hidden_dim),
            nn.ReLU(inplace=True),
            nn.Linear(hidden_dim, output_dim),
        )

    def forward(self, inputs: torch.Tensor) -> torch.Tensor:
        return self.net(inputs)


class BYOLModel(nn.Module):
    def __init__(
        self,
        architecture: str,
        *,
        init_mode: str,
        projector_hidden_dim: int = 1024,
        projection_dim: int = 256,
        predictor_hidden_dim: int = 512,
    ) -> None:
        super().__init__()
        self.architecture = architecture
        self.init_mode = init_mode
        self.online_encoder = build_ssl_encoder(architecture, init_mode=init_mode)
        self.target_encoder = copy.deepcopy(self.online_encoder)
        feature_dim = int(getattr(self.online_encoder, "feature_dim"))
        self.online_projector = MLPHead(feature_dim, projector_hidden_dim, projection_dim)
        self.target_projector = copy.deepcopy(self.online_projector)
        self.online_predictor = MLPHead(projection_dim, predictor_hidden_dim, projection_dim)
        self._freeze_target()

    def _freeze_target(self) -> None:
        for module in (self.target_encoder, self.target_projector):
            for parameter in module.parameters():
                parameter.requires_grad = False

    def update_target(self, momentum: float) -> None:
        with torch.no_grad():
            for online_param, target_param in zip(self.online_encoder.parameters(), self.target_encoder.parameters()):
                target_param.data.mul_(momentum).add_(online_param.data, alpha=1.0 - momentum)
            for online_param, target_param in zip(self.online_projector.parameters(), self.target_projector.parameters()):
                target_param.data.mul_(momentum).add_(online_param.data, alpha=1.0 - momentum)

    def forward(self, view_one: torch.Tensor, view_two: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
        online_one = self.online_predictor(self.online_projector(self.online_encoder(view_one)))
        online_two = self.online_predictor(self.online_projector(self.online_encoder(view_two)))
        with torch.no_grad():
            target_one = self.target_projector(self.target_encoder(view_one))
            target_two = self.target_projector(self.target_encoder(view_two))
        return online_one, online_two, target_one.detach(), target_two.detach()


def byol_loss(prediction: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
    prediction = nn.functional.normalize(prediction, dim=-1)
    target = nn.functional.normalize(target, dim=-1)
    return 2.0 - 2.0 * (prediction * target).sum(dim=-1).mean()


@dataclass
class SSLTrainingConfig:
    manifest_path: str
    output_dir: str
    architecture: str = "convnext_tiny"
    init_mode: str = "imagenet"
    method: str = "byol"
    image_size: int = 224
    batch_size: int = 32
    epochs: int = 20
    learning_rate: float = 1e-4
    weight_decay: float = 1e-4
    num_workers: int = 8
    device: str = "auto"
    seed: int = 42
    max_images: int | None = None
    max_steps_per_epoch: int | None = None
    include_review_rows: bool = False
    min_patient_quality: str = "medium"
    use_amp: bool = True
    save_every: int = 1
    base_momentum: float = 0.99
    resume_checkpoint: str | None = None
    augment_preset: str = "default"


def _worker_init_fn(worker_id: int) -> None:
    worker_seed = torch.initial_seed() % 2**32
    np.random.seed(worker_seed + worker_id)
    random.seed(worker_seed + worker_id)


def _momentum_at_progress(base_momentum: float, progress: float) -> float:
    clipped = min(max(progress, 0.0), 1.0)
    return 1.0 - (1.0 - base_momentum) * (math.cos(math.pi * clipped) + 1.0) / 2.0


def _save_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _save_training_state(
    checkpoint_path: Path,
    model: BYOLModel,
    optimizer: torch.optim.Optimizer,
    scheduler: torch.optim.lr_scheduler.LRScheduler,
    scaler: torch.amp.GradScaler,
    config: SSLTrainingConfig,
    *,
    epoch: int,
    global_step: int,
    records_count: int,
    history: list[dict[str, Any]],
) -> None:
    checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "epoch": epoch,
            "global_step": global_step,
            "records_count": records_count,
            "config": asdict(config),
            "history": history,
            "model_state": model.state_dict(),
            "optimizer_state": optimizer.state_dict(),
            "scheduler_state": scheduler.state_dict(),
            "scaler_state": scaler.state_dict(),
        },
        checkpoint_path,
    )


def _export_encoder_checkpoint(
    export_path: Path,
    model: BYOLModel,
    config: SSLTrainingConfig,
    *,
    epoch: int,
    global_step: int,
    records_count: int,
    average_loss: float,
) -> None:
    export_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "method": config.method,
        "architecture": config.architecture,
        "init_mode": config.init_mode,
        "image_size": int(config.image_size),
        "manifest_path": config.manifest_path,
        "records_count": int(records_count),
        "epoch": int(epoch),
        "global_step": int(global_step),
        "average_loss": float(average_loss),
        "state_dict": model.target_encoder.state_dict(),
        "feature_dim": int(getattr(model.target_encoder, "feature_dim")),
        "created_at": datetime.now(UTC).isoformat(timespec="seconds"),
    }
    torch.save(payload, export_path)


def run_ssl_pretraining(config: SSLTrainingConfig) -> dict[str, Any]:
    return run_ssl_pretraining_with_progress(config)


def run_ssl_pretraining_with_progress(
    config: SSLTrainingConfig,
    *,
    progress_callback: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    if str(config.method).strip().lower() != "byol":
        raise ValueError("Only BYOL is implemented in this initial SSL pipeline.")

    manifest_path = Path(config.manifest_path).expanduser().resolve()
    output_dir = Path(config.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    seed_everything(config.seed)

    device = resolve_device(config.device)
    records = load_ssl_manifest_records(
        manifest_path,
        include_review_rows=config.include_review_rows,
        min_patient_quality=config.min_patient_quality,
        max_images=config.max_images,
        seed=config.seed,
    )
    dataset = SSLArchiveDataset(records, image_size=config.image_size, augment_preset=config.augment_preset)
    loader = DataLoader(
        dataset,
        batch_size=config.batch_size,
        shuffle=True,
        num_workers=config.num_workers,
        pin_memory=device == "cuda",
        drop_last=True,
        persistent_workers=config.num_workers > 0,
        worker_init_fn=_worker_init_fn,
    )
    if len(loader) == 0:
        raise ValueError("The SSL dataloader is empty. Lower batch size or increase the dataset size.")

    model = BYOLModel(config.architecture, init_mode=config.init_mode).to(device)
    optimizer = torch.optim.AdamW(
        [
            *model.online_encoder.parameters(),
            *model.online_projector.parameters(),
            *model.online_predictor.parameters(),
        ],
        lr=config.learning_rate,
        weight_decay=config.weight_decay,
    )
    total_steps = config.epochs * min(len(loader), config.max_steps_per_epoch or len(loader))
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
        optimizer,
        T_max=max(total_steps, 1),
        eta_min=config.learning_rate * 0.05,
    )
    amp_enabled = bool(config.use_amp and device == "cuda")
    scaler = torch.amp.GradScaler("cuda" if device == "cuda" else "cpu", enabled=amp_enabled)

    checkpoint_path = output_dir / "byol_training_state.pt"
    encoder_latest_path = output_dir / "ssl_encoder_latest.pth"
    log_path = output_dir / "train_log.jsonl"
    summary_path = output_dir / "training_summary.json"

    history: list[dict[str, Any]] = []
    start_epoch = 1
    global_step = 0
    if config.resume_checkpoint:
        resume_path = Path(config.resume_checkpoint).expanduser().resolve()
        checkpoint = torch.load(resume_path, map_location="cpu", weights_only=False)
        model.load_state_dict(checkpoint["model_state"])
        optimizer.load_state_dict(checkpoint["optimizer_state"])
        scheduler.load_state_dict(checkpoint["scheduler_state"])
        scaler.load_state_dict(checkpoint["scaler_state"])
        history = list(checkpoint.get("history") or [])
        start_epoch = int(checkpoint.get("epoch") or 0) + 1
        global_step = int(checkpoint.get("global_step") or 0)
        LOGGER.info("Resumed SSL training from %s at epoch %s", resume_path, start_epoch)

    LOGGER.info(
        "Starting SSL pretraining: architecture=%s init=%s device=%s images=%s epochs=%s batch_size=%s",
        config.architecture,
        config.init_mode,
        device,
        len(records),
        config.epochs,
        config.batch_size,
    )

    steps_per_epoch = min(len(loader), config.max_steps_per_epoch or len(loader))

    def emit_progress(progress_payload: dict[str, Any]) -> None:
        if progress_callback is not None:
            progress_callback(progress_payload)

    _save_json(
        summary_path,
        {
            "status": "starting",
            "config": asdict(config),
            "device": device,
            "records_count": len(records),
            "history": history,
            "checkpoint_path": str(checkpoint_path),
            "encoder_latest_path": str(encoder_latest_path),
            "log_path": str(log_path),
            "summary_path": str(summary_path),
            "updated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        },
    )
    emit_progress(
        {
            "stage": "starting_ssl",
            "message": "Prepared the SSL dataset and initialized the encoder.",
            "percent": 10,
            "architecture": config.architecture,
            "init_mode": config.init_mode,
            "method": config.method,
            "records_count": len(records),
            "batch_size": int(config.batch_size),
            "epochs": int(config.epochs),
            "steps_per_epoch": int(steps_per_epoch),
            "output_dir": str(output_dir),
            "checkpoint_path": str(checkpoint_path),
            "encoder_latest_path": str(encoder_latest_path),
            "summary_path": str(summary_path),
        }
    )

    with log_path.open("a", encoding="utf-8") as log_handle:
        for epoch in range(start_epoch, config.epochs + 1):
            model.train()
            epoch_losses: list[float] = []
            for batch_index, (view_one, view_two) in enumerate(loader, start=1):
                if config.max_steps_per_epoch is not None and batch_index > config.max_steps_per_epoch:
                    break
                view_one = view_one.to(device, non_blocking=device == "cuda")
                view_two = view_two.to(device, non_blocking=device == "cuda")
                progress = global_step / max(total_steps, 1)
                momentum = _momentum_at_progress(config.base_momentum, progress)
                optimizer.zero_grad(set_to_none=True)
                with torch.autocast(device_type=device, dtype=torch.float16, enabled=amp_enabled):
                    online_one, online_two, target_one, target_two = model(view_one, view_two)
                    loss = 0.5 * (byol_loss(online_one, target_two) + byol_loss(online_two, target_one))
                scaler.scale(loss).backward()
                scaler.step(optimizer)
                scaler.update()
                scheduler.step()
                model.update_target(momentum)

                loss_value = float(loss.detach().item())
                epoch_losses.append(loss_value)
                global_step += 1

                if batch_index == 1 or batch_index % 50 == 0:
                    LOGGER.info(
                        "epoch=%s step=%s/%s loss=%.5f lr=%.7f momentum=%.5f",
                        epoch,
                        batch_index,
                        steps_per_epoch,
                        loss_value,
                        optimizer.param_groups[0]["lr"],
                        momentum,
                    )
                    _save_json(
                        summary_path,
                        {
                            "status": "running",
                            "config": asdict(config),
                            "device": device,
                            "records_count": len(records),
                            "history": history,
                            "checkpoint_path": str(checkpoint_path),
                            "encoder_latest_path": str(encoder_latest_path),
                            "log_path": str(log_path),
                            "summary_path": str(summary_path),
                            "current_epoch": epoch,
                            "current_step_in_epoch": batch_index,
                            "steps_per_epoch": steps_per_epoch,
                            "global_step": global_step,
                            "last_loss": loss_value,
                            "updated_at": datetime.now(UTC).isoformat(timespec="seconds"),
                        },
                    )
                    train_progress = 10 + int((global_step / max(total_steps, 1)) * 85)
                    emit_progress(
                        {
                            "stage": "training_ssl",
                            "message": f"Epoch {epoch}/{config.epochs} · step {batch_index}/{steps_per_epoch}",
                            "percent": min(95, max(10, train_progress)),
                            "architecture": config.architecture,
                            "init_mode": config.init_mode,
                            "method": config.method,
                            "epoch": int(epoch),
                            "epochs": int(config.epochs),
                            "current_step_in_epoch": int(batch_index),
                            "steps_per_epoch": int(steps_per_epoch),
                            "global_step": int(global_step),
                            "last_loss": float(loss_value),
                            "records_count": int(len(records)),
                            "batch_size": int(config.batch_size),
                            "learning_rate": float(optimizer.param_groups[0]["lr"]),
                            "output_dir": str(output_dir),
                            "checkpoint_path": str(checkpoint_path),
                            "encoder_latest_path": str(encoder_latest_path),
                            "summary_path": str(summary_path),
                        }
                    )

            average_loss = float(np.mean(epoch_losses)) if epoch_losses else math.nan
            epoch_record = {
                "epoch": epoch,
                "global_step": global_step,
                "average_loss": average_loss,
                "learning_rate": float(optimizer.param_groups[0]["lr"]),
                "timestamp": datetime.now(UTC).isoformat(timespec="seconds"),
            }
            history.append(epoch_record)
            log_handle.write(json.dumps(epoch_record, ensure_ascii=False) + "\n")
            log_handle.flush()
            emit_progress(
                {
                    "stage": "saving_checkpoint",
                    "message": f"Saving checkpoints for epoch {epoch}.",
                    "percent": min(97, 10 + int((epoch / max(config.epochs, 1)) * 87)),
                    "architecture": config.architecture,
                    "init_mode": config.init_mode,
                    "method": config.method,
                    "epoch": int(epoch),
                    "epochs": int(config.epochs),
                    "records_count": int(len(records)),
                    "last_loss": float(average_loss),
                    "output_dir": str(output_dir),
                    "checkpoint_path": str(checkpoint_path),
                    "encoder_latest_path": str(encoder_latest_path),
                    "summary_path": str(summary_path),
                }
            )

            _save_training_state(
                checkpoint_path,
                model,
                optimizer,
                scheduler,
                scaler,
                config,
                epoch=epoch,
                global_step=global_step,
                records_count=len(records),
                history=history,
            )
            _export_encoder_checkpoint(
                encoder_latest_path,
                model,
                config,
                epoch=epoch,
                global_step=global_step,
                records_count=len(records),
                average_loss=average_loss,
            )
            if config.save_every > 0 and epoch % config.save_every == 0:
                _export_encoder_checkpoint(
                    output_dir / f"ssl_encoder_epoch_{epoch:03d}.pth",
                    model,
                    config,
                    epoch=epoch,
                    global_step=global_step,
                    records_count=len(records),
                    average_loss=average_loss,
                )

            _save_json(
                summary_path,
                {
                    "status": "running" if epoch < config.epochs else "completed",
                    "config": asdict(config),
                    "device": device,
                    "records_count": len(records),
                    "latest_epoch": epoch,
                    "latest_average_loss": average_loss,
                    "history": history,
                    "checkpoint_path": str(checkpoint_path),
                    "encoder_latest_path": str(encoder_latest_path),
                    "log_path": str(log_path),
                },
            )
            emit_progress(
                {
                    "stage": "saving_encoder",
                    "message": f"Saved SSL encoder for epoch {epoch}.",
                    "percent": 98 if epoch >= config.epochs else min(98, 10 + int((epoch / max(config.epochs, 1)) * 88)),
                    "architecture": config.architecture,
                    "init_mode": config.init_mode,
                    "method": config.method,
                    "epoch": int(epoch),
                    "epochs": int(config.epochs),
                    "records_count": int(len(records)),
                    "last_loss": float(average_loss),
                    "output_dir": str(output_dir),
                    "checkpoint_path": str(checkpoint_path),
                    "encoder_latest_path": str(encoder_latest_path),
                    "summary_path": str(summary_path),
                }
            )

    summary = {
        "status": "completed",
        "config": asdict(config),
        "device": device,
        "records_count": len(records),
        "history": history,
        "checkpoint_path": str(checkpoint_path),
        "encoder_latest_path": str(encoder_latest_path),
        "log_path": str(log_path),
        "summary_path": str(summary_path),
    }
    _save_json(summary_path, summary)
    emit_progress(
        {
            "stage": "completed",
            "message": "SSL pretraining completed.",
            "percent": 100,
            "architecture": config.architecture,
            "init_mode": config.init_mode,
            "method": config.method,
            "records_count": int(len(records)),
            "output_dir": str(output_dir),
            "checkpoint_path": str(checkpoint_path),
            "encoder_latest_path": str(encoder_latest_path),
            "summary_path": str(summary_path),
        }
    )
    return summary
