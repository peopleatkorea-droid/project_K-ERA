from __future__ import annotations

import os
import sys
from pathlib import Path

import uvicorn

ROOT = Path(__file__).resolve().parent
SRC_DIR = ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))


def _load_local_env_file() -> None:
    if os.getenv("KERA_SKIP_LOCAL_ENV_FILE", "").strip().lower() in {"1", "true", "yes", "on"}:
        return
    env_path = ROOT / ".env.local"
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        name, value = line.split("=", 1)
        normalized_name = name.strip()
        if not normalized_name or normalized_name in os.environ:
            continue

        normalized_value = value.strip()
        if (
            len(normalized_value) >= 2
            and normalized_value[0] == normalized_value[-1]
            and normalized_value[0] in {"'", '"'}
        ):
            normalized_value = normalized_value[1:-1]

        os.environ[normalized_name] = normalized_value


_load_local_env_file()

from kera_research.api.app import app


if __name__ == "__main__":
    uvicorn.run("app:app", host="localhost", port=8000, reload=True)
