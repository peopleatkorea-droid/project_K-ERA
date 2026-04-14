from __future__ import annotations

from kera_research.services.secrets_manager import DEFAULT_SECRETS_MANAGER


def load_control_plane_jwt_public_key() -> str:
    return DEFAULT_SECRETS_MANAGER.load_control_plane_jwt_public_key()


def load_control_plane_jwt_private_key() -> str:
    return DEFAULT_SECRETS_MANAGER.load_control_plane_jwt_private_key()


def load_control_plane_jwt_issuer() -> str:
    return DEFAULT_SECRETS_MANAGER.load_control_plane_jwt_issuer()


def load_control_plane_jwt_audience() -> str:
    return DEFAULT_SECRETS_MANAGER.load_control_plane_jwt_audience()


def load_control_plane_jwt_key_id() -> str:
    return DEFAULT_SECRETS_MANAGER.load_control_plane_jwt_key_id()
