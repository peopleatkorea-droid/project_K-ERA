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

    def _format_query_metadata_summary(self, query_case: dict[str, Any]) -> str | None:
        fragments: list[str] = []
        sex = self._format_label(query_case.get("sex"))
        age = query_case.get("age")
        if sex != "unknown" or age not in (None, ""):
            fragments.append(f"Demographics: {sex}, age {age if age not in (None, '') else 'unknown'}.")
        view = self._format_label(query_case.get("representative_view"))
        visit_status = self._format_label(query_case.get("visit_status"))
        if view != "unknown" or visit_status != "unknown":
            fragments.append(f"Image/view context: {view} view, visit status {visit_status}.")
        contact_lens = self._format_label(query_case.get("contact_lens_use"))
        if contact_lens != "unknown":
            fragments.append(f"Contact lens history: {contact_lens}.")
        smear_result = self._format_label(query_case.get("smear_result"))
        if smear_result != "unknown":
            fragments.append(f"Smear result: {smear_result}.")
        if bool(query_case.get("polymicrobial")):
            fragments.append("Case metadata indicates polymicrobial risk.")
        predisposing = [str(item).strip() for item in list(query_case.get("predisposing_factor") or []) if str(item).strip()]
        if predisposing:
            fragments.append(f"Predisposing factors: {', '.join(predisposing)}.")
        quality_score = query_case.get("quality_score")
        if isinstance(quality_score, (int, float)):
            fragments.append(f"Representative image quality score: {float(quality_score):.1f}.")
        return " ".join(fragments) if fragments else None

    def _metadata_conflict_flags(self, similar_cases: list[dict[str, Any]]) -> list[str]:
        flags: list[str] = []
        for item in similar_cases[:3]:
            reranking = item.get("metadata_reranking") or {}
            alignment = reranking.get("alignment") or {}
            conflicted = [str(field).strip() for field in list(alignment.get("conflicted_fields") or []) if str(field).strip()]
            if not conflicted:
                continue
            case_code = str(item.get("local_case_code") or item.get("chart_alias") or item.get("patient_id") or "retrieved case").strip()
            flags.append(f"{case_code} conflicts on metadata: {', '.join(conflicted)}.")
        return flags

    def _build_local_fallback(
        self,
        *,
        report: dict[str, Any],
        classification_context: dict[str, Any] | None,
    ) -> dict[str, Any]:
        prediction = classification_context or {}
        predicted_label = self._format_label(prediction.get("predicted_label"))
        probability = prediction.get("prediction_probability")
        confidence = float(probability) if isinstance(probability, (int, float)) else None
        similar_cases = list(report.get("similar_cases") or [])
        text_evidence = list(report.get("text_evidence") or [])
        similar_majority = self._majority_category(similar_cases)
        text_majority = self._majority_category(text_evidence)
        query_case = dict(report.get("query_case") or {})
        low_confidence = confidence is None or confidence < 0.7
        signals = [item for item in [predicted_label, similar_majority, text_majority] if item and item != "unknown"]
        aligned = len(set(signals)) <= 1 if signals else False
        differential = dict(report.get("differential") or {})
        top_differential = list(differential.get("differential") or [])[:1]

        summary_parts = [
            f"The classifier currently favors {predicted_label}.",
        ]
        if confidence is not None:
            summary_parts.append(f"Case-level confidence is {confidence:.3f}.")
        if top_differential:
            summary_parts.append(
                f"Differential ranking currently places {top_differential[0].get('label', 'unknown')} first "
                f"with score {float(top_differential[0].get('score') or 0.0):.2f}."
            )
        query_metadata_summary = self._format_query_metadata_summary(query_case)
        if query_metadata_summary:
            summary_parts.append(query_metadata_summary)
        if similar_majority:
            summary_parts.append(f"Similar patient retrieval leans toward {similar_majority}.")
        if text_majority:
            summary_parts.append(f"Retrieved case text leans toward {text_majority}.")

        recommended_steps = [
            "Review the corneal crop, lesion crop, and Grad-CAM together before accepting the classifier output.",
            "Compare the top similar patients against the current slit-lamp pattern, especially lesion morphology and surrounding corneal context.",
            "Cross-check smear, culture, contact lens exposure, trauma, steroid use, and visit trajectory against the retrieved evidence.",
        ]
        if aligned and not low_confidence:
            recommended_steps.append(
                "Because classifier and retrieval signals are aligned, prioritize confirming that the microbiology and clinical course support the same category."
            )
        else:
            recommended_steps.append(
                "Because the signals are mixed or low-confidence, escalate to manual review and keep the differential broad until microbiology and serial follow-up are reconciled."
            )

        flags_to_review: list[str] = []
        if low_confidence:
            flags_to_review.append("Classifier confidence is limited for this case.")
        if similar_majority and similar_majority != predicted_label:
            flags_to_review.append("Similar-patient retrieval does not agree with the classifier-leading category.")
        if text_majority and text_majority != predicted_label:
            flags_to_review.append("Retrieved text evidence does not agree with the classifier-leading category.")
        if report.get("text_retrieval_mode") == "unavailable":
            flags_to_review.append("BiomedCLIP text retrieval is unavailable in the current runtime.")
        flags_to_review.extend(self._metadata_conflict_flags(similar_cases))
        if not similar_cases:
            flags_to_review.append("No patient-level similar cases were retrieved.")
        if not text_evidence:
            flags_to_review.append("No text evidence was retrieved.")
        if not flags_to_review:
            flags_to_review.append("No major conflict was detected across the currently available signals.")

        uncertainty = (
            "Retrieval and classifier signals are directionally aligned."
            if aligned and not low_confidence
            else "Workflow advice should be treated cautiously because the available signals are mixed, weak, or incomplete."
        )
        rationale = (
            "The recommendation combines the latest classifier output with patient-deduplicated similar cases and case-text retrieval, then converts agreement and disagreement into review steps."
        )
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
            "If retrieved cases differ in contact lens history, smear result, polymicrobial status, or predisposing factors, explicitly mention those differences."
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
            "Do not output markdown. Do not make a definitive diagnosis or prescribe treatment."
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
