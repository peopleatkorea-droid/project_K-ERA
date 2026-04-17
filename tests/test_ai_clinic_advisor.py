from kera_research.services.ai_clinic_advisor import AiClinicWorkflowAdvisor


def test_local_fallback_prefers_predicted_confidence_and_returns_concise_copy():
    advisor = AiClinicWorkflowAdvisor()

    recommendation = advisor._build_local_fallback(
        report={
            "query_case": {
                "smear_result": "not done",
                "contact_lens_use": "none",
                "quality_score": 79.9,
            },
            "similar_cases": [
                {"culture_category": "fungal"},
                {"culture_category": "fungal"},
                {"culture_category": "bacterial"},
            ],
            "text_evidence": [
                {"culture_category": "bacterial", "text": "Dense stromal infiltrate."},
            ],
            "differential": {
                "differential": [
                    {"label": "fungal", "score": 0.41},
                ]
            },
        },
        classification_context={
            "predicted_label": "bacterial",
            "prediction_probability": 0.79,
            "predicted_confidence": 0.79,
        },
    )

    assert recommendation["summary"].startswith("Classifier: bacterial (79% confidence).")
    assert "Differential lead: fungal (0.41)." in recommendation["summary"]
    assert "Evidence is mixed: similar cases lean fungal while text evidence leans bacterial." in recommendation["summary"]
    assert "Smear is not available yet." in recommendation["summary"]
    assert "Case-level confidence is" not in recommendation["summary"]
    assert recommendation["recommended_steps"] == [
        "Review the representative image, crop views, and Grad-CAM together before accepting the label.",
        "Compare the top similar cases to lesion morphology and surrounding corneal context.",
        "Keep the differential broad until smear, culture, risk factors, and follow-up are reconciled.",
    ]
    assert "Similar cases favor fungal, not bacterial." in recommendation["flags_to_review"]
    assert recommendation["rationale"] == (
        "Built from the latest classifier result, patient-deduplicated similar cases, and case-text retrieval."
    )
    assert recommendation["uncertainty"] == (
        "Moderate uncertainty: only partial agreement is present across classifier, retrieval, and metadata."
    )


def test_local_fallback_derives_predicted_class_confidence_from_probability_when_needed():
    advisor = AiClinicWorkflowAdvisor()

    recommendation = advisor._build_local_fallback(
        report={
            "query_case": {},
            "similar_cases": [],
            "text_evidence": [],
            "differential": {},
            "text_retrieval_mode": "unavailable",
        },
        classification_context={
            "predicted_label": "bacterial",
            "prediction_probability": 0.0003,
        },
    )

    assert recommendation["summary"].startswith("Classifier: bacterial (100% confidence).")
    assert "No patient-level similar cases were retrieved." in recommendation["flags_to_review"]
    assert "Text retrieval is unavailable in this runtime." in recommendation["flags_to_review"]
