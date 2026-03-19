from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from kera_research.cli import build_parser
from kera_research.services.modeling import ModelManager, torch


@unittest.skipIf(torch is None, "PyTorch is required for modeling tests.")
class ModelManagerTests(unittest.TestCase):
    def test_cli_parser_exposes_research_commands(self):
        parser = build_parser()
        help_text = parser.format_help()
        self.assertIn("train", help_text)
        self.assertIn("cross-validate", help_text)
        self.assertIn("external-validate", help_text)
        self.assertIn("export-report", help_text)

    def test_load_model_rejects_checkpoint_architecture_mismatch(self):
        manager = ModelManager()
        with tempfile.TemporaryDirectory() as tempdir:
            checkpoint_path = Path(tempdir) / "mismatch.pt"
            model = manager.build_model("convnext_tiny")
            torch.save(
                {
                    "architecture": "vit",
                    "state_dict": model.state_dict(),
                    "artifact_metadata": manager.build_artifact_metadata(architecture="vit"),
                },
                checkpoint_path,
            )
            with self.assertRaisesRegex(ValueError, "Checkpoint architecture mismatch"):
                manager.load_model(
                    {
                        "architecture": "convnext_tiny",
                        "model_path": str(checkpoint_path),
                        "preprocess_signature": manager.preprocess_signature(),
                        "num_classes": 2,
                    },
                    "cpu",
                )

    def test_classification_metrics_include_calibration_fields(self):
        manager = ModelManager()
        metrics = manager.classification_metrics(
            true_labels=[0, 1, 1, 0],
            predicted_labels=[0, 1, 1, 0],
            positive_probabilities=[0.1, 0.8, 0.7, 0.2],
            threshold=0.5,
        )
        self.assertIn("brier_score", metrics)
        self.assertIn("ece", metrics)
        self.assertIn("calibration", metrics)
        self.assertIsInstance(metrics["calibration"]["bins"], list)

    def test_normalize_case_aggregation_respects_attention_mil_architecture(self):
        manager = ModelManager()
        self.assertEqual(manager.normalize_case_aggregation("attention_mil", "dinov2_mil"), "attention_mil")
        self.assertEqual(manager.normalize_case_aggregation("attention_mil", "convnext_tiny"), "mean")
        self.assertEqual(manager.normalize_case_aggregation("quality_weighted_mean", "convnext_tiny"), "quality_weighted_mean")

    def test_build_model_supports_supported_backbones(self):
        manager = ModelManager()
        vit_model = manager.build_model("vit")
        swin_model = manager.build_model("swin")
        efficientnet_model = manager.build_model("efficientnet_v2_s")
        dinov2_model = manager.build_model("dinov2")
        dinov2_mil_model = manager.build_model("dinov2_mil")

        self.assertTrue(hasattr(vit_model, "heads"))
        self.assertTrue(hasattr(swin_model, "head"))
        self.assertTrue(hasattr(efficientnet_model, "classifier"))
        self.assertTrue(hasattr(dinov2_model, "classifier"))
        self.assertTrue(hasattr(dinov2_mil_model, "attention_pool"))

    def test_dual_input_concat_is_marked_as_gradcam_capable(self):
        manager = ModelManager()
        self.assertTrue(manager.is_dual_input_architecture("dual_input_concat"))
        self.assertTrue(manager.supports_gradcam("dual_input_concat"))


if __name__ == "__main__":
    unittest.main()
