from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = REPO_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from kera_research.services.ssl_archive import classify_archive_image, normalize_patient_key, scan_ssl_archive


class SSLArchiveTests(unittest.TestCase):
    def test_normalize_patient_key_removes_separator_noise(self) -> None:
        self.assertEqual(normalize_patient_key("003-7488"), "0037488")
        self.assertEqual(normalize_patient_key(" 김명수 "), "김명수")

    def test_classify_archive_image_marks_depth_four_as_clean(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir)
            image_path = base_dir / "2011년" / "2011-06-14" / "00351316" / "A20110614120000_01.JPG"
            image_path.parent.mkdir(parents=True, exist_ok=True)
            image_path.write_bytes(b"fake")

            is_clean, row = classify_archive_image(base_dir, image_path)
            self.assertTrue(is_clean)
            self.assertEqual(row["structure_type"], "year_date_patient_image")
            self.assertEqual(row["capture_year"], "2011")
            self.assertEqual(row["visit_date"], "2011-06-14")
            self.assertEqual(row["patient_folder_raw"], "00351316")
            self.assertFalse(row["needs_review"])

    def test_scan_ssl_archive_splits_clean_and_anomaly_rows(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir)
            clean_image = base_dir / "2011년" / "2011-06-14" / "00351316" / "A20110614120000_01.JPG"
            anomaly_image = base_dir / "2011년" / "2011-06-14" / "A20110614120000_02.JPG"
            clean_image.parent.mkdir(parents=True, exist_ok=True)
            anomaly_image.parent.mkdir(parents=True, exist_ok=True)
            clean_image.write_bytes(b"clean")
            anomaly_image.write_bytes(b"anomaly")

            clean_rows, anomaly_rows, summary = scan_ssl_archive(base_dir)
            self.assertEqual(len(clean_rows), 1)
            self.assertEqual(len(anomaly_rows), 1)
            self.assertEqual(summary["clean_images"], 1)
            self.assertEqual(summary["anomaly_images"], 1)
            self.assertEqual(anomaly_rows[0]["anomaly_reason"], "missing_patient_folder")


if __name__ == "__main__":
    unittest.main()
