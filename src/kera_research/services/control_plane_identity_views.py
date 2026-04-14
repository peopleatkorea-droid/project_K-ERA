from __future__ import annotations

import hashlib
import json
from typing import Any, Callable

from sqlalchemy import delete, select, update

from kera_research.config import PUBLIC_ALIAS_SALT
from kera_research.db import CONTROL_PLANE_ENGINE, access_requests, users
from kera_research.domain import make_id, utc_now
from kera_research.passwords import (
    argon2_hash_needs_rehash,
    is_argon2_hash,
    is_bcrypt_hash,
    is_pbkdf2_sha256_hash,
    verify_argon2_password,
    verify_bcrypt_password,
    verify_pbkdf2_sha256_hash,
)

def _normalize_site_ids(value: Any) -> list[str]:
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return []
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            parsed = None
        if parsed is not None and parsed != value:
            return _normalize_site_ids(parsed)
        values = [text]
    elif isinstance(value, (list, tuple, set)):
        values = list(value)
    elif value is None:
        values = []
    else:
        try:
            values = list(value)
        except TypeError:
            values = [value]
    normalized: list[str] = []
    seen: set[str] = set()
    for entry in values:
        text = str(entry or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        normalized.append(text)
    return normalized


class ControlPlaneIdentityFacade:
    def __init__(
        self,
        store: Any,
        *,
        google_auth_sentinel: str,
        normalize_registry_consents: Callable[[Any], dict[str, dict[str, Any]]],
        normalize_password_storage: Callable[[str], str],
        normalize_public_alias_token: Callable[[str], str | None],
        make_public_alias: Callable[..., str],
    ) -> None:
        self.store = store
        self.google_auth_sentinel = google_auth_sentinel
        self.normalize_registry_consents = normalize_registry_consents
        self.normalize_password_storage = normalize_password_storage
        self.normalize_public_alias_token = normalize_public_alias_token
        self.make_public_alias = make_public_alias

    def _public_alias_seed(self, user_record: dict[str, Any]) -> str:
        google_sub = str(user_record.get("google_sub") or "").strip()
        if google_sub:
            return f"google:{google_sub}"
        user_id = str(user_record.get("user_id") or "").strip()
        if user_id:
            return f"user:{user_id}"
        return ""

    def _ensure_public_alias_for_record(
        self,
        conn: Any,
        user_record: dict[str, Any],
        *,
        persist: bool = True,
    ) -> str | None:
        existing_alias = str(user_record.get("public_alias") or "").strip()
        user_id = str(user_record.get("user_id") or "").strip()
        if existing_alias:
            normalized_existing_alias = self.normalize_public_alias_token(existing_alias)
            if normalized_existing_alias:
                if normalized_existing_alias != existing_alias and user_id and persist:
                    owner_user_id = conn.execute(
                        select(users.c.user_id).where(users.c.public_alias == normalized_existing_alias)
                    ).scalar_one_or_none()
                    if owner_user_id is None or str(owner_user_id) == user_id:
                        conn.execute(
                            update(users)
                            .where(users.c.user_id == user_id)
                            .values(public_alias=normalized_existing_alias)
                        )
                        user_record["public_alias"] = normalized_existing_alias
                        return normalized_existing_alias
                return normalized_existing_alias

        alias_seed = self._public_alias_seed(user_record)
        if not user_id or not alias_seed:
            return existing_alias or None

        for attempt in range(256):
            candidate = self.make_public_alias(alias_seed, attempt=attempt)
            owner_user_id = conn.execute(select(users.c.user_id).where(users.c.public_alias == candidate)).scalar_one_or_none()
            if owner_user_id is None or str(owner_user_id) == user_id:
                if persist:
                    conn.execute(update(users).where(users.c.user_id == user_id).values(public_alias=candidate))
                    user_record["public_alias"] = candidate
                return candidate

        fallback_suffix = hashlib.sha256(f"{PUBLIC_ALIAS_SALT}::{alias_seed}".encode("utf-8")).hexdigest()[:6].lower()
        fallback_alias = f"anonymous_member_{fallback_suffix}"
        if persist:
            conn.execute(update(users).where(users.c.user_id == user_id).values(public_alias=fallback_alias))
            user_record["public_alias"] = fallback_alias
        return fallback_alias

    def authenticate(self, username: str, password: str) -> dict[str, Any] | None:
        query = select(users).where(users.c.username == username)
        with CONTROL_PLANE_ENGINE.begin() as conn:
            row = conn.execute(query).mappings().first()
        if row is None:
            return None
        user_record = dict(row)
        stored = user_record.get("password", "")
        if stored == self.google_auth_sentinel:
            return None
        if is_argon2_hash(stored):
            if not verify_argon2_password(password, stored):
                return None
            if argon2_hash_needs_rehash(stored):
                migrated_password = self.normalize_password_storage(password)
                with CONTROL_PLANE_ENGINE.begin() as conn:
                    conn.execute(
                        update(users)
                        .where(users.c.user_id == user_record["user_id"])
                        .values(password=migrated_password)
                    )
                user_record["password"] = migrated_password
            return self.serialize_user(user_record)
        if is_bcrypt_hash(stored):
            if not verify_bcrypt_password(password, stored):
                return None
            migrated_password = self.normalize_password_storage(password)
            with CONTROL_PLANE_ENGINE.begin() as conn:
                conn.execute(
                    update(users)
                    .where(users.c.user_id == user_record["user_id"])
                    .values(password=migrated_password)
                )
            user_record["password"] = migrated_password
            return self.serialize_user(user_record)
        if is_pbkdf2_sha256_hash(stored):
            if not verify_pbkdf2_sha256_hash(password, stored):
                return None
            migrated_password = self.normalize_password_storage(password)
            with CONTROL_PLANE_ENGINE.begin() as conn:
                conn.execute(
                    update(users)
                    .where(users.c.user_id == user_record["user_id"])
                    .values(password=migrated_password)
                )
            user_record["password"] = migrated_password
            return self.serialize_user(user_record)
        return None

    def serialize_user(self, user_record: dict[str, Any]) -> dict[str, Any]:
        serialized = dict(user_record)
        serialized["site_ids"] = _normalize_site_ids(serialized.get("site_ids"))
        serialized["registry_consents"] = self.normalize_registry_consents(serialized.get("registry_consents"))
        if not str(serialized.get("public_alias") or "").strip():
            with CONTROL_PLANE_ENGINE.begin() as conn:
                serialized["public_alias"] = self._ensure_public_alias_for_record(conn, serialized, persist=True)
        else:
            serialized["public_alias"] = str(serialized.get("public_alias") or "").strip()
        serialized["approval_status"] = self.user_approval_status(serialized)
        serialized["latest_access_request"] = self.latest_access_request(serialized["user_id"])
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

    def get_user_public_alias(self, user_id: str) -> str | None:
        normalized_user_id = str(user_id or "").strip()
        if not normalized_user_id:
            return None
        with CONTROL_PLANE_ENGINE.begin() as conn:
            row = conn.execute(select(users).where(users.c.user_id == normalized_user_id)).mappings().first()
            if row is None:
                return None
            return self._ensure_public_alias_for_record(conn, dict(row), persist=True)

    def list_user_public_aliases(self, user_ids: list[str]) -> dict[str, str]:
        normalized_user_ids = list(
            dict.fromkeys(str(user_id).strip() for user_id in user_ids if str(user_id).strip())
        )
        if not normalized_user_ids:
            return {}
        aliases: dict[str, str] = {}
        with CONTROL_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(select(users).where(users.c.user_id.in_(normalized_user_ids))).mappings().all()
            for row in rows:
                record = dict(row)
                alias = self._ensure_public_alias_for_record(conn, record, persist=True)
                if alias:
                    aliases[str(record["user_id"])] = alias
        return aliases

    def delete_user(self, user_id: str) -> None:
        with CONTROL_PLANE_ENGINE.begin() as conn:
            conn.execute(delete(users).where(users.c.user_id == user_id))

    def upsert_user(self, user_record: dict[str, Any]) -> dict[str, Any]:
        normalized_site_ids = _normalize_site_ids(user_record.get("site_ids"))
        normalized = {
            **user_record,
            "username": user_record["username"].strip().lower(),
            "site_ids": normalized_site_ids,
        }
        normalized["registry_consents"] = self.normalize_registry_consents(normalized.get("registry_consents"))
        normalized["password"] = self.normalize_password_storage(str(normalized.get("password") or ""))
        if "google_sub" in normalized:
            normalized["google_sub"] = str(normalized.get("google_sub") or "").strip() or None
        if "public_alias" in normalized:
            normalized["public_alias"] = self.normalize_public_alias_token(str(normalized.get("public_alias") or "").strip()) or None
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
            if existing_by_email.get("password") != self.google_auth_sentinel:
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
                "password": self.google_auth_sentinel,
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
        consents = self.normalize_registry_consents(user.get("registry_consents"))
        return consents.get(site_id)

    def set_registry_consent(self, user_id: str, site_id: str, *, version: str = "v1") -> dict[str, Any]:
        user = self.load_user_by_id(user_id)
        if user is None:
            raise ValueError(f"Unknown user_id: {user_id}")
        consents = self.normalize_registry_consents(user.get("registry_consents"))
        consents[site_id] = {
            "enrolled_at": utc_now(),
            "version": version.strip() or "v1",
        }
        return self.upsert_user({**user, "registry_consents": consents})

    def user_approval_status(self, user: dict[str, Any]) -> str:
        if user.get("role") == "admin":
            return "approved"
        if user.get("password") != self.google_auth_sentinel:
            return "approved"
        if _normalize_site_ids(user.get("site_ids")):
            return "approved"
        latest_request = self.latest_access_request(user["user_id"])
        if latest_request is None:
            return "application_required"
        return latest_request.get("status", "application_required")

    def _serialize_access_request(self, request_record: dict[str, Any]) -> dict[str, Any]:
        serialized = dict(request_record)
        serialized["requested_site_label"] = str(serialized.get("requested_site_label") or "").strip()
        serialized["requested_site_source"] = str(serialized.get("requested_site_source") or "site").strip() or "site"
        serialized["resolved_site_id"] = None
        serialized["resolved_site_label"] = None

        requested_site_id = str(serialized.get("requested_site_id") or "").strip()
        if not requested_site_id:
            return serialized

        site = self.store.get_site(requested_site_id)
        if site is not None:
            if not serialized["requested_site_label"]:
                serialized["requested_site_label"] = self.store.site_display_label(site, requested_site_id)
            serialized["requested_site_source"] = "site"
            serialized["resolved_site_id"] = str(site.get("site_id") or requested_site_id)
            serialized["resolved_site_label"] = self.store.site_display_label(site, requested_site_id)
            return serialized

        mapped_site = self.store.get_site_by_source_institution_id(requested_site_id)
        if mapped_site is not None:
            serialized["resolved_site_id"] = str(mapped_site.get("site_id") or "")
            serialized["resolved_site_label"] = self.store.site_display_label(
                mapped_site,
                serialized["resolved_site_id"],
            )

        institution = self.store.get_institution(requested_site_id)
        if institution is not None:
            if not serialized["requested_site_label"]:
                serialized["requested_site_label"] = str(institution.get("name") or requested_site_id)
            serialized["requested_site_source"] = "institution_directory"
        return serialized

    def submit_access_request(
        self,
        user_id: str,
        requested_site_id: str,
        requested_role: str,
        message: str = "",
        *,
        requested_site_label: str = "",
        requested_site_source: str = "site",
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
            "requested_site_label": requested_site_label.strip(),
            "requested_site_source": requested_site_source.strip() or "site",
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
        return self._serialize_access_request(request_record)

    def latest_access_request(self, user_id: str) -> dict[str, Any] | None:
        query = select(access_requests).where(access_requests.c.user_id == user_id).order_by(access_requests.c.created_at.desc())
        with CONTROL_PLANE_ENGINE.begin() as conn:
            row = conn.execute(query).mappings().first()
        return self._serialize_access_request(dict(row)) if row else None

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
        return [self._serialize_access_request(dict(row)) for row in rows]

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
                next_site_ids = [site_id] if site_id else []
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
        allowed_site_ids = set(_normalize_site_ids(user.get("site_ids")))
        return [site for site in all_sites if site["site_id"] in allowed_site_ids]

    def user_can_access_site(self, user: dict[str, Any], site_id: str | None) -> bool:
        if not site_id:
            return False
        if user.get("role") == "admin":
            return True
        return site_id in set(_normalize_site_ids(user.get("site_ids")))
