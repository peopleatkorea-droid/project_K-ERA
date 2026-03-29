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


PLAN_ROOT_DEFAULT = Path("artifacts") / "weekend_plans" / "transformer_weekend_plan_20260326_172929"

BACKBONES = ["vit", "dinov2", "swin"]
BACKBONE_LABEL = {
    "vit": "ViT",
    "dinov2": "DINOv2",
    "swin": "Swin",
}
STAGE_LABEL = {
    "baseline": "Baseline",
    "linear_probe": "SSL Linear",
    "partial_ft": "SSL Partial",
    "full_ft": "SSL Full",
    "direct": "Direct Final",
    "lgf": "LGF Final",
}
COLORS = {
    "baseline": "#0f172a",
    "linear_probe": "#60a5fa",
    "partial_ft": "#38bdf8",
    "full_ft": "#2563eb",
    "direct": "#16a34a",
    "lgf": "#7c3aed",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export paper-ready figures for the weekend transformer experiment.")
    parser.add_argument("--plan-root", type=Path, default=PLAN_ROOT_DEFAULT, help="Weekend plan root directory.")
    parser.add_argument("--out-dir", type=Path, default=None, help="Optional output directory. Defaults to <plan-root>/paper_figures.")
    parser.add_argument(
        "--dinov2-baseline-auroc",
        type=float,
        default=0.557,
        help="External 62-patient DINOv2 baseline AUROC to use in the comparison figures.",
    )
    return parser.parse_args()


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def load_stage_result(plan_root: Path, stage_id: str) -> dict[str, Any]:
    path = plan_root / "downstream" / stage_id / "result.json"
    payload = read_json(path)
    payload["_path"] = str(path)
    return payload


def parse_eval_result(stage_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    result = payload["result"]
    test_metrics = result.get("test_metrics") or {}
    if stage_id.endswith("baseline_full"):
        backbone = stage_id.split("_baseline_full")[0]
        variant = "baseline"
    elif stage_id.endswith("ssl_linear_probe"):
        backbone = stage_id.split("_ssl_linear_probe")[0]
        variant = "linear_probe"
    elif stage_id.endswith("ssl_partial_ft"):
        backbone = stage_id.split("_ssl_partial_ft")[0]
        variant = "partial_ft"
    elif stage_id.endswith("ssl_full_ft_low_lr"):
        backbone = stage_id.split("_ssl_full_ft_low_lr")[0]
        variant = "full_ft"
    elif stage_id.endswith("ssl_full_ft"):
        backbone = stage_id.split("_ssl_full_ft")[0]
        variant = "full_ft"
    else:
        raise ValueError(f"Unsupported eval stage id: {stage_id}")
    return {
        "stage_id": stage_id,
        "backbone": backbone,
        "variant": variant,
        "label": STAGE_LABEL[variant],
        "best_val_acc": float(result.get("best_val_acc") or 0.0),
        "test_acc": float(test_metrics.get("accuracy") or 0.0),
        "test_auroc": float(test_metrics.get("AUROC") or 0.0),
        "test_bal_acc": float(test_metrics.get("balanced_accuracy") or 0.0),
        "epochs_completed": int(result.get("epochs_completed") or len(result.get("history") or [])),
        "stopped_early": bool(result.get("stopped_early") or False),
        "path": payload["_path"],
    }


def parse_final_result(stage_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    result = payload["result"]
    variant = "lgf" if stage_id.endswith("_lgf") else "direct"
    backbone = stage_id.split("_final_")[0]
    return {
        "stage_id": stage_id,
        "backbone": backbone,
        "variant": variant,
        "label": STAGE_LABEL[variant],
        "selected_from_stage_id": payload.get("selected_from_stage_id"),
        "fine_tuning_mode": result.get("fine_tuning_mode"),
        "best_train_loss": float(result.get("best_train_loss") or 0.0),
        "epochs_completed": int(result.get("epochs_completed") or len(result.get("history") or [])),
        "stopped_early": bool(result.get("stopped_early") or False),
        "n_train_patients": int(result.get("n_train_patients") or 0),
        "n_train": int(result.get("n_train") or 0),
        "path": payload["_path"],
    }


def style_axes(ax: plt.Axes, *, grid_axis: str = "y") -> None:
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(axis=grid_axis, alpha=0.2, linestyle="--", linewidth=0.8)


def save_figure(fig: plt.Figure, out_dir: Path, stem: str) -> tuple[Path, Path]:
    svg_path = out_dir / f"{stem}.svg"
    png_path = out_dir / f"{stem}.png"
    fig.savefig(svg_path, bbox_inches="tight")
    fig.savefig(png_path, dpi=220, bbox_inches="tight")
    plt.close(fig)
    return svg_path, png_path


def build_ssl_effect_figure(eval_rows: list[dict[str, Any]], out_dir: Path, *, dinov2_baseline_auroc: float) -> tuple[Path, Path]:
    fig, axes = plt.subplots(1, 3, figsize=(14.5, 4.9), sharey=True)
    ssl_order = ["baseline", "linear_probe", "partial_ft", "full_ft"]
    for ax, backbone in zip(axes, BACKBONES):
        rows = [row for row in eval_rows if row["backbone"] == backbone]
        rows_by_variant = {row["variant"]: row for row in rows}
        variants = []
        values = []
        colors = []
        for variant in ssl_order:
            if backbone == "dinov2" and variant == "baseline":
                variants.append(STAGE_LABEL[variant])
                values.append(dinov2_baseline_auroc)
                colors.append(COLORS[variant])
                continue
            row = rows_by_variant.get(variant)
            if row is None:
                continue
            variants.append(row["label"])
            values.append(row["test_auroc"])
            colors.append(COLORS[variant])
        x = np.arange(len(variants))
        bars = ax.bar(x, values, color=colors, edgecolor="#0f172a", linewidth=0.5)
        for bar, value in zip(bars, values):
            ax.text(bar.get_x() + bar.get_width() / 2, value + 0.01, f"{value:.3f}", ha="center", va="bottom", fontsize=8)
        ax.set_xticks(x)
        ax.set_xticklabels(variants, rotation=20, ha="right")
        ax.set_ylim(0.4, 0.8)
        ax.set_title(BACKBONE_LABEL[backbone], fontweight="bold")
        style_axes(ax)
    axes[0].set_ylabel("Test AUROC")
    fig.suptitle("Figure 1. SSL effect comparison on the 62-patient held-out split", fontweight="bold", y=1.02)
    fig.text(
        0.02,
        0.01,
        "DINOv2 baseline AUROC uses the latest 62-patient benchmark value provided outside the weekend run. "
        "Higher is better.",
        fontsize=9,
        color="#475569",
    )
    return save_figure(fig, out_dir, "figure_1_ssl_effect_comparison")


def build_backbone_conclusion_figure(eval_rows: list[dict[str, Any]], out_dir: Path, *, dinov2_baseline_auroc: float) -> tuple[Path, Path]:
    best_ssl_rows: dict[str, dict[str, Any]] = {}
    baseline_scores = {
        "vit": next(row for row in eval_rows if row["backbone"] == "vit" and row["variant"] == "baseline")["test_auroc"],
        "dinov2": dinov2_baseline_auroc,
        "swin": next(row for row in eval_rows if row["backbone"] == "swin" and row["variant"] == "baseline")["test_auroc"],
    }
    for backbone in BACKBONES:
        candidates = [row for row in eval_rows if row["backbone"] == backbone and row["variant"] != "baseline"]
        best_ssl_rows[backbone] = max(candidates, key=lambda row: row["test_auroc"])

    fig, (ax_plot, ax_note) = plt.subplots(
        1,
        2,
        figsize=(12.8, 5.3),
        gridspec_kw={"width_ratios": [1.25, 1]},
    )
    y = np.arange(len(BACKBONES))
    ax_plot.axvline(0.5, color="#cbd5e1", linestyle="--", linewidth=0.8)
    for idx, backbone in enumerate(BACKBONES):
        baseline = baseline_scores[backbone]
        best_ssl = best_ssl_rows[backbone]["test_auroc"]
        ax_plot.plot([baseline, best_ssl], [idx, idx], color="#94a3b8", linewidth=2.0)
        ax_plot.scatter([baseline], [idx], color=COLORS["baseline"], s=90, zorder=3)
        ax_plot.scatter([best_ssl], [idx], color=COLORS["full_ft"], s=90, zorder=3)
        delta = best_ssl - baseline
        ax_plot.text(max(baseline, best_ssl) + 0.008, idx, f"{delta:+.3f}", va="center", fontsize=9)
    ax_plot.set_yticks(y)
    ax_plot.set_yticklabels([BACKBONE_LABEL[item] for item in BACKBONES])
    ax_plot.set_xlim(0.45, 0.74)
    ax_plot.set_xlabel("Test AUROC")
    ax_plot.set_title("Best SSL candidate vs baseline", fontweight="bold")
    style_axes(ax_plot, grid_axis="x")

    ax_note.axis("off")
    note_lines = []
    for backbone in BACKBONES:
        delta = best_ssl_rows[backbone]["test_auroc"] - baseline_scores[backbone]
        if delta > 0.015:
            verdict = "Small gain"
        elif delta < -0.015:
            verdict = "Clear drop"
        else:
            verdict = "Little change"
        note_lines.append(
            f"{BACKBONE_LABEL[backbone]}: {verdict}\n"
            f"baseline {baseline_scores[backbone]:.3f} -> best SSL {best_ssl_rows[backbone]['test_auroc']:.3f}\n"
            f"best stage: {best_ssl_rows[backbone]['stage_id']}"
        )
    ax_note.text(
        0.0,
        1.0,
        "Figure 2. Weekend experiment message\n\n" + "\n\n".join(note_lines),
        ha="left",
        va="top",
        fontsize=10.5,
        color="#0f172a",
    )
    return save_figure(fig, out_dir, "figure_2_backbone_conclusion")


def build_final_outputs_figure(final_rows: list[dict[str, Any]], out_dir: Path) -> tuple[Path, Path]:
    fig, (ax_bar, ax_meta) = plt.subplots(
        2,
        1,
        figsize=(12.5, 7.8),
        gridspec_kw={"height_ratios": [1.7, 1]},
    )
    x = np.arange(len(BACKBONES))
    width = 0.34
    direct_values = []
    lgf_values = []
    for backbone in BACKBONES:
        direct_row = next(row for row in final_rows if row["backbone"] == backbone and row["variant"] == "direct")
        lgf_row = next(row for row in final_rows if row["backbone"] == backbone and row["variant"] == "lgf")
        direct_values.append(direct_row["best_train_loss"])
        lgf_values.append(lgf_row["best_train_loss"])
    bars_direct = ax_bar.bar(x - width / 2, direct_values, width, color=COLORS["direct"], edgecolor="#0f172a", linewidth=0.5, label="Direct")
    bars_lgf = ax_bar.bar(x + width / 2, lgf_values, width, color=COLORS["lgf"], edgecolor="#0f172a", linewidth=0.5, label="LGF")
    for bars in (bars_direct, bars_lgf):
        for bar in bars:
            value = bar.get_height()
            ax_bar.text(bar.get_x() + bar.get_width() / 2, value + 0.01, f"{value:.3f}", ha="center", va="bottom", fontsize=8)
    ax_bar.set_xticks(x)
    ax_bar.set_xticklabels([BACKBONE_LABEL[item] for item in BACKBONES])
    ax_bar.set_ylabel("Best train loss")
    ax_bar.set_title("Figure 3. Final direct/LGF model outputs (all-case refit)", fontweight="bold")
    style_axes(ax_bar)
    ax_bar.legend(frameon=False, loc="upper right")

    ax_meta.axis("off")
    blocks = []
    for backbone in BACKBONES:
        direct_row = next(row for row in final_rows if row["backbone"] == backbone and row["variant"] == "direct")
        lgf_row = next(row for row in final_rows if row["backbone"] == backbone and row["variant"] == "lgf")
        blocks.append(
            f"{BACKBONE_LABEL[backbone]}\n"
            f"Direct: {direct_row['selected_from_stage_id']} / {direct_row['fine_tuning_mode']} / loss {direct_row['best_train_loss']:.3f}\n"
            f"LGF: {lgf_row['selected_from_stage_id']} / {lgf_row['fine_tuning_mode']} / loss {lgf_row['best_train_loss']:.3f}"
        )
    ax_meta.text(
        0.0,
        1.0,
        "All final models were refit on the full 62-patient dataset without a holdout split.\n\n" + "\n\n".join(blocks),
        ha="left",
        va="top",
        fontsize=10,
        color="#0f172a",
    )
    return save_figure(fig, out_dir, "figure_3_final_outputs")


def write_csv(path: Path, rows: list[dict[str, Any]], fieldnames: list[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key) for key in fieldnames})


def write_html(
    out_dir: Path,
    *,
    figure_paths: list[tuple[str, Path, Path]],
    eval_rows: list[dict[str, Any]],
    final_rows: list[dict[str, Any]],
) -> Path:
    best_ssl = {
        backbone: max(
            [row for row in eval_rows if row["backbone"] == backbone and row["variant"] != "baseline"],
            key=lambda row: row["test_auroc"],
        )
        for backbone in BACKBONES
    }
    lines = [
        "<!doctype html>",
        "<html lang='ko'><head><meta charset='utf-8'>",
        "<title>Weekend Transformer Figures</title>",
        "<style>body{font-family:Arial,sans-serif;margin:32px;color:#0f172a} img{max-width:100%;height:auto;border:1px solid #cbd5e1;border-radius:10px} .grid{display:grid;gap:28px} .card{padding:20px;border:1px solid #e2e8f0;border-radius:14px;background:#fff} code{background:#f8fafc;padding:2px 6px;border-radius:6px}</style>",
        "</head><body>",
        "<h1>Weekend Transformer Experiment Figures</h1>",
        "<p>63-patient / 179-visit / 570-image weekend run summary.</p>",
        "<div class='grid'>",
    ]
    for title, png_path, svg_path in figure_paths:
        lines.extend(
            [
                "<div class='card'>",
                f"<h2>{title}</h2>",
                f"<p><img src='{png_path.name}' alt='{title}'></p>",
                f"<p>PNG: <code>{png_path.name}</code><br>SVG: <code>{svg_path.name}</code></p>",
                "</div>",
            ]
        )
    lines.extend(
        [
            "<div class='card'>",
            "<h2>Summary</h2>",
            "<ul>",
            f"<li>ViT best SSL stage: <code>{best_ssl['vit']['stage_id']}</code> (AUROC {best_ssl['vit']['test_auroc']:.3f})</li>",
            f"<li>DINOv2 best SSL stage: <code>{best_ssl['dinov2']['stage_id']}</code> (AUROC {best_ssl['dinov2']['test_auroc']:.3f})</li>",
            f"<li>Swin best SSL stage: <code>{best_ssl['swin']['stage_id']}</code> (AUROC {best_ssl['swin']['test_auroc']:.3f})</li>",
            "<li>Final direct/LGF models are all-case refits and do not include a new holdout evaluation split.</li>",
            "</ul>",
            "</div>",
            "</div></body></html>",
        ]
    )
    html_path = out_dir / "weekend_transformer_figures.html"
    html_path.write_text("\n".join(lines), encoding="utf-8")
    return html_path


def main() -> None:
    args = parse_args()
    plan_root = args.plan_root.resolve()
    out_dir = args.out_dir.resolve() if args.out_dir else (plan_root / "paper_figures")
    out_dir.mkdir(parents=True, exist_ok=True)

    eval_stage_ids = [
        "vit_baseline_full",
        "vit_ssl_linear_probe",
        "vit_ssl_partial_ft",
        "vit_ssl_full_ft",
        "dinov2_ssl_linear_probe",
        "dinov2_ssl_partial_ft",
        "dinov2_ssl_full_ft_low_lr",
        "swin_baseline_full",
        "swin_ssl_linear_probe",
        "swin_ssl_partial_ft",
        "swin_ssl_full_ft",
    ]
    final_stage_ids = [
        "vit_final_direct",
        "vit_final_lgf",
        "dinov2_final_direct",
        "dinov2_final_lgf",
        "swin_final_direct",
        "swin_final_lgf",
    ]

    eval_rows = [parse_eval_result(stage_id, load_stage_result(plan_root, stage_id)) for stage_id in eval_stage_ids]
    final_rows = [parse_final_result(stage_id, load_stage_result(plan_root, stage_id)) for stage_id in final_stage_ids]

    write_csv(
        out_dir / "ssl_effect_summary.csv",
        eval_rows,
        ["stage_id", "backbone", "variant", "label", "best_val_acc", "test_acc", "test_auroc", "test_bal_acc", "epochs_completed", "stopped_early", "path"],
    )
    write_csv(
        out_dir / "final_model_summary.csv",
        final_rows,
        ["stage_id", "backbone", "variant", "label", "selected_from_stage_id", "fine_tuning_mode", "best_train_loss", "epochs_completed", "stopped_early", "n_train_patients", "n_train", "path"],
    )

    figure_paths = []
    figure_paths.append(
        ("Figure 1. SSL effect comparison",) + build_ssl_effect_figure(eval_rows, out_dir, dinov2_baseline_auroc=args.dinov2_baseline_auroc)
    )
    figure_paths.append(
        ("Figure 2. Backbone conclusion",) + build_backbone_conclusion_figure(eval_rows, out_dir, dinov2_baseline_auroc=args.dinov2_baseline_auroc)
    )
    figure_paths.append(
        ("Figure 3. Final direct/LGF outputs",) + build_final_outputs_figure(final_rows, out_dir)
    )
    html_path = write_html(out_dir, figure_paths=figure_paths, eval_rows=eval_rows, final_rows=final_rows)

    print(json.dumps({"out_dir": str(out_dir), "html": str(html_path)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
