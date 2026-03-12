from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
import torch


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate MedSAM cornea mask and cornea crop artifacts for one image.")
    parser.add_argument("--image", required=True, help="Input image path")
    parser.add_argument("--checkpoint", required=True, help="MedSAM checkpoint path")
    parser.add_argument("--mask-out", required=True, help="Output mask path")
    parser.add_argument("--crop-out", required=True, help="Output crop path")
    parser.add_argument("--prompt-box", default="", help="Optional x0,y0,x1,y1 box prompt in pixel coordinates")
    parser.add_argument("--expand-ratio", type=float, default=1.0, help="Bounding box expansion ratio for the saved crop")
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


def _parse_prompt_box(value: str, width: int, height: int) -> np.ndarray | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    normalized = raw
    if normalized.startswith("["):
        parsed = json.loads(normalized)
    else:
        parsed = [float(part.strip()) for part in normalized.split(",")]
    if len(parsed) != 4:
        raise RuntimeError("Prompt box must contain exactly four numeric values.")
    x0, y0, x1, y1 = [float(item) for item in parsed]
    x0 = min(max(x0, 0.0), max(width - 1, 0))
    y0 = min(max(y0, 0.0), max(height - 1, 0))
    x1 = min(max(x1, x0 + 1.0), float(width))
    y1 = min(max(y1, y0 + 1.0), float(height))
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
    *,
    expand_ratio: float = 1.0,
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
    if expand_ratio > 1.0:
        box_width = max(1, x1 - x0)
        box_height = max(1, y1 - y0)
        center_x = x0 + box_width / 2.0
        center_y = y0 + box_height / 2.0
        expanded_width = box_width * expand_ratio
        expanded_height = box_height * expand_ratio
        x0 = max(0, int(round(center_x - expanded_width / 2.0)))
        y0 = max(0, int(round(center_y - expanded_height / 2.0)))
        x1 = min(image_array.shape[1], int(round(center_x + expanded_width / 2.0)))
        y1 = min(image_array.shape[0], int(round(center_y + expanded_height / 2.0)))
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
    parsed_prompt_box = _parse_prompt_box(args.prompt_box, width, height)
    prompt_box = parsed_prompt_box if parsed_prompt_box is not None else _default_cornea_box(width, height)

    with torch.inference_mode():
        predictor.set_image(image_array)
        masks, scores, _ = predictor.predict(
            box=prompt_box,
            multimask_output=True,
        )

    mask = _select_mask(masks, scores, prompt_box, width, height)
    _save_outputs(
        image_array,
        mask,
        prompt_box,
        mask_output_path,
        crop_output_path,
        expand_ratio=max(1.0, float(args.expand_ratio)),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
