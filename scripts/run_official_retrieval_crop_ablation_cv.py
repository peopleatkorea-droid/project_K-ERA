from __future__ import annotations

import argparse
import csv
import json
import math
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = REPO_ROOT / "src"
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from scripts.run_current_model_suite_cv import write_json
from scripts.run_current_model_suite_cv import load_json as load_json_file
from scripts.run_dinov2_visit_retrieval_validation import (
    RetrievalSpec,
    run_experiment as run_visit_retrieval_experiment,
)
from kera_research.services.control_plane import ControlPlaneStore
from kera_research.services.data_plane import SiteStore
from kera_research.services.pipeline import ResearchWorkflowService


DEFAULT_REFERENCE_CV_ROOT = REPO_ROOT / "artifacts" / "current_model_suite_cv_20260330_p73_5fold"
DEFAULT_OUTPUT_ROOT = REPO_ROOT / "artifacts" / "official_retrieval_crop_ablation_cv_20260331"


@dataclass(slots=True)
class AblationSpec:
    name: str
    label: str
    kind: str
    crop_variant: str | None = None
    top_k: int = 10


def utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run official DINOv2 visit-level retrieval crop ablations on the existing 5-fold CV splits."
    )
    parser.add_argument("--site-id", default="39100103")
    parser.add_argument("--device", default="cuda", choices=["cuda", "cpu", "auto"])
    parser.add_argument("--reference-cv-root", type=Path, default=DEFAULT_REFERENCE_CV_ROOT)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--top-k", type=int, default=10)
    parser.add_argument("--force-rerun", action="store_true")
    return parser.parse_args()


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def fold_dir(output_root: Path, fold_index: int) -> Path:
    return output_root / f"fold_{fold_index:02d}"


def result_path(output_root: Path, fold_index: int, experiment_name: str) -> Path:
    return fold_dir(output_root, fold_index) / experiment_name / "result.json"


def status_path(output_root: Path) -> Path:
    return output_root / "status.json"


def summary_path(output_root: Path) -> Path:
    return output_root / "summary.csv"


def aggregate_path(output_root: Path) -> Path:
    return output_root / "aggregate_summary.csv"


def build_status_payload(
    *,
    overall_status: str,
    current_fold: int | None,
    current_experiment: str | None,
    completed: list[str],
    failed: list[str],
    reference_cv_root: Path,
) -> dict[str, Any]:
    return {
        "overall_status": overall_status,
        "current_fold": current_fold,
        "current_experiment": current_experiment,
        "completed": completed,
        "failed": failed,
        "reference_cv_root": str(reference_cv_root),
        "updated_at": utc_now(),
    }


def default_ssl_checkpoint_path() -> str:
    reference_result = load_json_file(
        REPO_ROOT
        / "artifacts"
        / "weekend_plans"
        / "transformer_weekend_plan_20260326_172929"
        / "downstream"
        / "dinov2_ssl_full_ft_low_lr"
        / "result.json"
    )
    result = reference_result.get("result", reference_result)
    ssl_checkpoint_path = str(result.get("ssl_checkpoint_path") or "").strip()
    if not ssl_checkpoint_path:
        raise ValueError("Unable to resolve SSL checkpoint path from the reference result.")
    return ssl_checkpoint_path


def build_specs(top_k: int) -> list[AblationSpec]:
    return [
        AblationSpec(
            name="official_dinov2_retrieval_full",
            label="Official DINOv2 Retrieval (Full Frame)",
            kind="retrieval",
            crop_variant="full",
            top_k=top_k,
        ),
        AblationSpec(
            name="official_dinov2_retrieval_lesion_crop",
            label="Official DINOv2 Retrieval (Lesion Crop)",
            kind="retrieval",
            crop_variant="lesion_crop",
            top_k=top_k,
        ),
        AblationSpec(
            name="official_dinov2_retrieval_cornea_lesion_fusion",
            label="Official DINOv2 Retrieval (Cornea+Lesion Fusion)",
            kind="fusion",
            crop_variant=None,
            top_k=top_k,
        ),
    ]


def summarize_result(result: dict[str, Any], *, fold_index: int, label: str) -> dict[str, Any]:
    val_metrics = result["val_metrics"]
    test_metrics = result["test_metrics"]
    return {
        "fold_index": int(fold_index),
        "name": str(result["name"]),
        "label": label,
        "crop_variant": str(result.get("crop_variant") or ""),
        "fusion_mode": str(result.get("fusion_mode") or ""),
        "n_test_cases": int(result.get("n_test_cases") or 0),
        "val_auroc": float(val_metrics["AUROC"]) if val_metrics.get("AUROC") is not None else None,
        "val_bal_acc": float(val_metrics["balanced_accuracy"]),
        "test_auroc": float(test_metrics["AUROC"]) if test_metrics.get("AUROC") is not None else None,
        "test_bal_acc": float(test_metrics["balanced_accuracy"]),
        "test_acc": float(test_metrics["accuracy"]),
        "test_sensitivity": float(test_metrics["sensitivity"]),
        "test_specificity": float(test_metrics["specificity"]),
        "decision_threshold": float(result["decision_threshold"]),
    }


def mean_std(values: list[float | None]) -> tuple[float | None, float | None]:
    filtered = [float(value) for value in values if value is not None]
    if not filtered:
        return None, None
    count = len(filtered)
    mean_value = sum(filtered) / count
    variance = sum((value - mean_value) ** 2 for value in filtered) / count
    return mean_value, math.sqrt(variance)


def aggregate_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        grouped.setdefault(str(row["name"]), []).append(row)
    aggregate: list[dict[str, Any]] = []
    for name, items in grouped.items():
        first = items[0]
        val_auroc_mean, val_auroc_std = mean_std([item["val_auroc"] for item in items])
        val_bal_mean, val_bal_std = mean_std([item["val_bal_acc"] for item in items])
        test_auroc_mean, test_auroc_std = mean_std([item["test_auroc"] for item in items])
        test_bal_mean, test_bal_std = mean_std([item["test_bal_acc"] for item in items])
        test_acc_mean, test_acc_std = mean_std([item["test_acc"] for item in items])
        sens_mean, sens_std = mean_std([item["test_sensitivity"] for item in items])
        spec_mean, spec_std = mean_std([item["test_specificity"] for item in items])
        aggregate.append(
            {
                "name": name,
                "label": first["label"],
                "crop_variant": first["crop_variant"],
                "fusion_mode": first["fusion_mode"],
                "completed_folds": len(items),
                "val_auroc_mean": round(val_auroc_mean, 6) if val_auroc_mean is not None else None,
                "val_auroc_std": round(val_auroc_std, 6) if val_auroc_std is not None else None,
                "val_bal_acc_mean": round(val_bal_mean, 6) if val_bal_mean is not None else None,
                "val_bal_acc_std": round(val_bal_std, 6) if val_bal_std is not None else None,
                "test_auroc_mean": round(test_auroc_mean, 6) if test_auroc_mean is not None else None,
                "test_auroc_std": round(test_auroc_std, 6) if test_auroc_std is not None else None,
                "test_bal_acc_mean": round(test_bal_mean, 6) if test_bal_mean is not None else None,
                "test_bal_acc_std": round(test_bal_std, 6) if test_bal_std is not None else None,
                "test_acc_mean": round(test_acc_mean, 6) if test_acc_mean is not None else None,
                "test_acc_std": round(test_acc_std, 6) if test_acc_std is not None else None,
                "test_sensitivity_mean": round(sens_mean, 6) if sens_mean is not None else None,
                "test_sensitivity_std": round(sens_std, 6) if sens_std is not None else None,
                "test_specificity_mean": round(spec_mean, 6) if spec_mean is not None else None,
                "test_specificity_std": round(spec_std, 6) if spec_std is not None else None,
            }
        )
    aggregate.sort(key=lambda item: float(item["test_auroc_mean"] or 0.0), reverse=True)
    return aggregate


def audit_retrieval_payload(payload: dict[str, Any]) -> dict[str, Any]:
    result = payload["result"]
    same_patient_neighbors = 0
    same_visit_neighbors = 0
    total_neighbors = 0
    for split_name in ["val_predictions", "test_predictions"]:
        for prediction in result.get(split_name, []):
            query_patient = str(prediction.get("patient_id") or "")
            query_visit = str(prediction.get("visit_date") or "")
            for neighbor in prediction.get("neighbor_visits", []):
                total_neighbors += 1
                if str(neighbor.get("patient_id") or "") == query_patient:
                    same_patient_neighbors += 1
                if str(neighbor.get("patient_id") or "") == query_patient and str(neighbor.get("visit_date") or "") == query_visit:
                    same_visit_neighbors += 1
    return {
        "created_at": utc_now(),
        "name": str(result["name"]),
        "crop_variant": str(result.get("crop_variant") or ""),
        "evaluation_unit": str(result.get("evaluation_unit") or ""),
        "same_patient_exclusion_declared": bool(result.get("same_patient_exclusion", False)),
        "total_neighbors_checked": int(total_neighbors),
        "same_patient_neighbors": int(same_patient_neighbors),
        "same_visit_neighbors": int(same_visit_neighbors),
        "passed": same_patient_neighbors == 0 and same_visit_neighbors == 0,
    }


def fuse_prediction_rows(
    *,
    cornea_rows: list[dict[str, Any]],
    lesion_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    cornea_by_key = {str(row["sample_key"]): row for row in cornea_rows}
    lesion_by_key = {str(row["sample_key"]): row for row in lesion_rows}
    shared_keys = sorted(set(cornea_by_key) & set(lesion_by_key))
    fused_rows: list[dict[str, Any]] = []
    for key in shared_keys:
        cornea = cornea_by_key[key]
        lesion = lesion_by_key[key]
        fused_probability = (float(cornea["positive_probability"]) + float(lesion["positive_probability"])) / 2.0
        fused_rows.append(
            {
                "sample_key": key,
                "sample_kind": str(cornea.get("sample_kind") or lesion.get("sample_kind") or "visit"),
                "patient_id": str(cornea.get("patient_id") or lesion.get("patient_id") or ""),
                "visit_date": str(cornea.get("visit_date") or lesion.get("visit_date") or ""),
                "true_label": str(cornea.get("true_label") or lesion.get("true_label") or ""),
                "true_label_index": int(cornea["true_label_index"]),
                "positive_probability": float(fused_probability),
                "source_image_paths": cornea.get("source_image_paths") or lesion.get("source_image_paths") or [],
                "prepared_image_paths": {
                    "cornea_roi": cornea.get("prepared_image_paths") or [],
                    "lesion_crop": lesion.get("prepared_image_paths") or [],
                },
                "fusion_components": {
                    "cornea_roi_probability": float(cornea["positive_probability"]),
                    "lesion_crop_probability": float(lesion["positive_probability"]),
                },
            }
        )
    return fused_rows


def apply_threshold(rows: list[dict[str, Any]], threshold: float) -> list[dict[str, Any]]:
    fused_rows: list[dict[str, Any]] = []
    for row in rows:
        probability = float(row["positive_probability"])
        predicted_index = 1 if probability >= threshold else 0
        fused_rows.append(
            {
                **row,
                "predicted_label_index": predicted_index,
                "predicted_label": "fungal" if predicted_index == 1 else "bacterial",
                "is_correct": bool(predicted_index == int(row["true_label_index"])),
            }
        )
    return fused_rows


def run_fusion_experiment(
    *,
    workflow: ResearchWorkflowService,
    split: dict[str, Any],
    cornea_payload: dict[str, Any],
    lesion_payload: dict[str, Any],
    top_k: int,
) -> dict[str, Any]:
    cornea_result = cornea_payload["result"]
    lesion_result = lesion_payload["result"]
    val_rows_raw = fuse_prediction_rows(
        cornea_rows=cornea_result["val_predictions"],
        lesion_rows=lesion_result["val_predictions"],
    )
    test_rows_raw = fuse_prediction_rows(
        cornea_rows=cornea_result["test_predictions"],
        lesion_rows=lesion_result["test_predictions"],
    )
    if not val_rows_raw or not test_rows_raw:
        raise RuntimeError("Fusion retrieval did not produce aligned visit predictions.")

    val_true = [int(row["true_label_index"]) for row in val_rows_raw]
    val_prob = [float(row["positive_probability"]) for row in val_rows_raw]
    threshold_selection = workflow.model_manager.select_decision_threshold(val_true, val_prob)
    decision_threshold = float(threshold_selection["decision_threshold"])
    val_rows = apply_threshold(val_rows_raw, decision_threshold)
    test_rows = apply_threshold(test_rows_raw, decision_threshold)
    test_true = [int(row["true_label_index"]) for row in test_rows]
    test_prob = [float(row["positive_probability"]) for row in test_rows]

    val_metrics = workflow.model_manager.classification_metrics(
        val_true,
        [int(row["predicted_label_index"]) for row in val_rows],
        val_prob,
        threshold=decision_threshold,
    )
    test_metrics = workflow.model_manager.classification_metrics(
        test_true,
        [int(row["predicted_label_index"]) for row in test_rows],
        test_prob,
        threshold=decision_threshold,
    )

    return {
        "name": "official_dinov2_retrieval_cornea_lesion_fusion",
        "backbone_source": "official",
        "backbone_reference": str(cornea_result.get("backbone_reference") or ""),
        "crop_variant": "cornea_roi_plus_lesion_crop",
        "fusion_mode": "late_score_average",
        "fusion_inputs": ["cornea_roi", "lesion_crop"],
        "top_k": int(top_k),
        "training_id": "visit_retrieval::official_dinov2_retrieval_cornea_lesion_fusion",
        "evaluation_mode": "fixed_split_visit_level_train_gallery_knn_late_fusion",
        "vote_mode": "average_of_variant_positive_probabilities",
        "same_patient_exclusion": True,
        "decision_threshold": decision_threshold,
        "threshold_selection_metric": threshold_selection["selection_metric"],
        "threshold_selection_metrics": threshold_selection["selection_metrics"],
        "patient_split": split,
        "n_train_images": int(cornea_result.get("n_train_images") or 0),
        "n_val_images": int(cornea_result.get("n_val_images") or 0),
        "n_test_images": int(cornea_result.get("n_test_images") or 0),
        "n_train_cases": int(cornea_result.get("n_train_cases") or 0),
        "n_val_cases": int(cornea_result.get("n_val_cases") or 0),
        "n_test_cases": int(cornea_result.get("n_test_cases") or 0),
        "n_train_patients": int(cornea_result.get("n_train_patients") or 0),
        "n_val_patients": int(cornea_result.get("n_val_patients") or 0),
        "n_test_patients": int(cornea_result.get("n_test_patients") or 0),
        "gallery_cases": int(cornea_result.get("gallery_cases") or 0),
        "evaluation_unit": "visit",
        "val_metrics": val_metrics,
        "test_metrics": test_metrics,
        "val_predictions": val_rows,
        "test_predictions": test_rows,
    }


def main() -> int:
    args = parse_args()
    output_root = args.output_root.expanduser().resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    reference_cv_root = args.reference_cv_root.expanduser().resolve()
    folds_payload = load_json(reference_cv_root / "folds.json")
    folds = [dict(item) for item in folds_payload.get("folds", [])]
    ssl_checkpoint_path = default_ssl_checkpoint_path()
    specs = build_specs(int(args.top_k))

    control_plane = ControlPlaneStore()
    workflow = ResearchWorkflowService(control_plane)
    site_store = SiteStore(args.site_id)
    manifest_records = site_store.generate_manifest().to_dict("records")

    completed: list[str] = []
    failed: list[str] = []
    summary_rows: list[dict[str, Any]] = []
    write_json(
        status_path(output_root),
        build_status_payload(
            overall_status="starting",
            current_fold=None,
            current_experiment=None,
            completed=completed,
            failed=failed,
            reference_cv_root=reference_cv_root,
        ),
    )

    for fold in folds:
        fold_index = int(fold["fold_index"])
        cornea_payload_path = reference_cv_root / f"fold_{fold_index:02d}" / "official_dinov2_retrieval" / "result.json"
        if not cornea_payload_path.exists():
            raise FileNotFoundError(f"Missing reference cornea ROI retrieval result: {cornea_payload_path}")
        cornea_payload = load_json(cornea_payload_path)

        for spec in specs:
            job_name = f"fold{fold_index:02d}__{spec.name}"
            experiment_dir = fold_dir(output_root, fold_index) / spec.name
            result_file = experiment_dir / "result.json"
            audit_file = experiment_dir / "leakage_audit.json"
            if result_file.exists() and not args.force_rerun:
                payload = load_json(result_file)
                summary_rows.append(summarize_result(payload["result"], fold_index=fold_index, label=spec.label))
                completed.append(job_name)
                continue

            write_json(
                status_path(output_root),
                build_status_payload(
                    overall_status="running",
                    current_fold=fold_index,
                    current_experiment=spec.name,
                    completed=completed,
                    failed=failed,
                    reference_cv_root=reference_cv_root,
                ),
            )
            try:
                experiment_dir.mkdir(parents=True, exist_ok=True)
                if spec.kind == "retrieval":
                    result = run_visit_retrieval_experiment(
                        spec=RetrievalSpec(
                            name=spec.name,
                            backbone_source="official",
                            crop_variant=str(spec.crop_variant),
                            top_k=int(spec.top_k),
                        ),
                        workflow=workflow,
                        site_store=site_store,
                        manifest_records=manifest_records,
                        split=fold,
                        output_root=fold_dir(output_root, fold_index),
                        device=args.device,
                        ssl_checkpoint_path=ssl_checkpoint_path,
                    )
                else:
                    lesion_payload_path = fold_dir(output_root, fold_index) / "official_dinov2_retrieval_lesion_crop" / "result.json"
                    if not lesion_payload_path.exists():
                        raise FileNotFoundError(
                            f"Fusion requires lesion retrieval first, but it is missing: {lesion_payload_path}"
                        )
                    lesion_payload = load_json(lesion_payload_path)
                    result = run_fusion_experiment(
                        workflow=workflow,
                        split=fold,
                        cornea_payload=cornea_payload,
                        lesion_payload=lesion_payload,
                        top_k=int(spec.top_k),
                    )

                payload = {
                    "suite_component": {
                        "name": spec.name,
                        "label": spec.label,
                        "family": "Retrieval",
                        "kind": "retrieval_fusion" if spec.kind == "fusion" else "retrieval",
                        "fold_index": fold_index,
                        "spec": {
                            "kind": spec.kind,
                            "crop_variant": spec.crop_variant,
                            "top_k": int(spec.top_k),
                        },
                    },
                    "result": result,
                }
                write_json(result_file, payload)
                write_json(audit_file, audit_retrieval_payload(payload))
                summary_rows.append(summarize_result(result, fold_index=fold_index, label=spec.label))
                completed.append(job_name)
            except Exception as exc:
                failed.append(job_name)
                write_json(
                    experiment_dir / "failure.json",
                    {
                        "job_name": job_name,
                        "error": str(exc),
                        "failed_at": utc_now(),
                    },
                )

    summary_rows.sort(key=lambda item: (item["name"], int(item["fold_index"])))
    if summary_rows:
        write_csv(summary_path(output_root), summary_rows)
        write_csv(aggregate_path(output_root), aggregate_rows(summary_rows))
    overall_status = "completed" if not failed else "completed_with_failures"
    write_json(
        status_path(output_root),
        build_status_payload(
            overall_status=overall_status,
            current_fold=None,
            current_experiment=None,
            completed=completed,
            failed=failed,
            reference_cv_root=reference_cv_root,
        ),
    )
    print(
        json.dumps(
            {
                "output_root": str(output_root),
                "summary_csv": str(summary_path(output_root)),
                "aggregate_summary_csv": str(aggregate_path(output_root)),
                "completed": len(completed),
                "failed": len(failed),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
