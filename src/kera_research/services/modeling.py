from __future__ import annotations

import math
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from kera_research.domain import (
    DENSENET_VARIANTS,
    LABEL_TO_INDEX,
    MODEL_OUTPUT_CLASS_COUNT,
    LESION_GUIDED_FUSION_ARCHITECTURES,
    is_attention_mil_architecture,
    is_dual_input_training_architecture,
    is_lesion_guided_fusion_architecture,
    is_paired_attention_mil_architecture,
    is_three_scale_lesion_guided_fusion_architecture,
)
from kera_research.services.modeling_data import (
    DEFAULT_IMAGE_SIZE,
    ManifestImageDataset,
    PairedCropDataset,
    ThreeScaleLesionGuidedFusionDataset,
    VisitBagDataset,
    VisitPairedBagDataset,
    _apply_preprocess_to_tensor,
    _augment_cornea_tensor_and_mask,
    _augment_tensor,
    _extract_medium_crop_tensor,
    _imagenet_preprocess_metadata,
    _legacy_preprocess_metadata,
    _load_image_tensor,
    _load_mask_tensor,
    _normalize_view,
    _preprocess_image_size,
    _preprocess_signature_from_metadata,
    collate_visit_bags,
    collate_visit_paired_bags,
    preprocess_image,
)
from kera_research.services.modeling_architectures import (
    AttentionMILPool,
    ConvNeXtTinyAttentionMIL,
    ConvNeXtTinyKeratitis,
    DenseNetAttentionMIL,
    DenseNetKeratitis,
    Dinov2AttentionMIL,
    Dinov2FeatureExtractor,
    Dinov2Keratitis,
    DualInputConcatKeratitis,
    EfficientNetDinov2LesionAttentionMIL,
    EfficientNetV2AttentionMIL,
    SwinAttentionMIL,
    TinyKeratitisCNN,
    TinyPatchViT,
    TinySwinLike,
)
from kera_research.services.modeling_evaluation import (
    bag_forward as _bag_forward_impl,
    bag_inputs_to_device as _bag_inputs_to_device_impl,
    build_patient_split as _build_patient_split_impl,
    build_prediction_records as _build_prediction_records_impl,
    classification_metrics as _classification_metrics_impl,
    collect_bag_loader_outputs as _collect_bag_loader_outputs_impl,
    collect_loader_outputs as _collect_loader_outputs_impl,
    collect_paired_loader_outputs as _collect_paired_loader_outputs_impl,
    evaluate_loader as _evaluate_loader_impl,
    evaluate_paired_loader as _evaluate_paired_loader_impl,
    image_prediction_rows_from_records as _image_prediction_rows_from_records_impl,
    normalize_case_aggregation as _normalize_case_aggregation_impl,
    paired_forward_from_batch as _paired_forward_from_batch_impl,
    predicted_labels_from_threshold as _predicted_labels_from_threshold_impl,
    select_decision_threshold as _select_decision_threshold_impl,
    split_ids_with_fallback as _split_ids_with_fallback_impl,
    visit_prediction_rows_from_records as _visit_prediction_rows_from_records_impl,
)
from kera_research.services.modeling_runtime import (
    build_model as _build_model_impl,
    build_model_pretrained as _build_model_pretrained_impl,
)
from kera_research.services.modeling_manager_runtime import ModelManagerRuntimeMixin
from kera_research.services.modeling_training import (
    adapt_ssl_state_dict_shapes as _adapt_ssl_state_dict_shapes_impl,
    allowed_missing_ssl_keys as _allowed_missing_ssl_keys_impl,
    build_model_for_training as _build_model_for_training_impl,
    build_training_optimizer as _build_training_optimizer_impl,
    build_training_scheduler as _build_training_scheduler_impl,
    configure_fine_tuning as _configure_fine_tuning_impl,
    enable_partial_backbone as _enable_partial_backbone_impl,
    fine_tune as _fine_tune_impl,
    fine_tune_attention_mil as _fine_tune_attention_mil_impl,
    freeze_all_parameters as _freeze_all_parameters_impl,
    freeze_backbone as _freeze_backbone_impl,
    head_modules as _head_modules_impl,
    load_ssl_encoder_into_model as _load_ssl_encoder_into_model_impl,
    normalize_fine_tuning_mode as _normalize_fine_tuning_mode_impl,
    normalize_ssl_state_dict_for_target as _normalize_ssl_state_dict_for_target_impl,
    normalize_training_pretraining_source as _normalize_training_pretraining_source_impl,
    resize_ssl_tensor_for_target as _resize_ssl_tensor_for_target_impl,
    ssl_backbone_architecture_for_model as _ssl_backbone_architecture_for_model_impl,
    ssl_target_module as _ssl_target_module_impl,
    supports_imagenet_pretraining as _supports_imagenet_pretraining_impl,
    unfreeze_last_children as _unfreeze_last_children_impl,
    unfreeze_module_parameters as _unfreeze_module_parameters_impl,
)
from kera_research.services.modeling_training_runs import (
    build_cross_validation_splits as _build_cross_validation_splits_impl,
    cross_validate as _cross_validate_impl,
    initial_train as _initial_train_impl,
    initial_train_attention_mil as _initial_train_attention_mil_impl,
    refit_all_cases as _refit_all_cases_impl,
)
from kera_research.services.modeling_deltas import (
    aggregate_weight_deltas as _aggregate_weight_deltas_impl,
    save_weight_delta as _save_weight_delta_impl,
    validate_deltas as _validate_deltas_impl,
)
from kera_research.services.modeling_metadata import (
    baseline_model_settings as _baseline_model_settings_impl,
    build_artifact_metadata as _build_artifact_metadata_impl,
    checkpoint_metadata as _checkpoint_metadata_impl,
    ensure_baseline_models as _ensure_baseline_models_impl,
    model_preprocess_metadata as _model_preprocess_metadata_impl,
    resolve_preprocess_metadata as _resolve_preprocess_metadata_impl,
    validate_model_artifact as _validate_model_artifact_impl,
)
from kera_research.services.modeling_manager_helpers import (
    legacy_preprocess_metadata as _legacy_preprocess_metadata_helper,
    preprocess_metadata as _preprocess_metadata_helper,
    preprocess_signature as _preprocess_signature_helper,
    resolve_model_path as _resolve_model_path_helper,
    resolve_model_reference as _resolve_model_reference_helper,
    supports_gradcam as _supports_gradcam_helper,
)
from kera_research.services.model_artifacts import ModelArtifactStore
from kera_research.services.lesion_guided_fusion import (
    LesionGuidedFusionKeratitis,
    ThreeScaleLesionGuidedFusionKeratitis,
)

try:
    import torch
    import torch.nn.functional as F
    from torch import nn
    from torch.utils.data import DataLoader
except ImportError:  # pragma: no cover - dependency guard
    torch = None
    F = None
    nn = None
    DataLoader = None

try:
    import torchvision.models as _torchvision_models
    _TORCHVISION_AVAILABLE = True
except ImportError:  # pragma: no cover
    _torchvision_models = None
    _TORCHVISION_AVAILABLE = False


def require_torch() -> None:
    if torch is None or nn is None or F is None:
        raise RuntimeError("PyTorch is required for model inference and training.")


def seed_everything(seed: int = 42) -> None:
    random.seed(seed)
    np.random.seed(seed)
    if torch is not None:
        torch.manual_seed(seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(seed)


DEFAULT_NUM_CLASSES = MODEL_OUTPUT_CLASS_COUNT
DEFAULT_CASE_AGGREGATION = "mean"
CASE_AGGREGATIONS = ("mean", "logit_mean", "quality_weighted_mean", "attention_mil")
DUAL_INPUT_ARCHITECTURES = ("dual_input_concat", *LESION_GUIDED_FUSION_ARCHITECTURES)




@dataclass
class Prediction:
    predicted_label: str
    probability: float
    logits: list[float]


class ModelManager(ModelManagerRuntimeMixin):
    def __init__(self) -> None:
        seed_everything()
        self.artifact_store = ModelArtifactStore()
        self._model_cache: dict[tuple[str, str], nn.Module] = {}

    def is_dual_input_architecture(self, architecture: str | None) -> bool:
        return is_dual_input_training_architecture(architecture)

    def supports_gradcam(self, architecture: str | None) -> bool:
        return _supports_gradcam_helper(
            is_lesion_guided_fusion_architecture,
            architecture,
        )

    def preprocess_metadata(self, image_size: int = DEFAULT_IMAGE_SIZE) -> dict[str, Any]:
        return _preprocess_metadata_helper(
            _imagenet_preprocess_metadata,
            image_size=image_size,
        )

    def legacy_preprocess_metadata(self, image_size: int = DEFAULT_IMAGE_SIZE) -> dict[str, Any]:
        return _legacy_preprocess_metadata_helper(
            _legacy_preprocess_metadata,
            image_size=image_size,
        )

    def preprocess_signature(self, image_size: int = DEFAULT_IMAGE_SIZE) -> str:
        return _preprocess_signature_helper(
            _preprocess_signature_from_metadata,
            self.preprocess_metadata(image_size=image_size),
        )

    def legacy_preprocess_signature(self, image_size: int = DEFAULT_IMAGE_SIZE) -> str:
        return _preprocess_signature_helper(
            _preprocess_signature_from_metadata,
            self.legacy_preprocess_metadata(image_size=image_size),
        )

    def resolve_preprocess_metadata(
        self,
        model_reference: dict[str, Any] | None = None,
        checkpoint_metadata: dict[str, Any] | None = None,
        *,
        image_size: int = DEFAULT_IMAGE_SIZE,
    ) -> dict[str, Any]:
        return _resolve_preprocess_metadata_impl(
            self,
            model_reference,
            checkpoint_metadata,
            image_size=image_size,
        )

    def model_preprocess_metadata(
        self,
        model: nn.Module,
        model_reference: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return _model_preprocess_metadata_impl(self, model, model_reference)

    def build_artifact_metadata(
        self,
        *,
        architecture: str,
        artifact_type: str = "model",
        crop_mode: str | None = None,
        case_aggregation: str | None = None,
        bag_level: bool | None = None,
        training_input_policy: str | None = None,
        image_size: int = DEFAULT_IMAGE_SIZE,
        num_classes: int = DEFAULT_NUM_CLASSES,
        preprocess_metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return _build_artifact_metadata_impl(
            self,
            architecture=architecture,
            artifact_type=artifact_type,
            crop_mode=crop_mode,
            case_aggregation=case_aggregation,
            bag_level=bag_level,
            training_input_policy=training_input_policy,
            image_size=image_size,
            num_classes=num_classes,
            preprocess_metadata=preprocess_metadata,
        )

    def _checkpoint_metadata(self, checkpoint: Any) -> dict[str, Any]:
        return _checkpoint_metadata_impl(checkpoint)

    def validate_model_artifact(
        self,
        model_reference: dict[str, Any],
        checkpoint: Any,
    ) -> dict[str, Any]:
        return _validate_model_artifact_impl(
            self,
            model_reference,
            checkpoint,
            default_num_classes=DEFAULT_NUM_CLASSES,
        )

    def baseline_model_settings(self, template: dict[str, Any]) -> dict[str, Any]:
        return _baseline_model_settings_impl(self, template)

    def build_model(self, architecture: str) -> nn.Module:
        return _build_model_impl(self, architecture)

    def ensure_baseline_models(self) -> list[dict[str, Any]]:
        return _ensure_baseline_models_impl(
            self,
            default_num_classes=DEFAULT_NUM_CLASSES,
        )

    def resolve_model_reference(
        self,
        model_reference: dict[str, Any],
        *,
        allow_download: bool | None = None,
    ) -> dict[str, Any]:
        return _resolve_model_reference_helper(
            self.artifact_store,
            model_reference,
            allow_download=allow_download,
        )

    def resolve_model_path(
        self,
        model_reference: dict[str, Any],
        *,
        allow_download: bool | None = None,
    ) -> str:
        return _resolve_model_path_helper(
            self.artifact_store,
            model_reference,
            allow_download=allow_download,
        )

    def fine_tune(
        self,
        records: list[dict[str, Any]],
        base_model_reference: dict[str, Any],
        output_model_path: str | Path,
        device: str,
        full_finetune: bool,
        epochs: int,
        learning_rate: float = 1e-3,
        batch_size: int = 8,
        progress_callback: Any = None,
    ) -> dict[str, Any]:
        return _fine_tune_impl(
            self,
            records=records,
            base_model_reference=base_model_reference,
            output_model_path=output_model_path,
            device=device,
            full_finetune=full_finetune,
            epochs=epochs,
            learning_rate=learning_rate,
            batch_size=batch_size,
            progress_callback=progress_callback,
        )

    def _fine_tune_attention_mil(
        self,
        *,
        records: list[dict[str, Any]],
        base_model_reference: dict[str, Any],
        model: nn.Module,
        output_model_path: str | Path,
        device: str,
        full_finetune: bool,
        epochs: int,
        learning_rate: float,
        batch_size: int,
        progress_callback: Any = None,
    ) -> dict[str, Any]:
        return _fine_tune_attention_mil_impl(
            self,
            records=records,
            base_model_reference=base_model_reference,
            model=model,
            output_model_path=output_model_path,
            device=device,
            full_finetune=full_finetune,
            epochs=epochs,
            learning_rate=learning_rate,
            batch_size=batch_size,
            progress_callback=progress_callback,
        )

    def _freeze_backbone(self, model: nn.Module, architecture: str) -> None:
        _freeze_backbone_impl(model, architecture)

    def build_model_pretrained(self, architecture: str, num_classes: int = 2) -> nn.Module:
        return _build_model_pretrained_impl(self, architecture, num_classes=num_classes)

    def normalize_training_pretraining_source(
        self,
        pretraining_source: str | None,
        *,
        use_pretrained: bool = True,
    ) -> str:
        return _normalize_training_pretraining_source_impl(
            pretraining_source,
            use_pretrained=use_pretrained,
        )

    def normalize_fine_tuning_mode(self, fine_tuning_mode: str | None) -> str:
        return _normalize_fine_tuning_mode_impl(fine_tuning_mode)

    def _head_modules(self, model: nn.Module, architecture: str) -> list[nn.Module]:
        return _head_modules_impl(model, architecture)

    def _freeze_all_parameters(self, model: nn.Module) -> None:
        _freeze_all_parameters_impl(model)

    def _unfreeze_module_parameters(self, module: nn.Module) -> None:
        _unfreeze_module_parameters_impl(module)

    def _unfreeze_last_children(self, module: nn.Module, count: int) -> None:
        _unfreeze_last_children_impl(module, count)

    def _enable_partial_backbone(self, model: nn.Module, architecture: str, *, unfreeze_last_blocks: int) -> None:
        _enable_partial_backbone_impl(
            model,
            architecture,
            unfreeze_last_blocks=unfreeze_last_blocks,
        )

    def _configure_fine_tuning(
        self,
        model: nn.Module,
        architecture: str,
        *,
        fine_tuning_mode: str,
        unfreeze_last_blocks: int,
    ) -> None:
        _configure_fine_tuning_impl(
            model,
            architecture,
            fine_tuning_mode=fine_tuning_mode,
            unfreeze_last_blocks=unfreeze_last_blocks,
        )

    def _build_training_optimizer(
        self,
        model: nn.Module,
        architecture: str,
        *,
        learning_rate: float,
        backbone_learning_rate: float | None,
        head_learning_rate: float | None,
        weight_decay: float = 1e-4,
    ) -> torch.optim.Optimizer:
        return _build_training_optimizer_impl(
            model,
            architecture,
            learning_rate=learning_rate,
            backbone_learning_rate=backbone_learning_rate,
            head_learning_rate=head_learning_rate,
            weight_decay=weight_decay,
        )

    def _build_training_scheduler(
        self,
        optimizer: torch.optim.Optimizer,
        *,
        epochs: int,
        learning_rate: float,
        warmup_epochs: int,
    ) -> torch.optim.lr_scheduler.LRScheduler:
        return _build_training_scheduler_impl(
            optimizer,
            epochs=epochs,
            learning_rate=learning_rate,
            warmup_epochs=warmup_epochs,
        )

    def supports_imagenet_pretraining(self, architecture: str) -> bool:
        return _supports_imagenet_pretraining_impl(architecture)

    def ssl_backbone_architecture_for_model(self, architecture: str) -> str:
        return _ssl_backbone_architecture_for_model_impl(architecture)

    def _ssl_target_module(self, model: nn.Module, architecture: str) -> nn.Module:
        return _ssl_target_module_impl(model, architecture)

    def _allowed_missing_ssl_keys(self, architecture: str) -> tuple[str, ...]:
        return _allowed_missing_ssl_keys_impl(architecture)

    def _normalize_ssl_state_dict_for_target(
        self,
        state_dict: dict[str, Any],
        target_module: nn.Module,
    ) -> dict[str, Any]:
        return _normalize_ssl_state_dict_for_target_impl(state_dict, target_module)

    def _adapt_ssl_state_dict_shapes(
        self,
        state_dict: dict[str, Any],
        target_module: nn.Module,
    ) -> dict[str, Any]:
        return _adapt_ssl_state_dict_shapes_impl(state_dict, target_module)

    def _resize_ssl_tensor_for_target(
        self,
        key: str,
        source_tensor: Any,
        target_tensor: Any,
    ) -> Any | None:
        return _resize_ssl_tensor_for_target_impl(key, source_tensor, target_tensor)

    def load_ssl_encoder_into_model(
        self,
        model: nn.Module,
        architecture: str,
        ssl_checkpoint_path: str | Path,
    ) -> dict[str, Any]:
        return _load_ssl_encoder_into_model_impl(self, model, architecture, ssl_checkpoint_path)

    def build_model_for_training(
        self,
        architecture: str,
        *,
        pretraining_source: str | None = None,
        use_pretrained: bool = True,
        ssl_checkpoint_path: str | Path | None = None,
        num_classes: int = DEFAULT_NUM_CLASSES,
    ) -> tuple[nn.Module, str, dict[str, Any] | None]:
        return _build_model_for_training_impl(
            self,
            architecture,
            pretraining_source=pretraining_source,
            use_pretrained=use_pretrained,
            ssl_checkpoint_path=ssl_checkpoint_path,
            num_classes=num_classes,
        )

    def _split_ids_with_fallback(
        self,
        patient_ids: list[str],
        patient_labels: dict[str, str],
        test_size: int,
        seed: int,
    ) -> tuple[list[str], list[str]]:
        return _split_ids_with_fallback_impl(patient_ids, patient_labels, test_size, seed)

    def normalize_case_aggregation(self, value: str | None, architecture: str | None = None) -> str:
        return _normalize_case_aggregation_impl(
            value,
            architecture,
            default_case_aggregation=DEFAULT_CASE_AGGREGATION,
            case_aggregations=CASE_AGGREGATIONS,
        )

    def _bag_inputs_to_device(
        self,
        batch_inputs: torch.Tensor | tuple[torch.Tensor, ...] | list[torch.Tensor],
        device: str,
    ) -> torch.Tensor | tuple[torch.Tensor, ...]:
        return _bag_inputs_to_device_impl(batch_inputs, device)

    def _bag_forward(
        self,
        model: nn.Module,
        batch_inputs: torch.Tensor | tuple[torch.Tensor, ...] | list[torch.Tensor],
        batch_mask: torch.Tensor | None = None,
        *,
        return_attention: bool = False,
    ) -> torch.Tensor | tuple[torch.Tensor, torch.Tensor]:
        return _bag_forward_impl(
            model,
            batch_inputs,
            batch_mask,
            return_attention=return_attention,
        )

    def _collect_bag_loader_outputs(
        self,
        model: nn.Module,
        loader: DataLoader,
        device: str,
    ) -> dict[str, list[float] | list[int]]:
        return _collect_bag_loader_outputs_impl(model, loader, device)

    def _build_patient_split(
        self,
        patient_ids: list[str],
        patient_labels: dict[str, str],
        val_split: float,
        test_split: float,
        saved_split: dict[str, Any] | None = None,
        seed: int = 42,
    ) -> dict[str, Any]:
        return _build_patient_split_impl(
            self,
            patient_ids,
            patient_labels,
            val_split,
            test_split,
            saved_split=saved_split,
            seed=seed,
        )

    def _predicted_labels_from_threshold(
        self,
        positive_probabilities: list[float],
        threshold: float = 0.5,
    ) -> list[int]:
        return _predicted_labels_from_threshold_impl(positive_probabilities, threshold=threshold)

    def _image_prediction_rows_from_records(self, records: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return _image_prediction_rows_from_records_impl(records)

    def _visit_prediction_rows_from_records(self, visit_records: list[list[dict[str, Any]]]) -> list[dict[str, Any]]:
        return _visit_prediction_rows_from_records_impl(visit_records)

    def _build_prediction_records(
        self,
        sample_rows: list[dict[str, Any]],
        positive_probabilities: list[float],
        *,
        threshold: float = 0.5,
    ) -> list[dict[str, Any]]:
        return _build_prediction_records_impl(
            sample_rows,
            positive_probabilities,
            threshold=threshold,
        )

    def _collect_loader_outputs(
        self,
        model: nn.Module,
        loader: DataLoader,
        device: str,
    ) -> dict[str, list[float] | list[int]]:
        return _collect_loader_outputs_impl(model, loader, device)

    def _paired_forward_from_batch(
        self,
        model: nn.Module,
        batch: Any,
        device: str,
    ) -> tuple[torch.Tensor, torch.Tensor]:
        return _paired_forward_from_batch_impl(model, batch, device)

    def _collect_paired_loader_outputs(
        self,
        model: nn.Module,
        loader: DataLoader,
        device: str,
    ) -> dict[str, list[float] | list[int]]:
        return _collect_paired_loader_outputs_impl(model, loader, device)

    def _evaluate_loader(
        self,
        model: nn.Module,
        loader: DataLoader,
        device: str,
        threshold: float = 0.5,
    ) -> dict[str, Any]:
        return _evaluate_loader_impl(self, model, loader, device, threshold=threshold)

    def _evaluate_paired_loader(
        self,
        model: nn.Module,
        loader: DataLoader,
        device: str,
        threshold: float = 0.5,
    ) -> dict[str, Any]:
        return _evaluate_paired_loader_impl(self, model, loader, device, threshold=threshold)

    def select_decision_threshold(
        self,
        true_labels: list[int],
        positive_probabilities: list[float],
    ) -> dict[str, Any]:
        return _select_decision_threshold_impl(true_labels, positive_probabilities)

    def _build_cross_validation_splits(
        self,
        patient_ids: list[str],
        patient_labels: dict[str, str],
        num_folds: int,
        val_split: float,
        seed: int = 42,
    ) -> list[dict[str, Any]]:
        return _build_cross_validation_splits_impl(
            self,
            patient_ids,
            patient_labels,
            num_folds,
            val_split,
            seed=seed,
        )

    def _initial_train_attention_mil(
        self,
        *,
        records: list[dict[str, Any]],
        architecture: str,
        output_model_path: str | Path,
        device: str,
        epochs: int,
        learning_rate: float,
        batch_size: int,
        val_split: float,
        test_split: float,
        use_pretrained: bool,
        pretraining_source: str | None,
        ssl_checkpoint_path: str | Path | None,
        saved_split: dict[str, Any] | None,
        crop_mode: str | None,
        training_input_policy: str | None,
        progress_callback: Any,
        fine_tuning_mode: str,
        backbone_learning_rate: float | None,
        head_learning_rate: float | None,
        warmup_epochs: int,
        early_stop_patience: int | None,
        partial_unfreeze_blocks: int,
    ) -> dict[str, Any]:
        return _initial_train_attention_mil_impl(
            self,
            records=records,
            architecture=architecture,
            output_model_path=output_model_path,
            device=device,
            epochs=epochs,
            learning_rate=learning_rate,
            batch_size=batch_size,
            val_split=val_split,
            test_split=test_split,
            use_pretrained=use_pretrained,
            pretraining_source=pretraining_source,
            ssl_checkpoint_path=ssl_checkpoint_path,
            saved_split=saved_split,
            crop_mode=crop_mode,
            training_input_policy=training_input_policy,
            progress_callback=progress_callback,
            fine_tuning_mode=fine_tuning_mode,
            backbone_learning_rate=backbone_learning_rate,
            head_learning_rate=head_learning_rate,
            warmup_epochs=warmup_epochs,
            early_stop_patience=early_stop_patience,
            partial_unfreeze_blocks=partial_unfreeze_blocks,
        )

    def initial_train(
        self,
        records: list[dict[str, Any]],
        architecture: str,
        output_model_path: str | Path,
        device: str,
        epochs: int = 30,
        learning_rate: float = 1e-4,
        batch_size: int = 16,
        val_split: float = 0.2,
        test_split: float = 0.2,
        use_pretrained: bool = True,
        pretraining_source: str | None = None,
        ssl_checkpoint_path: str | Path | None = None,
        saved_split: dict[str, Any] | None = None,
        crop_mode: str | None = None,
        case_aggregation: str | None = None,
        training_input_policy: str | None = None,
        progress_callback: Any = None,
        fine_tuning_mode: str = "full",
        backbone_learning_rate: float | None = None,
        head_learning_rate: float | None = None,
        warmup_epochs: int = 0,
        early_stop_patience: int | None = None,
        partial_unfreeze_blocks: int = 1,
    ) -> dict[str, Any]:
        return _initial_train_impl(
            self,
            records=records,
            architecture=architecture,
            output_model_path=output_model_path,
            device=device,
            epochs=epochs,
            learning_rate=learning_rate,
            batch_size=batch_size,
            val_split=val_split,
            test_split=test_split,
            use_pretrained=use_pretrained,
            pretraining_source=pretraining_source,
            ssl_checkpoint_path=ssl_checkpoint_path,
            saved_split=saved_split,
            crop_mode=crop_mode,
            case_aggregation=case_aggregation,
            training_input_policy=training_input_policy,
            progress_callback=progress_callback,
            fine_tuning_mode=fine_tuning_mode,
            backbone_learning_rate=backbone_learning_rate,
            head_learning_rate=head_learning_rate,
            warmup_epochs=warmup_epochs,
            early_stop_patience=early_stop_patience,
            partial_unfreeze_blocks=partial_unfreeze_blocks,
        )

    def refit_all_cases(
        self,
        records: list[dict[str, Any]],
        architecture: str,
        output_model_path: str | Path,
        device: str,
        epochs: int = 30,
        learning_rate: float = 1e-4,
        batch_size: int = 16,
        use_pretrained: bool = True,
        pretraining_source: str | None = None,
        ssl_checkpoint_path: str | Path | None = None,
        crop_mode: str | None = None,
        case_aggregation: str | None = None,
        training_input_policy: str | None = None,
        progress_callback: Any = None,
        fine_tuning_mode: str = "full",
        backbone_learning_rate: float | None = None,
        head_learning_rate: float | None = None,
        warmup_epochs: int = 0,
        early_stop_patience: int | None = None,
        partial_unfreeze_blocks: int = 1,
    ) -> dict[str, Any]:
        return _refit_all_cases_impl(
            self,
            records=records,
            architecture=architecture,
            output_model_path=output_model_path,
            device=device,
            epochs=epochs,
            learning_rate=learning_rate,
            batch_size=batch_size,
            use_pretrained=use_pretrained,
            pretraining_source=pretraining_source,
            ssl_checkpoint_path=ssl_checkpoint_path,
            crop_mode=crop_mode,
            case_aggregation=case_aggregation,
            training_input_policy=training_input_policy,
            progress_callback=progress_callback,
            fine_tuning_mode=fine_tuning_mode,
            backbone_learning_rate=backbone_learning_rate,
            head_learning_rate=head_learning_rate,
            warmup_epochs=warmup_epochs,
            early_stop_patience=early_stop_patience,
            partial_unfreeze_blocks=partial_unfreeze_blocks,
        )

    def cross_validate(
        self,
        records: list[dict[str, Any]],
        architecture: str,
        output_dir: str | Path,
        device: str,
        num_folds: int = 5,
        epochs: int = 30,
        learning_rate: float = 1e-4,
        batch_size: int = 16,
        val_split: float = 0.2,
        use_pretrained: bool = True,
        pretraining_source: str | None = None,
        ssl_checkpoint_path: str | Path | None = None,
        case_aggregation: str | None = None,
        progress_callback: Any = None,
    ) -> dict[str, Any]:
        return _cross_validate_impl(
            self,
            records=records,
            architecture=architecture,
            output_dir=output_dir,
            device=device,
            num_folds=num_folds,
            epochs=epochs,
            learning_rate=learning_rate,
            batch_size=batch_size,
            val_split=val_split,
            use_pretrained=use_pretrained,
            pretraining_source=pretraining_source,
            ssl_checkpoint_path=ssl_checkpoint_path,
            case_aggregation=case_aggregation,
            progress_callback=progress_callback,
        )

    def save_weight_delta(
        self,
        base_model_path: str | Path,
        tuned_model_path: str | Path,
        output_delta_path: str | Path,
        *,
        clip_l2_norm: float | None = None,
        noise_multiplier: float | None = None,
        quantization_bits: int | None = None,
    ) -> str:
        return _save_weight_delta_impl(
            self,
            base_model_path,
            tuned_model_path,
            output_delta_path,
            clip_l2_norm=clip_l2_norm,
            noise_multiplier=noise_multiplier,
            quantization_bits=quantization_bits,
        )

    def _validate_deltas(self, deltas: list[dict]) -> None:
        return _validate_deltas_impl(deltas)

    def aggregate_weight_deltas(
        self,
        delta_paths: list[str | Path],
        output_path: str | Path,
        weights: list[float] | None = None,
        base_model_path: str | Path | None = None,
        *,
        strategy: str | None = None,
        trim_ratio: float | None = None,
    ) -> str:
        return _aggregate_weight_deltas_impl(
            self,
            delta_paths,
            output_path,
            weights=weights,
            base_model_path=base_model_path,
            strategy=strategy,
            trim_ratio=trim_ratio,
        )

    def classification_metrics(
        self,
        true_labels: list[int],
        predicted_labels: list[int],
        positive_probabilities: list[float],
        threshold: float | None = None,
    ) -> dict[str, Any]:
        return _classification_metrics_impl(
            true_labels,
            predicted_labels,
            positive_probabilities,
            threshold=threshold,
        )
