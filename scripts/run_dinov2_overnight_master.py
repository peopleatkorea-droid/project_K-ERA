from __future__ import annotations

import argparse
import csv
import json
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
RETRIEVAL_SCRIPT = REPO_ROOT / "scripts" / "run_dinov2_retrieval_validation.py"
WARMSTART_QUEUE_SCRIPT = REPO_ROOT / "scripts" / "run_dinov2_overnight_queue.py"


@dataclass(slots=True)
class BatchTask:
    name: str
    script_path: Path
    output_root_name: str
    extra_args: tuple[str, ...] = ()


def utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the DINOv2 overnight plan with retrieval matrix plus warm-start LGF queue."
    )
    parser.add_argument(
        "--queue-root",
        type=Path,
        default=REPO_ROOT / "artifacts" / "dinov2_overnight_master",
    )
    parser.add_argument(
        "--python-exe",
        type=Path,
        default=REPO_ROOT / ".venv" / "Scripts" / "python.exe",
    )
    parser.add_argument("--device", default="cuda", choices=["cuda", "cpu", "auto"])
    parser.add_argument("--max-retries", type=int, default=1)
    parser.add_argument("--retry-delay-seconds", type=int, default=15)
    parser.add_argument("--force-rerun", action="store_true")
    return parser.parse_args()


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


def build_tasks(queue_root: Path) -> list[BatchTask]:
    return [
        BatchTask(
            name="retrieval_matrix",
            script_path=RETRIEVAL_SCRIPT,
            output_root_name="retrieval_matrix",
        ),
        BatchTask(
            name="warmstart_balanced_queue",
            script_path=WARMSTART_QUEUE_SCRIPT,
            output_root_name="warmstart_balanced_queue",
            extra_args=("--max-retries", "1"),
        ),
    ]


def task_output_root(queue_root: Path, task: BatchTask) -> Path:
    return queue_root / task.output_root_name


def task_stdout_log(queue_root: Path, task: BatchTask) -> Path:
    return queue_root / "logs" / f"{task.name}.stdout.log"


def task_stderr_log(queue_root: Path, task: BatchTask) -> Path:
    return queue_root / "logs" / f"{task.name}.stderr.log"


def task_state_path(queue_root: Path, task: BatchTask) -> Path:
    return queue_root / "task_state" / f"{task.name}.json"


def build_task_command(
    *,
    task: BatchTask,
    queue_root: Path,
    python_exe: Path,
    device: str,
    force_rerun: bool,
) -> list[str]:
    output_root = task_output_root(queue_root, task)
    command = [
        str(python_exe),
        str(task.script_path),
        "--output-root" if task.name == "retrieval_matrix" else "--queue-root",
        str(output_root),
        "--device",
        device,
    ]
    command.extend(task.extra_args)
    if force_rerun:
        command.append("--force-rerun")
    return command


def collect_batch_summaries(queue_root: Path, tasks: list[BatchTask]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for task in tasks:
        if task.name == "retrieval_matrix":
            summary_path = task_output_root(queue_root, task) / "summary.csv"
        else:
            summary_path = task_output_root(queue_root, task) / "queue_summary.csv"
        if not summary_path.exists():
            continue
        with summary_path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                rows.append({"batch": task.name, **row})
    return rows


def build_queue_status(
    *,
    queue_root: Path,
    tasks: list[BatchTask],
    items: dict[str, dict[str, Any]],
    current_task: str | None,
) -> dict[str, Any]:
    task_names = [task.name for task in tasks]
    completed = [name for name in task_names if items.get(name, {}).get("status") == "completed"]
    failed = [name for name in task_names if items.get(name, {}).get("status") == "failed"]
    pending = [name for name in task_names if name not in completed and name not in failed and name != current_task]
    return {
        "queue_root": str(queue_root),
        "updated_at": utc_now(),
        "current_task": current_task,
        "tasks": task_names,
        "completed": completed,
        "failed": failed,
        "pending": pending,
        "items": items,
    }


def run_task(
    *,
    task: BatchTask,
    queue_root: Path,
    python_exe: Path,
    device: str,
    max_retries: int,
    retry_delay_seconds: int,
    force_rerun: bool,
) -> dict[str, Any]:
    command = build_task_command(
        task=task,
        queue_root=queue_root,
        python_exe=python_exe,
        device=device,
        force_rerun=force_rerun,
    )
    stdout_log = task_stdout_log(queue_root, task)
    stderr_log = task_stderr_log(queue_root, task)
    stdout_log.parent.mkdir(parents=True, exist_ok=True)

    attempts = 0
    exit_code = None
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
        exit_code = int(process.returncode)
        if exit_code == 0:
            break
        if attempts <= max_retries:
            time.sleep(max(0, retry_delay_seconds))

    payload = {
        "task": task.name,
        "status": "completed" if exit_code == 0 else "failed",
        "attempts": attempts,
        "started_at": started_at,
        "ended_at": utc_now(),
        "exit_code": exit_code,
        "stdout_log": str(stdout_log),
        "stderr_log": str(stderr_log),
        "output_root": str(task_output_root(queue_root, task)),
    }
    write_json(task_state_path(queue_root, task), payload)
    return payload


def main() -> int:
    args = parse_args()
    queue_root = args.queue_root.expanduser().resolve()
    queue_root.mkdir(parents=True, exist_ok=True)
    python_exe = args.python_exe.expanduser().resolve()
    if not python_exe.exists():
        raise FileNotFoundError(f"Python executable does not exist: {python_exe}")

    tasks = build_tasks(queue_root)
    status_path = queue_root / "queue_status.json"
    summary_path = queue_root / "master_summary.csv"
    items: dict[str, dict[str, Any]] = {}

    for task in tasks:
        state_path = task_state_path(queue_root, task)
        if state_path.exists() and not args.force_rerun:
            state = json.loads(state_path.read_text(encoding="utf-8"))
            if str(state.get("status") or "").strip().lower() == "completed":
                items[task.name] = {**state, "skipped_existing": True}
                write_json(
                    status_path,
                    build_queue_status(
                        queue_root=queue_root,
                        tasks=tasks,
                        items=items,
                        current_task=None,
                    ),
                )
                continue

        write_json(
            status_path,
            build_queue_status(
                queue_root=queue_root,
                tasks=tasks,
                items=items,
                current_task=task.name,
            ),
        )
        items[task.name] = run_task(
            task=task,
            queue_root=queue_root,
            python_exe=python_exe,
            device=args.device,
            max_retries=max(0, int(args.max_retries)),
            retry_delay_seconds=max(0, int(args.retry_delay_seconds)),
            force_rerun=args.force_rerun,
        )
        write_json(
            status_path,
            build_queue_status(
                queue_root=queue_root,
                tasks=tasks,
                items=items,
                current_task=None,
            ),
        )

    summary_rows = collect_batch_summaries(queue_root, tasks)
    if summary_rows:
        write_csv(summary_path, summary_rows)
    print(json.dumps({"queue_root": str(queue_root), "tasks": [task.name for task in tasks]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
