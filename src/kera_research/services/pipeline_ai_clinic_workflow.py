from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

import numpy as np

if TYPE_CHECKING:
    from kera_research.services.data_plane import SiteStore
    from kera_research.services.pipeline import ResearchWorkflowService


class ResearchAiClinicWorkflow:
    def __init__(self, service: ResearchWorkflowService) -> None:
        self.service = service

    def _normalize_retrieval_profile(self, retrieval_profile: str | None) -> dict[str, Any]:
        normalized = str(retrieval_profile or "dinov2_lesion_crop").strip().lower()
        profile_map: dict[str, dict[str, Any]] = {
            "dinov2_lesion_crop": {
                "profile_id": "dinov2_lesion_crop",
                "label": "DINOv2 lesion-crop retrieval",
                "description": "Uses lesion-centered crops for DINOv2 case retrieval.",
                "model_version": {
                    "version_id": "retrieval_profile_dinov2_lesion_crop",
                    "version_name": "retrieval-profile-dinov2-lesion-crop",
                    "architecture": "retrieval_dinov2",
                    "crop_mode": "manual",
                    "requires_medsam_crop": True,
                    "case_aggregation": "mean",
                    "bag_level": False,
                    "ready": True,
                },
            },
            "dinov2_cornea_roi": {
                "profile_id": "dinov2_cornea_roi",
                "label": "DINOv2 cornea-ROI retrieval",
                "description": "Uses MedSAM cornea ROI crops for DINOv2 case retrieval.",
                "model_version": {
                    "version_id": "retrieval_profile_dinov2_cornea_roi",
                    "version_name": "retrieval-profile-dinov2-cornea-roi",
                    "architecture": "retrieval_dinov2",
                    "crop_mode": "automated",
                    "requires_medsam_crop": True,
                    "case_aggregation": "mean",
                    "bag_level": False,
                    "ready": True,
                },
            },
            "dinov2_full_frame": {
                "profile_id": "dinov2_full_frame",
                "label": "DINOv2 full-frame retrieval",
                "description": "Uses uncropped source frames for DINOv2 case retrieval.",
                "model_version": {
                    "version_id": "retrieval_profile_dinov2_full_frame",
                    "version_name": "retrieval-profile-dinov2-full-frame",
                    "architecture": "retrieval_dinov2",
                    "crop_mode": "raw",
                    "requires_medsam_crop": False,
                    "case_aggregation": "mean",
                    "bag_level": False,
                    "ready": True,
                },
            },
        }
        return profile_map.get(normalized, profile_map["dinov2_lesion_crop"])

    def _append_warning(self, current: str | None, next_warning: str | None) -> str | None:
        normalized_next = str(next_warning or "").strip()
        if not normalized_next:
            return current
        normalized_current = str(current or "").strip()
        if not normalized_current:
            return normalized_next
        if normalized_next in normalized_current:
            return normalized_current
        return f"{normalized_current} {normalized_next}".strip()

    def _retrieval_profile_fallbacks(self, retrieval_profile: str | None) -> list[dict[str, Any]]:
        requested = self._normalize_retrieval_profile(retrieval_profile)
        requested_id = str(requested.get("profile_id") or "").strip() or "dinov2_lesion_crop"
        fallback_map = {
            "dinov2_lesion_crop": [
                "dinov2_lesion_crop",
                "dinov2_cornea_roi",
                "dinov2_full_frame",
            ],
            "dinov2_cornea_roi": [
                "dinov2_cornea_roi",
                "dinov2_full_frame",
            ],
            "dinov2_full_frame": [
                "dinov2_full_frame",
            ],
        }
        fallback_ids = fallback_map.get(requested_id, [requested_id, "dinov2_full_frame"])
        profiles: list[dict[str, Any]] = []
        seen_profile_ids: set[str] = set()
        for profile_id in fallback_ids:
            profile_record = self._normalize_retrieval_profile(profile_id)
            normalized_profile_id = str(profile_record.get("profile_id") or "").strip()
            if not normalized_profile_id or normalized_profile_id in seen_profile_ids:
                continue
            seen_profile_ids.add(normalized_profile_id)
            profiles.append(profile_record)
        return profiles or [requested]

    def _resolve_query_dinov2_embedding(
        self,
        site_store: SiteStore,
        *,
        query_records: list[dict[str, Any]],
        execution_device: str,
        retrieval_profile: str | None,
    ) -> tuple[np.ndarray | None, dict[str, Any], str | None]:
        service = self.service
        requested_record = self._normalize_retrieval_profile(retrieval_profile)
        errors: list[str] = []
        for profile_record in self._retrieval_profile_fallbacks(retrieval_profile):
            try:
                embedding = service._prepare_case_dinov2_embedding(
                    site_store,
                    query_records,
                    dict(profile_record["model_version"]),
                    execution_device,
                )
            except Exception as exc:
                errors.append(f"{profile_record['label']}: {exc}")
                continue
            warning = None
            if str(profile_record.get("profile_id") or "") != str(requested_record.get("profile_id") or ""):
                warning = (
                    f"Requested DINOv2 retrieval profile {requested_record['label']} is unavailable and "
                    f"AI Clinic used {profile_record['label']}."
                )
            return embedding, profile_record, warning

        if not errors:
            return None, requested_record, None
        return (
            None,
            requested_record,
            f"DINOv2 retrieval is unavailable across retrieval profiles. {' '.join(errors)}",
        )

    def _remote_retrieval_cache_path(
        self,
        site_store: SiteStore,
        *,
        patient_id: str,
        visit_date: str,
        requested_profile_id: str,
    ):
        cache_key = hashlib.sha1(
            f"{site_store.site_id}|{patient_id}|{visit_date}|{requested_profile_id}".encode("utf-8")
        ).hexdigest()[:16]
        return site_store.artifact_dir / "ai_clinic_remote_retrieval_cache" / f"{cache_key}.json"

    def _load_remote_retrieval_cache(
        self,
        site_store: SiteStore,
        *,
        patient_id: str,
        visit_date: str,
        requested_profile_id: str,
        top_k: int,
    ) -> dict[str, Any] | None:
        cache_path = self._remote_retrieval_cache_path(
            site_store,
            patient_id=patient_id,
            visit_date=visit_date,
            requested_profile_id=requested_profile_id,
        )
        if not cache_path.exists():
            return None
        try:
            payload = json.loads(cache_path.read_text(encoding="utf-8"))
        except Exception:
            return None
        if not isinstance(payload, dict):
            return None
        if (
            str(payload.get("patient_id") or "").strip() != str(patient_id).strip()
            or str(payload.get("visit_date") or "").strip() != str(visit_date).strip()
            or str(payload.get("requested_profile_id") or "").strip() != str(requested_profile_id).strip()
        ):
            return None
        cached_candidates = payload.get("candidates")
        if not isinstance(cached_candidates, list) or not cached_candidates:
            return None
        return {
            "saved_at": str(payload.get("saved_at") or "").strip() or None,
            "used_profile_id": str(payload.get("used_profile_id") or "").strip() or None,
            "candidates": [dict(item) for item in cached_candidates[: max(1, int(top_k or 3))] if isinstance(item, dict)],
        }

    def _save_remote_retrieval_cache(
        self,
        site_store: SiteStore,
        *,
        patient_id: str,
        visit_date: str,
        requested_profile_id: str,
        used_profile_id: str,
        candidates: list[dict[str, Any]],
    ) -> None:
        normalized_candidates = [dict(item) for item in candidates if isinstance(item, dict)]
        if not normalized_candidates:
            return
        cache_path = self._remote_retrieval_cache_path(
            site_store,
            patient_id=patient_id,
            visit_date=visit_date,
            requested_profile_id=requested_profile_id,
        )
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(
            json.dumps(
                {
                    "patient_id": patient_id,
                    "visit_date": visit_date,
                    "requested_profile_id": requested_profile_id,
                    "used_profile_id": used_profile_id,
                    "saved_at": datetime.now(timezone.utc).isoformat(),
                    "candidates": normalized_candidates,
                },
                ensure_ascii=True,
            ),
            encoding="utf-8",
        )

    def _normalize_requested_backend(self, retrieval_backend: str | None) -> tuple[str, str]:
        normalized = str(retrieval_backend or "standard").strip().lower()
        if normalized not in {"standard", "classifier", "dinov2", "hybrid"}:
            normalized = "standard"
        effective_backend = "hybrid" if normalized == "standard" else normalized
        return normalized, effective_backend

    def _ai_clinic_profile_summary(
        self,
        *,
        requested_backend: str,
        effective_backend: str,
        retrieval_profile: dict[str, Any],
        workflow_recommendation: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if requested_backend == "standard":
            label = f"AI Clinic standard · {retrieval_profile['label']}"
            description = (
                "Combines similar-patient retrieval, metadata reranking, narrative case evidence, "
                "differential ranking, and workflow guidance in one review flow."
            )
        else:
            label = f"AI Clinic custom retrieval · {retrieval_profile['label']}"
            description = (
                "Runs AI Clinic with an explicitly selected retrieval engine while preserving the same "
                "narrative evidence, differential ranking, and workflow guidance stages."
            )
        return {
            "profile_id": retrieval_profile["profile_id"],
            "label": label,
            "description": description,
            "requested_backend": requested_backend,
            "effective_retrieval_backend": effective_backend,
            "retrieval_profile_label": retrieval_profile["label"],
            "workflow_guidance_provider": ((workflow_recommendation or {}).get("provider_label")),
        }

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
        service = self.service
        normalized_top_k = max(1, min(int(top_k or 3), 10))
        requested_profile, requested_backend = self._normalize_requested_backend(retrieval_backend)
        retrieval_profile_record = self._normalize_retrieval_profile(retrieval_profile)
        retrieval_model_version = dict(retrieval_profile_record["model_version"])
        records = site_store.dataset_records()
        if not records:
            raise ValueError("No dataset records are available for AI Clinic retrieval.")

        cases_by_key: dict[tuple[str, str], list[dict[str, Any]]] = {}
        for record in records:
            key = (str(record["patient_id"]), str(record["visit_date"]))
            cases_by_key.setdefault(key, []).append(record)

        query_key = (patient_id, visit_date)
        query_records = site_store.case_records_for_visit(patient_id, visit_date)
        if not query_records:
            raise ValueError("Selected case does not have saved images for AI Clinic retrieval.")

        summaries_by_key = {
            (str(item["patient_id"]), str(item["visit_date"])): item
            for item in site_store.list_case_summaries()
        }
        query_summary = summaries_by_key.get(query_key)
        if query_summary is None:
            policy_state = site_store.case_research_policy_state(patient_id, visit_date)
            query_summary = dict(policy_state.get("visit") or {})
        quality_cache: dict[str, dict[str, Any] | None] = {}
        query_metadata = service._case_metadata_snapshot(query_summary, query_records, quality_cache)
        loaded_models: dict[str, Any] = {}
        query_classifier_embedding: np.ndarray | None = None
        query_dinov2_embedding: np.ndarray | None = None
        resolved_dinov2_embedding: np.ndarray | None = None
        resolved_dinov2_profile_record = retrieval_profile_record
        retrieval_warning: str | None = None
        remote_node_sync_enabled = bool(service.control_plane.remote_node_sync_enabled())
        cross_site_status = "disabled" if not remote_node_sync_enabled else "pending"
        cross_site_warning: str | None = None
        cross_site_cache_used = False
        cross_site_cache_saved_at: str | None = None
        if not remote_node_sync_enabled:
            cross_site_warning = "Cross-site retrieval corpus sync is not configured."

        if requested_backend in {"classifier", "hybrid"}:
            query_classifier_embedding = service._prepare_case_embedding(
                site_store,
                query_records,
                model_version,
                execution_device,
                loaded_models=loaded_models,
            )
        if remote_node_sync_enabled or requested_backend in {"dinov2", "hybrid"}:
            (
                resolved_dinov2_embedding,
                resolved_dinov2_profile_record,
                dinov2_warning,
            ) = self._resolve_query_dinov2_embedding(
                site_store,
                query_records=query_records,
                execution_device=execution_device,
                retrieval_profile=retrieval_profile_record["profile_id"],
            )
            retrieval_warning = self._append_warning(retrieval_warning, dinov2_warning)
        if requested_backend in {"dinov2", "hybrid"}:
            query_dinov2_embedding = resolved_dinov2_embedding
            retrieval_model_version = dict(resolved_dinov2_profile_record["model_version"])
            if query_dinov2_embedding is None:
                if requested_backend == "dinov2":
                    query_classifier_embedding = service._prepare_case_embedding(
                        site_store,
                        query_records,
                        model_version,
                        execution_device,
                        loaded_models=loaded_models,
                    )
                    requested_backend = "classifier"
                    retrieval_warning = self._append_warning(
                        retrieval_warning,
                        "DINOv2 retrieval is unavailable and AI Clinic fell back to classifier retrieval.",
                    )
                else:
                    retrieval_warning = self._append_warning(
                        retrieval_warning,
                        "DINOv2 retrieval is unavailable and AI Clinic used classifier retrieval only.",
                    )

        local_candidates: list[dict[str, Any]] = []
        faiss_hits_by_backend: dict[str, dict[tuple[str, str], dict[str, Any]]] = {}
        candidate_keys: list[tuple[str, str]] = []
        search_limit = max(normalized_top_k * 20, 50)
        for backend_name, query_embedding in (("classifier", query_classifier_embedding), ("dinov2", query_dinov2_embedding)):
            if query_embedding is None:
                continue
            try:
                hits = service._faiss_backend_hits(
                    site_store,
                    model_version=retrieval_model_version if backend_name == "dinov2" else model_version,
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
                        model_version=retrieval_model_version,
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
                local_candidates.append(
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
                        "retrieval_source": "local_site",
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
                            retrieval_model_version,
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
                local_candidates.append(
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
                        "retrieval_source": "local_site",
                    }
                )

        remote_candidates: list[dict[str, Any]] = []
        remote_query_dinov2_embedding = resolved_dinov2_embedding if remote_node_sync_enabled else None
        remote_retrieval_profile_record = (
            resolved_dinov2_profile_record
            if remote_query_dinov2_embedding is not None
            else retrieval_profile_record
        )
        requested_profile_id = str(retrieval_profile_record["profile_id"] or "").strip()
        if remote_node_sync_enabled:
            if remote_query_dinov2_embedding is not None:
                try:
                    remote_candidates = service.search_remote_retrieval_corpus(
                        site_store,
                        query_embedding=remote_query_dinov2_embedding,
                        query_metadata=query_metadata,
                        patient_id=patient_id,
                        visit_date=visit_date,
                        retrieval_profile=remote_retrieval_profile_record["profile_id"],
                        top_k=search_limit,
                    )
                    self._save_remote_retrieval_cache(
                        site_store,
                        patient_id=patient_id,
                        visit_date=visit_date,
                        requested_profile_id=requested_profile_id,
                        used_profile_id=str(remote_retrieval_profile_record["profile_id"] or "").strip(),
                        candidates=remote_candidates,
                    )
                    cross_site_status = "ready" if remote_candidates else "empty"
                except Exception as exc:
                    cached_remote = self._load_remote_retrieval_cache(
                        site_store,
                        patient_id=patient_id,
                        visit_date=visit_date,
                        requested_profile_id=requested_profile_id,
                        top_k=search_limit,
                    )
                    if cached_remote is not None:
                        remote_candidates = list(cached_remote.get("candidates") or [])
                        cross_site_cache_used = True
                        cross_site_cache_saved_at = str(cached_remote.get("saved_at") or "").strip() or None
                        cached_profile_id = str(
                            cached_remote.get("used_profile_id") or requested_profile_id
                        ).strip() or requested_profile_id
                        remote_retrieval_profile_record = self._normalize_retrieval_profile(cached_profile_id)
                        cross_site_status = "cache_fallback"
                        cross_site_warning = (
                            f"Cross-site retrieval is unavailable and AI Clinic used the last successful cached "
                            f"cross-site results. {exc}"
                        )
                        retrieval_warning = self._append_warning(retrieval_warning, cross_site_warning)
                    else:
                        cross_site_status = "unavailable"
                        cross_site_warning = (
                            f"Cross-site retrieval is unavailable and AI Clinic continued with local candidates only. {exc}"
                        )
                        retrieval_warning = self._append_warning(retrieval_warning, cross_site_warning)
            else:
                cached_remote = self._load_remote_retrieval_cache(
                    site_store,
                    patient_id=patient_id,
                    visit_date=visit_date,
                    requested_profile_id=requested_profile_id,
                    top_k=search_limit,
                )
                if cached_remote is not None:
                    remote_candidates = list(cached_remote.get("candidates") or [])
                    cross_site_cache_used = True
                    cross_site_cache_saved_at = str(cached_remote.get("saved_at") or "").strip() or None
                    cached_profile_id = str(
                        cached_remote.get("used_profile_id") or requested_profile_id
                    ).strip() or requested_profile_id
                    remote_retrieval_profile_record = self._normalize_retrieval_profile(cached_profile_id)
                    cross_site_status = "cache_fallback"
                    cross_site_warning = (
                        "Live cross-site retrieval query embedding is unavailable and AI Clinic used the last "
                        "successful cached cross-site results."
                    )
                    retrieval_warning = self._append_warning(retrieval_warning, cross_site_warning)
                else:
                    cross_site_status = "no_query_embedding"
                    cross_site_warning = "Cross-site retrieval query embedding is unavailable."
                    retrieval_warning = self._append_warning(retrieval_warning, cross_site_warning)

        candidates = [*local_candidates, *remote_candidates]

        def top_unique_candidates(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
            ranked_items = sorted(
                items,
                key=lambda item: item["similarity"],
                reverse=True,
            )
            unique_candidates: list[dict[str, Any]] = []
            seen_patient_ids: set[str] = set()
            for candidate in ranked_items:
                candidate_patient_id = str(candidate["patient_id"])
                if candidate_patient_id in seen_patient_ids:
                    continue
                seen_patient_ids.add(candidate_patient_id)
                unique_candidates.append(candidate)
                if len(unique_candidates) >= normalized_top_k:
                    break
            return unique_candidates

        unique_patient_candidates = top_unique_candidates(candidates)
        local_similar_cases = top_unique_candidates(local_candidates)
        cross_site_similar_cases = top_unique_candidates(remote_candidates)
        retrieval_mode = {
            "classifier": "classifier_penultimate_feature",
            "dinov2": "dinov2_visual_embedding",
            "hybrid": "hybrid_classifier_dinov2",
        }[requested_backend]
        profile_summary = self._ai_clinic_profile_summary(
            requested_backend=requested_profile,
            effective_backend=requested_backend,
            retrieval_profile=retrieval_profile_record,
        )
        technical_details = {
            "similar_case_engine": {
                "mode": retrieval_mode,
                "vector_index_mode": "faiss_local" if candidate_keys else "brute_force_cache",
                "backends_used": [
                    key
                    for key in ("classifier", "dinov2")
                    if (key == "classifier" and query_classifier_embedding is not None)
                    or (key == "dinov2" and query_dinov2_embedding is not None)
                ],
                "metadata_reranking": "enabled",
                "warning": retrieval_warning,
                "retrieval_profile_id": retrieval_profile_record["profile_id"],
                "retrieval_profile_label": retrieval_profile_record["label"],
                "reference_corpus": "positive_labeled_cases_only",
            }
        }
        technical_details["cross_site_retrieval"] = {
            "status": cross_site_status,
            "warning": cross_site_warning,
            "attempted": remote_node_sync_enabled,
            "cache_used": cross_site_cache_used,
            "cache_saved_at": cross_site_cache_saved_at,
            "candidate_count": len(remote_candidates),
            "requested_profile_id": retrieval_profile_record["profile_id"],
            "requested_profile_label": retrieval_profile_record["label"],
            "effective_profile_id": (
                remote_retrieval_profile_record["profile_id"]
                if remote_node_sync_enabled
                else None
            ),
            "effective_profile_label": (
                remote_retrieval_profile_record["label"]
                if remote_node_sync_enabled
                else None
            ),
        }
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
            "ai_clinic_profile": profile_summary,
            "technical_details": technical_details,
            "retrieval_mode": "ai_clinic_standard" if requested_profile == "standard" else retrieval_mode,
            "vector_index_mode": technical_details["similar_case_engine"]["vector_index_mode"],
            "retrieval_backends_used": list(technical_details["similar_case_engine"]["backends_used"]),
            "retrieval_warning": retrieval_warning,
            "top_k": normalized_top_k,
            "eligible_candidate_count": len(candidates),
            "metadata_reranking": "enabled",
            "similar_cases": unique_patient_candidates,
            "local_similar_cases": local_similar_cases,
            "cross_site_similar_cases": cross_site_similar_cases,
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
        query_records = site_store.case_records_for_visit(patient_id, visit_date)
        if not query_records:
            raise ValueError("Selected case does not have saved images for AI Clinic text retrieval.")

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
            site_store=site_store,
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
        retrieval_backend: str = "standard",
        retrieval_profile: str = "dinov2_lesion_crop",
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
            retrieval_profile=retrieval_profile,
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
        ai_clinic_profile = self._ai_clinic_profile_summary(
            requested_backend=str((report.get("ai_clinic_profile") or {}).get("requested_backend") or "standard"),
            effective_backend=str((report.get("ai_clinic_profile") or {}).get("effective_retrieval_backend") or "hybrid"),
            retrieval_profile=self._normalize_retrieval_profile(
                str((report.get("ai_clinic_profile") or {}).get("profile_id") or retrieval_profile)
            ),
            workflow_recommendation=workflow_recommendation,
        )
        technical_details = dict(report.get("technical_details") or {})
        technical_details["narrative_evidence_engine"] = {
            "mode": str(text_report.get("text_retrieval_mode") or "unavailable"),
            "model": text_report.get("text_embedding_model"),
            "error": text_report.get("text_retrieval_error"),
        }
        technical_details["workflow_guidance_engine"] = {
            "mode": workflow_recommendation.get("mode"),
            "provider_label": workflow_recommendation.get("provider_label"),
            "model": workflow_recommendation.get("model"),
            "llm_error": workflow_recommendation.get("llm_error"),
        }

        return {
            **merged_report,
            "ai_clinic_profile": ai_clinic_profile,
            "technical_details": technical_details,
            "classification_context": classification_context,
            "differential": differential,
            "workflow_recommendation": workflow_recommendation,
        }
