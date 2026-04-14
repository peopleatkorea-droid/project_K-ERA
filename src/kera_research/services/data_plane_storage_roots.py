from __future__ import annotations

import os
import re
import threading
from pathlib import Path

from sqlalchemy import select

from kera_research.config import (
    BASE_DIR,
    STORAGE_DIR,
    SITE_ROOT_DIR,
    remap_bundle_absolute_path,
    resolve_portable_path,
)
from kera_research.db import (
    CONTROL_PLANE_DATABASE_URL,
    CONTROL_PLANE_ENGINE,
    DATA_PLANE_DATABASE_URL,
    DATABASE_TOPOLOGY,
    app_settings,
    sites as control_sites,
)

_SITE_STORAGE_ROOT_CACHE: dict[str, Path] = {}
_SITE_STORAGE_ROOT_CACHE_LOCK = threading.Lock()
_INSTANCE_STORAGE_ROOT_SETTING_KEY = "instance_storage_root"


def control_plane_split_enabled() -> bool:
    return CONTROL_PLANE_DATABASE_URL != DATA_PLANE_DATABASE_URL


def _site_storage_lookup_mode() -> str:
    mode = os.getenv("KERA_SITE_STORAGE_SOURCE", "").strip().lower()
    if mode == "control_plane":
        return "control_plane"
    if mode == "local":
        return "local"
    return "auto"


def site_storage_uses_control_plane() -> bool:
    lookup_mode = _site_storage_lookup_mode()
    if lookup_mode == "local":
        return False
    if lookup_mode == "control_plane":
        return True
    if not bool(DATABASE_TOPOLOGY.get("control_plane_split_enabled")):
        return True
    if str(DATABASE_TOPOLOGY.get("control_plane_connection_mode") or "").strip().lower() == "remote_api_cache":
        return True
    return not tuple(DATABASE_TOPOLOGY.get("split_database_env_names") or ())


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


def resolve_site_storage_root(site_id: str) -> Path:
    with _SITE_STORAGE_ROOT_CACHE_LOCK:
        cached = _SITE_STORAGE_ROOT_CACHE.get(site_id)
        if cached is not None:
            return cached

    resolved_root = (SITE_ROOT_DIR / site_id).resolve()
    if site_storage_uses_control_plane():
        try:
            configured_root = _control_plane_root_override(site_id)
        except Exception:
            configured_root = None
        if configured_root is not None:
            resolved_root = configured_root.resolve()

    with _SITE_STORAGE_ROOT_CACHE_LOCK:
        _SITE_STORAGE_ROOT_CACHE[site_id] = resolved_root
    return resolved_root


def safe_path_component(value: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9._-]+", "_", str(value or "").strip())
    return normalized or "unknown"


def sqlite_path_from_url(database_url: str | None) -> Path | None:
    raw = str(database_url or "").strip()
    if not raw.startswith("sqlite:///"):
        return None
    candidate = raw[len("sqlite:///") :]
    if re.match(r"^/[A-Za-z]:/", candidate):
        candidate = candidate[1:]
    if not candidate:
        return None
    return Path(candidate).expanduser().resolve()
