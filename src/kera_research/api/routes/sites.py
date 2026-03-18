import io
import zipfile
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel
from kera_research.domain import normalize_actual_visit_date, normalize_patient_pseudonym, normalize_visit_label
from kera_research.services.data_plane import SiteStore


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
    EmbeddingBackfillRequest = support.EmbeddingBackfillRequest
    CrossValidationRunRequest = support.CrossValidationRunRequest

    def build_local_summary(site_store: SiteStore, site_id: str) -> dict[str, Any]:
        patients = site_store.list_patients()
        visits = site_store.list_visits()
        images = site_store.list_images()
        active_visits = [
            visit for visit in visits if visit.get("visit_status", "active" if visit.get("active_stage") else "scar") == "active"
        ]
        included_visits = [visit for visit in visits if visit.get("research_registry_status", "analysis_only") == "included"]
        excluded_visits = [visit for visit in visits if visit.get("research_registry_status", "analysis_only") == "excluded"]
        return {
            "site_id": site_id,
            "n_patients": len(patients),
            "n_visits": len(visits),
            "n_images": len(images),
            "n_active_visits": len(active_visits),
            "n_validation_runs": 0,
            "latest_validation": None,
            "research_registry": {
                "site_enabled": False,
                "user_enrolled": False,
                "user_enrolled_at": None,
                "included_cases": len(included_visits),
                "excluded_cases": len(excluded_visits),
            },
        }

    @router.get("/api/sites")
    def list_sites(
        user: dict[str, Any] = Depends(get_approved_user),
        cp=Depends(get_control_plane),
    ) -> list[dict[str, Any]]:
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
    ) -> dict[str, Any]:
        site_store = require_site_access(cp, user, site_id)
        patients = site_store.list_patients()
        visits = site_store.list_visits()
        images = site_store.list_images()
        validation_runs = cp.list_validation_runs(site_id=site_id)
        active_visits = [
            visit for visit in visits if visit.get("visit_status", "active" if visit.get("active_stage") else "scar") == "active"
        ]
        included_visits = [visit for visit in visits if visit.get("research_registry_status", "analysis_only") == "included"]
        excluded_visits = [visit for visit in visits if visit.get("research_registry_status", "analysis_only") == "excluded"]
        latest_run = validation_runs[0] if validation_runs else None
        site_record = cp.get_site(site_id) or {}
        consent = cp.get_registry_consent(user["user_id"], site_id)
        if not site_record and control_plane_split_enabled():
            summary = build_local_summary(site_store, site_id)
            summary["n_validation_runs"] = len(validation_runs)
            summary["latest_validation"] = latest_run
            return summary
        return {
            "site_id": site_id,
            "n_patients": len(patients),
            "n_visits": len(visits),
            "n_images": len(images),
            "n_active_visits": len(active_visits),
            "n_validation_runs": len(validation_runs),
            "latest_validation": latest_run,
            "research_registry": {
                "site_enabled": bool(site_record.get("research_registry_enabled", True)),
                "user_enrolled": consent is not None,
                "user_enrolled_at": consent.get("enrolled_at") if consent else None,
                "included_cases": len(included_visits),
                "excluded_cases": len(excluded_visits),
            },
        }

    @router.get("/api/sites/{site_id}/research-registry/settings")
    def get_research_registry_settings(
        site_id: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_site_access(cp, user, site_id)
        site_record = cp.get_site(site_id)
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
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        require_site_access(cp, user, site_id)
        site_record = cp.get_site(site_id)
        if site_record is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown site.")
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
    ) -> dict[str, Any]:
        require_site_access(cp, user, site_id)
        site_record = cp.get_site(site_id)
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
        require_site_access(cp, user, site_id)
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
        require_site_access(cp, user, site_id)
        return build_site_activity(cp, site_id, current_user_id=user["user_id"])

    @router.get("/api/sites/{site_id}/validations")
    def list_site_validations(
        site_id: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> list[dict[str, Any]]:
        require_site_access(cp, user, site_id)
        return site_level_validation_runs(cp.list_validation_runs(site_id=site_id))

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

        model_version = get_model_version(cp, payload.model_version_id)
        if model_version is None or not model_version.get("ready", True):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="No ready model version is available for site validation.",
            )

        try:
            execution_device = resolve_execution_device(payload.execution_mode)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Site validation is unavailable: {exc}",
            ) from exc
        job = site_store.enqueue_job(
            "site_validation",
            {
                "project_id": project_id_for_site(cp, site_id),
                "model_version_id": model_version.get("version_id"),
                "execution_mode": payload.execution_mode,
                "execution_device": execution_device,
                "generate_gradcam": bool(payload.generate_gradcam),
                "generate_medsam": bool(payload.generate_medsam),
            },
            queue_name=queue_name_for_job_type("site_validation"),
        )
        site_store.update_job_status(
            job["job_id"],
            "queued",
            {
                "progress": {
                    "stage": "queued",
                    "message": "Hospital validation job queued.",
                    "percent": 0,
                }
            },
        )
        return {
            "site_id": site_id,
            "execution_device": execution_device,
            "job": site_store.get_job(job["job_id"]) or job,
            "model_version": {
                "version_id": model_version.get("version_id"),
                "version_name": model_version.get("version_name"),
                "architecture": model_version.get("architecture"),
            },
        }

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

        try:
            execution_device = resolve_execution_device(payload.execution_mode)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Initial training is unavailable: {exc}",
            ) from exc

        output_path = model_dir / f"global_{payload.architecture}_{make_id('init')[:8]}.pth"
        job = site_store.enqueue_job(
            "initial_training",
            {
                "architecture": payload.architecture,
                "execution_mode": payload.execution_mode,
                "execution_device": execution_device,
                "crop_mode": payload.crop_mode,
                "epochs": int(payload.epochs),
                "learning_rate": float(payload.learning_rate),
                "batch_size": int(payload.batch_size),
                "val_split": float(payload.val_split),
                "test_split": float(payload.test_split),
                "use_pretrained": bool(payload.use_pretrained),
                "regenerate_split": bool(payload.regenerate_split),
                "output_model_path": str(output_path),
            },
            queue_name=queue_name_for_job_type("initial_training"),
        )

        site_store.update_job_status(
            job["job_id"],
            "queued",
            {
                "progress": {
                    "stage": "queued",
                    "message": "Training job queued.",
                    "percent": 0,
                    "crop_mode": payload.crop_mode,
                }
            },
        )
        return {
            "site_id": site_id,
            "execution_device": execution_device,
            "job": site_store.get_job(job["job_id"]) or job,
        }

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

        try:
            execution_device = resolve_execution_device(payload.execution_mode)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Initial benchmark training is unavailable: {exc}",
            ) from exc

        job = site_store.enqueue_job(
            "initial_training_benchmark",
            {
                "architectures": architectures,
                "execution_mode": payload.execution_mode,
                "execution_device": execution_device,
                "crop_mode": payload.crop_mode,
                "epochs": int(payload.epochs),
                "learning_rate": float(payload.learning_rate),
                "batch_size": int(payload.batch_size),
                "val_split": float(payload.val_split),
                "test_split": float(payload.test_split),
                "use_pretrained": bool(payload.use_pretrained),
                "regenerate_split": bool(payload.regenerate_split),
            },
            queue_name=queue_name_for_job_type("initial_training_benchmark"),
        )
        site_store.update_job_status(
            job["job_id"],
            "queued",
            {
                "progress": {
                    "stage": "queued",
                    "message": "Benchmark training job queued.",
                    "percent": 0,
                    "crop_mode": payload.crop_mode,
                    "architecture_count": len(architectures),
                }
            },
        )
        return {
            "site_id": site_id,
            "execution_device": execution_device,
            "job": site_store.get_job(job["job_id"]) or job,
        }

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

    @router.get("/api/sites/{site_id}/ai-clinic/embeddings/status")
    def get_ai_clinic_embedding_status(
        site_id: str,
        model_version_id: str | None = None,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        site_store = require_site_access(cp, user, site_id)
        model_version = get_model_version(cp, model_version_id)
        if model_version is None or not model_version.get("ready", True):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="No ready model version is available for AI Clinic embedding status.",
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
                    "version_id": active_payload.get("model_version_id"),
                    "version_name": active_payload.get("model_version_name"),
                    "architecture": active_model_version.get("architecture") if active_model_version else None,
                },
                "execution_device": active_payload.get("execution_device", "unknown"),
            }
        model_version = get_model_version(cp, payload.model_version_id)
        if model_version is None or not model_version.get("ready", True):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="No ready model version is available for AI Clinic embedding backfill.",
            )
        try:
            execution_device = resolve_execution_device(payload.execution_mode)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"AI Clinic embedding backfill is unavailable: {exc}",
            ) from exc
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
            "model_version": {
                "version_id": model_version.get("version_id"),
                "version_name": model_version.get("version_name"),
                "architecture": model_version.get("architecture"),
            },
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
        try:
            execution_device = resolve_execution_device(payload.execution_mode)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Cross-validation is unavailable: {exc}",
            ) from exc
        output_dir = model_dir / f"cross_validation_{make_id('cvdir')[:8]}"

        job = site_store.enqueue_job(
            "cross_validation",
            {
                "architecture": payload.architecture,
                "execution_mode": payload.execution_mode,
                "execution_device": execution_device,
                "crop_mode": payload.crop_mode,
                "num_folds": int(payload.num_folds),
                "epochs": int(payload.epochs),
                "learning_rate": float(payload.learning_rate),
                "batch_size": int(payload.batch_size),
                "val_split": float(payload.val_split),
                "use_pretrained": bool(payload.use_pretrained),
                "output_dir": str(output_dir),
            },
            queue_name=queue_name_for_job_type("cross_validation"),
        )
        site_store.update_job_status(
            job["job_id"],
            "queued",
            {
                "progress": {
                    "stage": "queued",
                    "message": "Cross-validation job queued.",
                    "percent": 0,
                    "crop_mode": payload.crop_mode,
                    "num_folds": payload.num_folds,
                }
            },
        )
        return {
            "site_id": site_id,
            "execution_device": execution_device,
            "job": site_store.get_job(job["job_id"]) or job,
        }

    return router
