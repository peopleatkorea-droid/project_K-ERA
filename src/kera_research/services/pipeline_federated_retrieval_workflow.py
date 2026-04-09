from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable

import numpy as np

from kera_research.services.data_plane import SiteStore

if TYPE_CHECKING:
    from kera_research.services.pipeline import ResearchWorkflowService


class ResearchFederatedRetrievalWorkflow:
    def __init__(self, service: ResearchWorkflowService) -> None:
        self.service = service

    def _embedded_thumbnail_data_url(
        self,
        site_store: SiteStore,
        *,
        case_reference_id: str,
        image_path: str,
    ) -> str | None:
        if not image_path:
            return None
        artifact_key = hashlib.sha1(case_reference_id.encode("utf-8")).hexdigest()[:16]
        output_path = site_store.artifact_dir / "federated_retrieval_corpus" / artifact_key / "source_thumbnail.jpg"
        embedded_artifact = self.service._build_embedded_review_artifact(
            image_path,
            Path(output_path),
            max_size=(160, 160),
        )
        if not embedded_artifact:
            return None
        media_type = str(embedded_artifact.get("media_type") or "").strip() or "image/jpeg"
        bytes_b64 = str(embedded_artifact.get("bytes_b64") or "").strip()
        if not bytes_b64:
            return None
        return f"data:{media_type};base64,{bytes_b64}"

    def _retrieval_signature_payload(self, retrieval_profile_record: dict[str, Any]) -> dict[str, Any]:
        model_version = dict(retrieval_profile_record.get("model_version") or {})
        return {
            "profile_id": str(retrieval_profile_record.get("profile_id") or "").strip(),
            "profile_label": str(retrieval_profile_record.get("label") or "").strip(),
            "model_version_id": str(model_version.get("version_id") or "").strip(),
            "architecture": str(model_version.get("architecture") or "").strip(),
            "crop_mode": str(model_version.get("crop_mode") or "").strip(),
            "requires_medsam_crop": bool(model_version.get("requires_medsam_crop")),
            "case_aggregation": str(model_version.get("case_aggregation") or "").strip() or "mean",
            "dinov2_source_label": str(self.service.dinov2_retriever.source_label or "").strip(),
            "dinov2_source_reference": str(self.service.dinov2_retriever.source_reference or "").strip(),
            "preprocess_policy": "transformers_auto_image_processor",
            "case_pooling": "mean",
            "vector_normalization": "l2",
            "similarity_metric": "cosine_inner_product",
        }

    def retrieval_signature(self, retrieval_profile: str = "dinov2_lesion_crop") -> dict[str, Any]:
        retrieval_profile_record = self.service.ai_clinic_workflow._normalize_retrieval_profile(retrieval_profile)
        signature_payload = self._retrieval_signature_payload(retrieval_profile_record)
        retrieval_signature = hashlib.sha1(
            json.dumps(signature_payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()[:16]
        return {
            "profile_id": retrieval_profile_record["profile_id"],
            "retrieval_signature": retrieval_signature,
            "profile_metadata": {
                "label": retrieval_profile_record.get("label"),
                "description": retrieval_profile_record.get("description"),
                "signature_payload": signature_payload,
            },
            "model_version": dict(retrieval_profile_record.get("model_version") or {}),
        }

    def search_remote_retrieval_corpus(
        self,
        site_store: SiteStore,
        *,
        query_embedding: np.ndarray,
        query_metadata: dict[str, Any],
        patient_id: str,
        visit_date: str,
        retrieval_profile: str = "dinov2_lesion_crop",
        top_k: int = 3,
    ) -> list[dict[str, Any]]:
        service = self.service
        cp = service.control_plane
        if not cp.remote_node_sync_enabled():
            return []

        signature_record = self.retrieval_signature(retrieval_profile)
        exclude_case_reference_id = cp.case_reference_id(site_store.site_id, patient_id, visit_date)
        remote_hits = cp.remote_control_plane.search_retrieval_corpus(
            profile_id=str(signature_record["profile_id"]),
            retrieval_signature=str(signature_record["retrieval_signature"]),
            query_embedding=np.asarray(query_embedding, dtype=np.float32).round(6).tolist(),
            top_k=max(1, min(int(top_k or 3), 10)),
            exclude_site_id=site_store.site_id,
            exclude_case_reference_id=exclude_case_reference_id,
        )

        candidates: list[dict[str, Any]] = []
        for item in remote_hits:
            candidate_metadata = dict(item.get("metadata_json") or {})
            metadata_reranking = service._metadata_reranking_adjustment(query_metadata, candidate_metadata)
            base_similarity = float(item.get("similarity") or 0.0)
            similarity = max(-1.0, min(1.0, base_similarity + float(metadata_reranking["adjustment"])))
            case_reference_id = str(item.get("case_reference_id") or "").strip()
            source_site_id = str(item.get("site_id") or "").strip()
            source_site_display_name = str(item.get("source_site_display_name") or "").strip()
            source_site_hospital_name = str(item.get("source_site_hospital_name") or "").strip()
            source_site_label = source_site_display_name or source_site_hospital_name or source_site_id
            case_label = f"{source_site_label} / {case_reference_id[:10]}" if source_site_label else case_reference_id[:10]
            candidates.append(
                {
                    "patient_id": case_reference_id or case_label,
                    "visit_date": "cross-site",
                    "case_id": case_reference_id or case_label,
                    "representative_image_id": None,
                    "representative_view": candidate_metadata.get("representative_view"),
                    "chart_alias": source_site_label,
                    "local_case_code": case_label,
                    "preview_url": str(item.get("thumbnail_url") or "").strip() or None,
                    "culture_category": str(item.get("culture_category") or "").strip(),
                    "culture_species": str(item.get("culture_species") or "").strip(),
                    "image_count": int(candidate_metadata.get("image_count") or 0),
                    "visit_status": candidate_metadata.get("visit_status"),
                    "active_stage": bool(candidate_metadata.get("active_stage")),
                    "sex": candidate_metadata.get("sex"),
                    "age": candidate_metadata.get("age"),
                    "contact_lens_use": candidate_metadata.get("contact_lens_use"),
                    "predisposing_factor": list(candidate_metadata.get("predisposing_factor") or []),
                    "smear_result": candidate_metadata.get("smear_result"),
                    "polymicrobial": candidate_metadata.get("polymicrobial"),
                    "quality_score": candidate_metadata.get("quality_score"),
                    "view_score": candidate_metadata.get("view_score"),
                    "metadata_reranking": metadata_reranking,
                    "base_similarity": round(base_similarity, 4),
                    "similarity": round(similarity, 4),
                    "classifier_similarity": None,
                    "dinov2_similarity": round(base_similarity, 4),
                    "retrieval_source": "remote_control_plane",
                    "source_site_id": source_site_id or None,
                    "source_site_display_name": source_site_display_name or None,
                    "source_site_hospital_name": source_site_hospital_name or None,
                }
            )
        return candidates

    def sync_remote_retrieval_corpus(
        self,
        site_store: SiteStore,
        *,
        execution_device: str,
        retrieval_profile: str = "dinov2_lesion_crop",
        force_refresh: bool = False,
        batch_size: int = 32,
        progress_callback: Callable[[dict[str, Any]], None] | None = None,
    ) -> dict[str, Any]:
        service = self.service
        cp = service.control_plane
        if not cp.remote_node_sync_enabled():
            raise RuntimeError("Remote control-plane node sync is not configured.")

        signature_record = self.retrieval_signature(retrieval_profile)
        retrieval_model_version = dict(signature_record["model_version"])
        normalized_batch_size = max(1, min(int(batch_size or 32), 128))

        quality_cache: dict[str, dict[str, Any] | None] = {}
        uploaded_entries: list[dict[str, Any]] = []
        failed_cases: list[dict[str, str]] = []
        summary_by_key = {
            (str(item.get("patient_id") or ""), str(item.get("visit_date") or "")): item
            for item in site_store.list_case_summaries()
        }
        total_cases = len(summary_by_key)

        eligible_case_count = 0
        skipped_not_positive = 0
        skipped_not_included = 0
        skipped_no_images = 0

        def emit_progress(stage: str, message: str, percent: int, **extra: Any) -> None:
            if progress_callback is None:
                return
            progress_callback(
                {
                    "stage": stage,
                    "message": message,
                    "percent": max(0, min(int(percent), 100)),
                    "total_cases": total_cases,
                    "eligible_cases": eligible_case_count,
                    "prepared_entries": len(uploaded_entries),
                    "failed_cases": len(failed_cases),
                    "skipped_not_positive": skipped_not_positive,
                    "skipped_not_included": skipped_not_included,
                    "skipped_no_images": skipped_no_images,
                    "retrieval_profile": retrieval_profile,
                    "profile_id": signature_record["profile_id"],
                    "retrieval_signature": signature_record["retrieval_signature"],
                    **extra,
                }
            )

        emit_progress(
            "preparing_entries",
            "Preparing federated retrieval corpus entries.",
            3,
            completed_cases=0,
        )

        for case_index, ((patient_id, visit_date), summary) in enumerate(summary_by_key.items(), start=1):
            if not patient_id or not visit_date:
                continue
            policy_state = site_store.case_research_policy_state(patient_id, visit_date)
            if not bool(policy_state.get("is_positive")):
                skipped_not_positive += 1
            elif not bool(policy_state.get("is_registry_included")):
                skipped_not_included += 1
            elif not bool(policy_state.get("has_images")):
                skipped_no_images += 1
            else:
                case_records = site_store.case_records_for_visit(patient_id, visit_date)
                if not case_records:
                    skipped_no_images += 1
                else:
                    case_summary = dict(policy_state.get("case_summary") or summary or {})
                    case_metadata = service._case_metadata_snapshot(case_summary, case_records, quality_cache)
                    eligible_case_count += 1
                    case_reference_id = cp.case_reference_id(site_store.site_id, patient_id, visit_date)
                    try:
                        embedding = service._prepare_case_dinov2_embedding(
                            site_store,
                            case_records,
                            retrieval_model_version,
                            execution_device,
                            force_refresh=force_refresh,
                        )
                    except Exception as exc:
                        if len(failed_cases) < 20:
                            failed_cases.append(
                                {
                                    "patient_id": patient_id,
                                    "visit_date": visit_date,
                                    "error": str(exc),
                                }
                            )
                    else:
                        representative_record = service._select_representative_record(case_records)
                        representative_image_path = str(representative_record.get("image_path") or "").strip()
                        uploaded_entries.append(
                            {
                                "case_reference_id": case_reference_id,
                                "culture_category": str(case_summary.get("culture_category") or "").strip().lower(),
                                "culture_species": str(case_summary.get("culture_species") or "").strip(),
                                "embedding": np.asarray(embedding, dtype=np.float32).round(6).tolist(),
                                "thumbnail_url": self._embedded_thumbnail_data_url(
                                    site_store,
                                    case_reference_id=case_reference_id,
                                    image_path=representative_image_path,
                                ),
                                "metadata_json": {
                                    "representative_view": case_metadata.get("representative_view"),
                                    "visit_status": case_metadata.get("visit_status"),
                                    "active_stage": bool(case_metadata.get("active_stage")),
                                    "quality_score": case_metadata.get("quality_score"),
                                    "view_score": case_metadata.get("view_score"),
                                    "contact_lens_use": case_metadata.get("contact_lens_use"),
                                    "predisposing_factor": list(case_metadata.get("predisposing_factor") or []),
                                    "smear_result": case_metadata.get("smear_result"),
                                    "polymicrobial": bool(case_metadata.get("polymicrobial")),
                                    "image_count": int(case_metadata.get("image_count") or 0),
                                },
                            }
                        )
            if total_cases > 0 and (case_index == total_cases or case_index == 1 or case_index % 5 == 0):
                emit_progress(
                    "preparing_entries",
                    "Preparing federated retrieval corpus entries.",
                    5 + int((case_index / total_cases) * 75),
                    completed_cases=case_index,
                )

        inserted_count = 0
        updated_count = 0
        deleted_count = 0
        remote_batches: list[dict[str, Any]] = []
        total_batches = (len(uploaded_entries) + normalized_batch_size - 1) // normalized_batch_size if uploaded_entries else 0
        if total_batches == 0:
            remote_result = cp.remote_control_plane.upload_retrieval_corpus_entries(
                profile_id=str(signature_record["profile_id"]),
                retrieval_signature=str(signature_record["retrieval_signature"]),
                profile_metadata_json=dict(signature_record["profile_metadata"] or {}),
                entries=[],
                replace_site_profile_scope=True,
            )
            deleted_count = int(remote_result.get("deleted_count") or 0)
            if len(remote_batches) < 10:
                remote_batches.append(
                    {
                        "inserted_count": int(remote_result.get("inserted_count") or 0),
                        "updated_count": int(remote_result.get("updated_count") or 0),
                        "deleted_count": deleted_count,
                        "batch_size": 0,
                    }
                )
            emit_progress(
                "uploading_entries",
                "No eligible federated retrieval entries were prepared.",
                95,
                completed_batches=0,
                total_batches=0,
                inserted_count=0,
                updated_count=0,
                deleted_count=deleted_count,
            )
        for batch_index, chunk_start in enumerate(range(0, len(uploaded_entries), normalized_batch_size), start=1):
            chunk = uploaded_entries[chunk_start : chunk_start + normalized_batch_size]
            if not chunk:
                continue
            remote_result = cp.remote_control_plane.upload_retrieval_corpus_entries(
                profile_id=str(signature_record["profile_id"]),
                retrieval_signature=str(signature_record["retrieval_signature"]),
                profile_metadata_json=dict(signature_record["profile_metadata"] or {}),
                entries=chunk,
                replace_site_profile_scope=batch_index == total_batches,
            )
            inserted_count += int(remote_result.get("inserted_count") or 0)
            updated_count += int(remote_result.get("updated_count") or 0)
            deleted_count = int(remote_result.get("deleted_count") or 0)
            if len(remote_batches) < 10:
                remote_batches.append(
                    {
                        "inserted_count": int(remote_result.get("inserted_count") or 0),
                        "updated_count": int(remote_result.get("updated_count") or 0),
                        "deleted_count": deleted_count,
                        "batch_size": len(chunk),
                    }
                )
            emit_progress(
                "uploading_entries",
                "Uploading federated retrieval corpus entries.",
                80 + int((batch_index / max(total_batches, 1)) * 15),
                completed_batches=batch_index,
                total_batches=total_batches,
                inserted_count=inserted_count,
                updated_count=updated_count,
                deleted_count=deleted_count,
            )

        result = {
            "site_id": site_store.site_id,
            "retrieval_profile": retrieval_profile,
            "profile_id": signature_record["profile_id"],
            "retrieval_signature": signature_record["retrieval_signature"],
            "execution_device": execution_device,
            "eligible_case_count": eligible_case_count,
            "prepared_entry_count": len(uploaded_entries),
            "failed_case_count": len(failed_cases),
            "failed_cases": failed_cases,
            "skipped": {
                "not_positive": skipped_not_positive,
                "not_included": skipped_not_included,
                "no_images": skipped_no_images,
            },
            "remote_sync": {
                "inserted_count": inserted_count,
                "updated_count": updated_count,
                "deleted_count": deleted_count,
                "batch_size": normalized_batch_size,
                "batches": remote_batches,
            },
        }
        emit_progress(
            "sync_completed",
            "Federated retrieval corpus sync completed.",
            100,
            completed_cases=total_cases,
            completed_batches=total_batches,
            total_batches=total_batches,
            inserted_count=inserted_count,
            updated_count=updated_count,
            deleted_count=result["remote_sync"]["deleted_count"],
        )
        return result
