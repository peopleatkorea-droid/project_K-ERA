from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np


def _deps():
    from kera_research.services import modeling as md

    return md


def build_model(manager: Any, architecture: str) -> Any:
    md = _deps()
    md.require_torch()
    if md.is_three_scale_lesion_guided_fusion_architecture(architecture):
        return md.ThreeScaleLesionGuidedFusionKeratitis(
            architecture,
            num_classes=md.DEFAULT_NUM_CLASSES,
            init_mode="random",
        )
    if md.is_lesion_guided_fusion_architecture(architecture):
        return md.LesionGuidedFusionKeratitis(
            architecture,
            num_classes=md.DEFAULT_NUM_CLASSES,
            init_mode="random",
        )
    if architecture == "cnn":
        return md.TinyKeratitisCNN()
    if architecture == "vit":
        if not md._TORCHVISION_AVAILABLE:
            raise RuntimeError(
                "torchvision is required for ViT. Run uv sync --frozen --extra cpu --extra dev (or --extra gpu)."
            )
        backbone = md._torchvision_models.vit_b_16(weights=None)
        in_features = backbone.heads.head.in_features
        backbone.heads.head = md.nn.Linear(in_features, md.DEFAULT_NUM_CLASSES)
        return backbone
    if architecture == "swin":
        if not md._TORCHVISION_AVAILABLE:
            raise RuntimeError(
                "torchvision is required for Swin. Run uv sync --frozen --extra cpu --extra dev (or --extra gpu)."
            )
        backbone = md._torchvision_models.swin_t(weights=None)
        in_features = backbone.head.in_features
        backbone.head = md.nn.Linear(in_features, md.DEFAULT_NUM_CLASSES)
        return backbone
    if architecture == "convnext_tiny":
        return md.ConvNeXtTinyKeratitis()
    if architecture == "efficientnet_v2_s":
        if not md._TORCHVISION_AVAILABLE:
            raise RuntimeError(
                "torchvision is required for EfficientNetV2-S. Run uv sync --frozen --extra cpu --extra dev (or --extra gpu)."
            )
        backbone = md._torchvision_models.efficientnet_v2_s(weights=None)
        in_features = backbone.classifier[-1].in_features
        backbone.classifier[-1] = md.nn.Linear(in_features, md.DEFAULT_NUM_CLASSES)
        return backbone
    if architecture == "dinov2":
        return md.Dinov2Keratitis(pretrained=False)
    if architecture == "dinov2_mil":
        return md.Dinov2AttentionMIL(pretrained=False)
    if architecture == "swin_mil":
        return md.SwinAttentionMIL(pretrained=False)
    if architecture == "efficientnet_v2_s_mil":
        return md.EfficientNetV2AttentionMIL(pretrained=False)
    if architecture == "efficientnet_v2_s_dinov2_lesion_mil":
        return md.EfficientNetDinov2LesionAttentionMIL(pretrained=False)
    if architecture == "convnext_tiny_mil":
        return md.ConvNeXtTinyAttentionMIL(pretrained=False)
    if architecture == "densenet121_mil":
        return md.DenseNetAttentionMIL(pretrained=False, variant="densenet121")
    if architecture == "dual_input_concat":
        return md.DualInputConcatKeratitis(pretrained=False)
    if architecture in md.DENSENET_VARIANTS:
        return md.DenseNetKeratitis(variant=architecture)
    raise ValueError(f"Unsupported architecture: {architecture}")


def build_model_pretrained(manager: Any, architecture: str, num_classes: int = 2) -> Any:
    md = _deps()
    md.require_torch()
    if md.is_three_scale_lesion_guided_fusion_architecture(architecture):
        return md.ThreeScaleLesionGuidedFusionKeratitis(architecture, num_classes=num_classes, init_mode="imagenet")
    if md.is_lesion_guided_fusion_architecture(architecture):
        return md.LesionGuidedFusionKeratitis(architecture, num_classes=num_classes, init_mode="imagenet")
    if not md._TORCHVISION_AVAILABLE:
        if architecture not in {
            "dinov2",
            "dinov2_mil",
            "swin_mil",
            "efficientnet_v2_s_mil",
            "efficientnet_v2_s_dinov2_lesion_mil",
            "convnext_tiny_mil",
            "densenet121_mil",
            "dual_input_concat",
        }:
            raise RuntimeError(
                "torchvision is required. Run uv sync --frozen --extra cpu --extra dev (or --extra gpu)."
            )
    if architecture == "vit":
        from torchvision.models import ViT_B_16_Weights

        backbone = md._torchvision_models.vit_b_16(weights=ViT_B_16_Weights.IMAGENET1K_V1)
        in_features = backbone.heads.head.in_features
        backbone.heads.head = md.nn.Linear(in_features, num_classes)
        return backbone
    if architecture == "swin":
        from torchvision.models import Swin_T_Weights

        backbone = md._torchvision_models.swin_t(weights=Swin_T_Weights.IMAGENET1K_V1)
        in_features = backbone.head.in_features
        backbone.head = md.nn.Linear(in_features, num_classes)
        return backbone
    if architecture in md.DENSENET_VARIANTS:
        from torchvision.models import DenseNet121_Weights

        weight_map = {"densenet121": DenseNet121_Weights.IMAGENET1K_V1}
        builder = getattr(md._torchvision_models, architecture)
        backbone = builder(weights=weight_map[architecture])
        in_features = backbone.classifier.in_features
        backbone.classifier = md.nn.Linear(in_features, num_classes)
        model = md.DenseNetKeratitis.__new__(md.DenseNetKeratitis)
        md.nn.Module.__init__(model)
        model.model = backbone
        return model
    if architecture == "convnext_tiny":
        from torchvision.models import ConvNeXt_Tiny_Weights

        backbone = md._torchvision_models.convnext_tiny(weights=ConvNeXt_Tiny_Weights.IMAGENET1K_V1)
        in_features = backbone.classifier[-1].in_features
        backbone.classifier[-1] = md.nn.Linear(in_features, num_classes)
        model = md.ConvNeXtTinyKeratitis.__new__(md.ConvNeXtTinyKeratitis)
        md.nn.Module.__init__(model)
        model.model = backbone
        return model
    if architecture == "efficientnet_v2_s":
        from torchvision.models import EfficientNet_V2_S_Weights

        backbone = md._torchvision_models.efficientnet_v2_s(weights=EfficientNet_V2_S_Weights.IMAGENET1K_V1)
        in_features = backbone.classifier[-1].in_features
        backbone.classifier[-1] = md.nn.Linear(in_features, num_classes)
        return backbone
    if architecture == "efficientnet_v2_s_mil":
        return md.EfficientNetV2AttentionMIL(num_classes=num_classes, pretrained=True)
    if architecture == "efficientnet_v2_s_dinov2_lesion_mil":
        return md.EfficientNetDinov2LesionAttentionMIL(num_classes=num_classes, pretrained=True)
    if architecture == "dinov2":
        return md.Dinov2Keratitis(num_classes=num_classes, pretrained=True)
    if architecture == "dinov2_mil":
        return md.Dinov2AttentionMIL(num_classes=num_classes, pretrained=True)
    if architecture == "swin_mil":
        return md.SwinAttentionMIL(num_classes=num_classes, pretrained=True)
    if architecture == "convnext_tiny_mil":
        return md.ConvNeXtTinyAttentionMIL(num_classes=num_classes, pretrained=True)
    if architecture == "densenet121_mil":
        return md.DenseNetAttentionMIL(num_classes=num_classes, pretrained=True, variant="densenet121")
    if architecture == "dual_input_concat":
        return md.DualInputConcatKeratitis(num_classes=num_classes, pretrained=True)
    raise ValueError(f"Pretrained loading is not supported for architecture: {architecture}.")


def load_model(manager: Any, model_reference: dict[str, Any], device: str) -> Any:
    md = _deps()
    md.require_torch()
    resolved_reference = manager.resolve_model_reference(model_reference, allow_download=True)
    architecture = resolved_reference.get("architecture", "densenet121")
    model_path = resolved_reference["model_path"]
    cache_key = (str(model_path), str(device))
    if cache_key in manager._model_cache:
        return manager._model_cache[cache_key]
    checkpoint = md.torch.load(model_path, map_location=device, weights_only=True)
    checkpoint_metadata = manager.validate_model_artifact(resolved_reference, checkpoint)
    model = build_model(manager, architecture).to(device)
    state_dict = extract_state_dict_from_checkpoint(manager, checkpoint, architecture)
    strict = architecture not in md.DENSENET_VARIANTS
    try:
        model.load_state_dict(state_dict, strict=strict)
    except RuntimeError:
        if architecture not in {"dinov2", "dinov2_mil", "dual_input_concat", "efficientnet_v2_s_dinov2_lesion_mil"}:
            raise
        model = build_model_pretrained(manager, architecture).to(device)
        model.load_state_dict(state_dict, strict=strict)
    model._kera_preprocess_metadata = manager.resolve_preprocess_metadata(
        resolved_reference,
        checkpoint_metadata,
    )
    model.eval()
    manager._model_cache[cache_key] = model
    return model


def extract_state_dict_from_checkpoint(manager: Any, checkpoint: Any, architecture: str) -> dict[str, Any]:
    del manager
    if not isinstance(checkpoint, dict):
        try:
            state_dict = checkpoint.state_dict()
        except AttributeError:
            state_dict = checkpoint
    else:
        state_dict = None
        for key in ("state_dict", "model", "model_state_dict", "weights"):
            if key in checkpoint:
                state_dict = checkpoint[key]
                break
        if state_dict is None:
            state_dict = checkpoint

    if hasattr(state_dict, "items"):
        state_dict = dict(state_dict)
    if state_dict is None:
        raise ValueError("Checkpoint did not contain a readable state_dict.")

    if any(k.startswith("module.") for k in state_dict):
        state_dict = {k.replace("module.", "", 1): v for k, v in state_dict.items()}

    model = build_model(None, architecture)
    model_expects_prefix = any(k.startswith("model.") for k in model.state_dict())
    has_model_prefix = any(k.startswith("model.") for k in state_dict)
    if has_model_prefix and not model_expects_prefix:
        state_dict = {k.replace("model.", "", 1): v for k, v in state_dict.items()}
    elif not has_model_prefix and model_expects_prefix:
        state_dict = {f"model.{k}": v for k, v in state_dict.items()}

    return state_dict


def predict_image(manager: Any, model: Any, image_path: str | Path, device: str) -> Any:
    md = _deps()
    md.require_torch()
    _, tensor = md.preprocess_image(
        image_path,
        preprocess_metadata=manager.model_preprocess_metadata(model),
    )
    tensor = tensor.to(device)
    model.eval()
    with md.torch.no_grad():
        logits = model(tensor)
        probabilities = md.torch.softmax(logits, dim=1).squeeze(0)
    pred_index = int(md.torch.argmax(probabilities).item())
    return md.Prediction(
        predicted_label=md.INDEX_TO_LABEL[pred_index],
        probability=float(probabilities[1].item()),
        logits=[float(value) for value in logits.squeeze(0).tolist()],
    )


def predict_paired_image(
    manager: Any,
    model: Any,
    model_reference: dict[str, Any],
    cornea_image_path: str | Path,
    lesion_image_path: str | Path,
    lesion_mask_path: str | Path | None,
    device: str,
) -> Any:
    md = _deps()
    md.require_torch()
    preprocess_metadata = manager.model_preprocess_metadata(model, model_reference)
    _, cornea_tensor = md.preprocess_image(cornea_image_path, preprocess_metadata=preprocess_metadata)
    _, lesion_tensor = md.preprocess_image(lesion_image_path, preprocess_metadata=preprocess_metadata)
    cornea_tensor = cornea_tensor.to(device)
    lesion_tensor = lesion_tensor.to(device)
    lesion_mask_tensor = None
    if lesion_mask_path:
        lesion_mask_tensor = md._load_mask_tensor(
            lesion_mask_path,
            image_size=md._preprocess_image_size(preprocess_metadata),
        ).unsqueeze(0).to(device)
    model.eval()
    architecture = str(model_reference.get("architecture") or "")
    with md.torch.no_grad():
        if md.is_three_scale_lesion_guided_fusion_architecture(architecture):
            medium_tensor = md._extract_medium_crop_tensor(
                cornea_tensor.squeeze(0),
                lesion_mask_tensor.squeeze(0) if lesion_mask_tensor is not None else md.torch.zeros_like(cornea_tensor.squeeze(0)[:1]),
                scale_factor=1.5,
            ).unsqueeze(0).to(device)
            logits = model(cornea_tensor, medium_tensor, lesion_tensor, lesion_mask_tensor)
        else:
            logits = model(cornea_tensor, lesion_tensor, lesion_mask_tensor)
    probabilities = md.torch.softmax(logits, dim=1).squeeze(0)
    pred_index = int(md.torch.argmax(probabilities).item())
    return md.Prediction(
        predicted_label=md.INDEX_TO_LABEL[pred_index],
        probability=float(probabilities[1].item()),
        logits=[float(value) for value in logits.squeeze(0).tolist()],
    )


def extract_image_embedding(
    manager: Any,
    model: Any,
    model_reference: dict[str, Any],
    image_path: str | Path,
    device: str,
) -> np.ndarray:
    md = _deps()
    md.require_torch()
    _, tensor = md.preprocess_image(
        image_path,
        preprocess_metadata=manager.model_preprocess_metadata(model, model_reference),
    )
    tensor = tensor.to(device)
    model.eval()
    architecture = str(model_reference.get("architecture") or "densenet121")

    classifier_module = manager._classifier_module(model, architecture)

    captured_inputs: list[Any] = []

    def capture_pre_classifier_input(_module: Any, inputs: tuple[Any, ...]) -> None:
        if inputs:
            captured_inputs.append(inputs[0].detach())

    hook_handle = classifier_module.register_forward_pre_hook(capture_pre_classifier_input)
    try:
        with md.torch.no_grad():
            _ = model(tensor)
    finally:
        hook_handle.remove()

    if not captured_inputs:
        raise RuntimeError("Unable to extract the penultimate feature embedding from the model.")
    embedding = captured_inputs[0].reshape(captured_inputs[0].shape[0], -1)[0].cpu().numpy().astype(np.float32)
    return embedding


def extract_paired_image_embedding(
    manager: Any,
    model: Any,
    model_reference: dict[str, Any],
    cornea_image_path: str | Path,
    lesion_image_path: str | Path,
    lesion_mask_path: str | Path | None,
    device: str,
) -> np.ndarray:
    md = _deps()
    md.require_torch()
    if not hasattr(model, "forward_features"):
        raise RuntimeError("Dual-input model does not expose fused feature extraction.")
    preprocess_metadata = manager.model_preprocess_metadata(model, model_reference)
    _, cornea_tensor = md.preprocess_image(cornea_image_path, preprocess_metadata=preprocess_metadata)
    _, lesion_tensor = md.preprocess_image(lesion_image_path, preprocess_metadata=preprocess_metadata)
    cornea_tensor = cornea_tensor.to(device)
    lesion_tensor = lesion_tensor.to(device)
    lesion_mask_tensor = None
    if lesion_mask_path:
        lesion_mask_tensor = md._load_mask_tensor(
            lesion_mask_path,
            image_size=md._preprocess_image_size(preprocess_metadata),
        ).unsqueeze(0).to(device)
    model.eval()
    architecture = str(model_reference.get("architecture") or "")
    with md.torch.no_grad():
        if md.is_three_scale_lesion_guided_fusion_architecture(architecture):
            medium_tensor = md._extract_medium_crop_tensor(
                cornea_tensor.squeeze(0),
                lesion_mask_tensor.squeeze(0) if lesion_mask_tensor is not None else md.torch.zeros_like(cornea_tensor.squeeze(0)[:1]),
                scale_factor=1.5,
            ).unsqueeze(0).to(device)
            fused_features = model.forward_features(cornea_tensor, medium_tensor, lesion_tensor, lesion_mask_tensor)
        else:
            fused_features = model.forward_features(cornea_tensor, lesion_tensor, lesion_mask_tensor)
    embedding = fused_features[0].detach().cpu().numpy().astype(np.float32)
    return embedding
