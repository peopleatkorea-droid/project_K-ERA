from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from sklearn.metrics import roc_curve


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SUITE_ROOT = REPO_ROOT / "artifacts" / "current_model_suite_cv_20260330_p73_5fold"

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
        description="Export ROC, CV performance, and CV generalization-gap figures for the current model suite."
    )
    parser.add_argument("--suite-root", type=Path, default=DEFAULT_SUITE_ROOT)
    parser.add_argument("--out-dir", type=Path, default=None)
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


def mean_std(values: list[float | None]) -> tuple[float | None, float | None]:
    filtered = [float(value) for value in values if value is not None]
    if not filtered:
        return None, None
    array = np.asarray(filtered, dtype=np.float64)
    return float(array.mean()), float(array.std())


def default_output_root(suite_root: Path) -> Path:
    return REPO_ROOT / "artifacts" / "paper_figures" / suite_root.name


def normalize_results(suite_root: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    status = load_json(suite_root / "queue_status.json")
    rows: list[dict[str, Any]] = []
    for path in sorted(suite_root.glob("fold_*/**/result.json")):
        payload = load_json(path)
        component = payload.get("suite_component", {})
        result = payload.get("result", {})
        family = str(component.get("family") or "Other")
        if family == "Prerequisite":
            continue
        fold_dir = path.parents[1].name
        try:
            fold_index = int(fold_dir.split("_")[-1])
        except ValueError:
            fold_index = 0
        rows.append(
            {
                "fold_index": fold_index,
                "name": str(component.get("name") or path.parent.name),
                "label": str(component.get("label") or path.parent.name),
                "family": family,
                "kind": str(component.get("kind") or ""),
                "color": FAMILY_COLOR.get(family, "#334155"),
                "evaluation_unit": str(result.get("evaluation_unit", "image")),
                "val_metrics": result.get("val_metrics") or {},
                "test_metrics": result.get("test_metrics") or {},
                "val_predictions": result.get("val_predictions") or [],
                "test_predictions": result.get("test_predictions") or [],
                "decision_threshold": float(result.get("decision_threshold") or 0.5),
                "result_path": str(path.resolve()),
            }
        )
    return status, rows


def summarize_component_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[(str(row["evaluation_unit"]), str(row["name"]))].append(row)

    summaries: list[dict[str, Any]] = []
    for (unit, _name), items in grouped.items():
        items = sorted(items, key=lambda item: int(item["fold_index"]))
        base = items[0]
        val_auroc_mean, val_auroc_std = mean_std([item["val_metrics"].get("AUROC") for item in items])
        val_bal_mean, val_bal_std = mean_std([item["val_metrics"].get("balanced_accuracy") for item in items])
        test_auroc_mean, test_auroc_std = mean_std([item["test_metrics"].get("AUROC") for item in items])
        test_bal_mean, test_bal_std = mean_std([item["test_metrics"].get("balanced_accuracy") for item in items])
        test_acc_mean, test_acc_std = mean_std([item["test_metrics"].get("accuracy") for item in items])
        test_sens_mean, test_sens_std = mean_std([item["test_metrics"].get("sensitivity") for item in items])
        test_spec_mean, test_spec_std = mean_std([item["test_metrics"].get("specificity") for item in items])
        gap_auroc = [
            (
                float(item["val_metrics"].get("AUROC")) - float(item["test_metrics"].get("AUROC"))
                if item["val_metrics"].get("AUROC") is not None and item["test_metrics"].get("AUROC") is not None
                else None
            )
            for item in items
        ]
        gap_bal = [
            (
                float(item["val_metrics"].get("balanced_accuracy")) - float(item["test_metrics"].get("balanced_accuracy"))
                if item["val_metrics"].get("balanced_accuracy") is not None and item["test_metrics"].get("balanced_accuracy") is not None
                else None
            )
            for item in items
        ]
        gap_auroc_mean, gap_auroc_std = mean_std(gap_auroc)
        gap_bal_mean, gap_bal_std = mean_std(gap_bal)
        summaries.append(
            {
                "name": base["name"],
                "label": base["label"],
                "family": base["family"],
                "kind": base["kind"],
                "color": base["color"],
                "evaluation_unit": unit,
                "completed_folds": len(items),
                "val_auroc_mean": val_auroc_mean,
                "val_auroc_std": val_auroc_std,
                "val_bal_acc_mean": val_bal_mean,
                "val_bal_acc_std": val_bal_std,
                "test_auroc_mean": test_auroc_mean,
                "test_auroc_std": test_auroc_std,
                "test_bal_acc_mean": test_bal_mean,
                "test_bal_acc_std": test_bal_std,
                "test_accuracy_mean": test_acc_mean,
                "test_accuracy_std": test_acc_std,
                "test_sensitivity_mean": test_sens_mean,
                "test_sensitivity_std": test_sens_std,
                "test_specificity_mean": test_spec_mean,
                "test_specificity_std": test_spec_std,
                "gap_auroc_mean": gap_auroc_mean,
                "gap_auroc_std": gap_auroc_std,
                "gap_bal_acc_mean": gap_bal_mean,
                "gap_bal_acc_std": gap_bal_std,
                "decision_threshold_mean": mean_std([item["decision_threshold"] for item in items])[0],
                "fold_result_paths": [item["result_path"] for item in items],
                "fold_items": items,
            }
        )
    return summaries


def build_model_performance_figure(results: list[dict[str, Any]], output_dir: Path, *, unit: str) -> tuple[Path, Path]:
    ordered = sorted(results, key=lambda item: (item["test_auroc_mean"] or 0.0, item["test_bal_acc_mean"] or 0.0), reverse=True)
    x = np.arange(len(ordered))
    width = 0.36
    colors = [item["color"] for item in ordered]
    labels = [item["label"] for item in ordered]
    test_auroc = [item["test_auroc_mean"] or 0.0 for item in ordered]
    test_bal = [item["test_bal_acc_mean"] or 0.0 for item in ordered]
    auroc_err = [item["test_auroc_std"] or 0.0 for item in ordered]
    bal_err = [item["test_bal_acc_std"] or 0.0 for item in ordered]

    fig, ax = plt.subplots(figsize=(max(9.0, len(ordered) * 1.2), 5.8))
    bars_auroc = ax.bar(
        x - width / 2,
        test_auroc,
        width,
        color=colors,
        edgecolor="#0f172a",
        linewidth=0.5,
        yerr=auroc_err,
        capsize=4,
        label="CV Test AUROC mean±std",
    )
    bars_bal = ax.bar(
        x + width / 2,
        test_bal,
        width,
        color=colors,
        edgecolor="#0f172a",
        linewidth=0.5,
        hatch="//",
        alpha=0.82,
        yerr=bal_err,
        capsize=4,
        label="CV Test Balanced Acc mean±std",
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
    ax.set_title(f"5-Fold CV Performance ({unit.title()}-Level)", fontweight="bold")
    style_axes(ax)
    ax.legend(frameon=False, loc="upper right")
    fig.text(0.02, 0.01, "Bars show mean held-out fold performance with standard deviation error bars.", fontsize=9, color="#475569")
    return save_figure(fig, output_dir, "figure1_cv_model_performance")


def build_generalization_gap_figure(results: list[dict[str, Any]], output_dir: Path, *, unit: str) -> tuple[Path, Path]:
    ordered = sorted(results, key=lambda item: item["gap_auroc_mean"] or -999.0, reverse=True)
    labels = [item["label"] for item in ordered]
    colors = [item["color"] for item in ordered]
    auroc_gap = [item["gap_auroc_mean"] or 0.0 for item in ordered]
    bal_gap = [item["gap_bal_acc_mean"] or 0.0 for item in ordered]
    auroc_err = [item["gap_auroc_std"] or 0.0 for item in ordered]
    bal_err = [item["gap_bal_acc_std"] or 0.0 for item in ordered]
    x = np.arange(len(ordered))

    fig, axes = plt.subplots(1, 2, figsize=(max(12.0, len(ordered) * 1.25), 5.8))
    gap_specs = [
        ("Mean Validation AUROC - Mean Test AUROC", auroc_gap, auroc_err, "AUROC gap"),
        ("Mean Validation Balanced Acc - Mean Test Balanced Acc", bal_gap, bal_err, "Balanced Acc gap"),
    ]
    for ax, (title, gaps, errs, ylabel) in zip(axes, gap_specs, strict=False):
        ax.bar(x, gaps, color=colors, edgecolor="#0f172a", linewidth=0.5, yerr=errs, capsize=4)
        ax.axhline(0, color="#0f172a", linewidth=0.8)
        for index, gap in enumerate(gaps):
            ax.text(index, gap + (0.01 if gap >= 0 else -0.015), f"{gap:+.3f}", ha="center", va="bottom" if gap >= 0 else "top", fontsize=8)
        ax.set_xticks(x)
        ax.set_xticklabels(labels, rotation=20, ha="right")
        ax.set_ylabel(ylabel)
        ax.set_title(title, fontweight="bold")
        style_axes(ax)
    fig.suptitle(f"5-Fold CV Generalization Gap ({unit.title()}-Level)", fontweight="bold", y=1.02)
    fig.text(0.02, 0.01, "Positive values indicate validation performance exceeded held-out fold test performance.", fontsize=9, color="#475569")
    fig.tight_layout()
    return save_figure(fig, output_dir, "figure2_cv_generalization_gap")


def build_roc_figure(results: list[dict[str, Any]], output_dir: Path, *, unit: str) -> tuple[Path, Path]:
    ordered = sorted(results, key=lambda item: item["test_auroc_mean"] or 0.0, reverse=True)
    fig, ax = plt.subplots(figsize=(8.2, 6.8))
    ax.plot([0, 1], [0, 1], linestyle="--", color="#94a3b8", linewidth=1.0, label="Chance")
    for item in ordered:
        true_labels: list[int] = []
        positive_probabilities: list[float] = []
        for fold_item in item["fold_items"]:
            for row in fold_item["test_predictions"]:
                if row.get("true_label_index") is None or row.get("positive_probability") is None:
                    continue
                true_labels.append(int(row["true_label_index"]))
                positive_probabilities.append(float(row["positive_probability"]))
        if len(set(true_labels)) < 2:
            continue
        fpr, tpr, _thresholds = roc_curve(true_labels, positive_probabilities)
        linestyle = "--" if item["family"] == "Retrieval" else "-"
        ax.plot(
            fpr,
            tpr,
            linewidth=2.2,
            linestyle=linestyle,
            color=item["color"],
            label=f"{item['label']} (CV mean AUC={item['test_auroc_mean']:.3f})",
        )
    ax.set_xlim(-0.02, 1.02)
    ax.set_ylim(-0.02, 1.02)
    ax.set_xlabel("False Positive Rate")
    ax.set_ylabel("True Positive Rate")
    ax.set_title(f"Out-of-Fold ROC Curves ({unit.title()}-Level)", fontweight="bold")
    style_axes(ax, grid_axis="both")
    ax.legend(loc="lower right", frameon=False)
    fig.text(0.02, 0.01, "ROC curves are built from concatenated out-of-fold test predictions.", fontsize=9, color="#475569")
    return save_figure(fig, output_dir, "figure3_cv_integrated_roc_curve")


def write_summary_csv(results: list[dict[str, Any]], output_dir: Path) -> Path:
    csv_path = output_dir / "summary.csv"
    fieldnames = [
        "name",
        "label",
        "family",
        "evaluation_unit",
        "completed_folds",
        "val_auroc_mean",
        "val_auroc_std",
        "test_auroc_mean",
        "test_auroc_std",
        "auroc_gap_mean",
        "auroc_gap_std",
        "val_bal_acc_mean",
        "val_bal_acc_std",
        "test_bal_acc_mean",
        "test_bal_acc_std",
        "bal_acc_gap_mean",
        "bal_acc_gap_std",
        "test_accuracy_mean",
        "test_sensitivity_mean",
        "test_specificity_mean",
        "decision_threshold_mean",
        "fold_result_paths",
    ]
    ordered = sorted(results, key=lambda item: item["test_auroc_mean"] or 0.0, reverse=True)
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
                    "completed_folds": item["completed_folds"],
                    "val_auroc_mean": f"{(item['val_auroc_mean'] or 0.0):.6f}",
                    "val_auroc_std": f"{(item['val_auroc_std'] or 0.0):.6f}",
                    "test_auroc_mean": f"{(item['test_auroc_mean'] or 0.0):.6f}",
                    "test_auroc_std": f"{(item['test_auroc_std'] or 0.0):.6f}",
                    "auroc_gap_mean": f"{(item['gap_auroc_mean'] or 0.0):+.6f}",
                    "auroc_gap_std": f"{(item['gap_auroc_std'] or 0.0):.6f}",
                    "val_bal_acc_mean": f"{(item['val_bal_acc_mean'] or 0.0):.6f}",
                    "val_bal_acc_std": f"{(item['val_bal_acc_std'] or 0.0):.6f}",
                    "test_bal_acc_mean": f"{(item['test_bal_acc_mean'] or 0.0):.6f}",
                    "test_bal_acc_std": f"{(item['test_bal_acc_std'] or 0.0):.6f}",
                    "bal_acc_gap_mean": f"{(item['gap_bal_acc_mean'] or 0.0):+.6f}",
                    "bal_acc_gap_std": f"{(item['gap_bal_acc_std'] or 0.0):.6f}",
                    "test_accuracy_mean": f"{(item['test_accuracy_mean'] or 0.0):.6f}",
                    "test_sensitivity_mean": f"{(item['test_sensitivity_mean'] or 0.0):.6f}",
                    "test_specificity_mean": f"{(item['test_specificity_mean'] or 0.0):.6f}",
                    "decision_threshold_mean": f"{(item['decision_threshold_mean'] or 0.0):.6f}",
                    "fold_result_paths": " | ".join(item["fold_result_paths"]),
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
    ordered = sorted(results, key=lambda item: item["test_auroc_mean"] or 0.0, reverse=True)
    rows = "\n".join(
        f"<tr><td>{item['label']}</td><td>{item['family']}</td><td>{item['completed_folds']}</td><td>{(item['test_auroc_mean'] or 0.0):.3f} ± {(item['test_auroc_std'] or 0.0):.3f}</td><td>{(item['test_bal_acc_mean'] or 0.0):.3f} ± {(item['test_bal_acc_std'] or 0.0):.3f}</td><td>{(item['test_sensitivity_mean'] or 0.0):.3f}</td><td>{(item['test_specificity_mean'] or 0.0):.3f}</td><td>{(item['gap_auroc_mean'] or 0.0):+.3f}</td></tr>"
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
  <title>Current Model Suite CV Figures ({unit})</title>
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
  <h1>Current Model Suite 5-Fold CV Figures ({unit.title()}-Level)</h1>
  <p class="meta">Queue status: {status.get("overall_status")} · dataset {status.get("dataset_summary", {}).get("n_patients")} patients / {status.get("dataset_summary", {}).get("n_visits")} visits / {status.get("dataset_summary", {}).get("n_images")} images.</p>
  <div class="figures">
    {figure_sections}
  </div>
  <h2>Summary Table</h2>
  <table>
    <thead>
      <tr>
        <th>Method</th>
        <th>Family</th>
        <th>Completed folds</th>
        <th>CV Test AUROC</th>
        <th>CV Test Balanced Acc</th>
        <th>CV Test Sensitivity</th>
        <th>CV Test Specificity</th>
        <th>Mean AUROC Gap</th>
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
            ("Figure 1. CV model performance", figure_1[0], figure_1[1]),
            ("Figure 2. CV generalization gap", figure_2[0], figure_2[1]),
            ("Figure 3. Out-of-fold ROC curve", figure_3[0], figure_3[1]),
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
    output_root = args.out_dir.expanduser().resolve() if args.out_dir else default_output_root(suite_root)
    status, fold_rows = normalize_results(suite_root)
    summaries = summarize_component_rows(fold_rows)
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in summaries:
        grouped[item["evaluation_unit"]].append(item)
    if not grouped:
        raise RuntimeError(f"No completed fold result.json files found under {suite_root}")

    lines: list[str] = []
    for unit, unit_results in sorted(grouped.items()):
        lines.append(f"[{unit}]")
        lines.extend(export_unit_figures(status, unit_results, output_root / f"{unit}_level", unit=unit))
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
