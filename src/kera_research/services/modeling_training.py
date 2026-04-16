from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import numpy as np

from kera_research.domain import (
    DENSENET_VARIANTS,
    LABEL_TO_INDEX,
    MODEL_OUTPUT_CLASS_COUNT,
    is_attention_mil_architecture,
    is_lesion_guided_fusion_architecture,
    is_paired_attention_mil_architecture,
    is_three_scale_lesion_guided_fusion_architecture,
    lesion_guided_fusion_backbone,
    make_id,
)
from kera_research.services.modeling_data import (
    LesionGuidedFusionDataset,
    ManifestImageDataset,
    PairedCropDataset,
    ThreeScaleLesionGuidedFusionDataset,
    VisitBagDataset,
    VisitPairedBagDataset,
    collate_visit_bags,
    collate_visit_paired_bags,
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


def _require_torch() -> None:
    if torch is None or nn is None or F is None:
        raise RuntimeError("PyTorch is required for model inference and training.")


TRAINING_PRETRAINING_SOURCES = ("scratch", "imagenet", "ssl")
TRAINING_FINE_TUNING_MODES = ("full", "linear_probe", "partial")
SSL_BACKBONE_ARCHITECTURE_BY_MODEL = {
    "densenet121": "densenet121",
    "densenet121_mil": "densenet121",
    "convnext_tiny": "convnext_tiny",
    "convnext_tiny_mil": "convnext_tiny",
    "efficientnet_v2_s": "efficientnet_v2_s",
    "efficientnet_v2_s_mil": "efficientnet_v2_s",
    "vit": "vit",
    "swin": "swin",
    "dinov2": "dinov2",
    "dinov2_mil": "dinov2",
    "swin_mil": "swin",
    "dual_input_concat": "dinov2",
}
IMAGENET_PRETRAINED_ARCHITECTURES = {
    "vit",
    "swin",
    "convnext_tiny",
    "convnext_tiny_mil",
    "efficientnet_v2_s",
    "efficientnet_v2_s_mil",
    "efficientnet_v2_s_dinov2_lesion_mil",
    "dinov2",
    "dinov2_mil",
    "swin_mil",
    "densenet121_mil",
    "dual_input_concat",
    *DENSENET_VARIANTS,
}


def _ssl_backbone_architecture_for_model_name(architecture: str | None) -> str | None:
    normalized = str(architecture or "").strip().lower()
    if is_lesion_guided_fusion_architecture(normalized):
        return lesion_guided_fusion_backbone(normalized)
    return SSL_BACKBONE_ARCHITECTURE_BY_MODEL.get(normalized)


def fine_tune(
    manager: Any,
    *,
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
    _require_torch()
    if not records:
        raise ValueError("No records are available for fine-tuning.")

    model = manager.load_model(base_model_reference, device)
    architecture = base_model_reference.get("architecture", "densenet121")
    if is_attention_mil_architecture(architecture):
        return fine_tune_attention_mil(
            manager,
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
    preprocess_metadata = manager.resolve_preprocess_metadata(base_model_reference)
    if manager.is_dual_input_architecture(architecture):
        dataset = (
            (
                ThreeScaleLesionGuidedFusionDataset(records, preprocess_metadata=preprocess_metadata)
                if is_three_scale_lesion_guided_fusion_architecture(architecture)
                else LesionGuidedFusionDataset(records, preprocess_metadata=preprocess_metadata)
            )
            if is_lesion_guided_fusion_architecture(architecture)
            else PairedCropDataset(records, preprocess_metadata=preprocess_metadata)
        )
    else:
        dataset = ManifestImageDataset(records, preprocess_metadata=preprocess_metadata)
    loader = DataLoader(dataset, batch_size=max(1, min(int(batch_size), len(records))), shuffle=True)
    if not full_finetune:
        freeze_backbone(model, architecture)

    optimizer = torch.optim.Adam(
        [param for param in model.parameters() if param.requires_grad],
        lr=float(learning_rate),
    )
    loss_fn = nn.CrossEntropyLoss()

    model.train()
    epoch_losses: list[float] = []
    total_epochs = max(1, int(epochs))
    for epoch in range(1, total_epochs + 1):
        batch_losses: list[float] = []
        if manager.is_dual_input_architecture(architecture):
            for batch in loader:
                optimizer.zero_grad()
                logits, batch_labels = manager._paired_forward_from_batch(model, batch, device)
                loss = loss_fn(logits, batch_labels)
                loss.backward()
                optimizer.step()
                batch_losses.append(float(loss.item()))
        else:
            for batch_inputs, batch_labels in loader:
                batch_inputs = batch_inputs.to(device)
                batch_labels = batch_labels.to(device)
                optimizer.zero_grad()
                logits = model(batch_inputs)
                loss = loss_fn(logits, batch_labels)
                loss.backward()
                optimizer.step()
                batch_losses.append(float(loss.item()))
        train_loss = float(np.mean(batch_losses)) if batch_losses else math.nan
        epoch_losses.append(train_loss)
        if progress_callback is not None:
            progress_callback(epoch, total_epochs, train_loss, None)

    output = Path(output_model_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "architecture": architecture,
            "state_dict": model.state_dict(),
            "artifact_metadata": manager.build_artifact_metadata(
                architecture=architecture,
                artifact_type="model",
                crop_mode=str(base_model_reference.get("crop_mode") or ""),
                case_aggregation=str(
                    base_model_reference.get("case_aggregation") or manager.normalize_case_aggregation(None, architecture)
                ),
                bag_level=bool(base_model_reference.get("bag_level", is_attention_mil_architecture(architecture))),
                training_input_policy=str(base_model_reference.get("training_input_policy") or ""),
                preprocess_metadata=preprocess_metadata,
            ),
        },
        output,
    )

    return {
        "training_id": make_id("train"),
        "output_model_path": str(output),
        "architecture": architecture,
        "epochs": total_epochs,
        "full_finetune": bool(full_finetune),
        "learning_rate": float(learning_rate),
        "batch_size": max(1, min(int(batch_size), len(records))),
        "average_loss": float(np.nanmean(epoch_losses)),
    }


def fine_tune_attention_mil(
    manager: Any,
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
    _require_torch()
    architecture = str(base_model_reference.get("architecture") or "efficientnet_v2_s_mil")
    preprocess_metadata = manager.resolve_preprocess_metadata(base_model_reference)
    dataset_cls = VisitPairedBagDataset if is_paired_attention_mil_architecture(architecture) else VisitBagDataset
    collate_fn = collate_visit_paired_bags if is_paired_attention_mil_architecture(architecture) else collate_visit_bags
    train_ds = dataset_cls(records, augment=True, preprocess_metadata=preprocess_metadata)
    train_case_count = len(train_ds)
    if train_case_count <= 0:
        raise ValueError("No visit-level MIL bags are available for fine-tuning.")

    effective_batch_size = max(1, min(int(batch_size), train_case_count))
    train_loader = DataLoader(train_ds, batch_size=effective_batch_size, shuffle=True, collate_fn=collate_fn)
    if not full_finetune:
        freeze_backbone(model, architecture)

    optimizer = torch.optim.Adam(
        [param for param in model.parameters() if param.requires_grad],
        lr=float(learning_rate),
    )
    train_case_labels = [LABEL_TO_INDEX[str(visit_records[0]["culture_category"])] for visit_records in train_ds.visit_records]
    class_counts = np.bincount(train_case_labels, minlength=MODEL_OUTPUT_CLASS_COUNT)
    class_weights = np.array(
        [0.0 if count == 0 else len(train_case_labels) / (MODEL_OUTPUT_CLASS_COUNT * count) for count in class_counts],
        dtype=np.float32,
    )
    loss_fn = nn.CrossEntropyLoss(weight=torch.tensor(class_weights, device=device))

    model.train()
    epoch_losses: list[float] = []
    total_epochs = max(1, int(epochs))
    for epoch in range(1, total_epochs + 1):
        batch_losses: list[float] = []
        for batch_inputs, batch_mask, batch_labels in train_loader:
            batch_inputs = manager._bag_inputs_to_device(batch_inputs, device)
            batch_mask = batch_mask.to(device)
            batch_labels = batch_labels.to(device)
            optimizer.zero_grad()
            logits = manager._bag_forward(model, batch_inputs, batch_mask)
            loss = loss_fn(logits, batch_labels)
            loss.backward()
            optimizer.step()
            batch_losses.append(float(loss.item()))
        train_loss = float(np.mean(batch_losses)) if batch_losses else math.nan
        epoch_losses.append(train_loss)
        if progress_callback is not None:
            progress_callback(epoch, total_epochs, train_loss, None)

    output = Path(output_model_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "architecture": architecture,
            "state_dict": model.state_dict(),
            "artifact_metadata": manager.build_artifact_metadata(
                architecture=architecture,
                artifact_type="model",
                crop_mode=str(base_model_reference.get("crop_mode") or ""),
                case_aggregation=str(
                    base_model_reference.get("case_aggregation") or manager.normalize_case_aggregation(None, architecture)
                ),
                bag_level=bool(base_model_reference.get("bag_level", is_attention_mil_architecture(architecture))),
                training_input_policy=str(base_model_reference.get("training_input_policy") or ""),
                preprocess_metadata=preprocess_metadata,
            ),
        },
        output,
    )

    return {
        "training_id": make_id("train"),
        "output_model_path": str(output),
        "architecture": architecture,
        "epochs": total_epochs,
        "full_finetune": bool(full_finetune),
        "learning_rate": float(learning_rate),
        "batch_size": effective_batch_size,
        "average_loss": float(np.nanmean(epoch_losses)),
        "n_train": len(records),
        "n_train_cases": train_case_count,
        "n_train_images": len(records),
        "case_aggregation": str(
            base_model_reference.get("case_aggregation") or manager.normalize_case_aggregation(None, architecture)
        ),
        "bag_level": True,
    }


def freeze_backbone(model: nn.Module, architecture: str) -> None:
    if is_lesion_guided_fusion_architecture(architecture):
        for parameter in model.parameters():
            parameter.requires_grad = False
        fusion_head_modules = [
            getattr(model, "medium_projection", None),
            getattr(model, "lesion_projection", None),
            getattr(model, "context_projection", None),
            getattr(model, "channel_gate", None),
            getattr(model, "spatial_attention", None),
            getattr(model, "fusion_projection", None),
            getattr(model, "classifier", None),
        ]
        for module in fusion_head_modules:
            if module is None:
                continue
            for parameter in module.parameters():
                parameter.requires_grad = True
        return
    if architecture == "cnn":
        for parameter in model.features.parameters():
            parameter.requires_grad = False
        return
    if architecture == "vit":
        for parameter in model.parameters():
            parameter.requires_grad = False
        for parameter in model.heads.parameters():
            parameter.requires_grad = True
        return
    if architecture == "swin":
        for parameter in model.parameters():
            parameter.requires_grad = False
        for parameter in model.head.parameters():
            parameter.requires_grad = True
        return
    if architecture == "convnext_tiny":
        for parameter in model.parameters():
            parameter.requires_grad = False
        for parameter in model.classifier.parameters():
            parameter.requires_grad = True
        return
    if architecture == "efficientnet_v2_s":
        for parameter in model.parameters():
            parameter.requires_grad = False
        for parameter in model.classifier.parameters():
            parameter.requires_grad = True
        return
    if architecture == "efficientnet_v2_s_dinov2_lesion_mil":
        for parameter in model.parameters():
            parameter.requires_grad = False
        for parameter in model.full_backbone.parameters():
            parameter.requires_grad = False
        for module in (model.lesion_projection, model.fusion_projection, model.attention_pool, model.classifier):
            for parameter in module.parameters():
                parameter.requires_grad = True
        return
    if architecture == "dinov2":
        for parameter in model.parameters():
            parameter.requires_grad = False
        for parameter in model.classifier.parameters():
            parameter.requires_grad = True
        return
    if is_attention_mil_architecture(architecture):
        for parameter in model.parameters():
            parameter.requires_grad = False
        for module in (model.attention_pool, model.classifier):
            for parameter in module.parameters():
                parameter.requires_grad = True
        return
    if architecture == "dual_input_concat":
        for parameter in model.parameters():
            parameter.requires_grad = False
        for module in (model.fusion_projection, model.classifier):
            for parameter in module.parameters():
                parameter.requires_grad = True
        return
    if architecture in DENSENET_VARIANTS:
        for parameter in model.parameters():
            parameter.requires_grad = False
        for parameter in model.classifier.parameters():
            parameter.requires_grad = True
        return
    raise ValueError(f"Unsupported architecture: {architecture}")


def normalize_training_pretraining_source(
    pretraining_source: str | None,
    *,
    use_pretrained: bool = True,
) -> str:
    normalized = str(pretraining_source or "").strip().lower()
    if not normalized:
        return "imagenet" if use_pretrained else "scratch"
    if normalized == "pretrained":
        return "imagenet"
    if normalized not in TRAINING_PRETRAINING_SOURCES:
        raise ValueError(
            f"Unsupported pretraining source: {pretraining_source}. "
            f"Supported: {', '.join(TRAINING_PRETRAINING_SOURCES)}"
        )
    return normalized


def normalize_fine_tuning_mode(fine_tuning_mode: str | None) -> str:
    normalized = str(fine_tuning_mode or "full").strip().lower() or "full"
    if normalized not in TRAINING_FINE_TUNING_MODES:
        raise ValueError(
            f"Unsupported fine-tuning mode: {fine_tuning_mode}. "
            f"Supported: {', '.join(TRAINING_FINE_TUNING_MODES)}"
        )
    return normalized


def head_modules(model: nn.Module, architecture: str) -> list[nn.Module]:
    if is_lesion_guided_fusion_architecture(architecture):
        return [
            module
            for module in [
                getattr(model, "medium_projection", None),
                getattr(model, "lesion_projection", None),
                getattr(model, "context_projection", None),
                getattr(model, "channel_gate", None),
                getattr(model, "spatial_attention", None),
                getattr(model, "fusion_projection", None),
                getattr(model, "classifier", None),
            ]
            if module is not None
        ]
    if architecture == "cnn":
        return [model.classifier]
    if architecture == "vit":
        return [model.heads]
    if architecture == "swin":
        return [model.head]
    if architecture == "convnext_tiny":
        return [model.classifier]
    if architecture == "efficientnet_v2_s":
        return [model.classifier]
    if architecture == "efficientnet_v2_s_dinov2_lesion_mil":
        return [model.lesion_projection, model.fusion_projection, model.attention_pool, model.classifier]
    if architecture == "dinov2":
        return [model.classifier]
    if is_attention_mil_architecture(architecture):
        return [model.attention_pool, model.classifier]
    if architecture == "dual_input_concat":
        return [model.fusion_projection, model.classifier]
    if architecture in DENSENET_VARIANTS:
        return [model.classifier]
    raise ValueError(f"Unsupported architecture: {architecture}")


def freeze_all_parameters(model: nn.Module) -> None:
    for parameter in model.parameters():
        parameter.requires_grad = False


def unfreeze_module_parameters(module: nn.Module) -> None:
    for parameter in module.parameters():
        parameter.requires_grad = True


def unfreeze_last_children(module: nn.Module, count: int) -> None:
    children = [child for child in module.children()]
    if not children:
        unfreeze_module_parameters(module)
        return
    for child in children[-max(1, count):]:
        unfreeze_module_parameters(child)


def enable_partial_backbone(
    model: nn.Module,
    architecture: str,
    *,
    unfreeze_last_blocks: int,
) -> None:
    block_count = max(1, int(unfreeze_last_blocks))
    normalized = str(architecture or "").strip().lower()

    if normalized == "vit":
        layers = getattr(model.encoder, "layers", None)
        if layers is None:
            raise ValueError("ViT encoder layers are not available for partial fine-tuning.")
        for layer in list(layers.children())[-block_count:]:
            unfreeze_module_parameters(layer)
        return

    if normalized == "swin":
        unfreeze_last_children(model.features, block_count)
        if hasattr(model, "norm"):
            unfreeze_module_parameters(model.norm)
        return

    if normalized == "convnext_tiny":
        unfreeze_last_children(model.features, block_count)
        return

    if normalized == "efficientnet_v2_s":
        unfreeze_last_children(model.features, block_count)
        return

    if normalized in DENSENET_VARIANTS:
        unfreeze_last_children(model.features, block_count)
        return

    if normalized in {"dinov2", "dinov2_mil", "swin_mil", "dual_input_concat"}:
        if normalized == "swin_mil":
            unfreeze_last_children(model.backbone.features, block_count)
            if hasattr(model.backbone, "norm"):
                unfreeze_module_parameters(model.backbone.norm)
            return
        backbone = getattr(model, "backbone", None)
        encoder = getattr(backbone, "encoder", None)
        layers = getattr(encoder, "layer", None)
        if layers is not None:
            for layer in list(layers)[-block_count:]:
                unfreeze_module_parameters(layer)
            return
        if backbone is None:
            raise ValueError(f"{architecture} does not expose a backbone for partial fine-tuning.")
        unfreeze_last_children(backbone, block_count)
        return

    if normalized == "cnn":
        unfreeze_last_children(model.features, block_count)
        return

    if is_lesion_guided_fusion_architecture(normalized):
        backbone = getattr(model, "backbone", None)
        if backbone is None:
            raise ValueError(f"{architecture} does not expose a backbone for partial fine-tuning.")
        unfreeze_last_children(backbone, block_count)
        return

    if normalized == "efficientnet_v2_s_dinov2_lesion_mil":
        unfreeze_last_children(model.full_backbone.features, block_count)
        return

    raise ValueError(f"Partial fine-tuning is not supported for architecture: {architecture}")


def configure_fine_tuning(
    model: nn.Module,
    architecture: str,
    *,
    fine_tuning_mode: str,
    unfreeze_last_blocks: int,
) -> None:
    normalized_mode = normalize_fine_tuning_mode(fine_tuning_mode)
    if normalized_mode == "full":
        return
    freeze_backbone(model, architecture)
    if normalized_mode == "partial":
        enable_partial_backbone(model, architecture, unfreeze_last_blocks=unfreeze_last_blocks)


def build_training_optimizer(
    model: nn.Module,
    architecture: str,
    *,
    learning_rate: float,
    backbone_learning_rate: float | None,
    head_learning_rate: float | None,
    weight_decay: float = 1e-4,
) -> torch.optim.Optimizer:
    _require_torch()
    trainable_parameters = [parameter for parameter in model.parameters() if parameter.requires_grad]
    if not trainable_parameters:
        raise ValueError("No trainable parameters remain after applying the requested fine-tuning mode.")

    head_parameter_ids = {
        id(parameter)
        for module in head_modules(model, architecture)
        for parameter in module.parameters()
        if parameter.requires_grad
    }
    head_parameters = [parameter for parameter in trainable_parameters if id(parameter) in head_parameter_ids]
    backbone_parameters = [parameter for parameter in trainable_parameters if id(parameter) not in head_parameter_ids]
    if not head_parameters or not backbone_parameters:
        return torch.optim.Adam(
            trainable_parameters,
            lr=float(head_learning_rate or learning_rate),
            weight_decay=weight_decay,
        )

    return torch.optim.Adam(
        [
            {
                "params": backbone_parameters,
                "lr": float(backbone_learning_rate or learning_rate),
            },
            {
                "params": head_parameters,
                "lr": float(head_learning_rate or learning_rate),
            },
        ],
        weight_decay=weight_decay,
    )


def build_training_scheduler(
    optimizer: torch.optim.Optimizer,
    *,
    epochs: int,
    learning_rate: float,
    warmup_epochs: int,
) -> torch.optim.lr_scheduler.LRScheduler:
    _require_torch()
    safe_epochs = max(1, int(epochs))
    safe_warmup_epochs = max(0, min(int(warmup_epochs), max(0, safe_epochs - 1)))
    if safe_warmup_epochs <= 0:
        return torch.optim.lr_scheduler.CosineAnnealingLR(
            optimizer,
            T_max=safe_epochs,
            eta_min=float(learning_rate) * 1e-2,
        )

    warmup = torch.optim.lr_scheduler.LinearLR(
        optimizer,
        start_factor=0.2,
        end_factor=1.0,
        total_iters=safe_warmup_epochs,
    )
    cosine = torch.optim.lr_scheduler.CosineAnnealingLR(
        optimizer,
        T_max=max(1, safe_epochs - safe_warmup_epochs),
        eta_min=float(learning_rate) * 1e-2,
    )
    return torch.optim.lr_scheduler.SequentialLR(
        optimizer,
        schedulers=[warmup, cosine],
        milestones=[safe_warmup_epochs],
    )


def supports_imagenet_pretraining(architecture: str) -> bool:
    normalized = str(architecture or "").strip().lower()
    return normalized in IMAGENET_PRETRAINED_ARCHITECTURES or is_lesion_guided_fusion_architecture(normalized)


def ssl_backbone_architecture_for_model(architecture: str) -> str:
    resolved = _ssl_backbone_architecture_for_model_name(architecture)
    if not resolved:
        raise ValueError(f"SSL initialization is not supported for architecture: {architecture}.")
    return resolved


def ssl_target_module(model: nn.Module, architecture: str) -> nn.Module:
    normalized = str(architecture or "").strip().lower()
    if is_lesion_guided_fusion_architecture(normalized):
        backbone = getattr(model, "backbone", None)
        if backbone is None:
            raise ValueError(f"{architecture} does not expose a backbone module for SSL initialization.")
        return backbone
    if normalized in DENSENET_VARIANTS:
        return getattr(model, "model", model)
    if normalized == "convnext_tiny":
        return getattr(model, "model", model)
    if normalized in {"vit", "swin", "efficientnet_v2_s"}:
        return model
    if normalized in {
        "dinov2",
        "dinov2_mil",
        "swin_mil",
        "efficientnet_v2_s_mil",
        "convnext_tiny_mil",
        "densenet121_mil",
        "dual_input_concat",
    }:
        backbone = getattr(model, "backbone", None)
        if backbone is None:
            raise ValueError(f"{architecture} does not expose a backbone module for SSL initialization.")
        return backbone
    raise ValueError(f"SSL initialization is not supported for architecture: {architecture}.")


def allowed_missing_ssl_keys(architecture: str) -> tuple[str, ...]:
    normalized = str(architecture or "").strip().lower()
    if is_lesion_guided_fusion_architecture(normalized):
        return ()
    if normalized in DENSENET_VARIANTS:
        return ("classifier.",)
    if normalized == "convnext_tiny":
        return ("classifier.",)
    if normalized == "vit":
        return ("heads.",)
    if normalized == "swin":
        return ("head.",)
    if normalized == "swin_mil":
        return ("head.",)
    if normalized == "efficientnet_v2_s_mil":
        return ("classifier.",)
    if normalized == "convnext_tiny_mil":
        return ("classifier.",)
    if normalized == "densenet121_mil":
        return ("classifier.",)
    if normalized == "efficientnet_v2_s":
        return ("classifier.",)
    return ()


def normalize_ssl_state_dict_for_target(
    state_dict: dict[str, Any],
    target_module: nn.Module,
) -> dict[str, Any]:
    normalized = dict(state_dict)

    def add_candidate(
        candidates: list[dict[str, Any]],
        seen_signatures: set[tuple[str, ...]],
        candidate: dict[str, Any],
    ) -> None:
        signature = tuple(sorted(candidate.keys()))
        if signature in seen_signatures:
            return
        seen_signatures.add(signature)
        candidates.append(candidate)

    candidates: list[dict[str, Any]] = []
    seen_signatures: set[tuple[str, ...]] = set()
    add_candidate(candidates, seen_signatures, normalized)

    if any(key.startswith("module.") for key in normalized):
        add_candidate(
            candidates,
            seen_signatures,
            {key.replace("module.", "", 1): value for key, value in normalized.items()},
        )

    base_candidates = list(candidates)
    for candidate in base_candidates:
        if any(key.startswith("backbone.") for key in candidate):
            add_candidate(
                candidates,
                seen_signatures,
                {
                    key.replace("backbone.", "", 1) if key.startswith("backbone.") else key: value
                    for key, value in candidate.items()
                },
            )
        else:
            add_candidate(
                candidates,
                seen_signatures,
                {f"backbone.{key}": value for key, value in candidate.items()},
            )

    target_keys = set(target_module.state_dict().keys())
    if not target_keys:
        return normalized

    def score(candidate: dict[str, Any]) -> tuple[int, int]:
        overlap = sum(1 for key in candidate if key in target_keys)
        exact_prefix_bonus = 1 if any(key.startswith("backbone.") for key in candidate) == any(
            key.startswith("backbone.") for key in target_keys
        ) else 0
        return overlap, exact_prefix_bonus

    return max(candidates, key=score)


def adapt_ssl_state_dict_shapes(
    state_dict: dict[str, Any],
    target_module: nn.Module,
) -> dict[str, Any]:
    target_state = target_module.state_dict()
    adapted = dict(state_dict)

    for key, value in list(adapted.items()):
        target_value = target_state.get(key)
        if target_value is None or not hasattr(value, "shape") or not hasattr(target_value, "shape"):
            continue
        if tuple(value.shape) == tuple(target_value.shape):
            continue
        resized = resize_ssl_tensor_for_target(key, value, target_value)
        if resized is not None:
            adapted[key] = resized

    return adapted


def resize_ssl_tensor_for_target(
    key: str,
    source_tensor: Any,
    target_tensor: Any,
) -> Any | None:
    if torch is None or F is None:
        return None
    if not key.endswith("position_embeddings"):
        return None
    if source_tensor.ndim != 3 or target_tensor.ndim != 3:
        return None
    if source_tensor.shape[0] != 1 or target_tensor.shape[0] != 1:
        return None
    if source_tensor.shape[2] != target_tensor.shape[2]:
        return None
    if source_tensor.shape[1] <= 1 or target_tensor.shape[1] <= 1:
        return None

    source_cls = source_tensor[:, :1, :]
    source_patches = source_tensor[:, 1:, :]
    target_patch_count = int(target_tensor.shape[1] - 1)

    source_grid = int(round(math.sqrt(int(source_patches.shape[1]))))
    target_grid = int(round(math.sqrt(target_patch_count)))
    if source_grid * source_grid != int(source_patches.shape[1]):
        return None
    if target_grid * target_grid != target_patch_count:
        return None

    patch_tokens = source_patches.transpose(1, 2).reshape(1, int(source_tensor.shape[2]), source_grid, source_grid)
    resized = F.interpolate(
        patch_tokens,
        size=(target_grid, target_grid),
        mode="bicubic",
        align_corners=False,
    )
    resized = resized.reshape(1, int(source_tensor.shape[2]), target_patch_count).transpose(1, 2)
    resized = resized.to(dtype=target_tensor.dtype)
    return torch.cat([source_cls.to(dtype=target_tensor.dtype), resized], dim=1)


def load_ssl_encoder_into_model(
    manager: Any,
    model: nn.Module,
    architecture: str,
    ssl_checkpoint_path: str | Path,
) -> dict[str, Any]:
    _require_torch()
    checkpoint_path = Path(ssl_checkpoint_path).expanduser().resolve()
    if not checkpoint_path.exists():
        raise FileNotFoundError(f"SSL checkpoint does not exist: {checkpoint_path}")
    checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=False)
    if not isinstance(checkpoint, dict):
        raise ValueError("SSL checkpoint format is invalid.")
    state_dict = checkpoint.get("state_dict")
    if not isinstance(state_dict, dict) or not state_dict:
        raise ValueError("SSL checkpoint does not contain an encoder state_dict.")

    expected_backbone = ssl_backbone_architecture_for_model(architecture)
    checkpoint_architecture = str(checkpoint.get("architecture") or "").strip().lower()
    if checkpoint_architecture and checkpoint_architecture != expected_backbone:
        raise ValueError(
            f"SSL checkpoint architecture mismatch: expected {expected_backbone}, found {checkpoint_architecture}."
        )

    target_module = ssl_target_module(model, architecture)
    state_dict = normalize_ssl_state_dict_for_target(state_dict, target_module)
    state_dict = adapt_ssl_state_dict_shapes(state_dict, target_module)
    incompatible = target_module.load_state_dict(state_dict, strict=False)
    missing_keys = [
        key
        for key in incompatible.missing_keys
        if not any(key.startswith(prefix) for prefix in allowed_missing_ssl_keys(architecture))
    ]
    unexpected_keys = list(incompatible.unexpected_keys)
    if missing_keys or unexpected_keys:
        raise ValueError(
            "SSL checkpoint could not be applied cleanly: "
            f"missing={missing_keys[:8]}, unexpected={unexpected_keys[:8]}"
        )
    return {
        "checkpoint_path": str(checkpoint_path),
        "checkpoint_architecture": checkpoint_architecture or expected_backbone,
        "checkpoint_epoch": checkpoint.get("epoch"),
        "checkpoint_records_count": checkpoint.get("records_count"),
    }


def build_model_for_training(
    manager: Any,
    architecture: str,
    *,
    pretraining_source: str | None = None,
    use_pretrained: bool = True,
    ssl_checkpoint_path: str | Path | None = None,
    num_classes: int = MODEL_OUTPUT_CLASS_COUNT,
) -> tuple[nn.Module, str, dict[str, Any] | None]:
    normalized_source = normalize_training_pretraining_source(
        pretraining_source,
        use_pretrained=use_pretrained,
    )
    if normalized_source == "ssl":
        if not ssl_checkpoint_path:
            raise ValueError("ssl_checkpoint_path is required when pretraining_source='ssl'.")
        model = manager.build_model(architecture)
        ssl_metadata = load_ssl_encoder_into_model(manager, model, architecture, ssl_checkpoint_path)
        return model, normalized_source, ssl_metadata
    if normalized_source == "imagenet" and supports_imagenet_pretraining(architecture):
        return manager.build_model_pretrained(architecture, num_classes=num_classes), normalized_source, None
    return manager.build_model(architecture), "scratch", None
