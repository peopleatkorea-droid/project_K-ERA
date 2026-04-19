from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

ROOT_DIR = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from kera_research.services.pipeline_ai_clinic_workflow import ResearchAiClinicWorkflow


class _FakeControlPlane:
    def __init__(self, *, remote_enabled: bool = True) -> None:
        self._remote_enabled = remote_enabled

    def remote_node_sync_enabled(self) -> bool:
        return self._remote_enabled


class _FakeSiteStore:
    site_id = "site_demo"

    def __init__(self, artifact_dir: Path) -> None:
        self.artifact_dir = artifact_dir
        self._records = {
            ("QUERY-1", "Initial"): [
                {
                    "patient_id": "QUERY-1",
                    "visit_date": "Initial",
                    "image_path": "/tmp/query.png",
                    "view": "white",
                    "is_representative": True,
                }
            ],
            ("LOCAL-2", "Follow-up"): [
                {
                    "patient_id": "LOCAL-2",
                    "visit_date": "Follow-up",
                    "image_path": "/tmp/local.png",
                    "view": "white",
                    "is_representative": True,
                }
            ],
        }

    def dataset_records(self) -> list[dict[str, object]]:
        return [dict(item) for items in self._records.values() for item in items]

    def case_records_for_visit(self, patient_id: str, visit_date: str) -> list[dict[str, object]]:
        return [dict(item) for item in self._records.get((patient_id, visit_date), [])]

    def list_case_summaries(self) -> list[dict[str, object]]:
        return [
            {
                "patient_id": "QUERY-1",
                "visit_date": "Initial",
                "case_id": "query_case",
                "representative_image_id": "img_query",
                "representative_view": "white",
                "chart_alias": "Q-1",
                "local_case_code": "Q-1",
                "culture_category": "bacterial",
                "culture_species": "Pseudomonas",
                "image_count": 1,
                "visit_status": "active",
                "active_stage": True,
            },
            {
                "patient_id": "LOCAL-2",
                "visit_date": "Follow-up",
                "case_id": "local_case",
                "representative_image_id": "img_local",
                "representative_view": "white",
                "chart_alias": "L-2",
                "local_case_code": "L-2",
                "culture_category": "fungal",
                "culture_species": "Fusarium",
                "image_count": 1,
                "visit_status": "active",
                "active_stage": True,
            },
        ]

    def case_research_policy_state(self, patient_id: str, visit_date: str) -> dict[str, object]:
        summary = next(
            (
                item
                for item in self.list_case_summaries()
                if item["patient_id"] == patient_id and item["visit_date"] == visit_date
            ),
            {},
        )
        return {"visit": summary, "case_summary": summary}


class _FakeService:
    def __init__(self, *, remote_enabled: bool = True, fail_remote: bool = False) -> None:
        self.control_plane = _FakeControlPlane(remote_enabled=remote_enabled)
        self.fail_remote = fail_remote
        self.remote_search_calls: list[dict[str, object]] = []

    def _case_metadata_snapshot(
        self,
        summary: dict[str, object],
        case_records: list[dict[str, object]],
        quality_cache: dict[str, dict[str, object] | None],
    ) -> dict[str, object]:
        del case_records, quality_cache
        return {
            "representative_view": summary.get("representative_view") or "white",
            "visit_status": summary.get("visit_status") or "active",
            "active_stage": bool(summary.get("active_stage", True)),
            "quality_score": 82.0,
            "view_score": 80.0,
            "predisposing_factor": ["trauma"],
            "smear_result": "positive",
            "polymicrobial": False,
            "image_count": 1,
            "sex": "female",
            "age": 61,
            "contact_lens_use": "",
        }

    def _prepare_case_embedding(
        self,
        site_store,
        case_records,
        model_version,
        execution_device,
        *,
        loaded_models=None,
        force_refresh: bool = False,
    ):
        del site_store, case_records, model_version, execution_device, loaded_models, force_refresh
        return np.asarray([1.0, 0.0], dtype=np.float32)

    def _prepare_case_dinov2_embedding(
        self,
        site_store,
        case_records,
        model_version,
        execution_device,
        *,
        force_refresh: bool = False,
    ):
        del site_store, case_records, execution_device, force_refresh
        if str(model_version.get("crop_mode") or "") == "manual":
            raise RuntimeError("No lesion crops")
        return np.asarray([0.0, 1.0], dtype=np.float32)

    def _faiss_backend_hits(
        self,
        site_store,
        *,
        model_version,
        backend,
        query_embedding,
        top_k,
    ):
        del site_store, model_version, query_embedding, top_k
        if backend == "classifier":
            return [
                {
                    "patient_id": "LOCAL-2",
                    "visit_date": "Follow-up",
                    "similarity": 0.91,
                }
            ]
        return []

    def _load_cached_case_embedding_vector(
        self,
        site_store,
        *,
        patient_id,
        visit_date,
        model_version,
        backend,
    ):
        del site_store, patient_id, visit_date, model_version, backend
        return None

    def search_remote_retrieval_corpus(
        self,
        site_store,
        *,
        query_embedding,
        query_metadata,
        patient_id,
        visit_date,
        retrieval_profile="dinov2_lesion_crop",
        top_k=3,
    ):
        del site_store, query_embedding, query_metadata, patient_id, visit_date, top_k
        self.remote_search_calls.append({"retrieval_profile": retrieval_profile})
        if self.fail_remote:
            raise RuntimeError("central search down")
        return [
            {
                "case_id": "remote_case_1",
                "patient_id": "REMOTE-CASE-1",
                "visit_date": "cross-site",
                "local_case_code": "Partner Site / REMOTE-CA",
                "chart_alias": "Partner Site",
                "preview_url": "data:image/jpeg;base64,cmVtb3Rl",
                "similarity": 0.93,
                "culture_category": "fungal",
                "culture_species": "Fusarium",
                "representative_view": "white",
                "visit_status": "active",
                "metadata_reranking": {
                    "adjustment": 0.03,
                    "details": {"view": 0.03},
                    "alignment": {
                        "matched_fields": ["representative_view"],
                        "conflicted_fields": [],
                    },
                },
                "source_site_display_name": "Partner Site",
                "retrieval_source": "remote_control_plane",
            }
        ]

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
            "details": {"view": adjustment},
            "alignment": {
                "matched_fields": ["representative_view"] if adjustment else [],
                "conflicted_fields": [],
            },
        }

    def _resolve_model_crop_mode(self, model_version: dict[str, object]) -> str:
        return str(model_version.get("crop_mode") or "raw")


class AiClinicWorkflowTests(unittest.TestCase):
    def test_run_ai_clinic_similar_cases_reports_when_cross_site_sync_is_disabled(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            site_store = _FakeSiteStore(Path(tmpdir))
            service = _FakeService(remote_enabled=False, fail_remote=False)
            workflow = ResearchAiClinicWorkflow(service)  # type: ignore[arg-type]

            result = workflow.run_ai_clinic_similar_cases(
                site_store,  # type: ignore[arg-type]
                patient_id="QUERY-1",
                visit_date="Initial",
                model_version={
                    "version_id": "model_classifier",
                    "version_name": "classifier-v1",
                    "architecture": "convnext_tiny",
                    "crop_mode": "raw",
                },
                execution_device="cpu",
                top_k=3,
                retrieval_backend="classifier",
                retrieval_profile="dinov2_lesion_crop",
            )

        self.assertEqual(service.remote_search_calls, [])
        self.assertEqual(
            result["technical_details"]["cross_site_retrieval"]["status"],
            "disabled",
        )
        self.assertFalse(
            bool(result["technical_details"]["cross_site_retrieval"]["attempted"])
        )
        self.assertEqual(
            result["technical_details"]["cross_site_retrieval"]["warning"],
            "Cross-site retrieval corpus sync is not configured.",
        )

    def test_run_ai_clinic_similar_cases_uses_remote_profile_fallback_even_for_classifier_local_mode(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            site_store = _FakeSiteStore(Path(tmpdir))
            service = _FakeService(remote_enabled=True, fail_remote=False)
            workflow = ResearchAiClinicWorkflow(service)  # type: ignore[arg-type]

            result = workflow.run_ai_clinic_similar_cases(
                site_store,  # type: ignore[arg-type]
                patient_id="QUERY-1",
                visit_date="Initial",
                model_version={
                    "version_id": "model_classifier",
                    "version_name": "classifier-v1",
                    "architecture": "convnext_tiny",
                    "crop_mode": "raw",
                },
                execution_device="cpu",
                top_k=3,
                retrieval_backend="classifier",
                retrieval_profile="dinov2_lesion_crop",
            )

        self.assertEqual(len(service.remote_search_calls), 1)
        self.assertEqual(
            service.remote_search_calls[0]["retrieval_profile"],
            "dinov2_cornea_roi",
        )
        self.assertEqual(result["retrieval_backends_used"], ["classifier"])
        self.assertEqual(len(result["local_similar_cases"]), 1)
        self.assertEqual(len(result["cross_site_similar_cases"]), 1)
        self.assertEqual(
            result["technical_details"]["cross_site_retrieval"]["effective_profile_id"],
            "dinov2_cornea_roi",
        )
        self.assertEqual(
            result["technical_details"]["cross_site_retrieval"]["status"],
            "ready",
        )
        self.assertIn(
            "Requested DINOv2 retrieval profile",
            str(result.get("retrieval_warning") or ""),
        )

    def test_run_ai_clinic_similar_cases_uses_cached_remote_results_when_live_search_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            site_store = _FakeSiteStore(Path(tmpdir))
            service = _FakeService(remote_enabled=True, fail_remote=True)
            workflow = ResearchAiClinicWorkflow(service)  # type: ignore[arg-type]
            workflow._save_remote_retrieval_cache(
                site_store,  # type: ignore[arg-type]
                patient_id="QUERY-1",
                visit_date="Initial",
                requested_profile_id="dinov2_lesion_crop",
                used_profile_id="dinov2_cornea_roi",
                candidates=[
                    {
                        "case_id": "remote_cached_case_1",
                        "patient_id": "REMOTE-CACHED-1",
                        "visit_date": "cross-site",
                        "local_case_code": "Partner Site / REMOTE-CA",
                        "chart_alias": "Partner Site",
                        "preview_url": "data:image/jpeg;base64,Y2FjaGU=",
                        "similarity": 0.88,
                        "culture_category": "fungal",
                        "culture_species": "Aspergillus",
                        "representative_view": "white",
                        "visit_status": "active",
                        "metadata_reranking": {
                            "adjustment": 0.01,
                            "details": {"view": 0.01},
                            "alignment": {
                                "matched_fields": ["representative_view"],
                                "conflicted_fields": [],
                            },
                        },
                        "source_site_display_name": "Partner Site",
                        "retrieval_source": "remote_control_plane",
                    }
                ],
            )

            result = workflow.run_ai_clinic_similar_cases(
                site_store,  # type: ignore[arg-type]
                patient_id="QUERY-1",
                visit_date="Initial",
                model_version={
                    "version_id": "model_classifier",
                    "version_name": "classifier-v1",
                    "architecture": "convnext_tiny",
                    "crop_mode": "raw",
                },
                execution_device="cpu",
                top_k=3,
                retrieval_backend="classifier",
                retrieval_profile="dinov2_lesion_crop",
            )

        self.assertEqual(len(result["cross_site_similar_cases"]), 1)
        self.assertEqual(
            result["cross_site_similar_cases"][0]["patient_id"],
            "REMOTE-CACHED-1",
        )
        self.assertEqual(
            result["technical_details"]["cross_site_retrieval"]["status"],
            "cache_fallback",
        )
        self.assertTrue(
            bool(result["technical_details"]["cross_site_retrieval"]["cache_used"])
        )
        self.assertIn(
            "last successful cached cross-site results",
            str(result.get("retrieval_warning") or ""),
        )


if __name__ == "__main__":
    unittest.main()
