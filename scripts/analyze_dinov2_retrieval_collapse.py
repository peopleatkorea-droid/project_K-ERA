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
class DiagnosticSpec:
    name: str
    backbone_source: str
    crop_variant: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Analyze DINOv2 retrieval embedding collapse diagnostics.")
    parser.add_argument("--site-id", default="39100103")
    parser.add_argument("--device", default="cuda", choices=["cuda", "cpu", "auto"])
    parser.add_argument(
        "--output-root",
        type=Path,
        default=REPO_ROOT / "artifacts" / "dinov2_retrieval_collapse",
    )
    parser.add_argument("--ssl-checkpoint", type=Path, default=DEFAULT_SSL_CHECKPOINT)
    parser.add_argument("--experiments", nargs="*", default=None)
    return parser.parse_args()


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


def build_default_experiments() -> list[DiagnosticSpec]:
    return [
        DiagnosticSpec(name="official_full", backbone_source="official", crop_variant="full"),
        DiagnosticSpec(name="official_cornea_roi", backbone_source="official", crop_variant="cornea_roi"),
        DiagnosticSpec(name="official_lesion_crop", backbone_source="official", crop_variant="lesion_crop"),
        DiagnosticSpec(name="ssl_full", backbone_source="ssl", crop_variant="full"),
        DiagnosticSpec(name="ssl_cornea_roi", backbone_source="ssl", crop_variant="cornea_roi"),
        DiagnosticSpec(name="ssl_lesion_crop", backbone_source="ssl", crop_variant="lesion_crop"),
    ]


def filter_experiments(specs: list[DiagnosticSpec], selected_names: list[str] | None) -> list[DiagnosticSpec]:
    if not selected_names:
        return specs
    selected = {str(name).strip() for name in selected_names if str(name).strip()}
    return [spec for spec in specs if spec.name in selected]


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


def _summarize(values: np.ndarray) -> dict[str, float]:
    safe = np.asarray(values, dtype=np.float32)
    if safe.size == 0:
        return {"mean": float("nan"), "std": float("nan"), "min": float("nan"), "max": float("nan")}
    return {
        "mean": float(np.mean(safe)),
        "std": float(np.std(safe)),
        "min": float(np.min(safe)),
        "max": float(np.max(safe)),
    }


def _pairwise_cosine_stats(embeddings: np.ndarray) -> tuple[dict[str, float], dict[str, float]]:
    if embeddings.shape[0] < 2:
        empty = {"mean": float("nan"), "std": float("nan"), "min": float("nan"), "max": float("nan")}
        return empty, empty
    similarity = embeddings @ embeddings.T
    mask = ~np.eye(similarity.shape[0], dtype=bool)
    off_diag = similarity[mask]
    top1 = similarity.copy()
    np.fill_diagonal(top1, -1.0)
    top1_values = np.max(top1, axis=1)
    return _summarize(off_diag), _summarize(top1_values)


def _pca_ratio(matrix: np.ndarray) -> float:
    if matrix.shape[0] < 2:
        return float("nan")
    centered = matrix - np.mean(matrix, axis=0, keepdims=True)
    _, singular_values, _ = np.linalg.svd(centered, full_matrices=False)
    energy = singular_values ** 2
    total = float(np.sum(energy))
    if total <= 1e-12:
        return 1.0
    return float(energy[0] / total)


def analyze_spec(
    *,
    spec: DiagnosticSpec,
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
        raise ValueError("At least 2 patients are required for collapse diagnostics.")

    retriever = Dinov2ImageRetriever(
        ssl_checkpoint_path=str(ssl_checkpoint_path.expanduser().resolve()) if spec.backbone_source == "ssl" else None
    )
    all_image_paths = [str(record["image_path"]) for record in records]
    cache_dir = output_root / "_embedding_cache" / spec.backbone_source / spec.crop_variant
    image_embeddings = retriever.encode_images(all_image_paths, requested_device=device, persistence_dir=cache_dir)
    image_norms = np.linalg.norm(image_embeddings, axis=1)

    path_to_idx = {path: index for index, path in enumerate(all_image_paths)}
    raw_patient_embeddings: list[np.ndarray] = []
    normalized_patient_embeddings: list[np.ndarray] = []
    for patient_id in patient_ids:
        patient_records = patient_to_records[patient_id]
        patient_indices = [path_to_idx[str(record["image_path"])] for record in patient_records]
        patient_embedding = np.mean(image_embeddings[patient_indices], axis=0).astype(np.float32)
        raw_patient_embeddings.append(patient_embedding)
        normalized_patient_embeddings.append(patient_embedding / max(float(np.linalg.norm(patient_embedding)), 1e-12))

    raw_patient_matrix = np.stack(raw_patient_embeddings, axis=0)
    normalized_patient_matrix = np.stack(normalized_patient_embeddings, axis=0)
    pairwise_stats, top1_stats = _pairwise_cosine_stats(normalized_patient_matrix)
    patient_norms = np.linalg.norm(raw_patient_matrix, axis=1)
    pca_first_ratio = _pca_ratio(raw_patient_matrix)
    collapse_flag = bool(
        (top1_stats["mean"] >= 0.999)
        or (pairwise_stats["std"] <= 1e-4)
        or (pca_first_ratio >= 0.95)
    )

    return {
        "experiment": spec.name,
        "backbone_source": spec.backbone_source,
        "crop_variant": spec.crop_variant,
        "n_records": len(records),
        "n_patients": len(patient_ids),
        "image_norm_mean": float(np.mean(image_norms)),
        "image_norm_std": float(np.std(image_norms)),
        "patient_norm_mean": float(np.mean(patient_norms)),
        "patient_norm_std": float(np.std(patient_norms)),
        "pairwise_cosine_mean": pairwise_stats["mean"],
        "pairwise_cosine_std": pairwise_stats["std"],
        "pairwise_cosine_min": pairwise_stats["min"],
        "pairwise_cosine_max": pairwise_stats["max"],
        "top1_cosine_mean": top1_stats["mean"],
        "top1_cosine_std": top1_stats["std"],
        "top1_cosine_min": top1_stats["min"],
        "top1_cosine_max": top1_stats["max"],
        "pca_first_component_ratio": pca_first_ratio,
        "collapse_flag": collapse_flag,
        "embedding_cache_dir": str(cache_dir),
        "source_reference": retriever.source_reference,
    }


def main() -> int:
    args = parse_args()
    output_root = args.output_root.expanduser().resolve()
    output_root.mkdir(parents=True, exist_ok=True)

    control_plane = ControlPlaneStore()
    workflow = ResearchWorkflowService(control_plane)
    site_store = SiteStore(args.site_id)
    manifest_records = site_store.generate_manifest().to_dict("records")

    results: list[dict[str, Any]] = []
    for spec in filter_experiments(build_default_experiments(), args.experiments):
        result = analyze_spec(
            spec=spec,
            workflow=workflow,
            site_store=site_store,
            manifest_records=manifest_records,
            output_root=output_root,
            device=args.device,
            ssl_checkpoint_path=args.ssl_checkpoint,
        )
        results.append(result)
        write_json(output_root / spec.name / "result.json", result)

    write_summary_csv(output_root / "summary.csv", results)
    write_json(output_root / "all_results.json", {"results": results})
    print(json.dumps({"output_root": str(output_root), "experiments": [item["experiment"] for item in results]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
