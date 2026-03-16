from __future__ import annotations

import os
from pathlib import Path

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
    text,
)
from sqlalchemy.engine import Engine

from kera_research.config import STORAGE_DIR


def _default_database_url() -> str:
    database_path = (STORAGE_DIR / "kera.db").resolve().as_posix()
    return f"sqlite:///{database_path}"


def _resolve_control_plane_database_url() -> str:
    legacy_url = os.getenv("KERA_DATABASE_URL") or os.getenv("DATABASE_URL")
    return (
        os.getenv("KERA_CONTROL_PLANE_DATABASE_URL")
        or os.getenv("KERA_AUTH_DATABASE_URL")
        or legacy_url
        or _default_database_url()
    )


def _resolve_data_plane_database_url() -> str:
    legacy_url = os.getenv("KERA_DATABASE_URL") or os.getenv("DATABASE_URL")
    return (
        os.getenv("KERA_DATA_PLANE_DATABASE_URL")
        or os.getenv("KERA_LOCAL_DATABASE_URL")
        or legacy_url
        or _default_database_url()
    )


def _connect_args_for(database_url: str) -> dict[str, object]:
    return {"check_same_thread": False} if database_url.startswith("sqlite") else {}


CONTROL_PLANE_DATABASE_URL = _resolve_control_plane_database_url()
DATA_PLANE_DATABASE_URL = _resolve_data_plane_database_url()
DATABASE_URL = CONTROL_PLANE_DATABASE_URL

CONTROL_PLANE_ENGINE: Engine = create_engine(
    CONTROL_PLANE_DATABASE_URL,
    future=True,
    pool_pre_ping=True,
    connect_args=_connect_args_for(CONTROL_PLANE_DATABASE_URL),
)
DATA_PLANE_ENGINE: Engine = create_engine(
    DATA_PLANE_DATABASE_URL,
    future=True,
    pool_pre_ping=True,
    connect_args=_connect_args_for(DATA_PLANE_DATABASE_URL),
)
ENGINE = CONTROL_PLANE_ENGINE
CONTROL_PLANE_METADATA = MetaData()
DATA_PLANE_METADATA = MetaData()
METADATA = CONTROL_PLANE_METADATA

users = Table(
    "users",
    CONTROL_PLANE_METADATA,
    Column("user_id", String(64), primary_key=True),
    Column("username", String(255), nullable=False, unique=True, index=True),
    Column("google_sub", String(255), nullable=True),
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
    Column("local_storage_root", Text, nullable=False),
    Column("research_registry_enabled", Boolean, nullable=False, default=True),
    Column("created_at", String(64), nullable=False),
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
    Column("requested_site_id", String(64), nullable=False, index=True),
    Column("requested_role", String(32), nullable=False),
    Column("message", Text, nullable=False, default=""),
    Column("status", String(32), nullable=False, index=True),
    Column("reviewed_by", String(64), nullable=True),
    Column("reviewer_notes", Text, nullable=False, default=""),
    Column("created_at", String(64), nullable=False),
    Column("reviewed_at", String(64), nullable=True),
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
    Column("created_by_user_id", String(64), nullable=True, index=True),
    Column("visit_date", String(32), nullable=False, index=True),
    Column("actual_visit_date", String(32), nullable=True),
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


def init_control_plane_db() -> None:
    CONTROL_PLANE_METADATA.create_all(CONTROL_PLANE_ENGINE)
    _migrate_control_plane_schema()


def init_data_plane_db() -> None:
    DATA_PLANE_METADATA.create_all(DATA_PLANE_ENGINE)
    _migrate_data_plane_schema()


def init_db() -> None:
    init_control_plane_db()
    init_data_plane_db()


def _migrate_control_plane_schema() -> None:
    inspector = inspect(CONTROL_PLANE_ENGINE)
    table_names = inspector.get_table_names()
    if "users" not in table_names:
        return

    user_columns = {column["name"] for column in inspector.get_columns("users")}
    with CONTROL_PLANE_ENGINE.begin() as conn:
        if "google_sub" not in user_columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN google_sub VARCHAR(255)"))
        if "registry_consents" not in user_columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN registry_consents JSON"))

        if CONTROL_PLANE_ENGINE.dialect.name == "sqlite":
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_google_sub "
                    "ON users (google_sub) WHERE google_sub IS NOT NULL"
                )
            )
        elif CONTROL_PLANE_ENGINE.dialect.name == "postgresql":
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_users_google_sub ON users (google_sub)"))

        if "sites" in table_names:
            site_columns = {column["name"] for column in inspector.get_columns("sites")}
            if "research_registry_enabled" not in site_columns:
                if CONTROL_PLANE_ENGINE.dialect.name == "sqlite":
                    conn.execute(text("ALTER TABLE sites ADD COLUMN research_registry_enabled BOOLEAN NOT NULL DEFAULT 1"))
                else:
                    conn.execute(text("ALTER TABLE sites ADD COLUMN research_registry_enabled BOOLEAN NOT NULL DEFAULT TRUE"))


def _migrate_data_plane_schema() -> None:
    inspector = inspect(DATA_PLANE_ENGINE)
    table_names = inspector.get_table_names()

    with DATA_PLANE_ENGINE.begin() as conn:
        if "visits" in table_names:
            visit_columns = {column["name"] for column in inspector.get_columns("visits")}
            if "created_by_user_id" not in visit_columns:
                conn.execute(text("ALTER TABLE visits ADD COLUMN created_by_user_id VARCHAR(64)"))
            if "is_initial_visit" not in visit_columns:
                if DATA_PLANE_ENGINE.dialect.name == "sqlite":
                    conn.execute(text("ALTER TABLE visits ADD COLUMN is_initial_visit BOOLEAN NOT NULL DEFAULT 0"))
                else:
                    conn.execute(text("ALTER TABLE visits ADD COLUMN is_initial_visit BOOLEAN NOT NULL DEFAULT FALSE"))
            if "additional_organisms" not in visit_columns:
                conn.execute(text("ALTER TABLE visits ADD COLUMN additional_organisms JSON NOT NULL DEFAULT '[]'"))
            if "actual_visit_date" not in visit_columns:
                conn.execute(text("ALTER TABLE visits ADD COLUMN actual_visit_date VARCHAR(32)"))
            if "research_registry_status" not in visit_columns:
                conn.execute(text("ALTER TABLE visits ADD COLUMN research_registry_status VARCHAR(32) NOT NULL DEFAULT 'analysis_only'"))
            if "research_registry_updated_at" not in visit_columns:
                conn.execute(text("ALTER TABLE visits ADD COLUMN research_registry_updated_at VARCHAR(64)"))
            if "research_registry_updated_by" not in visit_columns:
                conn.execute(text("ALTER TABLE visits ADD COLUMN research_registry_updated_by VARCHAR(64)"))
            if "research_registry_source" not in visit_columns:
                conn.execute(text("ALTER TABLE visits ADD COLUMN research_registry_source VARCHAR(64)"))

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
