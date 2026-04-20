import logging
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, status

from kera_research.api.cross_site_retrieval import (
    enrich_cross_site_retrieval_details,
)
from kera_research.api.control_plane_proxy import (
    call_remote_control_plane_method,
    remote_control_plane_is_primary,
    site_record_for_request,
)
from kera_research.db import DATABASE_TOPOLOGY
from kera_research.api.routes.site_shared import (
    ResearchRegistryConsentRequest,
    ResearchRegistrySettingsRequest,
    assert_site_access_only,
    build_local_summary,
    build_site_summary_counts,
)

logger = logging.getLogger(__name__)
TIMING_LOGS_ENABLED = str(os.getenv("KERA_BOOTSTRAP_TIMING_LOGS") or "").strip() == "1"


def _local_only_split_mode() -> bool:
    return (
        bool(DATABASE_TOPOLOGY.get("control_plane_split_enabled"))
        and str(DATABASE_TOPOLOGY.get("control_plane_connection_mode") or "").strip().lower() != "remote_api_cache"
        and bool(tuple(DATABASE_TOPOLOGY.get("split_database_env_names") or ()))
    )

_REPO_ROOT = Path(__file__).resolve().parents[4]
_CLUSTER_VIZ_DIR = _REPO_ROOT / "artifacts" / "dinov2_cluster_3d"
_CLUSTER_VIZ_HTML = _CLUSTER_VIZ_DIR / "cluster_3d.html"
_CLUSTER_VIZ_2D_PNG = _CLUSTER_VIZ_DIR / "cluster_2d.png"
_CLUSTER_VIZ_2D_SVG = _CLUSTER_VIZ_DIR / "cluster_2d.svg"
_CLUSTER_VIZ_2D_ADVANCED_PNG = _CLUSTER_VIZ_DIR / "cluster_2d_advanced.png"
_CLUSTER_REDUCER_3D_PKL = _CLUSTER_VIZ_DIR / "umap_reducer_3d.pkl"
_CLUSTER_EMBEDDINGS_NPY = _CLUSTER_VIZ_DIR / "cluster_embeddings.npy"
_CLUSTER_METADATA_JSON = _CLUSTER_VIZ_DIR / "cluster_metadata.json"
_GLOBAL_CLUSTER_CACHE_DIR = _CLUSTER_VIZ_DIR / "_global_umap_cache"
_DEFAULT_SSL_CHECKPOINT = (
    _REPO_ROOT / "artifacts" / "weekend_plans"
    / "transformer_weekend_plan_20260326_172929"
    / "ssl_runs" / "dinov2_ssl_weak_ocular" / "ssl_encoder_latest.pth"
)
_VISUALIZE_SCRIPT = _REPO_ROOT / "scripts" / "visualize_dinov2_clusters_3d.py"


def _default_cluster_retrieval_profile(crop_mode: str) -> str:
    normalized = str(crop_mode or "").strip().lower()
    if normalized == "lesion_crop":
        return "dinov2_lesion_crop"
    if normalized == "cornea_roi":
        return "dinov2_cornea_roi"
    return "dinov2_full_frame"


def _normalize_cluster_html_locale(locale: str | None) -> str:
    normalized = str(locale or "").strip().lower()
    return "ko" if normalized.startswith("ko") else "en"


def _build_cluster_position_html(
    cluster_points: list[dict],
    query_coords: list[float],
    query_patient_id: str,
    query_visit_date: str,
    neighbor_patient_ids: list[str],
    locale: str | None = None,
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
    language = _normalize_cluster_html_locale(locale)
    is_korean = language == "ko"
    category_labels = {
        "bacterial": "세균" if is_korean else "Bacterial",
        "bacteria": "세균" if is_korean else "Bacterial",
        "fungal": "진균" if is_korean else "Fungal",
        "fungus": "진균" if is_korean else "Fungal",
        "acanthamoeba": "가시아메바" if is_korean else "Acanthamoeba",
        "mixed": "혼합" if is_korean else "Mixed",
        "unknown": "미상" if is_korean else "Unknown",
    }
    view_labels = {
        "white": "백색광" if is_korean else "White light",
        "slit": "세극등" if is_korean else "Slit lamp",
        "fluorescein": "형광염색" if is_korean else "Fluorescein",
        "fluo": "형광염색" if is_korean else "Fluorescein",
        "other": "기타" if is_korean else "Other",
        "unknown": "미상" if is_korean else "Unknown",
    }
    visit_status_labels = {
        "active": "활동성" if is_korean else "Active",
        "followup": "추적 관찰" if is_korean else "Follow-up",
        "resolved": "호전" if is_korean else "Resolved",
        "unknown": "미상" if is_korean else "Unknown",
    }
    sex_labels = {
        "male": "남성" if is_korean else "Male",
        "female": "여성" if is_korean else "Female",
        "unknown": "미상" if is_korean else "Unknown",
    }

    def _c(cat: str) -> str:
        return COLORS.get(cat, COLORS["unknown"])

    def _s(cat: str) -> str:
        return SYMBOLS.get(cat, SYMBOLS["unknown"])

    def _pick(en_text: str, ko_text: str) -> str:
        return ko_text if is_korean else en_text

    def _category_label(cat: str) -> str:
        normalized = str(cat or "").strip().lower()
        return category_labels.get(normalized, category_labels["unknown"])

    def _view_label(value: str) -> str:
        normalized = str(value or "").strip().lower()
        return view_labels.get(normalized, value or view_labels["unknown"])

    def _visit_status_label(value: str) -> str:
        normalized = str(value or "").strip().lower()
        return visit_status_labels.get(normalized, value or visit_status_labels["unknown"])

    def _sex_label(value: str) -> str:
        normalized = str(value or "").strip().lower()
        return sex_labels.get(normalized, value or sex_labels["unknown"])

    def _hover_body(point: dict[str, Any]) -> str:
        source_site = str(
            point.get("source_site_display_name")
            or point.get("source_site_hospital_name")
            or ""
        ).strip()
        representative_view = str(point.get("representative_view") or "").strip()
        visit_status = str(point.get("visit_status") or "").strip()
        age = str(point.get("age") or "").strip()
        sex = str(point.get("sex") or "").strip()
        lines = [
            f"{_pick('Culture', '배양')}: {_category_label(str(point.get('culture_category') or 'unknown'))} / {point.get('culture_species') or '—'}",
            f"{_pick('Visit', '방문')}: {point['visit_date']}",
        ]
        if source_site:
            lines.append(f"{_pick('Hospital', '병원')}: {source_site}")
        if representative_view or visit_status:
            lines.append(
                f"{_pick('View/Status', '촬영/상태')}: {_view_label(representative_view) if representative_view else '—'} / {_visit_status_label(visit_status) if visit_status else '—'}"
            )
        elif age or sex:
            lines.append(
                f"{_pick('Age/Sex', '나이/성별')}: {age or '—'} / {_sex_label(sex) if sex else '—'}"
            )
        return "<br>".join(lines)

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
            f"<b>{p['patient_id']}</b><br>{_hover_body(p)}"
            for p in pts
        ]
        traces.append(go.Scatter3d(
            x=[p["coords_3d"][0] for p in pts],
            y=[p["coords_3d"][1] for p in pts],
            z=[p["coords_3d"][2] for p in pts],
            mode="markers",
            name=_category_label(cat),
            marker=dict(size=5, color=_c(cat), symbol=_s(cat),
                        opacity=0.35, line=dict(width=0)),
            text=hover,
            hovertemplate="%{text}<extra></extra>",
        ))

    for rank, pt in enumerate(neighbor_pts[:3], start=1):
        c3 = pt["coords_3d"]
        cat = pt["culture_category"]
        hover_txt = (
            f"<b>{_pick('Similar case', '유사 증례')} {rank}: {pt['patient_id']}</b><br>{_hover_body(pt)}"
        )
        traces.append(go.Scatter3d(
            x=[c3[0]], y=[c3[1]], z=[c3[2]],
            mode="markers",
            name=f"{_pick('Similar case', '유사 증례')} {rank}",
            marker=dict(size=11, color=_c(cat), symbol=_s(cat),
                        opacity=1.0, line=dict(width=2, color="white")),
            text=[hover_txt],
            hovertemplate="%{text}<extra></extra>",
        ))

    traces.append(go.Scatter3d(
        x=[query_coords[0]], y=[query_coords[1]], z=[query_coords[2]],
        mode="markers",
        name=f"{_pick('Current visit', '현재 방문')}: {query_patient_id}",
        marker=dict(size=16, color="#dc2626", symbol="diamond",
                    opacity=1.0, line=dict(width=2, color="white")),
        text=[f"<b>{_pick('Current visit', '현재 방문')}</b><br>{query_patient_id}<br>{query_visit_date}"],
        hovertemplate="%{text}<extra></extra>",
    ))

    axis_style = dict(backgroundcolor="#f1f5f9", gridcolor="#cbd5e1", showbackground=True)
    fig = go.Figure(data=traces)
    fig.update_layout(
        title=dict(
            text=f"{_pick('3D similar-case map', '3D 유사 증례 맵')} — {query_patient_id} / {query_visit_date}",
            x=0.5, xanchor="center", font=dict(size=13),
        ),
        scene=dict(
            xaxis=dict(title="", showticklabels=False, zeroline=False, **axis_style),
            yaxis=dict(title="", showticklabels=False, zeroline=False, **axis_style),
            zaxis=dict(title="", showticklabels=False, zeroline=False, **axis_style),
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


def _build_global_cluster_view_from_remote(
    cp: Any,
    *,
    workflow: Any,
    site_id: str,
    patient_id: str,
    visit_date: str,
    query_vec: Any,
    retrieval_profile: str,
    locale: str | None = None,
) -> tuple[dict[str, Any] | None, str | None]:
    if not getattr(cp, "remote_node_sync_enabled", lambda: False)():
        return None, None
    remote_cp = getattr(cp, "remote_control_plane", None)
    if remote_cp is None:
        return None, None

    try:
        import pickle
        import numpy as np
        from umap import UMAP
    except Exception as exc:
        return None, f"All-hospital 3D UMAP is unavailable on this server. {exc}"

    def _safe_cache_component(value: str, *, fallback: str) -> str:
        normalized = "".join(
            ch if ch.isalnum() or ch in {"-", "_"} else "_"
            for ch in str(value or "").strip()
        ).strip("_")
        return normalized or fallback

    def _cache_path(profile_id: str, retrieval_signature: str) -> Path:
        return _GLOBAL_CLUSTER_CACHE_DIR / (
            f"{_safe_cache_component(profile_id, fallback='profile')}"
            f"_{_safe_cache_component(retrieval_signature[:24], fallback='signature')}.pkl"
        )

    def _load_cache(
        *,
        profile_id: str,
        retrieval_signature: str,
        corpus_updated_at: str | None,
        entry_count: int,
        site_count: int,
    ) -> dict[str, Any] | None:
        cache_file = _cache_path(profile_id, retrieval_signature)
        if not cache_file.exists():
            return None
        try:
            with cache_file.open("rb") as handle:
                cache_doc = pickle.load(handle)
        except Exception:
            return None
        if not isinstance(cache_doc, dict):
            return None
        if str(cache_doc.get("profile_id") or "") != profile_id:
            return None
        if str(cache_doc.get("retrieval_signature") or "") != retrieval_signature:
            return None
        if str(cache_doc.get("corpus_updated_at") or "") != str(corpus_updated_at or ""):
            return None
        if int(cache_doc.get("entry_count") or 0) != int(entry_count):
            return None
        if int(cache_doc.get("site_count") or 0) != int(site_count):
            return None
        return cache_doc

    def _write_cache(
        *,
        profile_id: str,
        retrieval_signature: str,
        corpus_updated_at: str | None,
        entry_count: int,
        site_count: int,
        reducer: Any,
        embedding_matrix: Any,
        cluster_points: list[dict[str, Any]],
    ) -> dict[str, Any]:
        cache_doc = {
            "profile_id": profile_id,
            "retrieval_signature": retrieval_signature,
            "corpus_updated_at": corpus_updated_at,
            "entry_count": int(entry_count),
            "site_count": int(site_count),
            "reducer": reducer,
            "embedding_matrix": embedding_matrix,
            "cluster_points": cluster_points,
        }
        try:
            _GLOBAL_CLUSTER_CACHE_DIR.mkdir(parents=True, exist_ok=True)
            cache_file = _cache_path(profile_id, retrieval_signature)
            tmp_file = cache_file.with_suffix(".tmp")
            with tmp_file.open("wb") as handle:
                pickle.dump(cache_doc, handle, protocol=pickle.HIGHEST_PROTOCOL)
            tmp_file.replace(cache_file)
        except Exception:
            pass
        return cache_doc

    try:
        signature_record = workflow.retrieval_signature(retrieval_profile)
        profile_id = str(signature_record.get("profile_id") or retrieval_profile)
        retrieval_signature = str(signature_record.get("retrieval_signature") or "")
        status_payload = remote_cp.retrieval_corpus_umap_payload(
            profile_id=profile_id,
            retrieval_signature=retrieval_signature,
            metadata_only=True,
        )
    except Exception as exc:
        return None, f"All-hospital retrieval corpus is unavailable. {exc}"

    entry_count = int(status_payload.get("entry_count") or 0)
    site_count = int(status_payload.get("site_count") or 0)
    corpus_updated_at = str(status_payload.get("corpus_updated_at") or "").strip() or None
    if entry_count <= 0:
        return None, "All-hospital retrieval corpus is empty."
    if entry_count < 4:
        return None, "All-hospital retrieval corpus has too few cases for a stable 3D UMAP."

    query_array = np.asarray(query_vec, dtype=np.float32).reshape(-1)
    query_norm = float(np.linalg.norm(query_array))
    if not np.isfinite(query_norm) or query_norm <= 1e-12:
        return None, "All-hospital 3D UMAP query embedding is unavailable."
    query_vec_normalized = (query_array / query_norm).astype(np.float32)

    cache_doc = _load_cache(
        profile_id=profile_id,
        retrieval_signature=retrieval_signature,
        corpus_updated_at=corpus_updated_at,
        entry_count=entry_count,
        site_count=site_count,
    )

    reducer = None
    embedding_matrix = None
    cluster_points: list[dict[str, Any]] = []
    if cache_doc is not None:
        try:
            reducer = cache_doc.get("reducer")
            embedding_matrix = np.asarray(cache_doc.get("embedding_matrix"), dtype=np.float32)
            cluster_points = list(cache_doc.get("cluster_points") or [])
            if (
                reducer is None
                or embedding_matrix.ndim != 2
                or embedding_matrix.shape[0] != len(cluster_points)
                or embedding_matrix.shape[1] != query_vec_normalized.size
            ):
                reducer = None
                embedding_matrix = None
                cluster_points = []
        except Exception:
            reducer = None
            embedding_matrix = None
            cluster_points = []

    if reducer is None or embedding_matrix is None or not cluster_points:
        try:
            payload = remote_cp.retrieval_corpus_umap_payload(
                profile_id=profile_id,
                retrieval_signature=retrieval_signature,
                metadata_only=False,
            )
        except Exception as exc:
            return None, f"All-hospital retrieval corpus is unavailable. {exc}"
        raw_entries = list(payload.get("entries") or [])
        if not raw_entries:
            return None, "All-hospital retrieval corpus is empty."

        entries: list[dict[str, Any]] = []
        for item in raw_entries:
            embedding = np.asarray(item.get("embedding") or [], dtype=np.float32).reshape(-1)
            if embedding.size != query_vec_normalized.size:
                continue
            emb_norm = float(np.linalg.norm(embedding))
            if not np.isfinite(emb_norm) or emb_norm <= 1e-12:
                continue
            metadata = dict(item.get("metadata_json") or {})
            entries.append(
                {
                    "case_reference_id": str(item.get("case_reference_id") or "").strip(),
                    "source_site_display_name": str(item.get("source_site_display_name") or "").strip() or None,
                    "source_site_hospital_name": str(item.get("source_site_hospital_name") or "").strip() or None,
                    "culture_category": str(item.get("culture_category") or "").strip().lower() or "unknown",
                    "culture_species": str(item.get("culture_species") or "").strip(),
                    "metadata_json": metadata,
                    "embedding": (embedding / emb_norm).astype(np.float32),
                }
            )
        if len(entries) < 4:
            return None, "All-hospital retrieval corpus has too few cases for a stable 3D UMAP."

        embedding_matrix = np.stack([entry["embedding"] for entry in entries], axis=0)
        n_neighbors = max(2, min(15, len(entries) - 1))
        reducer = UMAP(
            n_components=3,
            n_neighbors=n_neighbors,
            min_dist=0.1,
            metric="cosine",
            init="random",
            random_state=42,
            transform_seed=42,
        )
        try:
            coords_3d = reducer.fit_transform(embedding_matrix)
        except Exception as exc:
            return None, f"All-hospital 3D UMAP projection failed. {exc}"

        cluster_points = []
        for index, entry in enumerate(entries):
            metadata = dict(entry.get("metadata_json") or {})
            cluster_points.append(
                {
                    "patient_id": str(entry.get("case_reference_id") or ""),
                    "visit_date": str(
                        entry.get("source_site_display_name")
                        or entry.get("source_site_hospital_name")
                        or metadata.get("visit_status")
                        or "cross-site"
                    ),
                    "culture_category": str(entry.get("culture_category") or "unknown"),
                    "culture_species": str(entry.get("culture_species") or ""),
                    "age": str(metadata.get("age") or ""),
                    "sex": str(metadata.get("sex") or ""),
                    "coords_3d": coords_3d[index].tolist(),
                    "source_site_display_name": entry.get("source_site_display_name"),
                    "source_site_hospital_name": entry.get("source_site_hospital_name"),
                    "representative_view": metadata.get("representative_view"),
                    "visit_status": metadata.get("visit_status"),
                }
            )

        cache_doc = _write_cache(
            profile_id=profile_id,
            retrieval_signature=retrieval_signature,
            corpus_updated_at=corpus_updated_at,
            entry_count=entry_count,
            site_count=site_count,
            reducer=reducer,
            embedding_matrix=embedding_matrix.astype(np.float32),
            cluster_points=cluster_points,
        )
        embedding_matrix = np.asarray(cache_doc.get("embedding_matrix"), dtype=np.float32)
        cluster_points = list(cache_doc.get("cluster_points") or [])

    try:
        query_coords = reducer.transform(query_vec_normalized.reshape(1, -1))[0]
    except Exception as exc:
        return None, f"All-hospital 3D UMAP projection failed. {exc}"

    query_case_reference_id = cp.case_reference_id(site_id, patient_id, visit_date)
    sims: np.ndarray = embedding_matrix @ query_vec_normalized
    sorted_indices = np.argsort(-sims)
    neighbors: list[dict[str, Any]] = []
    seen_case_reference_ids: set[str] = {query_case_reference_id}
    for idx in sorted_indices.tolist():
        entry = cluster_points[idx]
        case_reference_id = str(entry.get("patient_id") or "").strip()
        if not case_reference_id or case_reference_id in seen_case_reference_ids:
            continue
        seen_case_reference_ids.add(case_reference_id)
        neighbors.append(
            {
                "patient_id": case_reference_id,
                "visit_date": str(
                    entry.get("source_site_display_name")
                    or entry.get("source_site_hospital_name")
                    or entry.get("visit_status")
                    or "cross-site"
                ),
                "category": str(entry.get("culture_category") or "unknown"),
                "species": str(entry.get("culture_species") or ""),
                "age": str(entry.get("age") or ""),
                "sex": str(entry.get("sex") or ""),
                "distance": round(float(1.0 - float(sims[idx])), 4),
                "source_site_display_name": entry.get("source_site_display_name"),
                "source_site_hospital_name": entry.get("source_site_hospital_name"),
                "representative_view": entry.get("representative_view"),
                "visit_status": entry.get("visit_status"),
            }
        )
        if len(neighbors) >= 3:
            break
    message = "Showing this visit on the all-hospital 3D map."
    if corpus_updated_at:
        message = f"{message} Updated {corpus_updated_at}."

    return (
        {
            "html": _build_cluster_position_html(
                cluster_points=cluster_points,
                query_coords=query_coords.tolist(),
                query_patient_id=patient_id,
                query_visit_date=visit_date,
                neighbor_patient_ids=[str(item.get('patient_id') or '') for item in neighbors],
                locale=locale,
            ),
            "neighbors": neighbors,
            "cluster_message": message,
            "cluster_scope": "global",
            "cluster_scope_label": "all_hospitals",
            "cluster_entry_count": entry_count,
            "cluster_site_count": site_count,
        },
        None,
    )


def build_site_overview_router(support: Any) -> APIRouter:
    router = APIRouter()

    get_control_plane = support.get_control_plane
    get_approved_user = support.get_approved_user
    require_admin_workspace_permission = support.require_admin_workspace_permission
    require_validation_permission = support.require_validation_permission
    require_site_access = support.require_site_access
    user_can_access_site = support.user_can_access_site
    control_plane_split_enabled = support.control_plane_split_enabled
    local_site_records_for_user = support.local_site_records_for_user
    build_site_activity = support.build_site_activity
    get_workflow = support.get_workflow
    queue_federated_retrieval_corpus_sync = support.queue_federated_retrieval_corpus_sync

    @router.get("/api/sites")
    def list_sites(
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
        authorization: str | None = Header(default=None),
        control_plane_owner: str | None = Header(default=None, alias="x-kera-control-plane-owner"),
    ) -> list[dict[str, Any]]:
        if _local_only_split_mode():
            return local_site_records_for_user(user)
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
        if _local_only_split_mode():
            return build_local_summary(site_store, site_id)
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
        if _local_only_split_mode():
            return {
                "pending_updates": 0,
                "recent_validations": [],
                "recent_contributions": [],
                "contribution_leaderboard": [],
            }
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
        retrieval_profile: str | None = None,
        locale: str | None = None,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_validation_permission(user)
        site_store = require_site_access(cp, user, site_id)

        local_cluster_artifacts_available = (
            _CLUSTER_REDUCER_3D_PKL.exists()
            and _CLUSTER_EMBEDDINGS_NPY.exists()
            and _CLUSTER_METADATA_JSON.exists()
        )

        import json
        import pickle
        import numpy as np

        cluster_points: list[dict[str, Any]] = []
        backbone = "official"
        crop_mode = "full"
        view_filter = "all"
        umap_reducer = None
        cluster_embeddings: np.ndarray | None = None
        if local_cluster_artifacts_available:
            cluster_meta_doc: dict[str, Any] = json.loads(
                _CLUSTER_METADATA_JSON.read_text(encoding="utf-8")
            )
            cluster_points = cluster_meta_doc["points"]
            backbone = cluster_meta_doc.get("backbone", "official")
            crop_mode = cluster_meta_doc.get("crop_mode", "full")
            view_filter = cluster_meta_doc.get("view_filter", "all")

            with open(_CLUSTER_REDUCER_3D_PKL, "rb") as _f:
                umap_reducer = pickle.load(_f)
            cluster_embeddings = np.load(str(_CLUSTER_EMBEDDINGS_NPY))

        try:
            manifest_records: list[dict[str, Any]] = site_store.generate_manifest().to_dict("records")
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Manifest load failed: {exc}",
            )

        case_records = [
            r for r in manifest_records
            if str(r.get("patient_id", "")) == patient_id
            and str(r.get("visit_date", "")) == visit_date
            and str(r.get("image_path") or "").strip()
        ]
        if not case_records:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"No images found for patient {patient_id} visit {visit_date}.",
            )

        normalized_retrieval_profile = (
            str(retrieval_profile or "").strip()
            or _default_cluster_retrieval_profile(crop_mode)
        )

        quality_cache: dict[str, dict[str, Any] | None] = {}
        workflow = None
        ai_clinic_workflow = None
        query_summary = next(
            (
                dict(item)
                for item in site_store.list_case_summaries(patient_id=patient_id)
                if str(item.get("visit_date") or "") == visit_date
            ),
            {},
        )
        policy_state = site_store.case_research_policy_state(patient_id, visit_date)
        policy_summary = dict(policy_state.get("case_summary") or {})
        if policy_summary:
            query_summary = {**query_summary, **policy_summary}

        query_metadata: dict[str, Any] | None = None
        query_retrieval_vec = None
        resolved_profile_record: dict[str, Any] = {}
        profile_warning: str | None = None
        requested_retrieval_label: str | None = None
        global_cluster_payload: dict[str, Any] | None = None
        global_cluster_fallback_reason: str | None = None
        if cp.remote_node_sync_enabled():
            workflow = get_workflow(cp)
            ai_clinic_workflow = workflow.ai_clinic_workflow
            requested_retrieval_label = str(
                ai_clinic_workflow._normalize_retrieval_profile(normalized_retrieval_profile).get("label") or ""
            ).strip() or None
            try:
                query_metadata = workflow._case_metadata_snapshot(
                    query_summary,
                    case_records,
                    quality_cache,
                )
                (
                    query_retrieval_vec,
                    resolved_profile_record,
                    profile_warning,
                ) = ai_clinic_workflow._resolve_query_dinov2_embedding(
                    site_store,
                    query_records=case_records,
                    execution_device="auto",
                    retrieval_profile=normalized_retrieval_profile,
                )
            except Exception as exc:
                profile_warning = f"All-hospital retrieval is unavailable. {exc}"
                resolved_profile_record = {}

            if query_retrieval_vec is not None and workflow is not None:
                global_cluster_payload, global_cluster_fallback_reason = _build_global_cluster_view_from_remote(
                    cp,
                    workflow=workflow,
                    site_id=site_id,
                    patient_id=patient_id,
                    visit_date=visit_date,
                    query_vec=query_retrieval_vec,
                    retrieval_profile=str(
                        resolved_profile_record.get("profile_id") or normalized_retrieval_profile
                    ),
                    locale=locale,
                )
                if global_cluster_payload is not None:
                    return {
                        **global_cluster_payload,
                        "cross_site_neighbors": [],
                        "cross_site_status": "ready",
                        "cross_site_message": None,
                        "cross_site_cache_used": False,
                        "cross_site_cache_saved_at": None,
                        "cross_site_corpus_status": None,
                        "cross_site_opportunistic_sync": None,
                        "cross_site_retrieval_profile": str(
                            resolved_profile_record.get("profile_id") or normalized_retrieval_profile
                        ),
                        "cross_site_requested_retrieval_profile": normalized_retrieval_profile,
                        "cross_site_requested_retrieval_label": requested_retrieval_label,
                        "cross_site_effective_retrieval_profile": str(
                            resolved_profile_record.get("profile_id") or normalized_retrieval_profile
                        ),
                        "cross_site_effective_retrieval_label": str(
                            resolved_profile_record.get("label") or ""
                        ).strip() or None,
                        "cross_site_status_retrieval_profile": str(
                            resolved_profile_record.get("profile_id") or normalized_retrieval_profile
                        ),
                        "cross_site_status_retrieval_label": str(
                            resolved_profile_record.get("label") or ""
                        ).strip() or None,
                    }
            elif profile_warning and global_cluster_fallback_reason is None:
                global_cluster_fallback_reason = profile_warning

        if not local_cluster_artifacts_available:
            detail = "All-hospital 3D map is unavailable and same-site cluster artifacts were not found."
            if global_cluster_fallback_reason:
                detail = f"{detail} {global_cluster_fallback_reason}"
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=detail,
            )

        visit_records = list(case_records)
        cluster_message: str | None = None
        workflow_for_query = None
        if crop_mode == "cornea_roi":
            resolved = []
            fallback_used = False
            for r in visit_records:
                stem = Path(str(r.get("image_path") or "")).stem
                crop_path = site_store.roi_crop_dir / f"{stem}_crop.png"
                if crop_path.exists():
                    resolved.append({**r, "image_path": str(crop_path)})
                    continue
                if workflow_for_query is None:
                    workflow_for_query = get_workflow(cp)
                ensure_roi_crop = getattr(workflow_for_query, "_ensure_roi_crop", None)
                if callable(ensure_roi_crop):
                    try:
                        roi = ensure_roi_crop(site_store, str(r.get("image_path") or ""))
                    except Exception:
                        roi = None
                    if isinstance(roi, dict) and str(roi.get("roi_crop_path") or "").strip():
                        resolved.append({**r, "image_path": str(roi["roi_crop_path"])})
                        continue
                fallback_used = True
                resolved.append(dict(r))
            if fallback_used:
                cluster_message = (
                    "Cornea ROI crops were unavailable for part of this visit, so the 3D position is using source "
                    "frames for those images."
                )
            visit_records = resolved
        elif crop_mode == "lesion_crop":
            resolved = []
            fallback_used = False
            for r in visit_records:
                stem = Path(str(r.get("image_path") or "")).stem
                crop_path = site_store.lesion_crop_dir / f"{stem}_crop.png"
                if crop_path.exists():
                    resolved.append({**r, "image_path": str(crop_path)})
                    continue
                if workflow_for_query is None:
                    workflow_for_query = get_workflow(cp)
                ensure_lesion_crop = getattr(workflow_for_query, "_ensure_lesion_crop", None)
                lesion_prompt_box = r.get("lesion_prompt_box")
                if callable(ensure_lesion_crop) and isinstance(lesion_prompt_box, dict):
                    try:
                        lesion = ensure_lesion_crop(
                            site_store,
                            r,
                            lesion_prompt_box=lesion_prompt_box,
                        )
                    except Exception:
                        lesion = None
                    if isinstance(lesion, dict) and str(lesion.get("lesion_crop_path") or "").strip():
                        resolved.append({**r, "image_path": str(lesion["lesion_crop_path"])})
                        continue
                fallback_used = True
                resolved.append(dict(r))
            if fallback_used:
                cluster_message = (
                    "Lesion crops were unavailable for part of this visit, so the 3D position is using source "
                    "frames for those images."
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

        cross_site_neighbors: list[dict[str, Any]] = []
        cross_site_status = "disabled"
        cross_site_message: str | None = None
        cross_site_cache_used = False
        cross_site_cache_saved_at: str | None = None
        cross_site_opportunistic_sync: dict[str, Any] | None = None
        cross_site_corpus_status: dict[str, Any] | None = None
        cross_site_effective_retrieval_profile: str | None = None
        cross_site_effective_retrieval_label: str | None = None
        cross_site_requested_retrieval_label: str | None = requested_retrieval_label
        cross_site_status_retrieval_profile: str | None = None
        cross_site_status_retrieval_label: str | None = None
        if cp.remote_node_sync_enabled() and workflow is not None and ai_clinic_workflow is not None:
            try:
                if query_retrieval_vec is None:
                    cached_remote = ai_clinic_workflow._load_remote_retrieval_cache(
                        site_store,
                        patient_id=patient_id,
                        visit_date=visit_date,
                        requested_profile_id=normalized_retrieval_profile,
                        top_k=3,
                    )
                    if cached_remote is not None:
                        cross_site_neighbors = list(cached_remote.get("candidates") or [])
                        cross_site_status = "cache_fallback"
                        cross_site_cache_used = True
                        cross_site_cache_saved_at = str(cached_remote.get("saved_at") or "").strip() or None
                        cached_profile_id = str(
                            cached_remote.get("used_profile_id") or normalized_retrieval_profile
                        ).strip() or normalized_retrieval_profile
                        resolved_profile_record = ai_clinic_workflow._normalize_retrieval_profile(cached_profile_id)
                        cross_site_message = (
                            "Live cross-site reference query embedding is unavailable, so the cluster view is using "
                            "the last successful cached cross-site references."
                        )
                        if cross_site_cache_saved_at:
                            cross_site_message = (
                                f"{cross_site_message} Cached at {cross_site_cache_saved_at}."
                            )
                    else:
                        cross_site_status = "no_query_embedding"
                        cross_site_message = profile_warning or (
                            "Cross-site reference query embedding is unavailable for this retrieval profile."
                        )
                else:
                    try:
                        resolved_profile_id = str(
                            resolved_profile_record.get("profile_id") or normalized_retrieval_profile
                        )
                        cross_site_neighbors = workflow.search_remote_retrieval_corpus(
                            site_store,
                            query_embedding=query_retrieval_vec,
                            query_metadata=query_metadata or {},
                            patient_id=patient_id,
                            visit_date=visit_date,
                            retrieval_profile=resolved_profile_id,
                            top_k=3,
                        )
                        ai_clinic_workflow._save_remote_retrieval_cache(
                            site_store,
                            patient_id=patient_id,
                            visit_date=visit_date,
                            requested_profile_id=normalized_retrieval_profile,
                            used_profile_id=resolved_profile_id,
                            candidates=cross_site_neighbors,
                        )
                    except Exception as exc:
                        cached_remote = ai_clinic_workflow._load_remote_retrieval_cache(
                            site_store,
                            patient_id=patient_id,
                            visit_date=visit_date,
                            requested_profile_id=normalized_retrieval_profile,
                            top_k=3,
                        )
                        if cached_remote is not None:
                            cross_site_neighbors = list(cached_remote.get("candidates") or [])
                            cross_site_status = "cache_fallback"
                            cross_site_cache_used = True
                            cross_site_cache_saved_at = str(cached_remote.get("saved_at") or "").strip() or None
                            cached_profile_id = str(
                                cached_remote.get("used_profile_id") or normalized_retrieval_profile
                            ).strip() or normalized_retrieval_profile
                            resolved_profile_record = ai_clinic_workflow._normalize_retrieval_profile(cached_profile_id)
                            cross_site_message = (
                                "Cross-site reference retrieval is unavailable, so the cluster view is using the "
                                f"last successful cached cross-site references. {exc}"
                            )
                        else:
                            cross_site_status = "unavailable"
                            cross_site_message = f"Cross-site reference retrieval is unavailable. {exc}"
                    else:
                        cross_site_status = "ready" if cross_site_neighbors else "empty"
                        if profile_warning and str(resolved_profile_record.get("profile_id") or "").strip() != normalized_retrieval_profile:
                            cross_site_message = profile_warning
                        if not cross_site_neighbors and not cross_site_message:
                            cross_site_message = (
                                "No cross-site reference case is available for this retrieval profile yet."
                            )

                enriched_details = enrich_cross_site_retrieval_details(
                    cp=cp,
                    site_store=site_store,
                    workflow=workflow,
                    requested_profile_id=normalized_retrieval_profile,
                    requested_profile_label=cross_site_requested_retrieval_label,
                    effective_profile_id=str(resolved_profile_record.get("profile_id") or ""),
                    effective_profile_label=str(resolved_profile_record.get("label") or ""),
                    cross_site_status=cross_site_status,
                    candidate_count=len(cross_site_neighbors),
                    queue_sync=queue_federated_retrieval_corpus_sync,
                    sync_trigger="cluster_cross_site_recovery",
                )
                cross_site_effective_retrieval_profile = str(
                    enriched_details.get("effective_profile_id") or ""
                ).strip() or None
                cross_site_effective_retrieval_label = str(
                    enriched_details.get("effective_profile_label") or ""
                ).strip() or None
                cross_site_status_retrieval_profile = str(
                    enriched_details.get("status_profile_id") or ""
                ).strip() or None
                cross_site_status_retrieval_label = str(
                    enriched_details.get("status_profile_label") or ""
                ).strip() or None
                cross_site_corpus_status = (
                    dict(enriched_details.get("corpus_status") or {})
                    if isinstance(enriched_details.get("corpus_status"), dict)
                    else None
                )
                cross_site_opportunistic_sync = (
                    dict(enriched_details.get("opportunistic_sync") or {})
                    if isinstance(enriched_details.get("opportunistic_sync"), dict)
                    else None
                )
                if bool((cross_site_opportunistic_sync or {}).get("queued")):
                    sync_message = (
                        "A background retrieval corpus sync has been queued for this site."
                    )
                    cross_site_message = (
                        f"{cross_site_message} {sync_message}".strip()
                        if cross_site_message
                        else sync_message
                    )
            except Exception as exc:
                cross_site_status = "unavailable"
                cross_site_message = f"Cross-site reference retrieval is unavailable. {exc}"
        else:
            cross_site_message = "Cross-site retrieval corpus sync is not configured."

        if global_cluster_fallback_reason:
            fallback_message = (
                "All-hospital 3D map is unavailable right now, so this view is showing the current site's 3D map."
            )
            if cluster_message:
                cluster_message = f"{fallback_message} {cluster_message}"
            else:
                cluster_message = fallback_message

        html = _build_cluster_position_html(
            cluster_points=cluster_points,
            query_coords=query_coords_3d.tolist(),
            query_patient_id=patient_id,
            query_visit_date=visit_date,
            neighbor_patient_ids=[n["patient_id"] for n in neighbors],
            locale=locale,
        )
        return {
            "html": html,
            "neighbors": neighbors,
            "cluster_message": cluster_message,
            "cluster_scope": "site",
            "cluster_scope_label": "current_site",
            "cluster_entry_count": None,
            "cluster_site_count": 1,
            "cross_site_neighbors": cross_site_neighbors,
            "cross_site_status": cross_site_status,
            "cross_site_message": cross_site_message,
            "cross_site_cache_used": cross_site_cache_used,
            "cross_site_cache_saved_at": cross_site_cache_saved_at,
            "cross_site_corpus_status": cross_site_corpus_status,
            "cross_site_opportunistic_sync": cross_site_opportunistic_sync,
            "cross_site_retrieval_profile": normalized_retrieval_profile,
            "cross_site_requested_retrieval_profile": normalized_retrieval_profile,
            "cross_site_requested_retrieval_label": cross_site_requested_retrieval_label,
            "cross_site_effective_retrieval_profile": cross_site_effective_retrieval_profile,
            "cross_site_effective_retrieval_label": cross_site_effective_retrieval_label,
            "cross_site_status_retrieval_profile": cross_site_status_retrieval_profile,
            "cross_site_status_retrieval_label": cross_site_status_retrieval_label,
        }

    return router
