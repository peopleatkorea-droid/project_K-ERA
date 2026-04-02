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

from kera_research.services.data_plane import SiteStore
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

# culture_category → marker symbol (Plotly 3D)
CATEGORY_SYMBOLS: dict[str, str] = {
    "bacteria": "circle",
    "bacterial": "circle",
    "fungus": "diamond",
    "fungal": "diamond",
    "acanthamoeba": "square",
    "mixed": "cross",
    "unknown": "circle-open",
}

# culture_category → matplotlib marker
CATEGORY_MPL_MARKERS: dict[str, str] = {
    "bacteria": "o",
    "bacterial": "o",
    "fungus": "D",
    "fungal": "D",
    "acanthamoeba": "s",
    "mixed": "P",
    "unknown": "o",
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
        help="Image crop mode (cornea_roi/lesion_crop use cached crops from disk)",
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
    parser.add_argument(
        "--no-trajectory",
        action="store_true",
        help="Disable visit trajectory lines in the 3D plot",
    )
    parser.add_argument(
        "--no-2d",
        action="store_true",
        help="Skip 2D UMAP matplotlib figure generation",
    )
    return parser.parse_args()


def _get_color(category: str) -> str:
    return CATEGORY_COLORS.get(category, CATEGORY_COLORS["unknown"])


def _get_symbol(category: str) -> str:
    return CATEGORY_SYMBOLS.get(category, CATEGORY_SYMBOLS["unknown"])


def _get_mpl_marker(category: str) -> str:
    return CATEGORY_MPL_MARKERS.get(category, CATEGORY_MPL_MARKERS["unknown"])


def _normalize_category(raw: Any) -> str:
    return str(raw or "unknown").strip().lower() or "unknown"


def filter_by_view(records: list[dict[str, Any]], view_filter: str) -> list[dict[str, Any]]:
    if view_filter == "all":
        return records
    target = view_filter.strip().lower()
    return [r for r in records if str(r.get("view") or "").strip().lower() == target]


def _resolve_cached_roi_crop(record: dict[str, Any], site_store: SiteStore) -> dict[str, Any] | None:
    original_path = str(record.get("image_path") or "").strip()
    if not original_path:
        return None
    stem = Path(original_path).stem
    crop_path = site_store.roi_crop_dir / f"{stem}_crop.png"
    if not crop_path.exists():
        return None
    return {**record, "image_path": str(crop_path)}


def _resolve_cached_lesion_crop(record: dict[str, Any], site_store: SiteStore) -> dict[str, Any] | None:
    original_path = str(record.get("image_path") or "").strip()
    if not original_path:
        return None
    stem = Path(original_path).stem
    crop_path = site_store.lesion_crop_dir / f"{stem}_crop.png"
    if not crop_path.exists():
        return None
    return {**record, "image_path": str(crop_path)}


def prepare_image_records(
    *,
    manifest_records: list[dict[str, Any]],
    crop_mode: str,
    view_filter: str,
    site_store: SiteStore,
) -> list[dict[str, Any]]:
    normalized = crop_mode.strip().lower()
    if normalized == "full":
        base = [r for r in manifest_records if str(r.get("image_path") or "").strip()]
    elif normalized == "cornea_roi":
        resolved = [_resolve_cached_roi_crop(r, site_store) for r in manifest_records]
        base = [r for r in resolved if r is not None]
        if not base:
            raise RuntimeError(
                "No cached cornea ROI crops found. Run MedSAM segmentation for these cases first."
            )
    elif normalized == "lesion_crop":
        resolved = [_resolve_cached_lesion_crop(r, site_store) for r in manifest_records]
        base = [r for r in resolved if r is not None]
        if not base:
            raise RuntimeError(
                "No cached lesion crops found. Cases need lesion boxes saved and MedSAM run first."
            )
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


def run_umap(embeddings: np.ndarray, n_components: int, n_neighbors: int, min_dist: float, *, return_reducer: bool = False):
    try:
        from umap import UMAP
    except ImportError as exc:
        raise RuntimeError(
            "umap-learn is required. Install it with: uv add umap-learn"
        ) from exc
    reducer = UMAP(
        n_components=n_components,
        n_neighbors=n_neighbors,
        min_dist=min_dist,
        random_state=42,
        verbose=True,
    )
    coords = reducer.fit_transform(embeddings).astype(np.float32)
    if return_reducer:
        return coords, reducer
    return coords


# ---------------------------------------------------------------------------
# Feature 1: Centroid distance + Overlap density
# ---------------------------------------------------------------------------

def compute_cluster_stats(
    coords: np.ndarray,
    points: list[dict[str, Any]],
) -> dict[str, Any]:
    """Compute centroid distance and ConvexHull overlap between bacterial and fungal clusters."""
    try:
        from scipy.spatial import Delaunay, ConvexHull
    except ImportError:
        print("WARNING: scipy not available; cluster stats skipped.", file=sys.stderr)
        return {}

    bact_mask = np.array([p["culture_category"] in ("bacterial", "bacteria") for p in points])
    fung_mask = np.array([p["culture_category"] in ("fungal", "fungus") for p in points])

    stats: dict[str, Any] = {}
    n_bact = int(bact_mask.sum())
    n_fung = int(fung_mask.sum())

    if n_bact < 4 or n_fung < 1:
        return stats

    bact_coords = coords[bact_mask]
    fung_coords = coords[fung_mask]

    bact_centroid = bact_coords.mean(axis=0)
    fung_centroid = fung_coords.mean(axis=0)
    stats["bacterial_centroid"] = bact_centroid
    stats["fungal_centroid"] = fung_centroid
    stats["centroid_distance"] = float(np.linalg.norm(bact_centroid - fung_centroid))
    stats["n_bacterial"] = n_bact
    stats["n_fungal"] = n_fung

    # Fungal points inside bacterial ConvexHull
    try:
        ConvexHull(bact_coords)  # verify hull is valid
        tri_bact = Delaunay(bact_coords)
        n_fung_in_bact = int((tri_bact.find_simplex(fung_coords) >= 0).sum())
        stats["fungal_in_bacterial_hull_n"] = n_fung_in_bact
        stats["fungal_in_bacterial_hull_pct"] = 100.0 * n_fung_in_bact / n_fung
    except Exception as exc:
        print(f"WARNING: bacterial ConvexHull failed: {exc}", file=sys.stderr)

    # Bacterial points inside fungal ConvexHull
    if n_fung >= 4:
        try:
            ConvexHull(fung_coords)
            tri_fung = Delaunay(fung_coords)
            n_bact_in_fung = int((tri_fung.find_simplex(bact_coords) >= 0).sum())
            stats["bacterial_in_fungal_hull_n"] = n_bact_in_fung
            stats["bacterial_in_fungal_hull_pct"] = 100.0 * n_bact_in_fung / n_bact
        except Exception as exc:
            print(f"WARNING: fungal ConvexHull failed: {exc}", file=sys.stderr)

    return stats


def print_cluster_stats(stats: dict[str, Any]) -> None:
    if not stats:
        return
    print("\nCluster statistics:")
    if "centroid_distance" in stats:
        print(f"  Centroid distance (UMAP space): {stats['centroid_distance']:.4f}")
    if "fungal_in_bacterial_hull_pct" in stats:
        print(
            f"  Fungal inside bacterial ConvexHull: "
            f"{stats['fungal_in_bacterial_hull_pct']:.1f}% "
            f"({stats['fungal_in_bacterial_hull_n']}/{stats['n_fungal']})"
        )
    if "bacterial_in_fungal_hull_pct" in stats:
        print(
            f"  Bacterial inside fungal ConvexHull: "
            f"{stats['bacterial_in_fungal_hull_pct']:.1f}% "
            f"({stats['bacterial_in_fungal_hull_n']}/{stats['n_bacterial']})"
        )


# ---------------------------------------------------------------------------
# Feature 2: Visit trajectory traces (Plotly 3D lines)
# ---------------------------------------------------------------------------

def build_trajectory_traces(
    coords: np.ndarray,
    points: list[dict[str, Any]],
) -> list[Any]:
    """Return Scatter3d line traces connecting visits of the same patient in date order."""
    import plotly.graph_objects as go

    # Group visit indices by patient_id
    patient_visits: dict[str, list[tuple[str, int]]] = defaultdict(list)
    for i, point in enumerate(points):
        pid = str(point.get("patient_id") or "").strip()
        vdate = str(point.get("visit_date") or "").strip()
        if pid and vdate:
            patient_visits[pid].append((vdate, i))

    traces = []
    first_trajectory = True
    multi_visit_count = 0

    for pid, visit_list in sorted(patient_visits.items()):
        if len(visit_list) < 2:
            continue
        sorted_visits = sorted(visit_list, key=lambda x: x[0])
        indices = [v[1] for v in sorted_visits]
        multi_visit_count += 1

        # Color by category of the patient's majority category
        cats = [points[i]["culture_category"] for i in indices]
        majority_cat = max(set(cats), key=cats.count)
        color = _get_color(majority_cat)

        traces.append(
            go.Scatter3d(
                x=coords[indices, 0],
                y=coords[indices, 1],
                z=coords[indices, 2],
                mode="lines+markers",
                name="Visit trajectory" if first_trajectory else "",
                legendgroup="trajectory",
                showlegend=first_trajectory,
                line=dict(color=color, width=3),
                marker=dict(size=3, color=color, opacity=0.6),
                opacity=0.45,
                hovertext=[
                    f"Patient {pid}<br>Visit {v[0]}" for v in sorted_visits
                ],
                hovertemplate="%{hovertext}<extra></extra>",
            )
        )
        first_trajectory = False

    if multi_visit_count > 0:
        print(f"  Trajectory lines drawn for {multi_visit_count} patients with ≥2 visits")

    return traces


# ---------------------------------------------------------------------------
# Feature 3: 2D UMAP matplotlib (publication-ready)
# ---------------------------------------------------------------------------

def build_2d_figure_matplotlib(
    coords_2d: np.ndarray,
    points: list[dict[str, Any]],
    stats: dict[str, Any],
    *,
    backbone: str,
    crop_mode: str,
    view_filter: str,
    level: str,
    site_id: str,
) -> Any:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.lines import Line2D

    fig, ax = plt.subplots(figsize=(8, 7))
    ax.set_facecolor("#f8fafc")
    fig.patch.set_facecolor("white")

    category_groups: dict[str, list[int]] = defaultdict(list)
    for i, point in enumerate(points):
        category_groups[point["culture_category"]].append(i)

    drawn_legend: list[Any] = []

    for category in sorted(category_groups.keys()):
        indices = category_groups[category]
        if not indices:
            continue
        color = _get_color(category)
        marker = _get_mpl_marker(category)
        x = coords_2d[indices, 0]
        y = coords_2d[indices, 1]

        # KDE density contour
        if len(indices) >= 8:
            try:
                from scipy.stats import gaussian_kde
                xy = np.vstack([x, y])
                kde = gaussian_kde(xy, bw_method=0.35)
                pad = max((x.max() - x.min()), (y.max() - y.min())) * 0.3 + 0.5
                xx, yy = np.mgrid[
                    x.min() - pad : x.max() + pad : 80j,
                    y.min() - pad : y.max() + pad : 80j,
                ]
                zz = kde(np.vstack([xx.ravel(), yy.ravel()])).reshape(xx.shape)
                ax.contourf(xx, yy, zz, levels=5, colors=[color], alpha=0.10)
                ax.contour(xx, yy, zz, levels=3, colors=[color], alpha=0.35, linewidths=0.8)
            except Exception:
                pass

        # Scatter points
        sc = ax.scatter(
            x, y,
            c=color, marker=marker, s=45,
            alpha=0.78, edgecolors="white", linewidths=0.5, zorder=3,
        )
        drawn_legend.append(
            Line2D(
                [0], [0],
                marker=marker, color="w",
                markerfacecolor=color, markersize=9,
                label=category.capitalize(),
            )
        )

    # Centroid markers + connecting line
    if "bacterial_centroid" in stats and "fungal_centroid" in stats:
        bc = stats["bacterial_centroid"]
        fc = stats["fungal_centroid"]
        ax.scatter(bc[0], bc[1], c="#2563eb", marker="*", s=320, zorder=5,
                   edgecolors="white", linewidths=1.2)
        ax.scatter(fc[0], fc[1], c="#f97316", marker="*", s=320, zorder=5,
                   edgecolors="white", linewidths=1.2)
        ax.plot([bc[0], fc[0]], [bc[1], fc[1]], "k--", alpha=0.45, linewidth=1.2, zorder=4)

        # Centroid distance label at midpoint
        mx, my = (bc[0] + fc[0]) / 2, (bc[1] + fc[1]) / 2
        ax.text(
            mx, my,
            f"  d={stats['centroid_distance']:.3f}",
            fontsize=8, color="#374151", zorder=6,
            ha="left", va="center",
        )
        drawn_legend.append(
            Line2D([0], [0], marker="*", color="w", markerfacecolor="#888888",
                   markersize=12, label="Centroid")
        )

    # Stats annotation box (bottom-left)
    annot_lines: list[str] = []
    if "centroid_distance" in stats:
        annot_lines.append(f"Centroid dist: {stats['centroid_distance']:.3f}")
    if stats.get("fungal_in_bacterial_hull_pct") is not None:
        n_f = stats["n_fungal"]
        annot_lines.append(
            f"Fungal ∩ bacterial hull: "
            f"{stats['fungal_in_bacterial_hull_pct']:.1f}% "
            f"({stats['fungal_in_bacterial_hull_n']}/{n_f})"
        )
    if stats.get("bacterial_in_fungal_hull_pct") is not None:
        n_b = stats["n_bacterial"]
        annot_lines.append(
            f"Bacterial ∩ fungal hull: "
            f"{stats['bacterial_in_fungal_hull_pct']:.1f}% "
            f"({stats['bacterial_in_fungal_hull_n']}/{n_b})"
        )
    if annot_lines:
        ax.text(
            0.02, 0.02, "\n".join(annot_lines),
            transform=ax.transAxes,
            fontsize=8.5, verticalalignment="bottom",
            bbox=dict(
                boxstyle="round,pad=0.45",
                facecolor="white", alpha=0.88,
                edgecolor="#cbd5e1",
            ),
        )

    # Legend
    ax.legend(
        handles=drawn_legend,
        loc="upper right",
        framealpha=0.92,
        fontsize=9,
        edgecolor="#cbd5e1",
    )

    view_label = view_filter if view_filter != "all" else "all views"
    ax.set_title(
        f"DINOv2 Embedding Cluster — 2D UMAP  ({level}-level)\n"
        f"site={site_id}  ·  backbone={backbone}  ·  crop={crop_mode}  ·  view={view_label}  ·  n={len(points)}",
        fontsize=10,
    )
    ax.set_xlabel("UMAP-1", fontsize=10)
    ax.set_ylabel("UMAP-2", fontsize=10)
    ax.grid(True, alpha=0.25, linewidth=0.5)
    ax.spines[["top", "right"]].set_visible(False)
    plt.tight_layout()
    return fig


# ---------------------------------------------------------------------------
# Feature 4: Decision boundary + misclassification + aggregation comparison
# ---------------------------------------------------------------------------

def _draw_lr_panel(
    ax: Any,
    coords_2d: np.ndarray,
    points: list[dict[str, Any]],
    *,
    title: str,
) -> dict[str, Any]:
    """Draw one panel: scatter + LR decision boundary + misclassified rings. Returns stats dict."""
    import matplotlib.pyplot as plt
    from sklearn.linear_model import LogisticRegression
    from sklearn.preprocessing import StandardScaler
    from sklearn.model_selection import StratifiedKFold, cross_val_score

    ax.set_facecolor("#f8fafc")
    ax.grid(True, alpha=0.22, linewidth=0.5)
    ax.spines[["top", "right"]].set_visible(False)

    bact_mask = np.array([p["culture_category"] in ("bacterial", "bacteria") for p in points])
    fung_mask = np.array([p["culture_category"] in ("fungal", "fungus") for p in points])
    bf_mask = bact_mask | fung_mask

    # Draw all category scatter
    category_groups: dict[str, list[int]] = defaultdict(list)
    for i, point in enumerate(points):
        category_groups[point["culture_category"]].append(i)
    for category in sorted(category_groups.keys()):
        indices = category_groups[category]
        ax.scatter(
            coords_2d[indices, 0], coords_2d[indices, 1],
            c=_get_color(category), marker=_get_mpl_marker(category),
            s=35, alpha=0.75, edgecolors="white", linewidths=0.4, zorder=3,
        )

    stats: dict[str, Any] = {}
    n_bact = int(bact_mask.sum())
    n_fung = int(fung_mask.sum())
    if n_bact < 3 or n_fung < 3:
        ax.set_title(title, fontsize=10)
        return stats

    # Fit logistic regression on bacterial/fungal only
    bf_indices = np.where(bf_mask)[0]
    X_bf = coords_2d[bf_indices]
    y_bf = np.array([
        1 if points[i]["culture_category"] in ("fungal", "fungus") else 0
        for i in bf_indices
    ])

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X_bf)
    clf = LogisticRegression(C=1.0, class_weight="balanced", max_iter=500, random_state=42)
    clf.fit(X_scaled, y_bf)

    # Decision boundary meshgrid
    pad = max(float(coords_2d[:, 0].max() - coords_2d[:, 0].min()), float(coords_2d[:, 1].max() - coords_2d[:, 1].min())) * 0.15 + 0.6
    x_min, x_max = coords_2d[:, 0].min() - pad, coords_2d[:, 0].max() + pad
    y_min, y_max = coords_2d[:, 1].min() - pad, coords_2d[:, 1].max() + pad
    xx, yy = np.mgrid[x_min:x_max:260j, y_min:y_max:260j]
    Z = clf.predict_proba(
        scaler.transform(np.c_[xx.ravel(), yy.ravel()])
    )[:, 1].reshape(xx.shape)

    # Background territory fill (very light)
    ax.contourf(xx, yy, Z, levels=[0.0, 0.5, 1.0],
                colors=["#2563eb", "#f97316"], alpha=0.07, zorder=1)
    # Decision boundary line
    ax.contour(xx, yy, Z, levels=[0.5],
               colors=["#374151"], linewidths=1.6, linestyles="--", zorder=4)

    # Geometric misclassifications (wrong side of boundary)
    y_pred = clf.predict(X_scaled)
    mc_mask = y_pred != y_bf
    n_mc = int(mc_mask.sum())
    if n_mc > 0:
        mc_coords = X_bf[mc_mask]
        ax.scatter(mc_coords[:, 0], mc_coords[:, 1],
                   s=140, facecolors="none", edgecolors="#ef4444",
                   linewidths=1.8, zorder=7)

    # Cross-validated accuracy (stratified k-fold)
    n_cv = min(5, n_bact, n_fung)
    if n_cv >= 2:
        cv = StratifiedKFold(n_splits=n_cv, shuffle=True, random_state=42)
        cv_scores = cross_val_score(clf, X_scaled, y_bf, cv=cv)
        cv_acc = float(cv_scores.mean())
    else:
        cv_acc = float(clf.score(X_scaled, y_bf))

    stats["lr_cv_accuracy"] = cv_acc
    stats["n_misclassified"] = n_mc
    stats["n_bf"] = int(bf_mask.sum())

    # Accuracy box (bottom-right)
    ax.text(
        0.98, 0.02,
        f"LR acc ({n_cv}-fold CV): {cv_acc:.1%}\n"
        f"Misclassified: {n_mc} / {int(bf_mask.sum())}",
        transform=ax.transAxes, fontsize=8.5,
        ha="right", va="bottom",
        bbox=dict(boxstyle="round,pad=0.4", facecolor="white",
                  alpha=0.90, edgecolor="#cbd5e1"),
    )

    ax.set_title(title, fontsize=10, pad=6)
    ax.set_xlabel("UMAP-1", fontsize=9)
    ax.set_ylabel("UMAP-2", fontsize=9)
    return stats


def build_2d_advanced_figure_matplotlib(
    coords_2d_image: np.ndarray,
    image_points: list[dict[str, Any]],
    coords_2d_visit: np.ndarray,
    visit_points: list[dict[str, Any]],
    *,
    backbone: str,
    crop_mode: str,
    view_filter: str,
    site_id: str,
) -> Any:
    """2-panel figure: image-level vs visit-level UMAP with LR decision boundary."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.lines import Line2D
    from matplotlib.patches import Patch

    fig, axes = plt.subplots(1, 2, figsize=(14, 6.5))
    fig.patch.set_facecolor("white")

    stats_img = _draw_lr_panel(
        axes[0], coords_2d_image, image_points,
        title=f"Image-level  (n={len(image_points)})\nraw embeddings, no aggregation",
    )
    stats_vis = _draw_lr_panel(
        axes[1], coords_2d_visit, visit_points,
        title=f"Visit-level  (n={len(visit_points)})\nMIL mean-pooled centroids",
    )

    # Shared legend
    legend_elements = [
        Line2D([0], [0], marker="o", color="w", markerfacecolor="#2563eb",
               markersize=9, label="Bacterial"),
        Line2D([0], [0], marker="D", color="w", markerfacecolor="#f97316",
               markersize=9, label="Fungal"),
        Line2D([0], [0], color="#374151", linewidth=1.6, linestyle="--",
               label="LR decision boundary"),
        Line2D([0], [0], marker="o", color="w", markerfacecolor="none",
               markeredgecolor="#ef4444", markeredgewidth=1.8,
               markersize=10, label="Geometric misclassification"),
        Patch(facecolor="#2563eb", alpha=0.18, edgecolor="none", label="Bacterial territory"),
        Patch(facecolor="#f97316", alpha=0.18, edgecolor="none", label="Fungal territory"),
    ]
    fig.legend(
        handles=legend_elements, loc="lower center", ncol=3,
        fontsize=9, framealpha=0.92, edgecolor="#cbd5e1",
        bbox_to_anchor=(0.5, -0.02),
    )

    # Aggregation improvement banner
    if "lr_cv_accuracy" in stats_img and "lr_cv_accuracy" in stats_vis:
        acc_img = stats_img["lr_cv_accuracy"]
        acc_vis = stats_vis["lr_cv_accuracy"]
        delta = acc_vis - acc_img
        sign = "+" if delta >= 0 else ""
        bg_color = "#f0fdf4" if delta >= 0 else "#fef2f2"
        border_color = "#86efac" if delta >= 0 else "#fca5a5"
        fig.text(
            0.5, 0.975,
            f"Aggregation effect:  image LR {acc_img:.1%}  →  visit LR {acc_vis:.1%}"
            f"  ({sign}{delta:.1%}  separation {'improvement' if delta >= 0 else 'change'})",
            ha="center", va="top", fontsize=10.5,
            bbox=dict(boxstyle="round,pad=0.45", facecolor=bg_color,
                      edgecolor=border_color, alpha=0.92),
        )

    view_label = view_filter if view_filter != "all" else "all views"
    fig.suptitle(
        f"DINOv2 Embedding — Decision Boundary & Aggregation Analysis\n"
        f"site={site_id}  ·  backbone={backbone}  ·  crop={crop_mode}  ·  view={view_label}",
        fontsize=11, y=1.04,
    )
    plt.tight_layout(rect=[0, 0.10, 1, 0.97])
    return fig


# ---------------------------------------------------------------------------
# Cluster artifacts (for cluster-position query API)
# ---------------------------------------------------------------------------

def _save_cluster_artifacts(
    artifact_dir: Path,
    reducer: Any,
    embedding_matrix: np.ndarray,
    points: list[dict[str, Any]],
    coords_3d: np.ndarray,
    backbone: str,
    crop_mode: str,
    view_filter: str,
    level: str,
    site_id: str,
) -> None:
    """Save UMAP reducer, embeddings, and metadata for per-visit cluster-position queries."""
    import json
    import pickle

    reducer_path = artifact_dir / "umap_reducer_3d.pkl"
    with open(reducer_path, "wb") as f:
        pickle.dump(reducer, f, protocol=4)

    np.save(str(artifact_dir / "cluster_embeddings.npy"), embedding_matrix.astype(np.float32))

    metadata: dict[str, Any] = {
        "backbone": backbone,
        "crop_mode": crop_mode,
        "view_filter": view_filter,
        "level": level,
        "site_id": site_id,
        "points": [
            {
                "patient_id": p["patient_id"],
                "visit_date": p["visit_date"],
                "culture_category": p["culture_category"],
                "culture_species": p["culture_species"],
                "age": p["age"],
                "sex": p["sex"],
                "coords_3d": coords_3d[i].tolist(),
            }
            for i, p in enumerate(points)
        ],
    }
    (artifact_dir / "cluster_metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"  Saved UMAP reducer    → {reducer_path}")
    print(f"  Saved embeddings      → {artifact_dir / 'cluster_embeddings.npy'}")
    print(f"  Saved metadata        → {artifact_dir / 'cluster_metadata.json'}")


# ---------------------------------------------------------------------------
# Plotly 3D figure (updated with stats + trajectory)
# ---------------------------------------------------------------------------

def build_plotly_figure(
    coords: np.ndarray,
    points: list[dict[str, Any]],
    *,
    backbone: str,
    crop_mode: str,
    view_filter: str,
    level: str,
    site_id: str,
    stats: dict[str, Any] | None = None,
    trajectory_traces: list[Any] | None = None,
) -> Any:
    import plotly.graph_objects as go

    category_groups: dict[str, list[int]] = defaultdict(list)
    for i, point in enumerate(points):
        category_groups[point["culture_category"]].append(i)

    traces: list[Any] = []

    # Trajectory lines (drawn first so markers appear on top)
    if trajectory_traces:
        traces.extend(trajectory_traces)

    # Category scatter markers
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

    # Centroid markers + line
    if stats and "bacterial_centroid" in stats and "fungal_centroid" in stats:
        bc = stats["bacterial_centroid"]
        fc = stats["fungal_centroid"]
        dist = stats["centroid_distance"]
        for label, centroid, color in [
            ("Bacterial centroid", bc, "#2563eb"),
            ("Fungal centroid", fc, "#f97316"),
        ]:
            traces.append(
                go.Scatter3d(
                    x=[centroid[0]], y=[centroid[1]], z=[centroid[2]],
                    mode="markers",
                    name=label,
                    marker=dict(size=12, color=color, symbol="cross",
                                opacity=1.0, line=dict(width=2, color="white")),
                    showlegend=True,
                    hovertemplate=f"{label}<extra></extra>",
                )
            )
        traces.append(
            go.Scatter3d(
                x=[bc[0], fc[0]], y=[bc[1], fc[1]], z=[bc[2], fc[2]],
                mode="lines",
                name=f"Centroid dist: {dist:.3f}",
                line=dict(color="#6b7280", width=3, dash="dash"),
                showlegend=True,
                hovertemplate=f"Centroid distance: {dist:.3f}<extra></extra>",
            )
        )

    # Stats annotation (bottom-left of figure)
    annot_lines: list[str] = []
    if stats:
        if "centroid_distance" in stats:
            annot_lines.append(f"Centroid dist: {stats['centroid_distance']:.3f}")
        if stats.get("fungal_in_bacterial_hull_pct") is not None:
            n_f = stats["n_fungal"]
            annot_lines.append(
                f"Fungal ∩ bacterial hull: "
                f"{stats['fungal_in_bacterial_hull_pct']:.1f}%"
                f" ({stats['fungal_in_bacterial_hull_n']}/{n_f})"
            )
        if stats.get("bacterial_in_fungal_hull_pct") is not None:
            n_b = stats["n_bacterial"]
            annot_lines.append(
                f"Bacterial ∩ fungal hull: "
                f"{stats['bacterial_in_fungal_hull_pct']:.1f}%"
                f" ({stats['bacterial_in_fungal_hull_n']}/{n_b})"
            )

    view_label = view_filter if view_filter != "all" else "all views"
    title_text = (
        f"DINOv2 Embedding Cluster — {level.capitalize()} level  "
        f"<sub>(site={site_id} · backbone={backbone} · crop={crop_mode} · view={view_label} · n={len(points)})</sub>"
    )

    fig = go.Figure(data=traces)

    if annot_lines:
        fig.add_annotation(
            text="<br>".join(annot_lines),
            xref="paper", yref="paper",
            x=0.01, y=0.01,
            xanchor="left", yanchor="bottom",
            showarrow=False,
            bgcolor="white",
            bordercolor="#cbd5e1",
            borderwidth=1,
            font=dict(size=11),
            opacity=0.90,
        )

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
            title=dict(text="Legend"),
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


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main() -> int:
    args = parse_args()
    output_path = args.output.expanduser().resolve()

    site_store = SiteStore(args.site_id)
    manifest_records = site_store.generate_manifest().to_dict("records")

    print(f"Preparing records (crop_mode={args.crop_mode}, view_filter={args.view_filter})...")
    image_records = prepare_image_records(
        manifest_records=manifest_records,
        crop_mode=args.crop_mode,
        view_filter=args.view_filter,
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

    embedding_matrix = np.stack([p["embedding"] for p in points], axis=0)

    # --- 3D UMAP ---
    print(f"Running UMAP 3D on {len(points)} points (dim={image_embeddings.shape[1]})...")
    coords_3d, umap_reducer_3d = run_umap(
        embedding_matrix,
        n_components=3,
        n_neighbors=args.umap_neighbors,
        min_dist=args.umap_min_dist,
        return_reducer=True,
    )

    # --- Feature 1: cluster stats ---
    print("Computing cluster statistics...")
    stats = compute_cluster_stats(coords_3d, points)
    print_cluster_stats(stats)

    # --- Feature 2: visit trajectory traces ---
    trajectory_traces: list[Any] = []
    if args.level == "visit" and not args.no_trajectory:
        print("Building visit trajectory traces...")
        trajectory_traces = build_trajectory_traces(coords_3d, points)

    # --- Build + save 3D Plotly figure ---
    print("Building 3D Plotly figure...")
    fig = build_plotly_figure(
        coords_3d,
        points,
        backbone=args.backbone,
        crop_mode=args.crop_mode,
        view_filter=args.view_filter,
        level=args.level,
        site_id=args.site_id,
        stats=stats,
        trajectory_traces=trajectory_traces,
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    html = fig.to_html(full_html=True, include_plotlyjs=True)
    output_path.write_text(html, encoding="utf-8")
    print(f"\nSaved 3D HTML → {output_path}")

    # --- Save cluster artifacts for cluster-position API ---
    print("Saving cluster artifacts (reducer + embeddings + metadata)...")
    _save_cluster_artifacts(
        artifact_dir=output_path.parent,
        reducer=umap_reducer_3d,
        embedding_matrix=embedding_matrix,
        points=points,
        coords_3d=coords_3d,
        backbone=args.backbone,
        crop_mode=args.crop_mode,
        view_filter=args.view_filter,
        level=args.level,
        site_id=args.site_id,
    )

    # --- Feature 3: 2D UMAP + matplotlib ---
    if not args.no_2d:
        print(f"Running UMAP 2D on {len(points)} points...")
        coords_2d = run_umap(
            embedding_matrix,
            n_components=2,
            n_neighbors=args.umap_neighbors,
            min_dist=args.umap_min_dist,
        )
        # Use 2D coordinates for stats annotation (centroid projected to 2D)
        stats_2d = compute_cluster_stats(coords_2d, points)
        # Keep the 3D centroid distance in the annotation (more meaningful)
        stats_for_2d = {**stats_2d, "centroid_distance": stats.get("centroid_distance", stats_2d.get("centroid_distance"))}

        print("Building 2D matplotlib figure...")
        fig2d = build_2d_figure_matplotlib(
            coords_2d,
            points,
            stats_for_2d,
            backbone=args.backbone,
            crop_mode=args.crop_mode,
            view_filter=args.view_filter,
            level=args.level,
            site_id=args.site_id,
        )
        import matplotlib.pyplot as plt
        png_path = output_path.with_name("cluster_2d.png")
        svg_path = output_path.with_name("cluster_2d.svg")
        fig2d.savefig(str(png_path), dpi=300, bbox_inches="tight")
        fig2d.savefig(str(svg_path), bbox_inches="tight")
        plt.close(fig2d)
        print(f"Saved 2D PNG → {png_path}")
        print(f"Saved 2D SVG → {svg_path}")

        # --- Feature 4: Advanced figure (decision boundary + aggregation comparison) ---
        print("Building image-level points for advanced figure...")
        image_points_adv = build_image_level_points(image_records, image_embeddings, path_to_idx)

        # Visit-level points for comparison panel (reuse if already at visit level)
        if args.level == "visit":
            visit_points_adv = points
            coords_2d_vis_adv: np.ndarray | None = coords_2d
        else:
            visit_points_adv = build_visit_level_points(image_records, image_embeddings, path_to_idx)
            if len(visit_points_adv) >= 4:
                print(f"Running UMAP 2D on {len(visit_points_adv)} visit-level points for advanced figure...")
                emb_vis = np.stack([p["embedding"] for p in visit_points_adv], axis=0)
                coords_2d_vis_adv = run_umap(
                    emb_vis, n_components=2,
                    n_neighbors=args.umap_neighbors, min_dist=args.umap_min_dist,
                )
            else:
                visit_points_adv = []
                coords_2d_vis_adv = None

        if len(image_points_adv) >= 4 and len(visit_points_adv) >= 4 and coords_2d_vis_adv is not None:
            print(f"Running UMAP 2D on {len(image_points_adv)} image-level points for advanced figure...")
            emb_img = np.stack([p["embedding"] for p in image_points_adv], axis=0)
            coords_2d_img_adv = run_umap(
                emb_img, n_components=2,
                n_neighbors=args.umap_neighbors, min_dist=args.umap_min_dist,
            )
            print("Building advanced 2D matplotlib figure (decision boundary + aggregation)...")
            fig2d_adv = build_2d_advanced_figure_matplotlib(
                coords_2d_img_adv, image_points_adv,
                coords_2d_vis_adv, visit_points_adv,
                backbone=args.backbone,
                crop_mode=args.crop_mode,
                view_filter=args.view_filter,
                site_id=args.site_id,
            )
            adv_png = output_path.with_name("cluster_2d_advanced.png")
            adv_svg = output_path.with_name("cluster_2d_advanced.svg")
            fig2d_adv.savefig(str(adv_png), dpi=300, bbox_inches="tight")
            fig2d_adv.savefig(str(adv_svg), bbox_inches="tight")
            plt.close(fig2d_adv)
            print(f"Saved advanced 2D PNG → {adv_png}")
            print(f"Saved advanced 2D SVG → {adv_svg}")
        else:
            print("Skipping advanced figure (insufficient points for image-level or visit-level).")

    # --- Category breakdown ---
    category_counts: dict[str, int] = defaultdict(int)
    for p in points:
        category_counts[p["culture_category"]] += 1
    print("\nCategory breakdown:")
    for cat, count in sorted(category_counts.items(), key=lambda x: -x[1]):
        print(f"  {cat}: {count}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
