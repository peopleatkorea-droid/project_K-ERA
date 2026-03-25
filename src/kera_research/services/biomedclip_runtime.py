from __future__ import annotations

import os
import threading
from dataclasses import dataclass
from typing import Any


BIOMEDCLIP_MODEL_ID = "hf-hub:microsoft/BiomedCLIP-PubMedBERT_256-vit_base_patch16_224"


@dataclass(frozen=True)
class BiomedClipRuntime:
    torch: Any
    model: Any
    preprocess: Any
    tokenizer: Any
    device: str


_RUNTIME_LOCK = threading.Lock()
_RUNTIME: BiomedClipRuntime | None = None


def resolve_biomedclip_device(torch_module: Any, requested_device: str | None = None) -> str:
    normalized = str(requested_device or os.getenv("KERA_BIOMEDCLIP_DEVICE") or "auto").strip().lower()
    if normalized.startswith("cuda") and torch_module.cuda.is_available():
        return normalized
    if normalized in {"gpu", "auto"} and torch_module.cuda.is_available():
        return "cuda:0"
    return "cpu"


def ensure_biomedclip_runtime(requested_device: str | None = None) -> BiomedClipRuntime:
    try:
        import open_clip
    except ImportError as exc:  # pragma: no cover - optional dependency
        raise RuntimeError(
            "BiomedCLIP dependencies are not installed. Run pip install -r requirements.txt after updating the environment."
        ) from exc

    try:
        import torch
    except ImportError as exc:  # pragma: no cover - optional dependency
        raise RuntimeError("PyTorch is required for BiomedCLIP scoring.") from exc

    device = resolve_biomedclip_device(torch, requested_device)

    global _RUNTIME
    with _RUNTIME_LOCK:
        if _RUNTIME is not None and _RUNTIME.device == device:
            return _RUNTIME

        try:
            if hasattr(open_clip, "create_model_from_pretrained"):
                model, preprocess = open_clip.create_model_from_pretrained(BIOMEDCLIP_MODEL_ID, device=device)
            else:  # pragma: no cover - compatibility branch
                model, _, preprocess = open_clip.create_model_and_transforms(BIOMEDCLIP_MODEL_ID)
                model = model.to(device)
            tokenizer = open_clip.get_tokenizer(BIOMEDCLIP_MODEL_ID)
        except Exception as exc:  # pragma: no cover - runtime dependency / model download
            raise RuntimeError(f"Unable to load BiomedCLIP model '{BIOMEDCLIP_MODEL_ID}': {exc}") from exc

        model.eval()
        runtime = BiomedClipRuntime(
            torch=torch,
            model=model,
            preprocess=preprocess,
            tokenizer=tokenizer,
            device=device,
        )
        _RUNTIME = runtime
        return runtime


def warm_biomedclip_runtime(requested_device: str | None = None) -> BiomedClipRuntime:
    return ensure_biomedclip_runtime(requested_device)
