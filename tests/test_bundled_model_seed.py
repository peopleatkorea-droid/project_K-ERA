from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))


def reload_bundled_model_seed_module(resource_dir: Path):
    os.environ["KERA_DESKTOP_RESOURCE_DIR"] = str(resource_dir)
    for module_name in list(sys.modules):
        if module_name.startswith("kera_research"):
            del sys.modules[module_name]
    import kera_research.services.bundled_model_seed as bundled_model_seed_module

    return bundled_model_seed_module


class BundledModelSeedTests(unittest.TestCase):
    def test_loads_bundled_model_reference_and_merges_matching_release(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            resource_dir = Path(tempdir) / "resources"
            seed_dir = resource_dir / "seed-model"
            seed_dir.mkdir(parents=True, exist_ok=True)
            model_path = seed_dir / "seed_model.pt"
            model_path.write_bytes(b"seed-model")
            (seed_dir / "model-reference.json").write_text(
                json.dumps(
                    {
                        "version_id": "model_seed_v1",
                        "version_name": "seed-v1",
                        "architecture": "densenet121",
                        "filename": model_path.name,
                    }
                ),
                encoding="utf-8",
            )

            module = reload_bundled_model_seed_module(resource_dir)
            reference = module.bundled_model_reference()
            self.assertIsNotNone(reference)
            assert reference is not None
            self.assertEqual(reference["version_id"], "model_seed_v1")
            self.assertEqual(reference["model_path"], str(model_path.resolve()))
            self.assertEqual(reference["local_path"], str(model_path.resolve()))
            self.assertEqual(reference["source_provider"], "bundled")

            merged = module.reference_matches_bundled_seed(
                {
                    "version_id": "model_seed_v1",
                    "version_name": "remote-seed",
                    "architecture": "densenet121",
                    "download_url": "",
                }
            )
            self.assertIsNotNone(merged)
            assert merged is not None
            self.assertEqual(merged["model_path"], str(model_path.resolve()))
            self.assertEqual(merged["source_provider"], "bundled")

    def test_loads_bundled_model_suite_and_promotes_over_baseline_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            resource_dir = Path(tempdir) / "resources"
            seed_dir = resource_dir / "seed-model"
            seed_dir.mkdir(parents=True, exist_ok=True)
            effnet_path = seed_dir / "efficientnet_ship.pt"
            convnext_path = seed_dir / "convnext_ship.pt"
            effnet_path.write_bytes(b"efficientnet")
            convnext_path.write_bytes(b"convnext")
            (seed_dir / "model-suite-reference.json").write_text(
                json.dumps(
                    {
                        "version": 1,
                        "models": [
                            {
                                "version_id": "model_global_efficientnet_v2_s_mil_full_p101_fold01",
                                "version_name": "global-efficientnet-v2-s-mil-full-p101-fold01",
                                "architecture": "efficientnet_v2_s_mil",
                                "filename": effnet_path.name,
                                "is_current": True,
                            },
                            {
                                "version_id": "model_global_convnext_tiny_full_p101_fold01",
                                "version_name": "global-convnext-tiny-full-p101-fold01",
                                "architecture": "convnext_tiny",
                                "filename": convnext_path.name,
                                "is_current": False,
                            },
                        ],
                    }
                ),
                encoding="utf-8",
            )

            module = reload_bundled_model_seed_module(resource_dir)
            suite = module.bundled_model_suite()
            self.assertEqual(len(suite), 2)
            self.assertEqual(suite[0]["model_path"], str(effnet_path.resolve()))

            class FakeRegistry:
                def __init__(self) -> None:
                    self.current = {
                        "version_id": "model_global_densenet_v1",
                        "version_name": "global-densenet121-baseline-v1.0",
                        "architecture": "densenet121",
                        "is_current": True,
                    }
                    self.ensured: list[dict[str, object]] = []

                def current_global_model(self) -> dict[str, object]:
                    return dict(self.current)

                def ensure_model_version(self, model_metadata: dict[str, object]) -> dict[str, object]:
                    self.ensured.append(dict(model_metadata))
                    if model_metadata.get("is_current"):
                        self.current = dict(model_metadata)
                    return dict(model_metadata)

            class FakeStore:
                def __init__(self) -> None:
                    self.registry = FakeRegistry()

            store = FakeStore()
            current = module.ensure_bundled_current_model(store)
            self.assertIsNotNone(current)
            assert current is not None
            self.assertEqual(current["version_id"], "model_global_efficientnet_v2_s_mil_full_p101_fold01")
            self.assertEqual(len(store.registry.ensured), 2)
            self.assertEqual(
                [item["version_id"] for item in store.registry.ensured],
                [
                    "model_global_efficientnet_v2_s_mil_full_p101_fold01",
                    "model_global_convnext_tiny_full_p101_fold01",
                ],
            )


if __name__ == "__main__":
    unittest.main()
