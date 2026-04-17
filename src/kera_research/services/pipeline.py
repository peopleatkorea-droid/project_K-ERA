from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Callable

import numpy as np
import pandas as pd
from kera_research.domain import (
    DENSENET_VARIANTS,
    INDEX_TO_LABEL,
    LABEL_TO_INDEX,
    MODEL_OUTPUT_CLASS_COUNT,
    is_attention_mil_architecture,
    make_id,
    utc_now,
)
from kera_research.services.ai_clinic_advisor import AiClinicWorkflowAdvisor
from kera_research.services.artifacts import MedSAMService
from kera_research.services.control_plane import ControlPlaneStore
from kera_research.services.data_plane import SiteStore
from kera_research.services.differential import AiClinicDifferentialRanker
from kera_research.services.modeling import ModelManager, preprocess_image, torch
from kera_research.services.pipeline_ai_clinic_workflow import ResearchAiClinicWorkflow
from kera_research.services.pipeline_case_support import ResearchCaseSupport
from kera_research.services.pipeline_domains import (
    ResearchContributionWorkflow,
    ResearchTrainingWorkflow,
    ResearchValidationWorkflow,
)
from kera_research.services.pipeline_embedding_workflow import ResearchEmbeddingWorkflow
from kera_research.services.pipeline_federated_retrieval_workflow import ResearchFederatedRetrievalWorkflow
from kera_research.services.pipeline_postmortem_workflow import ResearchPostmortemWorkflow
from kera_research.services.federated_update_security import (
    apply_federated_update_signature,
    build_federated_dp_accounting_entry,
    federated_delta_privacy_controls,
    summarize_federated_data_distribution,
)
from kera_research.services.preferred_operating_models import preferred_operating_model_versions
from kera_research.services.pipeline_review_support import ResearchReviewSupport
from kera_research.services.prediction_postmortem_analyzer import PredictionPostmortemAnalyzer
from kera_research.services.prediction_postmortem_advisor import PredictionPostmortemAdvisor
from kera_research.services.quality import score_slit_lamp_image
from kera_research.services.retrieval import BiomedClipTextRetriever, Dinov2ImageRetriever
from kera_research.services.vector_index import FaissCaseIndexManager
from kera_research.storage import ensure_dir, read_json, write_json
from kera_research.config import DEFAULT_GLOBAL_MODELS


class ResearchWorkflowService:
    def __init__(self, control_plane: ControlPlaneStore) -> None:
        self.control_plane = control_plane
        self.model_manager = ModelManager()
        self.medsam_service = MedSAMService()
        self.text_retriever = BiomedClipTextRetriever()
        self.dinov2_retriever = Dinov2ImageRetriever()
        self.vector_index = FaissCaseIndexManager()
        self.ai_clinic_advisor = AiClinicWorkflowAdvisor()
        self.prediction_postmortem_analyzer = PredictionPostmortemAnalyzer(self)
        self.prediction_postmortem_advisor = PredictionPostmortemAdvisor()
        self.differential_ranker = AiClinicDifferentialRanker()
        self.validation_workflow = ResearchValidationWorkflow(self)
        self.contribution_workflow = ResearchContributionWorkflow(self)
        self.training_workflow = ResearchTrainingWorkflow(self)
        self.embedding_workflow = ResearchEmbeddingWorkflow(self)
        self.federated_retrieval_workflow = ResearchFederatedRetrievalWorkflow(self)
        self.ai_clinic_workflow = ResearchAiClinicWorkflow(self)
        self.postmortem_workflow = ResearchPostmortemWorkflow(self)
        self.case_support = ResearchCaseSupport(self)
        self.review_support = ResearchReviewSupport(self)
        self._crop_metadata_dir = self.case_support._crop_metadata_dir
        self._lesion_prompt_box_signature = self.case_support._lesion_prompt_box_signature
        self._load_cached_crop = self.case_support._load_cached_crop
        self._save_crop_metadata = self.case_support._save_crop_metadata
        self._ensure_roi_crop = self.case_support._ensure_roi_crop
        self._pixel_prompt_box = self.case_support._pixel_prompt_box
        self._ensure_lesion_crop = self.case_support._ensure_lesion_crop
        self._load_stored_lesion_crop = self.case_support._load_stored_lesion_crop
        self._prepare_records_for_model = self.case_support._prepare_records_for_model
        self._select_representative_record = self.case_support._select_representative_record
        self._normalize_metadata_text = self.case_support._normalize_metadata_text
        self._normalize_predisposing_factors = self.case_support._normalize_predisposing_factors
        self._representative_quality_scores = self.case_support._representative_quality_scores
        self._case_metadata_snapshot = self.case_support._case_metadata_snapshot
        self._metadata_alignment = self.case_support._metadata_alignment
        self._metadata_reranking_adjustment = self.case_support._metadata_reranking_adjustment
        self._compute_image_qa_metrics = self.review_support._compute_image_qa_metrics
        self._write_review_thumbnail = self.review_support._write_review_thumbnail
        self._build_embedded_review_artifact = self.review_support._build_embedded_review_artifact
        self._build_approval_report = self.review_support._build_approval_report
        self._compute_delta_quality_summary = self.review_support._compute_delta_quality_summary
        self._build_update_quality_summary = self.review_support._build_update_quality_summary

        for baseline in self.model_manager.ensure_baseline_models():
            self.control_plane.ensure_model_version(baseline)
        fallback_version_ids = {
            str(item.get("version_id") or "").strip()
            for item in DEFAULT_GLOBAL_MODELS
            if str(item.get("version_id") or "").strip()
        }
        existing_versions = [
            item
            for item in self.control_plane.list_model_versions()
            if item.get("stage") == "global" and item.get("ready", True)
        ]
        current_version = next((item for item in existing_versions if item.get("is_current")), None)
        current_version_id = str(current_version.get("version_id") or "").strip() if isinstance(current_version, dict) else ""
        preserve_existing_current = bool(current_version_id) and current_version_id not in fallback_version_ids
        for preferred_model in preferred_operating_model_versions():
            seeded_model = dict(preferred_model)
            if (
                preserve_existing_current
                and seeded_model.get("is_current")
                and str(seeded_model.get("version_id") or "").strip() != current_version_id
            ):
                seeded_model["is_current"] = False
            self.control_plane.ensure_model_version(seeded_model)

    def _normalize_crop_mode(self, crop_mode: str | None) -> str:
        normalized = str(crop_mode or "automated").strip().lower()
        if normalized in {"automated", "manual", "both", "paired", "raw"}:
            return normalized
        return "automated"

    def _resolve_model_crop_mode(self, model_version: dict[str, Any]) -> str:
        if model_version.get("ensemble_mode") == "weighted_average":
            crop_mode = str(model_version.get("crop_mode") or "").strip().lower()
            if crop_mode:
                return self._normalize_crop_mode(crop_mode)
            return "both"
        crop_mode = str(model_version.get("crop_mode") or "").strip().lower()
        if crop_mode:
            return self._normalize_crop_mode(crop_mode)
        if self.model_manager.is_dual_input_architecture(str(model_version.get("architecture") or "")):
            return "paired"
        return "automated" if model_version.get("requires_medsam_crop", False) else "raw"

    def _resolve_model_case_aggregation(self, model_version: dict[str, Any]) -> str:
        if model_version.get("ensemble_mode") == "weighted_average":
            return "weighted_average"
        return self.model_manager.normalize_case_aggregation(
            str(model_version.get("case_aggregation") or ""),
            str(model_version.get("architecture") or ""),
        )

    def _is_dual_input_model_version(self, model_version: dict[str, Any]) -> bool:
        return self.model_manager.is_dual_input_architecture(str(model_version.get("architecture") or ""))

    def _quality_weight_for_record(
        self,
        record: dict[str, Any],
        quality_cache: dict[str, float] | None = None,
    ) -> float:
        image_path = str(record.get("image_path") or "").strip()
        if not image_path:
            return 1.0
        if quality_cache is not None and image_path in quality_cache:
            return quality_cache[image_path]
        try:
            quality_summary = score_slit_lamp_image(image_path, view=record.get("view"))
            weight = max(float(quality_summary.get("quality_score") or 0.0) / 100.0, 0.05)
        except Exception:
            weight = 1.0
        if quality_cache is not None:
            quality_cache[image_path] = weight
        return weight

    def _aggregate_image_predictions(
        self,
        prepared_records: list[dict[str, Any]],
        image_predictions: list[Any],
        case_aggregation: str,
    ) -> dict[str, Any]:
        if not image_predictions:
            raise ValueError("No image-level predictions are available for case aggregation.")
        normalized_aggregation = self.model_manager.normalize_case_aggregation(case_aggregation)
        if normalized_aggregation == "logit_mean":
            mean_logits = np.mean(
                np.asarray([prediction.logits for prediction in image_predictions], dtype=np.float32),
                axis=0,
            )
            shifted_logits = mean_logits - float(np.max(mean_logits))
            probabilities = np.exp(shifted_logits)
            denominator = float(np.sum(probabilities)) or 1.0
            return {
                "predicted_probability": float(probabilities[1] / denominator),
                "quality_weights": None,
            }
        if normalized_aggregation == "quality_weighted_mean":
            quality_cache: dict[str, float] = {}
            weights = [self._quality_weight_for_record(record, quality_cache) for record in prepared_records]
            total_weight = float(sum(weights))
            if total_weight > 0:
                probability = sum(weight * float(prediction.probability) for weight, prediction in zip(weights, image_predictions)) / total_weight
                return {
                    "predicted_probability": float(probability),
                    "quality_weights": [round(float(weight), 4) for weight in weights],
                }
        return {
            "predicted_probability": float(sum(float(prediction.probability) for prediction in image_predictions) / len(image_predictions)),
            "quality_weights": None,
        }

    def _prepare_bag_inputs(
        self,
        model: Any,
        model_version: dict[str, Any],
        prepared_records: list[dict[str, Any]],
        execution_device: str,
    ) -> tuple[Any, Any]:
        if torch is None:
            raise RuntimeError("PyTorch is required for visit-level MIL inference.")
        preprocess_metadata = self.model_manager.model_preprocess_metadata(model, model_version)
        tensors = []
        for record in prepared_records:
            _, tensor = preprocess_image(record["image_path"], preprocess_metadata=preprocess_metadata)
            tensors.append(tensor.squeeze(0))
        bag_inputs = torch.stack(tensors, dim=0).unsqueeze(0).to(execution_device)
        bag_mask = torch.ones((1, len(prepared_records)), dtype=torch.bool, device=execution_device)
        return bag_inputs, bag_mask

    def _predict_case_with_attention_mil(
        self,
        model: Any,
        model_version: dict[str, Any],
        prepared_records: list[dict[str, Any]],
        execution_device: str,
    ) -> dict[str, Any]:
        if torch is None:
            raise RuntimeError("PyTorch is required for attention MIL inference.")
        bag_inputs, bag_mask = self._prepare_bag_inputs(model, model_version, prepared_records, execution_device)
        model.eval()
        with torch.no_grad():
            logits, attention = model(bag_inputs, bag_mask=bag_mask, return_attention=True)
            probabilities = torch.softmax(logits, dim=1)[0]
        attention_values = [float(value) for value in attention[0, : len(prepared_records)].tolist()]
        representative_index = int(np.argmax(attention_values)) if attention_values else 0
        return {
            "predicted_probability": float(probabilities[1].item()),
            "predicted_logits": [float(value) for value in logits[0].tolist()],
            "attention_scores": [
                {
                    "image_path": str(record["image_path"]),
                    "source_image_path": str(record.get("source_image_path") or record["image_path"]),
                    "view": record.get("view"),
                    "attention": round(float(score), 6),
                }
                for record, score in zip(prepared_records, attention_values)
            ],
            "representative_index": representative_index,
        }

    def _dataset_version_metadata(self, manifest_df: pd.DataFrame) -> dict[str, Any]:
        if manifest_df.empty:
            return {
                "manifest_hash": None,
                "n_rows": 0,
                "n_patients": 0,
                "n_cases": 0,
            }
        ordered = manifest_df.sort_values(["patient_id", "visit_date", "image_path"]).fillna("").to_dict("records")
        payload = json.dumps(ordered, sort_keys=True, ensure_ascii=True, separators=(",", ":"))
        return {
            "manifest_hash": hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16],
            "n_rows": int(len(manifest_df)),
            "n_patients": int(manifest_df["patient_id"].nunique()),
            "n_cases": int(manifest_df[["patient_id", "visit_date"]].drop_duplicates().shape[0]),
        }

    def _save_experiment_report(
        self,
        site_store: SiteStore,
        *,
        experiment_id: str,
        payload: dict[str, Any],
    ) -> str:
        report_dir = ensure_dir(site_store.validation_dir / "experiments")
        report_path = report_dir / f"{experiment_id}.json"
        write_json(report_path, payload)
        return str(report_path)

    def _register_experiment(
        self,
        site_store: SiteStore,
        *,
        experiment_type: str,
        status: str,
        created_at: str,
        execution_device: str,
        manifest_df: pd.DataFrame,
        parameters: dict[str, Any],
        metrics: dict[str, Any],
        report_payload: dict[str, Any],
        model_version: dict[str, Any] | None = None,
        patient_split: dict[str, Any] | None = None,
        extra: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        experiment_id = make_id("exp")
        report_record = {
            "experiment_id": experiment_id,
            "experiment_type": experiment_type,
            "status": status,
            "site_id": site_store.site_id,
            "created_at": created_at,
            "execution_device": execution_device,
            "dataset_version": self._dataset_version_metadata(manifest_df),
            "parameters": parameters,
            "metrics": metrics,
            "patient_split": patient_split,
            "model_version": {
                "version_id": model_version.get("version_id"),
                "version_name": model_version.get("version_name"),
                "architecture": model_version.get("architecture"),
            }
            if model_version
            else None,
            "report": report_payload,
        }
        if extra:
            report_record.update(extra)
        report_path = self._save_experiment_report(site_store, experiment_id=experiment_id, payload=report_record)
        return self.control_plane.save_experiment(
            {
                "experiment_id": experiment_id,
                "site_id": site_store.site_id,
                "experiment_type": experiment_type,
                "status": status,
                "model_version_id": model_version.get("version_id") if model_version else None,
                "created_at": created_at,
                "execution_device": execution_device,
                "dataset_version": report_record["dataset_version"],
                "parameters": parameters,
                "metrics": metrics,
                "patient_split": patient_split,
                "report_path": report_path,
                **(extra or {}),
            }
        )

    def _group_case_records(self, records: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
        grouped: dict[tuple[str, str], list[dict[str, Any]]] = {}
        for record in records:
            grouped.setdefault((str(record["patient_id"]), str(record["visit_date"])), []).append(record)
        return list(grouped.values())

    def _resolve_model_threshold(self, model_version: dict[str, Any]) -> float:
        raw_threshold = model_version.get("decision_threshold")
        try:
            threshold = float(raw_threshold)
        except (TypeError, ValueError):
            threshold = 0.5
        return min(max(threshold, 0.0), 1.0)

    def _predict_case_probability_with_loaded_model(
        self,
        site_store: SiteStore,
        case_records: list[dict[str, Any]],
        model_version: dict[str, Any],
        model: Any,
        execution_device: str,
    ) -> dict[str, Any]:
        crop_mode = self._resolve_model_crop_mode(model_version)
        prepared_records = self._prepare_records_for_model(site_store, case_records, crop_mode=crop_mode)
        case_aggregation = self._resolve_model_case_aggregation(model_version)
        if case_aggregation == "attention_mil":
            aggregated_prediction = self._predict_case_with_attention_mil(
                model,
                model_version,
                prepared_records,
                execution_device,
            )
        else:
            if self._is_dual_input_model_version(model_version):
                image_predictions = [
                    self.model_manager.predict_paired_image(
                        model,
                        model_version,
                        str(record.get("cornea_image_path") or record["image_path"]),
                        str(record.get("lesion_image_path") or record.get("lesion_crop_path") or ""),
                        str(record.get("lesion_mask_path") or ""),
                        execution_device,
                    )
                    for record in prepared_records
                ]
            else:
                image_predictions = [
                    self.model_manager.predict_image(model, record["image_path"], execution_device)
                    for record in prepared_records
                ]
            aggregated_prediction = self._aggregate_image_predictions(
                prepared_records,
                image_predictions,
                case_aggregation,
        )
        predicted_probability = float(aggregated_prediction["predicted_probability"])
        culture_category = str(case_records[0].get("culture_category") or "unknown").strip().lower()
        true_index = LABEL_TO_INDEX.get(culture_category, -1)
        decision_threshold = self._resolve_model_threshold(model_version)
        return {
            "patient_id": str(case_records[0]["patient_id"]),
            "visit_date": str(case_records[0]["visit_date"]),
            "true_index": true_index,
            "predicted_probability": predicted_probability,
            "predicted_index": 1 if predicted_probability >= decision_threshold else 0,
            "decision_threshold": decision_threshold,
            "crop_mode": crop_mode,
            "case_aggregation": case_aggregation,
            "n_model_inputs": len(prepared_records),
        }

    def _collect_case_probabilities(
        self,
        site_store: SiteStore,
        records: list[dict[str, Any]],
        model_version: dict[str, Any],
        execution_device: str,
    ) -> dict[tuple[str, str], dict[str, Any]]:
        if not records:
            return {}
        model = self.model_manager.load_model(model_version, execution_device)
        predictions: dict[tuple[str, str], dict[str, Any]] = {}
        for case_records in self._group_case_records(records):
            case_prediction = self._predict_case_probability_with_loaded_model(
                site_store,
                case_records,
                model_version,
                model,
                execution_device,
            )
            predictions[(case_prediction["patient_id"], case_prediction["visit_date"])] = case_prediction
        return predictions

    def _optimize_ensemble_weights(
        self,
        site_store: SiteStore,
        records: list[dict[str, Any]],
        automated_model_version: dict[str, Any],
        manual_model_version: dict[str, Any],
        execution_device: str,
    ) -> dict[str, Any]:
        automated_predictions = self._collect_case_probabilities(
            site_store,
            records,
            automated_model_version,
            execution_device,
        )
        manual_predictions = self._collect_case_probabilities(
            site_store,
            records,
            manual_model_version,
            execution_device,
        )
        common_case_keys = [
            key
            for key in automated_predictions.keys()
            if key in manual_predictions
        ]
        if not common_case_keys:
            return {
                "ensemble_weights": {"automated": 0.5, "manual": 0.5},
                "selection_metric": "default_no_overlap",
                "selection_metrics": None,
                "decision_threshold": 0.5,
                "threshold_selection_metric": "default_no_overlap",
                "threshold_selection_metrics": None,
                "n_validation_cases": 0,
            }

        best_result: dict[str, Any] | None = None
        for index in range(21):
            automated_weight = round(index * 0.05, 2)
            manual_weight = round(1.0 - automated_weight, 2)
            true_labels: list[int] = []
            positive_probabilities: list[float] = []
            for case_key in common_case_keys:
                automated_probability = float(automated_predictions[case_key]["predicted_probability"])
                manual_probability = float(manual_predictions[case_key]["predicted_probability"])
                blended_probability = float((automated_weight * automated_probability) + (manual_weight * manual_probability))
                true_index = int(automated_predictions[case_key]["true_index"])
                true_labels.append(true_index)
                positive_probabilities.append(blended_probability)
            threshold_selection = self.model_manager.select_decision_threshold(true_labels, positive_probabilities)
            decision_threshold = float(threshold_selection["decision_threshold"])
            predicted_labels = self.model_manager._predicted_labels_from_threshold(
                positive_probabilities,
                threshold=decision_threshold,
            )
            metrics = self.model_manager.classification_metrics(
                true_labels,
                predicted_labels,
                positive_probabilities,
                threshold=decision_threshold,
            )
            score_tuple = (
                float(metrics.get("balanced_accuracy") or 0.0),
                float(metrics.get("F1") or 0.0),
                float(metrics.get("accuracy") or 0.0),
                float(metrics["AUROC"]) if metrics.get("AUROC") is not None else -1.0,
                -abs(automated_weight - 0.5),
            )
            candidate = {
                "ensemble_weights": {
                    "automated": automated_weight,
                    "manual": manual_weight,
                },
                "selection_metric": "balanced_accuracy",
                "selection_metrics": metrics,
                "decision_threshold": decision_threshold,
                "threshold_selection_metric": threshold_selection["selection_metric"],
                "threshold_selection_metrics": threshold_selection["selection_metrics"],
                "n_validation_cases": len(common_case_keys),
                "score_tuple": score_tuple,
            }
            if best_result is None or candidate["score_tuple"] > best_result["score_tuple"]:
                best_result = candidate

        assert best_result is not None
        best_result.pop("score_tuple", None)
        return best_result

    def _resolve_ensemble_components(self, model_version: dict[str, Any]) -> tuple[list[dict[str, Any]], list[float]]:
        component_ids = list(model_version.get("component_model_version_ids") or [])
        if len(component_ids) < 2:
            raise ValueError("Ensemble model is missing component model versions.")
        versions_by_id = {item["version_id"]: item for item in self.control_plane.list_model_versions()}
        components: list[dict[str, Any]] = []
        for version_id in component_ids:
            component = versions_by_id.get(version_id)
            if component is None:
                raise ValueError(f"Unknown ensemble component model: {version_id}")
            components.append(component)
        weight_map = model_version.get("ensemble_weights") or {}
        if isinstance(weight_map, dict):
            raw_weights = []
            default_weight = 1.0 / max(len(components), 1)
            for component in components:
                component_id = str(component.get("version_id") or "")
                component_version_name = str(component.get("version_name") or "")
                component_architecture = str(component.get("architecture") or "")
                component_crop_mode = str(component.get("crop_mode") or self._resolve_model_crop_mode(component) or "")
                raw_weight = (
                    weight_map.get(component_id)
                    if component_id in weight_map
                    else weight_map.get(component_version_name)
                    if component_version_name in weight_map
                    else weight_map.get(component_architecture)
                    if component_architecture in weight_map
                    else weight_map.get(component_crop_mode)
                    if component_crop_mode in weight_map
                    else default_weight
                )
                raw_weights.append(float(raw_weight))
        else:
            raw_weights = [1.0 / max(len(components), 1) for _ in components]
        total = sum(raw_weights) or float(len(raw_weights))
        normalized = [weight / total for weight in raw_weights]
        return components, normalized

    def _normalize_embedding(self, embedding: np.ndarray) -> np.ndarray:
        vector = np.asarray(embedding, dtype=np.float32).reshape(-1)
        norm = float(np.linalg.norm(vector))
        if not np.isfinite(norm) or norm <= 1e-12:
            raise ValueError("Embedding norm is zero.")
        return vector / norm

    def _case_embedding_cache_paths(
        self,
        site_store: SiteStore,
        *,
        patient_id: str,
        visit_date: str,
        model_version: dict[str, Any],
        backend: str = "classifier",
    ) -> tuple[Path, Path]:
        version_id = str(model_version.get("version_id") or "unknown")
        case_key = f"{patient_id}::{visit_date}"
        case_token = hashlib.sha1(case_key.encode("utf-8")).hexdigest()[:16]
        backend_key = str(backend or "classifier").strip().lower().replace(" ", "_")
        model_dir = ensure_dir(site_store.embedding_dir / version_id / backend_key)
        return model_dir / f"{case_token}.npy", model_dir / f"{case_token}.json"

    def _case_embedding_signature(
        self,
        case_records: list[dict[str, Any]],
        model_version: dict[str, Any],
        backend: str = "classifier",
    ) -> str:
        normalized_records = []
        for record in sorted(
            case_records,
            key=lambda item: (
                str(item.get("image_path") or ""),
                str(item.get("view") or ""),
            ),
        ):
            normalized_records.append(
                {
                    "image_path": str(record.get("image_path") or ""),
                    "view": str(record.get("view") or ""),
                    "is_representative": bool(record.get("is_representative")),
                    "lesion_prompt_signature": self._lesion_prompt_box_signature(record.get("lesion_prompt_box")),
                }
            )
        payload = {
            "model_version_id": str(model_version.get("version_id") or ""),
            "backend": str(backend or "classifier").strip().lower(),
            "crop_mode": self._resolve_model_crop_mode(model_version),
            "ensemble_mode": str(model_version.get("ensemble_mode") or ""),
            "component_model_version_ids": [str(item) for item in model_version.get("component_model_version_ids", [])],
            "records": normalized_records,
        }
        return hashlib.sha1(
            json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()

    def _load_cached_case_embedding(
        self,
        site_store: SiteStore,
        *,
        patient_id: str,
        visit_date: str,
        model_version: dict[str, Any],
        signature: str,
        backend: str = "classifier",
    ) -> np.ndarray | None:
        vector_path, metadata_path = self._case_embedding_cache_paths(
            site_store,
            patient_id=patient_id,
            visit_date=visit_date,
            model_version=model_version,
            backend=backend,
        )
        if not (vector_path.exists() and metadata_path.exists()):
            return None
        metadata = read_json(metadata_path, {})
        if str(metadata.get("signature") or "") != signature:
            return None
        try:
            cached = np.load(vector_path)
        except OSError:
            return None
        return self._normalize_embedding(cached)

    def _save_case_embedding_cache(
        self,
        site_store: SiteStore,
        *,
        patient_id: str,
        visit_date: str,
        model_version: dict[str, Any],
        embedding: np.ndarray,
        signature: str,
        backend: str = "classifier",
    ) -> None:
        vector_path, metadata_path = self._case_embedding_cache_paths(
            site_store,
            patient_id=patient_id,
            visit_date=visit_date,
            model_version=model_version,
            backend=backend,
        )
        np.save(vector_path, np.asarray(embedding, dtype=np.float32))
        write_json(
            metadata_path,
            {
                "patient_id": patient_id,
                "visit_date": visit_date,
                "model_version_id": model_version.get("version_id"),
                "model_version_name": model_version.get("version_name"),
                "backend": backend,
                "crop_mode": self._resolve_model_crop_mode(model_version),
                "signature": signature,
                "embedding_dim": int(np.asarray(embedding).size),
                "cached_at": utc_now(),
            },
        )

    def _load_cached_case_embedding_vector(
        self,
        site_store: SiteStore,
        *,
        patient_id: str,
        visit_date: str,
        model_version: dict[str, Any],
        backend: str,
    ) -> np.ndarray | None:
        vector_path, _metadata_path = self._case_embedding_cache_paths(
            site_store,
            patient_id=patient_id,
            visit_date=visit_date,
            model_version=model_version,
            backend=backend,
        )
        if not vector_path.exists():
            return None
        try:
            vector = np.load(vector_path)
        except OSError:
            return None
        return self._normalize_embedding(vector)

    def rebuild_case_vector_index(
        self,
        site_store: SiteStore,
        *,
        model_version: dict[str, Any],
        backend: str,
    ) -> dict[str, Any]:
        return self.embedding_workflow.rebuild_case_vector_index(
            site_store,
            model_version=model_version,
            backend=backend,
        )

    def case_vector_index_exists(
        self,
        site_store: SiteStore,
        *,
        model_version: dict[str, Any],
        backend: str,
    ) -> bool:
        return self.embedding_workflow.case_vector_index_exists(
            site_store,
            model_version=model_version,
            backend=backend,
        )

    def list_cases_requiring_embedding(
        self,
        site_store: SiteStore,
        *,
        model_version: dict[str, Any],
        backend: str = "classifier",
    ) -> list[dict[str, Any]]:
        return self.embedding_workflow.list_cases_requiring_embedding(
            site_store,
            model_version=model_version,
            backend=backend,
        )

    def _prepare_case_embedding_with_loaded_model(
        self,
        site_store: SiteStore,
        case_records: list[dict[str, Any]],
        model_version: dict[str, Any],
        model: Any,
        execution_device: str,
    ) -> np.ndarray:
        crop_mode = self._resolve_model_crop_mode(model_version)
        prepared_records = self._prepare_records_for_model(site_store, case_records, crop_mode=crop_mode)
        if not prepared_records:
            raise ValueError("No prepared records are available for AI Clinic retrieval.")
        if is_attention_mil_architecture(str(model_version.get("architecture") or "")) and hasattr(model, "forward_features"):
            if torch is None:
                raise RuntimeError("PyTorch is required for DINOv2 MIL embeddings.")
            bag_inputs, bag_mask = self._prepare_bag_inputs(model, model_version, prepared_records, execution_device)
            model.eval()
            with torch.no_grad():
                pooled_features, _attention = model.forward_features(bag_inputs, bag_mask=bag_mask)
            return self._normalize_embedding(pooled_features[0].detach().cpu().numpy().astype(np.float32))
        if self._is_dual_input_model_version(model_version):
            embeddings = [
                self.model_manager.extract_paired_image_embedding(
                    model,
                    model_version,
                    str(record.get("cornea_image_path") or record["image_path"]),
                    str(record.get("lesion_image_path") or record.get("lesion_crop_path") or ""),
                    str(record.get("lesion_mask_path") or ""),
                    execution_device,
                )
                for record in prepared_records
            ]
        else:
            embeddings = [
                self.model_manager.extract_image_embedding(model, model_version, record["image_path"], execution_device)
                for record in prepared_records
            ]
        return self._normalize_embedding(np.mean(np.stack(embeddings, axis=0), axis=0))

    def _prepared_case_image_paths(
        self,
        site_store: SiteStore,
        case_records: list[dict[str, Any]],
        model_version: dict[str, Any],
    ) -> list[str]:
        crop_mode = self._resolve_model_crop_mode(model_version)
        prepared_paths: list[str] = []
        if crop_mode != "both":
            prepared_records = self._prepare_records_for_model(site_store, case_records, crop_mode=crop_mode)
            if crop_mode == "paired":
                for record in prepared_records:
                    for image_key in ("cornea_image_path", "lesion_image_path"):
                        next_path = str(record.get(image_key) or "")
                        if next_path and next_path not in prepared_paths:
                            prepared_paths.append(next_path)
                return prepared_paths
            return [str(record["image_path"]) for record in prepared_records]

        components, _weights = self._resolve_ensemble_components(model_version)
        for component in components:
            component_crop_mode = self._resolve_model_crop_mode(component)
            prepared_records = self._prepare_records_for_model(site_store, case_records, crop_mode=component_crop_mode)
            for record in prepared_records:
                next_path = str(record["image_path"])
                if next_path not in prepared_paths:
                    prepared_paths.append(next_path)
        return prepared_paths

    def _prepare_case_dinov2_embedding(
        self,
        site_store: SiteStore,
        case_records: list[dict[str, Any]],
        model_version: dict[str, Any],
        execution_device: str,
        *,
        force_refresh: bool = False,
    ) -> np.ndarray:
        patient_id = str(case_records[0].get("patient_id") or "")
        visit_date = str(case_records[0].get("visit_date") or "")
        signature = self._case_embedding_signature(case_records, model_version, backend="dinov2")
        if not force_refresh:
            cached = self._load_cached_case_embedding(
                site_store,
                patient_id=patient_id,
                visit_date=visit_date,
                model_version=model_version,
                signature=signature,
                backend="dinov2",
            )
            if cached is not None:
                return cached

        prepared_paths = self._prepared_case_image_paths(site_store, case_records, model_version)
        if not prepared_paths:
            raise ValueError("No prepared records are available for DINOv2 retrieval.")
        embeddings = self.dinov2_retriever.encode_images(prepared_paths, execution_device)
        embedding = self._normalize_embedding(np.mean(embeddings, axis=0))
        self._save_case_embedding_cache(
            site_store,
            patient_id=patient_id,
            visit_date=visit_date,
            model_version=model_version,
            embedding=embedding,
            signature=signature,
            backend="dinov2",
        )
        return embedding

    def _prepare_case_embedding(
        self,
        site_store: SiteStore,
        case_records: list[dict[str, Any]],
        model_version: dict[str, Any],
        execution_device: str,
        *,
        loaded_models: dict[str, Any] | None = None,
        force_refresh: bool = False,
    ) -> np.ndarray:
        patient_id = str(case_records[0].get("patient_id") or "")
        visit_date = str(case_records[0].get("visit_date") or "")
        signature = self._case_embedding_signature(case_records, model_version, backend="classifier")
        if not force_refresh:
            cached = self._load_cached_case_embedding(
                site_store,
                patient_id=patient_id,
                visit_date=visit_date,
                model_version=model_version,
                signature=signature,
                backend="classifier",
            )
            if cached is not None:
                return cached

        if model_version.get("ensemble_mode") != "weighted_average":
            model_id = str(model_version.get("version_id") or "")
            model = loaded_models.get(model_id) if loaded_models else None
            if model is None:
                model = self.model_manager.load_model(model_version, execution_device)
                if loaded_models is not None and model_id:
                    loaded_models[model_id] = model
            embedding = self._prepare_case_embedding_with_loaded_model(
                site_store,
                case_records,
                model_version,
                model,
                execution_device,
            )
            self._save_case_embedding_cache(
                site_store,
                patient_id=patient_id,
                visit_date=visit_date,
                model_version=model_version,
                embedding=embedding,
                signature=signature,
                backend="classifier",
            )
            return embedding

        components, weights = self._resolve_ensemble_components(model_version)
        component_vectors: list[np.ndarray] = []
        component_weights: list[float] = []
        for component, weight in zip(components, weights):
            component_id = str(component.get("version_id") or "")
            model = loaded_models.get(component_id) if loaded_models else None
            if model is None:
                model = self.model_manager.load_model(component, execution_device)
                if loaded_models is not None and component_id:
                    loaded_models[component_id] = model
            try:
                component_vector = self._prepare_case_embedding_with_loaded_model(
                    site_store,
                    case_records,
                    component,
                    model,
                    execution_device,
                )
            except ValueError:
                continue
            component_vectors.append(component_vector)
            component_weights.append(float(weight))

        if not component_vectors:
            raise ValueError("No ensemble component embeddings were available for AI Clinic retrieval.")

        normalized_weights = np.asarray(component_weights, dtype=np.float32)
        normalized_weights = normalized_weights / float(normalized_weights.sum() or len(component_vectors))
        fused = np.zeros_like(component_vectors[0], dtype=np.float32)
        for weight, vector in zip(normalized_weights, component_vectors):
            fused += float(weight) * vector
        embedding = self._normalize_embedding(fused)
        self._save_case_embedding_cache(
            site_store,
            patient_id=patient_id,
            visit_date=visit_date,
            model_version=model_version,
            embedding=embedding,
            signature=signature,
            backend="classifier",
        )
        return embedding

    def index_case_embedding(
        self,
        site_store: SiteStore,
        *,
        patient_id: str,
        visit_date: str,
        model_version: dict[str, Any],
        execution_device: str,
        force_refresh: bool = False,
        update_index: bool = True,
    ) -> dict[str, Any]:
        return self.embedding_workflow.index_case_embedding(
            site_store,
            patient_id=patient_id,
            visit_date=visit_date,
            model_version=model_version,
            execution_device=execution_device,
            force_refresh=force_refresh,
            update_index=update_index,
        )

    def retrieval_signature(self, retrieval_profile: str = "dinov2_lesion_crop") -> dict[str, Any]:
        return self.federated_retrieval_workflow.retrieval_signature(retrieval_profile)

    def sync_remote_retrieval_corpus(
        self,
        site_store: SiteStore,
        *,
        execution_device: str,
        retrieval_profile: str = "dinov2_lesion_crop",
        force_refresh: bool = False,
        batch_size: int = 32,
        progress_callback: Callable[[dict[str, Any]], None] | None = None,
    ) -> dict[str, Any]:
        return self.federated_retrieval_workflow.sync_remote_retrieval_corpus(
            site_store,
            execution_device=execution_device,
            retrieval_profile=retrieval_profile,
            force_refresh=force_refresh,
            batch_size=batch_size,
            progress_callback=progress_callback,
        )

    def search_remote_retrieval_corpus(
        self,
        site_store: SiteStore,
        *,
        query_embedding: np.ndarray,
        query_metadata: dict[str, Any],
        patient_id: str,
        visit_date: str,
        retrieval_profile: str = "dinov2_lesion_crop",
        top_k: int = 3,
    ) -> list[dict[str, Any]]:
        return self.federated_retrieval_workflow.search_remote_retrieval_corpus(
            site_store,
            query_embedding=query_embedding,
            query_metadata=query_metadata,
            patient_id=patient_id,
            visit_date=visit_date,
            retrieval_profile=retrieval_profile,
            top_k=top_k,
        )

    def _faiss_backend_hits(
        self,
        site_store: SiteStore,
        *,
        model_version: dict[str, Any],
        backend: str,
        query_embedding: np.ndarray,
        top_k: int,
    ) -> list[dict[str, Any]]:
        return self.vector_index.search(
            site_store,
            model_version_id=str(model_version.get("version_id") or "unknown"),
            backend=backend,
            query_embedding=query_embedding,
            top_k=top_k,
        )

    def run_ai_clinic_similar_cases(
        self,
        site_store: SiteStore,
        *,
        patient_id: str,
        visit_date: str,
        model_version: dict[str, Any],
        execution_device: str,
        top_k: int = 3,
        retrieval_backend: str = "standard",
        retrieval_profile: str = "dinov2_lesion_crop",
    ) -> dict[str, Any]:
        return self.ai_clinic_workflow.run_ai_clinic_similar_cases(
            site_store,
            patient_id=patient_id,
            visit_date=visit_date,
            model_version=model_version,
            execution_device=execution_device,
            top_k=top_k,
            retrieval_backend=retrieval_backend,
            retrieval_profile=retrieval_profile,
        )

    def _query_image_paths_for_text_retrieval(
        self,
        site_store: SiteStore,
        case_records: list[dict[str, Any]],
        model_version: dict[str, Any],
    ) -> list[str]:
        representative = self._select_representative_record(case_records)
        crop_mode = self._resolve_model_crop_mode(model_version)
        query_paths: list[str] = []

        if crop_mode != "both":
            prepared_records = self._prepare_records_for_model(site_store, case_records, crop_mode=crop_mode)
            prepared_representative = next(
                (
                    item
                    for item in prepared_records
                    if item.get("source_image_path") == representative.get("image_path")
                ),
                prepared_records[0],
            )
            query_paths.append(str(prepared_representative["image_path"]))
            return query_paths

        components, _weights = self._resolve_ensemble_components(model_version)
        for component in components:
            component_crop_mode = self._resolve_model_crop_mode(component)
            prepared_records = self._prepare_records_for_model(site_store, case_records, crop_mode=component_crop_mode)
            prepared_representative = next(
                (
                    item
                    for item in prepared_records
                    if item.get("source_image_path") == representative.get("image_path")
                ),
                prepared_records[0],
            )
            next_path = str(prepared_representative["image_path"])
            if next_path not in query_paths:
                query_paths.append(next_path)
        return query_paths

    def _build_case_text_summary(self, case_records: list[dict[str, Any]]) -> str:
        primary = case_records[0]
        additional_organisms = [
            str(item.get("culture_species") or "").strip()
            for item in (primary.get("additional_organisms") or [])
            if str(item.get("culture_species") or "").strip()
        ]
        predisposing_raw = str(primary.get("predisposing_factor") or "").strip()
        predisposing = ", ".join(part.strip() for part in predisposing_raw.split("|") if part.strip())
        views = ", ".join(sorted({str(item.get("view") or "").strip() for item in case_records if str(item.get("view") or "").strip()}))
        fragments = [
            "infectious keratitis slit lamp case.",
            f"culture category: {str(primary.get('culture_category') or 'unknown').strip()}.",
            f"culture species: {str(primary.get('culture_species') or 'unknown').strip()}.",
        ]
        if additional_organisms:
            fragments.append(f"additional organisms: {', '.join(additional_organisms)}.")
        if str(primary.get("smear_result") or "").strip():
            fragments.append(f"smear result: {str(primary.get('smear_result')).strip()}.")
        if str(primary.get("contact_lens_use") or "").strip():
            fragments.append(f"contact lens use: {str(primary.get('contact_lens_use')).strip()}.")
        if predisposing:
            fragments.append(f"predisposing factors: {predisposing}.")
        if str(primary.get("visit_status") or "").strip():
            fragments.append(f"visit status: {str(primary.get('visit_status')).strip()}.")
        if views:
            fragments.append(f"captured views: {views}.")
        if bool(primary.get("polymicrobial")):
            fragments.append("polymicrobial case.")
        history = str(primary.get("other_history") or "").strip()
        if history:
            fragments.append(f"history note: {history}.")
        return " ".join(fragment for fragment in fragments if fragment)

    def run_ai_clinic_text_evidence(
        self,
        site_store: SiteStore,
        *,
        patient_id: str,
        visit_date: str,
        model_version: dict[str, Any],
        execution_device: str,
        top_k: int = 3,
    ) -> dict[str, Any]:
        return self.ai_clinic_workflow.run_ai_clinic_text_evidence(
            site_store,
            patient_id=patient_id,
            visit_date=visit_date,
            model_version=model_version,
            execution_device=execution_device,
            top_k=top_k,
        )

    def _latest_case_validation_context(
        self,
        site_id: str,
        *,
        patient_id: str,
        visit_date: str,
        model_version_id: str | None = None,
    ) -> dict[str, Any] | None:
        preferred_model_id = str(model_version_id or "").strip()
        expected_case_reference_id = self.control_plane.case_reference_id(site_id, patient_id, visit_date)
        matching_runs = self.control_plane.list_validation_runs(site_id=site_id)
        for require_model_match in ([True, False] if preferred_model_id else [False]):
            for run in matching_runs:
                run_model_id = str(run.get("model_version_id") or "").strip()
                if require_model_match and run_model_id != preferred_model_id:
                    continue
                validation_id = str(run.get("validation_id") or "").strip()
                if not validation_id:
                    continue
                predictions = self.control_plane.load_case_predictions(validation_id)
                matched = next(
                    (
                        item
                        for item in predictions
                        if (
                            str(item.get("case_reference_id") or "") == expected_case_reference_id
                            or (
                                str(item.get("patient_id") or "") == patient_id
                                and str(item.get("visit_date") or "") == visit_date
                            )
                        )
                    ),
                    None,
                )
                if matched is None:
                    continue
                return {
                    "validation_id": validation_id,
                    "run_date": run.get("run_date"),
                    "model_version_id": run.get("model_version_id"),
                    "model_version": run.get("model_version"),
                    "predicted_label": matched.get("predicted_label"),
                    "true_label": matched.get("true_label"),
                    "prediction_probability": matched.get("prediction_probability"),
                    "predicted_confidence": matched.get("predicted_confidence"),
                    "is_correct": matched.get("is_correct"),
                }
        return None

    def run_ai_clinic_report(
        self,
        site_store: SiteStore,
        *,
        patient_id: str,
        visit_date: str,
        model_version: dict[str, Any],
        execution_device: str,
        top_k: int = 3,
        retrieval_backend: str = "standard",
        retrieval_profile: str = "dinov2_lesion_crop",
    ) -> dict[str, Any]:
        return self.ai_clinic_workflow.run_ai_clinic_report(
            site_store,
            patient_id=patient_id,
            visit_date=visit_date,
            model_version=model_version,
            execution_device=execution_device,
            top_k=top_k,
            retrieval_backend=retrieval_backend,
            retrieval_profile=retrieval_profile,
        )

    def run_case_postmortem(
        self,
        site_store: SiteStore,
        *,
        patient_id: str,
        visit_date: str,
        model_version: dict[str, Any],
        execution_device: str,
        classification_context: dict[str, Any] | None = None,
        case_prediction: dict[str, Any] | None = None,
        top_k: int = 3,
        retrieval_backend: str = "hybrid",
    ) -> dict[str, Any]:
        return self.postmortem_workflow.run_case_postmortem(
            site_store,
            patient_id=patient_id,
            visit_date=visit_date,
            model_version=model_version,
            execution_device=execution_device,
            classification_context=classification_context,
            case_prediction=case_prediction,
            top_k=top_k,
            retrieval_backend=retrieval_backend,
        )

    def _artifact_refs_for_case(
        self,
        site_store: SiteStore,
        *,
        artifact_row: dict[str, Any],
        prepared_artifact: dict[str, Any],
        crop_mode: str,
        model_reference: dict[str, Any],
        model: Any,
        execution_device: str,
        predicted_index: int,
        generate_gradcam: bool,
        generate_medsam: bool,
    ) -> dict[str, Any]:
        artifact_refs: dict[str, Any] = {
            "gradcam_path": None,
            "gradcam_heatmap_path": None,
            "gradcam_cornea_path": None,
            "gradcam_cornea_heatmap_path": None,
            "gradcam_lesion_path": None,
            "gradcam_lesion_heatmap_path": None,
            "medsam_mask_path": None,
            "roi_crop_path": None,
            "lesion_mask_path": None,
            "lesion_crop_path": None,
        }
        if crop_mode in {"automated", "paired"} and generate_medsam:
            roi = self._ensure_roi_crop(site_store, artifact_row["image_path"])
            artifact_refs["medsam_mask_path"] = roi["medsam_mask_path"]
            artifact_refs["roi_crop_path"] = roi["roi_crop_path"]
        if crop_mode in {"manual", "paired"} and generate_medsam:
            lesion = self._ensure_lesion_crop(site_store, artifact_row)
            artifact_refs["lesion_mask_path"] = lesion["lesion_mask_path"]
            artifact_refs["lesion_crop_path"] = lesion["lesion_crop_path"]
        if generate_gradcam and self.model_manager.supports_gradcam(str(model_reference.get("architecture") or "")):
            artifact_name = Path(artifact_row["image_path"]).stem
            if self._is_dual_input_model_version(model_reference):
                cornea_input_path = str(prepared_artifact.get("cornea_image_path") or prepared_artifact.get("image_path") or "")
                lesion_input_path = str(
                    prepared_artifact.get("lesion_image_path") or prepared_artifact.get("lesion_crop_path") or ""
                )
                if cornea_input_path and lesion_input_path:
                    gradcam_artifacts = self.model_manager.generate_paired_explanation_artifacts(
                        model,
                        model_reference,
                        cornea_image_path=cornea_input_path,
                        lesion_image_path=lesion_input_path,
                        lesion_mask_path=str(prepared_artifact.get("lesion_mask_path") or ""),
                        device=execution_device,
                        cornea_output_path=site_store.gradcam_dir / f"{artifact_name}_{crop_mode}_cornea_gradcam.png",
                        lesion_output_path=site_store.gradcam_dir / f"{artifact_name}_{crop_mode}_lesion_gradcam.png",
                        target_class=predicted_index,
                        cornea_heatmap_output_path=site_store.gradcam_dir / f"{artifact_name}_{crop_mode}_cornea_gradcam.npy",
                        lesion_heatmap_output_path=site_store.gradcam_dir / f"{artifact_name}_{crop_mode}_lesion_gradcam.npy",
                    )
                    artifact_refs["gradcam_path"] = gradcam_artifacts["cornea_overlay_path"]
                    artifact_refs["gradcam_heatmap_path"] = gradcam_artifacts["cornea_heatmap_path"]
                    artifact_refs["gradcam_cornea_path"] = gradcam_artifacts["cornea_overlay_path"]
                    artifact_refs["gradcam_cornea_heatmap_path"] = gradcam_artifacts["cornea_heatmap_path"]
                    artifact_refs["gradcam_lesion_path"] = gradcam_artifacts["lesion_overlay_path"]
                    artifact_refs["gradcam_lesion_heatmap_path"] = gradcam_artifacts["lesion_heatmap_path"]
            else:
                gradcam_artifacts = self.model_manager.generate_explanation_artifacts(
                    model,
                    model_reference,
                    prepared_artifact["image_path"],
                    execution_device,
                    site_store.gradcam_dir / f"{artifact_name}_{crop_mode}_gradcam.png",
                    target_class=predicted_index,
                    heatmap_output_path=site_store.gradcam_dir / f"{artifact_name}_{crop_mode}_gradcam.npy",
                )
                artifact_refs["gradcam_path"] = gradcam_artifacts["overlay_path"]
                artifact_refs["gradcam_heatmap_path"] = gradcam_artifacts["heatmap_path"]
        return artifact_refs

    def _predict_case_with_model(
        self,
        site_store: SiteStore,
        case_records: list[dict[str, Any]],
        model_version: dict[str, Any],
        execution_device: str,
        *,
        generate_gradcam: bool,
        generate_medsam: bool,
    ) -> dict[str, Any]:
        crop_mode = self._resolve_model_crop_mode(model_version)
        case_aggregation = self._resolve_model_case_aggregation(model_version)
        prepared_records = self._prepare_records_for_model(site_store, case_records, crop_mode=crop_mode)
        model = self.model_manager.load_model(model_version, execution_device)
        attention_scores: list[dict[str, Any]] | None = None
        quality_weights: list[float] | None = None
        representative_index: int | None = None

        if case_aggregation == "attention_mil":
            aggregated_prediction = self._predict_case_with_attention_mil(
                model,
                model_version,
                prepared_records,
                execution_device,
            )
            predicted_probability = float(aggregated_prediction["predicted_probability"])
            attention_scores = list(aggregated_prediction["attention_scores"])
            representative_index = int(aggregated_prediction["representative_index"])
            prepared_artifact = prepared_records[representative_index]
            artifact_row = next(
                (
                    record
                    for record in case_records
                    if str(record.get("image_path") or "") == str(prepared_artifact.get("source_image_path") or "")
                ),
                self._select_representative_record(case_records),
            )
        else:
            artifact_row = self._select_representative_record(case_records)
            prepared_artifact = next(
                (
                    record
                    for record in prepared_records
                    if record["source_image_path"] == artifact_row["image_path"]
                ),
                prepared_records[0],
            )
            if self._is_dual_input_model_version(model_version):
                image_predictions = [
                    self.model_manager.predict_paired_image(
                        model,
                        model_version,
                        str(record.get("cornea_image_path") or record["image_path"]),
                        str(record.get("lesion_image_path") or record.get("lesion_crop_path") or ""),
                        str(record.get("lesion_mask_path") or ""),
                        execution_device,
                    )
                    for record in prepared_records
                ]
            else:
                image_predictions = [
                    self.model_manager.predict_image(model, record["image_path"], execution_device)
                    for record in prepared_records
                ]
            aggregated_prediction = self._aggregate_image_predictions(
                prepared_records,
                image_predictions,
                case_aggregation,
            )
            predicted_probability = float(aggregated_prediction["predicted_probability"])
            quality_weights = aggregated_prediction.get("quality_weights")
        decision_threshold = self._resolve_model_threshold(model_version)
        predicted_index = 1 if predicted_probability >= decision_threshold else 0
        culture_category = str(case_records[0].get("culture_category") or "unknown").strip().lower()
        true_index = LABEL_TO_INDEX.get(culture_category, -1)

        artifact_refs = self._artifact_refs_for_case(
            site_store,
            artifact_row=artifact_row,
            prepared_artifact=prepared_artifact,
            crop_mode=crop_mode,
            model_reference=model_version,
            model=model,
            execution_device=execution_device,
            predicted_index=predicted_index,
            generate_gradcam=generate_gradcam,
            generate_medsam=generate_medsam,
        )

        return {
            "patient_id": str(case_records[0]["patient_id"]),
            "visit_date": str(case_records[0]["visit_date"]),
            "true_index": true_index,
            "predicted_index": predicted_index,
            "predicted_probability": predicted_probability,
            "decision_threshold": decision_threshold,
            "crop_mode": crop_mode,
            "case_aggregation": case_aggregation,
            "n_source_images": len(case_records),
            "n_model_inputs": len(prepared_records),
            "component_model_version_id": model_version.get("version_id"),
            "component_model_version_name": model_version.get("version_name"),
            "instance_attention_scores": attention_scores,
            "quality_weights": quality_weights,
            "model_representative_source_image_path": str(prepared_artifact.get("source_image_path") or ""),
            "model_representative_image_path": str(prepared_artifact.get("image_path") or ""),
            "model_representative_index": representative_index,
            **artifact_refs,
        }

    def _predict_case(
        self,
        site_store: SiteStore,
        case_records: list[dict[str, Any]],
        model_version: dict[str, Any],
        execution_device: str,
        *,
        generate_gradcam: bool,
        generate_medsam: bool,
    ) -> dict[str, Any]:
        if model_version.get("ensemble_mode") != "weighted_average":
            return self._predict_case_with_model(
                site_store,
                case_records,
                model_version,
                execution_device,
                generate_gradcam=generate_gradcam,
                generate_medsam=generate_medsam,
            )

        components, weights = self._resolve_ensemble_components(model_version)
        component_predictions: list[dict[str, Any]] = []
        for component in components:
            component_predictions.append(
                self._predict_case_with_model(
                    site_store,
                    case_records,
                    component,
                    execution_device,
                    generate_gradcam=generate_gradcam and self._resolve_model_crop_mode(component) == "automated",
                    generate_medsam=generate_medsam,
                )
            )

        ensemble_crop_mode = self._resolve_model_crop_mode(model_version)
        automated_prediction = next((item for item in component_predictions if item.get("crop_mode") == "automated"), None)
        manual_prediction = next((item for item in component_predictions if item.get("crop_mode") == "manual"), None)
        predicted_probability = float(
            sum(weight * float(prediction["predicted_probability"]) for weight, prediction in zip(weights, component_predictions))
        )
        decision_threshold = self._resolve_model_threshold(model_version)
        predicted_index = 1 if predicted_probability >= decision_threshold else 0
        true_index = int(component_predictions[0]["true_index"])

        def first_artifact_path(*artifact_keys: str) -> str | None:
            for preferred_prediction in (automated_prediction, manual_prediction):
                if preferred_prediction is None:
                    continue
                for artifact_key in artifact_keys:
                    artifact_value = preferred_prediction.get(artifact_key)
                    if artifact_value:
                        return str(artifact_value)
            for prediction in component_predictions:
                for artifact_key in artifact_keys:
                    artifact_value = prediction.get(artifact_key)
                    if artifact_value:
                        return str(artifact_value)
            return None

        merged_artifacts = {
            "gradcam_path": first_artifact_path("gradcam_path"),
            "gradcam_heatmap_path": first_artifact_path("gradcam_heatmap_path"),
            "gradcam_cornea_path": first_artifact_path("gradcam_cornea_path"),
            "gradcam_cornea_heatmap_path": first_artifact_path("gradcam_cornea_heatmap_path"),
            "gradcam_lesion_path": first_artifact_path("gradcam_lesion_path"),
            "gradcam_lesion_heatmap_path": first_artifact_path("gradcam_lesion_heatmap_path"),
            "medsam_mask_path": first_artifact_path("medsam_mask_path"),
            "roi_crop_path": first_artifact_path("roi_crop_path"),
            "lesion_mask_path": first_artifact_path("lesion_mask_path"),
            "lesion_crop_path": first_artifact_path("lesion_crop_path"),
        }

        return {
            "patient_id": str(case_records[0]["patient_id"]),
            "visit_date": str(case_records[0]["visit_date"]),
            "true_index": true_index,
            "predicted_index": predicted_index,
            "predicted_probability": predicted_probability,
            "decision_threshold": decision_threshold,
            "crop_mode": ensemble_crop_mode,
            "case_aggregation": "weighted_average",
            "n_source_images": len(case_records),
            "n_model_inputs": sum(int(item.get("n_model_inputs", 0)) for item in component_predictions),
            "ensemble_component_predictions": component_predictions,
            "ensemble_weights": {
                str(component.get("version_id") or component.get("architecture") or "component"): round(weight, 4)
                for component, weight in zip(components, weights)
            },
            **merged_artifacts,
        }

    def run_external_validation(
        self,
        project_id: str,
        site_store: SiteStore,
        model_version: dict[str, Any],
        execution_device: str,
        generate_gradcam: bool,
        generate_medsam: bool,
    ) -> tuple[dict[str, Any], list[dict[str, Any]], pd.DataFrame]:
        manifest_df = site_store.generate_manifest()
        if manifest_df.empty:
            raise ValueError("No uploaded images are available for validation.")

        grouped = manifest_df.groupby(["patient_id", "visit_date"], sort=False)
        case_predictions: list[dict[str, Any]] = []
        summary_targets: list[int] = []
        summary_predictions: list[int] = []
        summary_probabilities: list[float] = []

        for (patient_id, visit_date), patient_frame in grouped:
            case_result = self._predict_case(
                site_store,
                patient_frame.to_dict("records"),
                model_version,
                execution_device,
                generate_gradcam=generate_gradcam,
                generate_medsam=generate_medsam,
            )
            predicted_probability = float(case_result["predicted_probability"])
            predicted_index = int(case_result["predicted_index"])
            true_index = int(case_result["true_index"])

            case_predictions.append(
                {
                    "validation_id": "",
                    "patient_id": patient_id,
                    "visit_date": visit_date,
                    "true_label": INDEX_TO_LABEL[true_index],
                    "predicted_label": INDEX_TO_LABEL[predicted_index],
                    "prediction_probability": predicted_probability,
                    "is_correct": bool(true_index == predicted_index),
                    "crop_mode": case_result.get("crop_mode"),
                    "case_aggregation": case_result.get("case_aggregation"),
                    "n_source_images": case_result.get("n_source_images"),
                    "n_model_inputs": case_result.get("n_model_inputs"),
                    "ensemble_weights": case_result.get("ensemble_weights"),
                    "ensemble_component_predictions": case_result.get("ensemble_component_predictions"),
                    "instance_attention_scores": case_result.get("instance_attention_scores"),
                    "quality_weights": case_result.get("quality_weights"),
                    "model_representative_source_image_path": case_result.get("model_representative_source_image_path"),
                    "model_representative_image_path": case_result.get("model_representative_image_path"),
                    "model_representative_index": case_result.get("model_representative_index"),
                    "gradcam_path": case_result.get("gradcam_path"),
                    "gradcam_heatmap_path": case_result.get("gradcam_heatmap_path"),
                    "gradcam_cornea_path": case_result.get("gradcam_cornea_path"),
                    "gradcam_cornea_heatmap_path": case_result.get("gradcam_cornea_heatmap_path"),
                    "gradcam_lesion_path": case_result.get("gradcam_lesion_path"),
                    "gradcam_lesion_heatmap_path": case_result.get("gradcam_lesion_heatmap_path"),
                    "medsam_mask_path": case_result.get("medsam_mask_path"),
                    "roi_crop_path": case_result.get("roi_crop_path"),
                    "lesion_mask_path": case_result.get("lesion_mask_path"),
                    "lesion_crop_path": case_result.get("lesion_crop_path"),
                }
            )
            summary_targets.append(true_index)
            summary_predictions.append(predicted_index)
            summary_probabilities.append(predicted_probability)

        validation_id = make_id("validation")
        for case_prediction in case_predictions:
            case_prediction["validation_id"] = validation_id

        metrics = self.model_manager.classification_metrics(
            summary_targets,
            summary_predictions,
            summary_probabilities,
        )
        summary = {
            "validation_id": validation_id,
            "project_id": project_id,
            "site_id": site_store.site_id,
            "model_version": model_version["version_name"],
            "model_version_id": model_version["version_id"],
            "model_architecture": model_version.get("architecture", "densenet121"),
            "case_aggregation": self._resolve_model_case_aggregation(model_version),
            "run_date": utc_now(),
            "n_patients": int(manifest_df["patient_id"].nunique()),
            "n_cases": int(manifest_df[["patient_id", "visit_date"]].drop_duplicates().shape[0]),
            "n_images": int(len(manifest_df)),
            "AUROC": metrics["AUROC"],
            "accuracy": metrics["accuracy"],
            "sensitivity": metrics["sensitivity"],
            "specificity": metrics["specificity"],
            "F1": metrics["F1"],
            "balanced_accuracy": metrics["balanced_accuracy"],
            "brier_score": metrics["brier_score"],
            "ece": metrics["ece"],
            "confusion_matrix": metrics["confusion_matrix"],
            "roc_curve": metrics["roc_curve"],
            "calibration": metrics["calibration"],
            "site_metrics": [
                {
                    "site_id": site_store.site_id,
                    "n_cases": int(manifest_df[["patient_id", "visit_date"]].drop_duplicates().shape[0]),
                    "accuracy": metrics["accuracy"],
                    "sensitivity": metrics["sensitivity"],
                    "specificity": metrics["specificity"],
                    "F1": metrics["F1"],
                    "AUROC": metrics["AUROC"],
                    "balanced_accuracy": metrics["balanced_accuracy"],
                    "brier_score": metrics["brier_score"],
                    "ece": metrics["ece"],
                }
            ],
            "n_correct": int(sum(pred == target for pred, target in zip(summary_predictions, summary_targets))),
            "n_incorrect": int(sum(pred != target for pred, target in zip(summary_predictions, summary_targets))),
        }
        saved_summary = self.control_plane.save_validation_run(summary, case_predictions)
        saved_summary["experiment"] = self._register_experiment(
            site_store,
            experiment_type="external_validation",
            status="completed",
            created_at=str(saved_summary.get("run_date") or utc_now()),
            execution_device=execution_device,
            manifest_df=manifest_df,
            parameters={
                "project_id": project_id,
                "model_version_id": model_version.get("version_id"),
                "model_version_name": model_version.get("version_name"),
                "generate_gradcam": bool(generate_gradcam),
                "generate_medsam": bool(generate_medsam),
            },
            metrics={
                "accuracy": saved_summary.get("accuracy"),
                "sensitivity": saved_summary.get("sensitivity"),
                "specificity": saved_summary.get("specificity"),
                "F1": saved_summary.get("F1"),
                "AUROC": saved_summary.get("AUROC"),
                "balanced_accuracy": saved_summary.get("balanced_accuracy"),
                "brier_score": saved_summary.get("brier_score"),
                "ece": saved_summary.get("ece"),
            },
            report_payload=saved_summary,
            model_version=model_version,
        )
        return saved_summary, case_predictions, manifest_df

    def run_case_validation(
        self,
        project_id: str,
        site_store: SiteStore,
        patient_id: str,
        visit_date: str,
        model_version: dict[str, Any],
        execution_device: str,
        generate_gradcam: bool = True,
        generate_medsam: bool = True,
    ) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        return self.validation_workflow.run_case_validation(
            project_id,
            site_store,
            patient_id,
            visit_date,
            model_version,
            execution_device,
            generate_gradcam=generate_gradcam,
            generate_medsam=generate_medsam,
        )

    def preview_case_roi(
        self,
        site_store: SiteStore,
        patient_id: str,
        visit_date: str,
    ) -> list[dict[str, Any]]:
        return self.validation_workflow.preview_case_roi(site_store, patient_id, visit_date)

    def preview_case_lesion(
        self,
        site_store: SiteStore,
        patient_id: str,
        visit_date: str,
    ) -> list[dict[str, Any]]:
        return self.validation_workflow.preview_case_lesion(site_store, patient_id, visit_date)

    def list_stored_case_lesion_previews(
        self,
        site_store: SiteStore,
        patient_id: str,
        visit_date: str,
    ) -> list[dict[str, Any]]:
        return self.validation_workflow.list_stored_case_lesion_previews(site_store, patient_id, visit_date)

    def preview_image_lesion(
        self,
        site_store: SiteStore,
        image_id: str,
        *,
        lesion_prompt_box: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return self.validation_workflow.preview_image_lesion(
            site_store,
            image_id,
            lesion_prompt_box=lesion_prompt_box,
        )

    def contribute_case(
        self,
        site_store: SiteStore,
        patient_id: str,
        visit_date: str,
        model_version: dict[str, Any],
        execution_device: str,
        user_id: str,
        user_public_alias: str | None = None,
        contribution_group_id: str | None = None,
    ) -> dict[str, Any]:
        return self.contribution_workflow.contribute_case(
            site_store,
            patient_id,
            visit_date,
            model_version,
            execution_device,
            user_id,
            user_public_alias=user_public_alias,
            contribution_group_id=contribution_group_id,
        )

    def run_initial_training(
        self,
        site_store: SiteStore,
        architecture: str,
        output_model_path: str,
        execution_device: str,
        crop_mode: str = "automated",
        epochs: int = 30,
        learning_rate: float = 1e-4,
        batch_size: int = 16,
        val_split: float = 0.2,
        test_split: float = 0.2,
        use_pretrained: bool = True,
        pretraining_source: str | None = None,
        ssl_checkpoint_path: str | None = None,
        case_aggregation: str = "mean",
        use_medsam_crops: bool = True,
        regenerate_split: bool = False,
        progress_callback: Any = None,
        fine_tuning_mode: str = "full",
        backbone_learning_rate: float | None = None,
        head_learning_rate: float | None = None,
        warmup_epochs: int = 0,
        early_stop_patience: int | None = None,
        partial_unfreeze_blocks: int = 1,
    ) -> dict[str, Any]:
        return self.training_workflow.run_initial_training(
            site_store,
            architecture,
            output_model_path,
            execution_device,
            crop_mode=crop_mode,
            epochs=epochs,
            learning_rate=learning_rate,
            batch_size=batch_size,
            val_split=val_split,
            test_split=test_split,
            use_pretrained=use_pretrained,
            pretraining_source=pretraining_source,
            ssl_checkpoint_path=ssl_checkpoint_path,
            case_aggregation=case_aggregation,
            use_medsam_crops=use_medsam_crops,
            regenerate_split=regenerate_split,
            progress_callback=progress_callback,
            fine_tuning_mode=fine_tuning_mode,
            backbone_learning_rate=backbone_learning_rate,
            head_learning_rate=head_learning_rate,
            warmup_epochs=warmup_epochs,
            early_stop_patience=early_stop_patience,
            partial_unfreeze_blocks=partial_unfreeze_blocks,
        )

    def run_full_dataset_refit(
        self,
        site_store: SiteStore,
        architecture: str,
        output_model_path: str,
        execution_device: str,
        crop_mode: str = "automated",
        epochs: int = 30,
        learning_rate: float = 1e-4,
        batch_size: int = 16,
        use_pretrained: bool = True,
        pretraining_source: str | None = None,
        ssl_checkpoint_path: str | None = None,
        case_aggregation: str = "mean",
        use_medsam_crops: bool = True,
        progress_callback: Any = None,
        fine_tuning_mode: str = "full",
        backbone_learning_rate: float | None = None,
        head_learning_rate: float | None = None,
        warmup_epochs: int = 0,
        early_stop_patience: int | None = None,
        partial_unfreeze_blocks: int = 1,
    ) -> dict[str, Any]:
        return self.training_workflow.run_full_dataset_refit(
            site_store,
            architecture,
            output_model_path,
            execution_device,
            crop_mode=crop_mode,
            epochs=epochs,
            learning_rate=learning_rate,
            batch_size=batch_size,
            use_pretrained=use_pretrained,
            pretraining_source=pretraining_source,
            ssl_checkpoint_path=ssl_checkpoint_path,
            case_aggregation=case_aggregation,
            use_medsam_crops=use_medsam_crops,
            progress_callback=progress_callback,
            fine_tuning_mode=fine_tuning_mode,
            backbone_learning_rate=backbone_learning_rate,
            head_learning_rate=head_learning_rate,
            warmup_epochs=warmup_epochs,
            early_stop_patience=early_stop_patience,
            partial_unfreeze_blocks=partial_unfreeze_blocks,
        )

    def run_image_level_federated_round(
        self,
        site_store: SiteStore,
        model_version: dict[str, Any],
        execution_device: str,
        *,
        epochs: int = 1,
        learning_rate: float = 5e-5,
        batch_size: int = 8,
        progress_callback: Any = None,
    ) -> dict[str, Any]:
        return self.training_workflow.run_image_level_federated_round(
            site_store,
            model_version,
            execution_device,
            epochs=epochs,
            learning_rate=learning_rate,
            batch_size=batch_size,
            progress_callback=progress_callback,
        )

    def run_visit_level_federated_round(
        self,
        site_store: SiteStore,
        model_version: dict[str, Any],
        execution_device: str,
        *,
        epochs: int = 1,
        learning_rate: float = 5e-5,
        batch_size: int = 4,
        progress_callback: Any = None,
    ) -> dict[str, Any]:
        return self.training_workflow.run_visit_level_federated_round(
            site_store,
            model_version,
            execution_device,
            epochs=epochs,
            learning_rate=learning_rate,
            batch_size=batch_size,
            progress_callback=progress_callback,
        )

    def run_retrieval_baseline(
        self,
        site_store: SiteStore,
        execution_device: str,
        crop_mode: str = "automated",
        top_k: int = 10,
        progress_callback: Any = None,
    ) -> dict[str, Any]:
        return self.training_workflow.run_retrieval_baseline(
            site_store,
            execution_device,
            crop_mode=crop_mode,
            top_k=top_k,
            progress_callback=progress_callback,
        )

    def run_cross_validation(
        self,
        site_store: SiteStore,
        architecture: str,
        output_dir: str,
        execution_device: str,
        crop_mode: str = "automated",
        num_folds: int = 5,
        epochs: int = 30,
        learning_rate: float = 1e-4,
        batch_size: int = 16,
        val_split: float = 0.2,
        use_pretrained: bool = True,
        pretraining_source: str | None = None,
        ssl_checkpoint_path: str | None = None,
        case_aggregation: str = "mean",
        use_medsam_crops: bool = True,
        progress_callback: Any = None,
    ) -> dict[str, Any]:
        return self.training_workflow.run_cross_validation(
            site_store,
            architecture,
            output_dir,
            execution_device,
            crop_mode=crop_mode,
            num_folds=num_folds,
            epochs=epochs,
            learning_rate=learning_rate,
            batch_size=batch_size,
            val_split=val_split,
            use_pretrained=use_pretrained,
            pretraining_source=pretraining_source,
            ssl_checkpoint_path=ssl_checkpoint_path,
            case_aggregation=case_aggregation,
            use_medsam_crops=use_medsam_crops,
            progress_callback=progress_callback,
        )

    def run_local_fine_tuning(
        self,
        site_store: SiteStore,
        model_version: dict[str, Any],
        execution_device: str,
        upload_type: str,
        epochs: int,
    ) -> dict[str, Any]:
        manifest_df = site_store.generate_manifest()
        if manifest_df.empty:
            raise ValueError("No manifest records are available for fine-tuning.")
        crop_mode = self._resolve_model_crop_mode(model_version)
        if crop_mode == "both":
            raise ValueError("Ensemble models are not supported for local fine-tuning contributions.")
        records = self._prepare_records_for_model(
            site_store,
            manifest_df.to_dict("records"),
            crop_mode=crop_mode,
        )

        full_finetune = execution_device == "cuda"
        if execution_device == "cpu":
            epochs = min(int(epochs), 3)

        architecture = model_version.get("architecture", "densenet121")
        output_model_path = site_store.update_dir / f"{make_id(architecture)}_weights.pt"
        result = self.model_manager.fine_tune(
            records=records,
            base_model_reference=model_version,
            output_model_path=output_model_path,
            device=execution_device,
            full_finetune=full_finetune,
            epochs=int(epochs),
        )

        upload_path = Path(result["output_model_path"])
        base_model_path = self.model_manager.resolve_model_path(model_version, allow_download=True)
        privacy_controls = federated_delta_privacy_controls()
        if upload_type == "weight delta":
            upload_path = site_store.update_dir / f"{make_id('delta')}.pt"
            self.model_manager.save_weight_delta(
                base_model_path,
                result["output_model_path"],
                upload_path,
                clip_l2_norm=privacy_controls.get("delta_clip_l2_norm"),
                noise_multiplier=privacy_controls.get("delta_noise_multiplier"),
                quantization_bits=privacy_controls.get("delta_quantization_bits"),
            )
        elif upload_type == "aggregated update":
            upload_path = site_store.update_dir / f"{make_id('agg')}.pt"
            self.model_manager.save_weight_delta(
                base_model_path,
                result["output_model_path"],
                upload_path,
                clip_l2_norm=privacy_controls.get("delta_clip_l2_norm"),
                noise_multiplier=privacy_controls.get("delta_noise_multiplier"),
                quantization_bits=privacy_controls.get("delta_quantization_bits"),
            )

        update_id = make_id("update")
        training_input_policy = (
            "medsam_lesion_crop_only"
            if crop_mode == "manual"
            else "medsam_cornea_plus_lesion_paired_fusion"
            if crop_mode == "paired"
            else "medsam_cornea_crop_only"
        )
        update_metadata = {
            "update_id": update_id,
            "site_id": site_store.site_id,
            "base_model_version_id": model_version["version_id"],
            "architecture": architecture,
            "upload_type": upload_type,
            "execution_device": execution_device,
            "artifact_path": str(upload_path),
            **self.control_plane.store_model_update_artifact(
                upload_path,
                update_id=update_id,
                artifact_kind="delta" if upload_type == "weight delta" else "model",
            ),
            "created_at": utc_now(),
            "preprocess_signature": self.model_manager.preprocess_signature(),
            "num_classes": MODEL_OUTPUT_CLASS_COUNT,
            "crop_mode": crop_mode,
            "training_input_policy": training_input_policy,
            "training_summary": result,
            "privacy_controls": privacy_controls if upload_type == "weight delta" else {},
            "dp_accounting": build_federated_dp_accounting_entry(
                privacy_controls,
                local_steps=int(epochs),
                participant_count=len(records),
                patient_count=len(
                    {
                        str(item.get("patient_id") or "").strip()
                        for item in records
                        if str(item.get("patient_id") or "").strip()
                    }
                ),
            )
            if upload_type == "weight delta"
            else {},
            "data_distribution": summarize_federated_data_distribution(records) if upload_type == "weight delta" else {},
        }
        if upload_type == "weight delta":
            update_metadata = apply_federated_update_signature(update_metadata)
        self.control_plane.register_model_update(update_metadata)
        update_metadata["experiment"] = self._register_experiment(
            site_store,
            experiment_type="local_fine_tuning",
            status="completed",
            created_at=str(update_metadata["created_at"]),
            execution_device=execution_device,
            manifest_df=manifest_df,
            parameters={
                "base_model_version_id": model_version["version_id"],
                "architecture": architecture,
                "upload_type": upload_type,
                "epochs": int(epochs),
                "full_finetune": bool(full_finetune),
                "crop_mode": crop_mode,
            },
            metrics={
                "average_loss": result.get("average_loss"),
            },
            report_payload=update_metadata,
            model_version=model_version,
        )
        return update_metadata
