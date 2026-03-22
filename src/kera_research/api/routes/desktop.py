from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status


def build_desktop_router(support: Any) -> APIRouter:
    router = APIRouter()

    get_control_plane = support.get_control_plane
    google_client_ids = support.google_client_ids
    desktop_self_check = support.desktop_self_check
    load_node_credentials = support.load_node_credentials
    node_credentials_status = support.node_credentials_status
    save_node_credentials = support.save_node_credentials
    clear_node_credentials = support.clear_node_credentials
    database_topology = support.database_topology
    remote_node_os_info = support.remote_node_os_info
    local_control_plane_dev_auth_enabled = support.local_control_plane_dev_auth_enabled
    case_reference_salt_fingerprint = support.case_reference_salt_fingerprint
    make_id = support.make_id
    get_app_version = support.get_app_version
    RemoteControlPlaneClient = support.RemoteControlPlaneClient

    LocalControlPlaneNodeCredentialsRequest = support.LocalControlPlaneNodeCredentialsRequest
    LocalControlPlaneNodeRegisterRequest = support.LocalControlPlaneNodeRegisterRequest
    LocalControlPlaneSmokeRequest = support.LocalControlPlaneSmokeRequest

    @router.get("/api/health")
    def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "service": "kera-api",
            "google_auth_configured": bool(google_client_ids()),
        }

    @router.get("/api/desktop/self-check")
    def get_desktop_self_check(cp=Depends(get_control_plane)) -> dict[str, Any]:
        return desktop_self_check(cp)

    @router.get("/api/control-plane/node/status")
    def local_control_plane_node_status(cp=Depends(get_control_plane)) -> dict[str, Any]:
        cp.reload_remote_control_plane_credentials()
        bootstrap = cp.remote_bootstrap_state()
        current_release = cp.current_global_model()
        credential_status = node_credentials_status()
        return {
            "control_plane": {
                "configured": cp.remote_control_plane_enabled(),
                "node_sync_enabled": cp.remote_node_sync_enabled(),
                "base_url": cp.remote_control_plane.base_url,
                "node_id": cp.remote_control_plane.node_id,
            },
            "credentials": credential_status,
            "stored_credentials_present": load_node_credentials() is not None,
            "database_topology": database_topology,
            "bootstrap": bootstrap,
            "current_release": current_release,
        }

    @router.post("/api/control-plane/node/credentials")
    def persist_local_control_plane_node_credentials(
        payload: LocalControlPlaneNodeCredentialsRequest,
        cp=Depends(get_control_plane),
    ) -> dict[str, Any]:
        existing = load_node_credentials()
        if existing is not None and not payload.overwrite:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Node credentials are already configured. Pass overwrite=true to replace them.",
            )
        save_node_credentials(
            control_plane_base_url=payload.control_plane_base_url,
            node_id=payload.node_id,
            node_token=payload.node_token,
            site_id=payload.site_id,
        )
        cp.clear_remote_control_plane_state()
        cp.reload_remote_control_plane_credentials()
        bootstrap = cp.remote_bootstrap_state(force_refresh=True)
        if bootstrap is not None:
            cp.record_remote_node_heartbeat(
                app_version=get_app_version(),
                os_info=remote_node_os_info(),
                status="credentials_saved",
            )
        return {
            "saved": True,
            "credentials": node_credentials_status(),
            "bootstrap": bootstrap,
        }

    @router.delete("/api/control-plane/node/credentials")
    def clear_local_control_plane_node_credentials(cp=Depends(get_control_plane)) -> dict[str, Any]:
        clear_node_credentials()
        cp.clear_remote_control_plane_state()
        return {
            "cleared": True,
            "credentials": node_credentials_status(),
        }

    @router.post("/api/control-plane/node/register")
    def register_local_control_plane_node(
        payload: LocalControlPlaneNodeRegisterRequest,
        cp=Depends(get_control_plane),
    ) -> dict[str, Any]:
        existing = load_node_credentials()
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
            registration = client.register_node(
                user_bearer_token=payload.control_plane_user_token,
                device_name=payload.device_name,
                os_info=payload.os_info or remote_node_os_info(),
                app_version=payload.app_version or get_app_version(),
                site_id=payload.site_id,
                display_name=payload.display_name,
                hospital_name=payload.hospital_name,
                source_institution_id=payload.source_institution_id,
            )
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
        save_node_credentials(
            control_plane_base_url=client.base_url,
            node_id=node_id,
            node_token=node_token,
            site_id=str(payload.site_id or registration.get("bootstrap", {}).get("site", {}).get("site_id") or "").strip() or None,
        )
        cp.clear_remote_control_plane_state()
        cp.reload_remote_control_plane_credentials()
        bootstrap = cp.remote_bootstrap_state(force_refresh=True)
        cp.record_remote_node_heartbeat(
            app_version=payload.app_version or get_app_version(),
            os_info=payload.os_info or remote_node_os_info(),
            status="registered",
        )
        return {
            "registered": True,
            "node_id": node_id,
            "node_token": node_token,
            "bootstrap": bootstrap,
            "credentials": node_credentials_status(),
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
