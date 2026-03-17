import mimetypes
import hashlib
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from kera_research.services.pipeline_case_support import lesion_prompt_box_signature, load_stored_lesion_crop


def build_cases_router(support: Any) -> APIRouter:
    router = APIRouter()

    class CaseResearchRegistryRequest(BaseModel):
        patient_id: str
        visit_date: str
        action: str
        source: str = "manual"

    get_control_plane = support.get_control_plane
    get_approved_user = support.get_approved_user
    require_site_access = support.require_site_access
    require_validation_permission = support.require_validation_permission
    require_visit_write_access = support.require_visit_write_access
    require_visit_image_write_access = support.require_visit_image_write_access
    require_record_owner = support.require_record_owner
    image_owner_user_id = support.image_owner_user_id
    get_workflow = support.get_workflow
    get_semantic_prompt_scorer = support.get_semantic_prompt_scorer
    serialize_lesion_preview_job = support.serialize_lesion_preview_job
    get_model_version = support.get_model_version
    resolve_execution_device = support.resolve_execution_device
    project_id_for_site = support.project_id_for_site
    queue_case_embedding_refresh = support.queue_case_embedding_refresh
    attach_image_quality_scores = support.attach_image_quality_scores
    build_case_history = support.build_case_history
    build_patient_trajectory = support.build_patient_trajectory
    make_id = support.make_id
    lesion_preview_jobs = support.lesion_preview_jobs
    lesion_preview_jobs_lock = support.lesion_preview_jobs_lock
    max_image_bytes = support.max_image_bytes
    score_slit_lamp_image = support.score_slit_lamp_image
    InvalidImageUploadError = support.InvalidImageUploadError

    PatientCreateRequest = support.PatientCreateRequest
    VisitCreateRequest = support.VisitCreateRequest
    RepresentativeImageRequest = support.RepresentativeImageRequest
    LesionBoxRequest = support.LesionBoxRequest
    CaseValidationRequest = support.CaseValidationRequest
    CaseAiClinicRequest = support.CaseAiClinicRequest
    CaseContributionRequest = support.CaseContributionRequest
    CaseValidationCompareRequest = support.CaseValidationCompareRequest

    def resolve_model_crop_mode(model_version: dict[str, Any]) -> str:
        if model_version.get("ensemble_mode") == "weighted_average":
            crop_mode = str(model_version.get("crop_mode") or "").strip().lower()
            if crop_mode in {"automated", "manual", "both"}:
                return crop_mode
            return "both"
        crop_mode = str(model_version.get("crop_mode") or "").strip().lower()
        if crop_mode in {"automated", "manual", "both"}:
            return crop_mode
        return "automated" if model_version.get("requires_medsam_crop", False) else "raw"

    def resolve_requested_model_version(
        cp: Any,
        *,
        model_version_id: str | None,
        model_version_ids: list[str] | None,
    ) -> dict[str, Any] | None:
        normalized_ids = list(dict.fromkeys(str(item).strip() for item in (model_version_ids or []) if str(item).strip()))
        if normalized_ids:
            versions_by_id = {
                str(item.get("version_id") or ""): item
                for item in cp.list_model_versions()
                if item.get("ready", True)
            }
            components: list[dict[str, Any]] = []
            missing_ids: list[str] = []
            for version_id in normalized_ids:
                component = versions_by_id.get(version_id)
                if component is None:
                    missing_ids.append(version_id)
                else:
                    components.append(component)
            if missing_ids:
                raise ValueError(f"Unknown or unavailable model version(s): {', '.join(missing_ids)}")
            if len(components) == 1:
                return components[0]

            sorted_component_ids = sorted(str(item.get("version_id") or "") for item in components)
            ensemble_suffix = hashlib.sha1("|".join(sorted_component_ids).encode("utf-8")).hexdigest()[:12]
            threshold_values: list[float] = []
            for component in components:
                try:
                    threshold_values.append(float(component.get("decision_threshold")))
                except (TypeError, ValueError):
                    continue
            crop_modes = {resolve_model_crop_mode(component) for component in components}
            ensemble_crop_mode = next(iter(crop_modes)) if len(crop_modes) == 1 else "both"
            component_weight = round(1.0 / max(len(components), 1), 6)
            created_at = max(
                (str(item.get("created_at") or "") for item in components),
                default=datetime.now(timezone.utc).isoformat(),
            )
            ensemble_record = {
                "version_id": f"analysis_ensemble_{ensemble_suffix}",
                "version_name": f"analysis-latest-{len(components)}-{ensemble_suffix}",
                "model_name": "keratitis_cls",
                "architecture": "multi_model_ensemble",
                "stage": "analysis",
                "model_path": "",
                "requires_medsam_crop": any(bool(item.get("requires_medsam_crop", False)) for item in components),
                "crop_mode": ensemble_crop_mode,
                "ensemble_mode": "weighted_average",
                "component_model_version_ids": sorted_component_ids,
                "ensemble_weights": {component_id: component_weight for component_id in sorted_component_ids},
                "preprocess_signature": next(
                    (item.get("preprocess_signature") for item in components if item.get("preprocess_signature")),
                    None,
                ),
                "num_classes": next((item.get("num_classes") for item in components if item.get("num_classes")), 2),
                "decision_threshold": sum(threshold_values) / len(threshold_values) if threshold_values else 0.5,
                "threshold_selection_metric": "component_threshold_mean",
                "threshold_selection_metrics": {
                    "component_version_ids": sorted_component_ids,
                    "component_thresholds": threshold_values,
                    "weighting": "uniform",
                },
                "created_at": created_at,
                "ready": True,
                "is_current": False,
                "notes": f"Temporary analysis ensemble across {len(components)} model versions.",
                "notes_ko": f"{len(components)}개 모델 버전을 묶은 임시 분석 ensemble입니다.",
                "notes_en": f"Temporary analysis ensemble across {len(components)} model versions.",
            }
            return cp.ensure_model_version(ensemble_record)
        return get_model_version(cp, model_version_id)

    def resolve_requested_contribution_models(
        cp: Any,
        *,
        model_version_id: str | None,
        model_version_ids: list[str] | None,
    ) -> list[dict[str, Any]]:
        versions_by_id = {
            str(item.get("version_id") or ""): item
            for item in cp.list_model_versions()
            if item.get("ready", True)
        }

        def expand_contribution_model(model_version: dict[str, Any]) -> list[dict[str, Any]]:
            if model_version.get("ensemble_mode") != "weighted_average":
                return [model_version]
            component_ids = [str(item).strip() for item in model_version.get("component_model_version_ids") or [] if str(item).strip()]
            components = [versions_by_id[component_id] for component_id in component_ids if component_id in versions_by_id]
            if not components:
                raise ValueError(
                    f"Contribution base models are missing for ensemble {model_version.get('version_name') or model_version.get('version_id')}."
                )
            if str(model_version.get("architecture") or "") == "multi_model_ensemble":
                return components
            automated_component = next(
                (
                    component
                    for component in components
                    if component.get("ensemble_mode") != "weighted_average" and resolve_model_crop_mode(component) == "automated"
                ),
                None,
            )
            if automated_component is not None:
                return [automated_component]
            base_component = next((component for component in components if component.get("ensemble_mode") != "weighted_average"), None)
            return [base_component or components[0]]

        requested_ids = list(dict.fromkeys(str(item).strip() for item in (model_version_ids or []) if str(item).strip()))
        if requested_ids:
            requested_models: list[dict[str, Any]] = []
            missing_ids: list[str] = []
            for version_id in requested_ids:
                model_version = versions_by_id.get(version_id)
                if model_version is None:
                    missing_ids.append(version_id)
                else:
                    requested_models.append(model_version)
            if missing_ids:
                raise ValueError(f"Unknown or unavailable model version(s): {', '.join(missing_ids)}")
        else:
            single_model = get_model_version(cp, model_version_id)
            if single_model is None or not single_model.get("ready", True):
                raise ValueError("No ready model version is available for contribution.")
            requested_models = [single_model]

        expanded_models: list[dict[str, Any]] = []
        seen_version_ids: set[str] = set()
        for requested_model in requested_models:
            for expanded_model in expand_contribution_model(requested_model):
                version_id = str(expanded_model.get("version_id") or "").strip()
                if not version_id or version_id in seen_version_ids:
                    continue
                seen_version_ids.add(version_id)
                expanded_models.append(expanded_model)
        if not expanded_models:
            raise ValueError("No contribution-ready model version is available.")
        return expanded_models

    @router.get("/api/sites/{site_id}/cases")
    def list_cases(
        site_id: str,
        mine: bool = False,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> list[dict[str, Any]]:
        site_store = require_site_access(cp, user, site_id)
        created_by_user_id = user["user_id"] if mine else None
        return site_store.list_case_summaries(created_by_user_id=created_by_user_id)

    @router.get("/api/sites/{site_id}/model-versions")
    def list_site_model_versions(
        site_id: str,
        ready_only: bool = True,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> list[dict[str, Any]]:
        require_validation_permission(user)
        require_site_access(cp, user, site_id)
        versions = cp.list_model_versions()
        if ready_only:
            versions = [item for item in versions if item.get("ready", True)]
        return versions

    @router.get("/api/sites/{site_id}/patients")
    def list_patients(
        site_id: str,
        mine: bool = False,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> list[dict[str, Any]]:
        site_store = require_site_access(cp, user, site_id)
        created_by_user_id = user["user_id"] if mine else None
        return site_store.list_patients(created_by_user_id=created_by_user_id)

    @router.get("/api/sites/{site_id}/patients/list-board")
    def list_patient_rows(
        site_id: str,
        q: str | None = None,
        mine: bool = False,
        page: int = 1,
        page_size: int = 25,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        if page < 1:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="page must be at least 1.")
        if page_size < 1 or page_size > 100:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="page_size must be between 1 and 100.")
        site_store = require_site_access(cp, user, site_id)
        created_by_user_id = user["user_id"] if mine else None
        return site_store.list_patient_case_rows(
            created_by_user_id=created_by_user_id,
            search=q,
            page=page,
            page_size=page_size,
        )

    @router.post("/api/sites/{site_id}/patients")
    def create_patient(
        site_id: str,
        payload: PatientCreateRequest,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        site_store = require_site_access(cp, user, site_id)
        try:
            return site_store.create_patient(
                patient_id=payload.patient_id,
                sex=payload.sex,
                age=payload.age,
                chart_alias=payload.chart_alias,
                local_case_code=payload.local_case_code,
                created_by_user_id=user["user_id"],
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.get("/api/sites/{site_id}/visits")
    def list_visits(
        site_id: str,
        patient_id: str | None = None,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> list[dict[str, Any]]:
        site_store = require_site_access(cp, user, site_id)
        if patient_id:
            return site_store.list_visits_for_patient(patient_id)
        return site_store.list_visits()

    @router.post("/api/sites/{site_id}/visits")
    def create_visit(
        site_id: str,
        payload: VisitCreateRequest,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        site_store = require_site_access(cp, user, site_id)
        try:
            return site_store.create_visit(
                patient_id=payload.patient_id,
                visit_date=payload.visit_date,
                actual_visit_date=payload.actual_visit_date,
                culture_confirmed=payload.culture_confirmed,
                culture_category=payload.culture_category,
                culture_species=payload.culture_species,
                additional_organisms=[item.model_dump() for item in payload.additional_organisms],
                contact_lens_use=payload.contact_lens_use,
                predisposing_factor=payload.predisposing_factor,
                other_history=payload.other_history,
                visit_status=payload.visit_status,
                active_stage=payload.visit_status == "active",
                is_initial_visit=payload.is_initial_visit,
                smear_result=payload.smear_result,
                polymicrobial=payload.polymicrobial,
                created_by_user_id=user["user_id"],
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.patch("/api/sites/{site_id}/visits")
    def update_visit(
        site_id: str,
        patient_id: str,
        visit_date: str,
        payload: VisitCreateRequest,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        site_store = require_site_access(cp, user, site_id)
        require_visit_write_access(site_store, user, patient_id, visit_date)
        try:
            return site_store.update_visit(
                patient_id=patient_id,
                visit_date=visit_date,
                actual_visit_date=payload.actual_visit_date,
                culture_confirmed=payload.culture_confirmed,
                culture_category=payload.culture_category,
                culture_species=payload.culture_species,
                additional_organisms=[item.model_dump() for item in payload.additional_organisms],
                contact_lens_use=payload.contact_lens_use,
                predisposing_factor=payload.predisposing_factor,
                other_history=payload.other_history,
                visit_status=payload.visit_status,
                active_stage=payload.visit_status == "active",
                is_initial_visit=payload.is_initial_visit,
                smear_result=payload.smear_result,
                polymicrobial=payload.polymicrobial,
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.delete("/api/sites/{site_id}/visits")
    def delete_visit(
        site_id: str,
        patient_id: str,
        visit_date: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        site_store = require_site_access(cp, user, site_id)
        require_visit_write_access(site_store, user, patient_id, visit_date)
        try:
            return site_store.delete_visit(patient_id, visit_date)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.get("/api/sites/{site_id}/images")
    def list_images(
        site_id: str,
        patient_id: str | None = None,
        visit_date: str | None = None,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> list[dict[str, Any]]:
        site_store = require_site_access(cp, user, site_id)
        if patient_id and visit_date:
            return attach_image_quality_scores(site_store.list_images_for_visit(patient_id, visit_date))
        return attach_image_quality_scores(site_store.list_images())

    @router.post("/api/sites/{site_id}/images")
    async def upload_image(
        site_id: str,
        patient_id: str = Form(...),
        visit_date: str = Form(...),
        view: str = Form(...),
        is_representative: bool = Form(False),
        file: UploadFile = File(...),
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        site_store = require_site_access(cp, user, site_id)
        content = await file.read()
        if len(content) > max_image_bytes:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="File exceeds 20 MB limit.")
        try:
            saved_image = site_store.add_image(
                patient_id=patient_id,
                visit_date=visit_date,
                view=view,
                is_representative=is_representative,
                file_name=file.filename or "upload.bin",
                content=content,
                created_by_user_id=user["user_id"],
            )
            try:
                saved_image["quality_scores"] = score_slit_lamp_image(
                    str(saved_image.get("image_path") or ""),
                    view=str(saved_image.get("view") or "white"),
                )
            except Exception:
                saved_image["quality_scores"] = None
            queue_case_embedding_refresh(
                cp,
                site_store,
                patient_id=patient_id,
                visit_date=visit_date,
                trigger="image_upload",
            )
            return saved_image
        except InvalidImageUploadError as exc:
            raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.delete("/api/sites/{site_id}/images")
    def delete_images(
        site_id: str,
        patient_id: str,
        visit_date: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        site_store = require_site_access(cp, user, site_id)
        require_visit_image_write_access(site_store, user, patient_id=patient_id, visit_date=visit_date)
        deleted_count = site_store.delete_images_for_visit(patient_id, visit_date)
        return {"deleted_count": deleted_count}

    @router.post("/api/sites/{site_id}/images/representative")
    def set_representative_image(
        site_id: str,
        payload: RepresentativeImageRequest,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        site_store = require_site_access(cp, user, site_id)
        visit_images = site_store.list_images_for_visit(payload.patient_id, payload.visit_date)
        if not visit_images:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No images found for this visit.")
        require_visit_image_write_access(
            site_store,
            user,
            patient_id=payload.patient_id,
            visit_date=payload.visit_date,
        )
        if payload.representative_image_id not in {image["image_id"] for image in visit_images}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Representative image is not part of this visit.")
        site_store.update_representative_flags(
            {
                image["image_id"]: image["image_id"] == payload.representative_image_id
                for image in visit_images
            }
        )
        queue_case_embedding_refresh(
            cp,
            site_store,
            patient_id=payload.patient_id,
            visit_date=payload.visit_date,
            trigger="representative_change",
        )
        return {
            "images": site_store.list_images_for_visit(payload.patient_id, payload.visit_date),
        }

    @router.patch("/api/sites/{site_id}/images/{image_id}/lesion-box")
    def update_lesion_box(
        site_id: str,
        image_id: str,
        payload: LesionBoxRequest,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        site_store = require_site_access(cp, user, site_id)
        image = site_store.get_image(image_id)
        if image is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found.")
        require_record_owner(
            user,
            image_owner_user_id(site_store, image),
            detail="Only the creator or a site admin can modify this image.",
        )
        lesion_prompt_box = {
            "x0": min(max(float(payload.x0), 0.0), 1.0),
            "y0": min(max(float(payload.y0), 0.0), 1.0),
            "x1": min(max(float(payload.x1), 0.0), 1.0),
            "y1": min(max(float(payload.y1), 0.0), 1.0),
        }
        if lesion_prompt_box["x1"] <= lesion_prompt_box["x0"] or lesion_prompt_box["y1"] <= lesion_prompt_box["y0"]:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Lesion box coordinates are invalid.")
        try:
            updated = site_store.update_lesion_prompt_box(image_id, lesion_prompt_box)
            queue_case_embedding_refresh(
                cp,
                site_store,
                patient_id=str(updated.get("patient_id") or image.get("patient_id") or ""),
                visit_date=str(updated.get("visit_date") or image.get("visit_date") or ""),
                trigger="lesion_box_update",
            )
            return updated
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.delete("/api/sites/{site_id}/images/{image_id}/lesion-box")
    def clear_lesion_box(
        site_id: str,
        image_id: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        site_store = require_site_access(cp, user, site_id)
        image = site_store.get_image(image_id)
        if image is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found.")
        try:
            return site_store.update_lesion_prompt_box(image_id, None)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.get("/api/sites/{site_id}/images/{image_id}/content")
    def get_image_content(
        site_id: str,
        image_id: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> FileResponse:
        site_store = require_site_access(cp, user, site_id)
        image = site_store.get_image(image_id)
        if image is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found.")
        image_path = Path(image["image_path"])
        if not image_path.exists():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image file not found on disk.")
        media_type = mimetypes.guess_type(image_path.name)[0] or "application/octet-stream"
        return FileResponse(path=image_path, media_type=media_type, filename=image_path.name)

    @router.post("/api/sites/{site_id}/images/{image_id}/lesion-live-preview")
    def start_live_lesion_preview(
        site_id: str,
        image_id: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_validation_permission(user)
        site_store = require_site_access(cp, user, site_id)
        image = site_store.get_image(image_id)
        if image is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found.")
        lesion_prompt_box = image.get("lesion_prompt_box")
        if not isinstance(lesion_prompt_box, dict):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This image requires a saved lesion box.")

        workflow = get_workflow(cp)
        prompt_signature = workflow._lesion_prompt_box_signature(lesion_prompt_box)
        with lesion_preview_jobs_lock:
            for existing in reversed(list(lesion_preview_jobs.values())):
                if (
                    existing.get("site_id") == site_id
                    and existing.get("image_id") == image_id
                    and existing.get("prompt_signature") == prompt_signature
                    and existing.get("status") in {"running", "done"}
                ):
                    return serialize_lesion_preview_job(dict(existing))
        job_id = make_id("lesionjob")
        job_record: dict[str, Any] = {
            "job_id": job_id,
            "site_id": site_id,
            "image_id": image_id,
            "patient_id": image.get("patient_id"),
            "visit_date": image.get("visit_date"),
            "status": "running",
            "error": None,
            "result": None,
            "started_at": datetime.now(timezone.utc).isoformat(),
            "finished_at": None,
            "prompt_signature": prompt_signature,
            "lesion_prompt_box": lesion_prompt_box,
        }
        with lesion_preview_jobs_lock:
            lesion_preview_jobs[job_id] = job_record

        def _run() -> None:
            try:
                result = workflow.preview_image_lesion(site_store, image_id, lesion_prompt_box=dict(lesion_prompt_box))
                with lesion_preview_jobs_lock:
                    lesion_preview_jobs[job_id].update(
                        {
                            "status": "done",
                            "result": result,
                            "finished_at": datetime.now(timezone.utc).isoformat(),
                        }
                    )
            except Exception as exc:
                with lesion_preview_jobs_lock:
                    lesion_preview_jobs[job_id].update(
                        {
                            "status": "failed",
                            "error": str(exc),
                            "finished_at": datetime.now(timezone.utc).isoformat(),
                        }
                    )

        t = threading.Thread(target=_run, daemon=True)
        t.start()
        t.join(timeout=0.25)

        with lesion_preview_jobs_lock:
            job_snapshot = dict(lesion_preview_jobs.get(job_id) or {})
        if not job_snapshot:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Live lesion preview job disappeared.")
        if job_snapshot.get("status") == "failed":
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(job_snapshot.get("error") or "Live lesion preview failed."),
            )
        return serialize_lesion_preview_job(job_snapshot)

    @router.get("/api/sites/{site_id}/images/{image_id}/lesion-live-preview/jobs/{job_id}")
    def get_live_lesion_preview_job(
        site_id: str,
        image_id: str,
        job_id: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_validation_permission(user)
        require_site_access(cp, user, site_id)
        with lesion_preview_jobs_lock:
            job = dict(lesion_preview_jobs.get(job_id) or {})
        if not job:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Live lesion preview job not found.")
        if job.get("site_id") != site_id or job.get("image_id") != image_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Live lesion preview job not found for this image.")
        return serialize_lesion_preview_job(job)

    @router.get("/api/sites/{site_id}/images/{image_id}/semantic-prompts")
    def score_image_semantic_prompts(
        site_id: str,
        image_id: str,
        top_k: int = 3,
        input_mode: str = "source",
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        site_store = require_site_access(cp, user, site_id)
        image = site_store.get_image(image_id)
        if image is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found.")
        try:
            normalized_input_mode = str(input_mode or "source").strip().lower()
            if normalized_input_mode not in {"source", "roi_crop", "lesion_crop"}:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown semantic prompt input mode.")
            analysis_path = str(image["image_path"])
            if normalized_input_mode != "source":
                require_validation_permission(user)
                workflow = get_workflow(cp)
                if normalized_input_mode == "roi_crop":
                    previews = workflow.preview_case_roi(site_store, image["patient_id"], image["visit_date"])
                    preview = next((item for item in previews if item.get("source_image_path") == image.get("image_path")), None)
                    if preview is None or not preview.get("roi_crop_path"):
                        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ROI crop is not available for this image.")
                    analysis_path = str(preview["roi_crop_path"])
                else:
                    previews = workflow.preview_case_lesion(site_store, image["patient_id"], image["visit_date"])
                    preview = next((item for item in previews if item.get("source_image_path") == image.get("image_path")), None)
                    if preview is None or not preview.get("lesion_crop_path"):
                        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lesion crop is not available for this image.")
                    analysis_path = str(preview["lesion_crop_path"])
            scorer = get_semantic_prompt_scorer()
            result = scorer.score_image(analysis_path, view=str(image.get("view") or "white"), top_k=top_k)
            return {
                "image_id": image_id,
                "view": str(image.get("view") or "white"),
                "input_mode": normalized_input_mode,
                **result,
            }
        except FileNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    @router.post("/api/sites/{site_id}/cases/validate")
    def validate_case(
        site_id: str,
        payload: CaseValidationRequest,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_validation_permission(user)
        site_store = require_site_access(cp, user, site_id)
        workflow = get_workflow(cp)
        try:
            model_version = resolve_requested_model_version(
                cp,
                model_version_id=payload.model_version_id,
                model_version_ids=payload.model_version_ids,
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        if model_version is None or not model_version.get("ready", True):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="No ready global model is available for validation.",
            )

        try:
            execution_device = resolve_execution_device(payload.execution_mode)
            summary, case_predictions = workflow.run_case_validation(
                project_id=project_id_for_site(cp, site_id),
                site_store=site_store,
                patient_id=payload.patient_id,
                visit_date=payload.visit_date,
                model_version=model_version,
                execution_device=execution_device,
                generate_gradcam=payload.generate_gradcam,
                generate_medsam=payload.generate_medsam,
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Case validation is unavailable: {exc}",
            ) from exc

        case_prediction = case_predictions[0] if case_predictions else None
        return {
            "summary": summary,
            "case_prediction": case_prediction,
            "model_version": {
                "version_id": model_version.get("version_id"),
                "version_name": model_version.get("version_name"),
                "architecture": model_version.get("architecture"),
                "requires_medsam_crop": bool(model_version.get("requires_medsam_crop", False)),
                "crop_mode": model_version.get("crop_mode"),
                "ensemble_mode": model_version.get("ensemble_mode"),
            },
            "execution_device": execution_device,
            "artifact_availability": {
                "gradcam": bool(case_prediction and case_prediction.get("gradcam_path")),
                "roi_crop": bool(case_prediction and case_prediction.get("roi_crop_path")),
                "medsam_mask": bool(case_prediction and case_prediction.get("medsam_mask_path")),
                "lesion_crop": bool(case_prediction and case_prediction.get("lesion_crop_path")),
                "lesion_mask": bool(case_prediction and case_prediction.get("lesion_mask_path")),
            },
        }

    @router.post("/api/sites/{site_id}/cases/validate/compare")
    def validate_case_compare(
        site_id: str,
        payload: CaseValidationCompareRequest,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_validation_permission(user)
        site_store = require_site_access(cp, user, site_id)
        workflow = get_workflow(cp)
        requested_ids = list(dict.fromkeys(str(item).strip() for item in payload.model_version_ids if str(item).strip()))
        if not requested_ids:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one model version is required.")

        try:
            execution_device = resolve_execution_device(payload.execution_mode)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Case comparison is unavailable: {exc}",
            ) from exc

        comparisons: list[dict[str, Any]] = []
        for model_version_id in requested_ids[:8]:
            model_version = get_model_version(cp, model_version_id)
            if model_version is None or not model_version.get("ready", True):
                comparisons.append(
                    {
                        "model_version_id": model_version_id,
                        "error": "Model version is not available or not ready.",
                    }
                )
                continue
            try:
                summary, case_predictions = workflow.run_case_validation(
                    project_id=project_id_for_site(cp, site_id),
                    site_store=site_store,
                    patient_id=payload.patient_id,
                    visit_date=payload.visit_date,
                    model_version=model_version,
                    execution_device=execution_device,
                    generate_gradcam=payload.generate_gradcam,
                    generate_medsam=payload.generate_medsam,
                )
                case_prediction = case_predictions[0] if case_predictions else None
                comparisons.append(
                    {
                        "summary": summary,
                        "case_prediction": case_prediction,
                        "model_version": {
                            "version_id": model_version.get("version_id"),
                            "version_name": model_version.get("version_name"),
                            "architecture": model_version.get("architecture"),
                            "requires_medsam_crop": bool(model_version.get("requires_medsam_crop", False)),
                            "crop_mode": model_version.get("crop_mode"),
                            "ensemble_mode": model_version.get("ensemble_mode"),
                        },
                        "artifact_availability": {
                            "gradcam": bool(case_prediction and case_prediction.get("gradcam_path")),
                            "roi_crop": bool(case_prediction and case_prediction.get("roi_crop_path")),
                            "medsam_mask": bool(case_prediction and case_prediction.get("medsam_mask_path")),
                            "lesion_crop": bool(case_prediction and case_prediction.get("lesion_crop_path")),
                            "lesion_mask": bool(case_prediction and case_prediction.get("lesion_mask_path")),
                        },
                    }
                )
            except Exception as exc:
                comparisons.append(
                    {
                        "model_version": {
                            "version_id": model_version.get("version_id"),
                            "version_name": model_version.get("version_name"),
                            "architecture": model_version.get("architecture"),
                            "requires_medsam_crop": bool(model_version.get("requires_medsam_crop", False)),
                            "crop_mode": model_version.get("crop_mode"),
                            "ensemble_mode": model_version.get("ensemble_mode"),
                        },
                        "error": str(exc),
                    }
                )

        return {
            "patient_id": payload.patient_id,
            "visit_date": payload.visit_date,
            "execution_device": execution_device,
            "comparisons": comparisons,
        }

    @router.post("/api/sites/{site_id}/cases/ai-clinic")
    def run_case_ai_clinic(
        site_id: str,
        payload: CaseAiClinicRequest,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_validation_permission(user)
        site_store = require_site_access(cp, user, site_id)
        workflow = get_workflow(cp)
        try:
            model_version = resolve_requested_model_version(
                cp,
                model_version_id=payload.model_version_id,
                model_version_ids=payload.model_version_ids,
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        if model_version is None or not model_version.get("ready", True):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="No ready model version is available for AI Clinic retrieval.",
            )

        try:
            execution_device = resolve_execution_device(payload.execution_mode)
            return workflow.run_ai_clinic_report(
                site_store,
                patient_id=payload.patient_id,
                visit_date=payload.visit_date,
                model_version=model_version,
                execution_device=execution_device,
                top_k=payload.top_k,
                retrieval_backend=payload.retrieval_backend,
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"AI Clinic retrieval is unavailable: {exc}",
            ) from exc

    @router.post("/api/sites/{site_id}/cases/contribute")
    def contribute_case(
        site_id: str,
        payload: CaseContributionRequest,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_validation_permission(user)
        site_store = require_site_access(cp, user, site_id)
        workflow = get_workflow(cp)

        visit = site_store.get_visit(payload.patient_id, payload.visit_date)
        if visit is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Visit not found.")
        visit_status = visit.get("visit_status", "active" if visit.get("active_stage") else "scar")
        if visit_status != "active":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Only active visits are enabled for contribution under the current policy.",
            )

        try:
            contribution_models = resolve_requested_contribution_models(
                cp,
                model_version_id=payload.model_version_id,
                model_version_ids=payload.model_version_ids,
            )
            execution_device = resolve_execution_device(payload.execution_mode)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Case contribution is unavailable: {exc}",
            ) from exc

        updates: list[dict[str, Any]] = []
        failures: list[dict[str, Any]] = []
        runtime_failure_count = 0
        contribution_group_id = make_id("contribgrp")
        for model_version in contribution_models:
            try:
                updates.append(
                    workflow.contribute_case(
                        site_store=site_store,
                        patient_id=payload.patient_id,
                        visit_date=payload.visit_date,
                        model_version=model_version,
                        execution_device=execution_device,
                        user_id=user["user_id"],
                        contribution_group_id=contribution_group_id,
                    )
                )
            except ValueError as exc:
                failures.append(
                    {
                        "model_version_id": model_version.get("version_id"),
                        "version_name": model_version.get("version_name"),
                        "architecture": model_version.get("architecture"),
                        "error": str(exc),
                    }
                )
            except RuntimeError as exc:
                runtime_failure_count += 1
                failures.append(
                    {
                        "model_version_id": model_version.get("version_id"),
                        "version_name": model_version.get("version_name"),
                        "architecture": model_version.get("architecture"),
                        "error": str(exc),
                    }
                )

        if not updates:
            detail = "; ".join(item["error"] for item in failures) or "Case contribution is unavailable."
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE if runtime_failure_count and runtime_failure_count == len(failures) else status.HTTP_400_BAD_REQUEST,
                detail=detail,
            )

        primary_update = updates[0]
        primary_model_version = next(
            (
                item
                for item in contribution_models
                if str(item.get("version_id") or "") == str(primary_update.get("base_model_version_id") or "")
            ),
            contribution_models[0],
        )

        return {
            "update": primary_update,
            "updates": updates,
            "update_count": len(updates),
            "contribution_group_id": contribution_group_id,
            "visit_status": visit_status,
            "execution_device": execution_device,
            "model_version": {
                "version_id": primary_model_version.get("version_id"),
                "version_name": primary_model_version.get("version_name"),
                "architecture": primary_model_version.get("architecture"),
            },
            "model_versions": [
                {
                    "version_id": item.get("version_id"),
                    "version_name": item.get("version_name"),
                    "architecture": item.get("architecture"),
                    "crop_mode": item.get("crop_mode"),
                    "ensemble_mode": item.get("ensemble_mode"),
                }
                for item in contribution_models
            ],
            "failures": failures,
            "stats": cp.get_contribution_stats(user_id=user["user_id"]),
        }

    @router.get("/api/sites/{site_id}/cases/roi-preview")
    def preview_case_roi(
        site_id: str,
        patient_id: str,
        visit_date: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> list[dict[str, Any]]:
        require_validation_permission(user)
        site_store = require_site_access(cp, user, site_id)
        workflow = get_workflow(cp)
        image_records = site_store.list_images_for_visit(patient_id, visit_date)
        image_by_path = {image["image_path"]: image for image in image_records}
        try:
            previews = workflow.preview_case_roi(site_store, patient_id, visit_date)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"ROI preview is unavailable: {exc}",
            ) from exc

        return [
            {
                "patient_id": item["patient_id"],
                "visit_date": item["visit_date"],
                "image_id": image_by_path.get(item["source_image_path"], {}).get("image_id"),
                "view": item.get("view"),
                "is_representative": bool(item.get("is_representative")),
                "source_image_path": item.get("source_image_path"),
                "has_roi_crop": bool(item.get("roi_crop_path")),
                "has_medsam_mask": bool(item.get("medsam_mask_path")),
                "backend": item.get("backend", "unknown"),
            }
            for item in previews
        ]

    @router.get("/api/sites/{site_id}/cases/roi-preview/artifacts/{artifact_kind}")
    def get_case_roi_preview_artifact(
        site_id: str,
        artifact_kind: str,
        patient_id: str,
        visit_date: str,
        image_id: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> FileResponse:
        require_validation_permission(user)
        site_store = require_site_access(cp, user, site_id)
        workflow = get_workflow(cp)
        image = site_store.get_image(image_id)
        if image is None or image.get("patient_id") != patient_id or image.get("visit_date") != visit_date:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found for this case.")

        try:
            previews = workflow.preview_case_roi(site_store, patient_id, visit_date)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"ROI preview is unavailable: {exc}",
            ) from exc

        preview = next((item for item in previews if item.get("source_image_path") == image.get("image_path")), None)
        if preview is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ROI preview record not found.")

        artifact_key = {
            "roi_crop": "roi_crop_path",
            "medsam_mask": "medsam_mask_path",
        }.get(artifact_kind)
        if artifact_key is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown ROI preview artifact.")

        artifact_path_value = preview.get(artifact_key)
        if not artifact_path_value:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Requested ROI artifact is not available.")

        artifact_path = Path(str(artifact_path_value)).resolve()
        try:
            artifact_path.relative_to(site_store.site_dir.resolve())
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artifact is outside the site workspace.") from exc
        if not artifact_path.exists():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artifact file not found on disk.")

        media_type = mimetypes.guess_type(artifact_path.name)[0] or "application/octet-stream"
        return FileResponse(path=artifact_path, media_type=media_type, filename=artifact_path.name)

    @router.get("/api/sites/{site_id}/cases/lesion-preview")
    def preview_case_lesion(
        site_id: str,
        patient_id: str,
        visit_date: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> list[dict[str, Any]]:
        require_validation_permission(user)
        site_store = require_site_access(cp, user, site_id)
        workflow = get_workflow(cp)
        image_records = site_store.list_images_for_visit(patient_id, visit_date)
        image_by_path = {image["image_path"]: image for image in image_records}
        try:
            previews = workflow.preview_case_lesion(site_store, patient_id, visit_date)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Lesion preview is unavailable: {exc}",
            ) from exc

        return [
            {
                "patient_id": item["patient_id"],
                "visit_date": item["visit_date"],
                "image_id": image_by_path.get(item["source_image_path"], {}).get("image_id"),
                "view": item.get("view"),
                "is_representative": bool(item.get("is_representative")),
                "source_image_path": item.get("source_image_path"),
                "has_lesion_crop": bool(item.get("lesion_crop_path")),
                "has_lesion_mask": bool(item.get("lesion_mask_path")),
                "backend": item.get("backend", "unknown"),
                "lesion_prompt_box": item.get("lesion_prompt_box"),
            }
            for item in previews
        ]

    @router.get("/api/sites/{site_id}/cases/lesion-preview/stored")
    def list_stored_case_lesion_previews(
        site_id: str,
        patient_id: str,
        visit_date: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> list[dict[str, Any]]:
        require_validation_permission(user)
        site_store = require_site_access(cp, user, site_id)
        image_records = site_store.list_images_for_visit(patient_id, visit_date)
        if not image_records:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"No images found for patient {patient_id} / {visit_date}.")

        previews = []
        for image in image_records:
            prompt_box = image.get("lesion_prompt_box")
            if not isinstance(prompt_box, dict):
                continue
            lesion = load_stored_lesion_crop(site_store, image)
            previews.append(
                {
                    "patient_id": patient_id,
                    "visit_date": visit_date,
                    "image_id": image.get("image_id"),
                    "view": image.get("view"),
                    "is_representative": bool(image.get("is_representative")),
                    "source_image_path": image.get("image_path"),
                    "has_lesion_crop": bool(lesion and lesion.get("lesion_crop_path")),
                    "has_lesion_mask": bool(lesion and lesion.get("lesion_mask_path")),
                    "backend": lesion.get("backend", "unknown") if lesion else "unknown",
                    "lesion_prompt_box": prompt_box,
                    "prompt_signature": lesion.get("prompt_signature") if lesion else lesion_prompt_box_signature(prompt_box),
                }
            )

        return previews

    @router.get("/api/sites/{site_id}/cases/lesion-preview/artifacts/{artifact_kind}")
    def get_case_lesion_preview_artifact(
        site_id: str,
        artifact_kind: str,
        patient_id: str,
        visit_date: str,
        image_id: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> FileResponse:
        require_validation_permission(user)
        site_store = require_site_access(cp, user, site_id)
        image = site_store.get_image(image_id)
        if image is None or image.get("patient_id") != patient_id or image.get("visit_date") != visit_date:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found for this case.")

        preview = load_stored_lesion_crop(site_store, image)
        if preview is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lesion preview record not found.")

        artifact_key = {
            "lesion_crop": "lesion_crop_path",
            "lesion_mask": "lesion_mask_path",
        }.get(artifact_kind)
        if artifact_key is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown lesion preview artifact.")

        artifact_path_value = preview.get(artifact_key)
        if not artifact_path_value:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Requested lesion artifact is not available.")

        artifact_path = Path(str(artifact_path_value)).resolve()
        try:
            artifact_path.relative_to(site_store.site_dir.resolve())
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artifact is outside the site workspace.") from exc
        if not artifact_path.exists():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artifact file not found on disk.")

        media_type = mimetypes.guess_type(artifact_path.name)[0] or "application/octet-stream"
        return FileResponse(path=artifact_path, media_type=media_type, filename=artifact_path.name)

    @router.get("/api/sites/{site_id}/cases/history")
    def get_case_history(
        site_id: str,
        patient_id: str,
        visit_date: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        site_store = require_site_access(cp, user, site_id)
        return site_store.load_case_history(patient_id, visit_date)

    @router.get("/api/sites/{site_id}/patients/{patient_reference_id}/trajectory")
    def get_patient_trajectory(
        site_id: str,
        patient_reference_id: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        if not cp.user_can_access_site(user, site_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this site.")
        return build_patient_trajectory(cp, site_id, patient_reference_id)

    @router.post("/api/sites/{site_id}/cases/research-registry")
    def update_case_research_registry(
        site_id: str,
        payload: CaseResearchRegistryRequest,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        site_store = require_site_access(cp, user, site_id)
        require_visit_write_access(site_store, user, payload.patient_id, payload.visit_date)
        visit = site_store.get_visit(payload.patient_id, payload.visit_date)
        if visit is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Visit not found.")
        case_summary = next(
            (
                item
                for item in site_store.list_case_summaries()
                if item.get("patient_id") == payload.patient_id and item.get("visit_date") == payload.visit_date
            ),
            None,
        )
        if case_summary is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Case summary not found.")

        action = payload.action.strip().lower()
        if action not in {"include", "exclude"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid research registry action.")

        site_record = cp.get_site(site_id) or {}
        if action == "include":
            if not bool(site_record.get("research_registry_enabled", True)):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="This site's research registry is disabled by the institution.",
                )
            if cp.get_registry_consent(user["user_id"], site_id) is None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Join the research registry before including this case.",
                )
            if int(case_summary.get("image_count") or 0) <= 0:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one image is required.")
            next_status = "included"
        else:
            next_status = "excluded"

        updated_visit = site_store.update_visit_registry_status(
            payload.patient_id,
            payload.visit_date,
            status_value=next_status,
            updated_by_user_id=user["user_id"],
            source=payload.source,
        )
        return {
            "patient_id": payload.patient_id,
            "visit_date": payload.visit_date,
            "research_registry_status": updated_visit.get("research_registry_status", next_status),
            "research_registry_updated_at": updated_visit.get("research_registry_updated_at"),
            "research_registry_updated_by": updated_visit.get("research_registry_updated_by"),
            "research_registry_source": updated_visit.get("research_registry_source"),
        }

    @router.get("/api/sites/{site_id}/validations/{validation_id}/artifacts/{artifact_kind}")
    def get_validation_artifact(
        site_id: str,
        validation_id: str,
        artifact_kind: str,
        patient_id: str,
        visit_date: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> FileResponse:
        site_store = require_site_access(cp, user, site_id)
        validation_run = next(
            (item for item in cp.list_validation_runs(site_id=site_id) if item.get("validation_id") == validation_id),
            None,
        )
        if validation_run is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Validation run not found.")

        case_reference_id = cp.case_reference_id(site_id, patient_id, visit_date)
        case_prediction = next(
            (
                item
                for item in cp.load_case_predictions(validation_id)
                if item.get("case_reference_id") == case_reference_id
                or (item.get("patient_id") == patient_id and item.get("visit_date") == visit_date)
            ),
            None,
        )
        if case_prediction is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Validation case prediction not found.")

        artifact_key = {
            "gradcam": "gradcam_path",
            "roi_crop": "roi_crop_path",
            "medsam_mask": "medsam_mask_path",
            "lesion_crop": "lesion_crop_path",
            "lesion_mask": "lesion_mask_path",
        }.get(artifact_kind)
        if artifact_key is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown validation artifact.")

        artifact_path_value = case_prediction.get(artifact_key)
        if not artifact_path_value:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Requested artifact is not available.")

        artifact_path = Path(str(artifact_path_value)).resolve()
        try:
            artifact_path.relative_to(site_store.site_dir.resolve())
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artifact is outside the site workspace.") from exc
        if not artifact_path.exists():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artifact file not found on disk.")

        media_type = mimetypes.guess_type(artifact_path.name)[0] or "application/octet-stream"
        return FileResponse(path=artifact_path, media_type=media_type, filename=artifact_path.name)

    @router.get("/api/sites/{site_id}/manifest.csv")
    def export_manifest_csv(
        site_id: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> Response:
        site_store = require_site_access(cp, user, site_id)
        manifest_df = site_store.generate_manifest()
        csv_content = manifest_df.to_csv(index=False)
        return Response(
            content=csv_content,
            media_type="text/csv",
            headers={
                "Content-Disposition": f'attachment; filename=\"{site_id}_dataset_manifest.csv\"',
            },
        )

    return router
