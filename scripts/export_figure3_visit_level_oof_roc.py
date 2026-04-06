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
THRESHOLD_COMPONENT = "official_dinov2_retrieval_lesion_crop"

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
        "name": THRESHOLD_COMPONENT,
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
        description=(
            "Export Figure 3: concatenated out-of-fold ROC curves plus a fungal-safety "
            "threshold sweep for DINOv2 lesion retrieval."
        )
    )
    parser.add_argument("--cv-root", type=Path, default=DEFAULT_CV_ROOT)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument("--bootstrap-iters", type=int, default=2000)
    parser.add_argument("--seed", type=int, default=42)
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


def bootstrap_auc_ci(
    y_true: np.ndarray,
    y_score: np.ndarray,
    *,
    n_bootstrap: int,
    seed: int,
) -> tuple[float, float]:
    rng = np.random.default_rng(seed)
    aucs: list[float] = []
    n = len(y_true)
    while len(aucs) < n_bootstrap:
        idx = rng.integers(0, n, size=n)
        sample_y = y_true[idx]
        if np.unique(sample_y).size < 2:
            continue
        aucs.append(float(roc_auc_score(sample_y, y_score[idx])))
    arr = np.asarray(aucs, dtype=np.float64)
    return float(np.quantile(arr, 0.025)), float(np.quantile(arr, 0.975))


def collect_model_rows(
    cv_root: Path,
    spec: dict[str, str],
    *,
    bootstrap_iters: int,
    seed: int,
) -> dict[str, Any]:
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
    y_true_arr = np.asarray(y_true, dtype=np.int32)
    y_score_arr = np.asarray(y_score, dtype=np.float64)
    if np.unique(y_true_arr).size < 2:
        raise RuntimeError(f"Insufficient class diversity for ROC: {spec['name']}")
    test_auroc_mean, test_auroc_std = mean_std([item["test_auroc"] for item in fold_items])
    test_bal_mean, test_bal_std = mean_std([item["test_bal_acc"] for item in fold_items])
    ci_low, ci_high = bootstrap_auc_ci(
        y_true_arr,
        y_score_arr,
        n_bootstrap=bootstrap_iters,
        seed=seed + len(spec["name"]),
    )
    fpr, tpr, _ = roc_curve(y_true_arr, y_score_arr)
    return {
        **spec,
        "completed_folds": len(fold_items),
        "test_auroc_mean": test_auroc_mean,
        "test_auroc_std": test_auroc_std,
        "test_bal_acc_mean": test_bal_mean,
        "test_bal_acc_std": test_bal_std,
        "oof_auc": float(roc_auc_score(y_true_arr, y_score_arr)),
        "auc_ci_low": ci_low,
        "auc_ci_high": ci_high,
        "fpr": fpr,
        "tpr": tpr,
        "n_test_predictions": len(y_true),
        "fold_items": fold_items,
    }


def compute_metrics(y_true: np.ndarray, y_score: np.ndarray, threshold: float) -> dict[str, float]:
    pred = (y_score >= threshold).astype(np.int32)
    tp = int(np.sum((pred == 1) & (y_true == 1)))
    tn = int(np.sum((pred == 0) & (y_true == 0)))
    fp = int(np.sum((pred == 1) & (y_true == 0)))
    fn = int(np.sum((pred == 0) & (y_true == 1)))
    sensitivity = tp / (tp + fn) if (tp + fn) else 0.0
    specificity = tn / (tn + fp) if (tn + fp) else 0.0
    accuracy = (tp + tn) / len(y_true) if len(y_true) else 0.0
    balanced_accuracy = (sensitivity + specificity) / 2.0
    return {
        "threshold": float(threshold),
        "tp": tp,
        "tn": tn,
        "fp": fp,
        "fn": fn,
        "sensitivity": float(sensitivity),
        "specificity": float(specificity),
        "accuracy": float(accuracy),
        "balanced_accuracy": float(balanced_accuracy),
    }


def compute_current_fold_specific_operating_point(
    cv_root: Path,
    component: str,
) -> dict[str, float]:
    thresholds: list[float] = []
    tp = tn = fp = fn = 0
    for path in sorted(cv_root.glob(f"fold_*/{component}/result.json")):
        payload = load_json(path)
        result = payload["result"]
        threshold = float(result.get("decision_threshold") or 0.5)
        thresholds.append(threshold)
        for row in result.get("test_predictions") or []:
            if row.get("true_label") is None or row.get("positive_probability") is None:
                continue
            y = 1 if str(row["true_label"]).strip().lower().startswith("fung") else 0
            pred = 1 if float(row["positive_probability"]) >= threshold else 0
            if pred == 1 and y == 1:
                tp += 1
            elif pred == 1 and y == 0:
                fp += 1
            elif pred == 0 and y == 0:
                tn += 1
            else:
                fn += 1
    sensitivity = tp / (tp + fn)
    specificity = tn / (tn + fp)
    accuracy = (tp + tn) / (tp + tn + fp + fn)
    return {
        "label": "Current (bal acc-opt.)",
        "threshold": float(np.mean(np.asarray(thresholds, dtype=np.float64))),
        "threshold_std": float(np.std(np.asarray(thresholds, dtype=np.float64))),
        "sensitivity": float(sensitivity),
        "specificity": float(specificity),
        "balanced_accuracy": float((sensitivity + specificity) / 2.0),
        "accuracy": float(accuracy),
        "tp": tp,
        "tn": tn,
        "fp": fp,
        "fn": fn,
    }


def select_target_operating_point(
    sweep_rows: list[dict[str, float]],
    *,
    target_sensitivity: float,
    label: str,
) -> dict[str, float]:
    eligible = [row for row in sweep_rows if row["sensitivity"] >= target_sensitivity]
    if not eligible:
        raise RuntimeError(f"No threshold reaches target sensitivity {target_sensitivity:.2f}")
    best = max(eligible, key=lambda row: (row["specificity"], row["balanced_accuracy"], row["threshold"]))
    return {
        **best,
        "label": label,
        "target_sensitivity": target_sensitivity,
    }


def collect_threshold_panel_data(cv_root: Path, component: str) -> dict[str, Any]:
    y_true: list[int] = []
    y_score: list[float] = []
    for path in sorted(cv_root.glob(f"fold_*/{component}/result.json")):
        payload = load_json(path)
        result = payload["result"]
        for row in result.get("test_predictions") or []:
            if row.get("true_label") is None or row.get("positive_probability") is None:
                continue
            y_true.append(1 if str(row["true_label"]).strip().lower().startswith("fung") else 0)
            y_score.append(float(row["positive_probability"]))
    y_true_arr = np.asarray(y_true, dtype=np.int32)
    y_score_arr = np.asarray(y_score, dtype=np.float64)
    thresholds = np.linspace(0.0, 1.0, 1001)
    sweep_rows = [compute_metrics(y_true_arr, y_score_arr, float(thr)) for thr in thresholds]
    current_point = compute_current_fold_specific_operating_point(cv_root, component)
    fungal_safe = select_target_operating_point(
        sweep_rows,
        target_sensitivity=0.70,
        label="Fungal-safe (>= 0.70)",
    )
    high_sensitivity = select_target_operating_point(
        sweep_rows,
        target_sensitivity=0.80,
        label="High-sens (>= 0.80)",
    )
    return {
        "thresholds": thresholds,
        "sensitivity": np.asarray([row["sensitivity"] for row in sweep_rows], dtype=np.float64),
        "specificity": np.asarray([row["specificity"] for row in sweep_rows], dtype=np.float64),
        "balanced_accuracy": np.asarray([row["balanced_accuracy"] for row in sweep_rows], dtype=np.float64),
        "current_point": current_point,
        "fungal_safe_point": fungal_safe,
        "high_sensitivity_point": high_sensitivity,
        "sweep_rows": sweep_rows,
    }


def build_figure(
    results: list[dict[str, Any]],
    threshold_panel: dict[str, Any],
    output_dir: Path,
) -> tuple[Path, Path]:
    fig = plt.figure(figsize=(13.2, 5.9))
    gs = fig.add_gridspec(1, 2, width_ratios=[1.35, 1.0], wspace=0.24)

    ax_roc = fig.add_subplot(gs[0, 0])
    ax_roc.plot([0, 1], [0, 1], linestyle="--", color="#94a3b8", linewidth=1.1, label="Chance")
    for item in results:
        ax_roc.plot(
            item["fpr"],
            item["tpr"],
            color=item["color"],
            linestyle=item["linestyle"],
            linewidth=2.4,
            label=(
                f"{item['label']} "
                f"{item['oof_auc']:.3f} [{item['auc_ci_low']:.3f}–{item['auc_ci_high']:.3f}]"
            ),
        )
    ax_roc.set_xlim(-0.02, 1.02)
    ax_roc.set_ylim(-0.02, 1.02)
    ax_roc.set_xlabel("False Positive Rate")
    ax_roc.set_ylabel("True Positive Rate")
    ax_roc.set_title("A. Out-of-fold ROC curves", fontsize=12.5, loc="left")
    style_axes(ax_roc)
    ax_roc.legend(
        loc="lower right",
        frameon=False,
        title="AUC [95% CI]",
        title_fontsize=9.2,
        fontsize=8.7,
    )

    right = gs[0, 1].subgridspec(2, 1, height_ratios=[3.0, 1.2], hspace=0.16)
    ax_thr = fig.add_subplot(right[0, 0])
    ax_tbl = fig.add_subplot(right[1, 0])

    ax_thr.plot(
        threshold_panel["thresholds"],
        threshold_panel["sensitivity"],
        color="#dc2626",
        linewidth=2.2,
        label="Sensitivity",
    )
    ax_thr.plot(
        threshold_panel["thresholds"],
        threshold_panel["specificity"],
        color="#2563eb",
        linewidth=2.2,
        label="Specificity",
    )
    ax_thr.plot(
        threshold_panel["thresholds"],
        threshold_panel["balanced_accuracy"],
        color="#16a34a",
        linewidth=2.0,
        linestyle="--",
        label="Balanced accuracy",
    )
    fungal_safe = threshold_panel["fungal_safe_point"]
    ax_thr.axvline(
        fungal_safe["threshold"],
        color="#475569",
        linewidth=1.1,
        linestyle=":",
        alpha=0.9,
    )
    ax_thr.scatter(
        [fungal_safe["threshold"]],
        [fungal_safe["sensitivity"]],
        color="#dc2626",
        s=38,
        zorder=4,
    )
    ax_thr.scatter(
        [fungal_safe["threshold"]],
        [fungal_safe["specificity"]],
        color="#2563eb",
        s=38,
        zorder=4,
    )
    ax_thr.annotate(
        "Fungal-safe threshold\nSens >= 0.70",
        xy=(fungal_safe["threshold"], fungal_safe["sensitivity"]),
        xytext=(8, 6),
        textcoords="offset points",
        ha="left",
        va="bottom",
        fontsize=8.6,
        color="#334155",
    )
    ax_thr.set_xlim(-0.02, 1.02)
    ax_thr.set_ylim(-0.02, 1.02)
    ax_thr.set_xlabel("Global probability threshold")
    ax_thr.set_ylabel("Metric value")
    ax_thr.set_title("B. DINOv2 lesion retrieval threshold sweep", fontsize=12.5, loc="left")
    style_axes(ax_thr)
    ax_thr.legend(loc="lower left", frameon=False, fontsize=8.8)

    ax_tbl.axis("off")
    current = threshold_panel["current_point"]
    high_sens = threshold_panel["high_sensitivity_point"]
    cell_text = [
        [
            "Current",
            f"{current['threshold']:.3f}",
            f"{current['sensitivity']:.3f}",
            f"{current['specificity']:.3f}",
            f"{current['balanced_accuracy']:.3f}",
        ],
        [
            "Fungal-safe",
            f"{fungal_safe['threshold']:.3f}",
            f"{fungal_safe['sensitivity']:.3f}",
            f"{fungal_safe['specificity']:.3f}",
            f"{fungal_safe['balanced_accuracy']:.3f}",
        ],
        [
            "High-sens",
            f"{high_sens['threshold']:.3f}",
            f"{high_sens['sensitivity']:.3f}",
            f"{high_sens['specificity']:.3f}",
            f"{high_sens['balanced_accuracy']:.3f}",
        ],
    ]
    table = ax_tbl.table(
        cellText=cell_text,
        colLabels=["Operating point", "Thr", "Sens", "Spec", "Bal Acc"],
        cellLoc="center",
        rowLoc="center",
        loc="center",
        bbox=[-0.08, 0.00, 1.08, 0.82],
        colWidths=[0.50, 0.12, 0.12, 0.12, 0.14],
    )
    table.auto_set_font_size(False)
    table.set_fontsize(7.95)
    for (row, col), cell in table.get_celld().items():
        cell.set_edgecolor("#cbd5e1")
        cell.set_linewidth(0.8)
        if row == 0:
            cell.set_facecolor("#e2e8f0")
            cell.set_text_props(weight="bold", color="#0f172a")
        elif col == 0:
            cell.set_facecolor("#f8fafc")
            cell.set_text_props(color="#0f172a")
    return save_figure(fig, output_dir, "figure3_oof_visit_level_roc")


def write_summary_csv(results: list[dict[str, Any]], output_dir: Path) -> Path:
    csv_path = output_dir / "summary.csv"
    fieldnames = [
        "name",
        "label",
        "completed_folds",
        "n_test_predictions",
        "oof_auc",
        "auc_ci_low",
        "auc_ci_high",
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
                    "auc_ci_low": f"{item['auc_ci_low']:.6f}",
                    "auc_ci_high": f"{item['auc_ci_high']:.6f}",
                    "test_auroc_mean": f"{item['test_auroc_mean']:.6f}",
                    "test_auroc_std": f"{item['test_auroc_std']:.6f}",
                    "test_bal_acc_mean": f"{item['test_bal_acc_mean']:.6f}",
                    "test_bal_acc_std": f"{item['test_bal_acc_std']:.6f}",
                    "fold_result_paths": "; ".join(fold["result_path"] for fold in item["fold_items"]),
                }
            )
    return csv_path


def write_threshold_csv(threshold_panel: dict[str, Any], output_dir: Path) -> Path:
    csv_path = output_dir / "threshold_operating_points.csv"
    fieldnames = [
        "label",
        "threshold",
        "sensitivity",
        "specificity",
        "balanced_accuracy",
        "accuracy",
    ]
    rows = [
        threshold_panel["current_point"],
        threshold_panel["fungal_safe_point"],
        threshold_panel["high_sensitivity_point"],
    ]
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(
                {
                    "label": row["label"],
                    "threshold": f"{row['threshold']:.6f}",
                    "sensitivity": f"{row['sensitivity']:.6f}",
                    "specificity": f"{row['specificity']:.6f}",
                    "balanced_accuracy": f"{row['balanced_accuracy']:.6f}",
                    "accuracy": f"{row['accuracy']:.6f}",
                }
            )
    return csv_path


def write_html(output_dir: Path, summary_csv: Path, threshold_csv: Path, png_path: Path) -> Path:
    html_path = output_dir / "figures.html"
    html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Figure 3 — ROC and Threshold Sweep</title>
  <style>
    body {{ font-family: Arial, sans-serif; margin: 24px; color: #111827; }}
    img {{ max-width: 100%; height: auto; border: 1px solid #cbd5e1; }}
    a {{ color: #1d4ed8; }}
  </style>
</head>
<body>
  <h1>Figure 3 — ROC and Threshold Sweep</h1>
  <p><a href="{summary_csv.name}">{summary_csv.name}</a> |
     <a href="{threshold_csv.name}">{threshold_csv.name}</a></p>
  <p><img src="{png_path.name}" alt="Figure 3 ROC and threshold sweep"></p>
</body>
</html>
"""
    html_path.write_text(html, encoding="utf-8")
    return html_path


def main() -> int:
    args = parse_args()
    cv_root = args.cv_root.expanduser().resolve()
    output_dir = args.out_dir.expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    results = [
        collect_model_rows(
            cv_root,
            spec,
            bootstrap_iters=args.bootstrap_iters,
            seed=args.seed,
        )
        for spec in MODEL_SPECS
    ]
    threshold_panel = collect_threshold_panel_data(cv_root, THRESHOLD_COMPONENT)

    summary_csv = write_summary_csv(results, output_dir)
    threshold_csv = write_threshold_csv(threshold_panel, output_dir)
    png_path, svg_path = build_figure(results, threshold_panel, output_dir)
    html_path = write_html(output_dir, summary_csv, threshold_csv, png_path)

    print(f"PNG: {png_path}")
    print(f"SVG: {svg_path}")
    print(f"Summary CSV: {summary_csv}")
    print(f"Threshold CSV: {threshold_csv}")
    print(f"HTML: {html_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
