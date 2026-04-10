from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


ROOT_DIR = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))


def reload_app_module(db_path: Path):
    for env_name in (
        "KERA_DATABASE_URL",
        "DATABASE_URL",
        "KERA_CONTROL_PLANE_DATABASE_URL",
        "KERA_AUTH_DATABASE_URL",
        "KERA_DATA_PLANE_DATABASE_URL",
        "KERA_LOCAL_DATABASE_URL",
        "KERA_LOCAL_CONTROL_PLANE_DATABASE_URL",
        "KERA_CONTROL_PLANE_LOCAL_DATABASE_URL",
        "KERA_STORAGE_DIR",
        "KERA_STORAGE_STATE_FILE",
        "KERA_CONTROL_PLANE_DIR",
        "KERA_CONTROL_PLANE_ARTIFACT_DIR",
        "KERA_MODEL_DIR",
        "KERA_CASE_REFERENCE_SALT",
        "KERA_PATIENT_REFERENCE_SALT",
        "KERA_DISABLE_CASE_EMBEDDING_REFRESH",
        "KERA_SKIP_LOCAL_ENV_FILE",
        "KERA_AUTO_SITE_VALIDATION_INTERVAL_MINUTES",
        "KERA_AUTO_RETRIEVAL_SYNC_INTERVAL_MINUTES",
        "KERA_AUTO_SITE_AUTOMATION_POLL_SECONDS",
        "KERA_AUTO_SITE_VALIDATION_EXECUTION_MODE",
        "KERA_AUTO_RETRIEVAL_SYNC_EXECUTION_MODE",
        "KERA_AUTO_RETRIEVAL_SYNC_PROFILE",
    ):
        os.environ.pop(env_name, None)

    os.environ["KERA_DATABASE_URL"] = f"sqlite:///{db_path.as_posix()}"
    os.environ["KERA_API_SECRET"] = "test-secret-with-32-bytes-minimum!!"
    os.environ["KERA_CASE_REFERENCE_SALT"] = "test-case-reference-salt"
    os.environ["KERA_PATIENT_REFERENCE_SALT"] = "test-patient-reference-salt"
    os.environ["KERA_DISABLE_CASE_EMBEDDING_REFRESH"] = "true"
    os.environ["KERA_SKIP_LOCAL_ENV_FILE"] = "1"

    for module_name in list(sys.modules):
        if module_name.startswith("kera_research"):
            del sys.modules[module_name]

    import kera_research.api.app as app_module

    return app_module


class SiteAutomationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tempdir.name) / "kera.db"
        self.app_module = reload_app_module(self.db_path)

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def test_queue_periodic_site_validation_schedules_due_round(self) -> None:
        os.environ["KERA_AUTO_SITE_VALIDATION_INTERVAL_MINUTES"] = "60"
        fake_cp = SimpleNamespace(
            list_validation_runs=lambda **_: [],
            current_global_model=lambda: {"version_id": "model_visit_ready", "ready": True},
            local_current_model=lambda: None,
            list_sites=lambda: [{"site_id": "SITE_A", "project_id": "project_default"}],
            list_projects=lambda: [{"project_id": "project_default"}],
        )
        fake_site_store = SimpleNamespace(site_id="SITE_A", list_jobs=lambda status=None: [])

        with patch.object(self.app_module, "_resolve_execution_device", return_value="cpu"), patch.object(
            self.app_module, "_start_site_validation_impl"
        ) as start_mock:
            scheduled = self.app_module._queue_periodic_site_validation(fake_cp, fake_site_store)

        self.assertTrue(scheduled)
        start_mock.assert_called_once()
        kwargs = start_mock.call_args.kwargs
        self.assertEqual(kwargs["site_id"], "SITE_A")
        self.assertEqual(kwargs["project_id"], "project_default")
        self.assertEqual(kwargs["model_version"]["version_id"], "model_visit_ready")
        self.assertEqual(kwargs["execution_device"], "cpu")

    def test_queue_periodic_retrieval_sync_schedules_due_round(self) -> None:
        os.environ["KERA_AUTO_RETRIEVAL_SYNC_INTERVAL_MINUTES"] = "45"
        os.environ["KERA_AUTO_RETRIEVAL_SYNC_PROFILE"] = "dinov2_lesion_crop"
        fake_cp = SimpleNamespace(
            remote_node_sync_enabled=lambda: True,
        )
        fake_site_store = SimpleNamespace(site_id="SITE_A", list_jobs=lambda: [])

        with patch.object(self.app_module, "_latest_federated_retrieval_sync_job_impl", return_value=None), patch.object(
            self.app_module, "_resolve_execution_device", return_value="cpu"
        ), patch.object(self.app_module, "_start_federated_retrieval_corpus_sync_impl") as start_mock:
            scheduled = self.app_module._queue_periodic_retrieval_sync(fake_cp, fake_site_store)

        self.assertTrue(scheduled)
        start_mock.assert_called_once()
        kwargs = start_mock.call_args.kwargs
        self.assertEqual(kwargs["site_id"], "SITE_A")
        self.assertEqual(kwargs["execution_device"], "cpu")
        self.assertEqual(kwargs["payload"].retrieval_profile, "dinov2_lesion_crop")


if __name__ == "__main__":
    unittest.main()
