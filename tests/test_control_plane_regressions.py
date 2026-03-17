from __future__ import annotations

import gc
import os
import shutil
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))


def reload_app_module(db_path: Path, *, control_plane_artifact_dir: Path, model_distribution_mode: str = "local_path") -> object:
    for env_name in (
        "KERA_DATABASE_URL",
        "DATABASE_URL",
        "KERA_CONTROL_PLANE_DATABASE_URL",
        "KERA_AUTH_DATABASE_URL",
        "KERA_DATA_PLANE_DATABASE_URL",
        "KERA_LOCAL_DATABASE_URL",
        "KERA_CONTROL_PLANE_ARTIFACT_DIR",
        "KERA_CASE_REFERENCE_SALT",
        "KERA_PATIENT_REFERENCE_SALT",
        "KERA_DISABLE_CASE_EMBEDDING_REFRESH",
        "KERA_MODEL_DISTRIBUTION_MODE",
    ):
        os.environ.pop(env_name, None)

    os.environ["KERA_DATABASE_URL"] = f"sqlite:///{db_path.as_posix()}"
    os.environ["KERA_CONTROL_PLANE_ARTIFACT_DIR"] = str(control_plane_artifact_dir)
    os.environ["KERA_API_SECRET"] = "test-secret-with-32-bytes-minimum!!"
    os.environ["KERA_CASE_REFERENCE_SALT"] = "test-case-reference-salt"
    os.environ["KERA_PATIENT_REFERENCE_SALT"] = "test-patient-reference-salt"
    os.environ["KERA_DISABLE_CASE_EMBEDDING_REFRESH"] = "true"
    os.environ["KERA_MODEL_DISTRIBUTION_MODE"] = model_distribution_mode
    os.environ["KERA_ADMIN_USERNAME"] = "admin"
    os.environ["KERA_ADMIN_PASSWORD"] = "admin123"

    for module_name in list(sys.modules):
        if module_name.startswith("kera_research"):
            del sys.modules[module_name]

    import kera_research.api.app as app_module

    return app_module


class ControlPlaneRegressionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.app_module = reload_app_module(
            Path(self.tempdir.name) / "test.db",
            control_plane_artifact_dir=Path(self.tempdir.name) / "control_artifacts",
        )
        self.db_module = sys.modules["kera_research.db"]
        self.cp = self.app_module.ControlPlaneStore()

    def tearDown(self) -> None:
        self.db_module.CONTROL_PLANE_ENGINE.dispose()
        self.db_module.DATA_PLANE_ENGINE.dispose()
        for _ in range(3):
            try:
                self.tempdir.cleanup()
                break
            except PermissionError:
                gc.collect()
                time.sleep(0.2)
        else:
            shutil.rmtree(self.tempdir.name, ignore_errors=True)

    def test_registry_collaborator_current_global_model_uses_store_versions(self) -> None:
        self.cp.ensure_model_version(
            {
                "version_id": "model_a",
                "version_name": "global-a",
                "architecture": "convnext_tiny",
                "stage": "global",
                "model_path": str(Path(self.tempdir.name) / "model_a.pth"),
                "created_at": "2026-03-10T00:00:00+00:00",
                "ready": True,
                "is_current": False,
            }
        )
        self.cp.ensure_model_version(
            {
                "version_id": "model_b",
                "version_name": "global-b",
                "architecture": "convnext_tiny",
                "model_path": str(Path(self.tempdir.name) / "model_b.pth"),
                "stage": "global",
                "created_at": "2026-03-11T00:00:00+00:00",
                "ready": True,
                "is_current": True,
            }
        )

        collaborator_model = self.cp.registry.current_global_model()
        forwarded_model = self.cp.current_global_model()

        self.assertIsNotNone(collaborator_model)
        self.assertEqual(collaborator_model["version_id"], "model_b")
        self.assertEqual(forwarded_model["version_id"], "model_b")

    def test_workspace_collaborator_returns_updated_site_records(self) -> None:
        project = self.cp.create_project("Regression Project", "test", "owner")
        self.cp.create_site(project["project_id"], "REG_SITE", "Regression Site", "Regression Hospital")

        updated_site = self.cp.workspace.update_site_storage_root(
            "REG_SITE",
            str(Path(self.tempdir.name) / "site-root"),
        )

        self.assertEqual(updated_site["site_id"], "REG_SITE")
        self.assertTrue(updated_site["local_storage_root"].endswith("site-root"))
        self.assertEqual(len(self.cp.workspace.list_projects()), 1)
        self.assertEqual(self.cp.workspace.get_site("REG_SITE")["display_name"], "Regression Site")

    def test_remote_distribution_versions_stay_pending_until_download_url_is_registered(self) -> None:
        self.db_module.CONTROL_PLANE_ENGINE.dispose()
        self.db_module.DATA_PLANE_ENGINE.dispose()
        self.app_module = reload_app_module(
            Path(self.tempdir.name) / "pending_upload.db",
            control_plane_artifact_dir=Path(self.tempdir.name) / "control_artifacts_pending",
            model_distribution_mode="download_url",
        )
        self.db_module = sys.modules["kera_research.db"]
        self.cp = self.app_module.ControlPlaneStore()

        checkpoint_path = Path(self.tempdir.name) / "pending_model.pth"
        checkpoint_path.write_bytes(b"test-checkpoint")

        version = self.cp.ensure_model_version(
            {
                "version_id": "model_pending_upload",
                "version_name": "global-pending-upload",
                "model_name": "keratitis_cls",
                "architecture": "convnext_tiny",
                "stage": "global",
                "model_path": str(checkpoint_path),
                "publish_required": True,
                "ready": True,
                "is_current": True,
                "created_at": "2026-03-17T00:00:00+00:00",
            }
        )

        self.assertFalse(version["ready"])
        self.assertFalse(version["is_current"])
        self.assertEqual(version["distribution_status"], "pending_upload")

    def test_validation_cases_store_patient_reference_and_visit_index(self) -> None:
        project = self.cp.create_project("Trajectory Project", "test", "owner")
        self.cp.create_site(project["project_id"], "TRAJ_SITE", "Trajectory Site", "Trajectory Hospital")
        site_store = self.app_module.SiteStore("TRAJ_SITE")
        site_store.create_patient("PT001", "female", 54, created_by_user_id="owner")
        visit = site_store.create_visit(
            patient_id="PT001",
            visit_date="FU2",
            actual_visit_date="2026-03-17",
            culture_confirmed=True,
            culture_category="fungal",
            culture_species="Fusarium",
            additional_organisms=[],
            contact_lens_use="none",
            predisposing_factor=["trauma"],
            other_history="",
            created_by_user_id="owner",
        )

        summary = {
            "validation_id": "validation_traj_001",
            "project_id": project["project_id"],
            "site_id": "TRAJ_SITE",
            "model_version": "global-test-v1",
            "model_version_id": "model_test_v1",
            "run_date": "2026-03-17T00:00:00+00:00",
            "n_cases": 1,
            "n_images": 1,
            "accuracy": 1.0,
        }
        case_prediction = {
            "validation_id": "validation_traj_001",
            "patient_id": "PT001",
            "visit_date": "FU2",
            "true_label": "fungal",
            "predicted_label": "fungal",
            "prediction_probability": 0.93,
            "is_correct": True,
        }

        self.cp.save_validation_run(summary, [case_prediction])
        rows = self.cp.list_validation_cases(validation_id="validation_traj_001")

        self.assertEqual(len(rows), 1)
        self.assertTrue(str(visit.get("patient_reference_id") or "").startswith("ptref_"))
        self.assertEqual(visit.get("visit_index"), 2)
        self.assertEqual(rows[0]["patient_reference_id"], visit["patient_reference_id"])
        self.assertEqual(rows[0]["visit_index"], 2)
        self.assertTrue(str(rows[0]["case_reference_id"]).startswith("caseref_"))


if __name__ == "__main__":
    unittest.main()
