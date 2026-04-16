from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Any

import pandas as pd
from sqlalchemy import and_, case, column, delete, desc, func, literal_column, or_, select, table, update

from kera_research.config import (
    PATIENT_REFERENCE_SALT,
    ensure_base_directories,
    remap_bundle_paths_in_value,
)
from kera_research.db import (
    DATA_PLANE_DATABASE_URL,
    DATA_PLANE_ENGINE,
    data_plane_sqlite_search_ready,
    images as db_images,
    init_control_plane_db,
    init_data_plane_db,
    patients as db_patients,
    site_jobs,
    site_patient_splits,
    visits as db_visits,
)
from kera_research.domain import (
    MANIFEST_COLUMNS,
    VISIT_STATUS_OPTIONS,
    make_id,
    make_patient_reference_id,
    normalize_actual_visit_date,
    normalize_patient_pseudonym,
    normalize_visit_label,
    utc_now,
    visit_index_from_label,
)
from kera_research.services.data_plane_case_history import (
    case_history_path as _case_history_path_impl,
    load_case_history as _load_case_history_impl,
    record_case_contribution_history as _record_case_contribution_history_impl,
    record_case_validation_history as _record_case_validation_history_impl,
    resolve_visit_reference as _resolve_visit_reference_impl,
)
from kera_research.services.data_plane_helpers import (
    InvalidImageUploadError,
    case_summary_search_haystack as _case_summary_search_haystack,
    case_summary_sort_key as _case_summary_sort_key,
    filesystem_timestamp_to_utc as _filesystem_timestamp_to_utc,
    infer_raw_image_view as _infer_raw_image_view,
    sanitize_image_bytes as _sanitize_image_bytes,
    sqlite_patient_case_match_query as _sqlite_patient_case_match_query,
)
from kera_research.services.data_plane_images import (
    add_image as _add_image_impl,
    backfill_image_derivatives as _backfill_image_derivatives_impl,
    delete_images_for_visit as _delete_images_for_visit_impl,
    get_image as _get_image_impl,
    get_images as _get_images_impl,
    list_images as _list_images_impl,
    list_images_for_patient as _list_images_for_patient_impl,
    list_images_for_visit as _list_images_for_visit_impl,
    update_image_artifact_cache as _update_image_artifact_cache_impl,
    update_image_quality_scores as _update_image_quality_scores_impl,
    update_lesion_prompt_box as _update_lesion_prompt_box_impl,
    update_representative_flags as _update_representative_flags_impl,
)
from kera_research.services.data_plane_jobs import (
    artifact_files as _artifact_files_impl,
    claim_next_job as _claim_next_job_impl,
    delete_jobs as _delete_jobs_impl,
    enqueue_job as _enqueue_job_impl,
    get_job as _get_job_impl,
    heartbeat_job as _heartbeat_job_impl,
    job_row_to_dict as _job_row_to_dict_impl,
    list_jobs as _list_jobs_impl,
    request_job_cancel as _request_job_cancel_impl,
    requeue_stale_jobs as _requeue_stale_jobs_impl,
    update_job_status as _update_job_status_impl,
)
from kera_research.services.data_plane_normalizers import (
    _coerce_optional_bool as _coerce_optional_bool_impl,
    _coerce_optional_int as _coerce_optional_int_impl,
    _coerce_optional_text as _coerce_optional_text_impl,
    _derive_culture_status as _derive_culture_status_impl,
    _hydrate_visit_culture_fields as _hydrate_visit_culture_fields_impl,
    _list_organisms as _list_organisms_impl,
    _normalize_additional_organisms as _normalize_additional_organisms_impl,
    _normalize_culture_status as _normalize_culture_status_impl,
    _normalize_organism_entry as _normalize_organism_entry_impl,
    _normalize_visit_culture_fields as _normalize_visit_culture_fields_impl,
    _organism_summary_label as _organism_summary_label_impl,
    _parse_manifest_box as _parse_manifest_box_impl,
    _parse_manifest_pipe_list as _parse_manifest_pipe_list_impl,
)
from kera_research.services.data_plane_previews import (
    delete_image_preview_cache as _delete_image_preview_cache_impl,
    ensure_image_preview as _ensure_image_preview_impl,
    image_preview_cache_path as _image_preview_cache_path_impl,
)
from kera_research.services.data_plane_recovery import (
    clear_site_metadata_rows as _clear_site_metadata_rows_impl,
    current_data_plane_db_path as _current_data_plane_db_path_impl,
    export_metadata_backup as _export_metadata_backup_impl,
    find_matching_richer_metadata_snapshot as _find_matching_richer_metadata_snapshot_impl,
    generate_manifest as _generate_manifest_impl,
    load_manifest as _load_manifest_impl,
    load_patient_metadata_snapshot_from_db as _load_patient_metadata_snapshot_from_db_impl,
    local_metadata_backup_db_paths as _local_metadata_backup_db_paths_impl,
    metadata_backup_path as _metadata_backup_path_impl,
    normalize_snapshot_image_paths as _normalize_snapshot_image_paths_impl,
    patient_id_from_recovery_image_path as _patient_id_from_recovery_image_path_impl,
    patient_snapshot_is_richer_than_placeholder as _patient_snapshot_is_richer_than_placeholder_impl,
    recover_metadata as _recover_metadata_impl,
    recover_metadata_from_backup_payload as _recover_metadata_from_backup_payload_impl,
    recover_metadata_from_manifest as _recover_metadata_from_manifest_impl,
    resolve_recovery_image_path as _resolve_recovery_image_path_impl,
    restore_placeholder_metadata_from_local_backups as _restore_placeholder_metadata_from_local_backups_impl,
    restore_placeholder_metadata_from_snapshot as _restore_placeholder_metadata_from_snapshot_impl,
    raw_inventory_stats as _raw_inventory_stats_impl,
    storage_bundle_root as _storage_bundle_root_impl,
    standardize_visit_storage_layout as _standardize_visit_storage_layout_impl,
    sync_raw_inventory_metadata as _sync_raw_inventory_metadata_impl,
    sync_raw_inventory_metadata_if_due as _sync_raw_inventory_metadata_if_due_impl,
)
from kera_research.services.data_plane_research_registry import (
    case_research_policy_state as _case_research_policy_state_impl,
    update_visit_registry_status as _update_visit_registry_status_impl,
)
from kera_research.services.data_plane_summary import (
    raw_inventory_index as _raw_inventory_index_impl,
    site_summary_stats as _site_summary_stats_impl,
)
from kera_research.services.data_plane_storage_roots import (
    control_plane_split_enabled,
    invalidate_site_storage_root_cache,
    resolve_site_storage_root as _resolve_site_storage_root,
    safe_path_component as _safe_path_component,
    site_storage_uses_control_plane as _site_storage_uses_control_plane,
)
from kera_research.services.data_plane_patients import (
    create_patient as _create_patient_impl,
    create_visit as _create_visit_impl,
    get_patient as _get_patient_impl,
    get_visit as _get_visit_impl,
    get_visit_by_id as _get_visit_by_id_impl,
    get_visit_row as _get_visit_row_impl,
    is_visit_fl_retained as _is_visit_fl_retained_impl,
    list_patients as _list_patients_impl,
    list_visible_workspace_patients as _list_visible_workspace_patients_impl,
    list_retained_case_archive as _list_retained_case_archive_impl,
    list_visits as _list_visits_impl,
    list_visits_for_patient as _list_visits_for_patient_impl,
    lookup_patient_id as _lookup_patient_id_impl,
    mark_visit_fl_retained as _mark_visit_fl_retained_impl,
    update_patient as _update_patient_impl,
    update_visit as _update_visit_impl,
)
from kera_research.services.data_plane_path_integrity import (
    SiteStorePathIntegrityMixin,
    _SITE_LEGACY_VISIT_LABEL_REPAIRED,
)
from kera_research.services.data_plane_patient_splits import (
    clear_patient_split as _clear_patient_split_impl,
    load_patient_split as _load_patient_split_impl,
    save_patient_split as _save_patient_split_impl,
)
from kera_research.services.data_plane_queries import (
    list_case_summaries as _list_case_summaries_impl,
    list_patient_case_rows as _list_patient_case_rows_impl,
)
from kera_research.services.quality import score_slit_lamp_image
from kera_research.storage import ensure_dir, read_json, write_csv, write_json

_RAW_INVENTORY_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"}
_PREWARMED_IMAGE_PREVIEW_SIDES = (256, 640)
_SITE_RAW_METADATA_SYNC_LAST_RUN: dict[str, float] = {}
_SITE_RAW_METADATA_SYNC_LOCK = threading.Lock()
_SITE_RAW_METADATA_SYNC_INTERVAL_SECONDS = 15.0
_PLACEHOLDER_SYNC_SOURCE = "raw_inventory_sync"
_CULTURE_STATUS_OPTIONS = {"positive", "negative", "not_done", "unknown"}


def _normalize_organism_entry(entry: dict[str, Any] | None) -> dict[str, str] | None:
    return _normalize_organism_entry_impl(entry)


def _normalize_additional_organisms(
    primary_category: str,
    primary_species: str,
    additional_organisms: list[dict[str, Any]] | None,
) -> list[dict[str, str]]:
    return _normalize_additional_organisms_impl(
        primary_category,
        primary_species,
        additional_organisms,
    )


def _normalize_culture_status(value: Any, default: str = "unknown") -> str:
    return _normalize_culture_status_impl(
        value,
        _CULTURE_STATUS_OPTIONS,
        default=default,
    )


def _derive_culture_status(
    culture_status: Any,
    culture_confirmed: Any,
    culture_category: Any,
    culture_species: Any,
) -> str:
    return _derive_culture_status_impl(
        culture_status,
        culture_confirmed,
        culture_category,
        culture_species,
        _CULTURE_STATUS_OPTIONS,
    )


def _normalize_visit_culture_fields(
    *,
    culture_status: Any,
    culture_confirmed: Any,
    culture_category: Any,
    culture_species: Any,
    additional_organisms: list[dict[str, Any]] | None,
    polymicrobial: Any,
) -> dict[str, Any]:
    return _normalize_visit_culture_fields_impl(
        culture_status=culture_status,
        culture_confirmed=culture_confirmed,
        culture_category=culture_category,
        culture_species=culture_species,
        additional_organisms=additional_organisms,
        polymicrobial=polymicrobial,
        culture_status_options=_CULTURE_STATUS_OPTIONS,
    )


def _hydrate_visit_culture_fields(record: dict[str, Any]) -> dict[str, Any]:
    return _hydrate_visit_culture_fields_impl(record, _CULTURE_STATUS_OPTIONS)


def _visit_visible_clause(visit_table: Any) -> Any:
    return visit_table.c.soft_deleted_at.is_(None)


def _image_visible_clause(image_table: Any) -> Any:
    return image_table.c.soft_deleted_at.is_(None)


def _list_organisms(
    culture_category: str,
    culture_species: str,
    additional_organisms: list[dict[str, Any]] | None,
) -> list[dict[str, str]]:
    return _list_organisms_impl(culture_category, culture_species, additional_organisms)


def _organism_summary_label(
    culture_category: str,
    culture_species: str,
    additional_organisms: list[dict[str, Any]] | None,
    *,
    max_visible_species: int = 2,
) -> str:
    return _organism_summary_label_impl(
        culture_category,
        culture_species,
        additional_organisms,
        max_visible_species=max_visible_species,
    )


def _coerce_optional_text(value: Any, default: str = "") -> str:
    return _coerce_optional_text_impl(value, default)


def _coerce_optional_int(value: Any, default: int = 0) -> int:
    return _coerce_optional_int_impl(value, default)


def _coerce_optional_bool(value: Any, default: bool = False) -> bool:
    return _coerce_optional_bool_impl(value, default)


def _parse_manifest_pipe_list(value: Any) -> list[str]:
    return _parse_manifest_pipe_list_impl(value)


def _parse_manifest_box(value: Any) -> dict[str, float] | None:
    return _parse_manifest_box_impl(value)


class SiteStore(SiteStorePathIntegrityMixin):
    def __init__(self, site_id: str) -> None:
        ensure_base_directories()
        init_data_plane_db()
        if _site_storage_uses_control_plane():
            init_control_plane_db()
        self.site_id = site_id
        self.site_dir = _resolve_site_storage_root(site_id)
        self.raw_dir = self.site_dir / "data" / "raw"
        self.manifest_dir = self.site_dir / "manifests"
        self.manifest_path = self.manifest_dir / "dataset_manifest.csv"
        self.artifact_dir = self.site_dir / "artifacts"
        self.gradcam_dir = self.artifact_dir / "gradcam"
        self.medsam_mask_dir = self.artifact_dir / "medsam_masks"
        self.roi_crop_dir = self.artifact_dir / "roi_crops"
        self.lesion_mask_dir = self.artifact_dir / "lesion_masks"
        self.lesion_crop_dir = self.artifact_dir / "lesion_crops"
        self.embedding_dir = self.artifact_dir / "embeddings"
        self.image_preview_dir = self.artifact_dir / "image_previews"
        self.validation_dir = self.site_dir / "validation"
        self.update_dir = self.site_dir / "model_updates"
        self.case_history_dir = self.site_dir / "case_history"
        self._seed_defaults()
        self._repair_legacy_visit_labels_once()

    def _case_history_path(self, patient_id: str, visit_date: str) -> Path:
        return _case_history_path_impl(self, patient_id, visit_date)

    def _get_visit_by_id(self, visit_id: str) -> dict[str, Any] | None:
        return _get_visit_by_id_impl(self, visit_id)

    def _resolve_visit_reference(self, patient_id: str, visit_date: str) -> tuple[str, str]:
        return _resolve_visit_reference_impl(self, patient_id, visit_date)

    def load_case_history(self, patient_id: str, visit_date: str) -> dict[str, list[dict[str, Any]]]:
        return _load_case_history_impl(self, patient_id, visit_date)

    def record_case_validation_history(self, patient_id: str, visit_date: str, entry: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
        return _record_case_validation_history_impl(self, patient_id, visit_date, entry)

    def record_case_contribution_history(self, patient_id: str, visit_date: str, entry: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
        return _record_case_contribution_history_impl(self, patient_id, visit_date, entry)

    def list_patients(self, created_by_user_id: str | None = None) -> list[dict[str, Any]]:
        return _list_patients_impl(self, created_by_user_id=created_by_user_id)

    def list_visible_workspace_patients(
        self,
        created_by_user_id: str | None = None,
    ) -> list[dict[str, Any]]:
        return _list_visible_workspace_patients_impl(
            self,
            created_by_user_id=created_by_user_id,
        )

    def get_patient(self, patient_id: str) -> dict[str, Any] | None:
        return _get_patient_impl(self, patient_id)

    def lookup_patient_id(self, patient_id: str) -> dict[str, Any]:
        return _lookup_patient_id_impl(self, patient_id)

    def create_patient(
        self,
        patient_id: str,
        sex: str,
        age: int,
        chart_alias: str = "",
        local_case_code: str = "",
        created_by_user_id: str | None = None,
    ) -> dict[str, Any]:
        return _create_patient_impl(
            self,
            patient_id,
            sex,
            age,
            chart_alias=chart_alias,
            local_case_code=local_case_code,
            created_by_user_id=created_by_user_id,
        )

    def update_patient(
        self,
        patient_id: str,
        sex: str,
        age: int,
        chart_alias: str = "",
        local_case_code: str = "",
    ) -> dict[str, Any]:
        return _update_patient_impl(
            self,
            patient_id,
            sex,
            age,
            chart_alias=chart_alias,
            local_case_code=local_case_code,
        )

    def _get_visit_row(
        self,
        patient_id: str,
        visit_date: str,
        *,
        include_soft_deleted: bool = False,
    ) -> dict[str, Any] | None:
        return _get_visit_row_impl(
            self,
            patient_id,
            visit_date,
            include_soft_deleted=include_soft_deleted,
        )

    def _is_visit_fl_retained(self, visit: dict[str, Any] | None) -> bool:
        return _is_visit_fl_retained_impl(visit)

    def mark_visit_fl_retained(
        self,
        patient_id: str,
        visit_date: str,
        *,
        scope: str,
        update_id: str | None = None,
    ) -> dict[str, Any]:
        return _mark_visit_fl_retained_impl(
            self,
            patient_id,
            visit_date,
            scope=scope,
            update_id=update_id,
        )

    def list_retained_case_archive(self) -> list[dict[str, Any]]:
        return _list_retained_case_archive_impl(self)

    def list_visits(self) -> list[dict[str, Any]]:
        return _list_visits_impl(self)

    def get_visit(self, patient_id: str, visit_date: str) -> dict[str, Any] | None:
        return _get_visit_impl(self, patient_id, visit_date)

    def create_visit(
        self,
        patient_id: str,
        visit_date: str,
        actual_visit_date: str | None,
        culture_confirmed: bool | None,
        culture_category: str | None,
        culture_species: str | None,
        additional_organisms: list[dict[str, Any]] | None,
        contact_lens_use: str,
        predisposing_factor: list[str],
        other_history: str,
        active_stage: bool = True,
        visit_status: str = "active",
        is_initial_visit: bool = False,
        smear_result: str = "",
        polymicrobial: bool = False,
        created_by_user_id: str | None = None,
        culture_status: str | None = None,
    ) -> dict[str, Any]:
        return _create_visit_impl(
            self,
            patient_id,
            visit_date,
            actual_visit_date,
            culture_confirmed,
            culture_category,
            culture_species,
            additional_organisms,
            contact_lens_use,
            predisposing_factor,
            other_history,
            active_stage=active_stage,
            visit_status=visit_status,
            is_initial_visit=is_initial_visit,
            smear_result=smear_result,
            polymicrobial=polymicrobial,
            created_by_user_id=created_by_user_id,
            culture_status=culture_status,
        )

    def update_visit(
        self,
        patient_id: str,
        visit_date: str,
        target_patient_id: str | None,
        target_visit_date: str | None,
        actual_visit_date: str | None,
        culture_confirmed: bool | None,
        culture_category: str | None,
        culture_species: str | None,
        additional_organisms: list[dict[str, Any]] | None,
        contact_lens_use: str,
        predisposing_factor: list[str],
        other_history: str,
        active_stage: bool = True,
        visit_status: str = "active",
        is_initial_visit: bool = False,
        smear_result: str = "",
        polymicrobial: bool = False,
        culture_status: str | None = None,
    ) -> dict[str, Any]:
        return _update_visit_impl(
            self,
            patient_id,
            visit_date,
            target_patient_id,
            target_visit_date,
            actual_visit_date,
            culture_confirmed,
            culture_category,
            culture_species,
            additional_organisms,
            contact_lens_use,
            predisposing_factor,
            other_history,
            active_stage=active_stage,
            visit_status=visit_status,
            is_initial_visit=is_initial_visit,
            smear_result=smear_result,
            polymicrobial=polymicrobial,
            culture_status=culture_status,
        )

    def list_images(self) -> list[dict[str, Any]]:
        return _list_images_impl(self)

    def get_image(self, image_id: str) -> dict[str, Any] | None:
        return _get_image_impl(self, image_id)

    def get_images(self, image_ids: list[str]) -> list[dict[str, Any]]:
        return _get_images_impl(self, image_ids)

    def add_image(
        self,
        patient_id: str,
        visit_date: str,
        view: str,
        is_representative: bool,
        file_name: str,
        content: bytes,
        created_by_user_id: str | None = None,
    ) -> dict[str, Any]:
        return _add_image_impl(
            self,
            patient_id,
            visit_date,
            view,
            is_representative,
            file_name,
            content,
            created_by_user_id=created_by_user_id,
        )

    def delete_images_for_visit(self, patient_id: str, visit_date: str) -> int:
        return _delete_images_for_visit_impl(self, patient_id, visit_date)

    def delete_visit(self, patient_id: str, visit_date: str) -> dict[str, Any]:
        existing_visit = self._get_visit_row(patient_id, visit_date, include_soft_deleted=False)
        if existing_visit is None:
            raise ValueError(f"Visit {patient_id} / {visit_date} does not exist.")

        existing_patient_id = _coerce_optional_text(existing_visit.get("patient_id")) or normalize_patient_pseudonym(patient_id)
        existing_visit_date = _coerce_optional_text(existing_visit.get("visit_date")) or _coerce_optional_text(visit_date)
        deleted_images = self.delete_images_for_visit(existing_patient_id, existing_visit_date)
        if self._is_visit_fl_retained(existing_visit):
            with DATA_PLANE_ENGINE.begin() as conn:
                conn.execute(
                    update(db_visits)
                    .where(
                        and_(
                            db_visits.c.site_id == self.site_id,
                            db_visits.c.visit_id == existing_visit["visit_id"],
                            _visit_visible_clause(db_visits),
                        )
                    )
                    .values(
                        soft_deleted_at=utc_now(),
                        soft_delete_reason="federated_retention_soft_delete",
                    )
                )
            remaining_visits = self.list_visits_for_patient(existing_patient_id)
            return {
                "patient_id": existing_patient_id,
                "visit_date": existing_visit_date,
                "deleted_images": deleted_images,
                "deleted_patient": False,
                "remaining_visit_count": len(remaining_visits),
            }
        history_path = self._case_history_path(existing_patient_id, existing_visit_date)
        history_path.unlink(missing_ok=True)
        with DATA_PLANE_ENGINE.begin() as conn:
            conn.execute(
                delete(db_visits).where(
                    and_(
                        db_visits.c.site_id == self.site_id,
                        db_visits.c.visit_id == existing_visit["visit_id"],
                    )
                )
            )

        remaining_visits = self.list_visits_for_patient(existing_patient_id)
        deleted_patient = self._delete_patient_if_empty(existing_patient_id)

        return {
            "patient_id": existing_patient_id,
            "visit_date": existing_visit_date,
            "deleted_images": deleted_images,
            "deleted_patient": deleted_patient,
            "remaining_visit_count": len(remaining_visits),
        }

    def restore_retained_case(
        self,
        patient_id: str,
        visit_date: str,
        *,
        restore_images_only: bool = False,
    ) -> dict[str, Any]:
        existing_visit = self._get_visit_row(patient_id, visit_date, include_soft_deleted=True)
        if existing_visit is None:
            raise ValueError(f"Visit {patient_id} / {visit_date} does not exist.")
        if not self._is_visit_fl_retained(existing_visit):
            raise ValueError("Only federated-retained visits can be restored.")
        visit_id = _coerce_optional_text(existing_visit.get("visit_id"))
        if not visit_id:
            raise ValueError(f"Visit {patient_id} / {visit_date} does not exist.")
        visit_soft_deleted = bool(_coerce_optional_text(existing_visit.get("soft_deleted_at")))
        if restore_images_only and visit_soft_deleted:
            raise ValueError("Restore the retained visit before restoring its images.")

        restored_visit = 0
        restored_images = 0
        remaining_soft_deleted_image_count = 0
        with DATA_PLANE_ENGINE.begin() as conn:
            if visit_soft_deleted and not restore_images_only:
                visit_result = conn.execute(
                    update(db_visits)
                    .where(
                        and_(
                            db_visits.c.site_id == self.site_id,
                            db_visits.c.visit_id == visit_id,
                            db_visits.c.soft_deleted_at.is_not(None),
                        )
                    )
                    .values(
                        soft_deleted_at=None,
                        soft_delete_reason=None,
                    )
                )
                restored_visit = int(visit_result.rowcount or 0)
            image_result = conn.execute(
                update(db_images)
                .where(
                    and_(
                        db_images.c.site_id == self.site_id,
                        db_images.c.visit_id == visit_id,
                        db_images.c.soft_deleted_at.is_not(None),
                    )
                )
                .values(
                    soft_deleted_at=None,
                    soft_delete_reason=None,
                )
            )
            restored_images = int(image_result.rowcount or 0)
            remaining_soft_deleted_image_count = int(
                conn.execute(
                    select(func.count())
                    .select_from(db_images)
                    .where(
                        and_(
                            db_images.c.site_id == self.site_id,
                            db_images.c.visit_id == visit_id,
                            db_images.c.soft_deleted_at.is_not(None),
                        )
                    )
                ).scalar()
                or 0
            )

        refreshed_visit = self._get_visit_row(patient_id, visit_date, include_soft_deleted=True)
        if refreshed_visit is None:
            raise ValueError(f"Visit {patient_id} / {visit_date} does not exist.")
        visible_images = self.list_images_for_visit(
            _coerce_optional_text(refreshed_visit.get("patient_id")) or patient_id,
            _coerce_optional_text(refreshed_visit.get("visit_date")) or visit_date,
        )
        return {
            "patient_id": _coerce_optional_text(refreshed_visit.get("patient_id")) or patient_id,
            "visit_date": _coerce_optional_text(refreshed_visit.get("visit_date")) or visit_date,
            "visit_id": visit_id,
            "restored_visit": restored_visit,
            "restored_images": restored_images,
            "visible_image_count": len(visible_images),
            "visit_soft_deleted_at": _coerce_optional_text(refreshed_visit.get("soft_deleted_at")),
            "remaining_soft_deleted_image_count": remaining_soft_deleted_image_count,
        }

    def _delete_patient_if_empty(self, patient_id: str) -> bool:
        remaining_visit_count_query = (
            select(func.count())
            .select_from(db_visits)
            .where(and_(db_visits.c.site_id == self.site_id, db_visits.c.patient_id == patient_id))
        )
        with DATA_PLANE_ENGINE.begin() as conn:
            remaining_visit_count = int(conn.execute(remaining_visit_count_query).scalar() or 0)
        if remaining_visit_count > 0:
            return False
        with DATA_PLANE_ENGINE.begin() as conn:
            conn.execute(
                delete(db_patients).where(
                    and_(
                        db_patients.c.site_id == self.site_id,
                        db_patients.c.patient_id == patient_id,
                    )
                )
            )
        patient_history_dir = self.case_history_dir / _safe_path_component(patient_id)
        if patient_history_dir.exists() and not any(patient_history_dir.iterdir()):
            patient_history_dir.rmdir()
        return True

    def update_representative_flags(self, updates: dict[str, bool]) -> None:
        _update_representative_flags_impl(self, updates)

    def update_lesion_prompt_box(self, image_id: str, lesion_prompt_box: dict[str, Any] | None) -> dict[str, Any]:
        return _update_lesion_prompt_box_impl(self, image_id, lesion_prompt_box)

    def update_image_artifact_cache(
        self,
        image_id: str,
        *,
        has_lesion_box: bool | None = None,
        has_roi_crop: bool | None = None,
        has_medsam_mask: bool | None = None,
        has_lesion_crop: bool | None = None,
        has_lesion_mask: bool | None = None,
    ) -> dict[str, Any]:
        return _update_image_artifact_cache_impl(
            self,
            image_id,
            has_lesion_box=has_lesion_box,
            has_roi_crop=has_roi_crop,
            has_medsam_mask=has_medsam_mask,
            has_lesion_crop=has_lesion_crop,
            has_lesion_mask=has_lesion_mask,
        )

    def update_image_quality_scores(self, image_id: str, quality_scores: dict[str, Any] | None) -> dict[str, Any]:
        return _update_image_quality_scores_impl(self, image_id, quality_scores)

    def backfill_image_derivatives(
        self,
        image_ids: list[str] | None = None,
        *,
        preview_sides: tuple[int, ...] = _PREWARMED_IMAGE_PREVIEW_SIDES,
    ) -> dict[str, int]:
        return _backfill_image_derivatives_impl(
            self,
            image_ids,
            preview_sides=preview_sides,
        )

    def dataset_records(self, *, positive_only: bool = True) -> list[dict[str, Any]]:
        patient_table = db_patients.alias("p")
        visit_table = db_visits.alias("v")
        image_table = db_images.alias("i")
        query = (
            select(
                image_table.c.image_id,
                patient_table.c.patient_id,
                patient_table.c.chart_alias,
                patient_table.c.local_case_code,
                patient_table.c.sex,
                patient_table.c.age,
                visit_table.c.visit_date,
                visit_table.c.culture_status,
                visit_table.c.culture_confirmed,
                visit_table.c.culture_category,
                visit_table.c.culture_species,
                visit_table.c.additional_organisms,
                visit_table.c.contact_lens_use,
                visit_table.c.predisposing_factor,
                visit_table.c.visit_status,
                visit_table.c.active_stage,
                visit_table.c.other_history,
                visit_table.c.smear_result,
                visit_table.c.polymicrobial,
                image_table.c.view,
                image_table.c.image_path,
                image_table.c.is_representative,
                image_table.c.lesion_prompt_box,
            )
            .select_from(
                patient_table.join(
                    visit_table,
                    and_(
                        patient_table.c.site_id == visit_table.c.site_id,
                        patient_table.c.patient_id == visit_table.c.patient_id,
                    ),
                ).join(
                    image_table,
                    and_(
                        visit_table.c.site_id == image_table.c.site_id,
                        visit_table.c.visit_id == image_table.c.visit_id,
                    ),
                )
            )
            .where(
                and_(
                    patient_table.c.site_id == self.site_id,
                    visit_table.c.soft_deleted_at.is_(None),
                    image_table.c.soft_deleted_at.is_(None),
                )
            )
            .order_by(patient_table.c.patient_id, visit_table.c.visit_index, visit_table.c.visit_date, image_table.c.uploaded_at)
        )
        with DATA_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(query).mappings().all()
        records: list[dict[str, Any]] = []
        for row in rows:
            normalized_culture_status = _derive_culture_status(
                row.get("culture_status"),
                row.get("culture_confirmed"),
                row.get("culture_category"),
                row.get("culture_species"),
            )
            if positive_only and normalized_culture_status != "positive":
                continue
            resolved_image_record = self._resolve_image_record_path(
                {
                    "image_id": row["image_id"],
                    "patient_id": row["patient_id"],
                    "visit_date": row["visit_date"],
                    "image_path": row["image_path"],
                }
            )
            resolved_image_path = Path(str(resolved_image_record["image_path"]))
            records.append(
                {
                    "site_id": self.site_id,
                    "patient_id": row["patient_id"],
                    "chart_alias": row["chart_alias"],
                    "local_case_code": row["local_case_code"],
                    "sex": row["sex"],
                    "age": row["age"],
                    "visit_date": row["visit_date"],
                    "culture_status": normalized_culture_status,
                    "culture_confirmed": bool(row["culture_confirmed"]) or normalized_culture_status == "positive",
                    "culture_category": row["culture_category"],
                    "culture_species": row["culture_species"],
                    "additional_organisms": row["additional_organisms"] or [],
                    "contact_lens_use": row["contact_lens_use"],
                    "predisposing_factor": "|".join(row["predisposing_factor"] or []),
                    "visit_status": row["visit_status"],
                    "active_stage": row["active_stage"],
                    "other_history": row["other_history"] or "",
                    "smear_result": row["smear_result"] or "",
                    "polymicrobial": row["polymicrobial"],
                    "view": row["view"],
                    "image_path": str(resolved_image_path),
                    "is_representative": row["is_representative"],
                    "lesion_prompt_box": row["lesion_prompt_box"],
                }
            )
        return records

    def list_visits_for_patient(self, patient_id: str) -> list[dict[str, Any]]:
        return _list_visits_for_patient_impl(self, patient_id)

    def list_images_for_visit(self, patient_id: str, visit_date: str) -> list[dict[str, Any]]:
        return _list_images_for_visit_impl(self, patient_id, visit_date)

    def case_records_for_visit(
        self,
        patient_id: str,
        visit_date: str,
    ) -> list[dict[str, Any]]:
        self._sync_raw_inventory_metadata_if_due()
        visit = self.get_visit(patient_id, visit_date)
        if visit is None:
            return []
        patient = self.get_patient(str(visit.get("patient_id") or patient_id))
        if patient is None:
            return []
        images = self.list_images_for_visit(
            str(visit.get("patient_id") or patient_id),
            str(visit.get("visit_date") or visit_date),
        )
        records: list[dict[str, Any]] = []
        for image in images:
            resolved_image_record = self._resolve_image_record_path(image)
            resolved_image_path = Path(str(resolved_image_record.get("image_path") or ""))
            records.append(
                {
                    "site_id": self.site_id,
                    "patient_id": str(visit.get("patient_id") or patient_id),
                    "chart_alias": patient.get("chart_alias"),
                    "local_case_code": patient.get("local_case_code"),
                    "sex": patient.get("sex"),
                    "age": patient.get("age"),
                    "visit_date": str(visit.get("visit_date") or visit_date),
                    "culture_status": visit.get("culture_status", "unknown"),
                    "culture_confirmed": bool(visit.get("culture_confirmed")),
                    "culture_category": visit.get("culture_category", ""),
                    "culture_species": visit.get("culture_species", ""),
                    "additional_organisms": visit.get("additional_organisms") or [],
                    "contact_lens_use": visit.get("contact_lens_use", ""),
                    "predisposing_factor": "|".join(visit.get("predisposing_factor") or []),
                    "visit_status": visit.get("visit_status", ""),
                    "active_stage": visit.get("active_stage"),
                    "other_history": visit.get("other_history") or "",
                    "smear_result": visit.get("smear_result") or "",
                    "polymicrobial": bool(visit.get("polymicrobial")),
                    "view": resolved_image_record.get("view"),
                    "image_path": str(resolved_image_path),
                    "is_representative": resolved_image_record.get("is_representative"),
                    "lesion_prompt_box": resolved_image_record.get("lesion_prompt_box"),
                }
            )
        return records

    def case_research_policy_state(self, patient_id: str, visit_date: str) -> dict[str, Any]:
        return _case_research_policy_state_impl(self, patient_id, visit_date)

    def list_images_for_patient(self, patient_id: str) -> list[dict[str, Any]]:
        return _list_images_for_patient_impl(self, patient_id)

    def _raw_inventory_index(self) -> dict[str, Any]:
        return _raw_inventory_index_impl(
            self,
            raw_inventory_image_extensions=_RAW_INVENTORY_IMAGE_EXTENSIONS,
        )

    def _storage_bundle_root(self) -> Path:
        return _storage_bundle_root_impl(self)

    def _current_data_plane_db_path(self) -> Path | None:
        return _current_data_plane_db_path_impl(self)

    def _local_metadata_backup_db_paths(self) -> list[Path]:
        return _local_metadata_backup_db_paths_impl(self)

    def _load_patient_metadata_snapshot_from_db(
        self,
        db_path: Path,
        patient_id: str,
    ) -> dict[str, Any] | None:
        return _load_patient_metadata_snapshot_from_db_impl(self, db_path, patient_id)

    def _patient_snapshot_is_richer_than_placeholder(self, snapshot: dict[str, Any] | None) -> bool:
        return _patient_snapshot_is_richer_than_placeholder_impl(self, snapshot)

    def _normalize_snapshot_image_paths(self, rows: list[dict[str, Any]]) -> set[str]:
        return _normalize_snapshot_image_paths_impl(self, rows)

    def _find_matching_richer_metadata_snapshot(
        self,
        patient_id: str,
        expected_image_paths: set[str],
    ) -> dict[str, Any] | None:
        return _find_matching_richer_metadata_snapshot_impl(self, patient_id, expected_image_paths)

    def _restore_placeholder_metadata_from_snapshot(self, snapshot: dict[str, Any]) -> dict[str, int]:
        return _restore_placeholder_metadata_from_snapshot_impl(self, snapshot)

    def _restore_placeholder_metadata_from_local_backups(self) -> dict[str, int]:
        return _restore_placeholder_metadata_from_local_backups_impl(self)

    def sync_raw_inventory_metadata(self) -> dict[str, Any]:
        return _sync_raw_inventory_metadata_impl(self)

    def _sync_raw_inventory_metadata_if_due(self, *, force: bool = False) -> dict[str, Any]:
        return _sync_raw_inventory_metadata_if_due_impl(self, force=force)

    def raw_inventory_stats(self) -> dict[str, int]:
        return _raw_inventory_stats_impl(self)

    def site_summary_stats(self) -> dict[str, int]:
        return _site_summary_stats_impl(
            self,
            placeholder_sync_source=_PLACEHOLDER_SYNC_SOURCE,
            raw_inventory_image_extensions=_RAW_INVENTORY_IMAGE_EXTENSIONS,
        )

    def image_preview_cache_path(self, image_id: str, max_side: int) -> Path:
        return _image_preview_cache_path_impl(self, image_id, max_side)

    def delete_image_preview_cache(self, image_id: str) -> int:
        return _delete_image_preview_cache_impl(self, image_id)

    def ensure_image_preview(self, image: dict[str, Any], max_side: int) -> Path:
        return _ensure_image_preview_impl(self, image, max_side)

    def list_case_summaries(
        self,
        created_by_user_id: str | None = None,
        patient_id: str | None = None,
    ) -> list[dict[str, Any]]:
        return _list_case_summaries_impl(
            self,
            created_by_user_id=created_by_user_id,
            patient_id=patient_id,
        )

    def list_patient_case_rows(
        self,
        *,
        created_by_user_id: str | None = None,
        search: str | None = None,
        page: int = 1,
        page_size: int = 25,
    ) -> dict[str, Any]:
        return _list_patient_case_rows_impl(
            self,
            created_by_user_id=created_by_user_id,
            search=search,
            page=page,
            page_size=page_size,
        )

    def update_visit_registry_status(
        self,
        patient_id: str,
        visit_date: str,
        *,
        status_value: str,
        updated_by_user_id: str | None,
        source: str,
    ) -> dict[str, Any]:
        return _update_visit_registry_status_impl(
            self,
            patient_id,
            visit_date,
            status_value=status_value,
            updated_by_user_id=updated_by_user_id,
            source=source,
        )

    def metadata_backup_path(self) -> Path:
        return _metadata_backup_path_impl(self)

    def export_metadata_backup(self, path: Path | None = None) -> Path:
        return _export_metadata_backup_impl(self, path)

    def _clear_site_metadata_rows(self) -> None:
        _clear_site_metadata_rows_impl(self)

    def _resolve_recovery_image_path(
        self,
        image_path: Any,
        patient_id: str,
        image_name: str,
        *,
        visit_date: str | None = None,
    ) -> Path:
        return _resolve_recovery_image_path_impl(
            self,
            image_path,
            patient_id,
            image_name,
            visit_date=visit_date,
        )

    def standardize_visit_storage_layout(self, *, refresh_manifest: bool = True) -> dict[str, int]:
        return _standardize_visit_storage_layout_impl(self, refresh_manifest=refresh_manifest)

    def _patient_id_from_recovery_image_path(self, image_path: Path) -> str | None:
        return _patient_id_from_recovery_image_path_impl(self, image_path)

    def _recover_metadata_from_backup_payload(self, payload: dict[str, Any], *, force_replace: bool) -> dict[str, Any]:
        return _recover_metadata_from_backup_payload_impl(self, payload, force_replace=force_replace)

    def _recover_metadata_from_manifest(self, *, force_replace: bool) -> dict[str, Any]:
        return _recover_metadata_from_manifest_impl(self, force_replace=force_replace)

    def recover_metadata(
        self,
        *,
        prefer_backup: bool = True,
        force_replace: bool = False,
        backup_path: str | None = None,
    ) -> dict[str, Any]:
        return _recover_metadata_impl(
            self,
            prefer_backup=prefer_backup,
            force_replace=force_replace,
            backup_path=backup_path,
        )

    def generate_manifest(self, *, positive_only: bool = True) -> pd.DataFrame:
        return _generate_manifest_impl(self, positive_only=positive_only)

    def load_manifest(self) -> pd.DataFrame:
        return _load_manifest_impl(self)

    def load_patient_split(self) -> dict[str, Any]:
        return _load_patient_split_impl(self)

    def save_patient_split(self, split_record: dict[str, Any]) -> dict[str, Any]:
        return _save_patient_split_impl(self, split_record)

    def clear_patient_split(self) -> None:
        _clear_patient_split_impl(self)

    @staticmethod
    def _job_row_to_dict(row: dict[str, Any]) -> dict[str, Any]:
        return _job_row_to_dict_impl(row)

    def enqueue_job(
        self,
        job_type: str,
        payload: dict[str, Any],
        *,
        queue_name: str = "default",
        priority: int = 100,
        max_attempts: int = 1,
        available_at: str | None = None,
    ) -> dict[str, Any]:
        return _enqueue_job_impl(
            self,
            job_type,
            payload,
            queue_name=queue_name,
            priority=priority,
            max_attempts=max_attempts,
            available_at=available_at,
        )

    def list_jobs(self, status: str | None = None) -> list[dict[str, Any]]:
        return _list_jobs_impl(self, status=status)

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        return _get_job_impl(self, job_id)

    def delete_jobs(self, *, job_type: str | None = None) -> int:
        return _delete_jobs_impl(self, job_type=job_type)

    def request_job_cancel(self, job_id: str) -> dict[str, Any] | None:
        return _request_job_cancel_impl(self, job_id)

    def update_job_status(self, job_id: str, status: str, result: dict[str, Any] | None = None) -> None:
        _update_job_status_impl(self, job_id, status, result=result)

    @staticmethod
    def claim_next_job(
        worker_id: str,
        *,
        queue_names: list[str] | None = None,
        site_id: str | None = None,
    ) -> dict[str, Any] | None:
        return _claim_next_job_impl(
            worker_id,
            queue_names=queue_names,
            site_id=site_id,
        )

    @staticmethod
    def heartbeat_job(job_id: str, worker_id: str) -> None:
        _heartbeat_job_impl(job_id, worker_id)

    @staticmethod
    def requeue_stale_jobs(*, heartbeat_before: str) -> int:
        return _requeue_stale_jobs_impl(heartbeat_before=heartbeat_before)

    def artifact_files(self, artifact_type: str) -> list[Path]:
        return _artifact_files_impl(self, artifact_type)
