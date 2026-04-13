from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from kera_research.services import data_plane_normalizers as normalizers


_CULTURE_STATUS_OPTIONS = {"positive", "negative", "not_done", "unknown"}


class DataPlaneNormalizersTests(unittest.TestCase):
    def test_positive_culture_normalizes_and_deduplicates_additional_organisms(self) -> None:
        normalized = normalizers._normalize_visit_culture_fields(
            culture_status="positive",
            culture_confirmed=True,
            culture_category="Bacterial",
            culture_species="P. aeruginosa",
            additional_organisms=[
                {"culture_category": "bacterial", "culture_species": "P. aeruginosa"},
                {"culture_category": "fungal", "culture_species": "Candida albicans"},
                {"culture_category": "fungal", "culture_species": "Candida albicans"},
            ],
            polymicrobial=False,
            culture_status_options=_CULTURE_STATUS_OPTIONS,
        )

        self.assertEqual(normalized["culture_status"], "positive")
        self.assertTrue(normalized["culture_confirmed"])
        self.assertEqual(normalized["culture_category"], "bacterial")
        self.assertEqual(normalized["culture_species"], "P. aeruginosa")
        self.assertTrue(normalized["polymicrobial"])
        self.assertEqual(
            normalized["additional_organisms"],
            [{"culture_category": "fungal", "culture_species": "Candida albicans"}],
        )

    def test_non_positive_culture_clears_primary_and_additional_organisms(self) -> None:
        normalized = normalizers._normalize_visit_culture_fields(
            culture_status="negative",
            culture_confirmed=False,
            culture_category="bacterial",
            culture_species="P. aeruginosa",
            additional_organisms=[
                {"culture_category": "fungal", "culture_species": "Candida albicans"},
            ],
            polymicrobial=True,
            culture_status_options=_CULTURE_STATUS_OPTIONS,
        )

        self.assertEqual(normalized["culture_status"], "negative")
        self.assertFalse(normalized["culture_confirmed"])
        self.assertEqual(normalized["culture_category"], "")
        self.assertEqual(normalized["culture_species"], "")
        self.assertEqual(normalized["additional_organisms"], [])
        self.assertFalse(normalized["polymicrobial"])

    def test_parse_manifest_box_accepts_valid_and_rejects_invalid_boxes(self) -> None:
        self.assertEqual(
            normalizers._parse_manifest_box("{'x0': 1, 'y0': 2, 'x1': 8, 'y1': 10}"),
            {"x0": 1.0, "y0": 2.0, "x1": 8.0, "y1": 10.0},
        )
        self.assertIsNone(normalizers._parse_manifest_box("{'x0': 8, 'y0': 2, 'x1': 1, 'y1': 10}"))
        self.assertIsNone(normalizers._parse_manifest_box("not-a-box"))

    def test_coerce_optional_bool_handles_common_string_values(self) -> None:
        self.assertTrue(normalizers._coerce_optional_bool("yes"))
        self.assertFalse(normalizers._coerce_optional_bool("no", default=True))
        self.assertTrue(normalizers._coerce_optional_bool(None, default=True))


if __name__ == "__main__":
    unittest.main()
