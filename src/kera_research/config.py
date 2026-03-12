from __future__ import annotations

import hashlib
import os
from pathlib import Path

import bcrypt

BASE_DIR = Path(__file__).resolve().parents[2]


def _resolve_storage_dir() -> Path:
    configured = os.getenv("KERA_STORAGE_DIR", "").strip()
    if configured:
        candidate = Path(configured).expanduser()
        if not candidate.is_absolute():
            candidate = (BASE_DIR / candidate).resolve()
        else:
            candidate = candidate.resolve()
        return candidate
    return (BASE_DIR.parent / "KERA_DATA").resolve()


STORAGE_DIR = _resolve_storage_dir()
CONTROL_PLANE_DIR = STORAGE_DIR / "control_plane"
CONTROL_PLANE_CASE_DIR = CONTROL_PLANE_DIR / "validation_cases"
CONTROL_PLANE_ARTIFACT_DIR = Path(
    os.getenv("KERA_CONTROL_PLANE_ARTIFACT_DIR", "").strip() or (CONTROL_PLANE_DIR / "artifacts")
)
CASE_REFERENCE_SALT = (
    os.getenv("KERA_CASE_REFERENCE_SALT", "").strip()
    or os.getenv("KERA_API_SECRET", "").strip()
    or "kera-case-reference-v1"
)
# First 16 hex chars of SHA256(salt) — safe to transmit, never reveals the actual salt.
# All nodes in the same federation must produce the same fingerprint.
CASE_REFERENCE_SALT_FINGERPRINT = hashlib.sha256(CASE_REFERENCE_SALT.encode()).hexdigest()[:16]
SITE_ROOT_DIR = STORAGE_DIR / "sites"
MODEL_DIR = STORAGE_DIR / "models"
DOCS_DIR = BASE_DIR / "docs"
SCRIPTS_DIR = BASE_DIR / "scripts"
LOCAL_MEDSAM_ROOT = BASE_DIR / "MedSAM-main"
LOCAL_SWIN_LITEMEDSAM_ROOT = BASE_DIR / "Swin_LiteMedSAM"
LOCAL_SWIN_LITEMEDSAM_ROOT_ALT = BASE_DIR / "Swin_LiteMedSAM-main"

APP_NAME = "K-ERA Research Platform"

DEFAULT_GLOBAL_MODELS = [
    {
        "version_id": "model_global_densenet_v1",
        "version_name": "global-densenet-v1.0",
        "architecture": "densenet121",
        "model_path": MODEL_DIR / "global_densenet_v1.pth",
        "notes": "DenseNet121 global model using MedSAM cornea crops for inference and training.",
        "notes_ko": "MedSAM cornea crop 기반 추론/학습을 사용하는 DenseNet121 글로벌 모델입니다.",
        "notes_en": "DenseNet121 global model using MedSAM cornea crops for inference and training.",
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


def _resolve_segmentation_backend() -> str:
    configured = (
        os.getenv("KERA_SEGMENTATION_BACKEND", "").strip()
        or os.getenv("SEGMENTATION_BACKEND", "").strip()
    ).lower()
    if configured in {"medsam", "swin_litemedsam"}:
        return configured
    return "medsam"


def _resolve_segmentation_root(backend: str) -> str:
    configured = (
        os.getenv("KERA_SEGMENTATION_ROOT", "").strip()
        or os.getenv("SEGMENTATION_ROOT", "").strip()
    )
    if configured:
        return configured
    if backend == "swin_litemedsam":
        return _resolve_existing_path(LOCAL_SWIN_LITEMEDSAM_ROOT, LOCAL_SWIN_LITEMEDSAM_ROOT_ALT)
    return _resolve_existing_path(LOCAL_MEDSAM_ROOT)


def _resolve_segmentation_script(backend: str) -> str:
    configured = (
        os.getenv("KERA_SEGMENTATION_SCRIPT", "").strip()
        or os.getenv("SEGMENTATION_SCRIPT", "").strip()
        or os.getenv("MEDSAM_SCRIPT", "").strip()
    )
    if configured:
        return configured
    if backend == "swin_litemedsam":
        return _resolve_existing_path(SCRIPTS_DIR / "swin_litemedsam_auto_roi.py")
    return _resolve_existing_path(SCRIPTS_DIR / "medsam_auto_roi.py")


def _resolve_segmentation_checkpoint(backend: str) -> str:
    configured = (
        os.getenv("KERA_SEGMENTATION_CHECKPOINT", "").strip()
        or os.getenv("SEGMENTATION_CHECKPOINT", "").strip()
        or os.getenv("MEDSAM_CHECKPOINT", "").strip()
    )
    if configured:
        return configured
    if backend == "swin_litemedsam":
        return _resolve_existing_path(
            LOCAL_SWIN_LITEMEDSAM_ROOT / "workdir" / "Swin_LiteMedSAM.pth",
            LOCAL_SWIN_LITEMEDSAM_ROOT_ALT / "workdir" / "Swin_LiteMedSAM.pth",
            BASE_DIR / "workdir" / "Swin_LiteMedSAM.pth",
        )
    return _resolve_existing_path(
        LOCAL_MEDSAM_ROOT / "work_dir" / "MedSAM" / "medsam_vit_b.pth",
        BASE_DIR / "work_dir" / "MedSAM" / "medsam_vit_b.pth",
    )


SEGMENTATION_BACKEND = _resolve_segmentation_backend()
SEGMENTATION_ROOT = _resolve_segmentation_root(SEGMENTATION_BACKEND)
SEGMENTATION_SCRIPT = _resolve_segmentation_script(SEGMENTATION_BACKEND)
SEGMENTATION_CHECKPOINT = _resolve_segmentation_checkpoint(SEGMENTATION_BACKEND)

# Legacy aliases kept for compatibility with existing imports and env names.
MEDSAM_SCRIPT = SEGMENTATION_SCRIPT
MEDSAM_CHECKPOINT = SEGMENTATION_CHECKPOINT

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
        CONTROL_PLANE_ARTIFACT_DIR,
        SITE_ROOT_DIR,
        MODEL_DIR,
        DOCS_DIR,
    ):
        path.mkdir(parents=True, exist_ok=True)
