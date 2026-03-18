from __future__ import annotations

import ctypes
import json
import os
import platform
from ctypes import wintypes
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from kera_research.config import CONTROL_PLANE_DIR

_CREDENTIALS_MAGIC = b"KERA_NODE_CREDENTIALS_V1\0"
_DPAPI_ENTROPY = b"kera-control-plane-node-credentials"
_CREDENTIALS_PATH = CONTROL_PLANE_DIR / "node_credentials.bin"


class _DATA_BLOB(ctypes.Structure):
    _fields_ = [
        ("cbData", wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_byte)),
    ]


def _credential_store_path() -> Path:
    CONTROL_PLANE_DIR.mkdir(parents=True, exist_ok=True)
    return _CREDENTIALS_PATH


def _is_windows() -> bool:
    return platform.system().strip().lower() == "windows"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _blob_from_bytes(value: bytes) -> tuple[_DATA_BLOB, Any]:
    if not value:
        return _DATA_BLOB(0, None), None
    buffer = ctypes.create_string_buffer(value, len(value))
    blob = _DATA_BLOB(len(value), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_byte)))
    return blob, buffer


def _bytes_from_blob(blob: _DATA_BLOB) -> bytes:
    if not blob.cbData or not blob.pbData:
        return b""
    try:
        return ctypes.string_at(blob.pbData, blob.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(blob.pbData)


def _protect_bytes(payload: bytes) -> bytes:
    if not _is_windows():
        return payload
    input_blob, input_buffer = _blob_from_bytes(payload)
    entropy_blob, entropy_buffer = _blob_from_bytes(_DPAPI_ENTROPY)
    output_blob = _DATA_BLOB()
    del input_buffer
    del entropy_buffer
    success = ctypes.windll.crypt32.CryptProtectData(
        ctypes.byref(input_blob),
        None,
        ctypes.byref(entropy_blob),
        None,
        None,
        0,
        ctypes.byref(output_blob),
    )
    if not success:
        raise ctypes.WinError()
    return _bytes_from_blob(output_blob)


def _unprotect_bytes(payload: bytes) -> bytes:
    if not _is_windows():
        return payload
    input_blob, input_buffer = _blob_from_bytes(payload)
    entropy_blob, entropy_buffer = _blob_from_bytes(_DPAPI_ENTROPY)
    output_blob = _DATA_BLOB()
    del input_buffer
    del entropy_buffer
    success = ctypes.windll.crypt32.CryptUnprotectData(
        ctypes.byref(input_blob),
        None,
        ctypes.byref(entropy_blob),
        None,
        None,
        0,
        ctypes.byref(output_blob),
    )
    if not success:
        raise ctypes.WinError()
    return _bytes_from_blob(output_blob)


def _normalize_payload(payload: dict[str, Any]) -> dict[str, str]:
    base_url = str(payload.get("control_plane_base_url") or "").strip().rstrip("/")
    node_id = str(payload.get("node_id") or "").strip()
    node_token = str(payload.get("node_token") or "").strip()
    if not base_url:
        raise ValueError("control_plane_base_url is required.")
    if not node_id:
        raise ValueError("node_id is required.")
    if not node_token:
        raise ValueError("node_token is required.")
    normalized = {
        "control_plane_base_url": base_url,
        "node_id": node_id,
        "node_token": node_token,
        "site_id": str(payload.get("site_id") or "").strip(),
        "saved_at": str(payload.get("saved_at") or _utc_now()).strip() or _utc_now(),
    }
    return normalized


def save_node_credentials(
    *,
    control_plane_base_url: str,
    node_id: str,
    node_token: str,
    site_id: str | None = None,
) -> dict[str, str]:
    normalized = _normalize_payload(
        {
            "control_plane_base_url": control_plane_base_url,
            "node_id": node_id,
            "node_token": node_token,
            "site_id": site_id,
        }
    )
    payload_bytes = json.dumps(normalized, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
    protected_bytes = _protect_bytes(payload_bytes)
    credential_path = _credential_store_path()
    credential_path.write_bytes(_CREDENTIALS_MAGIC + protected_bytes)
    if not _is_windows():
        try:
            os.chmod(credential_path, 0o600)
        except OSError:
            pass
    return normalized


def load_node_credentials() -> dict[str, str] | None:
    credential_path = _credential_store_path()
    if not credential_path.exists():
        return None
    raw = credential_path.read_bytes()
    if not raw:
        return None
    payload_bytes = raw
    if raw.startswith(_CREDENTIALS_MAGIC):
        payload_bytes = raw[len(_CREDENTIALS_MAGIC):]
    try:
        unprotected = _unprotect_bytes(payload_bytes)
    except Exception:
        return None
    try:
        parsed = json.loads(unprotected.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(parsed, dict):
        return None
    try:
        return _normalize_payload(parsed)
    except ValueError:
        return None


def clear_node_credentials() -> None:
    credential_path = _credential_store_path()
    if credential_path.exists():
        credential_path.unlink()


def node_credentials_status() -> dict[str, Any]:
    credential_path = _credential_store_path()
    stored = load_node_credentials()
    return {
        "path": str(credential_path),
        "exists": credential_path.exists(),
        "is_windows_dpapi": _is_windows(),
        "configured": stored is not None,
        "control_plane_base_url": stored.get("control_plane_base_url") if stored else "",
        "node_id": stored.get("node_id") if stored else "",
        "site_id": stored.get("site_id") if stored else "",
        "saved_at": stored.get("saved_at") if stored else "",
    }
