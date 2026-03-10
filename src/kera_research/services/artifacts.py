from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw

from kera_research.config import MEDSAM_CHECKPOINT, MEDSAM_SCRIPT


class MedSAMService:
    def __init__(self, medsam_script: str | None = None, medsam_checkpoint: str | None = None) -> None:
        self.medsam_script = medsam_script or MEDSAM_SCRIPT
        self.medsam_checkpoint = medsam_checkpoint or MEDSAM_CHECKPOINT

    def generate_roi(
        self,
        image_path: str | Path,
        mask_output_path: str | Path,
        crop_output_path: str | Path,
    ) -> dict[str, Any]:
        if self._can_run_external_medsam():
            try:
                return self._run_external_medsam(image_path, mask_output_path, crop_output_path)
            except (FileNotFoundError, subprocess.CalledProcessError, RuntimeError) as exc:
                fallback_result = self._fallback_center_cornea_mask(
                    image_path,
                    mask_output_path,
                    crop_output_path,
                )
                fallback_result["backend"] = "fallback_after_medsam_error"
                fallback_result["medsam_error"] = str(exc)
                return fallback_result
        return self._fallback_center_cornea_mask(image_path, mask_output_path, crop_output_path)

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
        ]
        subprocess.run(command, check=True)
        return {
            "backend": "external_medsam",
            "medsam_mask_path": str(mask_output_path),
            "roi_crop_path": str(crop_output_path),
        }

    def _fallback_center_cornea_mask(
        self,
        image_path: str | Path,
        mask_output_path: str | Path,
        crop_output_path: str | Path,
    ) -> dict[str, Any]:
        image = Image.open(image_path).convert("RGB")
        width, height = image.size
        mask = Image.new("L", (width, height), color=0)
        draw = ImageDraw.Draw(mask)

        margin_x = max(int(width * 0.15), 1)
        margin_y = max(int(height * 0.18), 1)
        draw.ellipse((margin_x, margin_y, width - margin_x, height - margin_y), fill=255)

        mask_array = np.asarray(mask)
        ys, xs = np.where(mask_array > 0)
        crop = image.crop((int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())))

        mask_path = Path(mask_output_path)
        crop_path = Path(crop_output_path)
        mask_path.parent.mkdir(parents=True, exist_ok=True)
        crop_path.parent.mkdir(parents=True, exist_ok=True)

        mask.save(mask_path)
        crop.save(crop_path)

        return {
            "backend": "fallback_ellipse_mask",
            "medsam_mask_path": str(mask_path),
            "roi_crop_path": str(crop_path),
        }
