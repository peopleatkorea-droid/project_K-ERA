from __future__ import annotations

import gc
import io
import os
import shutil
import sys
import tempfile
import time
import unittest
from pathlib import Path
from PIL import Image
from sqlalchemy import select

ROOT_DIR = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))


def reload_app_module(
    db_path: Path,
    *,
    control_plane_artifact_dir: Path,
    model_distribution_mode: str = "local_path",
    control_plane_api_base_url: str | None = None,
    local_control_plane_db_path: Path | None = None,
    data_plane_database_url: str | None = None,
    storage_dir: Path | None = None,
    storage_state_value: Path | None = None,
) -> object:
    for env_name in (
        "KERA_DATABASE_URL",
        "DATABASE_URL",
        "KERA_CONTROL_PLANE_DATABASE_URL",
        "KERA_AUTH_DATABASE_URL",
        "KERA_DATA_PLANE_DATABASE_URL",
        "KERA_LOCAL_DATABASE_URL",
        "KERA_LOCAL_CONTROL_PLANE_DATABASE_URL",
        "KERA_CONTROL_PLANE_LOCAL_DATABASE_URL",
        "KERA_CONTROL_PLANE_API_BASE_URL",
        "KERA_STORAGE_DIR",
        "KERA_STORAGE_STATE_FILE",
        "KERA_CONTROL_PLANE_ARTIFACT_DIR",
        "KERA_CASE_REFERENCE_SALT",
        "KERA_PATIENT_REFERENCE_SALT",
        "KERA_DISABLE_CASE_EMBEDDING_REFRESH",
        "KERA_MODEL_DISTRIBUTION_MODE",
        "KERA_SKIP_LOCAL_ENV_FILE",
    ):
        os.environ.pop(env_name, None)

    os.environ["KERA_DATABASE_URL"] = f"sqlite:///{db_path.as_posix()}"
    if data_plane_database_url is not None:
        os.environ["KERA_DATA_PLANE_DATABASE_URL"] = data_plane_database_url
    os.environ["KERA_CONTROL_PLANE_ARTIFACT_DIR"] = str(control_plane_artifact_dir)
    if control_plane_api_base_url is not None:
        os.environ["KERA_CONTROL_PLANE_API_BASE_URL"] = control_plane_api_base_url
    if local_control_plane_db_path is not None:
        os.environ["KERA_LOCAL_CONTROL_PLANE_DATABASE_URL"] = f"sqlite:///{local_control_plane_db_path.as_posix()}"
    if storage_dir is not None:
        os.environ["KERA_STORAGE_DIR"] = str(storage_dir)
    storage_state_file = db_path.parent / "storage_dir_state.txt"
    os.environ["KERA_STORAGE_STATE_FILE"] = str(storage_state_file)
    if storage_state_value is not None:
        storage_state_file.parent.mkdir(parents=True, exist_ok=True)
        storage_state_file.write_text(str(storage_state_value), encoding="utf-8")
    else:
        storage_state_file.unlink(missing_ok=True)
    os.environ["KERA_API_SECRET"] = "test-secret-with-32-bytes-minimum!!"
    os.environ["KERA_SKIP_LOCAL_ENV_FILE"] = "1"
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

    def _make_test_image_bytes(self, image_format: str = "PNG", color: str = "white") -> bytes:
        buffer = io.BytesIO()
        Image.new("RGB", (24, 24), color=color).save(buffer, format=image_format)
        return buffer.getvalue()

    def _seed_recoverable_site(self, site_id: str = "REC_SITE"):
        project = self.cp.create_project(f"{site_id} Project", "test", "owner")
        self.cp.create_site(project["project_id"], site_id, f"{site_id} Display", f"{site_id} Hospital")
        site_store = self.app_module.SiteStore(site_id)
        patient_id = "00324192"
        site_store.create_patient(patient_id, "female", 54, created_by_user_id="owner")
        site_store.create_visit(
            patient_id=patient_id,
            visit_date="Initial",
            actual_visit_date="2026-03-17",
            culture_confirmed=True,
            culture_category="bacterial",
            culture_species="Bacillus",
            additional_organisms=[],
            contact_lens_use="none",
            predisposing_factor=["trauma"],
            other_history="",
            created_by_user_id="owner",
        )
        image = site_store.add_image(
            patient_id=patient_id,
            visit_date="Initial",
            view="white",
            is_representative=True,
            file_name="recover.png",
            content=self._make_test_image_bytes(),
            created_by_user_id="owner",
        )
        site_store.update_lesion_prompt_box(
            image["image_id"],
            {"x0": 0.1, "y0": 0.2, "x1": 0.7, "y1": 0.8},
        )
        site_store.generate_manifest()
        return site_store, image

    def _reload_remote_control_plane_app(self) -> None:
        self.db_module.CONTROL_PLANE_ENGINE.dispose()
        self.db_module.DATA_PLANE_ENGINE.dispose()
        self.app_module = reload_app_module(
            Path(self.tempdir.name) / "remote_data_plane.db",
            control_plane_artifact_dir=Path(self.tempdir.name) / "remote_control_artifacts",
            control_plane_api_base_url="https://control-plane.example.test",
            local_control_plane_db_path=Path(self.tempdir.name) / "remote_control_plane.db",
            storage_dir=Path(self.tempdir.name) / "remote_storage",
        )
        self.db_module = sys.modules["kera_research.db"]
        self.cp = self.app_module.ControlPlaneStore()

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

    def test_site_store_can_recover_metadata_from_manifest(self) -> None:
        site_store, image = self._seed_recoverable_site("REC_MANIFEST")
        site_store._clear_site_metadata_rows()

        result = site_store.recover_metadata(prefer_backup=False, force_replace=True)

        self.assertEqual(result["source"], "manifest")
        self.assertEqual(result["restored_patients"], 1)
        self.assertEqual(result["restored_visits"], 1)
        self.assertEqual(result["restored_images"], 1)
        self.assertEqual(len(site_store.list_patients()), 1)
        self.assertEqual(len(site_store.list_visits()), 1)
        recovered_images = site_store.list_images()
        self.assertEqual(len(recovered_images), 1)
        self.assertEqual(Path(recovered_images[0]["image_path"]).resolve(), Path(image["image_path"]).resolve())
        self.assertTrue(bool(recovered_images[0]["lesion_prompt_box"]))
        self.assertTrue(site_store.metadata_backup_path().exists())

    def test_site_store_prefers_metadata_backup_when_available(self) -> None:
        site_store, image = self._seed_recoverable_site("REC_BACKUP")
        site_store.export_metadata_backup()
        site_store.manifest_path.unlink(missing_ok=True)
        site_store._clear_site_metadata_rows()

        result = site_store.recover_metadata(prefer_backup=True, force_replace=True)

        self.assertEqual(result["source"], "backup")
        self.assertEqual(result["restored_patients"], 1)
        self.assertEqual(result["restored_visits"], 1)
        self.assertEqual(result["restored_images"], 1)
        recovered_images = site_store.list_images()
        self.assertEqual(len(recovered_images), 1)
        self.assertEqual(Path(recovered_images[0]["image_path"]).resolve(), Path(image["image_path"]).resolve())

    def test_instance_storage_root_treats_kera_data_setting_as_bundle_root(self) -> None:
        storage_bundle_root = Path(self.tempdir.name) / "KERA_DATA"
        self.cp.set_app_setting("instance_storage_root", str(storage_bundle_root))

        self.assertEqual(self.cp.instance_storage_root(), str((storage_bundle_root / "sites").resolve()))
        self.assertEqual(self.cp.instance_storage_root_source(), "custom")

    def test_site_store_uses_configured_default_root_even_when_remote_control_plane_is_present(self) -> None:
        self._reload_remote_control_plane_app()
        storage_bundle_root = Path(self.tempdir.name) / "KERA_DATA"
        self.cp.set_app_setting("instance_storage_root", str(storage_bundle_root))

        data_plane_module = sys.modules["kera_research.services.data_plane"]
        data_plane_module.invalidate_site_storage_root_cache("REMOTE_DEFAULT")
        site_store = self.app_module.SiteStore("REMOTE_DEFAULT")
        data_plane_module.invalidate_site_storage_root_cache("REMOTE_DEFAULT")

        self.assertEqual(site_store.site_dir.resolve(), (storage_bundle_root / "sites" / "REMOTE_DEFAULT").resolve())

    def test_remote_control_plane_mode_requires_local_sqlite_data_plane(self) -> None:
        self.db_module.CONTROL_PLANE_ENGINE.dispose()
        self.db_module.DATA_PLANE_ENGINE.dispose()

        with self.assertRaises(RuntimeError) as ctx:
            reload_app_module(
                Path(self.tempdir.name) / "misconfigured.db",
                control_plane_artifact_dir=Path(self.tempdir.name) / "control_artifacts",
                control_plane_api_base_url="https://control-plane.example.test",
                local_control_plane_db_path=Path(self.tempdir.name) / "control_plane_cache.db",
                data_plane_database_url="postgresql://example.invalid/remote_data_plane",
                storage_dir=Path(self.tempdir.name) / "remote_storage",
            )

        self.assertIn("requires KERA_DATA_PLANE_DATABASE_URL", str(ctx.exception))

    def test_site_store_keeps_local_storage_override_even_when_remote_control_plane_is_present(self) -> None:
        self._reload_remote_control_plane_app()
        project = self.cp.create_project("Remote Override Project", "test", "owner")
        self.cp.create_site(project["project_id"], "REMOTE_SITE", "Remote Site", "Remote Hospital")
        custom_root = Path(self.tempdir.name) / "moved-site-root" / "REMOTE_SITE"
        self.cp.update_site_storage_root("REMOTE_SITE", str(custom_root))

        data_plane_module = sys.modules["kera_research.services.data_plane"]
        data_plane_module.invalidate_site_storage_root_cache("REMOTE_SITE")
        site_store = self.app_module.SiteStore("REMOTE_SITE")
        data_plane_module.invalidate_site_storage_root_cache("REMOTE_SITE")

        self.assertEqual(site_store.site_dir.resolve(), custom_root.resolve())

    def test_bundle_move_remaps_site_paths_without_metadata_recovery(self) -> None:
        self.db_module.CONTROL_PLANE_ENGINE.dispose()
        self.db_module.DATA_PLANE_ENGINE.dispose()

        initial_storage = Path(self.tempdir.name) / "bundle_old" / "KERA_DATA"
        self.app_module = reload_app_module(
            initial_storage / "kera.db",
            control_plane_artifact_dir=initial_storage / "control_plane" / "artifacts",
            storage_dir=initial_storage,
        )
        self.db_module = sys.modules["kera_research.db"]
        self.cp = self.app_module.ControlPlaneStore()
        self.cp.set_app_setting("instance_storage_root", str(initial_storage))

        project = self.cp.create_project("Portable Bundle Project", "test", "owner")
        site_id = "PORTABLE_SITE"
        self.cp.create_site(project["project_id"], site_id, "Portable Site", "Portable Hospital")
        site_store = self.app_module.SiteStore(site_id)

        patient_id = "00010001"
        site_store.create_patient(patient_id, "female", 61, created_by_user_id="owner")
        site_store.create_visit(
            patient_id=patient_id,
            visit_date="Initial",
            actual_visit_date="2026-03-20",
            culture_confirmed=True,
            culture_category="fungal",
            culture_species="Fusarium",
            additional_organisms=[],
            contact_lens_use="none",
            predisposing_factor=["trauma"],
            other_history="",
            created_by_user_id="owner",
        )
        image = site_store.add_image(
            patient_id=patient_id,
            visit_date="Initial",
            view="white",
            is_representative=True,
            file_name="portable.png",
            content=self._make_test_image_bytes(),
            created_by_user_id="owner",
        )
        roi_crop_path = site_store.roi_crop_dir / f"{Path(image['image_path']).stem}_crop.png"
        roi_crop_path.write_bytes(self._make_test_image_bytes(color="blue"))
        self.cp.save_validation_run(
            {
                "validation_id": "validation_bundle_move",
                "project_id": project["project_id"],
                "site_id": site_id,
                "model_version": "portable-model",
                "run_date": "2026-03-21T00:00:00+00:00",
                "n_cases": 1,
                "n_images": 1,
            },
            [
                {
                    "site_id": site_id,
                    "patient_id": patient_id,
                    "visit_date": "Initial",
                    "predicted_label": "fungal",
                    "prediction_probability": 0.97,
                    "is_correct": True,
                    "n_source_images": 1,
                    "source_image_path": image["image_path"],
                    "roi_crop_path": str(roi_crop_path),
                }
            ],
        )

        self.db_module.CONTROL_PLANE_ENGINE.dispose()
        self.db_module.DATA_PLANE_ENGINE.dispose()
        new_storage = Path(self.tempdir.name) / "bundle_new" / "KERA_DATA"
        new_storage.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(initial_storage), str(new_storage))

        self.app_module = reload_app_module(
            new_storage / "kera.db",
            control_plane_artifact_dir=new_storage / "control_plane" / "artifacts",
            storage_dir=new_storage,
        )
        self.db_module = sys.modules["kera_research.db"]
        self.cp = self.app_module.ControlPlaneStore()

        self.assertEqual(self.cp.instance_storage_root(), str((new_storage / "sites").resolve()))

        site_store = self.app_module.SiteStore(site_id)
        self.assertEqual(site_store.site_dir.resolve(), (new_storage / "sites" / site_id).resolve())

        reloaded_image = site_store.get_image(image["image_id"])
        self.assertIsNotNone(reloaded_image)
        self.assertTrue(Path(str(reloaded_image["image_path"])).exists())
        self.assertTrue(str(reloaded_image["image_path"]).startswith(str((new_storage / "sites").resolve())))

        with self.db_module.DATA_PLANE_ENGINE.begin() as conn:
            stored_path = conn.execute(
                select(self.db_module.images.c.image_path).where(self.db_module.images.c.image_id == image["image_id"])
            ).scalar_one()
        self.assertEqual(str(stored_path), str(Path(str(reloaded_image["image_path"])).resolve()))

        manifest_df = site_store.generate_manifest()
        self.assertEqual(
            str(Path(str(manifest_df.iloc[0]["image_path"])).resolve()),
            str(Path(str(reloaded_image["image_path"])).resolve()),
        )

        predictions = self.cp.load_case_predictions("validation_bundle_move")
        self.assertEqual(len(predictions), 1)
        self.assertTrue(str(predictions[0]["source_image_path"]).startswith(str((new_storage / "sites").resolve())))
        self.assertTrue(str(predictions[0]["roi_crop_path"]).startswith(str((new_storage / "sites").resolve())))

    def test_storage_dir_falls_back_to_remembered_state_when_env_path_is_stale(self) -> None:
        self.db_module.CONTROL_PLANE_ENGINE.dispose()
        self.db_module.DATA_PLANE_ENGINE.dispose()

        remembered_storage = Path(self.tempdir.name) / "remembered" / "KERA_DATA"
        (remembered_storage / "sites").mkdir(parents=True, exist_ok=True)

        self.app_module = reload_app_module(
            Path(self.tempdir.name) / "state_fallback.db",
            control_plane_artifact_dir=Path(self.tempdir.name) / "control_artifacts_state",
            storage_dir=Path(self.tempdir.name) / "missing" / "KERA_DATA",
            storage_state_value=remembered_storage,
        )
        self.db_module = sys.modules["kera_research.db"]
        self.cp = self.app_module.ControlPlaneStore()
        config_module = sys.modules["kera_research.config"]

        self.assertEqual(config_module.STORAGE_DIR.resolve(), remembered_storage.resolve())
        self.assertEqual(Path(os.environ["KERA_STORAGE_DIR"]).resolve(), remembered_storage.resolve())
        self.assertEqual(self.cp.instance_storage_root(), str((remembered_storage / "sites").resolve()))

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
