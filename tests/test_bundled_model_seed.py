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


if __name__ == "__main__":
    unittest.main()
