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
from kera_research.domain import MODEL_OUTPUT_CLASS_COUNT
from kera_research.services.modeling import (
    DEFAULT_NUM_CLASSES,
    INDEX_TO_LABEL,
    ModelManager,
    VisitBagDataset,
    collate_visit_bags,
    preprocess_image,
    torch,
)


@unittest.skipIf(torch is None, "PyTorch is required for modeling tests.")
class ModelManagerTests(unittest.TestCase):
    def test_modeling_exports_runtime_constants_and_image_class(self):
        import kera_research.services.modeling as modeling

        self.assertEqual(INDEX_TO_LABEL[0], "bacterial")
        self.assertEqual(INDEX_TO_LABEL[1], "fungal")
        self.assertIs(modeling.Image, Image)

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
                self.classifier = torch.nn.Linear(16, MODEL_OUTPUT_CLASS_COUNT)

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

    def test_select_decision_threshold_prefers_balanced_candidate(self):
        manager = ModelManager()
        result = manager.select_decision_threshold(
            true_labels=[0, 0, 1, 1],
            positive_probabilities=[0.1, 0.4, 0.6, 0.9],
        )
        self.assertIn("decision_threshold", result)
        self.assertEqual(result["selection_metric"], "balanced_accuracy")
        self.assertGreaterEqual(float(result["decision_threshold"]), 0.4)
        self.assertLessEqual(float(result["decision_threshold"]), 0.6)
        self.assertIn("selection_metrics", result)

    def test_split_ids_with_fallback_partitions_patients_when_stratified_split_fails(self):
        manager = ModelManager()
        patient_ids = ["P-001", "P-002", "P-003", "P-004"]
        patient_labels = {
            "P-001": "bacterial",
            "P-002": "fungal",
            "P-003": "bacterial",
            "P-004": "bacterial",
        }

        with patch("kera_research.services.modeling_evaluation.train_test_split", side_effect=ValueError("boom")):
            left_ids, right_ids = manager._split_ids_with_fallback(
                patient_ids,
                patient_labels,
                test_size=1,
                seed=7,
            )

        self.assertEqual(len(left_ids), 3)
        self.assertEqual(len(right_ids), 1)
        self.assertEqual(sorted(left_ids + right_ids), sorted(patient_ids))
        self.assertFalse(set(left_ids) & set(right_ids))

    def test_normalize_training_pretraining_source_maps_alias_and_defaults(self):
        manager = ModelManager()
        self.assertEqual(manager.normalize_training_pretraining_source(None, use_pretrained=True), "imagenet")
        self.assertEqual(manager.normalize_training_pretraining_source(None, use_pretrained=False), "scratch")
        self.assertEqual(manager.normalize_training_pretraining_source("pretrained"), "imagenet")
        with self.assertRaisesRegex(ValueError, "Unsupported pretraining source"):
            manager.normalize_training_pretraining_source("unknown-source")

    def test_resolve_preprocess_metadata_supports_legacy_signature(self):
        manager = ModelManager()
        resolved = manager.resolve_preprocess_metadata(
            checkpoint_metadata={
                "preprocess_signature": manager.legacy_preprocess_signature(),
            }
        )

        self.assertEqual(
            resolved,
            manager.legacy_preprocess_metadata(),
        )

    def test_validate_model_artifact_rejects_preprocess_signature_mismatch(self):
        manager = ModelManager()
        checkpoint = {
            "architecture": "convnext_tiny",
            "artifact_metadata": manager.build_artifact_metadata(
                architecture="convnext_tiny",
                num_classes=2,
                preprocess_metadata=manager.legacy_preprocess_metadata(),
            ),
        }

        with self.assertRaisesRegex(ValueError, "Checkpoint preprocess signature mismatch"):
            manager.validate_model_artifact(
                {
                    "architecture": "convnext_tiny",
                    "num_classes": 2,
                    "preprocess_signature": manager.preprocess_signature(),
                },
                checkpoint,
            )

    def test_default_num_classes_counts_only_trainable_labels(self):
        manager = ModelManager()
        checkpoint = {
            "architecture": "convnext_tiny",
            "artifact_metadata": manager.build_artifact_metadata(
                architecture="convnext_tiny",
                num_classes=2,
            ),
        }

        self.assertEqual(DEFAULT_NUM_CLASSES, 2)
        self.assertEqual(
            manager.validate_model_artifact(
                {
                    "architecture": "convnext_tiny",
                },
                checkpoint,
            )["num_classes"],
            2,
        )

    def test_build_model_for_training_uses_imagenet_builder_when_supported(self):
        manager = ModelManager()
        sentinel_model = object()
        with (
            patch.object(manager, "build_model_pretrained", return_value=sentinel_model) as build_pretrained,
            patch.object(manager, "build_model") as build_model,
        ):
            model, resolved_source, ssl_metadata = manager.build_model_for_training(
                "convnext_tiny",
                pretraining_source="imagenet",
                num_classes=3,
            )

        self.assertIs(model, sentinel_model)
        self.assertEqual(resolved_source, "imagenet")
        self.assertIsNone(ssl_metadata)
        build_pretrained.assert_called_once_with("convnext_tiny", num_classes=3)
        build_model.assert_not_called()

    def test_build_cross_validation_splits_assign_each_patient_once_to_test_fold(self):
        manager = ModelManager()
        patient_ids = [f"P-00{index}" for index in range(1, 7)]
        patient_labels = {
            patient_id: ("bacterial" if index % 2 else "fungal")
            for index, patient_id in enumerate(patient_ids, start=1)
        }

        folds = manager._build_cross_validation_splits(
            patient_ids=patient_ids,
            patient_labels=patient_labels,
            num_folds=3,
            val_split=0.25,
            seed=7,
        )

        self.assertEqual(len(folds), 3)
        all_test_ids = [patient_id for fold in folds for patient_id in fold["test_patient_ids"]]
        self.assertCountEqual(all_test_ids, patient_ids)
        for fold in folds:
            self.assertTrue(set(fold["train_patient_ids"]).isdisjoint(fold["test_patient_ids"]))
            self.assertTrue(set(fold["val_patient_ids"]).isdisjoint(fold["test_patient_ids"]))
            self.assertGreaterEqual(len(fold["train_patient_ids"]), 1)
            self.assertGreaterEqual(len(fold["val_patient_ids"]), 1)

    def test_cross_validate_aggregates_fold_metrics_from_initial_train_results(self):
        manager = ModelManager()
        records = [
            {
                "patient_id": f"P-00{index}",
                "culture_category": "bacterial" if index % 2 else "fungal",
            }
            for index in range(1, 7)
        ]

        with tempfile.TemporaryDirectory() as tempdir:
            output_root = Path(tempdir)

            def fake_initial_train(**kwargs):
                fold = kwargs["saved_split"]
                fold_index = int(fold["fold_index"])
                metric_base = 0.60 + (0.05 * fold_index)
                model_path = output_root / f"fold-{fold_index}.pth"
                model_path.write_text("stub", encoding="utf-8")
                return {
                    "output_model_path": str(model_path),
                    "n_train_patients": len(fold["train_patient_ids"]),
                    "n_val_patients": len(fold["val_patient_ids"]),
                    "n_test_patients": len(fold["test_patient_ids"]),
                    "n_train": 10 + fold_index,
                    "n_val": 4,
                    "n_test": 3,
                    "best_val_acc": round(metric_base, 4),
                    "val_metrics": {
                        "AUROC": round(metric_base + 0.1, 4),
                        "accuracy": round(metric_base, 4),
                    },
                    "test_metrics": {
                        "AUROC": round(metric_base + 0.05, 4),
                        "accuracy": round(metric_base, 4),
                        "sensitivity": round(metric_base - 0.02, 4),
                        "specificity": round(metric_base + 0.02, 4),
                        "F1": round(metric_base - 0.01, 4),
                        "balanced_accuracy": round(metric_base + 0.01, 4),
                        "brier_score": round(0.2 + (0.01 * fold_index), 4),
                        "ece": round(0.05 + (0.01 * fold_index), 4),
                    },
                    "patient_split": fold,
                }

            with patch.object(manager, "initial_train", side_effect=fake_initial_train) as initial_train:
                result = manager.cross_validate(
                    records=records,
                    architecture="convnext_tiny",
                    output_dir=output_root,
                    device="cpu",
                    num_folds=3,
                    epochs=2,
                    pretraining_source="pretrained",
                )

        self.assertEqual(initial_train.call_count, 3)
        self.assertEqual(result["pretraining_source"], "imagenet")
        self.assertTrue(result["use_pretrained"])
        self.assertEqual(len(result["fold_results"]), 3)
        self.assertAlmostEqual(float(result["aggregate_metrics"]["accuracy"]["mean"]), 0.7, places=4)
        self.assertAlmostEqual(float(result["aggregate_metrics"]["accuracy"]["std"]), 0.0408, places=4)
        self.assertEqual(result["total_patients"], 6)
        self.assertEqual(result["total_records"], 6)

    def test_visit_prediction_rows_aggregate_paths_and_views(self):
        manager = ModelManager()
        rows = manager._visit_prediction_rows_from_records(
            [
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
                        "patient_id": "P-001",
                        "visit_date": "Initial",
                        "culture_category": "bacterial",
                        "source_image_path": "raw/b.jpg",
                        "image_path": "roi/b_crop.png",
                        "view": "slit",
                    },
                ]
            ]
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["sample_kind"], "visit")
        self.assertEqual(rows[0]["sample_key"], "visit::P-001::Initial")
        self.assertEqual(rows[0]["source_image_paths"], ["raw/a.jpg", "raw/b.jpg"])
        self.assertEqual(rows[0]["prepared_image_paths"], ["roi/a_crop.png", "roi/b_crop.png"])
        self.assertEqual(rows[0]["views"], ["white", "slit"])

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

    def test_preprocess_image_applies_imagenet_normalization_metadata(self):
        manager = ModelManager()
        with tempfile.TemporaryDirectory() as tempdir:
            image_path = Path(tempdir) / "white.png"
            Image.new("RGB", (16, 16), (255, 255, 255)).save(image_path)

            _, legacy_tensor = preprocess_image(
                image_path,
                preprocess_metadata=manager.legacy_preprocess_metadata(),
            )
            _, normalized_tensor = preprocess_image(
                image_path,
                preprocess_metadata=manager.preprocess_metadata(),
            )

        self.assertAlmostEqual(float(legacy_tensor.max().item()), 1.0, places=4)
        self.assertGreater(float(normalized_tensor[0, 0, 0, 0].item()), 2.0)

    def test_visit_bag_dataset_and_collate_keep_patient_visit_groups(self):
        manager = ModelManager()
        with tempfile.TemporaryDirectory() as tempdir:
            temp_path = Path(tempdir)
            records = []
            for patient_id, visit_date, image_count, color in (
                ("P-001", "Initial", 2, (255, 0, 0)),
                ("P-002", "FU #1", 1, (0, 255, 0)),
            ):
                for image_index in range(image_count):
                    image_path = temp_path / f"{patient_id}_{visit_date}_{image_index}.png"
                    Image.new("RGB", (24, 24), color).save(image_path)
                    records.append(
                        {
                            "patient_id": patient_id,
                            "visit_date": visit_date,
                            "culture_category": "bacterial" if patient_id == "P-001" else "fungal",
                            "image_path": str(image_path),
                            "source_image_path": str(image_path),
                            "view": "white",
                        }
                    )

            dataset = VisitBagDataset(
                records,
                augment=False,
                preprocess_metadata=manager.legacy_preprocess_metadata(),
            )
            self.assertEqual(len(dataset), 2)

            first_item = dataset[0]
            second_item = dataset[1]
            batch_images, batch_mask, labels = collate_visit_bags([first_item, second_item])

        self.assertEqual(batch_images.shape[0], 2)
        self.assertEqual(batch_images.shape[1], 2)
        self.assertTrue(bool(batch_mask[0, 0]))
        self.assertTrue(bool(batch_mask[0, 1]))
        self.assertTrue(bool(batch_mask[1, 0]))
        self.assertFalse(bool(batch_mask[1, 1]))
        self.assertEqual(labels.shape[0], 2)
        self.assertEqual(first_item["patient_id"], "P-001")
        self.assertEqual(first_item["visit_date"], "Initial")

    def test_weight_delta_round_trip_reconstructs_tuned_checkpoint(self):
        manager = ModelManager()
        with tempfile.TemporaryDirectory() as tempdir:
            temp_path = Path(tempdir)
            base_model = manager.build_model("cnn")
            base_state = {
                key: value.detach().clone()
                for key, value in base_model.state_dict().items()
            }
            tuned_state = {
                key: value.detach().clone() + 0.25
                for key, value in base_state.items()
            }
            preprocess_metadata = manager.preprocess_metadata()
            base_path = temp_path / "base_model.pt"
            tuned_path = temp_path / "tuned_model.pt"
            delta_path = temp_path / "weight_delta.pt"
            reconstructed_path = temp_path / "reconstructed_model.pt"
            torch.save(
                {
                    "architecture": "cnn",
                    "state_dict": base_state,
                    "artifact_metadata": manager.build_artifact_metadata(
                        architecture="cnn",
                        preprocess_metadata=preprocess_metadata,
                    ),
                },
                base_path,
            )
            torch.save(
                {
                    "architecture": "cnn",
                    "state_dict": tuned_state,
                    "artifact_metadata": manager.build_artifact_metadata(
                        architecture="cnn",
                        preprocess_metadata=preprocess_metadata,
                    ),
                },
                tuned_path,
            )

            saved_delta_path = manager.save_weight_delta(
                base_model_path=base_path,
                tuned_model_path=tuned_path,
                output_delta_path=delta_path,
            )
            rebuilt_model_path = manager.aggregate_weight_deltas(
                [saved_delta_path],
                reconstructed_path,
                base_model_path=base_path,
            )

            delta_checkpoint = torch.load(saved_delta_path, map_location="cpu", weights_only=True)
            rebuilt_checkpoint = torch.load(rebuilt_model_path, map_location="cpu", weights_only=True)

        self.assertEqual(delta_checkpoint["artifact_metadata"]["artifact_type"], "weight_delta")
        self.assertEqual(rebuilt_checkpoint["artifact_metadata"]["artifact_type"], "model")
        for key, value in tuned_state.items():
            self.assertTrue(torch.allclose(value, rebuilt_checkpoint["state_dict"][key]))

    def test_weight_delta_quantization_round_trip_reconstructs_with_tolerance(self):
        manager = ModelManager()
        with tempfile.TemporaryDirectory() as tempdir:
            temp_path = Path(tempdir)
            base_model = manager.build_model("cnn")
            base_state = {
                key: value.detach().clone()
                for key, value in base_model.state_dict().items()
            }
            tuned_state = {
                key: value.detach().clone() + 0.125
                for key, value in base_state.items()
            }
            preprocess_metadata = manager.preprocess_metadata()
            base_path = temp_path / "base_model.pt"
            tuned_path = temp_path / "tuned_model.pt"
            delta_path = temp_path / "weight_delta_quantized.pt"
            reconstructed_path = temp_path / "reconstructed_quantized_model.pt"
            torch.save(
                {
                    "architecture": "cnn",
                    "state_dict": base_state,
                    "artifact_metadata": manager.build_artifact_metadata(
                        architecture="cnn",
                        preprocess_metadata=preprocess_metadata,
                    ),
                },
                base_path,
            )
            torch.save(
                {
                    "architecture": "cnn",
                    "state_dict": tuned_state,
                    "artifact_metadata": manager.build_artifact_metadata(
                        architecture="cnn",
                        preprocess_metadata=preprocess_metadata,
                    ),
                },
                tuned_path,
            )

            saved_delta_path = manager.save_weight_delta(
                base_model_path=base_path,
                tuned_model_path=tuned_path,
                output_delta_path=delta_path,
                quantization_bits=8,
            )
            rebuilt_model_path = manager.aggregate_weight_deltas(
                [saved_delta_path],
                reconstructed_path,
                base_model_path=base_path,
            )

            delta_checkpoint = torch.load(saved_delta_path, map_location="cpu", weights_only=True)
            rebuilt_checkpoint = torch.load(rebuilt_model_path, map_location="cpu", weights_only=True)

        self.assertEqual(delta_checkpoint["delta_encoding"], "symmetric_linear")
        self.assertEqual(delta_checkpoint["delta_quantization_bits"], 8)
        for key, value in tuned_state.items():
            self.assertTrue(torch.allclose(value, rebuilt_checkpoint["state_dict"][key], atol=5e-3))

    def test_coordinate_median_aggregation_rejects_single_site_outlier(self):
        manager = ModelManager()
        with tempfile.TemporaryDirectory() as tempdir:
            temp_path = Path(tempdir)
            base_model = manager.build_model("cnn")
            base_state = {
                key: value.detach().clone()
                for key, value in base_model.state_dict().items()
            }
            preprocess_metadata = manager.preprocess_metadata()
            base_path = temp_path / "base_model.pt"
            aggregated_path = temp_path / "coordinate_median_model.pt"
            torch.save(
                {
                    "architecture": "cnn",
                    "state_dict": base_state,
                    "artifact_metadata": manager.build_artifact_metadata(
                        architecture="cnn",
                        preprocess_metadata=preprocess_metadata,
                    ),
                },
                base_path,
            )

            def write_delta(path: Path, delta_value: float) -> str:
                delta_state = {
                    key: torch.full_like(value, float(delta_value))
                    for key, value in base_state.items()
                }
                torch.save(
                    {
                        "architecture": "cnn",
                        "state_dict": delta_state,
                        "artifact_metadata": manager.build_artifact_metadata(
                            architecture="cnn",
                            artifact_type="weight_delta",
                            preprocess_metadata=preprocess_metadata,
                        ),
                    },
                    path,
                )
                return str(path)

            honest_a = write_delta(temp_path / "honest_a.pt", 0.10)
            honest_b = write_delta(temp_path / "honest_b.pt", 0.12)
            malicious = write_delta(temp_path / "malicious.pt", 50.0)
            rebuilt_model_path = manager.aggregate_weight_deltas(
                [honest_a, honest_b, malicious],
                aggregated_path,
                base_model_path=base_path,
                strategy="coordinate_median",
            )
            rebuilt_checkpoint = torch.load(rebuilt_model_path, map_location="cpu", weights_only=True)

        for key, value in rebuilt_checkpoint["state_dict"].items():
            self.assertTrue(torch.allclose(value, base_state[key] + 0.12, atol=1e-5))


if __name__ == "__main__":
    unittest.main()
