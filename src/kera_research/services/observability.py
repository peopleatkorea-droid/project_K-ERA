from __future__ import annotations

import logging
import os
import threading
import time
from collections import defaultdict
from typing import Any


def _escape_prometheus_label(value: str) -> str:
    return str(value or "").replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n")


def _parse_bool_env(name: str, default: bool = False) -> bool:
    raw = str(os.getenv(name) or "").strip().lower()
    if not raw:
        return bool(default)
    return raw in {"1", "true", "yes", "on"}


def _parse_float_env(name: str, default: float) -> float:
    raw = str(os.getenv(name) or "").strip()
    if not raw:
        return float(default)
    try:
        return float(raw)
    except ValueError:
        return float(default)


_SENTRY_LOCK = threading.Lock()
_SENTRY_STATUS: dict[str, Any] = {
    "provider": "sentry",
    "configured": False,
    "enabled": False,
    "detail": "disabled",
}


def current_error_aggregation_status() -> dict[str, Any]:
    with _SENTRY_LOCK:
        return dict(_SENTRY_STATUS)


def configure_sentry_observability(*, release: str, logger: logging.Logger) -> dict[str, Any]:
    dsn = str(os.getenv("KERA_SENTRY_DSN") or os.getenv("SENTRY_DSN") or "").strip()
    environment = str(
        os.getenv("KERA_SENTRY_ENVIRONMENT")
        or os.getenv("SENTRY_ENVIRONMENT")
        or os.getenv("KERA_ENVIRONMENT")
        or "production"
    ).strip()
    traces_sample_rate = max(0.0, _parse_float_env("KERA_SENTRY_TRACES_SAMPLE_RATE", 0.0))
    profiles_sample_rate = max(0.0, _parse_float_env("KERA_SENTRY_PROFILES_SAMPLE_RATE", 0.0))
    send_default_pii = _parse_bool_env("KERA_SENTRY_SEND_DEFAULT_PII", False)

    if not dsn:
        with _SENTRY_LOCK:
            if not bool(_SENTRY_STATUS.get("enabled")):
                _SENTRY_STATUS.update(
                    {
                        "provider": "sentry",
                        "configured": False,
                        "enabled": False,
                        "detail": "disabled",
                        "environment": environment,
                        "release": release,
                    }
                )
            return dict(_SENTRY_STATUS)

    with _SENTRY_LOCK:
        if bool(_SENTRY_STATUS.get("enabled")):
            return dict(_SENTRY_STATUS)
        try:
            import sentry_sdk
            from sentry_sdk.integrations.fastapi import FastApiIntegration
            from sentry_sdk.integrations.logging import LoggingIntegration

            sentry_sdk.init(
                dsn=dsn,
                environment=environment,
                release=release,
                traces_sample_rate=traces_sample_rate,
                profiles_sample_rate=profiles_sample_rate,
                send_default_pii=send_default_pii,
                integrations=[
                    FastApiIntegration(),
                    LoggingIntegration(
                        level=logging.INFO,
                        event_level=logging.ERROR,
                    ),
                ],
            )
            _SENTRY_STATUS.update(
                {
                    "provider": "sentry",
                    "configured": True,
                    "enabled": True,
                    "detail": "enabled",
                    "environment": environment,
                    "release": release,
                    "traces_sample_rate": traces_sample_rate,
                    "profiles_sample_rate": profiles_sample_rate,
                    "send_default_pii": send_default_pii,
                }
            )
        except Exception as exc:
            logger.warning(
                "Sentry observability initialization failed: %s",
                exc,
            )
            _SENTRY_STATUS.update(
                {
                    "provider": "sentry",
                    "configured": True,
                    "enabled": False,
                    "detail": str(exc),
                    "environment": environment,
                    "release": release,
                    "traces_sample_rate": traces_sample_rate,
                    "profiles_sample_rate": profiles_sample_rate,
                    "send_default_pii": send_default_pii,
                }
            )
        return dict(_SENTRY_STATUS)


class ApiRequestMetrics:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._started_at = time.monotonic()
        self._requests_total = 0
        self._errors_total = 0
        self._in_flight_requests = 0
        self._route_buckets: dict[tuple[str, str, str], dict[str, float]] = defaultdict(
            lambda: {
                "count": 0.0,
                "duration_sum_ms": 0.0,
                "duration_max_ms": 0.0,
            }
        )

    def begin_request(self) -> None:
        with self._lock:
            self._in_flight_requests += 1

    def finish_request(
        self,
        *,
        method: str,
        route: str,
        status_code: int,
        duration_ms: float,
    ) -> None:
        normalized_method = str(method or "UNKNOWN").upper()
        normalized_route = str(route or "<unmatched>").strip() or "<unmatched>"
        normalized_status = str(int(status_code or 0))
        normalized_duration_ms = max(0.0, float(duration_ms or 0.0))
        bucket_key = (normalized_method, normalized_route, normalized_status)

        with self._lock:
            self._in_flight_requests = max(0, self._in_flight_requests - 1)
            self._requests_total += 1
            if int(status_code or 0) >= 500:
                self._errors_total += 1
            bucket = self._route_buckets[bucket_key]
            bucket["count"] += 1.0
            bucket["duration_sum_ms"] += normalized_duration_ms
            bucket["duration_max_ms"] = max(bucket["duration_max_ms"], normalized_duration_ms)

    def snapshot(self, *, top_n: int = 10) -> dict[str, Any]:
        with self._lock:
            uptime_seconds = max(0.0, time.monotonic() - self._started_at)
            requests_total = int(self._requests_total)
            errors_total = int(self._errors_total)
            in_flight_requests = int(self._in_flight_requests)
            route_rows = [
                {
                    "method": method,
                    "route": route,
                    "status_code": int(status_code),
                    "count": int(bucket["count"]),
                    "avg_duration_ms": round(bucket["duration_sum_ms"] / max(bucket["count"], 1.0), 3),
                    "max_duration_ms": round(bucket["duration_max_ms"], 3),
                    "total_duration_ms": round(bucket["duration_sum_ms"], 3),
                }
                for (method, route, status_code), bucket in self._route_buckets.items()
            ]
        route_rows.sort(
            key=lambda item: (
                -float(item["max_duration_ms"]),
                -int(item["count"]),
                str(item["route"]),
                int(item["status_code"]),
            )
        )
        return {
            "uptime_seconds": round(uptime_seconds, 3),
            "requests_total": requests_total,
            "errors_total": errors_total,
            "in_flight_requests": in_flight_requests,
            "routes": route_rows[: max(1, int(top_n or 1))],
        }

    def render_prometheus(self) -> str:
        with self._lock:
            uptime_seconds = max(0.0, time.monotonic() - self._started_at)
            requests_total = int(self._requests_total)
            errors_total = int(self._errors_total)
            in_flight_requests = int(self._in_flight_requests)
            route_buckets = {
                key: dict(bucket)
                for key, bucket in self._route_buckets.items()
            }

        lines = [
            "# HELP kera_api_uptime_seconds Process uptime in seconds.",
            "# TYPE kera_api_uptime_seconds gauge",
            f"kera_api_uptime_seconds {uptime_seconds:.6f}",
            "# HELP kera_api_requests_total Total number of completed HTTP requests.",
            "# TYPE kera_api_requests_total counter",
            f"kera_api_requests_total {requests_total}",
            "# HELP kera_api_request_errors_total Total number of HTTP requests completed with 5xx status codes.",
            "# TYPE kera_api_request_errors_total counter",
            f"kera_api_request_errors_total {errors_total}",
            "# HELP kera_api_requests_in_flight Number of HTTP requests currently in flight.",
            "# TYPE kera_api_requests_in_flight gauge",
            f"kera_api_requests_in_flight {in_flight_requests}",
            "# HELP kera_api_request_duration_seconds Request duration summary by method, route, and status code.",
            "# TYPE kera_api_request_duration_seconds summary",
        ]
        for (method, route, status_code), bucket in sorted(route_buckets.items()):
            labels = (
                f'method="{_escape_prometheus_label(method)}",'
                f'route="{_escape_prometheus_label(route)}",'
                f'status_code="{_escape_prometheus_label(status_code)}"'
            )
            count = float(bucket["count"])
            duration_sum_seconds = float(bucket["duration_sum_ms"]) / 1000.0
            duration_max_seconds = float(bucket["duration_max_ms"]) / 1000.0
            lines.append(f"kera_api_request_duration_seconds_count{{{labels}}} {count:.0f}")
            lines.append(f"kera_api_request_duration_seconds_sum{{{labels}}} {duration_sum_seconds:.6f}")
            lines.append(f"kera_api_request_duration_seconds_max{{{labels}}} {duration_max_seconds:.6f}")
        return "\n".join(lines) + "\n"
