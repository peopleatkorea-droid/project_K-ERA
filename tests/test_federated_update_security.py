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
    assert_federated_privacy_runtime_ready,
    build_federated_dp_accounting_entry,
    federated_delta_privacy_controls,
    federated_privacy_runtime_report,
    summarize_federated_data_distribution,
    summarize_federated_dp_accounting,
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

    def test_privacy_runtime_report_requires_acknowledgement_in_production_like_runtime(self):
        with patch.dict(os.environ, {"KERA_ENVIRONMENT": "production"}, clear=False):
            report = federated_privacy_runtime_report()
        self.assertFalse(report["formal_dp_accounting"])
        self.assertTrue(report["production_like_runtime"])
        self.assertTrue(report["warning_required"])

    def test_privacy_runtime_report_honors_acknowledgement_override(self):
        with patch.dict(
            os.environ,
            {
                "KERA_ENVIRONMENT": "production",
                "KERA_ACKNOWLEDGE_NON_DP_FEDERATED_TRAINING": "true",
            },
            clear=False,
        ):
            report = federated_privacy_runtime_report()
            assert_federated_privacy_runtime_ready(operation="Image-level federated learning")
        self.assertTrue(report["non_dp_acknowledged"])
        self.assertFalse(report["warning_required"])

    def test_dp_accounting_entry_is_reported_when_clip_and_noise_are_configured(self):
        with patch.dict(
            os.environ,
            {
                "KERA_FEDERATED_DELTA_CLIP_NORM": "1.5",
                "KERA_FEDERATED_DELTA_NOISE_MULTIPLIER": "0.8",
                "KERA_FEDERATED_DP_ACCOUNTANT_DELTA": "1e-5",
            },
            clear=False,
        ):
            controls = federated_delta_privacy_controls()
            entry = build_federated_dp_accounting_entry(
                controls,
                local_steps=3,
                participant_count=12,
                patient_count=7,
            )
            report = federated_privacy_runtime_report()
        self.assertTrue(entry["formal_dp_accounting"])
        self.assertEqual(entry["accountant"], "gaussian_basic_composition")
        self.assertGreater(float(entry["epsilon"] or 0.0), 0.0)
        self.assertEqual(entry["local_steps"], 3)
        self.assertEqual(entry["participant_count"], 12)
        self.assertEqual(entry["patient_count"], 7)
        self.assertTrue(report["formal_dp_accounting"])
        self.assertEqual(report["dp_accountant_delta"], 1e-5)

    def test_dp_accounting_summary_accumulates_per_site(self):
        summary = summarize_federated_dp_accounting(
            [
                {
                    "site_id": "SITE-A",
                    "dp_accounting": {
                        "formal_dp_accounting": True,
                        "epsilon": 0.4,
                        "delta": 1e-5,
                    },
                },
                {
                    "site_id": "SITE-A",
                    "dp_accounting": {
                        "formal_dp_accounting": True,
                        "epsilon": 0.6,
                        "delta": 2e-5,
                    },
                },
                {
                    "site_id": "SITE-B",
                    "dp_accounting": {
                        "formal_dp_accounting": True,
                        "epsilon": 0.3,
                        "delta": 1e-6,
                    },
                },
            ]
        )
        self.assertTrue(summary["formal_dp_accounting"])
        self.assertEqual(summary["accounted_updates"], 3)
        self.assertAlmostEqual(float(summary["epsilon"] or 0.0), 1.3)
        self.assertAlmostEqual(float(summary["delta"] or 0.0), 3.1e-5)
        self.assertEqual(len(summary["sites"]), 2)
        self.assertEqual(summary["sites"][0]["site_id"], "SITE-A")
        self.assertAlmostEqual(float(summary["sites"][0]["epsilon"] or 0.0), 1.0)

    def test_privacy_runtime_report_rejects_when_formal_dp_is_required(self):
        with patch.dict(os.environ, {"KERA_REQUIRE_FORMAL_DP_ACCOUNTING": "true"}, clear=False):
            with self.assertRaises(ValueError):
                assert_federated_privacy_runtime_ready(operation="Federated aggregation")


if __name__ == "__main__":
    unittest.main()
