from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score
from sklearn.model_selection import StratifiedKFold, cross_val_predict, cross_val_score
from sklearn.preprocessing import StandardScaler


REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = REPO_ROOT / "src"
SCRIPT_ROOT = Path(__file__).resolve().parent
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))
if str(SCRIPT_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPT_ROOT))

from kera_research.services.retrieval import DINOv2_MODEL_ID
from kera_research.services.control_plane import ControlPlaneStore
from kera_research.services.data_plane import SiteStore
from kera_research.services.pipeline import ResearchWorkflowService
from visualize_dinov2_clusters_3d import compute_cluster_stats, run_umap


DEFAULT_CV_ROOT = REPO_ROOT / "artifacts" / "final_white_summary_cv_20260402_p101_5fold"
DEFAULT_OUT_DIR = REPO_ROOT / "artifacts" / "paper_figures" / "figure5_dinov2_umap_geometry_20260404"

CLASS_COLORS = {
    "bacterial": "#2563eb",
    "fungal": "#f97316",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export Figure 5: lesion-centered DINOv2 UMAP geometry and visit-level aggregation analysis."
    )
    parser.add_argument("--cv-root", type=Path, default=DEFAULT_CV_ROOT)
    parser.add_argument("--site-id", default="39100103")
    parser.add_argument(
        "--component",
        default="official_dinov2_image_retrieval_lesion",
        help="Legacy OOF component name. Figure 5 now uses the corrected current lesion-centered dataset.",
    )
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument("--device", default="auto", choices=["auto", "cuda", "cpu"])
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--umap-neighbors", type=int, default=15)
    parser.add_argument("--umap-min-dist", type=float, default=0.1)
    return parser.parse_args()


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def save_figure(fig: plt.Figure, output_dir: Path, stem: str) -> tuple[Path, Path]:
    svg_path = output_dir / f"{stem}.svg"
    png_path = output_dir / f"{stem}.png"
    fig.savefig(svg_path, bbox_inches="tight")
    fig.savefig(png_path, dpi=240, bbox_inches="tight")
    plt.close(fig)
    return png_path, svg_path


def unique_oof_rows(cv_root: Path, component: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for path in sorted(cv_root.glob(f"fold_*/{component}/result.json")):
        payload = load_json(path)
        rows.extend(payload["result"].get("test_predictions") or [])
    deduped: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in rows:
        sample_key = str(row.get("sample_key") or "").strip()
        if not sample_key or sample_key in seen:
            continue
        seen.add(sample_key)
        deduped.append(row)
    return deduped


def count_total_oof_rows(cv_root: Path, component: str) -> int:
    rows = unique_oof_rows(cv_root, component)
    return len(rows)


def load_current_lesion_centered_rows(site_id: str) -> list[dict[str, Any]]:
    site_store = SiteStore(site_id)
    workflow = ResearchWorkflowService(ControlPlaneStore())
    manifest_rows = [row for row in site_store.dataset_records() if str(row.get("view") or "").strip().lower() == "white"]
    prepared = workflow._prepare_records_for_model(site_store, manifest_rows, crop_mode="manual")
    return [
        {
            "patient_id": str(row.get("patient_id") or ""),
            "visit_date": str(row.get("visit_date") or ""),
            "true_label": str(row.get("culture_category") or ""),
            "image_path": str(row.get("image_path") or ""),
            "source_image_path": str(row.get("source_image_path") or ""),
            "sample_key": f"image::{row.get('patient_id')}::{row.get('visit_date')}::{row.get('source_image_path')}",
        }
        for row in prepared
    ]


def resolve_device(requested: str) -> str:
    try:
        import torch
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("PyTorch is required for DINOv2 embedding extraction.") from exc
    normalized = str(requested or "auto").strip().lower()
    if normalized.startswith("cuda") and torch.cuda.is_available():
        return normalized
    if normalized == "auto" and torch.cuda.is_available():
        return "cuda:0"
    return "cpu"


def encode_cls_embeddings(
    image_paths: list[str],
    *,
    requested_device: str,
    batch_size: int,
    cache_dir: Path,
) -> np.ndarray:
    try:
        import torch
        from transformers import AutoImageProcessor, AutoModel
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("transformers and torch are required for Figure 5 export.") from exc

    device = resolve_device(requested_device)
    processor = AutoImageProcessor.from_pretrained(DINOv2_MODEL_ID)
    model = AutoModel.from_pretrained(DINOv2_MODEL_ID).to(device)
    model.eval()

    cache_dir.mkdir(parents=True, exist_ok=True)
    results: list[np.ndarray | None] = [None] * len(image_paths)
    pending_indices: list[int] = []
    for idx, image_path in enumerate(image_paths):
        cache_key = hashlib.sha256(f"figure5_cls::{image_path}".encode()).hexdigest()
        disk_path = cache_dir / f"{cache_key}.npy"
        if disk_path.exists():
            try:
                results[idx] = np.load(disk_path)
                continue
            except Exception:
                pass
        pending_indices.append(idx)

    for start in range(0, len(pending_indices), batch_size):
        chunk_indices = pending_indices[start : start + batch_size]
        pil_images: list[Any] = []
        valid_indices: list[int] = []
        for idx in chunk_indices:
            try:
                pil_images.append(Image.open(image_paths[idx]).convert("RGB"))
                valid_indices.append(idx)
            except Exception:
                results[idx] = np.zeros(768, dtype=np.float32)
        if not pil_images:
            continue
        inputs = processor(images=pil_images, return_tensors="pt")
        inputs = {key: value.to(device) for key, value in inputs.items()}
        with torch.no_grad():
            outputs = model(**inputs)
        features = outputs.last_hidden_state[:, 0]
        features = features / features.norm(dim=-1, keepdim=True).clamp_min(1e-12)
        embeddings = features.detach().cpu().numpy().astype(np.float32)
        for j, idx in enumerate(valid_indices):
            embedding = embeddings[j]
            results[idx] = embedding
            cache_key = hashlib.sha256(f"figure5_cls::{image_paths[idx]}".encode()).hexdigest()
            np.save(cache_dir / f"{cache_key}.npy", embedding)

    return np.stack(results, axis=0)  # type: ignore[arg-type]


def build_visit_level_embeddings(
    image_rows: list[dict[str, Any]],
    image_embeddings: np.ndarray,
) -> tuple[list[dict[str, Any]], np.ndarray]:
    grouped: dict[tuple[str, str, str], list[np.ndarray]] = defaultdict(list)
    for row, embedding in zip(image_rows, image_embeddings, strict=False):
        key = (
            str(row.get("patient_id") or ""),
            str(row.get("visit_date") or ""),
            str(row.get("true_label") or ""),
        )
        grouped[key].append(embedding)

    visit_points: list[dict[str, Any]] = []
    visit_embeddings: list[np.ndarray] = []
    for (patient_id, visit_date, label), vectors in sorted(grouped.items()):
        visit_vector = np.mean(np.stack(vectors, axis=0), axis=0).astype(np.float32)
        visit_vector = visit_vector / max(float(np.linalg.norm(visit_vector)), 1e-12)
        visit_points.append(
            {
                "patient_id": patient_id,
                "visit_date": visit_date,
                "culture_category": label,
                "n_images": len(vectors),
            }
        )
        visit_embeddings.append(visit_vector)
    return visit_points, np.stack(visit_embeddings, axis=0)


def compute_lr_projection_metrics(coords_2d: np.ndarray, labels: np.ndarray) -> dict[str, Any]:
    scaler = StandardScaler()
    x_scaled = scaler.fit_transform(coords_2d)
    clf = LogisticRegression(C=1.0, class_weight="balanced", max_iter=500, random_state=42)
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    cv_acc = float(cross_val_score(clf, x_scaled, labels, cv=cv).mean())
    y_pred_cv = cross_val_predict(clf, x_scaled, labels, cv=cv)
    n_misclassified = int((y_pred_cv != labels).sum())
    clf.fit(x_scaled, labels)
    return {
        "scaler": scaler,
        "clf": clf,
        "cv_acc": cv_acc,
        "n_misclassified": n_misclassified,
        "n_points": int(len(labels)),
        "y_pred_cv": y_pred_cv,
    }


def draw_decision_panel(
    ax: plt.Axes,
    coords_2d: np.ndarray,
    labels: np.ndarray,
    *,
    title: str,
    panel_label: str,
) -> dict[str, Any]:
    metrics = compute_lr_projection_metrics(coords_2d, labels)
    scaler = metrics["scaler"]
    clf = metrics["clf"]
    y_pred_cv = metrics["y_pred_cv"]

    ax.set_facecolor("#f8fafc")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(True, alpha=0.22, linewidth=0.6)

    pad = max(
        float(coords_2d[:, 0].max() - coords_2d[:, 0].min()),
        float(coords_2d[:, 1].max() - coords_2d[:, 1].min()),
    ) * 0.15 + 0.6
    x_min, x_max = coords_2d[:, 0].min() - pad, coords_2d[:, 0].max() + pad
    y_min, y_max = coords_2d[:, 1].min() - pad, coords_2d[:, 1].max() + pad
    xx, yy = np.mgrid[x_min:x_max:240j, y_min:y_max:240j]
    mesh_prob = clf.predict_proba(scaler.transform(np.c_[xx.ravel(), yy.ravel()]))[:, 1].reshape(xx.shape)
    ax.contourf(xx, yy, mesh_prob, levels=[0.0, 0.5, 1.0], colors=["#2563eb", "#f97316"], alpha=0.08, zorder=1)
    ax.contour(xx, yy, mesh_prob, levels=[0.5], colors=["#374151"], linewidths=1.4, linestyles="--", zorder=2)

    for label_value, name in ((0, "bacterial"), (1, "fungal")):
        mask = labels == label_value
        ax.scatter(
            coords_2d[mask, 0],
            coords_2d[mask, 1],
            c=CLASS_COLORS[name],
            s=34,
            alpha=0.78,
            edgecolors="white",
            linewidths=0.4,
            zorder=3,
        )

    misclassified_mask = y_pred_cv != labels
    if misclassified_mask.any():
        ax.scatter(
            coords_2d[misclassified_mask, 0],
            coords_2d[misclassified_mask, 1],
            s=120,
            facecolors="none",
            edgecolors="#ef4444",
            linewidths=1.5,
            zorder=4,
        )

    ax.text(
        0.0,
        1.02,
        panel_label,
        transform=ax.transAxes,
        fontsize=15,
        fontweight="bold",
        ha="left",
        va="bottom",
    )
    ax.set_title(title, fontsize=11, pad=8)
    ax.set_xlabel("UMAP-1")
    ax.set_ylabel("UMAP-2")
    ax.text(
        0.98,
        0.02,
        f"5-fold LR accuracy: {metrics['cv_acc']:.1%}\nMisclassified: {metrics['n_misclassified']} / {metrics['n_points']}",
        transform=ax.transAxes,
        fontsize=8.8,
        ha="right",
        va="bottom",
        bbox=dict(boxstyle="round,pad=0.4", facecolor="white", edgecolor="#cbd5e1", alpha=0.92),
    )
    return metrics


def draw_geometry_panel(
    ax: plt.Axes,
    coords_2d: np.ndarray,
    points: list[dict[str, Any]],
    stats: dict[str, Any],
    *,
    title: str,
    panel_label: str,
) -> None:
    from scipy.spatial import ConvexHull
    from scipy.stats import gaussian_kde

    ax.set_facecolor("#f8fafc")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(True, alpha=0.22, linewidth=0.6)

    category_masks = {
        "bacterial": np.array([p["culture_category"] == "bacterial" for p in points]),
        "fungal": np.array([p["culture_category"] == "fungal" for p in points]),
    }

    for name in ("bacterial", "fungal"):
        mask = category_masks[name]
        xy = coords_2d[mask]
        ax.scatter(
            xy[:, 0],
            xy[:, 1],
            c=CLASS_COLORS[name],
            s=36,
            alpha=0.75,
            edgecolors="white",
            linewidths=0.4,
            zorder=3,
            label=name.capitalize(),
        )
        if len(xy) >= 8:
            kde = gaussian_kde(np.vstack([xy[:, 0], xy[:, 1]]), bw_method=0.35)
            pad = max(float(np.ptp(xy[:, 0])), float(np.ptp(xy[:, 1]))) * 0.25 + 0.35
            xx, yy = np.mgrid[
                xy[:, 0].min() - pad : xy[:, 0].max() + pad : 80j,
                xy[:, 1].min() - pad : xy[:, 1].max() + pad : 80j,
            ]
            zz = kde(np.vstack([xx.ravel(), yy.ravel()])).reshape(xx.shape)
            ax.contour(xx, yy, zz, levels=3, colors=[CLASS_COLORS[name]], alpha=0.45, linewidths=1.0, zorder=2)
        if len(xy) >= 4:
            hull = ConvexHull(xy)
            hull_pts = xy[hull.vertices]
            hull_pts = np.vstack([hull_pts, hull_pts[0]])
            ax.plot(hull_pts[:, 0], hull_pts[:, 1], color=CLASS_COLORS[name], linewidth=1.6, alpha=0.8, zorder=4)

    if "bacterial_centroid" in stats and "fungal_centroid" in stats:
        bc = np.asarray(stats["bacterial_centroid"], dtype=float)
        fc = np.asarray(stats["fungal_centroid"], dtype=float)
        ax.scatter(bc[0], bc[1], c=CLASS_COLORS["bacterial"], marker="*", s=260, edgecolors="white", linewidths=1.0, zorder=5)
        ax.scatter(fc[0], fc[1], c=CLASS_COLORS["fungal"], marker="*", s=260, edgecolors="white", linewidths=1.0, zorder=5)
        ax.plot([bc[0], fc[0]], [bc[1], fc[1]], linestyle="--", color="#334155", linewidth=1.2, alpha=0.7, zorder=4)

    ax.text(
        0.0,
        1.02,
        panel_label,
        transform=ax.transAxes,
        fontsize=15,
        fontweight="bold",
        ha="left",
        va="bottom",
    )
    ax.set_title(title, fontsize=11, pad=8)
    ax.set_xlabel("UMAP-1")
    ax.set_ylabel("UMAP-2")

    annotation = [
        f"Centroid distance: {stats['centroid_distance']:.3f}",
        (
            f"Fungal inside bacterial hull: "
            f"{stats['fungal_in_bacterial_hull_pct']:.1f}% "
            f"({stats['fungal_in_bacterial_hull_n']}/{stats['n_fungal']})"
        ),
        (
            f"Bacterial inside fungal hull: "
            f"{stats['bacterial_in_fungal_hull_pct']:.1f}% "
            f"({stats['bacterial_in_fungal_hull_n']}/{stats['n_bacterial']})"
        ),
    ]
    ax.text(
        0.02,
        0.02,
        "\n".join(annotation),
        transform=ax.transAxes,
        fontsize=8.8,
        ha="left",
        va="bottom",
        bbox=dict(boxstyle="round,pad=0.4", facecolor="white", edgecolor="#cbd5e1", alpha=0.92),
    )
    ax.legend(loc="upper right", frameon=False)


def write_summary_csv(summary: dict[str, Any], output_dir: Path) -> Path:
    csv_path = output_dir / "summary.csv"
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(summary.keys()))
        writer.writeheader()
        writer.writerow(summary)
    return csv_path


def write_html(output_dir: Path, summary_csv: Path, png_path: Path) -> Path:
    html_path = output_dir / "figures.html"
    html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Figure 5 — DINOv2 UMAP Geometry</title>
  <style>
    body {{ font-family: Arial, sans-serif; margin: 24px; color: #111827; }}
    img {{ max-width: 100%; height: auto; border: 1px solid #cbd5e1; }}
    a {{ color: #1d4ed8; }}
  </style>
</head>
<body>
  <h1>Figure 5 — DINOv2 UMAP Geometry</h1>
  <p>Summary CSV: <a href="{summary_csv.name}">{summary_csv.name}</a></p>
  <p><img src="{png_path.name}" alt="Figure 5 DINOv2 UMAP geometry"></p>
</body>
</html>
"""
    html_path.write_text(html, encoding="utf-8")
    return html_path


def main() -> int:
    args = parse_args()
    output_dir = args.out_dir.expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    image_rows = load_current_lesion_centered_rows(str(args.site_id))
    total_white_images = len([row for row in SiteStore(str(args.site_id)).dataset_records() if str(row.get("view") or "").strip().lower() == "white"])
    image_paths = [str(row["image_path"]) for row in image_rows]
    image_labels = np.array([1 if str(row["true_label"]) == "fungal" else 0 for row in image_rows], dtype=int)

    embeddings = encode_cls_embeddings(
        image_paths,
        requested_device=args.device,
        batch_size=int(args.batch_size),
        cache_dir=output_dir / "embedding_cache",
    )
    image_coords = run_umap(
        embeddings,
        n_components=2,
        n_neighbors=int(args.umap_neighbors),
        min_dist=float(args.umap_min_dist),
    )

    visit_points, visit_embeddings = build_visit_level_embeddings(image_rows, embeddings)
    visit_labels = np.array([1 if point["culture_category"] == "fungal" else 0 for point in visit_points], dtype=int)
    visit_coords = run_umap(
        visit_embeddings,
        n_components=2,
        n_neighbors=int(args.umap_neighbors),
        min_dist=float(args.umap_min_dist),
    )
    visit_stats = compute_cluster_stats(visit_coords, visit_points)

    fig, axes = plt.subplots(1, 3, figsize=(18.2, 6.0))
    fig.patch.set_facecolor("white")

    image_metrics = draw_decision_panel(
        axes[0],
        image_coords,
        image_labels,
        title=f"Image-level lesion crops (evaluable subset, n={len(image_rows)})",
        panel_label="A",
    )
    visit_metrics = draw_decision_panel(
        axes[1],
        visit_coords,
        visit_labels,
        title=f"Visit-level mean pooling (n={len(visit_points)})",
        panel_label="B",
    )
    draw_geometry_panel(
        axes[2],
        visit_coords,
        visit_points,
        visit_stats,
        title="Visit-level embedding geometry",
        panel_label="C",
    )

    plt.tight_layout()
    png_path, svg_path = save_figure(fig, output_dir, "figure5_dinov2_umap_geometry")

    summary = {
        "total_white_image_count": total_white_images,
        "image_count": len(image_rows),
        "visit_count": len(visit_points),
        "umap_neighbors": int(args.umap_neighbors),
        "umap_min_dist": float(args.umap_min_dist),
        "image_lr_cv_accuracy": f"{image_metrics['cv_acc']:.6f}",
        "visit_lr_cv_accuracy": f"{visit_metrics['cv_acc']:.6f}",
        "visit_minus_image_accuracy": f"{(visit_metrics['cv_acc'] - image_metrics['cv_acc']):.6f}",
        "centroid_distance": f"{visit_stats['centroid_distance']:.6f}",
        "fungal_in_bacterial_hull_n": int(visit_stats["fungal_in_bacterial_hull_n"]),
        "fungal_in_bacterial_hull_pct": f"{visit_stats['fungal_in_bacterial_hull_pct']:.6f}",
        "bacterial_in_fungal_hull_n": int(visit_stats["bacterial_in_fungal_hull_n"]),
        "bacterial_in_fungal_hull_pct": f"{visit_stats['bacterial_in_fungal_hull_pct']:.6f}",
    }
    summary_csv = write_summary_csv(summary, output_dir)
    (output_dir / "image_rows.csv").write_text(
        "\n".join(
            [
                "patient_id,visit_date,true_label,image_path,source_image_path",
                *[
                    f"{row['patient_id']},{row['visit_date']},{row['true_label']},\"{row['image_path']}\",\"{row.get('source_image_path') or ''}\""
                    for row in image_rows
                ],
            ]
        ),
        encoding="utf-8",
    )
    html_path = write_html(output_dir, summary_csv, png_path)
    print(f"PNG: {png_path}")
    print(f"SVG: {svg_path}")
    print(f"CSV: {summary_csv}")
    print(f"HTML: {html_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
