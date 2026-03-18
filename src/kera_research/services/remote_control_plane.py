from __future__ import annotations

from typing import Any

import requests

from kera_research.config import (
    CONTROL_PLANE_API_BASE_URL,
    CONTROL_PLANE_API_TIMEOUT_SECONDS,
    CONTROL_PLANE_NODE_ID,
    CONTROL_PLANE_NODE_TOKEN,
)
from kera_research.services.node_credentials import load_node_credentials


class RemoteControlPlaneClient:
    def __init__(
        self,
        *,
        base_url: str | None = None,
        node_id: str | None = None,
        node_token: str | None = None,
        timeout_seconds: float | None = None,
    ) -> None:
        self._configured_base_url = (base_url or CONTROL_PLANE_API_BASE_URL or "").strip().rstrip("/")
        self._configured_node_id = (node_id or CONTROL_PLANE_NODE_ID or "").strip()
        self._configured_node_token = (node_token or CONTROL_PLANE_NODE_TOKEN or "").strip()
        self.base_url = self._configured_base_url
        self.node_id = self._configured_node_id
        self.node_token = self._configured_node_token
        self.timeout_seconds = float(timeout_seconds or CONTROL_PLANE_API_TIMEOUT_SECONDS or 30.0)
        self.reload_credentials()

    def reload_credentials(self) -> dict[str, str] | None:
        self.base_url = self._configured_base_url
        self.node_id = self._configured_node_id
        self.node_token = self._configured_node_token
        stored = load_node_credentials()
        if stored is None:
            return None
        if not self.base_url:
            self.base_url = str(stored.get("control_plane_base_url") or "").strip().rstrip("/")
        if not self.node_id:
            self.node_id = str(stored.get("node_id") or "").strip()
        if not self.node_token:
            self.node_token = str(stored.get("node_token") or "").strip()
        return stored

    def is_configured(self) -> bool:
        self.reload_credentials()
        return bool(self.base_url)

    def has_node_credentials(self) -> bool:
        self.reload_credentials()
        return bool(self.node_id and self.node_token)

    def _url(self, path: str) -> str:
        self.reload_credentials()
        if not self.base_url:
            raise RuntimeError("KERA_CONTROL_PLANE_API_BASE_URL is not configured.")
        normalized_path = path if path.startswith("/") else f"/{path}"
        return f"{self.base_url}{normalized_path}"

    def _node_headers(self) -> dict[str, str]:
        self.reload_credentials()
        if not self.has_node_credentials():
            raise RuntimeError("Control plane node credentials are not configured.")
        return {
            "x-kera-node-id": self.node_id,
            "x-kera-node-token": self.node_token,
        }

    def register_node(
        self,
        *,
        user_bearer_token: str,
        device_name: str,
        os_info: str = "",
        app_version: str = "",
        site_id: str | None = None,
        display_name: str | None = None,
        hospital_name: str | None = None,
        source_institution_id: str | None = None,
    ) -> dict[str, Any]:
        response = requests.post(
            self._url("/nodes/register"),
            json={
                "device_name": device_name,
                "os_info": os_info,
                "app_version": app_version,
                "site_id": site_id,
                "display_name": display_name,
                "hospital_name": hospital_name,
                "source_institution_id": source_institution_id,
            },
            headers={"Authorization": f"Bearer {user_bearer_token.strip()}"},
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()
        return dict(response.json())

    def bootstrap(self) -> dict[str, Any]:
        response = requests.get(
            self._url("/nodes/bootstrap"),
            headers=self._node_headers(),
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()
        return dict(response.json())

    def heartbeat(self, *, app_version: str = "", os_info: str = "", status: str = "ok") -> dict[str, Any]:
        response = requests.post(
            self._url("/nodes/heartbeat"),
            json={
                "app_version": app_version,
                "os_info": os_info,
                "status": status,
            },
            headers=self._node_headers(),
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()
        return dict(response.json())

    def current_release(self) -> dict[str, Any] | None:
        response = requests.get(
            self._url("/nodes/current-release"),
            headers=self._node_headers(),
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()
        payload = response.json()
        return dict(payload) if isinstance(payload, dict) else None

    def upload_model_update(
        self,
        *,
        base_model_version_id: str | None,
        payload_json: dict[str, Any],
        review_thumbnail_url: str | None = None,
    ) -> dict[str, Any]:
        response = requests.post(
            self._url("/nodes/model-updates"),
            json={
                "base_model_version_id": base_model_version_id,
                "payload_json": payload_json,
                "review_thumbnail_url": review_thumbnail_url,
            },
            headers=self._node_headers(),
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()
        return dict(response.json())

    def upload_validation_run(
        self,
        *,
        summary_json: dict[str, Any],
    ) -> dict[str, Any]:
        response = requests.post(
            self._url("/nodes/validation-runs"),
            json={
                "summary_json": summary_json,
            },
            headers=self._node_headers(),
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()
        return dict(response.json())

    def relay_ai_clinic(
        self,
        *,
        input_text: str,
        system_prompt: str = "",
        model: str = "",
    ) -> dict[str, Any]:
        response = requests.post(
            self._url("/llm/ai-clinic"),
            json={
                "input": input_text,
                "system": system_prompt,
                "model": model,
            },
            headers=self._node_headers(),
            timeout=max(self.timeout_seconds, 60.0),
        )
        response.raise_for_status()
        return dict(response.json())
