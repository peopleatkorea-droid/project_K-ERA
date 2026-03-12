from __future__ import annotations

import importlib
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))


def _reload_modules():
    for module_name in list(sys.modules):
        if module_name.startswith("kera_research.config") or module_name.startswith("kera_research.services.runtime"):
            del sys.modules[module_name]
    config = importlib.import_module("kera_research.config")
    runtime = importlib.import_module("kera_research.services.runtime")
    return config, runtime


class SegmentationBackendConfigTests(unittest.TestCase):
    def setUp(self) -> None:
        self.original_env = os.environ.copy()

    def tearDown(self) -> None:
        os.environ.clear()
        os.environ.update(self.original_env)
        for module_name in list(sys.modules):
            if module_name.startswith("kera_research.config") or module_name.startswith("kera_research.services.runtime"):
                del sys.modules[module_name]

    def test_default_backend_uses_medsam(self) -> None:
        os.environ.pop("KERA_SEGMENTATION_BACKEND", None)
        os.environ.pop("SEGMENTATION_BACKEND", None)

        config, runtime = _reload_modules()

        self.assertEqual(config.SEGMENTATION_BACKEND, "medsam")
        self.assertTrue(config.SEGMENTATION_SCRIPT.endswith("medsam_auto_roi.py"))
        status = runtime.detect_local_node_status()
        self.assertEqual(status["segmentation_backend"], "medsam")
        self.assertIn("segmentation_ready", status)

    def test_swin_backend_uses_wrapper_and_explicit_checkpoint(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            checkpoint_path = temp_path / "Swin_LiteMedSAM.pth"
            checkpoint_path.write_bytes(b"checkpoint")

            os.environ["KERA_SEGMENTATION_BACKEND"] = "swin_litemedsam"
            os.environ["KERA_SEGMENTATION_ROOT"] = temp_dir
            os.environ["KERA_SEGMENTATION_CHECKPOINT"] = str(checkpoint_path)

            config, runtime = _reload_modules()

            self.assertEqual(config.SEGMENTATION_BACKEND, "swin_litemedsam")
            self.assertTrue(config.SEGMENTATION_SCRIPT.endswith("swin_litemedsam_auto_roi.py"))
            self.assertEqual(Path(config.SEGMENTATION_CHECKPOINT), checkpoint_path)
            status = runtime.detect_local_node_status()
            self.assertEqual(status["segmentation_backend"], "swin_litemedsam")
            self.assertTrue(status["segmentation_ready"])


if __name__ == "__main__":
    unittest.main()
