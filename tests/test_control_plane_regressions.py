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
from sqlalchemy import select, update

ROOT_DIR = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from kera_research.api.control_plane_proxy import site_record_for_request


def reload_app_module(
    db_path: Path,
    *,
    control_plane_artifact_dir: Path,
    model_distribution_mode: str = "local_path",
    control_plane_api_base_url: str | None = None,
    next_public_control_plane_api_base_url: str | None = None,
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
        "NEXT_PUBLIC_KERA_CONTROL_PLANE_API_BASE_URL",
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
    if next_public_control_plane_api_base_url is not None:
        os.environ["NEXT_PUBLIC_KERA_CONTROL_PLANE_API_BASE_URL"] = next_public_control_plane_api_base_url
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

    def _unique_patient_id(self, prefix: str = "PT") -> str:
        token = Path(self.tempdir.name).name.replace("-", "").upper()
        return f"{prefix}{token[:8]}"

    def _unique_site_id(self, prefix: str = "SITE") -> str:
        token = Path(self.tempdir.name).name.replace("-", "").upper()
        compact_prefix = "".join(ch for ch in prefix.upper() if ch.isalnum())[:16] or "SITE"
        return f"{compact_prefix}{token[:8]}"

    def _seed_recoverable_site(self, site_id: str = "REC_SITE"):
        unique_site_id = self._unique_site_id(site_id)
        project = self.cp.create_project(f"{unique_site_id} Project", "test", "owner")
        self.cp.create_site(
            project["project_id"],
            unique_site_id,
            f"{unique_site_id} Display",
            f"{unique_site_id} Hospital",
        )
        site_store = self.app_module.SiteStore(unique_site_id)
        patient_id = self._unique_patient_id("REC")
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

    def test_workspace_collaborator_backfills_institution_name_for_hira_site(self) -> None:
        project = self.cp.create_project("Institution Project", "test", "owner")
        self.cp.upsert_institutions(
            [
                {
                    "institution_id": "39100103",
                    "name": "Jeju National University Hospital",
                    "source": "hira",
                    "synced_at": "2026-03-22T00:00:00+00:00",
                }
            ]
        )
        self.cp.create_site(
            project["project_id"],
            "39100103",
            "39100103",
            "39100103",
            source_institution_id="39100103",
        )

        hydrated_site = self.cp.get_site("39100103")
        listed_site = next(site for site in self.cp.list_sites() if site["site_id"] == "39100103")

        self.assertEqual(hydrated_site["display_name"], "Jeju National University Hospital")
        self.assertEqual(hydrated_site["hospital_name"], "Jeju National University Hospital")
        self.assertEqual(listed_site["display_name"], "Jeju National University Hospital")
        self.assertEqual(listed_site["hospital_name"], "Jeju National University Hospital")

    def test_site_record_for_request_prefers_local_site_cache_before_remote_lookup(self) -> None:
        class RemoteControlPlaneStub:
            def __init__(self) -> None:
                self.called = False

            def main_sites(self, *, user_bearer_token: str) -> list[dict[str, str]]:
                self.called = True
                raise AssertionError("remote main_sites should not be called when local site metadata is available")

        class ControlPlaneStub:
            def __init__(self) -> None:
                self.remote_control_plane = RemoteControlPlaneStub()

            def remote_control_plane_enabled(self) -> bool:
                return True

            def get_site(self, site_id: str) -> dict[str, str]:
                return {
                    "site_id": site_id,
                    "display_name": "Local Site",
                    "hospital_name": "Local Hospital",
                }

        cp = ControlPlaneStub()

        site = site_record_for_request(
            cp,
            site_id="LOCAL_SITE",
            authorization="Bearer local-token",
            control_plane_owner=None,
        )

        self.assertEqual(site["site_id"], "LOCAL_SITE")
        self.assertEqual(site["display_name"], "Local Site")
        self.assertFalse(cp.remote_control_plane.called)

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

    def test_next_public_control_plane_api_base_url_enables_remote_cache_mode(self) -> None:
        self.db_module.CONTROL_PLANE_ENGINE.dispose()
        self.db_module.DATA_PLANE_ENGINE.dispose()

        self.app_module = reload_app_module(
            Path(self.tempdir.name) / "remote_data_plane_next_public.db",
            control_plane_artifact_dir=Path(self.tempdir.name) / "remote_control_artifacts_next_public",
            next_public_control_plane_api_base_url="https://control-plane.example.test",
            local_control_plane_db_path=Path(self.tempdir.name) / "remote_control_plane_next_public.db",
            storage_dir=Path(self.tempdir.name) / "remote_storage_next_public",
        )
        self.db_module = sys.modules["kera_research.db"]
        config_module = sys.modules["kera_research.config"]
        self.cp = self.app_module.ControlPlaneStore()

        self.assertEqual(config_module.CONTROL_PLANE_API_BASE_URL, "https://control-plane.example.test")
        self.assertEqual(self.db_module.DATABASE_TOPOLOGY["control_plane_connection_mode"], "remote_api_cache")
        self.assertTrue(self.cp.remote_control_plane_enabled())

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
        site_id = self._unique_site_id("PORTABLE_SITE")
        self.cp.create_site(project["project_id"], site_id, "Portable Site", "Portable Hospital")
        site_store = self.app_module.SiteStore(site_id)

        patient_id = self._unique_patient_id("PORT")
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
        site_id = self._unique_site_id("TRAJ_SITE")
        self.cp.create_site(project["project_id"], site_id, "Trajectory Site", "Trajectory Hospital")
        site_store = self.app_module.SiteStore(site_id)
        patient_id = self._unique_patient_id("TRJ")
        site_store.create_patient(patient_id, "female", 54, created_by_user_id="owner")
        visit = site_store.create_visit(
            patient_id=patient_id,
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
            "site_id": site_id,
            "model_version": "global-test-v1",
            "model_version_id": "model_test_v1",
            "run_date": "2026-03-17T00:00:00+00:00",
            "n_cases": 1,
            "n_images": 1,
            "accuracy": 1.0,
        }
        case_prediction = {
            "validation_id": "validation_traj_001",
            "patient_id": patient_id,
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

    def test_site_store_repairs_legacy_follow_up_labels_to_fu_number(self) -> None:
        project = self.cp.create_project("Legacy Visit Project", "test", "owner")
        site_id = self._unique_site_id("LEGACY_SITE")
        self.cp.create_site(project["project_id"], site_id, "Legacy Site", "Legacy Hospital")
        site_store = self.app_module.SiteStore(site_id)
        patient_id = self._unique_patient_id("LEG")
        site_store.create_patient(patient_id, "female", 61, created_by_user_id="owner")
        visit = site_store.create_visit(
            patient_id=patient_id,
            visit_date="FU #1",
            actual_visit_date="2026-03-13",
            culture_confirmed=True,
            culture_category="fungal",
            culture_species="Candida",
            additional_organisms=[],
            contact_lens_use="none",
            predisposing_factor=["trauma"],
            other_history="",
            created_by_user_id="owner",
        )
        site_store.add_image(
            patient_id=patient_id,
            visit_date="FU #1",
            view="white",
            is_representative=True,
            file_name="legacy_fu.png",
            content=self._make_test_image_bytes(),
            created_by_user_id="owner",
        )
        legacy_history_path = site_store._case_history_path(patient_id, "F/U-01")
        legacy_history_path.write_text('{"validations": [], "contributions": []}', encoding="utf-8")

        with self.db_module.DATA_PLANE_ENGINE.begin() as conn:
            conn.execute(
                update(self.db_module.visits)
                .where(self.db_module.visits.c.visit_id == visit["visit_id"])
                .values(visit_date="F/U-01")
            )
            conn.execute(
                update(self.db_module.images)
                .where(self.db_module.images.c.visit_id == visit["visit_id"])
                .values(visit_date="F/U-01")
            )

        sys.modules["kera_research.services.data_plane"]._SITE_LEGACY_VISIT_LABEL_REPAIRED.discard(site_id)
        repaired_store = self.app_module.SiteStore(site_id)
        canonical_visit = repaired_store.get_visit(patient_id, "FU #1")
        alternate_visit = repaired_store.get_visit(patient_id, "U1")

        self.assertIsNotNone(canonical_visit)
        self.assertIsNotNone(alternate_visit)
        self.assertEqual(canonical_visit["visit_date"], "FU #1")
        self.assertEqual(alternate_visit["visit_date"], "FU #1")
        self.assertEqual(len(repaired_store.list_images_for_visit(patient_id, "FU #1")), 1)
        self.assertEqual(len(repaired_store.list_images_for_visit(patient_id, "F/U-01")), 1)
        self.assertEqual(len(repaired_store.list_images_for_visit(patient_id, "U1")), 1)
        self.assertFalse(legacy_history_path.exists())
        self.assertTrue(site_store._case_history_path(patient_id, "FU #1").exists())

    def test_site_store_relinks_images_after_manual_folder_rename(self) -> None:
        project = self.cp.create_project("Manual Rename Project", "test", "owner")
        site_id = self._unique_site_id("RELINK_SITE")
        self.cp.create_site(project["project_id"], site_id, "Relink Site", "Relink Hospital")
        site_store = self.app_module.SiteStore(site_id)
        patient_id = self._unique_patient_id("RLK")
        site_store.create_patient(patient_id, "female", 58, created_by_user_id="owner")
        site_store.create_visit(
            patient_id=patient_id,
            visit_date="FU #1",
            actual_visit_date="2026-03-22",
            culture_confirmed=True,
            culture_category="fungal",
            culture_species="Candida",
            additional_organisms=[],
            contact_lens_use="none",
            predisposing_factor=["trauma"],
            other_history="",
            created_by_user_id="owner",
        )
        image = site_store.add_image(
            patient_id=patient_id,
            visit_date="FU #1",
            view="white",
            is_representative=True,
            file_name="manual_rename.png",
            content=self._make_test_image_bytes(),
            created_by_user_id="owner",
        )
        image_name = Path(str(image["image_path"])).name
        stale_path = site_store.raw_dir / patient_id / "F" / "U1" / image_name
        with self.db_module.DATA_PLANE_ENGINE.begin() as conn:
            conn.execute(
                update(self.db_module.images)
                .where(self.db_module.images.c.image_id == image["image_id"])
                .values(image_path=str(stale_path))
            )

        reloaded_store = self.app_module.SiteStore(site_id)
        resolved_image = reloaded_store.get_image(image["image_id"])

        self.assertIsNotNone(resolved_image)
        self.assertEqual(Path(str(resolved_image["image_path"])).resolve(), Path(str(image["image_path"])).resolve())
        self.assertEqual(len(reloaded_store.list_images_for_visit(patient_id, "FU #1")), 1)
        self.assertEqual(len(reloaded_store.dataset_records()), 1)

        with self.db_module.DATA_PLANE_ENGINE.begin() as conn:
            stored_path = conn.execute(
                select(self.db_module.images.c.image_path).where(self.db_module.images.c.image_id == image["image_id"])
            ).scalar()
        self.assertEqual(Path(str(stored_path)).resolve(), Path(str(image["image_path"])).resolve())

    def test_site_store_relinks_images_when_only_visit_file_remains(self) -> None:
        project = self.cp.create_project("Visit File Relink Project", "test", "owner")
        site_id = self._unique_site_id("VISIT_RELINK_SITE")
        self.cp.create_site(project["project_id"], site_id, "Visit Relink Site", "Visit Relink Hospital")
        site_store = self.app_module.SiteStore(site_id)
        patient_id = self._unique_patient_id("VRL")
        site_store.create_patient(patient_id, "female", 58, created_by_user_id="owner")
        site_store.create_visit(
            patient_id=patient_id,
            visit_date="FU #1",
            actual_visit_date="2026-03-22",
            culture_confirmed=True,
            culture_category="fungal",
            culture_species="Candida",
            additional_organisms=[],
            contact_lens_use="none",
            predisposing_factor=["trauma"],
            other_history="",
            created_by_user_id="owner",
        )
        image = site_store.add_image(
            patient_id=patient_id,
            visit_date="FU #1",
            view="white",
            is_representative=True,
            file_name="visit_relink.png",
            content=self._make_test_image_bytes(),
            created_by_user_id="owner",
        )

        original_path = Path(str(image["image_path"]))
        renamed_path = original_path.with_name("renamed_visit_only.png")
        original_path.replace(renamed_path)

        reloaded_store = self.app_module.SiteStore(site_id)
        resolved_image = reloaded_store.get_image(image["image_id"])

        self.assertIsNotNone(resolved_image)
        self.assertEqual(Path(str(resolved_image["image_path"])).resolve(), renamed_path.resolve())
        self.assertEqual(len(reloaded_store.dataset_records()), 1)

        with self.db_module.DATA_PLANE_ENGINE.begin() as conn:
            stored_path = conn.execute(
                select(self.db_module.images.c.image_path).where(self.db_module.images.c.image_id == image["image_id"])
            ).scalar()
        self.assertEqual(Path(str(stored_path)).resolve(), renamed_path.resolve())

    def test_site_summary_stats_auto_repairs_stale_image_paths(self) -> None:
        project = self.cp.create_project("Summary Relink Project", "test", "owner")
        site_id = self._unique_site_id("SUMMARY_RELINK_SITE")
        self.cp.create_site(project["project_id"], site_id, "Summary Relink Site", "Summary Relink Hospital")
        site_store = self.app_module.SiteStore(site_id)
        patient_id = self._unique_patient_id("SRL")
        site_store.create_patient(patient_id, "female", 58, created_by_user_id="owner")
        site_store.create_visit(
            patient_id=patient_id,
            visit_date="FU #1",
            actual_visit_date="2026-03-22",
            culture_confirmed=True,
            culture_category="fungal",
            culture_species="Candida",
            additional_organisms=[],
            contact_lens_use="none",
            predisposing_factor=["trauma"],
            other_history="",
            created_by_user_id="owner",
        )
        image = site_store.add_image(
            patient_id=patient_id,
            visit_date="FU #1",
            view="white",
            is_representative=True,
            file_name="summary_relink.png",
            content=self._make_test_image_bytes(),
            created_by_user_id="owner",
        )

        image_name = Path(str(image["image_path"])).name
        stale_path = site_store.raw_dir / patient_id / "F" / "U1" / image_name
        with self.db_module.DATA_PLANE_ENGINE.begin() as conn:
            conn.execute(
                update(self.db_module.images)
                .where(self.db_module.images.c.image_id == image["image_id"])
                .values(image_path=str(stale_path))
            )

        reloaded_store = self.app_module.SiteStore(site_id)
        summary = reloaded_store.site_summary_stats()

        self.assertEqual(summary["n_patients"], 1)
        self.assertEqual(summary["n_visits"], 1)
        self.assertEqual(summary["n_images"], 1)

        with self.db_module.DATA_PLANE_ENGINE.begin() as conn:
            stored_path = conn.execute(
                select(self.db_module.images.c.image_path).where(self.db_module.images.c.image_id == image["image_id"])
            ).scalar()
        self.assertEqual(Path(str(stored_path)).resolve(), Path(str(image["image_path"])).resolve())

    def test_site_store_standardizes_legacy_visit_folder_layout(self) -> None:
        project = self.cp.create_project("Storage Standardize Project", "test", "owner")
        site_id = self._unique_site_id("STD_SITE")
        self.cp.create_site(project["project_id"], site_id, "Standard Site", "Standard Hospital")
        site_store = self.app_module.SiteStore(site_id)
        patient_id = self._unique_patient_id("STD")
        site_store.create_patient(patient_id, "female", 59, created_by_user_id="owner")
        site_store.create_visit(
            patient_id=patient_id,
            visit_date="FU #1",
            actual_visit_date="2026-03-22",
            culture_confirmed=True,
            culture_category="fungal",
            culture_species="Candida",
            additional_organisms=[],
            contact_lens_use="none",
            predisposing_factor=["trauma"],
            other_history="",
            created_by_user_id="owner",
        )
        image = site_store.add_image(
            patient_id=patient_id,
            visit_date="FU #1",
            view="white",
            is_representative=True,
            file_name="standardize.png",
            content=self._make_test_image_bytes(),
            created_by_user_id="owner",
        )

        canonical_path = Path(str(image["image_path"]))
        legacy_path = site_store.raw_dir / patient_id / "F" / "U1" / canonical_path.name
        legacy_path.parent.mkdir(parents=True, exist_ok=True)
        canonical_path.replace(legacy_path)
        with self.db_module.DATA_PLANE_ENGINE.begin() as conn:
            conn.execute(
                update(self.db_module.images)
                .where(self.db_module.images.c.image_id == image["image_id"])
                .values(image_path=str(legacy_path))
            )

        result = site_store.standardize_visit_storage_layout(refresh_manifest=True)
        stored_image = site_store.get_image(image["image_id"])

        self.assertEqual(result["moved_files"], 1)
        self.assertEqual(result["updated_paths"], 1)
        self.assertGreaterEqual(result["removed_dirs"], 1)
        self.assertTrue(canonical_path.exists())
        self.assertFalse(legacy_path.exists())
        self.assertFalse((site_store.raw_dir / patient_id / "F").exists())
        self.assertEqual(Path(str(stored_image["image_path"])).resolve(), canonical_path.resolve())

    def test_site_store_syncs_raw_only_metadata_without_polluting_manifest(self) -> None:
        project = self.cp.create_project("Raw Sync Project", "test", "owner")
        site_id = self._unique_site_id("RAW_SYNC")
        self.cp.create_site(project["project_id"], site_id, "Raw Sync Site", "Raw Sync Hospital")
        site_store = self.app_module.SiteStore(site_id)

        visit_dir = site_store.raw_dir / "00415029" / "Initial"
        visit_dir.mkdir(parents=True, exist_ok=True)
        image_path = visit_dir / "raw_sync_slit.png"
        image_path.write_bytes(self._make_test_image_bytes())

        result = site_store.sync_raw_inventory_metadata()

        self.assertEqual(result["created_patients"], 1)
        self.assertEqual(result["created_visits"], 1)
        self.assertEqual(result["created_images"], 1)
        self.assertEqual(len(site_store.list_patients()), 1)
        visits = site_store.list_visits()
        self.assertEqual(len(visits), 1)
        self.assertFalse(bool(visits[0]["culture_confirmed"]))
        self.assertEqual(str(visits[0]["culture_category"] or ""), "")
        images = site_store.list_images()
        self.assertEqual(len(images), 1)
        self.assertEqual(Path(images[0]["image_path"]).resolve(), image_path.resolve())
        self.assertEqual(images[0]["view"], "slit")
        self.assertEqual(site_store.dataset_records(), [])
        self.assertEqual(site_store.list_case_summaries(), [])
        self.assertEqual(site_store.list_patient_case_rows()["items"], [])

        second_pass = site_store.sync_raw_inventory_metadata()
        self.assertEqual(second_pass["created_patients"], 0)
        self.assertEqual(second_pass["created_visits"], 0)
        self.assertEqual(second_pass["created_images"], 0)

    def test_site_store_sync_ignores_empty_raw_patient_directories(self) -> None:
        project = self.cp.create_project("Raw Empty Project", "test", "owner")
        site_id = self._unique_site_id("RAW_EMPTY")
        self.cp.create_site(project["project_id"], site_id, "Raw Empty Site", "Raw Empty Hospital")
        site_store = self.app_module.SiteStore(site_id)

        empty_visit_dir = site_store.raw_dir / "test" / "Initial"
        empty_visit_dir.mkdir(parents=True, exist_ok=True)

        result = site_store.sync_raw_inventory_metadata()

        self.assertEqual(result["created_patients"], 0)
        self.assertEqual(result["created_visits"], 0)
        self.assertEqual(result["created_images"], 0)
        self.assertEqual(len(site_store.list_patients()), 0)
        self.assertEqual(len(site_store.list_visits()), 0)
        self.assertEqual(len(site_store.list_images()), 0)

    def test_site_store_restores_placeholder_raw_sync_metadata_from_local_backup_db(self) -> None:
        storage_root = Path(self.tempdir.name) / "KERA_DATA"
        backup_db = storage_root / "kera-DESKTOP-V9HBNPO.db"
        current_db = storage_root / "kera.current.db"
        hidden_paths: list[tuple[Path, Path]] = []

        self.db_module.CONTROL_PLANE_ENGINE.dispose()
        self.db_module.DATA_PLANE_ENGINE.dispose()

        backup_module = reload_app_module(
            backup_db,
            control_plane_artifact_dir=Path(self.tempdir.name) / "backup_artifacts",
            storage_dir=storage_root,
            data_plane_database_url=f"sqlite:///{backup_db.as_posix()}",
        )
        backup_db_module = sys.modules["kera_research.db"]
        backup_cp = backup_module.ControlPlaneStore()
        site_id = self._unique_site_id("RAW_RESTORE")
        patient_id = "17870656"
        project = backup_cp.create_project("Raw Restore Project", "test", "owner")
        backup_cp.create_site(project["project_id"], site_id, "Restore Site", "Restore Hospital")
        backup_site_store = backup_module.SiteStore(site_id)
        backup_site_store.create_patient(patient_id, "female", 62, created_by_user_id="owner")
        backup_site_store.create_visit(
            patient_id=patient_id,
            visit_date="Initial",
            actual_visit_date="2026-03-17",
            culture_confirmed=True,
            culture_category="fungal",
            culture_species="Aspergillus",
            additional_organisms=[],
            contact_lens_use="none",
            predisposing_factor=[],
            other_history="",
            created_by_user_id="owner",
        )
        backup_site_store.add_image(
            patient_id=patient_id,
            visit_date="Initial",
            view="white",
            is_representative=True,
            file_name="restore.png",
            content=self._make_test_image_bytes(),
            created_by_user_id="owner",
        )

        backup_db_module.CONTROL_PLANE_ENGINE.dispose()
        backup_db_module.DATA_PLANE_ENGINE.dispose()
        for db_path in storage_root.glob("kera*.db"):
            hidden_path = db_path.with_suffix(db_path.suffix + ".hidden")
            db_path.replace(hidden_path)
            hidden_paths.append((db_path, hidden_path))

        current_module = reload_app_module(
            current_db,
            control_plane_artifact_dir=Path(self.tempdir.name) / "current_artifacts",
            storage_dir=storage_root,
            data_plane_database_url=f"sqlite:///{current_db.as_posix()}",
        )
        self.app_module = current_module
        self.db_module = sys.modules["kera_research.db"]
        self.cp = current_module.ControlPlaneStore()
        current_project = self.cp.create_project("Current Raw Restore Project", "test", "owner")
        self.cp.create_site(current_project["project_id"], site_id, "Restore Site", "Restore Hospital")
        current_site_store = current_module.SiteStore(site_id)

        first_pass = current_site_store.sync_raw_inventory_metadata()
        self.assertEqual(first_pass["created_patients"], 1)
        self.assertEqual(first_pass["created_visits"], 1)
        placeholder_patient = current_site_store.get_patient(patient_id)
        self.assertEqual(placeholder_patient["sex"], "unknown")
        self.assertEqual(placeholder_patient["age"], 0)
        placeholder_visit = current_site_store.get_visit(patient_id, "Initial")
        self.assertFalse(bool(placeholder_visit["culture_confirmed"]))
        self.assertEqual(str(placeholder_visit["research_registry_source"]), "raw_inventory_sync")

        for original_path, hidden_path in hidden_paths:
            if original_path == backup_db:
                hidden_path.replace(original_path)
        second_pass = current_site_store.sync_raw_inventory_metadata()
        restored_patient = current_site_store.get_patient(patient_id)
        restored_visit = current_site_store.get_visit(patient_id, "Initial")

        self.assertEqual(second_pass["restored_patients"], 1)
        self.assertEqual(restored_patient["sex"], "female")
        self.assertEqual(restored_patient["age"], 62)
        self.assertTrue(bool(restored_visit["culture_confirmed"]))
        self.assertEqual(str(restored_visit["culture_species"]), "Aspergillus")
        self.assertEqual(str(restored_visit["research_registry_source"]), "visit_create")
        self.assertEqual(len(current_site_store.dataset_records()), 1)


class ApiRouteBodyBindingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        root = Path(self.tempdir.name)
        artifact_dir = root / "artifacts"
        artifact_dir.mkdir(parents=True, exist_ok=True)
        self.app_module = reload_app_module(
            root / "control_plane.db",
            control_plane_artifact_dir=artifact_dir,
        )

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def test_case_image_mutation_routes_bind_payloads_from_request_body(self) -> None:
        app = self.app_module.app
        representative_route = next(
            route
            for route in app.routes
            if getattr(route, "path", "") == "/api/sites/{site_id}/images/representative"
            and "POST" in getattr(route, "methods", set())
        )
        lesion_box_route = next(
            route
            for route in app.routes
            if getattr(route, "path", "") == "/api/sites/{site_id}/images/{image_id}/lesion-box"
            and "PATCH" in getattr(route, "methods", set())
        )

        self.assertEqual([param.name for param in representative_route.dependant.body_params], ["payload"])
        self.assertEqual(representative_route.dependant.query_params, [])
        self.assertEqual([param.name for param in lesion_box_route.dependant.body_params], ["payload"])
        self.assertEqual(lesion_box_route.dependant.query_params, [])


if __name__ == "__main__":
    unittest.main()
