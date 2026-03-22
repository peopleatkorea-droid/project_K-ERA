from __future__ import annotations

import os
import secrets
from pathlib import Path

from kera_research.config import CONTROL_PLANE_DIR, STORAGE_DIR
from kera_research.services.node_credentials import _is_windows, _protect_bytes, _unprotect_bytes

_LOCAL_API_SECRET_MAGIC = b"KERA_LOCAL_API_SECRET_V1\0"
_LOCAL_API_SECRET_PATH = CONTROL_PLANE_DIR / "local_api_secret.bin"
_PRIMARY_ENV_NAME = "KERA_LOCAL_API_JWT_SECRET"
_LEGACY_ENV_NAME = "KERA_API_SECRET"
_LEGACY_SECRET_PATH = STORAGE_DIR / "kera_secret.key"


def _secret_store_path() -> Path:
    CONTROL_PLANE_DIR.mkdir(parents=True, exist_ok=True)
    return _LOCAL_API_SECRET_PATH


def _normalize_secret(value: str | None) -> str:
    return str(value or "").strip()


def _read_legacy_secret_file() -> str:
    if not _LEGACY_SECRET_PATH.exists():
        return ""
    try:
        return _normalize_secret(_LEGACY_SECRET_PATH.read_text(encoding="utf-8"))
    except OSError:
        return ""


def save_local_api_secret(secret: str) -> str:
    normalized = _normalize_secret(secret)
    if not normalized:
        raise ValueError("local API secret is required.")
    protected_bytes = _protect_bytes(normalized.encode("utf-8"))
    target = _secret_store_path()
    target.write_bytes(_LOCAL_API_SECRET_MAGIC + protected_bytes)
    if not _is_windows():
        try:
            os.chmod(target, 0o600)
        except OSError:
            pass
    return normalized


def load_local_api_secret() -> str:
    env_secret = _normalize_secret(os.getenv(_PRIMARY_ENV_NAME))
    if env_secret:
        return env_secret

    target = _secret_store_path()
    if target.exists():
        try:
            raw = target.read_bytes()
        except OSError:
            raw = b""
        payload_bytes = raw[len(_LOCAL_API_SECRET_MAGIC):] if raw.startswith(_LOCAL_API_SECRET_MAGIC) else raw
        if payload_bytes:
            try:
                return _normalize_secret(_unprotect_bytes(payload_bytes).decode("utf-8"))
            except Exception:
                pass

    legacy_file_secret = _read_legacy_secret_file()
    if legacy_file_secret:
        try:
            save_local_api_secret(legacy_file_secret)
        except Exception:
            pass
        return legacy_file_secret

    legacy_env_secret = _normalize_secret(os.getenv(_LEGACY_ENV_NAME))
    if legacy_env_secret:
        return legacy_env_secret

    return ""


def load_or_create_local_api_secret() -> str:
    existing = load_local_api_secret()
    if existing:
        return existing
    generated = secrets.token_hex(32)
    return save_local_api_secret(generated)
