from __future__ import annotations

import threading
import time
from typing import Any

from fastapi import FastAPI


def start_control_plane_sync_loop(
    app: FastAPI,
    cp: Any,
    *,
    heartbeat_interval_seconds: float,
    bootstrap_refresh_seconds: float,
    app_version: str,
    os_info: str,
) -> None:
    if not cp.remote_node_sync_enabled():
        return

    stop_event = threading.Event()
    app.state.control_plane_sync_stop = stop_event

    def sync_loop() -> None:
        last_bootstrap_sync = time.time()
        bootstrap = cp.remote_bootstrap_state(force_refresh=True)
        if bootstrap is not None:
            cp.record_remote_node_heartbeat(
                app_version=app_version,
                os_info=os_info,
                status="startup",
            )
        while not stop_event.wait(heartbeat_interval_seconds):
            cp.record_remote_node_heartbeat(
                app_version=app_version,
                os_info=os_info,
                status="ok",
            )
            if (time.time() - last_bootstrap_sync) >= bootstrap_refresh_seconds:
                cp.remote_bootstrap_state(force_refresh=True)
                last_bootstrap_sync = time.time()

    threading.Thread(
        target=sync_loop,
        daemon=True,
        name="kera-control-plane-sync",
    ).start()


def stop_control_plane_sync_loop(app: FastAPI) -> None:
    stop_event = getattr(app.state, "control_plane_sync_stop", None)
    if isinstance(stop_event, threading.Event):
        stop_event.set()
