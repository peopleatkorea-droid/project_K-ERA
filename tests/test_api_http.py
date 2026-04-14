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
import threading
import time
import unittest
import zipfile
from pathlib import Path
from typing import Any
from unittest.mock import Mock, patch

import jwt
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
    control_plane_api_base_url: str | None = None,
    extra_env: dict[str, str] | None = None,
):
    for env_name in (
        "KERA_DATABASE_URL",
        "DATABASE_URL",
        "KERA_CONTROL_PLANE_DATABASE_URL",
        "KERA_AUTH_DATABASE_URL",
        "KERA_DATA_PLANE_DATABASE_URL",
        "KERA_LOCAL_DATABASE_URL",
        "KERA_LOCAL_CONTROL_PLANE_DATABASE_URL",
        "KERA_CONTROL_PLANE_LOCAL_DATABASE_URL",
        "KERA_CONTROL_PLANE_API_BASE_URL",
        "NEXT_PUBLIC_KERA_CONTROL_PLANE_API_BASE_URL",
        "KERA_STORAGE_DIR",
        "KERA_STORAGE_STATE_FILE",
        "KERA_CONTROL_PLANE_DIR",
        "KERA_CONTROL_PLANE_ARTIFACT_DIR",
        "KERA_MODEL_DIR",
        "KERA_CASE_REFERENCE_SALT",
        "KERA_PATIENT_REFERENCE_SALT",
        "KERA_DISABLE_CASE_EMBEDDING_REFRESH",
        "KERA_DISABLE_FEDERATED_RETRIEVAL_AUTO_SYNC",
        "KERA_MODEL_DISTRIBUTION_MODE",
        "KERA_RUNTIME_OWNER",
        "KERA_ONEDRIVE_TENANT_ID",
        "KERA_ONEDRIVE_CLIENT_ID",
        "KERA_ONEDRIVE_CLIENT_SECRET",
        "KERA_ONEDRIVE_DRIVE_ID",
        "KERA_ONEDRIVE_ROOT_PATH",
        "KERA_ONEDRIVE_SHARE_SCOPE",
        "KERA_ONEDRIVE_SHARE_TYPE",
        "KERA_SITE_STORAGE_SOURCE",
        "KERA_SKIP_LOCAL_ENV_FILE",
        "KERA_SENTRY_DSN",
        "SENTRY_DSN",
        "KERA_SENTRY_ENVIRONMENT",
        "SENTRY_ENVIRONMENT",
        "KERA_SENTRY_TRACES_SAMPLE_RATE",
        "KERA_SENTRY_PROFILES_SAMPLE_RATE",
        "KERA_SENTRY_SEND_DEFAULT_PII",
        "KERA_TRUST_PROXY_HEADERS",
        "KERA_TRUSTED_PROXY_IPS",
        "KERA_TRUSTED_PROXY_CIDRS",
        "KERA_CORS_ALLOWED_ORIGINS",
        "KERA_FEDERATED_UPDATE_SIGNING_SECRET",
        "KERA_FEDERATED_UPDATE_SIGNING_KEY_ID",
        "KERA_REQUIRE_SIGNED_FEDERATED_UPDATES",
        "KERA_FEDERATED_AGGREGATION_STRATEGY",
        "KERA_FEDERATED_AGGREGATION_TRIM_RATIO",
        "KERA_FEDERATED_DELTA_CLIP_NORM",
        "KERA_FEDERATED_DELTA_NOISE_MULTIPLIER",
        "KERA_FEDERATED_DELTA_QUANTIZATION_BITS",
        "KERA_REQUIRE_FORMAL_DP_ACCOUNTING",
        "KERA_ACKNOWLEDGE_NON_DP_FEDERATED_TRAINING",
        "KERA_ALLOW_LEGACY_SINGLE_DB_FALLBACK",
        "KERA_ENVIRONMENT",
        "KERA_ENV",
        "ENVIRONMENT",
        "APP_ENV",
        "NODE_ENV",
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
    state_anchor = db_path or control_plane_db_path or data_plane_db_path or control_plane_artifact_dir
    if state_anchor is not None:
        os.environ["KERA_CONTROL_PLANE_DIR"] = str(Path(state_anchor).resolve().parent / "control_plane")
        storage_state_file = Path(state_anchor).resolve().parent / "storage_dir_state.txt"
        os.environ["KERA_STORAGE_STATE_FILE"] = str(storage_state_file)
        storage_state_file.unlink(missing_ok=True)

    os.environ["KERA_API_SECRET"] = "test-secret-with-32-bytes-minimum!!"
    os.environ["KERA_CASE_REFERENCE_SALT"] = "test-case-reference-salt"
    os.environ["KERA_PATIENT_REFERENCE_SALT"] = "test-patient-reference-salt"
    os.environ["KERA_DISABLE_CASE_EMBEDDING_REFRESH"] = "true"
    os.environ["KERA_SKIP_LOCAL_ENV_FILE"] = "1"
    if model_distribution_mode is not None:
        os.environ["KERA_MODEL_DISTRIBUTION_MODE"] = model_distribution_mode
    if control_plane_api_base_url is not None:
        os.environ["KERA_CONTROL_PLANE_API_BASE_URL"] = control_plane_api_base_url
    os.environ["KERA_ADMIN_USERNAME"] = "admin"
    os.environ["KERA_ADMIN_PASSWORD"] = "admin123"
    os.environ["KERA_RESEARCHER_USERNAME"] = "researcher"
    os.environ["KERA_RESEARCHER_PASSWORD"] = "research123"
    for env_name, value in (extra_env or {}).items():
        os.environ[str(env_name)] = str(value)
    for module_name in list(sys.modules):
        if module_name.startswith("kera_research"):
            del sys.modules[module_name]
    import kera_research.api.app as app_module

    return app_module


class FakeModelManager:
    def __init__(self) -> None:
        self.aggregate_calls: list[dict[str, object]] = []

    def aggregate_weight_deltas(
        self,
        delta_paths,
        output_path,
        weights=None,
        base_model_path=None,
        strategy=None,
        trim_ratio=None,
    ):
        self.aggregate_calls.append(
            {
                "delta_paths": list(delta_paths),
                "output_path": str(output_path),
                "weights": list(weights) if weights is not None else None,
                "base_model_path": base_model_path,
                "strategy": strategy,
                "trim_ratio": trim_ratio,
            }
        )
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        Path(output_path).write_bytes(b"aggregated")

    def resolve_model_path(self, model_reference, allow_download=True):
        return str(model_reference.get("model_path") or "")


class FakeWorkflow:
    def __init__(self, app_module, control_plane):
        self.app_module = app_module
        self.control_plane = control_plane
        self.model_manager = FakeModelManager()
        self.medsam_service = type("FakeMedSAMService", (), {"backend": "fake_medsam"})()

    def _lesion_prompt_box_signature(self, lesion_prompt_box):
        normalized = {
            key: round(float(lesion_prompt_box[key]), 6)
            for key in ("x0", "y0", "x1", "y1")
            if key in (lesion_prompt_box or {})
        }
        if len(normalized) != 4:
            return None
        payload = json.dumps(normalized, sort_keys=True, separators=(",", ":"))
        return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:12]

    def _write_roi_preview_artifacts(self, site_store, image):
        artifact_name = Path(str(image["image_path"])).stem
        mask_path = site_store.medsam_mask_dir / f"{artifact_name}_mask.png"
        crop_path = site_store.roi_crop_dir / f"{artifact_name}_crop.png"
        metadata_dir = site_store.artifact_dir / "roi_preview_meta"
        metadata_dir.mkdir(parents=True, exist_ok=True)
        metadata_path = metadata_dir / f"{artifact_name}.json"
        mask_path.write_bytes(b"roi-mask")
        crop_path.write_bytes(b"roi-crop")
        metadata_path.write_text(
            json.dumps(
                {
                    "backend": self.medsam_service.backend,
                    "crop_style": "bbox_rgb_v1",
                    "medsam_error": None,
                }
            ),
            encoding="utf-8",
        )
        return {
            "medsam_mask_path": str(mask_path),
            "roi_crop_path": str(crop_path),
            "backend": self.medsam_service.backend,
        }

    def _write_lesion_preview_artifacts(self, site_store, image, *, lesion_prompt_box=None):
        effective_box = lesion_prompt_box if lesion_prompt_box is not None else image.get("lesion_prompt_box")
        artifact_name = Path(str(image["image_path"])).stem
        mask_path = site_store.lesion_mask_dir / f"{artifact_name}_mask.png"
        crop_path = site_store.lesion_crop_dir / f"{artifact_name}_crop.png"
        metadata_dir = site_store.artifact_dir / "lesion_preview_meta"
        metadata_dir.mkdir(parents=True, exist_ok=True)
        metadata_path = metadata_dir / f"{artifact_name}.json"
        prompt_signature = self._lesion_prompt_box_signature(effective_box)
        mask_path.write_bytes(b"mask")
        crop_path.write_bytes(b"crop")
        metadata_path.write_text(
            json.dumps(
                {
                    "backend": self.medsam_service.backend,
                    "crop_style": "soft_masked_bbox_v1",
                    "medsam_error": None,
                    "prompt_signature": prompt_signature,
                }
            ),
            encoding="utf-8",
        )
        return {
            "lesion_mask_path": str(mask_path),
            "lesion_crop_path": str(crop_path),
            "backend": self.medsam_service.backend,
            "medsam_error": None,
            "lesion_prompt_box": effective_box,
            "prompt_signature": prompt_signature,
        }

    def _ensure_roi_crop(self, site_store, image_path):
        image = next(
            (item for item in site_store.list_images() if str(item.get("image_path") or "") == str(image_path)),
            None,
        )
        if image is None:
            raise ValueError("Image not found.")
        return self._write_roi_preview_artifacts(site_store, image)

    def _ensure_lesion_crop(self, site_store, record, lesion_prompt_box=None):
        return self._write_lesion_preview_artifacts(
            site_store,
            record,
            lesion_prompt_box=lesion_prompt_box,
        )

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
        image_records = site_store.list_images_for_visit(patient_id, visit_date)
        representative_image = next((item for item in image_records if item.get("is_representative")), None) or image_records[0]
        roi_preview = self._write_roi_preview_artifacts(site_store, representative_image)
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
            "roi_crop_path": roi_preview["roi_crop_path"],
            "gradcam_path": str(gradcam_path),
            "medsam_mask_path": roi_preview["medsam_mask_path"],
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
        retrieval_profile="dinov2_lesion_crop",
    ):
        return {
            "patient_id": patient_id,
            "visit_date": visit_date,
            "model_version_id": model_version["version_id"],
            "model_version_name": model_version["version_name"],
            "retrieval_backend": retrieval_backend,
            "retrieval_profile": retrieval_profile,
            "execution_device": execution_device,
            "similar_cases": [],
            "ai_clinic_profile": {
                "profile_id": retrieval_profile,
                "requested_backend": retrieval_backend,
                "effective_retrieval_backend": retrieval_backend,
                "retrieval_profile_label": retrieval_profile,
            },
            "classification_context": {
                "validation_id": None,
                "model_version_id": model_version["version_id"],
            },
            "differential": [],
            "workflow_recommendation": None,
        }

    def run_ai_clinic_similar_cases(
        self,
        site_store,
        *,
        patient_id,
        visit_date,
        model_version,
        execution_device,
        top_k=3,
        retrieval_backend="hybrid",
        retrieval_profile="dinov2_lesion_crop",
    ):
        return {
            **self.run_ai_clinic_report(
                site_store,
                patient_id=patient_id,
                visit_date=visit_date,
                model_version=model_version,
                execution_device=execution_device,
                top_k=top_k,
                retrieval_backend=retrieval_backend,
                retrieval_profile=retrieval_profile,
            ),
            "similar_cases": [],
        }

    def run_case_postmortem(
        self,
        site_store,
        *,
        patient_id,
        visit_date,
        model_version,
        execution_device,
        classification_context=None,
        case_prediction=None,
        top_k=3,
        retrieval_backend="hybrid",
    ):
        is_correct = bool((classification_context or {}).get("is_correct"))
        return {
            "mode": "local_fallback",
            "model": None,
            "generated_at": "2026-03-11T00:00:01+00:00",
            "outcome": "correct" if is_correct else "incorrect",
            "summary": "The prediction aligned with the available evidence and was retained as a reference case."
            if is_correct
            else "The prediction missed the culture label and should be reviewed as a hard case.",
            "likely_causes": [
                "Classifier and retrieval signals were directionally aligned."
                if is_correct
                else "The classifier favored the wrong direction with insufficient margin."
            ],
            "supporting_evidence": ["Grad-CAM artifact is available for visual review."],
            "contradictory_evidence": [],
            "follow_up_actions": ["Review the saved artifacts before using the case for training."],
            "learning_signal": "retain_as_reference" if is_correct else "hard_case_priority",
            "uncertainty": "Limited",
            "disclaimer": "Research support only.",
            "structured_analysis": {
                "outcome": "correct" if is_correct else "incorrect",
                "prediction_confidence": 0.91 if is_correct else 0.82,
                "learning_signal": "retain_as_reference" if is_correct else "hard_case_priority",
                "root_cause_tags": [] if is_correct else ["natural_boundary"],
                "action_tags": [] if is_correct else ["human_review", "hard_case_train"],
                "scores": {
                    "cam_overlap_score": 0.71 if is_correct else 0.32,
                    "multi_model_disagreement": 0.18 if is_correct else 0.44,
                    "image_quality_score": 78.0,
                    "site_error_concentration": 0.12 if is_correct else 0.41,
                    "similar_case_count": 3,
                    "text_evidence_count": 2,
                },
                "peer_model_consensus": {
                    "models_evaluated": 3,
                    "models_requested": 3,
                    "leading_label": "bacterial" if is_correct else "fungal",
                    "agreement_rate": 0.82 if is_correct else 0.56,
                    "disagreement_score": 0.18 if is_correct else 0.44,
                    "vote_entropy": 0.21 if is_correct else 0.63,
                    "peer_predictions": [],
                },
                "prediction_snapshot": {
                    "predicted_label": "bacterial" if is_correct else "fungal",
                    "prediction_probability": 0.91 if is_correct else 0.82,
                    "predicted_confidence": 0.91 if is_correct else 0.82,
                    "crop_mode": "automated",
                    "representative_quality_score": 78.0,
                    "classifier_embedding": {"embedding_id": "classifier:model_http:abc123"},
                    "dinov2_embedding": {"embedding_id": "dinov2:model_http:def456"},
                    "peer_model_consensus": {
                        "models_evaluated": 3,
                        "models_requested": 3,
                        "leading_label": "bacterial" if is_correct else "fungal",
                        "agreement_rate": 0.82 if is_correct else 0.56,
                        "disagreement_score": 0.18 if is_correct else 0.44,
                        "vote_entropy": 0.21 if is_correct else 0.63,
                        "peer_predictions": [],
                    },
                },
            },
            "llm_error": None,
        }

    def contribute_case(
        self,
        site_store,
        patient_id,
        visit_date,
        model_version,
        execution_device,
        user_id,
        user_public_alias=None,
        contribution_group_id=None,
        registry_consent_granted=False,
    ):
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

    def run_image_level_federated_round(
        self,
        site_store,
        model_version,
        execution_device,
        epochs=1,
        learning_rate=5e-5,
        batch_size=8,
        progress_callback=None,
    ):
        if progress_callback:
            progress_callback(
                {
                    "stage": "training",
                    "message": "Running local ConvNeXt-Tiny image-level update.",
                    "percent": 50,
                    "epoch": 1,
                    "epochs": int(epochs),
                    "train_loss": 0.1234,
                }
            )
        delta_path = site_store.update_dir / f"{self.app_module.make_id('delta')}.pth"
        delta_path.parent.mkdir(parents=True, exist_ok=True)
        delta_path.write_bytes(b"delta")
        update = self.control_plane.register_model_update(
            {
                "update_id": self.app_module.make_id("update"),
                "site_id": site_store.site_id,
                "base_model_version_id": model_version["version_id"],
                "architecture": "convnext_tiny",
                "upload_type": "weight delta",
                "execution_device": execution_device,
                "artifact_path": str(delta_path),
                "n_cases": 2,
                "n_images": 5,
                "aggregation_weight": 5,
                "aggregation_weight_unit": "images",
                "federated_round_type": "image_level_site_round",
                "training_summary": {
                    "epochs": int(epochs),
                    "learning_rate": float(learning_rate),
                    "batch_size": int(batch_size),
                    "fine_tuning_mode": "full",
                },
                "approval_report": {
                    "case_summary": {
                        "eligible_case_count": 2,
                        "eligible_image_count": 5,
                        "is_single_case_delta": False,
                    }
                },
                "quality_summary": {"quality_score": 82},
                "status": "pending_review",
                "created_at": "2026-04-08T00:00:00+00:00",
            }
        )
        return {
            "site_id": site_store.site_id,
            "execution_device": execution_device,
            "model_version": {
                "version_id": model_version["version_id"],
                "version_name": model_version["version_name"],
                "architecture": model_version["architecture"],
            },
            "update": update,
            "eligible_case_count": 2,
            "eligible_image_count": 5,
            "skipped": {
                "not_positive": 0,
                "not_active": 0,
                "not_included": 0,
                "no_images": 0,
            },
        }

    def run_visit_level_federated_round(
        self,
        site_store,
        model_version,
        execution_device,
        epochs=1,
        learning_rate=5e-5,
        batch_size=4,
        progress_callback=None,
    ):
        if progress_callback:
            progress_callback(
                {
                    "stage": "training",
                    "message": "Running local EfficientNetV2-S MIL visit-level update.",
                    "percent": 50,
                    "epoch": 1,
                    "epochs": int(epochs),
                    "train_loss": 0.2345,
                }
            )
        delta_path = site_store.update_dir / f"{self.app_module.make_id('delta')}.pth"
        delta_path.parent.mkdir(parents=True, exist_ok=True)
        delta_path.write_bytes(b"delta")
        update = self.control_plane.register_model_update(
            {
                "update_id": self.app_module.make_id("update"),
                "site_id": site_store.site_id,
                "base_model_version_id": model_version["version_id"],
                "architecture": "efficientnet_v2_s_mil",
                "upload_type": "weight delta",
                "execution_device": execution_device,
                "artifact_path": str(delta_path),
                "n_cases": 2,
                "n_images": 5,
                "aggregation_weight": 2,
                "aggregation_weight_unit": "cases",
                "federated_round_type": "visit_level_site_round",
                "training_summary": {
                    "epochs": int(epochs),
                    "learning_rate": float(learning_rate),
                    "batch_size": int(batch_size),
                    "fine_tuning_mode": "full",
                    "bag_level": True,
                    "case_aggregation": "attention_mil",
                },
                "approval_report": {
                    "case_summary": {
                        "eligible_case_count": 2,
                        "eligible_image_count": 5,
                        "is_single_case_delta": False,
                    }
                },
                "quality_summary": {"quality_score": 83},
                "status": "pending_review",
                "created_at": "2026-04-08T00:00:00+00:00",
            }
        )
        return {
            "site_id": site_store.site_id,
            "execution_device": execution_device,
            "model_version": {
                "version_id": model_version["version_id"],
                "version_name": model_version["version_name"],
                "architecture": model_version["architecture"],
            },
            "update": update,
            "eligible_case_count": 2,
            "eligible_image_count": 5,
            "skipped": {
                "not_positive": 0,
                "not_active": 0,
                "not_included": 0,
                "no_images": 0,
            },
        }

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

    def preview_case_roi(self, site_store, patient_id, visit_date):
        previews = []
        for image in site_store.list_images_for_visit(patient_id, visit_date):
            roi = self._write_roi_preview_artifacts(site_store, image)
            previews.append(
                {
                    "patient_id": patient_id,
                    "visit_date": visit_date,
                    "view": image.get("view", "slit"),
                    "is_representative": bool(image.get("is_representative")),
                    "source_image_path": image["image_path"],
                    "medsam_mask_path": roi["medsam_mask_path"],
                    "roi_crop_path": roi["roi_crop_path"],
                    "backend": self.medsam_service.backend,
                }
            )
        return previews

    def preview_case_lesion(self, site_store, patient_id, visit_date):
        previews = []
        for image in site_store.list_images_for_visit(patient_id, visit_date):
            lesion_prompt_box = image.get("lesion_prompt_box")
            if not isinstance(lesion_prompt_box, dict):
                continue
            lesion = self._write_lesion_preview_artifacts(
                site_store,
                image,
                lesion_prompt_box=lesion_prompt_box,
            )
            previews.append(
                {
                    "patient_id": patient_id,
                    "visit_date": visit_date,
                    "view": image.get("view", "slit"),
                    "is_representative": bool(image.get("is_representative")),
                    "source_image_path": image["image_path"],
                    "lesion_mask_path": lesion["lesion_mask_path"],
                    "lesion_crop_path": lesion["lesion_crop_path"],
                    "backend": self.medsam_service.backend,
                    "medsam_error": None,
                    "lesion_prompt_box": lesion_prompt_box,
                    "prompt_signature": lesion["prompt_signature"],
                }
            )
        return previews

    def preview_image_lesion(self, site_store, image_id, *, lesion_prompt_box=None):
        image = site_store.get_image(image_id)
        if image is None:
            raise ValueError("Image not found.")
        lesion = self._write_lesion_preview_artifacts(
            site_store,
            image,
            lesion_prompt_box=lesion_prompt_box,
        )
        return {
            "patient_id": image["patient_id"],
            "visit_date": image["visit_date"],
            "view": image.get("view", "slit"),
            "is_representative": bool(image.get("is_representative")),
            "source_image_path": image["image_path"],
            "lesion_mask_path": lesion["lesion_mask_path"],
            "lesion_crop_path": lesion["lesion_crop_path"],
            "backend": lesion["backend"],
            "medsam_error": lesion["medsam_error"],
            "lesion_prompt_box": lesion["lesion_prompt_box"],
            "prompt_signature": lesion["prompt_signature"],
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
    def score_image(self, image_path, *, view, top_k=3, persistence_dir=None):
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


class CoalescingLesionPreviewWorkflow(FakeWorkflow):
    def __init__(self, app_module, control_plane):
        super().__init__(app_module, control_plane)
        self.preview_signatures: list[str | None] = []
        self.first_started = threading.Event()
        self.release_first = threading.Event()
        self.latest_started = threading.Event()

    def preview_image_lesion(self, site_store, image_id, *, lesion_prompt_box=None):
        prompt_signature = self._lesion_prompt_box_signature(lesion_prompt_box)
        self.preview_signatures.append(prompt_signature)
        if len(self.preview_signatures) == 1:
            self.first_started.set()
            self.release_first.wait(timeout=2)
        else:
            self.latest_started.set()
        return super().preview_image_lesion(
            site_store,
            image_id,
            lesion_prompt_box=lesion_prompt_box,
        )


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
        shutil.rmtree(self.site_store.site_dir, ignore_errors=True)
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
        self.site_id = f"LOCAL_ONLY_SITE_{Path(split_tempdir.name).name.replace('-', '').upper()[:8]}"
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

    def test_auth_me_accepts_remote_control_plane_token_when_local_verification_fails(self):
        wrong_remote_secret = "wrong-shared-secret-with-32-bytes-minimum!!"
        remote_token = jwt.encode(
            {
                "sub": "remote_control_plane_user",
                "username": "remote.user@example.com",
            },
            wrong_remote_secret,
            algorithm="HS256",
        )
        remote_client = Mock()
        remote_client.is_configured.return_value = True
        remote_client.main_auth_me.return_value = {
            "access_token": "refreshed-token",
            "token_type": "bearer",
            "user": {
                "user_id": "remote_control_plane_user",
                "username": "remote.user@example.com",
                "full_name": "Remote User",
                "public_alias": None,
                "role": "researcher",
                "site_ids": [self.site_id],
                "approval_status": "approved",
                "registry_consents": {},
            },
        }

        with patch.object(self.app_module, "RemoteControlPlaneClient", return_value=remote_client):
            response = self.client.get(
                "/api/auth/me",
                headers={"Authorization": f"Bearer {remote_token}"},
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["user_id"], "remote_control_plane_user")
        self.assertEqual(response.json()["username"], "remote.user@example.com")
        remote_client.main_auth_me.assert_called_once_with(user_bearer_token=remote_token)

    def test_auth_login_proxies_to_remote_control_plane_when_remote_is_primary(self):
        wrong_remote_secret = "wrong-shared-secret-with-32-bytes-minimum!!"
        remote_token = jwt.encode(
            {
                "sub": "remote_admin_user",
                "username": "admin",
            },
            wrong_remote_secret,
            algorithm="HS256",
        )
        remote_client = Mock()
        remote_client.is_configured.return_value = True
        remote_client.main_auth_login.return_value = {
            "access_token": remote_token,
            "token_type": "bearer",
            "user": {
                "user_id": "remote_admin_user",
                "username": "admin",
                "full_name": "Remote Admin",
                "public_alias": None,
                "role": "admin",
                "site_ids": [],
                "approval_status": "approved",
                "registry_consents": {},
            },
        }
        remote_client.main_auth_me.return_value = {
            "access_token": remote_token,
            "token_type": "bearer",
            "user": {
                "user_id": "remote_admin_user",
                "username": "admin",
                "full_name": "Remote Admin",
                "public_alias": None,
                "role": "admin",
                "site_ids": [],
                "approval_status": "approved",
                "registry_consents": {},
            },
        }

        self.app_module.get_control_plane()._resolve().remote_control_plane = remote_client

        with patch.object(self.app_module, "RemoteControlPlaneClient", return_value=remote_client):
            response = self.client.post("/api/auth/login", json={"username": "admin", "password": "Jnuh41133*"})

            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["access_token"], remote_token)
            remote_client.main_auth_login.assert_called_once_with(
                payload_json={"username": "admin", "password": "Jnuh41133*"}
            )

            me_response = self.client.get(
                "/api/auth/me",
                headers={"Authorization": f"Bearer {remote_token}"},
            )

            self.assertEqual(me_response.status_code, 200, me_response.text)
            self.assertEqual(me_response.json()["user_id"], "remote_admin_user")
            remote_client.main_auth_me.assert_called_once_with(user_bearer_token=remote_token)

    def test_auth_me_downgrades_unassigned_non_admin_token_to_application_required(self):
        token = self.app_module._create_access_token(
            {
                "user_id": "user_unassigned",
                "username": "people.at.korea@gmail.com",
                "role": "researcher",
                "site_ids": [],
                "approval_status": "approved",
                "full_name": "Unassigned Researcher",
            }
        )

        me_response = self.client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )

        self.assertEqual(me_response.status_code, 200, me_response.text)
        self.assertEqual(me_response.json()["approval_status"], "application_required")
        self.assertEqual(me_response.json()["site_ids"], [])

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

    def test_schema_state_rows_are_recorded_for_control_and_data_plane_http(self):
        with self.db_module.CONTROL_PLANE_ENGINE.begin() as conn:
            control_state = conn.execute(
                self.db_module.control_plane_schema_state.select().where(
                    self.db_module.control_plane_schema_state.c.schema_name == "control_plane"
                )
            ).mappings().one()

        with self.db_module.DATA_PLANE_ENGINE.begin() as conn:
            data_state = conn.execute(
                self.db_module.data_plane_schema_state.select().where(
                    self.db_module.data_plane_schema_state.c.schema_name == "data_plane"
                )
            ).mappings().one()

        self.assertEqual(
            control_state["schema_revision"],
            self.db_module.CONTROL_PLANE_ALEMBIC_BASELINE_REVISION,
        )
        self.assertTrue(str(control_state["recorded_at"]).strip())
        self.assertEqual(
            data_state["schema_revision"],
            self.db_module.DATA_PLANE_ALEMBIC_BASELINE_REVISION,
        )
        self.assertTrue(str(data_state["recorded_at"]).strip())

    def test_control_plane_db_is_stamped_to_alembic_baseline_http(self):
        with self.db_module.CONTROL_PLANE_ENGINE.begin() as conn:
            revision = conn.exec_driver_sql("SELECT version_num FROM alembic_version").scalar_one()

        self.assertEqual(
            revision,
            self.db_module.CONTROL_PLANE_ALEMBIC_BASELINE_REVISION,
        )

    def test_data_plane_db_is_stamped_to_alembic_baseline_http(self):
        with self.db_module.DATA_PLANE_ENGINE.begin() as conn:
            revision = conn.exec_driver_sql(
                "SELECT version_num FROM data_plane_alembic_version"
            ).scalar_one()

        self.assertEqual(
            revision,
            self.db_module.DATA_PLANE_ALEMBIC_BASELINE_REVISION,
        )

    def test_local_login_is_restricted_to_admin_and_site_admin_http(self):
        local_headers = {"x-kera-control-plane-owner": "local"}
        researcher_response = self.client.post(
            "/api/auth/login",
            headers=local_headers,
            json={"username": "http_researcher", "password": "research123"},
        )
        self.assertEqual(researcher_response.status_code, 403, researcher_response.text)
        self.assertIn("admin and site admin accounts", researcher_response.text)

        site_admin_response = self.client.post(
            "/api/auth/login",
            headers=local_headers,
            json={"username": "http_site_admin", "password": "siteadmin123"},
        )
        self.assertEqual(site_admin_response.status_code, 200, site_admin_response.text)
        self.assertEqual(site_admin_response.json()["user"]["role"], "site_admin")

    def test_local_login_can_be_disabled_http(self):
        os.environ["KERA_LOCAL_LOGIN_ENABLED"] = "false"
        try:
            response = self.client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
            self.assertEqual(response.status_code, 503, response.text)
            self.assertIn("disabled", response.text)
        finally:
            os.environ.pop("KERA_LOCAL_LOGIN_ENABLED", None)

    def test_dev_login_is_restricted_to_loopback_even_when_enabled_http(self):
        self.client.close()
        self.db_module.CONTROL_PLANE_ENGINE.dispose()
        self.db_module.DATA_PLANE_ENGINE.dispose()

        with patch.dict(os.environ, {"KERA_CONTROL_PLANE_DEV_AUTH": "true"}, clear=False):
            reloaded_app = reload_app_module(
                Path(self.tempdir.name) / "dev_login_remote.db",
                control_plane_artifact_dir=self.control_plane_artifact_dir,
            )
            self.app_module = reloaded_app
            self.db_module = sys.modules["kera_research.db"]
            self.cp = self.app_module.ControlPlaneStore()
            from fastapi.testclient import TestClient

            self.client = TestClient(self.app_module.create_app(), base_url="https://k-era.org")
            response = self.client.post("/api/auth/dev-login")

        self.assertEqual(response.status_code, 403, response.text)
        self.assertIn("localhost", response.text)

    def test_dev_login_allows_loopback_when_enabled_http(self):
        self.client.close()
        self.db_module.CONTROL_PLANE_ENGINE.dispose()
        self.db_module.DATA_PLANE_ENGINE.dispose()

        with patch.dict(os.environ, {"KERA_CONTROL_PLANE_DEV_AUTH": "true"}, clear=False):
            reloaded_app = reload_app_module(
                Path(self.tempdir.name) / "dev_login_loopback.db",
                control_plane_artifact_dir=self.control_plane_artifact_dir,
            )
            self.app_module = reloaded_app
            self.db_module = sys.modules["kera_research.db"]
            self.cp = self.app_module.ControlPlaneStore()
            from fastapi.testclient import TestClient

            self.client = TestClient(self.app_module.create_app(), base_url="http://127.0.0.1:8000")
            response = self.client.post("/api/auth/dev-login")

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["user"]["role"], "admin")
        self.assertTrue(str(payload["access_token"]).strip())

    def test_dev_login_route_is_not_registered_for_production_like_runtime_http(self):
        self.client.close()
        self.db_module.CONTROL_PLANE_ENGINE.dispose()
        self.db_module.DATA_PLANE_ENGINE.dispose()

        with patch.dict(
            os.environ,
            {
                "KERA_CONTROL_PLANE_DEV_AUTH": "true",
                "KERA_ENVIRONMENT": "production",
            },
            clear=False,
        ):
            reloaded_app = reload_app_module(
                control_plane_db_path=Path(self.tempdir.name) / "dev_login_disabled_prod_control.db",
                data_plane_db_path=Path(self.tempdir.name) / "dev_login_disabled_prod_data.db",
                control_plane_artifact_dir=self.control_plane_artifact_dir,
                extra_env={"KERA_ENVIRONMENT": "production"},
            )
            self.app_module = reloaded_app
            self.db_module = sys.modules["kera_research.db"]
            self.cp = self.app_module.ControlPlaneStore()
            from fastapi.testclient import TestClient

            self.client = TestClient(self.app_module.create_app(), base_url="http://127.0.0.1:8000")
            response = self.client.post("/api/auth/dev-login")

        self.assertEqual(response.status_code, 404, response.text)

    def test_dev_login_route_is_not_registered_when_control_plane_base_url_is_remote_http(self):
        self.client.close()
        self.db_module.CONTROL_PLANE_ENGINE.dispose()
        self.db_module.DATA_PLANE_ENGINE.dispose()

        with patch.dict(
            os.environ,
            {
                "KERA_CONTROL_PLANE_DEV_AUTH": "true",
            },
            clear=False,
        ):
            reloaded_app = reload_app_module(
                Path(self.tempdir.name) / "dev_login_disabled_remote_base.db",
                control_plane_artifact_dir=self.control_plane_artifact_dir,
                control_plane_api_base_url="https://k-era.org/control-plane/api",
            )
            self.app_module = reloaded_app
            self.db_module = sys.modules["kera_research.db"]
            self.cp = self.app_module.ControlPlaneStore()
            from fastapi.testclient import TestClient

            self.client = TestClient(self.app_module.create_app(), base_url="http://127.0.0.1:8000")
            response = self.client.post("/api/auth/dev-login")

        self.assertEqual(response.status_code, 404, response.text)

    def test_login_rate_limit_persists_across_app_reload_http(self):
        for _ in range(10):
            response = self.client.post(
                "/api/auth/login",
                json={"username": "admin", "password": "wrong-password"},
            )
            self.assertEqual(response.status_code, 401, response.text)

        self.client.close()
        self.db_module.CONTROL_PLANE_ENGINE.dispose()
        self.db_module.DATA_PLANE_ENGINE.dispose()
        reloaded_app = reload_app_module(
            Path(self.tempdir.name) / "test.db",
            control_plane_artifact_dir=self.control_plane_artifact_dir,
        )
        self.app_module = reloaded_app
        self.db_module = sys.modules["kera_research.db"]
        self.cp = self.app_module.ControlPlaneStore()
        from fastapi.testclient import TestClient

        self.client = TestClient(self.app_module.create_app())

        throttled = self.client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "wrong-password"},
        )

        self.assertEqual(throttled.status_code, 429, throttled.text)
        self.assertEqual(throttled.headers.get("Retry-After"), "300")
        self.assertIn("Too many login attempts", throttled.text)

    def test_login_rate_limit_ignores_forwarded_headers_from_untrusted_client_http(self):
        with patch.dict(os.environ, {"KERA_TRUST_PROXY_HEADERS": "true"}, clear=False):
            for attempt in range(10):
                response = self.client.post(
                    "/api/auth/login",
                    headers={"X-Forwarded-For": f"203.0.113.{attempt + 10}"},
                    json={"username": "admin", "password": "wrong-password"},
                )
                self.assertEqual(response.status_code, 401, response.text)

            throttled = self.client.post(
                "/api/auth/login",
                headers={"X-Forwarded-For": "198.51.100.24"},
                json={"username": "admin", "password": "wrong-password"},
            )

        self.assertEqual(throttled.status_code, 429, throttled.text)
        with self.db_module.CONTROL_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(self.db_module.auth_rate_limits.select()).mappings().all()
        self.assertTrue(all(str(row["client_key"]) == "testclient" for row in rows))

    def test_login_rate_limit_uses_forwarded_ip_from_trusted_proxy_http(self):
        with patch.dict(
            os.environ,
            {
                "KERA_TRUST_PROXY_HEADERS": "true",
                "KERA_TRUSTED_PROXY_IPS": "testclient",
            },
            clear=False,
        ):
            response = self.client.post(
                "/api/auth/login",
                headers={"X-Forwarded-For": "203.0.113.55"},
                json={"username": "admin", "password": "wrong-password"},
            )

        self.assertEqual(response.status_code, 401, response.text)
        with self.db_module.CONTROL_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(self.db_module.auth_rate_limits.select()).mappings().all()
        self.assertEqual([str(row["client_key"]) for row in rows], ["203.0.113.55"])

    def test_default_cors_allows_known_local_web_origin_http(self):
        response = self.client.options(
            "/api/auth/login",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "POST",
            },
        )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers.get("access-control-allow-origin"), "http://localhost:3000")

    def test_default_cors_rejects_unknown_localhost_port_http(self):
        response = self.client.options(
            "/api/auth/login",
            headers={
                "Origin": "http://localhost:3015",
                "Access-Control-Request-Method": "POST",
            },
        )

        self.assertEqual(response.status_code, 400, response.text)
        self.assertNotEqual(response.headers.get("access-control-allow-origin"), "http://localhost:3015")

    def test_cors_allows_explicitly_configured_extra_origins_http(self):
        from fastapi.testclient import TestClient

        with patch.dict(
            os.environ,
            {"KERA_CORS_ALLOWED_ORIGINS": "https://k-era.org, https://downloads.k-era.org"},
            clear=False,
        ):
            client = TestClient(self.app_module.create_app())
            try:
                response = client.options(
                    "/api/auth/login",
                    headers={
                        "Origin": "https://downloads.k-era.org",
                        "Access-Control-Request-Method": "POST",
                    },
                )
            finally:
                client.close()

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers.get("access-control-allow-origin"), "https://downloads.k-era.org")

    def test_query_string_token_is_not_accepted_for_authenticated_routes_http(self):
        token = self._token_for_username("admin")

        response = self.client.get(f"/api/auth/me?token={token}")

        self.assertEqual(response.status_code, 401, response.text)
        self.assertIn("Missing bearer token", response.text)

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

    def test_plaintext_password_rows_are_migrated_to_argon2_http(self):
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
        self.assertTrue(self.app_module._is_argon2_hash(str(raw_user["password"])))
        self.assertIsNotNone(migrated_store.authenticate("legacy_plain_admin", "plain-admin-pass"))

    def test_legacy_pbkdf2_password_rows_migrate_to_argon2_after_login_http(self):
        salt = "legacy-salt"
        iterations = 210000
        digest = hashlib.pbkdf2_hmac("sha256", b"legacy-admin-pass", salt.encode("utf-8"), iterations)
        encoded_password = f"pbkdf2_sha256${iterations}${salt}${base64.b64encode(digest).decode('ascii')}"
        legacy_admin_id = self.app_module.make_id("user")
        with self.db_module.CONTROL_PLANE_ENGINE.begin() as conn:
            conn.execute(
                self.db_module.users.insert().values(
                    user_id=legacy_admin_id,
                    username="legacy_pbkdf2_admin",
                    password=encoded_password,
                    role="admin",
                    full_name="Legacy Pbkdf2 Admin",
                    site_ids=[],
                    google_sub=None,
                )
            )

        migrated_store = self.app_module.ControlPlaneStore()
        raw_before_login = migrated_store._load_user_by_username("legacy_pbkdf2_admin")
        self.assertIsNotNone(raw_before_login)
        self.assertEqual(raw_before_login["password"], encoded_password)
        self.assertIsNotNone(migrated_store.authenticate("legacy_pbkdf2_admin", "legacy-admin-pass"))

        raw_after_login = migrated_store._load_user_by_username("legacy_pbkdf2_admin")
        self.assertIsNotNone(raw_after_login)
        self.assertTrue(self.app_module._is_argon2_hash(str(raw_after_login["password"])))

    def test_legacy_pbkdf2_long_password_rows_migrate_to_argon2_after_login_http(self):
        long_password = "kera-long-password-" * 6
        salt = "legacy-long-salt"
        iterations = 210000
        digest = hashlib.pbkdf2_hmac("sha256", long_password.encode("utf-8"), salt.encode("utf-8"), iterations)
        encoded_password = f"pbkdf2_sha256${iterations}${salt}${base64.b64encode(digest).decode('ascii')}"
        legacy_admin_id = self.app_module.make_id("user")
        with self.db_module.CONTROL_PLANE_ENGINE.begin() as conn:
            conn.execute(
                self.db_module.users.insert().values(
                    user_id=legacy_admin_id,
                    username="legacy_long_pbkdf2_admin",
                    password=encoded_password,
                    role="admin",
                    full_name="Legacy Long Pbkdf2 Admin",
                    site_ids=[],
                    google_sub=None,
                )
            )

        migrated_store = self.app_module.ControlPlaneStore()
        self.assertIsNotNone(migrated_store.authenticate("legacy_long_pbkdf2_admin", long_password))
        raw_after_login = migrated_store._load_user_by_username("legacy_long_pbkdf2_admin")
        self.assertIsNotNone(raw_after_login)
        self.assertTrue(self.app_module._is_argon2_hash(str(raw_after_login["password"])))

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
        self.assertTrue(self.app_module._is_argon2_hash(str(raw_user["password"])))
        self.assertIsNotNone(self.cp.authenticate("hashed_on_upsert_admin", "admin-pass-123"))

    def test_stringified_empty_site_ids_are_normalized_http(self):
        legacy_user = self.app_module.make_id("user")
        with self.db_module.CONTROL_PLANE_ENGINE.begin() as conn:
            conn.execute(
                self.db_module.users.insert().values(
                    user_id=legacy_user,
                    username="legacy_string_site_ids",
                    password="legacy123",
                    role="viewer",
                    full_name="Legacy String Site Ids",
                    site_ids="[]",
                    google_sub=None,
                )
            )

        repaired_store = self.app_module.ControlPlaneStore()
        repaired_user = repaired_store.get_user_by_username("legacy_string_site_ids")
        self.assertIsNotNone(repaired_user)
        self.assertEqual(repaired_user["site_ids"], [])

        raw_user = repaired_store._load_user_by_username("legacy_string_site_ids")
        self.assertIsNotNone(raw_user)
        self.assertEqual(raw_user["site_ids"], [])

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

    def _join_and_include_research_case(
        self,
        token: str,
        *,
        patient_id: str = "HTTP-001",
        visit_date: str = "Initial",
    ) -> None:
        consent_response = self.client.post(
            f"/api/sites/{self.site_id}/research-registry/consent",
            headers={"Authorization": f"Bearer {token}"},
            json={"version": "v1"},
        )
        self.assertEqual(consent_response.status_code, 200, consent_response.text)

        include_response = self.client.post(
            f"/api/sites/{self.site_id}/cases/research-registry",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "patient_id": patient_id,
                "visit_date": visit_date,
                "action": "include",
                "source": "test_helper",
            },
        )
        self.assertEqual(include_response.status_code, 200, include_response.text)

    def test_delete_visit_soft_deletes_federated_retained_case_http(self):
        admin_token = self._login("admin", "admin123")
        self._seed_case(admin_token)
        visit_before = self.site_store.get_visit("HTTP-001", "Initial")
        self.assertIsNotNone(visit_before)
        image_before = self.site_store.list_images_for_visit("HTTP-001", "Initial")[0]
        image_path = Path(str(image_before["image_path"]))
        self.assertTrue(image_path.exists())
        self.site_store.mark_visit_fl_retained(
            "HTTP-001",
            "Initial",
            scope="case_contribution_single_case",
            update_id="update_soft_delete_test",
        )

        delete_response = self.client.delete(
            f"/api/sites/{self.site_id}/visits",
            headers={"Authorization": f"Bearer {admin_token}"},
            params={"patient_id": "HTTP-001", "visit_date": "Initial"},
        )
        self.assertEqual(delete_response.status_code, 200, delete_response.text)
        self.assertEqual(delete_response.json()["deleted_images"], 1)
        self.assertFalse(delete_response.json()["deleted_patient"])
        self.assertEqual(delete_response.json()["remaining_visit_count"], 0)
        self.assertTrue(image_path.exists())
        self.assertIsNone(self.site_store.get_visit("HTTP-001", "Initial"))

        cases_response = self.client.get(
            f"/api/sites/{self.site_id}/cases",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        self.assertEqual(cases_response.status_code, 200, cases_response.text)
        self.assertEqual(cases_response.json(), [])

        data_plane_db_path = Path(str(self.db_module.DATA_PLANE_DATABASE_URL).replace("sqlite:///", "", 1))
        with sqlite3.connect(data_plane_db_path) as conn:
            visit_row = conn.execute(
                "select fl_retained, soft_deleted_at, soft_delete_reason from visits where site_id = ? and patient_id = ? and visit_date = ?",
                (self.site_id, "HTTP-001", "Initial"),
            ).fetchone()
            image_row = conn.execute(
                "select soft_deleted_at, soft_delete_reason from images where site_id = ? and patient_id = ? and visit_date = ?",
                (self.site_id, "HTTP-001", "Initial"),
            ).fetchone()
        self.assertIsNotNone(visit_row)
        self.assertEqual(int(visit_row[0] or 0), 1)
        self.assertTrue(str(visit_row[1] or "").strip())
        self.assertEqual(str(visit_row[2] or ""), "federated_retention_soft_delete")
        self.assertIsNotNone(image_row)
        self.assertTrue(str(image_row[0] or "").strip())
        self.assertEqual(str(image_row[1] or ""), "federated_retention_soft_delete")

    def test_delete_images_soft_deletes_visible_images_for_federated_retained_case_http(self):
        admin_token = self._login("admin", "admin123")
        self._seed_case(admin_token)
        image_before = self.site_store.list_images_for_visit("HTTP-001", "Initial")[0]
        image_path = Path(str(image_before["image_path"]))
        self.assertTrue(image_path.exists())
        self.site_store.mark_visit_fl_retained(
            "HTTP-001",
            "Initial",
            scope="image_level_site_round",
            update_id="update_soft_delete_images_test",
        )

        delete_response = self.client.delete(
            f"/api/sites/{self.site_id}/images",
            headers={"Authorization": f"Bearer {admin_token}"},
            params={"patient_id": "HTTP-001", "visit_date": "Initial"},
        )
        self.assertEqual(delete_response.status_code, 200, delete_response.text)
        self.assertEqual(delete_response.json()["deleted_count"], 1)
        self.assertTrue(image_path.exists())
        self.assertIsNotNone(self.site_store.get_visit("HTTP-001", "Initial"))
        self.assertEqual(self.site_store.list_images_for_visit("HTTP-001", "Initial"), [])

        cases_response = self.client.get(
            f"/api/sites/{self.site_id}/cases",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        self.assertEqual(cases_response.status_code, 200, cases_response.text)
        self.assertEqual(len(cases_response.json()), 1)
        self.assertEqual(cases_response.json()[0]["image_count"], 0)

        data_plane_db_path = Path(str(self.db_module.DATA_PLANE_DATABASE_URL).replace("sqlite:///", "", 1))
        with sqlite3.connect(data_plane_db_path) as conn:
            image_rows = conn.execute(
                "select count(*), max(soft_deleted_at), max(soft_delete_reason) from images where site_id = ? and patient_id = ? and visit_date = ?",
                (self.site_id, "HTTP-001", "Initial"),
            ).fetchone()
        self.assertEqual(int(image_rows[0] or 0), 1)
        self.assertTrue(str(image_rows[1] or "").strip())
        self.assertEqual(str(image_rows[2] or ""), "federated_retention_soft_delete")

    def test_admin_retained_case_archive_and_restore_visit_http(self):
        admin_token = self._login("admin", "admin123")
        self._seed_case(admin_token)
        self.site_store.mark_visit_fl_retained(
            "HTTP-001",
            "Initial",
            scope="visit_level_site_round",
            update_id="update_restore_visit_test",
        )
        delete_response = self.client.delete(
            f"/api/sites/{self.site_id}/visits",
            headers={"Authorization": f"Bearer {admin_token}"},
            params={"patient_id": "HTTP-001", "visit_date": "Initial"},
        )
        self.assertEqual(delete_response.status_code, 200, delete_response.text)

        archive_response = self.client.get(
            f"/api/admin/sites/{self.site_id}/retained-cases",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        self.assertEqual(archive_response.status_code, 200, archive_response.text)
        archive_payload = archive_response.json()
        self.assertEqual(len(archive_payload), 1)
        self.assertTrue(bool(archive_payload[0]["can_restore_visit"]))
        self.assertEqual(int(archive_payload[0]["soft_deleted_image_count"] or 0), 1)

        lazy_cp = self.app_module.get_control_plane()
        self.app_module._PENDING_FEDERATED_RETRIEVAL_SYNC_JOBS.clear()
        self.app_module._PENDING_FEDERATED_RETRIEVAL_SYNC_TRIGGERS.clear()
        try:
            fake_executor = Mock()
            fake_schedule = Mock()
            with patch.dict(
                os.environ,
                {
                    "KERA_DISABLE_CASE_EMBEDDING_REFRESH": "0",
                    "KERA_DISABLE_FEDERATED_RETRIEVAL_AUTO_SYNC": "0",
                },
                clear=False,
            ):
                with patch.object(self.app_module, "control_plane_split_enabled", return_value=False):
                    with patch.object(lazy_cp, "current_global_model", return_value={"version_id": "model-1", "ready": True}):
                        with patch.object(lazy_cp, "remote_node_sync_enabled", return_value=True):
                            with patch.object(self.app_module, "_latest_embedding_backfill_job", return_value=None):
                                with patch.object(
                                    self.app_module,
                                    "_queue_site_embedding_backfill_impl",
                                    return_value={"job_id": "job-retained-restore", "status": "running"},
                                ) as queue_mock:
                                    with patch.object(self.app_module, "_FEDERATED_RETRIEVAL_SYNC_EXECUTOR", fake_executor):
                                        with patch.object(
                                            self.app_module,
                                            "_submit_executor_job_after_delay",
                                            fake_schedule,
                                        ):
                                            restore_response = self.client.post(
                                                f"/api/admin/sites/{self.site_id}/retained-cases/restore",
                                                headers={"Authorization": f"Bearer {admin_token}"},
                                                json={
                                                    "patient_id": "HTTP-001",
                                                    "visit_date": "Initial",
                                                    "mode": "visit",
                                                },
                                            )

            self.assertEqual(restore_response.status_code, 200, restore_response.text)
            restore_payload = restore_response.json()
            self.assertEqual(restore_payload["mode"], "visit")
            self.assertEqual(int(restore_payload["restored_visit"] or 0), 1)
            self.assertEqual(int(restore_payload["restored_images"] or 0), 1)
            self.assertEqual(queue_mock.call_count, 1)
            self.assertEqual(queue_mock.call_args.kwargs["trigger"], "retained_case_restore")
            self.assertEqual(fake_schedule.call_count, 1)
            self.assertIs(fake_schedule.call_args.args[0], fake_executor)
        finally:
            self.app_module._PENDING_FEDERATED_RETRIEVAL_SYNC_JOBS.clear()
            self.app_module._PENDING_FEDERATED_RETRIEVAL_SYNC_TRIGGERS.clear()

        restored_visit = self.site_store.get_visit("HTTP-001", "Initial")
        self.assertIsNotNone(restored_visit)
        self.assertEqual(len(self.site_store.list_images_for_visit("HTTP-001", "Initial")), 1)

    def test_admin_retained_case_archive_and_restore_images_http(self):
        admin_token = self._login("admin", "admin123")
        self._seed_case(admin_token)
        self.site_store.mark_visit_fl_retained(
            "HTTP-001",
            "Initial",
            scope="image_level_site_round",
            update_id="update_restore_images_test",
        )
        delete_response = self.client.delete(
            f"/api/sites/{self.site_id}/images",
            headers={"Authorization": f"Bearer {admin_token}"},
            params={"patient_id": "HTTP-001", "visit_date": "Initial"},
        )
        self.assertEqual(delete_response.status_code, 200, delete_response.text)

        archive_response = self.client.get(
            f"/api/admin/sites/{self.site_id}/retained-cases",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        self.assertEqual(archive_response.status_code, 200, archive_response.text)
        archive_payload = archive_response.json()
        self.assertEqual(len(archive_payload), 1)
        self.assertFalse(bool(archive_payload[0]["can_restore_visit"]))
        self.assertTrue(bool(archive_payload[0]["can_restore_images"]))

        restore_response = self.client.post(
            f"/api/admin/sites/{self.site_id}/retained-cases/restore",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "patient_id": "HTTP-001",
                "visit_date": "Initial",
                "mode": "images",
            },
        )
        self.assertEqual(restore_response.status_code, 200, restore_response.text)
        restore_payload = restore_response.json()
        self.assertEqual(restore_payload["mode"], "images")
        self.assertEqual(int(restore_payload["restored_visit"] or 0), 0)
        self.assertEqual(int(restore_payload["restored_images"] or 0), 1)
        self.assertEqual(len(self.site_store.list_images_for_visit("HTTP-001", "Initial")), 1)

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

    def test_split_mode_site_list_uses_institution_name_for_hira_code_http(self):
        self.client.close()
        self.db_module.CONTROL_PLANE_ENGINE.dispose()
        self.db_module.DATA_PLANE_ENGINE.dispose()
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
        from fastapi.testclient import TestClient

        self.client = TestClient(self.app_module.create_app())
        self.cp = self.app_module.ControlPlaneStore()
        self.cp.upsert_institutions(
            [
                {
                    "institution_id": "39100103",
                    "name": "Jeju National University Hospital",
                    "source": "hira",
                    "synced_at": "2026-03-22T00:00:00+00:00",
                }
            ]
        )
        token = self.app_module._create_access_token(
            {
                "user_id": "local_user_hira_001",
                "username": "local.hira",
                "role": "researcher",
                "site_ids": ["39100103"],
                "approval_status": "approved",
            }
        )

        sites_response = self.client.get(
            "/api/sites",
            headers={
                "Authorization": f"Bearer {token}",
                "x-kera-control-plane-owner": "local",
            },
        )

        self.assertEqual(sites_response.status_code, 200, sites_response.text)
        payload = sites_response.json()
        self.assertEqual(len(payload), 1)
        self.assertEqual(payload[0]["site_id"], "39100103")
        self.assertEqual(payload[0]["display_name"], "Jeju National University Hospital")
        self.assertEqual(payload[0]["hospital_name"], "Jeju National University Hospital")

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

    def test_patient_id_lookup_endpoint_reports_duplicates_http(self):
        admin_token = self._login("admin", "admin123")
        self._seed_case(admin_token, patient_id="HTTP-001")

        response = self.client.get(
            f"/api/sites/{self.site_id}/patients/lookup?patient_id=%20HTTP-001%20",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["requested_patient_id"], "HTTP-001")
        self.assertEqual(payload["normalized_patient_id"], "HTTP-001")
        self.assertTrue(payload["exists"])
        self.assertEqual(payload["visit_count"], 1)
        self.assertEqual(payload["image_count"], 1)
        self.assertEqual(payload["latest_visit_date"], "Initial")
        self.assertEqual(payload["patient"]["patient_id"], "HTTP-001")

        missing_response = self.client.get(
            f"/api/sites/{self.site_id}/patients/lookup?patient_id=HTTP-NEW",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        self.assertEqual(missing_response.status_code, 200, missing_response.text)
        missing_payload = missing_response.json()
        self.assertFalse(missing_payload["exists"])
        self.assertEqual(missing_payload["visit_count"], 0)
        self.assertEqual(missing_payload["image_count"], 0)
        self.assertIsNone(missing_payload["latest_visit_date"])
        self.assertIsNone(missing_payload["patient"])

    def test_site_summary_reports_case_counts_http(self):
        admin_token = self._login("admin", "admin123")
        self._seed_case(admin_token, patient_id="HTTP-001", visit_date="Initial")

        second_visit_response = self.client.post(
            f"/api/sites/{self.site_id}/visits",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "patient_id": "HTTP-001",
                "visit_date": "FU #1",
                "culture_category": "fungal",
                "culture_species": "Candida",
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
        self.assertEqual(payload["n_fungal_visits"], 1)
        self.assertEqual(payload["n_bacterial_visits"], 1)
        self.assertEqual(payload["n_validation_runs"], 0)
        self.assertIsNone(payload["latest_validation"])

    def test_site_summary_uses_aggregate_stats_without_loading_full_row_sets_http(self):
        admin_token = self._login("admin", "admin123")
        self._seed_case(admin_token, patient_id="HTTP-001", visit_date="Initial")

        with patch.object(self.app_module.SiteStore, "list_patients", side_effect=AssertionError("summary should use aggregate stats")), patch.object(
            self.app_module.SiteStore,
            "list_visits",
            side_effect=AssertionError("summary should use aggregate stats"),
        ), patch.object(
            self.app_module.SiteStore,
            "list_images",
            side_effect=AssertionError("summary should use aggregate stats"),
        ):
            summary_response = self.client.get(
                f"/api/sites/{self.site_id}/summary",
                headers={"Authorization": f"Bearer {admin_token}"},
            )

        self.assertEqual(summary_response.status_code, 200, summary_response.text)
        payload = summary_response.json()
        self.assertEqual(payload["n_patients"], 1)
        self.assertEqual(payload["n_visits"], 1)
        self.assertEqual(payload["n_images"], 1)
        self.assertEqual(payload["n_active_visits"], 1)
        self.assertEqual(payload["n_fungal_visits"], 0)
        self.assertEqual(payload["n_bacterial_visits"], 1)

    def test_site_summary_counts_reflect_latest_raw_inventory_http(self):
        admin_token = self._login("admin", "admin123")
        self._seed_case(admin_token, patient_id="HTTP-001", visit_date="Initial")

        extra_images = [
            ("RAW-NEW-001", "Initial", "raw_new_001_initial.png"),
            ("RAW-NEW-001", "FU #1", "raw_new_001_fu1.png"),
            ("RAW-NEW-001", "FU #1", "raw_new_001_fu1_b.png"),
            ("RAW-NEW-002", "Initial", "raw_new_002_initial.png"),
        ]
        for patient_id, visit_label, file_name in extra_images:
            visit_dir = self.site_store.raw_dir / patient_id / visit_label
            visit_dir.mkdir(parents=True, exist_ok=True)
            (visit_dir / file_name).write_bytes(self._make_test_image_bytes("PNG"))

        empty_dir = self.site_store.raw_dir / "test" / "Initial"
        empty_dir.mkdir(parents=True, exist_ok=True)

        counts_response = self.client.get(
            f"/api/sites/{self.site_id}/summary/counts",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        self.assertEqual(counts_response.status_code, 200, counts_response.text)
        counts_payload = counts_response.json()
        self.assertEqual(counts_payload["n_patients"], 3)
        self.assertEqual(counts_payload["n_visits"], 4)
        self.assertEqual(counts_payload["n_images"], 5)
        self.assertEqual(counts_payload["n_active_visits"], 1)
        self.assertEqual(counts_payload["n_fungal_visits"], 0)
        self.assertEqual(counts_payload["n_bacterial_visits"], 1)

        summary_response = self.client.get(
            f"/api/sites/{self.site_id}/summary",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        self.assertEqual(summary_response.status_code, 200, summary_response.text)
        summary_payload = summary_response.json()
        self.assertEqual(summary_payload["n_patients"], 3)
        self.assertEqual(summary_payload["n_visits"], 4)
        self.assertEqual(summary_payload["n_images"], 5)
        self.assertEqual(summary_payload["n_active_visits"], 1)
        self.assertEqual(summary_payload["n_fungal_visits"], 0)
        self.assertEqual(summary_payload["n_bacterial_visits"], 1)

    def test_image_preview_endpoint_reuses_cached_thumbnail_http(self):
        admin_token = self._login("admin", "admin123")
        image_id = self._seed_case(admin_token, patient_id="HTTP-001", visit_date="Initial")
        preview_url = f"/api/sites/{self.site_id}/images/{image_id}/preview?max_side=256"
        image_record = self.site_store.get_image(image_id)
        self.assertIsNotNone(image_record)
        self.site_store.ensure_image_preview(image_record, 256)

        response = self.client.get(
            preview_url,
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers["content-type"], "image/jpeg")

        preview_path = self.site_store.image_preview_cache_path(image_id, 256)
        self.assertTrue(preview_path.exists())

        with patch("kera_research.services.data_plane_previews.Image.open", side_effect=AssertionError("preview should be served from cache")):
            cached_response = self.client.get(
                preview_url,
                headers={"Authorization": f"Bearer {admin_token}"},
            )

        self.assertEqual(cached_response.status_code, 200, cached_response.text)
        self.assertEqual(cached_response.content, response.content)

    def test_image_preview_endpoint_serves_cached_thumbnail_without_touching_source_file_http(self):
        admin_token = self._login("admin", "admin123")
        image_id = self._seed_case(admin_token, patient_id="HTTP-001", visit_date="Initial")
        preview_url = f"/api/sites/{self.site_id}/images/{image_id}/preview?max_side=256"
        image_record = self.site_store.get_image(image_id)
        self.assertIsNotNone(image_record)
        self.site_store.ensure_image_preview(image_record, 256)

        initial_response = self.client.get(
            preview_url,
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        self.assertEqual(initial_response.status_code, 200, initial_response.text)

        image_record = self.site_store.get_image(image_id)
        self.assertIsNotNone(image_record)
        source_path = Path(str(image_record["image_path"]))
        self.assertTrue(source_path.exists())
        source_path.unlink()

        cached_response = self.client.get(
            preview_url,
            headers={"Authorization": f"Bearer {admin_token}"},
        )

        self.assertEqual(cached_response.status_code, 200, cached_response.text)
        self.assertEqual(cached_response.content, initial_response.content)

    def test_image_preview_endpoint_serves_cached_thumbnail_without_db_lookup_http(self):
        admin_token = self._login("admin", "admin123")
        image_id = self._seed_case(admin_token, patient_id="HTTP-001", visit_date="Initial")
        preview_url = f"/api/sites/{self.site_id}/images/{image_id}/preview?max_side=384"
        image_record = self.site_store.get_image(image_id)
        self.assertIsNotNone(image_record)
        self.site_store.ensure_image_preview(image_record, 384)

        initial_response = self.client.get(
            preview_url,
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        self.assertEqual(initial_response.status_code, 200, initial_response.text)

        with patch("kera_research.services.data_plane.SiteStore.get_image", side_effect=AssertionError("cached preview should skip DB lookup")):
            cached_response = self.client.get(
                preview_url,
                headers={"Authorization": f"Bearer {admin_token}"},
            )

        self.assertEqual(cached_response.status_code, 200, cached_response.text)
        self.assertEqual(cached_response.content, initial_response.content)

    def test_delete_images_removes_cached_previews_http(self):
        token = self._token_for_username("http_researcher")
        image_id = self._seed_case(token, patient_id="HTTP-001", visit_date="Initial")
        preview_url = f"/api/sites/{self.site_id}/images/{image_id}/preview?max_side=384"
        preview_path = self.site_store.image_preview_cache_path(image_id, 384)
        image_record = self.site_store.get_image(image_id)
        self.assertIsNotNone(image_record)
        self.site_store.ensure_image_preview(image_record, 384)

        preview_response = self.client.get(
            preview_url,
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(preview_response.status_code, 200, preview_response.text)
        self.assertTrue(preview_path.exists())

        delete_response = self.client.delete(
            f"/api/sites/{self.site_id}/images?patient_id=HTTP-001&visit_date=Initial",
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(delete_response.status_code, 200, delete_response.text)
        self.assertFalse(preview_path.exists())

        missing_response = self.client.get(
            preview_url,
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(missing_response.status_code, 404, missing_response.text)

    def test_image_preview_endpoint_serves_source_while_preview_backfill_queues_http(self):
        admin_token = self._login("admin", "admin123")
        image_id = self._seed_case(admin_token, patient_id="HTTP-001", visit_date="Initial")
        preview_url = f"/api/sites/{self.site_id}/images/{image_id}/preview?max_side=384"
        preview_path = self.site_store.image_preview_cache_path(image_id, 384)
        preview_path.unlink(missing_ok=True)

        with patch("kera_research.api.routes.case_images.schedule_image_derivative_backfill") as backfill_mock:
            with patch.object(
                self.app_module.SiteStore,
                "ensure_image_preview",
                side_effect=AssertionError("preview endpoint should not generate previews inline on cache miss"),
            ):
                response = self.client.get(
                    preview_url,
                    headers={"Authorization": f"Bearer {admin_token}"},
                )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers["content-type"], "image/png")
        self.assertFalse(preview_path.exists())
        backfill_mock.assert_called_once()
        scheduled_store, scheduled_ids = backfill_mock.call_args.args
        self.assertEqual(str(scheduled_store.site_id), self.site_id)
        self.assertEqual(scheduled_ids, [image_id])

    def test_image_preview_batch_endpoint_prewarms_and_reports_preview_status_http(self):
        admin_token = self._login("admin", "admin123")
        image_id = self._seed_case(admin_token, patient_id="HTTP-001", visit_date="Initial")
        preview_path = self.site_store.image_preview_cache_path(image_id, 256)
        preview_path.unlink(missing_ok=True)

        with patch("kera_research.api.routes.case_images.schedule_image_derivative_backfill") as backfill_mock:
            with patch.object(
                self.app_module.SiteStore,
                "ensure_image_preview",
                side_effect=AssertionError("preview batch should not generate previews inline"),
            ):
                response = self.client.post(
                    f"/api/sites/{self.site_id}/images/previews",
                    headers={"Authorization": f"Bearer {admin_token}"},
                    json={"image_ids": [image_id, "missing-image"], "max_side": 256},
                )
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["max_side"], 256)
        self.assertEqual(payload["requested_count"], 2)

        items_by_id = {item["image_id"]: item for item in payload["items"]}
        if items_by_id[image_id]["ready"]:
            self.assertEqual(payload["ready_count"], 1)
            self.assertEqual(items_by_id[image_id]["cache_status"], "hit")
            backfill_mock.assert_not_called()
        else:
            self.assertEqual(payload["ready_count"], 0)
            self.assertEqual(items_by_id[image_id]["cache_status"], "queued")
            backfill_mock.assert_called_once()
            scheduled_store, scheduled_ids = backfill_mock.call_args.args
            self.assertEqual(str(scheduled_store.site_id), self.site_id)
            self.assertEqual(scheduled_ids, [image_id])
        self.assertTrue(items_by_id[image_id]["preview_url"].endswith(f"/images/{image_id}/preview?max_side=256"))

        self.assertFalse(items_by_id["missing-image"]["ready"])
        self.assertEqual(items_by_id["missing-image"]["cache_status"], "missing")
        self.assertEqual(items_by_id["missing-image"]["error"], "Image not found.")

    def test_image_upload_defers_quality_scores_and_preview_generation_http(self):
        admin_token = self._login("admin", "admin123")
        patient_response = self.client.post(
            f"/api/sites/{self.site_id}/patients",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"patient_id": "HTTP-001", "sex": "female", "age": 61, "chart_alias": "", "local_case_code": ""},
        )
        self.assertEqual(patient_response.status_code, 200, patient_response.text)
        visit_response = self.client.post(
            f"/api/sites/{self.site_id}/visits",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "patient_id": "HTTP-001",
                "visit_date": "Initial",
                "culture_category": "bacterial",
                "culture_species": "Staphylococcus aureus",
                "contact_lens_use": "none",
                "visit_status": "active",
                "is_initial_visit": True,
            },
        )
        self.assertEqual(visit_response.status_code, 200, visit_response.text)
        upload_response = self.client.post(
            f"/api/sites/{self.site_id}/images",
            headers={"Authorization": f"Bearer {admin_token}"},
            data={
                "patient_id": "HTTP-001",
                "visit_date": "Initial",
                "view": "slit",
                "is_representative": "true",
            },
            files={"file": ("slit.png", self._make_test_image_bytes("PNG"), "image/png")},
        )
        self.assertEqual(upload_response.status_code, 200, upload_response.text)
        image_id = upload_response.json()["image_id"]
        self.assertIsNone(upload_response.json().get("quality_scores"))

        deadline = time.time() + 5.0
        while time.time() < deadline:
            refreshed_response = self.client.get(
                f"/api/sites/{self.site_id}/images?patient_id=HTTP-001&visit_date=Initial",
                headers={"Authorization": f"Bearer {admin_token}"},
            )
            if (
                refreshed_response.status_code == 200
                and refreshed_response.json()
                and refreshed_response.json()[0].get("quality_scores")
                and self.site_store.image_preview_cache_path(image_id, 256).exists()
                and self.site_store.image_preview_cache_path(image_id, 640).exists()
            ):
                break
            time.sleep(0.1)
        else:
            self.fail("upload-triggered derivative backfill did not complete in time")

    def test_image_list_triggers_background_derivative_backfill_http(self):
        admin_token = self._login("admin", "admin123")
        image_id = self._seed_case(admin_token, patient_id="HTTP-001", visit_date="Initial")

        with self.db_module.DATA_PLANE_ENGINE.begin() as conn:
            conn.execute(
                self.db_module.images.update()
                .where(self.db_module.images.c.image_id == image_id)
                .values(quality_scores=None)
            )

        self.site_store.image_preview_cache_path(image_id, 256).unlink(missing_ok=True)
        self.site_store.image_preview_cache_path(image_id, 640).unlink(missing_ok=True)

        initial_response = self.client.get(
            f"/api/sites/{self.site_id}/images?patient_id=HTTP-001&visit_date=Initial",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        self.assertEqual(initial_response.status_code, 200, initial_response.text)

        deadline = time.time() + 5.0
        while time.time() < deadline:
            refreshed_response = self.client.get(
                f"/api/sites/{self.site_id}/images?patient_id=HTTP-001&visit_date=Initial",
                headers={"Authorization": f"Bearer {admin_token}"},
            )
            if (
                refreshed_response.status_code == 200
                and refreshed_response.json()
                and refreshed_response.json()[0].get("quality_scores")
                and self.site_store.image_preview_cache_path(image_id, 256).exists()
                and self.site_store.image_preview_cache_path(image_id, 640).exists()
            ):
                break
            time.sleep(0.1)
        else:
            self.fail("background derivative backfill did not complete in time")

    def test_workspace_json_endpoints_emit_private_cache_headers_http(self):
        admin_token = self._login("admin", "admin123")
        self._seed_case(admin_token, patient_id="HTTP-001", visit_date="Initial")

        paths = [
            f"/api/sites/{self.site_id}/cases",
            f"/api/sites/{self.site_id}/patients/list-board?page=1&page_size=25",
            f"/api/sites/{self.site_id}/images?patient_id=HTTP-001&visit_date=Initial",
            f"/api/sites/{self.site_id}/cases/history?patient_id=HTTP-001&visit_date=Initial",
        ]
        for path in paths:
            response = self.client.get(
                path,
                headers={"Authorization": f"Bearer {admin_token}"},
            )
            self.assertEqual(response.status_code, 200, response.text)
            self.assertIn("private", response.headers.get("cache-control", ""))
            self.assertIn("max-age", response.headers.get("cache-control", ""))
            self.assertEqual(response.headers.get("vary"), "Authorization")

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
        completed_job = None
        for _ in range(80):
            completed_job = self.site_store.get_job(first_payload["job"]["job_id"])
            if completed_job is not None and completed_job.get("status") == "completed":
                break
            time.sleep(0.1)
        self.assertIsNotNone(completed_job)
        self.assertEqual(completed_job.get("status"), "completed")
        for _ in range(20):
            if not dict(self.app_module._PENDING_EMBEDDING_JOBS):
                break
            time.sleep(0.05)

    def test_federated_retrieval_sync_route_http(self):
        admin_token = self._login("admin", "admin123")
        self._seed_case(admin_token, patient_id="HTTP-001", visit_date="Initial")
        self._join_and_include_research_case(
            admin_token,
            patient_id="HTTP-001",
            visit_date="Initial",
        )

        class FederatedRetrievalWorkflow(FakeWorkflow):
            def __init__(self, app_module, control_plane):
                super().__init__(app_module, control_plane)
                self.sync_calls: list[dict[str, Any]] = []

            def sync_remote_retrieval_corpus(
                self,
                site_store,
                *,
                execution_device,
                retrieval_profile="dinov2_lesion_crop",
                force_refresh=False,
                progress_callback=None,
            ):
                self.sync_calls.append(
                    {
                        "site_id": site_store.site_id,
                        "execution_device": execution_device,
                        "retrieval_profile": retrieval_profile,
                        "force_refresh": force_refresh,
                    }
                )
                if callable(progress_callback):
                    progress_callback({"stage": "uploading_entries", "message": "Uploading.", "percent": 75})
                return {
                    "site_id": site_store.site_id,
                    "profile_id": retrieval_profile,
                    "retrieval_signature": "abc123def4567890",
                    "eligible_case_count": 1,
                    "prepared_entry_count": 1,
                    "remote_sync": {
                        "inserted_count": 1,
                        "updated_count": 0,
                        "deleted_count": 0,
                        "batch_size": 32,
                        "batches": [{"inserted_count": 1, "updated_count": 0, "deleted_count": 0, "batch_size": 1}],
                    },
                }

        fake_workflow = FederatedRetrievalWorkflow(self.app_module, self.cp)
        lazy_cp = self.app_module.get_control_plane()
        with patch.object(self.app_module, "_get_workflow", return_value=fake_workflow), patch.object(
            lazy_cp,
            "remote_node_sync_enabled",
            return_value=True,
        ):
            response = self.client.post(
                f"/api/sites/{self.site_id}/ai-clinic/retrieval-corpus/sync",
                headers={"Authorization": f"Bearer {admin_token}"},
                json={
                    "execution_mode": "cpu",
                    "retrieval_profile": "dinov2_lesion_crop",
                    "force_refresh": True,
                },
            )

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["site_id"], self.site_id)
        self.assertEqual(payload["retrieval_profile"], "dinov2_lesion_crop")
        self.assertEqual(payload["job"]["job_type"], "federated_retrieval_corpus_sync")
        self.assertEqual(payload["job"]["status"], "queued")
        self.assertEqual(len(fake_workflow.sync_calls), 0)

        processed = self._run_site_jobs(workflow=fake_workflow)
        self.assertEqual(processed, 1)
        self.assertEqual(len(fake_workflow.sync_calls), 1)
        self.assertEqual(fake_workflow.sync_calls[0]["execution_device"], "cpu")
        self.assertTrue(fake_workflow.sync_calls[0]["force_refresh"])

        job = self.site_store.get_job(payload["job"]["job_id"])
        self.assertIsNotNone(job)
        self.assertEqual(job["status"], "completed")
        self.assertEqual(job["result"]["response"]["profile_id"], "dinov2_lesion_crop")
        self.assertEqual(job["result"]["response"]["remote_sync"]["inserted_count"], 1)
        self.assertEqual(job["result"]["response"]["remote_sync"]["deleted_count"], 0)

    def test_federated_retrieval_status_route_http(self):
        admin_token = self._login("admin", "admin123")
        self._seed_case(admin_token, patient_id="HTTP-002", visit_date="Initial")
        self._join_and_include_research_case(
            admin_token,
            patient_id="HTTP-002",
            visit_date="Initial",
        )

        class FederatedRetrievalStatusWorkflow(FakeWorkflow):
            def retrieval_signature(self, retrieval_profile="dinov2_lesion_crop"):
                return {
                    "profile_id": retrieval_profile,
                    "retrieval_signature": "statussig12345678",
                    "profile_metadata": {
                        "label": "DINOv2 lesion-crop retrieval",
                    },
                    "model_version": {
                        "version_id": "retrieval_profile_dinov2_lesion_crop",
                        "architecture": "retrieval_dinov2",
                    },
                }

        fake_workflow = FederatedRetrievalStatusWorkflow(self.app_module, self.cp)
        lazy_cp = self.app_module.get_control_plane()
        with patch.object(self.app_module, "_get_workflow", return_value=fake_workflow), patch.object(
            lazy_cp,
            "remote_node_sync_enabled",
            return_value=True,
        ):
            response = self.client.get(
                f"/api/sites/{self.site_id}/ai-clinic/retrieval-corpus/status?retrieval_profile=dinov2_lesion_crop",
                headers={"Authorization": f"Bearer {admin_token}"},
            )

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["site_id"], self.site_id)
        self.assertEqual(payload["retrieval_profile"], "dinov2_lesion_crop")
        self.assertEqual(payload["profile_id"], "dinov2_lesion_crop")
        self.assertEqual(payload["retrieval_signature"], "statussig12345678")
        self.assertEqual(payload["eligible_case_count"], 1)
        self.assertEqual(payload["skipped"]["not_positive"], 0)
        self.assertTrue(payload["remote_node_sync_enabled"])
        self.assertIsNone(payload["active_job"])

    def test_federated_retrieval_status_clears_active_job_after_completion_http(self):
        admin_token = self._login("admin", "admin123")
        self._seed_case(admin_token, patient_id="HTTP-RETR-STATUS-CLEAR-001", visit_date="Initial")
        self._join_and_include_research_case(
            admin_token,
            patient_id="HTTP-RETR-STATUS-CLEAR-001",
            visit_date="Initial",
        )
        retrieval_job = self.site_store.enqueue_job(
            "federated_retrieval_corpus_sync",
            {
                "retrieval_profile": "dinov2_lesion_crop",
                "execution_device": "cpu",
                "force_refresh": True,
            },
            queue_name="training",
        )
        self.site_store.update_job_status(
            retrieval_job["job_id"],
            "completed",
            {"progress": {"stage": "completed", "message": "done", "percent": 100}},
        )

        class FederatedRetrievalStatusWorkflow(FakeWorkflow):
            def retrieval_signature(self, retrieval_profile="dinov2_lesion_crop"):
                return {
                    "profile_id": retrieval_profile,
                    "retrieval_signature": "statussig12345678",
                    "profile_metadata": {
                        "label": "DINOv2 lesion-crop retrieval",
                    },
                    "model_version": {
                        "version_id": "retrieval_profile_dinov2_lesion_crop",
                        "architecture": "retrieval_dinov2",
                    },
                }

        fake_workflow = FederatedRetrievalStatusWorkflow(self.app_module, self.cp)
        lazy_cp = self.app_module.get_control_plane()
        with patch.object(self.app_module, "_get_workflow", return_value=fake_workflow), patch.object(
            lazy_cp,
            "remote_node_sync_enabled",
            return_value=True,
        ):
            response = self.client.get(
                f"/api/sites/{self.site_id}/ai-clinic/retrieval-corpus/status?retrieval_profile=dinov2_lesion_crop",
                headers={"Authorization": f"Bearer {admin_token}"},
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertIsNone(response.json()["active_job"])

    def test_federated_retrieval_auto_sync_delays_image_upload_trigger_http(self):
        job_key = (self.site_id, "dinov2_lesion_crop")
        self.app_module._PENDING_FEDERATED_RETRIEVAL_SYNC_JOBS.clear()
        self.app_module._PENDING_FEDERATED_RETRIEVAL_SYNC_TRIGGERS.clear()
        try:
            fake_executor = Mock()
            fake_schedule = Mock()
            with patch.dict(
                os.environ,
                {
                    "KERA_FEDERATED_RETRIEVAL_SYNC_UPLOAD_DELAY_SECONDS": "11",
                    "KERA_DISABLE_FEDERATED_RETRIEVAL_AUTO_SYNC": "0",
                },
                clear=False,
            ):
                with patch.object(self.app_module, "control_plane_split_enabled", return_value=False):
                    with patch.object(self.cp, "remote_node_sync_enabled", return_value=True):
                        with patch.object(self.app_module, "_FEDERATED_RETRIEVAL_SYNC_EXECUTOR", fake_executor):
                            with patch.object(self.app_module, "_submit_executor_job_after_delay", fake_schedule):
                                result = self.app_module._queue_federated_retrieval_corpus_sync(
                                    self.cp,
                                    self.site_store,
                                    trigger="image_upload",
                                )

            self.assertTrue(result["queued"])
            self.assertEqual(fake_schedule.call_count, 1)
            submitted_executor = fake_schedule.call_args.args[0]
            submitted_fn = fake_schedule.call_args.args[1]
            submitted_key = fake_schedule.call_args.args[2]
            submitted_profile = fake_schedule.call_args.args[3]
            submitted_trigger = fake_schedule.call_args.args[4]
            submitted_delay = fake_schedule.call_args.args[5]
            self.assertIs(submitted_executor, fake_executor)
            self.assertTrue(callable(submitted_fn))
            self.assertEqual(submitted_key, job_key)
            self.assertEqual(submitted_profile, "dinov2_lesion_crop")
            self.assertEqual(submitted_trigger, "image_upload")
            self.assertEqual(submitted_delay, 11.0)
            self.assertEqual(fake_schedule.call_args.kwargs["delay_seconds"], 11.0)
        finally:
            self.app_module._PENDING_FEDERATED_RETRIEVAL_SYNC_JOBS.clear()
            self.app_module._PENDING_FEDERATED_RETRIEVAL_SYNC_TRIGGERS.clear()

    def test_federated_retrieval_auto_sync_rechecks_running_job_without_sleep_http(self):
        job_key = (self.site_id, "dinov2_lesion_crop")
        self.app_module._PENDING_FEDERATED_RETRIEVAL_SYNC_JOBS.clear()
        self.app_module._PENDING_FEDERATED_RETRIEVAL_SYNC_TRIGGERS.clear()
        try:
            fake_executor = Mock()
            scheduled_calls: list[tuple[Any, Any, tuple[Any, ...], float]] = []

            def capture_schedule(executor, fn, *args, delay_seconds):
                scheduled_calls.append((executor, fn, args, float(delay_seconds)))

            running_job = {"job_id": "retrieval-job-1", "status": "running"}
            completed_job = {"job_id": "retrieval-job-1", "status": "completed"}
            with patch.dict(
                os.environ,
                {
                    "KERA_FEDERATED_RETRIEVAL_SYNC_DEFAULT_DELAY_SECONDS": "7",
                    "KERA_FEDERATED_RETRIEVAL_SYNC_POLL_SECONDS": "2",
                    "KERA_FEDERATED_RETRIEVAL_SYNC_MAX_WAIT_SECONDS": "30",
                    "KERA_DISABLE_FEDERATED_RETRIEVAL_AUTO_SYNC": "0",
                },
                clear=False,
            ):
                with patch.object(self.app_module, "control_plane_split_enabled", return_value=False):
                    with patch.object(self.cp, "remote_node_sync_enabled", return_value=True):
                        with patch.object(self.app_module, "_FEDERATED_RETRIEVAL_SYNC_EXECUTOR", fake_executor):
                            with patch.object(self.app_module, "_submit_executor_job_after_delay", side_effect=capture_schedule):
                                with patch.object(
                                    self.app_module,
                                    "_latest_federated_retrieval_sync_job_impl",
                                    return_value=dict(running_job),
                                ):
                                    with patch.object(
                                        self.app_module,
                                        "_start_federated_retrieval_corpus_sync_impl",
                                    ) as start_sync:
                                        with patch.object(
                                            self.site_store,
                                            "get_job",
                                            side_effect=[dict(running_job), dict(completed_job)],
                                        ) as get_job:
                                            result = self.app_module._queue_federated_retrieval_corpus_sync(
                                                self.cp,
                                                self.site_store,
                                                trigger="save_case",
                                            )
                                            self.assertTrue(result["queued"])
                                            self.assertEqual(len(scheduled_calls), 1)
                                            self.assertEqual(scheduled_calls[0][3], 7.0)

                                            initial_fn = scheduled_calls[0][1]
                                            initial_args = scheduled_calls[0][2]
                                            with patch.object(
                                                self.app_module.time,
                                                "sleep",
                                                side_effect=AssertionError("sleep should not be called"),
                                            ):
                                                initial_fn(*initial_args)
                                                self.assertEqual(len(scheduled_calls), 2)
                                                self.assertEqual(scheduled_calls[1][3], 2.0)

                                                poll_fn = scheduled_calls[1][1]
                                                poll_args = scheduled_calls[1][2]
                                                poll_fn(*poll_args)

                                            start_sync.assert_not_called()
                                            self.assertEqual(get_job.call_count, 2)

            self.assertNotIn(job_key, self.app_module._PENDING_FEDERATED_RETRIEVAL_SYNC_JOBS)
            self.assertNotIn(job_key, self.app_module._PENDING_FEDERATED_RETRIEVAL_SYNC_TRIGGERS)
        finally:
            self.app_module._PENDING_FEDERATED_RETRIEVAL_SYNC_JOBS.clear()
            self.app_module._PENDING_FEDERATED_RETRIEVAL_SYNC_TRIGGERS.clear()

    def test_ai_clinic_vector_index_rebuild_uses_delayed_submission_http(self):
        job_key = (self.site_id, "model-1")
        self.app_module._PENDING_VECTOR_INDEX_REBUILD_JOBS.clear()
        self.app_module._PENDING_VECTOR_INDEX_REBUILD_TRIGGERS.clear()
        try:
            fake_executor = Mock()
            fake_schedule = Mock()
            with patch.dict(
                os.environ,
                {
                    "KERA_CASE_VECTOR_INDEX_DEFAULT_DELAY_SECONDS": "7",
                    "KERA_DISABLE_CASE_EMBEDDING_REFRESH": "0",
                },
                clear=False,
            ):
                with patch.object(
                    self.app_module,
                    "control_plane_split_enabled",
                    return_value=False,
                ):
                    with patch.object(
                        self.cp,
                        "current_global_model",
                        return_value={"version_id": "model-1", "ready": True},
                    ):
                        with patch.object(
                            self.app_module,
                            "_VECTOR_INDEX_REBUILD_EXECUTOR",
                            fake_executor,
                        ):
                            with patch.object(
                                self.app_module,
                                "_submit_executor_job_after_delay",
                                fake_schedule,
                            ):
                                result = self.app_module._queue_ai_clinic_vector_index_rebuild(
                                    self.cp,
                                    self.site_store,
                                    trigger="image_upload",
                                )

            self.assertTrue(result["queued"])
            self.assertEqual(result["model_version_id"], "model-1")
            fake_schedule.assert_called_once()
            submitted_executor = fake_schedule.call_args.args[0]
            submitted_fn = fake_schedule.call_args.args[1]
            submitted_key = fake_schedule.call_args.args[2]
            submitted_trigger = fake_schedule.call_args.args[3]
            submitted_delay = fake_schedule.call_args.args[4]
            self.assertIs(submitted_executor, fake_executor)
            self.assertTrue(callable(submitted_fn))
            self.assertEqual(submitted_key, job_key)
            self.assertEqual(submitted_trigger, "image_upload")
            self.assertEqual(submitted_delay, 7.0)
            self.assertEqual(
                fake_schedule.call_args.kwargs["delay_seconds"],
                7.0,
            )
        finally:
            self.app_module._PENDING_VECTOR_INDEX_REBUILD_JOBS.clear()
            self.app_module._PENDING_VECTOR_INDEX_REBUILD_TRIGGERS.clear()

    def test_desktop_internal_federated_retrieval_queue_route_http(self):
        self.app_module._PENDING_FEDERATED_RETRIEVAL_SYNC_JOBS.clear()
        self.app_module._PENDING_FEDERATED_RETRIEVAL_SYNC_TRIGGERS.clear()
        try:
            fake_schedule = Mock()
            lazy_cp = self.app_module.get_control_plane()
            with patch.dict(
                os.environ,
                {
                    "KERA_RUNTIME_OWNER": "desktop-owner-test",
                    "KERA_DISABLE_FEDERATED_RETRIEVAL_AUTO_SYNC": "0",
                },
                clear=False,
            ):
                with patch.object(self.app_module, "control_plane_split_enabled", return_value=False):
                    with patch.object(lazy_cp, "remote_node_sync_enabled", return_value=True):
                        with patch.object(self.app_module, "_submit_executor_job_after_delay", fake_schedule):
                            response = self.client.post(
                                f"/api/desktop/internal/sites/{self.site_id}/ai-clinic/retrieval-corpus/queue?trigger=visit_update",
                                headers={"x-kera-control-plane-owner": "desktop-owner-test"},
                                json={"retrieval_profile": "dinov2_lesion_crop"},
                            )

            self.assertEqual(response.status_code, 200, response.text)
            payload = response.json()
            self.assertTrue(payload["queued"])
            self.assertEqual(payload["retrieval_profile"], "dinov2_lesion_crop")
            fake_schedule.assert_called_once()
            self.assertIs(fake_schedule.call_args.args[0], self.app_module._FEDERATED_RETRIEVAL_SYNC_EXECUTOR)
            self.assertEqual(fake_schedule.call_args.kwargs["delay_seconds"], payload["delay_seconds"])
        finally:
            self.app_module._PENDING_FEDERATED_RETRIEVAL_SYNC_JOBS.clear()
            self.app_module._PENDING_FEDERATED_RETRIEVAL_SYNC_TRIGGERS.clear()

    def test_desktop_internal_case_embedding_queue_route_http(self):
        self.app_module._PENDING_EMBEDDING_JOBS.clear()
        self.app_module._PENDING_EMBEDDING_TRIGGERS.clear()
        try:
            fake_schedule = Mock()
            with patch.dict(
                os.environ,
                {
                    "KERA_RUNTIME_OWNER": "desktop-owner-test",
                    "KERA_DISABLE_CASE_EMBEDDING_REFRESH": "0",
                },
                clear=False,
            ):
                with patch.object(self.app_module, "control_plane_split_enabled", return_value=False):
                    with patch.object(self.cp, "current_global_model", return_value={"version_id": "model-1", "ready": True}):
                        with patch.object(self.app_module, "_submit_executor_job_after_delay", fake_schedule):
                            response = self.client.post(
                                f"/api/desktop/internal/sites/{self.site_id}/cases/HTTP-001/visits/Initial/ai-clinic/embeddings/queue?trigger=image_upload",
                                headers={"x-kera-control-plane-owner": "desktop-owner-test"},
                            )

            self.assertEqual(response.status_code, 200, response.text)
            payload = response.json()
            self.assertTrue(payload["queued"])
            self.assertEqual(payload["patient_id"], "HTTP-001")
            self.assertEqual(payload["visit_date"], "Initial")
            fake_schedule.assert_called_once()
            self.assertIs(fake_schedule.call_args.args[0], self.app_module._EMBEDDING_INDEX_EXECUTOR)
            self.assertGreater(float(fake_schedule.call_args.kwargs["delay_seconds"]), 0.0)
        finally:
            self.app_module._PENDING_EMBEDDING_JOBS.clear()
            self.app_module._PENDING_EMBEDDING_TRIGGERS.clear()

    def test_delete_images_queues_ai_clinic_vector_index_rebuild_http(self):
        token = self._token_for_username("http_researcher")
        self._seed_case(token, patient_id="HTTP-VECTOR-001", visit_date="Initial")

        self.app_module._PENDING_VECTOR_INDEX_REBUILD_JOBS.clear()
        self.app_module._PENDING_VECTOR_INDEX_REBUILD_TRIGGERS.clear()
        try:
            fake_schedule = Mock()
            lazy_cp = self.app_module.get_control_plane()
            with patch.dict(os.environ, {"KERA_DISABLE_CASE_EMBEDDING_REFRESH": "0"}, clear=False):
                with patch.object(self.app_module, "control_plane_split_enabled", return_value=False):
                    with patch.object(lazy_cp, "current_global_model", return_value={"version_id": "model-1", "ready": True}):
                        with patch.object(self.app_module, "_submit_executor_job_after_delay", fake_schedule):
                            response = self.client.delete(
                                f"/api/sites/{self.site_id}/images?patient_id=HTTP-VECTOR-001&visit_date=Initial",
                                headers={"Authorization": f"Bearer {token}"},
                            )

            self.assertEqual(response.status_code, 200, response.text)
            fake_schedule.assert_called_once()
            self.assertIs(fake_schedule.call_args.args[0], self.app_module._VECTOR_INDEX_REBUILD_EXECUTOR)
            self.assertGreater(float(fake_schedule.call_args.kwargs["delay_seconds"]), 0.0)
        finally:
            self.app_module._PENDING_VECTOR_INDEX_REBUILD_JOBS.clear()
            self.app_module._PENDING_VECTOR_INDEX_REBUILD_TRIGGERS.clear()

    def test_bulk_import_queues_ai_clinic_embedding_backfill_http(self):
        admin_token = self._token_for_username("admin")
        lazy_cp = self.app_module.get_control_plane()

        projects_response = self.client.get("/api/admin/projects", headers={"Authorization": f"Bearer {admin_token}"})
        self.assertEqual(projects_response.status_code, 200, projects_response.text)
        project_id = projects_response.json()[0]["project_id"]

        create_site_response = self.client.post(
            "/api/admin/sites",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "project_id": project_id,
                "hospital_name": "Import Backfill Hospital",
                "source_institution_id": "OPS_HTTP_BACKFILL",
            },
        )
        self.assertEqual(create_site_response.status_code, 200, create_site_response.text)
        site_id = create_site_response.json()["site_id"]

        csv_content = (
            "patient_id,chart_alias,local_case_code,sex,age,visit_date,actual_visit_date,culture_status,culture_category,culture_species,"
            "contact_lens_use,predisposing_factor,visit_status,active_stage,smear_result,polymicrobial,other_history,image_filename,view,is_representative\n"
            "OPS-B-001,OPS-B-001,CASE-B-001,female,49,Initial,2026-03-11,positive,fungal,Fusarium,none,trauma,active,TRUE,unknown,FALSE,,ops_b_001_white.jpg,white,TRUE\n"
        ).encode("utf-8")
        archive_buffer = io.BytesIO()
        with zipfile.ZipFile(archive_buffer, "w") as archive:
            archive.writestr("ops_b_001_white.jpg", self._make_test_image_bytes("JPEG", (110, 90, 40)))

        with patch.dict(os.environ, {"KERA_DISABLE_CASE_EMBEDDING_REFRESH": "0"}, clear=False):
            with patch.object(self.app_module, "control_plane_split_enabled", return_value=False):
                with patch.object(lazy_cp, "current_global_model", return_value={"version_id": "model-1", "ready": True}):
                    with patch.object(self.app_module, "_latest_embedding_backfill_job", return_value=None):
                        with patch.object(
                            self.app_module,
                            "_queue_site_embedding_backfill_impl",
                            return_value={"job_id": "job-backfill-1", "status": "running"},
                        ) as queue_mock:
                            import_response = self.client.post(
                                f"/api/sites/{site_id}/import/bulk",
                                headers={"Authorization": f"Bearer {admin_token}"},
                                files=[
                                    ("csv_file", ("ops_import_backfill.csv", csv_content, "text/csv")),
                                    ("files", ("ops_backfill_images.zip", archive_buffer.getvalue(), "application/zip")),
                                ],
                            )

        self.assertEqual(import_response.status_code, 200, import_response.text)
        self.assertEqual(queue_mock.call_count, 1)
        self.assertEqual(queue_mock.call_args.kwargs["trigger"], "bulk_import")

    def test_site_admin_recover_metadata_queues_ai_clinic_embedding_backfill_http(self):
        site_admin_token = self._token_for_username("http_site_admin")
        patient_id = "00324194"
        self.site_store.create_patient(patient_id, "female", 54, created_by_user_id="owner")
        self.site_store.create_visit(
            patient_id=patient_id,
            visit_date="Initial",
            actual_visit_date="2026-03-17",
            culture_confirmed=True,
            culture_category="bacterial",
            culture_species="Bacillus",
            additional_organisms=[],
            contact_lens_use="none",
            predisposing_factor=["trauma"],
            other_history="",
            created_by_user_id="owner",
        )
        self.site_store.generate_manifest()
        self.site_store.export_metadata_backup()
        self.site_store._clear_site_metadata_rows()

        lazy_cp = self.app_module.get_control_plane()
        with patch.dict(os.environ, {"KERA_DISABLE_CASE_EMBEDDING_REFRESH": "0"}, clear=False):
            with patch.object(self.app_module, "control_plane_split_enabled", return_value=False):
                with patch.object(lazy_cp, "current_global_model", return_value={"version_id": "model-1", "ready": True}):
                    with patch.object(self.app_module, "_latest_embedding_backfill_job", return_value=None):
                        with patch.object(
                            self.app_module,
                            "_queue_site_embedding_backfill_impl",
                            return_value={"job_id": "job-backfill-2", "status": "running"},
                        ) as queue_mock:
                            response = self.client.post(
                                f"/api/admin/sites/{self.site_id}/metadata/recover",
                                headers={"Authorization": f"Bearer {site_admin_token}"},
                                json={"source": "auto", "force_replace": True},
                            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(queue_mock.call_count, 1)
        self.assertEqual(queue_mock.call_args.kwargs["trigger"], "metadata_recover")

    def test_site_admin_sync_raw_inventory_queues_ai_clinic_embedding_backfill_http(self):
        site_admin_token = self._token_for_username("http_site_admin")
        visit_dir = self.site_store.raw_dir / "00415031" / "Initial"
        visit_dir.mkdir(parents=True, exist_ok=True)
        (visit_dir / "http_sync_slit.png").write_bytes(self._make_test_image_bytes())

        lazy_cp = self.app_module.get_control_plane()
        with patch.dict(os.environ, {"KERA_DISABLE_CASE_EMBEDDING_REFRESH": "0"}, clear=False):
            with patch.object(self.app_module, "control_plane_split_enabled", return_value=False):
                with patch.object(lazy_cp, "current_global_model", return_value={"version_id": "model-1", "ready": True}):
                    with patch.object(self.app_module, "_latest_embedding_backfill_job", return_value=None):
                        with patch.object(
                            self.app_module,
                            "_queue_site_embedding_backfill_impl",
                            return_value={"job_id": "job-backfill-3", "status": "running"},
                        ) as queue_mock:
                            response = self.client.post(
                                f"/api/admin/sites/{self.site_id}/metadata/sync-raw",
                                headers={"Authorization": f"Bearer {site_admin_token}"},
                            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(queue_mock.call_count, 1)
        self.assertEqual(queue_mock.call_args.kwargs["trigger"], "raw_inventory_sync")

    def test_create_visit_queues_federated_retrieval_auto_sync_http(self):
        token = self._token_for_username("http_researcher")
        create_patient_response = self.client.post(
            f"/api/sites/{self.site_id}/patients",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "patient_id": "HTTP-AUTO-SYNC-001",
                "sex": "female",
                "age": 47,
                "chart_alias": "",
                "local_case_code": "",
            },
        )
        self.assertEqual(create_patient_response.status_code, 200, create_patient_response.text)

        self.app_module._PENDING_FEDERATED_RETRIEVAL_SYNC_JOBS.clear()
        self.app_module._PENDING_FEDERATED_RETRIEVAL_SYNC_TRIGGERS.clear()
        try:
            fake_schedule = Mock()
            lazy_cp = self.app_module.get_control_plane()
            with patch.dict(os.environ, {"KERA_DISABLE_FEDERATED_RETRIEVAL_AUTO_SYNC": "0"}, clear=False):
                with patch.object(self.app_module, "control_plane_split_enabled", return_value=False):
                    with patch.object(lazy_cp, "remote_node_sync_enabled", return_value=True):
                        with patch.object(self.app_module, "_submit_executor_job_after_delay", fake_schedule):
                            response = self.client.post(
                                f"/api/sites/{self.site_id}/visits",
                                headers={"Authorization": f"Bearer {token}"},
                                json={
                                    "patient_id": "HTTP-AUTO-SYNC-001",
                                    "visit_date": "Initial",
                                    "culture_status": "unknown",
                                    "culture_confirmed": False,
                                    "culture_category": "",
                                    "culture_species": "",
                                    "additional_organisms": [],
                                    "contact_lens_use": "none",
                                    "predisposing_factor": [],
                                    "other_history": "",
                                    "visit_status": "active",
                                    "is_initial_visit": True,
                                    "smear_result": "not done",
                                    "polymicrobial": False,
                                },
                            )

            self.assertEqual(response.status_code, 200, response.text)
            fake_schedule.assert_called_once()
            self.assertIs(fake_schedule.call_args.args[0], self.app_module._FEDERATED_RETRIEVAL_SYNC_EXECUTOR)
            self.assertGreater(float(fake_schedule.call_args.kwargs["delay_seconds"]), 0.0)
        finally:
            self.app_module._PENDING_FEDERATED_RETRIEVAL_SYNC_JOBS.clear()
            self.app_module._PENDING_FEDERATED_RETRIEVAL_SYNC_TRIGGERS.clear()

    def test_case_embedding_refresh_delays_image_upload_trigger_http(self):
        job_key = (self.site_id, "HTTP-001", "Initial")
        self.app_module._PENDING_EMBEDDING_JOBS.clear()
        self.app_module._PENDING_EMBEDDING_TRIGGERS.clear()
        try:
            fake_executor = Mock()
            fake_schedule = Mock()
            with patch.dict(
                os.environ,
                {
                    "KERA_CASE_EMBEDDING_UPLOAD_DELAY_SECONDS": "7",
                    "KERA_DISABLE_CASE_EMBEDDING_REFRESH": "0",
                },
                clear=False,
            ):
                with patch.object(self.app_module, "control_plane_split_enabled", return_value=False):
                    with patch.object(self.cp, "current_global_model", return_value={"version_id": "model-1", "ready": True}):
                        with patch.object(self.app_module, "_EMBEDDING_INDEX_EXECUTOR", fake_executor):
                            with patch.object(self.app_module, "_submit_executor_job_after_delay", fake_schedule):
                                self.app_module._queue_case_embedding_refresh(
                                    self.cp,
                                    self.site_store,
                                    patient_id="HTTP-001",
                                    visit_date="Initial",
                                    trigger="image_upload",
                                )

            self.assertEqual(fake_schedule.call_count, 1)
            submitted_executor = fake_schedule.call_args.args[0]
            submitted_fn = fake_schedule.call_args.args[1]
            submitted_key = fake_schedule.call_args.args[2]
            submitted_trigger = fake_schedule.call_args.args[3]
            submitted_embedding_delay = fake_schedule.call_args.args[4]
            submitted_index_delay = fake_schedule.call_args.args[5]
            self.assertIs(submitted_executor, fake_executor)
            self.assertTrue(callable(submitted_fn))
            self.assertEqual(submitted_key, job_key)
            self.assertEqual(submitted_trigger, "image_upload")
            self.assertEqual(submitted_embedding_delay, 7.0)
            self.assertEqual(submitted_index_delay, 7.0)
            self.assertEqual(fake_schedule.call_args.kwargs["delay_seconds"], 7.0)
        finally:
            self.app_module._PENDING_EMBEDDING_JOBS.clear()
            self.app_module._PENDING_EMBEDDING_TRIGGERS.clear()

    def test_case_embedding_refresh_keeps_non_save_triggers_immediate_http(self):
        job_key = (self.site_id, "HTTP-001", "Initial")
        self.app_module._PENDING_EMBEDDING_JOBS.clear()
        self.app_module._PENDING_EMBEDDING_TRIGGERS.clear()
        try:
            fake_executor = Mock()
            with patch.dict(os.environ, {"KERA_DISABLE_CASE_EMBEDDING_REFRESH": "0"}, clear=False):
                with patch.object(self.app_module, "control_plane_split_enabled", return_value=False):
                    with patch.object(self.cp, "current_global_model", return_value={"version_id": "model-1", "ready": True}):
                        with patch.object(self.app_module, "_EMBEDDING_INDEX_EXECUTOR", fake_executor):
                            self.app_module._queue_case_embedding_refresh(
                                self.cp,
                                self.site_store,
                                patient_id="HTTP-001",
                                visit_date="Initial",
                                trigger="lesion_box_update",
                            )

            self.assertEqual(fake_executor.submit.call_count, 1)
            submitted_fn, submitted_key, submitted_trigger, submitted_embedding_delay, submitted_index_delay = fake_executor.submit.call_args[0]
            self.assertTrue(callable(submitted_fn))
            self.assertEqual(submitted_key, job_key)
            self.assertEqual(submitted_trigger, "lesion_box_update")
            self.assertEqual(submitted_embedding_delay, 0.0)
            self.assertEqual(submitted_index_delay, 0.0)
        finally:
            self.app_module._PENDING_EMBEDDING_JOBS.clear()
            self.app_module._PENDING_EMBEDDING_TRIGGERS.clear()

    def test_case_embedding_refresh_delays_representative_change_trigger_http(self):
        job_key = (self.site_id, "HTTP-001", "Initial")
        self.app_module._PENDING_EMBEDDING_JOBS.clear()
        self.app_module._PENDING_EMBEDDING_TRIGGERS.clear()
        try:
            fake_executor = Mock()
            fake_schedule = Mock()
            with patch.dict(
                os.environ,
                {
                    "KERA_CASE_EMBEDDING_REPRESENTATIVE_DELAY_SECONDS": "20",
                    "KERA_CASE_VECTOR_INDEX_REPRESENTATIVE_DELAY_SECONDS": "60",
                    "KERA_DISABLE_CASE_EMBEDDING_REFRESH": "0",
                },
                clear=False,
            ):
                with patch.object(self.app_module, "control_plane_split_enabled", return_value=False):
                    with patch.object(self.cp, "current_global_model", return_value={"version_id": "model-1", "ready": True}):
                        with patch.object(self.app_module, "_EMBEDDING_INDEX_EXECUTOR", fake_executor):
                            with patch.object(self.app_module, "_submit_executor_job_after_delay", fake_schedule):
                                self.app_module._queue_case_embedding_refresh(
                                    self.cp,
                                    self.site_store,
                                    patient_id="HTTP-001",
                                    visit_date="Initial",
                                    trigger="representative_change",
                                )

            self.assertEqual(fake_schedule.call_count, 1)
            submitted_executor = fake_schedule.call_args.args[0]
            submitted_fn = fake_schedule.call_args.args[1]
            submitted_key = fake_schedule.call_args.args[2]
            submitted_trigger = fake_schedule.call_args.args[3]
            submitted_embedding_delay = fake_schedule.call_args.args[4]
            submitted_index_delay = fake_schedule.call_args.args[5]
            self.assertIs(submitted_executor, fake_executor)
            self.assertTrue(callable(submitted_fn))
            self.assertEqual(submitted_key, job_key)
            self.assertEqual(submitted_trigger, "representative_change")
            self.assertEqual(submitted_embedding_delay, 20.0)
            self.assertEqual(submitted_index_delay, 60.0)
            self.assertEqual(fake_schedule.call_args.kwargs["delay_seconds"], 20.0)
        finally:
            self.app_module._PENDING_EMBEDDING_JOBS.clear()
            self.app_module._PENDING_EMBEDDING_TRIGGERS.clear()

    def test_case_embedding_refresh_runs_embeddings_before_vector_index_http(self):
        job_key = (self.site_id, "HTTP-001", "Initial")
        self.app_module._PENDING_EMBEDDING_JOBS.clear()
        self.app_module._PENDING_EMBEDDING_TRIGGERS.clear()
        try:
            fake_executor = Mock()
            outer_schedule = Mock()
            fake_workflow = Mock()
            fake_workflow.index_case_embedding.return_value = {
                "case_id": "HTTP-001::Initial",
                "patient_id": "HTTP-001",
                "visit_date": "Initial",
                "model_version_id": "model-1",
                "embedding_dim": 256,
                "embedding_dims": {"classifier": 256, "dinov2": 768},
                "available_backends": ["classifier", "dinov2"],
                "dinov2_error": None,
                "biomedclip_error": "not-configured",
                "status": "cached",
            }
            fake_workflow.rebuild_case_vector_index.side_effect = lambda site_store, *, model_version, backend: {
                "backend": backend,
                "count": 1,
                "dimension": 256 if backend == "classifier" else 768,
            }

            with patch.dict(
                os.environ,
                {
                    "KERA_CASE_EMBEDDING_REPRESENTATIVE_DELAY_SECONDS": "2",
                    "KERA_CASE_VECTOR_INDEX_REPRESENTATIVE_DELAY_SECONDS": "5",
                    "KERA_DISABLE_CASE_EMBEDDING_REFRESH": "0",
                },
                clear=False,
            ):
                with patch.object(self.app_module, "control_plane_split_enabled", return_value=False):
                    with patch.object(self.cp, "current_global_model", return_value={"version_id": "model-1", "ready": True}):
                        with patch.object(self.app_module, "_EMBEDDING_INDEX_EXECUTOR", fake_executor):
                            with patch.object(self.app_module, "_submit_executor_job_after_delay", outer_schedule):
                                self.app_module._queue_case_embedding_refresh(
                                    self.cp,
                                    self.site_store,
                                    patient_id="HTTP-001",
                                    visit_date="Initial",
                                    trigger="representative_change",
                                )

            submitted_fn = outer_schedule.call_args.args[1]
            submitted_key = outer_schedule.call_args.args[2]
            submitted_trigger = outer_schedule.call_args.args[3]
            submitted_embedding_delay = outer_schedule.call_args.args[4]
            submitted_index_delay = outer_schedule.call_args.args[5]
            with patch.object(self.app_module, "_get_workflow", return_value=fake_workflow):
                with patch.object(self.app_module.time, "monotonic", return_value=0.0):
                    with patch.object(self.app_module, "_submit_executor_job_after_delay") as inner_schedule:
                        submitted_fn(submitted_key, submitted_trigger, submitted_embedding_delay, submitted_index_delay)

            inner_schedule.assert_called_once()
            stage_fn = inner_schedule.call_args.args[1]
            stage_key = inner_schedule.call_args.args[2]
            stage_trigger = inner_schedule.call_args.args[3]
            stage_job_id = inner_schedule.call_args.args[4]
            stage_embedding_response = inner_schedule.call_args.args[5]
            self.assertEqual(inner_schedule.call_args.kwargs["delay_seconds"], 3.0)
            with patch.object(self.app_module, "_get_workflow", return_value=fake_workflow):
                stage_fn(stage_key, stage_trigger, stage_job_id, stage_embedding_response)

            fake_workflow.index_case_embedding.assert_called_once()
            self.assertFalse(fake_workflow.index_case_embedding.call_args.kwargs["update_index"])
            self.assertEqual(
                [call.kwargs["backend"] for call in fake_workflow.rebuild_case_vector_index.call_args_list],
                ["classifier", "dinov2"],
            )
            jobs = [
                job for job in self.site_store.list_jobs() if job.get("job_type") == "ai_clinic_embedding_index"
            ]
            self.assertEqual(len(jobs), 1)
            self.assertEqual(jobs[0]["status"], "completed")
        finally:
            self.app_module._PENDING_EMBEDDING_JOBS.clear()
            self.app_module._PENDING_EMBEDDING_TRIGGERS.clear()

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

    def test_embedding_status_clears_active_job_after_completion_http(self):
        admin_token = self._login("admin", "admin123")
        self._seed_case(admin_token, patient_id="HTTP-EMBED-STATUS-CLEAR-001", visit_date="Initial")
        current_model = self.cp.current_global_model()
        self.assertIsNotNone(current_model)
        backfill_job = self.site_store.enqueue_job(
            "ai_clinic_embedding_backfill",
            {
                "model_version_id": current_model["version_id"],
                "model_version_name": current_model.get("version_name"),
                "execution_mode": "cpu",
                "execution_device": "cpu",
                "force_refresh": False,
            },
            queue_name="analysis",
        )
        self.site_store.update_job_status(
            backfill_job["job_id"],
            "completed",
            {"progress": {"stage": "completed", "message": "done", "percent": 100}},
        )

        class FakeEmbeddingWorkflow:
            def list_cases_requiring_embedding(self, site_store, *, model_version, backend="classifier"):
                return []

            def case_vector_index_exists(self, site_store, *, model_version, backend):
                return backend == "classifier"

        with patch.object(self.app_module, "_get_workflow", return_value=FakeEmbeddingWorkflow()):
            response = self.client.get(
                f"/api/sites/{self.site_id}/ai-clinic/embeddings/status",
                headers={"Authorization": f"Bearer {admin_token}"},
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertIsNone(response.json()["active_job"])

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

    def test_update_patient_persists_metadata_http(self):
        token = self._token_for_username("http_researcher")
        self._seed_case(token, patient_id="HTTP-001")

        response = self.client.patch(
            f"/api/sites/{self.site_id}/patients?patient_id=HTTP-001",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "sex": "female",
                "age": 87,
                "chart_alias": "chart-001",
                "local_case_code": "17452298",
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["patient_id"], "HTTP-001")
        self.assertEqual(payload["age"], 87)
        self.assertEqual(payload["chart_alias"], "chart-001")
        self.assertEqual(payload["local_case_code"], "17452298")

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

    def test_live_lesion_preview_coalesces_latest_prompt_http(self):
        token = self._token_for_username("http_researcher")
        image_id = self._seed_case(token)
        first_box = {"x0": 0.2, "y0": 0.2, "x1": 0.6, "y1": 0.7}
        middle_box = {"x0": 0.15, "y0": 0.15, "x1": 0.55, "y1": 0.65}
        latest_box = {"x0": 0.1, "y0": 0.12, "x1": 0.52, "y1": 0.68}

        fake_workflow = CoalescingLesionPreviewWorkflow(self.app_module, self.cp)
        with patch.object(self.app_module, "_get_workflow", return_value=fake_workflow):
            lesion_box_response = self.client.patch(
                f"/api/sites/{self.site_id}/images/{image_id}/lesion-box",
                headers={"Authorization": f"Bearer {token}"},
                json=first_box,
            )
            self.assertEqual(lesion_box_response.status_code, 200, lesion_box_response.text)

            first_response = self.client.post(
                f"/api/sites/{self.site_id}/images/{image_id}/lesion-live-preview",
                headers={"Authorization": f"Bearer {token}"},
            )
            self.assertEqual(first_response.status_code, 200, first_response.text)
            first_payload = first_response.json()
            self.assertTrue(fake_workflow.first_started.wait(timeout=1))

            middle_patch = self.client.patch(
                f"/api/sites/{self.site_id}/images/{image_id}/lesion-box",
                headers={"Authorization": f"Bearer {token}"},
                json=middle_box,
            )
            self.assertEqual(middle_patch.status_code, 200, middle_patch.text)
            middle_response = self.client.post(
                f"/api/sites/{self.site_id}/images/{image_id}/lesion-live-preview",
                headers={"Authorization": f"Bearer {token}"},
            )
            self.assertEqual(middle_response.status_code, 200, middle_response.text)

            latest_patch = self.client.patch(
                f"/api/sites/{self.site_id}/images/{image_id}/lesion-box",
                headers={"Authorization": f"Bearer {token}"},
                json=latest_box,
            )
            self.assertEqual(latest_patch.status_code, 200, latest_patch.text)
            latest_response = self.client.post(
                f"/api/sites/{self.site_id}/images/{image_id}/lesion-live-preview",
                headers={"Authorization": f"Bearer {token}"},
            )
            self.assertEqual(latest_response.status_code, 200, latest_response.text)

            self.assertEqual(first_payload["job_id"], middle_response.json()["job_id"])
            self.assertEqual(first_payload["job_id"], latest_response.json()["job_id"])

            fake_workflow.release_first.set()
            self.assertTrue(fake_workflow.latest_started.wait(timeout=1))

            deadline = time.time() + 2
            job_payload = None
            while time.time() < deadline:
                job_response = self.client.get(
                    f"/api/sites/{self.site_id}/images/{image_id}/lesion-live-preview/jobs/{first_payload['job_id']}",
                    headers={"Authorization": f"Bearer {token}"},
                )
                self.assertEqual(job_response.status_code, 200, job_response.text)
                job_payload = job_response.json()
                if job_payload["status"] == "done":
                    break
                time.sleep(0.05)

        self.assertIsNotNone(job_payload)
        assert job_payload is not None
        self.assertEqual(job_payload["status"], "done")
        self.assertEqual(
            fake_workflow.preview_signatures,
            [
                fake_workflow._lesion_prompt_box_signature(first_box),
                fake_workflow._lesion_prompt_box_signature(latest_box),
            ],
        )
        self.assertEqual(
            job_payload["prompt_signature"],
            fake_workflow._lesion_prompt_box_signature(latest_box),
        )

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

    def test_case_preview_routes_update_artifact_cache_http(self):
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
            roi_response = self.client.get(
                f"/api/sites/{self.site_id}/cases/roi-preview?patient_id=HTTP-001&visit_date=Initial",
                headers={"Authorization": f"Bearer {token}"},
            )
            self.assertEqual(roi_response.status_code, 200, roi_response.text)
            self.assertEqual(len(roi_response.json()), 1)

            lesion_response = self.client.get(
                f"/api/sites/{self.site_id}/cases/lesion-preview?patient_id=HTTP-001&visit_date=Initial",
                headers={"Authorization": f"Bearer {token}"},
            )
            self.assertEqual(lesion_response.status_code, 200, lesion_response.text)
            self.assertEqual(len(lesion_response.json()), 1)

        image = self.site_store.get_image(image_id)
        self.assertIsNotNone(image)
        self.assertTrue(image["has_lesion_box"])
        self.assertTrue(image["has_roi_crop"])
        self.assertTrue(image["has_medsam_mask"])
        self.assertTrue(image["has_lesion_crop"])
        self.assertTrue(image["has_lesion_mask"])
        self.assertIsNotNone(image["artifact_status_updated_at"])

    def test_medsam_artifact_status_and_backfill_http(self):
        admin_token = self._login("admin", "admin123")
        image_without_box = self._seed_case(admin_token, patient_id="HTTP-001", visit_date="Initial")
        image_with_box = self._seed_case(admin_token, patient_id="HTTP-002", visit_date="Initial")
        lesion_box_response = self.client.patch(
            f"/api/sites/{self.site_id}/images/{image_with_box}/lesion-box",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"x0": 0.2, "y0": 0.2, "x1": 0.6, "y1": 0.7},
        )
        self.assertEqual(lesion_box_response.status_code, 200, lesion_box_response.text)

        status_response = self.client.get(
            f"/api/sites/{self.site_id}/medsam-artifacts/status?refresh=true",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        self.assertEqual(status_response.status_code, 200, status_response.text)
        status_payload = status_response.json()
        self.assertEqual(status_payload["statuses"]["missing_lesion_box"]["images"], 1)
        self.assertEqual(status_payload["statuses"]["missing_roi"]["images"], 2)
        self.assertEqual(status_payload["statuses"]["missing_lesion_crop"]["images"], 1)
        self.assertEqual(status_payload["statuses"]["medsam_backfill_ready"]["images"], 2)

        items_response = self.client.get(
            f"/api/sites/{self.site_id}/medsam-artifacts/items?scope=image&status_key=missing_lesion_crop&page=1&page_size=25",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        self.assertEqual(items_response.status_code, 200, items_response.text)
        items_payload = items_response.json()
        self.assertEqual(items_payload["total_count"], 1)
        self.assertEqual(items_payload["items"][0]["image_id"], image_with_box)
        self.assertTrue(items_payload["items"][0]["has_lesion_box"])
        self.assertFalse(items_payload["items"][0]["has_lesion_crop"])

        app_module = self.app_module
        control_plane = self.cp

        class FakeBackfillWorkflow(FakeWorkflow):
            def __init__(self, _cp):
                super().__init__(app_module, control_plane)

        with patch("kera_research.services.image_artifact_status.ResearchWorkflowService", FakeBackfillWorkflow):
            backfill_response = self.client.post(
                f"/api/sites/{self.site_id}/medsam-artifacts/backfill",
                headers={"Authorization": f"Bearer {admin_token}"},
                json={"refresh_cache": True},
            )
        self.assertEqual(backfill_response.status_code, 200, backfill_response.text)
        job_id = backfill_response.json()["job"]["job_id"]
        for _ in range(30):
            job = self.site_store.get_job(job_id)
            if job is not None and job.get("status") == "completed":
                break
            time.sleep(0.1)

        job = self.site_store.get_job(job_id)
        self.assertIsNotNone(job)
        self.assertEqual(job["status"], "completed")
        self.assertEqual(job["result"]["response"]["total_images"], 2)
        self.assertEqual(job["result"]["response"]["failed_images"], 0)

        image_without_box_record = self.site_store.get_image(image_without_box)
        image_with_box_record = self.site_store.get_image(image_with_box)
        self.assertIsNotNone(image_without_box_record)
        self.assertIsNotNone(image_with_box_record)
        self.assertFalse(image_without_box_record["has_lesion_box"])
        self.assertTrue(image_without_box_record["has_roi_crop"])
        self.assertTrue(image_without_box_record["has_medsam_mask"])
        self.assertFalse(image_without_box_record["has_lesion_crop"])
        self.assertFalse(image_without_box_record["has_lesion_mask"])
        self.assertTrue(image_with_box_record["has_lesion_box"])
        self.assertTrue(image_with_box_record["has_roi_crop"])
        self.assertTrue(image_with_box_record["has_medsam_mask"])
        self.assertTrue(image_with_box_record["has_lesion_crop"])
        self.assertTrue(image_with_box_record["has_lesion_mask"])

        status_after_response = self.client.get(
            f"/api/sites/{self.site_id}/medsam-artifacts/status?refresh=false",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        self.assertEqual(status_after_response.status_code, 200, status_after_response.text)
        status_after_payload = status_after_response.json()
        self.assertEqual(status_after_payload["statuses"]["missing_lesion_box"]["images"], 1)
        self.assertEqual(status_after_payload["statuses"]["missing_roi"]["images"], 0)
        self.assertEqual(status_after_payload["statuses"]["missing_lesion_crop"]["images"], 0)
        self.assertEqual(status_after_payload["statuses"]["medsam_backfill_ready"]["images"], 0)

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
        self._join_and_include_research_case(token)
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
            self.assertIsNotNone(validation_payload["post_mortem"])
            self.assertEqual(validation_payload["post_mortem"]["outcome"], "correct")
            self.assertEqual(validation_payload["post_mortem"]["learning_signal"], "retain_as_reference")
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

    def test_case_validation_updates_artifact_cache_http(self):
        token = self._token_for_username("http_researcher")
        image_id = self._seed_case(token)
        fake_workflow = FakeWorkflow(self.app_module, self.cp)
        with patch.object(self.app_module, "_get_workflow", return_value=fake_workflow):
            validation_response = self.client.post(
                f"/api/sites/{self.site_id}/cases/validate",
                headers={"Authorization": f"Bearer {token}"},
                json={"patient_id": "HTTP-001", "visit_date": "Initial", "execution_mode": "cpu"},
            )
        self.assertEqual(validation_response.status_code, 200, validation_response.text)

        image = None
        deadline = time.monotonic() + 2.0
        while time.monotonic() < deadline:
            image = self.site_store.get_image(image_id)
            if image is not None and image["has_roi_crop"] and image["has_medsam_mask"] and image["artifact_status_updated_at"] is not None:
                break
            time.sleep(0.05)

        self.assertIsNotNone(image)
        self.assertFalse(image["has_lesion_box"])
        self.assertTrue(image["has_roi_crop"])
        self.assertTrue(image["has_medsam_mask"])
        self.assertFalse(image["has_lesion_crop"])
        self.assertFalse(image["has_lesion_mask"])
        self.assertIsNotNone(image["artifact_status_updated_at"])

    def test_case_validation_degrades_slow_postmortem_to_background_http(self):
        token = self._token_for_username("http_researcher")
        patient_id = "HTTP-SLOW-POSTMORTEM-001"
        self._seed_case(token, patient_id=patient_id)

        class SlowPostmortemFakeWorkflow(FakeWorkflow):
            def run_case_postmortem(self, *args, **kwargs):
                time.sleep(0.8)
                return super().run_case_postmortem(*args, **kwargs)

        fake_workflow = SlowPostmortemFakeWorkflow(self.app_module, self.cp)
        with patch.object(self.app_module, "_get_workflow", return_value=fake_workflow):
            validation_response = self.client.post(
                f"/api/sites/{self.site_id}/cases/validate",
                headers={"Authorization": f"Bearer {token}"},
                json={"patient_id": patient_id, "visit_date": "Initial", "execution_mode": "cpu"},
            )
        self.assertEqual(validation_response.status_code, 200, validation_response.text)

        payload = validation_response.json()
        self.assertIsNone(payload["post_mortem"])
        validation_id = payload["summary"]["validation_id"]

        persisted_post_mortem = None
        deadline = time.monotonic() + 3.0
        while time.monotonic() < deadline:
            predictions = self.cp.load_case_predictions(validation_id)
            persisted_post_mortem = predictions[0].get("post_mortem") if predictions else None
            if persisted_post_mortem is not None:
                break
            time.sleep(0.05)

        self.assertIsNotNone(persisted_post_mortem)
        self.assertEqual(persisted_post_mortem["outcome"], "correct")

        history = self.site_store.load_case_history(patient_id, "Initial")
        self.assertTrue(history["validations"])
        self.assertEqual(history["validations"][0]["post_mortem"]["outcome"], "correct")

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
        self._join_and_include_research_case(token)
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

    def test_negative_case_can_be_saved_and_listed_without_culture_species_http(self):
        token = self._token_for_username("http_researcher")
        patient_id = "HTTP-NEG-001"

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
                "visit_date": "Initial",
                "culture_status": "negative",
                "culture_category": "",
                "culture_species": "",
                "contact_lens_use": "none",
                "visit_status": "active",
                "is_initial_visit": True,
            },
        )
        self.assertEqual(visit_response.status_code, 200, visit_response.text)
        visit_payload = visit_response.json()
        self.assertEqual(visit_payload["culture_status"], "negative")
        self.assertFalse(bool(visit_payload["culture_confirmed"]))
        self.assertEqual(str(visit_payload["culture_category"] or ""), "")
        self.assertEqual(str(visit_payload["culture_species"] or ""), "")

        image_response = self.client.post(
            f"/api/sites/{self.site_id}/images",
            headers={"Authorization": f"Bearer {token}"},
            data={
                "patient_id": patient_id,
                "visit_date": "Initial",
                "view": "white",
                "is_representative": "true",
            },
            files={"file": ("negative.png", self._make_test_image_bytes("PNG"), "image/png")},
        )
        self.assertEqual(image_response.status_code, 200, image_response.text)

        cases_response = self.client.get(
            f"/api/sites/{self.site_id}/cases",
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(cases_response.status_code, 200, cases_response.text)
        self.assertTrue(
            any(
                item["patient_id"] == patient_id
                and item["visit_date"] == "Initial"
                and item["culture_status"] == "negative"
                for item in cases_response.json()
            )
        )

    def test_visit_defaults_to_unknown_when_culture_fields_are_omitted_http(self):
        token = self._token_for_username("http_researcher")
        patient_id = "HTTP-UNK-001"

        patient_response = self.client.post(
            f"/api/sites/{self.site_id}/patients",
            headers={"Authorization": f"Bearer {token}"},
            json={"patient_id": patient_id, "sex": "female", "age": 54, "chart_alias": "", "local_case_code": ""},
        )
        self.assertEqual(patient_response.status_code, 200, patient_response.text)

        visit_response = self.client.post(
            f"/api/sites/{self.site_id}/visits",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "patient_id": patient_id,
                "visit_date": "Initial",
                "contact_lens_use": "none",
                "visit_status": "active",
                "is_initial_visit": True,
            },
        )
        self.assertEqual(visit_response.status_code, 200, visit_response.text)
        visit_payload = visit_response.json()
        self.assertEqual(visit_payload["culture_status"], "unknown")
        self.assertFalse(bool(visit_payload["culture_confirmed"]))
        self.assertEqual(str(visit_payload["culture_category"] or ""), "")
        self.assertEqual(str(visit_payload["culture_species"] or ""), "")

    def test_case_validation_supports_inference_only_mode_http(self):
        token = self._token_for_username("http_researcher")
        self._seed_case(token, patient_id="HTTP-INF-001")

        class InferenceOnlyFakeWorkflow(FakeWorkflow):
            def run_case_validation(self, *args, **kwargs):
                summary, case_predictions = super().run_case_validation(*args, **kwargs)
                summary["validation_mode"] = "inference_only"
                summary["true_label"] = None
                summary["is_correct"] = None
                case_predictions[0]["validation_mode"] = "inference_only"
                case_predictions[0]["true_label"] = None
                case_predictions[0]["is_correct"] = None
                return summary, case_predictions

        fake_workflow = InferenceOnlyFakeWorkflow(self.app_module, self.cp)
        with patch.object(self.app_module, "_get_workflow", return_value=fake_workflow):
            validation_response = self.client.post(
                f"/api/sites/{self.site_id}/cases/validate",
                headers={"Authorization": f"Bearer {token}"},
                json={"patient_id": "HTTP-INF-001", "visit_date": "Initial", "execution_mode": "cpu"},
            )

        self.assertEqual(validation_response.status_code, 200, validation_response.text)
        payload = validation_response.json()
        self.assertEqual(payload["summary"]["validation_mode"], "inference_only")
        self.assertIsNone(payload["summary"]["true_label"])
        self.assertIsNone(payload["summary"]["is_correct"])
        self.assertIsNone(payload["case_prediction"]["true_label"])
        self.assertIsNone(payload["case_prediction"]["is_correct"])
        self.assertIsNone(payload["post_mortem"])

    def test_desktop_sidecar_validation_skips_postmortem_for_inference_only(self):
        token = self._token_for_username("http_researcher")
        self._seed_case(token, patient_id="HTTP-INF-DESKTOP-001")

        import kera_research.desktop_sidecar as desktop_sidecar

        class InferenceOnlyFakeWorkflow(FakeWorkflow):
            def run_case_validation(self, *args, **kwargs):
                summary, case_predictions = super().run_case_validation(*args, **kwargs)
                summary["validation_mode"] = "inference_only"
                summary["true_label"] = None
                summary["is_correct"] = None
                case_predictions[0]["validation_mode"] = "inference_only"
                case_predictions[0]["true_label"] = None
                case_predictions[0]["is_correct"] = None
                return summary, case_predictions

        fake_workflow = InferenceOnlyFakeWorkflow(self.app_module, self.cp)
        fake_workflow.run_case_postmortem = Mock(side_effect=AssertionError("postmortem should not run"))

        with (
            patch.object(desktop_sidecar, "get_control_plane", return_value=self.cp),
            patch.object(
                desktop_sidecar,
                "_approved_user",
                return_value={
                    "user_id": self.researcher["user_id"],
                    "username": "http_researcher",
                    "role": "researcher",
                    "site_ids": [self.site_id],
                    "approval_status": "approved",
                },
            ),
            patch.object(desktop_sidecar, "_require_validation_permission", return_value=None),
            patch.object(desktop_sidecar, "_require_site_access", return_value=self.site_store),
            patch.object(desktop_sidecar, "_ensure_shared_workflow", return_value=fake_workflow),
            patch.object(
                desktop_sidecar,
                "_resolve_case_model_version",
                return_value=next(
                    item
                    for item in self.cp.list_model_versions()
                    if str(item.get("version_id") or "") == "model_http_seed"
                ),
            ),
            patch.object(desktop_sidecar, "_resolve_execution_device", return_value="cpu"),
            patch.object(desktop_sidecar, "_project_id_for_site", return_value="project_http"),
            patch.object(desktop_sidecar, "_sync_case_artifact_cache_best_effort", return_value=None),
        ):
            payload = desktop_sidecar._run_case_validation(
                {
                    "token": token,
                    "site_id": self.site_id,
                    "patient_id": "HTTP-INF-DESKTOP-001",
                    "visit_date": "Initial",
                    "execution_mode": "cpu",
                }
            )

        self.assertEqual(payload["summary"]["validation_mode"], "inference_only")
        self.assertIsNone(payload["case_prediction"]["true_label"])
        self.assertIsNone(payload["case_prediction"]["is_correct"])
        self.assertIsNone(payload["post_mortem"])
        fake_workflow.run_case_postmortem.assert_not_called()

    def test_validation_case_listing_excludes_inference_only_rows_from_misclassified_filter_http(self):
        token = self._token_for_username("http_researcher")
        patient_id = "HTTP-INF-LIST-001"
        self._seed_case(token, patient_id=patient_id)

        summary = {
            "validation_id": "validation_inference_only_rows",
            "project_id": "project_default",
            "site_id": self.site_id,
            "model_version": "global-http-seed",
            "model_version_id": "model_http_seed",
            "model_architecture": "densenet121",
            "run_date": "2026-04-07T00:00:00+00:00",
            "n_patients": 1,
            "n_cases": 1,
            "n_images": 1,
            "AUROC": 0.61,
            "accuracy": 0.61,
            "sensitivity": 0.61,
            "specificity": 0.61,
            "F1": 0.61,
        }
        case_prediction = {
            "validation_id": summary["validation_id"],
            "site_id": self.site_id,
            "patient_id": patient_id,
            "visit_date": "Initial",
            "validation_mode": "inference_only",
            "true_label": None,
            "predicted_label": "fungal",
            "prediction_probability": 0.63,
            "is_correct": None,
        }
        self.cp.save_validation_run(summary, [case_prediction])

        filtered_response = self.client.get(
            f"/api/sites/{self.site_id}/validations/{summary['validation_id']}/cases?misclassified_only=true",
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(filtered_response.status_code, 200, filtered_response.text)
        self.assertEqual(filtered_response.json(), [])

        all_rows_response = self.client.get(
            f"/api/sites/{self.site_id}/validations/{summary['validation_id']}/cases",
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(all_rows_response.status_code, 200, all_rows_response.text)
        rows = all_rows_response.json()
        self.assertEqual(len(rows), 1)
        self.assertIsNone(rows[0]["is_correct"])

    def test_case_contribution_requires_registry_consent_and_inclusion_http(self):
        token = self._token_for_username("http_researcher")
        self._seed_case(token, patient_id="HTTP-CONTRIB-001")

        class PolicyCheckingFakeWorkflow(FakeWorkflow):
            def contribute_case(self, *args, **kwargs):
                site_store = kwargs["site_store"]
                patient_id = kwargs["patient_id"]
                visit_date = kwargs["visit_date"]
                policy_state = site_store.case_research_policy_state(patient_id, visit_date)
                if not policy_state.get("is_registry_included"):
                    raise ValueError("Include this case in the research registry before contributing it.")
                return super().contribute_case(*args, **kwargs)

        fake_workflow = PolicyCheckingFakeWorkflow(self.app_module, self.cp)

        with patch.object(self.app_module, "_get_workflow", return_value=fake_workflow):
            blocked_without_consent = self.client.post(
                f"/api/sites/{self.site_id}/cases/contribute",
                headers={"Authorization": f"Bearer {token}"},
                json={"patient_id": "HTTP-CONTRIB-001", "visit_date": "Initial", "execution_mode": "cpu"},
            )
            self.assertEqual(blocked_without_consent.status_code, 409, blocked_without_consent.text)
            self.assertIn("research registry", blocked_without_consent.json()["detail"].lower())

        consent_response = self.client.post(
            f"/api/sites/{self.site_id}/research-registry/consent",
            headers={"Authorization": f"Bearer {token}"},
            json={"version": "v1"},
        )
        self.assertEqual(consent_response.status_code, 200, consent_response.text)

        with patch.object(self.app_module, "_get_workflow", return_value=fake_workflow):
            blocked_without_include = self.client.post(
                f"/api/sites/{self.site_id}/cases/contribute",
                headers={"Authorization": f"Bearer {token}"},
                json={"patient_id": "HTTP-CONTRIB-001", "visit_date": "Initial", "execution_mode": "cpu"},
            )
            self.assertEqual(blocked_without_include.status_code, 400, blocked_without_include.text)
            self.assertIn("include this case", blocked_without_include.json()["detail"].lower())

        include_response = self.client.post(
            f"/api/sites/{self.site_id}/cases/research-registry",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "patient_id": "HTTP-CONTRIB-001",
                "visit_date": "Initial",
                "action": "include",
                "source": "test_contribution_gate",
            },
        )
        self.assertEqual(include_response.status_code, 200, include_response.text)

        with patch.object(self.app_module, "_get_workflow", return_value=fake_workflow):
            contribution_response = self.client.post(
                f"/api/sites/{self.site_id}/cases/contribute",
                headers={"Authorization": f"Bearer {token}"},
                json={"patient_id": "HTTP-CONTRIB-001", "visit_date": "Initial", "execution_mode": "cpu"},
            )
        self.assertEqual(contribution_response.status_code, 200, contribution_response.text)

    def test_desktop_sidecar_contribution_requires_registry_consent_and_inclusion(self):
        token = self._token_for_username("http_researcher")
        patient_id = "HTTP-CONTRIB-DESKTOP-001"
        self._seed_case(token, patient_id=patient_id)

        import kera_research.desktop_sidecar as desktop_sidecar

        researcher_user = {
            "user_id": self.researcher["user_id"],
            "username": "http_researcher",
            "role": "researcher",
            "site_ids": [self.site_id],
            "approval_status": "approved",
        }
        seed_model_version = next(
            item for item in self.cp.list_model_versions() if str(item.get("version_id") or "") == "model_http_seed"
        )
        fake_workflow = Mock()

        def _contribute_case(*args, **kwargs):
            policy_state = kwargs["site_store"].case_research_policy_state(kwargs["patient_id"], kwargs["visit_date"])
            if not bool(kwargs.get("registry_consent_granted")):
                raise ValueError("Join the research registry before contributing this case.")
            if not policy_state.get("is_positive"):
                raise ValueError("Federated learning contribution is restricted to culture-positive cases.")
            if not policy_state.get("is_active"):
                raise ValueError("Federated learning contribution is restricted to active visits.")
            if not policy_state.get("has_images"):
                raise ValueError("Federated learning contribution requires at least one saved image.")
            if not policy_state.get("is_registry_included"):
                raise ValueError("Include this case in the research registry before contributing it.")
            return {
                "contribution_id": "desktop_sidecar_contribution_001",
                "base_model_version_id": seed_model_version["version_id"],
            }

        fake_workflow.contribute_case.side_effect = _contribute_case
        request_payload = {
            "token": token,
            "site_id": self.site_id,
            "patient_id": patient_id,
            "visit_date": "Initial",
            "execution_mode": "cpu",
            "model_version_id": "model_http_seed",
        }

        with (
            patch.object(desktop_sidecar, "get_control_plane", return_value=self.cp),
            patch.object(desktop_sidecar, "_approved_user", return_value=researcher_user),
            patch.object(desktop_sidecar, "_require_validation_permission", return_value=None),
            patch.object(desktop_sidecar, "_require_site_access", return_value=self.site_store),
            patch.object(desktop_sidecar, "_ensure_shared_workflow", return_value=fake_workflow),
            patch.object(desktop_sidecar, "resolve_requested_contribution_models", return_value=[seed_model_version]),
            patch.object(desktop_sidecar, "_resolve_execution_device", return_value="cpu"),
            patch.object(desktop_sidecar, "_sync_case_artifact_cache_best_effort", return_value=None),
        ):
            with self.assertRaises(Exception) as blocked_without_consent:
                desktop_sidecar._run_case_contribution(request_payload)
            self.assertEqual(getattr(blocked_without_consent.exception, "status_code", None), 409)
            self.assertIn("research registry", str(getattr(blocked_without_consent.exception, "detail", "")).lower())

            consent_response = self.client.post(
                f"/api/sites/{self.site_id}/research-registry/consent",
                headers={"Authorization": f"Bearer {token}"},
                json={"version": "v1"},
            )
            self.assertEqual(consent_response.status_code, 200, consent_response.text)

            with self.assertRaises(Exception) as blocked_without_include:
                desktop_sidecar._run_case_contribution(request_payload)
            self.assertEqual(getattr(blocked_without_include.exception, "status_code", None), 400)
            self.assertIn("include this case", str(getattr(blocked_without_include.exception, "detail", "")).lower())

            include_response = self.client.post(
                f"/api/sites/{self.site_id}/cases/research-registry",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "patient_id": patient_id,
                    "visit_date": "Initial",
                    "action": "include",
                    "source": "test_desktop_sidecar_contribution_gate",
                },
            )
            self.assertEqual(include_response.status_code, 200, include_response.text)

            fake_workflow.contribute_case.reset_mock()
            payload = desktop_sidecar._run_case_contribution(request_payload)

        self.assertEqual(payload["update"]["base_model_version_id"], "model_http_seed")
        self.assertEqual(payload["visit_status"], "active")
        self.assertTrue(bool(fake_workflow.contribute_case.call_args.kwargs.get("registry_consent_granted")))

    def test_research_registry_include_rejects_non_positive_case_http(self):
        token = self._token_for_username("http_researcher")
        patient_id = "HTTP-REG-NEG-001"
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
                "visit_date": "Initial",
                "culture_status": "negative",
                "culture_category": "",
                "culture_species": "",
                "contact_lens_use": "none",
                "visit_status": "active",
                "is_initial_visit": True,
            },
        )
        self.assertEqual(visit_response.status_code, 200, visit_response.text)
        image_response = self.client.post(
            f"/api/sites/{self.site_id}/images",
            headers={"Authorization": f"Bearer {token}"},
            data={
                "patient_id": patient_id,
                "visit_date": "Initial",
                "view": "white",
                "is_representative": "true",
            },
            files={"file": ("negative_registry.png", self._make_test_image_bytes("PNG"), "image/png")},
        )
        self.assertEqual(image_response.status_code, 200, image_response.text)

        consent_response = self.client.post(
            f"/api/sites/{self.site_id}/research-registry/consent",
            headers={"Authorization": f"Bearer {token}"},
            json={"version": "v1"},
        )
        self.assertEqual(consent_response.status_code, 200, consent_response.text)

        include_response = self.client.post(
            f"/api/sites/{self.site_id}/cases/research-registry",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "patient_id": patient_id,
                "visit_date": "Initial",
                "action": "include",
                "source": "test_negative_include",
            },
        )
        self.assertEqual(include_response.status_code, 400, include_response.text)
        self.assertIn("culture-positive", include_response.json()["detail"])

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

    def test_update_visit_can_move_case_to_new_patient_http(self):
        token = self._token_for_username("http_researcher")
        self._seed_case(token, patient_id="HTTP-001", visit_date="Initial")
        create_target_patient = self.client.post(
            f"/api/sites/{self.site_id}/patients",
            headers={"Authorization": f"Bearer {token}"},
            json={"patient_id": "17452298", "sex": "female", "age": 87, "chart_alias": "", "local_case_code": ""},
        )
        self.assertEqual(create_target_patient.status_code, 200, create_target_patient.text)
        self.site_store.record_case_validation_history(
            "HTTP-001",
            "Initial",
            {
                "validation_id": "validation_move_001",
                "run_date": "2026-03-15T00:00:00Z",
                "model_version": "global-http-seed",
            },
        )

        response = self.client.patch(
            f"/api/sites/{self.site_id}/visits?patient_id=HTTP-001&visit_date=Initial",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "patient_id": "17452298",
                "visit_date": "Initial",
                "culture_category": "bacterial",
                "culture_species": "Serratia marcescens",
                "contact_lens_use": "none",
                "visit_status": "active",
                "is_initial_visit": True,
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["patient_id"], "17452298")
        self.assertEqual(payload["culture_species"], "Serratia marcescens")

        source_visits_response = self.client.get(
            f"/api/sites/{self.site_id}/visits?patient_id=HTTP-001",
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(source_visits_response.status_code, 200, source_visits_response.text)
        self.assertEqual(source_visits_response.json(), [])

        target_visits_response = self.client.get(
            f"/api/sites/{self.site_id}/visits?patient_id=17452298",
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(target_visits_response.status_code, 200, target_visits_response.text)
        self.assertEqual(len(target_visits_response.json()), 1)
        self.assertEqual(target_visits_response.json()[0]["patient_id"], "17452298")

        source_patients_response = self.client.get(
            f"/api/sites/{self.site_id}/patients",
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(source_patients_response.status_code, 200, source_patients_response.text)
        self.assertNotIn(
            "HTTP-001",
            [item["patient_id"] for item in source_patients_response.json()],
        )

        target_images_response = self.client.get(
            f"/api/sites/{self.site_id}/images?patient_id=17452298&visit_date=Initial",
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(target_images_response.status_code, 200, target_images_response.text)
        self.assertEqual(len(target_images_response.json()), 1)
        self.assertEqual(target_images_response.json()[0]["patient_id"], "17452298")

        history_response = self.client.get(
            f"/api/sites/{self.site_id}/cases/history?patient_id=17452298&visit_date=Initial",
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(history_response.status_code, 200, history_response.text)
        self.assertEqual(len(history_response.json()["validations"]), 1)
        self.assertEqual(history_response.json()["validations"][0]["validation_id"], "validation_move_001")

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

    def test_existing_patients_can_only_create_follow_up_visits_http(self):
        self.site_store.create_patient(
            patient_id="HTTP-003",
            sex="female",
            age=58,
            created_by_user_id="user_researcher",
        )
        self.site_store.create_visit(
            patient_id="HTTP-003",
            visit_date="Initial",
            actual_visit_date=None,
            culture_confirmed=True,
            culture_category="bacterial",
            culture_species="Staphylococcus aureus",
            additional_organisms=[],
            contact_lens_use="none",
            predisposing_factor=[],
            other_history="",
            visit_status="active",
            is_initial_visit=True,
            created_by_user_id="user_researcher",
        )

        with self.assertRaisesRegex(
            ValueError,
            "Existing patients can only receive follow-up visits. Use a FU #N label.",
        ):
            self.site_store.create_visit(
                patient_id="HTTP-003",
                visit_date="Initial",
                actual_visit_date=None,
                culture_confirmed=True,
                culture_category="bacterial",
                culture_species="Staphylococcus aureus",
                additional_organisms=[],
                contact_lens_use="none",
                predisposing_factor=[],
                other_history="",
                visit_status="active",
                is_initial_visit=True,
                created_by_user_id="user_researcher",
            )

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

    def test_image_level_federated_round_job_http(self):
        admin_token = self._login("admin", "admin123")
        self._seed_case(admin_token, patient_id="HTTP-FL-001", visit_date="Initial")
        self._seed_case(admin_token, patient_id="HTTP-FL-002", visit_date="Initial")
        self._join_and_include_research_case(admin_token, patient_id="HTTP-FL-001", visit_date="Initial")
        self._join_and_include_research_case(admin_token, patient_id="HTTP-FL-002", visit_date="Initial")

        convnext_path = Path(self.tempdir.name) / "convnext_fl_round.pth"
        convnext_path.write_bytes(b"convnext")
        convnext_model = self.cp.ensure_model_version(
            {
                "version_id": "model_global_convnext_tiny_full_http_test",
                "version_name": "global-convnext-tiny-full-http-test",
                "architecture": "convnext_tiny",
                "stage": "global",
                "model_path": str(convnext_path),
                "created_at": "2026-04-08T00:00:00+00:00",
                "ready": True,
                "is_current": False,
                "crop_mode": "raw",
                "case_aggregation": "mean",
                "bag_level": False,
                "training_input_policy": "raw_or_model_defined",
                "preprocess_signature": "fakepreprocesssig",
                "num_classes": 2,
            }
        )

        fake_workflow = FakeWorkflow(self.app_module, self.cp)
        with patch.object(self.app_module, "_get_workflow", return_value=fake_workflow):
            start_response = self.client.post(
                f"/api/sites/{self.site_id}/training/federated/image-level",
                headers={"Authorization": f"Bearer {admin_token}"},
                json={
                    "model_version_id": convnext_model["version_id"],
                    "execution_mode": "cpu",
                    "epochs": 1,
                    "learning_rate": 5e-5,
                    "batch_size": 4,
                },
            )
            self.assertEqual(start_response.status_code, 200, start_response.text)
            start_payload = start_response.json()
            job_id = start_payload["job"]["job_id"]
            self.assertEqual(start_payload["model_version"]["architecture"], "convnext_tiny")

            self._run_site_jobs(workflow=fake_workflow, max_jobs=1, site_id=self.site_id)

            job_response = self.client.get(
                f"/api/sites/{self.site_id}/jobs/{job_id}",
                headers={"Authorization": f"Bearer {admin_token}"},
            )
            self.assertEqual(job_response.status_code, 200, job_response.text)
            job_payload = job_response.json()
            self.assertEqual(job_payload["status"], "completed")
            response_payload = job_payload["result"]["response"]
            self.assertEqual(response_payload["model_version"]["version_id"], convnext_model["version_id"])
            self.assertEqual(response_payload["eligible_case_count"], 2)
            self.assertEqual(response_payload["eligible_image_count"], 5)
            self.assertEqual(response_payload["update"]["aggregation_weight"], 5)
            self.assertEqual(response_payload["update"]["aggregation_weight_unit"], "images")
            self.assertEqual(response_payload["update"]["status"], "pending_review")

    def test_image_level_federated_round_status_http(self):
        admin_token = self._login("admin", "admin123")
        self._seed_case(admin_token, patient_id="HTTP-FL-STATUS-001", visit_date="Initial")
        self._seed_case(admin_token, patient_id="HTTP-FL-STATUS-002", visit_date="Initial")
        self._seed_case(admin_token, patient_id="HTTP-FL-STATUS-003", visit_date="Initial")
        self._join_and_include_research_case(admin_token, patient_id="HTTP-FL-STATUS-001", visit_date="Initial")
        self._join_and_include_research_case(admin_token, patient_id="HTTP-FL-STATUS-002", visit_date="Initial")

        convnext_path = Path(self.tempdir.name) / "convnext_fl_status.pth"
        convnext_path.write_bytes(b"convnext-status")
        convnext_model = self.cp.ensure_model_version(
            {
                "version_id": "model_global_convnext_tiny_full_http_status",
                "version_name": "global-convnext-tiny-full-http-status",
                "architecture": "convnext_tiny",
                "stage": "global",
                "model_path": str(convnext_path),
                "created_at": "2026-04-08T00:05:00+00:00",
                "ready": True,
                "is_current": False,
                "crop_mode": "raw",
                "case_aggregation": "mean",
                "bag_level": False,
                "training_input_policy": "raw_or_model_defined",
                "preprocess_signature": "fakepreprocesssig",
                "num_classes": 2,
            }
        )

        start_response = self.client.post(
            f"/api/sites/{self.site_id}/training/federated/image-level",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "execution_mode": "cpu",
            },
        )
        self.assertEqual(start_response.status_code, 200, start_response.text)
        start_payload = start_response.json()
        self.assertEqual(start_payload["model_version"]["version_id"], convnext_model["version_id"])

        status_response = self.client.get(
            f"/api/sites/{self.site_id}/training/federated/image-level/status",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        self.assertEqual(status_response.status_code, 200, status_response.text)
        payload = status_response.json()
        self.assertEqual(payload["site_id"], self.site_id)
        self.assertEqual(payload["model_version"]["version_id"], convnext_model["version_id"])
        self.assertEqual(payload["model_version"]["architecture"], "convnext_tiny")
        self.assertEqual(payload["eligible_case_count"], 2)
        self.assertEqual(payload["eligible_image_count"], 2)
        self.assertEqual(payload["skipped"]["not_positive"], 0)
        self.assertEqual(payload["skipped"]["not_active"], 0)
        self.assertEqual(payload["skipped"]["not_included"], 1)
        self.assertEqual(payload["skipped"]["no_images"], 0)
        self.assertIsNotNone(payload["active_job"])
        self.assertEqual(payload["active_job"]["job_id"], start_payload["job"]["job_id"])

    def test_image_level_federated_round_does_not_reuse_active_job_with_different_hyperparameters_http(self):
        admin_token = self._login("admin", "admin123")
        self._seed_case(admin_token, patient_id="HTTP-FL-DIFFCFG-001", visit_date="Initial")
        self._join_and_include_research_case(admin_token, patient_id="HTTP-FL-DIFFCFG-001", visit_date="Initial")

        convnext_path = Path(self.tempdir.name) / "convnext_fl_diffcfg.pth"
        convnext_path.write_bytes(b"convnext-diffcfg")
        convnext_model = self.cp.ensure_model_version(
            {
                "version_id": "model_global_convnext_tiny_full_http_diffcfg",
                "version_name": "global-convnext-tiny-full-http-diffcfg",
                "architecture": "convnext_tiny",
                "stage": "global",
                "model_path": str(convnext_path),
                "created_at": "2026-04-08T00:05:30+00:00",
                "ready": True,
                "is_current": False,
                "crop_mode": "raw",
                "case_aggregation": "mean",
                "bag_level": False,
                "training_input_policy": "raw_or_model_defined",
                "preprocess_signature": "fakepreprocesssig",
                "num_classes": 2,
            }
        )

        first_response = self.client.post(
            f"/api/sites/{self.site_id}/training/federated/image-level",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "model_version_id": convnext_model["version_id"],
                "execution_mode": "cpu",
                "epochs": 1,
                "learning_rate": 5e-5,
                "batch_size": 4,
            },
        )
        self.assertEqual(first_response.status_code, 200, first_response.text)
        first_job_id = first_response.json()["job"]["job_id"]

        second_response = self.client.post(
            f"/api/sites/{self.site_id}/training/federated/image-level",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "model_version_id": convnext_model["version_id"],
                "execution_mode": "cpu",
                "epochs": 2,
                "learning_rate": 5e-5,
                "batch_size": 4,
            },
        )
        self.assertEqual(second_response.status_code, 200, second_response.text)
        self.assertNotEqual(second_response.json()["job"]["job_id"], first_job_id)

    def test_image_level_federated_round_status_clears_active_job_after_completion_http(self):
        admin_token = self._login("admin", "admin123")
        self._seed_case(admin_token, patient_id="HTTP-FL-ACTIVE-CLEAR-001", visit_date="Initial")
        self._join_and_include_research_case(admin_token, patient_id="HTTP-FL-ACTIVE-CLEAR-001", visit_date="Initial")

        convnext_path = Path(self.tempdir.name) / "convnext_fl_active_clear.pth"
        convnext_path.write_bytes(b"convnext-active-clear")
        convnext_model = self.cp.ensure_model_version(
            {
                "version_id": "model_global_convnext_tiny_full_http_active_clear",
                "version_name": "global-convnext-tiny-full-http-active-clear",
                "architecture": "convnext_tiny",
                "stage": "global",
                "model_path": str(convnext_path),
                "created_at": "2026-04-08T00:05:40+00:00",
                "ready": True,
                "is_current": False,
                "crop_mode": "raw",
                "case_aggregation": "mean",
                "bag_level": False,
                "training_input_policy": "raw_or_model_defined",
                "preprocess_signature": "fakepreprocesssig",
                "num_classes": 2,
            }
        )

        fake_workflow = FakeWorkflow(self.app_module, self.cp)
        with patch.object(self.app_module, "_get_workflow", return_value=fake_workflow):
            start_response = self.client.post(
                f"/api/sites/{self.site_id}/training/federated/image-level",
                headers={"Authorization": f"Bearer {admin_token}"},
                json={"model_version_id": convnext_model["version_id"], "execution_mode": "cpu"},
            )
            self.assertEqual(start_response.status_code, 200, start_response.text)

            self._run_site_jobs(workflow=fake_workflow, max_jobs=1, site_id=self.site_id)

        status_response = self.client.get(
            f"/api/sites/{self.site_id}/training/federated/image-level/status?model_version_id={convnext_model['version_id']}",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        self.assertEqual(status_response.status_code, 200, status_response.text)
        self.assertIsNone(status_response.json()["active_job"])

    def test_image_level_federated_round_requires_eligible_cases_http(self):
        admin_token = self._login("admin", "admin123")
        self._seed_case(admin_token, patient_id="HTTP-FL-NOELIGIBLE-001", visit_date="Initial")

        consent_response = self.client.post(
            f"/api/sites/{self.site_id}/research-registry/consent",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"version": "v1"},
        )
        self.assertEqual(consent_response.status_code, 200, consent_response.text)

        convnext_path = Path(self.tempdir.name) / "convnext_fl_noeligible.pth"
        convnext_path.write_bytes(b"convnext-noeligible")
        convnext_model = self.cp.ensure_model_version(
            {
                "version_id": "model_global_convnext_tiny_full_http_noeligible",
                "version_name": "global-convnext-tiny-full-http-noeligible",
                "architecture": "convnext_tiny",
                "stage": "global",
                "model_path": str(convnext_path),
                "created_at": "2026-04-08T00:06:00+00:00",
                "ready": True,
                "is_current": False,
                "crop_mode": "raw",
                "case_aggregation": "mean",
                "bag_level": False,
                "training_input_policy": "raw_or_model_defined",
                "preprocess_signature": "fakepreprocesssig",
                "num_classes": 2,
            }
        )

        start_response = self.client.post(
            f"/api/sites/{self.site_id}/training/federated/image-level",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"model_version_id": convnext_model["version_id"], "execution_mode": "cpu"},
        )
        self.assertEqual(start_response.status_code, 409, start_response.text)
        self.assertIn("requires at least one positive, active, included case", start_response.json()["detail"])

    def test_image_level_federated_round_requires_non_dp_acknowledgement_in_production_like_runtime_http(self):
        admin_token = self._login("admin", "admin123")
        self._seed_case(admin_token, patient_id="HTTP-FL-PROD-ACK-001", visit_date="Initial")
        self._join_and_include_research_case(admin_token, patient_id="HTTP-FL-PROD-ACK-001", visit_date="Initial")

        convnext_path = Path(self.tempdir.name) / "convnext_fl_prod_ack.pth"
        convnext_path.write_bytes(b"convnext-prod-ack")
        convnext_model = self.cp.ensure_model_version(
            {
                "version_id": "model_global_convnext_tiny_full_http_prod_ack",
                "version_name": "global-convnext-tiny-full-http-prod-ack",
                "architecture": "convnext_tiny",
                "stage": "global",
                "model_path": str(convnext_path),
                "created_at": "2026-04-14T01:00:00+00:00",
                "ready": True,
                "is_current": False,
                "crop_mode": "raw",
                "case_aggregation": "mean",
                "bag_level": False,
                "training_input_policy": "raw_or_model_defined",
                "preprocess_signature": "fakepreprocesssig",
                "num_classes": 2,
            }
        )

        with patch.dict(os.environ, {"KERA_ENVIRONMENT": "production"}, clear=False):
            start_response = self.client.post(
                f"/api/sites/{self.site_id}/training/federated/image-level",
                headers={"Authorization": f"Bearer {admin_token}"},
                json={"model_version_id": convnext_model["version_id"], "execution_mode": "cpu"},
            )

        self.assertEqual(start_response.status_code, 409, start_response.text)
        self.assertIn("KERA_ACKNOWLEDGE_NON_DP_FEDERATED_TRAINING", start_response.json()["detail"])

    def test_image_level_federated_round_allows_non_dp_acknowledgement_override_http(self):
        admin_token = self._login("admin", "admin123")
        self._seed_case(admin_token, patient_id="HTTP-FL-PROD-ACK-ALLOW-001", visit_date="Initial")
        self._join_and_include_research_case(admin_token, patient_id="HTTP-FL-PROD-ACK-ALLOW-001", visit_date="Initial")

        convnext_path = Path(self.tempdir.name) / "convnext_fl_prod_ack_allow.pth"
        convnext_path.write_bytes(b"convnext-prod-ack-allow")
        convnext_model = self.cp.ensure_model_version(
            {
                "version_id": "model_global_convnext_tiny_full_http_prod_ack_allow",
                "version_name": "global-convnext-tiny-full-http-prod-ack-allow",
                "architecture": "convnext_tiny",
                "stage": "global",
                "model_path": str(convnext_path),
                "created_at": "2026-04-14T01:05:00+00:00",
                "ready": True,
                "is_current": False,
                "crop_mode": "raw",
                "case_aggregation": "mean",
                "bag_level": False,
                "training_input_policy": "raw_or_model_defined",
                "preprocess_signature": "fakepreprocesssig",
                "num_classes": 2,
            }
        )

        with patch.dict(
            os.environ,
            {
                "KERA_ENVIRONMENT": "production",
                "KERA_ACKNOWLEDGE_NON_DP_FEDERATED_TRAINING": "true",
            },
            clear=False,
        ):
            start_response = self.client.post(
                f"/api/sites/{self.site_id}/training/federated/image-level",
                headers={"Authorization": f"Bearer {admin_token}"},
                json={"model_version_id": convnext_model["version_id"], "execution_mode": "cpu"},
            )

        self.assertEqual(start_response.status_code, 200, start_response.text)
        self.assertEqual(start_response.json()["model_version"]["version_id"], convnext_model["version_id"])

    def test_visit_level_federated_round_job_http(self):
        admin_token = self._login("admin", "admin123")
        self._seed_case(admin_token, patient_id="HTTP-VISIT-FL-001", visit_date="Initial")
        self._seed_case(admin_token, patient_id="HTTP-VISIT-FL-002", visit_date="Initial")
        self._join_and_include_research_case(admin_token, patient_id="HTTP-VISIT-FL-001", visit_date="Initial")
        self._join_and_include_research_case(admin_token, patient_id="HTTP-VISIT-FL-002", visit_date="Initial")

        effnet_path = Path(self.tempdir.name) / "effnet_visit_fl_round.pth"
        effnet_path.write_bytes(b"effnet-mil")
        effnet_model = self.cp.ensure_model_version(
            {
                "version_id": "model_global_efficientnet_v2_s_mil_full_http_test",
                "version_name": "global-efficientnet-v2-s-mil-full-http-test",
                "architecture": "efficientnet_v2_s_mil",
                "stage": "global",
                "model_path": str(effnet_path),
                "created_at": "2026-04-08T00:30:00+00:00",
                "ready": True,
                "is_current": False,
                "crop_mode": "raw",
                "case_aggregation": "attention_mil",
                "bag_level": True,
                "training_input_policy": "raw_or_model_defined",
                "preprocess_signature": "fakepreprocesssig",
                "num_classes": 2,
            }
        )

        fake_workflow = FakeWorkflow(self.app_module, self.cp)
        with patch.object(self.app_module, "_get_workflow", return_value=fake_workflow):
            start_response = self.client.post(
                f"/api/sites/{self.site_id}/training/federated/visit-level",
                headers={"Authorization": f"Bearer {admin_token}"},
                json={
                    "model_version_id": effnet_model["version_id"],
                    "execution_mode": "cpu",
                    "epochs": 1,
                    "learning_rate": 5e-5,
                    "batch_size": 2,
                },
            )
            self.assertEqual(start_response.status_code, 200, start_response.text)
            start_payload = start_response.json()
            job_id = start_payload["job"]["job_id"]
            self.assertEqual(start_payload["model_version"]["architecture"], "efficientnet_v2_s_mil")

            self._run_site_jobs(workflow=fake_workflow, max_jobs=1, site_id=self.site_id)

            job_response = self.client.get(
                f"/api/sites/{self.site_id}/jobs/{job_id}",
                headers={"Authorization": f"Bearer {admin_token}"},
            )
            self.assertEqual(job_response.status_code, 200, job_response.text)
            job_payload = job_response.json()
            self.assertEqual(job_payload["status"], "completed")
            response_payload = job_payload["result"]["response"]
            self.assertEqual(response_payload["model_version"]["version_id"], effnet_model["version_id"])
            self.assertEqual(response_payload["eligible_case_count"], 2)
            self.assertEqual(response_payload["eligible_image_count"], 5)
            self.assertEqual(response_payload["update"]["aggregation_weight"], 2)
            self.assertEqual(response_payload["update"]["aggregation_weight_unit"], "cases")
            self.assertEqual(response_payload["update"]["federated_round_type"], "visit_level_site_round")
            self.assertEqual(response_payload["update"]["status"], "pending_review")

    def test_visit_level_federated_round_status_http(self):
        admin_token = self._login("admin", "admin123")
        self._seed_case(admin_token, patient_id="HTTP-VISIT-FL-STATUS-001", visit_date="Initial")
        self._seed_case(admin_token, patient_id="HTTP-VISIT-FL-STATUS-002", visit_date="Initial")
        self._seed_case(admin_token, patient_id="HTTP-VISIT-FL-STATUS-003", visit_date="Initial")
        self._join_and_include_research_case(admin_token, patient_id="HTTP-VISIT-FL-STATUS-001", visit_date="Initial")
        self._join_and_include_research_case(admin_token, patient_id="HTTP-VISIT-FL-STATUS-002", visit_date="Initial")

        effnet_path = Path(self.tempdir.name) / "effnet_visit_fl_status.pth"
        effnet_path.write_bytes(b"effnet-mil-status")
        effnet_model = self.cp.ensure_model_version(
            {
                "version_id": "model_global_efficientnet_v2_s_mil_full_http_status",
                "version_name": "global-efficientnet-v2-s-mil-full-http-status",
                "architecture": "efficientnet_v2_s_mil",
                "stage": "global",
                "model_path": str(effnet_path),
                "created_at": "2026-04-08T00:35:00+00:00",
                "ready": True,
                "is_current": False,
                "crop_mode": "raw",
                "case_aggregation": "attention_mil",
                "bag_level": True,
                "training_input_policy": "raw_or_model_defined",
                "preprocess_signature": "fakepreprocesssig",
                "num_classes": 2,
            }
        )

        start_response = self.client.post(
            f"/api/sites/{self.site_id}/training/federated/visit-level",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "model_version_id": effnet_model["version_id"],
                "execution_mode": "cpu",
            },
        )
        self.assertEqual(start_response.status_code, 200, start_response.text)
        start_payload = start_response.json()
        self.assertEqual(start_payload["model_version"]["version_id"], effnet_model["version_id"])

        status_response = self.client.get(
            f"/api/sites/{self.site_id}/training/federated/visit-level/status?model_version_id={effnet_model['version_id']}",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        self.assertEqual(status_response.status_code, 200, status_response.text)
        payload = status_response.json()
        self.assertEqual(payload["site_id"], self.site_id)
        self.assertEqual(payload["model_version"]["version_id"], effnet_model["version_id"])
        self.assertEqual(payload["model_version"]["architecture"], "efficientnet_v2_s_mil")
        self.assertEqual(payload["model_version"]["case_aggregation"], "attention_mil")
        self.assertTrue(payload["model_version"]["bag_level"])
        self.assertEqual(payload["eligible_case_count"], 2)
        self.assertEqual(payload["eligible_image_count"], 2)
        self.assertEqual(payload["skipped"]["not_positive"], 0)
        self.assertEqual(payload["skipped"]["not_active"], 0)
        self.assertEqual(payload["skipped"]["not_included"], 1)
        self.assertEqual(payload["skipped"]["no_images"], 0)
        self.assertIsNotNone(payload["active_job"])
        self.assertEqual(payload["active_job"]["job_id"], start_payload["job"]["job_id"])

    def test_visit_level_federated_round_does_not_reuse_active_job_with_different_hyperparameters_http(self):
        admin_token = self._login("admin", "admin123")
        self._seed_case(admin_token, patient_id="HTTP-VISIT-FL-DIFFCFG-001", visit_date="Initial")
        self._join_and_include_research_case(admin_token, patient_id="HTTP-VISIT-FL-DIFFCFG-001", visit_date="Initial")

        effnet_path = Path(self.tempdir.name) / "effnet_visit_fl_diffcfg.pth"
        effnet_path.write_bytes(b"effnet-mil-diffcfg")
        effnet_model = self.cp.ensure_model_version(
            {
                "version_id": "model_global_efficientnet_v2_s_mil_full_http_diffcfg",
                "version_name": "global-efficientnet-v2-s-mil-full-http-diffcfg",
                "architecture": "efficientnet_v2_s_mil",
                "stage": "global",
                "model_path": str(effnet_path),
                "created_at": "2026-04-08T00:35:30+00:00",
                "ready": True,
                "is_current": False,
                "crop_mode": "raw",
                "case_aggregation": "attention_mil",
                "bag_level": True,
                "training_input_policy": "raw_or_model_defined",
                "preprocess_signature": "fakepreprocesssig",
                "num_classes": 2,
            }
        )

        first_response = self.client.post(
            f"/api/sites/{self.site_id}/training/federated/visit-level",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "model_version_id": effnet_model["version_id"],
                "execution_mode": "cpu",
                "epochs": 1,
                "learning_rate": 5e-5,
                "batch_size": 2,
            },
        )
        self.assertEqual(first_response.status_code, 200, first_response.text)
        first_job_id = first_response.json()["job"]["job_id"]

        second_response = self.client.post(
            f"/api/sites/{self.site_id}/training/federated/visit-level",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "model_version_id": effnet_model["version_id"],
                "execution_mode": "cpu",
                "epochs": 2,
                "learning_rate": 5e-5,
                "batch_size": 2,
            },
        )
        self.assertEqual(second_response.status_code, 200, second_response.text)
        self.assertNotEqual(second_response.json()["job"]["job_id"], first_job_id)

    def test_visit_level_federated_round_status_clears_active_job_after_completion_http(self):
        admin_token = self._login("admin", "admin123")
        self._seed_case(admin_token, patient_id="HTTP-VISIT-FL-ACTIVE-CLEAR-001", visit_date="Initial")
        self._join_and_include_research_case(admin_token, patient_id="HTTP-VISIT-FL-ACTIVE-CLEAR-001", visit_date="Initial")

        effnet_path = Path(self.tempdir.name) / "effnet_visit_fl_active_clear.pth"
        effnet_path.write_bytes(b"effnet-active-clear")
        effnet_model = self.cp.ensure_model_version(
            {
                "version_id": "model_global_efficientnet_v2_s_mil_full_http_active_clear",
                "version_name": "global-efficientnet-v2-s-mil-full-http-active-clear",
                "architecture": "efficientnet_v2_s_mil",
                "stage": "global",
                "model_path": str(effnet_path),
                "created_at": "2026-04-08T00:35:40+00:00",
                "ready": True,
                "is_current": False,
                "crop_mode": "raw",
                "case_aggregation": "attention_mil",
                "bag_level": True,
                "training_input_policy": "raw_or_model_defined",
                "preprocess_signature": "fakepreprocesssig",
                "num_classes": 2,
            }
        )

        fake_workflow = FakeWorkflow(self.app_module, self.cp)
        with patch.object(self.app_module, "_get_workflow", return_value=fake_workflow):
            start_response = self.client.post(
                f"/api/sites/{self.site_id}/training/federated/visit-level",
                headers={"Authorization": f"Bearer {admin_token}"},
                json={"model_version_id": effnet_model["version_id"], "execution_mode": "cpu"},
            )
            self.assertEqual(start_response.status_code, 200, start_response.text)

            self._run_site_jobs(workflow=fake_workflow, max_jobs=1, site_id=self.site_id)

        status_response = self.client.get(
            f"/api/sites/{self.site_id}/training/federated/visit-level/status?model_version_id={effnet_model['version_id']}",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        self.assertEqual(status_response.status_code, 200, status_response.text)
        self.assertIsNone(status_response.json()["active_job"])

    def test_visit_level_federated_round_auto_selects_preferred_mil_model_http(self):
        admin_token = self._login("admin", "admin123")
        self._seed_case(admin_token, patient_id="HTTP-VISIT-FL-AUTO-001", visit_date="Initial")
        self._join_and_include_research_case(admin_token, patient_id="HTTP-VISIT-FL-AUTO-001", visit_date="Initial")

        baseline_path = Path(self.tempdir.name) / "auto_select_baseline.pth"
        baseline_path.write_bytes(b"baseline")
        self.cp.ensure_model_version(
            {
                "version_id": "model_global_densenet_http_auto_select",
                "version_name": "global-densenet-http-auto-select",
                "architecture": "densenet121",
                "stage": "global",
                "model_path": str(baseline_path),
                "created_at": "2026-04-08T00:33:00+00:00",
                "ready": True,
                "is_current": True,
                "crop_mode": "raw",
                "case_aggregation": "mean",
                "bag_level": False,
                "training_input_policy": "raw_or_model_defined",
                "preprocess_signature": "fakepreprocesssig",
                "num_classes": 2,
            }
        )

        effnet_path = Path(self.tempdir.name) / "auto_select_effnet_mil.pth"
        effnet_path.write_bytes(b"effnet-mil-auto-select")
        preferred_model = self.cp.ensure_model_version(
            {
                "version_id": "model_global_efficientnet_v2_s_mil_full_http_autoselect",
                "version_name": "global-efficientnet-v2-s-mil-full-http-autoselect",
                "architecture": "efficientnet_v2_s_mil",
                "stage": "global",
                "model_path": str(effnet_path),
                "created_at": "2026-04-08T00:34:00+00:00",
                "ready": True,
                "is_current": False,
                "crop_mode": "raw",
                "case_aggregation": "attention_mil",
                "bag_level": True,
                "training_input_policy": "raw_or_model_defined",
                "preprocess_signature": "fakepreprocesssig",
                "num_classes": 2,
            }
        )

        start_response = self.client.post(
            f"/api/sites/{self.site_id}/training/federated/visit-level",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"execution_mode": "cpu"},
        )
        self.assertEqual(start_response.status_code, 200, start_response.text)
        self.assertEqual(start_response.json()["model_version"]["version_id"], preferred_model["version_id"])

    def test_visit_level_federated_round_rejects_image_level_model_http(self):
        admin_token = self._login("admin", "admin123")
        self._seed_case(admin_token, patient_id="HTTP-VISIT-FL-BADMODEL-001", visit_date="Initial")
        self._join_and_include_research_case(admin_token, patient_id="HTTP-VISIT-FL-BADMODEL-001", visit_date="Initial")

        convnext_path = Path(self.tempdir.name) / "badmodel_convnext.pth"
        convnext_path.write_bytes(b"convnext")
        convnext_model = self.cp.ensure_model_version(
            {
                "version_id": "model_global_convnext_tiny_full_http_bad_visit_fl",
                "version_name": "global-convnext-tiny-full-http-bad-visit-fl",
                "architecture": "convnext_tiny",
                "stage": "global",
                "model_path": str(convnext_path),
                "created_at": "2026-04-08T00:37:00+00:00",
                "ready": True,
                "is_current": False,
                "crop_mode": "raw",
                "case_aggregation": "mean",
                "bag_level": False,
                "training_input_policy": "raw_or_model_defined",
                "preprocess_signature": "fakepreprocesssig",
                "num_classes": 2,
            }
        )

        start_response = self.client.post(
            f"/api/sites/{self.site_id}/training/federated/visit-level",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "model_version_id": convnext_model["version_id"],
                "execution_mode": "cpu",
            },
        )
        self.assertEqual(start_response.status_code, 400, start_response.text)
        self.assertIn("supports only EfficientNetV2-S MIL", start_response.json()["detail"])

    def test_visit_level_federated_round_requires_eligible_cases_http(self):
        admin_token = self._login("admin", "admin123")
        self._seed_case(admin_token, patient_id="HTTP-VISIT-FL-NOELIGIBLE-001", visit_date="Initial")

        consent_response = self.client.post(
            f"/api/sites/{self.site_id}/research-registry/consent",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"version": "v1"},
        )
        self.assertEqual(consent_response.status_code, 200, consent_response.text)

        effnet_path = Path(self.tempdir.name) / "effnet_visit_fl_noeligible.pth"
        effnet_path.write_bytes(b"effnet-mil-noeligible")
        effnet_model = self.cp.ensure_model_version(
            {
                "version_id": "model_global_efficientnet_v2_s_mil_full_http_noeligible",
                "version_name": "global-efficientnet-v2-s-mil-full-http-noeligible",
                "architecture": "efficientnet_v2_s_mil",
                "stage": "global",
                "model_path": str(effnet_path),
                "created_at": "2026-04-08T00:36:00+00:00",
                "ready": True,
                "is_current": False,
                "crop_mode": "raw",
                "case_aggregation": "attention_mil",
                "bag_level": True,
                "training_input_policy": "raw_or_model_defined",
                "preprocess_signature": "fakepreprocesssig",
                "num_classes": 2,
            }
        )

        start_response = self.client.post(
            f"/api/sites/{self.site_id}/training/federated/visit-level",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"model_version_id": effnet_model["version_id"], "execution_mode": "cpu"},
        )
        self.assertEqual(start_response.status_code, 409, start_response.text)
        self.assertIn("requires at least one positive, active, included case", start_response.json()["detail"])

    def test_aggregation_prefers_visit_level_aggregation_weight_http(self):
        admin_token = self._login("admin", "admin123")
        fake_workflow = FakeWorkflow(self.app_module, self.cp)
        base_model_path = Path(self.tempdir.name) / "effnet_visit_agg_base.pth"
        base_model_path.write_bytes(b"base")
        base_model = self.cp.ensure_model_version(
            {
                "version_id": "model_global_efficientnet_v2_s_mil_full_http_agg",
                "version_name": "global-efficientnet-v2-s-mil-full-http-agg",
                "architecture": "efficientnet_v2_s_mil",
                "stage": "global",
                "model_path": str(base_model_path),
                "created_at": "2026-04-08T00:40:00+00:00",
                "ready": True,
                "is_current": False,
                "crop_mode": "raw",
                "case_aggregation": "attention_mil",
                "bag_level": True,
                "training_input_policy": "raw_or_model_defined",
                "preprocess_signature": "fakepreprocesssig",
                "num_classes": 2,
            }
        )
        for site_id, n_cases, aggregation_weight in (("SITE-A", 2, 7), ("SITE-B", 4, 13)):
            delta_path = self.site_store.update_dir / f"{site_id}_visit_fl_delta.pt"
            delta_path.parent.mkdir(parents=True, exist_ok=True)
            delta_path.write_bytes(b"delta")
            self.cp.register_model_update(
                {
                    "update_id": self.app_module.make_id("update"),
                    "site_id": site_id,
                    "base_model_version_id": base_model["version_id"],
                    "architecture": base_model["architecture"],
                    "upload_type": "weight delta",
                    "execution_device": "cpu",
                    "artifact_path": str(delta_path),
                    "n_cases": n_cases,
                    "aggregation_weight": aggregation_weight,
                    "aggregation_weight_unit": "cases",
                    "federated_round_type": "visit_level_site_round",
                    "created_at": f"2026-04-08T00:4{n_cases}:00+00:00",
                    "status": "approved",
                }
            )

        with patch.object(self.app_module, "_get_workflow", return_value=fake_workflow):
            aggregation_response = self.client.post(
                "/api/admin/aggregations/run",
                headers={"Authorization": f"Bearer {admin_token}"},
                json={},
            )

        self.assertEqual(aggregation_response.status_code, 200, aggregation_response.text)
        self.assertTrue(fake_workflow.model_manager.aggregate_calls)
        self.assertEqual(sorted(fake_workflow.model_manager.aggregate_calls[-1]["weights"]), [7, 13])

    def test_aggregation_prefers_image_level_aggregation_weight_http(self):
        admin_token = self._login("admin", "admin123")
        fake_workflow = FakeWorkflow(self.app_module, self.cp)
        base_model_path = Path(self.tempdir.name) / "convnext_agg_base.pth"
        base_model_path.write_bytes(b"base")
        base_model = self.cp.ensure_model_version(
            {
                "version_id": "model_global_convnext_tiny_full_http_agg",
                "version_name": "global-convnext-tiny-full-http-agg",
                "architecture": "convnext_tiny",
                "stage": "global",
                "model_path": str(base_model_path),
                "created_at": "2026-04-08T00:10:00+00:00",
                "ready": True,
                "is_current": False,
                "crop_mode": "raw",
                "case_aggregation": "mean",
                "bag_level": False,
                "training_input_policy": "raw_or_model_defined",
                "preprocess_signature": "fakepreprocesssig",
                "num_classes": 2,
            }
        )
        for site_id, n_cases, aggregation_weight in (("SITE-A", 2, 11), ("SITE-B", 4, 29)):
            delta_path = self.site_store.update_dir / f"{site_id}_image_fl_delta.pt"
            delta_path.parent.mkdir(parents=True, exist_ok=True)
            delta_path.write_bytes(b"delta")
            self.cp.register_model_update(
                {
                    "update_id": self.app_module.make_id("update"),
                    "site_id": site_id,
                    "base_model_version_id": base_model["version_id"],
                    "architecture": base_model["architecture"],
                    "upload_type": "weight delta",
                    "execution_device": "cpu",
                    "artifact_path": str(delta_path),
                    "n_cases": n_cases,
                    "aggregation_weight": aggregation_weight,
                    "aggregation_weight_unit": "images",
                    "created_at": f"2026-04-08T00:1{n_cases}:00+00:00",
                    "status": "approved",
                }
            )

        with patch.object(self.app_module, "_get_workflow", return_value=fake_workflow):
            aggregation_response = self.client.post(
                "/api/admin/aggregations/run",
                headers={"Authorization": f"Bearer {admin_token}"},
                json={},
            )

        self.assertEqual(aggregation_response.status_code, 200, aggregation_response.text)
        self.assertTrue(fake_workflow.model_manager.aggregate_calls)
        self.assertEqual(sorted(fake_workflow.model_manager.aggregate_calls[-1]["weights"]), [11, 29])

    def test_aggregation_rejects_mixed_federated_round_types_http(self):
        admin_token = self._login("admin", "admin123")
        base_model_path = Path(self.tempdir.name) / "convnext_mixed_rounds_base.pth"
        base_model_path.write_bytes(b"base")
        base_model = self.cp.ensure_model_version(
            {
                "version_id": "model_global_convnext_tiny_full_http_mixed",
                "version_name": "global-convnext-tiny-full-http-mixed",
                "architecture": "convnext_tiny",
                "stage": "global",
                "model_path": str(base_model_path),
                "created_at": "2026-04-08T00:20:00+00:00",
                "ready": True,
                "is_current": False,
                "crop_mode": "raw",
                "case_aggregation": "mean",
                "bag_level": False,
                "training_input_policy": "raw_or_model_defined",
                "preprocess_signature": "fakepreprocesssig",
                "num_classes": 2,
            }
        )
        update_ids: list[str] = []
        for site_id, round_type in (("SITE-A", None), ("SITE-B", "image_level_site_round")):
            delta_path = self.site_store.update_dir / f"{site_id}_mixed_round_delta.pt"
            delta_path.parent.mkdir(parents=True, exist_ok=True)
            delta_path.write_bytes(b"delta")
            update = self.cp.register_model_update(
                {
                    "update_id": self.app_module.make_id("update"),
                    "site_id": site_id,
                    "base_model_version_id": base_model["version_id"],
                    "architecture": base_model["architecture"],
                    "upload_type": "weight delta",
                    "execution_device": "cpu",
                    "artifact_path": str(delta_path),
                    "n_cases": 2,
                    "aggregation_weight": 2,
                    "aggregation_weight_unit": "images" if round_type else "cases",
                    "federated_round_type": round_type,
                    "created_at": "2026-04-08T00:21:00+00:00",
                    "status": "approved",
                }
            )
            update_ids.append(update["update_id"])

        aggregation_response = self.client.post(
            "/api/admin/aggregations/run",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"update_ids": update_ids},
        )
        self.assertEqual(aggregation_response.status_code, 400, aggregation_response.text)
        self.assertIn("same federated round type", aggregation_response.json()["detail"])

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

    def test_aggregation_requires_non_dp_acknowledgement_in_production_like_runtime_http(self):
        admin_token = self._login("admin", "admin123")
        base_model = self.cp.current_global_model()
        for index in range(2):
            delta_path = self.site_store.update_dir / f"prod_ack_delta_{index}.pt"
            delta_path.parent.mkdir(parents=True, exist_ok=True)
            delta_path.write_bytes(b"delta")
            self.cp.register_model_update(
                {
                    "update_id": self.app_module.make_id("update"),
                    "site_id": self.site_id if index == 0 else "SITE-B",
                    "base_model_version_id": base_model["version_id"],
                    "architecture": base_model["architecture"],
                    "upload_type": "weight delta",
                    "execution_device": "cpu",
                    "artifact_path": str(delta_path),
                    "n_cases": 1,
                    "created_at": f"2026-04-14T01:1{index}:00+00:00",
                    "status": "approved",
                }
            )

        with patch.dict(os.environ, {"KERA_ENVIRONMENT": "production"}, clear=False):
            aggregation_response = self.client.post(
                "/api/admin/aggregations/run",
                headers={"Authorization": f"Bearer {admin_token}"},
                json={},
            )

        self.assertEqual(aggregation_response.status_code, 409, aggregation_response.text)
        self.assertIn("KERA_ACKNOWLEDGE_NON_DP_FEDERATED_TRAINING", aggregation_response.json()["detail"])

    def test_aggregation_job_endpoints_persist_status_and_dp_accounting_http(self):
        from kera_research.services.federated_update_security import apply_federated_update_signature

        admin_token = self._login("admin", "admin123")
        fake_workflow = FakeWorkflow(self.app_module, self.cp)
        real_aggregate = fake_workflow.model_manager.aggregate_weight_deltas

        def slow_aggregate(*args, **kwargs):
            time.sleep(0.35)
            return real_aggregate(*args, **kwargs)

        fake_workflow.model_manager.aggregate_weight_deltas = slow_aggregate
        base_model_path = Path(self.tempdir.name) / "dp_agg_base.pth"
        base_model_path.write_bytes(b"base")
        base_model = self.cp.ensure_model_version(
            {
                "version_id": "model_global_convnext_tiny_dp_http_agg",
                "version_name": "global-convnext-tiny-dp-http-agg",
                "architecture": "convnext_tiny",
                "stage": "global",
                "model_path": str(base_model_path),
                "created_at": "2026-04-14T03:10:00+00:00",
                "ready": True,
                "is_current": False,
                "crop_mode": "raw",
                "case_aggregation": "mean",
                "bag_level": False,
                "training_input_policy": "raw_or_model_defined",
                "preprocess_signature": "fakepreprocesssig",
                "num_classes": 2,
            }
        )
        with patch.dict(
            os.environ,
            {
                "KERA_FEDERATED_UPDATE_SIGNING_SECRET": "fed-signing-secret",
                "KERA_REQUIRE_SIGNED_FEDERATED_UPDATES": "true",
            },
            clear=False,
        ):
            for site_id, epsilon in (("SITE-A", 0.4), ("SITE-B", 0.7)):
                delta_path = self.site_store.update_dir / f"{site_id}_dp_agg_delta.pt"
                delta_path.parent.mkdir(parents=True, exist_ok=True)
                delta_path.write_bytes(f"delta-{site_id}".encode("utf-8"))
                update_id = self.app_module.make_id("update")
                artifact_metadata = self.cp.store_model_update_artifact(
                    delta_path,
                    update_id=update_id,
                    artifact_kind="delta",
                )
                update = apply_federated_update_signature(
                    {
                        "update_id": update_id,
                        "site_id": site_id,
                        "base_model_version_id": base_model["version_id"],
                        "architecture": base_model["architecture"],
                        "upload_type": "weight delta",
                        "execution_device": "cpu",
                        "artifact_path": str(delta_path),
                        **artifact_metadata,
                        "n_cases": 2,
                        "aggregation_weight": 2,
                        "aggregation_weight_unit": "cases",
                        "federated_round_type": "visit_level_site_round",
                        "dp_accounting": {
                            "formal_dp_accounting": True,
                            "epsilon": epsilon,
                            "delta": 1e-5,
                        },
                        "created_at": "2026-04-14T03:11:00+00:00",
                        "status": "approved",
                    }
                )
                self.cp.register_model_update(update)

            with patch.object(self.app_module, "_get_workflow", return_value=fake_workflow):
                aggregation_response = self.client.post(
                    "/api/admin/aggregations/run",
                    headers={"Authorization": f"Bearer {admin_token}"},
                    json={},
                )

        self.assertEqual(aggregation_response.status_code, 200, aggregation_response.text)
        payload = aggregation_response.json()
        self.assertEqual(payload["status"], "running")
        job_id = payload["job_id"]

        jobs_response = self.client.get(
            "/api/admin/aggregations/jobs",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        self.assertEqual(jobs_response.status_code, 200, jobs_response.text)
        listed_job = next(item for item in jobs_response.json() if item["job_id"] == job_id)
        self.assertEqual(listed_job["status"], "running")

        job_detail_payload = None
        for _ in range(20):
            job_detail_response = self.client.get(
                f"/api/admin/aggregations/jobs/{job_id}",
                headers={"Authorization": f"Bearer {admin_token}"},
            )
            self.assertEqual(job_detail_response.status_code, 200, job_detail_response.text)
            job_detail_payload = job_detail_response.json()
            if job_detail_payload["status"] == "done":
                break
            time.sleep(0.05)
        self.assertIsNotNone(job_detail_payload)
        self.assertEqual(job_detail_payload["status"], "done")
        dp_accounting = job_detail_payload["result"]["aggregation"]["dp_accounting"]
        self.assertTrue(dp_accounting["formal_dp_accounting"])
        self.assertEqual(dp_accounting["accounted_updates"], 2)
        self.assertAlmostEqual(float(dp_accounting["epsilon"] or 0.0), 1.1)
        self.assertEqual(len(dp_accounting["sites"]), 2)

    def test_register_model_update_rejects_tampered_federated_signature_http(self):
        from kera_research.services.federated_update_security import apply_federated_update_signature

        delta_path = self.site_store.update_dir / "signed_delta_tamper.pt"
        delta_path.parent.mkdir(parents=True, exist_ok=True)
        delta_path.write_bytes(b"signed-delta")
        update_id = self.app_module.make_id("update")
        artifact_metadata = self.cp.store_model_update_artifact(
            delta_path,
            update_id=update_id,
            artifact_kind="delta",
        )
        update_record = {
            "update_id": update_id,
            "site_id": self.site_id,
            "base_model_version_id": self.cp.current_global_model()["version_id"],
            "architecture": "densenet121",
            "upload_type": "weight delta",
            "execution_device": "cpu",
            "artifact_path": str(delta_path),
            **artifact_metadata,
            "n_cases": 2,
            "aggregation_weight": 2,
            "aggregation_weight_unit": "cases",
            "created_at": "2026-04-14T00:00:00+00:00",
            "status": "pending_review",
        }
        with patch.dict(
            os.environ,
            {
                "KERA_FEDERATED_UPDATE_SIGNING_SECRET": "fed-signing-secret",
                "KERA_REQUIRE_SIGNED_FEDERATED_UPDATES": "true",
            },
            clear=False,
        ):
            signed = apply_federated_update_signature(update_record)
            accepted = self.cp.register_model_update(dict(signed))
            self.assertTrue(str(accepted.get("federated_update_signature") or "").strip())

            tampered = dict(signed)
            tampered["aggregation_weight"] = 99
            with self.assertRaises(ValueError):
                self.cp.register_model_update(tampered)

    def test_aggregation_uses_configured_robust_strategy_http(self):
        from kera_research.services.federated_update_security import apply_federated_update_signature

        admin_token = self._login("admin", "admin123")
        fake_workflow = FakeWorkflow(self.app_module, self.cp)
        base_model_path = Path(self.tempdir.name) / "robust_agg_base.pth"
        base_model_path.write_bytes(b"base")
        base_model = self.cp.ensure_model_version(
            {
                "version_id": "model_global_convnext_tiny_robust_http_agg",
                "version_name": "global-convnext-tiny-robust-http-agg",
                "architecture": "convnext_tiny",
                "stage": "global",
                "model_path": str(base_model_path),
                "created_at": "2026-04-14T00:10:00+00:00",
                "ready": True,
                "is_current": False,
                "crop_mode": "raw",
                "case_aggregation": "mean",
                "bag_level": False,
                "training_input_policy": "raw_or_model_defined",
                "preprocess_signature": "fakepreprocesssig",
                "num_classes": 2,
            }
        )
        with patch.dict(
            os.environ,
            {
                "KERA_FEDERATED_UPDATE_SIGNING_SECRET": "fed-signing-secret",
                "KERA_REQUIRE_SIGNED_FEDERATED_UPDATES": "true",
                "KERA_FEDERATED_AGGREGATION_STRATEGY": "coordinate_median",
                "KERA_FEDERATED_AGGREGATION_TRIM_RATIO": "0.3",
            },
            clear=False,
        ):
            for site_id, aggregation_weight in (("SITE-A", 5), ("SITE-B", 7)):
                delta_path = self.site_store.update_dir / f"{site_id}_robust_delta.pt"
                delta_path.parent.mkdir(parents=True, exist_ok=True)
                delta_path.write_bytes(f"delta-{site_id}".encode("utf-8"))
                update_id = self.app_module.make_id("update")
                artifact_metadata = self.cp.store_model_update_artifact(
                    delta_path,
                    update_id=update_id,
                    artifact_kind="delta",
                )
                update = apply_federated_update_signature(
                    {
                        "update_id": update_id,
                        "site_id": site_id,
                        "base_model_version_id": base_model["version_id"],
                        "architecture": base_model["architecture"],
                        "upload_type": "weight delta",
                        "execution_device": "cpu",
                        "artifact_path": str(delta_path),
                        **artifact_metadata,
                        "n_cases": aggregation_weight,
                        "aggregation_weight": aggregation_weight,
                        "aggregation_weight_unit": "images",
                        "federated_round_type": "image_level_site_round",
                        "created_at": "2026-04-14T00:11:00+00:00",
                        "status": "approved",
                    }
                )
                self.cp.register_model_update(update)

            with patch.object(self.app_module, "_get_workflow", return_value=fake_workflow):
                aggregation_response = self.client.post(
                    "/api/admin/aggregations/run",
                    headers={"Authorization": f"Bearer {admin_token}"},
                    json={},
                )

        self.assertEqual(aggregation_response.status_code, 200, aggregation_response.text)
        self.assertTrue(fake_workflow.model_manager.aggregate_calls)
        self.assertEqual(fake_workflow.model_manager.aggregate_calls[-1]["strategy"], "coordinate_median")
        payload = aggregation_response.json()["aggregation"]
        self.assertEqual(payload["aggregation_strategy"], "coordinate_median")
        self.assertEqual(payload["weighting_mode"], "per_site_uniform")

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

        with patch("kera_research.services.admin_registry_orchestrator.OneDrivePublisher", return_value=fake_publisher):
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

        with patch("kera_research.services.admin_registry_orchestrator.OneDrivePublisher", return_value=fake_publisher):
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

    def test_release_rollout_local_fallback_activates_selected_model_http(self):
        admin_token = self._login("admin", "admin123")
        rollout_model_path = Path(self.tempdir.name) / "rollout_model.pth"
        rollout_model_path.write_bytes(b"rollout-model")
        candidate = self.cp.ensure_model_version(
            {
                "version_id": self.app_module.make_id("model"),
                "version_name": "visit-effnet-mil-rollout",
                "architecture": "efficientnet_v2_s_mil_full",
                "stage": "global",
                "model_path": str(rollout_model_path),
                "created_at": "2026-04-09T00:00:00+00:00",
                "ready": True,
                "is_current": False,
            }
        )

        response = self.client.post(
            "/api/admin/release-rollouts",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "version_id": candidate["version_id"],
                "stage": "full",
                "notes": "Promote trained MIL model",
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()["rollout"]
        self.assertEqual(payload["version_id"], candidate["version_id"])
        self.assertEqual(payload["stage"], "full")
        self.assertEqual(payload["status"], "active")
        current_model = self.cp.current_global_model()
        self.assertEqual(current_model["version_id"], candidate["version_id"])

    def test_release_rollout_local_fallback_rejects_pilot_stage_http(self):
        admin_token = self._login("admin", "admin123")
        rollout_model_path = Path(self.tempdir.name) / "pilot_rollout_model.pth"
        rollout_model_path.write_bytes(b"pilot-rollout-model")
        candidate = self.cp.ensure_model_version(
            {
                "version_id": self.app_module.make_id("model"),
                "version_name": "visit-effnet-mil-pilot",
                "architecture": "efficientnet_v2_s_mil_full",
                "stage": "global",
                "model_path": str(rollout_model_path),
                "created_at": "2026-04-09T00:00:00+00:00",
                "ready": True,
                "is_current": False,
            }
        )

        response = self.client.post(
            "/api/admin/release-rollouts",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "version_id": candidate["version_id"],
                "stage": "pilot",
                "target_site_ids": [self.site_id],
                "notes": "Pilot rollout should require central control plane",
            },
        )
        self.assertEqual(response.status_code, 503, response.text)
        self.assertEqual(response.json()["detail"], "Staged rollout requires the central control plane.")

    def test_federation_monitoring_local_fallback_reports_current_release_http(self):
        admin_token = self._login("admin", "admin123")

        monitoring_response = self.client.get(
            "/api/admin/federation/monitoring",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        self.assertEqual(monitoring_response.status_code, 200, monitoring_response.text)
        payload = monitoring_response.json()
        self.assertEqual(payload["current_release"]["version_id"], "model_http_seed")
        self.assertIsNone(payload["active_rollout"])
        self.assertEqual(payload["node_summary"]["total_nodes"], 0)
        self.assertEqual(payload["node_summary"]["aligned_nodes"], 0)
        self.assertEqual(len(payload["site_adoption"]), 1)
        site_summary = payload["site_adoption"][0]
        self.assertEqual(site_summary["site_id"], self.site_id)
        self.assertEqual(site_summary["expected_version_id"], "model_http_seed")
        self.assertIsNone(site_summary["latest_reported_version_id"])

    def test_access_request_auto_approval_http(self):
        requester_token = self._token_for_username("http_viewer")
        access_response = self.client.post(
            "/api/auth/request-access",
            headers={"Authorization": f"Bearer {requester_token}"},
            json={"requested_site_id": self.site_id, "requested_role": "researcher", "message": "Need site access"},
        )
        self.assertEqual(access_response.status_code, 200, access_response.text)
        access_payload = access_response.json()
        self.assertEqual(access_payload["request"]["status"], "approved")
        self.assertEqual(access_payload["auth_state"], "approved")
        self.assertEqual(access_payload["user"]["approval_status"], "approved")
        self.assertEqual(access_payload["user"]["role"], "researcher")
        self.assertIn(self.site_id, access_payload["user"]["site_ids"] or [])

        admin_token = self._login("admin", "admin123")
        queue_response = self.client.get("/api/admin/access-requests?status_filter=pending", headers={"Authorization": f"Bearer {admin_token}"})
        self.assertEqual(queue_response.status_code, 200, queue_response.text)
        self.assertEqual(queue_response.json(), [])

        approved_response = self.client.get(
            "/api/admin/access-requests?status_filter=approved",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        self.assertEqual(approved_response.status_code, 200, approved_response.text)
        approved_request = next(item for item in approved_response.json() if item["request_id"] == access_payload["request"]["request_id"])
        self.assertEqual(approved_request["requested_site_id"], self.site_id)
        self.assertEqual(approved_request["resolved_site_id"], self.site_id)
        self.assertEqual(approved_request["reviewer_notes"], "Automatically approved researcher access request.")

        refreshed_user = self.cp.get_user_by_id(self.requester["user_id"])
        self.assertEqual(refreshed_user["role"], "researcher")
        self.assertIn(self.site_id, refreshed_user["site_ids"] or [])

    def test_access_request_review_replaces_existing_hospital_http(self):
        replacement_site_id = f"HTTP_{self.app_module.make_id('site')[-6:].upper()}"
        project_id = self.cp.list_projects()[0]["project_id"]
        self.cp.create_site(project_id, replacement_site_id, "Replacement Site", "Replacement Hospital")

        researcher_token = self._token_for_username("http_researcher")
        access_response = self.client.post(
            "/api/auth/request-access",
            headers={"Authorization": f"Bearer {researcher_token}"},
            json={
                "requested_site_id": replacement_site_id,
                "requested_role": "researcher",
                "message": "Move me to the replacement hospital",
            },
        )
        self.assertEqual(access_response.status_code, 200, access_response.text)
        access_payload = access_response.json()
        self.assertEqual(access_payload["request"]["status"], "pending")
        self.assertEqual(access_payload["user"]["site_ids"], [self.site_id])

        reviewed_request = self.cp.review_access_request(
            request_id=access_payload["request"]["request_id"],
            reviewer_user_id="user_admin",
            decision="approved",
            assigned_role="researcher",
            assigned_site_id=replacement_site_id,
            reviewer_notes="replace the current hospital",
        )
        self.assertEqual(reviewed_request["status"], "approved")
        self.assertEqual(reviewed_request["requested_site_id"], replacement_site_id)

        refreshed_user = self.cp.get_user_by_id(self.researcher["user_id"])
        self.assertEqual(refreshed_user["role"], "researcher")
        self.assertEqual(refreshed_user["site_ids"], [replacement_site_id])
        self.assertNotIn(self.site_id, refreshed_user["site_ids"] or [])

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
                "requested_role": "site_admin",
                "message": "Need ophthalmology directory onboarding",
            },
        )
        self.assertEqual(access_response.status_code, 200, access_response.text)
        request_payload = access_response.json()["request"]
        self.assertEqual(request_payload["requested_site_id"], "HIRA_EYE_001")
        self.assertEqual(request_payload["requested_site_label"], "Kim Eye Clinic")
        self.assertEqual(request_payload["requested_role"], "researcher")
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
        self.assertEqual(matching_request["requested_role"], "researcher")
        self.assertIsNone(matching_request["resolved_site_id"])

        review_response = self.client.post(
            f"/api/admin/access-requests/{matching_request['request_id']}/review",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "decision": "approved",
                "assigned_role": "researcher",
                "create_site_if_missing": True,
                "hospital_name": "Park Eye Hospital",
                "research_registry_enabled": False,
                "reviewer_notes": "created during approval",
            },
        )
        self.assertEqual(review_response.status_code, 200, review_response.text)
        review_payload = review_response.json()
        created_site_id = review_payload["created_site"]["site_id"]
        self.assertEqual(review_payload["request"]["status"], "approved")
        self.assertEqual(review_payload["request"]["requested_site_id"], created_site_id)
        self.assertEqual(review_payload["request"]["requested_role"], "researcher")
        self.assertEqual(review_payload["request"]["resolved_site_id"], created_site_id)
        self.assertIsNotNone(review_payload["created_site"])
        self.assertTrue(created_site_id.startswith("site_"))
        self.assertEqual(review_payload["created_site"]["source_institution_id"], "HIRA_EYE_002")
        self.assertEqual(review_payload["created_site"]["display_name"], "Park Eye Hospital")
        self.assertFalse(review_payload["created_site"]["research_registry_enabled"])

        refreshed_user = self.cp.get_user_by_id(self.requester["user_id"])
        self.assertEqual(refreshed_user["role"], "researcher")
        self.assertIn(created_site_id, refreshed_user["site_ids"] or [])
        created_site = self.cp.get_site(created_site_id)
        self.assertIsNotNone(created_site)
        self.assertEqual(created_site["source_institution_id"], "HIRA_EYE_002")
        self.assertEqual(created_site["display_name"], "Park Eye Hospital")
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
        self.assertEqual(len(projects_response.json()), 1)
        project_id = projects_response.json()[0]["project_id"]

        create_project_response = self.client.post(
          "/api/admin/projects",
          headers={"Authorization": f"Bearer {admin_token}"},
          json={"name": "Ops Project", "description": "ops"},
        )
        self.assertEqual(create_project_response.status_code, 400, create_project_response.text)
        self.assertIn("Projects are fixed to the default workspace.", create_project_response.text)

        create_site_response = self.client.post(
            "/api/admin/sites",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "project_id": project_id,
                "hospital_name": "Ops Hospital",
                "source_institution_id": "OPS_HTTP_SOURCE",
            },
        )
        self.assertEqual(create_site_response.status_code, 200, create_site_response.text)
        site_id = create_site_response.json()["site_id"]

        update_site_response = self.client.patch(
            f"/api/admin/sites/{site_id}",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "hospital_name": "Ops Hospital Updated",
            },
        )
        self.assertEqual(update_site_response.status_code, 200, update_site_response.text)
        self.assertEqual(update_site_response.json()["display_name"], "Ops Hospital Updated")
        self.assertEqual(update_site_response.json()["hospital_name"], "Ops Hospital Updated")

        create_user_response = self.client.post(
            "/api/admin/users",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "username": "ops_researcher",
                "full_name": "Ops Researcher",
                "password": "ops123",
                "role": "researcher",
                "site_ids": [site_id],
            },
        )
        self.assertEqual(create_user_response.status_code, 200, create_user_response.text)
        users_response = self.client.get("/api/admin/users", headers={"Authorization": f"Bearer {admin_token}"})
        self.assertEqual(users_response.status_code, 200, users_response.text)
        self.assertTrue(any(item["username"] == "ops_researcher" for item in users_response.json()))

        template_response = self.client.get(
            f"/api/sites/{site_id}/import/template.csv",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        self.assertEqual(template_response.status_code, 200, template_response.text)
        self.assertIn("patient_id", template_response.text)
        self.assertIn("culture_status", template_response.text)

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
            f"/api/sites/{site_id}/import/bulk",
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
                f"/api/sites/{site_id}/validations/run",
                headers={"Authorization": f"Bearer {admin_token}"},
                json={"execution_mode": "cpu"},
            )
            self.assertEqual(validation_response.status_code, 200, validation_response.text)
            validation_job_id = validation_response.json()["job"]["job_id"]
            self._run_site_jobs(workflow=fake_workflow, max_jobs=1, site_id=site_id)

        job_response = self.client.get(
            f"/api/sites/{site_id}/jobs/{validation_job_id}",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        self.assertEqual(job_response.status_code, 200, job_response.text)
        job_payload = job_response.json()
        self.assertEqual(job_payload["status"], "completed", job_response.text)
        validation_id = job_payload["result"]["response"]["summary"]["validation_id"]

        cases_response = self.client.get(
            f"/api/sites/{site_id}/validations/{validation_id}/cases?misclassified_only=true&limit=4",
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
        self.assertTrue(any(item["site_id"] == site_id for item in comparison_response.json()))

    def test_bulk_import_accepts_unknown_culture_status_without_organism_http(self):
        admin_token = self._token_for_username("admin")

        projects_response = self.client.get("/api/admin/projects", headers={"Authorization": f"Bearer {admin_token}"})
        self.assertEqual(projects_response.status_code, 200, projects_response.text)
        project_id = projects_response.json()[0]["project_id"]

        create_site_response = self.client.post(
            "/api/admin/sites",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "project_id": project_id,
                "hospital_name": "Import Unknown Hospital",
                "source_institution_id": "OPS_HTTP_UNKNOWN",
            },
        )
        self.assertEqual(create_site_response.status_code, 200, create_site_response.text)
        site_id = create_site_response.json()["site_id"]

        csv_content = (
            "patient_id,chart_alias,local_case_code,sex,age,visit_date,actual_visit_date,culture_status,culture_category,culture_species,"
            "contact_lens_use,predisposing_factor,visit_status,active_stage,smear_result,polymicrobial,other_history,image_filename,view,is_representative\n"
            "OPS-U-001,OPS-U-001,CASE-U-001,female,51,Initial,2026-03-11,unknown,,,none,trauma,active,TRUE,unknown,FALSE,,ops_u_001_white.jpg,white,TRUE\n"
        ).encode("utf-8")
        archive_buffer = io.BytesIO()
        with zipfile.ZipFile(archive_buffer, "w") as archive:
            archive.writestr("ops_u_001_white.jpg", self._make_test_image_bytes("JPEG", (120, 80, 40)))

        import_response = self.client.post(
            f"/api/sites/{site_id}/import/bulk",
            headers={"Authorization": f"Bearer {admin_token}"},
            files=[
                ("csv_file", ("ops_import_unknown.csv", csv_content, "text/csv")),
                ("files", ("ops_unknown_images.zip", archive_buffer.getvalue(), "application/zip")),
            ],
        )
        self.assertEqual(import_response.status_code, 200, import_response.text)
        import_payload = import_response.json()
        self.assertEqual(import_payload["created_patients"], 1)
        self.assertEqual(import_payload["created_visits"], 1)
        self.assertEqual(import_payload["imported_images"], 1)
        self.assertEqual(import_payload["errors"], [])

        cases_response = self.client.get(
            f"/api/sites/{site_id}/cases",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        self.assertEqual(cases_response.status_code, 200, cases_response.text)
        imported_case = next(
            item
            for item in cases_response.json()
            if item["patient_id"] == "OPS-U-001" and item["visit_date"] == "Initial"
        )
        self.assertEqual(imported_case["culture_status"], "unknown")
        self.assertFalse(bool(imported_case["culture_confirmed"]))
        self.assertEqual(imported_case["culture_category"], "")
        self.assertEqual(imported_case["culture_species"], "")

    def test_bulk_import_skips_invalid_image_bundle_entries_http(self):
        admin_token = self._token_for_username("admin")

        projects_response = self.client.get("/api/admin/projects", headers={"Authorization": f"Bearer {admin_token}"})
        self.assertEqual(projects_response.status_code, 200, projects_response.text)
        project_id = projects_response.json()[0]["project_id"]

        create_site_response = self.client.post(
            "/api/admin/sites",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "project_id": project_id,
                "hospital_name": "Import Invalid Image Hospital",
                "source_institution_id": "OPS_HTTP_INVALID_IMAGE",
            },
        )
        self.assertEqual(create_site_response.status_code, 200, create_site_response.text)
        site_id = create_site_response.json()["site_id"]

        csv_content = (
            "patient_id,chart_alias,local_case_code,sex,age,visit_date,actual_visit_date,culture_status,culture_category,culture_species,"
            "contact_lens_use,predisposing_factor,visit_status,active_stage,smear_result,polymicrobial,other_history,image_filename,view,is_representative\n"
            "OPS-I-001,OPS-I-001,CASE-I-001,female,51,Initial,2026-03-11,unknown,,,none,trauma,active,TRUE,unknown,FALSE,,ops_invalid_white.jpg,white,TRUE\n"
        ).encode("utf-8")
        archive_buffer = io.BytesIO()
        with zipfile.ZipFile(archive_buffer, "w") as archive:
            archive.writestr("ops_invalid_white.jpg", b"not-an-image")

        import_response = self.client.post(
            f"/api/sites/{site_id}/import/bulk",
            headers={"Authorization": f"Bearer {admin_token}"},
            files=[
                ("csv_file", ("ops_import_invalid.csv", csv_content, "text/csv")),
                ("files", ("ops_invalid_images.zip", archive_buffer.getvalue(), "application/zip")),
            ],
        )
        self.assertEqual(import_response.status_code, 200, import_response.text)
        payload = import_response.json()
        self.assertEqual(payload["created_patients"], 0)
        self.assertEqual(payload["created_visits"], 0)
        self.assertEqual(payload["imported_images"], 0)
        self.assertEqual(payload["skipped_images"], 1)
        self.assertTrue(any("Invalid image file" in message for message in payload["errors"]))

    def test_platform_admin_can_update_site_source_institution_mapping_http(self):
        admin_token = self._token_for_username("admin")

        projects_response = self.client.get("/api/admin/projects", headers={"Authorization": f"Bearer {admin_token}"})
        self.assertEqual(projects_response.status_code, 200, projects_response.text)
        project_id = projects_response.json()[0]["project_id"]

        create_site_response = self.client.post(
            "/api/admin/sites",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "project_id": project_id,
                "hospital_name": "Ops Hospital",
                "source_institution_id": "OPS_HTTP_SOURCE",
            },
        )
        self.assertEqual(create_site_response.status_code, 200, create_site_response.text)
        site_id = create_site_response.json()["site_id"]

        update_site_response = self.client.patch(
            f"/api/admin/sites/{site_id}",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "hospital_name": "Ops Hospital",
                "source_institution_id": "39100103",
            },
        )
        self.assertEqual(update_site_response.status_code, 200, update_site_response.text)
        self.assertEqual(update_site_response.json()["source_institution_id"], "39100103")
        self.assertEqual(self.cp.get_site(site_id)["source_institution_id"], "39100103")

        preserve_mapping_response = self.client.patch(
            f"/api/admin/sites/{site_id}",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "hospital_name": "Ops Hospital Updated",
            },
        )
        self.assertEqual(preserve_mapping_response.status_code, 200, preserve_mapping_response.text)
        self.assertEqual(preserve_mapping_response.json()["source_institution_id"], "39100103")
        self.assertEqual(self.cp.get_site(site_id)["source_institution_id"], "39100103")

    def test_site_admin_can_manage_storage_settings_and_empty_site_root(self):
        site_admin_token = self._token_for_username("http_site_admin")
        temp_storage_root = Path(self.tempdir.name) / "instance-storage-root"
        site_storage_root = temp_storage_root / self.site_id

        settings_response = self.client.get(
            "/api/admin/storage-settings",
            headers={"Authorization": f"Bearer {site_admin_token}"},
        )
        self.assertEqual(settings_response.status_code, 200, settings_response.text)
        settings_payload = settings_response.json()
        self.assertEqual(
            settings_payload["default_storage_root"],
            str((ROOT_DIR.parent / "KERA_DATA" / "sites").resolve()),
        )
        self.assertEqual(settings_payload["effective_default_storage_root"], settings_payload["default_storage_root"])
        self.assertEqual(settings_payload["storage_root_source"], "built_in_default")
        self.assertFalse(settings_payload["uses_custom_root"])

        update_settings_response = self.client.patch(
            "/api/admin/storage-settings",
            headers={"Authorization": f"Bearer {site_admin_token}"},
            json={"storage_root": str(temp_storage_root)},
        )
        self.assertEqual(update_settings_response.status_code, 200, update_settings_response.text)
        update_settings_payload = update_settings_response.json()
        self.assertEqual(update_settings_payload["storage_root"], str(temp_storage_root.resolve()))
        self.assertEqual(update_settings_payload["storage_root_source"], "custom")
        self.assertTrue(update_settings_payload["uses_custom_root"])

        site_scoped_settings_response = self.client.get(
            "/api/admin/storage-settings",
            headers={"Authorization": f"Bearer {site_admin_token}"},
            params={"site_id": self.site_id},
        )
        self.assertEqual(site_scoped_settings_response.status_code, 200, site_scoped_settings_response.text)
        site_scoped_settings_payload = site_scoped_settings_response.json()
        self.assertEqual(site_scoped_settings_payload["selected_site_id"], self.site_id)
        self.assertEqual(
            site_scoped_settings_payload["selected_site_storage_root"],
            str((ROOT_DIR.parent / "KERA_DATA" / "sites" / self.site_id).resolve()),
        )

        update_site_root_response = self.client.patch(
            f"/api/admin/sites/{self.site_id}/storage-root",
            headers={"Authorization": f"Bearer {site_admin_token}"},
            json={"storage_root": str(site_storage_root)},
        )
        self.assertEqual(update_site_root_response.status_code, 200, update_site_root_response.text)
        self.assertEqual(update_site_root_response.json()["local_storage_root"], str(site_storage_root.resolve()))

        updated_site_scoped_settings_response = self.client.get(
            "/api/admin/storage-settings",
            headers={"Authorization": f"Bearer {site_admin_token}"},
            params={"site_id": self.site_id},
        )
        self.assertEqual(updated_site_scoped_settings_response.status_code, 200, updated_site_scoped_settings_response.text)
        self.assertEqual(
            updated_site_scoped_settings_response.json()["selected_site_storage_root"],
            str(site_storage_root.resolve()),
        )

        self._seed_case(site_admin_token)
        blocked_response = self.client.patch(
            f"/api/admin/sites/{self.site_id}/storage-root",
            headers={"Authorization": f"Bearer {site_admin_token}"},
            json={"storage_root": str(site_storage_root.parent / 'second-root')},
        )
        self.assertEqual(blocked_response.status_code, 400, blocked_response.text)
        self.assertIn("Storage root can only be changed", blocked_response.json()["detail"])

    def test_site_admin_storage_settings_accept_kera_data_root(self):
        site_admin_token = self._token_for_username("http_site_admin")
        storage_bundle_root = Path(self.tempdir.name) / "KERA_DATA"

        update_settings_response = self.client.patch(
            "/api/admin/storage-settings",
            headers={"Authorization": f"Bearer {site_admin_token}"},
            json={"storage_root": str(storage_bundle_root)},
        )
        self.assertEqual(update_settings_response.status_code, 200, update_settings_response.text)
        update_settings_payload = update_settings_response.json()
        self.assertEqual(update_settings_payload["storage_root"], str((storage_bundle_root / "sites").resolve()))
        self.assertTrue((storage_bundle_root / "sites").exists())

    def test_site_validations_list_http_does_not_require_site_store_initialization(self):
        token = self._token_for_username("http_researcher")

        with patch.object(self.app_module, "SiteStore", side_effect=PermissionError("storage root is inaccessible")):
            response = self.client.get(
                f"/api/sites/{self.site_id}/validations",
                headers={"Authorization": f"Bearer {token}"},
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), [])

    def test_site_validations_list_http_accepts_limit(self):
        token = self._token_for_username("http_researcher")
        for index in range(3):
            summary = {
                "validation_id": f"validation_limit_{index}",
                "project_id": "project_default",
                "site_id": self.site_id,
                "model_version": "global-http-seed",
                "model_version_id": "model_http_seed",
                "model_architecture": "densenet121",
                "run_date": f"2026-03-{20 - index:02d}T00:00:00+00:00",
                "n_patients": 4,
                "n_cases": 4,
                "n_images": 4,
                "AUROC": 0.91 - (index * 0.01),
                "accuracy": 0.9 - (index * 0.01),
                "sensitivity": 0.89 - (index * 0.01),
                "specificity": 0.88 - (index * 0.01),
                "F1": 0.87 - (index * 0.01),
            }
            self.cp.save_validation_run(summary, [])

        response = self.client.get(
            f"/api/sites/{self.site_id}/validations?limit=2",
            headers={"Authorization": f"Bearer {token}"},
        )

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(len(payload), 2)
        self.assertEqual(payload[0]["validation_id"], "validation_limit_0")
        self.assertEqual(payload[1]["validation_id"], "validation_limit_1")

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

    def test_site_admin_can_recover_site_metadata_http(self):
        site_admin_token = self._token_for_username("http_site_admin")
        patient_id = "00324192"
        self.site_store.create_patient(patient_id, "female", 54, created_by_user_id="owner")
        self.site_store.create_visit(
            patient_id=patient_id,
            visit_date="Initial",
            actual_visit_date="2026-03-17",
            culture_confirmed=True,
            culture_category="bacterial",
            culture_species="Bacillus",
            additional_organisms=[],
            contact_lens_use="none",
            predisposing_factor=["trauma"],
            other_history="",
            created_by_user_id="owner",
        )
        image = self.site_store.add_image(
            patient_id=patient_id,
            visit_date="Initial",
            view="white",
            is_representative=True,
            file_name="recover.png",
            content=self._make_test_image_bytes(),
            created_by_user_id="owner",
        )
        self.site_store.update_lesion_prompt_box(
            image["image_id"],
            {"x0": 0.1, "y0": 0.2, "x1": 0.7, "y1": 0.8},
        )
        self.site_store.generate_manifest()
        self.site_store.export_metadata_backup()
        self.site_store._clear_site_metadata_rows()

        response = self.client.post(
            f"/api/admin/sites/{self.site_id}/metadata/recover",
            headers={"Authorization": f"Bearer {site_admin_token}"},
            json={"source": "auto", "force_replace": True},
        )

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["site_id"], self.site_id)
        self.assertEqual(payload["source"], "backup")
        self.assertEqual(payload["restored_patients"], 1)
        self.assertEqual(payload["restored_visits"], 1)
        self.assertEqual(payload["restored_images"], 1)
        self.assertTrue(Path(payload["manifest_path"]).exists())
        self.assertTrue(Path(payload["metadata_backup_path"]).exists())
        self.assertEqual(len(self.site_store.list_patients()), 1)
        self.assertEqual(len(self.site_store.list_visits()), 1)
        recovered_images = self.site_store.list_images()
        self.assertEqual(len(recovered_images), 1)
        self.assertTrue(Path(recovered_images[0]["image_path"]).exists())

    def test_site_admin_recover_metadata_queues_federated_retrieval_auto_sync_http(self):
        site_admin_token = self._token_for_username("http_site_admin")
        patient_id = "00324193"
        self.site_store.create_patient(patient_id, "female", 54, created_by_user_id="owner")
        self.site_store.create_visit(
            patient_id=patient_id,
            visit_date="Initial",
            actual_visit_date="2026-03-17",
            culture_confirmed=True,
            culture_category="bacterial",
            culture_species="Bacillus",
            additional_organisms=[],
            contact_lens_use="none",
            predisposing_factor=["trauma"],
            other_history="",
            created_by_user_id="owner",
        )
        self.site_store.generate_manifest()
        self.site_store.export_metadata_backup()
        self.site_store._clear_site_metadata_rows()

        self.app_module._PENDING_FEDERATED_RETRIEVAL_SYNC_JOBS.clear()
        self.app_module._PENDING_FEDERATED_RETRIEVAL_SYNC_TRIGGERS.clear()
        try:
            fake_schedule = Mock()
            lazy_cp = self.app_module.get_control_plane()
            with patch.dict(os.environ, {"KERA_DISABLE_FEDERATED_RETRIEVAL_AUTO_SYNC": "0"}, clear=False):
                with patch.object(self.app_module, "control_plane_split_enabled", return_value=False):
                    with patch.object(lazy_cp, "remote_node_sync_enabled", return_value=True):
                        with patch.object(self.app_module, "_submit_executor_job_after_delay", fake_schedule):
                            response = self.client.post(
                                f"/api/admin/sites/{self.site_id}/metadata/recover",
                                headers={"Authorization": f"Bearer {site_admin_token}"},
                                json={"source": "auto", "force_replace": True},
                            )

            self.assertEqual(response.status_code, 200, response.text)
            fake_schedule.assert_called_once()
            self.assertIs(fake_schedule.call_args.args[0], self.app_module._FEDERATED_RETRIEVAL_SYNC_EXECUTOR)
            self.assertGreater(float(fake_schedule.call_args.kwargs["delay_seconds"]), 0.0)
        finally:
            self.app_module._PENDING_FEDERATED_RETRIEVAL_SYNC_JOBS.clear()
            self.app_module._PENDING_FEDERATED_RETRIEVAL_SYNC_TRIGGERS.clear()

    def test_site_admin_can_sync_raw_inventory_metadata_http(self):
        site_admin_token = self._token_for_username("http_site_admin")
        visit_dir = self.site_store.raw_dir / "00415029" / "Initial"
        visit_dir.mkdir(parents=True, exist_ok=True)
        image_path = visit_dir / "http_sync_slit.png"
        image_path.write_bytes(self._make_test_image_bytes())

        response = self.client.post(
            f"/api/admin/sites/{self.site_id}/metadata/sync-raw",
            headers={"Authorization": f"Bearer {site_admin_token}"},
        )

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["site_id"], self.site_id)
        self.assertEqual(payload["created_patients"], 1)
        self.assertEqual(payload["created_visits"], 1)
        self.assertEqual(payload["created_images"], 1)
        self.assertTrue(Path(payload["manifest_path"]).exists())
        self.assertTrue(Path(payload["metadata_backup_path"]).exists())

        lookup = self.site_store.lookup_patient_id("00415029")
        self.assertTrue(bool(lookup["exists"]))
        visits = self.site_store.list_visits_for_patient("00415029")
        self.assertEqual(len(visits), 1)
        self.assertFalse(bool(visits[0]["culture_confirmed"]))
        images = self.site_store.list_images_for_visit("00415029", "Initial")
        self.assertEqual(len(images), 1)
        self.assertEqual(Path(images[0]["image_path"]).resolve(), image_path.resolve())
        self.assertEqual(images[0]["view"], "slit")
        self.assertEqual(self.site_store.dataset_records(), [])

    def test_site_admin_sync_raw_inventory_queues_federated_retrieval_auto_sync_http(self):
        site_admin_token = self._token_for_username("http_site_admin")
        visit_dir = self.site_store.raw_dir / "00415030" / "Initial"
        visit_dir.mkdir(parents=True, exist_ok=True)
        (visit_dir / "http_sync_slit.png").write_bytes(self._make_test_image_bytes())

        self.app_module._PENDING_FEDERATED_RETRIEVAL_SYNC_JOBS.clear()
        self.app_module._PENDING_FEDERATED_RETRIEVAL_SYNC_TRIGGERS.clear()
        try:
            fake_executor = Mock()
            fake_schedule = Mock()
            lazy_cp = self.app_module.get_control_plane()
            with patch.dict(os.environ, {"KERA_DISABLE_FEDERATED_RETRIEVAL_AUTO_SYNC": "0"}, clear=False):
                with patch.object(self.app_module, "control_plane_split_enabled", return_value=False):
                    with patch.object(lazy_cp, "remote_node_sync_enabled", return_value=True):
                        with patch.object(self.app_module, "_FEDERATED_RETRIEVAL_SYNC_EXECUTOR", fake_executor):
                            with patch.object(self.app_module, "_submit_executor_job_after_delay", fake_schedule):
                                response = self.client.post(
                                    f"/api/admin/sites/{self.site_id}/metadata/sync-raw",
                                    headers={"Authorization": f"Bearer {site_admin_token}"},
                                )

            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(fake_schedule.call_count, 1)
            self.assertIs(fake_schedule.call_args.args[0], fake_executor)
        finally:
            self.app_module._PENDING_FEDERATED_RETRIEVAL_SYNC_JOBS.clear()
            self.app_module._PENDING_FEDERATED_RETRIEVAL_SYNC_TRIGGERS.clear()

    def test_workspace_lookup_visit_list_and_image_queries_hide_raw_inventory_placeholder_http(self):
        site_admin_token = self._token_for_username("http_site_admin")
        visit_dir = self.site_store.raw_dir / "00415029" / "Initial"
        visit_dir.mkdir(parents=True, exist_ok=True)
        (visit_dir / "http_sync_slit.png").write_bytes(self._make_test_image_bytes())

        sync_response = self.client.post(
            f"/api/admin/sites/{self.site_id}/metadata/sync-raw",
            headers={"Authorization": f"Bearer {site_admin_token}"},
        )

        self.assertEqual(sync_response.status_code, 200, sync_response.text)

        lookup_response = self.client.get(
            f"/api/sites/{self.site_id}/patients/lookup?patient_id=00415029",
            headers={"Authorization": f"Bearer {site_admin_token}"},
        )
        self.assertEqual(lookup_response.status_code, 200, lookup_response.text)
        lookup_payload = lookup_response.json()
        self.assertTrue(lookup_payload["exists"])
        self.assertEqual(lookup_payload["normalized_patient_id"], "00415029")
        self.assertEqual(lookup_payload["visit_count"], 0)
        self.assertEqual(lookup_payload["image_count"], 0)
        self.assertIsNone(lookup_payload["latest_visit_date"])
        self.assertEqual(lookup_payload["patient"]["patient_id"], "00415029")

        patient_visits_response = self.client.get(
            f"/api/sites/{self.site_id}/visits?patient_id=00415029",
            headers={"Authorization": f"Bearer {site_admin_token}"},
        )
        self.assertEqual(patient_visits_response.status_code, 200, patient_visits_response.text)
        self.assertEqual(patient_visits_response.json(), [])

        all_visits_response = self.client.get(
            f"/api/sites/{self.site_id}/visits",
            headers={"Authorization": f"Bearer {site_admin_token}"},
        )
        self.assertEqual(all_visits_response.status_code, 200, all_visits_response.text)
        self.assertEqual(all_visits_response.json(), [])

        patients_response = self.client.get(
            f"/api/sites/{self.site_id}/patients",
            headers={"Authorization": f"Bearer {site_admin_token}"},
        )
        self.assertEqual(patients_response.status_code, 200, patients_response.text)
        self.assertEqual(patients_response.json(), [])

        patient_images_response = self.client.get(
            f"/api/sites/{self.site_id}/images?patient_id=00415029",
            headers={"Authorization": f"Bearer {site_admin_token}"},
        )
        self.assertEqual(patient_images_response.status_code, 200, patient_images_response.text)
        self.assertEqual(patient_images_response.json(), [])

        visit_images_response = self.client.get(
            f"/api/sites/{self.site_id}/images?patient_id=00415029&visit_date=Initial",
            headers={"Authorization": f"Bearer {site_admin_token}"},
        )
        self.assertEqual(visit_images_response.status_code, 200, visit_images_response.text)
        self.assertEqual(visit_images_response.json(), [])

        all_images_response = self.client.get(
            f"/api/sites/{self.site_id}/images",
            headers={"Authorization": f"Bearer {site_admin_token}"},
        )
        self.assertEqual(all_images_response.status_code, 200, all_images_response.text)
        self.assertEqual(all_images_response.json(), [])

    def test_image_text_search_hides_raw_inventory_placeholder_images_http(self):
        token = self._token_for_username("http_researcher")
        visible_image_id = self._seed_case(token, patient_id="HTTP-TEXT-001", visit_date="Initial")
        raw_visit_dir = self.site_store.raw_dir / "RAW-TEXT-001" / "Initial"
        raw_visit_dir.mkdir(parents=True, exist_ok=True)
        (raw_visit_dir / "placeholder_slit.png").write_bytes(self._make_test_image_bytes())

        sync_response = self.client.post(
            f"/api/admin/sites/{self.site_id}/metadata/sync-raw",
            headers={"Authorization": f"Bearer {self._token_for_username('http_site_admin')}"},
        )
        self.assertEqual(sync_response.status_code, 200, sync_response.text)

        class TextSearchStub:
            def retrieve_images(self, *, query_text, image_records, requested_device, top_k=10, persistence_dir=None):
                return {
                    "text_retrieval_mode": "stub",
                    "text_embedding_model": "stub",
                    "eligible_image_count": len(image_records),
                    "results": [
                        {
                            "image_id": str(item.get("image_id") or ""),
                            "patient_id": str(item.get("patient_id") or ""),
                            "visit_date": str(item.get("visit_date") or ""),
                            "view": str(item.get("view") or ""),
                            "image_path": str(item.get("image_path") or ""),
                            "score": 1.0 - (index * 0.01),
                        }
                        for index, item in enumerate(image_records[: max(1, min(int(top_k or 10), 50))])
                    ],
                }

        fake_workflow = FakeWorkflow(self.app_module, self.cp)
        fake_workflow.text_retriever = TextSearchStub()
        with patch.object(self.app_module, "_get_workflow", return_value=fake_workflow):
            response = self.client.post(
                f"/api/sites/{self.site_id}/images/search/text",
                headers={"Authorization": f"Bearer {token}"},
                json={"query": "slit lamp", "top_k": 10},
            )

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["eligible_image_count"], 1)
        self.assertEqual(len(payload["results"]), 1)
        self.assertEqual(payload["results"][0]["image_id"], visible_image_id)
        self.assertEqual(payload["results"][0]["patient_id"], "HTTP-TEXT-001")
        self.assertNotEqual(payload["results"][0]["patient_id"], "RAW-TEXT-001")
        self.assertTrue(str(payload["results"][0]["preview_url"] or "").startswith(f"/api/sites/{self.site_id}/images/"))

    def test_patient_list_keeps_manual_patients_without_visits_http(self):
        token = self._token_for_username("http_researcher")
        create_response = self.client.post(
            f"/api/sites/{self.site_id}/patients",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "patient_id": "HTTP-EMPTY-001",
                "sex": "female",
                "age": 44,
                "chart_alias": "",
                "local_case_code": "",
            },
        )
        self.assertEqual(create_response.status_code, 200, create_response.text)

        patients_response = self.client.get(
            f"/api/sites/{self.site_id}/patients",
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(patients_response.status_code, 200, patients_response.text)
        self.assertIn(
            "HTTP-EMPTY-001",
            [item["patient_id"] for item in patients_response.json()],
        )

    def test_patient_list_route_avoids_loading_all_visits_for_visibility_http(self):
        token = self._token_for_username("http_researcher")
        create_response = self.client.post(
            f"/api/sites/{self.site_id}/patients",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "patient_id": "HTTP-EMPTY-FAST-001",
                "sex": "female",
                "age": 47,
                "chart_alias": "",
                "local_case_code": "",
            },
        )
        self.assertEqual(create_response.status_code, 200, create_response.text)

        with patch.object(
            self.app_module.SiteStore,
            "list_visits",
            side_effect=AssertionError("patients route should use workspace patient query"),
        ):
            patients_response = self.client.get(
                f"/api/sites/{self.site_id}/patients",
                headers={"Authorization": f"Bearer {token}"},
            )

        self.assertEqual(patients_response.status_code, 200, patients_response.text)
        self.assertIn(
            "HTTP-EMPTY-FAST-001",
            [item["patient_id"] for item in patients_response.json()],
        )

    def test_runtime_health_and_metrics_endpoints_http(self):
        live_response = self.client.get("/api/live", headers={"X-Request-ID": "health-live-req"})
        self.assertEqual(live_response.status_code, 200, live_response.text)
        self.assertEqual(live_response.headers.get("X-Request-ID"), "health-live-req")
        live_payload = live_response.json()
        self.assertEqual(live_payload["status"], "alive")
        self.assertEqual(live_payload["service"], "kera-api")
        self.assertEqual(live_payload["version"], "1.0.0")

        health_response = self.client.get("/api/health")
        self.assertEqual(health_response.status_code, 200, health_response.text)
        self.assertTrue(str(health_response.headers.get("X-Request-ID") or "").strip())
        health_payload = health_response.json()
        self.assertTrue(health_payload["ready"])
        self.assertIn(health_payload["status"], {"ok", "ready_with_warnings"})
        self.assertIn("checks", health_payload)
        self.assertTrue(health_payload["checks"]["storage"]["storage_dir"]["ready"])
        self.assertTrue(health_payload["checks"]["data_plane_database"]["ready"])
        self.assertTrue(health_payload["database_connections"]["control_plane"]["ready"])
        self.assertTrue(health_payload["database_connections"]["data_plane"]["ready"])
        self.assertIn("background_jobs", health_payload)
        self.assertIn("request_metrics", health_payload)

        metrics_response = self.client.get("/api/metrics")
        self.assertEqual(metrics_response.status_code, 200, metrics_response.text)
        self.assertTrue(metrics_response.headers["content-type"].startswith("text/plain"))
        metrics_text = metrics_response.text
        self.assertIn("kera_api_requests_total", metrics_text)
        self.assertIn("kera_api_background_queue_items", metrics_text)
        self.assertIn('route="/api/live"', metrics_text)
        self.assertIn('route="/api/health"', metrics_text)

    def test_readiness_endpoint_returns_503_when_required_probe_fails_http(self):
        failed_checks = {
            "checked_at": "2026-04-13T00:00:00+00:00",
            "storage": {
                "storage_dir": {"path": self.tempdir.name, "exists": True, "ready": True, "writable": True, "detail": ""},
                "runtime_dir": {"path": self.tempdir.name, "exists": True, "ready": True, "writable": True, "detail": ""},
            },
            "disk": {
                "path": self.tempdir.name,
                "total_bytes": 100,
                "used_bytes": 10,
                "free_bytes": 90,
                "minimum_free_bytes": 0,
                "ready": True,
                "detail": "",
            },
            "data_plane_database": {
                "path": str(Path(self.tempdir.name) / "kera.db"),
                "exists": False,
                "required": True,
                "ready": False,
                "detail": "simulated failure",
            },
            "control_plane_cache_database": {
                "path": str(Path(self.tempdir.name) / "control_plane_cache.db"),
                "exists": True,
                "required": False,
                "ready": True,
                "detail": "",
            },
            "control_plane": {
                "configured": False,
                "node_sync_enabled": False,
                "base_url": "",
                "node_id": "",
                "bootstrap": None,
                "ready": True,
                "detail": "",
            },
            "model_artifacts": {
                "model_dir": "",
                "model_dir_exists": True,
                "active_manifest_path": "",
                "active_manifest_exists": True,
                "active_manifest": {},
                "active_model_path": "",
                "active_model_exists": True,
                "current_release": {"version_id": "model-1", "ready": True},
                "resolved_model_path": "",
                "ready": True,
                "downloadable": False,
                "detail": "",
            },
        }
        with patch.object(self.app_module, "_desktop_runtime_checks", return_value=failed_checks):
            readiness_response = self.client.get("/api/ready")

        self.assertEqual(readiness_response.status_code, 503, readiness_response.text)
        payload = readiness_response.json()
        self.assertFalse(payload["ready"])
        self.assertEqual(payload["status"], "error")
        self.assertIn("data_plane_database", payload["failing_required_checks"])

    def test_sentry_observability_initializes_when_dsn_is_configured_http(self):
        from fastapi.testclient import TestClient

        os.environ["KERA_SENTRY_DSN"] = "https://public@example.ingest.sentry.io/123"
        os.environ["KERA_SENTRY_ENVIRONMENT"] = "test-suite"
        os.environ["KERA_SENTRY_TRACES_SAMPLE_RATE"] = "0.25"
        try:
            with patch("sentry_sdk.init") as sentry_init:
                client = TestClient(self.app_module.create_app())
                try:
                    response = client.get("/api/health")
                finally:
                    client.close()
        finally:
            os.environ.pop("KERA_SENTRY_DSN", None)
            os.environ.pop("KERA_SENTRY_ENVIRONMENT", None)
            os.environ.pop("KERA_SENTRY_TRACES_SAMPLE_RATE", None)

        self.assertEqual(response.status_code, 200, response.text)
        sentry_init.assert_called_once()
        payload = response.json()
        sentry_status = payload["observability"]["error_aggregation"]
        self.assertTrue(sentry_status["configured"])
        self.assertTrue(sentry_status["enabled"])
        self.assertEqual(sentry_status["provider"], "sentry")
        self.assertEqual(sentry_status["environment"], "test-suite")


if __name__ == "__main__":
    unittest.main()
