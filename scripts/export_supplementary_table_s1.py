from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import datetime
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


DEFAULT_OUTPUT_ROOT = REPO_ROOT / "artifacts" / "paper_tables" / "supplementary_table_s1_20260407"

SOURCE_PATHS = {
    "p101_main": REPO_ROOT / "artifacts" / "final_white_summary_cv_20260402_p101_5fold" / "aggregate_summary.csv",
    "p101_mil": REPO_ROOT / "artifacts" / "mil_backbone_ablation_cv_20260403_p101_5fold" / "aggregate_summary.csv",
    "p101_fusion": REPO_ROOT / "artifacts" / "effnet_dinov2_lesion_mil_cv_20260406_p101_5fold" / "aggregate_summary.csv",
    "p101_effnet_lesion_mil": REPO_ROOT / "artifacts" / "efficientnet_v2_s_mil_lesion_cv_20260407_p101_5fold" / "aggregate_summary.csv",
    "p101_densenet_full_mil": REPO_ROOT / "artifacts" / "densenet121_mil_full_cv_20260407_p101_5fold" / "aggregate_summary.csv",
}


ROW_SPECS: list[dict[str, str]] = [
    {
        "panel": "Panel A — Visit-level exploratory configurations",
        "source": "p101_mil",
        "component_name": "dinov2_retrieval_guided_lesion_mil_top2",
        "model_crop": "Retrieval-Guided MIL (Lesion Top-2)",
        "paradigm": "Hybrid MIL",
        "key_interpretation": "Did not improve over standard DINOv2 lesion retrieval or EfficientNetV2-S MIL (Full).",
    },
    {
        "panel": "Panel A — Visit-level exploratory configurations",
        "source": "p101_fusion",
        "component_name": "efficientnet_v2_s_dinov2_lesion_mil",
        "model_crop": "EfficientNetV2-S + DINOv2 Lesion MIL (Full + Lesion)",
        "paradigm": "Fusion MIL",
        "key_interpretation": "Improved over retrieval-guided lesion MIL, but did not outperform EfficientNetV2-S MIL (Full) or DINOv2 lesion retrieval.",
    },
    {
        "panel": "Panel A — Visit-level exploratory configurations",
        "source": "p101_effnet_lesion_mil",
        "component_name": "efficientnet_v2_s_mil_lesion",
        "model_crop": "EfficientNetV2-S MIL (Lesion Crop)",
        "paradigm": "MIL",
        "key_interpretation": "Underperformed the full-frame EfficientNetV2-S MIL baseline, indicating that lesion-centered benefit was not universal across visit-level MIL.",
    },
    {
        "panel": "Panel A — Visit-level exploratory configurations",
        "source": "p101_densenet_full_mil",
        "component_name": "densenet121_mil_full",
        "model_crop": "DenseNet121 MIL (Full)",
        "paradigm": "MIL",
        "key_interpretation": "Supplementary full-frame DenseNet121 MIL comparator evaluated on the same p101 visit-level split.",
    },
    {
        "panel": "Panel B — Image-level omitted variants",
        "source": "p101_main",
        "component_name": "densenet121_full",
        "model_crop": "DenseNet121 (Full)",
        "paradigm": "CNN",
        "key_interpretation": "Underperformed corneal ROI DenseNet121, supporting cornea-specific input selection for this backbone.",
    },
    {
        "panel": "Panel B — Image-level omitted variants",
        "source": "p101_main",
        "component_name": "official_dinov2_image_retrieval_full",
        "model_crop": "DINOv2 Retrieval (Full)",
        "paradigm": "Retrieval",
        "key_interpretation": "Inferior to lesion-centered DINOv2 retrieval, supporting lesion-focused retrieval.",
    },
    {
        "panel": "Panel B — Image-level omitted variants",
        "source": "p101_main",
        "component_name": "official_dinov2_image_retrieval_cornea",
        "model_crop": "DINOv2 Retrieval (Corneal ROI)",
        "paradigm": "Retrieval",
        "key_interpretation": "Lowest-performing DINOv2 image-level retrieval variant in the p101 white-only benchmark.",
    },
]


OUTPUT_COLUMNS = [
    "Panel",
    "Model (Crop)",
    "Paradigm",
    "Cohort / split",
    "AUROC (mean ± SD)",
    "Bal Acc (mean ± SD)",
    "Sens",
    "Spec",
    "Gen Gap",
    "Key interpretation",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export Supplementary Table S1 from p101 benchmark outputs.")
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    return parser.parse_args()


def load_csv_rows(path: Path) -> dict[str, dict[str, str]]:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    return {str(row["component_name"]): row for row in rows}


def fmt_mean_sd(mean_value: float, std_value: float) -> str:
    return f"{mean_value:.3f} ± {std_value:.3f}"


def fmt_signed(value: float) -> str:
    sign = "+" if value >= 0 else "−"
    return f"{sign}{abs(value):.3f}"


def build_output_row(spec: dict[str, str], source_rows: dict[str, dict[str, str]]) -> dict[str, str] | None:
    row = source_rows.get(spec["component_name"])
    if row is None:
        return None

    val_auroc = float(row["val_auroc_mean"])
    test_auroc = float(row["test_auroc_mean"])
    output = {
        "Panel": spec["panel"],
        "Model (Crop)": spec["model_crop"],
        "Paradigm": spec["paradigm"],
        "Cohort / split": "p101 white-only, patient-disjoint 5-fold CV",
        "AUROC (mean ± SD)": fmt_mean_sd(test_auroc, float(row["test_auroc_std"])),
        "Bal Acc (mean ± SD)": fmt_mean_sd(float(row["test_bal_acc_mean"]), float(row["test_bal_acc_std"])),
        "Sens": f"{float(row['test_sensitivity_mean']):.3f}",
        "Spec": f"{float(row['test_specificity_mean']):.3f}",
        "Gen Gap": fmt_signed(val_auroc - test_auroc),
        "Key interpretation": spec["key_interpretation"],
    }
    return output


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=OUTPUT_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)


def write_markdown(path: Path, rows: list[dict[str, str]], missing_specs: list[dict[str, str]]) -> None:
    lines: list[str] = []
    lines.append("Supplementary Table S1. Additional model configurations evaluated but not carried forward into the primary benchmark.\n")
    current_panel = None
    for row in rows:
        panel = row["Panel"]
        if panel != current_panel:
            if lines and not lines[-1].endswith("\n"):
                lines.append("")
            lines.append(f"**{panel}**\n")
            lines.append("| Model (Crop) | Paradigm | Cohort / split | AUROC (mean ± SD) | Bal Acc (mean ± SD) | Sens | Spec | Gen Gap | Key interpretation |")
            lines.append("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
            current_panel = panel
        lines.append(
            "| "
            + " | ".join(
                [
                    row["Model (Crop)"],
                    row["Paradigm"],
                    row["Cohort / split"],
                    row["AUROC (mean ± SD)"],
                    row["Bal Acc (mean ± SD)"],
                    row["Sens"],
                    row["Spec"],
                    row["Gen Gap"],
                    row["Key interpretation"],
                ]
            )
            + " |"
        )
    if missing_specs:
        lines.append("")
        lines.append("**Pending comparable rows not yet available at export time**")
        for spec in missing_specs:
            lines.append(f"- {spec['model_crop']} ({spec['source']}: {spec['component_name']})")
    lines.append("")
    lines.append(
        "Suggested Discussion sentence: Exploratory lesion-guided MIL and fusion configurations, including "
        "retrieval-guided lesion MIL and full-plus-lesion fusion MIL, did not improve upon the primary benchmark "
        "models (Supplementary Table S1), suggesting that the remaining performance limitation was not primarily "
        "attributable to the specific fusion strategy evaluated."
    )
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    args = parse_args()
    output_root = args.output_root.expanduser().resolve()
    output_root.mkdir(parents=True, exist_ok=True)

    source_rows = {name: load_csv_rows(path) for name, path in SOURCE_PATHS.items()}
    export_rows: list[dict[str, str]] = []
    missing_specs: list[dict[str, str]] = []
    for index, spec in enumerate(ROW_SPECS):
        row = build_output_row(spec, source_rows.get(spec["source"], {}))
        if row is None:
            missing_specs.append({"_order": str(index), **spec})
            continue
        export_rows.append({"_order": str(index), **row})

    panel_order = {
        "Panel A — Visit-level exploratory configurations": 0,
        "Panel B — Image-level omitted variants": 1,
    }
    export_rows.sort(key=lambda item: (panel_order.get(item["Panel"], 99), int(item["_order"])))

    export_rows_for_output = [{key: value for key, value in row.items() if key != "_order"} for row in export_rows]
    write_csv(output_root / "supplementary_table_s1.csv", export_rows_for_output)
    write_markdown(output_root / "supplementary_table_s1.md", export_rows_for_output, missing_specs)
    metadata = {
        "created_at": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "output_root": str(output_root),
        "source_paths": {name: str(path) for name, path in SOURCE_PATHS.items()},
        "exported_rows": len(export_rows_for_output),
        "missing_rows": [
            {
                "panel": spec["panel"],
                "source": spec["source"],
                "component_name": spec["component_name"],
                "model_crop": spec["model_crop"],
            }
            for spec in missing_specs
        ],
    }
    (output_root / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(json.dumps(metadata, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
