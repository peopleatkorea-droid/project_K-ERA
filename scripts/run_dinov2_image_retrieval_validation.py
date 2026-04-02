from __future__ import annotations

import argparse
import csv
import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = REPO_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from kera_research.domain import INDEX_TO_LABEL, LABEL_TO_INDEX
from kera_research.services.control_plane import ControlPlaneStore
from kera_research.services.data_plane import SiteStore
from kera_research.services.pipeline import ResearchWorkflowService
from kera_research.services.retrieval import Dinov2ImageRetriever


DEFAULT_REFERENCE_RESULT = (
    REPO_ROOT
    / "artifacts"
    / "weekend_plans"
    / "transformer_weekend_plan_20260326_172929"
    / "downstream"
    / "dinov2_ssl_full_ft_low_lr"
    / "result.json"
)


@dataclass(slots=True)
class RetrievalSpec:
    name: str
    backbone_source: str
    crop_variant: str
    top_k: int = 10


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run fixed-split image-level DINOv2 retrieval validation."
    )
    parser.add_argument("--site-id", default="39100103")
    parser.add_argument("--device", default="cuda", choices=["cuda", "cpu", "auto"])
    parser.add_argument("--reference-result", type=Path, default=DEFAULT_REFERENCE_RESULT)
    parser.add_argument(
        "--output-root",
        type=Path,
        default=REPO_ROOT / "artifacts" / "dinov2_image_retrieval_validation",
    )
    parser.add_argument("--experiments", nargs="*", default=None)
    parser.add_argument("--force-rerun", action="store_true")
    return parser.parse_args()


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def write_summary_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def build_default_experiments() -> list[RetrievalSpec]:
    return [
        RetrievalSpec(name="official_dinov2_image_retrieval_full", backbone_source="official", crop_variant="full"),
        RetrievalSpec(
            name="official_dinov2_image_retrieval_cornea",
            backbone_source="official",
            crop_variant="cornea_roi",
        ),
        RetrievalSpec(
            name="official_dinov2_image_retrieval_lesion",
            backbone_source="official",
            crop_variant="lesion_crop",
        ),
    ]


def filter_experiments(specs: list[RetrievalSpec], selected_names: list[str] | None) -> list[RetrievalSpec]:
    if not selected_names:
        return specs
    selected = {str(name).strip() for name in selected_names if str(name).strip()}
    return [spec for spec in specs if spec.name in selected]


def build_status_payload(
    *,
    overall_status: str,
    current_experiment: str | None,
    completed_experiments: list[str],
    failed_experiments: list[str],
) -> dict[str, Any]:
    return {
        "overall_status": overall_status,
        "current_experiment": current_experiment,
        "completed_experiments": completed_experiments,
        "failed_experiments": failed_experiments,
    }


def experiment_result_path(output_root: Path, experiment_name: str) -> Path:
    return output_root / experiment_name / "result.json"


def experiment_failure_path(output_root: Path, experiment_name: str) -> Path:
    return output_root / experiment_name / "failure.json"


def load_reference(reference_result_path: Path) -> tuple[dict[str, Any], str]:
    payload = load_json(reference_result_path)
    result = payload.get("result", payload)
    split = dict(result["patient_split"])
    ssl_checkpoint_path = str(result.get("ssl_checkpoint_path") or "").strip()
    if not ssl_checkpoint_path:
        raise ValueError(f"SSL checkpoint path missing in reference result: {reference_result_path}")
    return split, ssl_checkpoint_path


def prepare_records_for_variant(
    *,
    workflow: ResearchWorkflowService,
    site_store: SiteStore,
    manifest_records: list[dict[str, Any]],
    crop_variant: str,
) -> list[dict[str, Any]]:
    normalized = str(crop_variant).strip().lower()
    if normalized == "full":
        prepared: list[dict[str, Any]] = []
        for record in manifest_records:
            image_path = str(record.get("image_path") or "").strip()
            if not image_path or not workflow.case_support._source_image_is_readable(image_path):
                continue
            prepared.append(
                {
                    **record,
                    "source_image_path": image_path,
                    "image_path": image_path,
                    "crop_variant": "full",
                }
            )
        if not prepared:
            raise ValueError("No readable full-frame images are available for image-level retrieval validation.")
        return prepared
    if normalized == "cornea_roi":
        records = workflow._prepare_records_for_model(site_store, manifest_records, crop_mode="automated")
        for record in records:
            record["crop_variant"] = "cornea_roi"
        return records
    if normalized == "lesion_crop":
        records = workflow._prepare_records_for_model(site_store, manifest_records, crop_mode="manual")
        for record in records:
            record["crop_variant"] = "lesion_crop"
        return records
    raise ValueError(f"Unsupported crop variant: {crop_variant}")


def split_records(
    records: list[dict[str, Any]],
    split: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    patient_to_records: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        patient_to_records.setdefault(str(record["patient_id"]), []).append(record)
    train_records = [record for patient_id in split["train_patient_ids"] for record in patient_to_records.get(str(patient_id), [])]
    val_records = [record for patient_id in split["val_patient_ids"] for record in patient_to_records.get(str(patient_id), [])]
    test_records = [record for patient_id in split["test_patient_ids"] for record in patient_to_records.get(str(patient_id), [])]
    return train_records, val_records, test_records


def evaluate_query_images(
    *,
    query_records: list[dict[str, Any]],
    gallery_records: list[dict[str, Any]],
    path_to_index: dict[str, int],
    all_embeddings: np.ndarray,
    top_k: int,
) -> dict[str, Any]:
    true_labels: list[int] = []
    predicted_labels: list[int] = []
    positive_probabilities: list[float] = []
    prediction_rows: list[dict[str, Any]] = []
    softmax_temperature = 0.1

    gallery_embeddings = np.stack(
        [all_embeddings[path_to_index[str(record["image_path"])]] for record in gallery_records],
        axis=0,
    )
    gallery_labels = np.asarray(
        [LABEL_TO_INDEX[str(record["culture_category"])] for record in gallery_records],
        dtype=np.int64,
    )
    gallery_patients = np.asarray([str(record["patient_id"]) for record in gallery_records], dtype=object)

    for query_record in query_records:
        query_patient_id = str(query_record["patient_id"])
        query_visit_date = str(query_record["visit_date"])
        query_image_path = str(query_record["image_path"])
        eligible_mask = gallery_patients != query_patient_id
        if not bool(np.any(eligible_mask)):
            continue

        query_embedding = all_embeddings[path_to_index[query_image_path]]
        eligible_embeddings = gallery_embeddings[eligible_mask]
        similarities = eligible_embeddings @ query_embedding
        eligible_records = [record for record, keep in zip(gallery_records, eligible_mask.tolist(), strict=False) if keep]
        eligible_labels = gallery_labels[eligible_mask]

        k = min(int(top_k), len(eligible_records))
        top_indices = np.argsort(similarities)[::-1][:k]
        top_sims = similarities[top_indices]
        top_labels = [int(eligible_labels[index]) for index in top_indices.tolist()]
        stabilized_logits = (top_sims - float(np.max(top_sims))) / softmax_temperature
        vote_weights = np.exp(stabilized_logits)
        weight_total = float(np.sum(vote_weights))
        if weight_total <= 1e-12:
            p_fungal = 0.5
        else:
            p_fungal = float(
                np.sum(
                    [
                        weight
                        for weight, label in zip(vote_weights.tolist(), top_labels, strict=False)
                        if int(label) == 1
                    ]
                )
                / weight_total
            )

        true_index = LABEL_TO_INDEX[str(query_record["culture_category"])]
        predicted_index = 1 if p_fungal >= 0.5 else 0
        true_labels.append(true_index)
        predicted_labels.append(predicted_index)
        positive_probabilities.append(p_fungal)

        neighbor_rows = []
        for rank, top_index in enumerate(top_indices.tolist(), start=1):
            neighbor_record = eligible_records[top_index]
            neighbor_rows.append(
                {
                    "rank": rank,
                    "patient_id": str(neighbor_record["patient_id"]),
                    "visit_date": str(neighbor_record["visit_date"]),
                    "image_path": str(neighbor_record["image_path"]),
                    "source_image_path": str(neighbor_record.get("source_image_path") or neighbor_record["image_path"]),
                    "label": INDEX_TO_LABEL[int(eligible_labels[top_index])],
                    "similarity": round(float(similarities[top_index]), 6),
                }
            )

        prediction_rows.append(
            {
                "sample_key": f"image::{query_patient_id}::{query_visit_date}::{query_image_path}",
                "sample_kind": "image",
                "patient_id": query_patient_id,
                "visit_date": query_visit_date,
                "image_path": query_image_path,
                "source_image_path": str(query_record.get("source_image_path") or query_image_path),
                "true_label": INDEX_TO_LABEL[true_index],
                "true_label_index": int(true_index),
                "predicted_label": INDEX_TO_LABEL[predicted_index],
                "predicted_label_index": int(predicted_index),
                "positive_probability": float(p_fungal),
                "is_correct": bool(predicted_index == true_index),
                "neighbor_images": neighbor_rows,
            }
        )

    return {
        "true_labels": true_labels,
        "predicted_labels": predicted_labels,
        "positive_probabilities": positive_probabilities,
        "predictions": prediction_rows,
    }


def summarize_result(result: dict[str, Any]) -> dict[str, Any]:
    val_metrics = result["val_metrics"]
    test_metrics = result["test_metrics"]
    return {
        "name": result["name"],
        "backbone_source": result["backbone_source"],
        "crop_variant": result["crop_variant"],
        "top_k": result["top_k"],
        "n_train_cases": result["n_train_cases"],
        "n_val_cases": result["n_val_cases"],
        "n_test_cases": result["n_test_cases"],
        "val_acc": float(val_metrics["accuracy"]),
        "val_bal_acc": float(val_metrics["balanced_accuracy"]),
        "val_auroc": float(val_metrics["AUROC"]) if val_metrics.get("AUROC") is not None else None,
        "test_acc": float(test_metrics["accuracy"]),
        "test_bal_acc": float(test_metrics["balanced_accuracy"]),
        "test_auroc": float(test_metrics["AUROC"]) if test_metrics.get("AUROC") is not None else None,
        "test_sensitivity": float(test_metrics["sensitivity"]),
        "test_specificity": float(test_metrics["specificity"]),
        "decision_threshold": float(result["decision_threshold"]),
    }


def run_experiment(
    *,
    spec: RetrievalSpec,
    workflow: ResearchWorkflowService,
    site_store: SiteStore,
    manifest_records: list[dict[str, Any]],
    split: dict[str, Any],
    output_root: Path,
    device: str,
    ssl_checkpoint_path: str,
) -> dict[str, Any]:
    records = prepare_records_for_variant(
        workflow=workflow,
        site_store=site_store,
        manifest_records=manifest_records,
        crop_variant=spec.crop_variant,
    )
    train_records, val_records, test_records = split_records(records, split)
    if not train_records or not val_records or not test_records:
        raise ValueError("Image-level retrieval requires non-empty train, val, and test splits.")

    retriever = Dinov2ImageRetriever(
        ssl_checkpoint_path=ssl_checkpoint_path if spec.backbone_source == "ssl" else None
    )
    all_records = train_records + val_records + test_records
    all_image_paths = [str(record["image_path"]) for record in all_records]
    cache_dir = output_root / "_embedding_cache" / spec.backbone_source / spec.crop_variant
    all_embeddings = retriever.encode_images(
        all_image_paths,
        requested_device=device,
        persistence_dir=cache_dir,
    )
    path_to_index = {path: index for index, path in enumerate(all_image_paths)}

    val_outputs = evaluate_query_images(
        query_records=val_records,
        gallery_records=train_records,
        path_to_index=path_to_index,
        all_embeddings=all_embeddings,
        top_k=spec.top_k,
    )
    if not val_outputs["true_labels"]:
        raise ValueError("Image-level retrieval did not produce validation predictions.")
    threshold_selection = workflow.model_manager.select_decision_threshold(
        [int(value) for value in val_outputs["true_labels"]],
        [float(value) for value in val_outputs["positive_probabilities"]],
    )
    decision_threshold = float(threshold_selection["decision_threshold"])
    val_metrics = workflow.model_manager.classification_metrics(
        [int(value) for value in val_outputs["true_labels"]],
        [int(value) for value in val_outputs["predicted_labels"]],
        [float(value) for value in val_outputs["positive_probabilities"]],
        threshold=decision_threshold,
    )

    test_outputs = evaluate_query_images(
        query_records=test_records,
        gallery_records=train_records,
        path_to_index=path_to_index,
        all_embeddings=all_embeddings,
        top_k=spec.top_k,
    )
    if not test_outputs["true_labels"]:
        raise ValueError("Image-level retrieval did not produce test predictions.")
    test_metrics = workflow.model_manager.classification_metrics(
        [int(value) for value in test_outputs["true_labels"]],
        [int(value) for value in test_outputs["predicted_labels"]],
        [float(value) for value in test_outputs["positive_probabilities"]],
        threshold=decision_threshold,
    )

    return {
        "name": spec.name,
        "backbone_source": spec.backbone_source,
        "backbone_reference": retriever.source_reference,
        "crop_variant": spec.crop_variant,
        "top_k": int(spec.top_k),
        "training_id": f"image_retrieval::{spec.name}",
        "evaluation_mode": "fixed_split_image_level_train_gallery_knn",
        "vote_mode": "temperature_softmax_image_knn",
        "same_patient_exclusion": True,
        "decision_threshold": decision_threshold,
        "threshold_selection_metric": threshold_selection["selection_metric"],
        "threshold_selection_metrics": threshold_selection["selection_metrics"],
        "patient_split": split,
        "n_train_images": len(train_records),
        "n_val_images": len(val_records),
        "n_test_images": len(test_records),
        "n_train_cases": len(train_records),
        "n_val_cases": len(val_records),
        "n_test_cases": len(test_records),
        "n_train_patients": len(split["train_patient_ids"]),
        "n_val_patients": len(split["val_patient_ids"]),
        "n_test_patients": len(split["test_patient_ids"]),
        "gallery_cases": len(train_records),
        "evaluation_unit": "image",
        "val_metrics": val_metrics,
        "test_metrics": test_metrics,
        "val_predictions": val_outputs["predictions"],
        "test_predictions": test_outputs["predictions"],
    }


def main() -> int:
    args = parse_args()
    output_root = args.output_root.expanduser().resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    status_path = output_root / "status.json"
    reference_split, ssl_checkpoint_path = load_reference(args.reference_result.expanduser().resolve())

    control_plane = ControlPlaneStore()
    workflow = ResearchWorkflowService(control_plane)
    site_store = SiteStore(args.site_id)
    manifest_records = site_store.generate_manifest().to_dict("records")

    completed: list[str] = []
    failed: list[str] = []
    summaries: list[dict[str, Any]] = []
    write_json(
        status_path,
        build_status_payload(
            overall_status="starting",
            current_experiment=None,
            completed_experiments=completed,
            failed_experiments=failed,
        ),
    )

    selected_specs = filter_experiments(build_default_experiments(), args.experiments)
    for spec in selected_specs:
        result_path = experiment_result_path(output_root, spec.name)
        failure_path = experiment_failure_path(output_root, spec.name)
        if result_path.exists() and not args.force_rerun:
            payload = load_json(result_path)
            summaries.append(summarize_result(payload["result"]))
            completed.append(spec.name)
            continue

        write_json(
            status_path,
            build_status_payload(
                overall_status="running",
                current_experiment=spec.name,
                completed_experiments=completed,
                failed_experiments=failed,
            ),
        )
        try:
            result = run_experiment(
                spec=spec,
                workflow=workflow,
                site_store=site_store,
                manifest_records=manifest_records,
                split=reference_split,
                output_root=output_root,
                device=args.device,
                ssl_checkpoint_path=ssl_checkpoint_path,
            )
            payload = {"spec": asdict(spec), "result": result}
            write_json(result_path, payload)
            if failure_path.exists():
                failure_path.unlink()
            summaries.append(summarize_result(result))
            completed.append(spec.name)
        except Exception as exc:
            failed.append(spec.name)
            write_json(
                failure_path,
                {
                    "experiment": spec.name,
                    "error": repr(exc),
                },
            )

    write_summary_csv(output_root / "summary.csv", summaries)
    write_json(
        status_path,
        build_status_payload(
            overall_status="completed" if not failed else "completed_with_failures",
            current_experiment=None,
            completed_experiments=completed,
            failed_experiments=failed,
        ),
    )
    print(json.dumps({"output_root": str(output_root), "completed": completed, "failed": failed}, ensure_ascii=False, indent=2))
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
