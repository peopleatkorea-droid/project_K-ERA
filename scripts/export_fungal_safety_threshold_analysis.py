from __future__ import annotations

import argparse
import csv
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CV_ROOT = REPO_ROOT / "artifacts" / "final_white_summary_cv_20260402_p101_5fold"
DEFAULT_OUT_DIR = REPO_ROOT / "artifacts" / "paper_figures" / "fungal_safety_threshold_analysis_20260406"
DEFAULT_COMPONENT = "official_dinov2_retrieval_lesion_crop"


@dataclass(frozen=True)
class PredictionRow:
    fold_name: str
    true_label: int
    positive_probability: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Export fungal-safety threshold sweep analysis from concatenated out-of-fold "
            "visit-level probabilities."
        )
    )
    parser.add_argument("--cv-root", type=Path, default=DEFAULT_CV_ROOT)
    parser.add_argument("--component", default=DEFAULT_COMPONENT)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument(
        "--targets",
        type=float,
        nargs="*",
        default=[0.70, 0.80, 0.90],
        help="Target sensitivity levels for specificity trade-off reporting.",
    )
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


def collect_predictions(cv_root: Path, component: str) -> tuple[list[PredictionRow], list[dict[str, Any]]]:
    rows: list[PredictionRow] = []
    fold_meta: list[dict[str, Any]] = []
    for path in sorted(cv_root.glob(f"fold_*/{component}/result.json")):
        payload = load_json(path)
        result = payload["result"]
        threshold = float(result.get("decision_threshold") or 0.5)
        test_metrics = result.get("test_metrics") or {}
        fold_meta.append(
            {
                "fold_name": path.parents[1].name,
                "result_path": str(path.resolve()),
                "decision_threshold": threshold,
                "test_auroc": float(test_metrics.get("AUROC") or 0.0),
                "test_balanced_accuracy": float(test_metrics.get("balanced_accuracy") or 0.0),
                "test_sensitivity": float(test_metrics.get("sensitivity") or 0.0),
                "test_specificity": float(test_metrics.get("specificity") or 0.0),
            }
        )
        for item in result.get("test_predictions") or []:
            if item.get("true_label") is None or item.get("positive_probability") is None:
                continue
            rows.append(
                PredictionRow(
                    fold_name=path.parents[1].name,
                    true_label=1 if str(item["true_label"]).strip().lower().startswith("fung") else 0,
                    positive_probability=float(item["positive_probability"]),
                )
            )
    if not rows:
        raise RuntimeError(f"No test predictions found for component: {component}")
    return rows, fold_meta


def compute_metrics(y_true: np.ndarray, y_score: np.ndarray, threshold: float) -> dict[str, float]:
    pred = (y_score >= threshold).astype(np.int32)
    tp = int(np.sum((pred == 1) & (y_true == 1)))
    tn = int(np.sum((pred == 0) & (y_true == 0)))
    fp = int(np.sum((pred == 1) & (y_true == 0)))
    fn = int(np.sum((pred == 0) & (y_true == 1)))
    sensitivity = tp / (tp + fn) if (tp + fn) else 0.0
    specificity = tn / (tn + fp) if (tn + fp) else 0.0
    accuracy = (tp + tn) / len(y_true) if len(y_true) else 0.0
    bal_acc = (sensitivity + specificity) / 2.0
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    return {
        "threshold": float(threshold),
        "tp": tp,
        "tn": tn,
        "fp": fp,
        "fn": fn,
        "sensitivity": float(sensitivity),
        "specificity": float(specificity),
        "accuracy": float(accuracy),
        "balanced_accuracy": float(bal_acc),
        "precision": float(precision),
    }


def compute_fold_specific_operating_point(
    cv_root: Path, component: str
) -> dict[str, float]:
    total_tp = total_tn = total_fp = total_fn = 0
    thresholds: list[float] = []
    for path in sorted(cv_root.glob(f"fold_*/{component}/result.json")):
        payload = load_json(path)
        result = payload["result"]
        threshold = float(result.get("decision_threshold") or 0.5)
        thresholds.append(threshold)
        for item in result.get("test_predictions") or []:
            if item.get("true_label") is None or item.get("positive_probability") is None:
                continue
            y = 1 if str(item["true_label"]).strip().lower().startswith("fung") else 0
            score = float(item["positive_probability"])
            pred = 1 if score >= threshold else 0
            if pred == 1 and y == 1:
                total_tp += 1
            elif pred == 1 and y == 0:
                total_fp += 1
            elif pred == 0 and y == 0:
                total_tn += 1
            else:
                total_fn += 1
    sensitivity = total_tp / (total_tp + total_fn)
    specificity = total_tn / (total_tn + total_fp)
    accuracy = (total_tp + total_tn) / (total_tp + total_tn + total_fp + total_fn)
    return {
        "threshold_mean": float(np.mean(np.asarray(thresholds, dtype=np.float64))),
        "threshold_std": float(np.std(np.asarray(thresholds, dtype=np.float64))),
        "tp": total_tp,
        "tn": total_tn,
        "fp": total_fp,
        "fn": total_fn,
        "sensitivity": float(sensitivity),
        "specificity": float(specificity),
        "accuracy": float(accuracy),
        "balanced_accuracy": float((sensitivity + specificity) / 2.0),
    }


def select_target_operating_point(
    sweep_rows: list[dict[str, float]], target_sensitivity: float
) -> dict[str, float]:
    eligible = [row for row in sweep_rows if row["sensitivity"] >= target_sensitivity]
    if not eligible:
        raise RuntimeError(f"No threshold reaches target sensitivity {target_sensitivity:.2f}")
    # Pick the most specific operating point among thresholds that meet the target.
    best = max(eligible, key=lambda row: (row["specificity"], row["balanced_accuracy"], row["threshold"]))
    return dict(best)


def write_sweep_csv(rows: list[dict[str, float]], output_dir: Path) -> Path:
    path = output_dir / "threshold_sweep.csv"
    fieldnames = [
        "threshold",
        "sensitivity",
        "specificity",
        "balanced_accuracy",
        "accuracy",
        "precision",
        "tp",
        "tn",
        "fp",
        "fn",
    ]
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(
                {
                    **{k: row[k] for k in ["tp", "tn", "fp", "fn"]},
                    "threshold": f"{row['threshold']:.6f}",
                    "sensitivity": f"{row['sensitivity']:.6f}",
                    "specificity": f"{row['specificity']:.6f}",
                    "balanced_accuracy": f"{row['balanced_accuracy']:.6f}",
                    "accuracy": f"{row['accuracy']:.6f}",
                    "precision": f"{row['precision']:.6f}",
                }
            )
    return path


def write_operating_points_csv(
    current_point: dict[str, float],
    target_rows: list[dict[str, float]],
    output_dir: Path,
) -> Path:
    path = output_dir / "operating_points.csv"
    fieldnames = [
        "scenario",
        "target_sensitivity",
        "threshold",
        "sensitivity",
        "specificity",
        "balanced_accuracy",
        "accuracy",
        "precision",
        "tp",
        "tn",
        "fp",
        "fn",
    ]
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerow(
            {
                "scenario": "current_fold_specific_validation_thresholds",
                "target_sensitivity": "",
                "threshold": f"{current_point['threshold_mean']:.6f}",
                "sensitivity": f"{current_point['sensitivity']:.6f}",
                "specificity": f"{current_point['specificity']:.6f}",
                "balanced_accuracy": f"{current_point['balanced_accuracy']:.6f}",
                "accuracy": f"{current_point['accuracy']:.6f}",
                "precision": "",
                "tp": current_point["tp"],
                "tn": current_point["tn"],
                "fp": current_point["fp"],
                "fn": current_point["fn"],
            }
        )
        for row in target_rows:
            writer.writerow(
                {
                    "scenario": "global_threshold_target_sensitivity",
                    "target_sensitivity": f"{row['target_sensitivity']:.2f}",
                    "threshold": f"{row['threshold']:.6f}",
                    "sensitivity": f"{row['sensitivity']:.6f}",
                    "specificity": f"{row['specificity']:.6f}",
                    "balanced_accuracy": f"{row['balanced_accuracy']:.6f}",
                    "accuracy": f"{row['accuracy']:.6f}",
                    "precision": f"{row['precision']:.6f}",
                    "tp": row["tp"],
                    "tn": row["tn"],
                    "fp": row["fp"],
                    "fn": row["fn"],
                }
            )
    return path


def write_summary_json(
    output_dir: Path,
    component: str,
    rows: list[PredictionRow],
    fold_meta: list[dict[str, Any]],
    current_point: dict[str, float],
    target_rows: list[dict[str, float]],
) -> Path:
    path = output_dir / "summary.json"
    payload = {
        "component": component,
        "n_predictions": len(rows),
        "n_positive": int(sum(row.true_label for row in rows)),
        "n_negative": int(sum(1 - row.true_label for row in rows)),
        "folds": fold_meta,
        "current_fold_specific_operating_point": current_point,
        "target_sensitivity_operating_points": target_rows,
    }
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return path


def build_figure(
    sweep_rows: list[dict[str, float]],
    current_point: dict[str, float],
    target_rows: list[dict[str, float]],
    output_dir: Path,
) -> tuple[Path, Path]:
    thresholds = np.asarray([row["threshold"] for row in sweep_rows], dtype=np.float64)
    sens = np.asarray([row["sensitivity"] for row in sweep_rows], dtype=np.float64)
    spec = np.asarray([row["specificity"] for row in sweep_rows], dtype=np.float64)
    bal = np.asarray([row["balanced_accuracy"] for row in sweep_rows], dtype=np.float64)

    fig, (ax1, ax2) = plt.subplots(
        1,
        2,
        figsize=(12.2, 5.8),
        gridspec_kw={"width_ratios": [1.85, 1.0]},
    )

    ax1.plot(thresholds, sens, color="#dc2626", linewidth=2.4, label="Sensitivity")
    ax1.plot(thresholds, spec, color="#2563eb", linewidth=2.4, label="Specificity")
    ax1.plot(thresholds, bal, color="#16a34a", linewidth=2.0, linestyle="--", label="Balanced accuracy")
    for target in [row["target_sensitivity"] for row in target_rows]:
        ax1.axhline(target, color="#94a3b8", linewidth=0.9, linestyle=":", alpha=0.7)
    for row in target_rows:
        ax1.scatter(
            row["threshold"],
            row["specificity"],
            color="#2563eb",
            s=36,
            zorder=4,
        )
        ax1.scatter(
            row["threshold"],
            row["sensitivity"],
            color="#dc2626",
            s=36,
            zorder=4,
        )
        ax1.annotate(
            f"Sens {row['target_sensitivity']:.0%}\nThr {row['threshold']:.3f}\nSpec {row['specificity']:.3f}",
            xy=(row["threshold"], row["specificity"]),
            xytext=(6, -2),
            textcoords="offset points",
            fontsize=8.5,
            color="#1f2937",
            ha="left",
            va="top",
        )
    ax1.set_xlim(-0.02, 1.02)
    ax1.set_ylim(-0.02, 1.02)
    ax1.set_xlabel("Global probability threshold")
    ax1.set_ylabel("Metric value")
    ax1.set_title("A. Threshold sweep on concatenated OOF visit probabilities", fontsize=12.5, loc="left")
    style_axes(ax1)
    ax1.legend(loc="lower left", frameon=False)

    ax2.axis("off")
    lines = [
        "B. Operating-point summary",
        "",
        "Current reported operating point",
        "(fold-specific validation thresholds)",
        f"Sensitivity  {current_point['sensitivity']:.3f}",
        f"Specificity  {current_point['specificity']:.3f}",
        f"Bal Acc      {current_point['balanced_accuracy']:.3f}",
        f"Mean thr     {current_point['threshold_mean']:.3f}",
        "",
        "Fungal-safety trade-off",
    ]
    for row in target_rows:
        lines.extend(
            [
                f"Sens >= {row['target_sensitivity']:.0%}",
                f"  threshold   {row['threshold']:.3f}",
                f"  specificity {row['specificity']:.3f}",
                f"  bal acc     {row['balanced_accuracy']:.3f}",
                "",
            ]
        )
    lines.append("Use these rows to frame the model as calibrated screening support,")
    lines.append("rather than autonomous decision-making.")
    ax2.text(
        0.0,
        1.0,
        "\n".join(lines),
        ha="left",
        va="top",
        fontsize=10.2,
        family="monospace",
        color="#0f172a",
    )

    fig.text(
        0.012,
        0.01,
        "Analysis uses concatenated out-of-fold visit-level predictions from Official DINOv2 Retrieval (Lesion Crop).",
        fontsize=9.1,
        color="#475569",
    )
    return save_figure(fig, output_dir, "figure_fungal_safety_threshold_analysis")


def write_html(
    output_dir: Path,
    png_path: Path,
    sweep_csv: Path,
    operating_points_csv: Path,
    summary_json: Path,
) -> Path:
    path = output_dir / "figures.html"
    html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Fungal-Safety Threshold Analysis</title>
  <style>
    body {{ font-family: Arial, sans-serif; margin: 24px; color: #111827; }}
    img {{ max-width: 100%; height: auto; border: 1px solid #cbd5e1; }}
    a {{ color: #1d4ed8; }}
  </style>
</head>
<body>
  <h1>Fungal-Safety Threshold Analysis</h1>
  <p><a href="{sweep_csv.name}">{sweep_csv.name}</a> |
     <a href="{operating_points_csv.name}">{operating_points_csv.name}</a> |
     <a href="{summary_json.name}">{summary_json.name}</a></p>
  <p><img src="{png_path.name}" alt="Fungal-safety threshold analysis"></p>
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

    rows, fold_meta = collect_predictions(cv_root, args.component)
    y_true = np.asarray([row.true_label for row in rows], dtype=np.int32)
    y_score = np.asarray([row.positive_probability for row in rows], dtype=np.float64)

    # Dense sweep for plotting; target operating points are computed from these same rows.
    thresholds = np.linspace(0.0, 1.0, 1001)
    sweep_rows = [compute_metrics(y_true, y_score, float(thr)) for thr in thresholds]

    current_point = compute_fold_specific_operating_point(cv_root, args.component)
    target_rows: list[dict[str, float]] = []
    for target in args.targets:
        row = select_target_operating_point(sweep_rows, target)
        row["target_sensitivity"] = float(target)
        target_rows.append(row)

    sweep_csv = write_sweep_csv(sweep_rows, output_dir)
    operating_points_csv = write_operating_points_csv(current_point, target_rows, output_dir)
    summary_json = write_summary_json(output_dir, args.component, rows, fold_meta, current_point, target_rows)
    png_path, svg_path = build_figure(sweep_rows, current_point, target_rows, output_dir)
    html_path = write_html(output_dir, png_path, sweep_csv, operating_points_csv, summary_json)

    print(f"PNG: {png_path}")
    print(f"SVG: {svg_path}")
    print(f"Sweep CSV: {sweep_csv}")
    print(f"Operating points CSV: {operating_points_csv}")
    print(f"Summary JSON: {summary_json}")
    print(f"HTML: {html_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
