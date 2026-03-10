from __future__ import annotations

import platform
from typing import Any

try:
    import torch
except ImportError:  # pragma: no cover - dependency guard
    torch = None


def detect_hardware() -> dict[str, Any]:
    torch_available = torch is not None
    gpu_available = bool(torch_available and torch.cuda.is_available())
    gpu_name = torch.cuda.get_device_name(0) if gpu_available else None
    cuda_version = torch.version.cuda if torch_available else None

    return {
        "cpu_name": platform.processor() or platform.machine() or "CPU",
        "torch_available": torch_available,
        "gpu_available": gpu_available,
        "gpu_name": gpu_name,
        "cuda_version": cuda_version,
    }


def resolve_execution_mode(selection: str, profile: dict[str, Any]) -> str:
    if selection == "GPU mode":
        return "cuda" if profile["gpu_available"] else "cpu"
    if selection == "CPU mode":
        return "cpu"
    return "cuda" if profile["gpu_available"] else "cpu"
