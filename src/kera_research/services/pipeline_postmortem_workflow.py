from __future__ import annotations

from typing import TYPE_CHECKING, Any

from kera_research.domain import INDEX_TO_LABEL
from kera_research.services.data_plane import SiteStore

if TYPE_CHECKING:
    from kera_research.services.pipeline import ResearchWorkflowService


class ResearchPostmortemWorkflow:
    def __init__(self, service: ResearchWorkflowService) -> None:
        self.service = service

    def _case_records_and_query_context(
        self,
        site_store: SiteStore,
        *,
        patient_id: str,
        visit_date: str,
    ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        records = site_store.dataset_records()
        query_records = [
            item
            for item in records
            if str(item.get("patient_id") or "") == patient_id and str(item.get("visit_date") or "") == visit_date
        ]
        if not query_records:
            raise ValueError("Selected case is not available for post-mortem analysis.")

        query_summary = next(
            (
                item
                for item in site_store.list_case_summaries()
                if str(item.get("patient_id") or "") == patient_id and str(item.get("visit_date") or "") == visit_date
            ),
            None,
        )
        if query_summary is None:
            raise ValueError("Case summary is not available for post-mortem analysis.")

        quality_cache: dict[str, dict[str, Any] | None] = {}
        query_case = self.service._case_metadata_snapshot(query_summary, query_records, quality_cache)
        return query_records, query_case

    def _artifact_summary(self, case_prediction: dict[str, Any] | None) -> dict[str, Any]:
        prediction = case_prediction or {}
        return {
            "crop_mode": prediction.get("crop_mode"),
            "n_source_images": prediction.get("n_source_images"),
            "n_model_inputs": prediction.get("n_model_inputs"),
            "has_gradcam": bool(
                prediction.get("gradcam_path")
                or prediction.get("gradcam_cornea_path")
                or prediction.get("gradcam_lesion_path")
            ),
            "has_gradcam_heatmap": bool(
                prediction.get("gradcam_heatmap_path")
                or prediction.get("gradcam_cornea_heatmap_path")
                or prediction.get("gradcam_lesion_heatmap_path")
            ),
            "has_cornea_gradcam": bool(prediction.get("gradcam_cornea_path")),
            "has_cornea_gradcam_heatmap": bool(prediction.get("gradcam_cornea_heatmap_path")),
            "has_lesion_gradcam": bool(prediction.get("gradcam_lesion_path")),
            "has_lesion_gradcam_heatmap": bool(prediction.get("gradcam_lesion_heatmap_path")),
            "has_roi_crop": bool(prediction.get("roi_crop_path")),
            "has_medsam_mask": bool(prediction.get("medsam_mask_path")),
            "has_lesion_crop": bool(prediction.get("lesion_crop_path")),
            "has_lesion_mask": bool(prediction.get("lesion_mask_path")),
        }

    def _prediction_snapshot(
        self,
        case_prediction: dict[str, Any] | None,
    ) -> dict[str, Any]:
        prediction = case_prediction or {}
        return dict(prediction.get("prediction_snapshot") or {})

    def _model_consensus(
        self,
        case_prediction: dict[str, Any] | None,
        classification_context: dict[str, Any],
    ) -> dict[str, Any]:
        prediction = case_prediction or {}
        prediction_snapshot = self._prediction_snapshot(prediction)
        peer_model_consensus = prediction_snapshot.get("peer_model_consensus")
        if isinstance(peer_model_consensus, dict) and peer_model_consensus:
            return dict(peer_model_consensus)
        component_predictions = list(prediction.get("ensemble_component_predictions") or [])
        votes: list[dict[str, Any]] = []
        if component_predictions:
            for component in component_predictions:
                predicted_index = component.get("predicted_index")
                predicted_label = (
                    INDEX_TO_LABEL[int(predicted_index)]
                    if isinstance(predicted_index, int) and int(predicted_index) in INDEX_TO_LABEL
                    else str(component.get("predicted_label") or "").strip().lower()
                )
                probability = component.get("predicted_probability")
                try:
                    probability_value = float(probability)
                except (TypeError, ValueError):
                    probability_value = None
                predicted_confidence = None
                if probability_value is not None:
                    predicted_confidence = 1.0 - probability_value if predicted_label == "bacterial" else probability_value
                votes.append(
                    {
                        "model_version_id": component.get("component_model_version_id"),
                        "model_version_name": component.get("component_model_version_name"),
                        "predicted_label": predicted_label or "unknown",
                        "predicted_confidence": round(predicted_confidence, 4) if predicted_confidence is not None else None,
                        "crop_mode": component.get("crop_mode"),
                    }
                )
        else:
            predicted_label = str(classification_context.get("predicted_label") or "").strip().lower() or "unknown"
            probability = classification_context.get("prediction_probability")
            try:
                probability_value = float(probability)
            except (TypeError, ValueError):
                probability_value = None
            predicted_confidence = None
            if probability_value is not None:
                predicted_confidence = 1.0 - probability_value if predicted_label == "bacterial" else probability_value
            votes.append(
                {
                    "model_version_id": classification_context.get("model_version_id"),
                    "model_version_name": classification_context.get("model_version"),
                    "predicted_label": predicted_label,
                    "predicted_confidence": round(predicted_confidence, 4) if predicted_confidence is not None else None,
                    "crop_mode": prediction.get("crop_mode"),
                }
            )

        label_counts: dict[str, int] = {}
        for vote in votes:
            label = str(vote.get("predicted_label") or "unknown").strip().lower() or "unknown"
            label_counts[label] = label_counts.get(label, 0) + 1
        leading_label = max(label_counts.items(), key=lambda item: item[1])[0] if label_counts else "unknown"
        agreement_rate = label_counts.get(leading_label, 0) / len(votes) if votes else None
        return {
            "models_evaluated": len(votes),
            "leading_label": leading_label,
            "agreement_rate": round(float(agreement_rate), 4) if agreement_rate is not None else None,
            "votes": votes,
        }

    def _majority_category(self, records: list[dict[str, Any]]) -> str | None:
        counts: dict[str, int] = {}
        for item in records:
            category = str(item.get("culture_category") or "").strip().lower()
            if not category:
                continue
            counts[category] = counts.get(category, 0) + 1
        if not counts:
            return None
        return max(counts.items(), key=lambda item: item[1])[0]

    def _retrieval_summary(
        self,
        *,
        similar_cases: list[dict[str, Any]],
        text_evidence: list[dict[str, Any]],
        retrieval_mode: str,
        text_retrieval_mode: str,
        retrieval_warning: str | None,
        text_retrieval_error: str | None,
        differential: dict[str, Any],
    ) -> dict[str, Any]:
        return {
            "retrieval_mode": retrieval_mode,
            "text_retrieval_mode": text_retrieval_mode,
            "similar_case_count": len(similar_cases),
            "text_evidence_count": len(text_evidence),
            "similar_majority": self._majority_category(similar_cases),
            "text_majority": self._majority_category(text_evidence),
            "differential_top_label": differential.get("top_label"),
            "retrieval_warning": retrieval_warning,
            "text_retrieval_error": text_retrieval_error,
        }

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
        service = self.service
        query_records, query_case = self._case_records_and_query_context(
            site_store,
            patient_id=patient_id,
            visit_date=visit_date,
        )

        resolved_classification_context = dict(
            classification_context
            or service._latest_case_validation_context(
                site_store.site_id,
                patient_id=patient_id,
                visit_date=visit_date,
                model_version_id=str(model_version.get("version_id") or ""),
            )
            or {}
        )
        if not resolved_classification_context:
            raise ValueError("Case validation is required before post-mortem analysis.")
        resolved_classification_context.setdefault("decision_threshold", service._resolve_model_threshold(model_version))

        similar_cases: list[dict[str, Any]] = []
        text_evidence: list[dict[str, Any]] = []
        retrieval_mode = "unavailable"
        text_retrieval_mode = "unavailable"
        retrieval_warning: str | None = None
        text_retrieval_error: str | None = None

        try:
            similar_report = service.run_ai_clinic_similar_cases(
                site_store,
                patient_id=patient_id,
                visit_date=visit_date,
                model_version=model_version,
                execution_device=execution_device,
                top_k=top_k,
                retrieval_backend=retrieval_backend,
            )
            query_case = dict(similar_report.get("query_case") or query_case)
            similar_cases = list(similar_report.get("similar_cases") or [])
            retrieval_mode = str(similar_report.get("retrieval_mode") or "unavailable")
            retrieval_warning = (
                str(similar_report.get("retrieval_warning") or "").strip() or None
            )
        except Exception as exc:
            retrieval_warning = str(exc)

        try:
            text_report = service.run_ai_clinic_text_evidence(
                site_store,
                patient_id=patient_id,
                visit_date=visit_date,
                model_version=model_version,
                execution_device=execution_device,
                top_k=top_k,
            )
            text_evidence = list(text_report.get("text_evidence") or [])
            text_retrieval_mode = str(text_report.get("text_retrieval_mode") or "available")
            text_retrieval_error = (
                str(text_report.get("text_retrieval_error") or "").strip() or None
            )
        except Exception as exc:
            text_retrieval_error = str(exc)

        differential = service.differential_ranker.rank(
            report={
                "query_case": query_case,
                "similar_cases": similar_cases,
                "text_evidence": text_evidence,
            },
            classification_context=resolved_classification_context,
        )
        prediction_snapshot = self._prediction_snapshot(case_prediction)
        if not prediction_snapshot and case_prediction is not None:
            try:
                prediction_snapshot = service.prediction_postmortem_analyzer.build_prediction_snapshot(
                    site_store,
                    case_records=query_records,
                    model_version=model_version,
                    execution_device=execution_device,
                    case_result={
                        "predicted_index": 1
                        if str(resolved_classification_context.get("predicted_label") or "").strip().lower() == "fungal"
                        else 0,
                        "predicted_probability": resolved_classification_context.get("prediction_probability"),
                        "decision_threshold": resolved_classification_context.get("decision_threshold"),
                        "crop_mode": case_prediction.get("crop_mode"),
                        "n_source_images": case_prediction.get("n_source_images"),
                        "n_model_inputs": case_prediction.get("n_model_inputs"),
                        "ensemble_component_predictions": case_prediction.get("ensemble_component_predictions"),
                        "gradcam_path": case_prediction.get("gradcam_path"),
                        "gradcam_heatmap_path": case_prediction.get("gradcam_heatmap_path"),
                        "gradcam_cornea_path": case_prediction.get("gradcam_cornea_path"),
                        "gradcam_cornea_heatmap_path": case_prediction.get("gradcam_cornea_heatmap_path"),
                        "gradcam_lesion_path": case_prediction.get("gradcam_lesion_path"),
                        "gradcam_lesion_heatmap_path": case_prediction.get("gradcam_lesion_heatmap_path"),
                        "medsam_mask_path": case_prediction.get("medsam_mask_path"),
                        "roi_crop_path": case_prediction.get("roi_crop_path"),
                        "lesion_mask_path": case_prediction.get("lesion_mask_path"),
                        "lesion_crop_path": case_prediction.get("lesion_crop_path"),
                    },
                )
            except Exception:
                prediction_snapshot = {}

        model_consensus = self._model_consensus(case_prediction, resolved_classification_context)
        structured_analysis = service.prediction_postmortem_analyzer.build_structured_analysis(
            site_store,
            classification_context=resolved_classification_context,
            query_case=query_case,
            model_version=model_version,
            similar_cases=similar_cases,
            text_evidence=text_evidence,
            prediction_snapshot=prediction_snapshot,
            model_consensus=model_consensus,
            top_k=max(int(top_k or 3), 3),
        )
        analysis_context = {
            "query_case": query_case,
            "model_version": {
                "version_id": model_version.get("version_id"),
                "version_name": model_version.get("version_name"),
                "architecture": model_version.get("architecture"),
                "crop_mode": service._resolve_model_crop_mode(model_version),
            },
            "classification_context": resolved_classification_context,
            "artifact_summary": self._artifact_summary(case_prediction),
            "model_consensus": model_consensus,
            "retrieval_summary": self._retrieval_summary(
                similar_cases=similar_cases,
                text_evidence=text_evidence,
                retrieval_mode=retrieval_mode,
                text_retrieval_mode=text_retrieval_mode,
                retrieval_warning=retrieval_warning,
                text_retrieval_error=text_retrieval_error,
                differential=differential,
            ),
            "similar_cases": similar_cases,
            "text_evidence": text_evidence,
            "differential": differential,
            "prediction_snapshot": prediction_snapshot,
            "structured_analysis": structured_analysis,
        }
        post_mortem = service.prediction_postmortem_advisor.generate_prediction_postmortem(
            analysis_context=analysis_context,
        )
        return {
            **post_mortem,
            "structured_analysis": structured_analysis,
        }
