from __future__ import annotations

from io import BytesIO
from pathlib import Path
from typing import Any

import pandas as pd
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import and_, delete, select, update

from kera_research.config import BASE_DIR, SITE_ROOT_DIR, ensure_base_directories
from kera_research.db import (
    CONTROL_PLANE_ENGINE,
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
from kera_research.domain import MANIFEST_COLUMNS, VISIT_STATUS_OPTIONS, make_id, utc_now
from kera_research.storage import ensure_dir, write_csv


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


def _sanitize_image_bytes(content: bytes, file_name: str) -> tuple[bytes, str]:
    suffix = Path(file_name).suffix.lower() or ".jpg"
    try:
        with Image.open(BytesIO(content)) as image:
            normalized = ImageOps.exif_transpose(image)
            output = BytesIO()
            format_name = (normalized.format or image.format or "").upper()
            if format_name == "PNG" or suffix == ".png":
                if normalized.mode not in {"RGB", "RGBA", "L"}:
                    normalized = normalized.convert("RGBA" if "A" in normalized.getbands() else "RGB")
                normalized.save(output, format="PNG")
                return output.getvalue(), ".png"

            if normalized.mode not in {"RGB", "L"}:
                normalized = normalized.convert("RGB")
            normalized.save(output, format="JPEG", quality=95, optimize=True)
            return output.getvalue(), ".jpg"
    except (UnidentifiedImageError, OSError, ValueError):
        return content, suffix


def _resolve_site_storage_root(site_id: str) -> Path:
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
        return root_path
    return (SITE_ROOT_DIR / site_id).resolve()


class SiteStore:
    def __init__(self, site_id: str) -> None:
        ensure_base_directories()
        init_control_plane_db()
        init_data_plane_db()
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
        self.validation_dir = self.site_dir / "validation"
        self.update_dir = self.site_dir / "model_updates"
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
            self.validation_dir,
            self.update_dir,
        ):
            ensure_dir(path)

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
        if not patient_id.strip():
            raise ValueError("Patient ID is required.")
        normalized_patient_id = patient_id.strip()
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
            .order_by(db_visits.c.patient_id, db_visits.c.visit_date)
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
        if not self.get_patient(patient_id):
            raise ValueError(f"Patient {patient_id} does not exist.")
        if not culture_confirmed:
            raise ValueError("Only culture-proven keratitis cases are allowed.")
        if self.get_visit(patient_id, visit_date):
            raise ValueError(f"Visit {patient_id} / {visit_date} already exists.")
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
            "patient_id": patient_id,
            "created_by_user_id": created_by_user_id,
            "visit_date": visit_date,
            "actual_visit_date": (actual_visit_date or "").strip() or None,
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
        existing = self.get_visit(patient_id, visit_date)
        if existing is None:
            raise ValueError(f"Visit {patient_id} / {visit_date} does not exist.")
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
            "actual_visit_date": (actual_visit_date or "").strip() or None,
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
    ) -> dict[str, Any]:
        visit = self.get_visit(patient_id, visit_date)
        if visit is None:
            raise ValueError("Visit must exist before image upload.")
        visit_dir = ensure_dir(self.raw_dir / patient_id / visit_date)
        image_id = make_id("image")
        sanitized_content, normalized_suffix = _sanitize_image_bytes(content, file_name)
        destination = visit_dir / f"{image_id}{normalized_suffix}"
        destination.write_bytes(sanitized_content)

        image_record = {
            "image_id": image_id,
            "visit_id": visit["visit_id"],
            "site_id": self.site_id,
            "patient_id": patient_id,
            "visit_date": visit_date,
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
            .order_by(patient_table.c.patient_id, visit_table.c.visit_date, image_table.c.uploaded_at)
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
            .order_by(db_visits.c.visit_date)
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
        patients_by_id = {
            patient["patient_id"]: patient
            for patient in self.list_patients(created_by_user_id=created_by_user_id)
        }
        images_by_visit: dict[tuple[str, str], list[dict[str, Any]]] = {}
        for image in self.list_images():
            images_by_visit.setdefault((image["patient_id"], image["visit_date"]), []).append(image)

        summaries: list[dict[str, Any]] = []
        for visit in self.list_visits():
            patient = patients_by_id.get(visit["patient_id"], {})
            if not patient:
                continue
            visit_images = images_by_visit.get((visit["patient_id"], visit["visit_date"]), [])
            representative = next((image for image in visit_images if image.get("is_representative")), None)
            latest_uploaded_at = visit_images[-1]["uploaded_at"] if visit_images else None
            summaries.append(
                {
                    "case_id": f"{visit['patient_id']}::{visit['visit_date']}",
                    "visit_id": visit["visit_id"],
                    "patient_id": visit["patient_id"],
                    "visit_date": visit["visit_date"],
                    "actual_visit_date": visit.get("actual_visit_date"),
                    "chart_alias": patient.get("chart_alias", ""),
                    "local_case_code": patient.get("local_case_code", ""),
                    "sex": patient.get("sex", ""),
                    "age": patient.get("age"),
                    "culture_category": visit.get("culture_category", ""),
                    "culture_species": visit.get("culture_species", ""),
                    "additional_organisms": visit.get("additional_organisms", []) or [],
                    "contact_lens_use": visit.get("contact_lens_use", ""),
                    "visit_status": visit.get("visit_status", "active"),
                    "is_initial_visit": bool(visit.get("is_initial_visit", False)),
                    "smear_result": visit.get("smear_result", ""),
                    "polymicrobial": bool(
                        visit.get("polymicrobial", False) or (visit.get("additional_organisms", []) or [])
                    ),
                    "image_count": len(visit_images),
                    "representative_image_id": representative["image_id"] if representative else None,
                    "representative_view": representative["view"] if representative else None,
                    "created_by_user_id": patient.get("created_by_user_id"),
                    "created_at": visit.get("created_at"),
                    "latest_image_uploaded_at": latest_uploaded_at,
                }
            )

        summaries.sort(
            key=lambda item: (
                item.get("visit_date") or "",
                item.get("latest_image_uploaded_at") or "",
                item.get("created_at") or "",
            ),
            reverse=True,
        )
        return summaries

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

    def enqueue_job(self, job_type: str, payload: dict[str, Any]) -> dict[str, Any]:
        record = {
            "job_id": make_id("job"),
            "site_id": self.site_id,
            "job_type": job_type,
            "status": "queued",
            "payload_json": payload,
            "result_json": None,
            "created_at": utc_now(),
            "updated_at": None,
        }
        with DATA_PLANE_ENGINE.begin() as conn:
            conn.execute(site_jobs.insert().values(**record))
        return {
            "job_id": record["job_id"],
            "job_type": record["job_type"],
            "status": record["status"],
            "payload": payload,
            "created_at": record["created_at"],
        }

    def list_jobs(self, status: str | None = None) -> list[dict[str, Any]]:
        query = select(site_jobs).where(site_jobs.c.site_id == self.site_id).order_by(site_jobs.c.created_at.desc())
        if status:
            query = query.where(site_jobs.c.status == status)
        with DATA_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(query).mappings().all()
        return [
            {
                "job_id": row["job_id"],
                "job_type": row["job_type"],
                "status": row["status"],
                "payload": row["payload_json"],
                "result": row["result_json"],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            }
            for row in rows
        ]

    def update_job_status(self, job_id: str, status: str, result: dict[str, Any] | None = None) -> None:
        with DATA_PLANE_ENGINE.begin() as conn:
            existing = conn.execute(
                select(site_jobs).where(and_(site_jobs.c.site_id == self.site_id, site_jobs.c.job_id == job_id))
            ).mappings().first()
            if existing is None:
                return
            result_json = result if result is not None else existing["result_json"]
            conn.execute(
                update(site_jobs)
                .where(and_(site_jobs.c.site_id == self.site_id, site_jobs.c.job_id == job_id))
                .values(
                    status=status,
                    result_json=result_json,
                    updated_at=utc_now(),
                )
            )

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
