from __future__ import annotations

import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from PIL import Image

ROOT_DIR = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from kera_research.services.artifacts import MedSAMService


class _FakeInferenceMode:
    def __enter__(self) -> None:
        return None

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


class _FakeTorchModule:
    @staticmethod
    def inference_mode() -> _FakeInferenceMode:
        return _FakeInferenceMode()


class _CountingPredictor:
    created = 0
    set_image_calls = 0
    predict_calls = 0

    def __init__(self, _model: object) -> None:
        type(self).created += 1
        self._image_shape: tuple[int, int] | None = None

    def set_image(self, image_array: np.ndarray) -> None:
        type(self).set_image_calls += 1
        self._image_shape = image_array.shape[:2]

    def predict(self, *, box: np.ndarray, multimask_output: bool) -> tuple[np.ndarray, np.ndarray, None]:
        type(self).predict_calls += 1
        if self._image_shape is None:
            raise RuntimeError("set_image must be called before predict.")
        height, width = self._image_shape
        x0, y0, x1, y1 = [int(round(float(value))) for value in box]
        x0 = min(max(x0, 0), max(width - 1, 0))
        y0 = min(max(y0, 0), max(height - 1, 0))
        x1 = min(max(x1, x0 + 1), width)
        y1 = min(max(y1, y0 + 1), height)
        mask = np.zeros((1, height, width), dtype=np.uint8)
        mask[0, y0:y1, x0:x1] = 1
        scores = np.array([0.99], dtype=np.float32)
        return mask, scores, None


class MedSAMServiceCacheTests(unittest.TestCase):
    def setUp(self) -> None:
        _CountingPredictor.created = 0
        _CountingPredictor.set_image_calls = 0
        _CountingPredictor.predict_calls = 0
        MedSAMService._image_predictor_cache.clear()
        MedSAMService._model_cache.clear()
        MedSAMService._inference_locks.clear()

    def test_reuses_cached_image_predictor_for_same_image(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            image_path = root / "sample.png"
            checkpoint_path = root / "medsam_vit_b.pth"
            checkpoint_path.write_bytes(b"checkpoint")
            Image.new("RGB", (48, 36), color=(255, 255, 255)).save(image_path)

            service = MedSAMService(
                medsam_checkpoint=str(checkpoint_path),
                backend_root=str(root),
            )
            service._resolve_device = lambda: "cpu"  # type: ignore[method-assign]
            service._load_cached_model = lambda device: (  # type: ignore[method-assign]
                _CountingPredictor,
                object(),
                threading.Lock(),
            )

            with patch.dict(sys.modules, {"torch": _FakeTorchModule()}):
                first_result = service._run_inprocess_medsam(
                    image_path,
                    root / "mask_1.png",
                    root / "crop_1.png",
                    prompt_box=[4.0, 5.0, 20.0, 24.0],
                    expand_ratio=1.0,
                    backend_label="resident_medsam_lesion_box",
                )
                second_result = service._run_inprocess_medsam(
                    image_path,
                    root / "mask_2.png",
                    root / "crop_2.png",
                    prompt_box=[8.0, 8.0, 28.0, 28.0],
                    expand_ratio=1.0,
                    backend_label="resident_medsam_lesion_box",
                )

            self.assertEqual(_CountingPredictor.created, 1)
            self.assertEqual(_CountingPredictor.set_image_calls, 1)
            self.assertEqual(_CountingPredictor.predict_calls, 2)
            self.assertTrue(Path(first_result["medsam_mask_path"]).exists())
            self.assertTrue(Path(second_result["medsam_mask_path"]).exists())
            self.assertTrue(Path(first_result["roi_crop_path"]).exists())
            self.assertTrue(Path(second_result["roi_crop_path"]).exists())


if __name__ == "__main__":
    unittest.main()
