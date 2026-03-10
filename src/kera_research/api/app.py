from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any

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


def _create_access_token(user: dict[str, Any]) -> str:
    expires_at = datetime.now(timezone.utc) + timedelta(hours=TOKEN_TTL_HOURS)
    payload = {
        "sub": user["user_id"],
        "username": user["username"],
        "role": user.get("role", "viewer"),
        "site_ids": user.get("site_ids"),
        "exp": int(expires_at.timestamp()),
    }
    return jwt.encode(payload, API_SECRET, algorithm=API_ALGORITHM)


def _decode_access_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, API_SECRET, algorithms=[API_ALGORITHM])
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token.") from exc


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
    users = cp.list_users()
    user = next((item for item in users if item["user_id"] == token_payload["sub"]), None)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User no longer exists.")
    return user


def _require_site_access(cp: ControlPlaneStore, user: dict[str, Any], site_id: str) -> SiteStore:
    if not cp.user_can_access_site(user, site_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this site.")
    return SiteStore(site_id)


class LoginRequest(BaseModel):
    username: str
    password: str


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
    app = FastAPI(title="K-ERA Research API", version="0.1.0")

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
        return {"status": "ok", "service": "kera-api"}

    @app.post("/api/auth/login")
    def login(payload: LoginRequest, cp: ControlPlaneStore = Depends(get_control_plane)) -> dict[str, Any]:
        user = cp.authenticate(payload.username, payload.password)
        if user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials.")
        token = _create_access_token(user)
        return {
            "access_token": token,
            "token_type": "bearer",
            "user": {
                "user_id": user["user_id"],
                "username": user["username"],
                "full_name": user.get("full_name", user["username"]),
                "role": user.get("role", "viewer"),
                "site_ids": user.get("site_ids"),
            },
        }

    @app.get("/api/auth/me")
    def me(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
        return user

    @app.get("/api/sites")
    def list_sites(
        cp: ControlPlaneStore = Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_current_user),
    ) -> list[dict[str, Any]]:
        return cp.accessible_sites_for_user(user)

    @app.get("/api/sites/{site_id}/summary")
    def site_summary(
        site_id: str,
        cp: ControlPlaneStore = Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_current_user),
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
        user: dict[str, Any] = Depends(get_current_user),
    ) -> list[dict[str, Any]]:
        site_store = _require_site_access(cp, user, site_id)
        return site_store.list_patients()

    @app.post("/api/sites/{site_id}/patients")
    def create_patient(
        site_id: str,
        payload: PatientCreateRequest,
        cp: ControlPlaneStore = Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_current_user),
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
        user: dict[str, Any] = Depends(get_current_user),
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
        user: dict[str, Any] = Depends(get_current_user),
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
        user: dict[str, Any] = Depends(get_current_user),
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
        user: dict[str, Any] = Depends(get_current_user),
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
        user: dict[str, Any] = Depends(get_current_user),
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

