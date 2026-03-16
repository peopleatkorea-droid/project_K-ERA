from __future__ import annotations

from typing import TYPE_CHECKING, Any

import numpy as np

from kera_research.services.data_plane import SiteStore

if TYPE_CHECKING:
    from kera_research.services.pipeline import ResearchWorkflowService


class ResearchAiClinicWorkflow:
    def __init__(self, service: ResearchWorkflowService) -> None:
        self.service = service

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
        service = self.service
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
        query_metadata = service._case_metadata_snapshot(query_summary, query_records, quality_cache)
        loaded_models: dict[str, Any] = {}
        query_classifier_embedding: np.ndarray | None = None
        query_dinov2_embedding: np.ndarray | None = None
        retrieval_warning: str | None = None

        if requested_backend in {"classifier", "hybrid"}:
            query_classifier_embedding = service._prepare_case_embedding(
                site_store,
                query_records,
                model_version,
                execution_device,
                loaded_models=loaded_models,
            )
        if requested_backend in {"dinov2", "hybrid"}:
            try:
                query_dinov2_embedding = service._prepare_case_dinov2_embedding(
                    site_store,
                    query_records,
                    model_version,
                    execution_device,
                )
            except Exception as exc:
                if requested_backend == "dinov2":
                    query_classifier_embedding = service._prepare_case_embedding(
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
        candidate_keys: list[tuple[str, str]] = []
        search_limit = max(normalized_top_k * 20, 50)
        for backend_name, query_embedding in (("classifier", query_classifier_embedding), ("dinov2", query_dinov2_embedding)):
            if query_embedding is None:
                continue
            try:
                hits = service._faiss_backend_hits(
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
            except Exception:
                continue

        if requested_backend == "classifier" and "classifier" in faiss_hits_by_backend:
            candidate_keys = list(faiss_hits_by_backend["classifier"].keys())
        elif requested_backend == "dinov2" and "dinov2" in faiss_hits_by_backend:
            candidate_keys = list(faiss_hits_by_backend["dinov2"].keys())
        elif requested_backend == "hybrid" and faiss_hits_by_backend:
            candidate_keys = list(
                {
                    *faiss_hits_by_backend.get("classifier", {}).keys(),
                    *faiss_hits_by_backend.get("dinov2", {}).keys(),
                }
            )

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
                    vector = service._load_cached_case_embedding_vector(
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
                    vector = service._load_cached_case_embedding_vector(
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
                candidate_metadata = service._case_metadata_snapshot(summary, candidate_records, quality_cache)
                metadata_reranking = service._metadata_reranking_adjustment(query_metadata, candidate_metadata)
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
                        candidate_embedding = service._prepare_case_embedding(
                            site_store,
                            case_records,
                            model_version,
                            execution_device,
                            loaded_models=loaded_models,
                        )
                        similarity_components["classifier"] = float(np.dot(query_classifier_embedding, candidate_embedding))
                    if query_dinov2_embedding is not None:
                        candidate_dinov2_embedding = service._prepare_case_dinov2_embedding(
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
                candidate_metadata = service._case_metadata_snapshot(summary, case_records, quality_cache)
                metadata_reranking = service._metadata_reranking_adjustment(query_metadata, candidate_metadata)
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
                "crop_mode": service._resolve_model_crop_mode(model_version),
            },
            "execution_device": execution_device,
            "retrieval_mode": retrieval_mode,
            "vector_index_mode": "faiss_local" if candidate_keys else "brute_force_cache",
            "retrieval_backends_used": [
                key
                for key in ("classifier", "dinov2")
                if (key == "classifier" and query_classifier_embedding is not None)
                or (key == "dinov2" and query_dinov2_embedding is not None)
            ],
            "retrieval_warning": retrieval_warning,
            "top_k": normalized_top_k,
            "eligible_candidate_count": len(candidates),
            "metadata_reranking": "enabled",
            "similar_cases": unique_patient_candidates,
        }

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
        service = self.service
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

        query_image_paths = service._query_image_paths_for_text_retrieval(site_store, query_records, model_version)
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
            text_summary = service._build_case_text_summary(case_records)
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

        result = service.text_retriever.retrieve_texts(
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
        service = self.service
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
        classification_context = service._latest_case_validation_context(
            site_store.site_id,
            patient_id=patient_id,
            visit_date=visit_date,
            model_version_id=str(model_version.get("version_id") or ""),
        )
        merged_report = {
            **report,
            **text_report,
        }
        differential = service.differential_ranker.rank(
            report=merged_report,
            classification_context=classification_context,
        )
        workflow_recommendation = service.ai_clinic_advisor.generate_workflow_recommendation(
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
