from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np

from kera_research.services.data_plane import SiteStore
from kera_research.storage import ensure_dir, read_json, write_json


class FaissCaseIndexManager:
    def __init__(self) -> None:
        self._faiss: Any | None = None
        # Maps index_path → (loaded_index, mtime, cases) for in-memory reuse.
        # Invalidated automatically when rebuild_index() rewrites the file.
        self._index_cache: dict[str, tuple[Any, float, list]] = {}

    def _ensure_faiss(self) -> Any:
        if self._faiss is not None:
            return self._faiss
        try:
            import faiss
        except ImportError as exc:
            raise RuntimeError("FAISS local vector index requires faiss-cpu or faiss-gpu to be installed.") from exc
        self._faiss = faiss
        return faiss

    def _backend_key(self, backend: str) -> str:
        return str(backend or "classifier").strip().lower().replace(" ", "_")

    def _index_dir(self, site_store: SiteStore, model_version_id: str, backend: str) -> Path:
        return ensure_dir(site_store.artifact_dir / "vector_indices" / model_version_id / self._backend_key(backend))

    def _index_paths(self, site_store: SiteStore, model_version_id: str, backend: str) -> tuple[Path, Path]:
        index_dir = self._index_dir(site_store, model_version_id, backend)
        return index_dir / "cases.faiss", index_dir / "cases.meta.json"

    def index_exists(
        self,
        site_store: SiteStore,
        *,
        model_version_id: str,
        backend: str,
    ) -> bool:
        index_path, metadata_path = self._index_paths(site_store, model_version_id, backend)
        return index_path.exists() and metadata_path.exists()

    def rebuild_index(
        self,
        site_store: SiteStore,
        *,
        model_version_id: str,
        backend: str,
    ) -> dict[str, Any]:
        faiss = self._ensure_faiss()
        embedding_root = site_store.embedding_dir / model_version_id / self._backend_key(backend)
        index_path, metadata_path = self._index_paths(site_store, model_version_id, backend)

        rows: list[dict[str, Any]] = []
        vectors: list[np.ndarray] = []
        if embedding_root.exists():
            for meta_path in sorted(embedding_root.glob("*.json")):
                payload = read_json(meta_path, {})
                vector_path = meta_path.with_suffix(".npy")
                if not vector_path.exists():
                    continue
                try:
                    vector = np.load(vector_path).astype(np.float32).reshape(-1)
                except OSError:
                    continue
                rows.append(
                    {
                        "case_id": f"{payload.get('patient_id', '')}::{payload.get('visit_date', '')}",
                        "patient_id": payload.get("patient_id"),
                        "visit_date": payload.get("visit_date"),
                        "vector_path": str(vector_path),
                        "metadata_path": str(meta_path),
                    }
                )
                vectors.append(vector)

        if not vectors:
            index_path.unlink(missing_ok=True)
            write_json(
                metadata_path,
                {
                    "model_version_id": model_version_id,
                    "backend": backend,
                    "count": 0,
                    "dimension": 0,
                    "cases": [],
                },
            )
            return {
                "backend": backend,
                "count": 0,
                "dimension": 0,
                "index_path": str(index_path),
                "metadata_path": str(metadata_path),
            }

        matrix = np.vstack(vectors).astype(np.float32)
        faiss.normalize_L2(matrix)
        dimension = int(matrix.shape[1])
        index = faiss.IndexFlatIP(dimension)
        index.add(matrix)
        faiss.write_index(index, str(index_path))
        self._index_cache.pop(str(index_path), None)
        write_json(
            metadata_path,
            {
                "model_version_id": model_version_id,
                "backend": backend,
                "count": int(matrix.shape[0]),
                "dimension": dimension,
                "cases": rows,
            },
        )
        return {
            "backend": backend,
            "count": int(matrix.shape[0]),
            "dimension": dimension,
            "index_path": str(index_path),
            "metadata_path": str(metadata_path),
        }

    def search(
        self,
        site_store: SiteStore,
        *,
        model_version_id: str,
        backend: str,
        query_embedding: np.ndarray,
        top_k: int,
    ) -> list[dict[str, Any]]:
        faiss = self._ensure_faiss()
        index_path, metadata_path = self._index_paths(site_store, model_version_id, backend)
        if not (index_path.exists() and metadata_path.exists()):
            raise FileNotFoundError("FAISS index is not available.")
        cache_key = str(index_path)
        mtime = index_path.stat().st_mtime
        cache_entry = self._index_cache.get(cache_key)
        if cache_entry is None or cache_entry[1] != mtime:
            metadata = read_json(metadata_path, {})
            cases = list(metadata.get("cases") or [])
            loaded_index = faiss.read_index(cache_key) if cases else None
            self._index_cache[cache_key] = (loaded_index, mtime, cases)
        else:
            loaded_index, _, cases = cache_entry
        if not cases or loaded_index is None:
            return []
        index = loaded_index
        query = np.asarray(query_embedding, dtype=np.float32).reshape(1, -1)
        faiss.normalize_L2(query)
        limit = max(1, min(int(top_k or 1), len(cases)))
        scores, indices = index.search(query, limit)
        hits: list[dict[str, Any]] = []
        for rank, (score, idx) in enumerate(zip(scores[0].tolist(), indices[0].tolist(), strict=False), start=1):
            if idx < 0 or idx >= len(cases):
                continue
            row = dict(cases[idx])
            row["similarity"] = round(float(score), 4)
            row["rank"] = rank
            hits.append(row)
        return hits
