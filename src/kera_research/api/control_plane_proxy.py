from __future__ import annotations

from collections.abc import Callable
from typing import Any, TypeVar

from fastapi import HTTPException, status

T = TypeVar("T")


def bearer_token_from_authorization(authorization: str | None) -> str | None:
    value = str(authorization or "").strip()
    if not value.lower().startswith("bearer "):
        return None
    token = value.split(" ", 1)[1].strip()
    return token or None


def prefer_local_control_plane(control_plane_owner: str | None) -> bool:
    return str(control_plane_owner or "").strip().lower() == "local"


def remote_control_plane_client(cp: Any, *, control_plane_owner: str | None) -> Any | None:
    if prefer_local_control_plane(control_plane_owner):
        return None
    if not cp.remote_control_plane_enabled():
        return None
    return cp.remote_control_plane


def remote_control_plane_is_primary(cp: Any, *, control_plane_owner: str | None) -> bool:
    return remote_control_plane_client(cp, control_plane_owner=control_plane_owner) is not None


def require_remote_control_plane_result(
    result: T | None,
    *,
    cp: Any,
    control_plane_owner: str | None,
    detail: str,
    status_code: int = status.HTTP_503_SERVICE_UNAVAILABLE,
) -> T:
    if result is not None:
        return result
    if remote_control_plane_is_primary(cp, control_plane_owner=control_plane_owner):
        raise HTTPException(status_code=status_code, detail=detail)
    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=detail)


def call_remote_public_control_plane(
    cp: Any,
    *,
    control_plane_owner: str | None,
    operation: Callable[[Any], T],
) -> T | None:
    remote_cp = remote_control_plane_client(cp, control_plane_owner=control_plane_owner)
    if remote_cp is None:
        return None
    try:
        return operation(remote_cp)
    except Exception:
        return None


def call_remote_public_control_plane_method(
    cp: Any,
    *,
    control_plane_owner: str | None,
    method_name: str,
    **kwargs: Any,
) -> Any | None:
    return call_remote_public_control_plane(
        cp,
        control_plane_owner=control_plane_owner,
        operation=lambda remote_cp: getattr(remote_cp, method_name)(**kwargs),
    )


def call_remote_control_plane(
    cp: Any,
    *,
    authorization: str | None,
    control_plane_owner: str | None,
    operation: Callable[[Any, str], T],
) -> T | None:
    remote_cp = remote_control_plane_client(cp, control_plane_owner=control_plane_owner)
    user_bearer_token = bearer_token_from_authorization(authorization)
    if remote_cp is None or user_bearer_token is None:
        return None
    try:
        return operation(remote_cp, user_bearer_token)
    except Exception:
        return None


def call_remote_control_plane_method(
    cp: Any,
    *,
    authorization: str | None,
    control_plane_owner: str | None,
    method_name: str,
    **kwargs: Any,
) -> Any | None:
    return call_remote_control_plane(
        cp,
        authorization=authorization,
        control_plane_owner=control_plane_owner,
        operation=lambda remote_cp, user_bearer_token: getattr(remote_cp, method_name)(
            user_bearer_token=user_bearer_token,
            **kwargs,
        ),
    )


def site_record_for_request(
    cp: Any,
    *,
    site_id: str,
    authorization: str | None,
    control_plane_owner: str | None,
) -> dict[str, Any] | None:
    normalized_site_id = str(site_id or "").strip()
    if not normalized_site_id:
        return None
    local_site = cp.get_site(normalized_site_id)
    if isinstance(local_site, dict) and local_site:
        return dict(local_site)
    remote_sites = call_remote_control_plane_method(
        cp,
        authorization=authorization,
        control_plane_owner=control_plane_owner,
        method_name="main_sites",
    )
    if isinstance(remote_sites, list):
        remote_match = next(
            (
                item
                for item in remote_sites
                if str(item.get("site_id") or "").strip() == normalized_site_id
            ),
            None,
        )
        if remote_match is not None:
            return dict(remote_match)
    return cp.get_site(normalized_site_id)
