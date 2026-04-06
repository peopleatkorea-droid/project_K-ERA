from __future__ import annotations

from pathlib import Path
from typing import Any


def _deps():
    from kera_research.services import data_plane as dp

    return dp


def image_preview_cache_path(store: Any, image_id: str, max_side: int) -> Path:
    dp = _deps()
    normalized_max_side = min(max(int(max_side or 512), 96), 1024)
    preview_dir = dp.ensure_dir(store.image_preview_dir / str(normalized_max_side))
    return preview_dir / f"{image_id}.jpg"


def delete_image_preview_cache(store: Any, image_id: str) -> int:
    normalized_image_id = str(image_id or "").strip()
    if not normalized_image_id:
        return 0
    deleted_count = 0
    for preview_path in store.image_preview_dir.glob(f"*/{normalized_image_id}.jpg"):
        preview_path.unlink(missing_ok=True)
        deleted_count += 1
    return deleted_count


def ensure_image_preview(store: Any, image: dict[str, Any], max_side: int) -> Path:
    dp = _deps()
    image_id = str(image.get("image_id") or "").strip()
    if not image_id:
        raise ValueError("Image id is required.")
    normalized_max_side = min(max(int(max_side or 512), 96), 1024)
    preview_path = image_preview_cache_path(store, image_id, normalized_max_side)
    # Uploaded source images are immutable in this workspace, so a cached preview
    # can be served immediately without re-touching the original OneDrive file.
    if preview_path.exists():
        return preview_path

    image_path = Path(str(image.get("image_path") or "")).resolve()
    if not image_path.exists():
        raise ValueError("Image file not found on disk.")

    temp_path = preview_path.with_suffix(
        f".{dp.os.getpid()}.{dp.threading.get_ident()}.tmp"
    )
    resampling = getattr(dp.Image, "Resampling", dp.Image)

    try:
        with dp.Image.open(image_path) as handle:
            normalized = dp.ImageOps.exif_transpose(handle)
            preview = normalized.copy()
            preview.thumbnail((normalized_max_side, normalized_max_side), resampling.LANCZOS)
            if preview.mode not in {"RGB", "L"}:
                preview = preview.convert("RGB")
            preview.save(temp_path, format="JPEG", quality=82, optimize=True)
        temp_path.replace(preview_path)
    except (OSError, dp.UnidentifiedImageError, ValueError):
        temp_path.unlink(missing_ok=True)
        raise

    return preview_path
