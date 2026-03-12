from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
import torch
import torch.nn as nn
import torch.nn.functional as F


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Swin-LiteMedSAM mask and crop artifacts for one image.")
    parser.add_argument("--image", required=True, help="Input image path")
    parser.add_argument("--checkpoint", required=True, help="Swin-LiteMedSAM checkpoint path")
    parser.add_argument("--mask-out", required=True, help="Output mask path")
    parser.add_argument("--crop-out", required=True, help="Output crop path")
    parser.add_argument("--prompt-box", default="", help="Optional x0,y0,x1,y1 box prompt in pixel coordinates")
    parser.add_argument("--expand-ratio", type=float, default=1.0, help="Bounding box expansion ratio for the saved crop")
    parser.add_argument("--device", default="auto", help="auto, cpu, or cuda device id")
    parser.add_argument("--backend-name", default="swin_litemedsam", help="Segmentation backend label for compatibility")
    parser.add_argument("--backend-root", default="", help="Path to local Swin-LiteMedSAM repository")
    return parser.parse_args()


def _resolve_device(requested: str) -> str:
    if requested and requested != "auto":
        if requested.startswith("cuda") and not torch.cuda.is_available():
            return "cpu"
        return requested
    return "cuda:0" if torch.cuda.is_available() else "cpu"


def _resolve_backend_root(explicit_root: str) -> Path:
    if explicit_root:
        return Path(explicit_root).expanduser().resolve()
    return Path(__file__).resolve().parents[1] / "Swin_LiteMedSAM"


def _load_backend_components(backend_root: Path):
    if not backend_root.exists():
        raise RuntimeError(f"Swin-LiteMedSAM repository not found: {backend_root}")
    if str(backend_root) not in sys.path:
        sys.path.insert(0, str(backend_root))
    try:
        from models import MaskDecoder_Prompt, PromptEncoder, SwinTransformer, TwoWayTransformer
    except Exception as exc:
        raise RuntimeError(f"Unable to import Swin-LiteMedSAM modules from {backend_root}") from exc
    return SwinTransformer, PromptEncoder, TwoWayTransformer, MaskDecoder_Prompt


class SwinLiteMedSAMModel(nn.Module):
    def __init__(self, image_encoder, mask_decoder, prompt_encoder) -> None:
        super().__init__()
        self.image_encoder = image_encoder
        self.mask_decoder = mask_decoder
        self.prompt_encoder = prompt_encoder

    @torch.no_grad()
    def postprocess_masks(self, masks: torch.Tensor, new_size: tuple[int, int], original_size: tuple[int, int]) -> torch.Tensor:
        masks = masks[..., : new_size[0], : new_size[1]]
        masks = F.interpolate(
            masks,
            size=(original_size[0], original_size[1]),
            mode="bilinear",
            align_corners=False,
        )
        return masks


def _build_model(backend_root: Path, checkpoint_path: Path, device: str) -> SwinLiteMedSAMModel:
    SwinTransformer, PromptEncoder, TwoWayTransformer, MaskDecoder_Prompt = _load_backend_components(backend_root)
    image_encoder = SwinTransformer()
    prompt_encoder = PromptEncoder(
        embed_dim=256,
        image_embedding_size=(64, 64),
        input_image_size=(256, 256),
        mask_in_chans=16,
    )
    mask_decoder = MaskDecoder_Prompt(
        num_multimask_outputs=3,
        transformer=TwoWayTransformer(
            depth=2,
            embedding_dim=256,
            mlp_dim=2048,
            num_heads=8,
        ),
        transformer_dim=256,
        iou_head_depth=3,
        iou_head_hidden_dim=256,
    )
    model = SwinLiteMedSAMModel(image_encoder=image_encoder, mask_decoder=mask_decoder, prompt_encoder=prompt_encoder)
    checkpoint = torch.load(checkpoint_path, map_location="cpu")
    try:
        model.load_state_dict(checkpoint)
    except Exception:
        payload = checkpoint.get("model") if isinstance(checkpoint, dict) else None
        if not isinstance(payload, dict):
            raise
        model.load_state_dict(payload)
    model.to(device)
    model.eval()
    return model


def _load_image(image_path: Path) -> np.ndarray:
    return np.asarray(Image.open(image_path).convert("RGB"))


def _resize_longest_side(image: np.ndarray, target_length: int = 256) -> np.ndarray:
    old_h, old_w = image.shape[:2]
    scale = target_length / max(old_h, old_w)
    new_h = int(old_h * scale + 0.5)
    new_w = int(old_w * scale + 0.5)
    return cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_AREA)


def _pad_image(image: np.ndarray, target_size: int = 256) -> np.ndarray:
    h, w = image.shape[:2]
    pad_h = target_size - h
    pad_w = target_size - w
    if image.ndim == 3:
        return np.pad(image, ((0, pad_h), (0, pad_w), (0, 0)))
    return np.pad(image, ((0, pad_h), (0, pad_w)))


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
    parsed = [float(part.strip()) for part in raw.split(",")]
    if len(parsed) != 4:
        raise RuntimeError("Prompt box must contain exactly four numeric values.")
    x0, y0, x1, y1 = parsed
    x0 = min(max(x0, 0.0), max(width - 1, 0))
    y0 = min(max(y0, 0.0), max(height - 1, 0))
    x1 = min(max(x1, x0 + 1.0), float(width))
    y1 = min(max(y1, y0 + 1.0), float(height))
    return np.array([x0, y0, x1, y1], dtype=np.float32)


def _resize_box_to_256(box: np.ndarray, original_size: tuple[int, int]) -> np.ndarray:
    ratio = 256 / max(original_size)
    return box * ratio


def _encode_image(image_array: np.ndarray, model: SwinLiteMedSAMModel, device: str) -> tuple[torch.Tensor, Any, tuple[int, int]]:
    resized = _resize_longest_side(image_array, 256)
    new_h, new_w = resized.shape[:2]
    normalized = (resized - resized.min()) / np.clip(resized.max() - resized.min(), a_min=1e-8, a_max=None)
    padded = _pad_image(normalized, 256)
    image_tensor = torch.tensor(padded).float().permute(2, 0, 1).unsqueeze(0).to(device)
    with torch.no_grad():
        image_embedding, fs = model.image_encoder(image_tensor)
    return image_embedding, fs, (new_h, new_w)


def _infer_mask(
    model: SwinLiteMedSAMModel,
    image_embedding: torch.Tensor,
    fs: Any,
    box_256: np.ndarray,
    new_size: tuple[int, int],
    original_size: tuple[int, int],
    device: str,
) -> np.ndarray:
    box_torch = torch.as_tensor(box_256[None, None, ...], dtype=torch.float32, device=device)
    sparse_embeddings, dense_embeddings = model.prompt_encoder(
        points=None,
        boxes=box_torch,
        masks=None,
        tokens=None,
    )
    low_res_logits, _ = model.mask_decoder(
        fs,
        image_embeddings=image_embedding,
        image_pe=model.prompt_encoder.get_dense_pe(),
        sparse_prompt_embeddings=sparse_embeddings,
        dense_prompt_embeddings=dense_embeddings,
        multimask_output=False,
    )
    low_res_pred = model.postprocess_masks(low_res_logits, new_size, original_size)
    mask = torch.sigmoid(low_res_pred).squeeze().cpu().numpy()
    return mask > 0.5


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
    backend_root = _resolve_backend_root(args.backend_root)
    device = _resolve_device(args.device)

    if not image_path.exists():
        raise RuntimeError(f"Input image not found: {image_path}")
    if not checkpoint_path.exists():
        raise RuntimeError(f"Swin-LiteMedSAM checkpoint not found: {checkpoint_path}")

    image_array = _load_image(image_path)
    height, width = image_array.shape[:2]
    prompt_box = _parse_prompt_box(args.prompt_box, width, height) or _default_cornea_box(width, height)

    model = _build_model(backend_root, checkpoint_path, device)
    image_embedding, fs, new_size = _encode_image(image_array, model, device)
    box_256 = _resize_box_to_256(prompt_box, (height, width))
    mask = _infer_mask(model, image_embedding, fs, box_256, new_size, (height, width), device)
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
