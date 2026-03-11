from __future__ import annotations

import os
import sys
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any

from kera_research.config import MEDSAM_CHECKPOINT, MEDSAM_SCRIPT
from kera_research.services.hardware import detect_hardware

REQUIRED_PACKAGES = {
    "fastapi": "API",
    "uvicorn": "ASGI server",
    "pandas": "Metadata",
    "plotly": "Charts",
    "matplotlib": "Visualization",
    "numpy": "Array operations",
    "Pillow": "Image IO",
    "scikit-learn": "Metrics",
    "torch": "AI engine",
}


def package_version(name: str) -> str | None:
    try:
        return version(name)
    except PackageNotFoundError:
        return None


def detect_local_node_status() -> dict[str, Any]:
    project_root = Path(__file__).resolve().parents[3]
    setup_script = project_root / "scripts" / "setup_local_node.ps1"
    run_script = project_root / "scripts" / "run_local_node.ps1"
    package_versions = {name: package_version(name) for name in REQUIRED_PACKAGES}
    missing_packages = [name for name, item in package_versions.items() if item is None]
    hardware = detect_hardware()
    medsam_script = MEDSAM_SCRIPT or ""
    medsam_checkpoint = MEDSAM_CHECKPOINT or ""
    medsam_ready = bool(
        medsam_script
        and medsam_checkpoint
        and Path(medsam_script).exists()
        and Path(medsam_checkpoint).exists()
    )
    ai_engine_ready = hardware["torch_available"]

    return {
        "project_root": str(project_root),
        "python_executable": sys.executable,
        "venv_present": (project_root / ".venv").exists(),
        "package_versions": package_versions,
        "missing_packages": missing_packages,
        "local_node_ready": not missing_packages,
        "ai_engine_ready": ai_engine_ready,
        "data_entry_ready": True,
        "gpu_ready": hardware["gpu_available"],
        "gpu_name": hardware["gpu_name"],
        "cpu_name": hardware["cpu_name"],
        "cuda_version": hardware["cuda_version"],
        "medsam_ready": medsam_ready,
        "medsam_script": medsam_script,
        "medsam_checkpoint": medsam_checkpoint,
        "setup_script": str(setup_script),
        "run_script": str(run_script),
    }
