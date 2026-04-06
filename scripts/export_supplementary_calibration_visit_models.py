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
from sklearn.metrics import roc_auc_score


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CV_ROOT = REPO_ROOT / "artifacts" / "mil_backbone_ablation_cv_20260403_p101_5fold"
DEFAULT_OUT_DIR = (
    REPO_ROOT / "artifacts" / "paper_figures" / "supplementary_calibration_visit_models_20260406"
)

MODEL_SPECS = [
    {
        "name": "convnext_tiny_mil_full",
        "label": "ConvNeXt-Tiny MIL",
        "color": "#7c3aed",
    },
    {
        "name": "efficientnet_v2_s_mil_full",
        "label": "EfficientNetV2-S MIL",
        "color": "#2563eb",
    },
    {
        "name": "official_dinov2_retrieval_lesion_crop",
        "label": "DINOv2 Lesion Retrieval",
        "color": "#dc2626",
    },
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Export supplementary reliability diagrams and calibration summary for top visit-level models."
        )
    )
    parser.add_argument("--cv-root", type=Path, default=DEFAULT_CV_ROOT)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument("--n-bins", type=int, default=10)
    return parser.parse_args()


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def style_axes(ax: plt.Axes) -> None:
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(axis="both", alpha=0.22, linestyle="--", linewidth=0.8)


def save_figure(fig: plt.Figure, output_dir: Path, stem: str) -> tuple[Path, Path]:
    svg_path = output_dir / f"{stem}.svg"
    png_path = output_dir / f"{stem}.png"
    fig.savefig(svg_path, bbox_inches="tight")
    fig.savefig(png_path, dpi=240, bbox_inches="tight")
    plt.close(fig)
    return png_path, svg_path


def compute_current_operating_point(cv_root: Path, component: str) -> dict[str, float]:
    thresholds: list[float] = []
    tp = tn = fp = fn = 0
    for path in sorted(cv_root.glob(f"fold_*/{component}/result.json")):
        result = load_json(path)["result"]
        threshold = float(result.get("decision_threshold") or 0.5)
        thresholds.append(threshold)
        for row in result.get("test_predictions") or []:
            if row.get("true_label") is None or row.get("positive_probability") is None:
                continue
            y_true = 1 if str(row["true_label"]).strip().lower().startswith("fung") else 0
            pred = 1 if float(row["positive_probability"]) >= threshold else 0
            if pred == 1 and y_true == 1:
                tp += 1
            elif pred == 1 and y_true == 0:
                fp += 1
            elif pred == 0 and y_true == 0:
                tn += 1
            else:
                fn += 1
    sensitivity = tp / (tp + fn)
    specificity = tn / (tn + fp)
    accuracy = (tp + tn) / (tp + tn + fp + fn)
    return {
        "threshold_mean": float(np.mean(np.asarray(thresholds, dtype=np.float64))),
        "threshold_std": float(np.std(np.asarray(thresholds, dtype=np.float64))),
        "sensitivity": float(sensitivity),
        "specificity": float(specificity),
        "accuracy": float(accuracy),
        "balanced_accuracy": float((sensitivity + specificity) / 2.0),
        "tp": tp,
        "tn": tn,
        "fp": fp,
        "fn": fn,
    }


def collect_model_summary(cv_root: Path, spec: dict[str, str], n_bins: int) -> dict[str, Any]:
    y_true: list[int] = []
    y_prob: list[float] = []
    for path in sorted(cv_root.glob(f"fold_*/{spec['name']}/result.json")):
        result = load_json(path)["result"]
        for row in result.get("test_predictions") or []:
            if row.get("true_label") is None or row.get("positive_probability") is None:
                continue
            y_true.append(1 if str(row["true_label"]).strip().lower().startswith("fung") else 0)
            y_prob.append(float(row["positive_probability"]))

    y_true_arr = np.asarray(y_true, dtype=np.int32)
    y_prob_arr = np.asarray(y_prob, dtype=np.float64)
    brier = float(np.mean((y_prob_arr - y_true_arr) ** 2))
    auc = float(roc_auc_score(y_true_arr, y_prob_arr))

    bins = np.linspace(0.0, 1.0, n_bins + 1)
    bin_rows: list[dict[str, Any]] = []
    ece = 0.0
    for idx in range(n_bins):
        lo, hi = bins[idx], bins[idx + 1]
        if idx < n_bins - 1:
            mask = (y_prob_arr >= lo) & (y_prob_arr < hi)
        else:
            mask = (y_prob_arr >= lo) & (y_prob_arr <= hi)
        count = int(mask.sum())
        if count == 0:
            continue
        mean_conf = float(np.mean(y_prob_arr[mask]))
        observed = float(np.mean(y_true_arr[mask]))
        ece += (count / len(y_true_arr)) * abs(mean_conf - observed)
        bin_rows.append(
            {
                "bin_index": idx,
                "bin_start": float(lo),
                "bin_end": float(hi),
                "count": count,
                "mean_confidence": mean_conf,
                "observed_frequency": observed,
            }
        )

    current = compute_current_operating_point(cv_root, spec["name"])
    return {
        **spec,
        "n_samples": int(len(y_true_arr)),
        "n_positive": int(y_true_arr.sum()),
        "n_negative": int((1 - y_true_arr).sum()),
        "oof_auc": auc,
        "brier_score": brier,
        "ece": float(ece),
        "bins": bin_rows,
        "current_threshold_mean": current["threshold_mean"],
        "current_threshold_std": current["threshold_std"],
        "current_sensitivity": current["sensitivity"],
        "current_specificity": current["specificity"],
        "current_bal_acc": current["balanced_accuracy"],
        "current_accuracy": current["accuracy"],
    }


def build_figure(model_rows: list[dict[str, Any]], output_dir: Path) -> tuple[Path, Path]:
    fig = plt.figure(figsize=(13.8, 7.6))
    gs = fig.add_gridspec(2, 3, height_ratios=[3.2, 1.2], hspace=0.28, wspace=0.22)

    panel_labels = ["A", "B", "C"]
    for idx, row in enumerate(model_rows):
        ax = fig.add_subplot(gs[0, idx])
        ax.plot([0, 1], [0, 1], linestyle="--", color="#94a3b8", linewidth=1.0)
        xs = [item["mean_confidence"] for item in row["bins"]]
        ys = [item["observed_frequency"] for item in row["bins"]]
        sizes = [28 + 4 * item["count"] for item in row["bins"]]
        ax.plot(xs, ys, color=row["color"], linewidth=2.0, alpha=0.95)
        ax.scatter(
            xs,
            ys,
            s=sizes,
            color=row["color"],
            edgecolors="white",
            linewidths=0.8,
            alpha=0.92,
            zorder=3,
        )
        ax.set_xlim(-0.02, 1.02)
        ax.set_ylim(-0.02, 1.02)
        ax.set_xlabel("Mean predicted probability")
        if idx == 0:
            ax.set_ylabel("Observed fungal frequency")
        ax.set_title(f"{panel_labels[idx]}. {row['label']}", fontsize=12.2, loc="left")
        style_axes(ax)
        ax.text(
            0.03,
            0.97,
            (
                f"OOF AUC {row['oof_auc']:.3f}\n"
                f"Brier {row['brier_score']:.3f}\n"
                f"ECE {row['ece']:.3f}\n"
                f"Sens/Spec {row['current_sensitivity']:.3f}/{row['current_specificity']:.3f}"
            ),
            transform=ax.transAxes,
            ha="left",
            va="top",
            fontsize=9.2,
            color="#0f172a",
            bbox=dict(boxstyle="round,pad=0.28", facecolor="white", edgecolor="#cbd5e1", alpha=0.95),
        )

    ax_tbl = fig.add_subplot(gs[1, :])
    ax_tbl.axis("off")
    cell_text = [
        [
            row["label"],
            f"{row['oof_auc']:.3f}",
            f"{row['brier_score']:.3f}",
            f"{row['ece']:.3f}",
            f"{row['current_sensitivity']:.3f}",
            f"{row['current_specificity']:.3f}",
        ]
        for row in model_rows
    ]
    table = ax_tbl.table(
        cellText=cell_text,
        colLabels=["Model", "OOF AUC", "Brier", "ECE", "Sens", "Spec"],
        cellLoc="center",
        loc="center",
        bbox=[0.02, 0.02, 0.96, 0.92],
        colWidths=[0.34, 0.12, 0.12, 0.12, 0.12, 0.12],
    )
    table.auto_set_font_size(False)
    table.set_fontsize(9.2)
    for (r, c), cell in table.get_celld().items():
        cell.set_edgecolor("#cbd5e1")
        cell.set_linewidth(0.8)
        if r == 0:
            cell.set_facecolor("#e2e8f0")
            cell.set_text_props(weight="bold", color="#0f172a")
        elif c == 0:
            cell.set_facecolor("#f8fafc")
            cell.set_text_props(color="#0f172a")

    return save_figure(fig, output_dir, "supplementary_calibration_visit_models")


def write_summary_csv(model_rows: list[dict[str, Any]], output_dir: Path) -> Path:
    path = output_dir / "summary.csv"
    fieldnames = [
        "name",
        "label",
        "n_samples",
        "n_positive",
        "n_negative",
        "oof_auc",
        "brier_score",
        "ece",
        "current_threshold_mean",
        "current_threshold_std",
        "current_sensitivity",
        "current_specificity",
        "current_bal_acc",
        "current_accuracy",
    ]
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in model_rows:
            writer.writerow(
                {
                    key: (f"{row[key]:.6f}" if isinstance(row[key], float) else row[key])
                    for key in fieldnames
                }
            )
    return path


def write_bins_csv(model_rows: list[dict[str, Any]], output_dir: Path) -> Path:
    path = output_dir / "calibration_bins.csv"
    fieldnames = [
        "name",
        "label",
        "bin_index",
        "bin_start",
        "bin_end",
        "count",
        "mean_confidence",
        "observed_frequency",
    ]
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in model_rows:
            for item in row["bins"]:
                writer.writerow(
                    {
                        "name": row["name"],
                        "label": row["label"],
                        "bin_index": item["bin_index"],
                        "bin_start": f"{item['bin_start']:.6f}",
                        "bin_end": f"{item['bin_end']:.6f}",
                        "count": item["count"],
                        "mean_confidence": f"{item['mean_confidence']:.6f}",
                        "observed_frequency": f"{item['observed_frequency']:.6f}",
                    }
                )
    return path


def write_html(output_dir: Path, summary_csv: Path, bins_csv: Path, png_path: Path) -> Path:
    path = output_dir / "figures.html"
    html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Supplementary Calibration Figure</title>
  <style>
    body {{ font-family: Arial, sans-serif; margin: 24px; color: #111827; }}
    img {{ max-width: 100%; height: auto; border: 1px solid #cbd5e1; }}
    a {{ color: #1d4ed8; }}
  </style>
</head>
<body>
  <h1>Supplementary Calibration Figure</h1>
  <p><a href="{summary_csv.name}">{summary_csv.name}</a> |
     <a href="{bins_csv.name}">{bins_csv.name}</a></p>
  <p><img src="{png_path.name}" alt="Supplementary calibration figure"></p>
</body>
</html>
"""
    path.write_text(html, encoding="utf-8")
    return path


def main() -> int:
    args = parse_args()
    cv_root = args.cv_root.expanduser().resolve()
    output_dir = args.out_dir.expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    model_rows = [collect_model_summary(cv_root, spec, args.n_bins) for spec in MODEL_SPECS]
    summary_csv = write_summary_csv(model_rows, output_dir)
    bins_csv = write_bins_csv(model_rows, output_dir)
    png_path, svg_path = build_figure(model_rows, output_dir)
    html_path = write_html(output_dir, summary_csv, bins_csv, png_path)

    print(f"PNG: {png_path}")
    print(f"SVG: {svg_path}")
    print(f"Summary CSV: {summary_csv}")
    print(f"Bins CSV: {bins_csv}")
    print(f"HTML: {html_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
