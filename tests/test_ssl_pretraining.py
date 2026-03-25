from __future__ import annotations

import csv
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = REPO_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from kera_research.services.ssl_pretraining import SSLTrainingConfig, run_ssl_pretraining


class SSLPretrainingSmokeTests(unittest.TestCase):
    def test_run_ssl_pretraining_writes_checkpoint_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            image_dir = temp_root / "images"
            image_dir.mkdir(parents=True, exist_ok=True)
            manifest_path = temp_root / "ssl_manifest_clean.csv"
            output_dir = temp_root / "ssl_run"

            fieldnames = [
                "image_id",
                "image_path",
                "relative_path",
                "file_name",
                "file_stem",
                "extension",
                "file_size_bytes",
                "capture_year",
                "visit_date",
                "capture_timestamp",
                "patient_folder_raw",
                "patient_folder_parent_raw",
                "patient_key_normalized",
                "patient_key_sha1",
                "patient_quality",
                "path_depth",
                "structure_type",
                "needs_review",
                "review_reason",
            ]

            rows = []
            for index in range(8):
                image_path = image_dir / f"sample_{index:02d}.jpg"
                Image.new("RGB", (96, 96), color=(index * 10, 64, 128)).save(image_path)
                rows.append(
                    {
                        "image_id": f"img_{index:02d}",
                        "image_path": str(image_path),
                        "relative_path": f"2011년/2011-06-14/00351316/sample_{index:02d}.jpg",
                        "file_name": image_path.name,
                        "file_stem": image_path.stem,
                        "extension": ".jpg",
                        "file_size_bytes": image_path.stat().st_size,
                        "capture_year": "2011",
                        "visit_date": "2011-06-14",
                        "capture_timestamp": "",
                        "patient_folder_raw": "00351316",
                        "patient_folder_parent_raw": "",
                        "patient_key_normalized": "00351316",
                        "patient_key_sha1": "abc123",
                        "patient_quality": "high",
                        "path_depth": 4,
                        "structure_type": "year_date_patient_image",
                        "needs_review": "False",
                        "review_reason": "",
                    }
                )

            with manifest_path.open("w", newline="", encoding="utf-8-sig") as handle:
                writer = csv.DictWriter(handle, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerows(rows)

            summary = run_ssl_pretraining(
                SSLTrainingConfig(
                    manifest_path=str(manifest_path),
                    output_dir=str(output_dir),
                    architecture="efficientnet_v2_s",
                    init_mode="random",
                    image_size=64,
                    batch_size=2,
                    epochs=1,
                    learning_rate=1e-4,
                    weight_decay=1e-4,
                    num_workers=0,
                    device="cpu",
                    use_amp=False,
                    max_steps_per_epoch=2,
                    save_every=1,
                )
            )

            self.assertEqual(summary["status"], "completed")
            self.assertTrue((output_dir / "byol_training_state.pt").exists())
            self.assertTrue((output_dir / "ssl_encoder_latest.pth").exists())
            self.assertTrue((output_dir / "training_summary.json").exists())


if __name__ == "__main__":
    unittest.main()
