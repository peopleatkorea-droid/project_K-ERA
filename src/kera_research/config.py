from __future__ import annotations

import os
from pathlib import Path

import bcrypt

BASE_DIR = Path(__file__).resolve().parents[2]
STORAGE_DIR = BASE_DIR / "storage"
CONTROL_PLANE_DIR = STORAGE_DIR / "control_plane"
CONTROL_PLANE_CASE_DIR = CONTROL_PLANE_DIR / "validation_cases"
SITE_ROOT_DIR = STORAGE_DIR / "sites"
MODEL_DIR = BASE_DIR / "models"
DOCS_DIR = BASE_DIR / "docs"
SCRIPTS_DIR = BASE_DIR / "scripts"
LOCAL_MEDSAM_ROOT = BASE_DIR / "MedSAM-main"

APP_NAME = "K-ERA Research Platform"

DEFAULT_GLOBAL_MODELS = [
    {
        "version_id": "model_global_densenet_v1",
        "version_name": "global-densenet-v1.0",
        "architecture": "densenet121",
        "model_path": MODEL_DIR / "global_densenet_v1.pth",
        "notes": "DenseNet121 global model using MedSAM ROI crops for inference and training.",
        "notes_ko": "MedSAM ROI crop 기반 추론/학습을 사용하는 DenseNet121 글로벌 모델입니다.",
        "notes_en": "DenseNet121 global model using MedSAM ROI crops for inference and training.",
        "requires_medsam_crop": True,
        "is_current": True,
    },
    {
        "version_id": "model_global_cnn_baseline",
        "version_name": "global-cnn-baseline-v0.1",
        "architecture": "cnn",
        "model_path": MODEL_DIR / "global_cnn_baseline.pt",
        "notes": "Lightweight CNN baseline for workflow validation.",
        "notes_ko": "워크플로우 검증용 경량 CNN baseline입니다.",
        "notes_en": "Lightweight CNN baseline for workflow validation.",
        "requires_medsam_crop": False,
        "is_current": False,
    },
    {
        "version_id": "model_global_vit_baseline",
        "version_name": "global-vit-baseline-v0.1",
        "architecture": "vit",
        "model_path": MODEL_DIR / "global_vit_baseline.pt",
        "notes": "Lightweight ViT baseline for workflow validation.",
        "notes_ko": "워크플로우 검증용 경량 ViT baseline입니다.",
        "notes_en": "Lightweight ViT baseline for workflow validation.",
        "requires_medsam_crop": False,
        "is_current": False,
    },
    {
        "version_id": "model_global_swin_baseline",
        "version_name": "global-swin-baseline-v0.1",
        "architecture": "swin",
        "model_path": MODEL_DIR / "global_swin_baseline.pt",
        "notes": "Lightweight Swin-like baseline for workflow validation.",
        "notes_ko": "워크플로우 검증용 경량 Swin-like baseline입니다.",
        "notes_en": "Lightweight Swin-like baseline for workflow validation.",
        "requires_medsam_crop": False,
        "is_current": False,
    },
]


def _resolve_existing_path(*candidates: Path) -> str:
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return ""


def _resolve_medsam_script() -> str:
    configured = os.getenv("MEDSAM_SCRIPT", "").strip()
    if configured:
        return configured
    return _resolve_existing_path(SCRIPTS_DIR / "medsam_auto_roi.py")


def _resolve_medsam_checkpoint() -> str:
    configured = os.getenv("MEDSAM_CHECKPOINT", "").strip()
    if configured:
        return configured
    return _resolve_existing_path(
        LOCAL_MEDSAM_ROOT / "work_dir" / "MedSAM" / "medsam_vit_b.pth",
        BASE_DIR / "work_dir" / "MedSAM" / "medsam_vit_b.pth",
    )


MEDSAM_SCRIPT = _resolve_medsam_script()
MEDSAM_CHECKPOINT = _resolve_medsam_checkpoint()

def _env_seed_user(
    *,
    user_id: str,
    username_env: str,
    password_env: str,
    role: str,
    full_name: str,
) -> dict[str, object] | None:
    username = os.getenv(username_env, "").strip().lower()
    password = os.getenv(password_env, "").strip()
    if not username or not password:
        return None
    hashed = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    return {
        "user_id": user_id,
        "username": username,
        "password": hashed,
        "role": role,
        "full_name": full_name,
        "site_ids": [],
    }


DEFAULT_USERS = [
    user
    for user in (
        _env_seed_user(
            user_id="user_admin",
            username_env="KERA_ADMIN_USERNAME",
            password_env="KERA_ADMIN_PASSWORD",
            role="admin",
            full_name="Platform Administrator",
        ),
        _env_seed_user(
            user_id="user_researcher",
            username_env="KERA_RESEARCHER_USERNAME",
            password_env="KERA_RESEARCHER_PASSWORD",
            role="researcher",
            full_name="Research User",
        ),
    )
    if user is not None
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
