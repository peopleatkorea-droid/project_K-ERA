from __future__ import annotations

import os
import threading
import time
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import google.auth.transport.requests
import jwt
import re
from sqlalchemy import select, update as sa_update
from fastapi import Depends, FastAPI, Header, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest
from starlette.responses import Response as StarletteResponse
from google.oauth2 import id_token as google_id_token

from kera_research.config import (
    CASE_REFERENCE_SALT_FINGERPRINT,
    CONTROL_PLANE_BOOTSTRAP_REFRESH_SECONDS,
    CONTROL_PLANE_HEARTBEAT_INTERVAL_SECONDS,
    MODEL_DIR,
    SITE_ROOT_DIR,
)
from kera_research.db import CONTROL_PLANE_ENGINE, DATABASE_TOPOLOGY, institution_directory, sites as control_plane_sites
from kera_research.domain import TRAINING_ARCHITECTURES, make_id
from kera_research.api.control_plane_sync import start_control_plane_sync_loop, stop_control_plane_sync_loop
from kera_research.api.desktop_support import desktop_self_check as _desktop_self_check, remote_node_os_info as _remote_node_os_info
from kera_research.api.models import (
    AccessRequestCreateRequest,
    AccessRequestReviewRequest,
    AggregationRunRequest,
    CaseAiClinicRequest,
    CaseContributionRequest,
    CaseValidationCompareRequest,
    CaseValidationRequest,
    CrossValidationRunRequest,
    EmbeddingBackfillRequest,
    FederatedRetrievalSyncRequest,
    GoogleLoginRequest,
    ImageLevelFederatedRoundRequest,
    InitialTrainingBenchmarkRequest,
    RetrievalBaselineRequest,
    InitialTrainingRequest,
    LesionBoxRequest,
    LocalControlPlaneNodeCredentialsRequest,
    LocalControlPlaneNodeRegisterRequest,
    LocalControlPlaneSmokeRequest,
    LoginRequest,
    ModelUpdateReviewRequest,
    ModelVersionAutoPublishRequest,
    ModelVersionPublishRequest,
    PatientCreateRequest,
    PatientUpdateRequest,
    ProjectCreateRequest,
    ReleaseRolloutRequest,
    RepresentativeImageRequest,
    ResumeBenchmarkRequest,
    SiteCreateRequest,
    SiteMetadataRecoveryRequest,
    SiteStorageRootUpdateRequest,
    SiteUpdateRequest,
    SiteValidationRunRequest,
    SSLPretrainingRunRequest,
    StorageSettingsUpdateRequest,
    UserUpsertRequest,
    VisitLevelFederatedRoundRequest,
    VisitCreateRequest,
)
from kera_research.services.admin_registry_orchestrator import AdminRegistryOrchestrator
from kera_research.services.hardware import detect_hardware, resolve_execution_mode
from kera_research.services.job_runner import queue_name_for_job_type
from kera_research.services.local_api_secret import load_or_create_local_api_secret
from kera_research.services.local_api_jwt import (
    load_control_plane_jwt_audience,
    load_control_plane_jwt_issuer,
    load_control_plane_jwt_public_key,
)
from kera_research.services.node_credentials import (
    clear_node_credentials,
    load_node_credentials,
    node_credentials_status,
    save_node_credentials,
)
from kera_research.services.quality import score_slit_lamp_image
from kera_research.services.control_plane import GOOGLE_AUTH_SENTINEL, ControlPlaneStore, _hash_password, _is_bcrypt_hash
from kera_research.services.data_plane import (
    InvalidImageUploadError,
    SiteStore,
    control_plane_split_enabled,
    invalidate_site_storage_root_cache,
)
from kera_research.services.pipeline import ResearchWorkflowService
from kera_research.services.remote_control_plane import RemoteControlPlaneClient
from kera_research.services.semantic_prompts import SemanticPromptScoringService
from kera_research.api.route_helpers import (
    attach_image_quality_scores as _attach_image_quality_scores,
    bool_from_value as _bool_from_value,
    build_case_history as _build_case_history,
    build_patient_trajectory as _build_patient_trajectory,
    build_site_activity as _build_site_activity,
    coerce_text as _coerce_text,
    embedded_review_artifact_response as _embedded_review_artifact_response,
    load_cross_validation_reports as _load_cross_validation_reports,
    load_approval_report as _load_approval_report,
    site_comparison_rows as _site_comparison_rows,
    site_level_validation_runs as _site_level_validation_runs,
    validation_case_rows as _validation_case_rows,
)
from kera_research.api.route_support import build_route_supports
from kera_research.api.routes.admin import build_admin_router
from kera_research.api.routes.auth import build_auth_router
from kera_research.api.routes.cases import build_cases_router
from kera_research.api.routes.desktop import build_desktop_router
from kera_research.api.routes.sites import build_sites_router
from kera_research.api.site_jobs import (
    build_embedding_backfill_status as _build_embedding_backfill_status_impl,
    latest_embedding_backfill_job as _latest_embedding_backfill_job,
    latest_federated_retrieval_sync_job as _latest_federated_retrieval_sync_job_impl,
    queue_site_embedding_backfill as _queue_site_embedding_backfill_impl,
    start_federated_retrieval_corpus_sync as _start_federated_retrieval_corpus_sync_impl,
)


_MAX_IMAGE_BYTES = 20 * 1024 * 1024  # 20 MB

_HIRA_CODE_RE = re.compile(r"^\d{8}$")
_INSTITUTION_BACKFILL_IN_PROGRESS: set[str] = set()
_INSTITUTION_BACKFILL_LOCK = threading.Lock()


def _backfill_institution_names(ykiho_codes: list[str]) -> None:
    """Background: fetch hospital names from Neon (or HIRA) for sites still showing HIRA codes."""
    from kera_research.config import HIRA_API_KEY
    from kera_research.services.institution_directory import HiraInstitutionDirectoryClient
    from kera_research.domain import utc_now

    cp = get_control_plane()

    for ykiho in ykiho_codes:
        try:
            name = ""
            record: dict | None = None

            # 1st priority: Neon remote institution directory (already synced there)
            try:
                remote_results = cp.remote_control_plane.public_institutions(
                    query=ykiho, limit=3, timeout_seconds=5.0
                )
                for item in remote_results:
                    if str(item.get("institution_id") or "").strip() == ykiho:
                        name = str(item.get("name") or "").strip()
                        record = item
                        break
            except Exception:
                pass

            # 2nd priority: HIRA API direct lookup
            if not name and HIRA_API_KEY:
                hira_client = HiraInstitutionDirectoryClient()
                record = hira_client.fetch_by_ykiho(ykiho)
                if record:
                    name = str(record.get("name") or "").strip()

            if not name or name == ykiho:
                continue
            with CONTROL_PLANE_ENGINE.begin() as conn:
                existing = conn.execute(
                    select(institution_directory.c.institution_id).where(
                        institution_directory.c.institution_id == ykiho
                    )
                ).first()
                if existing:
                    conn.execute(
                        sa_update(institution_directory)
                        .where(institution_directory.c.institution_id == ykiho)
                        .values(name=name, synced_at=utc_now())
                    )
                else:
                    row = {k: str(record.get(k) or "") for k in (
                        "source", "institution_type_code", "institution_type_name",
                        "address", "phone", "homepage", "sido_code", "sggu_code",
                        "emdong_name", "postal_code", "x_pos", "y_pos",
                    )}
                    conn.execute(institution_directory.insert().values(
                        institution_id=ykiho,
                        name=name,
                        ophthalmology_available=True,
                        open_status="active",
                        source_payload=record.get("source_payload") or {},
                        synced_at=utc_now(),
                        **{k: v for k, v in row.items()},
                    ))
                conn.execute(
                    sa_update(control_plane_sites)
                    .where(
                        (control_plane_sites.c.site_id == ykiho)
                        | (control_plane_sites.c.source_institution_id == ykiho)
                    )
                    .where(
                        (control_plane_sites.c.hospital_name == ykiho)
                        | (control_plane_sites.c.hospital_name == "")
                    )
                    .values(hospital_name=name)
                )
        except Exception:
            pass
        finally:
            with _INSTITUTION_BACKFILL_LOCK:
                _INSTITUTION_BACKFILL_IN_PROGRESS.discard(ykiho)

def _load_or_create_api_secret() -> str:
    return load_or_create_local_api_secret()

API_SECRET = _load_or_create_api_secret()
API_ALGORITHM = "HS256"
TOKEN_TTL_HOURS = 2
GOOGLE_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}
CONTROL_PLANE_JWT_PUBLIC_KEY = load_control_plane_jwt_public_key()
CONTROL_PLANE_JWT_ISSUER = load_control_plane_jwt_issuer()
CONTROL_PLANE_JWT_AUDIENCE = load_control_plane_jwt_audience()

_LESION_PREVIEW_JOBS: dict[str, dict[str, Any]] = {}
_LESION_PREVIEW_JOBS_LOCK = threading.Lock()
_ADMIN_REGISTRY_ORCHESTRATOR = AdminRegistryOrchestrator(make_id=make_id, model_dir=MODEL_DIR)
_SEMANTIC_PROMPT_SCORER: SemanticPromptScoringService | None = None
IMPORT_TEMPLATE_ROWS = [
    "patient_id,chart_alias,local_case_code,sex,age,visit_date,actual_visit_date,culture_status,culture_category,culture_species,"
    "contact_lens_use,predisposing_factor,visit_status,active_stage,smear_result,polymicrobial,other_history,image_filename,view,is_representative",
    "17635992,JNUH-001,2026-BK-001,female,45,Initial,2026-01-10,positive,bacterial,Pseudomonas aeruginosa,"
    "none,trauma,active,TRUE,positive,FALSE,,17635992_initial_white.jpg,white,TRUE",
    "17635992,JNUH-001,2026-BK-001,female,45,FU #1,2026-01-17,unknown,,,"
    "none,trauma,active,TRUE,unknown,FALSE,,17635992_fu1_slit.jpg,slit,FALSE",
]


def _google_client_ids() -> list[str]:
    values: list[str] = []
    for raw in (
        os.getenv("KERA_GOOGLE_DESKTOP_CLIENT_ID", ""),
        os.getenv("NEXT_PUBLIC_GOOGLE_DESKTOP_CLIENT_ID", ""),
        os.getenv("KERA_GOOGLE_CLIENT_ID", ""),
        os.getenv("GOOGLE_CLIENT_ID", ""),
        os.getenv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", ""),
        os.getenv("KERA_GOOGLE_CLIENT_IDS", ""),
    ):
        for entry in str(raw).split(","):
            normalized = entry.strip()
            if normalized and normalized not in values:
                values.append(normalized)
    return values


def _google_client_id() -> str:
    client_ids = _google_client_ids()
    return client_ids[0] if client_ids else ""


def _local_login_enabled() -> bool:
    value = os.getenv("KERA_LOCAL_LOGIN_ENABLED", "true").strip().lower()
    return value not in {"0", "false", "no", "off"}


def _local_control_plane_dev_auth_enabled() -> bool:
    value = os.getenv("KERA_CONTROL_PLANE_DEV_AUTH", "false").strip().lower()
    return value in {"1", "true", "yes", "on"}


def _create_access_token(user: dict[str, Any]) -> str:
    normalized_user = _normalize_user_access_state(user)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=TOKEN_TTL_HOURS)
    payload = {
        "sub": normalized_user["user_id"],
        "username": normalized_user["username"],
        "full_name": normalized_user.get("full_name", ""),
        "public_alias": normalized_user.get("public_alias"),
        "role": normalized_user.get("role", "viewer"),
        "site_ids": normalized_user.get("site_ids"),
        "approval_status": normalized_user.get("approval_status", "application_required"),
        "registry_consents": normalized_user.get("registry_consents") or {},
        "exp": int(expires_at.timestamp()),
    }
    return jwt.encode(payload, API_SECRET, algorithm=API_ALGORITHM)


def _normalize_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    items: list[str] = []
    for entry in value:
        normalized = str(entry or "").strip()
        if normalized and normalized not in items:
            items.append(normalized)
    return items


def _normalize_user_access_state(user: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(user)
    normalized_site_ids = _normalize_string_list(normalized.get("site_ids"))
    role = str(normalized.get("role") or "viewer").strip().lower()
    approval_status = str(normalized.get("approval_status") or "application_required").strip() or "application_required"
    if role == "admin":
        approval_status = "approved"
    elif approval_status == "approved" and not normalized_site_ids:
        approval_status = "application_required"
    normalized["site_ids"] = normalized_site_ids
    normalized["approval_status"] = approval_status
    return normalized


def _decode_remote_control_plane_access_token(token: str) -> dict[str, Any] | None:
    normalized_token = str(token or "").strip()
    if not normalized_token:
        return None
    try:
        client = RemoteControlPlaneClient()
    except Exception:
        return None
    if not client.is_configured():
        return None
    try:
        payload = client.main_auth_me(user_bearer_token=normalized_token)
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    user = payload.get("user") if isinstance(payload.get("user"), dict) else None
    if not isinstance(user, dict):
        return None

    user_id = str(user.get("user_id") or "").strip()
    username = str(user.get("username") or "").strip()
    if not user_id or not username:
        return None

    registry_consents = user.get("registry_consents") if isinstance(user.get("registry_consents"), dict) else {}
    return _normalize_user_access_state({
        "sub": user_id,
        "username": username,
        "full_name": str(user.get("full_name") or username).strip(),
        "public_alias": str(user.get("public_alias") or "").strip() or None,
        "role": str(user.get("role") or "viewer").strip() or "viewer",
        "site_ids": _normalize_string_list(user.get("site_ids")),
        "approval_status": str(user.get("approval_status") or "application_required").strip() or "application_required",
        "registry_consents": registry_consents,
    })


def _decode_control_plane_access_token(token: str) -> dict[str, Any]:
    if not CONTROL_PLANE_JWT_PUBLIC_KEY:
        remote_payload = _decode_remote_control_plane_access_token(token)
        if remote_payload is not None:
            return remote_payload
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="KERA_LOCAL_API_JWT_PUBLIC_KEY_B64 is not configured on the local node.",
        )
    try:
        return jwt.decode(
            token,
            CONTROL_PLANE_JWT_PUBLIC_KEY,
            algorithms=["RS256"],
            audience=CONTROL_PLANE_JWT_AUDIENCE,
            issuer=CONTROL_PLANE_JWT_ISSUER,
        )
    except ModuleNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="RS256 JWT verification requires the cryptography package on the local node.",
        ) from exc
    except jwt.PyJWTError as exc:
        remote_payload = _decode_remote_control_plane_access_token(token)
        if remote_payload is not None:
            return remote_payload
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token.") from exc


def _decode_access_token(token: str) -> dict[str, Any]:
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError:
        header = {}
    algorithm = str(header.get("alg") or "").strip().upper()

    if algorithm == "RS256":
        return _decode_control_plane_access_token(token)
    if algorithm and algorithm != API_ALGORITHM:
        remote_payload = _decode_remote_control_plane_access_token(token)
        if remote_payload is not None:
            return remote_payload
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token.")
    try:
        return jwt.decode(token, API_SECRET, algorithms=[API_ALGORITHM])
    except jwt.PyJWTError as exc:
        remote_payload = _decode_remote_control_plane_access_token(token)
        if remote_payload is not None:
            return remote_payload
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token.") from exc


def _verify_google_id_token(id_token: str) -> dict[str, str]:
    client_ids = _google_client_ids()
    if not client_ids:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google authentication is not configured on the server.",
        )

    # Try each configured client ID so the library performs audience validation.
    # google-auth caches the public certs, so repeated calls are inexpensive.
    payload: dict | None = None
    for _client_id in client_ids:
        try:
            payload = google_id_token.verify_oauth2_token(
                id_token,
                google.auth.transport.requests.Request(),
                _client_id,
            )
            break
        except ValueError:
            continue
    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google token verification failed.")

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
    token: str | None = Query(default=None, alias="token"),
) -> dict[str, Any]:
    raw_token: str | None = None
    if authorization and authorization.lower().startswith("bearer "):
        raw_token = authorization.split(" ", 1)[1].strip()
    elif token:
        raw_token = token.strip()
    if not raw_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token.")
    token_payload = _decode_access_token(raw_token)
    # Build the user dict directly from the signed JWT — no DB round trip needed.
    # The JWT already contains role, site_ids, and approval_status.
    # Token TTL is 2 hours, so stale permission windows are short.
    return _normalize_user_access_state({
        "user_id": token_payload["sub"],
        "username": token_payload.get("username", ""),
        "role": token_payload.get("role", "viewer"),
        "site_ids": token_payload.get("site_ids") or [],
        "approval_status": token_payload.get("approval_status", "approved"),
        "full_name": token_payload.get("full_name", ""),
        "public_alias": token_payload.get("public_alias"),
        "registry_consents": token_payload.get("registry_consents") or {},
    })


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
    site_records_by_id: dict[str, dict[str, str]] = {}
    institution_names: dict[str, str] = {}
    try:
        if ordered_site_ids:
            with CONTROL_PLANE_ENGINE.begin() as conn:
                site_rows = conn.execute(
                    select(
                        control_plane_sites.c.site_id,
                        control_plane_sites.c.display_name,
                        control_plane_sites.c.hospital_name,
                        control_plane_sites.c.source_institution_id,
                    ).where(control_plane_sites.c.site_id.in_(ordered_site_ids))
                ).mappings().all()
                site_rows_by_id = {str(row.get("site_id") or "").strip(): dict(row) for row in site_rows}
                institution_ids = {
                    str(site_rows_by_id.get(site_id, {}).get("source_institution_id") or site_id).strip()
                    for site_id in ordered_site_ids
                    if str(site_rows_by_id.get(site_id, {}).get("source_institution_id") or site_id).strip()
                }
                institution_rows = conn.execute(
                    select(institution_directory.c.institution_id, institution_directory.c.name).where(
                        institution_directory.c.institution_id.in_(institution_ids)
                    )
                ).mappings().all()
                institution_names = {
                    str(row.get("institution_id") or "").strip(): str(row.get("name") or "").strip()
                    for row in institution_rows
                    if str(row.get("institution_id") or "").strip()
                }

            for site_id in ordered_site_ids:
                site_row = site_rows_by_id.get(site_id, {})
                source_institution_id = str(site_row.get("source_institution_id") or site_id).strip()
                institution_name = institution_names.get(source_institution_id, "")
                display_name = str(site_row.get("display_name") or "").strip()
                hospital_name = str(site_row.get("hospital_name") or "").strip()
                if institution_name:
                    if not display_name or display_name == site_id:
                        display_name = institution_name
                    if not hospital_name or hospital_name == site_id:
                        hospital_name = institution_name
                rec: dict[str, Any] = {
                    "display_name": display_name or hospital_name or site_id,
                    "hospital_name": hospital_name or display_name or site_id,
                }
                if institution_name:
                    rec["source_institution_name"] = institution_name
                site_records_by_id[site_id] = rec
    except Exception:
        site_records_by_id = {}

    def _build_site_result(site_id: str) -> dict[str, Any]:
        rec = site_records_by_id.get(site_id, {})
        entry: dict[str, Any] = {
            "site_id": site_id,
            "display_name": rec.get("display_name") or site_id,
            "hospital_name": rec.get("hospital_name") or site_id,
        }
        source_institution_name = rec.get("source_institution_name") or ""
        if source_institution_name:
            entry["source_institution_name"] = source_institution_name
        return entry

    # Synchronously resolve HIRA codes BEFORE building the result.
    # Any site whose hospital_name is still a raw HIRA code (8 digits) gets looked up
    # from the remote control-plane institution directory right now, then cached in
    # institution_directory so future calls are instant.
    hira_needs_lookup = [
        site_id for site_id in ordered_site_ids
        if _HIRA_CODE_RE.match(site_id)
        and not institution_names.get(site_id)  # not already resolved
        and str(site_records_by_id.get(site_id, {}).get("hospital_name") or site_id).strip() == site_id
    ]
    if hira_needs_lookup:
        _backfill_institution_names(hira_needs_lookup)
        # Re-read resolved names from DB so the result we return has real names
        try:
            with CONTROL_PLANE_ENGINE.begin() as conn:
                refreshed_rows = conn.execute(
                    select(institution_directory.c.institution_id, institution_directory.c.name).where(
                        institution_directory.c.institution_id.in_(hira_needs_lookup)
                    )
                ).mappings().all()
                for row in refreshed_rows:
                    iid = str(row.get("institution_id") or "").strip()
                    iname = str(row.get("name") or "").strip()
                    if iid and iname:
                        institution_names[iid] = iname
                        # Also patch site_records_by_id so _build_site_result picks it up
                        if iid in site_records_by_id:
                            rec = site_records_by_id[iid]
                            if not rec.get("hospital_name") or rec.get("hospital_name") == iid:
                                rec["hospital_name"] = iname
                            if not rec.get("display_name") or rec.get("display_name") == iid:
                                rec["display_name"] = iname
                            rec["source_institution_name"] = iname
                        else:
                            site_records_by_id[iid] = {
                                "hospital_name": iname,
                                "display_name": iname,
                                "source_institution_name": iname,
                            }
        except Exception:
            pass

    return [_build_site_result(site_id) for site_id in ordered_site_ids]


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
    normalized = _normalize_user_access_state(cp.get_user_by_id(user["user_id"]) or user)
    token = _create_access_token(normalized)
    return {
        "auth_state": normalized.get("approval_status", "application_required"),
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


import concurrent.futures

_EMBEDDING_INDEX_EXECUTOR = concurrent.futures.ThreadPoolExecutor(max_workers=1)
_PENDING_EMBEDDING_JOBS: dict[tuple[str, str, str], bool] = {}
_PENDING_EMBEDDING_TRIGGERS: dict[tuple[str, str, str], str] = {}
_EMBEDDING_JOB_LOCK = threading.Lock()
_FEDERATED_RETRIEVAL_SYNC_EXECUTOR = concurrent.futures.ThreadPoolExecutor(max_workers=1)
_PENDING_FEDERATED_RETRIEVAL_SYNC_JOBS: dict[tuple[str, str], bool] = {}
_PENDING_FEDERATED_RETRIEVAL_SYNC_TRIGGERS: dict[tuple[str, str], str] = {}
_FEDERATED_RETRIEVAL_SYNC_JOB_LOCK = threading.Lock()
_VECTOR_INDEX_REBUILD_EXECUTOR = concurrent.futures.ThreadPoolExecutor(max_workers=1)
_PENDING_VECTOR_INDEX_REBUILD_JOBS: dict[tuple[str, str], bool] = {}
_PENDING_VECTOR_INDEX_REBUILD_TRIGGERS: dict[tuple[str, str], str] = {}
_VECTOR_INDEX_REBUILD_JOB_LOCK = threading.Lock()


def _parse_nonnegative_delay_seconds(env_name: str, default_seconds: float) -> float:
    raw_value = os.getenv(env_name, str(default_seconds)).strip()
    try:
        return max(0.0, float(raw_value))
    except ValueError:
        return float(default_seconds)


def _case_embedding_refresh_delay_seconds(trigger: str, *, execution_device: str) -> float:
    normalized_trigger = str(trigger or "").strip().lower()
    normalized_device = str(execution_device or "cpu").strip().lower()
    gpu_available = normalized_device.startswith("cuda")
    if normalized_trigger == "image_upload":
        return _parse_nonnegative_delay_seconds("KERA_CASE_EMBEDDING_UPLOAD_DELAY_SECONDS", 10.0)
    elif normalized_trigger == "representative_change":
        # Save completion and post-save MedSAM warm-up take priority over
        # classifier / retrieval embedding refresh for the newly written case.
        return _parse_nonnegative_delay_seconds(
            "KERA_CASE_EMBEDDING_REPRESENTATIVE_DELAY_SECONDS",
            20.0 if gpu_available else 30.0,
        )
    return 0.0


def _case_vector_index_refresh_delay_seconds(
    trigger: str,
    *,
    execution_device: str,
    embedding_delay_seconds: float,
) -> float:
    normalized_trigger = str(trigger or "").strip().lower()
    normalized_device = str(execution_device or "cpu").strip().lower()
    gpu_available = normalized_device.startswith("cuda")
    if normalized_trigger == "image_upload":
        return _parse_nonnegative_delay_seconds(
            "KERA_CASE_VECTOR_INDEX_UPLOAD_DELAY_SECONDS",
            embedding_delay_seconds,
        )
    if normalized_trigger == "representative_change":
        return _parse_nonnegative_delay_seconds(
            "KERA_CASE_VECTOR_INDEX_REPRESENTATIVE_DELAY_SECONDS",
            60.0 if gpu_available else 90.0,
        )
    return 0.0


def _federated_retrieval_sync_delay_seconds(trigger: str, *, execution_device: str) -> float:
    normalized_trigger = str(trigger or "").strip().lower()
    normalized_device = str(execution_device or "cpu").strip().lower()
    gpu_available = normalized_device.startswith("cuda")
    if normalized_trigger == "image_upload":
        return _parse_nonnegative_delay_seconds(
            "KERA_FEDERATED_RETRIEVAL_SYNC_UPLOAD_DELAY_SECONDS",
            20.0 if gpu_available else 30.0,
        )
    if normalized_trigger == "representative_change":
        return _parse_nonnegative_delay_seconds(
            "KERA_FEDERATED_RETRIEVAL_SYNC_REPRESENTATIVE_DELAY_SECONDS",
            30.0 if gpu_available else 45.0,
        )
    if normalized_trigger == "bulk_import":
        return _parse_nonnegative_delay_seconds(
            "KERA_FEDERATED_RETRIEVAL_SYNC_IMPORT_DELAY_SECONDS",
            10.0 if gpu_available else 15.0,
        )
    return _parse_nonnegative_delay_seconds(
        "KERA_FEDERATED_RETRIEVAL_SYNC_DEFAULT_DELAY_SECONDS",
        10.0 if gpu_available else 15.0,
    )


def _ai_clinic_vector_index_rebuild_delay_seconds(trigger: str, *, execution_device: str) -> float:
    normalized_trigger = str(trigger or "").strip().lower()
    normalized_device = str(execution_device or "cpu").strip().lower()
    gpu_available = normalized_device.startswith("cuda")
    if normalized_trigger in {"delete_images", "visit_delete"}:
        return _parse_nonnegative_delay_seconds(
            "KERA_CASE_VECTOR_INDEX_DELETE_DELAY_SECONDS",
            5.0 if gpu_available else 8.0,
        )
    if normalized_trigger == "visit_update":
        return _parse_nonnegative_delay_seconds(
            "KERA_CASE_VECTOR_INDEX_VISIT_UPDATE_DELAY_SECONDS",
            8.0 if gpu_available else 12.0,
        )
    return _parse_nonnegative_delay_seconds(
        "KERA_CASE_VECTOR_INDEX_DEFAULT_DELAY_SECONDS",
        10.0 if gpu_available else 15.0,
    )


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

    job_key = (site_store.site_id, patient_id, visit_date)
    with _EMBEDDING_JOB_LOCK:
        _PENDING_EMBEDDING_TRIGGERS[job_key] = trigger
        if job_key in _PENDING_EMBEDDING_JOBS:
            _PENDING_EMBEDDING_JOBS[job_key] = True  # Mark as dirty
            return
        _PENDING_EMBEDDING_JOBS[job_key] = False

    execution_device = _preferred_embedding_execution_device()
    embedding_delay_seconds = _case_embedding_refresh_delay_seconds(
        trigger,
        execution_device=execution_device,
    )
    index_delay_seconds = max(
        embedding_delay_seconds,
        _case_vector_index_refresh_delay_seconds(
            trigger,
            execution_device=execution_device,
            embedding_delay_seconds=embedding_delay_seconds,
        ),
    )

    def run_index_job_safe(
        key: tuple[str, str, str],
        job_trigger: str,
        job_embedding_delay_seconds: float,
        job_index_delay_seconds: float,
    ) -> None:
        job: dict[str, Any] | None = None
        try:
            job_started_at = time.monotonic()
            if job_embedding_delay_seconds > 0:
                # Keep case-save UX responsive by yielding the CPU-intensive refresh
                # until after the save flow has completed and the next screen has rendered.
                time.sleep(job_embedding_delay_seconds)
            with _EMBEDDING_JOB_LOCK:
                if _PENDING_EMBEDDING_JOBS.get(key, False):
                    return
            workflow = _get_workflow(cp)
            # Create a localized job record in DB for visibility
            job = site_store.enqueue_job(
                "ai_clinic_embedding_index",
                {
                    "patient_id": key[1],
                    "visit_date": key[2],
                    "trigger": job_trigger,
                    "model_version_id": model_version.get("version_id"),
                    "execution_device": execution_device,
                    "embedding_delay_seconds": float(job_embedding_delay_seconds),
                    "vector_index_delay_seconds": float(job_index_delay_seconds),
                },
            )
            site_store.update_job_status(
                job["job_id"],
                "running",
                {
                    "progress": {
                        "stage": "embedding",
                        "message": "Refreshing case embeddings.",
                        "percent": 25,
                    }
                },
            )

            embedding_response = workflow.index_case_embedding(
                site_store,
                patient_id=key[1],
                visit_date=key[2],
                model_version=model_version,
                execution_device=execution_device,
                update_index=False,
            )
            site_store.update_job_status(
                job["job_id"],
                "running",
                {
                    "progress": {
                        "stage": "index_wait",
                        "message": "Waiting before vector index rebuild.",
                        "percent": 50,
                    },
                    "response": {
                        **embedding_response,
                        "execution_device": execution_device,
                    },
                },
            )

            with _EMBEDDING_JOB_LOCK:
                if _PENDING_EMBEDDING_JOBS.get(key, False):
                    site_store.update_job_status(
                        job["job_id"],
                        "completed",
                        {
                            "progress": {
                                "stage": "superseded",
                                "message": "Skipped vector index rebuild because a newer case update is queued.",
                                "percent": 100,
                            },
                            "response": {
                                **embedding_response,
                                "execution_device": execution_device,
                                "vector_index": None,
                                "vector_index_error": None,
                            },
                        },
                    )
                    return

            remaining_index_delay_seconds = max(
                0.0,
                float(job_index_delay_seconds) - (time.monotonic() - job_started_at),
            )
            if remaining_index_delay_seconds > 0:
                time.sleep(remaining_index_delay_seconds)

            with _EMBEDDING_JOB_LOCK:
                if _PENDING_EMBEDDING_JOBS.get(key, False):
                    site_store.update_job_status(
                        job["job_id"],
                        "completed",
                        {
                            "progress": {
                                "stage": "superseded",
                                "message": "Skipped vector index rebuild because a newer case update is queued.",
                                "percent": 100,
                            },
                            "response": {
                                **embedding_response,
                                "execution_device": execution_device,
                                "vector_index": None,
                                "vector_index_error": None,
                            },
                        },
                    )
                    return

            site_store.update_job_status(
                job["job_id"],
                "running",
                {
                    "progress": {
                        "stage": "index",
                        "message": "Rebuilding AI Clinic vector index.",
                        "percent": 75,
                    }
                },
            )

            available_backends = list(embedding_response.get("available_backends") or [])
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
                if "dinov2" in available_backends:
                    vector_index["dinov2"] = workflow.rebuild_case_vector_index(
                        site_store,
                        model_version=model_version,
                        backend="dinov2",
                    )
                if "biomedclip" in available_backends:
                    vector_index["biomedclip"] = workflow.rebuild_case_vector_index(
                        site_store,
                        model_version=model_version,
                        backend="biomedclip",
                    )
            except Exception as exc:
                vector_index_error = str(exc)

            site_store.update_job_status(
                job["job_id"],
                "completed",
                {
                    "progress": {
                        "stage": "completed",
                        "message": "AI Clinic embedding refresh completed.",
                        "percent": 100,
                    },
                    "response": {
                        **embedding_response,
                        "execution_device": execution_device,
                        "vector_index": vector_index,
                        "vector_index_error": vector_index_error,
                    },
                },
            )

        except Exception as exc:
            if job is not None:
                site_store.update_job_status(
                    job["job_id"],
                    "failed",
                    {
                        "progress": {
                            "stage": "failed",
                            "message": "AI Clinic embedding refresh failed.",
                            "percent": 100,
                        },
                        "error": str(exc),
                    },
                )
            # We don't want to crash the worker thread
            try:
                print(f"Embedding indexing failed for {key}: {exc}")
            except Exception:
                pass
        finally:
            with _EMBEDDING_JOB_LOCK:
                is_dirty = _PENDING_EMBEDDING_JOBS.get(key, False)
                latest_trigger = _PENDING_EMBEDDING_TRIGGERS.get(key, job_trigger)
                if is_dirty:
                    _PENDING_EMBEDDING_JOBS[key] = False  # Reset dirty bit and re-queue
                    latest_execution_device = _preferred_embedding_execution_device()
                    latest_embedding_delay_seconds = _case_embedding_refresh_delay_seconds(
                        latest_trigger,
                        execution_device=latest_execution_device,
                    )
                    latest_index_delay_seconds = max(
                        latest_embedding_delay_seconds,
                        _case_vector_index_refresh_delay_seconds(
                            latest_trigger,
                            execution_device=latest_execution_device,
                            embedding_delay_seconds=latest_embedding_delay_seconds,
                        ),
                    )
                    _EMBEDDING_INDEX_EXECUTOR.submit(
                        run_index_job_safe,
                        key,
                        latest_trigger,
                        latest_embedding_delay_seconds,
                        latest_index_delay_seconds,
                    )
                else:
                    _PENDING_EMBEDDING_JOBS.pop(key, None)
                    _PENDING_EMBEDDING_TRIGGERS.pop(key, None)

    _EMBEDDING_INDEX_EXECUTOR.submit(
        run_index_job_safe,
        job_key,
        trigger,
        embedding_delay_seconds,
        index_delay_seconds,
    )


def _queue_ai_clinic_embedding_backfill(
    cp: ControlPlaneStore,
    site_store: SiteStore,
    *,
    trigger: str,
    force_refresh: bool = False,
    case_summaries: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    if control_plane_split_enabled():
        return {
            "site_id": site_store.site_id,
            "queued": False,
            "reason": "control_plane_split_enabled",
        }
    disable_refresh = os.getenv("KERA_DISABLE_CASE_EMBEDDING_REFRESH", "").strip().lower()
    if disable_refresh in {"1", "true", "yes", "on"}:
        return {
            "site_id": site_store.site_id,
            "queued": False,
            "reason": "disabled",
        }
    model_version = cp.current_global_model()
    if model_version is None or not model_version.get("ready", True):
        return {
            "site_id": site_store.site_id,
            "queued": False,
            "reason": "model_unavailable",
        }

    execution_device = _preferred_embedding_execution_device()
    job = _queue_site_embedding_backfill_impl(
        cp,
        site_store,
        model_version=model_version,
        execution_device=execution_device,
        force_refresh=bool(force_refresh),
        case_summaries=case_summaries,
        trigger=trigger,
    )
    return {
        "site_id": site_store.site_id,
        "queued": True,
        "job": job,
        "model_version_id": model_version.get("version_id"),
        "execution_device": execution_device,
    }


def _queue_federated_retrieval_corpus_sync(
    cp: ControlPlaneStore,
    site_store: SiteStore,
    *,
    trigger: str,
    retrieval_profile: str = "dinov2_lesion_crop",
) -> dict[str, Any]:
    disable_refresh = os.getenv("KERA_DISABLE_FEDERATED_RETRIEVAL_AUTO_SYNC", "").strip().lower()
    if disable_refresh in {"1", "true", "yes", "on"}:
        return {
            "site_id": site_store.site_id,
            "retrieval_profile": retrieval_profile,
            "queued": False,
            "reason": "disabled",
        }
    if not cp.remote_node_sync_enabled():
        return {
            "site_id": site_store.site_id,
            "retrieval_profile": retrieval_profile,
            "queued": False,
            "reason": "remote_node_sync_disabled",
        }

    normalized_profile = str(retrieval_profile or "dinov2_lesion_crop").strip() or "dinov2_lesion_crop"
    execution_device = _preferred_embedding_execution_device()
    delay_seconds = _federated_retrieval_sync_delay_seconds(
        trigger,
        execution_device=execution_device,
    )
    job_key = (site_store.site_id, normalized_profile)
    with _FEDERATED_RETRIEVAL_SYNC_JOB_LOCK:
        _PENDING_FEDERATED_RETRIEVAL_SYNC_TRIGGERS[job_key] = trigger
        if job_key in _PENDING_FEDERATED_RETRIEVAL_SYNC_JOBS:
            _PENDING_FEDERATED_RETRIEVAL_SYNC_JOBS[job_key] = True
            return {
                "site_id": site_store.site_id,
                "retrieval_profile": normalized_profile,
                "queued": True,
                "deduped": True,
                "trigger": trigger,
                "delay_seconds": float(delay_seconds),
            }
        _PENDING_FEDERATED_RETRIEVAL_SYNC_JOBS[job_key] = False

    poll_seconds = _parse_nonnegative_delay_seconds("KERA_FEDERATED_RETRIEVAL_SYNC_POLL_SECONDS", 3.0)
    max_wait_seconds = _parse_nonnegative_delay_seconds("KERA_FEDERATED_RETRIEVAL_SYNC_MAX_WAIT_SECONDS", 300.0)

    def run_sync_job_safe(
        key: tuple[str, str],
        profile: str,
        job_trigger: str,
        job_delay_seconds: float,
    ) -> None:
        try:
            if job_delay_seconds > 0:
                # Keep case-save and image-save UX responsive by letting the write
                # and navigation path settle before we enqueue site-level sync work.
                time.sleep(job_delay_seconds)
            with _FEDERATED_RETRIEVAL_SYNC_JOB_LOCK:
                if _PENDING_FEDERATED_RETRIEVAL_SYNC_JOBS.get(key, False):
                    return

            job = _latest_federated_retrieval_sync_job_impl(site_store, retrieval_profile=profile)
            job_status = str((job or {}).get("status") or "").strip().lower()
            if job_status not in {"queued", "running"}:
                queued = _start_federated_retrieval_corpus_sync_impl(
                    site_store,
                    site_id=key[0],
                    payload=SimpleNamespace(
                        execution_mode="auto",
                        retrieval_profile=profile,
                        force_refresh=False,
                    ),
                    execution_device=_preferred_embedding_execution_device(),
                    queue_name_for_job_type=queue_name_for_job_type,
                )
                job = dict(queued.get("job") or {})

            job_id = str((job or {}).get("job_id") or "").strip()
            wait_started_at = time.monotonic()
            while job_id:
                current_job = site_store.get_job(job_id) or job
                current_status = str(current_job.get("status") or "").strip().lower()
                if current_status not in {"queued", "running"}:
                    break
                if max_wait_seconds > 0 and (time.monotonic() - wait_started_at) >= max_wait_seconds:
                    break
                time.sleep(poll_seconds)
        except Exception as exc:
            try:
                print(f"Federated retrieval auto-sync failed for {key}: {exc}")
            except Exception:
                pass
        finally:
            with _FEDERATED_RETRIEVAL_SYNC_JOB_LOCK:
                is_dirty = _PENDING_FEDERATED_RETRIEVAL_SYNC_JOBS.get(key, False)
                latest_trigger = _PENDING_FEDERATED_RETRIEVAL_SYNC_TRIGGERS.get(key, job_trigger)
                if is_dirty:
                    _PENDING_FEDERATED_RETRIEVAL_SYNC_JOBS[key] = False
                    latest_execution_device = _preferred_embedding_execution_device()
                    latest_delay_seconds = _federated_retrieval_sync_delay_seconds(
                        latest_trigger,
                        execution_device=latest_execution_device,
                    )
                    _FEDERATED_RETRIEVAL_SYNC_EXECUTOR.submit(
                        run_sync_job_safe,
                        key,
                        profile,
                        latest_trigger,
                        latest_delay_seconds,
                    )
                else:
                    _PENDING_FEDERATED_RETRIEVAL_SYNC_JOBS.pop(key, None)
                    _PENDING_FEDERATED_RETRIEVAL_SYNC_TRIGGERS.pop(key, None)

    _FEDERATED_RETRIEVAL_SYNC_EXECUTOR.submit(
        run_sync_job_safe,
        job_key,
        normalized_profile,
        trigger,
        delay_seconds,
    )
    return {
        "site_id": site_store.site_id,
        "retrieval_profile": normalized_profile,
        "queued": True,
        "trigger": trigger,
        "delay_seconds": float(delay_seconds),
    }


def _queue_ai_clinic_vector_index_rebuild(
    cp: ControlPlaneStore,
    site_store: SiteStore,
    *,
    trigger: str,
) -> dict[str, Any]:
    if control_plane_split_enabled():
        return {
            "site_id": site_store.site_id,
            "queued": False,
            "reason": "control_plane_split_enabled",
        }
    disable_refresh = os.getenv("KERA_DISABLE_CASE_EMBEDDING_REFRESH", "").strip().lower()
    if disable_refresh in {"1", "true", "yes", "on"}:
        return {
            "site_id": site_store.site_id,
            "queued": False,
            "reason": "disabled",
        }
    model_version = cp.current_global_model()
    if model_version is None or not model_version.get("ready", True):
        return {
            "site_id": site_store.site_id,
            "queued": False,
            "reason": "model_unavailable",
        }

    model_version_id = str(model_version.get("version_id") or "").strip() or "unknown"
    job_key = (site_store.site_id, model_version_id)
    with _VECTOR_INDEX_REBUILD_JOB_LOCK:
        _PENDING_VECTOR_INDEX_REBUILD_TRIGGERS[job_key] = trigger
        if job_key in _PENDING_VECTOR_INDEX_REBUILD_JOBS:
            _PENDING_VECTOR_INDEX_REBUILD_JOBS[job_key] = True
            return {
                "site_id": site_store.site_id,
                "model_version_id": model_version_id,
                "queued": True,
                "deduped": True,
                "trigger": trigger,
            }
        _PENDING_VECTOR_INDEX_REBUILD_JOBS[job_key] = False

    execution_device = _preferred_embedding_execution_device()
    delay_seconds = _ai_clinic_vector_index_rebuild_delay_seconds(
        trigger,
        execution_device=execution_device,
    )

    def run_rebuild_job_safe(
        key: tuple[str, str],
        job_trigger: str,
        job_delay_seconds: float,
    ) -> None:
        job: dict[str, Any] | None = None
        try:
            if job_delay_seconds > 0:
                time.sleep(job_delay_seconds)
            with _VECTOR_INDEX_REBUILD_JOB_LOCK:
                if _PENDING_VECTOR_INDEX_REBUILD_JOBS.get(key, False):
                    return
            workflow = _get_workflow(cp)
            job = site_store.enqueue_job(
                "ai_clinic_vector_index_rebuild",
                {
                    "trigger": job_trigger,
                    "model_version_id": model_version.get("version_id"),
                    "execution_device": execution_device,
                },
            )
            site_store.update_job_status(
                job["job_id"],
                "running",
                {
                    "progress": {
                        "stage": "index",
                        "message": "Rebuilding AI Clinic vector index.",
                        "percent": 50,
                    }
                },
            )
            vector_index = {
                "classifier": workflow.rebuild_case_vector_index(
                    site_store,
                    model_version=model_version,
                    backend="classifier",
                )
            }
            version_id = str(model_version.get("version_id") or "unknown")
            for backend in ("dinov2", "biomedclip"):
                backend_dir = site_store.embedding_dir / version_id / backend
                if backend_dir.exists():
                    vector_index[backend] = workflow.rebuild_case_vector_index(
                        site_store,
                        model_version=model_version,
                        backend=backend,
                    )
            site_store.update_job_status(
                job["job_id"],
                "completed",
                {
                    "progress": {
                        "stage": "completed",
                        "message": "AI Clinic vector index rebuild completed.",
                        "percent": 100,
                    },
                    "response": {
                        "model_version_id": model_version.get("version_id"),
                        "execution_device": execution_device,
                        "vector_index": vector_index,
                    },
                },
            )
        except Exception as exc:
            if job is not None:
                site_store.update_job_status(
                    job["job_id"],
                    "failed",
                    {
                        "progress": {
                            "stage": "failed",
                            "message": "AI Clinic vector index rebuild failed.",
                            "percent": 100,
                        },
                        "error": str(exc),
                    },
                )
            try:
                print(f"AI Clinic vector index rebuild failed for {key}: {exc}")
            except Exception:
                pass
        finally:
            with _VECTOR_INDEX_REBUILD_JOB_LOCK:
                is_dirty = _PENDING_VECTOR_INDEX_REBUILD_JOBS.get(key, False)
                latest_trigger = _PENDING_VECTOR_INDEX_REBUILD_TRIGGERS.get(key, job_trigger)
                if is_dirty:
                    _PENDING_VECTOR_INDEX_REBUILD_JOBS[key] = False
                    latest_execution_device = _preferred_embedding_execution_device()
                    latest_delay_seconds = _ai_clinic_vector_index_rebuild_delay_seconds(
                        latest_trigger,
                        execution_device=latest_execution_device,
                    )
                    _VECTOR_INDEX_REBUILD_EXECUTOR.submit(
                        run_rebuild_job_safe,
                        key,
                        latest_trigger,
                        latest_delay_seconds,
                    )
                else:
                    _PENDING_VECTOR_INDEX_REBUILD_JOBS.pop(key, None)
                    _PENDING_VECTOR_INDEX_REBUILD_TRIGGERS.pop(key, None)

    _VECTOR_INDEX_REBUILD_EXECUTOR.submit(
        run_rebuild_job_safe,
        job_key,
        trigger,
        delay_seconds,
    )
    return {
        "site_id": site_store.site_id,
        "model_version_id": model_version_id,
        "queued": True,
        "trigger": trigger,
        "delay_seconds": float(delay_seconds),
    }


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
    return _queue_site_embedding_backfill_impl(
        cp,
        site_store,
        model_version=model_version,
        execution_device=execution_device,
        force_refresh=force_refresh,
        case_summaries=case_summaries,
        trigger=trigger,
    )


def _build_embedding_backfill_status(
    cp: ControlPlaneStore,
    site_store: SiteStore,
    *,
    model_version: dict[str, Any],
) -> dict[str, Any]:
    return _build_embedding_backfill_status_impl(
        cp,
        site_store,
        model_version=model_version,
        workflow_factory=_get_workflow,
    )


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


def _normalize_default_storage_root(value: str) -> Path:
    candidate = _normalize_storage_root(value)
    looks_like_storage_bundle = candidate.name.strip().lower() == "kera_data" or any(
        (candidate / child_name).exists() for child_name in ("sites", "control_plane", "models")
    )
    if not looks_like_storage_bundle:
        return candidate

    site_root = candidate / "sites"
    try:
        site_root.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise ValueError(f"Unable to create or access the site storage directory: {exc}") from exc
    if not site_root.is_dir():
        raise ValueError("Site storage directory must be a directory.")
    return site_root.resolve()
_VALID_ORIGIN_RE = re.compile(r"^https?://[A-Za-z0-9\-\.]+(?::\d+)?$")


class _SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add minimal security headers to every API response."""

    async def dispatch(self, request: StarletteRequest, call_next: Any) -> StarletteResponse:
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        # Disable legacy XSS auditor; modern browsers rely on CSP instead.
        response.headers.setdefault("X-XSS-Protection", "0")
        return response


def create_app() -> FastAPI:
    app = FastAPI(title="K-ERA Research API", version="0.2.0")

    allowed_origins = [
        origin
        for port in range(3000, 3020)
        for origin in (f"http://localhost:{port}", f"http://127.0.0.1:{port}")
    ]
    extra_origin = os.getenv("KERA_FRONTEND_ORIGIN", "").strip()
    if extra_origin:
        if _VALID_ORIGIN_RE.match(extra_origin):
            allowed_origins.append(extra_origin)
        else:
            import logging as _logging
            _logging.getLogger(__name__).warning(
                "KERA_FRONTEND_ORIGIN '%s' is not a valid URL, ignoring.", extra_origin
            )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept"],
    )
    app.add_middleware(_SecurityHeadersMiddleware)

    route_supports = build_route_supports(
        get_control_plane=get_control_plane,
        get_current_user=get_current_user,
        get_approved_user=get_approved_user,
        google_client_ids=_google_client_ids,
        desktop_self_check=_desktop_self_check,
        load_node_credentials=load_node_credentials,
        node_credentials_status=node_credentials_status,
        save_node_credentials=save_node_credentials,
        clear_node_credentials=clear_node_credentials,
        database_topology=DATABASE_TOPOLOGY,
        remote_node_os_info=_remote_node_os_info,
        local_control_plane_dev_auth_enabled=_local_control_plane_dev_auth_enabled,
        get_app_version=lambda: app.version,
        RemoteControlPlaneClient=RemoteControlPlaneClient,
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
        queue_ai_clinic_embedding_backfill=_queue_ai_clinic_embedding_backfill,
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
        queue_ai_clinic_vector_index_rebuild=_queue_ai_clinic_vector_index_rebuild,
        queue_federated_retrieval_corpus_sync=_queue_federated_retrieval_corpus_sync,
        normalize_storage_root=_normalize_storage_root,
        normalize_default_storage_root=_normalize_default_storage_root,
        invalidate_site_storage_root_cache=invalidate_site_storage_root_cache,
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
        ImageLevelFederatedRoundRequest=ImageLevelFederatedRoundRequest,
        VisitLevelFederatedRoundRequest=VisitLevelFederatedRoundRequest,
        CrossValidationRunRequest=CrossValidationRunRequest,
        SSLPretrainingRunRequest=SSLPretrainingRunRequest,
        RetrievalBaselineRequest=RetrievalBaselineRequest,
        CaseValidationCompareRequest=CaseValidationCompareRequest,
        EmbeddingBackfillRequest=EmbeddingBackfillRequest,
        FederatedRetrievalSyncRequest=FederatedRetrievalSyncRequest,
        LoginRequest=LoginRequest,
        GoogleLoginRequest=GoogleLoginRequest,
        AccessRequestCreateRequest=AccessRequestCreateRequest,
        AccessRequestReviewRequest=AccessRequestReviewRequest,
        StorageSettingsUpdateRequest=StorageSettingsUpdateRequest,
        ModelUpdateReviewRequest=ModelUpdateReviewRequest,
        ModelVersionPublishRequest=ModelVersionPublishRequest,
        ModelVersionAutoPublishRequest=ModelVersionAutoPublishRequest,
        AggregationRunRequest=AggregationRunRequest,
        ReleaseRolloutRequest=ReleaseRolloutRequest,
        ProjectCreateRequest=ProjectCreateRequest,
        SiteCreateRequest=SiteCreateRequest,
        SiteUpdateRequest=SiteUpdateRequest,
        UserUpsertRequest=UserUpsertRequest,
        SiteStorageRootUpdateRequest=SiteStorageRootUpdateRequest,
        SiteMetadataRecoveryRequest=SiteMetadataRecoveryRequest,
        LocalControlPlaneNodeRegisterRequest=LocalControlPlaneNodeRegisterRequest,
        LocalControlPlaneNodeCredentialsRequest=LocalControlPlaneNodeCredentialsRequest,
        LocalControlPlaneSmokeRequest=LocalControlPlaneSmokeRequest,
    )

    app.include_router(build_desktop_router(route_supports.desktop))
    app.include_router(build_auth_router(route_supports.auth))
    app.include_router(build_admin_router(route_supports.admin))
    app.include_router(build_sites_router(route_supports.sites))
    app.include_router(build_cases_router(route_supports.cases))

    @app.on_event("startup")
    def _startup_remote_control_plane_sync() -> None:
        cp = get_control_plane()
        start_control_plane_sync_loop(
            app,
            cp,
            heartbeat_interval_seconds=float(CONTROL_PLANE_HEARTBEAT_INTERVAL_SECONDS),
            bootstrap_refresh_seconds=float(CONTROL_PLANE_BOOTSTRAP_REFRESH_SECONDS),
            app_version=app.version,
            os_info=_remote_node_os_info(),
        )

    @app.on_event("shutdown")
    def _shutdown_remote_control_plane_sync() -> None:
        stop_control_plane_sync_loop(app)

    return app


app = create_app()
