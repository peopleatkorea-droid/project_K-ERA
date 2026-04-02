from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MAIN_FIGURE_ROOT = REPO_ROOT / "artifacts" / "paper_figures" / "current_model_suite_cv_20260330_p73_5fold"
DEFAULT_ABLATION_FIGURE_ROOT = REPO_ROOT / "artifacts" / "paper_figures" / "official_retrieval_crop_ablation_cv_20260331"
DEFAULT_QUEUE_STATUS = REPO_ROOT / "artifacts" / "current_model_suite_cv_20260330_p73_5fold" / "queue_status.json"
DEFAULT_OUT_DIR = REPO_ROOT / "artifacts" / "paper_figures" / "visit_vs_image_level_cv_20260331"

IMAGE_COLOR = "#2563eb"
VISIT_COLOR = "#15803d"
VISIT_ALT_COLOR = "#0f766e"

VISIT_NAME_ORDER = [
    "official_dinov2_retrieval_lesion_crop",
    "official_dinov2_retrieval_full",
    "official_dinov2_mil",
    "official_dinov2_retrieval_cornea_lesion_fusion",
    "official_dinov2_retrieval",
    "swin_mil",
]

MARKERS = {
    "image": "o",
    "visit": "s",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export visit-level vs image-level comparison figures from existing CV summaries."
    )
    parser.add_argument("--main-figure-root", type=Path, default=DEFAULT_MAIN_FIGURE_ROOT)
    parser.add_argument("--ablation-figure-root", type=Path, default=DEFAULT_ABLATION_FIGURE_ROOT)
    parser.add_argument("--queue-status", type=Path, default=DEFAULT_QUEUE_STATUS)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    return parser.parse_args()


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def read_csv_rows(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def save_figure(fig: plt.Figure, output_dir: Path, stem: str) -> tuple[Path, Path]:
    svg_path = output_dir / f"{stem}.svg"
    png_path = output_dir / f"{stem}.png"
    fig.savefig(svg_path, bbox_inches="tight")
    fig.savefig(png_path, dpi=220, bbox_inches="tight")
    plt.close(fig)
    return png_path, svg_path


def style_axes(ax: plt.Axes, *, grid_axis: str = "y") -> None:
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(axis=grid_axis, alpha=0.25, linestyle="--", linewidth=0.8)


def to_float(row: dict[str, str], key: str) -> float:
    return float(row[key])


def normalize_row(row: dict[str, str], *, unit: str) -> dict[str, Any]:
    return {
        "name": row["name"],
        "label": row["label"],
        "family": row["family"],
        "unit": unit,
        "completed_folds": int(row["completed_folds"]),
        "val_auroc_mean": to_float(row, "val_auroc_mean"),
        "val_auroc_std": to_float(row, "val_auroc_std"),
        "test_auroc_mean": to_float(row, "test_auroc_mean"),
        "test_auroc_std": to_float(row, "test_auroc_std"),
        "auroc_gap_mean": to_float(row, "auroc_gap_mean"),
        "auroc_gap_std": to_float(row, "auroc_gap_std"),
        "val_bal_acc_mean": to_float(row, "val_bal_acc_mean"),
        "val_bal_acc_std": to_float(row, "val_bal_acc_std"),
        "test_bal_acc_mean": to_float(row, "test_bal_acc_mean"),
        "test_bal_acc_std": to_float(row, "test_bal_acc_std"),
        "bal_acc_gap_mean": to_float(row, "bal_acc_gap_mean"),
        "bal_acc_gap_std": to_float(row, "bal_acc_gap_std"),
        "test_accuracy_mean": to_float(row, "test_accuracy_mean"),
        "test_sensitivity_mean": to_float(row, "test_sensitivity_mean"),
        "test_specificity_mean": to_float(row, "test_specificity_mean"),
        "decision_threshold_mean": to_float(row, "decision_threshold_mean"),
        "fold_result_paths": row["fold_result_paths"],
    }


def build_rows(main_figure_root: Path, ablation_figure_root: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    image_summary_path = main_figure_root / "image_level" / "summary.csv"
    main_visit_summary_path = main_figure_root / "visit_level" / "summary.csv"
    ablation_visit_summary_path = ablation_figure_root / "visit_level" / "summary.csv"

    image_rows = [normalize_row(row, unit="image") for row in read_csv_rows(image_summary_path)]
    main_visit_by_name = {row["name"]: normalize_row(row, unit="visit") for row in read_csv_rows(main_visit_summary_path)}
    ablation_visit_by_name = {row["name"]: normalize_row(row, unit="visit") for row in read_csv_rows(ablation_visit_summary_path)}

    visit_rows: list[dict[str, Any]] = []
    for name in VISIT_NAME_ORDER:
        if name in ablation_visit_by_name:
            visit_rows.append(ablation_visit_by_name[name])
        elif name in main_visit_by_name:
            visit_rows.append(main_visit_by_name[name])
    return image_rows, visit_rows


def build_comparison_figure(
    image_rows: list[dict[str, Any]],
    visit_rows: list[dict[str, Any]],
    output_dir: Path,
) -> tuple[Path, Path]:
    ordered_image = sorted(image_rows, key=lambda item: item["test_auroc_mean"], reverse=True)
    ordered_visit = sorted(visit_rows, key=lambda item: item["test_auroc_mean"], reverse=True)

    fig = plt.figure(figsize=(18.5, 12.0))
    gs = fig.add_gridspec(2, 2, height_ratios=[1.05, 1.2], hspace=0.28, wspace=0.22)

    ax_scatter = fig.add_subplot(gs[0, :])
    for unit_rows, color, unit_label in [
        (ordered_image, IMAGE_COLOR, "Image-level"),
        (ordered_visit, VISIT_COLOR, "Visit-level"),
    ]:
        x = [item["test_auroc_mean"] for item in unit_rows]
        y = [item["test_bal_acc_mean"] for item in unit_rows]
        ax_scatter.scatter(
            x,
            y,
            s=120,
            c=color,
            marker=MARKERS["image" if unit_label == "Image-level" else "visit"],
            edgecolors="#0f172a",
            linewidths=0.7,
            alpha=0.9,
            label=unit_label,
        )
        for item in unit_rows:
            ax_scatter.annotate(
                item["label"],
                (item["test_auroc_mean"], item["test_bal_acc_mean"]),
                xytext=(6, 4),
                textcoords="offset points",
                fontsize=8,
                color="#0f172a",
            )
    ax_scatter.axvline(0.5, color="#94a3b8", linestyle="--", linewidth=1.0)
    ax_scatter.axhline(0.5, color="#94a3b8", linestyle="--", linewidth=1.0)
    ax_scatter.set_xlim(0.52, 0.70)
    ax_scatter.set_ylim(0.50, 0.64)
    ax_scatter.set_xlabel("CV Test AUROC")
    ax_scatter.set_ylabel("CV Test Balanced Accuracy")
    ax_scatter.set_title("Metric Space Comparison Across Evaluation Units", fontweight="bold")
    style_axes(ax_scatter, grid_axis="both")
    ax_scatter.legend(frameon=False, loc="lower right")

    bar_specs = [
        (fig.add_subplot(gs[1, 0]), ordered_image, IMAGE_COLOR, "Image-Level Models"),
        (fig.add_subplot(gs[1, 1]), ordered_visit, VISIT_COLOR, "Visit-Level Models"),
    ]
    for ax, rows, color, title in bar_specs:
        y = np.arange(len(rows))
        auroc = [item["test_auroc_mean"] for item in rows]
        bal = [item["test_bal_acc_mean"] for item in rows]
        auroc_err = [item["test_auroc_std"] for item in rows]
        bal_err = [item["test_bal_acc_std"] for item in rows]
        ax.barh(
            y - 0.18,
            auroc,
            height=0.34,
            color=color,
            edgecolor="#0f172a",
            linewidth=0.6,
            xerr=auroc_err,
            capsize=3,
            label="Test AUROC mean±std",
        )
        ax.barh(
            y + 0.18,
            bal,
            height=0.34,
            color=color,
            edgecolor="#0f172a",
            linewidth=0.6,
            hatch="//",
            alpha=0.82,
            xerr=bal_err,
            capsize=3,
            label="Test Balanced Acc mean±std",
        )
        for index, value in enumerate(auroc):
            ax.text(value + 0.004, index - 0.18, f"{value:.3f}", va="center", fontsize=8)
        for index, value in enumerate(bal):
            ax.text(value + 0.004, index + 0.18, f"{value:.3f}", va="center", fontsize=8)
        ax.axvline(0.5, color="#94a3b8", linestyle="--", linewidth=1.0)
        ax.set_yticks(y)
        ax.set_yticklabels([item["label"] for item in rows])
        ax.invert_yaxis()
        ax.set_xlim(0.48, 0.75 if title == "Image-Level Models" else 0.72)
        ax.set_xlabel("Score")
        ax.set_title(title, fontweight="bold")
        style_axes(ax, grid_axis="x")
        ax.legend(frameon=False, loc="lower right")

    fig.suptitle("Visit-Level vs Image-Level CV Comparison", fontweight="bold", fontsize=16, y=0.98)
    fig.text(
        0.02,
        0.01,
        "Metrics share the same scale, but the underlying evaluation units differ. Compare within panel first, then across panels.",
        fontsize=9,
        color="#475569",
    )
    return save_figure(fig, output_dir, "figure1_visit_vs_image_level_comparison")


def build_gap_figure(
    image_rows: list[dict[str, Any]],
    visit_rows: list[dict[str, Any]],
    output_dir: Path,
) -> tuple[Path, Path]:
    fig, axes = plt.subplots(2, 2, figsize=(18.5, 11.5))
    fig.subplots_adjust(hspace=0.34, wspace=0.22)
    panels = [
        (axes[0, 0], sorted(image_rows, key=lambda item: item["auroc_gap_mean"], reverse=True), IMAGE_COLOR, "Image-Level AUROC Gap", "auroc_gap_mean", "AUROC gap"),
        (axes[0, 1], sorted(visit_rows, key=lambda item: item["auroc_gap_mean"], reverse=True), VISIT_COLOR, "Visit-Level AUROC Gap", "auroc_gap_mean", "AUROC gap"),
        (axes[1, 0], sorted(image_rows, key=lambda item: item["bal_acc_gap_mean"], reverse=True), IMAGE_COLOR, "Image-Level Balanced Accuracy Gap", "bal_acc_gap_mean", "Balanced Acc gap"),
        (axes[1, 1], sorted(visit_rows, key=lambda item: item["bal_acc_gap_mean"], reverse=True), VISIT_COLOR, "Visit-Level Balanced Accuracy Gap", "bal_acc_gap_mean", "Balanced Acc gap"),
    ]
    for ax, rows, color, title, key, xlabel in panels:
        y = np.arange(len(rows))
        values = [item[key] for item in rows]
        errs = [item["auroc_gap_std"] if key == "auroc_gap_mean" else item["bal_acc_gap_std"] for item in rows]
        ax.barh(y, values, color=color, edgecolor="#0f172a", linewidth=0.6, xerr=errs, capsize=3, alpha=0.88)
        ax.axvline(0, color="#0f172a", linewidth=0.8)
        for index, value in enumerate(values):
            ax.text(value + (0.004 if value >= 0 else -0.004), index, f"{value:+.3f}", va="center", ha="left" if value >= 0 else "right", fontsize=8)
        ax.set_yticks(y)
        ax.set_yticklabels([item["label"] for item in rows])
        ax.invert_yaxis()
        ax.set_xlabel(xlabel)
        ax.set_title(title, fontweight="bold")
        style_axes(ax, grid_axis="x")
    fig.suptitle("Visit-Level vs Image-Level Generalization Gap", fontweight="bold", fontsize=16, y=0.98)
    fig.text(0.02, 0.01, "Positive values indicate validation performance exceeded held-out fold test performance.", fontsize=9, color="#475569")
    return save_figure(fig, output_dir, "figure2_visit_vs_image_level_generalization_gap")


def write_summary_csv(image_rows: list[dict[str, Any]], visit_rows: list[dict[str, Any]], output_dir: Path) -> Path:
    csv_path = output_dir / "summary.csv"
    fieldnames = [
        "unit",
        "name",
        "label",
        "family",
        "completed_folds",
        "test_auroc_mean",
        "test_auroc_std",
        "test_bal_acc_mean",
        "test_bal_acc_std",
        "test_accuracy_mean",
        "test_sensitivity_mean",
        "test_specificity_mean",
        "auroc_gap_mean",
        "auroc_gap_std",
        "bal_acc_gap_mean",
        "bal_acc_gap_std",
        "decision_threshold_mean",
        "fold_result_paths",
    ]
    ordered = sorted(image_rows + visit_rows, key=lambda item: (item["unit"], -item["test_auroc_mean"]))
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for item in ordered:
            writer.writerow(
                {
                    "unit": item["unit"],
                    "name": item["name"],
                    "label": item["label"],
                    "family": item["family"],
                    "completed_folds": item["completed_folds"],
                    "test_auroc_mean": f"{item['test_auroc_mean']:.6f}",
                    "test_auroc_std": f"{item['test_auroc_std']:.6f}",
                    "test_bal_acc_mean": f"{item['test_bal_acc_mean']:.6f}",
                    "test_bal_acc_std": f"{item['test_bal_acc_std']:.6f}",
                    "test_accuracy_mean": f"{item['test_accuracy_mean']:.6f}",
                    "test_sensitivity_mean": f"{item['test_sensitivity_mean']:.6f}",
                    "test_specificity_mean": f"{item['test_specificity_mean']:.6f}",
                    "auroc_gap_mean": f"{item['auroc_gap_mean']:+.6f}",
                    "auroc_gap_std": f"{item['auroc_gap_std']:.6f}",
                    "bal_acc_gap_mean": f"{item['bal_acc_gap_mean']:+.6f}",
                    "bal_acc_gap_std": f"{item['bal_acc_gap_std']:.6f}",
                    "decision_threshold_mean": f"{item['decision_threshold_mean']:.6f}",
                    "fold_result_paths": item["fold_result_paths"],
                }
            )
    return csv_path


def write_html_report(
    output_dir: Path,
    *,
    dataset_summary: dict[str, Any],
    image_rows: list[dict[str, Any]],
    visit_rows: list[dict[str, Any]],
    figure_paths: list[tuple[str, Path, Path]],
) -> Path:
    ordered = sorted(image_rows + visit_rows, key=lambda item: (item["unit"], -item["test_auroc_mean"]))
    rows = "\n".join(
        f"<tr><td>{item['unit']}</td><td>{item['label']}</td><td>{item['family']}</td><td>{item['completed_folds']}</td><td>{item['test_auroc_mean']:.3f} ± {item['test_auroc_std']:.3f}</td><td>{item['test_bal_acc_mean']:.3f} ± {item['test_bal_acc_std']:.3f}</td><td>{item['test_sensitivity_mean']:.3f}</td><td>{item['test_specificity_mean']:.3f}</td><td>{item['auroc_gap_mean']:+.3f}</td><td>{item['bal_acc_gap_mean']:+.3f}</td></tr>"
        for item in ordered
    )
    figure_sections = "\n".join(
        f"""
        <section class="figure-card">
          <h2>{title}</h2>
          <div class="links"><a href="{png_path.name}">PNG</a> · <a href="{svg_path.name}">SVG</a></div>
          <img src="{png_path.name}" alt="{title}" />
        </section>
        """
        for title, png_path, svg_path in figure_paths
    )
    html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Visit vs Image Level Comparison</title>
  <style>
    body {{ font-family: Arial, sans-serif; margin: 24px; background: #f8fafc; color: #0f172a; }}
    h1, h2 {{ margin: 0 0 12px 0; }}
    .meta {{ margin-bottom: 20px; color: #475569; }}
    .figures {{ display: grid; gap: 20px; }}
    .figure-card {{ background: white; border: 1px solid #cbd5e1; border-radius: 16px; padding: 18px; }}
    .figure-card img {{ width: 100%; height: auto; border: 1px solid #e2e8f0; border-radius: 12px; background: white; }}
    .links {{ margin-bottom: 12px; }}
    table {{ width: 100%; border-collapse: collapse; margin-top: 18px; background: white; }}
    th, td {{ border: 1px solid #cbd5e1; padding: 10px; text-align: center; }}
    th {{ background: #e2e8f0; }}
  </style>
</head>
<body>
  <h1>Visit-Level vs Image-Level CV Comparison</h1>
  <p class="meta">Dataset summary: {dataset_summary.get('n_patients')} patients / {dataset_summary.get('n_visits')} visits / {dataset_summary.get('n_images')} images.</p>
  <div class="figures">
    {figure_sections}
  </div>
  <h2>Summary Table</h2>
  <table>
    <thead>
      <tr>
        <th>Unit</th>
        <th>Method</th>
        <th>Family</th>
        <th>Completed folds</th>
        <th>CV Test AUROC</th>
        <th>CV Test Balanced Acc</th>
        <th>CV Test Sensitivity</th>
        <th>CV Test Specificity</th>
        <th>Mean AUROC Gap</th>
        <th>Mean Bal Acc Gap</th>
      </tr>
    </thead>
    <tbody>
      {rows}
    </tbody>
  </table>
</body>
</html>
"""
    html_path = output_dir / "figures.html"
    html_path.write_text(html, encoding="utf-8")
    return html_path


def main() -> int:
    args = parse_args()
    output_dir = args.out_dir.expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    dataset_summary = load_json(args.queue_status.expanduser().resolve()).get("dataset_summary") or {}
    image_rows, visit_rows = build_rows(
        args.main_figure_root.expanduser().resolve(),
        args.ablation_figure_root.expanduser().resolve(),
    )
    if not image_rows or not visit_rows:
        raise RuntimeError("Missing image-level or visit-level summary rows for comparison export.")

    figure_1 = build_comparison_figure(image_rows, visit_rows, output_dir)
    figure_2 = build_gap_figure(image_rows, visit_rows, output_dir)
    summary_csv = write_summary_csv(image_rows, visit_rows, output_dir)
    html_path = write_html_report(
        output_dir,
        dataset_summary=dataset_summary,
        image_rows=image_rows,
        visit_rows=visit_rows,
        figure_paths=[
            ("Figure 1. Visit-level vs image-level comparison", figure_1[0], figure_1[1]),
            ("Figure 2. Visit-level vs image-level generalization gap", figure_2[0], figure_2[1]),
        ],
    )
    print(
        "\n".join(
            [
                f"Figure 1 PNG: {figure_1[0].resolve()}",
                f"Figure 2 PNG: {figure_2[0].resolve()}",
                f"Summary CSV: {summary_csv.resolve()}",
                f"HTML report: {html_path.resolve()}",
            ]
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
