from __future__ import annotations

from typing import Any

from kera_research.services.secrets_manager import DEFAULT_SECRETS_MANAGER


def _is_windows() -> bool:
    return DEFAULT_SECRETS_MANAGER.is_windows()


def _protect_bytes(payload: bytes) -> bytes:
    return DEFAULT_SECRETS_MANAGER.protect_bytes(payload)


def _unprotect_bytes(payload: bytes) -> bytes:
    return DEFAULT_SECRETS_MANAGER.unprotect_bytes(payload)


def save_node_credentials(
    *,
    control_plane_base_url: str,
    node_id: str,
    node_token: str,
    site_id: str | None = None,
) -> dict[str, str]:
    return DEFAULT_SECRETS_MANAGER.save_node_credentials(
        control_plane_base_url=control_plane_base_url,
        node_id=node_id,
        node_token=node_token,
        site_id=site_id,
    )


def load_node_credentials() -> dict[str, str] | None:
    return DEFAULT_SECRETS_MANAGER.load_node_credentials()


def clear_node_credentials() -> None:
    DEFAULT_SECRETS_MANAGER.clear_node_credentials()


def node_credentials_status() -> dict[str, Any]:
    return DEFAULT_SECRETS_MANAGER.node_credentials_status()

