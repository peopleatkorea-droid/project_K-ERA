from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path
from typing import Any

import requests

from kera_research.config import (
    MODEL_ACTIVE_MANIFEST_PATH,
    MODEL_AUTO_DOWNLOAD,
    MODEL_CACHE_DIR,
    MODEL_DIR,
    MODEL_DOWNLOAD_TIMEOUT_SECONDS,
    MODEL_KEEP_VERSIONS,
    resolve_portable_path,
)
from kera_research.services.onedrive_publisher import OneDrivePublisher
from kera_research.storage import ensure_dir, read_json, write_json


def _safe_name(value: str, fallback: str) -> str:
    normalized = "".join(ch if ch.isalnum() or ch in {"-", "_", "."} else "_" for ch in str(value or "").strip())
    collapsed = normalized.strip("._")
    return collapsed or fallback


class ModelArtifactStore:
    def __init__(self) -> None:
        ensure_dir(MODEL_DIR)
        ensure_dir(MODEL_CACHE_DIR)

    def resolve_model_reference(
        self,
        model_reference: dict[str, Any],
        *,
        allow_download: bool | None = None,
    ) -> dict[str, Any]:
        resolved = dict(model_reference)
        resolved_path = self.resolve_model_path(model_reference, allow_download=allow_download)
        resolved["model_path"] = str(resolved_path)
        resolved["resolved_model_path"] = str(resolved_path)
        return resolved

    def resolve_model_path(
        self,
        model_reference: dict[str, Any],
        *,
        allow_download: bool | None = None,
    ) -> Path:
        local_path = str(model_reference.get("model_path") or "").strip()
        if local_path:
            candidate, remapped = resolve_portable_path(local_path, require_exists=True)
            if candidate.exists():
                resolved_candidate = candidate.resolve()
                expected_sha = str(model_reference.get("sha256") or "").strip().lower()
                self._write_active_manifest(model_reference, resolved_candidate, expected_sha)
                return resolved_candidate
            if remapped:
                local_path = str(candidate)

        cache_path = self._cache_path(model_reference)
        expected_sha = str(model_reference.get("sha256") or "").strip().lower()

        if cache_path.exists():
            if expected_sha:
                actual_sha = self.sha256_file(cache_path)
                if actual_sha.lower() == expected_sha:
                    self._write_active_manifest(model_reference, cache_path, expected_sha)
                    return cache_path
                cache_path.unlink(missing_ok=True)
            else:
                self._write_active_manifest(model_reference, cache_path, "")
                return cache_path

        should_download = MODEL_AUTO_DOWNLOAD if allow_download is None else bool(allow_download)
        download_url = str(model_reference.get("download_url") or "").strip()
        if not should_download or not download_url:
            if local_path:
                raise FileNotFoundError(f"Model artifact not found on disk: {local_path}")
            raise FileNotFoundError(
                f"Model artifact is unavailable locally and no download_url is configured for {model_reference.get('version_id')!r}."
            )

        return self._download_to_cache(model_reference, cache_path)

    def sha256_file(self, path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    def file_size(self, path: Path) -> int:
        return int(path.stat().st_size)

    def cache_metadata(self, model_reference: dict[str, Any], local_path: Path) -> dict[str, Any]:
        return {
            "model_name": str(model_reference.get("model_name") or model_reference.get("architecture") or "model"),
            "version_id": str(model_reference.get("version_id") or ""),
            "version_name": str(model_reference.get("version_name") or ""),
            "filename": local_path.name,
            "local_path": str(local_path),
            "sha256": str(model_reference.get("sha256") or "").strip().lower() or self.sha256_file(local_path),
            "size_bytes": int(model_reference.get("size_bytes") or self.file_size(local_path)),
            "download_url": str(model_reference.get("download_url") or "").strip(),
        }

    def _cache_path(self, model_reference: dict[str, Any]) -> Path:
        model_name = _safe_name(
            str(model_reference.get("model_name") or model_reference.get("architecture") or "model"),
            "model",
        )
        version_token = _safe_name(
            str(model_reference.get("version_name") or model_reference.get("version_id") or "unknown"),
            "unknown",
        )
        filename = _safe_name(
            str(model_reference.get("filename") or Path(str(model_reference.get("model_path") or "model.pt")).name or "model.pt"),
            "model.pt",
        )
        return ensure_dir(MODEL_CACHE_DIR / model_name / version_token) / filename

    def _write_active_manifest(self, model_reference: dict[str, Any], cache_path: Path, sha256_value: str) -> None:
        payload = self.cache_metadata(model_reference, cache_path)
        payload["sha256"] = sha256_value or payload["sha256"]
        write_json(MODEL_ACTIVE_MANIFEST_PATH, payload)

    def _write_cache_manifest(self, model_reference: dict[str, Any], cache_path: Path, sha256_value: str, size_bytes: int) -> None:
        payload = self.cache_metadata(model_reference, cache_path)
        payload["sha256"] = sha256_value or payload["sha256"]
        payload["size_bytes"] = int(size_bytes)
        write_json(cache_path.parent / "manifest.json", payload)

    def _download_to_cache(self, model_reference: dict[str, Any], cache_path: Path) -> Path:
        download_url = self._resolve_download_url(model_reference)
        if not download_url:
            raise FileNotFoundError(f"Model download URL is missing for {model_reference.get('version_id')!r}.")

        ensure_dir(cache_path.parent)
        temp_path = cache_path.with_suffix(cache_path.suffix + ".part")
        if temp_path.exists():
            temp_path.unlink()

        timeout = max(30.0, float(MODEL_DOWNLOAD_TIMEOUT_SECONDS))
        digest = hashlib.sha256()
        size_bytes = 0
        with requests.get(download_url, stream=True, timeout=timeout) as response:
            response.raise_for_status()
            with temp_path.open("wb") as handle:
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    if not chunk:
                        continue
                    handle.write(chunk)
                    digest.update(chunk)
                    size_bytes += len(chunk)

        expected_sha = str(model_reference.get("sha256") or "").strip().lower()
        actual_sha = digest.hexdigest().lower()
        if expected_sha and actual_sha != expected_sha:
            temp_path.unlink(missing_ok=True)
            raise ValueError(
                f"Downloaded model SHA256 mismatch for {model_reference.get('version_id')!r}: expected {expected_sha}, got {actual_sha}."
            )

        expected_size = int(model_reference.get("size_bytes") or 0)
        if expected_size and size_bytes != expected_size:
            temp_path.unlink(missing_ok=True)
            raise ValueError(
                f"Downloaded model size mismatch for {model_reference.get('version_id')!r}: expected {expected_size}, got {size_bytes}."
            )

        shutil.move(str(temp_path), str(cache_path))
        self._write_cache_manifest(model_reference, cache_path, actual_sha, size_bytes)
        self._write_active_manifest(model_reference, cache_path, actual_sha)
        self.cleanup_cached_versions(str(model_reference.get("model_name") or model_reference.get("architecture") or "model"))
        return cache_path

    def _resolve_download_url(self, model_reference: dict[str, Any]) -> str:
        source_provider = str(model_reference.get("source_provider") or "").strip().lower()
        has_onedrive_locator = bool(
            str(model_reference.get("onedrive_item_id") or "").strip()
            or str(model_reference.get("onedrive_remote_path") or "").strip()
        )
        if source_provider == "onedrive_sharepoint" or has_onedrive_locator:
            try:
                return OneDrivePublisher().resolve_download_url(model_reference)
            except ValueError:
                pass
        return str(model_reference.get("download_url") or "").strip()

    def cleanup_cached_versions(self, model_name: str) -> None:
        safe_model_name = _safe_name(model_name, "model")
        model_root = MODEL_CACHE_DIR / safe_model_name
        if not model_root.exists():
            return
        version_dirs = sorted(
            [path for path in model_root.iterdir() if path.is_dir()],
            key=lambda item: item.stat().st_mtime,
            reverse=True,
        )
        for stale_dir in version_dirs[MODEL_KEEP_VERSIONS:]:
            shutil.rmtree(stale_dir, ignore_errors=True)

    def active_manifest(self) -> dict[str, Any]:
        payload = read_json(MODEL_ACTIVE_MANIFEST_PATH, {})
        return payload if isinstance(payload, dict) else {}

    def register_local_metadata(self, model_reference: dict[str, Any], *, local_path: str | Path) -> dict[str, Any]:
        path = Path(local_path).expanduser().resolve()
        if not path.exists():
            raise FileNotFoundError(f"Model file does not exist: {path}")
        metadata = dict(model_reference)
        metadata.setdefault("filename", path.name)
        metadata["size_bytes"] = self.file_size(path)
        metadata["sha256"] = self.sha256_file(path)
        return metadata
