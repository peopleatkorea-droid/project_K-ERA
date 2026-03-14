from __future__ import annotations

from typing import Any

from kera_research.domain import LABEL_TO_INDEX, utc_now


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


class AiClinicDifferentialRanker:
    def __init__(self) -> None:
        self._labels = list(LABEL_TO_INDEX.keys())

    def _normalize_text(self, value: Any) -> str:
        return str(value or "").strip().lower()

    def _normalize_list(self, value: Any) -> list[str]:
        if isinstance(value, list):
            items = value
        else:
            items = str(value or "").split("|")
        return [str(item).strip().lower() for item in items if str(item).strip()]

    def _binary_classifier_scores(self, classification_context: dict[str, Any] | None) -> dict[str, float]:
        if len(self._labels) != 2:
            return {label: 1.0 / max(len(self._labels), 1) for label in self._labels}
        context = classification_context or {}
        raw_probability = context.get("prediction_probability")
        try:
            positive_probability = _clamp01(float(raw_probability))
        except (TypeError, ValueError):
            predicted_label = self._normalize_text(context.get("predicted_label"))
            return {
                label: (0.7 if label == predicted_label else 0.3)
                for label in self._labels
            }

        negative_label, positive_label = self._labels[0], self._labels[1]
        return {
            negative_label: round(1.0 - positive_probability, 4),
            positive_label: round(positive_probability, 4),
        }

    def _weighted_label_support(self, records: list[dict[str, Any]], label: str) -> float:
        if not records:
            return 0.5
        weighted_total = 0.0
        matching_total = 0.0
        for item in records:
            similarity = max(0.0, float(item.get("similarity") or 0.0))
            if similarity <= 0:
                continue
            weighted_total += similarity
            if self._normalize_text(item.get("culture_category")) == label:
                matching_total += similarity
        if weighted_total <= 0:
            return 0.5
        return round(_clamp01(matching_total / weighted_total), 4)

    def _metadata_scores(self, query_case: dict[str, Any]) -> tuple[dict[str, float], dict[str, dict[str, list[str]]]]:
        scores = {label: 0.5 for label in self._labels}
        evidence = {
            label: {"supporting": [], "conflicting": []}
            for label in self._labels
        }

        contact_lens = self._normalize_text(query_case.get("contact_lens_use"))
        if contact_lens in {"soft contact lens", "rigid gas permeable", "orthokeratology"}:
            scores["bacterial"] += 0.18
            evidence["bacterial"]["supporting"].append(
                f"Contact lens history ({contact_lens}) raises bacterial risk."
            )
            scores["fungal"] -= 0.06
            evidence["fungal"]["conflicting"].append(
                f"Contact lens history ({contact_lens}) is less typical for fungal-first ranking."
            )

        factors = set(self._normalize_list(query_case.get("predisposing_factor")))
        if "trauma" in factors:
            scores["fungal"] += 0.18
            evidence["fungal"]["supporting"].append("Trauma history raises fungal risk.")
            scores["bacterial"] -= 0.05
            evidence["bacterial"]["conflicting"].append("Trauma history keeps fungal high in the differential.")
        if "topical steroid use" in factors:
            scores["fungal"] += 0.12
            evidence["fungal"]["supporting"].append("Topical steroid exposure increases fungal concern.")
        if "contact lens" in factors:
            scores["bacterial"] += 0.1
            evidence["bacterial"]["supporting"].append("Predisposing factors include contact lens exposure.")

        smear_result = self._normalize_text(query_case.get("smear_result"))
        if smear_result == "positive":
            for label in self._labels:
                scores[label] += 0.03
                evidence[label]["supporting"].append("Smear positivity supports an active infectious process.")

        if bool(query_case.get("polymicrobial")):
            for label in self._labels:
                scores[label] -= 0.03
                evidence[label]["conflicting"].append("Polymicrobial metadata lowers single-label certainty.")

        return (
            {label: round(_clamp01(score), 4) for label, score in scores.items()},
            evidence,
        )

    def _quality_penalty(self, query_case: dict[str, Any]) -> tuple[float, str | None]:
        quality = query_case.get("quality_score")
        if not isinstance(quality, (int, float)):
            return 0.0, None
        quality = float(quality)
        if quality < 35:
            return 0.12, f"Representative image quality is low ({quality:.1f})."
        if quality < 50:
            return 0.07, f"Representative image quality is modest ({quality:.1f})."
        if quality < 65:
            return 0.03, f"Representative image quality is acceptable but not ideal ({quality:.1f})."
        return 0.0, None

    def _confidence_band(self, score: float, gap: float) -> str:
        if score >= 0.75 and gap >= 0.18:
            return "high"
        if score >= 0.55 and gap >= 0.08:
            return "moderate"
        return "low"

    def _overall_uncertainty(self, ranked: list[dict[str, Any]], quality_penalty: float, signal_count: int) -> str:
        if not ranked:
            return "high"
        top_score = float(ranked[0]["score"])
        second_score = float(ranked[1]["score"]) if len(ranked) > 1 else 0.0
        gap = top_score - second_score
        if quality_penalty >= 0.07 or signal_count < 2 or gap < 0.08:
            return "high"
        if gap < 0.15 or top_score < 0.7:
            return "moderate"
        return "low"

    def rank(
        self,
        *,
        report: dict[str, Any],
        classification_context: dict[str, Any] | None,
    ) -> dict[str, Any]:
        similar_cases = list(report.get("similar_cases") or [])
        text_evidence = list(report.get("text_evidence") or [])
        query_case = dict(report.get("query_case") or {})
        classifier_scores = self._binary_classifier_scores(classification_context)
        retrieval_scores = {
            label: self._weighted_label_support(similar_cases, label)
            for label in self._labels
        }
        text_scores = {
            label: self._weighted_label_support(text_evidence, label)
            for label in self._labels
        }
        metadata_scores, metadata_evidence = self._metadata_scores(query_case)
        quality_penalty, quality_note = self._quality_penalty(query_case)

        signal_count = 0
        if classification_context and classification_context.get("prediction_probability") is not None:
            signal_count += 1
        if similar_cases:
            signal_count += 1
        if text_evidence:
            signal_count += 1

        ranked: list[dict[str, Any]] = []
        for label in self._labels:
            classifier_score = float(classifier_scores.get(label, 0.5))
            retrieval_score = float(retrieval_scores.get(label, 0.5))
            text_score = float(text_scores.get(label, 0.5))
            metadata_score = float(metadata_scores.get(label, 0.5))
            final_score = _clamp01(
                0.45 * classifier_score
                + 0.25 * retrieval_score
                + 0.15 * text_score
                + 0.15 * metadata_score
                - quality_penalty
            )

            supporting = list(metadata_evidence[label]["supporting"])
            conflicting = list(metadata_evidence[label]["conflicting"])

            if classifier_score >= 0.6:
                supporting.append(f"Classifier support for {label} is {classifier_score:.2f}.")
            elif classifier_score <= 0.4:
                conflicting.append(f"Classifier support for {label} is limited ({classifier_score:.2f}).")

            if retrieval_score >= 0.6:
                supporting.append(f"Similar-case retrieval leans toward {label} ({retrieval_score:.2f}).")
            elif retrieval_score <= 0.4 and similar_cases:
                conflicting.append(f"Similar-case retrieval does not favor {label} ({retrieval_score:.2f}).")

            if text_score >= 0.6:
                supporting.append(f"Retrieved case text leans toward {label} ({text_score:.2f}).")
            elif text_score <= 0.4 and text_evidence:
                conflicting.append(f"Retrieved case text does not favor {label} ({text_score:.2f}).")

            if quality_note:
                conflicting.append(quality_note)

            ranked.append(
                {
                    "label": label,
                    "score": round(final_score, 4),
                    "component_scores": {
                        "classifier": round(classifier_score, 4),
                        "retrieval": round(retrieval_score, 4),
                        "text": round(text_score, 4),
                        "metadata": round(metadata_score, 4),
                        "quality_penalty": round(quality_penalty, 4),
                    },
                    "supporting_evidence": supporting[:5],
                    "conflicting_evidence": conflicting[:5],
                }
            )

        ranked.sort(key=lambda item: float(item["score"]), reverse=True)
        gap = float(ranked[0]["score"]) - float(ranked[1]["score"]) if len(ranked) > 1 else float(ranked[0]["score"])
        for item in ranked:
            item["confidence_band"] = self._confidence_band(float(item["score"]), gap)

        return {
            "engine": "rule_based_fusion_v1",
            "generated_at": utc_now(),
            "overall_uncertainty": self._overall_uncertainty(ranked, quality_penalty, signal_count),
            "top_label": ranked[0]["label"] if ranked else None,
            "differential": ranked,
        }
