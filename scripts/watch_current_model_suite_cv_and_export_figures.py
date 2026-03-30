from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SUITE_ROOT = REPO_ROOT / "artifacts" / "current_model_suite_cv_20260330_p73_5fold"
EXPORT_SCRIPT = REPO_ROOT / "scripts" / "export_current_model_suite_cv_figures.py"


def utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Watch a running current-model-suite CV queue and export figures when it completes."
    )
    parser.add_argument("--suite-root", type=Path, default=DEFAULT_SUITE_ROOT)
    parser.add_argument("--python-exe", type=Path, default=Path(sys.executable))
    parser.add_argument("--poll-seconds", type=int, default=120)
    parser.add_argument("--out-dir", type=Path, default=None)
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    suite_root = args.suite_root.expanduser().resolve()
    python_exe = args.python_exe.expanduser().resolve()
    out_dir = args.out_dir.expanduser().resolve() if args.out_dir else None
    if not python_exe.exists():
        raise FileNotFoundError(f"Python executable does not exist: {python_exe}")
    if not EXPORT_SCRIPT.exists():
        raise FileNotFoundError(f"Export script does not exist: {EXPORT_SCRIPT}")

    monitor_status_path = suite_root / "figure_monitor_status.json"
    monitor_stdout = suite_root / "figure_export_stdout.log"
    monitor_stderr = suite_root / "figure_export_stderr.log"
    write_json(
        monitor_status_path,
        {
            "status": "watching",
            "started_at": utc_now(),
            "suite_root": str(suite_root),
            "poll_seconds": int(args.poll_seconds),
            "out_dir": str(out_dir) if out_dir else None,
        },
    )

    queue_status_path = suite_root / "queue_status.json"
    while True:
        if not queue_status_path.exists():
            write_json(
                monitor_status_path,
                {
                    "status": "waiting_for_queue_status",
                    "updated_at": utc_now(),
                    "queue_status_path": str(queue_status_path),
                },
            )
            time.sleep(max(10, int(args.poll_seconds)))
            continue

        queue_status = load_json(queue_status_path)
        overall_status = str(queue_status.get("overall_status") or "")
        current_job = queue_status.get("current_job")
        pending_jobs = queue_status.get("pending_jobs") or []
        if overall_status in {"completed", "completed_with_failures"} and not current_job and not pending_jobs:
            break
        write_json(
            monitor_status_path,
            {
                "status": "watching",
                "updated_at": utc_now(),
                "queue_overall_status": overall_status,
                "current_job": current_job,
                "pending_jobs": len(pending_jobs),
                "completed_jobs": len(queue_status.get("completed_jobs") or []),
                "failed_jobs": len(queue_status.get("failed_jobs") or []),
                "blocked_jobs": len(queue_status.get("blocked_jobs") or []),
            },
        )
        time.sleep(max(10, int(args.poll_seconds)))

    command = [
        str(python_exe),
        str(EXPORT_SCRIPT),
        "--suite-root",
        str(suite_root),
    ]
    if out_dir is not None:
        command.extend(["--out-dir", str(out_dir)])

    with monitor_stdout.open("a", encoding="utf-8") as stdout_handle, monitor_stderr.open("a", encoding="utf-8") as stderr_handle:
        stdout_handle.write(f"\n[{utc_now()}] exporting figures command={' '.join(command)}\n")
        stdout_handle.flush()
        process = subprocess.run(
            command,
            cwd=str(REPO_ROOT),
            stdout=stdout_handle,
            stderr=stderr_handle,
            text=True,
            check=False,
        )

    status_payload = {
        "status": "completed" if process.returncode == 0 else "failed",
        "updated_at": utc_now(),
        "queue_status_path": str(queue_status_path),
        "stdout_log": str(monitor_stdout),
        "stderr_log": str(monitor_stderr),
        "exit_code": int(process.returncode),
        "export_command": command,
    }
    if out_dir is not None:
        status_payload["out_dir"] = str(out_dir)
    write_json(monitor_status_path, status_payload)
    return int(process.returncode)


if __name__ == "__main__":
    raise SystemExit(main())
