from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT_DIR = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from PIL import Image

from kera_research.cli import build_parser
from kera_research.domain import LABEL_TO_INDEX
from kera_research.services.modeling import ModelManager, torch


@unittest.skipIf(torch is None, "PyTorch is required for modeling tests.")
class ModelManagerTests(unittest.TestCase):
    def test_fine_tune_uses_attention_mil_visit_bag_path_for_mil_models(self):
        class TinyAttentionMil(torch.nn.Module):
            def __init__(self) -> None:
                super().__init__()
                self.backbone = torch.nn.Sequential(
                    torch.nn.Flatten(),
                    torch.nn.Linear(3 * 224 * 224, 16),
                    torch.nn.ReLU(),
                )
                self.attention_pool = torch.nn.Linear(16, 1)
                self.classifier = torch.nn.Linear(16, len(LABEL_TO_INDEX))

            def forward(self, inputs, bag_mask=None, return_attention=False):
                batch_size, bag_size = inputs.shape[:2]
                features = self.backbone(inputs.reshape(batch_size * bag_size, -1)).reshape(batch_size, bag_size, -1)
                attention_logits = self.attention_pool(features).squeeze(-1)
                if bag_mask is not None:
                    attention_logits = attention_logits.masked_fill(~bag_mask, -1e9)
                attention = torch.softmax(attention_logits, dim=1)
                pooled = torch.sum(features * attention.unsqueeze(-1), dim=1)
                logits = self.classifier(pooled)
                if return_attention:
                    return logits, attention
                return logits

        manager = ModelManager()
        with tempfile.TemporaryDirectory() as tempdir:
            temp_path = Path(tempdir)
            records = []
            for patient_id, visit_date, label, color in (
                ("P-001", "Initial", "bacterial", (255, 0, 0)),
                ("P-002", "Initial", "fungal", (0, 255, 0)),
            ):
                for image_index in range(2):
                    image_path = temp_path / f"{patient_id}_{image_index}.png"
                    Image.new("RGB", (32, 32), color).save(image_path)
                    records.append(
                        {
                            "patient_id": patient_id,
                            "visit_date": visit_date,
                            "culture_category": label,
                            "image_path": str(image_path),
                            "source_image_path": str(image_path),
                            "view": "white",
                        }
                    )

            output_model_path = temp_path / "visit_mil_finetuned.pth"
            base_model_reference = {
                "architecture": "efficientnet_v2_s_mil",
                "crop_mode": "raw",
                "case_aggregation": "attention_mil",
                "bag_level": True,
                "training_input_policy": "raw_or_model_defined",
                "preprocess_signature": manager.preprocess_signature(),
                "num_classes": 2,
            }

            with patch.object(manager, "load_model", return_value=TinyAttentionMil()):
                result = manager.fine_tune(
                    records=records,
                    base_model_reference=base_model_reference,
                    output_model_path=output_model_path,
                    device="cpu",
                    full_finetune=False,
                    epochs=1,
                    batch_size=2,
                )

            self.assertTrue(output_model_path.exists())
            self.assertTrue(result["bag_level"])
            self.assertEqual(result["case_aggregation"], "attention_mil")
            self.assertEqual(result["n_train_cases"], 2)
            self.assertEqual(result["n_train_images"], 4)
            self.assertEqual(result["batch_size"], 2)

            checkpoint = torch.load(output_model_path, map_location="cpu")
            self.assertEqual(checkpoint["architecture"], "efficientnet_v2_s_mil")
            self.assertTrue(checkpoint["artifact_metadata"]["bag_level"])
            self.assertEqual(checkpoint["artifact_metadata"]["case_aggregation"], "attention_mil")

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

    def test_build_prediction_records_include_sample_identity_and_probability(self):
        manager = ModelManager()
        rows = manager._image_prediction_rows_from_records(
            [
                {
                    "patient_id": "P-001",
                    "visit_date": "Initial",
                    "culture_category": "bacterial",
                    "source_image_path": "raw/a.jpg",
                    "image_path": "roi/a_crop.png",
                    "view": "white",
                },
                {
                    "patient_id": "P-002",
                    "visit_date": "FU #1",
                    "culture_category": "fungal",
                    "source_image_path": "raw/b.jpg",
                    "image_path": "roi/b_crop.png",
                    "view": "fluorescein",
                },
            ]
        )
        predictions = manager._build_prediction_records(rows, [0.2, 0.9], threshold=0.5)

        self.assertEqual(len(predictions), 2)
        self.assertEqual(predictions[0]["sample_kind"], "image")
        self.assertEqual(predictions[0]["sample_key"], "image::P-001::Initial::raw/a.jpg")
        self.assertEqual(predictions[0]["predicted_label"], "bacterial")
        self.assertAlmostEqual(predictions[1]["positive_probability"], 0.9)
        self.assertEqual(predictions[1]["predicted_label"], "fungal")
        self.assertTrue(predictions[1]["is_correct"])

    def test_normalize_case_aggregation_respects_attention_mil_architecture(self):
        manager = ModelManager()
        self.assertEqual(manager.normalize_case_aggregation("attention_mil", "dinov2_mil"), "attention_mil")
        self.assertEqual(manager.normalize_case_aggregation("attention_mil", "convnext_tiny"), "mean")
        self.assertEqual(manager.normalize_case_aggregation("quality_weighted_mean", "convnext_tiny"), "quality_weighted_mean")

    def test_baseline_model_settings_cover_new_dual_input_and_mil_defaults(self):
        manager = ModelManager()

        dinov2_mil = manager.baseline_model_settings(
            {
                "architecture": "dinov2_mil",
                "requires_medsam_crop": True,
            }
        )
        self.assertEqual(dinov2_mil["crop_mode"], "automated")
        self.assertEqual(dinov2_mil["case_aggregation"], "attention_mil")
        self.assertTrue(dinov2_mil["bag_level"])
        self.assertEqual(dinov2_mil["training_input_policy"], "medsam_cornea_crop_only")

        dual_input = manager.baseline_model_settings(
            {
                "architecture": "dual_input_concat",
                "requires_medsam_crop": True,
                "crop_mode": "paired",
            }
        )
        self.assertEqual(dual_input["crop_mode"], "paired")
        self.assertEqual(dual_input["case_aggregation"], "mean")
        self.assertFalse(dual_input["bag_level"])
        self.assertEqual(dual_input["training_input_policy"], "medsam_cornea_plus_lesion_paired_fusion")

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
