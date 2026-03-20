import io
import logging
import os
import time
from types import SimpleNamespace
import zipfile
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel
from kera_research.api.control_plane_proxy import call_remote_control_plane_method, remote_control_plane_is_primary, site_record_for_request
from kera_research.api.site_jobs import (
    require_ready_model_version,
    resolve_execution_device_or_raise,
    serialize_site_model_version,
    start_cross_validation,
    start_initial_training,
    start_initial_training_benchmark,
    start_site_validation,
)
from kera_research.domain import normalize_actual_visit_date, normalize_patient_pseudonym, normalize_visit_label
from kera_research.services.data_plane import SiteStore

logger = logging.getLogger(__name__)
TIMING_LOGS_ENABLED = str(os.getenv("KERA_BOOTSTRAP_TIMING_LOGS") or "").strip() == "1"


def build_sites_router(support: Any) -> APIRouter:
    router = APIRouter()

    class ResearchRegistrySettingsRequest(BaseModel):
        research_registry_enabled: bool

    class ResearchRegistryConsentRequest(BaseModel):
        version: str = "v1"

    get_control_plane = support.get_control_plane
    get_approved_user = support.get_approved_user
    require_admin_workspace_permission = support.require_admin_workspace_permission
    require_validation_permission = support.require_validation_permission
    require_site_access = support.require_site_access
    user_can_access_site = support.user_can_access_site
    control_plane_split_enabled = support.control_plane_split_enabled
    local_site_records_for_user = support.local_site_records_for_user
    get_model_version = support.get_model_version
    resolve_execution_device = support.resolve_execution_device
    project_id_for_site = support.project_id_for_site
    queue_name_for_job_type = support.queue_name_for_job_type
    get_embedding_backfill_status = support.get_embedding_backfill_status
    latest_embedding_backfill_job = support.latest_embedding_backfill_job
    queue_site_embedding_backfill = support.queue_site_embedding_backfill
    bool_from_value = support.bool_from_value
    coerce_text = support.coerce_text
    site_level_validation_runs = support.site_level_validation_runs
    validation_case_rows = support.validation_case_rows
    build_site_activity = support.build_site_activity
    normalize_storage_root = support.normalize_storage_root
    load_or_create_workflow = support.get_workflow
    import_template_rows = support.import_template_rows
    model_dir = support.model_dir
    make_id = support.make_id
    training_architectures = support.training_architectures
    load_cross_validation_reports = support.load_cross_validation_reports

    SiteValidationRunRequest = support.SiteValidationRunRequest
    InitialTrainingRequest = support.InitialTrainingRequest
    InitialTrainingBenchmarkRequest = support.InitialTrainingBenchmarkRequest
    ResumeBenchmarkRequest = support.ResumeBenchmarkRequest
    EmbeddingBackfillRequest = support.EmbeddingBackfillRequest
    CrossValidationRunRequest = support.CrossValidationRunRequest

    def assert_site_access_only(user: dict[str, Any], site_id: str) -> None:
        if not user_can_access_site(user, site_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this site.")

    def build_local_summary(site_store: SiteStore, site_id: str) -> dict[str, Any]:
        stats = site_store.site_summary_stats()
        return {
            "site_id": site_id,
            "n_patients": stats["n_patients"],
            "n_visits": stats["n_visits"],
            "n_images": stats["n_images"],
            "n_active_visits": stats["n_active_visits"],
            "n_validation_runs": 0,
            "latest_validation": None,
            "research_registry": {
                "site_enabled": False,
                "user_enrolled": False,
                "user_enrolled_at": None,
                "included_cases": stats["n_included_visits"],
                "excluded_cases": stats["n_excluded_visits"],
            },
        }

    @router.get("/api/sites")
    def list_sites(
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
        authorization: str | None = Header(default=None),
        control_plane_owner: str | None = Header(default=None, alias="x-kera-control-plane-owner"),
    ) -> list[dict[str, Any]]:
        remote_sites = call_remote_control_plane_method(
            cp,
            authorization=authorization,
            control_plane_owner=control_plane_owner,
            method_name="main_sites",
        )
        if remote_sites is not None:
            return remote_sites
        if remote_control_plane_is_primary(cp, control_plane_owner=control_plane_owner):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Central control plane sites are unavailable.",
            )
        accessible_sites = cp.accessible_sites_for_user(user)
        if accessible_sites:
            return accessible_sites
        if control_plane_split_enabled():
            return local_site_records_for_user(user)
        return []

    @router.get("/api/sites/{site_id}/summary")
    def site_summary(
        site_id: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
        authorization: str | None = Header(default=None),
        control_plane_owner: str | None = Header(default=None, alias="x-kera-control-plane-owner"),
    ) -> dict[str, Any]:
        started_at = time.perf_counter()
        site_store = require_site_access(cp, user, site_id)
        stats_started_at = time.perf_counter()
        stats = site_store.site_summary_stats()
        stats_elapsed_ms = (time.perf_counter() - stats_started_at) * 1000.0
        validation_started_at = time.perf_counter()
        validation_summary = cp.validation_run_summary(site_id=site_id)
        validation_elapsed_ms = (time.perf_counter() - validation_started_at) * 1000.0
        latest_run = validation_summary.get("latest_run")
        validation_run_count = int(validation_summary.get("count") or 0)
        site_record_started_at = time.perf_counter()
        site_record = site_record_for_request(
            cp,
            site_id=site_id,
            authorization=authorization,
            control_plane_owner=control_plane_owner,
        ) or {}
        site_record_elapsed_ms = (time.perf_counter() - site_record_started_at) * 1000.0
        consent_started_at = time.perf_counter()
        consent = cp.get_registry_consent(user["user_id"], site_id)
        consent_elapsed_ms = (time.perf_counter() - consent_started_at) * 1000.0
        total_elapsed_ms = (time.perf_counter() - started_at) * 1000.0
        if TIMING_LOGS_ENABLED:
            logger.info(
                "site_summary_timing site_id=%s stats_ms=%.1f validation_ms=%.1f site_record_ms=%.1f consent_ms=%.1f total_ms=%.1f",
                site_id,
                stats_elapsed_ms,
                validation_elapsed_ms,
                site_record_elapsed_ms,
                consent_elapsed_ms,
                total_elapsed_ms,
            )
        if not site_record and control_plane_split_enabled():
            summary = build_local_summary(site_store, site_id)
            summary["n_validation_runs"] = validation_run_count
            summary["latest_validation"] = latest_run
            return summary
        return {
            "site_id": site_id,
            "n_patients": stats["n_patients"],
            "n_visits": stats["n_visits"],
            "n_images": stats["n_images"],
            "n_active_visits": stats["n_active_visits"],
            "n_validation_runs": validation_run_count,
            "latest_validation": latest_run,
            "research_registry": {
                "site_enabled": bool(site_record.get("research_registry_enabled", True)),
                "user_enrolled": consent is not None,
                "user_enrolled_at": consent.get("enrolled_at") if consent else None,
                "included_cases": stats["n_included_visits"],
                "excluded_cases": stats["n_excluded_visits"],
            },
        }

    @router.get("/api/sites/{site_id}/research-registry/settings")
    def get_research_registry_settings(
        site_id: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
        authorization: str | None = Header(default=None),
        control_plane_owner: str | None = Header(default=None, alias="x-kera-control-plane-owner"),
    ) -> dict[str, Any]:
        assert_site_access_only(user, site_id)
        site_record = site_record_for_request(
            cp,
            site_id=site_id,
            authorization=authorization,
            control_plane_owner=control_plane_owner,
        )
        if site_record is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown site.")
        consent = cp.get_registry_consent(user["user_id"], site_id)
        return {
            "site_id": site_id,
            "research_registry_enabled": bool(site_record.get("research_registry_enabled", True)),
            "user_enrolled": consent is not None,
            "user_enrolled_at": consent.get("enrolled_at") if consent else None,
        }

    @router.patch("/api/sites/{site_id}/research-registry/settings")
    def update_research_registry_settings(
        site_id: str,
        payload: ResearchRegistrySettingsRequest,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
        authorization: str | None = Header(default=None),
        control_plane_owner: str | None = Header(default=None, alias="x-kera-control-plane-owner"),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        assert_site_access_only(user, site_id)
        site_record = site_record_for_request(
            cp,
            site_id=site_id,
            authorization=authorization,
            control_plane_owner=control_plane_owner,
        )
        if site_record is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown site.")
        remote_site = call_remote_control_plane_method(
            cp,
            authorization=authorization,
            control_plane_owner=control_plane_owner,
            method_name="main_admin_update_site",
            site_id=site_id,
            payload_json={"research_registry_enabled": payload.research_registry_enabled},
        )
        if remote_site is not None:
            return {
                "site_id": site_id,
                "research_registry_enabled": bool(remote_site.get("research_registry_enabled", True)),
            }
        if remote_control_plane_is_primary(cp, control_plane_owner=control_plane_owner):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Central control plane site settings are unavailable.",
            )
        updated = cp.update_site_metadata(
            site_id,
            str(site_record.get("display_name") or site_id),
            str(site_record.get("hospital_name") or ""),
            research_registry_enabled=payload.research_registry_enabled,
        )
        return {
            "site_id": site_id,
            "research_registry_enabled": bool(updated.get("research_registry_enabled", True)),
        }

    @router.post("/api/sites/{site_id}/research-registry/consent")
    def enroll_research_registry(
        site_id: str,
        payload: ResearchRegistryConsentRequest,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
        authorization: str | None = Header(default=None),
        control_plane_owner: str | None = Header(default=None, alias="x-kera-control-plane-owner"),
    ) -> dict[str, Any]:
        assert_site_access_only(user, site_id)
        site_record = site_record_for_request(
            cp,
            site_id=site_id,
            authorization=authorization,
            control_plane_owner=control_plane_owner,
        )
        if site_record is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown site.")
        if not bool(site_record.get("research_registry_enabled", True)):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This site's research registry is disabled by the institution.",
            )
        updated_user = cp.set_registry_consent(user["user_id"], site_id, version=payload.version)
        consent = cp.get_registry_consent(updated_user["user_id"], site_id)
        return {
            "site_id": site_id,
            "user_enrolled": consent is not None,
            "user_enrolled_at": consent.get("enrolled_at") if consent else None,
        }

    @router.get("/api/sites/{site_id}/import/template.csv")
    def download_import_template(
        site_id: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> Response:
        require_admin_workspace_permission(user)
        assert_site_access_only(user, site_id)
        template_csv = "\n".join(import_template_rows).encode("utf-8-sig")
        return Response(
            content=template_csv,
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="kera_import_template.csv"'},
        )

    @router.post("/api/sites/{site_id}/import/bulk")
    async def bulk_import_site_data(
        site_id: str,
        csv_file: UploadFile = File(...),
        files: list[UploadFile] = File(default=[]),
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        site_store = require_site_access(cp, user, site_id)

        csv_name = (csv_file.filename or "").lower()
        if not csv_name.endswith(".csv"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bulk import requires a CSV metadata file.")

        csv_bytes = await csv_file.read()
        try:
            import_df = pd.read_csv(io.BytesIO(csv_bytes))
        except Exception as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unable to parse CSV: {exc}") from exc

        required_columns = [
            "patient_id",
            "sex",
            "age",
            "visit_date",
            "culture_confirmed",
            "culture_category",
            "culture_species",
            "image_filename",
            "view",
        ]
        missing_columns = [column for column in required_columns if column not in import_df.columns]
        if missing_columns:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Missing columns: {', '.join(missing_columns)}",
            )

        image_bytes: dict[str, bytes] = {}
        image_sources: dict[str, str] = {}
        for upload in files:
            upload_name = Path(upload.filename or "").name
            if not upload_name:
                continue
            content = await upload.read()
            if upload_name.lower().endswith(".zip"):
                try:
                    with zipfile.ZipFile(io.BytesIO(content)) as archive:
                        for member in archive.namelist():
                            if member.endswith("/"):
                                continue
                            image_name = Path(member).name
                            if not image_name or image_name.startswith(".") or ".." in member:
                                continue
                            image_bytes[image_name] = archive.read(member)
                            image_sources[image_name] = upload_name
                except zipfile.BadZipFile as exc:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Invalid ZIP archive: {upload_name}",
                    ) from exc
            else:
                image_bytes[upload_name] = content
                image_sources[upload_name] = upload_name

        import_df = import_df.where(pd.notnull(import_df), None)
        patient_cache = {item["patient_id"] for item in site_store.list_patients()}
        visit_cache = {(item["patient_id"], item["visit_date"]) for item in site_store.list_visits()}
        existing_images = site_store.list_images()
        image_cache: set[tuple[str, str, str]] = set()
        for item in existing_images:
            image_name = Path(str(item.get("image_path") or "")).name
            image_cache.add((item["patient_id"], item["visit_date"], image_name))

        imported_images = 0
        skipped_images = 0
        created_patients = 0
        created_visits = 0
        errors: list[str] = []

        for row_index, row in import_df.iterrows():
            try:
                patient_id = normalize_patient_pseudonym(coerce_text(row.get("patient_id")))
                visit_date = normalize_visit_label(coerce_text(row.get("visit_date")))
                actual_visit_date = normalize_actual_visit_date(coerce_text(row.get("actual_visit_date")))
                file_name = Path(coerce_text(row.get("image_filename"))).name
                if not patient_id or not visit_date or not file_name:
                    errors.append(f"Row {row_index + 2}: patient_id, visit_date, image_filename are required.")
                    skipped_images += 1
                    continue
                if file_name not in image_bytes:
                    errors.append(f"{file_name}: file not found in uploaded ZIP or image bundle.")
                    skipped_images += 1
                    continue

                if patient_id not in patient_cache:
                    site_store.create_patient(
                        patient_id=patient_id,
                        sex=coerce_text(row.get("sex"), "unknown") or "unknown",
                        age=int(float(row.get("age") or 0)),
                        chart_alias=coerce_text(row.get("chart_alias")),
                        local_case_code=coerce_text(row.get("local_case_code")),
                        created_by_user_id=user["user_id"],
                    )
                    patient_cache.add(patient_id)
                    created_patients += 1

                visit_key = (patient_id, visit_date)
                if visit_key not in visit_cache:
                    raw_factors = coerce_text(row.get("predisposing_factor"))
                    factors = [item.strip() for item in raw_factors.split("|") if item.strip()]
                    site_store.create_visit(
                        patient_id=patient_id,
                        visit_date=visit_date,
                        actual_visit_date=actual_visit_date,
                        culture_confirmed=bool_from_value(row.get("culture_confirmed"), True),
                        culture_category=coerce_text(row.get("culture_category"), "bacterial") or "bacterial",
                        culture_species=coerce_text(row.get("culture_species"), "Other") or "Other",
                        additional_organisms=[],
                        contact_lens_use=coerce_text(row.get("contact_lens_use"), "unknown") or "unknown",
                        predisposing_factor=factors,
                        other_history=coerce_text(row.get("other_history")),
                        visit_status=coerce_text(row.get("visit_status"), "active") or "active",
                        active_stage=bool_from_value(row.get("active_stage"), True),
                        smear_result=coerce_text(row.get("smear_result")),
                        polymicrobial=bool_from_value(row.get("polymicrobial"), False),
                        created_by_user_id=user["user_id"],
                    )
                    visit_cache.add(visit_key)
                    created_visits += 1

                if any(
                    cached_patient == patient_id
                    and cached_visit_date == visit_date
                    and cached_image_name.endswith(f"_{file_name}")
                    for cached_patient, cached_visit_date, cached_image_name in image_cache
                ):
                    skipped_images += 1
                    continue

                saved_image = site_store.add_image(
                    patient_id=patient_id,
                    visit_date=visit_date,
                    view=coerce_text(row.get("view"), "white") or "white",
                    is_representative=bool_from_value(row.get("is_representative"), False),
                    file_name=file_name,
                    content=image_bytes[file_name],
                    created_by_user_id=user["user_id"],
                )
                image_cache.add((patient_id, visit_date, Path(saved_image["image_path"]).name))
                imported_images += 1
            except Exception as exc:
                skipped_images += 1
                errors.append(f"Row {row_index + 2}: {exc}")

        return {
            "site_id": site_id,
            "rows_received": int(len(import_df.index)),
            "files_received": len(image_bytes),
            "created_patients": created_patients,
            "created_visits": created_visits,
            "imported_images": imported_images,
            "skipped_images": skipped_images,
            "errors": errors[:100],
            "file_sources": image_sources,
        }

    @router.get("/api/sites/{site_id}/activity")
    def site_activity(
        site_id: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        assert_site_access_only(user, site_id)
        return build_site_activity(cp, site_id, current_user_id=user["user_id"])

    @router.get("/api/sites/{site_id}/validations")
    def list_site_validations(
        site_id: str,
        limit: int | None = None,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> list[dict[str, Any]]:
        assert_site_access_only(user, site_id)
        normalized_limit = max(1, min(int(limit or 0), 100)) if limit else None
        return site_level_validation_runs(cp.list_validation_runs(site_id=site_id, limit=normalized_limit))

    @router.get("/api/sites/{site_id}/validations/{validation_id}/cases")
    def list_validation_cases(
        site_id: str,
        validation_id: str,
        misclassified_only: bool = False,
        limit: int | None = 20,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> list[dict[str, Any]]:
        if not user_can_access_site(user, site_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this site.")
        try:
            site_store: SiteStore | None = SiteStore(site_id)
        except Exception:
            site_store = None
        validation_run = next((item for item in cp.list_validation_runs(site_id=site_id) if item.get("validation_id") == validation_id), None)
        if validation_run is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Validation run not found.")
        normalized_limit = max(0, min(limit if limit is not None else 20, 100))
        return validation_case_rows(cp, site_store, validation_id, misclassified_only=misclassified_only, limit=normalized_limit)

    @router.post("/api/sites/{site_id}/validations/run")
    def run_site_validation(
        site_id: str,
        payload: SiteValidationRunRequest,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_validation_permission(user)
        site_store = require_site_access(cp, user, site_id)
        model_version = require_ready_model_version(
            cp,
            get_model_version=get_model_version,
            model_version_id=payload.model_version_id,
            unavailable_detail="No ready model version is available for site validation.",
        )
        execution_device = resolve_execution_device_or_raise(
            resolve_execution_device=resolve_execution_device,
            execution_mode=payload.execution_mode,
            unavailable_label="Site validation",
        )
        return start_site_validation(
            site_store,
            site_id=site_id,
            project_id=project_id_for_site(cp, site_id),
            model_version=model_version,
            payload=payload,
            execution_device=execution_device,
            queue_name_for_job_type=queue_name_for_job_type,
        )

    @router.post("/api/sites/{site_id}/training/initial")
    def run_initial_training(
        site_id: str,
        payload: InitialTrainingRequest,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        site_store = require_site_access(cp, user, site_id)

        if payload.architecture not in training_architectures:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Initial training supports only these architectures: {', '.join(training_architectures)}",
            )
        execution_device = resolve_execution_device_or_raise(
            resolve_execution_device=resolve_execution_device,
            execution_mode=payload.execution_mode,
            unavailable_label="Initial training",
        )
        return start_initial_training(
            site_store,
            site_id=site_id,
            payload=payload,
            execution_device=execution_device,
            queue_name_for_job_type=queue_name_for_job_type,
            model_dir=model_dir,
            make_id=make_id,
        )

    @router.post("/api/sites/{site_id}/training/initial/benchmark")
    def run_initial_training_benchmark(
        site_id: str,
        payload: InitialTrainingBenchmarkRequest,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        site_store = require_site_access(cp, user, site_id)

        architectures = [str(item).strip() for item in payload.architectures if str(item).strip()]
        architectures = list(dict.fromkeys(architectures))
        if not architectures:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one architecture is required.")
        unsupported = [item for item in architectures if item not in training_architectures]
        if unsupported:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported architectures: {', '.join(unsupported)}. Supported: {', '.join(training_architectures)}",
            )
        execution_device = resolve_execution_device_or_raise(
            resolve_execution_device=resolve_execution_device,
            execution_mode=payload.execution_mode,
            unavailable_label="Initial benchmark training",
        )
        return start_initial_training_benchmark(
            site_store,
            site_id=site_id,
            payload=payload,
            architectures=architectures,
            execution_device=execution_device,
            queue_name_for_job_type=queue_name_for_job_type,
        )

    @router.post("/api/sites/{site_id}/training/initial/benchmark/resume")
    def resume_initial_training_benchmark(
        site_id: str,
        payload: ResumeBenchmarkRequest,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        site_store = require_site_access(cp, user, site_id)
        source_job = site_store.get_job(payload.job_id)
        if source_job is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source benchmark job not found.")
        if str(source_job.get("job_type") or "") != "initial_training_benchmark":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only benchmark training jobs can be resumed.")
        if str(source_job.get("status") or "").strip().lower() in {"queued", "running", "cancelling"}:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The selected benchmark job is still active.")

        source_payload = dict(source_job.get("payload") or {})
        requested_architectures = [str(item).strip() for item in source_payload.get("architectures") or [] if str(item).strip()]
        if not requested_architectures:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The selected benchmark job does not contain architectures.")

        result_payload = dict(source_job.get("result") or {})
        response_payload = dict(result_payload.get("response") or {})
        progress_payload = dict(result_payload.get("progress") or {})
        completed_architectures = {
            str(item.get("architecture") or "").strip()
            for item in response_payload.get("results", [])
            if isinstance(item, dict) and str(item.get("status") or "").strip().lower() == "completed"
        }
        completed_architectures.update(
            str(item).strip()
            for item in progress_payload.get("completed_architectures", [])
            if str(item).strip()
        )
        remaining_architectures = [
            architecture
            for architecture in requested_architectures
            if architecture and architecture not in completed_architectures
        ]
        if not remaining_architectures:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="There are no incomplete architectures to resume.")

        execution_mode = str(payload.execution_mode or source_payload.get("execution_mode") or "auto")
        execution_device = resolve_execution_device_or_raise(
            resolve_execution_device=resolve_execution_device,
            execution_mode=execution_mode,
            unavailable_label="Benchmark resume",
        )
        resume_payload = SimpleNamespace(
            execution_mode=execution_mode,
            crop_mode=str(source_payload.get("crop_mode") or "automated"),
            case_aggregation=str(source_payload.get("case_aggregation") or "mean"),
            epochs=int(source_payload.get("epochs") or 30),
            learning_rate=float(source_payload.get("learning_rate") or 1e-4),
            batch_size=int(source_payload.get("batch_size") or 16),
            val_split=float(source_payload.get("val_split") or 0.2),
            test_split=float(source_payload.get("test_split") or 0.2),
            use_pretrained=bool(source_payload.get("use_pretrained", True)),
            regenerate_split=False,
        )
        return start_initial_training_benchmark(
            site_store,
            site_id=site_id,
            payload=resume_payload,
            architectures=remaining_architectures,
            execution_device=execution_device,
            queue_name_for_job_type=queue_name_for_job_type,
        )

    @router.get("/api/sites/{site_id}/jobs/{job_id}")
    def get_site_job(
        site_id: str,
        job_id: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        site_store = require_site_access(cp, user, site_id)
        job = site_store.get_job(job_id)
        if job is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found.")
        return job

    @router.post("/api/sites/{site_id}/jobs/{job_id}/cancel")
    def cancel_site_job(
        site_id: str,
        job_id: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        site_store = require_site_access(cp, user, site_id)
        job = site_store.request_job_cancel(job_id)
        if job is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found.")
        return job

    @router.get("/api/sites/{site_id}/ai-clinic/embeddings/status")
    def get_ai_clinic_embedding_status(
        site_id: str,
        model_version_id: str | None = None,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        site_store = require_site_access(cp, user, site_id)
        model_version = require_ready_model_version(
            cp,
            get_model_version=get_model_version,
            model_version_id=model_version_id,
            unavailable_detail="No ready model version is available for AI Clinic embedding status.",
        )
        return get_embedding_backfill_status(cp, site_store, model_version=model_version)

    @router.post("/api/sites/{site_id}/ai-clinic/embeddings/backfill")
    def backfill_ai_clinic_embeddings(
        site_id: str,
        payload: EmbeddingBackfillRequest,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        site_store = require_site_access(cp, user, site_id)
        active_job = latest_embedding_backfill_job(site_store)
        if active_job is not None and active_job.get("status") in {"queued", "running"}:
            active_payload = dict(active_job.get("payload") or {})
            active_model_version = get_model_version(cp, str(active_payload.get("model_version_id") or "") or None)
            return {
                "site_id": site_id,
                "job": active_job,
                "model_version": {
                    **serialize_site_model_version(active_model_version),
                    "version_id": active_payload.get("model_version_id"),
                    "version_name": active_payload.get("model_version_name"),
                },
                "execution_device": active_payload.get("execution_device", "unknown"),
            }
        model_version = require_ready_model_version(
            cp,
            get_model_version=get_model_version,
            model_version_id=payload.model_version_id,
            unavailable_detail="No ready model version is available for AI Clinic embedding backfill.",
        )
        execution_device = resolve_execution_device_or_raise(
            resolve_execution_device=resolve_execution_device,
            execution_mode=payload.execution_mode,
            unavailable_label="AI Clinic embedding backfill",
        )
        job = queue_site_embedding_backfill(
            cp,
            site_store,
            model_version=model_version,
            execution_device=execution_device,
            force_refresh=bool(payload.force_refresh),
        )
        return {
            "site_id": site_id,
            "job": job,
            "model_version": serialize_site_model_version(model_version),
            "execution_device": execution_device,
        }

    @router.get("/api/sites/{site_id}/training/cross-validation")
    def list_cross_validation_reports(
        site_id: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> list[dict[str, Any]]:
        require_admin_workspace_permission(user)
        site_store = require_site_access(cp, user, site_id)
        return load_cross_validation_reports(site_store)

    @router.post("/api/sites/{site_id}/training/cross-validation")
    def run_cross_validation(
        site_id: str,
        payload: CrossValidationRunRequest,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        site_store = require_site_access(cp, user, site_id)
        if payload.architecture not in training_architectures:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cross-validation supports only these architectures: {', '.join(training_architectures)}",
            )
        execution_device = resolve_execution_device_or_raise(
            resolve_execution_device=resolve_execution_device,
            execution_mode=payload.execution_mode,
            unavailable_label="Cross-validation",
        )
        return start_cross_validation(
            site_store,
            site_id=site_id,
            payload=payload,
            execution_device=execution_device,
            queue_name_for_job_type=queue_name_for_job_type,
            model_dir=model_dir,
            make_id=make_id,
        )

    return router
