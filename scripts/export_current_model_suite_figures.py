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
DEFAULT_SUITE_ROOT = REPO_ROOT / "artifacts" / "current_model_suite_20260330"
DEFAULT_OUTPUT_ROOT = REPO_ROOT / "artifacts" / "paper_figures" / "current_model_suite_20260330"

FAMILY_COLOR = {
    "CNN": "#2563eb",
    "Transformer": "#dc2626",
    "Paired": "#7c3aed",
    "MIL": "#16a34a",
    "Retrieval": "#0f766e",
    "Prerequisite": "#64748b",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export ROC, model-performance, and generalization-gap figures for the current model suite."
    )
    parser.add_argument("--suite-root", type=Path, default=DEFAULT_SUITE_ROOT)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUTPUT_ROOT)
    return parser.parse_args()


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


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


def metric_block(result: dict[str, Any], recomputed: dict[str, Any], key: str) -> dict[str, Any]:
    return (
        result.get(f"{key}_metrics_recomputed")
        or result.get(f"{key}_metrics")
        or recomputed.get(f"{key}_metrics_recomputed")
        or recomputed.get(f"{key}_metrics")
        or {}
    )


def normalize_results(suite_root: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    status = load_json(suite_root / "status.json")
    rows: list[dict[str, Any]] = []
    for path in sorted(suite_root.glob("*/result.json")):
        payload = load_json(path)
        component = payload.get("suite_component", {})
        result = payload.get("result", {})
        recomputed = payload.get("recomputed_metrics", {})
        val_metrics = metric_block(result, recomputed, "val")
        test_metrics = metric_block(result, recomputed, "test")
        if not test_metrics:
            continue
        family = str(component.get("family") or "Other")
        rows.append(
            {
                "name": str(component.get("name") or path.parent.name),
                "label": str(component.get("label") or path.parent.name),
                "family": family,
                "color": FAMILY_COLOR.get(family, "#334155"),
                "evaluation_unit": str(result.get("evaluation_unit", "image")),
                "test_auroc": float(test_metrics.get("AUROC") or 0.0),
                "test_bal_acc": float(test_metrics.get("balanced_accuracy") or 0.0),
                "test_accuracy": float(test_metrics.get("accuracy") or 0.0),
                "test_sensitivity": float(test_metrics.get("sensitivity") or 0.0),
                "test_specificity": float(test_metrics.get("specificity") or 0.0),
                "val_auroc": float(val_metrics.get("AUROC") or 0.0),
                "val_bal_acc": float(val_metrics.get("balanced_accuracy") or 0.0),
                "decision_threshold": float(result.get("decision_threshold") or 0.5),
                "roc_curve": test_metrics.get("roc_curve") or {},
                "result_path": str(path.resolve()),
            }
        )
    return status, rows


def build_model_performance_figure(results: list[dict[str, Any]], output_dir: Path, *, unit: str) -> tuple[Path, Path]:
    ordered = sorted(results, key=lambda item: (item["test_auroc"], item["test_bal_acc"]), reverse=True)
    x = np.arange(len(ordered))
    width = 0.36
    colors = [item["color"] for item in ordered]
    labels = [item["label"] for item in ordered]
    test_auroc = [item["test_auroc"] for item in ordered]
    test_bal_acc = [item["test_bal_acc"] for item in ordered]

    fig, ax = plt.subplots(figsize=(max(9.0, len(ordered) * 1.15), 5.8))
    bars_auroc = ax.bar(
        x - width / 2,
        test_auroc,
        width,
        color=colors,
        edgecolor="#0f172a",
        linewidth=0.5,
        label="Test AUROC",
    )
    bars_bal = ax.bar(
        x + width / 2,
        test_bal_acc,
        width,
        color=colors,
        edgecolor="#0f172a",
        linewidth=0.5,
        hatch="//",
        alpha=0.82,
        label="Test Balanced Acc",
    )
    for bars in (bars_auroc, bars_bal):
        for bar in bars:
            height = bar.get_height()
            ax.text(bar.get_x() + bar.get_width() / 2, height + 0.01, f"{height:.3f}", ha="center", va="bottom", fontsize=8)
    ax.axhline(0.5, color="#94a3b8", linestyle="--", linewidth=1.0)
    ax.set_xticks(x)
    ax.set_xticklabels(labels, rotation=20, ha="right")
    ax.set_ylim(0, 1.0)
    ax.set_ylabel("Score")
    ax.set_title(f"Model Performance ({unit.title()}-Level Test Set)", fontweight="bold")
    style_axes(ax)
    ax.legend(frameon=False, loc="upper right")
    fig.text(0.02, 0.01, f"Current suite comparison on the shared {unit}-level held-out split.", fontsize=9, color="#475569")
    return save_figure(fig, output_dir, "figure1_model_performance")


def build_generalization_gap_figure(results: list[dict[str, Any]], output_dir: Path, *, unit: str) -> tuple[Path, Path]:
    ordered = sorted(results, key=lambda item: (item["val_auroc"] - item["test_auroc"]), reverse=True)
    labels = [item["label"] for item in ordered]
    colors = [item["color"] for item in ordered]
    auroc_gap = [item["val_auroc"] - item["test_auroc"] for item in ordered]
    bal_gap = [item["val_bal_acc"] - item["test_bal_acc"] for item in ordered]
    x = np.arange(len(ordered))

    fig, axes = plt.subplots(1, 2, figsize=(max(12.0, len(ordered) * 1.2), 5.8))
    gap_specs = [
        ("Validation AUROC - Test AUROC", auroc_gap, "AUROC gap"),
        ("Validation Balanced Acc - Test Balanced Acc", bal_gap, "Balanced Acc gap"),
    ]
    for ax, (title, gaps, ylabel) in zip(axes, gap_specs, strict=False):
        ax.bar(x, gaps, color=colors, edgecolor="#0f172a", linewidth=0.5)
        ax.axhline(0, color="#0f172a", linewidth=0.8)
        for index, gap in enumerate(gaps):
            ax.text(index, gap + (0.01 if gap >= 0 else -0.015), f"{gap:+.3f}", ha="center", va="bottom" if gap >= 0 else "top", fontsize=8)
        ax.set_xticks(x)
        ax.set_xticklabels(labels, rotation=20, ha="right")
        ax.set_ylabel(ylabel)
        ax.set_title(title, fontweight="bold")
        style_axes(ax)
    fig.suptitle(f"Generalization Gap ({unit.title()}-Level)", fontweight="bold", y=1.02)
    fig.text(0.02, 0.01, "Positive values indicate validation performance exceeded held-out test performance.", fontsize=9, color="#475569")
    fig.tight_layout()
    return save_figure(fig, output_dir, "figure2_generalization_gap")


def build_roc_figure(results: list[dict[str, Any]], output_dir: Path, *, unit: str) -> tuple[Path, Path]:
    ordered = sorted(results, key=lambda item: item["test_auroc"], reverse=True)
    fig, ax = plt.subplots(figsize=(8.2, 6.8))
    ax.plot([0, 1], [0, 1], linestyle="--", color="#94a3b8", linewidth=1.0, label="Chance")
    for item in ordered:
        roc_curve = item["roc_curve"] or {}
        fpr = roc_curve.get("fpr") or []
        tpr = roc_curve.get("tpr") or []
        if not fpr or not tpr:
            continue
        linestyle = "--" if item["family"] == "Retrieval" else "-"
        ax.plot(
            fpr,
            tpr,
            linewidth=2.2,
            linestyle=linestyle,
            color=item["color"],
            label=f"{item['label']} (AUC={item['test_auroc']:.3f})",
        )
    ax.set_xlim(-0.02, 1.02)
    ax.set_ylim(-0.02, 1.02)
    ax.set_xlabel("False Positive Rate")
    ax.set_ylabel("True Positive Rate")
    ax.set_title(f"Integrated ROC Curves ({unit.title()}-Level Test Set)", fontweight="bold")
    style_axes(ax)
    ax.legend(loc="lower right", frameon=False)
    fig.text(0.02, 0.01, "Dashed lines indicate retrieval baselines when present.", fontsize=9, color="#475569")
    return save_figure(fig, output_dir, "figure3_integrated_roc_curve")


def write_summary_csv(results: list[dict[str, Any]], output_dir: Path) -> Path:
    csv_path = output_dir / "summary.csv"
    fieldnames = [
        "name",
        "label",
        "family",
        "evaluation_unit",
        "val_auroc",
        "test_auroc",
        "auroc_gap",
        "val_bal_acc",
        "test_bal_acc",
        "bal_acc_gap",
        "test_accuracy",
        "test_sensitivity",
        "test_specificity",
        "decision_threshold",
        "result_path",
    ]
    ordered = sorted(results, key=lambda item: item["test_auroc"], reverse=True)
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for item in ordered:
            writer.writerow(
                {
                    "name": item["name"],
                    "label": item["label"],
                    "family": item["family"],
                    "evaluation_unit": item["evaluation_unit"],
                    "val_auroc": f"{item['val_auroc']:.6f}",
                    "test_auroc": f"{item['test_auroc']:.6f}",
                    "auroc_gap": f"{item['val_auroc'] - item['test_auroc']:+.6f}",
                    "val_bal_acc": f"{item['val_bal_acc']:.6f}",
                    "test_bal_acc": f"{item['test_bal_acc']:.6f}",
                    "bal_acc_gap": f"{item['val_bal_acc'] - item['test_bal_acc']:+.6f}",
                    "test_accuracy": f"{item['test_accuracy']:.6f}",
                    "test_sensitivity": f"{item['test_sensitivity']:.6f}",
                    "test_specificity": f"{item['test_specificity']:.6f}",
                    "decision_threshold": f"{item['decision_threshold']:.6f}",
                    "result_path": item["result_path"],
                }
            )
    return csv_path


def write_html_report(
    output_dir: Path,
    *,
    unit: str,
    status: dict[str, Any],
    results: list[dict[str, Any]],
    figure_paths: list[tuple[str, Path, Path]],
) -> Path:
    ordered = sorted(results, key=lambda item: item["test_auroc"], reverse=True)
    rows = "\n".join(
        f"<tr><td>{item['label']}</td><td>{item['family']}</td><td>{item['test_auroc']:.3f}</td><td>{item['test_bal_acc']:.3f}</td><td>{item['test_sensitivity']:.3f}</td><td>{item['test_specificity']:.3f}</td><td>{item['val_auroc'] - item['test_auroc']:+.3f}</td></tr>"
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
  <title>Current Model Suite Figures ({unit})</title>
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
  <h1>Current Model Suite Figures ({unit.title()}-Level)</h1>
  <p class="meta">Suite status: {status.get("overall_status")} · dataset {status.get("dataset_summary", {}).get("n_patients")} patients / {status.get("dataset_summary", {}).get("n_visits")} visits / {status.get("dataset_summary", {}).get("n_images")} images.</p>
  <div class="figures">
    {figure_sections}
  </div>
  <h2>Summary Table</h2>
  <table>
    <thead>
      <tr>
        <th>Method</th>
        <th>Family</th>
        <th>Test AUROC</th>
        <th>Test Balanced Acc</th>
        <th>Test Sensitivity</th>
        <th>Test Specificity</th>
        <th>Val-Test AUROC Gap</th>
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


def export_unit_figures(status: dict[str, Any], results: list[dict[str, Any]], output_dir: Path, *, unit: str) -> list[str]:
    output_dir.mkdir(parents=True, exist_ok=True)
    figure_1 = build_model_performance_figure(results, output_dir, unit=unit)
    figure_2 = build_generalization_gap_figure(results, output_dir, unit=unit)
    figure_3 = build_roc_figure(results, output_dir, unit=unit)
    summary_csv = write_summary_csv(results, output_dir)
    html_path = write_html_report(
        output_dir,
        unit=unit,
        status=status,
        results=results,
        figure_paths=[
            ("Figure 1. Model performance", figure_1[0], figure_1[1]),
            ("Figure 2. Generalization gap", figure_2[0], figure_2[1]),
            ("Figure 3. Integrated ROC curve", figure_3[0], figure_3[1]),
        ],
    )
    return [
        f"Figure 1 PNG: {figure_1[0].resolve()}",
        f"Figure 2 PNG: {figure_2[0].resolve()}",
        f"Figure 3 PNG: {figure_3[0].resolve()}",
        f"Summary CSV: {summary_csv.resolve()}",
        f"HTML report: {html_path.resolve()}",
    ]


def main() -> int:
    args = parse_args()
    suite_root = args.suite_root.expanduser().resolve()
    output_root = args.out_dir.expanduser().resolve()
    status, results = normalize_results(suite_root)
    grouped: dict[str, list[dict[str, Any]]] = {}
    for item in results:
        grouped.setdefault(item["evaluation_unit"], []).append(item)
    if not grouped:
        raise RuntimeError(f"No result.json files with test metrics found under {suite_root}")

    lines: list[str] = []
    for unit, unit_results in sorted(grouped.items()):
        lines.append(f"[{unit}]")
        lines.extend(export_unit_figures(status, unit_results, output_root / f"{unit}_level", unit=unit))
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
