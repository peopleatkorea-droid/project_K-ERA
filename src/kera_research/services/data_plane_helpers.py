from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps, UnidentifiedImageError

from kera_research.domain import utc_now

_ALLOWED_IMAGE_FORMATS = {"JPEG", "PNG", "TIFF", "BMP", "WEBP"}
_MAX_IMAGE_PIXELS = 40_000_000
_ALLOWED_IMAGE_MAGIC_HEADERS = (
    b"\xff\xd8\xff",  # JPEG
    b"\x89PNG\r\n\x1a\n",  # PNG
    b"II*\x00",  # TIFF little-endian
    b"MM\x00*",  # TIFF big-endian
    b"BM",  # BMP
    b"RIFF",  # WEBP container prefix; validated further by PIL
)


class InvalidImageUploadError(ValueError):
    pass


@dataclass(frozen=True)
class ValidatedImageUpload:
    normalized_upload_name: str
    sanitized_content: bytes
    normalized_suffix: str


class FileUploadValidator:
    def __init__(self, *, max_image_bytes: int = 20 * 1024 * 1024) -> None:
        self.max_image_bytes = max(1, int(max_image_bytes))

    def normalize_upload_name(self, file_name: str | None) -> str:
        return Path(str(file_name or "upload.bin").replace("\\", "/")).name or "upload.bin"

    def validate_content_length(self, content_length: str | None) -> None:
        if content_length is None:
            return
        try:
            if int(content_length) > self.max_image_bytes:
                raise InvalidImageUploadError("File exceeds 20 MB limit.")
        except ValueError as exc:
            if str(exc) == "File exceeds 20 MB limit.":
                raise

    def validate_image_upload(self, *, content: bytes, file_name: str | None) -> ValidatedImageUpload:
        if len(content) > self.max_image_bytes:
            raise InvalidImageUploadError("File exceeds 20 MB limit.")
        normalized_upload_name = self.normalize_upload_name(file_name)
        sanitized_content, normalized_suffix = sanitize_image_bytes(content, normalized_upload_name)
        return ValidatedImageUpload(
            normalized_upload_name=normalized_upload_name,
            sanitized_content=sanitized_content,
            normalized_suffix=normalized_suffix,
        )


def case_summary_sort_key(summary: dict[str, Any]) -> tuple[str, str, str, str]:
    return (
        str(summary.get("latest_image_uploaded_at") or ""),
        str(summary.get("created_at") or ""),
        str(summary.get("visit_date") or ""),
        str(summary.get("patient_id") or ""),
    )


def case_summary_search_haystack(summary: dict[str, Any]) -> str:
    additional_organisms = summary.get("additional_organisms", []) or []
    return " ".join(
        [
            str(summary.get("patient_id") or ""),
            str(summary.get("local_case_code") or ""),
            str(summary.get("chart_alias") or ""),
            str(summary.get("culture_category") or ""),
            str(summary.get("culture_species") or ""),
            *(str(item.get("culture_species") or "") for item in additional_organisms if isinstance(item, dict)),
            str(summary.get("visit_date") or ""),
            str(summary.get("actual_visit_date") or ""),
        ]
    ).strip().lower()


def sqlite_search_tokens(value: str) -> list[str]:
    tokens: list[str] = []
    current: list[str] = []
    for char in str(value or ""):
        if char.isalnum():
            current.append(char.casefold())
            continue
        if current:
            tokens.append("".join(current))
            current = []
    if current:
        tokens.append("".join(current))
    return tokens


def sqlite_patient_case_match_query(value: str | None) -> str | None:
    tokens = sqlite_search_tokens(str(value or ""))
    if not tokens:
        return None
    return " ".join(f"{token}*" for token in tokens)


def sanitize_image_bytes(content: bytes, file_name: str) -> tuple[bytes, str]:
    del file_name
    if not content.startswith(_ALLOWED_IMAGE_MAGIC_HEADERS):
        raise InvalidImageUploadError("Invalid image file.")
    try:
        with Image.open(BytesIO(content)) as image:
            format_name = str(image.format or "").upper()
            if format_name not in _ALLOWED_IMAGE_FORMATS:
                raise InvalidImageUploadError("Unsupported image format.")
            if getattr(image, "n_frames", 1) != 1:
                raise InvalidImageUploadError("Animated or multi-frame images are not supported.")
            image.load()
            width, height = image.size
            if width <= 0 or height <= 0:
                raise InvalidImageUploadError("Image dimensions are invalid.")
            if width * height > _MAX_IMAGE_PIXELS:
                raise InvalidImageUploadError("Image is too large.")
            normalized = ImageOps.exif_transpose(image)
            output = BytesIO()
            if format_name == "PNG" or "A" in normalized.getbands():
                if normalized.mode not in {"RGB", "RGBA", "L"}:
                    normalized = normalized.convert("RGBA" if "A" in normalized.getbands() else "RGB")
                normalized.save(output, format="PNG")
                return output.getvalue(), ".png"

            if normalized.mode not in {"RGB", "L"}:
                normalized = normalized.convert("RGB")
            normalized.save(output, format="JPEG", quality=95, optimize=True)
            return output.getvalue(), ".jpg"
    except InvalidImageUploadError:
        raise
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise InvalidImageUploadError("Invalid image file.") from exc


def filesystem_timestamp_to_utc(value: float | None) -> str:
    if value is None:
        return utc_now()
    try:
        return datetime.fromtimestamp(float(value), tz=timezone.utc).replace(microsecond=0).isoformat()
    except (OSError, OverflowError, TypeError, ValueError):
        return utc_now()


def infer_raw_image_view(image_path: Path) -> str:
    normalized_name = image_path.stem.strip().lower()
    if any(token in normalized_name for token in ("fluorescein", "fluoro", "fluo", "stain", "seidel")):
        return "fluorescein"
    if any(token in normalized_name for token in ("slit", "beam")):
        return "slit"
    return "white"


def safe_path_component(value: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9._-]+", "_", str(value or "").strip())
    return normalized or "unknown"
