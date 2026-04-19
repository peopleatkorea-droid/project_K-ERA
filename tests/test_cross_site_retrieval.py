from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from kera_research.api.cross_site_retrieval import (
    enrich_cross_site_retrieval_details,
    resolve_cross_site_status_profile,
    should_queue_cross_site_corpus_sync,
    summarize_cross_site_corpus_status,
)


class CrossSiteRetrievalSupportTests(unittest.TestCase):
    def test_resolve_cross_site_status_profile_prefers_effective_profile_when_fallback_is_used(self) -> None:
        profile = resolve_cross_site_status_profile(
            requested_profile_id="dinov2_lesion_crop",
            requested_profile_label="DINOv2 lesion-crop retrieval",
            effective_profile_id="dinov2_cornea_roi",
            effective_profile_label="DINOv2 cornea-ROI retrieval",
            cross_site_status="cache_fallback",
        )

        self.assertEqual(profile["requested_profile_id"], "dinov2_lesion_crop")
        self.assertEqual(profile["effective_profile_id"], "dinov2_cornea_roi")
        self.assertEqual(profile["status_profile_id"], "dinov2_cornea_roi")
        self.assertEqual(
            profile["status_profile_label"],
            "DINOv2 cornea-ROI retrieval",
        )

    def test_summarize_cross_site_corpus_status_keeps_profile_metadata(self) -> None:
        summary = summarize_cross_site_corpus_status(
            {
                "remote_node_sync_enabled": True,
                "eligible_case_count": 9,
                "latest_sync": {
                    "prepared_entry_count": 5,
                },
                "active_job": None,
            },
            profile_id="dinov2_cornea_roi",
            profile_label="DINOv2 cornea-ROI retrieval",
        )

        self.assertEqual(summary["profile_id"], "dinov2_cornea_roi")
        self.assertEqual(summary["profile_label"], "DINOv2 cornea-ROI retrieval")
        self.assertEqual(summary["eligible_case_count"], 9)
        self.assertEqual(summary["latest_sync"]["prepared_entry_count"], 5)

    def test_should_queue_cross_site_corpus_sync_requires_recovery_and_sync_gap(self) -> None:
        self.assertTrue(
            should_queue_cross_site_corpus_sync(
                candidate_count=0,
                cross_site_status="cache_fallback",
                corpus_status={
                    "remote_node_sync_enabled": True,
                    "eligible_case_count": 12,
                    "latest_sync": {
                        "prepared_entry_count": 7,
                    },
                    "active_job": None,
                },
            )
        )

    def test_enrich_cross_site_retrieval_details_uses_effective_profile_for_status_and_sync(self) -> None:
        queue_calls: list[dict[str, object]] = []

        class _FakeControlPlane:
            def remote_node_sync_enabled(self) -> bool:
                return True

        class _FakeSiteStore:
            site_id = "site_demo"

            def list_case_summaries(self) -> list[dict[str, object]]:
                return [
                    {"patient_id": "P1", "visit_date": "Initial"},
                    {"patient_id": "P2", "visit_date": "Initial"},
                ]

            def case_research_policy_state(self, patient_id: str, visit_date: str) -> dict[str, object]:
                del patient_id, visit_date
                return {
                    "is_positive": True,
                    "is_registry_included": True,
                    "has_images": True,
                }

            def list_jobs(self) -> list[dict[str, object]]:
                return [
                    {
                        "job_id": "sync_job_1",
                        "job_type": "federated_retrieval_corpus_sync",
                        "status": "completed",
                        "payload": {
                            "retrieval_profile": "dinov2_cornea_roi",
                        },
                        "result": {
                            "response": {
                                "retrieval_profile": "dinov2_cornea_roi",
                                "prepared_entry_count": 1,
                                "eligible_case_count": 2,
                            }
                        },
                        "finished_at": "2026-04-20T00:00:00+00:00",
                    }
                ]

        class _FakeWorkflow:
            def retrieval_signature(self, retrieval_profile: str = "dinov2_lesion_crop") -> dict[str, object]:
                return {
                    "profile_id": retrieval_profile,
                    "retrieval_signature": f"sig_{retrieval_profile}",
                    "profile_metadata": {
                        "label": retrieval_profile,
                    },
                    "model_version": {
                        "version_id": f"retrieval_profile_{retrieval_profile}",
                    },
                }

        def _queue_sync(cp, site_store, *, trigger: str, retrieval_profile: str) -> dict[str, object]:
            del cp, site_store
            queue_calls.append({
                "trigger": trigger,
                "retrieval_profile": retrieval_profile,
            })
            return {"queued": True, "retrieval_profile": retrieval_profile}

        details = enrich_cross_site_retrieval_details(
            cp=_FakeControlPlane(),
            site_store=_FakeSiteStore(),
            workflow=_FakeWorkflow(),
            requested_profile_id="dinov2_lesion_crop",
            requested_profile_label="DINOv2 lesion-crop retrieval",
            effective_profile_id="dinov2_cornea_roi",
            effective_profile_label="DINOv2 cornea-ROI retrieval",
            cross_site_status="cache_fallback",
            candidate_count=0,
            queue_sync=_queue_sync,
            sync_trigger="ai_clinic_cross_site_recovery",
            build_status=lambda cp, site_store, *, retrieval_profile, workflow_factory: {
                "remote_node_sync_enabled": True,
                "eligible_case_count": 2,
                "latest_sync": {
                    "prepared_entry_count": 1,
                },
                "active_job": None,
                "profile_id": retrieval_profile,
                "profile_metadata": {
                    "label": retrieval_profile,
                },
            },
        )

        self.assertEqual(details["status_profile_id"], "dinov2_cornea_roi")
        self.assertEqual(details["corpus_status"]["profile_id"], "dinov2_cornea_roi")
        self.assertTrue(bool(details["opportunistic_sync"]["queued"]))
        self.assertEqual(len(queue_calls), 1)
        self.assertEqual(queue_calls[0]["retrieval_profile"], "dinov2_cornea_roi")
        self.assertFalse(
            should_queue_cross_site_corpus_sync(
                candidate_count=3,
                cross_site_status="ready",
                corpus_status={
                    "remote_node_sync_enabled": True,
                    "eligible_case_count": 12,
                    "latest_sync": {
                        "prepared_entry_count": 12,
                    },
                    "active_job": None,
                },
            )
        )


if __name__ == "__main__":
    unittest.main()
