from __future__ import annotations

import io
import mimetypes
import os
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import google.auth.transport.requests
import jwt
import pandas as pd
from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from google.oauth2 import id_token as google_id_token
from pydantic import BaseModel, Field

from kera_research.config import MODEL_DIR
from kera_research.domain import DENSENET_VARIANTS, make_id
from kera_research.services.hardware import detect_hardware, resolve_execution_mode
from kera_research.services.control_plane import ControlPlaneStore
from kera_research.services.data_plane import SiteStore
from kera_research.services.pipeline import ResearchWorkflowService
from kera_research.storage import read_json


API_SECRET = os.getenv("KERA_API_SECRET", "dev-secret-change-me")
API_ALGORITHM = "HS256"
TOKEN_TTL_HOURS = 12
GOOGLE_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}
IMPORT_TEMPLATE_ROWS = [
    "patient_id,chart_alias,local_case_code,sex,age,visit_date,culture_confirmed,culture_category,culture_species,"
    "contact_lens_use,predisposing_factor,visit_status,active_stage,smear_result,polymicrobial,other_history,image_filename,view,is_representative",
    "P001,JNUH-001,2026-BK-001,female,45,2026-01-10,TRUE,bacterial,Pseudomonas aeruginosa,"
    "none,trauma,active,TRUE,positive,FALSE,,P001_2026-01-10_white.jpg,white,TRUE",
    "P001,JNUH-001,2026-BK-001,female,45,2026-01-10,TRUE,bacterial,Pseudomonas aeruginosa,"
    "none,trauma,active,TRUE,positive,FALSE,,P001_2026-01-10_slit.jpg,slit,FALSE",
]


def _google_client_id() -> str:
    return (
        os.getenv("KERA_GOOGLE_CLIENT_ID", "").strip()
        or os.getenv("GOOGLE_CLIENT_ID", "").strip()
        or os.getenv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "").strip()
    )


def _create_access_token(user: dict[str, Any]) -> str:
    expires_at = datetime.now(timezone.utc) + timedelta(hours=TOKEN_TTL_HOURS)
    payload = {
        "sub": user["user_id"],
        "username": user["username"],
        "role": user.get("role", "viewer"),
        "site_ids": user.get("site_ids"),
        "approval_status": user.get("approval_status", "approved"),
        "exp": int(expires_at.timestamp()),
    }
    return jwt.encode(payload, API_SECRET, algorithm=API_ALGORITHM)


def _decode_access_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, API_SECRET, algorithms=[API_ALGORITHM])
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token.") from exc


def _verify_google_id_token(id_token: str) -> dict[str, str]:
    client_id = _google_client_id()
    if not client_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google authentication is not configured on the server.",
        )

    try:
        payload = google_id_token.verify_oauth2_token(
            id_token,
            google.auth.transport.requests.Request(),
            client_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google token verification failed.") from exc

    if str(payload.get("iss", "")).strip() not in GOOGLE_ISSUERS:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google token issuer mismatch.")
    if str(payload.get("email_verified", "")).lower() not in {"true", "1"}:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google email is not verified.")

    email = str(payload.get("email", "")).strip().lower()
    if not email:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google account did not return an email.")
    google_sub = str(payload.get("sub", "")).strip()
    if not google_sub:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google account did not return a subject.")

    return {
        "email": email,
        "google_sub": google_sub,
        "name": str(payload.get("name") or payload.get("given_name") or email.split("@")[0]).strip(),
    }


def get_control_plane() -> ControlPlaneStore:
    return ControlPlaneStore()


def get_current_user(
    authorization: str | None = Header(default=None),
    cp: ControlPlaneStore = Depends(get_control_plane),
) -> dict[str, Any]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token.")
    token = authorization.split(" ", 1)[1].strip()
    token_payload = _decode_access_token(token)
    user = cp.get_user_by_id(token_payload["sub"])
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User no longer exists.")
    return user


def get_approved_user(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    if user.get("approval_status") != "approved":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account is not approved yet. Submit an institution request first.",
        )
    return user


def _require_site_access(cp: ControlPlaneStore, user: dict[str, Any], site_id: str) -> SiteStore:
    if not cp.user_can_access_site(user, site_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this site.")
    return SiteStore(site_id)


def _build_auth_response(cp: ControlPlaneStore, user: dict[str, Any]) -> dict[str, Any]:
    normalized = cp.get_user_by_id(user["user_id"]) or user
    token = _create_access_token(normalized)
    return {
        "auth_state": normalized.get("approval_status", "approved"),
        "access_token": token,
        "token_type": "bearer",
        "user": normalized,
    }


def _assert_request_review_permission(cp: ControlPlaneStore, reviewer: dict[str, Any], site_id: str) -> None:
    if reviewer.get("role") == "admin":
        return
    if reviewer.get("role") == "site_admin" and cp.user_can_access_site(reviewer, site_id):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot review requests for this site.")


def _project_id_for_site(cp: ControlPlaneStore, site_id: str) -> str:
    site = next((item for item in cp.list_sites() if item["site_id"] == site_id), None)
    if site:
        return site.get("project_id", "default")
    projects = cp.list_projects()
    return projects[0]["project_id"] if projects else "default"


def _get_workflow(cp: ControlPlaneStore) -> ResearchWorkflowService:
    try:
        return ResearchWorkflowService(cp)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"AI workflow is not available on this server: {exc}",
        ) from exc


def _resolve_execution_device(selection: str) -> str:
    normalized = selection.strip().lower()
    ui_selection = {
        "gpu": "GPU mode",
        "cpu": "CPU mode",
        "auto": "Auto",
    }.get(normalized, "Auto")
    return resolve_execution_mode(ui_selection, detect_hardware())


def _require_validation_permission(user: dict[str, Any]) -> None:
    if user.get("role") in {"admin", "site_admin", "researcher"}:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Validation execution is disabled for viewer accounts.",
    )


def _require_admin_workspace_permission(user: dict[str, Any]) -> None:
    if user.get("role") in {"admin", "site_admin"}:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Admin or site admin access required.",
    )


def _require_platform_admin(user: dict[str, Any]) -> None:
    if user.get("role") == "admin":
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Platform admin access required.",
    )


def _get_model_version(cp: ControlPlaneStore, model_version_id: str | None) -> dict[str, Any] | None:
    if model_version_id:
        return next(
            (item for item in cp.list_model_versions() if item.get("version_id") == model_version_id),
            None,
        )
    return cp.current_global_model()


def _load_cross_validation_reports(site_store: SiteStore) -> list[dict[str, Any]]:
    reports: list[dict[str, Any]] = []
    for report_path in site_store.validation_dir.glob("cv_*.json"):
        report = read_json(report_path, {})
        if isinstance(report, dict) and report.get("cross_validation_id"):
            reports.append(report)
    reports.sort(key=lambda item: item.get("created_at", ""), reverse=True)
    return reports


def _visible_model_updates(
    cp: ControlPlaneStore,
    user: dict[str, Any],
    *,
    site_id: str | None = None,
    status_filter: str | None = None,
) -> list[dict[str, Any]]:
    updates = cp.list_model_updates(site_id=site_id)
    if user.get("role") != "admin":
        accessible_site_ids = {site["site_id"] for site in cp.accessible_sites_for_user(user)}
        updates = [item for item in updates if item.get("site_id") in accessible_site_ids]
    if status_filter:
        updates = [item for item in updates if item.get("status") == status_filter]
    return updates


class LoginRequest(BaseModel):
    username: str
    password: str


class GoogleLoginRequest(BaseModel):
    id_token: str


class AccessRequestCreateRequest(BaseModel):
    requested_site_id: str
    requested_role: str
    message: str = ""


class AccessRequestReviewRequest(BaseModel):
    decision: str
    assigned_role: str | None = None
    assigned_site_id: str | None = None
    reviewer_notes: str = ""


class PatientCreateRequest(BaseModel):
    patient_id: str
    sex: str
    age: int
    chart_alias: str = ""
    local_case_code: str = ""


class VisitCreateRequest(BaseModel):
    patient_id: str
    visit_date: str
    culture_confirmed: bool = True
    culture_category: str
    culture_species: str
    contact_lens_use: str
    predisposing_factor: list[str] = Field(default_factory=list)
    other_history: str = ""
    visit_status: str = "active"
    smear_result: str = ""
    polymicrobial: bool = False


class RepresentativeImageRequest(BaseModel):
    patient_id: str
    visit_date: str
    representative_image_id: str


class CaseValidationRequest(BaseModel):
    patient_id: str
    visit_date: str
    execution_mode: str = "auto"
    generate_gradcam: bool = True
    generate_medsam: bool = True


class CaseContributionRequest(BaseModel):
    patient_id: str
    visit_date: str
    execution_mode: str = "auto"
    model_version_id: str | None = None


class SiteValidationRunRequest(BaseModel):
    execution_mode: str = "auto"
    generate_gradcam: bool = True
    generate_medsam: bool = True
    model_version_id: str | None = None


class InitialTrainingRequest(BaseModel):
    architecture: str = "densenet121"
    execution_mode: str = "auto"
    epochs: int = 30
    learning_rate: float = 1e-4
    batch_size: int = 16
    val_split: float = 0.2
    test_split: float = 0.2
    use_pretrained: bool = True
    regenerate_split: bool = False


class CrossValidationRunRequest(BaseModel):
    architecture: str = "densenet121"
    execution_mode: str = "auto"
    num_folds: int = 5
    epochs: int = 10
    learning_rate: float = 1e-4
    batch_size: int = 16
    val_split: float = 0.2
    use_pretrained: bool = True


class AggregationRunRequest(BaseModel):
    update_ids: list[str] = Field(default_factory=list)
    new_version_name: str | None = None


class ProjectCreateRequest(BaseModel):
    name: str
    description: str = ""


class SiteCreateRequest(BaseModel):
    project_id: str
    site_code: str
    display_name: str
    hospital_name: str = ""


class UserUpsertRequest(BaseModel):
    user_id: str | None = None
    username: str
    full_name: str = ""
    password: str = ""
    role: str = "viewer"
    site_ids: list[str] = Field(default_factory=list)


def _bool_from_value(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    normalized = str(value).strip().lower()
    if normalized in {"1", "true", "yes", "y"}:
        return True
    if normalized in {"0", "false", "no", "n"}:
        return False
    return default


def _coerce_text(value: Any, default: str = "") -> str:
    if value is None:
        return default
    if isinstance(value, float) and pd.isna(value):
        return default
    return str(value).strip()


def _site_comparison_rows(cp: ControlPlaneStore, user: dict[str, Any]) -> list[dict[str, Any]]:
    visible_sites = cp.list_sites() if user.get("role") == "admin" else cp.accessible_sites_for_user(user)
    site_index = {site["site_id"]: site for site in visible_sites}
    runs_by_site: dict[str, list[dict[str, Any]]] = {}
    for run in _site_level_validation_runs(cp.list_validation_runs()):
        site_id = run.get("site_id")
        if site_id in site_index:
            runs_by_site.setdefault(site_id, []).append(run)

    def mean_metric(records: list[dict[str, Any]], key: str) -> float | None:
        values = [float(item[key]) for item in records if item.get(key) is not None]
        if not values:
            return None
        return round(sum(values) / len(values), 4)

    rows: list[dict[str, Any]] = []
    for site_id, site in site_index.items():
        site_runs = runs_by_site.get(site_id, [])
        latest_run = sorted(site_runs, key=lambda item: item.get("run_date", ""), reverse=True)[0] if site_runs else None
        rows.append(
            {
                "site_id": site_id,
                "display_name": site.get("display_name"),
                "hospital_name": site.get("hospital_name"),
                "run_count": len(site_runs),
                "accuracy": mean_metric(site_runs, "accuracy"),
                "sensitivity": mean_metric(site_runs, "sensitivity"),
                "specificity": mean_metric(site_runs, "specificity"),
                "F1": mean_metric(site_runs, "F1"),
                "AUROC": mean_metric(site_runs, "AUROC"),
                "latest_validation_id": latest_run.get("validation_id") if latest_run else None,
                "latest_run_date": latest_run.get("run_date") if latest_run else None,
            }
        )
    rows.sort(key=lambda item: (item.get("accuracy") is not None, item.get("accuracy") or -1), reverse=True)
    return rows


def _validation_case_rows(
    cp: ControlPlaneStore,
    site_store: SiteStore,
    validation_id: str,
    *,
    misclassified_only: bool = False,
    limit: int | None = None,
) -> list[dict[str, Any]]:
    predictions = cp.load_case_predictions(validation_id)
    rows: list[dict[str, Any]] = []
    for prediction in predictions:
        if misclassified_only and prediction.get("is_correct", False):
            continue
        patient_id = str(prediction.get("patient_id") or "").strip()
        visit_date = str(prediction.get("visit_date") or "").strip()
        visit_images = site_store.list_images_for_visit(patient_id, visit_date) if patient_id and visit_date else []
        representative = next((item for item in visit_images if item.get("is_representative")), None)
        if representative is None and visit_images:
            representative = visit_images[0]
        rows.append(
            {
                "validation_id": validation_id,
                "patient_id": patient_id,
                "visit_date": visit_date,
                "true_label": prediction.get("true_label"),
                "predicted_label": prediction.get("predicted_label"),
                "prediction_probability": prediction.get("prediction_probability"),
                "is_correct": bool(prediction.get("is_correct", False)),
                "roi_crop_available": bool(prediction.get("roi_crop_path") and Path(prediction["roi_crop_path"]).exists()),
                "gradcam_available": bool(prediction.get("gradcam_path") and Path(prediction["gradcam_path"]).exists()),
                "medsam_mask_available": bool(prediction.get("medsam_mask_path") and Path(prediction["medsam_mask_path"]).exists()),
                "representative_image_id": representative.get("image_id") if representative else None,
                "representative_view": representative.get("view") if representative else None,
            }
        )
    rows.sort(
        key=lambda item: (item.get("is_correct", False), float(item.get("prediction_probability") or 0.0)),
    )
    if limit is not None and limit >= 0:
        return rows[:limit]
    return rows


def _build_case_history(
    cp: ControlPlaneStore,
    site_id: str,
    patient_id: str,
    visit_date: str,
) -> dict[str, list[dict[str, Any]]]:
    validation_history: list[dict[str, Any]] = []
    for run in cp.list_validation_runs(site_id=site_id):
        case_prediction = next(
            (
                item
                for item in cp.load_case_predictions(run["validation_id"])
                if item.get("patient_id") == patient_id and item.get("visit_date") == visit_date
            ),
            None,
        )
        if case_prediction is None:
            continue
        validation_history.append(
            {
                "validation_id": run.get("validation_id"),
                "run_date": run.get("run_date"),
                "model_version": run.get("model_version"),
                "model_version_id": run.get("model_version_id"),
                "model_architecture": run.get("model_architecture"),
                "run_scope": "case" if run.get("patient_id") == patient_id and run.get("visit_date") == visit_date else "site",
                "predicted_label": case_prediction.get("predicted_label"),
                "true_label": case_prediction.get("true_label"),
                "prediction_probability": case_prediction.get("prediction_probability"),
                "is_correct": case_prediction.get("is_correct"),
            }
        )

    updates_by_id = {
        item["update_id"]: item
        for item in cp.list_model_updates(site_id=site_id)
        if item.get("patient_id") == patient_id and item.get("visit_date") == visit_date
    }
    contribution_history: list[dict[str, Any]] = []
    for item in cp.list_contributions(site_id=site_id):
        if item.get("patient_id") != patient_id or item.get("visit_date") != visit_date:
            continue
        update = updates_by_id.get(item.get("update_id"))
        contribution_history.append(
            {
                "contribution_id": item.get("contribution_id"),
                "created_at": item.get("created_at"),
                "user_id": item.get("user_id"),
                "update_id": item.get("update_id"),
                "update_status": update.get("status") if update else None,
                "upload_type": update.get("upload_type") if update else None,
                "architecture": update.get("architecture") if update else None,
                "execution_device": update.get("execution_device") if update else None,
                "base_model_version_id": update.get("base_model_version_id") if update else None,
            }
        )

    return {
        "validations": validation_history,
        "contributions": contribution_history,
    }


def _build_site_activity(
    cp: ControlPlaneStore,
    site_id: str,
) -> dict[str, Any]:
    validation_runs = cp.list_validation_runs(site_id=site_id)
    contributions = cp.list_contributions(site_id=site_id)
    updates_by_id = {
        item.get("update_id"): item
        for item in cp.list_model_updates(site_id=site_id)
        if item.get("update_id")
    }
    pending_updates = len([item for item in updates_by_id.values() if item.get("status") == "pending_upload"])

    recent_validations = [
        {
            "validation_id": item.get("validation_id"),
            "run_date": item.get("run_date"),
            "model_version": item.get("model_version"),
            "model_architecture": item.get("model_architecture"),
            "n_cases": item.get("n_cases"),
            "n_images": item.get("n_images"),
            "accuracy": item.get("accuracy"),
            "AUROC": item.get("AUROC"),
            "site_id": item.get("site_id"),
        }
        for item in validation_runs[:5]
    ]
    recent_contributions = []
    for item in contributions[:5]:
        update = updates_by_id.get(item.get("update_id"))
        recent_contributions.append(
            {
                "contribution_id": item.get("contribution_id"),
                "created_at": item.get("created_at"),
                "user_id": item.get("user_id"),
                "patient_id": item.get("patient_id"),
                "visit_date": item.get("visit_date"),
                "update_id": item.get("update_id"),
                "update_status": update.get("status") if update else None,
                "upload_type": update.get("upload_type") if update else None,
            }
        )

    return {
        "pending_updates": pending_updates,
        "recent_validations": recent_validations,
        "recent_contributions": recent_contributions,
    }


def _site_level_validation_runs(validation_runs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        run
        for run in validation_runs
        if int(run.get("n_cases", 0) or 0) > 1 or run.get("AUROC") is not None
    ]


def create_app() -> FastAPI:
    app = FastAPI(title="K-ERA Research API", version="0.2.0")

    allowed_origins = [
        origin
        for port in range(3000, 3020)
        for origin in (f"http://localhost:{port}", f"http://127.0.0.1:{port}")
    ]
    extra_origin = os.getenv("KERA_FRONTEND_ORIGIN", "").strip()
    if extra_origin:
        allowed_origins.append(extra_origin)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/health")
    def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "service": "kera-api",
            "google_auth_configured": bool(_google_client_id()),
        }

    @app.get("/api/public/sites")
    def public_sites(cp: ControlPlaneStore = Depends(get_control_plane)) -> list[dict[str, Any]]:
        return cp.list_sites()

    @app.post("/api/auth/login")
    def login(payload: LoginRequest, cp: ControlPlaneStore = Depends(get_control_plane)) -> dict[str, Any]:
        user = cp.authenticate(payload.username.strip().lower(), payload.password)
        if user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials.")
        return _build_auth_response(cp, user)

    @app.post("/api/auth/google")
    def google_login(payload: GoogleLoginRequest, cp: ControlPlaneStore = Depends(get_control_plane)) -> dict[str, Any]:
        identity = _verify_google_id_token(payload.id_token)
        try:
            user = cp.ensure_google_user(identity["google_sub"], identity["email"], identity["name"])
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
        return _build_auth_response(cp, user)

    @app.get("/api/auth/me")
    def me(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
        return user

    @app.get("/api/auth/access-requests")
    def my_access_requests(
        user: dict[str, Any] = Depends(get_current_user),
        cp: ControlPlaneStore = Depends(get_control_plane),
    ) -> list[dict[str, Any]]:
        return cp.list_access_requests(user_id=user["user_id"])

    @app.post("/api/auth/request-access")
    def request_access(
        payload: AccessRequestCreateRequest,
        user: dict[str, Any] = Depends(get_current_user),
        cp: ControlPlaneStore = Depends(get_control_plane),
    ) -> dict[str, Any]:
        if payload.requested_role not in {"site_admin", "researcher", "viewer"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid requested role.")
        requested_site = next((item for item in cp.list_sites() if item["site_id"] == payload.requested_site_id), None)
        if requested_site is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown site.")
        request_record = cp.submit_access_request(
            user_id=user["user_id"],
            requested_site_id=payload.requested_site_id,
            requested_role=payload.requested_role,
            message=payload.message,
        )
        refreshed_user = cp.get_user_by_id(user["user_id"]) or user
        return {
            "request": request_record,
            "auth_state": refreshed_user.get("approval_status", "application_required"),
            "user": refreshed_user,
        }

    @app.get("/api/admin/access-requests")
    def list_access_requests(
        status_filter: str | None = None,
        user: dict[str, Any] = Depends(get_approved_user),
        cp: ControlPlaneStore = Depends(get_control_plane),
    ) -> list[dict[str, Any]]:
        if user.get("role") == "admin":
            return cp.list_access_requests(status=status_filter)
        if user.get("role") == "site_admin":
            site_ids = list(user.get("site_ids") or [])
            if not site_ids:
                return []
            return cp.list_access_requests(status=status_filter, site_ids=site_ids)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin or site admin access required.")

    @app.post("/api/admin/access-requests/{request_id}/review")
    def review_access_request(
        request_id: str,
        payload: AccessRequestReviewRequest,
        user: dict[str, Any] = Depends(get_approved_user),
        cp: ControlPlaneStore = Depends(get_control_plane),
    ) -> dict[str, Any]:
        access_request = next((item for item in cp.list_access_requests() if item["request_id"] == request_id), None)
        if access_request is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown access request.")
        target_site_id = payload.assigned_site_id or access_request["requested_site_id"]
        _assert_request_review_permission(cp, user, target_site_id)
        if payload.decision not in {"approved", "rejected"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid review decision.")
        if payload.decision == "approved" and payload.assigned_role not in {None, "site_admin", "researcher", "viewer"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid assigned role.")
        reviewed = cp.review_access_request(
            request_id=request_id,
            reviewer_user_id=user["user_id"],
            decision=payload.decision,
            assigned_role=payload.assigned_role,
            assigned_site_id=payload.assigned_site_id,
            reviewer_notes=payload.reviewer_notes,
        )
        return {"request": reviewed}

    @app.get("/api/admin/overview")
    def admin_overview(
        user: dict[str, Any] = Depends(get_approved_user),
        cp: ControlPlaneStore = Depends(get_control_plane),
    ) -> dict[str, Any]:
        _require_admin_workspace_permission(user)
        visible_sites = cp.list_sites() if user.get("role") == "admin" else cp.accessible_sites_for_user(user)
        pending_requests = (
            cp.list_access_requests(status="pending")
            if user.get("role") == "admin"
            else cp.list_access_requests(status="pending", site_ids=[site["site_id"] for site in visible_sites])
        )
        visible_updates = _visible_model_updates(cp, user, status_filter="pending_upload")
        current_model = cp.current_global_model()
        overview = {
            "site_count": len(visible_sites),
            "model_version_count": len(cp.list_model_versions()),
            "pending_access_requests": len(pending_requests),
            "pending_model_updates": len(visible_updates),
            "current_model_version": current_model.get("version_name") if current_model else None,
        }
        if user.get("role") == "admin":
            overview["aggregation_count"] = len(cp.list_aggregations())
        return overview

    @app.get("/api/admin/model-versions")
    def list_model_versions(
        user: dict[str, Any] = Depends(get_approved_user),
        cp: ControlPlaneStore = Depends(get_control_plane),
    ) -> list[dict[str, Any]]:
        _require_admin_workspace_permission(user)
        return cp.list_model_versions()

    @app.get("/api/admin/model-updates")
    def list_model_updates(
        site_id: str | None = None,
        status_filter: str | None = None,
        user: dict[str, Any] = Depends(get_approved_user),
        cp: ControlPlaneStore = Depends(get_control_plane),
    ) -> list[dict[str, Any]]:
        _require_admin_workspace_permission(user)
        if site_id:
            _require_site_access(cp, user, site_id)
        return _visible_model_updates(cp, user, site_id=site_id, status_filter=status_filter)

    @app.get("/api/admin/aggregations")
    def list_aggregations(
        user: dict[str, Any] = Depends(get_approved_user),
        cp: ControlPlaneStore = Depends(get_control_plane),
    ) -> list[dict[str, Any]]:
        _require_platform_admin(user)
        return cp.list_aggregations()

    @app.post("/api/admin/aggregations/run")
    def run_federated_aggregation(
        payload: AggregationRunRequest,
        user: dict[str, Any] = Depends(get_approved_user),
        cp: ControlPlaneStore = Depends(get_control_plane),
    ) -> dict[str, Any]:
        _require_platform_admin(user)
        workflow = _get_workflow(cp)

        selected_ids = set(payload.update_ids)
        pending_updates = [
            item
            for item in cp.list_model_updates()
            if item.get("status") == "pending_upload" and (not selected_ids or item.get("update_id") in selected_ids)
        ]
        if not pending_updates:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No pending updates are available for aggregation.",
            )

        architectures = {item.get("architecture") for item in pending_updates}
        if len(architectures) != 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Only updates with the same architecture can be aggregated together.",
            )
        architecture = next(iter(architectures))

        base_model_ids = {item.get("base_model_version_id") for item in pending_updates}
        if len(base_model_ids) != 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Only updates based on the same global model can be aggregated together.",
            )
        base_model_version_id = next(iter(base_model_ids))
        base_model = next(
            (item for item in cp.list_model_versions() if item.get("version_id") == base_model_version_id),
            cp.current_global_model(),
        )
        if base_model is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="No global model is available for aggregation.",
            )

        delta_paths = [str(item.get("artifact_path") or "") for item in pending_updates]
        missing_paths = [path for path in delta_paths if not path or not Path(path).exists()]
        if missing_paths:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="One or more pending update artifacts are missing on disk.",
            )

        site_weights: dict[str, int] = {}
        delta_weights: list[int] = []
        for update_record in pending_updates:
            site_key = str(update_record.get("site_id") or "unknown")
            n_cases = max(1, int(update_record.get("n_cases", 1) or 1))
            site_weights[site_key] = site_weights.get(site_key, 0) + n_cases
            delta_weights.append(n_cases)

        output_path = MODEL_DIR / f"global_{architecture}_{make_id('agg')}.pth"
        try:
            workflow.model_manager.aggregate_weight_deltas(
                delta_paths,
                output_path,
                weights=delta_weights,
                base_model_path=base_model["model_path"],
            )
        except RuntimeError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Federated aggregation is unavailable: {exc}",
            ) from exc

        new_version_name = (payload.new_version_name or "").strip() or f"global-{architecture}-fedavg-{make_id('v')[:6]}"
        aggregation = cp.register_aggregation(
            base_model_version_id=base_model["version_id"],
            new_model_path=str(output_path),
            new_version_name=new_version_name,
            architecture=str(architecture or base_model.get("architecture") or "unknown"),
            site_weights=site_weights,
            requires_medsam_crop=bool(base_model.get("requires_medsam_crop", False)),
        )
        cp.update_model_update_statuses([item["update_id"] for item in pending_updates], "aggregated")
        model_version = next(
            (item for item in cp.list_model_versions() if item.get("aggregation_id") == aggregation["aggregation_id"]),
            cp.current_global_model(),
        )

        return {
            "aggregation": aggregation,
            "model_version": model_version,
            "aggregated_update_ids": [item["update_id"] for item in pending_updates],
        }

    @app.get("/api/admin/projects")
    def list_projects(
        user: dict[str, Any] = Depends(get_approved_user),
        cp: ControlPlaneStore = Depends(get_control_plane),
    ) -> list[dict[str, Any]]:
        _require_admin_workspace_permission(user)
        return cp.list_projects()

    @app.post("/api/admin/projects")
    def create_project(
        payload: ProjectCreateRequest,
        user: dict[str, Any] = Depends(get_approved_user),
        cp: ControlPlaneStore = Depends(get_control_plane),
    ) -> dict[str, Any]:
        _require_platform_admin(user)
        try:
            return cp.create_project(payload.name, payload.description, user["user_id"])
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @app.get("/api/admin/sites")
    def list_admin_sites(
        project_id: str | None = None,
        user: dict[str, Any] = Depends(get_approved_user),
        cp: ControlPlaneStore = Depends(get_control_plane),
    ) -> list[dict[str, Any]]:
        _require_admin_workspace_permission(user)
        if user.get("role") == "admin":
            return cp.list_sites(project_id=project_id)
        sites = cp.accessible_sites_for_user(user)
        if project_id:
            sites = [site for site in sites if site.get("project_id") == project_id]
        return sites

    @app.post("/api/admin/sites")
    def create_site(
        payload: SiteCreateRequest,
        user: dict[str, Any] = Depends(get_approved_user),
        cp: ControlPlaneStore = Depends(get_control_plane),
    ) -> dict[str, Any]:
        _require_platform_admin(user)
        try:
            return cp.create_site(
                payload.project_id,
                payload.site_code,
                payload.display_name,
                payload.hospital_name,
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @app.get("/api/admin/users")
    def list_users(
        user: dict[str, Any] = Depends(get_approved_user),
        cp: ControlPlaneStore = Depends(get_control_plane),
    ) -> list[dict[str, Any]]:
        _require_platform_admin(user)
        return cp.list_users()

    @app.post("/api/admin/users")
    def upsert_user(
        payload: UserUpsertRequest,
        user: dict[str, Any] = Depends(get_approved_user),
        cp: ControlPlaneStore = Depends(get_control_plane),
    ) -> dict[str, Any]:
        _require_platform_admin(user)
        if payload.role not in {"admin", "site_admin", "researcher", "viewer"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid user role.")
        if payload.role != "admin" and not payload.site_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Non-admin accounts must be assigned to at least one site.",
            )

        existing = cp.get_user_by_id(payload.user_id) if payload.user_id else cp.get_user_by_username(payload.username)
        existing_raw = cp._load_user_by_id(existing["user_id"]) if existing else None
        password = payload.password.strip()
        if not password and existing_raw:
            password = str(existing_raw.get("password") or "")
        if not password:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password is required for user creation.")

        try:
            return cp.upsert_user(
                {
                    "user_id": existing["user_id"] if existing else make_id("user"),
                    "username": payload.username.strip().lower(),
                    "full_name": payload.full_name.strip() or payload.username.strip(),
                    "password": password,
                    "role": payload.role,
                    "site_ids": [] if payload.role == "admin" else payload.site_ids,
                    "google_sub": existing_raw.get("google_sub") if existing_raw else None,
                }
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @app.get("/api/admin/site-comparison")
    def site_comparison(
        user: dict[str, Any] = Depends(get_approved_user),
        cp: ControlPlaneStore = Depends(get_control_plane),
    ) -> list[dict[str, Any]]:
        _require_admin_workspace_permission(user)
        return _site_comparison_rows(cp, user)

    @app.get("/api/sites")
    def list_sites(
        cp: ControlPlaneStore = Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> list[dict[str, Any]]:
        return cp.accessible_sites_for_user(user)

    @app.get("/api/sites/{site_id}/summary")
    def site_summary(
        site_id: str,
        cp: ControlPlaneStore = Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        site_store = _require_site_access(cp, user, site_id)
        patients = site_store.list_patients()
        visits = site_store.list_visits()
        images = site_store.list_images()
        validation_runs = cp.list_validation_runs(site_id=site_id)
        active_visits = [
            visit for visit in visits
            if visit.get("visit_status", "active" if visit.get("active_stage") else "scar") == "active"
        ]
        latest_run = validation_runs[0] if validation_runs else None
        return {
            "site_id": site_id,
            "n_patients": len(patients),
            "n_visits": len(visits),
            "n_images": len(images),
            "n_active_visits": len(active_visits),
            "n_validation_runs": len(validation_runs),
            "latest_validation": latest_run,
        }

    @app.get("/api/sites/{site_id}/import/template.csv")
    def download_import_template(
        site_id: str,
        cp: ControlPlaneStore = Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> Response:
        _require_admin_workspace_permission(user)
        _require_site_access(cp, user, site_id)
        template_csv = "\n".join(IMPORT_TEMPLATE_ROWS).encode("utf-8-sig")
        return Response(
            content=template_csv,
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="kera_import_template.csv"'},
        )

    @app.post("/api/sites/{site_id}/import/bulk")
    async def bulk_import_site_data(
        site_id: str,
        csv_file: UploadFile = File(...),
        files: list[UploadFile] = File(default=[]),
        cp: ControlPlaneStore = Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        _require_admin_workspace_permission(user)
        site_store = _require_site_access(cp, user, site_id)

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
                patient_id = _coerce_text(row.get("patient_id"))
                visit_date = _coerce_text(row.get("visit_date"))
                file_name = Path(_coerce_text(row.get("image_filename"))).name
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
                        sex=_coerce_text(row.get("sex"), "unknown") or "unknown",
                        age=int(float(row.get("age") or 0)),
                        chart_alias=_coerce_text(row.get("chart_alias")),
                        local_case_code=_coerce_text(row.get("local_case_code")),
                    )
                    patient_cache.add(patient_id)
                    created_patients += 1

                visit_key = (patient_id, visit_date)
                if visit_key not in visit_cache:
                    raw_factors = _coerce_text(row.get("predisposing_factor"))
                    factors = [item.strip() for item in raw_factors.split("|") if item.strip()]
                    site_store.create_visit(
                        patient_id=patient_id,
                        visit_date=visit_date,
                        culture_confirmed=_bool_from_value(row.get("culture_confirmed"), True),
                        culture_category=_coerce_text(row.get("culture_category"), "bacterial") or "bacterial",
                        culture_species=_coerce_text(row.get("culture_species"), "Other") or "Other",
                        contact_lens_use=_coerce_text(row.get("contact_lens_use"), "unknown") or "unknown",
                        predisposing_factor=factors,
                        other_history=_coerce_text(row.get("other_history")),
                        visit_status=_coerce_text(row.get("visit_status"), "active") or "active",
                        active_stage=_bool_from_value(row.get("active_stage"), True),
                        smear_result=_coerce_text(row.get("smear_result")),
                        polymicrobial=_bool_from_value(row.get("polymicrobial"), False),
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
                    view=_coerce_text(row.get("view"), "white") or "white",
                    is_representative=_bool_from_value(row.get("is_representative"), False),
                    file_name=file_name,
                    content=image_bytes[file_name],
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

    @app.get("/api/sites/{site_id}/activity")
    def site_activity(
        site_id: str,
        cp: ControlPlaneStore = Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        _require_site_access(cp, user, site_id)
        return _build_site_activity(cp, site_id)

    @app.get("/api/sites/{site_id}/validations")
    def list_site_validations(
        site_id: str,
        cp: ControlPlaneStore = Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> list[dict[str, Any]]:
        _require_site_access(cp, user, site_id)
        return _site_level_validation_runs(cp.list_validation_runs(site_id=site_id))

    @app.get("/api/sites/{site_id}/validations/{validation_id}/cases")
    def list_validation_cases(
        site_id: str,
        validation_id: str,
        misclassified_only: bool = False,
        limit: int | None = 20,
        cp: ControlPlaneStore = Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> list[dict[str, Any]]:
        site_store = _require_site_access(cp, user, site_id)
        validation_run = next(
            (
                item for item in cp.list_validation_runs(site_id=site_id)
                if item.get("validation_id") == validation_id
            ),
            None,
        )
        if validation_run is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Validation run not found.")
        normalized_limit = max(0, min(limit if limit is not None else 20, 100))
        return _validation_case_rows(
            cp,
            site_store,
            validation_id,
            misclassified_only=misclassified_only,
            limit=normalized_limit,
        )

    @app.post("/api/sites/{site_id}/validations/run")
    def run_site_validation(
        site_id: str,
        payload: SiteValidationRunRequest,
        cp: ControlPlaneStore = Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        _require_validation_permission(user)
        site_store = _require_site_access(cp, user, site_id)
        workflow = _get_workflow(cp)

        model_version = _get_model_version(cp, payload.model_version_id)
        if model_version is None or not model_version.get("ready", True):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="No ready model version is available for site validation.",
            )

        try:
            execution_device = _resolve_execution_device(payload.execution_mode)
            summary, _, _ = workflow.run_external_validation(
                project_id=_project_id_for_site(cp, site_id),
                site_store=site_store,
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
                detail=f"Site validation is unavailable: {exc}",
            ) from exc

        return {
            "summary": summary,
            "execution_device": execution_device,
            "model_version": {
                "version_id": model_version.get("version_id"),
                "version_name": model_version.get("version_name"),
                "architecture": model_version.get("architecture"),
            },
        }

    @app.post("/api/sites/{site_id}/training/initial")
    def run_initial_training(
        site_id: str,
        payload: InitialTrainingRequest,
        cp: ControlPlaneStore = Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        _require_admin_workspace_permission(user)
        site_store = _require_site_access(cp, user, site_id)
        workflow = _get_workflow(cp)

        if payload.architecture not in DENSENET_VARIANTS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Initial training supports only DenseNet variants: {', '.join(DENSENET_VARIANTS)}",
            )

        output_path = MODEL_DIR / f"global_{payload.architecture}_{make_id('init')[:8]}.pth"
        try:
            execution_device = _resolve_execution_device(payload.execution_mode)
            result = workflow.run_initial_training(
                site_store=site_store,
                architecture=payload.architecture,
                output_model_path=str(output_path),
                execution_device=execution_device,
                epochs=int(payload.epochs),
                learning_rate=float(payload.learning_rate),
                batch_size=int(payload.batch_size),
                val_split=float(payload.val_split),
                test_split=float(payload.test_split),
                use_pretrained=bool(payload.use_pretrained),
                use_medsam_crops=True,
                regenerate_split=bool(payload.regenerate_split),
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Initial training is unavailable: {exc}",
            ) from exc

        return {
            "site_id": site_id,
            "execution_device": execution_device,
            "result": result,
            "model_version": result.get("model_version"),
        }

    @app.get("/api/sites/{site_id}/training/cross-validation")
    def list_cross_validation_reports(
        site_id: str,
        cp: ControlPlaneStore = Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> list[dict[str, Any]]:
        _require_admin_workspace_permission(user)
        site_store = _require_site_access(cp, user, site_id)
        return _load_cross_validation_reports(site_store)

    @app.post("/api/sites/{site_id}/training/cross-validation")
    def run_cross_validation(
        site_id: str,
        payload: CrossValidationRunRequest,
        cp: ControlPlaneStore = Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        _require_admin_workspace_permission(user)
        site_store = _require_site_access(cp, user, site_id)
        workflow = _get_workflow(cp)

        if payload.architecture not in DENSENET_VARIANTS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cross-validation supports only DenseNet variants: {', '.join(DENSENET_VARIANTS)}",
            )

        output_dir = MODEL_DIR / f"cross_validation_{make_id('cvdir')[:8]}"
        try:
            execution_device = _resolve_execution_device(payload.execution_mode)
            report = workflow.run_cross_validation(
                site_store=site_store,
                architecture=payload.architecture,
                output_dir=str(output_dir),
                execution_device=execution_device,
                num_folds=int(payload.num_folds),
                epochs=int(payload.epochs),
                learning_rate=float(payload.learning_rate),
                batch_size=int(payload.batch_size),
                val_split=float(payload.val_split),
                use_pretrained=bool(payload.use_pretrained),
                use_medsam_crops=True,
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Cross-validation is unavailable: {exc}",
            ) from exc

        return {
            "site_id": site_id,
            "execution_device": execution_device,
            "report": report,
        }

    @app.get("/api/sites/{site_id}/cases")
    def list_cases(
        site_id: str,
        cp: ControlPlaneStore = Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> list[dict[str, Any]]:
        site_store = _require_site_access(cp, user, site_id)
        return site_store.list_case_summaries()

    @app.get("/api/sites/{site_id}/patients")
    def list_patients(
        site_id: str,
        cp: ControlPlaneStore = Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> list[dict[str, Any]]:
        site_store = _require_site_access(cp, user, site_id)
        return site_store.list_patients()

    @app.post("/api/sites/{site_id}/patients")
    def create_patient(
        site_id: str,
        payload: PatientCreateRequest,
        cp: ControlPlaneStore = Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        site_store = _require_site_access(cp, user, site_id)
        try:
            return site_store.create_patient(
                patient_id=payload.patient_id,
                sex=payload.sex,
                age=payload.age,
                chart_alias=payload.chart_alias,
                local_case_code=payload.local_case_code,
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @app.get("/api/sites/{site_id}/visits")
    def list_visits(
        site_id: str,
        patient_id: str | None = None,
        cp: ControlPlaneStore = Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> list[dict[str, Any]]:
        site_store = _require_site_access(cp, user, site_id)
        if patient_id:
            return site_store.list_visits_for_patient(patient_id)
        return site_store.list_visits()

    @app.post("/api/sites/{site_id}/visits")
    def create_visit(
        site_id: str,
        payload: VisitCreateRequest,
        cp: ControlPlaneStore = Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        site_store = _require_site_access(cp, user, site_id)
        try:
            return site_store.create_visit(
                patient_id=payload.patient_id,
                visit_date=payload.visit_date,
                culture_confirmed=payload.culture_confirmed,
                culture_category=payload.culture_category,
                culture_species=payload.culture_species,
                contact_lens_use=payload.contact_lens_use,
                predisposing_factor=payload.predisposing_factor,
                other_history=payload.other_history,
                visit_status=payload.visit_status,
                active_stage=payload.visit_status == "active",
                smear_result=payload.smear_result,
                polymicrobial=payload.polymicrobial,
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @app.get("/api/sites/{site_id}/images")
    def list_images(
        site_id: str,
        patient_id: str | None = None,
        visit_date: str | None = None,
        cp: ControlPlaneStore = Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> list[dict[str, Any]]:
        site_store = _require_site_access(cp, user, site_id)
        if patient_id and visit_date:
            return site_store.list_images_for_visit(patient_id, visit_date)
        return site_store.list_images()

    @app.post("/api/sites/{site_id}/images")
    async def upload_image(
        site_id: str,
        patient_id: str,
        visit_date: str,
        view: str,
        is_representative: bool = False,
        file: UploadFile = File(...),
        cp: ControlPlaneStore = Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        site_store = _require_site_access(cp, user, site_id)
        content = await file.read()
        try:
            return site_store.add_image(
                patient_id=patient_id,
                visit_date=visit_date,
                view=view,
                is_representative=is_representative,
                file_name=file.filename or "upload.bin",
                content=content,
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @app.post("/api/sites/{site_id}/images/representative")
    def set_representative_image(
        site_id: str,
        payload: RepresentativeImageRequest,
        cp: ControlPlaneStore = Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        site_store = _require_site_access(cp, user, site_id)
        visit_images = site_store.list_images_for_visit(payload.patient_id, payload.visit_date)
        if not visit_images:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No images found for this visit.")
        if payload.representative_image_id not in {image["image_id"] for image in visit_images}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Representative image is not part of this visit.")
        site_store.update_representative_flags(
            {
                image["image_id"]: image["image_id"] == payload.representative_image_id
                for image in visit_images
            }
        )
        return {
            "images": site_store.list_images_for_visit(payload.patient_id, payload.visit_date),
        }

    @app.get("/api/sites/{site_id}/images/{image_id}/content")
    def get_image_content(
        site_id: str,
        image_id: str,
        cp: ControlPlaneStore = Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> FileResponse:
        site_store = _require_site_access(cp, user, site_id)
        image = site_store.get_image(image_id)
        if image is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found.")
        image_path = Path(image["image_path"])
        if not image_path.exists():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image file not found on disk.")
        media_type = mimetypes.guess_type(image_path.name)[0] or "application/octet-stream"
        return FileResponse(path=image_path, media_type=media_type, filename=image_path.name)

    @app.post("/api/sites/{site_id}/cases/validate")
    def validate_case(
        site_id: str,
        payload: CaseValidationRequest,
        cp: ControlPlaneStore = Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        _require_validation_permission(user)
        site_store = _require_site_access(cp, user, site_id)
        workflow = _get_workflow(cp)
        model_version = cp.current_global_model()
        if model_version is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="No ready global model is available for validation.",
            )

        try:
            execution_device = _resolve_execution_device(payload.execution_mode)
            summary, case_predictions = workflow.run_case_validation(
                project_id=_project_id_for_site(cp, site_id),
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
            },
            "execution_device": execution_device,
            "artifact_availability": {
                "gradcam": bool(case_prediction and case_prediction.get("gradcam_path")),
                "roi_crop": bool(case_prediction and case_prediction.get("roi_crop_path")),
                "medsam_mask": bool(case_prediction and case_prediction.get("medsam_mask_path")),
            },
        }

    @app.post("/api/sites/{site_id}/cases/contribute")
    def contribute_case(
        site_id: str,
        payload: CaseContributionRequest,
        cp: ControlPlaneStore = Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        _require_validation_permission(user)
        site_store = _require_site_access(cp, user, site_id)
        workflow = _get_workflow(cp)

        visit = site_store.get_visit(payload.patient_id, payload.visit_date)
        if visit is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Visit not found.")
        visit_status = visit.get("visit_status", "active" if visit.get("active_stage") else "scar")
        if visit_status != "active":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Only active visits are enabled for contribution under the current policy.",
            )

        model_version = _get_model_version(cp, payload.model_version_id)
        if model_version is None or not model_version.get("ready", True):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="No ready model version is available for contribution.",
            )

        try:
            execution_device = _resolve_execution_device(payload.execution_mode)
            update_metadata = workflow.contribute_case(
                site_store=site_store,
                patient_id=payload.patient_id,
                visit_date=payload.visit_date,
                model_version=model_version,
                execution_device=execution_device,
                user_id=user["user_id"],
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Case contribution is unavailable: {exc}",
            ) from exc

        return {
            "update": update_metadata,
            "visit_status": visit_status,
            "execution_device": execution_device,
            "model_version": {
                "version_id": model_version.get("version_id"),
                "version_name": model_version.get("version_name"),
                "architecture": model_version.get("architecture"),
            },
            "stats": cp.get_contribution_stats(user_id=user["user_id"]),
        }

    @app.get("/api/sites/{site_id}/cases/roi-preview")
    def preview_case_roi(
        site_id: str,
        patient_id: str,
        visit_date: str,
        cp: ControlPlaneStore = Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> list[dict[str, Any]]:
        _require_validation_permission(user)
        site_store = _require_site_access(cp, user, site_id)
        workflow = _get_workflow(cp)
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
            }
            for item in previews
        ]

    @app.get("/api/sites/{site_id}/cases/roi-preview/artifacts/{artifact_kind}")
    def get_case_roi_preview_artifact(
        site_id: str,
        artifact_kind: str,
        patient_id: str,
        visit_date: str,
        image_id: str,
        cp: ControlPlaneStore = Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> FileResponse:
        _require_validation_permission(user)
        site_store = _require_site_access(cp, user, site_id)
        workflow = _get_workflow(cp)
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

    @app.get("/api/sites/{site_id}/cases/history")
    def get_case_history(
        site_id: str,
        patient_id: str,
        visit_date: str,
        cp: ControlPlaneStore = Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        _require_site_access(cp, user, site_id)
        return _build_case_history(cp, site_id, patient_id, visit_date)

    @app.get("/api/sites/{site_id}/validations/{validation_id}/artifacts/{artifact_kind}")
    def get_validation_artifact(
        site_id: str,
        validation_id: str,
        artifact_kind: str,
        patient_id: str,
        visit_date: str,
        cp: ControlPlaneStore = Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> FileResponse:
        site_store = _require_site_access(cp, user, site_id)
        validation_run = next(
            (item for item in cp.list_validation_runs(site_id=site_id) if item.get("validation_id") == validation_id),
            None,
        )
        if validation_run is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Validation run not found.")

        case_prediction = next(
            (
                item
                for item in cp.load_case_predictions(validation_id)
                if item.get("patient_id") == patient_id and item.get("visit_date") == visit_date
            ),
            None,
        )
        if case_prediction is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Validation case prediction not found.")

        artifact_key = {
            "gradcam": "gradcam_path",
            "roi_crop": "roi_crop_path",
            "medsam_mask": "medsam_mask_path",
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

    @app.get("/api/sites/{site_id}/manifest.csv")
    def export_manifest_csv(
        site_id: str,
        cp: ControlPlaneStore = Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> Response:
        site_store = _require_site_access(cp, user, site_id)
        manifest_df = site_store.generate_manifest()
        csv_content = manifest_df.to_csv(index=False)
        return Response(
            content=csv_content,
            media_type="text/csv",
            headers={
                "Content-Disposition": f'attachment; filename="{site_id}_dataset_manifest.csv"',
            },
        )

    return app


app = create_app()
