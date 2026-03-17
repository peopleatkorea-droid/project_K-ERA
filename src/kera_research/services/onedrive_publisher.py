from __future__ import annotations

import hashlib
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote

import requests

from kera_research.config import (
    ONEDRIVE_CLIENT_ID,
    ONEDRIVE_CLIENT_SECRET,
    ONEDRIVE_DRIVE_ID,
    ONEDRIVE_GRAPH_TIMEOUT_SECONDS,
    ONEDRIVE_ROOT_PATH,
    ONEDRIVE_SHARE_SCOPE,
    ONEDRIVE_SHARE_TYPE,
    ONEDRIVE_TENANT_ID,
)


def _safe_name(value: str, fallback: str) -> str:
    normalized = "".join(ch if ch.isalnum() or ch in {"-", "_", "."} else "_" for ch in str(value or "").strip())
    collapsed = normalized.strip("._")
    return collapsed or fallback


class OneDrivePublisher:
    _token_lock = threading.Lock()
    _cached_access_token: str | None = None
    _cached_token_expires_at: float = 0.0

    def __init__(self) -> None:
        self.tenant_id = ONEDRIVE_TENANT_ID
        self.client_id = ONEDRIVE_CLIENT_ID
        self.client_secret = ONEDRIVE_CLIENT_SECRET
        self.drive_id = ONEDRIVE_DRIVE_ID
        self.root_path = ONEDRIVE_ROOT_PATH
        self.share_scope = ONEDRIVE_SHARE_SCOPE
        self.share_type = ONEDRIVE_SHARE_TYPE
        self.timeout_seconds = max(30.0, float(ONEDRIVE_GRAPH_TIMEOUT_SECONDS))

    def is_configured(self) -> bool:
        return not self.missing_settings()

    def missing_settings(self) -> list[str]:
        missing: list[str] = []
        if not self.tenant_id:
            missing.append("KERA_ONEDRIVE_TENANT_ID")
        if not self.client_id:
            missing.append("KERA_ONEDRIVE_CLIENT_ID")
        if not self.client_secret:
            missing.append("KERA_ONEDRIVE_CLIENT_SECRET")
        if not self.drive_id:
            missing.append("KERA_ONEDRIVE_DRIVE_ID")
        return missing

    def configuration_summary(self) -> dict[str, Any]:
        return {
            "enabled": self.is_configured(),
            "missing_settings": self.missing_settings(),
            "drive_id_configured": bool(self.drive_id),
            "root_path": self.root_path,
            "share_scope": self.share_scope,
            "share_type": self.share_type,
        }

    def require_configured(self) -> None:
        missing = self.missing_settings()
        if missing:
            raise ValueError(
                "OneDrive auto-publish is not configured: missing "
                + ", ".join(missing)
                + "."
            )

    def sha256_file(self, path: str | Path) -> str:
        digest = hashlib.sha256()
        with Path(path).open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    def file_size(self, path: str | Path) -> int:
        return int(Path(path).stat().st_size)

    def _token_endpoint(self) -> str:
        return f"https://login.microsoftonline.com/{self.tenant_id}/oauth2/v2.0/token"

    def _graph_endpoint(self, relative_path: str) -> str:
        normalized = relative_path.lstrip("/")
        return f"https://graph.microsoft.com/v1.0/{normalized}"

    def _access_token(self) -> str:
        self.require_configured()
        now = time.time()
        with self._token_lock:
            if self._cached_access_token and now < self._cached_token_expires_at:
                return self._cached_access_token

            response = requests.post(
                self._token_endpoint(),
                data={
                    "grant_type": "client_credentials",
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "scope": "https://graph.microsoft.com/.default",
                },
                timeout=self.timeout_seconds,
            )
            response.raise_for_status()
            payload = response.json()
            access_token = str(payload.get("access_token") or "").strip()
            if not access_token:
                raise ValueError("Microsoft Graph token response did not contain access_token.")
            expires_in = max(300, int(payload.get("expires_in") or 3600))
            self._cached_access_token = access_token
            self._cached_token_expires_at = now + expires_in - 120
            return access_token

    def _request(self, method: str, relative_path: str, **kwargs: Any) -> requests.Response:
        headers = dict(kwargs.pop("headers", {}))
        headers["Authorization"] = f"Bearer {self._access_token()}"
        timeout = kwargs.pop("timeout", self.timeout_seconds)
        response = requests.request(
            method,
            self._graph_endpoint(relative_path),
            headers=headers,
            timeout=timeout,
            **kwargs,
        )
        try:
            response.raise_for_status()
        except requests.HTTPError as exc:
            detail = ""
            try:
                payload = response.json()
                error_payload = payload.get("error") if isinstance(payload, dict) else None
                if isinstance(error_payload, dict):
                    detail = str(error_payload.get("message") or "").strip()
            except ValueError:
                detail = ""
            if not detail:
                detail = response.text.strip()[:500]
            raise ValueError(f"OneDrive Graph API request failed with HTTP {response.status_code}: {detail or 'unknown error'}") from exc
        return response

    def _upload_request(self, method: str, url: str, **kwargs: Any) -> requests.Response:
        response = requests.request(method, url, timeout=self.timeout_seconds, **kwargs)
        try:
            response.raise_for_status()
        except requests.HTTPError as exc:
            detail = response.text.strip()[:500]
            raise ValueError(f"OneDrive upload request failed with HTTP {response.status_code}: {detail or 'unknown error'}") from exc
        return response

    def _remote_path(self, *, category: str, artifact_id: str, filename: str) -> str:
        remote_name = "__".join(
            [
                _safe_name(category, "artifact"),
                _safe_name(artifact_id, "item"),
                _safe_name(filename, "artifact.bin"),
            ]
        )
        if self.root_path:
            return "/".join([self.root_path, remote_name])
        return remote_name

    def _quoted_remote_path(self, remote_path: str) -> str:
        normalized = "/".join(segment for segment in str(remote_path or "").replace("\\", "/").split("/") if segment)
        return quote(normalized, safe="/")

    def _create_upload_session(self, remote_path: str) -> str:
        response = self._request(
            "POST",
            f"drives/{self.drive_id}/root:/{self._quoted_remote_path(remote_path)}:/createUploadSession",
            json={"item": {"@microsoft.graph.conflictBehavior": "replace"}},
        )
        payload = response.json()
        upload_url = str(payload.get("uploadUrl") or "").strip()
        if not upload_url:
            raise ValueError("OneDrive upload session response did not contain uploadUrl.")
        return upload_url

    def _upload_file(self, local_path: Path, remote_path: str) -> dict[str, Any]:
        upload_url = self._create_upload_session(remote_path)
        total_size = int(local_path.stat().st_size)
        chunk_size = 8 * 1024 * 1024
        final_payload: dict[str, Any] | None = None
        with local_path.open("rb") as handle:
            offset = 0
            while offset < total_size:
                chunk = handle.read(chunk_size)
                if not chunk:
                    break
                start = offset
                end = offset + len(chunk) - 1
                response = self._upload_request(
                    "PUT",
                    upload_url,
                    headers={
                        "Content-Length": str(len(chunk)),
                        "Content-Range": f"bytes {start}-{end}/{total_size}",
                    },
                    data=chunk,
                )
                if response.status_code in {200, 201}:
                    payload = response.json()
                    if isinstance(payload, dict):
                        final_payload = payload
                offset += len(chunk)
        if not isinstance(final_payload, dict):
            raise ValueError("OneDrive upload session did not return a final DriveItem payload.")
        return final_payload

    def _create_share_link(self, item_id: str) -> dict[str, Any]:
        response = self._request(
            "POST",
            f"drives/{self.drive_id}/items/{item_id}/createLink",
            json={
                "type": self.share_type,
                "scope": self.share_scope,
            },
        )
        payload = response.json()
        link_payload = payload.get("link") if isinstance(payload, dict) else None
        web_url = str(link_payload.get("webUrl") or "").strip() if isinstance(link_payload, dict) else ""
        return {
            "web_url": web_url,
            "scope": self.share_scope,
            "type": self.share_type,
        }

    def publish_local_file(
        self,
        *,
        local_path: str | Path,
        category: str,
        artifact_id: str,
        filename: str = "",
    ) -> dict[str, Any]:
        self.require_configured()
        resolved_local_path = Path(local_path).expanduser().resolve()
        if not resolved_local_path.exists():
            raise FileNotFoundError(f"OneDrive publish source file does not exist: {resolved_local_path}")

        effective_filename = filename.strip() or resolved_local_path.name
        remote_path = self._remote_path(category=category, artifact_id=artifact_id, filename=effective_filename)
        item_payload = self._upload_file(resolved_local_path, remote_path)
        item_id = str(item_payload.get("id") or "").strip()
        if not item_id:
            raise ValueError("OneDrive upload did not return an item id.")
        item_web_url = str(item_payload.get("webUrl") or "").strip()
        share_url = ""
        share_scope = self.share_scope
        share_error = ""
        try:
            share_payload = self._create_share_link(item_id)
            share_url = str(share_payload.get("web_url") or "").strip()
            share_scope = str(share_payload.get("scope") or self.share_scope)
        except ValueError as exc:
            share_error = str(exc)
        return {
            "download_url": share_url or item_web_url,
            "source_provider": "onedrive_sharepoint",
            "distribution_status": "published",
            "filename": effective_filename,
            "size_bytes": self.file_size(resolved_local_path),
            "sha256": self.sha256_file(resolved_local_path),
            "onedrive_drive_id": self.drive_id,
            "onedrive_item_id": item_id,
            "onedrive_remote_path": remote_path,
            "onedrive_web_url": item_web_url,
            "onedrive_share_url": share_url,
            "onedrive_share_scope": share_scope,
            "onedrive_share_type": self.share_type,
            "onedrive_share_error": share_error,
        }

    def _drive_item(self, record: dict[str, Any]) -> dict[str, Any]:
        self.require_configured()
        drive_id = str(record.get("onedrive_drive_id") or self.drive_id).strip()
        if not drive_id:
            raise ValueError("OneDrive drive id is missing.")
        item_id = str(record.get("onedrive_item_id") or "").strip()
        remote_path = str(record.get("onedrive_remote_path") or "").strip()
        if item_id:
            response = self._request("GET", f"drives/{drive_id}/items/{item_id}")
            payload = response.json()
            if not isinstance(payload, dict):
                raise ValueError("OneDrive item lookup returned an invalid payload.")
            return payload
        if remote_path:
            response = self._request("GET", f"drives/{drive_id}/root:/{self._quoted_remote_path(remote_path)}")
            payload = response.json()
            if not isinstance(payload, dict):
                raise ValueError("OneDrive path lookup returned an invalid payload.")
            return payload
        raise ValueError("OneDrive item metadata is missing item id and remote path.")

    def resolve_download_url(self, record: dict[str, Any]) -> str:
        drive_item = self._drive_item(record)
        download_url = str(drive_item.get("@microsoft.graph.downloadUrl") or "").strip()
        if not download_url:
            raise ValueError("OneDrive item did not provide a temporary download URL.")
        return download_url
