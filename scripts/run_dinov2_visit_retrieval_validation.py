from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from dataclasses import dataclass
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
        description="Run visit-level fixed-split DINOv2 retrieval validation aligned with MIL evaluation."
    )
    parser.add_argument("--site-id", default="39100103")
    parser.add_argument("--device", default="cuda", choices=["cuda", "cpu", "auto"])
    parser.add_argument("--reference-result", type=Path, default=DEFAULT_REFERENCE_RESULT)
    parser.add_argument("--output-root", type=Path, default=REPO_ROOT / "artifacts" / "dinov2_visit_retrieval_validation")
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


def load_reference(reference_result_path: Path) -> tuple[dict[str, Any], str]:
    payload = load_json(reference_result_path)
    result = payload.get("result", payload)
    split = dict(result["patient_split"])
    ssl_checkpoint_path = str(result.get("ssl_checkpoint_path") or "").strip()
    if not ssl_checkpoint_path:
        raise ValueError(f"SSL checkpoint path missing in reference result: {reference_result_path}")
    return split, ssl_checkpoint_path


def build_default_experiments() -> list[RetrievalSpec]:
    return [
        RetrievalSpec(
            name="visit_retrieval_official_cornea_roi",
            backbone_source="official",
            crop_variant="cornea_roi",
        ),
        RetrievalSpec(
            name="visit_retrieval_ssl_cornea_roi",
            backbone_source="ssl",
            crop_variant="cornea_roi",
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
            raise ValueError("No readable full-frame images are available for visit-level retrieval validation.")
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


def split_records(records: list[dict[str, Any]], split: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    patient_to_records: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        patient_to_records[str(record["patient_id"])].append(record)
    train_records = [record for patient_id in split["train_patient_ids"] for record in patient_to_records[str(patient_id)]]
    val_records = [record for patient_id in split["val_patient_ids"] for record in patient_to_records[str(patient_id)]]
    test_records = [record for patient_id in split["test_patient_ids"] for record in patient_to_records[str(patient_id)]]
    return train_records, val_records, test_records


def group_records_by_visit(records: list[dict[str, Any]]) -> dict[tuple[str, str], list[dict[str, Any]]]:
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for record in records:
        key = (str(record["patient_id"]), str(record["visit_date"]))
        grouped.setdefault(key, []).append(record)
    return grouped


def build_visit_embeddings(
    visit_records: dict[tuple[str, str], list[dict[str, Any]]],
    *,
    path_to_index: dict[str, int],
    all_embeddings: np.ndarray,
) -> tuple[dict[tuple[str, str], np.ndarray], dict[tuple[str, str], int]]:
    visit_embeddings: dict[tuple[str, str], np.ndarray] = {}
    visit_labels: dict[tuple[str, str], int] = {}
    for visit_key, records in visit_records.items():
        indices = [path_to_index[str(record["image_path"])] for record in records]
        visit_embedding = np.mean(all_embeddings[indices], axis=0).astype(np.float32)
        visit_embedding = visit_embedding / max(float(np.linalg.norm(visit_embedding)), 1e-12)
        visit_embeddings[visit_key] = visit_embedding
        visit_labels[visit_key] = LABEL_TO_INDEX[str(records[0]["culture_category"])]
    return visit_embeddings, visit_labels


def evaluate_query_visits(
    *,
    query_visit_records: dict[tuple[str, str], list[dict[str, Any]]],
    query_embeddings: dict[tuple[str, str], np.ndarray],
    query_labels: dict[tuple[str, str], int],
    gallery_visit_records: dict[tuple[str, str], list[dict[str, Any]]],
    gallery_embeddings: dict[tuple[str, str], np.ndarray],
    gallery_labels: dict[tuple[str, str], int],
    top_k: int,
) -> dict[str, Any]:
    true_labels: list[int] = []
    predicted_labels: list[int] = []
    positive_probabilities: list[float] = []
    prediction_rows: list[dict[str, Any]] = []
    softmax_temperature = 0.1

    for visit_key, records in query_visit_records.items():
        query_patient_id, query_visit_date = visit_key
        eligible_gallery_keys = [
            gallery_key
            for gallery_key in gallery_visit_records
            if str(gallery_key[0]) != str(query_patient_id)
        ]
        if not eligible_gallery_keys:
            continue

        query_embedding = query_embeddings[visit_key]
        gallery_matrix = np.stack([gallery_embeddings[gallery_key] for gallery_key in eligible_gallery_keys], axis=0)
        similarities = gallery_matrix @ query_embedding
        gallery_label_indices = [gallery_labels[gallery_key] for gallery_key in eligible_gallery_keys]

        k = min(int(top_k), len(eligible_gallery_keys))
        top_indices = np.argsort(similarities)[::-1][:k]
        top_sims = similarities[top_indices]
        top_labels = [gallery_label_indices[index] for index in top_indices]
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
                        if label == 1
                    ]
                )
                / weight_total
            )

        true_index = query_labels[visit_key]
        predicted_index = 1 if p_fungal >= 0.5 else 0
        true_labels.append(true_index)
        predicted_labels.append(predicted_index)
        positive_probabilities.append(p_fungal)

        neighbor_rows = []
        for rank, top_index in enumerate(top_indices.tolist(), start=1):
            neighbor_key = eligible_gallery_keys[top_index]
            neighbor_rows.append(
                {
                    "rank": rank,
                    "patient_id": str(neighbor_key[0]),
                    "visit_date": str(neighbor_key[1]),
                    "label": INDEX_TO_LABEL[gallery_label_indices[top_index]],
                    "similarity": round(float(similarities[top_index]), 6),
                }
            )

        prediction_rows.append(
            {
                "sample_key": f"visit::{query_patient_id}::{query_visit_date}",
                "sample_kind": "visit",
                "patient_id": str(query_patient_id),
                "visit_date": str(query_visit_date),
                "true_label": INDEX_TO_LABEL[true_index],
                "true_label_index": int(true_index),
                "predicted_label": INDEX_TO_LABEL[predicted_index],
                "predicted_label_index": int(predicted_index),
                "positive_probability": float(p_fungal),
                "is_correct": bool(predicted_index == true_index),
                "source_image_paths": [str(record.get("source_image_path") or record["image_path"]) for record in records],
                "prepared_image_paths": [str(record["image_path"]) for record in records],
                "neighbor_visits": neighbor_rows,
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

    train_visits = group_records_by_visit(train_records)
    val_visits = group_records_by_visit(val_records)
    test_visits = group_records_by_visit(test_records)

    train_visit_embeddings, train_visit_labels = build_visit_embeddings(
        train_visits,
        path_to_index=path_to_index,
        all_embeddings=all_embeddings,
    )
    val_visit_embeddings, val_visit_labels = build_visit_embeddings(
        val_visits,
        path_to_index=path_to_index,
        all_embeddings=all_embeddings,
    )
    test_visit_embeddings, test_visit_labels = build_visit_embeddings(
        test_visits,
        path_to_index=path_to_index,
        all_embeddings=all_embeddings,
    )

    val_outputs = evaluate_query_visits(
        query_visit_records=val_visits,
        query_embeddings=val_visit_embeddings,
        query_labels=val_visit_labels,
        gallery_visit_records=train_visits,
        gallery_embeddings=train_visit_embeddings,
        gallery_labels=train_visit_labels,
        top_k=spec.top_k,
    )
    if not val_outputs["true_labels"]:
        raise ValueError("Visit-level retrieval did not produce validation predictions.")
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

    test_outputs = evaluate_query_visits(
        query_visit_records=test_visits,
        query_embeddings=test_visit_embeddings,
        query_labels=test_visit_labels,
        gallery_visit_records=train_visits,
        gallery_embeddings=train_visit_embeddings,
        gallery_labels=train_visit_labels,
        top_k=spec.top_k,
    )
    if not test_outputs["true_labels"]:
        raise ValueError("Visit-level retrieval did not produce test predictions.")
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
        "training_id": f"visit_retrieval::{spec.name}",
        "evaluation_mode": "fixed_split_visit_level_train_gallery_knn",
        "vote_mode": "temperature_softmax_visit_knn",
        "same_patient_exclusion": True,
        "decision_threshold": decision_threshold,
        "threshold_selection_metric": threshold_selection["selection_metric"],
        "threshold_selection_metrics": threshold_selection["selection_metrics"],
        "patient_split": split,
        "n_train_images": len(train_records),
        "n_val_images": len(val_records),
        "n_test_images": len(test_records),
        "n_train_cases": len(train_visits),
        "n_val_cases": len(val_visits),
        "n_test_cases": len(test_visits),
        "n_train_patients": len(split["train_patient_ids"]),
        "n_val_patients": len(split["val_patient_ids"]),
        "n_test_patients": len(split["test_patient_ids"]),
        "gallery_cases": len(train_visits),
        "evaluation_unit": "visit",
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
    write_json(
        status_path,
        build_status_payload(
            overall_status="starting",
            current_experiment=None,
            completed_experiments=completed,
            failed_experiments=failed,
        ),
    )

    summary_rows: list[dict[str, Any]] = []
    selected_specs = filter_experiments(build_default_experiments(), args.experiments)
    for spec in selected_specs:
        result_path = experiment_result_path(output_root, spec.name)
        failure_path = experiment_failure_path(output_root, spec.name)
        if result_path.exists() and not args.force_rerun:
            payload = load_json(result_path)
            summary_rows.append(summarize_result(payload["result"]))
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
            payload = {
                "spec": {
                    "name": spec.name,
                    "backbone_source": spec.backbone_source,
                    "crop_variant": spec.crop_variant,
                    "top_k": spec.top_k,
                },
                "result": result,
            }
            write_json(result_path, payload)
            if failure_path.exists():
                failure_path.unlink()
            summary_rows.append(summarize_result(result))
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

    write_summary_csv(output_root / "summary.csv", summary_rows)
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
