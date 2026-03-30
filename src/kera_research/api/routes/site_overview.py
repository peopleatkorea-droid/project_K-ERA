import logging
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, status

from kera_research.api.control_plane_proxy import (
    call_remote_control_plane_method,
    remote_control_plane_is_primary,
    site_record_for_request,
)
from kera_research.api.routes.site_shared import (
    ResearchRegistryConsentRequest,
    ResearchRegistrySettingsRequest,
    assert_site_access_only,
    build_local_summary,
    build_site_summary_counts,
)

logger = logging.getLogger(__name__)
TIMING_LOGS_ENABLED = str(os.getenv("KERA_BOOTSTRAP_TIMING_LOGS") or "").strip() == "1"

_REPO_ROOT = Path(__file__).resolve().parents[4]
_CLUSTER_VIZ_HTML = _REPO_ROOT / "artifacts" / "dinov2_cluster_3d" / "cluster_3d.html"
_VISUALIZE_SCRIPT = _REPO_ROOT / "scripts" / "visualize_dinov2_clusters_3d.py"


def build_site_overview_router(support: Any) -> APIRouter:
    router = APIRouter()

    get_control_plane = support.get_control_plane
    get_approved_user = support.get_approved_user
    require_admin_workspace_permission = support.require_admin_workspace_permission
    require_site_access = support.require_site_access
    user_can_access_site = support.user_can_access_site
    control_plane_split_enabled = support.control_plane_split_enabled
    local_site_records_for_user = support.local_site_records_for_user
    build_site_activity = support.build_site_activity

    @router.get("/api/sites")
    def list_sites(
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
        authorization: str | None = Header(default=None),
        control_plane_owner: str | None = Header(default=None, alias="x-kera-control-plane-owner"),
    ) -> list[dict[str, Any]]:
        remote_sites = call_remote_control_plane_method(
            cp,
            authorization=authorization,
            control_plane_owner=control_plane_owner,
            method_name="main_sites",
        )
        if remote_sites is not None:
            return remote_sites
        if remote_control_plane_is_primary(cp, control_plane_owner=control_plane_owner):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Central control plane sites are unavailable.",
            )
        accessible_sites = cp.accessible_sites_for_user(user)
        if accessible_sites:
            return accessible_sites
        if control_plane_split_enabled():
            return local_site_records_for_user(user)
        return []

    @router.get("/api/sites/{site_id}/summary")
    def site_summary(
        site_id: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
        authorization: str | None = Header(default=None),
        control_plane_owner: str | None = Header(default=None, alias="x-kera-control-plane-owner"),
        ) -> dict[str, Any]:
        started_at = time.perf_counter()
        site_store = require_site_access(cp, user, site_id)
        stats_started_at = time.perf_counter()
        stats = site_store.site_summary_stats()
        stats_elapsed_ms = (time.perf_counter() - stats_started_at) * 1000.0
        validation_started_at = time.perf_counter()
        validation_summary = cp.validation_run_summary(site_id=site_id)
        validation_elapsed_ms = (time.perf_counter() - validation_started_at) * 1000.0
        latest_run = validation_summary.get("latest_run")
        validation_run_count = int(validation_summary.get("count") or 0)
        site_record_started_at = time.perf_counter()
        site_record = site_record_for_request(
            cp,
            site_id=site_id,
            authorization=authorization,
            control_plane_owner=control_plane_owner,
        ) or {}
        site_record_elapsed_ms = (time.perf_counter() - site_record_started_at) * 1000.0
        consent_started_at = time.perf_counter()
        consent = cp.get_registry_consent(user["user_id"], site_id)
        consent_elapsed_ms = (time.perf_counter() - consent_started_at) * 1000.0
        total_elapsed_ms = (time.perf_counter() - started_at) * 1000.0
        if TIMING_LOGS_ENABLED:
            logger.info(
                "site_summary_timing site_id=%s stats_ms=%.1f validation_ms=%.1f site_record_ms=%.1f consent_ms=%.1f total_ms=%.1f",
                site_id,
                stats_elapsed_ms,
                validation_elapsed_ms,
                site_record_elapsed_ms,
                consent_elapsed_ms,
                total_elapsed_ms,
            )
        if not site_record and control_plane_split_enabled():
            summary = build_local_summary(site_store, site_id)
            summary["n_validation_runs"] = validation_run_count
            summary["latest_validation"] = latest_run
            return summary
        return {
            "site_id": site_id,
            "n_patients": stats["n_patients"],
            "n_visits": stats["n_visits"],
            "n_images": stats["n_images"],
            "n_active_visits": stats["n_active_visits"],
            "n_fungal_visits": stats["n_fungal_visits"],
            "n_bacterial_visits": stats["n_bacterial_visits"],
            "n_validation_runs": validation_run_count,
            "latest_validation": latest_run,
            "research_registry": {
                "site_enabled": bool(site_record.get("research_registry_enabled", True)),
                "user_enrolled": consent is not None,
                "user_enrolled_at": consent.get("enrolled_at") if consent else None,
                "included_cases": stats["n_included_visits"],
                "excluded_cases": stats["n_excluded_visits"],
            },
        }

    @router.get("/api/sites/{site_id}/summary/counts")
    def site_summary_counts(
        site_id: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        site_store = require_site_access(cp, user, site_id)
        return build_site_summary_counts(site_store, site_id)

    @router.get("/api/sites/{site_id}/research-registry/settings")
    def get_research_registry_settings(
        site_id: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
        authorization: str | None = Header(default=None),
        control_plane_owner: str | None = Header(default=None, alias="x-kera-control-plane-owner"),
    ) -> dict[str, Any]:
        assert_site_access_only(user, site_id, user_can_access_site=user_can_access_site)
        site_record = site_record_for_request(
            cp,
            site_id=site_id,
            authorization=authorization,
            control_plane_owner=control_plane_owner,
        )
        if site_record is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown site.")
        consent = cp.get_registry_consent(user["user_id"], site_id)
        return {
            "site_id": site_id,
            "research_registry_enabled": bool(site_record.get("research_registry_enabled", True)),
            "user_enrolled": consent is not None,
            "user_enrolled_at": consent.get("enrolled_at") if consent else None,
        }

    @router.patch("/api/sites/{site_id}/research-registry/settings")
    def update_research_registry_settings(
        site_id: str,
        payload: ResearchRegistrySettingsRequest,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
        authorization: str | None = Header(default=None),
        control_plane_owner: str | None = Header(default=None, alias="x-kera-control-plane-owner"),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        assert_site_access_only(user, site_id, user_can_access_site=user_can_access_site)
        site_record = site_record_for_request(
            cp,
            site_id=site_id,
            authorization=authorization,
            control_plane_owner=control_plane_owner,
        )
        if site_record is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown site.")
        remote_site = call_remote_control_plane_method(
            cp,
            authorization=authorization,
            control_plane_owner=control_plane_owner,
            method_name="main_admin_update_site",
            site_id=site_id,
            payload_json={"research_registry_enabled": payload.research_registry_enabled},
        )
        if remote_site is not None:
            return {
                "site_id": site_id,
                "research_registry_enabled": bool(remote_site.get("research_registry_enabled", True)),
            }
        if remote_control_plane_is_primary(cp, control_plane_owner=control_plane_owner):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Central control plane site settings are unavailable.",
            )
        updated = cp.update_site_metadata(
            site_id,
            str(site_record.get("display_name") or site_id),
            str(site_record.get("hospital_name") or ""),
            research_registry_enabled=payload.research_registry_enabled,
        )
        return {
            "site_id": site_id,
            "research_registry_enabled": bool(updated.get("research_registry_enabled", True)),
        }

    @router.post("/api/sites/{site_id}/research-registry/consent")
    def enroll_research_registry(
        site_id: str,
        payload: ResearchRegistryConsentRequest,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
        authorization: str | None = Header(default=None),
        control_plane_owner: str | None = Header(default=None, alias="x-kera-control-plane-owner"),
    ) -> dict[str, Any]:
        assert_site_access_only(user, site_id, user_can_access_site=user_can_access_site)
        site_record = site_record_for_request(
            cp,
            site_id=site_id,
            authorization=authorization,
            control_plane_owner=control_plane_owner,
        )
        if site_record is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown site.")
        if not bool(site_record.get("research_registry_enabled", True)):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This site's research registry is disabled by the institution.",
            )
        updated_user = cp.set_registry_consent(user["user_id"], site_id, version=payload.version)
        consent = cp.get_registry_consent(updated_user["user_id"], site_id)
        return {
            "site_id": site_id,
            "user_enrolled": consent is not None,
            "user_enrolled_at": consent.get("enrolled_at") if consent else None,
        }

    @router.get("/api/sites/{site_id}/activity")
    def site_activity(
        site_id: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        assert_site_access_only(user, site_id, user_can_access_site=user_can_access_site)
        return build_site_activity(cp, site_id, current_user_id=user["user_id"])

    @router.get("/api/sites/{site_id}/explore/cluster-visualization/status")
    def explore_cluster_status(
        site_id: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        assert_site_access_only(user, site_id, user_can_access_site=user_can_access_site)
        if not _CLUSTER_VIZ_HTML.exists():
            return {"exists": False, "generated_at": None, "size_bytes": 0}
        stat = _CLUSTER_VIZ_HTML.stat()
        generated_at = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()
        return {"exists": True, "generated_at": generated_at, "size_bytes": stat.st_size}

    @router.get("/api/sites/{site_id}/explore/cluster-visualization")
    def explore_cluster_html(
        site_id: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        assert_site_access_only(user, site_id, user_can_access_site=user_can_access_site)
        if not _CLUSTER_VIZ_HTML.exists():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cluster visualization has not been generated yet.")
        return {"html": _CLUSTER_VIZ_HTML.read_text(encoding="utf-8")}

    @router.post("/api/sites/{site_id}/explore/cluster-visualization/regenerate")
    def explore_cluster_regenerate(
        site_id: str,
        backbone: str = "official",
        crop_mode: str = "full",
        view_filter: str = "all",
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        assert_site_access_only(user, site_id, user_can_access_site=user_can_access_site)
        if backbone not in ("official", "ssl"):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Invalid backbone: {backbone}")
        if crop_mode not in ("full", "cornea_roi", "lesion_crop"):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Invalid crop_mode: {crop_mode}")
        if view_filter not in ("all", "white", "slit", "fluorescein"):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Invalid view_filter: {view_filter}")
        if not _VISUALIZE_SCRIPT.exists():
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Visualization script not found.")
        cmd = [
            sys.executable, str(_VISUALIZE_SCRIPT),
            "--site-id", site_id,
            "--backbone", backbone,
            "--crop-mode", crop_mode,
            "--view-filter", view_filter,
            "--device", "auto",
        ]
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=600,
        )
        if result.returncode != 0:
            logger.error("cluster viz regeneration failed: %s", result.stderr[-2000:])
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Regeneration failed: {result.stderr[-500:]}",
            )
        if not _CLUSTER_VIZ_HTML.exists():
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Script ran but output file not found.")
        stat = _CLUSTER_VIZ_HTML.stat()
        generated_at = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()
        return {"ok": True, "generated_at": generated_at, "size_bytes": stat.st_size}

    return router
