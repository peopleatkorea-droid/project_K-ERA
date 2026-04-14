import os
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Response, status
from fastapi.responses import PlainTextResponse

from kera_research.api.models import (
    FederatedRetrievalSyncRequest,
    LocalControlPlaneNodeCredentialsRequest,
    LocalControlPlaneNodeRegisterRequest,
    LocalControlPlaneSmokeRequest,
)
from kera_research.services.data_plane import SiteStore
from kera_research.services.control_plane_direct_registration import (
    direct_control_plane_registration_supported,
    register_main_admin_node_via_direct_db,
)


def build_desktop_router(support: Any) -> APIRouter:
    router = APIRouter()

    get_control_plane = support.get_control_plane
    google_client_ids = support.google_client_ids
    desktop_self_check = support.desktop_self_check
    build_health_report = support.build_health_report
    build_readiness_report = support.build_readiness_report
    build_liveness_report = support.build_liveness_report
    render_metrics = support.render_metrics
    secrets_manager = support.secrets_manager
    database_topology = support.database_topology
    remote_node_os_info = support.remote_node_os_info
    local_control_plane_dev_auth_enabled = support.local_control_plane_dev_auth_enabled
    case_reference_salt_fingerprint = support.case_reference_salt_fingerprint
    make_id = support.make_id
    get_app_version = support.get_app_version
    queue_case_embedding_refresh = support.queue_case_embedding_refresh
    queue_ai_clinic_vector_index_rebuild = support.queue_ai_clinic_vector_index_rebuild
    queue_federated_retrieval_corpus_sync = support.queue_federated_retrieval_corpus_sync
    RemoteControlPlaneClient = support.RemoteControlPlaneClient

    def _require_desktop_runtime_owner(control_plane_owner: str | None) -> None:
        expected_owner = str(os.getenv("KERA_RUNTIME_OWNER") or "").strip()
        provided_owner = str(control_plane_owner or "").strip()
        if not expected_owner or provided_owner != expected_owner:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Desktop runtime owner header is invalid.",
            )

    @router.get("/api/health")
    def health(response: Response, cp=Depends(get_control_plane)) -> dict[str, Any]:
        payload = build_health_report(cp)
        if str(payload.get("status") or "").strip().lower() == "error":
            response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return payload

    @router.get("/api/live")
    def live() -> dict[str, Any]:
        return build_liveness_report()

    @router.get("/api/ready")
    def ready(response: Response, cp=Depends(get_control_plane)) -> dict[str, Any]:
        payload = build_readiness_report(cp)
        if not bool(payload.get("ready")):
            response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return payload

    @router.get("/api/metrics", response_class=PlainTextResponse)
    def metrics() -> PlainTextResponse:
        return PlainTextResponse(render_metrics(), media_type="text/plain; version=0.0.4; charset=utf-8")

    @router.get("/api/desktop/self-check")
    def get_desktop_self_check(cp=Depends(get_control_plane)) -> dict[str, Any]:
        return desktop_self_check(cp)

    @router.post("/api/desktop/internal/sites/{site_id}/cases/{patient_id}/visits/{visit_date}/ai-clinic/embeddings/queue")
    def queue_desktop_case_embedding_refresh(
        site_id: str,
        patient_id: str,
        visit_date: str,
        trigger: str = "desktop_local_mutation",
        control_plane_owner: str | None = Header(default=None, alias="x-kera-control-plane-owner"),
        cp=Depends(get_control_plane),
    ) -> dict[str, Any]:
        _require_desktop_runtime_owner(control_plane_owner)
        try:
            site_store = SiteStore(site_id)
        except OSError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Configured storage root for site {site_id} is inaccessible: {exc}",
            ) from exc
        queue_case_embedding_refresh(
            cp,
            site_store,
            patient_id=patient_id,
            visit_date=visit_date,
            trigger=trigger,
        )
        return {
            "site_id": site_id,
            "patient_id": patient_id,
            "visit_date": visit_date,
            "queued": True,
            "trigger": trigger,
        }

    @router.post("/api/desktop/internal/sites/{site_id}/ai-clinic/vector-index/queue")
    def queue_desktop_ai_clinic_vector_index_rebuild(
        site_id: str,
        trigger: str = "desktop_local_mutation",
        control_plane_owner: str | None = Header(default=None, alias="x-kera-control-plane-owner"),
        cp=Depends(get_control_plane),
    ) -> dict[str, Any]:
        _require_desktop_runtime_owner(control_plane_owner)
        try:
            site_store = SiteStore(site_id)
        except OSError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Configured storage root for site {site_id} is inaccessible: {exc}",
            ) from exc
        return queue_ai_clinic_vector_index_rebuild(
            cp,
            site_store,
            trigger=trigger,
        )

    @router.post("/api/desktop/internal/sites/{site_id}/ai-clinic/retrieval-corpus/queue")
    def queue_desktop_federated_retrieval_corpus_sync(
        site_id: str,
        payload: FederatedRetrievalSyncRequest,
        trigger: str = "desktop_local_mutation",
        control_plane_owner: str | None = Header(default=None, alias="x-kera-control-plane-owner"),
        cp=Depends(get_control_plane),
    ) -> dict[str, Any]:
        _require_desktop_runtime_owner(control_plane_owner)
        try:
            site_store = SiteStore(site_id)
        except OSError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Configured storage root for site {site_id} is inaccessible: {exc}",
            ) from exc
        return queue_federated_retrieval_corpus_sync(
            cp,
            site_store,
            trigger=trigger,
            retrieval_profile=payload.retrieval_profile,
        )

    @router.get("/api/control-plane/node/status")
    def local_control_plane_node_status(
        refresh: bool = False,
        cp=Depends(get_control_plane),
    ) -> dict[str, Any]:
        cp.reload_remote_control_plane_credentials()
        bootstrap = cp.remote_bootstrap_state(force_refresh=bool(refresh))
        current_release = cp.current_global_model()
        credential_status = secrets_manager.node_credentials_status()
        return {
            "control_plane": {
                "configured": cp.remote_control_plane_enabled(),
                "node_sync_enabled": cp.remote_node_sync_enabled(),
                "base_url": cp.remote_control_plane.base_url,
                "node_id": cp.remote_control_plane.node_id,
            },
            "credentials": credential_status,
            "stored_credentials_present": secrets_manager.load_node_credentials() is not None,
            "database_topology": database_topology,
            "bootstrap": bootstrap,
            "current_release": current_release,
        }

    @router.post("/api/control-plane/node/credentials")
    def persist_local_control_plane_node_credentials(
        payload: LocalControlPlaneNodeCredentialsRequest,
        cp=Depends(get_control_plane),
    ) -> dict[str, Any]:
        existing = secrets_manager.load_node_credentials()
        if existing is not None and not payload.overwrite:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Node credentials are already configured. Pass overwrite=true to replace them.",
            )
        secrets_manager.save_node_credentials(
            control_plane_base_url=payload.control_plane_base_url,
            node_id=payload.node_id,
            node_token=payload.node_token,
            site_id=payload.site_id,
        )
        cp.clear_remote_control_plane_state()
        cp.reload_remote_control_plane_credentials()
        bootstrap = cp.remote_bootstrap_state(force_refresh=True)
        if bootstrap is not None:
            local_current_model = cp.local_current_model() or {}
            cp.record_remote_node_heartbeat(
                app_version=get_app_version(),
                os_info=remote_node_os_info(),
                status="credentials_saved",
                current_model_version_id=str(local_current_model.get("version_id") or ""),
                current_model_version_name=str(local_current_model.get("version_name") or ""),
            )
        return {
            "saved": True,
            "credentials": secrets_manager.node_credentials_status(),
            "bootstrap": bootstrap,
        }

    @router.delete("/api/control-plane/node/credentials")
    def clear_local_control_plane_node_credentials(cp=Depends(get_control_plane)) -> dict[str, Any]:
        secrets_manager.clear_node_credentials()
        cp.clear_remote_control_plane_state()
        return {
            "cleared": True,
            "credentials": secrets_manager.node_credentials_status(),
        }

    @router.post("/api/control-plane/node/register")
    def register_local_control_plane_node(
        payload: LocalControlPlaneNodeRegisterRequest,
        cp=Depends(get_control_plane),
    ) -> dict[str, Any]:
        existing = secrets_manager.load_node_credentials()
        if existing is not None and not payload.overwrite:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Node credentials are already configured. Pass overwrite=true to replace them.",
            )

        client = RemoteControlPlaneClient(
            base_url=payload.control_plane_base_url,
            node_id="",
            node_token="",
        )
        try:
            registration_args = {
                "user_bearer_token": payload.control_plane_user_token,
                "device_name": payload.device_name,
                "os_info": payload.os_info or remote_node_os_info(),
                "app_version": payload.app_version or get_app_version(),
                "site_id": payload.site_id,
                "display_name": payload.display_name,
                "hospital_name": payload.hospital_name,
                "source_institution_id": payload.source_institution_id,
            }
            if payload.registration_source == "main_admin":
                try:
                    registration = client.register_main_admin_node(**registration_args)
                except Exception:
                    if not direct_control_plane_registration_supported():
                        raise
                    registration = register_main_admin_node_via_direct_db(
                        remote_client=client,
                        **registration_args,
                    )
            else:
                registration = client.register_node(**registration_args)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Control plane node registration failed: {exc}",
            ) from exc

        node_id = str(registration.get("node_id") or "").strip()
        node_token = str(registration.get("node_token") or "").strip()
        if not node_id or not node_token:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Control plane node registration did not return node credentials.",
            )
        secrets_manager.save_node_credentials(
            control_plane_base_url=client.base_url,
            node_id=node_id,
            node_token=node_token,
            site_id=(
                str(
                    payload.site_id
                    or registration.get("site_id")
                    or registration.get("bootstrap", {}).get("site", {}).get("site_id")
                    or ""
                ).strip()
                or None
            ),
        )
        cp.clear_remote_control_plane_state()
        cp.reload_remote_control_plane_credentials()
        bootstrap = cp.remote_bootstrap_state(force_refresh=True)
        local_current_model = cp.local_current_model() or {}
        cp.record_remote_node_heartbeat(
            app_version=payload.app_version or get_app_version(),
            os_info=payload.os_info or remote_node_os_info(),
            status="registered",
            current_model_version_id=str(local_current_model.get("version_id") or ""),
            current_model_version_name=str(local_current_model.get("version_name") or ""),
        )
        return {
            "registered": True,
            "node_id": node_id,
            "node_token": node_token,
            "bootstrap": bootstrap,
            "credentials": secrets_manager.node_credentials_status(),
        }

    @router.post("/api/dev/control-plane/smoke")
    def smoke_remote_control_plane(
        payload: LocalControlPlaneSmokeRequest,
        cp=Depends(get_control_plane),
    ) -> dict[str, Any]:
        if not local_control_plane_dev_auth_enabled():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Local control-plane smoke routes are disabled.",
            )
        if not cp.remote_node_sync_enabled():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Node credentials are not configured for remote control-plane sync.",
            )

        bootstrap = cp.remote_bootstrap_state(force_refresh=True)
        if not isinstance(bootstrap, dict):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Control plane bootstrap is unavailable.",
            )
        current_model = cp.current_global_model()
        if current_model is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="No current model release is available from the control plane.",
            )

        site = bootstrap.get("site") if isinstance(bootstrap.get("site"), dict) else {}
        project = bootstrap.get("project") if isinstance(bootstrap.get("project"), dict) else {}
        site_id = str(site.get("site_id") or "").strip()
        project_id = str(project.get("project_id") or "project_default").strip() or "project_default"
        if not site_id:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Bootstrap did not include an active site.",
            )

        suffix = str(payload.update_suffix or "").strip() or make_id("smoke")[-8:]
        update_record = cp.register_model_update(
            {
                "update_id": f"update_smoke_{suffix}",
                "site_id": site_id,
                "base_model_version_id": current_model.get("version_id"),
                "model_version_id": current_model.get("version_id"),
                "version_name": current_model.get("version_name"),
                "architecture": current_model.get("architecture"),
                "upload_type": "weight delta",
                "status": "pending_upload",
                "n_cases": 1,
                "n_images": 1,
                "delta_l2_norm": 0.0,
                "case_reference_id": f"case_ref_smoke_{suffix}",
                "patient_reference_id": f"patient_ref_smoke_{suffix}",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "salt_fingerprint": case_reference_salt_fingerprint,
                "artifact_distribution_status": "metadata_only",
                "artifact_source_provider": "metadata_only",
                "notes": "synthetic smoke-test update",
            }
        )

        validation_id = f"validation_smoke_{suffix}"
        validation_summary = cp.save_validation_run(
            {
                "validation_id": validation_id,
                "project_id": project_id,
                "site_id": site_id,
                "model_version_id": current_model.get("version_id"),
                "model_version": current_model.get("version_name"),
                "model_architecture": current_model.get("architecture"),
                "run_date": datetime.now(timezone.utc).isoformat(),
                "n_cases": 0,
                "n_images": 0,
                "AUROC": None,
                "accuracy": 1.0,
                "sensitivity": None,
                "specificity": None,
                "F1": None,
                "source": "control_plane_smoke",
            },
            [],
        )

        return {
            "status": "ok",
            "steps": [
                "bootstrap",
                "current-release",
                "model-update-upload",
                "validation-upload",
            ],
            "bootstrap": bootstrap,
            "current_release": current_model,
            "model_update": update_record,
            "validation_summary": validation_summary,
        }

    return router
