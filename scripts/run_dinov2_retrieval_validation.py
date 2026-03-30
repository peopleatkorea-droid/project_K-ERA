from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
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


DEFAULT_SSL_CHECKPOINT = (
    REPO_ROOT
    / "artifacts"
    / "weekend_plans"
    / "transformer_weekend_plan_20260326_172929"
    / "ssl_runs"
    / "dinov2_ssl_weak_ocular"
    / "ssl_encoder_latest.pth"
)


@dataclass(slots=True)
class RetrievalSpec:
    name: str
    backbone_source: str
    crop_variant: str
    top_k: int = 10


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run DINOv2 retrieval validation on full / cornea ROI / lesion crop variants."
    )
    parser.add_argument("--site-id", default="39100103")
    parser.add_argument("--device", default="cuda", choices=["cuda", "cpu", "auto"])
    parser.add_argument("--output-root", type=Path, default=REPO_ROOT / "artifacts" / "dinov2_retrieval_validation")
    parser.add_argument("--ssl-checkpoint", type=Path, default=DEFAULT_SSL_CHECKPOINT)
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
        RetrievalSpec(name="retrieval_official_full", backbone_source="official", crop_variant="full"),
        RetrievalSpec(name="retrieval_official_cornea_roi", backbone_source="official", crop_variant="cornea_roi"),
        RetrievalSpec(name="retrieval_official_lesion_crop", backbone_source="official", crop_variant="lesion_crop"),
        RetrievalSpec(name="retrieval_ssl_full", backbone_source="ssl", crop_variant="full"),
        RetrievalSpec(name="retrieval_ssl_cornea_roi", backbone_source="ssl", crop_variant="cornea_roi"),
        RetrievalSpec(name="retrieval_ssl_lesion_crop", backbone_source="ssl", crop_variant="lesion_crop"),
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
            raise ValueError("No readable full-frame images are available for retrieval validation.")
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


def run_retrieval_experiment(
    *,
    spec: RetrievalSpec,
    workflow: ResearchWorkflowService,
    site_store: SiteStore,
    manifest_records: list[dict[str, Any]],
    output_root: Path,
    device: str,
    ssl_checkpoint_path: Path,
) -> dict[str, Any]:
    records = prepare_records_for_variant(
        workflow=workflow,
        site_store=site_store,
        manifest_records=manifest_records,
        crop_variant=spec.crop_variant,
    )

    patient_to_records: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        patient_to_records[str(record["patient_id"])].append(record)

    patient_ids = sorted(patient_to_records.keys())
    if len(patient_ids) < 2:
        raise ValueError("At least 2 patients are required for retrieval LOOCV.")

    resolved_ssl_path = ssl_checkpoint_path.expanduser().resolve()
    retriever = Dinov2ImageRetriever(
        ssl_checkpoint_path=str(resolved_ssl_path) if spec.backbone_source == "ssl" else None
    )
    all_image_paths = [str(record["image_path"]) for record in records]
    cache_dir = output_root / "_embedding_cache" / spec.backbone_source / spec.crop_variant
    all_embeddings = retriever.encode_images(
        all_image_paths,
        requested_device=device,
        persistence_dir=cache_dir,
    )

    path_to_idx = {path: index for index, path in enumerate(all_image_paths)}
    patient_embeddings: dict[str, np.ndarray] = {}
    patient_labels: dict[str, int] = {}
    for patient_id in patient_ids:
        patient_records = patient_to_records[patient_id]
        patient_indices = [path_to_idx[str(record["image_path"])] for record in patient_records]
        patient_embedding = np.mean(all_embeddings[patient_indices], axis=0).astype(np.float32)
        patient_embedding = patient_embedding / max(float(np.linalg.norm(patient_embedding)), 1e-12)
        patient_embeddings[patient_id] = patient_embedding
        patient_labels[patient_id] = LABEL_TO_INDEX[str(patient_records[0]["culture_category"])]

    true_labels: list[int] = []
    predicted_labels: list[int] = []
    positive_probabilities: list[float] = []
    test_predictions: list[dict[str, Any]] = []
    softmax_temperature = 0.1

    for query_patient_id in patient_ids:
        query_records = patient_to_records[query_patient_id]
        db_patient_ids = [patient_id for patient_id in patient_ids if patient_id != query_patient_id]
        query_embedding = patient_embeddings[query_patient_id]
        db_embeddings = np.stack([patient_embeddings[patient_id] for patient_id in db_patient_ids], axis=0)
        db_labels_int = [patient_labels[patient_id] for patient_id in db_patient_ids]

        similarities = db_embeddings @ query_embedding
        k = min(int(spec.top_k), len(db_patient_ids))
        top_indices = np.argsort(similarities)[::-1][:k]
        top_sims = similarities[top_indices]
        top_labels = [db_labels_int[index] for index in top_indices]
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

        patient_label = patient_labels[query_patient_id]
        predicted_label = 1 if p_fungal >= 0.5 else 0
        true_labels.append(patient_label)
        predicted_labels.append(predicted_label)
        positive_probabilities.append(float(p_fungal))
        neighbor_details = []
        for rank, top_index in enumerate(top_indices.tolist(), start=1):
            neighbor_patient_id = db_patient_ids[top_index]
            neighbor_details.append(
                {
                    "rank": rank,
                    "patient_id": neighbor_patient_id,
                    "label": INDEX_TO_LABEL[db_labels_int[top_index]],
                    "similarity": round(float(similarities[top_index]), 6),
                }
            )
        test_predictions.append(
            {
                "sample_key": f"patient::{query_patient_id}",
                "sample_kind": "patient",
                "patient_id": query_patient_id,
                "true_label": INDEX_TO_LABEL[patient_label],
                "true_label_index": patient_label,
                "predicted_label": INDEX_TO_LABEL[predicted_label],
                "predicted_label_index": predicted_label,
                "positive_probability": float(p_fungal),
                "is_correct": bool(patient_label == predicted_label),
                "top_neighbors": neighbor_details,
                "source_image_paths": [str(record["image_path"]) for record in query_records],
            }
        )

    metrics = workflow.model_manager.classification_metrics(true_labels, predicted_labels, positive_probabilities)
    return {
        "site_id": site_store.site_id,
        "architecture": "retrieval_dinov2",
        "retrieval_source": spec.backbone_source,
        "retrieval_source_reference": retriever.source_reference,
        "ssl_checkpoint_path": str(resolved_ssl_path) if spec.backbone_source == "ssl" else None,
        "crop_variant": spec.crop_variant,
        "top_k": int(spec.top_k),
        "evaluation_mode": "loocv_patient_level",
        "vote_mode": "temperature_softmax_patient_knn",
        "softmax_temperature": softmax_temperature,
        "n_test": len(patient_ids),
        "n_test_cases": len(patient_ids),
        "n_test_images": len(records),
        "n_test_patients": len(patient_ids),
        "n_patients": len(patient_ids),
        "n_records": len(records),
        "embedding_cache_dir": str(cache_dir),
        "test_metrics": metrics,
        "val_metrics": metrics,
        "test_predictions": test_predictions,
    }


def summarize_payload(payload: dict[str, Any]) -> dict[str, Any]:
    result = payload["result"]
    metrics = result.get("test_metrics") or {}
    return {
        "experiment": str(payload["spec"]["name"]),
        "retrieval_source": str(result.get("retrieval_source") or ""),
        "crop_variant": str(result.get("crop_variant") or ""),
        "n_patients": int(result.get("n_patients") or 0),
        "n_records": int(result.get("n_records") or 0),
        "top_k": int(result.get("top_k") or 0),
        "test_acc": float(metrics.get("accuracy") or 0.0),
        "test_bal_acc": float(metrics.get("balanced_accuracy") or 0.0),
        "test_auroc": float(metrics["AUROC"]) if metrics.get("AUROC") is not None else None,
        "test_sensitivity": float(metrics.get("sensitivity") or 0.0),
        "test_specificity": float(metrics.get("specificity") or 0.0),
        "test_f1": float(metrics.get("F1") or 0.0),
    }


def main() -> int:
    args = parse_args()
    output_root = args.output_root.expanduser().resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    status_path = output_root / "status.json"
    write_json(
        status_path,
        build_status_payload(
            overall_status="starting",
            current_experiment=None,
            completed_experiments=[],
            failed_experiments=[],
        ),
    )

    specs = filter_experiments(build_default_experiments(), args.experiments)
    control_plane = ControlPlaneStore()
    workflow = ResearchWorkflowService(control_plane)
    site_store = SiteStore(args.site_id)
    manifest_records = site_store.generate_manifest().to_dict("records")

    completed: list[str] = []
    failed: list[str] = []
    summaries: list[dict[str, Any]] = []
    payloads: dict[str, Any] = {}

    for spec in specs:
        result_path = experiment_result_path(output_root, spec.name)
        failure_path = experiment_failure_path(output_root, spec.name)
        if result_path.exists() and not args.force_rerun:
            payload = load_json(result_path)
            payloads[spec.name] = payload
            completed.append(spec.name)
            summaries.append(summarize_payload(payload))
            write_json(
                status_path,
                build_status_payload(
                    overall_status="running",
                    current_experiment=None,
                    completed_experiments=completed,
                    failed_experiments=failed,
                ),
            )
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
            result = run_retrieval_experiment(
                spec=spec,
                workflow=workflow,
                site_store=site_store,
                manifest_records=manifest_records,
                output_root=output_root,
                device=args.device,
                ssl_checkpoint_path=args.ssl_checkpoint,
            )
            payload = {
                "status": "completed",
                "spec": asdict(spec),
                "result": result,
            }
            write_json(result_path, payload)
            if failure_path.exists():
                failure_path.unlink()
            payloads[spec.name] = payload
            completed.append(spec.name)
            summaries.append(summarize_payload(payload))
        except Exception as exc:
            failure_payload = {
                "status": "failed",
                "spec": asdict(spec),
                "error": str(exc),
            }
            write_json(failure_path, failure_payload)
            payloads[spec.name] = failure_payload
            failed.append(spec.name)

    write_json(output_root / "all_results.json", payloads)
    write_summary_csv(output_root / "summary.csv", summaries)
    overall_status = "completed" if not failed else "completed_with_failures"
    write_json(
        status_path,
        build_status_payload(
            overall_status=overall_status,
            current_experiment=None,
            completed_experiments=completed,
            failed_experiments=failed,
        ),
    )
    print(json.dumps({"output_root": str(output_root), "completed": completed, "failed": failed}, ensure_ascii=False, indent=2))
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
