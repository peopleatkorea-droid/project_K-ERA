from __future__ import annotations

import ipaddress
import logging
import os
import threading
import time
from collections import defaultdict
from typing import Any
from urllib.parse import urlparse

from fastapi import HTTPException, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy import delete, func, select
from starlette.middleware.base import BaseHTTPMiddleware

from kera_research.db import CONTROL_PLANE_ENGINE, auth_rate_limits, init_control_plane_db

logger = logging.getLogger(__name__)

_login_rate: dict[str, list[float]] = defaultdict(list)
_login_rate_lock = threading.Lock()
_MAX_LOGIN_ATTEMPTS = 10
_LOGIN_WINDOW_SECONDS = 300.0
_LOGIN_RATE_LIMIT_SCOPE = "auth_login"
_AUTH_RATE_LIMITED_PATHS = frozenset({"/api/auth/login", "/api/auth/dev-login"})
_LOCAL_DEV_AUTH_ALLOWED_HOSTS = {"127.0.0.1", "::1", "localhost", "testserver", "testclient"}
_DEFAULT_TRUSTED_PROXY_HOSTS = {"127.0.0.1", "::1", "localhost"}
_TRUE_VALUES = {"1", "true", "yes", "on"}


def _env_flag(name: str, *, default: bool = False) -> bool:
    raw = str(os.getenv(name) or "").strip().lower()
    if not raw:
        return default
    return raw in _TRUE_VALUES


def check_login_rate_limit_in_memory(ip: str) -> None:
    now = time.monotonic()
    with _login_rate_lock:
        window = _login_rate[ip]
        _login_rate[ip] = [t for t in window if now - t < _LOGIN_WINDOW_SECONDS]
        if len(_login_rate[ip]) >= _MAX_LOGIN_ATTEMPTS:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many login attempts. Please try again later.",
                headers={"Retry-After": str(int(_LOGIN_WINDOW_SECONDS))},
            )
        _login_rate[ip].append(now)


def check_login_rate_limit(ip: str) -> None:
    normalized_ip = str(ip or "").strip() or "unknown"
    now = time.time()
    cutoff = now - _LOGIN_WINDOW_SECONDS

    try:
        init_control_plane_db()
        with CONTROL_PLANE_ENGINE.begin() as conn:
            conn.execute(
                delete(auth_rate_limits).where(
                    auth_rate_limits.c.scope == _LOGIN_RATE_LIMIT_SCOPE,
                    auth_rate_limits.c.attempted_at_epoch < cutoff,
                )
            )
            current_count = int(
                conn.execute(
                    select(func.count())
                    .select_from(auth_rate_limits)
                    .where(
                        auth_rate_limits.c.scope == _LOGIN_RATE_LIMIT_SCOPE,
                        auth_rate_limits.c.client_key == normalized_ip,
                        auth_rate_limits.c.attempted_at_epoch >= cutoff,
                    )
                ).scalar_one()
            )
            if current_count >= _MAX_LOGIN_ATTEMPTS:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Too many login attempts. Please try again later.",
                    headers={"Retry-After": str(int(_LOGIN_WINDOW_SECONDS))},
                )
            conn.execute(
                auth_rate_limits.insert().values(
                    scope=_LOGIN_RATE_LIMIT_SCOPE,
                    client_key=normalized_ip,
                    attempted_at_epoch=now,
                )
            )
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning(
            "Persistent login rate limiter failed for ip=%s; falling back to in-memory limiter: %s",
            normalized_ip,
            exc,
        )
        check_login_rate_limit_in_memory(normalized_ip)


def normalize_host_candidate(value: str | None) -> str:
    normalized = str(value or "").strip().lower()
    if not normalized:
        return ""
    if "://" in normalized:
        try:
            parsed = urlparse(normalized)
            if parsed.hostname:
                normalized = parsed.hostname.strip().lower()
        except ValueError:
            return ""
    elif normalized.startswith("[") and normalized.endswith("]"):
        normalized = normalized[1:-1]
    elif normalized.count(":") == 1:
        host, port = normalized.rsplit(":", 1)
        if port.isdigit():
            normalized = host
    return normalized.strip()


def request_uses_loopback_host(request: Request) -> bool:
    primary_candidates = (
        request.url.hostname,
        request.headers.get("host"),
        request.headers.get("origin"),
        request.headers.get("referer"),
    )
    normalized_primary = [normalize_host_candidate(candidate) for candidate in primary_candidates]
    for candidate in normalized_primary:
        if candidate in _LOCAL_DEV_AUTH_ALLOWED_HOSTS:
            return True
    if any(candidate for candidate in normalized_primary):
        return False
    fallback_candidate = normalize_host_candidate(request.client.host if request.client else None)
    return fallback_candidate in _LOCAL_DEV_AUTH_ALLOWED_HOSTS


def trusted_proxy_entries() -> tuple[set[str], list[ipaddress._BaseNetwork]]:
    raw = str(
        os.getenv("KERA_TRUSTED_PROXY_IPS")
        or os.getenv("KERA_TRUSTED_PROXY_CIDRS")
        or ""
    ).strip()
    tokens = [token.strip() for token in raw.split(",") if token.strip()]
    if not tokens:
        tokens = sorted(_DEFAULT_TRUSTED_PROXY_HOSTS)
    exact_hosts: set[str] = set()
    networks: list[ipaddress._BaseNetwork] = []
    for token in tokens:
        normalized = normalize_host_candidate(token)
        if not normalized:
            continue
        try:
            networks.append(ipaddress.ip_network(normalized, strict=False))
        except ValueError:
            exact_hosts.add(normalized)
    return exact_hosts, networks


def host_is_trusted_proxy(host: str | None) -> bool:
    normalized = normalize_host_candidate(host)
    if not normalized:
        return False
    exact_hosts, networks = trusted_proxy_entries()
    if normalized in exact_hosts:
        return True
    try:
        host_ip = ipaddress.ip_address(normalized)
    except ValueError:
        return False
    return any(host_ip in network for network in networks)


def forwarded_client_ip(value: str | None) -> str | None:
    normalized = normalize_host_candidate(value)
    if not normalized or normalized == "unknown":
        return None
    try:
        return str(ipaddress.ip_address(normalized))
    except ValueError:
        return None


def request_client_ip(request: Request) -> str:
    direct_host = normalize_host_candidate(request.client.host if request.client else None) or "unknown"
    if not _env_flag("KERA_TRUST_PROXY_HEADERS", default=False):
        return direct_host
    if not host_is_trusted_proxy(direct_host):
        return direct_host
    x_forwarded_for = request.headers.get("x-forwarded-for")
    if x_forwarded_for:
        for candidate in x_forwarded_for.split(","):
            forwarded_ip = forwarded_client_ip(candidate)
            if forwarded_ip:
                return forwarded_ip
    x_real_ip = forwarded_client_ip(request.headers.get("x-real-ip"))
    if x_real_ip:
        return x_real_ip
    return direct_host


def should_apply_auth_rate_limit(request: Request) -> bool:
    return request.method.upper() == "POST" and request.url.path in _AUTH_RATE_LIMITED_PATHS


def ensure_auth_rate_limit(request: Request) -> None:
    if getattr(request.state, "auth_rate_limit_checked", False):
        return
    check_login_rate_limit(request_client_ip(request))
    request.state.auth_rate_limit_checked = True


class AuthRateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        if not should_apply_auth_rate_limit(request):
            return await call_next(request)
        try:
            ensure_auth_rate_limit(request)
        except HTTPException as exc:
            headers = dict(exc.headers or {})
            return JSONResponse(
                status_code=exc.status_code,
                content={"detail": exc.detail},
                headers=headers,
            )
        return await call_next(request)

