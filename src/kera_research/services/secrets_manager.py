from __future__ import annotations

import base64
import ctypes
import json
import os
import platform
import secrets
from ctypes import wintypes
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from kera_research.config import CONTROL_PLANE_DIR, STORAGE_DIR

DEFAULT_LOCAL_API_JWT_AUDIENCE = "kera-platform"
DEFAULT_LOCAL_API_JWT_ISSUER = "kera-control-plane"

_DPAPI_ENTROPY = b"kera-control-plane-node-credentials"
_LOCAL_API_SECRET_MAGIC = b"KERA_LOCAL_API_SECRET_V1\0"
_NODE_CREDENTIALS_MAGIC = b"KERA_NODE_CREDENTIALS_V1\0"


class _DATA_BLOB(ctypes.Structure):
    _fields_ = [
        ("cbData", wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_byte)),
    ]


def _normalize_text(value: str | None) -> str:
    return str(value or "").strip()


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


class SecretsManager:
    def __init__(
        self,
        *,
        control_plane_dir: Path | None = None,
        storage_dir: Path | None = None,
    ) -> None:
        self.control_plane_dir = control_plane_dir or CONTROL_PLANE_DIR
        self.storage_dir = storage_dir or STORAGE_DIR

    @staticmethod
    def is_windows() -> bool:
        return platform.system().strip().lower() == "windows"

    @staticmethod
    def utc_now() -> str:
        return datetime.now(timezone.utc).isoformat()

    def protect_bytes(self, payload: bytes) -> bytes:
        if not self.is_windows():
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

    def unprotect_bytes(self, payload: bytes) -> bytes:
        if not self.is_windows():
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

    def ensure_private_file_permissions(self, path: Path) -> None:
        if self.is_windows():
            return
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass

    def _control_plane_path(self, file_name: str) -> Path:
        self.control_plane_dir.mkdir(parents=True, exist_ok=True)
        return self.control_plane_dir / file_name

    def _read_file_text(self, path_value: str | None) -> str:
        normalized_path = _normalize_text(path_value)
        if not normalized_path:
            return ""
        try:
            return Path(normalized_path).expanduser().read_text(encoding="utf-8").strip()
        except OSError:
            return ""

    def read_env_text(self, *env_names: str) -> str:
        for env_name in env_names:
            value = _normalize_text(os.getenv(env_name))
            if value:
                return value
        return ""

    def read_env_b64_text(self, *env_names: str) -> str:
        for env_name in env_names:
            encoded = _normalize_text(os.getenv(env_name))
            if not encoded:
                continue
            try:
                decoded = base64.b64decode(encoded).decode("utf-8").strip()
            except Exception:
                continue
            if decoded:
                return decoded
        return ""

    def read_env_path_text(self, *env_names: str) -> str:
        for env_name in env_names:
            file_value = self._read_file_text(os.getenv(env_name))
            if file_value:
                return file_value
        return ""

    def read_pem(
        self,
        *,
        b64_env_names: list[str],
        pem_env_names: list[str] | None = None,
        path_env_names: list[str] | None = None,
    ) -> str:
        public_pem = self.read_env_b64_text(*b64_env_names)
        if public_pem:
            return public_pem
        for env_name in pem_env_names or []:
            pem_value = self.read_env_text(env_name)
            if pem_value:
                return pem_value.replace("\\n", "\n")
        return self.read_env_path_text(*(path_env_names or []))

    def _load_text_secret_file(self, path: Path, *, magic: bytes) -> str:
        if not path.exists():
            return ""
        try:
            raw = path.read_bytes()
        except OSError:
            return ""
        payload_bytes = raw[len(magic) :] if raw.startswith(magic) else raw
        if not payload_bytes:
            return ""
        try:
            return _normalize_text(self.unprotect_bytes(payload_bytes).decode("utf-8"))
        except Exception:
            return ""

    def _save_text_secret_file(self, path: Path, *, magic: bytes, value: str) -> str:
        normalized = _normalize_text(value)
        if not normalized:
            raise ValueError("secret value is required.")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(magic + self.protect_bytes(normalized.encode("utf-8")))
        self.ensure_private_file_permissions(path)
        return normalized

    def _load_json_secret_file(self, path: Path, *, magic: bytes) -> dict[str, Any] | None:
        if not path.exists():
            return None
        try:
            raw = path.read_bytes()
        except OSError:
            return None
        payload_bytes = raw[len(magic) :] if raw.startswith(magic) else raw
        if not payload_bytes:
            return None
        try:
            unprotected = self.unprotect_bytes(payload_bytes)
            parsed = json.loads(unprotected.decode("utf-8"))
        except Exception:
            return None
        return parsed if isinstance(parsed, dict) else None

    def _save_json_secret_file(self, path: Path, *, magic: bytes, payload: dict[str, Any]) -> dict[str, Any]:
        path.parent.mkdir(parents=True, exist_ok=True)
        payload_bytes = json.dumps(payload, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
        path.write_bytes(magic + self.protect_bytes(payload_bytes))
        self.ensure_private_file_permissions(path)
        return payload

    def local_api_secret_path(self) -> Path:
        return self._control_plane_path("local_api_secret.bin")

    def load_local_api_secret(self) -> str:
        env_secret = self.read_env_text("KERA_LOCAL_API_JWT_SECRET")
        if env_secret:
            return env_secret

        stored_secret = self._load_text_secret_file(self.local_api_secret_path(), magic=_LOCAL_API_SECRET_MAGIC)
        if stored_secret:
            return stored_secret

        legacy_file = self.storage_dir / "kera_secret.key"
        legacy_file_secret = self._read_file_text(str(legacy_file))
        if legacy_file_secret:
            try:
                self.save_local_api_secret(legacy_file_secret)
            except Exception:
                pass
            return legacy_file_secret

        return self.read_env_text("KERA_API_SECRET")

    def save_local_api_secret(self, secret: str) -> str:
        return self._save_text_secret_file(
            self.local_api_secret_path(),
            magic=_LOCAL_API_SECRET_MAGIC,
            value=secret,
        )

    def load_or_create_local_api_secret(self) -> str:
        existing = self.load_local_api_secret()
        if existing:
            return existing
        return self.save_local_api_secret(secrets.token_hex(32))

    def load_control_plane_jwt_private_key(self) -> str:
        return self.read_pem(
            b64_env_names=["KERA_LOCAL_API_JWT_PRIVATE_KEY_B64"],
            pem_env_names=["KERA_LOCAL_API_JWT_PRIVATE_KEY_PEM"],
            path_env_names=["KERA_LOCAL_API_JWT_PRIVATE_KEY_PATH"],
        )

    def derive_public_pem_from_private(self, private_pem: str) -> str:
        normalized = _normalize_text(private_pem)
        if not normalized:
            return ""
        try:
            from cryptography.hazmat.primitives import serialization
            from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

            private_key = serialization.load_pem_private_key(normalized.encode("utf-8"), password=None)
            public_key = private_key.public_key()
            return public_key.public_bytes(
                encoding=Encoding.PEM,
                format=PublicFormat.SubjectPublicKeyInfo,
            ).decode("utf-8").strip()
        except Exception:
            return ""

    def load_control_plane_jwt_public_key(self) -> str:
        public_pem = self.read_pem(
            b64_env_names=["KERA_LOCAL_API_JWT_PUBLIC_KEY_B64"],
            pem_env_names=["KERA_LOCAL_API_JWT_PUBLIC_KEY_PEM"],
            path_env_names=["KERA_LOCAL_API_JWT_PUBLIC_KEY_PATH"],
        )
        if public_pem:
            return public_pem
        return self.derive_public_pem_from_private(self.load_control_plane_jwt_private_key())

    def load_control_plane_jwt_issuer(self) -> str:
        return self.read_env_text("KERA_LOCAL_API_JWT_ISSUER") or DEFAULT_LOCAL_API_JWT_ISSUER

    def load_control_plane_jwt_audience(self) -> str:
        return self.read_env_text("KERA_LOCAL_API_JWT_AUDIENCE") or DEFAULT_LOCAL_API_JWT_AUDIENCE

    def load_control_plane_jwt_key_id(self) -> str:
        return self.read_env_text("KERA_LOCAL_API_JWT_KEY_ID")

    def node_credentials_path(self) -> Path:
        return self._control_plane_path("node_credentials.bin")

    def _normalize_node_credentials_payload(self, payload: dict[str, Any]) -> dict[str, str]:
        base_url = str(payload.get("control_plane_base_url") or "").strip().rstrip("/")
        node_id = str(payload.get("node_id") or "").strip()
        node_token = str(payload.get("node_token") or "").strip()
        if not base_url:
            raise ValueError("control_plane_base_url is required.")
        if not node_id:
            raise ValueError("node_id is required.")
        if not node_token:
            raise ValueError("node_token is required.")
        return {
            "control_plane_base_url": base_url,
            "node_id": node_id,
            "node_token": node_token,
            "site_id": str(payload.get("site_id") or "").strip(),
            "saved_at": str(payload.get("saved_at") or self.utc_now()).strip() or self.utc_now(),
        }

    def save_node_credentials(
        self,
        *,
        control_plane_base_url: str,
        node_id: str,
        node_token: str,
        site_id: str | None = None,
    ) -> dict[str, str]:
        normalized = self._normalize_node_credentials_payload(
            {
                "control_plane_base_url": control_plane_base_url,
                "node_id": node_id,
                "node_token": node_token,
                "site_id": site_id,
            }
        )
        return self._save_json_secret_file(
            self.node_credentials_path(),
            magic=_NODE_CREDENTIALS_MAGIC,
            payload=normalized,
        )

    def load_node_credentials(self) -> dict[str, str] | None:
        parsed = self._load_json_secret_file(self.node_credentials_path(), magic=_NODE_CREDENTIALS_MAGIC)
        if not isinstance(parsed, dict):
            return None
        try:
            return self._normalize_node_credentials_payload(parsed)
        except ValueError:
            return None

    def clear_node_credentials(self) -> None:
        credential_path = self.node_credentials_path()
        if credential_path.exists():
            credential_path.unlink()

    def node_credentials_status(self) -> dict[str, Any]:
        credential_path = self.node_credentials_path()
        stored = self.load_node_credentials()
        return {
            "path": str(credential_path),
            "exists": credential_path.exists(),
            "is_windows_dpapi": self.is_windows(),
            "configured": stored is not None,
            "control_plane_base_url": stored.get("control_plane_base_url") if stored else "",
            "node_id": stored.get("node_id") if stored else "",
            "site_id": stored.get("site_id") if stored else "",
            "saved_at": stored.get("saved_at") if stored else "",
        }


DEFAULT_SECRETS_MANAGER = SecretsManager()

