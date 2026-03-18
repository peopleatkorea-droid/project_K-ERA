from __future__ import annotations

from io import BytesIO
import os
import re
import threading
from pathlib import Path
from typing import Any

import pandas as pd
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import and_, delete, desc, func, or_, select, update

from kera_research.config import (
    BASE_DIR,
    CONTROL_PLANE_API_BASE_URL,
    PATIENT_REFERENCE_SALT,
    SITE_ROOT_DIR,
    ensure_base_directories,
)
from kera_research.db import (
    CONTROL_PLANE_DATABASE_URL,
    CONTROL_PLANE_ENGINE,
    DATA_PLANE_DATABASE_URL,
    DATA_PLANE_ENGINE,
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
from kera_research.services.node_credentials import load_node_credentials
from kera_research.storage import ensure_dir, read_json, write_csv, write_json

_ALLOWED_IMAGE_FORMATS = {"JPEG", "PNG", "TIFF", "BMP", "WEBP"}
_MAX_IMAGE_PIXELS = 40_000_000
_SITE_STORAGE_ROOT_CACHE: dict[str, Path] = {}
_SITE_STORAGE_ROOT_CACHE_LOCK = threading.Lock()


class InvalidImageUploadError(ValueError):
    pass


def control_plane_split_enabled() -> bool:
    return CONTROL_PLANE_DATABASE_URL != DATA_PLANE_DATABASE_URL


def _use_control_plane_site_storage_lookup() -> bool:
    mode = os.getenv("KERA_SITE_STORAGE_SOURCE", "").strip().lower()
    if mode == "control_plane":
        return True
    if mode == "local":
        return False
    persisted_credentials = load_node_credentials() or {}
    remote_control_plane_enabled = bool(
        str(CONTROL_PLANE_API_BASE_URL or persisted_credentials.get("control_plane_base_url") or "").strip()
    )
    if remote_control_plane_enabled:
        return False
    return not control_plane_split_enabled()


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
    if _use_control_plane_site_storage_lookup():
        with CONTROL_PLANE_ENGINE.begin() as conn:
            row = conn.execute(
                select(control_sites.c.local_storage_root).where(control_sites.c.site_id == site_id)
            ).first()

        configured_root = str(row[0] or "").strip() if row else ""
        if configured_root:
            root_path = Path(configured_root).expanduser()
            if not root_path.is_absolute():
                root_path = (BASE_DIR / root_path).resolve()
            else:
                root_path = root_path.resolve()
            resolved_root = root_path

    with _SITE_STORAGE_ROOT_CACHE_LOCK:
        _SITE_STORAGE_ROOT_CACHE[site_id] = resolved_root
    return resolved_root


def _safe_path_component(value: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9._-]+", "_", str(value or "").strip())
    return normalized or "unknown"


class SiteStore:
    def __init__(self, site_id: str) -> None:
        ensure_base_directories()
        init_data_plane_db()
        if _use_control_plane_site_storage_lookup():
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
        self.validation_dir = self.site_dir / "validation"
        self.update_dir = self.site_dir / "model_updates"
        self.case_history_dir = self.site_dir / "case_history"
        self._seed_defaults()

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
            self.validation_dir,
            self.update_dir,
            self.case_history_dir,
        ):
            ensure_dir(path)

    def _case_history_path(self, patient_id: str, visit_date: str) -> Path:
        patient_dir = ensure_dir(self.case_history_dir / _safe_path_component(patient_id))
        return patient_dir / f"{_safe_path_component(visit_date)}.json"

    def load_case_history(self, patient_id: str, visit_date: str) -> dict[str, list[dict[str, Any]]]:
        history_path = self._case_history_path(patient_id, visit_date)
        payload = read_json(history_path, {"validations": [], "contributions": []})
        validations = [dict(item) for item in payload.get("validations", []) if isinstance(item, dict)]
        contributions = [dict(item) for item in payload.get("contributions", []) if isinstance(item, dict)]
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
        history = self.load_case_history(patient_id, visit_date)
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
        write_json(self._case_history_path(patient_id, visit_date), history)
        return history

    def record_case_contribution_history(self, patient_id: str, visit_date: str, entry: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
        history = self.load_case_history(patient_id, visit_date)
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
        write_json(self._case_history_path(patient_id, visit_date), history)
        return history

    def list_patients(self, created_by_user_id: str | None = None) -> list[dict[str, Any]]:
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

    def list_visits(self) -> list[dict[str, Any]]:
        query = (
            select(db_visits)
            .where(db_visits.c.site_id == self.site_id)
            .order_by(db_visits.c.patient_id, db_visits.c.visit_index, db_visits.c.visit_date)
        )
        with DATA_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(query).mappings().all()
        return [dict(row) for row in rows]

    def get_visit(self, patient_id: str, visit_date: str) -> dict[str, Any] | None:
        query = select(db_visits).where(
            and_(
                db_visits.c.site_id == self.site_id,
                db_visits.c.patient_id == patient_id,
                db_visits.c.visit_date == visit_date,
            )
        )
        with DATA_PLANE_ENGINE.begin() as conn:
            row = conn.execute(query).mappings().first()
        return dict(row) if row else None

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
        normalized_actual_visit_date = normalize_actual_visit_date(actual_visit_date)
        existing = self.get_visit(normalized_patient_id, normalized_visit_date)
        if existing is None:
            raise ValueError(f"Visit {normalized_patient_id} / {normalized_visit_date} does not exist.")
        if not culture_confirmed:
            raise ValueError("Only culture-proven keratitis cases are allowed.")
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
            "patient_reference_id": make_patient_reference_id(
                self.site_id,
                normalized_patient_id,
                PATIENT_REFERENCE_SALT,
            ),
            "actual_visit_date": normalized_actual_visit_date,
            "visit_index": visit_index_from_label(normalized_visit_date),
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
                .where(
                    and_(
                        db_visits.c.site_id == self.site_id,
                        db_visits.c.patient_id == patient_id,
                        db_visits.c.visit_date == visit_date,
                    )
                )
                .values(**values)
            )
        refreshed = self.get_visit(patient_id, visit_date)
        if refreshed is None:
            raise ValueError(f"Visit {patient_id} / {visit_date} does not exist.")
        return refreshed

    def list_images(self) -> list[dict[str, Any]]:
        query = (
            select(db_images)
            .where(db_images.c.site_id == self.site_id)
            .order_by(db_images.c.patient_id, db_images.c.visit_date, db_images.c.uploaded_at)
        )
        with DATA_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(query).mappings().all()
        return [dict(row) for row in rows]

    def get_image(self, image_id: str) -> dict[str, Any] | None:
        query = select(db_images).where(and_(db_images.c.site_id == self.site_id, db_images.c.image_id == image_id))
        with DATA_PLANE_ENGINE.begin() as conn:
            row = conn.execute(query).mappings().first()
        return dict(row) if row else None

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
            "uploaded_at": utc_now(),
        }
        with DATA_PLANE_ENGINE.begin() as conn:
            conn.execute(db_images.insert().values(**image_record))
        return image_record

    def delete_images_for_visit(self, patient_id: str, visit_date: str) -> int:
        existing_images = self.list_images_for_visit(patient_id, visit_date)
        for image in existing_images:
            image_path = Path(str(image.get("image_path") or ""))
            if image_path.exists():
                image_path.unlink(missing_ok=True)
        with DATA_PLANE_ENGINE.begin() as conn:
            conn.execute(
                delete(db_images).where(
                    and_(
                        db_images.c.site_id == self.site_id,
                        db_images.c.patient_id == patient_id,
                        db_images.c.visit_date == visit_date,
                    )
                )
            )
        return len(existing_images)

    def delete_visit(self, patient_id: str, visit_date: str) -> dict[str, Any]:
        existing_visit = self.get_visit(patient_id, visit_date)
        if existing_visit is None:
            raise ValueError(f"Visit {patient_id} / {visit_date} does not exist.")

        deleted_images = self.delete_images_for_visit(patient_id, visit_date)
        with DATA_PLANE_ENGINE.begin() as conn:
            conn.execute(
                delete(db_visits).where(
                    and_(
                        db_visits.c.site_id == self.site_id,
                        db_visits.c.patient_id == patient_id,
                        db_visits.c.visit_date == visit_date,
                    )
                )
            )

        remaining_visits = self.list_visits_for_patient(patient_id)
        deleted_patient = False
        if not remaining_visits:
            with DATA_PLANE_ENGINE.begin() as conn:
                conn.execute(
                    delete(db_patients).where(
                        and_(
                            db_patients.c.site_id == self.site_id,
                            db_patients.c.patient_id == patient_id,
                        )
                    )
                )
            deleted_patient = True

        return {
            "patient_id": patient_id,
            "visit_date": visit_date,
            "deleted_images": deleted_images,
            "deleted_patient": deleted_patient,
            "remaining_visit_count": len(remaining_visits),
        }

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
        with DATA_PLANE_ENGINE.begin() as conn:
            conn.execute(
                update(db_images)
                .where(and_(db_images.c.site_id == self.site_id, db_images.c.image_id == image_id))
                .values(lesion_prompt_box=lesion_prompt_box)
            )
        refreshed = self.get_image(image_id)
        if refreshed is None:
            raise ValueError("Image not found.")
        return refreshed

    def dataset_records(self) -> list[dict[str, Any]]:
        patient_table = db_patients.alias("p")
        visit_table = db_visits.alias("v")
        image_table = db_images.alias("i")
        query = (
            select(
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
            .where(patient_table.c.site_id == self.site_id)
            .order_by(patient_table.c.patient_id, visit_table.c.visit_index, visit_table.c.visit_date, image_table.c.uploaded_at)
        )
        with DATA_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(query).mappings().all()
        records: list[dict[str, Any]] = []
        for row in rows:
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
                    "image_path": row["image_path"],
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
        query = (
            select(db_images)
            .where(
                and_(
                    db_images.c.site_id == self.site_id,
                    db_images.c.patient_id == patient_id,
                    db_images.c.visit_date == visit_date,
                )
            )
            .order_by(db_images.c.uploaded_at)
        )
        with DATA_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(query).mappings().all()
        return [dict(row) for row in rows]

    def list_case_summaries(self, created_by_user_id: str | None = None) -> list[dict[str, Any]]:
        """Optimized case summaries using a single JOIN query."""
        patient_table = db_patients.alias("p")
        visit_table = db_visits.alias("v")
        image_table = db_images.alias("i")

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
            .where(visit_table.c.site_id == self.site_id)
            .order_by(
                desc(visit_table.c.visit_index),
                desc(image_stats.c.latest_image_uploaded_at),
                desc(visit_table.c.created_at),
            )
        )

        if created_by_user_id:
            query = query.where(patient_table.c.created_by_user_id == created_by_user_id)

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
            .where(visit_table.c.site_id == self.site_id)
            .group_by(visit_table.c.patient_id)
            .subquery("patient_latest")
        )

        # Build search conditions
        search_conditions = []
        if normalized_search:
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
            .where(visit_table.c.site_id == self.site_id)
        )
        if created_by_user_id:
            count_base = count_base.where(patient_table.c.created_by_user_id == created_by_user_id)
        if search_conditions:
            count_base = count_base.where(and_(*search_conditions))

        with DATA_PLANE_ENGINE.begin() as conn:
            total_count = conn.execute(count_base).scalar() or 0

        total_pages = max(1, (total_count + bounded_page_size - 1) // bounded_page_size)
        safe_page = min(safe_page, total_pages) if total_pages > 0 else 1
        offset = (safe_page - 1) * bounded_page_size

        # Main query: get paginated patient IDs with their latest case info
        # First, get distinct patient IDs ordered by their latest activity
        patient_ids_query = (
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
            .where(patient_table.c.site_id == self.site_id)
            .group_by(patient_table.c.patient_id, patient_latest.c.case_count)
        )
        if created_by_user_id:
            patient_ids_query = patient_ids_query.where(patient_table.c.created_by_user_id == created_by_user_id)
        if search_conditions:
            patient_ids_query = patient_ids_query.where(and_(*search_conditions))

        patient_ids_query = (
            patient_ids_query
            .order_by(
                desc(func.coalesce(func.max(image_stats.c.latest_image_uploaded_at), "")),
                desc(func.max(visit_table.c.created_at)),
                desc(func.max(visit_table.c.visit_index)),
            )
            .limit(bounded_page_size)
            .offset(offset)
        )

        with DATA_PLANE_ENGINE.begin() as conn:
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

        # Get full case details for these patients only
        cases_query = (
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
            .where(
                and_(
                    visit_table.c.site_id == self.site_id,
                    visit_table.c.patient_id.in_(patient_ids),
                )
            )
            .order_by(
                desc(image_stats.c.latest_image_uploaded_at),
                desc(visit_table.c.created_at),
                desc(visit_table.c.visit_index),
            )
        )

        with DATA_PLANE_ENGINE.begin() as conn:
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
            rows.append(
                {
                    "patient_id": patient_id,
                    "latest_case": latest_case,
                    "case_count": case_counts.get(patient_id, len(sorted_cases)),
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
                        for item in sorted_cases
                        if item.get("representative_image_id")
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
                .where(
                    and_(
                        db_visits.c.site_id == self.site_id,
                        db_visits.c.patient_id == normalized_patient_id,
                        db_visits.c.visit_date == normalized_visit_date,
                    )
                )
                .values(**values)
            )
        refreshed = self.get_visit(normalized_patient_id, normalized_visit_date)
        if refreshed is None:
            raise ValueError(f"Visit {normalized_patient_id} / {normalized_visit_date} does not exist.")
        return refreshed

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
