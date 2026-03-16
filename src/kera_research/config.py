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
CONTROL_PLANE_REPORT_DIR = CONTROL_PLANE_DIR / "validation_reports"
CONTROL_PLANE_EXPERIMENT_DIR = CONTROL_PLANE_DIR / "experiments"
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

APP_NAME = "K-ERA Research Platform"

DEFAULT_GLOBAL_MODELS = [
    {
        "version_id": "model_global_densenet_v1",
        "version_name": "global-densenet121-baseline-v1.0",
        "architecture": "densenet121",
        "model_path": MODEL_DIR / "global_densenet121_baseline_v1.pt",
        "notes": "DenseNet121 baseline initialized from official ImageNet pretrained weights.",
        "notes_ko": "공식 ImageNet 사전학습 가중치로 초기화된 DenseNet121 baseline입니다.",
        "notes_en": "DenseNet121 baseline initialized from official ImageNet pretrained weights.",
        "requires_medsam_crop": True,
        "is_current": True,
    },
    {
        "version_id": "model_global_vit_baseline",
        "version_name": "global-vit-baseline-v0.1",
        "architecture": "vit",
        "model_path": MODEL_DIR / "global_vit_baseline.pt",
        "notes": "ViT-B/16 baseline initialized from official ImageNet pretrained weights.",
        "notes_ko": "공식 ImageNet 사전학습 가중치로 초기화된 ViT-B/16 baseline입니다.",
        "notes_en": "ViT-B/16 baseline initialized from official ImageNet pretrained weights.",
        "requires_medsam_crop": False,
        "is_current": False,
    },
    {
        "version_id": "model_global_swin_baseline",
        "version_name": "global-swin-baseline-v0.1",
        "architecture": "swin",
        "model_path": MODEL_DIR / "global_swin_baseline.pt",
        "notes": "Swin-T baseline initialized from official ImageNet pretrained weights.",
        "notes_ko": "공식 ImageNet 사전학습 가중치로 초기화된 Swin-T baseline입니다.",
        "notes_en": "Swin-T baseline initialized from official ImageNet pretrained weights.",
        "requires_medsam_crop": False,
        "is_current": False,
    },
    {
        "version_id": "model_global_convnext_tiny_baseline",
        "version_name": "global-convnext-tiny-baseline-v0.1",
        "architecture": "convnext_tiny",
        "model_path": MODEL_DIR / "global_convnext_tiny_baseline.pt",
        "notes": "ConvNeXt-Tiny baseline initialized from official ImageNet pretrained weights.",
        "notes_ko": "공식 ImageNet 사전학습 가중치로 초기화된 ConvNeXt-Tiny baseline입니다.",
        "notes_en": "ConvNeXt-Tiny baseline initialized from official ImageNet pretrained weights.",
        "requires_medsam_crop": False,
        "is_current": False,
    },
    {
        "version_id": "model_global_efficientnet_v2_s_baseline",
        "version_name": "global-efficientnet-v2-s-baseline-v0.1",
        "architecture": "efficientnet_v2_s",
        "model_path": MODEL_DIR / "global_efficientnet_v2_s_baseline.pt",
        "notes": "EfficientNetV2-S baseline initialized from official ImageNet pretrained weights.",
        "notes_ko": "공식 ImageNet 사전학습 가중치로 초기화된 EfficientNetV2-S baseline입니다.",
        "notes_en": "EfficientNetV2-S baseline initialized from official ImageNet pretrained weights.",
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
    if configured == "medsam":
        return configured
    return "medsam"


def _resolve_segmentation_root(backend: str) -> str:
    configured = (
        os.getenv("KERA_SEGMENTATION_ROOT", "").strip()
        or os.getenv("SEGMENTATION_ROOT", "").strip()
    )
    if configured:
        return configured
    return _resolve_existing_path(LOCAL_MEDSAM_ROOT)


def _resolve_segmentation_script(backend: str) -> str:
    configured = (
        os.getenv("KERA_SEGMENTATION_SCRIPT", "").strip()
        or os.getenv("SEGMENTATION_SCRIPT", "").strip()
        or os.getenv("MEDSAM_SCRIPT", "").strip()
    )
    if configured:
        return configured
    return _resolve_existing_path(SCRIPTS_DIR / "medsam_auto_roi.py")


def _resolve_segmentation_checkpoint(backend: str) -> str:
    configured = (
        os.getenv("KERA_SEGMENTATION_CHECKPOINT", "").strip()
        or os.getenv("SEGMENTATION_CHECKPOINT", "").strip()
        or os.getenv("MEDSAM_CHECKPOINT", "").strip()
    )
    if configured:
        return configured
    return _resolve_existing_path(
        LOCAL_MEDSAM_ROOT / "work_dir" / "MedSAM" / "medsam_vit_b.pth",
        BASE_DIR / "work_dir" / "MedSAM" / "medsam_vit_b.pth",
    )


SEGMENTATION_BACKEND = _resolve_segmentation_backend()
SEGMENTATION_ROOT = _resolve_segmentation_root(SEGMENTATION_BACKEND)
SEGMENTATION_SCRIPT = _resolve_segmentation_script(SEGMENTATION_BACKEND)
SEGMENTATION_CHECKPOINT = _resolve_segmentation_checkpoint(SEGMENTATION_BACKEND)

HIRA_API_KEY = (
    os.getenv("KERA_HIRA_API_KEY", "").strip()
    or os.getenv("HIRA_API_KEY", "").strip()
)
HIRA_HOSPITAL_INFO_URL = (
    os.getenv("KERA_HIRA_HOSPITAL_INFO_URL", "").strip()
    or "https://apis.data.go.kr/B551182/hospInfoServicev2/getHospBasisList"
)
HIRA_API_TIMEOUT_SECONDS = float(
    os.getenv("KERA_HIRA_API_TIMEOUT_SECONDS", "").strip()
    or "30"
)

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
        CONTROL_PLANE_REPORT_DIR,
        CONTROL_PLANE_EXPERIMENT_DIR,
        CONTROL_PLANE_ARTIFACT_DIR,
        SITE_ROOT_DIR,
        MODEL_DIR,
        DOCS_DIR,
    ):
        path.mkdir(parents=True, exist_ok=True)
