from __future__ import annotations

import os
import platform
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from kera_research.config import MODEL_ACTIVE_MANIFEST_PATH, MODEL_AUTO_DOWNLOAD, MODEL_DIR, STORAGE_DIR
from kera_research.db import DATABASE_TOPOLOGY
from kera_research.services.control_plane import ControlPlaneStore
from kera_research.services.model_artifacts import ModelArtifactStore


def remote_node_os_info() -> str:
    return f"{platform.system()} {platform.release()} ({platform.machine()})".strip()


def desktop_write_probe(target: Path) -> dict[str, Any]:
    normalized = target.expanduser().resolve()
    result = {
        "path": str(normalized),
        "exists": normalized.exists(),
        "writable": False,
        "detail": "",
    }
    try:
        normalized.mkdir(parents=True, exist_ok=True)
        probe_path = normalized / f".kera-self-check-{int(time.time() * 1000)}.tmp"
        probe_path.write_text("ok", encoding="utf-8")
        probe_path.unlink(missing_ok=True)
        result["exists"] = True
        result["writable"] = True
    except OSError as exc:
        result["detail"] = str(exc)
    return result


def desktop_sqlite_probe(path: Path, *, required: bool) -> dict[str, Any]:
    normalized = path.expanduser().resolve()
    result = {
        "path": str(normalized),
        "exists": normalized.exists(),
        "required": required,
        "ready": False,
        "detail": "",
    }
    try:
        normalized.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(str(normalized))
        try:
            connection.execute("PRAGMA journal_mode=WAL;")
            connection.execute("BEGIN IMMEDIATE")
            connection.execute("ROLLBACK")
        finally:
            connection.close()
        result["exists"] = normalized.exists()
        result["ready"] = True
    except Exception as exc:
        result["detail"] = str(exc)
    return result


def desktop_model_probe(cp: ControlPlaneStore) -> dict[str, Any]:
    artifact_store = ModelArtifactStore()
    active_manifest = artifact_store.active_manifest()
    active_manifest_path = MODEL_ACTIVE_MANIFEST_PATH.expanduser().resolve()
    active_local_path_raw = str(active_manifest.get("local_path") or active_manifest.get("model_path") or "").strip()
    active_local_path = Path(active_local_path_raw).expanduser().resolve() if active_local_path_raw else None
    current_release = cp.current_global_model()
    resolved_model_path = ""
    ready = False
    downloadable = False
    detail = ""

    if current_release is None:
        detail = "No current model release is available from the control plane."
    else:
        try:
            resolved_path = artifact_store.resolve_model_path(current_release, allow_download=False)
            resolved_model_path = str(resolved_path)
            ready = resolved_path.exists()
        except FileNotFoundError as exc:
            detail = str(exc)
            downloadable = MODEL_AUTO_DOWNLOAD and bool(str(current_release.get("download_url") or "").strip())
        except Exception as exc:
            detail = str(exc)

    return {
        "model_dir": str(MODEL_DIR.expanduser().resolve()),
        "model_dir_exists": MODEL_DIR.exists(),
        "active_manifest_path": str(active_manifest_path),
        "active_manifest_exists": active_manifest_path.exists(),
        "active_manifest": active_manifest,
        "active_model_path": str(active_local_path) if active_local_path else "",
        "active_model_exists": bool(active_local_path and active_local_path.exists()),
        "current_release": current_release,
        "resolved_model_path": resolved_model_path,
        "ready": ready,
        "downloadable": downloadable,
        "detail": detail,
    }


def desktop_control_plane_probe(cp: ControlPlaneStore) -> dict[str, Any]:
    configured = cp.remote_control_plane_enabled()
    node_sync_enabled = cp.remote_node_sync_enabled()
    detail = ""
    bootstrap = None
    try:
        if configured:
            bootstrap = cp.remote_bootstrap_state(force_refresh=True)
    except Exception as exc:
        detail = str(exc)
    if configured and node_sync_enabled and bootstrap is None and not detail:
        detail = "Remote control-plane bootstrap is unavailable."
    return {
        "configured": configured,
        "node_sync_enabled": node_sync_enabled,
        "base_url": cp.remote_control_plane.base_url,
        "node_id": cp.remote_control_plane.node_id,
        "bootstrap": bootstrap,
        "ready": bool(configured and node_sync_enabled and bootstrap is not None),
        "detail": detail,
    }


def desktop_app_data_dir() -> Path:
    configured = (
        str(os.getenv("KERA_DESKTOP_APP_DATA_DIR") or "").strip()
        or str(os.getenv("KERA_DESKTOP_APPDATA_DIR") or "").strip()
    )
    if configured:
        return Path(configured).expanduser().resolve()

    if platform.system().lower().startswith("win"):
        local_app_data = str(os.getenv("LOCALAPPDATA") or "").strip()
        if local_app_data:
            return (Path(local_app_data).expanduser().resolve() / "KERA").resolve()

    xdg_data_home = str(os.getenv("XDG_DATA_HOME") or "").strip()
    if xdg_data_home:
        return (Path(xdg_data_home).expanduser().resolve() / "KERA").resolve()

    return (Path.home().expanduser().resolve() / ".local" / "share" / "KERA").resolve()


def desktop_self_check(cp: ControlPlaneStore) -> dict[str, Any]:
    storage_root = STORAGE_DIR.expanduser().resolve()
    runtime_dir = desktop_app_data_dir() / "runtime"
    control_plane_cache_required = bool(DATABASE_TOPOLOGY.get("control_plane_split_enabled"))
    return {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "storage": {
            "storage_dir": desktop_write_probe(storage_root),
            "runtime_dir": desktop_write_probe(runtime_dir),
        },
        "data_plane_database": desktop_sqlite_probe(storage_root / "kera.db", required=True),
        "control_plane_cache_database": desktop_sqlite_probe(
            storage_root / "control_plane_cache.db",
            required=control_plane_cache_required,
        ),
        "control_plane": desktop_control_plane_probe(cp),
        "model_artifacts": desktop_model_probe(cp),
    }
