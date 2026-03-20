from __future__ import annotations

import hashlib
import os
from pathlib import Path
from urllib.parse import urlsplit

from kera_research.passwords import hash_password

BASE_DIR = Path(__file__).resolve().parents[2]
BUILT_IN_STORAGE_DIR = (BASE_DIR.parent / "KERA_DATA").resolve()
BUILT_IN_SITE_ROOT_DIR = BUILT_IN_STORAGE_DIR / "sites"


def _resolve_path_value(value: str | Path, *, base_dir: Path | None = None) -> Path:
    candidate = Path(value).expanduser()
    if not candidate.is_absolute():
        anchor = (base_dir or BASE_DIR).resolve()
        candidate = (anchor / candidate).resolve()
    else:
        candidate = candidate.resolve()
    return candidate


def _resolve_storage_state_file() -> Path:
    configured = os.getenv("KERA_STORAGE_STATE_FILE", "").strip()
    if configured:
        return _resolve_path_value(configured)
    local_appdata = os.getenv("LOCALAPPDATA", "").strip()
    if local_appdata:
        return (Path(local_appdata).expanduser().resolve() / "KERA" / "storage_dir.txt").resolve()
    return (Path.home() / ".kera" / "storage_dir.txt").resolve()


STORAGE_STATE_FILE = _resolve_storage_state_file()


def _normalize_storage_bundle_path(candidate: Path) -> Path:
    resolved = candidate.resolve()
    if resolved.name.strip().lower() != "sites":
        return resolved
    parent = resolved.parent.resolve()
    if parent.name.strip().lower() == "kera_data":
        return parent
    if any((parent / marker).exists() for marker in ("control_plane", "models", "kera.db")):
        return parent
    return resolved


def _looks_like_storage_bundle(candidate: Path) -> bool:
    resolved = _normalize_storage_bundle_path(candidate)
    if not resolved.exists() or not resolved.is_dir():
        return False
    return any((resolved / marker).exists() for marker in ("sites", "control_plane", "models", "kera.db", "control_plane_cache.db", "kera_secret.key"))


def _read_storage_dir_state() -> Path | None:
    if not STORAGE_STATE_FILE.exists():
        return None
    try:
        raw = STORAGE_STATE_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    if not raw:
        return None
    return _normalize_storage_bundle_path(_resolve_path_value(raw))


def _persist_storage_dir_state(storage_dir: Path) -> None:
    try:
        STORAGE_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        STORAGE_STATE_FILE.write_text(str(storage_dir.resolve()), encoding="utf-8")
    except OSError:
        pass


def _common_storage_dir_candidates() -> list[Path]:
    roots: list[Path] = []
    seen: set[str] = set()

    def add_root(candidate: Path | None) -> None:
        if candidate is None:
            return
        resolved = candidate.expanduser().resolve()
        key = str(resolved).lower()
        if key in seen:
            return
        seen.add(key)
        roots.append(resolved)

    add_root(Path.home())
    add_root(Path.home() / "OneDrive")
    for env_name in ("OneDrive", "OneDriveCommercial", "OneDriveConsumer"):
        raw = os.getenv(env_name, "").strip()
        if raw:
            add_root(Path(raw))

    candidates: list[Path] = []
    candidate_seen: set[str] = set()

    def add_candidate(candidate: Path) -> None:
        resolved = candidate.expanduser().resolve()
        key = str(resolved).lower()
        if key in candidate_seen:
            return
        candidate_seen.add(key)
        candidates.append(resolved)

    for root in roots:
        add_candidate(root / "KERA_DATA")
        add_candidate(root / "KERA" / "KERA_DATA")

    return candidates


def _resolve_path_env(env_name: str, default: Path) -> Path:
    configured = os.getenv(env_name, "").strip()
    if configured:
        return _resolve_path_value(configured)
    return default.resolve()


def _resolve_storage_dir() -> Path:
    configured = os.getenv("KERA_STORAGE_DIR", "").strip()
    configured_candidate = _normalize_storage_bundle_path(_resolve_path_value(configured)) if configured else None
    if configured_candidate is not None and _looks_like_storage_bundle(configured_candidate):
        os.environ["KERA_STORAGE_DIR"] = str(configured_candidate)
        _persist_storage_dir_state(configured_candidate)
        return configured_candidate

    if configured_candidate is not None:
        remembered = _read_storage_dir_state()
        if remembered is not None:
            normalized_remembered = _normalize_storage_bundle_path(remembered)
            if _looks_like_storage_bundle(normalized_remembered):
                os.environ["KERA_STORAGE_DIR"] = str(normalized_remembered)
                _persist_storage_dir_state(normalized_remembered)
                return normalized_remembered
        return configured_candidate.resolve()

    remembered = _read_storage_dir_state()
    if remembered is not None:
        normalized_remembered = _normalize_storage_bundle_path(remembered)
        if _looks_like_storage_bundle(normalized_remembered):
            os.environ["KERA_STORAGE_DIR"] = str(normalized_remembered)
            _persist_storage_dir_state(normalized_remembered)
            return normalized_remembered

    if _looks_like_storage_bundle(BUILT_IN_STORAGE_DIR):
        return BUILT_IN_STORAGE_DIR.resolve()

    for candidate in _common_storage_dir_candidates():
        normalized = _normalize_storage_bundle_path(candidate)
        if _looks_like_storage_bundle(normalized):
            os.environ["KERA_STORAGE_DIR"] = str(normalized)
            _persist_storage_dir_state(normalized)
            return normalized

    return BUILT_IN_STORAGE_DIR.resolve()


STORAGE_DIR = _resolve_storage_dir()
CONTROL_PLANE_DIR = _resolve_path_env("KERA_CONTROL_PLANE_DIR", STORAGE_DIR / "control_plane")
CONTROL_PLANE_CASE_DIR = CONTROL_PLANE_DIR / "validation_cases"
CONTROL_PLANE_REPORT_DIR = CONTROL_PLANE_DIR / "validation_reports"
CONTROL_PLANE_EXPERIMENT_DIR = CONTROL_PLANE_DIR / "experiments"
CONTROL_PLANE_ARTIFACT_DIR = _resolve_path_env(
    "KERA_CONTROL_PLANE_ARTIFACT_DIR",
    CONTROL_PLANE_DIR / "artifacts",
)
CASE_REFERENCE_SALT = (
    os.getenv("KERA_CASE_REFERENCE_SALT", "").strip()
    or os.getenv("KERA_API_SECRET", "").strip()
    or "kera-case-reference-v1"
)
PATIENT_REFERENCE_SALT = (
    os.getenv("KERA_PATIENT_REFERENCE_SALT", "").strip()
    or CASE_REFERENCE_SALT
)
PUBLIC_ALIAS_SALT = (
    os.getenv("KERA_PUBLIC_ALIAS_SALT", "").strip()
    or os.getenv("KERA_API_SECRET", "").strip()
    or CASE_REFERENCE_SALT
)
# First 16 hex chars of SHA256(salt) — safe to transmit, never reveals the actual salt.
# All nodes in the same federation must produce the same fingerprint.
CASE_REFERENCE_SALT_FINGERPRINT = hashlib.sha256(CASE_REFERENCE_SALT.encode()).hexdigest()[:16]
SITE_ROOT_DIR = STORAGE_DIR / "sites"
MODEL_DIR = _resolve_path_env("KERA_MODEL_DIR", STORAGE_DIR / "models")
DOCS_DIR = BASE_DIR / "docs"
SCRIPTS_DIR = BASE_DIR / "scripts"
LOCAL_MEDSAM_ROOT = BASE_DIR / "MedSAM-main"

APP_NAME = "K-ERA Research Platform"
MODEL_CACHE_DIR = MODEL_DIR / "cache"
MODEL_ACTIVE_MANIFEST_PATH = MODEL_DIR / "active.json"
MODEL_SOURCE_PROVIDER = os.getenv("KERA_MODEL_SOURCE_PROVIDER", "").strip() or "local"
MODEL_AUTO_DOWNLOAD = (os.getenv("KERA_MODEL_AUTO_DOWNLOAD", "").strip().lower() or "true") not in {
    "0",
    "false",
    "no",
    "off",
}
MODEL_KEEP_VERSIONS = max(1, int(os.getenv("KERA_MODEL_KEEP_VERSIONS", "").strip() or "2"))
MODEL_DOWNLOAD_TIMEOUT_SECONDS = float(os.getenv("KERA_MODEL_DOWNLOAD_TIMEOUT_SECONDS", "").strip() or "300")
MODEL_DISTRIBUTION_MODE = os.getenv("KERA_MODEL_DISTRIBUTION_MODE", "").strip().lower() or "local_path"
CONTROL_PLANE_API_BASE_URL = os.getenv("KERA_CONTROL_PLANE_API_BASE_URL", "").strip().rstrip("/")
CONTROL_PLANE_NODE_ID = os.getenv("KERA_CONTROL_PLANE_NODE_ID", "").strip()
CONTROL_PLANE_NODE_TOKEN = os.getenv("KERA_CONTROL_PLANE_NODE_TOKEN", "").strip()
CONTROL_PLANE_API_TIMEOUT_SECONDS = float(os.getenv("KERA_CONTROL_PLANE_API_TIMEOUT_SECONDS", "").strip() or "30")
CONTROL_PLANE_HEARTBEAT_INTERVAL_SECONDS = max(
    30,
    int(os.getenv("KERA_CONTROL_PLANE_HEARTBEAT_INTERVAL_SECONDS", "").strip() or "300"),
)
CONTROL_PLANE_BOOTSTRAP_REFRESH_SECONDS = max(
    60,
    int(os.getenv("KERA_CONTROL_PLANE_BOOTSTRAP_REFRESH_SECONDS", "").strip() or "900"),
)
ONEDRIVE_TENANT_ID = os.getenv("KERA_ONEDRIVE_TENANT_ID", "").strip()
ONEDRIVE_CLIENT_ID = os.getenv("KERA_ONEDRIVE_CLIENT_ID", "").strip()
ONEDRIVE_CLIENT_SECRET = os.getenv("KERA_ONEDRIVE_CLIENT_SECRET", "").strip()
ONEDRIVE_DRIVE_ID = os.getenv("KERA_ONEDRIVE_DRIVE_ID", "").strip()
ONEDRIVE_ROOT_PATH = os.getenv("KERA_ONEDRIVE_ROOT_PATH", "").strip().strip("\\/")
ONEDRIVE_SHARE_SCOPE = os.getenv("KERA_ONEDRIVE_SHARE_SCOPE", "").strip().lower() or "organization"
ONEDRIVE_SHARE_TYPE = os.getenv("KERA_ONEDRIVE_SHARE_TYPE", "").strip().lower() or "view"
ONEDRIVE_GRAPH_TIMEOUT_SECONDS = float(os.getenv("KERA_ONEDRIVE_GRAPH_TIMEOUT_SECONDS", "").strip() or "300")


def _path_parts_lower(path: Path) -> list[str]:
    return [str(part or "").strip().lower() for part in path.parts]


def remap_bundle_absolute_path(value: str | Path) -> Path | None:
    candidate = Path(value).expanduser()
    if not candidate.is_absolute():
        return None

    parts = candidate.parts
    normalized_parts = _path_parts_lower(candidate)
    anchor_roots: tuple[tuple[str, Path], ...] = (
        ("sites", SITE_ROOT_DIR),
        ("control_plane", CONTROL_PLANE_DIR),
        ("models", MODEL_DIR),
        ("kera_data", STORAGE_DIR),
    )
    for anchor_name, anchor_root in anchor_roots:
        try:
            anchor_index = normalized_parts.index(anchor_name)
        except ValueError:
            continue
        suffix = parts[anchor_index + 1 :]
        remapped = anchor_root if not suffix else anchor_root / Path(*suffix)
        return remapped.resolve()
    return None


def resolve_portable_path(
    value: str | Path,
    *,
    base_dir: str | Path | None = None,
    require_exists: bool = False,
) -> tuple[Path, bool]:
    candidate = Path(value).expanduser()
    if not candidate.is_absolute():
        base_path = Path(base_dir).expanduser().resolve() if base_dir is not None else BASE_DIR.resolve()
        return (base_path / candidate).resolve(), False

    resolved_candidate = candidate.resolve()
    if resolved_candidate.exists():
        return resolved_candidate, False

    remapped = remap_bundle_absolute_path(resolved_candidate)
    if remapped is not None and (not require_exists or remapped.exists()):
        resolved_remapped = remapped.resolve()
        return resolved_remapped, str(resolved_remapped) != str(resolved_candidate)
    return resolved_candidate, False


def remap_bundle_paths_in_value(value: object) -> object:
    if isinstance(value, dict):
        return {key: remap_bundle_paths_in_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [remap_bundle_paths_in_value(item) for item in value]
    if isinstance(value, str):
        normalized = value.strip()
        if not normalized:
            return value
        parsed = urlsplit(normalized)
        if parsed.scheme in {"http", "https"}:
            return value
        candidate = Path(normalized).expanduser()
        if not candidate.is_absolute():
            return value
        resolved, remapped = resolve_portable_path(candidate, require_exists=False)
        if remapped:
            return str(resolved)
    return value

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
    {
        "version_id": "model_global_dinov2_baseline",
        "version_name": "global-dinov2-baseline-v0.1",
        "architecture": "dinov2",
        "model_path": MODEL_DIR / "global_dinov2_baseline.pt",
        "notes": "DINOv2 baseline initialized from official pretrained weights with MedSAM cornea crops.",
        "notes_ko": "공식 pretrained weights로 초기화한 DINOv2 baseline이며 MedSAM 각막 crop 입력을 사용합니다.",
        "notes_en": "DINOv2 baseline initialized from official pretrained weights with MedSAM cornea crops.",
        "requires_medsam_crop": True,
        "crop_mode": "automated",
        "case_aggregation": "mean",
        "bag_level": False,
        "training_input_policy": "medsam_cornea_crop_only",
        "is_current": False,
    },
    {
        "version_id": "model_global_dinov2_mil_baseline",
        "version_name": "global-dinov2-mil-baseline-v0.1",
        "architecture": "dinov2_mil",
        "model_path": MODEL_DIR / "global_dinov2_mil_baseline.pt",
        "notes": "DINOv2 Attention MIL baseline initialized from official pretrained weights for visit-level aggregation.",
        "notes_ko": "공식 pretrained weights로 초기화한 DINOv2 Attention MIL baseline이며 visit-level attention aggregation을 사용합니다.",
        "notes_en": "DINOv2 Attention MIL baseline initialized from official pretrained weights for visit-level aggregation.",
        "requires_medsam_crop": True,
        "crop_mode": "automated",
        "case_aggregation": "attention_mil",
        "bag_level": True,
        "training_input_policy": "medsam_cornea_crop_only",
        "is_current": False,
    },
    {
        "version_id": "model_global_dual_input_concat_baseline",
        "version_name": "global-dual-input-concat-baseline-v0.1",
        "architecture": "dual_input_concat",
        "model_path": MODEL_DIR / "global_dual_input_concat_baseline.pt",
        "notes": "Dual-input concat fusion baseline initialized from official DINOv2 pretrained weights with paired cornea and lesion crops.",
        "notes_ko": "공식 DINOv2 pretrained weights로 초기화한 dual-input concat fusion baseline이며 paired 각막+병변 crop 입력을 사용합니다.",
        "notes_en": "Dual-input concat fusion baseline initialized from official DINOv2 pretrained weights with paired cornea and lesion crops.",
        "requires_medsam_crop": True,
        "crop_mode": "paired",
        "case_aggregation": "mean",
        "bag_level": False,
        "training_input_policy": "medsam_cornea_plus_lesion_paired_fusion",
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
    hashed = hash_password(password)
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
        MODEL_CACHE_DIR,
        DOCS_DIR,
    ):
        path.mkdir(parents=True, exist_ok=True)
