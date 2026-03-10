from __future__ import annotations

from pathlib import Path
from typing import Any

from kera_research.config import (
    BASE_DIR,
    CONTROL_PLANE_CASE_DIR,
    CONTROL_PLANE_DIR,
    DEFAULT_USERS,
    ensure_base_directories,
)
from kera_research.domain import CULTURE_SPECIES, make_id, utc_now
from kera_research.storage import append_json_record, ensure_dir, read_json, write_json


class ControlPlaneStore:
    def __init__(self, root: Path | None = None) -> None:
        ensure_base_directories()
        self.root = root or CONTROL_PLANE_DIR
        ensure_dir(self.root)
        ensure_dir(CONTROL_PLANE_CASE_DIR)

        self.users_path = self.root / "users.json"
        self.projects_path = self.root / "projects.json"
        self.sites_path = self.root / "sites.json"
        self.organism_catalog_path = self.root / "organism_catalog.json"
        self.organism_requests_path = self.root / "organism_requests.json"
        self.validation_runs_path = self.root / "validation_runs.json"
        self.model_registry_path = self.root / "model_registry.json"
        self.model_updates_path = self.root / "model_updates.json"
        self.aggregations_path = self.root / "aggregations.json"
        self.contributions_path = self.root / "contributions.json"

        self._seed_defaults()

    def _seed_defaults(self) -> None:
        if not self.users_path.exists():
            write_json(self.users_path, DEFAULT_USERS)
        if not self.projects_path.exists():
            write_json(self.projects_path, [])
        if not self.sites_path.exists():
            write_json(self.sites_path, [])
        if not self.organism_catalog_path.exists():
            write_json(self.organism_catalog_path, CULTURE_SPECIES)
        if not self.organism_requests_path.exists():
            write_json(self.organism_requests_path, [])
        if not self.validation_runs_path.exists():
            write_json(self.validation_runs_path, [])
        if not self.model_registry_path.exists():
            write_json(self.model_registry_path, [])
        if not self.model_updates_path.exists():
            write_json(self.model_updates_path, [])
        if not self.aggregations_path.exists():
            write_json(self.aggregations_path, [])
        if not self.contributions_path.exists():
            write_json(self.contributions_path, [])

    def authenticate(self, username: str, password: str) -> dict[str, Any] | None:
        for user in read_json(self.users_path, []):
            if user["username"] == username and user["password"] == password:
                return user
        return None

    def list_projects(self) -> list[dict[str, Any]]:
        return read_json(self.projects_path, [])

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
        append_json_record(self.projects_path, record)
        return record

    def list_sites(self, project_id: str | None = None) -> list[dict[str, Any]]:
        sites = read_json(self.sites_path, [])
        if project_id:
            return [site for site in sites if site["project_id"] == project_id]
        return sites

    def create_site(
        self,
        project_id: str,
        site_code: str,
        display_name: str,
        hospital_name: str,
    ) -> dict[str, Any]:
        normalized_site_code = site_code.strip()
        if not site_code.strip():
            raise ValueError("Site code is required.")
        if not display_name.strip():
            raise ValueError("Site display name is required.")
        record = {
            "site_id": normalized_site_code,
            "project_id": project_id,
            "display_name": display_name.strip(),
            "hospital_name": hospital_name.strip(),
            "local_storage_root": f"storage/sites/{normalized_site_code}",
            "created_at": utc_now(),
        }
        sites = read_json(self.sites_path, [])
        if any(site["site_id"] == normalized_site_code for site in sites):
            raise ValueError(f"Site {normalized_site_code} already exists.")
        sites.append(record)
        write_json(self.sites_path, sites)

        projects = read_json(self.projects_path, [])
        for project in projects:
            if project["project_id"] == project_id:
                project.setdefault("site_ids", []).append(normalized_site_code)
                break
        write_json(self.projects_path, projects)
        return record

    def list_organisms(self, category: str | None = None) -> list[str] | dict[str, list[str]]:
        catalog = read_json(self.organism_catalog_path, CULTURE_SPECIES)
        if category:
            return catalog.get(category, [])
        return catalog

    def request_new_organism(
        self,
        culture_category: str,
        requested_species: str,
        requested_by: str,
    ) -> dict[str, Any]:
        request_record = {
            "request_id": make_id("organism"),
            "culture_category": culture_category,
            "requested_species": requested_species,
            "requested_by": requested_by,
            "status": "pending",
            "reviewed_by": None,
            "created_at": utc_now(),
        }
        append_json_record(self.organism_requests_path, request_record)
        return request_record

    def list_organism_requests(self, status: str | None = None) -> list[dict[str, Any]]:
        requests = read_json(self.organism_requests_path, [])
        if status:
            return [item for item in requests if item["status"] == status]
        return requests

    def approve_organism(self, request_id: str, approver_user_id: str) -> dict[str, Any]:
        requests = read_json(self.organism_requests_path, [])
        catalog = read_json(self.organism_catalog_path, CULTURE_SPECIES)
        approved_request = None

        for request_record in requests:
            if request_record["request_id"] == request_id:
                request_record["status"] = "approved"
                request_record["reviewed_by"] = approver_user_id
                request_record["reviewed_at"] = utc_now()
                approved_request = request_record
                species_list = catalog.setdefault(request_record["culture_category"], [])
                if request_record["requested_species"] not in species_list:
                    species_list.append(request_record["requested_species"])
                    species_list.sort()
                break

        if approved_request is None:
            raise ValueError(f"Unknown request_id: {request_id}")

        write_json(self.organism_requests_path, requests)
        write_json(self.organism_catalog_path, catalog)
        return approved_request

    def list_validation_runs(
        self,
        project_id: str | None = None,
        site_id: str | None = None,
    ) -> list[dict[str, Any]]:
        runs = read_json(self.validation_runs_path, [])
        if project_id:
            runs = [run for run in runs if run.get("project_id") == project_id]
        if site_id:
            runs = [run for run in runs if run.get("site_id") == site_id]
        return runs

    def save_validation_run(
        self,
        summary: dict[str, Any],
        case_predictions: list[dict[str, Any]],
    ) -> dict[str, Any]:
        case_path = CONTROL_PLANE_CASE_DIR / f"{summary['validation_id']}.json"
        write_json(case_path, case_predictions)
        payload = {
            **summary,
            "case_predictions_path": str(case_path.relative_to(BASE_DIR)),
        }
        append_json_record(self.validation_runs_path, payload)
        return payload

    def load_case_predictions(self, validation_id: str) -> list[dict[str, Any]]:
        case_path = CONTROL_PLANE_CASE_DIR / f"{validation_id}.json"
        return read_json(case_path, [])

    def list_model_versions(self) -> list[dict[str, Any]]:
        return read_json(self.model_registry_path, [])

    def ensure_model_version(self, model_metadata: dict[str, Any]) -> dict[str, Any]:
        versions = read_json(self.model_registry_path, [])
        for index, item in enumerate(versions):
            if item["version_id"] == model_metadata["version_id"]:
                merged = {**item, **model_metadata}
                versions[index] = merged
                if merged.get("stage") == "global" and merged.get("ready", True) and merged.get("is_current"):
                    for other_index, other in enumerate(versions):
                        if other_index == index:
                            continue
                        if other.get("stage") == "global":
                            versions[other_index] = {**other, "is_current": False}
                write_json(self.model_registry_path, versions)
                return merged
        if model_metadata.get("stage") == "global" and model_metadata.get("ready", True) and model_metadata.get("is_current"):
            versions = [
                {**item, "is_current": False} if item.get("stage") == "global" else item
                for item in versions
            ]
        versions.append(model_metadata)
        write_json(self.model_registry_path, versions)
        return model_metadata

    def current_global_model(self) -> dict[str, Any] | None:
        versions = [
            item
            for item in self.list_model_versions()
            if item.get("stage") == "global" and item.get("ready", True)
        ]
        if not versions:
            return None
        current_versions = [item for item in versions if item.get("is_current")]
        if current_versions:
            return sorted(current_versions, key=lambda item: item["created_at"])[-1]
        return sorted(versions, key=lambda item: item["created_at"])[-1]

    def register_model_update(self, update_metadata: dict[str, Any]) -> dict[str, Any]:
        append_json_record(self.model_updates_path, update_metadata)
        return update_metadata

    def list_model_updates(self, site_id: str | None = None) -> list[dict[str, Any]]:
        updates = read_json(self.model_updates_path, [])
        if site_id:
            return [item for item in updates if item.get("site_id") == site_id]
        return updates

    def register_contribution(self, contribution: dict[str, Any]) -> dict[str, Any]:
        append_json_record(self.contributions_path, contribution)
        return contribution

    def list_contributions(self, user_id: str | None = None, site_id: str | None = None) -> list[dict[str, Any]]:
        contribs = read_json(self.contributions_path, [])
        if user_id:
            contribs = [c for c in contribs if c.get("user_id") == user_id]
        if site_id:
            contribs = [c for c in contribs if c.get("site_id") == site_id]
        return contribs

    def get_contribution_stats(self, user_id: str | None = None) -> dict[str, Any]:
        all_contribs = read_json(self.contributions_path, [])
        total = len(all_contribs)
        user_contribs = [c for c in all_contribs if c.get("user_id") == user_id] if user_id else []
        user_total = len(user_contribs)
        pct = round(user_total / total * 100, 1) if total > 0 else 0.0
        current_model = self.current_global_model()
        return {
            "total_contributions": total,
            "user_contributions": user_total,
            "user_contribution_pct": pct,
            "current_model_version": current_model["version_name"] if current_model else "—",
        }

    def register_aggregation(
        self,
        base_model_version_id: str,
        new_model_path: str,
        new_version_name: str,
        architecture: str,
        site_weights: dict[str, int],
        requires_medsam_crop: bool = False,
    ) -> dict[str, Any]:
        from kera_research.domain import make_id, utc_now
        agg_id = make_id("agg")
        record = {
            "aggregation_id": agg_id,
            "base_model_version_id": base_model_version_id,
            "new_version_name": new_version_name,
            "architecture": architecture,
            "site_weights": site_weights,
            "total_cases": sum(site_weights.values()),
            "created_at": utc_now(),
        }
        append_json_record(self.aggregations_path, record)
        new_version = {
            "version_id": make_id("model"),
            "version_name": new_version_name,
            "architecture": architecture,
            "stage": "global",
            "base_version_id": base_model_version_id,
            "model_path": new_model_path,
            "created_at": utc_now(),
            "aggregation_id": agg_id,
            "requires_medsam_crop": bool(requires_medsam_crop),
            "training_input_policy": "medsam_roi_crop_only" if requires_medsam_crop else "raw_or_model_defined",
            "is_current": True,
            "ready": True,
            "notes": f"Federated aggregation of {len(site_weights)} site(s), {sum(site_weights.values())} cases.",
            "notes_ko": f"{len(site_weights)}개 기관, {sum(site_weights.values())}케이스 federated 집계 모델.",
            "notes_en": f"Federated aggregation of {len(site_weights)} site(s), {sum(site_weights.values())} cases.",
        }
        self.ensure_model_version(new_version)
        return record
