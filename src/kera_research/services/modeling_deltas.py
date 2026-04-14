from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import numpy as np

try:
    import torch
except ImportError:  # pragma: no cover - dependency guard
    torch = None


def _require_torch() -> None:
    if torch is None:
        raise RuntimeError("PyTorch is required for model inference and training.")


_ALLOWED_AGGREGATION_STRATEGIES = {"fedavg", "coordinate_median", "trimmed_mean"}


def _to_cpu_float_tensor(tensor: Any) -> Any:
    return tensor.detach().clone().to(device="cpu", dtype=torch.float32)


def _delta_l2_norm(delta_state: dict[str, Any]) -> float:
    total = 0.0
    for tensor in delta_state.values():
        current = _to_cpu_float_tensor(tensor)
        total += float(current.pow(2).sum().item())
    return math.sqrt(total)


def _clip_delta_state(delta_state: dict[str, Any], clip_l2_norm: float | None) -> tuple[dict[str, Any], float | None]:
    if clip_l2_norm is None or float(clip_l2_norm) <= 0:
        return delta_state, None
    total_norm = _delta_l2_norm(delta_state)
    if total_norm <= 0 or total_norm <= float(clip_l2_norm):
        return delta_state, total_norm
    scale = float(clip_l2_norm) / total_norm
    return (
        {
            key: _to_cpu_float_tensor(tensor) * scale
            for key, tensor in delta_state.items()
        },
        total_norm,
    )


def _add_gaussian_noise(
    delta_state: dict[str, Any],
    *,
    clip_l2_norm: float | None,
    noise_multiplier: float | None,
) -> dict[str, Any]:
    if noise_multiplier is None or float(noise_multiplier) <= 0:
        return delta_state
    if clip_l2_norm is None or float(clip_l2_norm) <= 0:
        raise ValueError("noise_multiplier requires clip_l2_norm so the delta noise scale is bounded.")
    stddev = float(clip_l2_norm) * float(noise_multiplier)
    if stddev <= 0:
        return delta_state
    return {
        key: _to_cpu_float_tensor(tensor) + torch.randn_like(_to_cpu_float_tensor(tensor)) * stddev
        for key, tensor in delta_state.items()
    }


def _quantize_delta_state(
    delta_state: dict[str, Any],
    quantization_bits: int | None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    if quantization_bits is None:
        return delta_state, {}
    if int(quantization_bits) not in {8, 16}:
        raise ValueError("quantization_bits must be 8 or 16 when quantization is enabled.")
    bits = int(quantization_bits)
    qmax = float((2 ** (bits - 1)) - 1)
    quantized_dtype = torch.int8 if bits == 8 else torch.int16
    scales: dict[str, float] = {}
    encoded_state: dict[str, Any] = {}
    for key, tensor in delta_state.items():
        current = _to_cpu_float_tensor(tensor)
        max_abs = float(current.abs().max().item()) if current.numel() else 0.0
        scale = max_abs / qmax if max_abs > 0 else 1.0
        scales[key] = scale
        encoded_state[key] = torch.clamp(torch.round(current / scale), -qmax, qmax).to(dtype=quantized_dtype)
    return encoded_state, {
        "delta_encoding": "symmetric_linear",
        "delta_quantization_bits": bits,
        "delta_quantization_scales": scales,
    }


def _decode_delta_checkpoint(checkpoint: dict[str, Any]) -> dict[str, Any]:
    state_dict = dict(checkpoint.get("state_dict") or {})
    encoding = str(checkpoint.get("delta_encoding") or "").strip().lower()
    if encoding != "symmetric_linear":
        return {
            key: _to_cpu_float_tensor(tensor)
            for key, tensor in state_dict.items()
        }
    scales = dict(checkpoint.get("delta_quantization_scales") or {})
    return {
        key: _to_cpu_float_tensor(tensor) * float(scales.get(key, 1.0))
        for key, tensor in state_dict.items()
    }


def _normalized_weights(deltas: list[dict[str, Any]], weights: list[float] | None) -> Any:
    if weights is None:
        return torch.full((len(deltas),), 1.0 / len(deltas), dtype=torch.float32)
    if len(weights) != len(deltas):
        raise ValueError("weights length must match delta_paths length.")
    weights_tensor = torch.tensor(weights, dtype=torch.float32)
    total = float(weights_tensor.sum().item())
    if total <= 0:
        raise ValueError("weights must sum to a positive value.")
    return weights_tensor / total


def _aggregate_tensor_stack(
    stacked: Any,
    *,
    strategy: str,
    weights_tensor: Any,
    trim_ratio: float,
) -> Any:
    if strategy == "coordinate_median":
        return torch.median(stacked.float(), dim=0).values
    if strategy == "trimmed_mean":
        if stacked.shape[0] < 3:
            return stacked.float().mean(dim=0)
        trim_count = min(int(stacked.shape[0] * max(0.0, min(0.49, float(trim_ratio)))), (stacked.shape[0] - 1) // 2)
        if trim_count <= 0:
            return stacked.float().mean(dim=0)
        sorted_values, _ = torch.sort(stacked.float(), dim=0)
        trimmed = sorted_values[trim_count : stacked.shape[0] - trim_count]
        return trimmed.mean(dim=0)
    view_shape = [stacked.shape[0]] + [1] * (stacked.ndim - 1)
    return (stacked.float() * weights_tensor.view(*view_shape)).sum(dim=0)


def save_weight_delta(
    manager: Any,
    base_model_path: str | Path,
    tuned_model_path: str | Path,
    output_delta_path: str | Path,
    *,
    clip_l2_norm: float | None = None,
    noise_multiplier: float | None = None,
    quantization_bits: int | None = None,
) -> str:
    _require_torch()
    tuned_checkpoint = torch.load(tuned_model_path, map_location="cpu", weights_only=True)
    architecture = tuned_checkpoint.get("architecture", "densenet121") if isinstance(tuned_checkpoint, dict) else "densenet121"
    base_checkpoint = torch.load(base_model_path, map_location="cpu", weights_only=True)
    tuned_metadata = manager._checkpoint_metadata(tuned_checkpoint)
    base_state = manager._extract_state_dict_from_checkpoint(base_checkpoint, architecture)
    tuned_state = manager._extract_state_dict_from_checkpoint(tuned_checkpoint, architecture)
    delta_state = {
        key: _to_cpu_float_tensor(tuned_state[key] - base_state[key])
        for key in base_state
    }
    delta_state, original_norm = _clip_delta_state(delta_state, clip_l2_norm)
    delta_state = _add_gaussian_noise(
        delta_state,
        clip_l2_norm=clip_l2_norm,
        noise_multiplier=noise_multiplier,
    )
    encoded_state, encoding_metadata = _quantize_delta_state(delta_state, quantization_bits)
    privacy_controls = {
        key: value
        for key, value in {
            "delta_clip_l2_norm": float(clip_l2_norm) if clip_l2_norm is not None else None,
            "delta_noise_multiplier": float(noise_multiplier) if noise_multiplier is not None else None,
            "delta_quantization_bits": int(quantization_bits) if quantization_bits is not None else None,
            "delta_pre_clip_l2_norm": original_norm,
        }.items()
        if value is not None
    }
    output = Path(output_delta_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "architecture": architecture,
        "state_dict": encoded_state,
        "artifact_metadata": manager.build_artifact_metadata(
            architecture=architecture,
            artifact_type="weight_delta",
            preprocess_metadata=manager.resolve_preprocess_metadata(checkpoint_metadata=tuned_metadata),
        ),
    }
    if encoding_metadata:
        payload.update(encoding_metadata)
    if privacy_controls:
        payload["delta_privacy_controls"] = privacy_controls
    torch.save(payload, output)
    return str(output)


def validate_deltas(deltas: list[dict], *, reject_outliers: bool = True) -> None:
    """Reject deltas containing NaN/Inf or statistical outliers (poisoning guard)."""
    _require_torch()
    if not deltas:
        return
    reference_keys = set(deltas[0].keys())
    norms: list[float] = []
    for index, delta in enumerate(deltas):
        if set(delta.keys()) != reference_keys:
            raise ValueError(f"Delta {index} has mismatched layer keys — cannot aggregate.")
        total_norm = 0.0
        for key, tensor in delta.items():
            current_tensor = tensor.float()
            if torch.isnan(current_tensor).any() or torch.isinf(current_tensor).any():
                raise ValueError(f"Delta {index} contains NaN or Inf in layer '{key}' — rejecting.")
            total_norm += float(current_tensor.norm().item()) ** 2
        norms.append(total_norm ** 0.5)

    if reject_outliers and len(norms) >= 2:
        median_norm = float(np.median(norms))
        if median_norm > 0:
            for index, norm in enumerate(norms):
                if norm > 10.0 * median_norm:
                    raise ValueError(
                        f"Delta {index} L2 norm ({norm:.4f}) is more than 10× the median norm "
                        f"({median_norm:.4f}). Possible poisoning — rejecting aggregation."
                    )


def aggregate_weight_deltas(
    manager: Any,
    delta_paths: list[str | Path],
    output_path: str | Path,
    weights: list[float] | None = None,
    base_model_path: str | Path | None = None,
    *,
    strategy: str | None = None,
    trim_ratio: float | None = None,
) -> str:
    _require_torch()
    if not delta_paths:
        raise ValueError("At least one delta path is required.")
    resolved_strategy = str(strategy or "fedavg").strip().lower() or "fedavg"
    if resolved_strategy not in _ALLOWED_AGGREGATION_STRATEGIES:
        raise ValueError(f"Unsupported aggregation strategy: {resolved_strategy}")
    resolved_trim_ratio = 0.2 if trim_ratio is None else max(0.0, min(0.49, float(trim_ratio)))
    delta_checkpoints = [torch.load(path, map_location="cpu", weights_only=True) for path in delta_paths]
    deltas = [_decode_delta_checkpoint(checkpoint) for checkpoint in delta_checkpoints]
    validate_deltas(deltas, reject_outliers=resolved_strategy == "fedavg")
    keys = deltas[0].keys()
    weights_tensor = _normalized_weights(deltas, weights)

    aggregated = {}
    for key in keys:
        stacked = torch.stack([_to_cpu_float_tensor(delta[key]) for delta in deltas], dim=0)
        aggregated[key] = _aggregate_tensor_stack(
            stacked,
            strategy=resolved_strategy,
            weights_tensor=weights_tensor,
            trim_ratio=resolved_trim_ratio,
        )

    architecture = delta_checkpoints[0].get("architecture", "densenet121")
    reference_metadata = manager._checkpoint_metadata(delta_checkpoints[0])
    state_dict_to_save = aggregated
    if base_model_path is not None:
        base_checkpoint = torch.load(base_model_path, map_location="cpu", weights_only=True)
        reference_metadata = manager._checkpoint_metadata(base_checkpoint) or reference_metadata
        base_state = manager._extract_state_dict_from_checkpoint(base_checkpoint, architecture)
        state_dict_to_save = {
            key: base_state[key] + aggregated[key]
            for key in base_state
        }

    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "architecture": architecture,
            "state_dict": state_dict_to_save,
            "artifact_metadata": manager.build_artifact_metadata(
                architecture=architecture,
                artifact_type="model" if base_model_path is not None else "weight_delta",
                preprocess_metadata=manager.resolve_preprocess_metadata(checkpoint_metadata=reference_metadata),
            ),
            "aggregation_strategy": resolved_strategy,
            "aggregation_trim_ratio": resolved_trim_ratio if resolved_strategy == "trimmed_mean" else None,
        },
        output,
    )
    return str(output)
