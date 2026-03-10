from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import urlopen

import jwt
from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

from kera_research.services.control_plane import ControlPlaneStore
from kera_research.services.data_plane import SiteStore


API_SECRET = os.getenv("KERA_API_SECRET", "dev-secret-change-me")
API_ALGORITHM = "HS256"
TOKEN_TTL_HOURS = 12
GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"


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

    query = urlencode({"id_token": id_token})
    verify_url = f"{GOOGLE_TOKENINFO_URL}?{query}"
    try:
        with urlopen(verify_url, timeout=10) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google token verification failed.") from exc

    if payload.get("aud") != client_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google client ID mismatch.")
    if str(payload.get("email_verified", "")).lower() not in {"true", "1"}:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google email is not verified.")

    email = str(payload.get("email", "")).strip().lower()
    if not email:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google account did not return an email.")

    return {
        "email": email,
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


def create_app() -> FastAPI:
    app = FastAPI(title="K-ERA Research API", version="0.2.0")

    allowed_origins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
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
        user = cp.ensure_google_user(identity["email"], identity["name"])
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
        return site_store.create_patient(
            patient_id=payload.patient_id,
            sex=payload.sex,
            age=payload.age,
            chart_alias=payload.chart_alias,
            local_case_code=payload.local_case_code,
        )

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
        return site_store.add_image(
            patient_id=patient_id,
            visit_date=visit_date,
            view=view,
            is_representative=is_representative,
            file_name=file.filename or "upload.bin",
            content=content,
        )

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
