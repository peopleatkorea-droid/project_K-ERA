from __future__ import annotations

import argparse
import csv
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Patch
import numpy as np
from PIL import Image


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CANDIDATE_CSV = REPO_ROOT / "artifacts" / "figure_candidates" / "p101_dinov2_image_preprocessing_top_cases.csv"
DEFAULT_OUT_DIR = REPO_ROOT / "artifacts" / "paper_figures" / "p101_dinov2_preprocessing_case_panel_20260403"

COLUMN_SPECS = [
    ("full_image_path", "Original"),
    ("cornea_image_path", "Corneal ROI"),
    ("lesion_image_path", "Lesion Crop"),
]

PRED_COLORS = {
    True: "#16a34a",
    False: "#dc2626",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export a case-based figure comparing DINOv2 preprocessing variants (original/ROI/lesion)."
    )
    parser.add_argument("--candidate-csv", type=Path, default=DEFAULT_CANDIDATE_CSV)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument("--fungal-ranks", nargs="*", type=int, default=[1, 2])
    parser.add_argument("--bacterial-ranks", nargs="*", type=int, default=[1])
    parser.add_argument(
        "--minimal",
        action="store_true",
        help="Use a caption-centric submission style with no figure title/footer copy.",
    )
    return parser.parse_args()


def load_rows(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def select_rows(
    rows: list[dict[str, str]],
    *,
    fungal_ranks: list[int],
    bacterial_ranks: list[int],
) -> list[dict[str, str]]:
    selected: list[dict[str, str]] = []
    for group_name, ranks in (
        ("fungal_rescue", fungal_ranks),
        ("bacterial_failure", bacterial_ranks),
    ):
        group_rows = [row for row in rows if str(row.get("panel_group") or "") == group_name]
        index = {int(row["rank"]): row for row in group_rows}
        for rank in ranks:
            row = index.get(int(rank))
            if row is None:
                raise ValueError(f"Missing candidate row for group={group_name!r}, rank={rank}.")
            selected.append(row)
    return selected


def load_and_pad_image(path: Path, *, size: tuple[int, int] = (420, 320)) -> np.ndarray:
    image = Image.open(path).convert("RGB")
    image.thumbnail(size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", size, color=(255, 255, 255))
    offset_x = (size[0] - image.width) // 2
    offset_y = (size[1] - image.height) // 2
    canvas.paste(image, (offset_x, offset_y))
    return np.asarray(canvas)


def bool_from_row(value: str | None) -> bool:
    return str(value or "").strip().lower() == "true"


def save_selected_csv(path: Path, rows: list[dict[str, str]]) -> None:
    if not rows:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def build_figure(
    rows: list[dict[str, str]],
    output_dir: Path,
    *,
    minimal: bool = False,
) -> tuple[Path, Path]:
    n_rows = len(rows)
    fig = plt.figure(figsize=(14.0, 4.9 * n_rows))
    gs = fig.add_gridspec(n_rows, 4, width_ratios=[1.45, 1.0, 1.0, 1.0], hspace=0.34, wspace=0.1)

    for row_index, row in enumerate(rows):
        group = str(row["panel_group"])
        true_label = str(row["true_label"])
        case_title = "Fungal case" if group == "fungal_rescue" else "Bacterial case"
        sidebar = fig.add_subplot(gs[row_index, 0])
        sidebar.axis("off")
        sidebar.text(0.0, 0.94, case_title, fontsize=18, fontweight="bold", va="top")
        if minimal:
            sidebar.text(
                0.0,
                0.76,
                f"Case {row_index + 1}\nHeld-out test case",
                fontsize=12.5,
                va="top",
                linespacing=1.4,
            )
        else:
            sidebar.text(
                0.0,
                0.76,
                f"Case {row_index + 1}\nPatient {row['patient_id']}\nVisit {row['visit_date']}\nFold {row['fold']}",
                fontsize=12.5,
                va="top",
                linespacing=1.4,
            )
        sidebar.text(
            0.0,
            0.46,
            f"True label: {true_label.title()}",
            fontsize=13,
            fontweight="bold",
            color="#0f172a",
            va="top",
        )

        row_axes: list[plt.Axes] = []
        for col_index, (path_key, title) in enumerate(COLUMN_SPECS, start=1):
            ax = fig.add_subplot(gs[row_index, col_index])
            row_axes.append(ax)
            image_path = Path(row[path_key])
            ax.imshow(load_and_pad_image(image_path))
            ax.set_xticks([])
            ax.set_yticks([])
            pred_key = f"{'full' if path_key.startswith('full') else 'cornea' if path_key.startswith('cornea') else 'lesion'}_pred"
            prob_key = f"{'full' if path_key.startswith('full') else 'cornea' if path_key.startswith('cornea') else 'lesion'}_prob"
            pred_label = str(row[pred_key])
            prob = float(row[prob_key])
            is_correct = pred_label == true_label
            border_color = PRED_COLORS[is_correct]
            for spine in ax.spines.values():
                spine.set_visible(True)
                spine.set_linewidth(4.0)
                spine.set_edgecolor(border_color)
            ax.set_title(title, fontsize=13, fontweight="bold", pad=10)
            lines = [
                f"P(fungal) = {prob:.3f}",
                f"Pred: {pred_label.title()}",
            ]
            if path_key == "lesion_image_path":
                delta_l_vs_f = float(row["delta_l_vs_f"])
                delta_l_vs_c = float(row["delta_l_vs_c"])
                lines.append(f"Δ vs Original: {delta_l_vs_f:+.3f}")
                lines.append(f"Δ vs ROI: {delta_l_vs_c:+.3f}")
            ax.text(
                0.5,
                -0.15,
                "\n".join(lines),
                transform=ax.transAxes,
                fontsize=10.5,
                va="top",
                ha="center",
                color="#0f172a",
                clip_on=False,
            )

        left_box = row_axes[0].get_position()
        mid_box = row_axes[1].get_position()
        right_box = row_axes[2].get_position()
        arrow_y = left_box.y1 + 0.008
        fig.text((left_box.x1 + mid_box.x0) / 2.0, arrow_y, "→", fontsize=24, ha="center", va="bottom", color="#64748b")
        fig.text((mid_box.x1 + right_box.x0) / 2.0, arrow_y, "→", fontsize=24, ha="center", va="bottom", color="#64748b")

    if not minimal:
        fig.suptitle(
            "Case-Based Comparison of DINOv2 Preprocessing Variants",
            fontsize=20,
            fontweight="bold",
            y=0.995,
        )
        fig.text(
            0.5,
            0.018,
            "Lesion-centered preprocessing can reverse model decisions by focusing on disease-relevant regions.",
            ha="center",
            fontsize=12,
            color="#0f172a",
            fontweight="bold",
        )
        fig.text(
            0.5,
            0.004,
            "Green border: correct prediction. Red border: incorrect prediction.",
            ha="center",
            fontsize=11,
            color="#334155",
        )
    legend = [
        Patch(facecolor="#16a34a", edgecolor="#16a34a", label="Correct"),
        Patch(facecolor="#dc2626", edgecolor="#dc2626", label="Incorrect"),
    ]
    legend_y = 0.985 if not minimal else 0.992
    fig.legend(handles=legend, loc="upper right", bbox_to_anchor=(0.985, legend_y), frameon=False, ncol=2, fontsize=11.5)

    output_dir.mkdir(parents=True, exist_ok=True)
    png_path = output_dir / "figure_case_preprocessing_comparison.png"
    svg_path = output_dir / "figure_case_preprocessing_comparison.svg"
    fig.savefig(png_path, dpi=220, bbox_inches="tight")
    fig.savefig(svg_path, bbox_inches="tight")
    plt.close(fig)
    return png_path, svg_path


def write_html(output_dir: Path, selected_csv: Path, png_path: Path) -> Path:
    html_path = output_dir / "figures.html"
    html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>DINOv2 Preprocessing Case Panel</title>
  <style>
    body {{ font-family: Arial, sans-serif; margin: 24px; color: #111827; }}
    img {{ max-width: 100%; height: auto; border: 1px solid #cbd5e1; }}
    a {{ color: #1d4ed8; }}
  </style>
</head>
<body>
  <h1>DINOv2 Preprocessing Case Panel</h1>
  <p>Selected cases CSV: <a href="{selected_csv.name}">{selected_csv.name}</a></p>
  <p><img src="{png_path.name}" alt="DINOv2 preprocessing case panel"></p>
</body>
</html>
"""
    html_path.write_text(html, encoding="utf-8")
    return html_path


def main() -> int:
    args = parse_args()
    rows = load_rows(args.candidate_csv.expanduser().resolve())
    selected = select_rows(
        rows,
        fungal_ranks=[int(value) for value in args.fungal_ranks],
        bacterial_ranks=[int(value) for value in args.bacterial_ranks],
    )
    output_dir = args.out_dir.expanduser().resolve()
    selected_csv = output_dir / "selected_cases.csv"
    save_selected_csv(selected_csv, selected)
    png_path, svg_path = build_figure(selected, output_dir, minimal=bool(args.minimal))
    html_path = write_html(output_dir, selected_csv, png_path)
    print(f"PNG: {png_path}")
    print(f"SVG: {svg_path}")
    print(f"Selected CSV: {selected_csv}")
    print(f"HTML: {html_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
