from __future__ import annotations

from kera_research.services.secrets_manager import DEFAULT_SECRETS_MANAGER


def save_local_api_secret(secret: str) -> str:
    return DEFAULT_SECRETS_MANAGER.save_local_api_secret(secret)


def load_local_api_secret() -> str:
    return DEFAULT_SECRETS_MANAGER.load_local_api_secret()


def load_or_create_local_api_secret() -> str:
    return DEFAULT_SECRETS_MANAGER.load_or_create_local_api_secret()

