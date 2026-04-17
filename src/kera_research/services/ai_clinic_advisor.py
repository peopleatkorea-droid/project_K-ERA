from __future__ import annotations

import json
import os
from typing import Any

from kera_research.domain import utc_now
from kera_research.services.remote_control_plane import RemoteControlPlaneClient


class AiClinicWorkflowAdvisor:
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

    def _provider_label(self, mode: str | None) -> str:
        normalized = str(mode or "").strip().lower()
        if normalized == "openai":
            return "OpenAI-compatible guidance"
        if normalized == "control_plane_relay":
            return "Control-plane relay guidance"
        return "Rules-based local guidance"

    def generate_workflow_recommendation(
        self,
        *,
        report: dict[str, Any],
        classification_context: dict[str, Any] | None,
    ) -> dict[str, Any]:
        fallback = self._build_local_fallback(
            report=report,
            classification_context=classification_context,
        )
        try:
            if self._api_key and not self._relay_only:
                llm_result = self._generate_openai_recommendation(
                    report=report,
                    classification_context=classification_context,
                )
            elif self._remote_control_plane.is_configured() and self._remote_control_plane.has_node_credentials():
                llm_result = self._generate_relay_recommendation(
                    report=report,
                    classification_context=classification_context,
                )
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

    def _format_label(self, value: str | None) -> str:
        normalized = str(value or "").strip()
        return normalized if normalized else "unknown"

    def _clamp01(self, value: Any) -> float | None:
        try:
            return max(0.0, min(1.0, float(value)))
        except (TypeError, ValueError):
            return None

    def _predicted_class_confidence(self, prediction: dict[str, Any]) -> float | None:
        direct_confidence = self._clamp01(prediction.get("predicted_confidence"))
        if direct_confidence is not None:
            return direct_confidence
        predicted_label = self._format_label(prediction.get("predicted_label")).lower()
        positive_probability = self._clamp01(prediction.get("prediction_probability"))
        if positive_probability is None:
            return None
        if predicted_label == "bacterial":
            return round(1.0 - positive_probability, 4)
        if predicted_label == "fungal":
            return round(positive_probability, 4)
        return round(max(positive_probability, 1.0 - positive_probability), 4)

    def _format_confidence(self, confidence: float | None) -> str | None:
        if confidence is None:
            return None
        return f"{confidence:.0%}"

    def _key_case_context_notes(self, query_case: dict[str, Any]) -> list[str]:
        notes: list[str] = []
        smear_result = self._format_label(query_case.get("smear_result")).lower()
        if smear_result == "not done":
            notes.append("Smear is not available yet.")
        elif smear_result not in {"unknown", ""}:
            notes.append(f"Smear result: {smear_result}.")

        contact_lens = self._format_label(query_case.get("contact_lens_use")).lower()
        if contact_lens not in {"unknown", "", "none"}:
            notes.append(f"Contact lens history: {contact_lens}.")

        predisposing = [
            str(item).strip()
            for item in list(query_case.get("predisposing_factor") or [])
            if str(item).strip()
        ]
        if predisposing:
            notes.append(f"Predisposing factors: {', '.join(predisposing)}.")

        if bool(query_case.get("polymicrobial")):
            notes.append("Polymicrobial risk is present.")

        quality_score = self._clamp01((float(query_case.get("quality_score")) / 100.0) if isinstance(query_case.get("quality_score"), (int, float)) else None)
        if quality_score is not None and quality_score < 0.7:
            notes.append(f"Representative image quality is limited ({float(query_case.get('quality_score')):.1f}/100).")

        visit_status = self._format_label(query_case.get("visit_status")).lower()
        if visit_status not in {"unknown", "", "active"}:
            notes.append(f"Current visit status is {visit_status}.")
        return notes

    def _metadata_conflict_flags(self, similar_cases: list[dict[str, Any]]) -> list[str]:
        flags: list[str] = []
        for item in similar_cases[:3]:
            reranking = item.get("metadata_reranking") or {}
            alignment = reranking.get("alignment") or {}
            conflicted = [str(field).strip() for field in list(alignment.get("conflicted_fields") or []) if str(field).strip()]
            if not conflicted:
                continue
            case_code = str(item.get("local_case_code") or item.get("chart_alias") or item.get("patient_id") or "retrieved case").strip()
            flags.append(f"{case_code} metadata conflict: {', '.join(conflicted)}.")
        return flags

    def _confidence_is_low(self, confidence: float | None) -> bool:
        return confidence is None or confidence < 0.7

    def _build_local_fallback(
        self,
        *,
        report: dict[str, Any],
        classification_context: dict[str, Any] | None,
    ) -> dict[str, Any]:
        prediction = classification_context or {}
        predicted_label = self._format_label(prediction.get("predicted_label"))
        confidence = self._predicted_class_confidence(prediction)
        similar_cases = list(report.get("similar_cases") or [])
        text_evidence = list(report.get("text_evidence") or [])
        similar_majority = self._majority_category(similar_cases)
        text_majority = self._majority_category(text_evidence)
        query_case = dict(report.get("query_case") or {})
        low_confidence = self._confidence_is_low(confidence)
        signals = [item for item in [predicted_label, similar_majority, text_majority] if item and item != "unknown"]
        aligned = len(set(signals)) <= 1 if signals else False
        differential = dict(report.get("differential") or {})
        top_differential = list(differential.get("differential") or [])[:1]

        summary_parts = []
        classifier_summary = f"Classifier: {predicted_label}"
        formatted_confidence = self._format_confidence(confidence)
        if formatted_confidence:
            classifier_summary += f" ({formatted_confidence} confidence)"
        classifier_summary += "."
        summary_parts.append(classifier_summary)
        if top_differential:
            summary_parts.append(
                f"Differential lead: {top_differential[0].get('label', 'unknown')} "
                f"({float(top_differential[0].get('score') or 0.0):.2f})."
            )
        if similar_majority and text_majority and similar_majority != text_majority:
            summary_parts.append(
                f"Evidence is mixed: similar cases lean {similar_majority} while text evidence leans {text_majority}."
            )
        elif similar_majority and similar_majority != predicted_label:
            summary_parts.append(f"Similar cases lean {similar_majority}, not {predicted_label}.")
        elif text_majority and text_majority != predicted_label:
            summary_parts.append(f"Text evidence leans {text_majority}, not {predicted_label}.")
        elif similar_majority and text_majority and similar_majority == text_majority == predicted_label:
            summary_parts.append("Classifier, similar cases, and text evidence are broadly aligned.")
        summary_parts.extend(self._key_case_context_notes(query_case)[:2])

        recommended_steps = [
            "Review the representative image, crop views, and Grad-CAM together before accepting the label.",
            (
                "Compare the top similar cases to lesion morphology and surrounding corneal context."
                if similar_cases
                else "Rely on microbiology and serial slit-lamp change because similar-case support is unavailable."
            ),
        ]
        if aligned and not low_confidence:
            recommended_steps.append(
                f"If microbiology and follow-up agree, you can narrow the review toward {predicted_label}."
            )
        else:
            recommended_steps.append(
                "Keep the differential broad until smear, culture, risk factors, and follow-up are reconciled."
            )

        flags_to_review: list[str] = []
        if low_confidence:
            flags_to_review.append("Classifier confidence is low.")
        if similar_majority and similar_majority != predicted_label:
            flags_to_review.append(f"Similar cases favor {similar_majority}, not {predicted_label}.")
        if text_majority and text_majority != predicted_label:
            flags_to_review.append(f"Text evidence favors {text_majority}, not {predicted_label}.")
        if report.get("text_retrieval_mode") == "unavailable":
            flags_to_review.append("Text retrieval is unavailable in this runtime.")
        flags_to_review.extend(self._metadata_conflict_flags(similar_cases))
        if not similar_cases:
            flags_to_review.append("No patient-level similar cases were retrieved.")
        if not text_evidence:
            flags_to_review.append("No case-text evidence was retrieved.")
        if not flags_to_review:
            flags_to_review.append("No major cross-signal conflict is currently visible.")

        if aligned and not low_confidence:
            uncertainty = "Lower uncertainty: classifier and retrieval signals are broadly aligned."
        elif low_confidence and any(flag for flag in flags_to_review if "favor" in flag or "unavailable" in flag.lower()):
            uncertainty = "High uncertainty: classifier confidence is low and supporting evidence is mixed or incomplete."
        else:
            uncertainty = "Moderate uncertainty: only partial agreement is present across classifier, retrieval, and metadata."
        rationale = "Built from the latest classifier result, patient-deduplicated similar cases, and case-text retrieval."
        return {
            "mode": "local_fallback",
            "provider_label": self._provider_label("local_fallback"),
            "model": None,
            "generated_at": utc_now(),
            "summary": " ".join(summary_parts),
            "recommended_steps": recommended_steps,
            "flags_to_review": flags_to_review,
            "rationale": rationale,
            "uncertainty": uncertainty,
            "disclaimer": "AI Clinic workflow advice is decision support only. Final diagnosis and treatment decisions remain with the treating clinician.",
        }

    def _build_llm_payload(
        self,
        *,
        report: dict[str, Any],
        classification_context: dict[str, Any] | None,
    ) -> dict[str, Any]:
        return {
            "query_case": report.get("query_case") or {},
            "model_version": report.get("model_version") or {},
            "classification_context": classification_context or {},
            "similar_cases": [
                {
                    "culture_category": item.get("culture_category"),
                    "culture_species": item.get("culture_species"),
                    "visit_status": item.get("visit_status"),
                    "active_stage": item.get("active_stage"),
                    "representative_view": item.get("representative_view"),
                    "sex": item.get("sex"),
                    "age": item.get("age"),
                    "contact_lens_use": item.get("contact_lens_use"),
                    "predisposing_factor": item.get("predisposing_factor"),
                    "smear_result": item.get("smear_result"),
                    "polymicrobial": item.get("polymicrobial"),
                    "quality_score": item.get("quality_score"),
                    "similarity": item.get("similarity"),
                    "base_similarity": item.get("base_similarity"),
                    "metadata_reranking": item.get("metadata_reranking"),
                }
                for item in list(report.get("similar_cases") or [])[:3]
            ],
            "text_evidence": [
                {
                    "culture_category": item.get("culture_category"),
                    "culture_species": item.get("culture_species"),
                    "similarity": item.get("similarity"),
                    "text": item.get("text"),
                }
                for item in list(report.get("text_evidence") or [])[:3]
            ],
            "differential": [
                {
                    "label": item.get("label"),
                    "score": item.get("score"),
                    "confidence_band": item.get("confidence_band"),
                    "supporting_evidence": item.get("supporting_evidence"),
                    "conflicting_evidence": item.get("conflicting_evidence"),
                }
                for item in list((report.get("differential") or {}).get("differential") or [])[:3]
            ],
            "text_retrieval_mode": report.get("text_retrieval_mode"),
        }

    def _generate_openai_recommendation(
        self,
        *,
        report: dict[str, Any],
        classification_context: dict[str, Any] | None,
    ) -> dict[str, Any]:
        system_prompt = (
            "You are AI Clinic, a clinical workflow support assistant for infectious keratitis review. "
            "Provide workflow guidance only. Do not make a definitive diagnosis. Do not prescribe treatment, dosing, or procedures. "
            "Focus on what a clinician should review next, what conflicts need reconciliation, and where uncertainty remains. "
            "Prioritize microbiology, visit stage, and risk-factor conflicts over pure visual similarity. "
            "Do not treat scar or improving visits as equivalent to active infectious presentations. "
            "If retrieved cases differ in contact lens history, smear result, polymicrobial status, or predisposing factors, explicitly mention those differences. "
            "Keep the summary to at most two short sentences. Return exactly three concise recommended_steps and at most three concise flags_to_review. "
            "Avoid repeating low-value metadata unless it changes the review decision."
        )
        payload = self._build_llm_payload(
            report=report,
            classification_context=classification_context,
        )
        schema = {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "summary": {"type": "string"},
                "recommended_steps": {"type": "array", "items": {"type": "string"}},
                "flags_to_review": {"type": "array", "items": {"type": "string"}},
                "rationale": {"type": "string"},
                "uncertainty": {"type": "string"},
            },
            "required": [
                "summary",
                "recommended_steps",
                "flags_to_review",
                "rationale",
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
                            "text": "Generate a JSON workflow recommendation from this case context:\n"
                            + json.dumps(payload, ensure_ascii=True),
                        }
                    ],
                },
            ],
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "ai_clinic_workflow_recommendation",
                    "strict": True,
                    "schema": schema,
                }
            },
        }
        try:
            import httpx
        except ImportError as exc:
            raise RuntimeError("OpenAI workflow recommendation requires httpx to be installed.") from exc
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
        parsed = self._parse_recommendation_json(output_text)
        return {
            "mode": "openai",
            "provider_label": self._provider_label("openai"),
            "model": self._model,
            "generated_at": utc_now(),
            "summary": str(parsed.get("summary") or "").strip(),
            "recommended_steps": [str(item).strip() for item in parsed.get("recommended_steps") or [] if str(item).strip()],
            "flags_to_review": [str(item).strip() for item in parsed.get("flags_to_review") or [] if str(item).strip()],
            "rationale": str(parsed.get("rationale") or "").strip(),
            "uncertainty": str(parsed.get("uncertainty") or "").strip(),
        }

    def _generate_relay_recommendation(
        self,
        *,
        report: dict[str, Any],
        classification_context: dict[str, Any] | None,
    ) -> dict[str, Any]:
        system_prompt = (
            "You are AI Clinic, a clinical workflow support assistant for infectious keratitis review. "
            "Return JSON only with keys: summary, recommended_steps, flags_to_review, rationale, uncertainty. "
            "Do not output markdown. Do not make a definitive diagnosis or prescribe treatment. "
            "Keep the summary to at most two short sentences. Return exactly three concise recommended_steps and at most three concise flags_to_review."
        )
        payload = self._build_llm_payload(
            report=report,
            classification_context=classification_context,
        )
        relay_result = self._remote_control_plane.relay_ai_clinic(
            input_text=(
                "Generate a JSON workflow recommendation from this case context. "
                "The JSON must match the exact keys already specified.\n"
                + json.dumps(payload, ensure_ascii=True)
            ),
            system_prompt=system_prompt,
            model=self._model,
        )
        output_text = str(relay_result.get("output_text") or "").strip()
        if not output_text:
            raise RuntimeError("The control plane relay returned no output text.")
        parsed = self._parse_recommendation_json(output_text)
        return {
            "mode": "control_plane_relay",
            "provider_label": self._provider_label("control_plane_relay"),
            "model": str(relay_result.get("model") or self._model),
            "generated_at": utc_now(),
            "summary": str(parsed.get("summary") or "").strip(),
            "recommended_steps": [str(item).strip() for item in parsed.get("recommended_steps") or [] if str(item).strip()],
            "flags_to_review": [str(item).strip() for item in parsed.get("flags_to_review") or [] if str(item).strip()],
            "rationale": str(parsed.get("rationale") or "").strip(),
            "uncertainty": str(parsed.get("uncertainty") or "").strip(),
        }

    def _parse_recommendation_json(self, output_text: str) -> dict[str, Any]:
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
