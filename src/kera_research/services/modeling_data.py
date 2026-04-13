from __future__ import annotations

import hashlib
import json
import math
import random
from pathlib import Path
from typing import Any, Iterable

import numpy as np
from PIL import Image

from kera_research.domain import LABEL_TO_INDEX

try:
    import torch
    import torch.nn.functional as F
    from torch.utils.data import Dataset
except ImportError:  # pragma: no cover - dependency guard
    torch = None
    F = None
    Dataset = object


DEFAULT_IMAGE_SIZE = 224
IMAGENET_CHANNEL_MEAN = (0.485, 0.456, 0.406)
IMAGENET_CHANNEL_STD = (0.229, 0.224, 0.225)


def _require_torch() -> None:
    if torch is None or F is None:
        raise RuntimeError("PyTorch is required for model inference and training.")


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


def _preprocess_image_size(
    preprocess_metadata: dict[str, Any] | None,
    fallback: int = DEFAULT_IMAGE_SIZE,
) -> int:
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


def _apply_preprocess_to_tensor(
    tensor: torch.Tensor,
    preprocess_metadata: dict[str, Any] | None,
) -> torch.Tensor:
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
    _require_torch()
    image = Image.open(image_path).convert("RGB")
    resized = image.resize((image_size, image_size))
    array = np.asarray(resized, dtype=np.float32) / 255.0
    tensor = torch.from_numpy(array.transpose(2, 0, 1)).unsqueeze(0)
    return image, tensor


def _load_mask_tensor(
    mask_path: str | Path,
    image_size: int = DEFAULT_IMAGE_SIZE,
) -> torch.Tensor:
    _require_torch()
    mask = Image.open(mask_path).convert("L")
    resized = mask.resize((image_size, image_size))
    array = np.asarray(resized, dtype=np.float32) / 255.0
    return torch.from_numpy(array).unsqueeze(0)


def _extract_medium_crop_tensor(
    image_tensor: torch.Tensor,
    lesion_mask_tensor: torch.Tensor,
    *,
    scale_factor: float,
    min_relative_side: float = 0.35,
) -> torch.Tensor:
    _require_torch()
    if image_tensor.ndim != 3:
        raise ValueError(f"Expected a CHW image tensor, got shape {tuple(image_tensor.shape)}.")
    if lesion_mask_tensor.ndim == 3:
        lesion_mask = lesion_mask_tensor.squeeze(0)
    elif lesion_mask_tensor.ndim == 2:
        lesion_mask = lesion_mask_tensor
    else:
        raise ValueError(f"Expected a HW or 1HW lesion mask tensor, got shape {tuple(lesion_mask_tensor.shape)}.")

    height, width = int(image_tensor.shape[-2]), int(image_tensor.shape[-1])
    coordinates = torch.nonzero(lesion_mask > 0.05, as_tuple=False)
    if coordinates.numel() == 0:
        return image_tensor.clone()

    top = int(coordinates[:, 0].min().item())
    bottom = int(coordinates[:, 0].max().item()) + 1
    left = int(coordinates[:, 1].min().item())
    right = int(coordinates[:, 1].max().item()) + 1
    bbox_height = max(1, bottom - top)
    bbox_width = max(1, right - left)
    min_side = max(16, int(round(min(height, width) * float(min_relative_side))))
    side = int(round(max(bbox_height, bbox_width) * max(1.0, float(scale_factor))))
    side = max(min_side, min(max(height, width), side))
    center_y = (top + bottom) / 2.0
    center_x = (left + right) / 2.0
    top = int(round(center_y - side / 2.0))
    left = int(round(center_x - side / 2.0))
    bottom = top + side
    right = left + side

    if top < 0:
        bottom -= top
        top = 0
    if left < 0:
        right -= left
        left = 0
    if bottom > height:
        top -= bottom - height
        bottom = height
    if right > width:
        left -= right - width
        right = width

    top = max(0, top)
    left = max(0, left)
    crop = image_tensor[:, top:bottom, left:right]
    resized = F.interpolate(
        crop.unsqueeze(0),
        size=(height, width),
        mode="bilinear",
        align_corners=False,
    )
    return resized.squeeze(0)


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


def _augment_cornea_tensor_and_mask(
    cornea_tensor: torch.Tensor,
    mask_tensor: torch.Tensor,
    *,
    view: str | None = None,
) -> tuple[torch.Tensor, torch.Tensor]:
    normalized_view = _normalize_view(view)
    if random.random() < 0.5:
        cornea_tensor = torch.flip(cornea_tensor, dims=[2])
        mask_tensor = torch.flip(mask_tensor, dims=[2])
    if random.random() < 0.8:
        limit = 7.0 if normalized_view == "slit" else 10.0
        angle = math.radians(random.uniform(-limit, limit))
        scale = random.uniform(0.95, 1.05)
        translate_x = random.uniform(-0.05, 0.05)
        translate_y = random.uniform(-0.05, 0.05)
        theta = cornea_tensor.new_tensor(
            [
                [scale * math.cos(angle), -scale * math.sin(angle), translate_x],
                [scale * math.sin(angle), scale * math.cos(angle), translate_y],
            ]
        )
        image_grid = F.affine_grid(theta.unsqueeze(0), size=(1, *cornea_tensor.shape), align_corners=False)
        cornea_tensor = F.grid_sample(
            cornea_tensor.unsqueeze(0),
            image_grid,
            mode="bilinear",
            padding_mode="border",
            align_corners=False,
        ).squeeze(0)
        mask_grid = F.affine_grid(theta.unsqueeze(0), size=(1, *mask_tensor.shape), align_corners=False)
        mask_tensor = F.grid_sample(
            mask_tensor.unsqueeze(0),
            mask_grid,
            mode="bilinear",
            padding_mode="zeros",
            align_corners=False,
        ).squeeze(0)
    cornea_tensor = _adjust_color_by_view(cornea_tensor, normalized_view)
    if random.random() < 0.18:
        cornea_tensor = _apply_box_blur(cornea_tensor)
    if normalized_view != "fluorescein" and random.random() < 0.16:
        cornea_tensor = _apply_specular_glare(cornea_tensor, intensity_scale=1.15 if normalized_view == "slit" else 1.0)
    if random.random() < 0.22:
        noise_scale = 0.018 if normalized_view == "fluorescein" else 0.024
        cornea_tensor = torch.clamp(cornea_tensor + torch.randn_like(cornea_tensor) * noise_scale, 0.0, 1.0)
    mask_tensor = torch.clamp(mask_tensor, 0.0, 1.0)
    return cornea_tensor, mask_tensor


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


class PairedCropDataset(Dataset):
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

    def __getitem__(self, index: int) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        record = self.records[index]
        image_size = _preprocess_image_size(self.preprocess_metadata)
        cornea_path = str(record.get("cornea_image_path") or record.get("roi_crop_path") or record.get("image_path") or "")
        lesion_path = str(record.get("lesion_image_path") or record.get("lesion_crop_path") or "")
        if not cornea_path or not lesion_path:
            raise ValueError("Dual-input fusion requires both cornea and lesion crop paths.")

        _, cornea_tensor = _load_image_tensor(cornea_path, image_size=image_size)
        _, lesion_tensor = _load_image_tensor(lesion_path, image_size=image_size)
        cornea_tensor = cornea_tensor.squeeze(0)
        lesion_tensor = lesion_tensor.squeeze(0)
        if self.augment:
            cornea_tensor = _augment_tensor(cornea_tensor, view=record.get("view"))
            lesion_tensor = _augment_tensor(lesion_tensor, view=record.get("view"))
        cornea_tensor = _apply_preprocess_to_tensor(cornea_tensor, self.preprocess_metadata)
        lesion_tensor = _apply_preprocess_to_tensor(lesion_tensor, self.preprocess_metadata)
        label_value = LABEL_TO_INDEX[str(record["culture_category"])]
        return cornea_tensor, lesion_tensor, torch.tensor(label_value, dtype=torch.long)


class LesionGuidedFusionDataset(Dataset):
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

    def __getitem__(self, index: int) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
        record = self.records[index]
        image_size = _preprocess_image_size(self.preprocess_metadata)
        cornea_path = str(record.get("cornea_image_path") or record.get("roi_crop_path") or record.get("image_path") or "")
        lesion_path = str(record.get("lesion_image_path") or record.get("lesion_crop_path") or "")
        lesion_mask_path = str(record.get("lesion_mask_path") or "")
        if not cornea_path or not lesion_path or not lesion_mask_path:
            raise ValueError("Lesion-guided fusion requires cornea crop, lesion crop, and lesion mask inputs.")

        _, cornea_tensor = _load_image_tensor(cornea_path, image_size=image_size)
        _, lesion_tensor = _load_image_tensor(lesion_path, image_size=image_size)
        lesion_mask_tensor = _load_mask_tensor(lesion_mask_path, image_size=image_size)
        cornea_tensor = cornea_tensor.squeeze(0)
        lesion_tensor = lesion_tensor.squeeze(0)
        if self.augment:
            cornea_tensor, lesion_mask_tensor = _augment_cornea_tensor_and_mask(
                cornea_tensor,
                lesion_mask_tensor,
                view=record.get("view"),
            )
            lesion_tensor = _augment_tensor(lesion_tensor, view=record.get("view"))
        cornea_tensor = _apply_preprocess_to_tensor(cornea_tensor, self.preprocess_metadata)
        lesion_tensor = _apply_preprocess_to_tensor(lesion_tensor, self.preprocess_metadata)
        label_value = LABEL_TO_INDEX[str(record["culture_category"])]
        return cornea_tensor, lesion_tensor, lesion_mask_tensor, torch.tensor(label_value, dtype=torch.long)


class ThreeScaleLesionGuidedFusionDataset(Dataset):
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

    def __getitem__(self, index: int) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
        record = self.records[index]
        image_size = _preprocess_image_size(self.preprocess_metadata)
        cornea_path = str(record.get("cornea_image_path") or record.get("roi_crop_path") or record.get("image_path") or "")
        lesion_path = str(record.get("lesion_image_path") or record.get("lesion_crop_path") or "")
        lesion_mask_path = str(record.get("lesion_mask_path") or "")
        if not cornea_path or not lesion_path or not lesion_mask_path:
            raise ValueError("Three-scale lesion-guided fusion requires cornea crop, lesion crop, and lesion mask inputs.")

        _, cornea_tensor = _load_image_tensor(cornea_path, image_size=image_size)
        _, lesion_tensor = _load_image_tensor(lesion_path, image_size=image_size)
        lesion_mask_tensor = _load_mask_tensor(lesion_mask_path, image_size=image_size)
        cornea_tensor = cornea_tensor.squeeze(0)
        lesion_tensor = lesion_tensor.squeeze(0)
        if self.augment:
            cornea_tensor, lesion_mask_tensor = _augment_cornea_tensor_and_mask(
                cornea_tensor,
                lesion_mask_tensor,
                view=record.get("view"),
            )
            lesion_tensor = _augment_tensor(lesion_tensor, view=record.get("view"))
        medium_scale_factor = float(record.get("medium_crop_scale_factor") or 1.5)
        medium_tensor = _extract_medium_crop_tensor(
            cornea_tensor,
            lesion_mask_tensor,
            scale_factor=medium_scale_factor,
        )
        cornea_tensor = _apply_preprocess_to_tensor(cornea_tensor, self.preprocess_metadata)
        medium_tensor = _apply_preprocess_to_tensor(medium_tensor, self.preprocess_metadata)
        lesion_tensor = _apply_preprocess_to_tensor(lesion_tensor, self.preprocess_metadata)
        label_value = LABEL_TO_INDEX[str(record["culture_category"])]
        return cornea_tensor, medium_tensor, lesion_tensor, lesion_mask_tensor, torch.tensor(label_value, dtype=torch.long)


def _group_records_by_visit(records: Iterable[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for record in records:
        key = (str(record["patient_id"]), str(record["visit_date"]))
        grouped.setdefault(key, []).append(record)
    return list(grouped.values())


class VisitBagDataset(Dataset):
    def __init__(
        self,
        records: Iterable[dict[str, Any]],
        augment: bool = False,
        *,
        preprocess_metadata: dict[str, Any] | None = None,
    ) -> None:
        self.visit_records = _group_records_by_visit(records)
        self.augment = augment
        self.preprocess_metadata = dict(preprocess_metadata) if isinstance(preprocess_metadata, dict) else None

    def __len__(self) -> int:
        return len(self.visit_records)

    def __getitem__(self, index: int) -> dict[str, Any]:
        bag_records = self.visit_records[index]
        tensors: list[torch.Tensor] = []
        image_paths: list[str] = []
        source_image_paths: list[str] = []
        views: list[str] = []
        for record in bag_records:
            _, tensor = _load_image_tensor(
                record["image_path"],
                image_size=_preprocess_image_size(self.preprocess_metadata),
            )
            next_tensor = tensor.squeeze(0)
            if self.augment:
                next_tensor = _augment_tensor(next_tensor, view=record.get("view"))
            next_tensor = _apply_preprocess_to_tensor(next_tensor, self.preprocess_metadata)
            tensors.append(next_tensor)
            image_paths.append(str(record["image_path"]))
            source_image_paths.append(str(record.get("source_image_path") or record["image_path"]))
            views.append(str(record.get("view") or ""))
        label_value = LABEL_TO_INDEX[str(bag_records[0]["culture_category"])]
        return {
            "images": torch.stack(tensors, dim=0),
            "label": torch.tensor(label_value, dtype=torch.long),
            "patient_id": str(bag_records[0]["patient_id"]),
            "visit_date": str(bag_records[0]["visit_date"]),
            "image_paths": image_paths,
            "source_image_paths": source_image_paths,
            "views": views,
        }


class VisitPairedBagDataset(Dataset):
    def __init__(
        self,
        records: Iterable[dict[str, Any]],
        augment: bool = False,
        *,
        preprocess_metadata: dict[str, Any] | None = None,
    ) -> None:
        self.visit_records = _group_records_by_visit(records)
        self.augment = augment
        self.preprocess_metadata = dict(preprocess_metadata) if isinstance(preprocess_metadata, dict) else None

    def __len__(self) -> int:
        return len(self.visit_records)

    def __getitem__(self, index: int) -> dict[str, Any]:
        bag_records = self.visit_records[index]
        full_tensors: list[torch.Tensor] = []
        lesion_tensors: list[torch.Tensor] = []
        image_paths: list[str] = []
        source_image_paths: list[str] = []
        lesion_image_paths: list[str] = []
        views: list[str] = []
        image_size = _preprocess_image_size(self.preprocess_metadata)
        for record in bag_records:
            full_path = str(
                record.get("full_image_path")
                or record.get("source_image_path")
                or record.get("raw_image_path")
                or record.get("image_path")
                or ""
            )
            lesion_path = str(record.get("lesion_image_path") or record.get("lesion_crop_path") or "")
            if not full_path or not lesion_path:
                raise ValueError("Paired visit-level MIL requires both full-frame and lesion crop paths.")
            _, full_tensor = _load_image_tensor(full_path, image_size=image_size)
            _, lesion_tensor = _load_image_tensor(lesion_path, image_size=image_size)
            next_full = full_tensor.squeeze(0)
            next_lesion = lesion_tensor.squeeze(0)
            if self.augment:
                next_full = _augment_tensor(next_full, view=record.get("view"))
                next_lesion = _augment_tensor(next_lesion, view=record.get("view"))
            next_full = _apply_preprocess_to_tensor(next_full, self.preprocess_metadata)
            next_lesion = _apply_preprocess_to_tensor(next_lesion, self.preprocess_metadata)
            full_tensors.append(next_full)
            lesion_tensors.append(next_lesion)
            image_paths.append(full_path)
            source_image_paths.append(str(record.get("source_image_path") or full_path))
            lesion_image_paths.append(lesion_path)
            views.append(str(record.get("view") or ""))
        label_value = LABEL_TO_INDEX[str(bag_records[0]["culture_category"])]
        return {
            "full_images": torch.stack(full_tensors, dim=0),
            "lesion_images": torch.stack(lesion_tensors, dim=0),
            "label": torch.tensor(label_value, dtype=torch.long),
            "patient_id": str(bag_records[0]["patient_id"]),
            "visit_date": str(bag_records[0]["visit_date"]),
            "image_paths": image_paths,
            "source_image_paths": source_image_paths,
            "lesion_image_paths": lesion_image_paths,
            "views": views,
        }


def collate_visit_bags(items: list[dict[str, Any]]) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    if not items:
        raise ValueError("Visit bag collation requires at least one item.")
    max_bag_size = max(int(item["images"].shape[0]) for item in items)
    channels, height, width = items[0]["images"].shape[1:]
    batch_images = torch.zeros((len(items), max_bag_size, channels, height, width), dtype=items[0]["images"].dtype)
    batch_mask = torch.zeros((len(items), max_bag_size), dtype=torch.bool)
    labels = torch.zeros((len(items),), dtype=torch.long)
    for index, item in enumerate(items):
        bag = item["images"]
        bag_size = int(bag.shape[0])
        batch_images[index, :bag_size] = bag
        batch_mask[index, :bag_size] = True
        labels[index] = item["label"]
    return batch_images, batch_mask, labels


def collate_visit_paired_bags(
    items: list[dict[str, Any]],
) -> tuple[tuple[torch.Tensor, torch.Tensor], torch.Tensor, torch.Tensor]:
    if not items:
        raise ValueError("Paired visit bag collation requires at least one item.")
    max_bag_size = max(int(item["full_images"].shape[0]) for item in items)
    channels, height, width = items[0]["full_images"].shape[1:]
    batch_full = torch.zeros((len(items), max_bag_size, channels, height, width), dtype=items[0]["full_images"].dtype)
    batch_lesion = torch.zeros(
        (len(items), max_bag_size, channels, height, width),
        dtype=items[0]["lesion_images"].dtype,
    )
    batch_mask = torch.zeros((len(items), max_bag_size), dtype=torch.bool)
    labels = torch.zeros((len(items),), dtype=torch.long)
    for index, item in enumerate(items):
        full_bag = item["full_images"]
        lesion_bag = item["lesion_images"]
        bag_size = int(full_bag.shape[0])
        batch_full[index, :bag_size] = full_bag
        batch_lesion[index, :bag_size] = lesion_bag
        batch_mask[index, :bag_size] = True
        labels[index] = item["label"]
    return (batch_full, batch_lesion), batch_mask, labels
