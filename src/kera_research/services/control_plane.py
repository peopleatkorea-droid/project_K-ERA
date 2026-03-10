from __future__ import annotations

from pathlib import Path
from typing import Any

from sqlalchemy import and_, select, update

from kera_research.config import BASE_DIR, CONTROL_PLANE_CASE_DIR, CONTROL_PLANE_DIR, DEFAULT_USERS, ensure_base_directories
from kera_research.db import (
    ENGINE,
    access_requests,
    aggregations,
    contributions,
    init_db,
    model_updates,
    model_versions,
    organism_catalog,
    organism_requests,
    projects,
    sites,
    users,
    validation_runs,
)
from kera_research.domain import CULTURE_SPECIES, make_id, utc_now
from kera_research.storage import ensure_dir, read_json, write_json

GOOGLE_AUTH_SENTINEL = "__google__"


def _row_to_dict(row: Any) -> dict[str, Any]:
    return dict(row._mapping)


def _payload_record(row: Any, payload_key: str, extra_keys: list[str]) -> dict[str, Any]:
    mapping = row._mapping
    payload = dict(mapping[payload_key] or {})
    for key in extra_keys:
        if key not in payload and mapping.get(key) is not None:
            payload[key] = mapping.get(key)
    return payload


class ControlPlaneStore:
    def __init__(self, root: Path | None = None) -> None:
        ensure_base_directories()
        init_db()
        self.root = root or CONTROL_PLANE_DIR
        ensure_dir(self.root)
        ensure_dir(CONTROL_PLANE_CASE_DIR)
        self._seed_defaults()

    def _seed_defaults(self) -> None:
        with ENGINE.begin() as conn:
            existing_users = {row.username for row in conn.execute(select(users.c.username))}
            for user_record in DEFAULT_USERS:
                if user_record["username"] not in existing_users:
                    conn.execute(users.insert().values(**user_record))

            catalog_count = conn.execute(select(organism_catalog.c.catalog_id)).first()
            if catalog_count is None:
                for category, species_list in CULTURE_SPECIES.items():
                    for species_name in species_list:
                        conn.execute(
                            organism_catalog.insert().values(
                                culture_category=category,
                                species_name=species_name,
                            )
                        )

    def authenticate(self, username: str, password: str) -> dict[str, Any] | None:
        query = select(users).where(and_(users.c.username == username, users.c.password == password))
        with ENGINE.begin() as conn:
            row = conn.execute(query).mappings().first()
        if row is None:
            return None
        return self._serialize_user(dict(row))

    def _serialize_user(self, user_record: dict[str, Any]) -> dict[str, Any]:
        serialized = dict(user_record)
        serialized["site_ids"] = serialized["site_ids"] if serialized.get("site_ids") is not None else None
        serialized["approval_status"] = self.user_approval_status(serialized)
        latest_request = self.latest_access_request(serialized["user_id"])
        serialized["latest_access_request"] = latest_request
        return serialized

    def get_user_by_id(self, user_id: str) -> dict[str, Any] | None:
        with ENGINE.begin() as conn:
            row = conn.execute(select(users).where(users.c.user_id == user_id)).mappings().first()
        if row is None:
            return None
        return self._serialize_user(dict(row))

    def get_user_by_username(self, username: str) -> dict[str, Any] | None:
        normalized = username.strip().lower()
        with ENGINE.begin() as conn:
            row = conn.execute(select(users).where(users.c.username == normalized)).mappings().first()
        if row is None:
            return None
        return self._serialize_user(dict(row))

    def list_users(self) -> list[dict[str, Any]]:
        with ENGINE.begin() as conn:
            rows = conn.execute(select(users).order_by(users.c.username)).mappings().all()
        return [self._serialize_user(dict(row)) for row in rows]

    def upsert_user(self, user_record: dict[str, Any]) -> dict[str, Any]:
        normalized = {
            **user_record,
            "username": user_record["username"].strip().lower(),
            "site_ids": list(dict.fromkeys(user_record.get("site_ids", []))),
        }
        with ENGINE.begin() as conn:
            existing = conn.execute(
                select(users).where(
                    (users.c.user_id == normalized["user_id"]) | (users.c.username == normalized["username"])
                )
            ).mappings().first()
            if existing:
                conn.execute(
                    update(users)
                    .where(users.c.user_id == existing["user_id"])
                    .values(**normalized)
                )
            else:
                conn.execute(users.insert().values(**normalized))
        return self.get_user_by_id(normalized["user_id"]) or normalized

    def ensure_google_user(self, email: str, full_name: str) -> dict[str, Any]:
        normalized_email = email.strip().lower()
        existing = self.get_user_by_username(normalized_email)
        if existing:
            if existing.get("full_name") != full_name:
                updated = {**existing, "full_name": full_name}
                return self.upsert_user(updated)
            return existing
        return self.upsert_user(
            {
                "user_id": make_id("user"),
                "username": normalized_email,
                "password": GOOGLE_AUTH_SENTINEL,
                "role": "viewer",
                "full_name": full_name.strip() or normalized_email,
                "site_ids": [],
            }
        )

    def user_approval_status(self, user: dict[str, Any]) -> str:
        if user.get("role") == "admin":
            return "approved"
        if user.get("password") != GOOGLE_AUTH_SENTINEL:
            return "approved"
        if user.get("site_ids"):
            return "approved"
        latest_request = self.latest_access_request(user["user_id"])
        if latest_request is None:
            return "application_required"
        return latest_request.get("status", "application_required")

    def submit_access_request(
        self,
        user_id: str,
        requested_site_id: str,
        requested_role: str,
        message: str = "",
    ) -> dict[str, Any]:
        user = self.get_user_by_id(user_id)
        if user is None:
            raise ValueError(f"Unknown user_id: {user_id}")
        latest_request = self.latest_access_request(user_id)
        if latest_request and latest_request.get("status") == "pending":
            raise ValueError("There is already a pending approval request for this user.")
        request_record = {
            "request_id": make_id("access"),
            "user_id": user_id,
            "email": user["username"],
            "requested_site_id": requested_site_id,
            "requested_role": requested_role,
            "message": message.strip(),
            "status": "pending",
            "reviewed_by": None,
            "reviewer_notes": "",
            "created_at": utc_now(),
            "reviewed_at": None,
        }
        with ENGINE.begin() as conn:
            conn.execute(access_requests.insert().values(**request_record))
        return request_record

    def latest_access_request(self, user_id: str) -> dict[str, Any] | None:
        query = (
            select(access_requests)
            .where(access_requests.c.user_id == user_id)
            .order_by(access_requests.c.created_at.desc())
        )
        with ENGINE.begin() as conn:
            row = conn.execute(query).mappings().first()
        return dict(row) if row else None

    def list_access_requests(
        self,
        status: str | None = None,
        site_ids: list[str] | None = None,
        user_id: str | None = None,
    ) -> list[dict[str, Any]]:
        query = select(access_requests)
        if status:
            query = query.where(access_requests.c.status == status)
        if site_ids is not None:
            query = query.where(access_requests.c.requested_site_id.in_(site_ids))
        if user_id:
            query = query.where(access_requests.c.user_id == user_id)
        query = query.order_by(access_requests.c.created_at.desc())
        with ENGINE.begin() as conn:
            rows = conn.execute(query).mappings().all()
        return [dict(row) for row in rows]

    def review_access_request(
        self,
        request_id: str,
        reviewer_user_id: str,
        decision: str,
        assigned_role: str | None = None,
        assigned_site_id: str | None = None,
        reviewer_notes: str = "",
    ) -> dict[str, Any]:
        with ENGINE.begin() as conn:
            request_row = conn.execute(
                select(access_requests).where(access_requests.c.request_id == request_id)
            ).mappings().first()
            if request_row is None:
                raise ValueError(f"Unknown request_id: {request_id}")
            if request_row["status"] != "pending":
                raise ValueError("Only pending requests can be reviewed.")

            reviewed_at = utc_now()
            decision_value = decision.strip().lower()
            site_id = (assigned_site_id or request_row["requested_site_id"]).strip()
            role_value = (assigned_role or request_row["requested_role"]).strip()
            conn.execute(
                update(access_requests)
                .where(access_requests.c.request_id == request_id)
                .values(
                    status=decision_value,
                    reviewed_by=reviewer_user_id,
                    reviewer_notes=reviewer_notes.strip(),
                    reviewed_at=reviewed_at,
                    requested_site_id=site_id,
                    requested_role=role_value,
                )
            )

            user_row = conn.execute(
                select(users).where(users.c.user_id == request_row["user_id"])
            ).mappings().first()
            if user_row is None:
                raise ValueError(f"Unknown user_id: {request_row['user_id']}")

            if decision_value == "approved":
                next_site_ids = list(user_row["site_ids"] or [])
                if site_id and site_id not in next_site_ids:
                    next_site_ids.append(site_id)
                conn.execute(
                    update(users)
                    .where(users.c.user_id == request_row["user_id"])
                    .values(role=role_value, site_ids=next_site_ids)
                )

        reviewed = self.list_access_requests(user_id=request_row["user_id"])
        return reviewed[0] if reviewed else {
            **dict(request_row),
            "status": decision_value,
            "reviewed_by": reviewer_user_id,
            "reviewer_notes": reviewer_notes.strip(),
            "reviewed_at": reviewed_at,
            "requested_site_id": site_id,
            "requested_role": role_value,
        }

    def accessible_sites_for_user(self, user: dict[str, Any]) -> list[dict[str, Any]]:
        all_sites = self.list_sites()
        if user.get("role") == "admin":
            return all_sites
        if user.get("site_ids") is None:
            return all_sites
        allowed_site_ids = set(user.get("site_ids", []))
        return [site for site in all_sites if site["site_id"] in allowed_site_ids]

    def user_can_access_site(self, user: dict[str, Any], site_id: str | None) -> bool:
        if not site_id:
            return False
        if user.get("role") == "admin":
            return True
        if user.get("site_ids") is None:
            return True
        return site_id in set(user.get("site_ids", []))

    def list_projects(self) -> list[dict[str, Any]]:
        with ENGINE.begin() as conn:
            rows = conn.execute(select(projects).order_by(projects.c.created_at)).mappings().all()
        return [dict(row) for row in rows]

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
        with ENGINE.begin() as conn:
            conn.execute(projects.insert().values(**record))
        return record

    def list_sites(self, project_id: str | None = None) -> list[dict[str, Any]]:
        query = select(sites)
        if project_id:
            query = query.where(sites.c.project_id == project_id)
        query = query.order_by(sites.c.display_name)
        with ENGINE.begin() as conn:
            rows = conn.execute(query).mappings().all()
        return [dict(row) for row in rows]

    def create_site(
        self,
        project_id: str,
        site_code: str,
        display_name: str,
        hospital_name: str,
    ) -> dict[str, Any]:
        normalized_site_code = site_code.strip()
        if not normalized_site_code:
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
        with ENGINE.begin() as conn:
            existing_site = conn.execute(select(sites.c.site_id).where(sites.c.site_id == normalized_site_code)).first()
            if existing_site:
                raise ValueError(f"Site {normalized_site_code} already exists.")
            project_row = conn.execute(select(projects).where(projects.c.project_id == project_id)).mappings().first()
            if project_row is None:
                raise ValueError(f"Unknown project_id: {project_id}")
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

    def list_organisms(self, category: str | None = None) -> list[str] | dict[str, list[str]]:
        query = select(organism_catalog).order_by(organism_catalog.c.culture_category, organism_catalog.c.species_name)
        if category:
            query = query.where(organism_catalog.c.culture_category == category)
        with ENGINE.begin() as conn:
            rows = conn.execute(query).mappings().all()
        if category:
            return [row["species_name"] for row in rows]
        catalog: dict[str, list[str]] = {}
        for row in rows:
            catalog.setdefault(row["culture_category"], []).append(row["species_name"])
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
            "reviewed_at": None,
        }
        with ENGINE.begin() as conn:
            conn.execute(organism_requests.insert().values(**request_record))
        return request_record

    def list_organism_requests(self, status: str | None = None) -> list[dict[str, Any]]:
        query = select(organism_requests).order_by(organism_requests.c.created_at.desc())
        if status:
            query = query.where(organism_requests.c.status == status)
        with ENGINE.begin() as conn:
            rows = conn.execute(query).mappings().all()
        return [dict(row) for row in rows]

    def approve_organism(self, request_id: str, approver_user_id: str) -> dict[str, Any]:
        with ENGINE.begin() as conn:
            request_row = conn.execute(
                select(organism_requests).where(organism_requests.c.request_id == request_id)
            ).mappings().first()
            if request_row is None:
                raise ValueError(f"Unknown request_id: {request_id}")
            reviewed_at = utc_now()
            approved_request = {
                **dict(request_row),
                "status": "approved",
                "reviewed_by": approver_user_id,
                "reviewed_at": reviewed_at,
            }
            conn.execute(
                update(organism_requests)
                .where(organism_requests.c.request_id == request_id)
                .values(
                    status="approved",
                    reviewed_by=approver_user_id,
                    reviewed_at=reviewed_at,
                )
            )
            existing_species = conn.execute(
                select(organism_catalog.c.catalog_id).where(
                    and_(
                        organism_catalog.c.culture_category == request_row["culture_category"],
                        organism_catalog.c.species_name == request_row["requested_species"],
                    )
                )
            ).first()
            if existing_species is None:
                conn.execute(
                    organism_catalog.insert().values(
                        culture_category=request_row["culture_category"],
                        species_name=request_row["requested_species"],
                    )
                )
        return approved_request

    def list_validation_runs(
        self,
        project_id: str | None = None,
        site_id: str | None = None,
    ) -> list[dict[str, Any]]:
        query = select(validation_runs)
        if project_id:
            query = query.where(validation_runs.c.project_id == project_id)
        if site_id:
            query = query.where(validation_runs.c.site_id == site_id)
        query = query.order_by(validation_runs.c.run_date.desc())
        with ENGINE.begin() as conn:
            rows = conn.execute(query).mappings().all()
        runs: list[dict[str, Any]] = []
        for row in rows:
            payload = dict(row["summary_json"] or {})
            payload["case_predictions_path"] = row["case_predictions_path"]
            runs.append(payload)
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
        record = {
            "validation_id": summary["validation_id"],
            "project_id": summary["project_id"],
            "site_id": summary["site_id"],
            "model_version": summary.get("model_version", ""),
            "run_date": summary.get("run_date", utc_now()),
            "n_cases": summary.get("n_cases"),
            "n_images": summary.get("n_images"),
            "AUROC": summary.get("AUROC"),
            "accuracy": summary.get("accuracy"),
            "sensitivity": summary.get("sensitivity"),
            "specificity": summary.get("specificity"),
            "F1": summary.get("F1"),
            "case_predictions_path": payload["case_predictions_path"],
            "summary_json": payload,
        }
        with ENGINE.begin() as conn:
            existing = conn.execute(
                select(validation_runs.c.validation_id).where(validation_runs.c.validation_id == summary["validation_id"])
            ).first()
            if existing:
                conn.execute(
                    update(validation_runs)
                    .where(validation_runs.c.validation_id == summary["validation_id"])
                    .values(**record)
                )
            else:
                conn.execute(validation_runs.insert().values(**record))
        return payload

    def load_case_predictions(self, validation_id: str) -> list[dict[str, Any]]:
        case_path = CONTROL_PLANE_CASE_DIR / f"{validation_id}.json"
        return read_json(case_path, [])

    def list_model_versions(self) -> list[dict[str, Any]]:
        with ENGINE.begin() as conn:
            rows = conn.execute(select(model_versions).order_by(model_versions.c.created_at)).all()
        return [
            _payload_record(row, "payload_json", ["version_id", "version_name", "architecture", "stage", "created_at", "ready", "is_current"])
            for row in rows
        ]

    def _set_model_current_flag(
        self,
        conn: Any,
        version_id: str,
        is_current: bool,
    ) -> None:
        row = conn.execute(select(model_versions).where(model_versions.c.version_id == version_id)).first()
        if row is None:
            return
        payload = _payload_record(row, "payload_json", ["version_id", "version_name", "architecture", "stage", "created_at", "ready", "is_current"])
        payload["is_current"] = is_current
        conn.execute(
            update(model_versions)
            .where(model_versions.c.version_id == version_id)
            .values(is_current=is_current, payload_json=payload)
        )

    def ensure_model_version(self, model_metadata: dict[str, Any]) -> dict[str, Any]:
        merged = dict(model_metadata)
        merged.setdefault("ready", True)
        merged.setdefault("is_current", False)
        with ENGINE.begin() as conn:
            if merged.get("stage") == "global" and merged.get("ready", True) and merged.get("is_current"):
                current_rows = conn.execute(
                    select(model_versions.c.version_id).where(model_versions.c.stage == "global")
                ).all()
                for row in current_rows:
                    if row.version_id != merged["version_id"]:
                        self._set_model_current_flag(conn, row.version_id, False)

            existing = conn.execute(
                select(model_versions).where(model_versions.c.version_id == merged["version_id"])
            ).first()
            if existing:
                existing_payload = _payload_record(
                    existing,
                    "payload_json",
                    ["version_id", "version_name", "architecture", "stage", "created_at", "ready", "is_current"],
                )
                merged = {**existing_payload, **merged}
                conn.execute(
                    update(model_versions)
                    .where(model_versions.c.version_id == merged["version_id"])
                    .values(
                        version_name=merged["version_name"],
                        architecture=merged["architecture"],
                        stage=merged.get("stage"),
                        created_at=merged.get("created_at"),
                        ready=bool(merged.get("ready", True)),
                        is_current=bool(merged.get("is_current", False)),
                        payload_json=merged,
                    )
                )
            else:
                conn.execute(
                    model_versions.insert().values(
                        version_id=merged["version_id"],
                        version_name=merged["version_name"],
                        architecture=merged["architecture"],
                        stage=merged.get("stage"),
                        created_at=merged.get("created_at"),
                        ready=bool(merged.get("ready", True)),
                        is_current=bool(merged.get("is_current", False)),
                        payload_json=merged,
                    )
                )
        return merged

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
            return sorted(current_versions, key=lambda item: item.get("created_at", ""))[-1]
        return sorted(versions, key=lambda item: item.get("created_at", ""))[-1]

    def register_model_update(self, update_metadata: dict[str, Any]) -> dict[str, Any]:
        record = dict(update_metadata)
        with ENGINE.begin() as conn:
            existing = conn.execute(
                select(model_updates).where(model_updates.c.update_id == record["update_id"])
            ).first()
            values = {
                "update_id": record["update_id"],
                "site_id": record.get("site_id"),
                "architecture": record.get("architecture"),
                "status": record.get("status"),
                "created_at": record.get("created_at"),
                "payload_json": record,
            }
            if existing:
                conn.execute(update(model_updates).where(model_updates.c.update_id == record["update_id"]).values(**values))
            else:
                conn.execute(model_updates.insert().values(**values))
        return record

    def update_model_update_statuses(self, update_ids: list[str], status: str) -> None:
        with ENGINE.begin() as conn:
            rows = conn.execute(select(model_updates).where(model_updates.c.update_id.in_(update_ids))).all()
            for row in rows:
                payload = _payload_record(row, "payload_json", ["update_id", "site_id", "architecture", "status", "created_at"])
                payload["status"] = status
                conn.execute(
                    update(model_updates)
                    .where(model_updates.c.update_id == row._mapping["update_id"])
                    .values(status=status, payload_json=payload)
                )

    def list_model_updates(self, site_id: str | None = None) -> list[dict[str, Any]]:
        query = select(model_updates)
        if site_id:
            query = query.where(model_updates.c.site_id == site_id)
        query = query.order_by(model_updates.c.created_at.desc())
        with ENGINE.begin() as conn:
            rows = conn.execute(query).all()
        return [
            _payload_record(row, "payload_json", ["update_id", "site_id", "architecture", "status", "created_at"])
            for row in rows
        ]

    def register_contribution(self, contribution: dict[str, Any]) -> dict[str, Any]:
        record = dict(contribution)
        with ENGINE.begin() as conn:
            existing = conn.execute(
                select(contributions).where(contributions.c.contribution_id == record["contribution_id"])
            ).first()
            values = {
                "contribution_id": record["contribution_id"],
                "user_id": record.get("user_id"),
                "site_id": record.get("site_id"),
                "created_at": record.get("created_at"),
                "payload_json": record,
            }
            if existing:
                conn.execute(update(contributions).where(contributions.c.contribution_id == record["contribution_id"]).values(**values))
            else:
                conn.execute(contributions.insert().values(**values))
        return record

    def list_contributions(self, user_id: str | None = None, site_id: str | None = None) -> list[dict[str, Any]]:
        query = select(contributions)
        if user_id:
            query = query.where(contributions.c.user_id == user_id)
        if site_id:
            query = query.where(contributions.c.site_id == site_id)
        query = query.order_by(contributions.c.created_at.desc())
        with ENGINE.begin() as conn:
            rows = conn.execute(query).all()
        return [
            _payload_record(row, "payload_json", ["contribution_id", "user_id", "site_id", "created_at"])
            for row in rows
        ]

    def get_contribution_stats(self, user_id: str | None = None) -> dict[str, Any]:
        all_contribs = self.list_contributions()
        total = len(all_contribs)
        user_contribs = [item for item in all_contribs if item.get("user_id") == user_id] if user_id else []
        user_total = len(user_contribs)
        pct = round(user_total / total * 100, 1) if total > 0 else 0.0
        current_model = self.current_global_model()
        return {
            "total_contributions": total,
            "user_contributions": user_total,
            "user_contribution_pct": pct,
            "current_model_version": current_model["version_name"] if current_model else "—",
        }

    def list_aggregations(self) -> list[dict[str, Any]]:
        with ENGINE.begin() as conn:
            rows = conn.execute(select(aggregations).order_by(aggregations.c.created_at.desc())).all()
        return [
            _payload_record(row, "payload_json", ["aggregation_id", "architecture", "created_at", "total_cases"])
            for row in rows
        ]

    def register_aggregation(
        self,
        base_model_version_id: str,
        new_model_path: str,
        new_version_name: str,
        architecture: str,
        site_weights: dict[str, int],
        requires_medsam_crop: bool = False,
    ) -> dict[str, Any]:
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
        with ENGINE.begin() as conn:
            conn.execute(
                aggregations.insert().values(
                    aggregation_id=agg_id,
                    base_model_version_id=base_model_version_id,
                    new_version_name=new_version_name,
                    architecture=architecture,
                    total_cases=sum(site_weights.values()),
                    created_at=record["created_at"],
                    payload_json=record,
                )
            )
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
            "notes_ko": f"{len(site_weights)}개 사이트, 총 {sum(site_weights.values())}개 케이스의 Federated aggregation 결과입니다.",
            "notes_en": f"Federated aggregation result from {len(site_weights)} site(s), {sum(site_weights.values())} cases.",
        }
        self.ensure_model_version(new_version)
        return record
