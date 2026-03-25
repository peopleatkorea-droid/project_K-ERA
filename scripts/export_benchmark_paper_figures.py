from __future__ import annotations

import argparse
import csv
import json
import sqlite3
from pathlib import Path
from statistics import mean
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.patches as mpatches
import matplotlib.pyplot as plt
import numpy as np


DEFAULT_DB_PATH = Path(r"C:\Users\USER\OneDrive\KERA\KERA_DATA\kera.db")
DEFAULT_OUTPUT_ROOT = Path("artifacts") / "paper-figures"
HIGHLIGHT_ARCHITECTURES = ["efficientnet_v2_s", "convnext_tiny", "vit"]

ARCH_LABEL = {
    "densenet121": "DenseNet121",
    "convnext_tiny": "ConvNeXt-Tiny",
    "vit": "ViT",
    "swin": "Swin",
    "efficientnet_v2_s": "EfficientNetV2-S",
    "dinov2": "DINOv2",
    "dinov2_mil": "DINOv2 Attention MIL",
    "dual_input_concat": "Dual-input Concat Fusion",
}

MODEL_FAMILY = {
    "densenet121": "CNN",
    "convnext_tiny": "CNN",
    "efficientnet_v2_s": "CNN",
    "vit": "Transformer",
    "swin": "Transformer",
    "dinov2": "Transformer",
    "dinov2_mil": "Transformer",
    "dual_input_concat": "Paired",
}

FAMILY_COLOR = {
    "CNN": "#2563eb",
    "Transformer": "#dc2626",
    "Paired": "#7c3aed",
}

HIGHLIGHT_COLOR = {
    "efficientnet_v2_s": "#1d4ed8",
    "convnext_tiny": "#16a34a",
    "vit": "#ef4444",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export paper-ready figures from the latest benchmark job.")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH, help="Path to the local K-ERA SQLite database.")
    parser.add_argument("--job-id", type=str, default=None, help="Benchmark job_id to export. Defaults to latest completed job.")
    parser.add_argument("--site-id", type=str, default=None, help="Optional site_id filter when selecting the latest job.")
    parser.add_argument("--out-dir", type=Path, default=None, help="Optional output directory. Defaults to artifacts/paper-figures/<job_id>.")
    return parser.parse_args()


def load_benchmark_payload(db_path: Path, *, job_id: str | None, site_id: str | None) -> tuple[str, sqlite3.Row, dict[str, Any]]:
    if not db_path.exists():
        raise FileNotFoundError(f"Database not found: {db_path}")
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    query = """
        select job_id, site_id, created_at, finished_at, result_json
        from site_jobs
        where job_type='initial_training_benchmark' and status='completed'
    """
    params: list[Any] = []
    if job_id:
        query += " and job_id=?"
        params.append(job_id)
    if site_id:
        query += " and site_id=?"
        params.append(site_id)
    query += " order by datetime(created_at) desc limit 1"
    row = conn.execute(query, params).fetchone()
    conn.close()
    if row is None:
        raise RuntimeError("No completed initial_training_benchmark job was found.")
    payload = json.loads(row["result_json"])
    return str(row["job_id"]), row, payload


def normalize_results(payload: dict[str, Any]) -> list[dict[str, Any]]:
    response = payload.get("response") or {}
    normalized: list[dict[str, Any]] = []
    for entry in response.get("results") or []:
        architecture = str(entry.get("architecture") or "").strip()
        result = entry.get("result") or {}
        test_metrics = result.get("test_metrics") or {}
        val_metrics = result.get("val_metrics") or {}
        normalized.append(
            {
                "architecture": architecture,
                "label": ARCH_LABEL.get(architecture, architecture),
                "family": MODEL_FAMILY.get(architecture, "Other"),
                "best_val_acc": float(result.get("best_val_acc") or 0.0),
                "test_acc": float(test_metrics.get("accuracy") or 0.0),
                "auroc": float(test_metrics.get("AUROC") or 0.0),
                "balanced_accuracy": float(test_metrics.get("balanced_accuracy") or 0.0),
                "roc_curve": test_metrics.get("roc_curve") or {},
                "val_auroc": float(val_metrics.get("AUROC") or 0.0),
            }
        )
    if not normalized:
        raise RuntimeError("The benchmark result payload does not contain any model results.")
    return normalized


def family_color(architecture: str, family: str) -> str:
    return HIGHLIGHT_COLOR.get(architecture, FAMILY_COLOR.get(family, "#64748b"))


def style_axes(ax: plt.Axes) -> None:
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(axis="y", alpha=0.25, linestyle="--", linewidth=0.8)


def save_figure(fig: plt.Figure, output_dir: Path, stem: str) -> tuple[Path, Path]:
    svg_path = output_dir / f"{stem}.svg"
    png_path = output_dir / f"{stem}.png"
    fig.savefig(svg_path, bbox_inches="tight")
    fig.savefig(png_path, dpi=220, bbox_inches="tight")
    plt.close(fig)
    return svg_path, png_path


def build_roc_figure(results: list[dict[str, Any]], output_dir: Path) -> tuple[Path, Path]:
    selected = [item for item in results if item["architecture"] in HIGHLIGHT_ARCHITECTURES]
    fig, ax = plt.subplots(figsize=(7.2, 6.1))
    ax.plot([0, 1], [0, 1], linestyle="--", color="#94a3b8", linewidth=1.0, label="Random")
    for item in selected:
        roc_curve = item["roc_curve"] or {}
        fpr = roc_curve.get("fpr") or []
        tpr = roc_curve.get("tpr") or []
        if not fpr or not tpr:
            continue
        ax.plot(
            fpr,
            tpr,
            linewidth=2.8,
            color=family_color(item["architecture"], item["family"]),
            label=f"{item['label']} (AUROC={item['auroc']:.3f})",
        )
    ax.set_xlim(-0.02, 1.02)
    ax.set_ylim(-0.02, 1.02)
    ax.set_xlabel("False Positive Rate")
    ax.set_ylabel("True Positive Rate")
    ax.set_title("Figure 1. ROC curve: EfficientNet vs ConvNeXt vs ViT", fontweight="bold")
    style_axes(ax)
    ax.legend(loc="lower right", frameon=False)
    caption = "CNN backbones are highlighted against ViT on the same held-out cohort."
    fig.text(0.02, 0.01, caption, fontsize=9, color="#475569")
    return save_figure(fig, output_dir, "figure_1_roc_curve")


def build_gap_figure(results: list[dict[str, Any]], output_dir: Path) -> tuple[Path, Path]:
    ordered = sorted(results, key=lambda item: item["best_val_acc"] - item["test_acc"], reverse=True)
    labels = [item["label"] for item in ordered]
    val_scores = [item["best_val_acc"] for item in ordered]
    test_scores = [item["test_acc"] for item in ordered]
    gaps = [val - test for val, test in zip(val_scores, test_scores)]
    colors = [family_color(item["architecture"], item["family"]) for item in ordered]
    families = {"CNN", "Transformer", "Paired"}
    family_gap_summary = {
        family: mean(
            item["best_val_acc"] - item["test_acc"]
            for item in ordered
            if item["family"] == family
        )
        for family in families
        if any(item["family"] == family for item in ordered)
    }

    x = np.arange(len(ordered))
    width = 0.36
    fig, axes = plt.subplots(1, 2, figsize=(13.2, 5.6), gridspec_kw={"width_ratios": [1.4, 1]})

    ax = axes[0]
    ax.bar(x - width / 2, val_scores, width, color=[f"{color}66" for color in colors], edgecolor=colors, linewidth=1.0, label="Val Acc")
    ax.bar(x + width / 2, test_scores, width, color=colors, edgecolor="#0f172a", linewidth=0.5, label="Test Acc")
    ax.set_xticks(x)
    ax.set_xticklabels(labels, rotation=25, ha="right")
    ax.set_ylim(0, 1.0)
    ax.set_ylabel("Accuracy")
    ax.set_title("Val Acc vs Test Acc", fontweight="bold")
    style_axes(ax)
    ax.legend(frameon=False, loc="upper right")

    ax = axes[1]
    ax.bar(x, gaps, color=colors, edgecolor="#0f172a", linewidth=0.5)
    ax.axhline(0, color="#0f172a", linewidth=0.8)
    for index, gap in enumerate(gaps):
        ax.text(index, gap + 0.008, f"{gap:+.3f}", ha="center", va="bottom", fontsize=8)
    summary_lines = [f"{family} mean gap: {value:+.3f}" for family, value in sorted(family_gap_summary.items())]
    ax.text(
        0.98,
        0.98,
        "\n".join(summary_lines),
        transform=ax.transAxes,
        ha="right",
        va="top",
        fontsize=8.5,
        color="#334155",
        bbox={"boxstyle": "round,pad=0.3", "facecolor": "#f8fafc", "edgecolor": "#cbd5e1"},
    )
    ax.set_xticks(x)
    ax.set_xticklabels(labels, rotation=25, ha="right")
    ax.set_ylabel("Val Acc - Test Acc")
    ax.set_title("Figure 2. Generalization gap", fontweight="bold")
    style_axes(ax)

    fig.text(0.02, 0.01, "Higher positive gap indicates a larger overfitting/generalization gap.", fontsize=9, color="#475569")
    return save_figure(fig, output_dir, "figure_2_generalization_gap")


def build_ranking_figure(results: list[dict[str, Any]], output_dir: Path) -> tuple[Path, Path]:
    ordered = sorted(results, key=lambda item: (item["auroc"], item["balanced_accuracy"]), reverse=True)
    labels = [item["label"] for item in ordered]
    auroc = [item["auroc"] for item in ordered]
    balanced = [item["balanced_accuracy"] for item in ordered]
    colors = [family_color(item["architecture"], item["family"]) for item in ordered]
    x = np.arange(len(ordered))
    width = 0.36

    fig, ax = plt.subplots(figsize=(12.6, 5.8))
    bars_auroc = ax.bar(x - width / 2, auroc, width, color=colors, edgecolor="#0f172a", linewidth=0.5, label="AUROC")
    bars_bal = ax.bar(
        x + width / 2,
        balanced,
        width,
        color=colors,
        edgecolor="#0f172a",
        linewidth=0.5,
        hatch="//",
        alpha=0.78,
        label="Balanced Acc",
    )
    for bars in (bars_auroc, bars_bal):
        for bar in bars:
            height = bar.get_height()
            ax.text(bar.get_x() + bar.get_width() / 2, height + 0.008, f"{height:.3f}", ha="center", va="bottom", fontsize=7.5)
    ax.axhline(0.5, color="#94a3b8", linestyle="--", linewidth=1.0)
    ax.set_xticks(x)
    ax.set_xticklabels(labels, rotation=25, ha="right")
    ax.set_ylim(0, 1.0)
    ax.set_ylabel("Score")
    ax.set_title("Figure 3. Model ranking by AUROC and balanced accuracy", fontweight="bold")
    style_axes(ax)
    family_patches = [
        mpatches.Patch(color=FAMILY_COLOR["CNN"], label="CNN"),
        mpatches.Patch(color=FAMILY_COLOR["Transformer"], label="Transformer"),
        mpatches.Patch(color=FAMILY_COLOR["Paired"], label="Paired"),
    ]
    first_legend = ax.legend(frameon=False, loc="upper right")
    ax.add_artist(first_legend)
    ax.legend(handles=family_patches, frameon=False, loc="upper left")
    return save_figure(fig, output_dir, "figure_3_model_ranking")


def write_summary_csv(results: list[dict[str, Any]], output_dir: Path) -> Path:
    csv_path = output_dir / "benchmark_summary.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=["architecture", "label", "family", "best_val_acc", "test_acc", "auroc", "balanced_accuracy", "generalization_gap"],
        )
        writer.writeheader()
        for item in results:
            writer.writerow(
                {
                    "architecture": item["architecture"],
                    "label": item["label"],
                    "family": item["family"],
                    "best_val_acc": f"{item['best_val_acc']:.6f}",
                    "test_acc": f"{item['test_acc']:.6f}",
                    "auroc": f"{item['auroc']:.6f}",
                    "balanced_accuracy": f"{item['balanced_accuracy']:.6f}",
                    "generalization_gap": f"{item['best_val_acc'] - item['test_acc']:+.6f}",
                }
            )
    return csv_path


def write_html_report(
    output_dir: Path,
    *,
    job_id: str,
    site_id: str,
    created_at: str,
    finished_at: str,
    results: list[dict[str, Any]],
    figure_paths: list[tuple[str, Path, Path]],
) -> Path:
    best_test = max(results, key=lambda item: (item["auroc"], item["balanced_accuracy"]))
    rows = "\n".join(
        f"<tr><td>{item['label']}</td><td>{item['family']}</td><td>{item['best_val_acc']:.3f}</td><td>{item['test_acc']:.3f}</td><td>{item['auroc']:.3f}</td><td>{item['balanced_accuracy']:.3f}</td><td>{item['best_val_acc'] - item['test_acc']:+.3f}</td></tr>"
        for item in sorted(results, key=lambda item: item["auroc"], reverse=True)
    )
    figure_sections = "\n".join(
        f"""
        <section class="figure-card">
          <h2>{title}</h2>
          <div class="links"><a href="{svg_path.name}">SVG</a> · <a href="{png_path.name}">PNG</a></div>
          <img src="{svg_path.name}" alt="{title}" />
        </section>
        """
        for title, svg_path, png_path in figure_paths
    )
    html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>K-ERA benchmark paper figures</title>
  <style>
    body {{ font-family: "Segoe UI", Arial, sans-serif; margin: 32px; color: #0f172a; background: #f8fafc; }}
    h1 {{ margin-bottom: 8px; }}
    .meta {{ color: #475569; margin-bottom: 24px; line-height: 1.6; }}
    .summary {{ background: white; border: 1px solid #cbd5e1; border-radius: 16px; padding: 16px 18px; margin-bottom: 24px; }}
    .figures {{ display: grid; gap: 20px; }}
    .figure-card {{ background: white; border: 1px solid #cbd5e1; border-radius: 16px; padding: 18px; }}
    .figure-card img {{ width: 100%; height: auto; border: 1px solid #e2e8f0; border-radius: 12px; background: white; }}
    .links {{ margin-bottom: 12px; color: #334155; }}
    .links a {{ color: #1d4ed8; text-decoration: none; }}
    table {{ width: 100%; border-collapse: collapse; background: white; margin-top: 24px; }}
    th, td {{ border: 1px solid #cbd5e1; padding: 10px 12px; text-align: left; }}
    th {{ background: #e2e8f0; }}
  </style>
</head>
<body>
  <h1>K-ERA benchmark paper figures</h1>
  <div class="meta">
    Job: {job_id}<br />
    Site: {site_id}<br />
    Created: {created_at}<br />
    Finished: {finished_at}
  </div>
  <div class="summary">
    Best test model by AUROC/balanced accuracy: <strong>{best_test['label']}</strong>
    (AUROC {best_test['auroc']:.3f}, Balanced Acc {best_test['balanced_accuracy']:.3f}, Test Acc {best_test['test_acc']:.3f})
  </div>
  <div class="figures">
    {figure_sections}
  </div>
  <table>
    <thead>
      <tr>
        <th>Model</th>
        <th>Family</th>
        <th>Best Val Acc</th>
        <th>Test Acc</th>
        <th>AUROC</th>
        <th>Balanced Acc</th>
        <th>Gap</th>
      </tr>
    </thead>
    <tbody>
      {rows}
    </tbody>
  </table>
</body>
</html>
"""
    html_path = output_dir / "paper_figures.html"
    html_path.write_text(html, encoding="utf-8")
    return html_path


def main() -> None:
    args = parse_args()
    job_id, row, payload = load_benchmark_payload(args.db, job_id=args.job_id, site_id=args.site_id)
    output_dir = args.out_dir or (DEFAULT_OUTPUT_ROOT / job_id)
    output_dir.mkdir(parents=True, exist_ok=True)

    results = normalize_results(payload)
    figure_1 = build_roc_figure(results, output_dir)
    figure_2 = build_gap_figure(results, output_dir)
    figure_3 = build_ranking_figure(results, output_dir)
    csv_path = write_summary_csv(results, output_dir)
    html_path = write_html_report(
        output_dir,
        job_id=job_id,
        site_id=str(row["site_id"]),
        created_at=str(row["created_at"]),
        finished_at=str(row["finished_at"]),
        results=results,
        figure_paths=[
            ("Figure 1. ROC curve", figure_1[0], figure_1[1]),
            ("Figure 2. Generalization gap", figure_2[0], figure_2[1]),
            ("Figure 3. Model ranking", figure_3[0], figure_3[1]),
        ],
    )

    print(f"Exported paper figures for {job_id}")
    print(f"Output directory: {output_dir.resolve()}")
    print(f"Figure 1 SVG: {figure_1[0].resolve()}")
    print(f"Figure 1 PNG: {figure_1[1].resolve()}")
    print(f"Figure 2 SVG: {figure_2[0].resolve()}")
    print(f"Figure 2 PNG: {figure_2[1].resolve()}")
    print(f"Figure 3 SVG: {figure_3[0].resolve()}")
    print(f"Figure 3 PNG: {figure_3[1].resolve()}")
    print(f"Summary CSV: {csv_path.resolve()}")
    print(f"HTML report: {html_path.resolve()}")


if __name__ == "__main__":
    main()
