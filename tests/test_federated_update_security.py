from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT_DIR = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from kera_research.services.federated_update_security import (
    apply_federated_update_signature,
    federated_delta_privacy_controls,
    summarize_federated_data_distribution,
    verify_federated_update_signature,
)


class FederatedUpdateSecurityTests(unittest.TestCase):
    def test_signed_update_detects_tampering(self):
        record = {
            "update_id": "update-test",
            "site_id": "SITE-A",
            "base_model_version_id": "model-base",
            "architecture": "convnext_tiny",
            "upload_type": "weight delta",
            "federated_round_type": "image_level_site_round",
            "central_artifact_sha256": "abc123",
            "preprocess_signature": "prep-signature",
            "aggregation_weight": 7,
            "aggregation_weight_unit": "images",
        }
        with patch.dict(os.environ, {"KERA_FEDERATED_UPDATE_SIGNING_SECRET": "secret-key"}, clear=False):
            signed = apply_federated_update_signature(record)
            verify_federated_update_signature(signed)
            tampered = dict(signed)
            tampered["aggregation_weight"] = 11
            with self.assertRaises(ValueError):
                verify_federated_update_signature(tampered)

    def test_require_signed_updates_rejects_unsigned_delta(self):
        record = {
            "update_id": "update-test",
            "site_id": "SITE-A",
            "base_model_version_id": "model-base",
            "architecture": "convnext_tiny",
            "upload_type": "weight delta",
        }
        with patch.dict(os.environ, {"KERA_REQUIRE_SIGNED_FEDERATED_UPDATES": "true"}, clear=False):
            with self.assertRaises(ValueError):
                verify_federated_update_signature(record)

    def test_privacy_controls_ignore_invalid_quantization_bits(self):
        with patch.dict(
            os.environ,
            {
                "KERA_FEDERATED_DELTA_CLIP_NORM": "2.5",
                "KERA_FEDERATED_DELTA_NOISE_MULTIPLIER": "0.2",
                "KERA_FEDERATED_DELTA_QUANTIZATION_BITS": "12",
            },
            clear=False,
        ):
            controls = federated_delta_privacy_controls()
        self.assertEqual(controls["delta_clip_l2_norm"], 2.5)
        self.assertEqual(controls["delta_noise_multiplier"], 0.2)
        self.assertNotIn("delta_quantization_bits", controls)

    def test_data_distribution_summary_counts_labels_and_patients(self):
        summary = summarize_federated_data_distribution(
            [
                {
                    "patient_id": "P-001",
                    "culture_category": "bacterial",
                    "culture_species": "Pseudomonas aeruginosa",
                },
                {
                    "patient_id": "P-001",
                    "culture_category": "bacterial",
                    "culture_species": "Pseudomonas aeruginosa",
                },
                {
                    "patient_id": "P-002",
                    "culture_category": "fungal",
                    "culture_species": "Fusarium",
                },
            ]
        )
        self.assertEqual(summary["n_records"], 3)
        self.assertEqual(summary["n_patients"], 2)
        self.assertEqual(summary["label_histogram"]["bacterial"], 2)
        self.assertEqual(summary["culture_category_histogram"]["fungal"], 1)
        self.assertEqual(summary["top_species"][0]["label"], "Pseudomonas aeruginosa")


if __name__ == "__main__":
    unittest.main()
