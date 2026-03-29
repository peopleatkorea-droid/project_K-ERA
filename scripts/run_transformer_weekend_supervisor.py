from __future__ import annotations

import argparse
import json
import logging
import os
import subprocess
import sys
import time
import atexit
from datetime import datetime
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = REPO_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from kera_research.config import STORAGE_DIR
from kera_research.domain import utc_now

LOGGER = logging.getLogger("transformer_weekend_supervisor")


def build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Monitor and auto-resume the transformer weekend plan.")
    parser.add_argument("--plan-root", type=Path, required=True)
    parser.add_argument("--archive-base-dir", type=Path, default=Path(r"C:\전안부 사진"))
    parser.add_argument("--site-id", default="")
    parser.add_argument("--device", default="cuda", choices=["auto", "cuda", "cpu"])
    parser.add_argument("--heartbeat-dir", type=Path, default=STORAGE_DIR / "weekend_plan_logs")
    parser.add_argument("--poll-seconds", type=int, default=180)
    parser.add_argument("--cooldown-seconds", type=int, default=90)
    parser.add_argument("--max-restarts", type=int, default=8)
    parser.add_argument("--expected-total-stages", type=int, default=20)
    parser.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    return parser


def configure_logging(log_path: Path, log_level: str) -> None:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=getattr(logging, str(log_level).upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(log_path, encoding="utf-8"),
        ],
    )


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def append_jsonl(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False) + "\n")


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def process_exists(pid: int) -> bool:
    if pid <= 0:
        return False
    completed = subprocess.run(
        ["powershell", "-NoProfile", "-Command", f"Get-Process -Id {pid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id"],
        cwd=str(REPO_ROOT),
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return completed.returncode == 0 and str(pid) in (completed.stdout or "")


def acquire_single_instance_lock(plan_root: Path) -> tuple[int, Path] | None:
    lock_path = plan_root / "weekend_plan_supervisor.lock"
    while True:
        try:
            fd = os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, str(os.getpid()).encode("utf-8"))
            os.fsync(fd)
            return fd, lock_path
        except FileExistsError:
            try:
                existing_pid = int(lock_path.read_text(encoding="utf-8").strip() or "0")
            except Exception:
                existing_pid = 0
            if existing_pid and process_exists(existing_pid):
                LOGGER.info("Another supervisor is already active for %s (pid=%s). Exiting.", plan_root, existing_pid)
                return None
            try:
                lock_path.unlink(missing_ok=True)
            except Exception:
                time.sleep(1)


def release_single_instance_lock(lock: tuple[int, Path] | None) -> None:
    if lock is None:
        return
    fd, path = lock
    try:
        os.close(fd)
    except Exception:
        pass
    try:
        path.unlink(missing_ok=True)
    except Exception:
        pass


def query_plan_runner_processes(plan_root: Path) -> list[dict[str, Any]]:
    escaped_root = str(plan_root).replace("'", "''")
    command = rf"""
$items = Get-CimInstance Win32_Process |
  Where-Object {{
    $_.Name -eq 'python.exe' -and
    $_.CommandLine -like '*run_transformer_weekend_plan.py*' -and
    $_.CommandLine -like '*{escaped_root}*'
  }} |
  Select-Object ProcessId, CommandLine
$items | ConvertTo-Json -Compress
"""
    completed = subprocess.run(
        ["powershell", "-NoProfile", "-Command", command],
        cwd=str(REPO_ROOT),
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    stdout = (completed.stdout or "").strip()
    if completed.returncode != 0 or not stdout:
        return []
    try:
        payload = json.loads(stdout)
    except json.JSONDecodeError:
        LOGGER.warning("Unable to parse runner process list: %s", stdout[:500])
        return []
    if isinstance(payload, dict):
        return [payload]
    if isinstance(payload, list):
        return payload
    return []


def resolve_python_executable() -> Path:
    candidate = REPO_ROOT / ".venv" / "Scripts" / "python.exe"
    if candidate.exists():
        return candidate
    return Path(sys.executable)


def plan_status(plan_root: Path, expected_total_stages: int) -> dict[str, Any]:
    summary_path = plan_root / "plan_summary.json"
    summary = load_json(summary_path) if summary_path.exists() else {}
    stages = summary.get("stages") if isinstance(summary.get("stages"), dict) else {}
    completed = sum(1 for payload in stages.values() if str(payload.get("status") or "").lower() == "completed")
    failed = sum(1 for payload in stages.values() if str(payload.get("status") or "").lower() == "failed")
    total = int(summary.get("total_stages") or expected_total_stages)
    done = completed >= total and total > 0 and failed == 0
    return {
        "summary_path": str(summary_path),
        "completed_stages": completed,
        "failed_stages": failed,
        "total_stages": total,
        "is_complete": done,
    }


def launch_runner(*, plan_root: Path, archive_base_dir: Path, site_id: str, device: str, heartbeat_dir: Path) -> int:
    python_executable = resolve_python_executable()
    runner_script = REPO_ROOT / "scripts" / "run_transformer_weekend_plan.py"
    command = [
        str(python_executable),
        str(runner_script),
        "--plan-root",
        str(plan_root),
        "--archive-base-dir",
        str(archive_base_dir.expanduser().resolve()),
        "--device",
        str(device),
        "--heartbeat-dir",
        str(heartbeat_dir.expanduser().resolve()),
    ]
    if str(site_id or "").strip():
        command.extend(["--site-id", str(site_id).strip()])
    creationflags = 0
    if os.name == "nt":
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
    process = subprocess.Popen(
        command,
        cwd=str(REPO_ROOT),
        creationflags=creationflags,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
    )
    return int(process.pid)


def main() -> int:
    parser = build_argument_parser()
    args = parser.parse_args()

    plan_root = args.plan_root.expanduser().resolve()
    supervisor_log = plan_root / "weekend_plan_supervisor.log"
    configure_logging(supervisor_log, args.log_level)

    lock = acquire_single_instance_lock(plan_root)
    if lock is None:
        return 0
    atexit.register(release_single_instance_lock, lock)

    state_path = args.heartbeat_dir.expanduser().resolve() / f"{plan_root.name}_supervisor_current.json"
    history_path = args.heartbeat_dir.expanduser().resolve() / f"{plan_root.name}_supervisor_history.jsonl"

    restart_count = 0
    missing_since: float | None = None

    LOGGER.info(
        "Started weekend plan supervisor: plan_root=%s expected_total_stages=%s max_restarts=%s",
        plan_root,
        args.expected_total_stages,
        args.max_restarts,
    )

    while True:
        runners = query_plan_runner_processes(plan_root)
        status = plan_status(plan_root, int(args.expected_total_stages))
        payload = {
            "timestamp": utc_now(),
            "plan_root": str(plan_root),
            "active_runners": runners,
            "restart_count": restart_count,
            "missing_since": datetime.fromtimestamp(missing_since).isoformat() if missing_since else None,
            **status,
        }
        write_json(state_path, payload)
        append_jsonl(history_path, payload)

        if status["is_complete"] and not runners:
            LOGGER.info("Plan completed. Supervisor exiting.")
            release_single_instance_lock(lock)
            return 0

        if runners:
            missing_since = None
            time.sleep(max(30, int(args.poll_seconds)))
            continue

        if missing_since is None:
            missing_since = time.time()
            LOGGER.warning("No active runner detected for plan_root=%s. Waiting cooldown before restart.", plan_root)
            time.sleep(max(15, int(args.poll_seconds)))
            continue

        missing_for = time.time() - missing_since
        if missing_for < max(30, int(args.cooldown_seconds)):
            time.sleep(max(15, int(args.poll_seconds)))
            continue

        if restart_count >= int(args.max_restarts):
            LOGGER.error("Max restart count reached (%s). Supervisor stopping.", args.max_restarts)
            release_single_instance_lock(lock)
            return 1

        try:
            new_pid = launch_runner(
                plan_root=plan_root,
                archive_base_dir=args.archive_base_dir,
                site_id=args.site_id,
                device=args.device,
                heartbeat_dir=args.heartbeat_dir,
            )
            restart_count += 1
            missing_since = None
            LOGGER.warning("Restarted weekend runner for plan_root=%s (pid=%s, restart=%s).", plan_root, new_pid, restart_count)
            time.sleep(max(30, int(args.poll_seconds)))
        except Exception as exc:
            LOGGER.exception("Unable to restart weekend runner: %s", exc)
            time.sleep(max(30, int(args.poll_seconds)))


if __name__ == "__main__":
    raise SystemExit(main())
