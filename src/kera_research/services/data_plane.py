from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd

from kera_research.config import SITE_ROOT_DIR, ensure_base_directories
from kera_research.domain import MANIFEST_COLUMNS, make_id, utc_now
from kera_research.storage import ensure_dir, read_csv, read_json, write_csv, write_json


class SiteStore:
    def __init__(self, site_id: str) -> None:
        ensure_base_directories()
        self.site_id = site_id
        self.site_dir = SITE_ROOT_DIR / site_id
        self.raw_dir = self.site_dir / "data" / "raw"
        self.manifest_dir = self.site_dir / "manifests"
        self.manifest_path = self.manifest_dir / "dataset_manifest.csv"
        self.artifact_dir = self.site_dir / "artifacts"
        self.gradcam_dir = self.artifact_dir / "gradcam"
        self.medsam_mask_dir = self.artifact_dir / "medsam_masks"
        self.roi_crop_dir = self.artifact_dir / "roi_crops"
        self.validation_dir = self.site_dir / "validation"
        self.update_dir = self.site_dir / "model_updates"
        self.job_path = self.site_dir / "background_jobs.json"

        self.patients_path = self.site_dir / "patients.json"
        self.visits_path = self.site_dir / "visits.json"
        self.images_path = self.site_dir / "images.json"

        self._seed_defaults()

    def _seed_defaults(self) -> None:
        for path in (
            self.raw_dir,
            self.manifest_dir,
            self.gradcam_dir,
            self.medsam_mask_dir,
            self.roi_crop_dir,
            self.validation_dir,
            self.update_dir,
        ):
            ensure_dir(path)
        for path in (self.patients_path, self.visits_path, self.images_path, self.job_path):
            if not path.exists():
                write_json(path, [])

    def list_patients(self) -> list[dict[str, Any]]:
        return read_json(self.patients_path, [])

    def get_patient(self, patient_id: str) -> dict[str, Any] | None:
        return next((item for item in self.list_patients() if item["patient_id"] == patient_id), None)

    def create_patient(self, patient_id: str, sex: str, age: int) -> dict[str, Any]:
        if not patient_id.strip():
            raise ValueError("Patient ID is required.")
        patients = self.list_patients()
        normalized_patient_id = patient_id.strip()
        if any(item["patient_id"] == normalized_patient_id for item in patients):
            raise ValueError(f"Patient {normalized_patient_id} already exists.")
        record = {
            "patient_id": normalized_patient_id,
            "sex": sex,
            "age": int(age),
            "created_at": utc_now(),
        }
        patients.append(record)
        write_json(self.patients_path, patients)
        return record

    def list_visits(self) -> list[dict[str, Any]]:
        return read_json(self.visits_path, [])

    def get_visit(self, patient_id: str, visit_date: str) -> dict[str, Any] | None:
        for visit in self.list_visits():
            if visit["patient_id"] == patient_id and visit["visit_date"] == visit_date:
                return visit
        return None

    def create_visit(
        self,
        patient_id: str,
        visit_date: str,
        culture_confirmed: bool,
        culture_category: str,
        culture_species: str,
        contact_lens_use: str,
        predisposing_factor: list[str],
        other_history: str,
        active_stage: bool = True,
    ) -> dict[str, Any]:
        if not self.get_patient(patient_id):
            raise ValueError(f"Patient {patient_id} does not exist.")
        if not culture_confirmed:
            raise ValueError("Only culture-proven keratitis cases are allowed.")
        if self.get_visit(patient_id, visit_date):
            raise ValueError(f"Visit {patient_id} / {visit_date} already exists.")
        record = {
            "visit_id": make_id("visit"),
            "patient_id": patient_id,
            "visit_date": visit_date,
            "culture_confirmed": bool(culture_confirmed),
            "culture_category": culture_category,
            "culture_species": culture_species,
            "contact_lens_use": contact_lens_use,
            "predisposing_factor": predisposing_factor,
            "other_history": other_history,
            "active_stage": bool(active_stage),
            "created_at": utc_now(),
        }
        visits = self.list_visits()
        visits.append(record)
        write_json(self.visits_path, visits)
        return record

    def list_images(self) -> list[dict[str, Any]]:
        return read_json(self.images_path, [])

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
        destination = visit_dir / f"{image_id}_{Path(file_name).name}"
        destination.write_bytes(content)

        image_record = {
            "image_id": image_id,
            "visit_id": visit["visit_id"],
            "patient_id": patient_id,
            "visit_date": visit_date,
            "view": view,
            "image_path": str(destination),
            "is_representative": bool(is_representative),
            "uploaded_at": utc_now(),
        }
        images = self.list_images()
        images.append(image_record)
        write_json(self.images_path, images)
        return image_record

    def update_representative_flags(self, updates: dict[str, bool]) -> None:
        images = self.list_images()
        for image in images:
            if image["image_id"] in updates:
                image["is_representative"] = bool(updates[image["image_id"]])
        write_json(self.images_path, images)

    def dataset_records(self) -> list[dict[str, Any]]:
        patients = {item["patient_id"]: item for item in self.list_patients()}
        visits = {(item["patient_id"], item["visit_date"]): item for item in self.list_visits()}
        records: list[dict[str, Any]] = []

        for image in self.list_images():
            patient = patients.get(image["patient_id"])
            visit = visits.get((image["patient_id"], image["visit_date"]))
            if not patient or not visit:
                continue
            records.append(
                {
                    "patient_id": patient["patient_id"],
                    "sex": patient["sex"],
                    "age": patient["age"],
                    "visit_date": visit["visit_date"],
                    "culture_confirmed": visit["culture_confirmed"],
                    "culture_category": visit["culture_category"],
                    "culture_species": visit["culture_species"],
                    "contact_lens_use": visit["contact_lens_use"],
                    "predisposing_factor": "|".join(visit.get("predisposing_factor", [])),
                    "active_stage": visit.get("active_stage", True),
                    "view": image["view"],
                    "image_path": image["image_path"],
                    "is_representative": image["is_representative"],
                }
            )
        return records

    def list_visits_for_patient(self, patient_id: str) -> list[dict[str, Any]]:
        return [v for v in self.list_visits() if v["patient_id"] == patient_id]

    def list_images_for_visit(self, patient_id: str, visit_date: str) -> list[dict[str, Any]]:
        return [
            img for img in self.list_images()
            if img["patient_id"] == patient_id and img["visit_date"] == visit_date
        ]

    def generate_manifest(self) -> pd.DataFrame:
        data_frame = pd.DataFrame(self.dataset_records(), columns=MANIFEST_COLUMNS)
        write_csv(self.manifest_path, data_frame)
        return data_frame

    def load_manifest(self) -> pd.DataFrame:
        if not self.manifest_path.exists():
            return self.generate_manifest()
        return read_csv(self.manifest_path)

    def enqueue_job(self, job_type: str, payload: dict[str, Any]) -> dict[str, Any]:
        jobs = read_json(self.job_path, [])
        record = {
            "job_id": make_id("job"),
            "job_type": job_type,
            "status": "queued",
            "payload": payload,
            "created_at": utc_now(),
        }
        jobs.append(record)
        write_json(self.job_path, jobs)
        return record

    def list_jobs(self, status: str | None = None) -> list[dict[str, Any]]:
        jobs = read_json(self.job_path, [])
        if status:
            return [job for job in jobs if job["status"] == status]
        return jobs

    def update_job_status(self, job_id: str, status: str, result: dict[str, Any] | None = None) -> None:
        jobs = read_json(self.job_path, [])
        for job in jobs:
            if job["job_id"] == job_id:
                job["status"] = status
                job["updated_at"] = utc_now()
                if result is not None:
                    job["result"] = result
                break
        write_json(self.job_path, jobs)

    def artifact_files(self, artifact_type: str) -> list[Path]:
        mapping = {
            "gradcam": self.gradcam_dir,
            "medsam_mask": self.medsam_mask_dir,
            "roi_crop": self.roi_crop_dir,
        }
        directory = mapping[artifact_type]
        return sorted(directory.glob("*"))
