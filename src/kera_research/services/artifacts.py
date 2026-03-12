from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw

from kera_research.config import SEGMENTATION_BACKEND, SEGMENTATION_CHECKPOINT, SEGMENTATION_ROOT, SEGMENTATION_SCRIPT


class MedSAMService:
    def __init__(
        self,
        medsam_script: str | None = None,
        medsam_checkpoint: str | None = None,
        *,
        backend: str | None = None,
        backend_root: str | None = None,
    ) -> None:
        self.backend = (backend or SEGMENTATION_BACKEND or "medsam").strip().lower() or "medsam"
        self.backend_root = backend_root or SEGMENTATION_ROOT
        self.medsam_script = medsam_script or SEGMENTATION_SCRIPT
        self.medsam_checkpoint = medsam_checkpoint or SEGMENTATION_CHECKPOINT

    def generate_roi(
        self,
        image_path: str | Path,
        mask_output_path: str | Path,
        crop_output_path: str | Path,
    ) -> dict[str, Any]:
        return self._generate_with_prompt(
            image_path=image_path,
            mask_output_path=mask_output_path,
            crop_output_path=crop_output_path,
            prompt_box=None,
            expand_ratio=1.0,
            external_backend=self._external_backend_label(prompt_box=None),
            fallback_backend="fallback_ellipse_mask",
        )

    def generate_lesion_roi(
        self,
        image_path: str | Path,
        mask_output_path: str | Path,
        crop_output_path: str | Path,
        *,
        prompt_box: list[float],
        expand_ratio: float = 2.5,
    ) -> dict[str, Any]:
        return self._generate_with_prompt(
            image_path=image_path,
            mask_output_path=mask_output_path,
            crop_output_path=crop_output_path,
            prompt_box=prompt_box,
            expand_ratio=expand_ratio,
            external_backend=self._external_backend_label(prompt_box=prompt_box),
            fallback_backend="fallback_prompt_box_mask",
        )

    def _external_backend_label(self, *, prompt_box: list[float] | None) -> str:
        base = f"external_{self.backend}" if self.backend else "external_segmentation"
        return f"{base}_lesion_box" if prompt_box else base

    def _generate_with_prompt(
        self,
        image_path: str | Path,
        mask_output_path: str | Path,
        crop_output_path: str | Path,
        *,
        prompt_box: list[float] | None,
        expand_ratio: float,
        external_backend: str,
        fallback_backend: str,
    ) -> dict[str, Any]:
        if self._can_run_external_medsam():
            try:
                return self._run_external_medsam(
                    image_path,
                    mask_output_path,
                    crop_output_path,
                    prompt_box=prompt_box,
                    expand_ratio=expand_ratio,
                    backend_label=external_backend,
                )
            except (FileNotFoundError, subprocess.CalledProcessError, RuntimeError) as exc:
                fallback_result = self._fallback_mask(
                    image_path,
                    mask_output_path,
                    crop_output_path,
                    prompt_box=prompt_box,
                    expand_ratio=expand_ratio,
                    backend_label=fallback_backend,
                )
                fallback_result["backend"] = (
                    "fallback_after_medsam_error_lesion" if prompt_box else "fallback_after_medsam_error"
                )
                fallback_result["medsam_error"] = str(exc)
                return fallback_result
        return self._fallback_mask(
            image_path,
            mask_output_path,
            crop_output_path,
            prompt_box=prompt_box,
            expand_ratio=expand_ratio,
            backend_label=fallback_backend,
        )

    def _can_run_external_medsam(self) -> bool:
        return bool(
            self.medsam_script
            and self.medsam_checkpoint
            and Path(self.medsam_script).exists()
            and Path(self.medsam_checkpoint).exists()
        )

    def _run_external_medsam(
        self,
        image_path: str | Path,
        mask_output_path: str | Path,
        crop_output_path: str | Path,
        *,
        prompt_box: list[float] | None,
        expand_ratio: float,
        backend_label: str,
    ) -> dict[str, Any]:
        command = [
            sys.executable,
            self.medsam_script,
            "--image",
            str(image_path),
            "--checkpoint",
            str(self.medsam_checkpoint),
            "--mask-out",
            str(mask_output_path),
            "--crop-out",
            str(crop_output_path),
            "--expand-ratio",
            str(max(1.0, float(expand_ratio))),
        ]
        if self.backend:
            command.extend(["--backend-name", self.backend])
        if self.backend_root:
            command.extend(["--backend-root", str(self.backend_root)])
        if prompt_box:
            command.extend(["--prompt-box", ",".join(str(float(value)) for value in prompt_box)])
        subprocess.run(command, check=True)
        return {
            "backend": backend_label,
            "medsam_mask_path": str(mask_output_path),
            "roi_crop_path": str(crop_output_path),
        }

    def _fallback_mask(
        self,
        image_path: str | Path,
        mask_output_path: str | Path,
        crop_output_path: str | Path,
        *,
        prompt_box: list[float] | None,
        expand_ratio: float,
        backend_label: str,
    ) -> dict[str, Any]:
        image = Image.open(image_path).convert("RGB")
        width, height = image.size
        mask = Image.new("L", (width, height), color=0)
        draw = ImageDraw.Draw(mask)

        if prompt_box:
            x0, y0, x1, y1 = [float(value) for value in prompt_box]
            x0 = min(max(int(round(x0)), 0), max(width - 1, 0))
            y0 = min(max(int(round(y0)), 0), max(height - 1, 0))
            x1 = min(max(int(round(x1)), x0 + 1), width)
            y1 = min(max(int(round(y1)), y0 + 1), height)
            draw.rectangle((x0, y0, x1, y1), fill=255)
            fallback_box = np.array([x0, y0, x1, y1], dtype=np.float32)
        else:
            margin_x = max(int(width * 0.15), 1)
            margin_y = max(int(height * 0.18), 1)
            draw.ellipse((margin_x, margin_y, width - margin_x, height - margin_y), fill=255)
            fallback_box = np.array([margin_x, margin_y, width - margin_x, height - margin_y], dtype=np.float32)

        mask_array = np.asarray(mask)
        ys, xs = np.where(mask_array > 0)
        x0 = int(xs.min())
        x1 = int(xs.max()) + 1
        y0 = int(ys.min())
        y1 = int(ys.max()) + 1
        if expand_ratio > 1.0:
            box_width = max(1, x1 - x0)
            box_height = max(1, y1 - y0)
            center_x = x0 + box_width / 2.0
            center_y = y0 + box_height / 2.0
            expanded_width = box_width * expand_ratio
            expanded_height = box_height * expand_ratio
            x0 = max(0, int(round(center_x - expanded_width / 2.0)))
            y0 = max(0, int(round(center_y - expanded_height / 2.0)))
            x1 = min(width, int(round(center_x + expanded_width / 2.0)))
            y1 = min(height, int(round(center_y + expanded_height / 2.0)))
        crop = image.crop((x0, y0, x1, y1))

        mask_path = Path(mask_output_path)
        crop_path = Path(crop_output_path)
        mask_path.parent.mkdir(parents=True, exist_ok=True)
        crop_path.parent.mkdir(parents=True, exist_ok=True)

        mask.save(mask_path)
        crop.save(crop_path)

        return {
            "backend": backend_label,
            "medsam_mask_path": str(mask_path),
            "roi_crop_path": str(crop_path),
            "prompt_box": prompt_box,
            "fallback_box": fallback_box.tolist(),
        }
