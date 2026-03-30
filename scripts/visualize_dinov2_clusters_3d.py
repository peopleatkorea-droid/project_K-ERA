from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = REPO_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from kera_research.services.control_plane import ControlPlaneStore
from kera_research.services.data_plane import SiteStore
from kera_research.services.pipeline import ResearchWorkflowService
from kera_research.services.retrieval import Dinov2ImageRetriever

DEFAULT_SSL_CHECKPOINT = (
    REPO_ROOT
    / "artifacts"
    / "weekend_plans"
    / "transformer_weekend_plan_20260326_172929"
    / "ssl_runs"
    / "dinov2_ssl_weak_ocular"
    / "ssl_encoder_latest.pth"
)

# culture_category → marker color
CATEGORY_COLORS: dict[str, str] = {
    "bacteria": "#2563eb",
    "bacterial": "#2563eb",
    "fungus": "#f97316",
    "fungal": "#f97316",
    "acanthamoeba": "#16a34a",
    "mixed": "#7c3aed",
    "unknown": "#94a3b8",
}

# culture_category → marker symbol
CATEGORY_SYMBOLS: dict[str, str] = {
    "bacteria": "circle",
    "bacterial": "circle",
    "fungus": "diamond",
    "fungal": "diamond",
    "acanthamoeba": "square",
    "mixed": "cross",
    "unknown": "circle-open",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="3D interactive DINOv2 cluster visualization (Plotly HTML)."
    )
    parser.add_argument("--site-id", default="39100103", help="Site ID to load from SiteStore")
    parser.add_argument(
        "--backbone",
        default="official",
        choices=["official", "ssl"],
        help="DINOv2 backbone variant",
    )
    parser.add_argument(
        "--crop-mode",
        default="full",
        choices=["full", "cornea_roi", "lesion_crop"],
        help="Image crop mode (cornea_roi/lesion_crop require the pipeline workflow)",
    )
    parser.add_argument(
        "--level",
        default="visit",
        choices=["visit", "patient", "image"],
        help="Aggregation level: visit (recommended), patient, or image",
    )
    parser.add_argument(
        "--device",
        default="auto",
        choices=["auto", "cuda", "cpu"],
    )
    parser.add_argument(
        "--umap-neighbors",
        type=int,
        default=15,
        help="UMAP n_neighbors parameter (smaller = more local structure)",
    )
    parser.add_argument(
        "--umap-min-dist",
        type=float,
        default=0.1,
        help="UMAP min_dist parameter (smaller = tighter clusters)",
    )
    parser.add_argument(
        "--ssl-checkpoint",
        type=Path,
        default=DEFAULT_SSL_CHECKPOINT,
    )
    parser.add_argument(
        "--view-filter",
        default="all",
        choices=["all", "white", "slit", "fluorescein"],
        help="Filter images by view type. 'all' keeps every view.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=REPO_ROOT / "artifacts" / "dinov2_cluster_3d" / "cluster_3d.html",
        help="Output HTML file path",
    )
    return parser.parse_args()


def _get_color(category: str) -> str:
    return CATEGORY_COLORS.get(category, CATEGORY_COLORS["unknown"])


def _get_symbol(category: str) -> str:
    return CATEGORY_SYMBOLS.get(category, CATEGORY_SYMBOLS["unknown"])


def _normalize_category(raw: Any) -> str:
    return str(raw or "unknown").strip().lower() or "unknown"


def filter_by_view(records: list[dict[str, Any]], view_filter: str) -> list[dict[str, Any]]:
    if view_filter == "all":
        return records
    target = view_filter.strip().lower()
    return [r for r in records if str(r.get("view") or "").strip().lower() == target]


def prepare_image_records(
    *,
    manifest_records: list[dict[str, Any]],
    crop_mode: str,
    view_filter: str,
    workflow: ResearchWorkflowService | None,
    site_store: SiteStore,
) -> list[dict[str, Any]]:
    normalized = crop_mode.strip().lower()
    if normalized == "full":
        base = [r for r in manifest_records if str(r.get("image_path") or "").strip()]
    elif workflow is None:
        raise RuntimeError(
            f"crop_mode='{crop_mode}' requires the pipeline workflow (ControlPlaneStore). "
            "Pass --crop-mode full to skip this."
        )
    elif normalized == "cornea_roi":
        base = workflow._prepare_records_for_model(site_store, manifest_records, crop_mode="automated")
        base = [r for r in base if str(r.get("image_path") or "").strip()]
    elif normalized == "lesion_crop":
        base = workflow._prepare_records_for_model(site_store, manifest_records, crop_mode="manual")
        base = [r for r in base if str(r.get("image_path") or "").strip()]
    else:
        raise ValueError(f"Unsupported crop_mode: {crop_mode}")
    return filter_by_view(base, view_filter)


def build_visit_level_points(
    records: list[dict[str, Any]],
    image_embeddings: np.ndarray,
    path_to_idx: dict[str, int],
) -> list[dict[str, Any]]:
    visit_groups: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        image_path = str(record.get("image_path") or "").strip()
        if not image_path or image_path not in path_to_idx:
            continue
        key = (str(record.get("patient_id") or ""), str(record.get("visit_date") or ""))
        visit_groups[key].append(record)

    points: list[dict[str, Any]] = []
    for (patient_id, visit_date), group in sorted(visit_groups.items()):
        indices = [path_to_idx[str(r["image_path"])] for r in group]
        vec = np.mean(image_embeddings[indices], axis=0).astype(np.float32)
        vec /= max(float(np.linalg.norm(vec)), 1e-12)
        category = _normalize_category(group[0].get("culture_category"))
        species = str(group[0].get("culture_species") or "").strip()
        age = str(group[0].get("age") or "")
        sex = str(group[0].get("sex") or "")
        points.append({
            "embedding": vec,
            "patient_id": patient_id,
            "visit_date": visit_date,
            "culture_category": category,
            "culture_species": species,
            "age": age,
            "sex": sex,
            "n_images": len(group),
            "label": f"{patient_id} / {visit_date}",
        })
    return points


def build_patient_level_points(
    records: list[dict[str, Any]],
    image_embeddings: np.ndarray,
    path_to_idx: dict[str, int],
) -> list[dict[str, Any]]:
    patient_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        image_path = str(record.get("image_path") or "").strip()
        if not image_path or image_path not in path_to_idx:
            continue
        patient_groups[str(record.get("patient_id") or "")].append(record)

    points: list[dict[str, Any]] = []
    for patient_id, group in sorted(patient_groups.items()):
        indices = [path_to_idx[str(r["image_path"])] for r in group]
        vec = np.mean(image_embeddings[indices], axis=0).astype(np.float32)
        vec /= max(float(np.linalg.norm(vec)), 1e-12)
        category = _normalize_category(group[0].get("culture_category"))
        species = str(group[0].get("culture_species") or "").strip()
        n_visits = len({str(r.get("visit_date") or "") for r in group})
        age = str(group[0].get("age") or "")
        sex = str(group[0].get("sex") or "")
        points.append({
            "embedding": vec,
            "patient_id": patient_id,
            "visit_date": f"{n_visits} visit(s)",
            "culture_category": category,
            "culture_species": species,
            "age": age,
            "sex": sex,
            "n_images": len(group),
            "label": patient_id,
        })
    return points


def build_image_level_points(
    records: list[dict[str, Any]],
    image_embeddings: np.ndarray,
    path_to_idx: dict[str, int],
) -> list[dict[str, Any]]:
    points: list[dict[str, Any]] = []
    for record in records:
        image_path = str(record.get("image_path") or "").strip()
        if not image_path or image_path not in path_to_idx:
            continue
        idx = path_to_idx[image_path]
        category = _normalize_category(record.get("culture_category"))
        species = str(record.get("culture_species") or "").strip()
        patient_id = str(record.get("patient_id") or "")
        visit_date = str(record.get("visit_date") or "")
        age = str(record.get("age") or "")
        sex = str(record.get("sex") or "")
        points.append({
            "embedding": image_embeddings[idx],
            "patient_id": patient_id,
            "visit_date": visit_date,
            "culture_category": category,
            "culture_species": species,
            "age": age,
            "sex": sex,
            "n_images": 1,
            "label": f"{patient_id} / {visit_date} / {Path(image_path).name}",
        })
    return points


def run_umap(embeddings: np.ndarray, n_neighbors: int, min_dist: float) -> np.ndarray:
    try:
        from umap import UMAP
    except ImportError as exc:
        raise RuntimeError(
            "umap-learn is required. Install it with: uv add umap-learn"
        ) from exc
    reducer = UMAP(
        n_components=3,
        n_neighbors=n_neighbors,
        min_dist=min_dist,
        random_state=42,
        verbose=True,
    )
    return reducer.fit_transform(embeddings).astype(np.float32)


def build_plotly_figure(
    coords: np.ndarray,
    points: list[dict[str, Any]],
    *,
    backbone: str,
    crop_mode: str,
    view_filter: str,
    level: str,
    site_id: str,
) -> Any:
    import plotly.graph_objects as go

    # One trace per category (gives a legend entry per group)
    category_groups: dict[str, list[int]] = defaultdict(list)
    for i, point in enumerate(points):
        category_groups[point["culture_category"]].append(i)

    traces = []
    for category in sorted(category_groups.keys()):
        indices = category_groups[category]
        color = _get_color(category)
        symbol = _get_symbol(category)
        hover_texts = [
            (
                f"<b>{points[i]['label']}</b><br>"
                f"Category: {points[i]['culture_category']}<br>"
                f"Species: {points[i]['culture_species'] or '—'}<br>"
                f"Age/Sex: {points[i]['age']} / {points[i]['sex']}<br>"
                f"Images pooled: {points[i]['n_images']}"
            )
            for i in indices
        ]
        traces.append(
            go.Scatter3d(
                x=coords[indices, 0],
                y=coords[indices, 1],
                z=coords[indices, 2],
                mode="markers",
                name=category.capitalize(),
                marker=dict(
                    size=6,
                    color=color,
                    symbol=symbol,
                    opacity=0.85,
                    line=dict(width=0.5, color="white"),
                ),
                text=hover_texts,
                hovertemplate="%{text}<extra></extra>",
            )
        )

    view_label = view_filter if view_filter != "all" else "all views"
    title_text = (
        f"DINOv2 Embedding Cluster — {level.capitalize()} level  "
        f"<sub>(site={site_id} · backbone={backbone} · crop={crop_mode} · view={view_label} · n={len(points)})</sub>"
    )

    fig = go.Figure(data=traces)
    fig.update_layout(
        title=dict(
            text=title_text,
            x=0.5,
            xanchor="center",
            font=dict(size=15),
        ),
        scene=dict(
            xaxis=dict(
                title="UMAP-1",
                backgroundcolor="#f1f5f9",
                gridcolor="#cbd5e1",
                showbackground=True,
            ),
            yaxis=dict(
                title="UMAP-2",
                backgroundcolor="#f1f5f9",
                gridcolor="#cbd5e1",
                showbackground=True,
            ),
            zaxis=dict(
                title="UMAP-3",
                backgroundcolor="#f1f5f9",
                gridcolor="#cbd5e1",
                showbackground=True,
            ),
            bgcolor="#f8fafc",
            camera=dict(eye=dict(x=1.5, y=1.5, z=1.2)),
        ),
        legend=dict(
            title=dict(text="Culture category"),
            itemsizing="constant",
            bgcolor="white",
            bordercolor="#cbd5e1",
            borderwidth=1,
            x=0.01,
            y=0.99,
        ),
        paper_bgcolor="white",
        margin=dict(l=0, r=0, t=70, b=0),
        height=800,
    )
    return fig


def main() -> int:
    args = parse_args()
    output_path = args.output.expanduser().resolve()

    site_store = SiteStore(args.site_id)
    manifest_records = site_store.generate_manifest().to_dict("records")

    # For cornea_roi / lesion_crop we need the pipeline workflow
    workflow: ResearchWorkflowService | None = None
    if args.crop_mode != "full":
        control_plane = ControlPlaneStore()
        workflow = ResearchWorkflowService(control_plane)

    print(f"Preparing records (crop_mode={args.crop_mode}, view_filter={args.view_filter})...")
    image_records = prepare_image_records(
        manifest_records=manifest_records,
        crop_mode=args.crop_mode,
        view_filter=args.view_filter,
        workflow=workflow,
        site_store=site_store,
    )
    if not image_records:
        print("ERROR: No records with valid image paths found.", file=sys.stderr)
        return 1

    ssl_checkpoint = (
        str(args.ssl_checkpoint.expanduser().resolve())
        if args.backbone == "ssl"
        else None
    )
    retriever = Dinov2ImageRetriever(ssl_checkpoint_path=ssl_checkpoint)

    cache_dir = (
        REPO_ROOT
        / "artifacts"
        / "dinov2_cluster_3d"
        / "_embedding_cache"
        / args.backbone
        / args.crop_mode
    )
    all_image_paths = [str(r["image_path"]) for r in image_records]
    print(f"Encoding {len(all_image_paths)} images with DINOv2 ({args.backbone})...")
    image_embeddings = retriever.encode_images(
        all_image_paths,
        requested_device=args.device,
        persistence_dir=cache_dir,
    )

    path_to_idx = {path: i for i, path in enumerate(all_image_paths)}

    print(f"Building {args.level}-level embedding points...")
    if args.level == "visit":
        points = build_visit_level_points(image_records, image_embeddings, path_to_idx)
    elif args.level == "patient":
        points = build_patient_level_points(image_records, image_embeddings, path_to_idx)
    else:
        points = build_image_level_points(image_records, image_embeddings, path_to_idx)

    if len(points) < 4:
        print(f"ERROR: Too few points ({len(points)}) to run UMAP.", file=sys.stderr)
        return 1

    print(f"Running UMAP 3D on {len(points)} points (embedding dim={image_embeddings.shape[1]})...")
    embedding_matrix = np.stack([p["embedding"] for p in points], axis=0)
    coords = run_umap(embedding_matrix, n_neighbors=args.umap_neighbors, min_dist=args.umap_min_dist)

    print("Building Plotly figure...")
    fig = build_plotly_figure(
        coords,
        points,
        backbone=args.backbone,
        crop_mode=args.crop_mode,
        view_filter=args.view_filter,
        level=args.level,
        site_id=args.site_id,
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    html = fig.to_html(full_html=True, include_plotlyjs=True)
    output_path.write_text(html, encoding="utf-8")
    print(f"\nSaved → {output_path}")

    # Print category breakdown
    category_counts: dict[str, int] = defaultdict(int)
    for p in points:
        category_counts[p["culture_category"]] += 1
    print("\nCategory breakdown:")
    for cat, count in sorted(category_counts.items(), key=lambda x: -x[1]):
        print(f"  {cat}: {count}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
