from __future__ import annotations

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


def save_weight_delta(
    manager: Any,
    base_model_path: str | Path,
    tuned_model_path: str | Path,
    output_delta_path: str | Path,
) -> str:
    _require_torch()
    tuned_checkpoint = torch.load(tuned_model_path, map_location="cpu", weights_only=True)
    architecture = tuned_checkpoint.get("architecture", "densenet121") if isinstance(tuned_checkpoint, dict) else "densenet121"
    base_checkpoint = torch.load(base_model_path, map_location="cpu", weights_only=True)
    tuned_metadata = manager._checkpoint_metadata(tuned_checkpoint)
    base_state = manager._extract_state_dict_from_checkpoint(base_checkpoint, architecture)
    tuned_state = manager._extract_state_dict_from_checkpoint(tuned_checkpoint, architecture)
    delta_state = {key: tuned_state[key] - base_state[key] for key in base_state}
    output = Path(output_delta_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "architecture": architecture,
            "state_dict": delta_state,
            "artifact_metadata": manager.build_artifact_metadata(
                architecture=architecture,
                artifact_type="weight_delta",
                preprocess_metadata=manager.resolve_preprocess_metadata(checkpoint_metadata=tuned_metadata),
            ),
        },
        output,
    )
    return str(output)


def validate_deltas(deltas: list[dict]) -> None:
    """Reject deltas containing NaN/Inf or statistical outliers (poisoning guard)."""
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

    if len(norms) >= 2:
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
) -> str:
    _require_torch()
    if not delta_paths:
        raise ValueError("At least one delta path is required.")
    delta_checkpoints = [torch.load(path, map_location="cpu", weights_only=True) for path in delta_paths]
    deltas = [checkpoint["state_dict"] for checkpoint in delta_checkpoints]
    validate_deltas(deltas)
    keys = deltas[0].keys()
    if weights is None:
        weights_tensor = torch.full((len(deltas),), 1.0 / len(deltas), dtype=torch.float32)
    else:
        if len(weights) != len(deltas):
            raise ValueError("weights length must match delta_paths length.")
        weights_tensor = torch.tensor(weights, dtype=torch.float32)
        weights_tensor = weights_tensor / weights_tensor.sum()

    aggregated = {}
    for key in keys:
        stacked = torch.stack([delta[key] for delta in deltas], dim=0)
        view_shape = [len(deltas)] + [1] * (stacked.ndim - 1)
        aggregated[key] = (stacked * weights_tensor.view(*view_shape)).sum(dim=0)

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
        },
        output,
    )
    return str(output)
