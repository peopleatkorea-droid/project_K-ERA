from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from PIL import Image, ImageFilter, ImageOps, ImageStat

from kera_research.config import CASE_REFERENCE_SALT_FINGERPRINT
from kera_research.domain import DENSENET_VARIANTS, INDEX_TO_LABEL, LABEL_TO_INDEX, make_id, utc_now
from kera_research.services.ai_clinic_advisor import AiClinicWorkflowAdvisor
from kera_research.services.artifacts import CORNEA_CROP_STYLE, LESION_CROP_STYLE, MedSAMService
from kera_research.services.control_plane import ControlPlaneStore
from kera_research.services.data_plane import SiteStore
from kera_research.services.differential import AiClinicDifferentialRanker
from kera_research.services.modeling import ModelManager
from kera_research.services.quality import score_slit_lamp_image
from kera_research.services.retrieval import BiomedClipTextRetriever, Dinov2ImageRetriever
from kera_research.services.vector_index import FaissCaseIndexManager
from kera_research.storage import ensure_dir, read_json, write_json


class ResearchWorkflowService:
    def __init__(self, control_plane: ControlPlaneStore) -> None:
        self.control_plane = control_plane
        self.model_manager = ModelManager()
        self.medsam_service = MedSAMService()
        self.text_retriever = BiomedClipTextRetriever()
        self.dinov2_retriever = Dinov2ImageRetriever()
        self.vector_index = FaissCaseIndexManager()
        self.ai_clinic_advisor = AiClinicWorkflowAdvisor()
        self.differential_ranker = AiClinicDifferentialRanker()

        for baseline in self.model_manager.ensure_baseline_models():
            self.control_plane.ensure_model_version(baseline)

    def _normalize_crop_mode(self, crop_mode: str | None) -> str:
        normalized = str(crop_mode or "automated").strip().lower()
        if normalized in {"automated", "manual", "both"}:
            return normalized
        return "automated"

    def _resolve_model_crop_mode(self, model_version: dict[str, Any]) -> str:
        if model_version.get("ensemble_mode") == "weighted_average":
            return "both"
        crop_mode = str(model_version.get("crop_mode") or "").strip().lower()
        if crop_mode:
            return self._normalize_crop_mode(crop_mode)
        return "automated" if model_version.get("requires_medsam_crop", False) else "raw"

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

    def _crop_metadata_dir(self, site_store: SiteStore, crop_mode: str) -> Path:
        return ensure_dir(site_store.artifact_dir / f"{crop_mode}_preview_meta")

    def _lesion_prompt_box_signature(self, lesion_prompt_box: dict[str, Any] | None) -> str | None:
        if not isinstance(lesion_prompt_box, dict):
            return None
        normalized = {
            key: round(float(lesion_prompt_box[key]), 6)
            for key in ("x0", "y0", "x1", "y1")
            if key in lesion_prompt_box
        }
        if len(normalized) != 4:
            return None
        payload = json.dumps(normalized, sort_keys=True, separators=(",", ":"))
        return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:12]

    def _load_cached_crop(
        self,
        *,
        metadata_path: Path,
        mask_path: Path,
        crop_path: Path,
        mask_key: str = "medsam_mask_path",
        crop_key: str = "roi_crop_path",
        expected_backend: str | None = None,
        expected_crop_style: str | None = None,
        expected_prompt_signature: str | None = None,
    ) -> dict[str, Any] | None:
        if not (crop_path.exists() and mask_path.exists() and metadata_path.exists()):
            return None
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        backend = str(metadata.get("backend") or "").strip() or "unknown"
        crop_style = str(metadata.get("crop_style") or "").strip()
        if backend == "unknown" or backend.startswith("fallback_after_medsam_error"):
            return None
        normalized_expected_backend = str(expected_backend or "").strip().lower()
        if normalized_expected_backend and backend.startswith("external_") and normalized_expected_backend not in backend.lower():
            return None
        if expected_crop_style and crop_style != expected_crop_style:
            return None
        if expected_prompt_signature is not None and metadata.get("prompt_signature") != expected_prompt_signature:
            return None
        return {
            mask_key: str(mask_path),
            crop_key: str(crop_path),
            "backend": backend,
            "crop_style": crop_style or None,
            "medsam_error": metadata.get("medsam_error"),
            "prompt_signature": metadata.get("prompt_signature"),
        }

    def _save_crop_metadata(
        self,
        metadata_path: Path,
        result: dict[str, Any],
        *,
        crop_style: str,
        prompt_signature: str | None = None,
    ) -> None:
        write_json(
            metadata_path,
            {
                "backend": result.get("backend", "unknown"),
                "crop_style": crop_style,
                "medsam_error": result.get("medsam_error"),
                "prompt_signature": prompt_signature,
            },
        )

    def _ensure_roi_crop(self, site_store: SiteStore, image_path: str) -> dict[str, Any]:
        artifact_name = Path(image_path).stem
        mask_path = site_store.medsam_mask_dir / f"{artifact_name}_mask.png"
        crop_path = site_store.roi_crop_dir / f"{artifact_name}_crop.png"
        metadata_dir = self._crop_metadata_dir(site_store, "roi")
        metadata_path = metadata_dir / f"{artifact_name}.json"
        cached = self._load_cached_crop(
            metadata_path=metadata_path,
            mask_path=mask_path,
            crop_path=crop_path,
            expected_backend=self.medsam_service.backend,
            expected_crop_style=CORNEA_CROP_STYLE,
        )
        if cached:
            return cached
        result = self.medsam_service.generate_roi(image_path, mask_path, crop_path)
        self._save_crop_metadata(metadata_path, result, crop_style=CORNEA_CROP_STYLE)
        return {
            "medsam_mask_path": result["medsam_mask_path"],
            "roi_crop_path": result["roi_crop_path"],
            "backend": result.get("backend", "unknown"),
            "crop_style": CORNEA_CROP_STYLE,
            "medsam_error": result.get("medsam_error"),
        }

    def _pixel_prompt_box(self, image_path: str, lesion_prompt_box: dict[str, Any]) -> list[float]:
        required_keys = ("x0", "y0", "x1", "y1")
        if not all(key in lesion_prompt_box for key in required_keys):
            raise ValueError("Lesion prompt box is incomplete.")
        with Image.open(image_path) as image:
            normalized = ImageOps.exif_transpose(image)
            width, height = normalized.size
        x0 = min(max(float(lesion_prompt_box["x0"]), 0.0), 1.0)
        y0 = min(max(float(lesion_prompt_box["y0"]), 0.0), 1.0)
        x1 = min(max(float(lesion_prompt_box["x1"]), 0.0), 1.0)
        y1 = min(max(float(lesion_prompt_box["y1"]), 0.0), 1.0)
        if x1 <= x0 or y1 <= y0:
            raise ValueError("Lesion prompt box is invalid.")
        return [x0 * width, y0 * height, x1 * width, y1 * height]

    def _ensure_lesion_crop(
        self,
        site_store: SiteStore,
        record: dict[str, Any],
        expand_ratio: float = 2.5,
        lesion_prompt_box: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        lesion_prompt_box = lesion_prompt_box if lesion_prompt_box is not None else record.get("lesion_prompt_box")
        if not isinstance(lesion_prompt_box, dict):
            raise ValueError("Representative image for this case requires a saved lesion box.")
        prompt_signature = self._lesion_prompt_box_signature(lesion_prompt_box)
        artifact_name = Path(record["image_path"]).stem
        mask_path = site_store.lesion_mask_dir / f"{artifact_name}_mask.png"
        crop_path = site_store.lesion_crop_dir / f"{artifact_name}_crop.png"
        metadata_dir = self._crop_metadata_dir(site_store, "lesion")
        metadata_path = metadata_dir / f"{artifact_name}.json"
        cached = self._load_cached_crop(
            metadata_path=metadata_path,
            mask_path=mask_path,
            crop_path=crop_path,
            mask_key="lesion_mask_path",
            crop_key="lesion_crop_path",
            expected_backend=self.medsam_service.backend,
            expected_crop_style=LESION_CROP_STYLE,
            expected_prompt_signature=prompt_signature,
        )
        if cached:
            return cached
        prompt_box = self._pixel_prompt_box(record["image_path"], lesion_prompt_box)
        result = self.medsam_service.generate_lesion_roi(
            record["image_path"],
            mask_path,
            crop_path,
            prompt_box=prompt_box,
            expand_ratio=expand_ratio,
        )
        self._save_crop_metadata(
            metadata_path,
            result,
            crop_style=LESION_CROP_STYLE,
            prompt_signature=prompt_signature,
        )
        return {
            "lesion_mask_path": result["medsam_mask_path"],
            "lesion_crop_path": result["roi_crop_path"],
            "backend": result.get("backend", "unknown"),
            "crop_style": LESION_CROP_STYLE,
            "medsam_error": result.get("medsam_error"),
            "prompt_signature": prompt_signature,
        }

    def _prepare_records_for_model(
        self,
        site_store: SiteStore,
        records: list[dict[str, Any]],
        crop_mode: str,
    ) -> list[dict[str, Any]]:
        prepared: list[dict[str, Any]] = []
        normalized_crop_mode = self._normalize_crop_mode(crop_mode)
        if normalized_crop_mode == "manual":
            records = [record for record in records if isinstance(record.get("lesion_prompt_box"), dict)]
            if not records:
                raise ValueError("Manual lesion crop requires at least one saved lesion box.")

        for record in records:
            item = {**record, "source_image_path": record["image_path"]}
            if normalized_crop_mode == "automated":
                roi = self._ensure_roi_crop(site_store, record["image_path"])
                item["medsam_mask_path"] = roi["medsam_mask_path"]
                item["roi_crop_path"] = roi["roi_crop_path"]
                item["image_path"] = roi["roi_crop_path"]
                item["crop_mode"] = "automated"
            elif normalized_crop_mode == "manual":
                lesion = self._ensure_lesion_crop(site_store, record)
                item["lesion_mask_path"] = lesion["lesion_mask_path"]
                item["lesion_crop_path"] = lesion["lesion_crop_path"]
                item["image_path"] = lesion["lesion_crop_path"]
                item["crop_mode"] = "manual"
            prepared.append(item)
        return prepared

    def _select_representative_record(self, records: list[dict[str, Any]]) -> dict[str, Any]:
        representative = next((item for item in records if item.get("is_representative")), None)
        return representative or records[0]

    def _normalize_metadata_text(self, value: Any) -> str:
        return str(value or "").strip().lower()

    def _normalize_predisposing_factors(self, value: Any) -> list[str]:
        if isinstance(value, list):
            raw_items = value
        else:
            raw_items = str(value or "").split("|")
        normalized = [str(item).strip().lower() for item in raw_items if str(item).strip()]
        seen: set[str] = set()
        ordered: list[str] = []
        for item in normalized:
            if item in seen:
                continue
            seen.add(item)
            ordered.append(item)
        return ordered

    def _representative_quality_scores(
        self,
        representative_record: dict[str, Any],
        quality_cache: dict[str, dict[str, Any] | None],
    ) -> dict[str, Any] | None:
        image_path = str(representative_record.get("image_path") or "").strip()
        if not image_path:
            return None
        if image_path not in quality_cache:
            try:
                quality_cache[image_path] = score_slit_lamp_image(
                    image_path,
                    view=representative_record.get("view"),
                )
            except Exception:
                quality_cache[image_path] = None
        return quality_cache[image_path]

    def _case_metadata_snapshot(
        self,
        summary: dict[str, Any],
        case_records: list[dict[str, Any]],
        quality_cache: dict[str, dict[str, Any] | None],
    ) -> dict[str, Any]:
        representative = self._select_representative_record(case_records)
        quality_scores = self._representative_quality_scores(representative, quality_cache)
        predisposing = self._normalize_predisposing_factors(
            summary.get("predisposing_factor")
            if summary.get("predisposing_factor") is not None
            else representative.get("predisposing_factor")
        )
        return {
            "sex": str(summary.get("sex") or representative.get("sex") or "").strip(),
            "age": summary.get("age"),
            "representative_view": str(
                summary.get("representative_view")
                or representative.get("view")
                or ""
            ).strip(),
            "visit_status": str(summary.get("visit_status") or representative.get("visit_status") or "").strip(),
            "active_stage": bool(
                summary.get("active_stage")
                if summary.get("active_stage") is not None
                else representative.get("active_stage", str(summary.get("visit_status") or "").strip().lower() == "active")
            ),
            "is_initial_visit": bool(summary.get("is_initial_visit", representative.get("is_initial_visit", False))),
            "contact_lens_use": str(summary.get("contact_lens_use") or representative.get("contact_lens_use") or "").strip(),
            "predisposing_factor": predisposing,
            "smear_result": str(summary.get("smear_result") or representative.get("smear_result") or "").strip(),
            "polymicrobial": bool(summary.get("polymicrobial", representative.get("polymicrobial", False))),
            "additional_organisms": list(summary.get("additional_organisms") or representative.get("additional_organisms") or []),
            "other_history": str(summary.get("other_history") or representative.get("other_history") or "").strip(),
            "image_count": int(summary.get("image_count") or len(case_records)),
            "quality_score": quality_scores.get("quality_score") if quality_scores else None,
            "view_score": quality_scores.get("view_score") if quality_scores else None,
        }

    def _metadata_alignment(
        self,
        query_metadata: dict[str, Any],
        candidate_metadata: dict[str, Any],
    ) -> dict[str, list[str]]:
        matched_fields: list[str] = []
        conflicted_fields: list[str] = []

        for field_name in ("representative_view", "visit_status", "contact_lens_use", "smear_result"):
            query_value = self._normalize_metadata_text(query_metadata.get(field_name))
            candidate_value = self._normalize_metadata_text(candidate_metadata.get(field_name))
            if not query_value or not candidate_value:
                continue
            if query_value == candidate_value:
                matched_fields.append(field_name)
            else:
                conflicted_fields.append(field_name)

        query_active_stage = query_metadata.get("active_stage")
        candidate_active_stage = candidate_metadata.get("active_stage")
        if isinstance(query_active_stage, bool) and isinstance(candidate_active_stage, bool):
            if query_active_stage == candidate_active_stage:
                matched_fields.append("active_stage")
            else:
                conflicted_fields.append("active_stage")

        query_polymicrobial = query_metadata.get("polymicrobial")
        candidate_polymicrobial = candidate_metadata.get("polymicrobial")
        if isinstance(query_polymicrobial, bool) and isinstance(candidate_polymicrobial, bool):
            if query_polymicrobial == candidate_polymicrobial:
                matched_fields.append("polymicrobial")
            else:
                conflicted_fields.append("polymicrobial")

        query_factors = set(self._normalize_predisposing_factors(query_metadata.get("predisposing_factor")))
        candidate_factors = set(self._normalize_predisposing_factors(candidate_metadata.get("predisposing_factor")))
        if query_factors and candidate_factors:
            if query_factors.intersection(candidate_factors):
                matched_fields.append("predisposing_factor")
            else:
                conflicted_fields.append("predisposing_factor")

        return {
            "matched_fields": matched_fields,
            "conflicted_fields": conflicted_fields,
        }

    def _metadata_reranking_adjustment(
        self,
        query_metadata: dict[str, Any],
        candidate_metadata: dict[str, Any],
    ) -> dict[str, Any]:
        adjustment = 0.0
        details: dict[str, float] = {}

        query_view = self._normalize_metadata_text(query_metadata.get("representative_view"))
        candidate_view = self._normalize_metadata_text(candidate_metadata.get("representative_view"))
        if query_view and candidate_view:
            value = 0.03 if query_view == candidate_view else -0.01
            details["view"] = round(value, 4)
            adjustment += value

        query_active = query_metadata.get("active_stage")
        candidate_active = candidate_metadata.get("active_stage")
        if isinstance(query_active, bool) and isinstance(candidate_active, bool):
            value = 0.02 if query_active == candidate_active else -0.04
            details["active_stage"] = round(value, 4)
            adjustment += value

        query_status = self._normalize_metadata_text(query_metadata.get("visit_status"))
        candidate_status = self._normalize_metadata_text(candidate_metadata.get("visit_status"))
        if query_status and candidate_status:
            value = 0.015 if query_status == candidate_status else -0.015
            details["visit_status"] = round(value, 4)
            adjustment += value

        quality_score = candidate_metadata.get("quality_score")
        if isinstance(quality_score, (int, float)):
            if quality_score < 35:
                value = -0.03
            elif quality_score < 50:
                value = -0.015
            else:
                value = 0.005
            details["quality_score"] = round(value, 4)
            adjustment += value

        query_contact_lens = self._normalize_metadata_text(query_metadata.get("contact_lens_use"))
        candidate_contact_lens = self._normalize_metadata_text(candidate_metadata.get("contact_lens_use"))
        if query_contact_lens and candidate_contact_lens:
            value = 0.015 if query_contact_lens == candidate_contact_lens else -0.01
            details["contact_lens_use"] = round(value, 4)
            adjustment += value

        query_smear = self._normalize_metadata_text(query_metadata.get("smear_result"))
        candidate_smear = self._normalize_metadata_text(candidate_metadata.get("smear_result"))
        if query_smear and candidate_smear:
            value = 0.015 if query_smear == candidate_smear else -0.01
            details["smear_result"] = round(value, 4)
            adjustment += value

        query_polymicrobial = query_metadata.get("polymicrobial")
        candidate_polymicrobial = candidate_metadata.get("polymicrobial")
        if isinstance(query_polymicrobial, bool) and isinstance(candidate_polymicrobial, bool):
            value = 0.01 if query_polymicrobial == candidate_polymicrobial else -0.015
            details["polymicrobial"] = round(value, 4)
            adjustment += value

        query_factors = set(self._normalize_predisposing_factors(query_metadata.get("predisposing_factor")))
        candidate_factors = set(self._normalize_predisposing_factors(candidate_metadata.get("predisposing_factor")))
        if query_factors and candidate_factors:
            value = 0.02 if query_factors.intersection(candidate_factors) else -0.01
            details["predisposing_factor"] = round(value, 4)
            adjustment += value

        return {
            "adjustment": round(adjustment, 4),
            "details": details,
            "alignment": self._metadata_alignment(query_metadata, candidate_metadata),
        }

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
        image_probabilities: list[float] = []
        for record in prepared_records:
            prediction = self.model_manager.predict_image(model, record["image_path"], execution_device)
            image_probabilities.append(float(prediction.probability))
        predicted_probability = float(sum(image_probabilities) / len(image_probabilities))
        true_index = LABEL_TO_INDEX[str(case_records[0]["culture_category"])]
        decision_threshold = self._resolve_model_threshold(model_version)
        return {
            "patient_id": str(case_records[0]["patient_id"]),
            "visit_date": str(case_records[0]["visit_date"]),
            "true_index": true_index,
            "predicted_probability": predicted_probability,
            "predicted_index": 1 if predicted_probability >= decision_threshold else 0,
            "decision_threshold": decision_threshold,
            "crop_mode": crop_mode,
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

    def _compute_image_qa_metrics(self, image_path: str) -> dict[str, Any]:
        with Image.open(image_path) as image:
            normalized = ImageOps.exif_transpose(image)
            grayscale = normalized.convert("L")
            luminance = ImageStat.Stat(grayscale)
            edges = grayscale.filter(ImageFilter.FIND_EDGES)
            edge_stats = ImageStat.Stat(edges)
            return {
                "width": int(normalized.width),
                "height": int(normalized.height),
                "mean_brightness": round(float(luminance.mean[0]), 3),
                "contrast_stddev": round(float(luminance.stddev[0]), 3),
                "edge_density": round(float(edge_stats.mean[0]), 3),
            }

    def _write_review_thumbnail(
        self,
        source_path: str,
        output_path: Path,
        *,
        max_size: tuple[int, int] = (320, 320),
    ) -> str:
        ensure_dir(output_path.parent)
        with Image.open(source_path) as image:
            normalized = ImageOps.exif_transpose(image)
            thumbnail = normalized.copy()
            thumbnail.thumbnail(max_size)
            suffix = output_path.suffix.lower()
            if suffix == ".png":
                if thumbnail.mode not in {"RGB", "RGBA", "L"}:
                    thumbnail = thumbnail.convert("RGBA" if "A" in thumbnail.getbands() else "RGB")
                thumbnail.save(output_path, format="PNG")
            else:
                if thumbnail.mode not in {"RGB", "L"}:
                    thumbnail = thumbnail.convert("RGB")
                thumbnail.save(output_path, format="JPEG", quality=88, optimize=True)
        return str(output_path)

    def _build_embedded_review_artifact(
        self,
        source_path: str,
        output_path: Path,
        *,
        max_size: tuple[int, int],
    ) -> dict[str, Any] | None:
        if not source_path or not Path(source_path).exists():
            return None
        saved_path = self._write_review_thumbnail(source_path, output_path, max_size=max_size)
        thumbnail_bytes = Path(saved_path).read_bytes()
        media_type = "image/png" if output_path.suffix.lower() == ".png" else "image/jpeg"
        return {
            "media_type": media_type,
            "encoding": "base64",
            "bytes_b64": base64.b64encode(thumbnail_bytes).decode("ascii"),
        }

    def _build_approval_report(
        self,
        site_store: SiteStore,
        case_records: list[dict[str, Any]],
        prepared_records: list[dict[str, Any]],
        update_id: str,
        patient_id: str,
        visit_date: str,
    ) -> tuple[dict[str, Any], Path]:
        case_reference_id = self.control_plane.case_reference_id(site_store.site_id, patient_id, visit_date)
        representative = self._select_representative_record(case_records)
        prepared_representative = next(
            (
                item
                for item in prepared_records
                if item.get("source_image_path") == representative.get("image_path")
            ),
            prepared_records[0],
        )

        review_dir = site_store.update_dir / update_id
        source_thumb_path = review_dir / "source_thumbnail.jpg"
        roi_thumb_path = review_dir / "roi_thumbnail.jpg"
        mask_thumb_path = review_dir / "mask_thumbnail.png"

        artifacts: dict[str, dict[str, Any] | None] = {
            "source_thumbnail": None,
            "roi_thumbnail": None,
            "mask_thumbnail": None,
        }

        source_image_path = str(representative.get("image_path") or "")
        source_thumb = self._build_embedded_review_artifact(
            source_image_path,
            source_thumb_path,
            max_size=(128, 128),
        )
        if source_thumb:
            artifacts["source_thumbnail"] = source_thumb

        roi_crop_path = str(prepared_representative.get("roi_crop_path") or prepared_representative.get("lesion_crop_path") or "")
        roi_thumb = self._build_embedded_review_artifact(
            roi_crop_path,
            roi_thumb_path,
            max_size=(320, 320),
        )
        if roi_thumb:
            artifacts["roi_thumbnail"] = roi_thumb

        medsam_mask_path = str(prepared_representative.get("medsam_mask_path") or prepared_representative.get("lesion_mask_path") or "")
        mask_thumb = self._build_embedded_review_artifact(
            medsam_mask_path,
            mask_thumb_path,
            max_size=(320, 320),
        )
        if mask_thumb:
            artifacts["mask_thumbnail"] = mask_thumb

        source_metrics = self._compute_image_qa_metrics(source_image_path) if source_image_path else {}
        roi_metrics = self._compute_image_qa_metrics(roi_crop_path) if roi_crop_path else {}
        mask_metrics = self._compute_image_qa_metrics(medsam_mask_path) if medsam_mask_path else {}

        roi_area_ratio = None
        if source_metrics and roi_metrics:
            source_area = max(1, int(source_metrics["width"]) * int(source_metrics["height"]))
            roi_area = int(roi_metrics["width"]) * int(roi_metrics["height"])
            roi_area_ratio = round(float(roi_area / source_area), 4)

        report = {
            "report_id": make_id("approval"),
            "update_id": update_id,
            "site_id": site_store.site_id,
            "case_reference_id": case_reference_id,
            "generated_at": utc_now(),
            "case_summary": {
                "image_count": len(case_records),
                "representative_view": representative.get("view"),
                "views": [str(item.get("view") or "unknown") for item in case_records],
                "culture_category": representative.get("culture_category"),
                "culture_species": representative.get("culture_species"),
                "is_single_case_delta": True,
            },
            "qa_metrics": {
                "source": source_metrics,
                "roi_crop": roi_metrics,
                "medsam_mask": mask_metrics,
                "roi_area_ratio": roi_area_ratio,
            },
            "privacy_controls": {
                "source_thumbnail_max_side_px": 128,
                "derived_thumbnail_max_side_px": 320,
                "upload_exif_removed": True,
                "stored_filename_policy": "randomized_image_id_only",
                "review_media_policy": "thumbnail_only_for_admin_review",
            },
            "artifacts": artifacts,
        }
        report_path = review_dir / "approval_report.json"
        write_json(report_path, report)
        return report, report_path

    def _compute_delta_quality_summary(self, delta_path: str | Path) -> dict[str, Any]:
        try:
            require_torch()
            checkpoint = torch.load(delta_path, map_location="cpu", weights_only=True)
            delta_state = checkpoint.get("state_dict") if isinstance(checkpoint, dict) else None
            if not isinstance(delta_state, dict):
                raise ValueError("Delta file has no readable state_dict.")
            self.model_manager._validate_deltas([delta_state])
            total_norm = 0.0
            parameter_count = 0
            for tensor in delta_state.values():
                t = tensor.float()
                total_norm += float(t.norm().item()) ** 2
                parameter_count += int(t.numel())
            l2_norm = total_norm ** 0.5
            return {
                "score": 25,
                "status": "ok",
                "flags": [],
                "l2_norm": round(float(l2_norm), 6),
                "parameter_count": parameter_count,
                "message": "Delta integrity and norm look valid.",
            }
        except Exception as exc:
            return {
                "score": 0,
                "status": "invalid",
                "flags": ["delta_invalid"],
                "l2_norm": None,
                "parameter_count": None,
                "message": str(exc),
            }

    def _build_update_quality_summary(
        self,
        site_store: SiteStore,
        case_records: list[dict[str, Any]],
        model_version: dict[str, Any],
        execution_device: str,
        delta_path: str | Path,
        approval_report: dict[str, Any],
    ) -> dict[str, Any]:
        qa_metrics = approval_report.get("qa_metrics") if isinstance(approval_report, dict) else {}
        source_metrics = qa_metrics.get("source") if isinstance(qa_metrics, dict) else {}
        roi_area_ratio = qa_metrics.get("roi_area_ratio") if isinstance(qa_metrics, dict) else None

        image_flags: list[str] = []
        image_strengths: list[str] = []
        brightness = float(source_metrics.get("mean_brightness", 0.0) or 0.0)
        contrast = float(source_metrics.get("contrast_stddev", 0.0) or 0.0)
        edge_density = float(source_metrics.get("edge_density", 0.0) or 0.0)
        image_score = 25
        if brightness and (brightness < 35 or brightness > 225):
            image_flags.append("brightness_out_of_range")
            image_score -= 8
        else:
            image_strengths.append("brightness_ok")
        if contrast and contrast < 18:
            image_flags.append("low_contrast")
            image_score -= 8
        else:
            image_strengths.append("contrast_ok")
        if edge_density and edge_density < 5:
            image_flags.append("low_edge_density")
            image_score -= 9
        else:
            image_strengths.append("edge_density_ok")
        image_score = max(0, image_score)

        crop_flags: list[str] = []
        crop_strengths: list[str] = []
        crop_score = 25
        if roi_area_ratio is None:
            crop_flags.append("crop_ratio_missing")
            crop_score -= 12
        else:
            ratio_value = float(roi_area_ratio)
            if ratio_value < 0.03:
                crop_flags.append("crop_too_tight")
                crop_score -= 12
            elif ratio_value > 0.95:
                crop_flags.append("crop_too_wide")
                crop_score -= 12
            else:
                crop_strengths.append("crop_ratio_ok")
        crop_score = max(0, crop_score)

        validation_result = self._predict_case(
            site_store,
            case_records,
            model_version,
            execution_device,
            generate_gradcam=False,
            generate_medsam=False,
        )
        validation_flags: list[str] = []
        validation_strengths: list[str] = []
        validation_score = 25 if bool(validation_result.get("predicted_index")) == bool(validation_result.get("true_index")) else 8
        if validation_result.get("predicted_index") == validation_result.get("true_index"):
            validation_strengths.append("validation_match")
            validation_status = "match"
        else:
            validation_flags.append("validation_mismatch")
            validation_status = "mismatch"

        delta_summary = self._compute_delta_quality_summary(delta_path)

        policy_flags: list[str] = []
        policy_score = 25
        has_additional_organisms = any(bool(record.get("additional_organisms")) for record in case_records)
        if has_additional_organisms:
            policy_flags.append("polymicrobial_excluded")
            policy_score = 0

        strengths = image_strengths + crop_strengths + validation_strengths
        risk_flags = image_flags + crop_flags + validation_flags + list(delta_summary.get("flags") or []) + policy_flags
        total_score = max(0, min(100, image_score + crop_score + validation_score + int(delta_summary.get("score") or 0) + policy_score))
        if "delta_invalid" in risk_flags or "polymicrobial_excluded" in risk_flags:
            recommendation = "reject_candidate"
        elif total_score >= 80:
            recommendation = "approve_candidate"
        elif total_score >= 60:
            recommendation = "needs_review"
        else:
            recommendation = "reject_candidate"

        return {
            "quality_score": total_score,
            "recommendation": recommendation,
            "image_quality": {
                "score": image_score,
                "status": "ok" if not image_flags else "review",
                "flags": image_flags,
                "mean_brightness": round(brightness, 3) if brightness else None,
                "contrast_stddev": round(contrast, 3) if contrast else None,
                "edge_density": round(edge_density, 3) if edge_density else None,
            },
            "crop_quality": {
                "score": crop_score,
                "status": "ok" if not crop_flags else "review",
                "flags": crop_flags,
                "roi_area_ratio": round(float(roi_area_ratio), 4) if roi_area_ratio is not None else None,
            },
            "delta_quality": delta_summary,
            "validation_consistency": {
                "score": validation_score,
                "status": validation_status,
                "flags": validation_flags,
                "predicted_label": INDEX_TO_LABEL[int(validation_result["predicted_index"])],
                "true_label": INDEX_TO_LABEL[int(validation_result["true_index"])],
                "prediction_probability": round(float(validation_result["predicted_probability"]), 4),
                "decision_threshold": round(float(validation_result.get("decision_threshold") or 0.5), 4),
                "is_correct": bool(validation_result["predicted_index"] == validation_result["true_index"]),
            },
            "policy_checks": {
                "score": policy_score,
                "status": "blocked" if policy_flags else "ok",
                "flags": policy_flags,
                "has_additional_organisms": has_additional_organisms,
                "training_policy": "exclude_polymicrobial",
            },
            "risk_flags": risk_flags,
            "strengths": strengths,
        }

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
            raw_weights = [float(weight_map.get(component.get("crop_mode") or "automated", 0.5)) for component in components]
        else:
            raw_weights = [0.5 for _ in components]
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
        return self.vector_index.rebuild_index(
            site_store,
            model_version_id=str(model_version.get("version_id") or "unknown"),
            backend=backend,
        )

    def case_vector_index_exists(
        self,
        site_store: SiteStore,
        *,
        model_version: dict[str, Any],
        backend: str,
    ) -> bool:
        return self.vector_index.index_exists(
            site_store,
            model_version_id=str(model_version.get("version_id") or "unknown"),
            backend=backend,
        )

    def list_cases_requiring_embedding(
        self,
        site_store: SiteStore,
        *,
        model_version: dict[str, Any],
        backend: str = "classifier",
    ) -> list[dict[str, Any]]:
        records_by_case: dict[tuple[str, str], list[dict[str, Any]]] = {}
        for record in site_store.dataset_records():
            patient_id = str(record.get("patient_id") or "")
            visit_date = str(record.get("visit_date") or "")
            if not patient_id or not visit_date:
                continue
            records_by_case.setdefault((patient_id, visit_date), []).append(record)

        missing_cases: list[dict[str, Any]] = []
        for summary in site_store.list_case_summaries():
            patient_id = str(summary.get("patient_id") or "")
            visit_date = str(summary.get("visit_date") or "")
            case_records = records_by_case.get((patient_id, visit_date), [])
            if not case_records:
                continue
            signature = self._case_embedding_signature(case_records, model_version, backend=backend)
            cached = self._load_cached_case_embedding(
                site_store,
                patient_id=patient_id,
                visit_date=visit_date,
                model_version=model_version,
                signature=signature,
                backend=backend,
            )
            if cached is None:
                missing_cases.append(summary)
        return missing_cases

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
        case_records = [
            item
            for item in site_store.dataset_records()
            if str(item.get("patient_id") or "") == patient_id
            and str(item.get("visit_date") or "") == visit_date
        ]
        if not case_records:
            raise ValueError("Selected case is not available for embedding indexing.")
        classifier_embedding = self._prepare_case_embedding(
            site_store,
            case_records,
            model_version,
            execution_device,
            force_refresh=force_refresh,
        )
        available_backends = ["classifier"]
        embedding_dims = {"classifier": int(classifier_embedding.size)}
        dinov2_error: str | None = None
        try:
            dinov2_embedding = self._prepare_case_dinov2_embedding(
                site_store,
                case_records,
                model_version,
                execution_device,
                force_refresh=force_refresh,
            )
            available_backends.append("dinov2")
            embedding_dims["dinov2"] = int(dinov2_embedding.size)
        except Exception as exc:
            dinov2_error = str(exc)
        vector_index: dict[str, Any] | None = None
        vector_index_error: str | None = None
        if update_index:
            try:
                vector_index = {
                    "classifier": self.rebuild_case_vector_index(
                        site_store,
                        model_version=model_version,
                        backend="classifier",
                    )
                }
                if "dinov2" in available_backends:
                    vector_index["dinov2"] = self.rebuild_case_vector_index(
                        site_store,
                        model_version=model_version,
                        backend="dinov2",
                    )
            except Exception as exc:
                vector_index_error = str(exc)
        return {
            "case_id": f"{patient_id}::{visit_date}",
            "patient_id": patient_id,
            "visit_date": visit_date,
            "model_version_id": model_version.get("version_id"),
            "model_version_name": model_version.get("version_name"),
            "embedding_dim": int(classifier_embedding.size),
            "embedding_dims": embedding_dims,
            "available_backends": available_backends,
            "dinov2_error": dinov2_error,
            "vector_index": vector_index,
            "vector_index_error": vector_index_error,
            "execution_device": execution_device,
            "status": "refreshed" if force_refresh else "cached",
        }

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
        retrieval_backend: str = "classifier",
    ) -> dict[str, Any]:
        normalized_top_k = max(1, min(int(top_k or 3), 10))
        requested_backend = str(retrieval_backend or "classifier").strip().lower()
        if requested_backend not in {"classifier", "dinov2", "hybrid"}:
            requested_backend = "classifier"
        records = site_store.dataset_records()
        if not records:
            raise ValueError("No dataset records are available for AI Clinic retrieval.")

        cases_by_key: dict[tuple[str, str], list[dict[str, Any]]] = {}
        for record in records:
            key = (str(record["patient_id"]), str(record["visit_date"]))
            cases_by_key.setdefault(key, []).append(record)

        query_key = (patient_id, visit_date)
        query_records = cases_by_key.get(query_key)
        if not query_records:
            raise ValueError("Selected case is not available for AI Clinic retrieval.")

        summaries_by_key = {
            (str(item["patient_id"]), str(item["visit_date"])): item
            for item in site_store.list_case_summaries()
        }
        query_summary = summaries_by_key.get(query_key, {})
        quality_cache: dict[str, dict[str, Any] | None] = {}
        query_metadata = self._case_metadata_snapshot(query_summary, query_records, quality_cache)
        loaded_models: dict[str, Any] = {}
        query_classifier_embedding: np.ndarray | None = None
        query_dinov2_embedding: np.ndarray | None = None
        retrieval_warning: str | None = None

        if requested_backend in {"classifier", "hybrid"}:
            query_classifier_embedding = self._prepare_case_embedding(
                site_store,
                query_records,
                model_version,
                execution_device,
                loaded_models=loaded_models,
            )
        if requested_backend in {"dinov2", "hybrid"}:
            try:
                query_dinov2_embedding = self._prepare_case_dinov2_embedding(
                    site_store,
                    query_records,
                    model_version,
                    execution_device,
                )
            except Exception as exc:
                if requested_backend == "dinov2":
                    query_classifier_embedding = self._prepare_case_embedding(
                        site_store,
                        query_records,
                        model_version,
                        execution_device,
                        loaded_models=loaded_models,
                    )
                    requested_backend = "classifier"
                    retrieval_warning = f"DINOv2 retrieval is unavailable and AI Clinic fell back to classifier retrieval. {exc}"
                else:
                    retrieval_warning = f"DINOv2 retrieval is unavailable and AI Clinic used classifier retrieval only. {exc}"

        candidates: list[dict[str, Any]] = []
        faiss_hits_by_backend: dict[str, dict[tuple[str, str], dict[str, Any]]] = {}
        faiss_backends_used: list[str] = []
        search_limit = max(normalized_top_k * 20, 50)
        for backend_name, query_embedding in (("classifier", query_classifier_embedding), ("dinov2", query_dinov2_embedding)):
            if query_embedding is None:
                continue
            try:
                hits = self._faiss_backend_hits(
                    site_store,
                    model_version=model_version,
                    backend=backend_name,
                    query_embedding=query_embedding,
                    top_k=search_limit,
                )
                faiss_hits_by_backend[backend_name] = {
                    (str(item.get("patient_id") or ""), str(item.get("visit_date") or "")): item
                    for item in hits
                }
                faiss_backends_used.append(backend_name)
            except Exception:
                continue

        candidate_keys: list[tuple[str, str]] = []
        if requested_backend == "classifier" and "classifier" in faiss_hits_by_backend:
            candidate_keys = list(faiss_hits_by_backend["classifier"].keys())
        elif requested_backend == "dinov2" and "dinov2" in faiss_hits_by_backend:
            candidate_keys = list(faiss_hits_by_backend["dinov2"].keys())
        elif requested_backend == "hybrid" and faiss_hits_by_backend:
            merged_keys = {
                *faiss_hits_by_backend.get("classifier", {}).keys(),
                *faiss_hits_by_backend.get("dinov2", {}).keys(),
            }
            candidate_keys = list(merged_keys)

        if candidate_keys:
            for case_key in candidate_keys:
                candidate_patient_id, candidate_visit_date = case_key
                if case_key == query_key or candidate_patient_id == patient_id:
                    continue
                summary = summaries_by_key.get(case_key)
                if summary is None or not summary.get("representative_image_id"):
                    continue
                similarity_components: dict[str, float] = {}
                classifier_hit = faiss_hits_by_backend.get("classifier", {}).get(case_key)
                dinov2_hit = faiss_hits_by_backend.get("dinov2", {}).get(case_key)
                if classifier_hit is not None:
                    similarity_components["classifier"] = float(classifier_hit["similarity"])
                elif query_classifier_embedding is not None:
                    vector = self._load_cached_case_embedding_vector(
                        site_store,
                        patient_id=candidate_patient_id,
                        visit_date=candidate_visit_date,
                        model_version=model_version,
                        backend="classifier",
                    )
                    if vector is not None:
                        similarity_components["classifier"] = float(np.dot(query_classifier_embedding, vector))
                if dinov2_hit is not None:
                    similarity_components["dinov2"] = float(dinov2_hit["similarity"])
                elif query_dinov2_embedding is not None:
                    vector = self._load_cached_case_embedding_vector(
                        site_store,
                        patient_id=candidate_patient_id,
                        visit_date=candidate_visit_date,
                        model_version=model_version,
                        backend="dinov2",
                    )
                    if vector is not None:
                        similarity_components["dinov2"] = float(np.dot(query_dinov2_embedding, vector))
                if not similarity_components:
                    continue
                base_similarity = float(np.mean(list(similarity_components.values())))
                candidate_records = cases_by_key.get(case_key, [])
                candidate_metadata = self._case_metadata_snapshot(summary, candidate_records, quality_cache)
                metadata_reranking = self._metadata_reranking_adjustment(query_metadata, candidate_metadata)
                similarity = max(-1.0, min(1.0, base_similarity + float(metadata_reranking["adjustment"])))
                candidates.append(
                    {
                        "patient_id": candidate_patient_id,
                        "visit_date": candidate_visit_date,
                        "case_id": summary["case_id"],
                        "representative_image_id": summary.get("representative_image_id"),
                        "representative_view": summary.get("representative_view"),
                        "chart_alias": summary.get("chart_alias", ""),
                        "local_case_code": summary.get("local_case_code", ""),
                        "culture_category": summary.get("culture_category", ""),
                        "culture_species": summary.get("culture_species", ""),
                        "image_count": int(summary.get("image_count") or 0),
                        "visit_status": summary.get("visit_status", ""),
                        "active_stage": bool(summary.get("active_stage", candidate_metadata.get("active_stage", False))),
                        "sex": candidate_metadata.get("sex"),
                        "age": candidate_metadata.get("age"),
                        "contact_lens_use": candidate_metadata.get("contact_lens_use"),
                        "predisposing_factor": candidate_metadata.get("predisposing_factor"),
                        "smear_result": candidate_metadata.get("smear_result"),
                        "polymicrobial": candidate_metadata.get("polymicrobial"),
                        "quality_score": candidate_metadata.get("quality_score"),
                        "view_score": candidate_metadata.get("view_score"),
                        "metadata_reranking": metadata_reranking,
                        "base_similarity": round(base_similarity, 4),
                        "similarity": round(similarity, 4),
                        "classifier_similarity": round(similarity_components["classifier"], 4) if "classifier" in similarity_components else None,
                        "dinov2_similarity": round(similarity_components["dinov2"], 4) if "dinov2" in similarity_components else None,
                    }
                )
        else:
            for case_key, case_records in cases_by_key.items():
                candidate_patient_id, candidate_visit_date = case_key
                if case_key == query_key or candidate_patient_id == patient_id:
                    continue
                summary = summaries_by_key.get(case_key)
                if summary is None or not summary.get("representative_image_id"):
                    continue
                similarity_components: dict[str, float] = {}
                try:
                    if query_classifier_embedding is not None:
                        candidate_embedding = self._prepare_case_embedding(
                            site_store,
                            case_records,
                            model_version,
                            execution_device,
                            loaded_models=loaded_models,
                        )
                        similarity_components["classifier"] = float(np.dot(query_classifier_embedding, candidate_embedding))
                    if query_dinov2_embedding is not None:
                        candidate_dinov2_embedding = self._prepare_case_dinov2_embedding(
                            site_store,
                            case_records,
                            model_version,
                            execution_device,
                        )
                        similarity_components["dinov2"] = float(np.dot(query_dinov2_embedding, candidate_dinov2_embedding))
                except ValueError:
                    continue
                if not similarity_components:
                    continue
                base_similarity = float(np.mean(list(similarity_components.values())))
                candidate_metadata = self._case_metadata_snapshot(summary, case_records, quality_cache)
                metadata_reranking = self._metadata_reranking_adjustment(query_metadata, candidate_metadata)
                similarity = max(-1.0, min(1.0, base_similarity + float(metadata_reranking["adjustment"])))
                candidates.append(
                    {
                        "patient_id": candidate_patient_id,
                        "visit_date": candidate_visit_date,
                        "case_id": summary["case_id"],
                        "representative_image_id": summary.get("representative_image_id"),
                        "representative_view": summary.get("representative_view"),
                        "chart_alias": summary.get("chart_alias", ""),
                        "local_case_code": summary.get("local_case_code", ""),
                        "culture_category": summary.get("culture_category", ""),
                        "culture_species": summary.get("culture_species", ""),
                        "image_count": int(summary.get("image_count") or 0),
                        "visit_status": summary.get("visit_status", ""),
                        "active_stage": bool(summary.get("active_stage", candidate_metadata.get("active_stage", False))),
                        "sex": candidate_metadata.get("sex"),
                        "age": candidate_metadata.get("age"),
                        "contact_lens_use": candidate_metadata.get("contact_lens_use"),
                        "predisposing_factor": candidate_metadata.get("predisposing_factor"),
                        "smear_result": candidate_metadata.get("smear_result"),
                        "polymicrobial": candidate_metadata.get("polymicrobial"),
                        "quality_score": candidate_metadata.get("quality_score"),
                        "view_score": candidate_metadata.get("view_score"),
                        "metadata_reranking": metadata_reranking,
                        "base_similarity": round(base_similarity, 4),
                        "similarity": round(similarity, 4),
                        "classifier_similarity": round(similarity_components["classifier"], 4) if "classifier" in similarity_components else None,
                        "dinov2_similarity": round(similarity_components["dinov2"], 4) if "dinov2" in similarity_components else None,
                    }
                )

        candidates.sort(key=lambda item: item["similarity"], reverse=True)
        unique_patient_candidates: list[dict[str, Any]] = []
        seen_patient_ids: set[str] = set()
        for candidate in candidates:
            candidate_patient_id = str(candidate["patient_id"])
            if candidate_patient_id in seen_patient_ids:
                continue
            seen_patient_ids.add(candidate_patient_id)
            unique_patient_candidates.append(candidate)
            if len(unique_patient_candidates) >= normalized_top_k:
                break
        retrieval_mode = {
            "classifier": "classifier_penultimate_feature",
            "dinov2": "dinov2_visual_embedding",
            "hybrid": "hybrid_classifier_dinov2",
        }[requested_backend]
        return {
            "query_case": {
                "patient_id": patient_id,
                "visit_date": visit_date,
                "case_id": f"{patient_id}::{visit_date}",
                **query_metadata,
            },
            "model_version": {
                "version_id": model_version.get("version_id"),
                "version_name": model_version.get("version_name"),
                "architecture": model_version.get("architecture"),
                "crop_mode": self._resolve_model_crop_mode(model_version),
            },
            "execution_device": execution_device,
            "retrieval_mode": retrieval_mode,
            "vector_index_mode": "faiss_local" if candidate_keys else "brute_force_cache",
            "retrieval_backends_used": [key for key in ("classifier", "dinov2") if (key == "classifier" and query_classifier_embedding is not None) or (key == "dinov2" and query_dinov2_embedding is not None)],
            "retrieval_warning": retrieval_warning,
            "top_k": normalized_top_k,
            "eligible_candidate_count": len(candidates),
            "metadata_reranking": "enabled",
            "similar_cases": unique_patient_candidates,
        }

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
        normalized_top_k = max(1, min(int(top_k or 3), 10))
        records = site_store.dataset_records()
        if not records:
            raise ValueError("No dataset records are available for AI Clinic text retrieval.")

        cases_by_key: dict[tuple[str, str], list[dict[str, Any]]] = {}
        for record in records:
            key = (str(record["patient_id"]), str(record["visit_date"]))
            cases_by_key.setdefault(key, []).append(record)

        query_key = (patient_id, visit_date)
        query_records = cases_by_key.get(query_key)
        if not query_records:
            raise ValueError("Selected case is not available for AI Clinic text retrieval.")

        query_image_paths = self._query_image_paths_for_text_retrieval(site_store, query_records, model_version)
        summaries_by_key = {
            (str(item["patient_id"]), str(item["visit_date"])): item
            for item in site_store.list_case_summaries()
        }
        text_records: list[dict[str, Any]] = []
        for case_key, case_records in cases_by_key.items():
            candidate_patient_id, candidate_visit_date = case_key
            if case_key == query_key or candidate_patient_id == patient_id:
                continue
            summary = summaries_by_key.get(case_key)
            if summary is None:
                continue
            text_summary = self._build_case_text_summary(case_records)
            if not text_summary.strip():
                continue
            text_records.append(
                {
                    "case_id": summary["case_id"],
                    "patient_id": candidate_patient_id,
                    "visit_date": candidate_visit_date,
                    "culture_category": summary.get("culture_category", ""),
                    "culture_species": summary.get("culture_species", ""),
                    "local_case_code": summary.get("local_case_code", ""),
                    "chart_alias": summary.get("chart_alias", ""),
                    "text": text_summary,
                }
            )

        result = self.text_retriever.retrieve_texts(
            query_image_paths=query_image_paths,
            text_records=text_records,
            requested_device=execution_device,
            top_k=max(normalized_top_k * 2, normalized_top_k),
        )
        ranked_evidence = result.get("text_evidence") or []
        unique_patient_evidence: list[dict[str, Any]] = []
        seen_patient_ids: set[str] = set()
        for item in ranked_evidence:
            candidate_patient_id = str(item.get("patient_id") or "")
            if candidate_patient_id in seen_patient_ids:
                continue
            seen_patient_ids.add(candidate_patient_id)
            unique_patient_evidence.append(item)
            if len(unique_patient_evidence) >= normalized_top_k:
                break
        result["text_evidence"] = unique_patient_evidence
        return result

    def _latest_case_validation_context(
        self,
        site_id: str,
        *,
        patient_id: str,
        visit_date: str,
        model_version_id: str | None = None,
    ) -> dict[str, Any] | None:
        preferred_model_id = str(model_version_id or "").strip()
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
                        if str(item.get("patient_id") or "") == patient_id
                        and str(item.get("visit_date") or "") == visit_date
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
        retrieval_backend: str = "classifier",
    ) -> dict[str, Any]:
        report = self.run_ai_clinic_similar_cases(
            site_store,
            patient_id=patient_id,
            visit_date=visit_date,
            model_version=model_version,
            execution_device=execution_device,
            top_k=top_k,
            retrieval_backend=retrieval_backend,
        )
        try:
            text_report = self.run_ai_clinic_text_evidence(
                site_store,
                patient_id=patient_id,
                visit_date=visit_date,
                model_version=model_version,
                execution_device=execution_device,
                top_k=top_k,
            )
        except RuntimeError as exc:
            text_report = {
                "text_retrieval_mode": "unavailable",
                "text_embedding_model": None,
                "eligible_text_count": 0,
                "text_evidence": [],
                "text_retrieval_error": str(exc),
            }
        classification_context = self._latest_case_validation_context(
            site_store.site_id,
            patient_id=patient_id,
            visit_date=visit_date,
            model_version_id=str(model_version.get("version_id") or ""),
        )
        merged_report = {
            **report,
            **text_report,
        }
        differential = self.differential_ranker.rank(
            report=merged_report,
            classification_context=classification_context,
        )
        workflow_recommendation = self.ai_clinic_advisor.generate_workflow_recommendation(
            report={
                **merged_report,
                "differential": differential,
            },
            classification_context=classification_context,
        )

        return {
            **merged_report,
            "classification_context": classification_context,
            "differential": differential,
            "workflow_recommendation": workflow_recommendation,
        }

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
            "medsam_mask_path": None,
            "roi_crop_path": None,
            "lesion_mask_path": None,
            "lesion_crop_path": None,
        }
        if crop_mode == "automated" and generate_medsam:
            roi = self._ensure_roi_crop(site_store, artifact_row["image_path"])
            artifact_refs["medsam_mask_path"] = roi["medsam_mask_path"]
            artifact_refs["roi_crop_path"] = roi["roi_crop_path"]
        if crop_mode == "manual" and generate_medsam:
            lesion = self._ensure_lesion_crop(site_store, artifact_row)
            artifact_refs["lesion_mask_path"] = lesion["lesion_mask_path"]
            artifact_refs["lesion_crop_path"] = lesion["lesion_crop_path"]
        if generate_gradcam:
            artifact_name = Path(artifact_row["image_path"]).stem
            gradcam_path = self.model_manager.generate_explanation(
                model,
                model_reference,
                prepared_artifact["image_path"],
                execution_device,
                site_store.gradcam_dir / f"{artifact_name}_{crop_mode}_gradcam.png",
                target_class=predicted_index,
            )
            artifact_refs["gradcam_path"] = gradcam_path
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
        prepared_records = self._prepare_records_for_model(site_store, case_records, crop_mode=crop_mode)
        model = self.model_manager.load_model(model_version, execution_device)

        artifact_row = self._select_representative_record(case_records)
        prepared_artifact = next(
            (
                record
                for record in prepared_records
                if record["source_image_path"] == artifact_row["image_path"]
            ),
            prepared_records[0],
        )

        image_probabilities: list[float] = []
        for record in prepared_records:
            prediction = self.model_manager.predict_image(model, record["image_path"], execution_device)
            image_probabilities.append(prediction.probability)

        predicted_probability = float(sum(image_probabilities) / len(image_probabilities))
        decision_threshold = self._resolve_model_threshold(model_version)
        predicted_index = 1 if predicted_probability >= decision_threshold else 0
        true_index = LABEL_TO_INDEX[str(case_records[0]["culture_category"])]

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
            "n_source_images": len(case_records),
            "n_model_inputs": len(prepared_records),
            "component_model_version_id": model_version.get("version_id"),
            "component_model_version_name": model_version.get("version_name"),
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

        automated_prediction = next((item for item in component_predictions if item.get("crop_mode") == "automated"), None)
        manual_prediction = next((item for item in component_predictions if item.get("crop_mode") == "manual"), None)
        predicted_probability = float(
            sum(weight * float(prediction["predicted_probability"]) for weight, prediction in zip(weights, component_predictions))
        )
        decision_threshold = self._resolve_model_threshold(model_version)
        predicted_index = 1 if predicted_probability >= decision_threshold else 0
        true_index = int(component_predictions[0]["true_index"])

        merged_artifacts = {
            "gradcam_path": automated_prediction.get("gradcam_path") if automated_prediction else None,
            "medsam_mask_path": automated_prediction.get("medsam_mask_path") if automated_prediction else None,
            "roi_crop_path": automated_prediction.get("roi_crop_path") if automated_prediction else None,
            "lesion_mask_path": manual_prediction.get("lesion_mask_path") if manual_prediction else None,
            "lesion_crop_path": manual_prediction.get("lesion_crop_path") if manual_prediction else None,
        }

        return {
            "patient_id": str(case_records[0]["patient_id"]),
            "visit_date": str(case_records[0]["visit_date"]),
            "true_index": true_index,
            "predicted_index": predicted_index,
            "predicted_probability": predicted_probability,
            "decision_threshold": decision_threshold,
            "crop_mode": "both",
            "n_source_images": len(case_records),
            "n_model_inputs": sum(int(item.get("n_model_inputs", 0)) for item in component_predictions),
            "ensemble_component_predictions": component_predictions,
            "ensemble_weights": {
                (component.get("crop_mode") or self._resolve_model_crop_mode(component)): round(weight, 4)
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
                    "n_source_images": case_result.get("n_source_images"),
                    "n_model_inputs": case_result.get("n_model_inputs"),
                    "ensemble_weights": case_result.get("ensemble_weights"),
                    "ensemble_component_predictions": case_result.get("ensemble_component_predictions"),
                    "gradcam_path": case_result.get("gradcam_path"),
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
        """단일 케이스(환자 1명, 방문 1회)에 대해 즉시 검증을 수행합니다."""
        manifest_df = site_store.generate_manifest()
        case_df = manifest_df[
            (manifest_df["patient_id"] == patient_id)
            & (manifest_df["visit_date"] == visit_date)
        ]
        if case_df.empty:
            raise ValueError(f"No images found for patient {patient_id} / {visit_date}.")

        case_result = self._predict_case(
            site_store,
            case_df.to_dict("records"),
            model_version,
            execution_device,
            generate_gradcam=generate_gradcam,
            generate_medsam=generate_medsam,
        )
        predicted_probability = float(case_result["predicted_probability"])
        predicted_index = int(case_result["predicted_index"])
        true_index = int(case_result["true_index"])

        validation_id = make_id("validation")
        case_prediction: dict[str, Any] = {
            "validation_id": validation_id,
            "patient_id": patient_id,
            "visit_date": visit_date,
            "true_label": INDEX_TO_LABEL[true_index],
            "predicted_label": INDEX_TO_LABEL[predicted_index],
            "prediction_probability": predicted_probability,
            "is_correct": bool(true_index == predicted_index),
            "crop_mode": case_result.get("crop_mode"),
            "n_source_images": case_result.get("n_source_images"),
            "n_model_inputs": case_result.get("n_model_inputs"),
            "ensemble_weights": case_result.get("ensemble_weights"),
            "ensemble_component_predictions": case_result.get("ensemble_component_predictions"),
            "gradcam_path": case_result.get("gradcam_path"),
            "medsam_mask_path": case_result.get("medsam_mask_path"),
            "roi_crop_path": case_result.get("roi_crop_path"),
            "lesion_mask_path": case_result.get("lesion_mask_path"),
            "lesion_crop_path": case_result.get("lesion_crop_path"),
        }

        summary: dict[str, Any] = {
            "validation_id": validation_id,
            "project_id": project_id,
            "site_id": site_store.site_id,
            "model_version": model_version["version_name"],
            "model_version_id": model_version["version_id"],
            "model_architecture": model_version.get("architecture", "densenet121"),
            "crop_mode": case_result.get("crop_mode"),
            "run_date": utc_now(),
            "patient_id": patient_id,
            "visit_date": visit_date,
            "n_images": int(len(case_df)),
            "n_model_inputs": int(case_result.get("n_model_inputs", len(case_df))),
            "predicted_label": INDEX_TO_LABEL[predicted_index],
            "true_label": INDEX_TO_LABEL[true_index],
            "is_correct": bool(true_index == predicted_index),
            "prediction_probability": predicted_probability,
            "ensemble_weights": case_result.get("ensemble_weights"),
        }
        saved_summary = self.control_plane.save_validation_run(summary, [case_prediction])
        return saved_summary, [case_prediction]

    def preview_case_roi(
        self,
        site_store: SiteStore,
        patient_id: str,
        visit_date: str,
    ) -> list[dict[str, Any]]:
        """Generate MedSAM ROI previews for a single visit without requiring a model."""
        manifest_df = site_store.generate_manifest()
        case_df = manifest_df[
            (manifest_df["patient_id"] == patient_id)
            & (manifest_df["visit_date"] == visit_date)
        ]
        if case_df.empty:
            raise ValueError(f"No images found for patient {patient_id} / {visit_date}.")

        previews: list[dict[str, Any]] = []
        for record in case_df.to_dict("records"):
            roi = self._ensure_roi_crop(site_store, record["image_path"])
            previews.append(
                {
                    "patient_id": patient_id,
                    "visit_date": visit_date,
                    "view": record.get("view", "unknown"),
                    "is_representative": bool(record.get("is_representative")),
                    "source_image_path": record["image_path"],
                    "medsam_mask_path": roi["medsam_mask_path"],
                    "roi_crop_path": roi["roi_crop_path"],
                    "backend": roi.get("backend", "unknown"),
                    "medsam_error": roi.get("medsam_error"),
                }
            )
        previews.sort(
            key=lambda item: (
                not item["is_representative"],
                item["view"],
                item["source_image_path"],
            )
        )
        return previews

    def preview_case_lesion(
        self,
        site_store: SiteStore,
        patient_id: str,
        visit_date: str,
    ) -> list[dict[str, Any]]:
        manifest_df = site_store.generate_manifest()
        case_df = manifest_df[
            (manifest_df["patient_id"] == patient_id)
            & (manifest_df["visit_date"] == visit_date)
        ]
        if case_df.empty:
            raise ValueError(f"No images found for patient {patient_id} / {visit_date}.")

        boxed_records = [
            record
            for record in case_df.to_dict("records")
            if isinstance(record.get("lesion_prompt_box"), dict)
        ]
        if not boxed_records:
            raise ValueError("This case requires at least one saved lesion box.")

        previews: list[dict[str, Any]] = []
        for record in boxed_records:
            lesion = self._ensure_lesion_crop(site_store, record)
            previews.append(
                {
                    "patient_id": patient_id,
                    "visit_date": visit_date,
                    "view": record.get("view", "unknown"),
                    "is_representative": bool(record.get("is_representative")),
                    "source_image_path": record["image_path"],
                    "lesion_mask_path": lesion["lesion_mask_path"],
                    "lesion_crop_path": lesion["lesion_crop_path"],
                    "backend": lesion.get("backend", "unknown"),
                    "medsam_error": lesion.get("medsam_error"),
                    "lesion_prompt_box": record.get("lesion_prompt_box"),
                    "prompt_signature": lesion.get("prompt_signature"),
                }
            )
        previews.sort(
            key=lambda item: (
                not item["is_representative"],
                item["view"],
                item["source_image_path"],
            )
        )
        return previews

    def preview_image_lesion(
        self,
        site_store: SiteStore,
        image_id: str,
        *,
        lesion_prompt_box: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        record = site_store.get_image(image_id)
        if record is None:
            raise ValueError("Image not found.")
        effective_box = lesion_prompt_box if lesion_prompt_box is not None else record.get("lesion_prompt_box")
        if not isinstance(effective_box, dict):
            raise ValueError("This image requires a saved lesion box.")
        lesion = self._ensure_lesion_crop(site_store, record, lesion_prompt_box=effective_box)
        return {
            "patient_id": record["patient_id"],
            "visit_date": record["visit_date"],
            "view": record.get("view", "unknown"),
            "is_representative": bool(record.get("is_representative")),
            "source_image_path": record["image_path"],
            "lesion_mask_path": lesion["lesion_mask_path"],
            "lesion_crop_path": lesion["lesion_crop_path"],
            "backend": lesion.get("backend", "unknown"),
            "medsam_error": lesion.get("medsam_error"),
            "lesion_prompt_box": effective_box,
            "prompt_signature": lesion.get("prompt_signature"),
        }

    def contribute_case(
        self,
        site_store: SiteStore,
        patient_id: str,
        visit_date: str,
        model_version: dict[str, Any],
        execution_device: str,
        user_id: str,
    ) -> dict[str, Any]:
        """케이스 기여: 로컬 파인튜닝 → weight delta 저장 → 기여 등록."""
        manifest_df = site_store.generate_manifest()
        case_df = manifest_df[
            (manifest_df["patient_id"] == patient_id)
            & (manifest_df["visit_date"] == visit_date)
        ]
        if case_df.empty:
            raise ValueError(f"No data found for patient {patient_id} / {visit_date}.")
        crop_mode = self._resolve_model_crop_mode(model_version)
        if crop_mode == "both":
            raise ValueError("Ensemble models are not supported for local fine-tuning contributions.")

        records = self._prepare_records_for_model(
            site_store,
            case_df.to_dict("records"),
            crop_mode=crop_mode,
        )

        full_finetune = execution_device == "cuda"
        epochs = 1 if execution_device == "cpu" else 3
        architecture = model_version.get("architecture", "densenet121")
        output_model_path = site_store.update_dir / f"{make_id(architecture)}_weights.pth"

        result = self.model_manager.fine_tune(
            records=records,
            base_model_reference=model_version,
            output_model_path=output_model_path,
            device=execution_device,
            full_finetune=full_finetune,
            epochs=epochs,
        )

        delta_path = site_store.update_dir / f"{make_id('delta')}.pth"
        self.model_manager.save_weight_delta(
            model_version["model_path"],
            result["output_model_path"],
            delta_path,
        )

        update_id = make_id("update")
        artifact_metadata = self.control_plane.store_model_update_artifact(
            delta_path,
            update_id=update_id,
            artifact_kind="delta",
        )
        case_reference_id = self.control_plane.case_reference_id(site_store.site_id, patient_id, visit_date)
        approval_report, _approval_report_path = self._build_approval_report(
            site_store,
            case_df.to_dict("records"),
            records,
            update_id,
            patient_id,
            visit_date,
        )
        quality_summary = self._build_update_quality_summary(
            site_store,
            case_df.to_dict("records"),
            model_version,
            execution_device,
            delta_path,
            approval_report,
        )

        update_metadata: dict[str, Any] = {
            "update_id": update_id,
            "site_id": site_store.site_id,
            "base_model_version_id": model_version["version_id"],
            "architecture": architecture,
            "upload_type": "weight delta",
            "execution_device": execution_device,
            "artifact_path": str(delta_path),
            **artifact_metadata,
            "n_cases": 1,
            "contributed_by": user_id,
            "case_reference_id": case_reference_id,
            "salt_fingerprint": CASE_REFERENCE_SALT_FINGERPRINT,
            "created_at": utc_now(),
            "preprocess_signature": self.model_manager.preprocess_signature(),
            "num_classes": len(LABEL_TO_INDEX),
            "crop_mode": crop_mode,
            "training_input_policy": "medsam_cornea_crop_only" if crop_mode == "automated" else "medsam_lesion_crop_only",
            "training_summary": result,
            "approval_report": approval_report,
            "quality_summary": quality_summary,
            "status": "pending_review",
        }
        self.control_plane.register_model_update(update_metadata)
        update_metadata["experiment"] = self._register_experiment(
            site_store,
            experiment_type="case_contribution_fine_tuning",
            status="completed",
            created_at=str(update_metadata["created_at"]),
            execution_device=execution_device,
            manifest_df=manifest_df,
            parameters={
                "base_model_version_id": model_version["version_id"],
                "architecture": architecture,
                "upload_type": "weight delta",
                "patient_id": patient_id,
                "visit_date": visit_date,
                "crop_mode": crop_mode,
            },
            metrics={
                "average_loss": result.get("average_loss"),
                "quality_score": quality_summary.get("quality_score") if isinstance(quality_summary, dict) else None,
            },
            report_payload=update_metadata,
            model_version=model_version,
        )

        contribution = {
            "contribution_id": make_id("contrib"),
            "user_id": user_id,
            "site_id": site_store.site_id,
            "case_reference_id": case_reference_id,
            "update_id": update_metadata["update_id"],
            "created_at": utc_now(),
        }
        self.control_plane.register_contribution(contribution)
        return update_metadata

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
        use_medsam_crops: bool = True,
        regenerate_split: bool = False,
        progress_callback: Any = None,
    ) -> dict[str, Any]:
        """사이트 전체 데이터로 automated/manual crop 기반 초기 학습을 수행합니다."""
        manifest_df = site_store.generate_manifest()
        if manifest_df.empty:
            raise ValueError("학습 데이터가 없습니다. 먼저 이미지를 등록하세요.")
        if not use_medsam_crops:
            raise ValueError("Initial training is MedSAM cornea-crop-only.")
        normalized_crop_mode = self._normalize_crop_mode(crop_mode)
        training_modes = ["automated", "manual"] if normalized_crop_mode == "both" else [normalized_crop_mode]

        def emit_progress(**payload: Any) -> None:
            if progress_callback is None:
                return
            progress_callback(
                {
                    "stage": payload.get("stage"),
                    "message": payload.get("message"),
                    "percent": int(payload.get("percent", 0)),
                    "crop_mode": normalized_crop_mode,
                    "component_crop_mode": payload.get("component_crop_mode"),
                    "component_index": payload.get("component_index"),
                    "component_count": len(training_modes),
                    "epoch": payload.get("epoch"),
                    "epochs": payload.get("epochs"),
                    "train_loss": payload.get("train_loss"),
                    "val_acc": payload.get("val_acc"),
                }
            )

        emit_progress(
            stage="preparing_data",
            message="Preparing manifest and patient split.",
            percent=3,
        )

        saved_split = None if regenerate_split else site_store.load_patient_split() or None
        crop_modes_to_train = training_modes
        created_versions: list[dict[str, Any]] = []
        component_results: list[dict[str, Any]] = []
        shared_patient_split: dict[str, Any] | None = saved_split

        for component_index, component_crop_mode in enumerate(crop_modes_to_train, start=1):
            emit_progress(
                stage="preparing_component",
                message=f"Preparing {component_crop_mode} training set.",
                percent=8 if len(crop_modes_to_train) == 1 else 5 + int(((component_index - 1) / len(crop_modes_to_train)) * 10),
                component_crop_mode=component_crop_mode,
                component_index=component_index,
            )
            records = self._prepare_records_for_model(
                site_store,
                manifest_df.to_dict("records"),
                crop_mode=component_crop_mode,
            )
            component_output_path = output_model_path
            if normalized_crop_mode == "both":
                output = Path(output_model_path)
                component_output_path = str(output.with_name(f"{output.stem}_{component_crop_mode}{output.suffix}"))

            training_start_percent = 10 + int(((component_index - 1) * 70) / len(crop_modes_to_train))
            training_end_percent = 10 + int((component_index * 70) / len(crop_modes_to_train))

            def component_progress_callback(epoch: int, total_epochs: int, train_loss: float, val_acc: float) -> None:
                progress_ratio = epoch / max(1, total_epochs)
                percent = training_start_percent + int((training_end_percent - training_start_percent) * progress_ratio)
                emit_progress(
                    stage="training_component",
                    message=f"Training {component_crop_mode} model.",
                    percent=percent,
                    component_crop_mode=component_crop_mode,
                    component_index=component_index,
                    epoch=epoch,
                    epochs=total_epochs,
                    train_loss=round(float(train_loss), 4),
                    val_acc=round(float(val_acc), 4),
                )

            result = self.model_manager.initial_train(
                records=records,
                architecture=architecture,
                output_model_path=component_output_path,
                device=execution_device,
                epochs=epochs,
                learning_rate=learning_rate,
                batch_size=batch_size,
                val_split=val_split,
                test_split=test_split,
                use_pretrained=use_pretrained,
                saved_split=shared_patient_split,
                crop_mode=component_crop_mode,
                training_input_policy=(
                    "medsam_cornea_crop_only" if component_crop_mode == "automated" else "medsam_lesion_crop_only"
                ),
                progress_callback=component_progress_callback,
            )
            patient_split = {
                **result["patient_split"],
                "site_id": site_store.site_id,
            }
            shared_patient_split = patient_split
            site_store.save_patient_split(patient_split)
            result["patient_split"] = patient_split
            result["crop_mode"] = component_crop_mode
            version_name = f"global-{architecture}-{component_crop_mode}-v{make_id('init')[:6]}"
            new_version = {
                "version_id": make_id("model"),
                "version_name": version_name,
                "architecture": architecture,
                "stage": "global",
                "base_version_id": None,
                "model_path": component_output_path,
                "requires_medsam_crop": use_medsam_crops,
                "crop_mode": component_crop_mode,
                "training_input_policy": (
                    "medsam_cornea_crop_only" if component_crop_mode == "automated" else "medsam_lesion_crop_only"
                ),
                "preprocess_signature": self.model_manager.preprocess_signature(),
                "num_classes": len(LABEL_TO_INDEX),
                "decision_threshold": result.get("decision_threshold", 0.5),
                "threshold_selection_metric": result.get("threshold_selection_metric"),
                "threshold_selection_metrics": result.get("threshold_selection_metrics"),
                "created_at": utc_now(),
                "is_current": normalized_crop_mode != "both" and component_crop_mode == normalized_crop_mode,
                "notes": (
                    f"Initial training with {'MedSAM cornea crops' if component_crop_mode == 'automated' else 'MedSAM lesion-centered crops'}: "
                    f"train {result['n_train_patients']} / val {result['n_val_patients']} / test {result['n_test_patients']} patients, "
                    f"best val_acc={result['best_val_acc']:.3f}, test_acc={result['test_metrics']['accuracy']:.3f}"
                ),
                "notes_ko": (
                    f"{'MedSAM cornea crop' if component_crop_mode == 'automated' else 'MedSAM lesion-centered crop'} 기반 초기 학습 모델: "
                    f"train {result['n_train_patients']}명 / val {result['n_val_patients']}명 / test {result['n_test_patients']}명, "
                    f"최고 val_acc={result['best_val_acc']:.3f}, test_acc={result['test_metrics']['accuracy']:.3f}"
                ),
                "notes_en": (
                    f"Initial training with {'MedSAM cornea crops' if component_crop_mode == 'automated' else 'MedSAM lesion-centered crops'}: "
                    f"train {result['n_train_patients']} / val {result['n_val_patients']} / test {result['n_test_patients']} patients, "
                    f"best val_acc={result['best_val_acc']:.3f}, test_acc={result['test_metrics']['accuracy']:.3f}"
                ),
                "ready": True,
            }
            created_versions.append(self.control_plane.ensure_model_version(new_version))
            emit_progress(
                stage="registering_component",
                message=f"Registering {component_crop_mode} model version.",
                percent=training_end_percent,
                component_crop_mode=component_crop_mode,
                component_index=component_index,
            )
            result["version_name"] = version_name
            result["model_version"] = created_versions[-1]
            component_results.append(result)

        if normalized_crop_mode != "both":
            experiment = self._register_experiment(
                site_store,
                experiment_type="initial_training",
                status="completed",
                created_at=utc_now(),
                execution_device=execution_device,
                manifest_df=manifest_df,
                parameters={
                    "architecture": architecture,
                    "crop_mode": normalized_crop_mode,
                    "epochs": int(epochs),
                    "learning_rate": float(learning_rate),
                    "batch_size": int(batch_size),
                    "val_split": float(val_split),
                    "test_split": float(test_split),
                    "use_pretrained": bool(use_pretrained),
                    "regenerate_split": bool(regenerate_split),
                    "seed": 42,
                },
                metrics={
                    "best_val_acc": component_results[0].get("best_val_acc"),
                    "val_metrics": component_results[0].get("val_metrics"),
                    "test_metrics": component_results[0].get("test_metrics"),
                    "decision_threshold": component_results[0].get("decision_threshold"),
                },
                report_payload=component_results[0],
                model_version=created_versions[-1],
                patient_split=shared_patient_split,
            )
            component_results[0]["experiment"] = experiment
            emit_progress(
                stage="completed",
                message="Initial training completed.",
                percent=100,
                component_crop_mode=normalized_crop_mode,
                component_index=1,
            )
            return component_results[0]

        emit_progress(
            stage="selecting_ensemble",
            message="Optimizing ensemble weights on validation split.",
            percent=88,
        )
        val_patient_ids = set(str(patient_id) for patient_id in (shared_patient_split or {}).get("val_patient_ids", []))
        validation_records = [
            record
            for record in manifest_df.to_dict("records")
            if str(record["patient_id"]) in val_patient_ids
        ]
        automated_version = next(
            (version for version in created_versions if self._resolve_model_crop_mode(version) == "automated"),
            created_versions[0],
        )
        manual_version = next(
            (version for version in created_versions if self._resolve_model_crop_mode(version) == "manual"),
            created_versions[-1],
        )
        ensemble_selection = self._optimize_ensemble_weights(
            site_store,
            validation_records,
            automated_version,
            manual_version,
            execution_device,
        )

        ensemble_version = self.control_plane.ensure_model_version(
            {
                "version_id": make_id("model"),
                "version_name": f"global-{architecture}-ensemble-v{make_id('ens')[:6]}",
                "architecture": architecture,
                "stage": "global",
                "base_version_id": None,
                "model_path": "",
                "requires_medsam_crop": True,
                "crop_mode": "both",
                "ensemble_mode": "weighted_average",
                "component_model_version_ids": [item["version_id"] for item in created_versions],
                "ensemble_weights": ensemble_selection["ensemble_weights"],
                "training_input_policy": "medsam_cornea_plus_lesion_ensemble",
                "preprocess_signature": self.model_manager.preprocess_signature(),
                "num_classes": len(LABEL_TO_INDEX),
                "decision_threshold": ensemble_selection["decision_threshold"],
                "threshold_selection_metric": ensemble_selection["threshold_selection_metric"],
                "threshold_selection_metrics": ensemble_selection["threshold_selection_metrics"],
                "created_at": utc_now(),
                "is_current": True,
                "notes": (
                    "Weighted-average ensemble of automated cornea crop and manual lesion-centered crop models. "
                    f"Selected weights on validation split: automated={ensemble_selection['ensemble_weights']['automated']:.2f}, "
                    f"manual={ensemble_selection['ensemble_weights']['manual']:.2f}."
                ),
                "notes_ko": (
                    "자동 cornea crop 모델과 manual lesion-centered crop 모델의 가중 평균 ensemble입니다. "
                    f"검증 분할에서 선택된 가중치: automated={ensemble_selection['ensemble_weights']['automated']:.2f}, "
                    f"manual={ensemble_selection['ensemble_weights']['manual']:.2f}."
                ),
                "notes_en": (
                    "Weighted-average ensemble of automated cornea crop and manual lesion-centered crop models. "
                    f"Selected weights on validation split: automated={ensemble_selection['ensemble_weights']['automated']:.2f}, "
                    f"manual={ensemble_selection['ensemble_weights']['manual']:.2f}."
                ),
                "ensemble_selection_metric": ensemble_selection["selection_metric"],
                "ensemble_selection_metrics": ensemble_selection["selection_metrics"],
                "ensemble_validation_case_count": ensemble_selection["n_validation_cases"],
                "ready": True,
            }
        )
        emit_progress(
            stage="finalizing",
            message="Finalizing ensemble model registration.",
            percent=97,
        )
        emit_progress(
            stage="completed",
            message="Initial training completed.",
            percent=100,
        )
        experiment_result = {
            "training_id": make_id("train"),
            "crop_mode": "both",
            "component_results": component_results,
            "ensemble_weights": ensemble_selection["ensemble_weights"],
            "ensemble_selection_metric": ensemble_selection["selection_metric"],
            "ensemble_selection_metrics": ensemble_selection["selection_metrics"],
            "decision_threshold": ensemble_selection["decision_threshold"],
            "threshold_selection_metric": ensemble_selection["threshold_selection_metric"],
            "threshold_selection_metrics": ensemble_selection["threshold_selection_metrics"],
            "ensemble_validation_case_count": ensemble_selection["n_validation_cases"],
            "model_versions": created_versions + [ensemble_version],
            "model_version": ensemble_version,
            "version_name": ensemble_version["version_name"],
            "patient_split": shared_patient_split,
        }
        experiment = self._register_experiment(
            site_store,
            experiment_type="initial_training",
            status="completed",
            created_at=utc_now(),
            execution_device=execution_device,
            manifest_df=manifest_df,
            parameters={
                "architecture": architecture,
                "crop_mode": "both",
                "epochs": int(epochs),
                "learning_rate": float(learning_rate),
                "batch_size": int(batch_size),
                "val_split": float(val_split),
                "test_split": float(test_split),
                "use_pretrained": bool(use_pretrained),
                "regenerate_split": bool(regenerate_split),
                "seed": 42,
            },
            metrics={
                "ensemble_selection_metric": ensemble_selection["selection_metric"],
                "ensemble_selection_metrics": ensemble_selection["selection_metrics"],
                "ensemble_weights": ensemble_selection["ensemble_weights"],
                "decision_threshold": ensemble_selection["decision_threshold"],
            },
            report_payload=experiment_result,
            model_version=ensemble_version,
            patient_split=shared_patient_split,
        )
        experiment_result["experiment"] = experiment
        return experiment_result

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
        use_medsam_crops: bool = True,
        progress_callback: Any = None,
    ) -> dict[str, Any]:
        manifest_df = site_store.generate_manifest()
        if manifest_df.empty:
            raise ValueError("Cross-validation requires a non-empty dataset.")
        if not use_medsam_crops:
            raise ValueError("Cross-validation is MedSAM cornea-crop-only.")
        normalized_crop_mode = self._normalize_crop_mode(crop_mode)
        if normalized_crop_mode == "both":
            raise ValueError("Cross-validation currently supports automated or manual crop mode, not both.")

        records = self._prepare_records_for_model(
            site_store,
            manifest_df.to_dict("records"),
            crop_mode=normalized_crop_mode,
        )

        def emit_progress(**payload: Any) -> None:
            if progress_callback is None:
                return
            progress_callback(
                {
                    "stage": payload.get("stage"),
                    "message": payload.get("message"),
                    "percent": int(payload.get("percent", 0)),
                    "crop_mode": normalized_crop_mode,
                    "fold_index": payload.get("fold_index"),
                    "num_folds": payload.get("num_folds", num_folds),
                    "epoch": payload.get("epoch"),
                    "epochs": payload.get("epochs"),
                    "train_loss": payload.get("train_loss"),
                    "val_acc": payload.get("val_acc"),
                }
            )

        emit_progress(
            stage="preparing_data",
            message="Preparing cross-validation splits.",
            percent=3,
        )

        def on_cross_validation_progress(progress: dict[str, Any]) -> None:
            stage = str(progress.get("stage") or "running")
            fold_index = int(progress.get("fold_index") or 1)
            total_folds = int(progress.get("num_folds") or num_folds)
            if stage == "preparing_fold":
                percent = 8 + int(((fold_index - 1) / max(1, total_folds)) * 80)
                emit_progress(
                    stage="preparing_fold",
                    message=f"Preparing fold {fold_index}/{total_folds}.",
                    percent=percent,
                    fold_index=fold_index,
                    num_folds=total_folds,
                )
                return
            epoch = int(progress.get("epoch") or 0)
            total_epochs = int(progress.get("epochs") or epochs)
            fold_base = 10 + int(((fold_index - 1) * 80) / max(1, total_folds))
            fold_end = 10 + int((fold_index * 80) / max(1, total_folds))
            epoch_ratio = epoch / max(1, total_epochs)
            percent = fold_base + int((fold_end - fold_base) * epoch_ratio)
            emit_progress(
                stage="training_fold",
                message=f"Running fold {fold_index}/{total_folds}.",
                percent=percent,
                fold_index=fold_index,
                num_folds=total_folds,
                epoch=epoch,
                epochs=total_epochs,
                train_loss=round(float(progress.get("train_loss") or 0.0), 4),
                val_acc=round(float(progress.get("val_acc") or 0.0), 4),
            )

        result = self.model_manager.cross_validate(
            records=records,
            architecture=architecture,
            output_dir=output_dir,
            device=execution_device,
            num_folds=num_folds,
            epochs=epochs,
            learning_rate=learning_rate,
            batch_size=batch_size,
            val_split=val_split,
            use_pretrained=use_pretrained,
            progress_callback=on_cross_validation_progress,
        )
        emit_progress(
            stage="finalizing",
            message="Saving cross-validation report.",
            percent=96,
        )
        report = {
            **result,
            "site_id": site_store.site_id,
            "crop_mode": normalized_crop_mode,
            "training_input_policy": "medsam_cornea_crop_only" if normalized_crop_mode == "automated" else "medsam_lesion_crop_only",
        }
        report_path = site_store.validation_dir / f"{report['cross_validation_id']}.json"
        write_json(report_path, report)
        report["report_path"] = str(report_path)
        report["experiment"] = self._register_experiment(
            site_store,
            experiment_type="cross_validation",
            status="completed",
            created_at=str(report.get("created_at") or utc_now()),
            execution_device=execution_device,
            manifest_df=manifest_df,
            parameters={
                "architecture": architecture,
                "crop_mode": normalized_crop_mode,
                "num_folds": int(num_folds),
                "epochs": int(epochs),
                "learning_rate": float(learning_rate),
                "batch_size": int(batch_size),
                "val_split": float(val_split),
                "use_pretrained": bool(use_pretrained),
                "seed": 42,
            },
            metrics=report.get("aggregate_metrics", {}),
            report_payload=report,
            model_version=None,
        )
        emit_progress(
            stage="completed",
            message="Cross-validation completed.",
            percent=100,
        )
        return report

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
        if upload_type == "weight delta":
            upload_path = site_store.update_dir / f"{make_id('delta')}.pt"
            self.model_manager.save_weight_delta(
                model_version["model_path"],
                result["output_model_path"],
                upload_path,
            )
        elif upload_type == "aggregated update":
            upload_path = site_store.update_dir / f"{make_id('agg')}.pt"
            self.model_manager.save_weight_delta(
                model_version["model_path"],
                result["output_model_path"],
                upload_path,
            )

        update_id = make_id("update")
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
            "num_classes": len(LABEL_TO_INDEX),
            "crop_mode": crop_mode,
            "training_input_policy": "medsam_cornea_crop_only" if crop_mode == "automated" else "medsam_lesion_crop_only",
            "training_summary": result,
        }
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
