from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT_DIR = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))


def reload_control_plane_models_module():
    for module_name in list(sys.modules):
        if module_name.startswith("kera_research"):
            del sys.modules[module_name]
    import kera_research.services.control_plane_models as control_plane_models_module

    return control_plane_models_module


class _FakeArtifactStore:
    def resolve_model_path(self, model_reference, allow_download=False):
        raw_path = str(model_reference.get("model_path") or "").strip()
        if not raw_path:
            raise FileNotFoundError("")
        path = Path(raw_path).expanduser()
        if path.exists():
            return path.resolve()
        raise FileNotFoundError(str(path))


class _FakeRegistry:
    def __init__(self, versions: list[dict[str, object]]) -> None:
        self._versions = [dict(item) for item in versions]

    def list_model_versions(self) -> list[dict[str, object]]:
        return [dict(item) for item in self._versions]

    def current_global_model(self) -> dict[str, object] | None:
        global_versions = [
            item
            for item in self._versions
            if item.get("stage") == "global" and item.get("ready", True)
        ]
        if not global_versions:
            return None
        current = next((item for item in global_versions if item.get("is_current")), None)
        target = current or global_versions[-1]
        return dict(target)

    def ensure_model_version(self, model_metadata: dict[str, object]) -> dict[str, object]:
        merged = dict(model_metadata)
        if merged.get("stage") == "global" and merged.get("ready", True) and merged.get("is_current"):
            for item in self._versions:
                if item.get("stage") == "global":
                    item["is_current"] = False

        existing = next(
            (item for item in self._versions if item.get("version_id") == merged.get("version_id")),
            None,
        )
        if existing is None:
            self._versions.append(merged)
            existing = self._versions[-1]
        else:
            existing.update(merged)
        return dict(existing)


class _FakeStore:
    def __init__(self, remote_release: dict[str, object] | None, registry: _FakeRegistry) -> None:
        self._remote_release = dict(remote_release) if isinstance(remote_release, dict) else None
        self.registry = registry

    def _remote_current_release_manifest(self) -> dict[str, object] | None:
        return dict(self._remote_release) if isinstance(self._remote_release, dict) else None

    def _normalize_remote_release(self, release: dict[str, object]) -> dict[str, object]:
        return dict(release)


class ControlPlaneModelFacadeTests(unittest.TestCase):
    def test_current_global_model_falls_back_to_preferred_local_model_when_remote_release_is_placeholder(self) -> None:
        module = reload_control_plane_models_module()

        placeholder = {
            "version_id": "model_http_seed",
            "version_name": "global-http-seed",
            "architecture": "densenet121",
            "stage": "global",
            "created_at": "2026-03-11T00:00:00+00:00",
            "ready": True,
            "is_current": True,
            "download_url": "",
        }

        with tempfile.TemporaryDirectory() as tempdir:
            preferred_model_path = Path(tempdir) / "preferred_model.pth"
            preferred_model_path.write_bytes(b"preferred-model")
            preferred = {
                "version_id": "model_preferred_local",
                "version_name": "preferred-local",
                "architecture": "efficientnet_v2_s_mil",
                "stage": "global",
                "created_at": "2026-04-08T00:00:00+00:00",
                "ready": True,
                "is_current": True,
                "model_path": str(preferred_model_path),
            }

            store = _FakeStore(placeholder, _FakeRegistry([placeholder]))
            facade = module.ControlPlaneModelFacade(store)

            with patch.object(module, "DATABASE_TOPOLOGY", {"control_plane_connection_mode": "remote_api_cache"}):
                with patch.object(module, "ensure_bundled_current_model", return_value=None):
                    with patch.object(module, "reference_matches_bundled_seed", side_effect=lambda item: None):
                        with patch.object(module, "preferred_operating_model_versions", return_value=[preferred]):
                            with patch.object(module, "ModelArtifactStore", _FakeArtifactStore):
                                current = facade.current_global_model()

            self.assertIsNotNone(current)
            assert current is not None
            self.assertEqual(current["version_id"], "model_preferred_local")
            self.assertEqual(store.registry.current_global_model()["version_id"], "model_preferred_local")


if __name__ == "__main__":
    unittest.main()
