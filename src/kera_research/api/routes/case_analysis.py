import mimetypes
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse

from kera_research.api.case_model_versions import (
    resolve_requested_contribution_models as select_requested_contribution_models,
    resolve_requested_model_version as select_requested_model_version,
    serialize_case_artifact_availability,
    serialize_case_model_version,
)
from kera_research.api.routes.case_shared import (
    resolve_case_postmortem_with_response_budget,
    sync_case_artifact_cache_best_effort,
    sync_case_artifact_cache_with_response_budget,
)
from kera_research.services.pipeline_case_support import lesion_prompt_box_signature, load_stored_lesion_crop


def build_case_analysis_router(support: Any) -> APIRouter:
    router = APIRouter()

    get_control_plane = support.get_control_plane
    get_approved_user = support.get_approved_user
    require_site_access = support.require_site_access
    require_validation_permission = support.require_validation_permission
    get_workflow = support.get_workflow
    get_model_version = support.get_model_version
    resolve_execution_device = support.resolve_execution_device
    project_id_for_site = support.project_id_for_site
    make_id = support.make_id

    CaseValidationRequest = support.CaseValidationRequest
    CaseAiClinicRequest = support.CaseAiClinicRequest
    CaseContributionRequest = support.CaseContributionRequest
    CaseValidationCompareRequest = support.CaseValidationCompareRequest

    def build_site_artifact_response(
        site_store: Any,
        artifact_path_value: Any,
        *,
        unavailable_detail: str,
    ) -> FileResponse:
        if not artifact_path_value:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=unavailable_detail)
        artifact_path = Path(str(artifact_path_value)).resolve()
        try:
            artifact_path.relative_to(site_store.site_dir.resolve())
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artifact is outside the site workspace.") from exc
        if not artifact_path.exists():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artifact file not found on disk.")
        media_type = mimetypes.guess_type(artifact_path.name)[0] or "application/octet-stream"
        return FileResponse(path=artifact_path, media_type=media_type, filename=artifact_path.name)

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
            model_version = select_requested_model_version(
                cp,
                get_model_version=get_model_version,
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
        sync_case_artifact_cache_with_response_budget(
            workflow,
            site_store,
            patient_id=payload.patient_id,
            visit_date=payload.visit_date,
        )

        case_prediction = case_predictions[0] if case_predictions else None
        post_mortem = None
        if case_prediction is not None and summary.get("validation_mode") != "inference_only":
            case_reference_id = (
                str(case_prediction.get("case_reference_id") or "").strip()
                or cp.case_reference_id(site_id, payload.patient_id, payload.visit_date)
            )
            classification_context = {
                "validation_id": summary.get("validation_id"),
                "run_date": summary.get("run_date"),
                "model_version_id": summary.get("model_version_id"),
                "model_version": summary.get("model_version"),
                "predicted_label": case_prediction.get("predicted_label"),
                "true_label": case_prediction.get("true_label"),
                "prediction_probability": case_prediction.get("prediction_probability"),
                "is_correct": case_prediction.get("is_correct"),
            }
            post_mortem = resolve_case_postmortem_with_response_budget(
                workflow,
                site_store,
                cp,
                patient_id=payload.patient_id,
                visit_date=payload.visit_date,
                model_version=model_version,
                execution_device=execution_device,
                summary=summary,
                classification_context=classification_context,
                case_prediction=case_prediction,
                case_reference_id=case_reference_id,
            )
        return {
            "summary": summary,
            "case_prediction": case_prediction,
            "model_version": serialize_case_model_version(model_version),
            "execution_device": execution_device,
            "artifact_availability": serialize_case_artifact_availability(case_prediction),
            "post_mortem": post_mortem,
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
                        "model_version": serialize_case_model_version(model_version),
                        "artifact_availability": serialize_case_artifact_availability(case_prediction),
                    }
                )
            except Exception as exc:
                comparisons.append(
                    {
                        "model_version": serialize_case_model_version(model_version),
                        "error": str(exc),
                    }
                )
        if any(item.get("summary") for item in comparisons):
            sync_case_artifact_cache_with_response_budget(
                workflow,
                site_store,
                patient_id=payload.patient_id,
                visit_date=payload.visit_date,
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
            model_version = select_requested_model_version(
                cp,
                get_model_version=get_model_version,
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
            result = workflow.run_ai_clinic_report(
                site_store,
                patient_id=payload.patient_id,
                visit_date=payload.visit_date,
                model_version=model_version,
                execution_device=execution_device,
                top_k=payload.top_k,
                retrieval_backend=payload.retrieval_backend,
                retrieval_profile=payload.retrieval_profile,
            )
            sync_case_artifact_cache_with_response_budget(
                workflow,
                site_store,
                patient_id=payload.patient_id,
                visit_date=payload.visit_date,
            )
            return {
                **result,
                "analysis_stage": "expanded",
            }
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"AI Clinic retrieval is unavailable: {exc}",
            ) from exc

    @router.post("/api/sites/{site_id}/cases/ai-clinic/similar-cases")
    def run_case_ai_clinic_similar_cases(
        site_id: str,
        payload: CaseAiClinicRequest,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_validation_permission(user)
        site_store = require_site_access(cp, user, site_id)
        workflow = get_workflow(cp)
        try:
            model_version = select_requested_model_version(
                cp,
                get_model_version=get_model_version,
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
            result = workflow.run_ai_clinic_similar_cases(
                site_store,
                patient_id=payload.patient_id,
                visit_date=payload.visit_date,
                model_version=model_version,
                execution_device=execution_device,
                top_k=payload.top_k,
                retrieval_backend=payload.retrieval_backend,
                retrieval_profile=payload.retrieval_profile,
            )
            sync_case_artifact_cache_with_response_budget(
                workflow,
                site_store,
                patient_id=payload.patient_id,
                visit_date=payload.visit_date,
            )
            return {
                **result,
                "analysis_stage": "similar_cases",
                "text_retrieval_mode": None,
                "text_embedding_model": None,
                "eligible_text_count": 0,
                "text_evidence": [],
                "text_retrieval_error": None,
                "classification_context": None,
                "differential": None,
                "workflow_recommendation": None,
            }
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

        try:
            policy_state = site_store.case_research_policy_state(payload.patient_id, payload.visit_date)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        visit_status = str(policy_state.get("visit_status") or "active")
        if cp.get_registry_consent(user["user_id"], site_id) is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Join the research registry before contributing this case.",
            )

        try:
            contribution_models = select_requested_contribution_models(
                cp,
                get_model_version=get_model_version,
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
                        user_public_alias=str(user.get("public_alias") or "").strip() or None,
                        contribution_group_id=contribution_group_id,
                        registry_consent_granted=True,
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
        sync_case_artifact_cache_best_effort(
            workflow,
            site_store,
            patient_id=payload.patient_id,
            visit_date=payload.visit_date,
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
        sync_case_artifact_cache_best_effort(
            workflow,
            site_store,
            patient_id=patient_id,
            visit_date=visit_date,
        )

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

        return build_site_artifact_response(
            site_store,
            preview.get(artifact_key),
            unavailable_detail="Requested ROI artifact is not available.",
        )

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
        sync_case_artifact_cache_best_effort(
            workflow,
            site_store,
            patient_id=patient_id,
            visit_date=visit_date,
        )

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

        return build_site_artifact_response(
            site_store,
            preview.get(artifact_key),
            unavailable_detail="Requested lesion artifact is not available.",
        )

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
            "gradcam_cornea": "gradcam_cornea_path",
            "gradcam_lesion": "gradcam_lesion_path",
            "roi_crop": "roi_crop_path",
            "medsam_mask": "medsam_mask_path",
            "lesion_crop": "lesion_crop_path",
            "lesion_mask": "lesion_mask_path",
        }.get(artifact_kind)
        if artifact_key is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown validation artifact.")

        return build_site_artifact_response(
            site_store,
            case_prediction.get(artifact_key),
            unavailable_detail="Requested artifact is not available.",
        )

    return router
