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
from sklearn.metrics import roc_auc_score, roc_curve


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CV_ROOT = REPO_ROOT / "artifacts" / "mil_backbone_ablation_cv_20260403_p101_5fold"
DEFAULT_OUT_DIR = REPO_ROOT / "artifacts" / "paper_figures" / "figure3_visit_level_oof_roc_20260404"

MODEL_SPECS = [
    {
        "name": "convnext_tiny_mil_full",
        "label": "ConvNeXt-Tiny MIL",
        "color": "#7c3aed",
        "linestyle": "-",
    },
    {
        "name": "efficientnet_v2_s_mil_full",
        "label": "EfficientNetV2-S MIL",
        "color": "#2563eb",
        "linestyle": "-",
    },
    {
        "name": "official_dinov2_retrieval_lesion_crop",
        "label": "DINOv2 Lesion Retrieval",
        "color": "#dc2626",
        "linestyle": "--",
    },
    {
        "name": "official_dinov2_mil",
        "label": "DINOv2 Attention MIL",
        "color": "#16a34a",
        "linestyle": ":",
    },
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export Figure 3: concatenated out-of-fold ROC curves for representative visit-level models."
    )
    parser.add_argument("--cv-root", type=Path, default=DEFAULT_CV_ROOT)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
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


def style_axes(ax: plt.Axes) -> None:
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(axis="both", alpha=0.22, linestyle="--", linewidth=0.8)


def mean_std(values: list[float]) -> tuple[float, float]:
    arr = np.asarray(values, dtype=np.float64)
    return float(arr.mean()), float(arr.std())


def collect_model_rows(cv_root: Path, spec: dict[str, str]) -> dict[str, Any]:
    fold_items: list[dict[str, Any]] = []
    y_true: list[int] = []
    y_score: list[float] = []
    for path in sorted(cv_root.glob(f"fold_*/{spec['name']}/result.json")):
        payload = load_json(path)
        result = payload["result"]
        test_metrics = result.get("test_metrics") or {}
        fold_items.append(
            {
                "fold_name": path.parents[1].name,
                "test_auroc": float(test_metrics.get("AUROC") or 0.0),
                "test_bal_acc": float(test_metrics.get("balanced_accuracy") or 0.0),
                "result_path": str(path.resolve()),
            }
        )
        for row in result.get("test_predictions") or []:
            if row.get("true_label") is None or row.get("positive_probability") is None:
                continue
            y_true.append(1 if str(row["true_label"]).strip().lower().startswith("fung") else 0)
            y_score.append(float(row["positive_probability"]))
    if len(set(y_true)) < 2:
        raise RuntimeError(f"Insufficient class diversity for ROC: {spec['name']}")
    test_auroc_mean, test_auroc_std = mean_std([item["test_auroc"] for item in fold_items])
    test_bal_mean, test_bal_std = mean_std([item["test_bal_acc"] for item in fold_items])
    return {
        **spec,
        "completed_folds": len(fold_items),
        "test_auroc_mean": test_auroc_mean,
        "test_auroc_std": test_auroc_std,
        "test_bal_acc_mean": test_bal_mean,
        "test_bal_acc_std": test_bal_std,
        "oof_auc": float(roc_auc_score(y_true, y_score)),
        "fpr": roc_curve(y_true, y_score)[0],
        "tpr": roc_curve(y_true, y_score)[1],
        "n_test_predictions": len(y_true),
        "fold_items": fold_items,
    }


def build_figure(results: list[dict[str, Any]], output_dir: Path) -> tuple[Path, Path]:
    fig, ax = plt.subplots(figsize=(8.2, 6.6))
    ax.plot([0, 1], [0, 1], linestyle="--", color="#94a3b8", linewidth=1.1, label="Chance")
    for item in results:
        ax.plot(
            item["fpr"],
            item["tpr"],
            color=item["color"],
            linestyle=item["linestyle"],
            linewidth=2.4,
            label=f"{item['label']} (AUC {item['oof_auc']:.3f})",
        )
    ax.set_xlim(-0.02, 1.02)
    ax.set_ylim(-0.02, 1.02)
    ax.set_xlabel("False Positive Rate")
    ax.set_ylabel("True Positive Rate")
    style_axes(ax)
    ax.legend(loc="lower right", frameon=False)
    fig.text(
        0.015,
        0.01,
        "ROC curves are built from concatenated out-of-fold visit-level test predictions.",
        fontsize=9,
        color="#475569",
    )
    return save_figure(fig, output_dir, "figure3_oof_visit_level_roc")


def write_summary_csv(results: list[dict[str, Any]], output_dir: Path) -> Path:
    csv_path = output_dir / "summary.csv"
    fieldnames = [
        "name",
        "label",
        "completed_folds",
        "n_test_predictions",
        "oof_auc",
        "test_auroc_mean",
        "test_auroc_std",
        "test_bal_acc_mean",
        "test_bal_acc_std",
        "fold_result_paths",
    ]
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for item in results:
            writer.writerow(
                {
                    "name": item["name"],
                    "label": item["label"],
                    "completed_folds": item["completed_folds"],
                    "n_test_predictions": item["n_test_predictions"],
                    "oof_auc": f"{item['oof_auc']:.6f}",
                    "test_auroc_mean": f"{item['test_auroc_mean']:.6f}",
                    "test_auroc_std": f"{item['test_auroc_std']:.6f}",
                    "test_bal_acc_mean": f"{item['test_bal_acc_mean']:.6f}",
                    "test_bal_acc_std": f"{item['test_bal_acc_std']:.6f}",
                    "fold_result_paths": "; ".join(fold["result_path"] for fold in item["fold_items"]),
                }
            )
    return csv_path


def write_html(output_dir: Path, summary_csv: Path, png_path: Path) -> Path:
    html_path = output_dir / "figures.html"
    html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Figure 3 — Visit-level OOF ROC</title>
  <style>
    body {{ font-family: Arial, sans-serif; margin: 24px; color: #111827; }}
    img {{ max-width: 100%; height: auto; border: 1px solid #cbd5e1; }}
    a {{ color: #1d4ed8; }}
  </style>
</head>
<body>
  <h1>Figure 3 — Visit-level OOF ROC</h1>
  <p>Summary CSV: <a href="{summary_csv.name}">{summary_csv.name}</a></p>
  <p><img src="{png_path.name}" alt="Figure 3 visit-level OOF ROC"></p>
</body>
</html>
"""
    html_path.write_text(html, encoding="utf-8")
    return html_path


def main() -> int:
    args = parse_args()
    output_dir = args.out_dir.expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    results = [collect_model_rows(args.cv_root.expanduser().resolve(), spec) for spec in MODEL_SPECS]
    summary_csv = write_summary_csv(results, output_dir)
    png_path, svg_path = build_figure(results, output_dir)
    html_path = write_html(output_dir, summary_csv, png_path)
    print(f"PNG: {png_path}")
    print(f"SVG: {svg_path}")
    print(f"CSV: {summary_csv}")
    print(f"HTML: {html_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
