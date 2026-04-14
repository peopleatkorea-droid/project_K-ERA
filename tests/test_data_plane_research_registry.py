from __future__ import annotations

import unittest

from kera_research.services.data_plane_research_registry import (
    case_research_policy_state,
)


class _FakeSiteStore:
    def __init__(
        self,
        *,
        visit: dict[str, object] | None,
        case_summaries: list[dict[str, object]] | None = None,
        visit_images: list[dict[str, object]] | None = None,
    ) -> None:
        self._visit = visit
        self._case_summaries = case_summaries or []
        self._visit_images = visit_images or []

    def get_visit(self, patient_id: str, visit_date: str) -> dict[str, object] | None:
        return self._visit

    def list_case_summaries(self, patient_id: str | None = None) -> list[dict[str, object]]:
        return list(self._case_summaries)

    def list_images_for_visit(
        self,
        patient_id: str,
        visit_date: str,
    ) -> list[dict[str, object]]:
        return list(self._visit_images)


class DataPlaneResearchRegistryTests(unittest.TestCase):
    def test_case_research_policy_state_prefers_case_summary_image_count(self) -> None:
        store = _FakeSiteStore(
            visit={
                "patient_id": "PT-1",
                "visit_date": "2026-04-10",
                "culture_status": "positive",
                "visit_status": "active",
                "research_registry_status": "included",
            },
            case_summaries=[
                {
                    "patient_id": "PT-1",
                    "visit_date": "2026-04-10",
                    "image_count": 7,
                }
            ],
            visit_images=[{"image_id": "image-a"}],
        )

        result = case_research_policy_state(store, "PT-1", "2026-04-10")

        self.assertEqual(result["image_count"], 7)
        self.assertTrue(result["has_images"])
        self.assertTrue(result["is_positive"])
        self.assertTrue(result["is_active"])
        self.assertTrue(result["is_registry_included"])

    def test_case_research_policy_state_falls_back_to_visit_images(self) -> None:
        store = _FakeSiteStore(
            visit={
                "patient_id": "PT-2",
                "visit_date": "2026-04-11",
                "culture_status": "",
                "active_stage": "",
                "research_registry_status": "analysis_only",
            },
            visit_images=[{"image_id": "image-a"}, {"image_id": "image-b"}],
        )

        result = case_research_policy_state(store, "PT-2", "2026-04-11")

        self.assertEqual(result["image_count"], 2)
        self.assertTrue(result["has_images"])
        self.assertEqual(result["visit_status"], "scar")
        self.assertEqual(result["research_registry_status"], "analysis_only")
        self.assertFalse(result["is_registry_included"])


if __name__ == "__main__":
    unittest.main()
