from __future__ import annotations

import hashlib
from pathlib import Path
from typing import TYPE_CHECKING, Any

import numpy as np
from PIL import Image
from kera_research.services.biomedclip_runtime import BIOMEDCLIP_MODEL_ID, ensure_biomedclip_runtime

DINOv2_MODEL_ID = "facebook/dinov2-base"

if TYPE_CHECKING:
    from kera_research.services.data_plane import SiteStore


class BiomedClipTextRetriever:
    def __init__(self) -> None:
        self._image_cache: dict[str, np.ndarray] = {}
        self._text_cache: dict[str, np.ndarray] = {}

    def _ensure_loaded(self, requested_device: str) -> tuple[Any, Any, Any, Any, str]:
        runtime = ensure_biomedclip_runtime(requested_device)
        return runtime.torch, runtime.model, runtime.preprocess, runtime.tokenizer, runtime.device

    def _biomedclip_embedding_dir(self, site_store: SiteStore) -> Path:
        from kera_research.storage import ensure_dir
        return ensure_dir(site_store.artifact_dir / "embeddings" / "biomedclip")

    def _prepare_case_biomedclip_embedding(
        self,
        site_store: SiteStore,
        case_records: list[dict[str, Any]],
        requested_device: str,
        force_refresh: bool = False,
    ) -> np.ndarray:
        if not case_records:
            raise ValueError("No records provided for BiomedCLIP case embedding.")

        image_paths = [
            Path(str(record.get("image_path") or "").strip())
            for record in case_records
            if str(record.get("image_path") or "").strip()
        ]
        if not image_paths:
            raise ValueError("No valid image paths found in case records for BiomedCLIP.")

        persistence_dir = self._biomedclip_embedding_dir(site_store)
        image_features = self.encode_images(
            image_paths,
            requested_device,
            persistence_dir=persistence_dir,
        )
        case_vector = np.mean(image_features, axis=0).astype(np.float32)
        case_vector = case_vector / max(float(np.linalg.norm(case_vector)), 1e-12)
        return case_vector

    def warmup(self, requested_device: str = "auto") -> None:
        self._ensure_loaded(requested_device)

    def encode_images(
        self,
        image_paths: list[str | Path],
        requested_device: str,
        batch_size: int = 32,
        persistence_dir: Path | None = None,
    ) -> np.ndarray:
        if not image_paths:
            raise ValueError("At least one image is required for BiomedCLIP retrieval.")
        torch, model, preprocess, _tokenizer, device = self._ensure_loaded(requested_device)

        results: list[np.ndarray | None] = [None] * len(image_paths)
        uncached_indices: list[int] = []
        for i, image_path in enumerate(image_paths):
            image_path_str = str(image_path)
            cached = self._image_cache.get(image_path_str)
            if cached is not None:
                results[i] = cached
            elif persistence_dir is not None:
                # Try loading from disk cache
                cache_key = hashlib.sha256(image_path_str.encode()).hexdigest()
                disk_path = persistence_dir / f"{cache_key}.npy"
                if disk_path.exists():
                    try:
                        cached = np.load(disk_path)
                        self._image_cache[image_path_str] = cached
                        results[i] = cached
                    except (OSError, ValueError):
                        uncached_indices.append(i)
                else:
                    uncached_indices.append(i)
            else:
                uncached_indices.append(i)

        for chunk_start in range(0, len(uncached_indices), batch_size):
            chunk_indices = uncached_indices[chunk_start : chunk_start + batch_size]
            tensors: list[Any] = []
            valid_chunk_indices: list[int] = []
            for idx in chunk_indices:
                try:
                    tensors.append(preprocess(Image.open(image_paths[idx]).convert("RGB")))
                    valid_chunk_indices.append(idx)
                except Exception:
                    results[idx] = np.zeros(512, dtype=np.float32)
            if not tensors:
                continue
            batch = torch.stack(tensors).to(device)
            with torch.no_grad():
                features = model.encode_image(batch)
            features = features / features.norm(dim=-1, keepdim=True).clamp_min(1e-12)
            embeddings = features.detach().cpu().numpy().astype(np.float32)
            for j, idx in enumerate(valid_chunk_indices):
                image_path_str = str(image_paths[idx])
                embedding = embeddings[j]
                self._image_cache[image_path_str] = embedding
                results[idx] = embedding
                if persistence_dir is not None:
                    cache_key = hashlib.sha256(image_path_str.encode()).hexdigest()
                    disk_path = persistence_dir / f"{cache_key}.npy"
                    try:
                        persistence_dir.mkdir(parents=True, exist_ok=True)
                        np.save(disk_path, embedding)
                    except OSError:
                        pass
        return np.stack(results, axis=0)  # type: ignore[arg-type]

    def encode_texts(self, texts: list[str], requested_device: str) -> np.ndarray:
        if not texts:
            raise ValueError("At least one text is required for BiomedCLIP retrieval.")
        torch, model, _preprocess, tokenizer, device = self._ensure_loaded(requested_device)

        results: list[np.ndarray | None] = [None] * len(texts)
        uncached_indices: list[int] = []
        uncached_texts_batch: list[str] = []
        for i, text in enumerate(texts):
            cache_key = hashlib.sha256(text.encode()).hexdigest()
            cached = self._text_cache.get(cache_key)
            if cached is not None:
                results[i] = cached
            else:
                uncached_indices.append(i)
                uncached_texts_batch.append(text)
        if uncached_texts_batch:
            tokens = tokenizer(uncached_texts_batch).to(device)
            with torch.no_grad():
                features = model.encode_text(tokens)
            features = features / features.norm(dim=-1, keepdim=True).clamp_min(1e-12)
            embeddings = features.detach().cpu().numpy().astype(np.float32)
            for j, idx in enumerate(uncached_indices):
                cache_key = hashlib.sha256(texts[idx].encode()).hexdigest()
                self._text_cache[cache_key] = embeddings[j]
                results[idx] = embeddings[j]
        return np.stack(results, axis=0)  # type: ignore[arg-type]

    def retrieve_texts(
        self,
        *,
        site_store: SiteStore,
        query_image_paths: list[str | Path],
        text_records: list[dict[str, Any]],
        requested_device: str,
        top_k: int = 3,
        persistence_dir: Path | None = None,
    ) -> dict[str, Any]:
        if not text_records:
            return {
                "text_retrieval_mode": "biomedclip_image_to_text",
                "text_embedding_model": BIOMEDCLIP_MODEL_ID,
                "eligible_text_count": 0,
                "text_evidence": [],
            }

        if persistence_dir is None:
            persistence_dir = self._biomedclip_embedding_dir(site_store)

        image_features = self.encode_images(query_image_paths, requested_device, persistence_dir=persistence_dir)
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

    def retrieve_images(
        self,
        *,
        query_text: str,
        image_records: list[dict[str, Any]],
        requested_device: str,
        top_k: int = 10,
        persistence_dir: Path | None = None,
    ) -> dict[str, Any]:
        if not image_records:
            return {
                "text_retrieval_mode": "biomedclip_text_to_image",
                "text_embedding_model": BIOMEDCLIP_MODEL_ID,
                "eligible_image_count": 0,
                "results": [],
            }

        text_features = self.encode_texts(query_text, requested_device) if isinstance(query_text, list) else self.encode_texts([query_text], requested_device)
        query_vector = text_features[0].astype(np.float32)

        valid_records: list[dict[str, Any]] = []
        valid_paths: list[str] = []
        for record in image_records:
            path = str(record.get("image_path") or "").strip()
            if path:
                valid_records.append(record)
                valid_paths.append(path)

        if not valid_paths:
            return {
                "text_retrieval_mode": "biomedclip_text_to_image",
                "text_embedding_model": BIOMEDCLIP_MODEL_ID,
                "eligible_image_count": 0,
                "results": [],
            }

        image_features = self.encode_images(valid_paths, requested_device, persistence_dir=persistence_dir)
        similarities = np.matmul(image_features, query_vector).tolist()

        ranked = sorted(
            zip(valid_records, similarities, strict=False),
            key=lambda item: float(item[1]),
            reverse=True,
        )

        results = [
            {**record, "score": round(float(score), 4)}
            for record, score in ranked[: max(1, min(int(top_k or 10), 50))]
        ]

        return {
            "text_retrieval_mode": "biomedclip_text_to_image",
            "text_embedding_model": BIOMEDCLIP_MODEL_ID,
            "eligible_image_count": len(valid_records),
            "results": results,
        }


class Dinov2ImageRetriever:
    def __init__(self, *, ssl_checkpoint_path: str | Path | None = None) -> None:
        self._model: Any | None = None
        self._processor: Any | None = None
        self._device: str | None = None
        self._image_cache: dict[str, np.ndarray] = {}
        self._ssl_checkpoint_path = (
            str(Path(ssl_checkpoint_path).expanduser().resolve())
            if ssl_checkpoint_path
            else None
        )
        self._cache_namespace = (
            f"dinov2_ssl::{self._ssl_checkpoint_path}"
            if self._ssl_checkpoint_path
            else f"dinov2_official::{DINOv2_MODEL_ID}"
        )

    @property
    def source_label(self) -> str:
        return "ssl" if self._ssl_checkpoint_path else "official"

    @property
    def source_reference(self) -> str:
        return self._ssl_checkpoint_path or DINOv2_MODEL_ID

    def _disk_cache_key(self, image_path: str | Path) -> str:
        return hashlib.sha256(f"{self._cache_namespace}::{image_path}".encode()).hexdigest()

    def _load_ssl_checkpoint_into_model(self, model: Any, checkpoint_path: str) -> None:
        try:
            import torch
        except ImportError as exc:  # pragma: no cover - runtime dependency guard
            raise RuntimeError("DINOv2 SSL retrieval requires PyTorch.") from exc

        resolved = Path(checkpoint_path).expanduser().resolve()
        if not resolved.exists():
            raise FileNotFoundError(f"DINOv2 SSL checkpoint does not exist: {resolved}")
        checkpoint = torch.load(resolved, map_location="cpu", weights_only=False)
        if not isinstance(checkpoint, dict):
            raise ValueError("DINOv2 SSL checkpoint format is invalid.")
        checkpoint_architecture = str(checkpoint.get("architecture") or "").strip().lower()
        if checkpoint_architecture and checkpoint_architecture != "dinov2":
            raise ValueError(
                f"DINOv2 retrieval expected a dinov2 SSL checkpoint, found {checkpoint_architecture}."
            )
        raw_state_dict = checkpoint.get("state_dict")
        if not isinstance(raw_state_dict, dict) or not raw_state_dict:
            raise ValueError("DINOv2 SSL checkpoint does not contain a usable state_dict.")

        state_dict = {
            key[len("backbone.") :] if key.startswith("backbone.") else key: value
            for key, value in raw_state_dict.items()
        }
        incompatible = model.load_state_dict(state_dict, strict=False)
        missing = list(incompatible.missing_keys)
        unexpected = list(incompatible.unexpected_keys)
        if missing or unexpected:
            raise ValueError(
                "DINOv2 SSL retrieval checkpoint could not be applied cleanly: "
                f"missing={missing[:8]}, unexpected={unexpected[:8]}"
            )

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
            if self._ssl_checkpoint_path:
                self._load_ssl_checkpoint_into_model(model, self._ssl_checkpoint_path)
            model = model.to(device)
            model.eval()
            self._processor = processor
            self._model = model
            self._device = device
        return torch, self._processor, self._model

    def encode_images(
        self,
        image_paths: list[str | Path],
        requested_device: str,
        batch_size: int = 32,
        persistence_dir: Path | None = None,
    ) -> np.ndarray:
        if not image_paths:
            raise ValueError("At least one image is required for DINOv2 retrieval.")
        torch, processor, model = self._ensure_loaded(requested_device)

        results: list[np.ndarray | None] = [None] * len(image_paths)
        uncached_indices: list[int] = []
        for i, image_path in enumerate(image_paths):
            image_path_str = str(image_path)
            cached = self._image_cache.get(image_path_str)
            if cached is not None:
                results[i] = cached
            elif persistence_dir is not None:
                # Try loading from disk cache
                cache_key = self._disk_cache_key(image_path_str)
                disk_path = persistence_dir / f"{cache_key}.npy"
                if disk_path.exists():
                    try:
                        cached = np.load(disk_path)
                        self._image_cache[image_path_str] = cached
                        results[i] = cached
                    except (OSError, ValueError):
                        uncached_indices.append(i)
                else:
                    uncached_indices.append(i)
            else:
                uncached_indices.append(i)

        embed_dim = 768
        for chunk_start in range(0, len(uncached_indices), batch_size):
            chunk_indices = uncached_indices[chunk_start : chunk_start + batch_size]
            pil_images: list[Any] = []
            valid_chunk_indices: list[int] = []
            for idx in chunk_indices:
                try:
                    pil_images.append(Image.open(image_paths[idx]).convert("RGB"))
                    valid_chunk_indices.append(idx)
                except Exception:
                    results[idx] = np.zeros(embed_dim, dtype=np.float32)
            if not pil_images:
                continue
            inputs = processor(images=pil_images, return_tensors="pt")
            batch = {key: value.to(self._device) for key, value in inputs.items()}
            with torch.no_grad():
                outputs = model(**batch)
            if hasattr(outputs, "pooler_output") and outputs.pooler_output is not None:
                features = outputs.pooler_output
            else:
                features = outputs.last_hidden_state[:, 0]
            features = features / features.norm(dim=-1, keepdim=True).clamp_min(1e-12)
            embeddings = features.detach().cpu().numpy().astype(np.float32)
            for j, idx in enumerate(valid_chunk_indices):
                image_path_str = str(image_paths[idx])
                embedding = embeddings[j]
                self._image_cache[image_path_str] = embedding
                results[idx] = embedding
                if persistence_dir is not None:
                    cache_key = self._disk_cache_key(image_path_str)
                    disk_path = persistence_dir / f"{cache_key}.npy"
                    try:
                        persistence_dir.mkdir(parents=True, exist_ok=True)
                        np.save(disk_path, embedding)
                    except OSError:
                        pass
        return np.stack(results, axis=0)  # type: ignore[arg-type]
