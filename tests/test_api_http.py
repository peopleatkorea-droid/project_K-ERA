from __future__ import annotations

import base64
import gc
import io
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import time
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

ROOT_DIR = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))


def reload_app_module(
    db_path: Path | None = None,
    *,
    control_plane_db_path: Path | None = None,
    data_plane_db_path: Path | None = None,
    control_plane_artifact_dir: Path | None = None,
):
    for env_name in (
        "KERA_DATABASE_URL",
        "DATABASE_URL",
        "KERA_CONTROL_PLANE_DATABASE_URL",
        "KERA_AUTH_DATABASE_URL",
        "KERA_DATA_PLANE_DATABASE_URL",
        "KERA_LOCAL_DATABASE_URL",
        "KERA_CONTROL_PLANE_ARTIFACT_DIR",
        "KERA_CASE_REFERENCE_SALT",
    ):
        os.environ.pop(env_name, None)

    if db_path is not None:
        os.environ["KERA_DATABASE_URL"] = f"sqlite:///{db_path.as_posix()}"
    if control_plane_db_path is not None:
        os.environ["KERA_CONTROL_PLANE_DATABASE_URL"] = f"sqlite:///{control_plane_db_path.as_posix()}"
    if data_plane_db_path is not None:
        os.environ["KERA_DATA_PLANE_DATABASE_URL"] = f"sqlite:///{data_plane_db_path.as_posix()}"
    if control_plane_artifact_dir is not None:
        os.environ["KERA_CONTROL_PLANE_ARTIFACT_DIR"] = str(control_plane_artifact_dir)

    os.environ["KERA_API_SECRET"] = "test-secret-with-32-bytes-minimum!!"
    os.environ["KERA_CASE_REFERENCE_SALT"] = "test-case-reference-salt"
    os.environ["KERA_ADMIN_USERNAME"] = "admin"
    os.environ["KERA_ADMIN_PASSWORD"] = "admin123"
    os.environ["KERA_RESEARCHER_USERNAME"] = "researcher"
    os.environ["KERA_RESEARCHER_PASSWORD"] = "research123"
    for module_name in list(sys.modules):
        if module_name.startswith("kera_research"):
            del sys.modules[module_name]
    import kera_research.api.app as app_module

    return app_module


class FakeModelManager:
    def aggregate_weight_deltas(self, delta_paths, output_path, weights=None, base_model_path=None):
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        Path(output_path).write_bytes(b"aggregated")


class FakeWorkflow:
    def __init__(self, app_module, control_plane):
        self.app_module = app_module
        self.control_plane = control_plane
        self.model_manager = FakeModelManager()

    def run_case_validation(
        self,
        project_id,
        site_store,
        patient_id,
        visit_date,
        model_version,
        execution_device,
        generate_gradcam=True,
        generate_medsam=True,
    ):
        artifact_dir = site_store.validation_dir / "http_case"
        artifact_dir.mkdir(parents=True, exist_ok=True)
        roi_path = artifact_dir / f"{patient_id}_{visit_date}_roi.png"
        gradcam_path = artifact_dir / f"{patient_id}_{visit_date}_gradcam.png"
        roi_path.write_bytes(b"roi")
        gradcam_path.write_bytes(b"gradcam")
        summary = {
            "validation_id": self.app_module.make_id("validation"),
            "project_id": project_id,
            "site_id": site_store.site_id,
            "model_version": model_version["version_name"],
            "model_version_id": model_version["version_id"],
            "model_architecture": model_version["architecture"],
            "run_date": "2026-03-11T00:00:00+00:00",
            "patient_id": patient_id,
            "visit_date": visit_date,
            "n_images": 1,
            "predicted_label": "bacterial",
            "true_label": "bacterial",
            "is_correct": True,
            "prediction_probability": 0.91,
        }
        case_prediction = {
            "validation_id": summary["validation_id"],
            "patient_id": patient_id,
            "visit_date": visit_date,
            "true_label": "bacterial",
            "predicted_label": "bacterial",
            "prediction_probability": 0.91,
            "is_correct": True,
            "roi_crop_path": str(roi_path),
            "gradcam_path": str(gradcam_path),
            "medsam_mask_path": None,
        }
        self.control_plane.save_validation_run(summary, [case_prediction])
        return summary, [case_prediction]

    def contribute_case(self, site_store, patient_id, visit_date, model_version, execution_device, user_id):
        delta_path = site_store.update_dir / f"{self.app_module.make_id('delta')}.pt"
        delta_path.parent.mkdir(parents=True, exist_ok=True)
        delta_path.write_bytes(b"delta")
        case_reference_id = self.control_plane.case_reference_id(site_store.site_id, patient_id, visit_date)
        update = {
            "update_id": self.app_module.make_id("update"),
            "site_id": site_store.site_id,
            "base_model_version_id": model_version["version_id"],
            "architecture": model_version["architecture"],
            "upload_type": "weight delta",
            "execution_device": execution_device,
            "artifact_path": str(delta_path),
            "n_cases": 1,
            "contributed_by": user_id,
            "case_reference_id": case_reference_id,
            "created_at": "2026-03-11T00:10:00+00:00",
            "training_input_policy": "medsam_cornea_crop_only",
            "training_summary": {"epochs": 1},
            "approval_report": {
                "site_id": site_store.site_id,
                "case_reference_id": case_reference_id,
                "artifacts": {},
            },
            "status": "pending_upload",
        }
        self.control_plane.register_model_update(update)
        self.control_plane.register_contribution(
            {
                "contribution_id": self.app_module.make_id("contrib"),
                "user_id": user_id,
                "site_id": site_store.site_id,
                "case_reference_id": case_reference_id,
                "update_id": update["update_id"],
                "created_at": "2026-03-11T00:10:00+00:00",
            }
        )
        return update

    def run_initial_training(
        self,
        site_store,
        architecture,
        output_model_path,
        execution_device,
        epochs=30,
        learning_rate=1e-4,
        batch_size=16,
        val_split=0.2,
        test_split=0.2,
        use_pretrained=True,
        use_medsam_crops=True,
        regenerate_split=False,
        progress_callback=None,
    ):
        output_path = Path(output_model_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(b"model")
        model_version = self.control_plane.ensure_model_version(
            {
                "version_id": self.app_module.make_id("model"),
                "version_name": f"global-{architecture}-http",
                "architecture": architecture,
                "stage": "global",
                "model_path": str(output_path),
                "created_at": "2026-03-11T00:20:00+00:00",
                "is_current": True,
                "ready": True,
                "requires_medsam_crop": True,
            }
        )
        return {
            "training_id": self.app_module.make_id("train"),
            "version_name": model_version["version_name"],
            "output_model_path": str(output_path),
            "n_train": 12,
            "n_val": 4,
            "n_test": 4,
            "n_train_patients": 6,
            "n_val_patients": 2,
            "n_test_patients": 2,
            "best_val_acc": 0.88,
            "use_pretrained": use_pretrained,
            "test_metrics": {"accuracy": 0.84},
            "patient_split": {"split_id": self.app_module.make_id("split")},
            "model_version": model_version,
        }

    def run_cross_validation(
        self,
        site_store,
        architecture,
        output_dir,
        execution_device,
        num_folds=5,
        epochs=10,
        learning_rate=1e-4,
        batch_size=16,
        val_split=0.2,
        use_pretrained=True,
        use_medsam_crops=True,
    ):
        report = {
            "cross_validation_id": self.app_module.make_id("cv"),
            "site_id": site_store.site_id,
            "architecture": architecture,
            "execution_device": execution_device,
            "created_at": "2026-03-11T00:30:00+00:00",
            "num_folds": num_folds,
            "epochs": epochs,
            "learning_rate": learning_rate,
            "batch_size": batch_size,
            "val_split": val_split,
            "use_pretrained": use_pretrained,
            "aggregate_metrics": {
                "accuracy": {"mean": 0.82, "std": 0.03},
                "AUROC": {"mean": 0.9, "std": 0.02},
            },
            "fold_results": [
                {
                    "fold_index": 1,
                    "n_train_patients": 6,
                    "n_val_patients": 2,
                    "n_test_patients": 2,
                    "n_train": 12,
                    "n_val": 4,
                    "n_test": 4,
                    "test_metrics": {"accuracy": 0.82},
                }
            ],
        }
        report_path = site_store.validation_dir / f"{report['cross_validation_id']}.json"
        report_path.write_text(json.dumps(report), encoding="utf-8")
        report["report_path"] = str(report_path)
        return report

    def run_external_validation(
        self,
        project_id,
        site_store,
        model_version,
        execution_device,
        generate_gradcam=True,
        generate_medsam=True,
    ):
        cases = site_store.list_case_summaries()
        if not cases:
            raise ValueError("No cases available for validation.")
        artifact_dir = site_store.validation_dir / "http_site"
        artifact_dir.mkdir(parents=True, exist_ok=True)
        case_predictions = []
        for index, case in enumerate(cases[:2]):
            roi_path = artifact_dir / f"{case['patient_id']}_{case['visit_date']}_roi_{index}.png"
            gradcam_path = artifact_dir / f"{case['patient_id']}_{case['visit_date']}_gradcam_{index}.png"
            roi_path.write_bytes(b"roi")
            gradcam_path.write_bytes(b"gradcam")
            is_correct = index == 0
            case_predictions.append(
                {
                    "validation_id": "",
                    "patient_id": case["patient_id"],
                    "visit_date": case["visit_date"],
                    "true_label": case["culture_category"],
                    "predicted_label": case["culture_category"] if is_correct else "fungal",
                    "prediction_probability": 0.91 if is_correct else 0.37,
                    "is_correct": is_correct,
                    "roi_crop_path": str(roi_path),
                    "gradcam_path": str(gradcam_path),
                    "medsam_mask_path": None,
                }
            )
        summary = {
            "validation_id": self.app_module.make_id("validation"),
            "project_id": project_id,
            "site_id": site_store.site_id,
            "model_version": model_version["version_name"],
            "model_version_id": model_version["version_id"],
            "model_architecture": model_version["architecture"],
            "run_date": "2026-03-11T01:00:00+00:00",
            "n_patients": len({item["patient_id"] for item in case_predictions}),
            "n_cases": len(case_predictions),
            "n_images": len(case_predictions),
            "AUROC": 0.81,
            "accuracy": 0.5,
            "sensitivity": 0.5,
            "specificity": 0.5,
            "F1": 0.5,
        }
        for prediction in case_predictions:
            prediction["validation_id"] = summary["validation_id"]
        self.control_plane.save_validation_run(summary, case_predictions)
        return summary, case_predictions, {"accuracy": 0.5}


class ApiHttpTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.control_plane_artifact_dir = Path(self.tempdir.name) / "control_artifacts"
        self.app_module = reload_app_module(
            Path(self.tempdir.name) / "test.db",
            control_plane_artifact_dir=self.control_plane_artifact_dir,
        )
        self.db_module = sys.modules["kera_research.db"]
        self.cp = self.app_module.ControlPlaneStore()
        project = self.cp.create_project("HTTP Test Project", "test", "user_admin")
        self.site_id = f"HTTP_{self.app_module.make_id('site')[-6:].upper()}"
        self.cp.create_site(project["project_id"], self.site_id, "HTTP Test Site", "HTTP Hospital")
        self.site_store = self.app_module.SiteStore(self.site_id)
        self.seed_model_path = ROOT_DIR / "models" / "http_seed_model.pth"
        self.seed_model_path.parent.mkdir(parents=True, exist_ok=True)
        self.seed_model_path.write_bytes(b"seed")
        self.cp.ensure_model_version(
            {
                "version_id": "model_http_seed",
                "version_name": "global-http-seed",
                "architecture": "densenet121",
                "stage": "global",
                "model_path": str(self.seed_model_path),
                "created_at": "2026-03-11T00:00:00+00:00",
                "ready": True,
                "is_current": True,
                "requires_medsam_crop": True,
            }
        )
        self.researcher = self.cp.upsert_user(
            {
                "user_id": self.app_module.make_id("user"),
                "username": "http_researcher",
                "password": "research123",
                "role": "researcher",
                "full_name": "HTTP Researcher",
                "site_ids": [self.site_id],
            }
        )
        self.site_admin = self.cp.upsert_user(
            {
                "user_id": self.app_module.make_id("user"),
                "username": "http_site_admin",
                "password": "siteadmin123",
                "role": "site_admin",
                "full_name": "HTTP Site Admin",
                "site_ids": [self.site_id],
            }
        )
        self.requester = self.cp.upsert_user(
            {
                "user_id": self.app_module.make_id("user"),
                "username": "http_viewer",
                "password": "viewer123",
                "role": "viewer",
                "full_name": "HTTP Viewer",
                "site_ids": [],
            }
        )
        from fastapi.testclient import TestClient

        self.client = TestClient(self.app_module.create_app())

    def tearDown(self):
        self.client.close()
        self.db_module.CONTROL_PLANE_ENGINE.dispose()
        self.db_module.DATA_PLANE_ENGINE.dispose()
        shutil.rmtree(self.site_store.site_dir, ignore_errors=True)
        if self.seed_model_path.exists():
            self.seed_model_path.unlink()
        for _ in range(3):
            try:
                self.tempdir.cleanup()
                break
            except PermissionError:
                gc.collect()
                time.sleep(0.2)
        else:
            self.tempdir.cleanup()

    def test_auth_and_local_case_data_can_use_separate_databases(self):
        old_site_dir = self.site_store.site_dir
        self.client.close()
        self.db_module.CONTROL_PLANE_ENGINE.dispose()
        self.db_module.DATA_PLANE_ENGINE.dispose()
        shutil.rmtree(old_site_dir, ignore_errors=True)
        self.tempdir.cleanup()

        split_tempdir = tempfile.TemporaryDirectory()
        self.tempdir = split_tempdir
        control_db = Path(split_tempdir.name) / "control.db"
        local_db = Path(split_tempdir.name) / "local.db"
        self.app_module = reload_app_module(
            control_plane_db_path=control_db,
            data_plane_db_path=local_db,
            control_plane_artifact_dir=Path(split_tempdir.name) / "control_artifacts",
        )
        self.db_module = sys.modules["kera_research.db"]
        self.cp = self.app_module.ControlPlaneStore()
        project = self.cp.create_project("Split DB Project", "test", "user_admin")
        self.site_id = "SPLIT_DB"
        self.cp.create_site(project["project_id"], self.site_id, "Split Site", "Split Hospital")
        self.site_store = self.app_module.SiteStore(self.site_id)
        from fastapi.testclient import TestClient

        self.client = TestClient(self.app_module.create_app())
        admin_token = self._login("admin", "admin123")
        self._seed_case(admin_token)

        with sqlite3.connect(control_db) as conn:
            control_tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            control_users = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        with sqlite3.connect(local_db) as conn:
            local_tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            local_patients = conn.execute("SELECT COUNT(*) FROM patients").fetchone()[0]

        self.assertIn("users", control_tables)
        self.assertNotIn("users", local_tables)
        self.assertGreaterEqual(control_users, 1)
        self.assertIn("patients", local_tables)
        self.assertEqual(local_patients, 1)

    def _login(self, username: str, password: str) -> str:
        response = self.client.post("/api/auth/login", json={"username": username, "password": password})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["access_token"]

    def _seed_case(self, token: str):
        patient_response = self.client.post(
            f"/api/sites/{self.site_id}/patients",
            headers={"Authorization": f"Bearer {token}"},
            json={"patient_id": "HTTP-001", "sex": "female", "age": 61, "chart_alias": "", "local_case_code": ""},
        )
        self.assertEqual(patient_response.status_code, 200, patient_response.text)
        visit_response = self.client.post(
            f"/api/sites/{self.site_id}/visits",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "patient_id": "HTTP-001",
                "visit_date": "2026-03-11",
                "culture_category": "bacterial",
                "culture_species": "Staphylococcus aureus",
                "contact_lens_use": "none",
                "visit_status": "active",
                "is_initial_visit": True,
            },
        )
        self.assertEqual(visit_response.status_code, 200, visit_response.text)
        self.assertTrue(visit_response.json()["is_initial_visit"])
        image_response = self.client.post(
            f"/api/sites/{self.site_id}/images",
            headers={"Authorization": f"Bearer {token}"},
            data={
                "patient_id": "HTTP-001",
                "visit_date": "2026-03-11",
                "view": "slit",
                "is_representative": "true",
            },
            files={"file": ("slit.png", b"fake-image", "image/png")},
        )
        self.assertEqual(image_response.status_code, 200, image_response.text)

    def test_case_validation_and_contribution_http(self):
        token = self._login("http_researcher", "research123")
        self._seed_case(token)
        fake_workflow = FakeWorkflow(self.app_module, self.cp)
        with patch.object(self.app_module, "_get_workflow", return_value=fake_workflow):
            validation_response = self.client.post(
                f"/api/sites/{self.site_id}/cases/validate",
                headers={"Authorization": f"Bearer {token}"},
                json={"patient_id": "HTTP-001", "visit_date": "2026-03-11", "execution_mode": "cpu"},
            )
            self.assertEqual(validation_response.status_code, 200, validation_response.text)
            validation_payload = validation_response.json()
            self.assertEqual(validation_payload["summary"]["predicted_label"], "bacterial")
            self.assertTrue(validation_payload["artifact_availability"]["roi_crop"])

            contribution_response = self.client.post(
                f"/api/sites/{self.site_id}/cases/contribute",
                headers={"Authorization": f"Bearer {token}"},
                json={"patient_id": "HTTP-001", "visit_date": "2026-03-11", "execution_mode": "cpu"},
            )
            self.assertEqual(contribution_response.status_code, 200, contribution_response.text)
            contribution_payload = contribution_response.json()
            self.assertEqual(contribution_payload["update"]["status"], "pending_upload")
            self.assertEqual(contribution_payload["stats"]["user_contributions"], 1)
            self.assertIn("case_reference_id", contribution_payload["update"])
            self.assertNotIn("patient_id", contribution_payload["update"])
            self.assertNotIn("visit_date", contribution_payload["update"])

            history_response = self.client.get(
                f"/api/sites/{self.site_id}/cases/history?patient_id=HTTP-001&visit_date=2026-03-11",
                headers={"Authorization": f"Bearer {token}"},
            )
            self.assertEqual(history_response.status_code, 200, history_response.text)
            history_payload = history_response.json()
            self.assertEqual(len(history_payload["contributions"]), 1)
            self.assertEqual(
                history_payload["contributions"][0]["case_reference_id"],
                contribution_payload["update"]["case_reference_id"],
            )

            activity_response = self.client.get(
                f"/api/sites/{self.site_id}/activity",
                headers={"Authorization": f"Bearer {token}"},
            )
            self.assertEqual(activity_response.status_code, 200, activity_response.text)
            activity_payload = activity_response.json()
            self.assertEqual(
                activity_payload["recent_contributions"][0]["case_reference_id"],
                contribution_payload["update"]["case_reference_id"],
            )
            self.assertNotIn("patient_id", activity_payload["recent_contributions"][0])
            self.assertNotIn("visit_date", activity_payload["recent_contributions"][0])

    def test_admin_model_update_artifact_can_be_served_from_embedded_thumbnail(self):
        admin_token = self._login("admin", "admin123")
        update_id = self.app_module.make_id("update")
        thumbnail_bytes = b"embedded-thumb"
        self.cp.register_model_update(
            {
                "update_id": update_id,
                "site_id": self.site_id,
                "architecture": "densenet121",
                "status": "pending_review",
                "created_at": "2026-03-11T00:15:00+00:00",
                "approval_report": {
                    "artifacts": {
                        "source_thumbnail": {
                            "media_type": "image/jpeg",
                            "encoding": "base64",
                            "bytes_b64": base64.b64encode(thumbnail_bytes).decode("ascii"),
                        }
                    }
                },
            }
        )

        response = self.client.get(
            f"/api/admin/model-updates/{update_id}/artifacts/source_thumbnail",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.content, thumbnail_bytes)
        self.assertEqual(response.headers.get("content-type"), "image/jpeg")

    def test_visit_auto_marks_polymicrobial_when_multiple_organisms_are_added(self):
        token = self._login("http_researcher", "research123")
        patient_response = self.client.post(
            f"/api/sites/{self.site_id}/patients",
            headers={"Authorization": f"Bearer {token}"},
            json={"patient_id": "HTTP-002", "sex": "female", "age": 58, "chart_alias": "", "local_case_code": ""},
        )
        self.assertEqual(patient_response.status_code, 200, patient_response.text)

        visit_response = self.client.post(
            f"/api/sites/{self.site_id}/visits",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "patient_id": "HTTP-002",
                "visit_date": "Initial",
                "culture_category": "bacterial",
                "culture_species": "Staphylococcus aureus",
                "additional_organisms": [
                    {
                        "culture_category": "fungal",
                        "culture_species": "Fusarium",
                    }
                ],
                "contact_lens_use": "none",
                "visit_status": "active",
                "is_initial_visit": True,
            },
        )
        self.assertEqual(visit_response.status_code, 200, visit_response.text)
        visit_payload = visit_response.json()
        self.assertTrue(visit_payload["polymicrobial"])
        self.assertEqual(len(visit_payload["additional_organisms"]), 1)
        self.assertEqual(visit_payload["additional_organisms"][0]["culture_species"], "Fusarium")

    def test_training_registry_and_aggregation_http(self):
        admin_token = self._login("admin", "admin123")
        self._seed_case(admin_token)
        fake_workflow = FakeWorkflow(self.app_module, self.cp)
        with patch.object(self.app_module, "_get_workflow", return_value=fake_workflow):
            training_response = self.client.post(
                f"/api/sites/{self.site_id}/training/initial",
                headers={"Authorization": f"Bearer {admin_token}"},
                json={"architecture": "convnext_tiny", "execution_mode": "cpu", "epochs": 2},
            )
            self.assertEqual(training_response.status_code, 200, training_response.text)
            self.assertEqual(training_response.json()["result"]["version_name"], "global-convnext_tiny-http")

            cv_response = self.client.post(
                f"/api/sites/{self.site_id}/training/cross-validation",
                headers={"Authorization": f"Bearer {admin_token}"},
                json={"architecture": "convnext_tiny", "execution_mode": "cpu", "num_folds": 3},
            )
            self.assertEqual(cv_response.status_code, 200, cv_response.text)

            list_response = self.client.get(
                f"/api/sites/{self.site_id}/training/cross-validation",
                headers={"Authorization": f"Bearer {admin_token}"},
            )
            self.assertEqual(list_response.status_code, 200, list_response.text)
            self.assertEqual(len(list_response.json()), 1)

            base_model = self.cp.current_global_model()
            for index in range(2):
                delta_path = self.site_store.update_dir / f"pending_{index}.pt"
                delta_path.parent.mkdir(parents=True, exist_ok=True)
                delta_path.write_bytes(b"delta")
                registered_update = self.cp.register_model_update(
                    {
                        "update_id": self.app_module.make_id("update"),
                        "site_id": self.site_id,
                        "base_model_version_id": base_model["version_id"],
                        "architecture": base_model["architecture"],
                        "upload_type": "weight delta",
                        "execution_device": "cpu",
                        "artifact_path": str(delta_path),
                        "n_cases": 1,
                        "created_at": f"2026-03-11T00:4{index}:00+00:00",
                        "status": "approved",
                    }
                )
                self.assertTrue(Path(str(registered_update["central_artifact_path"])).exists())
                delta_path.unlink()

            aggregation_response = self.client.post(
                "/api/admin/aggregations/run",
                headers={"Authorization": f"Bearer {admin_token}"},
                json={},
            )
            self.assertEqual(aggregation_response.status_code, 200, aggregation_response.text)
            aggregation_payload = aggregation_response.json()
            self.assertEqual(len(aggregation_payload["aggregated_update_ids"]), 2)

            aggregations_response = self.client.get("/api/admin/aggregations", headers={"Authorization": f"Bearer {admin_token}"})
            self.assertEqual(aggregations_response.status_code, 200, aggregations_response.text)
            self.assertEqual(len(aggregations_response.json()), 1)

    def test_access_request_review_http(self):
        requester_token = self._login("http_viewer", "viewer123")
        access_response = self.client.post(
            "/api/auth/request-access",
            headers={"Authorization": f"Bearer {requester_token}"},
            json={"requested_site_id": self.site_id, "requested_role": "researcher", "message": "Need site access"},
        )
        self.assertEqual(access_response.status_code, 200, access_response.text)

        admin_token = self._login("admin", "admin123")
        queue_response = self.client.get("/api/admin/access-requests?status_filter=pending", headers={"Authorization": f"Bearer {admin_token}"})
        self.assertEqual(queue_response.status_code, 200, queue_response.text)
        self.assertEqual(len(queue_response.json()), 1)
        request_id = queue_response.json()[0]["request_id"]

        review_response = self.client.post(
            f"/api/admin/access-requests/{request_id}/review",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"decision": "approved", "assigned_role": "researcher", "assigned_site_id": self.site_id, "reviewer_notes": "approved"},
        )
        self.assertEqual(review_response.status_code, 200, review_response.text)
        refreshed_user = self.cp.get_user_by_id(self.requester["user_id"])
        self.assertIn(self.site_id, refreshed_user["site_ids"] or [])

    def test_management_bulk_import_and_dashboard_http(self):
        admin_token = self._login("admin", "admin123")

        projects_response = self.client.get("/api/admin/projects", headers={"Authorization": f"Bearer {admin_token}"})
        self.assertEqual(projects_response.status_code, 200, projects_response.text)

        create_project_response = self.client.post(
          "/api/admin/projects",
          headers={"Authorization": f"Bearer {admin_token}"},
          json={"name": "Ops Project", "description": "ops"},
        )
        self.assertEqual(create_project_response.status_code, 200, create_project_response.text)
        project_id = create_project_response.json()["project_id"]

        create_site_response = self.client.post(
            "/api/admin/sites",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "project_id": project_id,
                "site_code": "OPS_HTTP",
                "display_name": "Ops HTTP Site",
                "hospital_name": "Ops Hospital",
            },
        )
        self.assertEqual(create_site_response.status_code, 200, create_site_response.text)

        update_site_response = self.client.patch(
            "/api/admin/sites/OPS_HTTP",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "display_name": "Ops HTTP Site Updated",
                "hospital_name": "Ops Hospital Updated",
            },
        )
        self.assertEqual(update_site_response.status_code, 200, update_site_response.text)
        self.assertEqual(update_site_response.json()["display_name"], "Ops HTTP Site Updated")
        self.assertEqual(update_site_response.json()["hospital_name"], "Ops Hospital Updated")

        create_user_response = self.client.post(
            "/api/admin/users",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "username": "ops_researcher",
                "full_name": "Ops Researcher",
                "password": "ops123",
                "role": "researcher",
                "site_ids": ["OPS_HTTP"],
            },
        )
        self.assertEqual(create_user_response.status_code, 200, create_user_response.text)
        users_response = self.client.get("/api/admin/users", headers={"Authorization": f"Bearer {admin_token}"})
        self.assertEqual(users_response.status_code, 200, users_response.text)
        self.assertTrue(any(item["username"] == "ops_researcher" for item in users_response.json()))

        template_response = self.client.get(
            "/api/sites/OPS_HTTP/import/template.csv",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        self.assertEqual(template_response.status_code, 200, template_response.text)
        self.assertIn("patient_id", template_response.text)

        csv_content = (
            "patient_id,chart_alias,local_case_code,sex,age,visit_date,culture_confirmed,culture_category,culture_species,"
            "contact_lens_use,predisposing_factor,visit_status,active_stage,smear_result,polymicrobial,other_history,image_filename,view,is_representative\n"
            "OPS-001,OPS-001,CASE-001,female,54,2026-03-11,TRUE,bacterial,Pseudomonas aeruginosa,none,trauma,active,TRUE,positive,FALSE,,ops_001_white.jpg,white,TRUE\n"
            "OPS-002,OPS-002,CASE-002,male,63,2026-03-12,TRUE,bacterial,Staphylococcus aureus,none,trauma,active,TRUE,negative,FALSE,,ops_002_slit.jpg,slit,TRUE\n"
        ).encode("utf-8")
        archive_buffer = io.BytesIO()
        with zipfile.ZipFile(archive_buffer, "w") as archive:
            archive.writestr("ops_001_white.jpg", b"image-1")
            archive.writestr("ops_002_slit.jpg", b"image-2")

        import_response = self.client.post(
            "/api/sites/OPS_HTTP/import/bulk",
            headers={"Authorization": f"Bearer {admin_token}"},
            files=[
                ("csv_file", ("ops_import.csv", csv_content, "text/csv")),
                ("files", ("ops_images.zip", archive_buffer.getvalue(), "application/zip")),
            ],
        )
        self.assertEqual(import_response.status_code, 200, import_response.text)
        import_payload = import_response.json()
        self.assertEqual(import_payload["created_patients"], 2)
        self.assertEqual(import_payload["imported_images"], 2)

        fake_workflow = FakeWorkflow(self.app_module, self.cp)
        with patch.object(self.app_module, "_get_workflow", return_value=fake_workflow):
            validation_response = self.client.post(
                "/api/sites/OPS_HTTP/validations/run",
                headers={"Authorization": f"Bearer {admin_token}"},
                json={"execution_mode": "cpu"},
            )
            self.assertEqual(validation_response.status_code, 200, validation_response.text)
            validation_id = validation_response.json()["summary"]["validation_id"]

        cases_response = self.client.get(
            f"/api/sites/OPS_HTTP/validations/{validation_id}/cases?misclassified_only=true&limit=4",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        self.assertEqual(cases_response.status_code, 200, cases_response.text)
        case_rows = cases_response.json()
        self.assertEqual(len(case_rows), 1)
        self.assertFalse(case_rows[0]["is_correct"])
        self.assertTrue(case_rows[0]["gradcam_available"])

        comparison_response = self.client.get(
            "/api/admin/site-comparison",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        self.assertEqual(comparison_response.status_code, 200, comparison_response.text)
        self.assertTrue(any(item["site_id"] == "OPS_HTTP" for item in comparison_response.json()))

    def test_site_admin_can_manage_storage_settings_and_empty_site_root(self):
        site_admin_token = self._login("http_site_admin", "siteadmin123")
        temp_storage_root = Path(self.tempdir.name) / "instance-storage-root"
        site_storage_root = temp_storage_root / self.site_id

        settings_response = self.client.get(
            "/api/admin/storage-settings",
            headers={"Authorization": f"Bearer {site_admin_token}"},
        )
        self.assertEqual(settings_response.status_code, 200, settings_response.text)

        update_settings_response = self.client.patch(
            "/api/admin/storage-settings",
            headers={"Authorization": f"Bearer {site_admin_token}"},
            json={"storage_root": str(temp_storage_root)},
        )
        self.assertEqual(update_settings_response.status_code, 200, update_settings_response.text)
        self.assertEqual(update_settings_response.json()["storage_root"], str(temp_storage_root.resolve()))

        update_site_root_response = self.client.patch(
            f"/api/admin/sites/{self.site_id}/storage-root",
            headers={"Authorization": f"Bearer {site_admin_token}"},
            json={"storage_root": str(site_storage_root)},
        )
        self.assertEqual(update_site_root_response.status_code, 200, update_site_root_response.text)
        self.assertEqual(update_site_root_response.json()["local_storage_root"], str(site_storage_root.resolve()))

        self._seed_case(site_admin_token)
        blocked_response = self.client.patch(
            f"/api/admin/sites/{self.site_id}/storage-root",
            headers={"Authorization": f"Bearer {site_admin_token}"},
            json={"storage_root": str(site_storage_root.parent / 'second-root')},
        )
        self.assertEqual(blocked_response.status_code, 400, blocked_response.text)
        self.assertIn("Storage root can only be changed", blocked_response.json()["detail"])

    def test_site_storage_root_migration_rewrites_existing_paths(self):
        site_admin_token = self._login("http_site_admin", "siteadmin123")
        original_root = Path(self.tempdir.name) / "site-original-root" / self.site_id
        migrated_root = Path(self.tempdir.name) / "site-migrated-root" / self.site_id

        prepare_root_response = self.client.patch(
            f"/api/admin/sites/{self.site_id}/storage-root",
            headers={"Authorization": f"Bearer {site_admin_token}"},
            json={"storage_root": str(original_root)},
        )
        self.assertEqual(prepare_root_response.status_code, 200, prepare_root_response.text)

        self._seed_case(site_admin_token)

        fake_workflow = FakeWorkflow(self.app_module, self.cp)
        with patch.object(self.app_module, "_get_workflow", return_value=fake_workflow):
            validation_response = self.client.post(
                f"/api/sites/{self.site_id}/cases/validate",
                headers={"Authorization": f"Bearer {site_admin_token}"},
                json={"patient_id": "HTTP-001", "visit_date": "2026-03-11", "execution_mode": "cpu"},
            )
            self.assertEqual(validation_response.status_code, 200, validation_response.text)
            validation_id = validation_response.json()["summary"]["validation_id"]

        predictions_before = self.cp.load_case_predictions(validation_id)
        self.assertTrue(str(predictions_before[0]["roi_crop_path"]).startswith(str(original_root.resolve())))

        migrate_response = self.client.post(
            f"/api/admin/sites/{self.site_id}/storage-root/migrate",
            headers={"Authorization": f"Bearer {site_admin_token}"},
            json={"storage_root": str(migrated_root)},
        )
        self.assertEqual(migrate_response.status_code, 200, migrate_response.text)
        self.assertEqual(migrate_response.json()["local_storage_root"], str(migrated_root.resolve()))

        predictions_after = self.cp.load_case_predictions(validation_id)
        self.assertTrue(str(predictions_after[0]["roi_crop_path"]).startswith(str(migrated_root.resolve())))
        self.assertFalse(original_root.exists())
        self.assertTrue(migrated_root.exists())

        artifact_response = self.client.get(
            f"/api/sites/{self.site_id}/validations/{validation_id}/artifacts/roi_crop?patient_id=HTTP-001&visit_date=2026-03-11",
            headers={"Authorization": f"Bearer {site_admin_token}"},
        )
        self.assertEqual(artifact_response.status_code, 200, artifact_response.text)


if __name__ == "__main__":
    unittest.main()
