from __future__ import annotations

import threading
from typing import Any

import requests
from requests.adapters import HTTPAdapter

from kera_research.config import (
    CONTROL_PLANE_API_BASE_URL,
    CONTROL_PLANE_API_TIMEOUT_SECONDS,
    CONTROL_PLANE_NODE_ID,
    CONTROL_PLANE_NODE_TOKEN,
)
from kera_research.services.node_credentials import load_node_credentials

REMOTE_CONTROL_PLANE_HTTP_POOL_SIZE = 8


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
        self._session_state = threading.local()
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

    def _user_headers(self, user_bearer_token: str) -> dict[str, str]:
        token = (user_bearer_token or "").strip()
        if not token:
            raise RuntimeError("User bearer token is required.")
        return {
            "Authorization": f"Bearer {token}",
        }

    def _request_json(
        self,
        method: str,
        path: str,
        *,
        headers: dict[str, str] | None = None,
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
        timeout_seconds: float | None = None,
    ) -> Any:
        response = self._session().request(
            method.upper(),
            self._url(path),
            headers=headers,
            params=params,
            json=json_body,
            timeout=float(timeout_seconds or self.timeout_seconds),
        )
        response.raise_for_status()
        return response.json()

    def _session(self) -> requests.Session:
        session = getattr(self._session_state, "session", None)
        if session is not None:
            return session
        session = requests.Session()
        adapter = HTTPAdapter(
            pool_connections=REMOTE_CONTROL_PLANE_HTTP_POOL_SIZE,
            pool_maxsize=REMOTE_CONTROL_PLANE_HTTP_POOL_SIZE,
        )
        session.mount("http://", adapter)
        session.mount("https://", adapter)
        self._session_state.session = session
        return session

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
        payload = self._request_json(
            "POST",
            "/nodes/register",
            json_body={
                "device_name": device_name,
                "os_info": os_info,
                "app_version": app_version,
                "site_id": site_id,
                "display_name": display_name,
                "hospital_name": hospital_name,
                "source_institution_id": source_institution_id,
            },
            headers=self._user_headers(user_bearer_token),
        )
        return dict(payload)

    def register_main_admin_node(
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
        payload = self._request_json(
            "POST",
            "/main/admin/nodes/register",
            json_body={
                "device_name": device_name,
                "os_info": os_info,
                "app_version": app_version,
                "site_id": site_id,
                "display_name": display_name,
                "hospital_name": hospital_name,
                "source_institution_id": source_institution_id,
            },
            headers=self._user_headers(user_bearer_token),
        )
        return dict(payload)

    def bootstrap(self) -> dict[str, Any]:
        payload = self._request_json("GET", "/nodes/bootstrap", headers=self._node_headers())
        return dict(payload)

    def heartbeat(self, *, app_version: str = "", os_info: str = "", status: str = "ok") -> dict[str, Any]:
        payload = self._request_json(
            "POST",
            "/nodes/heartbeat",
            json_body={
                "app_version": app_version,
                "os_info": os_info,
                "status": status,
            },
            headers=self._node_headers(),
        )
        return dict(payload)

    def current_release(self) -> dict[str, Any] | None:
        payload = self._request_json("GET", "/nodes/current-release", headers=self._node_headers())
        return dict(payload) if isinstance(payload, dict) else None

    def upload_model_update(
        self,
        *,
        base_model_version_id: str | None,
        payload_json: dict[str, Any],
        review_thumbnail_url: str | None = None,
    ) -> dict[str, Any]:
        payload = self._request_json(
            "POST",
            "/nodes/model-updates",
            json_body={
                "base_model_version_id": base_model_version_id,
                "payload_json": payload_json,
                "review_thumbnail_url": review_thumbnail_url,
            },
            headers=self._node_headers(),
        )
        return dict(payload)

    def upload_validation_run(
        self,
        *,
        summary_json: dict[str, Any],
    ) -> dict[str, Any]:
        payload = self._request_json(
            "POST",
            "/nodes/validation-runs",
            json_body={
                "summary_json": summary_json,
            },
            headers=self._node_headers(),
        )
        return dict(payload)

    def relay_ai_clinic(
        self,
        *,
        input_text: str,
        system_prompt: str = "",
        model: str = "",
    ) -> dict[str, Any]:
        payload = self._request_json(
            "POST",
            "/llm/ai-clinic",
            json_body={
                "input": input_text,
                "system": system_prompt,
                "model": model,
            },
            headers=self._node_headers(),
            timeout_seconds=max(self.timeout_seconds, 60.0),
        )
        return dict(payload)

    def public_sites(self) -> list[dict[str, Any]]:
        payload = self._request_json("GET", "/main/public/sites")
        return [dict(item) for item in payload] if isinstance(payload, list) else []

    def public_institutions(
        self,
        *,
        query: str = "",
        sido_code: str | None = None,
        sggu_code: str | None = None,
        limit: int = 12,
        timeout_seconds: float | None = None,
    ) -> list[dict[str, Any]]:
        payload = self._request_json(
            "GET",
            "/main/public/institutions/search",
            params={
                "q": query,
                "sido_code": sido_code,
                "sggu_code": sggu_code,
                "limit": limit,
            },
            timeout_seconds=timeout_seconds,
        )
        return [dict(item) for item in payload] if isinstance(payload, list) else []

    def public_statistics(self) -> dict[str, Any]:
        payload = self._request_json("GET", "/main/public/statistics")
        return dict(payload) if isinstance(payload, dict) else {}

    def main_desktop_auth_start(
        self,
        *,
        payload_json: dict[str, Any],
    ) -> dict[str, Any]:
        payload = self._request_json(
            "POST",
            "/main/auth/desktop/start",
            json_body=payload_json,
        )
        return dict(payload) if isinstance(payload, dict) else {}

    def main_desktop_auth_exchange(
        self,
        *,
        payload_json: dict[str, Any],
    ) -> dict[str, Any]:
        payload = self._request_json(
            "POST",
            "/main/auth/desktop/exchange",
            json_body=payload_json,
            timeout_seconds=max(self.timeout_seconds, 60.0),
        )
        return dict(payload) if isinstance(payload, dict) else {}

    def main_auth_login(
        self,
        *,
        payload_json: dict[str, Any],
    ) -> dict[str, Any]:
        payload = self._request_json(
            "POST",
            "/main/auth/login",
            json_body=payload_json,
        )
        return dict(payload) if isinstance(payload, dict) else {}

    def main_sites(self, *, user_bearer_token: str) -> list[dict[str, Any]]:
        payload = self._request_json("GET", "/main/sites", headers=self._user_headers(user_bearer_token))
        return [dict(item) for item in payload] if isinstance(payload, list) else []

    def main_auth_me(self, *, user_bearer_token: str) -> dict[str, Any]:
        payload = self._request_json("GET", "/main/auth/me", headers=self._user_headers(user_bearer_token))
        return dict(payload) if isinstance(payload, dict) else {}

    def main_access_requests(self, *, user_bearer_token: str) -> list[dict[str, Any]]:
        payload = self._request_json("GET", "/main/auth/access-requests", headers=self._user_headers(user_bearer_token))
        return [dict(item) for item in payload] if isinstance(payload, list) else []

    def main_request_access(
        self,
        *,
        user_bearer_token: str,
        payload_json: dict[str, Any],
    ) -> dict[str, Any]:
        payload = self._request_json(
            "POST",
            "/main/auth/request-access",
            headers=self._user_headers(user_bearer_token),
            json_body=payload_json,
        )
        return dict(payload) if isinstance(payload, dict) else {}

    def main_admin_access_requests(
        self,
        *,
        user_bearer_token: str,
        status_filter: str | None = None,
    ) -> list[dict[str, Any]]:
        payload = self._request_json(
            "GET",
            "/main/admin/access-requests",
            headers=self._user_headers(user_bearer_token),
            params={"status_filter": status_filter},
        )
        return [dict(item) for item in payload] if isinstance(payload, list) else []

    def main_admin_overview(self, *, user_bearer_token: str) -> dict[str, Any]:
        payload = self._request_json(
            "GET",
            "/main/admin/overview",
            headers=self._user_headers(user_bearer_token),
        )
        return dict(payload) if isinstance(payload, dict) else {}

    def main_admin_model_versions(self, *, user_bearer_token: str) -> list[dict[str, Any]]:
        payload = self._request_json(
            "GET",
            "/main/admin/model-versions",
            headers=self._user_headers(user_bearer_token),
        )
        return [dict(item) for item in payload] if isinstance(payload, list) else []

    def main_admin_model_updates(
        self,
        *,
        user_bearer_token: str,
        site_id: str | None = None,
        status_filter: str | None = None,
    ) -> list[dict[str, Any]]:
        payload = self._request_json(
            "GET",
            "/main/admin/model-updates",
            headers=self._user_headers(user_bearer_token),
            params={
                "site_id": site_id,
                "status_filter": status_filter,
            },
        )
        return [dict(item) for item in payload] if isinstance(payload, list) else []

    def main_admin_aggregations(self, *, user_bearer_token: str) -> list[dict[str, Any]]:
        payload = self._request_json(
            "GET",
            "/main/admin/aggregations",
            headers=self._user_headers(user_bearer_token),
        )
        return [dict(item) for item in payload] if isinstance(payload, list) else []

    def main_admin_review_access_request(
        self,
        *,
        user_bearer_token: str,
        request_id: str,
        payload_json: dict[str, Any],
    ) -> dict[str, Any]:
        payload = self._request_json(
            "POST",
            f"/main/admin/access-requests/{request_id}/review",
            headers=self._user_headers(user_bearer_token),
            json_body=payload_json,
        )
        return dict(payload) if isinstance(payload, dict) else {}

    def main_admin_projects(self, *, user_bearer_token: str) -> list[dict[str, Any]]:
        payload = self._request_json("GET", "/main/admin/projects", headers=self._user_headers(user_bearer_token))
        return [dict(item) for item in payload] if isinstance(payload, list) else []

    def main_admin_create_project(
        self,
        *,
        user_bearer_token: str,
        payload_json: dict[str, Any],
    ) -> dict[str, Any]:
        payload = self._request_json(
            "POST",
            "/main/admin/projects",
            headers=self._user_headers(user_bearer_token),
            json_body=payload_json,
        )
        return dict(payload) if isinstance(payload, dict) else {}

    def main_admin_sites(
        self,
        *,
        user_bearer_token: str,
        project_id: str | None = None,
    ) -> list[dict[str, Any]]:
        payload = self._request_json(
            "GET",
            "/main/admin/sites",
            headers=self._user_headers(user_bearer_token),
            params={"project_id": project_id},
        )
        return [dict(item) for item in payload] if isinstance(payload, list) else []

    def main_admin_create_site(
        self,
        *,
        user_bearer_token: str,
        payload_json: dict[str, Any],
    ) -> dict[str, Any]:
        payload = self._request_json(
            "POST",
            "/main/admin/sites",
            headers=self._user_headers(user_bearer_token),
            json_body=payload_json,
        )
        return dict(payload) if isinstance(payload, dict) else {}

    def main_admin_users(self, *, user_bearer_token: str) -> list[dict[str, Any]]:
        payload = self._request_json("GET", "/main/admin/users", headers=self._user_headers(user_bearer_token))
        return [dict(item) for item in payload] if isinstance(payload, list) else []

    def main_admin_upsert_user(
        self,
        *,
        user_bearer_token: str,
        payload_json: dict[str, Any],
    ) -> dict[str, Any]:
        payload = self._request_json(
            "POST",
            "/main/admin/users",
            headers=self._user_headers(user_bearer_token),
            json_body=payload_json,
        )
        return dict(payload) if isinstance(payload, dict) else {}

    def main_admin_update_site(
        self,
        *,
        user_bearer_token: str,
        site_id: str,
        payload_json: dict[str, Any],
    ) -> dict[str, Any]:
        payload = self._request_json(
            "PATCH",
            f"/main/admin/sites/{site_id}",
            headers=self._user_headers(user_bearer_token),
            json_body=payload_json,
        )
        return dict(payload) if isinstance(payload, dict) else {}

    def main_admin_institution_status(self, *, user_bearer_token: str) -> dict[str, Any]:
        payload = self._request_json(
            "GET",
            "/main/admin/institutions/status",
            headers=self._user_headers(user_bearer_token),
        )
        return dict(payload) if isinstance(payload, dict) else {}
