from __future__ import annotations

from pathlib import Path
import re
import shutil
from typing import Any, Callable

import requests
from sqlalchemy import select, update

from kera_research.config import CONTROL_PLANE_CASE_DIR
from kera_research.db import CONTROL_PLANE_ENGINE, DATA_PLANE_ENGINE, images as db_images, model_updates, projects, sites
from kera_research.domain import make_id, utc_now
from kera_research.services.data_plane import invalidate_site_storage_root_cache
from kera_research.storage import read_json, write_json

SOURCE_INSTITUTION_ID_UNSET = object()


class ControlPlaneWorkspaceOps:
    def __init__(
        self,
        store: Any,
        *,
        site_id_pattern: re.Pattern[str],
        payload_record: Callable[[Any, str, list[str]], dict[str, Any]],
        replace_path_prefix_in_value: Callable[[Any, Path, Path], Any],
        sanitize_remote_payload: Callable[[Any], Any],
    ) -> None:
        self.store = store
        self.site_id_pattern = site_id_pattern
        self.payload_record = payload_record
        self.replace_path_prefix_in_value = replace_path_prefix_in_value
        self.sanitize_remote_payload = sanitize_remote_payload

    def list_projects(self) -> list[dict[str, Any]]:
        with CONTROL_PLANE_ENGINE.begin() as conn:
            return [dict(row) for row in conn.execute(select(projects).order_by(projects.c.created_at)).mappings().all()]

    def create_project(self, name: str, description: str, owner_user_id: str) -> dict[str, Any]:
        if not name.strip():
            raise ValueError("Project name is required.")
        record = {
            "project_id": make_id("project"),
            "name": name.strip(),
            "description": description,
            "owner_user_id": owner_user_id,
            "site_ids": [],
            "created_at": utc_now(),
        }
        with CONTROL_PLANE_ENGINE.begin() as conn:
            conn.execute(projects.insert().values(**record))
        return record

    def list_sites(self, project_id: str | None = None) -> list[dict[str, Any]]:
        query = select(sites)
        if project_id:
            query = query.where(sites.c.project_id == project_id)
        query = query.order_by(sites.c.display_name)
        with CONTROL_PLANE_ENGINE.begin() as conn:
            return [dict(row) for row in conn.execute(query).mappings().all()]

    def get_site(self, site_id: str) -> dict[str, Any] | None:
        normalized_site_id = site_id.strip()
        if not normalized_site_id:
            return None
        with CONTROL_PLANE_ENGINE.begin() as conn:
            row = conn.execute(select(sites).where(sites.c.site_id == normalized_site_id)).mappings().first()
        return dict(row) if row else None

    def get_site_by_source_institution_id(self, source_institution_id: str) -> dict[str, Any] | None:
        normalized_source_institution_id = source_institution_id.strip()
        if not normalized_source_institution_id:
            return None
        with CONTROL_PLANE_ENGINE.begin() as conn:
            row = conn.execute(
                select(sites).where(sites.c.source_institution_id == normalized_source_institution_id)
            ).mappings().first()
        return dict(row) if row else None

    def create_site(
        self,
        project_id: str,
        site_code: str | None = None,
        display_name: str | None = None,
        hospital_name: str = "",
        source_institution_id: str | None = None,
        research_registry_enabled: bool = True,
    ) -> dict[str, Any]:
        normalized_source_institution_id = str(source_institution_id or "").strip() or None
        requested_site_code = str(site_code or "").strip()
        normalized_hospital_name = hospital_name.strip() or str(display_name or "").strip()
        normalized_display_name = str(display_name or "").strip() or normalized_hospital_name
        if not normalized_hospital_name:
            raise ValueError("Site hospital name is required.")
        record = {
            "site_id": "",
            "project_id": project_id,
            "display_name": normalized_display_name,
            "hospital_name": normalized_hospital_name,
            "source_institution_id": normalized_source_institution_id,
            "local_storage_root": "",
            "research_registry_enabled": bool(research_registry_enabled),
            "created_at": utc_now(),
        }
        with CONTROL_PLANE_ENGINE.begin() as conn:
            if normalized_source_institution_id:
                existing_institution_site = conn.execute(
                    select(sites.c.site_id).where(sites.c.source_institution_id == normalized_source_institution_id)
                ).first()
                if existing_institution_site:
                    raise ValueError(
                        f"Institution {normalized_source_institution_id} is already linked to site {existing_institution_site.site_id}."
                    )
            project_row = conn.execute(select(projects).where(projects.c.project_id == project_id)).mappings().first()
            if project_row is None:
                raise ValueError(f"Unknown project_id: {project_id}")
            if requested_site_code:
                normalized_site_code = requested_site_code
                existing_site = conn.execute(select(sites.c.site_id).where(sites.c.site_id == normalized_site_code)).first()
                if existing_site:
                    raise ValueError(f"Site {normalized_site_code} already exists.")
            else:
                normalized_site_code = make_id("site")
                for _ in range(10):
                    existing_site = conn.execute(select(sites.c.site_id).where(sites.c.site_id == normalized_site_code)).first()
                    if not existing_site:
                        break
                    normalized_site_code = make_id("site")
                else:
                    raise ValueError("Unable to allocate a site_id.")
            record["site_id"] = normalized_site_code
            record["local_storage_root"] = str(Path(self.store.instance_storage_root()) / normalized_site_code)
            conn.execute(sites.insert().values(**record))
            project_site_ids = list(project_row["site_ids"] or [])
            if normalized_site_code not in project_site_ids:
                project_site_ids.append(normalized_site_code)
            conn.execute(
                update(projects)
                .where(projects.c.project_id == project_id)
                .values(site_ids=project_site_ids)
            )
        return record

    def update_site_metadata(
        self,
        site_id: str,
        display_name: str | None = None,
        hospital_name: str = "",
        source_institution_id: str | None | object = SOURCE_INSTITUTION_ID_UNSET,
        research_registry_enabled: bool | None = None,
    ) -> dict[str, Any]:
        normalized_site_id = site_id.strip()
        normalized_hospital_name = hospital_name.strip()
        if not normalized_site_id:
            raise ValueError("Site code is required.")

        with CONTROL_PLANE_ENGINE.begin() as conn:
            existing_site = conn.execute(select(sites).where(sites.c.site_id == normalized_site_id)).mappings().first()
            if existing_site is None:
                raise ValueError(f"Unknown site_id: {normalized_site_id}")
            normalized_display_name = (
                str(display_name or "").strip()
                or normalized_hospital_name
                or str(existing_site.get("hospital_name") or "").strip()
                or str(existing_site.get("display_name") or "").strip()
                or normalized_site_id
            )
            normalized_hospital_name = normalized_hospital_name or normalized_display_name
            current_source_institution_id = str(existing_site.get("source_institution_id") or "").strip() or None
            values: dict[str, Any] = {
                "display_name": normalized_display_name,
                "hospital_name": normalized_hospital_name,
            }
            if source_institution_id is not SOURCE_INSTITUTION_ID_UNSET:
                normalized_source_institution_id = str(source_institution_id or "").strip() or None
                if normalized_source_institution_id and normalized_source_institution_id != current_source_institution_id:
                    existing_institution_site = conn.execute(
                        select(sites.c.site_id).where(sites.c.source_institution_id == normalized_source_institution_id)
                    ).first()
                    if existing_institution_site and existing_institution_site.site_id != normalized_site_id:
                        raise ValueError(
                            f"Institution {normalized_source_institution_id} is already linked to site {existing_institution_site.site_id}."
                        )
                values["source_institution_id"] = normalized_source_institution_id
            if research_registry_enabled is not None:
                values["research_registry_enabled"] = bool(research_registry_enabled)
            conn.execute(
                update(sites)
                .where(sites.c.site_id == normalized_site_id)
                .values(**values)
            )

        return self.get_site(normalized_site_id) or {
            "site_id": normalized_site_id,
            "display_name": normalized_display_name,
            "hospital_name": normalized_hospital_name,
            "source_institution_id": values.get("source_institution_id", current_source_institution_id),
            "research_registry_enabled": bool(research_registry_enabled) if research_registry_enabled is not None else True,
        }

    def _ensure_local_site_record(self, site_id: str) -> dict[str, Any]:
        normalized_site_id = site_id.strip()
        existing_site = self.get_site(normalized_site_id)
        if existing_site is not None:
            return existing_site

        merged_site = self.store.get_site(normalized_site_id)
        if merged_site is None:
            raise ValueError(f"Unknown site_id: {normalized_site_id}")

        record = {
            "site_id": normalized_site_id,
            "project_id": str(merged_site.get("project_id") or "project_default").strip() or "project_default",
            "display_name": str(merged_site.get("display_name") or normalized_site_id).strip() or normalized_site_id,
            "hospital_name": str(
                merged_site.get("hospital_name") or merged_site.get("display_name") or normalized_site_id
            ).strip()
            or normalized_site_id,
            "source_institution_id": str(merged_site.get("source_institution_id") or "").strip() or None,
            "local_storage_root": str(merged_site.get("local_storage_root") or "").strip(),
            "research_registry_enabled": bool(merged_site.get("research_registry_enabled", True)),
            "created_at": str(merged_site.get("created_at") or utc_now()),
        }
        with CONTROL_PLANE_ENGINE.begin() as conn:
            conn.execute(sites.insert().values(**record))
        return self.get_site(normalized_site_id) or record

    def update_site_storage_root(self, site_id: str, storage_root: str) -> dict[str, Any]:
        normalized_site_id = site_id.strip()
        normalized_storage_root = storage_root.strip()
        if not normalized_site_id:
            raise ValueError("Site code is required.")
        if not normalized_storage_root:
            raise ValueError("Storage root is required.")

        self._ensure_local_site_record(normalized_site_id)
        with CONTROL_PLANE_ENGINE.begin() as conn:
            existing_site = conn.execute(
                select(sites).where(sites.c.site_id == normalized_site_id)
            ).mappings().first()
            if existing_site is None:
                raise ValueError(f"Unknown site_id: {normalized_site_id}")
            conn.execute(
                update(sites)
                .where(sites.c.site_id == normalized_site_id)
                .values(local_storage_root=normalized_storage_root)
            )
        invalidate_site_storage_root_cache(normalized_site_id)
        return self.get_site(normalized_site_id) or {
            "site_id": normalized_site_id,
            "local_storage_root": normalized_storage_root,
        }

    def migrate_site_storage_root(self, site_id: str, storage_root: str) -> dict[str, Any]:
        normalized_site_id = site_id.strip()
        normalized_storage_root = str(Path(storage_root).expanduser().resolve())
        if not normalized_site_id:
            raise ValueError("Site code is required.")
        if not normalized_storage_root:
            raise ValueError("Storage root is required.")

        self._ensure_local_site_record(normalized_site_id)
        site = self.get_site(normalized_site_id)
        if site is None:
            raise ValueError(f"Unknown site_id: {normalized_site_id}")

        old_root = Path(self.store.site_storage_root(normalized_site_id)).resolve()
        new_root = Path(normalized_storage_root).resolve()
        if old_root == new_root:
            return site

        new_root.parent.mkdir(parents=True, exist_ok=True)
        if new_root.exists() and any(new_root.iterdir()):
            raise ValueError("Target storage root already exists and is not empty.")
        if new_root.exists() and not any(new_root.iterdir()):
            new_root.rmdir()

        if old_root.exists():
            shutil.move(str(old_root), str(new_root))
        else:
            new_root.mkdir(parents=True, exist_ok=True)

        with DATA_PLANE_ENGINE.begin() as conn:
            image_rows = conn.execute(
                select(db_images.c.image_id, db_images.c.image_path).where(db_images.c.site_id == normalized_site_id)
            ).mappings().all()
            for row in image_rows:
                rewritten_path = self.replace_path_prefix_in_value(row["image_path"], old_root, new_root)
                conn.execute(
                    update(db_images)
                    .where(db_images.c.image_id == row["image_id"])
                    .values(image_path=rewritten_path)
                )

        validation_run_rows = self.list_validation_runs(site_id=normalized_site_id)
        for run in validation_run_rows:
            validation_id = str(run.get("validation_id") or "").strip()
            if not validation_id:
                continue
            predictions = self.load_case_predictions(validation_id)
            rewritten_predictions = self.replace_path_prefix_in_value(predictions, old_root, new_root)
            write_json(CONTROL_PLANE_CASE_DIR / f"{validation_id}.json", rewritten_predictions)

        with CONTROL_PLANE_ENGINE.begin() as conn:
            update_rows = conn.execute(
                select(model_updates).where(model_updates.c.site_id == normalized_site_id)
            ).all()
            for row in update_rows:
                payload = self.payload_record(
                    row,
                    "payload_json",
                    ["update_id", "site_id", "architecture", "status", "created_at"],
                )
                rewritten_payload = self.replace_path_prefix_in_value(payload, old_root, new_root)
                conn.execute(
                    update(model_updates)
                    .where(model_updates.c.update_id == row._mapping["update_id"])
                    .values(
                        site_id=rewritten_payload.get("site_id"),
                        architecture=rewritten_payload.get("architecture"),
                        status=rewritten_payload.get("status"),
                        created_at=rewritten_payload.get("created_at"),
                        payload_json=rewritten_payload,
                    )
                )

            conn.execute(
                update(sites)
                .where(sites.c.site_id == normalized_site_id)
                .values(local_storage_root=str(new_root))
            )
        invalidate_site_storage_root_cache(normalized_site_id)

        validation_dir = new_root / "validation"
        if validation_dir.exists():
            for report_path in validation_dir.glob("*.json"):
                report = read_json(report_path, {})
                if isinstance(report, dict):
                    write_json(report_path, self.replace_path_prefix_in_value(report, old_root, new_root))

        return self.get_site(normalized_site_id) or {
            "site_id": normalized_site_id,
            "local_storage_root": str(new_root),
        }

    def list_validation_runs(
        self,
        project_id: str | None = None,
        site_id: str | None = None,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        return self.store.list_validation_runs(project_id, site_id, limit=limit)

    def save_validation_run(
        self,
        summary: dict[str, Any],
        case_predictions: list[dict[str, Any]],
    ) -> dict[str, Any]:
        saved_summary = self.store.save_validation_run(summary, case_predictions)
        if self.store.remote_node_sync_enabled():
            try:
                remote_summary = self.store.remote_control_plane.upload_validation_run(
                    summary_json=self.sanitize_remote_payload(saved_summary),
                )
                saved_summary["control_plane_source"] = "remote"
                saved_summary["remote_validation_id"] = str(
                    remote_summary.get("validation_id") or saved_summary.get("validation_id") or ""
                ).strip() or None
            except (requests.RequestException, RuntimeError) as exc:
                saved_summary["control_plane_source"] = "local_fallback"
                saved_summary["remote_sync_error"] = str(exc)
        return saved_summary

    def list_validation_cases(
        self,
        *,
        validation_id: str | None = None,
        site_id: str | None = None,
        patient_reference_id: str | None = None,
        case_reference_id: str | None = None,
    ) -> list[dict[str, Any]]:
        return self.store.list_validation_cases(
            validation_id=validation_id,
            site_id=site_id,
            patient_reference_id=patient_reference_id,
            case_reference_id=case_reference_id,
        )

    def load_case_predictions(self, validation_id: str) -> list[dict[str, Any]]:
        return self.store.load_case_predictions(validation_id)

    def save_experiment(self, experiment_record: dict[str, Any]) -> dict[str, Any]:
        return self.store.save_experiment(experiment_record)

    def get_experiment(self, experiment_id: str) -> dict[str, Any] | None:
        return self.store.get_experiment(experiment_id)

    def list_experiments(
        self,
        *,
        site_id: str | None = None,
        experiment_type: str | None = None,
        status_filter: str | None = None,
    ) -> list[dict[str, Any]]:
        return self.store.list_experiments(
            site_id=site_id,
            experiment_type=experiment_type,
            status_filter=status_filter,
        )
