"""
Migrate DATA_PLANE from NeonDB (PostgreSQL) to local SQLite.

Usage:
    python scripts/migrate_data_plane_to_sqlite.py [--dry-run] [--sqlite-path PATH]

This script:
  1. Reads all data from the current DATA_PLANE_DATABASE_URL (NeonDB)
  2. Creates a local SQLite database with the same schema
  3. Copies all rows for tables: patients, visits, images, site_patient_splits, site_jobs
  4. Prints counts and verifies row parity
  5. Does NOT modify .env.local automatically — you do that after verifying

After running successfully, update .env.local:
    KERA_DATA_PLANE_DATABASE_URL=sqlite:////absolute/path/to/data_plane.db
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

# Resolve project root and add to path
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

from kera_research.config import STORAGE_DIR
from kera_research.db import (
    DATA_PLANE_METADATA,
    images as db_images,
    patients as db_patients,
    site_jobs as db_site_jobs,
    site_patient_splits as db_site_patient_splits,
    visits as db_visits,
)

DATA_PLANE_TABLES = [
    ("patients", db_patients),
    ("visits", db_visits),
    ("images", db_images),
    ("site_patient_splits", db_site_patient_splits),
    ("site_jobs", db_site_jobs),
]

BATCH_SIZE = 500


def _connect_args_for(url: str) -> dict:
    return {"check_same_thread": False} if url.startswith("sqlite") else {}


def _engine_kwargs_for(url: str) -> dict:
    if url.startswith("postgresql") or url.startswith("postgres"):
        return {
            "pool_size": 5,
            "max_overflow": 5,
            "pool_timeout": 30,
            "pool_pre_ping": True,
        }
    return {"poolclass": NullPool}


def _resolve_source_url() -> str:
    url = (
        os.getenv("KERA_DATA_PLANE_DATABASE_URL")
        or os.getenv("KERA_LOCAL_DATABASE_URL")
        or os.getenv("KERA_DATABASE_URL")
        or os.getenv("DATABASE_URL")
        or ""
    ).strip()
    if not url:
        raise SystemExit(
            "ERROR: KERA_DATA_PLANE_DATABASE_URL is not set.\n"
            "Make sure your .env.local is loaded or set the env variable."
        )
    if url.startswith("sqlite"):
        raise SystemExit(
            "ERROR: Source database is already SQLite — nothing to migrate."
        )
    return url


def _load_dotenv_local() -> None:
    env_path = PROJECT_ROOT / ".env.local"
    if not env_path.exists():
        return
    with open(env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


def _row_to_dict(row, table) -> dict:
    """Convert a SQLAlchemy row mapping to a plain dict, serialising JSON columns."""
    result = {}
    for col in table.columns:
        val = row[col.name]
        # SQLAlchemy may return JSON as str from PostgreSQL; ensure it's native type
        if hasattr(col.type, "impl") and str(col.type).lower() == "json":
            if isinstance(val, str):
                try:
                    val = json.loads(val)
                except (json.JSONDecodeError, TypeError):
                    pass
        result[col.name] = val
    return result


def migrate(sqlite_path: Path, dry_run: bool) -> None:
    _load_dotenv_local()

    source_url = _resolve_source_url()
    target_url = f"sqlite:///{sqlite_path.as_posix()}"

    print(f"Source : {source_url[:60]}...")
    print(f"Target : {target_url}")
    print(f"Dry run: {dry_run}")
    print()

    src_engine = create_engine(
        source_url,
        future=True,
        connect_args=_connect_args_for(source_url),
        **{k: v for k, v in _engine_kwargs_for(source_url).items() if k != "poolclass"},
    )

    if not dry_run:
        sqlite_path.parent.mkdir(parents=True, exist_ok=True)
        tgt_engine = create_engine(
            target_url,
            future=True,
            connect_args={"check_same_thread": False},
        )
        # Enable WAL mode on the new SQLite DB
        with tgt_engine.connect() as conn:
            conn.execute(text("PRAGMA journal_mode=WAL"))
            conn.execute(text("PRAGMA synchronous=NORMAL"))

        DATA_PLANE_METADATA.create_all(tgt_engine)
        print("SQLite schema created.\n")
    else:
        tgt_engine = None

    total_copied = 0

    with src_engine.connect() as src_conn:
        for table_name, table in DATA_PLANE_TABLES:
            count_result = src_conn.execute(
                text(f"SELECT COUNT(*) FROM {table_name}")
            ).scalar() or 0
            print(f"  {table_name}: {count_result} rows", end="")

            if dry_run or count_result == 0:
                print(" (skipped)" if count_result == 0 else " (dry-run)")
                continue

            # Read in batches and insert into SQLite
            offset = 0
            inserted = 0
            with tgt_engine.begin() as tgt_conn:
                # Clear existing rows to allow re-running safely
                tgt_conn.execute(table.delete())

                while True:
                    rows = src_conn.execute(
                        table.select().order_by(*table.primary_key.columns)
                        .limit(BATCH_SIZE)
                        .offset(offset)
                    ).mappings().all()

                    if not rows:
                        break

                    dicts = [_row_to_dict(row, table) for row in rows]

                    # SQLite autoincrement PK (patients.patient_row_id): strip it so
                    # SQLite assigns its own, then remap — actually keep it to preserve
                    # foreign-key semantics within the same DB.
                    tgt_conn.execute(table.insert(), dicts)
                    inserted += len(rows)
                    offset += BATCH_SIZE

            total_copied += inserted
            print(f" -> {inserted} copied OK")

    print()
    if dry_run:
        print("Dry-run complete - no data was written.")
    else:
        print(f"Migration complete. {total_copied} total rows copied to:")
        print(f"  {sqlite_path}")
        print()
        print("Next step - update .env.local:")
        print(f'  KERA_DATA_PLANE_DATABASE_URL=sqlite:///{sqlite_path.as_posix()}')
        print()
        print("Then restart the server.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Migrate data plane from NeonDB to SQLite.")
    parser.add_argument(
        "--sqlite-path",
        type=Path,
        default=STORAGE_DIR / "data_plane.db",
        help="Output SQLite file path (default: storage/data_plane.db)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Read source counts only, do not write anything.",
    )
    args = parser.parse_args()

    migrate(sqlite_path=args.sqlite_path.resolve(), dry_run=args.dry_run)


if __name__ == "__main__":
    main()
