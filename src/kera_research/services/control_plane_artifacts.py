from __future__ import annotations

import hashlib
import shutil
from pathlib import Path
from typing import Any, Callable
from urllib.parse import unquote, urlsplit

import requests

from kera_research.config import resolve_portable_path
from kera_research.services.onedrive_publisher import OneDrivePublisher
from kera_research.storage import ensure_dir


class ControlPlaneArtifactFacade:
    def __init__(
        self,
        *,
        artifact_root: Path,
        infer_remote_source_provider: Callable[[str], str],
        safe_artifact_name: Callable[[str, str], str],
    ) -> None:
        self.artifact_root = Path(artifact_root)
        self.infer_remote_source_provider = infer_remote_source_provider
        self.safe_artifact_name = safe_artifact_name

    def sha256_file(self, path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    def model_update_artifact_key(self, *, update_id: str, artifact_kind: str = "delta", filename: str = "") -> str:
        safe_update_id = self.safe_artifact_name(update_id, "update")
        suffix = Path(filename).suffix or ".bin"
        safe_filename = self.safe_artifact_name(filename, f"{artifact_kind}{suffix}")
        return str((Path("model_updates") / safe_update_id / safe_filename).as_posix())

    def model_update_artifact_path_for_key(self, artifact_key: str) -> Path:
        normalized_key = str(artifact_key or "").replace("\\", "/").strip().lstrip("/")
        if not normalized_key:
            raise ValueError("Artifact key is required.")
        artifact_root = self.artifact_root.resolve()
        candidate = (artifact_root / Path(normalized_key)).resolve()
        try:
            candidate.relative_to(artifact_root)
        except ValueError as exc:
            raise ValueError("Artifact key resolves outside the control plane artifact directory.") from exc
        return candidate

    def normalize_model_update_artifact_metadata(self, record: dict[str, Any]) -> dict[str, Any]:
        normalized = dict(record)
        update_id = str(normalized.get("update_id") or "").strip()
        artifact_kind = str(normalized.get("artifact_kind") or "").strip() or (
            "delta" if str(normalized.get("upload_type") or "").strip().lower() == "weight delta" else "model"
        )

        central_artifact_key = str(normalized.get("central_artifact_key") or "").strip().replace("\\", "/")
        if not central_artifact_key:
            central_artifact_path = str(normalized.get("central_artifact_path") or "").strip()
            if central_artifact_path:
                try:
                    resolved_path = Path(central_artifact_path).expanduser().resolve()
                    resolved_path.relative_to(self.artifact_root.resolve())
                    central_artifact_key = str(resolved_path.relative_to(self.artifact_root.resolve()).as_posix())
                except (OSError, ValueError):
                    central_artifact_key = ""
            if not central_artifact_key and update_id:
                filename = str(normalized.get("central_artifact_name") or "").strip()
                if not filename:
                    download_name = unquote(Path(urlsplit(str(normalized.get("artifact_download_url") or "")).path).name)
                    filename = download_name or f"{artifact_kind}.bin"
                central_artifact_key = self.model_update_artifact_key(
                    update_id=update_id,
                    artifact_kind=artifact_kind,
                    filename=filename,
                )
        if central_artifact_key:
            normalized["central_artifact_key"] = central_artifact_key

        download_url = str(normalized.get("artifact_download_url") or "").strip()
        if download_url:
            normalized["artifact_source_provider"] = (
                str(normalized.get("artifact_source_provider") or "").strip()
                or self.infer_remote_source_provider(download_url)
            )
            normalized["artifact_distribution_status"] = str(
                normalized.get("artifact_distribution_status") or "published"
            ).strip() or "published"
        else:
            normalized.setdefault("artifact_source_provider", "local")
            normalized.setdefault("artifact_distribution_status", "local_only")

        normalized.pop("central_artifact_path", None)
        return normalized

    def resolve_model_update_artifact_path(
        self,
        record: dict[str, Any],
        *,
        allow_download: bool = True,
    ) -> Path:
        normalized = self.normalize_model_update_artifact_metadata(record)
        expected_sha = str(normalized.get("central_artifact_sha256") or "").strip().lower()
        expected_size = int(normalized.get("central_artifact_size_bytes") or 0)
        central_artifact_key = str(normalized.get("central_artifact_key") or "").strip()
        if central_artifact_key:
            target = self.model_update_artifact_path_for_key(central_artifact_key)
            if target.exists():
                if expected_sha and self.sha256_file(target).lower() != expected_sha:
                    target.unlink(missing_ok=True)
                elif expected_size and int(target.stat().st_size) != expected_size:
                    target.unlink(missing_ok=True)
                else:
                    return target

        legacy_central_path = str(record.get("central_artifact_path") or "").strip()
        if legacy_central_path:
            legacy_candidate, _ = resolve_portable_path(legacy_central_path, require_exists=True)
            if legacy_candidate.exists():
                return legacy_candidate.resolve()

        local_artifact_path = str(record.get("artifact_path") or "").strip()
        if local_artifact_path:
            local_candidate, _ = resolve_portable_path(local_artifact_path, require_exists=True)
            if local_candidate.exists():
                return local_candidate.resolve()

        download_url = ""
        artifact_source_provider = str(normalized.get("artifact_source_provider") or "").strip().lower()
        has_onedrive_locator = bool(
            str(normalized.get("onedrive_item_id") or "").strip()
            or str(normalized.get("onedrive_remote_path") or "").strip()
        )
        if artifact_source_provider == "onedrive_sharepoint" or has_onedrive_locator:
            try:
                download_url = OneDrivePublisher().resolve_download_url(normalized)
            except ValueError:
                download_url = ""
        if not download_url:
            download_url = str(normalized.get("artifact_download_url") or "").strip()
        if not allow_download or not download_url:
            raise FileNotFoundError("Model update artifact is unavailable locally and has no download_url.")

        target = self.model_update_artifact_path_for_key(
            central_artifact_key
            or self.model_update_artifact_key(
                update_id=str(normalized.get("update_id") or "update"),
                artifact_kind=str(normalized.get("artifact_kind") or "delta"),
                filename=str(normalized.get("central_artifact_name") or "").strip()
                or unquote(Path(urlsplit(download_url).path).name)
                or "delta.bin",
            )
        )
        ensure_dir(target.parent)
        temp_path = target.with_suffix(target.suffix + ".part")
        if temp_path.exists():
            temp_path.unlink()

        with requests.get(download_url, stream=True, timeout=300) as response:
            response.raise_for_status()
            with temp_path.open("wb") as handle:
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    if not chunk:
                        continue
                    handle.write(chunk)

        if expected_sha and self.sha256_file(temp_path).lower() != expected_sha:
            temp_path.unlink(missing_ok=True)
            raise ValueError("Downloaded model update artifact SHA256 mismatch.")
        if expected_size and int(temp_path.stat().st_size) != expected_size:
            temp_path.unlink(missing_ok=True)
            raise ValueError("Downloaded model update artifact size mismatch.")

        shutil.move(str(temp_path), str(target))
        return target.resolve()

    def store_model_update_artifact(
        self,
        source_path: str | Path,
        *,
        update_id: str,
        artifact_kind: str = "delta",
    ) -> dict[str, Any]:
        source = Path(source_path).resolve()
        if not source.exists():
            raise FileNotFoundError(f"Model update artifact does not exist: {source}")

        suffix = source.suffix or ".bin"
        filename = f"{artifact_kind}{suffix}"
        artifact_key = self.model_update_artifact_key(
            update_id=update_id,
            artifact_kind=artifact_kind,
            filename=filename,
        )
        target = self.model_update_artifact_path_for_key(artifact_key)
        ensure_dir(target.parent)
        if source != target:
            shutil.copy2(source, target)

        return {
            "central_artifact_key": artifact_key,
            "central_artifact_name": target.name,
            "central_artifact_size_bytes": int(target.stat().st_size),
            "central_artifact_sha256": self.sha256_file(target),
            "artifact_storage": "control_plane_filesystem",
            "artifact_kind": artifact_kind,
            "artifact_source_provider": "local",
            "artifact_distribution_status": "local_only",
        }
