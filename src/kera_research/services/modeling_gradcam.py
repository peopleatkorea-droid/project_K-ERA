from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
from PIL import ImageFilter


def _deps():
    from kera_research.services import modeling as md

    return md


def generate_explanation(
    manager: Any,
    model: Any,
    model_reference: dict[str, Any],
    image_path: str | Path,
    device: str,
    output_path: str | Path,
    target_class: int | None = None,
) -> str:
    return generate_explanation_artifacts(
        manager,
        model,
        model_reference,
        image_path,
        device,
        output_path,
        target_class=target_class,
    )["overlay_path"]


def generate_explanation_artifacts(
    manager: Any,
    model: Any,
    model_reference: dict[str, Any],
    image_path: str | Path,
    device: str,
    output_path: str | Path,
    target_class: int | None = None,
    heatmap_output_path: str | Path | None = None,
) -> dict[str, str]:
    architecture = model_reference.get("architecture", "densenet121")
    return generate_cam_artifacts_from_layer(
        manager,
        model=model,
        preprocess_metadata=manager.model_preprocess_metadata(model, model_reference),
        image_path=image_path,
        device=device,
        output_path=output_path,
        heatmap_output_path=heatmap_output_path,
        target_layer=gradcam_target_layer(manager, model, architecture),
        target_class=target_class,
    )


def generate_paired_explanation_artifacts(
    manager: Any,
    model: Any,
    model_reference: dict[str, Any],
    *,
    cornea_image_path: str | Path,
    lesion_image_path: str | Path,
    lesion_mask_path: str | Path | None,
    device: str,
    cornea_output_path: str | Path,
    lesion_output_path: str | Path,
    target_class: int | None = None,
    cornea_heatmap_output_path: str | Path | None = None,
    lesion_heatmap_output_path: str | Path | None = None,
) -> dict[str, str]:
    architecture = str(model_reference.get("architecture") or "densenet121")
    if not manager.is_dual_input_architecture(architecture):
        raise ValueError("Paired Grad-CAM is only available for dual-input architectures.")
    return generate_paired_cam_artifacts_from_layer(
        manager,
        model=model,
        preprocess_metadata=manager.model_preprocess_metadata(model, model_reference),
        cornea_image_path=cornea_image_path,
        lesion_image_path=lesion_image_path,
        lesion_mask_path=lesion_mask_path,
        device=device,
        cornea_output_path=cornea_output_path,
        lesion_output_path=lesion_output_path,
        cornea_heatmap_output_path=cornea_heatmap_output_path,
        lesion_heatmap_output_path=lesion_heatmap_output_path,
        target_layer=gradcam_target_layer(manager, model, architecture),
        target_class=target_class,
    )


def classifier_module(manager: Any, model: Any, architecture: str) -> Any:
    md = _deps()
    del manager
    if architecture == "cnn":
        return model.classifier
    if architecture == "vit":
        return model.heads.head
    if architecture == "swin":
        return model.head
    if architecture == "convnext_tiny":
        return model.classifier[-1]
    if architecture == "efficientnet_v2_s":
        return model.classifier[-1]
    if architecture == "dinov2":
        return model.classifier
    if md.is_attention_mil_architecture(architecture):
        return model.classifier
    if architecture == "dual_input_concat":
        return model.classifier
    if md.is_lesion_guided_fusion_architecture(architecture):
        return model.classifier
    if architecture in md.DENSENET_VARIANTS:
        return model.classifier
    raise ValueError(f"Unsupported architecture: {architecture}")


def gradcam_target_layer(manager: Any, model: Any, architecture: str) -> Any:
    md = _deps()
    del manager
    if architecture == "cnn":
        return model.features[-2]
    if architecture == "vit":
        return model.conv_proj
    if architecture == "swin":
        return model.features[-1]
    if architecture == "convnext_tiny":
        return model.features[-1]
    if architecture == "efficientnet_v2_s":
        return model.features[-1]
    if architecture == "dinov2":
        return dinov2_gradcam_projection(model, "DINOv2")
    if architecture == "dinov2_mil":
        return dinov2_gradcam_projection(model, "DINOv2 MIL")
    if architecture == "swin_mil":
        return model.backbone.features[-1]
    if architecture == "dual_input_concat":
        return dinov2_gradcam_projection(model, "Dual-input DINOv2")
    if md.is_lesion_guided_fusion_architecture(architecture):
        return model.backbone_adapter.gradcam_target_layer
    if architecture in md.DENSENET_VARIANTS:
        return model.features.denseblock4 if hasattr(model.features, "denseblock4") else model.features
    raise ValueError(f"Unsupported architecture: {architecture}")


def dinov2_gradcam_projection(model: Any, label: str) -> Any:
    patch_embeddings = getattr(getattr(getattr(model, "backbone", None), "embeddings", None), "patch_embeddings", None)
    projection = getattr(patch_embeddings, "projection", None)
    if projection is None:
        raise ValueError(f"{label} Grad-CAM target layer is unavailable.")
    return projection


def normalize_cam_feature_map(tensor: Any) -> Any:
    if tensor.ndim != 3:
        raise RuntimeError(f"Grad-CAM target layer must produce a 3D feature map, got shape {tuple(tensor.shape)}.")
    shape = tuple(int(dim) for dim in tensor.shape)
    channel_axis = max(range(3), key=lambda index: shape[index])
    if channel_axis == 0:
        return tensor
    if channel_axis == 2:
        return tensor.permute(2, 0, 1).contiguous()
    return tensor.permute(1, 0, 2).contiguous()


def cam_array_from_tensors(manager: Any, activation_tensor: Any, gradient_tensor: Any) -> np.ndarray:
    del manager
    activation = normalize_cam_feature_map(activation_tensor[0].detach())
    gradient = normalize_cam_feature_map(gradient_tensor[0].detach())
    weights = gradient.mean(dim=(1, 2), keepdim=True)
    cam = _deps().torch.relu((weights * activation).sum(dim=0)).cpu().numpy()
    cam = cam - cam.min()
    denominator = cam.max() if cam.max() > 0 else 1.0
    return np.asarray(cam / denominator, dtype=np.float32)


def generate_cam_from_layer(
    manager: Any,
    model: Any,
    preprocess_metadata: dict[str, Any] | None,
    image_path: str | Path,
    device: str,
    output_path: str | Path,
    target_layer: Any,
    target_class: int | None = None,
) -> str:
    return generate_cam_artifacts_from_layer(
        manager,
        model=model,
        preprocess_metadata=preprocess_metadata,
        image_path=image_path,
        device=device,
        output_path=output_path,
        heatmap_output_path=None,
        target_layer=target_layer,
        target_class=target_class,
    )["overlay_path"]


def generate_cam_artifacts_from_layer(
    manager: Any,
    *,
    model: Any,
    preprocess_metadata: dict[str, Any] | None,
    image_path: str | Path,
    device: str,
    output_path: str | Path,
    heatmap_output_path: str | Path | None,
    target_layer: Any,
    target_class: int | None = None,
) -> dict[str, str]:
    md = _deps()
    md.require_torch()
    original_image, tensor = md.preprocess_image(image_path, preprocess_metadata=preprocess_metadata)
    tensor = tensor.to(device)
    model.eval()

    activations: list[Any] = []
    gradients: list[Any] = []

    def forward_hook(_module: Any, _input: tuple[Any, ...], output: Any) -> None:
        activations.append(output.detach())

    def backward_hook(_module: Any, grad_input: tuple[Any, ...], grad_output: tuple[Any, ...]) -> None:
        del grad_input
        gradients.append(grad_output[0].detach())

    forward_handle = target_layer.register_forward_hook(forward_hook)
    backward_handle = target_layer.register_full_backward_hook(backward_hook)

    scores = model(tensor)
    if target_class is None:
        target_class = int(md.torch.argmax(scores, dim=1).item())
    model.zero_grad()
    scores[:, target_class].backward()

    forward_handle.remove()
    backward_handle.remove()

    cam = cam_array_from_tensors(manager, activations[-1], gradients[-1])

    overlay = overlay_heatmap(manager, np.asarray(original_image), cam)
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    md.Image.fromarray(overlay).save(output)
    resolved_heatmap_path = Path(heatmap_output_path) if heatmap_output_path is not None else output.with_suffix(".npy")
    resolved_heatmap_path.parent.mkdir(parents=True, exist_ok=True)
    np.save(resolved_heatmap_path, np.asarray(cam, dtype=np.float32))
    return {
        "overlay_path": str(output),
        "heatmap_path": str(resolved_heatmap_path),
    }


def generate_paired_cam_artifacts_from_layer(
    manager: Any,
    *,
    model: Any,
    preprocess_metadata: dict[str, Any] | None,
    cornea_image_path: str | Path,
    lesion_image_path: str | Path,
    lesion_mask_path: str | Path | None,
    device: str,
    cornea_output_path: str | Path,
    lesion_output_path: str | Path,
    cornea_heatmap_output_path: str | Path | None,
    lesion_heatmap_output_path: str | Path | None,
    target_layer: Any,
    target_class: int | None = None,
) -> dict[str, str]:
    md = _deps()
    md.require_torch()
    if not hasattr(model, "forward"):
        raise RuntimeError("Paired Grad-CAM requires a callable dual-input model.")

    cornea_original, cornea_tensor = md.preprocess_image(cornea_image_path, preprocess_metadata=preprocess_metadata)
    lesion_original, lesion_tensor = md.preprocess_image(lesion_image_path, preprocess_metadata=preprocess_metadata)
    cornea_tensor = cornea_tensor.to(device)
    lesion_tensor = lesion_tensor.to(device)
    lesion_mask_tensor = None
    if lesion_mask_path:
        lesion_mask_tensor = md._load_mask_tensor(
            lesion_mask_path,
            image_size=md._preprocess_image_size(preprocess_metadata),
        ).unsqueeze(0).to(device)
    model.eval()
    architecture = str(getattr(model, "architecture", "") or "")

    branch_activations: dict[str, Any] = {}
    branch_gradients: dict[str, Any] = {}

    def forward_hook(_module: Any, _input: tuple[Any, ...], output: Any) -> None:
        branch_name = str(getattr(model, "_cam_active_branch", "") or f"branch_{len(branch_activations)}")
        if not md.torch.is_tensor(output):
            return
        output.retain_grad()
        branch_activations[branch_name] = output

    forward_handle = target_layer.register_forward_hook(forward_hook)
    if md.is_three_scale_lesion_guided_fusion_architecture(architecture):
        medium_tensor = md._extract_medium_crop_tensor(
            cornea_tensor.squeeze(0),
            lesion_mask_tensor.squeeze(0) if lesion_mask_tensor is not None else md.torch.zeros_like(cornea_tensor.squeeze(0)[:1]),
            scale_factor=1.5,
        ).unsqueeze(0).to(device)
        scores = model(cornea_tensor, medium_tensor, lesion_tensor, lesion_mask_tensor)
    else:
        scores = model(cornea_tensor, lesion_tensor, lesion_mask_tensor)
    if target_class is None:
        target_class = int(md.torch.argmax(scores, dim=1).item())
    model.zero_grad()
    scores[:, target_class].backward()
    forward_handle.remove()

    for branch_name, activation in branch_activations.items():
        if activation.grad is not None:
            branch_gradients[branch_name] = activation.grad.detach()

    branch_specs = (
        ("cornea", cornea_original, cornea_output_path, cornea_heatmap_output_path, "cornea_overlay_path", "cornea_heatmap_path"),
        ("lesion", lesion_original, lesion_output_path, lesion_heatmap_output_path, "lesion_overlay_path", "lesion_heatmap_path"),
    )
    artifacts: dict[str, str] = {}
    for branch_name, original_image, output_path, heatmap_output_path, overlay_key, heatmap_key in branch_specs:
        activation = branch_activations.get(branch_name)
        gradient = branch_gradients.get(branch_name)
        if activation is None or gradient is None:
            raise RuntimeError(f"Unable to collect Grad-CAM tensors for the {branch_name} branch.")
        cam = cam_array_from_tensors(manager, activation.detach(), gradient)
        overlay = overlay_heatmap(manager, np.asarray(original_image), cam)
        resolved_output_path = Path(output_path)
        resolved_output_path.parent.mkdir(parents=True, exist_ok=True)
        md.Image.fromarray(overlay).save(resolved_output_path)
        resolved_heatmap_path = Path(heatmap_output_path) if heatmap_output_path is not None else resolved_output_path.with_suffix(".npy")
        resolved_heatmap_path.parent.mkdir(parents=True, exist_ok=True)
        np.save(resolved_heatmap_path, np.asarray(cam, dtype=np.float32))
        artifacts[overlay_key] = str(resolved_output_path)
        artifacts[heatmap_key] = str(resolved_heatmap_path)
    return artifacts


def overlay_heatmap(manager: Any, original_array: np.ndarray, heatmap: np.ndarray) -> np.ndarray:
    del manager
    md = _deps()
    resampling = getattr(md.Image, "Resampling", md.Image)
    resized_heatmap = md.Image.fromarray((np.clip(heatmap, 0.0, 1.0) * 255).astype(np.uint8))
    resized_heatmap = resized_heatmap.resize(
        (original_array.shape[1], original_array.shape[0]),
        resample=resampling.BICUBIC,
    )
    blur_radius = max(1.4, min(max(original_array.shape[:2]) / 120.0, 6.0))
    resized_heatmap = resized_heatmap.filter(ImageFilter.GaussianBlur(radius=blur_radius))
    normalized = np.asarray(resized_heatmap, dtype=np.float32) / 255.0
    focus_floor = float(np.quantile(normalized, 0.72))
    focus_ceiling = float(np.quantile(normalized, 0.995))
    if focus_ceiling <= focus_floor:
        focus_ceiling = float(normalized.max())
        focus_floor = max(0.0, focus_ceiling * 0.55)
    emphasis = np.clip((normalized - focus_floor) / max(focus_ceiling - focus_floor, 1e-6), 0.0, 1.0)
    emphasis = np.power(emphasis, 1.85, dtype=np.float32)
    alpha = (0.58 * emphasis).astype(np.float32)
    alpha = alpha[..., None]

    color = np.zeros_like(original_array, dtype=np.float32)
    color[..., 0] = 255.0
    color[..., 1] = 175.0 + emphasis * 55.0
    color[..., 2] = 40.0 + (1.0 - emphasis) * 24.0

    original = original_array.astype(np.float32)
    blended = original * (1.0 - alpha) + color * alpha
    return np.clip(blended, 0, 255).astype(np.uint8)
