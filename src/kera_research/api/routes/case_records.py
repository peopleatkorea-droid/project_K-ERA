from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi.responses import Response

from kera_research.api.control_plane_proxy import site_record_for_request
from kera_research.db import DATABASE_TOPOLOGY
from kera_research.api.routes.case_shared import (
    CaseResearchRegistryRequest,
    private_json_response,
    schedule_image_derivative_backfill,
)
from kera_research.api.routes.workspace_visibility import filter_visible_workspace_visits


def build_case_records_router(support: Any) -> APIRouter:
    router = APIRouter()

    def local_only_split_mode() -> bool:
        return (
            bool(DATABASE_TOPOLOGY.get("control_plane_split_enabled"))
            and str(DATABASE_TOPOLOGY.get("control_plane_connection_mode") or "").strip().lower() != "remote_api_cache"
            and bool(tuple(DATABASE_TOPOLOGY.get("split_database_env_names") or ()))
        )

    get_control_plane = support.get_control_plane
    get_approved_user = support.get_approved_user
    require_site_access = support.require_site_access
    user_can_access_site = support.user_can_access_site
    require_validation_permission = support.require_validation_permission
    require_visit_write_access = support.require_visit_write_access
    require_record_owner = support.require_record_owner
    build_patient_trajectory = support.build_patient_trajectory
    queue_case_embedding_refresh = support.queue_case_embedding_refresh
    queue_ai_clinic_vector_index_rebuild = support.queue_ai_clinic_vector_index_rebuild
    queue_federated_retrieval_corpus_sync = support.queue_federated_retrieval_corpus_sync

    PatientCreateRequest = support.PatientCreateRequest
    PatientUpdateRequest = support.PatientUpdateRequest
    VisitCreateRequest = support.VisitCreateRequest

    def _visible_workspace_visits(visits: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return filter_visible_workspace_visits(visits)

    def _visible_workspace_lookup(site_store: Any, patient_id: str) -> dict[str, Any]:
        lookup = site_store.lookup_patient_id(patient_id)
        normalized_patient_id = str(lookup.get("normalized_patient_id") or "").strip()
        visible_cases = (
            site_store.list_case_summaries(patient_id=normalized_patient_id)
            if normalized_patient_id
            else []
        )
        latest_visit_date = None
        if visible_cases:
            latest_visit_date = str(visible_cases[0].get("visit_date") or "").strip() or None
        return {
            **lookup,
            "visit_count": len(visible_cases),
            "image_count": sum(int(item.get("image_count") or 0) for item in visible_cases),
            "latest_visit_date": latest_visit_date,
        }

    @router.get("/api/sites/{site_id}/cases")
    def list_cases(
        site_id: str,
        mine: bool = False,
        patient_id: str | None = None,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> Response:
        site_store = require_site_access(cp, user, site_id)
        created_by_user_id = user["user_id"] if mine else None
        payload = site_store.list_case_summaries(
            created_by_user_id=created_by_user_id,
            patient_id=patient_id,
        )
        schedule_image_derivative_backfill(
            site_store,
            [str(item.get("representative_image_id") or "").strip() for item in payload],
        )
        return private_json_response(payload, max_age=1)

    @router.get("/api/sites/{site_id}/model-versions")
    def list_site_model_versions(
        site_id: str,
        ready_only: bool = True,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> list[dict[str, Any]]:
        require_validation_permission(user)
        require_site_access(cp, user, site_id)
        if local_only_split_mode():
            return []
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
        return site_store.list_visible_workspace_patients(
            created_by_user_id=created_by_user_id,
        )

    @router.get("/api/sites/{site_id}/patients/lookup")
    def lookup_patient_id(
        site_id: str,
        patient_id: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        site_store = require_site_access(cp, user, site_id)
        try:
            return _visible_workspace_lookup(site_store, patient_id)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.get("/api/sites/{site_id}/patients/list-board")
    def list_patient_rows(
        site_id: str,
        q: str | None = None,
        mine: bool = False,
        page: int = 1,
        page_size: int = 25,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> Response:
        if page < 1:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="page must be at least 1.")
        if page_size < 1 or page_size > 100:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="page_size must be between 1 and 100.")
        site_store = require_site_access(cp, user, site_id)
        created_by_user_id = user["user_id"] if mine else None
        payload = site_store.list_patient_case_rows(
            created_by_user_id=created_by_user_id,
            search=q,
            page=page,
            page_size=page_size,
        )
        representative_image_ids = [
            str(item.get("image_id") or "").strip()
            for row in payload.get("items", [])
            for item in row.get("representative_thumbnails", [])
        ]
        schedule_image_derivative_backfill(site_store, representative_image_ids)
        return private_json_response(payload, max_age=1)

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

    @router.patch("/api/sites/{site_id}/patients")
    def update_patient(
        site_id: str,
        patient_id: str,
        payload: PatientUpdateRequest,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        site_store = require_site_access(cp, user, site_id)
        try:
            lookup = site_store.lookup_patient_id(patient_id)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        patient = lookup.get("patient") if isinstance(lookup, dict) else None
        if patient is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found.")
        require_record_owner(
            user,
            str(patient.get("created_by_user_id") or "").strip() or None,
            detail="Only the creator or a site admin can modify this patient.",
        )
        try:
            return site_store.update_patient(
                patient_id=str(patient.get("patient_id") or patient_id),
                sex=payload.sex,
                age=payload.age,
                chart_alias=payload.chart_alias,
                local_case_code=payload.local_case_code,
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
            return _visible_workspace_visits(site_store.list_visits_for_patient(patient_id))
        return _visible_workspace_visits(site_store.list_visits())

    @router.post("/api/sites/{site_id}/visits")
    def create_visit(
        site_id: str,
        payload: VisitCreateRequest,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        site_store = require_site_access(cp, user, site_id)
        try:
            created_visit = site_store.create_visit(
                patient_id=payload.patient_id,
                visit_date=payload.visit_date,
                actual_visit_date=payload.actual_visit_date,
                culture_status=payload.culture_status,
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
            queue_federated_retrieval_corpus_sync(
                cp,
                site_store,
                trigger="visit_create",
            )
            return created_visit
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
            target_lookup = site_store.lookup_patient_id(payload.patient_id)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        target_patient = target_lookup.get("patient") if isinstance(target_lookup, dict) else None
        if target_patient is not None and str(target_patient.get("patient_id") or "").strip() != str(patient_id).strip():
            require_record_owner(
                user,
                str(target_patient.get("created_by_user_id") or "").strip() or None,
                detail="Only the creator or a site admin can move a visit into this patient.",
            )
        try:
            updated_visit = site_store.update_visit(
                patient_id=patient_id,
                visit_date=visit_date,
                target_patient_id=payload.patient_id,
                target_visit_date=payload.visit_date,
                actual_visit_date=payload.actual_visit_date,
                culture_status=payload.culture_status,
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
            queue_federated_retrieval_corpus_sync(
                cp,
                site_store,
                trigger="visit_update",
            )
            if site_store.list_images_for_visit(payload.patient_id, payload.visit_date):
                queue_case_embedding_refresh(
                    cp,
                    site_store,
                    patient_id=payload.patient_id,
                    visit_date=payload.visit_date,
                    trigger="visit_update",
                )
            return updated_visit
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
            deleted_visit = site_store.delete_visit(patient_id, visit_date)
            queue_federated_retrieval_corpus_sync(
                cp,
                site_store,
                trigger="visit_delete",
            )
            queue_ai_clinic_vector_index_rebuild(
                cp,
                site_store,
                trigger="visit_delete",
            )
            return deleted_visit
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.get("/api/sites/{site_id}/cases/history")
    def get_case_history(
        site_id: str,
        patient_id: str,
        visit_date: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> Response:
        site_store = require_site_access(cp, user, site_id)
        history = site_store.load_case_history(patient_id, visit_date)
        contribution_aliases = cp.list_user_public_aliases(
            [str(item.get("user_id") or "").strip() for item in history.get("contributions", [])]
        )
        history["contributions"] = [
            {
                **item,
                "public_alias": str(item.get("public_alias") or "").strip()
                or contribution_aliases.get(str(item.get("user_id") or "").strip()),
            }
            for item in history.get("contributions", [])
        ]
        return private_json_response(history, max_age=1)

    @router.get("/api/sites/{site_id}/patients/{patient_reference_id}/trajectory")
    def get_patient_trajectory(
        site_id: str,
        patient_reference_id: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        if not user_can_access_site(user, site_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this site.")
        return build_patient_trajectory(cp, site_id, patient_reference_id)

    @router.post("/api/sites/{site_id}/cases/research-registry")
    def update_case_research_registry(
        site_id: str,
        payload: CaseResearchRegistryRequest,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
        authorization: str | None = Header(default=None),
        control_plane_owner: str | None = Header(default=None, alias="x-kera-control-plane-owner"),
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

        site_record = site_record_for_request(
            cp,
            site_id=site_id,
            authorization=authorization,
            control_plane_owner=control_plane_owner,
        ) or {}
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
            try:
                policy_state = site_store.case_research_policy_state(payload.patient_id, payload.visit_date)
            except ValueError as exc:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
            if not policy_state.get("is_positive"):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Only culture-positive cases can be included in the research registry.",
                )
            if not policy_state.get("is_active"):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Only active visits can be included in the research registry.",
                )
            if not policy_state.get("has_images"):
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
        queue_federated_retrieval_corpus_sync(
            cp,
            site_store,
            trigger=f"registry_{action}",
        )
        return {
            "patient_id": payload.patient_id,
            "visit_date": payload.visit_date,
            "research_registry_status": updated_visit.get("research_registry_status", next_status),
            "research_registry_updated_at": updated_visit.get("research_registry_updated_at"),
            "research_registry_updated_by": updated_visit.get("research_registry_updated_by"),
            "research_registry_source": updated_visit.get("research_registry_source"),
        }

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
