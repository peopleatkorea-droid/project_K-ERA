from __future__ import annotations

import os
import sqlite3
import threading
import warnings
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote

from alembic import command
from alembic.config import Config
from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    Float,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    UniqueConstraint,
    create_engine,
    inspect,
    select,
    text,
    update,
)
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.exc import DatabaseError as SQLAlchemyDatabaseError

from kera_research.config import PATIENT_REFERENCE_SALT, STORAGE_DIR


def _configure_sqlite_wal(dbapi_conn: object, _connection_record: object) -> None:
    """Enable WAL journal mode for SQLite to allow concurrent reads during writes."""
    cursor = dbapi_conn.cursor()  # type: ignore[attr-defined]
    try:
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
    finally:
        cursor.close()


def _apply_sqlite_wal(engine: Engine, database_url: str) -> None:
    if database_url.startswith("sqlite"):
        event.listen(engine, "connect", _configure_sqlite_wal)
from kera_research.domain import make_patient_reference_id, visit_index_from_label


def _default_database_url() -> str:
    database_path = (STORAGE_DIR / "kera.db").resolve().as_posix()
    return f"sqlite:///{database_path}"


def _default_local_control_plane_cache_url() -> str:
    database_path = (STORAGE_DIR / "control_plane_cache.db").resolve().as_posix()
    return f"sqlite:///{database_path}"


def _sqlite_url_for_path(path: Path) -> str:
    return f"sqlite:///{path.resolve().as_posix()}"


def _sqlite_database_path(database_url: str) -> Path | None:
    normalized = str(database_url or "").strip()
    if not normalized.startswith("sqlite:///"):
        return None
    raw_path = unquote(normalized[len("sqlite:///") :]).strip()
    if not raw_path or raw_path == ":memory:":
        return None
    if os.name == "nt" and raw_path.startswith("/") and len(raw_path) >= 3 and raw_path[2] == ":":
        raw_path = raw_path[1:]
    return Path(raw_path)


def _sqlite_file_is_malformed(path: Path) -> bool:
    if not path.exists() or not path.is_file():
        return False
    try:
        connection = sqlite3.connect(path)
        try:
            connection.execute("SELECT name FROM sqlite_master LIMIT 1").fetchone()
        finally:
            connection.close()
        return False
    except sqlite3.DatabaseError as exc:
        return _is_malformed_sqlite_error(exc)
    except OSError:
        return False


def _recovered_control_plane_cache_path(database_path: Path) -> Path:
    suffix = database_path.suffix
    stem = database_path.stem
    candidate = database_path.with_name(f"{stem}.recovered{suffix}")
    recovery_index = 2
    while _sqlite_file_is_malformed(candidate):
        candidate = database_path.with_name(f"{stem}.recovered{recovery_index}{suffix}")
        recovery_index += 1
    return candidate


def _is_malformed_sqlite_error(error: BaseException) -> bool:
    message = str(error or "").strip().lower()
    return "database disk image is malformed" in message or "file is not a database" in message


def _can_rebuild_local_control_plane_cache(error: BaseException) -> bool:
    return (
        isinstance(error, SQLAlchemyDatabaseError)
        and DATABASE_TOPOLOGY["control_plane_connection_mode"] == "remote_api_cache"
        and DATABASE_TOPOLOGY["control_plane_backend"] == "sqlite"
        and _is_malformed_sqlite_error(error)
        and _sqlite_database_path(CONTROL_PLANE_DATABASE_URL) is not None
    )


def _quarantine_local_control_plane_cache() -> list[Path]:
    database_path = _sqlite_database_path(CONTROL_PLANE_DATABASE_URL)
    if database_path is None:
        return []
    CONTROL_PLANE_ENGINE.dispose()
    quarantine_suffix = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ.corrupt.bak")
    moved_paths: list[Path] = []
    for candidate in (
        database_path,
        Path(f"{database_path}-wal"),
        Path(f"{database_path}-shm"),
    ):
        if not candidate.exists():
            continue
        target = Path(f"{candidate}.{quarantine_suffix}")
        candidate.replace(target)
        moved_paths.append(target)
    return moved_paths


def _control_plane_remote_api_enabled() -> bool:
    return bool(
        (os.getenv("KERA_CONTROL_PLANE_API_BASE_URL") or os.getenv("NEXT_PUBLIC_KERA_CONTROL_PLANE_API_BASE_URL") or "")
        .strip()
    )


def _resolve_control_plane_database_url() -> str:
    local_cache_url = (
        os.getenv("KERA_LOCAL_CONTROL_PLANE_DATABASE_URL")
        or os.getenv("KERA_CONTROL_PLANE_LOCAL_DATABASE_URL")
        or ""
    ).strip()
    if local_cache_url:
        local_cache_path = _sqlite_database_path(local_cache_url)
        if local_cache_path is not None and _sqlite_file_is_malformed(local_cache_path):
            recovered_path = _recovered_control_plane_cache_path(local_cache_path)
            warnings.warn(
                "The local control-plane cache database is malformed. "
                f"Using a fresh recovery cache at {recovered_path.name}.",
                RuntimeWarning,
                stacklevel=2,
            )
            return _sqlite_url_for_path(recovered_path)
        return local_cache_url
    if _control_plane_remote_api_enabled():
        default_cache_url = _default_local_control_plane_cache_url()
        default_cache_path = _sqlite_database_path(default_cache_url)
        if default_cache_path is not None and _sqlite_file_is_malformed(default_cache_path):
            recovered_path = _recovered_control_plane_cache_path(default_cache_path)
            warnings.warn(
                "The default local control-plane cache database is malformed. "
                f"Using a fresh recovery cache at {recovered_path.name}.",
                RuntimeWarning,
                stacklevel=2,
            )
            return _sqlite_url_for_path(recovered_path)
        return default_cache_url
    legacy_url = os.getenv("KERA_DATABASE_URL") or os.getenv("DATABASE_URL")
    return (
        os.getenv("KERA_CONTROL_PLANE_DATABASE_URL")
        or os.getenv("KERA_AUTH_DATABASE_URL")
        or legacy_url
        or _default_database_url()
    )


def _resolve_data_plane_database_url() -> str:
    # The data plane (images, patients, visits) is always local — never inherit
    # KERA_DATABASE_URL / DATABASE_URL which may point to a remote Neon instance.
    return (
        os.getenv("KERA_DATA_PLANE_DATABASE_URL")
        or os.getenv("KERA_LOCAL_DATABASE_URL")
        or _default_database_url()
    )


def _connect_args_for(database_url: str) -> dict[str, object]:
    return {"check_same_thread": False} if database_url.startswith("sqlite") else {}


def _engine_kwargs_for(database_url: str) -> dict[str, object]:
    """Return extra kwargs tuned for the database type.

    For cloud PostgreSQL (e.g. Neon) keep a small persistent connection pool so
    parallel requests reuse connections instead of opening a new one each time.
    For SQLite use the default NullPool-equivalent (connect_args handles threading).
    """
    if database_url.startswith("postgresql") or database_url.startswith("postgres"):
        return {
            "pool_size": 10,
            "max_overflow": 10,
            "pool_timeout": 30,
            "pool_recycle": 180,  # Neon idle timeout is 300s, recycle before that
            "pool_pre_ping": True,  # Handled here instead of global for clarity
        }
    return {}


def database_backend_label(database_url: str) -> str:
    normalized = str(database_url or "").strip().lower()
    if normalized.startswith("postgresql") or normalized.startswith("postgres"):
        return "postgresql"
    if normalized.startswith("sqlite"):
        return "sqlite"
    return "other"


def _configured_database_env_names() -> dict[str, tuple[str, ...]]:
    legacy_names = tuple(
        env_name
        for env_name in ("KERA_DATABASE_URL", "DATABASE_URL")
        if str(os.getenv(env_name) or "").strip()
    )
    split_names = tuple(
        env_name
        for env_name in (
            "KERA_CONTROL_PLANE_DATABASE_URL",
            "KERA_AUTH_DATABASE_URL",
            "KERA_DATA_PLANE_DATABASE_URL",
            "KERA_LOCAL_DATABASE_URL",
            "KERA_LOCAL_CONTROL_PLANE_DATABASE_URL",
            "KERA_CONTROL_PLANE_LOCAL_DATABASE_URL",
        )
        if str(os.getenv(env_name) or "").strip()
    )
    return {
        "legacy": legacy_names,
        "split": split_names,
    }


def _database_topology_summary(control_plane_url: str, data_plane_url: str) -> dict[str, object]:
    configured_env_names = _configured_database_env_names()
    control_plane_remote_api_enabled = _control_plane_remote_api_enabled()
    return {
        "control_plane_split_enabled": control_plane_url != data_plane_url,
        "control_plane_connection_mode": "remote_api_cache" if control_plane_remote_api_enabled else "direct_db",
        "control_plane_backend": database_backend_label(control_plane_url),
        "data_plane_backend": database_backend_label(data_plane_url),
        "data_plane_local_sqlite": database_backend_label(data_plane_url) == "sqlite",
        "legacy_database_env_present": bool(configured_env_names["legacy"]),
        "legacy_database_env_names": configured_env_names["legacy"],
        "split_database_env_names": configured_env_names["split"],
    }


def _validate_database_configuration(topology: dict[str, object]) -> None:
    if topology["control_plane_connection_mode"] == "remote_api_cache":
        if topology["control_plane_backend"] != "sqlite":
            raise RuntimeError(
                "KERA_CONTROL_PLANE_API_BASE_URL requires a local SQLite control-plane cache. "
                "Configure KERA_LOCAL_CONTROL_PLANE_DATABASE_URL or leave it unset to use the default local cache path."
            )
        if topology["data_plane_backend"] != "sqlite":
            raise RuntimeError(
                "KERA_CONTROL_PLANE_API_BASE_URL local-node mode requires KERA_DATA_PLANE_DATABASE_URL "
                "to point to a local SQLite data plane."
            )
    if topology["legacy_database_env_present"] and topology["split_database_env_names"]:
        warnings.warn(
            "Legacy KERA_DATABASE_URL/DATABASE_URL is set alongside split control/data plane database settings. "
            "The split variables take precedence, but the legacy env can still mask deployment mistakes.",
            RuntimeWarning,
            stacklevel=2,
        )


CONTROL_PLANE_DATABASE_URL = _resolve_control_plane_database_url()
DATA_PLANE_DATABASE_URL = _resolve_data_plane_database_url()
DATABASE_URL = CONTROL_PLANE_DATABASE_URL
DATABASE_TOPOLOGY = _database_topology_summary(CONTROL_PLANE_DATABASE_URL, DATA_PLANE_DATABASE_URL)
_validate_database_configuration(DATABASE_TOPOLOGY)

CONTROL_PLANE_ENGINE: Engine = create_engine(
    CONTROL_PLANE_DATABASE_URL,
    future=True,
    connect_args=_connect_args_for(CONTROL_PLANE_DATABASE_URL),
    **_engine_kwargs_for(CONTROL_PLANE_DATABASE_URL),
)
DATA_PLANE_ENGINE: Engine = create_engine(
    DATA_PLANE_DATABASE_URL,
    future=True,
    connect_args=_connect_args_for(DATA_PLANE_DATABASE_URL),
    **_engine_kwargs_for(DATA_PLANE_DATABASE_URL),
)
_apply_sqlite_wal(CONTROL_PLANE_ENGINE, CONTROL_PLANE_DATABASE_URL)
_apply_sqlite_wal(DATA_PLANE_ENGINE, DATA_PLANE_DATABASE_URL)
ENGINE = CONTROL_PLANE_ENGINE
CONTROL_PLANE_METADATA = MetaData()
DATA_PLANE_METADATA = MetaData()
METADATA = CONTROL_PLANE_METADATA
_CONTROL_PLANE_DB_INITIALIZED = False
_DATA_PLANE_DB_INITIALIZED = False
_CONTROL_PLANE_DB_INIT_LOCK = threading.Lock()
_DATA_PLANE_DB_INIT_LOCK = threading.Lock()
_DATA_PLANE_SQLITE_SEARCH_READY = False
DATA_PLANE_SCHEMA_REVISION = "2026-04-13"
CONTROL_PLANE_ALEMBIC_BASELINE_REVISION = "20260413_01"

users = Table(
    "users",
    CONTROL_PLANE_METADATA,
    Column("user_id", String(64), primary_key=True),
    Column("username", String(255), nullable=False, unique=True, index=True),
    Column("google_sub", String(255), nullable=True),
    Column("public_alias", String(255), nullable=True),
    Column("password", Text, nullable=False),
    Column("role", String(32), nullable=False),
    Column("full_name", String(255), nullable=False),
    Column("site_ids", JSON, nullable=True),
    Column("registry_consents", JSON, nullable=True),
)

projects = Table(
    "projects",
    CONTROL_PLANE_METADATA,
    Column("project_id", String(64), primary_key=True),
    Column("name", String(255), nullable=False),
    Column("description", Text, nullable=False, default=""),
    Column("owner_user_id", String(64), nullable=False),
    Column("site_ids", JSON, nullable=False, default=list),
    Column("created_at", String(64), nullable=False),
)

sites = Table(
    "sites",
    CONTROL_PLANE_METADATA,
    Column("site_id", String(64), primary_key=True),
    Column("project_id", String(64), nullable=False, index=True),
    Column("display_name", String(255), nullable=False),
    Column("hospital_name", String(255), nullable=False, default=""),
    Column("source_institution_id", String(128), nullable=True, index=True),
    Column("local_storage_root", Text, nullable=False),
    Column("research_registry_enabled", Boolean, nullable=False, default=True),
    Column("created_at", String(64), nullable=False),
)

institution_directory = Table(
    "institution_directory",
    CONTROL_PLANE_METADATA,
    Column("institution_id", String(128), primary_key=True),
    Column("source", String(32), nullable=False, default="hira"),
    Column("name", String(255), nullable=False, index=True),
    Column("institution_type_code", String(32), nullable=False, default=""),
    Column("institution_type_name", String(128), nullable=False, default=""),
    Column("address", Text, nullable=False, default=""),
    Column("phone", String(64), nullable=False, default=""),
    Column("homepage", String(255), nullable=False, default=""),
    Column("sido_code", String(16), nullable=False, default="", index=True),
    Column("sggu_code", String(16), nullable=False, default="", index=True),
    Column("emdong_name", String(128), nullable=False, default=""),
    Column("postal_code", String(32), nullable=False, default=""),
    Column("x_pos", String(64), nullable=False, default=""),
    Column("y_pos", String(64), nullable=False, default=""),
    Column("ophthalmology_available", Boolean, nullable=False, default=True),
    Column("open_status", String(32), nullable=False, default="active", index=True),
    Column("source_payload", JSON, nullable=False, default=dict),
    Column("synced_at", String(64), nullable=False),
)

organism_catalog = Table(
    "organism_catalog",
    CONTROL_PLANE_METADATA,
    Column("catalog_id", Integer, primary_key=True, autoincrement=True),
    Column("culture_category", String(32), nullable=False, index=True),
    Column("species_name", String(255), nullable=False),
    UniqueConstraint("culture_category", "species_name", name="uq_organism_catalog_category_species"),
)

organism_requests = Table(
    "organism_requests",
    CONTROL_PLANE_METADATA,
    Column("request_id", String(64), primary_key=True),
    Column("culture_category", String(32), nullable=False, index=True),
    Column("requested_species", String(255), nullable=False),
    Column("requested_by", String(64), nullable=False),
    Column("status", String(32), nullable=False, index=True),
    Column("reviewed_by", String(64), nullable=True),
    Column("created_at", String(64), nullable=False),
    Column("reviewed_at", String(64), nullable=True),
)

access_requests = Table(
    "access_requests",
    CONTROL_PLANE_METADATA,
    Column("request_id", String(64), primary_key=True),
    Column("user_id", String(64), nullable=False, index=True),
    Column("email", String(255), nullable=False, index=True),
    Column("requested_site_id", String(128), nullable=False, index=True),
    Column("requested_site_label", String(255), nullable=False, default=""),
    Column("requested_site_source", String(32), nullable=False, default="site"),
    Column("requested_role", String(32), nullable=False),
    Column("message", Text, nullable=False, default=""),
    Column("status", String(32), nullable=False, index=True),
    Column("reviewed_by", String(64), nullable=True),
    Column("reviewer_notes", Text, nullable=False, default=""),
    Column("created_at", String(64), nullable=False),
    Column("reviewed_at", String(64), nullable=True),
)

auth_rate_limits = Table(
    "auth_rate_limits",
    CONTROL_PLANE_METADATA,
    Column("attempt_id", Integer, primary_key=True, autoincrement=True),
    Column("scope", String(64), nullable=False),
    Column("client_key", String(255), nullable=False),
    Column("attempted_at_epoch", Float, nullable=False),
)

control_plane_schema_state = Table(
    "control_plane_schema_state",
    CONTROL_PLANE_METADATA,
    Column("schema_name", String(64), primary_key=True),
    Column("schema_revision", String(64), nullable=False),
    Column("recorded_at", String(64), nullable=False),
)

validation_runs = Table(
    "validation_runs",
    CONTROL_PLANE_METADATA,
    Column("validation_id", String(64), primary_key=True),
    Column("project_id", String(64), nullable=False, index=True),
    Column("site_id", String(64), nullable=False, index=True),
    Column("model_version", String(255), nullable=False),
    Column("run_date", String(64), nullable=False, index=True),
    Column("n_cases", Integer, nullable=True),
    Column("n_images", Integer, nullable=True),
    Column("AUROC", Float, nullable=True),
    Column("accuracy", Float, nullable=True),
    Column("sensitivity", Float, nullable=True),
    Column("specificity", Float, nullable=True),
    Column("F1", Float, nullable=True),
    Column("case_predictions_path", Text, nullable=False),
    Column("summary_json", JSON, nullable=False),
)

validation_cases = Table(
    "validation_cases",
    CONTROL_PLANE_METADATA,
    Column("validation_case_id", String(160), primary_key=True),
    Column("validation_id", String(64), nullable=False, index=True),
    Column("project_id", String(64), nullable=False, index=True),
    Column("site_id", String(64), nullable=False, index=True),
    Column("patient_reference_id", String(64), nullable=False, index=True),
    Column("case_reference_id", String(64), nullable=False, index=True),
    Column("visit_index", Integer, nullable=False, index=True),
    Column("model_version_id", String(64), nullable=True, index=True),
    Column("model_version", String(255), nullable=True),
    Column("run_date", String(64), nullable=False, index=True),
    Column("true_label", String(64), nullable=True),
    Column("predicted_label", String(64), nullable=False),
    Column("prediction_probability", Float, nullable=False),
    Column("is_correct", Boolean, nullable=True),
    Column("n_source_images", Integer, nullable=True),
    Column("crop_mode", String(64), nullable=True),
    Column("has_gradcam", Boolean, nullable=False, default=False),
    Column("has_roi_crop", Boolean, nullable=False, default=False),
    Column("has_medsam_mask", Boolean, nullable=False, default=False),
    Column("created_at", String(64), nullable=False),
    Column("payload_json", JSON, nullable=False, default=dict),
    UniqueConstraint("validation_id", "case_reference_id", name="uq_validation_cases_validation_case"),
)

model_versions = Table(
    "model_versions",
    CONTROL_PLANE_METADATA,
    Column("version_id", String(64), primary_key=True),
    Column("version_name", String(255), nullable=False, index=True),
    Column("architecture", String(64), nullable=False, index=True),
    Column("stage", String(64), nullable=True, index=True),
    Column("created_at", String(64), nullable=True, index=True),
    Column("ready", Boolean, nullable=False, default=True),
    Column("is_current", Boolean, nullable=False, default=False),
    Column("payload_json", JSON, nullable=False),
)

model_updates = Table(
    "model_updates",
    CONTROL_PLANE_METADATA,
    Column("update_id", String(64), primary_key=True),
    Column("site_id", String(64), nullable=True, index=True),
    Column("architecture", String(64), nullable=True, index=True),
    Column("status", String(64), nullable=True, index=True),
    Column("created_at", String(64), nullable=True, index=True),
    Column("payload_json", JSON, nullable=False),
)

experiments = Table(
    "experiments",
    CONTROL_PLANE_METADATA,
    Column("experiment_id", String(64), primary_key=True),
    Column("site_id", String(64), nullable=True, index=True),
    Column("experiment_type", String(64), nullable=False, index=True),
    Column("status", String(64), nullable=False, index=True),
    Column("model_version_id", String(64), nullable=True, index=True),
    Column("created_at", String(64), nullable=False, index=True),
    Column("payload_json", JSON, nullable=False),
)

contributions = Table(
    "contributions",
    CONTROL_PLANE_METADATA,
    Column("contribution_id", String(64), primary_key=True),
    Column("user_id", String(64), nullable=True, index=True),
    Column("site_id", String(64), nullable=True, index=True),
    Column("created_at", String(64), nullable=True, index=True),
    Column("payload_json", JSON, nullable=False),
)

aggregations = Table(
    "aggregations",
    CONTROL_PLANE_METADATA,
    Column("aggregation_id", String(64), primary_key=True),
    Column("base_model_version_id", String(64), nullable=True, index=True),
    Column("new_version_name", String(255), nullable=False),
    Column("architecture", String(64), nullable=True, index=True),
    Column("total_cases", Integer, nullable=True),
    Column("created_at", String(64), nullable=True, index=True),
    Column("payload_json", JSON, nullable=False),
)

app_settings = Table(
    "app_settings",
    CONTROL_PLANE_METADATA,
    Column("setting_key", String(128), primary_key=True),
    Column("setting_value", Text, nullable=False),
    Column("updated_at", String(64), nullable=False),
)

patients = Table(
    "patients",
    DATA_PLANE_METADATA,
    Column("patient_row_id", Integer, primary_key=True, autoincrement=True),
    Column("site_id", String(64), nullable=False, index=True),
    Column("patient_id", String(255), nullable=False),
    Column("created_by_user_id", String(64), nullable=True, index=True),
    Column("sex", String(32), nullable=False),
    Column("age", Integer, nullable=False),
    Column("chart_alias", String(255), nullable=False, default=""),
    Column("local_case_code", String(255), nullable=False, default=""),
    Column("created_at", String(64), nullable=False),
    UniqueConstraint("site_id", "patient_id", name="uq_patients_site_patient"),
)

visits = Table(
    "visits",
    DATA_PLANE_METADATA,
    Column("visit_id", String(64), primary_key=True),
    Column("site_id", String(64), nullable=False, index=True),
    Column("patient_id", String(255), nullable=False, index=True),
    Column("patient_reference_id", String(64), nullable=True, index=True),
    Column("created_by_user_id", String(64), nullable=True, index=True),
    Column("visit_date", String(32), nullable=False, index=True),
    Column("visit_index", Integer, nullable=True, index=True),
    Column("actual_visit_date", String(32), nullable=True),
    Column("culture_status", String(32), nullable=False, default="unknown", index=True),
    Column("culture_confirmed", Boolean, nullable=False),
    Column("culture_category", String(32), nullable=False, index=True),
    Column("culture_species", String(255), nullable=False),
    Column("contact_lens_use", String(64), nullable=False),
    Column("predisposing_factor", JSON, nullable=False),
    Column("additional_organisms", JSON, nullable=False, default=list),
    Column("other_history", Text, nullable=False, default=""),
    Column("visit_status", String(32), nullable=False, index=True),
    Column("active_stage", Boolean, nullable=False),
    Column("is_initial_visit", Boolean, nullable=False, default=False),
    Column("smear_result", String(64), nullable=False, default=""),
    Column("polymicrobial", Boolean, nullable=False, default=False),
    Column("research_registry_status", String(32), nullable=False, default="analysis_only", index=True),
    Column("research_registry_updated_at", String(64), nullable=True),
    Column("research_registry_updated_by", String(64), nullable=True),
    Column("research_registry_source", String(64), nullable=True),
    Column("fl_retained", Boolean, nullable=False, default=False, index=True),
    Column("fl_retained_at", String(64), nullable=True),
    Column("fl_retention_scopes", JSON, nullable=False, default=list),
    Column("fl_retention_last_update_id", String(64), nullable=True),
    Column("soft_deleted_at", String(64), nullable=True, index=True),
    Column("soft_delete_reason", String(128), nullable=True),
    Column("created_at", String(64), nullable=False),
    UniqueConstraint("site_id", "patient_id", "visit_date", name="uq_visits_site_patient_date"),
)

images = Table(
    "images",
    DATA_PLANE_METADATA,
    Column("image_id", String(64), primary_key=True),
    Column("visit_id", String(64), nullable=False, index=True),
    Column("site_id", String(64), nullable=False, index=True),
    Column("patient_id", String(255), nullable=False, index=True),
    Column("visit_date", String(32), nullable=False, index=True),
    Column("created_by_user_id", String(64), nullable=True, index=True),
    Column("view", String(32), nullable=False, index=True),
    Column("image_path", Text, nullable=False),
    Column("is_representative", Boolean, nullable=False, default=False),
    Column("lesion_prompt_box", JSON, nullable=True),
    Column("has_lesion_box", Boolean, nullable=False, default=False),
    Column("has_roi_crop", Boolean, nullable=False, default=False),
    Column("has_medsam_mask", Boolean, nullable=False, default=False),
    Column("has_lesion_crop", Boolean, nullable=False, default=False),
    Column("has_lesion_mask", Boolean, nullable=False, default=False),
    Column("quality_scores", JSON, nullable=True),
    Column("artifact_status_updated_at", String(64), nullable=True),
    Column("soft_deleted_at", String(64), nullable=True, index=True),
    Column("soft_delete_reason", String(128), nullable=True),
    Column("uploaded_at", String(64), nullable=False),
)

site_patient_splits = Table(
    "site_patient_splits",
    DATA_PLANE_METADATA,
    Column("site_id", String(64), primary_key=True),
    Column("split_json", JSON, nullable=False),
    Column("updated_at", String(64), nullable=False),
)

site_jobs = Table(
    "site_jobs",
    DATA_PLANE_METADATA,
    Column("job_id", String(64), primary_key=True),
    Column("site_id", String(64), nullable=False, index=True),
    Column("job_type", String(64), nullable=False, index=True),
    Column("queue_name", String(64), nullable=False, index=True, default="default"),
    Column("priority", Integer, nullable=False, default=100),
    Column("status", String(64), nullable=False, index=True),
    Column("attempt_count", Integer, nullable=False, default=0),
    Column("max_attempts", Integer, nullable=False, default=1),
    Column("claimed_by", String(128), nullable=True, index=True),
    Column("claimed_at", String(64), nullable=True),
    Column("heartbeat_at", String(64), nullable=True),
    Column("available_at", String(64), nullable=True, index=True),
    Column("started_at", String(64), nullable=True),
    Column("finished_at", String(64), nullable=True),
    Column("payload_json", JSON, nullable=False),
    Column("result_json", JSON, nullable=True),
    Column("created_at", String(64), nullable=False),
    Column("updated_at", String(64), nullable=True),
)

data_plane_schema_state = Table(
    "data_plane_schema_state",
    DATA_PLANE_METADATA,
    Column("schema_name", String(64), primary_key=True),
    Column("schema_revision", String(64), nullable=False),
    Column("recorded_at", String(64), nullable=False),
)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _record_schema_state(engine: Engine, table: Table, schema_name: str, schema_revision: str) -> None:
    recorded_at = _utc_now_iso()
    with engine.begin() as conn:
        existing = conn.execute(
            select(table.c.schema_name).where(table.c.schema_name == schema_name)
        ).scalar_one_or_none()
        if existing is None:
            conn.execute(
                table.insert().values(
                    schema_name=schema_name,
                    schema_revision=schema_revision,
                    recorded_at=recorded_at,
                )
            )
            return
        conn.execute(
            update(table)
            .where(table.c.schema_name == schema_name)
            .values(
                schema_revision=schema_revision,
                recorded_at=recorded_at,
            )
        )


def build_control_plane_alembic_config() -> Config:
    script_location = Path(__file__).resolve().parent / "alembic"
    config = Config()
    config.set_main_option("script_location", str(script_location))
    config.set_main_option("sqlalchemy.url", CONTROL_PLANE_DATABASE_URL)
    config.set_main_option("version_table", "alembic_version")
    config.attributes["configure_logger"] = False
    config.attributes["control_plane_metadata"] = CONTROL_PLANE_METADATA
    return config


def _upgrade_control_plane_schema_with_alembic() -> None:
    command.upgrade(build_control_plane_alembic_config(), "head")


def current_control_plane_alembic_revision() -> str:
    with CONTROL_PLANE_ENGINE.begin() as conn:
        revision = conn.exec_driver_sql(
            "SELECT version_num FROM alembic_version LIMIT 1"
        ).scalar_one_or_none()
    normalized_revision = str(revision or "").strip()
    return normalized_revision or CONTROL_PLANE_ALEMBIC_BASELINE_REVISION


def init_control_plane_db() -> None:
    global _CONTROL_PLANE_DB_INITIALIZED
    if _CONTROL_PLANE_DB_INITIALIZED:
        return
    with _CONTROL_PLANE_DB_INIT_LOCK:
        if _CONTROL_PLANE_DB_INITIALIZED:
            return
        rebuild_cache = False
        try:
            CONTROL_PLANE_METADATA.create_all(CONTROL_PLANE_ENGINE)
            _migrate_control_plane_schema()
        except Exception as exc:
            if not _can_rebuild_local_control_plane_cache(exc):
                raise
            rebuild_cache = True
        if rebuild_cache:
            moved_paths = _quarantine_local_control_plane_cache()
            warnings.warn(
                "Rebuilt the malformed local control-plane cache database. "
                f"Backed up files: {', '.join(path.name for path in moved_paths) or 'none'}",
                RuntimeWarning,
                stacklevel=2,
            )
            CONTROL_PLANE_METADATA.create_all(CONTROL_PLANE_ENGINE)
            _migrate_control_plane_schema()
        _upgrade_control_plane_schema_with_alembic()
        _record_schema_state(
            CONTROL_PLANE_ENGINE,
            control_plane_schema_state,
            "control_plane",
            current_control_plane_alembic_revision(),
        )
        _CONTROL_PLANE_DB_INITIALIZED = True


def init_data_plane_db() -> None:
    global _DATA_PLANE_DB_INITIALIZED
    if _DATA_PLANE_DB_INITIALIZED:
        return
    with _DATA_PLANE_DB_INIT_LOCK:
        if _DATA_PLANE_DB_INITIALIZED:
            return
        DATA_PLANE_METADATA.create_all(DATA_PLANE_ENGINE)
        _migrate_data_plane_schema()
        _record_schema_state(
            DATA_PLANE_ENGINE,
            data_plane_schema_state,
            "data_plane",
            DATA_PLANE_SCHEMA_REVISION,
        )
        _DATA_PLANE_DB_INITIALIZED = True


def init_db() -> None:
    init_control_plane_db()
    init_data_plane_db()


def data_plane_sqlite_search_ready() -> bool:
    return DATA_PLANE_ENGINE.dialect.name == "sqlite" and _DATA_PLANE_SQLITE_SEARCH_READY


def _ensure_sqlite_patient_case_search(conn: Any) -> None:
    global _DATA_PLANE_SQLITE_SEARCH_READY
    if DATA_PLANE_ENGINE.dialect.name != "sqlite":
        _DATA_PLANE_SQLITE_SEARCH_READY = False
        return

    trigger_statements = [
        "DROP TRIGGER IF EXISTS patient_case_search_visits_ai",
        "DROP TRIGGER IF EXISTS patient_case_search_visits_au",
        "DROP TRIGGER IF EXISTS patient_case_search_visits_ad",
        "DROP TRIGGER IF EXISTS patient_case_search_patients_ai",
        "DROP TRIGGER IF EXISTS patient_case_search_patients_au",
        "DROP TRIGGER IF EXISTS patient_case_search_patients_ad",
        """
        CREATE TRIGGER IF NOT EXISTS patient_case_search_visits_ai
        AFTER INSERT ON visits
        BEGIN
          INSERT INTO patient_case_search (
            site_id,
            visit_id,
            patient_id,
            local_case_code,
            chart_alias,
            culture_category,
            culture_species,
            visit_date,
            actual_visit_date
          )
          SELECT
            NEW.site_id,
            NEW.visit_id,
            NEW.patient_id,
            COALESCE(p.local_case_code, ''),
            COALESCE(p.chart_alias, ''),
            COALESCE(NEW.culture_category, ''),
            COALESCE(NEW.culture_species, ''),
            COALESCE(NEW.visit_date, ''),
            COALESCE(NEW.actual_visit_date, '')
          FROM patients p
          WHERE p.site_id = NEW.site_id AND p.patient_id = NEW.patient_id;
        END
        """,
        """
        CREATE TRIGGER IF NOT EXISTS patient_case_search_visits_au
        AFTER UPDATE ON visits
        BEGIN
          DELETE FROM patient_case_search WHERE visit_id = OLD.visit_id;
          INSERT INTO patient_case_search (
            site_id,
            visit_id,
            patient_id,
            local_case_code,
            chart_alias,
            culture_category,
            culture_species,
            visit_date,
            actual_visit_date
          )
          SELECT
            NEW.site_id,
            NEW.visit_id,
            NEW.patient_id,
            COALESCE(p.local_case_code, ''),
            COALESCE(p.chart_alias, ''),
            COALESCE(NEW.culture_category, ''),
            COALESCE(NEW.culture_species, ''),
            COALESCE(NEW.visit_date, ''),
            COALESCE(NEW.actual_visit_date, '')
          FROM patients p
          WHERE p.site_id = NEW.site_id AND p.patient_id = NEW.patient_id;
        END
        """,
        """
        CREATE TRIGGER IF NOT EXISTS patient_case_search_visits_ad
        AFTER DELETE ON visits
        BEGIN
          DELETE FROM patient_case_search WHERE visit_id = OLD.visit_id;
        END
        """,
        """
        CREATE TRIGGER IF NOT EXISTS patient_case_search_patients_ai
        AFTER INSERT ON patients
        BEGIN
          INSERT INTO patient_case_search (
            site_id,
            visit_id,
            patient_id,
            local_case_code,
            chart_alias,
            culture_category,
            culture_species,
            visit_date,
            actual_visit_date
          )
          SELECT
            NEW.site_id,
            v.visit_id,
            NEW.patient_id,
            COALESCE(NEW.local_case_code, ''),
            COALESCE(NEW.chart_alias, ''),
            COALESCE(v.culture_category, ''),
            COALESCE(v.culture_species, ''),
            COALESCE(v.visit_date, ''),
            COALESCE(v.actual_visit_date, '')
          FROM visits v
          WHERE v.site_id = NEW.site_id AND v.patient_id = NEW.patient_id;
        END
        """,
        """
        CREATE TRIGGER IF NOT EXISTS patient_case_search_patients_au
        AFTER UPDATE ON patients
        BEGIN
          DELETE FROM patient_case_search
          WHERE site_id = OLD.site_id AND patient_id = OLD.patient_id;
          INSERT INTO patient_case_search (
            site_id,
            visit_id,
            patient_id,
            local_case_code,
            chart_alias,
            culture_category,
            culture_species,
            visit_date,
            actual_visit_date
          )
          SELECT
            NEW.site_id,
            v.visit_id,
            NEW.patient_id,
            COALESCE(NEW.local_case_code, ''),
            COALESCE(NEW.chart_alias, ''),
            COALESCE(v.culture_category, ''),
            COALESCE(v.culture_species, ''),
            COALESCE(v.visit_date, ''),
            COALESCE(v.actual_visit_date, '')
          FROM visits v
          WHERE v.site_id = NEW.site_id AND v.patient_id = NEW.patient_id;
        END
        """,
        """
        CREATE TRIGGER IF NOT EXISTS patient_case_search_patients_ad
        AFTER DELETE ON patients
        BEGIN
          DELETE FROM patient_case_search
          WHERE site_id = OLD.site_id AND patient_id = OLD.patient_id;
        END
        """,
    ]
    try:
        conn.exec_driver_sql(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS patient_case_search USING fts5(
              site_id UNINDEXED,
              visit_id UNINDEXED,
              patient_id,
              local_case_code,
              chart_alias,
              culture_category,
              culture_species,
              visit_date,
              actual_visit_date,
              tokenize = 'unicode61 remove_diacritics 2'
            )
            """
        )
        for statement in trigger_statements:
            conn.exec_driver_sql(statement)
        conn.exec_driver_sql("DELETE FROM patient_case_search")
        conn.exec_driver_sql(
            """
            INSERT INTO patient_case_search (
              site_id,
              visit_id,
              patient_id,
              local_case_code,
              chart_alias,
              culture_category,
              culture_species,
              visit_date,
              actual_visit_date
            )
            SELECT
              v.site_id,
              v.visit_id,
              v.patient_id,
              COALESCE(p.local_case_code, ''),
              COALESCE(p.chart_alias, ''),
              COALESCE(v.culture_category, ''),
              COALESCE(v.culture_species, ''),
              COALESCE(v.visit_date, ''),
              COALESCE(v.actual_visit_date, '')
            FROM visits v
            JOIN patients p
              ON v.site_id = p.site_id
             AND v.patient_id = p.patient_id
            """
        )
        _DATA_PLANE_SQLITE_SEARCH_READY = True
    except Exception:
        _DATA_PLANE_SQLITE_SEARCH_READY = False
        warnings.warn(
            "Unable to initialize SQLite patient-case FTS search; falling back to legacy LIKE filters.",
            RuntimeWarning,
            stacklevel=2,
        )


def _migrate_control_plane_schema() -> None:
    if _control_plane_remote_api_enabled():
        return
    inspector = inspect(CONTROL_PLANE_ENGINE)
    table_names = inspector.get_table_names()
    if "users" not in table_names:
        return

    user_columns = {column["name"] for column in inspector.get_columns("users")}
    with CONTROL_PLANE_ENGINE.begin() as conn:
        if "google_sub" not in user_columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN google_sub VARCHAR(255)"))
        if "public_alias" not in user_columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN public_alias VARCHAR(255)"))
        if "registry_consents" not in user_columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN registry_consents JSON"))

        if CONTROL_PLANE_ENGINE.dialect.name == "sqlite":
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_google_sub "
                    "ON users (google_sub) WHERE google_sub IS NOT NULL"
                )
            )
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_public_alias "
                    "ON users (public_alias) WHERE public_alias IS NOT NULL"
                )
            )
        elif CONTROL_PLANE_ENGINE.dialect.name == "postgresql":
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_users_google_sub ON users (google_sub)"))
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_public_alias "
                    "ON users (public_alias) WHERE public_alias IS NOT NULL"
                )
            )

        if "sites" in table_names:
            site_columns = {column["name"] for column in inspector.get_columns("sites")}
            if "research_registry_enabled" not in site_columns:
                if CONTROL_PLANE_ENGINE.dialect.name == "sqlite":
                    conn.execute(text("ALTER TABLE sites ADD COLUMN research_registry_enabled BOOLEAN NOT NULL DEFAULT 1"))
                else:
                    conn.execute(text("ALTER TABLE sites ADD COLUMN research_registry_enabled BOOLEAN NOT NULL DEFAULT TRUE"))
            if "source_institution_id" not in site_columns:
                conn.execute(text("ALTER TABLE sites ADD COLUMN source_institution_id VARCHAR(128)"))

        if "access_requests" in table_names:
            access_request_columns = {column["name"] for column in inspector.get_columns("access_requests")}
            access_request_id_column = next(
                (column for column in inspector.get_columns("access_requests") if column["name"] == "requested_site_id"),
                None,
            )
            if (
                access_request_id_column is not None
                and CONTROL_PLANE_ENGINE.dialect.name == "postgresql"
                and getattr(access_request_id_column.get("type"), "length", None) is not None
                and int(access_request_id_column["type"].length) < 128
            ):
                conn.execute(text("ALTER TABLE access_requests ALTER COLUMN requested_site_id TYPE VARCHAR(128)"))
            if "requested_site_label" not in access_request_columns:
                conn.execute(text("ALTER TABLE access_requests ADD COLUMN requested_site_label VARCHAR(255) NOT NULL DEFAULT ''"))
            if "requested_site_source" not in access_request_columns:
                conn.execute(text("ALTER TABLE access_requests ADD COLUMN requested_site_source VARCHAR(32) NOT NULL DEFAULT 'site'"))

        if "institution_directory" in table_names and CONTROL_PLANE_ENGINE.dialect.name == "postgresql":
            institution_id_column = next(
                (column for column in inspector.get_columns("institution_directory") if column["name"] == "institution_id"),
                None,
            )
            if (
                institution_id_column is not None
                and getattr(institution_id_column.get("type"), "length", None) is not None
                and int(institution_id_column["type"].length) < 128
            ):
                conn.execute(text("ALTER TABLE institution_directory ALTER COLUMN institution_id TYPE VARCHAR(128)"))

        if "validation_cases" in table_names:
            validation_case_columns = {column["name"] for column in inspector.get_columns("validation_cases")}
            if "payload_json" not in validation_case_columns:
                if CONTROL_PLANE_ENGINE.dialect.name == "sqlite":
                    conn.execute(text("ALTER TABLE validation_cases ADD COLUMN payload_json JSON NOT NULL DEFAULT '{}'"))
                else:
                    conn.execute(text("ALTER TABLE validation_cases ADD COLUMN payload_json JSON NOT NULL DEFAULT '{}'"))
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_validation_cases_site_patient_visit "
                    "ON validation_cases (site_id, patient_reference_id, visit_index)"
                )
            )
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_validation_cases_validation_case "
                    "ON validation_cases (validation_id, case_reference_id)"
                )
            )

        if "auth_rate_limits" in table_names:
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_auth_rate_limits_scope_client_time "
                    "ON auth_rate_limits (scope, client_key, attempted_at_epoch)"
                )
            )


def _migrate_data_plane_schema() -> None:
    inspector = inspect(DATA_PLANE_ENGINE)
    table_names = inspector.get_table_names()

    with DATA_PLANE_ENGINE.begin() as conn:
        if "visits" in table_names:
            visit_columns = {column["name"] for column in inspector.get_columns("visits")}
            if "patient_reference_id" not in visit_columns:
                conn.execute(text("ALTER TABLE visits ADD COLUMN patient_reference_id VARCHAR(64)"))
            if "created_by_user_id" not in visit_columns:
                conn.execute(text("ALTER TABLE visits ADD COLUMN created_by_user_id VARCHAR(64)"))
            if "visit_index" not in visit_columns:
                conn.execute(text("ALTER TABLE visits ADD COLUMN visit_index INTEGER"))
            if "is_initial_visit" not in visit_columns:
                if DATA_PLANE_ENGINE.dialect.name == "sqlite":
                    conn.execute(text("ALTER TABLE visits ADD COLUMN is_initial_visit BOOLEAN NOT NULL DEFAULT 0"))
                else:
                    conn.execute(text("ALTER TABLE visits ADD COLUMN is_initial_visit BOOLEAN NOT NULL DEFAULT FALSE"))
            if "additional_organisms" not in visit_columns:
                conn.execute(text("ALTER TABLE visits ADD COLUMN additional_organisms JSON NOT NULL DEFAULT '[]'"))
            if "actual_visit_date" not in visit_columns:
                conn.execute(text("ALTER TABLE visits ADD COLUMN actual_visit_date VARCHAR(32)"))
            if "culture_status" not in visit_columns:
                conn.execute(text("ALTER TABLE visits ADD COLUMN culture_status VARCHAR(32) NOT NULL DEFAULT 'unknown'"))
                conn.execute(
                    text(
                        "UPDATE visits "
                        "SET culture_status = CASE "
                        "WHEN culture_confirmed = 1 THEN 'positive' "
                        "WHEN TRIM(COALESCE(culture_category, '')) <> '' THEN 'positive' "
                        "WHEN TRIM(COALESCE(culture_species, '')) <> '' THEN 'positive' "
                        "ELSE 'unknown' "
                        "END "
                        "WHERE culture_status IS NULL OR TRIM(COALESCE(culture_status, '')) = ''"
                    )
                )
            if "research_registry_status" not in visit_columns:
                conn.execute(text("ALTER TABLE visits ADD COLUMN research_registry_status VARCHAR(32) NOT NULL DEFAULT 'analysis_only'"))
            if "research_registry_updated_at" not in visit_columns:
                conn.execute(text("ALTER TABLE visits ADD COLUMN research_registry_updated_at VARCHAR(64)"))
            if "research_registry_updated_by" not in visit_columns:
                conn.execute(text("ALTER TABLE visits ADD COLUMN research_registry_updated_by VARCHAR(64)"))
            if "research_registry_source" not in visit_columns:
                conn.execute(text("ALTER TABLE visits ADD COLUMN research_registry_source VARCHAR(64)"))
            if "fl_retained" not in visit_columns:
                if DATA_PLANE_ENGINE.dialect.name == "sqlite":
                    conn.execute(text("ALTER TABLE visits ADD COLUMN fl_retained BOOLEAN NOT NULL DEFAULT 0"))
                else:
                    conn.execute(text("ALTER TABLE visits ADD COLUMN fl_retained BOOLEAN NOT NULL DEFAULT FALSE"))
            if "fl_retained_at" not in visit_columns:
                conn.execute(text("ALTER TABLE visits ADD COLUMN fl_retained_at VARCHAR(64)"))
            if "fl_retention_scopes" not in visit_columns:
                conn.execute(text("ALTER TABLE visits ADD COLUMN fl_retention_scopes JSON NOT NULL DEFAULT '[]'"))
            if "fl_retention_last_update_id" not in visit_columns:
                conn.execute(text("ALTER TABLE visits ADD COLUMN fl_retention_last_update_id VARCHAR(64)"))
            if "soft_deleted_at" not in visit_columns:
                conn.execute(text("ALTER TABLE visits ADD COLUMN soft_deleted_at VARCHAR(64)"))
            if "soft_delete_reason" not in visit_columns:
                conn.execute(text("ALTER TABLE visits ADD COLUMN soft_delete_reason VARCHAR(128)"))
            _backfill_visit_reference_columns(conn)
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_visits_site_patient_reference "
                    "ON visits (site_id, patient_reference_id)"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_visits_site_culture_status "
                    "ON visits (site_id, culture_status)"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_visits_site_visit_index "
                    "ON visits (site_id, visit_index)"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_visits_site_fl_retained "
                    "ON visits (site_id, fl_retained)"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_visits_site_soft_deleted "
                    "ON visits (site_id, soft_deleted_at)"
                )
            )

        if "patients" in table_names:
            patient_columns = {column["name"] for column in inspector.get_columns("patients")}
            if "created_by_user_id" not in patient_columns:
                conn.execute(text("ALTER TABLE patients ADD COLUMN created_by_user_id VARCHAR(64)"))

        if "images" in table_names:
            image_columns = {column["name"] for column in inspector.get_columns("images")}
            if "created_by_user_id" not in image_columns:
                conn.execute(text("ALTER TABLE images ADD COLUMN created_by_user_id VARCHAR(64)"))
            if "lesion_prompt_box" not in image_columns:
                conn.execute(text("ALTER TABLE images ADD COLUMN lesion_prompt_box JSON"))
            if "has_lesion_box" not in image_columns:
                if DATA_PLANE_ENGINE.dialect.name == "sqlite":
                    conn.execute(text("ALTER TABLE images ADD COLUMN has_lesion_box BOOLEAN NOT NULL DEFAULT 0"))
                else:
                    conn.execute(text("ALTER TABLE images ADD COLUMN has_lesion_box BOOLEAN NOT NULL DEFAULT FALSE"))
            if "has_roi_crop" not in image_columns:
                if DATA_PLANE_ENGINE.dialect.name == "sqlite":
                    conn.execute(text("ALTER TABLE images ADD COLUMN has_roi_crop BOOLEAN NOT NULL DEFAULT 0"))
                else:
                    conn.execute(text("ALTER TABLE images ADD COLUMN has_roi_crop BOOLEAN NOT NULL DEFAULT FALSE"))
            if "has_medsam_mask" not in image_columns:
                if DATA_PLANE_ENGINE.dialect.name == "sqlite":
                    conn.execute(text("ALTER TABLE images ADD COLUMN has_medsam_mask BOOLEAN NOT NULL DEFAULT 0"))
                else:
                    conn.execute(text("ALTER TABLE images ADD COLUMN has_medsam_mask BOOLEAN NOT NULL DEFAULT FALSE"))
            if "has_lesion_crop" not in image_columns:
                if DATA_PLANE_ENGINE.dialect.name == "sqlite":
                    conn.execute(text("ALTER TABLE images ADD COLUMN has_lesion_crop BOOLEAN NOT NULL DEFAULT 0"))
                else:
                    conn.execute(text("ALTER TABLE images ADD COLUMN has_lesion_crop BOOLEAN NOT NULL DEFAULT FALSE"))
            if "has_lesion_mask" not in image_columns:
                if DATA_PLANE_ENGINE.dialect.name == "sqlite":
                    conn.execute(text("ALTER TABLE images ADD COLUMN has_lesion_mask BOOLEAN NOT NULL DEFAULT 0"))
                else:
                    conn.execute(text("ALTER TABLE images ADD COLUMN has_lesion_mask BOOLEAN NOT NULL DEFAULT FALSE"))
            if "quality_scores" not in image_columns:
                conn.execute(text("ALTER TABLE images ADD COLUMN quality_scores JSON"))
            if "artifact_status_updated_at" not in image_columns:
                conn.execute(text("ALTER TABLE images ADD COLUMN artifact_status_updated_at VARCHAR(64)"))
            if "soft_deleted_at" not in image_columns:
                conn.execute(text("ALTER TABLE images ADD COLUMN soft_deleted_at VARCHAR(64)"))
            if "soft_delete_reason" not in image_columns:
                conn.execute(text("ALTER TABLE images ADD COLUMN soft_delete_reason VARCHAR(128)"))
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_images_site_soft_deleted "
                    "ON images (site_id, soft_deleted_at)"
                )
            )
            conn.execute(
                text(
                    "UPDATE images "
                    "SET has_lesion_box = CASE WHEN lesion_prompt_box IS NOT NULL THEN TRUE ELSE FALSE END "
                    "WHERE has_lesion_box IS NULL "
                    "OR has_lesion_box != CASE WHEN lesion_prompt_box IS NOT NULL THEN TRUE ELSE FALSE END"
                )
            )

        if "site_jobs" in table_names:
            job_columns = {column["name"] for column in inspector.get_columns("site_jobs")}
            if "queue_name" not in job_columns:
                conn.execute(text("ALTER TABLE site_jobs ADD COLUMN queue_name VARCHAR(64) NOT NULL DEFAULT 'default'"))
            if "priority" not in job_columns:
                conn.execute(text("ALTER TABLE site_jobs ADD COLUMN priority INTEGER NOT NULL DEFAULT 100"))
            if "updated_at" not in job_columns:
                conn.execute(text("ALTER TABLE site_jobs ADD COLUMN updated_at VARCHAR(64)"))
            if "attempt_count" not in job_columns:
                conn.execute(text("ALTER TABLE site_jobs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0"))
            if "max_attempts" not in job_columns:
                conn.execute(text("ALTER TABLE site_jobs ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 1"))
            if "claimed_by" not in job_columns:
                conn.execute(text("ALTER TABLE site_jobs ADD COLUMN claimed_by VARCHAR(128)"))
            if "claimed_at" not in job_columns:
                conn.execute(text("ALTER TABLE site_jobs ADD COLUMN claimed_at VARCHAR(64)"))
            if "heartbeat_at" not in job_columns:
                conn.execute(text("ALTER TABLE site_jobs ADD COLUMN heartbeat_at VARCHAR(64)"))
            if "available_at" not in job_columns:
                conn.execute(text("ALTER TABLE site_jobs ADD COLUMN available_at VARCHAR(64)"))
            if "started_at" not in job_columns:
                conn.execute(text("ALTER TABLE site_jobs ADD COLUMN started_at VARCHAR(64)"))
            if "finished_at" not in job_columns:
                conn.execute(text("ALTER TABLE site_jobs ADD COLUMN finished_at VARCHAR(64)"))

            if DATA_PLANE_ENGINE.dialect.name == "sqlite":
                conn.execute(
                    text(
                        "CREATE INDEX IF NOT EXISTS ix_site_jobs_queue_status_available "
                        "ON site_jobs (queue_name, status, available_at)"
                    )
                )
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_site_jobs_claimed_by ON site_jobs (claimed_by)"))

        _ensure_sqlite_patient_case_search(conn)


def _backfill_visit_reference_columns(conn: Any) -> None:
    rows = conn.execute(
        select(
            visits.c.visit_id,
            visits.c.site_id,
            visits.c.patient_id,
            visits.c.visit_date,
            visits.c.patient_reference_id,
            visits.c.visit_index,
        )
    ).mappings().all()
    for row in rows:
        values: dict[str, object] = {}
        site_id = str(row.get("site_id") or "").strip()
        patient_id = str(row.get("patient_id") or "").strip()
        visit_date = str(row.get("visit_date") or "").strip()
        if not site_id or not patient_id or not visit_date:
            continue
        if not str(row.get("patient_reference_id") or "").strip():
            values["patient_reference_id"] = make_patient_reference_id(site_id, patient_id, PATIENT_REFERENCE_SALT)
        if row.get("visit_index") is None:
            try:
                values["visit_index"] = visit_index_from_label(visit_date)
            except ValueError:
                continue
        if values:
            conn.execute(update(visits).where(visits.c.visit_id == row["visit_id"]).values(**values))
