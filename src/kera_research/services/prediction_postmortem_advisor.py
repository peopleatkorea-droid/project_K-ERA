from __future__ import annotations

import json
import os
from typing import Any

from kera_research.domain import utc_now
from kera_research.services.remote_control_plane import RemoteControlPlaneClient


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


class PredictionPostmortemAdvisor:
    def __init__(self) -> None:
        self._relay_only = os.getenv("KERA_LLM_RELAY_ONLY", "").strip().lower() in {"1", "true", "yes", "on"}
        self._api_key = (
            ""
            if self._relay_only
            else (
                os.getenv("KERA_AI_CLINIC_OPENAI_API_KEY", "").strip()
                or os.getenv("OPENAI_API_KEY", "").strip()
            )
        )
        self._model = os.getenv("KERA_AI_CLINIC_LLM_MODEL", "").strip() or "gpt-4o-mini"
        self._base_url = (
            os.getenv("KERA_AI_CLINIC_LLM_BASE_URL", "").strip()
            or "https://api.openai.com/v1/responses"
        )
        self._timeout_seconds = float(os.getenv("KERA_AI_CLINIC_LLM_TIMEOUT_SECONDS", "45").strip() or "45")
        self._remote_control_plane = RemoteControlPlaneClient()

    def generate_prediction_postmortem(
        self,
        *,
        analysis_context: dict[str, Any],
    ) -> dict[str, Any]:
        fallback = self._build_local_fallback(analysis_context=analysis_context)
        try:
            if self._api_key and not self._relay_only:
                llm_result = self._generate_openai_postmortem(analysis_context=analysis_context)
            elif self._remote_control_plane.is_configured() and self._remote_control_plane.has_node_credentials():
                llm_result = self._generate_relay_postmortem(analysis_context=analysis_context)
            else:
                return fallback
        except Exception as exc:
            return {
                **fallback,
                "mode": "local_fallback",
                "llm_error": str(exc),
            }
        return {
            **llm_result,
            "disclaimer": fallback["disclaimer"],
        }

    def _format_label(self, value: Any) -> str:
        normalized = str(value or "").strip().lower()
        return normalized if normalized else "unknown"

    def _majority_category(self, records: list[dict[str, Any]]) -> str | None:
        counts: dict[str, int] = {}
        for item in records:
            category = self._format_label(item.get("culture_category"))
            if category == "unknown":
                continue
            counts[category] = counts.get(category, 0) + 1
        if not counts:
            return None
        return max(counts.items(), key=lambda item: item[1])[0]

    def _predicted_class_confidence(self, classification_context: dict[str, Any]) -> float | None:
        predicted_label = self._format_label(classification_context.get("predicted_label"))
        raw_probability = classification_context.get("prediction_probability")
        try:
            positive_probability = _clamp01(float(raw_probability))
        except (TypeError, ValueError):
            return None
        if predicted_label == "bacterial":
            return round(1.0 - positive_probability, 4)
        if predicted_label == "fungal":
            return round(positive_probability, 4)
        return round(max(positive_probability, 1.0 - positive_probability), 4)

    def _metadata_conflict_note(self, query_case: dict[str, Any], predicted_label: str) -> str | None:
        factors = {str(item).strip().lower() for item in list(query_case.get("predisposing_factor") or []) if str(item).strip()}
        contact_lens = self._format_label(query_case.get("contact_lens_use"))
        polymicrobial = bool(query_case.get("polymicrobial"))
        if predicted_label == "bacterial" and (
            "trauma" in factors or "topical steroid use" in factors
        ):
            return "Clinical metadata keeps fungal risk elevated relative to the classifier-leading label."
        if predicted_label == "fungal" and contact_lens in {"soft contact lens", "rigid gas permeable", "orthokeratology"}:
            return "Contact lens history is more typical of bacterial-first patterns than the classifier-leading label."
        if polymicrobial:
            return "Polymicrobial metadata lowers confidence in a single-label explanation."
        return None

    def _confidence_band(self, confidence: float | None) -> str:
        if confidence is None:
            return "unknown"
        if confidence >= 0.85:
            return "high"
        if confidence >= 0.65:
            return "moderate"
        return "low"

    def _quality_note(self, query_case: dict[str, Any]) -> tuple[str | None, bool]:
        quality_score = query_case.get("quality_score")
        if not isinstance(quality_score, (int, float)):
            return None, False
        quality_value = float(quality_score)
        if quality_value < 35:
            return f"Representative image quality is low ({quality_value:.1f}).", True
        if quality_value < 50:
            return f"Representative image quality is modest ({quality_value:.1f}).", True
        if quality_value < 65:
            return f"Representative image quality is acceptable but not ideal ({quality_value:.1f}).", False
        return f"Representative image quality is strong ({quality_value:.1f}).", False

    def _learning_signal(
        self,
        *,
        outcome: str,
        confidence: float | None,
        quality_is_problematic: bool,
        similar_case_count: int,
        text_evidence_count: int,
        agreement_rate: float | None,
        polymicrobial: bool,
    ) -> str:
        if outcome == "correct":
            if confidence is not None and confidence < 0.65:
                return "correct_but_low_margin"
            return "retain_as_reference"
        if quality_is_problematic:
            return "low_quality_watch"
        if polymicrobial:
            return "label_review_or_multilabel_watch"
        if confidence is not None and confidence >= 0.85 and agreement_rate is not None and agreement_rate >= 0.8:
            return "hard_case_priority"
        if similar_case_count == 0 and text_evidence_count == 0:
            return "collect_more_reference_cases"
        return "boundary_case_review"

    def _root_cause_note(self, code: str) -> str | None:
        mapping = {
            "shortcut_suspected": "The failure pattern is consistent with a shortcut-style blind spot rather than a localized lesion-focused read.",
            "domain_shift": "Recent misses from this site show a concentrated pattern, which raises concern for site-specific domain shift.",
            "label_review_needed": "The case metadata suggests label ambiguity or mixed-organism review is still warranted.",
            "natural_boundary": "The case looks close to a natural decision boundary rather than a single obvious failure mode.",
            "low_quality": "Input quality is low enough to weaken the reliability of the visual evidence.",
            "data_sparse": "Reference support around this case profile is sparse, so the model is extrapolating from limited nearby examples.",
        }
        return mapping.get(str(code or "").strip())

    def _action_note(self, code: str) -> str | None:
        mapping = {
            "hard_case_train": "Queue this case for hard-case review and targeted retraining once the label is trusted.",
            "collect_more_cases": "Collect more reference cases around this phenotype before overfitting to a single explanation.",
            "exclude_from_train": "Exclude this case from automatic training until quality or label uncertainty is resolved.",
            "site_weight_watch": "Monitor this site's aggregation weight if the same miss pattern keeps repeating.",
            "human_review": "Escalate this case for human review before treating the model explanation as reliable.",
        }
        return mapping.get(str(code or "").strip())

    def _build_local_fallback(
        self,
        *,
        analysis_context: dict[str, Any],
    ) -> dict[str, Any]:
        classification_context = dict(analysis_context.get("classification_context") or {})
        query_case = dict(analysis_context.get("query_case") or {})
        artifact_summary = dict(analysis_context.get("artifact_summary") or {})
        model_consensus = dict(analysis_context.get("model_consensus") or {})
        retrieval_summary = dict(analysis_context.get("retrieval_summary") or {})
        similar_cases = list(analysis_context.get("similar_cases") or [])
        text_evidence = list(analysis_context.get("text_evidence") or [])
        differential = dict(analysis_context.get("differential") or {})
        structured_analysis = dict(analysis_context.get("structured_analysis") or {})
        structured_scores = dict(structured_analysis.get("scores") or {})
        root_cause_tags = [str(item).strip() for item in list(structured_analysis.get("root_cause_tags") or []) if str(item).strip()]
        action_tags = [str(item).strip() for item in list(structured_analysis.get("action_tags") or []) if str(item).strip()]

        predicted_label = self._format_label(classification_context.get("predicted_label"))
        true_label = self._format_label(classification_context.get("true_label"))
        is_correct = classification_context.get("is_correct")
        outcome = "correct" if is_correct is True else "incorrect" if is_correct is False else "unknown"
        confidence = self._predicted_class_confidence(classification_context)
        confidence_band = self._confidence_band(confidence)
        similar_majority = self._format_label(retrieval_summary.get("similar_majority") or self._majority_category(similar_cases))
        text_majority = self._format_label(retrieval_summary.get("text_majority") or self._majority_category(text_evidence))
        agreement_rate = model_consensus.get("agreement_rate")
        try:
            agreement_rate_value = _clamp01(float(agreement_rate))
        except (TypeError, ValueError):
            agreement_rate_value = None
        similar_case_count = int(retrieval_summary.get("similar_case_count") or len(similar_cases))
        text_evidence_count = int(retrieval_summary.get("text_evidence_count") or len(text_evidence))
        quality_note, quality_is_problematic = self._quality_note(query_case)
        metadata_conflict_note = self._metadata_conflict_note(query_case, predicted_label)
        differential_top_label = self._format_label(retrieval_summary.get("differential_top_label") or differential.get("top_label"))
        polymicrobial = bool(query_case.get("polymicrobial"))

        likely_causes: list[str] = []
        supporting_evidence: list[str] = []
        contradictory_evidence: list[str] = []
        follow_up_actions: list[str] = [
            "Review the corneal crop, lesion crop, and Grad-CAM together before drawing conclusions from the prediction.",
        ]

        summary_parts: list[str] = []
        if outcome == "correct":
            summary_parts.append(f"The prediction matched the culture label ({true_label}).")
        elif outcome == "incorrect":
            summary_parts.append(f"The model favored {predicted_label}, but culture confirmed {true_label}.")
        else:
            summary_parts.append(f"The model currently favors {predicted_label}, and final correctness is not available.")

        if confidence is not None:
            summary_parts.append(f"Predicted-class confidence was {confidence:.2f} ({confidence_band}).")
        if quality_note:
            summary_parts.append(quality_note)
        if root_cause_tags:
            summary_parts.append("Structured root-cause tags were: " + ", ".join(root_cause_tags[:3]) + ".")

        if outcome == "correct":
            likely_causes.append("The core visual and metadata signals appear directionally aligned with the final label.")
            if confidence is not None and confidence < 0.65:
                likely_causes.append("The prediction was correct but low-margin, so the case still looks close to a decision boundary.")
            if similar_majority == predicted_label and predicted_label != "unknown":
                supporting_evidence.append(f"Similar-case retrieval also leaned toward {predicted_label}.")
            if text_majority == predicted_label and predicted_label != "unknown":
                supporting_evidence.append(f"Retrieved text evidence leaned toward {predicted_label}.")
            if agreement_rate_value is not None and agreement_rate_value >= 0.8:
                supporting_evidence.append(f"Model agreement was high ({agreement_rate_value:.0%}).")
            if quality_is_problematic and quality_note:
                contradictory_evidence.append(quality_note)
            follow_up_actions.append("Keep this case as a reference example for calibration and qualitative review.")
        else:
            if confidence is not None and confidence >= 0.85:
                likely_causes.append("The model was confident in the wrong direction, which suggests an overconfident blind spot.")
            elif confidence is not None and confidence < 0.6:
                likely_causes.append("The model was already uncertain, which is more consistent with a boundary case than a hard blind spot.")
            if quality_is_problematic and quality_note:
                likely_causes.append("Image quality may have weakened the visual evidence available to the model.")
            if metadata_conflict_note:
                likely_causes.append(metadata_conflict_note)
            if agreement_rate_value is not None and agreement_rate_value < 0.67:
                likely_causes.append("Different model components disagreed, which suggests an unstable or naturally ambiguous case.")
            elif agreement_rate_value is not None and agreement_rate_value >= 0.8:
                likely_causes.append("Multiple model components agreed on the wrong label, which raises the chance of a shared shortcut or dataset bias.")
            if similar_case_count == 0 and text_evidence_count == 0:
                likely_causes.append("Local reference evidence is sparse for this case profile.")
            if similar_majority == true_label and true_label != "unknown":
                contradictory_evidence.append(f"Similar-case retrieval leaned toward the ground-truth label ({true_label}).")
            elif similar_majority == predicted_label and predicted_label != "unknown":
                supporting_evidence.append(f"Similar-case retrieval leaned toward the model-leading label ({predicted_label}).")
            if text_majority == true_label and true_label != "unknown":
                contradictory_evidence.append(f"Retrieved text evidence leaned toward the ground-truth label ({true_label}).")
            elif text_majority == predicted_label and predicted_label != "unknown":
                supporting_evidence.append(f"Retrieved text evidence leaned toward the model-leading label ({predicted_label}).")
            if differential_top_label == true_label and true_label != "unknown":
                contradictory_evidence.append(f"The fused differential already ranked the ground-truth label ({true_label}) first.")
            elif differential_top_label == predicted_label and predicted_label != "unknown":
                supporting_evidence.append(f"The fused differential also ranked {predicted_label} first.")
            follow_up_actions.append("Escalate this case for manual review before using it as a straightforward training example.")
            follow_up_actions.append("If the miss was confident and repeatable, add it to the hard-case review pool.")

        has_cornea_gradcam = bool(artifact_summary.get("has_cornea_gradcam"))
        has_lesion_gradcam = bool(artifact_summary.get("has_lesion_gradcam"))
        if has_cornea_gradcam and has_lesion_gradcam:
            supporting_evidence.append("Branch-aware Grad-CAM is available for both cornea and lesion crops.")
        elif has_cornea_gradcam:
            supporting_evidence.append("Branch-aware Grad-CAM is available for the cornea-context branch.")
        elif has_lesion_gradcam:
            supporting_evidence.append("Branch-aware Grad-CAM is available for the lesion-detail branch.")
        elif artifact_summary.get("has_gradcam"):
            supporting_evidence.append("Grad-CAM is available for visual attention review.")
        else:
            contradictory_evidence.append("No Grad-CAM artifact was available for attention review.")
        if artifact_summary.get("crop_mode"):
            supporting_evidence.append(f"Model input used {artifact_summary.get('crop_mode')} crop mode.")
        for code in root_cause_tags:
            note = self._root_cause_note(code)
            if note and note not in likely_causes:
                likely_causes.append(note)
        for code in action_tags:
            note = self._action_note(code)
            if note and note not in follow_up_actions:
                follow_up_actions.append(note)
        cam_overlap_score = structured_scores.get("cam_overlap_score")
        if isinstance(cam_overlap_score, (int, float)):
            if float(cam_overlap_score) < 0.35:
                contradictory_evidence.append(f"Grad-CAM overlap with the lesion region was low ({float(cam_overlap_score):.2f}).")
            else:
                supporting_evidence.append(f"Grad-CAM overlap with the lesion region was acceptable ({float(cam_overlap_score):.2f}).")
        lesion_cam_overlap_score = structured_scores.get("cam_lesion_overlap_score")
        if isinstance(lesion_cam_overlap_score, (int, float)):
            if float(lesion_cam_overlap_score) < 0.35:
                contradictory_evidence.append(
                    f"Lesion-branch Grad-CAM overlap stayed low ({float(lesion_cam_overlap_score):.2f})."
                )
            else:
                supporting_evidence.append(
                    f"Lesion-branch Grad-CAM overlap was acceptable ({float(lesion_cam_overlap_score):.2f})."
                )
        cornea_cam_overlap_score = structured_scores.get("cam_cornea_overlap_score")
        if isinstance(cornea_cam_overlap_score, (int, float)):
            if float(cornea_cam_overlap_score) < 0.35:
                contradictory_evidence.append(
                    f"Cornea-context Grad-CAM overlap remained limited ({float(cornea_cam_overlap_score):.2f})."
                )
            else:
                supporting_evidence.append(
                    f"Cornea-context Grad-CAM overlap was acceptable ({float(cornea_cam_overlap_score):.2f})."
                )
        disagreement_score = structured_scores.get("multi_model_disagreement")
        if isinstance(disagreement_score, (int, float)):
            if float(disagreement_score) >= 0.35:
                contradictory_evidence.append(f"Peer-model disagreement was elevated ({float(disagreement_score):.2f}).")
            else:
                supporting_evidence.append(f"Peer-model disagreement remained limited ({float(disagreement_score):.2f}).")
        if not likely_causes:
            likely_causes.append("The currently available signals do not isolate a single dominant explanation.")

        learning_signal = str(structured_analysis.get("learning_signal") or "").strip() or self._learning_signal(
            outcome=outcome,
            confidence=confidence,
            quality_is_problematic=quality_is_problematic,
            similar_case_count=similar_case_count,
            text_evidence_count=text_evidence_count,
            agreement_rate=agreement_rate_value,
            polymicrobial=polymicrobial,
        )
        uncertainty = (
            "Moderate to high uncertainty remains because the available signals are mixed, weak, or incomplete."
            if quality_is_problematic or similar_case_count == 0 or text_evidence_count == 0 or confidence_band in {"low", "unknown"}
            else "Uncertainty is limited because classifier, retrieval, and metadata signals are reasonably aligned."
        )

        return {
            "mode": "local_fallback",
            "model": None,
            "generated_at": utc_now(),
            "outcome": outcome,
            "summary": " ".join(summary_parts),
            "likely_causes": likely_causes[:4],
            "supporting_evidence": supporting_evidence[:5],
            "contradictory_evidence": contradictory_evidence[:5],
            "follow_up_actions": follow_up_actions[:4],
            "learning_signal": learning_signal,
            "uncertainty": uncertainty,
            "disclaimer": "Prediction post-mortem is research support only. Final diagnosis and treatment decisions remain with the treating clinician.",
        }

    def _build_llm_payload(self, *, analysis_context: dict[str, Any]) -> dict[str, Any]:
        prediction_snapshot = dict(analysis_context.get("prediction_snapshot") or {})
        structured_analysis = dict(analysis_context.get("structured_analysis") or {})
        return {
            "query_case": analysis_context.get("query_case") or {},
            "model_version": analysis_context.get("model_version") or {},
            "classification_context": analysis_context.get("classification_context") or {},
            "artifact_summary": analysis_context.get("artifact_summary") or {},
            "model_consensus": analysis_context.get("model_consensus") or {},
            "retrieval_summary": analysis_context.get("retrieval_summary") or {},
            "prediction_snapshot": {
                "predicted_label": prediction_snapshot.get("predicted_label"),
                "prediction_probability": prediction_snapshot.get("prediction_probability"),
                "predicted_confidence": prediction_snapshot.get("predicted_confidence"),
                "crop_mode": prediction_snapshot.get("crop_mode"),
                "representative_view": prediction_snapshot.get("representative_view"),
                "representative_quality_score": prediction_snapshot.get("representative_quality_score"),
                "representative_view_score": prediction_snapshot.get("representative_view_score"),
                "classifier_embedding_id": ((prediction_snapshot.get("classifier_embedding") or {}).get("embedding_id")),
                "dinov2_embedding_id": ((prediction_snapshot.get("dinov2_embedding") or {}).get("embedding_id")),
                "peer_model_consensus": prediction_snapshot.get("peer_model_consensus"),
            },
            "structured_analysis": {
                "outcome": structured_analysis.get("outcome"),
                "prediction_confidence": structured_analysis.get("prediction_confidence"),
                "learning_signal": structured_analysis.get("learning_signal"),
                "root_cause_tags": structured_analysis.get("root_cause_tags") or [],
                "action_tags": structured_analysis.get("action_tags") or [],
                "scores": structured_analysis.get("scores") or {},
            },
            "similar_cases": [
                {
                    "culture_category": item.get("culture_category"),
                    "culture_species": item.get("culture_species"),
                    "visit_status": item.get("visit_status"),
                    "active_stage": item.get("active_stage"),
                    "representative_view": item.get("representative_view"),
                    "contact_lens_use": item.get("contact_lens_use"),
                    "predisposing_factor": item.get("predisposing_factor"),
                    "smear_result": item.get("smear_result"),
                    "polymicrobial": item.get("polymicrobial"),
                    "quality_score": item.get("quality_score"),
                    "similarity": item.get("similarity"),
                    "metadata_reranking": item.get("metadata_reranking"),
                }
                for item in list(analysis_context.get("similar_cases") or [])[:3]
            ],
            "text_evidence": [
                {
                    "culture_category": item.get("culture_category"),
                    "culture_species": item.get("culture_species"),
                    "similarity": item.get("similarity"),
                    "text": item.get("text"),
                }
                for item in list(analysis_context.get("text_evidence") or [])[:3]
            ],
            "differential": [
                {
                    "label": item.get("label"),
                    "score": item.get("score"),
                    "confidence_band": item.get("confidence_band"),
                    "supporting_evidence": item.get("supporting_evidence"),
                    "conflicting_evidence": item.get("conflicting_evidence"),
                }
                for item in list((analysis_context.get("differential") or {}).get("differential") or [])[:3]
            ],
        }

    def _generate_openai_postmortem(
        self,
        *,
        analysis_context: dict[str, Any],
    ) -> dict[str, Any]:
        system_prompt = (
            "You are K-ERA Post-mortem, a research support assistant for infectious keratitis validation review. "
            "Explain why a prediction may have matched or mismatched the culture label. "
            "Do not make a diagnosis. Do not prescribe treatment, dosing, or procedures. "
            "Focus on model behavior, evidence alignment, possible shortcut risk, data sparsity, input quality, and uncertainty. "
            "Treat metadata conflict, retrieval disagreement, and multi-model disagreement as important root-cause clues."
        )
        payload = self._build_llm_payload(analysis_context=analysis_context)
        schema = {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "outcome": {"type": "string"},
                "summary": {"type": "string"},
                "likely_causes": {"type": "array", "items": {"type": "string"}},
                "supporting_evidence": {"type": "array", "items": {"type": "string"}},
                "contradictory_evidence": {"type": "array", "items": {"type": "string"}},
                "follow_up_actions": {"type": "array", "items": {"type": "string"}},
                "learning_signal": {"type": "string"},
                "uncertainty": {"type": "string"},
            },
            "required": [
                "outcome",
                "summary",
                "likely_causes",
                "supporting_evidence",
                "contradictory_evidence",
                "follow_up_actions",
                "learning_signal",
                "uncertainty",
            ],
        }
        request_body = {
            "model": self._model,
            "input": [
                {
                    "role": "system",
                    "content": [{"type": "input_text", "text": system_prompt}],
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_text",
                            "text": "Generate a JSON prediction post-mortem from this validation context:\n"
                            + json.dumps(payload, ensure_ascii=True),
                        }
                    ],
                },
            ],
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "prediction_postmortem",
                    "strict": True,
                    "schema": schema,
                }
            },
        }
        try:
            import httpx
        except ImportError as exc:
            raise RuntimeError("OpenAI prediction post-mortem requires httpx to be installed.") from exc
        with httpx.Client(timeout=self._timeout_seconds) as client:
            response = client.post(
                self._base_url,
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                },
                json=request_body,
            )
            response.raise_for_status()
            payload = response.json()

        output_text = self._extract_output_text(payload)
        if not output_text:
            raise RuntimeError("The LLM response did not include structured output text.")
        parsed = self._parse_response_json(output_text)
        return {
            "mode": "openai",
            "model": self._model,
            "generated_at": utc_now(),
            "outcome": str(parsed.get("outcome") or "").strip(),
            "summary": str(parsed.get("summary") or "").strip(),
            "likely_causes": [str(item).strip() for item in parsed.get("likely_causes") or [] if str(item).strip()],
            "supporting_evidence": [str(item).strip() for item in parsed.get("supporting_evidence") or [] if str(item).strip()],
            "contradictory_evidence": [str(item).strip() for item in parsed.get("contradictory_evidence") or [] if str(item).strip()],
            "follow_up_actions": [str(item).strip() for item in parsed.get("follow_up_actions") or [] if str(item).strip()],
            "learning_signal": str(parsed.get("learning_signal") or "").strip(),
            "uncertainty": str(parsed.get("uncertainty") or "").strip(),
        }

    def _generate_relay_postmortem(
        self,
        *,
        analysis_context: dict[str, Any],
    ) -> dict[str, Any]:
        system_prompt = (
            "You are K-ERA Post-mortem. Return JSON only with keys: outcome, summary, likely_causes, "
            "supporting_evidence, contradictory_evidence, follow_up_actions, learning_signal, uncertainty. "
            "Do not output markdown. Do not diagnose or prescribe treatment."
        )
        payload = self._build_llm_payload(analysis_context=analysis_context)
        relay_result = self._remote_control_plane.relay_ai_clinic(
            input_text=(
                "Generate a JSON prediction post-mortem from this validation context. "
                "The JSON must match the exact keys already specified.\n"
                + json.dumps(payload, ensure_ascii=True)
            ),
            system_prompt=system_prompt,
            model=self._model,
        )
        output_text = str(relay_result.get("output_text") or "").strip()
        if not output_text:
            raise RuntimeError("The control plane relay returned no output text.")
        parsed = self._parse_response_json(output_text)
        return {
            "mode": "control_plane_relay",
            "model": str(relay_result.get("model") or self._model),
            "generated_at": utc_now(),
            "outcome": str(parsed.get("outcome") or "").strip(),
            "summary": str(parsed.get("summary") or "").strip(),
            "likely_causes": [str(item).strip() for item in parsed.get("likely_causes") or [] if str(item).strip()],
            "supporting_evidence": [str(item).strip() for item in parsed.get("supporting_evidence") or [] if str(item).strip()],
            "contradictory_evidence": [str(item).strip() for item in parsed.get("contradictory_evidence") or [] if str(item).strip()],
            "follow_up_actions": [str(item).strip() for item in parsed.get("follow_up_actions") or [] if str(item).strip()],
            "learning_signal": str(parsed.get("learning_signal") or "").strip(),
            "uncertainty": str(parsed.get("uncertainty") or "").strip(),
        }

    def _parse_response_json(self, output_text: str) -> dict[str, Any]:
        normalized = str(output_text or "").strip()
        if normalized.startswith("```"):
            normalized = normalized.strip("`").strip()
            if normalized.lower().startswith("json"):
                normalized = normalized[4:].strip()
        parsed = json.loads(normalized)
        if not isinstance(parsed, dict):
            raise RuntimeError("The LLM response was not a JSON object.")
        return parsed

    def _extract_output_text(self, payload: dict[str, Any]) -> str:
        direct = str(payload.get("output_text") or "").strip()
        if direct:
            return direct
        for output_item in payload.get("output") or []:
            for content in output_item.get("content") or []:
                if content.get("type") in {"output_text", "text"}:
                    text = str(content.get("text") or "").strip()
                    if text:
                        return text
        return ""
