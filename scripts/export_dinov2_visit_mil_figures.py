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
DEFAULT_RETRIEVAL_ROOT = REPO_ROOT / "artifacts" / "dinov2_visit_retrieval_matrix_20260330"
DEFAULT_MIL_ROOT = REPO_ROOT / "artifacts" / "dinov2_mil_matrix_20260330"
DEFAULT_OUTPUT_ROOT = REPO_ROOT / "artifacts" / "paper_figures" / "dinov2_visit_mil_matrix_20260330"

RESULT_SPECS = [
    {
        "name": "official_retrieval",
        "label": "Official DINOv2 Retrieval",
        "family": "Retrieval",
        "color": "#2563eb",
        "path_kind": "retrieval",
        "result_path": "visit_retrieval_official_cornea_roi/result.json",
    },
    {
        "name": "ssl_retrieval",
        "label": "SSL DINOv2 Retrieval",
        "family": "Retrieval",
        "color": "#f97316",
        "path_kind": "retrieval",
        "result_path": "visit_retrieval_ssl_cornea_roi/result.json",
    },
    {
        "name": "official_mil",
        "label": "Official DINOv2 MIL",
        "family": "MIL",
        "color": "#16a34a",
        "path_kind": "mil",
        "result_path": "h7_mil_official_valauroc/result.json",
    },
    {
        "name": "ssl_mil",
        "label": "SSL DINOv2 MIL",
        "family": "MIL",
        "color": "#dc2626",
        "path_kind": "mil",
        "result_path": "h7_mil_ssl_valauroc/result.json",
    },
    {
        "name": "h5backbone_mil",
        "label": "H5-Backbone DINOv2 MIL",
        "family": "MIL",
        "color": "#7c3aed",
        "path_kind": "mil",
        "result_path": "h7_mil_h5backbone_valauroc/result.json",
    },
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export ROC, model-performance, and generalization-gap figures for the DINOv2 visit-level retrieval/MIL matrix.")
    parser.add_argument("--retrieval-root", type=Path, default=DEFAULT_RETRIEVAL_ROOT)
    parser.add_argument("--mil-root", type=Path, default=DEFAULT_MIL_ROOT)
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


def style_axes(ax: plt.Axes) -> None:
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(axis="y", alpha=0.25, linestyle="--", linewidth=0.8)


def normalize_results(retrieval_root: Path, mil_root: Path) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for spec in RESULT_SPECS:
        base_root = retrieval_root if spec["path_kind"] == "retrieval" else mil_root
        payload = load_json(base_root / spec["result_path"])
        result = payload["result"]
        test_metrics = result["test_metrics"]
        val_metrics = result["val_metrics"]
        normalized.append(
            {
                "name": spec["name"],
                "label": spec["label"],
                "family": spec["family"],
                "color": spec["color"],
                "evaluation_unit": result.get("evaluation_unit", "visit"),
                "n_test_cases": int(result.get("n_test_cases") or 0),
                "test_auroc": float(test_metrics.get("AUROC") or 0.0),
                "test_bal_acc": float(test_metrics.get("balanced_accuracy") or 0.0),
                "test_sensitivity": float(test_metrics.get("sensitivity") or 0.0),
                "test_specificity": float(test_metrics.get("specificity") or 0.0),
                "test_accuracy": float(test_metrics.get("accuracy") or 0.0),
                "val_auroc": float(val_metrics.get("AUROC") or 0.0),
                "val_bal_acc": float(val_metrics.get("balanced_accuracy") or 0.0),
                "decision_threshold": float(result.get("decision_threshold") or 0.5),
                "roc_curve": test_metrics.get("roc_curve") or {},
                "result_path": str((base_root / spec["result_path"]).resolve()),
            }
        )
    return normalized


def build_model_performance_figure(results: list[dict[str, Any]], output_dir: Path) -> tuple[Path, Path]:
    x = np.arange(len(results))
    width = 0.36
    colors = [item["color"] for item in results]
    labels = [item["label"] for item in results]
    test_auroc = [item["test_auroc"] for item in results]
    test_bal_acc = [item["test_bal_acc"] for item in results]

    fig, ax = plt.subplots(figsize=(12.8, 5.8))
    bars_auroc = ax.bar(x - width / 2, test_auroc, width, color=colors, edgecolor="#0f172a", linewidth=0.5, label="Test AUROC")
    bars_bal = ax.bar(x + width / 2, test_bal_acc, width, color=colors, edgecolor="#0f172a", linewidth=0.5, hatch="//", alpha=0.8, label="Test Balanced Acc")
    for bars in (bars_auroc, bars_bal):
        for bar in bars:
            height = bar.get_height()
            ax.text(bar.get_x() + bar.get_width() / 2, height + 0.01, f"{height:.3f}", ha="center", va="bottom", fontsize=8)
    ax.axhline(0.5, color="#94a3b8", linestyle="--", linewidth=1.0)
    ax.set_xticks(x)
    ax.set_xticklabels(labels, rotation=22, ha="right")
    ax.set_ylim(0, 1.0)
    ax.set_ylabel("Score")
    ax.set_title("Figure 1. DINOv2 Visit-Level Model Performance", fontweight="bold")
    style_axes(ax)
    ax.legend(frameon=False, loc="upper right")
    fig.text(0.02, 0.01, "Same fixed patient split, visit-level evaluation, n_test_cases=29 for all methods.", fontsize=9, color="#475569")
    return save_figure(fig, output_dir, "figure1_model_performance")


def build_generalization_gap_figure(results: list[dict[str, Any]], output_dir: Path) -> tuple[Path, Path]:
    labels = [item["label"] for item in results]
    colors = [item["color"] for item in results]
    auroc_gap = [item["val_auroc"] - item["test_auroc"] for item in results]
    bal_gap = [item["val_bal_acc"] - item["test_bal_acc"] for item in results]
    x = np.arange(len(results))

    fig, axes = plt.subplots(1, 2, figsize=(14.0, 5.8), gridspec_kw={"width_ratios": [1, 1]})
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
        ax.set_xticklabels(labels, rotation=22, ha="right")
        ax.set_ylabel(ylabel)
        ax.set_title(title, fontweight="bold")
        style_axes(ax)
    fig.suptitle("Figure 2. Validation-to-Test Generalization Gap", fontweight="bold", y=1.02)
    fig.text(0.02, 0.01, "Positive values indicate better validation than held-out test performance.", fontsize=9, color="#475569")
    fig.tight_layout()
    return save_figure(fig, output_dir, "figure2_generalization_gap")


def build_roc_figure(results: list[dict[str, Any]], output_dir: Path) -> tuple[Path, Path]:
    fig, ax = plt.subplots(figsize=(8.2, 6.8))
    ax.plot([0, 1], [0, 1], linestyle="--", color="#94a3b8", linewidth=1.0, label="Chance")
    for item in results:
        roc_curve = item["roc_curve"] or {}
        fpr = roc_curve.get("fpr") or []
        tpr = roc_curve.get("tpr") or []
        if not fpr or not tpr:
            continue
        linestyle = "--" if item["family"] == "Retrieval" else "-"
        ax.plot(
            fpr,
            tpr,
            linewidth=2.5,
            linestyle=linestyle,
            color=item["color"],
            label=f"{item['label']} (AUC={item['test_auroc']:.3f})",
        )
    ax.set_xlim(-0.02, 1.02)
    ax.set_ylim(-0.02, 1.02)
    ax.set_xlabel("False Positive Rate")
    ax.set_ylabel("True Positive Rate")
    ax.set_title("Figure 3. Integrated ROC Curves (Visit-Level Test Set)", fontweight="bold")
    style_axes(ax)
    ax.legend(loc="lower right", frameon=False)
    fig.text(0.02, 0.01, "Solid lines: MIL classifiers. Dashed lines: k-NN retrieval baselines.", fontsize=9, color="#475569")
    return save_figure(fig, output_dir, "figure3_integrated_roc_curve")


def write_summary_csv(results: list[dict[str, Any]], output_dir: Path) -> Path:
    csv_path = output_dir / "dinov2_visit_mil_summary.csv"
    fieldnames = [
        "name",
        "label",
        "family",
        "evaluation_unit",
        "n_test_cases",
        "val_auroc",
        "test_auroc",
        "auroc_gap",
        "val_bal_acc",
        "test_bal_acc",
        "bal_acc_gap",
        "test_sensitivity",
        "test_specificity",
        "decision_threshold",
        "result_path",
    ]
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for item in results:
            writer.writerow(
                {
                    "name": item["name"],
                    "label": item["label"],
                    "family": item["family"],
                    "evaluation_unit": item["evaluation_unit"],
                    "n_test_cases": item["n_test_cases"],
                    "val_auroc": f"{item['val_auroc']:.6f}",
                    "test_auroc": f"{item['test_auroc']:.6f}",
                    "auroc_gap": f"{item['val_auroc'] - item['test_auroc']:+.6f}",
                    "val_bal_acc": f"{item['val_bal_acc']:.6f}",
                    "test_bal_acc": f"{item['test_bal_acc']:.6f}",
                    "bal_acc_gap": f"{item['val_bal_acc'] - item['test_bal_acc']:+.6f}",
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
    results: list[dict[str, Any]],
    figure_paths: list[tuple[str, Path, Path]],
) -> Path:
    rows = "\n".join(
        f"<tr><td>{item['label']}</td><td>{item['family']}</td><td>{item['test_auroc']:.3f}</td><td>{item['test_bal_acc']:.3f}</td><td>{item['test_sensitivity']:.3f}</td><td>{item['test_specificity']:.3f}</td><td>{item['val_auroc'] - item['test_auroc']:+.3f}</td></tr>"
        for item in sorted(results, key=lambda item: item["test_auroc"], reverse=True)
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
  <title>DINOv2 Visit/MIL Figures</title>
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
  <h1>DINOv2 Visit-Level Retrieval and MIL Figures</h1>
  <p class="meta">Comparison set: official retrieval, SSL retrieval, official MIL, SSL MIL, and h5-backbone MIL on the same fixed visit-level test split.</p>
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
    html_path = output_dir / "dinov2_visit_mil_figures.html"
    html_path.write_text(html, encoding="utf-8")
    return html_path


def main() -> int:
    args = parse_args()
    output_dir = args.out_dir.expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    results = normalize_results(
        args.retrieval_root.expanduser().resolve(),
        args.mil_root.expanduser().resolve(),
    )
    figure_1 = build_model_performance_figure(results, output_dir)
    figure_2 = build_generalization_gap_figure(results, output_dir)
    figure_3 = build_roc_figure(results, output_dir)
    summary_csv = write_summary_csv(results, output_dir)
    html_path = write_html_report(
        output_dir,
        results=results,
        figure_paths=[
            ("Figure 1. Model performance", figure_1[0], figure_1[1]),
            ("Figure 2. Generalization gap", figure_2[0], figure_2[1]),
            ("Figure 3. Integrated ROC curve", figure_3[0], figure_3[1]),
        ],
    )
    print(f"Figure 1 PNG: {figure_1[0].resolve()}")
    print(f"Figure 2 PNG: {figure_2[0].resolve()}")
    print(f"Figure 3 PNG: {figure_3[0].resolve()}")
    print(f"Summary CSV: {summary_csv.resolve()}")
    print(f"HTML report: {html_path.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
