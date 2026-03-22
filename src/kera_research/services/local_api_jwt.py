from __future__ import annotations

import base64
import os
from pathlib import Path

DEFAULT_LOCAL_API_JWT_AUDIENCE = "kera-platform"
DEFAULT_LOCAL_API_JWT_ISSUER = "kera-control-plane"


def _normalize_text(value: str | None) -> str:
    return str(value or "").strip()


def _read_file_text(path_value: str | None) -> str:
    normalized_path = _normalize_text(path_value)
    if not normalized_path:
        return ""
    try:
        return Path(normalized_path).expanduser().read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def _read_pem(
    *,
    b64_env_names: list[str],
    pem_env_names: list[str] | None = None,
    path_env_names: list[str] | None = None,
) -> str:
    for env_name in b64_env_names:
        encoded = _normalize_text(os.getenv(env_name))
        if not encoded:
            continue
        try:
            decoded = base64.b64decode(encoded).decode("utf-8").strip()
        except Exception:
            continue
        if decoded:
            return decoded
    for env_name in pem_env_names or []:
        pem_value = _normalize_text(os.getenv(env_name))
        if pem_value:
            return pem_value.replace("\\n", "\n")
    for env_name in path_env_names or []:
        file_value = _read_file_text(os.getenv(env_name))
        if file_value:
            return file_value
    return ""


def load_control_plane_jwt_public_key() -> str:
    return _read_pem(
        b64_env_names=["KERA_LOCAL_API_JWT_PUBLIC_KEY_B64"],
        pem_env_names=["KERA_LOCAL_API_JWT_PUBLIC_KEY_PEM"],
        path_env_names=["KERA_LOCAL_API_JWT_PUBLIC_KEY_PATH"],
    )


def load_control_plane_jwt_private_key() -> str:
    return _read_pem(
        b64_env_names=["KERA_LOCAL_API_JWT_PRIVATE_KEY_B64"],
        pem_env_names=["KERA_LOCAL_API_JWT_PRIVATE_KEY_PEM"],
        path_env_names=["KERA_LOCAL_API_JWT_PRIVATE_KEY_PATH"],
    )


def load_control_plane_jwt_issuer() -> str:
    return _normalize_text(os.getenv("KERA_LOCAL_API_JWT_ISSUER")) or DEFAULT_LOCAL_API_JWT_ISSUER


def load_control_plane_jwt_audience() -> str:
    return _normalize_text(os.getenv("KERA_LOCAL_API_JWT_AUDIENCE")) or DEFAULT_LOCAL_API_JWT_AUDIENCE


def load_control_plane_jwt_key_id() -> str:
    return _normalize_text(os.getenv("KERA_LOCAL_API_JWT_KEY_ID"))
