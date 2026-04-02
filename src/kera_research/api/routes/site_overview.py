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
_CLUSTER_VIZ_DIR = _REPO_ROOT / "artifacts" / "dinov2_cluster_3d"
_CLUSTER_VIZ_HTML = _CLUSTER_VIZ_DIR / "cluster_3d.html"
_CLUSTER_VIZ_2D_PNG = _CLUSTER_VIZ_DIR / "cluster_2d.png"
_CLUSTER_VIZ_2D_SVG = _CLUSTER_VIZ_DIR / "cluster_2d.svg"
_CLUSTER_VIZ_2D_ADVANCED_PNG = _CLUSTER_VIZ_DIR / "cluster_2d_advanced.png"
_CLUSTER_REDUCER_3D_PKL = _CLUSTER_VIZ_DIR / "umap_reducer_3d.pkl"
_CLUSTER_EMBEDDINGS_NPY = _CLUSTER_VIZ_DIR / "cluster_embeddings.npy"
_CLUSTER_METADATA_JSON = _CLUSTER_VIZ_DIR / "cluster_metadata.json"
_DEFAULT_SSL_CHECKPOINT = (
    _REPO_ROOT / "artifacts" / "weekend_plans"
    / "transformer_weekend_plan_20260326_172929"
    / "ssl_runs" / "dinov2_ssl_weak_ocular" / "ssl_encoder_latest.pth"
)
_VISUALIZE_SCRIPT = _REPO_ROOT / "scripts" / "visualize_dinov2_clusters_3d.py"


def _build_cluster_position_html(
    cluster_points: list[dict],
    query_coords: list[float],
    query_patient_id: str,
    query_visit_date: str,
    neighbor_patient_ids: list[str],
) -> str:
    """Generate a compact Plotly 3D HTML with the query visit highlighted and top neighbors marked."""
    import plotly.graph_objects as go
    import numpy as np
    from collections import defaultdict

    COLORS: dict[str, str] = {
        "bacterial": "#2563eb", "bacteria": "#2563eb",
        "fungal": "#f97316", "fungus": "#f97316",
        "acanthamoeba": "#16a34a", "mixed": "#7c3aed", "unknown": "#94a3b8",
    }
    SYMBOLS: dict[str, str] = {
        "bacterial": "circle", "bacteria": "circle",
        "fungal": "diamond", "fungus": "diamond",
        "acanthamoeba": "square", "mixed": "cross", "unknown": "circle-open",
    }

    def _c(cat: str) -> str:
        return COLORS.get(cat, COLORS["unknown"])

    def _s(cat: str) -> str:
        return SYMBOLS.get(cat, SYMBOLS["unknown"])

    neighbor_set = set(neighbor_patient_ids)
    cat_groups: dict[str, list[dict]] = defaultdict(list)
    neighbor_pts: list[dict] = []
    for pt in cluster_points:
        if pt["patient_id"] in neighbor_set:
            neighbor_pts.append(pt)
        else:
            cat_groups[pt["culture_category"]].append(pt)

    traces: list[Any] = []

    for cat in sorted(cat_groups):
        pts = cat_groups[cat]
        hover = [
            f"<b>{p['patient_id']}</b><br>"
            f"{p['culture_category'].capitalize()} / {p['culture_species'] or '—'}<br>"
            f"Visit: {p['visit_date']}<br>"
            f"Age/Sex: {p['age']} / {p['sex']}"
            for p in pts
        ]
        traces.append(go.Scatter3d(
            x=[p["coords_3d"][0] for p in pts],
            y=[p["coords_3d"][1] for p in pts],
            z=[p["coords_3d"][2] for p in pts],
            mode="markers",
            name=cat.capitalize(),
            marker=dict(size=5, color=_c(cat), symbol=_s(cat),
                        opacity=0.35, line=dict(width=0)),
            text=hover,
            hovertemplate="%{text}<extra></extra>",
        ))

    for rank, pt in enumerate(neighbor_pts[:3], start=1):
        c3 = pt["coords_3d"]
        cat = pt["culture_category"]
        hover_txt = (
            f"<b>Neighbor {rank}: {pt['patient_id']}</b><br>"
            f"{cat.capitalize()} / {pt['culture_species'] or '—'}<br>"
            f"Visit: {pt['visit_date']}<br>"
            f"Age/Sex: {pt['age']} / {pt['sex']}"
        )
        traces.append(go.Scatter3d(
            x=[c3[0]], y=[c3[1]], z=[c3[2]],
            mode="markers",
            name=f"Neighbor {rank}",
            marker=dict(size=11, color=_c(cat), symbol=_s(cat),
                        opacity=1.0, line=dict(width=2, color="white")),
            text=[hover_txt],
            hovertemplate="%{text}<extra></extra>",
        ))

    traces.append(go.Scatter3d(
        x=[query_coords[0]], y=[query_coords[1]], z=[query_coords[2]],
        mode="markers",
        name=f"Current: {query_patient_id}",
        marker=dict(size=16, color="#dc2626", symbol="diamond",
                    opacity=1.0, line=dict(width=2, color="white")),
        text=[f"<b>Current visit</b><br>{query_patient_id}<br>{query_visit_date}"],
        hovertemplate="%{text}<extra></extra>",
    ))

    axis_style = dict(backgroundcolor="#f1f5f9", gridcolor="#cbd5e1", showbackground=True)
    fig = go.Figure(data=traces)
    fig.update_layout(
        title=dict(
            text=f"Cluster position — {query_patient_id} / {query_visit_date}",
            x=0.5, xanchor="center", font=dict(size=13),
        ),
        scene=dict(
            xaxis=dict(title="UMAP-1", **axis_style),
            yaxis=dict(title="UMAP-2", **axis_style),
            zaxis=dict(title="UMAP-3", **axis_style),
            bgcolor="#f8fafc",
            camera=dict(eye=dict(x=1.5, y=1.5, z=1.2)),
        ),
        legend=dict(itemsizing="constant", bgcolor="white",
                    bordercolor="#cbd5e1", borderwidth=1),
        paper_bgcolor="white",
        margin=dict(l=0, r=0, t=45, b=0),
        height=520,
    )
    return fig.to_html(full_html=True, include_plotlyjs=True)


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
            return {"exists": False, "generated_at": None, "size_bytes": 0, "has_2d": False}
        stat = _CLUSTER_VIZ_HTML.stat()
        generated_at = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()
        return {
            "exists": True,
            "generated_at": generated_at,
            "size_bytes": stat.st_size,
            "has_2d": _CLUSTER_VIZ_2D_PNG.exists(),
            "has_2d_advanced": _CLUSTER_VIZ_2D_ADVANCED_PNG.exists(),
            "has_cluster_artifacts": (
                _CLUSTER_REDUCER_3D_PKL.exists()
                and _CLUSTER_EMBEDDINGS_NPY.exists()
                and _CLUSTER_METADATA_JSON.exists()
            ),
        }

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
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid backbone. Allowed: official, ssl.")
        if crop_mode not in ("full", "cornea_roi", "lesion_crop"):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid crop_mode. Allowed: full, cornea_roi, lesion_crop.")
        if view_filter not in ("all", "white", "slit", "fluorescein"):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid view_filter. Allowed: all, white, slit, fluorescein.")
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
                detail="Visualization regeneration failed. Check server logs for details.",
            )
        if not _CLUSTER_VIZ_HTML.exists():
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Script ran but output file not found.")
        stat = _CLUSTER_VIZ_HTML.stat()
        generated_at = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()
        return {
            "ok": True,
            "generated_at": generated_at,
            "size_bytes": stat.st_size,
            "has_2d": _CLUSTER_VIZ_2D_PNG.exists(),
            "has_2d_advanced": _CLUSTER_VIZ_2D_ADVANCED_PNG.exists(),
        }

    @router.get("/api/sites/{site_id}/explore/cluster-visualization/2d")
    def explore_cluster_2d(
        site_id: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        assert_site_access_only(user, site_id, user_can_access_site=user_can_access_site)
        if not _CLUSTER_VIZ_2D_PNG.exists():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="2D cluster visualization has not been generated yet.",
            )
        import base64
        png_b64 = base64.b64encode(_CLUSTER_VIZ_2D_PNG.read_bytes()).decode("ascii")
        return {"png_base64": png_b64}

    @router.get("/api/sites/{site_id}/explore/cluster-visualization/2d/advanced")
    def explore_cluster_2d_advanced(
        site_id: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        assert_site_access_only(user, site_id, user_can_access_site=user_can_access_site)
        if not _CLUSTER_VIZ_2D_ADVANCED_PNG.exists():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Advanced 2D cluster visualization has not been generated yet.",
            )
        import base64
        png_b64 = base64.b64encode(_CLUSTER_VIZ_2D_ADVANCED_PNG.read_bytes()).decode("ascii")
        return {"png_base64": png_b64}

    @router.post("/api/sites/{site_id}/cluster-position")
    def cluster_position(
        site_id: str,
        patient_id: str,
        visit_date: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        site_store = require_site_access(cp, user, site_id)

        if not (
            _CLUSTER_REDUCER_3D_PKL.exists()
            and _CLUSTER_EMBEDDINGS_NPY.exists()
            and _CLUSTER_METADATA_JSON.exists()
        ):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Cluster artifacts not found. Generate the cluster visualization first.",
            )

        import json
        import pickle
        import numpy as np

        cluster_meta_doc: dict[str, Any] = json.loads(
            _CLUSTER_METADATA_JSON.read_text(encoding="utf-8")
        )
        cluster_points: list[dict[str, Any]] = cluster_meta_doc["points"]
        backbone: str = cluster_meta_doc.get("backbone", "official")
        crop_mode: str = cluster_meta_doc.get("crop_mode", "full")
        view_filter: str = cluster_meta_doc.get("view_filter", "all")

        with open(_CLUSTER_REDUCER_3D_PKL, "rb") as _f:
            umap_reducer = pickle.load(_f)
        cluster_embeddings: np.ndarray = np.load(str(_CLUSTER_EMBEDDINGS_NPY))

        try:
            manifest_records: list[dict[str, Any]] = site_store.generate_manifest().to_dict("records")
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Manifest load failed: {exc}",
            )

        visit_records = [
            r for r in manifest_records
            if str(r.get("patient_id", "")) == patient_id
            and str(r.get("visit_date", "")) == visit_date
            and str(r.get("image_path") or "").strip()
        ]
        if not visit_records:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"No images found for patient {patient_id} visit {visit_date}.",
            )

        if crop_mode == "cornea_roi":
            resolved = []
            for r in visit_records:
                stem = Path(str(r.get("image_path") or "")).stem
                crop_path = site_store.roi_crop_dir / f"{stem}_crop.png"
                if crop_path.exists():
                    resolved.append({**r, "image_path": str(crop_path)})
            if not resolved:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="No cached cornea ROI crops found for this visit.",
                )
            visit_records = resolved
        elif crop_mode == "lesion_crop":
            resolved = []
            for r in visit_records:
                stem = Path(str(r.get("image_path") or "")).stem
                crop_path = site_store.lesion_crop_dir / f"{stem}_crop.png"
                if crop_path.exists():
                    resolved.append({**r, "image_path": str(crop_path)})
            if not resolved:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="No cached lesion crops found for this visit.",
                )
            visit_records = resolved

        if view_filter != "all":
            filtered = [
                r for r in visit_records
                if str(r.get("view") or "").lower() == view_filter.lower()
            ]
            if filtered:
                visit_records = filtered

        ssl_ckpt = (
            str(_DEFAULT_SSL_CHECKPOINT)
            if backbone == "ssl" and _DEFAULT_SSL_CHECKPOINT.exists()
            else None
        )
        from kera_research.services.retrieval import Dinov2ImageRetriever
        retriever = Dinov2ImageRetriever(ssl_checkpoint_path=ssl_ckpt)
        cache_dir = _CLUSTER_VIZ_DIR / "_embedding_cache" / backbone / crop_mode
        image_paths = [str(r["image_path"]) for r in visit_records]

        try:
            image_embs: np.ndarray = retriever.encode_images(
                image_paths, "auto", persistence_dir=cache_dir
            )
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Image encoding failed: {exc}",
            )

        query_vec = np.mean(image_embs, axis=0).astype(np.float32)
        query_vec /= max(float(np.linalg.norm(query_vec)), 1e-12)

        try:
            query_coords_3d: np.ndarray = umap_reducer.transform(query_vec.reshape(1, -1))[0]
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"UMAP transform failed: {exc}",
            )

        sims: np.ndarray = cluster_embeddings @ query_vec
        sorted_indices = np.argsort(-sims)
        neighbors: list[dict[str, Any]] = []
        seen_patients: set[str] = {patient_id}
        for idx in sorted_indices.tolist():
            pt = cluster_points[idx]
            pid = pt["patient_id"]
            if pid in seen_patients:
                continue
            seen_patients.add(pid)
            neighbors.append({
                "patient_id": pid,
                "visit_date": pt["visit_date"],
                "category": pt["culture_category"],
                "species": pt["culture_species"],
                "age": pt["age"],
                "sex": pt["sex"],
                "distance": round(float(1.0 - float(sims[idx])), 4),
            })
            if len(neighbors) >= 3:
                break

        html = _build_cluster_position_html(
            cluster_points=cluster_points,
            query_coords=query_coords_3d.tolist(),
            query_patient_id=patient_id,
            query_visit_date=visit_date,
            neighbor_patient_ids=[n["patient_id"] for n in neighbors],
        )
        return {"html": html, "neighbors": neighbors}

    return router
