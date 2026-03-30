from __future__ import annotations

import ast
from datetime import datetime, timezone
from io import BytesIO
import os
import re
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

import pandas as pd
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import and_, case, column, delete, desc, func, literal_column, or_, select, table, update

from kera_research.config import (
    BASE_DIR,
    PATIENT_REFERENCE_SALT,
    STORAGE_DIR,
    SITE_ROOT_DIR,
    ensure_base_directories,
    remap_bundle_paths_in_value,
    remap_bundle_absolute_path,
    resolve_portable_path,
)
from kera_research.db import (
    CONTROL_PLANE_DATABASE_URL,
    CONTROL_PLANE_ENGINE,
    DATA_PLANE_DATABASE_URL,
    DATA_PLANE_ENGINE,
    app_settings,
    data_plane_sqlite_search_ready,
    images as db_images,
    init_control_plane_db,
    init_data_plane_db,
    patients as db_patients,
    site_jobs,
    site_patient_splits,
    sites as control_sites,
    visits as db_visits,
)
from kera_research.domain import (
    MANIFEST_COLUMNS,
    VISIT_STATUS_OPTIONS,
    make_id,
    make_patient_reference_id,
    normalize_actual_visit_date,
    normalize_patient_pseudonym,
    normalize_visit_label,
    utc_now,
    visit_index_from_label,
)
from kera_research.services.quality import score_slit_lamp_image
from kera_research.storage import ensure_dir, read_json, write_csv, write_json

_ALLOWED_IMAGE_FORMATS = {"JPEG", "PNG", "TIFF", "BMP", "WEBP"}
_RAW_INVENTORY_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"}
_MAX_IMAGE_PIXELS = 40_000_000
_PREWARMED_IMAGE_PREVIEW_SIDES = (256, 640)
_SITE_STORAGE_ROOT_CACHE: dict[str, Path] = {}
_SITE_STORAGE_ROOT_CACHE_LOCK = threading.Lock()
_SITE_LEGACY_VISIT_LABEL_REPAIRED: set[str] = set()
_SITE_LEGACY_VISIT_LABEL_REPAIRED_LOCK = threading.Lock()
_SITE_MISSING_IMAGE_PATH_REPAIR_LAST_RUN: dict[str, float] = {}
_SITE_MISSING_IMAGE_PATH_REPAIR_LOCK = threading.Lock()
_SITE_MISSING_IMAGE_PATH_REPAIR_INTERVAL_SECONDS = 15.0
_SITE_RAW_METADATA_SYNC_LAST_RUN: dict[str, float] = {}
_SITE_RAW_METADATA_SYNC_LOCK = threading.Lock()
_SITE_RAW_METADATA_SYNC_INTERVAL_SECONDS = 15.0
_INSTANCE_STORAGE_ROOT_SETTING_KEY = "instance_storage_root"
_PLACEHOLDER_SYNC_SOURCE = "raw_inventory_sync"


class InvalidImageUploadError(ValueError):
    pass


def control_plane_split_enabled() -> bool:
    return CONTROL_PLANE_DATABASE_URL != DATA_PLANE_DATABASE_URL


def _site_storage_lookup_mode() -> str:
    mode = os.getenv("KERA_SITE_STORAGE_SOURCE", "").strip().lower()
    if mode == "control_plane":
        return "control_plane"
    if mode == "local":
        return "local"
    return "auto"


def invalidate_site_storage_root_cache(site_id: str | None = None) -> None:
    normalized_site_id = str(site_id or "").strip()
    with _SITE_STORAGE_ROOT_CACHE_LOCK:
        if normalized_site_id:
            _SITE_STORAGE_ROOT_CACHE.pop(normalized_site_id, None)
            return
        _SITE_STORAGE_ROOT_CACHE.clear()


def _resolve_storage_path(value: str | Path) -> Path:
    candidate = Path(value).expanduser()
    if not candidate.is_absolute():
        candidate = (BASE_DIR / candidate).resolve()
    else:
        candidate = candidate.resolve()
    return candidate


def _normalize_instance_storage_root(candidate: Path) -> Path:
    looks_like_storage_bundle = candidate.name.strip().lower() == "kera_data" or any(
        (candidate / child_name).exists() for child_name in ("sites", "control_plane", "models")
    )
    if looks_like_storage_bundle and candidate.name.strip().lower() != "sites":
        return (candidate / "sites").resolve()
    return candidate.resolve()


def _control_plane_root_override(site_id: str) -> Path | None:
    with CONTROL_PLANE_ENGINE.begin() as conn:
        site_row = conn.execute(
            select(control_sites.c.local_storage_root).where(control_sites.c.site_id == site_id)
        ).first()
        if site_row and str(site_row[0] or "").strip():
            configured_root = _resolve_storage_path(str(site_row[0] or "").strip())
            remapped_root, remapped = resolve_portable_path(configured_root, require_exists=False)
            if remapped:
                return remapped_root
            return configured_root
        setting_row = conn.execute(
            select(app_settings.c.setting_value).where(app_settings.c.setting_key == _INSTANCE_STORAGE_ROOT_SETTING_KEY)
        ).first()
    configured_instance_root = str(setting_row[0] or "").strip() if setting_row else ""
    if not configured_instance_root:
        return None
    configured_site_root = _normalize_instance_storage_root(_resolve_storage_path(configured_instance_root)) / site_id
    if os.getenv("KERA_STORAGE_DIR", "").strip() and STORAGE_DIR.name.strip().lower() == "kera_data" and not configured_site_root.exists():
        remapped_root = remap_bundle_absolute_path(configured_site_root)
        if remapped_root is not None and remapped_root.exists():
            return remapped_root.resolve()
    return configured_site_root


def _normalize_organism_entry(entry: dict[str, Any] | None) -> dict[str, str] | None:
    if not isinstance(entry, dict):
        return None
    category = str(entry.get("culture_category", "")).strip().lower()
    species = str(entry.get("culture_species", "")).strip()
    if not category or not species:
        return None
    return {
        "culture_category": category,
        "culture_species": species,
    }


def _normalize_additional_organisms(
    primary_category: str,
    primary_species: str,
    additional_organisms: list[dict[str, Any]] | None,
) -> list[dict[str, str]]:
    primary_key = f"{primary_category.strip().lower()}::{primary_species.strip().lower()}"
    normalized: list[dict[str, str]] = []
    seen = {primary_key}
    for raw_entry in additional_organisms or []:
        entry = _normalize_organism_entry(raw_entry)
        if entry is None:
            continue
        entry_key = f"{entry['culture_category']}::{entry['culture_species'].lower()}"
        if entry_key in seen:
            continue
        seen.add(entry_key)
        normalized.append(entry)
    return normalized


def _list_organisms(
    culture_category: str,
    culture_species: str,
    additional_organisms: list[dict[str, Any]] | None,
) -> list[dict[str, str]]:
    primary_species = str(culture_species or "").strip()
    normalized_additional = _normalize_additional_organisms(
        culture_category,
        culture_species,
        additional_organisms,
    )
    if not primary_species:
        return normalized_additional
    return [
        {
            "culture_category": str(culture_category or "").strip().lower(),
            "culture_species": primary_species,
        },
        *normalized_additional,
    ]


def _organism_summary_label(
    culture_category: str,
    culture_species: str,
    additional_organisms: list[dict[str, Any]] | None,
    *,
    max_visible_species: int = 2,
) -> str:
    organisms = _list_organisms(culture_category, culture_species, additional_organisms)
    if not organisms:
        return ""
    visible_count = max(1, int(max_visible_species or 1))
    if len(organisms) <= visible_count:
        return " / ".join(item["culture_species"] for item in organisms)
    visible = " / ".join(item["culture_species"] for item in organisms[:visible_count])
    return f"{visible} + {len(organisms) - visible_count}"


def _coerce_optional_text(value: Any, default: str = "") -> str:
    if value is None:
        return default
    if isinstance(value, float) and pd.isna(value):
        return default
    return str(value).strip()


def _coerce_optional_int(value: Any, default: int = 0) -> int:
    if value is None:
        return default
    if isinstance(value, float) and pd.isna(value):
        return default
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _coerce_optional_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, float) and pd.isna(value):
        return default
    normalized = str(value).strip().lower()
    if normalized in {"1", "true", "yes", "y"}:
        return True
    if normalized in {"0", "false", "no", "n"}:
        return False
    return default


def _parse_manifest_pipe_list(value: Any) -> list[str]:
    raw = _coerce_optional_text(value)
    return [item.strip() for item in raw.split("|") if item.strip()]


def _parse_manifest_box(value: Any) -> dict[str, float] | None:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    if isinstance(value, dict):
        candidate = value
    else:
        raw = str(value).strip()
        if not raw:
            return None
        try:
            candidate = ast.literal_eval(raw)
        except (SyntaxError, ValueError):
            return None
    if not isinstance(candidate, dict):
        return None
    normalized: dict[str, float] = {}
    for key in ("x0", "y0", "x1", "y1"):
        raw_value = candidate.get(key)
        if raw_value is None:
            continue
        try:
            normalized[key] = float(raw_value)
        except (TypeError, ValueError):
            continue
    return normalized or None


def _case_summary_sort_key(summary: dict[str, Any]) -> tuple[str, str, str, str]:
    return (
        str(summary.get("latest_image_uploaded_at") or ""),
        str(summary.get("created_at") or ""),
        str(summary.get("visit_date") or ""),
        str(summary.get("patient_id") or ""),
    )


def _case_summary_search_haystack(summary: dict[str, Any]) -> str:
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


def _sqlite_search_tokens(value: str) -> list[str]:
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


def _sqlite_patient_case_match_query(value: str | None) -> str | None:
    tokens = _sqlite_search_tokens(str(value or ""))
    if not tokens:
        return None
    return " ".join(f"{token}*" for token in tokens)


def _sanitize_image_bytes(content: bytes, file_name: str) -> tuple[bytes, str]:
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


def _resolve_site_storage_root(site_id: str) -> Path:
    with _SITE_STORAGE_ROOT_CACHE_LOCK:
        cached = _SITE_STORAGE_ROOT_CACHE.get(site_id)
        if cached is not None:
            return cached

    resolved_root = (SITE_ROOT_DIR / site_id).resolve()
    if _site_storage_lookup_mode() != "local":
        init_control_plane_db()
        try:
            configured_root = _control_plane_root_override(site_id)
        except Exception:
            configured_root = None
        if configured_root is not None:
            resolved_root = configured_root.resolve()

    with _SITE_STORAGE_ROOT_CACHE_LOCK:
        _SITE_STORAGE_ROOT_CACHE[site_id] = resolved_root
    return resolved_root


def _safe_path_component(value: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9._-]+", "_", str(value or "").strip())
    return normalized or "unknown"


def _filesystem_timestamp_to_utc(value: float | None) -> str:
    if value is None:
        return utc_now()
    try:
        return datetime.fromtimestamp(float(value), tz=timezone.utc).replace(microsecond=0).isoformat()
    except (OSError, OverflowError, TypeError, ValueError):
        return utc_now()


def _infer_raw_image_view(image_path: Path) -> str:
    normalized_name = image_path.stem.strip().lower()
    if any(token in normalized_name for token in ("fluorescein", "fluoro", "fluo", "stain", "seidel")):
        return "fluorescein"
    if any(token in normalized_name for token in ("slit", "beam")):
        return "slit"
    return "white"


def _sqlite_path_from_url(database_url: str | None) -> Path | None:
    raw = str(database_url or "").strip()
    if not raw.startswith("sqlite:///"):
        return None
    candidate = raw[len("sqlite:///") :]
    if re.match(r"^/[A-Za-z]:/", candidate):
        candidate = candidate[1:]
    if not candidate:
        return None
    return Path(candidate).expanduser().resolve()


class SiteStore:
    def __init__(self, site_id: str) -> None:
        ensure_base_directories()
        init_data_plane_db()
        if _site_storage_lookup_mode() != "local":
            init_control_plane_db()
        self.site_id = site_id
        self.site_dir = _resolve_site_storage_root(site_id)
        self.raw_dir = self.site_dir / "data" / "raw"
        self.manifest_dir = self.site_dir / "manifests"
        self.manifest_path = self.manifest_dir / "dataset_manifest.csv"
        self.artifact_dir = self.site_dir / "artifacts"
        self.gradcam_dir = self.artifact_dir / "gradcam"
        self.medsam_mask_dir = self.artifact_dir / "medsam_masks"
        self.roi_crop_dir = self.artifact_dir / "roi_crops"
        self.lesion_mask_dir = self.artifact_dir / "lesion_masks"
        self.lesion_crop_dir = self.artifact_dir / "lesion_crops"
        self.embedding_dir = self.artifact_dir / "embeddings"
        self.image_preview_dir = self.artifact_dir / "image_previews"
        self.validation_dir = self.site_dir / "validation"
        self.update_dir = self.site_dir / "model_updates"
        self.case_history_dir = self.site_dir / "case_history"
        self._seed_defaults()
        self._repair_legacy_visit_labels_once()

    def _seed_defaults(self) -> None:
        for path in (
            self.raw_dir,
            self.manifest_dir,
            self.gradcam_dir,
            self.medsam_mask_dir,
            self.roi_crop_dir,
            self.lesion_mask_dir,
            self.lesion_crop_dir,
            self.embedding_dir,
            self.image_preview_dir,
            self.validation_dir,
            self.update_dir,
            self.case_history_dir,
        ):
            ensure_dir(path)

    def _resolve_site_runtime_path(self, value: Any, *, require_exists: bool = False) -> tuple[Path, bool]:
        resolved, remapped = resolve_portable_path(
            _coerce_optional_text(value),
            base_dir=self.site_dir,
            require_exists=require_exists,
        )
        return resolved, remapped

    def _persist_image_record_path(self, image_id: str, image_path: Path) -> None:
        normalized_image_id = _coerce_optional_text(image_id)
        if not normalized_image_id:
            return
        with DATA_PLANE_ENGINE.begin() as conn:
            conn.execute(
                update(db_images)
                .where(and_(db_images.c.site_id == self.site_id, db_images.c.image_id == normalized_image_id))
                .values(image_path=str(image_path))
            )

    def _canonical_image_storage_path(self, patient_id: str, visit_date: str, image_name: str) -> Path:
        return (self.raw_dir / patient_id / visit_date / image_name).resolve()

    def _prune_empty_raw_dirs(self, start_dir: Path, *, patient_dir: Path) -> int:
        removed_count = 0
        current = start_dir.resolve()
        stop_dir = patient_dir.resolve()
        while current != stop_dir and current.exists() and current.is_dir():
            try:
                next(current.iterdir())
                break
            except StopIteration:
                try:
                    current.rmdir()
                except OSError:
                    break
                removed_count += 1
                current = current.parent
        return removed_count

    def _resolve_image_record_path(self, record: dict[str, Any], *, persist: bool = True) -> dict[str, Any]:
        raw_path = _coerce_optional_text(record.get("image_path"))
        if not raw_path:
            return record
        image_id = _coerce_optional_text(record.get("image_id"))
        patient_id = _coerce_optional_text(record.get("patient_id"))
        visit_date = _coerce_optional_text(record.get("visit_date"))
        image_name = Path(raw_path).name
        should_persist = False
        try:
            resolved_path, remapped = self._resolve_site_runtime_path(raw_path, require_exists=True)
            if not resolved_path.exists():
                raise ValueError("Image file not found on disk.")
            should_persist = remapped and Path(raw_path).is_absolute()
        except Exception:
            try:
                resolved_path = self._resolve_recovery_image_path(raw_path, patient_id, image_name, visit_date=visit_date)
                should_persist = str(resolved_path) != raw_path
            except Exception:
                return record
        record["image_path"] = str(resolved_path)
        if persist and should_persist:
            self._persist_image_record_path(image_id, resolved_path)
        return record

    def repair_missing_image_paths(self) -> dict[str, int]:
        query = (
            select(
                db_images.c.image_id,
                db_images.c.patient_id,
                db_images.c.visit_date,
                db_images.c.image_path,
            )
            .where(db_images.c.site_id == self.site_id)
            .order_by(db_images.c.patient_id, db_images.c.visit_date, db_images.c.uploaded_at)
        )
        with DATA_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(query).mappings().all()

        missing_before = 0
        repaired_paths = 0
        unresolved_paths = 0
        remapped_paths = 0

        for row in rows:
            image_id = _coerce_optional_text(row.get("image_id"))
            patient_id = _coerce_optional_text(row.get("patient_id"))
            visit_date = _coerce_optional_text(row.get("visit_date"))
            raw_path = _coerce_optional_text(row.get("image_path"))
            image_name = Path(raw_path).name
            if not image_id or not raw_path or not image_name:
                unresolved_paths += 1
                continue

            try:
                resolved_path, remapped = self._resolve_site_runtime_path(raw_path, require_exists=True)
                if resolved_path.exists():
                    if remapped and Path(raw_path).is_absolute() and str(resolved_path) != raw_path:
                        self._persist_image_record_path(image_id, resolved_path)
                        repaired_paths += 1
                        remapped_paths += 1
                    continue
            except Exception:
                pass

            missing_before += 1
            try:
                resolved_path = self._resolve_recovery_image_path(
                    raw_path,
                    patient_id,
                    image_name,
                    visit_date=visit_date,
                )
            except ValueError:
                unresolved_paths += 1
                continue

            if str(resolved_path) != raw_path:
                self._persist_image_record_path(image_id, resolved_path)
                repaired_paths += 1

        return {
            "site_id": self.site_id,
            "scanned_images": len(rows),
            "missing_before": missing_before,
            "repaired_paths": repaired_paths,
            "remapped_paths": remapped_paths,
            "unresolved_paths": unresolved_paths,
        }

    def _repair_missing_image_paths_if_due(self, *, force: bool = False) -> dict[str, int]:
        with _SITE_MISSING_IMAGE_PATH_REPAIR_LOCK:
            now = time.monotonic()
            last_run = _SITE_MISSING_IMAGE_PATH_REPAIR_LAST_RUN.get(self.site_id, 0.0)
            if not force and (now - last_run) < _SITE_MISSING_IMAGE_PATH_REPAIR_INTERVAL_SECONDS:
                return {
                    "site_id": self.site_id,
                    "scanned_images": 0,
                    "missing_before": 0,
                    "repaired_paths": 0,
                    "remapped_paths": 0,
                    "unresolved_paths": 0,
                }
            result = self.repair_missing_image_paths()
            _SITE_MISSING_IMAGE_PATH_REPAIR_LAST_RUN[self.site_id] = time.monotonic()
            return result

    def _case_history_path(self, patient_id: str, visit_date: str) -> Path:
        patient_dir = ensure_dir(self.case_history_dir / _safe_path_component(patient_id))
        return patient_dir / f"{_safe_path_component(visit_date)}.json"

    def _repair_legacy_visit_labels_once(self) -> None:
        with _SITE_LEGACY_VISIT_LABEL_REPAIRED_LOCK:
            if self.site_id in _SITE_LEGACY_VISIT_LABEL_REPAIRED:
                return

            history_moves: list[tuple[Path, Path]] = []
            with DATA_PLANE_ENGINE.begin() as conn:
                visit_rows = conn.execute(
                    select(
                        db_visits.c.visit_id,
                        db_visits.c.patient_id,
                        db_visits.c.visit_date,
                    ).where(db_visits.c.site_id == self.site_id)
                ).mappings().all()
                for row in visit_rows:
                    visit_id = _coerce_optional_text(row.get("visit_id"))
                    patient_id = _coerce_optional_text(row.get("patient_id"))
                    raw_visit_date = _coerce_optional_text(row.get("visit_date"))
                    if not visit_id or not patient_id or not raw_visit_date:
                        continue
                    try:
                        normalized_visit_date = normalize_visit_label(raw_visit_date)
                    except ValueError:
                        continue
                    if normalized_visit_date == raw_visit_date:
                        continue
                    collision_visit_id = conn.execute(
                        select(db_visits.c.visit_id).where(
                            and_(
                                db_visits.c.site_id == self.site_id,
                                db_visits.c.patient_id == patient_id,
                                db_visits.c.visit_date == normalized_visit_date,
                                db_visits.c.visit_id != visit_id,
                            )
                        )
                    ).scalar()
                    if collision_visit_id:
                        continue
                    conn.execute(
                        update(db_visits)
                        .where(and_(db_visits.c.site_id == self.site_id, db_visits.c.visit_id == visit_id))
                        .values(
                            visit_date=normalized_visit_date,
                            visit_index=visit_index_from_label(normalized_visit_date),
                            is_initial_visit=normalized_visit_date == "Initial",
                        )
                    )
                    conn.execute(
                        update(db_images)
                        .where(and_(db_images.c.site_id == self.site_id, db_images.c.visit_id == visit_id))
                        .values(visit_date=normalized_visit_date)
                    )
                    source_history_path = self._case_history_path(patient_id, raw_visit_date)
                    target_history_path = self._case_history_path(patient_id, normalized_visit_date)
                    if source_history_path != target_history_path and source_history_path.exists():
                        history_moves.append((source_history_path, target_history_path))

            for source_history_path, target_history_path in history_moves:
                if not source_history_path.exists():
                    continue
                ensure_dir(target_history_path.parent)
                if target_history_path.exists():
                    continue
                source_history_path.replace(target_history_path)

            _SITE_LEGACY_VISIT_LABEL_REPAIRED.add(self.site_id)

    def _get_visit_by_id(self, visit_id: str) -> dict[str, Any] | None:
        query = select(db_visits).where(and_(db_visits.c.site_id == self.site_id, db_visits.c.visit_id == visit_id))
        with DATA_PLANE_ENGINE.begin() as conn:
            row = conn.execute(query).mappings().first()
        return dict(row) if row else None

    def _resolve_visit_reference(self, patient_id: str, visit_date: str) -> tuple[str, str]:
        normalized_patient_id = normalize_patient_pseudonym(patient_id)
        requested_visit_date = _coerce_optional_text(visit_date)
        if requested_visit_date:
            existing_visit = self.get_visit(normalized_patient_id, requested_visit_date)
            if existing_visit is not None:
                return (
                    _coerce_optional_text(existing_visit.get("patient_id")) or normalized_patient_id,
                    _coerce_optional_text(existing_visit.get("visit_date")) or requested_visit_date,
                )
        return normalized_patient_id, requested_visit_date

    def load_case_history(self, patient_id: str, visit_date: str) -> dict[str, list[dict[str, Any]]]:
        resolved_patient_id, resolved_visit_date = self._resolve_visit_reference(patient_id, visit_date)
        history_path = self._case_history_path(resolved_patient_id, resolved_visit_date)
        payload = read_json(history_path, {"validations": [], "contributions": []})
        validations = [
            dict(remap_bundle_paths_in_value(dict(item))) for item in payload.get("validations", []) if isinstance(item, dict)
        ]
        contributions = [
            dict(remap_bundle_paths_in_value(dict(item))) for item in payload.get("contributions", []) if isinstance(item, dict)
        ]
        validations.sort(
            key=lambda item: (
                str(item.get("run_date") or ""),
                str(item.get("validation_id") or ""),
            ),
            reverse=True,
        )
        contributions.sort(
            key=lambda item: (
                str(item.get("created_at") or ""),
                str(item.get("contribution_id") or ""),
            ),
            reverse=True,
        )
        return {
            "validations": validations,
            "contributions": contributions,
        }

    def record_case_validation_history(self, patient_id: str, visit_date: str, entry: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
        resolved_patient_id, resolved_visit_date = self._resolve_visit_reference(patient_id, visit_date)
        history = self.load_case_history(resolved_patient_id, resolved_visit_date)
        validation_id = str(entry.get("validation_id") or "").strip()
        if validation_id:
            history["validations"] = [
                item
                for item in history["validations"]
                if str(item.get("validation_id") or "").strip() != validation_id
            ]
        history["validations"].append(dict(entry))
        history["validations"].sort(
            key=lambda item: (
                str(item.get("run_date") or ""),
                str(item.get("validation_id") or ""),
            ),
            reverse=True,
        )
        write_json(self._case_history_path(resolved_patient_id, resolved_visit_date), history)
        return history

    def record_case_contribution_history(self, patient_id: str, visit_date: str, entry: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
        resolved_patient_id, resolved_visit_date = self._resolve_visit_reference(patient_id, visit_date)
        history = self.load_case_history(resolved_patient_id, resolved_visit_date)
        contribution_id = str(entry.get("contribution_id") or "").strip()
        if contribution_id:
            history["contributions"] = [
                item
                for item in history["contributions"]
                if str(item.get("contribution_id") or "").strip() != contribution_id
            ]
        history["contributions"].append(dict(entry))
        history["contributions"].sort(
            key=lambda item: (
                str(item.get("created_at") or ""),
                str(item.get("contribution_id") or ""),
            ),
            reverse=True,
        )
        write_json(self._case_history_path(resolved_patient_id, resolved_visit_date), history)
        return history

    def list_patients(self, created_by_user_id: str | None = None) -> list[dict[str, Any]]:
        self._sync_raw_inventory_metadata_if_due()
        query = select(db_patients).where(db_patients.c.site_id == self.site_id)
        if created_by_user_id:
            query = query.where(db_patients.c.created_by_user_id == created_by_user_id)
        query = query.order_by(db_patients.c.created_at.desc())
        with DATA_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(query).mappings().all()
        return [
            {
                "patient_id": row["patient_id"],
                "created_by_user_id": row.get("created_by_user_id"),
                "sex": row["sex"],
                "age": row["age"],
                "chart_alias": row["chart_alias"],
                "local_case_code": row["local_case_code"],
                "created_at": row["created_at"],
            }
            for row in rows
        ]

    def get_patient(self, patient_id: str) -> dict[str, Any] | None:
        self._sync_raw_inventory_metadata_if_due()
        query = select(db_patients).where(
            and_(db_patients.c.site_id == self.site_id, db_patients.c.patient_id == patient_id)
        )
        with DATA_PLANE_ENGINE.begin() as conn:
            row = conn.execute(query).mappings().first()
        if row is None:
            return None
        return {
            "patient_id": row["patient_id"],
            "created_by_user_id": row.get("created_by_user_id"),
            "sex": row["sex"],
            "age": row["age"],
            "chart_alias": row["chart_alias"],
            "local_case_code": row["local_case_code"],
            "created_at": row["created_at"],
        }

    def lookup_patient_id(self, patient_id: str) -> dict[str, Any]:
        self._sync_raw_inventory_metadata_if_due()
        requested_patient_id = str(patient_id or "").strip()
        normalized_patient_id = normalize_patient_pseudonym(patient_id)
        if not normalized_patient_id:
            raise ValueError("Patient id is required.")

        patient_query = select(db_patients).where(
            and_(db_patients.c.site_id == self.site_id, db_patients.c.patient_id == normalized_patient_id)
        )
        visit_count_query = (
            select(func.count())
            .select_from(db_visits)
            .where(and_(db_visits.c.site_id == self.site_id, db_visits.c.patient_id == normalized_patient_id))
        )
        image_count_query = (
            select(func.count())
            .select_from(db_images)
            .where(and_(db_images.c.site_id == self.site_id, db_images.c.patient_id == normalized_patient_id))
        )
        latest_visit_query = (
            select(db_visits.c.visit_date)
            .where(and_(db_visits.c.site_id == self.site_id, db_visits.c.patient_id == normalized_patient_id))
            .order_by(desc(db_visits.c.visit_index), desc(db_visits.c.visit_date))
            .limit(1)
        )

        with DATA_PLANE_ENGINE.begin() as conn:
            patient_row = conn.execute(patient_query).mappings().first()
            visit_count = conn.execute(visit_count_query).scalar() or 0
            image_count = conn.execute(image_count_query).scalar() or 0
            latest_visit_date = conn.execute(latest_visit_query).scalar()

        patient_record = None
        if patient_row is not None:
            patient_record = {
                "patient_id": patient_row["patient_id"],
                "created_by_user_id": patient_row.get("created_by_user_id"),
                "sex": patient_row["sex"],
                "age": patient_row["age"],
                "chart_alias": patient_row["chart_alias"],
                "local_case_code": patient_row["local_case_code"],
                "created_at": patient_row["created_at"],
            }

        return {
            "requested_patient_id": requested_patient_id,
            "normalized_patient_id": normalized_patient_id,
            "exists": patient_record is not None,
            "patient": patient_record,
            "visit_count": int(visit_count or 0),
            "image_count": int(image_count or 0),
            "latest_visit_date": str(latest_visit_date or "") or None,
        }

    def create_patient(
        self,
        patient_id: str,
        sex: str,
        age: int,
        chart_alias: str = "",
        local_case_code: str = "",
        created_by_user_id: str | None = None,
    ) -> dict[str, Any]:
        normalized_patient_id = normalize_patient_pseudonym(patient_id)
        if self.get_patient(normalized_patient_id):
            raise ValueError(f"Patient {normalized_patient_id} already exists.")
        record = {
            "site_id": self.site_id,
            "patient_id": normalized_patient_id,
            "created_by_user_id": created_by_user_id,
            "sex": sex,
            "age": int(age),
            "chart_alias": chart_alias.strip(),
            "local_case_code": local_case_code.strip(),
            "created_at": utc_now(),
        }
        with DATA_PLANE_ENGINE.begin() as conn:
            conn.execute(db_patients.insert().values(**record))
        return {
            key: record[key]
            for key in [
                "patient_id",
                "created_by_user_id",
                "sex",
                "age",
                "chart_alias",
                "local_case_code",
                "created_at",
            ]
        }

    def update_patient(
        self,
        patient_id: str,
        sex: str,
        age: int,
        chart_alias: str = "",
        local_case_code: str = "",
    ) -> dict[str, Any]:
        normalized_patient_id = normalize_patient_pseudonym(patient_id)
        existing = self.get_patient(normalized_patient_id)
        if existing is None:
            raise ValueError(f"Patient {normalized_patient_id} does not exist.")
        values = {
            "sex": sex,
            "age": int(age),
            "chart_alias": chart_alias.strip(),
            "local_case_code": local_case_code.strip(),
        }
        with DATA_PLANE_ENGINE.begin() as conn:
            conn.execute(
                update(db_patients)
                .where(
                    and_(
                        db_patients.c.site_id == self.site_id,
                        db_patients.c.patient_id == normalized_patient_id,
                    )
                )
                .values(**values)
            )
        refreshed = self.get_patient(normalized_patient_id)
        if refreshed is None:
            raise ValueError(f"Patient {normalized_patient_id} does not exist.")
        return refreshed

    def list_visits(self) -> list[dict[str, Any]]:
        self._sync_raw_inventory_metadata_if_due()
        query = (
            select(db_visits)
            .where(db_visits.c.site_id == self.site_id)
            .order_by(db_visits.c.patient_id, db_visits.c.visit_index, db_visits.c.visit_date)
        )
        with DATA_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(query).mappings().all()
        return [dict(row) for row in rows]

    def get_visit(self, patient_id: str, visit_date: str) -> dict[str, Any] | None:
        self._sync_raw_inventory_metadata_if_due()
        normalized_patient_id = normalize_patient_pseudonym(patient_id)
        requested_visit_date = _coerce_optional_text(visit_date)
        if not requested_visit_date:
            return None
        try:
            normalized_visit_date = normalize_visit_label(requested_visit_date)
            normalized_visit_index = visit_index_from_label(normalized_visit_date)
        except ValueError:
            normalized_visit_date = None
            normalized_visit_index = None

        base_query = select(db_visits).where(
            and_(
                db_visits.c.site_id == self.site_id,
                db_visits.c.patient_id == normalized_patient_id,
            )
        )
        with DATA_PLANE_ENGINE.begin() as conn:
            row = conn.execute(base_query.where(db_visits.c.visit_date == requested_visit_date)).mappings().first()
            if row is not None:
                return dict(row)
            if normalized_visit_date and normalized_visit_date != requested_visit_date:
                row = conn.execute(base_query.where(db_visits.c.visit_date == normalized_visit_date)).mappings().first()
                if row is not None:
                    return dict(row)
            if normalized_visit_index is not None:
                row = conn.execute(
                    base_query.where(db_visits.c.visit_index == normalized_visit_index).order_by(
                        case((db_visits.c.visit_date == normalized_visit_date, 0), else_=1),
                        db_visits.c.created_at.desc(),
                    )
                ).mappings().first()
                if row is not None:
                    return dict(row)
        return None

    def create_visit(
        self,
        patient_id: str,
        visit_date: str,
        actual_visit_date: str | None,
        culture_confirmed: bool,
        culture_category: str,
        culture_species: str,
        additional_organisms: list[dict[str, Any]] | None,
        contact_lens_use: str,
        predisposing_factor: list[str],
        other_history: str,
        active_stage: bool = True,
        visit_status: str = "active",
        is_initial_visit: bool = False,
        smear_result: str = "",
        polymicrobial: bool = False,
        created_by_user_id: str | None = None,
    ) -> dict[str, Any]:
        normalized_patient_id = normalize_patient_pseudonym(patient_id)
        normalized_visit_date = normalize_visit_label(visit_date)
        normalized_actual_visit_date = normalize_actual_visit_date(actual_visit_date)
        if not self.get_patient(normalized_patient_id):
            raise ValueError(f"Patient {normalized_patient_id} does not exist.")
        if normalized_visit_date == "Initial":
            visit_count_query = (
                select(func.count())
                .select_from(db_visits)
                .where(and_(db_visits.c.site_id == self.site_id, db_visits.c.patient_id == normalized_patient_id))
            )
            with DATA_PLANE_ENGINE.begin() as conn:
                existing_visit_count = int(conn.execute(visit_count_query).scalar() or 0)
            if existing_visit_count > 0:
                raise ValueError("Existing patients can only receive follow-up visits. Use a FU #N label.")
        if not culture_confirmed:
            raise ValueError("Only culture-proven keratitis cases are allowed.")
        if self.get_visit(normalized_patient_id, normalized_visit_date):
            raise ValueError(f"Visit {normalized_patient_id} / {normalized_visit_date} already exists.")
        normalized_category = culture_category.strip().lower()
        normalized_species = culture_species.strip()
        normalized_additional_organisms = _normalize_additional_organisms(
            normalized_category,
            normalized_species,
            additional_organisms,
        )
        normalized_status = (visit_status or "").strip().lower()
        if normalized_status not in VISIT_STATUS_OPTIONS:
            normalized_status = "active" if active_stage else "scar"
        record = {
            "visit_id": make_id("visit"),
            "site_id": self.site_id,
            "patient_id": normalized_patient_id,
            "patient_reference_id": make_patient_reference_id(
                self.site_id,
                normalized_patient_id,
                PATIENT_REFERENCE_SALT,
            ),
            "created_by_user_id": created_by_user_id,
            "visit_date": normalized_visit_date,
            "visit_index": visit_index_from_label(normalized_visit_date),
            "actual_visit_date": normalized_actual_visit_date,
            "culture_confirmed": bool(culture_confirmed),
            "culture_category": normalized_category,
            "culture_species": normalized_species,
            "contact_lens_use": contact_lens_use,
            "predisposing_factor": predisposing_factor,
            "additional_organisms": normalized_additional_organisms,
            "other_history": other_history,
            "visit_status": normalized_status,
            "active_stage": normalized_status == "active",
            "is_initial_visit": bool(is_initial_visit),
            "smear_result": smear_result.strip(),
            "polymicrobial": bool(polymicrobial or normalized_additional_organisms),
            "research_registry_status": "analysis_only",
            "research_registry_updated_at": utc_now(),
            "research_registry_updated_by": created_by_user_id,
            "research_registry_source": "visit_create",
            "created_at": utc_now(),
        }
        with DATA_PLANE_ENGINE.begin() as conn:
            conn.execute(db_visits.insert().values(**record))
        return record

    def update_visit(
        self,
        patient_id: str,
        visit_date: str,
        target_patient_id: str | None,
        target_visit_date: str | None,
        actual_visit_date: str | None,
        culture_confirmed: bool,
        culture_category: str,
        culture_species: str,
        additional_organisms: list[dict[str, Any]] | None,
        contact_lens_use: str,
        predisposing_factor: list[str],
        other_history: str,
        active_stage: bool = True,
        visit_status: str = "active",
        is_initial_visit: bool = False,
        smear_result: str = "",
        polymicrobial: bool = False,
    ) -> dict[str, Any]:
        normalized_patient_id = normalize_patient_pseudonym(patient_id)
        normalized_visit_date = normalize_visit_label(visit_date)
        normalized_target_patient_id = normalize_patient_pseudonym(target_patient_id or patient_id)
        normalized_target_visit_date = normalize_visit_label(target_visit_date or visit_date)
        normalized_actual_visit_date = normalize_actual_visit_date(actual_visit_date)
        existing = self.get_visit(normalized_patient_id, normalized_visit_date)
        if existing is None:
            raise ValueError(f"Visit {normalized_patient_id} / {normalized_visit_date} does not exist.")
        if not culture_confirmed:
            raise ValueError("Only culture-proven keratitis cases are allowed.")
        if self.get_patient(normalized_target_patient_id) is None:
            raise ValueError(f"Patient {normalized_target_patient_id} does not exist.")
        existing_visit_id = _coerce_optional_text(existing.get("visit_id"))
        existing_patient_id = _coerce_optional_text(existing.get("patient_id")) or normalized_patient_id
        existing_visit_date = _coerce_optional_text(existing.get("visit_date")) or normalized_visit_date
        target_changed = (
            normalized_target_patient_id != existing_patient_id
            or normalized_target_visit_date != existing_visit_date
        )
        if target_changed:
            with DATA_PLANE_ENGINE.begin() as conn:
                duplicate_visit = conn.execute(
                    select(db_visits.c.visit_id).where(
                        and_(
                            db_visits.c.site_id == self.site_id,
                            db_visits.c.patient_id == normalized_target_patient_id,
                            db_visits.c.visit_date == normalized_target_visit_date,
                            db_visits.c.visit_id != existing_visit_id,
                        )
                    )
                ).scalar()
            if duplicate_visit:
                raise ValueError(
                    f"Visit {normalized_target_patient_id} / {normalized_target_visit_date} already exists."
                )
        normalized_category = culture_category.strip().lower()
        normalized_species = culture_species.strip()
        normalized_additional_organisms = _normalize_additional_organisms(
            normalized_category,
            normalized_species,
            additional_organisms,
        )
        normalized_status = (visit_status or "").strip().lower()
        if normalized_status not in VISIT_STATUS_OPTIONS:
            normalized_status = "active" if active_stage else "scar"
        values = {
            "patient_id": normalized_target_patient_id,
            "patient_reference_id": make_patient_reference_id(
                self.site_id,
                normalized_target_patient_id,
                PATIENT_REFERENCE_SALT,
            ),
            "actual_visit_date": normalized_actual_visit_date,
            "visit_date": normalized_target_visit_date,
            "visit_index": visit_index_from_label(normalized_target_visit_date),
            "culture_confirmed": bool(culture_confirmed),
            "culture_category": normalized_category,
            "culture_species": normalized_species,
            "contact_lens_use": contact_lens_use,
            "predisposing_factor": predisposing_factor,
            "additional_organisms": normalized_additional_organisms,
            "other_history": other_history,
            "visit_status": normalized_status,
            "active_stage": normalized_status == "active",
            "is_initial_visit": bool(is_initial_visit),
            "smear_result": smear_result.strip(),
            "polymicrobial": bool(polymicrobial or normalized_additional_organisms),
        }
        with DATA_PLANE_ENGINE.begin() as conn:
            conn.execute(
                update(db_visits)
                .where(and_(db_visits.c.site_id == self.site_id, db_visits.c.visit_id == existing_visit_id))
                .values(**values)
            )
            conn.execute(
                update(db_images)
                .where(and_(db_images.c.site_id == self.site_id, db_images.c.visit_id == existing_visit_id))
                .values(
                    patient_id=normalized_target_patient_id,
                    visit_date=normalized_target_visit_date,
                )
            )
        if target_changed:
            source_history_path = self._case_history_path(existing_patient_id, existing_visit_date)
            target_history_path = self._case_history_path(normalized_target_patient_id, normalized_target_visit_date)
            if source_history_path.exists():
                ensure_dir(target_history_path.parent)
                if target_history_path.exists():
                    target_history_path.unlink(missing_ok=True)
                source_history_path.replace(target_history_path)
            elif target_history_path.exists():
                target_history_path.unlink(missing_ok=True)
            if normalized_target_patient_id != existing_patient_id:
                self._delete_patient_if_empty(existing_patient_id)
        refreshed = self._get_visit_by_id(existing_visit_id)
        if refreshed is None:
            raise ValueError(
                f"Visit {normalized_target_patient_id} / {normalized_target_visit_date} does not exist."
            )
        return refreshed

    def list_images(self) -> list[dict[str, Any]]:
        self._sync_raw_inventory_metadata_if_due()
        query = (
            select(db_images)
            .where(db_images.c.site_id == self.site_id)
            .order_by(db_images.c.patient_id, db_images.c.visit_date, db_images.c.uploaded_at)
        )
        with DATA_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(query).mappings().all()
        return [self._resolve_image_record_path(dict(row)) for row in rows]

    def get_image(self, image_id: str) -> dict[str, Any] | None:
        self._sync_raw_inventory_metadata_if_due()
        query = select(db_images).where(and_(db_images.c.site_id == self.site_id, db_images.c.image_id == image_id))
        with DATA_PLANE_ENGINE.begin() as conn:
            row = conn.execute(query).mappings().first()
        return self._resolve_image_record_path(dict(row)) if row else None

    def get_images(self, image_ids: list[str]) -> list[dict[str, Any]]:
        self._sync_raw_inventory_metadata_if_due()
        requested_ids = [str(image_id or "").strip() for image_id in image_ids if str(image_id or "").strip()]
        if not requested_ids:
            return []
        query = select(db_images).where(
            and_(
                db_images.c.site_id == self.site_id,
                db_images.c.image_id.in_(requested_ids),
            )
        )
        with DATA_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(query).mappings().all()
        records_by_id = {
            str(record.get("image_id") or ""): self._resolve_image_record_path(dict(record))
            for record in rows
        }
        return [records_by_id[image_id] for image_id in requested_ids if image_id in records_by_id]

    def add_image(
        self,
        patient_id: str,
        visit_date: str,
        view: str,
        is_representative: bool,
        file_name: str,
        content: bytes,
        created_by_user_id: str | None = None,
    ) -> dict[str, Any]:
        normalized_patient_id = normalize_patient_pseudonym(patient_id)
        normalized_visit_date = normalize_visit_label(visit_date)
        visit = self.get_visit(normalized_patient_id, normalized_visit_date)
        if visit is None:
            raise ValueError("Visit must exist before image upload.")
        visit_dir = ensure_dir(self.raw_dir / normalized_patient_id / normalized_visit_date)
        image_id = make_id("image")
        sanitized_content, normalized_suffix = _sanitize_image_bytes(content, file_name)
        destination = visit_dir / f"{image_id}{normalized_suffix}"
        destination.write_bytes(sanitized_content)
        image_record = {
            "image_id": image_id,
            "visit_id": visit["visit_id"],
            "site_id": self.site_id,
            "patient_id": normalized_patient_id,
            "visit_date": normalized_visit_date,
            "created_by_user_id": created_by_user_id,
            "view": view,
            "image_path": str(destination),
            "is_representative": bool(is_representative),
            "lesion_prompt_box": None,
            "has_lesion_box": False,
            "has_roi_crop": False,
            "has_medsam_mask": False,
            "has_lesion_crop": False,
            "has_lesion_mask": False,
            "quality_scores": None,
            "artifact_status_updated_at": utc_now(),
            "uploaded_at": utc_now(),
        }
        with DATA_PLANE_ENGINE.begin() as conn:
            conn.execute(db_images.insert().values(**image_record))
        return image_record

    def delete_images_for_visit(self, patient_id: str, visit_date: str) -> int:
        existing_visit = self.get_visit(patient_id, visit_date)
        if existing_visit is None:
            return 0
        existing_images = self.list_images_for_visit(
            _coerce_optional_text(existing_visit.get("patient_id")),
            _coerce_optional_text(existing_visit.get("visit_date")),
        )
        for image in existing_images:
            image_id = str(image.get("image_id") or "").strip()
            if image_id:
                self.delete_image_preview_cache(image_id)
            image_path = Path(str(image.get("image_path") or ""))
            if image_path.exists():
                image_path.unlink(missing_ok=True)
        with DATA_PLANE_ENGINE.begin() as conn:
            conn.execute(
                delete(db_images).where(
                    and_(
                        db_images.c.site_id == self.site_id,
                        db_images.c.visit_id == existing_visit["visit_id"],
                    )
                )
            )
        return len(existing_images)

    def delete_visit(self, patient_id: str, visit_date: str) -> dict[str, Any]:
        existing_visit = self.get_visit(patient_id, visit_date)
        if existing_visit is None:
            raise ValueError(f"Visit {patient_id} / {visit_date} does not exist.")

        existing_patient_id = _coerce_optional_text(existing_visit.get("patient_id")) or normalize_patient_pseudonym(patient_id)
        existing_visit_date = _coerce_optional_text(existing_visit.get("visit_date")) or _coerce_optional_text(visit_date)
        deleted_images = self.delete_images_for_visit(existing_patient_id, existing_visit_date)
        history_path = self._case_history_path(existing_patient_id, existing_visit_date)
        history_path.unlink(missing_ok=True)
        with DATA_PLANE_ENGINE.begin() as conn:
            conn.execute(
                delete(db_visits).where(
                    and_(
                        db_visits.c.site_id == self.site_id,
                        db_visits.c.visit_id == existing_visit["visit_id"],
                    )
                )
            )

        remaining_visits = self.list_visits_for_patient(existing_patient_id)
        deleted_patient = self._delete_patient_if_empty(existing_patient_id)

        return {
            "patient_id": existing_patient_id,
            "visit_date": existing_visit_date,
            "deleted_images": deleted_images,
            "deleted_patient": deleted_patient,
            "remaining_visit_count": len(remaining_visits),
        }

    def _delete_patient_if_empty(self, patient_id: str) -> bool:
        remaining_visits = self.list_visits_for_patient(patient_id)
        if remaining_visits:
            return False
        with DATA_PLANE_ENGINE.begin() as conn:
            conn.execute(
                delete(db_patients).where(
                    and_(
                        db_patients.c.site_id == self.site_id,
                        db_patients.c.patient_id == patient_id,
                    )
                )
            )
        patient_history_dir = self.case_history_dir / _safe_path_component(patient_id)
        if patient_history_dir.exists() and not any(patient_history_dir.iterdir()):
            patient_history_dir.rmdir()
        return True

    def update_representative_flags(self, updates: dict[str, bool]) -> None:
        with DATA_PLANE_ENGINE.begin() as conn:
            for image_id, is_representative in updates.items():
                conn.execute(
                    update(db_images)
                    .where(and_(db_images.c.site_id == self.site_id, db_images.c.image_id == image_id))
                    .values(is_representative=bool(is_representative))
                )

    def update_lesion_prompt_box(self, image_id: str, lesion_prompt_box: dict[str, Any] | None) -> dict[str, Any]:
        if self.get_image(image_id) is None:
            raise ValueError("Image not found.")
        has_lesion_box = isinstance(lesion_prompt_box, dict)
        with DATA_PLANE_ENGINE.begin() as conn:
            conn.execute(
                update(db_images)
                .where(and_(db_images.c.site_id == self.site_id, db_images.c.image_id == image_id))
                .values(
                    lesion_prompt_box=lesion_prompt_box,
                    has_lesion_box=has_lesion_box,
                    has_lesion_crop=False,
                    has_lesion_mask=False,
                    artifact_status_updated_at=utc_now(),
                )
            )
        refreshed = self.get_image(image_id)
        if refreshed is None:
            raise ValueError("Image not found.")
        return refreshed

    def update_image_artifact_cache(
        self,
        image_id: str,
        *,
        has_lesion_box: bool | None = None,
        has_roi_crop: bool | None = None,
        has_medsam_mask: bool | None = None,
        has_lesion_crop: bool | None = None,
        has_lesion_mask: bool | None = None,
    ) -> dict[str, Any]:
        if self.get_image(image_id) is None:
            raise ValueError("Image not found.")
        values: dict[str, Any] = {
            "artifact_status_updated_at": utc_now(),
        }
        if has_lesion_box is not None:
            values["has_lesion_box"] = bool(has_lesion_box)
        if has_roi_crop is not None:
            values["has_roi_crop"] = bool(has_roi_crop)
        if has_medsam_mask is not None:
            values["has_medsam_mask"] = bool(has_medsam_mask)
        if has_lesion_crop is not None:
            values["has_lesion_crop"] = bool(has_lesion_crop)
        if has_lesion_mask is not None:
            values["has_lesion_mask"] = bool(has_lesion_mask)
        with DATA_PLANE_ENGINE.begin() as conn:
            conn.execute(
                update(db_images)
                .where(and_(db_images.c.site_id == self.site_id, db_images.c.image_id == image_id))
                .values(**values)
            )
        refreshed = self.get_image(image_id)
        if refreshed is None:
            raise ValueError("Image not found.")
        return refreshed

    def update_image_quality_scores(self, image_id: str, quality_scores: dict[str, Any] | None) -> dict[str, Any]:
        if self.get_image(image_id) is None:
            raise ValueError("Image not found.")
        with DATA_PLANE_ENGINE.begin() as conn:
            conn.execute(
                update(db_images)
                .where(and_(db_images.c.site_id == self.site_id, db_images.c.image_id == image_id))
                .values(quality_scores=quality_scores)
            )
        refreshed = self.get_image(image_id)
        if refreshed is None:
            raise ValueError("Image not found.")
        return refreshed

    def backfill_image_derivatives(
        self,
        image_ids: list[str] | None = None,
        *,
        preview_sides: tuple[int, ...] = _PREWARMED_IMAGE_PREVIEW_SIDES,
    ) -> dict[str, int]:
        if image_ids:
            requested_ids = {str(image_id or "").strip() for image_id in image_ids if str(image_id or "").strip()}
            images = [record for record in self.list_images() if str(record.get("image_id") or "") in requested_ids]
        else:
            images = self.list_images()

        quality_updated = 0
        previews_generated = 0
        for image in images:
            image_id = str(image.get("image_id") or "").strip()
            image_path = str(image.get("image_path") or "").strip()
            if not image_id or not image_path:
                continue
            if image.get("quality_scores") is None:
                try:
                    quality_scores = score_slit_lamp_image(image_path, view=str(image.get("view") or "white"))
                except Exception:
                    quality_scores = None
                self.update_image_quality_scores(image_id, quality_scores)
                quality_updated += 1
            for max_side in preview_sides:
                preview_path = self.image_preview_cache_path(image_id, max_side)
                if preview_path.exists():
                    continue
                try:
                    self.ensure_image_preview(image, max_side)
                except Exception:
                    continue
                previews_generated += 1
        return {
            "quality_updated": quality_updated,
            "previews_generated": previews_generated,
        }

    def dataset_records(self) -> list[dict[str, Any]]:
        patient_table = db_patients.alias("p")
        visit_table = db_visits.alias("v")
        image_table = db_images.alias("i")
        query = (
            select(
                image_table.c.image_id,
                patient_table.c.patient_id,
                patient_table.c.chart_alias,
                patient_table.c.local_case_code,
                patient_table.c.sex,
                patient_table.c.age,
                visit_table.c.visit_date,
                visit_table.c.culture_confirmed,
                visit_table.c.culture_category,
                visit_table.c.culture_species,
                visit_table.c.additional_organisms,
                visit_table.c.contact_lens_use,
                visit_table.c.predisposing_factor,
                visit_table.c.visit_status,
                visit_table.c.active_stage,
                visit_table.c.other_history,
                visit_table.c.smear_result,
                visit_table.c.polymicrobial,
                image_table.c.view,
                image_table.c.image_path,
                image_table.c.is_representative,
                image_table.c.lesion_prompt_box,
            )
            .select_from(
                patient_table.join(
                    visit_table,
                    and_(
                        patient_table.c.site_id == visit_table.c.site_id,
                        patient_table.c.patient_id == visit_table.c.patient_id,
                    ),
                ).join(
                    image_table,
                    and_(
                        visit_table.c.site_id == image_table.c.site_id,
                        visit_table.c.visit_id == image_table.c.visit_id,
                    ),
                )
            )
            .where(and_(patient_table.c.site_id == self.site_id, visit_table.c.culture_confirmed == True))
            .order_by(patient_table.c.patient_id, visit_table.c.visit_index, visit_table.c.visit_date, image_table.c.uploaded_at)
        )
        with DATA_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(query).mappings().all()
        records: list[dict[str, Any]] = []
        for row in rows:
            resolved_image_record = self._resolve_image_record_path(
                {
                    "image_id": row["image_id"],
                    "patient_id": row["patient_id"],
                    "visit_date": row["visit_date"],
                    "image_path": row["image_path"],
                }
            )
            resolved_image_path = Path(str(resolved_image_record["image_path"]))
            records.append(
                {
                    "site_id": self.site_id,
                    "patient_id": row["patient_id"],
                    "chart_alias": row["chart_alias"],
                    "local_case_code": row["local_case_code"],
                    "sex": row["sex"],
                    "age": row["age"],
                    "visit_date": row["visit_date"],
                    "culture_confirmed": row["culture_confirmed"],
                    "culture_category": row["culture_category"],
                    "culture_species": row["culture_species"],
                    "additional_organisms": row["additional_organisms"] or [],
                    "contact_lens_use": row["contact_lens_use"],
                    "predisposing_factor": "|".join(row["predisposing_factor"] or []),
                    "visit_status": row["visit_status"],
                    "active_stage": row["active_stage"],
                    "other_history": row["other_history"] or "",
                    "smear_result": row["smear_result"] or "",
                    "polymicrobial": row["polymicrobial"],
                    "view": row["view"],
                    "image_path": str(resolved_image_path),
                    "is_representative": row["is_representative"],
                    "lesion_prompt_box": row["lesion_prompt_box"],
                }
            )
        return records

    def list_visits_for_patient(self, patient_id: str) -> list[dict[str, Any]]:
        query = (
            select(db_visits)
            .where(and_(db_visits.c.site_id == self.site_id, db_visits.c.patient_id == patient_id))
            .order_by(db_visits.c.visit_index, db_visits.c.visit_date)
        )
        with DATA_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(query).mappings().all()
        return [dict(row) for row in rows]

    def list_images_for_visit(self, patient_id: str, visit_date: str) -> list[dict[str, Any]]:
        self._sync_raw_inventory_metadata_if_due()
        existing_visit = self.get_visit(patient_id, visit_date)
        if existing_visit is None:
            return []
        query = (
            select(db_images)
            .where(
                and_(
                    db_images.c.site_id == self.site_id,
                    db_images.c.visit_id == existing_visit["visit_id"],
                )
            )
            .order_by(db_images.c.uploaded_at)
        )
        with DATA_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(query).mappings().all()
        return [self._resolve_image_record_path(dict(row)) for row in rows]

    def list_images_for_patient(self, patient_id: str) -> list[dict[str, Any]]:
        self._sync_raw_inventory_metadata_if_due()
        query = (
            select(db_images)
            .where(
                and_(
                    db_images.c.site_id == self.site_id,
                    db_images.c.patient_id == patient_id,
                )
            )
            .order_by(db_images.c.uploaded_at)
        )
        with DATA_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(query).mappings().all()
        return [self._resolve_image_record_path(dict(row)) for row in rows]

    def _raw_inventory_index(self) -> dict[str, Any]:
        if not self.raw_dir.exists():
            return {
                "patient_ids": set(),
                "visit_keys": set(),
                "n_images": 0,
            }

        patient_ids: set[str] = set()
        visit_keys: set[tuple[str, str]] = set()
        image_count = 0
        raw_root = self.raw_dir.resolve()

        for image_path in raw_root.rglob("*"):
            if not image_path.is_file() or image_path.suffix.lower() not in _RAW_INVENTORY_IMAGE_EXTENSIONS:
                continue
            try:
                relative_parts = image_path.resolve().relative_to(raw_root).parts
            except ValueError:
                continue
            if len(relative_parts) < 2:
                continue
            patient_id = str(relative_parts[0] or "").strip()
            if not patient_id:
                continue
            patient_ids.add(patient_id)
            if len(relative_parts) >= 3:
                visit_label = str(relative_parts[1] or "").strip()
                if visit_label:
                    visit_keys.add((patient_id, visit_label))
            image_count += 1

        return {"patient_ids": patient_ids, "visit_keys": visit_keys, "n_images": int(image_count)}

    def _storage_bundle_root(self) -> Path:
        site_parent = self.site_dir.parent.resolve()
        if site_parent.name.strip().lower() == "sites":
            return site_parent.parent.resolve()
        return site_parent

    def _current_data_plane_db_path(self) -> Path | None:
        return _sqlite_path_from_url(DATA_PLANE_DATABASE_URL)

    def _local_metadata_backup_db_paths(self) -> list[Path]:
        bundle_root = self._storage_bundle_root()
        if not bundle_root.exists():
            return []
        current_db_path = self._current_data_plane_db_path()
        candidates: list[Path] = []
        for path in sorted(bundle_root.glob("kera*.db"), key=lambda item: item.stat().st_mtime, reverse=True):
            resolved_path = path.resolve()
            if current_db_path is not None and resolved_path == current_db_path:
                continue
            if not resolved_path.is_file():
                continue
            candidates.append(resolved_path)
        return candidates

    def _load_patient_metadata_snapshot_from_db(
        self,
        db_path: Path,
        patient_id: str,
    ) -> dict[str, Any] | None:
        if not db_path.exists():
            return None
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        try:
            try:
                patient_row = conn.execute(
                    "select * from patients where site_id=? and patient_id=?",
                    (self.site_id, patient_id),
                ).fetchone()
            except sqlite3.OperationalError:
                return None
            if patient_row is None:
                return None
            visit_rows = conn.execute(
                "select * from visits where site_id=? and patient_id=? order by visit_index, visit_date, created_at",
                (self.site_id, patient_id),
            ).fetchall()
            image_rows = conn.execute(
                "select * from images where site_id=? and patient_id=? order by uploaded_at, image_path",
                (self.site_id, patient_id),
            ).fetchall()
            if not visit_rows or not image_rows:
                return None
            return {
                "patient": dict(patient_row),
                "visits": [dict(row) for row in visit_rows],
                "images": [dict(row) for row in image_rows],
            }
        finally:
            conn.close()

    def _patient_snapshot_is_richer_than_placeholder(self, snapshot: dict[str, Any] | None) -> bool:
        if not snapshot:
            return False
        patient_row = snapshot.get("patient", {}) or {}
        sex_value = str(patient_row.get("sex") or "").strip().lower()
        age_value = _coerce_optional_int(patient_row.get("age"), 0)
        if sex_value and sex_value != "unknown":
            return True
        if age_value > 0:
            return True
        for visit_row in snapshot.get("visits", []) or []:
            if bool(visit_row.get("culture_confirmed")):
                return True
            if str(visit_row.get("research_registry_source") or "").strip().lower() != _PLACEHOLDER_SYNC_SOURCE:
                return True
        return False

    def _normalize_snapshot_image_paths(self, rows: list[dict[str, Any]]) -> set[str]:
        normalized_paths: set[str] = set()
        for row in rows:
            resolved_path, _ = self._resolve_site_runtime_path(row.get("image_path"), require_exists=False)
            normalized_paths.add(str(resolved_path.resolve()))
        return normalized_paths

    def _find_matching_richer_metadata_snapshot(
        self,
        patient_id: str,
        expected_image_paths: set[str],
    ) -> dict[str, Any] | None:
        if not expected_image_paths:
            return None
        for db_path in self._local_metadata_backup_db_paths():
            snapshot = self._load_patient_metadata_snapshot_from_db(db_path, patient_id)
            if not self._patient_snapshot_is_richer_than_placeholder(snapshot):
                continue
            snapshot_image_paths = self._normalize_snapshot_image_paths(snapshot.get("images", []) or [])
            if snapshot_image_paths != expected_image_paths:
                continue
            return snapshot
        return None

    def _restore_placeholder_metadata_from_snapshot(self, snapshot: dict[str, Any]) -> dict[str, int]:
        patient_row = snapshot.get("patient", {}) or {}
        patient_id = _coerce_optional_text(patient_row.get("patient_id"))
        if not patient_id:
            return {"patients": 0, "visits": 0, "images": 0}

        restored = {"patients": 0, "visits": 0, "images": 0}
        with DATA_PLANE_ENGINE.begin() as conn:
            patient_update = conn.execute(
                update(db_patients)
                .where(and_(db_patients.c.site_id == self.site_id, db_patients.c.patient_id == patient_id))
                .values(
                    sex=patient_row.get("sex"),
                    age=patient_row.get("age"),
                    chart_alias=patient_row.get("chart_alias"),
                    local_case_code=patient_row.get("local_case_code"),
                    created_at=patient_row.get("created_at"),
                    created_by_user_id=patient_row.get("created_by_user_id"),
                )
            )
            restored["patients"] += int(patient_update.rowcount or 0)

            for visit_row in snapshot.get("visits", []) or []:
                visit_update = conn.execute(
                    update(db_visits)
                    .where(
                        and_(
                            db_visits.c.site_id == self.site_id,
                            db_visits.c.patient_id == patient_id,
                            db_visits.c.visit_date == _coerce_optional_text(visit_row.get("visit_date")),
                        )
                    )
                    .values(
                        culture_confirmed=visit_row.get("culture_confirmed"),
                        culture_category=visit_row.get("culture_category"),
                        culture_species=visit_row.get("culture_species"),
                        contact_lens_use=visit_row.get("contact_lens_use"),
                        predisposing_factor=visit_row.get("predisposing_factor"),
                        other_history=visit_row.get("other_history"),
                        visit_status=visit_row.get("visit_status"),
                        active_stage=visit_row.get("active_stage"),
                        smear_result=visit_row.get("smear_result"),
                        polymicrobial=visit_row.get("polymicrobial"),
                        created_at=visit_row.get("created_at"),
                        is_initial_visit=visit_row.get("is_initial_visit"),
                        additional_organisms=visit_row.get("additional_organisms"),
                        created_by_user_id=visit_row.get("created_by_user_id"),
                        actual_visit_date=visit_row.get("actual_visit_date"),
                        research_registry_status=visit_row.get("research_registry_status"),
                        research_registry_updated_at=visit_row.get("research_registry_updated_at"),
                        research_registry_updated_by=visit_row.get("research_registry_updated_by"),
                        research_registry_source=visit_row.get("research_registry_source"),
                        patient_reference_id=visit_row.get("patient_reference_id"),
                        visit_index=visit_row.get("visit_index"),
                    )
                )
                restored["visits"] += int(visit_update.rowcount or 0)

            for image_row in snapshot.get("images", []) or []:
                resolved_path, _ = self._resolve_site_runtime_path(image_row.get("image_path"), require_exists=False)
                image_update = conn.execute(
                    update(db_images)
                    .where(
                        and_(
                            db_images.c.site_id == self.site_id,
                            db_images.c.patient_id == patient_id,
                            db_images.c.visit_date == _coerce_optional_text(image_row.get("visit_date")),
                            db_images.c.image_path == str(resolved_path.resolve()),
                        )
                    )
                    .values(
                        view=image_row.get("view"),
                        is_representative=image_row.get("is_representative"),
                        uploaded_at=image_row.get("uploaded_at"),
                        lesion_prompt_box=image_row.get("lesion_prompt_box"),
                        created_by_user_id=image_row.get("created_by_user_id"),
                        has_lesion_box=image_row.get("has_lesion_box"),
                        has_roi_crop=image_row.get("has_roi_crop"),
                        has_medsam_mask=image_row.get("has_medsam_mask"),
                        has_lesion_crop=image_row.get("has_lesion_crop"),
                        has_lesion_mask=image_row.get("has_lesion_mask"),
                        artifact_status_updated_at=image_row.get("artifact_status_updated_at"),
                        quality_scores=image_row.get("quality_scores"),
                    )
                )
                restored["images"] += int(image_update.rowcount or 0)
        return restored

    def _restore_placeholder_metadata_from_local_backups(self) -> dict[str, int]:
        restored = {"patients": 0, "visits": 0, "images": 0}
        candidate_query = (
            select(db_patients.c.patient_id)
            .join(
                db_visits,
                and_(
                    db_patients.c.site_id == db_visits.c.site_id,
                    db_patients.c.patient_id == db_visits.c.patient_id,
                ),
            )
            .where(
                and_(
                    db_patients.c.site_id == self.site_id,
                    db_patients.c.sex == "unknown",
                    db_patients.c.age == 0,
                    db_visits.c.culture_confirmed == False,
                    db_visits.c.research_registry_source == _PLACEHOLDER_SYNC_SOURCE,
                )
            )
            .group_by(db_patients.c.patient_id)
        )
        with DATA_PLANE_ENGINE.begin() as conn:
            candidate_patient_ids = [
                _coerce_optional_text(row[0])
                for row in conn.execute(candidate_query).all()
                if _coerce_optional_text(row[0])
            ]
        for patient_id in candidate_patient_ids:
            with DATA_PLANE_ENGINE.begin() as conn:
                visit_rows = conn.execute(
                    select(
                        db_visits.c.culture_confirmed,
                        db_visits.c.research_registry_source,
                    ).where(and_(db_visits.c.site_id == self.site_id, db_visits.c.patient_id == patient_id))
                ).mappings().all()
                image_rows = conn.execute(
                    select(db_images.c.image_path).where(and_(db_images.c.site_id == self.site_id, db_images.c.patient_id == patient_id))
                ).mappings().all()
            if not visit_rows:
                continue
            if any(bool(visit.get("culture_confirmed")) for visit in visit_rows):
                continue
            if any(
                str(visit.get("research_registry_source") or "").strip().lower() != _PLACEHOLDER_SYNC_SOURCE
                for visit in visit_rows
            ):
                continue
            expected_image_paths = {
                str(self._resolve_site_runtime_path(row.get("image_path"), require_exists=False)[0].resolve())
                for row in image_rows
            }
            snapshot = self._find_matching_richer_metadata_snapshot(patient_id, expected_image_paths)
            if snapshot is None:
                continue
            result = self._restore_placeholder_metadata_from_snapshot(snapshot)
            restored["patients"] += result["patients"]
            restored["visits"] += result["visits"]
            restored["images"] += result["images"]
        return restored

    def sync_raw_inventory_metadata(self) -> dict[str, Any]:
        self._repair_missing_image_paths_if_due(force=True)
        restored_from_backup = self._restore_placeholder_metadata_from_local_backups()
        if not self.raw_dir.exists():
            return {
                "site_id": self.site_id,
                "scanned_patients": 0,
                "scanned_visits": 0,
                "scanned_images": 0,
                "created_patients": 0,
                "created_visits": 0,
                "created_images": 0,
                "skipped_existing_images": 0,
                "skipped_invalid_patients": 0,
                "skipped_invalid_visits": 0,
                "restored_patients": restored_from_backup["patients"],
                "restored_visits": restored_from_backup["visits"],
                "restored_images": restored_from_backup["images"],
            }

        patient_records: list[dict[str, Any]] = []
        visit_records: list[dict[str, Any]] = []
        image_records: list[dict[str, Any]] = []
        scanned_patients = 0
        scanned_visits = 0
        scanned_images = 0
        skipped_existing_images = 0
        skipped_invalid_patients = 0
        skipped_invalid_visits = 0

        with DATA_PLANE_ENGINE.begin() as conn:
            existing_patient_ids = {
                str(row[0] or "").strip()
                for row in conn.execute(select(db_patients.c.patient_id).where(db_patients.c.site_id == self.site_id)).all()
                if str(row[0] or "").strip()
            }
            existing_visits_by_key: dict[tuple[str, str], dict[str, Any]] = {}
            for row in conn.execute(
                select(db_visits.c.visit_id, db_visits.c.patient_id, db_visits.c.visit_date).where(
                    db_visits.c.site_id == self.site_id
                )
            ).mappings():
                patient_id = str(row["patient_id"] or "").strip()
                visit_date = str(row["visit_date"] or "").strip()
                if not patient_id or not visit_date:
                    continue
                existing_visits_by_key[(patient_id, visit_date)] = {
                    "visit_id": str(row["visit_id"] or "").strip(),
                    "has_representative": False,
                }

            existing_image_paths: set[str] = set()
            existing_image_keys: set[tuple[str, str, str]] = set()
            representative_visit_ids: set[str] = set()
            for row in conn.execute(
                select(
                    db_images.c.visit_id,
                    db_images.c.patient_id,
                    db_images.c.visit_date,
                    db_images.c.image_path,
                    db_images.c.is_representative,
                ).where(db_images.c.site_id == self.site_id)
            ).mappings():
                patient_id = str(row["patient_id"] or "").strip()
                visit_date = str(row["visit_date"] or "").strip()
                resolved_path, _ = self._resolve_site_runtime_path(row["image_path"], require_exists=False)
                resolved_path = resolved_path.resolve()
                existing_image_paths.add(str(resolved_path))
                existing_image_keys.add((patient_id, visit_date, resolved_path.name.lower()))
                if bool(row.get("is_representative")):
                    representative_visit_ids.add(str(row["visit_id"] or "").strip())
            for visit_state in existing_visits_by_key.values():
                visit_state["has_representative"] = str(visit_state.get("visit_id") or "").strip() in representative_visit_ids

        scan_timestamp = utc_now()
        for patient_dir in sorted((path for path in self.raw_dir.iterdir() if path.is_dir()), key=lambda path: path.name.lower()):
            raw_patient_id = str(patient_dir.name or "").strip()
            if not raw_patient_id:
                continue
            try:
                normalized_patient_id = normalize_patient_pseudonym(raw_patient_id)
            except ValueError:
                skipped_invalid_patients += 1
                continue
            scanned_patients += 1
            patient_visit_images: dict[str, list[Path]] = {}
            for visit_dir in sorted((path for path in patient_dir.iterdir() if path.is_dir()), key=lambda path: path.name.lower()):
                raw_visit_label = str(visit_dir.name or "").strip()
                if not raw_visit_label:
                    continue
                try:
                    normalized_visit_date = normalize_visit_label(raw_visit_label)
                except ValueError:
                    continue
                visit_images = sorted(
                    (
                        image_path
                        for image_path in visit_dir.rglob("*")
                        if image_path.is_file() and image_path.suffix.lower() in _RAW_INVENTORY_IMAGE_EXTENSIONS
                    ),
                    key=lambda path: (str(path.parent).lower(), path.name.lower()),
                )
                if visit_images:
                    patient_visit_images[normalized_visit_date] = visit_images

            if normalized_patient_id not in existing_patient_ids:
                expected_image_paths = {
                    str(image_path.resolve())
                    for visit_images in patient_visit_images.values()
                    for image_path in visit_images
                }
                richer_snapshot = self._find_matching_richer_metadata_snapshot(
                    normalized_patient_id,
                    expected_image_paths,
                )
                if richer_snapshot is not None:
                    patient_row = dict(richer_snapshot["patient"])
                    patient_records.append(patient_row)
                    existing_patient_ids.add(normalized_patient_id)
                    for visit_row in richer_snapshot["visits"]:
                        visit_records.append(dict(visit_row))
                        visit_key = (
                            _coerce_optional_text(visit_row.get("patient_id")),
                            _coerce_optional_text(visit_row.get("visit_date")),
                        )
                        existing_visits_by_key[visit_key] = {
                            "visit_id": _coerce_optional_text(visit_row.get("visit_id")),
                            "has_representative": False,
                        }
                    for image_row in richer_snapshot["images"]:
                        normalized_image_row = dict(image_row)
                        resolved_image_path, _ = self._resolve_site_runtime_path(
                            normalized_image_row.get("image_path"),
                            require_exists=False,
                        )
                        normalized_image_row["image_path"] = str(resolved_image_path.resolve())
                        image_records.append(normalized_image_row)
                        existing_image_paths.add(normalized_image_row["image_path"])
                        existing_image_keys.add(
                            (
                                _coerce_optional_text(normalized_image_row.get("patient_id")),
                                _coerce_optional_text(normalized_image_row.get("visit_date")),
                                Path(normalized_image_row["image_path"]).name.lower(),
                            )
                        )
                        if bool(normalized_image_row.get("is_representative")):
                            visit_id = _coerce_optional_text(normalized_image_row.get("visit_id"))
                            if visit_id:
                                representative_visit_ids.add(visit_id)
                    for visit_state in existing_visits_by_key.values():
                        visit_state["has_representative"] = (
                            _coerce_optional_text(visit_state.get("visit_id")) in representative_visit_ids
                        )
                    continue

                if not patient_visit_images:
                    continue

                patient_records.append(
                    {
                        "site_id": self.site_id,
                        "patient_id": normalized_patient_id,
                        "created_by_user_id": None,
                        "sex": "unknown",
                        "age": 0,
                        "chart_alias": "",
                        "local_case_code": "",
                        "created_at": _filesystem_timestamp_to_utc(patient_dir.stat().st_mtime if patient_dir.exists() else None),
                    }
                )
                existing_patient_ids.add(normalized_patient_id)

            for visit_dir in sorted((path for path in patient_dir.iterdir() if path.is_dir()), key=lambda path: path.name.lower()):
                raw_visit_label = str(visit_dir.name or "").strip()
                if not raw_visit_label:
                    continue
                try:
                    normalized_visit_date = normalize_visit_label(raw_visit_label)
                except ValueError:
                    skipped_invalid_visits += 1
                    continue
                visit_images = sorted(
                    (
                        image_path
                        for image_path in visit_dir.rglob("*")
                        if image_path.is_file() and image_path.suffix.lower() in _RAW_INVENTORY_IMAGE_EXTENSIONS
                    ),
                    key=lambda path: (str(path.parent).lower(), path.name.lower()),
                )
                if not visit_images:
                    continue
                scanned_visits += 1
                visit_key = (normalized_patient_id, normalized_visit_date)
                visit_state = existing_visits_by_key.get(visit_key)
                if visit_state is None:
                    visit_id = make_id("visit")
                    visit_records.append(
                        {
                            "visit_id": visit_id,
                            "site_id": self.site_id,
                            "patient_id": normalized_patient_id,
                            "patient_reference_id": make_patient_reference_id(
                                self.site_id,
                                normalized_patient_id,
                                PATIENT_REFERENCE_SALT,
                            ),
                            "created_by_user_id": None,
                            "visit_date": normalized_visit_date,
                            "visit_index": visit_index_from_label(normalized_visit_date),
                            "actual_visit_date": None,
                            "culture_confirmed": False,
                            "culture_category": "",
                            "culture_species": "",
                            "contact_lens_use": "unknown",
                            "predisposing_factor": [],
                            "additional_organisms": [],
                            "other_history": "",
                            "visit_status": "active",
                            "active_stage": True,
                            "is_initial_visit": normalized_visit_date == "Initial",
                            "smear_result": "",
                            "polymicrobial": False,
                            "research_registry_status": "analysis_only",
                            "research_registry_updated_at": scan_timestamp,
                            "research_registry_updated_by": None,
                            "research_registry_source": "raw_inventory_sync",
                            "created_at": _filesystem_timestamp_to_utc(visit_dir.stat().st_mtime if visit_dir.exists() else None),
                        }
                    )
                    visit_state = {"visit_id": visit_id, "has_representative": False}
                    existing_visits_by_key[visit_key] = visit_state

                for image_path in visit_images:
                    scanned_images += 1
                    resolved_image_path = image_path.resolve()
                    image_key = (normalized_patient_id, normalized_visit_date, resolved_image_path.name.lower())
                    if str(resolved_image_path) in existing_image_paths or image_key in existing_image_keys:
                        skipped_existing_images += 1
                        continue
                    inferred_view = _infer_raw_image_view(resolved_image_path)
                    try:
                        quality_scores = score_slit_lamp_image(str(resolved_image_path), view=inferred_view)
                    except Exception:
                        quality_scores = None
                    uploaded_at = _filesystem_timestamp_to_utc(
                        resolved_image_path.stat().st_mtime if resolved_image_path.exists() else None
                    )
                    is_representative = not bool(visit_state.get("has_representative"))
                    image_records.append(
                        {
                            "image_id": make_id("image"),
                            "visit_id": str(visit_state.get("visit_id") or "").strip(),
                            "site_id": self.site_id,
                            "patient_id": normalized_patient_id,
                            "visit_date": normalized_visit_date,
                            "created_by_user_id": None,
                            "view": inferred_view,
                            "image_path": str(resolved_image_path),
                            "is_representative": is_representative,
                            "lesion_prompt_box": None,
                            "has_lesion_box": False,
                            "has_roi_crop": False,
                            "has_medsam_mask": False,
                            "has_lesion_crop": False,
                            "has_lesion_mask": False,
                            "quality_scores": quality_scores,
                            "artifact_status_updated_at": uploaded_at,
                            "uploaded_at": uploaded_at,
                        }
                    )
                    existing_image_paths.add(str(resolved_image_path))
                    existing_image_keys.add(image_key)
                    if is_representative:
                        visit_state["has_representative"] = True

        if patient_records or visit_records or image_records:
            with DATA_PLANE_ENGINE.begin() as conn:
                if patient_records:
                    conn.execute(db_patients.insert().values(patient_records))
                if visit_records:
                    conn.execute(db_visits.insert().values(visit_records))
                if image_records:
                    conn.execute(db_images.insert().values(image_records))

        return {
            "site_id": self.site_id,
            "scanned_patients": scanned_patients,
            "scanned_visits": scanned_visits,
            "scanned_images": scanned_images,
            "created_patients": len(patient_records),
            "created_visits": len(visit_records),
            "created_images": len(image_records),
            "skipped_existing_images": skipped_existing_images,
            "skipped_invalid_patients": skipped_invalid_patients,
            "skipped_invalid_visits": skipped_invalid_visits,
            "restored_patients": restored_from_backup["patients"],
            "restored_visits": restored_from_backup["visits"],
            "restored_images": restored_from_backup["images"],
        }

    def _sync_raw_inventory_metadata_if_due(self, *, force: bool = False) -> dict[str, Any]:
        now = time.monotonic()
        with _SITE_RAW_METADATA_SYNC_LOCK:
            last_run = _SITE_RAW_METADATA_SYNC_LAST_RUN.get(self.site_id)
            if not force and last_run is not None and (now - last_run) < _SITE_RAW_METADATA_SYNC_INTERVAL_SECONDS:
                return {
                    "site_id": self.site_id,
                    "scanned_patients": 0,
                    "scanned_visits": 0,
                    "scanned_images": 0,
                    "created_patients": 0,
                    "created_visits": 0,
                    "created_images": 0,
                    "skipped_existing_images": 0,
                    "skipped_invalid_patients": 0,
                    "skipped_invalid_visits": 0,
                    "restored_patients": 0,
                    "restored_visits": 0,
                    "restored_images": 0,
                }
            _SITE_RAW_METADATA_SYNC_LAST_RUN[self.site_id] = now
        return self.sync_raw_inventory_metadata()

    def raw_inventory_stats(self) -> dict[str, int]:
        inventory = self._raw_inventory_index()
        return {
            "n_patients": len(inventory["patient_ids"]),
            "n_visits": len(inventory["visit_keys"]),
            "n_images": int(inventory["n_images"]),
        }

    def site_summary_stats(self) -> dict[str, int]:
        self._repair_missing_image_paths_if_due(force=True)
        self._sync_raw_inventory_metadata_if_due()
        normalized_culture_category = func.lower(func.trim(func.coalesce(db_visits.c.culture_category, "")))
        patient_count_query = (
            select(func.count())
            .select_from(db_patients)
            .where(db_patients.c.site_id == self.site_id)
        )
        patient_ids_query = select(db_patients.c.patient_id).where(db_patients.c.site_id == self.site_id)
        image_count_query = (
            select(func.count())
            .select_from(db_images)
            .where(db_images.c.site_id == self.site_id)
        )
        visit_keys_query = select(db_visits.c.patient_id, db_visits.c.visit_date).where(db_visits.c.site_id == self.site_id)
        visit_summary_query = (
            select(
                func.count(db_visits.c.visit_id).label("n_visits"),
                func.sum(
                    case(
                        (
                            or_(
                                db_visits.c.visit_status == "active",
                                and_(
                                    db_visits.c.visit_status.is_(None),
                                    db_visits.c.active_stage == True,
                                ),
                            ),
                            1,
                        ),
                        else_=0,
                    )
                ).label("n_active_visits"),
                func.sum(
                    case(
                        (db_visits.c.research_registry_status == "included", 1),
                        else_=0,
                    )
                ).label("n_included_visits"),
                func.sum(
                    case(
                        (db_visits.c.research_registry_status == "excluded", 1),
                        else_=0,
                    )
                ).label("n_excluded_visits"),
                func.sum(
                    case(
                        (
                            and_(
                                normalized_culture_category == "fungal",
                                or_(
                                    db_visits.c.culture_confirmed == True,
                                    db_visits.c.research_registry_source != _PLACEHOLDER_SYNC_SOURCE,
                                ),
                            ),
                            1,
                        ),
                        else_=0,
                    )
                ).label("n_fungal_visits"),
                func.sum(
                    case(
                        (
                            and_(
                                normalized_culture_category == "bacterial",
                                or_(
                                    db_visits.c.culture_confirmed == True,
                                    db_visits.c.research_registry_source != _PLACEHOLDER_SYNC_SOURCE,
                                ),
                            ),
                            1,
                        ),
                        else_=0,
                    )
                ).label("n_bacterial_visits"),
            )
            .where(db_visits.c.site_id == self.site_id)
        )

        with DATA_PLANE_ENGINE.begin() as conn:
            patient_count = conn.execute(patient_count_query).scalar() or 0
            indexed_patient_ids = {
                str(row[0] or "").strip()
                for row in conn.execute(patient_ids_query).all()
                if str(row[0] or "").strip()
            }
            image_count = conn.execute(image_count_query).scalar() or 0
            indexed_visit_keys = {
                (str(row[0] or "").strip(), str(row[1] or "").strip())
                for row in conn.execute(visit_keys_query).all()
                if str(row[0] or "").strip() and str(row[1] or "").strip()
            }
            visit_summary = conn.execute(visit_summary_query).mappings().first() or {}

        raw_inventory = self._raw_inventory_index()
        indexed_patient_ids.update(raw_inventory["patient_ids"])
        indexed_visit_keys.update(raw_inventory["visit_keys"])
        return {
            "n_patients": len(indexed_patient_ids) or int(patient_count or 0),
            "n_visits": len(indexed_visit_keys) or int(visit_summary.get("n_visits") or 0),
            "n_images": max(int(image_count or 0), int(raw_inventory["n_images"] or 0)),
            "n_active_visits": int(visit_summary.get("n_active_visits") or 0),
            "n_included_visits": int(visit_summary.get("n_included_visits") or 0),
            "n_excluded_visits": int(visit_summary.get("n_excluded_visits") or 0),
            "n_fungal_visits": int(visit_summary.get("n_fungal_visits") or 0),
            "n_bacterial_visits": int(visit_summary.get("n_bacterial_visits") or 0),
        }

    def image_preview_cache_path(self, image_id: str, max_side: int) -> Path:
        normalized_max_side = min(max(int(max_side or 512), 96), 1024)
        preview_dir = ensure_dir(self.image_preview_dir / str(normalized_max_side))
        return preview_dir / f"{image_id}.jpg"

    def delete_image_preview_cache(self, image_id: str) -> int:
        normalized_image_id = str(image_id or "").strip()
        if not normalized_image_id:
            return 0
        deleted_count = 0
        for preview_path in self.image_preview_dir.glob(f"*/{normalized_image_id}.jpg"):
            preview_path.unlink(missing_ok=True)
            deleted_count += 1
        return deleted_count

    def ensure_image_preview(self, image: dict[str, Any], max_side: int) -> Path:
        image_id = str(image.get("image_id") or "").strip()
        if not image_id:
            raise ValueError("Image id is required.")
        normalized_max_side = min(max(int(max_side or 512), 96), 1024)
        preview_path = self.image_preview_cache_path(image_id, normalized_max_side)
        # Uploaded source images are immutable in this workspace, so a cached preview
        # can be served immediately without re-touching the original OneDrive file.
        if preview_path.exists():
            return preview_path

        image_path = Path(str(image.get("image_path") or "")).resolve()
        if not image_path.exists():
            raise ValueError("Image file not found on disk.")

        temp_path = preview_path.with_suffix(
            f".{os.getpid()}.{threading.get_ident()}.tmp"
        )
        resampling = getattr(Image, "Resampling", Image)

        try:
            with Image.open(image_path) as handle:
                normalized = ImageOps.exif_transpose(handle)
                preview = normalized.copy()
                preview.thumbnail((normalized_max_side, normalized_max_side), resampling.LANCZOS)
                if preview.mode not in {"RGB", "L"}:
                    preview = preview.convert("RGB")
                preview.save(temp_path, format="JPEG", quality=82, optimize=True)
            temp_path.replace(preview_path)
        except (OSError, UnidentifiedImageError, ValueError):
            temp_path.unlink(missing_ok=True)
            raise

        return preview_path

    def list_case_summaries(
        self,
        created_by_user_id: str | None = None,
        patient_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """Optimized case summaries using a single JOIN query."""
        patient_table = db_patients.alias("p")
        visit_table = db_visits.alias("v")
        image_table = db_images.alias("i")
        normalized_patient_id = (
            normalize_patient_pseudonym(patient_id)
            if str(patient_id or "").strip()
            else None
        )

        # Subquery for image aggregates per visit
        image_stats = (
            select(
                image_table.c.visit_id,
                func.count(image_table.c.image_id).label("image_count"),
                func.max(image_table.c.uploaded_at).label("latest_image_uploaded_at"),
            )
            .where(image_table.c.site_id == self.site_id)
            .group_by(image_table.c.visit_id)
            .subquery("image_stats")
        )

        # Subquery for representative image per visit
        representative_images = (
            select(
                image_table.c.visit_id,
                image_table.c.image_id.label("representative_image_id"),
                image_table.c.view.label("representative_view"),
            )
            .where(
                and_(
                    image_table.c.site_id == self.site_id,
                    image_table.c.is_representative == True,
                )
            )
            .subquery("representative_images")
        )

        # Main query with LEFT JOINs
        query = (
            select(
                visit_table.c.visit_id,
                visit_table.c.patient_id,
                visit_table.c.patient_reference_id,
                visit_table.c.visit_date,
                visit_table.c.visit_index,
                visit_table.c.actual_visit_date,
                visit_table.c.culture_category,
                visit_table.c.culture_species,
                visit_table.c.additional_organisms,
                visit_table.c.contact_lens_use,
                visit_table.c.predisposing_factor,
                visit_table.c.other_history,
                visit_table.c.visit_status,
                visit_table.c.active_stage,
                visit_table.c.is_initial_visit,
                visit_table.c.smear_result,
                visit_table.c.polymicrobial,
                visit_table.c.research_registry_status,
                visit_table.c.research_registry_updated_at,
                visit_table.c.research_registry_updated_by,
                visit_table.c.research_registry_source,
                visit_table.c.created_at,
                patient_table.c.chart_alias,
                patient_table.c.local_case_code,
                patient_table.c.sex,
                patient_table.c.age,
                patient_table.c.created_by_user_id,
                func.coalesce(image_stats.c.image_count, 0).label("image_count"),
                image_stats.c.latest_image_uploaded_at,
                representative_images.c.representative_image_id,
                representative_images.c.representative_view,
            )
            .select_from(
                visit_table
                .join(
                    patient_table,
                    and_(
                        visit_table.c.site_id == patient_table.c.site_id,
                        visit_table.c.patient_id == patient_table.c.patient_id,
                    ),
                )
                .outerjoin(image_stats, visit_table.c.visit_id == image_stats.c.visit_id)
                .outerjoin(representative_images, visit_table.c.visit_id == representative_images.c.visit_id)
            )
            .where(and_(visit_table.c.site_id == self.site_id, visit_table.c.culture_confirmed == True))
            .order_by(
                desc(visit_table.c.visit_index),
                desc(image_stats.c.latest_image_uploaded_at),
                desc(visit_table.c.created_at),
            )
        )

        if created_by_user_id:
            query = query.where(patient_table.c.created_by_user_id == created_by_user_id)
        if normalized_patient_id:
            query = query.where(visit_table.c.patient_id == normalized_patient_id)

        with DATA_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(query).mappings().all()

        return [
            {
                "case_id": f"{row['patient_id']}::{row['visit_date']}",
                "visit_id": row["visit_id"],
                "patient_id": row["patient_id"],
                "patient_reference_id": row["patient_reference_id"],
                "visit_date": row["visit_date"],
                "visit_index": row["visit_index"],
                "actual_visit_date": row["actual_visit_date"],
                "chart_alias": row["chart_alias"] or "",
                "local_case_code": row["local_case_code"] or "",
                "sex": row["sex"] or "",
                "age": row["age"],
                "culture_category": row["culture_category"] or "",
                "culture_species": row["culture_species"] or "",
                "additional_organisms": row["additional_organisms"] or [],
                "contact_lens_use": row["contact_lens_use"] or "",
                "predisposing_factor": row["predisposing_factor"] or [],
                "other_history": row["other_history"] or "",
                "visit_status": row["visit_status"] or "active",
                "active_stage": bool(row["active_stage"]) if row["active_stage"] is not None else (row["visit_status"] == "active"),
                "is_initial_visit": bool(row["is_initial_visit"]),
                "smear_result": row["smear_result"] or "",
                "polymicrobial": bool(row["polymicrobial"] or row["additional_organisms"]),
                "research_registry_status": row["research_registry_status"] or "analysis_only",
                "research_registry_updated_at": row["research_registry_updated_at"],
                "research_registry_updated_by": row["research_registry_updated_by"],
                "research_registry_source": row["research_registry_source"],
                "image_count": int(row["image_count"] or 0),
                "representative_image_id": row["representative_image_id"],
                "representative_view": row["representative_view"],
                "created_by_user_id": row["created_by_user_id"],
                "created_at": row["created_at"],
                "latest_image_uploaded_at": row["latest_image_uploaded_at"],
            }
            for row in rows
        ]

    def list_patient_case_rows(
        self,
        *,
        created_by_user_id: str | None = None,
        search: str | None = None,
        page: int = 1,
        page_size: int = 25,
    ) -> dict[str, Any]:
        """Optimized patient case rows with DB-level pagination and search."""
        normalized_search = str(search or "").strip().lower()
        bounded_page_size = max(1, min(int(page_size or 25), 100))
        safe_page = max(1, int(page or 1))

        patient_table = db_patients.alias("p")
        visit_table = db_visits.alias("v")
        image_table = db_images.alias("i")

        # Image stats subquery
        image_stats = (
            select(
                image_table.c.visit_id,
                func.count(image_table.c.image_id).label("image_count"),
                func.max(image_table.c.uploaded_at).label("latest_image_uploaded_at"),
            )
            .where(image_table.c.site_id == self.site_id)
            .group_by(image_table.c.visit_id)
            .subquery("image_stats")
        )

        # Representative image subquery
        representative_images = (
            select(
                image_table.c.visit_id,
                image_table.c.image_id.label("representative_image_id"),
                image_table.c.view.label("representative_view"),
            )
            .where(
                and_(
                    image_table.c.site_id == self.site_id,
                    image_table.c.is_representative == True,
                )
            )
            .subquery("representative_images")
        )

        # Patient summary subquery (latest case per patient)
        patient_latest = (
            select(
                visit_table.c.patient_id,
                func.count(visit_table.c.visit_id).label("case_count"),
                func.max(
                    visit_table.c.visit_index * 1000000000000 +
                    func.coalesce(func.length(visit_table.c.created_at), 0)
                ).label("sort_key"),
            )
            .where(and_(visit_table.c.site_id == self.site_id, visit_table.c.culture_confirmed == True))
            .group_by(visit_table.c.patient_id)
            .subquery("patient_latest")
        )

        # Build search conditions
        search_conditions = []
        fts_match_query = (
            _sqlite_patient_case_match_query(normalized_search)
            if normalized_search and data_plane_sqlite_search_ready()
            else None
        )
        if fts_match_query:
            fts_search = table(
                "patient_case_search",
                column("site_id"),
                column("visit_id"),
            )
            matching_visit_ids = (
                select(fts_search.c.visit_id)
                .select_from(fts_search)
                .where(
                    and_(
                        fts_search.c.site_id == self.site_id,
                        literal_column("patient_case_search").op("MATCH")(fts_match_query),
                    )
                )
            )
            search_conditions = [visit_table.c.visit_id.in_(matching_visit_ids)]
        elif normalized_search:
            search_pattern = f"%{normalized_search}%"
            search_conditions = [
                or_(
                    patient_table.c.patient_id.ilike(search_pattern),
                    patient_table.c.local_case_code.ilike(search_pattern),
                    patient_table.c.chart_alias.ilike(search_pattern),
                    visit_table.c.culture_category.ilike(search_pattern),
                    visit_table.c.culture_species.ilike(search_pattern),
                    visit_table.c.visit_date.ilike(search_pattern),
                    visit_table.c.actual_visit_date.ilike(search_pattern),
                )
            ]

        # Count query for total patients matching search
        count_base = (
            select(func.count(func.distinct(visit_table.c.patient_id)))
            .select_from(
                visit_table.join(
                    patient_table,
                    and_(
                        visit_table.c.site_id == patient_table.c.site_id,
                        visit_table.c.patient_id == patient_table.c.patient_id,
                    ),
                )
            )
            .where(and_(visit_table.c.site_id == self.site_id, visit_table.c.culture_confirmed == True))
        )
        if created_by_user_id:
            count_base = count_base.where(patient_table.c.created_by_user_id == created_by_user_id)
        if search_conditions:
            count_base = count_base.where(and_(*search_conditions))

        # Run all three queries in a single connection to avoid repeated connection
        # overhead and reduce lock contention on SQLite.
        patient_ids_query_base = (
            select(
                patient_table.c.patient_id,
                patient_latest.c.case_count,
                func.max(image_stats.c.latest_image_uploaded_at).label("max_upload"),
                func.max(visit_table.c.created_at).label("max_created"),
                func.max(visit_table.c.visit_index).label("max_visit_index"),
            )
            .select_from(
                patient_table
                .join(
                    visit_table,
                    and_(
                        patient_table.c.site_id == visit_table.c.site_id,
                        patient_table.c.patient_id == visit_table.c.patient_id,
                    ),
                )
                .join(patient_latest, patient_table.c.patient_id == patient_latest.c.patient_id)
                .outerjoin(image_stats, visit_table.c.visit_id == image_stats.c.visit_id)
            )
            .where(and_(patient_table.c.site_id == self.site_id, visit_table.c.culture_confirmed == True))
            .group_by(patient_table.c.patient_id, patient_latest.c.case_count)
        )
        if created_by_user_id:
            patient_ids_query_base = patient_ids_query_base.where(patient_table.c.created_by_user_id == created_by_user_id)
        if search_conditions:
            patient_ids_query_base = patient_ids_query_base.where(and_(*search_conditions))

        cases_query_base = (
            select(
                visit_table.c.visit_id,
                visit_table.c.patient_id,
                visit_table.c.patient_reference_id,
                visit_table.c.visit_date,
                visit_table.c.visit_index,
                visit_table.c.actual_visit_date,
                visit_table.c.culture_category,
                visit_table.c.culture_species,
                visit_table.c.additional_organisms,
                visit_table.c.contact_lens_use,
                visit_table.c.predisposing_factor,
                visit_table.c.other_history,
                visit_table.c.visit_status,
                visit_table.c.active_stage,
                visit_table.c.is_initial_visit,
                visit_table.c.smear_result,
                visit_table.c.polymicrobial,
                visit_table.c.research_registry_status,
                visit_table.c.created_at,
                patient_table.c.chart_alias,
                patient_table.c.local_case_code,
                patient_table.c.sex,
                patient_table.c.age,
                patient_table.c.created_by_user_id,
                func.coalesce(image_stats.c.image_count, 0).label("image_count"),
                image_stats.c.latest_image_uploaded_at,
                representative_images.c.representative_image_id,
                representative_images.c.representative_view,
            )
            .select_from(
                visit_table
                .join(
                    patient_table,
                    and_(
                        visit_table.c.site_id == patient_table.c.site_id,
                        visit_table.c.patient_id == patient_table.c.patient_id,
                    ),
                )
                .outerjoin(image_stats, visit_table.c.visit_id == image_stats.c.visit_id)
                .outerjoin(representative_images, visit_table.c.visit_id == representative_images.c.visit_id)
            )
            .where(and_(visit_table.c.site_id == self.site_id, visit_table.c.culture_confirmed == True))
            .order_by(
                desc(image_stats.c.latest_image_uploaded_at),
                desc(visit_table.c.created_at),
                desc(visit_table.c.visit_index),
            )
        )

        with DATA_PLANE_ENGINE.connect() as conn:
            total_count = conn.execute(count_base).scalar() or 0

            total_pages = max(1, (total_count + bounded_page_size - 1) // bounded_page_size)
            safe_page = min(safe_page, total_pages) if total_pages > 0 else 1
            offset = (safe_page - 1) * bounded_page_size

            patient_ids_query = (
                patient_ids_query_base
                .order_by(
                    desc(func.coalesce(func.max(image_stats.c.latest_image_uploaded_at), "")),
                    desc(func.max(visit_table.c.created_at)),
                    desc(func.max(visit_table.c.visit_index)),
                )
                .limit(bounded_page_size)
                .offset(offset)
            )
            patient_rows = conn.execute(patient_ids_query).mappings().all()

            if not patient_rows:
                return {
                    "items": [],
                    "page": safe_page,
                    "page_size": bounded_page_size,
                    "total_count": total_count,
                    "total_pages": total_pages,
                }

            patient_ids = [row["patient_id"] for row in patient_rows]
            case_counts = {row["patient_id"]: int(row["case_count"] or 0) for row in patient_rows}

            cases_query = cases_query_base.where(visit_table.c.patient_id.in_(patient_ids))
            case_rows = conn.execute(cases_query).mappings().all()

        # Group cases by patient
        cases_by_patient: dict[str, list[dict[str, Any]]] = {}
        for row in case_rows:
            patient_id = row["patient_id"]
            case_record = {
                "case_id": f"{row['patient_id']}::{row['visit_date']}",
                "visit_id": row["visit_id"],
                "patient_id": row["patient_id"],
                "patient_reference_id": row["patient_reference_id"],
                "visit_date": row["visit_date"],
                "visit_index": row["visit_index"],
                "actual_visit_date": row["actual_visit_date"],
                "chart_alias": row["chart_alias"] or "",
                "local_case_code": row["local_case_code"] or "",
                "sex": row["sex"] or "",
                "age": row["age"],
                "culture_category": row["culture_category"] or "",
                "culture_species": row["culture_species"] or "",
                "additional_organisms": row["additional_organisms"] or [],
                "contact_lens_use": row["contact_lens_use"] or "",
                "predisposing_factor": row["predisposing_factor"] or [],
                "other_history": row["other_history"] or "",
                "visit_status": row["visit_status"] or "active",
                "active_stage": bool(row["active_stage"]) if row["active_stage"] is not None else (row["visit_status"] == "active"),
                "is_initial_visit": bool(row["is_initial_visit"]),
                "smear_result": row["smear_result"] or "",
                "polymicrobial": bool(row["polymicrobial"] or row["additional_organisms"]),
                "research_registry_status": row["research_registry_status"] or "analysis_only",
                "image_count": int(row["image_count"] or 0),
                "representative_image_id": row["representative_image_id"],
                "representative_view": row["representative_view"],
                "created_by_user_id": row["created_by_user_id"],
                "created_at": row["created_at"],
                "latest_image_uploaded_at": row["latest_image_uploaded_at"],
            }
            cases_by_patient.setdefault(patient_id, []).append(case_record)

        # Build result rows maintaining the order from patient_ids
        rows: list[dict[str, Any]] = []
        for patient_id in patient_ids:
            cases = cases_by_patient.get(patient_id, [])
            if not cases:
                continue
            sorted_cases = sorted(cases, key=_case_summary_sort_key, reverse=True)
            latest_case = sorted_cases[0]
            representative_cases = [
                item
                for item in sorted_cases
                if item.get("representative_image_id")
            ]
            rows.append(
                {
                    "patient_id": patient_id,
                    "latest_case": latest_case,
                    "case_count": case_counts.get(patient_id, len(sorted_cases)),
                    "representative_thumbnail_count": len(representative_cases),
                    "organism_summary": _organism_summary_label(
                        str(latest_case.get("culture_category") or ""),
                        str(latest_case.get("culture_species") or ""),
                        latest_case.get("additional_organisms", []) or [],
                        max_visible_species=2,
                    ),
                    "representative_thumbnails": [
                        {
                            "case_id": item["case_id"],
                            "image_id": item["representative_image_id"],
                            "view": item.get("representative_view"),
                            "preview_url": None,
                        }
                        for item in representative_cases
                    ][:3],
                }
            )

        return {
            "items": rows,
            "page": safe_page,
            "page_size": bounded_page_size,
            "total_count": total_count,
            "total_pages": total_pages,
        }

    def update_visit_registry_status(
        self,
        patient_id: str,
        visit_date: str,
        *,
        status_value: str,
        updated_by_user_id: str | None,
        source: str,
    ) -> dict[str, Any]:
        normalized_patient_id = normalize_patient_pseudonym(patient_id)
        normalized_visit_date = normalize_visit_label(visit_date)
        existing = self.get_visit(normalized_patient_id, normalized_visit_date)
        if existing is None:
            raise ValueError(f"Visit {normalized_patient_id} / {normalized_visit_date} does not exist.")
        normalized_status = str(status_value or "").strip().lower()
        if normalized_status not in {"analysis_only", "candidate", "included", "excluded"}:
            raise ValueError("Invalid registry status.")
        values = {
            "research_registry_status": normalized_status,
            "research_registry_updated_at": utc_now(),
            "research_registry_updated_by": updated_by_user_id,
            "research_registry_source": str(source or "").strip() or None,
        }
        with DATA_PLANE_ENGINE.begin() as conn:
            conn.execute(
                update(db_visits)
                .where(and_(db_visits.c.site_id == self.site_id, db_visits.c.visit_id == existing["visit_id"]))
                .values(**values)
            )
        refreshed = self._get_visit_by_id(_coerce_optional_text(existing.get("visit_id")))
        if refreshed is None:
            raise ValueError(f"Visit {normalized_patient_id} / {normalized_visit_date} does not exist.")
        return refreshed

    def metadata_backup_path(self) -> Path:
        return self.manifest_dir / "metadata_backup.json"

    def export_metadata_backup(self, path: Path | None = None) -> Path:
        backup_path = path or self.metadata_backup_path()
        with DATA_PLANE_ENGINE.begin() as conn:
            patient_rows = conn.execute(
                select(db_patients).where(db_patients.c.site_id == self.site_id).order_by(db_patients.c.patient_id)
            ).mappings().all()
            visit_rows = conn.execute(
                select(db_visits)
                .where(db_visits.c.site_id == self.site_id)
                .order_by(db_visits.c.patient_id, db_visits.c.visit_index, db_visits.c.visit_date)
            ).mappings().all()
            image_rows = conn.execute(
                select(db_images)
                .where(db_images.c.site_id == self.site_id)
                .order_by(db_images.c.patient_id, db_images.c.visit_date, db_images.c.uploaded_at)
            ).mappings().all()
        payload = {
            "site_id": self.site_id,
            "exported_at": utc_now(),
            "patients": [dict(row) for row in patient_rows],
            "visits": [dict(row) for row in visit_rows],
            "images": [dict(row) for row in image_rows],
        }
        write_json(backup_path, payload)
        return backup_path

    def _clear_site_metadata_rows(self) -> None:
        with DATA_PLANE_ENGINE.begin() as conn:
            conn.execute(delete(db_images).where(db_images.c.site_id == self.site_id))
            conn.execute(delete(db_visits).where(db_visits.c.site_id == self.site_id))
            conn.execute(delete(db_patients).where(db_patients.c.site_id == self.site_id))

    def _resolve_recovery_image_path(
        self,
        image_path: Any,
        patient_id: str,
        image_name: str,
        *,
        visit_date: str | None = None,
    ) -> Path:
        raw_value = _coerce_optional_text(image_path)
        candidates: list[Path] = []
        normalized_patient_id = _coerce_optional_text(patient_id)
        normalized_image_name = _coerce_optional_text(image_name)
        normalized_visit_date: str | None = None
        if visit_date:
            try:
                normalized_visit_date = normalize_visit_label(visit_date)
            except ValueError:
                normalized_visit_date = _coerce_optional_text(visit_date)
        if normalized_patient_id and normalized_image_name and normalized_visit_date:
            candidates.append(
                self._canonical_image_storage_path(
                    normalized_patient_id,
                    normalized_visit_date,
                    normalized_image_name,
                )
            )
        if raw_value:
            original = Path(raw_value).expanduser()
            if original.is_absolute():
                candidates.append(original)
                parts = list(original.parts)
                raw_index: int | None = None
                for index in range(len(parts) - 1):
                    if parts[index].lower() == "data" and parts[index + 1].lower() == "raw":
                        raw_index = index
                        break
                if raw_index is not None:
                    relative_parts = parts[raw_index + 2 :]
                    if relative_parts:
                        candidates.append((self.raw_dir / Path(*relative_parts)).resolve())
            else:
                candidates.append((self.site_dir / original).resolve())

        patient_dir = self.raw_dir / patient_id
        if image_name and patient_dir.exists():
            matches = [path.resolve() for path in patient_dir.rglob(image_name) if path.is_file()]
            if matches:
                candidates.extend(matches)
        if normalized_patient_id and normalized_visit_date:
            visit_dir = self.raw_dir / normalized_patient_id / normalized_visit_date
            if visit_dir.exists():
                allowed_suffixes = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp"}
                visit_files = [
                    path.resolve()
                    for path in visit_dir.iterdir()
                    if path.is_file() and path.suffix.lower() in allowed_suffixes
                ]
                if len(visit_files) == 1:
                    candidates.append(visit_files[0])

        seen: set[str] = set()
        for candidate in candidates:
            key = str(candidate)
            if key in seen:
                continue
            seen.add(key)
            if candidate.exists():
                return candidate.resolve()
        if candidates:
            raise ValueError(f"Image file not found on disk: {candidates[0]}")
        raise ValueError("Image file path is required for metadata recovery.")

    def standardize_visit_storage_layout(self, *, refresh_manifest: bool = True) -> dict[str, int]:
        query = (
            select(
                db_images.c.image_id,
                db_images.c.patient_id,
                db_images.c.visit_date,
                db_images.c.image_path,
            )
            .where(db_images.c.site_id == self.site_id)
            .order_by(db_images.c.patient_id, db_images.c.visit_date, db_images.c.uploaded_at)
        )
        with DATA_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(query).mappings().all()

        moved_files = 0
        updated_paths = 0
        removed_dirs = 0
        skipped_images = 0
        conflict_paths = 0
        patient_dirs: set[Path] = set()
        for row in rows:
            image_id = _coerce_optional_text(row.get("image_id"))
            patient_id = _coerce_optional_text(row.get("patient_id"))
            visit_date = _coerce_optional_text(row.get("visit_date"))
            raw_path = _coerce_optional_text(row.get("image_path"))
            image_name = Path(raw_path).name
            if not image_id or not patient_id or not visit_date or not image_name:
                skipped_images += 1
                continue

            patient_dir = (self.raw_dir / patient_id).resolve()
            patient_dirs.add(patient_dir)
            canonical_path = self._canonical_image_storage_path(patient_id, visit_date, image_name)
            try:
                resolved_path = self._resolve_recovery_image_path(raw_path, patient_id, image_name, visit_date=visit_date)
            except ValueError:
                skipped_images += 1
                continue

            runtime_path = canonical_path
            if resolved_path != canonical_path:
                ensure_dir(canonical_path.parent)
                if canonical_path.exists():
                    runtime_path = canonical_path
                    conflict_paths += 1
                else:
                    resolved_path.replace(canonical_path)
                    moved_files += 1
                    removed_dirs += self._prune_empty_raw_dirs(resolved_path.parent, patient_dir=patient_dir)
                    runtime_path = canonical_path
            if str(raw_path) != str(runtime_path):
                self._persist_image_record_path(image_id, runtime_path)
                updated_paths += 1

        manifest_rows = 0
        if refresh_manifest:
            manifest_rows = len(self.generate_manifest())

        return {
            "site_id": self.site_id,
            "scanned_images": len(rows),
            "moved_files": moved_files,
            "updated_paths": updated_paths,
            "removed_dirs": removed_dirs,
            "conflict_paths": conflict_paths,
            "skipped_images": skipped_images,
            "manifest_rows": manifest_rows,
        }

    def _patient_id_from_recovery_image_path(self, image_path: Path) -> str | None:
        try:
            relative_path = image_path.resolve().relative_to(self.raw_dir.resolve())
        except ValueError:
            return None
        if not relative_path.parts:
            return None
        return _coerce_optional_text(relative_path.parts[0]) or None

    def _recover_metadata_from_backup_payload(self, payload: dict[str, Any], *, force_replace: bool) -> dict[str, Any]:
        patients_payload = [dict(item) for item in payload.get("patients", []) if isinstance(item, dict)]
        visits_payload = [dict(item) for item in payload.get("visits", []) if isinstance(item, dict)]
        images_payload = [dict(item) for item in payload.get("images", []) if isinstance(item, dict)]
        if not patients_payload and not visits_payload and not images_payload:
            raise ValueError("Metadata backup is empty.")

        if not force_replace and (self.list_patients() or self.list_visits() or self.list_images()):
            raise ValueError("Site metadata already exists. Use force_replace to rebuild it.")

        patient_id_overrides: dict[str, str] = {}
        for row in images_payload:
            raw_patient_id = _coerce_optional_text(row.get("patient_id"))
            image_name = Path(_coerce_optional_text(row.get("image_path"))).name
            if not raw_patient_id or not image_name:
                continue
            resolved_image_path = self._resolve_recovery_image_path(row.get("image_path"), raw_patient_id, image_name)
            path_patient_id = self._patient_id_from_recovery_image_path(resolved_image_path)
            if path_patient_id:
                patient_id_overrides[raw_patient_id] = path_patient_id

        patient_records: list[dict[str, Any]] = []
        for row in patients_payload:
            raw_patient_id = _coerce_optional_text(row.get("patient_id"))
            patient_records.append(
                {
                    "site_id": self.site_id,
                    "patient_id": normalize_patient_pseudonym(patient_id_overrides.get(raw_patient_id, raw_patient_id)),
                    "created_by_user_id": _coerce_optional_text(row.get("created_by_user_id")) or None,
                    "sex": _coerce_optional_text(row.get("sex"), "unknown") or "unknown",
                    "age": _coerce_optional_int(row.get("age"), 0),
                    "chart_alias": _coerce_optional_text(row.get("chart_alias")),
                    "local_case_code": _coerce_optional_text(row.get("local_case_code")),
                    "created_at": _coerce_optional_text(row.get("created_at"), utc_now()),
                }
            )

        visit_records: list[dict[str, Any]] = []
        visit_index_by_key: dict[tuple[str, str], str] = {}
        for row in visits_payload:
            raw_patient_id = _coerce_optional_text(row.get("patient_id"))
            normalized_patient_id = normalize_patient_pseudonym(patient_id_overrides.get(raw_patient_id, raw_patient_id))
            normalized_visit_date = normalize_visit_label(_coerce_optional_text(row.get("visit_date")))
            visit_id = _coerce_optional_text(row.get("visit_id")) or make_id("visit")
            visit_record = {
                "visit_id": visit_id,
                "site_id": self.site_id,
                "patient_id": normalized_patient_id,
                "patient_reference_id": _coerce_optional_text(row.get("patient_reference_id"))
                or make_patient_reference_id(self.site_id, normalized_patient_id, PATIENT_REFERENCE_SALT),
                "created_by_user_id": _coerce_optional_text(row.get("created_by_user_id")) or None,
                "visit_date": normalized_visit_date,
                "visit_index": int(row.get("visit_index") or visit_index_from_label(normalized_visit_date)),
                "actual_visit_date": normalize_actual_visit_date(_coerce_optional_text(row.get("actual_visit_date")) or None),
                "culture_confirmed": _coerce_optional_bool(row.get("culture_confirmed"), True),
                "culture_category": _coerce_optional_text(row.get("culture_category"), "bacterial") or "bacterial",
                "culture_species": _coerce_optional_text(row.get("culture_species"), "Other") or "Other",
                "contact_lens_use": _coerce_optional_text(row.get("contact_lens_use"), "unknown") or "unknown",
                "predisposing_factor": list(row.get("predisposing_factor") or []),
                "additional_organisms": list(row.get("additional_organisms") or []),
                "other_history": _coerce_optional_text(row.get("other_history")),
                "visit_status": _coerce_optional_text(row.get("visit_status"), "active") or "active",
                "active_stage": _coerce_optional_bool(row.get("active_stage"), True),
                "is_initial_visit": _coerce_optional_bool(row.get("is_initial_visit"), normalized_visit_date == "Initial"),
                "smear_result": _coerce_optional_text(row.get("smear_result"), "not done") or "not done",
                "polymicrobial": _coerce_optional_bool(row.get("polymicrobial"), False),
                "research_registry_status": _coerce_optional_text(row.get("research_registry_status"), "analysis_only") or "analysis_only",
                "research_registry_updated_at": _coerce_optional_text(row.get("research_registry_updated_at"), utc_now()),
                "research_registry_updated_by": _coerce_optional_text(row.get("research_registry_updated_by")) or None,
                "research_registry_source": _coerce_optional_text(row.get("research_registry_source"), "metadata_backup_restore") or "metadata_backup_restore",
                "created_at": _coerce_optional_text(row.get("created_at"), utc_now()),
            }
            visit_records.append(visit_record)
            visit_index_by_key[(normalized_patient_id, normalized_visit_date)] = visit_id

        image_records: list[dict[str, Any]] = []
        for row in images_payload:
            raw_patient_id = _coerce_optional_text(row.get("patient_id"))
            normalized_visit_date = normalize_visit_label(_coerce_optional_text(row.get("visit_date")))
            image_name = Path(_coerce_optional_text(row.get("image_path"))).name
            resolved_image_path = self._resolve_recovery_image_path(
                row.get("image_path"),
                patient_id_overrides.get(raw_patient_id, raw_patient_id),
                image_name,
            )
            path_patient_id = self._patient_id_from_recovery_image_path(resolved_image_path)
            normalized_patient_id = normalize_patient_pseudonym(path_patient_id or patient_id_overrides.get(raw_patient_id, raw_patient_id))
            image_records.append(
                {
                    "image_id": _coerce_optional_text(row.get("image_id")) or resolved_image_path.stem or make_id("image"),
                    "visit_id": visit_index_by_key[(normalized_patient_id, normalized_visit_date)],
                    "site_id": self.site_id,
                    "patient_id": normalized_patient_id,
                    "visit_date": normalized_visit_date,
                    "created_by_user_id": _coerce_optional_text(row.get("created_by_user_id")) or None,
                    "view": _coerce_optional_text(row.get("view"), "white") or "white",
                    "image_path": str(resolved_image_path),
                    "is_representative": _coerce_optional_bool(row.get("is_representative"), False),
                    "lesion_prompt_box": _parse_manifest_box(row.get("lesion_prompt_box")) if not isinstance(row.get("lesion_prompt_box"), dict) else row.get("lesion_prompt_box"),
                    "has_lesion_box": _coerce_optional_bool(row.get("has_lesion_box"), bool(_parse_manifest_box(row.get("lesion_prompt_box")))),
                    "has_roi_crop": _coerce_optional_bool(row.get("has_roi_crop"), False),
                    "has_medsam_mask": _coerce_optional_bool(row.get("has_medsam_mask"), False),
                    "has_lesion_crop": _coerce_optional_bool(row.get("has_lesion_crop"), False),
                    "has_lesion_mask": _coerce_optional_bool(row.get("has_lesion_mask"), False),
                    "quality_scores": row.get("quality_scores") if isinstance(row.get("quality_scores"), dict) else None,
                    "artifact_status_updated_at": _coerce_optional_text(row.get("artifact_status_updated_at"), utc_now()),
                    "uploaded_at": _coerce_optional_text(row.get("uploaded_at"), utc_now()),
                }
            )

        self._clear_site_metadata_rows()
        with DATA_PLANE_ENGINE.begin() as conn:
            if patient_records:
                conn.execute(db_patients.insert().values(patient_records))
            if visit_records:
                conn.execute(db_visits.insert().values(visit_records))
            if image_records:
                conn.execute(db_images.insert().values(image_records))
        return {
            "source": "backup",
            "restored_patients": len(patient_records),
            "restored_visits": len(visit_records),
            "restored_images": len(image_records),
        }

    def _recover_metadata_from_manifest(self, *, force_replace: bool) -> dict[str, Any]:
        if not self.manifest_path.exists():
            raise ValueError("Manifest file does not exist.")
        manifest_df = pd.read_csv(self.manifest_path, dtype=str, keep_default_na=False)
        if manifest_df.empty:
            raise ValueError("Manifest file is empty.")

        if not force_replace and (self.list_patients() or self.list_visits() or self.list_images()):
            raise ValueError("Site metadata already exists. Use force_replace to rebuild it.")

        timestamp = utc_now()
        patient_records: dict[str, dict[str, Any]] = {}
        visit_records: dict[tuple[str, str], dict[str, Any]] = {}
        image_records: list[dict[str, Any]] = []

        for row in manifest_df.to_dict(orient="records"):
            raw_patient_id = _coerce_optional_text(row.get("patient_id"))
            image_name = Path(_coerce_optional_text(row.get("image_path"))).name
            resolved_image_path = self._resolve_recovery_image_path(row.get("image_path"), raw_patient_id, image_name)
            path_patient_id = self._patient_id_from_recovery_image_path(resolved_image_path)
            normalized_patient_id = normalize_patient_pseudonym(path_patient_id or raw_patient_id)
            normalized_visit_date = normalize_visit_label(_coerce_optional_text(row.get("visit_date")))
            patient_record = patient_records.get(normalized_patient_id)
            if patient_record is None:
                patient_record = {
                    "site_id": self.site_id,
                    "patient_id": normalized_patient_id,
                    "created_by_user_id": None,
                    "sex": _coerce_optional_text(row.get("sex"), "unknown") or "unknown",
                    "age": _coerce_optional_int(row.get("age"), 0),
                    "chart_alias": _coerce_optional_text(row.get("chart_alias")),
                    "local_case_code": _coerce_optional_text(row.get("local_case_code")),
                    "created_at": timestamp,
                }
                patient_records[normalized_patient_id] = patient_record
            else:
                if not patient_record["chart_alias"]:
                    patient_record["chart_alias"] = _coerce_optional_text(row.get("chart_alias"))
                if not patient_record["local_case_code"]:
                    patient_record["local_case_code"] = _coerce_optional_text(row.get("local_case_code"))

            visit_key = (normalized_patient_id, normalized_visit_date)
            visit_record = visit_records.get(visit_key)
            if visit_record is None:
                normalized_status = _coerce_optional_text(row.get("visit_status"), "active").lower() or "active"
                if normalized_status not in VISIT_STATUS_OPTIONS:
                    normalized_status = "active"
                visit_record = {
                    "visit_id": make_id("visit"),
                    "site_id": self.site_id,
                    "patient_id": normalized_patient_id,
                    "patient_reference_id": make_patient_reference_id(
                        self.site_id,
                        normalized_patient_id,
                        PATIENT_REFERENCE_SALT,
                    ),
                    "created_by_user_id": None,
                    "visit_date": normalized_visit_date,
                    "visit_index": visit_index_from_label(normalized_visit_date),
                    "actual_visit_date": None,
                    "culture_confirmed": _coerce_optional_bool(row.get("culture_confirmed"), True),
                    "culture_category": _coerce_optional_text(row.get("culture_category"), "bacterial").lower() or "bacterial",
                    "culture_species": _coerce_optional_text(row.get("culture_species"), "Other") or "Other",
                    "contact_lens_use": _coerce_optional_text(row.get("contact_lens_use"), "unknown") or "unknown",
                    "predisposing_factor": _parse_manifest_pipe_list(row.get("predisposing_factor")),
                    "additional_organisms": [],
                    "other_history": _coerce_optional_text(row.get("other_history")),
                    "visit_status": normalized_status,
                    "active_stage": normalized_status == "active",
                    "is_initial_visit": normalized_visit_date == "Initial",
                    "smear_result": _coerce_optional_text(row.get("smear_result"), "not done") or "not done",
                    "polymicrobial": _coerce_optional_bool(row.get("polymicrobial"), False),
                    "research_registry_status": "analysis_only",
                    "research_registry_updated_at": timestamp,
                    "research_registry_updated_by": None,
                    "research_registry_source": "manifest_recovery",
                    "created_at": timestamp,
                }
                visit_records[visit_key] = visit_record

            lesion_prompt_box = _parse_manifest_box(row.get("lesion_prompt_box"))
            image_records.append(
                {
                    "image_id": resolved_image_path.stem or make_id("image"),
                    "visit_id": visit_record["visit_id"],
                    "site_id": self.site_id,
                    "patient_id": normalized_patient_id,
                    "visit_date": normalized_visit_date,
                    "created_by_user_id": None,
                    "view": _coerce_optional_text(row.get("view"), "white") or "white",
                    "image_path": str(resolved_image_path),
                    "is_representative": _coerce_optional_bool(row.get("is_representative"), False),
                    "lesion_prompt_box": lesion_prompt_box,
                    "has_lesion_box": lesion_prompt_box is not None,
                    "has_roi_crop": False,
                    "has_medsam_mask": False,
                    "has_lesion_crop": False,
                    "has_lesion_mask": False,
                    "quality_scores": None,
                    "artifact_status_updated_at": timestamp,
                    "uploaded_at": timestamp,
                }
            )

        self._clear_site_metadata_rows()
        with DATA_PLANE_ENGINE.begin() as conn:
            conn.execute(db_patients.insert().values(list(patient_records.values())))
            conn.execute(db_visits.insert().values(list(visit_records.values())))
            conn.execute(db_images.insert().values(image_records))
        return {
            "source": "manifest",
            "restored_patients": len(patient_records),
            "restored_visits": len(visit_records),
            "restored_images": len(image_records),
        }

    def recover_metadata(
        self,
        *,
        prefer_backup: bool = True,
        force_replace: bool = False,
        backup_path: str | None = None,
    ) -> dict[str, Any]:
        backup_candidate = Path(backup_path).expanduser() if backup_path else self.metadata_backup_path()
        if prefer_backup and backup_candidate.exists():
            payload = read_json(backup_candidate, {})
            result = self._recover_metadata_from_backup_payload(payload, force_replace=force_replace)
        else:
            result = self._recover_metadata_from_manifest(force_replace=force_replace)
        self.generate_manifest()
        self.export_metadata_backup()
        return result

    def generate_manifest(self) -> pd.DataFrame:
        data_frame = pd.DataFrame(self.dataset_records(), columns=MANIFEST_COLUMNS)
        write_csv(self.manifest_path, data_frame)
        return data_frame

    def load_manifest(self) -> pd.DataFrame:
        return self.generate_manifest()

    def load_patient_split(self) -> dict[str, Any]:
        query = select(site_patient_splits.c.split_json).where(site_patient_splits.c.site_id == self.site_id)
        with DATA_PLANE_ENGINE.begin() as conn:
            row = conn.execute(query).first()
        return dict(row[0]) if row and row[0] else {}

    def save_patient_split(self, split_record: dict[str, Any]) -> dict[str, Any]:
        record = {
            "site_id": self.site_id,
            "split_json": split_record,
            "updated_at": utc_now(),
        }
        with DATA_PLANE_ENGINE.begin() as conn:
            existing = conn.execute(select(site_patient_splits.c.site_id).where(site_patient_splits.c.site_id == self.site_id)).first()
            if existing:
                conn.execute(
                    update(site_patient_splits)
                    .where(site_patient_splits.c.site_id == self.site_id)
                    .values(**record)
                )
            else:
                conn.execute(site_patient_splits.insert().values(**record))
        return split_record

    def clear_patient_split(self) -> None:
        self.save_patient_split({})

    @staticmethod
    def _job_row_to_dict(row: dict[str, Any]) -> dict[str, Any]:
        return {
            "job_id": row["job_id"],
            "site_id": row["site_id"],
            "job_type": row["job_type"],
            "queue_name": row.get("queue_name", "default"),
            "priority": int(row.get("priority") or 100),
            "status": row["status"],
            "attempt_count": int(row.get("attempt_count") or 0),
            "max_attempts": int(row.get("max_attempts") or 1),
            "claimed_by": row.get("claimed_by"),
            "claimed_at": row.get("claimed_at"),
            "heartbeat_at": row.get("heartbeat_at"),
            "available_at": row.get("available_at"),
            "started_at": row.get("started_at"),
            "finished_at": row.get("finished_at"),
            "payload": row["payload_json"],
            "result": row["result_json"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def enqueue_job(
        self,
        job_type: str,
        payload: dict[str, Any],
        *,
        queue_name: str = "default",
        priority: int = 100,
        max_attempts: int = 1,
        available_at: str | None = None,
    ) -> dict[str, Any]:
        created_at = utc_now()
        record = {
            "job_id": make_id("job"),
            "site_id": self.site_id,
            "job_type": job_type,
            "status": "queued",
            "queue_name": queue_name,
            "priority": int(priority),
            "attempt_count": 0,
            "max_attempts": max(1, int(max_attempts)),
            "claimed_by": None,
            "claimed_at": None,
            "heartbeat_at": None,
            "available_at": available_at or created_at,
            "started_at": None,
            "finished_at": None,
            "payload_json": payload,
            "result_json": None,
            "created_at": created_at,
            "updated_at": None,
        }
        with DATA_PLANE_ENGINE.begin() as conn:
            conn.execute(site_jobs.insert().values(**record))
        return self._job_row_to_dict(record)

    def list_jobs(self, status: str | None = None) -> list[dict[str, Any]]:
        query = select(site_jobs).where(site_jobs.c.site_id == self.site_id).order_by(site_jobs.c.created_at.desc())
        if status:
            query = query.where(site_jobs.c.status == status)
        with DATA_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(query).mappings().all()
        return [self._job_row_to_dict(row) for row in rows]

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        with DATA_PLANE_ENGINE.begin() as conn:
            row = conn.execute(
                select(site_jobs).where(and_(site_jobs.c.site_id == self.site_id, site_jobs.c.job_id == job_id))
            ).mappings().first()
        if row is None:
            return None
        return self._job_row_to_dict(row)

    def delete_jobs(self, *, job_type: str | None = None) -> int:
        query = delete(site_jobs).where(site_jobs.c.site_id == self.site_id)
        normalized_job_type = str(job_type or "").strip()
        if normalized_job_type:
            query = query.where(site_jobs.c.job_type == normalized_job_type)
        with DATA_PLANE_ENGINE.begin() as conn:
            result = conn.execute(query)
        return int(result.rowcount or 0)

    def request_job_cancel(self, job_id: str) -> dict[str, Any] | None:
        with DATA_PLANE_ENGINE.begin() as conn:
            existing = conn.execute(
                select(site_jobs).where(and_(site_jobs.c.site_id == self.site_id, site_jobs.c.job_id == job_id))
            ).mappings().first()
            if existing is None:
                return None

            current_status = str(existing.get("status") or "").strip().lower()
            if current_status in {"completed", "failed", "cancelled"}:
                return self._job_row_to_dict(existing)

            result_json = dict(existing.get("result_json") or {})
            progress = dict(result_json.get("progress") or {})
            now = utc_now()

            if current_status == "queued":
                next_status = "cancelled"
                progress = {
                    **progress,
                    "stage": "cancelled",
                    "message": "Job cancelled before execution.",
                    "percent": int(progress.get("percent", 0) or 0),
                }
                values: dict[str, Any] = {
                    "status": next_status,
                    "result_json": {**result_json, "progress": progress},
                    "finished_at": now,
                    "updated_at": now,
                }
            else:
                next_status = "cancelling"
                progress = {
                    **progress,
                    "stage": "cancelling",
                    "message": "Cancellation requested. Waiting for the worker to stop safely.",
                    "percent": int(progress.get("percent", 0) or 0),
                }
                values = {
                    "status": next_status,
                    "result_json": {**result_json, "progress": progress},
                    "updated_at": now,
                }

            conn.execute(
                update(site_jobs)
                .where(and_(site_jobs.c.site_id == self.site_id, site_jobs.c.job_id == job_id))
                .values(**values)
            )
            row = conn.execute(
                select(site_jobs).where(and_(site_jobs.c.site_id == self.site_id, site_jobs.c.job_id == job_id))
            ).mappings().first()
        return self._job_row_to_dict(row) if row is not None else None

    def update_job_status(self, job_id: str, status: str, result: dict[str, Any] | None = None) -> None:
        with DATA_PLANE_ENGINE.begin() as conn:
            existing = conn.execute(
                select(site_jobs).where(and_(site_jobs.c.site_id == self.site_id, site_jobs.c.job_id == job_id))
            ).mappings().first()
            if existing is None:
                return
            result_json = result if result is not None else existing["result_json"]
            values: dict[str, Any] = {
                "status": status,
                "result_json": result_json,
                "updated_at": utc_now(),
            }
            if status == "running":
                values["heartbeat_at"] = values["updated_at"]
                values["started_at"] = existing.get("started_at") or values["updated_at"]
            if status in {"completed", "failed", "cancelled"}:
                values["finished_at"] = values["updated_at"]
            conn.execute(
                update(site_jobs)
                .where(and_(site_jobs.c.site_id == self.site_id, site_jobs.c.job_id == job_id))
                .values(**values)
            )

    @staticmethod
    def claim_next_job(
        worker_id: str,
        *,
        queue_names: list[str] | None = None,
        site_id: str | None = None,
    ) -> dict[str, Any] | None:
        init_data_plane_db()
        now = utc_now()
        with DATA_PLANE_ENGINE.begin() as conn:
            query = select(site_jobs).where(
                and_(
                    site_jobs.c.status == "queued",
                    or_(site_jobs.c.available_at.is_(None), site_jobs.c.available_at <= now),
                )
            )
            if queue_names:
                query = query.where(site_jobs.c.queue_name.in_(queue_names))
            if site_id:
                query = query.where(site_jobs.c.site_id == site_id)
            query = query.order_by(site_jobs.c.priority.asc(), site_jobs.c.created_at.asc())
            candidates = conn.execute(query.limit(20)).mappings().all()
            for candidate in candidates:
                updated = conn.execute(
                    update(site_jobs)
                    .where(and_(site_jobs.c.job_id == candidate["job_id"], site_jobs.c.status == "queued"))
                    .values(
                        status="running",
                        attempt_count=int(candidate.get("attempt_count") or 0) + 1,
                        claimed_by=worker_id,
                        claimed_at=now,
                        heartbeat_at=now,
                        started_at=candidate.get("started_at") or now,
                        updated_at=now,
                    )
                )
                if int(updated.rowcount or 0) <= 0:
                    continue
                row = conn.execute(select(site_jobs).where(site_jobs.c.job_id == candidate["job_id"])).mappings().first()
                if row is not None:
                    return SiteStore._job_row_to_dict(row)
        return None

    @staticmethod
    def heartbeat_job(job_id: str, worker_id: str) -> None:
        init_data_plane_db()
        with DATA_PLANE_ENGINE.begin() as conn:
            conn.execute(
                update(site_jobs)
                .where(
                    and_(
                        site_jobs.c.job_id == job_id,
                        site_jobs.c.status == "running",
                        site_jobs.c.claimed_by == worker_id,
                    )
                )
                .values(
                    heartbeat_at=utc_now(),
                    updated_at=utc_now(),
                )
            )

    @staticmethod
    def requeue_stale_jobs(*, heartbeat_before: str) -> int:
        init_data_plane_db()
        with DATA_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(
                select(site_jobs).where(
                    and_(
                        site_jobs.c.status == "running",
                        site_jobs.c.heartbeat_at.is_not(None),
                        site_jobs.c.heartbeat_at < heartbeat_before,
                    )
                )
            ).mappings().all()
            requeued = 0
            for row in rows:
                attempt_count = int(row.get("attempt_count") or 0)
                max_attempts = int(row.get("max_attempts") or 1)
                if attempt_count < max_attempts:
                    conn.execute(
                        update(site_jobs)
                        .where(site_jobs.c.job_id == row["job_id"])
                        .values(
                            status="queued",
                            claimed_by=None,
                            claimed_at=None,
                            heartbeat_at=None,
                            available_at=utc_now(),
                            updated_at=utc_now(),
                        )
                    )
                else:
                    failure_result = dict(row.get("result_json") or {})
                    failure_result.setdefault("error", "Job lease expired.")
                    conn.execute(
                        update(site_jobs)
                        .where(site_jobs.c.job_id == row["job_id"])
                        .values(
                            status="failed",
                            result_json=failure_result,
                            finished_at=utc_now(),
                            updated_at=utc_now(),
                        )
                    )
                requeued += 1
        return requeued

    def artifact_files(self, artifact_type: str) -> list[Path]:
        mapping = {
            "gradcam": self.gradcam_dir,
            "medsam_mask": self.medsam_mask_dir,
            "roi_crop": self.roi_crop_dir,
            "lesion_mask": self.lesion_mask_dir,
            "lesion_crop": self.lesion_crop_dir,
        }
        directory = mapping[artifact_type]
        return sorted(directory.glob("*"))
