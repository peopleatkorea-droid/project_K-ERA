from __future__ import annotations

import argparse
import csv
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_FINAL_ROOT = REPO_ROOT / "artifacts" / "final_white_summary_cv_20260402_p101_5fold"
DEFAULT_MIL_ROOT = REPO_ROOT / "artifacts" / "mil_backbone_ablation_cv_20260403_p101_5fold"
DEFAULT_OUT_DIR = REPO_ROOT / "artifacts" / "paper_figures" / "figure2_cross_validated_benchmark_20260404"

VISIT_FAMILY_ORDER = [
    "DINOv2 retrieval",
    "DINOv2 attention MIL",
    "CNN-backbone MIL",
    "Retrieval-guided hybrid MIL",
]

FAMILY_DISPLAY = {
    "DINOv2 retrieval": "DINOv2\nretrieval",
    "DINOv2 attention MIL": "DINOv2\nattention MIL",
    "CNN-backbone MIL": "CNN-backbone\nMIL",
    "Retrieval-guided hybrid MIL": "Hybrid\nMIL",
}


MODEL_SPECS: list[dict[str, str]] = [
    {
        "name": "densenet121_cornea",
        "label": "DenseNet121\nCornea ROI",
        "family": "Image classifiers",
        "source": "final",
        "color": "#b45309",
        "cluster": "image",
    },
    {
        "name": "efficientnet_v2_s_full",
        "label": "EfficientNetV2-S\nFull",
        "family": "Image classifiers",
        "source": "final",
        "color": "#2563eb",
        "cluster": "image",
    },
    {
        "name": "convnext_tiny_full",
        "label": "ConvNeXt-Tiny\nFull",
        "family": "Image classifiers",
        "source": "final",
        "color": "#7c3aed",
        "cluster": "image",
    },
    {
        "name": "swin_full",
        "label": "Swin\nFull",
        "family": "Image classifiers",
        "source": "final",
        "color": "#dc2626",
        "cluster": "image",
    },
    {
        "name": "vit_full",
        "label": "ViT\nFull",
        "family": "Image classifiers",
        "source": "final",
        "color": "#ec4899",
        "cluster": "image",
    },
    {
        "name": "official_dinov2_retrieval_lesion_crop",
        "label": "DINOv2 retrieval\nLesion",
        "family": "DINOv2 retrieval",
        "source": "final",
        "color": "#0f766e",
        "cluster": "visit",
    },
    {
        "name": "official_dinov2_retrieval",
        "label": "DINOv2 retrieval\nCornea ROI",
        "family": "DINOv2 retrieval",
        "source": "final",
        "color": "#0f766e",
        "cluster": "visit",
    },
    {
        "name": "official_dinov2_retrieval_full",
        "label": "DINOv2 retrieval\nFull",
        "family": "DINOv2 retrieval",
        "source": "final",
        "color": "#0f766e",
        "cluster": "visit",
    },
    {
        "name": "official_dinov2_mil",
        "label": "DINOv2\nattention MIL",
        "family": "DINOv2 attention MIL",
        "source": "mil",
        "color": "#16a34a",
        "cluster": "visit",
    },
    {
        "name": "convnext_tiny_mil_full",
        "label": "ConvNeXt-Tiny\nMIL (Full)",
        "family": "CNN-backbone MIL",
        "source": "mil",
        "color": "#7c3aed",
        "cluster": "visit",
    },
    {
        "name": "efficientnet_v2_s_mil_full",
        "label": "EfficientNetV2-S\nMIL (Full)",
        "family": "CNN-backbone MIL",
        "source": "mil",
        "color": "#2563eb",
        "cluster": "visit",
    },
    {
        "name": "densenet121_mil_cornea",
        "label": "DenseNet121\nMIL (Cornea)",
        "family": "CNN-backbone MIL",
        "source": "mil",
        "color": "#b45309",
        "cluster": "visit",
    },
    {
        "name": "dinov2_retrieval_guided_lesion_mil_top2",
        "label": "Retrieval-guided\nhybrid MIL",
        "family": "Retrieval-guided hybrid MIL",
        "source": "mil",
        "color": "#7c8d28",
        "cluster": "visit",
    },
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export Figure 2: cross-validated performance and generalization behavior."
    )
    parser.add_argument("--final-root", type=Path, default=DEFAULT_FINAL_ROOT)
    parser.add_argument("--mil-root", type=Path, default=DEFAULT_MIL_ROOT)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    return parser.parse_args()


def read_csv_rows(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def load_summary_map(path: Path) -> dict[str, dict[str, str]]:
    return {row["component_name"]: row for row in read_csv_rows(path)}


def to_float(row: dict[str, str], key: str) -> float:
    return float(row[key])


def build_records(final_root: Path, mil_root: Path) -> list[dict[str, Any]]:
    final_map = load_summary_map(final_root / "aggregate_summary.csv")
    mil_map = load_summary_map(mil_root / "aggregate_summary.csv")

    records: list[dict[str, Any]] = []
    for spec in MODEL_SPECS:
        source_map = final_map if spec["source"] == "final" else mil_map
        row = source_map.get(spec["name"])
        if row is None:
            raise FileNotFoundError(f"Missing summary row for {spec['name']} in {spec['source']} summary.")
        records.append(
            {
                **spec,
                "test_auroc_mean": to_float(row, "test_auroc_mean"),
                "test_auroc_std": to_float(row, "test_auroc_std"),
                "test_bal_acc_mean": to_float(row, "test_bal_acc_mean"),
                "test_bal_acc_std": to_float(row, "test_bal_acc_std"),
                "val_auroc_mean": to_float(row, "val_auroc_mean"),
                "val_auroc_std": to_float(row, "val_auroc_std"),
                "gap_auroc_mean": to_float(row, "val_auroc_mean") - to_float(row, "test_auroc_mean"),
            }
        )
    return records


def save_figure(fig: plt.Figure, out_dir: Path, stem: str) -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    svg_path = out_dir / f"{stem}.svg"
    png_path = out_dir / f"{stem}.png"
    fig.savefig(svg_path, bbox_inches="tight")
    fig.savefig(png_path, dpi=320, bbox_inches="tight")
    plt.close(fig)
    return png_path, svg_path


def style_axes(ax: plt.Axes, *, grid_axis: str = "y") -> None:
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(axis=grid_axis, alpha=0.22, linestyle="--", linewidth=0.8)


def add_group_label(ax: plt.Axes, x0: float, x1: float, text: str, y: float, *, fontsize: float = 10.0) -> None:
    ax.text((x0 + x1) / 2, y, text, ha="center", va="bottom", fontsize=fontsize, fontweight="bold", color="#334155")


def add_bracket(ax: plt.Axes, x0: float, x1: float, y: float, text: str) -> None:
    h = 0.02
    ax.plot([x0, x0, x1, x1], [y, y + h, y + h, y], color="#0f172a", linewidth=1.0, clip_on=False)
    ax.text((x0 + x1) / 2, y + h + 0.005, text, ha="center", va="bottom", fontsize=8.4, color="#0f172a")


def write_summary_csv(records: list[dict[str, Any]], out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "summary.csv"
    fieldnames = [
        "cluster",
        "family",
        "label",
        "source",
        "test_auroc_mean",
        "test_auroc_std",
        "test_bal_acc_mean",
        "test_bal_acc_std",
        "val_auroc_mean",
        "val_auroc_std",
        "gap_auroc_mean",
    ]
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for record in records:
            writer.writerow({key: record[key] for key in fieldnames})
    return path


def export_figure(records: list[dict[str, Any]], out_dir: Path) -> tuple[Path, Path]:
    image_records = sorted(
        [record for record in records if record["cluster"] == "image"],
        key=lambda item: item["test_auroc_mean"],
        reverse=True,
    )
    visit_records: list[dict[str, Any]] = []
    for family in VISIT_FAMILY_ORDER:
        family_records = sorted(
            [record for record in records if record["cluster"] == "visit" and record["family"] == family],
            key=lambda item: item["test_auroc_mean"],
            reverse=True,
        )
        visit_records.extend(family_records)
    ordered = image_records + visit_records

    x_image = np.arange(len(image_records), dtype=float)
    x_visit = np.arange(len(visit_records), dtype=float) + len(image_records) + 1.8
    x_positions = np.concatenate([x_image, x_visit])
    bar_width = 0.34

    fig = plt.figure(figsize=(18.5, 11.0))
    gs = fig.add_gridspec(2, 1, height_ratios=[1.15, 0.95], hspace=0.26)
    ax_perf = fig.add_subplot(gs[0])
    ax_gap = fig.add_subplot(gs[1], sharex=ax_perf)

    colors = [record["color"] for record in ordered]
    auroc = [record["test_auroc_mean"] for record in ordered]
    auroc_err = [record["test_auroc_std"] for record in ordered]
    bal = [record["test_bal_acc_mean"] for record in ordered]
    bal_err = [record["test_bal_acc_std"] for record in ordered]
    gap = [record["gap_auroc_mean"] for record in ordered]

    bars_auroc = ax_perf.bar(
        x_positions - bar_width / 2,
        auroc,
        bar_width,
        color=colors,
        edgecolor="#0f172a",
        linewidth=0.6,
        yerr=auroc_err,
        capsize=3,
        label="Test AUROC",
    )
    bars_bal = ax_perf.bar(
        x_positions + bar_width / 2,
        bal,
        bar_width,
        color=colors,
        edgecolor="#0f172a",
        linewidth=0.6,
        hatch="//",
        alpha=0.84,
        yerr=bal_err,
        capsize=3,
        label="Balanced accuracy",
    )
    ax_perf.axhline(0.5, color="#64748b", linestyle="--", linewidth=1.0)
    ax_perf.axvline(len(image_records) + 0.9, color="#cbd5e1", linestyle=":", linewidth=1.1)
    ax_perf.set_ylim(0.0, 1.0)
    ax_perf.set_ylabel("Mean held-out test score")
    ax_perf.set_title("A  Cross-validated held-out performance", loc="left", fontweight="bold")
    style_axes(ax_perf)
    ax_perf.legend(frameon=False, loc="upper left", bbox_to_anchor=(0.01, 1.13), ncol=2, fontsize=9)
    ax_perf.tick_params(axis="x", which="both", bottom=False, labelbottom=False)

    add_group_label(ax_perf, x_positions[0] - 0.5, x_positions[len(image_records) - 1] + 0.5, "Image-level classifiers", 0.95, fontsize=9.2)
    add_group_label(ax_perf, x_positions[len(image_records)] - 0.5, x_positions[-1] + 0.5, "Visit-level models", 0.95, fontsize=9.2)
    visit_start = len(image_records)
    offset = visit_start
    for family in VISIT_FAMILY_ORDER:
        family_count = sum(1 for record in visit_records if record["family"] == family)
        if family_count == 0:
            continue
        add_group_label(
            ax_perf,
            x_positions[offset] - 0.3,
            x_positions[offset + family_count - 1] + 0.3,
            FAMILY_DISPLAY.get(family, family),
            0.885,
            fontsize=8.2,
        )
        offset += family_count

    retrieval_lesion = next(record for record in records if record["name"] == "official_dinov2_retrieval_lesion_crop")
    retrieval_roi = next(record for record in records if record["name"] == "official_dinov2_retrieval")
    retrieval_full = next(record for record in records if record["name"] == "official_dinov2_retrieval_full")
    delta_vs_roi = retrieval_lesion["test_auroc_mean"] - retrieval_roi["test_auroc_mean"]
    delta_vs_full = retrieval_lesion["test_auroc_mean"] - retrieval_full["test_auroc_mean"]
    add_bracket(
        ax_perf,
        x_positions[len(image_records)] - 0.55,
        x_positions[len(image_records) + 2] + 0.55,
        0.80,
        f"Lesion AUROC gain: +{delta_vs_roi:.3f} vs ROI, +{delta_vs_full:.3f} vs full",
    )

    name_to_index = {record["name"]: idx for idx, record in enumerate(ordered)}
    effnet_img_idx = name_to_index["efficientnet_v2_s_full"]
    effnet_mil_idx = name_to_index["efficientnet_v2_s_mil_full"]
    effnet_img_auroc = auroc[effnet_img_idx]
    effnet_mil_auroc = auroc[effnet_mil_idx]
    effnet_img_bal = bal[effnet_img_idx]
    effnet_mil_bal = bal[effnet_mil_idx]
    ax_gap.bar(
        x_positions,
        gap,
        width=0.62,
        color=colors,
        edgecolor="#0f172a",
        linewidth=0.6,
    )
    ax_gap.axhline(0, color="#0f172a", linewidth=0.9)
    ax_gap.axvline(len(image_records) + 0.9, color="#cbd5e1", linestyle=":", linewidth=1.1)
    for x_pos, value in zip(x_positions, gap, strict=True):
        ax_gap.text(
            x_pos,
            value + (0.008 if value >= 0 else -0.01),
            f"{value:+.3f}",
            ha="center",
            va="bottom" if value >= 0 else "top",
            fontsize=7.5,
            rotation=90,
            color="#334155",
        )
    ax_gap.set_ylim(-0.05, 0.30)
    ax_gap.set_ylabel("Validation-test AUROC gap")
    ax_gap.set_title("B  Generalization gap", loc="left", fontweight="bold")
    ax_gap.set_xticks(x_positions)
    ax_gap.set_xticklabels([record["label"] for record in ordered], rotation=34, ha="right")
    style_axes(ax_gap)

    fig.text(
        0.50,
        0.49,
        (
            f"EffNetV2-S shift: image AUROC {effnet_img_auroc:.3f} -> visit MIL {effnet_mil_auroc:.3f}; "
            f"balanced accuracy {effnet_img_bal:.3f} -> {effnet_mil_bal:.3f}"
        ),
        ha="center",
        va="center",
        fontsize=8.6,
        color="#334155",
        bbox=dict(boxstyle="round,pad=0.22", facecolor="white", edgecolor="#cbd5e1", linewidth=0.8, alpha=0.92),
    )

    fig.text(
        0.012,
        0.012,
        "Panel ordering is identical across A and B. Positive gap values indicate validation AUROC exceeded held-out test AUROC.",
        fontsize=9,
        color="#475569",
    )
    return save_figure(fig, out_dir, "figure2_cross_validated_performance_and_generalization")


def main() -> None:
    args = parse_args()
    records = build_records(args.final_root, args.mil_root)
    write_summary_csv(records, args.out_dir)
    export_figure(records, args.out_dir)


if __name__ == "__main__":
    main()
