from __future__ import annotations

import argparse
import csv
import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
RECOVERY_SCRIPT = REPO_ROOT / "scripts" / "run_dinov2_recovery_validation.py"

DEFAULT_QUEUE_EXPERIMENTS = [
    "h4_warmstart_lgf",
    "h5_warmstart_lgf_balanced_pat10",
    "h5_warmstart_lgf_lowbb_pat10",
    "h5_warmstart_lgf_verylowbb_pat10",
    "h5_warmstart_lgf_highhead_pat10",
]


def utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run DINOv2 validation experiments as an overnight queue with per-experiment isolation."
    )
    parser.add_argument(
        "--experiments",
        nargs="*",
        default=DEFAULT_QUEUE_EXPERIMENTS,
        help="Experiment names from run_dinov2_recovery_validation.py to execute in sequence.",
    )
    parser.add_argument(
        "--queue-root",
        type=Path,
        default=REPO_ROOT / "artifacts" / "dinov2_overnight_queue",
        help="Root directory for queue state, logs, and per-experiment outputs.",
    )
    parser.add_argument(
        "--python-exe",
        type=Path,
        default=REPO_ROOT / ".venv" / "Scripts" / "python.exe",
        help="Python executable used to launch child experiment processes.",
    )
    parser.add_argument("--device", default="cuda", choices=["cuda", "cpu", "auto"])
    parser.add_argument("--main-epochs", type=int, default=30)
    parser.add_argument("--overfit-epochs", type=int, default=60)
    parser.add_argument("--max-retries", type=int, default=1)
    parser.add_argument("--retry-delay-seconds", type=int, default=10)
    parser.add_argument(
        "--force-rerun",
        action="store_true",
        help="Re-run experiments even if a result.json already exists for that experiment.",
    )
    return parser.parse_args()


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


def experiment_output_root(queue_root: Path, experiment_name: str) -> Path:
    return queue_root / "runs" / experiment_name


def experiment_result_path(queue_root: Path, experiment_name: str) -> Path:
    return experiment_output_root(queue_root, experiment_name) / experiment_name / "result.json"


def experiment_stdout_log(queue_root: Path, experiment_name: str) -> Path:
    return queue_root / "logs" / f"{experiment_name}.stdout.log"


def experiment_stderr_log(queue_root: Path, experiment_name: str) -> Path:
    return queue_root / "logs" / f"{experiment_name}.stderr.log"


def summarize_result(result_path: Path) -> dict[str, Any]:
    payload = load_json(result_path)
    result = payload["result"]
    test_metrics = result.get("test_metrics") or result.get("test_metrics_recomputed") or {}
    val_metrics = result.get("val_metrics") or result.get("val_metrics_recomputed") or {}
    return {
        "experiment": str(payload["spec"]["name"]),
        "architecture": str(result.get("architecture") or ""),
        "best_val_acc": float(result.get("best_val_acc") or 0.0),
        "threshold_metric": str(result.get("threshold_selection_metric") or ""),
        "decision_threshold": float(result.get("decision_threshold") or 0.0),
        "val_acc": float(val_metrics.get("accuracy") or 0.0),
        "val_bal_acc": float(val_metrics.get("balanced_accuracy") or 0.0),
        "val_auroc": float(val_metrics["AUROC"]) if val_metrics.get("AUROC") is not None else None,
        "test_acc": float(test_metrics.get("accuracy") or 0.0),
        "test_bal_acc": float(test_metrics.get("balanced_accuracy") or 0.0),
        "test_auroc": float(test_metrics["AUROC"]) if test_metrics.get("AUROC") is not None else None,
        "test_sensitivity": float(test_metrics.get("sensitivity") or 0.0),
        "test_specificity": float(test_metrics.get("specificity") or 0.0),
        "test_f1": float(test_metrics.get("F1") or 0.0),
        "test_brier": float(test_metrics.get("brier_score") or 0.0),
        "test_ece": float(test_metrics.get("ece") or 0.0),
        "output_model_path": str(result.get("output_model_path") or ""),
    }


def run_single_experiment(
    *,
    experiment_name: str,
    queue_root: Path,
    python_exe: Path,
    device: str,
    main_epochs: int,
    overfit_epochs: int,
    max_retries: int,
    retry_delay_seconds: int,
) -> dict[str, Any]:
    output_root = experiment_output_root(queue_root, experiment_name)
    stdout_log = experiment_stdout_log(queue_root, experiment_name)
    stderr_log = experiment_stderr_log(queue_root, experiment_name)
    output_root.mkdir(parents=True, exist_ok=True)
    stdout_log.parent.mkdir(parents=True, exist_ok=True)

    command = [
        str(python_exe),
        str(RECOVERY_SCRIPT),
        "--experiments",
        experiment_name,
        "--output-root",
        str(output_root),
        "--device",
        device,
        "--main-epochs",
        str(main_epochs),
        "--overfit-epochs",
        str(overfit_epochs),
    ]

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
        if last_exit_code == 0:
            break
        if attempts <= max_retries:
            time.sleep(max(0, retry_delay_seconds))

    result_path = experiment_result_path(queue_root, experiment_name)
    ended_at = utc_now()
    status = "completed" if last_exit_code == 0 and result_path.exists() else "failed"
    payload: dict[str, Any] = {
        "experiment": experiment_name,
        "status": status,
        "attempts": attempts,
        "started_at": started_at,
        "ended_at": ended_at,
        "exit_code": last_exit_code,
        "output_root": str(output_root),
        "stdout_log": str(stdout_log),
        "stderr_log": str(stderr_log),
    }
    if status == "completed":
        payload["summary"] = summarize_result(result_path)
    else:
        payload["stderr_tail"] = tail_text(stderr_log)
        payload["stdout_tail"] = tail_text(stdout_log)
    return payload


def build_queue_status(
    *,
    queue_root: Path,
    experiments: list[str],
    items: dict[str, dict[str, Any]],
    current_experiment: str | None,
) -> dict[str, Any]:
    completed = [name for name in experiments if items.get(name, {}).get("status") == "completed"]
    failed = [name for name in experiments if items.get(name, {}).get("status") == "failed"]
    pending = [name for name in experiments if name not in completed and name not in failed and name != current_experiment]
    return {
        "queue_root": str(queue_root),
        "updated_at": utc_now(),
        "current_experiment": current_experiment,
        "experiments": experiments,
        "completed": completed,
        "failed": failed,
        "pending": pending,
        "items": items,
    }


def main() -> int:
    args = parse_args()
    queue_root = args.queue_root.expanduser().resolve()
    queue_root.mkdir(parents=True, exist_ok=True)
    python_exe = args.python_exe.expanduser().resolve()
    if not python_exe.exists():
        raise FileNotFoundError(f"Python executable does not exist: {python_exe}")
    if not RECOVERY_SCRIPT.exists():
        raise FileNotFoundError(f"Recovery script does not exist: {RECOVERY_SCRIPT}")

    experiments = [name.strip() for name in args.experiments if str(name).strip()]
    items: dict[str, dict[str, Any]] = {}

    status_path = queue_root / "queue_status.json"
    summary_path = queue_root / "queue_summary.csv"

    for experiment_name in experiments:
        result_path = experiment_result_path(queue_root, experiment_name)
        if result_path.exists() and not args.force_rerun:
            items[experiment_name] = {
                "experiment": experiment_name,
                "status": "completed",
                "attempts": 0,
                "started_at": None,
                "ended_at": utc_now(),
                "exit_code": 0,
                "output_root": str(experiment_output_root(queue_root, experiment_name)),
                "stdout_log": str(experiment_stdout_log(queue_root, experiment_name)),
                "stderr_log": str(experiment_stderr_log(queue_root, experiment_name)),
                "summary": summarize_result(result_path),
                "skipped_existing": True,
            }
            write_json(
                status_path,
                build_queue_status(
                    queue_root=queue_root,
                    experiments=experiments,
                    items=items,
                    current_experiment=None,
                ),
            )
            continue

        write_json(
            status_path,
            build_queue_status(
                queue_root=queue_root,
                experiments=experiments,
                items=items,
                current_experiment=experiment_name,
            ),
        )
        items[experiment_name] = run_single_experiment(
            experiment_name=experiment_name,
            queue_root=queue_root,
            python_exe=python_exe,
            device=args.device,
            main_epochs=args.main_epochs,
            overfit_epochs=args.overfit_epochs,
            max_retries=max(0, int(args.max_retries)),
            retry_delay_seconds=max(0, int(args.retry_delay_seconds)),
        )
        write_json(
            status_path,
            build_queue_status(
                queue_root=queue_root,
                experiments=experiments,
                items=items,
                current_experiment=None,
            ),
        )

    summary_rows = [item["summary"] for item in items.values() if item.get("status") == "completed" and isinstance(item.get("summary"), dict)]
    if summary_rows:
        write_csv(summary_path, summary_rows)
    print(json.dumps({"queue_root": str(queue_root), "experiments": experiments}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
