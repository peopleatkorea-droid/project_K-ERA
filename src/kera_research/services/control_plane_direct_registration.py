from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
from datetime import datetime, timezone
from functools import lru_cache
from typing import Any
from uuid import uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from kera_research.services.remote_control_plane import RemoteControlPlaneClient


def _direct_control_plane_database_url() -> str:
    for env_name in (
        "KERA_CONTROL_PLANE_DATABASE_URL",
        "KERA_AUTH_DATABASE_URL",
        "KERA_DATABASE_URL",
        "DATABASE_URL",
        "POSTGRES_URL",
    ):
        value = str(os.getenv(env_name) or "").strip()
        if value.startswith("postgresql") or value.startswith("postgres"):
            return value
    return ""


def direct_control_plane_registration_supported() -> bool:
    return bool(_direct_control_plane_database_url())


@lru_cache(maxsize=1)
def _direct_control_plane_engine() -> Engine:
    database_url = _direct_control_plane_database_url()
    if not database_url:
        raise RuntimeError("Direct control-plane database access is not configured on this desktop.")
    return create_engine(
        database_url,
        pool_pre_ping=True,
        pool_size=4,
        max_overflow=4,
        pool_recycle=180,
    )


def _make_control_plane_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex}"


def _make_node_token() -> str:
    return base64.urlsafe_b64encode(secrets.token_bytes(32)).decode("ascii").rstrip("=")


def _hash_node_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_main_auth_user(payload: dict[str, Any]) -> dict[str, Any]:
    user = payload.get("user") if isinstance(payload.get("user"), dict) else None
    if not isinstance(user, dict):
        raise RuntimeError("The operations hub did not return a valid admin user session.")
    user_id = str(user.get("user_id") or "").strip()
    if not user_id:
        raise RuntimeError("The operations hub session is missing a user_id.")
    site_ids = [
        str(site_id).strip()
        for site_id in user.get("site_ids") or []
        if str(site_id).strip()
    ]
    return {
        "user_id": user_id,
        "role": str(user.get("role") or user.get("global_role") or "member").strip().lower() or "member",
        "site_ids": site_ids,
    }


def _ensure_default_project(conn: Any, *, now: datetime) -> None:
    now_iso = now.isoformat()
    conn.execute(
        text(
            """
            insert into projects (
              project_id,
              name,
              description,
              owner_user_id,
              site_ids,
              created_at,
              updated_at
            ) values (
              'project_default',
              'K-ERA Default Project',
              '',
              'system',
              '[]'::jsonb,
              :created_at,
              :updated_at
            )
            on conflict (project_id) do nothing
            """
        ),
        {
            "created_at": now_iso,
            "updated_at": now,
        },
    )


def register_main_admin_node_via_direct_db(
    *,
    remote_client: RemoteControlPlaneClient,
    user_bearer_token: str,
    device_name: str,
    os_info: str = "",
    app_version: str = "",
    site_id: str | None = None,
    display_name: str | None = None,
    hospital_name: str | None = None,
    source_institution_id: str | None = None,
) -> dict[str, Any]:
    if not direct_control_plane_registration_supported():
        raise RuntimeError("Direct control-plane registration is not available on this desktop.")

    auth_payload = remote_client.main_auth_me(user_bearer_token=user_bearer_token)
    actor = _normalize_main_auth_user(auth_payload)
    actor_user_id = str(actor["user_id"])
    actor_role = str(actor["role"])
    actor_site_ids = set(actor["site_ids"])

    normalized_site_id = str(site_id or "").strip()
    if not normalized_site_id:
        if len(actor_site_ids) == 1:
            normalized_site_id = next(iter(actor_site_ids))
        else:
            raise RuntimeError("Pick a hospital before reconnecting the operations hub.")

    resolved_display_name = str(display_name or "").strip()
    resolved_hospital_name = str(hospital_name or "").strip() or resolved_display_name or normalized_site_id
    resolved_source_institution_id = str(source_institution_id or "").strip() or None

    node_id = _make_control_plane_id("node")
    node_token = _make_node_token()
    now = _now_utc()

    with _direct_control_plane_engine().begin() as conn:
        user_row = conn.execute(
            text(
                """
                select user_id, global_role, status
                from users
                where user_id = :user_id
                limit 1
                """
            ),
            {"user_id": actor_user_id},
        ).mappings().first()
        if not user_row:
            raise RuntimeError("The operations hub user does not exist in the shared control-plane database.")
        if str(user_row.get("status") or "active").strip().lower() == "disabled":
            raise RuntimeError("The operations hub user is disabled.")

        site_row = conn.execute(
            text(
                """
                select site_id, project_id, display_name, hospital_name, source_institution_id, status
                from sites
                where site_id = :site_id
                limit 1
                """
            ),
            {"site_id": normalized_site_id},
        ).mappings().first()

        if not site_row:
            if actor_role != "admin":
                raise RuntimeError("The selected hospital does not exist in the operations hub.")
            if not resolved_display_name and not resolved_hospital_name:
                raise RuntimeError("The selected hospital is missing display metadata.")
            _ensure_default_project(conn, now=now)
            conn.execute(
                text(
                    """
                    insert into sites (
                      site_id,
                      project_id,
                      display_name,
                      hospital_name,
                      source_institution_id,
                      local_storage_root,
                      research_registry_enabled,
                      created_at,
                      status,
                      updated_at
                    ) values (
                      :site_id,
                      'project_default',
                      :display_name,
                      :hospital_name,
                      :source_institution_id,
                      '',
                      true,
                      :created_at,
                      'active',
                      :updated_at
                    )
                    """
                ),
                {
                    "site_id": normalized_site_id,
                    "display_name": resolved_display_name,
                    "hospital_name": resolved_hospital_name,
                    "source_institution_id": resolved_source_institution_id,
                    "created_at": now.isoformat(),
                    "updated_at": now,
                },
            )

        membership_row = conn.execute(
            text(
                """
                select membership_id, status
                from site_memberships
                where user_id = :user_id and site_id = :site_id
                limit 1
                """
            ),
            {
                "user_id": actor_user_id,
                "site_id": normalized_site_id,
            },
        ).mappings().first()

        if not membership_row or str(membership_row.get("status") or "").strip().lower() != "approved":
            if actor_role != "admin" and normalized_site_id not in actor_site_ids:
                raise RuntimeError("This account does not have access to the selected hospital.")
            membership_id = (
                str(membership_row.get("membership_id") or "").strip()
                if membership_row
                else ""
            ) or _make_control_plane_id("membership")
            conn.execute(
                text(
                    """
                    insert into site_memberships (
                      membership_id,
                      user_id,
                      site_id,
                      role,
                      status,
                      approved_at,
                      created_at,
                      updated_at
                    ) values (
                      :membership_id,
                      :user_id,
                      :site_id,
                      :role,
                      'approved',
                      :approved_at,
                      :created_at,
                      :updated_at
                    )
                    on conflict (user_id, site_id) do update set
                      role = excluded.role,
                      status = 'approved',
                      approved_at = coalesce(site_memberships.approved_at, excluded.approved_at),
                      updated_at = excluded.updated_at
                    """
                ),
                {
                    "membership_id": membership_id,
                    "user_id": actor_user_id,
                    "site_id": normalized_site_id,
                    "role": "site_admin" if actor_role == "admin" else "member",
                    "approved_at": now,
                    "created_at": now,
                    "updated_at": now,
                },
            )

        conn.execute(
            text(
                """
                insert into nodes (
                  node_id,
                  site_id,
                  registered_by_user_id,
                  device_name,
                  os_info,
                  app_version,
                  token_hash,
                  status,
                  last_seen_at,
                  created_at,
                  updated_at
                ) values (
                  :node_id,
                  :site_id,
                  :registered_by_user_id,
                  :device_name,
                  :os_info,
                  :app_version,
                  :token_hash,
                  'active',
                  :last_seen_at,
                  :created_at,
                  :updated_at
                )
                """
            ),
            {
                "node_id": node_id,
                "site_id": normalized_site_id,
                "registered_by_user_id": actor_user_id,
                "device_name": str(device_name or "").strip() or "local-node",
                "os_info": str(os_info or "").strip(),
                "app_version": str(app_version or "").strip(),
                "token_hash": _hash_node_token(node_token),
                "last_seen_at": now,
                "created_at": now,
                "updated_at": now,
            },
        )
        conn.execute(
            text(
                """
                insert into audit_events (
                  event_id,
                  actor_type,
                  actor_id,
                  action,
                  target_type,
                  target_id,
                  payload_json,
                  created_at
                ) values (
                  :event_id,
                  'user',
                  :actor_id,
                  'node.registered',
                  'node',
                  :target_id,
                  cast(:payload_json as jsonb),
                  :created_at
                )
                """
            ),
            {
                "event_id": _make_control_plane_id("audit"),
                "actor_id": actor_user_id,
                "target_id": node_id,
                "payload_json": json.dumps(
                    {
                        "site_id": normalized_site_id,
                        "device_name": str(device_name or "").strip() or "local-node",
                        "registration_source": "desktop_direct_db",
                    }
                ),
                "created_at": now,
            },
        )

    return {
        "node_id": node_id,
        "node_token": node_token,
        "site_id": normalized_site_id,
    }
