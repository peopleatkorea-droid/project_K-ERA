from __future__ import annotations

import gc
import os
import shutil
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

ROOT_DIR = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))


def reload_model_artifact_module(model_dir: Path):
    for env_name in (
        "KERA_MODEL_DIR",
        "KERA_MODEL_AUTO_DOWNLOAD",
        "KERA_MODEL_KEEP_VERSIONS",
        "KERA_MODEL_DOWNLOAD_TIMEOUT_SECONDS",
        "KERA_ONEDRIVE_TENANT_ID",
        "KERA_ONEDRIVE_CLIENT_ID",
        "KERA_ONEDRIVE_CLIENT_SECRET",
        "KERA_ONEDRIVE_DRIVE_ID",
        "KERA_ONEDRIVE_ROOT_PATH",
        "KERA_ONEDRIVE_SHARE_SCOPE",
        "KERA_ONEDRIVE_SHARE_TYPE",
    ):
        os.environ.pop(env_name, None)
    os.environ["KERA_MODEL_DIR"] = str(model_dir)
    os.environ["KERA_MODEL_AUTO_DOWNLOAD"] = "true"
    os.environ["KERA_MODEL_KEEP_VERSIONS"] = "2"
    os.environ["KERA_MODEL_DOWNLOAD_TIMEOUT_SECONDS"] = "30"

    for module_name in list(sys.modules):
        if module_name.startswith("kera_research"):
            del sys.modules[module_name]

    import kera_research.services.model_artifacts as model_artifacts_module

    return model_artifacts_module


class _FakeResponse:
    def __init__(self, payload: bytes) -> None:
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def raise_for_status(self) -> None:
        return None

    def iter_content(self, chunk_size: int = 1024 * 1024):
        for start in range(0, len(self.payload), chunk_size):
            yield self.payload[start:start + chunk_size]


class ModelArtifactStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.model_dir = Path(self.tempdir.name) / "models"
        self.module = reload_model_artifact_module(self.model_dir)
        self.store = self.module.ModelArtifactStore()

    def tearDown(self) -> None:
        for _ in range(3):
            try:
                self.tempdir.cleanup()
                break
            except PermissionError:
                gc.collect()
                time.sleep(0.2)
        else:
            shutil.rmtree(self.tempdir.name, ignore_errors=True)

    def test_resolve_model_path_downloads_and_writes_active_manifest(self) -> None:
        payload = b"remote-model-checkpoint"
        sha256_value = self.store.sha256_file(self._write_temp_payload(payload))
        model_reference = {
            "version_id": "model_remote_v1",
            "version_name": "remote-v1",
            "model_name": "keratitis_cls",
            "filename": "model.pt",
            "download_url": "https://example.invalid/model.pt",
            "sha256": sha256_value,
            "size_bytes": len(payload),
        }

        with patch.object(self.module.requests, "get", return_value=_FakeResponse(payload)):
            local_path = self.store.resolve_model_path(model_reference, allow_download=True)

        self.assertTrue(local_path.exists())
        self.assertEqual(local_path.read_bytes(), payload)
        active_manifest = self.store.active_manifest()
        self.assertEqual(active_manifest["version_id"], "model_remote_v1")
        self.assertEqual(active_manifest["sha256"], sha256_value)

    def test_resolve_model_path_prefers_onedrive_graph_download_url(self) -> None:
        payload = b"graph-model-checkpoint"
        sha256_value = self.store.sha256_file(self._write_temp_payload(payload))
        model_reference = {
            "version_id": "model_onedrive_v1",
            "version_name": "onedrive-v1",
            "model_name": "keratitis_cls",
            "filename": "model.pt",
            "download_url": "https://sharepoint.example/not-direct",
            "source_provider": "onedrive_sharepoint",
            "onedrive_drive_id": "drive_123",
            "onedrive_item_id": "item_123",
            "sha256": sha256_value,
            "size_bytes": len(payload),
        }

        fake_publisher = Mock()
        fake_publisher.resolve_download_url.return_value = "https://example.invalid/direct-model.pt"
        with patch.object(self.module, "OneDrivePublisher", return_value=fake_publisher):
            with patch.object(self.module.requests, "get", return_value=_FakeResponse(payload)) as get_mock:
                local_path = self.store.resolve_model_path(model_reference, allow_download=True)

        self.assertTrue(local_path.exists())
        self.assertEqual(local_path.read_bytes(), payload)
        self.assertEqual(get_mock.call_args.args[0], "https://example.invalid/direct-model.pt")

    def test_resolve_model_path_follows_moved_kera_bundle(self) -> None:
        old_bundle = Path(self.tempdir.name) / "bundle_old" / "KERA_DATA"
        old_model_dir = old_bundle / "models"
        old_model_dir.mkdir(parents=True, exist_ok=True)
        old_model_path = old_model_dir / "portable_model.pt"
        old_model_path.write_bytes(b"portable-model")

        new_bundle = Path(self.tempdir.name) / "bundle_new" / "KERA_DATA"
        new_bundle.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(old_bundle), str(new_bundle))

        self.module = reload_model_artifact_module(new_bundle / "models")
        self.store = self.module.ModelArtifactStore()

        resolved = self.store.resolve_model_path(
            {
                "version_id": "model_portable_v1",
                "version_name": "portable-v1",
                "model_name": "keratitis_cls",
                "model_path": str(old_model_path),
            },
            allow_download=False,
        )

        self.assertEqual(resolved.resolve(), (new_bundle / "models" / "portable_model.pt").resolve())
        self.assertEqual(resolved.read_bytes(), b"portable-model")

    def test_resolve_model_path_writes_active_manifest_for_local_path(self) -> None:
        local_model_path = Path(self.tempdir.name) / "local_model.pt"
        local_model_path.write_bytes(b"local-model")

        resolved = self.store.resolve_model_path(
            {
                "version_id": "model_local_v1",
                "version_name": "local-v1",
                "model_name": "keratitis_cls",
                "model_path": str(local_model_path),
            },
            allow_download=False,
        )

        self.assertEqual(resolved.resolve(), local_model_path.resolve())
        active_manifest = self.store.active_manifest()
        self.assertEqual(active_manifest["version_id"], "model_local_v1")
        self.assertEqual(Path(active_manifest["local_path"]).resolve(), local_model_path.resolve())

    def _write_temp_payload(self, payload: bytes) -> Path:
        path = Path(self.tempdir.name) / "payload.bin"
        path.write_bytes(payload)
        return path


if __name__ == "__main__":
    unittest.main()
