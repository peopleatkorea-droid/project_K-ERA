from __future__ import annotations

import base64
import inspect
import io
import mimetypes
import os
import platform
import threading
import time
import zipfile
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

import google.auth.transport.requests
import jwt
import pandas as pd
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from google.oauth2 import id_token as google_id_token
from pydantic import BaseModel, Field

from kera_research.config import (
    CASE_REFERENCE_SALT_FINGERPRINT,
    CONTROL_PLANE_BOOTSTRAP_REFRESH_SECONDS,
    CONTROL_PLANE_HEARTBEAT_INTERVAL_SECONDS,
    MODEL_DIR,
    SITE_ROOT_DIR,
)
from kera_research.domain import TRAINING_ARCHITECTURES, make_id
from kera_research.services.admin_registry_orchestrator import AdminRegistryOrchestrator
from kera_research.services.hardware import detect_hardware, resolve_execution_mode
from kera_research.services.job_runner import queue_name_for_job_type
from kera_research.services.node_credentials import (
    clear_node_credentials,
    load_node_credentials,
    node_credentials_status,
    save_node_credentials,
)
from kera_research.services.quality import score_slit_lamp_image
from kera_research.services.control_plane import GOOGLE_AUTH_SENTINEL, ControlPlaneStore, _hash_password, _is_bcrypt_hash
from kera_research.services.data_plane import InvalidImageUploadError, SiteStore, control_plane_split_enabled
from kera_research.services.pipeline import ResearchWorkflowService
from kera_research.services.remote_control_plane import RemoteControlPlaneClient
from kera_research.services.semantic_prompts import SemanticPromptScoringService
from kera_research.storage import read_json
from kera_research.api.route_helpers import (
    build_case_history as _build_case_history,
    build_patient_trajectory as _build_patient_trajectory,
    build_site_activity as _build_site_activity,
    load_cross_validation_reports as _load_cross_validation_reports,
    site_level_validation_runs as _site_level_validation_runs,
    validation_case_rows as _validation_case_rows,
)
from kera_research.api.route_support import build_route_supports
from kera_research.api.routes.admin import build_admin_router
from kera_research.api.routes.auth import build_auth_router
from kera_research.api.routes.cases import build_cases_router
from kera_research.api.routes.sites import build_sites_router


_MAX_IMAGE_BYTES = 20 * 1024 * 1024  # 20 MB

def _load_or_create_api_secret() -> str:
    env_secret = os.getenv("KERA_API_SECRET", "").strip()
    if env_secret:
        return env_secret
    # Auto-generate and persist so the secret survives restarts
    from kera_research.config import STORAGE_DIR
    secret_file = STORAGE_DIR / "kera_secret.key"
    if secret_file.exists():
        saved = secret_file.read_text(encoding="utf-8").strip()
        if saved:
            return saved
    import secrets
    generated = secrets.token_hex(32)
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    secret_file.write_text(generated, encoding="utf-8")
    try:
        os.chmod(secret_file, 0o600)  # owner read-only on POSIX
    except OSError:
        pass
    return generated

API_SECRET = _load_or_create_api_secret()
API_ALGORITHM = "HS256"
TOKEN_TTL_HOURS = 2
GOOGLE_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}

_LESION_PREVIEW_JOBS: dict[str, dict[str, Any]] = {}
_LESION_PREVIEW_JOBS_LOCK = threading.Lock()
_ADMIN_REGISTRY_ORCHESTRATOR = AdminRegistryOrchestrator(make_id=make_id, model_dir=MODEL_DIR)
_SEMANTIC_PROMPT_SCORER: SemanticPromptScoringService | None = None
IMPORT_TEMPLATE_ROWS = [
    "patient_id,chart_alias,local_case_code,sex,age,visit_date,actual_visit_date,culture_confirmed,culture_category,culture_species,"
    "contact_lens_use,predisposing_factor,visit_status,active_stage,smear_result,polymicrobial,other_history,image_filename,view,is_representative",
    "17635992,JNUH-001,2026-BK-001,female,45,Initial,2026-01-10,TRUE,bacterial,Pseudomonas aeruginosa,"
    "none,trauma,active,TRUE,positive,FALSE,,17635992_initial_white.jpg,white,TRUE",
    "17635992,JNUH-001,2026-BK-001,female,45,FU #1,2026-01-17,TRUE,bacterial,Pseudomonas aeruginosa,"
    "none,trauma,improving,FALSE,positive,FALSE,,17635992_fu1_slit.jpg,slit,FALSE",
]


def _google_client_id() -> str:
    return (
        os.getenv("KERA_GOOGLE_CLIENT_ID", "").strip()
        or os.getenv("GOOGLE_CLIENT_ID", "").strip()
        or os.getenv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "").strip()
    )


def _local_login_enabled() -> bool:
    value = os.getenv("KERA_LOCAL_LOGIN_ENABLED", "true").strip().lower()
    return value not in {"0", "false", "no", "off"}


def _local_control_plane_dev_auth_enabled() -> bool:
    value = os.getenv("KERA_CONTROL_PLANE_DEV_AUTH", "false").strip().lower()
    return value in {"1", "true", "yes", "on"}


def _create_access_token(user: dict[str, Any]) -> str:
    expires_at = datetime.now(timezone.utc) + timedelta(hours=TOKEN_TTL_HOURS)
    payload = {
        "sub": user["user_id"],
        "username": user["username"],
        "full_name": user.get("full_name", ""),
        "public_alias": user.get("public_alias"),
        "role": user.get("role", "viewer"),
        "site_ids": user.get("site_ids"),
        "approval_status": user.get("approval_status", "approved"),
        "registry_consents": user.get("registry_consents") or {},
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


class _LazyControlPlaneStore:
    def __init__(self) -> None:
        self._store: ControlPlaneStore | None = None

    def _resolve(self) -> ControlPlaneStore:
        if self._store is None:
            self._store = ControlPlaneStore()
        return self._store

    def __getattr__(self, name: str) -> Any:
        return getattr(self._resolve(), name)


@lru_cache(maxsize=1)
def get_control_plane() -> ControlPlaneStore:
    return _LazyControlPlaneStore()


def get_current_user(
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token.")
    token = authorization.split(" ", 1)[1].strip()
    token_payload = _decode_access_token(token)
    # Build the user dict directly from the signed JWT — no DB round trip needed.
    # The JWT already contains role, site_ids, and approval_status.
    # Token TTL is 2 hours, so stale permission windows are short.
    return {
        "user_id": token_payload["sub"],
        "username": token_payload.get("username", ""),
        "role": token_payload.get("role", "viewer"),
        "site_ids": token_payload.get("site_ids") or [],
        "approval_status": token_payload.get("approval_status", "approved"),
        "full_name": token_payload.get("full_name", ""),
        "public_alias": token_payload.get("public_alias"),
        "registry_consents": token_payload.get("registry_consents") or {},
    }


def get_approved_user(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    if user.get("approval_status") != "approved":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account is not approved yet. Submit an institution request first.",
        )
    return user


def _site_ids_for_user(user: dict[str, Any]) -> list[str]:
    return [
        str(site_id).strip()
        for site_id in user.get("site_ids") or []
        if str(site_id).strip()
    ]


def _user_can_access_site(user: dict[str, Any], site_id: str) -> bool:
    normalized_site_id = str(site_id or "").strip()
    if not normalized_site_id:
        return False
    if str(user.get("role") or "").strip().lower() == "admin":
        return True
    return normalized_site_id in set(_site_ids_for_user(user))


def _local_site_records_for_user(user: dict[str, Any]) -> list[dict[str, Any]]:
    site_ids = _site_ids_for_user(user)
    if str(user.get("role") or "").strip().lower() == "admin":
        disk_site_ids = []
        if SITE_ROOT_DIR.exists():
            disk_site_ids = sorted(path.name for path in SITE_ROOT_DIR.iterdir() if path.is_dir())
        site_ids = [*disk_site_ids, *site_ids]

    ordered_site_ids = list(dict.fromkeys(site_ids))
    return [
        {
            "site_id": site_id,
            "display_name": site_id,
            "hospital_name": site_id,
        }
        for site_id in ordered_site_ids
    ]


def _require_site_access(cp: ControlPlaneStore, user: dict[str, Any], site_id: str) -> SiteStore:
    if not _user_can_access_site(user, site_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this site.")
    try:
        return SiteStore(site_id)
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Configured storage root for site {site_id} is inaccessible: {exc}",
        ) from exc


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
    if reviewer.get("role") == "site_admin" and _user_can_access_site(reviewer, site_id):
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


def _get_semantic_prompt_scorer() -> SemanticPromptScoringService:
    global _SEMANTIC_PROMPT_SCORER
    if _SEMANTIC_PROMPT_SCORER is None:
        _SEMANTIC_PROMPT_SCORER = SemanticPromptScoringService()
    return _SEMANTIC_PROMPT_SCORER


def _serialize_lesion_preview_job(job: dict[str, Any]) -> dict[str, Any]:
    payload = {
        "job_id": job.get("job_id"),
        "site_id": job.get("site_id"),
        "image_id": job.get("image_id"),
        "patient_id": job.get("patient_id"),
        "visit_date": job.get("visit_date"),
        "status": job.get("status"),
        "error": job.get("error"),
        "started_at": job.get("started_at"),
        "finished_at": job.get("finished_at"),
        "prompt_signature": job.get("prompt_signature"),
        "lesion_prompt_box": job.get("lesion_prompt_box"),
    }
    result = job.get("result")
    if isinstance(result, dict):
        payload.update(
            {
                "backend": result.get("backend"),
                "has_lesion_crop": bool(result.get("lesion_crop_path")),
                "has_lesion_mask": bool(result.get("lesion_mask_path")),
            }
        )
    return payload


def _resolve_execution_device(selection: str) -> str:
    normalized = selection.strip().lower()
    ui_selection = {
        "gpu": "GPU mode",
        "cpu": "CPU mode",
        "auto": "Auto",
    }.get(normalized, "Auto")
    return resolve_execution_mode(ui_selection, detect_hardware())


def _preferred_embedding_execution_device() -> str:
    hardware = detect_hardware()
    return "cuda" if hardware.get("gpu_available") else "cpu"


def _remote_node_os_info() -> str:
    return f"{platform.system()} {platform.release()} ({platform.machine()})".strip()


def _call_with_supported_kwargs(func: Any, /, **kwargs: Any) -> Any:
    signature = inspect.signature(func)
    if any(parameter.kind == inspect.Parameter.VAR_KEYWORD for parameter in signature.parameters.values()):
        return func(**kwargs)
    supported_kwargs = {
        key: value
        for key, value in kwargs.items()
        if key in signature.parameters
    }
    return func(**supported_kwargs)


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


def _has_site_wide_write_access(user: dict[str, Any]) -> bool:
    return user.get("role") in {"admin", "site_admin"}


def _require_record_owner(user: dict[str, Any], owner_user_id: str | None, *, detail: str) -> None:
    if _has_site_wide_write_access(user):
        return
    if not owner_user_id or owner_user_id != user.get("user_id"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


def _visit_owner_user_id(site_store: SiteStore, patient_id: str, visit_date: str) -> str | None:
    visit = site_store.get_visit(patient_id, visit_date)
    if visit is None:
        return None
    return str(visit.get("created_by_user_id") or "").strip() or None


def _image_owner_user_id(site_store: SiteStore, image: dict[str, Any]) -> str | None:
    image_owner = str(image.get("created_by_user_id") or "").strip()
    if image_owner:
        return image_owner
    return _visit_owner_user_id(
        site_store,
        str(image.get("patient_id") or ""),
        str(image.get("visit_date") or ""),
    )


def _require_visit_write_access(site_store: SiteStore, user: dict[str, Any], patient_id: str, visit_date: str) -> None:
    _require_record_owner(
        user,
        _visit_owner_user_id(site_store, patient_id, visit_date),
        detail="Only the creator or a site admin can modify this visit.",
    )


def _require_visit_image_write_access(
    site_store: SiteStore,
    user: dict[str, Any],
    *,
    patient_id: str,
    visit_date: str,
) -> None:
    if _has_site_wide_write_access(user):
        return
    images = site_store.list_images_for_visit(patient_id, visit_date)
    if not images:
        _require_visit_write_access(site_store, user, patient_id, visit_date)
        return
    for image in images:
        owner_user_id = _image_owner_user_id(site_store, image)
        if owner_user_id != user.get("user_id"):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the creator or a site admin can modify these images.",
            )


def _get_model_version(cp: ControlPlaneStore, model_version_id: str | None) -> dict[str, Any] | None:
    if model_version_id:
        return next(
            (item for item in cp.list_model_versions() if item.get("version_id") == model_version_id),
            None,
        )
    return cp.current_global_model()


def _queue_case_embedding_refresh(
    cp: ControlPlaneStore,
    site_store: SiteStore,
    *,
    patient_id: str,
    visit_date: str,
    trigger: str,
) -> None:
    if control_plane_split_enabled():
        return
    disable_refresh = os.getenv("KERA_DISABLE_CASE_EMBEDDING_REFRESH", "").strip().lower()
    if disable_refresh in {"1", "true", "yes", "on"}:
        return
    model_version = cp.current_global_model()
    if model_version is None or not model_version.get("ready", True):
        return
    execution_device = _preferred_embedding_execution_device()
    job = site_store.enqueue_job(
        "ai_clinic_embedding_index",
        {
            "patient_id": patient_id,
            "visit_date": visit_date,
            "trigger": trigger,
            "model_version_id": model_version.get("version_id"),
            "model_version_name": model_version.get("version_name"),
            "execution_device": execution_device,
        },
    )
    site_store.update_job_status(
        job["job_id"],
        "running",
        {
            "progress": {
                "stage": "queued",
                "message": "AI Clinic embedding indexing queued.",
                "percent": 0,
            }
        },
    )

    def run_index_job() -> None:
        try:
            workflow = _get_workflow(cp)
            result = workflow.index_case_embedding(
                site_store,
                patient_id=patient_id,
                visit_date=visit_date,
                model_version=model_version,
                execution_device=execution_device,
            )
            site_store.update_job_status(
                job["job_id"],
                "completed",
                {
                    "progress": {
                        "stage": "completed",
                        "message": "AI Clinic embedding indexing completed.",
                        "percent": 100,
                    },
                    "response": result,
                },
            )
        except Exception as exc:
            try:
                site_store.update_job_status(
                    job["job_id"],
                    "failed",
                    {
                        "progress": {
                            "stage": "failed",
                            "message": "AI Clinic embedding indexing failed.",
                            "percent": 100,
                        },
                        "error": str(exc),
                    },
                )
            except Exception:
                pass

    threading.Thread(target=run_index_job, daemon=True).start()


def _queue_site_embedding_backfill(
    cp: ControlPlaneStore,
    site_store: SiteStore,
    *,
    model_version: dict[str, Any],
    execution_device: str,
    force_refresh: bool,
    case_summaries: list[dict[str, Any]] | None = None,
    trigger: str = "manual",
) -> dict[str, Any]:
    case_summaries = list(case_summaries) if case_summaries is not None else site_store.list_case_summaries()
    job = site_store.enqueue_job(
        "ai_clinic_embedding_backfill",
        {
            "model_version_id": model_version.get("version_id"),
            "model_version_name": model_version.get("version_name"),
            "execution_device": execution_device,
            "force_refresh": bool(force_refresh),
            "trigger": trigger,
            "total_cases": len(case_summaries),
        },
    )
    site_store.update_job_status(
        job["job_id"],
        "running",
        {
            "progress": {
                "stage": "queued",
                "message": "AI Clinic embedding backfill queued.",
                "percent": 0,
                "completed_cases": 0,
                "total_cases": len(case_summaries),
                "indexed_cases": 0,
                "failed_cases": 0,
            }
        },
    )

    def run_backfill_job() -> None:
        workflow = ResearchWorkflowService(cp)
        indexed_cases = 0
        failed_cases = 0
        failed_case_refs: list[str] = []
        total_cases = len(case_summaries)
        for index, summary in enumerate(case_summaries, start=1):
            patient_id = str(summary.get("patient_id") or "")
            visit_date = str(summary.get("visit_date") or "")
            case_id = str(summary.get("case_id") or f"{patient_id}::{visit_date}")
            try:
                workflow.index_case_embedding(
                    site_store,
                    patient_id=patient_id,
                    visit_date=visit_date,
                    model_version=model_version,
                    execution_device=execution_device,
                    force_refresh=force_refresh,
                    update_index=False,
                )
                indexed_cases += 1
            except Exception:
                failed_cases += 1
                if len(failed_case_refs) < 20:
                    failed_case_refs.append(case_id)
            percent = 100 if total_cases <= 0 else int((index / total_cases) * 100)
            site_store.update_job_status(
                job["job_id"],
                "running",
                {
                    "progress": {
                        "stage": "running",
                        "message": "AI Clinic embedding backfill in progress.",
                        "percent": percent,
                        "completed_cases": index,
                        "total_cases": total_cases,
                        "indexed_cases": indexed_cases,
                        "failed_cases": failed_cases,
                    }
                },
            )

        vector_index: dict[str, Any] | None = None
        vector_index_error: str | None = None
        try:
            vector_index = {
                "classifier": workflow.rebuild_case_vector_index(
                    site_store,
                    model_version=model_version,
                    backend="classifier",
                )
            }
            dinov2_meta = site_store.embedding_dir / str(model_version.get("version_id") or "unknown") / "dinov2"
            if dinov2_meta.exists():
                vector_index["dinov2"] = workflow.rebuild_case_vector_index(
                    site_store,
                    model_version=model_version,
                    backend="dinov2",
                )
        except Exception as exc:
            vector_index_error = str(exc)

        status = "completed" if failed_cases == 0 else "completed"
        site_store.update_job_status(
            job["job_id"],
            status,
            {
                "progress": {
                    "stage": "completed",
                    "message": "AI Clinic embedding backfill completed.",
                    "percent": 100,
                    "completed_cases": total_cases,
                    "total_cases": total_cases,
                    "indexed_cases": indexed_cases,
                    "failed_cases": failed_cases,
                },
                "response": {
                    "model_version_id": model_version.get("version_id"),
                    "model_version_name": model_version.get("version_name"),
                    "execution_device": execution_device,
                    "force_refresh": bool(force_refresh),
                    "total_cases": total_cases,
                    "indexed_cases": indexed_cases,
                    "failed_cases": failed_cases,
                    "failed_case_ids": failed_case_refs,
                    "vector_index": vector_index,
                    "vector_index_error": vector_index_error,
                },
            },
        )

    threading.Thread(target=run_backfill_job, daemon=True).start()
    return site_store.get_job(job["job_id"]) or job


def _latest_embedding_backfill_job(site_store: SiteStore) -> dict[str, Any] | None:
    jobs = [job for job in site_store.list_jobs() if job.get("job_type") == "ai_clinic_embedding_backfill"]
    if not jobs:
        return None
    active = next((job for job in jobs if job.get("status") in {"queued", "running"}), None)
    return active or jobs[0]


def _build_embedding_backfill_status(
    cp: ControlPlaneStore,
    site_store: SiteStore,
    *,
    model_version: dict[str, Any],
) -> dict[str, Any]:
    workflow = _get_workflow(cp)
    case_summaries = site_store.list_case_summaries()
    total_cases = len(case_summaries)
    total_images = sum(int(item.get("image_count") or 0) for item in case_summaries)
    missing_cases = workflow.list_cases_requiring_embedding(
        site_store,
        model_version=model_version,
        backend="classifier",
    )
    missing_case_count = len(missing_cases)
    missing_image_count = sum(int(item.get("image_count") or 0) for item in missing_cases)
    classifier_index_available = workflow.case_vector_index_exists(
        site_store,
        model_version=model_version,
        backend="classifier",
    )
    version_id = str(model_version.get("version_id") or "")
    dinov2_embedding_dir = site_store.embedding_dir / version_id / "dinov2"
    dinov2_embedding_available = dinov2_embedding_dir.exists()
    dinov2_index_available = (
        workflow.case_vector_index_exists(
            site_store,
            model_version=model_version,
            backend="dinov2",
        )
        if dinov2_embedding_available
        else False
    )
    active_job = _latest_embedding_backfill_job(site_store)

    return {
        "site_id": site_store.site_id,
        "model_version": {
            "version_id": model_version.get("version_id"),
            "version_name": model_version.get("version_name"),
            "architecture": model_version.get("architecture"),
        },
        "total_cases": total_cases,
        "total_images": total_images,
        "missing_case_count": missing_case_count,
        "missing_image_count": missing_image_count,
        "needs_backfill": bool(
            missing_case_count > 0
            or not classifier_index_available
            or (dinov2_embedding_available and not dinov2_index_available)
        ),
        "vector_index": {
            "classifier_available": classifier_index_available,
            "dinov2_embedding_available": dinov2_embedding_available,
            "dinov2_index_available": dinov2_index_available,
        },
        "active_job": active_job,
    }


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
    for update in updates:
        update["quality_summary"] = _backfill_update_quality_summary(cp, update)
    return updates


def _is_pending_model_update(update: dict[str, Any]) -> bool:
    return str(update.get("status") or "").strip().lower() in {"pending", "pending_review", "pending_upload"}


def _load_approval_report(update: dict[str, Any]) -> dict[str, Any]:
    embedded = update.get("approval_report")
    if isinstance(embedded, dict):
        return embedded
    report_path = str(update.get("approval_report_path") or "").strip()
    if not report_path:
        return {}
    return read_json(Path(report_path), {})


def _backfill_update_quality_summary(cp: ControlPlaneStore, update: dict[str, Any]) -> dict[str, Any]:
    existing = update.get("quality_summary")
    if isinstance(existing, dict):
        return existing

    report = _load_approval_report(update)
    qa_metrics = report.get("qa_metrics") if isinstance(report, dict) else {}
    source_metrics = qa_metrics.get("source") if isinstance(qa_metrics, dict) else {}
    roi_area_ratio = qa_metrics.get("roi_area_ratio") if isinstance(qa_metrics, dict) else None

    brightness = float(source_metrics.get("mean_brightness", 0.0) or 0.0)
    contrast = float(source_metrics.get("contrast_stddev", 0.0) or 0.0)
    edge_density = float(source_metrics.get("edge_density", 0.0) or 0.0)

    image_flags: list[str] = []
    image_score = 25
    if brightness and (brightness < 35 or brightness > 225):
        image_flags.append("brightness_out_of_range")
        image_score -= 8
    if contrast and contrast < 18:
        image_flags.append("low_contrast")
        image_score -= 8
    if edge_density and edge_density < 5:
        image_flags.append("low_edge_density")
        image_score -= 9
    image_score = max(0, image_score)

    crop_flags: list[str] = []
    crop_score = 25
    if roi_area_ratio is None:
        crop_flags.append("crop_ratio_missing")
        crop_score -= 12
    else:
        ratio_value = float(roi_area_ratio)
        if ratio_value < 0.03:
            crop_flags.append("crop_too_tight")
            crop_score -= 12
        elif ratio_value > 0.95:
            crop_flags.append("crop_too_wide")
            crop_score -= 12
    crop_score = max(0, crop_score)

    delta_path = str(update.get("central_artifact_path") or update.get("artifact_path") or "").strip()
    if not delta_path or not Path(delta_path).exists():
        delta_summary: dict[str, Any] = {
            "score": 0,
            "status": "missing",
            "flags": ["delta_missing"],
            "l2_norm": None,
            "parameter_count": None,
            "message": "Delta artifact is missing.",
        }
    else:
        try:
            import torch as _torch

            checkpoint = _torch.load(delta_path, map_location="cpu", weights_only=True)
            delta_state = checkpoint.get("state_dict") if isinstance(checkpoint, dict) else None
            if not isinstance(delta_state, dict):
                raise ValueError("Delta file has no readable state_dict.")
            workflow = _get_workflow(cp)
            workflow.model_manager._validate_deltas([delta_state])
            total_norm = 0.0
            parameter_count = 0
            for tensor in delta_state.values():
                t = tensor.float()
                total_norm += float(t.norm().item()) ** 2
                parameter_count += int(t.numel())
            delta_summary = {
                "score": 25,
                "status": "ok",
                "flags": [],
                "l2_norm": round(total_norm ** 0.5, 6),
                "parameter_count": parameter_count,
                "message": "Delta integrity and norm look valid.",
            }
        except Exception as exc:
            delta_summary = {
                "score": 0,
                "status": "invalid",
                "flags": ["delta_invalid"],
                "l2_norm": None,
                "parameter_count": None,
                "message": str(exc),
            }

    total_score = max(0, min(100, image_score + crop_score + int(delta_summary.get("score") or 0)))
    recommendation = "approve_candidate" if total_score >= 70 and not delta_summary.get("flags") else "needs_review"
    return {
        "quality_score": total_score,
        "recommendation": recommendation,
        "image_quality": {
            "score": image_score,
            "status": "ok" if not image_flags else "review",
            "flags": image_flags,
            "mean_brightness": round(brightness, 3) if brightness else None,
            "contrast_stddev": round(contrast, 3) if contrast else None,
            "edge_density": round(edge_density, 3) if edge_density else None,
        },
        "crop_quality": {
            "score": crop_score,
            "status": "ok" if not crop_flags else "review",
            "flags": crop_flags,
            "roi_area_ratio": round(float(roi_area_ratio), 4) if roi_area_ratio is not None else None,
        },
        "delta_quality": delta_summary,
        "validation_consistency": {
            "score": None,
            "status": "not_available",
            "flags": [],
            "predicted_label": None,
            "true_label": None,
            "prediction_probability": None,
            "decision_threshold": None,
            "is_correct": None,
        },
        "policy_checks": {
            "score": None,
            "status": "not_available",
            "flags": [],
            "has_additional_organisms": None,
            "training_policy": "exclude_polymicrobial",
        },
        "risk_flags": image_flags + crop_flags + list(delta_summary.get("flags") or []),
        "strengths": [],
    }


def _embedded_review_artifact_response(artifact: dict[str, Any]) -> Response | None:
    media_type = str(artifact.get("media_type") or "application/octet-stream").strip() or "application/octet-stream"
    encoding = str(artifact.get("encoding") or "").strip().lower()
    payload = artifact.get("bytes_b64")
    if encoding != "base64" or not isinstance(payload, str) or not payload.strip():
        return None
    try:
        content = base64.b64decode(payload.encode("ascii"), validate=True)
    except (ValueError, OSError):
        return None
    return Response(content=content, media_type=media_type)


def _attach_image_quality_scores(images: list[dict[str, Any]]) -> list[dict[str, Any]]:
    scored_images: list[dict[str, Any]] = []
    for image in images:
        payload = dict(image)
        try:
            payload["quality_scores"] = score_slit_lamp_image(
                str(image.get("image_path") or ""),
                view=str(image.get("view") or "white"),
            )
        except Exception:
            payload["quality_scores"] = None
        scored_images.append(payload)
    return scored_images


class LoginRequest(BaseModel):
    username: str
    password: str


class GoogleLoginRequest(BaseModel):
    id_token: str


class AccessRequestCreateRequest(BaseModel):
    requested_site_id: str
    requested_site_label: str = ""
    requested_role: str
    message: str = ""


class AccessRequestReviewRequest(BaseModel):
    decision: str
    assigned_role: str | None = None
    assigned_site_id: str | None = None
    create_site_if_missing: bool = False
    project_id: str | None = None
    site_code: str | None = None
    display_name: str | None = None
    hospital_name: str | None = None
    research_registry_enabled: bool = True
    reviewer_notes: str = ""


class PatientCreateRequest(BaseModel):
    patient_id: str
    sex: str
    age: int
    chart_alias: str = ""
    local_case_code: str = ""


class PatientUpdateRequest(BaseModel):
    sex: str
    age: int
    chart_alias: str = ""
    local_case_code: str = ""


class OrganismSelection(BaseModel):
    culture_category: str
    culture_species: str


class VisitCreateRequest(BaseModel):
    patient_id: str
    visit_date: str
    actual_visit_date: str | None = None
    culture_confirmed: bool = True
    culture_category: str
    culture_species: str
    additional_organisms: list[OrganismSelection] = Field(default_factory=list)
    contact_lens_use: str
    predisposing_factor: list[str] = Field(default_factory=list)
    other_history: str = ""
    visit_status: str = "active"
    is_initial_visit: bool = False
    smear_result: str = ""
    polymicrobial: bool = False


class RepresentativeImageRequest(BaseModel):
    patient_id: str
    visit_date: str
    representative_image_id: str


class LesionBoxRequest(BaseModel):
    x0: float
    y0: float
    x1: float
    y1: float


class CaseValidationRequest(BaseModel):
    patient_id: str
    visit_date: str
    execution_mode: str = "auto"
    model_version_id: str | None = None
    model_version_ids: list[str] = Field(default_factory=list)
    generate_gradcam: bool = True
    generate_medsam: bool = True


class CaseAiClinicRequest(BaseModel):
    patient_id: str
    visit_date: str
    execution_mode: str = "auto"
    model_version_id: str | None = None
    model_version_ids: list[str] = Field(default_factory=list)
    top_k: int = 3
    retrieval_backend: str = "standard"


class CaseContributionRequest(BaseModel):
    patient_id: str
    visit_date: str
    execution_mode: str = "auto"
    model_version_id: str | None = None
    model_version_ids: list[str] = Field(default_factory=list)


class SiteValidationRunRequest(BaseModel):
    execution_mode: str = "auto"
    generate_gradcam: bool = True
    generate_medsam: bool = True
    model_version_id: str | None = None


class InitialTrainingRequest(BaseModel):
    architecture: str = "convnext_tiny"
    execution_mode: str = "auto"
    crop_mode: str = "automated"
    case_aggregation: str = "mean"
    epochs: int = 30
    learning_rate: float = 1e-4
    batch_size: int = 16
    val_split: float = 0.2
    test_split: float = 0.2
    use_pretrained: bool = True
    regenerate_split: bool = False


class InitialTrainingBenchmarkRequest(BaseModel):
    architectures: list[str] = Field(default_factory=lambda: ["vit", "swin", "dinov2", "dinov2_mil", "dual_input_concat", "convnext_tiny", "densenet121", "efficientnet_v2_s"])
    execution_mode: str = "auto"
    crop_mode: str = "automated"
    case_aggregation: str = "mean"
    epochs: int = 30
    learning_rate: float = 1e-4
    batch_size: int = 16
    val_split: float = 0.2
    test_split: float = 0.2
    use_pretrained: bool = True
    regenerate_split: bool = False


class ResumeBenchmarkRequest(BaseModel):
    job_id: str
    execution_mode: str | None = None


class CrossValidationRunRequest(BaseModel):
    architecture: str = "convnext_tiny"
    execution_mode: str = "auto"
    crop_mode: str = "automated"
    case_aggregation: str = "mean"
    num_folds: int = 5
    epochs: int = 10
    learning_rate: float = 1e-4
    batch_size: int = 16
    val_split: float = 0.2
    use_pretrained: bool = True


class CaseValidationCompareRequest(BaseModel):
    patient_id: str
    visit_date: str
    model_version_ids: list[str] = Field(default_factory=list)
    execution_mode: str = "auto"
    generate_gradcam: bool = False
    generate_medsam: bool = False


class EmbeddingBackfillRequest(BaseModel):
    execution_mode: str = "auto"
    model_version_id: str | None = None
    force_refresh: bool = False


class AggregationRunRequest(BaseModel):
    update_ids: list[str] = Field(default_factory=list)
    new_version_name: str | None = None


class ModelUpdateReviewRequest(BaseModel):
    decision: str
    reviewer_notes: str = ""


class ModelVersionPublishRequest(BaseModel):
    download_url: str
    set_current: bool = False


class ModelVersionAutoPublishRequest(BaseModel):
    set_current: bool = False


class ProjectCreateRequest(BaseModel):
    name: str
    description: str = ""


class SiteCreateRequest(BaseModel):
    project_id: str
    site_code: str
    display_name: str
    hospital_name: str = ""
    source_institution_id: str | None = None
    research_registry_enabled: bool = True


class SiteUpdateRequest(BaseModel):
    display_name: str
    hospital_name: str = ""
    research_registry_enabled: bool = True


class StorageSettingsUpdateRequest(BaseModel):
    storage_root: str


class SiteStorageRootUpdateRequest(BaseModel):
    storage_root: str


class UserUpsertRequest(BaseModel):
    user_id: str | None = None
    username: str
    full_name: str = ""
    password: str = ""
    role: str = "viewer"
    site_ids: list[str] = Field(default_factory=list)


class LocalControlPlaneNodeRegisterRequest(BaseModel):
    control_plane_base_url: str | None = None
    control_plane_user_token: str
    device_name: str = "local-node"
    os_info: str = ""
    app_version: str = ""
    site_id: str | None = None
    display_name: str | None = None
    hospital_name: str | None = None
    source_institution_id: str | None = None
    overwrite: bool = False


class LocalControlPlaneNodeCredentialsRequest(BaseModel):
    control_plane_base_url: str
    node_id: str
    node_token: str
    site_id: str | None = None
    overwrite: bool = False


class LocalControlPlaneSmokeRequest(BaseModel):
    update_suffix: str = ""


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


def _normalize_storage_root(value: str) -> Path:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError("Storage root is required.")
    candidate = Path(normalized).expanduser()
    if not candidate.is_absolute():
        raise ValueError("Storage root must be an absolute path.")
    try:
        candidate.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise ValueError(f"Unable to create or access the storage root: {exc}") from exc
    if not candidate.is_dir():
        raise ValueError("Storage root must be a directory.")
    return candidate.resolve()


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
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept"],
    )

    @app.get("/api/health")
    def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "service": "kera-api",
            "google_auth_configured": bool(_google_client_id()),
        }

    @app.get("/api/control-plane/node/status")
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
            "bootstrap": bootstrap,
            "current_release": current_release,
        }

    @app.post("/api/control-plane/node/credentials")
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
        saved = save_node_credentials(
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
                app_version=app.version,
                os_info=_remote_node_os_info(),
                status="credentials_saved",
            )
        return {
            "saved": True,
            "credentials": node_credentials_status(),
            "bootstrap": bootstrap,
        }

    @app.delete("/api/control-plane/node/credentials")
    def clear_local_control_plane_node_credentials(cp=Depends(get_control_plane)) -> dict[str, Any]:
        clear_node_credentials()
        cp.clear_remote_control_plane_state()
        return {
            "cleared": True,
            "credentials": node_credentials_status(),
        }

    @app.post("/api/control-plane/node/register")
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
                os_info=payload.os_info or _remote_node_os_info(),
                app_version=payload.app_version or app.version,
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
            app_version=payload.app_version or app.version,
            os_info=payload.os_info or _remote_node_os_info(),
            status="registered",
        )
        return {
            "registered": True,
            "node_id": node_id,
            "node_token": node_token,
            "bootstrap": bootstrap,
            "credentials": node_credentials_status(),
        }

    @app.post("/api/dev/control-plane/smoke")
    def smoke_remote_control_plane(
        payload: LocalControlPlaneSmokeRequest,
        cp=Depends(get_control_plane),
    ) -> dict[str, Any]:
        if not _local_control_plane_dev_auth_enabled():
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
                "salt_fingerprint": CASE_REFERENCE_SALT_FINGERPRINT,
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

    route_supports = build_route_supports(
        get_control_plane=get_control_plane,
        get_current_user=get_current_user,
        get_approved_user=get_approved_user,
        local_login_enabled=_local_login_enabled,
        local_dev_auth_enabled=_local_control_plane_dev_auth_enabled,
        verify_google_id_token=_verify_google_id_token,
        build_auth_response=_build_auth_response,
        get_workflow=lambda cp: _get_workflow(cp),
        get_semantic_prompt_scorer=lambda: _get_semantic_prompt_scorer(),
        serialize_lesion_preview_job=_serialize_lesion_preview_job,
        require_admin_workspace_permission=_require_admin_workspace_permission,
        require_validation_permission=_require_validation_permission,
        require_platform_admin=_require_platform_admin,
        require_site_access=_require_site_access,
        user_can_access_site=_user_can_access_site,
        control_plane_split_enabled=control_plane_split_enabled,
        local_site_records_for_user=_local_site_records_for_user,
        require_visit_write_access=_require_visit_write_access,
        require_visit_image_write_access=_require_visit_image_write_access,
        require_record_owner=_require_record_owner,
        image_owner_user_id=_image_owner_user_id,
        assert_request_review_permission=_assert_request_review_permission,
        visible_model_updates=_visible_model_updates,
        is_pending_model_update=_is_pending_model_update,
        get_model_version=_get_model_version,
        resolve_execution_device=_resolve_execution_device,
        project_id_for_site=_project_id_for_site,
        queue_name_for_job_type=queue_name_for_job_type,
        get_embedding_backfill_status=_build_embedding_backfill_status,
        latest_embedding_backfill_job=_latest_embedding_backfill_job,
        queue_site_embedding_backfill=_queue_site_embedding_backfill,
        bool_from_value=_bool_from_value,
        coerce_text=_coerce_text,
        site_level_validation_runs=_site_level_validation_runs,
        validation_case_rows=_validation_case_rows,
        build_site_activity=lambda cp, site_id, current_user_id=None: _build_site_activity(
            cp,
            site_id,
            current_user_id=current_user_id,
            is_pending_model_update=_is_pending_model_update,
        ),
        import_template_rows=IMPORT_TEMPLATE_ROWS,
        training_architectures=TRAINING_ARCHITECTURES,
        load_cross_validation_reports=_load_cross_validation_reports,
        queue_case_embedding_refresh=_queue_case_embedding_refresh,
        normalize_storage_root=_normalize_storage_root,
        embedded_review_artifact_response=_embedded_review_artifact_response,
        load_approval_report=_load_approval_report,
        site_comparison_rows=_site_comparison_rows,
        attach_image_quality_scores=_attach_image_quality_scores,
        build_case_history=_build_case_history,
        build_patient_trajectory=_build_patient_trajectory,
        hash_password=_hash_password,
        registry_orchestrator=_ADMIN_REGISTRY_ORCHESTRATOR,
        lesion_preview_jobs=_LESION_PREVIEW_JOBS,
        lesion_preview_jobs_lock=_LESION_PREVIEW_JOBS_LOCK,
        make_id=make_id,
        model_dir=MODEL_DIR,
        max_image_bytes=_MAX_IMAGE_BYTES,
        score_slit_lamp_image=score_slit_lamp_image,
        InvalidImageUploadError=InvalidImageUploadError,
        case_reference_salt_fingerprint=CASE_REFERENCE_SALT_FINGERPRINT,
        PatientCreateRequest=PatientCreateRequest,
        PatientUpdateRequest=PatientUpdateRequest,
        VisitCreateRequest=VisitCreateRequest,
        RepresentativeImageRequest=RepresentativeImageRequest,
        LesionBoxRequest=LesionBoxRequest,
        CaseValidationRequest=CaseValidationRequest,
        CaseAiClinicRequest=CaseAiClinicRequest,
        CaseContributionRequest=CaseContributionRequest,
        SiteValidationRunRequest=SiteValidationRunRequest,
        InitialTrainingRequest=InitialTrainingRequest,
        InitialTrainingBenchmarkRequest=InitialTrainingBenchmarkRequest,
        ResumeBenchmarkRequest=ResumeBenchmarkRequest,
        CrossValidationRunRequest=CrossValidationRunRequest,
        CaseValidationCompareRequest=CaseValidationCompareRequest,
        EmbeddingBackfillRequest=EmbeddingBackfillRequest,
        LoginRequest=LoginRequest,
        GoogleLoginRequest=GoogleLoginRequest,
        AccessRequestCreateRequest=AccessRequestCreateRequest,
        AccessRequestReviewRequest=AccessRequestReviewRequest,
        StorageSettingsUpdateRequest=StorageSettingsUpdateRequest,
        ModelUpdateReviewRequest=ModelUpdateReviewRequest,
        ModelVersionPublishRequest=ModelVersionPublishRequest,
        ModelVersionAutoPublishRequest=ModelVersionAutoPublishRequest,
        AggregationRunRequest=AggregationRunRequest,
        ProjectCreateRequest=ProjectCreateRequest,
        SiteCreateRequest=SiteCreateRequest,
        SiteUpdateRequest=SiteUpdateRequest,
        UserUpsertRequest=UserUpsertRequest,
        SiteStorageRootUpdateRequest=SiteStorageRootUpdateRequest,
    )

    app.include_router(build_auth_router(route_supports.auth))
    app.include_router(build_admin_router(route_supports.admin))
    app.include_router(build_sites_router(route_supports.sites))
    app.include_router(build_cases_router(route_supports.cases))

    @app.on_event("startup")
    def _startup_remote_control_plane_sync() -> None:
        cp = get_control_plane()
        if not cp.remote_node_sync_enabled():
            return
        stop_event = threading.Event()
        app.state.control_plane_sync_stop = stop_event

        def sync_loop() -> None:
            last_bootstrap_sync = time.time()
            bootstrap = cp.remote_bootstrap_state(force_refresh=True)
            if bootstrap is not None:
                cp.record_remote_node_heartbeat(
                    app_version=app.version,
                    os_info=_remote_node_os_info(),
                    status="startup",
                )
            while not stop_event.wait(float(CONTROL_PLANE_HEARTBEAT_INTERVAL_SECONDS)):
                cp.record_remote_node_heartbeat(
                    app_version=app.version,
                    os_info=_remote_node_os_info(),
                    status="ok",
                )
                if (time.time() - last_bootstrap_sync) >= float(CONTROL_PLANE_BOOTSTRAP_REFRESH_SECONDS):
                    cp.remote_bootstrap_state(force_refresh=True)
                    last_bootstrap_sync = time.time()

        threading.Thread(
            target=sync_loop,
            daemon=True,
            name="kera-control-plane-sync",
        ).start()

    @app.on_event("shutdown")
    def _shutdown_remote_control_plane_sync() -> None:
        stop_event = getattr(app.state, "control_plane_sync_stop", None)
        if isinstance(stop_event, threading.Event):
            stop_event.set()

    return app


app = create_app()
