from __future__ import annotations

from typing import Any, Callable

from kera_research.config import (
    CONTROL_PLANE_API_BASE_URL,
    CONTROL_PLANE_ARTIFACT_DIR,
    MODEL_DISTRIBUTION_MODE,
    STORAGE_DIR,
)
from kera_research.db import CONTROL_PLANE_DATABASE_URL, DATA_PLANE_DATABASE_URL
from kera_research.services.onedrive_publisher import OneDrivePublisher


def database_backend_label(database_url: str) -> str:
    normalized = str(database_url or "").strip().lower()
    if normalized.startswith("postgresql"):
        return "postgresql"
    if normalized.startswith("sqlite"):
        return "sqlite"
    return "other"


def build_admin_overview(
    cp: Any,
    user: dict[str, Any],
    *,
    visible_model_updates: Callable[..., list[dict[str, Any]]],
    is_pending_model_update: Callable[[dict[str, Any]], bool],
) -> dict[str, Any]:
    visible_sites = cp.list_sites() if user.get("role") == "admin" else cp.accessible_sites_for_user(user)
    pending_requests = (
        cp.list_access_requests(status="pending")
        if user.get("role") == "admin"
        else cp.list_access_requests(status="pending", site_ids=[site["site_id"] for site in visible_sites])
    )
    visible_updates = [item for item in visible_model_updates(cp, user) if is_pending_model_update(item)]
    current_model = cp.current_global_model()
    overview = {
        "site_count": len(visible_sites),
        "model_version_count": len(cp.list_model_versions()),
        "pending_access_requests": len(pending_requests),
        "pending_model_updates": len(visible_updates),
        "current_model_version": current_model.get("version_name") if current_model else None,
        "federation_setup": {
            "control_plane_split_enabled": CONTROL_PLANE_DATABASE_URL != DATA_PLANE_DATABASE_URL,
            "control_plane_connection_mode": "remote_api_cache" if CONTROL_PLANE_API_BASE_URL else "direct_db",
            "control_plane_backend": database_backend_label(CONTROL_PLANE_DATABASE_URL),
            "data_plane_backend": database_backend_label(DATA_PLANE_DATABASE_URL),
            "control_plane_artifact_dir": str(CONTROL_PLANE_ARTIFACT_DIR),
            "uses_default_control_plane_artifact_dir": CONTROL_PLANE_ARTIFACT_DIR.resolve()
            == (STORAGE_DIR / "control_plane" / "artifacts").resolve(),
            "model_distribution_mode": MODEL_DISTRIBUTION_MODE,
            "onedrive_auto_publish_enabled": OneDrivePublisher().is_configured(),
            "onedrive_root_path": OneDrivePublisher().configuration_summary().get("root_path") or "",
            "onedrive_missing_settings": OneDrivePublisher().configuration_summary().get("missing_settings") or [],
        },
    }
    if user.get("role") == "admin":
        overview["aggregation_count"] = len(cp.list_aggregations())
    return overview
