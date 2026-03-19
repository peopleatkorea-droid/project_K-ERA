from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT_DIR = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from kera_research.services.job_runner import SiteJobWorker


class _FakeSiteStore:
    def __init__(self) -> None:
        self.site_id = "SITE_A"
        self.job = {
            "job_id": "job_benchmark",
            "status": "queued",
            "payload": {},
            "result": {},
        }

    def get_job(self, job_id: str) -> dict[str, object] | None:
        if job_id != self.job["job_id"]:
            return None
        return self.job

    def update_job_status(self, job_id: str, status: str, result: dict[str, object] | None = None) -> None:
        if job_id != self.job["job_id"]:
            raise AssertionError(f"Unexpected job id: {job_id}")
        self.job["status"] = status
        if result is not None:
            self.job["result"] = result


class _FakeWorkflow:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def run_initial_training(self, **kwargs: object) -> dict[str, object]:
        self.calls.append(kwargs)
        progress_callback = kwargs.get("progress_callback")
        if callable(progress_callback):
            progress_callback({"stage": "training_component", "percent": 50})
        architecture = str(kwargs.get("architecture") or "unknown")
        crop_mode = str(kwargs.get("crop_mode") or "unknown")
        return {
            "model_version": {
                "version_id": f"model_{architecture}",
                "architecture": architecture,
                "crop_mode": crop_mode,
            }
        }


class JobRunnerBenchmarkTests(unittest.TestCase):
    def test_benchmark_uses_dual_input_paired_crop_without_breaking_single_input_models(self) -> None:
        workflow = _FakeWorkflow()
        worker = SiteJobWorker(control_plane=None, workflow_factory=lambda cp: workflow)
        site_store = _FakeSiteStore()
        job = {
            "job_id": "job_benchmark",
            "payload": {
                "architectures": ["vit", "dual_input_concat"],
                "execution_device": "cpu",
                "crop_mode": "paired",
                "case_aggregation": "mean",
            },
        }

        with patch("kera_research.services.job_runner.SiteStore.heartbeat_job", return_value=None):
            result = worker._handle_initial_training_benchmark(site_store, job)

        self.assertEqual([call["architecture"] for call in workflow.calls], ["vit", "dual_input_concat"])
        self.assertEqual([call["crop_mode"] for call in workflow.calls], ["automated", "paired"])
        self.assertEqual(result["completed_architectures"], ["vit", "dual_input_concat"])
        self.assertEqual(result["failures"], [])


if __name__ == "__main__":
    unittest.main()
