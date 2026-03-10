from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image
import torch


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate MedSAM ROI artifacts for one image.")
    parser.add_argument("--image", required=True, help="Input image path")
    parser.add_argument("--checkpoint", required=True, help="MedSAM checkpoint path")
    parser.add_argument("--mask-out", required=True, help="Output mask path")
    parser.add_argument("--crop-out", required=True, help="Output crop path")
    parser.add_argument("--device", default="auto", help="auto, cpu, or cuda device id")
    parser.add_argument("--medsam-root", default="", help="Path to local MedSAM repository")
    return parser.parse_args()


def _resolve_device(requested: str) -> str:
    if requested and requested != "auto":
        if requested.startswith("cuda") and not torch.cuda.is_available():
            return "cpu"
        return requested
    return "cuda:0" if torch.cuda.is_available() else "cpu"


def _resolve_medsam_root(explicit_root: str) -> Path:
    if explicit_root:
        return Path(explicit_root).expanduser().resolve()
    return Path(__file__).resolve().parents[1] / "MedSAM-main"


def _load_medsam_components(medsam_root: Path):
    if not medsam_root.exists():
        raise RuntimeError(f"MedSAM repository not found: {medsam_root}")
    if str(medsam_root) not in sys.path:
        sys.path.insert(0, str(medsam_root))
    try:
        from segment_anything import SamPredictor, sam_model_registry
    except Exception as exc:  # pragma: no cover - import error details are surfaced to caller
        raise RuntimeError(f"Unable to import MedSAM from {medsam_root}") from exc
    return SamPredictor, sam_model_registry


def _load_image(image_path: Path) -> np.ndarray:
    return np.asarray(Image.open(image_path).convert("RGB"))


def _default_cornea_box(width: int, height: int) -> np.ndarray:
    margin_x = max(int(width * 0.15), 1)
    margin_y = max(int(height * 0.18), 1)
    x0 = margin_x
    y0 = margin_y
    x1 = max(width - margin_x, x0 + 1)
    y1 = max(height - margin_y, y0 + 1)
    return np.array([x0, y0, x1, y1], dtype=np.float32)


def _select_mask(
    masks: np.ndarray,
    scores: np.ndarray,
    fallback_box: np.ndarray,
    width: int,
    height: int,
) -> np.ndarray:
    if masks.ndim == 3 and masks.shape[0] > 0:
        ranked_indices = np.argsort(scores)[::-1]
        for index in ranked_indices:
            candidate = masks[index].astype(bool)
            if candidate.any():
                return candidate

    mask = np.zeros((height, width), dtype=bool)
    x0, y0, x1, y1 = fallback_box.astype(int)
    mask[y0:y1, x0:x1] = True
    return mask


def _save_outputs(
    image_array: np.ndarray,
    mask: np.ndarray,
    fallback_box: np.ndarray,
    mask_output_path: Path,
    crop_output_path: Path,
) -> None:
    mask_output_path.parent.mkdir(parents=True, exist_ok=True)
    crop_output_path.parent.mkdir(parents=True, exist_ok=True)

    mask_uint8 = (mask.astype(np.uint8) * 255)
    Image.fromarray(mask_uint8, mode="L").save(mask_output_path)

    ys, xs = np.where(mask)
    if xs.size == 0 or ys.size == 0:
        x0, y0, x1, y1 = fallback_box.astype(int)
    else:
        x0 = int(xs.min())
        x1 = int(xs.max()) + 1
        y0 = int(ys.min())
        y1 = int(ys.max()) + 1
    Image.fromarray(image_array).crop((x0, y0, x1, y1)).save(crop_output_path)


def main() -> int:
    args = _parse_args()

    image_path = Path(args.image).expanduser().resolve()
    checkpoint_path = Path(args.checkpoint).expanduser().resolve()
    mask_output_path = Path(args.mask_out).expanduser().resolve()
    crop_output_path = Path(args.crop_out).expanduser().resolve()
    medsam_root = _resolve_medsam_root(args.medsam_root)
    device = _resolve_device(args.device)

    if not image_path.exists():
        raise RuntimeError(f"Input image not found: {image_path}")
    if not checkpoint_path.exists():
        raise RuntimeError(f"MedSAM checkpoint not found: {checkpoint_path}")

    SamPredictor, sam_model_registry = _load_medsam_components(medsam_root)

    model = sam_model_registry["vit_b"](checkpoint=str(checkpoint_path))
    model = model.to(device)
    model.eval()
    predictor = SamPredictor(model)

    image_array = _load_image(image_path)
    height, width = image_array.shape[:2]
    prompt_box = _default_cornea_box(width, height)

    with torch.inference_mode():
        predictor.set_image(image_array)
        masks, scores, _ = predictor.predict(
            box=prompt_box,
            multimask_output=True,
        )

    mask = _select_mask(masks, scores, prompt_box, width, height)
    _save_outputs(image_array, mask, prompt_box, mask_output_path, crop_output_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
