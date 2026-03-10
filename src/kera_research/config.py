from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]
STORAGE_DIR = BASE_DIR / "storage"
CONTROL_PLANE_DIR = STORAGE_DIR / "control_plane"
CONTROL_PLANE_CASE_DIR = CONTROL_PLANE_DIR / "validation_cases"
SITE_ROOT_DIR = STORAGE_DIR / "sites"
MODEL_DIR = BASE_DIR / "models"
DOCS_DIR = BASE_DIR / "docs"

APP_NAME = "K-ERA Research Platform"

DEFAULT_GLOBAL_MODELS = [
    {
        "version_id": "model_global_cnn_baseline",
        "version_name": "global-cnn-baseline-v0.1",
        "architecture": "cnn",
        "model_path": MODEL_DIR / "global_cnn_baseline.pt",
        "notes": "Lightweight CNN baseline for workflow validation.",
        "notes_ko": "워크플로우 검증용 경량 CNN baseline입니다.",
        "notes_en": "Lightweight CNN baseline for workflow validation.",
    },
    {
        "version_id": "model_global_vit_baseline",
        "version_name": "global-vit-baseline-v0.1",
        "architecture": "vit",
        "model_path": MODEL_DIR / "global_vit_baseline.pt",
        "notes": "Lightweight ViT baseline for workflow validation.",
        "notes_ko": "워크플로우 검증용 경량 ViT baseline입니다.",
        "notes_en": "Lightweight ViT baseline for workflow validation.",
    },
    {
        "version_id": "model_global_swin_baseline",
        "version_name": "global-swin-baseline-v0.1",
        "architecture": "swin",
        "model_path": MODEL_DIR / "global_swin_baseline.pt",
        "notes": "Lightweight Swin-like baseline for workflow validation.",
        "notes_ko": "워크플로우 검증용 경량 Swin-like baseline입니다.",
        "notes_en": "Lightweight Swin-like baseline for workflow validation.",
    },
]

MEDSAM_SCRIPT = os.getenv("MEDSAM_SCRIPT", "").strip()
MEDSAM_CHECKPOINT = os.getenv("MEDSAM_CHECKPOINT", "").strip()

DEFAULT_USERS = [
    {
        "user_id": "user_admin",
        "username": os.getenv("KERA_ADMIN_USERNAME", "admin"),
        "password": os.getenv("KERA_ADMIN_PASSWORD", "admin123"),
        "role": "admin",
        "full_name": "Platform Administrator",
    },
    {
        "user_id": "user_researcher",
        "username": os.getenv("KERA_RESEARCHER_USERNAME", "researcher"),
        "password": os.getenv("KERA_RESEARCHER_PASSWORD", "research123"),
        "role": "researcher",
        "full_name": "Research User",
    },
]


def ensure_base_directories() -> None:
    for path in (
        STORAGE_DIR,
        CONTROL_PLANE_DIR,
        CONTROL_PLANE_CASE_DIR,
        SITE_ROOT_DIR,
        MODEL_DIR,
        DOCS_DIR,
    ):
        path.mkdir(parents=True, exist_ok=True)
