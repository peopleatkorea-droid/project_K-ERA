from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def _score_from_band(value: float, low: float, ideal_low: float, ideal_high: float, high: float) -> float:
    if value <= low or value >= high:
        return 0.0
    if ideal_low <= value <= ideal_high:
        return 1.0
    if value < ideal_low:
        return _clamp01((value - low) / max(ideal_low - low, 1e-6))
    return _clamp01((high - value) / max(high - ideal_high, 1e-6))


def score_slit_lamp_image(image_path: str | Path, *, view: str | None = None) -> dict[str, Any]:
    with Image.open(image_path) as image:
        rgb = image.convert("RGB")
        width, height = rgb.size
        rgb_array = np.asarray(rgb, dtype=np.float32)

    gray = (
        0.299 * rgb_array[..., 0]
        + 0.587 * rgb_array[..., 1]
        + 0.114 * rgb_array[..., 2]
    ).astype(np.float32)
    gray_norm = gray / 255.0

    if min(gray.shape) >= 3:
        laplacian = (
            -4.0 * gray_norm[1:-1, 1:-1]
            + gray_norm[:-2, 1:-1]
            + gray_norm[2:, 1:-1]
            + gray_norm[1:-1, :-2]
            + gray_norm[1:-1, 2:]
        )
        blur_variance = float(np.var(laplacian))
    else:
        blur_variance = 0.0

    brightness = float(np.mean(gray))
    contrast = float(np.std(gray))
    min_side = float(min(width, height))

    blur_score = _clamp01(np.log1p(max(blur_variance, 0.0) * 10000.0) / 4.5)
    exposure_score = _score_from_band(brightness, low=20.0, ideal_low=55.0, ideal_high=190.0, high=245.0)
    contrast_score = _score_from_band(contrast, low=8.0, ideal_low=24.0, ideal_high=88.0, high=120.0)
    size_score = _clamp01(min_side / 768.0)

    red_mean = float(np.mean(rgb_array[..., 0]))
    green_mean = float(np.mean(rgb_array[..., 1]))
    blue_mean = float(np.mean(rgb_array[..., 2]))
    channel_total = max(red_mean + green_mean + blue_mean, 1e-6)
    green_ratio = green_mean / channel_total
    saturation = float(np.mean(np.max(rgb_array, axis=2) - np.min(rgb_array, axis=2)) / 255.0)

    normalized_view = str(view or "white").strip().lower()
    if normalized_view == "fluorescein":
        green_score = _score_from_band(green_ratio, low=0.22, ideal_low=0.34, ideal_high=0.48, high=0.58)
        saturation_score = _score_from_band(saturation, low=0.05, ideal_low=0.18, ideal_high=0.65, high=0.9)
        view_score = 0.6 * green_score + 0.4 * saturation_score
    else:
        green_penalty = _clamp01(abs(green_ratio - 0.333) / 0.16)
        saturation_score = _score_from_band(saturation, low=0.02, ideal_low=0.08, ideal_high=0.45, high=0.85)
        view_score = 0.55 * (1.0 - green_penalty) + 0.45 * saturation_score

    overall = (
        0.35 * blur_score
        + 0.25 * exposure_score
        + 0.20 * contrast_score
        + 0.10 * size_score
        + 0.10 * view_score
    )

    return {
        "quality_score": round(overall * 100.0, 1),
        "view_score": round(view_score * 100.0, 1),
        "component_scores": {
            "blur": round(blur_score * 100.0, 1),
            "exposure": round(exposure_score * 100.0, 1),
            "contrast": round(contrast_score * 100.0, 1),
            "resolution": round(size_score * 100.0, 1),
            "view_consistency": round(view_score * 100.0, 1),
        },
        "image_stats": {
            "width": int(width),
            "height": int(height),
            "brightness_mean": round(brightness, 2),
            "contrast_std": round(contrast, 2),
            "blur_variance": round(blur_variance, 6),
            "green_ratio": round(green_ratio, 4),
            "saturation_mean": round(saturation, 4),
        },
    }
