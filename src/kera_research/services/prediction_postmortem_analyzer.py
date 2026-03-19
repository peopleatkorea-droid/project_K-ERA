from __future__ import annotations

from collections import Counter
from math import log
from pathlib import Path
from typing import TYPE_CHECKING, Any

import numpy as np
from PIL import Image

from kera_research.domain import INDEX_TO_LABEL
from kera_research.services.data_plane import SiteStore

if TYPE_CHECKING:
    from kera_research.services.pipeline import ResearchWorkflowService


def _safe_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _clamp01(value: float | None) -> float | None:
    if value is None:
        return None
    return max(0.0, min(1.0, float(value)))


def _mean(values: list[float]) -> float | None:
    if not values:
        return None
    return float(sum(values) / len(values))


def _normalized_confidence(predicted_label: str, probability: float | None) -> float | None:
    if probability is None:
        return None
    normalized_label = str(predicted_label or "").strip().lower()
    if normalized_label == "bacterial":
        return _clamp01(1.0 - probability)
    if normalized_label == "fungal":
        return _clamp01(probability)
    return _clamp01(max(probability, 1.0 - probability))


class PredictionPostmortemAnalyzer:
    def __init__(self, service: ResearchWorkflowService) -> None:
        self.service = service

    def _case_summary(
        self,
        site_store: SiteStore,
        *,
        patient_id: str,
        visit_date: str,
    ) -> dict[str, Any] | None:
        return next(
            (
                item
                for item in site_store.list_case_summaries()
                if str(item.get("patient_id") or "") == patient_id and str(item.get("visit_date") or "") == visit_date
            ),
            None,
        )

    def _case_metadata_snapshot(
        self,
        site_store: SiteStore,
        *,
        case_records: list[dict[str, Any]],
    ) -> dict[str, Any]:
        patient_id = str(case_records[0].get("patient_id") or "")
        visit_date = str(case_records[0].get("visit_date") or "")
        summary = self._case_summary(site_store, patient_id=patient_id, visit_date=visit_date) or {}
        quality_cache: dict[str, dict[str, Any] | None] = {}
        return self.service._case_metadata_snapshot(summary, case_records, quality_cache)

    def _embedding_reference(
        self,
        site_store: SiteStore,
        *,
        patient_id: str,
        visit_date: str,
        model_version: dict[str, Any],
        signature: str,
        backend: str,
    ) -> dict[str, Any]:
        vector_path, metadata_path = self.service._case_embedding_cache_paths(
            site_store,
            patient_id=patient_id,
            visit_date=visit_date,
            model_version=model_version,
            backend=backend,
        )
        version_id = str(model_version.get("version_id") or "unknown")
        return {
            "backend": backend,
            "embedding_id": f"{backend}:{version_id}:{signature[:16]}",
            "signature": signature,
            "vector_path": str(vector_path),
            "metadata_path": str(metadata_path),
            "cached": vector_path.exists() and metadata_path.exists(),
        }

    def _peer_model_candidates(
        self,
        model_version: dict[str, Any],
        *,
        max_models: int = 5,
    ) -> list[dict[str, Any]]:
        versions = [
            item
            for item in self.service.control_plane.list_model_versions()
            if item.get("ready", True) and str(item.get("stage") or "").strip().lower() != "analysis"
        ]
        versions.sort(
            key=lambda item: (
                str(item.get("created_at") or ""),
                str(item.get("version_id") or ""),
            ),
            reverse=True,
        )

        selected: list[dict[str, Any]] = []
        seen_version_ids: set[str] = set()
        seen_architectures: set[str] = set()

        def add_candidate(candidate: dict[str, Any] | None, *, lock_architecture: bool = True) -> None:
            if candidate is None:
                return
            version_id = str(candidate.get("version_id") or "").strip()
            if not version_id or version_id in seen_version_ids:
                return
            architecture = str(candidate.get("architecture") or "").strip().lower()
            if lock_architecture and architecture and architecture in seen_architectures:
                return
            seen_version_ids.add(version_id)
            if lock_architecture and architecture:
                seen_architectures.add(architecture)
            selected.append(candidate)

        requested_ids = [str(model_version.get("version_id") or "").strip()]
        requested_ids.extend(
            str(item).strip()
            for item in list(model_version.get("component_model_version_ids") or [])
            if str(item).strip()
        )
        versions_by_id = {str(item.get("version_id") or "").strip(): item for item in versions}

        for requested_id in requested_ids:
            add_candidate(versions_by_id.get(requested_id), lock_architecture=False)
            if len(selected) >= max_models:
                return selected[:max_models]

        for candidate in versions:
            add_candidate(candidate)
            if len(selected) >= max_models:
                break
        return selected[:max_models]

    def _peer_model_consensus(
        self,
        site_store: SiteStore,
        *,
        case_records: list[dict[str, Any]],
        model_version: dict[str, Any],
        execution_device: str,
    ) -> dict[str, Any]:
        peer_models = self._peer_model_candidates(model_version)
        predictions: list[dict[str, Any]] = []
        for candidate in peer_models:
            try:
                result = self.service._predict_case(
                    site_store,
                    case_records,
                    candidate,
                    execution_device,
                    generate_gradcam=False,
                    generate_medsam=False,
                )
            except Exception as exc:
                predictions.append(
                    {
                        "model_version_id": candidate.get("version_id"),
                        "model_version_name": candidate.get("version_name"),
                        "architecture": candidate.get("architecture"),
                        "error": str(exc),
                    }
                )
                continue

            probability = _safe_float(result.get("predicted_probability"))
            predicted_index = result.get("predicted_index")
            predicted_label = (
                INDEX_TO_LABEL[int(predicted_index)]
                if isinstance(predicted_index, int) and int(predicted_index) in INDEX_TO_LABEL
                else str(result.get("predicted_label") or "").strip().lower()
            )
            predictions.append(
                {
                    "model_version_id": candidate.get("version_id"),
                    "model_version_name": candidate.get("version_name"),
                    "architecture": candidate.get("architecture"),
                    "predicted_label": predicted_label or "unknown",
                    "prediction_probability": round(probability, 4) if probability is not None else None,
                    "predicted_confidence": (
                        round(_normalized_confidence(predicted_label, probability) or 0.0, 4)
                        if probability is not None
                        else None
                    ),
                    "crop_mode": result.get("crop_mode"),
                }
            )

        successful = [item for item in predictions if not item.get("error")]
        label_counter = Counter(str(item.get("predicted_label") or "unknown") for item in successful)
        leading_label = label_counter.most_common(1)[0][0] if label_counter else None
        agreement_rate = (
            label_counter.get(leading_label or "", 0) / len(successful)
            if successful and leading_label
            else None
        )
        disagreement_score = 1.0 - agreement_rate if agreement_rate is not None else None
        entropy = None
        if successful:
            entropy_value = 0.0
            for count in label_counter.values():
                probability = count / len(successful)
                entropy_value -= probability * log(probability + 1e-12, 2)
            max_entropy = log(max(len(label_counter), 1), 2) if len(label_counter) > 1 else 1.0
            entropy = entropy_value / max(max_entropy, 1.0)
        return {
            "models_evaluated": len(successful),
            "models_requested": len(peer_models),
            "leading_label": leading_label,
            "agreement_rate": round(float(agreement_rate), 4) if agreement_rate is not None else None,
            "disagreement_score": round(float(disagreement_score), 4) if disagreement_score is not None else None,
            "vote_entropy": round(float(entropy), 4) if entropy is not None else None,
            "peer_predictions": predictions,
        }

    def build_prediction_snapshot(
        self,
        site_store: SiteStore,
        *,
        case_records: list[dict[str, Any]],
        model_version: dict[str, Any],
        execution_device: str,
        case_result: dict[str, Any],
    ) -> dict[str, Any]:
        metadata_snapshot = self._case_metadata_snapshot(site_store, case_records=case_records)
        patient_id = str(case_records[0].get("patient_id") or "")
        visit_date = str(case_records[0].get("visit_date") or "")
        representative = self.service._select_representative_record(case_records)
        snapshot: dict[str, Any] = {
            "patient_id": patient_id,
            "visit_date": visit_date,
            "model_version_id": model_version.get("version_id"),
            "model_version_name": model_version.get("version_name"),
            "model_architecture": model_version.get("architecture"),
            "execution_device": execution_device,
            "crop_mode": case_result.get("crop_mode"),
            "decision_threshold": case_result.get("decision_threshold"),
            "predicted_label": INDEX_TO_LABEL[int(case_result["predicted_index"])],
            "prediction_probability": round(float(case_result["predicted_probability"]), 4),
            "predicted_confidence": round(
                _normalized_confidence(
                    INDEX_TO_LABEL[int(case_result["predicted_index"])],
                    _safe_float(case_result.get("predicted_probability")),
                )
                or 0.0,
                4,
            ),
            "representative_image_id": representative.get("image_id"),
            "representative_source_image_path": representative.get("image_path"),
            "representative_view": representative.get("view"),
            "representative_quality_score": metadata_snapshot.get("quality_score"),
            "representative_view_score": metadata_snapshot.get("view_score"),
            "contact_lens_use": metadata_snapshot.get("contact_lens_use"),
            "predisposing_factor": metadata_snapshot.get("predisposing_factor"),
            "smear_result": metadata_snapshot.get("smear_result"),
            "polymicrobial": metadata_snapshot.get("polymicrobial"),
            "additional_organisms": metadata_snapshot.get("additional_organisms"),
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
            "n_source_images": case_result.get("n_source_images"),
            "n_model_inputs": case_result.get("n_model_inputs"),
            "ensemble_component_predictions": case_result.get("ensemble_component_predictions"),
        }

        classifier_signature = self.service._case_embedding_signature(case_records, model_version, backend="classifier")
        try:
            self.service._prepare_case_embedding(
                site_store,
                case_records,
                model_version,
                execution_device,
                force_refresh=False,
            )
            snapshot["classifier_embedding"] = self._embedding_reference(
                site_store,
                patient_id=patient_id,
                visit_date=visit_date,
                model_version=model_version,
                signature=classifier_signature,
                backend="classifier",
            )
        except Exception as exc:
            snapshot["classifier_embedding"] = {
                "backend": "classifier",
                "embedding_id": f"classifier:{model_version.get('version_id') or 'unknown'}:{classifier_signature[:16]}",
                "signature": classifier_signature,
                "error": str(exc),
            }

        dinov2_signature = self.service._case_embedding_signature(case_records, model_version, backend="dinov2")
        try:
            self.service._prepare_case_dinov2_embedding(
                site_store,
                case_records,
                model_version,
                execution_device,
                force_refresh=False,
            )
            snapshot["dinov2_embedding"] = self._embedding_reference(
                site_store,
                patient_id=patient_id,
                visit_date=visit_date,
                model_version=model_version,
                signature=dinov2_signature,
                backend="dinov2",
            )
        except Exception as exc:
            snapshot["dinov2_embedding"] = {
                "backend": "dinov2",
                "embedding_id": f"dinov2:{model_version.get('version_id') or 'unknown'}:{dinov2_signature[:16]}",
                "signature": dinov2_signature,
                "error": str(exc),
            }

        try:
            snapshot["peer_model_consensus"] = self._peer_model_consensus(
                site_store,
                case_records=case_records,
                model_version=model_version,
                execution_device=execution_device,
            )
        except Exception as exc:
            snapshot["peer_model_consensus"] = {
                "models_evaluated": 0,
                "models_requested": 0,
                "leading_label": None,
                "agreement_rate": None,
                "disagreement_score": None,
                "vote_entropy": None,
                "peer_predictions": [],
                "error": str(exc),
            }
        return snapshot

    def _compute_crop_box(
        self,
        mask_array: np.ndarray,
        image_size: tuple[int, int],
        *,
        expand_ratio: float,
    ) -> tuple[int, int, int, int]:
        width, height = image_size
        ys, xs = np.where(mask_array > 0)
        if xs.size == 0 or ys.size == 0:
            return (0, 0, width, height)
        x0 = int(xs.min())
        x1 = int(xs.max()) + 1
        y0 = int(ys.min())
        y1 = int(ys.max()) + 1
        if expand_ratio > 1.0:
            box_width = max(1, x1 - x0)
            box_height = max(1, y1 - y0)
            center_x = x0 + (box_width / 2.0)
            center_y = y0 + (box_height / 2.0)
            expanded_width = box_width * expand_ratio
            expanded_height = box_height * expand_ratio
            x0 = max(0, int(round(center_x - (expanded_width / 2.0))))
            y0 = max(0, int(round(center_y - (expanded_height / 2.0))))
            x1 = min(width, int(round(center_x + (expanded_width / 2.0))))
            y1 = min(height, int(round(center_y + (expanded_height / 2.0))))
        return (x0, y0, x1, y1)

    def _cam_overlap_scores_for_artifacts(
        self,
        *,
        heatmap_path_value: str,
        source_image_path_value: str,
        mask_path_value: str,
        crop_mode: str,
    ) -> dict[str, Any]:
        if not heatmap_path_value or not source_image_path_value:
            return {
                "cam_overlap_score": None,
                "cam_peak_inside_score": None,
                "cam_hotspot_ratio": None,
            }

        heatmap_path = Path(heatmap_path_value)
        source_image_path = Path(source_image_path_value)
        if not heatmap_path.exists() or not source_image_path.exists():
            return {
                "cam_overlap_score": None,
                "cam_peak_inside_score": None,
                "cam_hotspot_ratio": None,
            }

        if not mask_path_value:
            return {
                "cam_overlap_score": None,
                "cam_peak_inside_score": None,
                "cam_hotspot_ratio": None,
            }

        mask_path = Path(mask_path_value)
        if not mask_path.exists():
            return {
                "cam_overlap_score": None,
                "cam_peak_inside_score": None,
                "cam_hotspot_ratio": None,
            }

        try:
            heatmap = np.asarray(np.load(heatmap_path), dtype=np.float32)
            mask_image = Image.open(mask_path).convert("L")
            source_image = Image.open(source_image_path).convert("RGB")
        except (OSError, ValueError):
            return {
                "cam_overlap_score": None,
                "cam_peak_inside_score": None,
                "cam_hotspot_ratio": None,
            }

        if heatmap.ndim != 2:
            return {
                "cam_overlap_score": None,
                "cam_peak_inside_score": None,
                "cam_hotspot_ratio": None,
            }

        mask_array = (np.asarray(mask_image, dtype=np.uint8) > 0).astype(np.uint8)
        normalized_crop_mode = str(crop_mode or "").strip().lower()
        expand_ratio = 2.5 if normalized_crop_mode == "manual" else 1.0
        if normalized_crop_mode == "raw":
            local_mask = mask_array
        else:
            crop_box = self._compute_crop_box(mask_array, source_image.size, expand_ratio=expand_ratio)
            x0, y0, x1, y1 = crop_box
            local_mask = mask_array[y0:y1, x0:x1]
        if local_mask.size == 0:
            return {
                "cam_overlap_score": None,
                "cam_peak_inside_score": None,
                "cam_hotspot_ratio": None,
            }

        resized_mask = np.asarray(
            Image.fromarray((local_mask > 0).astype(np.uint8) * 255, mode="L").resize(
                (int(heatmap.shape[1]), int(heatmap.shape[0])),
            ),
            dtype=np.uint8,
        )
        binary_mask = (resized_mask > 0).astype(np.float32)
        if float(binary_mask.sum()) <= 0:
            return {
                "cam_overlap_score": None,
                "cam_peak_inside_score": None,
                "cam_hotspot_ratio": None,
            }

        normalized_heatmap = np.maximum(heatmap.astype(np.float32), 0.0)
        total_heat = float(normalized_heatmap.sum())
        if total_heat <= 0:
            return {
                "cam_overlap_score": None,
                "cam_peak_inside_score": None,
                "cam_hotspot_ratio": None,
            }
        normalized_heatmap = normalized_heatmap / total_heat
        overlap_score = float((normalized_heatmap * binary_mask).sum())

        peak_y, peak_x = np.unravel_index(int(np.argmax(heatmap)), heatmap.shape)
        peak_inside_score = 1.0 if binary_mask[peak_y, peak_x] > 0 else 0.0

        hotspot_threshold = float(np.quantile(heatmap, 0.85))
        hotspot_mask = (heatmap >= hotspot_threshold).astype(np.float32)
        hotspot_pixels = float(hotspot_mask.sum())
        hotspot_ratio = float((hotspot_mask * binary_mask).sum() / hotspot_pixels) if hotspot_pixels > 0 else None
        return {
            "cam_overlap_score": round(overlap_score, 4),
            "cam_peak_inside_score": round(peak_inside_score, 4),
            "cam_hotspot_ratio": round(float(hotspot_ratio), 4) if hotspot_ratio is not None else None,
        }

    def _cam_overlap_scores(self, prediction_snapshot: dict[str, Any]) -> dict[str, Any]:
        source_image_path_value = str(prediction_snapshot.get("representative_source_image_path") or "").strip()
        legacy_mask_path_value = (
            str(prediction_snapshot.get("lesion_mask_path") or "").strip()
            or str(prediction_snapshot.get("medsam_mask_path") or "").strip()
        )
        legacy_scores = self._cam_overlap_scores_for_artifacts(
            heatmap_path_value=str(prediction_snapshot.get("gradcam_heatmap_path") or "").strip(),
            source_image_path_value=source_image_path_value,
            mask_path_value=legacy_mask_path_value,
            crop_mode=str(prediction_snapshot.get("crop_mode") or ""),
        )
        cornea_scores = self._cam_overlap_scores_for_artifacts(
            heatmap_path_value=(
                str(prediction_snapshot.get("gradcam_cornea_heatmap_path") or "").strip()
                or str(prediction_snapshot.get("gradcam_heatmap_path") or "").strip()
            ),
            source_image_path_value=source_image_path_value,
            mask_path_value=(
                str(prediction_snapshot.get("medsam_mask_path") or "").strip()
                or str(prediction_snapshot.get("lesion_mask_path") or "").strip()
            ),
            crop_mode="automated",
        )
        lesion_scores = self._cam_overlap_scores_for_artifacts(
            heatmap_path_value=str(prediction_snapshot.get("gradcam_lesion_heatmap_path") or "").strip(),
            source_image_path_value=source_image_path_value,
            mask_path_value=(
                str(prediction_snapshot.get("lesion_mask_path") or "").strip()
                or str(prediction_snapshot.get("medsam_mask_path") or "").strip()
            ),
            crop_mode="manual",
        )

        primary_scores = legacy_scores
        if lesion_scores.get("cam_overlap_score") is not None:
            primary_scores = lesion_scores
        elif cornea_scores.get("cam_overlap_score") is not None:
            primary_scores = cornea_scores

        return {
            **primary_scores,
            "cam_cornea_overlap_score": cornea_scores.get("cam_overlap_score"),
            "cam_cornea_peak_inside_score": cornea_scores.get("cam_peak_inside_score"),
            "cam_cornea_hotspot_ratio": cornea_scores.get("cam_hotspot_ratio"),
            "cam_lesion_overlap_score": lesion_scores.get("cam_overlap_score"),
            "cam_lesion_peak_inside_score": lesion_scores.get("cam_peak_inside_score"),
            "cam_lesion_hotspot_ratio": lesion_scores.get("cam_hotspot_ratio"),
        }

    def _neighbor_scores(
        self,
        *,
        similar_cases: list[dict[str, Any]],
        predicted_label: str,
        true_label: str,
        top_k: int = 5,
    ) -> dict[str, Any]:
        ranked_cases = [item for item in similar_cases if isinstance(item, dict)]
        ranked_cases.sort(
            key=lambda item: (
                _safe_float(item.get("dinov2_similarity")) if _safe_float(item.get("dinov2_similarity")) is not None else -2.0,
                _safe_float(item.get("similarity")) if _safe_float(item.get("similarity")) is not None else -2.0,
            ),
            reverse=True,
        )
        dinov2_neighbors = ranked_cases[: max(1, min(top_k, len(ranked_cases)))]
        if not dinov2_neighbors:
            return {
                "dino_neighbor_count": 0,
                "dino_true_label_purity": None,
                "dino_predicted_label_purity": None,
                "dino_mean_similarity": None,
                "dino_mean_distance": None,
            }

        similarity_values: list[float] = []
        true_matches = 0
        predicted_matches = 0
        for item in dinov2_neighbors:
            label = str(item.get("culture_category") or "").strip().lower()
            if label == str(true_label or "").strip().lower():
                true_matches += 1
            if label == str(predicted_label or "").strip().lower():
                predicted_matches += 1
            similarity = _safe_float(item.get("dinov2_similarity"))
            if similarity is None:
                similarity = _safe_float(item.get("similarity"))
            if similarity is not None:
                similarity_values.append(float(similarity))

        mean_similarity = _mean(similarity_values)
        mean_distance = None
        if mean_similarity is not None:
            mean_distance = 1.0 - ((max(-1.0, min(1.0, mean_similarity)) + 1.0) / 2.0)
        count = len(dinov2_neighbors)
        return {
            "dino_neighbor_count": count,
            "dino_true_label_purity": round(true_matches / count, 4),
            "dino_predicted_label_purity": round(predicted_matches / count, 4),
            "dino_mean_similarity": round(float(mean_similarity), 4) if mean_similarity is not None else None,
            "dino_mean_distance": round(float(mean_distance), 4) if mean_distance is not None else None,
        }

    def _site_error_scores(
        self,
        site_store: SiteStore,
        *,
        validation_id: str | None,
        model_version_id: str | None,
        predicted_label: str,
        true_label: str,
    ) -> dict[str, Any]:
        rows = self.service.control_plane.list_validation_cases(site_id=site_store.site_id)
        filtered = [
            row
            for row in rows
            if (not model_version_id or str(row.get("model_version_id") or "") == str(model_version_id))
            and str(row.get("validation_id") or "") != str(validation_id or "")
        ]
        filtered.sort(
            key=lambda item: (
                str(item.get("run_date") or ""),
                str(item.get("validation_case_id") or ""),
            ),
            reverse=True,
        )
        recent_rows = filtered[:50]
        if not recent_rows:
            return {
                "site_recent_case_count": 0,
                "site_recent_miss_rate": None,
                "site_error_concentration": None,
            }

        misclassified_rows = [row for row in recent_rows if row.get("is_correct") is False]
        same_confusion = [
            row
            for row in misclassified_rows
            if str(row.get("predicted_label") or "").strip().lower() == predicted_label
            and str(row.get("true_label") or "").strip().lower() == true_label
        ]
        miss_rate = len(misclassified_rows) / len(recent_rows)
        concentration = len(same_confusion) / len(misclassified_rows) if misclassified_rows else None
        return {
            "site_recent_case_count": len(recent_rows),
            "site_recent_miss_rate": round(miss_rate, 4),
            "site_error_concentration": round(float(concentration), 4) if concentration is not None else None,
        }

    def _root_cause_tags(
        self,
        *,
        outcome: str,
        confidence: float | None,
        scores: dict[str, Any],
        query_case: dict[str, Any],
        support_density: float | None,
    ) -> list[str]:
        tags: list[str] = []
        quality_score = _safe_float(scores.get("image_quality_score"))
        view_score = _safe_float(scores.get("image_view_score"))
        disagreement = _safe_float(scores.get("multi_model_disagreement"))
        agreement = _safe_float(scores.get("multi_model_agreement"))
        cam_overlap = _safe_float(scores.get("cam_overlap_score"))
        true_purity = _safe_float(scores.get("dino_true_label_purity"))
        predicted_purity = _safe_float(scores.get("dino_predicted_label_purity"))
        site_concentration = _safe_float(scores.get("site_error_concentration"))

        if (quality_score is not None and quality_score < 50) or (view_score is not None and view_score < 45):
            tags.append("low_quality")
        if support_density is not None and support_density < 0.4:
            tags.append("data_sparse")
        if bool(query_case.get("polymicrobial")) or list(query_case.get("additional_organisms") or []):
            tags.append("label_review_needed")

        if outcome == "incorrect":
            if (
                confidence is not None
                and confidence >= 0.85
                and agreement is not None
                and agreement >= 0.75
                and cam_overlap is not None
                and cam_overlap < 0.35
            ):
                tags.append("shortcut_suspected")
            if (
                disagreement is not None
                and disagreement >= 0.35
                and confidence is not None
                and confidence <= 0.75
            ):
                tags.append("natural_boundary")
            if (
                site_concentration is not None
                and site_concentration >= 0.35
                and agreement is not None
                and agreement >= 0.7
                and predicted_purity is not None
                and true_purity is not None
                and predicted_purity >= (true_purity + 0.2)
            ):
                tags.append("domain_shift")
            if (
                "label_review_needed" not in tags
                and confidence is not None
                and confidence < 0.65
                and true_purity is not None
                and true_purity >= 0.67
            ):
                tags.append("label_review_needed")
            if not tags:
                tags.append("natural_boundary")

        deduped: list[str] = []
        seen: set[str] = set()
        for tag in tags:
            if tag in seen:
                continue
            seen.add(tag)
            deduped.append(tag)
        return deduped

    def _action_tags(
        self,
        *,
        outcome: str,
        root_cause_tags: list[str],
        scores: dict[str, Any],
    ) -> list[str]:
        actions: list[str] = []
        site_concentration = _safe_float(scores.get("site_error_concentration"))
        if outcome == "incorrect" or "label_review_needed" in root_cause_tags:
            actions.append("human_review")
        if "low_quality" in root_cause_tags or "label_review_needed" in root_cause_tags:
            actions.append("exclude_from_train")
        if "data_sparse" in root_cause_tags:
            actions.append("collect_more_cases")
        if "domain_shift" in root_cause_tags or (site_concentration is not None and site_concentration >= 0.35):
            actions.append("site_weight_watch")
        if outcome == "incorrect" and "exclude_from_train" not in actions:
            actions.append("hard_case_train")

        deduped: list[str] = []
        seen: set[str] = set()
        for action in actions:
            if action in seen:
                continue
            seen.add(action)
            deduped.append(action)
        return deduped

    def derive_learning_signal(
        self,
        *,
        outcome: str,
        confidence: float | None,
        root_cause_tags: list[str],
        action_tags: list[str],
    ) -> str:
        if "hard_case_train" in action_tags:
            return "hard_case_priority"
        if "collect_more_cases" in action_tags:
            return "collect_more_reference_cases"
        if "label_review_needed" in root_cause_tags:
            return "label_review_or_multilabel_watch"
        if "low_quality" in root_cause_tags:
            return "low_quality_watch"
        if "natural_boundary" in root_cause_tags:
            return "boundary_case_review"
        if outcome == "correct" and confidence is not None and confidence < 0.65:
            return "correct_but_low_margin"
        return "retain_as_reference"

    def build_structured_analysis(
        self,
        site_store: SiteStore,
        *,
        classification_context: dict[str, Any],
        query_case: dict[str, Any],
        model_version: dict[str, Any],
        similar_cases: list[dict[str, Any]],
        text_evidence: list[dict[str, Any]],
        prediction_snapshot: dict[str, Any] | None = None,
        model_consensus: dict[str, Any] | None = None,
        top_k: int = 5,
    ) -> dict[str, Any]:
        snapshot = dict(prediction_snapshot or {})
        predicted_label = str(classification_context.get("predicted_label") or "").strip().lower()
        true_label = str(classification_context.get("true_label") or "").strip().lower()
        probability = _safe_float(classification_context.get("prediction_probability"))
        confidence = _normalized_confidence(predicted_label, probability)
        outcome = "correct" if classification_context.get("is_correct") is True else "incorrect" if classification_context.get("is_correct") is False else "unknown"

        consensus_payload = dict(snapshot.get("peer_model_consensus") or model_consensus or {})
        agreement_rate = _safe_float(consensus_payload.get("agreement_rate"))
        disagreement_score = _safe_float(consensus_payload.get("disagreement_score"))

        neighbor_scores = self._neighbor_scores(
            similar_cases=similar_cases,
            predicted_label=predicted_label,
            true_label=true_label,
            top_k=top_k,
        )
        site_scores = self._site_error_scores(
            site_store,
            validation_id=str(classification_context.get("validation_id") or ""),
            model_version_id=str(classification_context.get("model_version_id") or model_version.get("version_id") or ""),
            predicted_label=predicted_label,
            true_label=true_label,
        )
        cam_scores = self._cam_overlap_scores(snapshot)
        similar_case_count = len(similar_cases)
        text_evidence_count = len(text_evidence)
        support_density = min(1.0, (similar_case_count + text_evidence_count) / float(max(top_k * 2, 1)))

        scores = {
            **cam_scores,
            **neighbor_scores,
            **site_scores,
            "multi_model_agreement": round(float(agreement_rate), 4) if agreement_rate is not None else None,
            "multi_model_disagreement": round(float(disagreement_score), 4) if disagreement_score is not None else None,
            "multi_model_vote_entropy": consensus_payload.get("vote_entropy"),
            "image_quality_score": query_case.get("quality_score"),
            "image_view_score": query_case.get("view_score"),
            "support_density": round(float(support_density), 4),
            "similar_case_count": similar_case_count,
            "text_evidence_count": text_evidence_count,
        }
        root_cause_tags = self._root_cause_tags(
            outcome=outcome,
            confidence=confidence,
            scores=scores,
            query_case=query_case,
            support_density=support_density,
        )
        action_tags = self._action_tags(
            outcome=outcome,
            root_cause_tags=root_cause_tags,
            scores=scores,
        )
        learning_signal = self.derive_learning_signal(
            outcome=outcome,
            confidence=confidence,
            root_cause_tags=root_cause_tags,
            action_tags=action_tags,
        )
        return {
            "outcome": outcome,
            "prediction_confidence": round(float(confidence), 4) if confidence is not None else None,
            "scores": scores,
            "root_cause_tags": root_cause_tags,
            "action_tags": action_tags,
            "learning_signal": learning_signal,
            "peer_model_consensus": consensus_payload,
            "prediction_snapshot": snapshot,
        }
