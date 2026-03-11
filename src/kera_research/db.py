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


DATABASE_URL = os.getenv("KERA_DATABASE_URL") or os.getenv("DATABASE_URL") or _default_database_url()

_connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
ENGINE: Engine = create_engine(
    DATABASE_URL,
    future=True,
    pool_pre_ping=True,
    connect_args=_connect_args,
)
METADATA = MetaData()

users = Table(
    "users",
    METADATA,
    Column("user_id", String(64), primary_key=True),
    Column("username", String(255), nullable=False, unique=True, index=True),
    Column("google_sub", String(255), nullable=True),
    Column("password", Text, nullable=False),
    Column("role", String(32), nullable=False),
    Column("full_name", String(255), nullable=False),
    Column("site_ids", JSON, nullable=True),
)

projects = Table(
    "projects",
    METADATA,
    Column("project_id", String(64), primary_key=True),
    Column("name", String(255), nullable=False),
    Column("description", Text, nullable=False, default=""),
    Column("owner_user_id", String(64), nullable=False),
    Column("site_ids", JSON, nullable=False, default=list),
    Column("created_at", String(64), nullable=False),
)

sites = Table(
    "sites",
    METADATA,
    Column("site_id", String(64), primary_key=True),
    Column("project_id", String(64), nullable=False, index=True),
    Column("display_name", String(255), nullable=False),
    Column("hospital_name", String(255), nullable=False, default=""),
    Column("local_storage_root", Text, nullable=False),
    Column("created_at", String(64), nullable=False),
)

organism_catalog = Table(
    "organism_catalog",
    METADATA,
    Column("catalog_id", Integer, primary_key=True, autoincrement=True),
    Column("culture_category", String(32), nullable=False, index=True),
    Column("species_name", String(255), nullable=False),
    UniqueConstraint("culture_category", "species_name", name="uq_organism_catalog_category_species"),
)

organism_requests = Table(
    "organism_requests",
    METADATA,
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
    METADATA,
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
    METADATA,
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
    METADATA,
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
    METADATA,
    Column("update_id", String(64), primary_key=True),
    Column("site_id", String(64), nullable=True, index=True),
    Column("architecture", String(64), nullable=True, index=True),
    Column("status", String(64), nullable=True, index=True),
    Column("created_at", String(64), nullable=True, index=True),
    Column("payload_json", JSON, nullable=False),
)

contributions = Table(
    "contributions",
    METADATA,
    Column("contribution_id", String(64), primary_key=True),
    Column("user_id", String(64), nullable=True, index=True),
    Column("site_id", String(64), nullable=True, index=True),
    Column("created_at", String(64), nullable=True, index=True),
    Column("payload_json", JSON, nullable=False),
)

aggregations = Table(
    "aggregations",
    METADATA,
    Column("aggregation_id", String(64), primary_key=True),
    Column("base_model_version_id", String(64), nullable=True, index=True),
    Column("new_version_name", String(255), nullable=False),
    Column("architecture", String(64), nullable=True, index=True),
    Column("total_cases", Integer, nullable=True),
    Column("created_at", String(64), nullable=True, index=True),
    Column("payload_json", JSON, nullable=False),
)

patients = Table(
    "patients",
    METADATA,
    Column("patient_row_id", Integer, primary_key=True, autoincrement=True),
    Column("site_id", String(64), nullable=False, index=True),
    Column("patient_id", String(255), nullable=False),
    Column("sex", String(32), nullable=False),
    Column("age", Integer, nullable=False),
    Column("chart_alias", String(255), nullable=False, default=""),
    Column("local_case_code", String(255), nullable=False, default=""),
    Column("created_at", String(64), nullable=False),
    UniqueConstraint("site_id", "patient_id", name="uq_patients_site_patient"),
)

visits = Table(
    "visits",
    METADATA,
    Column("visit_id", String(64), primary_key=True),
    Column("site_id", String(64), nullable=False, index=True),
    Column("patient_id", String(255), nullable=False, index=True),
    Column("visit_date", String(32), nullable=False, index=True),
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
    Column("created_at", String(64), nullable=False),
    UniqueConstraint("site_id", "patient_id", "visit_date", name="uq_visits_site_patient_date"),
)

images = Table(
    "images",
    METADATA,
    Column("image_id", String(64), primary_key=True),
    Column("visit_id", String(64), nullable=False, index=True),
    Column("site_id", String(64), nullable=False, index=True),
    Column("patient_id", String(255), nullable=False, index=True),
    Column("visit_date", String(32), nullable=False, index=True),
    Column("view", String(32), nullable=False, index=True),
    Column("image_path", Text, nullable=False),
    Column("is_representative", Boolean, nullable=False, default=False),
    Column("uploaded_at", String(64), nullable=False),
)

site_patient_splits = Table(
    "site_patient_splits",
    METADATA,
    Column("site_id", String(64), primary_key=True),
    Column("split_json", JSON, nullable=False),
    Column("updated_at", String(64), nullable=False),
)

site_jobs = Table(
    "site_jobs",
    METADATA,
    Column("job_id", String(64), primary_key=True),
    Column("site_id", String(64), nullable=False, index=True),
    Column("job_type", String(64), nullable=False, index=True),
    Column("status", String(64), nullable=False, index=True),
    Column("payload_json", JSON, nullable=False),
    Column("result_json", JSON, nullable=True),
    Column("created_at", String(64), nullable=False),
    Column("updated_at", String(64), nullable=True),
)


def init_db() -> None:
    METADATA.create_all(ENGINE)
    _migrate_schema()


def _migrate_schema() -> None:
    inspector = inspect(ENGINE)
    table_names = inspector.get_table_names()
    if "users" not in table_names:
        return

    user_columns = {column["name"] for column in inspector.get_columns("users")}
    with ENGINE.begin() as conn:
        if "google_sub" not in user_columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN google_sub VARCHAR(255)"))

        if "visits" in table_names:
            visit_columns = {column["name"] for column in inspector.get_columns("visits")}
            if "is_initial_visit" not in visit_columns:
                conn.execute(text("ALTER TABLE visits ADD COLUMN is_initial_visit BOOLEAN NOT NULL DEFAULT 0"))
            if "additional_organisms" not in visit_columns:
                if ENGINE.dialect.name == "sqlite":
                    conn.execute(text("ALTER TABLE visits ADD COLUMN additional_organisms JSON NOT NULL DEFAULT '[]'"))
                else:
                    conn.execute(text("ALTER TABLE visits ADD COLUMN additional_organisms JSON NOT NULL DEFAULT '[]'"))

        if ENGINE.dialect.name == "sqlite":
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_google_sub "
                    "ON users (google_sub) WHERE google_sub IS NOT NULL"
                )
            )
        elif ENGINE.dialect.name == "postgresql":
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_users_google_sub ON users (google_sub)"))
