from __future__ import annotations

import platform
import threading
import time
from pathlib import Path
from typing import Any, Callable

import requests

from kera_research.storage import read_json, write_json

REMOTE_BOOTSTRAP_CACHE_FILENAME = "remote_bootstrap_cache.json"


class ControlPlaneRemoteState:
    def __init__(
        self,
        *,
        root: Path,
        remote_control_plane: Any,
        remote_node_sync_enabled: Callable[[], bool],
        clear_remote_credentials: Callable[[], None],
        cache_remote_release_locally: Callable[[dict[str, Any]], dict[str, Any]],
        bootstrap_refresh_seconds: float,
        release_cache_seconds: float,
    ) -> None:
        self.remote_control_plane = remote_control_plane
        self._remote_node_sync_enabled = remote_node_sync_enabled
        self._clear_remote_credentials = clear_remote_credentials
        self._cache_remote_release_locally = cache_remote_release_locally
        self._bootstrap_refresh_seconds = float(bootstrap_refresh_seconds)
        self._release_cache_seconds = float(release_cache_seconds)
        self._remote_sync_lock = threading.Lock()
        self._remote_bootstrap_cache_path = root / REMOTE_BOOTSTRAP_CACHE_FILENAME
        self._remote_bootstrap_cache: dict[str, Any] | None = None
        self._remote_bootstrap_cached_at = 0.0
        self._remote_release_cache: dict[str, Any] | None = None
        self._remote_release_cached_at = 0.0

    def clear(self, *, clear_persisted_credentials: bool = False) -> None:
        if clear_persisted_credentials:
            self._clear_remote_credentials()
        self.remote_control_plane.reload_credentials()
        self._remote_bootstrap_cache = None
        self._remote_bootstrap_cached_at = 0.0
        self._remote_release_cache = None
        self._remote_release_cached_at = 0.0
        if self._remote_bootstrap_cache_path.exists():
            self._remote_bootstrap_cache_path.unlink()

    def remote_node_os_info(self) -> str:
        return f"{platform.system()} {platform.release()} ({platform.machine()})".strip()

    def _load_bootstrap_cache(self) -> dict[str, Any] | None:
        if self._remote_bootstrap_cache is not None:
            return dict(self._remote_bootstrap_cache)
        payload = read_json(self._remote_bootstrap_cache_path, {})
        if isinstance(payload, dict) and payload:
            self._remote_bootstrap_cache = dict(payload)
            self._remote_bootstrap_cached_at = time.time()
            current_release = payload.get("current_release")
            if isinstance(current_release, dict) and current_release:
                self._remote_release_cache = dict(current_release)
                self._remote_release_cached_at = self._remote_bootstrap_cached_at
            return dict(payload)
        return None

    def _store_bootstrap_cache(self, payload: dict[str, Any]) -> dict[str, Any]:
        cached = dict(payload)
        self._remote_bootstrap_cache = cached
        self._remote_bootstrap_cached_at = time.time()
        current_release = cached.get("current_release")
        if isinstance(current_release, dict) and current_release:
            self._remote_release_cache = dict(current_release)
            self._remote_release_cached_at = self._remote_bootstrap_cached_at
            self._cache_remote_release_locally(current_release)
        write_json(self._remote_bootstrap_cache_path, cached)
        return dict(cached)

    def bootstrap_state(self, *, force_refresh: bool = False) -> dict[str, Any] | None:
        if not self._remote_node_sync_enabled():
            return self._load_bootstrap_cache()

        now = time.time()
        with self._remote_sync_lock:
            if (
                not force_refresh
                and self._remote_bootstrap_cache is not None
                and (now - self._remote_bootstrap_cached_at) < self._bootstrap_refresh_seconds
            ):
                return dict(self._remote_bootstrap_cache)

        try:
            payload = self.remote_control_plane.bootstrap()
        except (requests.RequestException, RuntimeError):
            payload = None

        with self._remote_sync_lock:
            if isinstance(payload, dict) and payload:
                return self._store_bootstrap_cache(payload)
            cached = self._load_bootstrap_cache()
            return dict(cached) if cached else None

    def record_node_heartbeat(
        self,
        *,
        app_version: str = "",
        os_info: str = "",
        status: str = "ok",
    ) -> dict[str, Any] | None:
        if not self._remote_node_sync_enabled():
            return None
        try:
            node = self.remote_control_plane.heartbeat(
                app_version=app_version,
                os_info=os_info or self.remote_node_os_info(),
                status=status,
            )
        except (requests.RequestException, RuntimeError):
            return None

        with self._remote_sync_lock:
            bootstrap = self._load_bootstrap_cache()
            if bootstrap is not None:
                bootstrap["node"] = dict(node)
                self._store_bootstrap_cache(bootstrap)
        return dict(node)

    def current_release_manifest(self, *, force_refresh: bool = False) -> dict[str, Any] | None:
        if not self._remote_node_sync_enabled():
            return None

        now = time.time()
        with self._remote_sync_lock:
            if (
                not force_refresh
                and self._remote_release_cache is not None
                and (now - self._remote_release_cached_at) < self._release_cache_seconds
            ):
                return dict(self._remote_release_cache)

        try:
            payload = self.remote_control_plane.current_release()
        except (requests.RequestException, RuntimeError):
            payload = None

        with self._remote_sync_lock:
            if isinstance(payload, dict) and payload:
                self._remote_release_cache = dict(payload)
                self._remote_release_cached_at = time.time()
                bootstrap = self._load_bootstrap_cache()
                if bootstrap is not None:
                    bootstrap["current_release"] = dict(payload)
                    self._store_bootstrap_cache(bootstrap)
                else:
                    self._cache_remote_release_locally(payload)
                return dict(payload)

        bootstrap = self.bootstrap_state(force_refresh=force_refresh)
        if isinstance(bootstrap, dict):
            release = bootstrap.get("current_release")
            if isinstance(release, dict) and release:
                return dict(release)
        return None
