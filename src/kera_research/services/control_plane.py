from __future__ import annotations

import hashlib
import os
import shutil
import threading
from pathlib import Path
from typing import Any

import bcrypt
from sqlalchemy import and_, delete, select, update

from kera_research.config import (
    BASE_DIR,
    CASE_REFERENCE_SALT,
    CASE_REFERENCE_SALT_FINGERPRINT,
    CONTROL_PLANE_ARTIFACT_DIR,
    CONTROL_PLANE_CASE_DIR,
    CONTROL_PLANE_DIR,
    CONTROL_PLANE_EXPERIMENT_DIR,
    CONTROL_PLANE_REPORT_DIR,
    DEFAULT_USERS,
    SITE_ROOT_DIR,
    ensure_base_directories,
)
from kera_research.db import (
    CONTROL_PLANE_ENGINE,
    DATA_PLANE_ENGINE,
    access_requests,
    app_settings,
    aggregations,
    contributions,
    experiments,
    images as db_images,
    init_control_plane_db,
    model_updates,
    model_versions,
    organism_catalog,
    organism_requests,
    projects,
    sites,
    users,
    validation_runs,
)
from kera_research.domain import CULTURE_SPECIES, make_case_reference_id, make_id, utc_now
from kera_research.storage import ensure_dir, read_json, write_json

GOOGLE_AUTH_SENTINEL = "__google__"
APP_SETTING_INSTANCE_STORAGE_ROOT = "instance_storage_root"


def _hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _is_bcrypt_hash(value: str) -> bool:
    return value.startswith(("$2b$", "$2a$", "$2y$"))


def _normalize_password_storage(value: str) -> str:
    normalized = str(value or "")
    if not normalized or normalized == GOOGLE_AUTH_SENTINEL or _is_bcrypt_hash(normalized):
        return normalized
    return _hash_password(normalized)


def _row_to_dict(row: Any) -> dict[str, Any]:
    return dict(row._mapping)


def _payload_record(row: Any, payload_key: str, extra_keys: list[str]) -> dict[str, Any]:
    mapping = row._mapping
    payload = dict(mapping[payload_key] or {})
    for key in extra_keys:
        if key not in payload and mapping.get(key) is not None:
            payload[key] = mapping.get(key)
    return payload


def _normalize_registry_consents(value: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(value, dict):
        return {}
    normalized: dict[str, dict[str, Any]] = {}
    for raw_site_id, raw_payload in value.items():
        site_id = str(raw_site_id or "").strip()
        if not site_id:
            continue
        payload = raw_payload if isinstance(raw_payload, dict) else {}
        enrolled_at = str(payload.get("enrolled_at") or "").strip()
        if not enrolled_at:
            continue
        normalized[site_id] = {
            "enrolled_at": enrolled_at,
            "version": str(payload.get("version") or "v1").strip() or "v1",
        }
    return normalized


def _replace_path_prefix_in_value(value: Any, old_root: Path, new_root: Path) -> Any:
    old_prefix = os.path.normcase(os.path.normpath(str(old_root)))
    new_root_str = str(new_root)

    if isinstance(value, dict):
        return {key: _replace_path_prefix_in_value(item, old_root, new_root) for key, item in value.items()}
    if isinstance(value, list):
        return [_replace_path_prefix_in_value(item, old_root, new_root) for item in value]
    if not isinstance(value, str):
        return value

    text = value.strip()
    if not text:
        return value

    normalized_text = os.path.normcase(os.path.normpath(text))
    if normalized_text == old_prefix:
        return new_root_str
    prefix = old_prefix + os.sep
    if normalized_text.startswith(prefix):
        relative_part = text[len(str(old_root)):].lstrip("\\/")
        return str(new_root / Path(relative_part))
    return value


_MODEL_VERSION_LOCK = threading.Lock()


class _ControlPlaneIdentityOps:
    def __init__(self, store: "ControlPlaneStore") -> None:
        self.store = store

    def authenticate(self, username: str, password: str) -> dict[str, Any] | None:
        query = select(users).where(users.c.username == username)
        with CONTROL_PLANE_ENGINE.begin() as conn:
            row = conn.execute(query).mappings().first()
        if row is None:
            return None
        user_record = dict(row)
        stored = user_record.get("password", "")
        if stored == GOOGLE_AUTH_SENTINEL:
            return None
        if not _is_bcrypt_hash(stored):
            return None
        if not bcrypt.checkpw(password.encode("utf-8"), stored.encode("utf-8")):
            return None
        return self.serialize_user(user_record)

    def serialize_user(self, user_record: dict[str, Any]) -> dict[str, Any]:
        serialized = dict(user_record)
        serialized["site_ids"] = list(serialized.get("site_ids") or [])
        serialized["registry_consents"] = _normalize_registry_consents(serialized.get("registry_consents"))
        serialized["approval_status"] = self.user_approval_status(serialized)
        latest_request = self.latest_access_request(serialized["user_id"])
        serialized["latest_access_request"] = latest_request
        serialized.pop("google_sub", None)
        serialized.pop("password", None)
        return serialized

    def load_user_by_id(self, user_id: str) -> dict[str, Any] | None:
        with CONTROL_PLANE_ENGINE.begin() as conn:
            row = conn.execute(select(users).where(users.c.user_id == user_id)).mappings().first()
        return dict(row) if row else None

    def load_user_by_username(self, username: str) -> dict[str, Any] | None:
        normalized = username.strip().lower()
        with CONTROL_PLANE_ENGINE.begin() as conn:
            row = conn.execute(select(users).where(users.c.username == normalized)).mappings().first()
        return dict(row) if row else None

    def load_user_by_google_sub(self, google_sub: str) -> dict[str, Any] | None:
        normalized_sub = google_sub.strip()
        if not normalized_sub:
            return None
        with CONTROL_PLANE_ENGINE.begin() as conn:
            row = conn.execute(select(users).where(users.c.google_sub == normalized_sub)).mappings().first()
        return dict(row) if row else None

    def get_user_by_id(self, user_id: str) -> dict[str, Any] | None:
        row = self.load_user_by_id(user_id)
        return self.serialize_user(row) if row else None

    def get_user_by_username(self, username: str) -> dict[str, Any] | None:
        row = self.load_user_by_username(username)
        return self.serialize_user(row) if row else None

    def get_user_by_google_sub(self, google_sub: str) -> dict[str, Any] | None:
        row = self.load_user_by_google_sub(google_sub)
        return self.serialize_user(row) if row else None

    def list_users(self) -> list[dict[str, Any]]:
        with CONTROL_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(select(users).order_by(users.c.username)).mappings().all()
        return [self.serialize_user(dict(row)) for row in rows]

    def upsert_user(self, user_record: dict[str, Any]) -> dict[str, Any]:
        normalized_site_ids = list(dict.fromkeys(user_record.get("site_ids") or []))
        normalized = {
            **user_record,
            "username": user_record["username"].strip().lower(),
            "site_ids": normalized_site_ids,
        }
        normalized["registry_consents"] = _normalize_registry_consents(normalized.get("registry_consents"))
        normalized["password"] = _normalize_password_storage(str(normalized.get("password") or ""))
        if "google_sub" in normalized:
            normalized["google_sub"] = str(normalized.get("google_sub") or "").strip() or None
        with CONTROL_PLANE_ENGINE.begin() as conn:
            existing = conn.execute(
                select(users).where((users.c.user_id == normalized["user_id"]) | (users.c.username == normalized["username"]))
            ).mappings().first()
            if existing:
                persisted = dict(existing)
                persisted.update(normalized)
                persisted["user_id"] = existing["user_id"]
                conn.execute(update(users).where(users.c.user_id == existing["user_id"]).values(**persisted))
                user_id = existing["user_id"]
            else:
                conn.execute(users.insert().values(**normalized))
                user_id = normalized["user_id"]
        return self.get_user_by_id(user_id) or normalized

    def ensure_google_user(self, google_sub: str, email: str, full_name: str) -> dict[str, Any]:
        normalized_sub = google_sub.strip()
        normalized_email = email.strip().lower()
        normalized_name = full_name.strip() or normalized_email
        if not normalized_sub:
            raise ValueError("Google account did not return a stable subject identifier.")

        existing_by_sub = self.load_user_by_google_sub(normalized_sub)
        if existing_by_sub:
            email_owner = self.load_user_by_username(normalized_email)
            if email_owner and email_owner["user_id"] != existing_by_sub["user_id"]:
                raise ValueError("This Google email is already used by another account.")
            updated = {
                **existing_by_sub,
                "username": normalized_email,
                "full_name": normalized_name,
                "google_sub": normalized_sub,
            }
            return self.upsert_user(updated)

        existing_by_email = self.load_user_by_username(normalized_email)
        if existing_by_email:
            if existing_by_email.get("password") != GOOGLE_AUTH_SENTINEL:
                raise ValueError("This email is already reserved by a local account.")
            bound_google_sub = str(existing_by_email.get("google_sub") or "").strip()
            if bound_google_sub and bound_google_sub != normalized_sub:
                raise ValueError("This email is already linked to a different Google account.")
            updated = {
                **existing_by_email,
                "full_name": normalized_name,
                "google_sub": normalized_sub,
            }
            return self.upsert_user(updated)

        return self.upsert_user(
            {
                "user_id": make_id("user"),
                "username": normalized_email,
                "google_sub": normalized_sub,
                "password": GOOGLE_AUTH_SENTINEL,
                "role": "viewer",
                "full_name": normalized_name,
                "site_ids": [],
                "registry_consents": {},
            }
        )

    def get_registry_consent(self, user_id: str, site_id: str) -> dict[str, Any] | None:
        user = self.load_user_by_id(user_id)
        if user is None:
            return None
        consents = _normalize_registry_consents(user.get("registry_consents"))
        return consents.get(site_id)

    def set_registry_consent(self, user_id: str, site_id: str, *, version: str = "v1") -> dict[str, Any]:
        user = self.load_user_by_id(user_id)
        if user is None:
            raise ValueError(f"Unknown user_id: {user_id}")
        consents = _normalize_registry_consents(user.get("registry_consents"))
        consents[site_id] = {
            "enrolled_at": utc_now(),
            "version": version.strip() or "v1",
        }
        return self.upsert_user({**user, "registry_consents": consents})

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

    def submit_access_request(self, user_id: str, requested_site_id: str, requested_role: str, message: str = "") -> dict[str, Any]:
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
        with CONTROL_PLANE_ENGINE.begin() as conn:
            conn.execute(access_requests.insert().values(**request_record))
        return request_record

    def latest_access_request(self, user_id: str) -> dict[str, Any] | None:
        query = select(access_requests).where(access_requests.c.user_id == user_id).order_by(access_requests.c.created_at.desc())
        with CONTROL_PLANE_ENGINE.begin() as conn:
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
        with CONTROL_PLANE_ENGINE.begin() as conn:
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
        with CONTROL_PLANE_ENGINE.begin() as conn:
            request_row = conn.execute(select(access_requests).where(access_requests.c.request_id == request_id)).mappings().first()
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

            user_row = conn.execute(select(users).where(users.c.user_id == request_row["user_id"])).mappings().first()
            if user_row is None:
                raise ValueError(f"Unknown user_id: {request_row['user_id']}")

            if decision_value == "approved":
                next_site_ids = list(user_row["site_ids"] or [])
                if site_id and site_id not in next_site_ids:
                    next_site_ids.append(site_id)
                conn.execute(update(users).where(users.c.user_id == request_row["user_id"]).values(role=role_value, site_ids=next_site_ids))

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
        all_sites = self.store.list_sites()
        if user.get("role") == "admin":
            return all_sites
        allowed_site_ids = set(user.get("site_ids") or [])
        return [site for site in all_sites if site["site_id"] in allowed_site_ids]

    def user_can_access_site(self, user: dict[str, Any], site_id: str | None) -> bool:
        if not site_id:
            return False
        if user.get("role") == "admin":
            return True
        return site_id in set(user.get("site_ids") or [])


class _ControlPlaneRegistryOps:
    def __init__(self, store: "ControlPlaneStore") -> None:
        self.store = store

    def list_model_versions(self) -> list[dict[str, Any]]:
        return self.store.list_model_versions()

    def set_model_current_flag(self, conn: Any, version_id: str, is_current: bool) -> None:
        row = conn.execute(select(model_versions).where(model_versions.c.version_id == version_id)).first()
        if row is None:
            return
        payload = _payload_record(row, "payload_json", ["version_id", "version_name", "architecture", "stage", "created_at", "ready", "is_current"])
        payload["is_current"] = is_current
        conn.execute(update(model_versions).where(model_versions.c.version_id == version_id).values(is_current=is_current, payload_json=payload))

    def ensure_model_version(self, model_metadata: dict[str, Any]) -> dict[str, Any]:
        merged = dict(model_metadata)
        merged.setdefault("ready", True)
        merged.setdefault("is_current", False)
        with _MODEL_VERSION_LOCK, CONTROL_PLANE_ENGINE.begin() as conn:
            if merged.get("stage") == "global" and merged.get("ready", True) and merged.get("is_current"):
                current_rows = conn.execute(select(model_versions.c.version_id).where(model_versions.c.stage == "global")).all()
                for row in current_rows:
                    if row.version_id != merged["version_id"]:
                        self.set_model_current_flag(conn, row.version_id, False)

            existing = conn.execute(select(model_versions).where(model_versions.c.version_id == merged["version_id"])).first()
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
        versions = [item for item in self.list_model_versions() if item.get("stage") == "global" and item.get("ready", True)]
        if not versions:
            return None
        current_versions = [item for item in versions if item.get("is_current")]
        if current_versions:
            return sorted(current_versions, key=lambda item: item.get("created_at", ""))[-1]
        return sorted(versions, key=lambda item: item.get("created_at", ""))[-1]

    def archive_model_version(self, version_id: str) -> dict[str, Any]:
        with CONTROL_PLANE_ENGINE.begin() as conn:
            row = conn.execute(select(model_versions).where(model_versions.c.version_id == version_id)).first()
            if row is None:
                raise ValueError(f"Unknown model version: {version_id}")
            payload = _payload_record(row, "payload_json", ["version_id", "version_name", "architecture", "stage", "created_at", "ready", "is_current"])
            if payload.get("is_current"):
                raise ValueError("The current active model cannot be deleted.")
            all_versions = [
                _payload_record(item, "payload_json", ["version_id", "version_name", "architecture", "stage", "created_at", "ready", "is_current"])
                for item in conn.execute(select(model_versions)).all()
            ]
            all_aggregations = [
                _payload_record(item, "payload_json", ["aggregation_id", "base_model_version_id", "new_version_name", "architecture", "created_at", "total_cases"])
                for item in conn.execute(select(aggregations)).all()
            ]
            if any(str(item.get("base_model_version_id") or "") == version_id for item in all_aggregations):
                raise ValueError("This model is referenced by an aggregation and cannot be deleted.")
            for item in all_versions:
                component_ids = [str(component_id) for component_id in item.get("component_model_version_ids", [])]
                if version_id in component_ids:
                    raise ValueError("This model is referenced by an ensemble model and cannot be deleted.")
                if str(item.get("base_version_id") or "") == version_id:
                    raise ValueError("This model is referenced as a base model and cannot be deleted.")

            payload["archived"] = True
            payload["archived_at"] = utc_now()
            conn.execute(update(model_versions).where(model_versions.c.version_id == version_id).values(is_current=False, payload_json=payload))
        return payload

    def register_model_update(self, update_metadata: dict[str, Any]) -> dict[str, Any]:
        incoming_fingerprint = str(update_metadata.get("salt_fingerprint") or "").strip()
        if incoming_fingerprint and incoming_fingerprint != CASE_REFERENCE_SALT_FINGERPRINT:
            raise ValueError(
                f"Salt fingerprint mismatch: the submitting site uses a different "
                f"KERA_CASE_REFERENCE_SALT (site fingerprint: {incoming_fingerprint!r}, "
                f"server fingerprint: {CASE_REFERENCE_SALT_FINGERPRINT!r}). "
                "All nodes in a federation must share the same KERA_CASE_REFERENCE_SALT "
                "environment variable to ensure consistent case reference IDs."
            )
        record = self.store._normalize_case_reference(update_metadata)
        artifact_path = str(record.get("artifact_path") or "").strip()
        if artifact_path and not str(record.get("central_artifact_path") or "").strip():
            try:
                record.update(
                    self.store.store_model_update_artifact(
                        artifact_path,
                        update_id=str(record["update_id"]),
                        artifact_kind="delta" if record.get("upload_type") == "weight delta" else "model",
                    )
                )
            except FileNotFoundError:
                pass
        with CONTROL_PLANE_ENGINE.begin() as conn:
            existing = conn.execute(select(model_updates).where(model_updates.c.update_id == record["update_id"])).first()
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

    def get_model_update(self, update_id: str) -> dict[str, Any] | None:
        normalized_update_id = update_id.strip()
        if not normalized_update_id:
            return None
        with CONTROL_PLANE_ENGINE.begin() as conn:
            row = conn.execute(select(model_updates).where(model_updates.c.update_id == normalized_update_id)).first()
        if row is None:
            return None
        return self.store._normalize_case_reference(
            _payload_record(row, "payload_json", ["update_id", "site_id", "architecture", "status", "created_at"])
        )

    def update_model_update(self, update_id: str, updates: dict[str, Any]) -> dict[str, Any]:
        current = self.get_model_update(update_id)
        if current is None:
            raise ValueError(f"Unknown update_id: {update_id}")
        merged = self.store._normalize_case_reference({**current, **updates})
        with CONTROL_PLANE_ENGINE.begin() as conn:
            conn.execute(
                update(model_updates)
                .where(model_updates.c.update_id == update_id)
                .values(
                    site_id=merged.get("site_id"),
                    architecture=merged.get("architecture"),
                    status=merged.get("status"),
                    created_at=merged.get("created_at"),
                    payload_json=merged,
                )
            )
        return merged

    def update_model_update_statuses(self, update_ids: list[str], status: str) -> None:
        with CONTROL_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(select(model_updates).where(model_updates.c.update_id.in_(update_ids))).all()
            for row in rows:
                payload = _payload_record(row, "payload_json", ["update_id", "site_id", "architecture", "status", "created_at"])
                payload["status"] = status
                conn.execute(
                    update(model_updates)
                    .where(model_updates.c.update_id == row._mapping["update_id"])
                    .values(status=status, payload_json=payload)
                )

    def review_model_update(self, update_id: str, reviewer_user_id: str, decision: str, reviewer_notes: str = "") -> dict[str, Any]:
        normalized_decision = decision.strip().lower()
        if normalized_decision not in {"approved", "rejected"}:
            raise ValueError("Invalid review decision.")
        current = self.get_model_update(update_id)
        if current is None:
            raise ValueError(f"Unknown update_id: {update_id}")
        return self.update_model_update(
            update_id,
            {
                "status": normalized_decision,
                "reviewed_by": reviewer_user_id,
                "reviewed_at": utc_now(),
                "reviewer_notes": reviewer_notes.strip(),
            },
        )

    def list_model_updates(self, site_id: str | None = None) -> list[dict[str, Any]]:
        query = select(model_updates)
        if site_id:
            query = query.where(model_updates.c.site_id == site_id)
        query = query.order_by(model_updates.c.created_at.desc())
        with CONTROL_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(query).all()
        return [
            self.store._normalize_case_reference(
                _payload_record(row, "payload_json", ["update_id", "site_id", "architecture", "status", "created_at"])
            )
            for row in rows
        ]

    def register_contribution(self, contribution: dict[str, Any]) -> dict[str, Any]:
        record = self.store._normalize_case_reference(contribution)
        with CONTROL_PLANE_ENGINE.begin() as conn:
            existing = conn.execute(select(contributions).where(contributions.c.contribution_id == record["contribution_id"])).first()
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
        with CONTROL_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(query).all()
        return [
            self.store._normalize_case_reference(
                _payload_record(row, "payload_json", ["contribution_id", "user_id", "site_id", "created_at"])
            )
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
        with CONTROL_PLANE_ENGINE.begin() as conn:
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
        decision_threshold: float | None = None,
        threshold_selection_metric: str | None = None,
        threshold_selection_metrics: dict[str, Any] | None = None,
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
        with CONTROL_PLANE_ENGINE.begin() as conn:
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
            "training_input_policy": "medsam_cornea_crop_only" if requires_medsam_crop else "raw_or_model_defined",
            "decision_threshold": float(decision_threshold) if decision_threshold is not None else 0.5,
            "threshold_selection_metric": threshold_selection_metric or "inherited_from_base_model",
            "threshold_selection_metrics": threshold_selection_metrics,
            "is_current": True,
            "ready": True,
            "notes": f"Federated aggregation of {len(site_weights)} site(s), {sum(site_weights.values())} cases.",
            "notes_ko": f"{len(site_weights)}개 사이트, 총 {sum(site_weights.values())}개 케이스의 Federated aggregation 결과입니다.",
            "notes_en": f"Federated aggregation result from {len(site_weights)} site(s), {sum(site_weights.values())} cases.",
        }
        self.ensure_model_version(new_version)
        return record


class _ControlPlaneWorkspaceOps:
    def __init__(self, store: "ControlPlaneStore") -> None:
        self.store = store

    def list_projects(self) -> list[dict[str, Any]]:
        return self.store.list_projects()

    def create_project(self, name: str, description: str, owner_user_id: str) -> dict[str, Any]:
        return self.store.create_project(name, description, owner_user_id)

    def list_sites(self, project_id: str | None = None) -> list[dict[str, Any]]:
        return self.store.list_sites(project_id)

    def get_site(self, site_id: str) -> dict[str, Any] | None:
        return self.store.get_site(site_id)

    def create_site(
        self,
        project_id: str,
        site_code: str,
        display_name: str,
        hospital_name: str,
        research_registry_enabled: bool = True,
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
            "local_storage_root": str(Path(self.store.instance_storage_root()) / normalized_site_code),
            "research_registry_enabled": bool(research_registry_enabled),
            "created_at": utc_now(),
        }
        with CONTROL_PLANE_ENGINE.begin() as conn:
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

    def update_site_metadata(
        self,
        site_id: str,
        display_name: str,
        hospital_name: str,
        research_registry_enabled: bool | None = None,
    ) -> dict[str, Any]:
        normalized_site_id = site_id.strip()
        normalized_display_name = display_name.strip()
        normalized_hospital_name = hospital_name.strip()
        if not normalized_site_id:
            raise ValueError("Site code is required.")
        if not normalized_display_name:
            raise ValueError("Site display name is required.")

        with CONTROL_PLANE_ENGINE.begin() as conn:
            existing_site = conn.execute(select(sites).where(sites.c.site_id == normalized_site_id)).mappings().first()
            if existing_site is None:
                raise ValueError(f"Unknown site_id: {normalized_site_id}")
            values: dict[str, Any] = {
                "display_name": normalized_display_name,
                "hospital_name": normalized_hospital_name,
            }
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
            "research_registry_enabled": bool(research_registry_enabled) if research_registry_enabled is not None else True,
        }

    def update_site_storage_root(self, site_id: str, storage_root: str) -> dict[str, Any]:
        normalized_site_id = site_id.strip()
        normalized_storage_root = storage_root.strip()
        if not normalized_site_id:
            raise ValueError("Site code is required.")
        if not normalized_storage_root:
            raise ValueError("Storage root is required.")

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
                rewritten_path = _replace_path_prefix_in_value(row["image_path"], old_root, new_root)
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
            rewritten_predictions = _replace_path_prefix_in_value(predictions, old_root, new_root)
            write_json(CONTROL_PLANE_CASE_DIR / f"{validation_id}.json", rewritten_predictions)

        with CONTROL_PLANE_ENGINE.begin() as conn:
            update_rows = conn.execute(
                select(model_updates).where(model_updates.c.site_id == normalized_site_id)
            ).all()
            for row in update_rows:
                payload = _payload_record(
                    row,
                    "payload_json",
                    ["update_id", "site_id", "architecture", "status", "created_at"],
                )
                rewritten_payload = _replace_path_prefix_in_value(payload, old_root, new_root)
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

        validation_dir = new_root / "validation"
        if validation_dir.exists():
            for report_path in validation_dir.glob("*.json"):
                report = read_json(report_path, {})
                if isinstance(report, dict):
                    write_json(report_path, _replace_path_prefix_in_value(report, old_root, new_root))

        return self.get_site(normalized_site_id) or {
            "site_id": normalized_site_id,
            "local_storage_root": str(new_root),
        }

    def list_validation_runs(
        self,
        project_id: str | None = None,
        site_id: str | None = None,
    ) -> list[dict[str, Any]]:
        return self.store.list_validation_runs(project_id, site_id)

    def save_validation_run(
        self,
        summary: dict[str, Any],
        case_predictions: list[dict[str, Any]],
    ) -> dict[str, Any]:
        return self.store.save_validation_run(summary, case_predictions)

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


class ControlPlaneStore:
    def __init__(self, root: Path | None = None) -> None:
        ensure_base_directories()
        init_control_plane_db()
        self.root = root or CONTROL_PLANE_DIR
        self.artifact_root = CONTROL_PLANE_ARTIFACT_DIR
        ensure_dir(self.root)
        ensure_dir(CONTROL_PLANE_CASE_DIR)
        ensure_dir(CONTROL_PLANE_REPORT_DIR)
        ensure_dir(CONTROL_PLANE_EXPERIMENT_DIR)
        ensure_dir(self.artifact_root)
        self.identity = _ControlPlaneIdentityOps(self)
        self.registry = _ControlPlaneRegistryOps(self)
        self.workspace = _ControlPlaneWorkspaceOps(self)
        self._seed_defaults()

    def default_instance_storage_root(self) -> Path:
        return SITE_ROOT_DIR.resolve()

    def get_app_setting(self, setting_key: str) -> str | None:
        normalized_key = setting_key.strip()
        if not normalized_key:
            return None
        with CONTROL_PLANE_ENGINE.begin() as conn:
            row = conn.execute(
                select(app_settings.c.setting_value).where(app_settings.c.setting_key == normalized_key)
            ).first()
        if row is None:
            return None
        value = str(row[0] or "").strip()
        return value or None

    def set_app_setting(self, setting_key: str, setting_value: str) -> str:
        normalized_key = setting_key.strip()
        normalized_value = setting_value.strip()
        if not normalized_key:
            raise ValueError("Setting key is required.")
        if not normalized_value:
            raise ValueError("Setting value is required.")
        record = {
            "setting_key": normalized_key,
            "setting_value": normalized_value,
            "updated_at": utc_now(),
        }
        with CONTROL_PLANE_ENGINE.begin() as conn:
            existing = conn.execute(
                select(app_settings.c.setting_key).where(app_settings.c.setting_key == normalized_key)
            ).first()
            if existing:
                conn.execute(
                    update(app_settings)
                    .where(app_settings.c.setting_key == normalized_key)
                    .values(**record)
                )
            else:
                conn.execute(app_settings.insert().values(**record))
        return normalized_value

    def instance_storage_root(self) -> str:
        configured = self.get_app_setting(APP_SETTING_INSTANCE_STORAGE_ROOT)
        if configured:
            return str(Path(configured).expanduser().resolve())
        return str(self.default_instance_storage_root())

    def site_storage_root(self, site_id: str) -> str:
        site = self.get_site(site_id)
        configured = str(site.get("local_storage_root") or "").strip() if site else ""
        if configured:
            site_root = Path(configured).expanduser()
            if not site_root.is_absolute():
                site_root = (BASE_DIR / site_root).resolve()
            else:
                site_root = site_root.resolve()
            return str(site_root)
        return str(Path(self.instance_storage_root()) / site_id)

    def _sha256_file(self, path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    def case_reference_id(self, site_id: str, patient_id: str, visit_date: str) -> str:
        return make_case_reference_id(site_id, patient_id, visit_date, CASE_REFERENCE_SALT)

    def _normalize_case_reference(self, record: dict[str, Any]) -> dict[str, Any]:
        normalized = dict(record)
        site_id = str(normalized.get("site_id") or "").strip()
        patient_id = str(normalized.get("patient_id") or "").strip()
        visit_date = str(normalized.get("visit_date") or "").strip()
        case_reference_id = str(normalized.get("case_reference_id") or "").strip()

        if not case_reference_id and site_id and patient_id and visit_date:
            case_reference_id = self.case_reference_id(site_id, patient_id, visit_date)
            normalized["case_reference_id"] = case_reference_id

        normalized.pop("patient_id", None)
        normalized.pop("visit_date", None)

        approval_report = normalized.get("approval_report")
        if isinstance(approval_report, dict):
            report = dict(approval_report)
            report_site_id = str(report.get("site_id") or site_id).strip()
            report_patient_id = str(report.get("patient_id") or patient_id).strip()
            report_visit_date = str(report.get("visit_date") or visit_date).strip()
            report_case_reference_id = str(report.get("case_reference_id") or case_reference_id).strip()
            if not report_case_reference_id and report_site_id and report_patient_id and report_visit_date:
                report_case_reference_id = self.case_reference_id(
                    report_site_id,
                    report_patient_id,
                    report_visit_date,
                )
            if report_case_reference_id:
                report["case_reference_id"] = report_case_reference_id
            report.pop("patient_id", None)
            report.pop("visit_date", None)
            normalized["approval_report"] = report

        return normalized

    def store_model_update_artifact(
        self,
        source_path: str | Path,
        *,
        update_id: str,
        artifact_kind: str = "delta",
    ) -> dict[str, Any]:
        source = Path(source_path).resolve()
        if not source.exists():
            raise FileNotFoundError(f"Model update artifact does not exist: {source}")

        suffix = source.suffix or ".bin"
        target_dir = ensure_dir(self.artifact_root / "model_updates" / update_id)
        target = target_dir / f"{artifact_kind}{suffix}"
        if source != target:
            shutil.copy2(source, target)

        return {
            "central_artifact_path": str(target),
            "central_artifact_name": target.name,
            "central_artifact_size_bytes": int(target.stat().st_size),
            "central_artifact_sha256": self._sha256_file(target),
            "artifact_storage": "control_plane_filesystem",
            "artifact_kind": artifact_kind,
        }

    def _seed_defaults(self) -> None:
        with CONTROL_PLANE_ENGINE.begin() as conn:
            existing_users = {row.username for row in conn.execute(select(users.c.username))}
            for user_record in DEFAULT_USERS:
                if user_record["username"] not in existing_users:
                    conn.execute(users.insert().values(**user_record))

            existing_password_rows = conn.execute(select(users.c.user_id, users.c.password)).all()
            for user_id, stored_password in existing_password_rows:
                normalized_password = _normalize_password_storage(str(stored_password or ""))
                if normalized_password != str(stored_password or ""):
                    conn.execute(
                        update(users)
                        .where(users.c.user_id == user_id)
                        .values(password=normalized_password)
                    )

            conn.execute(
                update(users)
                .where(and_(users.c.role != "admin", users.c.site_ids.is_(None)))
                .values(site_ids=[])
            )
            conn.execute(
                update(users)
                .where(users.c.registry_consents.is_(None))
                .values(registry_consents={})
            )

            conn.execute(
                delete(organism_catalog).where(
                    and_(
                        organism_catalog.c.culture_category == "bacterial",
                        organism_catalog.c.species_name == "Moraxella spp",
                    )
                )
            )

            existing_catalog = {
                (row.culture_category, row.species_name)
                for row in conn.execute(select(organism_catalog.c.culture_category, organism_catalog.c.species_name))
            }
            for category, species_list in CULTURE_SPECIES.items():
                for species_name in species_list:
                    if (category, species_name) in existing_catalog:
                        continue
                    conn.execute(
                        organism_catalog.insert().values(
                            culture_category=category,
                            species_name=species_name,
                        )
                    )

    def authenticate(self, username: str, password: str) -> dict[str, Any] | None:
        return self.identity.authenticate(username, password)

    def _serialize_user(self, user_record: dict[str, Any]) -> dict[str, Any]:
        return self.identity.serialize_user(user_record)

    def _load_user_by_id(self, user_id: str) -> dict[str, Any] | None:
        return self.identity.load_user_by_id(user_id)

    def _load_user_by_username(self, username: str) -> dict[str, Any] | None:
        return self.identity.load_user_by_username(username)

    def _load_user_by_google_sub(self, google_sub: str) -> dict[str, Any] | None:
        return self.identity.load_user_by_google_sub(google_sub)

    def get_user_by_id(self, user_id: str) -> dict[str, Any] | None:
        return self.identity.get_user_by_id(user_id)

    def get_user_by_username(self, username: str) -> dict[str, Any] | None:
        return self.identity.get_user_by_username(username)

    def get_user_by_google_sub(self, google_sub: str) -> dict[str, Any] | None:
        return self.identity.get_user_by_google_sub(google_sub)

    def list_users(self) -> list[dict[str, Any]]:
        return self.identity.list_users()

    def upsert_user(self, user_record: dict[str, Any]) -> dict[str, Any]:
        return self.identity.upsert_user(user_record)

    def ensure_google_user(self, google_sub: str, email: str, full_name: str) -> dict[str, Any]:
        return self.identity.ensure_google_user(google_sub, email, full_name)

    def user_approval_status(self, user: dict[str, Any]) -> str:
        return self.identity.user_approval_status(user)

    def submit_access_request(
        self,
        user_id: str,
        requested_site_id: str,
        requested_role: str,
        message: str = "",
    ) -> dict[str, Any]:
        return self.identity.submit_access_request(user_id, requested_site_id, requested_role, message)

    def latest_access_request(self, user_id: str) -> dict[str, Any] | None:
        return self.identity.latest_access_request(user_id)

    def list_access_requests(
        self,
        status: str | None = None,
        site_ids: list[str] | None = None,
        user_id: str | None = None,
    ) -> list[dict[str, Any]]:
        return self.identity.list_access_requests(status=status, site_ids=site_ids, user_id=user_id)

    def review_access_request(
        self,
        request_id: str,
        reviewer_user_id: str,
        decision: str,
        assigned_role: str | None = None,
        assigned_site_id: str | None = None,
        reviewer_notes: str = "",
    ) -> dict[str, Any]:
        return self.identity.review_access_request(
            request_id,
            reviewer_user_id,
            decision,
            assigned_role=assigned_role,
            assigned_site_id=assigned_site_id,
            reviewer_notes=reviewer_notes,
        )

    def accessible_sites_for_user(self, user: dict[str, Any]) -> list[dict[str, Any]]:
        return self.identity.accessible_sites_for_user(user)

    def user_can_access_site(self, user: dict[str, Any], site_id: str | None) -> bool:
        return self.identity.user_can_access_site(user, site_id)

    def list_projects(self) -> list[dict[str, Any]]:
        with CONTROL_PLANE_ENGINE.begin() as conn:
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
        with CONTROL_PLANE_ENGINE.begin() as conn:
            conn.execute(projects.insert().values(**record))
        return record

    def list_sites(self, project_id: str | None = None) -> list[dict[str, Any]]:
        query = select(sites)
        if project_id:
            query = query.where(sites.c.project_id == project_id)
        query = query.order_by(sites.c.display_name)
        with CONTROL_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(query).mappings().all()
        return [dict(row) for row in rows]

    def get_site(self, site_id: str) -> dict[str, Any] | None:
        normalized_site_id = site_id.strip()
        if not normalized_site_id:
            return None
        with CONTROL_PLANE_ENGINE.begin() as conn:
            row = conn.execute(select(sites).where(sites.c.site_id == normalized_site_id)).mappings().first()
        return dict(row) if row else None

    def create_site(
        self,
        project_id: str,
        site_code: str,
        display_name: str,
        hospital_name: str,
        research_registry_enabled: bool = True,
    ) -> dict[str, Any]:
        return self.workspace.create_site(
            project_id,
            site_code,
            display_name,
            hospital_name,
            research_registry_enabled=research_registry_enabled,
        )

    def update_site_metadata(
        self,
        site_id: str,
        display_name: str,
        hospital_name: str,
        research_registry_enabled: bool | None = None,
    ) -> dict[str, Any]:
        return self.workspace.update_site_metadata(
            site_id,
            display_name,
            hospital_name,
            research_registry_enabled=research_registry_enabled,
        )

    def update_site_storage_root(self, site_id: str, storage_root: str) -> dict[str, Any]:
        return self.workspace.update_site_storage_root(site_id, storage_root)

    def migrate_site_storage_root(self, site_id: str, storage_root: str) -> dict[str, Any]:
        return self.workspace.migrate_site_storage_root(site_id, storage_root)

    def get_registry_consent(self, user_id: str, site_id: str) -> dict[str, Any] | None:
        return self.identity.get_registry_consent(user_id, site_id)

    def set_registry_consent(self, user_id: str, site_id: str, *, version: str = "v1") -> dict[str, Any]:
        return self.identity.set_registry_consent(user_id, site_id, version=version)

    def list_organisms(self, category: str | None = None) -> list[str] | dict[str, list[str]]:
        query = select(organism_catalog).order_by(organism_catalog.c.culture_category, organism_catalog.c.species_name)
        if category:
            query = query.where(organism_catalog.c.culture_category == category)
        with CONTROL_PLANE_ENGINE.begin() as conn:
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
        with CONTROL_PLANE_ENGINE.begin() as conn:
            conn.execute(organism_requests.insert().values(**request_record))
        return request_record

    def list_organism_requests(self, status: str | None = None) -> list[dict[str, Any]]:
        query = select(organism_requests).order_by(organism_requests.c.created_at.desc())
        if status:
            query = query.where(organism_requests.c.status == status)
        with CONTROL_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(query).mappings().all()
        return [dict(row) for row in rows]

    def approve_organism(self, request_id: str, approver_user_id: str) -> dict[str, Any]:
        with CONTROL_PLANE_ENGINE.begin() as conn:
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
        with CONTROL_PLANE_ENGINE.begin() as conn:
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
        report_path = CONTROL_PLANE_REPORT_DIR / f"{summary['validation_id']}.json"
        try:
            case_predictions_path = str(case_path.relative_to(BASE_DIR))
        except ValueError:
            case_predictions_path = str(case_path)
        payload = {
            **summary,
            "case_predictions_path": case_predictions_path,
        }
        try:
            payload["report_path"] = str(report_path.relative_to(BASE_DIR))
        except ValueError:
            payload["report_path"] = str(report_path)
        write_json(report_path, payload)
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
        with CONTROL_PLANE_ENGINE.begin() as conn:
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

    def save_experiment(self, experiment_record: dict[str, Any]) -> dict[str, Any]:
        normalized = dict(experiment_record)
        normalized.setdefault("status", "completed")
        normalized.setdefault("created_at", utc_now())
        experiment_id = str(normalized.get("experiment_id") or "").strip()
        if not experiment_id:
            raise ValueError("experiment_id is required.")
        normalized["experiment_id"] = experiment_id

        report_path_value = str(normalized.get("report_path") or "").strip()
        if report_path_value:
            report_path = Path(report_path_value)
            if not report_path.is_absolute():
                report_path = (BASE_DIR / report_path).resolve()
            if not report_path.exists():
                experiment_report_path = CONTROL_PLANE_EXPERIMENT_DIR / f"{experiment_id}.json"
                write_json(experiment_report_path, normalized)
                normalized["report_path"] = str(experiment_report_path)
        else:
            experiment_report_path = CONTROL_PLANE_EXPERIMENT_DIR / f"{experiment_id}.json"
            write_json(experiment_report_path, normalized)
            normalized["report_path"] = str(experiment_report_path)

        values = {
            "experiment_id": experiment_id,
            "site_id": normalized.get("site_id"),
            "experiment_type": str(normalized.get("experiment_type") or "unknown"),
            "status": str(normalized.get("status") or "completed"),
            "model_version_id": normalized.get("model_version_id"),
            "created_at": normalized.get("created_at"),
            "payload_json": normalized,
        }
        with CONTROL_PLANE_ENGINE.begin() as conn:
            existing = conn.execute(
                select(experiments.c.experiment_id).where(experiments.c.experiment_id == experiment_id)
            ).first()
            if existing:
                conn.execute(update(experiments).where(experiments.c.experiment_id == experiment_id).values(**values))
            else:
                conn.execute(experiments.insert().values(**values))
        return normalized

    def get_experiment(self, experiment_id: str) -> dict[str, Any] | None:
        normalized_id = experiment_id.strip()
        if not normalized_id:
            return None
        with CONTROL_PLANE_ENGINE.begin() as conn:
            row = conn.execute(
                select(experiments).where(experiments.c.experiment_id == normalized_id)
            ).first()
        if row is None:
            return None
        return _payload_record(
            row,
            "payload_json",
            ["experiment_id", "site_id", "experiment_type", "status", "model_version_id", "created_at"],
        )

    def list_experiments(
        self,
        *,
        site_id: str | None = None,
        experiment_type: str | None = None,
        status_filter: str | None = None,
    ) -> list[dict[str, Any]]:
        query = select(experiments)
        if site_id:
            query = query.where(experiments.c.site_id == site_id)
        if experiment_type:
            query = query.where(experiments.c.experiment_type == experiment_type)
        if status_filter:
            query = query.where(experiments.c.status == status_filter)
        query = query.order_by(experiments.c.created_at.desc())
        with CONTROL_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(query).all()
        return [
            _payload_record(
                row,
                "payload_json",
                ["experiment_id", "site_id", "experiment_type", "status", "model_version_id", "created_at"],
            )
            for row in rows
        ]

    def list_model_versions(self) -> list[dict[str, Any]]:
        with CONTROL_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(select(model_versions).order_by(model_versions.c.created_at)).all()
        return [
            item
            for item in (
                _payload_record(row, "payload_json", ["version_id", "version_name", "architecture", "stage", "created_at", "ready", "is_current"])
                for row in rows
            )
            if not item.get("archived", False)
        ]

    def _set_model_current_flag(
        self,
        conn: Any,
        version_id: str,
        is_current: bool,
    ) -> None:
        return self.registry.set_model_current_flag(conn, version_id, is_current)

    def ensure_model_version(self, model_metadata: dict[str, Any]) -> dict[str, Any]:
        return self.registry.ensure_model_version(model_metadata)

    def current_global_model(self) -> dict[str, Any] | None:
        return self.registry.current_global_model()

    def archive_model_version(self, version_id: str) -> dict[str, Any]:
        return self.registry.archive_model_version(version_id)

    def register_model_update(self, update_metadata: dict[str, Any]) -> dict[str, Any]:
        return self.registry.register_model_update(update_metadata)

    def get_model_update(self, update_id: str) -> dict[str, Any] | None:
        return self.registry.get_model_update(update_id)

    def update_model_update(self, update_id: str, updates: dict[str, Any]) -> dict[str, Any]:
        return self.registry.update_model_update(update_id, updates)

    def update_model_update_statuses(self, update_ids: list[str], status: str) -> None:
        return self.registry.update_model_update_statuses(update_ids, status)

    def review_model_update(
        self,
        update_id: str,
        reviewer_user_id: str,
        decision: str,
        reviewer_notes: str = "",
    ) -> dict[str, Any]:
        return self.registry.review_model_update(update_id, reviewer_user_id, decision, reviewer_notes)

    def list_model_updates(self, site_id: str | None = None) -> list[dict[str, Any]]:
        return self.registry.list_model_updates(site_id)

    def register_contribution(self, contribution: dict[str, Any]) -> dict[str, Any]:
        return self.registry.register_contribution(contribution)

    def list_contributions(self, user_id: str | None = None, site_id: str | None = None) -> list[dict[str, Any]]:
        return self.registry.list_contributions(user_id=user_id, site_id=site_id)

    def get_contribution_stats(self, user_id: str | None = None) -> dict[str, Any]:
        return self.registry.get_contribution_stats(user_id)

    def list_aggregations(self) -> list[dict[str, Any]]:
        return self.registry.list_aggregations()

    def register_aggregation(
        self,
        base_model_version_id: str,
        new_model_path: str,
        new_version_name: str,
        architecture: str,
        site_weights: dict[str, int],
        requires_medsam_crop: bool = False,
        decision_threshold: float | None = None,
        threshold_selection_metric: str | None = None,
        threshold_selection_metrics: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return self.registry.register_aggregation(
            base_model_version_id,
            new_model_path,
            new_version_name,
            architecture,
            site_weights,
            requires_medsam_crop=requires_medsam_crop,
            decision_threshold=decision_threshold,
            threshold_selection_metric=threshold_selection_metric,
            threshold_selection_metrics=threshold_selection_metrics,
        )

    def get_public_statistics(self) -> dict[str, Any]:
        """Return aggregated public statistics (no auth required)."""
        from sqlalchemy import func

        with CONTROL_PLANE_ENGINE.begin() as conn:
            # Count sites
            site_count_result = conn.execute(select(func.count()).select_from(sites)).scalar() or 0

            # Get current model version name
            current_model_row = conn.execute(
                select(model_versions.c.version_name)
                .where(model_versions.c.is_current == True)
                .order_by(model_versions.c.created_at.desc())
                .limit(1)
            ).first()
            current_model = current_model_row[0] if current_model_row else None

            # Sum validation run stats for total cases and images
            validation_stats = conn.execute(
                select(
                    func.sum(validation_runs.c.n_cases),
                    func.sum(validation_runs.c.n_images),
                )
            ).first()
            total_cases = validation_stats[0] or 0 if validation_stats else 0
            total_images = validation_stats[1] or 0 if validation_stats else 0

        return {
            "site_count": int(site_count_result),
            "total_cases": int(total_cases),
            "total_images": int(total_images),
            "current_model_version": current_model,
            "last_updated": utc_now(),
        }
