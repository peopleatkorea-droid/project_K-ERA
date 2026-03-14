from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

BIOMEDCLIP_MODEL_ID = "hf-hub:microsoft/BiomedCLIP-PubMedBERT_256-vit_base_patch16_224"
DINOv2_MODEL_ID = "facebook/dinov2-base"


class BiomedClipTextRetriever:
    def __init__(self) -> None:
        self._model: Any | None = None
        self._preprocess: Any | None = None
        self._tokenizer: Any | None = None
        self._device: str | None = None

    def _resolve_runtime_device(self, requested_device: str) -> str:
        try:
            import torch
        except ImportError as exc:  # pragma: no cover - runtime dependency guard
            raise RuntimeError("BiomedCLIP retrieval requires PyTorch.") from exc

        normalized = str(requested_device or "cpu").strip().lower()
        if normalized.startswith("cuda") and torch.cuda.is_available():
            return normalized
        if normalized == "gpu" and torch.cuda.is_available():
            return "cuda:0"
        if normalized == "auto" and torch.cuda.is_available():
            return "cuda:0"
        return "cpu"

    def _ensure_loaded(self, requested_device: str) -> tuple[Any, Any, Any, Any]:
        try:
            import open_clip
            import torch
        except ImportError as exc:  # pragma: no cover - runtime dependency guard
            raise RuntimeError(
                "BiomedCLIP retrieval requires open_clip_torch and transformers to be installed."
            ) from exc

        device = self._resolve_runtime_device(requested_device)
        if self._model is None or self._preprocess is None or self._tokenizer is None or self._device != device:
            model, preprocess = open_clip.create_model_from_pretrained(BIOMEDCLIP_MODEL_ID)
            tokenizer = open_clip.get_tokenizer(BIOMEDCLIP_MODEL_ID)
            model = model.to(device)
            model.eval()
            self._model = model
            self._preprocess = preprocess
            self._tokenizer = tokenizer
            self._device = device
        return torch, self._model, self._preprocess, self._tokenizer

    def encode_images(self, image_paths: list[str | Path], requested_device: str) -> np.ndarray:
        if not image_paths:
            raise ValueError("At least one image is required for BiomedCLIP retrieval.")
        torch, model, preprocess, _tokenizer = self._ensure_loaded(requested_device)

        tensors = []
        for image_path in image_paths:
            image = Image.open(image_path).convert("RGB")
            tensors.append(preprocess(image))
        batch = torch.stack(tensors).to(self._device)

        with torch.no_grad():
            features = model.encode_image(batch)
        features = features / features.norm(dim=-1, keepdim=True).clamp_min(1e-12)
        return features.detach().cpu().numpy().astype(np.float32)

    def encode_texts(self, texts: list[str], requested_device: str) -> np.ndarray:
        if not texts:
            raise ValueError("At least one text is required for BiomedCLIP retrieval.")
        torch, model, _preprocess, tokenizer = self._ensure_loaded(requested_device)
        tokens = tokenizer(texts).to(self._device)

        with torch.no_grad():
            features = model.encode_text(tokens)
        features = features / features.norm(dim=-1, keepdim=True).clamp_min(1e-12)
        return features.detach().cpu().numpy().astype(np.float32)

    def retrieve_texts(
        self,
        *,
        query_image_paths: list[str | Path],
        text_records: list[dict[str, Any]],
        requested_device: str,
        top_k: int = 3,
    ) -> dict[str, Any]:
        if not text_records:
            return {
                "text_retrieval_mode": "biomedclip_image_to_text",
                "text_embedding_model": BIOMEDCLIP_MODEL_ID,
                "eligible_text_count": 0,
                "text_evidence": [],
            }

        image_features = self.encode_images(query_image_paths, requested_device)
        query_vector = np.mean(image_features, axis=0).astype(np.float32)
        query_norm = float(np.linalg.norm(query_vector))
        query_vector = query_vector / max(query_norm, 1e-12)

        texts = [str(item.get("text") or "") for item in text_records]
        text_features = self.encode_texts(texts, requested_device)
        similarities = np.matmul(text_features, query_vector)

        ranked: list[dict[str, Any]] = []
        for record, similarity in sorted(
            zip(text_records, similarities.tolist(), strict=False),
            key=lambda item: float(item[1]),
            reverse=True,
        ):
            ranked.append(
                {
                    **record,
                    "similarity": round(float(similarity), 4),
                }
            )

        return {
            "text_retrieval_mode": "biomedclip_image_to_text",
            "text_embedding_model": BIOMEDCLIP_MODEL_ID,
            "eligible_text_count": len(text_records),
            "text_evidence": ranked[: max(1, min(int(top_k or 3), 10))],
        }


class Dinov2ImageRetriever:
    def __init__(self) -> None:
        self._model: Any | None = None
        self._processor: Any | None = None
        self._device: str | None = None

    def _resolve_runtime_device(self, requested_device: str) -> str:
        try:
            import torch
        except ImportError as exc:  # pragma: no cover - runtime dependency guard
            raise RuntimeError("DINOv2 retrieval requires PyTorch.") from exc

        normalized = str(requested_device or "cpu").strip().lower()
        if normalized.startswith("cuda") and torch.cuda.is_available():
            return normalized
        if normalized == "gpu" and torch.cuda.is_available():
            return "cuda:0"
        if normalized == "auto" and torch.cuda.is_available():
            return "cuda:0"
        return "cpu"

    def _ensure_loaded(self, requested_device: str) -> tuple[Any, Any, Any]:
        try:
            import torch
            from transformers import AutoImageProcessor, AutoModel
        except ImportError as exc:  # pragma: no cover - runtime dependency guard
            raise RuntimeError("DINOv2 retrieval requires transformers and PyTorch to be installed.") from exc

        device = self._resolve_runtime_device(requested_device)
        if self._model is None or self._processor is None or self._device != device:
            processor = AutoImageProcessor.from_pretrained(DINOv2_MODEL_ID)
            model = AutoModel.from_pretrained(DINOv2_MODEL_ID)
            model = model.to(device)
            model.eval()
            self._processor = processor
            self._model = model
            self._device = device
        return torch, self._processor, self._model

    def encode_images(self, image_paths: list[str | Path], requested_device: str) -> np.ndarray:
        if not image_paths:
            raise ValueError("At least one image is required for DINOv2 retrieval.")
        torch, processor, model = self._ensure_loaded(requested_device)

        images = [Image.open(image_path).convert("RGB") for image_path in image_paths]
        inputs = processor(images=images, return_tensors="pt")
        batch = {key: value.to(self._device) for key, value in inputs.items()}

        with torch.no_grad():
            outputs = model(**batch)
        if hasattr(outputs, "pooler_output") and outputs.pooler_output is not None:
            features = outputs.pooler_output
        else:
            features = outputs.last_hidden_state[:, 0]
        features = features / features.norm(dim=-1, keepdim=True).clamp_min(1e-12)
        return features.detach().cpu().numpy().astype(np.float32)
