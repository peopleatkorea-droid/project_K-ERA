from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader

REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = REPO_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from kera_research.domain import (
    LABEL_TO_INDEX,
    is_attention_mil_architecture,
    is_lesion_guided_fusion_architecture,
    is_three_scale_lesion_guided_fusion_architecture,
    lesion_guided_fusion_backbone,
)
from kera_research.services.control_plane import ControlPlaneStore
from kera_research.services.data_plane import SiteStore
from kera_research.services.modeling import (
    LesionGuidedFusionDataset,
    ManifestImageDataset,
    ModelManager,
    PairedCropDataset,
    ThreeScaleLesionGuidedFusionDataset,
    VisitBagDataset,
    collate_visit_bags,
)
from kera_research.services.pipeline import ResearchWorkflowService


DEFAULT_REFERENCE_RESULT = (
    REPO_ROOT
    / "artifacts"
    / "weekend_plans"
    / "transformer_weekend_plan_20260326_172929"
    / "downstream"
    / "dinov2_ssl_full_ft_low_lr"
    / "result.json"
)

DEFAULT_WARMSTART_MODEL = (
    REPO_ROOT
    / "artifacts"
    / "dinov2_recovery_validation_smoke"
    / "h2_full_ft_tuned"
    / "h2_full_ft_tuned.pth"
)

DEFAULT_H5_WARMSTART_MODEL = (
    REPO_ROOT
    / "artifacts"
    / "dinov2_overnight_master_20260329"
    / "warmstart_balanced_queue"
    / "runs"
    / "h5_warmstart_lgf_highhead_pat10"
    / "h5_warmstart_lgf_highhead_pat10"
    / "h5_warmstart_lgf_highhead_pat10.pth"
)


@dataclass(slots=True)
class ExperimentSpec:
    name: str
    hypothesis: str
    architecture: str
    crop_mode: str
    fine_tuning_mode: str
    learning_rate: float
    backbone_learning_rate: float | None
    head_learning_rate: float | None
    warmup_epochs: int
    early_stop_patience: int | None
    partial_unfreeze_blocks: int = 1
    batch_size: int = 16
    epochs: int = 30
    case_aggregation: str = "mean"
    tiny_train_patients: int | None = None
    tiny_val_patients: int | None = None
    tiny_test_patients: int | None = None
    warm_start_model_path: str | None = None
    fungal_weight_multiplier: float = 1.0
    threshold_strategy: str = "balanced_accuracy"
    specificity_floor: float | None = None
    model_selection_metric: str = "balanced_accuracy"
    medium_crop_scale_factor: float | None = None
    pretraining_source: str | None = "ssl"
    use_pretrained: bool = True


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run DINOv2 recovery ablations on the fixed weekend split and summarize results."
    )
    parser.add_argument("--site-id", default="39100103")
    parser.add_argument("--device", default="cuda", choices=["cuda", "cpu", "auto"])
    parser.add_argument("--reference-result", type=Path, default=DEFAULT_REFERENCE_RESULT)
    parser.add_argument("--output-root", type=Path, default=None)
    parser.add_argument(
        "--experiments",
        nargs="*",
        default=None,
        help="Optional subset of experiment names to run.",
    )
    parser.add_argument("--main-epochs", type=int, default=30)
    parser.add_argument("--overfit-epochs", type=int, default=60)
    return parser.parse_args()


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def make_output_root(args: argparse.Namespace) -> Path:
    if args.output_root is not None:
        return args.output_root.expanduser().resolve()
    return (REPO_ROOT / "artifacts" / "dinov2_recovery_validation").resolve()


def build_default_experiments(main_epochs: int, overfit_epochs: int) -> list[ExperimentSpec]:
    return [
        ExperimentSpec(
            name="h2_full_ft_tuned",
            hypothesis="h2_more_aggressive_finetuning",
            architecture="dinov2",
            crop_mode="automated",
            fine_tuning_mode="full",
            learning_rate=5e-5,
            backbone_learning_rate=2e-5,
            head_learning_rate=1e-4,
            warmup_epochs=3,
            early_stop_patience=7,
            epochs=main_epochs,
        ),
        ExperimentSpec(
            name="h2_partial_ft_blocks3",
            hypothesis="h2_more_aggressive_finetuning",
            architecture="dinov2",
            crop_mode="automated",
            fine_tuning_mode="partial",
            learning_rate=5e-5,
            backbone_learning_rate=2e-5,
            head_learning_rate=1e-4,
            warmup_epochs=3,
            early_stop_patience=7,
            partial_unfreeze_blocks=3,
            epochs=main_epochs,
        ),
        ExperimentSpec(
            name="h2_partial_ft_blocks6",
            hypothesis="h2_more_aggressive_finetuning",
            architecture="dinov2",
            crop_mode="automated",
            fine_tuning_mode="partial",
            learning_rate=5e-5,
            backbone_learning_rate=2e-5,
            head_learning_rate=1e-4,
            warmup_epochs=3,
            early_stop_patience=7,
            partial_unfreeze_blocks=6,
            epochs=main_epochs,
        ),
        ExperimentSpec(
            name="h3_dinov2_mil_full_ft",
            hypothesis="h3_local_signal_head",
            architecture="dinov2_mil",
            crop_mode="automated",
            fine_tuning_mode="full",
            learning_rate=5e-5,
            backbone_learning_rate=2e-5,
            head_learning_rate=1e-4,
            warmup_epochs=3,
            early_stop_patience=7,
            epochs=main_epochs,
            batch_size=2,
            case_aggregation="attention_mil",
        ),
        ExperimentSpec(
            name="h3_lgf_dinov2_full_ft",
            hypothesis="h3_local_signal_head",
            architecture="lesion_guided_fusion__dinov2",
            crop_mode="paired",
            fine_tuning_mode="full",
            learning_rate=5e-5,
            backbone_learning_rate=2e-5,
            head_learning_rate=1e-4,
            warmup_epochs=3,
            early_stop_patience=7,
            epochs=main_epochs,
            batch_size=2,
        ),
        ExperimentSpec(
            name="h1_tiny_overfit_full_ft",
            hypothesis="h1_optimization_stagnation",
            architecture="dinov2",
            crop_mode="automated",
            fine_tuning_mode="full",
            learning_rate=5e-5,
            backbone_learning_rate=2e-5,
            head_learning_rate=1e-4,
            warmup_epochs=3,
            early_stop_patience=None,
            epochs=overfit_epochs,
            tiny_train_patients=8,
            tiny_val_patients=2,
            tiny_test_patients=2,
        ),
        ExperimentSpec(
            name="h4_warmstart_lgf",
            hypothesis="h4_warmstart_lgf",
            architecture="lesion_guided_fusion__dinov2",
            crop_mode="paired",
            fine_tuning_mode="full",
            learning_rate=5e-5,
            backbone_learning_rate=2e-5,
            head_learning_rate=1e-4,
            warmup_epochs=3,
            early_stop_patience=7,
            epochs=main_epochs,
            batch_size=2,
            warm_start_model_path=str(DEFAULT_WARMSTART_MODEL),
        ),
        ExperimentSpec(
            name="h4_warmstart_lgf_asym",
            hypothesis="h4_warmstart_lgf_asymmetric",
            architecture="lesion_guided_fusion__dinov2",
            crop_mode="paired",
            fine_tuning_mode="full",
            learning_rate=5e-5,
            backbone_learning_rate=2e-5,
            head_learning_rate=1e-4,
            warmup_epochs=3,
            early_stop_patience=7,
            epochs=main_epochs,
            batch_size=2,
            warm_start_model_path=str(DEFAULT_WARMSTART_MODEL),
            fungal_weight_multiplier=1.5,
            threshold_strategy="fungal_recall_priority",
            specificity_floor=0.5,
        ),
        ExperimentSpec(
            name="h5_warmstart_lgf_asym_w125_spec050",
            hypothesis="h5_warmstart_lgf_asym_sweep",
            architecture="lesion_guided_fusion__dinov2",
            crop_mode="paired",
            fine_tuning_mode="full",
            learning_rate=5e-5,
            backbone_learning_rate=2e-5,
            head_learning_rate=1e-4,
            warmup_epochs=3,
            early_stop_patience=7,
            epochs=main_epochs,
            batch_size=2,
            warm_start_model_path=str(DEFAULT_WARMSTART_MODEL),
            fungal_weight_multiplier=1.25,
            threshold_strategy="fungal_recall_priority",
            specificity_floor=0.5,
        ),
        ExperimentSpec(
            name="h5_warmstart_lgf_asym_w175_spec050",
            hypothesis="h5_warmstart_lgf_asym_sweep",
            architecture="lesion_guided_fusion__dinov2",
            crop_mode="paired",
            fine_tuning_mode="full",
            learning_rate=5e-5,
            backbone_learning_rate=2e-5,
            head_learning_rate=1e-4,
            warmup_epochs=3,
            early_stop_patience=7,
            epochs=main_epochs,
            batch_size=2,
            warm_start_model_path=str(DEFAULT_WARMSTART_MODEL),
            fungal_weight_multiplier=1.75,
            threshold_strategy="fungal_recall_priority",
            specificity_floor=0.5,
        ),
        ExperimentSpec(
            name="h5_warmstart_lgf_asym_w150_spec045",
            hypothesis="h5_warmstart_lgf_asym_sweep",
            architecture="lesion_guided_fusion__dinov2",
            crop_mode="paired",
            fine_tuning_mode="full",
            learning_rate=5e-5,
            backbone_learning_rate=2e-5,
            head_learning_rate=1e-4,
            warmup_epochs=3,
            early_stop_patience=7,
            epochs=main_epochs,
            batch_size=2,
            warm_start_model_path=str(DEFAULT_WARMSTART_MODEL),
            fungal_weight_multiplier=1.5,
            threshold_strategy="fungal_recall_priority",
            specificity_floor=0.45,
        ),
        ExperimentSpec(
            name="h5_warmstart_lgf_asym_w150_spec055",
            hypothesis="h5_warmstart_lgf_asym_sweep",
            architecture="lesion_guided_fusion__dinov2",
            crop_mode="paired",
            fine_tuning_mode="full",
            learning_rate=5e-5,
            backbone_learning_rate=2e-5,
            head_learning_rate=1e-4,
            warmup_epochs=3,
            early_stop_patience=7,
            epochs=main_epochs,
            batch_size=2,
            warm_start_model_path=str(DEFAULT_WARMSTART_MODEL),
            fungal_weight_multiplier=1.5,
            threshold_strategy="fungal_recall_priority",
            specificity_floor=0.55,
        ),
        ExperimentSpec(
            name="h5_warmstart_lgf_balanced_pat10",
            hypothesis="h5_warmstart_lgf_balanced_sweep",
            architecture="lesion_guided_fusion__dinov2",
            crop_mode="paired",
            fine_tuning_mode="full",
            learning_rate=5e-5,
            backbone_learning_rate=2e-5,
            head_learning_rate=1e-4,
            warmup_epochs=3,
            early_stop_patience=10,
            epochs=main_epochs,
            batch_size=2,
            warm_start_model_path=str(DEFAULT_WARMSTART_MODEL),
        ),
        ExperimentSpec(
            name="h5_warmstart_lgf_lowbb_pat10",
            hypothesis="h5_warmstart_lgf_balanced_sweep",
            architecture="lesion_guided_fusion__dinov2",
            crop_mode="paired",
            fine_tuning_mode="full",
            learning_rate=5e-5,
            backbone_learning_rate=1e-5,
            head_learning_rate=1e-4,
            warmup_epochs=3,
            early_stop_patience=10,
            epochs=main_epochs,
            batch_size=2,
            warm_start_model_path=str(DEFAULT_WARMSTART_MODEL),
        ),
        ExperimentSpec(
            name="h5_warmstart_lgf_verylowbb_pat10",
            hypothesis="h5_warmstart_lgf_balanced_sweep",
            architecture="lesion_guided_fusion__dinov2",
            crop_mode="paired",
            fine_tuning_mode="full",
            learning_rate=5e-5,
            backbone_learning_rate=8e-6,
            head_learning_rate=8e-5,
            warmup_epochs=3,
            early_stop_patience=10,
            epochs=main_epochs,
            batch_size=2,
            warm_start_model_path=str(DEFAULT_WARMSTART_MODEL),
        ),
        ExperimentSpec(
            name="h5_warmstart_lgf_highhead_pat10",
            hypothesis="h5_warmstart_lgf_balanced_sweep",
            architecture="lesion_guided_fusion__dinov2",
            crop_mode="paired",
            fine_tuning_mode="full",
            learning_rate=5e-5,
            backbone_learning_rate=1e-5,
            head_learning_rate=1.5e-4,
            warmup_epochs=3,
            early_stop_patience=10,
            epochs=main_epochs,
            batch_size=2,
            warm_start_model_path=str(DEFAULT_WARMSTART_MODEL),
        ),
        ExperimentSpec(
            name="h6_3scale_warmstart_d15",
            hypothesis="h6_three_scale_lgf",
            architecture="lesion_guided_fusion_3scale__dinov2",
            crop_mode="paired",
            fine_tuning_mode="full",
            learning_rate=5e-5,
            backbone_learning_rate=1e-5,
            head_learning_rate=1.5e-4,
            warmup_epochs=3,
            early_stop_patience=10,
            epochs=main_epochs,
            batch_size=2,
            warm_start_model_path=str(DEFAULT_WARMSTART_MODEL),
            model_selection_metric="val_auroc",
            medium_crop_scale_factor=1.5,
        ),
        ExperimentSpec(
            name="h6_3scale_warmstart_d20",
            hypothesis="h6_three_scale_lgf",
            architecture="lesion_guided_fusion_3scale__dinov2",
            crop_mode="paired",
            fine_tuning_mode="full",
            learning_rate=5e-5,
            backbone_learning_rate=1e-5,
            head_learning_rate=1.5e-4,
            warmup_epochs=3,
            early_stop_patience=10,
            epochs=main_epochs,
            batch_size=2,
            warm_start_model_path=str(DEFAULT_WARMSTART_MODEL),
            model_selection_metric="val_auroc",
            medium_crop_scale_factor=2.0,
        ),
        ExperimentSpec(
            name="h6_3scale_nowarm_d15",
            hypothesis="h6_three_scale_lgf",
            architecture="lesion_guided_fusion_3scale__dinov2",
            crop_mode="paired",
            fine_tuning_mode="full",
            learning_rate=5e-5,
            backbone_learning_rate=1e-5,
            head_learning_rate=1.5e-4,
            warmup_epochs=3,
            early_stop_patience=10,
            epochs=main_epochs,
            batch_size=2,
            model_selection_metric="val_auroc",
            medium_crop_scale_factor=1.5,
        ),
        ExperimentSpec(
            name="h7_mil_official_valauroc",
            hypothesis="h7_visit_level_mil_matrix",
            architecture="dinov2_mil",
            crop_mode="automated",
            fine_tuning_mode="full",
            learning_rate=5e-5,
            backbone_learning_rate=1e-5,
            head_learning_rate=1.5e-4,
            warmup_epochs=3,
            early_stop_patience=10,
            epochs=main_epochs,
            batch_size=2,
            case_aggregation="attention_mil",
            model_selection_metric="val_auroc",
            pretraining_source="imagenet",
            use_pretrained=True,
        ),
        ExperimentSpec(
            name="h7_mil_ssl_valauroc",
            hypothesis="h7_visit_level_mil_matrix",
            architecture="dinov2_mil",
            crop_mode="automated",
            fine_tuning_mode="full",
            learning_rate=5e-5,
            backbone_learning_rate=1e-5,
            head_learning_rate=1.5e-4,
            warmup_epochs=3,
            early_stop_patience=10,
            epochs=main_epochs,
            batch_size=2,
            case_aggregation="attention_mil",
            model_selection_metric="val_auroc",
            pretraining_source="ssl",
            use_pretrained=True,
        ),
        ExperimentSpec(
            name="h7_mil_h5backbone_valauroc",
            hypothesis="h7_visit_level_mil_matrix",
            architecture="dinov2_mil",
            crop_mode="automated",
            fine_tuning_mode="full",
            learning_rate=5e-5,
            backbone_learning_rate=1e-5,
            head_learning_rate=1.5e-4,
            warmup_epochs=3,
            early_stop_patience=10,
            epochs=main_epochs,
            batch_size=2,
            case_aggregation="attention_mil",
            warm_start_model_path=str(DEFAULT_H5_WARMSTART_MODEL),
            model_selection_metric="val_auroc",
            pretraining_source="scratch",
            use_pretrained=False,
        ),
    ]


def build_status_payload(
    *,
    overall_status: str,
    current_experiment: str | None,
    completed_experiments: list[str],
    current_epoch: int | None = None,
    total_epochs: int | None = None,
    current_train_loss: float | None = None,
    current_val_acc: float | None = None,
) -> dict[str, Any]:
    return {
        "overall_status": overall_status,
        "current_experiment": current_experiment,
        "completed_experiments": completed_experiments,
        "current_epoch": current_epoch,
        "total_epochs": total_epochs,
        "current_train_loss": current_train_loss,
        "current_val_acc": current_val_acc,
    }


def load_reference(reference_result_path: Path) -> tuple[dict[str, Any], str]:
    payload = load_json(reference_result_path)
    result = payload.get("result", payload)
    split = dict(result["patient_split"])
    ssl_checkpoint_path = str(result.get("ssl_checkpoint_path") or "").strip()
    if not ssl_checkpoint_path:
        raise ValueError(f"SSL checkpoint path missing in reference result: {reference_result_path}")
    return split, ssl_checkpoint_path


def filter_experiments(specs: list[ExperimentSpec], selected_names: list[str] | None) -> list[ExperimentSpec]:
    if not selected_names:
        return specs
    selected = {name.strip() for name in selected_names if name.strip()}
    return [spec for spec in specs if spec.name in selected]


def build_tiny_split(
    split: dict[str, Any],
    *,
    tiny_train_patients: int,
    tiny_val_patients: int,
    tiny_test_patients: int,
) -> dict[str, Any]:
    train_ids = list(split["train_patient_ids"])[:tiny_train_patients]
    val_ids = list(split["val_patient_ids"])[:tiny_val_patients]
    test_ids = list(split["test_patient_ids"])[:tiny_test_patients]
    return {
        **split,
        "split_id": f"{split.get('split_id', 'split')}_tiny",
        "strategy": "patient_level_fixed_tiny_train_val_test",
        "train_patient_ids": train_ids,
        "val_patient_ids": val_ids,
        "test_patient_ids": test_ids,
        "n_train_patients": len(train_ids),
        "n_val_patients": len(val_ids),
        "n_test_patients": len(test_ids),
        "total_patients": len(train_ids) + len(val_ids) + len(test_ids),
    }


def training_input_policy_for_crop_mode(workflow: ResearchWorkflowService, crop_mode: str, architecture: str) -> str:
    if is_three_scale_lesion_guided_fusion_architecture(architecture):
        backbone = lesion_guided_fusion_backbone(architecture) or "unknown"
        return f"medsam_cornea_plus_medium_plus_lesion_triscale_fusion__{backbone}"
    return workflow.training_workflow._training_input_policy_for_crop_mode(crop_mode)


def split_records(records: list[dict[str, Any]], split: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    patient_to_records: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        patient_to_records[str(record["patient_id"])].append(record)
    train_records = [record for patient_id in split["train_patient_ids"] for record in patient_to_records[str(patient_id)]]
    val_records = [record for patient_id in split["val_patient_ids"] for record in patient_to_records[str(patient_id)]]
    test_records = [record for patient_id in split["test_patient_ids"] for record in patient_to_records[str(patient_id)]]
    return train_records, val_records, test_records


def build_loaders(
    model_manager: ModelManager,
    *,
    architecture: str,
    records: list[dict[str, Any]],
    split: dict[str, Any],
    batch_size: int,
    medium_crop_scale_factor: float | None = None,
) -> tuple[DataLoader, DataLoader, DataLoader, list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], dict[str, Any], dict[str, Any]]:
    preprocess_metadata = model_manager.preprocess_metadata()
    patient_to_records: dict[str, list[dict[str, Any]]] = defaultdict(list)
    patient_to_label: dict[str, str] = {}
    for record in records:
        patient_id = str(record["patient_id"])
        patient_to_records[patient_id].append(record)
        patient_to_label.setdefault(patient_id, str(record["culture_category"]))
    effective_split = model_manager._build_patient_split(
        patient_ids=list(patient_to_records),
        patient_labels=patient_to_label,
        val_split=float(split.get("val_split") or 0.2),
        test_split=float(split.get("test_split") or 0.2),
        saved_split=split,
        seed=42,
    )
    train_records = [record for patient_id in effective_split["train_patient_ids"] for record in patient_to_records[str(patient_id)]]
    val_records = [record for patient_id in effective_split["val_patient_ids"] for record in patient_to_records[str(patient_id)]]
    test_records = [record for patient_id in effective_split["test_patient_ids"] for record in patient_to_records[str(patient_id)]]

    if is_three_scale_lesion_guided_fusion_architecture(architecture):
        resolved_scale = float(medium_crop_scale_factor or 1.5)

        def with_medium_scale(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
            return [{**record, "medium_crop_scale_factor": resolved_scale} for record in items]

        train_records = with_medium_scale(train_records)
        val_records = with_medium_scale(val_records)
        test_records = with_medium_scale(test_records)

    if is_attention_mil_architecture(architecture):
        train_ds = VisitBagDataset(train_records, augment=True, preprocess_metadata=preprocess_metadata)
        val_ds = VisitBagDataset(val_records, augment=False, preprocess_metadata=preprocess_metadata)
        test_ds = VisitBagDataset(test_records, augment=False, preprocess_metadata=preprocess_metadata)
        train_loader = DataLoader(
            train_ds,
            batch_size=max(1, min(batch_size, len(train_ds))),
            shuffle=True,
            collate_fn=collate_visit_bags,
        )
        val_loader = DataLoader(
            val_ds,
            batch_size=max(1, min(batch_size, len(val_ds))),
            shuffle=False,
            collate_fn=collate_visit_bags,
        )
        test_loader = DataLoader(
            test_ds,
            batch_size=max(1, min(batch_size, len(test_ds))),
            shuffle=False,
            collate_fn=collate_visit_bags,
        )
        return train_loader, val_loader, test_loader, train_records, val_records, test_records, preprocess_metadata, effective_split

    dataset_cls = (
        ThreeScaleLesionGuidedFusionDataset
        if is_three_scale_lesion_guided_fusion_architecture(architecture)
        else LesionGuidedFusionDataset
    ) if is_lesion_guided_fusion_architecture(architecture) else ManifestImageDataset
    train_ds = dataset_cls(train_records, augment=True, preprocess_metadata=preprocess_metadata)
    val_ds = dataset_cls(val_records, augment=False, preprocess_metadata=preprocess_metadata)
    test_ds = dataset_cls(test_records, augment=False, preprocess_metadata=preprocess_metadata)
    train_loader = DataLoader(train_ds, batch_size=max(1, min(batch_size, len(train_ds))), shuffle=True)
    val_loader = DataLoader(val_ds, batch_size=max(1, min(batch_size, len(val_ds))), shuffle=False)
    test_loader = DataLoader(test_ds, batch_size=max(1, min(batch_size, len(test_ds))), shuffle=False)
    return train_loader, val_loader, test_loader, train_records, val_records, test_records, preprocess_metadata, effective_split


def collect_outputs_for_loader(
    model_manager: ModelManager,
    *,
    model: torch.nn.Module,
    architecture: str,
    loader: DataLoader,
    device: str,
) -> dict[str, list[float] | list[int]]:
    if is_attention_mil_architecture(architecture):
        return model_manager._collect_bag_loader_outputs(model, loader, device)
    if is_lesion_guided_fusion_architecture(architecture):
        return model_manager._collect_paired_loader_outputs(model, loader, device)
    return model_manager._collect_loader_outputs(model, loader, device)


def threshold_candidates(positive_probabilities: list[float]) -> list[float]:
    unique_probabilities = sorted({min(max(float(value), 0.0), 1.0) for value in positive_probabilities})
    candidates: set[float] = {0.5}
    candidates.update(unique_probabilities)
    candidates.update(round((left + right) / 2.0, 6) for left, right in zip(unique_probabilities, unique_probabilities[1:]))
    return sorted(candidates)


def build_model_selection_score(
    selection: dict[str, Any],
    *,
    metric: str,
) -> tuple[Any, ...]:
    metrics = selection["selection_metrics"]
    threshold = float(selection["decision_threshold"])
    normalized = str(metric or "balanced_accuracy").strip().lower() or "balanced_accuracy"
    auroc = float(metrics["AUROC"]) if metrics.get("AUROC") is not None else -1.0
    balanced_accuracy = float(metrics.get("balanced_accuracy") or 0.0)
    f1 = float(metrics.get("F1") or 0.0)
    accuracy = float(metrics.get("accuracy") or 0.0)
    sensitivity = float(metrics.get("sensitivity") or 0.0)
    specificity = float(metrics.get("specificity") or 0.0)
    if normalized in {"val_auroc", "auroc"}:
        return (auroc, balanced_accuracy, f1, accuracy, sensitivity, specificity, -abs(threshold - 0.5))
    if normalized in {"val_accuracy", "accuracy"}:
        return (accuracy, balanced_accuracy, f1, auroc, sensitivity, specificity, -abs(threshold - 0.5))
    if normalized in {"val_sensitivity", "sensitivity"}:
        return (sensitivity, balanced_accuracy, specificity, f1, accuracy, auroc, -abs(threshold - 0.5))
    return (balanced_accuracy, f1, accuracy, auroc, sensitivity, specificity, -abs(threshold - 0.5))


def select_threshold_variant(
    model_manager: ModelManager,
    *,
    true_labels: list[int],
    positive_probabilities: list[float],
    strategy: str,
    specificity_floor: float | None,
) -> dict[str, Any]:
    normalized = str(strategy or "balanced_accuracy").strip().lower() or "balanced_accuracy"
    if normalized == "balanced_accuracy":
        selected = model_manager.select_decision_threshold(true_labels, positive_probabilities)
        metrics = selected["selection_metrics"]
        selected["_score_tuple"] = (
            float(metrics.get("balanced_accuracy") or 0.0),
            float(metrics.get("F1") or 0.0),
            float(metrics.get("accuracy") or 0.0),
            float(metrics["AUROC"]) if metrics.get("AUROC") is not None else -1.0,
            -abs(float(selected["decision_threshold"]) - 0.5),
        )
        return selected

    if not true_labels or not positive_probabilities or len(true_labels) != len(positive_probabilities):
        metrics = model_manager.classification_metrics(true_labels, [], positive_probabilities, threshold=0.5)
        return {
            "decision_threshold": 0.5,
            "selection_metric": normalized,
            "selection_metrics": metrics,
            "_score_tuple": (0.0,),
        }

    floor = float(specificity_floor if specificity_floor is not None else 0.5)
    best_result: dict[str, Any] | None = None
    for threshold in threshold_candidates(positive_probabilities):
        metrics = model_manager.classification_metrics(true_labels, [], positive_probabilities, threshold=threshold)
        specificity = float(metrics.get("specificity") or 0.0)
        sensitivity = float(metrics.get("sensitivity") or 0.0)
        balanced_accuracy = float(metrics.get("balanced_accuracy") or 0.0)
        f1 = float(metrics.get("F1") or 0.0)
        accuracy = float(metrics.get("accuracy") or 0.0)
        auroc = float(metrics["AUROC"]) if metrics.get("AUROC") is not None else -1.0
        score_tuple = (
            specificity >= floor,
            sensitivity,
            balanced_accuracy,
            f1,
            accuracy,
            auroc,
            -abs(float(threshold) - 0.5),
        )
        candidate = {
            "decision_threshold": float(threshold),
            "selection_metric": f"{normalized}@spec>={floor:.2f}",
            "selection_metrics": metrics,
            "_score_tuple": score_tuple,
        }
        if best_result is None or candidate["_score_tuple"] > best_result["_score_tuple"]:
            best_result = candidate
    assert best_result is not None
    return best_result


def _extract_canonical_dinov2_backbone_state(
    state_dict: dict[str, Any],
) -> tuple[dict[str, Any], str]:
    prefix_candidates = (
        "backbone_adapter.encoder.backbone.",
        "backbone.",
    )
    for prefix in prefix_candidates:
        matched = {
            key[len(prefix) :]: value
            for key, value in state_dict.items()
            if key.startswith(prefix)
        }
        if matched:
            return matched, prefix

    raw_backbone_state = {
        key: value
        for key, value in state_dict.items()
        if key.startswith("embeddings.") or key.startswith("encoder.")
    }
    if raw_backbone_state:
        return raw_backbone_state, "<raw_backbone>"

    raise ValueError("No canonical DINOv2 backbone weights were found in warm-start checkpoint.")


def _resolve_dinov2_warm_start_target(
    model: torch.nn.Module,
    architecture: str,
) -> tuple[torch.nn.Module, str]:
    normalized_architecture = str(architecture or "").strip().lower()
    if normalized_architecture in {"dinov2", "dinov2_mil"}:
        target_module = getattr(model, "backbone", None)
        if target_module is None:
            raise ValueError(f"{architecture} model does not expose a backbone module for warm-start loading.")
        return target_module, "backbone"

    if lesion_guided_fusion_backbone(architecture) != "dinov2":
        raise ValueError(f"Warm-start is currently implemented only for DINOv2 architectures, got {architecture}")

    target_module = getattr(
        getattr(getattr(model, "backbone_adapter", None), "encoder", None),
        "backbone",
        None,
    )
    if target_module is None:
        raise ValueError("LGF model does not expose backbone_adapter.encoder.backbone for warm-start loading.")
    return target_module, "backbone_adapter.encoder.backbone"


def apply_warm_start_backbone(model: torch.nn.Module, *, architecture: str, warm_start_model_path: str | None) -> dict[str, Any] | None:
    if not warm_start_model_path:
        return None
    checkpoint_path = Path(warm_start_model_path).expanduser().resolve()
    if not checkpoint_path.exists():
        raise FileNotFoundError(f"Warm-start checkpoint does not exist: {checkpoint_path}")
    checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=False)
    state_dict = checkpoint.get("state_dict")
    if not isinstance(state_dict, dict) or not state_dict:
        raise ValueError(f"Warm-start checkpoint does not contain a valid state_dict: {checkpoint_path}")

    source_backbone_state, source_prefix = _extract_canonical_dinov2_backbone_state(state_dict)
    target_module, target_name = _resolve_dinov2_warm_start_target(model, architecture)
    incompatible = target_module.load_state_dict(source_backbone_state, strict=False)
    if incompatible.missing_keys or incompatible.unexpected_keys:
        raise ValueError(
            "Warm-start backbone loading failed: "
            f"missing={list(incompatible.missing_keys)[:8]}, unexpected={list(incompatible.unexpected_keys)[:8]}"
        )
    return {
        "checkpoint_path": str(checkpoint_path),
        "loaded_keys": len(source_backbone_state),
        "source_prefix": source_prefix,
        "target_module": target_name,
    }


def train_custom_experiment(
    *,
    spec: ExperimentSpec,
    model_manager: ModelManager,
    records: list[dict[str, Any]],
    split: dict[str, Any],
    ssl_checkpoint_path: str,
    output_model_path: Path,
    device: str,
    training_input_policy: str,
    progress_callback: Any,
) -> dict[str, Any]:
    train_loader, val_loader, test_loader, train_records, val_records, test_records, preprocess_metadata, effective_split = build_loaders(
        model_manager,
        architecture=spec.architecture,
        records=records,
        split=split,
        batch_size=spec.batch_size,
        medium_crop_scale_factor=spec.medium_crop_scale_factor,
    )

    resolved_ssl_checkpoint_path = ssl_checkpoint_path if str(spec.pretraining_source or "").strip().lower() == "ssl" else None
    model, resolved_pretraining_source, ssl_metadata = model_manager.build_model_for_training(
        spec.architecture,
        pretraining_source=spec.pretraining_source,
        use_pretrained=spec.use_pretrained,
        ssl_checkpoint_path=resolved_ssl_checkpoint_path,
    )
    warm_start_metadata = apply_warm_start_backbone(
        model,
        architecture=spec.architecture,
        warm_start_model_path=spec.warm_start_model_path,
    )
    model = model.to(device)
    resolved_fine_tuning_mode = model_manager.normalize_fine_tuning_mode(spec.fine_tuning_mode)
    model_manager._configure_fine_tuning(
        model,
        spec.architecture,
        fine_tuning_mode=resolved_fine_tuning_mode,
        unfreeze_last_blocks=spec.partial_unfreeze_blocks,
    )

    optimizer = model_manager._build_training_optimizer(
        model,
        spec.architecture,
        learning_rate=spec.learning_rate,
        backbone_learning_rate=spec.backbone_learning_rate,
        head_learning_rate=spec.head_learning_rate,
        weight_decay=1e-4,
    )
    scheduler = model_manager._build_training_scheduler(
        optimizer,
        epochs=spec.epochs,
        learning_rate=spec.learning_rate,
        warmup_epochs=spec.warmup_epochs,
    )

    if is_attention_mil_architecture(spec.architecture):
        train_case_labels = [
            LABEL_TO_INDEX[str(visit_records[0]["culture_category"])]
            for visit_records in train_loader.dataset.visit_records
        ]
        count_unit = len(train_case_labels)
        class_counts = np.bincount(train_case_labels, minlength=len(LABEL_TO_INDEX))
    else:
        count_unit = len(train_records)
        class_counts = np.bincount(
            [LABEL_TO_INDEX[str(item["culture_category"])] for item in train_records],
            minlength=len(LABEL_TO_INDEX),
        )
    class_weights = np.array(
        [0.0 if count == 0 else count_unit / (len(LABEL_TO_INDEX) * count) for count in class_counts],
        dtype=np.float32,
    )
    class_weights[LABEL_TO_INDEX["fungal"]] *= float(spec.fungal_weight_multiplier)
    loss_fn = nn.CrossEntropyLoss(weight=torch.tensor(class_weights, device=device))

    best_score: tuple[Any, ...] | None = None
    best_state: dict[str, Any] = {}
    best_threshold_selection: dict[str, Any] | None = None
    best_epoch = 0
    history: list[dict[str, Any]] = []
    epochs_without_improvement = 0
    stopped_early = False

    for epoch in range(1, spec.epochs + 1):
        model.train()
        train_losses: list[float] = []
        if is_attention_mil_architecture(spec.architecture):
            for batch_inputs, batch_mask, batch_labels in train_loader:
                batch_inputs = batch_inputs.to(device)
                batch_mask = batch_mask.to(device)
                batch_labels = batch_labels.to(device)
                optimizer.zero_grad()
                logits = model_manager._bag_forward(model, batch_inputs, batch_mask)
                loss = loss_fn(logits, batch_labels)
                loss.backward()
                optimizer.step()
                train_losses.append(float(loss.item()))
        elif is_lesion_guided_fusion_architecture(spec.architecture):
            for batch in train_loader:
                optimizer.zero_grad()
                logits, batch_labels = model_manager._paired_forward_from_batch(model, batch, device)
                loss = loss_fn(logits, batch_labels)
                loss.backward()
                optimizer.step()
                train_losses.append(float(loss.item()))
        else:
            for batch_inputs, batch_labels in train_loader:
                batch_inputs = batch_inputs.to(device)
                batch_labels = batch_labels.to(device)
                optimizer.zero_grad()
                logits = model(batch_inputs)
                loss = loss_fn(logits, batch_labels)
                loss.backward()
                optimizer.step()
                train_losses.append(float(loss.item()))
        scheduler.step()

        model.eval()
        val_outputs = collect_outputs_for_loader(
            model_manager,
            model=model,
            architecture=spec.architecture,
            loader=val_loader,
            device=device,
        )
        threshold_selection = select_threshold_variant(
            model_manager,
            true_labels=[int(value) for value in val_outputs["true_labels"]],
            positive_probabilities=[float(value) for value in val_outputs["positive_probabilities"]],
            strategy=spec.threshold_strategy,
            specificity_floor=spec.specificity_floor,
        )
        val_metrics = threshold_selection["selection_metrics"]
        train_loss = float(np.mean(train_losses)) if train_losses else math.nan
        history.append(
            {
                "epoch": epoch,
                "train_loss": train_loss,
                "val_acc": float(val_metrics["accuracy"]),
                "val_auroc": float(val_metrics["AUROC"]) if val_metrics.get("AUROC") is not None else None,
                "val_bal_acc": float(val_metrics["balanced_accuracy"]),
                "val_sensitivity": float(val_metrics["sensitivity"]),
                "val_specificity": float(val_metrics["specificity"]),
            }
        )

        score_tuple = build_model_selection_score(
            threshold_selection,
            metric=spec.model_selection_metric,
        )
        if best_score is None or score_tuple > best_score:
            best_score = score_tuple
            best_state = {key: value.detach().cpu().clone() for key, value in model.state_dict().items()}
            best_threshold_selection = {
                key: value
                for key, value in threshold_selection.items()
                if key != "_score_tuple"
            }
            best_epoch = epoch
            epochs_without_improvement = 0
        else:
            epochs_without_improvement += 1

        progress_callback(epoch, spec.epochs, train_loss, float(val_metrics["accuracy"]))
        if spec.early_stop_patience is not None and epochs_without_improvement >= max(1, int(spec.early_stop_patience)):
            stopped_early = True
            break

    if not best_state or best_threshold_selection is None:
        raise RuntimeError(f"Failed to capture a best model state for experiment {spec.name}")

    model.load_state_dict(best_state)
    output_model_path.parent.mkdir(parents=True, exist_ok=True)
    bag_level = bool(is_attention_mil_architecture(spec.architecture))
    torch.save(
        {
            "architecture": spec.architecture,
            "state_dict": best_state,
            "artifact_metadata": model_manager.build_artifact_metadata(
                architecture=spec.architecture,
                artifact_type="model",
                crop_mode=spec.crop_mode,
                case_aggregation=spec.case_aggregation,
                bag_level=bag_level,
                training_input_policy=training_input_policy,
                preprocess_metadata=preprocess_metadata,
            ),
        },
        output_model_path,
    )

    decision_threshold = float(best_threshold_selection["decision_threshold"])
    train_outputs = collect_outputs_for_loader(
        model_manager,
        model=model,
        architecture=spec.architecture,
        loader=train_loader,
        device=device,
    )
    val_outputs = collect_outputs_for_loader(
        model_manager,
        model=model,
        architecture=spec.architecture,
        loader=val_loader,
        device=device,
    )
    test_outputs = collect_outputs_for_loader(
        model_manager,
        model=model,
        architecture=spec.architecture,
        loader=test_loader,
        device=device,
    )
    train_metrics = model_manager.classification_metrics(
        [int(value) for value in train_outputs["true_labels"]],
        [],
        [float(value) for value in train_outputs["positive_probabilities"]],
        threshold=decision_threshold,
    )
    val_metrics = model_manager.classification_metrics(
        [int(value) for value in val_outputs["true_labels"]],
        [],
        [float(value) for value in val_outputs["positive_probabilities"]],
        threshold=decision_threshold,
    )
    test_metrics = model_manager.classification_metrics(
        [int(value) for value in test_outputs["true_labels"]],
        [],
        [float(value) for value in test_outputs["positive_probabilities"]],
        threshold=decision_threshold,
    )
    train_metrics["n_samples"] = len(train_outputs["true_labels"])
    val_metrics["n_samples"] = len(val_outputs["true_labels"])
    test_metrics["n_samples"] = len(test_outputs["true_labels"])
    n_train_cases = len(train_loader.dataset) if bag_level else None
    n_val_cases = len(val_loader.dataset) if bag_level else None
    n_test_cases = len(test_loader.dataset) if bag_level else None

    return {
        "training_id": f"custom_{spec.name}",
        "output_model_path": str(output_model_path),
        "architecture": spec.architecture,
        "epochs": spec.epochs,
        "n_train": len(train_records),
        "n_val": len(val_records),
        "n_test": len(test_records),
        "n_train_images": len(train_records),
        "n_val_images": len(val_records),
        "n_test_images": len(test_records),
        "n_train_cases": n_train_cases,
        "n_val_cases": n_val_cases,
        "n_test_cases": n_test_cases,
        "n_train_patients": len(effective_split["train_patient_ids"]),
        "n_val_patients": len(effective_split["val_patient_ids"]),
        "n_test_patients": len(effective_split["test_patient_ids"]),
        "best_val_acc": round(float(best_threshold_selection["selection_metrics"]["accuracy"]), 4),
        "best_val_auroc": (
            round(float(best_threshold_selection["selection_metrics"]["AUROC"]), 4)
            if best_threshold_selection["selection_metrics"].get("AUROC") is not None
            else None
        ),
        "best_epoch": int(best_epoch),
        "use_pretrained": resolved_pretraining_source != "scratch",
        "pretraining_source": resolved_pretraining_source,
        "ssl_checkpoint_path": str(resolved_ssl_checkpoint_path) if resolved_ssl_checkpoint_path else None,
        "ssl_checkpoint": ssl_metadata,
        "warm_start_checkpoint": warm_start_metadata,
        "history": history,
        "patient_split": effective_split,
        "decision_threshold": decision_threshold,
        "threshold_selection_metric": best_threshold_selection["selection_metric"],
        "threshold_selection_metrics": best_threshold_selection["selection_metrics"],
        "train_metrics": train_metrics,
        "val_metrics": val_metrics,
        "test_metrics": test_metrics,
        "case_aggregation": "attention_mil" if bag_level else spec.case_aggregation,
        "bag_level": bag_level,
        "evaluation_unit": "visit" if bag_level else "image",
        "fine_tuning_mode": resolved_fine_tuning_mode,
        "backbone_learning_rate": float(spec.backbone_learning_rate) if spec.backbone_learning_rate is not None else None,
        "head_learning_rate": float(spec.head_learning_rate) if spec.head_learning_rate is not None else None,
        "warmup_epochs": int(max(0, spec.warmup_epochs)),
        "early_stop_patience": int(spec.early_stop_patience) if spec.early_stop_patience is not None else None,
        "stopped_early": bool(stopped_early),
        "epochs_completed": len(history),
        "partial_unfreeze_blocks": int(max(1, spec.partial_unfreeze_blocks)),
        "fungal_weight_multiplier": float(spec.fungal_weight_multiplier),
        "model_selection_metric": str(spec.model_selection_metric or "balanced_accuracy"),
        "medium_crop_scale_factor": float(spec.medium_crop_scale_factor) if spec.medium_crop_scale_factor is not None else None,
        "best_train_loss": float(min(item["train_loss"] for item in history)) if history else math.nan,
    }


def evaluate_saved_model(
    model_manager: ModelManager,
    *,
    architecture: str,
    model_path: Path,
    records: list[dict[str, Any]],
    split: dict[str, Any],
    device: str,
    batch_size: int,
    decision_threshold: float,
    medium_crop_scale_factor: float | None = None,
    crop_mode: str | None = None,
    case_aggregation: str | None = None,
    training_input_policy: str | None = None,
) -> dict[str, Any]:
    preprocess_metadata = model_manager.preprocess_metadata()
    train_records, val_records, test_records = split_records(records, split)
    if is_three_scale_lesion_guided_fusion_architecture(architecture):
        resolved_scale = float(medium_crop_scale_factor or 1.5)
        train_records = [{**record, "medium_crop_scale_factor": resolved_scale} for record in train_records]
        val_records = [{**record, "medium_crop_scale_factor": resolved_scale} for record in val_records]
        test_records = [{**record, "medium_crop_scale_factor": resolved_scale} for record in test_records]
    model_reference = {
        "architecture": architecture,
        "model_path": str(model_path),
        "crop_mode": (
            str(crop_mode).strip()
            if crop_mode is not None
            else ("paired" if is_lesion_guided_fusion_architecture(architecture) else "automated")
        ),
        "case_aggregation": (
            str(case_aggregation).strip()
            if case_aggregation is not None
            else ("attention_mil" if is_attention_mil_architecture(architecture) else "mean")
        ),
        "preprocess": preprocess_metadata,
    }
    if training_input_policy is not None:
        model_reference["training_input_policy"] = str(training_input_policy).strip()
    model = model_manager.load_model(model_reference, device)

    if is_attention_mil_architecture(architecture):
        train_ds = VisitBagDataset(train_records, augment=False, preprocess_metadata=preprocess_metadata)
        val_ds = VisitBagDataset(val_records, augment=False, preprocess_metadata=preprocess_metadata)
        test_ds = VisitBagDataset(test_records, augment=False, preprocess_metadata=preprocess_metadata)
        train_loader = DataLoader(train_ds, batch_size=max(1, min(batch_size, len(train_ds))), shuffle=False, collate_fn=collate_visit_bags)
        val_loader = DataLoader(val_ds, batch_size=max(1, min(batch_size, len(val_ds))), shuffle=False, collate_fn=collate_visit_bags)
        test_loader = DataLoader(test_ds, batch_size=max(1, min(batch_size, len(test_ds))), shuffle=False, collate_fn=collate_visit_bags)
        return {
            "train_metrics": model_manager.classification_metrics(
                [int(value) for value in model_manager._collect_bag_loader_outputs(model, train_loader, device)["true_labels"]],
                [],
                [float(value) for value in model_manager._collect_bag_loader_outputs(model, train_loader, device)["positive_probabilities"]],
                threshold=decision_threshold,
            ),
            "val_metrics_recomputed": model_manager.classification_metrics(
                [int(value) for value in model_manager._collect_bag_loader_outputs(model, val_loader, device)["true_labels"]],
                [],
                [float(value) for value in model_manager._collect_bag_loader_outputs(model, val_loader, device)["positive_probabilities"]],
                threshold=decision_threshold,
            ),
            "test_metrics_recomputed": model_manager.classification_metrics(
                [int(value) for value in model_manager._collect_bag_loader_outputs(model, test_loader, device)["true_labels"]],
                [],
                [float(value) for value in model_manager._collect_bag_loader_outputs(model, test_loader, device)["positive_probabilities"]],
                threshold=decision_threshold,
            ),
        }

    if is_lesion_guided_fusion_architecture(architecture):
        dataset_cls = ThreeScaleLesionGuidedFusionDataset if is_three_scale_lesion_guided_fusion_architecture(architecture) else LesionGuidedFusionDataset
        train_ds = dataset_cls(train_records, augment=False, preprocess_metadata=preprocess_metadata)
        val_ds = dataset_cls(val_records, augment=False, preprocess_metadata=preprocess_metadata)
        test_ds = dataset_cls(test_records, augment=False, preprocess_metadata=preprocess_metadata)
        train_loader = DataLoader(train_ds, batch_size=max(1, min(batch_size, len(train_ds))), shuffle=False)
        val_loader = DataLoader(val_ds, batch_size=max(1, min(batch_size, len(val_ds))), shuffle=False)
        test_loader = DataLoader(test_ds, batch_size=max(1, min(batch_size, len(test_ds))), shuffle=False)
        return {
            "train_metrics": model_manager._evaluate_paired_loader(model, train_loader, device, threshold=decision_threshold),
            "val_metrics_recomputed": model_manager._evaluate_paired_loader(model, val_loader, device, threshold=decision_threshold),
            "test_metrics_recomputed": model_manager._evaluate_paired_loader(model, test_loader, device, threshold=decision_threshold),
        }

    dataset_cls = ManifestImageDataset
    train_ds = dataset_cls(train_records, augment=False, preprocess_metadata=preprocess_metadata)
    val_ds = dataset_cls(val_records, augment=False, preprocess_metadata=preprocess_metadata)
    test_ds = dataset_cls(test_records, augment=False, preprocess_metadata=preprocess_metadata)
    train_loader = DataLoader(train_ds, batch_size=max(1, min(batch_size, len(train_ds))), shuffle=False)
    val_loader = DataLoader(val_ds, batch_size=max(1, min(batch_size, len(val_ds))), shuffle=False)
    test_loader = DataLoader(test_ds, batch_size=max(1, min(batch_size, len(test_ds))), shuffle=False)
    return {
        "train_metrics": model_manager._evaluate_loader(model, train_loader, device, threshold=decision_threshold),
        "val_metrics_recomputed": model_manager._evaluate_loader(model, val_loader, device, threshold=decision_threshold),
        "test_metrics_recomputed": model_manager._evaluate_loader(model, test_loader, device, threshold=decision_threshold),
    }


def run_experiment(
    *,
    spec: ExperimentSpec,
    workflow: ResearchWorkflowService,
    site_store: SiteStore,
    manifest_records: list[dict[str, Any]],
    reference_split: dict[str, Any],
    ssl_checkpoint_path: str,
    output_root: Path,
    device: str,
    status_path: Path,
    completed_experiments: list[str],
) -> dict[str, Any]:
    split = reference_split
    if spec.tiny_train_patients and spec.tiny_val_patients and spec.tiny_test_patients:
        split = build_tiny_split(
            reference_split,
            tiny_train_patients=spec.tiny_train_patients,
            tiny_val_patients=spec.tiny_val_patients,
            tiny_test_patients=spec.tiny_test_patients,
        )

    experiment_dir = output_root / spec.name
    experiment_dir.mkdir(parents=True, exist_ok=True)
    output_model_path = experiment_dir / f"{spec.name}.pth"
    records = workflow._prepare_records_for_model(site_store, manifest_records, crop_mode=spec.crop_mode)
    training_input_policy = training_input_policy_for_crop_mode(workflow, spec.crop_mode, spec.architecture)

    def progress_callback(epoch: int, total_epochs: int, train_loss: float, val_acc: float) -> None:
        print(
            f"[{spec.name}] epoch {epoch}/{total_epochs} "
            f"train_loss={train_loss:.4f} val_acc={val_acc:.4f}",
            flush=True,
        )
        write_json(
            status_path,
            build_status_payload(
                overall_status="running",
                current_experiment=spec.name,
                completed_experiments=completed_experiments,
                current_epoch=epoch,
                total_epochs=total_epochs,
                current_train_loss=float(train_loss),
                current_val_acc=float(val_acc),
            ),
        )

    if (
        spec.warm_start_model_path
        or spec.threshold_strategy != "balanced_accuracy"
        or spec.fungal_weight_multiplier != 1.0
        or spec.model_selection_metric != "balanced_accuracy"
        or spec.medium_crop_scale_factor is not None
        or str(spec.pretraining_source or "").strip().lower() != "ssl"
        or not spec.use_pretrained
    ):
        result = train_custom_experiment(
            spec=spec,
            model_manager=workflow.model_manager,
            records=records,
            split=split,
            ssl_checkpoint_path=ssl_checkpoint_path,
            output_model_path=output_model_path,
            device=device,
            training_input_policy=training_input_policy,
            progress_callback=progress_callback,
        )
    else:
        result = workflow.model_manager.initial_train(
            records=records,
            architecture=spec.architecture,
            output_model_path=output_model_path,
            device=device,
            epochs=spec.epochs,
            learning_rate=spec.learning_rate,
            batch_size=spec.batch_size,
            val_split=float(split.get("val_split") or 0.2),
            test_split=float(split.get("test_split") or 0.2),
            use_pretrained=spec.use_pretrained,
            pretraining_source=spec.pretraining_source,
            ssl_checkpoint_path=ssl_checkpoint_path if str(spec.pretraining_source or "").strip().lower() == "ssl" else None,
            saved_split=split,
            crop_mode=spec.crop_mode,
            case_aggregation=spec.case_aggregation,
            training_input_policy=training_input_policy,
            progress_callback=progress_callback,
            fine_tuning_mode=spec.fine_tuning_mode,
            backbone_learning_rate=spec.backbone_learning_rate,
            head_learning_rate=spec.head_learning_rate,
            warmup_epochs=spec.warmup_epochs,
            early_stop_patience=spec.early_stop_patience,
            partial_unfreeze_blocks=spec.partial_unfreeze_blocks,
        )

    recomputed = evaluate_saved_model(
        workflow.model_manager,
        architecture=spec.architecture,
        model_path=output_model_path,
        records=records,
        split=result["patient_split"],
        device=device,
        batch_size=spec.batch_size,
        decision_threshold=float(result["decision_threshold"]),
        medium_crop_scale_factor=spec.medium_crop_scale_factor,
    )
    payload = {
        "spec": asdict(spec),
        "result": result,
        "recomputed_metrics": recomputed,
    }
    write_json(experiment_dir / "result.json", payload)
    return payload


def summarize_result(name: str, hypothesis: str, payload: dict[str, Any]) -> dict[str, Any]:
    result = payload["result"]
    recomputed = payload["recomputed_metrics"]
    train_metrics = recomputed["train_metrics"]
    test_metrics = result["test_metrics"]
    val_metrics = result["val_metrics"]
    return {
        "name": name,
        "hypothesis": hypothesis,
        "architecture": result["architecture"],
        "fine_tuning_mode": result["fine_tuning_mode"],
        "epochs_completed": len(result.get("history", [])),
        "stopped_early": bool(result.get("stopped_early")),
        "evaluation_unit": result.get("evaluation_unit", "image"),
        "n_train_patients": int(result["n_train_patients"]),
        "n_val_patients": int(result["n_val_patients"]),
        "n_test_patients": int(result["n_test_patients"]),
        "n_test_cases": result.get("n_test_cases"),
        "train_acc": float(train_metrics["accuracy"]),
        "train_bal_acc": float(train_metrics["balanced_accuracy"]),
        "train_auroc": float(train_metrics["AUROC"]) if train_metrics.get("AUROC") is not None else None,
        "val_acc": float(val_metrics["accuracy"]),
        "val_bal_acc": float(val_metrics["balanced_accuracy"]),
        "val_auroc": float(val_metrics["AUROC"]) if val_metrics.get("AUROC") is not None else None,
        "test_acc": float(test_metrics["accuracy"]),
        "test_bal_acc": float(test_metrics["balanced_accuracy"]),
        "test_auroc": float(test_metrics["AUROC"]) if test_metrics.get("AUROC") is not None else None,
        "test_sensitivity": float(test_metrics["sensitivity"]),
        "test_specificity": float(test_metrics["specificity"]),
        "test_f1": float(test_metrics["F1"]),
        "test_brier": float(test_metrics["brier_score"]),
        "test_ece": float(test_metrics["ece"]),
        "decision_threshold": float(result["decision_threshold"]),
        "best_val_acc": float(result["best_val_acc"]),
        "best_val_auroc": float(result["best_val_auroc"]) if result.get("best_val_auroc") is not None else None,
        "best_train_loss": float(result.get("best_train_loss", 0.0)),
        "output_model_path": str(result["output_model_path"]),
    }


def write_summary_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    args = parse_args()
    output_root = make_output_root(args)
    output_root.mkdir(parents=True, exist_ok=True)
    status_path = output_root / "status.json"
    write_json(
        status_path,
        build_status_payload(
            overall_status="starting",
            current_experiment=None,
            completed_experiments=[],
        ),
    )

    reference_split, ssl_checkpoint_path = load_reference(args.reference_result.expanduser().resolve())
    control_plane = ControlPlaneStore()
    workflow = ResearchWorkflowService(control_plane)
    site_store = SiteStore(args.site_id)
    manifest_records = site_store.generate_manifest().to_dict("records")

    selected_specs = filter_experiments(
        build_default_experiments(args.main_epochs, args.overfit_epochs),
        args.experiments,
    )
    completed: list[str] = []
    payloads: dict[str, Any] = {}
    summary_rows: list[dict[str, Any]] = []

    for spec in selected_specs:
        write_json(
            status_path,
            build_status_payload(
                overall_status="running",
                current_experiment=spec.name,
                completed_experiments=completed,
            ),
        )
        payload = run_experiment(
            spec=spec,
            workflow=workflow,
            site_store=site_store,
            manifest_records=manifest_records,
            reference_split=reference_split,
            ssl_checkpoint_path=ssl_checkpoint_path,
            output_root=output_root,
            device=args.device,
            status_path=status_path,
            completed_experiments=completed,
        )
        payloads[spec.name] = payload
        summary_rows.append(summarize_result(spec.name, spec.hypothesis, payload))
        completed.append(spec.name)

    write_json(output_root / "all_results.json", payloads)
    write_summary_csv(output_root / "summary.csv", summary_rows)
    write_json(
        status_path,
        build_status_payload(
            overall_status="completed",
            current_experiment=None,
            completed_experiments=completed,
        ),
    )
    print(json.dumps({"output_root": str(output_root), "experiments": completed}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
