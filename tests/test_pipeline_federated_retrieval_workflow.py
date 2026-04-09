from __future__ import annotations

import base64
import sys
import unittest
from pathlib import Path

import numpy as np

ROOT_DIR = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from kera_research.services.pipeline_federated_retrieval_workflow import ResearchFederatedRetrievalWorkflow


class _FakeRemoteControlPlane:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []
        self.search_calls: list[dict[str, object]] = []

    def upload_retrieval_corpus_entries(
        self,
        *,
        profile_id: str,
        retrieval_signature: str,
        entries: list[dict[str, object]],
        profile_metadata_json: dict[str, object] | None = None,
        replace_site_profile_scope: bool = False,
    ) -> dict[str, object]:
        self.calls.append(
            {
                "profile_id": profile_id,
                "retrieval_signature": retrieval_signature,
                "entries": entries,
                "profile_metadata_json": profile_metadata_json or {},
                "replace_site_profile_scope": replace_site_profile_scope,
            }
        )
        return {
            "inserted_count": len(entries),
            "updated_count": 0,
            "deleted_count": 0,
        }

    def search_retrieval_corpus(
        self,
        *,
        profile_id: str,
        retrieval_signature: str,
        query_embedding: list[float],
        top_k: int = 3,
        exclude_site_id: str | None = None,
        exclude_case_reference_id: str | None = None,
    ) -> list[dict[str, object]]:
        self.search_calls.append(
            {
                "profile_id": profile_id,
                "retrieval_signature": retrieval_signature,
                "query_embedding": query_embedding,
                "top_k": top_k,
                "exclude_site_id": exclude_site_id,
                "exclude_case_reference_id": exclude_case_reference_id,
            }
        )
        return [
            {
                "site_id": "site_other",
                "source_site_display_name": "Partner Site",
                "source_site_hospital_name": "Partner Hospital",
                "case_reference_id": "remote_case_ref_001",
                "culture_category": "fungal",
                "culture_species": "Fusarium",
                "thumbnail_url": "data:image/jpeg;base64,cmVtb3RlLXRodW1i",
                "similarity": 0.8123,
                "metadata_json": {
                    "representative_view": "white",
                    "visit_status": "active",
                    "active_stage": True,
                    "quality_score": 72.0,
                    "view_score": 70.0,
                    "predisposing_factor": ["trauma"],
                    "smear_result": "positive",
                    "polymicrobial": False,
                    "image_count": 4,
                },
            }
        ]


class _FakeControlPlane:
    def __init__(self) -> None:
        self.remote_control_plane = _FakeRemoteControlPlane()

    def remote_node_sync_enabled(self) -> bool:
        return True

    def case_reference_id(self, site_id: str, patient_id: str, visit_date: str) -> str:
        return f"case_ref::{site_id}::{patient_id}::{visit_date}"


class _FakeAiClinicWorkflow:
    def _normalize_retrieval_profile(self, retrieval_profile: str | None) -> dict[str, object]:
        return {
            "profile_id": str(retrieval_profile or "dinov2_lesion_crop"),
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
        }


class _FakeDinov2Retriever:
    source_label = "official"
    source_reference = "facebook/dinov2-base"


class _FakeService:
    def __init__(self) -> None:
        self.control_plane = _FakeControlPlane()
        self.ai_clinic_workflow = _FakeAiClinicWorkflow()
        self.dinov2_retriever = _FakeDinov2Retriever()

    def _case_metadata_snapshot(
        self,
        summary: dict[str, object],
        case_records: list[dict[str, object]],
        quality_cache: dict[str, dict[str, object] | None],
    ) -> dict[str, object]:
        return {
            "representative_view": summary.get("representative_view") or "white",
            "visit_status": summary.get("visit_status") or "active",
            "active_stage": bool(summary.get("active_stage", True)),
            "quality_score": 81.5,
            "view_score": 78.0,
            "contact_lens_use": summary.get("contact_lens_use") or "",
            "predisposing_factor": ["trauma"],
            "smear_result": summary.get("smear_result") or "",
            "polymicrobial": bool(summary.get("polymicrobial", False)),
            "image_count": len(case_records),
        }

    def _prepare_case_dinov2_embedding(
        self,
        site_store: object,
        case_records: list[dict[str, object]],
        model_version: dict[str, object],
        execution_device: str,
        *,
        force_refresh: bool = False,
    ) -> np.ndarray:
        return np.asarray([0.25, 0.5, 0.75], dtype=np.float32)

    def _metadata_reranking_adjustment(
        self,
        query_metadata: dict[str, object],
        candidate_metadata: dict[str, object],
    ) -> dict[str, object]:
        adjustment = 0.03 if (
            query_metadata.get("representative_view") == candidate_metadata.get("representative_view")
            and query_metadata.get("visit_status") == candidate_metadata.get("visit_status")
        ) else 0.0
        return {
            "adjustment": adjustment,
            "details": {"test_alignment": adjustment},
            "alignment": {
                "matched_fields": ["representative_view", "visit_status"] if adjustment else [],
                "conflicted_fields": [],
            },
        }

    def _select_representative_record(self, case_records: list[dict[str, object]]) -> dict[str, object]:
        return dict(case_records[0])

    def _build_embedded_review_artifact(
        self,
        source_path: str,
        output_path: Path,
        *,
        max_size: tuple[int, int],
    ) -> dict[str, object] | None:
        return {
            "media_type": "image/jpeg",
            "encoding": "base64",
            "bytes_b64": base64.b64encode(b"thumbnail-bytes").decode("ascii"),
        }


class _FakeSiteStore:
    site_id = "site_demo"

    def __init__(self) -> None:
        self.artifact_dir = Path.cwd() / "tmp_test_artifacts"

    def list_case_summaries(self) -> list[dict[str, object]]:
        return [
            {
                "patient_id": "patient_positive",
                "visit_date": "2026-04-08",
                "culture_category": "fungal",
                "culture_species": "Fusarium",
                "representative_view": "white",
                "visit_status": "active",
                "active_stage": True,
            },
            {
                "patient_id": "patient_negative",
                "visit_date": "2026-04-07",
                "culture_category": "",
                "culture_species": "",
                "representative_view": "white",
                "visit_status": "active",
                "active_stage": True,
            },
        ]

    def case_research_policy_state(self, patient_id: str, visit_date: str) -> dict[str, object]:
        if patient_id == "patient_positive":
            return {
                "is_positive": True,
                "is_registry_included": True,
                "has_images": True,
                "case_summary": self.list_case_summaries()[0],
            }
        return {
            "is_positive": False,
            "is_registry_included": False,
            "has_images": True,
            "case_summary": self.list_case_summaries()[1],
        }

    def case_records_for_visit(self, patient_id: str, visit_date: str) -> list[dict[str, object]]:
        return [
            {
                "patient_id": patient_id,
                "visit_date": visit_date,
                "image_path": f"/tmp/{patient_id}_{visit_date}.png",
                "view": "white",
                "is_representative": True,
            }
        ]


class FederatedRetrievalWorkflowTests(unittest.TestCase):
    def test_sync_uploads_only_positive_included_cases(self) -> None:
        service = _FakeService()
        workflow = ResearchFederatedRetrievalWorkflow(service)  # type: ignore[arg-type]
        site_store = _FakeSiteStore()
        progress_events: list[dict[str, object]] = []

        result = workflow.sync_remote_retrieval_corpus(
            site_store,  # type: ignore[arg-type]
            execution_device="cpu",
            retrieval_profile="dinov2_lesion_crop",
            force_refresh=False,
            batch_size=16,
            progress_callback=lambda payload: progress_events.append(dict(payload)),
        )

        self.assertEqual(result["eligible_case_count"], 1)
        self.assertEqual(result["prepared_entry_count"], 1)
        self.assertEqual(result["skipped"]["not_positive"], 1)
        self.assertEqual(result["remote_sync"]["inserted_count"], 1)
        self.assertEqual(len(service.control_plane.remote_control_plane.calls), 1)

        upload_call = service.control_plane.remote_control_plane.calls[0]
        self.assertEqual(upload_call["profile_id"], "dinov2_lesion_crop")
        self.assertEqual(len(str(upload_call["retrieval_signature"])), 16)
        self.assertTrue(bool(upload_call["replace_site_profile_scope"]))
        entries = upload_call["entries"]
        self.assertIsInstance(entries, list)
        assert isinstance(entries, list)
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["case_reference_id"], "case_ref::site_demo::patient_positive::2026-04-08")
        self.assertEqual(entries[0]["culture_category"], "fungal")
        self.assertEqual(entries[0]["culture_species"], "Fusarium")
        self.assertTrue(str(entries[0]["thumbnail_url"]).startswith("data:image/jpeg;base64,"))
        self.assertGreaterEqual(len(progress_events), 2)
        self.assertEqual(progress_events[0]["stage"], "preparing_entries")
        self.assertEqual(progress_events[-1]["stage"], "sync_completed")
        self.assertEqual(result["remote_sync"]["deleted_count"], 0)

    def test_sync_replaces_remote_scope_even_when_no_eligible_cases_remain(self) -> None:
        class _NoEligibleSiteStore(_FakeSiteStore):
            def list_case_summaries(self) -> list[dict[str, object]]:
                return [
                    {
                        "patient_id": "patient_negative",
                        "visit_date": "2026-04-07",
                        "culture_category": "",
                        "culture_species": "",
                        "representative_view": "white",
                        "visit_status": "scar",
                        "active_stage": False,
                    }
                ]

            def case_research_policy_state(self, patient_id: str, visit_date: str) -> dict[str, object]:
                return {
                    "is_positive": False,
                    "is_registry_included": False,
                    "has_images": False,
                    "case_summary": self.list_case_summaries()[0],
                }

        service = _FakeService()
        service.control_plane.remote_control_plane.upload_retrieval_corpus_entries = lambda **kwargs: {
            "inserted_count": 0,
            "updated_count": 0,
            "deleted_count": 2,
        }
        workflow = ResearchFederatedRetrievalWorkflow(service)  # type: ignore[arg-type]

        result = workflow.sync_remote_retrieval_corpus(
            _NoEligibleSiteStore(),  # type: ignore[arg-type]
            execution_device="cpu",
            retrieval_profile="dinov2_lesion_crop",
            force_refresh=False,
            batch_size=16,
        )

        self.assertEqual(result["eligible_case_count"], 0)
        self.assertEqual(result["prepared_entry_count"], 0)
        self.assertEqual(result["remote_sync"]["deleted_count"], 2)
        self.assertEqual(result["remote_sync"]["batches"][0]["batch_size"], 0)

    def test_search_remote_retrieval_corpus_maps_remote_hits_to_ai_clinic_candidates(self) -> None:
        service = _FakeService()
        workflow = ResearchFederatedRetrievalWorkflow(service)  # type: ignore[arg-type]
        site_store = _FakeSiteStore()

        candidates = workflow.search_remote_retrieval_corpus(
            site_store,  # type: ignore[arg-type]
            query_embedding=np.asarray([0.2, 0.4, 0.8], dtype=np.float32),
            query_metadata={
                "representative_view": "white",
                "visit_status": "active",
                "active_stage": True,
                "predisposing_factor": ["trauma"],
                "smear_result": "positive",
            },
            patient_id="patient_positive",
            visit_date="2026-04-08",
            retrieval_profile="dinov2_lesion_crop",
            top_k=3,
        )

        self.assertEqual(len(candidates), 1)
        candidate = candidates[0]
        self.assertEqual(candidate["patient_id"], "remote_case_ref_001")
        self.assertEqual(candidate["visit_date"], "cross-site")
        self.assertEqual(candidate["culture_category"], "fungal")
        self.assertEqual(candidate["source_site_id"], "site_other")
        self.assertEqual(candidate["source_site_display_name"], "Partner Site")
        self.assertEqual(candidate["chart_alias"], "Partner Site")
        self.assertTrue(str(candidate["preview_url"]).startswith("data:image/jpeg;base64,"))
        self.assertEqual(candidate["retrieval_source"], "remote_control_plane")
        self.assertGreater(float(candidate["similarity"]), float(candidate["base_similarity"]))
        self.assertEqual(len(service.control_plane.remote_control_plane.search_calls), 1)


if __name__ == "__main__":
    unittest.main()
