from __future__ import annotations

import argparse
import json
import re
import sys
from contextlib import nullcontext
from pathlib import Path
from typing import Any

from sqlalchemy import JSON, Table, and_, create_engine, inspect, select, text, update
from sqlalchemy.engine import Engine

REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = REPO_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from kera_research.config import (  # noqa: E402
    CASE_REFERENCE_SALT,
    CONTROL_PLANE_ARTIFACT_DIR,
    CONTROL_PLANE_CASE_DIR,
    CONTROL_PLANE_DIR,
    CONTROL_PLANE_EXPERIMENT_DIR,
    CONTROL_PLANE_REPORT_DIR,
    MODEL_DIR,
    STORAGE_DIR,
)
from kera_research.db import (  # noqa: E402
    CONTROL_PLANE_METADATA,
    access_requests,
    aggregations,
    app_settings,
    contributions,
    experiments,
    institution_directory,
    model_updates,
    model_versions,
    organism_catalog,
    organism_requests,
    projects,
    sites,
    users,
    validation_cases,
    validation_runs,
)
from kera_research.domain import make_case_reference_id  # noqa: E402

CONTROL_PLANE_TABLES: list[Table] = [
    users,
    projects,
    sites,
    institution_directory,
    organism_catalog,
    organism_requests,
    access_requests,
    validation_runs,
    validation_cases,
    model_versions,
    model_updates,
    experiments,
    contributions,
    aggregations,
    app_settings,
]

DEFAULT_SOURCE_URL = f"sqlite:///{(STORAGE_DIR / 'kera.db').resolve().as_posix()}"
DEFAULT_OUTPUT_PATH = REPO_ROOT / "artifacts" / "control_plane_migration_report.json"
PATH_KEYWORDS = ("path", "file", "dir", "root")
SENSITIVE_KEYS = {"patient_id", "actual_visit_date"}
EXACT_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _connect_args_for(database_url: str) -> dict[str, object]:
    return {"check_same_thread": False} if database_url.startswith("sqlite") else {}


def _build_engine(database_url: str) -> Engine:
    return create_engine(
        database_url,
        future=True,
        pool_pre_ping=True,
        connect_args=_connect_args_for(database_url),
    )


def _table_map() -> dict[str, Table]:
    return {table.name: table for table in CONTROL_PLANE_TABLES}


def _pk_columns(table: Table) -> list[str]:
    return [column.name for column in table.primary_key.columns]


def _is_json_column(column: Any) -> bool:
    return isinstance(column.type, JSON)


def _normalize_json_value(value: Any) -> Any:
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.startswith("{") or stripped.startswith("["):
            try:
                return json.loads(stripped)
            except json.JSONDecodeError:
                return value
    return value


def _normalize_row(table: Table, row: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(row)
    for column in table.columns:
        if column.name not in normalized:
            continue
        if _is_json_column(column):
            normalized[column.name] = _normalize_json_value(normalized[column.name])
    return normalized


def _string_prefix_replace(value: str, replacements: list[tuple[str, str]]) -> str:
    candidate_lower = value.lower()
    for old_prefix, new_prefix in replacements:
        if not old_prefix:
            continue
        old_lower = old_prefix.lower()
        if candidate_lower.startswith(old_lower):
            return new_prefix + value[len(old_prefix) :]
    return value


def _rewrite_value(value: Any, replacements: list[tuple[str, str]]) -> Any:
    if isinstance(value, dict):
        return {key: _rewrite_value(item, replacements) for key, item in value.items()}
    if isinstance(value, list):
        return [_rewrite_value(item, replacements) for item in value]
    if isinstance(value, str):
        return _string_prefix_replace(value, replacements)
    return value


def _collect_path_samples(value: Any, *, key_path: str = "") -> list[dict[str, Any]]:
    samples: list[dict[str, Any]] = []
    if isinstance(value, dict):
        for key, item in value.items():
            child_path = f"{key_path}.{key}" if key_path else str(key)
            lower_key = str(key).lower()
            if lower_key in SENSITIVE_KEYS:
                samples.append({"kind": "sensitive_key", "key": child_path, "value": item})
            if lower_key == "visit_date" and isinstance(item, str) and EXACT_DATE_RE.fullmatch(item.strip()):
                samples.append({"kind": "sensitive_key", "key": child_path, "value": item})
            samples.extend(_collect_path_samples(item, key_path=child_path))
        return samples
    if isinstance(value, list):
        for index, item in enumerate(value):
            child_path = f"{key_path}[{index}]"
            samples.extend(_collect_path_samples(item, key_path=child_path))
        return samples
    if isinstance(value, str):
        lower_path = key_path.lower()
        looks_like_path = any(token in lower_path for token in PATH_KEYWORDS)
        absolute_windows = len(value) > 2 and value[1:3] == ":\\"
        absolute_posix = value.startswith("/")
        if looks_like_path or absolute_windows or absolute_posix:
            samples.append(
                {
                    "kind": "path",
                    "key": key_path,
                    "value": value,
                    "absolute": absolute_windows or absolute_posix,
                }
            )
    return samples


def _count_rows(engine: Engine, table_name: str) -> int | None:
    inspector = inspect(engine)
    if table_name not in set(inspector.get_table_names()):
        return None
    with engine.begin() as conn:
        return int(conn.execute(text(f"SELECT COUNT(*) FROM {table_name}")).scalar_one())


def _existing_pk_set(engine: Engine, table: Table) -> set[tuple[Any, ...]]:
    if _count_rows(engine, table.name) is None:
        return set()
    pk_names = _pk_columns(table)
    if not pk_names:
        return set()
    with engine.begin() as conn:
        rows = conn.execute(select(*(table.c[name] for name in pk_names))).all()
    return {tuple(row._mapping[name] for name in pk_names) for row in rows}


def _source_rows(engine: Engine, table: Table, source_tables: set[str]) -> list[dict[str, Any]]:
    if table.name not in source_tables:
        return []
    with engine.begin() as conn:
        rows = conn.execute(select(table)).mappings().all()
    return [_normalize_row(table, dict(row)) for row in rows]


def _ensure_target_schema(engine: Engine) -> None:
    CONTROL_PLANE_METADATA.create_all(engine)
    with engine.begin() as conn:
        if engine.dialect.name == "sqlite":
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_google_sub "
                    "ON users (google_sub) WHERE google_sub IS NOT NULL"
                )
            )
        elif engine.dialect.name == "postgresql":
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_users_google_sub ON users (google_sub)"))


def _sync_postgres_sequences(engine: Engine, tables: list[Table]) -> None:
    if engine.dialect.name != "postgresql":
        return
    with engine.begin() as conn:
        for table in tables:
            pk_names = _pk_columns(table)
            if len(pk_names) != 1:
                continue
            pk_name = pk_names[0]
            pk_column = table.c[pk_name]
            try:
                python_type = pk_column.type.python_type
            except NotImplementedError:
                continue
            if python_type is not int:
                continue
            conn.execute(
                text(
                    "SELECT setval("
                    "pg_get_serial_sequence(:table_name, :column_name), "
                    "COALESCE((SELECT MAX(" + pk_name + ") FROM " + table.name + "), 0), "
                    "COALESCE((SELECT MAX(" + pk_name + ") FROM " + table.name + "), 0) > 0"
                    ")"
                ),
                {"table_name": table.name, "column_name": pk_name},
            )


def _table_report_row(
    *,
    table_name: str,
    source_rows: int,
    target_rows_before: int | None,
    target_rows_after: int | None,
    would_insert: int | None,
    would_update: int | None,
    migrated_inserts: int | None,
    migrated_updates: int | None,
    policy: str,
    notes: str = "",
) -> dict[str, Any]:
    return {
        "table": table_name,
        "source_rows": source_rows,
        "target_rows_before": target_rows_before,
        "target_rows_after": target_rows_after,
        "would_insert": would_insert,
        "would_update": would_update,
        "migrated_inserts": migrated_inserts,
        "migrated_updates": migrated_updates,
        "policy": policy,
        "notes": notes,
    }


def _audit_database_rows(source_engine: Engine, source_tables: set[str]) -> dict[str, Any]:
    table_map = _table_map()
    audit_tables = {
        "sites": ["local_storage_root"],
        "validation_runs": ["case_predictions_path", "summary_json"],
        "model_versions": ["payload_json"],
        "model_updates": ["payload_json"],
        "experiments": ["payload_json"],
        "contributions": ["payload_json"],
        "aggregations": ["payload_json"],
    }
    report: dict[str, Any] = {}
    for table_name, fields in audit_tables.items():
        table = table_map[table_name]
        rows = _source_rows(source_engine, table, source_tables)
        samples: list[dict[str, Any]] = []
        path_count = 0
        sensitive_count = 0
        for row in rows:
            for field in fields:
                if field not in row:
                    continue
                values = _collect_path_samples(row[field], key_path=field)
                path_count += len([item for item in values if item["kind"] == "path"])
                sensitive_count += len([item for item in values if item["kind"] == "sensitive_key"])
                for item in values:
                    if len(samples) >= 8:
                        break
                    sample = {"row_id": row.get(_pk_columns(table)[0]), **item}
                    samples.append(sample)
                if len(samples) >= 8:
                    break
        report[table_name] = {
            "rows": len(rows),
            "path_like_values": path_count,
            "sensitive_values": sensitive_count,
            "samples": samples,
        }
    return report


def _audit_control_plane_filesystem() -> dict[str, Any]:
    audit_targets = {
        "validation_cases": CONTROL_PLANE_CASE_DIR,
        "validation_reports": CONTROL_PLANE_REPORT_DIR,
        "experiments": CONTROL_PLANE_EXPERIMENT_DIR,
    }
    report: dict[str, Any] = {}
    for label, directory in audit_targets.items():
        files = sorted(directory.glob("*.json")) if directory.exists() else []
        sensitive_hits = 0
        path_hits = 0
        samples: list[dict[str, Any]] = []
        for path in files:
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            values = _collect_path_samples(payload, key_path=label)
            sensitive_hits += len([item for item in values if item["kind"] == "sensitive_key"])
            path_hits += len([item for item in values if item["kind"] == "path"])
            for item in values:
                if len(samples) >= 8:
                    break
                samples.append({"file": str(path), **item})
            if len(samples) >= 8:
                break
        report[label] = {
            "directory": str(directory),
            "file_count": len(files),
            "path_like_values": path_hits,
            "sensitive_values": sensitive_hits,
            "samples": samples,
        }
    return report


def _rewrite_pairs(args: argparse.Namespace) -> list[tuple[str, str]]:
    replacements: list[tuple[str, str]] = []
    if args.rewrite_control_plane_dir:
        replacements.append((str(CONTROL_PLANE_DIR), args.rewrite_control_plane_dir))
    if args.rewrite_control_plane_artifact_dir:
        replacements.append((str(CONTROL_PLANE_ARTIFACT_DIR), args.rewrite_control_plane_artifact_dir))
    if args.rewrite_model_dir:
        replacements.append((str(MODEL_DIR), args.rewrite_model_dir))
    return replacements


def _sanitize_case_reference(record: dict[str, Any], site_id: str) -> dict[str, Any]:
    normalized = dict(record)
    patient_id = str(normalized.get("patient_id") or "").strip()
    visit_date = str(normalized.get("visit_date") or "").strip()
    if site_id and patient_id and visit_date and not str(normalized.get("case_reference_id") or "").strip():
        normalized["case_reference_id"] = make_case_reference_id(site_id, patient_id, visit_date, CASE_REFERENCE_SALT)
    normalized.pop("patient_id", None)
    normalized.pop("visit_date", None)
    return normalized


def _sanitize_control_plane_files(replacements: list[tuple[str, str]]) -> dict[str, Any]:
    report: dict[str, Any] = {
        "validation_reports_updated": 0,
        "validation_cases_updated": 0,
        "experiments_updated": 0,
    }

    for report_path in sorted(CONTROL_PLANE_REPORT_DIR.glob("*.json")):
        try:
            payload = json.loads(report_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(payload, dict):
            continue
        site_id = str(payload.get("site_id") or "").strip()
        sanitized = _rewrite_value(_sanitize_case_reference(payload, site_id), replacements)
        if sanitized != payload:
            report_path.write_text(json.dumps(sanitized, ensure_ascii=True, indent=2), encoding="utf-8")
            report["validation_reports_updated"] += 1

    for case_path in sorted(CONTROL_PLANE_CASE_DIR.glob("*.json")):
        validation_id = case_path.stem
        report_path = CONTROL_PLANE_REPORT_DIR / f"{validation_id}.json"
        site_id = ""
        if report_path.exists():
            try:
                report_payload = json.loads(report_path.read_text(encoding="utf-8"))
                if isinstance(report_payload, dict):
                    site_id = str(report_payload.get("site_id") or "").strip()
            except (OSError, json.JSONDecodeError):
                site_id = ""
        try:
            payload = json.loads(case_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(payload, list):
            continue
        sanitized = [_rewrite_value(_sanitize_case_reference(item, site_id), replacements) for item in payload if isinstance(item, dict)]
        if sanitized != payload:
            case_path.write_text(json.dumps(sanitized, ensure_ascii=True, indent=2), encoding="utf-8")
            report["validation_cases_updated"] += 1

    for experiment_path in sorted(CONTROL_PLANE_EXPERIMENT_DIR.glob("*.json")):
        try:
            payload = json.loads(experiment_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        sanitized = _rewrite_value(payload, replacements)
        if sanitized != payload:
            experiment_path.write_text(json.dumps(sanitized, ensure_ascii=True, indent=2), encoding="utf-8")
            report["experiments_updated"] += 1

    return report


def _migrate_table_rows(
    *,
    source_engine: Engine,
    target_engine: Engine,
    table: Table,
    source_tables: set[str],
    replacements: list[tuple[str, str]],
    execute: bool,
) -> tuple[int, int, int, int]:
    rows = _source_rows(source_engine, table, source_tables)
    existing = _existing_pk_set(target_engine, table)
    inserts = 0
    updates = 0
    migrated_inserts = 0
    migrated_updates = 0
    pk_names = _pk_columns(table)

    conn_cm = target_engine.begin() if execute else nullcontext()
    with conn_cm as conn:
        for row in rows:
            normalized = _rewrite_value(row, replacements)
            pk_tuple = tuple(normalized[name] for name in pk_names)
            exists = pk_tuple in existing
            if exists:
                updates += 1
            else:
                inserts += 1
            if not execute:
                continue
            predicate = and_(*(table.c[name] == normalized[name] for name in pk_names))
            if exists:
                conn.execute(update(table).where(predicate).values(**normalized))
                migrated_updates += 1
            else:
                conn.execute(table.insert().values(**normalized))
                existing.add(pk_tuple)
                migrated_inserts += 1
    return inserts, updates, migrated_inserts, migrated_updates


def _print_report(report: dict[str, Any]) -> None:
    print(f"source_url: {report['source_url']}")
    print(f"target_url: {report['target_url'] or '(not provided)'}")
    print(f"execute: {report['execute']}")
    print("")
    print("table\tsource\tbefore\tafter\twould_insert\twould_update\tmigrated_insert\tmigrated_update\tpolicy")
    for row in report["table_report"]:
        print(
            "\t".join(
                [
                    row["table"],
                    str(row["source_rows"]),
                    str(row["target_rows_before"]),
                    str(row["target_rows_after"]),
                    str(row["would_insert"]),
                    str(row["would_update"]),
                    str(row["migrated_inserts"]),
                    str(row["migrated_updates"]),
                    row["policy"],
                ]
            )
        )

    print("")
    print("path_audit")
    for table_name, audit in report["path_audit"]["database_rows"].items():
        print(
            f"{table_name}: rows={audit['rows']} path_like_values={audit['path_like_values']} sensitive_values={audit['sensitive_values']}"
        )
    for label, audit in report["path_audit"]["filesystem"].items():
        print(
            f"{label}: files={audit['file_count']} path_like_values={audit['path_like_values']} sensitive_values={audit['sensitive_values']}"
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Migrate K-ERA control-plane tables from the current single SQLite DB to a split control-plane target DB."
    )
    parser.add_argument("--source-url", default=DEFAULT_SOURCE_URL, help="Source DB URL. Defaults to the current local SQLite file.")
    parser.add_argument("--target-url", default="", help="Target control-plane DB URL, typically a Neon PostgreSQL URL.")
    parser.add_argument("--execute", action="store_true", help="Actually write rows into the target DB.")
    parser.add_argument(
        "--output-json",
        default=str(DEFAULT_OUTPUT_PATH),
        help="Path to write the migration report JSON.",
    )
    parser.add_argument(
        "--rewrite-control-plane-dir",
        default="",
        help="Optional shared control-plane file root. Rewrites absolute control-plane file paths inside migrated rows.",
    )
    parser.add_argument(
        "--rewrite-control-plane-artifact-dir",
        default="",
        help="Optional shared artifact root. Rewrites artifact paths inside migrated rows.",
    )
    parser.add_argument(
        "--rewrite-model-dir",
        default="",
        help="Optional shared model root. Rewrites model paths inside migrated rows.",
    )
    parser.add_argument(
        "--sanitize-control-plane-files",
        action="store_true",
        help="Sanitize existing control-plane JSON files by removing patient_id/visit_date and rewriting eligible paths.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.execute and not args.target_url:
        raise SystemExit("--execute requires --target-url.")

    source_engine = _build_engine(args.source_url)
    source_tables = set(inspect(source_engine).get_table_names())
    target_engine = _build_engine(args.target_url) if args.target_url else None
    replacements = _rewrite_pairs(args)

    table_report: list[dict[str, Any]] = []
    table_map = _table_map()

    if args.execute and target_engine is not None:
        _ensure_target_schema(target_engine)

    for table in CONTROL_PLANE_TABLES:
        source_rows = _source_rows(source_engine, table, source_tables)
        target_before = _count_rows(target_engine, table.name) if target_engine is not None else None
        inserts = None
        updates = None
        migrated_inserts = None
        migrated_updates = None
        if target_engine is not None:
            inserts, updates, migrated_inserts, migrated_updates = _migrate_table_rows(
                source_engine=source_engine,
                target_engine=target_engine,
                table=table,
                source_tables=source_tables,
                replacements=replacements,
                execute=args.execute,
            )
        target_after = _count_rows(target_engine, table.name) if target_engine is not None else None
        table_report.append(
            _table_report_row(
                table_name=table.name,
                source_rows=len(source_rows),
                target_rows_before=target_before,
                target_rows_after=target_after,
                would_insert=inserts,
                would_update=updates,
                migrated_inserts=migrated_inserts,
                migrated_updates=migrated_updates,
                policy="upsert_by_primary_key",
            )
        )

    report = {
        "source_url": args.source_url,
        "target_url": args.target_url,
        "execute": args.execute,
        "source_storage_dir": str(STORAGE_DIR),
        "rewrite_rules": [{"from": old, "to": new} for old, new in replacements],
        "table_report": table_report,
        "path_audit": {
            "database_rows": _audit_database_rows(source_engine, source_tables),
            "filesystem": _audit_control_plane_filesystem(),
        },
        "recommendations": [
            "Use split mode with KERA_CONTROL_PLANE_DATABASE_URL pointing to Neon and KERA_DATA_PLANE_DATABASE_URL pointing to the hospital-local SQLite DB.",
            "For home/hospital parity, mount a shared control-plane filesystem and set KERA_CONTROL_PLANE_DIR consistently on every admin machine.",
            "For model registry usability across admin machines, mount a shared model directory and set KERA_MODEL_DIR consistently.",
            "Do not migrate patients, visits, images, site_patient_splits, site_jobs, raw patient_id, actual_visit_date, or local raw image paths into Neon.",
        ],
    }

    if args.sanitize_control_plane_files:
        report["filesystem_sanitize"] = _sanitize_control_plane_files(replacements)
        report["path_audit"]["filesystem_after_sanitize"] = _audit_control_plane_filesystem()

    if args.execute and target_engine is not None:
        _sync_postgres_sequences(target_engine, CONTROL_PLANE_TABLES)

    output_path = Path(args.output_json)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, ensure_ascii=True, indent=2), encoding="utf-8")
    _print_report(report)
    print("")
    print(f"report_json: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
