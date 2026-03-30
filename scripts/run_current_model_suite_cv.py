from __future__ import annotations

import argparse
import csv
import json
import subprocess
import sys
import time
import traceback
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = REPO_ROOT / "src"
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from scripts.run_current_model_suite import (
    build_custom_specs,
    build_retrieval_specs,
    build_standard_specs,
    default_ssl_checkpoint_path,
    run_custom_component,
    run_retrieval_component,
    run_standard_component,
    summarize_dataset,
    summarize_retrieval_payload,
    summarize_training_payload,
)
from kera_research.services.control_plane import ControlPlaneStore
from kera_research.services.data_plane import SiteStore
from kera_research.services.pipeline import ResearchWorkflowService


DEFAULT_OUTPUT_ROOT = REPO_ROOT / "artifacts" / "current_model_suite_cv_20260330_5fold"


def utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def tail_text(path: Path, *, max_lines: int = 80) -> str:
    if not path.exists():
        return ""
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    return "\n".join(lines[-max_lines:])


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the current model suite under a shared patient-level cross-validation queue."
    )
    subparsers = parser.add_subparsers(dest="command", required=False)

    queue_parser = subparsers.add_parser("queue", help="Run the full resumable overnight queue.")
    queue_parser.add_argument("--site-id", default="39100103")
    queue_parser.add_argument("--device", default="cuda", choices=["cuda", "cpu", "auto"])
    queue_parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    queue_parser.add_argument("--python-exe", type=Path, default=Path(sys.executable))
    queue_parser.add_argument("--num-folds", type=int, default=5)
    queue_parser.add_argument("--val-split", type=float, default=0.2)
    queue_parser.add_argument("--components", nargs="*", default=None)
    queue_parser.add_argument("--epochs-override", type=int, default=None)
    queue_parser.add_argument("--max-retries", type=int, default=1)
    queue_parser.add_argument("--retry-delay-seconds", type=int, default=15)
    queue_parser.add_argument("--force-rerun", action="store_true")
    queue_parser.add_argument("--max-jobs", type=int, default=None)

    job_parser = subparsers.add_parser("job", help="Run a single component/fold job.")
    job_parser.add_argument("--site-id", default="39100103")
    job_parser.add_argument("--device", default="cuda", choices=["cuda", "cpu", "auto"])
    job_parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    job_parser.add_argument("--fold-index", type=int, required=True)
    job_parser.add_argument("--component", required=True)
    job_parser.add_argument("--epochs-override", type=int, default=None)

    args = parser.parse_args()
    if not args.command:
        args.command = "queue"
    return args


def fold_dir(output_root: Path, fold_index: int) -> Path:
    return output_root / f"fold_{fold_index:02d}"


def component_dir(output_root: Path, fold_index: int, component_name: str) -> Path:
    return fold_dir(output_root, fold_index) / component_name


def result_path(output_root: Path, fold_index: int, component_name: str) -> Path:
    return component_dir(output_root, fold_index, component_name) / "result.json"


def failure_path(output_root: Path, fold_index: int, component_name: str) -> Path:
    return component_dir(output_root, fold_index, component_name) / "failure.json"


def component_leakage_audit_path(output_root: Path, fold_index: int, component_name: str) -> Path:
    return component_dir(output_root, fold_index, component_name) / "leakage_audit.json"


def job_id(fold_index: int, component_name: str) -> str:
    return f"fold{fold_index:02d}__{component_name}"


def job_stdout_log(output_root: Path, fold_index: int, component_name: str) -> Path:
    return output_root / "logs" / f"{job_id(fold_index, component_name)}.stdout.log"


def job_stderr_log(output_root: Path, fold_index: int, component_name: str) -> Path:
    return output_root / "logs" / f"{job_id(fold_index, component_name)}.stderr.log"


def job_state_path(output_root: Path, fold_index: int, component_name: str) -> Path:
    return output_root / "job_state" / f"{job_id(fold_index, component_name)}.json"


def queue_status_path(output_root: Path) -> Path:
    return output_root / "queue_status.json"


def queue_summary_path(output_root: Path) -> Path:
    return output_root / "queue_summary.csv"


def aggregate_summary_path(output_root: Path) -> Path:
    return output_root / "aggregate_summary.csv"


def folds_path(output_root: Path) -> Path:
    return output_root / "folds.json"


def leakage_audit_path(output_root: Path) -> Path:
    return output_root / "leakage_audit.json"


def config_path(output_root: Path) -> Path:
    return output_root / "queue_config.json"


def planned_jobs_path(output_root: Path) -> Path:
    return output_root / "planned_jobs.json"


def record_actual_date(raw_value: Any) -> date | None:
    text = str(raw_value or "").strip()
    if not text:
        return None
    for candidate in (text, text[:10]):
        try:
            return datetime.fromisoformat(candidate).date()
        except ValueError:
            continue
    return None


def build_components(selected_names: list[str] | None, epochs_override: int | None) -> list[dict[str, Any]]:
    selected = {str(name).strip() for name in (selected_names or []) if str(name).strip()} or None
    standard_specs = build_standard_specs()
    custom_specs = build_custom_specs()
    retrieval_specs = build_retrieval_specs()

    if epochs_override is not None:
        for spec in standard_specs:
            spec.epochs = int(epochs_override)
        for spec in custom_specs:
            spec.experiment.epochs = int(epochs_override)

    include_prereq_h2 = selected is None or "h5_lgf_current" in selected or "prereq_h2_current_ssl_tuned" in selected
    components: list[dict[str, Any]] = []
    for spec in custom_specs:
        if selected is None or spec.name in selected or (spec.name == "prereq_h2_current_ssl_tuned" and include_prereq_h2):
            components.append(
                {
                    "kind": "custom",
                    "name": spec.name,
                    "order": int(spec.order),
                    "label": spec.label,
                    "family": spec.family,
                    "include_in_summary": bool(spec.include_in_summary),
                    "spec": spec,
                }
            )
    for spec in standard_specs:
        if selected is None or spec.name in selected:
            components.append(
                {
                    "kind": "standard",
                    "name": spec.name,
                    "order": int(spec.order),
                    "label": spec.label,
                    "family": spec.family,
                    "include_in_summary": True,
                    "spec": spec,
                }
            )
    for spec in retrieval_specs:
        if selected is None or spec.name in selected:
            components.append(
                {
                    "kind": "retrieval",
                    "name": spec.name,
                    "order": int(spec.order),
                    "label": spec.label,
                    "family": spec.family,
                    "include_in_summary": True,
                    "spec": spec,
                }
            )
    components.sort(key=lambda item: int(item["order"]))
    return components


def component_index(selected_names: list[str] | None, epochs_override: int | None) -> dict[str, dict[str, Any]]:
    return {component["name"]: component for component in build_components(selected_names, epochs_override)}


def build_shared_folds(
    workflow: ResearchWorkflowService,
    manifest_records: list[dict[str, Any]],
    *,
    num_folds: int,
    val_split: float,
) -> list[dict[str, Any]]:
    patient_labels: dict[str, str] = {}
    for record in manifest_records:
        patient_labels.setdefault(str(record["patient_id"]), str(record["culture_category"]))
    patient_ids = sorted(patient_labels)
    folds = workflow.model_manager._build_cross_validation_splits(
        patient_ids=patient_ids,
        patient_labels=patient_labels,
        num_folds=num_folds,
        val_split=val_split,
        seed=42,
    )
    site_id = str(manifest_records[0].get("site_id") or "") if manifest_records else ""
    return [{**fold, "site_id": site_id} for fold in folds]


def split_records(
    records: list[dict[str, Any]],
    split: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    patient_to_records: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        patient_to_records[str(record["patient_id"])].append(record)
    train_records = [record for patient_id in split["train_patient_ids"] for record in patient_to_records[str(patient_id)]]
    val_records = [record for patient_id in split["val_patient_ids"] for record in patient_to_records[str(patient_id)]]
    test_records = [record for patient_id in split["test_patient_ids"] for record in patient_to_records[str(patient_id)]]
    return train_records, val_records, test_records


def summarize_split_dates(records: list[dict[str, Any]]) -> dict[str, Any]:
    parsed_dates = [record_actual_date(record.get("actual_visit_date")) for record in records]
    present_dates = [value for value in parsed_dates if value is not None]
    return {
        "n_records": len(records),
        "n_actual_visit_dates": len(present_dates),
        "min_actual_visit_date": present_dates and min(present_dates).isoformat() or None,
        "max_actual_visit_date": present_dates and max(present_dates).isoformat() or None,
    }


def label_counts(values: list[str]) -> dict[str, int]:
    counter = Counter(values)
    return {str(key): int(counter[key]) for key in sorted(counter)}


def build_pre_run_leakage_audit(
    manifest_records: list[dict[str, Any]],
    folds: list[dict[str, Any]],
) -> dict[str, Any]:
    fold_items: list[dict[str, Any]] = []
    all_fold_test_patients: list[str] = []
    all_fold_test_visits: list[str] = []
    for fold in folds:
        fold_index = int(fold["fold_index"])
        train_records, val_records, test_records = split_records(manifest_records, fold)

        train_patients = set(str(patient_id) for patient_id in fold["train_patient_ids"])
        val_patients = set(str(patient_id) for patient_id in fold["val_patient_ids"])
        test_patients = set(str(patient_id) for patient_id in fold["test_patient_ids"])
        train_visits = {f"{record['patient_id']}::{record['visit_date']}" for record in train_records}
        val_visits = {f"{record['patient_id']}::{record['visit_date']}" for record in val_records}
        test_visits = {f"{record['patient_id']}::{record['visit_date']}" for record in test_records}

        actual_train = summarize_split_dates(train_records)
        actual_val = summarize_split_dates(val_records)
        actual_test = summarize_split_dates(test_records)
        train_test_temporal_overlap = False
        if actual_train["min_actual_visit_date"] and actual_train["max_actual_visit_date"] and actual_test["min_actual_visit_date"] and actual_test["max_actual_visit_date"]:
            train_range = (
                datetime.fromisoformat(str(actual_train["min_actual_visit_date"])).date(),
                datetime.fromisoformat(str(actual_train["max_actual_visit_date"])).date(),
            )
            test_range = (
                datetime.fromisoformat(str(actual_test["min_actual_visit_date"])).date(),
                datetime.fromisoformat(str(actual_test["max_actual_visit_date"])).date(),
            )
            train_test_temporal_overlap = not (train_range[1] < test_range[0] or test_range[1] < train_range[0])

        fold_items.append(
            {
                "fold_index": fold_index,
                "n_train_patients": len(train_patients),
                "n_val_patients": len(val_patients),
                "n_test_patients": len(test_patients),
                "patient_overlap_train_val": len(train_patients & val_patients),
                "patient_overlap_train_test": len(train_patients & test_patients),
                "patient_overlap_val_test": len(val_patients & test_patients),
                "visit_overlap_train_val": len(train_visits & val_visits),
                "visit_overlap_train_test": len(train_visits & test_visits),
                "visit_overlap_val_test": len(val_visits & test_visits),
                "train_labels": label_counts([str(record["culture_category"]) for record in train_records]),
                "val_labels": label_counts([str(record["culture_category"]) for record in val_records]),
                "test_labels": label_counts([str(record["culture_category"]) for record in test_records]),
                "train_actual_visit_dates": actual_train,
                "val_actual_visit_dates": actual_val,
                "test_actual_visit_dates": actual_test,
                "train_test_actual_date_ranges_overlap": bool(train_test_temporal_overlap),
            }
        )
        all_fold_test_patients.extend(sorted(test_patients))
        all_fold_test_visits.extend(sorted(test_visits))

    return {
        "created_at": utc_now(),
        "protocol": {
            "split_strategy": "patient_level_cross_validation",
            "num_folds": len(folds),
            "chronological_holdout_enforced": False,
            "temporal_note": "Patient exclusivity prevents same-patient temporal leakage, but this benchmark is not a global chronological holdout.",
        },
        "overall": {
            "all_test_patients_unique": len(all_fold_test_patients) == len(set(all_fold_test_patients)),
            "all_test_visits_unique": len(all_fold_test_visits) == len(set(all_fold_test_visits)),
        },
        "folds": fold_items,
    }


def build_jobs(components: list[dict[str, Any]], folds: list[dict[str, Any]]) -> list[dict[str, Any]]:
    jobs: list[dict[str, Any]] = []
    for fold in folds:
        fold_index = int(fold["fold_index"])
        for component in components:
            dependency = None
            if component["name"] == "h5_lgf_current":
                dependency = job_id(fold_index, "prereq_h2_current_ssl_tuned")
            jobs.append(
                {
                    "job_id": job_id(fold_index, component["name"]),
                    "fold_index": fold_index,
                    "component_name": component["name"],
                    "component_kind": component["kind"],
                    "component_label": component["label"],
                    "component_family": component["family"],
                    "component_order": int(component["order"]),
                    "include_in_summary": bool(component["include_in_summary"]),
                    "dependency": dependency,
                }
            )
    return jobs


def load_or_build_folds(
    output_root: Path,
    *,
    workflow: ResearchWorkflowService,
    manifest_records: list[dict[str, Any]],
    num_folds: int,
    val_split: float,
    force_rerun: bool,
) -> list[dict[str, Any]]:
    path = folds_path(output_root)
    if path.exists() and not force_rerun:
        payload = load_json(path)
        return [dict(item) for item in payload.get("folds", [])]
    folds = build_shared_folds(
        workflow,
        manifest_records,
        num_folds=num_folds,
        val_split=val_split,
    )
    write_json(
        path,
        {
            "created_at": utc_now(),
            "num_folds": int(num_folds),
            "val_split": float(val_split),
            "folds": folds,
        },
    )
    return folds


def build_queue_status(
    *,
    output_root: Path,
    jobs: list[dict[str, Any]],
    items: dict[str, dict[str, Any]],
    current_job: str | None,
    dataset_summary: dict[str, Any],
) -> dict[str, Any]:
    completed = [job["job_id"] for job in jobs if items.get(job["job_id"], {}).get("status") == "completed"]
    failed = [job["job_id"] for job in jobs if items.get(job["job_id"], {}).get("status") == "failed"]
    blocked = [job["job_id"] for job in jobs if items.get(job["job_id"], {}).get("status") == "blocked"]
    skipped_existing = [job["job_id"] for job in jobs if items.get(job["job_id"], {}).get("status") == "skipped_existing"]
    pending = [
        job["job_id"]
        for job in jobs
        if job["job_id"] not in completed
        and job["job_id"] not in failed
        and job["job_id"] not in blocked
        and job["job_id"] not in skipped_existing
        and job["job_id"] != current_job
    ]
    overall_status = "completed"
    if current_job:
        overall_status = "running"
    elif failed or blocked:
        overall_status = "completed_with_failures"
    return {
        "queue_root": str(output_root),
        "updated_at": utc_now(),
        "overall_status": overall_status,
        "current_job": current_job,
        "dataset_summary": dataset_summary,
        "total_jobs": len(jobs),
        "completed_jobs": completed,
        "failed_jobs": failed,
        "blocked_jobs": blocked,
        "skipped_existing_jobs": skipped_existing,
        "pending_jobs": pending,
        "items": items,
    }


def summarize_completed_payload(
    payload: dict[str, Any],
    *,
    fold_index: int,
) -> dict[str, Any]:
    component = payload["suite_component"]
    kind = str(component["kind"])
    if kind == "retrieval":
        row = summarize_retrieval_payload(payload)
    else:
        row = summarize_training_payload(payload)
    return {
        "fold_index": int(fold_index),
        "component_name": str(component["name"]),
        "component_label": str(component["label"]),
        "component_family": str(component["family"]),
        **row,
    }


def aggregate_queue_rows(rows: list[dict[str, Any]], jobs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    expected_folds: dict[str, int] = defaultdict(int)
    include_in_summary: dict[str, bool] = {}
    metadata: dict[str, dict[str, Any]] = {}
    for job in jobs:
        component_name = str(job["component_name"])
        expected_folds[component_name] += 1
        include_in_summary[component_name] = bool(job["include_in_summary"])
        metadata[component_name] = {
            "component_label": job["component_label"],
            "component_family": job["component_family"],
            "component_kind": job["component_kind"],
        }

    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[str(row["component_name"])].append(row)

    numeric_fields = [
        "val_acc",
        "val_bal_acc",
        "val_auroc",
        "test_acc",
        "test_bal_acc",
        "test_auroc",
        "test_sensitivity",
        "test_specificity",
        "decision_threshold",
    ]
    aggregate_rows: list[dict[str, Any]] = []
    for component_name, component_rows in sorted(grouped.items(), key=lambda item: min(int(row["order"]) for row in item[1])):
        if not include_in_summary.get(component_name, True):
            continue
        base = component_rows[0]
        aggregate_row: dict[str, Any] = {
            "component_name": component_name,
            "component_label": metadata[component_name]["component_label"],
            "component_family": metadata[component_name]["component_family"],
            "component_kind": metadata[component_name]["component_kind"],
            "order": base["order"],
            "architecture": base["architecture"],
            "evaluation_unit": base["evaluation_unit"],
            "completed_folds": len(component_rows),
            "expected_folds": expected_folds.get(component_name, 0),
            "missing_folds": max(0, expected_folds.get(component_name, 0) - len(component_rows)),
        }
        for field in numeric_fields:
            values = [float(row[field]) for row in component_rows if row.get(field) is not None]
            if values:
                mean_value = sum(values) / len(values)
                variance = sum((value - mean_value) ** 2 for value in values) / len(values)
                aggregate_row[f"{field}_mean"] = round(mean_value, 6)
                aggregate_row[f"{field}_std"] = round(variance ** 0.5, 6)
            else:
                aggregate_row[f"{field}_mean"] = None
                aggregate_row[f"{field}_std"] = None
        aggregate_rows.append(aggregate_row)
    aggregate_rows.sort(key=lambda item: int(item["order"]))
    return aggregate_rows


def refresh_summaries(output_root: Path, jobs: list[dict[str, Any]]) -> None:
    queue_rows: list[dict[str, Any]] = []
    for job in jobs:
        if not job["include_in_summary"]:
            continue
        payload_path = result_path(output_root, int(job["fold_index"]), str(job["component_name"]))
        if not payload_path.exists():
            continue
        payload = load_json(payload_path)
        queue_rows.append(summarize_completed_payload(payload, fold_index=int(job["fold_index"])))
    queue_rows.sort(key=lambda item: (int(item["fold_index"]), int(item["order"])))
    if queue_rows:
        write_csv(queue_summary_path(output_root), queue_rows)
        aggregate_rows = aggregate_queue_rows(queue_rows, jobs)
        if aggregate_rows:
            write_csv(aggregate_summary_path(output_root), aggregate_rows)


def run_single_job_subprocess(
    *,
    output_root: Path,
    python_exe: Path,
    script_path: Path,
    site_id: str,
    device: str,
    fold_index: int,
    component_name: str,
    epochs_override: int | None,
    max_retries: int,
    retry_delay_seconds: int,
) -> dict[str, Any]:
    stdout_log = job_stdout_log(output_root, fold_index, component_name)
    stderr_log = job_stderr_log(output_root, fold_index, component_name)
    stdout_log.parent.mkdir(parents=True, exist_ok=True)
    command = [
        str(python_exe),
        str(script_path),
        "job",
        "--site-id",
        site_id,
        "--device",
        device,
        "--output-root",
        str(output_root),
        "--fold-index",
        str(fold_index),
        "--component",
        component_name,
    ]
    if epochs_override is not None:
        command.extend(["--epochs-override", str(int(epochs_override))])

    attempts = 0
    last_exit_code = None
    started_at = utc_now()
    while attempts <= max_retries:
        attempts += 1
        with stdout_log.open("a", encoding="utf-8") as stdout_handle, stderr_log.open("a", encoding="utf-8") as stderr_handle:
            stdout_handle.write(f"\n[{utc_now()}] attempt={attempts} command={' '.join(command)}\n")
            stdout_handle.flush()
            process = subprocess.run(
                command,
                cwd=str(REPO_ROOT),
                stdout=stdout_handle,
                stderr=stderr_handle,
                text=True,
                check=False,
            )
        last_exit_code = int(process.returncode)
        if last_exit_code == 0 and result_path(output_root, fold_index, component_name).exists():
            break
        if attempts <= max_retries:
            time.sleep(max(0, retry_delay_seconds))

    ended_at = utc_now()
    status = "completed" if last_exit_code == 0 and result_path(output_root, fold_index, component_name).exists() else "failed"
    payload: dict[str, Any] = {
        "job_id": job_id(fold_index, component_name),
        "status": status,
        "attempts": attempts,
        "started_at": started_at,
        "ended_at": ended_at,
        "exit_code": last_exit_code,
        "fold_index": int(fold_index),
        "component_name": component_name,
        "stdout_log": str(stdout_log),
        "stderr_log": str(stderr_log),
        "result_path": str(result_path(output_root, fold_index, component_name)),
        "failure_path": str(failure_path(output_root, fold_index, component_name)),
    }
    if status != "completed":
        payload["stdout_tail"] = tail_text(stdout_log)
        payload["stderr_tail"] = tail_text(stderr_log)
    return payload


def audit_retrieval_payload(payload: dict[str, Any]) -> dict[str, Any]:
    result = payload["result"]
    same_patient_neighbors = 0
    same_visit_neighbors = 0
    total_neighbors = 0
    for split_name in ["val_predictions", "test_predictions"]:
        for prediction in result.get(split_name, []):
            query_patient = str(prediction.get("patient_id") or "")
            query_visit = str(prediction.get("visit_date") or "")
            for neighbor in prediction.get("neighbor_visits", []):
                total_neighbors += 1
                if str(neighbor.get("patient_id") or "") == query_patient:
                    same_patient_neighbors += 1
                if str(neighbor.get("patient_id") or "") == query_patient and str(neighbor.get("visit_date") or "") == query_visit:
                    same_visit_neighbors += 1
    return {
        "created_at": utc_now(),
        "component_name": str(payload["suite_component"]["name"]),
        "evaluation_mode": str(result.get("evaluation_mode") or ""),
        "evaluation_unit": str(result.get("evaluation_unit") or ""),
        "same_patient_exclusion_declared": bool(result.get("same_patient_exclusion", False)),
        "total_neighbors_checked": int(total_neighbors),
        "same_patient_neighbors": int(same_patient_neighbors),
        "same_visit_neighbors": int(same_visit_neighbors),
        "passed": same_patient_neighbors == 0 and same_visit_neighbors == 0,
    }


def run_job(args: argparse.Namespace) -> int:
    output_root = args.output_root.expanduser().resolve()
    fold_index = int(args.fold_index)
    component_name = str(args.component).strip()
    component_map = component_index(None, args.epochs_override)
    if component_name not in component_map:
        raise ValueError(f"Unknown component: {component_name}")

    folds_payload = load_json(folds_path(output_root))
    folds = [dict(item) for item in folds_payload.get("folds", [])]
    fold = next((item for item in folds if int(item["fold_index"]) == fold_index), None)
    if fold is None:
        raise ValueError(f"Fold {fold_index} is not defined in {folds_path(output_root)}")

    control_plane = ControlPlaneStore()
    workflow = ResearchWorkflowService(control_plane)
    site_store = SiteStore(args.site_id)
    manifest_records = site_store.generate_manifest().to_dict("records")
    ssl_checkpoint_path = default_ssl_checkpoint_path()
    component = component_map[component_name]
    spec = component["spec"]

    try:
        if component["kind"] == "standard":
            payload = run_standard_component(
                spec=spec,
                workflow=workflow,
                site_store=site_store,
                manifest_records=manifest_records,
                shared_split=fold,
                output_root=fold_dir(output_root, fold_index),
                device=args.device,
            )
        elif component["kind"] == "retrieval":
            payload = run_retrieval_component(
                spec=spec,
                workflow=workflow,
                site_store=site_store,
                manifest_records=manifest_records,
                shared_split=fold,
                output_root=fold_dir(output_root, fold_index),
                device=args.device,
                ssl_checkpoint_path=ssl_checkpoint_path,
            )
            write_json(component_leakage_audit_path(output_root, fold_index, component_name), audit_retrieval_payload(payload))
        else:
            warm_start_override = None
            if component_name == "h5_lgf_current":
                prereq_payload_path = result_path(output_root, fold_index, "prereq_h2_current_ssl_tuned")
                if not prereq_payload_path.exists():
                    raise RuntimeError(
                        f"h5_lgf_current fold {fold_index} requires prereq_h2_current_ssl_tuned fold {fold_index}, but the prerequisite result is missing."
                    )
                prereq_payload = load_json(prereq_payload_path)
                warm_start_override = str(prereq_payload["result"]["output_model_path"])
            payload = run_custom_component(
                spec=spec,
                workflow=workflow,
                site_store=site_store,
                manifest_records=manifest_records,
                shared_split=fold,
                output_root=fold_dir(output_root, fold_index),
                device=args.device,
                ssl_checkpoint_path=ssl_checkpoint_path,
                warm_start_override=warm_start_override,
            )

        failure_file = failure_path(output_root, fold_index, component_name)
        if failure_file.exists():
            failure_file.unlink()
        print(
            json.dumps(
                {
                    "job_id": job_id(fold_index, component_name),
                    "status": "completed",
                    "result_path": str(result_path(output_root, fold_index, component_name)),
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0
    except Exception as exc:
        payload = {
            "job_id": job_id(fold_index, component_name),
            "status": "failed",
            "error": str(exc),
            "traceback": traceback.format_exc(),
            "failed_at": utc_now(),
        }
        write_json(failure_path(output_root, fold_index, component_name), payload)
        print(json.dumps(payload, ensure_ascii=False, indent=2), file=sys.stderr)
        return 1


def run_queue(args: argparse.Namespace) -> int:
    output_root = args.output_root.expanduser().resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    script_path = Path(__file__).resolve()
    python_exe = args.python_exe.expanduser().resolve()
    if not python_exe.exists():
        raise FileNotFoundError(f"Python executable does not exist: {python_exe}")

    control_plane = ControlPlaneStore()
    workflow = ResearchWorkflowService(control_plane)
    site_store = SiteStore(args.site_id)
    manifest_records = site_store.generate_manifest().to_dict("records")
    dataset_summary = summarize_dataset(manifest_records)
    folds = load_or_build_folds(
        output_root,
        workflow=workflow,
        manifest_records=manifest_records,
        num_folds=int(args.num_folds),
        val_split=float(args.val_split),
        force_rerun=bool(args.force_rerun),
    )
    components = build_components(args.components, args.epochs_override)
    jobs = build_jobs(components, folds)

    write_json(
        config_path(output_root),
        {
            "created_at": utc_now(),
            "site_id": args.site_id,
            "device": args.device,
            "python_exe": str(python_exe),
            "num_folds": int(args.num_folds),
            "val_split": float(args.val_split),
            "epochs_override": int(args.epochs_override) if args.epochs_override is not None else None,
            "max_retries": int(args.max_retries),
            "retry_delay_seconds": int(args.retry_delay_seconds),
            "force_rerun": bool(args.force_rerun),
            "dataset_summary": dataset_summary,
        },
    )
    write_json(planned_jobs_path(output_root), {"created_at": utc_now(), "jobs": jobs})
    write_json(leakage_audit_path(output_root), build_pre_run_leakage_audit(manifest_records, folds))

    items: dict[str, dict[str, Any]] = {}
    jobs_run = 0
    for job in jobs:
        current_job_id = str(job["job_id"])
        fold_index = int(job["fold_index"])
        component_name = str(job["component_name"])
        existing_result_path = result_path(output_root, fold_index, component_name)

        if existing_result_path.exists() and not args.force_rerun:
            items[current_job_id] = {
                "job_id": current_job_id,
                "status": "skipped_existing",
                "fold_index": fold_index,
                "component_name": component_name,
                "started_at": None,
                "ended_at": utc_now(),
                "result_path": str(existing_result_path),
                "stdout_log": str(job_stdout_log(output_root, fold_index, component_name)),
                "stderr_log": str(job_stderr_log(output_root, fold_index, component_name)),
                "skipped_existing": True,
            }
            write_json(
                queue_status_path(output_root),
                build_queue_status(
                    output_root=output_root,
                    jobs=jobs,
                    items=items,
                    current_job=None,
                    dataset_summary=dataset_summary,
                ),
            )
            refresh_summaries(output_root, jobs)
            continue

        dependency = job.get("dependency")
        if dependency and items.get(dependency, {}).get("status") in {"failed", "blocked"}:
            blocked_payload = {
                "job_id": current_job_id,
                "status": "blocked",
                "fold_index": fold_index,
                "component_name": component_name,
                "dependency": dependency,
                "reason": f"Dependency did not complete: {dependency}",
                "ended_at": utc_now(),
            }
            items[current_job_id] = blocked_payload
            write_json(job_state_path(output_root, fold_index, component_name), blocked_payload)
            write_json(
                queue_status_path(output_root),
                build_queue_status(
                    output_root=output_root,
                    jobs=jobs,
                    items=items,
                    current_job=None,
                    dataset_summary=dataset_summary,
                ),
            )
            continue

        write_json(
            queue_status_path(output_root),
            build_queue_status(
                output_root=output_root,
                jobs=jobs,
                items=items,
                current_job=current_job_id,
                dataset_summary=dataset_summary,
            ),
        )
        items[current_job_id] = run_single_job_subprocess(
            output_root=output_root,
            python_exe=python_exe,
            script_path=script_path,
            site_id=args.site_id,
            device=args.device,
            fold_index=fold_index,
            component_name=component_name,
            epochs_override=args.epochs_override,
            max_retries=max(0, int(args.max_retries)),
            retry_delay_seconds=max(0, int(args.retry_delay_seconds)),
        )
        write_json(job_state_path(output_root, fold_index, component_name), items[current_job_id])
        jobs_run += 1
        write_json(
            queue_status_path(output_root),
            build_queue_status(
                output_root=output_root,
                jobs=jobs,
                items=items,
                current_job=None,
                dataset_summary=dataset_summary,
            ),
        )
        refresh_summaries(output_root, jobs)
        if args.max_jobs is not None and jobs_run >= int(args.max_jobs):
            break

    refresh_summaries(output_root, jobs)
    write_json(
        queue_status_path(output_root),
        build_queue_status(
            output_root=output_root,
            jobs=jobs,
            items=items,
            current_job=None,
            dataset_summary=dataset_summary,
        ),
    )
    print(
        json.dumps(
            {
                "output_root": str(output_root),
                "total_jobs": len(jobs),
                "jobs_executed_this_run": jobs_run,
                "queue_status": str(queue_status_path(output_root)),
                "queue_summary": str(queue_summary_path(output_root)),
                "aggregate_summary": str(aggregate_summary_path(output_root)),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


def main() -> int:
    args = parse_args()
    if args.command == "job":
        return run_job(args)
    return run_queue(args)


if __name__ == "__main__":
    raise SystemExit(main())
