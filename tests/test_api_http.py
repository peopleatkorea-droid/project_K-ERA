from __future__ import annotations

import base64
import gc
import hashlib
import io
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import time
import unittest
import zipfile
from pathlib import Path
from unittest.mock import Mock, patch
from PIL import Image

ROOT_DIR = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))


def reload_app_module(
    db_path: Path | None = None,
    *,
    control_plane_db_path: Path | None = None,
    data_plane_db_path: Path | None = None,
    control_plane_artifact_dir: Path | None = None,
    model_distribution_mode: str | None = None,
):
    for env_name in (
        "KERA_DATABASE_URL",
        "DATABASE_URL",
        "KERA_CONTROL_PLANE_DATABASE_URL",
        "KERA_AUTH_DATABASE_URL",
        "KERA_DATA_PLANE_DATABASE_URL",
        "KERA_LOCAL_DATABASE_URL",
        "KERA_CONTROL_PLANE_ARTIFACT_DIR",
        "KERA_CASE_REFERENCE_SALT",
        "KERA_PATIENT_REFERENCE_SALT",
        "KERA_DISABLE_CASE_EMBEDDING_REFRESH",
        "KERA_MODEL_DISTRIBUTION_MODE",
        "KERA_ONEDRIVE_TENANT_ID",
        "KERA_ONEDRIVE_CLIENT_ID",
        "KERA_ONEDRIVE_CLIENT_SECRET",
        "KERA_ONEDRIVE_DRIVE_ID",
        "KERA_ONEDRIVE_ROOT_PATH",
        "KERA_ONEDRIVE_SHARE_SCOPE",
        "KERA_ONEDRIVE_SHARE_TYPE",
    ):
        os.environ.pop(env_name, None)

    if db_path is not None:
        os.environ["KERA_DATABASE_URL"] = f"sqlite:///{db_path.as_posix()}"
    if control_plane_db_path is not None:
        os.environ["KERA_CONTROL_PLANE_DATABASE_URL"] = f"sqlite:///{control_plane_db_path.as_posix()}"
    if data_plane_db_path is not None:
        os.environ["KERA_DATA_PLANE_DATABASE_URL"] = f"sqlite:///{data_plane_db_path.as_posix()}"
    if control_plane_artifact_dir is not None:
        os.environ["KERA_CONTROL_PLANE_ARTIFACT_DIR"] = str(control_plane_artifact_dir)

    os.environ["KERA_API_SECRET"] = "test-secret-with-32-bytes-minimum!!"
    os.environ["KERA_CASE_REFERENCE_SALT"] = "test-case-reference-salt"
    os.environ["KERA_PATIENT_REFERENCE_SALT"] = "test-patient-reference-salt"
    os.environ["KERA_DISABLE_CASE_EMBEDDING_REFRESH"] = "true"
    if model_distribution_mode is not None:
        os.environ["KERA_MODEL_DISTRIBUTION_MODE"] = model_distribution_mode
    os.environ["KERA_ADMIN_USERNAME"] = "admin"
    os.environ["KERA_ADMIN_PASSWORD"] = "admin123"
    os.environ["KERA_RESEARCHER_USERNAME"] = "researcher"
    os.environ["KERA_RESEARCHER_PASSWORD"] = "research123"
    for module_name in list(sys.modules):
        if module_name.startswith("kera_research"):
            del sys.modules[module_name]
    import kera_research.api.app as app_module

    return app_module


class FakeModelManager:
    def aggregate_weight_deltas(self, delta_paths, output_path, weights=None, base_model_path=None):
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        Path(output_path).write_bytes(b"aggregated")


class FakeWorkflow:
    def __init__(self, app_module, control_plane):
        self.app_module = app_module
        self.control_plane = control_plane
        self.model_manager = FakeModelManager()

    def _lesion_prompt_box_signature(self, lesion_prompt_box):
        return "fakeprompt001"

    def run_case_validation(
        self,
        project_id,
        site_store,
        patient_id,
        visit_date,
        model_version,
        execution_device,
        generate_gradcam=True,
        generate_medsam=True,
    ):
        artifact_dir = site_store.validation_dir / "http_case"
        artifact_dir.mkdir(parents=True, exist_ok=True)
        roi_path = artifact_dir / f"{patient_id}_{visit_date}_roi.png"
        gradcam_path = artifact_dir / f"{patient_id}_{visit_date}_gradcam.png"
        roi_path.write_bytes(b"roi")
        gradcam_path.write_bytes(b"gradcam")
        summary = {
            "validation_id": self.app_module.make_id("validation"),
            "project_id": project_id,
            "site_id": site_store.site_id,
            "model_version": model_version["version_name"],
            "model_version_id": model_version["version_id"],
            "model_architecture": model_version["architecture"],
            "run_date": "2026-03-11T00:00:00+00:00",
            "patient_id": patient_id,
            "visit_date": visit_date,
            "n_images": 1,
            "predicted_label": "bacterial",
            "true_label": "bacterial",
            "is_correct": True,
            "prediction_probability": 0.91,
            "balanced_accuracy": 1.0,
            "brier_score": 0.0081,
            "ece": 0.09,
            "calibration": {"n_bins": 10, "bins": []},
        }
        case_prediction = {
            "validation_id": summary["validation_id"],
            "patient_id": patient_id,
            "visit_date": visit_date,
            "true_label": "bacterial",
            "predicted_label": "bacterial",
            "prediction_probability": 0.91,
            "is_correct": True,
            "roi_crop_path": str(roi_path),
            "gradcam_path": str(gradcam_path),
            "medsam_mask_path": None,
        }
        saved_summary = self.control_plane.save_validation_run(summary, [case_prediction])
        site_store.record_case_validation_history(
            patient_id,
            visit_date,
            {
                "validation_id": saved_summary["validation_id"],
                "run_date": saved_summary.get("run_date"),
                "model_version": saved_summary.get("model_version"),
                "model_version_id": saved_summary.get("model_version_id"),
                "model_architecture": saved_summary.get("model_architecture"),
                "run_scope": "case",
                "predicted_label": case_prediction.get("predicted_label"),
                "true_label": case_prediction.get("true_label"),
                "prediction_probability": case_prediction.get("prediction_probability"),
                "is_correct": case_prediction.get("is_correct"),
            },
        )
        self.control_plane.save_experiment(
            {
                "experiment_id": self.app_module.make_id("exp"),
                "site_id": site_store.site_id,
                "experiment_type": "case_validation",
                "status": "completed",
                "model_version_id": model_version["version_id"],
                "created_at": "2026-03-11T00:00:00+00:00",
                "execution_device": execution_device,
                "metrics": {
                    "accuracy": 1.0,
                    "balanced_accuracy": 1.0,
                },
                "report_path": "",
            }
        )
        return summary, [case_prediction]

    def run_ai_clinic_report(
        self,
        site_store,
        *,
        patient_id,
        visit_date,
        model_version,
        execution_device,
        top_k=3,
        retrieval_backend="hybrid",
    ):
        return {
            "patient_id": patient_id,
            "visit_date": visit_date,
            "model_version_id": model_version["version_id"],
            "model_version_name": model_version["version_name"],
            "retrieval_backend": retrieval_backend,
            "execution_device": execution_device,
            "similar_cases": [],
            "classification_context": {
                "validation_id": None,
                "model_version_id": model_version["version_id"],
            },
            "differential": [],
            "workflow_recommendation": None,
        }

    def contribute_case(self, site_store, patient_id, visit_date, model_version, execution_device, user_id, contribution_group_id=None):
        delta_path = site_store.update_dir / f"{self.app_module.make_id('delta')}.pt"
        delta_path.parent.mkdir(parents=True, exist_ok=True)
        delta_path.write_bytes(b"delta")
        case_reference_id = self.control_plane.case_reference_id(site_store.site_id, patient_id, visit_date)
        update = {
            "update_id": self.app_module.make_id("update"),
            "contribution_group_id": contribution_group_id,
            "site_id": site_store.site_id,
            "base_model_version_id": model_version["version_id"],
            "architecture": model_version["architecture"],
            "upload_type": "weight delta",
            "execution_device": execution_device,
            "artifact_path": str(delta_path),
            "n_cases": 1,
            "contributed_by": user_id,
            "case_reference_id": case_reference_id,
            "created_at": "2026-03-11T00:10:00+00:00",
            "training_input_policy": "medsam_cornea_crop_only",
            "training_summary": {"epochs": 1},
            "approval_report": {
                "site_id": site_store.site_id,
                "case_reference_id": case_reference_id,
                "artifacts": {},
            },
            "status": "pending_upload",
        }
        update = self.control_plane.register_model_update(update)
        contribution = {
            "contribution_id": self.app_module.make_id("contrib"),
            "contribution_group_id": contribution_group_id,
            "user_id": user_id,
            "site_id": site_store.site_id,
            "case_reference_id": case_reference_id,
            "update_id": update["update_id"],
            "created_at": "2026-03-11T00:10:00+00:00",
        }
        self.control_plane.register_contribution(contribution)
        site_store.record_case_contribution_history(
            patient_id,
            visit_date,
            {
                "contribution_id": contribution["contribution_id"],
                "contribution_group_id": contribution.get("contribution_group_id"),
                "created_at": contribution["created_at"],
                "user_id": contribution["user_id"],
                "case_reference_id": contribution.get("case_reference_id"),
                "update_id": update.get("update_id"),
                "update_status": update.get("status"),
                "upload_type": update.get("upload_type"),
                "architecture": update.get("architecture"),
                "execution_device": update.get("execution_device"),
                "base_model_version_id": update.get("base_model_version_id"),
            },
        )
        return update

    def run_initial_training(
        self,
        site_store,
        architecture,
        output_model_path,
        execution_device,
        epochs=30,
        learning_rate=1e-4,
        batch_size=16,
        val_split=0.2,
        test_split=0.2,
        use_pretrained=True,
        use_medsam_crops=True,
        regenerate_split=False,
        progress_callback=None,
    ):
        output_path = Path(output_model_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(b"model")
        model_version = self.control_plane.ensure_model_version(
            {
                "version_id": self.app_module.make_id("model"),
                "version_name": f"global-{architecture}-http",
                "architecture": architecture,
                "stage": "global",
                "model_path": str(output_path),
                "created_at": "2026-03-11T00:20:00+00:00",
                "is_current": True,
                "ready": True,
                "requires_medsam_crop": True,
                "preprocess_signature": "fakepreprocesssig",
                "num_classes": 2,
            }
        )
        result = {
            "training_id": self.app_module.make_id("train"),
            "version_name": model_version["version_name"],
            "output_model_path": str(output_path),
            "n_train": 12,
            "n_val": 4,
            "n_test": 4,
            "n_train_patients": 6,
            "n_val_patients": 2,
            "n_test_patients": 2,
            "best_val_acc": 0.88,
            "use_pretrained": use_pretrained,
            "val_metrics": {"accuracy": 0.86, "balanced_accuracy": 0.86},
            "test_metrics": {"accuracy": 0.84, "balanced_accuracy": 0.84},
            "patient_split": {"split_id": self.app_module.make_id("split")},
            "model_version": model_version,
        }
        result["experiment"] = self.control_plane.save_experiment(
            {
                "experiment_id": self.app_module.make_id("exp"),
                "site_id": site_store.site_id,
                "experiment_type": "initial_training",
                "status": "completed",
                "model_version_id": model_version["version_id"],
                "created_at": "2026-03-11T00:20:00+00:00",
                "execution_device": execution_device,
                "metrics": {
                    "best_val_acc": 0.88,
                    "accuracy": 0.84,
                },
                "report_path": "",
            }
        )
        return result

    def run_cross_validation(
        self,
        site_store,
        architecture,
        output_dir,
        execution_device,
        num_folds=5,
        epochs=10,
        learning_rate=1e-4,
        batch_size=16,
        val_split=0.2,
        use_pretrained=True,
        use_medsam_crops=True,
    ):
        report = {
            "cross_validation_id": self.app_module.make_id("cv"),
            "site_id": site_store.site_id,
            "architecture": architecture,
            "execution_device": execution_device,
            "created_at": "2026-03-11T00:30:00+00:00",
            "num_folds": num_folds,
            "epochs": epochs,
            "learning_rate": learning_rate,
            "batch_size": batch_size,
            "val_split": val_split,
            "use_pretrained": use_pretrained,
            "aggregate_metrics": {
                "accuracy": {"mean": 0.82, "std": 0.03},
                "AUROC": {"mean": 0.9, "std": 0.02},
                "balanced_accuracy": {"mean": 0.81, "std": 0.02},
                "brier_score": {"mean": 0.14, "std": 0.01},
                "ece": {"mean": 0.06, "std": 0.01},
            },
            "fold_results": [
                {
                    "fold_index": 1,
                    "n_train_patients": 6,
                    "n_val_patients": 2,
                    "n_test_patients": 2,
                    "n_train": 12,
                    "n_val": 4,
                    "n_test": 4,
                    "test_metrics": {"accuracy": 0.82},
                }
            ],
        }
        report_path = site_store.validation_dir / f"{report['cross_validation_id']}.json"
        report_path.write_text(json.dumps(report), encoding="utf-8")
        report["report_path"] = str(report_path)
        report["experiment"] = self.control_plane.save_experiment(
            {
                "experiment_id": self.app_module.make_id("exp"),
                "site_id": site_store.site_id,
                "experiment_type": "cross_validation",
                "status": "completed",
                "created_at": "2026-03-11T00:30:00+00:00",
                "execution_device": execution_device,
                "metrics": report["aggregate_metrics"],
                "report_path": str(report_path),
            }
        )
        return report

    def preview_image_lesion(self, site_store, image_id, *, lesion_prompt_box=None):
        image = site_store.get_image(image_id)
        if image is None:
            raise ValueError("Image not found.")
        artifact_name = Path(str(image["image_path"])).stem
        mask_path = site_store.lesion_mask_dir / f"{artifact_name}_mask.png"
        crop_path = site_store.lesion_crop_dir / f"{artifact_name}_crop.png"
        mask_path.parent.mkdir(parents=True, exist_ok=True)
        crop_path.parent.mkdir(parents=True, exist_ok=True)
        mask_path.write_bytes(b"mask")
        crop_path.write_bytes(b"crop")
        return {
            "patient_id": image["patient_id"],
            "visit_date": image["visit_date"],
            "view": image.get("view", "slit"),
            "is_representative": bool(image.get("is_representative")),
            "source_image_path": image["image_path"],
            "lesion_mask_path": str(mask_path),
            "lesion_crop_path": str(crop_path),
            "backend": "fake_medsam",
            "medsam_error": None,
            "lesion_prompt_box": lesion_prompt_box if lesion_prompt_box is not None else image.get("lesion_prompt_box"),
            "prompt_signature": "fakeprompt001",
        }

    def run_external_validation(
        self,
        project_id,
        site_store,
        model_version,
        execution_device,
        generate_gradcam=True,
        generate_medsam=True,
    ):
        cases = site_store.list_case_summaries()
        if not cases:
            raise ValueError("No cases available for validation.")
        artifact_dir = site_store.validation_dir / "http_site"
        artifact_dir.mkdir(parents=True, exist_ok=True)
        case_predictions = []
        for index, case in enumerate(cases[:2]):
            roi_path = artifact_dir / f"{case['patient_id']}_{case['visit_date']}_roi_{index}.png"
            gradcam_path = artifact_dir / f"{case['patient_id']}_{case['visit_date']}_gradcam_{index}.png"
            roi_path.write_bytes(b"roi")
            gradcam_path.write_bytes(b"gradcam")
            is_correct = index == 0
            case_predictions.append(
                {
                    "validation_id": "",
                    "patient_id": case["patient_id"],
                    "visit_date": case["visit_date"],
                    "true_label": case["culture_category"],
                    "predicted_label": case["culture_category"] if is_correct else "fungal",
                    "prediction_probability": 0.91 if is_correct else 0.37,
                    "is_correct": is_correct,
                    "roi_crop_path": str(roi_path),
                    "gradcam_path": str(gradcam_path),
                    "medsam_mask_path": None,
                }
            )
        summary = {
            "validation_id": self.app_module.make_id("validation"),
            "project_id": project_id,
            "site_id": site_store.site_id,
            "model_version": model_version["version_name"],
            "model_version_id": model_version["version_id"],
            "model_architecture": model_version["architecture"],
            "run_date": "2026-03-11T01:00:00+00:00",
            "n_patients": len({item["patient_id"] for item in case_predictions}),
            "n_cases": len(case_predictions),
            "n_images": len(case_predictions),
            "AUROC": 0.81,
            "accuracy": 0.5,
            "sensitivity": 0.5,
            "specificity": 0.5,
            "F1": 0.5,
            "balanced_accuracy": 0.5,
            "brier_score": 0.2669,
            "ece": 0.12,
            "calibration": {"n_bins": 10, "bins": []},
            "site_metrics": [
                {
                    "site_id": site_store.site_id,
                    "n_cases": len(case_predictions),
                    "accuracy": 0.5,
                    "sensitivity": 0.5,
                    "specificity": 0.5,
                    "F1": 0.5,
                    "AUROC": 0.81,
                    "balanced_accuracy": 0.5,
                    "brier_score": 0.2669,
                    "ece": 0.12,
                }
            ],
        }
        for prediction in case_predictions:
            prediction["validation_id"] = summary["validation_id"]
        saved_summary = self.control_plane.save_validation_run(summary, case_predictions)
        saved_summary["experiment"] = self.control_plane.save_experiment(
            {
                "experiment_id": self.app_module.make_id("exp"),
                "site_id": site_store.site_id,
                "experiment_type": "external_validation",
                "status": "completed",
                "model_version_id": model_version["version_id"],
                "created_at": "2026-03-11T01:00:00+00:00",
                "execution_device": execution_device,
                "metrics": {
                    "accuracy": 0.5,
                    "AUROC": 0.81,
                    "balanced_accuracy": 0.5,
                },
                "report_path": "",
            }
        )
        return saved_summary, case_predictions, {"accuracy": 0.5}


class FakeSemanticPromptScorer:
    def score_image(self, image_path, *, view, top_k=3):
        return {
            "model_name": "BiomedCLIP",
            "model_id": "fake/biomedclip",
            "image_path": str(image_path),
            "view": view,
            "dictionary_name": "fluorescein" if str(view).lower() == "fluorescein" else "standard",
            "top_k": top_k,
            "overall_top_matches": [
                {
                    "prompt_id": "fungal_keratitis",
                    "label": "Fungal keratitis",
                    "prompt": "a slit lamp photograph of fungal keratitis",
                    "layer_id": "diagnosis",
                    "layer_label": "Diagnosis",
                    "score": 0.8123,
                },
                {
                    "prompt_id": "feathery_borders",
                    "label": "Feathery borders",
                    "prompt": "a slit lamp photograph of a corneal ulcer with feathery borders",
                    "layer_id": "morphology",
                    "layer_label": "Morphology",
                    "score": 0.7542,
                },
            ],
            "layers": [
                {
                    "layer_id": "diagnosis",
                    "layer_label": "Diagnosis",
                    "matches": [
                        {
                            "prompt_id": "fungal_keratitis",
                            "label": "Fungal keratitis",
                            "prompt": "a slit lamp photograph of fungal keratitis",
                            "layer_id": "diagnosis",
                            "layer_label": "Diagnosis",
                            "score": 0.8123,
                        }
                    ],
                },
                {
                    "layer_id": "morphology",
                    "layer_label": "Morphology",
                    "matches": [
                        {
                            "prompt_id": "feathery_borders",
                            "label": "Feathery borders",
                            "prompt": "a slit lamp photograph of a corneal ulcer with feathery borders",
                            "layer_id": "morphology",
                            "layer_label": "Morphology",
                            "score": 0.7542,
                        }
                    ],
                },
            ],
        }

    def run_external_validation(
        self,
        project_id,
        site_store,
        model_version,
        execution_device,
        generate_gradcam=True,
        generate_medsam=True,
    ):
        cases = site_store.list_case_summaries()
        if not cases:
            raise ValueError("No cases available for validation.")
        artifact_dir = site_store.validation_dir / "http_site"
        artifact_dir.mkdir(parents=True, exist_ok=True)
        case_predictions = []
        for index, case in enumerate(cases[:2]):
            roi_path = artifact_dir / f"{case['patient_id']}_{case['visit_date']}_roi_{index}.png"
            gradcam_path = artifact_dir / f"{case['patient_id']}_{case['visit_date']}_gradcam_{index}.png"
            roi_path.write_bytes(b"roi")
            gradcam_path.write_bytes(b"gradcam")
            is_correct = index == 0
            case_predictions.append(
                {
                    "validation_id": "",
                    "patient_id": case["patient_id"],
                    "visit_date": case["visit_date"],
                    "true_label": case["culture_category"],
                    "predicted_label": case["culture_category"] if is_correct else "fungal",
                    "prediction_probability": 0.91 if is_correct else 0.37,
                    "is_correct": is_correct,
                    "roi_crop_path": str(roi_path),
                    "gradcam_path": str(gradcam_path),
                    "medsam_mask_path": None,
                }
            )
        summary = {
            "validation_id": self.app_module.make_id("validation"),
            "project_id": project_id,
            "site_id": site_store.site_id,
            "model_version": model_version["version_name"],
            "model_version_id": model_version["version_id"],
            "model_architecture": model_version["architecture"],
            "run_date": "2026-03-11T01:00:00+00:00",
            "n_patients": len({item["patient_id"] for item in case_predictions}),
            "n_cases": len(case_predictions),
            "n_images": len(case_predictions),
            "AUROC": 0.81,
            "accuracy": 0.5,
            "sensitivity": 0.5,
            "specificity": 0.5,
            "F1": 0.5,
            "balanced_accuracy": 0.5,
            "brier_score": 0.2669,
            "ece": 0.12,
            "calibration": {"n_bins": 10, "bins": []},
            "site_metrics": [
                {
                    "site_id": site_store.site_id,
                    "n_cases": len(case_predictions),
                    "accuracy": 0.5,
                    "sensitivity": 0.5,
                    "specificity": 0.5,
                    "F1": 0.5,
                    "AUROC": 0.81,
                    "balanced_accuracy": 0.5,
                    "brier_score": 0.2669,
                    "ece": 0.12,
                }
            ],
        }
        for prediction in case_predictions:
            prediction["validation_id"] = summary["validation_id"]
        saved_summary = self.control_plane.save_validation_run(summary, case_predictions)
        saved_summary["experiment"] = self.control_plane.save_experiment(
            {
                "experiment_id": self.app_module.make_id("exp"),
                "site_id": site_store.site_id,
                "experiment_type": "external_validation",
                "status": "completed",
                "model_version_id": model_version["version_id"],
                "created_at": "2026-03-11T01:00:00+00:00",
                "execution_device": execution_device,
                "metrics": {
                    "accuracy": 0.5,
                    "AUROC": 0.81,
                    "balanced_accuracy": 0.5,
                },
                "report_path": "",
            }
        )
        return saved_summary, case_predictions, {"accuracy": 0.5}


class ApiHttpTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.control_plane_artifact_dir = Path(self.tempdir.name) / "control_artifacts"
        self.app_module = reload_app_module(
            Path(self.tempdir.name) / "test.db",
            control_plane_artifact_dir=self.control_plane_artifact_dir,
        )
        self.db_module = sys.modules["kera_research.db"]
        self.cp = self.app_module.ControlPlaneStore()
        project = self.cp.create_project("HTTP Test Project", "test", "user_admin")
        self.site_id = f"HTTP_{self.app_module.make_id('site')[-6:].upper()}"
        self.cp.create_site(project["project_id"], self.site_id, "HTTP Test Site", "HTTP Hospital")
        self.site_store = self.app_module.SiteStore(self.site_id)
        self.seed_model_path = ROOT_DIR / "models" / "http_seed_model.pth"
        self.seed_model_path.parent.mkdir(parents=True, exist_ok=True)
        self.seed_model_path.write_bytes(b"seed")
        self.cp.ensure_model_version(
            {
                "version_id": "model_http_seed",
                "version_name": "global-http-seed",
                "architecture": "densenet121",
                "stage": "global",
                "model_path": str(self.seed_model_path),
                "created_at": "2026-03-11T00:00:00+00:00",
                "ready": True,
                "is_current": True,
                "requires_medsam_crop": True,
            }
        )
        self.researcher = self.cp.upsert_user(
            {
                "user_id": self.app_module.make_id("user"),
                "username": "http_researcher",
                "password": "research123",
                "role": "researcher",
                "full_name": "HTTP Researcher",
                "site_ids": [self.site_id],
            }
        )
        self.site_admin = self.cp.upsert_user(
            {
                "user_id": self.app_module.make_id("user"),
                "username": "http_site_admin",
                "password": "siteadmin123",
                "role": "site_admin",
                "full_name": "HTTP Site Admin",
                "site_ids": [self.site_id],
            }
        )
        self.other_researcher = self.cp.upsert_user(
            {
                "user_id": self.app_module.make_id("user"),
                "username": "http_researcher_other",
                "password": "research456",
                "role": "researcher",
                "full_name": "HTTP Researcher Other",
                "site_ids": [self.site_id],
            }
        )
        self.requester = self.cp.upsert_user(
            {
                "user_id": self.app_module.make_id("user"),
                "username": "http_viewer",
                "password": "viewer123",
                "role": "viewer",
                "full_name": "HTTP Viewer",
                "site_ids": [],
            }
        )
        from fastapi.testclient import TestClient

        self.client = TestClient(self.app_module.create_app())

    def tearDown(self):
        self.client.close()
        self.db_module.CONTROL_PLANE_ENGINE.dispose()
        self.db_module.DATA_PLANE_ENGINE.dispose()
        shutil.rmtree(self.site_store.site_dir, ignore_errors=True)
        if self.seed_model_path.exists():
            self.seed_model_path.unlink()
        for _ in range(3):
            try:
                self.tempdir.cleanup()
                break
            except PermissionError:
                gc.collect()
                time.sleep(0.2)
        else:
            self.tempdir.cleanup()

    def test_auth_and_local_case_data_can_use_separate_databases(self):
        old_site_dir = self.site_store.site_dir
        self.client.close()
        self.db_module.CONTROL_PLANE_ENGINE.dispose()
        self.db_module.DATA_PLANE_ENGINE.dispose()
        shutil.rmtree(old_site_dir, ignore_errors=True)
        self.tempdir.cleanup()

        split_tempdir = tempfile.TemporaryDirectory()
        self.tempdir = split_tempdir
        control_db = Path(split_tempdir.name) / "control.db"
        local_db = Path(split_tempdir.name) / "local.db"
        self.app_module = reload_app_module(
            control_plane_db_path=control_db,
            data_plane_db_path=local_db,
            control_plane_artifact_dir=Path(split_tempdir.name) / "control_artifacts",
        )
        self.db_module = sys.modules["kera_research.db"]
        self.cp = self.app_module.ControlPlaneStore()
        project = self.cp.create_project("Split DB Project", "test", "user_admin")
        self.site_id = "SPLIT_DB"
        self.cp.create_site(project["project_id"], self.site_id, "Split Site", "Split Hospital")
        self.site_store = self.app_module.SiteStore(self.site_id)
        from fastapi.testclient import TestClient

        self.client = TestClient(self.app_module.create_app())
        admin_token = self._login("admin", "admin123")
        self._seed_case(admin_token)

        with sqlite3.connect(control_db) as conn:
            control_tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            control_users = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        with sqlite3.connect(local_db) as conn:
            local_tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            local_patients = conn.execute("SELECT COUNT(*) FROM patients").fetchone()[0]

        self.assertIn("users", control_tables)
        self.assertNotIn("users", local_tables)
        self.assertGreaterEqual(control_users, 1)
        self.assertIn("patients", local_tables)
        self.assertEqual(local_patients, 1)

    def test_split_mode_case_crud_paths_do_not_touch_control_plane_http(self):
        old_site_dir = self.site_store.site_dir
        self.client.close()
        self.db_module.CONTROL_PLANE_ENGINE.dispose()
        self.db_module.DATA_PLANE_ENGINE.dispose()
        shutil.rmtree(old_site_dir, ignore_errors=True)
        self.tempdir.cleanup()

        split_tempdir = tempfile.TemporaryDirectory()
        self.tempdir = split_tempdir
        control_db = Path(split_tempdir.name) / "control.db"
        local_db = Path(split_tempdir.name) / "local.db"
        self.app_module = reload_app_module(
            control_plane_db_path=control_db,
            data_plane_db_path=local_db,
            control_plane_artifact_dir=Path(split_tempdir.name) / "control_artifacts",
        )
        self.db_module = sys.modules["kera_research.db"]
        self.site_id = "LOCAL_ONLY_SITE"
        from fastapi.testclient import TestClient

        self.client = TestClient(self.app_module.create_app())
        token = self.app_module._create_access_token(
            {
                "user_id": "local_user_001",
                "username": "local.user",
                "role": "researcher",
                "site_ids": [self.site_id],
                "approval_status": "approved",
            }
        )
        headers = {"Authorization": f"Bearer {token}"}

        with patch("kera_research.services.data_plane.init_control_plane_db", side_effect=AssertionError("data plane should stay local")), patch.object(
            self.app_module.ControlPlaneStore,
            "__init__",
            side_effect=AssertionError("control plane should stay idle"),
        ):
            site_store = self.app_module.SiteStore(self.site_id)
            self.assertTrue(site_store.site_dir.exists())

            sites_response = self.client.get("/api/sites", headers=headers)
            self.assertEqual(sites_response.status_code, 200, sites_response.text)
            self.assertEqual([item["site_id"] for item in sites_response.json()], [self.site_id])

            patient_response = self.client.post(
                f"/api/sites/{self.site_id}/patients",
                headers=headers,
                json={"patient_id": "LOCAL-001", "sex": "female", "age": 52, "chart_alias": "", "local_case_code": ""},
            )
            self.assertEqual(patient_response.status_code, 200, patient_response.text)

            visit_response = self.client.post(
                f"/api/sites/{self.site_id}/visits",
                headers=headers,
                json={
                    "patient_id": "LOCAL-001",
                    "visit_date": "Initial",
                    "culture_category": "bacterial",
                    "culture_species": "Staphylococcus aureus",
                    "contact_lens_use": "none",
                    "visit_status": "active",
                    "is_initial_visit": True,
                },
            )
            self.assertEqual(visit_response.status_code, 200, visit_response.text)

            image_response = self.client.post(
                f"/api/sites/{self.site_id}/images",
                headers=headers,
                data={
                    "patient_id": "LOCAL-001",
                    "visit_date": "Initial",
                    "view": "slit",
                    "is_representative": "true",
                },
                files={"file": ("local.png", self._make_test_image_bytes("PNG"), "image/png")},
            )
            self.assertEqual(image_response.status_code, 200, image_response.text)

            cases_response = self.client.get(f"/api/sites/{self.site_id}/cases", headers=headers)
            self.assertEqual(cases_response.status_code, 200, cases_response.text)
            self.assertEqual(len(cases_response.json()), 1)

            summary_response = self.client.get(f"/api/sites/{self.site_id}/summary", headers=headers)
            self.assertEqual(summary_response.status_code, 200, summary_response.text)
            summary_payload = summary_response.json()
            self.assertEqual(summary_payload["site_id"], self.site_id)
            self.assertEqual(summary_payload["n_patients"], 1)
            self.assertEqual(summary_payload["n_visits"], 1)
            self.assertEqual(summary_payload["n_images"], 1)
            self.assertEqual(summary_payload["n_validation_runs"], 0)
            self.assertFalse(summary_payload["research_registry"]["site_enabled"])

            activity_response = self.client.get(f"/api/sites/{self.site_id}/activity", headers=headers)
            self.assertEqual(activity_response.status_code, 200, activity_response.text)
            self.assertEqual(activity_response.json()["recent_validations"], [])
            self.assertEqual(activity_response.json()["recent_contributions"], [])

            model_versions_response = self.client.get(f"/api/sites/{self.site_id}/model-versions", headers=headers)
            self.assertEqual(model_versions_response.status_code, 200, model_versions_response.text)
            self.assertEqual(model_versions_response.json(), [])

        with sqlite3.connect(local_db) as conn:
            local_patients = conn.execute("SELECT COUNT(*) FROM patients").fetchone()[0]
            local_visits = conn.execute("SELECT COUNT(*) FROM visits").fetchone()[0]
            local_images = conn.execute("SELECT COUNT(*) FROM images").fetchone()[0]

        self.assertEqual(local_patients, 1)
        self.assertEqual(local_visits, 1)
        self.assertEqual(local_images, 1)

    def _login(self, username: str, password: str) -> str:
        response = self.client.post("/api/auth/login", json={"username": username, "password": password})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["access_token"]

    def _token_for_username(self, username: str) -> str:
        user = self.cp.get_user_by_username(username)
        self.assertIsNotNone(user)
        return self.app_module._create_access_token(user)

    def _make_test_image_bytes(self, image_format: str = "PNG", color: tuple[int, int, int] = (32, 96, 160)) -> bytes:
        buffer = io.BytesIO()
        Image.new("RGB", (24, 24), color=color).save(buffer, format=image_format)
        return buffer.getvalue()

    def _run_site_jobs(self, *, workflow=None, max_jobs: int = 1, site_id: str | None = None) -> int:
        from kera_research.services.job_runner import SiteJobWorker

        workflow_factory = (lambda _cp: workflow) if workflow is not None else None
        worker = SiteJobWorker(
            self.cp,
            worker_id="test-worker",
            workflow_factory=workflow_factory,
        )
        return worker.run_until_idle(max_jobs=max_jobs, site_id=site_id or self.site_id)

    def test_site_job_static_operations_run_data_plane_migration_first(self):
        from kera_research.services.data_plane import SiteStore

        with patch("kera_research.services.data_plane.init_data_plane_db") as mocked_init:
            SiteStore.requeue_stale_jobs(heartbeat_before="9999-12-31T23:59:59+00:00")
            self.assertTrue(mocked_init.called)

        with patch("kera_research.services.data_plane.init_data_plane_db") as mocked_init:
            SiteStore.claim_next_job("test-worker", queue_names=["training"], site_id=self.site_id)
            self.assertTrue(mocked_init.called)

        with patch("kera_research.services.data_plane.init_data_plane_db") as mocked_init:
            SiteStore.heartbeat_job("missing-job", "test-worker")
            self.assertTrue(mocked_init.called)

    def test_local_login_is_admin_only_http(self):
        response = self.client.post("/api/auth/login", json={"username": "http_researcher", "password": "research123"})
        self.assertEqual(response.status_code, 403, response.text)
        self.assertIn("restricted to platform admins", response.text)

    def test_local_login_can_be_disabled_http(self):
        os.environ["KERA_LOCAL_LOGIN_ENABLED"] = "false"
        try:
            response = self.client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
            self.assertEqual(response.status_code, 503, response.text)
            self.assertIn("disabled", response.text)
        finally:
            os.environ.pop("KERA_LOCAL_LOGIN_ENABLED", None)

    def test_non_admin_null_site_ids_do_not_expand_access_http(self):
        legacy_user = self.cp.upsert_user(
            {
                "user_id": self.app_module.make_id("user"),
                "username": "legacy_null_site_user",
                "password": "legacy123",
                "role": "researcher",
                "full_name": "Legacy Null Site User",
                "site_ids": [],
            }
        )
        self.assertEqual(legacy_user["site_ids"], [])

        with self.db_module.CONTROL_PLANE_ENGINE.begin() as conn:
            conn.execute(
                self.db_module.users.update()
                .where(self.db_module.users.c.user_id == legacy_user["user_id"])
                .values(site_ids=None)
            )

        repaired_store = self.app_module.ControlPlaneStore()
        repaired_user = repaired_store.get_user_by_id(legacy_user["user_id"])
        self.assertIsNotNone(repaired_user)
        self.assertEqual(repaired_user["site_ids"], [])
        self.assertEqual(repaired_store.accessible_sites_for_user(repaired_user), [])
        self.assertFalse(repaired_store.user_can_access_site(repaired_user, self.site_id))

    def test_plaintext_password_rows_are_migrated_to_bcrypt_http(self):
        legacy_admin_id = self.app_module.make_id("user")
        with self.db_module.CONTROL_PLANE_ENGINE.begin() as conn:
            conn.execute(
                self.db_module.users.insert().values(
                    user_id=legacy_admin_id,
                    username="legacy_plain_admin",
                    password="plain-admin-pass",
                    role="admin",
                    full_name="Legacy Plain Admin",
                    site_ids=[],
                    google_sub=None,
                )
            )

        migrated_store = self.app_module.ControlPlaneStore()
        raw_user = migrated_store._load_user_by_username("legacy_plain_admin")
        self.assertIsNotNone(raw_user)
        self.assertTrue(self.app_module._is_bcrypt_hash(str(raw_user["password"])))
        self.assertIsNotNone(migrated_store.authenticate("legacy_plain_admin", "plain-admin-pass"))

    def test_upsert_user_hashes_plaintext_password_http(self):
        created = self.cp.upsert_user(
            {
                "user_id": self.app_module.make_id("user"),
                "username": "hashed_on_upsert_admin",
                "password": "admin-pass-123",
                "role": "admin",
                "full_name": "Hashed On Upsert Admin",
                "site_ids": [],
            }
        )
        raw_user = self.cp._load_user_by_id(created["user_id"])
        self.assertIsNotNone(raw_user)
        self.assertTrue(self.app_module._is_bcrypt_hash(str(raw_user["password"])))
        self.assertIsNotNone(self.cp.authenticate("hashed_on_upsert_admin", "admin-pass-123"))

    def _seed_case(self, token: str, *, patient_id: str = "HTTP-001", visit_date: str = "Initial"):
        patient_response = self.client.post(
            f"/api/sites/{self.site_id}/patients",
            headers={"Authorization": f"Bearer {token}"},
            json={"patient_id": patient_id, "sex": "female", "age": 61, "chart_alias": "", "local_case_code": ""},
        )
        self.assertEqual(patient_response.status_code, 200, patient_response.text)
        visit_response = self.client.post(
            f"/api/sites/{self.site_id}/visits",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "patient_id": patient_id,
                "visit_date": visit_date,
                "culture_category": "bacterial",
                "culture_species": "Staphylococcus aureus",
                "contact_lens_use": "none",
                "visit_status": "active",
                "is_initial_visit": visit_date == "Initial",
            },
        )
        self.assertEqual(visit_response.status_code, 200, visit_response.text)
        self.assertTrue(visit_response.json()["is_initial_visit"])
        image_response = self.client.post(
            f"/api/sites/{self.site_id}/images",
            headers={"Authorization": f"Bearer {token}"},
            data={
                "patient_id": patient_id,
                "visit_date": visit_date,
                "view": "slit",
                "is_representative": "true",
            },
            files={"file": ("slit.png", self._make_test_image_bytes("PNG"), "image/png")},
        )
        self.assertEqual(image_response.status_code, 200, image_response.text)
        return image_response.json()["image_id"]

    def test_public_sites_and_accessible_site_list_http(self):
        public_response = self.client.get("/api/public/sites")
        self.assertEqual(public_response.status_code, 200, public_response.text)
        public_site_ids = [item["site_id"] for item in public_response.json()]
        self.assertIn(self.site_id, public_site_ids)

        researcher_token = self._token_for_username("http_researcher")
        sites_response = self.client.get(
            "/api/sites",
            headers={"Authorization": f"Bearer {researcher_token}"},
        )
        self.assertEqual(sites_response.status_code, 200, sites_response.text)
        self.assertEqual([item["site_id"] for item in sites_response.json()], [self.site_id])

    def test_patient_list_board_endpoint_returns_paginated_patient_rows_http(self):
        admin_token = self._login("admin", "admin123")
        self._seed_case(admin_token, patient_id="HTTP-001")
        self._seed_case(admin_token, patient_id="HTTP-002")
        self._seed_case(admin_token, patient_id="HTTP-003")

        response = self.client.get(
            f"/api/sites/{self.site_id}/patients/list-board?page=2&page_size=2",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["page"], 2)
        self.assertEqual(payload["page_size"], 2)
        self.assertEqual(payload["total_count"], 3)
        self.assertEqual(payload["total_pages"], 2)
        self.assertEqual(len(payload["items"]), 1)
        self.assertIn(payload["items"][0]["patient_id"], {"HTTP-001", "HTTP-002", "HTTP-003"})
        self.assertIn("latest_case", payload["items"][0])
        self.assertIn("representative_thumbnails", payload["items"][0])

        search_response = self.client.get(
            f"/api/sites/{self.site_id}/patients/list-board?q=HTTP-003&page=1&page_size=2",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        self.assertEqual(search_response.status_code, 200, search_response.text)
        search_payload = search_response.json()
        self.assertEqual(search_payload["total_count"], 1)
        self.assertEqual(len(search_payload["items"]), 1)
        self.assertEqual(search_payload["items"][0]["patient_id"], "HTTP-003")

    def test_site_summary_reports_case_counts_http(self):
        admin_token = self._login("admin", "admin123")
        self._seed_case(admin_token, patient_id="HTTP-001", visit_date="Initial")

        second_visit_response = self.client.post(
            f"/api/sites/{self.site_id}/visits",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "patient_id": "HTTP-001",
                "visit_date": "FU #1",
                "culture_category": "bacterial",
                "culture_species": "Staphylococcus aureus",
                "contact_lens_use": "none",
                "visit_status": "scar",
                "is_initial_visit": False,
            },
        )
        self.assertEqual(second_visit_response.status_code, 200, second_visit_response.text)

        summary_response = self.client.get(
            f"/api/sites/{self.site_id}/summary",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        self.assertEqual(summary_response.status_code, 200, summary_response.text)
        payload = summary_response.json()
        self.assertEqual(payload["site_id"], self.site_id)
        self.assertEqual(payload["n_patients"], 1)
        self.assertEqual(payload["n_visits"], 2)
        self.assertEqual(payload["n_images"], 1)
        self.assertEqual(payload["n_active_visits"], 1)
        self.assertEqual(payload["n_validation_runs"], 0)
        self.assertIsNone(payload["latest_validation"])

    def test_embedding_backfill_reuses_running_job_http(self):
        admin_token = self._login("admin", "admin123")
        self._seed_case(admin_token, patient_id="HTTP-001", visit_date="Initial")

        class SlowEmbeddingWorkflow:
            def __init__(self, _cp):
                pass

            def index_case_embedding(self, *args, **kwargs):
                time.sleep(0.4)

            def rebuild_case_vector_index(self, *args, **kwargs):
                return {"index_path": "fake.index"}

        with patch.object(self.app_module, "ResearchWorkflowService", SlowEmbeddingWorkflow):
            first_response = self.client.post(
                f"/api/sites/{self.site_id}/ai-clinic/embeddings/backfill",
                headers={"Authorization": f"Bearer {admin_token}"},
                json={"execution_mode": "cpu", "force_refresh": False},
            )
            self.assertEqual(first_response.status_code, 200, first_response.text)
            first_payload = first_response.json()

            second_response = self.client.post(
                f"/api/sites/{self.site_id}/ai-clinic/embeddings/backfill",
                headers={"Authorization": f"Bearer {admin_token}"},
                json={"execution_mode": "gpu", "force_refresh": True},
            )
            self.assertEqual(second_response.status_code, 200, second_response.text)
            second_payload = second_response.json()

        self.assertEqual(first_payload["job"]["job_id"], second_payload["job"]["job_id"])
        self.assertEqual(second_payload["execution_device"], "cpu")
        embedding_jobs = [
            job for job in self.site_store.list_jobs() if job.get("job_type") == "ai_clinic_embedding_backfill"
        ]
        self.assertEqual(len(embedding_jobs), 1)
        self.assertEqual(embedding_jobs[0]["status"], "running")
        for _ in range(30):
            job = self.site_store.get_job(first_payload["job"]["job_id"])
            if job is not None and job.get("status") == "completed":
                break
            time.sleep(0.1)

    def test_embedding_status_reports_missing_images_http(self):
        admin_token = self._login("admin", "admin123")
        self._seed_case(admin_token, patient_id="HTTP-001", visit_date="Initial")
        self._seed_case(admin_token, patient_id="HTTP-002", visit_date="Initial")

        class FakeEmbeddingWorkflow:
            def list_cases_requiring_embedding(self, site_store, *, model_version, backend="classifier"):
                return [
                    summary
                    for summary in site_store.list_case_summaries()
                    if summary["patient_id"] == "HTTP-002"
                ]

            def case_vector_index_exists(self, site_store, *, model_version, backend):
                return backend == "classifier"

        with patch.object(self.app_module, "_get_workflow", return_value=FakeEmbeddingWorkflow()):
            response = self.client.get(
                f"/api/sites/{self.site_id}/ai-clinic/embeddings/status",
                headers={"Authorization": f"Bearer {admin_token}"},
            )

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["site_id"], self.site_id)
        self.assertEqual(payload["total_cases"], 2)
        self.assertEqual(payload["missing_case_count"], 1)
        self.assertEqual(payload["missing_image_count"], 1)
        self.assertTrue(payload["needs_backfill"])
        self.assertTrue(payload["vector_index"]["classifier_available"])
        self.assertFalse(payload["vector_index"]["dinov2_embedding_available"])
        self.assertIsNone(payload["active_job"])

    def test_invalid_image_upload_is_rejected_http(self):
        token = self._token_for_username("http_researcher")
        self._seed_case(token)

        response = self.client.post(
            f"/api/sites/{self.site_id}/images",
            headers={"Authorization": f"Bearer {token}"},
            data={
                "patient_id": "HTTP-001",
                "visit_date": "Initial",
                "view": "slit",
                "is_representative": "false",
            },
            files={"file": ("not-really.jpg", b"not-an-image", "image/jpeg")},
        )
        self.assertEqual(response.status_code, 415, response.text)
        self.assertIn("Invalid image file", response.text)

    def test_patient_id_accepts_local_chart_id_http(self):
        token = self._token_for_username("http_researcher")
        response = self.client.post(
            f"/api/sites/{self.site_id}/patients",
            headers={"Authorization": f"Bearer {token}"},
            json={"patient_id": "12345678", "sex": "female", "age": 61, "chart_alias": "", "local_case_code": ""},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["patient_id"], "12345678")

    def test_visit_reference_rejects_calendar_date_http(self):
        token = self._token_for_username("http_researcher")
        patient_response = self.client.post(
            f"/api/sites/{self.site_id}/patients",
            headers={"Authorization": f"Bearer {token}"},
            json={"patient_id": "HTTP-003", "sex": "female", "age": 61, "chart_alias": "", "local_case_code": ""},
        )
        self.assertEqual(patient_response.status_code, 200, patient_response.text)

        response = self.client.post(
            f"/api/sites/{self.site_id}/visits",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "patient_id": "HTTP-003",
                "visit_date": "2026-03-11",
                "actual_visit_date": "2026-03-11",
                "culture_category": "bacterial",
                "culture_species": "Staphylococcus aureus",
                "contact_lens_use": "none",
                "visit_status": "active",
                "is_initial_visit": True,
            },
        )
        self.assertEqual(response.status_code, 400, response.text)
        self.assertIn("Visit reference must be 'Initial' or 'FU #N'", response.text)

    def test_image_semantic_prompt_review_http(self):
        token = self._token_for_username("http_researcher")
        image_id = self._seed_case(token)
        with patch.object(self.app_module, "_get_semantic_prompt_scorer", return_value=FakeSemanticPromptScorer()):
            response = self.client.get(
                f"/api/sites/{self.site_id}/images/{image_id}/semantic-prompts?top_k=3",
                headers={"Authorization": f"Bearer {token}"},
            )
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["image_id"], image_id)
        self.assertEqual(payload["view"], "slit")
        self.assertEqual(payload["input_mode"], "source")
        self.assertEqual(payload["dictionary_name"], "standard")
        self.assertEqual(payload["overall_top_matches"][0]["prompt_id"], "fungal_keratitis")
        self.assertEqual(payload["layers"][0]["layer_id"], "diagnosis")

    def test_live_lesion_preview_job_http(self):
        token = self._token_for_username("http_researcher")
        image_id = self._seed_case(token)
        lesion_box_response = self.client.patch(
            f"/api/sites/{self.site_id}/images/{image_id}/lesion-box",
            headers={"Authorization": f"Bearer {token}"},
            json={"x0": 0.2, "y0": 0.2, "x1": 0.6, "y1": 0.7},
        )
        self.assertEqual(lesion_box_response.status_code, 200, lesion_box_response.text)

        fake_workflow = FakeWorkflow(self.app_module, self.cp)
        with patch.object(self.app_module, "_get_workflow", return_value=fake_workflow):
            start_response = self.client.post(
                f"/api/sites/{self.site_id}/images/{image_id}/lesion-live-preview",
                headers={"Authorization": f"Bearer {token}"},
            )
            self.assertEqual(start_response.status_code, 200, start_response.text)
            start_payload = start_response.json()
            self.assertEqual(start_payload["image_id"], image_id)
            self.assertIn(start_payload["status"], {"running", "done"})
            self.assertTrue(start_payload["job_id"])

            job_response = self.client.get(
                f"/api/sites/{self.site_id}/images/{image_id}/lesion-live-preview/jobs/{start_payload['job_id']}",
                headers={"Authorization": f"Bearer {token}"},
            )
            self.assertEqual(job_response.status_code, 200, job_response.text)
            job_payload = job_response.json()
            self.assertEqual(job_payload["image_id"], image_id)
            self.assertIn(job_payload["status"], {"running", "done"})
            self.assertIn("prompt_signature", job_payload)

    def test_stored_case_lesion_preview_http(self):
        token = self._token_for_username("http_researcher")
        image_id = self._seed_case(token)
        lesion_box_response = self.client.patch(
            f"/api/sites/{self.site_id}/images/{image_id}/lesion-box",
            headers={"Authorization": f"Bearer {token}"},
            json={"x0": 0.2, "y0": 0.2, "x1": 0.6, "y1": 0.7},
        )
        self.assertEqual(lesion_box_response.status_code, 200, lesion_box_response.text)

        image = self.site_store.get_image(image_id)
        self.assertIsNotNone(image)
        artifact_name = Path(str(image["image_path"])).stem
        mask_path = self.site_store.lesion_mask_dir / f"{artifact_name}_mask.png"
        crop_path = self.site_store.lesion_crop_dir / f"{artifact_name}_crop.png"
        metadata_dir = self.site_store.artifact_dir / "lesion_preview_meta"
        metadata_dir.mkdir(parents=True, exist_ok=True)
        metadata_path = metadata_dir / f"{artifact_name}.json"
        prompt_signature = hashlib.sha1(
            json.dumps(
                {"x0": 0.2, "x1": 0.6, "y0": 0.2, "y1": 0.7},
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()[:12]
        mask_path.write_bytes(b"mask")
        crop_path.write_bytes(b"crop")
        metadata_path.write_text(
            json.dumps(
                {
                    "backend": "medsam",
                    "crop_style": "soft_masked_bbox_v1",
                    "medsam_error": None,
                    "prompt_signature": prompt_signature,
                }
            ),
            encoding="utf-8",
        )

        preview_response = self.client.get(
            f"/api/sites/{self.site_id}/cases/lesion-preview/stored?patient_id=HTTP-001&visit_date=Initial",
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(preview_response.status_code, 200, preview_response.text)
        preview_payload = preview_response.json()
        self.assertEqual(len(preview_payload), 1)
        self.assertEqual(preview_payload[0]["image_id"], image_id)
        self.assertTrue(preview_payload[0]["has_lesion_mask"])
        self.assertTrue(preview_payload[0]["has_lesion_crop"])

        artifact_response = self.client.get(
            f"/api/sites/{self.site_id}/cases/lesion-preview/artifacts/lesion_mask?patient_id=HTTP-001&visit_date=Initial&image_id={image_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(artifact_response.status_code, 200, artifact_response.text)
        self.assertEqual(artifact_response.content, b"mask")

    def test_case_history_http_reads_local_site_history(self):
        token = self._token_for_username("http_researcher")
        self._seed_case(token)
        self.site_store.record_case_validation_history(
            "HTTP-001",
            "Initial",
            {
                "validation_id": "validation_local_001",
                "run_date": "2026-03-17T10:00:00+00:00",
                "model_version": "local-current",
                "model_version_id": "model_local_001",
                "model_architecture": "convnext_tiny",
                "run_scope": "case",
                "predicted_label": "bacterial",
                "true_label": "bacterial",
                "prediction_probability": 0.91,
                "is_correct": True,
            },
        )
        self.site_store.record_case_contribution_history(
            "HTTP-001",
            "Initial",
            {
                "contribution_id": "contrib_local_001",
                "contribution_group_id": "group_local_001",
                "created_at": "2026-03-17T10:05:00+00:00",
                "user_id": "http_researcher",
                "case_reference_id": "case_local_001",
                "update_id": "update_local_001",
                "update_status": "pending_review",
                "upload_type": "weight delta",
                "architecture": "convnext_tiny",
                "execution_device": "cpu",
                "base_model_version_id": "model_local_001",
            },
        )

        with patch.object(
            self.app_module.ControlPlaneStore,
            "list_validation_runs",
            side_effect=AssertionError("case history should not read central validation runs"),
        ), patch.object(
            self.app_module.ControlPlaneStore,
            "list_contributions",
            side_effect=AssertionError("case history should not read central contributions"),
        ), patch.object(
            self.app_module.ControlPlaneStore,
            "list_model_updates",
            side_effect=AssertionError("case history should not read central model updates"),
        ):
            response = self.client.get(
                f"/api/sites/{self.site_id}/cases/history?patient_id=HTTP-001&visit_date=Initial",
                headers={"Authorization": f"Bearer {token}"},
            )

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(len(payload["validations"]), 1)
        self.assertEqual(payload["validations"][0]["validation_id"], "validation_local_001")
        self.assertEqual(len(payload["contributions"]), 1)
        self.assertEqual(payload["contributions"][0]["contribution_id"], "contrib_local_001")

    def test_non_owner_cannot_modify_or_delete_other_researcher_case_http(self):
        owner_token = self._token_for_username("http_researcher")
        other_token = self._token_for_username("http_researcher_other")
        admin_token = self._login("admin", "admin123")
        image_id = self._seed_case(owner_token)

        update_visit_response = self.client.patch(
            f"/api/sites/{self.site_id}/visits?patient_id=HTTP-001&visit_date=Initial",
            headers={"Authorization": f"Bearer {other_token}"},
            json={
                "patient_id": "HTTP-001",
                "visit_date": "Initial",
                "culture_category": "bacterial",
                "culture_species": "Staphylococcus aureus",
                "contact_lens_use": "soft",
                "visit_status": "active",
                "is_initial_visit": True,
            },
        )
        self.assertEqual(update_visit_response.status_code, 403, update_visit_response.text)

        representative_response = self.client.post(
            f"/api/sites/{self.site_id}/images/representative",
            headers={"Authorization": f"Bearer {other_token}"},
            json={
                "patient_id": "HTTP-001",
                "visit_date": "Initial",
                "representative_image_id": image_id,
            },
        )
        self.assertEqual(representative_response.status_code, 403, representative_response.text)

        lesion_box_response = self.client.patch(
            f"/api/sites/{self.site_id}/images/{image_id}/lesion-box",
            headers={"Authorization": f"Bearer {other_token}"},
            json={"x0": 0.1, "y0": 0.1, "x1": 0.5, "y1": 0.5},
        )
        self.assertEqual(lesion_box_response.status_code, 403, lesion_box_response.text)

        delete_images_response = self.client.delete(
            f"/api/sites/{self.site_id}/images?patient_id=HTTP-001&visit_date=Initial",
            headers={"Authorization": f"Bearer {other_token}"},
        )
        self.assertEqual(delete_images_response.status_code, 403, delete_images_response.text)

        delete_visit_response = self.client.delete(
            f"/api/sites/{self.site_id}/visits?patient_id=HTTP-001&visit_date=Initial",
            headers={"Authorization": f"Bearer {other_token}"},
        )
        self.assertEqual(delete_visit_response.status_code, 403, delete_visit_response.text)

        admin_lesion_box_response = self.client.patch(
            f"/api/sites/{self.site_id}/images/{image_id}/lesion-box",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"x0": 0.1, "y0": 0.1, "x1": 0.5, "y1": 0.5},
        )
        self.assertEqual(admin_lesion_box_response.status_code, 200, admin_lesion_box_response.text)

        admin_delete_visit_response = self.client.delete(
            f"/api/sites/{self.site_id}/visits?patient_id=HTTP-001&visit_date=Initial",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        self.assertEqual(admin_delete_visit_response.status_code, 200, admin_delete_visit_response.text)

    def test_case_validation_and_contribution_http(self):
        token = self._token_for_username("http_researcher")
        self._seed_case(token)
        fake_workflow = FakeWorkflow(self.app_module, self.cp)
        with patch.object(self.app_module, "_get_workflow", return_value=fake_workflow):
            validation_response = self.client.post(
                f"/api/sites/{self.site_id}/cases/validate",
                headers={"Authorization": f"Bearer {token}"},
                json={"patient_id": "HTTP-001", "visit_date": "Initial", "execution_mode": "cpu"},
            )
            self.assertEqual(validation_response.status_code, 200, validation_response.text)
            validation_payload = validation_response.json()
            self.assertEqual(validation_payload["summary"]["predicted_label"], "bacterial")
            self.assertTrue(validation_payload["artifact_availability"]["roi_crop"])
            saved_predictions = self.cp.load_case_predictions(validation_payload["summary"]["validation_id"])
            self.assertIn("case_reference_id", saved_predictions[0])
            self.assertNotIn("patient_id", saved_predictions[0])
            self.assertNotIn("visit_date", saved_predictions[0])

            contribution_response = self.client.post(
                f"/api/sites/{self.site_id}/cases/contribute",
                headers={"Authorization": f"Bearer {token}"},
                json={"patient_id": "HTTP-001", "visit_date": "Initial", "execution_mode": "cpu"},
            )
            self.assertEqual(contribution_response.status_code, 200, contribution_response.text)
            contribution_payload = contribution_response.json()
            self.assertEqual(contribution_payload["update"]["status"], "pending_upload")
            self.assertEqual(contribution_payload["stats"]["user_contributions"], 1)
            self.assertTrue(contribution_payload.get("contribution_group_id"))
            self.assertIn("case_reference_id", contribution_payload["update"])
            self.assertNotIn("patient_id", contribution_payload["update"])
            self.assertNotIn("visit_date", contribution_payload["update"])

            history_response = self.client.get(
                f"/api/sites/{self.site_id}/cases/history?patient_id=HTTP-001&visit_date=Initial",
                headers={"Authorization": f"Bearer {token}"},
            )
            self.assertEqual(history_response.status_code, 200, history_response.text)
            history_payload = history_response.json()
            self.assertEqual(len(history_payload["contributions"]), 1)
            self.assertEqual(
                history_payload["contributions"][0]["case_reference_id"],
                contribution_payload["update"]["case_reference_id"],
            )

            activity_response = self.client.get(
                f"/api/sites/{self.site_id}/activity",
                headers={"Authorization": f"Bearer {token}"},
            )
            self.assertEqual(activity_response.status_code, 200, activity_response.text)
            activity_payload = activity_response.json()
            self.assertEqual(
                activity_payload["recent_contributions"][0]["case_reference_id"],
                contribution_payload["update"]["case_reference_id"],
            )
            self.assertNotIn("patient_id", activity_payload["recent_contributions"][0])
            self.assertNotIn("visit_date", activity_payload["recent_contributions"][0])

    def test_patient_reference_trajectory_http(self):
        token = self._token_for_username("http_researcher")
        self._seed_case(token)
        fake_workflow = FakeWorkflow(self.app_module, self.cp)
        with patch.object(self.app_module, "_get_workflow", return_value=fake_workflow):
            validation_response = self.client.post(
                f"/api/sites/{self.site_id}/cases/validate",
                headers={"Authorization": f"Bearer {token}"},
                json={"patient_id": "HTTP-001", "visit_date": "Initial", "execution_mode": "cpu"},
            )
            self.assertEqual(validation_response.status_code, 200, validation_response.text)

        visit = self.site_store.get_visit("HTTP-001", "Initial")
        self.assertIsNotNone(visit)
        patient_reference_id = str(visit.get("patient_reference_id") or "")
        self.assertTrue(patient_reference_id.startswith("ptref_"))

        trajectory_response = self.client.get(
            f"/api/sites/{self.site_id}/patients/{patient_reference_id}/trajectory",
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(trajectory_response.status_code, 200, trajectory_response.text)
        trajectory_payload = trajectory_response.json()
        self.assertEqual(trajectory_payload["patient_reference_id"], patient_reference_id)
        self.assertEqual(len(trajectory_payload["trajectory"]), 1)
        self.assertEqual(trajectory_payload["trajectory"][0]["visit_index"], 0)
        self.assertEqual(trajectory_payload["trajectory"][0]["visit_label"], "Initial")
        self.assertEqual(len(trajectory_payload["trajectory"][0]["validations"]), 1)

    def test_case_contribution_can_fan_out_into_multiple_updates_http(self):
        token = self._token_for_username("http_researcher")
        self._seed_case(token)
        for index, architecture in enumerate(("vit", "swin", "convnext_tiny", "efficientnet_v2_s"), start=1):
            self.cp.ensure_model_version(
                {
                    "version_id": self.app_module.make_id("model"),
                    "version_name": f"global-{architecture}-http",
                    "architecture": architecture,
                    "stage": "global",
                    "model_path": str(self.seed_model_path),
                    "created_at": f"2026-03-11T01:{index:02d}:00+00:00",
                    "ready": True,
                    "is_current": False,
                    "requires_medsam_crop": True,
                }
            )

        selected_models = []
        for architecture in ("vit", "swin", "convnext_tiny", "densenet121", "efficientnet_v2_s"):
            match = next(
                item
                for item in reversed(self.cp.list_model_versions())
                if item.get("architecture") == architecture and item.get("ready", True)
            )
            selected_models.append(match["version_id"])

        fake_workflow = FakeWorkflow(self.app_module, self.cp)
        with patch.object(self.app_module, "_get_workflow", return_value=fake_workflow):
            contribution_response = self.client.post(
                f"/api/sites/{self.site_id}/cases/contribute",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "patient_id": "HTTP-001",
                    "visit_date": "Initial",
                    "execution_mode": "cpu",
                    "model_version_ids": selected_models,
                },
            )
            self.assertEqual(contribution_response.status_code, 200, contribution_response.text)
            contribution_payload = contribution_response.json()
            self.assertEqual(contribution_payload["update_count"], 5)
            self.assertEqual(len(contribution_payload["updates"]), 5)
            self.assertEqual(len(contribution_payload["model_versions"]), 5)
            self.assertEqual(contribution_payload["failures"], [])
            self.assertEqual(contribution_payload["stats"]["user_contributions"], 5)
            self.assertTrue(contribution_payload.get("contribution_group_id"))
            self.assertEqual(
                len({item.get("contribution_group_id") for item in contribution_payload["updates"]}),
                1,
            )
            self.assertEqual(len(self.cp.list_model_updates(site_id=self.site_id)), 5)

            history_response = self.client.get(
                f"/api/sites/{self.site_id}/cases/history?patient_id=HTTP-001&visit_date=Initial",
                headers={"Authorization": f"Bearer {token}"},
            )
            self.assertEqual(history_response.status_code, 200, history_response.text)
            history_payload = history_response.json()
            self.assertEqual(len(history_payload["contributions"]), 5)

    def test_case_validation_and_ai_clinic_can_use_multi_model_analysis_ensemble_http(self):
        token = self._token_for_username("http_researcher")
        self._seed_case(token)
        for index, architecture in enumerate(("vit", "swin", "convnext_tiny", "efficientnet_v2_s"), start=1):
            self.cp.ensure_model_version(
                {
                    "version_id": self.app_module.make_id("model"),
                    "version_name": f"global-{architecture}-http",
                    "architecture": architecture,
                    "stage": "global",
                    "model_path": str(self.seed_model_path),
                    "created_at": f"2026-03-11T00:{index:02d}:00+00:00",
                    "ready": True,
                    "is_current": False,
                    "requires_medsam_crop": True,
                    "decision_threshold": 0.5,
                }
            )

        selected_models = []
        for architecture in ("vit", "swin", "convnext_tiny", "densenet121", "efficientnet_v2_s"):
            match = next(
                item
                for item in reversed(self.cp.list_model_versions())
                if item.get("architecture") == architecture and item.get("ready", True)
            )
            selected_models.append(match["version_id"])

        fake_workflow = FakeWorkflow(self.app_module, self.cp)
        with patch.object(self.app_module, "_get_workflow", return_value=fake_workflow):
            validation_response = self.client.post(
                f"/api/sites/{self.site_id}/cases/validate",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "patient_id": "HTTP-001",
                    "visit_date": "Initial",
                    "execution_mode": "cpu",
                    "model_version_ids": selected_models,
                },
            )
            self.assertEqual(validation_response.status_code, 200, validation_response.text)
            validation_payload = validation_response.json()
            self.assertEqual(validation_payload["model_version"]["ensemble_mode"], "weighted_average")
            self.assertEqual(validation_payload["model_version"]["architecture"], "multi_model_ensemble")
            self.assertEqual(validation_payload["model_version"]["crop_mode"], "automated")
            self.assertTrue(validation_payload["model_version"]["version_id"].startswith("analysis_ensemble_"))

            ai_clinic_response = self.client.post(
                f"/api/sites/{self.site_id}/cases/ai-clinic",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "patient_id": "HTTP-001",
                    "visit_date": "Initial",
                    "execution_mode": "cpu",
                    "model_version_ids": selected_models,
                    "retrieval_backend": "hybrid",
                },
            )
            self.assertEqual(ai_clinic_response.status_code, 200, ai_clinic_response.text)
            ai_clinic_payload = ai_clinic_response.json()
            self.assertTrue(ai_clinic_payload["model_version_id"].startswith("analysis_ensemble_"))

    def test_research_registry_opt_in_and_case_include_http(self):
        token = self._token_for_username("http_researcher")
        self._seed_case(token)

        summary_before = self.client.get(
            f"/api/sites/{self.site_id}/summary",
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(summary_before.status_code, 200, summary_before.text)
        self.assertFalse(summary_before.json()["research_registry"]["user_enrolled"])
        self.assertTrue(summary_before.json()["research_registry"]["site_enabled"])

        consent_response = self.client.post(
            f"/api/sites/{self.site_id}/research-registry/consent",
            headers={"Authorization": f"Bearer {token}"},
            json={"version": "v1"},
        )
        self.assertEqual(consent_response.status_code, 200, consent_response.text)
        self.assertTrue(consent_response.json()["user_enrolled"])

        include_response = self.client.post(
            f"/api/sites/{self.site_id}/cases/research-registry",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "patient_id": "HTTP-001",
                "visit_date": "Initial",
                "action": "include",
                "source": "test_auto_include",
            },
        )
        self.assertEqual(include_response.status_code, 200, include_response.text)
        self.assertEqual(include_response.json()["research_registry_status"], "included")

        summary_after_include = self.client.get(
            f"/api/sites/{self.site_id}/summary",
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(summary_after_include.status_code, 200, summary_after_include.text)
        self.assertEqual(summary_after_include.json()["research_registry"]["included_cases"], 1)
        self.assertEqual(summary_after_include.json()["research_registry"]["excluded_cases"], 0)

        exclude_response = self.client.post(
            f"/api/sites/{self.site_id}/cases/research-registry",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "patient_id": "HTTP-001",
                "visit_date": "Initial",
                "action": "exclude",
                "source": "test_manual_exclude",
            },
        )
        self.assertEqual(exclude_response.status_code, 200, exclude_response.text)
        self.assertEqual(exclude_response.json()["research_registry_status"], "excluded")

        summary_after_exclude = self.client.get(
            f"/api/sites/{self.site_id}/summary",
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(summary_after_exclude.status_code, 200, summary_after_exclude.text)
        self.assertEqual(summary_after_exclude.json()["research_registry"]["included_cases"], 0)
        self.assertEqual(summary_after_exclude.json()["research_registry"]["excluded_cases"], 1)

    def test_delete_visit_removes_patient_when_last_visit_http(self):
        token = self._token_for_username("http_researcher")
        self._seed_case(token)

        delete_response = self.client.delete(
            f"/api/sites/{self.site_id}/visits?patient_id=HTTP-001&visit_date=Initial",
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(delete_response.status_code, 200, delete_response.text)
        self.assertTrue(delete_response.json()["deleted_patient"])
        self.assertEqual(delete_response.json()["remaining_visit_count"], 0)

        patients_response = self.client.get(
            f"/api/sites/{self.site_id}/patients",
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(patients_response.status_code, 200, patients_response.text)
        self.assertEqual(patients_response.json(), [])

        visits_response = self.client.get(
            f"/api/sites/{self.site_id}/visits?patient_id=HTTP-001",
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(visits_response.status_code, 200, visits_response.text)
        self.assertEqual(visits_response.json(), [])

    def test_admin_model_update_artifact_can_be_served_from_embedded_thumbnail(self):
        admin_token = self._login("admin", "admin123")
        update_id = self.app_module.make_id("update")
        thumbnail_bytes = b"embedded-thumb"
        self.cp.register_model_update(
            {
                "update_id": update_id,
                "site_id": self.site_id,
                "architecture": "densenet121",
                "status": "pending_review",
                "created_at": "2026-03-11T00:15:00+00:00",
                "approval_report": {
                    "artifacts": {
                        "source_thumbnail": {
                            "media_type": "image/jpeg",
                            "encoding": "base64",
                            "bytes_b64": base64.b64encode(thumbnail_bytes).decode("ascii"),
                        }
                    }
                },
            }
        )

        response = self.client.get(
            f"/api/admin/model-updates/{update_id}/artifacts/source_thumbnail",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.content, thumbnail_bytes)
        self.assertEqual(response.headers.get("content-type"), "image/jpeg")

    def test_visit_auto_marks_polymicrobial_when_multiple_organisms_are_added(self):
        token = self._token_for_username("http_researcher")
        patient_response = self.client.post(
            f"/api/sites/{self.site_id}/patients",
            headers={"Authorization": f"Bearer {token}"},
            json={"patient_id": "HTTP-002", "sex": "female", "age": 58, "chart_alias": "", "local_case_code": ""},
        )
        self.assertEqual(patient_response.status_code, 200, patient_response.text)

        visit_response = self.client.post(
            f"/api/sites/{self.site_id}/visits",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "patient_id": "HTTP-002",
                "visit_date": "Initial",
                "culture_category": "bacterial",
                "culture_species": "Staphylococcus aureus",
                "additional_organisms": [
                    {
                        "culture_category": "fungal",
                        "culture_species": "Fusarium",
                    }
                ],
                "contact_lens_use": "none",
                "visit_status": "active",
                "is_initial_visit": True,
            },
        )
        self.assertEqual(visit_response.status_code, 200, visit_response.text)
        visit_payload = visit_response.json()
        self.assertTrue(visit_payload["polymicrobial"])
        self.assertEqual(len(visit_payload["additional_organisms"]), 1)
        self.assertEqual(visit_payload["additional_organisms"][0]["culture_species"], "Fusarium")

    def test_training_registry_and_aggregation_http(self):
        admin_token = self._login("admin", "admin123")
        self._seed_case(admin_token)
        fake_workflow = FakeWorkflow(self.app_module, self.cp)
        with patch.object(self.app_module, "_get_workflow", return_value=fake_workflow):
            training_response = self.client.post(
                f"/api/sites/{self.site_id}/training/initial",
                headers={"Authorization": f"Bearer {admin_token}"},
                json={"architecture": "convnext_tiny", "execution_mode": "cpu", "epochs": 2},
            )
            self.assertEqual(training_response.status_code, 200, training_response.text)
            training_job_id = training_response.json()["job"]["job_id"]
            self._run_site_jobs(workflow=fake_workflow, max_jobs=1, site_id=self.site_id)
            training_result = None
            for _ in range(30):
                training_job_response = self.client.get(
                    f"/api/sites/{self.site_id}/jobs/{training_job_id}",
                    headers={"Authorization": f"Bearer {admin_token}"},
                )
                self.assertEqual(training_job_response.status_code, 200, training_job_response.text)
                training_job = training_job_response.json()
                if training_job["status"] == "completed":
                    training_result = training_job["result"]["response"]
                    break
                if training_job["status"] == "failed":
                    self.fail(training_job["result"].get("error") or "initial training job failed")
                time.sleep(0.05)
            self.assertIsNotNone(training_result)
            self.assertEqual(training_result["result"]["version_name"], "global-convnext_tiny-http")

            cv_response = self.client.post(
                f"/api/sites/{self.site_id}/training/cross-validation",
                headers={"Authorization": f"Bearer {admin_token}"},
                json={"architecture": "convnext_tiny", "execution_mode": "cpu", "num_folds": 3},
            )
            self.assertEqual(cv_response.status_code, 200, cv_response.text)
            cv_job_id = cv_response.json()["job"]["job_id"]
            self._run_site_jobs(workflow=fake_workflow, max_jobs=1, site_id=self.site_id)
            cv_result = None
            for _ in range(30):
                cv_job_response = self.client.get(
                    f"/api/sites/{self.site_id}/jobs/{cv_job_id}",
                    headers={"Authorization": f"Bearer {admin_token}"},
                )
                self.assertEqual(cv_job_response.status_code, 200, cv_job_response.text)
                cv_job = cv_job_response.json()
                if cv_job["status"] == "completed":
                    cv_result = cv_job["result"]["response"]
                    break
                if cv_job["status"] == "failed":
                    self.fail(cv_job["result"].get("error") or "cross validation job failed")
                time.sleep(0.05)
            self.assertIsNotNone(cv_result)

            list_response = self.client.get(
                f"/api/sites/{self.site_id}/training/cross-validation",
                headers={"Authorization": f"Bearer {admin_token}"},
            )
            self.assertEqual(list_response.status_code, 200, list_response.text)
            self.assertEqual(len(list_response.json()), 1)

            experiments_response = self.client.get(
                f"/api/admin/experiments?site_id={self.site_id}",
                headers={"Authorization": f"Bearer {admin_token}"},
            )
            self.assertEqual(experiments_response.status_code, 200, experiments_response.text)
            experiments_payload = experiments_response.json()
            self.assertGreaterEqual(len(experiments_payload), 2)
            experiment_types = {item["experiment_type"] for item in experiments_payload}
            self.assertIn("initial_training", experiment_types)
            self.assertIn("cross_validation", experiment_types)
            experiment_detail_response = self.client.get(
                f"/api/admin/experiments/{experiments_payload[0]['experiment_id']}",
                headers={"Authorization": f"Bearer {admin_token}"},
            )
            self.assertEqual(experiment_detail_response.status_code, 200, experiment_detail_response.text)

            base_model = self.cp.current_global_model()
            for index in range(2):
                delta_path = self.site_store.update_dir / f"pending_{index}.pt"
                delta_path.parent.mkdir(parents=True, exist_ok=True)
                delta_path.write_bytes(b"delta")
                registered_update = self.cp.register_model_update(
                    {
                        "update_id": self.app_module.make_id("update"),
                        "site_id": self.site_id if index == 0 else "SITE-B",
                        "base_model_version_id": base_model["version_id"],
                        "architecture": base_model["architecture"],
                        "upload_type": "weight delta",
                        "execution_device": "cpu",
                        "artifact_path": str(delta_path),
                        "n_cases": 1,
                        "created_at": f"2026-03-11T00:4{index}:00+00:00",
                        "status": "approved",
                    }
                )
                self.assertTrue(str(registered_update.get("central_artifact_key") or "").startswith("model_updates/"))
                self.assertTrue(self.cp.resolve_model_update_artifact_path(registered_update).exists())
                delta_path.unlink()

            aggregation_response = self.client.post(
                "/api/admin/aggregations/run",
                headers={"Authorization": f"Bearer {admin_token}"},
                json={},
            )
            self.assertEqual(aggregation_response.status_code, 200, aggregation_response.text)
            aggregation_payload = aggregation_response.json()
            self.assertEqual(len(aggregation_payload["aggregated_update_ids"]), 2)

            aggregations_response = self.client.get("/api/admin/aggregations", headers={"Authorization": f"Bearer {admin_token}"})
            self.assertEqual(aggregations_response.status_code, 200, aggregations_response.text)
            self.assertEqual(len(aggregations_response.json()), 1)

    def test_aggregation_rejects_multiple_updates_from_same_site_http(self):
        admin_token = self._login("admin", "admin123")
        base_model = self.cp.current_global_model()
        for index in range(2):
            delta_path = self.site_store.update_dir / f"dup_site_{index}.pt"
            delta_path.parent.mkdir(parents=True, exist_ok=True)
            delta_path.write_bytes(b"delta")
            self.cp.register_model_update(
                {
                    "update_id": self.app_module.make_id("update"),
                    "site_id": self.site_id,
                    "base_model_version_id": base_model["version_id"],
                    "architecture": base_model["architecture"],
                    "upload_type": "weight delta",
                    "execution_device": "cpu",
                    "artifact_path": str(delta_path),
                    "n_cases": 1,
                    "created_at": f"2026-03-11T00:5{index}:00+00:00",
                    "status": "approved",
                }
            )

        aggregation_response = self.client.post(
            "/api/admin/aggregations/run",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={},
        )
        self.assertEqual(aggregation_response.status_code, 400, aggregation_response.text)
        self.assertIn("Only one approved update per site can be aggregated at a time.", aggregation_response.text)

    def test_model_version_delete_soft_delete_rules_http(self):
        admin_token = self._login("admin", "admin123")
        archived_candidate = self.cp.ensure_model_version(
            {
                "version_id": self.app_module.make_id("model"),
                "version_name": "global-delete-me",
                "architecture": "convnext_tiny",
                "stage": "global",
                "created_at": "2026-03-12T00:00:00+00:00",
                "ready": True,
                "is_current": False,
            }
        )

        delete_response = self.client.delete(
            f"/api/admin/model-versions/{archived_candidate['version_id']}",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        self.assertEqual(delete_response.status_code, 200, delete_response.text)
        self.assertTrue(delete_response.json()["model_version"]["archived"])
        visible_versions = self.client.get(
            "/api/admin/model-versions",
            headers={"Authorization": f"Bearer {admin_token}"},
        ).json()
        self.assertNotIn(archived_candidate["version_id"], [item["version_id"] for item in visible_versions])

        current_model = self.cp.current_global_model()
        current_delete_response = self.client.delete(
            f"/api/admin/model-versions/{current_model['version_id']}",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        self.assertEqual(current_delete_response.status_code, 400, current_delete_response.text)

    def test_model_version_publish_registers_download_url_http(self):
        self.client.close()
        self.db_module.CONTROL_PLANE_ENGINE.dispose()
        self.db_module.DATA_PLANE_ENGINE.dispose()
        self.app_module = reload_app_module(
            Path(self.tempdir.name) / "publish_test.db",
            control_plane_artifact_dir=self.control_plane_artifact_dir,
            model_distribution_mode="download_url",
        )
        self.db_module = sys.modules["kera_research.db"]
        self.cp = self.app_module.ControlPlaneStore()
        project = self.cp.create_project("HTTP Publish Project", "test", "user_admin")
        self.site_id = f"HTTP_{self.app_module.make_id('site')[-6:].upper()}"
        self.cp.create_site(project["project_id"], self.site_id, "HTTP Test Site", "HTTP Hospital")
        self.site_store = self.app_module.SiteStore(self.site_id)
        from fastapi.testclient import TestClient

        self.client = TestClient(self.app_module.create_app())
        admin_token = self._login("admin", "admin123")
        checkpoint_path = Path(self.tempdir.name) / "publishable_model.pth"
        checkpoint_path.write_bytes(b"fake-model-checkpoint")
        pending_version = self.cp.ensure_model_version(
            {
                "version_id": self.app_module.make_id("model"),
                "version_name": "global-pending-publish",
                "architecture": "convnext_tiny",
                "stage": "global",
                "model_path": str(checkpoint_path),
                "created_at": "2026-03-17T00:00:00+00:00",
                "publish_required": True,
                "ready": True,
                "is_current": True,
            }
        )
        self.assertEqual(pending_version["distribution_status"], "pending_upload")
        self.assertFalse(pending_version["ready"])

        response = self.client.post(
            f"/api/admin/model-versions/{pending_version['version_id']}/publish",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "download_url": "https://example.com/global-pending-publish.pt",
                "set_current": True,
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()["model_version"]
        self.assertEqual(payload["distribution_status"], "published")
        self.assertEqual(payload["download_url"], "https://example.com/global-pending-publish.pt")
        self.assertTrue(payload["ready"])
        self.assertTrue(payload["is_current"])
        self.assertEqual(payload["source_provider"], "http_download")

    def test_model_update_publish_registers_download_url_http(self):
        admin_token = self._login("admin", "admin123")
        delta_path = Path(self.tempdir.name) / "publishable_delta.pth"
        delta_path.write_bytes(b"fake-delta")
        update = self.cp.register_model_update(
            {
                "update_id": self.app_module.make_id("update"),
                "site_id": self.site_id,
                "base_model_version_id": self.cp.current_global_model()["version_id"],
                "architecture": "densenet121",
                "upload_type": "weight delta",
                "execution_device": "cpu",
                "artifact_path": str(delta_path),
                "n_cases": 1,
                "created_at": "2026-03-17T00:00:00+00:00",
                "status": "pending_review",
            }
        )
        self.assertTrue(str(update.get("central_artifact_key") or "").startswith("model_updates/"))
        self.assertEqual(update["artifact_distribution_status"], "local_only")

        response = self.client.post(
            f"/api/admin/model-updates/{update['update_id']}/publish",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"download_url": "https://example.com/delta/update.pth"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()["update"]
        self.assertEqual(payload["artifact_distribution_status"], "published")
        self.assertEqual(payload["artifact_download_url"], "https://example.com/delta/update.pth")
        self.assertEqual(payload["artifact_source_provider"], "http_download")
        self.assertTrue(str(payload.get("central_artifact_key") or "").startswith("model_updates/"))

    def test_model_version_auto_publish_uses_onedrive_metadata_http(self):
        admin_token = self._login("admin", "admin123")
        checkpoint_path = Path(self.tempdir.name) / "autopublish_model.pth"
        checkpoint_path.write_bytes(b"auto-model-checkpoint")
        pending_version = self.cp.ensure_model_version(
            {
                "version_id": self.app_module.make_id("model"),
                "version_name": "global-auto-publish",
                "architecture": "convnext_tiny",
                "stage": "global",
                "model_path": str(checkpoint_path),
                "created_at": "2026-03-17T00:00:00+00:00",
                "publish_required": True,
                "ready": True,
                "is_current": False,
            }
        )

        fake_publisher = Mock()
        fake_publisher.publish_local_file.return_value = {
            "download_url": "https://sharepoint.example/model/global-auto-publish",
            "source_provider": "onedrive_sharepoint",
            "distribution_status": "published",
            "filename": checkpoint_path.name,
            "size_bytes": checkpoint_path.stat().st_size,
            "sha256": self.cp._sha256_file(checkpoint_path),
            "onedrive_drive_id": "drive_auto",
            "onedrive_item_id": "item_auto",
            "onedrive_remote_path": "KERA/model_versions__global_auto_publish__autopublish_model.pth",
            "onedrive_web_url": "https://sharepoint.example/model/global-auto-publish/view",
            "onedrive_share_url": "https://sharepoint.example/model/global-auto-publish/share",
            "onedrive_share_scope": "organization",
            "onedrive_share_type": "view",
            "onedrive_share_error": "",
        }

        with patch("kera_research.api.routes.admin.OneDrivePublisher", return_value=fake_publisher):
            response = self.client.post(
                f"/api/admin/model-versions/{pending_version['version_id']}/auto-publish",
                headers={"Authorization": f"Bearer {admin_token}"},
                json={"set_current": True},
            )

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()["model_version"]
        self.assertEqual(payload["distribution_status"], "published")
        self.assertEqual(payload["download_url"], "https://sharepoint.example/model/global-auto-publish")
        self.assertEqual(payload["source_provider"], "onedrive_sharepoint")
        self.assertTrue(payload["ready"])
        self.assertTrue(payload["is_current"])
        self.assertEqual(payload["onedrive_item_id"], "item_auto")
        self.assertEqual(payload["onedrive_drive_id"], "drive_auto")

    def test_model_update_auto_publish_uses_onedrive_metadata_http(self):
        admin_token = self._login("admin", "admin123")
        delta_path = Path(self.tempdir.name) / "autopublish_delta.pth"
        delta_path.write_bytes(b"auto-delta")
        update = self.cp.register_model_update(
            {
                "update_id": self.app_module.make_id("update"),
                "site_id": self.site_id,
                "base_model_version_id": self.cp.current_global_model()["version_id"],
                "architecture": "densenet121",
                "upload_type": "weight delta",
                "execution_device": "cpu",
                "artifact_path": str(delta_path),
                "n_cases": 1,
                "created_at": "2026-03-17T00:00:00+00:00",
                "status": "pending_review",
            }
        )

        fake_publisher = Mock()
        fake_publisher.publish_local_file.return_value = {
            "download_url": "https://sharepoint.example/delta/update-auto",
            "source_provider": "onedrive_sharepoint",
            "distribution_status": "published",
            "filename": "delta.pth",
            "size_bytes": delta_path.stat().st_size,
            "sha256": self.cp._sha256_file(delta_path),
            "onedrive_drive_id": "drive_delta",
            "onedrive_item_id": "item_delta",
            "onedrive_remote_path": "KERA/model_updates__update_auto__delta.pth",
            "onedrive_web_url": "https://sharepoint.example/delta/update-auto/view",
            "onedrive_share_url": "https://sharepoint.example/delta/update-auto/share",
            "onedrive_share_scope": "organization",
            "onedrive_share_type": "view",
            "onedrive_share_error": "",
        }

        with patch("kera_research.api.routes.admin.OneDrivePublisher", return_value=fake_publisher):
            response = self.client.post(
                f"/api/admin/model-updates/{update['update_id']}/auto-publish",
                headers={"Authorization": f"Bearer {admin_token}"},
            )

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()["update"]
        self.assertEqual(payload["artifact_distribution_status"], "published")
        self.assertEqual(payload["artifact_download_url"], "https://sharepoint.example/delta/update-auto")
        self.assertEqual(payload["artifact_source_provider"], "onedrive_sharepoint")
        self.assertEqual(payload["onedrive_item_id"], "item_delta")
        self.assertEqual(payload["onedrive_drive_id"], "drive_delta")

    def test_access_request_review_http(self):
        requester_token = self._token_for_username("http_viewer")
        access_response = self.client.post(
            "/api/auth/request-access",
            headers={"Authorization": f"Bearer {requester_token}"},
            json={"requested_site_id": self.site_id, "requested_role": "researcher", "message": "Need site access"},
        )
        self.assertEqual(access_response.status_code, 200, access_response.text)

        admin_token = self._login("admin", "admin123")
        queue_response = self.client.get("/api/admin/access-requests?status_filter=pending", headers={"Authorization": f"Bearer {admin_token}"})
        self.assertEqual(queue_response.status_code, 200, queue_response.text)
        self.assertEqual(len(queue_response.json()), 1)
        request_id = queue_response.json()[0]["request_id"]

        review_response = self.client.post(
            f"/api/admin/access-requests/{request_id}/review",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"decision": "approved", "assigned_role": "researcher", "assigned_site_id": self.site_id, "reviewer_notes": "approved"},
        )
        self.assertEqual(review_response.status_code, 200, review_response.text)
        refreshed_user = self.cp.get_user_by_id(self.requester["user_id"])
        self.assertIn(self.site_id, refreshed_user["site_ids"] or [])

    def test_public_institution_search_and_access_request_http(self):
        self.cp.upsert_institutions(
            [
                {
                    "institution_id": "HIRA_EYE_001",
                    "name": "Kim Eye Clinic",
                    "institution_type_code": "31",
                    "institution_type_name": "Clinic",
                    "address": "Seoul Gangnam-gu",
                    "phone": "02-123-4567",
                    "sido_code": "11",
                    "sggu_code": "680",
                    "ophthalmology_available": True,
                    "open_status": "active",
                    "source_payload": {"ykiho": "HIRA_EYE_001"},
                }
            ]
        )

        search_response = self.client.get("/api/public/institutions/search?q=Kim")
        self.assertEqual(search_response.status_code, 200, search_response.text)
        search_payload = search_response.json()
        self.assertEqual(len(search_payload), 1)
        self.assertEqual(search_payload[0]["institution_id"], "HIRA_EYE_001")

        requester_token = self._token_for_username("http_viewer")
        access_response = self.client.post(
            "/api/auth/request-access",
            headers={"Authorization": f"Bearer {requester_token}"},
            json={
                "requested_site_id": "HIRA_EYE_001",
                "requested_site_label": "Kim Eye Clinic",
                "requested_role": "researcher",
                "message": "Need ophthalmology directory onboarding",
            },
        )
        self.assertEqual(access_response.status_code, 200, access_response.text)
        request_payload = access_response.json()["request"]
        self.assertEqual(request_payload["requested_site_id"], "HIRA_EYE_001")
        self.assertEqual(request_payload["requested_site_label"], "Kim Eye Clinic")
        self.assertEqual(request_payload["requested_site_source"], "institution_directory")

    def test_public_institution_search_matches_korean_and_english_region_aliases_http(self):
        self.cp.upsert_institutions(
            [
                {
                    "institution_id": "HIRA_EYE_003",
                    "name": "제주대학교병원",
                    "institution_type_code": "11",
                    "institution_type_name": "Tertiary hospital",
                    "address": "제주특별자치도 제주시 아란13길 15",
                    "phone": "064-717-1114",
                    "sido_code": "50",
                    "sggu_code": "500",
                    "ophthalmology_available": True,
                    "open_status": "active",
                    "source_payload": {"ykiho": "HIRA_EYE_003"},
                }
            ]
        )

        korean_response = self.client.get("/api/public/institutions/search?q=제주")
        self.assertEqual(korean_response.status_code, 200, korean_response.text)
        self.assertEqual(len(korean_response.json()), 1)
        self.assertEqual(korean_response.json()[0]["institution_id"], "HIRA_EYE_003")

        english_response = self.client.get("/api/public/institutions/search?q=Jeju university hospital")
        self.assertEqual(english_response.status_code, 200, english_response.text)
        self.assertEqual(len(english_response.json()), 1)
        self.assertEqual(english_response.json()[0]["institution_id"], "HIRA_EYE_003")

    def test_public_institution_search_prioritizes_name_matches_over_address_only_matches_http(self):
        self.cp.upsert_institutions(
            [
                {
                    "institution_id": "HIRA_EYE_010",
                    "name": "가톨릭안과의원",
                    "institution_type_code": "31",
                    "institution_type_name": "Clinic",
                    "address": "제주특별자치도 제주시 도령로 1",
                    "phone": "064-000-0001",
                    "sido_code": "50",
                    "sggu_code": "500",
                    "ophthalmology_available": True,
                    "open_status": "active",
                    "source_payload": {"ykiho": "HIRA_EYE_010"},
                },
                {
                    "institution_id": "HIRA_EYE_011",
                    "name": "제주대학교병원",
                    "institution_type_code": "11",
                    "institution_type_name": "Tertiary hospital",
                    "address": "제주특별자치도 제주시 아란13길 15",
                    "phone": "064-717-1114",
                    "sido_code": "50",
                    "sggu_code": "500",
                    "ophthalmology_available": True,
                    "open_status": "active",
                    "source_payload": {"ykiho": "HIRA_EYE_011"},
                },
            ]
        )

        response = self.client.get("/api/public/institutions/search?q=제주&limit=1")
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(len(payload), 1)
        self.assertEqual(payload[0]["institution_id"], "HIRA_EYE_011")

    def test_access_request_review_can_create_site_from_institution_request_http(self):
        self.cp.upsert_institutions(
            [
                {
                    "institution_id": "HIRA_EYE_002",
                    "name": "Park Eye Hospital",
                    "institution_type_code": "31",
                    "institution_type_name": "Clinic",
                    "address": "Busan Haeundae-gu",
                    "phone": "051-123-4567",
                    "sido_code": "26",
                    "sggu_code": "710",
                    "ophthalmology_available": True,
                    "open_status": "active",
                    "source_payload": {"ykiho": "HIRA_EYE_002"},
                }
            ]
        )

        requester_token = self._token_for_username("http_viewer")
        access_response = self.client.post(
            "/api/auth/request-access",
            headers={"Authorization": f"Bearer {requester_token}"},
            json={
                "requested_site_id": "HIRA_EYE_002",
                "requested_site_label": "Park Eye Hospital",
                "requested_role": "site_admin",
                "message": "Need a new institution site",
            },
        )
        self.assertEqual(access_response.status_code, 200, access_response.text)

        admin_token = self._login("admin", "admin123")
        queue_response = self.client.get("/api/admin/access-requests?status_filter=pending", headers={"Authorization": f"Bearer {admin_token}"})
        self.assertEqual(queue_response.status_code, 200, queue_response.text)
        matching_request = next(item for item in queue_response.json() if item["requested_site_id"] == "HIRA_EYE_002")
        self.assertEqual(matching_request["requested_site_source"], "institution_directory")
        self.assertIsNone(matching_request["resolved_site_id"])

        project_id = self.cp.list_projects()[0]["project_id"]
        review_response = self.client.post(
            f"/api/admin/access-requests/{matching_request['request_id']}/review",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "decision": "approved",
                "assigned_role": "site_admin",
                "create_site_if_missing": True,
                "project_id": project_id,
                "site_code": "HIRA_PARK_EYE",
                "display_name": "Park Eye Hospital",
                "hospital_name": "Park Eye Hospital",
                "research_registry_enabled": False,
                "reviewer_notes": "created during approval",
            },
        )
        self.assertEqual(review_response.status_code, 200, review_response.text)
        review_payload = review_response.json()
        self.assertEqual(review_payload["request"]["status"], "approved")
        self.assertEqual(review_payload["request"]["requested_site_id"], "HIRA_PARK_EYE")
        self.assertEqual(review_payload["request"]["resolved_site_id"], "HIRA_PARK_EYE")
        self.assertIsNotNone(review_payload["created_site"])
        self.assertEqual(review_payload["created_site"]["site_id"], "HIRA_PARK_EYE")
        self.assertEqual(review_payload["created_site"]["source_institution_id"], "HIRA_EYE_002")
        self.assertFalse(review_payload["created_site"]["research_registry_enabled"])

        refreshed_user = self.cp.get_user_by_id(self.requester["user_id"])
        self.assertIn("HIRA_PARK_EYE", refreshed_user["site_ids"] or [])
        created_site = self.cp.get_site("HIRA_PARK_EYE")
        self.assertIsNotNone(created_site)
        self.assertEqual(created_site["source_institution_id"], "HIRA_EYE_002")
        self.assertFalse(created_site["research_registry_enabled"])

    def test_platform_admin_can_sync_institution_directory_http(self):
        admin_token = self._login("admin", "admin123")
        site_admin_token = self._token_for_username("http_site_admin")

        with patch.object(
            self.app_module.ControlPlaneStore,
            "sync_hira_ophthalmology_directory",
            return_value={
                "source": "hira",
                "pages_synced": 2,
                "total_count": 128,
                "institutions_synced": 128,
            },
        ) as sync_mock:
            response = self.client.post(
                "/api/admin/institutions/sync?page_size=75&max_pages=2",
                headers={"Authorization": f"Bearer {admin_token}"},
            )
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["source"], "hira")
            self.assertEqual(response.json()["pages_synced"], 2)
            self.assertEqual(response.json()["institutions_synced"], 128)
            sync_mock.assert_called_once_with(page_size=75, max_pages=2)

            forbidden_response = self.client.post(
                "/api/admin/institutions/sync",
                headers={"Authorization": f"Bearer {site_admin_token}"},
            )
            self.assertEqual(forbidden_response.status_code, 403, forbidden_response.text)
            self.assertEqual(sync_mock.call_count, 1)

    def test_admin_workspace_can_read_institution_directory_sync_status_http(self):
        self.cp.upsert_institutions(
            [
                {
                    "institution_id": "HIRA_EYE_STATUS_001",
                    "name": "Status Eye Clinic",
                    "institution_type_code": "31",
                    "institution_type_name": "Clinic",
                    "address": "Seoul",
                    "phone": "02-000-0000",
                    "sido_code": "11",
                    "sggu_code": "110",
                    "ophthalmology_available": True,
                    "open_status": "active",
                    "source_payload": {"ykiho": "HIRA_EYE_STATUS_001"},
                    "synced_at": "2026-03-17T00:00:00+00:00",
                }
            ]
        )

        admin_token = self._login("admin", "admin123")
        site_admin_token = self._token_for_username("http_site_admin")

        admin_response = self.client.get(
            "/api/admin/institutions/status",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        self.assertEqual(admin_response.status_code, 200, admin_response.text)
        self.assertEqual(admin_response.json()["institutions_synced"], 1)
        self.assertEqual(admin_response.json()["synced_at"], "2026-03-17T00:00:00+00:00")

        site_admin_response = self.client.get(
            "/api/admin/institutions/status",
            headers={"Authorization": f"Bearer {site_admin_token}"},
        )
        self.assertEqual(site_admin_response.status_code, 200, site_admin_response.text)
        self.assertEqual(site_admin_response.json()["institutions_synced"], 1)

    def test_management_bulk_import_and_dashboard_http(self):
        admin_token = self._login("admin", "admin123")

        projects_response = self.client.get("/api/admin/projects", headers={"Authorization": f"Bearer {admin_token}"})
        self.assertEqual(projects_response.status_code, 200, projects_response.text)

        create_project_response = self.client.post(
          "/api/admin/projects",
          headers={"Authorization": f"Bearer {admin_token}"},
          json={"name": "Ops Project", "description": "ops"},
        )
        self.assertEqual(create_project_response.status_code, 200, create_project_response.text)
        project_id = create_project_response.json()["project_id"]

        create_site_response = self.client.post(
            "/api/admin/sites",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "project_id": project_id,
                "site_code": "OPS_HTTP",
                "display_name": "Ops HTTP Site",
                "hospital_name": "Ops Hospital",
            },
        )
        self.assertEqual(create_site_response.status_code, 200, create_site_response.text)

        update_site_response = self.client.patch(
            "/api/admin/sites/OPS_HTTP",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "display_name": "Ops HTTP Site Updated",
                "hospital_name": "Ops Hospital Updated",
            },
        )
        self.assertEqual(update_site_response.status_code, 200, update_site_response.text)
        self.assertEqual(update_site_response.json()["display_name"], "Ops HTTP Site Updated")
        self.assertEqual(update_site_response.json()["hospital_name"], "Ops Hospital Updated")

        create_user_response = self.client.post(
            "/api/admin/users",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "username": "ops_researcher",
                "full_name": "Ops Researcher",
                "password": "ops123",
                "role": "researcher",
                "site_ids": ["OPS_HTTP"],
            },
        )
        self.assertEqual(create_user_response.status_code, 200, create_user_response.text)
        users_response = self.client.get("/api/admin/users", headers={"Authorization": f"Bearer {admin_token}"})
        self.assertEqual(users_response.status_code, 200, users_response.text)
        self.assertTrue(any(item["username"] == "ops_researcher" for item in users_response.json()))

        template_response = self.client.get(
            "/api/sites/OPS_HTTP/import/template.csv",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        self.assertEqual(template_response.status_code, 200, template_response.text)
        self.assertIn("patient_id", template_response.text)

        csv_content = (
            "patient_id,chart_alias,local_case_code,sex,age,visit_date,actual_visit_date,culture_confirmed,culture_category,culture_species,"
            "contact_lens_use,predisposing_factor,visit_status,active_stage,smear_result,polymicrobial,other_history,image_filename,view,is_representative\n"
            "OPS-001,OPS-001,CASE-001,female,54,Initial,2026-03-11,TRUE,bacterial,Pseudomonas aeruginosa,none,trauma,active,TRUE,positive,FALSE,,ops_001_white.jpg,white,TRUE\n"
            "OPS-002,OPS-002,CASE-002,male,63,FU #1,2026-03-12,TRUE,bacterial,Staphylococcus aureus,none,trauma,active,TRUE,negative,FALSE,,ops_002_slit.jpg,slit,TRUE\n"
        ).encode("utf-8")
        archive_buffer = io.BytesIO()
        with zipfile.ZipFile(archive_buffer, "w") as archive:
            archive.writestr("ops_001_white.jpg", self._make_test_image_bytes("JPEG", (180, 70, 40)))
            archive.writestr("ops_002_slit.jpg", self._make_test_image_bytes("JPEG", (40, 120, 180)))

        import_response = self.client.post(
            "/api/sites/OPS_HTTP/import/bulk",
            headers={"Authorization": f"Bearer {admin_token}"},
            files=[
                ("csv_file", ("ops_import.csv", csv_content, "text/csv")),
                ("files", ("ops_images.zip", archive_buffer.getvalue(), "application/zip")),
            ],
        )
        self.assertEqual(import_response.status_code, 200, import_response.text)
        import_payload = import_response.json()
        self.assertEqual(import_payload["created_patients"], 2)
        self.assertEqual(import_payload["imported_images"], 2)

        fake_workflow = FakeWorkflow(self.app_module, self.cp)
        with patch.object(self.app_module, "_get_workflow", return_value=fake_workflow):
            validation_response = self.client.post(
                "/api/sites/OPS_HTTP/validations/run",
                headers={"Authorization": f"Bearer {admin_token}"},
                json={"execution_mode": "cpu"},
            )
            self.assertEqual(validation_response.status_code, 200, validation_response.text)
            validation_job_id = validation_response.json()["job"]["job_id"]
            self._run_site_jobs(workflow=fake_workflow, max_jobs=1, site_id="OPS_HTTP")

        job_response = self.client.get(
            f"/api/sites/OPS_HTTP/jobs/{validation_job_id}",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        self.assertEqual(job_response.status_code, 200, job_response.text)
        job_payload = job_response.json()
        self.assertEqual(job_payload["status"], "completed", job_response.text)
        validation_id = job_payload["result"]["response"]["summary"]["validation_id"]

        cases_response = self.client.get(
            f"/api/sites/OPS_HTTP/validations/{validation_id}/cases?misclassified_only=true&limit=4",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        self.assertEqual(cases_response.status_code, 200, cases_response.text)
        case_rows = cases_response.json()
        self.assertEqual(len(case_rows), 1)
        self.assertFalse(case_rows[0]["is_correct"])
        self.assertTrue(case_rows[0]["gradcam_available"])

        comparison_response = self.client.get(
            "/api/admin/site-comparison",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        self.assertEqual(comparison_response.status_code, 200, comparison_response.text)
        self.assertTrue(any(item["site_id"] == "OPS_HTTP" for item in comparison_response.json()))

    def test_site_admin_can_manage_storage_settings_and_empty_site_root(self):
        site_admin_token = self._token_for_username("http_site_admin")
        temp_storage_root = Path(self.tempdir.name) / "instance-storage-root"
        site_storage_root = temp_storage_root / self.site_id

        settings_response = self.client.get(
            "/api/admin/storage-settings",
            headers={"Authorization": f"Bearer {site_admin_token}"},
        )
        self.assertEqual(settings_response.status_code, 200, settings_response.text)

        update_settings_response = self.client.patch(
            "/api/admin/storage-settings",
            headers={"Authorization": f"Bearer {site_admin_token}"},
            json={"storage_root": str(temp_storage_root)},
        )
        self.assertEqual(update_settings_response.status_code, 200, update_settings_response.text)
        self.assertEqual(update_settings_response.json()["storage_root"], str(temp_storage_root.resolve()))

        update_site_root_response = self.client.patch(
            f"/api/admin/sites/{self.site_id}/storage-root",
            headers={"Authorization": f"Bearer {site_admin_token}"},
            json={"storage_root": str(site_storage_root)},
        )
        self.assertEqual(update_site_root_response.status_code, 200, update_site_root_response.text)
        self.assertEqual(update_site_root_response.json()["local_storage_root"], str(site_storage_root.resolve()))

        self._seed_case(site_admin_token)
        blocked_response = self.client.patch(
            f"/api/admin/sites/{self.site_id}/storage-root",
            headers={"Authorization": f"Bearer {site_admin_token}"},
            json={"storage_root": str(site_storage_root.parent / 'second-root')},
        )
        self.assertEqual(blocked_response.status_code, 400, blocked_response.text)
        self.assertIn("Storage root can only be changed", blocked_response.json()["detail"])

    def test_site_storage_root_migration_rewrites_existing_paths(self):
        site_admin_token = self._token_for_username("http_site_admin")
        original_root = Path(self.tempdir.name) / "site-original-root" / self.site_id
        migrated_root = Path(self.tempdir.name) / "site-migrated-root" / self.site_id

        prepare_root_response = self.client.patch(
            f"/api/admin/sites/{self.site_id}/storage-root",
            headers={"Authorization": f"Bearer {site_admin_token}"},
            json={"storage_root": str(original_root)},
        )
        self.assertEqual(prepare_root_response.status_code, 200, prepare_root_response.text)

        self._seed_case(site_admin_token)

        fake_workflow = FakeWorkflow(self.app_module, self.cp)
        with patch.object(self.app_module, "_get_workflow", return_value=fake_workflow):
            validation_response = self.client.post(
                f"/api/sites/{self.site_id}/cases/validate",
                headers={"Authorization": f"Bearer {site_admin_token}"},
                json={"patient_id": "HTTP-001", "visit_date": "Initial", "execution_mode": "cpu"},
            )
            self.assertEqual(validation_response.status_code, 200, validation_response.text)
            validation_id = validation_response.json()["summary"]["validation_id"]

        predictions_before = self.cp.load_case_predictions(validation_id)
        self.assertTrue(str(predictions_before[0]["roi_crop_path"]).startswith(str(original_root.resolve())))

        migrate_response = self.client.post(
            f"/api/admin/sites/{self.site_id}/storage-root/migrate",
            headers={"Authorization": f"Bearer {site_admin_token}"},
            json={"storage_root": str(migrated_root)},
        )
        self.assertEqual(migrate_response.status_code, 200, migrate_response.text)
        self.assertEqual(migrate_response.json()["local_storage_root"], str(migrated_root.resolve()))

        predictions_after = self.cp.load_case_predictions(validation_id)
        self.assertTrue(str(predictions_after[0]["roi_crop_path"]).startswith(str(migrated_root.resolve())))
        self.assertFalse(original_root.exists())
        self.assertTrue(migrated_root.exists())

        artifact_response = self.client.get(
            f"/api/sites/{self.site_id}/validations/{validation_id}/artifacts/roi_crop?patient_id=HTTP-001&visit_date=Initial",
            headers={"Authorization": f"Bearer {site_admin_token}"},
        )
        self.assertEqual(artifact_response.status_code, 200, artifact_response.text)


if __name__ == "__main__":
    unittest.main()
